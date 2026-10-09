import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onError, unhandledCategory } from '../../src/middleware/error.js';

test('erro inesperado devolve 500 genérico e nunca registra mensagem, stack ou código arbitrário', () => {
  const logs = [];
  const handler = onError({
    config: { appEnv: 'staging' },
    logger: { error: (name, fields) => logs.push({ name, fields }) },
  });
  const c = {
    get: (name) => name === 'requestId' ? 'req-test' : undefined,
    req: { path: '/api/presentations', method: 'PUT' },
    json: (body, status, headers) => ({ body, status, headers }),
  };
  const secret = 'postgres://app_api:do-not-log@db.example.test/postgres';
  for (const err of [
    Object.assign(new Error('DB error ' + secret), { code: 'ECONNRESET', stack: 'stack: ' + secret }),
    Object.assign(new Error('unexpected ' + secret), { code: 'SECRET_' + secret, stack: secret }),
    Object.assign(new Error('SQL error ' + secret), { code: '08006', stack: secret }),
  ]) {
    const result = handler(err, c);
    assert.equal(result.status, 500);
    assert.equal(result.body.error.code, 'internal_error');
    assert.doesNotMatch(JSON.stringify(result), /do-not-log|db\\.example\\.test/);
  }
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map((l) => l.fields.category), ['network', 'unexpected', 'database']);
  assert.ok(logs.every((l) => l.name === 'unhandled'));
  assert.ok(logs.every((l) => l.fields.requestId === 'req-test'));
  assert.doesNotMatch(JSON.stringify(logs), /do-not-log|SECRET_|stack:|postgres:\/\//);
});

test('categorias são determinadas exclusivamente por valores conhecidos', () => {
  assert.equal(unhandledCategory(Object.assign(new Error('private'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(unhandledCategory(Object.assign(new Error('private'), { code: '28P01' })), 'database');
  assert.equal(unhandledCategory(null), 'unexpected');
});
