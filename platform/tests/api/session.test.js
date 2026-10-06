/* Middleware de sessão: cookie → JWT → usuário do banco; estados (sem convite, convidado, suspenso), cache de ≤ 15 s e falhas. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';

let t, ana, bia;
before(async () => { t = await boot(); ana = await t.createUser({ displayName: 'Ana' }); bia = await t.createUser({ displayName: 'Bia' }); });
after(async () => { await t.stop(); });

const bearerOf = async (email, password) => {   // pega tokens direto no GoTrue falso (como se um token válido vazasse para um não convidado)
  const r = await fetch(`${t.fake.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: t.fake.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return r.json();
};

test('sem cookie: rota protegida → 401 unauthenticated; rotas públicas funcionam', async () => {
  const c = t.anon();
  const r = await c.get('/api/me'); assert.deepEqual([r.status, r.json.error.code], [401, 'unauthenticated']); assert.ok(r.json.error.requestId);
  assert.equal((await c.get('/api/health')).status, 200);
  assert.equal((await c.get('/api/auth/session')).json.authenticated, false);
});
test('cada cliente enxerga SOMENTE a própria identidade', async () => {
  const [a, b] = [await t.as(ana), await t.as(bia)];
  assert.equal((await a.get('/api/me')).json.id, ana.id); assert.equal((await b.get('/api/me')).json.id, bia.id);
  // trocar o cookie de acesso de um pelo do outro é trocar de identidade inteira (não há como misturar)
  const mix = t.anon(); mix.jar.set(t.names.at, b.cookie(t.names.at)); assert.equal((await mix.get('/api/me')).json.id, bia.id);
});
test('token válido de quem não foi convidado: 403 not_invited em tudo; /session diz authenticated:false', async () => {
  t.fake.addUser({ email: 'fora.da.lista@am.test', password: 'Senha-Longa-Fora-Lista-1!' });
  const tok = await bearerOf('fora.da.lista@am.test', 'Senha-Longa-Fora-Lista-1!'); assert.ok(tok.access_token);
  const c = t.anon(); c.jar.set(t.names.at, tok.access_token);
  for (const p of ['/api/me', '/api/admin/users']) { const r = await c.get(p); assert.deepEqual([r.status, r.json.error.code], [403, 'not_invited'], p); }
  const s = await c.get('/api/auth/session'); assert.equal(s.json.authenticated, false); assert.equal(s.json.reason, 'not_invited');
  assert.ok(s.setCookies.some((x) => x.name === t.names.at && x.attrs['max-age'] === '0'), 'cookie inútil é apagado');
  assert.equal((await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users where email = 'fora.da.lista@am.test'`))[0].n, 0, 'nenhum usuário foi criado');
});
test('autocadastro é impossível: nenhuma rota cria usuário a partir de um token válido', async () => {
  const before = (await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users`))[0].n;
  t.fake.addUser({ email: 'tentativa@am.test', password: 'Senha-Longa-Tentativa-1!' });
  const c = t.anon(); await c.login('tentativa@am.test', 'Senha-Longa-Tentativa-1!');
  const tok = await bearerOf('tentativa@am.test', 'Senha-Longa-Tentativa-1!'); c.jar.set(t.names.at, tok.access_token); c.jar.set(t.names.rt, tok.refresh_token);
  await c.get('/api/me'); await c.post('/api/auth/refresh'); await c.get('/api/auth/session'); await c.post('/api/auth/password', { password: 'Outra-Senha-Longa-77!' });
  assert.equal((await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users`))[0].n, before);
});
test('convidado que ainda não definiu a senha só alcança /api/auth/*', async () => {
  const email = 'convidada.sessao@am.test'; const adm = await t.createUser({ role: 'admin' }); const ac = await t.as(adm);
  await ac.post('/api/admin/invites', { email, displayName: 'Convidada' });
  const c = t.anon(); await c.ensureCsrf(); await c.post('/api/auth/verify', { tokenHash: t.fake.outbox(email).at(-1).token_hash, type: 'invite' });
  for (const p of ['/api/me', '/api/admin/users', '/api/presentations']) { const r = await c.get(p); assert.equal(r.status, 403, p); }
  assert.equal((await c.get('/api/auth/session')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 204);
});
test('cache de identidade: vale até o TTL; limpar o cache aplica a suspensão na hora; TTL ≤ 15 s', async () => {
  assert.ok(t.kit.cache.ttl <= 15_000);
  const u = await t.createUser(); const c = await t.as(u, { fresh: true });
  assert.equal((await c.get('/api/me')).status, 200);
  await t.ops.asSystem((tx) => tx`update app.users set status = 'suspended' where id = ${u.id}`);
  assert.equal((await c.get('/api/me')).status, 200, 'dentro do TTL a decisão em cache ainda vale (limite de 15 s)');
  t.clearIdentityCache();
  const r = await c.get('/api/me'); assert.deepEqual([r.status, r.json.error.code], [403, 'suspended']);
});
test('o TTL realmente expira o cache (sem limpar manualmente)', async () => {
  const u = await t.createUser(); const c = await t.as(u, { fresh: true }); const old = t.kit.cache.ttl; t.kit.cache.ttl = 120;
  try {
    t.clearIdentityCache(); assert.equal((await c.get('/api/me')).status, 200);
    await t.ops.asSystem((tx) => tx`update app.users set role = 'admin' where id = ${u.id}`);
    assert.equal((await c.get('/api/admin/stats')).status, 403, 'ainda em cache como membro');
    await new Promise((r) => setTimeout(r, 160));
    assert.equal((await c.get('/api/admin/stats')).status, 200, 'cache expirou: papel novo vale');
  } finally { t.kit.cache.ttl = old; }
});
test('rebaixar admin vale em ≤ TTL e o papel NUNCA vem do cliente', async () => {
  const u = await t.createUser({ role: 'admin' }); const c = await t.as(u, { fresh: true });
  assert.equal((await c.get('/api/admin/stats')).status, 200);
  await t.ops.asSystem((tx) => tx`update app.users set role = 'member' where id = ${u.id}`); t.clearIdentityCache();
  assert.equal((await c.get('/api/admin/stats')).status, 403);
});
test('banco fora do ar durante a resolução da identidade → 503 (não 500, sem vazar detalhe)', async () => {
  const u = await t.createUser(); const c = await t.as(u, { fresh: true }); t.clearIdentityCache();
  const orig = t.kit.resolve; t.kit.resolve = async () => { const { E } = await import('../../src/lib/errors.js'); throw E.unavailable(); };
  try { const r = await c.get('/api/me'); assert.deepEqual([r.status, r.json.error.code], [503, 'unavailable']); } finally { t.kit.resolve = orig; }
});
test('GoTrue fora do ar NÃO derruba quem já tem access token válido (a verificação é local)', async () => {
  const u = await t.createUser(); const c = await t.as(u, { fresh: true });
  t.fake.state.fail.refresh = 500; t.fake.state.fail.login = 500; t.fake.state.fail.admin = 500;
  try { assert.equal((await c.get('/api/me')).status, 200); } finally { t.fake.state.fail.refresh = 0; t.fake.state.fail.login = 0; t.fake.state.fail.admin = 0; }
});
test('/api/ready e /api/health respondem sem sessão e sem vazar detalhes', async () => {
  const c = t.anon();
  const ok = await c.get('/api/ready'); assert.equal(ok.status, 200, ok.text); assert.deepEqual(ok.json, { db: true, storage: true, auth: true, migrations: true });
  const h = await c.get('/api/health'); assert.deepEqual([h.status, h.json.ok, h.json.env], [200, true, 'test']); assert.ok(h.json.version);
  assert.ok(!/error|stack|password|postgres:\/\//i.test(ok.text));
});
test('/api/ready: 503 se QUALQUER dependência cair (só booleanos); resultado em cache por 5 s; /health independe de tudo', async () => {
  const { Hono } = await import('hono'); const { healthRoutes } = await import('../../src/routes/health.js');
  const mk = (over) => { const calls = { db: 0 }; const deps = { config: t.config, logger: { warn() {}, info() {}, error() {} },
    db: { ping: async () => { calls.db++; return true; }, anon: async (fn) => fn(() => [{ ok: true }]), ...over.db }, storage: { ping: async () => true, ...over.storage }, gotrue: { health: async () => true, ...over.gotrue } };
    const app = new Hono(); app.use('*', async (c, next) => { c.set('requestId', 'r'); await next(); }); app.route('/api', healthRoutes(deps)); return { app, calls }; };
  const cases = [
    [{ db: { ping: async () => { throw new Error('postgres://u:senha@h/db'); } } }, 'db'], [{ storage: { ping: async () => false } }, 'storage'], [{ gotrue: { health: async () => false } }, 'auth'],
    [{ db: { anon: async () => [{ ok: false }] } }, 'migrations'],
  ];
  for (const [over, failing] of cases) {
    const { app } = mk(over); const r = await app.request('/api/ready'); const j = await r.json();
    assert.equal(r.status, 503, failing); assert.equal(j[failing], false); assert.deepEqual(Object.keys(j).sort(), ['auth', 'db', 'migrations', 'storage']); assert.ok(!JSON.stringify(j).includes('senha'));
    assert.equal((await app.request('/api/health')).status, 200);
  }
  const { app, calls } = mk({}); await app.request('/api/ready'); await app.request('/api/ready'); await app.request('/api/ready'); assert.equal(calls.db, 1, 'sonda repetida usa o cache de 5 s');
});
