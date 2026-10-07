/* tools/lib/backup-crypto.js — criptografia autenticada de backups (AES-256-GCM em blocos, com cabeçalho versionado).

   Por que em blocos: backups e arquivos podem ter GB; precisamos cifrar/decifrar em fluxo (memória constante) e ainda assim detectar
   adulteração, reordenação de blocos e TRUNCAMENTO (um arquivo cortado no meio não pode parecer "válido").

   Formato (v1), tudo big-endian:
     cabeçalho (52 bytes)
       0..4   magic "CNTBK"
       5      versão do formato (1)
       6      algoritmo (1 = AES-256-GCM)
       7      reservado (0)
       8..11  tamanho do bloco em claro (padrão 1 MiB)
       12..19 kid: impressão digital da chave (8 bytes) — só para dar mensagem clara "chave errada"; não revela a chave
       20..51 salt aleatório do arquivo (32 bytes)
     N registros (N ≥ 1)
       4 bytes  campo de tamanho: tamanho do texto cifrado (bits 0..30) | bit 31 = "último bloco"
       12 bytes nonce aleatório do bloco
       T bytes  texto cifrado
       16 bytes tag GCM
   Chave do arquivo = HKDF-SHA256(chave_mestra, salt, "canteiro-backup/v1/file"): cada arquivo tem a sua chave (nonce aleatório de 96 bits é seguro).
   AAD de cada bloco = cabeçalho(52) || índice do bloco (u64) || flag "último" (u8). Logo:
     • trocar/retirar/duplicar blocos muda o índice → falha de autenticação;
     • cortar o arquivo remove o bloco "último" → erro de truncamento;
     • mexer no cabeçalho invalida todos os blocos.
   A chave mestra (BACKUP_ENCRYPTION_KEY, 32 bytes em base64) NUNCA é guardada junto do backup nem das credenciais do bucket. */
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { ToolError, canonicalJson } from './common.js';

export const MAGIC = Buffer.from('CNTBK');
export const FORMAT_VERSION = 1;
export const ALG_AES256GCM = 1;
export const HEADER_LEN = 52;
export const DEFAULT_CHUNK = 1024 * 1024;
export const MAX_CHUNK = 64 * 1024 * 1024;
const NONCE_LEN = 12, TAG_LEN = 16, LAST_FLAG = 0x80000000;
export const RECORD_OVERHEAD = 4 + NONCE_LEN + TAG_LEN;

export const KEY_HELP = 'gere no cofre de senhas uma senha de EXATAMENTE 43 letras e números (sem símbolos) — ou rode  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"  — e guarde-a em 2 lugares (sem ela o backup não abre)';

/** base64 → Buffer de 32 bytes, com mensagens úteis (nunca imprime a chave). */
export function parseKey(b64, name = 'BACKUP_ENCRYPTION_KEY') {
  if (!b64 || !String(b64).trim()) throw new ToolError(`${name} não definida: ${KEY_HELP}`, { code: 'no_key', exit: 2 });
  const s = String(b64).trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) throw new ToolError(`${name} não é base64 válido: ${KEY_HELP}`, { code: 'bad_key', exit: 2 });
  const key = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) throw new ToolError(`${name} precisa ter exatamente 32 bytes em base64 — 43 letras/números, ou 44 caracteres terminando em "=" (veio com ${s.length} caracteres = ${key.length} bytes): ${KEY_HELP}`, { code: 'bad_key', exit: 2 });
  return key;
}
/** Lê a chave atual e as antigas (rotação): BACKUP_ENCRYPTION_KEY e BACKUP_ENCRYPTION_KEYS_OLD (separadas por vírgula). */
export function keyringFromEnv(env = process.env) {
  const current = parseKey(env.BACKUP_ENCRYPTION_KEY);
  const old = (env.BACKUP_ENCRYPTION_KEYS_OLD || '').split(',').map((s) => s.trim()).filter(Boolean).map((k, i) => parseKey(k, `BACKUP_ENCRYPTION_KEYS_OLD[${i}]`));
  return { current, all: [current, ...old] };
}

