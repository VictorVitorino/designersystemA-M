import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import http from 'node:http';
import crypto from 'node:crypto';
import { setup, ADMIN_URL, tmp, rmrf } from './_helpers.js';
import { runChecks, checkApiEnv, parseEnvNames, checkSite, checkDist, checkStorage, checkDataApi, checkPublishedBuild, checkAuthSettings, cspDoVercelJson, shaDaParidade, resumoMarkdown } from '../../tools/verify-deploy.js';

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
  for (const id of ['rls', 'grants', 'roles', 'definers', 'guards', 'migrations', 'migrations_table']) assert.equal(only(res, id).status, 'ok', id);
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
  // PUB-05: o controle de migrações precisa ficar fechado (no Supabase ele herdaria ALL para anon/authenticated)
  ['controle de migrações com RLS desligada', ['alter table public.schema_migrations disable row level security'], 'migrations_table', /RLS DESLIGADA/],
  ['controle de migrações com SELECT para PUBLIC', ['grant select on public.schema_migrations to public'], 'migrations_table', /SELECT para PUBLIC/],
  ['controle de migrações acessível ao app_api', ['grant select, delete on public.schema_migrations to app_api'], 'migrations_table', /app_api tem privilégio/],
  ['controle de migrações acessível ao anon (privilégio padrão do Supabase)', ['create role anon nologin', 'grant all on public.schema_migrations to anon'], 'migrations_table', /anon tem privilégio/],
  ['controle de migrações acessível ao app_ops por herança', ['grant select on public.schema_migrations to app_system'], 'migrations_table', /app_(ops|system) tem privilégio/],
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

