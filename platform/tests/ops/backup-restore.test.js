import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { setup, ADMIN_URL, OPS_URL, newKey, tmp, rmrf, freshDb, dropDb, seedSmall } from './_helpers.js';
import { backupDb, backupObjects, verifyDbBackup, pruneBackups, checkConfig, main as backupMain } from '../../tools/backup.js';
import { restoreDb, filterToc, listReferencedObjects } from '../../tools/restore.js';
import { openTarget, FileStore } from '../../tools/lib/targets.js';
import { keyringFromEnv, parseKey } from '../../tools/lib/backup-crypto.js';
import { listBackups, manifestKey, dumpKey } from '../../tools/lib/backup-catalog.js';
import { backupFreshness } from '../../tools/maintenance.js';
import { connect } from '../../tools/lib/pg.js';

// a migração mais recente vem da pasta de migrações (não fica presa a um número fixo)
const LATEST_MIGRATION = fs.readdirSync(new URL('../../db/migrations/', import.meta.url)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().at(-1).slice(0, 4);

let ctx; const dirs = []; const dbs = [];
const mkdir = (p) => { const d = tmp(p); dirs.push(d); return d; };
before(async () => {
  const { db, ops } = await setup(); const objs = mkdir('objs'); const store = new FileStore(objs, { secure: false }); const seeded = await seedSmall(ops, store, { files: 7 });
  // dado efêmero que NÃO deve ir para o backup
  await ops.asSystem((tx) => tx`insert into app.rate_limits(bucket, key, window_start, hits) values ('login', '1.2.3.4', now(), 3)`);
  const key = newKey(); const bk = mkdir('bk');
  const env = { ...process.env, DATABASE_ADMIN_URL: ADMIN_URL, BACKUP_TARGET: `file://${bk}`, BACKUP_ENCRYPTION_KEY: key, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: objs, APP_ENV: 'test', PG_BIN_DIR: '' };
  ctx = { db, ops, objs, store, seeded, key, bk, env, target: openTarget(env.BACKUP_TARGET, env), keyring: keyringFromEnv(env) };
});
after(async () => { await ctx.db.end(); await ctx.ops.end(); for (const d of dirs) rmrf(d); for (const u of dbs) await dropDb(u); });

test('configuração: destino obrigatório, chave válida e separação do armazenamento principal', () => {
  assert.ok(checkConfig({}).errors.length >= 3);
  assert.equal(checkConfig(ctx.env, { needObjects: true }).errors.length, 0);
  assert.ok(checkConfig({ ...ctx.env, BACKUP_TARGET: `file://${ctx.objs}/backup` }).errors.some((e) => /dentro/.test(e)));
  assert.ok(checkConfig({ ...ctx.env, BACKUP_ENCRYPTION_KEY: 'curta' }).errors.some((e) => /BACKUP_ENCRYPTION_KEY/.test(e)));
});

let first;
test('backup do banco: cifrado, com manifesto autenticado, contagens e sem dados de rate_limits', async () => {
  first = await backupDb({ env: ctx.env, target: ctx.target, keyring: ctx.keyring });
  assert.ok(first.verified && first.consistent); assert.ok(first.rows > 10);
  const { complete } = await listBackups(ctx.target); assert.equal(complete.length, 1);
  const raw = fs.readFileSync(path.join(ctx.bk, 'db', `${first.name}.dump.enc`)); assert.ok(raw.subarray(0, 5).equals(Buffer.from('CNTBK')));
  assert.equal(raw.indexOf('PGDMP'), -1, 'o dump não pode aparecer em claro'); assert.equal(raw.indexOf('Apresentação de teste'), -1);
  const m = JSON.parse(fs.readFileSync(path.join(ctx.bk, 'db', `${first.name}.manifest.json`), 'utf8'));
  assert.equal(m.schema.latestMigration, LATEST_MIGRATION); assert.equal(m.tables['app.users'].count, 1); assert.equal(m.tables['app.assets'].count, 7);
  assert.equal(m.tables['app.rate_limits'].count, 1); assert.equal(m.tables['app.rate_limits'].dataExcluded, true); assert.match(m.mac, /^hmac-sha256:/);
  assert.ok(m.pg.args.includes('--exclude-table-data=app.rate_limits')); assert.ok(!m.pg.args.includes('--no-owner'));
  assert.ok(!JSON.stringify(m).includes(ctx.key), 'a chave nunca aparece no manifesto');
});

test('restauração em banco novo: contagens, amostras, migrate --check, papéis/RLS e objetos conferem; rate_limits vazio', async () => {
  const url = await freshDb('r1'); dbs.push(url);
  const rep = await restoreDb({ env: ctx.env, target: ctx.target, keys: ctx.keyring.all, name: first.name, toUrl: url, verifyObjectsFrom: ctx.store });
  assert.ok(rep.ok, JSON.stringify(rep.diffs)); assert.equal(rep.diffs.length, 0); assert.equal(rep.counts['app.assets'], 7); assert.equal(rep.counts['app.rate_limits'], 0);
  assert.equal(rep.objects.ok, 7); assert.ok(rep.migrateCheck);
  const { runChecks } = await import('../../tools/verify-deploy.js'); const sql = connect(url); try { const res = await runChecks({ sql, env: { STORAGE_DRIVER: 'local' }, offline: true }); assert.deepEqual(res.filter((r) => r.status === 'fail').map((r) => r.id + ': ' + r.items.join(';')), []); } finally { await sql.end(); }
  // dono e privilégios preservados (sem --no-owner/--no-privileges)
  const s2 = postgres(url, { max: 1 }); try { const [o] = await s2`select tableowner from pg_tables where schemaname = 'app' and tablename = 'users'`; assert.equal(o.tableowner, 'app_owner'); } finally { await s2.end(); }
});

test('segurança do restore: recusa banco não vazio, nome de confirmação errado e o banco em uso; --drop-existing exige o nome exato', async () => {
  const url = await freshDb('r2'); dbs.push(url);
  await restoreDb({ env: ctx.env, target: ctx.target, keys: ctx.keyring.all, name: first.name, toUrl: url });
  await assert.rejects(() => restoreDb({ env: ctx.env, target: ctx.target, keys: ctx.keyring.all, name: first.name, toUrl: url }), /NÃO está vazio/);
  await assert.rejects(() => restoreDb({ env: ctx.env, target: ctx.target, keys: ctx.keyring.all, name: first.name, toUrl: url, dropExisting: 'outro_banco' }), /NÃO está vazio/);
  await assert.rejects(() => restoreDb({ env: ctx.env, target: ctx.target, keys: ctx.keyring.all, name: first.name, toUrl: ADMIN_URL }), /mesmo banco de DATABASE_ADMIN_URL/);
  const name = new URL(url).pathname.slice(1);
  const ok = await restoreDb({ env: ctx.env, target: ctx.target, keys: ctx.keyring.all, name: first.name, toUrl: url, dropExisting: name }); assert.ok(ok.ok);
});

test('backup adulterado, truncado, com manifesto trocado ou chave errada: restore recusa ANTES de tocar no banco', async () => {
  const dump = path.join(ctx.bk, 'db', `${first.name}.dump.enc`); const orig = fs.readFileSync(dump); const url = await freshDb('r3'); dbs.push(url);
  const empty = async () => { const s = postgres(url, { max: 1 }); try { const [r] = await s`select count(*)::int as n from pg_namespace where nspname = 'app'`; return r.n === 0; } finally { await s.end(); } };
  const attempt = () => restoreDb({ env: ctx.env, target: ctx.target, keys: ctx.keyring.all, name: first.name, toUrl: url });
  try {
    const bad = Buffer.from(orig); bad[Math.floor(bad.length / 2)] ^= 0xff; fs.writeFileSync(dump, bad); await assert.rejects(attempt, /autentica|adulterad/); assert.ok(await empty());
    fs.writeFileSync(dump, orig.subarray(0, orig.length - 40)); await assert.rejects(attempt, /TRUNCADO|trunca|autentica|SHA-256/); assert.ok(await empty());
    fs.writeFileSync(dump, Buffer.concat([orig, Buffer.from('x')])); await assert.rejects(attempt, /após o fim|SHA-256|extras/); assert.ok(await empty());
    fs.writeFileSync(dump, orig);
    await assert.rejects(() => restoreDb({ env: ctx.env, target: ctx.target, keys: [parseKey(newKey())], name: first.name, toUrl: url }), /MAC inválido|chave/); assert.ok(await empty());
    const mf = path.join(ctx.bk, 'db', `${first.name}.manifest.json`); const m = JSON.parse(fs.readFileSync(mf, 'utf8')); const mo = fs.readFileSync(mf);
    m.tables['app.users'].count = 999; fs.writeFileSync(mf, JSON.stringify(m)); await assert.rejects(attempt, /MAC inválido/); fs.writeFileSync(mf, mo);
    await assert.rejects(() => verifyDbBackup({ env: ctx.env, target: ctx.target, name: first.name, keys: [parseKey(newKey())] }), /MAC inválido/);
  } finally { fs.writeFileSync(dump, orig); }
  assert.ok((await verifyDbBackup({ env: ctx.env, target: ctx.target, name: first.name, keys: ctx.keyring.all })).ok);
});

test('falha do pg_dump não deixa backup "válido" (sem manifesto, sem arquivo final)', async () => {
  const bk = mkdir('bkfail'); const env = { ...ctx.env, BACKUP_TARGET: `file://${bk}`, DATABASE_ADMIN_URL: ADMIN_URL.replace('postgres:postgres@', 'postgres:senha-errada@') };
  await assert.rejects(() => backupDb({ env, target: openTarget(env.BACKUP_TARGET, env), keyring: ctx.keyring, verify: false }), /password|autentica|senha|FATAL|failed/i);
  const left = []; for await (const o of new FileStore(bk).list('')) left.push(o.key); assert.deepEqual(left, []);
});

test('espelho de arquivos via backupObjects + status; freshness e retenção', async () => {
  const r = await backupObjects({ env: ctx.env, target: ctx.target, keyring: ctx.keyring }); assert.equal(r.copied, 7); assert.ok(r.ok);
  const fresh = await backupFreshness({ target: ctx.target, keys: ctx.keyring.all }); assert.ok(fresh.ok, fresh.problems.join(';'));
  const old = await backupFreshness({ target: ctx.target, keys: ctx.keyring.all, now: new Date(Date.now() + 30 * 3600e3) }); assert.ok(!old.ok); assert.ok(old.problems.length === 2);
  assert.ok(!(await backupFreshness({ target: new FileStore(mkdir('vazio')), keys: null })).ok);
  // retenção: backups falsos antigos (um por dia por 40 dias) → plano; simulação não apaga; --apply apaga só db/ e nunca objects/
  const T = ctx.target; const fake = []; for (let i = 1; i <= 40; i++) { const at = new Date(Date.now() - i * 86400e3 - 3600e3); const name = `canteiro-test-${at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z')}`; fake.push(name); await T.put(dumpKey(name), Buffer.from('x')); await T.put(manifestKey(name), Buffer.from('{}')); }
  const sim = await pruneBackups({ target: T }); assert.ok(sim.toRemove.length > 0 && sim.removed.length === 0); assert.ok(await T.head(dumpKey(fake[39])));
  const real = await pruneBackups({ target: T, apply: true }); assert.equal(real.removed.length, sim.toRemove.length);
  assert.ok(await T.head(dumpKey(first.name)), 'o backup mais recente fica'); assert.equal(await T.head(dumpKey(fake[39])), null);
  let n = 0; for await (const o of T.list('objects/')) n++; assert.equal(n, 7, 'a poda nunca toca nos arquivos espelhados');
});

test('listReferencedObjects e filterToc', async () => {
  const items = await ctx.ops.asSystem((tx) => listReferencedObjects(tx)); assert.equal(items.length, 7);
  const { text, dropped } = filterToc('; cabeçalho\n4; 2615 2200 SCHEMA - public pg_database_owner\n3686; 0 0 COMMENT - SCHEMA public pg_database_owner\n6; 2615 19271 SCHEMA - app app_owner\n216; 1259 19263 TABLE public schema_migrations postgres\n');
  assert.equal(dropped.length, 2); assert.match(text, /SCHEMA - app/); assert.match(text, /schema_migrations/);
});

test('CLI: sem configuração sai com código 2 e mensagem clara; "check" valida', () => {
  const env = { PATH: process.env.PATH }; const r = spawnSync(process.execPath, ['tools/backup.js', 'db'], { env, encoding: 'utf8', cwd: new URL('../..', import.meta.url).pathname });
  assert.equal(r.status, 2); assert.match(r.stderr, /BACKUP_TARGET/); assert.doesNotMatch(r.stderr, /at .*\.js:\d+/);
  const ok = spawnSync(process.execPath, ['tools/backup.js', 'check'], { env: { ...ctx.env, PG_BIN_DIR: undefined }, encoding: 'utf8', cwd: new URL('../..', import.meta.url).pathname }); assert.equal(ok.status, 0, ok.stderr);
});

test('opcional BACKUP_INCLUDE_AUTH=1: contas do Supabase Auth vão cifradas à parte, são verificadas e restauram em projeto novo e vazio', async () => {
  const mkAuth = async (url, rows) => { const s = postgres(url, { max: 1, onnotice: () => {} }); try { await s.unsafe('create schema if not exists auth; create table if not exists auth.users(id uuid primary key, email text, encrypted_password text); create table if not exists auth.identities(id uuid primary key, user_id uuid, provider text)'); for (const r of rows) { await s`insert into auth.users values (${r.id}, ${r.email}, ${r.pw})`; await s`insert into auth.identities values (${r.id}, ${r.id}, 'email')`; } } finally { await s.end(); } };
  const rows = [1, 2, 3].map((i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, email: `a${i}@am.test`, pw: '$2a$10$hashdeteste' + i }));
  await mkAuth(ADMIN_URL, rows);
  const bk = mkdir('bkauth'); const env = { ...ctx.env, BACKUP_TARGET: `file://${bk}`, BACKUP_INCLUDE_AUTH: '1' }; const target = openTarget(env.BACKUP_TARGET, env);
  try {
    const r = await backupDb({ env, target, keyring: ctx.keyring }); assert.ok(r.verified);
    const files = []; for await (const o of target.list('db/')) files.push(o.key); assert.ok(files.some((f) => f.endsWith('.authdata.enc')));
    const raw = fs.readFileSync(path.join(bk, 'db', `${r.name}.authdata.enc`)); assert.equal(raw.indexOf('a1@am.test'), -1, 'e-mails/hashes nunca aparecem em claro');
    const { complete } = await listBackups(target); assert.equal(complete.length, 1, 'o arquivo do Auth não vira "backup" separado');
    const m = JSON.parse(fs.readFileSync(path.join(bk, 'db', `${r.name}.manifest.json`), 'utf8')); assert.deepEqual(m.authData.counts, { 'auth.users': 3, 'auth.identities': 3 });
    const url = await freshDb('auth1'); dbs.push(url); await restoreDb({ env, target, keys: ctx.keyring.all, name: r.name, toUrl: url });
    const { restoreAuth } = await import('../../tools/restore.js');
    await mkAuth(url, []);                                       // "projeto novo": schema auth criado pelo Supabase, tabelas vazias
    const rep = await restoreAuth({ env, target, keys: ctx.keyring.all, name: r.name, toUrl: url }); assert.ok(rep.ok); assert.equal(rep.counts['auth.users'], 3);
    await assert.rejects(() => restoreAuth({ env, target, keys: ctx.keyring.all, name: r.name, toUrl: url }), /NÃO está vazia/);
    await assert.rejects(() => restoreAuth({ env, target, keys: ctx.keyring.all, name: r.name, toUrl: ADMIN_URL }), /banco em uso/);
    // retenção apaga também o arquivo do Auth junto com o backup
    await target.put(dumpKey('canteiro-test-20200101T000000Z'), Buffer.from('x')); await target.put(manifestKey('canteiro-test-20200101T000000Z'), Buffer.from('{}'));
    const pr = await pruneBackups({ target, apply: true, daily: 1, weekly: 0, monthly: 0, minKeep: 1 }); assert.ok(pr.removed.includes('canteiro-test-20200101T000000Z'));
  } finally { const s = postgres(ADMIN_URL, { max: 1 }); await s.unsafe('drop schema if exists auth cascade'); await s.end(); }
  await assert.rejects(() => backupDb({ env: { ...ctx.env, BACKUP_TARGET: `file://${mkdir('bkx')}`, BACKUP_INCLUDE_AUTH: '1' }, target: openTarget(`file://${mkdir('bky')}`, ctx.env), keyring: ctx.keyring, verify: false }), /auth\.users não existe/);
});

test('CLI: backup db --prune faz a poda como SIMULAÇÃO (nada é apagado sem --apply)', async () => {
  const bk = mkdir('bkprune'); const env = { ...ctx.env, BACKUP_TARGET: `file://${bk}`, PG_BIN_DIR: undefined }; const target = openTarget(env.BACKUP_TARGET, env);
  for (let i = 1; i <= 20; i++) { const at = new Date(Date.now() - i * 86400e3 - 3600e3); const n = `canteiro-test-${at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z')}`; await target.put(dumpKey(n), Buffer.from('x')); await target.put(manifestKey(n), Buffer.from('{}')); }
  const before = (await listBackups(target)).complete.length; const w = process.stdout.write.bind(process.stdout); let captured = ''; process.stdout.write = (c) => { captured += c; return true; };
  let code; try { code = await backupMain(['db', '--prune', '--json'], env); } finally { process.stdout.write = w; }
  assert.equal(code, 0); const out = JSON.parse(captured.trim().split('\n').pop()); assert.equal(out.prune.apply, false); assert.ok(out.prune.toRemove.length >= 0);
  assert.equal((await listBackups(target)).complete.length, before + 1, 'nada foi apagado');
});
