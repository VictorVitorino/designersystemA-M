import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkApiEnv, parseEnvNames, FORBIDDEN_API_ENV } from '../../tools/verify-deploy.js';
import { ITENS } from '../../tools/lib/chaves.js';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const P = (...x) => path.join(ROOT, 'platform', ...x);
const WF = path.join(ROOT, '.github', 'workflows');
const read = (f) => fs.readFileSync(f, 'utf8');
const files = fs.readdirSync(WF).filter((f) => f.endsWith('.yml')).sort();
const W = (f) => read(path.join(WF, f));

function yamlLoad(file) {
  const r = spawnSync('python3', ['-c', 'import sys,json,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', file], { encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr };
  return JSON.parse(r.stdout);
}
const hasYaml = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' }).status === 0;
const wf = Object.fromEntries(files.map((f) => [f, hasYaml ? yamlLoad(path.join(WF, f)) : null]));
const runs = (w) => Object.values(w.jobs).flatMap((j) => (j.steps || []).map((s) => ({ job: j, step: s })));
const ordem = (text, res) => { const pos = res.map((re) => text.search(re)); assert.ok(pos.every((i) => i >= 0), `passos ausentes: ${res.filter((_, i) => pos[i] < 0).join(' | ')}`); assert.deepEqual([...pos].sort((a, b) => a - b), pos, `ordem dos passos: ${res.join(' → ')}`); };

const TODOS = ['ci', 'e2e', 'codeql', 'deploy-staging', 'deploy-production', 'uptime', 'backup', 'maintenance', 'configurar-supabase', 'configurar-vercel', 'primeiro-admin', 'ensaio-restauracao'];

test('todos os workflows existem e são YAML válido', (t) => {
  for (const n of TODOS) assert.ok(files.includes(`${n}.yml`), `falta ${n}.yml`);
  if (!hasYaml) return t.skip('python3 com PyYAML ausente');
  for (const f of files) assert.ok(!wf[f].error, `${f}: ${wf[f].error}`);
});

test('segurança dos workflows: ações fixadas por SHA, sem "latest", permissões mínimas, sem pull_request_target nem injeção por contexto/inputs', (t) => {
  for (const f of files) {
    const text = W(f);
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: "${m[1]}" precisa estar fixada por SHA de 40 hex`);
    assert.doesNotMatch(text, /@latest\b|@main\b|@master\b|:latest\b/, `${f}: versão móvel`);
    assert.doesNotMatch(text, /pull_request_target/, `${f}: pull_request_target é perigoso`);
    assert.match(text, /^permissions:\n\s+contents: read/m, `${f}: permissions de topo com contents: read`);
    assert.doesNotMatch(text, /permissions:\s*write-all/, f);
  }
  for (const f of ['ci.yml', 'e2e.yml', 'codeql.yml']) assert.doesNotMatch(W(f), /secrets\.(?!GITHUB_TOKEN)/, `${f} roda em PRs: não pode usar segredos`);
  if (!hasYaml) return t.skip('PyYAML ausente (verificações estruturais puladas)');
  for (const f of files) {
    for (const { step } of runs(wf[f])) {
      if (!step.run) continue;
      assert.doesNotMatch(step.run, /vercel@(latest|canary|next)\b/, f);
      // injeção: texto controlável por quem dispara (inputs, título de issue/PR, branch) nunca entra direto em `run:` — só por variável de ambiente
      assert.doesNotMatch(step.run, /\$\{\{\s*(inputs\.|github\.(event\.(issue|pull_request|comment|head_commit|inputs|review)|head_ref))/, `${f}: "${step.name}" usa contexto não confiável dentro de run`);
    }
    // segredo (que não seja o GITHUB_TOKEN) só em job com ambiente do GitHub — exceto o cabeçalho opcional de proteção da Vercel no monitor
    for (const [id, job] of Object.entries(wf[f].jobs)) {
      const usados = [...JSON.stringify(job).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]).filter((n) => n !== 'GITHUB_TOKEN' && n !== 'VERCEL_AUTOMATION_BYPASS_SECRET');
      if (usados.length) assert.ok(job.environment, `${f} → ${id}: usa ${usados.join(', ')} sem "environment:" (segredo de ambiente)`);
    }
  }
});

test('ci.yml: Postgres 16 e 17 do Supabase, Node 22, migrate, testes, build, lockfile, secret-scan, audit como relatório e artefatos de falha', (t) => {
  const text = W('ci.yml');
  for (const re of [/image: postgres:16/, /node-version: 22/, /node tools\/migrate\.js\n\s+node tools\/migrate\.js --check/, /npm test/, /npm run test:security/, /tests\/ops\/\*\.test\.js/, /npm run build:web/, /secret-scan\.js/, /npm audit --omit=dev/, /upload-artifact/, /package-lock\.json/, /build-web\.js --check/]) assert.match(text, re);
  // PUB-11: o Supabase novo é Postgres 17 com "postgres" sem superusuário e privilégios padrão no schema public
  assert.match(text, /image: supabase\/postgres:17\.\d+\.\d+\.\d+\n/, 'imagem do Supabase com versão completa (sem tag móvel)');
  assert.match(text, /verify-deploy\.js --offline/); assert.match(text, /tests\/db\/\*\.test\.js/);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const audit = runs(wf['ci.yml']).find((x) => /npm audit/.test(x.step.run || '')); assert.equal(audit.step['continue-on-error'], true, 'audit é relatório: não bloqueia');
  const pg17 = wf['ci.yml'].jobs['postgres-17']; assert.ok(pg17, 'job postgres-17'); assert.match(pg17.services.postgres.image, /^supabase\/postgres:17\./);
  assert.match(JSON.stringify(pg17.steps), /node tools\/migrate\.js --check/);
});

test('e2e.yml: Playwright pelo lockfile (devDependency exata = PLAYWRIGHT_VERSION), Chromium com --with-deps e contagem certa das suítes', () => {
  const text = W('e2e.yml'); const pkg = JSON.parse(read(P('package.json'))); const lock = JSON.parse(read(P('package-lock.json')));
  const v = /PLAYWRIGHT_VERSION: (\d+\.\d+\.\d+)/.exec(text)?.[1]; assert.ok(v, 'PLAYWRIGHT_VERSION fixa');
  assert.equal(pkg.devDependencies?.playwright, v, 'package.json: devDependency EXATA igual à do workflow (sem ^ nem ~)');
  assert.equal(lock.packages['node_modules/playwright']?.version, v, 'package-lock.json com a mesma versão'); assert.ok(lock.packages['node_modules/playwright']?.integrity, 'com integridade');
  const semComentarios = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(semComentarios, /npm (install|i) [^\n]*playwright/, 'nada de instalar o Playwright fora do lockfile');
  assert.match(text, /npm ci\n/); assert.match(text, /require\("playwright\/package\.json"\)\.version/); assert.match(text, /npx playwright install --with-deps chromium/); assert.match(text, /npm run test:e2e/);
  assert.match(text, /269\+ verificações/); assert.doesNotMatch(text, /264 verificações/);
});

test('codeql.yml: JavaScript; no repositório privado só roda com CODEQL_ENABLED, senão um job curto avisa que pulou (sem falhar)', (t) => {
  const text = W('codeql.yml'); assert.match(text, /languages: javascript-typescript/); assert.match(text, /security-events: write/); assert.match(text, /schedule:/);
  assert.match(text, /test:security/); assert.match(text, /secret-scan/); assert.match(text, /npm audit/);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const j = wf['codeql.yml'].jobs; assert.match(j.analisar.if, /vars\.CODEQL_ENABLED == 'true' \|\| github\.event\.repository\.visibility == 'public'/);
  assert.match(j.pulado.if, /vars\.CODEQL_ENABLED != 'true' && github\.event\.repository\.visibility != 'public'/); assert.match(JSON.stringify(j.pulado.steps), /::notice/);
});

test('deploy-staging: push na main só com STAGING_ENABLED (senão aviso), ambiente staging, chaves mínimas, check → migrate → verify → Vercel → verify do site (build e CSP) → smoke', (t) => {
  const text = W('deploy-staging.yml');
  assert.match(text, /on:\n\s+push:\n\s+branches: \[main\]/); assert.match(text, /name: staging/); assert.match(text, /STAGING_BACKUP/);
  assert.match(text, /node tools\/chaves\.js conferir --precisa banco,papeis,supabase,arquivos,site,vercel/);
  assert.match(text, /DATABASE_ADMIN_URL: \$\{\{ secrets\.DATABASE_ADMIN_URL \}\}/, 'nome antigo aceito (compatibilidade)');
  ordem(text, [/migrate\.js --check/, /node tools\/chaves\.js exec --precisa banco,papeis -- node tools\/migrate\.js\n/, /node tools\/verify-deploy\.js --resumo/, /deploy --prebuilt --target=staging/, /alias set/, /--expect-build "\.\.\/\.vercel\/output\/static,\.vercel\/output\/static,dist\/public"/, /"\$\{SITE%\/\}\/api\/ready"/]);
  assert.match(text, /x-vercel-protection-bypass/);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const j = wf['deploy-staging.yml'].jobs; assert.match(j.desligado.if, /vars\.STAGING_ENABLED != 'true'/); assert.match(j['esperar-ci'].if, /workflow_dispatch' \|\| vars\.STAGING_ENABLED == 'true'/);
  assert.equal(j.publicar.environment.name, 'staging'); assert.deepEqual(j.publicar.needs, 'esperar-ci');
});

test('deploy-production: só tags v* (ou manual digitando PRODUCAO na tag), portão "production" sem segredos, segredos em production-ops, BACKUP antes de migrar, verify do site, rollback', (t) => {
  const text = W('deploy-production.yml');
  assert.match(text, /push:\n\s+tags: \['v\*'\]/); assert.match(text, /workflow_dispatch:/); assert.match(text, /PRODUCAO/); assert.doesNotMatch(text, /branches:/, 'nenhum gatilho por branch');
  assert.match(text, /if \[ "\$TIPO_REF" != "tag" \] \|\| \[\[ "\$NOME_REF" != v\* \]\]/, 'recusa o que não for tag v*');
  ordem(text, [/BACKUP OBRIGATÓRIO/, /migrate\.js --check/, /exec --precisa banco,papeis -- node tools\/migrate\.js\n/, /node tools\/verify-deploy\.js --resumo/, /deploy --prebuilt --prod/, /--expect-env production --expect-build/, /Smoke test/, /ROLLBACK/]);
  assert.match(text, /BACKUP_INCLUDE_AUTH: \$\{\{ vars\.BACKUP_INCLUDE_AUTH \|\| '1' \}\}/, 'contas do login no backup por padrão');
  assert.match(text, /if: failure\(\)/); assert.match(text, /rollback/i);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const j = wf['deploy-production.yml'].jobs;
  assert.equal(j.portao.environment.name, 'production'); assert.doesNotMatch(JSON.stringify(j.portao), /secrets\./, 'o portão não usa segredos');
  assert.equal(j.portao.needs, 'esperar-ci'); assert.equal(j.publicar.needs, 'portao'); assert.equal(j.publicar.environment, 'production-ops');
  assert.match(JSON.stringify(j['esperar-ci']), /listWorkflowRuns/, 'espera o CI verde do commit');
});

test('uptime.yml: de hora em hora só com PRODUCTION_ENABLED/STAGING_ENABLED, issue "Indisponibilidade"; frescor do backup no ambiente monitoring só com BACKUP_ENABLED', () => {
  const text = W('uptime.yml');
  assert.match(text, /cron: '7 \* \* \* \*'/); assert.doesNotMatch(text, /cron: '\*\/5 /, 'de 5 em 5 min gastaria ~8.600 min/mês do plano em repositório privado');
  assert.match(text, /cron: '17 \*\/4 \* \* \*'/); assert.match(text, /if: vars\.BACKUP_ENABLED == 'true' && \(github\.event\.schedule == '17 \*\/4 \* \* \*'/);
  assert.match(text, /if: github\.event\.schedule != '17 \*\/4 \* \* \*' && \(vars\.PRODUCTION_ENABLED == 'true' \|\| vars\.STAGING_ENABLED == 'true'/, 'não gasta minutos antes de ligar');
  assert.match(text, /PRODUCTION_ENABLED == 'true'[^\n]*vars\.PRODUCTION_URL/); assert.match(text, /STAGING_ENABLED == 'true'[^\n]*vars\.STAGING_URL/);
  assert.match(text, /\/api\/health/); assert.match(text, /\/api\/ready/); assert.match(text, /titulo = 'Indisponibilidade'/); assert.match(text, /titulo = 'Backup desatualizado'/); assert.match(text, /run: exit 1/);
  assert.match(text, /backup-freshness --max-hours 26/); assert.match(text, /issues: write/); assert.match(text, /environment: monitoring/); assert.match(text, /--precisa backup-leitura/);
});

test('backup.yml: diário 05:15 UTC só com BACKUP_ENABLED, production-ops, contas do login por padrão, poda só depois de verificado, falha abre issue e sai com erro', () => {
  const text = W('backup.yml'); assert.match(text, /cron: '15 5 \* \* \*'/); assert.match(text, /if: vars\.BACKUP_ENABLED == 'true' \|\| github\.event_name == 'workflow_dispatch'/, 'agendado só com o backup configurado; manual sempre');
  assert.match(text, /backup\.js all/); assert.match(text, /prune --apply/); assert.match(text, /steps\.backup\.outcome == 'success'/); assert.match(text, /Falha no backup/); assert.match(text, /environment: production-ops/);
  assert.match(text, /BACKUP_INCLUDE_AUTH: \$\{\{ vars\.BACKUP_INCLUDE_AUTH \|\| '1' \}\}/);
  assert.match(text, /--max-minutos/, 'a cópia dos arquivos para antes do limite de 6 h do GitHub e continua na noite seguinte');
});

test('maintenance.yml: semanal só com PRODUCTION_ENABLED; issue "Alerta de capacidade" abre/atualiza/fecha; GC só relatório no cron e apagar só por dispatch + APAGAR em production-ops', (t) => {
  const text = W('maintenance.yml'); assert.match(text, /cron: '30 4 \* \* 0'/); assert.match(text, /purge-expired/); assert.match(text, /prune-versions/); assert.match(text, /audit-retention/);
  assert.match(text, /stats [^\n]*--github-output "\$GITHUB_OUTPUT"/); assert.match(text, /titulo = 'Alerta de capacidade'/); assert.match(text, /steps\.stats\.outputs\.capacidade == 'alerta'/); assert.match(text, /steps\.stats\.outputs\.capacidade == 'ok'/);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const w = wf['maintenance.yml']; const rot = JSON.stringify(w.jobs.rotinas); assert.doesNotMatch(rot, /--apply/, 'o job agendado nunca apaga arquivos');
  assert.match(w.jobs.rotinas.if, /vars\.PRODUCTION_ENABLED == 'true' \|\| github\.event_name == 'workflow_dispatch'/);
  const gc = w.jobs['gc-apagar']; assert.match(gc.if, /workflow_dispatch/); assert.match(gc.if, /APAGAR/); assert.equal(gc.environment, 'production-ops'); assert.match(JSON.stringify(gc), /gc-assets\.js --apply/); assert.match(JSON.stringify(gc), /backup-freshness/);
});

test('assistentes (Configurar Supabase/Vercel, Primeiro administrador): só manuais, ambiente escolhido → staging ou production-ops, entradas só por variável de ambiente', (t) => {
  for (const f of ['configurar-supabase.yml', 'configurar-vercel.yml', 'primeiro-admin.yml']) {
    const text = W(f); assert.doesNotMatch(text, /^\s+(push|schedule|pull_request):/m, `${f}: só workflow_dispatch`);
    assert.match(text, /environment: \$\{\{ inputs\.ambiente == 'production' && 'production-ops' \|\| 'staging' \}\}/, f);
  }
  const sup = W('configurar-supabase.yml'); assert.match(sup, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/); assert.match(sup, /node tools\/supabase-setup\.js/); assert.match(sup, /if: always\(\)\n\s+run: echo "::warning title=Apague o SUPABASE_ACCESS_TOKEN/); assert.match(sup, /--simular/);
  const ver = W('configurar-vercel.yml'); assert.match(ver, /node tools\/vercel-setup\.js "\$\{args\[@\]\}"/); assert.match(ver, /group: \$\{\{ inputs\.ambiente == 'production' && 'deploy-production' \|\| 'deploy-staging' \}\}/, 'nunca ao mesmo tempo que o deploy');
  for (const n of ['SSO_ENABLED', 'SSO_DOMAINS', 'STORAGE_QUOTA_USER_MB']) assert.match(ver, new RegExp(`${n}: \\$\\{\\{ vars\\.${n} \\}\\}`));
  const adm = W('primeiro-admin.yml'); assert.match(adm, /EMAIL: \$\{\{ inputs\.email \}\}/); assert.match(adm, /--email "\$EMAIL" --name "\$NOME"/); assert.match(adm, /--precisa ops,servico/);
  if (!hasYaml) return t.skip('PyYAML ausente');
  // a Vercel nunca recebe credencial de ferramenta: o passo que grava as variáveis não tem acesso a elas
  const passo = runs(wf['configurar-vercel.yml']).find((x) => /vercel-setup\.js/.test(x.step.run || '')).step;
  for (const k of Object.keys(passo.env || {})) assert.ok(!['DATABASE_ADMIN_URL', 'DATABASE_OPS_URL', 'APP_OPS_DB_PASSWORD', 'RESEND_API_KEY'].includes(k) && !/^BACKUP_/.test(k), `Configurar Vercel não pode receber ${k}`);
  for (const k of Object.keys(wf['configurar-vercel.yml'].jobs.configurar.env || {})) assert.ok(!FORBIDDEN_API_ENV.includes(k), `env do job: ${k}`);
});

test('ensaio-restauracao.yml: mensal (dia 3) só com BACKUP_ENABLED, Postgres descartável da versão do backup em 127.0.0.1, relatório guardado 90 dias, issue que abre e fecha sozinha', (t) => {
  const text = W('ensaio-restauracao.yml');
  assert.match(text, /cron: '40 6 3 \* \*'/); assert.match(text, /if: vars\.BACKUP_ENABLED == 'true' \|\| github\.event_name == 'workflow_dispatch'/); assert.match(text, /environment: production-ops/);
  ordem(text, [/node tools\/restore-rehearsal\.js "\$\{args\[@\]\}"\n/, /docker run -d --name ensaio-pg/, /-p 127\.0\.0\.1:55432:5432 "postgres:\$\{PG_MAJOR\}"/, /postgresql-client-\$\{PG_CLIENT_MAJOR\}/, /args=\(run --to "postgres:\/\/postgres:ensaio-descartavel@127\.0\.0\.1:55432\/canteiro_ensaio"/, /retention-days: 90/, /titulo = 'Falha no ensaio de restauração'/]);
  assert.match(text, /case "\$PG_MAJOR" in ''\|\*\[!0-9\]\*\)/, 'a versão vem do backup e é validada antes de virar nome de imagem');
  assert.doesNotMatch(text, /(?<![A-Z_])(S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|SUPABASE_DB_PASSWORD|DATABASE_ADMIN_URL|APP_OPS_DB_PASSWORD)/, 'o ensaio não recebe credencial de produção além da leitura do backup');
  if (!hasYaml) return t.skip('PyYAML ausente');
  const passos = wf['ensaio-restauracao.yml'].jobs.ensaio.steps; assert.equal(passos.at(-1).run, 'exit 1'); assert.match(passos.at(-1).if, /steps\.ensaio\.outcome != 'success'/);
});

test('toda secret/variable usada nos workflows está em docs/CHAVES.md, e a contagem do topo bate com as tabelas', () => {
  const doc = read(P('docs', 'CHAVES.md')); const used = new Set();
  for (const f of files) for (const m of W(f).matchAll(/\b(secrets|vars)\.([A-Z][A-Z0-9_]*)/g)) if (m[2] !== 'GITHUB_TOKEN') used.add(m[2]);
  assert.ok(used.size >= 30, `esperava muitos nomes, achei ${used.size}`);
  for (const n of used) assert.ok(doc.includes(n), `${n} não está documentado em docs/CHAVES.md`);
  for (const n of Object.keys(ITENS)) assert.ok(doc.includes('`' + n + '`'), `${n} (chave mínima) não está em docs/CHAVES.md`);
  // contagem: "Total: N valores" = soma das linhas numeradas das tabelas de repositório e de cada ambiente
  const total = Number(/\*\*Total: (\d+) valores/.exec(doc)?.[1]); assert.ok(total > 0, 'total no topo');
  const secao = (titulo) => { const i = doc.indexOf(titulo); assert.ok(i >= 0, titulo); const fim = doc.indexOf('\n## ', i + 1); return doc.slice(i, fim < 0 ? undefined : fim); };
  const linhas = (s) => (s.match(/^\| \d+ \| `[A-Z0-9_]+` \|/gm) || []).length;
  const partes = { repositorio: linhas(secao('## Repositório')), staging: linhas(secao('## Ambiente `staging`')), ops: linhas(secao('## Ambiente `production-ops`')), monitoring: linhas(secao('## Ambiente `monitoring`')) };
  assert.deepEqual(partes, { repositorio: 4, staging: 10, ops: 13, monitoring: 2 });
  assert.equal(Object.values(partes).reduce((a, b) => a + b, 0), total, 'o total do topo é a soma das tabelas');
  assert.match(doc, new RegExp(`repositório ${partes.repositorio}[^·]*· ambiente \`staging\` ${partes.staging} · ambiente \`production-ops\` ${partes.ops} · ambiente \`monitoring\` ${partes.monitoring}`));
  assert.match(doc, /\*\*nunca\*\* vai por chat/i);
});

