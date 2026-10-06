/* tests/helpers/boot.js — sobe a API inteira para testes (Postgres real + GoTrue falso + armazenamento local temporário).

   USO (em qualquer tests/**.test.js; rode com TEST_DATABASE_ADMIN_URL apontando para o SEU banco de teste, ex. canteiro_t_<nome>):

     import { boot } from '../helpers/boot.js';
     let t;
     before(async () => { t = await boot(); });          // recria o schema app do banco de teste (hermético)
     after(async () => { await t.stop(); });
     test('exemplo', async () => {
       const ana = await t.createUser({ displayName: 'Ana' });           // usuário ATIVO no banco + conta no GoTrue falso
       const adm = await t.createUser({ role: 'admin' });
       const c = await t.as(ana);                                        // cliente já logado (cookies + CSRF automáticos)
       const r = await c.request('POST', '/api/presentations', { json: { title: 'Oi' } });   // → { status, json, text, headers, setCookies }
       const anon = t.anon();                                            // cliente sem sessão (IP próprio)
       await anon.login(ana.email, ana.password);                        // faz GET /api/auth/session (CSRF) + POST /api/auth/login
     });

   O que vem em `t`: app (Hono), deps, config, fake (GoTrue falso: fake.outbox(), fake.addUser, fake.mintToken…), db (papel app_api), ops (app_system),
   makeClient({ip}), anon(), as(user), createUser(opts), clearIdentityCache(), stop().
   Opções de boot(): mode:'jwks'|'hs256', inviteDomains:'a.com,b.com', authTiming:{failMinMs,forgotMinMs}, identityTtlMs, accessTtl, latency, env:{...}, withStatic:true (+ publicDir).
   Cada cliente tem seu próprio cookie jar e um IP único (X-Forwarded-For), então limites de taxa de um teste não afetam os outros.
   `t.app.request` não abre porta de rede: chama o app em memória. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { setup, API_URL } from '../db/helpers.js';
import { loadConfig } from '../../src/config.js';
import { createGoTrue } from '../../src/auth/gotrue.js';
import { startFakeGoTrue } from '../../tools/fake-gotrue.js';
import { getAuthKit } from '../../src/auth/kit.js';
import { cookieNames } from '../../src/auth/cookies.js';

export const DEFAULT_PASSWORD = 'Senha-Forte-Teste-9876!';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

async function loadStorage(config) {
  try { const m = await import('../../src/storage/index.js'); return m.createStorage(config); }
  catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return { driver: 'local', async ping() { return true; } }; }
}

/** Composição completa (src/app.js). Se outras partes da API ainda não existem no repositório, compõe só a parte de autenticação (mesma ordem de middlewares). */
async function makeApp(deps) {
  try { const { createApp } = await import('../../src/app.js'); return { app: createApp(deps), full: true }; }
  catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    const [{ requestId }, { securityHeaders }, { accessLog }, { csrf }, { session }, { onError, onNotFound }, { authRoutes }, { adminRoutes }, { healthRoutes }] = await Promise.all([
      import('../../src/middleware/request-id.js'), import('../../src/middleware/security-headers.js'), import('../../src/middleware/access-log.js'),
      import('../../src/middleware/csrf.js'), import('../../src/middleware/session.js'), import('../../src/middleware/error.js'),
      import('../../src/routes/auth.js'), import('../../src/routes/admin.js'), import('../../src/routes/health.js')]);
    const { config } = deps;
    if (deps.sessionOverride && config.appEnv !== 'test') throw new Error('sessionOverride só é permitido em APP_ENV=test');
    const app = new Hono({ strict: false });
    app.use('*', async (c, next) => { c.set('deps', deps); await next(); });
    app.use('*', requestId()); app.use('*', securityHeaders(config)); app.use('/api/*', accessLog(deps)); app.use('/api/*', csrf(config));
    app.use('/api/*', deps.sessionOverride || session(deps));
    app.route('/api', healthRoutes(deps)); app.route('/api/auth', authRoutes(deps)); app.route('/api/me', authRoutes.me(deps)); app.route('/api/admin', adminRoutes(deps));
    app.onError(onError(deps)); app.notFound(onNotFound());
    return { app, full: false };
  }
}

function parseSetCookie(line) {
  const [pair, ...attrs] = line.split(';').map((s) => s.trim());
  const i = pair.indexOf('=');
  const a = {}; for (const x of attrs) { const [k, v] = x.split('='); a[k.toLowerCase()] = v === undefined ? true : v; }
  return { name: pair.slice(0, i), value: pair.slice(i + 1), attrs: a, raw: line };
}

