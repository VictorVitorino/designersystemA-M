/* Interações dos espectadores (docs/API.md §6): respostas de formulário, estado de quadro/votação, reações e visualizações.
   Montado em /api: /presentations/:id/interactions e /presentations/:id/interactions.csv.
   Regras: cada pessoa grava SÓ as suas (user_id vem da sessão, nunca do corpo); dono/admin leem tudo, os demais só as próprias — isso é o RLS
   (inter_select), a rota apenas escolhe o status certo. board_state/vote_state são estado ÚNICO por pessoa+elemento (upsert); o resto acumula, com teto
   de 500 por pessoa/elemento (trava consultiva por chave para o teto valer mesmo com envios simultâneos). */
import { Hono } from 'hono';
import { z } from 'zod';
import { E } from '../lib/errors.js';
import { requireUser, txAsUser, audit } from '../lib/request.js';
import { uuidParam, rate, RATES, readJsonBody, accessOf, jsonbSafe } from '../lib/presentations-service.js';
import { interactionsCsv, csvFilename } from '../lib/csv.js';

const KINDS = ['form_response', 'board_state', 'vote_state', 'view', 'reaction'];
const STATE_KINDS = new Set(['board_state', 'vote_state']);
const MAX_PER_ELEMENT = 500;
const MAX_PAYLOAD_BYTES = 64 * 1024 - 1;
const MAX_LIST = 1000, MAX_CSV_ROWS = 50_000;
const ELEMENT_RE = /^[\w.:-]{1,80}$/;

/** Profundidade do JSON (iterativa — o payload é limitado a 64 KB, mas aninhamento extremo ainda é abuso). */
function depthOf(v) {
  let max = 0; const stack = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (d > max) max = d;
    if (max > 20) return max;
    if (x && typeof x === 'object') for (const y of Array.isArray(x) ? x : Object.values(x)) stack.push([y, d + 1]);
  }
  return max;
}

const PostBody = z.object({
  kind: z.enum(KINDS),
  elementId: z.string().max(80).default(''),
  payload: z.custom((v) => v !== null && typeof v === 'object' && !Array.isArray(v), 'O payload deve ser um objeto.'),
}).strict().superRefine((b, ctx) => {
  if (b.elementId === '' ? b.kind !== 'view' : !ELEMENT_RE.test(b.elementId)) ctx.addIssue({ code: 'custom', path: ['elementId'], message: 'Identificador do elemento inválido.' });
});
const Filter = z.object({ kind: z.enum(KINDS).optional(), elementId: z.string().regex(ELEMENT_RE, 'Identificador do elemento inválido.').optional() });
const CsvFilter = z.object({ kind: z.enum(KINDS).default('form_response'), elementId: z.string().regex(ELEMENT_RE, 'Identificador do elemento inválido.').optional() });

