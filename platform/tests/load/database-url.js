/* Seleciona o banco administrativo do ensaio de carga. Em runners com Postgres
   externo (serviço isolado do GitHub Actions), DATABASE_ADMIN_URL aponta para
   o banco de manutenção 'postgres', mas TODAS as leituras de carga precisam
   usar o canteiro_t_* criado pelo dev.js, nunca o banco de manutenção. */
import { externalTestDatabaseUrls } from '../../tools/external-test-db.js';

export function loadAdminUrl(env, dbName) {
  if (!/^canteiro_t_[a-z0-9_]+$/.test(dbName)) {
    throw new Error('ensaio de carga exige banco canteiro_t_* isolado');
  }
  // Em qualquer execução (CI ou local), o ensaio recria bancos e grava dados
  // fictícios. Uma DATABASE_ADMIN_URL remota NÃO pode chegar ao dev.js.
  if (env.E2E_EXTERNAL_POSTGRES === '1' && !env.DATABASE_ADMIN_URL) {
    throw new Error('runner exige DATABASE_ADMIN_URL local');
  }
  const localDefault = `postgres://postgres:postgres@127.0.0.1:5432/${dbName}`;
  const supplied = env.DATABASE_ADMIN_URL;
  const targetUrl = externalTestDatabaseUrls(supplied || localDefault, dbName).targetUrl;
  if (env.E2E_EXTERNAL_POSTGRES !== '1' && supplied) {
    // O dev.js local aplica migrações no URL recebido sem substituí-lo.
    // Exigir o banco correto antes de iniciar processos (mesma regra do dev local).
    const configured = new URL(supplied);
    if (configured.pathname !== '/' + dbName || configured.hash) {
      throw new Error('carga local exige DATABASE_ADMIN_URL com banco descartável de mesmo nome');
    }
  }
  return targetUrl;
}
