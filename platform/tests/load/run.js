#!/usr/bin/env node
/* tests/load/run.js — teste de CARGA da plataforma Canteiro: `npm run test:load`.
   O que faz, nesta ordem (tudo de verdade, contra a pilha real):
     1. sobe `tools/dev.js --port 4402 --db canteiro_t_load --admin admin@am.test --reset` (Postgres local + GoTrue falso + API + site) e guarda SÓ o PID dele;
     2. ativa o admin pelo link impresso (verify → password) e cria N usuários pela API (POST /api/admin/invites → token_hash na outbox do GoTrue
        falso → POST /api/auth/verify → POST /api/auth/password), cada um com cookie jar próprio (sessão real);
     3. gera imagens PNG/JPEG reais (sharp) de 200–800 KB e decks de 150–400 KB com 3 imagens já externalizadas (asset:sha256:…);
     4. roda as fases (padrão: 50 usuários × 180 s com os limites por IP como estão; 50 × 180 s com os limites por IP neutralizados —
        todas as sessões saem do mesmo IP 127.0.0.1, como um escritório atrás de NAT; 100 × 60 s para achar o limite), cada sessão com o
        mix de tests/load/scenario.cjs (autosave a cada 3–5 s, 20 % com imagem nova, cópias, comentários, versões, downloads, sondas);
     5. mede por endpoint (req/s, p50/p95/p99, erros por código), Postgres (pg_stat_activity, tamanho antes/depois), arquivos (nº/bytes),
        memória e CPU do processo da API; verifica integridade (último PUT 200 = estado do servidor), vazamento (sondas) e deduplicação;
     6. abre o editor em nuvem 10× com Playwright (até "Salvo") e o editor autônomo publicado (AM-Studio-Editor.html da raiz) em file:// 10× (até AMStudio pronto);
     7. escreve docs/evidencias/carga.md (+ JSON bruto em .tmp/load/) e encerra o dev.js (kill <pid>).
   Opções: --port 4402 --db canteiro_t_load --phases "50x180:keep,50x180:clear,100x60:clear" --pool 30 --browser-n 10 --skip-browser --no-report
   Sai com código 1 se algum critério falhar nas fases de 50 usuários (p95 PUT /content ≤ 800 ms, p95 GET ≤ 300 ms, 0 erros 5xx, 0 perda de dados). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import postgres from 'postgres';
import { contentHash } from '../../src/lib/canonical.js';
import { loadAdminUrl } from './database-url.js';

const require = createRequire(import.meta.url);
const { Client } = require('./client.cjs');
const { Metrics, SystemSampler, round, percentile } = require('./metrics.cjs');
const S = require('./scenario.cjs');
const { buildReport } = require('./report.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..'), REPO = path.resolve(ROOT, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const PORT = Number(args.port || 4402), DB = String(args.db || 'canteiro_t_load');
const BASE = `http://127.0.0.1:${PORT}`, ORIGIN = `http://localhost:${PORT}`;
const PHASES = String(args.phases || '50x180:keep,50x180:clear,100x60:clear').split(',').map((s) => { const m = /^(\d+)x(\d+)(?::(keep|clear))?$/.exec(s.trim()); if (!m) throw new Error('fase inválida: ' + s); return { users: Number(m[1]), seconds: Number(m[2]), mode: m[3] || 'keep' }; });
const USERS = Math.max(...PHASES.map((p) => p.users), 1);
const POOL = Number(args.pool || 30), BROWSER_N = Number(args['browser-n'] || 10);
const POOL_MAX = args['pool-max'] ? Number(args['pool-max']) : null;   // DB_POOL_MAX da API (padrão 5 em src/config.js); dev.js repassa o ambiente
const PASSWORD = 'Carga-Teste-Senha-2026!x';
const OUT = path.join(ROOT, '.tmp', 'load'); fs.mkdirSync(OUT, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OBJECTS_DIR = path.join(ROOT, '.data', 'objects');
const ADMIN_URL = loadAdminUrl(process.env, DB);
if (!/^canteiro_t_[a-z0-9_]+$/.test(DB) || /canteiro_t_(a\d*|b\d*|c)$/.test(DB)) { console.error('banco de carga inválido (use canteiro_t_load):', DB); process.exit(2); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = S.sleep;
const result = { startedAt: new Date().toISOString(), config: { port: PORT, db: DB, phases: PHASES, poolSize: POOL, users: USERS, browserN: BROWSER_N, base: BASE, dbPoolMax: POOL_MAX || 5 }, hardware: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memGb: round(os.totalmem() / 1073741824), node: process.version, platform: `${os.type()} ${os.release()}` } };

/* ───────────── utilidades ───────────── */
function portFree(port) { return new Promise((res) => { const s = net.createConnection({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); res(false); }); s.once('error', () => res(true)); }); }
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); } })); return out; }
function dirStats(dir, sinceMs = 0) {
  const st = { count: 0, bytes: 0, countSince: 0, bytesSince: 0 };
  if (!fs.existsSync(dir)) return st;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) { const s = fs.statSync(p); st.count++; st.bytes += s.size; if (s.mtimeMs >= sinceMs) { st.countSince++; st.bytesSince += s.size; } } } };
  walk(dir); return st;
}
const objectPath = (sha) => path.join(OBJECTS_DIR, 'a', sha.slice(0, 2), sha.slice(2, 4), sha);
const normRoute = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/[0-9a-f]{64}/g, ':sha').replace(/\/versions\/\d+/, '/versions/:no');

