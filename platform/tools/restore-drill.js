#!/usr/bin/env node
/* tools/restore-drill.js — ENSAIO de desastre e restauração, de ponta a ponta, com evidência escrita.

   O que faz (tudo em banco/pastas DESCARTÁVEIS de teste; recusa nomes que não sejam canteiro_t_*):
     1. recria o esquema e popula dados de demonstração (tools/seed-demo.js: ~30 usuários, ~200 apresentações com versões, ~300 arquivos reais, comentários, interações, auditoria)
     2. backup CRIPTOGRAFADO do banco + espelho dos arquivos para um destino separado (pasta; e também um bucket S3 falso "moto", se disponível) e verificação do backup
     3. grava mais alguns dados DEPOIS do backup (serão perdidos de propósito: é o RPO observado)
     4. DESASTRE: apaga o schema app e a pasta de arquivos
     5. RESTAURAÇÃO em banco novo + arquivos em pasta nova, a partir do backup, e verificação completa:
        contagens e amostras de linhas por tabela, migrate --check, re-hash de TODOS os arquivos referenciados, verify-deploy (RLS, papéis, permissões),
        isolamento (membro vê o acervo, desconhecido não vê nada, app_api sem acesso direto às tabelas)
     6. escreve docs/evidencias/restore-drill.md e .json com tempos (RTO), perda (RPO) e o que NÃO foi medido

   Uso:  TEST_DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:5432/canteiro_t_c node tools/restore-drill.js [--s3] [--users 30] [--presentations 200] [--assets 300] [--out docs/evidencias] [--keep] */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ToolError, buildRedactor, parseArgs, fmtBytes, fmtMs, runCli, isMain } from './lib/common.js';
import { connect, withDatabase, dbNameOf, isLocalHost, pgToolVersion, findPgBin } from './lib/pg.js';
import { FileStore, openTarget } from './lib/targets.js';
import { keyringFromEnv } from './lib/backup-crypto.js';
import { startMoto, makeBucket } from './lib/moto.js';
import { listBackups } from './lib/backup-catalog.js';
import { migrate } from './migrate.js';
import { seedDemo } from './seed-demo.js';
import { backupDb, backupObjects } from './backup.js';
import { restoreDb, listReferencedObjects } from './restore.js';
import { restoreObjects } from './lib/mirror.js';
import { runChecks } from './verify-deploy.js';
import { createDb } from '../src/db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_PW = process.env.APP_API_DB_PASSWORD || 'app_api_test', OPS_PW = process.env.APP_OPS_DB_PASSWORD || 'app_ops_test';   // mesmos valores dos testes de banco (papéis são do cluster inteiro)
const withCreds = (url, u, p) => { const x = new URL(url); x.username = u; x.password = p; return x.toString(); };

