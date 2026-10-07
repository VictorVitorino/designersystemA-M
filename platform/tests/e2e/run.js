#!/usr/bin/env node
/* tests/e2e/run.js — ponta a ponta com a PILHA REAL: `npm run test:e2e`.
   1. Sobe `tools/dev.js --port 4401 --db canteiro_t_e2e --admin admin@am.test --name Admin --reset` (Postgres local + GoTrue falso + API + site),
      guardando o PID; com E2E_BUILD=1 acrescenta --build (reconstrói dist/public).
   2. Espera GET /api/ready responder 200 (até 120 s) e lê do terminal do dev.js a URL do GoTrue falso e o link do convite do admin.
   3. Roda tests/e2e/scenarios.cjs (Playwright/Chromium) com E2E_BASE, E2E_FAKE, E2E_INVITE_LINK, E2E_RESULTS.
   4. Encerra SÓ o dev.js que iniciou (SIGTERM → SIGKILL), inclusive em falha, Ctrl+C ou exceção, e sai com o código dos cenários.
   Variáveis: E2E_PORT (4401), E2E_DB (canteiro_t_e2e), E2E_ONLY=1,2 (subconjunto, só para depurar), E2E_KEEP=1 (não derruba o dev.js ao final). */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), PLATFORM = path.resolve(HERE, '..', '..');
const PORT = Number(process.env.E2E_PORT || 4401), DB = process.env.E2E_DB || 'canteiro_t_e2e', BASE = `http://localhost:${PORT}`;
const TMP = path.join(PLATFORM, '.tmp', 'e2e'); fs.mkdirSync(TMP, { recursive: true });
const LOG = path.join(TMP, 'dev.log'), RESULTS = path.join(TMP, 'results.json');
if (!/^canteiro_t_[a-z0-9_]+$/.test(DB)) { console.error('E2E_DB precisa ser canteiro_t_<nome> (banco exclusivo dos testes).'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function portFree() { try { await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(1500) }); return false; } catch (e) { return true; } }
if (!(await portFree())) { console.error(`Já existe algo respondendo em ${BASE}. Encerre-o (ou use E2E_PORT=outra) antes de rodar o E2E.`); process.exit(2); }

/* 1. dev.js */
const devArgs = ['tools/dev.js', '--port', String(PORT), '--db', DB, '--admin', 'admin@am.test', '--name', 'Admin', '--reset'];
if (process.env.E2E_BUILD === '1') devArgs.push('--build');
console.log('▶ subindo a pilha: node ' + devArgs.join(' '));
const logFd = fs.openSync(LOG, 'w');
const dev = spawn(process.execPath, devArgs, { cwd: PLATFORM, env: { ...process.env, APP_ENV: 'local', LOG_LEVEL: process.env.LOG_LEVEL || 'info' }, stdio: ['ignore', 'pipe', 'pipe'] });
fs.writeFileSync(path.join(TMP, 'dev.pid'), String(dev.pid));
let devOut = '', devExited = null;
dev.stdout.on('data', (d) => { devOut += d; fs.writeSync(logFd, d); });
dev.stderr.on('data', (d) => { devOut += d; fs.writeSync(logFd, d); });
dev.on('exit', (code, sig) => { devExited = { code, sig }; });

let stopping = false;
async function stopDev() {
  if (stopping || devExited || process.env.E2E_KEEP === '1') return; stopping = true;
  try { process.kill(dev.pid, 'SIGTERM'); } catch (e) { }
  const t0 = Date.now(); while (!devExited && Date.now() - t0 < 6000) await sleep(100);
  if (!devExited) { try { process.kill(dev.pid, 'SIGKILL'); } catch (e) { } }
  console.log('■ dev.js (pid ' + dev.pid + ') encerrado' + (devExited ? ' (' + (devExited.code ?? devExited.sig) + ')' : ''));
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { await stopDev(); process.exit(130); });
process.on('uncaughtException', async (e) => { console.error(e); await stopDev(); process.exit(2); });

/* 2. pronto? */
const t0 = Date.now(); let ready = false;
while (Date.now() - t0 < 120000) {
  if (devExited) break;
  try { const r = await fetch(BASE + '/api/ready', { signal: AbortSignal.timeout(2000) }); if (r.status === 200) { const j = await r.json(); if (j.db && j.auth && j.migrations) { ready = true; break; } } } catch (e) { }
  await sleep(500);
}
const fake = (devOut.match(/(http:\/\/127\.0\.0\.1:\d+)\s+·\s+e-mails/) || [])[1];
const invite = (devOut.match(/http:\/\/localhost:\d+\/auth\/confirmar\?token_hash=[^\s]+/) || [])[0];
if (!ready || !fake || !invite) {
  console.error('A pilha não ficou pronta (ready=' + ready + ', fake=' + !!fake + ', convite=' + !!invite + '). Veja ' + LOG); console.error(devOut.slice(-2000));
  await stopDev(); process.exit(1);
}
console.log(`✔ pilha pronta em ${Math.round((Date.now() - t0) / 1000)} s · API ${BASE} · GoTrue falso ${fake} · convite do admin lido do terminal`);

/* 3. cenários */
const child = spawn(process.execPath, [path.join(HERE, 'scenarios.cjs')], {
  cwd: PLATFORM, stdio: 'inherit',
  env: { ...process.env, E2E_BASE: BASE, E2E_FAKE: fake, E2E_INVITE_LINK: invite, E2E_RESULTS: RESULTS, E2E_TMP: TMP, E2E_SHOTS: path.join(PLATFORM, 'tests', 'screens') },
});
const code = await new Promise((res) => child.on('exit', (c, s) => res(c ?? (s ? 1 : 0))));

/* 4. encerrar */
await stopDev();
try { const r = JSON.parse(fs.readFileSync(RESULTS, 'utf8')); console.log(`\nE2E: PASS ${r.passed} · FAIL ${r.failed} · ${r.scenarios.length} cenários · CSP ${r.csp} · console ${r.consoleErrors.length} · resultados em ${RESULTS}`); } catch (e) { }
process.exit(code);
