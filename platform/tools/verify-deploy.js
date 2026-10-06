#!/usr/bin/env node
/* tools/verify-deploy.js — confere, de forma AUTOMÁTICA, que o ambiente está configurado do jeito seguro. Falha (exit 1) com a lista clara do que está errado.
   Rode: depois do migrate (no CI, antes e depois de publicar), depois de restaurar um backup e sempre que mexer em permissões.

   Uso:
     DATABASE_OPS_URL=… (ou DATABASE_ADMIN_URL=…) node tools/verify-deploy.js [--url https://canteiro.exemplo.com.br] [--api-env-file lista.txt]
                                                      [--scan-dist dist/public] [--expect-env production] [--offline] [--strict] [--json]
   Verificações do BANCO (sempre): RLS ligada em todas as tabelas do schema app · nenhuma permissão para PUBLIC/anon/authenticated (schema, tabelas, colunas,
     sequências, funções, privilégios padrão) · políticas nunca para PUBLIC · papéis (app_api sem superuser/BYPASSRLS e sem pertença a app_system/app_owner;
     app_user/app_system sem BYPASSRLS) · funções SECURITY DEFINER com search_path fixo e dono sem superpoderes · gatilhos de proteção presentes ·
     migrações aplicadas sem divergência de checksum · Data API (schema app fora de pgrst.db_schemas) · conexão com TLS.
   Verificações de ARQUIVOS: bucket/prefixo privado (consulta à API do S3 quando permitida + tentativa ANÔNIMA de leitura de um arquivo real); pasta local sem acesso de "outros".
   Verificações do AMBIENTE DA API (--api-env-file: lista de NOMES de variáveis do projeto na Vercel, uma por linha ou NOME=valor; valores nunca são impressos):
     variáveis proibidas ausentes (DATABASE_ADMIN_URL, DATABASE_OPS_URL, BACKUP_*…), GOTRUE_FAKE desligado, nada sensível exposto com prefixo público.
   Verificações do SITE (--url): HTTPS/HSTS, cabeçalhos de segurança, /api/health e /api/ready, rotas protegidas respondem 401, cookies __Host- com Secure.
   --scan-dist: procura segredos no build do site (o que vai para o navegador). */
import fs from 'node:fs';
import path from 'node:path';
import { buildRedactor, parseArgs, runCli, isMain, ToolError } from './lib/common.js';
import { connect } from './lib/pg.js';
import { openPrimaryStore, S3Store } from './lib/targets.js';
import { keyOfSha } from './lib/mirror.js';
import { listMigrations } from './migrate.js';
import { scanTree } from './secret-scan.js';

const BAD_GRANTEES = new Set(['PUBLIC', 'anon', 'authenticated']);
export const FORBIDDEN_API_ENV = [/^DATABASE_ADMIN_URL$/, /^DATABASE_OPS_URL$/, /^APP_API_DB_PASSWORD$/, /^APP_OPS_DB_PASSWORD$/, /^BACKUP_/, /^VERCEL_TOKEN$/, /^SUPABASE_DB_PASSWORD$/, /^SUPABASE_ACCESS_TOKEN$/, /^GITHUB_TOKEN$/, /^TEST_DATABASE_/];
const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_)/;
const SECRETY = /(SERVICE|SECRET|PASSWORD|PRIVATE|ADMIN|JWT|TOKEN)/i;
const mk = (id, title, status, detail = '', items = []) => ({ id, title, status, detail, items });
const grantee = (g) => (g === 0 || g === '0' ? 'PUBLIC' : String(g));

