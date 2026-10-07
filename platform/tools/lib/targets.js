/* tools/lib/targets.js — destinos/origens de objetos para backup, espelho e GC.
     file:///caminho/absoluto   pasta local (ou montada)
     s3://bucket/prefixo        qualquer S3 (AWS, Cloudflare R2, Backblaze B2, Supabase Storage S3, MinIO, moto)
   Todos expõem a MESMA interface mínima:  put(key, dados) · get(key) · head(key) · list(prefix) · delete(key) · describe()
   • `key` usa "/" e é validada (sem "..", sem "/" inicial): nada escapa do prefixo/pasta.
   • put() de arquivo é atômico (grava em .partial e renomeia) e de S3 usa multipart abortável: um backup interrompido nunca vira "backup válido".
   • Credenciais do BACKUP (BACKUP_S3_*) são DIFERENTES das do armazenamento principal (S3_*): conta/bucket separados é exigência (veja assertSeparateFromPrimary). */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ToolError } from './common.js';

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._=@+ -]*(\/[A-Za-z0-9][A-Za-z0-9._=@+ -]*)*$/;
export function assertKey(key) {
  if (typeof key !== 'string' || key.length > 512 || !KEY_RE.test(key) || key.split('/').some((p) => p === '.' || p === '..')) throw new ToolError(`chave de objeto inválida: ${JSON.stringify(String(key).slice(0, 80))}`, { code: 'bad_key_name' });
  return key;
}
const toReadable = (data) => (Buffer.isBuffer(data) || typeof data === 'string' ? Readable.from([Buffer.from(data)]) : data);

// ---------------------------------------------------------------------------------------------------------------- pasta local
export class FileStore {
  constructor(root, { secure = true } = {}) { this.kind = 'file'; this.root = path.resolve(root); this.secure = secure; }
  describe() { return `file://${this.root}`; }
  _p(key) { return path.join(this.root, ...assertKey(key).split('/')); }
  async put(key, data) {
    const dest = this._p(key); await fsp.mkdir(path.dirname(dest), { recursive: true, mode: this.secure ? 0o700 : 0o755 });
    const tmp = `${dest}.partial-${crypto.randomBytes(6).toString('hex')}`;
    const ws = fs.createWriteStream(tmp, { mode: this.secure ? 0o600 : 0o644, flags: 'wx' });
    try {
      await pipeline(toReadable(data), ws);
      const fd = await fsp.open(tmp, 'r'); try { await fd.sync(); } finally { await fd.close(); }
      await fsp.rename(tmp, dest);
    } catch (e) { await fsp.rm(tmp, { force: true }); throw e; }
    return { key };
  }
  async get(key) { const p = this._p(key); try { await fsp.access(p); } catch { throw new ToolError(`objeto não encontrado: ${key}`, { code: 'not_found' }); } return fs.createReadStream(p); }
  async head(key) { try { const s = await fsp.stat(this._p(key)); return s.isFile() ? { size: s.size, lastModified: s.mtime } : null; } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; } }
  async delete(key) { await fsp.rm(this._p(key), { force: true }); }
  async *list(prefix = '') {
    const base = this.root;
    async function* walk(dir, rel) {
      let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
      ents.sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const e of ents) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) yield* walk(path.join(dir, e.name), r);
        else if (e.isFile() && !/\.partial-[0-9a-f]+$/.test(e.name)) { const st = await fsp.stat(path.join(dir, e.name)); yield { key: r, size: st.size, lastModified: st.mtime }; }
      }
    }
    // começa o passeio na pasta mais profunda do prefixo (não varre tudo em S3-like de milhões de arquivos)
    const idx = prefix.lastIndexOf('/'); const dirPart = idx >= 0 ? prefix.slice(0, idx) : '';
    for await (const o of walk(dirPart ? path.join(base, ...dirPart.split('/')) : base, dirPart)) if (o.key.startsWith(prefix)) yield o;
  }
}

