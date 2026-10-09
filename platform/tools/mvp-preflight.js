/* Verificação local (sem rede) da configuração do Render Free.
   Falha ANTES de iniciar a API quando banco/Auth/arquivos não pertencem ao mesmo projeto.
   Não imprime URLs com credenciais nem valores de segredo. */
import { verifyUrl } from './mvp-smoke.js';

// Isolamento deliberado: o Blueprint Render do piloto usa SOMENTE o projeto Supabase
// canteiro-mvp. Não basta conferir que Auth, banco e S3 têm a mesma ref:
// eles poderiam estar todos apontando para outra iniciativa por engano.
const CANTEIRO_PROJECT_REF = 'fgdrjxuhzagmvqyhrqlf';
const POOLER = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;

export function validateMvpRuntime(env) {
  if (env.APP_ENV !== 'staging') throw new Error('MVP gratuito exige APP_ENV=staging');
  try { verifyUrl(env.APP_ORIGIN); }
  catch { throw new Error('APP_ORIGIN deve ser a URL HTTPS exata do serviço Render Free'); }
  let auth, db;
  try { auth = new URL(env.SUPABASE_URL); db = new URL(env.DATABASE_URL); }
  catch { throw new Error('SUPABASE_URL ou DATABASE_URL ausente/inválida'); }
  const ref = auth.hostname.split('.')[0];
  if (ref !== CANTEIRO_PROJECT_REF || auth.origin !== 'https://' + ref + '.supabase.co'
      || auth.pathname !== '/' || auth.search || auth.hash || auth.username || auth.password)
    throw new Error('SUPABASE_URL deve apontar ao projeto Supabase exclusivo do MVP');
  // get('sslmode') retorna só a primeira ocorrência. Uma URL com parâmetros
  // duplicados (ou alias ssl=false) seria aceita, embora o driver possa interpretar
  // outro valor. Rejeitar configurações TLS ambíguas antes de iniciar a API.
  const sslModes = db.searchParams.getAll('sslmode');
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.pathname !== '/postgres'
      || !['5432', '6543'].includes(db.port) || sslModes.length !== 1 || sslModes[0] !== 'require'
      || db.searchParams.has('ssl') || !db.password || db.hash || env.DATABASE_SSL !== 'require')
    throw new Error('DATABASE_URL precisa de usuário restrito, porta PostgreSQL válida e TLS obrigatório');
  const direct = db.hostname === 'db.' + ref + '.supabase.co' && db.username === 'app_api' && db.port === '5432';
  const pooler = POOLER.test(db.hostname) && db.username === 'app_api.' + ref;
  if (!direct && !pooler) throw new Error('Banco incorreto: use o papel app_api do mesmo projeto Supabase');
  if (env.SUPABASE_JWKS_URL !== auth.origin + '/auth/v1/.well-known/jwks.json')
    throw new Error('SUPABASE_JWKS_URL não corresponde ao projeto Supabase MVP');
  const service = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  const anon = String(env.SUPABASE_ANON_KEY || '');
  if (service.length < 16 || anon.length < 10 || service === anon
      || service.startsWith('sb_publishable_') || anon.startsWith('sb_secret_'))
    throw new Error('chaves de autenticação ausentes, trocadas ou idênticas');
  const csrf = String(env.CSRF_SECRET || '');
  if (csrf.length < 32) throw new Error('CSRF_SECRET precisa ser aleatório e ter ao menos 32 caracteres');
  // Projeto MVP exclusivo: não aceitar bucket/região arbitrários. Sem esta checagem,
  // um valor digitado incorretamente no Render passaria no preflight e falharia só ao enviar arquivos.
  if (env.STORAGE_DRIVER !== 's3' || env.S3_FORCE_PATH_STYLE !== 'true'
      || env.S3_ENDPOINT !== 'https://' + ref + '.storage.supabase.co/storage/v1/s3'
      || env.S3_REGION !== 'sa-east-1' || env.S3_BUCKET !== 'canteiro-mvp-files'
      || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
    throw new Error('Storage S3 exige bucket canteiro-mvp-files e região sa-east-1 do projeto Supabase dedicado');
  // Number(undefined), Number('NaN') e Number('Infinity') passam por comparações
  // simples de faixa; rejeitar explicitamente evita configurar o MVP sem teto real.
  const poolMax = Number(env.DB_POOL_MAX);
  const quotaMb = Number(env.STORAGE_QUOTA_USER_MB);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 5)
    throw new Error('DB_POOL_MAX no piloto deve ser inteiro entre 1 e 5');
  if (!Number.isInteger(quotaMb) || quotaMb < 1 || quotaMb > 100)
    throw new Error('STORAGE_QUOTA_USER_MB no piloto deve ser inteiro entre 1 e 100');
  for (const k of ['DATABASE_ADMIN_URL', 'DATABASE_OPS_URL', 'APP_OPS_DB_PASSWORD'])
    if (env[k]) throw new Error(k + ' não pode estar no ambiente do servidor Render');
  return { projectRef: ref, hosting: 'render-free', databaseRole: 'app_api', quotaMb };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const r = validateMvpRuntime(process.env);
    console.log('MVP validado antes de iniciar: Render HTTPS, papel ' + r.databaseRole
      + ', TLS, Auth e Storage do projeto ' + r.projectRef + ' com cota de ' + r.quotaMb + ' MB por usuário.');
  } catch (e) { console.error('MVP bloqueado antes de iniciar: ' + e.message); process.exitCode = 1; }
}
