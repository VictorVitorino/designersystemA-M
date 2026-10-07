/* tools/lib/api-env.js — nomes de variáveis que NUNCA podem existir no ambiente da API (Vercel): são credenciais de ferramentas/CI.
   Usado por tools/verify-deploy.js (confere a lista de nomes publicada) e por tools/vercel-setup.js (nunca grava; remove se alguém pôs à mão).
   A API também recusa iniciar com DATABASE_ADMIN_URL/DATABASE_OPS_URL (src/config.js). */
export const FORBIDDEN_API_ENV = [/^DATABASE_ADMIN_URL$/, /^DATABASE_OPS_URL$/, /^APP_API_DB_PASSWORD$/, /^APP_OPS_DB_PASSWORD$/, /^BACKUP_/, /^VERCEL_TOKEN$/, /^SUPABASE_DB_PASSWORD$/, /^SUPABASE_ACCESS_TOKEN$/, /^GITHUB_TOKEN$/, /^TEST_DATABASE_/, /^RESEND_API_KEY$/];
