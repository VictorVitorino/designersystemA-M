/* tests/security/sso.test.js — revisão OFENSIVA do login corporativo (SSO SAML com PKCE, F10). Cada teste é um ATAQUE; vermelho = achado.
   API inteira em memória (boot) + GoTrue falso com IdP falso (o teste é o navegador da vítima e o do atacante). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';
import { ssoCookieName } from '../../src/auth/cookies.js';
import { sealState, pkcePair } from '../../src/auth/sso.js';

let t, PID, V, SSO_COOKIE;
before(async () => {
  t = await boot({ env: { SSO_ENABLED: 'true', SSO_DOMAINS: 'am.test' } }); SSO_COOKIE = ssoCookieName(t.config);
  PID = t.fake.addSsoProvider('am.test'); t.fake.addSsoProvider('outra.test');
  V = await t.createUser({ displayName: 'Vítima' });
});
after(async () => { await t.stop(); });

const start = (c, q) => c.get('/api/auth/sso?' + new URLSearchParams(q).toString());
async function atIdp(location, params) { const u = new URL(location); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); const r = await fetch(u, { redirect: 'manual' }); return new URL(r.headers.get('location')); }
const back = (c, url) => c.get(url.pathname + url.search);
const motivo = (r) => { assert.equal(r.status, 302, r.text); const u = new URL(r.headers.get('location'), 'http://x'); assert.equal(u.pathname, '/entrar', r.headers.get('location')); return u.searchParams.get('motivo'); };
const ssoIds = async (userId) => (await t.ops.asSystem((tx) => tx`select provider from app.user_identities where user_id = ${userId} and provider like 'sso:%'`)).length;

describe('fixação de sessão e login CSRF', () => {
  test('o código do ATACANTE no navegador da vítima não vira sessão (falta o verifier dele): nem com o cookie de outro fluxo da vítima, nem sem cookie', async () => {
    const attacker = await t.createUser({ displayName: 'Atacante' });
    const ca = t.anon(); const sa = await start(ca, { email: attacker.email }); const ret = await atIdp(sa.headers.get('location'), { email: attacker.email });   // código do atacante, que ele NÃO troca
    const victim = t.anon(); await start(victim, { email: V.email });                                     // a vítima tem o próprio fluxo em andamento (outro verifier)
    assert.equal(motivo(await back(victim, ret)), 'sso_expirou');
    assert.equal(victim.cookie(t.names.at), null); assert.equal((await victim.get('/api/auth/session')).json.authenticated, false, 'a vítima não ficou logada como o atacante');
    assert.equal(motivo(await back(t.anon(), ret)), 'sso_expirou', 'sem cookie do fluxo: nem tenta');
  });
  test('reenvio (replay) do mesmo código com o mesmo cookie depois do login → sso_expirou (o código e o fluxo são de uso único)', async () => {
    const c = t.anon(); const s = await start(c, { email: V.email }); const ret = await atIdp(s.headers.get('location'), { email: V.email }); const kept = c.cookie(SSO_COOKIE);
    assert.equal((await back(c, ret)).headers.get('location'), '/acervo');
    const thief = t.anon(); thief.jar.set(SSO_COOKIE, kept);
    assert.equal(motivo(await back(thief, ret)), 'sso_expirou'); assert.equal(thief.cookie(t.names.at), null);
  });
  test('cookie de fluxo forjado com outro segredo ou vencido não serve', async () => {
    const c = t.anon(); const s = await start(c, { email: V.email }); const ret = await atIdp(s.headers.get('location'), { email: V.email });
    const forged = t.anon(); forged.jar.set(SSO_COOKIE, sealState({ csrfSecret: 'segredo-do-atacante-'.repeat(3) }, { verifier: pkcePair().verifier, next: '/acervo' }));
    assert.equal(motivo(await back(forged, ret)), 'sso_expirou');
    const old = t.anon(); old.jar.set(SSO_COOKIE, sealState(t.config, { verifier: pkcePair().verifier, next: '/acervo', now: Date.now() - 11 * 60_000 }));
    assert.equal(motivo(await back(old, ret)), 'sso_expirou');
  });
});

describe('tomada de conta pelo IdP', () => {
  test('IdP que afirma e-mail de OUTRO domínio (fora de SSO_DOMAINS) não vincula nem entra na conta existente desse e-mail', async () => {
    const other = await t.createUser({ email: 'diretoria@outra.test', displayName: 'Conta de outro domínio' });
    const c = t.anon(); const s = await start(c, { email: 'qualquer@am.test' });
    assert.equal(motivo(await back(c, await atIdp(s.headers.get('location'), { email: 'diretoria@outra.test' }))), 'sso_dominio');
    assert.equal(c.cookie(t.names.at), null); assert.equal(await ssoIds(other.id), 0, 'nenhuma identidade SSO vinculada');
    assert.equal(motivo(await start(t.anon(), { email: 'diretoria@outra.test' })), 'sso_dominio', 'e nem inicia pelo domínio não habilitado');
  });
  test('IdP que não afirma e-mail verificado não vincula conta por e-mail', async () => {
    const u = await t.createUser({ displayName: 'Sem verificação' }); const c = t.anon(); const s = await start(c, { email: u.email });
    assert.equal(motivo(await back(c, await atIdp(s.headers.get('location'), { email: u.email, verified: '0', sub: 'nameid-nao-verificado' }))), 'sso_falhou');
    assert.equal(await ssoIds(u.id), 0); assert.equal(c.cookie(t.names.at), null);
  });
  test('identidade SSO já vinculada não é sequestrada: outro NameID com o mesmo e-mail vincula à MESMA pessoa (nunca cria conta), e o e-mail do token não troca a conta', async () => {
    const u = await t.createUser({ displayName: 'Dona' }); const c1 = t.anon(); const s1 = await start(c1, { email: u.email });
    await back(c1, await atIdp(s1.headers.get('location'), { email: u.email, sub: 'nameid-1' })); assert.equal((await c1.get('/api/auth/session')).json.user.id, u.id);
    const c2 = t.anon(); const s2 = await start(c2, { email: u.email }); await back(c2, await atIdp(s2.headers.get('location'), { email: u.email, sub: 'nameid-2' }));
    assert.equal((await c2.get('/api/auth/session')).json.user.id, u.id);
    const [{ n }] = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users where email = ${u.email}`); assert.equal(n, 1);
  });
});

describe('redirecionamento aberto e eco', () => {
  test('next só leva a caminho interno — o 302 final nunca aponta para outra origem', async () => {
    for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/./..//evil.example', '/entrar', '/api/admin/users', '%2F%2Fevil.example']) {
      const c = t.anon(); const s = await start(c, { email: V.email, next }); const r = await back(c, await atIdp(s.headers.get('location'), { email: V.email }));
      assert.equal(r.status, 302); const loc = r.headers.get('location'); assert.equal(loc, '/acervo', `${next} → ${loc}`);
    }
    const c = t.anon(); const s = await start(c, { email: V.email, next: '/editor/123?slide=2' }); assert.equal((await back(c, await atIdp(s.headers.get('location'), { email: V.email }))).headers.get('location'), '/editor/123?slide=2');
    const err = await start(t.anon(), { email: 'x@gmail.com', next: '//evil.example' }); const u = new URL(err.headers.get('location'), 'http://x'); assert.equal(u.pathname, '/entrar'); assert.equal(u.searchParams.get('next'), null);
  });
  test('erro do IdP com HTML na descrição não é ecoado; o redirect de erro só leva códigos fixos', async () => {
    const r = await t.anon().get('/api/auth/sso/callback?error=access_denied&error_description=' + encodeURIComponent('<script>alert(1)</script>'));
    assert.equal(motivo(r), 'sso_falhou'); assert.ok(!r.headers.get('location').includes('script') && !r.text.includes('<script'));
  });
  test('o retorno é só GET: POST/PUT nas rotas do SSO não existem (e o CSRF barra antes)', async () => {
    const c = t.anon(); await c.ensureCsrf();
    for (const m of ['POST', 'PUT', 'DELETE']) { const r = await c.request(m, '/api/auth/sso/callback?code=abcdefgh'); assert.ok([403, 404, 405].includes(r.status), `${m} → ${r.status}`); }
  });
});

describe('cookie do fluxo', () => {
  test('em HTTPS (staging/produção): __Host-am_sso com Secure, HttpOnly, SameSite=Lax, Path=/, sem Domain, 10 min; apagar = Max-Age=0', async () => {
    const { loadConfig } = await import('../../src/config.js'); const { Hono } = await import('hono'); const { setSsoCookie } = await import('../../src/auth/cookies.js');
    const cfg = loadConfig({ APP_ENV: 'production', APP_ORIGIN: 'https://canteiro.exemplo.com.br', DATABASE_URL: 'postgres://x', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: 'anon-key-0123456789', SUPABASE_SERVICE_ROLE_KEY: 'service-key-0123456789',
      SUPABASE_JWKS_URL: 'https://a.supabase.co/auth/v1/.well-known/jwks.json', CSRF_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', SSO_ENABLED: 'true', SSO_DOMAINS: 'alvarezandmarsal.com' });
    assert.equal(ssoCookieName(cfg), '__Host-am_sso');
    const a = new Hono(); a.get('/s', (c) => { setSsoCookie(c, cfg, 'valor.assinado'); return c.text('ok'); }); a.get('/x', (c) => { setSsoCookie(c, cfg, ''); return c.text('ok'); });
    const [line] = (await a.request('/s')).headers.getSetCookie();
    assert.match(line, /^__Host-am_sso=valor\.assinado;/); for (const re of [/; Secure/, /; HttpOnly/, /; Path=\//, /SameSite=Lax/, /Max-Age=600/]) assert.match(line, re); assert.doesNotMatch(line, /Domain=/i);
    const [gone] = (await a.request('/x')).headers.getSetCookie(); assert.match(gone, /^__Host-am_sso=;/); assert.match(gone, /Max-Age=0/);
  });
});

describe('segredos', () => {
  test('nem o verifier, nem o código, nem tokens aparecem na auditoria; o verifier nunca vai ao GoTrue no início', async () => {
    const c = t.anon(); const s = await start(c, { email: V.email }); const raw = c.cookie(SSO_COOKIE); const ret = await atIdp(s.headers.get('location'), { email: V.email });
    await back(c, ret);
    const text = JSON.stringify(await t.ops.asSystem((tx) => tx`select * from app.audit_log`));
    assert.ok(!text.includes(ret.searchParams.get('code')) && !text.includes(raw.split('.')[0]), 'código/estado na auditoria'); assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.eyJ/);
    for (const req of t.fake.state.ssoRequests) assert.ok(!('code_verifier' in req) && !req.keys.includes('code_verifier'));
  });
});