const CSP_PAG = "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const CSP_EDITOR = "script-src 'sha256-ozeIFqvECu3ddscxfG9mnsic+j/vjktEOiKZHkFagRc=' 'strict-dynamic'; default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const H = { 'strict-transport-security': 'max-age=63072000; includeSubDomains', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP_PAG, 'referrer-policy': 'same-origin', 'content-type': 'text/html; charset=utf-8' };
/** Site falso no formato da Vercel: páginas com CSP estrita, editor/visualizador por reescrita com CSP por hash, 404 para o resto. */
function fakeSite(over = {}) {
  return async (url, init = {}) => {
    const u = new URL(url); const p = u.pathname; const o = over[p] || (p.startsWith('/editor/') && over['/editor/*']); if (o) return typeof o === 'function' ? o(url, init) : o;
    if (u.protocol === 'http:') return new Response('', { status: 308, headers: { location: `https://${u.host}/` } });
    if (p === '/api/health') return Response.json({ ok: true, version: '1.0', env: 'production' }, { headers: H });
    if (p === '/api/ready') return Response.json({ db: true, storage: true, auth: true, migrations: true });
    if (p === '/api/auth/session') { const h = new Headers(); h.append('set-cookie', '__Host-am_csrf=abc; Path=/; Secure; SameSite=Lax'); return new Response('{}', { headers: h }); }
    if (p.startsWith('/api/')) return new Response('{}', { status: 401 });
    if (/^\/(editor|visualizar)\/[^/]+$/.test(p)) return new Response('<html>editor', { status: 200, headers: { ...H, 'content-security-policy': CSP_EDITOR } });
    if (['/', '/entrar', '/acervo', '/admin'].includes(p)) return new Response('<html>', { status: 200, headers: H });
    return new Response('<html>404', { status: 404, headers: H });
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
test('site (PUB-09): editor sem a reescrita, página sem CSP estrita e rota inexistente com 200 FALHAM; bypass da Vercel vai em TODAS as requisições', async () => {
  const bad = await checkSite('https://canteiro.exemplo.com.br', { fetchImpl: fakeSite({
    '/editor/*': () => new Response('não encontrado', { status: 404, headers: H }),
    '/acervo': () => new Response('<html>', { status: 200, headers: { ...H, 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'" } }),
  }) });
  const pg = bad.find((r) => r.id === 'site_pages'); assert.equal(pg.status, 'fail'); const t = pg.items.join(' | ');
  assert.match(t, /\/editor\/00000000-0000-4000-8000-000000000000: HTTP 404/); assert.match(t, /\/acervo: CSP sem script-src 'self' estrito/);
  const sem404 = await checkSite('https://canteiro.exemplo.com.br', { fetchImpl: async (u, i) => (new URL(u).pathname.startsWith('/rota-que-nao-existe') ? new Response('<html>', { status: 200, headers: H }) : fakeSite()(u, i)) });
  assert.match(sem404.find((r) => r.id === 'site_pages').items.join(' '), /rota inexistente respondeu HTTP 200/);
  const editorSemHash = await checkSite('https://canteiro.exemplo.com.br', { fetchImpl: fakeSite({ '/editor/*': () => new Response('<html>', { status: 200, headers: { ...H, 'content-security-policy': "script-src 'self'" } }) }) });
  assert.match(editorSemHash.find((r) => r.id === 'site_pages').items.join(' '), /strict-dynamic/);
  // atrás da proteção da Vercel: sem o segredo, 401 em tudo; com o segredo (cabeçalho x-vercel-protection-bypass), passa
  const SEGREDO = 'bypass-' + crypto.randomBytes(12).toString('hex'); const vistos = [];
  const protegido = async (u, i = {}) => { const h = new Headers(i.headers || {}); vistos.push(h.get('x-vercel-protection-bypass')); return h.get('x-vercel-protection-bypass') === SEGREDO ? fakeSite()(u, i) : new Response('Vercel Authentication', { status: 401 }); };
  const semSegredo = await checkSite('https://staging.canteiro.exemplo.com.br', { fetchImpl: protegido }); assert.ok(semSegredo.some((r) => r.status === 'fail'));
  vistos.length = 0; const comSegredo = await checkSite('https://staging.canteiro.exemplo.com.br', { fetchImpl: protegido, bypass: SEGREDO });
  assert.deepEqual(comSegredo.filter((r) => r.status !== 'ok').map((r) => r.id), []); assert.ok(vistos.length > 10 && vistos.every((v) => v === SEGREDO), 'o cabeçalho vai em todas as requisições');
  const res = await runChecks({ env: { VERCEL_AUTOMATION_BYPASS_SECRET: SEGREDO }, url: 'https://staging.canteiro.exemplo.com.br', fetchImpl: protegido }); assert.deepEqual(res.filter((r) => r.status !== 'ok').map((r) => r.id), []);
  assert.ok(!resumoMarkdown(res, { titulo: 'x' }).includes(SEGREDO));
});

test('login do Supabase visto de fora: cadastro aberto ligado, login por e-mail desligado e chave recusada FALHAM; chave nova vai só no apikey', async () => {
  const env = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_' + 'k'.repeat(24) }; let cab;
  const resp = (j, st = 200) => async (u, i) => { cab = new Headers(i.headers); assert.equal(new URL(u).pathname, '/auth/v1/settings'); return Response.json(j, { status: st }); };
  assert.equal((await checkAuthSettings({ env, fetchImpl: resp({ disable_signup: true, external: { email: true, phone: false } }) })).status, 'ok');
  assert.equal(cab.get('apikey'), env.SUPABASE_ANON_KEY); assert.equal(cab.get('authorization'), null, 'chave sb_ nunca vai como Bearer');
  const aberto = await checkAuthSettings({ env, fetchImpl: resp({ disable_signup: false, external: { email: true } }) }); assert.equal(aberto.status, 'fail'); assert.match(aberto.items.join(' '), /CADASTRO ABERTO/);
  assert.match((await checkAuthSettings({ env, fetchImpl: resp({ disable_signup: true, external: { email: false } }) })).items.join(' '), /login por e-mail está DESLIGADO/);
  assert.equal((await checkAuthSettings({ env, fetchImpl: resp({ message: 'Invalid API key' }, 401) })).status, 'fail');
  assert.equal((await checkAuthSettings({ env, fetchImpl: async () => { throw new Error('ENOTFOUND'); } })).status, 'warn');
  // entra no runChecks só fora do --offline e com URL + chave
  assert.ok(!(await runChecks({ env, offline: true })).some((r) => r.id === 'auth_settings'));
});

/** Servidor HTTP local que imita a Vercel: cleanUrls (/x/index.html → 308 /x), reescrita /editor/:id, CSP por rota, proteção opcional. */
async function vercelFalsa({ arquivos, cspEditor, cspVisualizar, cspPadrao = CSP_PAG, protecao = null, versoes = null }) {
  let n = 0;
  const srv = http.createServer((req, res) => {
    n++; const u = new URL(req.url, 'http://x'); const p = u.pathname;
    if (protecao && req.headers['x-vercel-protection-bypass'] !== protecao) { res.writeHead(401, { 'content-type': 'text/html' }); return res.end('Vercel Authentication'); }
    const corpo = (pag) => (versoes ? versoes(pag, n) : arquivos[pag]);
    let m;
    if ((m = /^\/(editor|visualizar)\/index\.html$/.exec(p))) { res.writeHead(308, { location: `/${m[1]}` }); return res.end(); }
    if ((m = /^\/(editor|visualizar)$/.exec(p))) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': cspPadrao }); return res.end(corpo(m[1])); }
    if ((m = /^\/(editor|visualizar)\/[^/]+$/.exec(p))) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': m[1] === 'editor' ? cspEditor : cspVisualizar }); return res.end(corpo(m[1])); }
    if (p === '/api/health') { res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }); return res.end(JSON.stringify({ ok: true, env: 'staging', version: 't' })); }
    if (p === '/api/ready') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ db: true, storage: true, auth: true, migrations: true })); }
    if (p === '/api/auth/session') { res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'am_csrf=1; Path=/; SameSite=Lax' }); return res.end('{}'); }
    if (p.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (['/', '/entrar', '/acervo', '/admin'].includes(p)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': cspPadrao, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' }); return res.end('<html>'); }
    res.writeHead(404, { 'content-type': 'text/html' }); res.end('404');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, fechar: () => new Promise((r) => srv.close(r)), pedidos: () => n };
}
function buildFalso(html = '<!doctype html><html><script>/*editor*/</script></html>') {
  const d = tmp('build'); for (const pag of ['editor', 'visualizar']) { fs.mkdirSync(path.join(d, pag), { recursive: true }); fs.writeFileSync(path.join(d, pag, 'index.html'), html); }
  const vj = path.join(d, 'vercel.json');
  fs.writeFileSync(vj, JSON.stringify({ headers: [{ source: '/((?!api/|editor/|visualizar/).*)', headers: [{ key: 'Content-Security-Policy', value: CSP_PAG }] }, { source: '/editor/(.*)', headers: [{ key: 'Content-Security-Policy', value: CSP_EDITOR }] }, { source: '/visualizar/(.*)', headers: [{ key: 'Content-Security-Policy', value: CSP_EDITOR + "; worker-src 'self'" }] }] }));
  return { dir: d, html: Buffer.from(html), vj, sha: crypto.createHash('sha256').update(html).digest('hex') };
}

