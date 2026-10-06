#!/usr/bin/env node
/* tools/local-db.js — banco local de desenvolvimento/teste (Postgres já instalado na máquina).
   up    → inicia o cluster (se parado), define a senha local do superusuário e cria os bancos canteiro_dev e canteiro_test
   reset → recria um banco (node tools/local-db.js reset canteiro_test)
   Só para desenvolvimento: produção usa Supabase/Postgres gerenciado (veja docs/CONFIGURACAO.md). */
import { execFileSync } from 'node:child_process';
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString();
const psql = (sqlText, db = 'postgres') => sh('su', ['postgres', '-c', `psql -v ON_ERROR_STOP=1 -tAq -d ${db} -c "${sqlText.replace(/"/g, '\\"')}"`]);
const cmd = process.argv[2] || 'up';
if (cmd === 'up') {
  try { sh('pg_ctlcluster', ['16', 'main', 'start']); } catch (e) { /* já ativo */ }
  psql("alter role postgres password 'postgres'");
  for (const db of ['canteiro_dev', 'canteiro_test']) {
    if (!psql(`select 1 from pg_database where datname='${db}'`).trim()) psql(`create database ${db}`);
  }
  console.log('Postgres local pronto: postgres://postgres:postgres@127.0.0.1:5432/canteiro_dev (e canteiro_test)');
} else if (cmd === 'reset') {
  const db = process.argv[3]; if (!/^canteiro_(dev|test|[a-z0-9_]+)$/.test(db || '')) { console.error('informe o banco: canteiro_dev|canteiro_test'); process.exit(2); }
  psql(`drop database if exists ${db} with (force)`); psql(`create database ${db}`); console.log('recriado', db);
} else { console.error('uso: local-db.js up|reset <banco>'); process.exit(2); }
