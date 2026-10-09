/* Regressão: erros de provedores não podem colocar dados arbitrários em logs
   de Auth, SSO e administração; registramos somente categorias controladas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { safeExceptionKind } from '../../src/lib/log.js';
import { authRoutes } from '../../src/routes/auth.js';
import { loadConfig } from '../../src/config.js';
import { HttpError } from '../../src/lib/errors.js';

test('classificador não reproduz code, reason, nome de provedor, URL ou segredo', () => {
  const secret = 'postgres://app_api:segredo-nao-logar@db.invalid/postgres';
  for (const err of [
    Object.assign(new Error(secret), { code: secret, reason: 'token=' + secret }),
    { code: 'CUSTOM_SECRET_123456', reason: secret, name: secret },
    { code: '', reason: secret },
    null,
    'token=' + secret,
  ]) {
    const tag = safeExceptionKind(err);
    assert.equal(tag, 'dependency_error');
    assert.doesNotMatch(JSON.stringify({ tag }), /segredo-nao-logar|CUSTOM_SECRET|postgres:\/\//);
  }
  assert.equal(safeExceptionKind({ code: 'ECONNRESET' }), 'network');
  assert.equal(safeExceptionKind({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(safeExceptionKind({ name: 'TimeoutError', code: secret }), 'timeout');
  assert.equal(safeExceptionKind({ name: 'JwtRejected', reason: secret }), 'jwt_rejected');
});

test('SSO falhando com código externo arbitrário não registra segredo ou texto do provedor', async () => {
  const secret = 'secret-staging-credential';
  const messages = [];
  const config = loadConfig({
    APP_ENV: 'test', SSO_ENABLED: 'true', SSO_DOMAINS: 'am.test',
    CSRF_SECRET: 'f'.repeat(48), LOG_LEVEL: 'silent',
  });
  const deps = {
    config,
    logger: { warn: (message, fields) => messages.push({ message, fields }) },
    // A rota SSO só consulta app.hit_rate antes de tentar o provedor.
    db: { anon: async (callback) => callback(() => [{ allowed: true, reset_in: 60 }]) },
    gotrue: { ssoUrl: async () => { throw new HttpError(503, 'token-' + secret, 'private ' + secret); } },
    jwtVerifier: { verify: async () => { throw new Error('not used'); } },
  };
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('deps', deps); c.set('ip', '192.0.2.1'); await next(); });
  app.route('/api/auth', authRoutes(deps));
  const response = await app.request('/api/auth/sso?email=pessoa@am.test');
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/entrar\?motivo=sso_indisponivel$/);
  assert.deepEqual(messages, [{ message: 'sso_start_failed', fields: { kind: 'dependency_error' } }]);
  assert.doesNotMatch(JSON.stringify(messages), /secret-staging-credential|token-/);
  assert.doesNotMatch(await response.text(), /secret-staging-credential/);
});
