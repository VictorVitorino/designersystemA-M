/* Cliente do GoTrue: mapeamento de erros (sem vazar o corpo), cabeçalhos corretos, timeout e paginação — com fetch simulado. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoTrue } from '../../src/auth/gotrue.js';

const config = { appEnv: 'test', logLevel: 'silent', supabase: { url: 'https://proj.supabase.co/', anonKey: 'ANON-KEY-123456', serviceKey: 'SERVICE-KEY-123456' } };
const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mk = (handler) => { const calls = []; const g = createGoTrue(config, { fetchImpl: async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); } }); return { g, calls }; };
const rejects = async (p, code) => { try { await p; } catch (e) { assert.equal(e.code, code, `esperava ${code}, veio ${e.code}`); return e; } assert.fail('deveria ter lançado ' + code); };
const SESSION = { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1', email: 'a@b.co' } };

test('login ok devolve tokens; usa anon key e o corpo certo', async () => {
  const { g, calls } = mk(() => reply(200, SESSION));
  const r = await g.login({ email: 'a@b.co', password: 'x' });
  assert.deepEqual([r.accessToken, r.refreshToken, r.expiresIn], ['AT', 'RT', 3600]);
  assert.equal(calls[0].url, 'https://proj.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(calls[0].init.headers.apikey, 'ANON-KEY-123456'); assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'a@b.co', password: 'x' });
});
test('login: credenciais inválidas / e-mail não confirmado / usuário inexistente → TODOS invalid_credentials', async () => {
  for (const body of [{ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' },
    { error: 'invalid_grant', error_description: 'Invalid login credentials' }, { code: 400, error_code: 'user_not_found' }]) {
    const { g } = mk(() => reply(400, body)); await rejects(g.login({ email: 'a@b.co', password: 'x' }), 'invalid_credentials');
  }
});
test('login: usuário bloqueado → suspended; 429 → rate_limited; 5xx → unavailable', async () => {
  await rejects(mk(() => reply(403, { code: 403, error_code: 'user_banned', msg: 'User is banned' })).g.login({ email: 'a@b.co', password: 'x' }), 'suspended');
  await rejects(mk(() => reply(429, { error_code: 'over_request_rate_limit' })).g.login({ email: 'a@b.co', password: 'x' }), 'rate_limited');
  await rejects(mk(() => reply(500, { msg: 'boom' })).g.login({ email: 'a@b.co', password: 'x' }), 'unavailable');
  await rejects(mk(() => reply(200, { ok: true })).g.login({ email: 'a@b.co', password: 'x' }), 'invalid_credentials');   // 200 sem sessão não vira login
});
test('falha de rede e timeout → unavailable, sem vazar a mensagem original', async () => {
  const net = mk(() => { throw new TypeError('connect ECONNREFUSED 10.0.0.5:5432 senha=hunter2'); });
  const e1 = await rejects(net.g.login({ email: 'a@b.co', password: 'x' }), 'unavailable');
  assert.ok(!/ECONNREFUSED|hunter2|10\.0\.0\.5/.test(e1.message + JSON.stringify(e1.details || {})));
  const to = mk(() => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; });
  await rejects(to.g.refresh('rt'), 'unavailable');
});
test('o corpo de erro do GoTrue nunca chega ao cliente', async () => {
  const { g } = mk(() => reply(500, { msg: 'detalhe interno com segredo@x.com e SELECT * FROM auth.users' }));
  const e = await rejects(g.recover('segredo@x.com'), 'unavailable');
  assert.ok(!/segredo|SELECT|auth\.users/.test(e.message + JSON.stringify(e.details || {})));
});
test('verify: sucesso; link expirado/usado → link_invalid (410); 5xx → unavailable', async () => {
  const ok = mk((u, init) => reply(200, SESSION)); const r = await ok.g.verify({ type: 'invite', tokenHash: 'abc' });
  assert.equal(r.accessToken, 'AT'); assert.deepEqual(JSON.parse(ok.calls[0].init.body), { type: 'invite', token_hash: 'abc' }); assert.ok(ok.calls[0].url.endsWith('/auth/v1/verify'));
  const e = await rejects(mk(() => reply(403, { error_code: 'otp_expired', msg: 'Email link is invalid or has expired' })).g.verify({ type: 'recovery', tokenHash: 'x' }), 'link_invalid');
  assert.equal(e.status, 410);
  await rejects(mk(() => reply(400, {})).g.verify({ type: 'recovery', tokenHash: 'x' }), 'link_invalid');
  await rejects(mk(() => reply(502, {})).g.verify({ type: 'recovery', tokenHash: 'x' }), 'unavailable');
});
test('refresh: token inválido/usado → session_expired; ok devolve tokens', async () => {
  assert.equal((await mk(() => reply(200, SESSION)).g.refresh('rt')).refreshToken, 'RT');
  await rejects(mk(() => reply(400, { error_code: 'refresh_token_not_found' })).g.refresh('rt'), 'session_expired');
  await rejects(mk(() => reply(400, { error_code: 'refresh_token_already_used' })).g.refresh('rt'), 'session_expired');
  await rejects(mk(() => reply(500, {})).g.refresh('rt'), 'unavailable');
});
test('convite usa a service key (apikey e Bearer) e envia display_name', async () => {
  const { g, calls } = mk(() => reply(200, { id: 'gid', email: 'n@x.co' }));
  assert.deepEqual(await g.invite({ email: 'n@x.co', displayName: 'Nova' }), { id: 'gid', email: 'n@x.co' });
  assert.equal(calls[0].init.headers.apikey, 'SERVICE-KEY-123456'); assert.equal(calls[0].init.headers.Authorization, 'Bearer SERVICE-KEY-123456');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'n@x.co', data: { display_name: 'Nova' } });
});
test('convite: e-mail já registrado → already_exists; 5xx → unavailable', async () => {
  await rejects(mk(() => reply(422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' })).g.invite({ email: 'a@b.co', displayName: 'A' }), 'already_exists');
  await rejects(mk(() => reply(500, {})).g.invite({ email: 'a@b.co', displayName: 'A' }), 'unavailable');
});
test('setPassword: Bearer do usuário; weak_password/same_password → 400; sessão inválida → session_expired', async () => {
  const { g, calls } = mk(() => reply(200, { id: 'u' }));
  await g.setPassword('USER-AT', 'nova-senha-forte'); assert.equal(calls[0].init.headers.Authorization, 'Bearer USER-AT'); assert.equal(calls[0].init.headers.apikey, 'ANON-KEY-123456'); assert.equal(calls[0].init.method, 'PUT');
  const w = await rejects(mk(() => reply(422, { error_code: 'weak_password' })).g.setPassword('t', 'p'), 'invalid_request'); assert.equal(w.status, 400);
  await rejects(mk(() => reply(422, { error_code: 'same_password' })).g.setPassword('t', 'p'), 'invalid_request');
  await rejects(mk(() => reply(401, { error_code: 'bad_jwt' })).g.setPassword('t', 'p'), 'session_expired');
  await rejects(mk(() => reply(500, {})).g.setPassword('t', 'p'), 'unavailable');
});
test('logout: escopo validado; token já inválido → false; ok → true', async () => {
  const ok = mk(() => new Response(null, { status: 204 })); assert.equal(await ok.g.logout('AT', 'global'), true); assert.ok(ok.calls[0].url.endsWith('/logout?scope=global'));
  assert.equal(await mk(() => reply(401, {})).g.logout('AT', 'local'), false);
  await assert.rejects(() => ok.g.logout('AT', 'tudo; drop'), /scope/);
  await rejects(mk(() => reply(500, {})).g.logout('AT', 'local'), 'unavailable');
});
test('ban/remove: id é codificado na URL; 404 → false; ban_duration correto', async () => {
  const { g, calls } = mk(() => reply(200, {}));
  await g.ban('a/../b', true); assert.ok(calls[0].url.endsWith('/admin/users/a%2F..%2Fb')); assert.match(JSON.parse(calls[0].init.body).ban_duration, /^\d+h$/);
  await g.ban('x', false); assert.equal(JSON.parse(calls[1].init.body).ban_duration, 'none');
  await g.remove('x'); assert.equal(calls[2].init.method, 'DELETE');
  assert.equal(await mk(() => reply(404, {})).g.ban('x', true), false);
});
test('findUserIdByEmail percorre as páginas e ignora maiúsculas', async () => {
  const page1 = Array.from({ length: 200 }, (_, i) => ({ id: 'u' + i, email: `u${i}@x.co` }));
  const { g, calls } = mk((url) => reply(200, { users: url.includes('page=1') ? page1 : [{ id: 'alvo', email: 'Alvo@X.co' }] }));
  assert.equal(await g.findUserIdByEmail('ALVO@x.co'), 'alvo'); assert.equal(calls.length, 2);
  assert.equal(await mk(() => reply(200, { users: [] })).g.findUserIdByEmail('n@x.co'), null);
});
test('recover e health', async () => {
  assert.equal(await mk(() => reply(200, {})).g.recover('a@b.co'), true);
  await rejects(mk(() => reply(429, {})).g.recover('a@b.co'), 'rate_limited');
  assert.equal(await mk(() => reply(200, {})).g.health(), true);
  assert.equal(await mk(() => reply(500, {})).g.health(), false);
  assert.equal(await mk(() => { throw new Error('x'); }).g.health(), false);
});
test('sem configuração do Supabase: not_configured (501), sem chamar a rede', async () => {
  let called = false;
  const g = createGoTrue({ appEnv: 'test', logLevel: 'silent', supabase: {} }, { fetchImpl: async () => { called = true; return reply(200, {}); } });
  await rejects(g.login({ email: 'a@b.co', password: 'x' }), 'not_configured'); assert.equal(called, false);
  const g2 = createGoTrue({ appEnv: 'test', logLevel: 'silent', supabase: { url: 'https://x.co', anonKey: 'ANON-KEY-123456' } }, { fetchImpl: async () => reply(200, {}) });
  await rejects(g2.invite({ email: 'a@b.co', displayName: 'A' }), 'not_configured');   // sem service key
});

/* SSO (F10): POST /sso com PKCE e troca do código (grant_type=pkce); busca de TODAS as contas de um e-mail (senha + SAML) para bloquear. */
test('ssoUrl: corpo com domínio, redirect_to, skip_http_redirect e desafio S256 (nunca o verifier); devolve a URL do IdP', async () => {
  const { g, calls } = mk(() => reply(200, { url: 'https://idp.example/saml?SAMLRequest=x' }));
  const url = await g.ssoUrl({ domain: 'am.test', redirectTo: 'https://canteiro.x/api/auth/sso/callback', codeChallenge: 'C'.repeat(43) });
  assert.equal(url, 'https://idp.example/saml?SAMLRequest=x');
  assert.equal(calls[0].url, 'https://proj.supabase.co/auth/v1/sso'); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.headers.apikey, 'ANON-KEY-123456');
  assert.deepEqual(JSON.parse(calls[0].init.body), { domain: 'am.test', redirect_to: 'https://canteiro.x/api/auth/sso/callback', skip_http_redirect: true, code_challenge: 'C'.repeat(43), code_challenge_method: 's256' });
  assert.equal(calls[0].init.redirect, 'error', 'nunca segue redirecionamento');
});
test('ssoUrl: provedor inexistente/desligado → not_configured; 429 → rate_limited; 5xx/rede → unavailable; URL que não é http(s) → unavailable; http só fora de staging/produção', async () => {
  await rejects(mk(() => reply(404, { error_code: 'sso_provider_not_found' })).g.ssoUrl({ domain: 'x.test', redirectTo: 'r', codeChallenge: 'c' }), 'not_configured');
  await rejects(mk(() => reply(400, { error_code: 'validation_failed' })).g.ssoUrl({ domain: 'x.test', redirectTo: 'r', codeChallenge: 'c' }), 'not_configured');
  await rejects(mk(() => reply(429, {})).g.ssoUrl({ domain: 'x.test', redirectTo: 'r', codeChallenge: 'c' }), 'rate_limited');
  await rejects(mk(() => reply(503, {})).g.ssoUrl({ domain: 'x.test', redirectTo: 'r', codeChallenge: 'c' }), 'unavailable');
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'ftp://idp.example', 'nao-e-url', '']) await rejects(mk(() => reply(200, { url: u })).g.ssoUrl({ domain: 'x.test', redirectTo: 'r', codeChallenge: 'c' }), 'unavailable');
  assert.equal(await mk(() => reply(200, { url: 'http://127.0.0.1:9/idp' })).g.ssoUrl({ domain: 'x.test', redirectTo: 'r', codeChallenge: 'c' }), 'http://127.0.0.1:9/idp', 'http aceito em teste/local');
  const secure = createGoTrue({ ...config, isSecure: true }, { fetchImpl: async () => reply(200, { url: 'http://idp.example/' }) });
  await rejects(secure.ssoUrl({ domain: 'x.test', redirectTo: 'r', codeChallenge: 'c' }), 'unavailable');
});
test('exchangeCode: grant_type=pkce com auth_code e code_verifier; código/verifier inválido ou vencido → link_invalid (410); banido → suspended; 5xx → unavailable', async () => {
  const ok = mk(() => reply(200, SESSION)); const r = await ok.g.exchangeCode({ authCode: 'code-1', codeVerifier: 'V'.repeat(43) });
  assert.equal(r.accessToken, 'AT'); assert.equal(ok.calls[0].url, 'https://proj.supabase.co/auth/v1/token?grant_type=pkce'); assert.deepEqual(JSON.parse(ok.calls[0].init.body), { auth_code: 'code-1', code_verifier: 'V'.repeat(43) });
  for (const [st, body] of [[400, { error_code: 'bad_code_verifier' }], [404, { error_code: 'flow_state_not_found' }], [422, { error_code: 'flow_state_expired' }], [200, { ok: 1 }]]) {
    const e = await rejects(mk(() => reply(st, body)).g.exchangeCode({ authCode: 'c', codeVerifier: 'v' }), 'link_invalid'); assert.equal(e.status, 410);
  }
  await rejects(mk(() => reply(403, { error_code: 'user_banned' })).g.exchangeCode({ authCode: 'c', codeVerifier: 'v' }), 'suspended');
  await rejects(mk(() => reply(502, {})).g.exchangeCode({ authCode: 'c', codeVerifier: 'v' }), 'unavailable');
});
test('findUserIdsByEmail: todas as contas com o e-mail (a de senha e a do SSO), em todas as páginas; findUserIdByEmail continua devolvendo a primeira', async () => {
  const page1 = Array.from({ length: 200 }, (_, i) => ({ id: 'p' + i, email: i === 5 ? 'Alvo@x.co' : `u${i}@x.co` }));
  const { g } = mk((url) => reply(200, { users: url.includes('page=1&') ? page1 : [{ id: 'sso-alvo', email: 'alvo@x.co' }, { id: 'outro', email: 'o@x.co' }] }));
  assert.deepEqual(await g.findUserIdsByEmail('ALVO@x.co'), ['p5', 'sso-alvo']);
  assert.equal(await g.findUserIdByEmail('alvo@x.co'), 'p5');
  assert.deepEqual(await mk(() => reply(200, { users: [] })).g.findUserIdsByEmail('n@x.co'), []);
});
