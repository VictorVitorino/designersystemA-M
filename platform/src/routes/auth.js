/* Rotas de autenticação (BFF sobre o GoTrue) — docs/API.md §3. Princípios:
   • Tokens NUNCA no corpo: só cookies HttpOnly. O corpo leva apenas {authenticated, csrfToken, user, needsPassword}.
   • Limite de taxa ANTES de qualquer chamada ao GoTrue (login, forgot, verify), no Postgres (app.hit_rate).
   • Falhas de login iguais para e-mail inexistente × senha errada, com tempo equalizado; a auditoria guarda só o HMAC do e-mail.
   • Quem não foi convidado nunca recebe sessão utilizável: a identidade só é vinculada pelo banco (app.resolve_identity) a um convite existente.
   • SSO corporativo (F10, SAML do Supabase com PKCE; só com SSO_ENABLED): GET /sso?email= (ou ?domain=) → URL do IdP pelo GoTrue → 302; o IdP
     volta ao GoTrue, que volta a GET /sso/callback?code= → troca por sessão com o verifier guardado no cookie do MESMO navegador → vínculo da
     identidade nova à conta EXISTENTE pelo e-mail verificado (de um domínio de SSO_DOMAINS). São navegações do navegador: os erros voltam para
     /entrar?motivo=<código> (not_invited, suspended, sso_email, sso_dominio, sso_indisponivel, sso_expirou, sso_falhou, sso_limite). */
import { Hono } from 'hono';
import { E, HttpError } from '../lib/errors.js';
import { createLogger, safeExceptionKind } from '../lib/log.js';
import { requireUser, audit, auditAnon, limit } from '../lib/request.js';
import { cookieNames, ssoCookieName, readCookie, setSessionCookies, clearSessionCookies, setCsrfCookie, setNeedsPasswordCookie, setSsoCookie } from '../auth/cookies.js';
import { CSRF_TOKEN_RE, newCsrfToken, padTo, sha256hex, hmacHex, safeEqual } from '../auth/hash.js';
import { getAuthKit } from '../auth/kit.js';
import { JwtRejected } from '../auth/jwt.js';
import { validatePassword } from '../auth/password.js';
import { readJson, emailField, displayNameField, z } from '../auth/body.js';
import { pkcePair, sealState, openState, safeNext, domainOf, ssoDomainAllowed, isSsoProvider, SSO_DOMAIN_RE, AUTH_CODE_RE, SSO_TTL_S } from '../auth/sso.js';

const LoginBody = z.object({ email: emailField, password: z.string({ required_error: 'Informe a senha.' }).min(1, 'Informe a senha.').max(1024, 'Senha muito longa.') }).strict();
const ForgotBody = z.object({ email: emailField }).strict();
const VerifyBody = z.object({
  tokenHash: z.string({ required_error: 'Link inválido.' }).min(10, 'Link inválido.').max(200, 'Link inválido.').regex(/^[A-Za-z0-9_.-]+$/, 'Link inválido.'),
  type: z.enum(['invite', 'recovery'], { errorMap: () => ({ message: 'Tipo de link inválido.' }) }),
}).strict();
const PasswordBody = z.object({ password: z.string({ required_error: 'Informe a senha.' }).max(1024, 'Senha muito longa.') }).strict();
const MeBody = z.object({ displayName: displayNameField }).strict();
const SsoQuery = z.object({ email: emailField.optional(), domain: z.string().trim().toLowerCase().regex(SSO_DOMAIN_RE).optional(), next: z.string().max(512).optional() })
  .refine((q) => !!q.email !== !!q.domain);

export const publicUser = (u) => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status });
const sessionBody = (user, csrfToken, needsPassword) => ({ authenticated: true, csrfToken, user: publicUser(user), needsPassword: !!needsPassword });

