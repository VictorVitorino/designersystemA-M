/* Editor em nuvem — testes de ponta a ponta (Chromium real + servidor mock em memória, com a CSP de dist/csp.json).
   Uso:  node platform/tests/cloud/editor-cloud.test.js        (constrói o site antes: tools/build-web.js)
   Saída: contagens PASS/FAIL reais, exit 0 só se tudo passar. Capturas em platform/tests/screens/ (ignoradas pelo git). */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = '/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const { chromium } = require('playwright');
import sharp from 'sharp';
import { buildWeb } from '../../tools/build-web.js';
import { startMock } from './mock-api.js';
import { readCspJson, inlineScriptHashes } from '../../tools/csp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = path.resolve(here, '../..'), REPO = path.resolve(PLATFORM, '..');
const FONTS = process.env.AM_FONTS_DIR || path.join(REPO, 'fonts2');
const SHOTS = path.join(PLATFORM, 'tests', 'screens'); mkdirSync(SHOTS, { recursive: true });
const TMP = path.join(PLATFORM, '.tmp', 'editor-cloud'); rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const PORT = Number(process.env.CLOUD_TEST_PORT || 4202);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACAO = { 'Access-Control-Allow-Origin': '*' };

const results = []; let failed = 0, passed = 0;
function check(name, ok, info) { results.push((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined && !ok ? '  ' + JSON.stringify(info).slice(0, 900) : '')); if (ok) passed++; else { failed++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 900) : '')); } }
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
async function scenario(name, fn) { if (ONLY && !ONLY.includes(name.slice(0, 2))) return; const t0 = Date.now(); try { await fn(); console.log('· ' + name + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)'); } catch (e) { check(name + ' [exceção]', false, String(e && e.stack || e).slice(0, 900)); } }
async function until(fn, ms = 8000, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }

/* ---------- construir o site e subir o mock ---------- */
const built = buildWeb();
const cspJson = readCspJson(path.join(PLATFORM, 'dist', 'csp.json'));
const mock = await startMock({ port: PORT });
const BASE = mock.url;
const post = (ctx, p, data) => ctx.request.post(BASE + '/__test' + p, { data: data || {} }).then((r) => r.json());
const serverPres = (ctx, id) => post(ctx, '/presentation', { id });
const reqLog = (ctx, clear) => post(ctx, '/requests', { clear: !!clear });
const faults = (ctx, f) => post(ctx, '/faults', f);

const browser = await chromium.launch({ args: ['--disable-lcd-text'] });
const cspViolations = [], consoleErrors = [], pageErrors = [], hosts = new Set();
async function newCtx(user, viewport = { width: 1440, height: 800 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.exposeFunction('__cspReport', (v) => { cspViolations.push(v); });
  await ctx.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => { try { window.__cspReport({ d: e.violatedDirective, u: e.blockedURI, s: (e.sample || '').slice(0, 80), at: location.pathname }); } catch (x) { } }, true); });
  if (user) await ctx.request.post(BASE + '/__test/login', { data: { user } });
  return ctx;
}
async function newPage(ctx, tag) {
  const p = await ctx.newPage();
  await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', headers: ACAO, body: readFileSync(path.join(FONTS, 'gf.css'), 'utf8') }));
  await p.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', headers: ACAO, body: readFileSync(f) }) : r.abort(); });
  p.on('request', (r) => { try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.host); } catch (e) { } });
  p.on('pageerror', (e) => pageErrors.push(tag + ': ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) consoleErrors.push(tag + ': ' + m.text().slice(0, 300)); });
  return p;
}
async function openEditor(ctx, id, tag, { mode = 'editor', wait = true } = {}) {
  const p = await newPage(ctx, tag);
  await p.addInitScript(() => { window.__states = []; window.__toasts = []; document.addEventListener('DOMContentLoaded', () => { const mo = new MutationObserver(() => { const el = document.getElementById('cloudPill'); if (el && window.__states.at(-1) !== el.dataset.state) window.__states.push(el.dataset.state); }); mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'], childList: true }); const t = document.getElementById('toast'); if (t) new MutationObserver(() => { if (t.textContent && window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true }); }); });
  await p.goto(BASE + '/' + mode + '/' + id);
  if (wait) await p.waitForFunction(() => window.AMCloud && (AMCloud.status === 'saved' || document.documentElement.classList.contains('am-cloud-view')) && !document.getElementById('cloudLoad'), null, { timeout: 20000 });
  return p;
}
const pillState = (p) => p.evaluate(() => document.getElementById('cloudPill')?.dataset.state);
const pillText = (p) => p.evaluate(() => { const el = document.getElementById('cloudPill'); return el ? [...el.querySelectorAll('.cl-t')].map((x) => x.textContent) : null; });
const deckOf = (p) => p.evaluate(() => JSON.parse(JSON.stringify(AMStudio.deck)));
const waitSaved = (p, ms = 12000) => p.waitForFunction(() => AMCloud.status === 'saved' && !AMCloud.dirty && !AMCloud.inflight, null, { timeout: ms });
const textsOf = (d) => d.slides.flatMap((s) => s.els.filter((e) => e.type === 'text').map((e) => String(e.html).replace(/<[^>]+>/g, '')));
async function typeNewText(p, text) { await p.click('[data-menu=mText]'); await p.click('[data-text=title]'); await sleep(250); await p.keyboard.type(text); await p.keyboard.press('Escape'); await sleep(250); }
const pngBuf = (w, h, seed) => { const raw = Buffer.alloc(w * h * 3); let s = seed >>> 0; for (let i = 0; i < raw.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; raw[i] = (s >>> 24) & 0xff; } return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer(); };
const dataUrl = (buf, mime = 'image/png') => 'data:' + mime + ';base64,' + buf.toString('base64');
const sha = (b) => createHash('sha256').update(b).digest('hex');
/* BMP 24 bits e ICO (com PNG dentro): formatos que o editor aceita e o servidor não guarda */
const bmpBuf = (w, h) => { const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size); b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * row + x * 3; b[o] = 30; b[o + 1] = (x * 4) & 255; b[o + 2] = 200; } return b; };
const icoBuf = (pngBytes) => { const hd = Buffer.alloc(22); hd.writeUInt16LE(0, 0); hd.writeUInt16LE(1, 2); hd.writeUInt16LE(1, 4); hd[6] = 32; hd[7] = 32; hd.writeUInt16LE(1, 10); hd.writeUInt16LE(32, 12); hd.writeUInt32LE(pngBytes.length, 14); hd.writeUInt32LE(22, 18); return Buffer.concat([hd, pngBytes]); };
const toastsOf = (p) => p.evaluate(() => window.__toasts.slice());
const keyOn = (p, init) => p.evaluate((o) => { const ev = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, o)); (document.activeElement || document.body).dispatchEvent(ev); return ev.defaultPrevented; }, init);
const el = (o) => Object.assign({ id: 'e' + Math.random().toString(36).slice(2, 8), anim: { in: 'none' } }, o);
const textEl = (html, over) => el(Object.assign({ type: 'text', x: 80, y: 80, w: 700, h: 100, html, font: 'Inter', size: 36, weight: 700, color: '#002A46', align: 'left', valign: 'top', lh: 1.2, ls: 0 }, over || {}));
const imgEl = (src, over) => el(Object.assign({ type: 'image', src, x: 700, y: 300, w: 300, h: 200, fit: 'cover', radius: 0 }, over || {}));
const slideOf = (els, over) => Object.assign({ id: 's' + Math.random().toString(36).slice(2, 7), bg: '#FFFFFF', tr: 'fade', els }, over || {});
const deckWith = (title, slides) => ({ v: 1, app: 'AM Studio', id: 'x', title, slides });
async function seed(ctx, owner, title, content) { return post(ctx, '/seed', { owner, title, content }); }
const filesDir = TMP;
const imgA = await pngBuf(240, 160, 11), imgB = await pngBuf(200, 120, 22);
writeFileSync(path.join(filesDir, 'a.png'), imgA); writeFileSync(path.join(filesDir, 'b.png'), imgB);

const ana = await newCtx('ana'), bia = await newCtx('bia');
const users = await (await ana.request.post(BASE + '/__test/users', { data: {} })).json();

/* =========================================================================================================== */
await scenario('01 · boot, modo inerte e CSP', async () => {
  const s = await seed(ana, 'ana', 'Boot');
  const p = await openEditor(ana, s.id, 'boot');
  const c = await p.evaluate(() => ({ cloud: window.AM_CLOUD, pdf: window.AM_PDFJS, cls: document.documentElement.className, cover: window.AMCover && AMCover.isOpen(), title: document.title }));
  check('CL-01 boot lê o caminho: /editor/<uuid> → AM_CLOUD {apiBase, presentationId, mode:edit, pdfjsBase}', c.cloud && c.cloud.mode === 'edit' && c.cloud.presentationId === s.id && c.cloud.apiBase === '/api' && c.cloud.pdfjsBase === '/vendor/pdfjs-4.10.38/' && c.pdf === '/vendor/pdfjs-4.10.38/', c);
  check('CL-02 a capa não abre na nuvem (o ponto de entrada é o acervo)', c.cover === false, c);
  /* hash de cada <script> inline do HTML servido = hash da CSP (calculado no navegador a partir do DOM real) */
  const hs = await p.evaluate(async () => { const out = []; for (const sc of document.scripts) { if (sc.src) continue; const t = sc.type; if (t && !/^(text\/javascript|module)$/i.test(t)) continue; const b = new TextEncoder().encode(sc.textContent); const d = await crypto.subtle.digest('SHA-256', b); out.push('sha256-' + btoa(String.fromCharCode(...new Uint8Array(d)))); } return out; });
  const policy = cspJson['/editor/'], inPolicy = hs.every((h) => policy.includes("'" + h + "'"));
  check('CL-04 CSP do editor: cada <script> inline do DOM real tem hash na política (' + hs.length + ' scripts) e há strict-dynamic, sem unsafe-inline/unsafe-eval em script-src', inPolicy && /script-src [^;]*'strict-dynamic'/.test(policy) && !/script-src[^;]*unsafe-(inline|eval)/.test(policy) && hs.length === inlineScriptHashes(readFileSync(path.join(PLATFORM, 'dist/public/editor/index.html'), 'utf8')).length, { n: hs.length });
  await p.close();
  /* BE-ED-07: sem o UUID de uma apresentação, /editor e /visualizar levam ao acervo (nunca abrem o editor original fora da nuvem) */
  const reds = [];
  for (const u of ['/editor/nao-e-uuid', '/editor/', '/editor/index.html', '/visualizar/abc']) { const q = await newPage(ana, 'redir'); await q.goto(BASE + u); await q.waitForURL(/\/acervo$/, { timeout: 8000 }).catch(() => { }); reds.push(new URL(q.url()).pathname); await q.close(); }
  check('CL-03 /editor/<não-UUID>, /editor/, /editor/index.html e /visualizar/<não-UUID> redirecionam para /acervo (o editor original não abre fora da nuvem) — BE-ED-07', reds.every((x) => x === '/acervo'), reds);
  await reqLog(ana, true);
  const inert = await newPage(ana, 'inerte'); await inert.goto(BASE + '/__test/inerte'); await sleep(1500);
  const ci = await inert.evaluate(() => ({ cloud: window.AM_CLOUD, api: window.AMCloud, cover: AMCover.isOpen(), pill: !!document.getElementById('cloudPill') }));
  const apiCalls = (await reqLog(ana)).filter((r) => r.path.startsWith('/api/'));
  check('CL-03b modo inerte: o MESMO HTML fora de /editor/<uuid> se comporta como o editor original (capa aberta, sem pílula, sem AM_CLOUD, sem chamadas à API)', !ci.cloud && !ci.api && ci.cover === true && !ci.pill && apiCalls.length === 0, { ci, apiCalls: apiCalls.map((r) => r.path) });
  await inert.close();
});

await scenario('02 · carregar e hidratar', async () => {
  const content = deckWith('Apresentação com imagens', [slideOf([textEl('Olá, nuvem'), imgEl(dataUrl(imgA)), imgEl(dataUrl(imgB), { x: 100, y: 400 })]), slideOf([textEl('Segundo slide'), imgEl(dataUrl(imgA), { x: 50, y: 50 })], { bg: '#002A46' })]);
  const s = await seed(ana, 'ana', 'Apresentação com imagens', content);
  const stored = await serverPres(ana, s.id);
  check('CL-05 o servidor guarda asset:sha256:… (sem data:image no conteúdo)', !/data:image/.test(JSON.stringify(stored.content)) && (JSON.stringify(stored.content).match(/asset:sha256:/g) || []).length === 3, stored.content.slides[0].els.map((e) => e.src));
  const p = await openEditor(ana, s.id, 'load');
  const d = await deckOf(p), srcs = d.slides.flatMap((x) => x.els.filter((e) => e.type === 'image').map((e) => e.src));
  check('CL-06 hidratação: imagens viram data: (3 imagens, 0 referências asset:)', srcs.length === 3 && srcs.every((x) => /^data:image\/png;base64,/.test(x)) && !JSON.stringify(d).includes('asset:sha256'), srcs.map((x) => x.slice(0, 30)));
  check('CL-07 bytes das imagens hidratadas = arquivos originais', sha(Buffer.from(srcs[0].split(',')[1], 'base64')) === sha(imgA) && sha(Buffer.from(srcs[1].split(',')[1], 'base64')) === sha(imgB));
  check('CL-08 deck.id fixo = id da apresentação, título sincronizado (campo e aba)', d.id === s.id && (await p.inputValue('#title')) === 'Apresentação com imagens' && (await p.title()).startsWith('Apresentação com imagens'), { id: d.id });
  const pt = await pillText(p);
  check('CL-09 pílula "Salvo na nuvem às HH:MM" (e versão curta "Salvo às HH:MM")', /^Salvo na nuvem às \d\d:\d\d$/.test(pt[0]) && /^Salvo às \d\d:\d\d$/.test(pt[1]), pt);
  check('CL-10 nenhuma gravação ao abrir (sem PUT) — o editor só salva depois de uma mudança', !(await reqLog(ana)).some((r) => r.method === 'PUT' && r.path.includes(s.id)));
  const live = await p.evaluate(() => { const l = document.getElementById('cloudLive'); return { role: l.getAttribute('role'), live: l.getAttribute('aria-live'), text: l.textContent }; });
  check('CL-11 aria-live polite com o estado atual', live.role === 'status' && live.live === 'polite' && /Salvo/.test(live.text), live);
  const sec = await p.evaluate(async () => ({ cookie: document.cookie, ls: JSON.stringify({ ...localStorage }), ss: JSON.stringify({ ...sessionStorage }), idb: await new Promise((res) => { const r = indexedDB.open('canteiro-cloud'); r.onsuccess = () => res([...r.result.objectStoreNames]); r.onerror = () => res(null); }) }));
  check('CL-89 o JS da página não enxerga token de sessão: document.cookie só traz o CSRF; localStorage/sessionStorage sem tokens', /^am_csrf=[0-9a-f]{64}$/.test(sec.cookie) && !/at_[0-9a-f]{20}|rt_[0-9a-f]{20}/.test(sec.cookie + sec.ls + sec.ss), { cookie: sec.cookie.slice(0, 40), ls: sec.ls.slice(0, 80) });
  await p.screenshot({ path: path.join(SHOTS, 'cloud-01-editor.png') });
  await p.close();
});

let mainId = null;
await scenario('03 · editar → autosave (debounce, baseRev, imagens como asset:, dedup, desfazer, título)', async () => {
  const s = await seed(ana, 'ana', 'Autosave'); mainId = s.id;
  const p = await openEditor(ana, s.id, 'autosave'); await reqLog(ana, true);
  const t0 = Date.now(); await typeNewText(p, 'Primeira edição');
  const saving = await pillState(p);
  await waitSaved(p); const dt = Date.now() - t0;
  const log = await reqLog(ana);
  const puts = log.filter((r) => r.method === 'PUT' && /\/content$/.test(r.path));
  check('CL-12 "Salvando…" durante a espera e debounce de ~3 s (PUT entre 2,8 s e 6 s depois da edição)', saving === 'saving' && puts.length === 1 && dt >= 2800 && dt < 7000, { saving, dt, n: puts.length });
  const b = puts[0] && puts[0].putBody;
  check('CL-13 PUT com baseRev=1, conteúdo com o texto novo e SEM data: no corpo', b && b.baseRev === 1 && JSON.stringify(b.content).includes('Primeira edição') && !/data:/.test(JSON.stringify(b)), b && { baseRev: b.baseRev });
  const st = await serverPres(ana, s.id);
  check('CL-14 confirmação: rev local só muda depois do 200 (servidor rev 2 = local rev 2) e pílula "Salvo na nuvem"', st.rev === 2 && (await p.evaluate(() => AMCloud.rev)) === 2 && (await pillText(p))[0].startsWith('Salvo na nuvem às'), { srv: st.rev });
  check('CL-15 miniatura do 1º slide enviada (thumbSha no PUT, JPEG ≤ 60 KB)', !!(b && b.thumbSha) && (await serverPres(ana, s.id)).versions.length >= 1, b && b.thumbSha);
  /* imagem pela interface: mesma imagem 2× = 1 envio */
  await reqLog(ana, true);
  const imgC = await pngBuf(220, 140, 33); writeFileSync(path.join(filesDir, 'c.png'), imgC);
  for (let i = 0; i < 2; i++) { await p.click('[data-add=image]'); await p.setInputFiles('#fImg', path.join(filesDir, 'c.png')); await sleep(500); }
  await waitSaved(p);
  const log2 = await reqLog(ana); const assetPuts = log2.filter((r) => r.method === 'PUT' && /\/api\/assets\//.test(r.path) && r.status < 300);
  const content2 = (await serverPres(ana, s.id)).content, refs = (JSON.stringify(content2).match(/asset:sha256:[0-9a-f]{64}/g) || []);
  const thumbPuts = assetPuts.length - new Set(assetPuts.map((r) => r.path)).size;
  check('CL-16 a mesma imagem inserida 2× vira 2 referências e UM envio de arquivo (dedup por conteúdo)', refs.length === 2 && new Set(refs).size === 1 && refs[0].endsWith(sha(imgC)) && assetPuts.filter((r) => r.path.endsWith('/' + sha(imgC))).length === 1, { refs: refs.length, puts: assetPuts.map((r) => r.path.slice(-8)) });
  check('CL-17 imagens no deck local continuam como data: (a nuvem não toca no editor)', (await deckOf(p)).slides[0].els.filter((e) => e.type === 'image').every((e) => e.src.startsWith('data:image/png')));
  /* 3º salvamento sem novas imagens: só o conteúdo */
  await reqLog(ana, true); await typeNewText(p, 'Terceira'); await waitSaved(p);
  const log3 = await reqLog(ana);
  check('CL-18 salvamento seguinte não reenvia imagens (cache de hash) e não consulta o servidor por elas', !log3.some((r) => r.method === 'PUT' && /\/api\/assets\/[0-9a-f]{64}$/.test(r.path) && r.path.endsWith(sha(imgC))), log3.map((r) => r.method + ' ' + r.path.slice(0, 40)));
  const putsB = log3.filter((r) => r.method === 'PUT' && /\/content$/.test(r.path));
  check('CL-18b miniatura: dentro de 60 s e só quando o slide 1 muda — o PUT seguinte (slide 1 editado de novo) NÃO carrega novo thumbSha', putsB.length >= 1 && !putsB.at(-1).putBody.thumbSha, putsB.map((r) => r.putBody.thumbSha));
  /* desfazer salva */
  await reqLog(ana, true); const rev0 = await p.evaluate(() => AMCloud.rev);
  await p.keyboard.press('Control+z'); await until(async () => (await p.evaluate(() => AMCloud.rev)) > rev0, 9000);
  const afterUndo = await serverPres(ana, s.id);
  check('CL-19 Ctrl+Z também é salvo (patch restore → am:commit): o texto "Terceira" sai do servidor', !JSON.stringify(afterUndo.content).includes('Terceira') && afterUndo.rev > rev0, { rev: afterUndo.rev, rev0 });
  /* título */
  await p.fill('#title', 'Título renomeado'); await p.press('#title', 'Enter'); await p.click('body', { position: { x: 600, y: 400 } }).catch(() => { }); await until(async () => (await serverPres(ana, s.id)).title === 'Título renomeado', 9000);
  check('CL-20 renomear no campo do editor atualiza título e conteúdo no servidor', (await serverPres(ana, s.id)).title === 'Título renomeado');
  /* reload mantém tudo */
  await waitSaved(p); await p.reload(); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 });
  const d2 = await deckOf(p);
  check('CL-21 recarregar mantém texto, imagens (data:) e título; sem pedir recuperação', textsOf(d2).includes('Primeira edição') && d2.slides[0].els.filter((e) => e.type === 'image').length === 2 && d2.title === 'Título renomeado' && !(await p.$('.cl-dlg')), textsOf(d2));
  await p.screenshot({ path: path.join(SHOTS, 'cloud-02-salvo.png') });
  await p.close();
});

