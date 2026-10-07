import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { setup, newKey, tmp, rmrf, freshDb, dropDb } from './_helpers.js';
import { migrate, lockSchemaMigrations } from '../../tools/migrate.js';
import { backupDb } from '../../tools/backup.js';
import { restoreDb } from '../../tools/restore.js';
import { checkMigrationsTable } from '../../tools/verify-deploy.js';
import { openTarget } from '../../tools/lib/targets.js';
import { keyringFromEnv } from '../../tools/lib/backup-crypto.js';

// PUB-05: o controle de migrações (public.schema_migrations) nasce FECHADO — RLS ligada e nenhum acesso para PUBLIC nem para os papéis
// da aplicação/Supabase — mesmo quando o schema public do banco tem privilégios padrão que dariam acesso a toda tabela nova (é o que o
// Supabase faz para anon/authenticated/service_role). Aqui o "Supabase" é imitado com ALTER DEFAULT PRIVILEGES para app_api e PUBLIC.
const dbs = []; const dirs = [];
const adm = (url) => postgres(url, { max: 1, onnotice: () => {} });
const API_PW = 'app_api_test';
const quieto = () => {};

/** Banco novo com os privilégios padrão "abertos" no schema public (como um projeto Supabase novo). */
async function bancoAberto(sufixo) {
  const url = await freshDb(sufixo); dbs.push(url); const s = adm(url);
  try {
    const dono = new URL(url).username;
    await s.unsafe(`alter default privileges for role ${dono} in schema public grant all on tables to app_api`);
    await s.unsafe(`alter default privileges for role ${dono} in schema public grant select on tables to public`);
  } finally { await s.end(); }
  return url;
}
async function estado(url) {
  const s = adm(url);
  try {
    const [t] = await s`select relrowsecurity as rls from pg_class where oid = 'public.schema_migrations'::regclass`;
    const [a] = await s`select has_table_privilege('app_api', 'public.schema_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as api`;
    const pub = await s`select a.privilege_type as p from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a where c.oid = 'public.schema_migrations'::regclass and a.grantee = 0`;
    const chk = await checkMigrationsTable(s);
    return { rls: t.rls, api: a.api, publico: pub.map((x) => x.p), check: chk };
  } finally { await s.end(); }
}

before(async () => { const { db, ops } = await setup(); await db.end(); await ops.end(); });
after(async () => { for (const u of dbs) await dropDb(u).catch(() => {}); for (const d of dirs) rmrf(d); });

test('o "Supabase" imitado é realista: sem a trava, uma tabela nova no schema public já nasce aberta para app_api e PUBLIC', async () => {
  const url = await bancoAberto('cmprova'); const s = adm(url);
  try {
    await s.unsafe('create table public.qualquer(x int)');
    const [r] = await s`select has_table_privilege('app_api', 'public.qualquer', 'DELETE') as api, has_table_privilege('public', 'public.qualquer', 'SELECT') as pub`;
    assert.deepEqual([r.api, r.pub], [true, true], 'os privilégios padrão dariam acesso — é o risco que a trava fecha');
  } finally { await s.end(); }
});

test('migrate num banco com privilégios padrão abertos: o controle de migrações sai FECHADO (RLS, sem PUBLIC, sem app_api) e o verify-deploy aprova', async () => {
  const url = await bancoAberto('cmnovo');
  await migrate(url, { apiPassword: API_PW, log: quieto });
  const e = await estado(url);
  assert.equal(e.rls, true); assert.equal(e.api, false); assert.deepEqual(e.publico, []);
  assert.equal(e.check.status, 'ok', JSON.stringify(e.check));
});

test('atualização: um controle antigo ABERTO (sem RLS, com GRANT) é fechado no próximo migrate, mesmo sem migração pendente', async () => {
  const url = await bancoAberto('cmantigo');
  await migrate(url, { apiPassword: API_PW, log: quieto });
  const s = adm(url);
  try { await s.unsafe('alter table public.schema_migrations disable row level security'); await s.unsafe('grant all on public.schema_migrations to app_api, public'); } finally { await s.end(); }
  const aberto = await estado(url);
  assert.equal(aberto.check.status, 'fail'); assert.ok(aberto.check.items.some((i) => /RLS DESLIGADA/.test(i)) && aberto.check.items.some((i) => /app_api tem privilégio/.test(i)) && aberto.check.items.some((i) => /para PUBLIC/.test(i)), JSON.stringify(aberto.check.items));
  const chk = await migrate(url, { check: true, log: quieto }); assert.equal(chk.ok, true, 'nada pendente');
  const s2 = adm(url); try { assert.equal((await checkMigrationsTable(s2)).status, 'fail', '--check só lê: não muda nada'); } finally { await s2.end(); }
  await migrate(url, { apiPassword: API_PW, log: quieto });
  const e = await estado(url); assert.equal(e.rls, true); assert.equal(e.api, false); assert.deepEqual(e.publico, []); assert.equal(e.check.status, 'ok');
  // idempotente: rodar a trava de novo não falha nem muda nada
  const s3 = adm(url); try { await lockSchemaMigrations(s3); await lockSchemaMigrations(s3); } finally { await s3.end(); }
  assert.equal((await estado(url)).check.status, 'ok');
});

test('backup + restauração num banco NOVO com privilégios padrão abertos: a tabela recriada volta FECHADA (o dump não revoga o que o destino concede)', async () => {
  const src = await bancoAberto('cmsrc'); await migrate(src, { apiPassword: API_PW, log: quieto });
  const bk = tmp('cmbk'); dirs.push(bk);
  const env = { ...process.env, DATABASE_ADMIN_URL: src, BACKUP_TARGET: `file://${bk}`, BACKUP_ENCRYPTION_KEY: newKey(), APP_ENV: 'test', PG_BIN_DIR: process.env.PG_BIN_DIR || '' };
  const target = openTarget(env.BACKUP_TARGET, env); const keyring = keyringFromEnv(env);
  const b = await backupDb({ env, target, keyring });
  const dst = await bancoAberto('cmdst');
  const rep = await restoreDb({ env: { ...env, DATABASE_ADMIN_URL: '' }, target, keys: keyring.all, name: b.name, toUrl: dst });
  assert.ok(rep.ok, JSON.stringify(rep).slice(0, 400));
  const e = await estado(dst);
  assert.equal(e.rls, true, 'a RLS volta com o dump'); assert.equal(e.api, false, 'o GRANT dos privilégios padrão do destino foi revogado'); assert.deepEqual(e.publico, []);
  assert.equal(e.check.status, 'ok', JSON.stringify(e.check));
  // o restante do esquema continua com os GRANTs do dump (a trava só mexe no controle de migrações)
  const s = adm(dst); try { const [r] = await s`select has_schema_privilege('app_api', 'app', 'USAGE') as uso`; assert.equal(r.uso, true); } finally { await s.end(); }
});
