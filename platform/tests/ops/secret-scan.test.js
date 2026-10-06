import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmp, rmrf } from './_helpers.js';
import { scanText, scanTree } from '../../tools/secret-scan.js';

// Os "segredos" abaixo são MONTADOS em tempo de execução: este arquivo não contém nenhum padrão completo (e o próprio secret-scan passa sobre ele).
const rnd = (n, al = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') => Array.from({ length: n }, (_, i) => al[(i * 7 + 3 + (i % 5) * 11) % al.length]).join('');
const jwt = (payload) => ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), rnd(43)].join('.');
const rules = (text) => scanText(text, 't.txt').map((f) => f.rule);

test('detecta cada família de segredo exigida', () => {
  const cases = {
    'aws-access-key': 'chave = ' + 'AKIA' + 'QWERTYUIOPASDFGH',
    'aws-secret-key': 'aws_secret_access_key = "' + 'q7L2xV9mP4tR8nB3cK6w' + 'Z1yH5jD0fG/sA+uE2oI4' + '"',
    'gcp-api-key': 'key=' + 'AIza' + 'SyA-1234567890abcdefghijklmnopqrstu',
    'gcp-service-account': '{"private_key_id": "' + 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' + '"}',
    'supabase-service-role-jwt': 'SUPABASE_SERVICE_ROLE_KEY=' + jwt({ role: 'service_role', iss: 'supabase', exp: 2000000000 }),
    'jwt-longo': 'token: ' + jwt({ role: 'anon', iss: 'supabase', exp: 2000000000 }),
    'supabase-secret-key': 'k=' + 'sb_secret_' + rnd(30),
    'supabase-access-token': 'k=' + 'sbp_' + '0123456789abcdef0123456789abcdef01234567',
    'slack-token': 'SLACK=' + 'xoxb-' + '123456789012-1234567890123-' + rnd(24),
    'slack-webhook': 'https://hooks.' + 'slack.com/services/' + 'T01234ABCDE/B01234ABCDE/' + rnd(24),
    'github-token': 'GH=' + 'ghp_' + rnd(36),
    'github-fine-grained-token': 'GH=' + 'github_pat_' + rnd(60),
    'stripe-live-key': 'STRIPE=' + 'sk_live_' + rnd(24),
    'stripe-webhook-secret': 'W=' + 'whsec_' + rnd(32),
    'private-key-block': '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIE...',
    'db-url-password': 'DATABASE_URL=postgres://postgres:' + 'Zq81xKd92LmPw' + '@db.abcdefghij.supabase.co:5432/postgres',
    'segredo-generico': 'const apiKey = "' + 'k9Xw3PqL7vNz2RtY8mB4cD6f' + '";',
  };
  for (const [rule, text] of Object.entries(cases)) assert.ok(rules(text).includes(rule), `deveria detectar ${rule}: achou [${rules(text)}]`);
});

test('não imprime o segredo inteiro', () => {
  const s = 'ghp_' + rnd(36); const f = scanText('x=' + s, 'a.js')[0]; assert.ok(!JSON.stringify(f).includes(s)); assert.match(f.preview, /…/);
});

test('falsos positivos comuns NÃO disparam', () => {
  const ok = [
    'DATABASE_URL=postgres://usuario:SENHA@host:5432/banco', 'postgres://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
    'postgres://app_api:${APP_API_DB_PASSWORD}@db:5432/canteiro', 'postgres://postgres:postgres@127.0.0.1:5432/canteiro_test', 'postgres://app_ops:<senha>@localhost/x',
    'postgres://u:x@h/db', 'redis://default:changeme@cache.exemplo.com:6379',
    'AKIAIOSFODNN7EXAMPLE', 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
    'const password = "senha-de-exemplo-123456789"', 'token: process.env.SUPABASE_SERVICE_ROLE_KEY', 'password: "${{ secrets.DB_PASSWORD }}"', 'api_key = "<cole-a-chave-aqui-por-favor>"',
    'sha512-' + rnd(80), 'integrity: "' + rnd(64) + '"', 'background:url(data:image/png;base64,' + rnd(300) + ')', 'const hash = "' + 'a'.repeat(64) + '"', 'secret-scan:allow ghp_' + rnd(36),
    'tokenizer = "simple-word-tokenizer-v2-pt-br"', 'const csrfToken = "x-csrf-token-header-name"', 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig',
    'SUPABASE_ANON_KEY=' + jwt({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 }),
  ];
  for (const t of ok) assert.deepEqual(rules(t), [], `falso positivo: ${t.slice(0, 80)} → ${rules(t)}`);
});

