/* tests/e2e/helpers.cjs — apoio aos cenários ponta a ponta contra a PILHA REAL (tools/dev.js: Postgres + GoTrue falso + API + site).
   Carregado por tests/e2e/scenarios.cjs (que o run.js executa depois de subir o dev.js). Nada aqui toca o servidor por atalhos
   de teste: tudo passa pelo navegador (Playwright/Chromium) ou pela API pública com cookies + CSRF, como um cliente real faria.

   Variáveis de ambiente (preenchidas pelo run.js): E2E_BASE (http://localhost:4401), E2E_FAKE (GoTrue falso: /__outbox),
   E2E_INVITE_LINK (link do convite do admin impresso pelo dev.js), E2E_SHOTS (pasta das capturas), E2E_TMP (rascunhos). */
'use strict';
process.env.NODE_PATH = '/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PLATFORM = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(PLATFORM, '..');
const BASE = process.env.E2E_BASE || 'http://localhost:4401';
const FAKE = process.env.E2E_FAKE || '';
const FONTS = process.env.AM_FONTS_DIR || path.join(REPO, 'fonts2');
const SHOTS = process.env.E2E_SHOTS || path.join(PLATFORM, 'tests', 'screens');
const TMP = process.env.E2E_TMP || path.join(PLATFORM, '.tmp', 'e2e');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }

/* ------------------------------------------------------------------ resultados */
const R = { checks: [], scenarios: [], passed: 0, failed: 0, notes: [], cspViolations: [], consoleErrors: [], pageErrors: [], hosts: new Set() };
let currentScenario = null;
function check(name, ok, info) {
  const line = { scenario: currentScenario && currentScenario.id, name, ok: !!ok, info: ok ? undefined : safeInfo(info) };
  R.checks.push(line); if (ok) R.passed++; else R.failed++;
  if (currentScenario) (ok ? currentScenario.pass++ : currentScenario.fail++);
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (ok || info === undefined ? '' : '  ' + JSON.stringify(line.info).slice(0, 900)));
  return !!ok;
}
function note(text) { R.notes.push({ scenario: currentScenario && currentScenario.id, text }); console.log('  NOTA ' + text); }
function safeInfo(v) { try { return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 400 ? x.slice(0, 400) + '…' : x))); } catch (e) { return String(v); } }
const ONLY = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
async function scenario(id, title, fn) {
  if (ONLY && !ONLY.includes(String(id))) { console.log('· ' + id + ' ' + title + ' (pulado por E2E_ONLY)'); return; }
  const sc = { id, title, pass: 0, fail: 0, ms: 0, shots: [], error: null };
  currentScenario = sc; R.scenarios.push(sc);
  console.log('\n▶ ' + id + ' · ' + title);
  const t0 = Date.now();
  try { await fn(sc); } catch (e) { sc.error = String(e && e.stack || e).slice(0, 1500); check(id + ' [exceção no cenário]', false, sc.error.slice(0, 600)); }
  sc.ms = Date.now() - t0; currentScenario = null;
  console.log('  ' + id + ': ' + sc.pass + ' ok · ' + sc.fail + ' falhas · ' + (sc.ms / 1000).toFixed(1) + ' s');
}
async function shot(page, name, opts) {
  const file = 'e2e-' + name + '.png'; await page.screenshot(Object.assign({ path: path.join(SHOTS, file) }, opts || {})).catch((e) => note('captura ' + file + ' falhou: ' + e.message));
  if (currentScenario) currentScenario.shots.push(file); return file;
}

/* ------------------------------------------------------------------ navegador */
let browser = null;
async function launch() { browser = await chromium.launch({ args: ['--disable-lcd-text'] }); return browser; }
async function closeBrowser() { if (browser) await browser.close().catch(() => { }); browser = null; }
const IGNORE_CONSOLE = /net::ERR_|Failed to load resource|Permissions-Policy header: Unrecognized feature/;

