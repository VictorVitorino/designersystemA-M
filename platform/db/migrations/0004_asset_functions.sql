-- 0004_asset_functions — funções SECURITY DEFINER que a API chama para promover/descartar arquivos e marcar uso (origem: proposta A3,
-- tests/helpers/extra-migration.sql). O app_user não tem UPDATE em app.assets: tudo passa por aqui, sempre em nome de app.current_user_id().

create or replace function app.asset_mark_ready(p_sha text, p_size bigint, p_mime text, p_kind text, p_width int, p_height int)
  returns text language plpgsql security definer set search_path = pg_catalog, app
as $$
declare me uuid := app.current_user_id(); st text;
begin
  if me is null or not app.is_active() then return null; end if;
  -- Metadados vêm da validação feita pela API sobre os bytes reais: corrigem qualquer valor "declarado" por quem registrou antes.
  update app.assets a
     set status = 'ready', ready_at = now(), last_ref_at = now(), size_bytes = p_size, mime = p_mime, kind = p_kind, width = p_width, height = p_height
   where a.sha256 = p_sha and a.status in ('pending', 'deleted')   -- 'deleted' = marcado pela coleta de lixo e reenviado antes da remoção (reativa)
     and (a.uploaded_by = me or exists (select 1 from app.asset_uploads u where u.sha256 = a.sha256 and u.user_id = me))
  returning a.status into st;
  if st is not null then return st; end if;
  -- Já pronto (ou rejeitado): devolve o estado, mas só a quem tem posse (não revela a existência de arquivos alheios).
  select a.status into st from app.assets a
   where a.sha256 = p_sha and (a.uploaded_by = me or exists (select 1 from app.asset_uploads u where u.sha256 = a.sha256 and u.user_id = me));
  return st;
end $$;

create or replace function app.asset_discard_pending(p_sha text)
  returns boolean language plpgsql security definer set search_path = pg_catalog, app
as $$
declare me uuid := app.current_user_id(); n int;
begin
  if me is null or not app.is_active() then return false; end if;
  delete from app.assets a
   where a.sha256 = p_sha and a.status = 'pending' and a.uploaded_by = me
     and not exists (select 1 from app.asset_uploads u where u.sha256 = a.sha256 and u.user_id <> me)
     and not exists (select 1 from app.asset_refs r where r.sha256 = a.sha256)
     and not exists (select 1 from app.presentations p where p.thumb_sha = a.sha256);
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function app.asset_touch(p_shas text[])
  returns int language plpgsql security definer set search_path = pg_catalog, app
as $$
declare me uuid := app.current_user_id(); n int;
begin
  if me is null or not app.is_active() or p_shas is null or cardinality(p_shas) > 5000 then return 0; end if;
  update app.assets a set last_ref_at = now()
   where a.sha256 = any (p_shas) and a.status in ('ready', 'pending', 'deleted')
     and (a.last_ref_at is null or a.last_ref_at < now() - interval '1 hour')     -- evita escrita a cada salvamento
     and (a.uploaded_by = me
          or exists (select 1 from app.asset_uploads u where u.sha256 = a.sha256 and u.user_id = me)
          or exists (select 1 from app.asset_refs r where r.sha256 = a.sha256 and app.can_edit_presentation(r.presentation_id)));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function app.asset_mark_ready(text, bigint, text, text, int, int), app.asset_discard_pending(text), app.asset_touch(text[]) from public;
grant execute on function app.asset_mark_ready(text, bigint, text, text, int, int), app.asset_discard_pending(text), app.asset_touch(text[]) to app_user, app_system;
