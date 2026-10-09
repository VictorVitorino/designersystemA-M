import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessAudit, auditSummary } from '../../tools/enforce-audit.js';

const zero = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
const report = (patch = {}) => ({ metadata: { vulnerabilities: { ...zero, ...patch, total: 0 } } });

test('zero alertas e severidades menores não bloqueiam; alta ou crítica bloqueia', () => {
  assert.equal(assessAudit(report()).blocked, false);
  assert.equal(assessAudit(report({ moderate: 2, low: 1 })).blocked, false);
  assert.equal(assessAudit(report({ high: 1 })).blocked, true);
  assert.equal(assessAudit(report({ critical: 1 })).blocked, true);
});

test('falha fechada para serviço indisponível, relatório ausente, contagens inválidas ou JSON inesperado', () => {
  for (const bad of [null, {}, { error: { message: 'token secreto' } }, report({ high: -1 }),
    report({ high: NaN }), report({ critical: '0' }), { metadata: { vulnerabilities: { high: 0, critical: 0 } } }]) {
    assert.throws(() => assessAudit(bad));
  }
});

test('o diagnóstico contém apenas contagens, sem detalhes nem dados do registry', () => {
  const raw = report({ high: 1 });
  raw.vulnerabilities = { malicious: { token: 'FAKE_SECRET_SHOULD_NOT_LOG' } };
  const output = auditSummary(assessAudit(raw));
  assert.match(output, /Portão reprovado/);
  assert.doesNotMatch(output, /FAKE_SECRET_SHOULD_NOT_LOG|malicious|registry/);
});

test('CLI retorna falha em vulnerabilidade alta, JSON corrompido ou resposta de erro', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canteiro-audit-'));
  const cli = fileURLToPath(new URL('../../tools/enforce-audit.js', import.meta.url));
  const file = path.join(dir, 'audit.json');
  const run = (value) => { writeFileSync(file, value); return spawnSync(process.execPath, [cli, file], { encoding: 'utf8' }); };
  try {
    assert.equal(run(JSON.stringify(report())).status, 0);
    assert.equal(run(JSON.stringify(report({ high: 1 }))).status, 1);
    assert.equal(run('{ invalid-json').status, 1);
    const unknown = run(JSON.stringify({ error: 'REMOTE_SENSITIVE_VALUE' }));
    assert.equal(unknown.status, 1);
    assert.doesNotMatch(unknown.stdout + unknown.stderr, /REMOTE_SENSITIVE_VALUE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('workflow CI nunca ignora o resultado do portão de severidade alta/crítica', () => {
  const yaml = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const block = yaml.split('      - name: Auditoria de dependências')[1]?.split('      - name: Guardar relatórios')[0];
  assert.ok(block, 'auditoria de produção deve existir no CI');
  assert.match(block, /npm audit --omit=dev --json/);
  assert.match(block, /node tools\/enforce-audit\.js/);
  assert.doesNotMatch(block, /continue-on-error:\s*true/);
  assert.doesNotMatch(block, /node tools\/enforce-audit\.js[^\n]*\|\|\s*true/);
});
