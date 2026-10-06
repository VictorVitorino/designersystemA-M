/* src/db.js — acesso ao Postgres com RLS.
   A API conecta como `app_api` (sem privilégio em tabelas) e, em CADA requisição autenticada, abre UMA transação em que:
     SET LOCAL ROLE app_user  +  set_config('app.user_id', <uuid>, local)
   O que o usuário pode ver/alterar é decidido pelas políticas do banco (db/migrations/0003_security.sql), não por if no JavaScript.
   Funciona atrás de pooler em modo transação (Supabase/Supavisor, PgBouncer): sem prepared statements, tudo com SET LOCAL.
   Regra de ouro: SQL só com parâmetros do tagged template (`${x}`) — nunca concatenar texto vindo do cliente. */
import postgres from 'postgres';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDb({ url, max = 5, ssl, idleTimeout = 20, connectTimeout = 10 } = {}) {
  if (!url) throw new Error('DATABASE_URL ausente');
  const sql = postgres(url, { max, ssl, prepare: false, idle_timeout: idleTimeout, connect_timeout: connectTimeout, onnotice: () => {}, transform: { undefined: null } });
  return {
    sql,
    /** Transação como o usuário `userId` (RLS aplicada). */
    async asUser(userId, fn) {
      if (!UUID_RE.test(String(userId))) throw new Error('userId inválido');
      return sql.begin(async (tx) => {
        await tx`set local role app_user`;
        await tx`select set_config('app.user_id', ${String(userId)}, true)`;
        return fn(tx);
      });
    },
    /** Chamadas pré-login (resolve_identity, hit_rate, audit) como app_api, sem usuário. */
    async anon(fn) { return sql.begin((tx) => fn(tx)); },
    async ping() { const [r] = await sql`select 1 as ok`; return r.ok === 1; },
    async end() { await sql.end({ timeout: 5 }); },
  };
}

/** Conexão de OPERAÇÕES (ferramentas/jobs/testes de carga): papel app_system via app_ops. Nunca usada pela API. */
export function createOpsDb({ url, max = 3 } = {}) {
  const sql = postgres(url, { max, prepare: false, onnotice: () => {} });
  return { sql, async asSystem(fn) { return sql.begin(async (tx) => { await tx`set local role app_system`; return fn(tx); }); }, async end() { await sql.end({ timeout: 5 }); } };
}
