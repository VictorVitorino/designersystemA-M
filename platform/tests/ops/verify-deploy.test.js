import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { setup, ADMIN_URL, tmp, rmrf } from './_helpers.js';
import { runChecks, checkApiEnv, parseEnvNames, checkSite, checkDist, checkStorage, checkDataApi } from '../../tools/verify-deploy.js';

let db, ops, admin; const ROLLBACK = Symbol('rollback');
before(async () => { ({ db, ops } = await setup()); admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} }); });
after(async () => { await db.end(); await ops.end(); await admin.end(); });
const ENV = { STORAGE_DRIVER: 'local' };

/** Aplica a má configuração dentro de uma transação, roda as verificações do banco e DESFAZ tudo. */
async function mutated(sqlText) {
  let res; try { await admin.begin(async (tx) => { for (const s of [].concat(sqlText)) await tx.unsafe(s); res = await runChecks({ sql: tx, env: ENV, offline: true }); throw ROLLBACK; }); } catch (e) { if (e !== ROLLBACK) throw e; }
  return res;
}
const failed = (res) => res.filter((r) => r.status === 'fail');
const only = (res, id) => res.find((r) => r.id === id);

test('configuração correta (migrações aplicadas): nenhuma falha', async () => {
  const res = await runChecks({ sql: admin, env: ENV, offline: true });
  assert.deepEqual(failed(res).map((r) => `${r.id}: ${r.items.join('; ')}`), []);
  for (const id of ['rls', 'grants', 'roles', 'definers', 'guards', 'migrations']) assert.equal(only(res, id).status, 'ok', id);
});

