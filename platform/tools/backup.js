#!/usr/bin/env node
/* tools/backup.js — backup CRIPTOGRAFADO do banco e espelho incremental dos arquivos para um destino EXTERNO.

   Uso (variáveis de ambiente; nada de segredo em argumento):
     node tools/backup.js db        # pg_dump → AES-256-GCM → destino + manifesto (verifica o que gravou)
     node tools/backup.js objects   # espelho incremental e cifrado dos arquivos (só copia o que falta; nunca apaga)
     node tools/backup.js all       # db + objects  (acrescente --prune [--apply] para podar pela retenção GFS depois de um backup verificado)
                                    #   --max-minutos N: a cópia dos arquivos para de começar arquivos novos depois de N minutos (o job do GitHub
                                    #   tem 6 h); o que faltou continua na próxima execução. --concurrency N: cópias em paralelo (padrão 4)
     node tools/backup.js prune-objects [--apply] [--min-age-days 30] [--max-fraction 0.1]
                                    # PODA SEGURA do espelho (SIMULAÇÃO por padrão): só arquivos fora da origem, sem referência no banco atual
                                    # nem em NENHUM backup retido, e há mais de 30 dias no espelho. Recusa se for apagar mais de 10% do espelho
     node tools/backup.js verify [--name NOME]        # baixa, decifra e confere SHA-256/TOC do backup (padrão: o mais recente)
     node tools/backup.js list
     node tools/backup.js prune [--apply]             # retenção GFS 14 diários/8 semanais/12 mensais (SIMULAÇÃO por padrão)
     node tools/backup.js check                       # só valida a configuração (separação de contas, chaves…)
   Variáveis: BACKUP_INCLUDE_AUTH=1 (opcional: inclui os dados de auth.users/auth.identities do Supabase Auth, cifrados à parte),
              DATABASE_ADMIN_URL, BACKUP_TARGET (file:///dir | s3://bucket/prefixo), BACKUP_ENCRYPTION_KEY (32 bytes base64),
              BACKUP_S3_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE (destino S3, credenciais PRÓPRIAS),
              STORAGE_DRIVER + STORAGE_LOCAL_DIR | S3_* (origem dos arquivos), BACKUP_ENV_NAME (rótulo; padrão APP_ENV), PG_BIN_DIR.

   Decisões de projeto (e por quê):
   • pg_dump -Fc (formato custom): já vem comprimido (zlib, -Z 6; comprimir de novo não ganha nada) e permite restauração seletiva/paralela.
   • NÃO usamos --no-owner/--no-privileges: a segurança do Canteiro está nos donos (app_owner) e nos GRANT/RLS; um restore sem eles criaria
     objetos do superusuário (SECURITY DEFINER rodando como superusuário = fuga do RLS). Em troca o restore exige que os papéis existam
     (restore.js os cria com o mesmo bootstrap do migrate).
   • Escopo: schemas `app` e `public` (que só contém schema_migrations) — tabela app.rate_limits entra SEM dados (efêmera, e contém IPs).
   • Snapshot exportado (pg_export_snapshot + --snapshot): as contagens do manifesto e o dump enxergam exatamente o mesmo instante. */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import { PassThrough, Readable, Writable, pipeline } from 'node:stream';
import { pipeline as pipelineP } from 'node:stream/promises';
import { ToolError, buildRedactor, makeLogger, parseArgs, fmtBytes, fmtMs, runCli, isMain, sha256Hex } from './lib/common.js';
import { keyringFromEnv, createEncryptStream, createDecryptStream, signManifest, verifyManifest, DEFAULT_CHUNK } from './lib/backup-crypto.js';
import { openTarget, openPrimaryStore, assertSeparateFromPrimary } from './lib/targets.js';
import { findPgBin, pgToolVersion, pgEnvFromUrl, connect, listBackupTables, tableFingerprints, run, dbNameOf } from './lib/pg.js';
import { verifyingHash, mirrorObjects, pruneMirror } from './lib/mirror.js';
import { backupName, dumpKey, authKey, refsKey, manifestKey, STATUS_OBJECTS, listBackups, loadManifest, resolveBackupName, readJson } from './lib/backup-catalog.js';
import { gfsPlan } from './lib/retention.js';
import { listMigrations } from './migrate.js';