export async function boot(opts = {}) {
  const { mode = 'jwks', appOrigin = 'http://localhost:3000' } = opts;
  const { db, ops } = await setup();
  const fake = await startFakeGoTrue({ mode, appOrigin, accessTtl: opts.accessTtl, latency: opts.latency });
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-test-'));
  const config = loadConfig({
    APP_ENV: 'test', APP_ORIGIN: appOrigin, DATABASE_URL: API_URL, LOG_LEVEL: opts.logLevel || 'silent',
    SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: fake.anonKey, SUPABASE_SERVICE_ROLE_KEY: fake.serviceKey,
    ...(mode === 'jwks' ? { SUPABASE_JWKS_URL: fake.jwksUrl } : { SUPABASE_JWT_SECRET: fake.jwtSecret }),
    CSRF_SECRET: crypto.randomBytes(32).toString('hex'), STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: storageDir,
    ...(opts.inviteDomains ? { INVITE_ALLOWED_DOMAINS: opts.inviteDomains } : {}), ...(opts.publicDir ? { PUBLIC_DIR: opts.publicDir } : {}), ...(opts.env || {}),
  });
  const storage = await loadStorage(config);
  const deps = { config, db, storage, gotrue: createGoTrue(config), authTiming: { failMinMs: 0, forgotMinMs: 0, ...(opts.authTiming || {}) }, ...(opts.identityTtlMs !== undefined ? { identityTtlMs: opts.identityTtlMs } : {}), ...(opts.deps || {}) };
  let made;
  try { made = await makeApp(deps); }
  catch (e) { await db.end().catch(() => {}); await ops.end().catch(() => {}); await fake.close().catch(() => {}); fs.rmSync(storageDir, { recursive: true, force: true }); throw e; }
  const { app: api, full } = made;
  let app = api;
  if (opts.withStatic) { const { serveStatic } = await import('../../src/static.js'); app = serveStatic(api, config); }
  const names = cookieNames(config);
  const kit = getAuthKit(deps);

  function makeClient({ ip } = {}) {
    const jar = new Map(), attrs = new Map();
    const myIp = ip || `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
    const client = {
      ip: myIp, jar, attrs, names,
      cookie: (n) => jar.get(n) ?? null,
      /** @returns {Promise<{status:number, headers:Headers, text:string, json:any, setCookies:Array}>} */
      async request(method, p, { json, body, headers = {}, csrf = true, origin = true, cookies = true } = {}) {
        const h = new Headers(headers);
        if (origin && !h.has('origin')) h.set('Origin', config.origin);
        if (!h.has('x-forwarded-for')) h.set('X-Forwarded-For', myIp);
        if (cookies && jar.size && !h.has('cookie')) h.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
        if (csrf && !SAFE.has(method) && !h.has('x-csrf-token') && jar.get(names.csrf)) h.set('X-CSRF-Token', jar.get(names.csrf));
        let payload = body;
        if (json !== undefined) { payload = JSON.stringify(json); if (!h.has('content-type')) h.set('Content-Type', 'application/json'); }
        const res = await app.request(p, { method, headers: h, body: payload });
        const setCookies = res.headers.getSetCookie().map(parseSetCookie);
        for (const sc of setCookies) {
          if (sc.value === '' || sc.attrs['max-age'] === '0') { jar.delete(sc.name); attrs.delete(sc.name); } else { jar.set(sc.name, sc.value); attrs.set(sc.name, sc.attrs); }
        }
        const text = await res.text(); let parsed; try { parsed = JSON.parse(text); } catch { parsed = undefined; }
        return { status: res.status, headers: res.headers, text, json: parsed, setCookies };
      },
      get: (p, o) => client.request('GET', p, o), post: (p, json, o) => client.request('POST', p, { json, ...o }),
      put: (p, json, o) => client.request('PUT', p, { json, ...o }), patch: (p, json, o) => client.request('PATCH', p, { json, ...o }), del: (p, o) => client.request('DELETE', p, o),
      async ensureCsrf() { if (!jar.get(names.csrf)) await client.get('/api/auth/session'); return jar.get(names.csrf); },
      async login(email, password) { await client.ensureCsrf(); return client.request('POST', '/api/auth/login', { json: { email, password } }); },
    };
    return client;
  }

  const logged = new Map();
  let n = 0;
  const t = {
    app, api, deps, config, fake, db, ops, storage, storageDir, fullApp: full, kit, names, DEFAULT_PASSWORD,
    makeClient, anon: (o) => makeClient(o),
    /** Cria um usuário no banco (status/papel à escolha) e a conta correspondente no GoTrue falso (com senha). */
    async createUser({ role = 'member', status = 'active', displayName, email, password = DEFAULT_PASSWORD, inGoTrue = true } = {}) {
      n++;
      const mail = (email || `u${Date.now().toString(36)}${n}${crypto.randomInt(1000)}@am.test`).toLowerCase();
      const name = displayName || `Usuário ${n}`;
      const [u] = await ops.asSystem((tx) => tx`insert into app.users(email, display_name, role, status, activated_at) values (${mail}, ${name}, ${role}, ${status}, ${status === 'invited' ? null : new Date()}) returning id`);
      if (inGoTrue) fake.addUser({ email: mail, password, displayName: name });
      return { id: u.id, email: mail, password, displayName: name, role, status };
    },
    /** Cliente logado como o usuário (memoizado; `fresh:true` força novo login com novo cookie jar). */
    async as(user, { fresh = false } = {}) {
      if (!fresh && logged.has(user.id)) return logged.get(user.id);
      const c = makeClient();
      const r = await c.login(user.email, user.password);
      if (r.status !== 200) throw new Error(`login de teste falhou (${r.status}): ${r.text}`);
      if (!fresh) logged.set(user.id, c);
      return c;
    },
    forget(user) { logged.delete(user.id); },
    clearIdentityCache() { kit.cache.clear(); },
    async stop() {
      await db.end().catch(() => {}); await ops.end().catch(() => {}); await fake.close().catch(() => {});
      fs.rmSync(storageDir, { recursive: true, force: true });
    },
  };
  return t;
}
