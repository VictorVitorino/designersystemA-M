/* Driver S3 (AWS S3, Supabase Storage S3, Cloudflare R2, MinIO…). O bucket é SEMPRE privado: nunca enviamos ACL nem política
   pública; o navegador só acessa objetos por URL assinada de vida curta (ou pelos bytes transmitidos pela API).
   Integridade: o SHA-256 do objeto vai assinado/enviado como x-amz-checksum-sha256 quando o provedor suporta, de modo que o
   próprio servidor de objetos recusa bytes que não sejam os do hash da chave (impede sobrescrever um objeto legítimo por
   lixo via URL pré-assinada). Quando não há suporte, degradamos com elegância e confiamos no verify() do finalize. */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadBucketCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { objectKey, stagingKey, STAGING_PREFIX, shaFromKey, assertSha, assertShaPrefix, assertCursor, clampLimit, toBuffer, assertMime, contentDisposition, StorageIntegrityError, StorageKeyError } from './keys.js';
import { sha256Hex } from '../lib/canonical.js';

export const CACHE_CONTROL = 'private, max-age=31536000, immutable'; // conteúdo endereçado por hash nunca muda
const MAX_PRESIGN_TTL_S = 3600;        // URL assinada vive no máximo 1 h (padrão 5 min)
const MAX_OBJECT_BYTES = 1073741824;   // mesmo teto da tabela app.assets (1 GiB)

const isNotFound = (e) => e && (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404);
/** Erros que indicam "este servidor não entende o cabeçalho de checksum" (não confundir com BadDigest = bytes errados). */
const isChecksumUnsupported = (e) => e && (e.name === 'NotImplemented' || e.$metadata?.httpStatusCode === 501 || /^(InvalidArgument|InvalidRequest|UnsupportedHeader|MalformedXML)$/.test(e.name || '') && /checksum/i.test(e.message || ''));
const b64OfSha = (sha) => Buffer.from(sha, 'hex').toString('base64');
const clampTtl = (ttlS) => { const n = Math.floor(Number(ttlS)); if (!Number.isFinite(n) || n < 1) throw new StorageKeyError('ttl inválido'); return Math.min(n, MAX_PRESIGN_TTL_S); };

/** @param {{endpoint?:string, region?:string, bucket:string, accessKeyId?:string, secretAccessKey?:string, forcePathStyle?:boolean, checksum?:'auto'|'off'}} cfg
 *  @param {{client?: S3Client}} [opts]  `client` só para testes. */
