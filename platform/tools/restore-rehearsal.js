#!/usr/bin/env node
/* tools/restore-rehearsal.js — ENSAIO DE RESTAURAÇÃO a partir do backup REAL (achado F8: até aqui a restauração só tinha sido ensaiada localmente,
   com dados sintéticos — tools/restore-drill.js). Roda no workflow "Ensaio de restauração" (mensal e manual), DENTRO do runner do GitHub:
   baixa o backup mais recente do bucket (Cloudflare R2), restaura num Postgres DESCARTÁVEL da mesma versão do servidor (container) e confere:
     1. o backup é autêntico: MAC do manifesto, SHA-256 do arquivo cifrado e do dump, autenticação de todos os blocos — antes de tocar no banco
     2. pg_restore completo numa transação única (os papéis do Supabase citados no dump são criados sem login, só neste banco descartável)
     3. migrate --check: o esquema do backup é o do código atual
     4. contagens e amostra de linhas de TODAS as tabelas iguais às do manifesto
     5. verify-deploy offline no banco restaurado (RLS, permissões, papéis, funções, gatilhos, migrações)
     6. amostra de arquivos: baixa do espelho cifrado, decifra e confere SHA-256 e tamanho de N arquivos referenciados no banco restaurado
     7. dados do Supabase Auth (se o backup os tiver): íntegros e legíveis pelo pg_restore
   e escreve um relatório (Markdown + JSON) sem segredos: só nomes, números e resultados.

   Uso:
     node tools/restore-rehearsal.js info [--name NOME] [--github-output ARQ]      qual backup será usado e a versão do Postgres dele
     node tools/restore-rehearsal.js run --to postgres://postgres:…@127.0.0.1:55432/ensaio [--name NOME] [--amostra 50] [--relatorio ARQ.md] [--json ARQ.json]
   Variáveis: BACKUP_TARGET, BACKUP_S3_* (leitura basta), BACKUP_ENCRYPTION_KEY (+ BACKUP_ENCRYPTION_KEYS_OLD), PG_BIN_DIR (pg_restore da versão do servidor).
   Segurança: --to precisa ser um Postgres LOCAL (localhost/127.0.0.1) e VAZIO — nunca o de produção. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ToolError, buildRedactor, parseArgs, fmtBytes, fmtMs, runCli, isMain, mapLimit } from './lib/common.js';
import { keyringFromEnv, createDecryptStream } from './lib/backup-crypto.js';
import { openTarget } from './lib/targets.js';
import { connect, isLocalHost, findPgBin, pgToolVersion } from './lib/pg.js';
import { verifyingHash, keyOfSha, OBJ_PREFIX } from './lib/mirror.js';
import { loadManifest, resolveBackupName } from './lib/backup-catalog.js';
import { restoreDb, listReferencedObjects } from './restore.js';
import { verifyAuthData } from './backup.js';
import { runChecks } from './verify-deploy.js';

const noop = () => {};

/** Qual backup e o que o manifesto diz (MAC conferido com a chave). */
export async function escolherBackup({ target, keys, name = null, now = new Date() }) {
  const nome = await resolveBackupName(target, { name, latest: true });
  const manifest = await loadManifest(target, nome, { keys });
  const criado = new Date(manifest.createdAt);
  return { name: nome, manifest, createdAt: manifest.createdAt, ageHours: Math.round(((now - criado) / 3600e3) * 10) / 10, pgMajor: manifest.pg?.serverMajor || null, hasAuth: !!manifest.authData };
}

/** Amostra determinística (mesmo backup → mesma amostra; troca a cada backup). */
export function amostra(items, n, semente) {
  if (items.length <= n) return [...items];
  const peso = (s) => crypto.createHash('sha256').update(`${semente}:${s}`).digest('hex');
  return [...items].sort((a, b) => (peso(a.sha256) < peso(b.sha256) ? -1 : 1)).slice(0, n);
}