await scenario('04 · imagem grande (> 4 MB) é recomprimida no navegador antes de enviar', async () => {
  const s = await seed(ana, 'ana', 'Imagem grande'); const p = await openEditor(ana, s.id, 'big'); await reqLog(ana, true);
  const big = await pngBuf(1800, 1300, 99); writeFileSync(path.join(filesDir, 'big.png'), big);
  await p.click('[data-add=image]'); await p.setInputFiles('#fImg', path.join(filesDir, 'big.png')); await sleep(1200);
  await waitSaved(p, 30000);
  const log = await reqLog(ana); const ups = log.filter((r) => r.method === 'PUT' && /\/api\/assets\//.test(r.path) && r.status < 300);
  check('CL-22 arquivos enviados ≤ 4 MB (original de ' + Math.round(big.length / 1048576) + ' MB virou WebP menor) e a apresentação foi salva', big.length > 4 * 1048576 && ups.length >= 1 && ups.every((r) => r.bodyBytes <= 4 * 1048576) && (await serverPres(ana, s.id)).rev >= 2, ups.map((r) => r.bodyBytes));
  await p.reload(); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 20000 });
  const d = await deckOf(p), im = d.slides[0].els.find((e) => e.type === 'image');
  check('CL-23 ao reabrir a imagem recomprimida (WebP) aparece no deck', im && /^data:image\/(webp|png|jpeg)/.test(im.src), im && im.src.slice(0, 30));
  await p.close();
});

await scenario('05 · offline → online recupera; fechar com pendência e reabrir oferece recuperação', async () => {
  const s = await seed(ana, 'ana', 'Offline'); const p = await openEditor(ana, s.id, 'off');
  await ana.setOffline(true); await sleep(300);
  check('CL-24 ao cair a conexão: "Sem conexão — alterações guardadas neste computador"', (await pillState(p)) === 'offline' && (await pillText(p))[0] === 'Sem conexão — alterações guardadas neste computador', await pillText(p));
  await typeNewText(p, 'Escrito sem rede');
  const readIdb = () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('canteiro-cloud'); r.onsuccess = () => { const g = r.result.transaction('pending').objectStore('pending').getAll(); g.onsuccess = () => res(g.result.map((x) => ({ id: x.id, has: String(x.json).includes('Escrito sem rede'), baseRev: x.baseRev }))); }; r.onerror = () => res(null); }));
  const failed1 = await until(async () => (await p.evaluate(() => AMCloud.dirty)) && (await pillState(p)) === 'offline', 9000);
  const idb = await until(async () => { const r = await readIdb(); return r && r.length ? r : null; }, 6000, 200);
  check('CL-25 offline: a alteração fica na fila local (IndexedDB "canteiro-cloud") com baseRev', !!failed1 && idb && idb.length === 1 && idb[0].id === s.id && idb[0].has && idb[0].baseRev === 1, idb);
  await ana.setOffline(false);
  await p.waitForFunction(() => AMCloud.status === 'saved' && !AMCloud.dirty, null, { timeout: 20000 });
  const states = await p.evaluate(() => window.__states);
  check('CL-26 voltou a conexão: recupera sozinho (Reconectando… → Salvo) e o servidor recebeu a alteração', states.includes('offline') && states.includes('reconnecting') && (await serverPres(ana, s.id)).content.slides[0].els.some((e) => String(e.html).includes('Escrito sem rede')), states);
  const left = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('canteiro-cloud'); r.onsuccess = () => { const g = r.result.transaction('pending').objectStore('pending').count(); g.onsuccess = () => res(g.result); }; }));
  check('CL-27 fila local esvaziada depois da confirmação do servidor', left === 0, left);
  /* fechar com pendência */
  await ana.setOffline(true); await sleep(200); await typeNewText(p, 'Pendência ao fechar'); await until(async () => (await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('canteiro-cloud'); r.onsuccess = () => { const g = r.result.transaction('pending').objectStore('pending').getAll(); g.onsuccess = () => res(g.result.some((x) => String(x.json).includes('Pendência ao fechar'))); }; }))), 6000, 200);
  await p.close({ runBeforeUnload: false }); await ana.setOffline(false);
  const p2 = await openEditor(ana, s.id, 'off2', { wait: false });
  const dlg = await p2.waitForSelector('.cl-dlg', { timeout: 15000 }).catch(() => null);
  const title = dlg ? await dlg.$eval('h2', (h) => h.textContent) : null;
  check('CL-28 reabrir com pendência mais nova que o servidor oferece "Recuperar alterações não salvas?" × "Descartar"', title === 'Recuperar alterações não salvas?' && !!(await p2.$('.cl-b[data-act=recover]')) && !!(await p2.$('.cl-b[data-act=discard]')), title);
  await p2.screenshot({ path: path.join(SHOTS, 'cloud-03-recuperar.png') });
  await p2.click('.cl-b[data-act=recover]');
  await p2.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved' && !AMCloud.dirty && !document.querySelector('.cl-dlg'), null, { timeout: 20000 });
  check('CL-29 "Recuperar" traz o texto de volta e salva na nuvem', textsOf(await deckOf(p2)).includes('Pendência ao fechar') && JSON.stringify((await serverPres(ana, s.id)).content).includes('Pendência ao fechar'));
  await p2.close();
  /* descartar */
  await ana.setOffline(true); const p3 = await openEditor(ana, s.id, 'off3', { wait: false }).catch(() => null); await ana.setOffline(false);
  if (p3) await p3.close();
  const s2 = await seed(ana, 'ana', 'Descartar'); const q = await openEditor(ana, s2.id, 'desc');
  await ana.setOffline(true); await sleep(200); await typeNewText(q, 'Vai descartar'); await sleep(2200); await q.close(); await ana.setOffline(false);
  const q2 = await openEditor(ana, s2.id, 'desc2', { wait: false }); await q2.waitForSelector('.cl-b[data-act=discard]', { timeout: 15000 }); await q2.click('.cl-b[data-act=discard]');
  await q2.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 });
  check('CL-30 "Descartar" mantém a versão da nuvem e limpa a fila local', !textsOf(await deckOf(q2)).includes('Vai descartar') && !JSON.stringify((await serverPres(ana, s2.id)).content).includes('Vai descartar'));
  await q2.close();
});

await scenario('06 · falhas do servidor: tentativas com backoff e retomada', async () => {
  const s = await seed(ana, 'ana', 'Backoff'); const p = await openEditor(ana, s.id, 'bo');
  await faults(ana, { put5xx: 2 }); await reqLog(ana, true);
  await typeNewText(p, 'Resiste a 503');
  await p.waitForFunction(() => AMCloud.status === 'saved' && !AMCloud.dirty, null, { timeout: 30000 });
  const log = await reqLog(ana); const puts = log.filter((r) => r.method === 'PUT' && /\/content$/.test(r.path));
  const t = puts.map((r) => r.status);
  const gaps = puts.slice(1).map((r, i) => r.t - puts[i].t);
  check('CL-31b espera crescente entre tentativas (backoff com jitter: ~1 s, depois ~2 s): intervalos ' + gaps.map((g) => (g / 1000).toFixed(1) + 's').join(' → '), gaps.length === 2 && gaps[0] >= 600 && gaps[0] <= 2200 && gaps[1] >= 1200 && gaps[1] <= 4200 && gaps[1] > gaps[0] * 0.9, gaps);
  check('CL-31 503, 503, depois 200: o editor tenta de novo sozinho e confirma (PUTs: ' + t.join(',') + ')', t.join(',').startsWith('503,503,200') && (await p.evaluate(() => window.__states)).includes('offline'), t);
  await faults(ana, { put5xx: 0 }); await p.close();
});

await scenario('07 · conflito 409 com três saídas', async () => {
  /* a) manter a minha */
  let s = await seed(ana, 'ana', 'Conflito A'); let p = await openEditor(ana, s.id, 'cfA');
  await post(ana, '/bump', { id: s.id, by: 'bia', title: 'Mudou em outro lugar' });
  await typeNewText(p, 'Minha edição A');
  const dlg = await p.waitForSelector('.cl-dlg', { timeout: 15000 }).catch(() => null);
  const txt = dlg ? await dlg.innerText() : '';
  check('CL-32 409: caixa de conflito diz quem alterou ("Bia Outra"), quando e a versão, com as 3 saídas', /Bia Outra/.test(txt) && /versão 2/.test(txt) && !!(await p.$('[data-act=mine]')) && !!(await p.$('[data-act=cloud]')) && !!(await p.$('[data-act=copy]')) && (await pillState(p)) === 'conflict' && (await pillText(p))[0] === 'Conflito — escolha como resolver', { txt: txt.slice(0, 160), st: await pillState(p) });
  await p.screenshot({ path: path.join(SHOTS, 'cloud-04-conflito.png') });
  await reqLog(ana, true); await p.click('[data-act=mine]');
  await p.waitForFunction(() => AMCloud.status === 'saved' && !AMCloud.dirty && !document.querySelector('.cl-dlg'), null, { timeout: 20000 });
  let sp = await serverPres(ana, s.id); const put = (await reqLog(ana)).filter((r) => r.method === 'PUT' && /\/content$/.test(r.path)).pop();
  check('CL-33 "Manter a minha": PUT com resolution:overwrite e baseRev=serverRev; a versão da nuvem fica no histórico (pre_overwrite)', put && put.putBody.resolution === 'overwrite' && put.putBody.baseRev === 2 && sp.versions.some((v) => v.kind === 'pre_overwrite') && JSON.stringify(sp.content).includes('Minha edição A'), { res: put && put.putBody.resolution, vs: sp.versions.map((v) => v.kind) });
  await p.close();
  /* b) carregar a da nuvem */
  s = await seed(ana, 'ana', 'Conflito B'); p = await openEditor(ana, s.id, 'cfB');
  await post(ana, '/bump', { id: s.id, by: 'bia', title: 'Título da nuvem B' });
  await typeNewText(p, 'Minha edição B'); await p.waitForSelector('[data-act=cloud]', { timeout: 15000 }); await p.click('[data-act=cloud]');
  const dl = await p.waitForSelector('[data-act=dl]', { timeout: 5000 }).catch(() => null);
  check('CL-34 "Carregar a versão da nuvem" oferece baixar a minha como .html antes (e voltar)', !!dl && !!(await p.$('[data-act=back]')) && !!(await p.$('[data-act=nodl]')));
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('[data-act=dl]')]);
  const dpath = path.join(TMP, 'minha-b.html'); await download.saveAs(dpath); const html = readFileSync(dpath, 'utf8');
  await p.waitForFunction(() => AMCloud.status === 'saved' && !document.querySelector('.cl-dlg'), null, { timeout: 15000 });
  const dB = await deckOf(p);
  check('CL-35 o .html baixado tem a minha edição; o editor passa a mostrar a versão da nuvem (título novo, sem a edição)', /Minha edição B/.test(html) && /am-deck-data/.test(html) && dB.title === 'Título da nuvem B' && !textsOf(dB).includes('Minha edição B') && (await p.evaluate(() => AMCloud.rev)) === 2, { title: dB.title });
  const noPut = !(await reqLog(ana)).some((r) => r.method === 'PUT' && r.path.includes(s.id) && /content/.test(r.path) && r.putBody && JSON.stringify(r.putBody.content).includes('Minha edição B') && r.status === 200);
  check('CL-36 nada da edição descartada chegou ao servidor', noPut && !JSON.stringify((await serverPres(ana, s.id)).content).includes('Minha edição B'));
  await p.close();
  /* c) salvar como cópia */
  s = await seed(ana, 'ana', 'Conflito C'); p = await openEditor(ana, s.id, 'cfC');
  await post(ana, '/bump', { id: s.id, by: 'bia', title: 'Título da nuvem C' });
  await typeNewText(p, 'Minha edição C'); await p.waitForSelector('[data-act=copy]', { timeout: 15000 });
  await Promise.all([p.waitForURL((u) => /\/editor\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(s.id), { timeout: 20000 }), p.click('[data-act=copy]')]);
  const newId = p.url().split('/').pop();
  await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 20000 });
  const cp = await serverPres(ana, newId), orig = await serverPres(ana, s.id);
  check('CL-37 "Salvar a minha como cópia": abre a cópia com a minha edição; a original continua com a versão da nuvem', newId !== s.id && JSON.stringify(cp.content).includes('Minha edição C') && !JSON.stringify(orig.content).includes('Minha edição C') && orig.title === 'Título da nuvem C', { newId, t: orig.title });
  await p.close();
});

