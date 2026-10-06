/* Tentativas abusivas: limites de login (e-mail+IP e IP) e de "esqueci a senha" (IP e e-mail), aplicados ANTES de qualquer chamada ao GoTrue. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';

let t, u;
before(async () => { t = await boot(); u = await t.createUser(); });
after(async () => { await t.stop(); });

const tokenCalls = () => t.fake.calls.filter((x) => x.path === '/auth/v1/token').length;
const attempt = async (c, email, password = 'senha-errada-qualquer-9') => { await c.ensureCsrf(); return c.request('POST', '/api/auth/login', { json: { email, password } }); };

test('login: 8 tentativas por e-mail+IP em 10 min; a 9ª → 429 com Retry-After, SEM chamar o GoTrue', async () => {
  const c = t.anon(); await c.ensureCsrf();
  for (let i = 1; i <= 8; i++) { const r = await attempt(c, u.email); assert.equal(r.status, 401, `tentativa ${i}`); }
  const n = tokenCalls();
  const r = await attempt(c, u.email); assert.equal(r.status, 429); assert.equal(r.json.error.code, 'rate_limited');
  assert.ok(Number(r.headers.get('retry-after')) > 0 && Number(r.headers.get('retry-after')) <= 600);
  assert.equal(tokenCalls(), n, 'o GoTrue não foi chamado depois do bloqueio');
  // mesmo a senha CERTA fica barrada enquanto o limite estiver estourado (não há "tentativa bônus")
  assert.equal((await attempt(c, u.email, u.password)).status, 429);
});
test('o limite por e-mail+IP não pune outro IP nem outro e-mail', async () => {
  const blocked = t.anon(); for (let i = 0; i < 9; i++) await attempt(blocked, 'alvo@am.test');
  assert.equal((await attempt(blocked, 'alvo@am.test')).status, 429);
  assert.equal((await attempt(t.anon(), 'alvo@am.test')).status, 401, 'outro IP, mesmo e-mail');
  assert.equal((await attempt(blocked, 'outro-alvo@am.test')).status, 401, 'mesmo IP, outro e-mail');
});
test('e-mail em maiúsculas/espaços conta no MESMO balde (não dá para contornar variando a grafia)', async () => {
  const c = t.anon(); await c.ensureCsrf();
  for (let i = 0; i < 8; i++) await attempt(c, i % 2 ? '  Variante@AM.test ' : 'variante@am.test');
  assert.equal((await attempt(c, 'VARIANTE@am.test')).status, 429);
});
test('login: 30 por IP em 10 min com e-mails diferentes (password spraying); depois 429', async () => {
  const c = t.anon(); await c.ensureCsrf();
  for (let i = 1; i <= 30; i++) assert.equal((await attempt(c, `spray${i}@am.test`)).status, 401, `tentativa ${i}`);
  const n = tokenCalls(); const r = await attempt(c, 'spray31@am.test'); assert.equal(r.status, 429); assert.equal(tokenCalls(), n);
  assert.equal((await t.anon().login(u.email, u.password)).status, 200, 'outro IP não é afetado');
});
test('IP vem do proxy (X-Forwarded-For, entrada mais à direita) e a entrada do cliente à esquerda não escapa do limite', async () => {
  const c = t.anon({ ip: '203.0.113.9' }); await c.ensureCsrf();
  for (let i = 0; i < 8; i++) await c.request('POST', '/api/auth/login', { json: { email: 'xff@am.test', password: 'senha-errada-qualquer-9' }, headers: { 'x-forwarded-for': `1.2.3.${i}, 203.0.113.9` } });
  const r = await c.request('POST', '/api/auth/login', { json: { email: 'xff@am.test', password: 'senha-errada-qualquer-9' }, headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.9' } });
  assert.equal(r.status, 429, 'forjar a parte esquerda do cabeçalho não renova o limite');
});
test('forgot: 5 por IP em 15 min (e-mails diferentes) → 429; sem enviar e-mail depois', async () => {
  const c = t.anon(); await c.ensureCsrf();
  for (let i = 1; i <= 5; i++) assert.equal((await c.post('/api/auth/forgot', { email: `f${i}@am.test` })).status, 202, `pedido ${i}`);
  const mails = t.fake.outbox().length;
  const r = await c.post('/api/auth/forgot', { email: u.email }); assert.equal(r.status, 429); assert.ok(r.headers.get('retry-after'));
  assert.equal(t.fake.outbox().length, mails);
});
test('forgot: 5 por e-mail em 15 min mesmo vindo de IPs diferentes (não dá para inundar a caixa de alguém)', async () => {
  const email = u.email;
  for (let i = 1; i <= 5; i++) { const c = t.anon(); await c.ensureCsrf(); assert.equal((await c.post('/api/auth/forgot', { email })).status, 202, `pedido ${i}`); }
  const c = t.anon(); await c.ensureCsrf(); const r = await c.post('/api/auth/forgot', { email: `  ${email.toUpperCase()} ` }); assert.equal(r.status, 429);
  assert.equal(t.fake.outbox(email).filter((m) => m.type === 'recovery').length, 5);
});
test('verify: 5 por IP em 15 min → 429', async () => {
  const c = t.anon(); await c.ensureCsrf();
  for (let i = 1; i <= 5; i++) assert.equal((await c.post('/api/auth/verify', { tokenHash: 'a'.repeat(20) + i, type: 'invite' })).status, 410);
  assert.equal((await c.post('/api/auth/verify', { tokenHash: 'a'.repeat(20) + 'z', type: 'invite' })).status, 429);
});
test('estourar o limite é auditado (security.rate_limited) sem e-mail nem senha', async () => {
  const rows = await t.ops.asSystem((tx) => tx`select meta, entity_id from app.audit_log where action = 'security.rate_limited'`);
  assert.ok(rows.length >= 4); const buckets = new Set(rows.map((r) => r.entity_id));
  for (const b of ['login_email_ip', 'login_ip', 'forgot_ip', 'forgot_email', 'verify_ip']) assert.ok(buckets.has(b), b);
  assert.ok(!JSON.stringify(rows).match(/@am\.test|senha-errada/));
});
test('o contador é do banco (sobrevive a reinício e vale entre instâncias): janela fixa em app.rate_limits', async () => {
  const rows = await t.ops.asSystem((tx) => tx`select bucket, hits from app.rate_limits where bucket = 'login_ip' order by hits desc limit 1`);
  assert.ok(rows[0].hits >= 30);
});
