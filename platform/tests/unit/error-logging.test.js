/* Regressão: nenhum erro externo deve vazar credenciais aos logs da API em staging. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { onError } from '../../src/middleware/error.js';
import { accessLog } from '../../src/middleware/access-log.js';
import { E } from '../../src/lib/errors.js';

test('erro imprevisto no Render retorna HTTP 500 genérico e log sem dados sensíveis', async () => {
  const app = new Hono();
  app.get('/probe/:secret', () => {
    const error = new Error('postgres://app_api:example-secret@invalid.local/postgres token=example-token');
    error.code = 'BAD_SECRET/example-token';
    throw error;
  });
  app.onError(onError({ config: { appEnv: 'staging', logLevel: 'error', release: 'unit' } }));
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = function (chunk) { lines.push(String(chunk)); return true; };
  let response;
  try {
    response = await app.request('http://localhost/probe/path-example-token');
  } finally {
    process.stderr.write = write;
  }
  assert.equal(response.status, 500);
  const body = JSON.stringify(await response.json());
  assert.ok(!body.includes('example-secret') && !body.includes('example-token'), 'HTTP não expõe detalhe interno');
  const log = lines.join('');
  assert.ok(lines.length >= 1, 'falha inesperada precisa ser observável');
  assert.match(log, /"msg":"unhandled"/);
  assert.match(log, /"code":"unknown"/);
  for (const sensitive of ['example-secret', 'example-token', 'invalid.local', 'postgres://', 'path-example-token']) {
    assert.ok(!log.includes(sensitive), 'log expôs entrada sensível');
  }
});

test('log de acesso registra padrão da rota, nunca o identificador sensível no path', async () => {
  const recorded = [];
  const logger = { info: (message, fields) => recorded.push({ message, fields }), error: (message, fields) => recorded.push({ message, fields }) };
  const app = new Hono();
  app.use('*', accessLog({ logger }));
  app.get('/presentations/:id', (c) => c.text('ok'));
  const response = await app.request('http://localhost/presentations/example-sensitive-value');
  assert.equal(response.status, 200);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].message, 'http');
  assert.equal(recorded[0].fields.route, '/presentations/:id');
  assert.ok(!JSON.stringify(recorded).includes('example-sensitive-value'));
});

test('erro HTTP 503 conhecido não registra parâmetro da URL nos logs', async () => {
  const app = new Hono();
  app.get('/probe/:secret', () => { throw E.unavailable(); });
  app.onError(onError({ config: { appEnv: 'staging', logLevel: 'error', release: 'unit' } }));
  const lines = [];
  const oldWrite = process.stderr.write;
  process.stderr.write = function (chunk) { lines.push(String(chunk)); return true; };
  let response;
  try { response = await app.request('http://localhost/probe/sensitive-token'); }
  finally { process.stderr.write = oldWrite; }
  assert.equal(response.status, 503);
  const log = lines.join('');
  assert.match(log, /"msg":"http_error"/);
  assert.ok(!log.includes('sensitive-token'));
});