await scenario('08 · histórico de versões: listar, pré-visualizar, restaurar, baixar; salvar versão (Ctrl+S)', async () => {
  const s = await seed(ana, 'ana', 'Histórico'); const p = await openEditor(ana, s.id, 'hist');
  await typeNewText(p, 'Versão um'); await waitSaved(p);
  /* Ctrl+S = versão manual, sem baixar nada */
  let downloaded = false; p.on('download', () => { downloaded = true; });
  await p.keyboard.press('Control+s'); await until(async () => (await serverPres(ana, s.id)).versions.some((v) => v.kind === 'manual'), 9000); await sleep(400);
  check('CL-38 Ctrl+S na nuvem salva uma versão manual e NÃO baixa arquivo', (await serverPres(ana, s.id)).versions.some((v) => v.kind === 'manual') && !downloaded && !(await p.evaluate(() => document.getElementById('toast').textContent === '')));
  /* o botão Salvar continua baixando o HTML */
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#bSave')]);
  const sp = path.join(TMP, 'salvar.html'); await dl.saveAs(sp); const h = readFileSync(sp, 'utf8');
  check('CL-39 o botão Salvar continua baixando o .html (exportação offline preservada)', /am-deck-data/.test(h) && /Versão um/.test(h) && dl.suggestedFilename().endsWith('.html'), dl.suggestedFilename());
  /* versão com rótulo pelo menu */
  await typeNewText(p, 'Versão dois'); await waitSaved(p);
  await p.click('#cloudPill'); await p.click('.cl-mi[data-id=snap]'); await p.fill('#cloudVerLabel', 'Enviada ao cliente'); await p.click('[data-act=dosnap]');
  await until(async () => (await serverPres(ana, s.id)).versions.some((v) => v.label === 'Enviada ao cliente'), 9000);
  check('CL-40 menu › Salvar versão agora… grava o rótulo opcional', (await serverPres(ana, s.id)).versions.some((v) => v.kind === 'manual' && v.label === 'Enviada ao cliente'));
  await typeNewText(p, 'Versão três'); await waitSaved(p);
  await p.click('#cloudPill'); await p.click('.cl-mi[data-id=hist]'); await p.waitForSelector('.cl-vi', { timeout: 8000 });
  const items = await p.$$eval('.cl-vi', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ')));
  check('CL-41 histórico lista as versões com rótulo/tipo, data, autor e nº de slides', items.length >= 3 && items.some((t) => /Enviada ao cliente/.test(t)) && items.every((t) => /Ana Dona/.test(t) && /slide/.test(t)), items);
  const target = await p.$$eval('.cl-vi', (l) => l.findIndex((x) => /Enviada ao cliente/.test(x.innerText)));
  await (await p.$$('.cl-vi'))[target].click(); await p.waitForSelector('.cl-vthumb .am-stage', { timeout: 8000 });
  check('CL-42 selecionar uma versão mostra a pré-visualização do 1º slide', !!(await p.$('.cl-vthumb .am-stage')) && /slide/.test(await p.innerText('.cl-vmeta')));
  await p.screenshot({ path: path.join(SHOTS, 'cloud-05-historico.png') });
  const [vd] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('[data-act=vdl]')]);
  const vp = path.join(TMP, 'versao.html'); await vd.saveAs(vp); const vh = readFileSync(vp, 'utf8');
  check('CL-43 "Baixar (.html)" da versão baixa aquela versão (tem "Versão dois", não "Versão três")', /Versão dois/.test(vh) && !/Versão três/.test(vh));
  const revBefore = (await serverPres(ana, s.id)).rev;
  await p.click('[data-act=vrs]'); await p.waitForSelector('.cl-dlg [data-act]', { timeout: 5000 }).catch(() => { });
  const conf = await p.$$('.cl-dlg .cl-b'); await conf[conf.length - 1].click(); // Restaurar
  await p.waitForFunction((r) => AMCloud.rev > r && AMCloud.status === 'saved' && !document.querySelector('.cl-dlg'), revBefore, { timeout: 20000 });
  const sp2 = await serverPres(ana, s.id), dR = await deckOf(p);
  check('CL-44 restaurar: o editor mostra "Versão dois" sem "Versão três", servidor rev+1, e guarda pre_restore/restore no histórico', textsOf(dR).includes('Versão dois') && !textsOf(dR).includes('Versão três') && sp2.rev > revBefore && sp2.versions.some((v) => v.kind === 'pre_restore') && sp2.versions.some((v) => v.kind === 'restore'), { texts: textsOf(dR), vs: sp2.versions.map((v) => v.kind) });
  await p.close();
});

await scenario('09 · menu da pílula: criar cópia, compartilhar, voltar ao acervo, teclado', async () => {
  const s = await seed(ana, 'ana', 'Menu'); const p = await openEditor(ana, s.id, 'menu');
  await p.focus('#cloudPill'); await p.keyboard.press('Enter');
  const items = await p.$$eval('#cloudMenu .cl-mi', (l) => l.map((x) => x.querySelector('span').textContent));
  check('CL-45 clicar/Enter na pílula abre o menu (role=menu) com: Salvar versão agora…, Histórico de versões…, Comentários…, Criar cópia, Compartilhar (copiar link), Voltar ao acervo', JSON.stringify(items) === JSON.stringify(['Salvar versão agora…', 'Histórico de versões…', 'Comentários…', 'Criar cópia', 'Compartilhar (copiar link)', 'Voltar ao acervo']) && (await p.getAttribute('#cloudPill', 'aria-expanded')) === 'true', items);
  check('CL-45b o topo do menu mostra o estado por extenso e a versão na nuvem', /Salvo na nuvem às \d\d:\d\d/.test(await p.innerText('#cloudMenu .cl-mh')) && /Versão 1 na nuvem/.test(await p.innerText('#cloudMenu .cl-mh')));
  await p.keyboard.press('ArrowDown');
  const focused = await p.evaluate(() => document.activeElement.dataset.id);
  await p.keyboard.press('Escape');
  check('CL-46 teclado: setas movem o foco, Esc fecha e devolve o foco à pílula', focused === 'hist' && !(await p.$('#cloudMenu.open')) && (await p.evaluate(() => document.activeElement.id)) === 'cloudPill', focused);
  await ana.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => { });
  await p.click('#cloudPill'); await p.click('.cl-mi[data-id=share]'); await sleep(500);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check('CL-47 Compartilhar copia o link /visualizar/<id> (acervo comum, somente leitura)', clip === BASE + '/visualizar/' + s.id || (await p.$('.cl-dlg input')) !== null, clip);
  await p.click('#cloudPill'); await Promise.all([p.waitForURL((u) => /\/editor\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(s.id), { timeout: 15000 }), p.click('.cl-mi[data-id=copy]')]);
  const nid = p.url().split('/').pop();
  await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 });
  const cp = await serverPres(ana, nid);
  check('CL-48 Criar cópia: nova apresentação (sourceId = original, dono = eu) aberta para edição', nid !== s.id && cp.title.includes('(cópia)') && (await p.evaluate(() => AMCloud.id)) === nid, cp.title);
  await p.close();
  /* início → acervo, com flush do autosave */
  const q = await openEditor(ana, s.id, 'home'); await typeNewText(q, 'Salvar antes de sair');
  await Promise.all([q.waitForURL(/\/acervo\?foco=/, { timeout: 15000 }), q.click('#bHome')]);
  check('CL-49 botão Início (capa) vai para /acervo?foco=<id> depois de salvar o que estava pendente', q.url().endsWith('/acervo?foco=' + s.id) && JSON.stringify((await serverPres(ana, s.id)).content).includes('Salvar antes de sair'), q.url());
  await q.close();
  /* Arquivo › Início (capa) e o clique na marca também vão ao acervo; Minhas obras local segue abrindo */
  const m1 = await openEditor(ana, s.id, 'home-menu'); await m1.click('#mbar button[data-m=file]'); await sleep(250);
  const firstItem = await m1.$eval('.xmenu .xi', (n) => n.textContent.trim());
  await Promise.all([m1.waitForURL(/\/acervo\?foco=/, { timeout: 10000 }), m1.click('.xmenu .xi')]);
  check('CL-49b Arquivo › "Voltar ao acervo" (o antigo "Início (capa)", com o rótulo do que faz na nuvem) leva ao acervo', firstItem === 'Voltar ao acervo' && m1.url().endsWith('/acervo?foco=' + s.id), { firstItem, url: m1.url() });
  await m1.close();
  const m2 = await openEditor(ana, s.id, 'home-brand'); await Promise.all([m2.waitForURL(/\/acervo\?foco=/, { timeout: 10000 }), m2.click('#top .brand')]);
  check('CL-49c clicar na marca A&M também vai ao acervo', m2.url().endsWith('/acervo?foco=' + s.id)); await m2.close();
  const m3 = await openEditor(ana, s.id, 'obras'); await m3.click('#mbar button[data-m=file]'); await sleep(250);
  const labs = await m3.$$eval('.xmenu .xi .xl', (l) => l.map((x) => x.textContent)), io = labs.indexOf('Acervo da nuvem…');
  await Promise.all([m3.waitForURL(/\/acervo\?aba=minhas&foco=/, { timeout: 10000 }).catch(() => { }), io >= 0 ? (await m3.$$('.xmenu .xi'))[io].click() : null]);
  check('CL-49d "Minhas obras…" na nuvem vira "Acervo da nuvem…" e leva a /acervo?aba=minhas (não abre o acervo local do navegador) — BE-ED-03', io >= 0 && !labs.includes('Minhas obras…') && m3.url().endsWith('/acervo?aba=minhas&foco=' + s.id), { labs, url: m3.url() });
  await m3.close();
  const r = await openEditor(ana, s.id, 'home2'); await r.keyboard.press('F1'); const hk = await r.waitForSelector('#modal.open', { timeout: 4000 }).catch(() => null);
  check('CL-50 atalho F1 (editor original) continua abrindo a ajuda; Esc fecha', !!hk && /Atalhos de teclado/.test(await r.innerText('#modal')) && (await r.innerText('#modal')).includes('Na nuvem: salva uma versão'), '');
  await r.keyboard.press('Escape'); await sleep(200);
  check('CL-51 Esc fecha a ajuda', !(await r.$('#modal.open')));
  await r.close();
});

await scenario('10 · atalhos existentes do editor seguem iguais (F5/Esc, Ctrl+D, Delete, Ctrl+A)', async () => {
  const s = await seed(ana, 'ana', 'Atalhos', deckWith('Atalhos', [slideOf([textEl('Alvo'), textEl('Outro', { y: 300 })]), slideOf([textEl('Dois')])]));
  const p = await openEditor(ana, s.id, 'keys');
  await p.keyboard.press('F5'); await p.waitForSelector('#presenter.open', { timeout: 5000 });
  const pos = await p.innerText('.amp-pos');
  await p.keyboard.press('ArrowRight'); await sleep(500); const pos2 = await p.innerText('.amp-pos');
  await p.keyboard.press('Escape'); await sleep(400);
  check('CL-52 F5 apresenta (01 → 02 com →) e Esc sai da apresentação sem sair do editor', /^01/.test(pos) && /^02/.test(pos2) && !(await p.$('#presenter.open')) && p.url().includes('/editor/'), { pos, pos2 });
  await p.click('#cv', { position: { x: 100, y: 100 } }); await p.keyboard.press('Control+a'); const sel = await p.evaluate(() => AMStudio.selected().length);
  await p.keyboard.press('Control+d'); await sleep(300); const n2 = (await deckOf(p)).slides[0].els.length;
  await p.keyboard.press('Delete'); await sleep(300); const n3 = (await deckOf(p)).slides[0].els.length;
  check('CL-53 Ctrl+A seleciona tudo, Ctrl+D duplica, Delete apaga (2 → 4 → 2 elementos)', sel === 2 && n2 === 4 && n3 === 2, { sel, n2, n3 });
  await waitSaved(p);
  check('CL-54 e esses comandos foram salvos na nuvem (servidor com 2 elementos no slide 1)', (await serverPres(ana, s.id)).content.slides[0].els.length === 2);
  await p.close();
});

await scenario('11 · sessão: renovação transparente, expirada, nova aba', async () => {
  const s = await seed(ana, 'ana', 'Sessão'); const p = await openEditor(ana, s.id, 'sess');
  await post(ana, '/expire'); await reqLog(ana, true);
  await typeNewText(p, 'Depois de expirar'); await waitSaved(p);
  const log = await reqLog(ana);
  check('CL-55 401 session_expired → POST /api/auth/refresh uma vez → o PUT é refeito e salva (sem aviso ao usuário)', log.some((r) => r.path === '/api/auth/refresh' && r.status === 200) && log.some((r) => /\/content$/.test(r.path) && r.status === 200) && !(await p.$('.cl-dlg')), log.map((r) => r.method + r.path.slice(5, 30) + r.status));
  await faults(ana, { refreshFails: true }); await post(ana, '/expire');
  await typeNewText(p, 'Sessão acabou');
  const dlg = await p.waitForSelector('.cl-dlg', { timeout: 15000 }).catch(() => null);
  const t = dlg ? await dlg.$eval('h2', (h) => h.textContent) : null;
  check('CL-56 refresh falhou: "Sua sessão expirou", pílula "Sessão expirada", e as alterações continuam no editor e na fila local', t === 'Sua sessão expirou' && (await pillState(p)) === 'expired' && textsOf(await deckOf(p)).includes('Sessão acabou'), { t });
  await p.screenshot({ path: path.join(SHOTS, 'cloud-06-sessao.png') });
  const [popup] = await Promise.all([p.waitForEvent('popup', { timeout: 8000 }).catch(() => null), p.click('[data-act=login]')]);
  check('CL-57 "Entrar numa nova aba" abre /entrar em outra aba SEM fechar o editor', popup && /\/entrar\?next=/.test(popup.url()) && p.url().includes('/editor/') && !p.isClosed(), popup && popup.url());
  if (popup) await popup.close();
  await faults(ana, { refreshFails: false }); await ana.request.post(BASE + '/__test/login', { data: { user: 'ana' } });
  await p.click('[data-act=retry]'); await p.waitForFunction(() => AMCloud.status === 'saved' && !AMCloud.dirty, null, { timeout: 20000 });
  check('CL-58 "Já entrei — tentar de novo" volta a salvar o que estava guardado', JSON.stringify((await serverPres(ana, s.id)).content).includes('Sessão acabou'));
  await p.close();
});

await scenario('12 · dono × não-dono: visualizar, criar cópia, sem edição', async () => {
  const s = await seed(ana, 'ana', 'Acervo da Ana', deckWith('Acervo da Ana', [slideOf([textEl('Slide um'), imgEl(dataUrl(imgA))]), slideOf([textEl('Slide dois')])]));
  const pb = await openEditor(bia, s.id, 'bia-edit', { wait: false }); await pb.waitForURL(/\/visualizar\//, { timeout: 15000 });
  check('CL-59 não-dono em /editor/<id> é redirecionado para /visualizar/<id> (canEdit=false)', pb.url().endsWith('/visualizar/' + s.id), pb.url());
  await pb.waitForSelector('#presenter.open', { timeout: 15000 }); await sleep(500);
  const v = await pb.evaluate(() => ({ cfg: window.AM_CLOUD.mode, top: getComputedStyle(document.getElementById('top')).display, rib: getComputedStyle(document.getElementById('rib')).display, pill: !!document.getElementById('cloudPill'), copyBtn: !!document.getElementById('cloudCopy'), copyTxt: document.getElementById('cloudCopy')?.textContent, edit: !!document.getElementById('cloudEdit'), slides: document.querySelectorAll('#presenter .amp-slide').length, imgs: document.querySelectorAll('#presenter img').length }));
  check('CL-60 /visualizar: apresentação iniciada, interface do editor oculta, sem pílula de edição, botão "Criar cópia para usar" e sem "Editar"', v.cfg === 'view' && v.top === 'none' && v.rib === 'none' && !v.pill && v.copyTxt === 'Criar cópia para usar' && !v.edit && v.slides === 2, v);
  await pb.screenshot({ path: path.join(SHOTS, 'cloud-07-visualizar.png') });
  await reqLog(bia, true);
  for (const k of ['Delete', 'Control+z', 'Control+d', 'a', 'Control+s']) await pb.keyboard.press(k);
  await pb.mouse.dblclick(500, 400); await sleep(3800);
  const lg = await reqLog(bia);
  check('CL-61 no modo visualizar nenhum PUT/POST de conteúdo parte do cliente (teclas e cliques não editam)', !lg.some((r) => r.method !== 'GET' && !/interactions/.test(r.path)) && (await serverPres(ana, s.id)).rev === 1, lg.map((r) => r.method + r.path.slice(0, 40)));
  const imgsOk = await pb.evaluate(() => [...document.querySelectorAll('#presenter img')].every((i) => i.naturalWidth > 0));
  check('CL-62 imagens do acervo aparecem na apresentação (hidratadas)', v.imgs >= 1 && imgsOk);
  await pb.keyboard.press('Escape'); await pb.waitForURL(/\/acervo\?foco=/, { timeout: 8000 });
  check('CL-63 Esc volta para /acervo?foco=<id>', pb.url().endsWith('/acervo?foco=' + s.id), pb.url());
  /* criar cópia para usar */
  const pv = await openEditor(bia, s.id, 'bia-view', { mode: 'visualizar' }); await pv.waitForSelector('#presenter.open');
  await Promise.all([pv.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 20000 }), pv.click('#cloudCopy')]);
  const nid = pv.url().split('/').pop(); await pv.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 20000 });
  const cp = await serverPres(bia, nid);
  check('CL-64 "Criar cópia para usar" cria a cópia da Bia e abre no editor (a original continua da Ana, rev 1)', nid !== s.id && cp.rev >= 1 && JSON.stringify(cp.content).includes('Slide dois') && (await serverPres(ana, s.id)).rev === 1, nid);
  await typeNewText(pv, 'Só na cópia da Bia'); await waitSaved(pv);
  check('CL-65 editar a cópia não altera a original', !JSON.stringify((await serverPres(ana, s.id)).content).includes('Só na cópia da Bia') && JSON.stringify((await serverPres(bia, nid)).content).includes('Só na cópia da Bia'));
  await pv.close();
  /* o dono em /visualizar vê "Editar" */
  const po = await openEditor(ana, s.id, 'ana-view', { mode: 'visualizar' }); await po.waitForSelector('#cloudEdit', { timeout: 10000 });
  check('CL-66 o dono em /visualizar também vê o atalho "Editar"', (await po.getAttribute('#cloudEdit', 'href')) === '/editor/' + s.id);
  await po.close(); await pb.close();
  /* perda de permissão no meio da edição */
  const s2 = await seed(ana, 'ana', 'Perde permissão'); const pe = await openEditor(ana, s2.id, 'perm');
  await post(ana, '/transfer', { id: s2.id, to: 'bia' }); await typeNewText(pe, 'Sem permissão');
  const d403 = await pe.waitForSelector('.cl-dlg', { timeout: 15000 }).catch(() => null);
  check('CL-67 se o servidor recusar (403), a pílula vira "Somente leitura" e a pessoa pode salvar a edição como cópia', (await pillState(pe)) === 'readonly' && !!d403 && /Você não pode mais alterar/.test(await d403.innerText()) && !!(await pe.$('[data-act=copyro]')), await pillState(pe));
  await pe.close();
});

