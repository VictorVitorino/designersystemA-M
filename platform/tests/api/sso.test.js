/* SSO corporativo (F10) ponta a ponta no GoTrue FALSO (SAML com PKCE): início, IdP, retorno, vínculo à conta EXISTENTE pelo e-mail verificado,
   convidado/suspenso/não convidado e erros que voltam à tela de entrada. API inteira em memória (boot): sessão, cookies e auditoria reais.
   O teste faz o papel do navegador: segue o 302 para o IdP falso (fetch real ao GoTrue falso) e volta ao retorno com o cookie do início. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';
import { ssoCookieName } from '../../src/auth/cookies.js';
import { openState, challengeOf } from '../../src/auth/sso.js';

let t, PID, ADM, cAdm, SSO_COOKIE;
before(async () => {
  t = await boot({ env: { SSO_ENABLED: 'true', SSO_DOMAINS: 'am.test,sem-provedor.test' } }); SSO_COOKIE = ssoCookieName(t.config);
  PID = t.fake.addSsoProvider('am.test');
  ADM = await t.createUser({ role: 'admin', displayName: 'Admin' }); cAdm = await t.as(ADM);
});
after(async () => { await t.stop(); });
const resetRates = () => t.ops.asSystem((tx) => tx`delete from app.rate_limits`);

const start = (c, q) => c.get('/api/auth/sso?' + new URLSearchParams(q).toString());
/** "Navegador" no IdP falso: devolve a URL de volta (o retorno da aplicação, com ?code= ou ?error=). */
async function atIdp(location, params) {
  const u = new URL(location); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { redirect: 'manual' }); assert.equal(r.status, 302, 'o IdP falso devolve ao retorno'); return new URL(r.headers.get('location'));
}
const back = (c, url) => c.get(url.pathname + url.search);
/** Login completo pelo SSO. idp: { email, verified:false, cancel:true, sub } */
async function ssoLogin(c, email, { next, idp = {} } = {}) {
  const s = await start(c, { email, ...(next ? { next } : {}) }); assert.equal(s.status, 302, s.text);
  const ret = await atIdp(s.headers.get('location'), { email: idp.email || email, ...(idp.verified === false ? { verified: '0' } : {}), ...(idp.cancel ? { cancel: '1' } : {}), ...(idp.sub ? { sub: idp.sub } : {}) });
  return back(c, ret);
}
const motivo = (r) => { assert.equal(r.status, 302); const u = new URL(r.headers.get('location'), 'http://x'); assert.equal(u.pathname, '/entrar'); return u.searchParams.get('motivo'); };
const identities = async (userId) => (await t.ops.asSystem((tx) => tx`select provider from app.user_identities where user_id = ${userId} order by provider`)).map((r) => r.provider);
const ssoUserOf = (email) => t.fake.ssoUsers().find((u) => u.email === email);