function repo(files) {
  const d = tmp('repo'); execFileSync('git', ['init', '-q'], { cwd: d });
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
  execFileSync('git', ['add', '-A'], { cwd: d }); return d;
}
test('arquivos sensíveis versionados: .env, chave privada, credenciais; exemplos (.env.example) são aceitos', () => {
  const d = repo({ '.env': 'A=1', 'platform/.env.production': 'A=1', 'platform/.env.example': 'A=', 'infra/ssh/id_rsa': 'x', 'deploy/server.pem': 'x', 'app/service-account-prod.json': '{}', 'src/ok.js': 'export const a = 1;' });
  try { const { findings } = scanTree({ root: d }); const files = findings.filter((f) => f.rule === 'arquivo-sensivel').map((f) => f.file).sort(); assert.deepEqual(files, ['.env', 'app/service-account-prod.json', 'deploy/server.pem', 'infra/ssh/id_rsa', 'platform/.env.production']); } finally { rmrf(d); }
});
test('varre o git: acha o segredo com arquivo:linha, ignora o que não está versionado e o allowlist de caminhos', () => {
  const d = repo({ 'src/a.js': 'const x = 1;\nconst t = "' + 'ghp_' + rnd(36) + '";\n', 'original/x.js': 'ghp_' + rnd(36), 'bin/img.png': 'ghp_' + rnd(36) }); fs.writeFileSync(path.join(d, 'nao-versionado.js'), 'ghp_' + rnd(36));
  try {
    const { findings } = scanTree({ root: d }); assert.deepEqual(findings.map((f) => `${f.file}:${f.line}`), ['src/a.js:2']);
    assert.equal(scanTree({ root: d, untracked: true }).findings.length, 2);
    const cli = spawnSync(process.execPath, [new URL('../../tools/secret-scan.js', import.meta.url).pathname, '--root', d], { encoding: 'utf8' }); assert.equal(cli.status, 1); assert.match(cli.stderr, /src\/a\.js:2/); assert.doesNotMatch(cli.stderr, /ghp_[A-Za-z0-9]{36}/);
    fs.writeFileSync(path.join(d, 'src/a.js'), 'const x = 1;\n'); fs.rmSync(path.join(d, 'nao-versionado.js')); execFileSync('git', ['add', '-A'], { cwd: d });
    execFileSync('git', ['rm', '-q', '--cached', 'original/x.js'], { cwd: d }); assert.equal(spawnSync(process.execPath, [new URL('../../tools/secret-scan.js', import.meta.url).pathname, '--root', d], { encoding: 'utf8' }).status, 0);
  } finally { rmrf(d); }
});
test('--staged olha só o que vai ser commitado', () => {
  const d = repo({ 'a.txt': 'ok' }); try {
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: d }); fs.writeFileSync(path.join(d, 'novo.js'), 'k="' + 'ghp_' + rnd(36) + '"'); execFileSync('git', ['add', 'novo.js'], { cwd: d });
    assert.equal(scanTree({ root: d, staged: true }).findings.length, 1); assert.equal(scanTree({ root: d }).findings.length, 1);
  } finally { rmrf(d); }
});
test('o repositório real está limpo (inclui arquivos novos ainda não versionados)', () => {
  const root = path.resolve(new URL('../../..', import.meta.url).pathname); const { findings, files } = scanTree({ root, untracked: true });
  assert.ok(files > 100); assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.rule}`), []);
});
