import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localDevAdminUrl } from '../../tools/dev-admin-url.js';

test('dev e testes usam banco exclusivo de desenvolvimento em loopback', () => {
  for (const db of ['canteiro_dev', 'canteiro_t_load', 'canteiro_e2e1']) {
    const uri = localDevAdminUrl(undefined, db);
    assert.equal(new URL(uri).hostname, '127.0.0.1');
    assert.equal(new URL(uri).pathname, '/' + db);
    const custom = localDevAdminUrl(`postgresql://postgres:senha@localhost:5433/${db}`, db);
    assert.equal(new URL(custom).port, '5433');
  }
});

test('rejeita banco remoto, banco de manutenção e nomes divergentes antes de migração', () => {
  const target = 'canteiro_t_load';
  for (const url of [
    'postgres://postgres:senha@db.example.supabase.co:5432/canteiro_t_load',
    'postgres://postgres:senha@10.3.2.1:5432/canteiro_t_load',
    'postgres://postgres:senha@127.0.0.1:5432/postgres',
    'postgres://postgres:senha@localhost:5432/canteiro_dev',
    'ftp://localhost:5432/canteiro_t_load',
    'postgres://postgres:senha@localhost:5432/canteiro_t_load#unsafe',
  ]) {
    assert.throws(() => localDevAdminUrl(url, target), /DATABASE_ADMIN_URL de desenvolvimento/);
  }
  for (const db of ['postgres', 'canteiro_test', 'supabase', 'canteiro_mvp', 'canteiro_t_foo;DROP']) {
    assert.throws(() => localDevAdminUrl(undefined, db), /nome descartável autorizado/);
  }
});

test('erros nunca reproduzem credenciais de URL inválida', () => {
  const password = 'SEGREDO_UNICO_DO_TESTE';
  for (const value of [
    `postgres://admin:${password}@db.remote.example:5432/canteiro_dev`,
    `https://admin:${password}@localhost:5432/canteiro_dev`,
    `%%%:${password}`,
  ]) {
    assert.throws(() => localDevAdminUrl(value, 'canteiro_dev'), (e) =>
      !e.message.includes(password) && /DATABASE_ADMIN_URL/.test(e.message));
  }
});

test('tools/dev.js valida URL local antes de aplicar migrações', () => {
  const file = readFileSync(new URL('../../tools/dev.js', import.meta.url), 'utf8');
  const guard = file.indexOf('localDevAdminUrl(process.env.DATABASE_ADMIN_URL, DB)');
  const migration = file.indexOf('await migrate(ADMIN_URL');
  assert.ok(guard > 0 && migration > guard);
});