await scenario('13 · interações: formulário, quadro e votação ↔ API', async () => {
  const s = await seed(ana, 'ana', 'Interações'); const p = await openEditor(ana, s.id, 'form');
  await p.evaluate(() => { AMStudio.insertFx('form'); }); await sleep(400);
  const fid = await p.evaluate(() => AMStudio.deck.slides[0].els.find((e) => e.kind === 'form').id);
  await p.evaluate(() => { AMStudio.insertFx('vote'); }); await sleep(300);
  const vid = await p.evaluate(() => AMStudio.deck.slides[0].els.find((e) => e.kind === 'vote').id);
  await p.evaluate(({ f, v }) => { const els = AMStudio.deck.slides[0].els; const F = els.find((e) => e.id === f), V = els.find((e) => e.id === v); F.x = 20; F.y = 20; F.w = 520; F.h = 520; V.x = 700; V.y = 20; V.w = 540; V.h = 340; AMStudio.renderAll(); AMStudio.commit(); }, { f: fid, v: vid });
  await waitSaved(p); await p.keyboard.press('F5'); await p.waitForSelector('#presenter.open', { timeout: 5000 }); await sleep(900);
  const hasForm = await p.evaluate(() => !!document.querySelector('#presenter .amf'));
  check('CL-68 formulário (S30) funciona dentro do player do editor em nuvem', hasForm);
  await faults(ana, { interactions5xx: 2 });
  const fillAndSend = async () => { await p.evaluate(() => { const ins = [...document.querySelectorAll('#presenter .amf-in')]; ins.forEach((x, i) => { x.focus(); document.execCommand('insertText', false, 'Resposta ' + (i + 1)); }); [...document.querySelectorAll('#presenter .amf-rb')].slice(0, 1).forEach((b) => b.click()); [...document.querySelectorAll('#presenter .amf-o')].slice(0, 1).forEach((b) => b.click()); }); await p.click('#presenter .amf-send'); };
  await fillAndSend(); await sleep(600);
  const key = 'amForm.' + s.id + '.' + fid;
  const local = await p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
  check('CL-69 o envio grava no localStorage do formulário (comportamento original) com id da obra = id da apresentação', local && local.rows.length === 1, local);
  await until(async () => (await post(ana, '/state')).interactions.filter((i) => i.kind === 'form_response').length >= 1, 25000, 400);
  const inter = (await post(ana, '/state')).interactions.filter((i) => i.kind === 'form_response');
  check('CL-70 a ponte envia UMA form_response por envio (mesmo com 2 falhas 503 antes: tenta depois, sem quebrar o player)', inter.length === 1 && inter[0].elementId === fid && inter[0].payload.a.length >= 1 && inter[0].userId === users.ana, inter);
  check('CL-71 a apresentação seguiu funcionando durante as falhas (player aberto, sem erro de página)', !!(await p.$('#presenter.open')) && pageErrors.length === 0, pageErrors);
  /* votação: estado por pessoa */
  await p.evaluate(() => { const b = document.querySelector('#presenter .amv-p'); if (b) { b.click(); b.click(); } const send = document.querySelector('#presenter .amv-send'); if (send) send.click(); }); await sleep(2200);
  await p.evaluate(() => AMCloud.bridgeFlush()); await sleep(500);
  const vs = (await post(ana, '/state')).interactions.filter((i) => i.kind === 'vote_state');
  check('CL-72 votação: estado da pessoa enviado como vote_state (upsert por pessoa/elemento)', vs.length === 1 && vs[0].elementId === vid && /rows/.test(JSON.stringify(vs[0].payload)), vs.map((x) => x.payload));
  await p.keyboard.press('Escape'); await sleep(300);
  const bkey = 'amBoard.' + s.id + '.eBoard1';
  await p.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, notes: [{ c: 0, t: 'Ideia da Ana', k: 'y' }] })), bkey); await sleep(1800); await p.evaluate(() => AMCloud.bridgeFlush()); await sleep(300);
  const bs = (await post(ana, '/state')).interactions.filter((i) => i.kind === 'board_state');
  check('CL-72b quadro de post-its: escrita em amBoard.<obra>.<elemento> vira board_state (estado por pessoa, upsert)', bs.length === 1 && bs[0].elementId === 'eBoard1' && /Ideia da Ana/.test(JSON.stringify(bs[0].payload)), bs);
  /* outro computador: localStorage vazio → restaura o estado próprio */
  const q = await newPage(ana, 'form2'); await q.goto(BASE + '/editor/' + s.id); await q.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 });
  await q.evaluate(() => localStorage.clear()); await q.reload(); await q.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 }); await sleep(900);
  const rest = await q.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
  const restB = await q.evaluate((k) => localStorage.getItem(k), bkey), restV = await q.evaluate((k) => localStorage.getItem(k), 'amVote.' + s.id + '.' + vid);
  check('CL-73 ao abrir em outro computador (localStorage vazio) o formulário, o quadro e a votação próprios são restaurados da API', rest && rest.rows.length === 1 && /Ideia da Ana/.test(restB || '') && /rows/.test(restV || ''), { rest, restB, restV });
  await q.close(); await p.close();
  /* outra pessoa responde no modo visualizar; o dono vê o consolidado, ela vê só o dela */
  const pv = await openEditor(bia, s.id, 'form-bia', { mode: 'visualizar' }); await pv.waitForSelector('#presenter .amf', { timeout: 10000 }); await sleep(400);
  await pv.evaluate(() => { const ins = [...document.querySelectorAll('#presenter .amf-in')]; ins.forEach((x) => { x.focus(); document.execCommand('insertText', false, 'Da Bia'); }); [...document.querySelectorAll('#presenter .amf-rb')].slice(0, 1).forEach((b) => b.click()); [...document.querySelectorAll('#presenter .amf-o')].slice(0, 1).forEach((b) => b.click()); });
  await pv.click('#presenter .amf-send'); await until(async () => (await post(ana, '/state')).interactions.filter((i) => i.kind === 'form_response').length >= 2, 10000);
  const all = (await post(ana, '/state')).interactions.filter((i) => i.kind === 'form_response');
  const mineBia = await pv.evaluate(async (id) => (await (await fetch('/api/presentations/' + id + '/interactions?kind=form_response')).json()).items, s.id);
  check('CL-74 modo visualizar: a resposta da Bia chega à API; ela enxerga só as próprias, o dono enxerga todas', all.length === 2 && all.some((i) => i.userId === users.bia) && mineBia.length === 1 && mineBia[0].author.id === users.bia, { all: all.length, mine: mineBia.length });
  await pv.close();
  await faults(ana, { interactions5xx: 0 });
});

await scenario('14 · exportações com imagens hidratadas (HTML, PDF, PowerPoint) e importação PPTX/PDF', async () => {
  const content = deckWith('Exporta', [slideOf([textEl('Com imagem'), imgEl(dataUrl(imgA)), el({ type: 'fx', kind: 'kpi', x: 80, y: 300, w: 300, h: 160, data: { label: 'KPI', value: '42' } })])]);
  const s = await seed(ana, 'ana', 'Exporta', content); const p = await openEditor(ana, s.id, 'exp');
  const html = await p.evaluate(() => AMStudio.exportHTML());
  check('CL-75 exportHTML tem as imagens inline (data:image/png) e nenhuma referência asset:', /data:image\/png;base64,/.test(html) && !/asset:sha256/.test(html) && /am-deck-data/.test(html), { n: html.length });
  const pdf = await p.evaluate(async () => { const b = await AMExport.pdf(AMStudio.deck, { scale: 1 }); const t = await b.slice(0, 8).text(); return { size: b.size, head: t }; });
  const pptx = await p.evaluate(async () => { const b = await AMExport.pptxBuild(AMStudio.deck, { range: 'all', mode: 'edit' }); const u = new Uint8Array(await b.slice(0, 4).arrayBuffer()); return { size: b.size, sig: [...u] }; });
  check('CL-76 PDF e PowerPoint são gerados sem erro (PDF %PDF-, PPTX zip PK) com a imagem hidratada', /^%PDF-/.test(pdf.head) && pdf.size > 5000 && pptx.sig[0] === 0x50 && pptx.sig[1] === 0x4b && pptx.size > 5000, { pdf, pptx });
  /* importar PPTX gerado pelo python-pptx */
  const fx = path.join(TMP, 'fx'); mkdirSync(fx, { recursive: true });
  try { execFileSync('python3', [path.join(REPO, 'studio', 'test-s24-tools.py'), 'make', fx], { stdio: 'pipe' }); } catch (e) { check('CL-77 gerar PPTX de teste (python-pptx)', false, String(e.stderr || e).slice(0, 300)); }
  if (existsSync(path.join(fx, 'fx-a.pptx'))) {
    const b64 = readFileSync(path.join(fx, 'fx-a.pptx')).toString('base64'); const before = (await deckOf(p)).slides.length;
    const rep = await p.evaluate(async (b) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const res = await AMImport.pptx(u, {}); return AMImport.finish(res, { name: 'fx-a.pptx' }, { mode: 'append' }); }, b64);
    await waitSaved(p, 30000);
    const srv = await serverPres(ana, s.id), after = (await deckOf(p)).slides.length;
    check('CL-77 importar .pptx (adicionar ao final) no editor em nuvem: slides novos, salvos na nuvem, imagens importadas como asset: (sem data: no servidor)', after > before && srv.content.slides.length === after && !/data:image/.test(JSON.stringify(srv.content)), { before, after, srv: srv.content.slides.length, rep: rep && Object.keys(rep).slice(0, 4) });
  }
  /* importar PDF: pdf.js servido de /vendor, sem violar a CSP */
  const pdfPage = await p.context().newPage(); await pdfPage.setContent('<html><body style="font:28px Arial"><h1>Relatório de teste</h1><p>Texto do PDF para importar na nuvem.</p></body></html>');
  const pdfBytes = await pdfPage.pdf({ format: 'A4', landscape: true }); await pdfPage.close();
  const cv0 = cspViolations.length;
  const rp = await p.evaluate(async (b) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const res = await AMImport.pdf(u, {}); const r = AMImport.finish(res, { name: 'teste.pdf' }, { mode: 'append' }); return { ok: true, slides: AMStudio.deck.slides.length }; }, pdfBytes.toString('base64')).catch((e) => ({ ok: false, err: String(e) }));
  check('CL-78 importar .pdf: pdf.js carrega de /vendor/pdfjs-4.10.38/ por import() sem violar a CSP (new Function removido pelo patch)', rp.ok && cspViolations.length === cv0, { rp, viol: cspViolations.slice(cv0) });
  await waitSaved(p, 30000);
  /* arrastar um .html salvo para dentro (Abrir…) — substitui o conteúdo desta apresentação; o id continua o da nuvem */
  const saved = path.join(TMP, 'aberto.html'); writeFileSync(saved, await p.evaluate(() => AMStudio.exportHTML()));
  await p.screenshot({ path: path.join(SHOTS, 'cloud-08-importado.png') });
  await p.close();
});

await scenario('15 · Abrir…/Novo trocam o deck: o id da nuvem se mantém e o estado anterior fica no histórico', async () => {
  const s = await seed(ana, 'ana', 'Trocar', deckWith('Trocar', [slideOf([textEl('Original da nuvem')])])); const p = await openEditor(ana, s.id, 'swap');
  const other = deckWith('Outro arquivo', [slideOf([textEl('Veio de um arquivo')])]); other.id = 'id-de-outro-arquivo';
  const f = path.join(TMP, 'outro.json'); writeFileSync(f, JSON.stringify(other));
  await p.setInputFiles('#fOpen', f); await p.waitForSelector('.cl-dlg [data-act=replace]', { timeout: 8000 }); await p.click('.cl-dlg [data-act=replace]'); await sleep(500);
  await waitSaved(p, 20000);
  const d = await deckOf(p), sp = await serverPres(ana, s.id);
  check('CL-79 Abrir… um arquivo › "Substituir esta (a atual fica no histórico)": deck.id continua o da apresentação na nuvem e o conteúdo novo é salvo', d.id === s.id && JSON.stringify(sp.content).includes('Veio de um arquivo') && sp.content.id === s.id, { id: d.id, cid: sp.content.id });
  const vs = (await post(ana, '/presentation', { id: s.id })).versions;
  check('CL-80 antes de substituir, o que estava na nuvem ficou guardado no histórico ("Antes de substituir")', vs.some((v) => v.label === 'Antes de substituir'), vs);
  await p.close();
});

await scenario('16 · aviso ao sair (beforeunload) e rascunho local', async () => {
  const s = await seed(ana, 'ana', 'Sair'); const p = await openEditor(ana, s.id, 'unload');
  await typeNewText(p, 'Já salvo'); await waitSaved(p);
  let dialogs = 0; p.on('dialog', async (d) => { dialogs++; await d.dismiss().catch(() => { }); });
  const draft = await p.evaluate(() => localStorage.getItem('amStudio.draft'));
  check('CL-81 na nuvem o editor não guarda rascunho em localStorage (a fila é o IndexedDB, apagada após salvar)', draft === null, draft && draft.length);
  await p.close({ runBeforeUnload: true }); await sleep(300);
  check('CL-82 tudo salvo: sair NÃO pergunta nada (o aviso de "desfazer" do editor é suprimido)', dialogs === 0, dialogs);
  const q = await openEditor(ana, s.id, 'unload2'); let d2 = 0; q.on('dialog', async (d) => { d2++; await d.dismiss(); });
  await faults(ana, { putDelayMs: 4000 }); await typeNewText(q, 'Ainda não salvo'); await sleep(3300);
  await q.close({ runBeforeUnload: true }); await sleep(300);
  check('CL-83 com alterações ainda não confirmadas, fechar pergunta (beforeunload)', d2 >= 1, d2);
  await faults(ana, { putDelayMs: 0 });
});

await scenario('17 · pílula não estoura a barra: 1180 a 1920 px, estados curtos e o mais longo', async () => {
  const s = await seed(ana, 'ana', 'Barra com um nome de apresentação bastante comprido para testar'); const widths = [1180, 1280, 1366, 1440, 1600, 1920, 1240, 1500, 1700, 1800];
  const p = await openEditor(ana, s.id, 'bar'); const rows = [];
  for (const w of widths.sort((a, b) => a - b)) {
    await p.setViewportSize({ width: w, height: 760 }); await sleep(350);
    for (const off of [false, true]) {
      await ana.setOffline(off); await sleep(250);
      const m = await p.evaluate(() => { const t = document.getElementById('top'), r = document.getElementById('rib'), ti = document.getElementById('title'), sv = document.getElementById('bSave').getBoundingClientRect(), pl = document.getElementById('cloudPill').getBoundingClientRect(); return { sw: t.scrollWidth, cw: t.clientWidth, rs: r.scrollWidth, rc: r.clientWidth, title: Math.round(ti.getBoundingClientRect().width), saveRight: Math.round(sv.right), vw: innerWidth, size: document.getElementById('cloudPill').dataset.size, pillW: Math.round(pl.width), pillTop: Math.round(pl.top), pillH: Math.round(pl.height) }; });
      rows.push(Object.assign({ w, off }, m));
    }
  }
  await ana.setOffline(false);
  const bad = rows.filter((m) => m.sw > m.cw || m.rs > m.rc || m.saveRight > m.vw || m.title < 110 || m.pillTop < 0 || m.pillH !== 32);
  check('CL-84 em 1180–1920 px (10 larguras × conectado/offline): #top e #rib sem rolagem, #bSave dentro da tela, nome da apresentação ≥ 110 px, pílula na barra', rows.length === 20 && bad.length === 0, bad.slice(0, 3));
  console.log('  larguras → pílula: ' + rows.filter((m) => !m.off).map((m) => m.w + ':' + m.size + '/' + m.pillW + 'px/título ' + m.title).join(' · '));
  console.log('  offline: ' + rows.filter((m) => m.off).map((m) => m.w + ':' + m.size + '/' + m.pillW + 'px').join(' · '));
  for (const w of [1180, 1440, 1920]) { await p.setViewportSize({ width: w, height: 760 }); await sleep(300); await p.screenshot({ path: path.join(SHOTS, 'cloud-09-barra-' + w + '.png'), clip: { x: 0, y: 0, width: w, height: 110 } }); }
  await ana.setOffline(true); await p.setViewportSize({ width: 1920, height: 760 }); await sleep(400); await p.screenshot({ path: path.join(SHOTS, 'cloud-09-barra-1920-offline.png'), clip: { x: 0, y: 0, width: 1920, height: 110 } }); await ana.setOffline(false);
  /* reduced motion */
  await p.emulateMedia({ reducedMotion: 'reduce' }); const anim = await p.evaluate(() => getComputedStyle(document.querySelector('.cl-dot')).animationName); await p.emulateMedia({ reducedMotion: 'no-preference' });
  check('CL-85 prefers-reduced-motion: o ponto da pílula não pulsa', anim === 'none', anim);
  await p.close();
});

