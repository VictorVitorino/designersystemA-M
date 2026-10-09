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
test('staging e produção recusam endpoints HTTP que transmitiriam chaves e credenciais sem TLS', () => {
  for (const appEnv of ['staging', 'production']) {
    reject({ APP_ENV: appEnv, SUPABASE_URL: 'http://auth.exemplo.com' }, /SUPABASE_URL.*https/);
    reject({ APP_ENV: appEnv, SUPABASE_JWKS_URL: 'http://chaves.exemplo.com/jwks' }, /SUPABASE_JWKS_URL.*https/);
    reject({ APP_ENV: appEnv, S3_ENDPOINT: 'http://objetos.exemplo.com' }, /S3_ENDPOINT.*https/);
    const c = loadConfig({ ...PROD, APP_ENV: appEnv, S3_ENDPOINT: 'https://objetos.exemplo.com' });
    assert.equal(c.storage.s3.endpoint, 'https://objetos.exemplo.com');
  }
});
test('staging e produção recusam userinfo em URLs externas', () => {
  for (const appEnv of ['staging', 'production']) {
    for (const key of ['APP_ORIGIN', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'S3_ENDPOINT']) {
      for (const suffix of ['u:p@host.example.invalid/path', 'u@host.example.invalid/path']) {
        assert.throws(() => loadConfig({ ...PROD, APP_ENV: appEnv, [key]: 'https://' + suffix }), /não pode incluir usuário ou senha/);
      }
    }
  }
});
test('produção recusa protocolos inseguros em todos os provedores', () => {
  for (const key of ['APP_ORIGIN', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'S3_ENDPOINT']) {
    assert.throws(() => loadConfig({ ...PROD, [key]: 'ftp://host.example.invalid/path' }), /https/);
  }
});
test('HTTP externo continua permitido somente no desenvolvimento/testes locais', () => {
  const c = loadConfig({ APP_ENV: 'test', SUPABASE_URL: 'http://localhost:9999',
    SUPABASE_JWKS_URL: 'http://localhost:9999/jwks', S3_ENDPOINT: 'http://localhost:9000' });
  assert.equal(c.supabase.url, 'http://localhost:9999');
  assert.equal(c.storage.s3.endpoint, 'http://localhost:9000');
});
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

/* PUB-08: limites de corpo/resposta coerentes com a Vercel (função: 4,5 MB de requisição e de resposta). Contagem em BYTES. */
test('limites fora da Vercel: JSON de salvar/criar até 13 MiB e arquivos de até 8 MiB transmitidos pela própria API', () => {
  for (const env of [{ APP_ENV: 'test' }, { APP_ENV: 'test', VERCEL: '' }, PROD]) {
    const c = loadConfig(env);
    assert.equal(c.onVercel, false); assert.equal(c.maxJsonBytes, 13 * 1048576); assert.equal(c.streamLimitBytes, 8 * 1048576); assert.equal(c.maxApiUploadBytes, 4 * 1048576);
  }
});
test('limites na Vercel (VERCEL definida): JSON até 4 MiB e transmissão até 4 MiB (acima disso, 302 para URL assinada)', () => {
  for (const env of [{ APP_ENV: 'test', VERCEL: '1' }, { ...PROD, VERCEL: '1' }, { APP_ENV: 'test', VERCEL: 'true' }]) {
    const c = loadConfig(env);
    assert.equal(c.onVercel, true); assert.equal(c.maxJsonBytes, 4 * 1048576); assert.equal(c.streamLimitBytes, 4 * 1048576); assert.equal(c.maxApiUploadBytes, 4 * 1048576);
    assert.ok(c.maxJsonBytes < 4.5e6 && c.streamLimitBytes < 4.5e6, 'abaixo dos 4,5 MB da função');
  }
});
test('MAX_JSON_BYTES ajusta o limite (com e sem Vercel); valores inválidos recusam a partida', () => {
  assert.equal(loadConfig({ APP_ENV: 'test', MAX_JSON_BYTES: '2097152' }).maxJsonBytes, 2097152);
  assert.equal(loadConfig({ APP_ENV: 'test', VERCEL: '1', MAX_JSON_BYTES: '3145728' }).maxJsonBytes, 3145728);
  assert.equal(loadConfig({ APP_ENV: 'test', VERCEL: '1', MAX_JSON_BYTES: '3145728' }).streamLimitBytes, 4 * 1048576, 'o limite de transmissão continua o da plataforma');
  for (const bad of ['0', '1000', '1.5', 'muito', String(65 * 1048576)]) assert.throws(() => loadConfig({ APP_ENV: 'test', MAX_JSON_BYTES: bad }), /MAX_JSON_BYTES/, bad);
});

/* F10: SSO só com SSO_ENABLED=true e SSO_DOMAINS (lista de domínios válidos). */
test('SSO: desligado por padrão; ligado exige SSO_DOMAINS válidos (normalizados em minúsculas) e o Supabase configurado', () => {
  assert.deepEqual(loadConfig({ APP_ENV: 'test' }).sso, { enabled: false, domains: [] });
  assert.deepEqual(loadConfig({ APP_ENV: 'test', SSO_DOMAINS: 'am.test' }).sso, { enabled: false, domains: [] }, 'lista sem SSO_ENABLED não liga nada');
  const sup = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon-key-0123456789' };
  assert.deepEqual(loadConfig({ APP_ENV: 'test', SSO_ENABLED: 'true', SSO_DOMAINS: ' AlvarezAndMarsal.com , am.com.br ', ...sup }).sso, { enabled: true, domains: ['alvarezandmarsal.com', 'am.com.br'] });
  assert.equal(loadConfig({ ...PROD, SSO_ENABLED: '1', SSO_DOMAINS: 'alvarezandmarsal.com' }).sso.enabled, true, 'vale em produção');
  assert.throws(() => loadConfig({ APP_ENV: 'test', SSO_ENABLED: 'true', ...sup }), /SSO_DOMAINS/);
  for (const bad of ['am', 'am..test', '-am.test', 'am.test/x', '*.am.test', 'am.test,http://x.com']) assert.throws(() => loadConfig({ APP_ENV: 'test', SSO_ENABLED: 'true', SSO_DOMAINS: bad, ...sup }), /SSO_DOMAINS/, bad);
  assert.throws(() => loadConfig({ APP_ENV: 'test', SSO_ENABLED: 'true', SSO_DOMAINS: 'am.test' }), /SUPABASE_URL/);
});