const noop = () => {};

/** Valida a configuração; devolve {errors, warnings}. */
export function checkConfig(env = process.env, { needDb = true, needObjects = false } = {}) {
  const errors = [], warnings = [];
  if (!env.BACKUP_TARGET) errors.push('BACKUP_TARGET não definido (file:///pasta ou s3://bucket/prefixo)');
  try { keyringFromEnv(env); } catch (e) { errors.push(e.message); }
  if (needDb && !env.DATABASE_ADMIN_URL) errors.push('DATABASE_ADMIN_URL não definido (conexão direta, papel dono do banco)');
  if (env.BACKUP_TARGET) { const sep = assertSeparateFromPrimary(env.BACKUP_TARGET, env); errors.push(...sep.errors); warnings.push(...sep.warnings); }
  if (needDb && env.DATABASE_ADMIN_URL) {
    try {
      const dbUrl = new URL(env.DATABASE_ADMIN_URL);
      const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(dbUrl.hostname);
      const modes = dbUrl.searchParams.getAll('sslmode');
      // A biblioteca usa TLS obrigatório em conexões remotas quando sslmode está ausente.
      // Prefer/allow podem negociar conexão em texto claro; duplicatas são ambíguas.
      if (!local && (modes.length > 1 || (modes.length === 1 && !['require', 'verify-ca', 'verify-full'].includes(modes[0])))) {
        errors.push('DATABASE_ADMIN_URL remota exige TLS (sslmode=require, verify-ca ou verify-full; sem parâmetros duplicados)');
      }
      if (/(^|\.)pooler\.supabase\.com$/.test(dbUrl.hostname) && dbUrl.port === '6543') {
        warnings.push('DATABASE_ADMIN_URL aponta para o pooler (porta 6543): o backup precisa da conexão DIRETA (porta 5432) para usar snapshot');
      }
    } catch {
      errors.push('DATABASE_ADMIN_URL inválida');
    }
  }
  if (needObjects) { try { openPrimaryStore(env); } catch (e) { errors.push(e.message); } }
  return { errors, warnings };
}
function requireConfig(env, opts) { const { errors, warnings } = checkConfig(env, opts); if (errors.length) throw new ToolError('configuração de backup incompleta/insegura:\n  - ' + errors.join('\n  - '), { code: 'bad_config', exit: 2 }); return warnings; }

/** pg_dump em fluxo (stdout). O stream só TERMINA se o processo sair com código 0; senão é destruído com o erro (nada é gravado como "válido"). */
function dumpStream(bin, args, env) {
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = '';
  child.stderr.on('data', (d) => { if (stderr.length < 2e5) stderr += d; });
  const out = new PassThrough({ highWaterMark: 4 * 1024 * 1024 });
  child.stdout.pipe(out, { end: false });
  child.on('error', (e) => out.destroy(new ToolError(`não consegui executar pg_dump: ${e.message}`, { code: 'pg_dump_spawn' })));
  child.on('close', (code, sig) => { if (code === 0) out.end(); else out.destroy(new ToolError(`pg_dump falhou (código ${code ?? sig}): ${stderr.trim().split('\n').slice(-6).join(' | ')}`, { code: 'pg_dump_failed' })); });
  return { out, stderr: () => stderr };
}

// -------------------------------------------------------------------------------------------- arquivos referenciados (poda)
/** Todos os arquivos que um banco referencia (registrados, usados em slides ou como miniatura), em ordem — superconjunto do que uma
 *  restauração daquele banco pode precisar. Lido em lotes (cursor): 1 milhão de linhas não vira 1 milhão de objetos na memória. */
