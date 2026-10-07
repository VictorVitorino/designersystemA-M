/* Arquivos (docs/API.md §5). Montado em /api/assets. Bytes ficam no armazenamento de objetos (bucket PRIVADO), endereçados pelo SHA-256; o banco guarda só metadados.
   Garantias desta camada:
   • tipo/tamanho/estrutura vêm dos BYTES (lib/asset-validate.js) — nome e Content-Type do cliente são ignorados; SVG/HTML nunca entram;
   • o SHA-256 é recalculado no servidor e TEM de bater com o da URL (ninguém grava bytes diferentes sob o hash de outro arquivo);
   • ordem segura: registrar (pending) → gravar no armazenamento → só então promover a ready (app.asset_mark_ready). Nunca há "ready" sem objeto;
   • deduplicação: bytes já existentes não são regravados; quem reenvia os mesmos bytes só ganha a POSSE (app.asset_uploads) — a prova de que os possui;
   • leitura: só quem pode ver o arquivo (policy assets_select) — 404 para os demais, sem distinguir "não existe" de "não é seu". */
import { Hono } from 'hono';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { E } from '../lib/errors.js';
import { requireUser, txAsUser, audit } from '../lib/request.js';
import { createLogger } from '../lib/log.js';
import { sha256Hex } from '../lib/canonical.js';
import { validateUpload, LIMITS, MIME } from '../lib/asset-validate.js';
import { contentDisposition } from '../storage/keys.js';
import { rate, RATES, readBodyLimited, readJsonBody } from '../lib/presentations-service.js';

const SHA_RE = /^[0-9a-f]{64}$/;
const KINDS = ['image', 'thumb', 'attachment'];
const KIND_MIMES = {
  image: [MIME.png, MIME.jpeg, MIME.webp, MIME.gif],
  thumb: [MIME.png, MIME.jpeg, MIME.webp],
  attachment: [MIME.pdf, MIME.pptx, MIME.csv],
};
const EXT = { [MIME.png]: 'png', [MIME.jpeg]: 'jpg', [MIME.webp]: 'webp', [MIME.gif]: 'gif', [MIME.pdf]: 'pdf', [MIME.pptx]: 'pptx', [MIME.csv]: 'csv' };
const STREAM_LIMIT = 8 * 1024 * 1024;     // acima disso (e havendo URL assinada) a resposta é 302 para o armazenamento

const sha = z.string().regex(SHA_RE, 'Hash inválido.');
const CheckBody = z.object({ shas: z.array(sha).max(200) }).strict();
const UploadsBody = z.object({ sha256: sha, size: z.number().int().min(1).max(LIMITS.pdfBytes), mime: z.enum([...new Set(Object.values(KIND_MIMES).flat())]), kind: z.enum(KINDS) }).strict()
  .refine((b) => KIND_MIMES[b.kind].includes(b.mime), { message: 'Tipo incompatível com a finalidade do envio.', path: ['mime'] });

const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

