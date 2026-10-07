/* tools/lib/pooler.js — descobre o servidor do "pooler" (Supavisor) do projeto Supabase, para montar as URLs de conexão sem a pessoa precisar copiá-las.

   Por que descobrir: o host do pooler depende do "cluster" em que o projeto caiu (aws-0-sa-east-1…, aws-1-sa-east-1…) e não dá para deduzir só do ref.
   Como: tenta conectar (TLS obrigatório) como postgres.<ref> em cada candidato da região, em modo sessão (porta 5432):
     • "Tenant or user not found" / nome inexistente / sem resposta → é outro cluster: tenta o próximo;
     • "password authentication failed" → achou o projeto, mas a SENHA está errada: para e diz isso com clareza (não adianta tentar outros).
   A conexão direta (db.<ref>.supabase.co) não é usada: ela é só IPv6 e os runners do GitHub não têm IPv6. */
import { ToolError, buildRedactor } from './common.js';
import { poolerCandidatos, REGIAO_PADRAO } from './chaves.js';

/** Conecta e roda `select 1` (pacote postgres, sem prepared statements, TLS obrigatório, 10 s de limite). */
export async function conectarReal({ host, port, user, password, database = 'postgres', ssl = 'require' }) {
  const { default: postgres } = await import('postgres');
  const sql = postgres({ host, port, user, password, database, ssl, max: 1, connect_timeout: 10, idle_timeout: 2, prepare: false, onnotice: () => {} });
  try { await sql`select 1 as ok`; } finally { await sql.end({ timeout: 2 }).catch(() => {}); }
}

const SENHA_ERRADA = (e) => e?.code === '28P01' || /password authentication failed/i.test(String(e?.message || ''));
const OUTRO_CLUSTER = (e) => /tenant or user not found|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout|CONNECT_TIMEOUT/i.test(`${e?.code || ''} ${e?.message || ''}`);

/**
 * @param {{ref:string, password:string, regiao?:string, user?:string, candidatos?:string[], conectar?:Function, log?:Function}} o
 * @returns {Promise<{host:string, tentativas:string[]}>}
 */
export async function descobrirPooler({ ref, password, regiao = REGIAO_PADRAO, user, candidatos, conectar = conectarReal, log = () => {} }) {
  if (!ref) throw new ToolError('falta SUPABASE_PROJECT_REF para descobrir o servidor do banco', { code: 'no_ref', exit: 2 });
  if (!password) throw new ToolError('falta a senha do banco (SUPABASE_DB_PASSWORD) para descobrir o servidor do banco', { code: 'no_password', exit: 2 });
  const usuario = user || `postgres.${ref}`; const lista = candidatos || poolerCandidatos(regiao);
  const redact = buildRedactor({}, [password, encodeURIComponent(password)]); const tentativas = [];
  for (const host of lista) {
    try { await conectar({ host, port: 5432, user: usuario, password }); log(`servidor do banco (pooler, modo sessão): ${host}`); return { host, tentativas }; }
    catch (e) {
      if (SENHA_ERRADA(e)) throw new ToolError(`o servidor ${host} encontrou o projeto ${ref}, mas RECUSOU a senha do usuário ${usuario}: confira o segredo SUPABASE_DB_PASSWORD (é a senha do banco escolhida ao criar o projeto; para trocar: Supabase → Project Settings → Database → Reset database password)`, { code: 'bad_password', exit: 2 });
      const msg = redact(`${e?.code ? e.code + ' ' : ''}${String(e?.message || e).split('\n')[0]}`).slice(0, 160);
      tentativas.push(`${host}: ${msg}`);
      if (!OUTRO_CLUSTER(e)) log(`aviso: ${host} respondeu de um jeito inesperado (${msg}); tentando o próximo`);
    }
  }
  throw new ToolError(`não achei o servidor do banco (pooler) do projeto ${ref} na região ${regiao}. Tentativas:\n  - ${tentativas.join('\n  - ')}\nConfira a variável SUPABASE_PROJECT_REF. Se o projeto não estiver em São Paulo, defina a variável SUPABASE_REGION (ex.: us-east-1); ou copie o host em Supabase → Connect → Session pooler e cadastre a variável SUPABASE_POOLER_HOST.`, { code: 'no_pooler', exit: 2 });
}
