/* server.js — entrada Node (desenvolvimento local, testes E2E e hospedagem em contêiner). Na Vercel a entrada é platform/api/index.js. */
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { buildDeps } from './deps.js';
import { createApp } from './app.js';
import { serveStatic } from './static.js';

/* Parar de aceitar conexões, aguardar requisições ativas e SÓ ENTÃO fechar o pool.
   No Render um SIGTERM pode chegar durante PUT /content: fechar o Postgres
   antes de server.close() terminar interromperia o salvamento em andamento.
   No limite de espera, o Node encerra conexões restantes e libera o pool. */
export function createGracefulStop(server, db, { graceMs = 12_000 } = {}) {
  if (!Number.isInteger(graceMs) || graceMs < 1) throw new TypeError('graceMs inválido');
  let stopping = null;
  return function stop() {
    if (stopping) return stopping; // SIGINT, SIGTERM e stop() juntos não fecham o pool 2 vezes
    stopping = (async () => {
      let timer;
      try {
        const closed = new Promise((resolve, reject) => {
          try {
            server.close((err) => {
              if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
              else resolve();
            });
          } catch (e) {
            if (e?.code === 'ERR_SERVER_NOT_RUNNING') resolve();
            else reject(e);
          }
        });
        const deadline = new Promise((resolve) => {
          timer = setTimeout(() => {
            try { server.closeAllConnections?.(); } catch { /* fechando de qualquer forma */ }
            resolve();
          }, graceMs);
        });
        await Promise.race([closed, deadline]);
      } finally {
        clearTimeout(timer);
        await db.end();
      }
    })();
    return stopping;
  };
}

export async function start(env = process.env) {
  const config = loadConfig(env);
  const deps = buildDeps(config);
  const api = createApp(deps);
  const app = serveStatic(api, config);
  const server = serve({ fetch: app.fetch, port: config.port }, (i) => console.log(JSON.stringify({ level: 'info', msg: 'listening', port: i.port, env: config.appEnv, origin: config.origin })));
  const drain = createGracefulStop(server, deps.db);
  const stop = () => {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    return drain();
  };
  const onSignal = () => { void stop().catch(() => { console.error(JSON.stringify({ level: 'error', msg: 'shutdown_failed' })); process.exitCode = 1; }); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  return { server, deps, stop };
}
if (import.meta.url === `file://${process.argv[1]}`) start().catch((e) => { console.error(JSON.stringify({ level: 'fatal', msg: String(e.message) })); process.exit(1); });
