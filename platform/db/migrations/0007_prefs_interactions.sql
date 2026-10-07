-- 0007_prefs_interactions.sql — preferências por pessoa, idempotência e tetos das interações (2026-10-07). Idempotente: pode ser reaplicada sem efeito.
-- Ver docs/API.md §3 (GET/PUT /api/me/prefs) e §6 (interações), docs/SEGURANCA.md.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Preferências da própria pessoa (BE-ED-12): kits de marca salvos, preferências do editor… Um objeto JSON por usuário.
-- O teto real (64 KB serializado, profundidade ≤ 10, sem __proto__/constructor/prototype) é conferido pela API; o CHECK de tamanho
-- aqui é só a rede de segurança contra quem chegasse ao banco por outro caminho (o binário do jsonb pode ser maior que o texto).
create table if not exists app.user_prefs (
  user_id    uuid primary key references app.users(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_prefs_object check (jsonb_typeof(prefs) = 'object'),
  constraint user_prefs_size   check (pg_column_size(prefs) < 524288)
);
alter table app.user_prefs enable row level security;

drop policy if exists sys_all on app.user_prefs;
create policy sys_all on app.user_prefs for all to app_system using (true) with check (true);
-- só a própria pessoa, com a conta ATIVA (suspenso/convidado não leem nem gravam), e nunca em nome de outra
drop policy if exists prefs_select on app.user_prefs;
create policy prefs_select on app.user_prefs for select to app_user using (app.is_active() and user_id = app.current_user_id());
drop policy if exists prefs_insert on app.user_prefs;
create policy prefs_insert on app.user_prefs for insert to app_user with check (app.is_active() and user_id = app.current_user_id());
drop policy if exists prefs_update on app.user_prefs;
create policy prefs_update on app.user_prefs for update to app_user
  using (app.is_active() and user_id = app.current_user_id()) with check (app.is_active() and user_id = app.current_user_id());

revoke all on app.user_prefs from public, app_api, app_user, app_system;
grant select, insert (user_id, prefs, updated_at), update (prefs, updated_at) on app.user_prefs to app_user;
grant select, insert, update, delete on app.user_prefs to app_system;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Interações: chave de idempotência do cliente (F13). A fila offline do editor reenvia o mesmo item com o mesmo clientId depois de uma
-- resposta perdida; (apresentação, pessoa, clientId) é único, então o reenvio devolve o item já gravado em vez de criar outro.
alter table app.interactions add column if not exists client_id text;
alter table app.interactions drop constraint if exists inter_client_id;
alter table app.interactions add constraint inter_client_id check (client_id is null or client_id ~ '^[A-Za-z0-9_-]{1,64}$');
create unique index if not exists interactions_client_uniq on app.interactions (presentation_id, user_id, client_id) where client_id is not null;

-- Teto do payload por tipo (BE-ED-14): estado de quadro/votação até 256 KB de JSON na API (o binário do jsonb de listas de números pequenos
-- chega a ~6× o texto, daí a folga de 2 MB aqui); respostas, reações e visualizações continuam como antes (< 64 KB).
alter table app.interactions drop constraint if exists inter_size;
alter table app.interactions add constraint inter_size
  check (pg_column_size(payload) < (case when kind in ('board_state', 'vote_state') then 2097152 else 65536 end));

-- O clientId também é imutável (como pessoa, apresentação e tipo): um item não troca de identidade de envio.
create or replace function app.trg_interactions_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.presentation_id <> old.presentation_id or new.kind <> old.kind
     or new.client_id is distinct from old.client_id then
    raise exception 'campos imutáveis' using errcode = '42501'; end if;
  new.updated_at := now(); return new;
end $$;
