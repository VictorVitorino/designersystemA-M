/* Cliente do GoTrue (Supabase Auth) — a API é o ÚNICO cliente; o navegador nunca fala com o Supabase (docs/API.md §3).
   • Tudo via fetch, com timeout de 8 s. Chaves: `anon` para chamadas de usuário, `service_role` só para convite/administração.
   • Erros viram HttpError em pt-BR: credenciais inválidas → invalidCredentials; link expirado → gone; o resto → unavailable.
     O CORPO do erro do GoTrue nunca é repassado ao cliente nem logado (pode conter e-mail/detalhes); só status e código técnico vão ao log.
   • `fetchImpl` injetável para testes. */
import { E } from '../lib/errors.js';
import { createLogger } from '../lib/log.js';

const TIMEOUT_MS = 8000;
const BAN_FOREVER = '876000h';   // ~100 anos; `none` remove o bloqueio (GoTrue: ban_duration)
/* Chaves novas do Supabase (sb_publishable_… no lugar de anon, sb_secret_… no lugar de service_role; projetos criados a partir de
   nov/2025 só têm estas) NÃO são JWT: vão só no cabeçalho `apikey` e o gateway do Supabase deriva o papel delas. Mandá-las como
   `Authorization: Bearer` faz o Supabase recusar a chamada. As legadas (JWT) seguem também como Bearer, como o GoTrue espera. */
export const isOpaqueKey = (k) => /^sb_(publishable|secret)_/.test(String(k || ''));

