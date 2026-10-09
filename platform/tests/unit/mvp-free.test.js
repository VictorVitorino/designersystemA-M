import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMvpDatabaseTarget } from '../../tools/guard-mvp-db.js';

const ref = 'abcdefghijklmnopqrst';
const password = 'test-only-password-for-pg';
const good = {
  confirmation: 'MVP', inputRef: ref, environmentRef: ref,
  url: 'postgres://postgres.' + ref + ':' + password + '@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require',
  apiPassword: 'not-a-real-api-pass-2345',
  opsPassword: 'not-a-real-ops-pass-9876',
};

test('migração MVP Free aceita apenas projeto indicado via Supabase pooler com SSL', () => {
  assert.deepEqual(validateMvpDatabaseTarget(good), { projectRef: ref, method: 'pooler' });
  const direct = { ...good, url: 'postgres://postgres:' + password + '@db.' + ref + '.supabase.co:5432/postgres?sslmode=require' };
  assert.equal(validateMvpDatabaseTarget(direct).method, 'direct');
});

test('migração MVP Free não aceita destino diferente, credenciais fracas ou ambiente não confirmado', () => {
  for (const patch of [
    { confirmation: 'PRODUCAO' },
    { inputRef: 'outrarefsupabasedbxx' },
    { environmentRef: 'outrarefsupabasedbxx' },
    { url: 'postgres://postgres.' + ref + ':' + password + '@fake.pooler.supabase.co:5432/postgres?sslmode=require' },
    { url: 'postgres://postgres.' + ref + ':' + password + '@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' },
    { url: 'postgres://postgres.' + ref + ':' + password + '@evil.example.com:5432/postgres?sslmode=require' },
    { url: 'postgres://postgres:' + password + '@db.' + ref + '.supabase.co:5432/canteiro_prod?sslmode=require' },
    { url: 'postgres://postgres.xyzxyzxyzxyzxyzxy:' + password + '@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require' },
    { apiPassword: 'curta' }, { opsPassword: good.apiPassword },
  ]) assert.throws(() => validateMvpDatabaseTarget({ ...good, ...patch }));
});

test('Render Blueprint MVP Free não define plano pago nem credenciais em texto', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const yaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  assert.match(yaml, /plan: free/);
  assert.match(yaml, /autoDeployTrigger: off/);
  assert.match(yaml, /key: APP_ORIGIN\s*\n\s*fromService:\s*\n\s*name: canteiro-mvp-piloto\s*\n\s*type: web\s*\n\s*envVarKey: RENDER_EXTERNAL_URL/, 'Render injeta o endereço HTTPS do próprio serviço');
  assert.doesNotMatch(yaml, /key: APP_ORIGIN\s*\n\s*sync: false/);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /render\.com\/deploy\?repo=https:\/\/github\.com\/VictorVitorino\/designersystemA-M/);
  assert.match(yaml, /STORAGE_DRIVER\s*\n\s*value: s3/);
  assert.match(yaml, /DATABASE_SSL\s*\n\s*value: require/);
  // O Render recebe dados PUBLICOS do projeto dedicado. NUNCA embutir senhas/chaves.
  for (const [key, value] of [
    ['SUPABASE_URL', 'https://fgdrjxuhzagmvqyhrqlf.supabase.co'],
    ['SUPABASE_JWKS_URL', 'https://fgdrjxuhzagmvqyhrqlf.supabase.co/auth/v1/.well-known/jwks.json'],
    ['S3_ENDPOINT', 'https://fgdrjxuhzagmvqyhrqlf.storage.supabase.co/storage/v1/s3'],
    ['S3_REGION', 'sa-east-1'],
    ['S3_BUCKET', 'canteiro-mvp-files'],
  ]) {
    assert.ok(yaml.includes('key: ' + key + '\n        value: ' + value), key + ' publico preconfigurado');
  }
  for (const key of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    assert.ok(yaml.includes('key: ' + key + '\n        sync: false'), key + ' deve ser configurado fora do GitHub');
  }
  assert.doesNotMatch(yaml, /plan: (?:starter|pro|standard|business)/);
  for (const name of ['DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY']) {
    assert.match(yaml, new RegExp('key: ' + name + '\\n\\s*sync: false'));
  }
});