/** Baixa cada arquivo da amostra do espelho cifrado, decifra e confere SHA-256 e tamanho (sem gravar nada em disco). */
export async function conferirArquivos({ target, keys, items, concorrencia = 6 }) {
  const rep = { total: items.length, ok: 0, missing: [], corrupt: [], sizeMismatch: [], errors: [], bytes: 0 };
  await mapLimit(items, concorrencia, async (it) => {
    const chave = `${OBJ_PREFIX}${keyOfSha(it.sha256)}.enc`;
    try {
      if (!(await target.head(chave))) { rep.missing.push(it.sha256); return; }
      const v = verifyingHash(it.sha256); let n = 0;
      await pipeline(await target.get(chave), createDecryptStream(keys), v, async function* (src) { for await (const c of src) n += c.length; });
      rep.bytes += n;
      if (it.size != null && Number(it.size) !== n) rep.sizeMismatch.push(it.sha256); else rep.ok++;
    } catch (e) { if (e?.code === 'hash_mismatch') rep.corrupt.push(it.sha256); else rep.errors.push({ sha: it.sha256, error: String(e?.message || e).slice(0, 160) }); }
  });
  rep.pass = !rep.missing.length && !rep.corrupt.length && !rep.sizeMismatch.length && !rep.errors.length;
  return rep;
}

/**
 * O ensaio completo. Nunca lança por falha de verificação: devolve {ok:false, problemas:[…]} com o relatório parcial (lança só por uso indevido).
 * @param {{env:object, target:object, keys:Buffer[], name?:string, toUrl:string, amostraN?:number, log?:Function, now?:Date}} o
 */
export async function ensaiar({ env = process.env, target, keys, name = null, toUrl, amostraN = 50, log = noop, now = new Date() }) {
  if (!toUrl) throw new ToolError('informe --to postgres://…@127.0.0.1:PORTA/BANCO (um Postgres local e vazio)', { code: 'usage', exit: 2 });
  let host; try { host = new URL(toUrl).hostname; } catch { throw new ToolError('--to inválido (esperado postgres://usuario:senha@127.0.0.1:porta/banco)', { code: 'usage', exit: 2 }); }
  if (!isLocalHost(host)) throw new ToolError(`o ensaio só restaura em Postgres LOCAL e descartável (recebi ${host})`, { code: 'unsafe_host', exit: 2 });
  const t0 = Date.now(); const rep = { schema: 'canteiro-ensaio-restauracao/1', iniciadoEm: now.toISOString(), alvo: target.describe(), problemas: [], fases: {} };
  const fase = async (nome, fn) => { const s = Date.now(); try { return await fn(); } finally { rep.fases[nome] = Date.now() - s; } };
  try {
    const b = await fase('escolher_backup', () => escolherBackup({ target, keys, name, now }));
    Object.assign(rep, { backup: b.name, criadoEm: b.createdAt, idadeHoras: b.ageHours, ambiente: b.manifest.env, pg: { dump: b.manifest.pg?.dumpVersion, servidor: b.manifest.pg?.serverVersion, servidorMajor: b.pgMajor, restore: pgToolVersion(findPgBin('pg_restore', env)).full }, esquema: b.manifest.schema?.latestMigration, tamanho: { cifrado: b.manifest.dump?.encryptedBytes, emClaro: b.manifest.dump?.plainBytes } });
    log(`backup escolhido: ${b.name} (${b.ageHours} h atrás, ${fmtBytes(b.manifest.dump?.encryptedBytes)} cifrados)`);
    if (b.ageHours > 26) rep.problemas.push(`o backup mais recente tem ${b.ageHours} h (o diário deveria ter menos de 26 h): veja o workflow Backup`);

    const r = await fase('restaurar_e_comparar', () => restoreDb({ env: { ...env, DATABASE_ADMIN_URL: '' }, target, keys, name: b.name, toUrl, createMissingRoles: true, log }));
    rep.restauracao = { ok: r.ok, tabelas: r.tables, linhas: r.rows, contagens: r.counts, esperado: r.expected, diferencas: r.diffs, avisos: r.warnings, migrateCheck: r.migrateCheck, snapshotConsistente: r.consistentSnapshot, papeisCriados: r.rolesCreated, fasesInternas: r.phases };
    if (!r.migrateCheck) rep.problemas.push('migrate --check reprovou no banco restaurado');
    if (r.diffs.length) rep.problemas.push(`${r.diffs.length} diferença(s) de contagem/amostra contra o manifesto`);

    const sql = connect(toUrl, { max: 1 });
    try {
      const checks = await fase('verify_deploy', () => runChecks({ sql, env: { STORAGE_DRIVER: 'local' }, offline: true }));
      rep.verifyDeploy = checks.map((c) => ({ id: c.id, titulo: c.title, status: c.status, detalhe: c.detail, itens: c.items.slice(0, 10) }));
      for (const c of checks.filter((x) => x.status === 'fail')) rep.problemas.push(`verify-deploy reprovou: ${c.title}`);
      const refs = await listReferencedObjects(sql);
      const sel = amostra(refs, amostraN, b.name);
      const a = await fase('amostra_arquivos', () => conferirArquivos({ target, keys, items: sel }));
      rep.arquivos = { referenciados: refs.length, amostra: sel.length, ok: a.ok, ausentes: a.missing, corrompidos: a.corrupt, tamanhoErrado: a.sizeMismatch, erros: a.errors, bytes: a.bytes };
      if (!a.pass) rep.problemas.push(`amostra de arquivos: ${a.missing.length} ausente(s), ${a.corrupt.length} corrompido(s), ${a.sizeMismatch.length} com tamanho errado, ${a.errors.length} erro(s)`);
    } finally { await sql.end({ timeout: 5 }).catch(noop); }

    const au = await fase('dados_do_auth', () => verifyAuthData({ env, target, manifest: b.manifest, keys }));
    rep.auth = au.present ? { presente: true, ok: au.ok, tabelas: au.tables, contagens: au.counts, problemas: au.problems } : { presente: false };
    if (au.present && !au.ok) rep.problemas.push(...au.problems.map((p) => `Auth: ${p}`));
    if (!au.present) rep.avisos = [...(rep.avisos || []), 'o backup não tem os dados do Supabase Auth (BACKUP_INCLUDE_AUTH=0): perder o projeto Supabase exigiria convidar todos de novo'];
  } catch (e) {
    rep.problemas.push(`ensaio interrompido: ${String(e?.message || e).slice(0, 400)}`); rep.erro = String(e?.message || e).slice(0, 400);
  }
  rep.duracaoMs = Date.now() - t0; rep.terminadoEm = new Date().toISOString(); rep.ok = !rep.problemas.length;
  return rep;
}