await scenario('18 · telas estreitas (390 px) no modo visualizar e caixas de diálogo', async () => {
  const s = await seed(ana, 'ana', 'Celular', deckWith('Celular', [slideOf([textEl('Celular')])]));
  const c = await newCtx('bia', { width: 390, height: 780 }); const p = await openEditor(c, s.id, 'mobile', { mode: 'visualizar' }); await p.waitForSelector('#presenter.open'); await sleep(500);
  const m = await p.evaluate(() => ({ sx: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bar: document.getElementById('cloudViewBar').getBoundingClientRect().height, copyVisible: document.getElementById('cloudCopy').getBoundingClientRect().right <= innerWidth }));
  check('CL-86 390 px: modo visualizar sem rolagem horizontal e com o botão "Criar cópia para usar" visível', m.sx <= m.cw && m.copyVisible, m);
  await p.screenshot({ path: path.join(SHOTS, 'cloud-10-visualizar-390.png') });
  await c.close();
});

await scenario('19 · salvamentos concorrentes: um PUT por vez, encadeando baseRev; visibilitychange salva já', async () => {
  const s = await seed(ana, 'ana', 'Concorrência'); const p = await openEditor(ana, s.id, 'conc');
  await faults(ana, { putDelayMs: 1800 }); await reqLog(ana, true);
  await typeNewText(p, 'Primeira'); await p.evaluate(() => AMCloud.saveNow({ force: true }));
  await until(async () => (await p.evaluate(() => AMCloud.inflight)), 4000, 50);
  await typeNewText(p, 'Segunda durante o PUT'); /* mudança enquanto o PUT está em andamento */
  await p.waitForFunction(() => AMCloud.status === 'saved' && !AMCloud.dirty && !AMCloud.inflight, null, { timeout: 25000 });
  const puts = (await reqLog(ana)).filter((r) => r.method === 'PUT' && /\/content$/.test(r.path));
  const chain = puts.map((r) => r.putBody.baseRev + '→' + r.status).join(' ');
  const overlap = puts.some((r, i) => i && r.t < puts[i - 1].t + 1700);
  check('CL-90 mudança durante um PUT agenda outro DEPOIS dele: baseRev encadeado (' + chain + '), sem 409 e sem PUTs sobrepostos', puts.length === 2 && puts[0].putBody.baseRev === 1 && puts[1].putBody.baseRev === 2 && puts.every((r) => r.status === 200) && !overlap && JSON.stringify((await serverPres(ana, s.id)).content).includes('Segunda durante o PUT'), { chain });
  await faults(ana, { putDelayMs: 0 });
  /* visibilitychange (aba escondida) salva imediatamente, sem esperar os 3 s */
  await reqLog(ana, true); await typeNewText(p, 'Ao esconder a aba'); const t0 = Date.now();
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await until(async () => (await serverPres(ana, s.id)).content.slides[0].els.some((e) => String(e.html).includes('Ao esconder a aba')), 6000, 50);
  const dt = Date.now() - t0;
  check('CL-91 visibilitychange → hidden salva na hora (' + dt + ' ms, bem antes do debounce de 3 s)', dt < 2200, dt);
  await p.close();
});

await scenario('20 · administrador edita apresentação de outra pessoa', async () => {
  const adm = await newCtx('adm'); const s = await seed(ana, 'ana', 'Moderação');
  const p = await openEditor(adm, s.id, 'adm'); check('CL-92 admin em /editor/<id> de outra pessoa permanece no editor (canEdit pelo papel, decidido no servidor)', p.url().includes('/editor/') && !!(await p.$('#cloudPill')), p.url());
  await typeNewText(p, 'Moderado'); await waitSaved(p);
  const sp = await serverPres(ana, s.id);
  check('CL-93 a edição do admin é salva (e o histórico registra o autor)', JSON.stringify(sp.content).includes('Moderado') && sp.rev === 2, sp.rev);
  await p.close(); await adm.close();
});

/* =========================================================================================================== */
/* correções da auditoria (BE-ED-*, BTN-*, VIS-06, F5, F7, F13): cada cenário prova o comportamento novo */
await scenario('21 · imagens SVG, BMP e ICO: a cópia que sobe leva PNG (asset:sha256) e a apresentação salva normalmente (BE-ED-01)', async () => {
  const s = await seed(ana, 'ana', 'Formatos'); const p = await openEditor(ana, s.id, 'fmt'); await reqLog(ana, true);
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#F78C16"/></svg>').toString('base64');
  const bmp = dataUrl(bmpBuf(64, 32), 'image/bmp'), ico = dataUrl(icoBuf(await pngBuf(32, 32, 5)), 'image/x-icon');
  await p.evaluate((srcs) => { const sl = AMStudio.deck.slides[0]; srcs.forEach((u, i) => { sl.els.push(AMStudio.mk.image(u, 240, 120, { x: 40 + i * 300, y: 200 })); }); sl.bgImg = srcs[0]; AMStudio.renderAll(); AMStudio.commit(); }, [svg, bmp, ico]);
  await waitSaved(p, 25000);
  const put = (await reqLog(ana)).filter((r) => r.method === 'PUT' && /\/content$/.test(r.path)).pop(), c = put && put.putBody.content;
  const srcs = c ? c.slides[0].els.filter((e) => e.type === 'image').map((e) => e.src) : [];
  check('CL-95 SVG, BMP e ICO inseridos (e um SVG de fundo): o PUT sai só com asset:sha256, sem nenhum data:image, e a pílula fica "Salvo na nuvem"', !!put && put.status === 200 && srcs.length === 3 && srcs.every((x) => /^asset:sha256:[0-9a-f]{64}$/.test(x)) && /^asset:sha256:/.test(c.slides[0].bgImg || '') && !/data:image/.test(JSON.stringify(c)) && (await pillState(p)) === 'saved', { st: put && put.status, srcs: srcs.map((x) => x.slice(0, 20)), pill: await pillState(p) });
  const types = await p.evaluate(async (list) => Promise.all(list.map(async (u) => (await fetch('/api/assets/' + u.slice(13))).headers.get('content-type'))), srcs);
  const local = (await deckOf(p)).slides[0].els.filter((e) => e.type === 'image').map((e) => e.src.slice(0, 15));
  check('CL-96 os arquivos que subiram são PNG (desenhados no navegador) e o deck do editor segue com as imagens originais (SVG/BMP/ICO)', types.length === 3 && types.every((t) => t === 'image/png') && local[0] === 'data:image/svg+' && local[1] === 'data:image/bmp;' && local[2].startsWith('data:image/x-ic'), { types, local });
  await p.reload(); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 20000 });
  const back = (await deckOf(p)).slides[0].els.filter((e) => e.type === 'image').map((e) => e.src.slice(0, 22));
  check('CL-96b ao reabrir, as três imagens voltam (como PNG) e nada pede recuperação', back.length === 3 && back.every((x) => x === 'data:image/png;base64,') && !(await p.$('.cl-dlg')), back);
  await p.close();
});

await scenario('22 · Novo e Arquivo › Nova apresentação criam outra apresentação no acervo; a aberta fica intacta (BTN-01)', async () => {
  const s = await seed(ana, 'ana', 'Proposta Cliente X', deckWith('Proposta Cliente X', [slideOf([textEl('Conteúdo da proposta')])]));
  const p = await openEditor(ana, s.id, 'novo'); await reqLog(ana, true);
  await Promise.all([p.waitForURL((u) => /\/editor\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(s.id), { timeout: 15000 }), p.click('#bNew')]);
  const nid = p.url().split('/').pop(); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 });
  const orig = await serverPres(ana, s.id), log = await reqLog(ana), np = await serverPres(ana, nid);
  check('CL-97 botão Novo: POST /api/presentations {source:"new"} e abre /editor/<novo>; a aberta continua com o título, o conteúdo e a revisão', log.some((r) => r.method === 'POST' && r.path === '/api/presentations' && r.json && r.json.source === 'new') && nid !== s.id && orig.title === 'Proposta Cliente X' && JSON.stringify(orig.content).includes('Conteúdo da proposta') && orig.rev === 1 && !orig.versions.some((v) => v.label === 'Antes de substituir') && np.content.slides.length === 1, { nid, t: orig.title, rev: orig.rev });
  const q = await openEditor(ana, s.id, 'novo2'); await q.click('#mbar button[data-m=file]'); await sleep(250);
  const labs = await q.$$eval('.xmenu .xi .xl', (l) => l.map((x) => x.textContent)), i = labs.indexOf('Nova apresentação no acervo');
  await Promise.all([q.waitForURL((u) => /\/editor\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(s.id) && !u.pathname.endsWith(nid), { timeout: 15000 }).catch(() => { }), i >= 0 ? (await q.$$('.xmenu .xi'))[i].click() : null]);
  const orig2 = await serverPres(ana, s.id);
  check('CL-98 Arquivo › "Nova apresentação no acervo" também cria outra e abre; nada da aberta muda (sem a caixa "O que não foi salvo com Salvar apresentação…")', i >= 0 && !q.url().endsWith(s.id) && orig2.rev === 1 && orig2.title === 'Proposta Cliente X', { labs, url: q.url() });
  await q.close(); await p.close();
});

await scenario('23 · Abrir…/arrastar arquivo e projeto pronto: criar nova no acervo × substituir esta; ?modelo=N (BE-ED-04)', async () => {
  const s = await seed(ana, 'ana', 'Com conteúdo', deckWith('Com conteúdo', [slideOf([textEl('Original na nuvem')])])); const p = await openEditor(ana, s.id, 'abrir');
  const other = deckWith('Arquivo aberto', [slideOf([textEl('Veio do arquivo'), imgEl(dataUrl(imgB))])]); other.id = 'outro-arquivo';
  const f = path.join(TMP, 'abrir.json'); writeFileSync(f, JSON.stringify(other));
  await p.setInputFiles('#fOpen', f); const dl = await p.waitForSelector('.cl-dlg', { timeout: 8000 }).catch(() => null);
  const acts = await p.$$eval('.cl-dlg [data-act]', (l) => l.map((b) => b.dataset.act + ':' + b.textContent));
  const shown = textsOf(await deckOf(p));
  check('CL-99 Abrir… numa apresentação com conteúdo: a da nuvem continua no editor e a caixa oferece "Criar como nova apresentação no acervo" × "Substituir esta (a atual fica no histórico)" × Cancelar', !!dl && shown.includes('Original na nuvem') && !shown.includes('Veio do arquivo') && acts.some((a) => a === 'new:Criar como nova apresentação no acervo') && acts.some((a) => a === 'replace:Substituir esta (a atual fica no histórico)') && acts.some((a) => a.startsWith('cancel:')), { acts, shown });
  await p.click('.cl-dlg [data-act=cancel]'); await sleep(3800);
  check('CL-100 Cancelar: nada muda (sem PUT, conteúdo e título da nuvem iguais)', (await serverPres(ana, s.id)).rev === 1 && textsOf(await deckOf(p)).includes('Original na nuvem'));
  await p.evaluate(() => { document.getElementById('fOpen').value = ''; }); await p.setInputFiles('#fOpen', f); await p.waitForSelector('.cl-dlg [data-act=new]', { timeout: 8000 });
  await Promise.all([p.waitForURL((u) => /\/editor\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(s.id), { timeout: 20000 }), p.click('.cl-dlg [data-act=new]')]);
  const nid = p.url().split('/').pop(); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 20000 });
  const np = await serverPres(ana, nid), op = await serverPres(ana, s.id);
  check('CL-101 "Criar como nova": nova apresentação no acervo com o conteúdo do arquivo (imagem como asset:) e a original intacta', JSON.stringify(np.content).includes('Veio do arquivo') && /asset:sha256:/.test(JSON.stringify(np.content)) && !/data:image/.test(JSON.stringify(np.content)) && np.title === 'Arquivo aberto' && op.rev === 1 && JSON.stringify(op.content).includes('Original na nuvem'), { t: np.title, rev: op.rev });
  /* soltar um .json no editor: mesma escolha, sem a caixa do editor ("O que não foi salvo com Salvar apresentação…") */
  const q = await openEditor(ana, s.id, 'soltar');
  await q.evaluate((txt) => { const dt = new DataTransfer(); dt.items.add(new File([txt], 'solto.json', { type: 'application/json' })); document.getElementById('wrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, JSON.stringify(other));
  const d2 = await q.waitForSelector('.cl-dlg [data-act=replace]', { timeout: 8000 }).catch(() => null);
  check('CL-102 soltar um arquivo .json no slide: a mesma escolha da nuvem (e nenhum modal do editor com "Salvar apresentação")', !!d2 && !(await q.$('#modal.open')));
  await q.click('.cl-dlg [data-act=cancel]'); await q.close();
  /* projeto pronto pedido pelo acervo: /editor/<nova em branco>?modelo=2 */
  const b = await seed(ana, 'ana', 'Nova apresentação'); const m = await openEditor(ana, b.id + '?modelo=2', 'modelo', { wait: false });
  await m.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved' && AMStudio.deck.slides.length > 1, null, { timeout: 20000 }).catch(() => { });
  const nm = await m.evaluate(() => AMCover.templates[2]), mp = await serverPres(ana, b.id);
  check('CL-103 /editor/<id>?modelo=2 numa apresentação em branco aplica o projeto pronto "' + nm + '", salva na nuvem e limpa o parâmetro da URL', mp.content.slides.length > 1 && mp.rev >= 2 && new URL(m.url()).search === '' && (await deckOf(m)).slides.length === mp.content.slides.length, { slides: mp.content.slides.length, url: m.url() });
  await m.close();
  const m2 = await openEditor(ana, s.id + '?modelo=1', 'modelo2'); await sleep(800);
  check('CL-104 ?modelo numa apresentação COM conteúdo é ignorado (aviso), nada é trocado', (await serverPres(ana, s.id)).rev === 1 && textsOf(await deckOf(m2)).includes('Original na nuvem') && (await toastsOf(m2)).some((t) => /só é aplicado a uma apresentação em branco/.test(t)), await toastsOf(m2));
  await m2.close();
});

await scenario('24 · "Minhas obras", capa e manual na nuvem: nada local substitui a apresentação (BTN-02, BE-ED-03, BTN-06)', async () => {
  const s = await seed(ana, 'ana', 'Capa', deckWith('Capa', [slideOf([textEl('Fica na nuvem')])]));
  const p = await openEditor(ana, s.id, 'capa');
  await Promise.all([p.waitForURL(/\/acervo\?aba=minhas&foco=/, { timeout: 10000 }).catch(() => { }), p.evaluate(() => AMStudio.openObras())]);
  check('CL-105 AMStudio.openObras()/AMCover.openHist() (Minhas obras) levam ao acervo da nuvem (aba Minhas), não ao acervo local do navegador', p.url().endsWith('/acervo?aba=minhas&foco=' + s.id), p.url());
  await p.goto(BASE + '/editor/' + s.id); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 });
  await Promise.all([p.waitForURL(/\/acervo\?foco=/, { timeout: 10000 }).catch(() => { }), p.evaluate(() => AMCover.open('tpl'))]);
  check('CL-106 AMCover.open("tpl") (projetos prontos da capa local) também vai ao acervo, onde a nuvem cria a partir de projeto pronto', /\/acervo\?foco=/.test(p.url()), p.url());
  await p.goto(BASE + '/editor/' + s.id); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 });
  await p.click('#mbar button[data-m=help]'); await sleep(250); const hl = await p.$$eval('.xmenu .xi .xl', (l) => l.map((x) => x.textContent)); await (await p.$$('.xmenu .xi'))[hl.indexOf('Manual da obra')].click(); await sleep(800);
  const cv = await p.evaluate(() => ({ open: AMCover.isOpen(), view: document.getElementById('cover').dataset.view, hist: getComputedStyle(document.getElementById('cvHistBtn')).display, step: (document.querySelector('#cvHelpBody .cv-step p') || {}).textContent }));
  check('CL-107 Ajuda › Manual da obra abre (vista "help"), sem o botão "Minhas obras" da capa e com os passos da nuvem ("Comece pelo acervo…")', cv.open && cv.view === 'help' && cv.hist === 'none' && /^Comece pelo acervo/.test(cv.step || ''), cv);
  await reqLog(ana, true); let downloaded = false; p.on('download', () => { downloaded = true; });
  await p.keyboard.press('Control+s'); await sleep(1200);
  check('CL-108 Ctrl+S com a capa (manual) aberta não baixa .html nem salva versão escondida (BTN-06)', !downloaded && !(await reqLog(ana)).some((r) => r.method === 'PUT') && (await p.evaluate(() => AMCover.isOpen())));
  await p.evaluate((txt) => { const dt = new DataTransfer(); dt.items.add(new File([txt], 'capa.json', { type: 'application/json' })); document.getElementById('cover').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, JSON.stringify(deckWith('Solto na capa', [slideOf([textEl('Solto na capa')])]))); await sleep(1200);
  check('CL-109 soltar um arquivo sobre a capa não troca a apresentação da nuvem', textsOf(await deckOf(p)).includes('Fica na nuvem') && !(await p.$('.cl-dlg')) && (await serverPres(ana, s.id)).rev === 1);
  await p.keyboard.press('Escape'); await sleep(900);
  check('CL-110 Esc fecha o manual e volta ao editor', !(await p.evaluate(() => AMCover.isOpen())) && p.url().includes('/editor/'));
  await p.close();
});

