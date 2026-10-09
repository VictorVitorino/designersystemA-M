/* Encerramento seguro da API Node: só fecha o Postgres após requests em andamento. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createGracefulStop, startupErrorLog } from '../../src/server.js';

test('stop é idempotente, suspende novos requests e aguarda fechamento antes do banco', async () => {
  const events = [];
  let finishClose;
  const server = {
    close: (cb) => { events.push('server.close'); finishClose = cb; },
    closeAllConnections: () => events.push('force'),
  };
  const db = { end: async () => { events.push('db.end'); } };
  const stop = createGracefulStop(server, db, { graceMs: 1000 });
  const p = stop();
  assert.strictEqual(stop(), p, 'vários SIGTERM/stop usam uma só Promise');
  assert.deepEqual(events, ['server.close']);
  await Promise.resolve();
  assert.deepEqual(events, ['server.close'], 'pool continua aberto durante request ativo');
  finishClose();
  await p;
  assert.deepEqual(events, ['server.close', 'db.end']);
  await stop();
  assert.deepEqual(events, ['server.close', 'db.end'], 'não fecha duas vezes');
});

test('tempo limite força fechamento de conexões e libera pool mesmo sem callback', async () => {
  let forced = 0, closed = 0;
  const stop = createGracefulStop({
    close: () => { closed++; },
    closeAllConnections: () => { forced++; },
  }, { end: async () => { closed++; } }, { graceMs: 25 });
  await stop();
  assert.deepEqual({ forced, closed }, { forced: 1, closed: 2 });
});

test('servidor já fechado ainda libera pool; erro inesperado não impede o encerramento do pool', async () => {
  let n = 0;
  const done = createGracefulStop({ close: (cb) => cb(Object.assign(new Error('not running'), { code: 'ERR_SERVER_NOT_RUNNING' })) },
    { end: async () => { n++; } }, { graceMs: 100 });
  await done();
  assert.equal(n, 1);
  const bad = createGracefulStop({ close: () => { throw new Error('close failed'); } },
    { end: async () => { n++; } }, { graceMs: 100 });
  await assert.rejects(bad(), /close failed/);
  assert.equal(n, 2, 'finally fecha banco mesmo se close lançar');
});

test('requisição HTTP real pode completar antes do Postgres ser encerrado no deploy', async () => {
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const server = createServer(async (req, res) => {
    events.push('request');
    started();
    await gate;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('salvo');
    events.push('response');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const stop = createGracefulStop(server, { end: async () => { events.push('db.end'); } }, { graceMs: 2000 });
  try {
    const responsePromise = fetch('http://127.0.0.1:' + server.address().port + '/save');
    await entered;
    const stopped = stop();
    await Promise.resolve();
    assert.ok(!events.includes('db.end'), 'não derrubou banco durante a gravação');
    release();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'salvo');
    await stopped;
    assert.ok(events.indexOf('response') < events.indexOf('db.end'), events.join(' → '));
  } finally {
    release();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});

test('log fatal de inicialização não vaza credenciais nem mensagens de dependências', () => {
  const secret = 'postgres://app_api:super-secret@db.example.test:5432/postgres';
  for (const err of [
    new Error('connection failed: ' + secret),
    Object.assign(new Error('timeout ' + secret), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('malicious ' + secret), { code: 'SECRET_' + secret }),
    new Error('Configuração insegura/incompleta: ' + secret),
  ]) {
    const line = startupErrorLog(err);
    assert.doesNotMatch(line, /super-secret|db\\.example\\.test|SECRET_/);
    assert.equal(JSON.parse(line).msg, 'startup_failed');
    assert.ok(['configuration', 'dependency', 'unexpected'].includes(JSON.parse(line).category));
  }
  const connection = JSON.parse(startupErrorLog(Object.assign(new Error('private'), { code: 'ECONNREFUSED' })));
  assert.deepEqual(connection, { level: 'fatal', msg: 'startup_failed', category: 'dependency', code: 'ECONNREFUSED' });
  const config = JSON.parse(startupErrorLog(new Error('Configuração insegura/incompleta: PRIVATE')));
  assert.equal(config.category, 'configuration');
});
