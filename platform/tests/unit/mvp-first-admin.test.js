import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMvpAdminTarget } from '../../tools/mvp-guard-admin.js';

const ref = 'abcdefghijklmnopqrst';
const base = {
  confirmation: 'ADMIN-MVP', projectRef: ref, environmentRef: ref,
  opsUrl: 'postgres://app_ops.' + ref + ':local-test-password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require',
  supabaseUrl: 'https://' + ref + '.supabase.co',
  serviceKey: 'sb_' + 'secret_' + 'mock_secret_for_test_only',
};

test('o primeiro administrador do MVP usa apenas app_ops no projeto correto', () => {
  assert.deepEqual(validateMvpAdminTarget(base), { ref, connection: 'session-pooler' });
  const direct = { ...base, opsUrl: 'postgres://app_ops:local-test-password@db.' + ref + '.supabase.co:5432/postgres?sslmode=require' };
  assert.equal(validateMvpAdminTarget(direct).connection, 'direct');
});

test('bloqueia administração em outro projeto, login privilegiado, URL falsa, TLS desabilitado ou chave pública', () => {
  const patches = [
    { confirmation: 'MVP' }, { environmentRef: 'outroprojetodevabcdef' },
    { opsUrl: 'postgres://postgres:password@db.' + ref + '.supabase.co:5432/postgres?sslmode=require' },
    { opsUrl: 'postgres://app_ops.' + ref + ':p@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' },
    { opsUrl: 'postgres://app_ops.' + ref + ':p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require' },
    { opsUrl: 'postgres://app_ops.' + ref + ':p@evil.example.net:5432/postgres?sslmode=require' },
    { opsUrl: 'postgres://app_ops.' + ref + ':p@aws-0-sa-east-1.pooler.supabase.com:5432/production?sslmode=require' },
    { supabaseUrl: 'https://outroprojetodevabcdef.supabase.co' },
    { supabaseUrl: 'https://' + ref + '.supabase.co.evil.net' },
    { supabaseUrl: 'http://' + ref + '.supabase.co' },
    { serviceKey: 'sb_publishable_public-key' }, { serviceKey: '' }
  ];
  for (const patch of patches) assert.throws(() => validateMvpAdminTarget({ ...base, ...patch }));
});
