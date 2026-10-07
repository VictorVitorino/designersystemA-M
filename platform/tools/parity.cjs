#!/usr/bin/env node
/* tools/parity.cjs — PROVA DE PARIDADE entre dois builds do editor Canteiro (ex.: original × build em nuvem).
   Garante que TODOS os efeitos, variantes, modelos, ícones, layouts, projetos prontos, blocos e transições rendem de forma
   IDÊNTICA: mesmo deck → mesmos pixels, mesmo DOM, mesmos quadros de animação, mesmas exportações.

   Uso:  node tools/parity.cjs --a <original.html> --b <candidato.html> --out <pasta> [--groups anims,gallery,models,structure] [--no-frames] [--quick]
                               [--deck <pasta de uma execução anterior>] [--only 12,57,300]   (reutiliza o deck de prova; compara só esses índices)

   Como funciona
   1. Abre A e B no MESMO Chromium (--disable-lcd-text, viewport 1280×720), fontes do Google roteadas para ../fonts2 (sem rede),
      Math.random com semente fixa (re-semeado antes de cada comparação) e relógio da página controlado (page.clock) para
      congelar animações de JS; animações de CSS são pausadas e posicionadas em instantes fixos (document.getAnimations()).
   2. Em A, monta o deck de prova pelo MESMO caminho do usuário: lê a gaveta "Acervo de efeitos" (os 196 itens: entradas,
      contínuos, mouse, transições, componentes, ícones, modelos com variantes) e aciona "Provar" → "Usar este efeito" em cada um;
      lê a "Biblioteca de modelos" e insere cada caixa; insere todos os ícones e transformações, todos os layouts, os 6 projetos
      prontos da capa, os 5 blocos prontos, os 14 SmartArt, formas, textos, linhas e marcas.
   3. Serializa o deck (JSON) e carrega o MESMO JSON em A e em B (ids iguais → comparação exata).
   4. Para cada slide compara: (a) DOM renderizado (outerHTML de RT.renderSlide); (b) raster 1280×720 (AMExport.rasterSlide, o
      mesmo caminho do PDF) pixel a pixel; (c) quadros do player em t = 0, 150, 400, 800, 1500 e 3000 ms; (d) nas transições,
      quadros a 80, 250 e 500 ms após avançar; (e) HTML exportado (sha256), CSS/JS do runtime embutido (sha256) e PPTX (entradas do zip,
      exceto docProps/core.xml que leva data).
   5. Escreve <out>/relatorio.json, <out>/relatorio.md e, para cada divergência, <out>/diff/<slide>-<camada>-{a,b,diff}.png.
   Determinismo: o relógio da página é pausado no MESMO instante absoluto em A e B antes de cada captura (DOM, quadros, transição) — ids
   derivados de Date.now() e a fase de rAF/performance.now ficam iguais; toda animação é fixada em t e verificada (pausada, em t) antes da foto.
   Uma divergência é recapturada imediatamente UMA vez: diferença real entre A e B reproduz; instabilidade de captura (compositor atrasado
   sob carga) não — e fica registrada como "captura instável" com as imagens da 1ª tentativa (diff/<slide>-t1-*), nunca escondida.
   Saída 0 = tudo idêntico; 1 = alguma divergência; 2 = erro de execução. */
