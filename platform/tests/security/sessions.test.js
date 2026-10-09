/* Sessões: flags dos cookies, adulteração, tokens fora do corpo (varredura de TODAS as respostas), auditoria sem segredos, sessionOverride só em teste. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { boot } from '../helpers/boot.js';
import { loadConfig } from '../../src/config.js';
import { setSessionCookies, setCsrfCookie, clearSessionCookies, setNeedsPasswordCookie, cookieNames, RT_MAX_AGE_S } from '../../src/auth/cookies.js';

let t;
const recorded = [];   // todas as respostas de todos os clientes, para a varredura final
before(async () => {
  t = await boot();
  const orig = t.makeClient;
  t.makeClient = (o) => { const c = orig(o); const req = c.request; c.request = async (...a) => { const r = await req(...a); recorded.push({ req: a.slice(0, 2).join(' '), res: r, client: c }); return r; }; return c; };
  t.anon = (o) => t.makeClient(o);
});
after(async () => { await t.stop(); });

describe('cookies', () => {
  test('flags do access/refresh/csrf em HTTP local (sem prefixo e sem Secure)', async () => {
    const u = await t.createUser(); const c = t.anon(); const r = await c.login(u.email, u.password);
    const by = Object.fromEntries(r.setCookies.map((x) => [x.name, x]));
    assert.deepEqual(Object.keys(by).sort(), ['am_at', 'am_csrf', 'am_np', 'am_rt']);
    assert.equal(by.am_np.attrs['max-age'], '0', 'o marcador "precisa definir senha" é apagado no login');
    for (const n of ['am_at', 'am_rt']) { assert.ok(by[n].attrs.httponly, n + ' HttpOnly'); assert.equal(by[n].attrs.samesite, 'Lax'); assert.equal(by[n].attrs.path, '/'); assert.equal('domain' in by[n].attrs, false, 'sem Domain'); }
    assert.ok(!by.am_csrf.attrs.httponly); assert.equal(by.am_csrf.attrs.samesite, 'Lax');
    assert.equal(Number(by.am_rt.attrs['max-age']), RT_MAX_AGE_S); assert.equal(RT_MAX_AGE_S, 30 * 24 * 3600);
    const age = Number(by.am_at.attrs['max-age']); assert.ok(age > 60 && age <= 3600, String(age));
    assert.ok(!('secure' in by.am_at.attrs), 'Secure só com HTTPS');
  });
  test('em HTTPS (staging/produção): __Host-, Secure, Path=/, sem Domain, HttpOnly onde deve', async () => {
    const cfg = loadConfig({ APP_ENV: 'production', APP_ORIGIN: 'https://canteiro.exemplo.com.br', DATABASE_URL: 'postgres://x', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: 'anon-key-0123456789', SUPABASE_SERVICE_ROLE_KEY: 'service-key-0123456789',
      SUPABASE_JWKS_URL: 'https://a.supabase.co/auth/v1/.well-known/jwks.json', CSRF_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' });
    const a = new Hono(); a.get('/s', (c) => { setSessionCookies(c, cfg, { accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600 }); setCsrfCookie(c, cfg, 'C'.repeat(43)); setNeedsPasswordCookie(c, cfg, true); return c.text('ok'); });
    a.get('/x', (c) => { clearSessionCookies(c, cfg, { csrf: true }); return c.text('ok'); });
    const sc = (await a.request('/s')).headers.getSetCookie(); const names = cookieNames(cfg);
    assert.deepEqual(names, { at: '__Host-am_at', rt: '__Host-am_rt', csrf: '__Host-am_csrf', np: '__Host-am_np' });
    assert.equal(sc.length, 4);
    for (const line of sc) { assert.match(line, /^__Host-am_/); assert.match(line, /; Secure/); assert.match(line, /; Path=\//); assert.doesNotMatch(line, /Domain=/i); assert.match(line, /SameSite=Lax/); }
    for (const n of ['at', 'rt', 'np']) assert.match(sc.find((l) => l.startsWith(names[n] + '=')), /HttpOnly/);
    assert.doesNotMatch(sc.find((l) => l.startsWith(names.csrf + '=')), /HttpOnly/);
    const cleared = (await a.request('/x')).headers.getSetCookie(); assert.equal(cleared.length, 4); for (const l of cleared) { assert.match(l, /Max-Age=0/); assert.match(l, /Secure/); }
  });
  test('os cookies de sessão nunca são lidos de outros lugares (cabeçalho Authorization não autentica)', async () => {
    const u = await t.createUser(); const c = t.anon(); await c.login(u.email, u.password);
    const bare = t.anon(); const r = await bare.get('/api/me', { headers: { authorization: `Bearer ${c.cookie('am_at')}` } }); assert.equal(r.status, 401);
    const q = await bare.get('/api/me?access_token=' + c.cookie('am_at')); assert.equal(q.status, 401);
  });
});

describe('adulteração', () => {
  const sess = async () => { const u = await t.createUser(); const c = t.anon(); await c.login(u.email, u.password); return { u, c, at: c.cookie('am_at') }; };
  test('assinatura alterada, payload alterado, truncado, vazio e lixo → 401 (nunca 500)', async () => {
    const { at } = await sess(); const [h, p, s] = at.split('.');
    const flip = (x) => x.slice(0, -2) + (x.slice(-2) === 'AA' ? 'BB' : 'AA');
    const payload = JSON.parse(Buffer.from(p, 'base64url')); payload.sub = '00000000-0000-4000-8000-000000000000'; payload.email = 'admin@am.test';
    const variants = [`${h}.${p}.${flip(s)}`, `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`, at.slice(0, -10), `${h}.${p}.`, at + 'x', 'a.b.c', '...', 'x'.repeat(10), at.replace(/\./g, '..')];
    for (const v of variants) { const c = t.anon(); c.jar.set('am_at', v); const r = await c.get('/api/me'); assert.equal(r.status, 401, v.slice(0, 30)); assert.equal(r.json.error.code, 'unauthenticated'); }
  });
  test('alg none e troca de algoritmo → 401', async () => {
    const { u, at } = await sess(); const claims = JSON.parse(Buffer.from(at.split('.')[1], 'base64url'));
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    const hs = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(JSON.stringify(t.fake.publicJwk)));
    for (const v of [none, hs]) { const c = t.anon(); c.jar.set('am_at', v); assert.equal((await c.get('/api/me')).status, 401); assert.equal((await c.get('/api/admin/users')).status, 401); }
    assert.ok(u);
  });
  test('JWT de outro emissor/audiência, mesmo bem assinado pela chave do provedor → 401', async () => {
    const { u } = await sess(); const sub = t.fake.userByEmail(u.email).id;
    for (const over of [{ iss: 'https://outro.supabase.co/auth/v1' }, { aud: 'service' }, { role: 'service_role' }]) {
      const tok = await t.fake.mintToken({ sub, email: u.email, session_id: 'x', ...over }); const c = t.anon(); c.jar.set('am_at', tok); assert.equal((await c.get('/api/me')).status, 401, JSON.stringify(over));
    }
  });
  test('token de um usuário com e-mail de outro: vale o `sub` vinculado, não o e-mail do token', async () => {
    const a = await t.createUser(), b = await t.createUser(); const ca = t.anon(); await ca.login(a.email, a.password); const cb = t.anon(); await cb.login(b.email, b.password);
    const tok = await t.fake.mintToken({ sub: t.fake.userByEmail(a.email).id, email: b.email, session_id: 'x' });   // sub de A, e-mail de B
    const c = t.anon(); c.jar.set('am_at', tok); const me = await c.get('/api/me'); assert.equal(me.json.id, a.id, 'identidade vem do vínculo sub→usuário');
  });
  test('o refresh token adulterado/inventado não renova nada', async () => {
    const c = t.anon(); await c.ensureCsrf(); for (const rt of ['inventado', 'x'.repeat(5000), '../../etc', "'; drop table app.users;--"]) { c.jar.set('am_rt', rt); const r = await c.post('/api/auth/refresh'); assert.equal(r.status, 401, rt.slice(0, 10)); assert.equal(r.json.error.code, 'session_expired'); }
  });
});

describe('segredos', () => {
  test('VARREDURA: nenhuma resposta (de todos os testes desta suíte) traz access/refresh token ou senha', async () => {
    const u = await t.createUser(); const adm = await t.createUser({ role: 'admin' }); const ac = await t.as(adm, { fresh: true });
    const c = t.anon(); await c.login(u.email, u.password); await c.get('/api/auth/session'); await c.post('/api/auth/refresh'); await c.get('/api/me'); await c.patch('/api/me', { displayName: 'Nome Novo' });
    await ac.post('/api/admin/invites', { email: 'varredura@am.test', displayName: 'Varredura' }); await ac.get('/api/admin/users'); await ac.get('/api/admin/audit'); await ac.get('/api/admin/settings'); await ac.get('/api/admin/stats');
    const v = t.anon(); await v.ensureCsrf(); await v.post('/api/auth/verify', { tokenHash: t.fake.outbox('varredura@am.test').at(-1).token_hash, type: 'invite' }); await v.post('/api/auth/password', { password: 'Varredura-Senha-Forte-Longa-1!' });
    await c.post('/api/auth/logout'); await t.anon().login(u.email, 'errada-errada-12'); await t.anon().request('POST', '/api/auth/forgot', { json: { email: u.email } });
    // coleta todos os valores sensíveis que existiram nos jars
    const secrets = new Set([u.password, 'Varredura-Senha-Forte-Longa-1!', t.DEFAULT_PASSWORD, t.fake.anonKey, t.fake.serviceKey, t.fake.jwtSecret]);
    for (const rec of recorded) for (const n of ['am_at', 'am_rt']) { const val = rec.client.cookie(n); if (val) secrets.add(val); }
    for (const m of t.fake.outbox()) secrets.add(m.token_hash);
    assert.ok(recorded.length > 25 && secrets.size > 8, `varredura cobre ${recorded.length} respostas e ${secrets.size} segredos`);
    for (const { req, res } of recorded) {
      for (const s of secrets) assert.ok(!res.text.includes(s), `${req} (${res.status}) devolveu um segredo`);
      assert.doesNotMatch(res.text, /"(access_token|refresh_token|token_hash|password|senha)"\s*:/i, req);
      assert.doesNotMatch(res.text, /eyJ[A-Za-z0-9_-]{10,}\.eyJ/, `${req}: parece um JWT`);
      for (const [k, val] of res.headers) { if (k === 'set-cookie') continue; for (const s of secrets) assert.ok(!String(val).includes(s), `${req}: cabeçalho ${k}`); }
    }
  });
  test('auditoria inteira: sem senha, token, JWT nem e-mail de login/forgot em claro; falhas guardam só o HMAC', async () => {
    await t.anon().login('vitima.audit@am.test', 'SenhaDigitadaErrada-123!'); const fc = t.anon(); await fc.ensureCsrf(); await fc.post('/api/auth/forgot', { email: 'vitima.audit@am.test' });
    const text = JSON.stringify(await t.ops.asSystem((tx) => tx`select * from app.audit_log`));
    for (const needle of ['SenhaDigitadaErrada', 'vitima.audit@am.test', 'Varredura-Senha-Forte', t.DEFAULT_PASSWORD, ...t.fake.outbox().map((m) => m.token_hash)]) assert.ok(!text.includes(needle), needle);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.eyJ/); assert.doesNotMatch(text, /access_token|refresh_token|Bearer /i);
    const rows = await t.ops.asSystem((tx) => tx`select action, meta from app.audit_log where meta->>'email_hash' = ${t.kit.hashEmail('vitima.audit@am.test')}`);
    assert.deepEqual(rows.map((r) => r.action).sort(), ['auth.forgot', 'auth.login_failed']);
    assert.notEqual(t.kit.hashEmail('a@b.co'), (await import('node:crypto')).createHash('sha256').update('a@b.co').digest('hex').slice(0, 32), 'HMAC com pimenta, não SHA-256 puro');
    assert.equal(t.kit.hashEmail(' A@B.co '), t.kit.hashEmail('a@b.co'));
    const { emailHash } = await import('../../src/auth/hash.js');
    assert.notEqual(emailHash({ csrfSecret: 'a'.repeat(40) }, 'x@y.co'), emailHash({ csrfSecret: 'b'.repeat(40) }, 'x@y.co'), 'o hash depende do segredo do servidor');
    assert.notEqual(emailHash({ csrfSecret: 'a'.repeat(40) }, 'x@y.co'), emailHash({ csrfSecret: '' }, 'x@y.co'));
  });
  test('o SQL de auditoria/limite nunca recebe valores do cliente concatenados (nomes dos baldes vêm de constantes)', async () => {
    const rows = await t.ops.asSystem((tx) => tx`select distinct bucket from app.rate_limits`);
    assert.ok(rows.every((r) => /^[a-z_]+$/.test(r.bucket)), JSON.stringify(rows));
  });
});

test('fixture libera GoTrue e Postgres quando staging recusa endpoints HTTP antes da API', async () => {
  // O segredo aqui é o fechamento dos recursos abertos pela fixture no caminho de erro:
  // se o GoTrue/DB continuarem ativos, o runner não terminará após os testes.
  await assert.rejects(
    () => boot({ env: { APP_ENV: 'staging', APP_ORIGIN: 'https://canteiro.example.invalid' } }),
    /SUPABASE_URL precisa ser https:|SUPABASE_JWKS_URL precisa ser https:/,
  );
});

describe('sessionOverride (atalho de teste)', () => {
  test('é aceito em APP_ENV=test (injeta o usuário) e RECUSADO em qualquer outro ambiente', async () => {
    const user = { id: '11111111-1111-4111-8111-111111111111', email: 'x@am.test', displayName: 'Injetado', role: 'member', status: 'active' };
    const ok = await boot({ deps: { sessionOverride: async (c, next) => { c.set('user', user); await next(); } } });
    try { const c = ok.anon(); const r = await c.get('/api/me'); assert.equal(r.status, 200); assert.equal(r.json.displayName, 'Injetado'); } finally { await ok.stop(); }
    for (const env of ['local', 'staging', 'production']) {
      // Para validar o veto ao sessionOverride, a fixture de staging/produção
      // precisa ser HTTPS de ponta a ponta; o GoTrue falso do teste usa HTTP
      // local e deve ser sobrescrito por endpoints fictícios seguros.
      const extra = env === 'local' ? {} : {
        APP_ORIGIN: 'https://canteiro.exemplo.com.br',
        SUPABASE_URL: 'https://auth.example.invalid',
        SUPABASE_JWKS_URL: 'https://auth.example.invalid/auth/v1/.well-known/jwks.json',
        S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      };
      await assert.rejects(() => boot({ env: { APP_ENV: env, ...extra, ...(env === 'production' ? { STORAGE_DRIVER: 's3' } : {}), ...(env === 'staging' ? { STORAGE_DRIVER: 's3' } : {}) }, deps: { sessionOverride: async (c, next) => next() } }), /sessionOverride só é permitido em APP_ENV=test/, env);
    }
  });
});
