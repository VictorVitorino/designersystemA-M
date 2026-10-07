/* Regras de apresentações, versões e leitura de corpo de requisição (docs/API.md §4; docs/conteudo-e-versoes.md).
   O BANCO é a autoridade das permissões (RLS + gatilhos, db/migrations/0003_security.sql): estas funções sempre recebem uma transação `tx`
   já aberta como o usuário (txAsUser → SET LOCAL ROLE app_user), então um erro de lógica aqui não dá a ninguém acesso que o banco nega.
   Convenções: "0 linhas" nunca é interpretado sozinho — `accessOf` separa "não existe/invisível" (404) de "visível mas sem permissão" (403).
   SQL só parametrizado (tagged template); nada do cliente é concatenado em texto de consulta. */
import { randomBytes } from 'node:crypto';
import { E, HttpError } from './errors.js';
import { limitMany } from './request.js';
import { lintDeck } from './deck-lint.js';
import { contentHash } from './canonical.js';

/* ───────────── utilidades de requisição ───────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);
/** :id que não é UUID nunca existe → 404 (não 400: não ensina nada a quem sonda). */
export function uuidParam(c, name = 'id') { const v = c.req.param(name); if (!isUuid(v)) throw E.notFound(); return v.toLowerCase(); }

/** Limites de taxa (API.md §2): por usuário no valor do contrato; por IP em RATE_IP_MULTIPLIER× (padrão 25×: um escritório inteiro atrás do mesmo
    NAT — 50 pessoas salvando a cada 3–5 s — não se bloqueia; o teto por IP continua existindo contra abuso em massa). Os dois baldes são
    consultados em UMA ida ao banco (A1/A5 do teste de carga). */
export const IP_MULTIPLIER = 25;   /* padrão; o valor em vigor vem de config.rateIpMultiplier (RATE_IP_MULTIPLIER validada em config.js: inteiro 5–1000) */
export async function rate(c, user, bucket, windowS, max) {
  const deps = c.get('deps'); const mult = (deps && deps.config && deps.config.rateIpMultiplier) || IP_MULTIPLIER;
  await limitMany(c, [[`${bucket}:u`, user.id, windowS, max], [`${bucket}:ip`, c.get('ip') || 'sem-ip', windowS, max * mult]]);
}
export const RATES = Object.freeze({ write: [60, 120], upload: [60, 60], comment: [60, 30], read: [60, 600], asset_read: [60, 600] });

/** Lê o corpo no máximo `maxBytes` — para de ler ao estourar (não carrega 1 GB na memória só para depois recusar). */
export async function readBodyLimited(c, maxBytes) {
  const declared = c.req.header('content-length');
  if (declared != null && declared !== '') {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) throw E.badRequest('Cabeçalho Content-Length inválido.');
    if (n > maxBytes) throw E.tooLarge();
  }
  const body = c.req.raw.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader(); const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw E.tooLarge(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength)), total);
}

/** JSON do corpo, com limite de tamanho e validação zod (o `schema` decide o que é aceito; a mensagem nunca ecoa o valor recebido). */
export async function readJsonBody(c, schema, maxBytes = 16 * 1024) {
  const buf = await readBodyLimited(c, maxBytes);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { throw E.badRequest('O corpo não é UTF-8 válido.'); }
  let data;
  try { data = text.length ? JSON.parse(text) : {}; } catch { throw E.badRequest('JSON inválido.'); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw E.badRequest('JSON inválido.');
  return schema.parse(data);
}

/* ───────────── conteúdo ───────────── */

/* O jsonb do Postgres NÃO aceita \u0000 nem surrogates soltos (22P05) — viraria 500. Procuramos o escape no JSON já serializado
   (JSON.stringify "bem formado" só escapa surrogate solto; pares válidos saem como caractere). A âncora (?<!\\)(?:\\\\)* ignora "\\u0000" (barra literal + texto). */
const JSONB_UNSAFE = /(?<!\\)(?:\\\\)*\\u(?:0000|d[89a-f][0-9a-f]{2})/i;
export function jsonbSafe(text) { return !JSONB_UNSAFE.test(text); }

/** Título para exibição/armazenamento: sem controles/bidi, espaços colapsados, ≤ 200 caracteres. Devolve null se ficar vazio. */
export function normalizeTitle(v) {
  if (typeof v !== 'string') return null;
  let t = v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu, '').replace(/\s+/g, ' ').trim();
  if (t.length > 200) t = Array.from(t).slice(0, 200).join('').trim();
  // surrogate solto sobra de cortes/entradas malformadas: não pode ir ao banco
  t = t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  return t || null;
}

