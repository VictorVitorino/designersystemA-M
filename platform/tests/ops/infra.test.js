import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkApiEnv, parseEnvNames } from '../../tools/verify-deploy.js';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const P = (...x) => path.join(ROOT, 'platform', ...x);
const WF = path.join(ROOT, '.github', 'workflows');
const read = (f) => fs.readFileSync(f, 'utf8');
const files = fs.readdirSync(WF).filter((f) => f.endsWith('.yml')).sort();

function yamlLoad(file) {
  const r = spawnSync('python3', ['-c', 'import sys,json,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', file], { encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr };
  return JSON.parse(r.stdout);
}
const hasYaml = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' }).status === 0;
const wf = Object.fromEntries(files.map((f) => [f, hasYaml ? yamlLoad(path.join(WF, f)) : null]));
const runs = (w) => Object.values(w.jobs).flatMap((j) => (j.steps || []).map((s) => ({ job: j, step: s })));

test('todos os workflows existem e são YAML válido', (t) => {
  for (const n of ['ci', 'e2e', 'codeql', 'deploy-staging', 'deploy-production', 'uptime', 'backup', 'maintenance']) assert.ok(files.includes(`${n}.yml`), `falta ${n}.yml`);
  if (!hasYaml) return t.skip('python3 com PyYAML ausente');
  for (const f of files) assert.ok(!wf[f].error, `${f}: ${wf[f].error}`);
});

test('segurança dos workflows: ações fixadas por SHA, sem "latest", permissões mínimas, sem pull_request_target nem injeção por contexto', (t) => {
  for (const f of files) {
    const text = read(path.join(WF, f));
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: "${m[1]}" precisa estar fixada por SHA de 40 hex`);
    assert.doesNotMatch(text, /@latest\b|@main\b|@master\b|:latest\b/, `${f}: versão móvel`);
    assert.doesNotMatch(text, /pull_request_target/, `${f}: pull_request_target é perigoso`);
    assert.match(text, /^permissions:\n\s+contents: read/m, `${f}: permissions de topo com contents: read`);
    assert.doesNotMatch(text, /permissions:\s*write-all/, f);
    // injeção: contexto controlável por terceiros nunca entra em `run:`
    for (const m of text.matchAll(/run:\s*[|>]?-?\s*\n?((?:.*\n?)*?)(?=\n\s*-\s+(?:name|uses)|\n\S|$)/g)) assert.doesNotMatch(m[1], /\$\{\{\s*github\.(event\.(issue|pull_request|comment|head_commit|inputs)|head_ref)/, `${f}: contexto não confiável dentro de run`);
  }
  for (const f of ['ci.yml', 'e2e.yml', 'codeql.yml']) assert.doesNotMatch(read(path.join(WF, f)), /secrets\.(?!GITHUB_TOKEN)/, `${f} roda em PRs: não pode usar segredos`);
  if (!hasYaml) return t.skip('PyYAML ausente (verificações estruturais puladas)');
  for (const f of files) for (const { step } of runs(wf[f])) if (step.run) assert.doesNotMatch(step.run, /vercel@(latest|canary|next)\b/);
});

test('ci.yml: Postgres 16, Node 22, migrate, testes, build, lockfile, secret-scan, audit como relatório e artefatos de falha', (t) => {
  const text = read(path.join(WF, 'ci.yml'));
  for (const re of [/image: postgres:16/, /node-version: 22/, /node tools\/migrate\.js\n\s+node tools\/migrate\.js --check/, /npm test/, /npm run test:security/, /tests\/ops\/\*\.test\.js/, /npm run build:web/, /secret-scan\.js/, /npm audit --omit=dev/, /upload-artifact/, /package-lock\.json/, /build-web\.js --check/]) assert.match(text, re);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const audit = runs(wf['ci.yml']).find((x) => /npm audit/.test(x.step.run || '')); assert.equal(audit.step['continue-on-error'], true, 'audit é relatório: não bloqueia');
});
test('e2e.yml: job separado, Playwright com versão fixa e chromium via npx playwright install --with-deps chromium', () => {
  const text = read(path.join(WF, 'e2e.yml')); assert.match(text, /npx playwright install --with-deps chromium/); assert.match(text, /PLAYWRIGHT_VERSION: \d+\.\d+\.\d+/); assert.match(text, /npm run test:e2e/);
});
test('codeql.yml: JavaScript, push/PR/semanal', () => { const t = read(path.join(WF, 'codeql.yml')); assert.match(t, /languages: javascript-typescript/); assert.match(t, /security-events: write/); assert.match(t, /schedule:/); });

test('deploy-staging: push na main, ambiente staging, migrate com DATABASE_ADMIN_URL, verify-deploy, Vercel, alias e smoke /api/ready', (t) => {
  const text = read(path.join(WF, 'deploy-staging.yml'));
  assert.match(text, /on:\n\s+push:\n\s+branches: \[main\]/); assert.match(text, /name: staging/); assert.match(text, /DATABASE_ADMIN_URL: \$\{\{ secrets\.DATABASE_ADMIN_URL \}\}/); assert.match(text, /verify-deploy\.js/); assert.match(text, /deploy --prebuilt --target=staging/); assert.match(text, /alias set/); assert.match(text, /\/api\/ready/); assert.match(text, /STAGING_BACKUP/);
  const idx = (re) => text.search(re); assert.ok(idx(/migrate\.js --check/) < idx(/node tools\/migrate\.js\n/) && idx(/node tools\/migrate\.js\n/) < idx(/deploy --prebuilt/), 'ordem: check → migrate → deploy');
});
test('deploy-production: manual+tags, ambiente production (revisores), backup ANTES de migrar, migrate --check → migrate → deploy --prod → verify → smoke, rollback documentado', () => {
  const text = read(path.join(WF, 'deploy-production.yml'));
  assert.match(text, /workflow_dispatch:/); assert.match(text, /tags: \['v\*'\]/); assert.match(text, /name: production\b/); assert.match(text, /PRODUCAO/);
  const order = [/BACKUP OBRIGATÓRIO/, /migrate\.js --check/, /\n\s+run: node tools\/migrate\.js\n/, /verify-deploy\.js\n/, /deploy --prebuilt --prod/, /--expect-env production/, /Smoke test/, /ROLLBACK/].map((re) => text.search(re));
  assert.ok(order.every((i) => i >= 0), `passos ausentes: ${order}`); assert.deepEqual([...order].sort((a, b) => a - b), order, 'ordem dos passos');
  assert.match(text, /rollback/i); assert.match(text, /if: failure\(\)/);
});
test('uptime.yml: a cada 5 min, health e ready de produção e staging, issue "Indisponibilidade", exit≠0 e frescor do backup', () => {
  const text = read(path.join(WF, 'uptime.yml'));
  assert.match(text, /cron: '\*\/5 \* \* \* \*'/); assert.match(text, /\/api\/health/); assert.match(text, /\/api\/ready/); assert.match(text, /PRODUCTION_URL/); assert.match(text, /STAGING_URL/); assert.match(text, /titulo = 'Indisponibilidade'/); assert.match(text, /run: exit 1/); assert.match(text, /backup-freshness --max-hours 26/); assert.match(text, /issues: write/);
});
test('backup.yml: diário 05:15 UTC, backup all, poda só depois de verificado, falha abre issue e sai com erro', () => {
  const text = read(path.join(WF, 'backup.yml')); assert.match(text, /cron: '15 5 \* \* \*'/); assert.match(text, /backup\.js all/); assert.match(text, /prune --apply/); assert.match(text, /steps\.backup\.outcome == 'success'/); assert.match(text, /Falha no backup/); assert.match(text, /environment: production-ops/);
});
test('maintenance.yml: semanal; GC só relatório no cron e apagar só por dispatch + confirmação + ambiente production', (t) => {
  const text = read(path.join(WF, 'maintenance.yml')); assert.match(text, /cron: '30 4 \* \* 0'/); assert.match(text, /purge-expired/); assert.match(text, /prune-versions/); assert.match(text, /audit-retention/);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const w = wf['maintenance.yml']; const rot = JSON.stringify(w.jobs.rotinas); assert.doesNotMatch(rot, /--apply/, 'o job agendado nunca apaga arquivos');
  const gc = w.jobs['gc-apagar']; assert.match(gc.if, /workflow_dispatch/); assert.match(gc.if, /APAGAR/); assert.equal(gc.environment, 'production'); assert.match(JSON.stringify(gc), /gc-assets\.js --apply/);
});

test('toda secret/variable usada nos workflows está documentada em docs/CONFIGURACAO.md', () => {
  const doc = read(P('docs', 'CONFIGURACAO.md')); const used = new Set();
  for (const f of files) for (const m of read(path.join(WF, f)).matchAll(/\b(secrets|vars)\.([A-Z][A-Z0-9_]*)/g)) if (m[2] !== 'GITHUB_TOKEN') used.add(m[2]);
  assert.ok(used.size >= 20, `esperava muitos nomes, achei ${used.size}`);
  for (const n of used) assert.ok(doc.includes(n), `${n} não está documentado em CONFIGURACAO.md`);
});

test('.env.example cobre TODAS as variáveis do config.js e do contrato (API.md §9) e as ferramentas', () => {
  const env = read(P('.env.example')); const cfg = read(P('src', 'config.js')); const api = read(P('docs', 'API.md'));
  const vars = new Set([...cfg.slice(cfg.indexOf('const Env'), cfg.indexOf('export function loadConfig')).matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]));
  for (const m of api.slice(api.indexOf('## 9. Variáveis')).matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)) vars.add(m[1]);
  for (const v of ['BACKUP_TARGET', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEYS_OLD', 'BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_S3_FORCE_PATH_STYLE', 'PG_BIN_DIR', 'TEST_DATABASE_ADMIN_URL']) vars.add(v);
  vars.delete('APP_ENV_'); const miss = [...vars].filter((v) => !new RegExp(`^#?\\s*${v}=`, 'm').test(env)); assert.deepEqual(miss, [], `faltam em .env.example: ${miss}`);
  assert.match(env, /PARTE 1 — VARIÁVEIS DA API/); assert.match(env, /PARTE 2 — SOMENTE FERRAMENTAS/);
});
test('exemplos de ambiente da API não têm variável proibida e passam no verificador', () => {
  for (const [f, e] of [['api.production.env.example', 'production'], ['api.staging.env.example', 'staging']]) {
    const r = checkApiEnv(parseEnvNames(read(P('infra', 'env', f))), { expectEnv: e }); assert.equal(r.status, 'ok', `${f}: ${r.items}`);
  }
  for (const f of fs.readdirSync(P('infra', 'env'))) assert.doesNotMatch(read(P('infra', 'env', f)), /eyJ[A-Za-z0-9_-]{20,}\.|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY/, f);
});

test('modelos de e-mail do Supabase: pt-BR, link para /auth/confirmar com token_hash, sem scripts nem imagens externas', () => {
  const dir = P('infra', 'supabase', 'templates'); const want = { 'invite.html': 'invite', 'recovery.html': 'recovery', 'confirm.html': 'invite' };
  for (const [f, type] of Object.entries(want)) {
    const t = read(path.join(dir, f)); assert.match(t, /<html lang="pt-BR">/); assert.ok(t.includes('{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=' + type), f);
    assert.doesNotMatch(t, /<script|<img|<iframe|javascript:|\{\{ \.ConfirmationURL|https?:\/\/(?!www\.w3\.org)/i, f);
    assert.equal([...t.matchAll(/\{\{[^}]*\}\}/g)].every((m) => /\.SiteURL|\.TokenHash/.test(m[0])), true, `${f}: só SiteURL e TokenHash`);
  }
  const toml = read(P('infra', 'supabase', 'config.toml')); assert.match(toml, /^enable_signup = false/m); assert.match(toml, /minimum_password_length = 12/); assert.match(toml, /enable_refresh_token_rotation = true/); assert.match(toml, /refresh_token_reuse_interval = 10/); assert.doesNotMatch(toml.match(/schemas = \[[^\]]*\]/)[0], /"app"/);
  assert.ok(Number(toml.match(/otp_expiry = (\d+)/)[1]) <= 86400);
  const auth = read(P('infra', 'supabase', 'auth-settings.md')); for (const k of ['cadastro', 'confirmação de e-mail', 'Minimum password length', 'senha vazada', 'OTP', 'reuse interval', 'SMTP', 'Site URL', 'Redirect URLs', 'ES256', 'Network Restrictions', 'Enforce SSL', 'PITR', 'Data API', 'Public bucket', 'chaves S3', 'S3']) assert.ok(auth.toLowerCase().includes(k.toLowerCase()), `auth-settings.md não cobre: ${k}`);
});

test('docs obrigatórias existem com os incidentes, metas e ambientes pedidos', () => {
  const d = (n) => read(P('docs', n)); const op = d('OPERACAO.md');
  for (const h of ['Login fora do ar', 'Banco cheio', 'Arquivos faltando', 'vazamento', 'Rollback de deploy', 'Rotação de chaves', 'Contatos e escalonamento', 'Suspender', 'lixeira']) assert.match(op, new RegExp(h, 'i'), `OPERACAO.md sem "${h}"`);
  const bk = d('BACKUP-E-RESTAURACAO.md'); for (const h of ['RPO', 'RTO', 'passo a passo', '14 diários', 'AES-256', 'trimestral', 'Restaurar o banco']) assert.match(bk, new RegExp(h, 'i'), `BACKUP sem "${h}"`);
  const mon = d('MONITORAMENTO.md'); for (const h of ['UptimeRobot', 'Better Stack', 'Sentry', 'dependência externa', '5xx', 'p95', 'jq']) assert.match(mon, new RegExp(h, 'i'), `MONITORAMENTO sem "${h}"`);
  const amb = d('AMBIENTES.md'); for (const h of ['Local', 'Teste', 'Staging', 'Produção', 'branch', 'Quem pode o quê']) assert.match(amb, new RegExp(h, 'i'), `AMBIENTES sem "${h}"`);
  const cfg = d('CONFIGURACAO.md'); for (const h of ['Contas', 'Supabase', 'Vercel', 'DNS', 'SPF', 'DKIM', 'DMARC', 'primeiro administrador', 'Importar o acervo', 'Checklist de aceite', 'migrate.js']) assert.match(cfg, new RegExp(h, 'i'), `CONFIGURACAO sem "${h}"`);
  for (const n of ['OPERACAO.md', 'BACKUP-E-RESTAURACAO.md', 'MONITORAMENTO.md', 'AMBIENTES.md', 'CONFIGURACAO.md']) assert.doesNotMatch(d(n), /\bTODO\b|\bFIXME\b|lorem ipsum/, n);
  const ev = d('evidencias/restore-drill.md'); assert.match(ev, /APROVADO/); assert.match(ev, /RTO observado/);
  assert.ok(JSON.parse(d('evidencias/restore-drill.json')).ok === true);
});

test('docker-compose e Dockerfile: sintaxe, sem "latest", sem segredo embutido, Postgres sem porta publicada, API sem credenciais de operação', (t) => {
  const df = read(P('Dockerfile')); assert.match(df, /^USER node/m); assert.match(df, /HEALTHCHECK/); assert.doesNotMatch(df, /:latest\b/); assert.match(df, /node:22/);
  const dc = read(P('docker-compose.yml')); assert.doesNotMatch(dc, /:latest\b/); assert.match(dc, /\$\{POSTGRES_PASSWORD:\?/);
  if (!hasYaml) return t.skip('PyYAML ausente');
  const c = yamlLoad(P('docker-compose.yml')); assert.ok(!c.error, c.error); for (const s of ['postgres', 'api', 'caddy', 'migrate', 'gotrue', 'minio']) assert.ok(c.services[s], s);
  assert.equal(c.services.postgres.ports, undefined, 'Postgres não publica porta no host'); assert.deepEqual(c.services.caddy.ports.slice(0, 2), ['80:80', '443:443']);
  assert.doesNotMatch(JSON.stringify(c.services.api.environment), /DATABASE_ADMIN_URL|DATABASE_OPS_URL|BACKUP_/); assert.equal(c.services.api.environment.APP_ENV, 'production'); assert.equal(c.services.api.environment.DATABASE_SSL, 'require');
});
