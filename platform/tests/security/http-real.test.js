/* O mesmo app, mas por HTTP de verdade (@hono/node-server): cookies em Set-Cookie múltiplos, streaming de arquivos estáticos, IP vindo do socket e corpo grande. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { boot } from '../helpers/boot.js';
import { serveStatic } from '../../src/static.js';

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-real-')); const pub = path.join(dist, 'public');
const logs = []; const logger = { info: (m, f) => logs.push(f), warn() {}, error() {} };
let t, server, base, user;
before(async () => {
  fs.mkdirSync(path.join(pub, 'acervo'), { recursive: true }); fs.writeFileSync(path.join(pub, 'acervo', 'index.html'), '<!doctype html><title>acervo</title>PAGINA-ACERVO'); fs.writeFileSync(path.join(pub, 'big.bin'), Buffer.alloc(300_000, 7));
  t = await boot({ publicDir: pub, env: { TRUST_PROXY: 'false' }, deps: { logger } }); user = await t.createUser();
  const app = serveStatic(t.api, t.config);
  await new Promise((resolve) => { server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (i) => { base = `http://127.0.0.1:${i.port}`; resolve(); }); });
});
after(async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); await t.stop(); fs.rmSync(dist, { recursive: true, force: true }); });

const jar = new Map();
const call = async (method, p, { json, headers = {} } = {}) => {
  const h = { Origin: t.config.origin, ...headers };
  if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (jar.get('am_csrf') && method !== 'GET') h['X-CSRF-Token'] = jar.get('am_csrf');
  if (json !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual' });
  for (const line of r.headers.getSetCookie()) { const [pair] = line.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (v === '' || /max-age=0/i.test(line)) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), v); }
  return r;
};

test('login por HTTP real: vários Set-Cookie chegam separados, sem token no corpo', async () => {
  assert.equal((await call('GET', '/api/auth/session')).status, 200);
  const r = await call('POST', '/api/auth/login', { json: { email: user.email, password: user.password } });
  assert.equal(r.status, 200); const body = await r.text(); assert.ok(jar.get('am_at') && jar.get('am_rt') && jar.get('am_csrf')); assert.ok(!body.includes(jar.get('am_at')) && !body.includes(jar.get('am_rt')));
  assert.equal((await (await call('GET', '/api/me')).json()).email, user.email);
});
test('IP do cliente vem do socket quando TRUST_PROXY=false (cabeçalhos forjados ignorados)', async () => {
  logs.length = 0; await call('GET', '/api/health', { headers: { 'X-Forwarded-For': '6.6.6.6', 'X-Real-IP': '7.7.7.7' } });
  assert.equal(logs.at(-1).ip, '127.0.0.1');
});
test('estático por HTTP real: página, arquivo grande em streaming, HEAD, 404 e /api na mesma porta', async () => {
  const p = await call('GET', '/acervo'); assert.equal(p.status, 200); assert.ok((await p.text()).includes('PAGINA-ACERVO')); assert.match(p.headers.get('content-security-policy'), /default-src 'self'/);
  const big = await call('GET', '/big.bin'); assert.equal(big.status, 200); assert.equal(big.headers.get('content-type'), 'application/octet-stream'); assert.equal((await big.arrayBuffer()).byteLength, 300_000);
  const h = await call('HEAD', '/big.bin'); assert.equal(h.status, 200); assert.equal(h.headers.get('content-length'), '300000');
  assert.equal((await call('GET', '/nao-existe')).status, 404);
  assert.equal((await call('GET', '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
  assert.equal((await call('GET', '/api/health')).status, 200);
});
test('corpo JSON gigante é recusado (413) sem derrubar o servidor', async () => {
  const r = await call('POST', '/api/auth/login', { json: { email: 'a@am.test', password: 'a'.repeat(200_000) } });
  assert.equal(r.status, 413); assert.equal((await r.json()).error.code, 'too_large');
  assert.equal((await call('GET', '/api/health')).status, 200);
});
