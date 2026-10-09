import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAdminUrl } from '../load/database-url.js';
import { readFileSync } from 'node:fs';


const maintenance = 'postgres://postgres:disposable-ci-password@127.0.0.1:5432/postgres';

test('PG17 de runner: métricas apontam ao banco isolado, não ao banco de manutenção', () => {
  const selected = loadAdminUrl({ E2E_EXTERNAL_POSTGRES: '1', DATABASE_ADMIN_URL: maintenance }, 'canteiro_t_load');
  assert.equal(new URL(selected).pathname, '/canteiro_t_load');
  assert.equal(new URL(selected).hostname, '127.0.0.1');
  assert.notEqual(selected, maintenance);
});

test('PG17 de runner recusa Supabase remoto, URL ausente e banco fora do padrão descartável', () => {
  for (const url of [
    'postgres://postgres:secret@db.some-supabase-project.supabase.co:5432/postgres',
    'postgres://postgres:secret@10.0.0.8:5432/postgres',
    'https://127.0.0.1:5432/postgres',
  ]) {
    assert.throws(() => loadAdminUrl({ E2E_EXTERNAL_POSTGRES: '1', DATABASE_ADMIN_URL: url }, 'canteiro_t_load'), /loopback/);
  }
  assert.throws(() => loadAdminUrl({ E2E_EXTERNAL_POSTGRES: '1' }, 'canteiro_t_load'), /DATABASE_ADMIN_URL/);
  for (const db of ['postgres', 'canteiro_dev', 'canteiro-mvp', 'canteiro_test', 'canteiro_t_bad;drop']) {
    assert.throws(() => loadAdminUrl({ E2E_EXTERNAL_POSTGRES: '1', DATABASE_ADMIN_URL: maintenance }, db), /banco canteiro_t_/);
  }
});

test('modo local recusa endereços externos antes de iniciar o ensaio de carga', () => {
  for (const address of [
    'postgres://db.example.invalid:5432/postgres',
    'postgres://10.23.4.5:5432/postgres',
    'postgres://192.168.1.10:5432/postgres',
    'https://127.0.0.1:5432/postgres',
  ]) {
    assert.throws(() => loadAdminUrl({ DATABASE_ADMIN_URL: address }, 'canteiro_t_load'), /loopback/);
  }
  const local = loadAdminUrl({ DATABASE_ADMIN_URL: maintenance.replace('/postgres', '/canteiro_t_load') }, 'canteiro_t_load');
  assert.equal(new URL(local).pathname, '/canteiro_t_load');
  assert.throws(() => loadAdminUrl({ DATABASE_ADMIN_URL: maintenance }, 'canteiro_t_load'), /banco descartável de mesmo nome/);
  assert.throws(() => loadAdminUrl({ DATABASE_ADMIN_URL: local + '#invalido' }, 'canteiro_t_load'), /banco descartável de mesmo nome/);
});

test('execução local mantém fallback exclusivo ao banco de ensaio', () => {
  const selected = loadAdminUrl({}, 'canteiro_t_load');
  assert.equal(new URL(selected).hostname, '127.0.0.1');
  assert.equal(new URL(selected).pathname, '/canteiro_t_load');
});

test('workflow de carga é só manual e não aponta aos serviços reais', () => {
  const yaml = readFileSync(new URL('../../../.github/workflows/load-isolated-pg17.yml', import.meta.url), 'utf8');
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /^\s+push:|^\s+schedule:|^\s+pull_request:/m);
  assert.match(yaml, /image: supabase\/postgres:17/);
  assert.match(yaml, /E2E_EXTERNAL_POSTGRES: '1'/);
  assert.match(yaml, /--phases 50x180:keep --pool-max 2 --skip-browser --no-report/);
  assert.doesNotMatch(yaml, /\.supabase\.co|onrender\.com|service.role/i);
});
