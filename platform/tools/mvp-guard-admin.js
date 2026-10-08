/* Protege o PRIMEIRO convite do MVP contra bancos de outros projetos.
   A execução CI só usa app_ops (nunca o superusuário) e uma chave Auth guardada em Secret. */
const PROJECT_REF = /^[a-z0-9]{20}$/;
const POOLER = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;
const SIMPLE_SECRET = /^sb_secret_[A-Za-z0-9_-]{12,}$/;
const LEGACY_JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

export function validateMvpAdminTarget({ confirmation, projectRef, environmentRef, opsUrl, supabaseUrl, serviceKey }) {
  if (confirmation !== 'ADMIN-MVP') throw new Error('digite ADMIN-MVP para autorizar o primeiro convite');
  if (!PROJECT_REF.test(projectRef || '') || environmentRef !== projectRef) throw new Error('projeto diverge do ambiente mvp');
  let db, auth;
  try { db = new URL(opsUrl); auth = new URL(supabaseUrl); }
  catch { throw new Error('conexão do banco ou endereço do Supabase inválido'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.pathname !== '/postgres'
      || db.port !== '5432' || db.searchParams.get('sslmode') !== 'require'
      || !db.password || db.hash) throw new Error('banco de operações requer postgres, 5432, /postgres, senha e TLS');
  const direct = db.hostname === 'db.' + projectRef + '.supabase.co' && db.username === 'app_ops';
  const pooler = POOLER.test(db.hostname) && db.username === 'app_ops.' + projectRef;
  if (!direct && !pooler) throw new Error('conexão de operações fora do Supabase MVP ou usuário diferente de app_ops');
  if (auth.origin !== 'https://' + projectRef + '.supabase.co'
      || auth.pathname !== '/' || auth.search || auth.hash || auth.username || auth.password)
    throw new Error('Supabase Auth não pertence ao projeto MVP');
  if (!SIMPLE_SECRET.test(String(serviceKey || '')) && !LEGACY_JWT.test(String(serviceKey || '')))
    throw new Error('chave secreta do Supabase Auth ausente ou inválida');
  return { ref: projectRef, connection: direct ? 'direct' : 'session-pooler' };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const d = validateMvpAdminTarget({
      confirmation: process.env.MVP_ADMIN_CONFIRMATION,
      projectRef: process.env.MVP_PROJECT_REF,
      environmentRef: process.env.SUPABASE_PROJECT_REF,
      opsUrl: process.env.DATABASE_OPS_URL,
      supabaseUrl: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    });
    console.log('Destino do convite MVP conferido: projeto ' + d.ref + ', papel app_ops, TLS obrigatório.');
  } catch (e) { console.error('Primeiro admin MVP bloqueado: ' + e.message); process.exitCode = 1; }
}