export function refsQuery(q) {
  return q`select sha256 from app.assets union select thumb_sha from app.presentations where thumb_sha is not null union select sha256 from app.asset_refs order by 1`;
}
async function gravarRefs({ q, target, key, keyring, chunkSize }) {
  let count = 0;
  const linhas = Readable.from((async function* () { for await (const rows of refsQuery(q).cursor(5000)) { count += rows.length; yield Buffer.from(rows.map((r) => `${r.sha256}\n`).join('')); } })());
  const gz = verifyingHash(null), cipher = verifyingHash(null);
  await target.put(key, pipeline(linhas, zlib.createGzip({ level: 6 }), gz, createEncryptStream(keyring.current, { chunkSize }), cipher, noop));
  return { key, count, encryptedBytes: cipher.bytes, encryptedSha256: cipher.sha256, gzipBytes: gz.bytes, gzipSha256: gz.sha256, format: 'sha256-por-linha+gzip' };
}
/** Baixa, autentica (MAC dos blocos + SHA-256 do manifesto) e lê a lista de arquivos referenciados de um backup. */
export async function loadRefs({ target, manifest: m, keys }) {
  if (!m.refs) throw new ToolError(`o backup ${m.name} não tem a lista de arquivos referenciados (é anterior a esta versão)`, { code: 'no_refs' });
  const cipher = verifyingHash(null), gz = verifyingHash(null); const set = new Set(); let resto = ''; let linhas = 0;
  const coletor = new Writable({ write(c, _e, cb) {
    const partes = (resto + c.toString('utf8')).split('\n'); resto = partes.pop();
    for (const l of partes) { if (!/^[0-9a-f]{64}$/.test(l)) return cb(new ToolError(`lista de arquivos do backup ${m.name} com linha inválida`, { code: 'bad_refs' })); set.add(l); linhas++; }
    cb();
  } });
  await pipelineP(await target.get(m.refs.key), cipher, createDecryptStream(keys), gz, zlib.createGunzip(), coletor);
  if (resto) throw new ToolError(`lista de arquivos do backup ${m.name} truncada`, { code: 'bad_refs' });
  if (cipher.sha256 !== m.refs.encryptedSha256 || gz.sha256 !== m.refs.gzipSha256 || linhas !== m.refs.count) throw new ToolError(`a lista de arquivos do backup ${m.name} não confere com o manifesto`, { code: 'refs_mismatch' });
  return set;
}