export async function runDrill({ adminUrl, outDir = path.join(HERE, '..', 'docs', 'evidencias'), users = 30, presentations = 200, assets = 300, useS3 = false, keep = false, log = () => {} } = {}) {
  const u = new URL(adminUrl); const srcDb = dbNameOf(adminUrl);
  if (!/^canteiro_(test|t_[a-z0-9]+)$/.test(srcDb)) throw new ToolError(`o ensaio só roda em bancos canteiro_test ou canteiro_t_<nome> (recebi ${srcDb}): ele DESTRÓI o banco de origem de propósito`, { exit: 2, code: 'unsafe_db' });
  if (!isLocalHost(u.hostname)) throw new ToolError('o ensaio só roda em Postgres local/descartável', { exit: 2, code: 'unsafe_host' });
  const t0 = performance.now(); const steps = []; const now = () => performance.now();
  const step = async (name, fn) => { const s = now(); log(`▶ ${name}`); try { const r = await fn(); steps.push({ name, ms: Math.round(now() - s), ok: true }); return r; } catch (e) { steps.push({ name, ms: Math.round(now() - s), ok: false, error: String(e.message).slice(0, 300) }); throw e; } };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-drill-')); const objDir = path.join(work, 'arquivos-origem'), bkDir = path.join(work, 'backup-externo'), newObjDir = path.join(work, 'arquivos-restaurados'), s3ObjDir = path.join(work, 'arquivos-restaurados-s3');
  fs.mkdirSync(objDir, { recursive: true, mode: 0o750 }); fs.chmodSync(objDir, 0o750);
  const key = crypto.randomBytes(32).toString('base64'); const restoreUrl = withDatabase(adminUrl, `${srcDb}_restore`), restoreS3Url = withDatabase(adminUrl, `${srcDb}_restore_s3`);
  const maint = connect(withDatabase(adminUrl, 'postgres'), { max: 1 }); const created = [];
  const baseEnv = { ...process.env, DATABASE_ADMIN_URL: adminUrl, BACKUP_ENCRYPTION_KEY: key, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: objDir, APP_ENV: 'drill', BACKUP_ENV_NAME: 'drill', APP_API_DB_PASSWORD: API_PW, APP_OPS_DB_PASSWORD: OPS_PW };
  const envFile = { ...baseEnv, BACKUP_TARGET: `file://${bkDir}` }; delete envFile.PG_BIN_DIR;
  const ev = { schema: 'canteiro-restore-drill/1', startedAt: new Date().toISOString(), tools: {}, dataset: {}, backups: {}, disaster: {}, restore: {}, verification: {}, limits: [] };
  let moto = null;
  try {
    ev.tools = { node: process.version, pg_dump: pgToolVersion(findPgBin('pg_dump')).full, platform: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length };
    const keyring = keyringFromEnv(envFile); const target = openTarget(envFile.BACKUP_TARGET, envFile);
    const opsUrl = withCreds(adminUrl, 'app_ops', OPS_PW);

    // ---- 1. preparo + seed
    await step('Preparar banco de origem (migrações) e popular dados de demonstração', async () => {
      const a = connect(adminUrl, { max: 1 }); try { await a.unsafe('drop schema if exists app cascade'); await a.unsafe('drop table if exists public.schema_migrations'); } finally { await a.end(); }
      await migrate(adminUrl, { apiPassword: API_PW, log: () => {} });
      ev.dataset = await seedDemo({ opsUrl, store: new FileStore(objDir, { secure: false }), users, presentations, assets, log });
    });
    const base = await step('Verificação de implantação ANTES do backup (verify-deploy)', async () => { const a = connect(adminUrl, { max: 1 }); try { return await runChecks({ sql: a, env: baseEnv, offline: true }); } finally { await a.end(); } });
    ev.verification.beforeBackup = base.map((r) => ({ id: r.id, status: r.status }));
    if (base.some((r) => r.status === 'fail')) throw new ToolError('o ambiente de origem já está com falhas no verify-deploy; ensaio interrompido', { code: 'baseline_failed' });

    // ---- 2. backup
    const backupStartedAt = new Date();
    const dbRes = await step('Backup do banco (pg_dump → AES-256-GCM → destino) + verificação', () => backupDb({ env: envFile, target, keyring, log }));
    const objRes = await step('Espelho dos arquivos (incremental, cifrado)', () => backupObjects({ env: envFile, target, keyring, log, concurrency: 6 }));
    const objRes2 = await step('Segundo espelho (nada novo: deve copiar 0)', () => backupObjects({ env: envFile, target, keyring, log }));
    ev.backups.file = { name: dbRes.name, dumpEncryptedBytes: dbRes.bytes, dumpPlainBytes: dbRes.plainBytes, dbBackupMs: dbRes.durationMs, rows: dbRes.rows, tables: dbRes.tables, consistentSnapshot: dbRes.consistent, verified: dbRes.verified,
      objects: { copied: objRes.copied, copiedBytes: objRes.copiedBytes, ms: objRes.durationMs, secondRunCopied: objRes2.copied, secondRunSkipped: objRes2.alreadyInDestination, sourceObjects: objRes.sourceObjects } };
    let s3Target = null, s3Env = null;
    if (useS3) {
      moto = await startMoto(Number(process.env.DRILL_MOTO_PORT) || 0);
      if (!moto) { ev.limits.push('moto_server não instalado: o backup em S3 NÃO foi exercitado neste ensaio (pip install "moto[server]")'); log('aviso: moto_server ausente, pulando S3'); }
      else {
        await makeBucket(moto.endpoint, 'canteiro-backup-drill');
        s3Env = { ...baseEnv, BACKUP_TARGET: 's3://canteiro-backup-drill/drill', BACKUP_S3_ENDPOINT: moto.endpoint, BACKUP_S3_ACCESS_KEY_ID: 'drill-backup', BACKUP_S3_SECRET_ACCESS_KEY: 'drill-backup-secret', BACKUP_S3_FORCE_PATH_STYLE: 'true' }; delete s3Env.PG_BIN_DIR;
        s3Target = openTarget(s3Env.BACKUP_TARGET, s3Env);
        const s3Db = await step('Backup do banco para S3 (moto) + verificação', () => backupDb({ env: s3Env, target: s3Target, keyring, log }));
        const s3Obj = await step('Espelho dos arquivos para S3 (moto)', () => backupObjects({ env: s3Env, target: s3Target, keyring, log, concurrency: 6 }));
        ev.backups.s3 = { name: s3Db.name, dumpEncryptedBytes: s3Db.bytes, dbBackupMs: s3Db.durationMs, verified: s3Db.verified, objects: { copied: s3Obj.copied, copiedBytes: s3Obj.copiedBytes, ms: s3Obj.durationMs } };
      }
    }
    const { complete } = await listBackups(target); const last = complete.at(-1); const backupFinishedAt = new Date();

    // ---- 3. dados escritos DEPOIS do backup (perda esperada = RPO)
    const post = await step('Gravar dados depois do backup (serão perdidos de propósito)', async () => {
      const o = connect(opsUrl, { max: 1 }); try { return await o.begin(async (tx) => { await tx`set local role app_system`; const r = await tx`insert into app.audit_log(action, entity_type, meta) select 'presentation.update', 'presentation', jsonb_build_object('i', g) from generate_series(1, 25) g returning 1`; return r.length; }); } finally { await o.end(); }
    });
    const expected = await (async () => { const a = connect(adminUrl, { max: 1 }); try { const [r] = await a`select (select count(*)::int from app.users) as users, (select count(*)::int from app.presentations) as pres, (select count(*)::int from app.audit_log) as audit, (select count(*)::int from app.assets) as assets`; return r; } finally { await a.end(); } })();

    // ---- 4. desastre
    const disasterAt = new Date();
    await step('DESASTRE: apagar o schema app e a pasta de arquivos', async () => {
      const a = connect(adminUrl, { max: 1 }); try { await a.unsafe('drop schema app cascade'); await a.unsafe('drop table public.schema_migrations'); const [r] = await a`select count(*)::int as n from pg_namespace where nspname = 'app'`; if (r.n !== 0) throw new Error('o desastre simulado não apagou o schema'); } finally { await a.end(); }
      fs.rmSync(objDir, { recursive: true, force: true }); if (fs.existsSync(objDir)) throw new Error('pasta de arquivos ainda existe');
    });
    ev.disaster = { at: disasterAt.toISOString(), lastBackup: last.name, lastBackupStartedAt: backupStartedAt.toISOString(), lastBackupFinishedAt: backupFinishedAt.toISOString(), rpoObservedSeconds: Math.round((disasterAt - backupStartedAt) / 100) / 10, writesAfterBackupLost: post, destroyed: ['schema app', 'public.schema_migrations', 'pasta de arquivos'] };

    // ---- 5. restauração + verificação
    const recStart = now();
    for (const name of [`${srcDb}_restore`, `${srcDb}_restore_s3`]) await maint.unsafe(`drop database if exists ${name} with (force)`);
    await maint.unsafe(`create database ${srcDb}_restore`); created.push(`${srcDb}_restore`);
    const objRest = await step('Restaurar arquivos do espelho cifrado para pasta nova', () => restoreObjects({ backup: target, dest: new FileStore(newObjDir, { secure: false }), keys: keyring.all, concurrency: 6, log }));
    const rep = await step('Restaurar o banco em banco novo (+ migrate --check, contagens, amostras, re-hash de todos os arquivos)', () => restoreDb({ env: envFile, target, keys: keyring.all, name: last.name, toUrl: restoreUrl, verifyObjectsFrom: new FileStore(newObjDir, { secure: false }), objectConcurrency: 8, log }));
    const deploy = await step('verify-deploy no banco restaurado (RLS, papéis, permissões, gatilhos, migrações)', async () => { const a = connect(restoreUrl, { max: 1 }); try { fs.chmodSync(newObjDir, 0o750); return await runChecks({ sql: a, env: { STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: newObjDir }, offline: true }); } finally { await a.end(); } });
    const iso = await step('Isolamento depois da restauração (RLS em ação)', async () => {
      const a = connect(restoreUrl, { max: 1 }); const api = createDb({ url: withCreds(restoreUrl, 'app_api', API_PW), max: 2 });
      try {
        const [m] = await a`select id from app.users where role = 'member' and status = 'active' order by email limit 1`; const [ad] = await a`select id from app.users where role = 'admin' limit 1`; const [sus] = await a`select id from app.users where status = 'suspended' limit 1`;
        const [exp] = await a`select count(*)::int as n from app.presentations where deleted_at is null or owner_id = ${m.id}`;
        const seen = await api.asUser(m.id, (tx) => tx`select count(*)::int as n from app.presentations`); const seenSusp = await api.asUser(sus.id, (tx) => tx`select count(*)::int as n from app.presentations`);
        const seenRnd = await api.asUser(crypto.randomUUID(), (tx) => tx`select count(*)::int as n from app.presentations`);
        const [{ other }] = await api.asUser(m.id, (tx) => tx`select count(*)::int as other from app.presentations where owner_id <> ${m.id} and deleted_at is not null`);
        const upd = await api.asUser(m.id, async (tx) => (await tx`update app.presentations set title = title where owner_id <> ${m.id} returning id`).length);
        let direct; try { await api.sql`select 1 from app.users limit 1`; direct = 'acesso permitido (ERRO)'; } catch (e) { direct = e.code; }
        const r = { memberSeesAcervo: seen[0].n === exp.n, expected: exp.n, seen: seen[0].n, suspendedSees: seenSusp[0].n, unknownUserSees: seenRnd[0].n, othersTrashHidden: other === 0, memberCannotEditOthers: upd === 0, appApiDirectTableAccess: direct, adminId: !!ad };
        if (!r.memberSeesAcervo || r.suspendedSees !== 0 || r.unknownUserSees !== 0 || !r.othersTrashHidden || !r.memberCannotEditOthers || direct !== '42501') throw new ToolError('isolamento falhou depois da restauração: ' + JSON.stringify(r), { code: 'isolation' });
        return r;
      } finally { await a.end(); await api.end(); }
    });
    const rtoMs = Math.round(now() - recStart);
    const a2 = connect(restoreUrl, { max: 1 }); let after; try { [after] = await a2`select (select count(*)::int from app.users) as users, (select count(*)::int from app.presentations) as pres, (select count(*)::int from app.audit_log) as audit, (select count(*)::int from app.assets) as assets`; } finally { await a2.end(); }
    const items = await (async () => { const a = connect(restoreUrl, { max: 1 }); try { return await listReferencedObjects(a); } finally { await a.end(); } })();
    ev.restore = { from: 'file', backup: last.name, rtoMs, rtoHuman: fmtMs(rtoMs), phases: rep.phases, dbRestoreMs: rep.phases.pg_restore, objectsRestoredMs: objRest.durationMs, objectsRestored: objRest.restored, objectsRestoredBytes: objRest.restoredBytes, objectFailures: objRest.failed.length,
      throughput: { dumpMBps: +(((ev.backups.file.dumpPlainBytes || 0) / 1048576) / (rep.phases.pg_restore / 1000)).toFixed(1), objectsMBps: +((objRest.restoredBytes / 1048576) / (objRest.durationMs / 1000 || 1)).toFixed(1) } };
    ev.verification = { ...ev.verification, tables: rep.counts, rowsRestored: rep.rows, diffsAgainstManifest: rep.diffs, migrateCheck: rep.migrateCheck, objects: { referenced: items.length, ok: rep.objects.ok, missing: rep.objects.missing.length, corrupt: rep.objects.corrupt.length, sizeMismatch: rep.objects.sizeMismatch.length, bytesRehashed: rep.objects.bytesChecked, ms: rep.objects.durationMs },
      verifyDeploy: deploy.map((r) => ({ id: r.id, title: r.title, status: r.status, detail: r.detail })), isolation: iso,
      expectedBeforeDisaster: expected, afterRestore: after, lostByDesign: { auditRows: expected.audit - after.audit }, sampleHashesEqual: rep.diffs.length === 0 };
    if (after.users !== expected.users || after.pres !== expected.pres || after.assets !== expected.assets || expected.audit - after.audit !== post) throw new ToolError('as contagens restauradas não batem com o esperado antes do desastre', { code: 'counts', details: { expected, after } });
    if (deploy.some((r) => r.status === 'fail')) throw new ToolError('verify-deploy reprovou o banco restaurado: ' + deploy.filter((r) => r.status === 'fail').map((r) => r.id).join(', '), { code: 'verify_deploy' });

    // ---- 5b. restauração a partir do S3 (moto)
    if (s3Target) {
      await maint.unsafe(`create database ${srcDb}_restore_s3`); created.push(`${srcDb}_restore_s3`);
      const s3 = await step('Restaurar a partir do bucket S3 (moto): arquivos + banco + verificação', async () => {
        const ro = await restoreObjects({ backup: s3Target, dest: new FileStore(s3ObjDir, { secure: false }), keys: keyring.all, concurrency: 6, log });
        const r = await restoreDb({ env: s3Env, target: s3Target, keys: keyring.all, name: ev.backups.s3.name, toUrl: restoreS3Url, verifyObjectsFrom: new FileStore(s3ObjDir, { secure: false }), log }); return { ro, r };
      });
      ev.restore.s3 = { ok: s3.r.ok && s3.ro.ok, objectsRestored: s3.ro.restored, objectsOk: s3.r.objects.ok, objectsTotal: s3.r.objects.total, diffs: s3.r.diffs.length, totalMs: s3.r.totalMs, objectsRestoreMs: s3.ro.durationMs };
      if (!ev.restore.s3.ok) throw new ToolError('a restauração a partir do S3 falhou', { code: 's3_restore' });
    }
    ev.ok = true; ev.finishedAt = new Date().toISOString(); ev.totalMs = Math.round(now() - t0); ev.steps = steps;
  } catch (e) { ev.ok = false; ev.error = String(e.message).slice(0, 500); ev.steps = steps; ev.finishedAt = new Date().toISOString(); ev.totalMs = Math.round(now() - t0); throw Object.assign(e, { evidence: ev }); }
  finally {
    try { if (moto) await moto.stop(); } catch { /* já parado */ }
    if (!keep) { for (const n of created) await maint.unsafe(`drop database if exists ${n} with (force)`).catch(() => {}); fs.rmSync(work, { recursive: true, force: true }); } else log(`arquivos mantidos em ${work}`);
    await maint.end({ timeout: 5 }).catch(() => {});
    if (ev.steps) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'restore-drill.json'), JSON.stringify(ev, null, 2) + '\n'); fs.writeFileSync(path.join(outDir, 'restore-drill.md'), renderEvidence(ev)); }
  }
  return ev;
}

