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
  await p.addInitScript(() => { window.__states = []; document.addEventListener('DOMContentLoaded', () => { const mo = new MutationObserver(() => { const el = document.getElementById('cloudPill'); if (el && window.__states.at(-1) !== el.dataset.state) window.__states.push(el.dataset.state); }); mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'], childList: true }); }); });
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
  const inert = await openEditor(ana, 'nao-e-uuid', 'inerte', { wait: false }); await sleep(1500);
  const ci = await inert.evaluate(() => ({ cloud: window.AM_CLOUD, api: window.AMCloud, cover: AMCover.isOpen(), pill: !!document.getElementById('cloudPill') }));
  const apiCalls = (await reqLog(ana)).filter((r) => /nao-e-uuid/.test(r.path));
  check('CL-03 modo inerte: fora de /editor/<uuid> o build cloud se comporta como o editor original (capa aberta, sem pílula, sem AM_CLOUD, sem chamadas à API)', !ci.cloud && !ci.api && ci.cover === true && !ci.pill && apiCalls.length === 0, ci);
  await inert.close();
  /* hash de cada <script> inline do HTML servido = hash da CSP (calculado no navegador a partir do DOM real) */
  const hs = await p.evaluate(async () => { const out = []; for (const sc of document.scripts) { if (sc.src) continue; const t = sc.type; if (t && !/^(text\/javascript|module)$/i.test(t)) continue; const b = new TextEncoder().encode(sc.textContent); const d = await crypto.subtle.digest('SHA-256', b); out.push('sha256-' + btoa(String.fromCharCode(...new Uint8Array(d)))); } return out; });
  const policy = cspJson['/editor/'], inPolicy = hs.every((h) => policy.includes("'" + h + "'"));
  check('CL-04 CSP do editor: cada <script> inline do DOM real tem hash na política (' + hs.length + ' scripts) e há strict-dynamic, sem unsafe-inline/unsafe-eval em script-src', inPolicy && /script-src [^;]*'strict-dynamic'/.test(policy) && !/script-src[^;]*unsafe-(inline|eval)/.test(policy) && hs.length === inlineScriptHashes(readFileSync(path.join(PLATFORM, 'dist/public/editor/index.html'), 'utf8')).length, { n: hs.length });
  await p.close();
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
  check('CL-45 clicar/Enter na pílula abre o menu (role=menu) com: Salvar versão agora…, Histórico de versões…, Criar cópia, Compartilhar (copiar link), Voltar ao acervo', JSON.stringify(items) === JSON.stringify(['Salvar versão agora…', 'Histórico de versões…', 'Criar cópia', 'Compartilhar (copiar link)', 'Voltar ao acervo']) && (await p.getAttribute('#cloudPill', 'aria-expanded')) === 'true', items);
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
  check('CL-49b Arquivo › "' + firstItem.slice(0, 20) + '…" (Início/capa) leva ao acervo na nuvem', /^Início/.test(firstItem) && m1.url().endsWith('/acervo?foco=' + s.id), { firstItem, url: m1.url() });
  await m1.close();
  const m2 = await openEditor(ana, s.id, 'home-brand'); await Promise.all([m2.waitForURL(/\/acervo\?foco=/, { timeout: 10000 }), m2.click('#top .brand')]);
  check('CL-49c clicar na marca A&M também vai ao acervo', m2.url().endsWith('/acervo?foco=' + s.id)); await m2.close();
  const m3 = await openEditor(ana, s.id, 'obras'); await m3.click('#mbar button[data-m=file]'); await sleep(250);
  const obras = await m3.$$('.xmenu .xi'); let clicked = false; for (const it of obras) { if (/Minhas obras/.test(await it.textContent())) { await it.click(); clicked = true; break; } }
  await sleep(700); const coverOpen = await m3.evaluate(() => AMCover.isOpen());
  check('CL-49d "Minhas obras…" (acervo local do navegador) continua abrindo, e Esc volta ao editor', clicked && coverOpen === true && (await (async () => { await m3.keyboard.press('Escape'); await sleep(900); return !(await m3.evaluate(() => AMCover.isOpen())) && m3.url().includes('/editor/'); })()));
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
  await p.setInputFiles('#fOpen', f); await sleep(500);
  await waitSaved(p, 20000);
  const d = await deckOf(p), sp = await serverPres(ana, s.id);
  check('CL-79 Abrir… um arquivo: deck.id continua o da apresentação na nuvem e o conteúdo novo é salvo', d.id === s.id && JSON.stringify(sp.content).includes('Veio de um arquivo') && sp.content.id === s.id, { id: d.id, cid: sp.content.id });
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

/* ---------- fim: CSP e erros globais ---------- */
check('CL-87 ZERO violações de CSP em todo o roteiro (editor, player, exportações, importação PPTX/PDF, histórico, conflito, visualizar) — ' + cspViolations.length, cspViolations.length === 0, cspViolations.slice(0, 5));
check('CL-94 rede: o editor só fala com a própria origem e com as fontes do Google (' + [...hosts].join(', ') + ')', [...hosts].every((h) => h === 'localhost:' + PORT || h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com'), [...hosts]);
check('CL-88 zero erros de console e zero erros de página não esperados', consoleErrors.length === 0 && pageErrors.length === 0, { console: consoleErrors.slice(0, 5), page: pageErrors.slice(0, 5) });

await ana.close(); await bia.close(); await browser.close(); await mock.close();
console.log('\n' + results.join('\n'));
console.log('\nPASS ' + passed + ' · FAIL ' + failed + ' (verificações) · editor ' + Math.round(built.editorBytes / 1024) + ' KB · ' + built.inlineScriptHashes + ' hashes de script');
process.exit(failed ? 1 : 0);
