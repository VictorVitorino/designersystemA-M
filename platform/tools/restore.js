#!/usr/bin/env node
/* tools/restore.js — restaura um backup do Canteiro (banco e arquivos) a partir do destino de backup.

   Uso:
     node tools/restore.js list
     node tools/restore.js db --to postgres://…/banco_novo [--name NOME | --latest] [--verify-objects] [--objects-dir DIR]
     node tools/restore.js auth --to postgres://…/projeto_novo                    # (opcional) contas do Supabase Auth, se o backup foi feito com BACKUP_INCLUDE_AUTH=1
     node tools/restore.js objects --to-dir DIR [--only-referenced --db URL]      # arquivos do espelho → pasta
     node tools/restore.js objects --to-primary --yes                              # arquivos → armazenamento principal (variáveis S3_* ou STORAGE_*)
   Variáveis: BACKUP_TARGET, BACKUP_ENCRYPTION_KEY (e, se rotacionada, BACKUP_ENCRYPTION_KEYS_OLD), BACKUP_S3_*; APP_API_DB_PASSWORD (opcional: define a senha do papel app_api).

   Segurança (por que é chato de propósito):
   • O banco de destino precisa estar VAZIO. Se não estiver, a restauração recusa e lista o que achou. Para substituir o conteúdo existente de um banco
     de ENSAIO use --drop-existing=<nome-exato-do-banco> (digitar o nome evita erro de banco).
   • Nunca restaura sobre o banco que está em DATABASE_ADMIN_URL (o de produção) sem --i-am-restoring-production.
   • Antes de tocar no banco: baixa, confere o SHA-256, decifra autenticando todos os blocos e confere o SHA-256 do dump em claro.
   • Depois: roda migrate --check, compara contagens e amostras de linhas com o manifesto e (opcional) re-hash de todos os arquivos referenciados.
   O pg_restore mantém donos e privilégios (app_owner, GRANT, RLS): os papéis são criados antes com o mesmo bootstrap do migrate.
   Ensaio num Postgres "puro" (sem os papéis do Supabase — anon, authenticated, service_role…, citados nos GRANT/DEFAULT PRIVILEGES do schema public):
     restoreDb({ createMissingRoles: true }) cria antes, SEM login, só os papéis que o dump cita e que não existem. Só é aceito em banco LOCAL/descartável. */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ToolError, buildRedactor, makeLogger, parseArgs, fmtBytes, fmtMs, runCli, isMain } from './lib/common.js';
import { keyringFromEnv, createDecryptStream } from './lib/backup-crypto.js';
import { openTarget, openPrimaryStore, FileStore } from './lib/targets.js';
import { findPgBin, pgEnvFromUrl, connect, listBackupTables, tableFingerprints, databaseIsEmpty, run, dbNameOf, isLocalHost } from './lib/pg.js';
import { verifyingHash, restoreObjects, verifyObjects } from './lib/mirror.js';
import { listBackups, loadManifest, resolveBackupName } from './lib/backup-catalog.js';
import { migrate, bootstrapRoles, lockSchemaMigrations } from './migrate.js';

const noop = () => {};
const sameDb = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.hostname === y.hostname && (x.port || '5432') === (y.port || '5432') && x.pathname === y.pathname; } catch { return false; } };

/** Itens (sha256, tamanho) referenciados no banco: arquivos prontos, referências de apresentações/versões e miniaturas. */
export async function listReferencedObjects(sql) {
  const rows = await sql`
    select a.sha256, a.size_bytes::bigint as size from app.assets a
     where a.status = 'ready' or exists (select 1 from app.asset_refs r where r.sha256 = a.sha256)
        or exists (select 1 from app.presentations p where p.thumb_sha = a.sha256)
    union
    select p.thumb_sha, null from app.presentations p where p.thumb_sha is not null and not exists (select 1 from app.assets a where a.sha256 = p.thumb_sha)`;
  return rows.map((r) => ({ sha256: r.sha256, size: r.size == null ? null : Number(r.size) }));
}

