/* server.js — entrada Node (desenvolvimento local, testes E2E e hospedagem em contêiner). Na Vercel a entrada é platform/api/index.js. */
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { buildDeps } from './deps.js';
import { createApp } from './app.js';
import { serveStatic } from './static.js';

export async function start(env = process.env) {
  const config = loadConfig(env);
  const deps = buildDeps(config);
  const api = createApp(deps);
  const app = serveStatic(api, config);
  const server = serve({ fetch: app.fetch, port: config.port }, (i) => console.log(JSON.stringify({ level: 'info', msg: 'listening', port: i.port, env: config.appEnv, origin: config.origin })));
  const stop = async () => { server.close(); await deps.db.end(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return { server, deps, stop };
}
if (import.meta.url === `file://${process.argv[1]}`) start().catch((e) => { console.error(JSON.stringify({ level: 'fatal', msg: String(e.message) })); process.exit(1); });