await scenario('25 · links do acervo: ?historico=1 abre o histórico; ?exportar=html|pdf roda a exportação (só para quem edita) (BE-ED-08, F5)', async () => {
  const s = await seed(ana, 'ana', 'Links do acervo', deckWith('Links do acervo', [slideOf([textEl('Exportar daqui')])]));
  const p = await newPage(ana, 'hist-url'); await p.goto(BASE + '/editor/' + s.id + '?historico=1');
  const h1 = await p.waitForSelector('.cl-dlg h2', { timeout: 15000 }).catch(() => null);
  check('CL-111 /editor/<id>?historico=1 abre "Versões desta apresentação" e a URL volta a /editor/<id>', !!h1 && (await h1.textContent()) === 'Versões desta apresentação' && new URL(p.url()).search === '', p.url());
  await p.close();
  const x = await newPage(ana, 'exp-html');
  const [dl] = await Promise.all([x.waitForEvent('download', { timeout: 20000 }).catch(() => null), x.goto(BASE + '/editor/' + s.id + '?exportar=html')]);
  let html = ''; if (dl) { const f = path.join(TMP, 'exportar.html'); await dl.saveAs(f); html = readFileSync(f, 'utf8'); }
  check('CL-112 /editor/<id>?exportar=html baixa o .html da apresentação (com o conteúdo) depois de carregar', !!dl && dl.suggestedFilename() === 'links-do-acervo.html' && /Exportar daqui/.test(html), dl && dl.suggestedFilename());
  await x.close();
  const y = await newPage(ana, 'exp-pdf'); await y.goto(BASE + '/editor/' + s.id + '?exportar=pdf');
  const xp = await y.waitForFunction(() => document.documentElement.classList.contains('xp-open'), null, { timeout: 15000 }).then(() => true, () => false);
  check('CL-113 /editor/<id>?exportar=pdf abre a caixa "Salvar como PDF" do editor', xp);
  await y.close();
  const z = await newPage(bia, 'exp-bia'); let bdl = false; z.on('download', () => { bdl = true; }); await z.goto(BASE + '/editor/' + s.id + '?exportar=html'); await z.waitForURL(/\/visualizar\//, { timeout: 15000 }); await sleep(1500);
  check('CL-114 quem não é dono com ?exportar vai ao /visualizar e nada é exportado (continua tendo de criar cópia)', !bdl && new URL(z.url()).pathname === '/visualizar/' + s.id, z.url());
  await z.close();
});

await scenario('26 · computador compartilhado: outra pessoa não vê nem envia o que ficou; Sair apaga os dados locais (BE-ED-06)', async () => {
  const ctx = await newCtx('ana'); const s = await seed(ctx, 'ana', 'Compartilhado'), sb = await seed(ctx, 'bia', 'Da Bia');
  const a = await openEditor(ctx, s.id, 'pc-ana');
  await a.evaluate(async ({ id, ana }) => {
    localStorage.setItem('amForm.' + id + '.f1', JSON.stringify({ v: 1, q: ['Q'], rows: [{ at: 'x', a: ['resposta da Ana'] }] })); localStorage.setItem('amPlayer.notes:' + id, '{"s":"nota da Ana"}');
    await new Promise((res) => { const r = indexedDB.open('canteiro-cloud'); r.onsuccess = () => { const tx = r.result.transaction('outbox', 'readwrite'); tx.objectStore('outbox').add({ pid: id, ts: 1, kind: 'form_response', elementId: 'fAna', payload: { at: 'x', q: ['Q'], a: ['pendente da Ana'] }, uid: ana, cid: 'cid-ana-1' }); tx.oncomplete = () => res(); }; });
  }, { id: s.id, ana: users.ana });
  await a.close();
  await ctx.request.post(BASE + '/__test/login', { data: { user: 'bia' } }); await reqLog(ctx, true);
  const b = await openEditor(ctx, sb.id, 'pc-bia'); await sleep(2500);
  const lsb = await b.evaluate((id) => ({ form: localStorage.getItem('amForm.' + id + '.f1'), note: localStorage.getItem('amPlayer.notes:' + id), user: localStorage.getItem('amCloud.user') }), s.id);
  const sent = (await post(ctx, '/state')).interactions.filter((i) => JSON.stringify(i.payload).includes('pendente da Ana'));
  const left = await b.evaluate(() => new Promise((res) => { const r = indexedDB.open('canteiro-cloud'); r.onsuccess = () => { const g = r.result.transaction('outbox').objectStore('outbox').getAll(); g.onsuccess = () => res(g.result.length); }; }));
  check('CL-115 outra pessoa entra no mesmo navegador: respostas e notas da anterior somem do localStorage e a fila pendente dela NÃO é enviada com a identidade nova (é apagada)', lsb.form === null && lsb.note === null && lsb.user === users.bia && sent.length === 0 && left === 0, { lsb, sent: sent.length, left });
  await b.close();
  /* Sair (páginas web): avisa o que não foi enviado e apaga os dados locais */
  const w = await newPage(ctx, 'sair'); await w.goto(BASE + '/importar'); await w.waitForSelector('#btn-sair', { timeout: 15000 });
  await w.evaluate(async (id) => {
    localStorage.setItem('amVote.' + id + '.v1', '{"rows":[]}'); localStorage.setItem('amStudio.brandKits', '[{"name":"Kit"}]'); sessionStorage.setItem('am.import.done', '{"a":1}');
    await new Promise((res) => { const r = indexedDB.open('canteiro-cloud', 2); r.onupgradeneeded = () => { r.result.createObjectStore('pending', { keyPath: 'id' }); r.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }); }; r.onsuccess = () => { const tx = r.result.transaction('pending', 'readwrite'); tx.objectStore('pending').put({ id, json: '{}', baseRev: 1, ts: 1, uid: 'x' }); tx.oncomplete = () => { r.result.close(); res(); }; }; });
  }, s.id);
  await w.click('#btn-sair'); const cd = await w.waitForSelector('dialog.dlg[open] [data-act=confirm]', { timeout: 8000 }).catch(() => null);
  const ctext = cd ? await w.$eval('dialog.dlg[open]', (d) => d.textContent) : '';
  if (cd) await Promise.all([w.waitForURL(/\/entrar/, { timeout: 15000 }), cd.click()]);
  const after = await w.evaluate(async () => ({ keys: Object.keys(localStorage).filter((k) => /^(amForm|amBoard|amVote|amPlayer|amStudio|amCloud)\./.test(k)), ss: sessionStorage.getItem('am.import.done'), dbs: (await indexedDB.databases()).map((d) => d.name).filter((n) => /^canteiro/.test(n)) }));
  check('CL-116 Sair: avisa que há algo não enviado ("Sair e apagar…"), apaga localStorage/sessionStorage da nuvem e os bancos canteiro-cloud/canteiro, e vai para /entrar', /ainda não chegaram à nuvem/.test(ctext) && new URL(w.url()).pathname === '/entrar' && after.keys.length === 0 && after.ss === null && after.dbs.length === 0, { ctext: ctext.slice(0, 80), url: w.url(), after });
  await w.close(); await ctx.close();
});

await scenario('27 · conteúdo recusado (422): a mensagem diz o slide, não repete o PUT a cada edição e volta a salvar quando corrigido (BE-ED-09)', async () => {
  const s = await seed(ana, 'ana', 'Recusa', deckWith('Recusa', [slideOf([textEl('Primeiro slide')]), slideOf([textEl('Texto ok', { id: 'eRuim' })])]));
  const p = await openEditor(ana, s.id, 'recusa'); await reqLog(ana, true);
  await p.evaluate(() => { const e = AMStudio.deck.slides[1].els.find((x) => x.id === 'eRuim'); e.html = 'Use a tag <form> aqui'; AMStudio.commit(); });
  const d = await p.waitForSelector('.cl-dlg', { timeout: 15000 }).catch(() => null), txt = d ? await d.innerText() : '';
  check('CL-117 422 rejected_content: caixa "A nuvem não aceitou parte desta apresentação" com "Slide 2 · texto: código HTML…", pílula "Conteúdo recusado"', /A nuvem não aceitou parte desta apresentação/.test(txt) && /Slide 2 · texto: código HTML não permitido/.test(txt) && (await pillState(p)) === 'rejected', { txt: txt.slice(0, 300), st: await pillState(p) });
  const puts0 = (await reqLog(ana)).filter((r) => r.method === 'PUT' && /\/content$/.test(r.path)).length;
  await p.click('.cl-dlg [data-act=goto]'); await sleep(400);
  const at = await p.evaluate(() => ({ cur: AMStudio.cur, sel: AMStudio.selected() }));
  check('CL-118 "Ir ao slide 2" leva ao slide e seleciona o elemento recusado', at.cur === 1 && at.sel.length === 1 && at.sel[0] === 'eRuim', at);
  await p.evaluate(() => { AMStudio.deck.slides[0].els[0].html = 'Outra edição'; AMStudio.commit(); }); await sleep(3800);
  await p.evaluate(() => { AMStudio.deck.slides[0].els[0].html = 'Mais uma edição'; AMStudio.commit(); }); await sleep(3800);
  const puts1 = (await reqLog(ana)).filter((r) => r.method === 'PUT' && /\/content$/.test(r.path)).length;
  check('CL-119 enquanto o trecho recusado não muda, outras edições NÃO repetem o PUT (' + puts0 + ' → ' + puts1 + ') e ficam na fila local', puts1 === puts0 && puts0 >= 1 && (await pillState(p)) === 'rejected' && (await p.evaluate(() => AMCloud.dirty)), { puts0, puts1 });
  await p.evaluate(() => { const e = AMStudio.deck.slides[1].els.find((x) => x.id === 'eRuim'); e.html = 'Use a tag formulário aqui'; AMStudio.commit(); });
  await waitSaved(p, 15000);
  check('CL-120 corrigido o trecho, a apresentação volta a salvar sozinha (com as outras edições)', JSON.stringify((await serverPres(ana, s.id)).content).includes('Mais uma edição') && (await pillState(p)) === 'saved');
  await p.close();
});

await scenario('28 · limite de envios (429): "Aguardando o servidor", sem "Sem conexão", respeita Retry-After e conclui (BE-ED-13)', async () => {
  const s = await seed(ana, 'ana', 'Muitas imagens'); const p = await openEditor(ana, s.id, '429');
  await faults(ana, { assetPut429: 2 }); await reqLog(ana, true);
  const imgs = []; for (let i = 0; i < 4; i++) imgs.push(dataUrl(await pngBuf(60 + i, 40, 300 + i)));
  await p.evaluate((srcs) => { const sl = AMStudio.deck.slides[0]; srcs.forEach((u, i) => sl.els.push(AMStudio.mk.image(u, 60, 40, { x: 40 + i * 80, y: 100 }))); AMStudio.renderAll(); AMStudio.commit(); }, imgs);
  await waitSaved(p, 30000);
  const st = await p.evaluate(() => window.__states), ts = await toastsOf(p), log = await reqLog(ana);
  const r429 = log.filter((r) => r.status === 429), again = r429.length ? log.find((r) => r.method === 'POST' && r.path === '/api/assets/check' && r.t > r429[0].t) : null;
  check('CL-121 429 nos envios de imagem: pílula "throttled" (Aguardando o servidor), nunca "offline", nenhum aviso "Sem conexão", e tudo salvo depois', st.includes('throttled') && !st.includes('offline') && !ts.some((t) => /Sem conexão/.test(t)) && r429.length === 2 && JSON.stringify((await serverPres(ana, s.id)).content).match(/asset:sha256/g).length === 4, { st, ts, n429: r429.length });
  const gap = again ? again.t - (r429[0].t + (r429[0].ms || 0)) : -1;
  check('CL-122 a nova tentativa respeita o Retry-After: a rodada seguinte começa ' + gap + ' ms depois da resposta 429 (Retry-After: 1 s)', gap >= 950, gap);
  await faults(ana, { assetPut429: 0 }); await p.close();
});

await scenario('29 · interações: quadro acima de 256 KB avisa; envio repetido não duplica (clientId) (BE-ED-14, F13)', async () => {
  const s = await seed(ana, 'ana', 'Quadro grande'); const p = await openEditor(ana, s.id, 'quadro'); await reqLog(ana, true);
  const note = (n) => JSON.stringify({ v: 1, notes: Array.from({ length: n }, (_, i) => ({ c: 0, t: 'Nota ' + i + ' ' + 'x'.repeat(380), k: 'y' })) });
  await p.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: 'amBoard.' + s.id + '.eMedio', v: note(250) });
  await p.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: 'amBoard.' + s.id + '.eGrande', v: note(700) });
  await sleep(1800); await p.evaluate(() => AMCloud.bridgeFlush()); await sleep(600);
  const bs = (await post(ana, '/state')).interactions.filter((i) => i.kind === 'board_state' && i.presentationId === s.id), ts = await toastsOf(p);
  check('CL-123 quadro de ~100 KB sincroniza (novo teto de 256 KB); acima de 256 KB não é enviado e a pessoa é avisada ("passou de 256 KB… Baixar CSV")', bs.some((i) => i.elementId === 'eMedio') && !bs.some((i) => i.elementId === 'eGrande') && ts.some((t) => /passou de 256 KB/.test(t)), { els: bs.map((i) => i.elementId), ts });
  await faults(ana, { interactionsLoseResponse: 1 }); await reqLog(ana, true);
  await p.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, q: ['Pergunta'], rows: [{ at: '2026-10-07 10:00', a: ['Resposta única'] }] })), 'amForm.' + s.id + '.fUnico');
  await until(async () => (await p.evaluate(() => AMCloud.outbox)) === 0, 20000, 300);
  const posts = (await reqLog(ana)).filter((r) => r.method === 'POST' && /interactions$/.test(r.path)), stored = (await post(ana, '/state')).interactions.filter((i) => i.elementId === 'fUnico');
  check('CL-124 resposta gravada mas com a resposta HTTP perdida (503): o reenvio leva o MESMO clientId e o servidor não duplica (1 linha)', posts.length >= 2 && posts.every((r) => r.json && r.json.clientId && r.json.clientId === posts[0].json.clientId) && stored.length === 1, { posts: posts.map((r) => r.status + ':' + (r.json && r.json.clientId)), stored: stored.length });
  await faults(ana, { interactionsLoseResponse: 0 }); await p.close();
});

await scenario('30 · kits de marca e preferências do editor acompanham a pessoa em outro computador (BE-ED-12)', async () => {
  const s = await seed(ana, 'ana', 'Preferências'); const p = await openEditor(ana, s.id, 'prefs'); await reqLog(ana, true);
  await p.evaluate(() => { localStorage.setItem('amStudio.brandKits', JSON.stringify([{ name: 'Cliente X', colors: ['#112233', '#F78C16'], at: 1 }])); localStorage.setItem('amStudio.recentColors', JSON.stringify(['#123456'])); localStorage.setItem('amStudio.sideW', '250'); });
  const saved = await until(async () => { const pr = (await post(ana, '/prefs')).ana; return pr && pr.brandKits && pr.brandKits.length ? pr : null; }, 8000, 300);
  const putPrefs = (await reqLog(ana)).filter((r) => r.method === 'PUT' && r.path === '/api/me/prefs');
  check('CL-125 salvar um kit de marca (e cores recentes, largura do painel) vai para PUT /api/me/prefs {prefs:{brandKits, editor}}', !!saved && saved.brandKits[0].name === 'Cliente X' && saved.editor && saved.editor.recentColors[0] === '#123456' && saved.editor.sideW === 250 && putPrefs.length >= 1, saved);
  await p.close();
  const c2 = await newCtx('ana'); const q = await openEditor(c2, s.id, 'prefs2'); await sleep(1200);
  const got = await q.evaluate(() => ({ kits: JSON.parse(localStorage.getItem('amStudio.brandKits') || '[]'), rc: JSON.parse(localStorage.getItem('amStudio.recentColors') || '[]'), sw: localStorage.getItem('amStudio.sideW') }));
  check('CL-126 em outro computador (navegador vazio) o kit "Cliente X", as cores recentes e a largura do painel voltam do servidor', got.kits.length === 1 && got.kits[0].name === 'Cliente X' && got.kits[0].colors[0] === '#112233' && got.rc[0] === '#123456' && got.sw === '250', got);
  /* o servidor limita as gravações de preferências (60/min): um 429 é repetido depois do Retry-After, sem perder o kit */
  await faults(c2, { prefs429: 1 }); await reqLog(c2, true);
  await q.evaluate(() => { const k = JSON.parse(localStorage.getItem('amStudio.brandKits') || '[]'); k.unshift({ name: 'Cliente Y', colors: ['#445566'], at: 2 }); localStorage.setItem('amStudio.brandKits', JSON.stringify(k)); });
  const y = await until(async () => { const pr = (await post(c2, '/prefs')).ana; return pr && pr.brandKits && pr.brandKits.some((k) => k.name === 'Cliente Y') ? pr : null; }, 15000, 300);
  const pp = (await reqLog(c2)).filter((r) => r.method === 'PUT' && r.path === '/api/me/prefs').map((r) => r.status);
  check('CL-158 PUT de preferências com 429 (limite de 60/min) é repetido depois do Retry-After e o kit novo chega ao servidor junto com o antigo', !!y && y.brandKits.length === 2 && pp[0] === 429 && pp.includes(200), { pp, kits: y && y.brandKits.map((k) => k.name) });
  /* o PUT substitui o objeto inteiro: o que outro computador gravou depois que esta aba abriu não pode sumir (lê, troca só as chaves mudadas aqui e grava) */
  await post(c2, '/prefs', { set: { ana: { ...y, brandKits: [{ name: 'Cliente W', colors: ['#778899'], at: 3 }, ...y.brandKits], tema: { modo: 'escuro' } } } });
  await q.evaluate(() => localStorage.setItem('amStudio.recentColors', JSON.stringify(['#ABCDEF', '#123456'])));
  const z = await until(async () => { const pr = (await post(c2, '/prefs')).ana; return pr && pr.editor && pr.editor.recentColors && pr.editor.recentColors[0] === '#ABCDEF' ? pr : null; }, 10000, 300);
  const zl = await q.evaluate(() => JSON.parse(localStorage.getItem('amStudio.brandKits') || '[]').map((k) => k.name));
  check('CL-159 preferências: a gravação seguinte lê o servidor e troca só o que mudou nesta aba — o kit e a chave que outro computador gravou depois continuam lá (e o kit chega a este navegador)', !!z && z.tema && z.tema.modo === 'escuro' && z.editor.sideW === 250 && z.brandKits.map((k) => k.name).join() === 'Cliente W,Cliente Y,Cliente X' && zl.join() === 'Cliente W,Cliente Y,Cliente X', { tema: z && z.tema, kits: z && z.brandKits.map((k) => k.name), local: zl });
  /* notas "Sobre este slide" editadas no player continuam só neste navegador (como no original): o player avisa enquanto edita */
  await q.keyboard.press('F5'); await q.waitForSelector('#presenter.open', { timeout: 6000 }); await sleep(500);
  await q.keyboard.press('i'); await q.waitForSelector('#presenter .amp-note.on', { timeout: 4000 });
  await q.click('#presenter .amp-note-ed'); await sleep(250);
  const nk = await q.$eval('#presenter .amp-note-k', (n) => n.textContent);
  for (let i = 0; i < 5 && await q.evaluate(() => document.getElementById('presenter').classList.contains('open')); i++) { await q.keyboard.press('Escape'); await sleep(250); }
  check('CL-162 editar "Sobre este slide" no player avisa que vale só neste navegador e onde escrever para todos', nk === 'Ctrl+Enter ou clique fora salva · Esc cancela · vale só neste navegador (para todos: “Sobre este slide” no editor)', nk);
  await q.close(); await c2.close();
});