const CASES = [
  ['SELECT para PUBLIC numa tabela', ['grant select on app.users to public'], 'grants', /app\.users.*PUBLIC/],
  ['SELECT para anon numa tabela', ['create role anon nologin', 'grant select on app.presentations to anon'], 'grants', /presentations.*anon/],
  ['USAGE do schema para authenticated', ['create role authenticated nologin', 'grant usage on schema app to authenticated'], 'grants', /schema app.*authenticated/],
  ['permissão por coluna para PUBLIC', ['grant select (email) on app.users to public'], 'grants', /coluna app\.users\.email/],
  ['EXECUTE de função para PUBLIC', ['grant execute on function app.purge_expired() to public'], 'grants', /purge_expired.*PUBLIC/],
  ['privilégio padrão futuro para anon', ['create role anon nologin', 'alter default privileges for role app_owner in schema app grant select on tables to anon'], 'grants', /privilégio padrão/],
  ['RLS desligada numa tabela', ['alter table app.comments disable row level security'], 'rls', /app\.comments: RLS DESLIGADA/],
  ['política aberta para PUBLIC', ['create policy aberta on app.settings for select to public using (true)'], 'rls', /aberta.*PUBLIC/],
  ['tabela sem nenhuma política', ['drop policy sys_all on app.invites', 'drop policy invites_admin on app.invites'], 'rls', /invites.*sem nenhuma política/],
  ['app_api membro de app_system', ['grant app_system to app_api'], 'roles', /app_api é membro de app_system/],
  ['app_api membro de app_owner', ['grant app_owner to app_api'], 'roles', /app_api é membro de app_owner/],
  ['app_api com BYPASSRLS', ['alter role app_api bypassrls'], 'roles', /app_api tem BYPASSRLS/],
  ['app_api com SELECT direto em tabela', ['grant select on app.users to app_api'], 'roles', /acesso direto à tabela app\.users/],
  ['app_system com BYPASSRLS', ['alter role app_system bypassrls'], 'roles', /app_system tem BYPASSRLS/],
  ['SECURITY DEFINER sem search_path', ['create function app.evil() returns int language sql security definer as $$ select 1 $$'], 'definers', /evil.*search_path/],
  ['search_path removido de função existente', ['alter function app.is_admin() reset all'], 'definers', /is_admin.*search_path/],
  ['SECURITY DEFINER de dono superusuário', ['create function app.root_fn() returns int language sql security definer set search_path = pg_catalog as $$ select 1 $$', 'alter function app.root_fn() owner to postgres'], 'definers', /root_fn.*superuser/],
  ['gatilho da auditoria removido', ['drop trigger audit_no_update on app.audit_log'], 'guards', /audit_no_update/],
  ['migração alterada depois de aplicada (checksum)', ["update public.schema_migrations set checksum = 'adulterado' where version = '0002'"], 'migrations', /DIVERGENTE: 0002/],
  ['migração pendente', ["delete from public.schema_migrations where version = '0003'"], 'migrations', /pendente: 0003/],
  ['schema app exposto na Data API', ['create role authenticator nologin', "alter role authenticator set pgrst.db_schemas = 'public,app'"], 'data_api', /exposto/],
];
for (const [name, sqls, id, re] of CASES) {
  test(`DETECTA: ${name}`, async () => {
    const res = await mutated(sqls); const r = only(res, id);
    assert.equal(r.status, 'fail', `${id} deveria falhar: ${JSON.stringify(r)}`); assert.match([r.detail, ...r.items].join(' | '), re);
    // as demais verificações que não têm relação continuam funcionando (e o banco real não foi alterado)
  });
}
test('Data API: schemas expostos sem "app" passam; sem a configuração, avisa; roles criados nas transações não vazam', async () => {
  assert.equal(only(await mutated(['create role authenticator nologin', "alter role authenticator set pgrst.db_schemas = 'public,storage'"]), 'data_api').status, 'ok');
  assert.equal(only(await mutated(['create role authenticator nologin']), 'data_api').status, 'warn');
  const [{ n }] = await admin`select count(*)::int as n from pg_roles where rolname in ('anon','authenticated','authenticator')`; assert.equal(n, 0);
  const res = await runChecks({ sql: admin, env: ENV, offline: true }); assert.deepEqual(failed(res), []);
});
test('Data API: sonda HTTP com a chave anônima — 200 é falha, 4xx é bloqueio', async () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key-123456' };
  const f200 = async () => new Response('[]', { status: 200 }), f406 = async () => new Response('{"code":"PGRST106"}', { status: 406 });
  assert.equal((await checkDataApi(admin, { env, fetchImpl: f200 })).status, 'fail'); assert.equal((await checkDataApi(admin, { env, fetchImpl: f406 })).status, 'skip');
});