test('PÓS-PUBLICAÇÃO (2e): HTML publicado byte a byte = build (SHA-256) e CSP publicada = vercel.json; divergência REPROVA', async () => {
  const b = buildFalso(); const vj = JSON.parse(fs.readFileSync(b.vj, 'utf8'));
  assert.equal(cspDoVercelJson(vj, '/editor/(.*)'), CSP_EDITOR);
  const certo = await vercelFalsa({ arquivos: { editor: b.html, visualizar: b.html }, cspEditor: CSP_EDITOR, cspVisualizar: CSP_EDITOR + "; worker-src 'self'" });
  try {
    const r = await checkPublishedBuild(certo.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: null, tentativas: 1, esperaMs: 0 });
    assert.deepEqual(r.filter((x) => x.status !== 'ok').map((x) => `${x.id}: ${x.items.join(';')}`), []);
    for (const id of ['published_editor', 'published_visualizar', 'published_csp_editor', 'published_csp_visualizar']) assert.ok(r.some((x) => x.id === id && x.status === 'ok'), id);
    assert.match(r.find((x) => x.id === 'published_editor').detail, new RegExp(b.sha));
    // a prova de paridade registrada: mesmo build → ok; outro build → aviso (não reprova o deploy)
    const doc = path.join(b.dir, 'paridade.md');
    fs.writeFileSync(doc, `| B (candidato: editor em nuvem) | \`cloud-editor.html\` | \`${b.sha}\` |`); assert.equal(shaDaParidade(fs.readFileSync(doc, 'utf8')), b.sha);
    assert.equal((await checkPublishedBuild(certo.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: doc, tentativas: 1, esperaMs: 0 })).find((x) => x.id === 'parity_build').status, 'ok');
    fs.writeFileSync(doc, `| B (candidato: editor em nuvem) | \`cloud-editor.html\` | \`${'0'.repeat(64)}\` |`);
    assert.equal((await checkPublishedBuild(certo.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: doc, tentativas: 1, esperaMs: 0 })).find((x) => x.id === 'parity_build').status, 'warn');
    // duas cópias do build (.vercel/output/static e dist/public) precisam ser iguais
    const b2 = buildFalso('<html>outro</html>');
    const div = await checkPublishedBuild(certo.url, { buildDirs: [b.dir, b2.dir], vercelJsonPath: b.vj, parityDocPath: null, tentativas: 1, esperaMs: 0 }); assert.equal(div.find((x) => x.id === 'build_local').status, 'fail'); rmrf(b2.dir);
    assert.equal((await checkPublishedBuild(certo.url, { buildDirs: [path.join(b.dir, 'nao-existe')], tentativas: 1, esperaMs: 0 }))[0].status, 'fail');
  } finally { await certo.fechar(); }
  // um byte diferente no publicado → REPROVA, com os dois SHA-256 no detalhe
  const alterado = Buffer.concat([b.html, Buffer.from(' ')]);
  const errado = await vercelFalsa({ arquivos: { editor: alterado, visualizar: b.html }, cspEditor: CSP_EDITOR, cspVisualizar: CSP_EDITOR + "; worker-src 'self'" });
  try { const r = await checkPublishedBuild(errado.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: null, tentativas: 2, esperaMs: 10 }); const e = r.find((x) => x.id === 'published_editor'); assert.equal(e.status, 'fail'); assert.match(e.items.join(' '), new RegExp(`≠ build ${b.sha}`)); assert.equal(r.find((x) => x.id === 'published_visualizar').status, 'ok'); }
  finally { await errado.fechar(); }
  // CSP publicada diferente do vercel.json → REPROVA
  const csp = await vercelFalsa({ arquivos: { editor: b.html, visualizar: b.html }, cspEditor: CSP_EDITOR.replace("'strict-dynamic'", "'unsafe-inline'"), cspVisualizar: CSP_EDITOR + "; worker-src 'self'" });
  try { const r = await checkPublishedBuild(csp.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: null, tentativas: 1, esperaMs: 0 }); assert.equal(r.find((x) => x.id === 'published_csp_editor').status, 'fail'); assert.equal(r.find((x) => x.id === 'published_csp_visualizar').status, 'ok'); }
  finally { await csp.fechar(); }
  // troca de versão na borda: as primeiras respostas ainda são do deploy anterior → tenta de novo e passa
  const velho = Buffer.from('<html>versao anterior</html>');
  const borda = await vercelFalsa({ arquivos: {}, cspEditor: CSP_EDITOR, cspVisualizar: CSP_EDITOR + "; worker-src 'self'", versoes: (pag, n) => (n <= 6 ? velho : b.html) });
  try { const r = await checkPublishedBuild(borda.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: null, tentativas: 4, esperaMs: 5 }); assert.deepEqual(r.filter((x) => x.status !== 'ok').map((x) => x.id), []); }
  finally { await borda.fechar(); }
  // atrás da proteção da Vercel: 401 explica o motivo; com o segredo, passa
  const prot = await vercelFalsa({ arquivos: { editor: b.html, visualizar: b.html }, cspEditor: CSP_EDITOR, cspVisualizar: CSP_EDITOR + "; worker-src 'self'", protecao: 'segredo-bypass-teste' });
  try {
    const r = await checkPublishedBuild(prot.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: null, tentativas: 1, esperaMs: 0 }); assert.match(r.find((x) => x.id === 'published_editor').items.join(' '), /login da Vercel/);
    assert.deepEqual((await checkPublishedBuild(prot.url, { buildDirs: [b.dir], vercelJsonPath: b.vj, parityDocPath: null, tentativas: 1, esperaMs: 0, bypass: 'segredo-bypass-teste' })).filter((x) => x.status !== 'ok').map((x) => x.id), []);
  } finally { await prot.fechar(); }
  rmrf(b.dir);
});