/** Contexto novo (cookies zerados) = "outro computador". Observa CSP, console e erros de página de TODAS as abas abertas nele. */
async function newCtx(tag, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }, opts));
  ctx.__tag = tag;
  await ctx.exposeFunction('__cspReport', (v) => { R.cspViolations.push(Object.assign({ ctx: tag }, v)); });
  await ctx.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => { try { window.__cspReport({ d: e.violatedDirective, u: e.blockedURI, s: (e.sample || '').slice(0, 80), at: location.pathname }); } catch (x) { } }, true); });
  // fontes do Google: servidas da pasta local (sem rede), como nos testes do studio; sem o arquivo local, o pedido é abortado (fonte substituta)
  await ctx.route('https://fonts.googleapis.com/**', (r) => { const f = path.join(FONTS, 'gf.css'); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'text/css', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(f, 'utf8') }) : r.abort(); });
  await ctx.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(f) }) : r.abort(); });
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => R.pageErrors.push({ ctx: tag, url: p.url(), msg: String(e && e.message || e).slice(0, 300) }));
    p.on('console', (m) => { if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) R.consoleErrors.push({ ctx: tag, url: p.url(), text: m.text().slice(0, 300) }); });
    p.on('request', (r) => { try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) R.hosts.add(u.host); } catch (e) { } });
  });
  return ctx;
}

/* ------------------------------------------------------------------ API pública com os cookies do contexto (como o site faz) */
async function csrfOf(ctx) {
  let c = (await ctx.cookies(BASE)).find((x) => x.name === 'am_csrf' || x.name === '__Host-am_csrf');
  if (!c) { await ctx.request.get(BASE + '/api/auth/session'); c = (await ctx.cookies(BASE)).find((x) => x.name === 'am_csrf' || x.name === '__Host-am_csrf'); }
  return c ? c.value : '';
}
/** api(ctx, 'PUT', '/api/presentations/<id>/content', { json }) → { status, json, text, headers } — manda X-CSRF-Token + Origin em toda escrita. */
async function api(ctx, method, p, { json, body, headers = {}, csrf = true } = {}) {
  const h = Object.assign({ Accept: 'application/json' }, headers);
  if (!/^(GET|HEAD|OPTIONS)$/.test(method)) { h.Origin = BASE; if (csrf) h['X-CSRF-Token'] = await csrfOf(ctx); }
  const opts = { method, headers: h, maxRedirects: 0, failOnStatusCode: false };
  if (json !== undefined) { opts.data = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) opts.data = body;
  const res = await ctx.request.fetch(BASE + p, opts);
  const text = await res.text(); let parsed; try { parsed = JSON.parse(text); } catch (e) { parsed = undefined; }
  return { status: res.status(), json: parsed, text, headers: res.headers() };
}

/* ------------------------------------------------------------------ e-mails do GoTrue falso */
async function outbox(to) {
  const r = await fetch(FAKE + '/__outbox' + (to ? '?to=' + encodeURIComponent(to) : ''));
  const j = await r.json(); return Array.isArray(j) ? j : (j.items || []);
}
async function inviteLink(email, { afterIndex = -1 } = {}) {
  const items = (await outbox(email)).filter((m) => m.type === 'invite');
  const m = items.slice(afterIndex + 1).pop() || items.pop();
  if (!m) return null;
  return m.link || (m.token_hash ? BASE + '/auth/confirmar?token_hash=' + m.token_hash + '&type=invite' : null);
}

