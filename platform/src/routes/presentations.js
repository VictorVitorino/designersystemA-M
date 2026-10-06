/* Rotas de apresentações (docs/API.md §4). Montadas em /api/presentations (src/app.js).
   Papéis desta camada: validar entrada (zod, .strict()), limitar abuso (taxa), abrir a transação COMO o usuário e traduzir o resultado em HTTP.
   Quem decide o que cada pessoa pode ver/alterar é o BANCO (RLS); as regras de negócio vivem em lib/presentations-service.js. */
import { Hono } from 'hono';
import { z } from 'zod';
import { E } from '../lib/errors.js';
import { requireUser, requireAdmin, txAsUser, audit } from '../lib/request.js';
import { cursorKey, encodeCursor, decodeCursor } from '../lib/cursor.js';
import {
  uuidParam, isUuid, rate, RATES, readJsonBody, prepareContent, blankDeck, normalizeTitle, accessOf, getMeta, getPresentation, listQuery, mapMeta,
  saveContent, createPresentation, duplicatePresentation, renamePresentation, trashPresentation, restorePresentation, purgePresentation, transferPresentation,
  listVersions, getVersion, restoreVersion,
} from '../lib/presentations-service.js';

const sha = z.string().regex(/^[0-9a-f]{64}$/, 'Hash inválido.');
/** Objeto JSON do deck: NÃO é copiado nem percorrido pelo zod (o lint de segurança é quem percorre). */
const deckObject = z.custom((v) => v !== null && typeof v === 'object' && !Array.isArray(v), 'Conteúdo inválido.');
const plainText = (max) => z.string().max(max).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'Contém caracteres não permitidos.');

const SaveBody = z.object({
  baseRev: z.number().int().min(1).max(2_000_000_000),
  content: deckObject,
  snapshot: z.boolean().optional(),
  label: plainText(120).transform((s) => s.trim()).nullable().optional(),
  resolution: z.literal('overwrite').optional(),
  thumbSha: sha.nullable().optional(),
}).strict();
const CreateBody = z.object({ title: z.string().max(400).optional(), content: deckObject.optional(), source: z.enum(['new', 'import']).optional() }).strict();
const RenameBody = z.object({ title: z.string().max(400) }).strict();
const DuplicateBody = z.object({ title: z.string().max(400).optional() }).strict();
const TransferBody = z.object({ toUserId: z.string().uuid('Identificador inválido.') }).strict();
const RestoreVersionBody = z.object({ baseRev: z.number().int().min(1).max(2_000_000_000) }).strict();
const ListQuery = z.object({
  scope: z.enum(['all', 'mine', 'trash']).default('all'),
  q: z.string().trim().max(100).optional(),
  owner: z.string().uuid('Identificador inválido.').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(512).optional(),
});
const DeleteQuery = z.object({ purge: z.enum(['0', '1', 'true', 'false']).optional() });

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const cursorShape = (v) => v.length === 2 && typeof v[0] === 'string' && TS_RE.test(v[0]) && isUuid(v[1]);