test('CLI pós-publicação: --url + --expect-build termina 0 com tudo igual e 1 se o HTML publicado divergir; --expect-build sem --url é erro de uso', async () => {
  const { spawn, spawnSync } = await import('node:child_process'); const b = buildFalso(); const cwd = new URL('../..', import.meta.url).pathname;
  const roda = (url) => new Promise((resolve) => { const p = spawn(process.execPath, ['tools/verify-deploy.js', '--url', url, '--expect-build', `${path.join(b.dir, 'nao-existe')},${b.dir}`, '--vercel-json', b.vj, '--retries', '1', '--retry-delay', '0', '--json'], { cwd, env: { PATH: process.env.PATH } }); let out = '', err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; }); p.on('exit', (code) => resolve({ code, out, err })); });
  const ok = await vercelFalsa({ arquivos: { editor: b.html, visualizar: b.html }, cspEditor: CSP_EDITOR, cspVisualizar: CSP_EDITOR + "; worker-src 'self'" });
  try { const r = await roda(ok.url); assert.equal(r.code, 0, r.out + r.err); const j = JSON.parse(r.out); assert.ok(j.results.some((x) => x.id === 'published_editor' && x.status === 'ok')); assert.ok(j.results.some((x) => x.id === 'site_pages' && x.status === 'ok')); } finally { await ok.fechar(); }
  const ruim = await vercelFalsa({ arquivos: { editor: Buffer.from('<html>outro build</html>'), visualizar: b.html }, cspEditor: CSP_EDITOR, cspVisualizar: CSP_EDITOR + "; worker-src 'self'" });
  try { const r = await roda(ruim.url); assert.equal(r.code, 1); assert.ok(JSON.parse(r.out).results.some((x) => x.id === 'published_editor' && x.status === 'fail')); } finally { await ruim.fechar(); }
  const uso = spawnSync(process.execPath, ['tools/verify-deploy.js', '--expect-build', b.dir], { cwd, env: { PATH: process.env.PATH }, encoding: 'utf8' }); assert.equal(uso.status, 2); assert.match(uso.stderr, /--expect-build precisa de --url/);
  rmrf(b.dir);
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
