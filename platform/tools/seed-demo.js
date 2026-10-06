#!/usr/bin/env node
/* tools/seed-demo.js — popula um banco de TESTE/ENSAIO com dados de demonstração realistas (nunca em produção):
   ~30 usuários, ~200 apresentações com versões, ~300 arquivos REAIS (PNG/JPEG/PDF/CSV) gravados no armazenamento com deduplicação por SHA-256,
   comentários, interações e auditoria. Escreve direto no banco pelo papel de operações (app_ops → app_system) e no armazenamento (pasta ou S3).
   Serve ao ensaio de restauração (tools/restore-drill.js) e a testes de carga/manutenção. Determinístico: a mesma --seed gera os mesmos dados.

   Uso:  DATABASE_OPS_URL=postgres://app_ops:…@127.0.0.1:5432/canteiro_t_x STORAGE_DRIVER=local STORAGE_LOCAL_DIR=/tmp/objs \
         node tools/seed-demo.js [--users 30] [--presentations 200] [--assets 300] [--seed 42] [--allow-remote] */
import crypto from 'node:crypto';
import { ToolError, buildRedactor, parseArgs, runCli, isMain, canonicalJson, sha256Hex, fmtBytes, mapLimit } from './lib/common.js';
import { openPrimaryStore } from './lib/targets.js';
import { keyOfSha } from './lib/mirror.js';
import { connect, isLocalHost } from './lib/pg.js';

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Karen', 'Lucas', 'Marina', 'Nelson', 'Olívia', 'Paulo', 'Queila', 'Rafael', 'Sofia', 'Tiago', 'Úrsula', 'Vitor', 'Wagner', 'Ximena', 'Yara', 'Zeca'];
const SURN = ['Silva', 'Souza', 'Costa', 'Oliveira', 'Pereira', 'Lima', 'Carvalho', 'Almeida', 'Ribeiro', 'Gomes'];
const TITLES = ['Diagnóstico operacional', 'Plano de transformação', 'Proposta comercial', 'Resultados do trimestre', 'Roadmap 2027', 'Due diligence', 'Kickoff do projeto', 'Revisão de portfólio', 'Estudo de mercado', 'Comitê executivo'];
const COMMENTS = ['Podemos detalhar esta parte?', 'Ótimo slide, só ajustar a cor do título.', 'Falta a fonte do dado.', 'Sugiro mover para o final.', 'Revisado, pode seguir.', 'Atualizar com o número fechado de setembro.'];
const ACTIONS = ['auth.login', 'auth.logout', 'presentation.create', 'presentation.update', 'presentation.duplicate', 'presentation.share', 'asset.upload', 'comment.create', 'presentation.delete', 'presentation.restore'];

