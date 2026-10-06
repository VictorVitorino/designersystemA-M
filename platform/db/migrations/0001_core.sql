-- 0001_core — esquema `app`, usuários, identidades, convites, configurações, auditoria e limites de taxa.
-- Tudo vive no schema `app` (NÃO exposto pela Data API do Supabase). Papéis são criados por tools/migrate.js (bootstrap).
-- Portável: Postgres 15+ (Supabase, Neon, RDS, local). Sem extensões obrigatórias (gen_random_uuid é nativo).

create schema if not exists app authorization app_owner;
revoke all on schema app from public;
grant usage on schema app to app_api, app_user, app_system;

-- ---------------------------------------------------------------------------------------------
-- Usuários: uma linha por pessoa, independente do provedor de identidade (Supabase Auth hoje, SSO A&M depois).
-- Os dados (apresentações, comentários…) apontam para app.users.id, nunca para o id do provedor → trocar/adicionar
-- login (SSO) preserva contas e dados.
create table app.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  display_name  text not null,
  role          text not null default 'member',
  status        text not null default 'invited',
  invited_by    uuid references app.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  activated_at  timestamptz,
  last_login_at timestamptz,
  constraint users_email_lower   check (email = lower(email) and length(email) between 3 and 254 and email like '%_@_%'),
  constraint users_name_len      check (length(btrim(display_name)) between 1 and 120),
  constraint users_role_valid    check (role in ('admin','member')),
  constraint users_status_valid  check (status in ('invited','active','suspended'))
);
create unique index users_email_key on app.users (email);
create index users_role_status_idx on app.users (role, status);

-- Identidades: (provedor, sujeito) → usuário. 'supabase' = auth.users.id; no futuro 'saml:<idp>' / 'oidc:entra'.
create table app.user_identities (
  provider    text not null,
  subject     text not null,
  user_id     uuid not null references app.users(id) on delete cascade,
  email_at_link text,
  created_at  timestamptz not null default now(),
  primary key (provider, subject),
  constraint identities_provider_fmt check (provider ~ '^[a-z0-9:_-]{2,60}$'),
  constraint identities_subject_len  check (length(subject) between 1 and 255)
);
create index user_identities_user_idx on app.user_identities (user_id);

-- Convites (registro; o e-mail em si é enviado pelo Supabase Auth). Cadastro aberto é DESLIGADO: só entra quem foi convidado.
create table app.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  user_id     uuid references app.users(id) on delete cascade,
  role        text not null default 'member',
  invited_by  uuid references app.users(id) on delete set null,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  resent_count int not null default 0,
  constraint invites_email_lower check (email = lower(email)),
  constraint invites_role_valid  check (role in ('admin','member')),
  constraint invites_status_valid check (status in ('pending','accepted','revoked','expired'))
);
create unique index invites_one_pending_per_email on app.invites (email) where status = 'pending';
create index invites_status_idx on app.invites (status, expires_at);

-- Configurações globais (chave/valor, valores pequenos).
create table app.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id) on delete set null,
  constraint settings_key_fmt check (key ~ '^[a-z0-9_.-]{1,80}$')
);
insert into app.settings(key, value) values
  ('acervo.visibility', '"all_members"'),          -- regra do produto: o que é salvo fica visível para todos
  ('versions.keep_last', '50'),
  ('versions.keep_daily_days', '90'),
  ('uploads.max_bytes', '104857600'),
  ('invites.ttl_days', '7')
on conflict do nothing;

-- Auditoria: somente acréscimo. Nunca grava senhas, tokens nem conteúdo de apresentações.
create table app.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references app.users(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   text,
  ip          inet,
  user_agent  text,
  request_id  text,
  meta        jsonb not null default '{}'::jsonb,
  constraint audit_action_fmt check (action ~ '^[a-z0-9_.:-]{2,80}$'),
  constraint audit_meta_size  check (pg_column_size(meta) < 8192)
);
create index audit_log_at_idx on app.audit_log (at desc);
create index audit_log_actor_idx on app.audit_log (actor_id, at desc);
create index audit_log_entity_idx on app.audit_log (entity_type, entity_id, at desc);

-- Limites de taxa (janela fixa) — contadores no próprio Postgres, sem Redis.
create table app.rate_limits (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, key, window_start)
);
create index rate_limits_old_idx on app.rate_limits (window_start);
