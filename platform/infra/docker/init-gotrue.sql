-- Só para o perfil "completo" do docker-compose (GoTrue no mesmo Postgres). Roda UMA vez, na criação do volume.
-- A senha real vem de GOTRUE_DB_PASSWORD: ajuste com `ALTER ROLE supabase_auth_admin PASSWORD '…'` depois do primeiro start (não deixe senha neste arquivo).
CREATE SCHEMA IF NOT EXISTS auth;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE NOREPLICATION PASSWORD 'trocar-depois-do-primeiro-start';
  END IF;
END $$;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth;
