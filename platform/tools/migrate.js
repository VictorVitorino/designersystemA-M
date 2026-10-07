#!/usr/bin/env node
/* tools/migrate.js — aplica db/migrations/*.sql em ordem, com checksum e trava (advisory lock).
   Uso:  DATABASE_ADMIN_URL=postgres://… [APP_API_DB_PASSWORD=…] node tools/migrate.js [--check] [--no-roles]
   • DATABASE_ADMIN_URL: conexão com um papel que pode criar papéis/schemas (Supabase: usuário `postgres`, conexão direta 5432).
   • Papéis (idempotente): app_owner (dono dos objetos), app_user e app_system (NOLOGIN; RLS), app_api (LOGIN da API; APP_API_DB_PASSWORD), app_ops (LOGIN de ferramentas/jobs; APP_OPS_DB_PASSWORD).
   • --check: não altera nada; falha se houver migração pendente ou arquivo alterado depois de aplicado.
   • public.schema_migrations fica FECHADA: RLS ligada e nenhum privilégio para PUBLIC, anon/authenticated/service_role (Supabase) nem papéis da aplicação.
   Cada migração roda numa transação. Arquivos aplicados nunca podem mudar (checksum): crie uma migração nova. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const LOCK_KEY = 7261893345; // pg_advisory_lock

export async function bootstrapRoles(sql, { apiPassword, opsPassword = process.env.APP_OPS_DB_PASSWORD } = {}) {
  await sql.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'app_owner')  then create role app_owner  nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'app_user')   then create role app_user   nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'app_system') then create role app_system nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'app_api')    then create role app_api    login noinherit nosuperuser nocreatedb nocreaterole nobypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'app_ops')    then create role app_ops    login noinherit nosuperuser nocreatedb nocreaterole nobypassrls; end if;
    end $$;`);
  if (apiPassword) await sql.unsafe(`alter role app_api with login password ${lit(apiPassword)}`);
  if (opsPassword) await sql.unsafe(`alter role app_ops with login password ${lit(opsPassword)}`);
  // Pertença EXATA (papéis são do cluster inteiro e podem ter sobras de execuções antigas): a API nunca vira app_system/app_owner.
  await sql.unsafe(`do $$ begin
      revoke app_system from app_api; revoke app_owner from app_api; revoke app_user from app_ops;
    exception when others then null; end $$;`);
  await sql.unsafe('grant app_user to app_api');
  await sql.unsafe('grant app_system to app_ops');
  // o papel administrador precisa poder criar objetos como app_owner
  await sql.unsafe(`do $$ begin execute format('grant app_owner to %I', current_user); exception when others then null; end $$;`);
  const [{ db }] = await sql`select current_database() as db`;
  await sql.unsafe(`grant connect on database "${db.replace(/"/g, '""')}" to app_api, app_ops`);
  await sql.unsafe(`grant create on database "${db.replace(/"/g, '""')}" to app_owner`);
}
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** Papéis que NUNCA podem acessar o controle de migrações: os do Supabase (Data API) e os da própria aplicação. */
export const SCHEMA_MIGRATIONS_LOCKED_FROM = ['anon', 'authenticated', 'service_role', 'app_api', 'app_user', 'app_system', 'app_ops'];
/** Fecha public.schema_migrations (achado PUB-05): no Supabase ela nasceria com ALL para anon/authenticated (privilégios padrão do schema public)
 *  e sem RLS — com a Data API ligada, quem tem a chave pública poderia ler ou apagar o controle e travar o próximo deploy.
 *  Liga a RLS (sem políticas: só o DONO, que roda migrate/backup/verify, acessa) e revoga tudo de PUBLIC e desses papéis, se existirem.
 *  Idempotente; roda em todo migrate e depois de toda restauração (restore.js). A API não lê esta tabela (src/routes/health.js). */
export async function lockSchemaMigrations(sql) {
  await sql.unsafe(`do $$
    declare r text;
    begin
      alter table public.schema_migrations enable row level security;
      revoke all on table public.schema_migrations from public;
      foreach r in array array[${SCHEMA_MIGRATIONS_LOCKED_FROM.map(lit).join(', ')}] loop
        if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table public.schema_migrations from %I', r); end if;
      end loop;
    end $$;`);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function listMigrations() {
  return fs.readdirSync(DIR).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map((f) => {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    return { version: f.slice(0, 4), name: f, text, checksum: sha(text) };
  });
}

export async function migrate(url, { check = false, roles = true, apiPassword = process.env.APP_API_DB_PASSWORD, opsPassword = process.env.APP_OPS_DB_PASSWORD, log = console.log } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    if (roles && !check) await bootstrapRoles(sql, { apiPassword, opsPassword });
    await sql.unsafe(`create table if not exists public.schema_migrations (version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`);
    if (!check) await lockSchemaMigrations(sql);
    const done = new Map((await sql`select version, name, checksum from public.schema_migrations`).map((r) => [r.version, r]));
    const all = listMigrations(); const pending = []; let drift = 0;
    for (const m of all) {
      const d = done.get(m.version);
      if (!d) pending.push(m);
      else if (d.checksum !== m.checksum) { drift++; log(`✗ ${m.name}: o arquivo mudou depois de aplicado (checksum diferente). Crie uma migração nova.`); }
    }
    if (check) { if (pending.length) log(`pendentes: ${pending.map((m) => m.name).join(', ')}`); return { ok: !pending.length && !drift, pending: pending.map((m) => m.name), drift }; }
    if (drift) throw new Error('migrações aplicadas foram alteradas');
    for (const m of pending) {
      await sql.begin(async (tx) => {
        await tx.unsafe('set local role app_owner');
        await tx.unsafe(m.text);
        await tx.unsafe('reset role');
        await tx`insert into public.schema_migrations(version, name, checksum) values (${m.version}, ${m.name}, ${m.checksum})`;
      });
      log(`✓ ${m.name}`);
    }
    if (!pending.length) log('banco já está atualizado');
    return { ok: true, applied: pending.map((m) => m.name), drift: 0 };
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('defina DATABASE_ADMIN_URL'); process.exit(2); }
  const check = process.argv.includes('--check');
  migrate(url, { check, roles: !process.argv.includes('--no-roles') })
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