'use strict';
process.env.NODE_PATH = '/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { execFileSync } = require('child_process');
let sharp = null; try { sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp')); } catch (e) { try { sharp = require('sharp'); } catch (e2) { sharp = null; } }

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const A_PATH = path.resolve(args.a || ''), B_PATH = path.resolve(args.b || ''), OUT = path.resolve(args.out || path.join(__dirname, '..', '.tmp', 'parity'));
if (!fs.existsSync(A_PATH) || !fs.existsSync(B_PATH)) { console.error('uso: node tools/parity.cjs --a <original.html> --b <candidato.html> --out <pasta>'); process.exit(2); }
const GROUPS = String(args.groups || 'anims,gallery,models,structure').split(',').map((s) => s.trim()).filter(Boolean);
const FRAMES = !args['no-frames']; const QUICK = !!args.quick;
const FONTS = process.env.AM_FONTS_DIR || path.join(__dirname, '..', '..', 'fonts2');
const ACAO = { 'Access-Control-Allow-Origin': '*' };
const FRAME_T = QUICK ? [0, 400, 1500] : [0, 150, 400, 800, 1500, 3000];
const TR_T = QUICK ? [250] : [80, 250, 500];
const FIXED_TIME = Date.UTC(2026, 9, 6, 12, 0, 0);
fs.rmSync(path.join(OUT, 'diff'), { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'diff'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const log = (...m) => console.error(new Date().toISOString().slice(11, 19), ...m);

/* ---------- determinismo injetado antes de qualquer script da página ---------- */
const INIT = `
(function(){
  var seed = 0x9E3779B9;
  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rnd = mulberry32(seed);
  window.__amSeed = function(n){ rnd = mulberry32((n == null ? seed : n) | 0); };
  Math.random = function(){ return rnd(); };
  /* crypto.getRandomValues só para ids: também determinístico (xorshift) */
  if (window.crypto && crypto.getRandomValues) { var x = 123456789; crypto.getRandomValues = function(arr){ for (var i = 0; i < arr.length; i++){ x ^= x << 13; x ^= x >>> 17; x ^= x << 5; arr[i] = (x >>> 0) & (arr.BYTES_PER_ELEMENT === 1 ? 255 : arr.BYTES_PER_ELEMENT === 2 ? 65535 : 4294967295); } return arr; }; }
  window.__amErrors = [];
  window.addEventListener('error', function(e){ window.__amErrors.push(String(e.message)); });
})();`;

async function openPage(browser, file, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'no-preference' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(tag + ': ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load/.test(m.text())) errs.push(tag + ' console: ' + m.text().slice(0, 200)); });
  await p.clock.install({ time: FIXED_TIME });
  await p.addInitScript(INIT);
  if (fs.existsSync(path.join(FONTS, 'gf.css'))) {
    await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', headers: ACAO, body: fs.readFileSync(path.join(FONTS, 'gf.css'), 'utf8') }));
    await p.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', headers: ACAO, body: fs.readFileSync(f) }) : r.abort(); });
  } else log('AVISO: fontes locais não encontradas em', FONTS);
  await p.route(/^https?:\/\/(?!fonts\.)/, (r) => r.abort()); /* nenhuma outra rede: ambos os builds precisam ser autônomos */
  await p.goto('file://' + encodeURI(file).replace(/\(/g, '%28').replace(/\)/g, '%29') + '?nocover'); await sleep(1200);
  await p.evaluate(() => document.fonts.ready);
  const ok = await p.evaluate(() => !!(window.AMStudio && window.AMRT && window.AMExport));
  if (!ok) throw new Error(tag + ': editor não carregou (AMStudio/AMRT/AMExport ausentes)');
  return { ctx, p, errs };
}

/* ---------- construção do deck de prova em A (pelo caminho do usuário) ---------- */
const BUILD = {
  /* catálogo da gaveta (lido do DOM) */
  async catalog(p) {
    return p.evaluate(async () => {
      const A = AMStudio; A.openDrawer(true, 'fx'); await new Promise((r) => setTimeout(r, 400));
      const gx = [...document.querySelectorAll('#drawerBody .gx-box')].map((b) => ({ id: b.dataset.gx, fam: b.dataset.fam, k: b.dataset.k || null, v: b.dataset.v || null, n: b.dataset.n || null, name: (b.querySelector('.gx-ft b') || {}).textContent || '' }));
      A.openDrawer(true, 'models'); await new Promise((r) => setTimeout(r, 400));
      const models = [...document.querySelectorAll('#modelsBody .fxi[data-k]')].map((b) => ({ k: b.dataset.k, v: b.dataset.v || null, n: b.dataset.n || null, pre: b.classList.contains('fxi-pre'), name: (b.querySelector('.ft b') || {}).textContent || '' }));
      A.openDrawer(false);
      const R = AMRT;
      return { gx, models, icons: (R.ICONS || []).map((i) => (typeof i === 'string' ? i : i.name || i[0])), morphs: (R.ICON_MORPHS || []).map((m) => m[0]), layouts: Object.keys(A.LAYOUTS), seqs: A.SEQS.map((s) => s[0]), smart: Object.keys(R.SMART_LAYOUTS || {}), anims: Object.fromEntries(Object.entries(R.ANIMS).map(([k, v]) => [k, v.map((x) => x[0])])), fx: Object.keys(R.FX), templates: (window.AMCover && AMCover.buildTemplate) ? 6 : 0 };
    });
  },
  /* grupo 1: animações (entrada/contínuo/mouse) aplicadas a 5 tipos de elemento + transições */
  async anims(p, cat) {
    return p.evaluate(async (cat) => {
      const A = AMStudio, W = 1280, H = 720; const tags = []; const S = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><rect width="640" height="400" fill="#0B3A63"/><circle cx="320" cy="200" r="120" fill="#F78C16"/><rect x="60" y="300" width="520" height="40" fill="#7EA1C3"/></svg>');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      function sample() {
        const t = A.mk.text('title', { x: 80, y: 60, w: 700, h: 110, html: 'Transformação do <b>PMO</b> corporativo' }), s = A.mk.shape('round', { x: 820, y: 60, w: 380, h: 220, fill: '#002A46', html: 'RECEITA<br>+18%' }), l = Object.assign(A.mk.line(true), { x1: 100, y1: 420, x2: 700, y2: 420, stroke: '#F78C16', strokeW: 6 }), im = A.mk.image(S, 640, 400); Object.assign(im, { x: 820, y: 320, w: 380, h: 240, fit: 'cover' });
        const fx = A.mk.fx('counter'); Object.assign(fx, { x: 100, y: 470, w: 300, h: 200 });
        return [t, s, l, im, fx];
      }
      const anim = cat.gx.filter((it) => ['in', 'emph', 'loop', 'hover'].includes(it.fam));
      for (const it of anim) {
        A.addSlide('blank-light'); const els = sample(); const sl = A.deck.slides[A.cur]; sl.els = els; A.renderAll(); A.commit();
        A.selectMany(els.map((e) => e.id));
        A.openDrawer(true, 'fx'); await wait(60);
        const box = document.querySelector('#drawerBody .gx-box[data-gx="' + CSS.escape(it.id) + '"] .gx-try'); if (!box) { tags.push({ i: A.cur, it: it.id, err: 'caixa não encontrada' }); continue; }
        box.click(); await wait(120);
        const use = document.getElementById('gpUse'); const applied = use && !use.disabled; if (applied) use.click(); else { const d = document.querySelector('#gxProv [data-gp=discard]'); if (d) d.click(); }
        await wait(60);
        tags.push({ i: A.cur, kind: 'anim', it: it.id, name: it.name, applied: !!applied, animated: A.deck.slides[A.cur].els.filter((e) => e.anim && (e.anim.in !== 'none' || (e.anim.loop && e.anim.loop !== 'none') || (e.anim.hover && e.anim.hover !== 'none') || (e.anim.emph && e.anim.emph !== 'none'))).length });
        A.selectMany([]);
      }
      A.openDrawer(false);
      /* transições: um slide por transição (o anterior serve de origem) */
      const trs = cat.gx.filter((it) => it.fam === 'tr');
      for (const it of trs) {
        A.addSlide('content'); const sl = A.deck.slides[A.cur]; sl.els.forEach((e, k) => { if (e.type === 'text') e.html = (k === 0 ? 'Transição: ' + it.name : 'Lâmina de chegada para medir os quadros da transição “' + it.name + '”.'); });
        sl.tr = it.id.split(':')[1]; A.renderAll(); A.commit();
        tags.push({ i: A.cur, kind: 'tr', it: it.id, name: it.name, tr: sl.tr });
      }
      return tags;
    }, cat);
  },
  /* grupo 2: componentes, ícones e modelos (as 152 caixas de inserção do acervo) */
  async gallery(p, cat) {
    return p.evaluate(async (cat) => {
      const A = AMStudio; const tags = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const ins = cat.gx.filter((it) => ['cmp', 'model', 'icon'].includes(it.fam));
      for (const it of ins) {
        A.addSlide(it.fam === 'icon' ? 'blank-dark' : 'blank-light'); A.selectMany([]);
        A.openDrawer(true, 'fx'); await wait(40);
        const box = document.querySelector('#drawerBody .gx-box[data-gx="' + CSS.escape(it.id) + '"] .gx-try'); if (!box) { tags.push({ i: A.cur, it: it.id, err: 'caixa não encontrada' }); continue; }
        box.click(); await wait(100);
        const use = document.getElementById('gpUse'); const n0 = A.deck.slides[A.cur].els.length; if (use && !use.disabled) use.click(); await wait(40);
        const n1 = A.deck.slides[A.cur].els.length;
        tags.push({ i: A.cur, kind: it.fam, it: it.id, name: it.name, inserted: n1 - n0, fx: A.deck.slides[A.cur].els.filter((e) => e.type === 'fx').map((e) => e.kind + (e.variant ? '/' + e.variant : '') + (e.data && e.data.preset ? '#' + e.data.preset : '')) });
      }
      A.openDrawer(false);
      return tags;
    }, cat);
  },
  /* grupo 3: Biblioteca de modelos (caixas .fxi), todos os ícones e transformações, SmartArt */
  async models(p, cat) {
    return p.evaluate(async (cat) => {
      const A = AMStudio, R = AMRT; const tags = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      A.openDrawer(true, 'models'); await wait(300);
      const boxes = [...document.querySelectorAll('#modelsBody .fxi[data-k]')];
      for (const b of boxes) {
        A.addSlide('blank-light'); A.selectMany([]); const n0 = A.deck.slides[A.cur].els.length;
        b.click(); await wait(60);
        if (A.deck.slides[A.cur].els.length === n0) { /* caixa não insere no clique: usa a mesma API do arrastar */ A.insertFx(b.dataset.k, null, null, b.dataset.v || null, b.dataset.n ? { preset: b.dataset.n } : null); }
        tags.push({ i: A.cur, kind: 'biblioteca', it: 'lib:' + b.dataset.k + (b.dataset.v ? ':' + b.dataset.v : '') + (b.dataset.n ? '#' + b.dataset.n : ''), name: (b.querySelector('.ft b') || {}).textContent || '', inserted: A.deck.slides[A.cur].els.length - n0 });
      }
      A.openDrawer(false);
      for (const name of cat.icons) { A.addSlide('blank-dark'); A.insertFx('icon', null, null, null, { name }); tags.push({ i: A.cur, kind: 'icon54', it: 'icon:' + name, name }); }
      for (const pair of cat.morphs) { A.addSlide('blank-dark'); A.insertFx('iconmorph', null, null, null, { pair }); tags.push({ i: A.cur, kind: 'morph', it: 'morph:' + pair, name: pair }); }
      for (const k of cat.smart) { A.addSlide('blank-light'); A.smart.insert(k); tags.push({ i: A.cur, kind: 'smart', it: 'smart:' + k, name: k }); }
      return tags;
    }, cat);
  },
  /* grupo 4: layouts, projetos prontos, blocos, formas, textos, linhas, marcas */
  async structure(p, cat) {
    return p.evaluate(async (cat) => {
      const A = AMStudio; const tags = []; const n0 = A.deck.slides.length;
      for (const k of cat.layouts) { A.appendSlides([A.mk.slide(k)]); tags.push({ i: A.deck.slides.length - 1, kind: 'layout', it: 'layout:' + k, name: k }); }
      for (let t = 0; t < cat.templates; t++) { const d = AMCover.buildTemplate(t); const base = A.deck.slides.length; A.appendSlides(d.slides); d.slides.forEach((s, j) => tags.push({ i: base + j, kind: 'template', it: 'tpl:' + t + ':' + j, name: d.title + ' · ' + (j + 1) })); }
      for (const key of cat.seqs) { const base = A.deck.slides.length; A.goSlide(base - 1); A.insertSeq(key); const n = A.deck.slides.length - base; for (let j = 0; j < n; j++) tags.push({ i: base + j, kind: 'seq', it: 'seq:' + key + ':' + j, name: key + ' · ' + (j + 1) }); }
      const shapes = (cat.shapes || []); const html = document.documentElement.outerHTML; /* lista de formas do próprio build */
      const m = /var SHAPES = \[(\[.*?\])\];/.exec(html); let SH = []; if (m) { try { SH = eval('[' + m[1] + ']').map((x) => x[0]); } catch (e) { SH = []; } }
      if (!SH.length) SH = ['rect', 'round', 'pill', 'ellipse', 'triangle', 'diamond', 'para', 'chevron', 'arrow', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'ring', 'rtri', 'darrow'];
      for (const s of SH) { try { A.appendSlides([A.mk.slide('blank-light')]); const e = A.mk.shape(s); if (!e) continue; Object.assign(e, { html: s.toUpperCase() }); A.deck.slides[A.deck.slides.length - 1].els.push(e); tags.push({ i: A.deck.slides.length - 1, kind: 'shape', it: 'shape:' + s, name: s }); } catch (err) { tags.push({ it: 'shape:' + s, err: String(err.message) }); } }
      for (const t of ['title', 'subtitle', 'body', 'bullets', 'eyebrow', 'number']) { A.appendSlides([A.mk.slide('blank-light')]); const e = A.mk.text(t); A.deck.slides[A.deck.slides.length - 1].els.push(e); tags.push({ i: A.deck.slides.length - 1, kind: 'text', it: 'text:' + t, name: t }); }
      const lines = [['line', A.mk.line(false)], ['arrow', A.mk.line(true)], ['double', Object.assign(A.mk.line(true), { headStart: true })]];
      for (const [n, e] of lines) { A.appendSlides([A.mk.slide('blank-light')]); Object.assign(e, { x1: 200, y1: 360, x2: 1080, y2: 360, strokeW: 8 }); A.deck.slides[A.deck.slides.length - 1].els.push(e); tags.push({ i: A.deck.slides.length - 1, kind: 'line', it: 'line:' + n, name: n }); }
      for (const b of ['perfW', 'perfN', 'wmW', 'wmN']) { A.appendSlides([A.mk.slide(b.endsWith('W') ? 'blank-dark' : 'blank-light')]); const e = A.mk.brand(b, { x: 300, y: 300, h: 80 }); A.deck.slides[A.deck.slides.length - 1].els.push(e); tags.push({ i: A.deck.slides.length - 1, kind: 'brand', it: 'brand:' + b, name: b }); }
      A.renderAll(); A.commit();
      return tags.filter((t) => t.i == null || t.i >= n0);
    }, cat);
  },
};

/* ---------- comparações ---------- */
async function loadDeck(p, json) {
  await p.evaluate(async (json) => { window.__amSeed(1); AMStudio.loadDeck(JSON.parse(json), null); await new Promise((r) => setTimeout(r, 300)); await document.fonts.ready; }, json);
}
async function domOf(p, i) { return p.evaluate((i) => { window.__amSeed(2 + i); const s = AMStudio.deck.slides[i]; const n = AMRT.renderSlide(s, { play: false }); return n.outerHTML; }, i); }
async function rasterOf(p, i) { return p.evaluate(async (i) => { window.__amSeed(1000 + i); const rr = await AMExport.rasterSlide(AMStudio.deck.slides[i], { scale: 1, type: 'png' }); return rr.canvas.toDataURL('image/png'); }, i); }
/* espera o compositor criar todas as animações do slide (contagem estável em 2 leituras seguidas) antes de pausar — sem isso,
   uma animação criada entre a pausa e a captura avança 1–2 quadros em tempo real e gera ruído de ~5 % de opacidade */
async function settleAnims(p) {
  let last = -1, stable = 0;
  for (let k = 0; k < 12; k++) { const n = await p.evaluate(() => { void document.body.offsetHeight; return document.getAnimations().length; }); if (n === last) { if (++stable >= 2) break; } else { stable = 0; last = n; } await sleep(40); }
}
const ANCHOR0 = FIXED_TIME + 2 * 3600 * 1000, SLOT = 600000;
/* instante ABSOLUTO do relógio falso por slide e tentativa (fase idêntica de rAF/performance.now/Date.now em A e B): k = 0 DOM/raster, 1 quadros do player, 3 transição.
   Faixas de 10 min por tentativa: o relógio corre em tempo real entre pausas e pauseAt não volta no tempo — a folga absorve máquinas lentas. */
const anchorFor = (i, k, attempt = 1) => ANCHOR0 + (i * 2 + (attempt - 1)) * SLOT + k * 120000;
async function pauseClockAt(p, t) { try { await p.clock.pauseAt(t); return true; } catch (e) { log('AVISO relógio: ' + String(e.message).slice(0, 90)); return false; } }
/* fixa TODAS as animações em t e só devolve quando duas leituras seguidas mostram: mesma contagem, nenhuma em execução, todas em t */
async function pinAll(p, t) {
  let last = null;
  for (let k = 0; k < 40; k++) {
    const s = await p.evaluate((t) => { void document.body.offsetHeight; document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = t; } catch (e) { } }); const as = document.getAnimations(); return { n: as.length, running: as.filter((a) => a.playState === 'running').length, off: as.filter((a) => a.currentTime !== t).length }; }, t);
    if (last && s.n === last.n && s.running === 0 && s.off === 0 && last.running === 0 && last.off === 0) return s;
    last = s; await sleep(25);
  }
  return last;
}
async function pauseAll(p, t) { return p.evaluate((t) => { document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = t; } catch (e) { } }); return document.getAnimations().filter((a) => a.playState === 'running').length; }, t); }
/* Captura ESTÁVEL: o compositor do Chromium rasteriza em blocos de 256 px de forma assíncrona; logo após fixar uma animação de transform, um
   bloco pode ainda mostrar a posição anterior (uma "costura" de 1 px na borda da lâmina que desliza). Fotografamos até duas capturas seguidas
   saírem byte-idênticas — só então o quadro é o estado fixado, e não um estado intermediário do rasterizador. */