// -------------------------------------------------------------------------------------------------------------------- banco
export async function checkRls(sql) {
  const t = await sql`select c.relname, c.relrowsecurity as rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind in ('r','p') order by 1`;
  if (!t.length) return mk('rls', 'RLS ligada em todas as tabelas do schema app', 'fail', 'o schema app não tem tabelas (migrações não aplicadas?)');
  const off = t.filter((x) => !x.rls).map((x) => `app.${x.relname}: RLS DESLIGADA`);
  const noPol = t.filter((x) => x.rls && x.policies === 0).map((x) => `app.${x.relname}: sem nenhuma política (nem o papel de sistema acessa)`);
  const pub = await sql`select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and (0 = any(p.polroles) or exists (select 1 from pg_roles r where r.oid = any(p.polroles) and r.rolname in ('anon','authenticated')))`;
  const items = [...off, ...noPol, ...pub.map((x) => `app.${x.relname}: política "${x.polname}" vale para PUBLIC/anon/authenticated`)];
  return items.length ? mk('rls', 'RLS ligada em todas as tabelas do schema app', 'fail', `${items.length} problema(s)`, items) : mk('rls', 'RLS ligada em todas as tabelas do schema app', 'ok', `${t.length} tabelas com RLS e políticas, nenhuma política aberta`);
}

export async function checkGrants(sql) {
  const bad = [];
  const push = (kind, name, g, priv) => { if (BAD_GRANTEES.has(grantee(g))) bad.push(`${kind} ${name}: ${priv} para ${grantee(g)}`); };
  for (const r of await sql`select n.nspname as name, a.grantee::regrole::text as g, a.grantee as gid, a.privilege_type as priv from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a where n.nspname = 'app'`) push('schema', r.name, r.gid === 0 || r.gid === '0' ? 0 : r.g, r.priv);
  for (const r of await sql`select c.relname as name, c.relkind as k, a.grantee as gid, a.grantee::regrole::text as g, a.privilege_type as priv
      from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))) a
      where n.nspname = 'app' and c.relkind in ('r','p','v','m','S','f')`) push({ r: 'tabela', p: 'tabela', v: 'visão', m: 'visão', S: 'sequência', f: 'tabela' }[r.k], 'app.' + r.name, Number(r.gid) === 0 ? 0 : r.g, r.priv);
  for (const r of await sql`select c.relname as name, at.attname as col, a.grantee as gid, a.grantee::regrole::text as g, a.privilege_type as priv
      from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(at.attacl) a where n.nspname = 'app' and at.attacl is not null`) push('coluna', `app.${r.name}.${r.col}`, Number(r.gid) === 0 ? 0 : r.g, r.priv);
  for (const r of await sql`select p.oid::regprocedure::text as name, a.grantee as gid, a.grantee::regrole::text as g, a.privilege_type as priv
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a where n.nspname = 'app'`) push('função', r.name, Number(r.gid) === 0 ? 0 : r.g, r.priv);
  for (const r of await sql`select d.defaclobjtype as t, a.grantee as gid, a.grantee::regrole::text as g, a.privilege_type as priv from pg_default_acl d, aclexplode(d.defaclacl) a where d.defaclnamespace = 'app'::regnamespace`) push('privilégio padrão (futuros objetos)', 'schema app/' + r.t, Number(r.gid) === 0 ? 0 : r.g, r.priv);
  const svc = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
      where n.nspname = 'app' and c.relkind in ('r','p') and a.grantee::regrole::text = 'service_role' limit 3`.catch(() => []);
  const t = 'Nenhuma permissão para anon/authenticated/PUBLIC no schema app';
  if (bad.length) return mk('grants', t, 'fail', `${bad.length} permissão(ões) indevida(s)`, [...new Set(bad)].slice(0, 60));
  if (svc.length) return mk('grants', t, 'warn', 'service_role (Supabase) tem permissão em tabelas de app: desnecessário, pois a API usa app_api', svc.map((x) => 'app.' + x.relname));
  return mk('grants', t, 'ok', 'schema, tabelas, colunas, sequências, funções e privilégios padrão sem acesso público');
}

export async function checkRoles(sql) {
  const want = { app_owner: { login: false }, app_user: { login: false }, app_system: { login: false }, app_api: { login: true }, app_ops: { login: true } };
  const rows = await sql`select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolcanlogin from pg_roles where rolname in ('app_owner','app_user','app_system','app_api','app_ops')`;
  const by = Object.fromEntries(rows.map((r) => [r.rolname, r])); const p = [];
  for (const [n, w] of Object.entries(want)) {
    const r = by[n]; if (!r) { p.push(`papel ${n} não existe`); continue; }
    if (r.rolsuper) p.push(`${n} é SUPERUSER`); if (r.rolbypassrls) p.push(`${n} tem BYPASSRLS`);
    if (n === 'app_api' && (r.rolcreaterole || r.rolcreatedb || r.rolreplication)) p.push('app_api pode criar papéis/bancos ou replicar');
    if (r.rolcanlogin !== w.login) p.push(`${n}: LOGIN deveria ser ${w.login ? 'permitido' : 'proibido'}`);
  }
  const tr = async (role) => (await sql`with recursive r as (select roleid from pg_auth_members where member = (select oid from pg_roles where rolname = ${role})
      union select m.roleid from pg_auth_members m join r on m.member = r.roleid) select ro.rolname, ro.rolsuper, ro.rolbypassrls from r join pg_roles ro on ro.oid = r.roleid`);
  if (by.app_api) {
    for (const m of await tr('app_api')) { if (m.rolname !== 'app_user') p.push(`app_api é membro de ${m.rolname} (só app_user é permitido)`); if (m.rolsuper || m.rolbypassrls) p.push(`app_api herda poderes de ${m.rolname} (superuser/BYPASSRLS)`); }
    const priv = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind in ('r','p')
      and has_table_privilege('app_api', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`; for (const x of priv) p.push(`app_api tem acesso direto à tabela app.${x.relname} (deveria só assumir app_user)`);
  }
  if (by.app_ops) for (const m of await tr('app_ops')) { if (m.rolname !== 'app_system') p.push(`app_ops é membro de ${m.rolname} (esperado só app_system)`); if (m.rolsuper || m.rolbypassrls) p.push(`app_ops herda poderes de ${m.rolname}`); }
  const t = 'Papéis do banco: app_api sem poderes e sem pertença a app_system/app_owner';
  return p.length ? mk('roles', t, 'fail', `${p.length} problema(s)`, p) : mk('roles', t, 'ok', 'app_api só assume app_user; nenhum papel da aplicação é superuser/BYPASSRLS');
}

