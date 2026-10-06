/* tests/helpers/mini-app.js — monta SÓ as rotas de conteúdo (apresentações, comentários, interações, arquivos) para testes ponta a ponta.
   Sem middlewares de sessão/CSRF (outro escopo): o "usuário logado" vem do cabeçalho X-Test-User=<uuid> e o IP de X-Test-Ip.
   Mesmo assim tudo o mais é REAL: banco Postgres com RLS (papel app_user por transação), onError real, limites de taxa reais, validação e armazenamento local temporário.

     const env = await makeEnv();                       // recria o schema do banco de teste (TEST_DATABASE_ADMIN_URL) e aplica extra-migration.sql
     const ana = await env.mkUser({ name: 'Ana' });     // usuário ATIVO no banco (+ registro para o cabeçalho)
     const r = await env.post(ana, '/api/presentations', { json: { title: 'x' } });   // → { status, json, text, buffer, headers }
     await env.stop();
   extra-migration.sql = funções SECURITY DEFINER propostas ao coordenador (app.asset_mark_ready, asset_discard_pending, asset_touch). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import sharp from 'sharp';
import { Hono } from 'hono';
import { setup, mkUser as dbMkUser, ADMIN_URL, API_URL } from '../db/helpers.js';
import { createDb } from '../../src/db.js';
import { loadConfig } from '../../src/config.js';
import { createStorage } from '../../src/storage/index.js';
import { onError, onNotFound } from '../../src/middleware/error.js';
import { presentationsRoutes } from '../../src/routes/presentations.js';
import { commentsRoutes } from '../../src/routes/comments.js';
import { interactionsRoutes } from '../../src/routes/interactions.js';
import { assetsRoutes } from '../../src/routes/assets.js';
import { sha256Hex } from '../../src/lib/canonical.js';

export { sha256Hex };
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXTRA_MIGRATION = path.join(HERE, 'extra-migration.sql');

/** PNG pequeno e válido; cores diferentes → bytes (e SHA-256) diferentes. */
export async function png(seed = 0, size = 8) {
  const c = { r: seed % 256, g: (seed * 7) % 256, b: (seed * 13) % 256 };
  return sharp({ create: { width: size, height: size, channels: 3, background: c } }).png().toBuffer();
}
export const asset = (sha) => `asset:sha256:${sha}`;
/** Deck mínimo válido; `extra` entra no slide 1 (texto/imagem) para variar o conteúdo. */
export function deck(title = 'Teste', { slides = 1, text = 'Olá', images = [] } = {}) {
  return {
    v: 1, app: 'AM Studio', id: 'dtest', title,
    slides: Array.from({ length: slides }, (_, i) => ({
      id: `s${i}`, bg: '#FFFFFF', tr: 'fade', layout: 'blank-light',
      els: [{ id: `t${i}`, type: 'text', x: 10, y: 10, w: 300, h: 40, html: `${text} ${i}` }, ...(i === 0 ? images.map((sha, k) => ({ id: `i${k}`, type: 'image', x: 0, y: 0, w: 10, h: 10, src: asset(sha) })) : [])],
    })),
  };
}

