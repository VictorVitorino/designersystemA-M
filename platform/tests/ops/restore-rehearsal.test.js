import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { setup, ADMIN_URL, OPS_URL, newKey, tmp, rmrf, freshDb, dropDb, seedSmall, startMoto, makeBucket } from './_helpers.js';
import { createOpsDb } from '../../src/db.js';
import { migrate } from '../../tools/migrate.js';
import { backupDb, backupObjects } from '../../tools/backup.js';
import { restoreDb } from '../../tools/restore.js';
import { ensaiar, relatorioMarkdown, amostra, conferirArquivos, escolherBackup } from '../../tools/restore-rehearsal.js';
import { openTarget, FileStore } from '../../tools/lib/targets.js';
import { keyringFromEnv, encryptBuffer, parseKey } from '../../tools/lib/backup-crypto.js';
import { keyOfSha, OBJ_PREFIX } from '../../tools/lib/mirror.js';
import { withDatabase } from '../../tools/lib/pg.js';

// Ensaio de restauração a partir de um backup "real": banco local + S3 falso (moto) como o bucket do R2. Um papel com nome único imita os papéis
// do Supabase (anon, authenticated…) citados nos GRANT/DEFAULT PRIVILEGES do schema public: ele NÃO existe no Postgres onde o ensaio restaura.
let ctx = null; const dbs = []; const dirs = [];
const PAPEL = `ctpub_papel_${crypto.randomBytes(4).toString('hex')}`;
const adm = (url) => postgres(url, { max: 1, onnotice: () => {} });

before(async () => {
  const { db, ops } = await setup(); await db.end(); await ops.end();
  const moto = await startMoto(); if (!moto) return;   // sem moto_server os testes deste arquivo são pulados explicitamente
  const src = await freshDb('rrsrc'); dbs.push(src);
  await migrate(src, { apiPassword: 'app_api_test', log: () => {} });
  const nome = new URL(src).pathname.slice(1); const opsSrc = createOpsDb({ url: withDatabase(OPS_URL, nome) });
  const objs = tmp('rrobjs'); dirs.push(objs); const seeded = await seedSmall(opsSrc, new FileStore(objs, { secure: false }), { files: 6 }); await opsSrc.end();
  const a = adm(src);
  try {
    await a.unsafe(`create role ${PAPEL} nologin`);
    await a.unsafe(`alter default privileges for role ${new URL(src).username} in schema public grant select on tables to ${PAPEL}`);
    await a.unsafe(`grant select on public.schema_migrations to ${PAPEL}`);
  } finally { await a.end(); }
  await makeBucket(moto.endpoint, 'canteiro-backup');
  const key = newKey();
  const env = { ...process.env, DATABASE_ADMIN_URL: src, BACKUP_TARGET: 's3://canteiro-backup/producao', BACKUP_S3_ENDPOINT: moto.endpoint, BACKUP_S3_REGION: 'auto', BACKUP_S3_ACCESS_KEY_ID: 'test', BACKUP_S3_SECRET_ACCESS_KEY: 'test',
    BACKUP_ENCRYPTION_KEY: key, BACKUP_ENV_NAME: 'production', STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: objs, PG_BIN_DIR: '' };
  const target = openTarget(env.BACKUP_TARGET, env); const keyring = keyringFromEnv(env);
  const bk = await backupDb({ env, target, keyring }); await backupObjects({ env, target, keyring });
  // o papel some do cluster antes da restauração (como num Postgres puro)
  const b = adm(src); try { await b.unsafe(`drop owned by ${PAPEL}`); await b.unsafe(`drop role ${PAPEL}`); } finally { await b.end(); }
  ctx = { moto, src, env, target, keyring, key, bk, seeded };
});
after(async () => {
  for (const u of dbs) await dropDb(u).catch(() => {});
  const a = adm(ADMIN_URL); try { await a.unsafe(`drop role if exists ${PAPEL}`); } finally { await a.end(); }
  for (const d of dirs) rmrf(d); if (ctx?.moto) await ctx.moto.stop();
});
const pula = (t) => { if (!ctx) { t.skip('moto_server não instalado neste ambiente'); return true; } return false; };
const envEnsaio = () => { const e = { ...ctx.env }; delete e.DATABASE_ADMIN_URL; delete e.STORAGE_LOCAL_DIR; return e; };

test('o dump cita o papel do "Supabase" e um Postgres puro o RECUSA sem criar os papéis (nada é aplicado: transação única)', async (t) => {
  if (pula(t)) return;
  const dst = await freshDb('rrsem'); dbs.push(dst);
  await assert.rejects(() => restoreDb({ env: envEnsaio(), target: ctx.target, keys: ctx.keyring.all, name: ctx.bk.name, toUrl: dst }), /pg_restore falhou|does not exist/);
  const s = adm(dst); try { const [r] = await s`select count(*)::int as n from pg_namespace where nspname = 'app'`; assert.equal(r.n, 0, 'nada aplicado'); } finally { await s.end(); }
});

