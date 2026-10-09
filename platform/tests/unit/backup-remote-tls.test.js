import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkConfig } from '../../tools/backup.js';

// Teste de configuração apenas: não abre conexão nem escreve dados ou arquivos.
const envFor = (url) => ({
  DATABASE_ADMIN_URL: url,
  BACKUP_TARGET: 'file:///tmp/canteiro-offline-backup-tls-tests',
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});
const tlsErrors = (url) => checkConfig(envFor(url)).errors.filter(e => /DATABASE_ADMIN_URL.*TLS/.test(e));
const remote = 'postgres://db.example.invalid:5432/postgres';

test('backup recusa modos que podem negociar conexão PostgreSQL sem TLS em host remoto', () => {
  for (const query of ['?sslmode=disable', '?sslmode=prefer', '?sslmode=allow', '?sslmode=', '?sslmode=require&sslmode=disable']) {
    assert.ok(tlsErrors(remote + query).length > 0, query);
  }
});

test('backup permite TLS obrigatório no host remoto e mantém padrão seguro sem sslmode', () => {
  for (const query of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full']) {
    assert.deepEqual(tlsErrors(remote + query), [], query);
  }
});

test('backup preserva PostgreSQL local sem TLS para ensaios descartáveis', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    assert.deepEqual(tlsErrors('postgres://' + host + ':5432/canteiro_t_drill?sslmode=disable'), []);
  }
});

test('pooler Supabase só é identificado por domínio exato, nunca sufixo enganoso', () => {
  const genuine = 'postgres://aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require';
  const lookalike = 'postgres://aws-0-sa-east-1.pooler.supabase.com.evil.invalid:6543/postgres?sslmode=require';
  const notices = url => checkConfig(envFor(url)).warnings.filter(w => /pooler/.test(w));
  assert.equal(notices(genuine).length, 1);
  assert.equal(notices(lookalike).length, 0);
});