/* ------------------------------------------------------------------ fluxos de interface reutilizados */
/** Abre o link do convite, define a senha pela página /auth/confirmar e espera cair no acervo. */
async function definePassword(ctx, link, password) {
  const p = await ctx.newPage();
  await p.goto(link);
  await p.waitForSelector('#nova-senha', { timeout: 20000 });
  const email = await p.$eval('#conta-email strong', (e) => e.textContent).catch(() => null);
  await p.fill('#nova-senha', password); await p.fill('#confirmar-senha', password);
  await Promise.all([p.waitForURL(/\/acervo/, { timeout: 20000 }), p.click('#btn-definir')]);
  await p.waitForSelector('#btn-nova', { timeout: 20000 });
  return { page: p, email };
}
/** Entra pela página /entrar (e-mail + senha). Devolve a aba já no destino. */
async function login(ctx, email, password, { next } = {}) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/entrar' + (next ? '?next=' + encodeURIComponent(next) : ''));
  // quem já tem sessão ativa neste contexto é mandado direto ao destino pela própria página /entrar
  await Promise.race([p.waitForSelector('#btn-entrar', { timeout: 20000 }), p.waitForURL((u) => !/\/entrar/.test(u.pathname), { timeout: 20000 })]);
  if (!/\/entrar/.test(new URL(p.url()).pathname)) { await p.waitForLoadState('domcontentloaded'); return p; }
  await p.fill('#email', email); await p.fill('#senha', password);
  await Promise.all([p.waitForURL((u) => !/\/entrar/.test(u.pathname), { timeout: 20000 }), p.click('#btn-entrar')]);
  return p;
}
async function logoutViaUi(page) {
  await page.goto(BASE + '/acervo'); await page.waitForSelector('#btn-sair', { timeout: 20000 });
  await Promise.all([page.waitForURL(/\/entrar/, { timeout: 20000 }), page.click('#btn-sair')]);
}

/* editor em nuvem */
const EDITOR_READY = () => window.AMCloud && (AMCloud.status === 'saved' || document.documentElement.classList.contains('am-cloud-view')) && !document.getElementById('cloudLoad');
async function openEditor(ctx, id, { mode = 'editor', wait = true, timeout = 40000 } = {}) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/' + mode + '/' + id);
  if (wait) await p.waitForFunction(EDITOR_READY, null, { timeout });
  return p;
}
const waitEditor = (p, timeout = 40000) => p.waitForFunction(EDITOR_READY, null, { timeout });
const waitSaved = (p, ms = 20000) => p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved' && !AMCloud.dirty && !AMCloud.inflight, null, { timeout: ms });
const pillState = (p) => p.evaluate(() => document.getElementById('cloudPill') && document.getElementById('cloudPill').dataset.state);
const pillTexts = (p) => p.evaluate(() => { const el = document.getElementById('cloudPill'); return el ? [...el.querySelectorAll('.cl-t')].map((x) => x.textContent) : null; });
const deckOf = (p) => p.evaluate(() => JSON.parse(JSON.stringify(AMStudio.deck)));
const textsOf = (d) => (d.slides || []).flatMap((s) => (s.els || []).filter((e) => e.type === 'text').map((e) => String(e.html || '').replace(/<[^>]+>/g, '')));
/** Inserir › Texto › Título, digitar e sair do campo (o texto só entra no deck ao sair). */
async function typeNewText(p, text) { await p.click('[data-menu=mText]'); await p.click('[data-text=title]'); await sleep(250); await p.keyboard.type(text); await p.keyboard.press('Escape'); await sleep(300); }
async function insertImage(p, file) { await p.click('[data-add=image]'); await p.setInputFiles('#fImg', file); await sleep(600); }

/* ------------------------------------------------------------------ PNG gerado em código (sem dependências) */
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
/** PNG RGB w×h com um padrão determinístico (seed) — bytes diferentes para seeds diferentes. */
function makePng(w, h, seed = 1) {
  const raw = Buffer.alloc((w * 3 + 1) * h); let s = seed >>> 0;
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = ((s >>> 24) & 0x7f) + ((x + y) & 1 ? 0 : 64); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

module.exports = { BASE, FAKE, FONTS, SHOTS, TMP, PLATFORM, REPO, R, sleep, until, check, note, scenario, shot, launch, closeBrowser, newCtx, api, csrfOf, outbox, inviteLink, definePassword, login, logoutViaUi, openEditor, waitEditor, waitSaved, pillState, pillTexts, deckOf, textsOf, typeNewText, insertImage, makePng, sha256 };