/** Deck em branco (mesma forma de newDeck() do editor: 1 slide "blank-light"). */
export function blankDeck(title = 'Nova apresentação') {
  const rnd = () => randomBytes(5).toString('hex');
  return { v: 1, app: 'AM Studio', id: 'd' + Date.now().toString(36) + rnd(), title, slides: [{ id: 'e' + rnd(), bg: '#FFFFFF', tr: 'fade', layout: 'blank-light', els: [] }] };
}

/** Valida (lint de segurança), serializa e calcula o hash CANÔNICO no servidor. Lança 422 antes de qualquer acesso ao banco. */
export function prepareContent(content) {
  const info = lintDeck(content);
  let text, hash;
  try { text = JSON.stringify(content); hash = contentHash(content); }
  catch { throw E.rejected('Conteúdo recusado por segurança.', { reasons: ['estrutura_invalida'] }); }
  if (!jsonbSafe(text)) throw E.rejected('O conteúdo tem caracteres que não podem ser guardados.', { reasons: ['caractere_invalido'] });
  return { content, hash, info, bytes: info.bytes };
}

/** Todo `asset:sha256:` do conteúdo precisa existir, estar `ready` e ser VISÍVEL ao usuário (policy assets_select: enviou, provou posse ou
 *  está numa apresentação que ele vê). "Não existe" e "é de outra pessoa" dão a MESMA resposta (422): não revela arquivos alheios. */
export async function assertAssetsUsable(tx, shas) {
  if (!shas.length) return;
  const found = new Set((await tx`select sha256 from app.assets where sha256 = any(${shas}::text[]) and status = 'ready'`).map((r) => r.sha256));
  const missing = shas.filter((s) => !found.has(s));
  if (missing.length) throw E.rejected('O conteúdo usa arquivos que não existem ou que você não pode usar. Reenvie as imagens e salve de novo.', { reasons: ['asset_inexistente'], missing: missing.slice(0, 20), missingCount: missing.length });
}

/* ───────────── leitura ───────────── */

const metaCols = (tx) => tx`p.id, p.title, p.slide_count, p.rev, p.owner_id, coalesce(d.display_name, 'Usuário') as owner_name, p.updated_at, p.created_at,
  p.thumb_sha, p.source_id, (p.deleted_at is not null) as deleted`;
const metaFrom = (tx) => tx`app.presentations p left join app.directory d on d.id = p.owner_id`;
export const mapMeta = (r) => ({
  id: r.id, title: r.title, slideCount: r.slide_count, rev: r.rev, owner: { id: r.owner_id, displayName: r.owner_name },
  updatedAt: r.updated_at, createdAt: r.created_at, thumbSha: r.thumb_sha, sourceId: r.source_id, deleted: r.deleted,
});

/** Quem pode o quê, decidido pelo banco. view=false → trate como 404; view && !edit → 403. */
export async function accessOf(tx, id) {
  const [a] = await tx`select app.can_view_presentation(${id}::uuid) as view, app.can_edit_presentation(${id}::uuid) as edit`;
  return { view: !!a.view, edit: !!a.edit };
}
/** Lança 404 se invisível, 403 se visível mas não editável. */
export async function requireEdit(tx, id, msg = 'Só o dono ou um administrador altera esta apresentação. Crie uma cópia para editar.') {
  const a = await accessOf(tx, id);
  if (!a.view) throw E.notFound();
  if (!a.edit) throw E.forbidden(msg);
}

export async function getMeta(tx, id) {
  const [r] = await tx`select ${metaCols(tx)}, app.can_edit_presentation(p.id) as can_edit from ${metaFrom(tx)} where p.id = ${id}::uuid`;
  return r ? { ...mapMeta(r), canEdit: !!r.can_edit } : null;
}

