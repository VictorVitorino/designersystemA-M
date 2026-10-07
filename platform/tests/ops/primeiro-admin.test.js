import './_env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setup, OPS_URL, freshDb, dropDb } from './_helpers.js';
import { explicarErro } from '../../tools/create-first-admin.js';
import { withDatabase } from '../../tools/lib/pg.js';

// Assistente "Criar primeiro administrador": as falhas comuns da primeira vez viram "o que fazer" (sem segredos), e nada fica gravado.
const dbs = []; let ops = null;
before(async () => { const s = await setup(); await s.db.end(); ops = s.ops; });
after(async () => { if (ops) await ops.end(); for (const u of dbs) await dropDb(u).catch(() => {}); });

const CHAVE = ['sb', 'secret', 'chave_de_teste_que_nao_pode_aparecer_1234'].join('_');   // montada em partes: não é segredo, e a varredura de segredos não confunde
function cli(env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['tools/create-first-admin.js', '--email', 'primeira@am.test', '--name', 'Primeira Pessoa'], { cwd: new URL('../..', import.meta.url).pathname, env: { PATH: process.env.PATH, ...env } });
    let out = ''; p.stdout.on('data', (x) => { out += x; }); p.stderr.on('data', (x) => { out += x; }); p.on('exit', (code) => resolve({ code, out }));
  });
}
/** Supabase Auth falso: responde ao convite com o status pedido. */
async function authFalso(status) {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(status < 300 ? { id: '00000000-0000-4000-8000-000000000001', email: 'primeira@am.test' } : { msg: 'erro do provedor com ' + CHAVE })); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, fechar: () => new Promise((r) => srv.close(r)) };
}

test('explicarErro: banco sem o Canteiro, senha do app_ops, usuário desconhecido no pooler, rede e respostas do Supabase', () => {
  assert.match(explicarErro({ code: '42P01', message: 'relation "app.users" does not exist' }), /Publique o ambiente primeiro/);
  assert.match(explicarErro({ code: '22023', message: 'role "app_system" does not exist' }), /Publique o ambiente primeiro/);
  assert.match(explicarErro({ code: '28P01', message: 'password authentication failed for user "app_ops"' }), /APP_OPS_DB_PASSWORD/);
  assert.match(explicarErro({ code: 'XX000', message: 'Tenant or user not found' }), /SUPABASE_PROJECT_REF/);
  assert.match(explicarErro({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' }), /não consegui conectar/);
  assert.match(explicarErro({ message: 'Serviço de autenticação indisponível.' }, { statusSupabase: 401 }), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(explicarErro({ message: 'x' }, { statusSupabase: 500 }), /Configurar Supabase.+Resend/);
  assert.match(explicarErro({ message: 'x' }, { statusSupabase: 429 }), /1 hora/);
  assert.equal(explicarErro(new Error('limite de 5 reenvios atingido')), 'limite de 5 reenvios atingido', 'as mensagens próprias passam como estão');
});

test('CLI: banco ainda não publicado → "publique primeiro"; senha errada → APP_OPS_DB_PASSWORD; chave recusada → nada gravado; sucesso → convite', async () => {
  const vazio = await freshDb('pavazio'); dbs.push(vazio);
  const f = await authFalso(401); const ok = await authFalso(200);
  try {
    const base = { SUPABASE_SERVICE_ROLE_KEY: CHAVE };
    let r = await cli({ ...base, DATABASE_OPS_URL: withDatabase(OPS_URL, new URL(vazio).pathname.slice(1)), SUPABASE_URL: f.url });
    assert.equal(r.code, 1); assert.match(r.out, /Erro: o banco deste ambiente ainda não tem o Canteiro instalado/);
    const errada = new URL(OPS_URL); errada.password = 'senha-errada-de-proposito';
    r = await cli({ ...base, DATABASE_OPS_URL: errada.toString(), SUPABASE_URL: f.url });
    assert.equal(r.code, 1); assert.match(r.out, /APP_OPS_DB_PASSWORD/);
    r = await cli({ ...base, DATABASE_OPS_URL: OPS_URL, SUPABASE_URL: f.url });
    assert.equal(r.code, 1); assert.match(r.out, /recusou a chave secreta/); assert.ok(!r.out.includes(CHAVE), 'nunca mostra a chave nem o corpo do provedor');
    const [n] = await ops.asSystem((tx) => tx`select count(*)::int as n from app.users where email = 'primeira@am.test'`); assert.equal(n.n, 0, 'convite falhou → nada gravado (transação desfeita)');
    r = await cli({ ...base, DATABASE_OPS_URL: OPS_URL, SUPABASE_URL: ok.url });
    assert.equal(r.code, 0, r.out); assert.match(r.out, /Convite enviado/);
    const [u] = await ops.asSystem((tx) => tx`select role, status from app.users where email = 'primeira@am.test'`); assert.deepEqual([u.role, u.status], ['admin', 'invited']);
  } finally { await f.fechar(); await ok.fechar(); }
});