const REPAINT = process.env.AM_PARITY_REPAINT === '1';   /* opcional: invalidar a pintura antes da foto (não altera o resultado nos casos medidos) */
async function stableShot(el, opts) {
  /* invalida a pintura das camadas do palco antes da foto: os blocos de raster são refeitos TODOS na translação atual (sem isso, um bloco
     rasterizado num instante anterior da animação de transform fica com a borda meio pixel deslocada em relação aos demais) */
  if (REPAINT) { try { await el.evaluate((v) => { v.ownerDocument.querySelectorAll('#presenter .amp-slide, #presenter .amp-view, #presenter .amp-deck').forEach((n) => { n.style.outline = '0px solid transparent'; void n.offsetWidth; }); }); await sleep(20); await el.evaluate((v) => { v.ownerDocument.querySelectorAll('#presenter .amp-slide, #presenter .amp-view, #presenter .amp-deck').forEach((n) => { n.style.outline = ''; void n.offsetWidth; }); }); await sleep(20); } catch (e) { } }
  let prev = await el.screenshot(opts);
  for (let k = 0; k < 5; k++) { await sleep(40); const cur = await el.screenshot(opts); if (cur.equals(prev)) return cur; prev = cur; }
  return prev;
}
async function framesOf(p, i, times, attempt = 1) {
  const out = [];
  /* relógio pausado ANTES de abrir: o tempo de JS (relógio do player, temporizadores, rAF) passa a ser idêntico em A e B */
  await pauseClockAt(p, anchorFor(i, 1, attempt));
  await p.evaluate((i) => { window.__amSeed(5000 + i); AMStudio.present(i, true); }, i);
  await p.clock.runFor(50);
  await p.waitForSelector('#presenter.open', { timeout: 5000 }).catch(() => {});
  await settleAnims(p);
  /* o esmaecimento de ENTRADA do player (transição de opacidade do próprio .amp-slide ao abrir) depende do instante do primeiro
     recálculo de estilo e não é um efeito do slide: é concluído nos dois lados para que t=0 compare os ELEMENTOS no estado inicial */
  await p.evaluate(() => document.getAnimations().forEach((a) => { try { const el = a.effect && a.effect.target; if (a instanceof CSSTransition && el && (el.classList.contains('amp-slide') || el.classList.contains('amp-view') || el.classList.contains('amp-deck'))) a.finish(); } catch (e) { } }));
  let prev = 0;
  for (const t of times) {
    await pauseAll(p, t);
    if (t > prev) await p.clock.runFor(t - prev); prev = t;
    await settleAnims(p); await pinAll(p, t);
    const el = await p.$('#presenter .amp-view'); const png = await stableShot(el, { type: 'png', animations: 'allow', caret: 'hide' });
    const bar = await p.$('#presenter .amp-bar'); const barPng = bar ? await stableShot(bar, { type: 'png', animations: 'allow', caret: 'hide' }) : null;
    out.push({ t, png, barPng });
  }
  await p.keyboard.press('Escape'); await p.clock.runFor(1500); await p.clock.resume(); await sleep(80);
  await p.evaluate(() => { const pr = document.getElementById('presenter'); if (pr && pr.classList.contains('open')) { pr.classList.remove('open'); } });
  return out;
}
async function trFramesOf(p, i, times, attempt = 1) {
  /* Cada instante t é medido numa SEQUÊNCIA NOVA (reabrir o player, avançar, fixar em t, fotografar). Medir t = 80, 250 e 500 ms na mesma
     sequência deixava o raster dos blocos da lâmina em movimento dependente do histórico de pausas (um bloco refeito num instante anterior
     mostrava a borda meio pixel deslocada — "costura" de 1 px); com uma captura por sequência não há histórico, e o resultado é determinístico. */
  const out = [];
  for (let k = 0; k < times.length; k++) {
    const t = times[k];
    await pauseClockAt(p, anchorFor(i, 3, attempt) + k * 30000);
    await p.evaluate((i) => { window.__amSeed(7000 + i); AMStudio.present(i - 1, true); }, i);
    await p.clock.runFor(50);
    await p.waitForSelector('#presenter.open', { timeout: 5000 }).catch(() => {});
    await p.clock.runFor(4000); await settleAnims(p);
    await p.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { } }));
    await p.keyboard.press('ArrowRight'); await p.clock.runFor(20); await settleAnims(p);
    await pauseAll(p, t);
    await p.clock.runFor(t);
    await settleAnims(p); await pinAll(p, t);
    const el = await p.$('#presenter .amp-view'); out.push({ t, png: await stableShot(el, { type: 'png', animations: 'allow', caret: 'hide' }) });
    await p.keyboard.press('Escape'); await p.clock.runFor(1500); await p.clock.resume(); await sleep(80);
    await p.evaluate(() => { const pr = document.getElementById('presenter'); if (pr && pr.classList.contains('open')) { pr.classList.remove('open'); } });
  }
  return out;
}
async function pixelDiff(aBuf, bBuf) {
  if (!sharp) return { same: false, pct: null, note: 'sharp indisponível: comparação só por bytes' };
  const [a, b] = await Promise.all([aBuf, bBuf].map((buf) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { same: false, pct: 100, note: `dimensões ${a.info.width}×${a.info.height} vs ${b.info.width}×${b.info.height}` };
  const n = a.info.width * a.info.height; let diff = 0, maxCh = 0; const d = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { const k = i * 4; const dr = Math.abs(a.data[k] - b.data[k]), dg = Math.abs(a.data[k + 1] - b.data[k + 1]), db = Math.abs(a.data[k + 2] - b.data[k + 2]); const m = Math.max(dr, dg, db); if (m > 0) diff++; if (m > maxCh) maxCh = m; d[k] = 255; d[k + 1] = 255 - Math.min(255, m * 4); d[k + 2] = 255 - Math.min(255, m * 4); d[k + 3] = 255; }
  const diffPng = diff ? await sharp(d, { raw: { width: a.info.width, height: a.info.height, channels: 4 } }).png().toBuffer() : null;
  return { same: diff === 0, pct: Math.round(diff / n * 100000) / 1000, diffPng, px: diff, maxCh: maxCh };
}
function b64png(dataUrl) { return Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'); }

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--disable-lcd-text', '--font-render-hinting=none'] });
  const A = await openPage(browser, A_PATH, 'A'), B = await openPage(browser, B_PATH, 'B');
  const report = { a: A_PATH, b: B_PATH, aSha: sha(fs.readFileSync(A_PATH)), bSha: sha(fs.readFileSync(B_PATH)), startedAt: new Date().toISOString(), groups: GROUPS, catalog: {}, slides: [], summary: {}, mismatches: [], errors: [] };

  /* 0. catálogo idêntico nos dois builds */
  const catA = await BUILD.catalog(A.p), catB = await BUILD.catalog(B.p);
  const ids = (c) => ({ gx: c.gx.map((x) => x.id), models: c.models.map((m) => m.k + ':' + (m.v || '') + ':' + (m.n || '')), icons: c.icons, morphs: c.morphs, layouts: c.layouts, seqs: c.seqs, smart: c.smart, anims: c.anims, fx: c.fx });
  const catSame = JSON.stringify(ids(catA)) === JSON.stringify(ids(catB));
  report.catalog = { gx: catA.gx.length, byFam: catA.gx.reduce((o, x) => (o[x.fam] = (o[x.fam] || 0) + 1, o), {}), biblioteca: catA.models.length, icons: catA.icons.length, morphs: catA.morphs.length, layouts: catA.layouts.length, seqs: catA.seqs.length, smart: catA.smart.length, fxKinds: catA.fx.length, templates: catA.templates, identicalInB: catSame };
  log('catálogo', JSON.stringify(report.catalog));
  if (!catSame) report.mismatches.push({ layer: 'catalog', detail: 'os catálogos de A e B diferem' });

  /* 1. runtime embutido e exportação de um deck vazio (prova estrutural) */
  const rtA = await A.p.evaluate(() => ({ css: document.getElementById('am-runtime-css').textContent, js: document.getElementById('am-runtime').textContent }));
  const rtB = await B.p.evaluate(() => ({ css: document.getElementById('am-runtime-css').textContent, js: document.getElementById('am-runtime').textContent }));
  report.runtime = { cssSame: rtA.css === rtB.css, jsSame: rtA.js === rtB.js, cssSha: sha(rtA.css).slice(0, 16), jsSha: sha(rtA.js).slice(0, 16), cssBytes: rtA.css.length, jsBytes: rtA.js.length };
  if (!report.runtime.cssSame || !report.runtime.jsSame) report.mismatches.push({ layer: 'runtime', detail: 'CSS/JS do runtime embutido diferem' });
  log('runtime', JSON.stringify(report.runtime));

  /* 2. construir o deck de prova em A, por grupos */
  let tags = [], deckJson;
  if (args.deck) {
    const dir = path.resolve(String(args.deck)); deckJson = fs.readFileSync(path.join(dir, 'deck-prova.json'), 'utf8');
    try { tags = JSON.parse(fs.readFileSync(path.join(dir, 'tags.json'), 'utf8')); } catch (e) { tags = []; }
    log('deck de prova reutilizado de', dir, '·', JSON.parse(deckJson).slides.length, 'slides ·', tags.length, 'etiquetas'); report.deckReusedFrom = dir;
  } else {
    await A.p.evaluate(() => { AMStudio.loadDeck(AMStudio.newDeck(), null); });
    for (const g of GROUPS) { log('construindo grupo', g); const t = await BUILD[g](A.p, catA); tags = tags.concat(t); log(' ', g, '→', t.length, 'itens; slides agora:', await A.p.evaluate(() => AMStudio.deck.slides.length)); }
    deckJson = await A.p.evaluate(() => JSON.stringify(AMStudio.deck));
  }
  fs.writeFileSync(path.join(OUT, 'deck-prova.json'), deckJson); fs.writeFileSync(path.join(OUT, 'tags.json'), JSON.stringify(tags));
  report.deck = { slides: JSON.parse(deckJson).slides.length, bytes: deckJson.length, tags: tags.length, notApplied: tags.filter((t) => t.applied === false).length, notInserted: tags.filter((t) => t.inserted === 0).length, buildErrors: tags.filter((t) => t.err) };
  log('deck de prova:', JSON.stringify({ slides: report.deck.slides, bytes: report.deck.bytes, notApplied: report.deck.notApplied, notInserted: report.deck.notInserted, errs: report.deck.buildErrors.length }));

  /* 3. recarregar A e B do zero (simetria total: a construção e a leitura do catálogo avançaram contadores e temporizadores) e carregar o MESMO deck */
  await A.ctx.close(); const A2 = await openPage(browser, A_PATH, 'A'); A.ctx = A2.ctx; A.p = A2.p; A.errs.push(...A2.errs);
  await B.ctx.close(); const B2 = await openPage(browser, B_PATH, 'B'); B.ctx = B2.ctx; B.p = B2.p; B.errs.push(...B2.errs);
  await loadDeck(A.p, deckJson); await loadDeck(B.p, deckJson);
  const normA = await A.p.evaluate(() => JSON.stringify(AMStudio.deck)), normB = await B.p.evaluate(() => JSON.stringify(AMStudio.deck));
  report.deckNormalizedSame = normA === normB; if (!report.deckNormalizedSame) report.mismatches.push({ layer: 'deck', detail: 'o deck normalizado (safeDeck) difere entre A e B' });
  const N = JSON.parse(normA).slides.length;
  const byIndex = {}; tags.forEach((t) => { if (t.i != null) byIndex[t.i] = t; });

  /* 4. por slide: DOM, raster, quadros do player */
  let domSame = 0, rasterSame = 0, framesSame = 0, framesTotal = 0, trSame = 0, trTotal = 0, idOnly = 0, barChecks = 0, barAntialias = 0, framesNoise = 0, trNoise = 0, retried = 0, unstable = 0;
  /* Envelope de RUÍDO INTRÍNSECO do Chromium, calibrado comparando o original consigo mesmo (base-anims: 2 quadros em 135, ambos em
     bordas de clip-path — íris 43 px/máx 49, diagonal 174 px/máx 11). Nada abaixo deste envelope pode ser atribuído ao candidato;
     mesmo assim cada caso é listado no relatório e tem a imagem de diferença gravada. Raster e DOM continuam exigindo igualdade exata. */
  const NOISE = { px: 300, pct: 0.05, maxCh: 64 }; report.noise = []; report.noiseEnvelope = NOISE; report.unstable = [];
  const normIds = (h) => h.replace(/\b(gg|gr|gc|cl|mk|am|fx|sw|ic)[0-9a-z]{1,6}\b/g, (m, pfx) => pfx + '#');
  const ONLY = args.only ? new Set(String(args.only).split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x))) : null;
  const wr = (name, buf) => fs.writeFileSync(path.join(OUT, 'diff', name), buf);
  async function compareSlide(i, tag, attempt) {
    const row = { i, it: tag.it, kind: tag.kind, name: tag.name }; const mism = [], noise = [], files = []; const n = { dom: 0, raster: 0, frames: 0, framesTotal: 0, tr: 0, trTotal: 0, idOnly: 0, barChecks: 0, barAntialias: 0, framesNoise: 0, trNoise: 0 };
    /* relógios de A e B no MESMO instante antes do DOM: ids gerados com Date.now() (quadros de post-its etc.) saem iguais */
    await pauseClockAt(A.p, anchorFor(i, 0, attempt)); await pauseClockAt(B.p, anchorFor(i, 0, attempt));
    const [dA, dB] = await Promise.all([domOf(A.p, i), domOf(B.p, i)]); row.dom = dA === dB;
    if (!row.dom && normIds(dA) === normIds(dB)) { row.dom = true; row.domIdsOnly = true; n.idOnly++; }
    if (row.dom) n.dom++; else { mism.push({ layer: 'dom', i, it: tag.it }); files.push([`${i}-dom-a.html`, dA], [`${i}-dom-b.html`, dB]); }
    for (const X of [A, B]) { try { await X.p.clock.resume(); } catch (e) { } }   /* o raster (caminho do PDF) usa temporizadores reais */
    const [rA, rB] = await Promise.all([rasterOf(A.p, i), rasterOf(B.p, i)]);
    if (rA === rB) { row.raster = true; n.raster++; } else { const bufA = b64png(rA), bufB = b64png(rB); const d = await pixelDiff(bufA, bufB); row.raster = d.same; row.rasterPct = d.pct; if (d.same) n.raster++; else { mism.push({ layer: 'raster', i, it: tag.it, pct: d.pct, px: d.px }); files.push([`${i}-raster-a.png`, bufA], [`${i}-raster-b.png`, bufB]); if (d.diffPng) files.push([`${i}-raster-diff.png`, d.diffPng]); } }
    if (FRAMES) {
      const fA = await framesOf(A.p, i, FRAME_T, attempt), fB = await framesOf(B.p, i, FRAME_T, attempt);
      row.frames = [];
      for (let k = 0; k < FRAME_T.length; k++) {
        if (fA[k].barPng && fB[k].barPng && !fA[k].barPng.equals(fB[k].barPng)) { const bd = await pixelDiff(fA[k].barPng, fB[k].barPng); n.barChecks++; if (bd.pct > 0.05 || bd.maxCh > 16) { mism.push({ layer: 'player-bar', i, it: tag.it, t: FRAME_T[k], pct: bd.pct, maxCh: bd.maxCh }); if (bd.diffPng) files.push([`${i}-bar${FRAME_T[k]}-diff.png`, bd.diffPng]); } else n.barAntialias++; }
        n.framesTotal++; if (fA[k].png.equals(fB[k].png)) { n.frames++; row.frames.push(true); continue; }
        const d = await pixelDiff(fA[k].png, fB[k].png); row.frames.push(d.same ? true : d.pct); if (d.same) { n.frames++; continue; }
        if (d.px <= NOISE.px && d.pct <= NOISE.pct && d.maxCh <= NOISE.maxCh) { n.framesNoise++; row.frames[row.frames.length - 1] = 'ruido'; noise.push({ layer: 'frame', i, it: tag.it, t: FRAME_T[k], pct: d.pct, px: d.px, maxCh: d.maxCh }); if (d.diffPng) files.push([`${i}-frame${FRAME_T[k]}-ruido-diff.png`, d.diffPng]); }
        else { mism.push({ layer: 'frame', i, it: tag.it, t: FRAME_T[k], pct: d.pct, px: d.px, maxCh: d.maxCh }); files.push([`${i}-frame${FRAME_T[k]}-a.png`, fA[k].png], [`${i}-frame${FRAME_T[k]}-b.png`, fB[k].png]); if (d.diffPng) files.push([`${i}-frame${FRAME_T[k]}-diff.png`, d.diffPng]); }
      }
      if (tag.kind === 'tr' && i > 0) {
        const tA = await trFramesOf(A.p, i, TR_T, attempt), tB = await trFramesOf(B.p, i, TR_T, attempt); row.tr = [];
        for (let k = 0; k < TR_T.length; k++) { n.trTotal++; if (tA[k].png.equals(tB[k].png)) { n.tr++; row.tr.push(true); continue; } const d = await pixelDiff(tA[k].png, tB[k].png); row.tr.push(d.same ? true : d.pct); if (d.same) { n.tr++; continue; }
          if (d.px <= NOISE.px && d.pct <= NOISE.pct && d.maxCh <= NOISE.maxCh) { n.trNoise++; row.tr[row.tr.length - 1] = 'ruido'; noise.push({ layer: 'transition', i, it: tag.it, t: TR_T[k], pct: d.pct, px: d.px, maxCh: d.maxCh }); if (d.diffPng) files.push([`${i}-tr${TR_T[k]}-ruido-diff.png`, d.diffPng]); }
          else { mism.push({ layer: 'transition', i, it: tag.it, t: TR_T[k], pct: d.pct, px: d.px, maxCh: d.maxCh }); files.push([`${i}-tr${TR_T[k]}-a.png`, tA[k].png], [`${i}-tr${TR_T[k]}-b.png`, tB[k].png]); if (d.diffPng) files.push([`${i}-tr${TR_T[k]}-diff.png`, d.diffPng]); } }
      }
    }
    return { row, mism, noise, files, n };
  }
  const idx = [...Array(N).keys()].filter((i) => !ONLY || ONLY.has(i)); report.only = ONLY ? idx : null;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]; const tag = byIndex[i] || { it: 'slide:' + i, kind: 'outro', name: '' };
    let r = await compareSlide(i, tag, 1);
    if (r.mism.length) {
      /* Divergência na 1ª captura → recaptura imediata, UMA vez, com faixa própria do relógio. Uma diferença REAL entre A e B (CSS/JS/DOM
         diferentes) reproduz na hora; instabilidade de captura (compositor atrasado sob carga, animação criada entre a fixação e a foto) não.
         A 1ª tentativa fica gravada com sufixo -t1 e o slide entra na lista de "capturas instáveis" do relatório: nada é escondido. */
      retried++; log(`  slide ${i + 1} (${tag.it}): ${r.mism.length} divergência(s) na 1ª captura [${r.mism.map((m) => m.layer + (m.t != null ? '@' + m.t : '')).join(', ')}] → recapturando`);
      const first = r; r = await compareSlide(i, tag, 2);
      for (const [name, buf] of first.files) wr(name.replace(/^(\d+)-/, '$1-t1-'), buf);
      if (!r.mism.length) { unstable++; report.unstable.push({ i, it: tag.it, first: first.mism.map((m) => ({ layer: m.layer, t: m.t, pct: m.pct, px: m.px, maxCh: m.maxCh })) }); r.row.unstableFirstCapture = true; log(`  slide ${i + 1}: recaptura idêntica → captura instável (não atribuível ao candidato)`); }
      else { r.row.retried = true; log(`  slide ${i + 1}: divergência REPRODUZIDA na recaptura`); }
    }
    for (const [name, buf] of r.files) wr(name, buf);
    report.mismatches.push(...r.mism); report.noise.push(...r.noise); report.slides.push(r.row);
    domSame += r.n.dom; rasterSame += r.n.raster; framesSame += r.n.frames; framesTotal += r.n.framesTotal; trSame += r.n.tr; trTotal += r.n.trTotal; idOnly += r.n.idOnly; barChecks += r.n.barChecks; barAntialias += r.n.barAntialias; framesNoise += r.n.framesNoise; trNoise += r.n.trNoise;
    if (k % 25 === 0 || k === idx.length - 1) log(`slide ${i + 1}/${N}${ONLY ? ' (' + (k + 1) + '/' + idx.length + ')' : ''} · dom ${domSame} · raster ${rasterSame} · quadros ${framesSame}/${framesTotal} · transições ${trSame}/${trTotal} · divergências ${report.mismatches.length} · recapturas ${retried} (instáveis ${unstable})`);
  }
  const NC = idx.length;   /* slides comparados (todos, salvo --only) */

  /* 5. exportações: HTML, PPTX */
  const exA = await A.p.evaluate(() => AMStudio.exportHTML()), exB = await B.p.evaluate(() => AMStudio.exportHTML());
  report.exportHtml = { same: exA === exB, shaA: sha(exA).slice(0, 16), shaB: sha(exB).slice(0, 16), bytes: exA.length }; if (!report.exportHtml.same) { report.mismatches.push({ layer: 'export-html' }); fs.writeFileSync(path.join(OUT, 'diff', 'export-a.html'), exA); fs.writeFileSync(path.join(OUT, 'diff', 'export-b.html'), exB); }
  async function pptx(p) { return p.evaluate(async () => { const b = await AMExport.pptxBuild(AMStudio.deck, { includeHidden: true, mode: 'editable' }); if (!b) return null; const ab = await b.arrayBuffer(); let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }); }
  try {
    const [pA, pB] = [await pptx(A.p), await pptx(B.p)];
    if (pA && pB) {
      fs.writeFileSync(path.join(OUT, 'a.pptx'), Buffer.from(pA, 'base64')); fs.writeFileSync(path.join(OUT, 'b.pptx'), Buffer.from(pB, 'base64'));
      const py = `import zipfile,hashlib,sys,json\nout={}\nfor t in ('a','b'):\n  z=zipfile.ZipFile(sys.argv[1]+'/'+t+'.pptx'); out[t]={n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n!='docProps/core.xml'}\nsame=out['a']==out['b']\ndiff=[n for n in set(out['a'])|set(out['b']) if out['a'].get(n)!=out['b'].get(n)]\nprint(json.dumps({'same':same,'entries':len(out['a']),'diff':sorted(diff)[:30]}))`;
      const r = JSON.parse(execFileSync('python3', ['-I', '-c', py, OUT]).toString()); report.exportPptx = r; if (!r.same) report.mismatches.push({ layer: 'export-pptx', diff: r.diff });
    } else report.exportPptx = { same: null, note: 'pptxBuild devolveu null em A ou B' };
  } catch (e) { report.exportPptx = { same: null, error: String(e.message).slice(0, 200) }; }

  report.errors = A.errs.concat(B.errs).concat((await A.p.evaluate(() => window.__amErrors)).map((e) => 'A: ' + e), (await B.p.evaluate(() => window.__amErrors)).map((e) => 'B: ' + e));
  report.summary = { slides: N, compared: NC, retriedSlides: retried, unstableCaptures: unstable, framesNoiseClass: framesNoise, transitionsNoiseClass: trNoise, playerBarAntialiasOnly: barAntialias, domIdenticalExceptCounterIds: idOnly, domIdentical: domSame, rasterIdentical: rasterSame, framesIdentical: framesSame, framesTotal, transitionsIdentical: trSame, transitionsTotal: trTotal, mismatches: report.mismatches.length, durationS: Math.round((Date.now() - t0) / 1000), identical: report.mismatches.length === 0 && catSame && report.runtime.cssSame && report.runtime.jsSame && report.deckNormalizedSame && report.exportHtml.same };
  fs.writeFileSync(path.join(OUT, 'relatorio.json'), JSON.stringify(report, null, 1));
  const md = [`# Prova de paridade — ${path.basename(A_PATH)} × ${path.basename(B_PATH)}`, '', `Gerado em ${new Date().toISOString()} por \`platform/tools/parity.cjs\` (duração ${report.summary.durationS} s). **Resultado: ${report.summary.identical ? 'IDÊNTICO' : 'DIVERGÊNCIAS ENCONTRADAS'}**`, '',
    `| Camada | Resultado |`, `|---|---|`,
    `| Catálogo da gaveta (ids dos ${report.catalog.gx} itens: ${Object.entries(report.catalog.byFam).map(([k, v]) => k + ' ' + v).join(', ')}) + biblioteca ${report.catalog.biblioteca} + ícones ${report.catalog.icons} + transformações ${report.catalog.morphs} + layouts ${report.catalog.layouts} + blocos ${report.catalog.seqs} + SmartArt ${report.catalog.smart} | ${catSame ? 'idêntico' : 'DIFERENTE'} |`,
    `| Runtime embutido (CSS ${report.runtime.cssBytes} B, JS ${report.runtime.jsBytes} B) | ${report.runtime.cssSame && report.runtime.jsSame ? 'idêntico (sha ' + report.runtime.cssSha + ' / ' + report.runtime.jsSha + ')' : 'DIFERENTE'} |`,
    `| Deck de prova normalizado (${N} slides, ${Math.round(report.deck.bytes / 1024)} KB) | ${report.deckNormalizedSame ? 'idêntico' : 'DIFERENTE'} |`,
    `| DOM renderizado por slide | ${domSame}/${NC} idênticos${idOnly ? ' (' + idOnly + ' só com ids internos de contador diferentes, sem efeito visual)' : ''} |`, `| Raster 1280×720 por slide (caminho do PDF) | ${rasterSame}/${NC} idênticos |`,
    FRAMES ? `| Quadros do player — palco do slide (t = ${FRAME_T.join(', ')} ms) | ${framesSame}/${framesTotal} idênticos pixel a pixel${framesNoise ? ' + ' + framesNoise + ' dentro do envelope de ruído do Chromium (bordas de máscara: ≤ ' + NOISE.px + ' px, ≤ ' + NOISE.pct + ' %, ≤ ' + NOISE.maxCh + '/255), listados abaixo' : ''} |` : '| Quadros do player | não medidos (--no-frames) |',
    FRAMES ? `| Barra de controles do player | ${barAntialias ? barAntialias + ' quadros só com antialias de texto (≤ 16/255 por canal, ≤ 0,05 % dos pixels); ' : ''}${report.mismatches.filter((m) => m.layer === 'player-bar').length} divergências reais |` : '',
    FRAMES ? `| Quadros de transição (t = ${TR_T.join(', ')} ms após avançar) | ${trSame}/${trTotal} idênticos${trNoise ? ' + ' + trNoise + ' no envelope de ruído' : ''} |` : '',
    `| HTML exportado (${Math.round(report.exportHtml.bytes / 1024)} KB) | ${report.exportHtml.same ? 'idêntico (sha ' + report.exportHtml.shaA + ')' : 'DIFERENTE'} |`,
    `| PowerPoint exportado | ${report.exportPptx && report.exportPptx.same === true ? 'idêntico (' + report.exportPptx.entries + ' entradas, exceto a data em docProps/core.xml)' : report.exportPptx && report.exportPptx.same === false ? 'DIFERENTE: ' + report.exportPptx.diff.join(', ') : 'não medido (' + ((report.exportPptx || {}).note || (report.exportPptx || {}).error || '') + ')'} |`,
    `| Recapturas | ${retried} slide(s) recapturados após divergência na 1ª captura; ${unstable} com recaptura idêntica (captura instável, listados abaixo; imagens em diff/*-t1-*); ${retried - unstable} com divergência reproduzida |`,
    `| Erros de console/página | ${report.errors.length} |`, '',
    `Itens não aplicados/inseridos na construção: ${report.deck.notApplied} animações sem alvo compatível (esperado para transições/alvos específicos), ${report.deck.notInserted} caixas sem inserção, ${report.deck.buildErrors.length} erros.`, '',
    report.unstable.length ? '## Capturas instáveis (divergência só na 1ª captura; recaptura imediata idêntica — não atribuível ao candidato)\n\n' + report.unstable.map((u) => `- slide ${u.i + 1} · ${u.it} · 1ª captura: ${u.first.map((m) => m.layer + (m.t != null ? ' t=' + m.t + ' ms' : '') + (m.px != null ? ' (' + m.px + ' px, máx ' + m.maxCh + '/255)' : '')).join('; ')}`).join('\n') + '\n' : '',
    report.noise.length ? '## Quadros dentro do envelope de ruído (não atribuíveis ao candidato; imagens em diff/*-ruido-diff.png)\n\n' + report.noise.map((m) => `- ${m.layer} · slide ${m.i + 1} · ${m.it} · t=${m.t} ms · ${m.px} px (${m.pct} %), máx ${m.maxCh}/255`).join('\n') + '\n' : '',
    report.mismatches.length ? '## Divergências\n\n' + report.mismatches.slice(0, 200).map((m) => `- ${m.layer} · slide ${m.i != null ? m.i + 1 : '-'} · ${m.it || m.detail || ''}${m.t != null ? ' · t=' + m.t + ' ms' : ''}${m.pct != null ? ' · ' + m.pct + '% dos pixels' : ''}`).join('\n') : '## Divergências\n\nNenhuma.',
    '', '## Itens por categoria', '', ...Object.entries(report.slides.reduce((o, r) => (o[r.kind] = (o[r.kind] || 0) + 1, o), {})).map(([k, v]) => `- ${k}: ${v} slides`)].filter((l) => l !== '').join('\n');
  fs.writeFileSync(path.join(OUT, 'relatorio.md'), md);
  console.log(JSON.stringify(report.summary));
  await browser.close();
  process.exit(report.summary.identical ? 0 : 1);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