// ---------------------------------------------------------------------------------------------------------------- banco
export async function backupDb({ env = process.env, target, keyring, log = noop, verify = true, now = new Date(), chunkSize = DEFAULT_CHUNK } = {}) {
  const t0 = Date.now(); const adminUrl = env.DATABASE_ADMIN_URL;
  const pgDump = findPgBin('pg_dump', env); const ver = pgToolVersion(pgDump);
  const sql = connect(adminUrl, { max: 1 });
  const envName = env.BACKUP_ENV_NAME || env.APP_ENV || 'unknown'; const name = backupName(envName, now);
  try {
    const [{ v, num }] = await sql`select version() as v, current_setting('server_version_num')::int as num`;
    const serverMajor = Math.floor(num / 10000);
    if (ver.major < serverMajor) throw new ToolError(`o pg_dump instalado é da versão ${ver.major}, mais antigo que o servidor (${serverMajor}). Instale postgresql-client-${serverMajor} e aponte PG_BIN_DIR para ele`, { code: 'pg_version', exit: 2 });
    const extras = (await sql`select n.nspname || '.' || c.relname as obj from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f') and c.relname <> 'schema_migrations' and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('e','a'))`).map((r) => r.obj);
    if (extras.length) log(`aviso: há objetos extras no schema public que também entram no backup: ${extras.join(', ')}`);

    const baseArgs = ['-Fc', '-Z', '6', '-n', 'app', '-n', 'public', '--exclude-table-data=app.rate_limits', '--lock-wait-timeout=120000'];
    const includeAuth = ['1', 'true', 'yes', 'on'].includes(String(env.BACKUP_INCLUDE_AUTH || '').toLowerCase());
    const encryptedPut = async (key, args) => {
      const { out } = dumpStream(pgDump, args, pgEnvFromUrl(adminUrl, env));
      const plain = verifyingHash(null), cipher = verifyingHash(null), enc = createEncryptStream(keyring.current, { chunkSize });
      await target.put(key, pipeline(out, plain, enc, cipher, noop));
      return { plain, cipher, args };
    };
    const dumpOnce = async (snapshot, q) => {
      const snap = snapshot ? [`--snapshot=${snapshot}`] : [];
      const main = await encryptedPut(dumpKey(name), [...baseArgs, ...snap]);
      let auth = null;
      if (includeAuth) {
        // OPCIONAL (BACKUP_INCLUDE_AUTH=1): só os DADOS de auth.users/auth.identities (contas e hashes de senha do Supabase Auth), em arquivo cifrado à parte.
        // Sem isto, perder o projeto Supabase obriga todos a "criar a senha de novo" via novo convite. O backup diário do Supabase também cobre o schema auth.
        const have = (await q`select (to_regclass('auth.users') is not null) as u, (to_regclass('auth.identities') is not null) as i`)[0];
        if (!have.u) throw new ToolError('BACKUP_INCLUDE_AUTH=1, mas auth.users não existe neste banco (não é um projeto Supabase?)', { code: 'no_auth_schema', exit: 2 });
        const tabs = ['auth.users', ...(have.i ? ['auth.identities'] : [])];
        const a = await encryptedPut(authKey(name), ['-Fc', '-Z', '6', '--data-only', ...tabs.flatMap((t) => ['-t', t]), '--lock-wait-timeout=120000', ...snap]);
        auth = { ...a, tables: tabs };
      }
      return { ...main, auth };
    };

    let consistent = true, dump, tables, fingerprints, migrationsApplied, dumpStarted = false;
    try {
      ({ dump, tables, fingerprints, migrationsApplied } = await sql.begin('isolation level repeatable read read only', async (tx) => {
        const [{ snap }] = await tx`select pg_export_snapshot() as snap`;
        const tabs = await listBackupTables(tx); const fps = await tableFingerprints(tx, tabs);
        const mig = (await tx`select version, name, checksum from public.schema_migrations order by version`).map((r) => ({ version: r.version, name: r.name, checksum: r.checksum }));
        dumpStarted = true; const d = await dumpOnce(snap, tx);
        if (d.auth) { d.auth.counts = {}; for (const t of d.auth.tables) d.auth.counts[t] = Number((await tx.unsafe(`select count(*)::bigint as n from ${t}`))[0].n); }
        d.refs = await gravarRefs({ q: tx, target, key: refsKey(name), keyring, chunkSize });   // mesmo instante do dump (mesma transação)
        return { dump: d, tables: tabs, fingerprints: fps, migrationsApplied: mig };
      }));
    } catch (e) {
      if (dumpStarted) throw e;   // falhou no dump (não na preparação do snapshot): não mascarar
      consistent = false; log(`aviso: não consegui usar snapshot exportado (${String(e.message).slice(0, 120)}). Seguindo sem consistência perfeita entre contagens e dump`);
      tables = await listBackupTables(sql); fingerprints = await sql.begin('isolation level repeatable read read only', (tx) => tableFingerprints(tx, tables));
      migrationsApplied = (await sql`select version, name, checksum from public.schema_migrations order by version`).map((r) => ({ version: r.version, name: r.name, checksum: r.checksum }));
      dump = await dumpOnce(null, sql);
      if (dump.auth) { dump.auth.counts = {}; for (const t of dump.auth.tables) dump.auth.counts[t] = Number((await sql.unsafe(`select count(*)::bigint as n from ${t}`))[0].n); }
      dump.refs = await gravarRefs({ q: sql, target, key: refsKey(name), keyring, chunkSize });
    }

    const finished = new Date();
    const manifest = signManifest(keyring.current, {
      format: 'canteiro-backup-manifest', version: 1, name, env: envName, createdAt: now.toISOString(), finishedAt: finished.toISOString(), durationMs: Date.now() - t0,
      dump: { key: dumpKey(name), encryptedBytes: dump.cipher.bytes, encryptedSha256: dump.cipher.sha256, plainBytes: dump.plain.bytes, plainSha256: dump.plain.sha256 },
      crypto: { alg: 'AES-256-GCM', format: 'CNTBK v1', chunkSize },
      pg: { dumpVersion: ver.full, dumpMajor: ver.major, serverVersion: v.split(' ').slice(0, 2).join(' '), serverMajor, args: dump.args.filter((a) => !a.startsWith('--snapshot')), database: dbNameOf(adminUrl), consistentSnapshot: consistent },
      schema: { latestMigration: migrationsApplied.at(-1)?.version || null, migrations: migrationsApplied },
      tables: fingerprints, extraPublicObjects: extras,
      refs: dump.refs,
      ...(dump.auth ? { authData: { key: authKey(name), encryptedBytes: dump.auth.cipher.bytes, encryptedSha256: dump.auth.cipher.sha256, plainBytes: dump.auth.plain.bytes, plainSha256: dump.auth.plain.sha256, tables: dump.auth.tables, counts: dump.auth.counts } } : {}),
    });
    await target.put(manifestKey(name), Buffer.from(JSON.stringify(manifest, null, 2)));
    const res = { name, bytes: dump.cipher.bytes, plainBytes: dump.plain.bytes, durationMs: Date.now() - t0, tables: Object.keys(fingerprints).length, rows: Object.values(fingerprints).reduce((a, t) => a + t.count, 0), consistent, verified: false };
    log(`dump gravado: ${name} (${fmtBytes(res.bytes)} cifrados, ${fmtBytes(res.plainBytes)} em claro, ${res.tables} tabelas, ${res.rows} linhas)`);
    if (verify) { const v2 = await verifyDbBackup({ env, target, name, keys: keyring.all, log }); res.verified = v2.ok; }
    return res;
  } finally { await sql.end({ timeout: 5 }).catch(noop); }
}

