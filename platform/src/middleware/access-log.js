/* Log de acesso: UMA linha JSON por requisição. Só metadados: método, rota (sem query string), status, duração, requestId, userId, ip.
   Nunca corpo, cabeçalhos nem cookies — a query string fica de fora porque pode conter tokens (ex.: links de e-mail). */
import { createLogger } from '../lib/log.js';

export function accessLog(deps) {
  const log = deps.logger || createLogger(deps.config);
  return async (c, next) => {
    const t0 = performance.now();
    try { await next(); }
    finally {
      const status = c.res?.status ?? 500;
      const fields = {
        // Somente a ROTA declarada no Hono (ex.: /api/presentations/:id), nunca a URL
        // solicitada, que pode conter nomes, códigos de convite ou tokens no próprio path.
        method: c.req.method, route: status === 404 ? 'unmatched' : (c.req.routePath || 'unmatched').slice(0, 200), status, ms: Math.round((performance.now() - t0) * 10) / 10,
        requestId: c.get('requestId'), userId: c.get('user')?.id || null, ip: c.get('ip') || null,
      };
      (status >= 500 ? log.error : log.info)('http', fields);
    }
  };
}
