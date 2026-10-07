#!/usr/bin/env node
/* tools/gc-assets.js — coleta de lixo de ARQUIVOS órfãos (sem nenhuma referência), com trava contra corridas.

   Uso:  DATABASE_OPS_URL=… STORAGE_DRIVER=… (S3_* | STORAGE_LOCAL_DIR) node tools/gc-assets.js [--apply] [--age-days 14] [--grace-hours 24] [--guard-hours 48]
                                                                                     [--limit N] [--scan-storage] [--delete-unknown] [--json]
   Padrão = RELATÓRIO (não altera nada). Com --apply, em DUAS fases (a segunda só age no que a primeira marcou há tempo suficiente):
     1. MARCAR: arquivos órfãos há mais de --age-days (app.orphan_assets) viram status 'deleted' (ainda existem no armazenamento; ninguém os serve).
     2. APAGAR: arquivos 'deleted' há mais de --grace-hours: o objeto e a linha são removidos.
   Garantias (cada uma tem teste de corrida):
     • NUNCA apaga o que tem referência: nem de apresentações, nem de VERSÕES do histórico (asset_refs), nem miniaturas em uso (presentations.thumb_sha).
     • Cada arquivo é conferido de novo DENTRO de uma transação com a linha travada (SELECT … FOR UPDATE). Quem tenta criar uma referência ao mesmo tempo
       espera a trava (a chave estrangeira pede lock na linha): ou a referência entra antes (e o arquivo é salvo/reativado) ou o arquivo é apagado e a referência
       FALHA de forma limpa (o cliente reenvia o arquivo). Nunca sobra referência apontando para um arquivo apagado.
     • Trava contra upload recente: arquivo reenviado (asset_uploads) ou referenciado há menos de --guard-hours, ou com objeto gravado há menos que isso, é pulado.
     • Se, na fase 2, surgir uma referência a um arquivo marcado, ele é REATIVADO (status 'ready') em vez de apagado.
   A marcação grava last_ref_at = agora (é o relógio da carência). */
import { ToolError, buildRedactor, makeLogger, parseArgs, fmtBytes, runCli, isMain, mapLimit } from './lib/common.js';
import { openPrimaryStore } from './lib/targets.js';
import { keyOfSha, shaOfKey } from './lib/mirror.js';
import { connect } from './lib/pg.js';

/** Está sem NENHUM uso? Chamado com a linha travada. Devolve motivo de proteção ou null. */
async function protection(tx, sha, { guardHours, checkRecent = true }) {
  const [r] = await tx`select
      exists (select 1 from app.asset_refs where sha256 = ${sha}) as has_ref,
      exists (select 1 from app.presentations where thumb_sha = ${sha}) as is_thumb,
      exists (select 1 from app.asset_uploads where sha256 = ${sha} and at > now() - make_interval(hours => ${guardHours})) as recent_upload`;
  if (r.has_ref) return 'tem referência (apresentação ou versão)'; if (r.is_thumb) return 'é miniatura em uso';
  if (checkRecent && r.recent_upload) return 'enviado novamente há pouco (trava de upload recente)';
  return null;
}

export async function runGc({ sql, store, apply = false, ageDays = 14, graceHours = 24, guardHours = 48, limit = Infinity, scanStorage = false, deleteUnknown = false, hooks = {}, log = () => {} } = {}) {
  const t0 = Date.now(); const rep = { apply, ageDays, graceHours, guardHours, candidates: 0, candidateBytes: 0, marked: 0, deleted: 0, deletedBytes: 0, revived: 0, skipped: [], errors: [], pendingDeletion: 0, unknownObjects: null };
  const sys = (fn) => sql.begin(async (tx) => { await tx`set local role app_system`; return fn(tx); });

  // ---- fase 1: candidatos (órfãos antigos, sem upload/referência recente)
  const cands = await sys((tx) => tx`select o.sha256, o.size_bytes::bigint as size from app.orphan_assets(make_interval(days => ${ageDays})) o join app.assets a on a.sha256 = o.sha256
      where coalesce(a.last_ref_at, '-infinity') < now() - make_interval(hours => ${guardHours})
        and not exists (select 1 from app.asset_uploads u where u.sha256 = a.sha256 and u.at > now() - make_interval(hours => ${guardHours}))
      order by a.created_at limit ${Number.isFinite(limit) ? limit : 1000000}`);
  rep.candidates = cands.length; rep.candidateBytes = cands.reduce((a, c) => a + Number(c.size), 0);
  const waiting = await sys((tx) => tx`select sha256, size_bytes::bigint as size, last_ref_at from app.assets where status = 'deleted' order by last_ref_at`);
  rep.pendingDeletion = waiting.length;
  await hooks.afterCandidates?.(cands);                         // (testes) corrida entre a seleção e a marcação
  log(`GC: ${cands.length} arquivos órfãos há > ${ageDays} dias (${fmtBytes(rep.candidateBytes)}); ${waiting.length} já marcados aguardando a carência de ${graceHours} h`);

  if (apply) {
    for (const c of cands) {
      try {
        const res = await sys(async (tx) => {
          const [a] = await tx`select sha256, status from app.assets where sha256 = ${c.sha256} for update`; if (!a || !['ready', 'pending', 'rejected'].includes(a.status)) return { skip: 'mudou de estado' };
          const why = await protection(tx, c.sha256, { guardHours }); if (why) return { skip: why };
          await tx`update app.assets set status = 'deleted', last_ref_at = now() where sha256 = ${c.sha256}`; return { marked: true };
        });
        if (res.marked) { rep.marked++; await hooks.afterMark?.(c.sha256); } else rep.skipped.push({ sha: c.sha256, motivo: res.skip });
      } catch (e) { rep.errors.push({ sha: c.sha256, fase: 'marcar', error: String(e.message).slice(0, 160) }); }
    }
    // ---- fase 2: apagar o que está marcado há mais que a carência
    const due = await sys((tx) => tx`select sha256 from app.assets where status = 'deleted' and last_ref_at < now() - make_interval(hours => ${graceHours}) order by last_ref_at limit ${Number.isFinite(limit) ? limit : 1000000}`);
    for (const d of due) {
      const sha = d.sha256; const key = keyOfSha(sha);
      try {
        const out = await sys(async (tx) => {
          const [a] = await tx`select sha256, status, size_bytes::bigint as size from app.assets where sha256 = ${sha} for update`; if (!a || a.status !== 'deleted') return { skip: 'mudou de estado' };
          const why = await protection(tx, sha, { guardHours });
          if (why) { await tx`update app.assets set status = 'ready', last_ref_at = now() where sha256 = ${sha}`; return { revived: why }; }
          const head = await store.head(key);
          if (head?.lastModified && Date.now() - new Date(head.lastModified).getTime() < guardHours * 3600e3 && guardHours > 0) return { skip: 'objeto gravado há pouco no armazenamento' };
          await hooks.beforeObjectDelete?.(sha);                  // (testes) corrida: acontece COM a linha travada
          await tx`delete from app.assets where sha256 = ${sha}`; // referências novas passam a falhar (FK) em vez de apontar para o vazio
          await store.delete(key);                                // se falhar, a transação desfaz tudo
          return { deleted: Number(a.size) };
        });
        if (out.deleted !== undefined) { rep.deleted++; rep.deletedBytes += out.deleted; } else if (out.revived) { rep.revived++; rep.skipped.push({ sha, motivo: 'reativado: ' + out.revived }); } else rep.skipped.push({ sha, motivo: out.skip });
      } catch (e) { rep.errors.push({ sha, fase: 'apagar', error: String(e.message).slice(0, 160) }); }
    }
  }

  // ---- objetos sem registro no banco (restos de upload interrompido)
  if (scanStorage) {
    const known = new Set((await sys((tx) => tx`select sha256 from app.assets`)).map((r) => r.sha256)); const unknown = []; let n = 0;
    for await (const o of store.list('a/')) {
      const sha = shaOfKey(o.key); if (!sha || known.has(sha)) continue; n++;
      if (o.lastModified && Date.now() - new Date(o.lastModified).getTime() < guardHours * 3600e3) continue;
      unknown.push({ key: o.key, size: o.size });
    }
    rep.unknownObjects = { count: unknown.length, bytes: unknown.reduce((a, o) => a + o.size, 0), sample: unknown.slice(0, 20).map((o) => o.key), deleted: 0 };
    if (apply && deleteUnknown) for (const o of unknown) {
      // reconfere no banco imediatamente antes de apagar (um upload pode ter registrado a linha agora)
      const sha = shaOfKey(o.key); const ok = await sys(async (tx) => { const [r] = await tx`select 1 as x from app.assets where sha256 = ${sha} for share`; return !r; });
      if (ok) { await store.delete(o.key); rep.unknownObjects.deleted++; }
    }
  }
  rep.durationMs = Date.now() - t0; rep.ok = !rep.errors.length;
  return rep;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['apply', 'json', 'scan-storage', 'delete-unknown'] }); const redact = buildRedactor(env); const logger = makeLogger({ json: !!args.json, redact });
  const url = env.DATABASE_OPS_URL; if (!url) throw new ToolError('defina DATABASE_OPS_URL (papel app_ops)', { exit: 2, code: 'no_db' });
  const store = openPrimaryStore(env); const sql = connect(url, { max: 2 });
  try {
    const rep = await runGc({ sql, store, apply: !!args.apply, ageDays: Number(args['age-days'] ?? 14), graceHours: Number(args['grace-hours'] ?? 24), guardHours: Number(args['guard-hours'] ?? 48), limit: args.limit ? Number(args.limit) : Infinity, scanStorage: !!args['scan-storage'], deleteUnknown: !!args['delete-unknown'], log: (m) => logger.info(m) });
    if (args.apply && typeof store.purgeStaging === 'function') { const hours = Number(args['staging-hours'] ?? 48); const ps = await store.purgeStaging({ olderThanMs: hours * 3600 * 1000 }); rep.staging = ps; if (ps.deleted) logger.info(`preparos de upload abandonados (> ${hours} h) apagados: ${ps.deleted} (${fmtBytes(ps.bytes)})`); }
    logger.info(args.apply ? `GC aplicado: ${rep.marked} marcados, ${rep.deleted} apagados (${fmtBytes(rep.deletedBytes)}), ${rep.revived} reativados, ${rep.skipped.length} pulados, ${rep.errors.length} erros` : `GC em modo RELATÓRIO: nada foi alterado. Para aplicar: --apply`);
    for (const e of rep.errors) logger.error(`${e.fase} ${e.sha}: ${e.error}`);
    if (args.json) process.stdout.write(JSON.stringify(rep) + '\n'); return rep.ok ? 0 : 1;
  } finally { await sql.end({ timeout: 5 }).catch(() => {}); }
}
if (isMain(import.meta.url)) runCli(() => main());