const row = (...c) => '| ' + c.map((x) => String(x ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |';
export function relatorioMarkdown(rep) {
  const ok = (b) => (b ? 'ok' : '**FALHOU**');
  const L = ['# Ensaio de restauração (backup real)', '', `**Resultado: ${rep.ok ? 'APROVADO' : 'REPROVADO'}** — ${rep.iniciadoEm} · duração ${fmtMs(rep.duracaoMs || 0)}`, ''];
  if (rep.problemas.length) L.push('**Problemas:**', ...rep.problemas.map((p) => `- ${p}`), '');
  if (rep.avisos?.length) L.push('Avisos:', ...rep.avisos.map((p) => `- ${p}`), '');
  L.push('## Backup usado', '', row('Item', 'Valor'), row('---', '---'), row('Nome', rep.backup ? `\`${rep.backup}\`` : '—'), row('Criado em / idade', `${rep.criadoEm || '—'} (${rep.idadeHoras ?? '?'} h)`), row('Destino', rep.alvo),
    row('Tamanho (cifrado / em claro)', `${fmtBytes(rep.tamanho?.cifrado)} / ${fmtBytes(rep.tamanho?.emClaro)}`), row('Postgres do servidor / pg_dump / pg_restore do ensaio', `${rep.pg?.servidor || '?'} / ${rep.pg?.dump || '?'} / ${rep.pg?.restore || '?'}`), row('Última migração no backup', rep.esquema || '?'), '');
  if (rep.restauracao) {
    const R = rep.restauracao;
    L.push('## Restauração e comparação com o manifesto', '', row('Verificação', 'Resultado'), row('---', '---'), row('Backup autêntico (MAC, SHA-256, todos os blocos) antes de tocar no banco', 'ok'), row('pg_restore em transação única', 'ok'),
      row('migrate --check', ok(R.migrateCheck)), row(`Contagens e amostra de linhas (${R.tabelas} tabelas, ${R.linhas} linhas)`, R.diferencas.length ? `**${R.diferencas.length} diferença(s)**` : 'iguais ao manifesto'),
      row('Papéis do Supabase criados sem login (só no banco de ensaio)', R.papeisCriados?.length ? R.papeisCriados.join(', ') : 'nenhum necessário'), '');
    L.push('<details><summary>Contagem por tabela (restaurado × manifesto)</summary>', '', row('Tabela', 'Restaurado', 'Manifesto'), row('---', '---:', '---:'));
    for (const [t, n] of Object.entries(R.contagens || {})) L.push(row(`\`${t}\``, n, R.esperado?.[t] ?? '—'));
    L.push('', '</details>', '');
    if (R.diferencas.length) L.push('Diferenças:', ...R.diferencas.map((d) => `- ${d}`), '');
  }
  if (rep.verifyDeploy) { L.push('## verify-deploy no banco restaurado (offline)', '', row('Verificação', 'Resultado'), row('---', '---')); for (const c of rep.verifyDeploy) L.push(row(c.titulo, `${c.status === 'ok' ? 'ok' : c.status === 'skip' ? 'não se aplica' : c.status.toUpperCase()}${c.detalhe ? ' — ' + c.detalhe : ''}`)); L.push(''); }
  if (rep.arquivos) { const A = rep.arquivos; L.push('## Amostra de arquivos (baixados do espelho cifrado, decifrados e re-hash SHA-256)', '', row('Referenciados no banco', 'Amostra', 'Íntegros', 'Ausentes', 'Corrompidos', 'Tamanho errado', 'Erros', 'Bytes conferidos'), row('---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:'), row(A.referenciados, A.amostra, A.ok, A.ausentes.length, A.corrompidos.length, A.tamanhoErrado.length, A.erros.length, fmtBytes(A.bytes)), ''); }
  if (rep.auth) L.push('## Dados do Supabase Auth', '', rep.auth.presente ? `${ok(rep.auth.ok)} — tabelas ${(rep.auth.tabelas || []).join(', ')}; contagens no manifesto: ${Object.entries(rep.auth.contagens || {}).map(([k, v]) => `${k}=${v}`).join(', ')}` : 'não incluídos neste backup (BACKUP_INCLUDE_AUTH=0)', '');
  L.push('## Tempos', '', row('Fase', 'Tempo'), row('---', '---:'), ...Object.entries(rep.fases || {}).map(([k, v]) => row(k.replace(/_/g, ' '), fmtMs(v))), '');
  L.push('Limites deste ensaio: o banco é restaurado num Postgres puro dentro do runner (sem o restante do Supabase); os arquivos são conferidos por amostra (não todos); o tempo de restauração completa dos arquivos em produção depende da rede (veja docs/BACKUP-E-RESTAURACAO.md §2).', '');
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['help'] }); const sub = args._[0] || 'help'; const redact = buildRedactor(env); const log = (m) => process.stderr.write(redact(m) + '\n');
  if (sub === 'help' || args.help) { process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '') + '\n'); return 0; }
  const target = openTarget(env.BACKUP_TARGET, env); const keys = keyringFromEnv(env).all;
  if (sub === 'info') {
    const b = await escolherBackup({ target, keys, name: args.name || null });
    log(`backup ${b.name}: criado em ${b.createdAt} (${b.ageHours} h), Postgres ${b.pgMajor}, dados do Auth: ${b.hasAuth ? 'sim' : 'não'}`);
    if (args['github-output']) fs.appendFileSync(args['github-output'], `nome=${b.name}\npg_major=${b.pgMajor}\nidade_horas=${b.ageHours}\ncriado_em=${b.createdAt}\ntem_auth=${b.hasAuth}\n`);
    else process.stdout.write(JSON.stringify({ name: b.name, pgMajor: b.pgMajor, ageHours: b.ageHours, createdAt: b.createdAt, hasAuth: b.hasAuth }) + '\n');
    return 0;
  }
  if (sub === 'run') {
    const rep = await ensaiar({ env, target, keys, name: args.name || null, toUrl: args.to, amostraN: Number(args.amostra) > 0 ? Number(args.amostra) : 50, log });
    const md = relatorioMarkdown(rep);
    if (args.relatorio) fs.writeFileSync(args.relatorio, md + '\n');
    if (args.json) fs.writeFileSync(args.json, JSON.stringify(rep, null, 2) + '\n');
    log(rep.ok ? `\nENSAIO APROVADO em ${fmtMs(rep.duracaoMs)}: ${rep.backup}` : `\nENSAIO REPROVADO:\n  - ${rep.problemas.join('\n  - ')}`);
    return rep.ok ? 0 : 1;
  }
  throw new ToolError(`comando desconhecido: ${sub}. Use info | run`, { code: 'usage', exit: 2 });
}
if (isMain(import.meta.url)) runCli(() => main());
