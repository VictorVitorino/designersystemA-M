import postgres from 'postgres';
import { createDb, createOpsDb } from '../../src/db.js';
import { migrate } from '../../tools/migrate.js';

export const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://postgres:postgres@127.0.0.1:5432/canteiro_test';
const base = new URL(ADMIN_URL);
const withCreds = (u, p) => { const x = new URL(ADMIN_URL); x.username = u; x.password = p; return x.toString(); };
export const API_PW = 'app_api_test', OPS_PW = 'app_ops_test';
export const API_URL = withCreds('app_api', API_PW), OPS_URL = withCreds('app_ops', OPS_PW);

export async function setup() {
  // hermético: recria o schema do zero (o banco de teste é descartável; nunca aponte TEST_DATABASE_ADMIN_URL para dados reais)
  if (!/\/canteiro_(test|t_[a-z0-9_]+)$/.test(base.pathname)) throw new Error('recuso rodar testes destrutivos em ' + base.pathname);
  const pre = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await pre.unsafe('drop schema if exists app cascade'); await pre.unsafe('drop table if exists public.schema_migrations'); await pre.end();
  await migrate(ADMIN_URL, { apiPassword: API_PW, log: () => {} , roles: true });
  process.env.APP_OPS_DB_PASSWORD = OPS_PW;
  // define a senha do app_ops (migrate lê APP_OPS_DB_PASSWORD no bootstrap; garantimos aqui também)
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`alter role app_ops with login password '${OPS_PW}'`);
  await admin.end();
  return { db: createDb({ url: API_URL, max: 4 }), ops: createOpsDb({ url: OPS_URL }) };
}

let n = 0;
export async function mkUser(ops, { role = 'member', status = 'active', name } = {}) {
  n++;
  const email = `u${Date.now().toString(36)}${n}@am.test`;
  const [u] = await ops.asSystem((tx) => tx`insert into app.users(email, display_name, role, status) values (${email}, ${name || 'Usuário ' + n}, ${role}, ${status}) returning id, email`);
  return u;
}
export const hash64 = (c = 'a') => c.repeat(64).slice(0, 64);
export async function mkPres(db, ownerId, title = 'Minha apresentação') {
  return db.asUser(ownerId, async (tx) => {
    const [p] = await tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count) values (${ownerId}, ${title}, ${tx.json({ v: 1, slides: [] })}, ${hash64('b')}, 1) returning id`;
    return p.id;
  });
}
/** Executa e devolve {ok, code, message} em vez de lançar (para asserções de negação). */
export async function attempt(fn) { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } }
