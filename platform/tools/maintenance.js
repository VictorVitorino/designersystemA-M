#!/usr/bin/env node
/* tools/maintenance.js — rotinas de manutenção e verificação operacional.

   Uso:  node tools/maintenance.js <comando> [opções]
     purge-expired      expira convites vencidos e limpa contadores de limite de taxa antigos (app.purge_expired)
     prune-versions     poda o histórico de versões conforme app.settings (versions.keep_last / versions.keep_daily_days) [--dry-run]
     audit-retention    apaga auditoria com mais de --days (padrão 180) em lotes, com o sinal app.allow_audit_purge='on' [--dry-run]
     backup-freshness   falha se o último backup do banco (ou do espelho de arquivos) for mais velho que --max-hours (padrão 26)
     stats              números de uso e tamanhos; avisa perto dos limites [--warn-db-gb 6] [--warn-storage-gb 800]
                        [--resumo ARQ] tabela em Markdown (resumo do GitHub Actions) · [--github-output ARQ] grava capacidade=ok|alerta e o texto dos alertas
                        de CAPACIDADE (banco, arquivos, tuplas mortas) para o workflow abrir/fechar a issue "Alerta de capacidade" 
   Variáveis: DATABASE_OPS_URL (papel app_ops); backup-freshness usa BACKUP_TARGET + BACKUP_S3_* (somente LEITURA basta) e, se houver, BACKUP_ENCRYPTION_KEY para conferir o MAC. */
import fs from 'node:fs';
import { ToolError, buildRedactor, makeLogger, parseArgs, fmtBytes, runCli, isMain } from './lib/common.js';
import { connect } from './lib/pg.js';
import { openTarget } from './lib/targets.js';
import { keyringFromEnv, verifyManifest } from './lib/backup-crypto.js';
import { listBackups, loadManifest, readJson, STATUS_OBJECTS } from './lib/backup-catalog.js';