describe('início: GET /api/auth/sso?email= (ou ?domain=)', () => {
  test('302 para o IdP; cookie do fluxo HttpOnly, SameSite=Lax, Path=/, 10 min; o GoTrue recebe o desafio S256 e o retorno da aplicação — nunca o verifier', async () => {
    const c = t.anon(); const r = await start(c, { email: 'Ana.Qualquer@AM.test' });
    assert.equal(r.status, 302); const loc = r.headers.get('location'); assert.ok(loc.startsWith(`${t.fake.url}/__sso/idp?flow=`), loc);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const a = c.attrs.get(SSO_COOKIE); assert.ok(a, 'cookie do fluxo'); assert.equal(a.httponly, true); assert.equal(a.samesite, 'Lax'); assert.equal(a.path, '/'); assert.equal(a['max-age'], '600');
    const req = t.fake.state.ssoRequests.at(-1);
    assert.deepEqual(req.keys, ['code_challenge', 'code_challenge_method', 'domain', 'redirect_to', 'skip_http_redirect']);
    assert.equal(req.domain, 'am.test'); assert.equal(req.redirectTo, `${t.config.origin}/api/auth/sso/callback`); assert.equal(req.codeChallengeMethod, 's256'); assert.equal(req.skipHttpRedirect, true);
    const st = openState(t.config, c.cookie(SSO_COOKIE)); assert.ok(st, 'estado assinado pelo servidor'); assert.equal(challengeOf(st.verifier), req.codeChallenge);
    assert.ok(!loc.includes(st.verifier) && !r.text.includes(st.verifier), 'o verifier não sai do servidor');
    const au = await t.ops.asSystem((tx) => tx`select entity_id, meta from app.audit_log where action = 'auth.sso_start' order by id desc limit 1`); assert.equal(au[0].entity_id, 'am.test'); assert.deepEqual(au[0].meta, {});
  });
  test('?domain= e o nome antigo /api/auth/sso/start também iniciam', async () => {
    assert.equal((await start(t.anon(), { domain: 'AM.test' })).status, 302);
    const r = await t.anon().get('/api/auth/sso/start?email=x@am.test'); assert.equal(r.status, 302); assert.ok(r.headers.get('location').startsWith(t.fake.url));
  });
  test('entrada inválida → motivo=sso_email; domínio fora de SSO_DOMAINS → motivo=sso_dominio — sem chamar o GoTrue', async () => {
    const before_ = t.fake.state.ssoRequests.length;
    for (const q of [{}, { email: 'x' }, { email: 'a@am.test', domain: 'am.test' }, { domain: 'am' }, { domain: 'am.test/../x' }, { email: '' }]) assert.equal(motivo(await start(t.anon(), q)), 'sso_email', JSON.stringify(q));
    for (const q of [{ email: 'pessoa@gmail.com' }, { domain: 'gmail.com' }, { email: 'x@sub.am.test' }]) assert.equal(motivo(await start(t.anon(), q)), 'sso_dominio', JSON.stringify(q));
    assert.equal(t.fake.state.ssoRequests.length, before_);
  });
  test('provedor não cadastrado no Supabase ou GoTrue fora do ar → motivo=sso_indisponivel; o destino (next) volta junto à tela de entrada', async () => {
    assert.equal(motivo(await start(t.anon(), { email: 'x@sem-provedor.test' })), 'sso_indisponivel');
    t.fake.state.fail.sso = 503;
    try { const r = await start(t.anon(), { email: 'x@am.test', next: '/editor/abc' }); assert.equal(motivo(r), 'sso_indisponivel'); assert.equal(new URL(r.headers.get('location'), 'http://x').searchParams.get('next'), '/editor/abc'); }
    finally { t.fake.state.fail.sso = 0; }
  });
});