test('ENSAIO completo aprovado: backup autêntico, papéis criados só no banco de ensaio, migrate --check, contagens, verify-deploy offline, amostra de arquivos', async (t) => {
  if (pula(t)) return;
  const dst = await freshDb('rrok'); dbs.push(dst); const logs = [];
  const rep = await ensaiar({ env: envEnsaio(), target: ctx.target, keys: ctx.keyring.all, toUrl: dst, amostraN: 4, log: (m) => logs.push(m) });
  assert.equal(rep.ok, true, rep.problemas.join(' | '));
  assert.equal(rep.backup, ctx.bk.name); assert.ok(rep.idadeHoras < 1); assert.equal(rep.ambiente, 'production');
  assert.ok(rep.restauracao.papeisCriados.includes(PAPEL), `papéis criados: ${rep.restauracao.papeisCriados}`);
  assert.equal(rep.restauracao.migrateCheck, true); assert.deepEqual(rep.restauracao.diferencas, []); assert.equal(rep.restauracao.contagens['app.assets'], 6);
  assert.deepEqual(rep.verifyDeploy.filter((c) => c.status === 'fail'), []); assert.ok(rep.verifyDeploy.some((c) => c.id === 'migrations_table' && c.status === 'ok'), 'o controle de migrações volta fechado');
  assert.equal(rep.arquivos.referenciados, 6); assert.equal(rep.arquivos.amostra, 4); assert.equal(rep.arquivos.ok, 4);
  assert.equal(rep.auth.presente, false); assert.ok(rep.avisos.some((a) => /BACKUP_INCLUDE_AUTH/.test(a)));
  const md = relatorioMarkdown(rep); assert.match(md, /Resultado: APROVADO/); assert.match(md, /Amostra de arquivos/);
  for (const s of [ctx.key, 'test']) assert.ok(!md.includes(ctx.key) && !JSON.stringify(rep).includes(ctx.key), s);
  // a restauração devolve o controle de migrações FECHADO e com RLS (PUB-05)
  const s = adm(dst); try { const [r] = await s`select relrowsecurity as rls from pg_class where oid = 'public.schema_migrations'::regclass`; assert.equal(r.rls, true); const [p] = await s`select has_table_privilege('app_api', 'public.schema_migrations', 'SELECT') as tem`; assert.equal(p.tem, false); } finally { await s.end(); }
});

test('arquivo adulterado no espelho cifrado e chave errada: o ensaio é REPROVADO com o motivo (e o banco não é tocado com a chave errada)', async (t) => {
  if (pula(t)) return;
  const sha = ctx.seeded.shas[0]; const chave = `${OBJ_PREFIX}${keyOfSha(sha)}.enc`;
  const chunks = []; for await (const c of await ctx.target.get(chave)) chunks.push(c); const original = Buffer.concat(chunks);
  try {
    await ctx.target.put(chave, await encryptBuffer(parseKey(ctx.key), Buffer.from('conteúdo trocado')));
    const dst = await freshDb('rrcor'); dbs.push(dst);
    const rep = await ensaiar({ env: envEnsaio(), target: ctx.target, keys: ctx.keyring.all, toUrl: dst, amostraN: 50 });
    assert.equal(rep.ok, false); assert.deepEqual(rep.arquivos.corrompidos, [sha]); assert.match(rep.problemas.join(' '), /1 corrompido/); assert.match(relatorioMarkdown(rep), /REPROVADO/);
  } finally { await ctx.target.put(chave, original); }
  const dst2 = await freshDb('rrkey'); dbs.push(dst2);
  const rep2 = await ensaiar({ env: envEnsaio(), target: ctx.target, keys: [parseKey(newKey())], toUrl: dst2 });
  assert.equal(rep2.ok, false); assert.match(rep2.problemas.join(' '), /MAC inválido|chave/);
  const s = adm(dst2); try { const [r] = await s`select count(*)::int as n from pg_namespace where nspname = 'app'`; assert.equal(r.n, 0); } finally { await s.end(); }
  await assert.rejects(() => ensaiar({ env: envEnsaio(), target: ctx.target, keys: ctx.keyring.all, toUrl: 'postgres://postgres:x@db.exemplo.invalid:5432/postgres' }), /só restaura em Postgres LOCAL/);
});

test('amostra determinística, conferência de arquivos e CLI "info" (versão do Postgres para subir o container certo)', async (t) => {
  if (pula(t)) return;
  const itens = Array.from({ length: 20 }, (_, i) => ({ sha256: crypto.createHash('sha256').update(String(i)).digest('hex'), size: 1 }));
  assert.deepEqual(amostra(itens, 5, 'b1'), amostra(itens, 5, 'b1')); assert.notDeepEqual(amostra(itens, 5, 'b1'), amostra(itens, 5, 'b2')); assert.equal(amostra(itens, 50, 'x').length, 20);
  const vazio = await conferirArquivos({ target: new FileStore(tmp('rrvazio')), keys: ctx.keyring.all, items: itens.slice(0, 2) }); assert.equal(vazio.missing.length, 2); assert.equal(vazio.pass, false);
  const b = await escolherBackup({ target: ctx.target, keys: ctx.keyring.all }); assert.equal(b.name, ctx.bk.name); assert.equal(b.pgMajor, Number((await (async () => { const s = adm(ADMIN_URL); try { return (await s`select current_setting('server_version_num')::int / 10000 as v`)[0].v; } finally { await s.end(); } })())));
  const { spawn } = await import('node:child_process'); const d = tmp('rrcli'); dirs.push(d); const out = path.join(d, 'out');
  const r = await new Promise((resolve) => { const p = spawn(process.execPath, ['tools/restore-rehearsal.js', 'info', '--github-output', out], { cwd: new URL('../..', import.meta.url).pathname, env: { PATH: process.env.PATH, BACKUP_TARGET: ctx.env.BACKUP_TARGET, BACKUP_S3_ENDPOINT: ctx.env.BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID: 'test', BACKUP_S3_SECRET_ACCESS_KEY: 'test', BACKUP_ENCRYPTION_KEY: ctx.key } }); let e = ''; p.stderr.on('data', (x) => { e += x; }); p.on('exit', (code) => resolve({ code, e })); });
  assert.equal(r.code, 0, r.e); const txt = fs.readFileSync(out, 'utf8'); assert.match(txt, new RegExp(`^nome=${ctx.bk.name}$`, 'm')); assert.match(txt, /^pg_major=\d+$/m); assert.match(txt, /^tem_auth=false$/m); assert.ok(!r.e.includes(ctx.key));
});