export async function getPresentation(tx, id) {
  const [r] = await tx`select ${metaCols(tx)}, p.content, app.can_edit_presentation(p.id) as can_edit from ${metaFrom(tx)} where p.id = ${id}::uuid`;
  return r ? { ...mapMeta(r), content: r.content, canEdit: !!r.can_edit } : null;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

/** Consulta de listagem (keyset). Exportada para o teste de plano (EXPLAIN) usar EXATAMENTE a mesma consulta.
 *  Ordem: updated_at desc, id asc — casa com presentations_updated_idx (updated_at desc, id) e presentations_owner_idx (owner_id, updated_at desc).
 *  O instante do cursor viaja como TEXTO (::text::timestamptz): o driver converteria um parâmetro timestamptz em Date (milissegundos) e perderia os microssegundos do Postgres.
 *  Nunca seleciona `content`. A visibilidade (lixeira dos outros, etc.) vem do RLS, não de if aqui. */
export function listQuery(tx, userId, { scope = 'all', q, owner, limit: n = 30, after }) {
  const like = q ? `%${escapeLike(q)}%` : null;
  const scopeFrag = scope === 'trash' ? tx`p.deleted_at is not null`
    : scope === 'mine' ? tx`p.deleted_at is null and p.owner_id = ${userId}::uuid`
      : tx`p.deleted_at is null`;
  return tx`select ${metaCols(tx)}, to_char(p.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts
      from ${metaFrom(tx)}
     where ${scopeFrag}
       ${owner ? tx`and p.owner_id = ${owner}::uuid` : tx``}
       ${like ? tx`and p.title ilike ${like}` : tx``}
       ${after ? tx`and (p.updated_at < ${after.ts}::text::timestamptz or (p.updated_at = ${after.ts}::text::timestamptz and p.id > ${after.id}::uuid))` : tx``}
     order by p.updated_at desc, p.id asc
     limit ${n + 1}`;
}

/* ───────────── escrita ───────────── */

/** Registra um ponto do histórico copiando o estado ATUAL da linha (e suas referências de arquivo) — sem trafegar o JSON pela aplicação. */
async function addVersionFromRow(tx, id, no, kind, label, userId) {
  await tx`insert into app.presentation_versions(presentation_id, version_no, content, content_hash, slide_count, title, kind, label, created_by)
           select p.id, ${no}::int, p.content, p.content_hash, p.slide_count, p.title, ${kind}, ${label}, ${userId}::uuid from app.presentations p where p.id = ${id}::uuid`;
  await tx`insert into app.asset_refs(presentation_id, version_no, sha256)
           select r.presentation_id, ${no}::int, r.sha256 from app.asset_refs r where r.presentation_id = ${id}::uuid and r.version_no = 0`;
}

/** Faz a referência de arquivos da cópia de trabalho (versão 0) igual a `shas`, por diferença. Devolve o que entrou e saiu (para last_ref_at). */
async function syncWorkingRefs(tx, id, shas) {
  const old = new Set((await tx`select sha256 from app.asset_refs where presentation_id = ${id}::uuid and version_no = 0`).map((r) => r.sha256));
  const now = new Set(shas);
  const added = shas.filter((s) => !old.has(s)); const removed = [...old].filter((s) => !now.has(s));
  if (added.length) await tx`insert into app.asset_refs(presentation_id, version_no, sha256) select ${id}::uuid, 0, x from unnest(${added}::text[]) x`;
  if (removed.length) await tx`delete from app.asset_refs where presentation_id = ${id}::uuid and version_no = 0 and sha256 = any(${removed}::text[])`;
  return { added, removed };
}
/** Relógio de carência da coleta de lixo (assets.last_ref_at): só quando algo entrou/saiu — não a cada salvamento. */
async function touchAssets(tx, shas) {
  const list = [...new Set(shas.filter(Boolean))];
  for (let i = 0; i < list.length; i += 1000) await tx`select app.asset_touch(${list.slice(i, i + 1000)}::text[])`;
}

async function validateThumb(tx, thumb) {
  if (thumb == null) return;
  const [t] = await tx`select 1 as ok from app.assets where sha256 = ${thumb} and status = 'ready' and kind = 'thumb'`;
  if (!t) throw E.rejected('A miniatura enviada não existe ou não pode ser usada.', { reasons: ['thumb_invalida'] });
}

/** Trava a linha (SELECT … FOR UPDATE) e devolve o estado leve (sem o JSON). Dois salvamentos simultâneos da MESMA apresentação se enfileiram aqui. */
async function lockForEdit(tx, id) {
  await tx`set local lock_timeout = '8s'`;
  const [row] = await tx`select p.id, p.rev, p.content_hash, p.title, p.snap_seq, p.thumb_sha, p.updated_at, p.updated_by, p.deleted_at, p.slide_count,
        (p.last_snapshot_at is null or p.last_snapshot_at <= now() - interval '10 minutes') as snap_due
      from app.presentations p where p.id = ${id}::uuid and app.can_edit_presentation(p.id) for update`;
  if (!row) { await requireEdit(tx, id); throw E.notFound(); }   // requireEdit sempre lança aqui (404/403); o throw final é só rede de segurança
  if (row.deleted_at) throw new HttpError(409, 'in_trash', 'Esta apresentação está na lixeira. Restaure-a para editar.');
  return row;
}
async function conflictError(tx, row) {
  const [u] = row.updated_by ? await tx`select id, display_name from app.directory where id = ${row.updated_by}::uuid` : [];
  return E.conflict('Esta apresentação foi alterada em outro lugar depois que você a abriu.', {
    serverRev: row.rev, updatedBy: u ? { id: u.id, displayName: u.display_name } : null, updatedAt: row.updated_at,
  });
}

/**
 * PUT /content — transação única (docs/conteudo-e-versoes.md §3).
 * @param {object} tx transação como o usuário
 * @param {{userId:string, aud:Function, id:string, input:{baseRev:number, snapshot?:boolean, label?:string|null, resolution?:'overwrite', thumbSha?:string|null}, prep:ReturnType<typeof prepareContent>}} a
 */
export async function saveContent(tx, { userId, aud, id, input, prep }) {
  const row = await lockForEdit(tx, id);

  // 1) Idempotência por conteúdo: mesmo hash → nada é gravado (cobre o reenvio depois de uma resposta perdida). Só um ponto manual pode sair daqui.
  if (row.content_hash === prep.hash && input.baseRev <= row.rev) {
    let snapshotNo; let savedAt = row.updated_at;
    if (input.snapshot) {
      const [last] = await tx`select version_no, kind, content_hash from app.presentation_versions where presentation_id = ${id}::uuid order by version_no desc limit 1`;
      if (last && last.kind === 'manual' && last.content_hash === row.content_hash) snapshotNo = last.version_no;
      else {
        snapshotNo = row.snap_seq + 1;
        const [u] = await tx`update app.presentations set snap_seq = ${snapshotNo}::int, last_snapshot_at = now() where id = ${id}::uuid returning updated_at`;
        savedAt = u.updated_at;
        await addVersionFromRow(tx, id, snapshotNo, 'manual', input.label ?? null, userId);
        await aud('presentation.update', 'presentation', id, { rev: row.rev, bytes: prep.bytes, slideCount: prep.info.slideCount, unchanged: true, snapshotNo });
      }
    }
    return { rev: row.rev, savedAt, hash: prep.hash, unchanged: true, ...(snapshotNo ? { snapshotNo } : {}) };
  }

  // 2) Controle otimista de conflito. Com resolution:'overwrite' o cliente confirma que viu a revisão atual (baseRev === rev).
  if (input.baseRev !== row.rev) throw await conflictError(tx, row);

  // 3) Integridade referencial dos arquivos (e da miniatura) — antes de gravar qualquer coisa
  const shas = [...prep.info.assetRefs];
  await assertAssetsUsable(tx, shas);
  const thumb = input.thumbSha === undefined ? row.thumb_sha : input.thumbSha;
  if (thumb !== row.thumb_sha) await validateThumb(tx, thumb);

  // 4) Pontos do histórico. pre_overwrite guarda o estado que está para ser sobrescrito (antes de alterar a linha).
  let seq = row.snap_seq; let preNo = null; let newNo = null;
  const manual = input.snapshot === true;
  if (input.resolution === 'overwrite') { preNo = ++seq; await addVersionFromRow(tx, id, preNo, 'pre_overwrite', null, userId); }
  if (manual || row.snap_due) newNo = ++seq;

  // 5) Referências, linha de trabalho, ponto do novo estado
  const { added, removed } = await syncWorkingRefs(tx, id, shas);
  const [u] = await tx`update app.presentations
        set content = ${tx.json(prep.content)}, content_hash = ${prep.hash}, title = ${prep.info.title}, slide_count = ${prep.info.slideCount},
            rev = rev + 1, updated_by = ${userId}::uuid, thumb_sha = ${thumb}, snap_seq = ${seq}::int,
            last_snapshot_at = case when ${seq}::int <> ${row.snap_seq}::int then now() else last_snapshot_at end
      where id = ${id}::uuid returning rev, updated_at`;
  if (!u) throw E.forbidden();
  if (newNo) await addVersionFromRow(tx, id, newNo, manual ? 'manual' : 'autosave', manual ? (input.label ?? null) : null, userId);
  await touchAssets(tx, [...added, ...removed, ...(thumb !== row.thumb_sha ? [row.thumb_sha] : [])]);

  await aud('presentation.update', 'presentation', id, { rev: u.rev, bytes: prep.bytes, slideCount: prep.info.slideCount, assets: shas.length, ...(newNo ? { snapshotNo: newNo, snapshotKind: manual ? 'manual' : 'autosave' } : {}) });
  if (preNo) await aud('presentation.conflict_overwrite', 'presentation', id, { baseRev: input.baseRev, rev: u.rev, preOverwriteNo: preNo });
  return { rev: u.rev, savedAt: u.updated_at, hash: prep.hash, unchanged: false, ...(newNo ? { snapshotNo: newNo } : {}), ...(preNo ? { preOverwriteNo: preNo } : {}) };
}

/** POST /presentations — nova apresentação do usuário (em branco, conteúdo dado ou importado). */
export async function createPresentation(tx, { userId, aud, prep, source }) {
  const shas = [...prep.info.assetRefs];
  await assertAssetsUsable(tx, shas);
  const imported = source === 'import';
  const [p] = await tx`insert into app.presentations(owner_id, title, slide_count, content, content_hash, updated_by, snap_seq, last_snapshot_at)
        values (${userId}::uuid, ${prep.info.title}, ${prep.info.slideCount}, ${tx.json(prep.content)}, ${prep.hash}, ${userId}::uuid, ${imported ? 1 : 0}::int, ${imported ? tx`now()` : null})
        returning id`;
  if (shas.length) await tx`insert into app.asset_refs(presentation_id, version_no, sha256) select ${p.id}::uuid, 0, x from unnest(${shas}::text[]) x`;
  if (imported) await addVersionFromRow(tx, p.id, 1, 'import', 'Importação', userId);
  await touchAssets(tx, shas);
  await aud('presentation.create', 'presentation', p.id, { source: imported ? 'import' : 'new', bytes: prep.bytes, slideCount: prep.info.slideCount, assets: shas.length });
  return p.id;
}

/** POST /duplicate — cópia do conteúdo VISÍVEL ao usuário, em nova linha dele. O original não é tocado (só leitura). */
export async function duplicatePresentation(tx, { userId, aud, id, title }) {
  const [src] = await tx`select id, title, content, slide_count, thumb_sha from app.presentations where id = ${id}::uuid`;   // RLS: só o que o usuário vê
  if (!src) throw E.notFound();
  const newTitle = normalizeTitle(title ?? `Cópia de ${src.title}`) || 'Cópia';
  const prep = prepareContent({ ...src.content, title: newTitle });   // o título do deck acompanha (mesma regra do renomear) e passa pelo lint
  const [p] = await tx`insert into app.presentations(owner_id, title, slide_count, content, content_hash, updated_by, source_id, thumb_sha, snap_seq, last_snapshot_at)
        values (${userId}::uuid, ${prep.info.title}, ${src.slide_count}, ${tx.json(prep.content)}, ${prep.hash}, ${userId}::uuid, ${src.id}::uuid, ${src.thumb_sha}, 1, now()) returning id`;
  await tx`insert into app.asset_refs(presentation_id, version_no, sha256)
           select ${p.id}::uuid, 0, r.sha256 from app.asset_refs r where r.presentation_id = ${src.id}::uuid and r.version_no = 0`;
  await addVersionFromRow(tx, p.id, 1, 'copy', `Cópia de ${String(src.title).slice(0, 80)}`, userId);
  await aud('presentation.duplicate', 'presentation', p.id, { sourceId: src.id, slideCount: src.slide_count });
  return p.id;
}

/** PATCH — renomear: muda a coluna e content.title (e o hash; senão um "salvar" idêntico ao conteúdo antigo seria engolido como "sem alteração"). */
export async function renamePresentation(tx, { userId, aud, id, title }) {
  const row = await lockForEdit(tx, id);
  if (row.title === title) return;
  const [cur] = await tx`select content from app.presentations where id = ${id}::uuid`;
  const prep = prepareContent({ ...cur.content, title });          // o título também passa pelo lint (é texto de usuário dentro do JSON do deck)
  const [u] = await tx`update app.presentations set title = ${prep.info.title}, content = ${tx.json(prep.content)}, content_hash = ${prep.hash}, rev = rev + 1, updated_by = ${userId}::uuid where id = ${id}::uuid returning rev`;
  await aud('presentation.rename', 'presentation', id, { rev: u.rev, titleLength: Array.from(title).length });
}

export async function trashPresentation(tx, { userId, aud, id }) {
  const rows = await tx`update app.presentations set deleted_at = now(), deleted_by = ${userId}::uuid where id = ${id}::uuid and deleted_at is null returning id`;
  if (!rows.length) { await requireEdit(tx, id); return false; }   // já estava na lixeira → idempotente
  await aud('presentation.delete', 'presentation', id, { purge: false });
  return true;
}
export async function restorePresentation(tx, { aud, id }) {
  const rows = await tx`update app.presentations set deleted_at = null, deleted_by = null where id = ${id}::uuid and deleted_at is not null returning id`;
  if (!rows.length) { await requireEdit(tx, id); return false; }   // não estava na lixeira → idempotente
  await aud('presentation.restore', 'presentation', id, {});
  return true;
}
/** Apagar de vez: só admin e só da lixeira (o RLS também restringe o DELETE a admin). Referências e versões saem em cascata; os arquivos ficam para a coleta de lixo. */
export async function purgePresentation(tx, { aud, id }) {
  const [cur] = await tx`select deleted_at is not null as trashed from app.presentations where id = ${id}::uuid`;
  if (!cur) throw E.notFound();
  if (!cur.trashed) throw E.conflict('Mova a apresentação para a lixeira antes de apagá-la de vez.');
  const rows = await tx`delete from app.presentations where id = ${id}::uuid and deleted_at is not null returning id`;
  if (!rows.length) throw E.forbidden('Somente administradores apagam de vez.');
  await aud('presentation.purge', 'presentation', id, {});
}
export async function transferPresentation(tx, { aud, id, toUserId }) {
  const [t] = await tx`select id from app.directory where id = ${toUserId}::uuid and status = 'active'`;
  if (!t) throw E.notFound('Usuário de destino não encontrado ou inativo.');
  const [cur] = await tx`select owner_id from app.presentations where id = ${id}::uuid`;
  if (!cur) throw E.notFound();
  const rows = await tx`update app.presentations set owner_id = ${toUserId}::uuid where id = ${id}::uuid returning id`;
  if (!rows.length) throw E.forbidden('Somente administradores transferem apresentações.');
  await aud('presentation.transfer', 'presentation', id, { from: cur.owner_id, to: toUserId });
}

/* ───────────── versões ───────────── */

export async function listVersions(tx, id) {
  const rows = await tx`select v.version_no, v.kind, v.label, v.created_at, v.created_by, d.display_name as by_name, v.slide_count, v.title
      from app.presentation_versions v left join app.directory d on d.id = v.created_by
     where v.presentation_id = ${id}::uuid order by v.version_no desc limit 500`;
  return rows.map((v) => ({ no: v.version_no, kind: v.kind, label: v.label, createdAt: v.created_at, createdBy: v.created_by ? { id: v.created_by, displayName: v.by_name || 'Usuário' } : null, slideCount: v.slide_count, title: v.title }));
}
export async function getVersion(tx, id, no) {
  const [v] = await tx`select v.version_no, v.kind, v.label, v.created_at, v.created_by, d.display_name as by_name, v.slide_count, v.title, v.content
      from app.presentation_versions v left join app.directory d on d.id = v.created_by where v.presentation_id = ${id}::uuid and v.version_no = ${no}::int`;
  return v ? { no: v.version_no, kind: v.kind, label: v.label, createdAt: v.created_at, createdBy: v.created_by ? { id: v.created_by, displayName: v.by_name || 'Usuário' } : null, slideCount: v.slide_count, title: v.title, content: v.content } : null;
}

/** POST /versions/:no/restore — cria pre_restore (estado atual) e restore (estado restaurado); a cópia de trabalho passa a ser a versão. */
export async function restoreVersion(tx, { userId, aud, id, no, baseRev }) {
  const row = await lockForEdit(tx, id);
  if (baseRev !== row.rev) throw await conflictError(tx, row);
  const v = await getVersion(tx, id, no);
  if (!v) throw E.notFound('Versão não encontrada.');
  const prep = prepareContent(v.content);                 // as regras de segurança podem ter ficado mais rígidas desde que a versão foi gravada
  const shas = [...prep.info.assetRefs];
  await assertAssetsUsable(tx, shas);
  if (prep.hash === row.content_hash) return { rev: row.rev, savedAt: row.updated_at, hash: prep.hash, unchanged: true };

  let seq = row.snap_seq;
  const preNo = ++seq; await addVersionFromRow(tx, id, preNo, 'pre_restore', null, userId);
  const { added, removed } = await syncWorkingRefs(tx, id, shas);
  const restoreNo = ++seq;
  const [u] = await tx`update app.presentations
        set content = ${tx.json(prep.content)}, content_hash = ${prep.hash}, title = ${prep.info.title}, slide_count = ${prep.info.slideCount},
            rev = rev + 1, updated_by = ${userId}::uuid, snap_seq = ${seq}::int, last_snapshot_at = now()
      where id = ${id}::uuid returning rev, updated_at`;
  await addVersionFromRow(tx, id, restoreNo, 'restore', `Restaurada da versão ${no}`, userId);
  await touchAssets(tx, [...added, ...removed]);
  await aud('presentation.version_restore', 'presentation', id, { restoredNo: no, rev: u.rev, preRestoreNo: preNo, restoreNo });
  return { rev: u.rev, savedAt: u.updated_at, hash: prep.hash, unchanged: false, snapshotNo: restoreNo, preRestoreNo: preNo };
}

/* ───────────── manutenção (chamada por tools/maintenance.js, NUNCA por requisição) ───────────── */

/** Poda o histórico de UMA apresentação. `tx` precisa estar como app_system (ex.: ops.asSystem). Retorna quantas versões foram removidas. */
export async function pruneVersions(tx, presentationId, { keepLast = 50, dailyDays = 90 } = {}) {
  if (!isUuid(presentationId)) throw new TypeError('presentationId inválido');
  const [r] = await tx`select app.prune_versions(${presentationId}::uuid, ${keepLast}::int, ${dailyDays}::int) as n`;
  return r.n;
}
/** Poda todas as apresentações que passam de `keepLast` versões, usando as configurações do banco (versions.keep_last / keep_daily_days). */
export async function pruneAllVersions(ops, { log = () => {} } = {}) {
  return ops.asSystem(async (tx) => {
    const cfg = Object.fromEntries((await tx`select key, value from app.settings where key in ('versions.keep_last','versions.keep_daily_days')`).map((s) => [s.key, Number(s.value)]));
    const keepLast = Number.isInteger(cfg['versions.keep_last']) ? cfg['versions.keep_last'] : 50;
    const dailyDays = Number.isInteger(cfg['versions.keep_daily_days']) ? cfg['versions.keep_daily_days'] : 90;
    const ids = await tx`select presentation_id from app.presentation_versions group by presentation_id having count(*) > ${keepLast}::int`;
    let pruned = 0;
    for (const { presentation_id: pid } of ids) pruned += await pruneVersions(tx, pid, { keepLast, dailyDays });
    log(`versões: ${ids.length} apresentações examinadas, ${pruned} pontos removidos`);
    return { presentations: ids.length, pruned, keepLast, dailyDays };
  });
}