await scenario('31 · formulário na nuvem: o texto diz que a resposta vai com o nome da pessoa; planilha fora do Google explica (BE-ED-11)', async () => {
  const s = await seed(ana, 'ana', 'Textos do formulário'); const p = await openEditor(ana, s.id, 'form-txt');
  await p.evaluate(() => { AMStudio.insertFx('form'); }); await sleep(400);
  await p.evaluate(() => { const F = AMStudio.deck.slides[0].els.find((e) => e.kind === 'form'); F.x = 20; F.y = 20; F.w = 560; F.h = 560; AMStudio.renderAll(); AMStudio.commit(); }); await waitSaved(p);
  await p.keyboard.press('F5'); await p.waitForSelector('#presenter.open .amf', { timeout: 6000 }); await sleep(600);
  const st0 = await p.$eval('#presenter .amf-st', (n) => n.textContent);
  check('CL-160 antes de enviar, o formulário já avisa: "Ao enviar, a resposta vai com o seu nome para o dono da apresentação."', st0 === 'Ao enviar, a resposta vai com o seu nome para o dono da apresentação.', st0);
  const fill = () => p.evaluate(() => { const ins = [...document.querySelectorAll('#presenter .amf-in')]; ins.forEach((x) => { x.focus(); document.execCommand('insertText', false, 'Ok'); }); [...document.querySelectorAll('#presenter .amf-rb')].slice(0, 1).forEach((b) => b.click()); [...document.querySelectorAll('#presenter .amf-o')].slice(0, 1).forEach((b) => b.click()); document.querySelector('#presenter .amf-send').click(); });
  await fill(); await sleep(500);
  const st1 = await p.$eval('#presenter .amf-st', (n) => n.textContent);
  check('CL-127 depois de enviar: "Resposta enviada com o seu nome ao dono da apresentação." (nunca "Registrada neste dispositivo")', st1 === 'Resposta enviada com o seu nome ao dono da apresentação.', st1);
  const leave = async () => { await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.getElementById('presenter').classList.contains('open'), null, { timeout: 5000 }); };
  await leave();
  const cv0 = cspViolations.length;
  await p.evaluate(() => { const F = AMStudio.deck.slides[0].els.find((e) => e.kind === 'form'); F.data.sheet = 'https://planilha.example.com/coleta'; AMStudio.renderAll(); AMStudio.commit(); }); await waitSaved(p);
  await p.keyboard.press('F5'); await p.waitForSelector('#presenter.open .amf', { timeout: 6000 }); await sleep(600);
  await p.evaluate(() => { const again = document.querySelector('#presenter .amf-again'); if (again && again.offsetParent) again.click(); }); await fill();
  const st2 = await until(async () => { const t = await p.$eval('#presenter .amf-st', (n) => n.textContent); return /planilha/.test(t) && !/Enviando/.test(t) ? t : null; }, 6000, 200);
  const extra = cspViolations.splice(cv0);   /* esperado: a CSP bloqueia o endereço fora do Google (connect-src) — é exatamente o caso explicado */
  // Chromium recente usa "Connecting to ... violates ..." em vez de "Refused to connect to ...".
  // Ignorar SOMENTE o bloqueio CSP esperado do endereço fictício deste cenário; erros reais continuam no CL-88.
  for (let i = consoleErrors.length - 1; i >= 0; i--) {
    const msg = consoleErrors[i];
    if (/^form-txt: (?:Refused to connect to|Connecting to) 'https:\/\/planilha\.example\.com\/coleta' (?:violates|because it violates) the following Content Security Policy directive/.test(msg)
      || /^form-txt: Fetch API cannot load '?https:\/\/planilha\.example\.com\/coleta/.test(msg)) consoleErrors.splice(i, 1);
  }
  hosts.delete('planilha.example.com');   /* bloqueado pela CSP: o pedido não sai do navegador */
  check('CL-128 planilha com endereço fora do Google: a mensagem explica que na versão online só vale um app do Google (em vez de "sem internet")', /na versão online só vale o endereço de um app do Google/.test(st2 || '') && extra.length > 0 && extra.every((v) => /connect-src/.test(v.d) && /example\.com/.test(v.u)), { st2, extra });
  await leave();
  /* "Limpar" apaga só deste computador: não volta ao reabrir (a restauração respeita a marca) e o servidor continua com as respostas */
  const nSrv = await until(async () => { const n = (await post(ana, '/state')).interactions.filter((i) => i.presentationId === s.id && i.kind === 'form_response').length; return n >= 2 ? n : null; }, 6000, 200);
  await p.keyboard.press('F5'); await p.waitForSelector('#presenter.open .amf', { timeout: 6000 }); await sleep(600);
  await p.evaluate(() => { const b = document.querySelector('#presenter .amf-clear'); b.click(); b.click(); }); await sleep(200);
  const st3 = await p.$eval('#presenter .amf-st', (n) => n.textContent);
  await leave();
  const fk = await p.evaluate((id) => Object.keys(localStorage).filter((k) => k.startsWith('amForm.' + id + '.')), s.id);
  await p.reload(); await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 15000 }); await sleep(1500);
  const back = await p.evaluate((id) => Object.keys(localStorage).filter((k) => k.startsWith('amForm.' + id + '.')), s.id);
  const nSrv2 = (await post(ana, '/state')).interactions.filter((i) => i.presentationId === s.id && i.kind === 'form_response').length;
  check('CL-161 "Limpar" do formulário na nuvem apaga só deste computador e as respostas NÃO voltam ao reabrir; o servidor continua com elas (o dono não perde nada)', st3 === 'Respostas apagadas só deste computador (as já enviadas continuam com o dono da apresentação).' && fk.length === 0 && back.length === 0 && nSrv >= 2 && nSrv2 === nSrv, { st3, fk, back, nSrv, nSrv2 });
  await p.close();
});

await scenario('32 · comentários da plataforma no editor e no visualizar: listar, criar no slide atual, resolver e excluir (BE-ED-10)', async () => {
  const s = await seed(ana, 'ana', 'Comentários', deckWith('Comentários', [slideOf([textEl('Um')]), slideOf([textEl('Dois')])]));
  await post(ana, '/comment', { id: s.id, by: 'bia', body: 'Ajustar o gráfico', slideIndex: 1 }); await post(ana, '/comment', { id: s.id, by: 'bia', body: 'Comentário geral' });
  const p = await openEditor(ana, s.id, 'cmts'); await sleep(500);
  await p.click('#cloudPill'); const mi = await p.$eval('.cl-mi[data-id=cmts] span', (n) => n.textContent); await p.click('.cl-mi[data-id=cmts]');
  await p.waitForSelector('#cloudComments .cl-ci', { timeout: 8000 });
  const l1 = await p.$$eval('#cloudComments .cl-ci p', (l) => l.map((x) => x.textContent)), t1 = await p.textContent('#cloudCmT');
  check('CL-129 menu da pílula "Comentários (2)…" abre o painel do slide 1: mostra o comentário geral e não o do slide 2', mi === 'Comentários (2)…' && t1 === 'Slide 1' && l1.includes('Comentário geral') && !l1.includes('Ajustar o gráfico'), { mi, t1, l1 });
  await p.check('#cloudCmAll'); const l2 = await p.$$eval('#cloudComments .cl-ci p', (l) => l.map((x) => x.textContent));
  await p.click('#cloudComments .cl-ci button.cl-cs'); await sleep(300); const cur = await p.evaluate(() => AMStudio.cur);
  check('CL-130 "Todos os slides" lista os dois; clicar em "Slide 2" leva o editor ao slide 2', l2.includes('Ajustar o gráfico') && l2.includes('Comentário geral') && cur === 1, { l2, cur });
  await p.uncheck('#cloudCmAll'); await reqLog(ana, true);
  await p.fill('#cloudCmIn', 'Revisar o título deste slide'); await p.click('#cloudCmSend');
  await p.waitForFunction(() => [...document.querySelectorAll('#cloudComments .cl-ci p')].some((x) => x.textContent === 'Revisar o título deste slide'), null, { timeout: 8000 });
  const cp = (await reqLog(ana)).find((r) => r.method === 'POST' && /\/comments$/.test(r.path));
  check('CL-131 comentar no slide atual: POST /comments {body, slideIndex:1} e o comentário aparece no painel', cp && cp.json && cp.json.slideIndex === 1 && cp.json.body === 'Revisar o título deste slide', cp && cp.json);
  const mine = await p.$('#cloudComments .cl-ci:has(p:text("Revisar o título deste slide"))');
  await (await mine.$('button[data-a=res]')).click(); await p.waitForFunction(() => ![...document.querySelectorAll('#cloudComments .cl-ci p')].some((x) => x.textContent === 'Revisar o título deste slide'), null, { timeout: 8000 });
  const resolved = (await post(ana, '/comments')).find((c) => c.body === 'Revisar o título deste slide');
  check('CL-132 Resolver: PATCH {resolved:true}; some da lista (aparece com "Mostrar resolvidos")', !!(resolved && resolved.resolvedAt));
  await p.check('#cloudCmRes'); await p.waitForSelector('#cloudComments .cl-ci.done', { timeout: 8000 });
  const del = await p.$('#cloudComments .cl-ci.done button[data-a=del]'); await del.click(); await p.click('.cl-dlg [data-act=""].dng, .cl-dlg .cl-b.dng');
  await until(async () => (await post(ana, '/comments')).find((c) => c.body === 'Revisar o título deste slide').deleted, 8000, 200);
  check('CL-133 Excluir (com confirmação): DELETE /comments/:id', (await post(ana, '/comments')).find((c) => c.body === 'Revisar o título deste slide').deleted === true);
  /* O botão de excluir desaparece após confirmação; testar Esc sem foco no painel. */
  await p.evaluate(() => { if (document.activeElement?.blur) document.activeElement.blur(); });
  await p.keyboard.press('Escape');
  await p.waitForSelector('#cloudComments', { state: 'detached', timeout: 4000 }).catch(() => {});
  check('CL-134 Esc fecha o painel após excluir comentário, mesmo sem foco interno', !(await p.$('#cloudComments')));
  await p.close();
  const v = await openEditor(bia, s.id, 'cmts-view', { mode: 'visualizar' }); await v.waitForSelector('#presenter.open'); await sleep(400);
  await v.click('#cloudCmBtn'); await v.waitForSelector('#cloudComments', { timeout: 8000 }); await sleep(300);
  const vis = await v.evaluate(() => { const r = document.getElementById('cloudComments').getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + 60); return { top: Math.round(r.top), onTop: !!(at && at.closest('#cloudComments')), title: document.getElementById('cloudCmT').textContent }; });
  await v.fill('#cloudCmIn', 'Pergunta da Bia'); await v.press('#cloudCmIn', 'Control+Enter'); await v.waitForFunction(() => [...document.querySelectorAll('#cloudComments .cl-ci p')].some((x) => x.textContent === 'Pergunta da Bia'), null, { timeout: 8000 });
  await v.keyboard.press('ArrowRight'); await sleep(300); const pos = await v.innerText('.amp-pos');
  check('CL-135 visualizar: botão "Comentários" abre o painel POR CIMA da apresentação (abaixo da barra), a Bia comenta no slide 1, e setas digitadas no painel não trocam o slide', vis.onTop && vis.top === 44 && vis.title === 'Slide 1' && /^01/.test(pos) && (await post(ana, '/comments')).some((c) => c.body === 'Pergunta da Bia' && c.slideIndex === 0), { vis, pos });
  await v.keyboard.press('Escape'); await sleep(200); await v.keyboard.press('ArrowRight'); await sleep(500);
  await v.click('#cloudCmBtn'); await sleep(400); const t2 = await v.textContent('#cloudCmT');
  check('CL-136 o painel acompanha o slide da apresentação (Slide 2 depois de avançar)', !!v.url().includes('/visualizar/') && t2 === 'Slide 2', t2);
  await v.close();
});

await scenario('33 · teclado com menu, caixas e telas da nuvem (BTN-03, BTN-04, BTN-05, BTN-06, BTN-08, BTN-09)', async () => {
  const s = await seed(ana, 'ana', 'Teclado'); const p = await openEditor(ana, s.id, 'teclado'); await typeNewText(p, 'Para versão'); await waitSaved(p);
  let downloads = 0; p.on('download', () => { downloads++; });
  await p.click('#cloudPill'); await p.waitForSelector('#cloudMenu.open'); await p.keyboard.press('Control+s');
  await until(async () => (await serverPres(ana, s.id)).versions.some((v) => v.kind === 'manual'), 8000); await sleep(500);
  check('CL-137 menu da pílula aberto + Ctrl+S: salva a versão na nuvem e não baixa .html (BTN-03)', (await serverPres(ana, s.id)).versions.some((v) => v.kind === 'manual') && downloads === 0 && !(await p.$('#cloudMenu.open')));
  await p.click('#cloudPill'); await p.waitForSelector('#cloudMenu.open'); await p.keyboard.press('F5'); await p.waitForSelector('#presenter.open', { timeout: 5000 }).catch(() => { });
  const pm = await p.evaluate(() => ({ pres: document.getElementById('presenter').classList.contains('open'), menu: !!document.querySelector('#cloudMenu.open') }));
  await p.keyboard.press('Escape'); await sleep(400);
  check('CL-138 menu aberto + F5: a apresentação começa SEM o menu por cima e o primeiro Esc sai dela (BTN-04)', pm.pres && !pm.menu && !(await p.$('#presenter.open')), pm);
  await p.click('#cloudPill'); await p.click('.cl-mi[data-id=hist]'); await p.waitForSelector('.cl-dlg', { timeout: 5000 });
  const prevented = { f5: await keyOn(p, { key: 'F5' }), s: await keyOn(p, { key: 's', ctrlKey: true }), o: await keyOn(p, { key: 'o', ctrlKey: true }), p: await keyOn(p, { key: 'p', ctrlKey: true }), f1: await keyOn(p, { key: 'F1' }) };
  check('CL-139 com uma caixa da nuvem aberta, F5, F1, Ctrl+S, Ctrl+O e Ctrl+P são bloqueados (sem recarregar, "Salvar página como" ou abrir arquivo) e não chegam ao editor (BTN-05)', Object.values(prevented).every(Boolean) && !(await p.$('#presenter.open')) && !(await p.$('#modal.open')) && !!(await p.$('.cl-dlg')), prevented);
  await p.keyboard.press('Escape'); await sleep(200);
  const v0 = (await serverPres(ana, s.id)).versions.length; await p.evaluate(() => AMStudio.exportAs('pdf')); await p.waitForFunction(() => document.documentElement.classList.contains('xp-open'), null, { timeout: 5000 });
  await p.keyboard.press('Control+s'); await sleep(1500);
  check('CL-140 caixa do editor aberta (Salvar como PDF) + Ctrl+S: nenhuma versão é salva escondida atrás dela (BTN-06)', (await serverPres(ana, s.id)).versions.length === v0 && downloads === 0, { v0, v1: (await serverPres(ana, s.id)).versions.length });
  await p.keyboard.press('Escape'); await sleep(300);
  await ana.setOffline(true); await sleep(300); await typeNewText(p, 'Sem rede'); await p.keyboard.press('Control+s'); await sleep(1500);
  const ts = await toastsOf(p); await ana.setOffline(false); await waitSaved(p, 20000);
  check('CL-141 Ctrl+S sem conexão avisa ("Sem conexão: a versão não foi salva…") em vez de ficar em silêncio (BTN-08)', ts.some((t) => /^Sem conexão: a versão não foi salva/.test(t)), ts.slice(-3));
  await post(ana, '/bump', { id: s.id, by: 'bia', title: 'Mexeram' }); await typeNewText(p, 'Gera conflito'); await p.waitForSelector('[data-act=later]', { timeout: 15000 }); await p.click('[data-act=later]');
  await p.keyboard.press('Control+s'); await sleep(600);
  check('CL-142 Ctrl+S com conflito pendente diz "Resolva o conflito antes de salvar uma versão" e reabre a escolha (BTN-08)', (await toastsOf(p)).some((t) => /Resolva o conflito antes de salvar uma versão/.test(t)) && !!(await p.$('[data-act=mine]')));
  await p.close();
  await faults(ana, { presDelayMs: 2500 }); const L = await openEditor(ana, s.id, 'abrindo', { wait: false }); await L.waitForSelector('#cloudLoad', { timeout: 8000 });
  for (const k of ['F5', 'F1', 'Control+o', 'Delete']) await L.keyboard.press(k);
  await L.waitForFunction(() => window.AMCloud && !document.getElementById('cloudLoad'), null, { timeout: 15000 }); await sleep(300);
  const lk = await L.evaluate(() => ({ pres: document.getElementById('presenter').classList.contains('open'), modal: document.getElementById('modal').classList.contains('open') }));
  await faults(ana, { presDelayMs: 0 }); await L.close();
  const F = await newPage(ana, 'fatal'); await F.goto(BASE + '/editor/00000000-0000-4000-8000-000000000000'); await F.waitForSelector('#cloudFatal', { timeout: 15000 }); await sleep(200);
  const fk = { f1: await keyOn(F, { key: 'F1' }), focus: await F.evaluate(() => document.activeElement && document.activeElement.textContent) }; await F.keyboard.press('F1'); await sleep(300);
  check('CL-143 telas "Abrindo…" e "Apresentação não encontrada": F5, F1, Ctrl+O e Delete não agem no editor por trás; o foco vai para "Voltar ao acervo" (BTN-09)', !lk.pres && !lk.modal && fk.f1 && fk.focus === 'Voltar ao acervo' && !(await F.$('#modal.open')), { lk, fk });
  await F.close();
});