export async function checkDefiners(sql) {
  const rows = await sql`select p.oid::regprocedure::text as name, p.proconfig as cfg, r.rolname as owner, r.rolsuper, r.rolbypassrls
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner where n.nspname = 'app' and p.prosecdef`;
  const f = [], w = [];
  for (const r of rows) {
    const sp = (r.cfg || []).find((c) => c.startsWith('search_path='));
    if (!sp) f.push(`${r.name}: SECURITY DEFINER sem search_path fixo (vulnerável a sequestro de funções)`);
    else if (/(^|[=,\s])(public|"\$user"|\$user)(,|$)/.test(sp.slice('search_path='.length))) w.push(`${r.name}: search_path inclui public/$user (${sp})`);
    if (r.rolsuper || r.rolbypassrls) f.push(`${r.name}: dono ${r.owner} é superuser/BYPASSRLS (a função ignoraria o RLS)`);
  }
  const t = 'Funções SECURITY DEFINER com search_path fixo e dono sem superpoderes';
  if (f.length) return mk('definers', t, 'fail', `${f.length} problema(s)`, f); if (w.length) return mk('definers', t, 'warn', '', w);
  return mk('definers', t, 'ok', `${rows.length} funções verificadas`);
}

export async function checkGuards(sql) {
  const need = { users: 'users_guard', presentations: 'presentations_guard', comments: 'comments_guard', interactions: 'interactions_guard', audit_log: 'audit_no_update' };
  const rows = await sql`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and not t.tgisinternal and t.tgenabled <> 'D'`;
  const have = new Set(rows.map((r) => `${r.relname}.${r.tgname}`)); const miss = Object.entries(need).filter(([t, g]) => !have.has(`${t}.${g}`)).map(([t, g]) => `gatilho ${g} ausente/desativado em app.${t}`);
  return miss.length ? mk('guards', 'Gatilhos de proteção (auditoria só-acréscimo, último admin, campos imutáveis)', 'fail', '', miss) : mk('guards', 'Gatilhos de proteção (auditoria só-acréscimo, último admin, campos imutáveis)', 'ok', `${Object.keys(need).length} gatilhos ativos`);
}

