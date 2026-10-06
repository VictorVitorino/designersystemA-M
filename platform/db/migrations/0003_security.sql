-- 0003_security — funções de contexto, gatilhos de proteção, RLS em TODAS as tabelas e privilégios mínimos.
--
-- Modelo de acesso (regra do produto):
--   • Todo usuário ATIVO enxerga todas as apresentações (acervo comum) — nunca as da lixeira dos outros.
--   • Só o DONO (ou um admin) altera/exclui a apresentação. Quem quer usar a de outra pessoa cria uma CÓPIA (nova linha, dono = quem copiou).
--   • Admin: gerencia usuários/convites, vê auditoria e pode moderar qualquer apresentação.
-- Papéis (privilégio mínimo):
--   app_api    LOGIN usado pela API em produção. Sem privilégio em tabelas. Só pode (a) assumir app_user por transação (SET LOCAL ROLE) e
--              (b) executar 3 funções pré-login: resolve_identity, hit_rate, audit. NÃO pode virar app_system (mesmo sob injeção de SQL).
--   app_user   NOLOGIN, sujeito a RLS: é o que uma requisição autenticada é.
--   app_ops    LOGIN usado só por ferramentas/jobs (coleta de lixo, retenção, importação em lote, CLI do admin). Credencial NÃO vai para a API.
--   app_system NOLOGIN, políticas explícitas (sem BYPASSRLS), concedido apenas a app_ops.
-- O admin é decidido pelo BANCO (app.is_admin() lê app.users), nunca por um valor enviado pelo cliente.

-- ---------------------------------------------------------------------------------------------
-- Contexto da requisição
create or replace function app.current_user_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app.is_active() returns boolean
  language sql stable security definer set search_path = pg_catalog, app
  as $$ select exists (select 1 from app.users u where u.id = app.current_user_id() and u.status = 'active') $$;

create or replace function app.is_admin() returns boolean
  language sql stable security definer set search_path = pg_catalog, app
  as $$ select exists (select 1 from app.users u where u.id = app.current_user_id() and u.role = 'admin' and u.status = 'active') $$;