test('.env.example cobre TODAS as variáveis do config.js e do contrato (API.md §9) e as ferramentas', () => {
  const env = read(P('.env.example')); const cfg = read(P('src', 'config.js')); const api = read(P('docs', 'API.md'));
  const vars = new Set([...cfg.slice(cfg.indexOf('const Env'), cfg.indexOf('export function loadConfig')).matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]));
  for (const m of api.slice(api.indexOf('## 9. Variáveis')).matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)) vars.add(m[1]);
  for (const v of ['BACKUP_TARGET', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEYS_OLD', 'BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_S3_FORCE_PATH_STYLE', 'PG_BIN_DIR', 'TEST_DATABASE_ADMIN_URL']) vars.add(v);
  vars.delete('APP_ENV_'); const miss = [...vars].filter((v) => !new RegExp(`^#?\\s*${v}=`, 'm').test(env)); assert.deepEqual(miss, [], `faltam em .env.example: ${miss}`);
  assert.match(env, /PARTE 1 — VARIÁVEIS DA API/); assert.match(env, /PARTE 2 — SOMENTE FERRAMENTAS/);
});
test('exemplos de ambiente: API sem variável proibida (passam no verificador); CI só com as chaves mínimas de docs/CHAVES.md', () => {
  for (const [f, e] of [['api.production.env.example', 'production'], ['api.staging.env.example', 'staging']]) {
    const r = checkApiEnv(parseEnvNames(read(P('infra', 'env', f))), { expectEnv: e }); assert.equal(r.status, 'ok', `${f}: ${r.items}`);
  }
  for (const f of fs.readdirSync(P('infra', 'env'))) assert.doesNotMatch(read(P('infra', 'env', f)), /eyJ[A-Za-z0-9_-]{20,}\.|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|sb_secret_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{16,}/, f);
  const nomes = (f) => [...read(P('infra', 'env', f)).matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]).sort();
  assert.deepEqual(nomes('ci-staging.secrets.example'), ['APP_API_DB_PASSWORD', 'APP_OPS_DB_PASSWORD', 'RESEND_API_KEY', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_TOKEN']);
  assert.deepEqual(nomes('ci-production-ops.secrets.example'), ['APP_API_DB_PASSWORD', 'APP_OPS_DB_PASSWORD', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY', 'RESEND_API_KEY', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_TOKEN']);
  assert.deepEqual(nomes('ci-monitoring.secrets.example'), ['BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY']); assert.deepEqual(nomes('ci-production.secrets.example'), [], 'o portão não guarda nada');
  assert.deepEqual(nomes('ci-repository.variables.example'), ['PRODUCTION_URL', 'R2_ACCOUNT_ID', 'STAGING_URL']);
});

test('Supabase: config.toml (cadastro fechado, senha ≥ 12, SMTP do Resend, retorno do SSO) e modelos de e-mail em pt-BR para /auth/confirmar', () => {
  const dir = P('infra', 'supabase', 'templates'); const want = { 'invite.html': 'invite', 'recovery.html': 'recovery', 'confirm.html': 'invite' };
  for (const [f, type] of Object.entries(want)) {
    const t = read(path.join(dir, f)); assert.match(t, /<html lang="pt-BR">/); assert.ok(t.includes('{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=' + type), f);
    assert.doesNotMatch(t, /<script|<img|<iframe|javascript:|\{\{ \.ConfirmationURL|https?:\/\/(?!www\.w3\.org)/i, f);
    assert.equal([...t.matchAll(/\{\{[^}]*\}\}/g)].every((m) => /\.SiteURL|\.TokenHash/.test(m[0])), true, `${f}: só SiteURL e TokenHash`);
  }
  const toml = read(P('infra', 'supabase', 'config.toml')); assert.match(toml, /^enable_signup = false/m); assert.match(toml, /minimum_password_length = 12/); assert.match(toml, /enable_refresh_token_rotation = true/); assert.match(toml, /refresh_token_reuse_interval = 10/); assert.doesNotMatch(toml.match(/schemas = \[[^\]]*\]/)[0], /"app"/);
  assert.ok(Number(toml.match(/otp_expiry = (\d+)/)[1]) <= 86400);
  assert.match(toml, /host = "smtp\.resend\.com"/); assert.match(toml, /pass = "env\(RESEND_API_KEY\)"/);
  assert.match(toml, /additional_redirect_urls = \[[^\]]*"https:\/\/canteiro\.<seu-dominio>\/auth\/confirmar"[^\]]*"https:\/\/canteiro\.<seu-dominio>\/api\/auth\/sso\/callback"/, 'retorno do login corporativo (SSO) nas Redirect URLs');
  const auth = read(P('infra', 'supabase', 'auth-settings.md')); for (const k of ['cadastro', 'confirmação de e-mail', 'Minimum password length', 'senha vazada', 'OTP', 'reuse interval', 'SMTP', 'Site URL', 'Redirect URLs', 'ES256', 'Network Restrictions', 'Enforce SSL', 'PITR', 'Data API', 'Public bucket', 'chaves S3', 'S3', 'Resend', '/api/auth/sso/callback']) assert.ok(auth.toLowerCase().includes(k.toLowerCase()), `auth-settings.md não cobre: ${k}`);
});

