/* Identificador da requisição + contexto básico (ip, user-agent) que os outros middlewares e as rotas usam.
   Aceita o X-Request-Id do cliente só se tiver formato seguro (evita injeção em logs/cabeçalhos); senão gera um novo. */
import crypto from 'node:crypto';
import { clientIp } from '../lib/ip.js';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function requestId() {
  return async (c, next) => {
    const given = c.req.header('x-request-id');
    const id = given && ID_RE.test(given) ? given : crypto.randomUUID();
    c.set('requestId', id);
    const config = c.get('deps')?.config;
    c.set('ip', clientIp(c, config));
    // user-agent: corta e remove caracteres de controle (vai para auditoria/log)
    c.set('ua', (c.req.header('user-agent') || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 300) || null);
    c.set('user', null);
    await next();
    try { c.res.headers.set('X-Request-Id', id); } catch { c.res = new Response(c.res.body, { status: c.res.status, headers: new Headers(c.res.headers) }); c.res.headers.set('X-Request-Id', id); }
  };
}
