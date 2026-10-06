/* inst-check.js — harness dos slides institucionais (S34): desenha um slide descrito em JSON com o editor montado e compara com a
   imagem de referência (1280×720). Uso: node tools/inst-check.js <spec.json> <ref.png> <out-prefix>
   spec.json = { "bg": "#002B49", "bgImg": "<caminho de imagem opcional>", "bgImgOp": 1, "els": [ ...elementos do Canteiro... ] }
   Elementos: texto {type:'text', x,y,w,h, html, font ('Roboto'|'Roboto Condensed'|'Inter'), size, weight (300|400|500|700), color,
   align ('left'|'center'|'right'), valign ('top'|'middle'|'bottom'), lh, ls, upper:true}; linha {type:'line', x1,y1,x2,y2, stroke,
   strokeW, headEnd:false}; forma {type:'shape', shape:'rect'|'round'|…, x,y,w,h, fill, stroke, strokeW, html:'', radius};
   imagem {type:'image', src:'<caminho ou data:>', x,y,w,h, fit:'contain'|'cover'}; marca {type:'brand', key:'wmW'|'perfW'|'perfN'|'wmN', x,y,h}.
   Saída: <out-prefix>.png (render), <out-prefix>-cmp.png (referência | render | diferença) e uma linha JSON no stdout:
   {"match": % de pixels iguais a ±40 por canal, "mean": diferença média, "worst": caixas 160×90 com pior diferença [{x,y,mean}]} */
