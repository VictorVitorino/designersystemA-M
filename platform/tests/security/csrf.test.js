/* CSRF: double-submit + Origin + Content-Type. Cada camada tem teste próprio (falha só quando ELA quebra) e há um teste de ataque completo. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';

let t, u;
before(async () => { t = await boot(); u = await t.createUser(); });
after(async () => { await t.stop(); });

const OK_BODY = () => ({ email: u.email, password: u.password });
async function fresh() { const c = t.anon(); await c.ensureCsrf(); return c; }
const csrfErr = (r) => { assert.equal(r.status, 403, r.text); assert.equal(r.json.error.code, 'csrf'); };

test('requisição legítima passa (controle)', async () => {
  const c = await fresh(); assert.equal((await c.request('POST', '/api/auth/login', { json: OK_BODY() })).status, 200);
});
test('cookie CSRF: 32 bytes base64url, não-HttpOnly, SameSite=Lax, Path=/; /session devolve o mesmo valor', async () => {
  const c = t.anon(); const r = await c.get('/api/auth/session'); const sc = r.setCookies.find((x) => x.name === t.names.csrf);
  assert.match(sc.value, /^[A-Za-z0-9_-]{43}$/); assert.equal(Buffer.from(sc.value, 'base64url').length, 32);
  assert.ok(!sc.attrs.httponly); assert.equal(sc.attrs.samesite, 'Lax'); assert.equal(sc.attrs.path, '/'); assert.equal(sc.value, r.json.csrfToken);
  const again = await c.get('/api/auth/session'); assert.equal(again.json.csrfToken, sc.value, 'estável enquanto o cookie existe'); assert.equal(again.setCookies.some((x) => x.name === t.names.csrf), false);
  const other = await t.anon().get('/api/auth/session'); assert.notEqual(other.json.csrfToken, sc.value, 'tokens diferentes por navegador');
});
test('(a) token: ausente, só cookie, só cabeçalho, diferente, malformado → 403 csrf', async () => {
  const c = await fresh(); const tok = c.cookie(t.names.csrf);
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), csrf: false }));                                          // cookie sem cabeçalho
  csrfErr(await t.anon().request('POST', '/api/auth/login', { json: OK_BODY(), headers: { 'x-csrf-token': tok } }));              // cabeçalho sem cookie
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), headers: { 'x-csrf-token': 'A'.repeat(43) } }));          // errado
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), headers: { 'x-csrf-token': tok.slice(0, 42) } }));        // tamanho
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), headers: { 'x-csrf-token': tok + 'A' } }));
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), headers: { 'x-csrf-token': '' } }));
  const other = await fresh();   // token válido de OUTRO navegador não serve neste
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), headers: { 'x-csrf-token': other.cookie(t.names.csrf) } }));
  // cookie adulterado pelo atacante junto com o cabeçalho igual (mesmo valor forjado) com formato inválido
  const forged = t.anon(); forged.jar.set(t.names.csrf, 'forjado'); csrfErr(await forged.request('POST', '/api/auth/login', { json: OK_BODY(), headers: { 'x-csrf-token': 'forjado' } }));
});
test('(b) Origin: de outro site, null, parecido, porta/esquema diferentes → 403; Sec-Fetch-Site decide quando não há Origin', async () => {
  const c = await fresh(); const o = t.config.origin;
  for (const origin of ['https://evil.example', 'null', 'http://localhost:3001', 'https://localhost:3000', o + '.evil.example', o + '/', 'http://evil.example/' + o, '']) {
    csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), headers: { origin } }));
  }
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), origin: false }));                                                  // sem Origin e sem Sec-Fetch-Site
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), origin: false, headers: { 'sec-fetch-site': 'cross-site' } }));
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), origin: false, headers: { 'sec-fetch-site': 'same-site' } }));
  csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), origin: false, headers: { 'sec-fetch-site': 'none' } }));
  assert.equal((await c.request('POST', '/api/auth/login', { json: OK_BODY(), origin: false, headers: { 'sec-fetch-site': 'same-origin' } })).status, 200, 'sem Origin, same-origin vale');
});
test('(c) Content-Type: formulário/texto/multipart/XML/ausente-com-corpo → 403, mesmo com token e Origin certos', async () => {
  const c = await fresh(); const json = JSON.stringify(OK_BODY());
  for (const ct of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x', 'text/xml', 'application/xml', 'application/octet-stream', 'text/html', 'application/jsonx', 'application/json-patch+json', 'application/vnd.api+json', 'image/png']) {
    csrfErr(await c.request('POST', '/api/auth/login', { body: json, headers: { 'content-type': ct, 'content-length': String(json.length) } }));
  }
  csrfErr(await c.request('POST', '/api/auth/login', { body: json, headers: { 'content-length': String(json.length) } }));              // corpo sem Content-Type
  csrfErr(await c.request('POST', '/api/auth/logout', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }));       // cabeçalho presente mesmo sem corpo
  assert.equal((await c.request('POST', '/api/auth/login', { body: json, headers: { 'content-type': 'Application/JSON; charset=UTF-8' } })).status, 200, 'JSON com charset e maiúsculas vale');
  assert.equal((await fresh().then((k) => k.request('POST', '/api/auth/logout'))).status, 204, 'sem corpo e sem Content-Type vale (logout)');
});
test('binário só é aceito no PUT de arquivo (/api/assets/<sha256>)', async () => {
  const c = await fresh(); const sha = 'a'.repeat(64);
  const viaCsrf = async (m, p, ct) => (await c.request(m, p, { body: 'x', headers: { 'content-type': ct, 'content-length': '1' } }));
  const ok = await viaCsrf('PUT', `/api/assets/${sha}`, 'image/png'); assert.ok(!(ok.status === 403 && ok.json?.error?.code === 'csrf'), 'PUT de arquivo com image/png passa pela camada CSRF');
  for (const [m, p, ct] of [['PUT', `/api/assets/${sha}`, 'text/html'], ['POST', `/api/assets/${sha}`, 'image/png'], ['PUT', '/api/presentations/x/content', 'image/png'], ['PUT', `/api/assets/${'a'.repeat(63)}`, 'image/png'], ['PUT', `/api/assets/${sha}/x`, 'image/png']]) {
    const r = await viaCsrf(m, p, ct); assert.equal(r.status, 403, `${m} ${p} ${ct}`); assert.equal(r.json.error.code, 'csrf');
  }
});
test('métodos que alteram estado exigem tudo: PUT, PATCH, DELETE, POST sem nada', async () => {
  const c = await fresh();
  for (const [m, p] of [['PUT', '/api/admin/settings/invites.ttl_days'], ['PATCH', '/api/me'], ['DELETE', '/api/admin/invites/x'], ['POST', '/api/anything'], ['PUT', '/api/anything'], ['DELETE', '/api/anything']]) {
    csrfErr(await c.request(m, p, { json: {}, csrf: false })); csrfErr(await t.anon().request(m, p, { json: {}, headers: { origin: 'https://evil.example' } }));
  }
});
test('métodos seguros são isentos (e não alteram nada)', async () => {
  const c = t.anon();
  for (const m of ['GET', 'HEAD', 'OPTIONS']) { const r = await c.request(m, '/api/health', { csrf: false, origin: false }); assert.notEqual(r.json?.error?.code, 'csrf', m); }
  const pre = await c.request('OPTIONS', '/api/auth/login', { csrf: false, headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.notEqual(pre.json?.error?.code, 'csrf'); assert.equal(pre.headers.get('access-control-allow-origin'), null, 'preflight não libera CORS');
});
test('ataque completo: página de outro site tentando login/logout/troca de senha/admin com a sessão da vítima', async () => {
  const victim = await t.as(await t.createUser({ role: 'admin' }), { fresh: true });   // cookies da vítima presentes no navegador
  const evil = { origin: 'https://evil.example' };
  const attempts = [['POST', '/api/auth/logout', undefined], ['POST', '/api/auth/password', { password: 'Atacante-Troca-Senha-1!' }], ['PATCH', '/api/me', { displayName: 'hackeado' }], ['POST', '/api/admin/invites', { email: 'backdoor@evil.example', displayName: 'Backdoor', role: 'admin' }]];
  for (const [m, p, json] of attempts) {
    csrfErr(await victim.request(m, p, { json, headers: evil, csrf: false }));                                          // sem token, Origin errado
    csrfErr(await victim.request(m, p, { json, headers: evil }));                                                        // com o token (se o JS do atacante o tivesse), Origin errado
    csrfErr(await victim.request(m, p, { json, csrf: false }));                                                          // Origin certo, mas sem token
    csrfErr(await victim.request(m, p, { body: JSON.stringify(json ?? {}), headers: { 'content-type': 'text/plain' } })); // <form enctype=text/plain>
  }
  assert.equal((await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users where email = 'backdoor@evil.example'`))[0].n, 0);
  assert.equal((await victim.get('/api/me')).status, 200, 'sessão da vítima intacta');
});
test('auditoria do bloqueio: security.csrf_blocked com motivo e rota — NUNCA o corpo, e com limite por IP', async () => {
  const c = await fresh(); const secret = 'SEGREDO-NO-CORPO-12345';
  await c.request('POST', '/api/auth/login', { json: { email: u.email, password: secret }, csrf: false });
  await c.request('POST', '/api/auth/login', { json: { email: u.email, password: secret }, headers: { origin: 'https://evil.example' } });
  const rows = await t.ops.asSystem((tx) => tx`select meta, ip::text ip from app.audit_log where action = 'security.csrf_blocked' and ip = ${c.ip}::inet order by id`);
  assert.equal(rows.length, 2); assert.deepEqual(rows.map((r) => r.meta.reason), ['token_missing', 'origin']); assert.equal(rows[0].meta.route, '/api/auth/login'); assert.equal(rows[0].meta.method, 'POST');
  assert.ok(!JSON.stringify(rows).includes(secret) && !JSON.stringify(rows).includes(u.email));
  const flood = await fresh();
  for (let i = 0; i < 30; i++) await flood.request('POST', '/api/auth/login', { json: {}, csrf: false });
  const n = (await t.ops.asSystem((tx) => tx`select count(*)::int n from app.audit_log where action = 'security.csrf_blocked' and ip = ${flood.ip}::inet`))[0].n;
  assert.ok(n <= 20, `auditoria limitada (${n} linhas para 30 bloqueios)`);
});
test('o CSRF roda ANTES do login/sessão: não gasta limite de taxa nem chama o GoTrue', async () => {
  const c = await fresh(); const calls = t.fake.calls.length;
  for (let i = 0; i < 12; i++) csrfErr(await c.request('POST', '/api/auth/login', { json: OK_BODY(), csrf: false }));
  assert.equal(t.fake.calls.length, calls); assert.equal((await c.request('POST', '/api/auth/login', { json: OK_BODY() })).status, 200);
});
