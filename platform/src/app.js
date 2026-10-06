/* app.js — composição da API (Hono). Cada parte tem dono e contrato em docs/API.md.
   Ordem dos middlewares importa: id → cabeçalhos de segurança → log → CSRF → sessão → rotas. */
import { Hono } from 'hono';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { accessLog } from './middleware/access-log.js';
import { csrf } from './middleware/csrf.js';
import { session } from './middleware/session.js';
import { onError, onNotFound } from './middleware/error.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { healthRoutes } from './routes/health.js';
import { presentationsRoutes } from './routes/presentations.js';
import { commentsRoutes } from './routes/comments.js';
import { interactionsRoutes } from './routes/interactions.js';
import { assetsRoutes } from './routes/assets.js';

/** @param {{config:object, db:object, storage:object, gotrue:object, sessionOverride?:Function}} deps
 *  sessionOverride só existe em APP_ENV=test (testes de rotas sem passar pelo GoTrue); em qualquer outro ambiente é ignorado e a partida falha. */
export function createApp(deps) {
  const { config } = deps;
  if (deps.sessionOverride && config.appEnv !== 'test') throw new Error('sessionOverride só é permitido em APP_ENV=test');
  const app = new Hono({ strict: false });
  app.use('*', async (c, next) => { c.set('deps', deps); await next(); });
  app.use('*', requestId());
  app.use('*', securityHeaders(config));
  app.use('/api/*', accessLog(deps));
  app.use('/api/*', csrf(config));
  app.use('/api/*', deps.sessionOverride || session(deps));
  app.route('/api', healthRoutes(deps));
  app.route('/api/auth', authRoutes(deps));
  app.route('/api/me', authRoutes.me ? authRoutes.me(deps) : new Hono());
  app.route('/api/admin', adminRoutes(deps));
  app.route('/api/presentations', presentationsRoutes(deps));
  app.route('/api', commentsRoutes(deps));      // /presentations/:id/comments e /comments/:id
  app.route('/api', interactionsRoutes(deps));  // /presentations/:id/interactions(.csv)
  app.route('/api/assets', assetsRoutes(deps));
  app.onError(onError(deps));
  app.notFound(onNotFound());
  return app;
}