export function assetsRoutes(deps) {
  const { config, storage } = deps;
  const log = deps.logger || createLogger(config);
  const r = new Hono();

  /** Limite efetivo: o menor entre o padrão do tipo (25 MB imagem, 100 MB anexo…) e a configuração `uploads.max_bytes` do admin. */
  async function capFor(tx, kind) {
    const [s] = await tx`select value from app.settings where key = 'uploads.max_bytes'`;
    const set = Number(s && s.value); const def = LIMITS.kindBytes[kind];
    return Number.isInteger(set) && set > 0 ? Math.min(set, def) : def;
  }
  const kindOf = (c) => {
    const k = c.req.header('x-asset-kind') || 'image';
    if (!KINDS.includes(k)) throw E.badRequest('Tipo de envio inválido (use image, thumb ou attachment).', { fields: [{ path: 'X-Asset-Kind', message: 'use image, thumb ou attachment' }] });
    return k;
  };
  const shaParam = (c) => { const v = c.req.param('sha256'); if (!SHA_RE.test(v)) throw E.badRequest('Hash inválido.'); return v; };
  const reasonsOf = (e) => (e && e.details && Array.isArray(e.details.reasons) ? e.details.reasons.slice(0, 5) : [e && e.code]);
  /** Rejeição vira auditoria (sem os bytes). Falha de auditoria nunca muda a resposta. */
  async function auditReject(c, shaHex, e, extra = {}) {
    try { await txAsUser(c, (tx) => audit(tx, c, 'asset.reject', 'asset', shaHex, { reasons: reasonsOf(e), status: e && e.status, ...extra })); } catch { /* melhor-esforço */ }
  }
  /** Registra o envio como `pending` (conflito = o arquivo já existia: não é erro). Devolve true se a linha foi criada agora. NÃO concede posse. */
  async function registerPending(tx, userId, a) {
    const ins = await tx`insert into app.assets(sha256, size_bytes, mime, kind, width, height, status, uploaded_by)
        values (${a.sha}, ${a.size}::bigint, ${a.mime}, ${a.kind}, ${a.width ?? null}, ${a.height ?? null}, 'pending', ${userId}::uuid)
        on conflict (sha256) do nothing returning sha256`;
    return ins.length === 1;
  }
  /** Posse (app.asset_uploads) = prova de que a pessoa tem os bytes. Só é concedida depois que o servidor conferiu o SHA-256 do que ELA enviou. */
  async function grantOwnership(tx, userId, sha) { await tx`insert into app.asset_uploads(sha256, user_id) values (${sha}, ${userId}::uuid) on conflict do nothing`; }
  /** Caminho da API: os bytes já foram conferidos pelo chamador → registra e concede a posse de uma vez. */
  async function register(tx, userId, a) { const created = await registerPending(tx, userId, a); await grantOwnership(tx, userId, a.sha); return created; }
  const publicInfo = (a, deduplicated) => ({ sha256: a.sha, size: a.size, mime: a.mime, ...(a.width != null ? { width: a.width, height: a.height } : {}), deduplicated });

  // ------------------------------------------------------------------ o que falta enviar
  r.post('/check', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'upload', ...RATES.upload);
    const body = await readJsonBody(c, CheckBody, 32 * 1024);
    const want = [...new Set(body.shas)];
    const have = want.length
      ? new Set((await txAsUser(c, (tx) => tx`select sha256 from app.assets where sha256 = any(${want}::text[]) and status = 'ready'`)).map((x) => x.sha256))   // RLS: só os que ELE pode usar
      : new Set();
    return c.json({ missing: want.filter((s) => !have.has(s)) }, 200, { 'Cache-Control': 'no-store' });
  });

  // ------------------------------------------------------------------ upload pela API (≤ 4 MB)
  r.put('/:sha256', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'upload', ...RATES.upload);
    const want = shaParam(c); const kind = kindOf(c);
    const bytes = await readBodyLimited(c, config.maxApiUploadBytes);            // 413 sem ler o resto
    if (!sameHash(sha256Hex(bytes), want)) throw E.badRequest('O hash informado não confere com o conteúdo enviado.');
    const cap = await txAsUser(c, (tx) => capFor(tx, kind));
    let info;
    try { info = await validateUpload(bytes, { kind, maxBytes: cap }); }
    catch (e) { if (e && e.status) await auditReject(c, want, e, { size: bytes.length, kind }); throw e; }
    const meta = { sha: want, size: info.size, mime: info.mime, kind, width: info.width, height: info.height };

    const created = await txAsUser(c, (tx) => register(tx, user.id, meta));
    // grava ANTES de marcar pronto; objeto já presente com o mesmo tamanho = deduplicação (nada é regravado)
    const have = await storage.head(want);
    const reused = !!have && have.size === bytes.length;
    if (!reused) await storage.put(want, bytes, { mime: info.mime, verify: false });   // o hash acabou de ser conferido acima
    const status = await txAsUser(c, async (tx) => {
      const [m] = await tx`select app.asset_mark_ready(${want}, ${info.size}::bigint, ${info.mime}, ${kind}, ${info.width ?? null}::int, ${info.height ?? null}::int) as status`;
      if (m.status === 'ready') await audit(tx, c, 'asset.upload', 'asset', want, { size: info.size, mime: info.mime, kind, deduplicated: !created && reused });
      return m.status;
    });
    if (status !== 'ready') { log.error('asset_not_ready', { sha: want, status }); throw E.conflict('Não foi possível concluir o envio deste arquivo. Tente novamente.'); }
    return c.json(publicInfo(meta, !created && reused), created ? 201 : 200);
  });

  // ------------------------------------------------------------------ upload direto (arquivos grandes)
  r.post('/uploads', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'upload', ...RATES.upload);
    const b = await readJsonBody(c, UploadsBody);
    const cap = await txAsUser(c, (tx) => capFor(tx, b.kind));
    if (b.size > cap) throw E.tooLarge(`O arquivo excede o limite de ${Math.floor(cap / 1048576)} MB.`);
    if (storage.driver === 'local') return c.json({ mode: 'api' });       // sem URL assinada no driver local: o cliente usa o PUT acima
    // A URL escreve na área de PREPARO da própria pessoa (up/<usuário>/<sha>), nunca na chave canônica: pedir uma URL para o hash de um arquivo
    // alheio não dá acesso a nada — só o finalize, depois de conferir o SHA-256 do que ela enviou, promove o objeto e concede a posse (AF-2).
    const up = await storage.createUpload(b.sha256, { size: b.size, mime: b.mime, ttlS: 300, stagingFor: user.id });
    if (!up) return c.json({ mode: 'api' });
    await txAsUser(c, (tx) => registerPending(tx, user.id, { sha: b.sha256, size: b.size, mime: b.mime, kind: b.kind }));   // sem posse
    return c.json({ mode: 'direct', url: up.url, method: up.method, headers: up.headers, expiresAt: up.expiresAt });
  });

  r.post('/:sha256/finalize', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'upload', ...RATES.upload);
    const want = shaParam(c);
    const visible = (tx) => tx`select sha256, size_bytes, mime, kind, width, height, status, uploaded_by from app.assets where sha256 = ${want}`;   // RLS: só o que ele iniciou, possui ou pode ver
    let cur = (await txAsUser(c, visible))[0] || null;
    const done = (a, dedup) => c.json(publicInfo({ sha: a.sha256, size: Number(a.size_bytes), mime: a.mime, width: a.width, height: a.height }, dedup));
    const dropStaging = () => storage.deleteStaging(user.id, want).catch(() => {});
    if (cur && cur.status === 'ready') { await dropStaging(); return done(cur, true); }
    if (cur && cur.status !== 'pending' && cur.status !== 'deleted') throw E.notFound();
    // O que a pessoa enviou está na SUA área de preparo (up/<usuário>/<sha>): é a única prova de que ela possui os bytes.
    const stg = await storage.getStaging(user.id, want);
    if (!cur && !stg) throw E.notFound();                                      // nem registro visível nem bytes: igual a qualquer sha desconhecido (não ensina nada)
    if (!stg) throw E.conflict('O arquivo ainda não foi enviado ao armazenamento.');
    const discard = async (e, extra) => {
      await dropStaging();                                                       // o preparo é só desta pessoa: sempre apagado
      if (cur && cur.uploaded_by === user.id) await txAsUser(c, async (tx) => { await tx`select app.asset_discard_pending(${want})`; });   // o registro pendente, só se foi ela que o criou
      await auditReject(c, want, e, { size: stg.size, ...extra });
    };
    if (!sameHash(sha256Hex(stg.body), want)) {
      const e = E.rejected('O arquivo enviado não confere com o hash informado.', { reasons: ['hash_divergente'] });
      await discard(e); throw e;
    }
    // Bytes conferidos = posse legítima (mesma regra do PUT pela API). Se o registro pendente era de outra pessoa (duas enviando o mesmo arquivo
    // novo ao mesmo tempo), ele passa a ser visível para ela a partir daqui.
    if (!cur) {
      try { cur = (await txAsUser(c, async (tx) => { await grantOwnership(tx, user.id, want); return visible(tx); }))[0] || null; }
      catch (e) { if (e && e.code === '23503') { await dropStaging(); throw E.notFound(); } throw e; }   // sem registro pendente algum (finalize sem /uploads)
      if (!cur) { await dropStaging(); throw E.notFound(); }
      if (cur.status === 'ready') { await dropStaging(); return done(cur, true); }
    }
    const cap = await txAsUser(c, (tx) => capFor(tx, cur.kind));
    let info;
    try { info = await validateUpload(stg.body, { kind: cur.kind, maxBytes: cap }); }
    catch (e) { if (e && e.status) await discard(e, { kind: cur.kind }); throw e; }
    // chave canônica: cópia condicional ao ETag conferido (se o preparo mudou depois da conferência → 422); nada é regravado se já existir; o preparo é apagado
    const prom = await storage.promoteStaging(user.id, want, { mime: info.mime, etag: stg.etag || null, body: stg.body });
    if (prom.mismatch) { const e = E.rejected('O arquivo enviado foi alterado depois de conferido.', { reasons: ['preparo_alterado'] }); await discard(e); throw e; }
    if (!prom.promoted && !prom.existed) { await dropStaging(); throw E.conflict('O arquivo ainda não foi enviado ao armazenamento.'); }   // preparo sumiu entre a conferência e a promoção
    if (!(await storage.head(want))) throw E.conflict('Não foi possível concluir o envio deste arquivo. Tente novamente.');              // nunca "ready" sem objeto
    const status = await txAsUser(c, async (tx) => {
      await grantOwnership(tx, user.id, want);
      const [m] = await tx`select app.asset_mark_ready(${want}, ${info.size}::bigint, ${info.mime}, ${cur.kind}, ${info.width ?? null}::int, ${info.height ?? null}::int) as status`;
      if (m.status === 'ready') await audit(tx, c, 'asset.upload', 'asset', want, { size: info.size, mime: info.mime, kind: cur.kind, direct: true, deduplicated: prom.existed });
      return m.status;
    });
    if (status !== 'ready') throw E.conflict('Não foi possível concluir o envio deste arquivo. Tente novamente.');
    return c.json(publicInfo({ sha: want, size: info.size, mime: info.mime, width: info.width, height: info.height }, prom.existed), 201);
  });

  // ------------------------------------------------------------------ leitura
  r.get('/:sha256', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'asset_read', ...RATES.asset_read);
    const v = c.req.param('sha256');
    if (!SHA_RE.test(v)) throw E.notFound();
    const a = await txAsUser(c, async (tx) => (await tx`select sha256, size_bytes, mime from app.assets where sha256 = ${v} and status = 'ready'`)[0]);   // RLS assets_select
    if (!a) throw E.notFound();
    const image = a.mime.startsWith('image/');
    const headers = {
      'Content-Type': a.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",      // se alguém abrir o arquivo direto, nada executa
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'private, max-age=31536000, immutable',      // endereçado por conteúdo: nunca muda
      'Content-Disposition': image ? 'inline' : contentDisposition('attachment', `${v.slice(0, 16)}.${EXT[a.mime] || 'bin'}`),
      ETag: `"${v}"`,
    };
    const inm = c.req.header('if-none-match');
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === `"${v}"`)) return c.body(null, 304, headers);
    const size = Number(a.size_bytes);
    if (size > STREAM_LIMIT) {
      const url = await storage.signedGetUrl(v, { ttlS: 300, disposition: image ? 'inline' : 'attachment', filename: image ? undefined : `${v.slice(0, 16)}.${EXT[a.mime] || 'bin'}`, mime: a.mime });
      if (url) return c.body(null, 302, { Location: url, 'Cache-Control': 'private, no-store' });   // URL expira em 5 min: nunca cacheie o redirecionamento
    }
    const obj = await storage.getStream(v);
    if (!obj) { log.error('asset_object_missing', { sha: v }); throw E.notFound(); }                // metadado sem objeto: incidente de integridade (alerta em log)
    if (obj.size !== size) log.warn('asset_size_mismatch', { sha: v, db: size, storage: obj.size });
    return c.body(obj.stream, 200, { ...headers, 'Content-Length': String(obj.size) });
  });

  return r;
}
