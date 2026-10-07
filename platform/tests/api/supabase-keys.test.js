/* Chaves novas do Supabase (sb_publishable_… no lugar de anon, sb_secret_… no lugar de service_role). Projetos criados a partir de
   nov/2025 só têm estas, e elas NÃO são JWT: valem só no cabeçalho `apikey` e o Supabase recusa a chave nova enviada como Bearer.
   O GoTrue falso em keyFormat 'opaque' imita isso (inclusive a recusa), então um cliente que ainda mande a chave como Bearer falha aqui.
   Cobre todas as chamadas que a API faz ao GoTrue: convite, link, senha, login, renovação, saída, esqueci a senha e suspensão. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';
import { createGoTrue, isOpaqueKey } from '../../src/auth/gotrue.js';

let t, admin, adminC;
const PW = 'Uma-senha-bem-longa-2026!';
before(async () => { t = await boot({ keyFormat: 'opaque' }); admin = await t.createUser({ role: 'admin', displayName: 'Admin' }); adminC = await t.as(admin); });
after(async () => { await t.stop(); });

const lastMail = (email, type) => t.fake.outbox(email).filter((m) => m.type === type).at(-1);

test('o GoTrue falso está no formato novo e o reconhecimento das chaves não confunde JWT com chave nova', () => {
  assert.match(t.fake.anonKey, /^sb_publishable_/); assert.match(t.fake.serviceKey, /^sb_secret_/);
  assert.equal(isOpaqueKey(t.fake.anonKey), true); assert.equal(isOpaqueKey(t.fake.serviceKey), true);
  for (const k of ['eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.x', 'fake-anon-key-0000000000', '', null, undefined, 'sb_outra_coisa']) assert.equal(isOpaqueKey(k), false, String(k));
});

test('cabeçalhos: chave nova só no apikey; token do usuário como Bearer; chave legada (JWT) segue também como Bearer', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url: String(url), headers: init.headers }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const mk = (anonKey, serviceKey) => createGoTrue({ appEnv: 'test', logLevel: 'silent', supabase: { url: 'https://exemplo.supabase.co', anonKey, serviceKey } }, { fetchImpl });
  const novo = mk('sb_publishable_abc', 'sb_secret_xyz');
  await novo.invite({ email: 'a@am.test', displayName: 'A' }).catch(() => {});
  await novo.recover('a@am.test').catch(() => {});
  await novo.login({ email: 'a@am.test', password: 'x' }).catch(() => {});
  await novo.ban('00000000-0000-4000-8000-000000000000', true).catch(() => {});
  await novo.health().catch(() => {});
  assert.ok(seen.length >= 5, 'todas as chamadas sem token de usuário foram feitas');
  for (const s of seen) { assert.ok(s.headers.apikey.startsWith('sb_')); assert.equal(s.headers.Authorization, undefined, `${s.url} não pode levar a chave nova como Bearer`); }
  seen.length = 0;
  await novo.setPassword('token-do-usuario', 'Outra-senha-longa-2026!').catch(() => {});
  assert.equal(seen[0].headers.Authorization, 'Bearer token-do-usuario', 'chamada de usuário leva o token do usuário'); assert.equal(seen[0].headers.apikey, 'sb_publishable_abc');
  seen.length = 0;
  const legado = mk('eyJ.anon.jwt', 'eyJ.service.jwt');
  await legado.invite({ email: 'b@am.test', displayName: 'B' }).catch(() => {});
  assert.equal(seen[0].headers.apikey, 'eyJ.service.jwt'); assert.equal(seen[0].headers.Authorization, 'Bearer eyJ.service.jwt');
});

test('fluxo completo com as chaves novas: convite → link → senha → login → renovação → sair', async () => {
  const email = 'chave.nova@am.test';
  const inv = await adminC.post('/api/admin/invites', { email, displayName: 'Chave Nova', role: 'member' }); assert.equal(inv.status, 201, inv.text);
  const mail = lastMail(email, 'invite'); assert.ok(mail, 'convite enviado pelo GoTrue (chamada administrativa com sb_secret_ só no apikey)');
  const c = t.anon(); await c.ensureCsrf();
  const v = await c.post('/api/auth/verify', { tokenHash: mail.token_hash, type: 'invite' }); assert.equal(v.status, 200, v.text);
  const p = await c.post('/api/auth/password', { password: PW }); assert.equal(p.status, 200, p.text); assert.equal(p.json.user.status, 'active');
  const c2 = t.anon(); const login = await c2.login(email, PW); assert.equal(login.status, 200, login.text);
  const r = await c2.post('/api/auth/refresh'); assert.equal(r.status, 200, r.text);
  assert.equal((await c2.get('/api/me')).status, 200);
  const out = await c2.post('/api/auth/logout'); assert.equal(out.status, 204);
  assert.equal((await c2.get('/api/auth/session')).json.authenticated, false);
  assert.equal(t.fake.calls.filter((x) => x.path === '/auth/v1/logout').length > 0, true, 'sessão revogada no GoTrue');
});

test('esqueci a senha e suspensão também funcionam com as chaves novas', async () => {
  const u = await t.createUser({ displayName: 'Recupera' });
  const c = t.anon(); await c.ensureCsrf();
  assert.equal((await c.post('/api/auth/forgot', { email: u.email })).status, 202);
  assert.ok(lastMail(u.email, 'recovery'), 'e-mail de recuperação enviado');
  const s = await adminC.patch(`/api/admin/users/${u.id}`, { status: 'suspended' });
  assert.equal(s.status, 200, s.text); assert.equal(s.json.gotrueSync, true, 'bloqueio sincronizado no GoTrue com sb_secret_ só no apikey');
  assert.equal(t.fake.isBanned(t.fake.userByEmail(u.email).id), true);
});

test('o falso recusa a chave nova enviada como Bearer (como o Supabase real), então o teste acima pegaria a regressão', async () => {
  const res = await fetch(`${t.fake.url}/auth/v1/invite`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: t.fake.serviceKey, authorization: `Bearer ${t.fake.serviceKey}` }, body: JSON.stringify({ email: 'x@am.test' }) });
  assert.equal(res.status, 401);
  const ok = await fetch(`${t.fake.url}/auth/v1/invite`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: t.fake.serviceKey }, body: JSON.stringify({ email: 'y@am.test' }) });
  assert.equal(ok.status, 200);
});
