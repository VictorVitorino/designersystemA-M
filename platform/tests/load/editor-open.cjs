/* tests/load/editor-open.cjs — mede o tempo de abertura do editor em nuvem (/editor/<id> até a pílula "Salvo" e o conteúdo pronto)
   e do editor autônomo publicado (AM-Studio-Editor.html da raiz) em file:// (até AMStudio pronto), em Chromium real (Playwright), N aberturas "frias" (contexto novo a cada vez).
   Roda como processo filho de run.js (NODE_PATH aponta para o Playwright global). Entrada por variáveis de ambiente:
     LOAD_BASE  (http://localhost:4402)   LOAD_COOKIES (JSON do context.addCookies)   LOAD_PRES (id da apresentação de referência)
     LOAD_HEAVY (id de uma apresentação com muitas imagens, opcional)   LOAD_ORIGINAL (caminho do editor autônomo: AM-Studio-Editor.html da raiz)   LOAD_N (10)
     LOAD_FONTS (pasta com gf.css e .woff2)   LOAD_OUT (pasta para capturas)   LOAD_RESULT (arquivo JSON de saída)
   Instantes medidos DENTRO da página com performance.now() (origem = início da navegação); precisão ≈ 1 quadro (16 ms) por ser sondagem por rAF. */
'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.LOAD_BASE, COOKIES = JSON.parse(process.env.LOAD_COOKIES || '[]'), PRES = process.env.LOAD_PRES, HEAVY = process.env.LOAD_HEAVY || '';
const ORIGINAL = process.env.LOAD_ORIGINAL, N = Number(process.env.LOAD_N || 10), FONTS = process.env.LOAD_FONTS, OUT = process.env.LOAD_OUT, RESULT = process.env.LOAD_RESULT;
const ACAO = { 'access-control-allow-origin': '*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function routeFonts(ctx) {
  if (!FONTS || !fs.existsSync(path.join(FONTS, 'gf.css'))) return false;
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', headers: ACAO, body: fs.readFileSync(path.join(FONTS, 'gf.css'), 'utf8') }));
  await ctx.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', headers: ACAO, body: fs.readFileSync(f) }) : r.abort(); });
  return true;
}
const navTiming = (p) => p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const res = performance.getEntriesByType('resource'); return { responseEnd: n && n.responseEnd, domContentLoaded: n && n.domContentLoadedEventEnd, load: n && n.loadEventEnd, transferBytes: (n ? n.transferSize || 0 : 0) + res.reduce((a, r) => a + (r.transferSize || 0), 0), resources: res.length, apiCalls: res.filter((r) => r.name.includes('/api/')).length, assetCalls: res.filter((r) => r.name.includes('/api/assets/')).length }; });

async function openCloud(browser, id, tag, shot) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(COOKIES); await routeFonts(ctx);
  const p = await ctx.newPage();
  const errs = [], csp = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load|bluetooth/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.addInitScript(() => { addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + (e.blockedURI || '')); }); });
  const t0 = Date.now();
  const r = { tag, id, ok: false };
  try {
    await p.goto(BASE + '/editor/' + id, { waitUntil: 'commit', timeout: 60000 });
    await p.waitForFunction(() => window.AMStudio && window.AMStudio.deck, null, { timeout: 60000, polling: 'raf' });
    r.studioMs = await p.evaluate(() => performance.now());
    await p.waitForFunction(() => window.AMCloud && window.AMCloud.status === 'saved' && !document.getElementById('cloudLoad') && document.querySelector('#thumbs .th'), null, { timeout: 60000, polling: 'raf' });
    r.savedMs = await p.evaluate(() => performance.now());
    r.wallMs = Date.now() - t0;
    r.pill = await p.evaluate(() => { const e = document.getElementById('cloudPill'); return e ? { state: e.dataset.state, text: e.title } : null; });
    r.slides = await p.evaluate(() => AMStudio.deck.slides.length);
    r.images = await p.evaluate(() => AMStudio.deck.slides.reduce((a, s) => a + s.els.filter((e) => e.type === 'image' && /^data:/.test(e.src || '')).length, 0));
    r.assetRefsLeft = await p.evaluate(() => JSON.stringify(AMStudio.deck).split('asset:sha256:').length - 1);
    Object.assign(r, await navTiming(p));
    r.csp = await p.evaluate(() => (window.__csp || []).slice(0, 5));
    r.errors = errs.slice(0, 5);
    r.ok = true;
    if (shot) { await sleep(300); await p.screenshot({ path: shot }); }
  } catch (e) { r.error = String(e.message).slice(0, 300); r.errors = errs.slice(0, 5); }
  await ctx.close();
  return r;
}

async function openOriginal(browser, file, tag, shot) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await routeFonts(ctx);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  const t0 = Date.now();
  const r = { tag, ok: false };
  try {
    await p.goto('file://' + file, { waitUntil: 'commit', timeout: 60000 });
    await p.waitForFunction(() => window.AMStudio && window.AMStudio.deck && document.querySelector('#thumbs .th'), null, { timeout: 60000, polling: 'raf' });
    r.studioMs = await p.evaluate(() => performance.now());
    await p.waitForFunction(() => document.readyState === 'complete', null, { timeout: 60000 });
    r.loadMs = await p.evaluate(() => performance.now());
    r.wallMs = Date.now() - t0;
    r.cover = await p.evaluate(() => { const c = document.getElementById('cover'); return c ? { open: window.AMCover ? AMCover.isOpen() : null, display: getComputedStyle(c).display } : null; });
    r.slides = await p.evaluate(() => AMStudio.deck.slides.length);
    Object.assign(r, await navTiming(p));
    r.errors = errs.slice(0, 5);
    r.ok = true;
    if (shot) { await sleep(300); await p.screenshot({ path: shot }); }
  } catch (e) { r.error = String(e.message).slice(0, 300); r.errors = errs.slice(0, 5); }
  await ctx.close();
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const out = { chromium: browser.version(), cloud: [], heavy: [], original: [] };
  for (let i = 0; i < N; i++) out.cloud.push(await openCloud(browser, PRES, 'nuvem#' + (i + 1), i === 0 && OUT ? path.join(OUT, 'editor-nuvem-salvo.png') : null));
  if (HEAVY) for (let i = 0; i < 3; i++) out.heavy.push(await openCloud(browser, HEAVY, 'nuvem-pesada#' + (i + 1), null));
  if (ORIGINAL && fs.existsSync(ORIGINAL)) for (let i = 0; i < N; i++) out.original.push(await openOriginal(browser, ORIGINAL, 'original#' + (i + 1), i === 0 && OUT ? path.join(OUT, 'editor-original.png') : null));
  await browser.close();
  fs.writeFileSync(RESULT, JSON.stringify(out, null, 1));
  console.log('editor-open: ok', out.cloud.filter((x) => x.ok).length, 'nuvem,', out.original.filter((x) => x.ok).length, 'original');
})().catch((e) => { console.error('editor-open falhou:', e); fs.writeFileSync(RESULT, JSON.stringify({ error: String(e.message) })); process.exit(1); });
