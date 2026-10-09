/* Readiness sem banco real: burst concorrente, TTL, falhas e sigilo dos logs.
   Rodar: node --test tests/unit/health-readiness.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { healthRoutes } from '../../src/routes/health.js';

function fixture(over = {}) {
  const calls = { db: 0, storage: 0, auth: 0, migrations: 0 };
  const warnings = [];
  const deps = {
    config: { appEnv: 'test', release: 'ready-unit' },
    logger: { warn: (name, fields) => warnings.push({ name, fields }) },
    db: {
      ping: async () => { calls.db++; return true; },
      anon: async (fn) => {
        calls.migrations++;
        return fn(() => [{ ok: true }]);
      },
    },
    storage: { ping: async () => { calls.storage++; return true; } },
    gotrue: { health: async () => { calls.auth++; return true; } },
  };
  for (const key of ['db', 'storage', 'gotrue']) Object.assign(deps[key], over[key] || {});
  const app = new Hono();
  app.route('/api', healthRoutes(deps));
  return { app, calls, warnings };
}

const read = async (r) => ({ status: r.status, body: await r.json() });
const OK = { db: true, storage: true, auth: true, migrations: true };

test('40 sondas simultâneas dividem uma única checagem das quatro dependências', async () => {
  let release, signal;
  const entered = new Promise((resolve) => { signal = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const { app, calls } = fixture({
    db: { ping: async () => { calls.db++; signal(); return waiting; } },
  });
  const batch = Array.from({ length: 40 }, () => app.request('/api/ready'));
  await entered;
  assert.equal(calls.db, 1, 'uma única checagem enquanto as 40 requisições aguardam');
  release(true);
  const values = await Promise.all(batch);
  for (const response of values) {
    const { status, body } = await read(response);
    assert.equal(status, 200);
    assert.deepEqual(body, OK);
  }
  assert.deepEqual(calls, { db: 1, storage: 1, auth: 1, migrations: 1 });
  const cached = await read(await app.request('/api/ready'));
  assert.equal(cached.status, 200);
  assert.deepEqual(calls, { db: 1, storage: 1, auth: 1, migrations: 1 });
});

test('estado negativo permanece por 5 segundos e é reavaliado após expirar, sem 200 obsoleto', async () => {
  const oldNow = Date.now;
  let clock = 1_000_000, dbHealthy = true;
  Date.now = () => clock;
  try {
    const { app, calls } = fixture({
      db: { ping: async () => { calls.db++; return dbHealthy; } },
    });
    assert.deepEqual(await read(await app.request('/api/ready')), { status: 200, body: OK });
    dbHealthy = false;
    clock += 4999;
    assert.equal((await app.request('/api/ready')).status, 200, 'cache de 5 s');
    clock += 2;
    const down = await read(await app.request('/api/ready'));
    assert.equal(down.status, 503);
    assert.deepEqual(down.body, { ...OK, db: false });
    assert.equal(calls.db, 2, 'fez nova medição');
    dbHealthy = true;
    assert.equal((await app.request('/api/ready')).status, 503, 'falha recente não é escondida');
    clock += 5001;
    assert.equal((await app.request('/api/ready')).status, 200, 'recuperação é reconhecida');
    assert.deepEqual(calls, { db: 3, storage: 3, auth: 3, migrations: 3 });
  } finally {
    Date.now = oldNow;
  }
});

test('erro de dependência não expõe senha, token ou URL nos logs nem na resposta', async () => {
  const secret = 'postgres://admin:senha-super-secreta@db.exemplo.test:5432/canteiro?token=abc';
  const { app, warnings } = fixture({ db: { ping: async () => { throw new Error(secret); } } });
  const result = await read(await app.request('/api/ready'));
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ...OK, db: false });
  assert.deepEqual(warnings, [{ name: 'ready_check_failed', fields: { check: 'db', kind: 'dependency_error' } }]);
  assert.ok(!JSON.stringify({ result, warnings }).includes(secret), 'nenhum detalhe do driver vazou');
  assert.equal((await app.request('/api/health')).status, 200, '/health independe do banco');
});

test('dependência travada devolve 503 após o limite e o trabalho tardio não altera o cache', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { app, calls, warnings } = fixture({ gotrue: { health: () => { calls.auth++; return pending; } } });
  const [r1, r2] = await Promise.all([app.request('/api/ready'), app.request('/api/ready')]);
  assert.equal(r1.status, 503);
  assert.equal(r2.status, 503);
  assert.deepEqual(await r1.json(), { ...OK, auth: false });
  assert.equal(calls.auth, 1, 'timeout em uma checagem compartilhada');
  assert.deepEqual(warnings, [{ name: 'ready_check_failed', fields: { check: 'auth', kind: 'timeout' } }]);
  release(true); // a conclusão tardia da operação externa não deve mudar o estado publicado
  await Promise.resolve();
  assert.equal((await app.request('/api/ready')).status, 503);
  assert.equal(calls.auth, 1);
});