const sys = (sql, fn) => sql.begin(async (tx) => { await tx`set local role app_system`; return fn(tx); });
const num = (v, d) => { const n = typeof v === 'string' ? Number(JSON.parse(v)) : Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export async function purgeExpired(sql) { const [r] = await sys(sql, (tx) => tx`select rate_rows, invites_expired from app.purge_expired()`); return { rateRowsDeleted: r.rate_rows, invitesExpired: r.invites_expired }; }

export async function pruneVersions(sql, { dryRun = false } = {}) {
  const set = await sys(sql, (tx) => tx`select key, value from app.settings where key in ('versions.keep_last', 'versions.keep_daily_days')`);
  const m = Object.fromEntries(set.map((r) => [r.key, r.value])); const keep = num(m['versions.keep_last'], 50), days = num(m['versions.keep_daily_days'], 90);
  const pres = await sys(sql, (tx) => tx`select presentation_id as id from app.presentation_versions group by presentation_id
      having count(*) > ${keep} or min(created_at) < now() - make_interval(days => ${days})`);
  let removed = 0; const STOP = Symbol('dry');
  for (const p of pres) {
    try { await sys(sql, async (tx) => { const [r] = await tx`select app.prune_versions(${p.id}, ${keep}, ${days}) as n`; removed += r.n; if (dryRun) throw STOP; }); } catch (e) { if (e !== STOP) throw e; }
  }
  return { dryRun, keepLast: keep, keepDailyDays: days, presentationsExamined: pres.length, versionsRemoved: removed };
}

export async function auditRetention(sql, { days = 180, dryRun = false, batch = 5000 } = {}) {
  const [{ n }] = await sys(sql, (tx) => tx`select count(*)::int as n from app.audit_log where at < now() - make_interval(days => ${days})`);
  if (dryRun || n === 0) return { dryRun, days, eligible: n, deleted: 0 };
  let deleted = 0;
  for (;;) {
    const c = await sys(sql, async (tx) => { await tx`select set_config('app.allow_audit_purge', 'on', true)`; const r = await tx`delete from app.audit_log where id in (select id from app.audit_log where at < now() - make_interval(days => ${days}) order by id limit ${batch}) returning 1`; return r.length; });
    deleted += c; if (c < batch) break;
  }
  return { dryRun, days, eligible: n, deleted };
}

/** Frescor do backup. Espelho PARCIAL (parou no horário-limite durante a 1ª cópia de um acervo grande) não é problema por si; vira problema
 *  se continuar parcial por mais de `maxPartialDays` (a cópia nunca alcança a origem: falta rede ou tempo). */
export async function backupFreshness({ target, keys = null, maxHours = 26, checkObjects = true, maxPartialDays = 7, now = new Date() }) {
  const problems = [], info = {}; const { complete } = await listBackups(target);
  if (!complete.length) problems.push('NENHUM backup do banco encontrado no destino');
  else {
    const last = complete[complete.length - 1]; const age = (now - last.at) / 3600e3; info.db = { name: last.name, at: last.at.toISOString(), ageHours: Math.round(age * 10) / 10 };
    if (age > maxHours) problems.push(`o último backup do banco é de ${last.at.toISOString()} (${age.toFixed(1)} h; limite ${maxHours} h)`);
    try { const m = await loadManifest(target, last.name, { keys, requireMac: false }); info.db.bytes = m.dump.encryptedBytes; info.db.rows = Object.values(m.tables).reduce((a, t) => a + t.count, 0); } catch (e) { problems.push(`manifesto do último backup inválido: ${e.message}`); }
  }
  if (checkObjects) {
    const st = await readJson(target, STATUS_OBJECTS).catch(() => null);
    if (!st) problems.push('nunca houve espelho dos arquivos (status/objects-last-run.json ausente)');
    else { const age = (now - new Date(st.at)) / 3600e3; info.objects = { at: st.at, ageHours: Math.round(age * 10) / 10, ok: st.ok, copied: st.copied };
      if (keys && !verifyManifest(keys, st)) problems.push('status do espelho de arquivos com MAC inválido');
      if (age > maxHours) problems.push(`o último espelho de arquivos é de ${st.at} (${age.toFixed(1)} h; limite ${maxHours} h)`); if (!st.ok) problems.push('o último espelho de arquivos terminou COM FALHAS');
      if (st.partial) {
        const dias = st.partialSince ? (now - new Date(st.partialSince)) / 86400e3 : 0; info.objects.partial = true; info.objects.partialSince = st.partialSince || null;
        if (dias > maxPartialDays) problems.push(`o espelho de arquivos está INCOMPLETO há ${dias.toFixed(1)} dias (cada execução para no horário-limite antes de alcançar a origem): rode a 1ª cópia de uma máquina com rede melhor (node tools/backup.js objects) ou aumente a concorrência — docs/BACKUP-E-RESTAURACAO.md`);
      } }
  }
  return { ok: !problems.length, problems, ...info };
}

export async function stats(sql, { warnDbGb = 6, warnStorageGb = 800 } = {}) {
  const r = await sys(sql, async (tx) => {
    const [u] = await tx`select count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'invited')::int as invited, count(*) filter (where status = 'suspended')::int as suspended, count(*) filter (where role = 'admin' and status = 'active')::int as admins from app.users`;
    const [p] = await tx`select count(*) filter (where deleted_at is null)::int as live, count(*) filter (where deleted_at is not null)::int as trash from app.presentations`;
    const [v] = await tx`select count(*)::int as n from app.presentation_versions`;
    const [a] = await tx`select count(*) filter (where status = 'ready')::int as ready, coalesce(sum(size_bytes) filter (where status = 'ready'), 0)::bigint as bytes, count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'deleted')::int as marked_deleted from app.assets`;
    const [o] = await tx`select (select count(*)::int from app.audit_log) as audit, (select count(*)::int from app.comments where deleted_at is null) as comments, (select count(*)::int from app.interactions) as interactions, (select count(*)::int from app.invites where status = 'pending') as pending_invites`;
    const [d] = await tx`select pg_database_size(current_database())::bigint as bytes`;
    const tables = await tx`select c.relname as name, pg_total_relation_size(c.oid)::bigint as bytes from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r' order by 2 desc limit 5`;
    const bloat = await tx`select relname as name, n_live_tup::bigint as live, n_dead_tup::bigint as dead, last_autovacuum, last_vacuum from pg_stat_user_tables where schemaname = 'app' and relname in ('presentations', 'presentation_versions', 'audit_log', 'rate_limits') order by n_dead_tup desc`;
    return { users: u, presentations: p, versions: v.n, assets: { ready: a.ready, bytes: Number(a.bytes), pending: a.pending, markedDeleted: a.marked_deleted }, other: o, dbBytes: Number(d.bytes), biggestTables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes) })), bloat: bloat.map((b) => ({ name: b.name, live: Number(b.live), dead: Number(b.dead), lastAutovacuum: b.last_autovacuum, lastVacuum: b.last_vacuum })) };
  });
  const alerts = [];   // {kind, message}: kind = db_size | storage_size | bloat (CAPACIDADE) | admins (risco de acesso)
  if (r.dbBytes > warnDbGb * 1024 ** 3) alerts.push({ kind: 'db_size', message: `banco com ${fmtBytes(r.dbBytes)} (alerta em ${warnDbGb} GB): revise retenção de versões/auditoria ou aumente o plano` });
  if (r.assets.bytes > warnStorageGb * 1024 ** 3) alerts.push({ kind: 'storage_size', message: `arquivos somam ${fmtBytes(r.assets.bytes)} (alerta em ${warnStorageGb} GB): planeje mais espaço ou rode o GC` });
  if (r.users.admins < 2) alerts.push({ kind: 'admins', message: 'há menos de 2 administradores ativos (risco de perder o acesso administrativo)' });
  for (const b of r.bloat) if (b.dead > 10000 && b.dead > b.live) alerts.push({ kind: 'bloat', message: `${b.name}: ${b.dead} tuplas mortas para ${b.live} vivas (autovacuum atrasado — o autosave reescreve o deck inteiro); confira autovacuum em docs/MONITORAMENTO.md` });
  const warnings = alerts.map((a) => a.message);
  const capacity = alerts.filter((a) => CAPACITY_KINDS.includes(a.kind));
  return { ...r, dbHuman: fmtBytes(r.dbBytes), assetsHuman: fmtBytes(r.assets.bytes), warnings, alerts, capacity, limits: { warnDbGb, warnStorageGb }, ok: !warnings.length };
}
export const CAPACITY_KINDS = ['db_size', 'storage_size', 'bloat'];

/** Resumo em Markdown dos números (para o resumo da execução no GitHub). */
export function statsMarkdown(r) {
  const L = ['## Números de uso', '', '| Item | Valor |', '|---|---|',
    `| Usuários ativos (admins) | ${r.users.active} (${r.users.admins}) |`, `| Convidados pendentes / suspensos | ${r.users.invited} / ${r.users.suspended} |`,
    `| Apresentações (na lixeira) | ${r.presentations.live} (${r.presentations.trash}) |`, `| Versões guardadas | ${r.versions} |`,
    `| Arquivos prontos | ${r.assets.ready} (${r.assetsHuman}; alerta em ${r.limits.warnStorageGb} GB) |`, `| Banco | ${r.dbHuman} (alerta em ${r.limits.warnDbGb} GB) |`,
    `| Maiores tabelas | ${r.biggestTables.map((t) => `${t.name} ${fmtBytes(t.bytes)}`).join(', ')} |`,
    `| Tuplas mortas × vivas | ${r.bloat.map((b) => `${b.name} ${b.dead}/${b.live}`).join(', ') || '—'} |`, ''];
  L.push(r.alerts.length ? `**Avisos:**\n${r.alerts.map((a) => `- ${a.message}`).join('\n')}` : 'Sem avisos: tudo dentro dos limites.', '');
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['dry-run', 'json', 'no-objects', 'fail-on-warn'] }); const cmd = args._[0] || 'help'; const redact = buildRedactor(env); const logger = makeLogger({ json: !!args.json, redact });
  const out = (o, human) => { if (args.json) process.stdout.write(JSON.stringify({ cmd, ...o }) + '\n'); else logger.info(human); };
  if (cmd === 'help' || args.help) { process.stdout.write(`Uso: node tools/maintenance.js purge-expired | prune-versions | audit-retention | backup-freshness | stats\n`); return 0; }
  if (cmd === 'backup-freshness') {
    const target = openTarget(args.target || env.BACKUP_TARGET, env); let keys = null; try { keys = keyringFromEnv(env).all; } catch { /* sem chave: não confere o MAC */ }
    const r = await backupFreshness({ target, keys, maxHours: Number(args['max-hours'] ?? 26), checkObjects: !args['no-objects'] });
    out(r, r.ok ? `backup em dia: banco ${r.db?.name} (${r.db?.ageHours} h)${r.objects ? `, arquivos há ${r.objects.ageHours} h` : ''}` : `BACKUP DESATUALIZADO:\n  - ${r.problems.join('\n  - ')}`); return r.ok ? 0 : 1;
  }
  const url = env.DATABASE_OPS_URL; if (!url) throw new ToolError('defina DATABASE_OPS_URL (papel app_ops)', { exit: 2, code: 'no_db' });
  const sql = connect(url, { max: 2 });
  try {
    if (cmd === 'purge-expired') { const r = await purgeExpired(sql); out(r, `convites expirados: ${r.invitesExpired}; contadores antigos apagados: ${r.rateRowsDeleted}`); return 0; }
    if (cmd === 'prune-versions') { const r = await pruneVersions(sql, { dryRun: !!args['dry-run'] }); out(r, `${r.dryRun ? '(simulação) ' : ''}${r.versionsRemoved} versões removidas em ${r.presentationsExamined} apresentações (mantém ${r.keepLast} últimas + 1 por dia por ${r.keepDailyDays} dias + manuais)`); return 0; }
    if (cmd === 'audit-retention') { const r = await auditRetention(sql, { days: Number(args.days ?? 180), dryRun: !!args['dry-run'] }); out(r, `${r.dryRun ? '(simulação) ' : ''}auditoria com mais de ${r.days} dias: ${r.eligible} registros, ${r.deleted} apagados`); return 0; }
    if (cmd === 'stats') {
      const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };   // variável vazia no workflow → padrão
      const r = await stats(sql, { warnDbGb: num(args['warn-db-gb'], 6), warnStorageGb: num(args['warn-storage-gb'], 800) });
      out(r, `usuários ativos ${r.users.active} (admins ${r.users.admins}) · apresentações ${r.presentations.live} (+${r.presentations.trash} na lixeira) · versões ${r.versions} · arquivos ${r.assets.ready} (${r.assetsHuman}) · banco ${r.dbHuman}${r.warnings.length ? '\nAVISOS:\n  - ' + r.warnings.join('\n  - ') : ''}`);
      if (args.resumo) fs.appendFileSync(args.resumo, statsMarkdown(r) + '\n');
      if (args['github-output']) fs.appendFileSync(args['github-output'], `capacidade=${r.capacity.length ? 'alerta' : 'ok'}\nalertas<<CANTEIRO_FIM\n${r.capacity.map((a) => `- ${a.message}`).join('\n') || '- (nenhum)'}\nCANTEIRO_FIM\n`);
      return args['fail-on-warn'] && !r.ok ? 1 : 0;
    }
    throw new ToolError(`comando desconhecido: ${cmd}`, { exit: 2, code: 'usage' });
  } finally { await sql.end({ timeout: 5 }).catch(() => {}); }
}
if (isMain(import.meta.url)) runCli(() => main());
