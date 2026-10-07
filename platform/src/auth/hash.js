/* Utilitários criptográficos pequenos usados por autenticação. */
import crypto from 'node:crypto';

/** Comparação em tempo constante (resiste a ataque de tempo). Hash dos dois lados evita vazar também o tamanho. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest(), hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** 32 bytes aleatórios em base64url (43 caracteres): token CSRF. */
export const newCsrfToken = () => crypto.randomBytes(32).toString('base64url');
export const CSRF_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Hash do e-mail para auditoria e limite de taxa: HMAC com o CSRF_SECRET como "pimenta".
    Por que HMAC e não SHA-256 puro: com SHA-256 simples, quem lesse a auditoria testaria e-mails conhecidos num dicionário.
    Em dev/teste sem CSRF_SECRET usa uma pimenta fixa (só produção exige o segredo — config.js). */
export function emailHash(config, email) {
  const pepper = config?.csrfSecret || 'canteiro-dev-pepper';
  return crypto.createHmac('sha256', pepper).update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
}

export const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret, s) => crypto.createHmac('sha256', String(secret)).update(s).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera até que `minMs` tenham passado desde `startedAt` (equaliza o tempo de respostas de falha: e-mail inexistente × senha errada). */
export async function padTo(startedAt, minMs) {
  const rest = minMs - (Date.now() - startedAt);
  if (rest > 0) await sleep(rest);
}