process.env.NODE_PATH = '/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const STUDIO = path.join(__dirname, '..');
const FILE = 'file://' + path.join(STUDIO, 'AM-Studio-Editor.html');
const FONTS = process.env.AM_FONTS_DIR || path.join(STUDIO, '..', 'fonts2');
const ACAO = { 'Access-Control-Allow-Origin': '*' };
const [specP, refP, outP] = process.argv.slice(2);
if (!specP || !refP || !outP) { console.error('uso: node tools/inst-check.js spec.json ref.png out-prefix'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function dataUrl(p) { if (/^data:/.test(p)) return p; const ext = path.extname(p).slice(1).toLowerCase(); const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/' + ext; return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64'); }
(async () => {
  const spec = JSON.parse(fs.readFileSync(specP, 'utf8'));
  const b = await chromium.launch({ args: ['--disable-lcd-text'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load/.test(m.text())) errs.push(m.text()); });
  if (fs.existsSync(path.join(FONTS, 'gf.css'))) {
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', headers: ACAO, body: fs.readFileSync(path.join(FONTS, 'gf.css'), 'utf8') }));
    await p.route('https://fonts.gstatic.com/**', r => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', headers: ACAO, body: fs.readFileSync(f) }) : r.abort(); });
  }
  await p.goto(FILE + '?nocover'); await sleep(900);
  if (spec.bgImg && !/^data:/.test(spec.bgImg)) spec.bgImg = dataUrl(path.resolve(path.dirname(specP), spec.bgImg));
  (spec.els || []).forEach(e => { if (e.type === 'image' && e.src && !/^data:/.test(e.src)) e.src = dataUrl(path.resolve(path.dirname(specP), e.src)); });
  const refB64 = fs.readFileSync(refP).toString('base64');
  const res = await p.evaluate(async ([spec, refB64]) => {
    const A = AMStudio, mk = A.mk, d = A.newDeck(); const s = mk.slide('blank-light'); s.els = []; s.bg = spec.bg || '#FFFFFF';
    if (spec.bgImg) { s.bgImg = spec.bgImg; s.bgImgOp = spec.bgImgOp == null ? 1 : spec.bgImgOp; }
    let n = 0;
    for (const e of spec.els || []) {
      let el;
      if (e.type === 'text') { el = mk.text('body'); delete el.font; delete el.size; delete el.weight; delete el.lh; }
      else if (e.type === 'line') el = mk.line(!!e.headEnd);
      else if (e.type === 'shape') el = mk.shape(e.shape || 'rect');
      else if (e.type === 'image') el = mk.image(e.src, e.nw || 1600, e.nh || 900);
      else if (e.type === 'brand') { const R = { perfW: 743 / 134, perfN: 743 / 134, wmW: 262 / 42, wmN: 262 / 42 }; el = mk.brand(e.key || 'wmW', { x: e.x, y: e.y, h: e.h || 22 }); el.w = Math.round((R[e.key || 'wmW'] || 262 / 42) * el.h); }
      else continue;
      const o = Object.assign({}, e); delete o.type; delete o.shape; delete o.key; delete o.src; delete o.nw; delete o.nh;
      if (e.type === 'image') o.src = e.src;
      Object.assign(el, o); el.anim = { in: 'none' }; s.els.push(el); n++;
    }
    d.slides = [s]; A.loadDeck(d, null); await new Promise(r => setTimeout(r, 400));
    const rr = await AMExport.rasterSlide(A.deck.slides[0], { scale: 1, type: 'png' }); const c = rr.canvas; const g = c.getContext('2d');
    const png = c.toDataURL('image/png'); const img = g.getImageData(0, 0, 1280, 720).data;
    const ref = await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + refB64; });
    const rc = document.createElement('canvas'); rc.width = 1280; rc.height = 720; const rg = rc.getContext('2d'); rg.drawImage(ref, 0, 0, 1280, 720); const rd = rg.getImageData(0, 0, 1280, 720).data;
    let same = 0, tot = 1280 * 720, sum = 0; const boxes = {};
    const dc = document.createElement('canvas'); dc.width = 1280; dc.height = 720; const dg = dc.getContext('2d'); const dd = dg.createImageData(1280, 720);
    for (let i = 0; i < tot; i++) { const k = i * 4; const dr = Math.abs(img[k] - rd[k]), dgg = Math.abs(img[k + 1] - rd[k + 1]), db = Math.abs(img[k + 2] - rd[k + 2]); const m = (dr + dgg + db) / 3; sum += m; if (dr <= 40 && dgg <= 40 && db <= 40) same++; const bx = Math.floor((i % 1280) / 160), by = Math.floor(Math.floor(i / 1280) / 90); const key = bx + ',' + by; boxes[key] = (boxes[key] || 0) + m; dd.data[k] = 255; dd.data[k + 1] = 255 - Math.min(255, m * 3); dd.data[k + 2] = 255 - Math.min(255, m * 3); dd.data[k + 3] = 255; }
    dg.putImageData(dd, 0, 0);
    const worst = Object.keys(boxes).map(k => ({ x: +k.split(',')[0] * 160, y: +k.split(',')[1] * 90, mean: Math.round(boxes[k] / (160 * 90) * 10) / 10 })).sort((a, b) => b.mean - a.mean).slice(0, 6);
    const cmp = document.createElement('canvas'); cmp.width = 1280 * 3 + 20; cmp.height = 720; const cg = cmp.getContext('2d'); cg.fillStyle = '#888'; cg.fillRect(0, 0, cmp.width, cmp.height); cg.drawImage(rc, 0, 0); cg.drawImage(c, 1290, 0); cg.drawImage(dc, 2580, 0);
    return { png, cmp: cmp.toDataURL('image/png'), match: Math.round(same / tot * 1000) / 10, mean: Math.round(sum / tot * 10) / 10, worst, n };
  }, [spec, refB64]);
  fs.writeFileSync(outP + '.png', Buffer.from(res.png.split(',')[1], 'base64'));
  fs.writeFileSync(outP + '-cmp.png', Buffer.from(res.cmp.split(',')[1], 'base64'));
  console.log(JSON.stringify({ match: res.match, mean: res.mean, worst: res.worst, elements: res.n, errors: errs }));
  await b.close();
})().catch(e => { console.error('ERRO', e); process.exit(2); });
