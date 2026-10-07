#!/usr/bin/env node
/* tools/chaves.js — confere as chaves mínimas de um ambiente e roda as ferramentas com a configuração COMPLETA montada a partir delas.

   Uso (nos workflows e no seu computador; os valores vêm de variáveis de ambiente, nunca de argumentos):
     node tools/chaves.js conferir --ambiente production --precisa banco,ops,arquivos,backup [--resumo ARQ] [--github-env ARQ] [--json]
         confere se cada chave existe e tem o formato certo (sem mostrar valores), descobre o servidor do banco (pooler) e,
         com --github-env, grava só o NOME do servidor (CANTEIRO_POOLER_HOST, não é segredo) para os passos seguintes
     node tools/chaves.js exec --ambiente production --precisa banco -- node tools/migrate.js
         monta DATABASE_ADMIN_URL, S3_*, BACKUP_* … e executa o comando com elas (o código de saída é o do comando)
     node tools/chaves.js pooler --ambiente staging [--github-env ARQ]      só descobre e mostra o servidor do banco
   Grupos de --precisa: banco (dono, migrações/backup) · ops (rotinas) · papeis (senhas app_api/app_ops) · supabase (URL + publishable key) ·
     servico (secret key) · arquivos (Storage S3) · backup (R2 com chave de criptografia) · backup-leitura (R2 só leitura) · site · vercel · email · supabase-admin
   O ambiente também pode vir da variável AMBIENTE. Lista do que copiar e onde colar: docs/CHAVES.md. */
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ToolError, buildRedactor, parseArgs, runCli, isMain } from './lib/common.js';
import { montar, relatorioProblemas, ITENS, AMBIENTES } from './lib/chaves.js';
import { descobrirPooler } from './lib/pooler.js';

const noGitHub = (env) => env.GITHUB_ACTIONS === 'true';
/** Pede ao GitHub Actions para esconder estes valores em qualquer log (defesa extra: as ferramentas já não imprimem segredos). */
export function mascarar(valores, out = process.stdout, env = process.env) { if (!noGitHub(env)) return; for (const v of valores) if (v && String(v).length >= 4 && !/[\r\n]/.test(v)) out.write(`::add-mask::${v}\n`); }

/** Monta e, se for preciso, descobre o pooler (uma conexão de teste com a senha do banco). */
export async function montarComPooler(env, { ambiente, precisa, log = () => {}, conectar } = {}) {
  let r = montar(env, { ambiente, precisa });
  if (r.poolerPendente && !r.faltando.length && !r.erros.length) {
    const senha = env.SUPABASE_DB_PASSWORD || ''; const user = senha ? undefined : `app_ops.${r.ref}`;
    const { host } = await descobrirPooler({ ref: r.ref, password: senha || env.APP_OPS_DB_PASSWORD, regiao: r.regiao, user, log, ...(conectar ? { conectar } : {}) });
    r = montar(env, { ambiente, precisa, poolerHost: host }); r.poolerHost = host; r.poolerDescoberto = true;
  } else r.poolerHost = env.SUPABASE_POOLER_HOST || env.CANTEIRO_POOLER_HOST || '';
  return r;
}

