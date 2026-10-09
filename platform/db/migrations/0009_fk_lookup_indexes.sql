-- 0009_fk_lookup_indexes.sql
-- Índices para as dez chaves estrangeiras apontadas pelo Supabase Performance Advisor.
-- Melhora buscas para relacionamento, exclusão em cascata e SET NULL sem mudar dados/RLS.
-- DDL transacional; nomes estáveis; segura para reaplicação (if not exists).
-- Cada índice usa a coluna exata da FK como prefixo esquerdo (sem filtro parcial).
create index if not exists asset_uploads_user_fk_idx on app.asset_uploads (user_id);
create index if not exists comments_author_fk_idx on app.comments (author_id);
create index if not exists comments_resolver_fk_idx on app.comments (resolved_by);
create index if not exists invites_inviter_fk_idx on app.invites (invited_by);
create index if not exists invites_user_fk_idx on app.invites (user_id);
create index if not exists presentation_versions_creator_fk_idx on app.presentation_versions (created_by);
create index if not exists presentations_deleter_fk_idx on app.presentations (deleted_by);
create index if not exists presentations_updater_fk_idx on app.presentations (updated_by);
create index if not exists settings_updater_fk_idx on app.settings (updated_by);
create index if not exists users_inviter_fk_idx on app.users (invited_by);