export async function makeEnv({ env: extraEnv = {}, poolMax = 8 } = {}) {
  const { db: setupDb, ops } = await setup();
  await setupDb.end();
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(fs.readFileSync(EXTRA_MIGRATION, 'utf8'));
  await admin.end();

  const db = createDb({ url: API_URL, max: poolMax });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-a3-'));
  const config = loadConfig({ APP_ENV: 'test', STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: dir, LOG_LEVEL: 'silent', ...extraEnv });
  const real = createStorage(config);
  const calls = { put: 0, head: 0, getStream: 0, delete: 0, signedGetUrl: 0, createUpload: 0 };
  // Contadores (provam deduplicação: quantas vezes os bytes foram realmente gravados). `hooks` substitui membros do armazenamento
  // (ex.: driver 's3' falso com createUpload/signedGetUrl) para testar o upload direto e o redirecionamento sem rede.
  const hooks = {};
  const storage = new Proxy(real, {
    get(t, k) {
      const v = Object.hasOwn(hooks, k) ? hooks[k] : t[k];
      if (typeof v !== 'function') return v;
      return (...a) => { if (k in calls) calls[k]++; return v.apply(t, a); };
    },
  });
  const deps = { config, db, storage };

  const users = new Map();
  const userOf = async (id) => {
    if (!id) return null;
    if (users.has(id)) return users.get(id);
    const [u] = await ops.asSystem((tx) => tx`select id, email, display_name, role, status from app.users where id = ${id}`).catch(() => []);
    if (!u) return null;
    const user = { id: u.id, email: u.email, displayName: u.display_name, role: u.role, status: u.status }; users.set(id, user); return user;
  };

  const app = new Hono({ strict: false });
  app.use('*', async (c, next) => {
    c.set('deps', deps); c.set('requestId', 'req-test-0001'); c.set('ip', c.req.header('x-test-ip') || '203.0.113.7'); c.set('ua', 'teste');
    c.set('user', await userOf(c.req.header('x-test-user')));
    await next();
  });
  app.route('/api/presentations', presentationsRoutes(deps));
  app.route('/api', commentsRoutes(deps));
  app.route('/api', interactionsRoutes(deps));
  app.route('/api/assets', assetsRoutes(deps));
  app.onError(onError(deps)); app.notFound(onNotFound());

  async function request(user, method, url, { json, body, headers = {}, ip } = {}) {
    const h = { ...headers };
    if (user) h['x-test-user'] = typeof user === 'string' ? user : user.id;
    if (ip) h['x-test-ip'] = ip;
    let b = body;
    if (json !== undefined) { b = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const res = await app.request(url, { method, headers: h, body: b });
    const buffer = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    let parsed = null;
    if (ct.includes('json') && buffer.length) { try { parsed = JSON.parse(buffer.toString('utf8')); } catch { /* corpo não-JSON */ } }
    return { status: res.status, headers: res.headers, buffer, text: buffer.toString('utf8'), json: parsed };
  }

  const q = (fn) => ops.asSystem(fn);
  const env = {
    app, db, ops, storage, deps, config, calls, hooks, dir, request,
    get: (u, p, o) => request(u, 'GET', p, o), post: (u, p, o) => request(u, 'POST', p, o), put: (u, p, o) => request(u, 'PUT', p, o),
    patch: (u, p, o) => request(u, 'PATCH', p, o), del: (u, p, o) => request(u, 'DELETE', p, o),
    /** Usuário ATIVO no banco (ou o status/papel pedido). Cada um tem IP próprio para os limites de taxa não se misturarem entre testes. */
    async mkUser(opts = {}) {
      const u = await dbMkUser(ops, opts);
      const user = { id: u.id, email: u.email, displayName: opts.name || 'Usuário', role: opts.role || 'member', status: opts.status || 'active' };
      const [row] = await ops.asSystem((tx) => tx`select display_name from app.users where id = ${u.id}`); user.displayName = row.display_name;
      users.set(u.id, user); return user;
    },
    sys: q,
    /** Zera os contadores de taxa (testes que não são sobre taxa não devem esbarrar nelas). */
    async resetRates() { await q((tx) => tx`delete from app.rate_limits`); },
    /** Cria uma apresentação pela API e devolve {id, rev}. */
    async create(user, title = 'Apresentação', content) {
      const r = await request(user, 'POST', '/api/presentations', { json: { title, ...(content ? { content } : {}) } });
      if (r.status !== 201) throw new Error(`create falhou: ${r.status} ${r.text}`);
      return r.json;
    },
    /** Envia uma imagem pela API e devolve o sha. */
    async upload(user, buf, kind = 'image') {
      const sha = sha256Hex(buf);
      const r = await request(user, 'PUT', `/api/assets/${sha}`, { body: buf, headers: { 'x-asset-kind': kind, 'content-type': 'application/octet-stream' } });
      if (r.status !== 200 && r.status !== 201) throw new Error(`upload falhou: ${r.status} ${r.text}`);
      return sha;
    },
    async stop() { await db.end(); await ops.end(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
  return env;
}