/** Únicos itens cujo VALOR pode aparecer no resumo (endereços e nomes públicos); todo o resto aparece só como "ok". */
const VISIVEIS = new Set(['SUPABASE_PROJECT_REF', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'STORAGE_DRIVER', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_FORCE_PATH_STYLE', 'BACKUP_TARGET', 'BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION', 'BACKUP_ENV_NAME', 'BACKUP_INCLUDE_AUTH', 'APP_ORIGIN']);
/** Tabela em Markdown do que foi conferido (nunca valores secretos; só origem e nomes não sigilosos). */
export function resumoMarkdown(r, { precisa = [] } = {}) {
  const L = [`### Chaves do ambiente \`${r.ambiente}\` (segredos no ambiente \`${AMBIENTES[r.ambiente].github}\` do GitHub)`, '', '| Item | Situação | De onde vem |', '|---|---|---|'];
  for (const f of r.faltando) L.push(`| \`${f.nome}\` | **FALTA** | ${f.de} → ${f.onde} |`);
  for (const [k, v] of Object.entries(r.env)) {
    const mostra = VISIVEIS.has(k) ? ` \`${v}\`` : '';
    L.push(`| \`${k}\` | ok${mostra} | ${r.origem[k] || ''} |`);
  }
  if (r.poolerHost) L.push(`| servidor do banco | ok \`${r.poolerHost}\` | ${r.poolerDescoberto ? 'descoberto automaticamente' : 'variável'} |`);
  for (const e of r.erros) L.push(`| — | **ERRO** | ${e} |`);
  for (const a of r.avisos) L.push(`| — | aviso | ${a} |`);
  L.push('', `Grupos conferidos: ${precisa.join(', ') || '—'}. Lista do que copiar e onde colar: \`platform/docs/CHAVES.md\`.`, '');
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const dd = argv.indexOf('--'); const cmd = dd >= 0 ? argv.slice(dd + 1) : [];
  const args = parseArgs(dd >= 0 ? argv.slice(0, dd) : argv, { bool: ['json', 'help'] });
  const sub = args._[0] || 'help'; const redact = buildRedactor(env);
  const err = (m) => process.stderr.write(redact(m) + '\n'); const log = (m) => process.stderr.write(redact(m) + '\n');
  if (sub === 'help' || args.help) { process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '') + '\n'); return 0; }
  const ambiente = args.ambiente || env.AMBIENTE; const precisa = String(args.precisa || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ambiente) throw new ToolError('informe o ambiente: --ambiente staging|production (ou a variável AMBIENTE)', { code: 'usage', exit: 2 });

  if (sub === 'pooler') {
    const r = await montarComPooler(env, { ambiente, precisa: ['banco'], log });
    if (r.faltando.length || r.erros.length) { err(relatorioProblemas(r)); return 2; }
    const host = r.poolerHost || (() => { try { return new URL(r.env.DATABASE_ADMIN_URL).hostname; } catch { return ''; } })();
    process.stdout.write(`${host}\n`);
    if (args['github-env'] && host) fs.appendFileSync(args['github-env'], `CANTEIRO_POOLER_HOST=${host}\n`);
    return 0;
  }
  if (sub === 'conferir') {
    if (!precisa.length) throw new ToolError('informe --precisa (ex.: --precisa banco,arquivos)', { code: 'usage', exit: 2 });
    const r = await montarComPooler(env, { ambiente, precisa, log });
    mascarar(r.mascarar, process.stdout, env);
    if (args.resumo) fs.appendFileSync(args.resumo, resumoMarkdown(r, { precisa }) + '\n');
    if (args['github-env'] && r.poolerDescoberto) fs.appendFileSync(args['github-env'], `CANTEIRO_POOLER_HOST=${r.poolerHost}\n`);
    for (const a of r.avisos) err(`aviso: ${a}`);
    const ok = !r.faltando.length && !r.erros.length;
    if (args.json) process.stdout.write(JSON.stringify({ ok, ambiente: r.ambiente, faltando: r.faltando.map((f) => f.nome), erros: r.erros, avisos: r.avisos, poolerHost: r.poolerHost || null, itens: Object.keys(r.env) }) + '\n');
    if (!ok) { err(relatorioProblemas(r)); return 2; }
    log(`chaves do ambiente ${r.ambiente} conferidas (${precisa.join(', ')}): ${Object.keys(r.env).length} variáveis montadas${r.poolerHost ? `; servidor do banco ${r.poolerHost}` : ''}`);
    return 0;
  }
  if (sub === 'exec') {
    if (!cmd.length) throw new ToolError('informe o comando depois de "--" (ex.: exec --precisa banco -- node tools/migrate.js)', { code: 'usage', exit: 2 });
    const r = await montarComPooler(env, { ambiente, precisa, log });
    if (r.faltando.length || r.erros.length) { err(relatorioProblemas(r)); return 2; }
    for (const a of r.avisos) err(`aviso: ${a}`);
    mascarar(r.mascarar, process.stdout, env);
    const childEnv = { ...env, ...r.env };
    return await new Promise((resolve) => {
      const p = spawn(cmd[0], cmd.slice(1), { env: childEnv, stdio: 'inherit' });
      p.on('error', (e) => { err(`não consegui executar ${cmd[0]}: ${e.message}`); resolve(127); });
      p.on('exit', (code, sig) => resolve(code ?? 128 + (os.constants.signals[sig] || 1)));
    });
  }
  throw new ToolError(`comando desconhecido: ${sub}. Use conferir | exec | pooler (itens conhecidos: ${Object.keys(ITENS).length})`, { code: 'usage', exit: 2 });
}

if (isMain(import.meta.url)) runCli(() => main());
