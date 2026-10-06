/* Comentários (docs/API.md §6). Montado em /api: /presentations/:id/comments e /comments/:id.
   Quem pode o quê (matriz): ver/criar = qualquer usuário que VÊ a apresentação; editar o TEXTO = só o autor; resolver/reabrir e apagar = autor, dono da
   apresentação ou admin. Essa matriz é imposta pelo gatilho app.trg_comments_guard e pelas políticas do banco; as checagens daqui só escolhem o status HTTP
   certo (404 invisível × 403 sem permissão) — se divergirem, o banco vence (erro 42501 → 403). O texto é PURO: nada de HTML (a interface escapa). */
import { Hono } from 'hono';
import { z } from 'zod';
import { E } from '../lib/errors.js';
import { requireUser, txAsUser, audit } from '../lib/request.js';
import { uuidParam, rate, RATES, readJsonBody, accessOf } from '../lib/presentations-service.js';

const MAX_ACTIVE_PER_PRESENTATION = 1000;
/** Texto puro: sem NUL/controles (exceto \n e \t) e sem surrogates soltos; 1–2000 caracteres (code points, como o CHECK do banco). */
const bodyText = z.string().transform((s) => s.replace(/\r\n?/g, '\n').trim())
  .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), 'Contém caracteres não permitidos.')
  .refine((s) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s), 'Contém caracteres não permitidos.')
  .refine((s) => { const n = Array.from(s).length; return n >= 1 && n <= 2000; }, 'O comentário deve ter de 1 a 2000 caracteres.');
const CreateBody = z.object({ body: bodyText, slideIndex: z.number().int().min(0).max(499).nullable().optional() }).strict();
const PatchBody = z.object({ body: bodyText.optional(), resolved: z.boolean().optional() }).strict()
  .refine((o) => o.body !== undefined || o.resolved !== undefined, { message: 'Informe o texto ou o estado de resolução.' });
const ListQuery = z.object({ includeResolved: z.enum(['0', '1', 'true', 'false']).optional() });

export function commentsRoutes(deps) {
  const r = new Hono();
  // Dados de usuários nunca vão para cache compartilhado. Escopo SÓ nestes caminhos: este roteador é montado em /api e não pode mexer nas respostas dos outros.
  const noStore = async (c, next) => { await next(); if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store'); };
  for (const path of ['/presentations/:id/comments', '/comments/:id']) r.use(path, noStore);

  const shape = (row, me, canMod) => ({
    id: row.id, slideIndex: row.slide_index, body: row.body, author: { id: row.author_id, displayName: row.author_name || 'Usuário' },
    createdAt: row.created_at, editedAt: row.edited_at, resolvedAt: row.resolved_at,
    canDelete: row.author_id === me || canMod, canResolve: row.author_id === me || canMod, canEdit: row.author_id === me,
  });
  const select = (tx) => tx`select c.id, c.presentation_id, c.slide_index, c.author_id, d.display_name as author_name, c.body, c.created_at, c.edited_at, c.resolved_at
      from app.comments c left join app.directory d on d.id = c.author_id`;

  r.get('/presentations/:id/comments', async (c) => {
    const user = requireUser(c); const pid = uuidParam(c);
    await rate(c, user, 'read', ...RATES.read);
    const q = ListQuery.parse(c.req.query());
    const withResolved = q.includeResolved === '1' || q.includeResolved === 'true';
    const items = await txAsUser(c, async (tx) => {
      const a = await accessOf(tx, pid);
      if (!a.view) throw E.notFound();
      const rows = await tx`${select(tx)} where c.presentation_id = ${pid}::uuid and c.deleted_at is null ${withResolved ? tx`` : tx`and c.resolved_at is null`}
        order by c.created_at, c.id limit 1000`;
      return rows.map((row) => shape(row, user.id, a.edit));
    });
    return c.json({ items });
  });

  r.post('/presentations/:id/comments', async (c) => {
    const user = requireUser(c); const pid = uuidParam(c);
    await rate(c, user, 'comment', ...RATES.comment);
    const body = await readJsonBody(c, CreateBody);
    const out = await txAsUser(c, async (tx) => {
      const a = await accessOf(tx, pid);
      if (!a.view) throw E.notFound();                                  // invisível (inclusive lixeira alheia) nunca revela existência
      const [n] = await tx`select count(*)::int as n from app.comments where presentation_id = ${pid}::uuid and deleted_at is null`;
      if (n.n >= MAX_ACTIVE_PER_PRESENTATION) throw E.conflict('Esta apresentação atingiu o limite de comentários.');
      const [ins] = await tx`insert into app.comments(presentation_id, slide_index, author_id, body) values (${pid}::uuid, ${body.slideIndex ?? null}, ${user.id}::uuid, ${body.body}) returning id`;
      await audit(tx, c, 'comment.create', 'comment', ins.id, { presentationId: pid, length: Array.from(body.body).length });
      const [row] = await tx`${select(tx)} where c.id = ${ins.id}::uuid`;
      return shape(row, user.id, a.edit);
    });
    return c.json(out, 201);
  });

  /** Comentário visível e não apagado → linha (+ permissão de moderar); senão 404. */
  async function loadComment(tx, id) {
    const [row] = await tx`${select(tx)} where c.id = ${id}::uuid and c.deleted_at is null`;      // RLS com_select: só de apresentações visíveis
    if (!row) throw E.notFound();
    const a = await accessOf(tx, row.presentation_id);
    return { row, canMod: a.edit };
  }

  r.patch('/comments/:id', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'comment', ...RATES.comment);
    const body = await readJsonBody(c, PatchBody);
    const out = await txAsUser(c, async (tx) => {
      const { row, canMod } = await loadComment(tx, id);
      if (body.body !== undefined && row.author_id !== user.id) throw E.forbidden('Só o autor edita o texto do comentário.');
      if (body.resolved !== undefined && !(row.author_id === user.id || canMod)) throw E.forbidden('Só o autor, o dono da apresentação ou um administrador resolvem comentários.');
      if (body.body !== undefined && body.body !== row.body) await tx`update app.comments set body = ${body.body} where id = ${id}::uuid`;
      if (body.resolved === true && !row.resolved_at) await tx`update app.comments set resolved_at = now(), resolved_by = ${user.id}::uuid where id = ${id}::uuid`;
      if (body.resolved === false && row.resolved_at) await tx`update app.comments set resolved_at = null, resolved_by = null where id = ${id}::uuid`;
      const [fresh] = await tx`${select(tx)} where c.id = ${id}::uuid`;
      return shape(fresh, user.id, canMod);
    });
    return c.json(out);
  });

  r.delete('/comments/:id', async (c) => {
    const user = requireUser(c); const id = uuidParam(c);
    await rate(c, user, 'comment', ...RATES.comment);
    await txAsUser(c, async (tx) => {
      const { row, canMod } = await loadComment(tx, id);
      if (!(row.author_id === user.id || canMod)) throw E.forbidden('Só o autor, o dono da apresentação ou um administrador apagam comentários.');
      const rows = await tx`update app.comments set deleted_at = now() where id = ${id}::uuid and deleted_at is null returning id`;
      if (!rows.length) throw E.notFound();
      await audit(tx, c, 'comment.delete', 'comment', id, { presentationId: row.presentation_id, byAuthor: row.author_id === user.id });
    });
    return c.body(null, 204);
  });

  return r;
}
