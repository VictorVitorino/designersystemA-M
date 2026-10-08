import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalTestDatabaseUrls } from '../../tools/external-test-db.js';

test('E2E usa banco temporário isolado no Postgres do runner', () => {
  const url = 'postgres://postgres:local-test@127.0.0.1:5432/canteiro_test';
  const result = externalTestDatabaseUrls(url, 'canteiro_t_e2e');
  assert.equal(new URL(result.targetUrl).pathname, '/canteiro_t_e2e');
  assert.equal(new URL(result.maintenanceUrl).pathname, '/postgres');
  assert.equal(new URL(result.targetUrl).hostname, '127.0.0.1');
});

test('E2E rejeita banco não descartável e conexões remotas', () => {
  const local = 'postgres://postgres:local-test@localhost:5432/canteiro_test';
  for (const db of ['postgres', 'canteiro_dev', 'canteiro_test', 'canteiro_prod', 'canteiro_t_x;drop', '']) {
    assert.throws(() => externalTestDatabaseUrls(local, db), /banco isolado/);
  }
  for (const url of ['postgres://postgres:pw@db.supabase.co:5432/postgres',
                     'postgres://postgres:pw@10.0.0.2:5432/postgres',
                     'https://localhost:5432/postgres', 'not-a-url']) {
    assert.throws(() => externalTestDatabaseUrls(url, 'canteiro_t_e2e'), /inválida|loopback/);
  }
});
