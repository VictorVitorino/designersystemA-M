/* Conversão de erros no formato do contrato (docs/API.md §2). Erros inesperados NUNCA vazam mensagem/stack ao cliente. */
import { HttpError, E } from '../lib/errors.js';
import { createLogger } from '../lib/log.js';

export function onError(deps) {
  const log = createLogger(deps.config);
  return (err, c) => {
    const requestId = c.get('requestId');
    let e = err;
    if (!(e instanceof HttpError)) {
      // zod → 400 com os campos inválidos (sem eco dos valores)
      if (e && e.name === 'ZodError' && Array.isArray(e.issues)) e = E.badRequest('Dados inválidos.', { fields: e.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) });
      else if (e && (e.code === '23505')) e = E.exists('Já existe um registro igual.');
      else if (e && (e.code === '23514' || e.code === '22P02' || e.code === '22023' || e.code === '22021' || e.code === '22P05')) e = E.badRequest('Valor inválido.');   // 22021/22P05: byte NUL ou codificação inválida em texto (AF-3)
      else if (e && e.code === '42501') e = E.forbidden();
      else if (e && (e.type === 'entity.too.large' || e.name === 'PayloadTooLargeError')) e = E.tooLarge();
      else if (e instanceof SyntaxError) e = E.badRequest('JSON inválido.');
      else { log.error('unhandled', { requestId, path: c.req.path, method: c.req.method, err: String(e && e.message || e).slice(0, 300), code: e && e.code, stack: process.env.APP_ENV === 'production' ? undefined : String(e && e.stack || '').split('\n').slice(0, 4).join(' | ') }); e = E.internal(); }
    } else if (e.status >= 500) log.error('http_error', { requestId, path: c.req.path, code: e.code });
    const body = { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}), requestId } };
    return c.json(body, e.status, e.headers || {});
  };
}
export function onNotFound() {
  return (c) => c.json({ error: { code: 'not_found', message: 'Não encontrado.', requestId: c.get('requestId') } }, 404);
}