/** Baixa e confere um backup: SHA-256 do arquivo cifrado, decifra (autenticando TODOS os blocos), SHA-256 do dump em claro e `pg_restore --list`. */
export async function verifyDbBackup({ env = process.env, target, name, keys, log = noop }) {
  const m = await loadManifest(target, name, { keys });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-verify-')); const file = path.join(tmp, 'dump');
  try {
    const rs = await target.get(m.dump.key); const cipher = verifyingHash(null), plain = verifyingHash(null);
    await pipelineP(rs, cipher, createDecryptStream(keys), plain, fs.createWriteStream(file, { mode: 0o600 }));
    const problems = [];
    if (cipher.sha256 !== m.dump.encryptedSha256) problems.push('SHA-256 do arquivo cifrado diferente do manifesto');
    if (cipher.bytes !== m.dump.encryptedBytes) problems.push('tamanho do arquivo cifrado diferente do manifesto');
    if (plain.sha256 !== m.dump.plainSha256) problems.push('SHA-256 do dump em claro diferente do manifesto');
    const list = await run(findPgBin('pg_restore', env), ['--list', file], { env: process.env });
    if (list.code !== 0) problems.push('pg_restore --list não conseguiu ler o dump: ' + list.stderr.trim().slice(0, 200));
    const dataEntries = (list.stdout.match(/ TABLE DATA /g) || []).length;
    const want = Object.values(m.tables).filter((t) => !t.dataExcluded).length;
    if (list.code === 0 && dataEntries < want) problems.push(`o dump tem ${dataEntries} tabelas com dados, esperado ${want}`);
    if (m.authData) problems.push(...(await verifyAuthData({ env, target, manifest: m, keys })).problems);
    if (m.refs) { try { await loadRefs({ target, manifest: m, keys }); } catch (e) { problems.push(e.message); } }
    if (problems.length) throw new ToolError(`backup ${name} NÃO passou na verificação: ${problems.join('; ')}`, { code: 'verify_failed' });
    log(`backup ${name} verificado: SHA-256 e autenticação de todos os blocos OK, ${dataEntries} tabelas no índice do dump`);
    return { ok: true, name, dataEntries, plainBytes: plain.bytes };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Confere o arquivo opcional com os dados do Supabase Auth (BACKUP_INCLUDE_AUTH=1): SHA-256 cifrado e em claro, autenticação de todos os blocos e índice do pg_restore. */
export async function verifyAuthData({ env = process.env, target, manifest: m, keys }) {
  if (!m.authData) return { present: false, ok: true, problems: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-verify-auth-')); const fA = path.join(tmp, 'auth'); const problems = [];
  try {
    const cA = verifyingHash(null), pA = verifyingHash(null);
    await pipelineP(await target.get(m.authData.key), cA, createDecryptStream(keys), pA, fs.createWriteStream(fA, { mode: 0o600 }));
    if (cA.sha256 !== m.authData.encryptedSha256 || pA.sha256 !== m.authData.plainSha256) problems.push('dados do Auth (auth.users) não conferem com o manifesto');
    const lA = await run(findPgBin('pg_restore', env), ['--list', fA], { env: process.env });
    if (lA.code !== 0) problems.push('pg_restore --list não leu o dump do Auth');
    const tabelas = (lA.stdout.match(/ TABLE DATA /g) || []).length;
    if (lA.code === 0 && tabelas < (m.authData.tables || []).length) problems.push(`o dump do Auth tem ${tabelas} tabelas com dados, esperado ${(m.authData.tables || []).length}`);
    return { present: true, ok: !problems.length, problems, tables: m.authData.tables, counts: m.authData.counts, plainBytes: pA.bytes };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------------------------------------------------- arquivos
export async function backupObjects({ env = process.env, target, keyring, log = noop, dryRun = false, concurrency = 4, deadline = null } = {}) {
  const source = openPrimaryStore(env);
  const rep = await mirrorObjects({ source, dest: target, key: keyring.current, concurrency, dryRun, log, deadline });
  // "parcial" = parou no horário-limite sem falhar (1ª cópia de um acervo grande): não é erro; o status guarda desde quando está parcial,
  // e o monitor de frescor (maintenance.js backup-freshness) só reclama se continuar parcial por dias seguidos.
  const partial = rep.stoppedByTime;
  let partialSince = null;
  if (partial && !dryRun) { const prev = await readJson(target, STATUS_OBJECTS).catch(() => null); partialSince = prev && prev.partial && prev.partialSince && verifyManifest(keyring.all, prev) ? prev.partialSince : new Date().toISOString(); }
  const summary = { ...rep, source: source.describe(), ok: !rep.failed.length && !rep.corruptInSource.length, partial, partialSince };
  if (!dryRun) await target.put(STATUS_OBJECTS, Buffer.from(JSON.stringify(signManifest(keyring.current, { format: 'canteiro-objects-status', version: 1, at: new Date().toISOString(), ...summary, failed: rep.failed.slice(0, 50), corruptInSource: rep.corruptInSource.slice(0, 50) }), null, 2)));
  log(`arquivos: ${rep.copied} copiados (${fmtBytes(rep.copiedBytes)}), ${rep.alreadyInDestination} já estavam no destino, ${rep.failed.length} falhas, ${rep.corruptInSource.length} corrompidos na origem — ${fmtMs(rep.durationMs)}${partial ? ` — PARCIAL (horário-limite): ${rep.shardsDone}/${rep.shardsTotal} fatias, continua na próxima execução` : ''}`);
  return summary;
}

/**
 * Poda SEGURA do espelho de arquivos (opcional; simulação por padrão). Protege: o que está na origem, o que o banco ATUAL referencia e o que
 * QUALQUER backup completo no destino referencia (lista `refs` de cada manifesto). Se algum backup não tiver a lista (anterior a esta versão),
 * recusa — a poda fica disponível quando ele sair da retenção.
 */
export async function pruneObjects({ env = process.env, target, keyring, apply = false, minAgeDays = 30, maxFraction = 0.1, log = noop, now = new Date() } = {}) {
  const { complete } = await listBackups(target);
  if (!complete.length) throw new ToolError('nenhum backup completo do banco no destino: sem ele não dá para saber o que ainda é necessário. Nada foi apagado', { code: 'no_backup' });
  const protegidos = new Set(); const semLista = [];
  for (const b of complete) {
    const m = await loadManifest(target, b.name, { keys: keyring.all });
    if (!m.refs) { semLista.push(b.name); continue; }
    for (const sha of await loadRefs({ target, manifest: m, keys: keyring.all })) protegidos.add(sha);
  }
  if (semLista.length) {
    const msg = `${semLista.length} backup(s) retido(s) sem a lista de arquivos referenciados (feitos antes desta versão; o mais antigo: ${semLista[0]}). A poda fica disponível quando eles saírem da retenção (até ~13 meses). Nada foi apagado`;
    log(`poda do espelho RECUSADA: ${msg}`);
    return { apply, refused: msg, backupsSemLista: semLista, deleted: 0, ok: false };
  }
  const sql = connect(env.DATABASE_ADMIN_URL, { max: 1 });
  try { for await (const rows of refsQuery(sql).cursor(5000)) for (const r of rows) protegidos.add(r.sha256); } finally { await sql.end({ timeout: 5 }).catch(noop); }
  const rep = await pruneMirror({ source: openPrimaryStore(env), dest: target, protegidos, apply, minAgeDays, maxFraction, now, log });
  return { ...rep, backupsConsiderados: complete.length, protegidos: protegidos.size };
}

// -------------------------------------------------------------------------------------------------------------- retenção
export async function pruneBackups({ target, apply = false, daily = 14, weekly = 8, monthly = 12, minKeep = 3, now = new Date(), log = noop }) {
  const { complete, incomplete } = await listBackups(target);
  const plan = gfsPlan(complete, { now, daily, weekly, monthly, minKeep });
  if (complete.length && !plan.keep.length) throw new ToolError('plano de retenção inválido (não mantém nenhum backup): abortado', { code: 'bad_plan' });
  log(`retenção: ${plan.summary.total} backups completos → mantém ${plan.summary.keep}, remove ${plan.summary.remove}${apply ? '' : ' (SIMULAÇÃO: use --apply para apagar)'}; incompletos: ${incomplete.length}`);
  for (const e of plan.remove) log(`  ${apply ? 'apagando' : 'apagaria'}: ${e.name}`);
  const removed = [];
  if (apply) for (const e of plan.remove) { await target.delete(manifestKey(e.name)); await target.delete(authKey(e.name)); await target.delete(refsKey(e.name)); await target.delete(dumpKey(e.name)); removed.push(e.name); }  // manifesto primeiro: um dump sem manifesto nunca é tratado como backup válido
  return { apply, total: plan.summary.total, kept: plan.keep.map((e) => ({ name: e.name, why: e.why })), toRemove: plan.remove.map((e) => e.name), removed, incomplete };
}

// ------------------------------------------------------------------------------------------------------------------- CLI
export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['json', 'verify', 'apply', 'dry-run', 'quiet', 'prune'] });
  const cmd = args._[0] || 'help'; const redact = buildRedactor(env);
  const logger = makeLogger({ json: !!args.json, redact });
  const log = (m) => logger.info(m);
  if (args.target) env = { ...env, BACKUP_TARGET: args.target };
  if (cmd === 'help' || args.help) { process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*/, '') + '\n'); return 0; }
  const out = {};
  const finish = (code) => { if (args.json) process.stdout.write(JSON.stringify(out) + '\n'); return code; };

  if (cmd === 'check') {
    const r = checkConfig(env, { needDb: true, needObjects: true }); r.warnings.forEach((w) => logger.warn(w)); r.errors.forEach((e) => logger.error(e));
    log(r.errors.length ? 'configuração com problemas' : 'configuração de backup OK (chaves, destino separado do armazenamento principal)'); out.ok = !r.errors.length; out.errors = r.errors; out.warnings = r.warnings; return finish(r.errors.length ? 2 : 0);
  }
  const needDb = cmd === 'db' || cmd === 'all' || cmd === 'prune-objects'; const needObj = cmd === 'objects' || cmd === 'all' || cmd === 'prune-objects';
  const maxMin = args['max-minutos'] === undefined ? null : Number(args['max-minutos']);
  if (maxMin !== null && !(maxMin > 0)) throw new ToolError('--max-minutos precisa ser um número de minutos maior que zero', { exit: 2, code: 'usage' });
  const deadline = maxMin ? Date.now() + maxMin * 60e3 : null;
  const warnings = requireConfig(env, { needDb, needObjects: needObj }); warnings.forEach((w) => logger.warn(w));
  const target = openTarget(env.BACKUP_TARGET, env); const keyring = keyringFromEnv(env);
  log(`destino: ${target.describe()}`);
  let failed = false;
  if (cmd === 'db' || cmd === 'all') {
    try { out.db = await backupDb({ env, target, keyring, log, verify: args.verify !== false }); } catch (e) { failed = true; out.db = { ok: false, error: redact(e.message) }; logger.error(`backup do banco FALHOU: ${e.message}`); }
  }
  if (cmd === 'objects' || cmd === 'all') {
    try { out.objects = await backupObjects({ env, target, keyring, log, dryRun: !!args['dry-run'], concurrency: Number(args.concurrency) || 4, deadline }); if (!out.objects.ok) failed = true; } catch (e) { failed = true; out.objects = { ok: false, error: redact(e.message) }; logger.error(`espelho dos arquivos FALHOU: ${e.message}`); }
  }
  if (args.prune && (cmd === 'db' || cmd === 'all') && !failed) {
    // --prune: depois de um backup VERIFICADO aplica a retenção GFS (simulação, a menos que --apply)
    out.prune = await pruneBackups({ target, apply: !!args.apply, daily: Number(args['keep-daily']) || 14, weekly: Number(args['keep-weekly']) || 8, monthly: Number(args['keep-monthly']) || 12, log });
  }
  if (cmd === 'verify') {
    const name = await resolveBackupName(target, { name: args.name }); out.verify = await verifyDbBackup({ env, target, name, keys: keyring.all, log });
  }
  if (cmd === 'list') {
    const { complete, incomplete } = await listBackups(target); out.backups = complete.map((b) => ({ name: b.name, at: b.at.toISOString(), bytes: b.dumpBytes })); out.incomplete = incomplete;
    for (const b of complete) log(`${b.name}  ${b.at.toISOString()}  ${fmtBytes(b.dumpBytes)}`); for (const i of incomplete) logger.warn(`incompleto: ${i.name} (${i.reason})`);
    const st = await readJson(target, STATUS_OBJECTS).catch(() => null); if (st) { log(`último espelho de arquivos: ${st.at} (${st.copied} copiados, ${st.ok ? 'ok' : 'COM FALHAS'})`); out.objectsStatus = { at: st.at, ok: st.ok }; }
  }
  if (cmd === 'prune') {
    out.prune = await pruneBackups({ target, apply: !!args.apply, daily: Number(args['keep-daily']) || 14, weekly: Number(args['keep-weekly']) || 8, monthly: Number(args['keep-monthly']) || 12, log });
  }
  if (cmd === 'prune-objects') {
    const num = (v, d) => (v === undefined ? d : Number(v));
    const minAgeDays = num(args['min-age-days'], 30), maxFraction = num(args['max-fraction'], 0.1);
    if (!(minAgeDays >= 7)) throw new ToolError('--min-age-days precisa ser ≥ 7 (margem contra apagar o que acabou de ser copiado)', { exit: 2, code: 'usage' });
    if (!(maxFraction > 0 && maxFraction <= 0.5)) throw new ToolError('--max-fraction precisa estar entre 0 e 0.5', { exit: 2, code: 'usage' });
    out.pruneObjects = await pruneObjects({ env, target, keyring, apply: !!args.apply, minAgeDays, maxFraction, log });
    if (out.pruneObjects.refused || out.pruneObjects.failed?.length) failed = true;
  }
  if (!['db', 'objects', 'all', 'verify', 'list', 'prune', 'prune-objects', 'check'].includes(cmd)) throw new ToolError(`comando desconhecido: ${cmd}. Use db | objects | all | verify | list | prune | prune-objects | check`, { exit: 2, code: 'usage' });
  return finish(failed ? 1 : 0);
}

if (isMain(import.meta.url)) runCli(() => main());
