/* Regressão: nenhum erro externo deve vazar credenciais aos logs da API em staging. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { onError } from '../../src/middleware/error.js';

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
