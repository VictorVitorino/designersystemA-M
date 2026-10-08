/* Bloqueio de segurança do workflow manual de migração MVP Free.
   Não faz conexão nem altera banco: valida explicitamente ref, TLS e host do Supabase.
   Único destino permitido: projeto nomeado no ambiente GitHub mvp. */
const REF = /^[a-z0-9]{20}$/;

export function validateMvpDatabaseTarget({ confirmation, inputRef, environmentRef, url, apiPassword, opsPassword }) {
  if (confirmation !== 'MVP') throw new Error('confirmação inválida: digite MVP');
  if (!REF.test(inputRef || '') || inputRef !== environmentRef) {
    throw new Error('projeto Supabase informado diferente da variável SUPABASE_PROJECT_REF do ambiente mvp');
  }
  let u;
  try { u = new URL(url); } catch { throw new Error('DATABASE_ADMIN_URL inválida'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.pathname !== '/postgres') {
    throw new Error('conexão inválida: use o banco administrativo postgres');
  }
  if (u.searchParams.get('sslmode') !== 'require') throw new Error('migração MVP exige sslmode=require');
  const direct = u.hostname === 'db.' + inputRef + '.supabase.co' && u.username === 'postgres';
  const pooler = /^(?:[a-z0-9-]+\.)+pooler\.supabase\.com$/.test(u.hostname) && u.username === 'postgres.' + inputRef;
  if (!direct && !pooler) throw new Error('host/usuário não conferem com projeto Supabase MVP indicado');
  if (!u.password) throw new Error('conexão administrativa sem senha');
  if (typeof apiPassword !== 'string' || apiPassword.length < 16 || typeof opsPassword !== 'string' || opsPassword.length < 16 || apiPassword === opsPassword) {
    throw new Error('senhas de app_api/app_ops obrigatórias, distintas e com 16+ caracteres');
  }
  return { projectRef: inputRef, method: direct ? 'direct' : 'pooler' };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const result = validateMvpDatabaseTarget({
      confirmation: process.env.MVP_CONFIRMATION,
      inputRef: process.env.MVP_INPUT_REF,
      environmentRef: process.env.SUPABASE_PROJECT_REF,
      url: process.env.DATABASE_ADMIN_URL,
      apiPassword: process.env.APP_API_DB_PASSWORD,
      opsPassword: process.env.APP_OPS_DB_PASSWORD,
    });
    // Não registrar os segredos, a string de conexão ou os identificadores de usuário.
    console.log('Destino MVP validado: Supabase ' + result.projectRef + ' via ' + result.method + ' com TLS obrigatório.');
  } catch (e) { console.error('MVP bloqueado: ' + e.message); process.exitCode = 1; }
}