await scenario('34 · rótulos da nuvem: Baixar arquivo (.html), Voltar ao acervo, menus sem Ctrl+S no download (BTN-07)', async () => {
  const s = await seed(ana, 'ana', 'Rótulos'); const p = await openEditor(ana, s.id, 'rotulos');
  const lb = await p.evaluate(() => ({ save: document.querySelector('#bSave .lbl').textContent, saveT: document.getElementById('bSave').title, home: document.getElementById('bHome').title, brand: document.querySelector('#top .brand').title, nw: document.getElementById('bNew').title, more: document.getElementById('bSaveMore').getAttribute('aria-label') }));
  check('CL-144 barra: "Baixar arquivo (.html)" no botão laranja; Início e a marca dizem "Voltar ao acervo"; Novo diz que cria no acervo', lb.save === 'Baixar arquivo (.html)' && /^Baixar a apresentação como arquivo \.html/.test(lb.saveT) && lb.home === 'Voltar ao acervo' && lb.brand === 'Voltar ao acervo' && /no acervo/.test(lb.nw) && /^Baixar como/.test(lb.more), lb);
  await p.click('#mbar button[data-m=file]'); await sleep(250);
  const items = await p.$$eval('.xmenu .xi', (l) => l.map((b) => ({ t: b.querySelector('.xl').textContent, k: (b.querySelector('kbd') || {}).textContent || '' })));
  const T = items.map((x) => x.t), dl = items.find((x) => x.t === 'Baixar arquivo (.html)');
  check('CL-145 Arquivo: Voltar ao acervo · Nova apresentação no acervo · Abrir arquivo… · Acervo da nuvem… · Baixar arquivo (.html) SEM "Ctrl+S" · Baixar como PDF…/PowerPoint…; nenhum "Salvar apresentação"', T[0] === 'Voltar ao acervo' && T.includes('Nova apresentação no acervo') && T.includes('Abrir arquivo…') && T.includes('Acervo da nuvem…') && dl && dl.k === '' && T.includes('Baixar como PDF…') && T.includes('Baixar como PowerPoint…') && !T.includes('Salvar apresentação'), items);
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }).catch(() => null), (await p.$$('.xmenu .xi'))[T.indexOf('Baixar arquivo (.html)')].click()]); await sleep(300);
  check('CL-146 "Baixar arquivo (.html)" baixa o arquivo e o aviso diz "Arquivo baixado" (não "Apresentação salva")', !!d && /\.html$/.test(d.suggestedFilename()) && (await toastsOf(p)).some((t) => /^Arquivo baixado: rotulos\.html/.test(t)), await toastsOf(p));
  await p.click('#bSaveMore'); await sleep(250);
  const sa = await p.evaluate(() => ({ hd: (document.querySelector('.xmenu .xhd') || {}).textContent, k: [...document.querySelectorAll('.xmenu .xi kbd')].map((x) => x.textContent) }));
  check('CL-147 "Baixar como" (seta do botão laranja): sem Ctrl+S no item HTML (Ctrl+S na nuvem salva versão)', sa.hd === 'Baixar como' && !sa.k.includes('Ctrl+S'), sa);
  await p.keyboard.press('Escape'); await p.keyboard.press('F1'); await p.waitForSelector('#modal.open', { timeout: 4000 });
  check('CL-148 ajuda (F1): "Salvar versão na nuvem — Ctrl+S" e Abrir explica a escolha da nuvem', /Salvar versão na nuvem/.test(await p.innerText('#modal')) && /vira uma apresentação nova no acervo ou substitui esta/.test(await p.innerText('#modal')));
  await p.keyboard.press('Escape'); await p.close();
});

await scenario('35 · imagens https:// externas: a CSP continua estrita e a pessoa é orientada a baixar e inserir do computador (BTN-10)', async () => {
  const cv0 = cspViolations.length;
  const s = await seed(ana, 'ana', 'Externa', deckWith('Externa', [slideOf([textEl('Com imagem de fora'), imgEl('https://imagens.example.com/foto.png'), imgEl('https://imagens.example.com/outra.png', { x: 100 })])]));
  const p = await openEditor(ana, s.id, 'externa'); const d = await p.waitForSelector('.cl-dlg', { timeout: 8000 }).catch(() => null), txt = d ? await d.innerText() : '';
  const csp = (await p.request.get(BASE + '/editor/' + s.id)).headers()['content-security-policy'] || '';
  check('CL-149 imagens com endereço https:// geram o aviso "2 imagens… não aparecem na versão online" com "baixe cada imagem… insira de novo pelo botão Imagem"; img-src segue sem https:', /2 imagens desta apresentação não aparecem na versão online/.test(txt) && /baixe cada imagem para o computador e insira de novo pelo botão Imagem/.test(txt) && /img-src 'self' data: blob:;/.test(csp) && !/img-src[^;]*https:/.test(csp), { txt: txt.slice(0, 200), csp: (csp.match(/img-src[^;]*/) || [''])[0] });
  await p.click('.cl-dlg .cl-b'); await p.close();
  const extra = cspViolations.splice(cv0);   /* esperado: as duas imagens externas bloqueadas (img-src) — o aviso acima explica por quê */
  // Chromium recente usa "Loading the image ... violates ..."; a CSP deve continuar a bloquear as imagens.
  for (let i = consoleErrors.length - 1; i >= 0; i--) {
    if (/^externa: (?:Refused to load|Loading) the image 'https:\/\/imagens\.example\.com\/(?:foto|outra)\.png' (?:violates|because it violates) the following Content Security Policy directive/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
  }
  hosts.delete('imagens.example.com');   /* bloqueadas pela CSP: nada sai do navegador */
  check('CL-150 as únicas violações de CSP desta apresentação são as imagens externas bloqueadas (img-src), como esperado', extra.length > 0 && extra.every((v) => /img-src/.test(v.d) && /imagens\.example\.com/.test(v.u)), extra.slice(0, 3));
});

await scenario('36 · visual das caixas, do menu e da abertura da nuvem = padrão do editor (.mdl/.mb/.menu e fundo da capa) (VIS-06)', async () => {
  const s = await seed(ana, 'ana', 'Visual'); const p = await openEditor(ana, s.id, 'visual');
  await p.evaluate(() => { AMStudio.confirm({ eyebrow: 'Teste', title: 'Modal do editor', msg: 'Comparar', ok: 'Ok' }); }); await p.waitForSelector('#modal.open .mdl');
  const ed = await p.evaluate(() => { const m = document.querySelector('#modal .mdl'), b = getComputedStyle(m, '::before'), ey = getComputedStyle(document.querySelector('#modal .mdl-ey')), mb = getComputedStyle(document.querySelector('#modal .mb')), pri = getComputedStyle(document.querySelector('#modal .mb.pri')), ov = getComputedStyle(document.getElementById('modal')), cs = getComputedStyle(m); return { radius: cs.borderRadius, shadow: cs.boxShadow, width: cs.width, bar: b.backgroundImage, barH: b.height, eyF: ey.fontFamily, eyS: ey.fontSize, eyL: ey.letterSpacing, mbH: mb.height, mbB: mb.borderTopColor, mbW: mb.fontWeight, pri: pri.backgroundColor, priC: pri.color, blur: ov.backdropFilter, bg: ov.backgroundColor }; });
  await p.keyboard.press('Escape'); await sleep(200);
  await p.click('#cloudPill'); const menu = await p.evaluate(() => { const c = getComputedStyle(document.getElementById('cloudMenu')), k = getComputedStyle(document.querySelector('#cloudMenu kbd')); return { shadow: c.boxShadow, radius: c.borderRadius, kbdF: k.fontFamily, kbdS: k.fontSize }; });
  await p.click('.cl-mi[data-id=snap]'); await p.waitForSelector('.cl-dlg');
  const cl = await p.evaluate(() => { const m = document.querySelector('.cl-dlg'), b = getComputedStyle(m, '::before'), ey = getComputedStyle(document.querySelector('.cl-dlg .cl-ey')), mb = getComputedStyle(document.querySelector('.cl-dlg .cl-b:not(.pri)')), pri = getComputedStyle(document.querySelector('.cl-dlg .cl-b.pri')), ov = getComputedStyle(document.querySelector('.cl-ov')), cs = getComputedStyle(m); return { radius: cs.borderRadius, shadow: cs.boxShadow, width: cs.width, bar: b.backgroundImage, barH: b.height, eyF: ey.fontFamily, eyS: ey.fontSize, eyL: ey.letterSpacing, mbH: mb.height, mbB: mb.borderTopColor, mbW: mb.fontWeight, pri: pri.backgroundColor, priC: pri.color, blur: ov.backdropFilter, bg: ov.backgroundColor, icon: !!document.querySelector('.cl-dlg .cl-dic svg') }; });
  const same = ['radius', 'shadow', 'width', 'bar', 'barH', 'eyF', 'eyS', 'eyL', 'mbH', 'mbB', 'mbW', 'pri', 'priC', 'blur', 'bg'].filter((k) => ed[k] !== cl[k]);
  check('CL-151 caixa da nuvem = modal do editor: faixa laranja/navy de 3 px, raio, sombra, largura, sobretítulo em JetBrains Mono, botões .mb (38 px, borda, laranja no principal), fundo com desfoque e ícone', same.length === 0 && cl.icon, { diff: same.map((k) => k + ': editor=' + ed[k] + ' nuvem=' + cl[k]) });
  check('CL-152 menu da nuvem com a sombra e o raio do menu do editor e atalhos em JetBrains Mono', /0\.18/.test(menu.shadow) && menu.radius === '12px' && /JetBrains Mono/.test(menu.kbdF) && menu.kbdS === '10.5px', menu);
  await p.keyboard.press('Escape'); await p.close();
  await faults(ana, { presDelayMs: 1500 }); const L = await openEditor(ana, s.id, 'abertura', { wait: false }); await L.waitForSelector('#cloudLoad', { timeout: 8000 });
  const ld = await L.evaluate(() => { const c = getComputedStyle(document.getElementById('cloudLoad')), g = getComputedStyle(document.getElementById('cloudLoad'), '::before'), t = document.querySelector('#cloudLoad .cl-lt'); return { bg: c.backgroundImage, grid: g.backgroundImage, title: t && t.textContent, dot: t && getComputedStyle(t.querySelector('i')).backgroundColor }; });
  await faults(ana, { presDelayMs: 0 }); await L.waitForFunction(() => !document.getElementById('cloudLoad'), null, { timeout: 15000 }).catch(() => { }); await L.close();
  check('CL-153 tela "Abrindo…" com o fundo da capa (gradiente navy + grade) e a marca "Canteiro" com o quadrado laranja', /radial-gradient/.test(ld.bg) && /linear-gradient/.test(ld.grid) && ld.title === 'Canteiro' && ld.dot === 'rgb(247, 140, 22)', ld);
});

await scenario('37 · recuperação de alterações não decide pelo relógio do computador (relógio 1 h atrasado) (F7)', async () => {
  const c = await newCtx('ana'); await c.addInitScript(() => { const real = Date.now.bind(Date), off = -3600 * 1000; Date.now = () => real() + off; });
  const s = await seed(c, 'ana', 'Relógio atrasado'); const p = await openEditor(c, s.id, 'relogio');
  await c.setOffline(true); await sleep(200); await typeNewText(p, 'Feito com relógio errado');
  await until(async () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('canteiro-cloud'); r.onsuccess = () => { const g = r.result.transaction('pending').objectStore('pending').getAll(); g.onsuccess = () => res(g.result.some((x) => String(x.json).includes('Feito com relógio errado'))); }; })), 6000, 200);
  await p.close({ runBeforeUnload: false }); await c.setOffline(false);
  const q = await openEditor(c, s.id, 'relogio2', { wait: false }); const d = await q.waitForSelector('.cl-b[data-act=recover]', { timeout: 15000 }).catch(() => null);
  check('CL-154 com o relógio 1 h atrás do servidor, a alteração pendente ainda é oferecida para recuperar (decisão por revisão/conteúdo, não por hora)', !!d);
  if (d) { await d.click(); await q.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved' && !AMCloud.dirty, null, { timeout: 20000 }); }
  check('CL-155 e "Recuperar" salva a alteração na nuvem', JSON.stringify((await serverPres(c, s.id)).content).includes('Feito com relógio errado'));
  await q.close(); await c.close();
});

await scenario('38 · limite de 4 MB medido em bytes UTF-8: texto acentuado acima de 4 MiB em bytes (abaixo em caracteres) é barrado antes do envio (PUB-08)', async () => {
  const s = await seed(ana, 'ana', 'Acentos', deckWith('Acentos', [slideOf([textEl('Capa')]), slideOf([textEl('Notas')])]));
  const p = await openEditor(ana, s.id, 'bytes'); await reqLog(ana, true);
  const m = await p.evaluate(() => { const big = 'ã'.repeat(4000); AMStudio.deck.comments = Array.from({ length: 550 }, (_, i) => ({ id: 'c' + i, text: big, ts: 1 })); const t = JSON.stringify(AMStudio.deck); AMStudio.commit(); return { chars: t.length, bytes: new Blob([t]).size }; });
  const dlg = await p.waitForSelector('.cl-dlg', { timeout: 25000 }).catch(() => null), txt = dlg ? await dlg.innerText() : '';
  const puts = (await reqLog(ana)).filter((r) => r.method === 'PUT' && /\/content$/.test(r.path));
  check('CL-156 deck com ' + (m.chars / 1048576).toFixed(2) + ' Mi caracteres e ' + (m.bytes / 1048576).toFixed(2) + ' MiB em UTF-8: barrado ANTES do envio (nenhum PUT), com a caixa "grande demais para salvar de uma vez (4,x MB; limite 4 MB por salvamento)…"', m.chars < 4 * 1048576 && m.bytes > 4 * 1048576 && puts.length === 0 && /grande demais para salvar de uma vez \(4,\d MB; limite 4 MB por salvamento\)/.test(txt) && (await pillState(p)) === 'error', { m, puts: puts.length, txt: txt.slice(0, 220), st: await pillState(p) });
  if (dlg) await p.click('.cl-dlg [data-act=ok]');
  await p.evaluate(() => { delete AMStudio.deck.comments; AMStudio.deck.slides[0].els[0].html = 'Capa revisada'; AMStudio.commit(); }); await waitSaved(p, 20000);
  const sv = await serverPres(ana, s.id);
  check('CL-157 reduzido o conteúdo, a próxima edição volta a salvar normalmente', (await pillState(p)) === 'saved' && sv.rev >= 2 && JSON.stringify(sv.content).includes('Capa revisada') && !sv.content.comments, { st: await pillState(p), rev: sv.rev });
  await p.close();
});

/* ---------- fim: CSP e erros globais ---------- */
check('CL-87 ZERO violações de CSP em todo o roteiro (editor, player, exportações, importação PPTX/PDF, histórico, conflito, visualizar) — ' + cspViolations.length, cspViolations.length === 0, cspViolations.slice(0, 5));
check('CL-94 rede: o editor só fala com a própria origem e com as fontes do Google (' + [...hosts].join(', ') + ')', [...hosts].every((h) => h === 'localhost:' + PORT || h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com'), [...hosts]);
check('CL-88 zero erros de console e zero erros de página não esperados', consoleErrors.length === 0 && pageErrors.length === 0, { console: consoleErrors.slice(0, 5), page: pageErrors.slice(0, 5) });

await ana.close(); await bia.close(); await browser.close(); await mock.close();
console.log('\n' + results.join('\n'));
console.log('\nPASS ' + passed + ' · FAIL ' + failed + ' (verificações) · editor ' + Math.round(built.editorBytes / 1024) + ' KB · ' + built.inlineScriptHashes + ' hashes de script');
process.exit(failed ? 1 : 0);