// ---------------------------------------------------------------------------------------------------------------------- S3
export class S3Store {
  constructor({ bucket, prefix = '', endpoint, region = 'us-east-1', accessKeyId, secretAccessKey, forcePathStyle = true, partSize = 16 * 1024 * 1024 } = {}, S3 = null) {
    this.kind = 's3'; this.bucket = bucket; this.prefix = prefix.replace(/^\/+|\/+$/g, ''); this.endpoint = endpoint; this.partSize = Math.max(partSize, 5 * 1024 * 1024);
    this._cfg = { endpoint, region, forcePathStyle, credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined };
    this._S3 = S3; this._c = null;
  }
  describe() { return `s3://${this.bucket}/${this.prefix}${this.endpoint ? ` (${new URL(this.endpoint).host})` : ''}`; }
  async _sdk() {
    if (!this._S3) this._S3 = await import('@aws-sdk/client-s3');
    if (!this._c) this._c = new this._S3.S3Client({ ...this._cfg, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 4 });
    return { S3: this._S3, c: this._c };
  }
  _k(key) { assertKey(key); return this.prefix ? `${this.prefix}/${key}` : key; }
  async put(key, data) {
    const { S3, c } = await this._sdk(); const Key = this._k(key);
    if (Buffer.isBuffer(data) || typeof data === 'string') { await c.send(new S3.PutObjectCommand({ Bucket: this.bucket, Key, Body: Buffer.from(data) })); return { key }; }
    // fluxo: acumula até partSize; se acabar antes, PutObject simples; senão multipart (abortado em qualquer erro)
    let uploadId = null; const parts = []; let acc = []; let accLen = 0; let n = 0;
    const flushPart = async (final) => {
      const body = Buffer.concat(acc); acc = []; accLen = 0;
      if (!uploadId && final) { await c.send(new S3.PutObjectCommand({ Bucket: this.bucket, Key, Body: body })); return; }
      if (!uploadId) uploadId = (await c.send(new S3.CreateMultipartUploadCommand({ Bucket: this.bucket, Key }))).UploadId;
      n++; const r = await c.send(new S3.UploadPartCommand({ Bucket: this.bucket, Key, UploadId: uploadId, PartNumber: n, Body: body }));
      parts.push({ ETag: r.ETag, PartNumber: n });
    };
    try {
      for await (const chunk of data) { acc.push(chunk); accLen += chunk.length; if (accLen >= this.partSize) await flushPart(false); }
      if (uploadId) { if (accLen > 0) await flushPart(false); await c.send(new S3.CompleteMultipartUploadCommand({ Bucket: this.bucket, Key, UploadId: uploadId, MultipartUpload: { Parts: parts } })); }
      else await flushPart(true);
    } catch (e) {
      if (uploadId) await c.send(new S3.AbortMultipartUploadCommand({ Bucket: this.bucket, Key, UploadId: uploadId })).catch(() => {});
      throw e;
    }
    return { key };
  }
  async get(key) {
    const { S3, c } = await this._sdk();
    try { const r = await c.send(new S3.GetObjectCommand({ Bucket: this.bucket, Key: this._k(key) })); return r.Body; }
    catch (e) { if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) throw new ToolError(`objeto não encontrado: ${key}`, { code: 'not_found' }); throw e; }
  }
  async head(key) {
    const { S3, c } = await this._sdk();
    try { const r = await c.send(new S3.HeadObjectCommand({ Bucket: this.bucket, Key: this._k(key) })); return { size: r.ContentLength, lastModified: r.LastModified, etag: r.ETag }; }
    catch (e) { if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null; throw e; }
  }
  async delete(key) { const { S3, c } = await this._sdk(); await c.send(new S3.DeleteObjectCommand({ Bucket: this.bucket, Key: this._k(key) })); }
  async *list(prefix = '') {
    const { S3, c } = await this._sdk(); let token; const base = this.prefix ? `${this.prefix}/` : '';
    do {
      const r = await c.send(new S3.ListObjectsV2Command({ Bucket: this.bucket, Prefix: base + prefix, ContinuationToken: token, MaxKeys: 1000 }));
      for (const o of r.Contents || []) yield { key: o.Key.slice(base.length), size: o.Size, lastModified: o.LastModified };
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }
}

// ----------------------------------------------------------------------------------------------------------------- fábricas
const truthy = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

