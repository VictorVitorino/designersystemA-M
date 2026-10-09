/* O servidor local recria/atualiza esquemas. Nunca deve migrar um banco remoto
   só porque DATABASE_ADMIN_URL estava exportada no shell de outro projeto.
   O runner E2E externo possui outra validação (external-test-db.js). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function localDevAdminUrl(value, database) {
  if (!/^canteiro_(dev|t_[a-z0-9_]+|e2e[a-z0-9_]*)$/.test(database || '')) {
    throw new Error('banco de desenvolvimento deve ter nome descartável autorizado');
  }
  const candidate = value || `postgres://postgres:postgres@127.0.0.1:5432/${database}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('DATABASE_ADMIN_URL inválida para desenvolvimento'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !LOCAL_HOSTS.has(url.hostname) ||
      url.pathname !== '/' + database ||
      url.search || url.hash) {
    // Não incluir a URL nem o erro original: podem conter credenciais.
    throw new Error('DATABASE_ADMIN_URL de desenvolvimento exige PostgreSQL loopback e banco de mesmo nome');
  }
  return url.toString();
}
