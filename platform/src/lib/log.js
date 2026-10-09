/* Log estruturado (uma linha JSON por evento) em stdout — a Vercel/Supabase/qualquer agregador coleta. NUNCA registra segredos:
   chaves sensíveis são redigidas e o corpo de requisições/respostas nunca entra no log. */
import { redact } from './request.js';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

// Exceções de Auth, JWT e provedores são dados externos: code, reason e name
// podem conter textos livres, URLs ou tokens. Só devolvemos categorias fixas,
// inclusive se o erro não for um Error ou tiver propriedades maliciosas.
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'EPIPE']);
export function safeExceptionKind(error) {
  if (error?.code === 'ETIMEDOUT' || error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (NETWORK_CODES.has(error?.code)) return 'network';
  if (error?.name === 'JwtRejected') return 'jwt_rejected';
  return 'dependency_error';
}
export function createLogger(config) {
  const min = LEVELS[config?.logLevel || 'info'] ?? 20;
  const out = (level, msg, fields) => {
    if (LEVELS[level] < min) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, env: config?.appEnv, release: config?.release, ...(fields ? redact(fields) : {}) });
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  };
  return { debug: (m, f) => out('debug', m, f), info: (m, f) => out('info', m, f), warn: (m, f) => out('warn', m, f), error: (m, f) => out('error', m, f) };
}
