-- 0006_asset_owner.sql — a posse de um arquivo deriva SÓ da prova dos bytes (revisão adversarial de 2026-10-07, AF-2 residual).
-- Quem apenas pré-registrou um hash (POST /uploads sem nunca enviar bytes) não pode passar a ver o arquivo quando OUTRA pessoa o conclui:
-- ao promover de pending/deleted para ready, uploaded_by passa a ser quem conferiu os bytes (o chamador de asset_mark_ready).
create or replace function app.asset_mark_ready(p_sha text, p_size bigint, p_mime text, p_kind text, p_width int, p_height int)
  returns text language plpgsql security definer set search_path = pg_catalog, app
as $$
declare me uuid := app.current_user_id(); st text;
begin
  if me is null or not app.is_active() then return null; end if;
  -- Metadados vêm da validação feita pela API sobre os bytes reais: corrigem qualquer valor "declarado" por quem registrou antes.
  update app.assets a
     set status = 'ready', ready_at = now(), last_ref_at = now(), size_bytes = p_size, mime = p_mime, kind = p_kind, width = p_width, height = p_height,
         uploaded_by = me                                            -- quem provou os bytes é o dono do registro; o pré-registro não vale posse
   where a.sha256 = p_sha and a.status in ('pending', 'deleted')   -- 'deleted' = marcado pela coleta de lixo e reenviado antes da remoção (reativa)
     and (a.uploaded_by = me or exists (select 1 from app.asset_uploads u where u.sha256 = a.sha256 and u.user_id = me))
  returning a.status into st;
  if st is not null then return st; end if;
  -- Já pronto (ou rejeitado): devolve o estado, mas só a quem tem posse (não revela a existência de arquivos alheios).
  select a.status into st from app.assets a
   where a.sha256 = p_sha and (a.uploaded_by = me or exists (select 1 from app.asset_uploads u where u.sha256 = a.sha256 and u.user_id = me));
  return st;
end $$;
revoke all on function app.asset_mark_ready(text, bigint, text, text, int, int) from public;
grant execute on function app.asset_mark_ready(text, bigint, text, text, int, int) to app_user, app_system;