export function presentationsRoutes(deps) {
  const { config } = deps;
  const key = cursorKey(config);
  const r = new Hono();
  // Respostas com dados de usuários nunca vão para cache compartilhado
  r.use('*', async (c, next) => { await next(); if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store'); });

  const aud = (tx, c) => (action, entityType, entityId, meta) => audit(tx, c, action, entityType, entityId, meta);
  /** Rejeição por segurança vira auditoria própria (a transação principal nem chegou a abrir). Falha de auditoria nunca muda a resposta. */
  async function auditRejected(c, id, e) {
    if (!e || e.code !== 'rejected_content') return;
    try { await txAsUser(c, (tx) => audit(tx, c, 'security.rejected_content', 'presentation', id, { reasons: e.details && e.details.reasons })); } catch { /* melhor-esforço */ }
  }
  /** Tempo esgotado esperando a trava da linha (outro salvamento travado) → 503 amigável em vez de 500. */
  const lockSafe = async (fn) => {
    try { return await fn(); } catch (e) { if (e && e.code === '55P03') throw E.unavailable('Outra gravação desta apresentação está em andamento. Tente novamente em instantes.'); throw e; }
  };

  // ------------------------------------------------------------------ listagem
  r.get('/', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'read', ...RATES.read);
    const q = ListQuery.parse(c.req.query());
    const ctx = `${user.id}|${q.scope}|${q.q || ''}|${q.owner || ''}`;
    const cur = decodeCursor(q.cursor, { key, ctx, shape: cursorShape });
    const rows = await txAsUser(c, (tx) => listQuery(tx, user.id, { scope: q.scope, q: q.q, owner: q.owner, limit: q.limit, after: cur && { ts: cur[0], id: cur[1] } }));
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return c.json({ items: page.map(mapMeta), nextCursor: rows.length > q.limit && last ? encodeCursor([last.ts, last.id], { key, ctx }) : null });
  });

  // ------------------------------------------------------------------ criar
  r.post('/', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'write', ...RATES.write);
    const body = await readJsonBody(c, CreateBody, config.maxJsonBytes);
    const source = body.source || 'new';
    if (source === 'import' && !body.content) throw E.badRequest('Informe o conteúdo a importar.');
    let title = null;
    if (body.title !== undefined) { title = normalizeTitle(body.title); if (!title) throw E.badRequest('Informe um título.'); }
    const content = body.content ? (title ? { ...body.content, title } : body.content) : blankDeck(title || 'Nova apresentação');
    let prep;
    try { prep = prepareContent(content); } catch (e) { await auditRejected(c, null, e); throw e; }
    const meta = await txAsUser(c, async (tx) => {
      const id = await createPresentation(tx, { userId: user.id, aud: aud(tx, c), prep, source });
      return getMeta(tx, id);
    });
    return c.json(meta, 201, { Location: `/api/presentations/${meta.id}` });
  });

  // ------------------------------------------------------------------ abrir
  r.get('/:id', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'read', ...RATES.read);
    const p = await txAsUser(c, (tx) => getPresentation(tx, id));
    if (!p) throw E.notFound();
    return c.json(p, 200, { ETag: `"${p.rev}"`, 'Cache-Control': 'private, no-cache' });
  });

  // ------------------------------------------------------------------ salvar conteúdo (autosave)
  r.put('/:id/content', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'write', ...RATES.write);
    const body = await readJsonBody(c, SaveBody, config.maxJsonBytes);
    let prep;
    try { prep = prepareContent(body.content); } catch (e) { await auditRejected(c, id, e); throw e; }
    const out = await lockSafe(() => txAsUser(c, (tx) => saveContent(tx, { userId: user.id, aud: aud(tx, c), id, input: body, prep })));
    return c.json(out);
  });

  // ------------------------------------------------------------------ renomear
  r.patch('/:id', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'write', ...RATES.write);
    const body = await readJsonBody(c, RenameBody);
    const title = normalizeTitle(body.title);
    if (!title) throw E.badRequest('Informe um título.');
    let meta;
    try { meta = await lockSafe(() => txAsUser(c, async (tx) => { await renamePresentation(tx, { userId: user.id, aud: aud(tx, c), id, title }); return getMeta(tx, id); })); }
    catch (e) { await auditRejected(c, id, e); throw e; }
    return c.json(meta);
  });

  // ------------------------------------------------------------------ duplicar (usar a apresentação de outra pessoa = criar a SUA cópia)
  r.post('/:id/duplicate', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'write', ...RATES.write);
    const body = await readJsonBody(c, DuplicateBody);
    let title;
    if (body.title !== undefined) { title = normalizeTitle(body.title); if (!title) throw E.badRequest('Informe um título.'); }
    let meta;
    try { meta = await txAsUser(c, async (tx) => { const nid = await duplicatePresentation(tx, { userId: user.id, aud: aud(tx, c), id, title }); return getMeta(tx, nid); }); }
    catch (e) { await auditRejected(c, id, e); throw e; }
    return c.json(meta, 201, { Location: `/api/presentations/${meta.id}` });
  });

  // ------------------------------------------------------------------ lixeira / apagar de vez / restaurar / transferir
  r.delete('/:id', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'write', ...RATES.write);
    const q = DeleteQuery.parse(c.req.query());
    const purge = q.purge === '1' || q.purge === 'true';
    if (purge) {
      requireAdmin(c);                                  // dono comum NÃO apaga de vez (regra do produto); o RLS também nega o DELETE
      await txAsUser(c, (tx) => purgePresentation(tx, { aud: aud(tx, c), id }));
    } else {
      await txAsUser(c, (tx) => trashPresentation(tx, { userId: user.id, aud: aud(tx, c), id }));
    }
    return c.body(null, 204);
  });
  r.post('/:id/restore', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'write', ...RATES.write);
    const meta = await txAsUser(c, async (tx) => { await restorePresentation(tx, { aud: aud(tx, c), id }); return getMeta(tx, id); });
    return c.json(meta);
  });
  r.post('/:id/transfer', async (c) => {
    const user = requireAdmin(c); const id = uuidParam(c);
    await rate(c, user, 'write', ...RATES.write);
    const body = await readJsonBody(c, TransferBody);
    const meta = await txAsUser(c, async (tx) => { await transferPresentation(tx, { aud: aud(tx, c), id, toUserId: body.toUserId }); return getMeta(tx, id); });
    return c.json(meta);
  });

  // ------------------------------------------------------------------ versões (dono/admin)
  const versionsAccess = async (tx, id) => {
    const a = await accessOf(tx, id);
    if (!a.view) throw E.notFound();
    if (!a.edit) throw E.forbidden('O histórico de versões é do dono da apresentação e dos administradores.');
  };
  const versionNo = (c) => { const n = Number(c.req.param('no')); if (!/^\d{1,9}$/.test(c.req.param('no')) || n < 1) throw E.notFound(); return n; };
  r.get('/:id/versions', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'read', ...RATES.read);
    const items = await txAsUser(c, async (tx) => { await versionsAccess(tx, id); return listVersions(tx, id); });
    return c.json({ items });
  });
  r.get('/:id/versions/:no', async (c) => {
    const user = requireUser(c); const id = uuidParam(c); const no = versionNo(c);
    await rate(c, user, 'read', ...RATES.read);
    const v = await txAsUser(c, async (tx) => { await versionsAccess(tx, id); return getVersion(tx, id, no); });
    if (!v) throw E.notFound('Versão não encontrada.');
    return c.json(v);
  });
  r.post('/:id/versions/:no/restore', async (c) => {
    const user = requireUser(c); const id = uuidParam(c); const no = versionNo(c);
    await rate(c, user, 'write', ...RATES.write);
    const body = await readJsonBody(c, RestoreVersionBody);
    let out;
    try { out = await lockSafe(() => txAsUser(c, (tx) => restoreVersion(tx, { userId: user.id, aud: aud(tx, c), id, no, baseRev: body.baseRev }))); }
    catch (e) { await auditRejected(c, id, e); throw e; }
    return c.json(out);
  });

  // ------------------------------------------------------------------ compartilhar (o acervo é comum: compartilhar = link interno)
  r.get('/:id/share', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'read', ...RATES.read);
    await txAsUser(c, async (tx) => {
      const a = await accessOf(tx, id);
      if (!a.view) throw E.notFound();
      await audit(tx, c, 'presentation.share', 'presentation', id, {});
    });
    return c.json({ url: `${config.origin}/visualizar/${id}`, visibility: 'acervo' });
  });

  return r;
}
