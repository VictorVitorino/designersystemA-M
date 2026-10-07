-- 0005_hardening.sql — correções da revisão ofensiva e do teste de carga (2026-10-06). Idempotente: pode ser reaplicada sem efeito.
-- Ver docs/SEGURANCA.md (AF-5) e docs/evidencias/carga.md (A6).

-- AF-5 ─ Um arquivo que só aparece em VERSÕES ANTIGAS (histórico, privado ao dono/admin) não pode ser lido por quem só vê a cópia de trabalho.
--        A cópia de trabalho é version_no = 0; versões > 0 seguem a regra de edição (dono/admin), não a de visualização.
drop policy if exists assets_select on app.assets;
create policy assets_select on app.assets for select to app_user using (
  app.is_active() and (uploaded_by = app.current_user_id() or app.is_admin()
    or exists (select 1 from app.asset_uploads u where u.sha256 = assets.sha256 and u.user_id = app.current_user_id())
    or exists (select 1 from app.asset_refs r where r.sha256 = assets.sha256 and r.version_no = 0 and app.can_view_presentation(r.presentation_id))
    or exists (select 1 from app.asset_refs r where r.sha256 = assets.sha256 and r.version_no > 0 and app.can_edit_presentation(r.presentation_id))
    or exists (select 1 from app.presentations p where p.thumb_sha = assets.sha256 and app.can_view_presentation(p.id))));

-- A6 ─ O autosave reescreve o deck inteiro (jsonb em TOAST) a cada 3–5 s: o autovacuum padrão (20 % da tabela) não acompanha e a tabela incha
--      (medido: 761 tuplas mortas para 728 vivas após 5 100 salvamentos). Limiares agressivos nas tabelas reescritas e na TOAST associada.
alter table app.presentations set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 200, autovacuum_analyze_scale_factor = 0.05, autovacuum_vacuum_cost_delay = 2,
  toast.autovacuum_vacuum_scale_factor = 0.02, toast.autovacuum_vacuum_threshold = 200, toast.autovacuum_vacuum_cost_delay = 2);
alter table app.presentation_versions set (
  autovacuum_vacuum_scale_factor = 0.05, toast.autovacuum_vacuum_scale_factor = 0.05);
alter table app.rate_limits set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500);

-- Compressão lz4 do conteúdo (mais rápida que pglz e ~20–30 % menor em JSON): só onde o servidor foi compilado com lz4 (Supabase e Postgres 16 oficiais têm).
do $$
begin
  execute 'alter table app.presentations alter column content set compression lz4';
  execute 'alter table app.presentation_versions alter column content set compression lz4';
exception when others then
  raise notice 'compressão lz4 indisponível neste servidor (%); mantendo pglz', sqlerrm;
end $$;