export function keyId(key) { return crypto.createHmac('sha256', key).update('canteiro-backup/v1/kid').digest().subarray(0, 8); }
const fileKey = (master, salt) => Buffer.from(crypto.hkdfSync('sha256', master, salt, 'canteiro-backup/v1/file', 32));

function buildHeader({ chunkSize, kid, salt }) {
  const h = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(h, 0); h[5] = FORMAT_VERSION; h[6] = ALG_AES256GCM; h[7] = 0;
  h.writeUInt32BE(chunkSize, 8); kid.copy(h, 12); salt.copy(h, 20);
  return h;
}
function aad(header, index, last) {
  const a = Buffer.alloc(HEADER_LEN + 9); header.copy(a, 0); a.writeBigUInt64BE(BigInt(index), HEADER_LEN); a[HEADER_LEN + 8] = last ? 1 : 0; return a;
}

/** Tamanho exato do arquivo cifrado para `plainSize` bytes (permite comparar com `head` do destino sem baixar). */
export function encryptedSize(plainSize, chunkSize = DEFAULT_CHUNK) {
  const n = Math.max(1, Math.ceil(plainSize / chunkSize));
  return HEADER_LEN + plainSize + n * RECORD_OVERHEAD;
}

/** Transform: bytes em claro → formato cifrado. */
export function createEncryptStream(masterKey, { chunkSize = DEFAULT_CHUNK } = {}) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new ToolError('chave de backup inválida (esperados 32 bytes)', { code: 'bad_key', exit: 2 });
  if (!Number.isInteger(chunkSize) || chunkSize < 1024 || chunkSize > MAX_CHUNK) throw new Error('chunkSize fora de 1 KiB..64 MiB');
  const salt = crypto.randomBytes(32), header = buildHeader({ chunkSize, kid: keyId(masterKey), salt }), key = fileKey(masterKey, salt);
  let buf = Buffer.alloc(0), index = 0, wroteHeader = false;
  const seal = (plain, last) => {
    const nonce = crypto.randomBytes(NONCE_LEN);
    const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
    c.setAAD(aad(header, index++, last));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    const len = Buffer.alloc(4); len.writeUInt32BE((ct.length | (last ? LAST_FLAG : 0)) >>> 0, 0);
    return Buffer.concat([len, nonce, ct, c.getAuthTag()]);
  };
  const head = (self) => { if (!wroteHeader) { wroteHeader = true; self.push(header); } };
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        head(this); buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        // só emite um bloco cheio quando há MAIS dados depois dele: o último bloco (marcado) sai no flush
        while (buf.length > chunkSize) { this.push(seal(buf.subarray(0, chunkSize), false)); buf = buf.subarray(chunkSize); }
        cb();
      } catch (e) { cb(e); }
    },
    flush(cb) { try { head(this); this.push(seal(buf, true)); buf = Buffer.alloc(0); cb(); } catch (e) { cb(e); } },
  });
}

