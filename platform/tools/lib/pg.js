/* tools/lib/pg.js — ajudantes de Postgres para as ferramentas (localizar pg_dump/pg_restore, conexão por variáveis PG*, contagens e amostras).
   Senhas NUNCA vão em argumentos de linha de comando (apareceriam em `ps`): vão em variáveis de ambiente do processo filho (PGPASSWORD etc.). */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { ToolError } from './common.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres']);
export const isLocalHost = (h) => LOCAL_HOSTS.has(String(h).toLowerCase());

/** URL postgres:// → variáveis PG* (libpq). `sslmode` da URL é respeitado; em host remoto sem sslmode usa `require`. */
export function pgEnvFromUrl(url, base = process.env) {
  let u; try { u = new URL(url); } catch { throw new ToolError('URL do banco inválida (esperado postgres://usuario:senha@host:porta/banco)', { code: 'bad_db_url', exit: 2 }); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new ToolError('URL do banco precisa começar com postgres:// ou postgresql://', { code: 'bad_db_url', exit: 2 });
  const env = { ...base };
  for (const k of Object.keys(env)) if (k.startsWith('PG')) delete env[k];
  env.PGHOST = u.hostname.replace(/^\[|\]$/g, ''); env.PGPORT = u.port || '5432'; env.PGUSER = decodeURIComponent(u.username); env.PGPASSWORD = decodeURIComponent(u.password);
  env.PGDATABASE = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
  env.PGSSLMODE = u.searchParams.get('sslmode') || (isLocalHost(u.hostname) ? 'prefer' : 'require');
  env.PGCONNECT_TIMEOUT = '15';
  return env;
}
export const dbNameOf = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
export function withDatabase(url, db) { const u = new URL(url); u.pathname = '/' + encodeURIComponent(db); return u.toString(); }
export const maskUrl = (url) => { try { const u = new URL(url); if (u.password) u.password = '***'; return u.toString(); } catch { return '(url inválida)'; } };

/** Cliente `postgres` (porsager) para consultas. Sem prepared statements (compatível com pooler). */
export function connect(url, { max = 1, ...opts } = {}) {
  const u = new URL(url); const ssl = u.searchParams.get('sslmode');
  return postgres(url, { max, prepare: false, onnotice: () => {}, connect_timeout: 15, idle_timeout: 20, ...(ssl ? {} : isLocalHost(u.hostname) ? {} : { ssl: 'require' }), ...opts });
}

// ---------------------------------------------------------------------------------------------------- binários do PostgreSQL
export function findPgBin(name, env = process.env) {
  const cands = [];
  if (env.PG_BIN_DIR) cands.push(path.join(env.PG_BIN_DIR, name));
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean); for (const d of dirs) cands.push(path.join(d, name));
  try { for (const v of fs.readdirSync('/usr/lib/postgresql').sort((a, b) => Number(b) - Number(a))) cands.push(`/usr/lib/postgresql/${v}/bin/${name}`); } catch { /* sem pacote Debian */ }
  for (const c of cands) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* próximo */ } }
  throw new ToolError(`não encontrei ${name}. Instale o cliente do PostgreSQL (ex.: apt-get install postgresql-client-16) ou defina PG_BIN_DIR`, { code: 'no_pg_tools', exit: 2 });
}
export function pgToolVersion(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' }); const m = /(\d+)(?:\.(\d+))?/.exec(r.stdout || '');
  return m ? { full: (r.stdout || '').trim(), major: +m[1] } : { full: '?', major: 0 };
}

/** Executa um programa e devolve {code, stdout, stderr} (stderr/stdout limitados a 1 MB). */
export function run(bin, args, { env, input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = '';
    p.stdout.on('data', (d) => { if (out.length < 1e6) out += d; }); p.stderr.on('data', (d) => { if (err.length < 1e6) err += d; });
    p.on('error', reject); p.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
    p.stdin.on('error', () => {}); p.stdin.end(input);
  });
}

// ---------------------------------------------------------------------------------------- contagens e amostras (manifesto)
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
/** Tabelas cobertas pelo backup: todas as tabelas do schema app + public.schema_migrations. */
export async function listBackupTables(sql) {
  const rows = await sql`select n.nspname as schema, c.relname as name, c.oid::int as oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and ((n.nspname = 'app') or (n.nspname = 'public' and c.relname = 'schema_migrations')) order by 1, 2`;
  return rows.map((r) => ({ ...r, fq: `${r.schema}.${r.name}` }));
}
async function orderColumns(sql, t) {
  const pk = await sql`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${t.oid} and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`;
  if (pk.length) return pk.map((r) => qi(r.attname)).join(', ');
  return '(t::text)';
}
/** Contagem exata e hash de uma amostra determinística (primeiras `limit` linhas por chave primária) de cada tabela. Executar DENTRO de uma transação (snapshot). */
export async function tableFingerprints(sql, tables, { limit = 25, exclude = ['app.rate_limits'] } = {}) {
  await sql.unsafe(`set local timezone = 'UTC'`); await sql.unsafe(`set local datestyle = 'ISO, YMD'`);
  const out = {};
  for (const t of tables) {
    const excluded = exclude.includes(t.fq);
    const [{ n }] = await sql.unsafe(`select count(*)::bigint as n from ${qi(t.schema)}.${qi(t.name)}`);
    let hash = null;
    if (!excluded) {
      const ord = await orderColumns(sql, t);
      const inner = ord === '(t::text)' ? `select * from ${qi(t.schema)}.${qi(t.name)} t order by t::text limit ${limit}` : `select * from ${qi(t.schema)}.${qi(t.name)} order by ${ord} limit ${limit}`;
      const [r] = await sql.unsafe(`select md5(coalesce(string_agg(md5(s::text), '|'), '')) as h from (${inner}) s`);
      hash = r.h;
    }
    out[t.fq] = { count: Number(n), sampleHash: hash, dataExcluded: excluded || undefined };
  }
  return out;
}
export { qi };

/** O banco de destino está vazio (sem schema app e sem tabelas de usuário)? */
export async function databaseIsEmpty(sql) {
  const rows = await sql`select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p','v','m','S','f') and n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%' limit 5`;
  const [{ has_app }] = await sql`select exists (select 1 from pg_namespace where nspname = 'app') as has_app`;
  return { empty: !rows.length && !has_app, found: rows.map((r) => `${r.nspname}.${r.relname}`), hasApp: has_app };
}