export async function checkMigrations(sql) {
  const t = 'Migrações aplicadas e sem divergência de checksum';
  let rows; try { rows = await sql`select version, name, checksum from public.schema_migrations order by version`; } catch (e) {
    if (e.code === '42501') return mk('migrations', t, 'warn', 'sem permissão para ler public.schema_migrations (use DATABASE_ADMIN_URL para esta verificação)');
    return mk('migrations', t, 'fail', 'tabela public.schema_migrations inexistente: migrações nunca aplicadas');
  }
  const done = new Map(rows.map((r) => [r.version, r])); const p = [], w = [];
  for (const m of listMigrations()) { const d = done.get(m.version); if (!d) p.push(`pendente: ${m.name}`); else if (d.checksum !== m.checksum) p.push(`DIVERGENTE: ${m.name} foi alterada depois de aplicada`); done.delete(m.version); }
  for (const d of done.values()) w.push(`aplicada no banco mas sem arquivo no código: ${d.name}`);
  return p.length ? mk('migrations', t, 'fail', `${p.length} problema(s)`, p) : w.length ? mk('migrations', t, 'warn', '', w) : mk('migrations', t, 'ok', `${rows.length} migrações aplicadas e idênticas aos arquivos`);
}

export async function checkDataApi(sql, { env = process.env, fetchImpl = fetch, offline = false } = {}) {
  const t = 'Data API do Supabase não expõe o schema app'; const items = [];
  const role = await sql`select oid from pg_roles where rolname = 'authenticator'`;
  let status = 'ok', detail = '';
  if (!role.length) { status = 'skip'; detail = 'papel authenticator inexistente (não é um Supabase): nada a verificar no banco'; }
  else {
    const cfg = await sql`select unnest(s.setconfig) as c from pg_db_role_setting s where s.setrole = ${role[0].oid}`;
    const schemas = cfg.map((x) => x.c).find((c) => c.startsWith('pgrst.db_schemas='));
    if (!schemas) { status = 'warn'; detail = 'não encontrei pgrst.db_schemas no banco; confirme no painel (Project Settings → API → Exposed schemas) que "app" NÃO está na lista'; }
    else if (schemas.slice('pgrst.db_schemas='.length).split(',').map((s) => s.trim().replace(/"/g, '')).includes('app')) { status = 'fail'; detail = `o schema app está exposto na Data API (${schemas})`; }
    else detail = `schemas expostos: ${schemas.slice('pgrst.db_schemas='.length)}`;
    const extra = cfg.map((x) => x.c).find((c) => c.startsWith('pgrst.db_extra_search_path=')); if (extra && /(^|[=,\s])app(,|$)/.test(extra)) { status = 'fail'; items.push(`db_extra_search_path contém app: ${extra}`); }
  }
  if (!offline && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && status !== 'fail') {
    try {
      const r = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/presentations?select=id&limit=1`, { headers: { apikey: env.SUPABASE_ANON_KEY, 'Accept-Profile': 'app' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (r.status === 200) { status = 'fail'; detail = 'a Data API respondeu 200 para o schema app com a chave anônima: DESLIGUE a exposição do schema app'; } else detail += (detail ? ' · ' : '') + `teste na API REST com a chave anônima: HTTP ${r.status} (bloqueado)`;
    } catch (e) { items.push(`teste HTTP da Data API não executado (${String(e.message).slice(0, 80)})`); }
  }
  return mk('data_api', t, status, detail, items);
}

export async function checkTls(sql, { env = process.env } = {}) {
  const t = 'Conexão com o banco usa TLS'; const url = env.DATABASE_OPS_URL || env.DATABASE_ADMIN_URL || '';
  let host = sql.options?.host?.[0] || ''; if (!host) { try { host = new URL(url).hostname; } catch { /* sem URL */ } }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  const [r] = await sql`select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as ssl`.catch(() => [{ ssl: null }]);
  if (r.ssl === true) return mk('tls', t, 'ok', 'conexão criptografada'); if (r.ssl === null) return mk('tls', t, 'skip', 'não consegui consultar pg_stat_ssl');
  return local ? mk('tls', t, 'skip', 'banco local (sem TLS é aceitável só em desenvolvimento)') : mk('tls', t, 'fail', 'a conexão com um banco REMOTO não está usando TLS: use ?sslmode=require');
}

// ---------------------------------------------------------------------------------------------------------------- arquivos
export async function checkStorage(sql, { env = process.env, fetchImpl = fetch, offline = false, s3Factory = null } = {}) {
  const t = 'Arquivos: bucket/pasta privado (sem leitura pública)'; const driver = env.STORAGE_DRIVER || 'local';
  if (driver === 'local') {
    const dir = env.STORAGE_LOCAL_DIR; if (!dir || !fs.existsSync(dir)) return mk('storage', t, 'skip', 'armazenamento local inexistente neste ambiente');
    const mode = fs.statSync(dir).mode & 0o777; return mode & 0o007 ? mk('storage', t, 'warn', `a pasta de arquivos (${dir}) é acessível a "outros usuários" do servidor (modo ${mode.toString(8)}); use chmod 750`) : mk('storage', t, 'ok', `pasta local sem acesso para outros (modo ${mode.toString(8)})`);
  }
  const items = []; let status = 'ok'; const store = s3Factory ? s3Factory(env) : openPrimaryStore(env);
  if (store instanceof S3Store || store?._sdk) {
    try {
      const { S3, c } = await store._sdk(); const Bucket = store.bucket; let checked = 0;
      try { const r = await c.send(new S3.GetPublicAccessBlockCommand({ Bucket })); const b = r.PublicAccessBlockConfiguration || {}; checked++; if (!(b.BlockPublicAcls && b.BlockPublicPolicy && b.IgnorePublicAcls && b.RestrictPublicBuckets)) { status = 'warn'; items.push('Block Public Access não está totalmente ligado'); } } catch (e) { if (e?.name === 'NoSuchPublicAccessBlockConfiguration') { status = 'warn'; items.push('Block Public Access não configurado'); } }
      try { const r = await c.send(new S3.GetBucketPolicyStatusCommand({ Bucket })); checked++; if (r.PolicyStatus?.IsPublic) { status = 'fail'; items.push('a política do bucket o torna PÚBLICO'); } } catch { /* sem política ou API não implementada */ }
      try { const r = await c.send(new S3.GetBucketAclCommand({ Bucket })); checked++; for (const g of r.Grants || []) if (/AllUsers|AuthenticatedUsers/.test(g.Grantee?.URI || '')) { status = 'fail'; items.push(`ACL do bucket concede ${g.Permission} a ${g.Grantee.URI.split('/').pop()}`); } } catch { /* API não implementada (Supabase Storage S3) */ }
      if (!checked) items.push('a API S3 deste provedor não permite consultar políticas/ACL: confirme no painel que o bucket é PRIVADO');
    } catch (e) { items.push(`consulta à API S3 não executada (${String(e.message).slice(0, 80)})`); }
  }
  if (!offline) {
    let sha = null; try { const run = (fn) => (sql.savepoint ? sql.savepoint(fn) : sql.begin(fn)); sha = (await run(async (tx) => { await tx`set local role app_system`; return tx`select sha256 from app.assets where status = 'ready' order by created_at limit 1`; }))[0]?.sha256; } catch { /* sem permissão/dados */ }
    if (!sha) items.push('sem arquivo pronto para o teste de leitura anônima (rode de novo depois de haver arquivos)');
    else {
      const key = keyOfSha(sha); const urls = [];
      const ep = env.S3_ENDPOINT ? env.S3_ENDPOINT.replace(/\/$/, '') : `https://s3.${env.S3_REGION || 'us-east-1'}.amazonaws.com`;
      urls.push(env.S3_FORCE_PATH_STYLE === 'false' && !env.S3_ENDPOINT ? `https://${env.S3_BUCKET}.s3.${env.S3_REGION || 'us-east-1'}.amazonaws.com/${key}` : `${ep}/${env.S3_BUCKET}/${key}`);
      if (env.SUPABASE_URL) urls.push(`${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${env.S3_BUCKET}/${key}`);
      for (const u of urls) {
        try { const r = await fetchImpl(u, { redirect: 'manual', signal: AbortSignal.timeout(10000) }); if (r.status === 200) { status = 'fail'; items.push(`LEITURA ANÔNIMA POSSÍVEL: ${new URL(u).host}${new URL(u).pathname.slice(0, 40)}… respondeu 200 sem credenciais`); } else items.push(`leitura anônima bloqueada em ${new URL(u).host} (HTTP ${r.status})`); }
        catch (e) { items.push(`teste anônimo em ${new URL(u).host} não executado (${String(e.message).slice(0, 60)})`); }
      }
    }
  }
  return mk('storage', t, status, status === 'ok' ? 'sem exposição pública detectada' : '', items);
}

// ------------------------------------------------------------------------------------------------------ ambiente da API
export function parseEnvNames(text) {
  const out = new Map(); for (const raw of String(text).split('\n')) { const l = raw.trim(); if (!l || l.startsWith('#')) continue; const [k, ...v] = l.replace(/^export\s+/, '').split('='); if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.trim())) out.set(k.trim(), v.join('=').replace(/^["']|["']$/g, '')); }
  return out;
}
export function checkApiEnv(vars, { expectEnv = null } = {}) {
  const t = 'Ambiente da API: variáveis proibidas ausentes'; const p = [];
  for (const k of vars.keys()) {
    if (FORBIDDEN_API_ENV.some((re) => re.test(k))) p.push(`${k} NÃO pode existir no ambiente da API (é só de ferramentas/CI)`);
    if (PUBLIC_PREFIX.test(k) && SECRETY.test(k)) p.push(`${k}: variável com prefixo público e nome de segredo: ela iria para o navegador`);
  }
  const v = (k) => vars.get(k); const truthy = (x) => ['1', 'true', 'yes', 'on'].includes(String(x ?? '').toLowerCase());
  if (truthy(v('GOTRUE_FAKE'))) p.push('GOTRUE_FAKE está ligado (login falso só existe em testes)');
  const env = v('APP_ENV'); if (expectEnv && env !== undefined && env !== '' && env !== expectEnv) p.push(`APP_ENV=${env}, esperado ${expectEnv}`);
  if (expectEnv === 'production') { if (v('STORAGE_DRIVER') === 'local') p.push('STORAGE_DRIVER=local em produção (use s3)'); if (v('APP_ORIGIN') && !/^https:\/\//.test(v('APP_ORIGIN'))) p.push('APP_ORIGIN não é https://'); if (v('DATABASE_SSL') === 'disable') p.push('DATABASE_SSL=disable em produção'); }
  return p.length ? mk('api_env', t, 'fail', `${p.length} problema(s)`, p) : mk('api_env', t, 'ok', `${vars.size} variáveis conferidas`);
}

// ------------------------------------------------------------------------------------------------------------------- site
export async function checkSite(url, { fetchImpl = fetch, expectEnv = null } = {}) {
  const base = url.replace(/\/$/, ''); const u = new URL(base); const https = u.protocol === 'https:'; const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  const res = []; const get = (p, init = {}) => fetchImpl(base + p, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });
  try {
    const h = await get('/api/health'); const j = await h.json().catch(() => ({}));
    res.push(h.status === 200 && j.ok === true ? mk('site_health', '/api/health responde', 'ok', `versão ${j.version || '?'} · ambiente ${j.env || '?'}`) : mk('site_health', '/api/health responde', 'fail', `HTTP ${h.status}`));
    if (expectEnv && j.env && j.env !== expectEnv) res.push(mk('site_env', 'Ambiente do site confere', 'fail', `/api/health diz env=${j.env}, esperado ${expectEnv}`));
    const r = await get('/api/ready'); const rj = await r.json().catch(() => ({})); const bad = Object.entries(rj).filter(([, v]) => v === false).map(([k]) => k);
    res.push(r.status === 200 && !bad.length ? mk('site_ready', '/api/ready (banco, arquivos, autenticação, migrações)', 'ok', JSON.stringify(rj)) : mk('site_ready', '/api/ready (banco, arquivos, autenticação, migrações)', 'fail', `HTTP ${r.status}; com problema: ${bad.join(', ') || 'resposta inválida'}`));
    const idx = await get('/'); const hd = (n) => idx.headers.get(n); const miss = [];
    if (https && !/max-age=\d{6,}/.test(hd('strict-transport-security') || '')) miss.push('Strict-Transport-Security (HSTS) ausente ou curto');
    if ((hd('x-content-type-options') || '').toLowerCase() !== 'nosniff') miss.push('X-Content-Type-Options: nosniff ausente');
    if (!hd('content-security-policy')) miss.push('Content-Security-Policy ausente'); if (!hd('referrer-policy')) miss.push('Referrer-Policy ausente');
    if (!hd('x-frame-options') && !/frame-ancestors/.test(hd('content-security-policy') || '')) miss.push('proteção contra clickjacking ausente (X-Frame-Options ou frame-ancestors)');
    if (hd('x-powered-by')) miss.push('X-Powered-By exposto');
    res.push(miss.length ? mk('site_headers', 'Cabeçalhos de segurança', 'fail', '', miss) : mk('site_headers', 'Cabeçalhos de segurança', 'ok', 'HSTS, nosniff, CSP, Referrer-Policy e anti-clickjacking presentes'));
    if (https && !local) { try { const ins = await fetchImpl(`http://${u.host}/`, { redirect: 'manual', signal: AbortSignal.timeout(10000) }); const loc = ins.headers.get('location') || ''; res.push([301, 302, 307, 308].includes(ins.status) && loc.startsWith('https://') ? mk('site_https', 'HTTP redireciona para HTTPS', 'ok', `HTTP ${ins.status}`) : mk('site_https', 'HTTP redireciona para HTTPS', 'fail', `http:// respondeu ${ins.status}`)); } catch { res.push(mk('site_https', 'HTTP redireciona para HTTPS', 'warn', 'porta 80 inacessível (aceitável se só HTTPS)')); } }
    const prot = []; for (const p of ['/api/presentations', '/api/admin/users', '/api/admin/audit']) { const x = await get(p); if (![401, 403].includes(x.status)) prot.push(`${p} respondeu ${x.status} sem login (esperado 401/403)`); }
    res.push(prot.length ? mk('site_auth', 'Rotas protegidas exigem login', 'fail', '', prot) : mk('site_auth', 'Rotas protegidas exigem login', 'ok', '401/403 sem sessão'));
    const s = await get('/api/auth/session'); const cookies = s.headers.getSetCookie ? s.headers.getSetCookie() : [s.headers.get('set-cookie') || '']; const cp = [];
    for (const c of cookies.filter(Boolean)) { if (https && !/;\s*secure/i.test(c)) cp.push(`cookie sem Secure: ${c.split('=')[0]}`); if (/^__Host-/.test(c) && (/;\s*domain=/i.test(c) || !/;\s*path=\/(;|$)/i.test(c))) cp.push(`cookie __Host- inválido: ${c.split('=')[0]}`); if (https && !/^__Host-/.test(c)) cp.push(`cookie sem prefixo __Host-: ${c.split('=')[0]}`); }
    res.push(cp.length ? mk('site_cookies', 'Cookies de sessão/CSRF seguros', 'fail', '', cp) : mk('site_cookies', 'Cookies de sessão/CSRF seguros', cookies.filter(Boolean).length ? 'ok' : 'warn', cookies.filter(Boolean).length ? 'Secure, prefixo __Host-' : 'a rota de sessão não definiu cookies (CSRF)'));
    const cors = await get('/api/health', { headers: { Origin: 'https://evil.example' } }); const acao = cors.headers.get('access-control-allow-origin');
    res.push(acao && (acao === '*' || acao.includes('evil')) ? mk('site_cors', 'CORS não libera origens estranhas', 'fail', `Access-Control-Allow-Origin: ${acao}`) : mk('site_cors', 'CORS não libera origens estranhas', 'ok', 'sem liberação para origem externa'));
  } catch (e) { res.push(mk('site', 'Site acessível', 'fail', `não consegui consultar ${base}: ${String(e.message).slice(0, 120)}`)); }
  return res;
}

export function checkDist(dir) {
  const t = 'Build do site (navegador) sem segredos'; if (!fs.existsSync(dir)) return mk('dist', t, 'fail', `pasta ${dir} não existe (rode npm run build:web)`);
  const { files, findings } = scanTree({ dir }); const bad = findings.filter((f) => f.severity === 'critica' || f.severity === 'alta');
  return bad.length ? mk('dist', t, 'fail', `${bad.length} possível(is) segredo(s) em ${files} arquivos do site`, bad.slice(0, 20).map((f) => `${f.file}:${f.line} ${f.rule} ${f.preview}`)) : mk('dist', t, 'ok', `${files} arquivos varridos`);
}

/** Executa todas as verificações aplicáveis. `sql` pode ser uma transação (testes mutam e dão rollback). */
export async function runChecks({ sql = null, env = process.env, url = null, apiEnv = null, distDir = null, expectEnv = null, offline = false, fetchImpl = fetch, s3Factory = null } = {}) {
  const out = [];
  if (sql) {
    out.push(await checkRls(sql), await checkGrants(sql), await checkRoles(sql), await checkDefiners(sql), await checkGuards(sql), await checkMigrations(sql), await checkDataApi(sql, { env, fetchImpl, offline }), await checkTls(sql, { env }), await checkStorage(sql, { env, fetchImpl, offline, s3Factory }));
  }
  if (apiEnv) out.push(checkApiEnv(apiEnv, { expectEnv }));
  if (distDir) out.push(checkDist(distDir));
  if (url && !offline) out.push(...(await checkSite(url, { fetchImpl, expectEnv })));
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['json', 'strict', 'offline'] }); const redact = buildRedactor(env);
  const dbUrl = env.DATABASE_ADMIN_URL || env.DATABASE_OPS_URL; let sql = null;
  if (dbUrl) sql = connect(dbUrl, { max: 1 }); else if (!args.url && !args['api-env-file'] && !args['scan-dist']) throw new ToolError('defina DATABASE_OPS_URL ou DATABASE_ADMIN_URL (ou use --url/--api-env-file/--scan-dist)', { exit: 2, code: 'no_db' });
  try {
    const apiEnv = args['api-env-file'] ? parseEnvNames(fs.readFileSync(args['api-env-file'], 'utf8')) : null;
    const results = await runChecks({ sql, env, url: args.url, apiEnv, distDir: args['scan-dist'], expectEnv: args['expect-env'] || null, offline: !!args.offline });
    const failed = results.filter((r) => r.status === 'fail'), warned = results.filter((r) => r.status === 'warn');
    if (args.json) process.stdout.write(JSON.stringify({ ok: !failed.length && !(args.strict && warned.length), results }) + '\n');
    else {
      const icon = { ok: 'OK    ', fail: 'FALHOU', warn: 'AVISO ', skip: 'PULOU ' };
      for (const r of results) { process.stderr.write(`${icon[r.status]}  ${r.title}${r.detail ? ' — ' + redact(r.detail) : ''}\n`); for (const i of r.items) process.stderr.write(`          · ${redact(i)}\n`); }
      process.stderr.write(`\nverify-deploy: ${results.length - failed.length - warned.length} ok, ${warned.length} aviso(s), ${failed.length} falha(s)\n`);
    }
    return failed.length || (args.strict && warned.length) ? 1 : 0;
  } finally { if (sql) await sql.end({ timeout: 5 }).catch(() => {}); }
}
if (isMain(import.meta.url)) runCli(() => main());