test('arquivos: pasta local acessível a "outros" gera aviso; S3 com leitura anônima possível FALHA; bloqueada passa; bucket público pela API FALHA', async () => {
  const d = tmp('st'); try {
    fs.chmodSync(d, 0o777); assert.equal((await checkStorage(admin, { env: { STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: d } })).status, 'warn'); fs.chmodSync(d, 0o750); assert.equal((await checkStorage(admin, { env: { STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: d } })).status, 'ok');
  } finally { rmrf(d); }
  const sha = 'ab'.repeat(32); const [u] = await ops.asSystem((tx) => tx`insert into app.users(email, display_name, role, status) values ('v@am.test', 'V', 'admin', 'active') returning id`);
  await ops.asSystem((tx) => tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by) values (${sha}, 5, 'image/png', 'image', 'ready', ${u.id})`);
  const env = { STORAGE_DRIVER: 's3', S3_BUCKET: 'arq', S3_ENDPOINT: 'https://s3.exemplo.com', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK', SUPABASE_URL: 'https://x.supabase.co' };
  const sdkOk = { send: async () => { throw Object.assign(new Error('NotImplemented'), { name: 'NotImplemented' }); } };
  const mkS3 = (client) => () => ({ bucket: 'arq', _sdk: async () => ({ S3: new Proxy({}, { get: (_, k) => class { constructor(a) { this.a = a; this.k = k; } } }), c: client }) });
  const seen = []; const pub = async (u) => { seen.push(u); return new Response('IMG', { status: 200 }); }, priv = async () => new Response('denied', { status: 403 });
  const bad = await checkStorage(admin, { env, fetchImpl: pub, s3Factory: mkS3(sdkOk) }); assert.equal(bad.status, 'fail'); assert.match(bad.items.join(' '), /LEITURA ANÔNIMA POSSÍVEL/);
  assert.ok(seen.some((x) => x.includes('/storage/v1/object/public/arq/a/ab/ab/')), 'testa também a URL pública do Supabase Storage'); assert.ok(seen.some((x) => x.startsWith('https://s3.exemplo.com/arq/a/ab/ab/' + sha)));
  assert.equal((await checkStorage(admin, { env, fetchImpl: priv, s3Factory: mkS3(sdkOk) })).status, 'ok');
  const policyPublic = { send: async (cmd) => { if (cmd.k === 'GetBucketPolicyStatusCommand') return { PolicyStatus: { IsPublic: true } }; throw Object.assign(new Error('x'), { name: 'NotImplemented' }); } };
  assert.equal((await checkStorage(admin, { env, fetchImpl: priv, s3Factory: mkS3(policyPublic) })).status, 'fail');
  const aclPublic = { send: async (cmd) => { if (cmd.k === 'GetBucketAclCommand') return { Grants: [{ Permission: 'READ', Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' } }] }; throw Object.assign(new Error('x'), { name: 'NotImplemented' }); } };
  assert.equal((await checkStorage(admin, { env, fetchImpl: priv, s3Factory: mkS3(aclPublic) })).status, 'fail');
});

test('ambiente da API: variáveis proibidas, fake do GoTrue e nomes públicos com segredo', () => {
  const ok = checkApiEnv(parseEnvNames('# comentário\nAPP_ENV=production\nDATABASE_URL=postgres://x\nSUPABASE_SERVICE_ROLE_KEY=abc\nSTORAGE_DRIVER=s3\nAPP_ORIGIN=https://canteiro.exemplo.com.br\n'), { expectEnv: 'production' });
  assert.equal(ok.status, 'ok');
  const bad = checkApiEnv(parseEnvNames('APP_ENV=staging\nDATABASE_ADMIN_URL=x\nDATABASE_OPS_URL=y\nBACKUP_ENCRYPTION_KEY=z\nGOTRUE_FAKE=1\nSTORAGE_DRIVER=local\nNEXT_PUBLIC_SERVICE_ROLE_KEY=k\nAPP_ORIGIN=http://x'), { expectEnv: 'production' });
  assert.equal(bad.status, 'fail'); const t = bad.items.join('\n');
  for (const re of [/DATABASE_ADMIN_URL NÃO pode/, /DATABASE_OPS_URL NÃO pode/, /BACKUP_ENCRYPTION_KEY NÃO pode/, /GOTRUE_FAKE/, /APP_ENV=staging/, /STORAGE_DRIVER=local/, /NEXT_PUBLIC_SERVICE_ROLE_KEY/, /APP_ORIGIN não é https/]) assert.match(t, re);
  assert.ok(!t.includes('postgres://'), 'valores nunca são impressos');
});

const H = { 'strict-transport-security': 'max-age=63072000; includeSubDomains', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'referrer-policy': 'same-origin' };
function fakeSite(over = {}) {
  return async (url, init = {}) => {
    const u = new URL(url); const p = u.pathname; const o = over[p]; if (o) return typeof o === 'function' ? o(url, init) : o;
    if (u.protocol === 'http:') return new Response('', { status: 308, headers: { location: `https://${u.host}/` } });
    if (p === '/api/health') return Response.json({ ok: true, version: '1.0', env: 'production' }, { headers: H });
    if (p === '/api/ready') return Response.json({ db: true, storage: true, auth: true, migrations: true });
    if (p === '/api/auth/session') { const h = new Headers(); h.append('set-cookie', '__Host-am_csrf=abc; Path=/; Secure; SameSite=Lax'); return new Response('{}', { headers: h }); }
    if (p.startsWith('/api/')) return new Response('{}', { status: 401 });
    return new Response('<html>', { status: 200, headers: H });
  };
}
test('site: tudo certo passa; sem HSTS/CSP, sem 401, banco fora, cookie sem Secure e CORS aberto FALHAM', async () => {
  const good = await checkSite('https://canteiro.exemplo.com.br', { fetchImpl: fakeSite(), expectEnv: 'production' }); assert.deepEqual(good.filter((r) => r.status !== 'ok'), []);
  const naked = new Response('<html>', { status: 200, headers: { 'x-powered-by': 'Express' } });
  const bad = await checkSite('https://canteiro.exemplo.com.br', { expectEnv: 'production', fetchImpl: fakeSite({
    '/': () => naked.clone(), '/api/ready': Response.json({ db: false, storage: true }, { status: 503 }), '/api/presentations': new Response('[]', { status: 200 }),
    '/api/auth/session': () => { const h = new Headers(); h.append('set-cookie', 'am_csrf=1; Path=/'); return new Response('{}', { headers: h }); },
    '/api/health': (u, i) => Response.json({ ok: true, env: 'staging' }, { headers: { 'access-control-allow-origin': i.headers?.Origin ? '*' : '' } }) }) });
  const ids = bad.filter((r) => r.status === 'fail').map((r) => r.id); for (const id of ['site_ready', 'site_headers', 'site_auth', 'site_cookies', 'site_env', 'site_cors']) assert.ok(ids.includes(id), `${id} deveria falhar: ${ids}`);
  const noHttps = await checkSite('https://canteiro.exemplo.com.br', { fetchImpl: fakeSite({ '/': (u) => (u.startsWith('http:') ? new Response('x', { status: 200 }) : new Response('<html>', { headers: H })) }) }); assert.ok(noHttps.find((r) => r.id === 'site_https').status === 'fail');
  const down = await checkSite('https://x.exemplo.com.br', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }); assert.equal(down[0].status, 'fail');
});
test('build do site: segredo no que vai para o navegador FALHA', () => {
  const d = tmp('dist'); try {
    fs.writeFileSync(path.join(d, 'app.js'), 'console.log("ok")'); assert.equal(checkDist(d).status, 'ok');
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase', exp: 2e9 })).toString('base64url'), 'x'.repeat(43)].join('.');
    fs.writeFileSync(path.join(d, 'cfg.js'), `window.KEY="${jwt}"`); const r = checkDist(d); assert.equal(r.status, 'fail'); assert.match(r.items.join(' '), /supabase-service-role-jwt/);
    assert.equal(checkDist(path.join(d, 'nao-existe')).status, 'fail');
  } finally { rmrf(d); }
});
test('CLI: sai com código 1 e lista o problema quando o banco está mal configurado', async () => {
  const { spawnSync } = await import('node:child_process'); const env = { PATH: process.env.PATH, DATABASE_ADMIN_URL: ADMIN_URL, STORAGE_DRIVER: 'local' };
  await admin.unsafe('grant select on app.users to public');
  try {
    const r = spawnSync(process.execPath, ['tools/verify-deploy.js', '--offline'], { env, encoding: 'utf8', cwd: new URL('../..', import.meta.url).pathname }); assert.equal(r.status, 1); assert.match(r.stderr, /FALHOU\s+Nenhuma permissão/); assert.match(r.stderr, /app\.users: SELECT para PUBLIC/);
  } finally { await admin.unsafe('revoke select on app.users from public'); }
  const ok = spawnSync(process.execPath, ['tools/verify-deploy.js', '--offline', '--json'], { env, encoding: 'utf8', cwd: new URL('../..', import.meta.url).pathname }); assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).ok, true);
});
