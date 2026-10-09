/* Saúde (docs/API.md §8). /health não depende de nada (balanceador). /ready checa banco, armazenamento, autenticação e migrações,
   devolve só booleanos (detalhes de erro vão ao log, nunca ao cliente) e guarda o resultado por 5 s para a sonda não sobrecarregar os serviços. */
import { Hono } from 'hono';
import { createLogger } from '../lib/log.js';

const READY_TTL_MS = 5000;
const READY_TIMEOUT_MS = 3000;

/* Cancelar o temporizador depois da checagem evita milhares de timers pendentes sob carga.
   A operação subjacente pode terminar depois do prazo, mas não altera o resultado publicado. */
async function withTimeout(fn, ms) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ready_timeout' })), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function healthRoutes(deps) {
  const { config, db, storage, gotrue } = deps;
  const log = deps.logger || createLogger(config);
  const r = new Hono();
  let cached = null;
  let inflight = null;

  async function check(name, fn) {
    try { return (await withTimeout(fn, READY_TIMEOUT_MS)) === true; }
    catch (e) {
      // Nunca registrar e.message: drivers externos podem incluir URLs, senhas e tokens no erro.
      log.warn('ready_check_failed', { check: name, kind: e?.code === 'ready_timeout' ? 'timeout' : 'dependency_error' });
      return false;
    }
  }

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

  /* Single-flight: sondas paralelas compartilham UMA medição de DB/Auth/Storage/migrações.
     O TTL começa na conclusão (não no começo) e inclui o estado indisponível, sem mascarar
     falhas após o vencimento. Não mantemos uma Promise rejeitada presa no cache. */
  async function readyState() {
    if (cached && Date.now() - cached.at < READY_TTL_MS) return cached.value;
    if (!inflight) {
      inflight = compute().then((value) => {
        cached = { at: Date.now(), value };
        return value;
      }).finally(() => { inflight = null; });
    }
    return inflight;
  }

  r.get('/health', (c) => c.json({ ok: true, version: config.release, env: config.appEnv }));
  r.get('/ready', async (c) => {
    const v = await readyState();
    return c.json(v, Object.values(v).every(Boolean) ? 200 : 503);
  });
  return r;
}