-- Quem pode ver a apresentação (regra do acervo).
create or replace function app.can_view_presentation(p_id uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, app
  as $$
    select app.is_active() and exists (
      select 1 from app.presentations p
      where p.id = p_id
        and (p.deleted_at is null or p.owner_id = app.current_user_id() or app.is_admin()))
  $$;

-- Quem pode alterar (dono ou admin) — a apresentação precisa existir.
create or replace function app.can_edit_presentation(p_id uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, app
  as $$
    select app.is_active() and exists (
      select 1 from app.presentations p
      where p.id = p_id and (p.owner_id = app.current_user_id() or app.is_admin()))
  $$;

-- Auditoria: o autor é SEMPRE quem está logado (não dá para forjar). Não aceita segredos: o chamador só passa metadados já filtrados.
create or replace function app.audit(p_action text, p_entity_type text, p_entity_id text, p_ip inet, p_ua text, p_request_id text, p_meta jsonb)
  returns void language sql security definer set search_path = pg_catalog, app
  as $$
    insert into app.audit_log(actor_id, action, entity_type, entity_id, ip, user_agent, request_id, meta)
    values (app.current_user_id(), p_action, p_entity_type, p_entity_id, p_ip, left(p_ua, 300), left(p_request_id, 64), coalesce(p_meta, '{}'::jsonb))
  $$;

-- Limite de taxa (janela fixa). Devolve (permitido, restante, segundos até zerar).
create or replace function app.hit_rate(p_bucket text, p_key text, p_window_s int, p_limit int)
  returns table(allowed boolean, remaining int, reset_in int)
  language plpgsql security definer set search_path = pg_catalog, app
as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  n int;
begin
  insert into app.rate_limits(bucket, key, window_start, hits) values (left(p_bucket, 60), left(p_key, 200), ws, 1)
  on conflict (bucket, key, window_start) do update set hits = app.rate_limits.hits + 1
  returning hits into n;
  return query select n <= p_limit, greatest(p_limit - n, 0), greatest(ceil(extract(epoch from (ws + make_interval(secs => p_window_s) - now())))::int, 0);
end $$;

-- Resolve (ou vincula) a identidade do provedor a um usuário JÁ CONVIDADO. Cadastro aberto não existe: sem convite → nenhuma linha.
-- p_allow_email_link: vincula por e-mail verificado (1º login de convite e, no futuro, ao ligar o SSO da A&M: contas e dados preservados).
create or replace function app.resolve_identity(p_provider text, p_subject text, p_email text, p_email_verified boolean, p_allow_email_link boolean, p_touch boolean)
  returns table(user_id uuid, role text, status text, display_name text)
  language plpgsql security definer set search_path = pg_catalog, app
as $$
#variable_conflict use_column
declare u app.users; e text := lower(btrim(coalesce(p_email, '')));
begin
  select x.* into u from app.users x join app.user_identities i on i.user_id = x.id where i.provider = p_provider and i.subject = p_subject;
  if u.id is null and p_allow_email_link and p_email_verified and e <> '' then
    select * into u from app.users where email = e and status in ('invited','active');
    if u.id is not null then
      insert into app.user_identities(provider, subject, user_id, email_at_link) values (p_provider, p_subject, u.id, e) on conflict do nothing;
      -- se a identidade já pertence a outro usuário, não é sobrescrita e nada é devolvido
      if not exists (select 1 from app.user_identities where provider = p_provider and subject = p_subject and user_id = u.id) then u := null; end if;
    end if;
  end if;
  if u.id is null then return; end if;
  if u.status = 'invited' and p_touch then
    update app.users set status = 'active', activated_at = now() where id = u.id returning * into u;
    update app.invites set status = 'accepted', accepted_at = now() where email = u.email and status = 'pending';
  end if;
  if p_touch and u.status = 'active' then update app.users set last_login_at = now() where id = u.id; end if;
  return query select u.id, u.role, u.status, u.display_name;
end $$;

-- Manutenção (rodar por job): expira convites, limpa contadores antigos.
create or replace function app.purge_expired() returns table(rate_rows int, invites_expired int)
  language plpgsql security definer set search_path = pg_catalog, app
as $$
declare a int; b int;
begin
  delete from app.rate_limits where window_start < now() - interval '2 days'; get diagnostics a = row_count;
  update app.invites set status = 'expired' where status = 'pending' and expires_at < now(); get diagnostics b = row_count;
  return query select a, b;
end $$;

-- Retenção de versões: mantém as N últimas + a última de cada dia dentro da janela; apaga o resto (e suas referências de arquivo).
create or replace function app.prune_versions(p_presentation uuid, p_keep_last int, p_daily_days int) returns int
  language plpgsql security definer set search_path = pg_catalog, app
as $$
declare n int;
begin
  with ranked as (
    select id, version_no, kind, created_at,
           row_number() over (order by version_no desc) as rn,
           row_number() over (partition by date_trunc('day', created_at) order by version_no desc) as day_rn
    from app.presentation_versions where presentation_id = p_presentation),
  doomed as (
    select id, version_no from ranked
    where rn > p_keep_last and not (day_rn = 1 and created_at > now() - make_interval(days => p_daily_days)) and kind <> 'manual'),
  del_refs as (delete from app.asset_refs r using doomed d where r.presentation_id = p_presentation and r.version_no = d.version_no returning 1),
  del_ver as (delete from app.presentation_versions v using doomed d where v.id = d.id returning 1)
  select count(*) into n from del_ver;
  return n;
end $$;

-- Arquivos sem nenhuma referência há mais de p_age (candidatos a coleta de lixo; o apagamento do objeto é feito por tools/gc-assets.js).
create or replace function app.orphan_assets(p_age interval) returns table(sha256 text, size_bytes bigint)
  language sql stable security definer set search_path = pg_catalog, app
as $$
  select a.sha256, a.size_bytes from app.assets a
  where a.status in ('ready','pending','rejected') and a.created_at < now() - p_age
    and not exists (select 1 from app.asset_refs r where r.sha256 = a.sha256)
    and not exists (select 1 from app.presentations p where p.thumb_sha = a.sha256)
$$;

-- ---------------------------------------------------------------------------------------------
-- Gatilhos de proteção
create or replace function app.trg_users_guard() returns trigger language plpgsql as $$
declare trusted boolean := (current_user in ('app_system','app_owner'));
begin
  if tg_op = 'DELETE' then
    if not trusted then raise exception 'usuários não são apagados por esta via' using errcode = '42501'; end if;
    return old;
  end if;
  if new.id <> old.id then raise exception 'id imutável' using errcode = '42501'; end if;
  if (new.role <> old.role or new.status <> old.status or new.email <> old.email) and not (trusted or app.is_admin()) then
    raise exception 'apenas admin altera papel, status ou e-mail' using errcode = '42501';
  end if;
  if old.role = 'admin' and old.status = 'active' and (new.role <> 'admin' or new.status <> 'active')
     and not exists (select 1 from app.users u where u.id <> old.id and u.role = 'admin' and u.status = 'active') then
    raise exception 'não é possível remover o último administrador ativo' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger users_guard before update or delete on app.users for each row execute function app.trg_users_guard();

create or replace function app.trg_presentations_guard() returns trigger language plpgsql as $$
declare trusted boolean := (current_user in ('app_system','app_owner'));
begin
  if new.id <> old.id or new.created_at <> old.created_at then raise exception 'campos imutáveis' using errcode = '42501'; end if;
  if new.owner_id <> old.owner_id and not (trusted or app.is_admin()) then raise exception 'apenas admin transfere a propriedade' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger presentations_guard before update on app.presentations for each row execute function app.trg_presentations_guard();

create or replace function app.trg_comments_guard() returns trigger language plpgsql as $$
declare uid uuid := app.current_user_id(); trusted boolean := (current_user in ('app_system','app_owner')); mod boolean;
begin
  if new.id <> old.id or new.author_id <> old.author_id or new.presentation_id <> old.presentation_id or new.created_at <> old.created_at then
    raise exception 'campos imutáveis' using errcode = '42501'; end if;
  mod := trusted or app.is_admin() or app.can_edit_presentation(old.presentation_id);   -- dono da apresentação / admin moderam
  if new.body <> old.body then
    if not (trusted or old.author_id = uid) then raise exception 'só o autor edita o comentário' using errcode = '42501'; end if;
    new.edited_at := now();
  end if;
  if (new.deleted_at is distinct from old.deleted_at) and not (mod or old.author_id = uid) then raise exception 'sem permissão para apagar' using errcode = '42501'; end if;
  if (new.resolved_at is distinct from old.resolved_at) and not (mod or old.author_id = uid) then raise exception 'sem permissão para resolver' using errcode = '42501'; end if;
  return new;
end $$;
create trigger comments_guard before update on app.comments for each row execute function app.trg_comments_guard();

create or replace function app.trg_interactions_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.presentation_id <> old.presentation_id or new.kind <> old.kind then
    raise exception 'campos imutáveis' using errcode = '42501'; end if;
  new.updated_at := now(); return new;
end $$;
create trigger interactions_guard before update on app.interactions for each row execute function app.trg_interactions_guard();

-- Auditoria só acrescenta. A limpeza por retenção exige papel de sistema + sinal explícito.
create or replace function app.trg_audit_append_only() returns trigger language plpgsql as $$
begin
  if current_user = 'app_system' and current_setting('app.allow_audit_purge', true) = 'on' and tg_op = 'DELETE' then return old; end if;
  raise exception 'audit_log é somente acréscimo' using errcode = '42501';
end $$;
create trigger audit_no_update before update or delete on app.audit_log for each row execute function app.trg_audit_append_only();

-- Diretório público (sem e-mail): é o que os membros veem para mostrar “de quem é” cada apresentação.
create view app.directory as select id, display_name, role, status from app.users where status <> 'invited';

-- ---------------------------------------------------------------------------------------------
-- RLS: ligada em todas as tabelas. Sem política = sem acesso.
alter table app.users                 enable row level security;
alter table app.user_identities       enable row level security;
alter table app.invites               enable row level security;
alter table app.settings              enable row level security;
alter table app.audit_log             enable row level security;
alter table app.rate_limits           enable row level security;
alter table app.presentations         enable row level security;
alter table app.presentation_versions enable row level security;
alter table app.assets                enable row level security;
alter table app.asset_refs            enable row level security;
alter table app.asset_uploads         enable row level security;
alter table app.comments              enable row level security;
alter table app.interactions          enable row level security;

-- Papel de sistema (somente código do servidor: login/identidade, convites, jobs): políticas explícitas, sem BYPASSRLS.
do $$
declare t text;
begin
  foreach t in array array['users','user_identities','invites','settings','audit_log','rate_limits','presentations','presentation_versions','assets','asset_uploads','asset_refs','comments','interactions'] loop
    execute format('create policy sys_all on app.%I for all to app_system using (true) with check (true)', t);
  end loop;
end $$;

-- users
create policy users_select on app.users for select to app_user using (id = app.current_user_id() or app.is_admin());
create policy users_insert on app.users for insert to app_user with check (app.is_admin() and status = 'invited');
create policy users_update on app.users for update to app_user
  using (app.is_active() and (id = app.current_user_id() or app.is_admin()))
  with check (app.is_active() and (id = app.current_user_id() or app.is_admin()));

-- invites / settings / audit: admin
create policy invites_admin on app.invites for all to app_user using (app.is_admin()) with check (app.is_admin());
create policy settings_select on app.settings for select to app_user using (app.is_active());
create policy settings_update on app.settings for update to app_user using (app.is_admin()) with check (app.is_admin());
create policy audit_select on app.audit_log for select to app_user using (app.is_admin());

-- presentations: ver = acervo comum; alterar = dono/admin; apagar de vez = admin
-- (políticas de presentations usam as colunas da PRÓPRIA linha: funções que consultam a tabela não enxergam a linha inserida na mesma instrução)
create policy pres_select on app.presentations for select to app_user using (app.is_active() and (deleted_at is null or owner_id = app.current_user_id() or app.is_admin()));
create policy pres_insert on app.presentations for insert to app_user with check (app.is_active() and (owner_id = app.current_user_id() or app.is_admin()));
create policy pres_update on app.presentations for update to app_user using (app.is_active() and (owner_id = app.current_user_id() or app.is_admin())) with check (app.is_active() and (owner_id = app.current_user_id() or app.is_admin()));
create policy pres_delete on app.presentations for delete to app_user using (app.is_admin());

-- versões: histórico só para dono/admin
create policy ver_select on app.presentation_versions for select to app_user using (app.can_edit_presentation(presentation_id));
create policy ver_insert on app.presentation_versions for insert to app_user with check (app.can_edit_presentation(presentation_id));

-- arquivos: quem enviou, admin, ou qualquer um que possa ver uma apresentação que use o arquivo
create policy assets_select on app.assets for select to app_user using (
  app.is_active() and (uploaded_by = app.current_user_id() or app.is_admin()
    or exists (select 1 from app.asset_uploads u where u.sha256 = assets.sha256 and u.user_id = app.current_user_id())
    or exists (select 1 from app.asset_refs r where r.sha256 = assets.sha256 and app.can_view_presentation(r.presentation_id))
    or exists (select 1 from app.presentations p where p.thumb_sha = assets.sha256 and app.can_view_presentation(p.id))));
create policy assets_insert on app.assets for insert to app_user with check (app.is_active() and uploaded_by = app.current_user_id() and status = 'pending');
create policy upl_select on app.asset_uploads for select to app_user using (user_id = app.current_user_id());
create policy upl_insert on app.asset_uploads for insert to app_user with check (app.is_active() and user_id = app.current_user_id());
create policy refs_select on app.asset_refs for select to app_user using (app.can_view_presentation(presentation_id));
create policy refs_insert on app.asset_refs for insert to app_user with check (app.can_edit_presentation(presentation_id));
create policy refs_delete on app.asset_refs for delete to app_user using (app.can_edit_presentation(presentation_id));

-- comentários: leem e comentam todos que veem a apresentação; edição/moderação conforme o gatilho
create policy com_select on app.comments for select to app_user using (app.can_view_presentation(presentation_id));
create policy com_insert on app.comments for insert to app_user with check (app.can_view_presentation(presentation_id) and author_id = app.current_user_id());
create policy com_update on app.comments for update to app_user using (app.can_view_presentation(presentation_id)) with check (app.can_view_presentation(presentation_id));

-- interações: cada um escreve as suas; dono da apresentação e admin leem tudo
create policy inter_select on app.interactions for select to app_user using (app.is_active() and (user_id = app.current_user_id() or app.can_edit_presentation(presentation_id)));
create policy inter_insert on app.interactions for insert to app_user with check (user_id = app.current_user_id() and app.can_view_presentation(presentation_id));
create policy inter_update on app.interactions for update to app_user using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());
create policy inter_delete on app.interactions for delete to app_user using (app.is_active() and (user_id = app.current_user_id() or app.can_edit_presentation(presentation_id)));

-- ---------------------------------------------------------------------------------------------
-- Privilégios mínimos (tudo o que não está aqui é negado)
revoke all on all tables    in schema app from public, app_api, app_user, app_system;
revoke all on all functions in schema app from public;

grant select on app.directory to app_user, app_system;
grant select, update (display_name, role, status) on app.users to app_user;
grant insert (email, display_name, role, status, invited_by) on app.users to app_user;
grant select, insert, update on app.invites to app_user;
grant select, update (value, updated_at, updated_by) on app.settings to app_user;
grant select on app.audit_log to app_user;
grant select, insert, update, delete on app.presentations to app_user;
grant select, insert on app.presentation_versions to app_user;
grant select, insert on app.assets to app_user;
grant select, insert on app.asset_uploads to app_user;
grant select, insert, delete on app.asset_refs to app_user;
grant select, insert, update on app.comments to app_user;
grant select, insert, update, delete on app.interactions to app_user;

grant select, insert, update, delete on all tables in schema app to app_system;
revoke update on app.audit_log from app_system;       -- (o gatilho também barra; delete só na retenção)
grant usage, select on all sequences in schema app to app_user, app_system;

grant execute on function app.current_user_id(), app.is_active(), app.is_admin(), app.can_view_presentation(uuid), app.can_edit_presentation(uuid),
  app.audit(text,text,text,inet,text,text,jsonb) to app_user, app_system;
grant execute on function app.purge_expired(), app.prune_versions(uuid,int,int), app.orphan_assets(interval) to app_system;
-- únicas funções que a API pode chamar ANTES de haver usuário (login): identidade, limite de taxa e auditoria.
grant execute on function app.resolve_identity(text,text,text,boolean,boolean,boolean), app.hit_rate(text,text,int,int),
  app.audit(text,text,text,inet,text,text,jsonb) to app_api, app_user, app_system;

-- A API entra como app_api e troca para app_user/app_system por transação (SET LOCAL ROLE); a pertença é concedida em tools/migrate.js (bootstrap).