export function authRoutes(deps) {
  const { config, db, gotrue } = deps;
  const kit = getAuthKit(deps);
  const log = deps.logger || createLogger(config);
  const names = cookieNames(config);
  const r = new Hono();
  const inflight = new Map();   // refresh em andamento por refresh token (várias abas/requisições simultâneas → 1 chamada ao GoTrue)

  function ensureCsrf(c, { rotate = false } = {}) {
    let t = readCookie(c, names.csrf);
    if (rotate || !t || !CSRF_TOKEN_RE.test(t)) { t = newCsrfToken(); setCsrfCookie(c, config, t); }
    return t;
  }
  const bestEffort = async (fn) => { try { await fn(); } catch (e) { log.warn('auth_best_effort_failed', { kind: safeExceptionKind(e) }); } };
  const auditUser = (c, user, action, meta = {}) => bestEffort(() => db.asUser(user.id, (tx) => audit(tx, c, action, 'user', user.id, meta)));

  /** Verifica o access token recém-emitido pelo GoTrue (não confiamos no corpo da resposta: o mesmo verificador do middleware decide). */
  async function claimsOf(accessToken) {
    try { return await kit.verifier.verify(accessToken); }
    catch (e) { throw e instanceof JwtRejected && e.reason === 'invalid' ? E.sessionExpired() : E.unavailable(); }
  }
  /* Estado de RECUPERAÇÃO (pode definir senha): token ASSINADO (HMAC com o segredo do servidor), vinculado à sessão do JWT e com validade de 1 h,
     emitido só por /verify (convite ou "esqueci a senha"). Um cookie é controlado por quem o envia: um valor fixo como "1" seria forjável por
     quem roubou os cookies da sessão (AF-1, revisão adversarial). */
  const recoveryToken = (claims) => { const exp = Math.floor(Date.now() / 1000) + 3600; const sid = (claims && (claims.sessionId || claims.sub)) || ''; return `${exp}.${hmacHex(config.csrfSecret, `np|${sid}|${exp}`)}`; };
  const inRecovery = (c) => {
    const v = readCookie(c, names.np); const claims = c.get('claims'); if (!v || !claims) return false;
    const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(v); if (!m) return false;
    const exp = Number(m[1]); if (!(exp > Math.floor(Date.now() / 1000))) return false;
    return safeEqual(m[2], hmacHex(config.csrfSecret, `np|${claims.sessionId || claims.sub || ''}|${exp}`));
  };
  /** Sessão nova que não pode ser usada (sem convite/suspenso): revoga no GoTrue para não deixar sessão órfã. */
  const discard = (tokens) => bestEffort(() => gotrue.logout(tokens.accessToken, 'local'));

  function refreshOnce(rt) {
    const key = sha256hex(rt);
    let p = inflight.get(key);
    if (!p) { p = gotrue.refresh(rt); inflight.set(key, p); p.finally(() => inflight.delete(key)).catch(() => {}); }
    return p;
  }
  /** Renova pelo refresh token e devolve o usuário (ou lança). Aplica os cookies novos. */
  async function refreshSession(c, rt) {
    let tokens;
    try { tokens = await refreshOnce(rt); }
    catch (e) { if (e instanceof HttpError && e.code === 'session_expired') clearSessionCookies(c, config); throw e; }
    const claims = await claimsOf(tokens.accessToken);
    const user = await kit.resolve(claims, { allowLink: false, touch: false });
    if (!user || user.status === 'suspended') { await discard(tokens); clearSessionCookies(c, config); throw user ? E.suspended() : E.notInvited(); }
    setSessionCookies(c, config, tokens);
    kit.cache.set(claims.sub, user);
    c.set('claims', claims);   // quem renovou passa a ter as claims da sessão nova (inRecovery usa a sessão do JWT)
    return user;
  }

  // ------------------------------------------------------------------------------------------------ sessão
  r.get('/session', async (c) => {
    const csrfToken = ensureCsrf(c);
    let user = c.get('user'); const problem = c.get('authProblem');
    if (user && user.status === 'suspended') { clearSessionCookies(c, config); return c.json({ authenticated: false, csrfToken, reason: 'suspended' }); }
    if (!user && problem === 'not_invited') { clearSessionCookies(c, config); return c.json({ authenticated: false, csrfToken, reason: 'not_invited' }); }
    if (!user) {
      const rt = readCookie(c, names.rt);
      if (rt && problem !== 'not_configured') {
        try { user = await refreshSession(c, rt); }
        catch (e) {
          if (e instanceof HttpError && (e.code === 'unavailable' || e.code === 'rate_limited')) throw e;   // provedor fora do ar ou limitando: não apaga cookies nem desloga (o cliente espera e repete)
          user = null; clearSessionCookies(c, config);
        }
      }
    }
    if (!user) return c.json({ authenticated: false, csrfToken });
    return c.json(sessionBody(user, csrfToken, user.status === 'invited' || inRecovery(c)));
  });

  // ------------------------------------------------------------------------------------------------ login
  r.post('/login', async (c) => {
    const t0 = Date.now();
    const { email, password } = await readJson(c, LoginBody);
    const ip = c.get('ip') || 'unknown', eh = kit.hashEmail(email);
    await limit(c, 'login_ip', ip, 600, 30);                 // 30/10 min por IP
    await limit(c, 'login_email_ip', `${eh}:${ip}`, 600, 8);  // 8/10 min por e-mail+IP
    let tokens;
    try { tokens = await gotrue.login({ email, password }); }
    catch (e) {
      if (e instanceof HttpError && (e.code === 'invalid_credentials' || e.code === 'suspended')) {
        await bestEffort(() => auditAnon(c, 'auth.login_failed', 'user', null, { email_hash: eh, reason: e.code }));
        await padTo(t0, kit.timing.failMinMs);               // mesmo tempo para e-mail inexistente e senha errada
      }
      throw e;
    }
    const claims = await claimsOf(tokens.accessToken);
    const user = await kit.resolve(claims, { allowLink: true, touch: true });
    if (!user || user.status === 'suspended') {
      await discard(tokens);
      await bestEffort(() => auditAnon(c, 'auth.login_failed', 'user', null, { email_hash: eh, reason: user ? 'suspended' : 'not_invited' }));
      throw user ? E.suspended() : E.notInvited();
    }
    kit.cache.invalidateUser(user.id);
    kit.cache.set(claims.sub, user);
    setSessionCookies(c, config, tokens);
    setNeedsPasswordCookie(c, config, false);
    const csrfToken = ensureCsrf(c, { rotate: true });        // token novo a cada login (evita fixação)
    await auditUser(c, user, 'auth.login');
    return c.json(sessionBody(user, csrfToken, false));
  });

  // ------------------------------------------------------------------------------------------------ sair
  r.post('/logout', async (c) => {
    const user = c.get('user'), rt = readCookie(c, names.rt);
    let token = c.get('claims') ? readCookie(c, names.at) : null;
    if (!token && rt) { try { token = (await refreshOnce(rt)).accessToken; } catch { token = null; } }   // access expirado: renova só para poder revogar
    if (token) await bestEffort(() => gotrue.logout(token, 'local'));
    if (user) await auditUser(c, user, 'auth.logout');
    clearSessionCookies(c, config);
    return c.body(null, 204);
  });

  // ------------------------------------------------------------------------------------------------ link do e-mail (convite / recuperação)
  r.post('/verify', async (c) => {
    const { tokenHash, type } = await readJson(c, VerifyBody);
    await limit(c, 'verify_tok', sha256hex(tokenHash).slice(0, 32), 900, 10);   // por link (token de uso único e imprevisível): força bruta inviável
    await limit(c, 'verify_ip', c.get('ip') || 'unknown', 900, 100);           // teto por IP alto: uma equipe inteira abre os convites do mesmo escritório (A3)
    const tokens = await gotrue.verify({ type, tokenHash });
    const claims = await claimsOf(tokens.accessToken);
    const user = await kit.resolve(claims, { allowLink: true, touch: false });   // vincula a identidade ao convite; ainda NÃO ativa (falta a senha)
    if (!user || user.status === 'suspended') { await discard(tokens); throw user ? E.suspended() : E.notInvited(); }
    kit.cache.invalidateUser(user.id);
    kit.cache.set(claims.sub, user);
    setSessionCookies(c, config, tokens);
    c.set('claims', claims);
    setNeedsPasswordCookie(c, config, recoveryToken(claims));
    const csrfToken = ensureCsrf(c, { rotate: true });
    await auditUser(c, user, 'auth.verify', { type });
    return c.json(sessionBody(user, csrfToken, true));
  });

  // ------------------------------------------------------------------------------------------------ definir senha
  r.post('/password', async (c) => {
    const user = requireUser(c, { allowInvited: true });
    // só quem acabou de provar a posse do e-mail (convite ou link de recuperação) define a senha: uma sessão ativa roubada não toma a conta (AF-1)
    if (!(user.status === 'invited' || inRecovery(c))) throw E.forbidden('Para trocar a senha, use "Esqueci a senha" na tela de entrada: enviaremos um link ao seu e-mail.');
    const { password } = await readJson(c, PasswordBody);
    const v = validatePassword(password, user.email);
    if (!v.ok) throw E.badRequest(v.reason, { fields: [{ path: 'password', message: v.reason }] });
    await limit(c, 'password_user', user.id, 900, 10);
    const at = readCookie(c, names.at);
    await gotrue.setPassword(at, password);
    const fresh = await kit.resolve(c.get('claims'), { allowLink: true, touch: true });   // ativa o convite (status → active)
    if (!fresh || fresh.status === 'suspended') throw fresh ? E.suspended() : E.notInvited();
    kit.cache.invalidateUser(user.id);
    kit.cache.set(c.get('claims').sub, fresh);
    await auditUser(c, fresh, 'auth.password_set');
    await bestEffort(() => gotrue.logout(at, 'others'));      // trocou a senha → encerra as outras sessões (quem tinha a senha antiga perde o acesso)
    setNeedsPasswordCookie(c, config, false);
    return c.json(sessionBody(fresh, ensureCsrf(c), false));
  });

  // ------------------------------------------------------------------------------------------------ esqueci a senha
  r.post('/forgot', async (c) => {
    const t0 = Date.now();
    const { email } = await readJson(c, ForgotBody);
    const ip = c.get('ip') || 'unknown', eh = kit.hashEmail(email);
    await limit(c, 'forgot_ip', ip, 900, 5);
    await limit(c, 'forgot_email', eh, 900, 5);
    await bestEffort(() => gotrue.recover(email));            // falha do provedor não muda a resposta (não vira oráculo de existência)
    await bestEffort(() => auditAnon(c, 'auth.forgot', 'user', null, { email_hash: eh }));
    await padTo(t0, kit.timing.forgotMinMs);
    return c.json({ ok: true }, 202);
  });

  // ------------------------------------------------------------------------------------------------ renovar
  r.post('/refresh', async (c) => {
    const rt = readCookie(c, names.rt);
    if (!rt) throw E.sessionExpired();
    await limit(c, 'refresh_tok', sha256hex(rt).slice(0, 32), 60, 30);        // por token de renovação (HttpOnly, rotativo): não é superfície de força bruta; 30 cobre dezenas de abas renovando juntas
    await limit(c, 'refresh_ip', c.get('ip') || 'unknown', 60, 600);           // teto por IP alto: dezenas de pessoas atrás do mesmo NAT renovam sem derrubar umas às outras (A2)
    const user = await refreshSession(c, rt);
    return c.json(sessionBody(user, ensureCsrf(c), user.status === 'invited' || inRecovery(c)));
  });

  // ------------------------------------------------------------------------------------------------ SSO corporativo (SAML + PKCE)
  const ssoOff = () => E.notConfigured('Login corporativo (SSO) não está habilitado.');
  /** Erro numa navegação do SSO: volta para a tela de entrada com o motivo (a tela mostra a mensagem), preservando o destino. */
  function toLogin(c, motivo, next) {
    const q = new URLSearchParams({ motivo });
    if (next && next !== '/acervo') q.set('next', next);
    c.header('Cache-Control', 'no-store');
    return c.redirect(`/entrar?${q.toString()}`, 302);
  }
  /** Limite por IP numa navegação: estourou → tela de entrada com motivo sso_limite (em vez de JSON na tela). */
  async function ssoLimit(c, bucket) {
    try { await limit(c, bucket, c.get('ip') || 'unknown', 600, 100); return true; }
    catch (e) { if (e instanceof HttpError && e.code === 'rate_limited') return false; throw e; }
  }

  async function ssoStart(c) {
    if (!config.sso.enabled) throw ssoOff();
    const raw = c.req.query();
    const next = safeNext(typeof raw.next === 'string' ? raw.next : '');
    if (!(await ssoLimit(c, 'sso_ip'))) return toLogin(c, 'sso_limite', next);
    const q = SsoQuery.safeParse({ email: raw.email, domain: raw.domain, next: raw.next });
    if (!q.success) return toLogin(c, 'sso_email', next);
    const domain = q.data.email ? domainOf(q.data.email) : q.data.domain;
    if (!ssoDomainAllowed(config, domain)) { await bestEffort(() => auditAnon(c, 'auth.sso_refused', 'sso', null, { reason: 'dominio' })); return toLogin(c, 'sso_dominio', next); }
    const { verifier, challenge } = pkcePair();
    let url;
    try { url = await gotrue.ssoUrl({ domain, redirectTo: `${config.origin}/api/auth/sso/callback`, codeChallenge: challenge }); }
    catch (e) {
      if (!(e instanceof HttpError)) throw e;
      log.warn('sso_start_failed', { kind: safeExceptionKind(e) });
      return toLogin(c, e.code === 'rate_limited' ? 'sso_limite' : 'sso_indisponivel', next);
    }
    setSsoCookie(c, config, sealState(config, { verifier, next }), SSO_TTL_S);   // o verifier fica só aqui (HttpOnly) e no servidor; o IdP vê o desafio
    await bestEffort(() => auditAnon(c, 'auth.sso_start', 'sso', domain, {}));
    c.header('Cache-Control', 'no-store');
    return c.redirect(url, 302);
  }

  async function ssoCallback(c) {
    if (!config.sso.enabled) throw ssoOff();
    const state = openState(config, readCookie(c, ssoCookieName(config)));
    setSsoCookie(c, config, '');                                           // uso único: sai em qualquer desfecho
    const next = state ? state.next : '/acervo';
    if (!(await ssoLimit(c, 'sso_cb_ip'))) return toLogin(c, 'sso_limite', next);
    const q = c.req.query();
    const refuse = async (motivo, reason, tokens) => {
      if (tokens) await discard(tokens);
      await bestEffort(() => auditAnon(c, 'auth.sso_refused', 'sso', null, { reason }));
      return toLogin(c, motivo, next);
    };
    if (q.error !== undefined || q.error_code !== undefined) return refuse('sso_falhou', 'idp');   // a pessoa cancelou ou o IdP recusou (a descrição não é ecoada)
    if (!state) return refuse('sso_expirou', 'estado');                                               // outro navegador, cookie vencido/adulterado
    if (typeof q.code !== 'string' || !AUTH_CODE_RE.test(q.code)) return refuse('sso_expirou', 'codigo');
    let tokens;
    try { tokens = await gotrue.exchangeCode({ authCode: q.code, codeVerifier: state.verifier }); }
    catch (e) {
      if (!(e instanceof HttpError)) throw e;
      if (e.code === 'link_invalid') return refuse('sso_expirou', 'codigo');
      if (e.code === 'suspended') return refuse('suspended', 'banido');
      log.warn('sso_exchange_failed', { kind: safeExceptionKind(e) });
      return toLogin(c, e.code === 'rate_limited' ? 'sso_limite' : 'sso_indisponivel', next);
    }
    let claims;
    try { claims = await kit.verifier.verify(tokens.accessToken); }
    catch (e) { if (e instanceof JwtRejected && e.reason === 'invalid') return refuse('sso_falhou', 'token', tokens); log.warn('sso_verify_failed', { kind: safeExceptionKind(e) }); return toLogin(c, 'sso_indisponivel', next); }
    if (!isSsoProvider(claims.provider)) return refuse('sso_falhou', 'provedor', tokens);                   // a sessão tem de vir do SSO
    if (!ssoDomainAllowed(config, domainOf(claims.email))) return refuse('sso_dominio', 'dominio_idp', tokens);   // o IdP afirmou e-mail de outro domínio
    if (!claims.emailVerified) return refuse('sso_falhou', 'email_nao_verificado', tokens);
    const user = await kit.resolve(claims, { allowLink: true, touch: true });   // vincula à conta EXISTENTE pelo e-mail; nunca cria conta
    const eh = kit.hashEmail(claims.email);
    if (!user || user.status === 'suspended') {
      await discard(tokens);
      await bestEffort(() => auditAnon(c, 'auth.login_failed', 'user', null, { email_hash: eh, reason: user ? 'suspended' : 'not_invited', via: 'sso' }));
      return toLogin(c, user ? 'suspended' : 'not_invited', next);
    }
    kit.cache.invalidateUser(user.id);
    kit.cache.set(claims.sub, user);
    setSessionCookies(c, config, tokens);
    setNeedsPasswordCookie(c, config, false);
    ensureCsrf(c, { rotate: true });                                              // token CSRF novo a cada login (evita fixação)
    await auditUser(c, user, 'auth.login', { via: 'sso', provider: claims.provider });
    c.header('Cache-Control', 'no-store');
    return c.redirect(next, 302);
  }

  r.get('/sso', ssoStart);
  r.get('/sso/start', ssoStart);                                                  // nome antigo (respondia 501): continua valendo
  r.get('/sso/callback', ssoCallback);
  return r;
}

/** /api/me — o próprio perfil. */
authRoutes.me = (deps) => {
  const { db } = deps;
  const kit = getAuthKit(deps);
  const r = new Hono();
  r.get('/', (c) => c.json(publicUser(requireUser(c))));
  r.patch('/', async (c) => {
    const user = requireUser(c);
    const { displayName } = await readJson(c, MeBody);
    await db.asUser(user.id, async (tx) => {
      const rows = await tx`update app.users set display_name = ${displayName} where id = ${user.id} returning id`;
      if (!rows.length) throw E.notFound();
      await audit(tx, c, 'user.update', 'user', user.id, { fields: ['displayName'] });
    });
    kit.cache.invalidateUser(user.id);
    return c.json(publicUser({ ...user, displayName }));
  });
  return r;
};
