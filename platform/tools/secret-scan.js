#!/usr/bin/env node
/* tools/secret-scan.js — procura segredos nos arquivos versionados (git ls-files) e falha (exit 1) se achar.
   Uso:  node tools/secret-scan.js [--root DIR] [--staged] [--untracked] [--dir PASTA] [--json]
     (padrão) arquivos rastreados pelo git na raiz do repositório
     --staged     só o que está na área de preparação (use como pre-commit)
     --untracked  também arquivos novos ainda não versionados (e não ignorados)
     --dir PASTA  varre uma pasta qualquer, sem git (ex.: o build do site antes de publicar)
   Nunca imprime o segredo inteiro: só tipo, arquivo:linha e uma prévia mascarada.
   Exceções: veja tools/lib/secret-rules.js (valores/caminhos permitidos) ou o marcador `secret-scan:allow` na linha. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, runCli, isMain, ToolError } from './lib/common.js';
import { RULES, ALLOW_VALUES, isAllowedPath, sensitiveFileFinding, redactPreview, posix } from './lib/secret-rules.js';

const MAX_BYTES = 8 * 1024 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp4|mov|pptx|xlsx|docx|wasm|br)$/i;

/** Procura segredos em um texto. Devolve [{file,line,rule,severity,preview}]. */
export function scanText(text, file = '(texto)') {
  const out = []; const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; if (line.length > 400000) continue;           // linhas gigantes (base64 de imagem) não têm segredos úteis
    if (line.includes('secret-scan:allow')) continue;
    for (const rule of RULES) {
      rule.re.lastIndex = 0; let m;
      while ((m = rule.re.exec(line))) {
        const val = m[rule.group || 0];
        if (ALLOW_VALUES.has(val) || [...ALLOW_VALUES].some((a) => val.includes(a))) continue;
        let id = rule.id, severity = rule.severity;
        if (rule.classify) { const c = rule.classify(val); if (!c) continue; id = c.id; severity = c.severity; }
        if (rule.check && !rule.check(val, m)) continue;
        out.push({ file, line: i + 1, rule: id, severity, preview: redactPreview(val) });
        if (m[0].length === 0) rule.re.lastIndex++;
      }
    }
  }
  return out;
}
export function scanFile(abs, rel) {
  const findings = []; const sens = sensitiveFileFinding(rel); if (sens) findings.push({ file: rel, line: 0, rule: 'arquivo-sensivel', severity: 'alta', preview: sens });
  if (isAllowedPath(rel) || BINARY_EXT.test(rel)) return findings;
  let st; try { st = fs.statSync(abs); } catch { return findings; } if (!st.isFile() || st.size > MAX_BYTES) return findings;
  const buf = fs.readFileSync(abs); if (buf.subarray(0, 8000).includes(0)) return findings;
  return findings.concat(scanText(buf.toString('utf8'), rel));
}
function gitFiles(root, { staged, untracked }) {
  try {
    const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : untracked ? ['ls-files', '-z', '--cached', '--others', '--exclude-standard'] : ['ls-files', '-z'];
    return execFileSync('git', ['-C', root, ...args], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
  } catch (e) { throw new ToolError('não consegui listar os arquivos do git (esta pasta é um repositório?). Use --dir PASTA para varrer sem git', { code: 'no_git', exit: 2 }); }
}
function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue; const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, acc); else if (e.isFile()) acc.push(posix(path.relative(base, p)));
  }
  return acc;
}
/** Varre o repositório (ou pasta). Devolve {files, findings}. */
export function scanTree({ root = process.cwd(), dir = null, staged = false, untracked = false } = {}) {
  const base = path.resolve(dir || root); const files = dir ? walk(base) : gitFiles(base, { staged, untracked });
  const findings = []; for (const rel of files) findings.push(...scanFile(path.join(base, rel), posix(rel)));
  return { files: files.length, findings };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { bool: ['staged', 'untracked', 'json'] });
  const root = path.resolve(args.root || (process.env.GITHUB_WORKSPACE || process.cwd()));
  const { files, findings } = scanTree({ root, dir: args.dir, staged: args.staged, untracked: args.untracked });
  if (args.json) process.stdout.write(JSON.stringify({ files, findings }) + '\n');
  else {
    for (const f of findings) process.stderr.write(`${f.file}${f.line ? ':' + f.line : ''}  [${f.severity}] ${f.rule}  ${f.preview}\n`);
    process.stderr.write(findings.length ? `\nsecret-scan: ${findings.length} possível(is) segredo(s) em ${files} arquivos. Remova do repositório, ROTACIONE o segredo (ele já pode ter vazado) e, se for falso positivo, veja tools/lib/secret-rules.js.\n` : `secret-scan: nenhum segredo encontrado em ${files} arquivos.\n`);
  }
  return findings.length ? 1 : 0;
}
if (isMain(import.meta.url)) runCli(() => main());
