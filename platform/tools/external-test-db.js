#!/usr/bin/env node
/* PostgreSQL descartável para E2E no CI. NUNCA usa banco externo ou de produção.
   O CI fornece DATABASE_ADMIN_URL apontando para o serviço local do runner;
   somente um banco com prefixo canteiro_t_ pode ser criado ou reiniciado. */
import postgres from 'postgres';

const TEST_DB = /^canteiro_t_[a-z0-9_]+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function externalTestDatabaseUrls(baseUrl, dbName) {
  if (!TEST_DB.test(dbName || '')) throw new Error('E2E externo exige banco isolado canteiro_t_<nome>');
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('DATABASE_ADMIN_URL inválida para E2E'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new Error('E2E externo só pode usar PostgreSQL local (loopback)');
  }
  const maintenance = new URL(url), target = new URL(url);
  maintenance.pathname = '/postgres';
  target.pathname = '/' + dbName;
  return { maintenanceUrl: maintenance.toString(), targetUrl: target.toString() };
}

export async function prepareExternalTestDb(baseUrl, dbName, { reset = false } = {}) {
  const urls = externalTestDatabaseUrls(baseUrl, dbName);
  // A validação do nome acima torna seguro interpolá-lo como identificador SQL.
  const sql = postgres(urls.maintenanceUrl, { max: 1, prepare: false });
  try {
    if (reset) await sql.unsafe('drop database if exists "' + dbName + '" with (force)');
    const exists = await sql`select 1 from pg_database where datname = ${dbName}`;
    if (!exists.length) await sql.unsafe('create database "' + dbName + '"');
  } finally {
    await sql.end({ timeout: 5 });
  }
  return urls.targetUrl;
}
