#!/usr/bin/env node
/* Enforce production dependency audit findings from npm audit --omit=dev --json.
   Fail closed if registry/audit response is missing or invalid.
   Do not print package details, registry response, tokens, or raw errors. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
export function assessAudit(report) {
  const v = report?.metadata?.vulnerabilities;
  if (!v || typeof v !== 'object' || report.error) throw new Error('audit_unavailable');
  const counts = {};
  for (const name of LEVELS) {
    const n = v[name];
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('audit_invalid_counts');
    counts[name] = n;
  }
  return { counts, blocked: counts.high + counts.critical > 0 };
}

export function auditSummary(result) {
  return [
    '## npm audit — dependências de produção',
    '',
    ...LEVELS.map((name) => '- ' + name + ': ' + result.counts[name]),
    '',
    result.blocked ? '**Portão reprovado:** corrigir vulnerabilidades altas/críticas antes de integrar.' :
      '**Portão aprovado:** nenhuma vulnerabilidade alta/crítica informada pelo npm audit.',
    '',
  ].join('\n');
}

export function main(path) {
  try {
    if (!path) throw new Error('audit_missing_file');
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const result = assessAudit(report);
    process.stdout.write(auditSummary(result));
    return result.blocked ? 1 : 0;
  } catch {
    process.stdout.write('## npm audit — dependências de produção\n\n**Portão reprovado:** relatório ausente, inválido ou serviço de auditoria indisponível.\n');
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv[2]);