/** Transform: formato cifrado → bytes em claro. Falha (erro no stream) em chave errada, adulteração, truncamento ou sobra de bytes. */
export function createDecryptStream(keys) {
  const ring = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  if (!ring.length) throw new ToolError('nenhuma chave de backup informada', { code: 'no_key', exit: 2 });
  let buf = Buffer.alloc(0), header = null, key = null, index = 0, finished = false, chunkSize = 0;
  const bad = (msg, code = 'corrupt') => new ToolError(msg, { code });
  const parseHeader = () => {
    const h = buf.subarray(0, HEADER_LEN);
    if (!h.subarray(0, 5).equals(MAGIC)) throw bad('o arquivo não é um backup do Canteiro (cabeçalho inválido)', 'not_backup');
    if (h[5] !== FORMAT_VERSION || h[6] !== ALG_AES256GCM) throw bad(`formato de backup não suportado (versão ${h[5]}, algoritmo ${h[6]})`, 'unsupported');
    chunkSize = h.readUInt32BE(8);
    if (chunkSize < 1024 || chunkSize > MAX_CHUNK) throw bad('cabeçalho do backup inválido (tamanho de bloco)');
    const kid = h.subarray(12, 20), master = ring.find((k) => keyId(k).equals(kid));
    if (!master) throw bad('a chave informada não é a que cifrou este backup (BACKUP_ENCRYPTION_KEY errada ou rotacionada: tente BACKUP_ENCRYPTION_KEYS_OLD)', 'wrong_key');
    header = Buffer.from(h); key = fileKey(master, h.subarray(20, 52)); buf = buf.subarray(HEADER_LEN);
  };
  const open = (self) => {
    for (;;) {
      if (finished) { if (buf.length) throw bad('há dados após o fim do backup (arquivo adulterado ou concatenado)', 'trailing_data'); return; }
      if (buf.length < 4) return;
      const field = buf.readUInt32BE(0), last = (field & LAST_FLAG) !== 0, ctLen = field & 0x7fffffff;
      if (ctLen > chunkSize) throw bad('bloco maior que o permitido (arquivo corrompido ou adulterado)');
      const total = 4 + NONCE_LEN + ctLen + TAG_LEN;
      if (buf.length < total) return;
      const nonce = buf.subarray(4, 4 + NONCE_LEN), ct = buf.subarray(4 + NONCE_LEN, 4 + NONCE_LEN + ctLen), tag = buf.subarray(4 + NONCE_LEN + ctLen, total);
      const d = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
      d.setAAD(aad(header, index, last)); d.setAuthTag(tag);
      let plain;
      try { plain = Buffer.concat([d.update(ct), d.final()]); } catch { throw bad(`falha de autenticação no bloco ${index}: o backup foi adulterado, reordenado ou está corrompido`, 'tampered'); }
      index++; self.push(plain); buf = buf.subarray(total); if (last) finished = true;
    }
  };
  return new Transform({
    transform(chunk, _e, cb) {
      try { buf = buf.length ? Buffer.concat([buf, chunk]) : chunk; if (!header && buf.length >= HEADER_LEN) parseHeader(); if (header) open(this); cb(); } catch (e) { cb(e); }
    },
    flush(cb) {
      if (!header) return cb(bad(buf.length ? 'arquivo de backup truncado (cabeçalho incompleto)' : 'arquivo de backup vazio', 'truncated'));
      if (!finished) return cb(bad(`arquivo de backup TRUNCADO: o último bloco não chegou (lidos ${index} blocos)`, 'truncated'));
      cb();
    },
  });
}

/** Decifra um Buffer inteiro (para arquivos pequenos e testes). */
export function decryptBuffer(keys, data) {
  const t = createDecryptStream(keys); const out = [];
  return new Promise((resolve, reject) => { t.on('data', (c) => out.push(c)); t.on('error', reject); t.on('end', () => resolve(Buffer.concat(out))); t.end(data); });
}
export function encryptBuffer(key, data, opts) {
  const t = createEncryptStream(key, opts); const out = [];
  return new Promise((resolve, reject) => { t.on('data', (c) => out.push(c)); t.on('error', reject); t.on('end', () => resolve(Buffer.concat(out))); t.end(data); });
}

// ---- Manifesto: autenticado por HMAC (chave derivada, distinta da usada nos blocos) -----------------------------------------------
const manifestKey = (master) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'canteiro-backup/v1/manifest', 32));
export function manifestMac(masterKey, manifest) {
  const { mac, ...rest } = manifest;
  return 'hmac-sha256:' + crypto.createHmac('sha256', manifestKey(masterKey)).update(canonicalJson(rest)).digest('hex');
}
export function signManifest(masterKey, manifest) { const { mac, ...rest } = manifest; return { ...rest, mac: manifestMac(masterKey, rest) }; }
/** Procura entre as chaves a que valida o MAC; devolve true/false. */
export function verifyManifest(keys, manifest) {
  const ring = Array.isArray(keys) ? keys : [keys]; if (!manifest?.mac) return false;
  const want = Buffer.from(String(manifest.mac));
  return ring.some((k) => { const got = Buffer.from(manifestMac(k, manifest)); return got.length === want.length && crypto.timingSafeEqual(got, want); });
}
