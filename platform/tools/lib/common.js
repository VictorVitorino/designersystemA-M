/* tools/lib/common.js — utilidades compartilhadas pelas ferramentas de operação (backup, restauração, manutenção…).
   Regras: nenhuma função aqui imprime segredo; tudo que vai para log/erro passa por `redact()`. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/** Erro "esperado" (configuração, uso, verificação falhou): a mensagem já é para a pessoa de TI ler. */
export class ToolError extends Error {
  constructor(message, { code = 'tool_error', exit = 1, details } = {}) { super(message); this.name = 'ToolError'; this.code = code; this.exit = exit; this.details = details; }
}

const SENSITIVE_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_KEY|PRIVATE|ENCRYPTION_KEY|SERVICE_ROLE|DSN|DATABASE_[A-Z_]*URL|_URL_WITH|COOKIE)/i;

/** Cria uma função que remove segredos de qualquer texto: senhas em URLs, JWTs, chaves AWS e o VALOR de variáveis de ambiente sensíveis. */
export function buildRedactor(env = process.env, extra = []) {
  const values = new Set(extra.filter((v) => typeof v === 'string' && v.length >= 6));
  for (const [k, v] of Object.entries(env)) if (v && v.length >= 8 && SENSITIVE_NAME.test(k)) { values.add(v); try { const u = new URL(v); if (u.password) values.add(decodeURIComponent(u.password)); } catch { /* não é URL */ } }
  const list = [...values].sort((a, b) => b.length - a.length);
  return (input) => {
    let s = String(input ?? '');
    for (const v of list) if (s.includes(v)) s = s.split(v).join('***');
    s = s.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):([^\s@/]+)@/gi, '$1:***@');
    s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'eyJ***.***.***');
    s = s.replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '$1****************');
    s = s.replace(/\b(gh[pousr]_|github_pat_|xox[abprs]-|sk_live_|sbp_|sb_secret_)[A-Za-z0-9_-]{8,}/g, '$1***');
    return s;
  };
}

/** Log estruturado (uma linha JSON por evento em --json, texto legível caso contrário). Sempre redigido. */
export function makeLogger({ json = false, redact = buildRedactor(), out = process.stderr, quiet = false } = {}) {
  const emit = (level, msg, fields) => {
    if (quiet && level === 'info') return;
    const text = redact(msg);
    if (json) out.write(JSON.stringify({ t: new Date().toISOString(), level, msg: text, ...(fields ? JSON.parse(redact(JSON.stringify(fields))) : {}) }) + '\n');
    else out.write(`${level === 'info' ? '' : level.toUpperCase() + ': '}${text}\n`);
  };
  return { info: (m, f) => emit('info', m, f), warn: (m, f) => emit('warn', m, f), error: (m, f) => emit('error', m, f), redact };
}

/** Argumentos simples: --chave=valor, --chave valor, --flag, e posicionais. `spec.bool` lista as chaves booleanas. */
export function parseArgs(argv, { bool = [], alias = {} } = {}) {
  const out = { _: [] }; const isBool = new Set(bool);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let [k, v] = a.slice(2).split(/=(.*)/s, 2); k = alias[k] || k;
    if (k.startsWith('no-') && isBool.has(k.slice(3))) { out[k.slice(3)] = false; continue; }
    if (isBool.has(k)) { out[k] = v === undefined ? true : !['0', 'false', 'no'].includes(v); continue; }
    if (v === undefined) { v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new ToolError(`a opção --${k} precisa de um valor`, { exit: 2, code: 'usage' }); i++; }
    out[k] = v;
  }
  return out;
}

export const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export async function sha256File(file) { const h = crypto.createHash('sha256'); await pipeline(fs.createReadStream(file), h); return h.digest('hex'); }

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? 2 : 1)} ${u[i]}`;
}
export function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000; if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60); return `${m} min ${Math.round(s - m * 60)} s`;
}

/** 20260115T051500Z */
export const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
export function parseUtcStamp(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s); if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** JSON canônico (chaves ordenadas, sem espaços): base do MAC do manifesto. */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

/** Executa tarefas assíncronas com no máximo `n` simultâneas; devolve na ordem de entrada. */
export async function mapLimit(items, n, fn) {
  const results = new Array(items.length); let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers); return results;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Executa o `main` de uma ferramenta tratando ToolError (mensagem limpa, código de saída) e erros inesperados (sem stack em produção). */
export function runCli(main, { redact = buildRedactor() } = {}) {
  main().then((code) => process.exit(typeof code === 'number' ? code : 0)).catch((e) => {
    if (e instanceof ToolError) { process.stderr.write(`ERRO: ${redact(e.message)}\n`); process.exit(e.exit); }
    process.stderr.write(`ERRO inesperado: ${redact(e?.stack || e?.message || e)}\n`); process.exit(1);
  });
}

/** `import.meta.url` é o script principal? */
export function isMain(metaUrl) { try { return !!process.argv[1] && fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(process.argv[1]); } catch { return false; } }