const row = (...c) => '| ' + c.join(' | ') + ' |';
export function renderEvidence(ev) {
  const L = []; const ok = (b) => (b ? 'OK' : '**FALHOU**'); const f = ev.backups?.file, d = ev.dataset, v = ev.verification || {}, r = ev.restore || {};
  L.push('# Evidência do ensaio de restauração (restore drill)', '');
  L.push(`> Gerado automaticamente por \`platform/tools/restore-drill.js\` em ${ev.startedAt} (duração total ${fmtMs(ev.totalMs)}). **Resultado: ${ev.ok ? 'APROVADO' : 'REPROVADO — ' + ev.error}**`, '');
  L.push('Para repetir: `cd platform && TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_c node tools/restore-drill.js --s3` (precisa de Postgres 15+ local e, para a parte S3, `pip install "moto[server]"`).', '');
  L.push('## Ambiente do ensaio', '', row('Item', 'Valor'), row('---', '---'), row('Node', ev.tools?.node), row('pg_dump', ev.tools?.pg_dump), row('Máquina', `${ev.tools?.platform}, ${ev.tools?.cpus} CPUs`), row('Armazenamento de arquivos', 'pasta local (disco)'), row('Destino do backup', 'pasta separada e, na segunda rodada, bucket S3 falso (moto) em outro "bucket"'), '');
  if (d?.users) {
    L.push('## Dados de demonstração (seed)', '', row('Item', 'Quantidade'), row('---', '---'), row('Usuários', d.users), row('Apresentações', d.presentations), row('Versões no histórico', d.versions), row('Arquivos únicos no armazenamento (imagens/PDF/CSV + miniaturas)', `${d.assetsUnique} (${d.files} arquivos + ${d.thumbs} miniaturas), ${d.bytesHuman}`),
      row('Reenvios deduplicados (mesmo SHA-256 = um só objeto)', d.dedupHits), row('Referências de arquivo (apresentações e versões)', d.refs), row('Comentários / interações / eventos de auditoria', `${d.comments} / ${d.interactions} / ${d.audit}`), '');
  }
  L.push('## Linha do tempo medida', '', row('Etapa', 'Tempo', 'Resultado'), row('---', '---:', '---'));
  for (const s of ev.steps || []) L.push(row(s.name, fmtMs(s.ms), s.ok ? 'OK' : `FALHOU: ${s.error}`));
  L.push('');
  if (f) {
    L.push('## Backup', '', row('Item', 'Valor'), row('---', '---'), row('Nome', `\`${f.name}\``), row('Banco: dump em claro → cifrado', `${fmtBytes(f.dumpPlainBytes)} → ${fmtBytes(f.dumpEncryptedBytes)}`), row('Tabelas / linhas no manifesto', `${f.tables} / ${f.rows}`), row('Snapshot consistente (contagens = dump)', f.consistentSnapshot ? 'sim' : 'NÃO'), row('Backup relido e verificado (SHA-256, autenticação de todos os blocos, índice do pg_restore)', f.verified ? 'sim' : 'NÃO'),
      row('Arquivos copiados no 1º espelho', `${f.objects.copied} de ${f.objects.sourceObjects} (${fmtBytes(f.objects.copiedBytes)}) em ${fmtMs(f.objects.ms)}`), row('2º espelho (incremental)', `${f.objects.secondRunCopied} copiados, ${f.objects.secondRunSkipped} já no destino`), '');
    if (ev.backups.s3) L.push(`Backup em S3 (moto): banco ${fmtBytes(ev.backups.s3.dumpEncryptedBytes)} em ${fmtMs(ev.backups.s3.dbBackupMs)}, ${ev.backups.s3.objects.copied} arquivos (${fmtBytes(ev.backups.s3.objects.copiedBytes)}) em ${fmtMs(ev.backups.s3.objects.ms)}; verificado: ${ev.backups.s3.verified ? 'sim' : 'NÃO'}.`, '');
  }
  if (ev.disaster?.at) L.push('## O desastre simulado', '', `Em ${ev.disaster.at} foram destruídos: ${ev.disaster.destroyed.join(', ')}. Último backup: \`${ev.disaster.lastBackup}\`.`, '', row('Medida', 'Valor', 'Como ler'), row('---', '---', '---'),
    row('RPO observado (perda de tempo)', `${ev.disaster.rpoObservedSeconds} s entre o instante do backup (snapshot) e o desastre`, 'No ensaio o desastre foi imediato. **Em produção o RPO é o intervalo entre backups: no máximo 24 h** (backup diário às 05:15 UTC) mais a duração do backup.'),
    row('Dados gravados depois do backup', `${ev.disaster.writesAfterBackupLost} registros de auditoria`, 'Perdidos de propósito — confirmados como ausentes após a restauração (é isso que o RPO significa).'), '');
  if (r.rtoMs) {
    L.push('## Restauração (RTO medido)', '', row('Medida', 'Valor'), row('---', '---'), row('**RTO observado** (início da restauração → tudo verificado)', `**${r.rtoHuman}** (${r.rtoMs} ms)`), row('pg_restore (banco)', fmtMs(r.dbRestoreMs)), row('Arquivos restaurados do espelho cifrado', `${r.objectsRestored} (${fmtBytes(r.objectsRestoredBytes)}) em ${fmtMs(r.objectsRestoredMs)}`),
      row('Verificação dos objetos (re-hash)', `${v.objects?.ok}/${v.objects?.referenced} íntegros, ${fmtMs(v.objects?.ms)}`), row('Vazão dos arquivos medida (disco local; amostra pequena, só indicativa — em produção manda a rede)', `${r.throughput.objectsMBps} MB/s`), '');
    if (r.s3) L.push(`Restauração a partir do bucket S3 (moto): ${ok(r.s3.ok)} — ${r.s3.objectsOk}/${r.s3.objectsTotal} arquivos íntegros, banco em ${fmtMs(r.s3.totalMs)}, arquivos em ${fmtMs(r.s3.objectsRestoreMs)}.`, '');
  }
  if (v.tables) {
    L.push('## Verificações depois da restauração', '', '### 1. Contagens por tabela (antes do desastre, pelo manifesto → depois da restauração) e amostra de linhas', '', row('Tabela', 'Linhas restauradas'), row('---', '---:'));
    for (const [t, n] of Object.entries(v.tables)) L.push(row(`\`${t}\``, n + (t === 'app.rate_limits' ? ' (dados excluídos do backup de propósito)' : '')));
    L.push('', `Diferenças contra o manifesto (contagem e hash de uma amostra de linhas por chave primária, em todas as tabelas): **${v.diffsAgainstManifest.length}** ${ok(!v.diffsAgainstManifest.length)}.`, '');
    L.push('### 2. Totais esperados × restaurados', '', row('Item', 'Antes do desastre', 'Depois da restauração'), row('---', '---:', '---:'), row('Usuários', v.expectedBeforeDisaster.users, v.afterRestore.users), row('Apresentações', v.expectedBeforeDisaster.pres, v.afterRestore.pres), row('Arquivos (linhas em app.assets)', v.expectedBeforeDisaster.assets, v.afterRestore.assets), row('Auditoria', v.expectedBeforeDisaster.audit, `${v.afterRestore.audit} (−${v.lostByDesign.auditRows}, perdidos de propósito)`), '');
    L.push('### 3. Arquivos (re-hash SHA-256 de todos os objetos referenciados no banco restaurado)', '', row('Referenciados', 'Íntegros', 'Ausentes', 'Corrompidos', 'Tamanho errado', 'Bytes relidos'), row('---:', '---:', '---:', '---:', '---:', '---:'), row(v.objects.referenced, v.objects.ok, v.objects.missing, v.objects.corrupt, v.objects.sizeMismatch, fmtBytes(v.objects.bytesRehashed)), '');
    L.push('### 4. verify-deploy no banco restaurado (RLS, papéis e permissões intactos)', '', row('Verificação', 'Resultado'), row('---', '---'));
    for (const c of v.verifyDeploy) L.push(row(c.title, `${c.status === 'ok' ? 'OK' : c.status === 'skip' ? 'não se aplica' : c.status.toUpperCase()}${c.detail ? ' — ' + c.detail : ''}`));
    L.push('', `migrate --check no banco restaurado: ${ok(v.migrateCheck)}.`, '');
    const i = v.isolation; L.push('### 5. Isolamento em ação (consultas reais como app_api → app_user, com RLS)', '', row('Teste', 'Resultado'), row('---', '---'), row('Membro ativo enxerga o acervo comum', `${ok(i.memberSeesAcervo)} (${i.seen} de ${i.expected} esperadas)`), row('Usuário suspenso enxerga', `${i.suspendedSees} apresentações`), row('Identidade desconhecida enxerga', `${i.unknownUserSees} apresentações`), row('Membro vê lixeira de outros', i.othersTrashHidden ? 'não' : '**SIM**'), row('Membro consegue editar apresentação de outro', i.memberCannotEditOthers ? 'não (0 linhas)' : '**SIM**'), row('app_api lendo tabela direto (sem assumir app_user)', `negado (código ${i.appApiDirectTableAccess})`), '');
  }
  L.push('## O que este ensaio NÃO mediu (e como tratar)', '');
  for (const t of [...(ev.limits || []), 'Rede real: as pastas e o bucket falso ficam na mesma máquina. Em produção o tempo de restauração dos arquivos é dominado pela vazão da internet entre o bucket de backup e o armazenamento principal (veja a estimativa em docs/BACKUP-E-RESTAURACAO.md).', 'Volume: o ensaio usa dezenas de MB. O procedimento é em fluxo (memória constante), mas 500 GB–1 TB devem ser ensaiados no ambiente de staging com o bucket real (marcado como pendência em docs/BACKUP-E-RESTAURACAO.md).', 'Papéis do banco (app_owner, app_user, app_system, app_api, app_ops) pertencem ao cluster e já existiam neste Postgres; a criação do zero é feita por `restore.js` com o mesmo bootstrap do `migrate.js` e deve ser conferida no primeiro ensaio em um projeto Supabase novo.', 'Supabase/Vercel/GitHub Actions reais: não acessíveis neste ambiente. Ensaiar em staging antes de depender de produção.']) L.push(`- ${t}`);
  L.push('');
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['s3', 'keep', 'json'] }); const redact = buildRedactor(env); const log = (m) => process.stderr.write(redact(m) + '\n');
  const adminUrl = args['admin-url'] || env.DRILL_ADMIN_URL || env.TEST_DATABASE_ADMIN_URL; if (!adminUrl) throw new ToolError('defina TEST_DATABASE_ADMIN_URL (ex.: postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_c)', { exit: 2, code: 'no_db' });
  try {
    const ev = await runDrill({ adminUrl, outDir: args.out ? path.resolve(args.out) : undefined, users: Number(args.users) || 30, presentations: Number(args.presentations) || 200, assets: Number(args.assets) || 300, useS3: !!args.s3, keep: !!args.keep, log });
    log(`\nENSAIO APROVADO. RTO observado: ${ev.restore.rtoHuman}. Evidência: docs/evidencias/restore-drill.md`); if (args.json) process.stdout.write(JSON.stringify({ ok: true, rtoMs: ev.restore.rtoMs }) + '\n'); return 0;
  } catch (e) { if (e.evidence) log('\nENSAIO REPROVADO: ' + redact(e.message) + '\nA evidência parcial foi escrita em docs/evidencias/.'); throw e; }
}
if (isMain(import.meta.url)) runCli(() => main());