export function interactionsRoutes(deps) {
  const r = new Hono();
  // Dados de usuários nunca vão para cache compartilhado. Escopo SÓ nestes caminhos: este roteador é montado em /api e não pode mexer nas respostas dos outros.
  const noStore = async (c, next) => { await next(); if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store'); };
  for (const path of ['/presentations/:id/interactions', '/presentations/:id/interactions.csv']) r.use(path, noStore);

  r.post('/presentations/:id/interactions', async (c) => {
    const user = requireUser(c); const pid = uuidParam(c);
    await rate(c, user, 'write', ...RATES.write);
    const body = await readJsonBody(c, PostBody, 72 * 1024);
    const text = JSON.stringify(body.payload);
    if (Buffer.byteLength(text) > MAX_PAYLOAD_BYTES) throw E.tooLarge('A resposta passa de 64 KB.');
    if (!jsonbSafe(text) || depthOf(body.payload) > 20) throw E.badRequest('Conteúdo da interação inválido.');
    let out;
    try {
      out = await txAsUser(c, async (tx) => {
        const a = await accessOf(tx, pid);
        if (!a.view) throw E.notFound();
        if (STATE_KINDS.has(body.kind)) {
          const [row] = await tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload)
              values (${pid}::uuid, ${user.id}::uuid, ${body.kind}, ${body.elementId}, ${tx.json(body.payload)})
              on conflict (presentation_id, user_id, kind, element_id) where kind in ('board_state','vote_state')
              do update set payload = excluded.payload
              returning id, (xmax = 0) as inserted, created_at, updated_at`;
          return { created: row.inserted, row };
        }
        // teto por pessoa/elemento: a trava serializa envios simultâneos da mesma chave, então 2 abas não passam de 500 juntas
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${pid}|${user.id}|${body.kind}|${body.elementId}`}, 0))`;
        const [n] = await tx`select count(*)::int as n from app.interactions where presentation_id = ${pid}::uuid and user_id = ${user.id}::uuid and kind = ${body.kind} and element_id = ${body.elementId}`;
        if (n.n >= MAX_PER_ELEMENT) throw E.conflict(`Limite de ${MAX_PER_ELEMENT} respostas por elemento atingido.`);
        const [row] = await tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload)
            values (${pid}::uuid, ${user.id}::uuid, ${body.kind}, ${body.elementId}, ${tx.json(body.payload)}) returning id, created_at, updated_at`;
        return { created: true, row };
      });
    } catch (e) { if (e && e.code === '23514') throw E.tooLarge('A resposta é grande demais para ser guardada.'); throw e; }
    return c.json({ id: out.row.id, kind: body.kind, elementId: body.elementId, createdAt: out.row.created_at, updatedAt: out.row.updated_at }, out.created ? 201 : 200);
  });

  const listRows = (tx, pid, f, max) => tx`select i.id, i.kind, i.element_id, i.payload, i.created_at, i.updated_at, i.user_id, d.display_name as user_name
      from app.interactions i left join app.directory d on d.id = i.user_id
     where i.presentation_id = ${pid}::uuid ${f.kind ? tx`and i.kind = ${f.kind}` : tx``} ${f.elementId ? tx`and i.element_id = ${f.elementId}` : tx``}
     order by i.created_at, i.id limit ${max}`;

  r.get('/presentations/:id/interactions', async (c) => {
    const user = requireUser(c); const pid = uuidParam(c);
    await rate(c, user, 'read', ...RATES.read);
    const f = Filter.parse(c.req.query());
    const rows = await txAsUser(c, async (tx) => {
      const a = await accessOf(tx, pid);
      if (!a.view) throw E.notFound();
      return listRows(tx, pid, f, MAX_LIST + 1);     // dono/admin: tudo; demais: só as próprias (RLS inter_select)
    });
    const page = rows.slice(0, MAX_LIST);
    return c.json({
      items: page.map((i) => ({ id: i.id, kind: i.kind, elementId: i.element_id, payload: i.payload, createdAt: i.created_at, updatedAt: i.updated_at, user: { id: i.user_id, displayName: i.user_name || 'Usuário' } })),
      truncated: rows.length > MAX_LIST,
    });
  });

  r.get('/presentations/:id/interactions.csv', async (c) => {
    const user = requireUser(c); const pid = uuidParam(c);
    await rate(c, user, 'read', ...RATES.read);
    const f = CsvFilter.parse(c.req.query());
    const { rows, count } = await txAsUser(c, async (tx) => {
      const a = await accessOf(tx, pid);
      if (!a.view) throw E.notFound();
      if (!a.edit) throw E.forbidden('Somente o dono da apresentação e os administradores exportam as respostas.');
      const rs = await listRows(tx, pid, f, MAX_CSV_ROWS + 1);
      // exportar dados de pessoas é uma ação relevante: auditada (sem conteúdo — só contagem)
      await audit(tx, c, 'interactions.export', 'presentation', pid, { kind: f.kind, rows: Math.min(rs.length, MAX_CSV_ROWS) });
      return { rows: rs, count: rs.length };
    });
    const page = rows.slice(0, MAX_CSV_ROWS);
    const csv = interactionsCsv(f.kind, page.map((i) => ({ createdAt: i.created_at, userName: i.user_name || 'Usuário', elementId: i.element_id, kind: i.kind, payload: i.payload })));
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(f.kind, pid)}"`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      ...(count > MAX_CSV_ROWS ? { 'X-Truncated': '1' } : {}),
    });
  });

  return r;
}