export function createS3Storage(cfg, opts = {}) {
  if (!cfg || !cfg.bucket) throw new Error('storage s3: S3_BUCKET é obrigatório');
  const Bucket = cfg.bucket;
  const client = opts.client || new S3Client({
    region: cfg.region || 'us-east-1',
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle !== false,
    ...(cfg.accessKeyId && cfg.secretAccessKey ? { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } } : {}),
    // Retentativas e tempos FINITOS: um provedor lento não pode pendurar a função serverless nem o pool de conexões.
    maxAttempts: 3, retryMode: 'standard',
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    // SDK recente calcula CRC32 por padrão; vários S3-compatíveis ainda não aceitam. Só calculamos quando REQUERIDO e
    // mandamos NÓS MESMOS o SHA-256 (que já conhecemos) quando suportado.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  let checksumOn = cfg.checksum !== 'off'; // vira false se o provedor recusar o cabeçalho

  async function headRaw(Key) {
    try { const r = await client.send(new HeadObjectCommand({ Bucket, Key })); return { size: Number(r.ContentLength) }; }
    catch (e) { if (isNotFound(e)) return null; throw e; }
  }

  async function getRaw(sha) {
    try { return await client.send(new GetObjectCommand({ Bucket, Key: objectKey(sha) })); }
    catch (e) { if (isNotFound(e)) return null; throw e; }
  }

  function listPrefix(p) {
    if (p.length === 0) return 'a/';
    if (p.length === 1) return 'a/' + p;
    if (p.length === 2) return `a/${p}/`;
    if (p.length === 3) return `a/${p.slice(0, 2)}/${p[2]}`;
    if (p.length === 4) return `a/${p.slice(0, 2)}/${p.slice(2, 4)}/`;
    return `a/${p.slice(0, 2)}/${p.slice(2, 4)}/${p}`;
  }

  return {
    driver: 's3',

    /** Idempotente (HEAD antes de PUT). Sem ACL, sem metadados além de Content-Type e Cache-Control. */
    async put(sha, bytes, { mime, verify = true } = {}) {
      assertSha(sha); assertMime(mime);
      const body = toBuffer(bytes);
      if (body.length === 0) throw new StorageIntegrityError('objeto vazio', 'empty');
      if (body.length > MAX_OBJECT_BYTES) throw new StorageIntegrityError('objeto grande demais', 'too_large');
      if (verify && sha256Hex(body) !== sha) throw new StorageIntegrityError('os bytes não correspondem ao sha256 informado', 'sha_mismatch');
      const Key = objectKey(sha);
      const cur = await headRaw(Key);
      if (cur && cur.size === body.length) return { created: false, size: body.length };
      const params = { Bucket, Key, Body: body, ContentType: mime, CacheControl: CACHE_CONTROL, ContentLength: body.length };
      try {
        await client.send(new PutObjectCommand(checksumOn ? { ...params, ChecksumSHA256: b64OfSha(sha) } : params));
      } catch (e) {
        if (!checksumOn || !isChecksumUnsupported(e)) throw e;
        checksumOn = false; // degrada: este provedor não aceita o cabeçalho; seguimos sem ele
        await client.send(new PutObjectCommand(params));
      }
      return { created: true, size: body.length };
    },

    async get(sha) {
      const r = await getRaw(sha);
      if (!r) return null;
      const body = Buffer.from(await r.Body.transformToByteArray());
      return { body, size: body.length };
    },

    async getStream(sha) {
      const r = await getRaw(sha);
      if (!r) return null;
      return { stream: r.Body.transformToWebStream(), size: Number(r.ContentLength) };
    },

    async head(sha) { return headRaw(objectKey(sha)); },

    async delete(sha) {
      const Key = objectKey(sha);
      const existed = !!(await headRaw(Key));
      await client.send(new DeleteObjectCommand({ Bucket, Key })); // idempotente no S3
      return { deleted: existed };
    },

    /** URL assinada de leitura. Padrão `attachment`: só imagens devem ser `inline` (quem chama decide). `mime` força o Content-Type da resposta. */
    async signedGetUrl(sha, { ttlS = 300, filename, disposition = 'attachment', mime } = {}) {
      const Key = objectKey(sha);
      return getSignedUrl(client, new GetObjectCommand({
        Bucket, Key, ResponseContentDisposition: contentDisposition(disposition, filename), ...(mime ? { ResponseContentType: assertMime(mime) } : {}),
      }), { expiresIn: clampTtl(ttlS) });
    },

    /** URL assinada de ESCRITA (PUT direto do navegador). Assina content-type, content-length e o checksum SHA-256: o provedor
     *  recusa tipo/tamanho/bytes diferentes dos declarados. O cliente deve enviar exatamente `headers` (Content-Length o navegador põe). */
    async createUpload(sha, { size, mime, ttlS = 300, stagingFor = null } = {}) {
      /* stagingFor = uuid do usuário: a URL escreve em up/<usuário>/<sha> (área de preparo só dele); o finalize confere e promove (AF-2) */
      const Key = stagingFor ? stagingKey(stagingFor, sha) : objectKey(sha); assertMime(mime);
      if (!Number.isInteger(size) || size < 1 || size > MAX_OBJECT_BYTES) throw new StorageKeyError('size inválido');
      const ttl = clampTtl(ttlS);
      const params = { Bucket, Key, ContentType: mime, ContentLength: size, CacheControl: CACHE_CONTROL, ...(checksumOn ? { ChecksumSHA256: b64OfSha(sha) } : {}) };
      const signed = new Set(['content-type', 'content-length', 'cache-control', ...(checksumOn ? ['x-amz-checksum-sha256'] : [])]);
      const url = await getSignedUrl(client, new PutObjectCommand(params), {
        expiresIn: ttl,
        signableHeaders: signed,
        // o cabeçalho do checksum precisa ir como CABEÇALHO (assinado), não como parâmetro de query que o cliente poderia omitir
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      });
      const headers = { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL, ...(checksumOn ? { 'x-amz-checksum-sha256': b64OfSha(sha) } : {}) };
      return { url, method: 'PUT', headers, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
    },

    /** Área de PREPARO do upload direto (up/<usuário>/<sha>): lê o que a pessoa enviou pela URL assinada — a única prova de que ela possui os bytes. */
    async getStaging(userId, sha) {
      const Key = stagingKey(userId, sha);
      let r; try { r = await client.send(new GetObjectCommand({ Bucket, Key })); } catch (e) { if (isNotFound(e)) return null; throw e; }
      const body = Buffer.from(await r.Body.transformToByteArray()); return { body, size: body.length, etag: r.ETag || null };
    },
    /** Promove o preparo para a chave canônica (cópia no próprio provedor; se já existir, nada é regravado) e apaga o preparo. */
    async promoteStaging(userId, sha, { mime, etag = null, body = null } = {}) {
      const from = stagingKey(userId, sha), to = objectKey(sha);
      if (!(await headRaw(from))) return { promoted: false, existed: !!(await headRaw(to)), mismatch: false };
      const existed = !!(await headRaw(to));
      if (!existed) {
        try {
          /* cópia CONDICIONAL ao ETag lido na conferência do hash: se o dono da URL assinada trocou o preparo nesse meio-tempo, o provedor recusa (412) */
          await client.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${from}`, ...(etag ? { CopySourceIfMatch: etag } : {}), MetadataDirective: 'REPLACE', ...(mime ? { ContentType: assertMime(mime) } : {}), CacheControl: CACHE_CONTROL }));
        } catch (e) {
          if (e && (e.name === 'PreconditionFailed' || e.$metadata?.httpStatusCode === 412)) return { promoted: false, existed: false, mismatch: true };
          /* provedor sem CopyObject: grava os bytes JÁ CONFERIDOS pelo chamador (nunca relê o preparo, que pode ter mudado), com o checksum do hash */
          if (!body) throw e;
          await client.send(new PutObjectCommand({ Bucket, Key: to, Body: toBuffer(body), ...(mime ? { ContentType: assertMime(mime) } : {}), CacheControl: CACHE_CONTROL, ...(checksumOn ? { ChecksumSHA256: b64OfSha(sha) } : {}) }));
        }
      }
      if (!existed) {
        /* prova final, independente do provedor honrar CopySourceIfMatch: os bytes sob a chave canônica TÊM de ter o hash da chave; senão a cópia é desfeita */
        const r = await getRaw(sha); let ok = false;
        if (r) { const h = createHash('sha256'); for await (const chunk of r.Body) h.update(chunk); ok = h.digest('hex') === sha; }
        if (!ok) { await client.send(new DeleteObjectCommand({ Bucket, Key: to })).catch(() => {}); await client.send(new DeleteObjectCommand({ Bucket, Key: from })).catch(() => {}); return { promoted: false, existed: false, mismatch: true }; }
      }
      await client.send(new DeleteObjectCommand({ Bucket, Key: from }));
      return { promoted: !existed, existed, mismatch: false };
    },
    async deleteStaging(userId, sha) {
      const Key = stagingKey(userId, sha); const existed = !!(await headRaw(Key));
      await client.send(new DeleteObjectCommand({ Bucket, Key })); return { deleted: existed };
    },
    /** Apaga preparos abandonados (navegador fechado antes do finalize). Usado pelo GC. */
    async purgeStaging({ olderThanMs = 48 * 3600 * 1000, limit = 1000 } = {}) {
      let token, n = 0, bytes = 0; const cutoff = Date.now() - olderThanMs;
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: STAGING_PREFIX, ContinuationToken: token, MaxKeys: 1000 }));
        for (const o of r.Contents || []) { if (n >= limit) break; if (o.LastModified && o.LastModified.getTime() < cutoff) { await client.send(new DeleteObjectCommand({ Bucket, Key: o.Key })); n++; bytes += Number(o.Size || 0); } }
        token = r.IsTruncated && n < limit ? r.NextContinuationToken : undefined;
      } while (token);
      return { deleted: n, bytes };
    },

    /** Relê o objeto em fluxo e confere o SHA-256 (usado no finalize do upload direto). */
    async verify(sha) {
      const r = await getRaw(sha);
      if (!r) return { ok: false, size: null, actualSha: null };
      const h = createHash('sha256'); let n = 0;
      for await (const chunk of r.Body) { h.update(chunk); n += chunk.length; }
      const actualSha = h.digest('hex');
      return { ok: actualSha === sha, size: n, actualSha };
    },

    async list({ prefix = '', limit, cursor } = {}) {
      assertShaPrefix(prefix); const after = assertCursor(cursor); const max = clampLimit(limit);
      const items = [];
      // Pode haver chaves fora do formato canônico (ignoradas); pagina até encher a página ou acabar.
      let startAfter = after ? objectKey(after) : undefined, more = false;
      while (items.length < max) {
        const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: listPrefix(prefix), StartAfter: startAfter, MaxKeys: Math.min(1000, max - items.length) }));
        const page = r.Contents || [];
        for (const o of page) {
          const sha = shaFromKey(o.Key);
          if (sha && sha.startsWith(prefix)) items.push({ sha, key: o.Key, size: Number(o.Size), lastModified: o.LastModified });
        }
        if (!r.IsTruncated || !page.length) { more = false; break; }
        startAfter = page[page.length - 1].Key; more = true;
      }
      return { keys: items.map((i) => i.key), items, next: more && items.length ? items[items.length - 1].sha : null };
    },

    /** Para /api/ready: o bucket responde. */
    async ping() { try { await client.send(new HeadBucketCommand({ Bucket })); return true; } catch { return false; } },

    /** Libera sockets (testes/encerramento). */
    destroy() { client.destroy?.(); },
  };
}