const pad = (n, w = 8) => String(n).padStart(w, '0');
function uuid(r) { const b = crypto.createHash('sha256').update(String(r())).update(String(r())).digest().subarray(0, 16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const h = b.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }

async function makeImage(sharp, r, i, kind) {
  if (kind === 'thumb') { const w = 96, h = 54; const raw = Buffer.alloc(w * h * 3); for (let k = 0; k < raw.length; k++) raw[k] = (Math.floor(r() * 256) + i * 7) & 255; return { buf: await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 60 }).toBuffer(), mime: 'image/webp', width: w, height: h }; }
  const w = 80 + Math.floor(r() * 140), h = 60 + Math.floor(r() * 110); const raw = Buffer.alloc(w * h * 3); const base = [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)];
  for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) raw[p * 3 + c] = Math.max(0, Math.min(255, base[c] + Math.floor((r() - 0.5) * 80) + ((p % w) >> 3)));
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return r() < 0.35 ? { buf: await img.jpeg({ quality: 80 }).toBuffer(), mime: 'image/jpeg', width: w, height: h } : { buf: await img.png().toBuffer(), mime: 'image/png', width: w, height: h };
}
function makePdf(i, r) {
  const body = `BT /F1 12 Tf 72 720 Td (Documento demo ${i} - ${Math.floor(r() * 1e9)}) Tj ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', `<</Length ${body.length}>>\nstream\n${body}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let pdf = '%PDF-1.4\n'; const offs = []; objs.forEach((o, k) => { offs.push(pdf.length); pdf += `${k + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${pad(o, 10)} 00000 n \n`).join('') + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(pdf + '%' + 'x'.repeat(2000 + Math.floor(r() * 30000)) + '\n');
}
const makeCsv = (i, r) => Buffer.from('﻿nome;valor;nota\n' + Array.from({ length: 20 + Math.floor(r() * 400) }, (_, k) => `Item ${i}-${k};${Math.floor(r() * 10000)};${r().toFixed(4)}`).join('\n') + '\n');

export async function seedDemo({ opsUrl, store, users = 30, presentations = 200, assets = 300, seed = 42, log = () => {} } = {}) {
  const t0 = Date.now(); const r = prng(seed); const sharp = (await import('sharp')).default;
  const sql = connect(opsUrl, { max: 2 });
  try {
    const base = new Date(Date.now() - 60 * 86400000);
    // ---- usuários
    const U = []; for (let i = 0; i < users; i++) U.push({ id: uuid(r), email: `demo.user${pad(i, 3)}@demo.canteiro.invalid`, display_name: `${NAMES[i % NAMES.length]} ${SURN[Math.floor(r() * SURN.length)]}`, role: i === 0 ? 'admin' : 'member', status: i === users - 1 ? 'suspended' : 'active', created_at: new Date(base.getTime() + i * 3600e3).toISOString() });
    // ---- arquivos reais + deduplicação
    const A = []; const seenSha = new Set(); let uploadsAttempted = 0, dedupHits = 0, bytes = 0; const objects = [];
    for (let i = 0; i < assets; i++) {
      const roll = r(); let f;
      if (roll < 0.9) { const im = await makeImage(sharp, r, i, 'image'); f = { ...im, kind: 'image' }; }
      else if (roll < 0.96) f = { buf: makePdf(i, r), mime: 'application/pdf', kind: 'attachment' };
      else f = { buf: makeCsv(i, r), mime: 'text/csv', kind: 'attachment' };
      f.sha = sha256Hex(f.buf); uploadsAttempted++;
      if (seenSha.has(f.sha)) { dedupHits++; continue; } seenSha.add(f.sha); A.push(f); bytes += f.buf.length;
    }
    // reenvios do MESMO arquivo por outras pessoas (deduplicação real: mesmo SHA-256 → um só objeto)
    const dupUploads = []; const nDup = Math.floor(assets * 0.4);
    for (let i = 0; i < nDup; i++) { const a = A[Math.floor(r() * A.length)]; dupUploads.push({ sha: a.sha, uploader: U[Math.floor(r() * Math.max(1, users - 1))].id }); uploadsAttempted++; dedupHits++; }
    for (const a of A) a.uploader = U[Math.floor(r() * (users - 1))].id;
    // ---- apresentações
    const imgs = A.filter((a) => a.kind === 'image'); const P = [], V = [], REFS = [], THUMBS = [];
    for (let i = 0; i < presentations; i++) {
      const owner = U[Math.floor(r() * (users - 1))]; const nSlides = 3 + Math.floor(r() * 10); const used = [];
      const slides = Array.from({ length: nSlides }, (_, s) => {
        const els = [{ id: `t${s}`, type: 'text', x: 60, y: 40, w: 840, h: 80, text: `${TITLES[Math.floor(r() * TITLES.length)]} — seção ${s + 1}` }];
        if (r() < 0.6 && imgs.length) { const im = imgs[Math.floor(r() * imgs.length)]; used.push(im.sha); els.push({ id: `i${s}`, type: 'image', x: 80, y: 150, w: 360, h: 240, src: `asset:sha256:${im.sha}` }); }
        if (r() < 0.2) els.push({ id: `f${s}`, type: 'form', x: 480, y: 160, w: 380, h: 220, questions: [{ id: 'q1', kind: 'text', label: 'Sua opinião?' }] });
        return { id: `s${s}`, layout: 'blank', elements: els };
      });
      const id = uuid(r); const title = `${TITLES[Math.floor(r() * TITLES.length)]} ${i + 1}`;
      const mkContent = (n, snapshotUsed) => ({ v: 1, app: 'AM Studio', id, title, slides: slides.slice(0, n) });
      const content = mkContent(nSlides); const hash = sha256Hex(Buffer.from(canonicalJson(content)));
      const nVer = 1 + Math.floor(r() * 6); const created = new Date(base.getTime() + Math.floor(r() * 50) * 86400e3);
      let thumb = null; if (r() < 0.7) { const t = await makeImage(sharp, r, i, 'thumb'); thumb = { sha: sha256Hex(t.buf), ...t, kind: 'thumb', uploader: owner.id }; if (!seenSha.has(thumb.sha)) { seenSha.add(thumb.sha); THUMBS.push(thumb); bytes += t.buf.length; } }
      const deleted = r() < 0.05;
      P.push({ id, owner_id: owner.id, title, slide_count: nSlides, rev: nVer + 1, snap_seq: nVer, content, content_hash: hash, thumb_sha: thumb?.sha || null, created_at: created.toISOString(), updated_at: new Date(created.getTime() + 86400e3).toISOString(), updated_by: owner.id, last_snapshot_at: created.toISOString(), deleted_at: deleted ? new Date(created.getTime() + 2 * 86400e3).toISOString() : null, deleted_by: deleted ? owner.id : null });
      for (const sha of new Set(used)) REFS.push({ presentation_id: id, version_no: 0, sha256: sha });
      for (let v = 1; v <= nVer; v++) {
        const n = Math.max(1, Math.ceil((nSlides * v) / nVer)); const c = mkContent(n); const vUsed = new Set(); for (const sl of c.slides) for (const el of sl.elements) if (el.src) vUsed.add(el.src.slice('asset:sha256:'.length));
        V.push({ presentation_id: id, version_no: v, content: c, content_hash: sha256Hex(Buffer.from(canonicalJson(c))), slide_count: n, title, kind: v === 1 ? 'import' : r() < 0.2 ? 'manual' : 'autosave', label: r() < 0.2 ? 'Versão revisada' : null, created_by: owner.id, created_at: new Date(created.getTime() + v * 3600e3).toISOString() });
        for (const sha of vUsed) REFS.push({ presentation_id: id, version_no: v, sha256: sha });
      }
    }
    // ---- grava arquivos no armazenamento (idempotente: mesma chave = mesmo conteúdo)
    const all = [...A, ...THUMBS]; let written = 0;
    await mapLimit(all, 8, async (f) => { const key = keyOfSha(f.sha); if (!(await store.head(key))) { await store.put(key, f.buf); written++; } });
    // ---- grava no banco (uma transação; papel de sistema)
    const C = [], I = [], AU = [];
    for (let i = 0; i < Math.floor(presentations * 2.5); i++) { const p = P[Math.floor(r() * P.length)]; const au = U[Math.floor(r() * (users - 1))]; C.push({ id: uuid(r), presentation_id: p.id, slide_index: r() < 0.7 ? Math.floor(r() * p.slide_count) : null, author_id: au.id, body: COMMENTS[Math.floor(r() * COMMENTS.length)], created_at: new Date(Date.now() - Math.floor(r() * 30) * 86400e3).toISOString(), resolved_at: r() < 0.3 ? new Date().toISOString() : null }); }
    const kinds = ['form_response', 'view', 'reaction', 'board_state', 'vote_state']; const stateSeen = new Set();
    for (let i = 0; i < presentations * 4; i++) {
      const p = P[Math.floor(r() * P.length)]; const u = U[Math.floor(r() * (users - 1))]; const k = kinds[Math.floor(r() * kinds.length)]; const el = `el${Math.floor(r() * 5)}`;
      if (k === 'board_state' || k === 'vote_state') { const key = `${p.id}|${u.id}|${k}|${el}`; if (stateSeen.has(key)) continue; stateSeen.add(key); }
      I.push({ presentation_id: p.id, user_id: u.id, kind: k, element_id: el, payload: { answer: `resposta ${Math.floor(r() * 100)}`, n: Math.floor(r() * 10) } });
    }
    for (let i = 0; i < presentations * 7; i++) { const u = U[Math.floor(r() * users)]; AU.push({ at: new Date(Date.now() - Math.floor(r() * 60 * 86400e3)).toISOString(), actor_id: u.id, action: ACTIONS[Math.floor(r() * ACTIONS.length)], entity_type: 'presentation', entity_id: P[Math.floor(r() * P.length)].id, ip: `10.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}.${1 + Math.floor(r() * 254)}`, user_agent: 'Mozilla/5.0 (demo)', request_id: `demo${pad(i)}`, meta: { size: Math.floor(r() * 5000) } }); }
    const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
    await sql.begin(async (tx) => {
      await tx`set local role app_system`;
      for (const c of chunks(U, 100)) await tx`insert into app.users ${tx(c, 'id', 'email', 'display_name', 'role', 'status', 'created_at')} `;
      await tx`update app.users set activated_at = created_at where status = 'active'`;
      for (const c of chunks(U, 100)) await tx`insert into app.user_identities ${tx(c.map((u) => ({ provider: 'supabase', subject: uuid(r), user_id: u.id, email_at_link: u.email })), 'provider', 'subject', 'user_id', 'email_at_link')}`;
      const assetRows = all.map((f) => ({ sha256: f.sha, size_bytes: f.buf.length, mime: f.mime, kind: f.kind, width: f.width || null, height: f.height || null, status: 'ready', uploaded_by: f.uploader || U[1].id, ready_at: new Date().toISOString() }));
      for (const c of chunks(assetRows, 200)) await tx`insert into app.assets ${tx(c, 'sha256', 'size_bytes', 'mime', 'kind', 'width', 'height', 'status', 'uploaded_by', 'ready_at')}`;
      const upl = new Map(); for (const f of all) upl.set(f.sha + '|' + (f.uploader || U[1].id), { sha256: f.sha, user_id: f.uploader || U[1].id }); for (const d of dupUploads) upl.set(d.sha + '|' + d.uploader, { sha256: d.sha, user_id: d.uploader });
      for (const c of chunks([...upl.values()], 300)) await tx`insert into app.asset_uploads ${tx(c, 'sha256', 'user_id')} on conflict do nothing`;
      for (const c of chunks(P, 20)) await tx`insert into app.presentations ${tx(c.map((p) => ({ ...p, content: tx.json(p.content) })), 'id', 'owner_id', 'title', 'slide_count', 'rev', 'snap_seq', 'content', 'content_hash', 'thumb_sha', 'created_at', 'updated_at', 'updated_by', 'last_snapshot_at', 'deleted_at', 'deleted_by')}`;
      for (const c of chunks(V, 20)) await tx`insert into app.presentation_versions ${tx(c.map((v) => ({ ...v, content: tx.json(v.content) })), 'presentation_id', 'version_no', 'content', 'content_hash', 'slide_count', 'title', 'kind', 'label', 'created_by', 'created_at')}`;
      const refKey = new Map(); for (const x of REFS) refKey.set(`${x.presentation_id}|${x.version_no}|${x.sha256}`, x);
      for (const c of chunks([...refKey.values()], 500)) await tx`insert into app.asset_refs ${tx(c, 'presentation_id', 'version_no', 'sha256')}`;
      for (const c of chunks(C, 200)) await tx`insert into app.comments ${tx(c, 'id', 'presentation_id', 'slide_index', 'author_id', 'body', 'created_at', 'resolved_at')}`;
      for (const c of chunks(I, 200)) await tx`insert into app.interactions ${tx(c.map((x) => ({ ...x, payload: tx.json(x.payload) })), 'presentation_id', 'user_id', 'kind', 'element_id', 'payload')}`;
      for (const c of chunks(AU, 200)) await tx`insert into app.audit_log ${tx(c.map((x) => ({ ...x, meta: tx.json(x.meta) })), 'at', 'actor_id', 'action', 'entity_type', 'entity_id', 'ip', 'user_agent', 'request_id', 'meta')}`;
      await tx`insert into app.rate_limits(bucket, key, window_start, hits) select 'demo', 'k' || g, now(), g from generate_series(1, 5) g`;
    });
    const rep = { users, presentations, versions: V.length, assetsUnique: all.length, files: A.length, thumbs: THUMBS.length, uploadsAttempted: uploadsAttempted + THUMBS.length, dedupHits, objectsWritten: written, bytes, bytesHuman: fmtBytes(bytes), comments: C.length, interactions: I.length, audit: AU.length, refs: REFS.length, durationMs: Date.now() - t0, seed };
    log(`seed: ${users} usuários, ${presentations} apresentações, ${V.length} versões, ${all.length} arquivos únicos (${fmtBytes(bytes)}; ${dedupHits} reenvios deduplicados), ${C.length} comentários, ${I.length} interações, ${AU.length} eventos de auditoria`);
    return rep;
  } finally { await sql.end({ timeout: 5 }); }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['allow-remote', 'json'] });
  if (env.APP_ENV === 'production') throw new ToolError('seed-demo NUNCA roda com APP_ENV=production', { code: 'refuse_production', exit: 2 });
  const url = env.DATABASE_OPS_URL; if (!url) throw new ToolError('defina DATABASE_OPS_URL (papel app_ops)', { exit: 2, code: 'no_db' });
  if (!isLocalHost(new URL(url).hostname) && !args['allow-remote']) throw new ToolError('o banco não é local; use --allow-remote só se for um banco de ENSAIO descartável', { exit: 2, code: 'refuse_remote' });
  const n = await connectCount(url); if (n > 0) throw new ToolError(`o banco já tem ${n} usuários; o seed só roda em banco vazio (recrie o banco de teste)`, { exit: 2, code: 'not_empty' });
  const rep = await seedDemo({ opsUrl: url, store: openPrimaryStore(env), users: Number(args.users) || 30, presentations: Number(args.presentations) || 200, assets: Number(args.assets) || 300, seed: Number(args.seed) || 42, log: (m) => process.stderr.write(m + '\n') });
  if (args.json) process.stdout.write(JSON.stringify(rep) + '\n'); return 0;
}
async function connectCount(url) { const sql = connect(url, { max: 1 }); try { return await sql.begin(async (tx) => { await tx`set local role app_system`; const [{ n }] = await tx`select count(*)::int as n from app.users`; return n; }); } finally { await sql.end(); } }
if (isMain(import.meta.url)) runCli(() => main());
