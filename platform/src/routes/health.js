/* Saúde (docs/API.md §8). /health não depende de nada (balanceador). /ready checa banco, armazenamento, autenticação e migrações,
   devolve só booleanos (detalhes de erro vão ao log, nunca ao cliente) e guarda o resultado por 5 s para a sonda não sobrecarregar os serviços. */
import { Hono } from 'hono';
import { createLogger } from '../lib/log.js';

const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export function healthRoutes(deps) {
  const { config, db, storage, gotrue } = deps;
  const log = deps.logger || createLogger(config);
  const r = new Hono();
  let cached = null;

  async function check(name, fn) { try { return (await withTimeout(fn(), 3000)) === true; } catch (e) { log.warn('ready_check_failed', { check: name, err: String(e && e.message || e).slice(0, 120) }); return false; } }

  async function compute() {
    const [dbOk, storageOk, authOk, migOk] = await Promise.all([
      check('db', () => db.ping()),
      // o armazenamento expõe ping(); o driver local não precisa de rede
      check('storage', async () => (storage && typeof storage.ping === 'function' ? storage.ping() : storage?.driver === 'local' || storage?.kind === 'local')),
      check('auth', () => gotrue.health()),
      // sem acesso a public.schema_migrations (o papel da API não tem): confere que os objetos centrais criados pelas migrações existem
      check('migrations', async () => {
        const [m] = await db.anon((tx) => tx`select (to_regprocedure('app.resolve_identity(text,text,text,boolean,boolean,boolean)') is not null
          and to_regprocedure('app.hit_rate(text,text,integer,integer)') is not null and to_regclass('app.presentations') is not null and to_regclass('app.assets') is not null) as ok`);
        return m.ok === true;
      }),
    ]);
    return { db: dbOk, storage: storageOk, auth: authOk, migrations: migOk };
  }

  r.get('/health', (c) => c.json({ ok: true, version: config.release, env: config.appEnv }));
  r.get('/ready', async (c) => {
    if (!cached || Date.now() - cached.at > 5000) cached = { at: Date.now(), value: await compute() };
    const v = cached.value;
    return c.json(v, Object.values(v).every(Boolean) ? 200 : 503);
  });
  return r;
}