describe('retorno: GET /api/auth/sso/callback?code=', () => {
  test('conta EXISTENTE (senha) entra pelo SSO: mesma conta, papel e apresentações; identidade sso:<id> vinculada; 2ª vez resolve direto; renovar e sair funcionam', async () => {
    const u = await t.createUser({ displayName: 'Bia Existente' }); const cp = await t.as(u);
    const p = (await cp.post('/api/presentations', { title: 'Antes do SSO' })).json;
    assert.deepEqual(await identities(u.id), ['supabase'], 'o login por senha vinculou a identidade de e-mail');
    const c = t.anon(); const r = await ssoLogin(c, u.email, { next: '/editor/' + p.id });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/editor/' + p.id); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(c.cookie(t.names.at) && c.cookie(t.names.rt) && c.cookie(t.names.csrf), 'cookies de sessão e CSRF'); assert.equal(c.cookie(SSO_COOKIE), null, 'o cookie do fluxo é de uso único');
    const s = (await c.get('/api/auth/session')).json; assert.equal(s.authenticated, true); assert.equal(s.user.id, u.id); assert.equal(s.user.role, 'member'); assert.equal(s.needsPassword, false);
    assert.deepEqual(await identities(u.id), [`sso:${PID}`, 'supabase']);
    assert.ok((await c.get('/api/presentations?scope=mine')).json.items.some((x) => x.id === p.id), 'as apresentações continuam da mesma pessoa');
    assert.notEqual(ssoUserOf(u.email).id, t.fake.userByEmail(u.email).id, 'no GoTrue a conta SAML é OUTRA (como no Supabase); na plataforma é a mesma pessoa');
    const c2 = t.anon(); assert.equal((await ssoLogin(c2, u.email)).headers.get('location'), '/acervo'); assert.equal((await c2.get('/api/auth/session')).json.user.id, u.id);
    assert.deepEqual(await identities(u.id), [`sso:${PID}`, 'supabase'], 'nenhuma identidade nova na 2ª vez');
    c.jar.delete(t.names.at); const rf = await c.post('/api/auth/refresh'); assert.equal(rf.status, 200); assert.equal(rf.json.user.id, u.id);
    assert.equal((await c.post('/api/auth/logout')).status, 204); assert.equal((await c.get('/api/auth/session')).json.authenticated, false);
    assert.equal((await t.as(u, { fresh: true }).then((x) => x.get('/api/me'))).status, 200, 'a senha continua valendo (convivência)');
    const au = await t.ops.asSystem((tx) => tx`select actor_id, meta from app.audit_log where action = 'auth.login' and actor_id = ${u.id} order by id`);
    assert.ok(au.some((a) => a.meta.via === 'sso' && a.meta.provider === `sso:${PID}`));
    assert.ok(!JSON.stringify(await t.ops.asSystem((tx) => tx`select meta from app.audit_log where action like 'auth.%'`)).includes(u.email), 'e-mail em claro na auditoria');
  });
  test('admin entra pelo SSO e continua admin', async () => {
    const a = await t.createUser({ role: 'admin', displayName: 'Admin SSO' }); const c = t.anon();
    assert.equal((await ssoLogin(c, a.email)).status, 302); const s = (await c.get('/api/auth/session')).json; assert.equal(s.user.id, a.id); assert.equal(s.user.role, 'admin');
    assert.equal((await c.get('/api/admin/users')).status, 200);
  });
  test('convidado (nunca definiu senha) entra pelo SSO: convite aceito e conta ativa, sem pedir senha', async () => {
    const inv = await cAdm.post('/api/admin/invites', { email: 'nova.pessoa.sso@am.test', displayName: 'Nova Pessoa' }); assert.equal(inv.status, 201);
    const c = t.anon(); const r = await ssoLogin(c, 'nova.pessoa.sso@am.test'); assert.equal(r.headers.get('location'), '/acervo');
    const s = (await c.get('/api/auth/session')).json; assert.equal(s.user.status, 'active'); assert.equal(s.needsPassword, false);
    const [i] = await t.ops.asSystem((tx) => tx`select status, accepted_at from app.invites where email = 'nova.pessoa.sso@am.test'`); assert.equal(i.status, 'accepted'); assert.ok(i.accepted_at);
    assert.equal((await c.get('/api/presentations')).status, 200);
  });
  test('quem NÃO foi convidado não entra (nem pelo SSO): motivo=not_invited, nenhuma conta criada, sessão do GoTrue revogada, auditoria só com hash', async () => {
    const [{ n: n0 }] = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users`);
    const c = t.anon(); const r = await ssoLogin(c, 'nunca.convidada@am.test', { next: '/admin' });
    assert.equal(motivo(r), 'not_invited'); assert.equal(new URL(r.headers.get('location'), 'http://x').searchParams.get('next'), '/admin');
    assert.equal(c.cookie(t.names.at), null); assert.equal((await c.get('/api/auth/session')).json.authenticated, false);
    const [{ n: n1 }] = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users`); assert.equal(n1, n0, 'nenhuma conta criada');
    assert.equal((await t.ops.asSystem((tx) => tx`select count(*)::int n from app.user_identities where provider like 'sso:%' and email_at_link = 'nunca.convidada@am.test'`))[0].n, 0);
    assert.equal(t.fake.sessionsOf(ssoUserOf('nunca.convidada@am.test').id), 0, 'a sessão emitida pelo GoTrue foi revogada');
    const au = await t.ops.asSystem((tx) => tx`select meta from app.audit_log where action = 'auth.login_failed' order by id desc limit 1`);
    assert.deepEqual(au[0].meta, { email_hash: t.kit.hashEmail('nunca.convidada@am.test'), reason: 'not_invited', via: 'sso' });
  });
  test('suspenso não entra pelo SSO nem é reativado; sem identidade SSO ainda, o banco nem vincula (= not_invited); convite revogado idem', async () => {
    const u = await t.createUser({ displayName: 'Vai ser suspensa' }); assert.equal((await ssoLogin(t.anon(), u.email)).status, 302, 'entrou uma vez: identidade SSO vinculada');
    await t.ops.asSystem((tx) => tx`update app.users set status = 'suspended' where id = ${u.id}`); t.clearIdentityCache();
    const c = t.anon(); assert.equal(motivo(await ssoLogin(c, u.email)), 'suspended'); assert.equal(c.cookie(t.names.at), null);
    assert.equal((await t.ops.asSystem((tx) => tx`select status from app.users where id = ${u.id}`))[0].status, 'suspended', 'não foi reativada');
    const never = await t.createUser({ status: 'suspended', displayName: 'Suspensa sem SSO' });
    assert.equal(motivo(await ssoLogin(t.anon(), never.email)), 'not_invited', 'conta suspensa não ganha identidade nova (resolve_identity) — a resposta não diferencia');
    assert.deepEqual(await identities(never.id), []);
    const inv = await cAdm.post('/api/admin/invites', { email: 'revogada.sso@am.test', displayName: 'Revogada' }); assert.equal((await cAdm.del(`/api/admin/invites/${inv.json.id}`)).status, 204);
    assert.equal(motivo(await ssoLogin(t.anon(), 'revogada.sso@am.test')), 'not_invited', 'convite revogado = conta suspensa que nunca entrou');
  });
  test('o IdP recusou/a pessoa cancelou → motivo=sso_falhou, sem trocar código', async () => {
    const c = t.anon(); const s = await start(c, { email: 'x@am.test' });
    const ret = await atIdp(s.headers.get('location'), { cancel: '1' }); assert.equal(ret.searchParams.get('error'), 'access_denied');
    assert.equal(motivo(await back(c, ret)), 'sso_falhou'); assert.equal(c.cookie(SSO_COOKIE), null);
  });
  test('retorno sem o cookie do início (outro navegador), com cookie adulterado ou com código malformado → motivo=sso_expirou', async () => {
    const c = t.anon(); const s = await start(c, { email: 'x@am.test' }); const ret = await atIdp(s.headers.get('location'), { email: 'x@am.test' });
    assert.equal(motivo(await back(t.anon(), ret)), 'sso_expirou', 'sem cookie');
    const tampered = t.anon(); tampered.jar.set(SSO_COOKIE, c.cookie(SSO_COOKIE).replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a')));
    assert.equal(motivo(await back(tampered, ret)), 'sso_expirou', 'cookie adulterado');
    assert.equal(motivo(await c.get('/api/auth/sso/callback?code=' + encodeURIComponent('<script>'))), 'sso_expirou', 'código malformado');
    assert.equal(motivo(await t.anon().get('/api/auth/sso/callback')), 'sso_expirou');
  });
  test('suspender uma pessoa bloqueia no GoTrue TODAS as contas dela (a de senha e a do SSO)', async () => {
    const u = await t.createUser({ displayName: 'Duas contas' }); assert.equal((await ssoLogin(t.anon(), u.email)).status, 302);
    const pw = t.fake.userByEmail(u.email).id, sso = ssoUserOf(u.email).id; assert.notEqual(pw, sso);
    const r = await cAdm.patch(`/api/admin/users/${u.id}`, { status: 'suspended' }); assert.equal(r.status, 200); assert.equal(r.json.gotrueSync, true);
    assert.equal(t.fake.isBanned(pw), true); assert.equal(t.fake.isBanned(sso), true);
    assert.equal(motivo(await ssoLogin(t.anon(), u.email)), 'suspended', 'banido no GoTrue: a troca do código já é recusada');
    await cAdm.patch(`/api/admin/users/${u.id}`, { status: 'active' }); assert.equal(t.fake.isBanned(sso), false);
  });
});

describe('limites', () => {
  test('100 inícios por IP em 10 min; o 101º volta à tela de entrada com motivo=sso_limite (e é auditado)', async () => {
    await t.awayFromWindowEdge(600, 20000); await resetRates();
    const c = t.anon(); let last;
    for (let i = 0; i < 100; i++) { last = await start(c, { email: 'x@am.test' }); if (last.status !== 302 || !last.headers.get('location').startsWith(t.fake.url)) break; }
    assert.ok(last.headers.get('location').startsWith(t.fake.url), 'os 100 primeiros iniciam');
    assert.equal(motivo(await start(c, { email: 'x@am.test' })), 'sso_limite');
    assert.ok((await t.ops.asSystem((tx) => tx`select count(*)::int n from app.audit_log where action = 'security.rate_limited' and entity_id = 'sso_ip'`))[0].n >= 1);
    assert.equal((await start(t.anon(), { email: 'x@am.test' })).headers.get('location').startsWith(t.fake.url), true, 'outro IP segue');
    await resetRates();
  });
});
