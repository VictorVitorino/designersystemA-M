/* Erros HTTP tipados. Rotas lançam HttpError; o middleware de erro (app.js) converte no formato do contrato (docs/API.md §2).
   Mensagens são em pt-BR e SEM dados sensíveis (nunca ecoar senha, token, SQL ou stack ao cliente). */
export class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {object} [details] @param {Record<string,string>} [headers] */
  constructor(status, code, message, details, headers) { super(message); this.name = 'HttpError'; this.status = status; this.code = code; this.details = details; this.headers = headers; }
}
export const E = {
  badRequest: (message = 'Requisição inválida.', details) => new HttpError(400, 'invalid_request', message, details),
  unauthenticated: (message = 'Entre para continuar.') => new HttpError(401, 'unauthenticated', message),
  sessionExpired: () => new HttpError(401, 'session_expired', 'Sua sessão expirou. Entre novamente.'),
  invalidCredentials: () => new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos.'),
  forbidden: (message = 'Você não tem permissão para isso.') => new HttpError(403, 'forbidden', message),
  notInvited: () => new HttpError(403, 'not_invited', 'Este e-mail não tem convite. Peça acesso a um administrador.'),
  suspended: () => new HttpError(403, 'suspended', 'Sua conta está suspensa. Fale com um administrador.'),
  csrf: () => new HttpError(403, 'csrf', 'Requisição bloqueada por segurança. Recarregue a página e tente de novo.'),
  notFound: (message = 'Não encontrado.') => new HttpError(404, 'not_found', message),
  conflict: (message, details) => new HttpError(409, 'conflict', message, details),
  exists: (message = 'Já existe.') => new HttpError(409, 'already_exists', message),
  gone: (message = 'Este link expirou ou já foi usado.') => new HttpError(410, 'link_invalid', message),
  tooLarge: (message = 'Arquivo ou conteúdo grande demais.') => new HttpError(413, 'too_large', message),
  quotaExceeded: (message, details) => new HttpError(413, 'quota_exceeded', message, details),
  unsupported: (message = 'Tipo de arquivo não aceito.') => new HttpError(415, 'unsupported_media', message),
  rejected: (message = 'Conteúdo recusado por segurança.', details) => new HttpError(422, 'rejected_content', message, details),
  rateLimited: (retryAfterS = 60) => new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde um pouco e tente de novo.', { retryAfterS }, { 'Retry-After': String(retryAfterS) }),
  internal: () => new HttpError(500, 'internal', 'Algo deu errado. Tente novamente em instantes.'),
  notConfigured: (message = 'Recurso ainda não configurado.') => new HttpError(501, 'not_configured', message),
  unavailable: (message = 'Serviço indisponível no momento.') => new HttpError(503, 'unavailable', message),
};
