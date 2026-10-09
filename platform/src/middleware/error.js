/* Conversão de erros no formato do contrato (docs/API.md §2). Erros inesperados NUNCA vazam mensagem/stack ao cliente. */
import { HttpError, E } from '../lib/errors.js';
import { createLogger } from '../lib/log.js';

// Mensagens/stacks de drivers podem incluir DATABASE_URL, tokens ou credenciais.
// Só códigos técnicos reconhecidos são permitidos em logs de exceções imprevistas.
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);
function safeErrorCode(error) {
  const code = error?.code;
  return typeof code === 'string' && (/^[A-Z0-9]{5}$/.test(code) || NETWORK_CODES.has(code)) ? code : undefined;
}

export function onError(deps) {
  const log = deps.logger || createLogger(deps.config);
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
      else { log.error('unhandled', { requestId, route: c.req.routePath, method: c.req.method, kind: 'internal_error', code: safeErrorCode(e) }); e = E.internal(); }
    } else if (e.status >= 500) log.error('http_error', { requestId, path: c.req.path, code: e.code });
    const body = { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}), requestId } };
    return c.json(body, e.status, e.headers || {});
  };
}
export function onNotFound() {
  return (c) => c.json({ error: { code: 'not_found', message: 'Não encontrado.', requestId: c.get('requestId') } }, 404);
}