/* ───────────── 1. subir a pilha ───────────── */
let child = null, devLogPath = path.join(OUT, `dev-${STAMP}.log`);
async function startStack() {
  if (!(await portFree(PORT))) throw new Error(`porta ${PORT} ocupada — outro processo está usando a minha porta`);
  const logFd = fs.openSync(devLogPath, 'w');
  const t0 = Date.now();
  child = spawn(process.execPath, [path.join(ROOT, 'tools', 'dev.js'), '--port', String(PORT), '--db', DB, '--admin', 'admin@am.test', '--name', 'Admin', '--reset'], { cwd: ROOT, env: { ...process.env, APP_ENV: 'local', ...(POOL_MAX ? { DB_POOL_MAX: String(POOL_MAX) } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  log(`dev.js iniciado (pid ${child.pid}) → log em ${path.relative(ROOT, devLogPath)}`);
  const info = { fakeUrl: null, tokenHash: null, ready: false, exited: null };
  let buf = '';
  const onData = (d) => {
    fs.writeSync(logFd, d);
    buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const m = /(http:\/\/127\.0\.0\.1:\d+)\/__outbox/.exec(line); if (m) info.fakeUrl = m[1];
      const t = /token_hash=([0-9a-f]+)/.exec(line); if (t) info.tokenHash = t[1];
      if (line.includes('✔ Pronto')) info.ready = true;
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('exit', (code, sig) => { info.exited = { code, sig }; });
  const deadline = Date.now() + 180_000;
  while (!(info.ready && info.fakeUrl && info.tokenHash)) {
    if (info.exited) throw new Error(`dev.js terminou antes de ficar pronto (${JSON.stringify(info.exited)}) — veja ${devLogPath}`);
    if (Date.now() > deadline) throw new Error('dev.js não ficou pronto em 180 s');
    await sleep(250);
  }
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch { } await sleep(200); }
  result.stack = { pid: child.pid, fakeUrl: info.fakeUrl, startMs: Date.now() - t0 };
  log(`pilha pronta em ${Date.now() - t0} ms · GoTrue falso ${info.fakeUrl}`);
  return info;
}
async function stopStack() {
  if (!child || child.exitCode !== null) return;
  const pid = child.pid;
  log(`encerrando dev.js (kill ${pid})`);
  child.kill('SIGTERM');
  const t = Date.now(); while (child.exitCode === null && child.signalCode === null && Date.now() - t < 10_000) await sleep(100);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await sleep(300); }
}

/* ───────────── 2. usuários ───────────── */
const setupMetrics = new Metrics();
async function activateAdmin(info) {
  const admin = new Client({ base: BASE, origin: ORIGIN, name: 'admin', metrics: setupMetrics });
  await admin.ensureCsrf();
  const v = await admin.post('/api/auth/verify', { tokenHash: info.tokenHash, type: 'invite' }, { record: false });
  if (v.status !== 200) throw new Error(`verify do admin → ${v.status} ${v.text}`);
  const p = await admin.post('/api/auth/password', { password: PASSWORD }, { record: false });
  if (p.status !== 200) throw new Error(`password do admin → ${p.status} ${p.text}`);
  admin.user = { id: p.json.user.id, email: 'admin@am.test', name: 'Admin', role: 'admin' };
  return admin;
}
async function createUsers(admin, info, sql, n) {
  const t0 = Date.now();
  const list = Array.from({ length: n }, (_, i) => ({ i: i + 1, email: `carga${String(i + 1).padStart(3, '0')}@am.test`, name: `Usuário ${String(i + 1).padStart(3, '0')}` }));
  let invites429 = 0;
  const users = await pool(list, 4, async (u) => {
    let inv;
    // POST /api/admin/invites é limitado a 60 por hora POR ADMIN (balde admin_invite, src/routes/admin.js) — para criar >60 contas zera-se o balde (só ele)
    await sql`delete from app.rate_limits where bucket = 'admin_invite'`;
    for (let k = 0; k < 20; k++) { inv = await admin.post('/api/admin/invites', { email: u.email, displayName: u.name }, { record: false }); if (inv.status !== 429) break; invites429++; await sleep(1500); }
    if (inv.status !== 201) throw new Error(`convite ${u.email} → ${inv.status} ${inv.text.slice(0, 200)}`);
    const box = await (await fetch(`${info.fakeUrl}/__outbox?to=${encodeURIComponent(u.email)}`)).json();
    const mail = (box.items || []).filter((m) => m.type === 'invite').pop();
    if (!mail) throw new Error('convite sem e-mail na outbox: ' + u.email);
    const c = new Client({ base: BASE, origin: ORIGIN, name: u.email, metrics: setupMetrics });
    await c.ensureCsrf();
    // POST /api/auth/verify é limitado a 5 por 15 min POR IP (docs/auth-e-sessoes.md); todas as sessões saem de 127.0.0.1 → zera o balde (só o do verify) antes de cada ativação
    await sql`delete from app.rate_limits where bucket = 'verify_ip'`;
    const v = await c.post('/api/auth/verify', { tokenHash: mail.token_hash, type: 'invite' }, { record: false });
    if (v.status !== 200) throw new Error(`verify ${u.email} → ${v.status} ${v.text.slice(0, 200)}`);
    const p = await c.post('/api/auth/password', { password: PASSWORD }, { record: false });
    if (p.status !== 200 || p.json.user.status !== 'active') throw new Error(`password ${u.email} → ${p.status} ${p.text.slice(0, 200)}`);
    c.user = { id: p.json.user.id, email: u.email, name: u.name, role: 'member' };
    return c;
  });
  result.setup = { users: users.length, ms: Date.now() - t0, invites429 };
  log(`${users.length} usuários criados e ativados em ${Date.now() - t0} ms (convites, verify, senha)`);
  return users;
}

/* ───────────── 3. medições do banco/arquivos ───────────── */
async function dbSnapshot(sql) {
  const [{ bytes }] = await sql`select pg_database_size(current_database())::bigint as bytes`;
  const tables = await sql`select relname, pg_total_relation_size('app.' || quote_ident(relname))::bigint as bytes, n_live_tup::int as live, n_dead_tup::int as dead from pg_stat_user_tables where schemaname = 'app' order by 2 desc`;
  const [{ conns }] = await sql`select count(*)::int as conns from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`;
  const [{ max_connections }] = await sql`show max_connections`;
  return { bytes: Number(bytes), tables: tables.map((t) => ({ table: t.relname, bytes: Number(t.bytes), live: t.live, dead: t.dead })), connections: conns, maxConnections: Number(max_connections) };
}

/* ───────────── 4. log do servidor (latência medida pela própria API) ───────────── */
function parseServerLog(file, phases) {
  const out = { total: 0, e5xx: 0, e5xxSamples: [], errors: [], byPhase: [] };
  const per = phases.map(() => new Map());
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.msg !== 'http') { if (j.level === 'error' && out.errors.length < 30) out.errors.push(line.slice(0, 300)); continue; }
    out.total++;
    const at = Date.parse(j.t);
    if (j.status >= 500) { out.e5xx++; if (out.e5xxSamples.length < 10) out.e5xxSamples.push(line.slice(0, 300)); }
    phases.forEach((ph, i) => {
      if (at < ph.t0 || at > ph.t1) return;
      const key = `${j.method} ${normRoute(j.route)}`;
      let e = per[i].get(key); if (!e) { e = { n: 0, ms: [], e5xx: 0, e429: 0 }; per[i].set(key, e); }
      e.n++; e.ms.push(j.ms); if (j.status >= 500) e.e5xx++; if (j.status === 429) e.e429++;
    });
  }
  out.byPhase = per.map((m) => [...m.entries()].map(([key, e]) => { const s = e.ms.sort((a, b) => a - b); return { key, n: e.n, p50: round(percentile(s, 50)), p95: round(percentile(s, 95)), p99: round(percentile(s, 99)), max: round(s[s.length - 1]), e5xx: e.e5xx, e429: e.e429 }; }).sort((a, b) => a.key.localeCompare(b.key)));
  return out;
}

/* ───────────── 5. uma fase ───────────── */
async function runPhase(ph, idx, users, images, world, sql, pid) {
  const name = `${ph.users} usuários × ${ph.seconds} s (${ph.mode === 'clear' ? 'limites por IP neutralizados' : 'limites por IP como estão'})`;
  log(`— fase ${idx + 1}: ${name}`);
  const metrics = new Metrics();
  const part = users.slice(0, ph.users);
  world.presentations = []; world.copies = [];
  const rnd = S.prng(42 + idx);
  const vus = part.map((c, i) => new VirtualUserCtor({ client: c, user: c.user, idx: i, world, images, contentHash, seed: 1000 * (idx + 1) + i, deckBytes: Math.round((150 + rnd() * 250) * 1024) }));
  for (const c of part) c.metrics = setupMetrics;
  let clearTimer = null, cleared = 0;
  // a preparação (N × POST de 150–400 KB + checks das imagens compartilhadas) sai do mesmo IP e herdaria o balde cheio da fase anterior: zera antes (em todos os modos)
  await sql`delete from app.rate_limits where bucket like '%:ip'`;
  if (ph.mode === 'clear') clearTimer = setInterval(() => { sql`delete from app.rate_limits where bucket like '%:ip'`.then((r) => { cleared += r.count; }).catch(() => {}); }, 2000);
  const tSetup = Date.now();
  await pool(vus, 8, (v) => v.setup());
  const deckBytes = vus.map((v) => JSON.stringify(v.deck).length);
  log(`  ${vus.length} apresentações criadas em ${Date.now() - tSetup} ms (decks de ${round(Math.min(...deckBytes) / 1024)}–${round(Math.max(...deckBytes) / 1024)} KB, ${images.shared.length} imagens compartilhadas cada)`);
  // a rajada de preparação (N × POST + checks) não faz parte da fase: zera os baldes por IP UMA vez para a fase começar com a janela limpa (em todos os modos)
  await sql`delete from app.rate_limits where bucket like '%:ip'`;
  for (const c of part) c.metrics = metrics;
  const sampler = new SystemSampler({ sql, dbName: DB, pid, everyMs: 2000 });
  await sampler.start();
  const before = await dbSnapshot(sql);
  metrics.start();
  const t0 = Date.now(); const until = t0 + ph.seconds * 1000;
  const progress = setInterval(() => { const s = metrics.summary(); log(`  … ${Math.round((Date.now() - t0) / 1000)} s · ${s.total} req · ${s.rps} req/s · p95 ${s.p95} ms · pg ${sampler.samples.at(-1)?.pg?.total ?? '?'} conexões`); }, 30_000);
  await Promise.all(vus.map((v) => v.run(until)));
  metrics.stop(); clearInterval(progress); if (clearTimer) clearInterval(clearTimer);
  await sleep(1500); await sampler.sampleOnce(); sampler.stop();
  const after = await dbSnapshot(sql);
  log(`  fase terminou: ${metrics.summary().total} requisições · verificando integridade…`);
  const integrity = await pool(vus, 8, (v) => v.verify(sql));
  const stats = {}; for (const v of vus) for (const [k, val] of Object.entries(v.stats)) { if (typeof val === 'number') stats[k] = (stats[k] || 0) + val; else if (k === 'actions') for (const [a, n] of Object.entries(val)) stats['act_' + a] = (stats['act_' + a] || 0) + n; }
  stats.put429 = stats.put429 || 0;
  const leaks = vus.flatMap((v) => v.stats.leaks.map((l) => `${v.user.email}: ${l}`));
  const anomalies = vus.flatMap((v) => v.stats.anomalies.map((l) => `${v.user.email}: ${l}`));
  const netErrors = part.flatMap((c) => c.errors);
  const summary = metrics.summary();
  const putRow = summary.rows.find((r) => r.key === 'PUT /api/presentations/:id/content');
  const getOk = metrics.timeline.filter((t) => t[1].startsWith('GET ') && t[3] >= 200 && t[3] < 400).map((t) => t[2]).sort((a, b) => a - b);
  const e5xx = summary.rows.reduce((a, r) => a + r.classes['5xx'], 0);
  const criteria = {
    applies: ph.users === 50,
    putP95: putRow ? putRow.p95ok : null, putP95Ok: !!putRow && putRow.p95ok != null && putRow.p95ok <= 800,
    getP95: round(percentile(getOk, 95)), getP95Ok: getOk.length > 0 && percentile(getOk, 95) <= 300,
    e5xx, e5xxOk: e5xx === 0,
    dataOk: integrity.every((i) => i.ok) && stats.staleAccepted === 0 && leaks.length === 0 && (stats.downloadBad || 0) === 0,
  };
  criteria.pass = criteria.putP95Ok && criteria.getP95Ok && criteria.e5xxOk && criteria.dataOk;
  const sys = sampler.summary();
  log(`  PUT p95 ${criteria.putP95} ms · GET p95 ${criteria.getP95} ms · 5xx ${e5xx} · 429 ${summary.rows.reduce((a, r) => a + r.classes['429'], 0)} · integridade ${integrity.filter((i) => i.ok).length}/${integrity.length} · vazamentos ${leaks.length} · pg máx ${sys.pg && sys.pg.maxTotal} conexões · RSS máx ${sys.rssMaxMb} MB · CPU média ${sys.cpuAvgPct}%`);
  return { name, users: ph.users, seconds: ph.seconds, mode: ph.mode, t0, t1: Date.now(), autosaveRejectedPct: stats.cycles ? round(100 * stats.put429 / stats.cycles) : 0, deckBytes: { min: Math.min(...deckBytes), max: Math.max(...deckBytes), avg: Math.round(deckBytes.reduce((a, b) => a + b, 0) / deckBytes.length) }, summary, windows: metrics.windows(10), system: sys, samples: sampler.samples, stats, integrity: { ok: integrity.filter((i) => i.ok).length, total: integrity.length, problems: integrity.filter((i) => !i.ok) }, leaks, anomalies: anomalies.slice(0, 60), anomaliesTotal: anomalies.length, netErrors: netErrors.slice(0, 20), criteria, db: { before, after, growthBytes: after.bytes - before.bytes }, copies: world.copies.length, ipBucketsCleared: cleared };
}
const VirtualUserCtor = S.VirtualUser;

/* ───────────── 6. deduplicação e armazenamento ───────────── */
async function dedupCheck(sql, images, world, runStartMs) {
  const shared = images.shared.map((i) => i.sha), poolShas = images.pool.map((i) => i.sha);
  const sharedRows = await sql`select a.sha256, a.status, a.size_bytes::bigint as size, (select count(*)::int from app.asset_uploads u where u.sha256 = a.sha256) as owners from app.assets a where a.sha256 = any(${shared}::text[])`;
  const poolRows = await sql`select a.sha256, (select count(*)::int from app.asset_uploads u where u.sha256 = a.sha256) as owners from app.assets a where a.sha256 = any(${poolShas}::text[])`;
  const [tot] = await sql`select count(*)::int as n, coalesce(sum(size_bytes), 0)::bigint as bytes, count(*) filter (where status <> 'ready')::int as not_ready from app.assets`;
  const [upl] = await sql`select count(*)::int as n from app.asset_uploads`;
  const [au] = await sql`select count(*) filter (where action = 'asset.upload')::int as uploads, count(*) filter (where action = 'asset.upload' and (meta->>'deduplicated')::boolean)::int as dedup, count(*) filter (where action = 'asset.reject')::int as rejects from app.audit_log`;
  const files = dirStats(OBJECTS_DIR, runStartMs);
  const sharedFiles = shared.map((sha) => ({ sha, exists: fs.existsSync(objectPath(sha)), size: fs.existsSync(objectPath(sha)) ? fs.statSync(objectPath(sha)).size : null }));
  return {
    shared: sharedRows.map((r) => ({ sha: r.sha256.slice(0, 12), status: r.status, size: Number(r.size), owners: r.owners, objects: sharedFiles.find((f) => f.sha === r.sha256)?.exists ? 1 : 0, sizeOnDisk: sharedFiles.find((f) => f.sha === r.sha256)?.size })),
    sharedRowsInDb: sharedRows.length, sharedExpected: shared.length,
    pool: { images: poolShas.length, rowsInDb: poolRows.length, totalOwners: poolRows.reduce((a, r) => a + r.owners, 0), maxOwners: poolRows.length ? Math.max(...poolRows.map((r) => r.owners)) : 0 },
    assets: { rows: tot.n, bytes: Number(tot.bytes), notReady: tot.not_ready }, uploadsRows: upl.n, audit: { uploads: au.uploads, deduplicated: au.dedup, rejects: au.rejects },
    objects: files,
  };
}

/* ───────────── 7. navegador ───────────── */
async function browserPhase(users, images, world, sql) {
  const u0 = users[0];
  const s = await u0.get('/api/auth/session', { record: false });
  if (!s.json || !s.json.authenticated) throw new Error('sessão do usuário 1 inválida para o Playwright');
  const deck = S.makeDeck({ title: 'Referência de abertura — 3 imagens', sharedShas: images.shared.map((i) => i.sha), targetBytes: 250 * 1024, seed: 777 });
  const r = await u0.post('/api/presentations', { title: deck.title, content: deck }, { record: false });
  if (r.status !== 201) throw new Error('não criei a apresentação de referência: ' + r.status);
  const heavy = world.presentations.find((p) => p.ownerId === u0.user.id);
  const [hv] = heavy ? await sql`select slide_count, octet_length(content::text)::int as bytes, (select count(*)::int from app.asset_refs r where r.presentation_id = p.id and r.version_no = 0) as assets from app.presentations p where id = ${heavy.id}::uuid` : [null];
  const resultFile = path.join(OUT, `editor-open-${STAMP}.json`);
  const env = { ...process.env, NODE_PATH: '/opt/node22/lib/node_modules', LOAD_BASE: ORIGIN, LOAD_COOKIES: JSON.stringify(u0.exportCookies('localhost')), LOAD_PRES: r.json.id, LOAD_HEAVY: heavy ? heavy.id : '', LOAD_ORIGINAL: path.join(REPO, 'AM-Studio-Editor.html'), LOAD_N: String(BROWSER_N), LOAD_FONTS: path.join(REPO, 'fonts2'), LOAD_OUT: OUT, LOAD_RESULT: resultFile };
  const t0 = Date.now();
  await new Promise((res, rej) => { const p = spawn(process.execPath, [path.join(HERE, 'editor-open.cjs')], { env, stdio: ['ignore', 'inherit', 'inherit'] }); p.on('exit', (c) => (c === 0 ? res() : rej(new Error('editor-open.cjs saiu com ' + c)))); });
  const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const stat = (arr, f) => { const v = arr.filter((x) => x.ok).map(f).filter((x) => x != null).sort((a, b) => a - b); return v.length ? { n: v.length, min: round(v[0]), p50: round(percentile(v, 50)), max: round(v[v.length - 1]), mean: round(v.reduce((a, b) => a + b, 0) / v.length) } : null; };
  const ref = { id: r.json.id, slides: deck.slides.length, bytes: JSON.stringify(deck).length, images: images.shared.length, imageBytes: images.shared.reduce((a, i) => a + i.size, 0) };
  return { ms: Date.now() - t0, chromium: data.chromium, reference: ref, heavy: heavy ? { id: heavy.id, slides: hv?.slide_count, bytes: hv?.bytes, assets: hv?.assets } : null, raw: data,
    cloud: { studio: stat(data.cloud, (x) => x.studioMs), saved: stat(data.cloud, (x) => x.savedMs), load: stat(data.cloud, (x) => x.load), transferMb: stat(data.cloud, (x) => x.transferBytes / 1048576), ok: data.cloud.filter((x) => x.ok).length, n: data.cloud.length, errors: data.cloud.flatMap((x) => x.errors || []).slice(0, 5), csp: data.cloud.flatMap((x) => x.csp || []).slice(0, 5), assetRefsLeft: data.cloud.map((x) => x.assetRefsLeft) },
    heavyOpen: { saved: stat(data.heavy, (x) => x.savedMs), studio: stat(data.heavy, (x) => x.studioMs), transferMb: stat(data.heavy, (x) => x.transferBytes / 1048576), ok: data.heavy.filter((x) => x.ok).length, n: data.heavy.length },
    original: { studio: stat(data.original, (x) => x.studioMs), load: stat(data.original, (x) => x.loadMs), transferMb: stat(data.original, (x) => x.transferBytes / 1048576), ok: data.original.filter((x) => x.ok).length, n: data.original.length, cover: data.original[0]?.cover, errors: data.original.flatMap((x) => x.errors || []).slice(0, 5) } };
}

/* ───────────── principal ───────────── */
let sql = null;
async function main() {
  const runStart = Date.now();
  const info = await startStack();
  sql = postgres(ADMIN_URL, { max: 2, onnotice: () => {} });
  const [{ version }] = await sql`select version()`; result.hardware.postgres = version.split(' on ')[0];
  result.baseline = { db: await dbSnapshot(sql), objects: dirStats(OBJECTS_DIR) };
  const admin = await activateAdmin(info);
  const users = await createUsers(admin, info, sql, USERS);
  log('gerando imagens (sharp)…');
  const tImg = Date.now();
  const images = await S.makeImages({ poolSize: POOL, rnd: S.prng(7) });
  const world = { presentations: [], copies: [], privateShas: [], sizes: new Map() };
  for (const im of [...images.shared, ...images.pool]) world.sizes.set(im.sha, im.size);
  // imagem privada por usuário (nunca referenciada): alvo das sondas "arquivo alheio → 404"
  await pool(users, 8, async (c, i) => { const im = await S.privateImage(); const r = await c.request('PUT', `/api/assets/${im.sha}`, { body: im.buf, headers: { 'Content-Type': im.mime, 'X-Asset-Kind': 'image' }, record: false }); if (r.status !== 201 && r.status !== 200) throw new Error(`imagem privada ${i} → ${r.status} ${r.text.slice(0, 120)}`); world.privateShas.push({ sha: im.sha, ownerId: c.user.id }); world.sizes.set(im.sha, im.size); });
  result.images = { ms: Date.now() - tImg, shared: images.shared.map((i) => ({ sha: i.sha.slice(0, 12), size: i.size, mime: i.mime })), pool: { n: images.pool.length, minKb: round(Math.min(...images.pool.map((i) => i.size)) / 1024), maxKb: round(Math.max(...images.pool.map((i) => i.size)) / 1024), totalMb: round(images.pool.reduce((a, i) => a + i.size, 0) / 1048576, 1), jpeg: images.pool.filter((i) => i.mime === 'image/jpeg').length }, privatePerUser: 1 };
  log(`${images.shared.length} imagens compartilhadas + ${images.pool.length} do conjunto (${result.images.pool.minKb}–${result.images.pool.maxKb} KB) em ${Date.now() - tImg} ms`);

  result.phases = [];
  for (let i = 0; i < PHASES.length; i++) {
    result.phases.push(await runPhase(PHASES[i], i, users, images, world, sql, child.pid));
    if (i < PHASES.length - 1) await sleep(5000);
  }
  // Sonda dos limites por IP das rotas de sessão (fora das fases, com sessões reais): POST /api/auth/refresh é 30/min POR IP (src/routes/auth.js) —
  // num escritório atrás de NAT, as sessões cujo access token expira no mesmo minuto renovam juntas; a 31ª recebe 429 e o cliente web manda para /entrar.
  {
    const probe = users.slice(0, Math.min(users.length, 40));
    const t0 = Date.now();
    const rs = await pool(probe, 8, (c) => c.post('/api/auth/refresh', {}, { record: false }));
    const by = {}; for (const r of rs) by[r.status] = (by[r.status] || 0) + 1;
    result.refreshProbe = { sessions: probe.length, ms: Date.now() - t0, statuses: by, firstRetryAfterS: rs.find((r) => r.status === 429)?.json?.error?.details?.retryAfterS ?? null };
    log(`sonda refresh (${probe.length} sessões no mesmo IP em ${Date.now() - t0} ms): ${JSON.stringify(by)}`);
    await sql`delete from app.rate_limits where bucket = 'refresh_ip'`;
  }
  result.after = { db: await dbSnapshot(sql), objects: dirStats(OBJECTS_DIR, runStart) };
  result.images.generated = { n: images.generated.length, totalMb: round(images.generated.reduce((a, i) => a + i.size, 0) / 1048576, 1) };
  result.dedup = await dedupCheck(sql, images, world, runStart);
  const [vc] = await sql`select count(*)::int as versions from app.presentation_versions`; const [pc] = await sql`select count(*)::int as n from app.presentations`; const [cc] = await sql`select count(*)::int as n from app.comments`; const [al] = await sql`select count(*)::int as n from app.audit_log`; const [rl] = await sql`select count(*)::int as n from app.rate_limits`;
  result.after.counts = { presentations: pc.n, versions: vc.versions, comments: cc.n, audit: al.n, rateLimitRows: rl.n };
  log(`banco: ${round(result.baseline.db.bytes / 1048576)} → ${round(result.after.db.bytes / 1048576)} MB · objetos criados nesta execução: ${result.after.objects.countSince} (${round(result.after.objects.bytesSince / 1048576)} MB)`);

  if (!args['skip-browser']) {
    log('Playwright: abrindo o editor em nuvem e o autônomo publicado…');
    try { result.browser = await browserPhase(users, images, world, sql); log(`  nuvem: até "Salvo" p50 ${result.browser.cloud.saved?.p50} ms (${result.browser.cloud.ok}/${result.browser.cloud.n}) · autônomo: AMStudio pronto p50 ${result.browser.original.studio?.p50} ms (${result.browser.original.ok}/${result.browser.original.n})`); }
    catch (e) { result.browser = { error: String(e.message) }; log('  Playwright falhou: ' + e.message); }
  }
  result.serverLog = parseServerLog(devLogPath, result.phases);
  result.finishedAt = new Date().toISOString(); result.totalMs = Date.now() - runStart;
  const jsonPath = path.join(OUT, `resultado-${STAMP}.json`);
  const slim = { ...result, phases: result.phases.map((p) => ({ ...p, samples: p.samples.length })) , browser: result.browser && result.browser.raw ? { ...result.browser, raw: undefined } : result.browser };
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 1));
  log('JSON bruto: ' + path.relative(ROOT, jsonPath));
  if (!args['no-report']) { const md = buildReport(slim, { jsonPath: path.relative(ROOT, jsonPath), devLog: path.relative(ROOT, devLogPath) }); const mdPath = path.join(ROOT, 'docs', 'evidencias', 'carga.md'); fs.mkdirSync(path.dirname(mdPath), { recursive: true }); fs.writeFileSync(mdPath, md); log('relatório: ' + path.relative(ROOT, mdPath)); }
  const failed = result.phases.filter((p) => p.criteria.applies && !p.criteria.pass);
  log(failed.length ? `CRITÉRIOS NÃO ATENDIDOS em ${failed.length} fase(s) de 50 usuários` : 'critérios atendidos nas fases de 50 usuários');
  return failed.length ? 1 : 0;
}

