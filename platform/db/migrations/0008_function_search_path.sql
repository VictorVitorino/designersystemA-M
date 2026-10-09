-- 0008_function_search_path.sql
-- Protege o ambiente Supabase Free contra resolução dinâmica de objetos por search_path.
-- Auditoria de segurança: seis funções de contexto e gatilho estavam sem search_path fixo.
-- Não altera lógica, RLS, donos, permissões nem dados existentes.
alter function app.current_user_id() set search_path = pg_catalog, app;
alter function app.trg_audit_append_only() set search_path = pg_catalog, app;
alter function app.trg_comments_guard() set search_path = pg_catalog, app;
alter function app.trg_interactions_guard() set search_path = pg_catalog, app;
alter function app.trg_presentations_guard() set search_path = pg_catalog, app;
alter function app.trg_users_guard() set search_path = pg_catalog, app;