test('docs obrigatórias: roteiro de publicação (10 itens de aceite), configuração com custos, ambientes, operação, monitoramento e backup', () => {
  const d = (n) => read(P('docs', n));
  const pub = d('PUBLICACAO.md'); const itens = pub.slice(pub.indexOf('## Checklist de aceite')).split('\n## ')[0].match(/^- \[ \] \*\*\d+\./gm) || [];
  assert.equal(itens.length, 10, 'checklist de aceite com 10 itens'); assert.match(pub, /cerca de 30 minutos/);
  ordem(pub, [/## Etapa 1 — Staging/, /## Checklist de aceite/, /## Etapa 2 — Produção/, /Publique a versão 1\.0\.0/, /\*\*Primeiro administrador:\*\*/, /\*\*Backup:\*\*/, /\*\*Ensaio de restauração:\*\*/, /\*\*Monitor externo/, /\*\*Convites e acervo:\*\*/]);
  for (const h of ['Configurar Supabase', 'Configurar Vercel', 'Criar primeiro administrador', 'STAGING_ENABLED', 'PRODUCTION_ENABLED', 'BACKUP_ENABLED', 'SUPABASE_ACCESS_TOKEN', 'não\\*\\* contra os serviços reais']) assert.match(pub, new RegExp(h), `PUBLICACAO sem "${h}"`);
  const cfg = d('CONFIGURACAO.md'); for (const h of ['Contas', 'Custos', 'GitHub', 'Pro', 'Vercel', 'Supabase', 'Cloudflare', 'Resend', 'Better Stack', 'DNS', 'SPF', 'DKIM', 'DMARC', 'primeiro administrador', 'importar o acervo', 'Checklist de aceite', 'migrate.js', 'Required reviewers', 'ruleset', 'CodeQL', 'test:security', 'secret-scan', 'npm audit', '≈ 64', '≈ 98', 'Alternativa autohospedada', 'iss']) assert.match(cfg, new RegExp(h, 'i'), `CONFIGURACAO sem "${h}"`);
  const op = d('OPERACAO.md');
  for (const h of ['Login fora do ar', 'Banco cheio', 'Arquivos faltando', 'vazamento', 'Rollback de deploy', 'Rotação de chaves', 'Contatos e escalonamento', 'Suspender', 'lixeira', 'criar a versão é a aprovação', 'Use workflow from', 'Alerta de capacidade', 'Ensaio de restauração reprovado']) assert.match(op, new RegExp(h, 'i'), `OPERACAO.md sem "${h}"`);
  const bk = d('BACKUP-E-RESTAURACAO.md'); for (const h of ['RPO', 'RTO', 'passo a passo', '14 diários', 'AES-256', 'trimestral', 'Restaurar o banco', 'Ensaio de restauração', '1 TB', 'BACKUP_INCLUDE_AUTH', 'poda']) assert.match(bk, new RegExp(h, 'i'), `BACKUP sem "${h}"`);
  const mon = d('MONITORAMENTO.md'); for (const h of ['UptimeRobot', 'Better Stack', 'Sentry', 'dependência externa', '5xx', 'p95', 'jq', 'Alerta de capacidade', 'Falha no ensaio de restauração']) assert.match(mon, new RegExp(h, 'i'), `MONITORAMENTO sem "${h}"`);
  const amb = d('AMBIENTES.md'); for (const h of ['Local', 'Teste', 'Staging', 'Produção', 'branch', 'Quem pode o quê', 'production-ops', 'tags `v\\*`', 'Required reviewers', 'CodeQL']) assert.match(amb, new RegExp(h, 'i'), `AMBIENTES sem "${h}"`);
  assert.doesNotMatch(amb + cfg + op, /revisores obrigatórios (aprovam|precisam)|aprovação dos revisores|os revisores aprovam/i, 'não existem revisores obrigatórios no plano');
  for (const n of ['OPERACAO.md', 'BACKUP-E-RESTAURACAO.md', 'MONITORAMENTO.md', 'AMBIENTES.md', 'CONFIGURACAO.md', 'CHAVES.md', 'PUBLICACAO.md']) assert.doesNotMatch(d(n), /\bTODO\b|\bFIXME\b|lorem ipsum/, n);
  const ev = d('evidencias/restore-drill.md'); assert.match(ev, /APROVADO/); assert.match(ev, /RTO observado/);
  assert.ok(JSON.parse(d('evidencias/restore-drill.json')).ok === true);
});

test('Docker: imagens fixadas por digest, .dockerignore enxuto na raiz, sem segredo embutido, Postgres sem porta publicada, API sem credenciais de operação', (t) => {
  const df = read(P('Dockerfile')); assert.match(df, /^USER node/m); assert.match(df, /HEALTHCHECK/); assert.doesNotMatch(df, /:latest\b/); assert.match(df, /node:22/);
  const froms = [...df.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]); assert.equal(froms.length, 3); for (const f of froms) assert.match(f, /^node:22-bookworm-slim@sha256:[0-9a-f]{64}$/, `FROM ${f} sem digest`);
  const dc = read(P('docker-compose.yml')); assert.doesNotMatch(dc, /:latest\b/); assert.match(dc, /\$\{POSTGRES_PASSWORD:\?/);
  for (const m of dc.matchAll(/^\s+image: (\S+)/gm)) assert.ok(/@sha256:[0-9a-f]{64}$/.test(m[1]) || /^\$\{[A-Z_]+_IMAGE:\?/.test(m[1]), `imagem sem digest: ${m[1]}`);
  const di = read(path.join(ROOT, '.dockerignore')).split('\n').map((l) => l.trim());
  for (const x of ['.git', '**/node_modules', 'platform/.tmp', 'platform/dist', 'platform/.data', '**/.env', '**/.env.*', 'original', 'referencias', 'platform/test-results', 'platform/infra/docker/pgcerts']) assert.ok(di.includes(x), `.dockerignore sem ${x}`);
  for (const x of ['studio', 'am', 'fonts2', 'platform']) assert.ok(!di.includes(x), `.dockerignore não pode excluir ${x} (o build do site usa)`);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const c = yamlLoad(P('docker-compose.yml')); assert.ok(!c.error, c.error); for (const s of ['postgres', 'api', 'caddy', 'migrate', 'gotrue', 'minio']) assert.ok(c.services[s], s);
  assert.equal(c.services.postgres.ports, undefined, 'Postgres não publica porta no host'); assert.deepEqual(c.services.caddy.ports.slice(0, 2), ['80:80', '443:443']);
  assert.doesNotMatch(JSON.stringify(c.services.api.environment), /DATABASE_ADMIN_URL|DATABASE_OPS_URL|BACKUP_/); assert.equal(c.services.api.environment.APP_ENV, 'production'); assert.equal(c.services.api.environment.DATABASE_SSL, 'require');
});