/** --report-only <resultado.json> [--experiments a.json,b.json]: regenera docs/evidencias/carga.md a partir de resultados já gravados (sem subir nada). */
function reportOnly() {
  const main = JSON.parse(fs.readFileSync(path.resolve(ROOT, String(args['report-only'])), 'utf8'));
  const experiments = String(args.experiments || '').split(',').map((s) => s.trim()).filter(Boolean).map((f) => {
    const r = JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
    return r.phases.map((p) => ({ file: f, dbPoolMax: r.config.dbPoolMax || 5, users: p.users, seconds: p.seconds, mode: p.mode, summary: p.summary, system: p.system, criteria: p.criteria, integrity: p.integrity, leaks: p.leaks, stats: p.stats }));
  }).flat();
  const slim = { ...main, phases: main.phases.map((p) => ({ ...p, samples: Array.isArray(p.samples) ? p.samples.length : p.samples })), browser: main.browser && main.browser.raw ? { ...main.browser, raw: undefined } : main.browser };
  const jsonRel = path.relative(ROOT, path.resolve(ROOT, String(args['report-only'])));
  const md = buildReport(slim, { jsonPath: jsonRel, devLog: jsonRel.replace(/resultado-/, 'dev-').replace(/\.json$/, '.log'), experiments });
  const mdPath = path.join(ROOT, 'docs', 'evidencias', 'carga.md');
  fs.writeFileSync(mdPath, md);
  log(`relatório regenerado: ${path.relative(ROOT, mdPath)} (${experiments.length} fase(s) de experimento anexadas)`);
}

let code = 1;
if (args['report-only']) { try { reportOnly(); code = 0; } catch (e) { console.error('ERRO:', e && e.stack || e); } process.exit(code); }
process.on('SIGINT', async () => { await stopStack(); process.exit(130); });
try { code = await main(); }
catch (e) { console.error('ERRO:', e && e.stack || e); code = 1; }
finally { try { if (sql) await sql.end({ timeout: 3 }); } catch { } await stopStack(); }
process.exit(code);
