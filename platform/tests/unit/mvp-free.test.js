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
  assert.match(yaml, /STORAGE_DRIVER\s*\n\s*value: s3/);
  assert.match(yaml, /DATABASE_SSL\s*\n\s*value: require/);
  assert.doesNotMatch(yaml, /plan: (?:starter|pro|standard|business)/);
  for (const name of ['APP_ORIGIN','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY']) {
    assert.match(yaml, new RegExp('key: ' + name + '\\n\\s*sync: false'));
  }
});