export function createGoTrue(config, { fetchImpl } = {}) {
  const log = createLogger(config);
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const base = config.supabase?.url ? `${config.supabase.url.replace(/\/$/, '')}/auth/v1` : null;

  /** @returns {Promise<{status:number, body:any, headers:Headers}>} lança E.unavailable em falha de rede/timeout. */
  async function call(op, method, path, { body, key = 'anon', bearer } = {}) {
    if (!base) throw E.notConfigured('Autenticação ainda não configurada.');
    const apikey = key === 'service' ? config.supabase.serviceKey : config.supabase.anonKey;
    if (!apikey) throw E.notConfigured('Autenticação ainda não configurada.');
    const headers = { apikey, Accept: 'application/json' };
    // chamadas de usuário levam o token do usuário; sem ele, a chave legada (JWT) vai também como Bearer (padrão do GoTrue) e a nova (sb_…) só no apikey
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    else if (!isOpaqueKey(apikey)) headers.Authorization = `Bearer ${apikey}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await doFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    } catch (e) {
      log.warn('gotrue_network', { op, kind: e && e.name === 'TimeoutError' ? 'timeout' : 'network' });
      throw E.unavailable('Serviço de autenticação indisponível. Tente novamente em instantes.');
    }
    let parsed = null;
    const text = await res.text().catch(() => '');
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  const codeOf = (b) => String(b?.error_code || (typeof b?.code === 'string' ? b.code : '') || b?.error || '').toLowerCase();
  const textOf = (b) => String(b?.msg || b?.message || b?.error_description || '').toLowerCase();
  const ok = (r) => r.status >= 200 && r.status < 300;
  const fail = (op, r) => { log.warn('gotrue_error', { op, status: r.status, errorCode: codeOf(r.body).slice(0, 60) }); };
  const common = (op, r) => {            // mapeamentos que valem para qualquer chamada
    fail(op, r);
    if (r.status === 429) return E.rateLimited(60);
    return E.unavailable('Serviço de autenticação indisponível. Tente novamente em instantes.');
  };
  async function idsByEmail(email, first) {
    const want = String(email).trim().toLowerCase(); const out = [];
    for (let page = 1; page <= 50; page++) {
      const r = await call('list_users', 'GET', `/admin/users?page=${page}&per_page=200`, { key: 'service' });
      if (!ok(r)) throw common('list_users', r);
      const users = Array.isArray(r.body?.users) ? r.body.users : [];
      for (const u of users) if (String(u.email || '').toLowerCase() === want) { out.push(u.id); if (first) return out; }
      if (users.length < 200) break;
    }
    return out;
  }
  const session = (b) => ({ accessToken: b.access_token, refreshToken: b.refresh_token, expiresIn: Number(b.expires_in) || 3600, user: b.user ? { id: b.user.id, email: b.user.email } : null });
  const hasSession = (b) => b && typeof b.access_token === 'string' && typeof b.refresh_token === 'string';

  return {
    /** Convida por e-mail (service role). Falha com already_exists se o usuário já confirmou o e-mail. @returns {{id:string,email:string}} */
    async invite({ email, displayName }) {
      const r = await call('invite', 'POST', '/invite', { key: 'service', body: { email, data: { display_name: displayName } } });
      if (ok(r) && r.body?.id) return { id: r.body.id, email: r.body.email || email };
      if (r.status === 422 || r.status === 409 || codeOf(r.body) === 'email_exists' || textOf(r.body).includes('already been registered')) { fail('invite', r); throw E.exists('Este e-mail já tem uma conta.'); }
      throw common('invite', r);
    },
    /** Troca o link do e-mail (token_hash) por uma sessão. Link expirado/usado → 410. */
    async verify({ type, tokenHash }) {
      const r = await call('verify', 'POST', '/verify', { body: { type, token_hash: tokenHash } });
      if (ok(r) && hasSession(r.body)) return session(r.body);
      if (r.status === 429 || r.status >= 500) throw common('verify', r);
      fail('verify', r); throw E.gone();
    },
    async login({ email, password }) {
      const r = await call('login', 'POST', '/token?grant_type=password', { body: { email, password } });
      if (ok(r) && hasSession(r.body)) return session(r.body);
      if (codeOf(r.body) === 'user_banned' || textOf(r.body).includes('banned')) { fail('login', r); throw E.suspended(); }
      if (r.status === 429 || r.status >= 500) throw common('login', r);
      fail('login', r); throw E.invalidCredentials();   // e-mail inexistente, senha errada, e-mail não confirmado: TODOS iguais para o cliente
    },
    async refresh(refreshToken) {
      const r = await call('refresh', 'POST', '/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
      if (ok(r) && hasSession(r.body)) return session(r.body);
      if (r.status === 429 || r.status >= 500) throw common('refresh', r);
      fail('refresh', r); throw E.sessionExpired();
    },
    /** Define a senha do usuário dono do access token. */
    async setPassword(accessToken, password) {
      const r = await call('set_password', 'PUT', '/user', { bearer: accessToken, body: { password } });
      if (ok(r)) return true;
      const code = codeOf(r.body);
      fail('set_password', r);
      if (code === 'weak_password') throw E.badRequest('A senha foi recusada por ser fraca ou já ter vazado em outro site. Escolha outra.', { fields: [{ path: 'password', message: 'Senha fraca ou vazada.' }] });
      if (code === 'same_password') throw E.badRequest('A nova senha precisa ser diferente da atual.', { fields: [{ path: 'password', message: 'Igual à senha atual.' }] });
      if (r.status === 401 || code === 'bad_jwt' || code === 'session_not_found' || code === 'reauthentication_needed' || code === 'reauthentication_not_valid') throw E.sessionExpired();
      if (r.status === 429 || r.status >= 500) throw common('set_password', r);
      throw E.badRequest('Não foi possível definir a senha.');
    },
    /** Envia o e-mail de recuperação (o GoTrue responde 200 também quando o e-mail não existe). */
    async recover(email) {
      const r = await call('recover', 'POST', '/recover', { body: { email } });
      if (ok(r)) return true;
      throw common('recover', r);
    },
    /** Revoga a sessão do dono do token. scope: 'local' (só este dispositivo), 'global' (todos) ou 'others'. @returns {boolean} false se o token já era inválido */
    async logout(accessToken, scope = 'local') {
      if (!['local', 'global', 'others'].includes(scope)) throw new Error('scope inválido');
      const r = await call('logout', 'POST', `/logout?scope=${scope}`, { bearer: accessToken });
      if (ok(r)) return true;
      if (r.status === 401 || r.status === 403 || r.status === 404) return false;
      throw common('logout', r);
    },
    /** Bloqueia (ou desbloqueia) o usuário no GoTrue: sem login nem renovação de sessão. userId = id do GoTrue. */
    async ban(userId, banned) {
      const r = await call('ban', 'PUT', `/admin/users/${encodeURIComponent(userId)}`, { key: 'service', body: { ban_duration: banned ? BAN_FOREVER : 'none' } });
      if (ok(r)) return true;
      if (r.status === 404) return false;
      throw common('ban', r);
    },
    async remove(userId) {
      const r = await call('remove', 'DELETE', `/admin/users/${encodeURIComponent(userId)}`, { key: 'service' });
      if (ok(r)) return true;
      if (r.status === 404) return false;
      throw common('remove', r);
    },
    /** Procura o id do GoTrue pelo e-mail (listagem paginada do admin; suficiente para centenas de usuários). null se não existir. */
    async findUserIdByEmail(email) { return (await idsByEmail(email, true))[0] || null; },
    /** TODOS os ids do GoTrue com o e-mail: com o SSO, a mesma pessoa tem a conta de e-mail/senha E a conta SAML (o Supabase cria outro
     *  auth.users para o SSO). Suspender/revogar precisa bloquear as duas. */
    async findUserIdsByEmail(email) { return idsByEmail(email, false); },
    /** SSO (SAML) com PKCE: pede ao GoTrue a URL do IdP do domínio (POST /sso, sem seguir redirecionamento). Provedor inexistente ou
     *  desligado no Supabase → not_configured. A URL devolvida precisa ser absoluta e https (http só fora de staging/produção). */
    async ssoUrl({ domain, redirectTo, codeChallenge }) {
      const r = await call('sso', 'POST', '/sso', { body: { domain, redirect_to: redirectTo, skip_http_redirect: true, code_challenge: codeChallenge, code_challenge_method: 's256' } });
      if (ok(r) && typeof r.body?.url === 'string') {
        let u = null; try { u = new URL(r.body.url); } catch { u = null; }
        if (u && (u.protocol === 'https:' || (u.protocol === 'http:' && !config.isSecure))) return u.toString();
        fail('sso', r); throw E.unavailable('Serviço de autenticação indisponível. Tente novamente em instantes.');
      }
      if (r.status === 404 || r.status === 400 || r.status === 422) { fail('sso', r); throw E.notConfigured('O login corporativo não está disponível para este domínio.'); }
      throw common('sso', r);
    },
    /** Troca o código do retorno do IdP por sessão (grant_type=pkce). Código inválido, vencido, já usado ou verifier errado → link_invalid (410). */
    async exchangeCode({ authCode, codeVerifier }) {
      const r = await call('pkce', 'POST', '/token?grant_type=pkce', { body: { auth_code: authCode, code_verifier: codeVerifier } });
      if (ok(r) && hasSession(r.body)) return session(r.body);
      if (codeOf(r.body) === 'user_banned') { fail('pkce', r); throw E.suspended(); }
      if (r.status === 429 || r.status >= 500) throw common('pkce', r);
      fail('pkce', r); throw E.gone('O login corporativo expirou ou já foi usado. Tente entrar de novo.');
    },
    /** Saúde do provedor para /api/ready (nunca lança). */
    async health() {
      try { const r = await call('health', 'GET', '/health'); return r.status >= 200 && r.status < 300; } catch { return false; }
    },
  };
}
