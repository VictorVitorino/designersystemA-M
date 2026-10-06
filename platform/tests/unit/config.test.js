import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import { startFakeGoTrue } from '../../tools/fake-gotrue.js';
import { IdentityCache } from '../../src/auth/kit.js';

const PROD = {
  APP_ENV: 'production', APP_ORIGIN: 'https://canteiro.exemplo.com.br', DATABASE_URL: 'postgres://app_api:x@db.exemplo:6543/postgres',
  SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon-key-0123456789', SUPABASE_SERVICE_ROLE_KEY: 'service-key-0123456789',
  SUPABASE_JWKS_URL: 'https://abc.supabase.co/auth/v1/.well-known/jwks.json', CSRF_SECRET: 'x'.repeat(40),
  STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
};
const reject = (patch, re) => assert.throws(() => loadConfig({ ...PROD, ...patch }), re);

test('config de produção válida: HTTPS, prefixo __Host-, cookies Secure', () => {
  const c = loadConfig(PROD);
  assert.equal(c.cookiePrefix, '__Host-'); assert.equal(c.cookieSecure, true); assert.equal(c.isProd, true); assert.equal(c.db.ssl, 'require');
});
test('produção rejeita APP_ORIGIN http', () => reject({ APP_ORIGIN: 'http://canteiro.exemplo.com.br' }, /https/));
test('produção rejeita CSRF_SECRET ausente ou curto', () => { reject({ CSRF_SECRET: undefined }, /CSRF_SECRET/); reject({ CSRF_SECRET: 'curto' }, /inválida|CSRF_SECRET/); });
test('produção rejeita GOTRUE_FAKE', () => reject({ GOTRUE_FAKE: '1' }, /GOTRUE_FAKE/));
test('produção rejeita DATABASE_ADMIN_URL / DATABASE_OPS_URL no ambiente da API', () => {
  reject({ DATABASE_ADMIN_URL: 'postgres://postgres:x@h/db' }, /DATABASE_ADMIN_URL/);
  reject({ DATABASE_OPS_URL: 'postgres://app_ops:x@h/db' }, /DATABASE_OPS_URL|DATABASE_ADMIN_URL/);
});
test('produção rejeita SSL desligado, storage local e falta de verificação de JWT', () => {
  reject({ DATABASE_SSL: 'disable' }, /DATABASE_SSL/); reject({ STORAGE_DRIVER: 'local' }, /STORAGE_DRIVER/);
  reject({ SUPABASE_JWKS_URL: undefined }, /SUPABASE_JWKS_URL|SUPABASE_JWT_SECRET/);
  reject({ SUPABASE_SERVICE_ROLE_KEY: undefined }, /SUPABASE_SERVICE_ROLE_KEY/);
});
test('staging também exige HTTPS e rejeita o fake', () => {
  assert.throws(() => loadConfig({ ...PROD, APP_ENV: 'staging', APP_ORIGIN: 'http://x.test' }), /https/);
  assert.throws(() => loadConfig({ ...PROD, APP_ENV: 'staging', GOTRUE_FAKE: 'true' }), /GOTRUE_FAKE/);
});
test('local/test em HTTP: cookies sem prefixo e sem Secure', () => {
  const c = loadConfig({ APP_ENV: 'test', APP_ORIGIN: 'http://localhost:3000' });
  assert.equal(c.cookiePrefix, ''); assert.equal(c.cookieSecure, false);
});
test('fake do GoTrue recusa iniciar com APP_ENV=production', async () => {
  const old = process.env.APP_ENV; process.env.APP_ENV = 'production';
  try { await assert.rejects(() => startFakeGoTrue({ port: 0 }), /production/); } finally { if (old === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = old; }
});
test('cache de identidade nunca passa de 15 s', () => {
  assert.equal(new IdentityCache(60_000).ttl, 15_000);
  assert.equal(new IdentityCache(5_000).ttl, 5_000);
  assert.equal(new IdentityCache(-1).ttl, 0);
});