/** Retira do índice do pg_restore o que não deve ser recriado: o schema `public` (já existe em qualquer banco) e seus comentários/ACL. */
export function filterToc(tocText) {
  const kept = [], dropped = [];
  for (const line of tocText.split('\n')) {
    if (/^;/.test(line) || !line.trim()) { kept.push(line); continue; }
    if (/^\d+; \d+ \d+ SCHEMA - public /.test(line) || /^\d+; \d+ \d+ COMMENT - SCHEMA public /.test(line) || /^\d+; \d+ \d+ ACL - SCHEMA public /.test(line)) dropped.push(line); else kept.push(line);
  }
  return { text: kept.join('\n'), dropped };
}

/** Papéis citados no dump: donos (última coluna do índice) e os nomes em GRANT/REVOKE/ALTER DEFAULT PRIVILEGES (só as entradas de ACL são convertidas em SQL). */
export async function referencedRoles(file, env = process.env) {
  const bin = findPgBin('pg_restore', env); const toc = await run(bin, ['--list', file], { env: process.env });
  if (toc.code !== 0) throw new ToolError('pg_restore não consegue ler o dump: ' + toc.stderr.slice(0, 300), { code: 'bad_dump' });
  const roles = new Set(); const acl = [];
  for (const line of toc.stdout.split('\n')) {
    const m = /^\d+; \d+ \d+ (.+)$/.exec(line); if (!m) continue;
    const owner = m[1].trim().split(' ').at(-1); if (owner && owner !== '-') roles.add(owner);
    if (/^(ACL|DEFAULT ACL) /.test(m[1])) acl.push(line);
  }
  if (acl.length) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-acl-')); const lista = path.join(tmp, 'acl.list');
    try {
      fs.writeFileSync(lista, acl.join('\n') + '\n', { mode: 0o600 });
      const r = await run(bin, ['-L', lista, '-f', '-', file], { env: process.env }); if (r.code !== 0) throw new ToolError('pg_restore não gerou o SQL das permissões: ' + r.stderr.slice(0, 200), { code: 'bad_dump' });
      const ident = (x) => x.trim().replace(/^"(.*)"$/s, (_, a) => a.replace(/""/g, '"'));
      for (const st of r.stdout.split(/;\s*\n/)) {
        const t = st.replace(/--[^\n]*\n/g, ' ').replace(/\s+/g, ' ').trim(); if (!/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b/i.test(t)) continue;
        const fr = /\bFOR ROLE ("(?:[^"]|"")+"|[^\s,]+(?:\s*,\s*(?:"(?:[^"]|"")+"|[^\s,]+))*)/i.exec(t); if (fr) for (const x of fr[1].split(',')) roles.add(ident(x));
        const gb = /\bGRANTED BY ("(?:[^"]|"")+"|[^\s;]+)/i.exec(t); if (gb) roles.add(ident(gb[1]));
        const alvo = /\b(?:TO|FROM) (.+?)(?: WITH GRANT OPTION| GRANTED BY .*| CASCADE| RESTRICT)?$/i.exec(t.replace(/^ALTER DEFAULT PRIVILEGES .*? (GRANT|REVOKE) /i, '$1 '));
        if (alvo) for (const x of alvo[1].split(',')) roles.add(ident(x));
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  for (const x of [...roles]) if (!x || /^public$/i.test(x)) roles.delete(x);
  return [...roles].sort();
}
/** Cria (NOLOGIN, sem poderes) os papéis citados que não existem. Só para bancos de ENSAIO locais/descartáveis. */
export async function createMissingRoles(sql, roles) {
  const existentes = new Set((await sql`select rolname from pg_roles`).map((r) => r.rolname)); const criados = [];
  for (const r of roles) if (!existentes.has(r)) { await sql.unsafe(`create role "${r.replace(/"/g, '""')}" nologin noinherit`); criados.push(r); }
  return criados;
}

