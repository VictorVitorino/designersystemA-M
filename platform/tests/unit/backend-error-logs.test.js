/* Regression: errors from Postgres/Auth/storage must never print credentials.
   Logs contain stable event metadata and safe technical codes only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { onError } from '../../src/middleware/error.js';
import { logStartupFailure } from '../../src/server.js';

function failingApi(error, appEnv) {
  const entries = [];
  const app = new Hono();
  app.get('/api/failure', () => { throw error; });
  app.onError(onError({
    config: { appEnv, logLevel: 'info' },
    logger: { error: (name, fields) => entries.push({ name, fields }) },
  }));
  return { app, entries };
}

test('API: driver error message, stack and arbitrary code never reach logs or client', async () => {
  const secret = 'postgres://app_api:top-secret-password@db.example.invalid:5432/postgres?token=secret-token';
  for (const appEnv of ['test', 'production']) {
    const error = Object.assign(new Error('database failed: ' + secret), {
      code: 'credentials=' + secret,
      stack: 'Error: database failed: ' + secret,
    });
    const { app, entries } = failingApi(error, appEnv);
    const response = await app.request('/api/failure');
    assert.equal(response.status, 500);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'unhandled');
    assert.equal(entries[0].fields.kind, 'internal_error');
    assert.equal(entries[0].fields.method, 'GET');
    assert.equal(entries[0].fields.code, undefined);
    const combined = JSON.stringify(entries) + await response.text();
    assert.ok(!combined.includes(secret), 'credentials must not be exposed in ' + appEnv);
    assert.ok(!combined.includes('top-secret-password'));
  }
});

test('API: recognized Postgres SQLSTATE and network codes preserve safe diagnostics', async () => {
  for (const code of ['42P01', 'ECONNRESET']) {
    const { app, entries } = failingApi(Object.assign(new Error('private message'), { code }), 'production');
    assert.equal((await app.request('/api/failure')).status, 500);
    assert.equal(entries[0].fields.code, code);
    assert.ok(!JSON.stringify(entries).includes('private message'));
  }
});

test('startup: fatal exception never prints the driver message, stack, or connection URL', () => {
  const secret = 'postgres://app_api:critical-password@db.example.invalid:5432/postgres';
  const error = new Error('startup failed: ' + secret);
  const lines = [];
  logStartupFailure(error, (line) => lines.push(line));
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ level: 'fatal', msg: 'startup_failed' }]);
  assert.ok(!JSON.stringify(lines).includes(secret));
});
