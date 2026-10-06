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
        method: c.req.method, route: c.req.path.slice(0, 200), status, ms: Math.round((performance.now() - t0) * 10) / 10,
        requestId: c.get('requestId'), userId: c.get('user')?.id || null, ip: c.get('ip') || null,
      };
      (status >= 500 ? log.error : log.info)('http', fields);
    }
  };
}
