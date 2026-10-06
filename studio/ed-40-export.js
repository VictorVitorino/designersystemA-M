/* ===== S22 · Exportar: motor de imagem dos slides, PDF direto (imagem idêntica + texto pesquisável), PDF pelo navegador
   (vetorial, texto selecionável) e a caixa “Salvar como PDF”. Só no editor: não vai para o arquivo exportado.
   window.AMExport = {
     rasterSlide(slide, {scale, type:'jpeg'|'png', quality, bg}) → Promise<{canvas, blob, width, height, texts}>
         o slide no estado final (sem animações), 1280×720 lógicos × scale, desenhado pelo próprio navegador: o palco estático
         (AMRT.renderSlide play:false) vai para um <foreignObject> de SVG com o CSS do runtime, as folhas “Cores do componente”
         (am-pal-*) e as fontes embutidas (data:), e o SVG é pintado num canvas. texts = linhas de texto [{t, x, y, w, h, fs}] em px lógicos.
     rasterEls(slide, els, box, {scale}) → Promise<{canvas, blob, width, height, box}>   PNG transparente só desses elementos,
         recortado em box {x, y, w, h} (px lógicos; sem box = a caixa que envolve os elementos). Para o PowerPoint (S23).
     fontsCSS({text, families}) → Promise<string>   @font-face com as fontes do Google embutidas (data:), cache da sessão.
     visibleSlides(deck, includeHidden) → [slide]   slides na ordem, sem os ocultos (slide.hidden === true) salvo includeHidden.
     pick(deck, {range:'all'|'cur'|'span', from, to, cur, includeHidden}) → [{slide, index}]
     pdf(deck, {range…, scale, quality, onProgress(i, n), signal:{cancelled}}) → Promise<Blob|null>   (null = cancelado)
     preparePrint(deck, opts) → {count, cleanup()}   ·   print(deck, opts) → abre a impressão do navegador
     openDialog(mode 'pdf'|'print', opener) · closeDialog() · isOpen()
   } */