/** Destino de backup: 'file:///dir' | 's3://bucket/prefixo' (credenciais BACKUP_S3_*; nunca as do armazenamento principal). */
export function openTarget(spec, env = process.env) {
  if (!spec) throw new ToolError('BACKUP_TARGET não definido. Exemplos: file:///var/backups/canteiro  ou  s3://meu-bucket-de-backup/canteiro', { code: 'no_target', exit: 2 });
  let u; try { u = new URL(spec); } catch { throw new ToolError(`BACKUP_TARGET inválido: use file:///pasta ou s3://bucket/prefixo`, { code: 'bad_target', exit: 2 }); }
  if (u.protocol === 'file:') {
    const dir = decodeURIComponent(u.pathname); if (!path.isAbsolute(dir) || dir === '/') throw new ToolError('file:// precisa de um caminho absoluto e específico (ex.: file:///var/backups/canteiro)', { code: 'bad_target', exit: 2 });
    return new FileStore(dir, { secure: true });
  }
  if (u.protocol === 's3:') {
    const bucket = u.hostname; if (!bucket) throw new ToolError('s3:// precisa do nome do bucket (s3://bucket/prefixo)', { code: 'bad_target', exit: 2 });
    const miss = ['BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
    if (miss.length) throw new ToolError(`faltam ${miss.join(', ')} (credenciais próprias do bucket de backup, diferentes das do armazenamento principal)`, { code: 'no_credentials', exit: 2 });
    return new S3Store({ bucket, prefix: decodeURIComponent(u.pathname).replace(/^\//, ''), endpoint: env.BACKUP_S3_ENDPOINT || undefined, region: env.BACKUP_S3_REGION || 'us-east-1',
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY, forcePathStyle: truthy(env.BACKUP_S3_FORCE_PATH_STYLE, true) });
  }
  throw new ToolError(`BACKUP_TARGET com protocolo não suportado (${u.protocol}): use file:// ou s3://`, { code: 'bad_target', exit: 2 });
}

/** Armazenamento PRINCIPAL de arquivos da aplicação (mesma configuração da API: STORAGE_DRIVER, STORAGE_LOCAL_DIR, S3_*). */
export function openPrimaryStore(env = process.env) {
  const driver = env.STORAGE_DRIVER || 'local';
  if (driver === 'local') return new FileStore(env.STORAGE_LOCAL_DIR || './.data/objects', { secure: false });
  if (driver === 's3') {
    const miss = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
    if (miss.length) throw new ToolError(`faltam ${miss.join(', ')} para ler o armazenamento principal`, { code: 'no_credentials', exit: 2 });
    return new S3Store({ bucket: env.S3_BUCKET, prefix: '', endpoint: env.S3_ENDPOINT || undefined, region: env.S3_REGION || 'us-east-1', accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, forcePathStyle: truthy(env.S3_FORCE_PATH_STYLE, true) });
  }
  throw new ToolError(`STORAGE_DRIVER inválido: ${driver} (use local ou s3)`, { code: 'bad_config', exit: 2 });
}

/** Regras de separação: backup em bucket/conta/pasta DIFERENTE do armazenamento principal e com credenciais próprias. Devolve {errors, warnings}. */
export function assertSeparateFromPrimary(spec, env = process.env) {
  const errors = [], warnings = [];
  let u; try { u = new URL(spec); } catch { return { errors: ['BACKUP_TARGET inválido'], warnings }; }
  const driver = env.STORAGE_DRIVER || 'local';
  if (u.protocol === 'file:' && driver === 'local' && env.STORAGE_LOCAL_DIR) {
    const a = path.resolve(decodeURIComponent(u.pathname)), b = path.resolve(env.STORAGE_LOCAL_DIR);
    if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) errors.push('BACKUP_TARGET está dentro (ou contém) a pasta de arquivos principal: um erro nela apagaria os dois');
  }
  if (u.protocol === 's3:' && driver === 's3') {
    const sameBucket = u.hostname === env.S3_BUCKET && (env.BACKUP_S3_ENDPOINT || '') === (env.S3_ENDPOINT || '');
    if (sameBucket) errors.push('BACKUP_TARGET usa o MESMO bucket/endpoint do armazenamento principal: o backup precisa ficar em bucket de outra conta');
    if (env.BACKUP_S3_ACCESS_KEY_ID && env.BACKUP_S3_ACCESS_KEY_ID === env.S3_ACCESS_KEY_ID) errors.push('BACKUP_S3_ACCESS_KEY_ID é igual a S3_ACCESS_KEY_ID: use credenciais próprias para o backup');
    if (env.BACKUP_S3_ENDPOINT && env.S3_ENDPOINT && env.BACKUP_S3_ENDPOINT === env.S3_ENDPOINT) warnings.push('backup e arquivos principais estão no MESMO provedor/endpoint: prefira outro provedor ou outra conta para sobreviver a bloqueio de conta');
  }
  if (env.BACKUP_ENCRYPTION_KEY && [env.S3_SECRET_ACCESS_KEY, env.BACKUP_S3_SECRET_ACCESS_KEY, env.SUPABASE_SERVICE_ROLE_KEY].includes(env.BACKUP_ENCRYPTION_KEY)) errors.push('BACKUP_ENCRYPTION_KEY não pode ser igual a nenhuma credencial de bucket/serviço');
  return { errors, warnings };
}

// ----------------------------------------------------------------------------------------------------------------- área de preparo
/** Apaga preparos de upload direto abandonados (chaves up/<usuário>/<sha> mais antigas que `olderThanMs`). Vale para FileStore e S3Store. */
export async function purgeStaging(store, { olderThanMs = 48 * 3600 * 1000, limit = 1000, apply = true, now = Date.now() } = {}) {
  let seen = 0, deleted = 0, bytes = 0; const cutoff = now - olderThanMs;
  for await (const o of store.list('up/')) {
    seen++; const t = o.lastModified ? new Date(o.lastModified).getTime() : 0;
    if (!t || t >= cutoff) continue;
    if (deleted >= limit) break;
    if (apply) await store.delete(o.key);
    deleted++; bytes += Number(o.size || 0);
  }
  return { seen, deleted, bytes, applied: apply };
}