export async function restoreDb({ env = process.env, target, keys, name, toUrl, dropExisting = null, allowProduction = false, rolesBootstrap = true, createMissingRoles: criarPapeis = false, log = noop, verifyObjectsFrom = null, objectConcurrency = 6 } = {}) {
  const t0 = Date.now(); const phases = {}; const mark = (k, since) => { phases[k] = Date.now() - since; };
  if (!toUrl) throw new ToolError('informe o banco de destino com --to postgres://…/banco_novo (um banco VAZIO, nunca o de produção)', { code: 'no_to', exit: 2 });
  if (criarPapeis && !isLocalHost(new URL(toUrl).hostname)) throw new ToolError('criar papéis ausentes só é permitido em banco LOCAL de ensaio (nunca em servidor real)', { code: 'refuse_roles', exit: 2 });
  if (env.DATABASE_ADMIN_URL && sameDb(env.DATABASE_ADMIN_URL, toUrl) && !allowProduction) throw new ToolError('o destino é o mesmo banco de DATABASE_ADMIN_URL (o banco em uso). Restaure em um banco NOVO; se for mesmo a intenção, use --i-am-restoring-production', { code: 'refuse_live', exit: 2 });
  const manifest = await loadManifest(target, name, { keys });
  log(`backup ${manifest.name}: criado em ${manifest.createdAt}, ${fmtBytes(manifest.dump.encryptedBytes)} cifrados, esquema até a migração ${manifest.schema.latestMigration}`);

  // 1. baixar + decifrar + conferir (ainda sem tocar no banco)
  let s = Date.now(); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-restore-')); const file = path.join(tmp, 'dump');
  try {
    const cipher = verifyingHash(null), plain = verifyingHash(null);
    await pipeline(await target.get(manifest.dump.key), cipher, createDecryptStream(keys), plain, fs.createWriteStream(file, { mode: 0o600 }));
    if (cipher.sha256 !== manifest.dump.encryptedSha256 || plain.sha256 !== manifest.dump.plainSha256) throw new ToolError('o backup não confere com o manifesto (SHA-256 diferente): restauração abortada, nada foi alterado', { code: 'sha_mismatch' });
    mark('download_decifragem', s); log(`dump baixado e autenticado (${fmtBytes(plain.bytes)}) em ${fmtMs(phases.download_decifragem)}`);

    // 2. banco de destino vazio?
    s = Date.now(); const dbName = dbNameOf(toUrl); const sql = connect(toUrl, { max: 1 });
    try {
      const st = await databaseIsEmpty(sql);
      if (!st.empty) {
        if (dropExisting !== dbName) throw new ToolError(`o banco "${dbName}" NÃO está vazio (${st.hasApp ? 'já tem o schema app' : ''} ${st.found.slice(0, 5).join(', ')}). Restaure em um banco novo; para um banco de ENSAIO use --drop-existing=${dbName}`, { code: 'not_empty', exit: 2 });
        log(`--drop-existing: apagando schema app e public.schema_migrations de "${dbName}"`);
        await sql.unsafe('drop schema if exists app cascade'); await sql.unsafe('drop table if exists public.schema_migrations');
      }
      // 3. papéis (idempotente) — donos e GRANTs do dump dependem deles
      if (rolesBootstrap) await bootstrapRoles(sql, { apiPassword: env.APP_API_DB_PASSWORD, opsPassword: env.APP_OPS_DB_PASSWORD });
      let papeisCriados = [];
      if (criarPapeis) { papeisCriados = await createMissingRoles(sql, await referencedRoles(file, env)); if (papeisCriados.length) log(`ensaio: criei ${papeisCriados.length} papel(éis) que o dump cita e este Postgres não tinha (sem login): ${papeisCriados.join(', ')}`); }
      mark('preparo', s);

      // 4. pg_restore com índice filtrado
      s = Date.now(); const restoreBin = findPgBin('pg_restore', env); const pgEnv = pgEnvFromUrl(toUrl, env);
      const toc = await run(restoreBin, ['--list', file], { env: pgEnv }); if (toc.code !== 0) throw new ToolError('pg_restore não consegue ler o dump: ' + toc.stderr.slice(0, 300), { code: 'bad_dump' });
      const { text, dropped } = filterToc(toc.stdout); const listFile = path.join(tmp, 'toc.list'); fs.writeFileSync(listFile, text, { mode: 0o600 });
      const r = await run(restoreBin, ['--exit-on-error', '--single-transaction', '--no-password', '-L', listFile, '-d', pgEnv.PGDATABASE, file], { env: pgEnv });
      if (r.code !== 0) throw new ToolError(`pg_restore falhou (código ${r.code}); nada foi aplicado (transação única): ${r.stderr.trim().split('\n').slice(-5).join(' | ')}`, { code: 'pg_restore_failed' });
      await sql.unsafe('analyze');
      await lockSchemaMigrations(sql);   // um projeto Supabase novo aplicaria de novo os privilégios padrão do schema public na tabela recriada
      mark('pg_restore', s); log(`pg_restore concluído em ${fmtMs(phases.pg_restore)} (${dropped.length} itens do schema public padrão ignorados)`);

      // 5. migrate --check
      s = Date.now(); const mig = await migrate(toUrl, { check: true, roles: false, log: (m) => log('  ' + m) }); mark('migrate_check', s);
      if (!mig.ok) throw new ToolError(`depois da restauração, migrate --check reprovou (pendentes: ${mig.pending.join(', ') || '-'}; checksums divergentes: ${mig.drift}). O backup é de um esquema diferente do código atual`, { code: 'migrate_check', details: mig });

      // 6. contagens e amostras vs manifesto
      s = Date.now(); const tables = await listBackupTables(sql); const fp = await sql.begin('read only', (tx) => tableFingerprints(tx, tables)); mark('comparacao', s);
      const diffs = [], warnings = [];
      for (const [fq, want] of Object.entries(manifest.tables)) {
        const got = fp[fq]; if (!got) { diffs.push(`${fq}: tabela ausente após a restauração`); continue; }
        if (want.dataExcluded) { if (got.count !== 0) warnings.push(`${fq}: dados deveriam ter sido excluídos do backup`); continue; }
        if (got.count !== want.count) diffs.push(`${fq}: ${got.count} linhas, o manifesto diz ${want.count}`);
        else if (got.sampleHash !== want.sampleHash) diffs.push(`${fq}: amostra de linhas diferente (hash ${got.sampleHash} ≠ ${want.sampleHash})`);
      }
      for (const fq of Object.keys(fp)) if (!manifest.tables[fq]) warnings.push(`${fq}: tabela não existia no manifesto`);
      const consistent = manifest.pg?.consistentSnapshot !== false;
      const rep = { name: manifest.name, ok: !diffs.length || !consistent, tables: Object.keys(fp).length, rows: Object.values(fp).reduce((a, t) => a + t.count, 0), counts: Object.fromEntries(Object.entries(fp).map(([k, v]) => [k, v.count])), expected: Object.fromEntries(Object.entries(manifest.tables).map(([k, v]) => [k, v.count])), diffs, warnings, phases, migrateCheck: mig.ok, consistentSnapshot: consistent, rolesCreated: papeisCriados, plainBytes: plain.bytes, encryptedBytes: cipher.bytes };
      if (diffs.length) (consistent ? log : (m) => log('aviso: ' + m))(`DIFERENÇAS contra o manifesto:\n  - ${diffs.join('\n  - ')}`);
      else log(`contagens e amostras de todas as ${rep.tables} tabelas conferem com o manifesto (${rep.rows} linhas)`);

      // 7. objetos referenciados (opcional)
      if (verifyObjectsFrom) {
        s = Date.now(); const items = await listReferencedObjects(sql); rep.objects = await verifyObjects({ store: verifyObjectsFrom, items, concurrency: objectConcurrency, log }); mark('verificar_objetos', s);
        log(`objetos: ${rep.objects.ok}/${rep.objects.total} íntegros, ${rep.objects.missing.length} ausentes, ${rep.objects.corrupt.length} corrompidos`);
        if (!rep.objects.pass) rep.ok = false;
      }
      rep.totalMs = Date.now() - t0; return rep;
    } finally { await sql.end({ timeout: 5 }).catch(noop); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Restaura os DADOS de auth.users/auth.identities (backup feito com BACKUP_INCLUDE_AUTH=1) em um projeto Supabase NOVO, onde o schema auth já existe e as tabelas estão vazias. */
export async function restoreAuth({ env = process.env, target, keys, name, toUrl, log = noop } = {}) {
  const manifest = await loadManifest(target, name, { keys });
  if (!manifest.authData) throw new ToolError(`o backup ${name} não tem dados do Auth (foi feito sem BACKUP_INCLUDE_AUTH=1)`, { code: 'no_auth_data' });
  if (env.DATABASE_ADMIN_URL && sameDb(env.DATABASE_ADMIN_URL, toUrl)) throw new ToolError('o destino é o banco em uso (DATABASE_ADMIN_URL): restaure o Auth só em um projeto/banco NOVO', { code: 'refuse_live', exit: 2 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-restore-auth-')); const file = path.join(tmp, 'auth'); const sql = connect(toUrl, { max: 1 });
  try {
    for (const t of manifest.authData.tables) {
      const [r] = await sql`select to_regclass(${t}) is not null as ok`; if (!r.ok) throw new ToolError(`a tabela ${t} não existe no destino: crie o projeto Supabase novo (ele cria o schema auth) antes`, { code: 'no_auth_table' });
      const [{ n }] = await sql.unsafe(`select count(*)::bigint as n from ${t}`); if (Number(n) > 0) throw new ToolError(`${t} no destino NÃO está vazia (${n} linhas): recusado`, { code: 'not_empty', exit: 2 });
    }
    const cipher = verifyingHash(null), plain = verifyingHash(null);
    await pipeline(await target.get(manifest.authData.key), cipher, createDecryptStream(keys), plain, fs.createWriteStream(file, { mode: 0o600 }));
    if (cipher.sha256 !== manifest.authData.encryptedSha256 || plain.sha256 !== manifest.authData.plainSha256) throw new ToolError('dados do Auth não conferem com o manifesto: abortado', { code: 'sha_mismatch' });
    const r = await run(findPgBin('pg_restore', env), ['--data-only', '--exit-on-error', '--single-transaction', '--no-password', '-d', pgEnvFromUrl(toUrl, env).PGDATABASE, file], { env: pgEnvFromUrl(toUrl, env) });
    if (r.code !== 0) throw new ToolError(`pg_restore do Auth falhou: ${r.stderr.trim().split('\n').slice(-4).join(' | ')}`, { code: 'pg_restore_failed' });
    const counts = {}; for (const t of manifest.authData.tables) counts[t] = Number((await sql.unsafe(`select count(*)::bigint as n from ${t}`))[0].n);
    const diffs = Object.entries(manifest.authData.counts).filter(([t, n]) => counts[t] !== n).map(([t, n]) => `${t}: ${counts[t]} linhas, o manifesto diz ${n}`);
    log(diffs.length ? `DIFERENÇAS: ${diffs.join('; ')}` : `dados do Auth restaurados e conferidos: ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(', ')}`);
    return { ok: !diffs.length, counts, diffs };
  } finally { await sql.end({ timeout: 5 }).catch(noop); fs.rmSync(tmp, { recursive: true, force: true }); }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['json', 'latest', 'verify-objects', 'yes', 'to-primary', 'only-referenced', 'i-am-restoring-production', 'no-roles'] });
  const cmd = args._[0] || 'help'; const redact = buildRedactor(env); const logger = makeLogger({ json: !!args.json, redact }); const log = (m) => logger.info(m);
  if (cmd === 'help' || args.help) { process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*/, '') + '\n'); return 0; }
  if (args.target) env = { ...env, BACKUP_TARGET: args.target };
  const target = openTarget(env.BACKUP_TARGET, env); const keyring = keyringFromEnv(env); const out = {};

  if (cmd === 'list') {
    const { complete, incomplete } = await listBackups(target);
    for (const b of complete) log(`${b.name}  ${b.at.toISOString()}  ${fmtBytes(b.dumpBytes)}`); for (const i of incomplete) logger.warn(`incompleto: ${i.name} (${i.reason})`);
    if (!complete.length) log('nenhum backup completo no destino'); return 0;
  }
  if (cmd === 'db') {
    const name = await resolveBackupName(target, { name: args.name, latest: true });
    let verifyFrom = null;
    if (args['verify-objects']) {
      if (args['objects-dir']) verifyFrom = new FileStore(args['objects-dir'], { secure: false }); else verifyFrom = openPrimaryStore(env);
    }
    const rep = await restoreDb({ env, target, keys: keyring.all, name, toUrl: args.to || env.RESTORE_DATABASE_URL, dropExisting: args['drop-existing'] || null, allowProduction: !!args['i-am-restoring-production'], rolesBootstrap: !args['no-roles'], log, verifyObjectsFrom: verifyFrom });
    out.restore = rep; log(rep.ok ? `RESTAURAÇÃO OK em ${fmtMs(rep.totalMs)}` : 'RESTAURAÇÃO COM PROBLEMAS (veja acima)');
    if (args.json) process.stdout.write(JSON.stringify(out) + '\n'); return rep.ok ? 0 : 1;
  }
  if (cmd === 'auth') {
    const name = await resolveBackupName(target, { name: args.name, latest: true });
    const rep = await restoreAuth({ env, target, keys: keyring.all, name, toUrl: args.to || env.RESTORE_DATABASE_URL, log }); out.auth = rep;
    if (args.json) process.stdout.write(JSON.stringify(out) + '\n'); return rep.ok ? 0 : 1;
  }
  if (cmd === 'objects') {
    let dest;
    if (args['to-dir']) dest = new FileStore(args['to-dir'], { secure: false });
    else if (args['to-primary']) { if (!args.yes) throw new ToolError('--to-primary grava no armazenamento principal: confirme com --yes', { exit: 2, code: 'confirm' }); dest = openPrimaryStore(env); }
    else throw new ToolError('informe --to-dir PASTA ou --to-primary --yes', { exit: 2, code: 'usage' });
    let only = null;
    if (args['only-referenced']) { if (!args.db) throw new ToolError('--only-referenced precisa de --db URL (banco restaurado)', { exit: 2 }); const sql = connect(args.db, { max: 1 }); try { only = new Set((await listReferencedObjects(sql)).map((i) => i.sha256)); } finally { await sql.end(); } }
    const rep = await restoreObjects({ backup: target, dest, keys: keyring.all, only, concurrency: Number(args.concurrency) || 4, log });
    log(`objetos restaurados: ${rep.restored} (${fmtBytes(rep.restoredBytes)}), já presentes: ${rep.alreadyPresent}, falhas: ${rep.failed.length}, ausentes do backup: ${rep.notInBackup.length}`);
    if (args.json) process.stdout.write(JSON.stringify(rep) + '\n'); return rep.ok ? 0 : 1;
  }
  throw new ToolError(`comando desconhecido: ${cmd}. Use list | db | auth | objects`, { exit: 2, code: 'usage' });
}
if (isMain(import.meta.url)) runCli(() => main());
