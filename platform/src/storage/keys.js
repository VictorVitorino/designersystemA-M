/* Chaves de objeto e utilitários de segurança do armazenamento.
   REGRA ÚNICA: a chave do objeto é derivada SOMENTE de um SHA-256 já validado (64 hex minúsculos). Nenhum nome de arquivo,
   caminho ou texto do cliente entra na chave — por isso não existe path traversal por construção. */

export const SHA_RE = /^[0-9a-f]{64}$/;
export const KEY_PREFIX = 'a/';

/** Erro de uso do armazenamento (chave/prefixo/cursor inválido). É erro de programação/ataque, nunca texto para o usuário. */
export class StorageKeyError extends TypeError {
  constructor(message) { super(message); this.name = 'StorageKeyError'; this.code = 'invalid_object_key'; }
}
/** Integridade violada (bytes não correspondem ao SHA-256 declarado, objeto adulterado, symlink inesperado…). */
export class StorageIntegrityError extends Error {
  constructor(message, code = 'integrity') { super(message); this.name = 'StorageIntegrityError'; this.code = code; }
}

/** Valida e devolve o sha; lança se não for exatamente 64 hex minúsculos (typeof estrito: objetos com toString não passam). */
export function assertSha(sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new StorageKeyError('sha256 inválido');
  return sha;
}

/** a/<sha[0..2]>/<sha[2..4]>/<sha> — dois níveis de diretório evitam pastas com milhões de arquivos (e prefixos "quentes" no S3). */
export function objectKey(sha) {
  assertSha(sha);
  return `${KEY_PREFIX}${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
}

/** Inverso de objectKey: devolve o sha ou null se a chave não tiver exatamente o formato canônico. */
export function shaFromKey(key) {
  if (typeof key !== 'string') return null;
  const m = /^a\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(key);
  return m && m[3].startsWith(m[1] + m[2]) ? m[3] : null;
}

/** Prefixo de listagem: 0–64 hex minúsculos (prefixo de SHA, não de caminho). */
export function assertShaPrefix(prefix = '') {
  if (typeof prefix !== 'string' || !/^[0-9a-f]{0,64}$/.test(prefix)) throw new StorageKeyError('prefixo inválido');
  return prefix;
}
/** Cursor de listagem = último sha devolvido na página anterior. */
export function assertCursor(cursor) {
  if (cursor == null || cursor === '') return null;
  return assertSha(cursor);
}
export function clampLimit(limit, def = 1000, max = 1000) {
  const n = limit == null ? def : Number(limit);
  if (!Number.isInteger(n) || n < 1) throw new StorageKeyError('limit inválido');
  return Math.min(n, max);
}

/** Converte Buffer/Uint8Array/ArrayBuffer em Buffer sem copiar quando possível; recusa qualquer outra coisa (inclusive string). */
export function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError('bytes deve ser Buffer/Uint8Array');
}

const MIME_RE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]{0,100}$/;
/** O mime vem da validação por magic bytes (asset-validate), mas é conferido de novo antes de virar cabeçalho/metadado. */
export function assertMime(mime) {
  if (typeof mime !== 'string' || mime.length > 127 || !MIME_RE.test(mime)) throw new StorageKeyError('mime inválido');
  return mime;
}

/** Cabeçalho Content-Disposition seguro (RFC 6266/5987): sem aspas, barras, CR/LF nem controles; fallback ASCII + filename*.
 *  Padrão `attachment`: só imagens devem ser `inline`, e quem chama decide. */
export function contentDisposition(disposition = 'attachment', filename) {
  const kind = disposition === 'inline' ? 'inline' : 'attachment';
  if (filename == null || filename === '') return kind;
  let name = String(filename).normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/[\\/:*?"<>|;%]/g, '_').trim().slice(0, 120);
  if (!name || /^\.+$/.test(name)) name = 'arquivo';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`;
}