window.AMExport = (function () {
  'use strict';
  var RT = window.AMRT, W = 1280, H = 720, XHTML = 'http://www.w3.org/1999/xhtml';
  function S() { return window.AMStudio; }
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function xmlText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function toast(m) { var A = S(); if (A && A.toast) A.toast(m); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function frame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }

  /* ---------------- fontes: o CSS do Google Fonts da própria página, cada woff2 vira data: (cache da sessão) ---------------- */
  var facesBy = {}, fontData = {}, warned = false; /* S29: uma lista de @font-face por <link> do Google (o base do editor + os das fontes do kit) */
  function warnFonts() { if (warned) return; warned = true; toast('Sem acesso às fontes da internet: o arquivo pode sair com outra fonte'); }
  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('tempo esgotado')); }, ms); })]); }
  function gfHrefs() { return [].map.call(document.querySelectorAll('link[rel=stylesheet][href^="https://fonts.googleapis.com/"]'), function (l) { return l.href; }); }
  /* unicode-range "U+0000-00FF, U+0131" → [[0,255],[305,305]] */
  function ranges(s) {
    if (!s) return [[0, 0x10FFFF]];
    return s.split(',').map(function (p) { p = p.trim().replace(/^U\+/i, ''); var m = p.split('-'); if (p.indexOf('?') >= 0) return [parseInt(p.replace(/\?/g, '0'), 16), parseInt(p.replace(/\?/g, 'F'), 16)]; return [parseInt(m[0], 16), parseInt(m[1] || m[0], 16)]; })
      .filter(function (r) { return isFinite(r[0]) && isFinite(r[1]); });
  }
  function loadFaces() {
    var hs = gfHrefs(); if (!hs.length) return Promise.resolve([]);
    return Promise.all(hs.map(facesOf)).then(function (r) { return [].concat.apply([], r); });
  }
  function facesOf(href) {
    var o = facesBy[href];
    if (o && o.failAt && Date.now() - o.failAt > 60000) o = null; /* sem internet: tenta de novo depois de 1 min, não a cada slide */
    if (o) return o.p;
    o = facesBy[href] = { failAt: 0 };
    o.p = withTimeout(fetch(href).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }), 10000).then(function (css) {
      var out = {}, re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g, m;
      while ((m = re.exec(css))) {
        var b = m[2], g = function (k) { var x = new RegExp(k + '\\s*:\\s*([^;]+);?', 'i').exec(b); return x ? x[1].trim() : ''; };
        var fam = g('font-family').replace(/^['"]|['"]$/g, ''), url = (/url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(b) || [])[1];
        if (!fam || !url) continue;
        var wt = g('font-weight') || '400', st = g('font-style') || 'normal', ur = g('unicode-range'), w = wt.split(/\s+/).map(Number);
        var k = fam + '|' + st + '|' + url + '|' + ur, f = out[k];
        if (!f) f = out[k] = { family: fam, style: st, url: url, range: ur, ranges: ranges(ur), subset: m[1] || '', w0: w[0], w1: w[w.length - 1] };
        f.w0 = Math.min(f.w0, w[0]); f.w1 = Math.max(f.w1, w[w.length - 1]);
      }
      return Object.keys(out).map(function (k) { return out[k]; });
    }).catch(function () { warnFonts(); o.failAt = Date.now(); return []; });
    return o.p;
  }
  function dataOf(url) {
    if (!fontData[url]) {
      fontData[url] = withTimeout(fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); }), 15000).then(function (bl) {
        return new Promise(function (res, rej) { var fr = new FileReader(); fr.addEventListener('load', function () { res(String(fr.result).replace(/^data:[^;,]*/, 'data:font/woff2')); }); fr.addEventListener('error', function () { rej(fr.error); }); fr.readAsDataURL(bl); });
      }).catch(function () { delete fontData[url]; warnFonts(); return null; });
    }
    return fontData[url];
  }
  function hitsText(f, codes) {
    if (f.subset === 'latin') return true; /* sempre: português, números e pontuação */
    for (var i = 0; i < codes.length; i++) for (var j = 0; j < f.ranges.length; j++) if (codes[i] >= f.ranges[j][0] && codes[i] <= f.ranges[j][1]) return true;
    return false;
  }
  /* opts.text: só os subconjuntos (latin, latin-ext, cyrillic…) com algum caractere do texto (latin sempre) · opts.families: só essas famílias */
  function fontsCSS(opts) {
    opts = opts || {};
    var codes = null;
    if (opts.text != null) { var seen = {}; codes = []; String(opts.text).replace(/[\s\S]/gu, function (c) { var n = c.codePointAt(0); if (n > 126 && !seen[n]) { seen[n] = 1; codes.push(n); } return c; }); }
    return loadFaces().then(function (list) {
      var use = list.filter(function (f) { return (!opts.families || opts.families.indexOf(f.family.toLowerCase()) >= 0) && (codes ? hitsText(f, codes) : (f.subset === 'latin' || f.subset === 'latin-ext' || !f.subset)); });
      return Promise.all(use.map(function (f) { return dataOf(f.url); })).then(function (ds) {
        return use.map(function (f, i) {
          if (!ds[i]) return '';
          return "@font-face{font-family:'" + f.family + "';font-style:" + f.style + ';font-weight:' + f.w0 + (f.w1 !== f.w0 ? ' ' + f.w1 : '') + ";src:url(" + ds[i] + ") format('woff2')" + (f.range ? ';unicode-range:' + f.range : '') + '}';
        }).join('\n');
      });
    });
  }

  /* ---------------- palco estático fora da tela (1280×720 CSS px, o mesmo CSS herdado do palco do editor) ---------------- */
  var host = null;
  function getHost() {
    if (host && host.isConnected) return host;
    host = document.createElement('div'); host.id = 'amxHost'; host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-40000px;top:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;pointer-events:none;z-index:-1';
    document.body.appendChild(host); return host;
  }
  function mountStage(slide) {
    var st = RT.renderSlide(slide, { play: false });
    st.classList.remove('am-edit'); st.classList.add('am-export'); /* dicas só do editor (SmartArt vazio, árvore vazia…) não saem no PDF/PowerPoint */
    st.style.width = W + 'px'; st.style.height = H + 'px'; st.style.aspectRatio = 'auto';
    getHost().appendChild(st); return st;
  }
  /* fontes que o palco usa: primeira família de cada pilha (Inter, Roboto…), em minúsculas */
  function usedFamilies(st) {
    var out = {}, all = [st].concat([].slice.call(st.querySelectorAll('*')));
    all.forEach(function (e) { var f = getComputedStyle(e).fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase(); if (f) out[f] = 1; });
    return Object.keys(out);
  }
  /* imagens que não são data: (http, blob) viram data: — um SVG pintado em canvas não busca nada fora dele */
  function toData(url) {
    return withTimeout(fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); }), 15000)
      .then(function (bl) { return new Promise(function (res) { var fr = new FileReader(); fr.addEventListener('load', function () { res(String(fr.result)); }); fr.addEventListener('error', function () { res(null); }); fr.readAsDataURL(bl); }); })
      .catch(function () { return null; });
  }
  function inlineImages(st) {
    var jobs = [];
    st.querySelectorAll('img[src]').forEach(function (im) { var s = im.getAttribute('src'); if (/^(https?|blob):/i.test(s)) jobs.push(toData(s).then(function (d) { if (d) im.setAttribute('src', d); })); });
    st.querySelectorAll('[style*="url("]').forEach(function (e) {
      var m = /url\(["']?((?:https?|blob):[^"')]+)["']?\)/i.exec(e.getAttribute('style') || ''); if (!m) return;
      jobs.push(toData(m[1]).then(function (d) { if (d) e.setAttribute('style', e.getAttribute('style').split(m[1]).join(d)); }));
    });
    return Promise.all(jobs);
  }
  function waitImages(st) {
    /* 8 s por imagem: uma foto que nunca termina de carregar não trava a exportação (ela sai sem essa foto) */
    return Promise.all([].slice.call(st.querySelectorAll('img')).map(function (im) { return im.decode ? withTimeout(im.decode(), 8000).catch(function () { }) : null; }));
  }
  /* CSS do palco: runtime (com os rt-*.css), cores de componente, e o que o editor aplica a todo o documento */
  var rtCSS = { src: null, out: '' };
  function sheetCSS() {
    var src = ($('#am-runtime-css') || {}).textContent || '';
    if (rtCSS.src !== src) { rtCSS.src = src; rtCSS.out = xmlText('*{box-sizing:border-box}button{font:inherit;color:inherit;background:none;border:0}\n' + src); }
    var css = '';
    document.querySelectorAll('style[data-am-pal]').forEach(function (s) { css += '\n' + s.textContent; });
    return rtCSS.out + xmlText(css); /* já escapado para XML (& e <) */
  }
  /* herança do editor: o palco do editor herda fonte, tamanho, cor e altura de linha do <body> */
  function inherited() {
    var cs = getComputedStyle(getHost());
    return 'font-family:' + cs.fontFamily.replace(/"/g, "'") + ';font-size:' + cs.fontSize + ';line-height:' + cs.lineHeight + ';color:' + cs.color + ';letter-spacing:' + cs.letterSpacing + ';text-rendering:' + cs.textRendering;
  }
  /* texto que o XML não aceita (controle C0 como o U+000B do Shift+Enter do PowerPoint, U+FFFE/FFFF) some; surrogate sem par vira U+FFFD —
     sem isso o <img> recusa o SVG inteiro (e encodeURIComponent lança URIError), e a exportação toda falhava por um caractere colado */
  function xmlSafe(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD').replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1\uFFFD');
  }
  function svgFor(st, fonts, box, outW, outH) {
    var body = xmlSafe(new XMLSerializer().serializeToString(st)); fonts = xmlSafe(fonts || '');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + outW + '" height="' + outH + '" viewBox="' + box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h + '">' +
      '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '"><div xmlns="' + XHTML + '" style="width:' + W + 'px;height:' + H + 'px;margin:0;' + inherited() + '">' +
      '<style>' + xmlText(fonts) + '\n' + sheetCSS() + '</style>' + body + '</div></foreignObject></svg>';
  }
  function loadImg(svg) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.addEventListener('load', function () { res(im); });
      im.addEventListener('error', function () { rej(new Error('não foi possível desenhar o slide')); });
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  function toBlob(cv, type, q) { return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, type, q); }); }

  /* linhas de texto do palco montado: palavras de cada nó de texto agrupadas por linha (para a camada de texto do PDF) */
  function textRuns(st) {
    var out = [], o = st.getBoundingClientRect(), tw = document.createTreeWalker(st, NodeFilter.SHOW_TEXT), n, rg = document.createRange();
    while ((n = tw.nextNode())) {
      var tx = n.nodeValue; if (!/\S/.test(tx)) continue;
      var pe = n.parentElement; if (!pe || pe.closest('style,script')) continue;
      var cs = getComputedStyle(pe); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      var fs = parseFloat(cs.fontSize) || 12, re = /\S+/g, m, line = null;
      while ((m = re.exec(tx))) {
        rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        var rs = rg.getClientRects(), r = rs[0]; if (!r || r.width < .5 || r.height < .5) continue;
        var x = r.left - o.left, y = r.top - o.top;
        if (x > W || y > H || x + r.width < 0 || y + r.height < 0) continue;
        var word = cs.textTransform === 'uppercase' ? m[0].toUpperCase() : m[0];
        if (line && Math.abs(y - line.y) < r.height * .5 && x >= line.x + line.w - 2) { line.t += ' ' + word; line.w = x + r.width - line.x; line.h = Math.max(line.h, r.height); }
        else { line = { t: word, x: x, y: y, w: r.width, h: r.height, fs: fs }; out.push(line); }
      }
    }
    return out;
  }

  function rasterSlide(slide, o) {
    o = o || {};
    var scale = +o.scale || 1, type = o.type === 'jpeg' ? 'image/jpeg' : 'image/png', st = mountStage(slide), w = Math.round(W * scale), h = Math.round(H * scale);
    var texts = o.texts === false ? null : textRuns(st);
    return Promise.all([fontsCSS({ text: st.textContent, families: usedFamilies(st) }), inlineImages(st)]).then(function (r) {
      return waitImages(st).then(function () { return loadImg(svgFor(st, r[0], { x: 0, y: 0, w: W, h: H }, w, h)); });
    }).then(function (im) {
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var cx = cv.getContext('2d');
      if (o.bg || type === 'image/jpeg') { cx.fillStyle = o.bg || '#FFFFFF'; cx.fillRect(0, 0, w, h); }
      cx.drawImage(im, 0, 0, w, h);
      return toBlob(cv, type, o.quality == null ? .92 : +o.quality).then(function (blob) { return { canvas: cv, blob: blob, width: w, height: h, texts: texts }; });
    }).finally(function () { st.remove(); });
  }
  /* caixa (px lógicos) que envolve elementos: linhas pela caixa do traço; elementos girados pela caixa do desenho girado */
  function boxOf(els) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    els.forEach(function (e) {
      var b = e.type === 'line' ? RT.lineBox(e) : { x: e.x, y: e.y, w: e.w, h: e.h }, t = (+e.rot || 0) * Math.PI / 180;
      if (t && e.type !== 'line') { var c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t)), ww = b.w * c + b.h * s, hh = b.w * s + b.h * c; b = { x: b.x + b.w / 2 - ww / 2, y: b.y + b.h / 2 - hh / 2, w: ww, h: hh }; }
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    if (!isFinite(x0)) return { x: 0, y: 0, w: W, h: H };
    return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
  }
  function rasterEls(slide, els, box, o) {
    o = o || {};
    var all = (slide && slide.els) || [], list = (els || all).map(function (e) { return typeof e === 'string' ? all.filter(function (x) { return x.id === e; })[0] : e; }).filter(Boolean);
    box = box && box.w > 0 && box.h > 0 ? { x: +box.x || 0, y: +box.y || 0, w: +box.w, h: +box.h } : boxOf(list);
    var scale = +o.scale || 2, w = Math.max(1, Math.round(box.w * scale)), h = Math.max(1, Math.round(box.h * scale));
    var st = mountStage({ bg: 'transparent', els: list });
    return Promise.all([fontsCSS({ text: st.textContent, families: usedFamilies(st) }), inlineImages(st)]).then(function (r) {
      return waitImages(st).then(function () { return loadImg(svgFor(st, r[0], box, w, h)); });
    }).then(function (im) {
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(im, 0, 0, w, h);
      return toBlob(cv, 'image/png').then(function (blob) { return { canvas: cv, blob: blob, width: w, height: h, box: box }; });
    }).finally(function () { st.remove(); });
  }

  /* ---------------- quais slides ---------------- */
  function visibleSlides(deck, includeHidden) { return ((deck && deck.slides) || []).filter(function (s) { return includeHidden || s.hidden !== true; }); }
  function pick(deck, o) {
    o = o || {}; var sl = (deck && deck.slides) || [], n = sl.length, out = [];
    if (o.range === 'cur') { var c = Math.max(0, Math.min(n - 1, o.cur | 0)); return n ? [{ slide: sl[c], index: c }] : []; } /* o slide atual sai mesmo se estiver oculto: foi pedido */
    var a = 0, b = n - 1;
    if (o.range === 'span') { a = Math.max(1, Math.min(n, Math.round(+o.from) || 1)) - 1; b = Math.max(1, Math.min(n, Math.round(+o.to) || n)) - 1; if (a > b) { var t = a; a = b; b = t; } }
    for (var i = a; i <= b; i++) if (o.includeHidden || sl[i].hidden !== true) out.push({ slide: sl[i], index: i });
    return out;
  }

  /* ---------------- PDF 1.4 mínimo: uma página 960×540 pt por slide, JPEG em tela cheia + texto invisível (Tr 3) ---------------- */
  /* larguras da Helvetica (AFM, /1000) de 32 a 126; letras acentuadas usam a letra base */
  var HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var CP = { 8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159 };
  /* símbolos fora do cp1252 que a busca/cópia do PDF ainda deve achar (o sinal de menos nunca vira '?', ≠ nunca vira '=') */
  var SYM = { 0x2212: '-', 0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x2192: '->', 0x2190: '<-', 0x2191: '^', 0x2193: 'v', 0x2194: '<->', 0x21D2: '=>', 0x2260: '!=', 0x2264: '<=', 0x2265: '>=', 0x2248: '~', 0x00D7: 'x', 0x2022: '-', 0x2023: '>', 0x25CF: '*', 0x2713: 'v', 0x2714: 'v', 0x2717: 'x', 0x2718: 'x', 0x2605: '*', 0x2606: '*', 0x2026: '...', 0x2039: '<', 0x203A: '>', 0x00AB: '<<', 0x00BB: '>>' };
  /* texto → bytes WinAnsi (cp1252): acentos do português são os mesmos códigos do Latin-1 */
  function winAnsi(s) {
    var out = [];
    for (var ch of String(s)) {
      var c = ch.codePointAt(0);
      if (c === 160 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 0x2028 || c === 0x2029) c = 32;
      if (c < 32 || c === 0xAD || c === 0x200B || c === 0x200C || c === 0x200D || c === 0xFEFF || c === 0x2060) continue; /* controle e invisíveis: fora */
      if ((c >= 32 && c <= 126) || (c >= 161 && c <= 255)) out.push(c);
      else if (CP[c]) out.push(CP[c]);
      else if (SYM[c]) for (var j = 0; j < SYM[c].length; j++) out.push(SYM[c].charCodeAt(j));
      else if (/\p{L}/u.test(ch)) { var b = ch.normalize('NFD').charAt(0), bc = b.charCodeAt(0); out.push(bc >= 32 && bc <= 126 ? bc : 63); } /* letra acentuada fora do Latin-1: a letra base */
      else out.push(63);
    }
    return out;
  }
  function charW(c) {
    if (c >= 32 && c <= 126) return HW[c - 32];
    var b = String.fromCharCode(c >= 128 && c < 160 ? 32 : c).normalize('NFD').charCodeAt(0);
    return b >= 32 && b <= 126 ? HW[b - 32] : 556;
  }
  function pdfStr(bytes) {
    var s = '(';
    bytes.forEach(function (c) { if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c); else if (c < 32 || c > 126) s += '\\' + ('00' + c.toString(8)).slice(-3); else s += String.fromCharCode(c); });
    return s + ')';
  }
  function utf16Hex(s) { var h = 'FEFF'; for (var i = 0; i < s.length; i++) h += ('000' + s.charCodeAt(i).toString(16).toUpperCase()).slice(-4); return '<' + h + '>'; }
  function f2(n) { return (Math.round(n * 100) / 100).toString(); }
  /* camada de texto invisível: cada linha no seu lugar (1 px lógico = 0,75 pt), largura ajustada com Tz */
  function textLayer(runs) {
    if (!runs || !runs.length) return '';
    var k = 960 / W, s = 'BT 3 Tr\n';
    runs.forEach(function (r) {
      var by = winAnsi(r.t); if (!by.length) return;
      var em = Math.max(1, Math.min(r.fs, r.h)), fs = em * k, nat = by.reduce(function (a, c) { return a + charW(c); }, 0) / 1000 * fs, tz = nat > 0 ? Math.max(10, Math.min(400, r.w * k / nat * 100)) : 100;
      var base = r.y + r.h / 2 + em * .35; /* linha de base ≈ meio da caixa + 0,35 em (texto de SVG: o corpo vem limitado pela altura da caixa) */
      s += '/F1 ' + f2(fs) + ' Tf ' + f2(tz) + ' Tz 1 0 0 1 ' + f2(r.x * k) + ' ' + f2(540 - base * k) + ' Tm ' + pdfStr(by) + ' Tj\n';
    });
    return s + 'ET\n';
  }
  function PdfWriter() { this.parts = []; this.len = 0; this.off = {}; }
  PdfWriter.prototype.put = function (x) { if (typeof x === 'string') { this.parts.push(x); this.len += x.length; } else { this.parts.push(x); this.len += x.byteLength; } };
  PdfWriter.prototype.obj = function (n, dict, stream) {
    this.off[n] = this.len; this.put(n + ' 0 obj\n' + dict);
    if (stream != null) { this.put('\nstream\n'); this.put(stream); this.put('\nendstream'); }
    this.put('\nendobj\n');
  };
  function pdfDate(d) { function p(n) { return ('0' + n).slice(-2); } return 'D:' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
  /* o.signal = {cancelled:true} interrompe entre slides; devolve null quando cancelado */
  function pdf(deck, o) {
    o = o || {};
    var list = o.list || pick(deck, o), n = list.length, scale = +o.scale || 2, q = o.quality == null ? .9 : +o.quality, sig = o.signal || {}, pw = new PdfWriter(), kids = [];
    if (!n) return Promise.resolve(null);
    pw.put('%PDF-1.4\n'); pw.put(new Uint8Array([37, 226, 227, 207, 211, 10]));
    var i = 0;
    function next() {
      if (sig.cancelled) return Promise.resolve(null);
      if (i >= n) return finish();
      if (o.onProgress) o.onProgress(i, n);
      var it = list[i];
      /* setTimeout (não requestAnimationFrame): com a aba em segundo plano a exportação continua, só mais devagar */
      return tick().then(function () { return rasterSlide(it.slide, { scale: scale, type: 'jpeg', quality: q, bg: '#FFFFFF' }); }).catch(function (err) {
        throw new Error('slide ' + ((it.index | 0) + 1) + ' não pôde ser desenhado' + (err && err.message && !/desenhar o slide/.test(err.message) ? ' (' + err.message + ')' : ''));
      }).then(function (r) {
        if (sig.cancelled) return null;
        return r.blob.arrayBuffer().then(function (buf) {
          var pn = 5 + i * 3, cn = pn + 1, im = pn + 2, cs = 'q 960 0 0 540 0 0 cm /Im0 Do Q\n' + textLayer(r.texts);
          pw.obj(im, '<< /Type /XObject /Subtype /Image /Width ' + r.width + ' /Height ' + r.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Interpolate true /Length ' + buf.byteLength + ' >>', new Uint8Array(buf));
          pw.obj(cn, '<< /Length ' + cs.length + ' >>', cs);
          pw.obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /XObject << /Im0 ' + im + ' 0 R >> /Font << /F1 3 0 R >> /ProcSet [/PDF /Text /ImageC] >> /Contents ' + cn + ' 0 R >>');
          kids.push(pn + ' 0 R'); r.canvas.width = r.canvas.height = 0; i++;
          return tick().then(next);
        });
      });
    }
    function finish() {
      if (o.onProgress) o.onProgress(n, n);
      var title = String((deck && deck.title) || 'Apresentação').slice(0, 300), now = new Date();
      pw.obj(1, '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>');
      pw.obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>');
      pw.obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      pw.obj(4, '<< /Title ' + utf16Hex(title) + ' /Creator ' + utf16Hex('Canteiro · Acervo de Apresentações A&M') + ' /Producer (Canteiro) /CreationDate (' + pdfDate(now) + ') >>');
      var size = 5 + n * 3, x = pw.len, xr = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
      for (var k = 1; k < size; k++) xr += ('0000000000' + (pw.off[k] || 0)).slice(-10) + ' 00000 n \n';
      pw.put(xr + 'trailer\n<< /Size ' + size + ' /Root 1 0 R /Info 4 0 R >>\nstartxref\n' + x + '\n%%EOF\n');
      return Promise.resolve(new Blob(pw.parts, { type: 'application/pdf' }));
    }
    return next();
  }

  /* ---------------- PDF pelo navegador: páginas 1280×720 px só na impressão ---------------- */
  var PRINT_CSS = '@media screen{#amPrint{display:none!important}}\n@media print{@page{size:1280px 720px;margin:0}' +
    'html,body{width:1280px!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:visible!important;display:block!important;background:#fff!important}' +
    'body.am-printing>*:not(#amPrint){display:none!important}#amPrint{display:block!important;position:static!important}' +
    '#amPrint .amx-pg{position:relative;width:1280px;height:720px;overflow:hidden;break-after:page;page-break-after:always;break-inside:avoid}#amPrint .amx-pg:last-child{break-after:auto;page-break-after:auto}' +
    '#amPrint .amx-pg>.am-stage{width:1280px!important;height:720px!important;aspect-ratio:auto}' +
    '#amPrint,#amPrint *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}';
  var printing = null;
  function preparePrint(deck, o) {
    if (printing) printing.cleanup();
    var list = (o && o.list) || pick(deck, o || {}), box = document.createElement('div'), css = document.createElement('style');
    box.id = 'amPrint'; box.setAttribute('aria-hidden', 'true'); css.id = 'am-print-css'; css.textContent = PRINT_CSS;
    list.forEach(function (it) { var pg = document.createElement('div'); pg.className = 'amx-pg'; var st = RT.renderSlide(it.slide, { play: false }); st.classList.remove('am-edit'); st.classList.add('am-export'); pg.appendChild(st); box.appendChild(pg); });
    document.head.appendChild(css); document.body.appendChild(box); document.body.classList.add('am-printing');
    /* o PDF da impressão recebe o nome da apresentação (título da página), não o do editor */
    var t0 = document.title, tt = String((deck && deck.title) || '').trim(); if (tt) document.title = tt.slice(0, 200);
    var done = false, me = { count: list.length, el: box, cleanup: function () { if (done) return; done = true; box.remove(); css.remove(); document.body.classList.remove('am-printing'); if (tt && document.title === tt.slice(0, 200)) document.title = t0; removeEventListener('afterprint', me.cleanup); if (printing === me) printing = null; } };
    addEventListener('afterprint', me.cleanup);
    printing = me; return me;
  }
  function print(deck, o) {
    var pr = preparePrint(deck, o);
    var imgs = [].slice.call(pr.el.querySelectorAll('img')).map(function (im) { return im.decode ? im.decode().catch(function () { }) : null; });
    return Promise.all(imgs.concat([document.fonts ? document.fonts.ready : null])).then(frame).then(frame).then(function () {
      try { window.print(); } finally { setTimeout(pr.cleanup, 0); }
      return pr.count;
    });
  }

  /* ---------------- caixa “Salvar como PDF” (própria; não usa #modal — ARCH regra 15) ---------------- */
  var dlg = null, st = null;
  function fmtMB(b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }
  var IPDF = '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h2.2a1.3 1.3 0 0 1 0 2.6H8V13zm0 2.6V18M13.4 13v5h1a2.5 2.5 0 0 0 0-5h-1z"/>';
  var IPRT = '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>';
  function deckNow() { return S().deck; }
  function counts() {
    var d = deckNow(), sl = d.slides, hid = sl.filter(function (s) { return s.hidden === true; }).length;
    return { n: sl.length, hid: hid, cur: S().cur | 0 };
  }
  function build() {
    dlg = document.createElement('div'); dlg.id = 'xpDlg'; dlg.className = 'xp'; dlg.hidden = true;
    dlg.innerHTML = '<div class="xp-bk" data-x="bk"></div>' +
      '<form class="xp-box" role="dialog" aria-modal="true" aria-labelledby="xpT" aria-describedby="xpSum" novalidate>' +
      '<header class="xp-h"><div class="xp-ic">' + svg(IPDF) + '</div><div class="xp-hd"><div class="xp-ey">Exportar</div><h3 id="xpT">Salvar como PDF</h3></div>' +
      '<button type="button" class="xp-x" data-x="close" title="Fechar (Esc)" aria-label="Fechar">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></header>' +
      '<div class="xp-b">' +
      '<fieldset class="xp-fmt" role="radiogroup" aria-label="Tipo de PDF"><legend class="xp-lg">Tipo de PDF</legend>' +
      '<label class="xp-card"><input type="radio" name="xpMode" value="pdf"><span class="xp-ci">' + svg(IPDF) + '</span><span><b>Imagem em alta resolução</b><small>Idêntico ao editor, em qualquer leitor de PDF. Texto pesquisável.</small></span></label>' +
      '<label class="xp-card"><input type="radio" name="xpMode" value="print"><span class="xp-ci">' + svg(IPRT) + '</span><span><b>Pelo navegador</b><small>Texto selecionável e arquivo menor. Escolha “Salvar como PDF” na janela de impressão.</small></span></label></fieldset>' +
      '<p class="xp-sum" id="xpSum"></p>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Slides</legend>' +
      '<label class="xp-rd"><input type="radio" name="xpRange" value="all" checked><span id="xpAllL">Todos</span></label>' +
      '<label class="xp-rd"><input type="radio" name="xpRange" value="cur"><span id="xpCurL">Slide atual</span></label>' +
      '<div class="xp-rd xp-span"><label><input type="radio" name="xpRange" value="span" aria-label="Intervalo de slides"><span>De</span></label>' +
      '<input type="number" id="xpFrom" min="1" step="1" inputmode="numeric" aria-label="Do slide nº"><span>a</span><input type="number" id="xpTo" min="1" step="1" inputmode="numeric" aria-label="Até o slide nº"></div>' +
      '<label class="xp-ck"><input type="checkbox" id="xpHid"><span id="xpHidL">Incluir slides ocultos</span></label></fieldset>' +
      '<fieldset class="xp-sec xp-q" role="radiogroup"><legend class="xp-lg">Qualidade</legend>' +
      '<label class="xp-seg"><input type="radio" name="xpQ" value="2" checked><span>Padrão <em>2×</em></span></label><label class="xp-seg"><input type="radio" name="xpQ" value="3"><span>Máxima <em>3×</em></span></label></fieldset>' +
      '<div class="xp-est" id="xpEst" aria-live="polite"></div>' +
      '<div class="xp-prog" id="xpProg" hidden><div class="xp-pt"><span id="xpPl" role="status" aria-live="polite">Preparando…</span><b id="xpPp">0%</b></div><div class="xp-bar" role="progressbar" aria-labelledby="xpPl" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="xpPb"></i></div></div>' +
      '</div>' +
      '<footer class="xp-f"><button type="button" class="xp-btn" data-x="cancel" id="xpCancel">Cancelar</button><button type="submit" class="xp-btn pri" id="xpGo">Exportar PDF</button></footer></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'bk') { if (st && st.busy) return; closeDialog(); }
      else if (x.dataset.x === 'close') { if (st && st.busy) cancelRun(); else closeDialog(); }
      else if (x.dataset.x === 'cancel') { if (st && st.busy) cancelRun(); else closeDialog(); }
    });
    dlg.addEventListener('change', function (e) {
      if (e.target.name === 'xpMode') setMode(e.target.value);
      if (e.target.id === 'xpFrom' || e.target.id === 'xpTo') { $('input[name=xpRange][value=span]', dlg).checked = true; clampSpan(); }
      update();
    });
    dlg.addEventListener('input', function (e) { if (e.target.id === 'xpFrom' || e.target.id === 'xpTo') { $('input[name=xpRange][value=span]', dlg).checked = true; update(); } });
    $('form', dlg).addEventListener('submit', function (e) { e.preventDefault(); run(); });
  }
  function opts() {
    var c = counts(), r = ($('input[name=xpRange]:checked', dlg) || {}).value || 'all';
    return { range: r, from: +$('#xpFrom').value || 1, to: +$('#xpTo').value || c.n, cur: c.cur, includeHidden: $('#xpHid').checked, scale: +(($('input[name=xpQ]:checked', dlg) || {}).value || 2), quality: .9 };
  }
  function clampSpan() {
    var n = counts().n, f = $('#xpFrom'), t = $('#xpTo');
    [f, t].forEach(function (x) { var v = Math.round(+x.value); x.value = String(Math.max(1, Math.min(n, isFinite(v) && v ? v : 1))); });
    if (+f.value > +t.value) { var a = f.value; f.value = t.value; t.value = a; } /* “de 7 a 3” vira “de 3 a 7”: o que se vê é o que sai */
  }
  function setMode(m) {
    st.mode = m === 'print' ? 'print' : 'pdf';
    dlg.dataset.mode = st.mode;
    $('input[name=xpMode][value=' + st.mode + ']', dlg).checked = true;
    $('#xpT').textContent = st.mode === 'print' ? 'PDF pelo navegador' : 'Salvar como PDF';
    $('#xpGo').textContent = st.mode === 'print' ? 'Abrir impressão' : 'Exportar PDF';
    $('.xp-q', dlg).hidden = st.mode === 'print';
    $('.xp-ic', dlg).innerHTML = svg(st.mode === 'print' ? IPRT : IPDF);
  }
  /* estimativa (medida nos 5 modelos da capa): página 2× ≈ 170 KB, 3× ≈ 300 KB, mais ~35 % do peso das fotos do slide */
  function estimate(list, o) {
    var b = 2048;
    list.forEach(function (it) {
      var s = it.slide, ph = (s.bgImg ? String(s.bgImg).length : 0) + (s.els || []).reduce(function (a, e) { return a + (e.type === 'image' ? String(e.src || '').length : 0); }, 0);
      b += (o.scale >= 3 ? 300 : 170) * 1024 + Math.min(600 * 1024, ph * .75 * .35) + 1500;
    });
    return b;
  }
  function update() {
    if (!dlg || dlg.hidden) return;
    var c = counts(), o = opts(), list = pick(deckNow(), o);
    $('#xpAllL').textContent = 'Todos (' + (c.n - (o.includeHidden ? 0 : c.hid)) + (c.n === 1 ? ' slide)' : ' slides)');
    $('#xpCurL').textContent = 'Slide atual (' + (c.cur + 1) + (deckNow().slides[c.cur] && deckNow().slides[c.cur].hidden === true ? ', oculto)' : ')');
    $('#xpFrom').max = $('#xpTo').max = String(c.n);
    var hk = $('#xpHid'); hk.disabled = !c.hid || (st && st.busy);
    $('#xpHidL').textContent = c.hid ? 'Incluir slides ocultos (' + c.hid + ')' : 'Incluir slides ocultos (nenhum nesta apresentação)';
    var pages = list.length, isP = st.mode === 'print';
    $('#xpSum').innerHTML = isP
      ? 'Uma página por slide, <b>16:9 (1280 × 720)</b>, desenhada pelo navegador: texto selecionável e nítido em qualquer zoom. Sem os efeitos. Na janela de impressão, escolha <b>Salvar como PDF</b>.'
      : 'Uma página por slide, <b>16:9 (13,33 × 7,5 pol)</b>, idêntica ao editor, no estado final (sem os efeitos). O texto continua pesquisável e copiável.';
    $('#xpEst').innerHTML = pages ? '<b>' + pages + (pages === 1 ? ' página' : ' páginas') + '</b>' + (isP ? '' : ' · tamanho estimado <b>≈ ' + fmtMB(estimate(list, o)) + '</b>') : '<span class="xp-warn">Nenhum slide neste intervalo: todos estão ocultos. Marque “Incluir slides ocultos”.</span>';
    $('#xpGo').disabled = !pages || (st && st.busy);
  }
  function focusables() { return [].slice.call(dlg.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null && x.tabIndex >= 0; }); }
  function onKey(e) {
    if (!isOpen()) return;
    var inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && dlg.contains(e.target);
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (st.busy) cancelRun(); else closeDialog(); return; }
    if (e.key === 'Tab') {
      var f = focusables(); if (!f.length) return; var i = f.indexOf(document.activeElement);
      e.preventDefault(); e.stopImmediatePropagation(); (f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length] || f[0]).focus(); return;
    }
    /* atalhos do editor não agem por trás da caixa (F5, Ctrl+S, Ctrl+Z, Delete, setas…); dentro dos campos, as teclas seguem normais */
    if (e.key === 'F1' || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^[sodpzy]$/i.test(e.key) && !inField)) e.preventDefault();
    e.stopImmediatePropagation();
  }
  function isOpen() { return !!(dlg && !dlg.hidden); }
  function openDialog(mode, opener) {
    var A = S(); if (!A) return;
    if (!dlg) build();
    if (A.closeMenus) A.closeMenus();
    var ae = document.activeElement;
    st = { mode: 'pdf', busy: false, sig: null, prev: opener || (ae && ae !== document.body ? ae : null) };
    /* a cada abertura: todos os slides, sem os ocultos; a qualidade escolhida fica até recarregar a página */
    var c = counts(); $('#xpFrom').value = '1'; $('#xpTo').value = String(c.n); $('input[name=xpRange][value=all]', dlg).checked = true; $('#xpHid').checked = false;
    $('#xpProg').hidden = true; dlg.classList.remove('busy');
    setMode(mode); dlg.hidden = false; document.documentElement.classList.add('xp-open');
    addEventListener('keydown', onKey, true);
    update();
    setTimeout(function () { var g = $('#xpGo'); if (isOpen()) (g.disabled ? $('input[name=xpMode]:checked', dlg) : g).focus(); }, 30);
  }
  function closeDialog() {
    if (!isOpen()) return;
    if (st && st.busy) cancelRun();
    dlg.hidden = true; document.documentElement.classList.remove('xp-open');
    removeEventListener('keydown', onKey, true);
    var p = st && st.prev; if (p && document.contains(p) && p.focus) p.focus({ preventScroll: true });
  }
  function setBusy(b) {
    st.busy = b; dlg.classList.toggle('busy', b);
    dlg.querySelectorAll('.xp-b input').forEach(function (x) { x.disabled = b; });
    $('#xpProg').hidden = !b && !st.keepProg; $('#xpGo').disabled = b;
    $('#xpCancel').textContent = b ? 'Cancelar exportação' : 'Cancelar';
    $('.xp-x', dlg).setAttribute('aria-disabled', b ? 'true' : 'false');
    if (!b) update();
    /* durante a exportação o foco fica em “Cancelar exportação” (o único controle útil); ao terminar sem baixar, volta a “Exportar” */
    if (isOpen()) { var fc = b ? $('#xpCancel') : $('#xpGo'); if (fc && !fc.disabled) fc.focus({ preventScroll: true }); }
  }
  function progress(i, n) {
    var pc = n ? Math.round(i / n * 100) : 0;
    $('#xpPl').textContent = i < n ? 'Gerando slide ' + (i + 1) + ' de ' + n + '…' : 'Montando o arquivo…';
    $('#xpPp').textContent = pc + '%'; $('#xpPb').style.width = pc + '%'; $('.xp-bar', dlg).setAttribute('aria-valuenow', String(pc));
  }
  /* cancelar vale na hora: a caixa volta ao normal e a promessa atrasada é ignorada (st.sig !== sig) — antes, uma imagem presa segurava tudo */
  function cancelRun() { if (!(st && st.sig)) return; st.sig.cancelled = true; st.sig = null; st.keepProg = false; setBusy(false); $('#xpProg').hidden = true; toast('Exportação cancelada'); }
  function run() {
    if (st.busy) return;
    var o = opts(), d = deckNow(), list = pick(d, o); if (!list.length) return;
    var A = S(); if (A.flush) A.flush();
    if (st.mode === 'print') { closeDialog(); print(d, { list: list }); return; }
    var sig = st.sig = { cancelled: false }, t0 = Date.now(); st.keepProg = false; setBusy(true); progress(0, list.length);
    var title = d.title, name = (A.slug ? A.slug(title) : 'apresentacao') + '.pdf';
    pdf(d, { list: list, scale: o.scale, quality: o.quality, signal: sig, onProgress: function (i, n) { if (st.sig === sig) progress(i, n); } }).then(function (blob) {
      if (st.sig !== sig) return;
      st.sig = null; setBusy(false);
      if (!blob || sig.cancelled) { $('#xpProg').hidden = true; return; }
      A.download(name, blob, 'application/pdf');
      AMExport.last = { name: name, size: blob.size, pages: list.length, ms: Date.now() - t0 };
      closeDialog(); toast('PDF salvo: ' + name + ' · ' + list.length + (list.length === 1 ? ' página · ' : ' páginas · ') + fmtMB(blob.size));
    }).catch(function (err) {
      if (st.sig === sig) { st.sig = null; setBusy(false); }
      if (window.console && console.warn) console.warn('AMExport', err);
      toast('Não foi possível gerar o PDF: ' + (err && err.message || err));
    });
  }

  var AMExport = {
    rasterSlide: rasterSlide, rasterEls: rasterEls, fontsCSS: fontsCSS, visibleSlides: visibleSlides, pick: pick, boxOf: boxOf, textRuns: textRuns,
    pdf: pdf, preparePrint: preparePrint, print: print, openDialog: openDialog, closeDialog: closeDialog, isOpen: isOpen,
    winAnsi: winAnsi, xmlSafe: xmlSafe, last: null
  };
  return AMExport;
})();
