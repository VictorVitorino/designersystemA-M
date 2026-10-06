/* ed-42-import.js — Importar PowerPoint (.pptx) ou PDF como slides editáveis (S24/S25). Só no editor (ed-*): nada vai para o arquivo salvo.
   PowerPoint: leitor ZIP próprio (DecompressionStream) + leitura do OOXML com DOMParser — tema (cores, fontes), mestre e layout (espaços
   reservados herdam posição e estilo de texto), textos com formato por trecho, formas (geometria do PowerPoint → formas do Canteiro),
   linhas e conectores (pontas, tracejado, cotovelo/curva), fotos (recorte, cantos), grupos (achatados), tabelas (células viram formas),
   gráficos simples (viram gráficos do Canteiro com os mesmos dados), SmartArt (pelo desenho gravado no arquivo), anotações do orador,
   slides ocultos, seções (capítulos). Animações e transições não são lidas (por decisão).
   PDF: pdf.js (carregado da internet só quando é preciso) — cada página vira um slide com o fundo (desenho da página sem o texto) e os
   textos como elementos editáveis por cima, com fonte, tamanho, cor e alinhamento lidos da página.
   API: window.AMImport = { open(file), pick(), pptx(bytes, opts), pdf(bytes, opts), isOpen(), close() } · AMStudio.appendSlides(slides) (editor.js) */
(function () {
  'use strict';
  var RT = window.AMRT, W = 1280, H = 720, EMU_PX = 9525;
  var FONTS_OK = { 'Inter': 1, 'Roboto': 1, 'Roboto Condensed': 1, 'JetBrains Mono': 1 };
  function S() { return window.AMStudio; }
  function $(s, r) { return (r || document).querySelector(s); }
  function toast(msg) { var t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 3200); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function uid() { return 'e' + Math.random().toString(36).slice(2, 9); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function num(v, d) { v = parseFloat(v); return isFinite(v) ? v : d; }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  var TD = new TextDecoder('utf-8');

  /* ======================= ZIP (leitura): diretório central + inflate nativo ======================= */
  function inflateRaw(data) {
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('este navegador não descompacta arquivos .pptx (sem DecompressionStream)'));
    var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
    w.write(data).catch(function () { }); w.close().catch(function () { });
    return new Response(ds.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function zipOpen(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.length, e = -1;
    for (var i = n - 22; i >= Math.max(0, n - 65558); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('não é um arquivo ZIP válido');
    var cnt = dv.getUint16(e + 10, true), cd = dv.getUint32(e + 16, true), p = cd, entries = {}, names = [];
    if (cnt === 0xFFFF || cd === 0xFFFFFFFF) throw new Error('ZIP64 não suportado');
    for (var k = 0; k < cnt && p + 46 <= n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = TD.decode(u8.subarray(p + 46, p + 46 + nl));
      entries[name] = { method: method, csize: csize, usize: usize, off: off }; names.push(name);
      p += 46 + nl + xl + cl;
    }
    function get(name) {
      var en = entries[name]; if (!en) return Promise.resolve(null);
      var lp = en.off; if (lp + 30 > n || dv.getUint32(lp, true) !== 0x04034b50) return Promise.reject(new Error('entrada ZIP corrompida: ' + name));
      var nl = dv.getUint16(lp + 26, true), xl = dv.getUint16(lp + 28, true), st = lp + 30 + nl + xl, data = u8.subarray(st, Math.min(n, st + en.csize));
      if (en.method === 0) return Promise.resolve(data);
      if (en.method !== 8) return Promise.reject(new Error('compressão não suportada em ' + name));
      return inflateRaw(data);
    }
    return { names: names, has: function (nm) { return !!entries[nm]; }, get: get };
  }

  /* ======================= XML ======================= */
  var RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function parseXML(text) { var d = new DOMParser().parseFromString(text, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('XML inválido'); return d; }
  function kids(el, name) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c); return out; }
  function kid(el, name) { if (!el) return null; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; }
  function path(el, names) { var e = el; for (var i = 0; i < names.length && e; i++) e = kid(e, names[i]); return e || null; }
  function att(el, n, d) { if (!el) return d; var v = el.getAttribute(n); return v == null ? d : v; }
  function ratt(el, n) { if (!el) return null; var v = el.getAttributeNS(RNS, n); if (v != null) return v; for (var i = 0; i < el.attributes.length; i++) if (el.attributes[i].localName === n) return el.attributes[i].value; return null; }
  function descend(el, name) { return el ? Array.prototype.slice.call(el.getElementsByTagNameNS('*', name)) : []; }
  function textOf(el) { return el ? String(el.textContent || '') : ''; }

  /* ======================= pacote OOXML ======================= */
  function resolvePath(base, target) {
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = base.split('/'); parts.pop();
    target.split('/').forEach(function (s) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); });
    return parts.join('/');
  }
  function Pkg(zip) { this.zip = zip; this.xmlCache = {}; this.relCache = {}; this.mediaCache = {}; }
  Pkg.prototype.text = function (p) { return this.zip.get(p).then(function (u) { return u ? TD.decode(u) : null; }); };
  Pkg.prototype.xml = function (p) {
    var self = this; if (self.xmlCache[p]) return self.xmlCache[p];
    return (self.xmlCache[p] = self.text(p).then(function (t) { return t ? parseXML(t) : null; }).catch(function () { return null; }));
  };
  Pkg.prototype.rels = function (p) { /* relações de uma parte: {rId: {type (última parte da URI), target (caminho absoluto no pacote), mode}} */
    var self = this; if (self.relCache[p]) return self.relCache[p];
    var dir = p.split('/'); var base = dir.pop(); var rp = dir.concat(['_rels', base + '.rels']).join('/');
    return (self.relCache[p] = self.xml(rp).then(function (d) {
      var out = {}; if (!d) return out;
      kids(d.documentElement, 'Relationship').forEach(function (r) {
        var t = att(r, 'Type', ''), tg = att(r, 'Target', ''), ext = att(r, 'TargetMode', '') === 'External';
        out[att(r, 'Id', '')] = { type: t.split('/').pop(), target: ext ? tg : resolvePath(p, tg), external: ext };
      });
      return out;
    }));
  };
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' };
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function loadImg(src) { return new Promise(function (res) { var im = new Image(); im.addEventListener('load', function () { res(im); }); im.addEventListener('error', function () { res(null); }); im.src = src; }); }
  /* mídia → {src (data:), w, h} ou null (formato que o navegador não desenha: EMF/WMF/TIFF/BMP antigo…); recorte (srcRect) pelo canvas */
  Pkg.prototype.media = function (p, crop) {
    var self = this, key = p + (crop ? '|' + crop.join(',') : '');
    if (self.mediaCache[key]) return self.mediaCache[key];
    return (self.mediaCache[key] = self.zip.get(p).then(function (u) {
      if (!u) return null;
      var ext = p.split('.').pop().toLowerCase(), mime = MIME[ext];
      if (!mime || /emf|wmf|tiff/.test(mime)) return { unsupported: ext };
      var src = 'data:' + mime + ';base64,' + b64(u);
      return loadImg(src).then(function (im) {
        if (!im || !im.naturalWidth) return { unsupported: ext };
        var nw = im.naturalWidth, nh = im.naturalHeight;
        if (!crop || !crop.some(function (v) { return Math.abs(v) > .0005; })) { if (mime === 'image/svg+xml' || mime === 'image/bmp' || mime === 'image/webp') return rasterTo(im, nw, nh, 'image/png').then(function (d) { return d ? { src: d, w: nw, h: nh } : { unsupported: ext }; }); return { src: src, w: nw, h: nh }; }
        /* recorte l,t,r,b (frações): só a parte visível vira a foto (o Canteiro não tem recorte livre) */
        var l = clamp(crop[0], -1, 1), t = clamp(crop[1], -1, 1), r = clamp(crop[2], -1, 1), b = clamp(crop[3], -1, 1);
        var sx = Math.max(0, l * nw), sy = Math.max(0, t * nh), ex = Math.min(nw, nw - r * nw), ey = Math.min(nh, nh - b * nh), cw = Math.max(1, Math.round(ex - sx)), ch = Math.max(1, Math.round(ey - sy));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(im, sx, sy, ex - sx, ey - sy, 0, 0, cw, ch);
        var d = mime === 'image/jpeg' ? cv.toDataURL('image/jpeg', .9) : cv.toDataURL('image/png');
        return { src: d, w: cw, h: ch };
      });
    }));
  };
  function rasterTo(im, w, h, type) { try { var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.min(4096, Math.round(w))); cv.height = Math.max(1, Math.min(4096, Math.round(h))); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); return Promise.resolve(cv.toDataURL(type || 'image/png')); } catch (e) { return Promise.resolve(null); } }

  /* ======================= cores ======================= */
  var PRST = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080', grey: '#808080', lightGray: '#D3D3D3', darkGray: '#A9A9A9', darkBlue: '#00008B', navy: '#000080', orange: '#FFA500', silver: '#C0C0C0', dkGray: '#A9A9A9', ltGray: '#D3D3D3', medGray: '#808080' };
  function hexRgb(h) { var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [0, 0, 0]; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbHex(r, g, b) { return '#' + [r, g, b].map(function (v) { v = Math.round(clamp(v, 0, 255)); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); }
  function rgbHsl(c) { var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2, d = mx - mn; if (d) { s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
  function hslRgb(h, s, l) { function f(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; } if (!s) return [l * 255, l * 255, l * 255]; var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]; }
  function lum(hex, mod, off) { var hs = rgbHsl(hexRgb(hex)); hs[2] = clamp(hs[2] * mod + off, 0, 1); var c = hslRgb(hs[0], hs[1], hs[2]); return rgbHex(c[0], c[1], c[2]); }
  function tint(hex, v) { var c = hexRgb(hex); return rgbHex(c[0] * v + 255 * (1 - v), c[1] * v + 255 * (1 - v), c[2] * v + 255 * (1 - v)); }
  function shade(hex, v) { var c = hexRgb(hex); return rgbHex(c[0] * v, c[1] * v, c[2] * v); }
  function clrVal(c) {
    if (!c) return null;
    if (c.localName === 'srgbClr') { var v = att(c, 'val', '000000'); return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toUpperCase() : null; }
    if (c.localName === 'sysClr') { var lc = att(c, 'lastClr'); return lc && /^[0-9a-f]{6}$/i.test(lc) ? '#' + lc.toUpperCase() : (att(c, 'val') === 'window' ? '#FFFFFF' : '#000000'); }
    if (c.localName === 'prstClr') return PRST[att(c, 'val')] || '#000000';
    if (c.localName === 'scrgbClr') return rgbHex(num(att(c, 'r'), 0) / 1000 * 2.55, num(att(c, 'g'), 0) / 1000 * 2.55, num(att(c, 'b'), 0) / 1000 * 2.55);
    return null;
  }
  /* cor de um nó de cor (srgbClr/schemeClr/…) com os modificadores; ctx = {theme, clrMap, phClr} → {hex, a} */
  function colorNode(c, ctx) {
    if (!c) return null;
    var hex, a = 1;
    if (c.localName === 'schemeClr') {
      var v = att(c, 'val', ''); if (ctx.clrMap && ctx.clrMap[v]) v = ctx.clrMap[v];
      if (v === 'phClr') hex = ctx.phClr || '#000000'; else hex = (ctx.theme && ctx.theme.colors[v]) || (v === 'bg1' || v === 'lt1' ? '#FFFFFF' : '#000000');
    } else hex = clrVal(c);
    if (!hex) return null;
    kids(c).forEach(function (m) {
      var v = num(att(m, 'val'), 0) / 100000;
      switch (m.localName) {
        case 'alpha': a = clamp(v, 0, 1); break;
        case 'lumMod': hex = lum(hex, v, 0); break;
        case 'lumOff': hex = lum(hex, 1, v); break;
        case 'tint': hex = tint(hex, v); break;
        case 'shade': hex = shade(hex, v); break;
        case 'satMod': { var hs = rgbHsl(hexRgb(hex)); hs[1] = clamp(hs[1] * v, 0, 1); var cc = hslRgb(hs[0], hs[1], hs[2]); hex = rgbHex(cc[0], cc[1], cc[2]); break; }
      }
    });
    return { hex: hex, a: a };
  }
  /* preenchimento (solidFill/gradFill/pattFill/noFill) → {hex, a} | 'none' | null (ausente) */
  function fillOf(parent, ctx) {
    if (!parent) return null;
    var f = kid(parent, 'solidFill'); if (f) return colorNode(f.firstElementChild, ctx) || null;
    if (kid(parent, 'noFill')) return 'none';
    var g = kid(parent, 'gradFill'); if (g) { var st = kids(kid(g, 'gsLst'), 'gs').map(function (s) { return colorNode(s.firstElementChild, ctx); }).filter(Boolean); if (!st.length) return null; var r = 0, gg = 0, b = 0, a = 0; st.forEach(function (c) { var x = hexRgb(c.hex); r += x[0]; gg += x[1]; b += x[2]; a += c.a; }); return { hex: rgbHex(r / st.length, gg / st.length, b / st.length), a: a / st.length, grad: true }; }
    var pt = kid(parent, 'pattFill'); if (pt) return colorNode((kid(pt, 'fgClr') || {}).firstElementChild, ctx) || null;
    return null;
  }

  /* ======================= tema, mestre, layout ======================= */
  function readTheme(doc) {
    var root = doc && doc.documentElement, te = kid(root, 'themeElements'), colors = {}, cs = kid(te, 'clrScheme');
    kids(cs).forEach(function (c) { var h = clrVal(c.firstElementChild); if (h) colors[c.localName] = h; });
    var fs = kid(te, 'fontScheme'), maj = att(path(fs, ['majorFont', 'latin']), 'typeface', 'Calibri Light'), min = att(path(fs, ['minorFont', 'latin']), 'typeface', 'Calibri');
    var fm = kid(te, 'fmtScheme');
    return { colors: colors, maj: maj, min: min, lnW: kids(kid(fm, 'lnStyleLst'), 'ln').map(function (l) { return num(att(l, 'w'), 9525); }), fills: kids(kid(fm, 'fillStyleLst')), bgFills: kids(kid(fm, 'bgFillStyleLst')), lns: kids(kid(fm, 'lnStyleLst'), 'ln') };
  }
  function readClrMap(el) { var m = {}; if (!el) return m; for (var i = 0; i < el.attributes.length; i++) m[el.attributes[i].localName] = el.attributes[i].value; return m; }
  /* espaços reservados de uma parte (layout/mestre): lista {type, idx, sp} e as formas decorativas (não reservadas) */
  function phInfo(sp) { var ph = path(sp, ['nvSpPr', 'nvPr', 'ph']) || path(sp, ['nvPicPr', 'nvPr', 'ph']) || path(sp, ['nvGraphicFramePr', 'nvPr', 'ph']); if (!ph) return null; return { type: att(ph, 'type', 'body'), idx: att(ph, 'idx', null) }; }
  function phMatch(list, ph) { /* idx bate primeiro; depois o tipo (title/ctrTitle valem um pelo outro; body/subTitle/obj também) */
    if (!ph) return null; var t = normPh(ph.type);
    var byIdx = ph.idx != null ? list.filter(function (x) { return x.idx === ph.idx && (normPh(x.type) === t || !ph.type); })[0] : null; if (byIdx) return byIdx;
    byIdx = ph.idx != null ? list.filter(function (x) { return x.idx === ph.idx; })[0] : null; if (byIdx && t !== 'title' && t !== 'body') return byIdx;
    return list.filter(function (x) { return normPh(x.type) === t; })[0] || null;
  }
  function normPh(t) { if (t === 'ctrTitle') return 'title'; if (t === 'subTitle' || t === 'obj' || !t) return 'body'; return t; }

  /* ======================= contexto da importação ======================= */
  function Ctx(opts) { this.opts = opts || {}; this.warn = {}; this.count = { slides: 0, texts: 0, shapes: 0, lines: 0, images: 0, tables: 0, charts: 0, smart: 0, notes: 0, approx: 0 }; this.fonts = {}; }
  Ctx.prototype.w = function (k, n) { this.warn[k] = (this.warn[k] || 0) + (n == null ? 1 : n); };

  /* ======================= geometria ======================= */
  function xfrmOf(spPr, tag) {
    var x = kid(spPr, tag || 'xfrm'); if (!x) return null; var off = kid(x, 'off'), ext = kid(x, 'ext'); if (!off || !ext) return null;
    var o = { x: num(att(off, 'x'), 0), y: num(att(off, 'y'), 0), w: num(att(ext, 'cx'), 0), h: num(att(ext, 'cy'), 0), rot: num(att(x, 'rot'), 0) / 60000, flipH: att(x, 'flipH') === '1' || att(x, 'flipH') === 'true', flipV: att(x, 'flipV') === '1' || att(x, 'flipV') === 'true' };
    var co = kid(x, 'chOff'), ce = kid(x, 'chExt'); if (co && ce) { o.chOff = { x: num(att(co, 'x'), 0), y: num(att(co, 'y'), 0) }; o.chExt = { w: num(att(ce, 'cx'), 0), h: num(att(ce, 'cy'), 0) }; }
    return o;
  }
  /* transformação de grupo: caixa do filho (EMU, no espaço do grupo) → EMU no espaço do pai */
  function groupTf(g, parentTf) {
    var sx = g.chExt && g.chExt.w ? g.w / g.chExt.w : 1, sy = g.chExt && g.chExt.h ? g.h / g.chExt.h : 1, cx = g.x + g.w / 2, cy = g.y + g.h / 2, rad = (g.rot || 0) * Math.PI / 180;
    var f = function (b) {
      var x = g.x + (b.x - (g.chOff ? g.chOff.x : 0)) * sx, y = g.y + (b.y - (g.chOff ? g.chOff.y : 0)) * sy, w = b.w * sx, h = b.h * sy, rot = b.rot || 0, fh = !!b.flipH, fv = !!b.flipV;
      var ccx = x + w / 2, ccy = y + h / 2;
      if (g.flipH) { ccx = 2 * cx - ccx; fh = !fh; rot = -rot; }
      if (g.flipV) { ccy = 2 * cy - ccy; fv = !fv; rot = -rot; }
      if (rad) { var dx = ccx - cx, dy = ccy - cy; ccx = cx + dx * Math.cos(rad) - dy * Math.sin(rad); ccy = cy + dx * Math.sin(rad) + dy * Math.cos(rad); rot += g.rot; }
      var out = { x: ccx - w / 2, y: ccy - h / 2, w: w, h: h, rot: rot, flipH: fh, flipV: fv };
      return parentTf ? parentTf(out) : out;
    };
    return f;
  }
  function px(ctx, v) { return v / EMU_PX * ctx.k; }
  function boxPx(ctx, b) { return { x: r1(px(ctx, b.x) + ctx.ox), y: r1(px(ctx, b.y) + ctx.oy), w: r1(px(ctx, b.w)), h: r1(px(ctx, b.h)), rot: b.rot || 0, flipH: !!b.flipH, flipV: !!b.flipV }; }
  function ptPx(ctx, pt) { return pt * 4 / 3 * ctx.k; }

  /* ======================= texto ======================= */
  /* cadeia de estilos de um texto: [lstStyle do próprio txBody, lstStyle do ph do layout, lstStyle do ph do mestre, txStyles do mestre, defaultTextStyle] */
  function lvlNode(ls, lvl) { return ls ? kid(ls, 'lvl' + (lvl + 1) + 'pPr') : null; }
  function firstOf(nodes, fn) { for (var i = 0; i < nodes.length; i++) { var v = nodes[i] ? fn(nodes[i]) : undefined; if (v !== undefined && v !== null) return v; } return null; }
  function rprOf(node, k, ctx) { /* propriedade de um rPr/defRPr: sz, b, i, u, strike, cap, spc, baseline, color, font */
    if (!node) return null;
    switch (k) {
      case 'sz': return node.hasAttribute('sz') ? num(att(node, 'sz'), null) : null;
      case 'b': return node.hasAttribute('b') ? att(node, 'b') === '1' || att(node, 'b') === 'true' : null;
      case 'i': return node.hasAttribute('i') ? att(node, 'i') === '1' || att(node, 'i') === 'true' : null;
      case 'u': return node.hasAttribute('u') ? att(node, 'u') !== 'none' : null;
      case 'strike': return node.hasAttribute('strike') ? att(node, 'strike') !== 'noStrike' : null;
      case 'cap': return node.hasAttribute('cap') ? att(node, 'cap') : null;
      case 'spc': return node.hasAttribute('spc') ? num(att(node, 'spc'), 0) : null;
      case 'baseline': return node.hasAttribute('baseline') ? num(att(node, 'baseline'), 0) : null;
      case 'color': { var f = fillOf(node, ctx); return f && f !== 'none' ? f : (f === 'none' ? { hex: '#000000', a: 0 } : null); }
      case 'font': { var l = kid(node, 'latin'); return l ? att(l, 'typeface', null) : null; }
    }
    return null;
  }
  var WSUF = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, book: 400, medium: 500, semibold: 600, demibold: 600, demi: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
  function famWeight(name) {
    var m = /^(.*?)\s+(thin|hairline|extra ?light|ultra ?light|light|regular|book|medium|semi ?bold|demi ?bold|demi|bold|extra ?bold|ultra ?bold|black|heavy)$/i.exec(String(name || '').trim());
    if (!m || !m[1]) return { family: String(name || '').trim(), w: 0 };
    return { family: m[1].trim(), w: WSUF[m[2].toLowerCase().replace(/\s+/g, '')] || 0 };
  }
  function themeFont(name, theme) { if (!name) return null; if (name === '+mj-lt') return theme.maj; if (name === '+mn-lt') return theme.min; if (/^\+m[jn]-/.test(name)) return name.indexOf('+mj') === 0 ? theme.maj : theme.min; return name; }
  function pprOf(node, k) {
    if (!node) return null;
    switch (k) {
      case 'algn': return node.hasAttribute('algn') ? att(node, 'algn') : null;
      case 'marL': return node.hasAttribute('marL') ? num(att(node, 'marL'), 0) : null;
      case 'indent': return node.hasAttribute('indent') ? num(att(node, 'indent'), 0) : null;
      case 'bu': { if (kid(node, 'buNone')) return { t: 'none' }; var bc = kid(node, 'buChar'); if (bc) return { t: 'char', ch: att(bc, 'char', '•') }; var ba = kid(node, 'buAutoNum'); if (ba) return { t: 'num', scheme: att(ba, 'type', 'arabicPeriod'), start: num(att(ba, 'startAt'), 1) }; if (kid(node, 'buBlip')) return { t: 'char', ch: '•' }; return null; }
      case 'lnSpc': { var l = kid(node, 'lnSpc'); if (!l) return null; var p = kid(l, 'spcPct'), s = kid(l, 'spcPts'); return p ? { pct: num(att(p, 'val'), 100000) / 100000 } : s ? { pts: num(att(s, 'val'), 0) / 100 } : null; }
      case 'spcBef': case 'spcAft': { var e = kid(node, k); if (!e) return null; var pp = kid(e, 'spcPts'), pc = kid(e, 'spcPct'); return pp ? { pts: num(att(pp, 'val'), 0) / 100 } : pc ? { pct: num(att(pc, 'val'), 0) / 100000 } : null; }
      case 'buClr': { var c = kid(node, 'buClr'); return c ? c.firstElementChild : null; }
    }
    return null;
  }
  function autoNum(scheme, n) {
    var s = scheme || 'arabicPeriod', v;
    if (/^alphaLc/.test(s)) v = String.fromCharCode(96 + ((n - 1) % 26) + 1); else if (/^alphaUc/.test(s)) v = String.fromCharCode(64 + ((n - 1) % 26) + 1);
    else if (/^romanLc/.test(s)) v = roman(n).toLowerCase(); else if (/^romanUc/.test(s)) v = roman(n); else v = String(n);
    return /ParenBoth/.test(s) ? '(' + v + ')' : /ParenR/.test(s) ? v + ')' : /Plain$/.test(s) ? v : v + '.';
  }
  function roman(n) { var t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']], s = ''; t.forEach(function (p) { while (n >= p[0]) { s += p[1]; n -= p[0]; } }); return s || '0'; }
  var ALGN = { l: 'left', ctr: 'center', r: 'right', just: 'left', dist: 'left' };
  /* lê um txBody → {html, base:{size, font, weight, italic, color, align, lh, ls, upper}, plain, nParas} · chain = lstStyles em ordem · fontRef = cor padrão (p:style) */
  function readText(txBody, chain, ctx, o) {
    o = o || {};
    var bodyPr = kid(txBody, 'bodyPr'), own = kid(txBody, 'lstStyle'), paras = kids(txBody, 'p');
    var fs = 1, lr = 0, na = kid(bodyPr, 'normAutofit'); if (na) { fs = num(att(na, 'fontScale'), 100000) / 100000; lr = num(att(na, 'lnSpcReduction'), 0) / 100000; }
    var lst = [own].concat(chain || []);
    var runs = [], out = [], plain = [], counters = {}, prevLvl = -1;
    paras.forEach(function (p) {
      var pPr = kid(p, 'pPr'), lvl = num(att(pPr, 'lvl'), 0), lv = lst.map(function (ls) { return lvlNode(ls, lvl); });
      var pnodes = [pPr].concat(lv), dnodes = [kid(pPr, 'defRPr')].concat(lv.map(function (n) { return n ? kid(n, 'defRPr') : null; }));
      var algn = firstOf(pnodes, function (n) { return pprOf(n, 'algn'); }) || 'l', marL = firstOf(pnodes, function (n) { return pprOf(n, 'marL'); }), indent = firstOf(pnodes, function (n) { return pprOf(n, 'indent'); });
      var bu = firstOf(pnodes, function (n) { return pprOf(n, 'bu'); }), lnSpc = firstOf(pnodes, function (n) { return pprOf(n, 'lnSpc'); }), spcBef = firstOf(pnodes, function (n) { return pprOf(n, 'spcBef'); }), spcAft = firstOf(pnodes, function (n) { return pprOf(n, 'spcAft'); });
      if (marL == null) marL = lvl * 457200 * (bu && bu.t !== 'none' ? 1 : 0); if (indent == null) indent = 0;
      var items = [], hasText = false;
      kids(p).forEach(function (n) {
        if (n.localName === 'br') { items.push({ br: true }); return; }
        if (n.localName !== 'r' && n.localName !== 'fld') return;
        var t = textOf(kid(n, 't')); if (n.localName === 'fld' && att(n, 'type') === 'slidenum' && o.slideNo) t = String(o.slideNo);
        if (!t) return;
        var rPr = kid(n, 'rPr'), rn = [rPr].concat(dnodes), g = function (k) { return firstOf(rn, function (x) { return rprOf(x, k, ctx); }); };
        var col = g('color'); if (!col && o.fontRef) col = o.fontRef; if (!col) col = { hex: ctx.theme && ctx.theme.colors[(ctx.clrMap && ctx.clrMap.tx1) || 'dk1'] || '#000000', a: 1 };
        var fw = famWeight(themeFont(g('font'), ctx.theme) || ctx.theme.min), bb = !!g('b');
        var run = { t: t, sz: (g('sz') || 1800) / 100 * fs, b: bb, w: bb ? Math.max(700, fw.w) : (fw.w || 400), i: !!g('i'), u: !!g('u'), s: !!g('strike'), cap: g('cap') || 'none', spc: g('spc') || 0, base: g('baseline') || 0, color: col, font: fw.family };
        if (run.font) ctx.fonts[run.font] = (ctx.fonts[run.font] || 0) + t.length;
        items.push(run); runs.push(run); hasText = true;
      });
      /* parágrafo vazio: a altura da linha vem do endParaRPr (ou da cadeia) */
      var epr = kid(p, 'endParaRPr'), en = [epr].concat(dnodes), esz = (firstOf(en, function (x) { return rprOf(x, 'sz', ctx); }) || 1800) / 100 * fs;
      var pSz = items.filter(function (r) { return !r.br; }).reduce(function (m, r) { return Math.max(m, r.sz); }, 0) || esz;
      var bullet = null;
      if (bu && bu.t !== 'none' && hasText) {
        if (bu.t === 'num') { var key = lvl; if (prevLvl < lvl) counters[key] = bu.start || 1; else counters[key] = (counters[key] || (bu.start || 1) - 1) + 1; bullet = autoNum(bu.scheme, counters[key]); }
        else bullet = bu.ch || '•';
      }
      prevLvl = hasText ? lvl : prevLvl;
      out.push({ items: items, algn: ALGN[algn] || 'left', marL: marL, indent: indent, bullet: bullet, lnSpc: lnSpc, spcBef: spcBef, spcAft: spcAft, sz: pSz, empty: !hasText });
      plain.push(items.filter(function (r) { return !r.br; }).map(function (r) { return r.t; }).join(''));
    });
    /* trecho dominante (mais caracteres) define a base do elemento */
    var dom = null, by = {};
    runs.forEach(function (r) { var k = [r.font, r.sz, r.w, r.i, r.color.hex].join('|'); by[k] = (by[k] || 0) + r.t.length; if (!dom || by[k] > by[[dom.font, dom.sz, dom.w, dom.i, dom.color.hex].join('|')]) dom = r; });
    var first = out[0], baseSz = dom ? dom.sz : (first ? first.sz : 18);
    var base = { size: Math.max(1, r1(ptPx(ctx, baseSz))), font: dom ? dom.font : famWeight(ctx.theme.min).family, weight: dom ? dom.w : 400, italic: !!(dom && dom.i), color: dom ? dom.color.hex : '#000000', align: first ? first.algn : 'left', upper: !!(dom && dom.cap === 'all'), ls: dom && dom.spc ? r1(dom.spc / 100 / baseSz * 100) / 100 : 0 };
    var lh0 = lhOf(first ? first.lnSpc : null, baseSz, lr); base.lh = lh0;
    /* cada parágrafo tem o tamanho do seu maior trecho (em, relativo à base do elemento) e entrelinha sem unidade: assim a altura da
       linha segue o maior trecho, como no PowerPoint, e um parágrafo menor que a base não ganha a linha alta da base */
    var html = out.map(function (p, pi) {
      var st = [], pSz = p.sz || baseSz, pPx = ptPx(ctx, pSz);
      if (Math.abs(pSz - baseSz) > .5) st.push('font-size:' + r1(pSz / baseSz * 100) / 100 + 'em');
      if (p.algn !== base.align) st.push('text-align:' + p.algn);
      var lh = lhOf(p.lnSpc, pSz, lr); if (Math.abs(lh - lh0) > .02) st.push('line-height:' + lh);
      if (pi && p.spcBef) st.push('margin-top:' + r1(spcPx(ctx, p.spcBef, pSz) / pPx * 100) / 100 + 'em'); if (p.spcAft && pi < out.length - 1) st.push('margin-bottom:' + r1(spcPx(ctx, p.spcAft, pSz) / pPx * 100) / 100 + 'em');
      var ml = px(ctx, p.marL) / pPx, ind = px(ctx, p.indent) / pPx, inner = '';
      if (p.bullet) { var hang = Math.max(.6, -ind || .9); st.push('padding-left:' + r1(Math.max(ml, hang) * 100) / 100 + 'em', 'text-indent:' + r1(-hang * 100) / 100 + 'em'); inner += '<span style="display:inline-block;width:' + r1(hang * 100) / 100 + 'em;text-indent:0">' + esc(p.bullet) + '</span>'; }
      else if (ml > .05 || ind) { if (ml > .05) st.push('padding-left:' + r1(ml * 100) / 100 + 'em'); if (ind) st.push('text-indent:' + r1(ind * 100) / 100 + 'em'); }
      if (p.empty) inner += '<br>';
      else inner += p.items.map(function (r) { return r.br ? '<br>' : runHTML(r, base, pSz); }).join('');
      return '<div' + (st.length ? ' style="' + st.filter(Boolean).join(';') + '"' : '') + '>' + inner + '</div>';
    }).join('');
    if (bodyPr && att(bodyPr, 'wrap') === 'none') html = '<div style="white-space:nowrap">' + html + '</div>';
    var ins = { l: num(att(bodyPr, 'lIns'), 91440), t: num(att(bodyPr, 'tIns'), 45720), r: num(att(bodyPr, 'rIns'), 91440), b: num(att(bodyPr, 'bIns'), 45720) };
    var anchor = att(bodyPr, 'anchor', null), vert = att(bodyPr, 'vert', 'horz');
    return { html: html, base: base, plain: plain.join('\n').trim(), ins: ins, valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : anchor === 't' ? 'top' : null, vert: vert, n: out.length };
  }
  function lhOf(ln, szPt, lr) { var lh = ln && ln.pct ? 1.2 * ln.pct : ln && ln.pts ? ln.pts / szPt : 1.2; lh = lh * (1 - (lr || 0)); return Math.max(.6, r1(lh * 100) / 100); }
  function spcPx(ctx, sp, szPt) { return sp.pts != null ? ptPx(ctx, sp.pts) : ptPx(ctx, (sp.pct || 0) * szPt); }
  function runHTML(r, base, baseSz) {
    var t = esc(r.t).replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;').replace(/ {2}/g, ' &nbsp;'), st = [];
    if (Math.abs(r.sz - baseSz) > .5) st.push('font-size:' + r1(r.sz / baseSz * 100) / 100 + 'em');
    if (r.color.hex !== base.color) st.push('color:' + r.color.hex);
    if (r.font && r.font !== base.font) st.push("font-family:'" + r.font.replace(/[^\w\s.-]/g, '') + "'");
    if (r.cap === 'all' && !base.upper) st.push('text-transform:uppercase'); else if (r.cap !== 'all' && base.upper) st.push('text-transform:none');
    if (r.spc && Math.abs(r.spc / 100 / r.sz - base.ls) > .005) st.push('letter-spacing:' + r1(r.spc / 100 / r.sz * 100) / 100 + 'em');
    if (r.color.a < .999) st.push('opacity:' + r1(r.color.a * 100) / 100);
    if (st.length) t = '<span style="' + st.join(';') + '">' + t + '</span>';
    if (r.w !== base.weight) t = r.w >= 600 && base.weight < 600 ? '<b>' + t + '</b>' : '<span style="font-weight:' + r.w + '">' + t + '</span>';
    if (r.i && !base.italic) t = '<i>' + t + '</i>'; else if (!r.i && base.italic) t = '<span style="font-style:normal">' + t + '</span>';
    if (r.u) t = '<u>' + t + '</u>'; if (r.s) t = '<s>' + t + '</s>';
    if (r.base > 0) t = '<sup>' + t + '</sup>'; else if (r.base < 0) t = '<sub>' + t + '</sub>';
    return t;
  }

  /* ======================= formas ======================= */
  var GEO = { rect: 'rect', roundRect: 'round', round1Rect: 'round', round2SameRect: 'round', round2DiagRect: 'round', snipRoundRect: 'round', snip1Rect: 'rect', snip2SameRect: 'rect', snip2DiagRect: 'rect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'rtri', diamond: 'diamond', parallelogram: 'para', trapezoid: 'trapezoid', chevron: 'chevron', homePlate: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', rightArrow: 'arrow', leftArrow: 'arrow', upArrow: 'arrow', downArrow: 'arrow', leftRightArrow: 'darrow', notchedRightArrow: 'notch', wedgeRectCallout: 'callout', wedgeRoundRectCallout: 'callout', wedgeEllipseCallout: 'callout', can: 'cylinder', donut: 'ring', bracketPair: 'brackets', bracePair: 'braces', star4: 'star', star5: 'star', star6: 'star', star8: 'star', mathPlus: 'plus', plus: 'plus', wave: 'wave', flowChartDocument: 'wave', flowChartProcess: 'rect', flowChartAlternateProcess: 'round', flowChartDecision: 'diamond', flowChartTerminator: 'pill', flowChartConnector: 'ellipse', flowChartPreparation: 'hexagon' };
  var LINE_GEO = { line: 1, straightConnector1: 1, bentConnector2: 1, bentConnector3: 1, bentConnector4: 1, bentConnector5: 1, curvedConnector2: 1, curvedConnector3: 1, curvedConnector4: 1, curvedConnector5: 1 };
  var DASH = { dash: 'dash', sysDash: 'dash', dashDot: 'dashdot', sysDashDot: 'dashdot', lgDash: 'long', lgDashDot: 'dashdot', lgDashDotDot: 'dashdot', sysDashDotDot: 'dashdot', dot: 'dot', sysDot: 'dot' };
  var HEADS = { triangle: 'arrow', stealth: 'arrow', arrow: 'open', oval: 'dot', diamond: 'diamond', none: null };
  function shapeOK(k) { if (k === 'rect' || k === 'round' || k === 'pill' || k === 'ellipse' || k === 'triangle' || k === 'diamond' || k === 'para' || k === 'chevron' || k === 'arrow') return true; return (RT.SHAPES_X || []).indexOf(k) >= 0; }
  /* traço: a:ln (do spPr) + lnRef do estilo → {stroke, strokeW, dash, dashS, headS, headE} ou null */
  function lineOf(spPr, style, ctx) {
    var ln = kid(spPr, 'ln'), ref = style ? kid(style, 'lnRef') : null, out = null;
    if (ln && kid(ln, 'noFill')) return null;
    if (ln) {
      var f = fillOf(ln, ctx), w = ln.hasAttribute('w') ? num(att(ln, 'w'), 9525) : null;
      if (!f && ref && num(att(ref, 'idx'), 0) > 0) f = colorNode(ref.firstElementChild, ctx);
      if (w == null && ref && num(att(ref, 'idx'), 0) > 0) w = ctx.theme.lnW[num(att(ref, 'idx'), 1) - 1] || 9525;
      if (!f || f === 'none') return (f === 'none') ? null : (w ? { stroke: '#000000', w: w, ln: ln } : null);
      out = { stroke: f.hex, a: f.a, w: w == null ? 9525 : w, ln: ln };
    } else if (ref && num(att(ref, 'idx'), 0) > 0) {
      var c = colorNode(ref.firstElementChild, ctx); if (!c) return null;
      var ix = num(att(ref, 'idx'), 1), tl = ctx.theme.lns[ix - 1]; out = { stroke: c.hex, a: c.a, w: ctx.theme.lnW[ix - 1] || 9525, ln: tl };
    }
    if (!out) return null;
    var pd = out.ln ? kid(out.ln, 'prstDash') : null, dv = pd ? att(pd, 'val', 'solid') : 'solid';
    out.dashS = DASH[dv] || null; out.dash = !!out.dashS || !!(out.ln && kid(out.ln, 'custDash'));
    var he = out.ln ? kid(out.ln, 'headEnd') : null, te = out.ln ? kid(out.ln, 'tailEnd') : null;
    out.headS = he ? HEADS[att(he, 'type', 'none')] || null : null; out.headE = te ? HEADS[att(te, 'type', 'none')] || null : null;
    return out;
  }
  function fillWithStyle(spPr, style, ctx) {
    var f = fillOf(spPr, ctx); if (f) return f;
    var ref = style ? kid(style, 'fillRef') : null; if (!ref || num(att(ref, 'idx'), 0) === 0) return null;
    var c = colorNode(ref.firstElementChild, ctx); if (!c) return null;
    var idx = num(att(ref, 'idx'), 1), fs = idx >= 1001 ? ctx.theme.bgFills[idx - 1001] : ctx.theme.fills[idx - 1];
    if (fs && fs.localName !== 'solidFill') { var g = fillOf({ firstElementChild: fs, getElementsByTagNameNS: function () { return []; } }, Object.assign({}, ctx, { phClr: c.hex })); if (g && g !== 'none') return g; }
    return c;
  }
  function fontRefColor(style, ctx) { var fr = style ? kid(style, 'fontRef') : null; return fr && fr.firstElementChild ? colorNode(fr.firstElementChild, ctx) : null; }
  function effectShadow(spPr) { var fx = kid(spPr, 'effectLst'); return !!(fx && kid(fx, 'outerShdw')); }
  /* chain de estilos de texto para uma forma: própria lstStyle é lida em readText; aqui vão os níveis herdados (ph do layout/mestre + txStyles) */
  function chainFor(ph, sctx) {
    var out = [];
    if (ph) { var lp = phMatch(sctx.layoutPh, ph), mp = phMatch(sctx.masterPh, ph); if (lp) out.push(path(lp.sp, ['txBody', 'lstStyle'])); if (mp) out.push(path(mp.sp, ['txBody', 'lstStyle'])); }
    var tx = sctx.master.txStyles, t = ph ? normPh(ph.type) : null;
    out.push(ph ? (t === 'title' ? kid(tx, 'titleStyle') : t === 'body' ? kid(tx, 'bodyStyle') : kid(tx, 'otherStyle')) : kid(tx, 'otherStyle'));
    out.push(sctx.defaultTextStyle);
    return out;
  }
  /* elemento do Canteiro a partir de um p:sp (ou dsp:sp do SmartArt) */
  function spToEl(sp, sctx, tf, o) {
    o = o || {};
    var ctx = sctx.ctx, spPr = kid(sp, 'spPr'), style = kid(sp, 'style'), ph = o.noPh ? null : phInfo(sp), txBody = kid(sp, 'txBody');
    var xf = xfrmOf(spPr), lp = null, mp = null;
    if (ph) { lp = phMatch(sctx.layoutPh, ph); mp = phMatch(sctx.masterPh, ph); if (!xf && lp) xf = xfrmOf(kid(lp.sp, 'spPr')); if (!xf && mp) xf = xfrmOf(kid(mp.sp, 'spPr')); }
    if (!xf || xf.w <= 0 && xf.h <= 0) return null;
    var b = boxPx(ctx, tf ? tf(xf) : xf);
    var geo = kid(spPr, 'prstGeom'), prst = geo ? att(geo, 'prst', 'rect') : (kid(spPr, 'custGeom') ? 'custom' : 'rect');
    if (ph && !geo && !kid(spPr, 'custGeom')) { var pspPr = lp ? kid(lp.sp, 'spPr') : null, pg = pspPr ? kid(pspPr, 'prstGeom') : null; if (pg) prst = att(pg, 'prst', 'rect'); }
    var text = null, hasText = false;
    if (txBody) { text = readText(txBody, chainFor(ph, sctx), ctx, { fontRef: fontRefColor(style, ctx), slideNo: sctx.slideNo }); hasText = /\S/.test(text.plain); }
    if (ph && !hasText) return null; /* espaço reservado vazio (“Clique para adicionar…”): não é conteúdo */
    /* preenchimento e traço: do próprio spPr, senão do ph do layout/mestre, senão do estilo (p:style) */
    var fill = fillWithStyle(spPr, style, ctx); if (fill == null && ph) { fill = lp ? fillWithStyle(kid(lp.sp, 'spPr'), kid(lp.sp, 'style'), ctx) : null; if (fill == null && mp) fill = fillWithStyle(kid(mp.sp, 'spPr'), kid(mp.sp, 'style'), ctx); }
    var line = lineOf(spPr, style, ctx); if (!line && !kid(spPr, 'ln') && ph) { line = lp ? lineOf(kid(lp.sp, 'spPr'), kid(lp.sp, 'style'), ctx) : null; if (!line && mp) line = lineOf(kid(mp.sp, 'spPr'), kid(mp.sp, 'style'), ctx); }
    var blip = kid(spPr, 'blipFill');
    if (blip) return picFromBlip(blip, b, sctx, { radius: prst === 'roundRect' ? Math.round(Math.min(b.w, b.h) * .17) : 0 }).then(function (im) { if (im && hasText) return [im, textEl(text, b, prst, null, null, ctx, true)]; return im; });
    if (LINE_GEO[prst]) return lineEl(xf, tf, line, prst, spPr, ctx);
    var isLine = !fill || fill === 'none'; /* sem preenchimento e sem traço com texto → caixa de texto */
    if (isLine && !line && hasText) return textEl(text, b, prst, null, null, ctx, false);
    if (isLine && !line && !hasText) return null;
    var kind = GEO[prst] || null, approx = false;
    if (!kind || !shapeOK(kind)) { kind = prst === 'custom' ? 'rect' : (kind && !shapeOK(kind) ? 'rect' : 'rect'); approx = true; }
    var el = { id: uid(), type: 'shape', shape: kind, x: b.x, y: b.y, w: b.w, h: b.h, fill: fill && fill !== 'none' ? fill.hex : 'none', stroke: line ? line.stroke : '#000000', strokeW: line ? r1(px(ctx, line.w)) : 0, radius: 0, html: hasText ? text.html : '', font: 'Inter', size: 20, weight: 600, color: '#002A46', align: 'center', valign: 'middle', anim: { in: 'none' } };
    if (line && line.dash) { el.dash = true; if (line.dashS) el.dashS = line.dashS; }
    if (b.rot) el.rot = Math.round(b.rot); if (b.flipH) el.flipH = true; if (b.flipV) el.flipV = true;
    if (prst === 'leftArrow') el.flipH = !el.flipH;
    if (prst === 'upArrow' || prst === 'downArrow') { var cx = b.x + b.w / 2, cy = b.y + b.h / 2; el.w = b.h; el.h = b.w; el.x = r1(cx - el.w / 2); el.y = r1(cy - el.h / 2); el.rot = Math.round((b.rot || 0) + (prst === 'upArrow' ? -90 : 90)); }
    if (kind === 'round') { var adj = kids(kid(geo, 'avLst'), 'gd')[0], av = adj ? num((att(adj, 'fmla', 'val 16667').split(' ')[1]), 16667) / 100000 : .16667; el.radius = Math.round(Math.min(b.w, b.h) * av); if (prst !== 'roundRect' && !adj) el.radius = Math.round(Math.min(b.w, b.h) * .16667); }
    if (kind === 'pill') el.radius = Math.round(Math.min(b.w, b.h) / 2);
    if (fill && fill !== 'none' && fill.a < .999 && !hasText) el.opacity = r1(fill.a * 100) / 100;
    if (effectShadow(spPr)) el.shadow = true;
    if (hasText) { Object.assign(el, { font: text.base.font, size: text.base.size, weight: text.base.weight, color: text.base.color, align: text.base.align, lh: text.base.lh, valign: text.valign || 'middle' }); if (text.base.italic) el.italic = true; if (text.base.upper) el.upper = true; if (text.base.ls) el.ls = text.base.ls; }
    if (approx) ctx.count.approx++;
    ctx.count.shapes++;
    return el;
  }
  /* caixa de texto: a caixa útil é a do xfrm menos os recuos do bodyPr (o Canteiro não tem recuo em texto solto) */
  function textEl(text, b, prst, _a, _b, ctx, over) {
    var ins = text.ins, l = px(ctx, ins.l), t = px(ctx, ins.t), r = px(ctx, ins.r), bt = px(ctx, ins.b);
    var el = { id: uid(), type: 'text', x: r1(b.x + l), y: r1(b.y + t), w: Math.max(8, r1(b.w - l - r)), h: Math.max(8, r1(b.h - t - bt)), html: text.html, font: text.base.font, size: text.base.size, weight: text.base.weight, color: text.base.color, align: text.base.align, valign: text.valign || 'top', lh: text.base.lh, anim: { in: 'none' } };
    if (text.base.italic) el.italic = true; if (text.base.upper) el.upper = true; if (text.base.ls) el.ls = text.base.ls;
    if (text.vert === 'vert' || text.vert === 'vert270' || text.vert === 'eaVert') { var cx = el.x + el.w / 2, cy = el.y + el.h / 2, w = el.h, h = el.w; el.w = w; el.h = h; el.x = r1(cx - w / 2); el.y = r1(cy - h / 2); el.rot = Math.round((b.rot || 0) + (text.vert === 'vert270' ? -90 : 90)); }
    else if (b.rot) el.rot = Math.round(b.rot);
    /* texto girado: a caixa gira em torno do centro da forma, e os recuos já foram aplicados (centro quase igual) */
    ctx.count.texts++;
    return el;
  }
  /* linha / conector: pontas pelo xfrm + flips; giro em torno do centro */
  function lineEl(xf, tf, line, prst, spPr, ctx) {
    var bb = tf ? tf(xf) : xf, b = boxPx(ctx, bb);
    var x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    if (b.flipH) { x1 = b.x + b.w; x2 = b.x; } if (b.flipV) { y1 = b.y + b.h; y2 = b.y; }
    if (b.rot) { var cx = b.x + b.w / 2, cy = b.y + b.h / 2, rad = b.rot * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad); var p1 = [cx + (x1 - cx) * c - (y1 - cy) * s, cy + (x1 - cx) * s + (y1 - cy) * c], p2 = [cx + (x2 - cx) * c - (y2 - cy) * s, cy + (x2 - cx) * s + (y2 - cy) * c]; x1 = p1[0]; y1 = p1[1]; x2 = p2[0]; y2 = p2[1]; }
    if (!line) line = { stroke: '#000000', w: 9525 };
    var el = { id: uid(), type: 'line', x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), stroke: line.stroke, strokeW: Math.max(.5, r1(px(ctx, line.w))), headStart: !!line.headS, headEnd: !!line.headE, dash: !!line.dash, anim: { in: 'none' } };
    if (line.headS) el.headS = line.headS; if (line.headE) el.headE = line.headE; if (line.dashS) el.dashS = line.dashS;
    if (/^bentConnector/.test(prst) && RT.LINE_ROUTES) { el.curve = 'elbow'; var g = kid(spPr, 'prstGeom'), adj = kids(kid(g, 'avLst'), 'gd')[0]; if (adj) { var v = num(att(adj, 'fmla', 'val 50000').split(' ')[1], 50000) / 100000; if (isFinite(v)) el.bend = clamp(v, .05, .95); } }
    else if (/^curvedConnector/.test(prst) && RT.LINE_ROUTES) el.curve = 'curve';
    ctx.count.lines++;
    return el;
  }
  /* foto a partir de um blipFill: embed → mídia (com recorte) → elemento imagem na caixa b */
  function picFromBlip(blipFill, b, sctx, o) {
    o = o || {}; var ctx = sctx.ctx, blip = kid(blipFill, 'blip'), rid = blip ? ratt(blip, 'embed') : null;
    if (!rid) return Promise.resolve(null);
    var rel = sctx.rels[rid]; if (!rel || rel.external) { ctx.w('imgExt'); return Promise.resolve(null); }
    var sr = kid(blipFill, 'srcRect'), crop = sr ? ['l', 't', 'r', 'b'].map(function (k) { return num(att(sr, k), 0) / 100000; }) : null;
    var alpha = blip ? kid(blip, 'alphaModFix') : null;
    /* recorte positivo vira el.crop (a foto inteira fica no arquivo, editável); recorte negativo (faixas) é assado pelo canvas */
    var keep = crop && crop.every(function (v) { return v >= 0 && v <= .9; }) && crop.some(function (v) { return v > .0005; }) && crop[0] + crop[2] <= .95 && crop[1] + crop[3] <= .95;
    return sctx.pkg.media(rel.target, keep ? null : crop).then(function (m) {
      if (!m || m.unsupported) { ctx.w('imgFmt'); return null; }
      var el = { id: uid(), type: 'image', src: m.src, x: b.x, y: b.y, w: Math.max(8, b.w), h: Math.max(8, b.h), fit: 'cover', radius: o.radius || 0, anim: { in: 'none' } };
      if (keep) el.crop = { l: r1(crop[0] * 1000) / 1000, t: r1(crop[1] * 1000) / 1000, r: r1(crop[2] * 1000) / 1000, b: r1(crop[3] * 1000) / 1000 };
      if (b.rot) el.rot = Math.round(b.rot); if (b.flipH) el.flipH = true; if (b.flipV) el.flipV = true;
      if (alpha) { var am = num(att(alpha, 'amt'), 100000) / 100000; if (am < .999) el.opacity = r1(am * 100) / 100; }
      ctx.count.images++;
      return el;
    });
  }
  function picToEl(pic, sctx, tf) {
    var spPr = kid(pic, 'spPr'), xf = xfrmOf(spPr); if (!xf) return Promise.resolve(null);
    var b = boxPx(sctx.ctx, tf ? tf(xf) : xf), geo = kid(spPr, 'prstGeom'), prst = geo ? att(geo, 'prst', 'rect') : 'rect', rad = 0;
    if (prst === 'roundRect') rad = Math.round(Math.min(b.w, b.h) * .17); else if (prst === 'ellipse') rad = Math.round(Math.min(b.w, b.h) / 2);
    return picFromBlip(kid(pic, 'blipFill'), b, sctx, { radius: rad }).then(function (el) { if (el && effectShadow(spPr)) el.shadow = true; return el; });
  }

  /* ======================= tabela: cada célula vira uma forma com texto ======================= */
  var TBL_STYLES = { '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1', '{3C2FFA5D-87B4-456A-9821-1D502468CF0F}': 'accent1', '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}': 'accent2', '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3', '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4', '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5', '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6', '{5940675A-B579-460E-94D1-54222C63F5DA}': 'none', '{2D5ABB26-0587-4C30-8999-92F81FD0307C}': 'none', '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'accent1' };
  function tableEls(frame, sctx, tf) {
    var ctx = sctx.ctx, tbl = descend(frame, 'tbl')[0]; if (!tbl) return [];
    var xf = xfrmOf(frame, 'xfrm'); if (!xf) return [];
    var fb = tf ? tf(xf) : xf, cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map(function (c) { return num(att(c, 'w'), 0); }), rows = kids(tbl, 'tr');
    var tp = kid(tbl, 'tblPr'), sid = textOf(kid(tp, 'tableStyleId')).trim(), acc = TBL_STYLES[sid] || (sid ? 'accent1' : 'none'), firstRow = att(tp, 'firstRow') === '1', band = att(tp, 'bandRow') === '1';
    var accHex = acc !== 'none' ? (ctx.theme.colors[acc] || '#4472C4') : null, out = [], y = fb.y, occupied = {};
    rows.forEach(function (tr, ri) {
      var rh = num(att(tr, 'h'), 0), x = fb.x, ci = 0;
      kids(tr, 'tc').forEach(function (tc) {
        while (occupied[ri + ':' + ci]) { x += cols[ci] || 0; ci++; }
        var gs = num(att(tc, 'gridSpan'), 1), rs = num(att(tc, 'rowSpan'), 1), hm = att(tc, 'hMerge') === '1', vm = att(tc, 'vMerge') === '1';
        var cw = 0; for (var k = 0; k < gs; k++) cw += cols[ci + k] || 0;
        var ch = 0; for (var q = 0; q < rs; q++) ch += num(att(rows[ri + q], 'h'), 0);
        for (var q2 = 0; q2 < rs; q2++) for (var k2 = 0; k2 < gs; k2++) if (q2 || k2) occupied[(ri + q2) + ':' + (ci + k2)] = 1;
        if (!hm && !vm) {
          var tcPr = kid(tc, 'tcPr'), fill = fillOf(tcPr, ctx), b = boxPx(ctx, { x: x, y: y, w: cw, h: ch, rot: fb.rot });
          var hdr = firstRow && ri === 0, bandOn = band && !hdr && ((firstRow ? ri - 1 : ri) % 2 === 0);
          var fillHex = fill && fill !== 'none' ? fill.hex : fill === 'none' ? 'none' : (accHex ? (hdr ? accHex : bandOn ? tint(accHex, .2) : tint(accHex, .4)) : '#FFFFFF');
          var lnT = kid(tcPr, 'lnT') || kid(tcPr, 'lnB') || kid(tcPr, 'lnL'), lcol = lnT ? fillOf(lnT, ctx) : null, lw = lnT ? num(att(lnT, 'w'), 12700) : 12700;
          var text = readText(kid(tc, 'txBody'), [kid(sctx.master.txStyles, 'otherStyle'), sctx.defaultTextStyle], ctx, { slideNo: sctx.slideNo });
          var el = { id: uid(), type: 'shape', shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, fill: fillHex, stroke: lcol && lcol !== 'none' ? lcol.hex : (accHex ? '#FFFFFF' : '#BFBFBF'), strokeW: lcol === 'none' ? 0 : Math.max(.5, r1(px(ctx, lw))), radius: 0, html: text.html, font: text.base.font, size: text.base.size, weight: hdr && accHex && !text.html.indexOf('<b>') ? 700 : text.base.weight, color: hdr && accHex && !fill ? '#FFFFFF' : text.base.color, align: text.base.align, valign: att(tcPr, 'anchor', 't') === 'ctr' ? 'middle' : att(tcPr, 'anchor', 't') === 'b' ? 'bottom' : 'top', lh: text.base.lh, anim: { in: 'none' } };
          if (text.base.italic) el.italic = true; if (fb.rot) el.rot = Math.round(fb.rot);
          out.push(el);
        }
        x += cw; ci += gs;
      });
      y += rh;
    });
    if (out.length) { ctx.count.tables++; ctx.count.shapes += out.length; }
    return out;
  }

  /* ======================= gráfico: c:chart → gráfico do Canteiro com os mesmos dados ======================= */
  function cache(node) { var pts = descend(node, 'pt'); return pts.map(function (p) { return textOf(kid(p, 'v')); }); }
  function chartEl(frame, sctx, tf) {
    var ctx = sctx.ctx, gd = descend(frame, 'graphicData')[0], ch = gd ? kids(gd)[0] : null, rid = ch ? ratt(ch, 'id') : null, rel = rid ? sctx.rels[rid] : null;
    var xf = xfrmOf(frame, 'xfrm'); if (!xf || !rel) return Promise.resolve(null);
    var b = boxPx(ctx, tf ? tf(xf) : xf);
    return sctx.pkg.xml(rel.target).then(function (doc) {
      if (!doc) return null;
      var pa = descend(doc.documentElement, 'plotArea')[0], title = descend(kid(descend(doc.documentElement, 'chart')[0], 'title'), 't').map(textOf).join(' ').trim();
      var kinds = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'pieChart', 'pie3DChart', 'doughnutChart', 'areaChart', 'ofPieChart'], node = null, kind = null;
      kinds.forEach(function (k) { if (!node) { var n = kid(pa, k); if (n) { node = n; kind = k; } } });
      if (!node) { ctx.w('chartKind'); return placeholderEl(b, 'Gráfico' + (title ? ': ' + title : ''), ctx); }
      var sers = kids(node, 'ser').map(function (s) { var tx = kid(s, 'tx'), name = tx ? (cache(tx)[0] || textOf(kid(tx, 'v'))) : ''; var cat = kid(s, 'cat'), val = kid(s, 'val'); var sp = kid(s, 'spPr'), f = sp ? fillOf(sp, ctx) : null; return { t: name || 'Série', cats: cat ? cache(cat) : [], v: val ? cache(val).map(function (x) { return num(x, 0); }) : [], color: f && f !== 'none' ? f.hex : null }; }).filter(function (s) { return s.v.length; });
      if (!sers.length) { ctx.w('chartKind'); return placeholderEl(b, 'Gráfico' + (title ? ': ' + title : ''), ctx); }
      var cats = sers[0].cats.length ? sers[0].cats : sers[0].v.map(function (_, i) { return String(i + 1); }), el = null, dark = isDarkHex(sctx.bg);
      function mk(k, data) { var A = S(); var e = A.mk.fx(k, null, dark); Object.assign(e.data, data); Object.assign(e, { x: b.x, y: b.y, w: b.w, h: b.h }); return e; }
      var colors = sers.map(function (s) { return s.color; }).filter(Boolean);
      if (/^bar/.test(kind) && att(node, 'barDir') ? att(kid(node, 'barDir'), 'val', 'col') === 'bar' : false) {
        el = mk('hbars', { title: title, items: cats.map(function (c, i) { return { t: c, v: sers[0].v[i] || 0 }; }), unit: '', hl: '', sort: 'none' });
        if (colors.length) el.data.colors = [colors[0]];
      } else if (/^bar/.test(kind)) {
        var grp = att(kid(node, 'grouping'), 'val', 'clustered');
        el = mk('columns', { title: title, cats: cats, series: sers.slice(0, 4).map(function (s) { return { t: s.t, v: cats.map(function (_, i) { return s.v[i] || 0; }) }; }), mode: grp === 'stacked' ? 'stack' : grp === 'percentStacked' ? 'pct' : 'cluster', unit: '' });
        if (colors.length) el.data.colors = colors.slice(0, 4);
      } else if (/pie|doughnut|ofPie/i.test(kind)) {
        el = mk('donut', { items: cats.map(function (c, i) { return { t: c, v: sers[0].v[i] || 0 }; }), center: title.slice(0, 24) });
        var dpt = kids(kids(node, 'ser')[0], 'dPt').map(function (d) { var f = fillOf(kid(d, 'spPr'), ctx); return f && f !== 'none' ? f.hex : null; }).filter(Boolean); if (dpt.length) el.data.colors = dpt.slice(0, 6);
      } else {
        el = mk('linechart', { title: title, labels: cats, values: cats.map(function (_, i) { return sers[0].v[i] || 0; }), unit: '', target: 0 });
        if (colors.length) el.data.colors = [colors[0]];
      }
      ctx.count.charts++;
      return el;
    });
  }
  function isDarkHex(h) { var c = hexRgb(h || '#FFFFFF'); return (.299 * c[0] + .587 * c[1] + .114 * c[2]) / 255 < .5; }
  function placeholderEl(b, label, ctx) {
    ctx.count.shapes++;
    return { id: uid(), type: 'shape', shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, fill: '#EEF2F7', stroke: '#A3B8D6', strokeW: 1.5, dash: true, radius: 8, html: esc(label) + '<br><span style="font-size:.75em;font-weight:400">não importado — recrie com Inserir</span>', font: 'Inter', size: 18, weight: 600, color: '#43698F', align: 'center', valign: 'middle', anim: { in: 'none' } };
  }

  /* ======================= SmartArt: o desenho gravado (dsp:sp) dentro da moldura ======================= */
  function smartEls(frame, sctx, tf) {
    var ctx = sctx.ctx, xf = xfrmOf(frame, 'xfrm'); if (!xf) return Promise.resolve([]);
    var rel = null; Object.keys(sctx.rels).forEach(function (k) { if (!rel && /diagramDrawing$/.test(sctx.rels[k].type)) rel = sctx.rels[k]; });
    var b = boxPx(ctx, tf ? tf(xf) : xf);
    if (!rel) { ctx.w('smartNoDraw'); return Promise.resolve([placeholderEl(b, 'SmartArt', ctx)]); }
    return sctx.pkg.xml(rel.target).then(function (doc) {
      if (!doc) return [placeholderEl(b, 'SmartArt', ctx)];
      var tree = descend(doc.documentElement, 'spTree')[0], out = [], jobs = [];
      /* as formas do desenho ficam no espaço da moldura: deslocamento pela origem da moldura (com a transformação do grupo, se houver) */
      var tf2 = function (bx) { var o = { x: bx.x + xf.x, y: bx.y + xf.y, w: bx.w, h: bx.h, rot: bx.rot, flipH: bx.flipH, flipV: bx.flipV }; return tf ? tf(o) : o; };
      kids(tree, 'sp').forEach(function (sp) { if (att(sp, 'modelId') == null && !kid(sp, 'spPr')) return; var r = spToEl(sp, sctx, tf2, { noPh: true }); if (r && typeof r.then === 'function') jobs.push(r.then(function (e) { if (e) out.push(e); })); else if (r) out.push(r); });
      return Promise.all(jobs).then(function () { if (out.length) ctx.count.smart += out.length; return [].concat.apply([], out.map(function (e) { return Array.isArray(e) ? e : [e]; })); });
    });
  }

  /* ======================= árvore de formas de um slide/layout/mestre ======================= */
  function walkTree(tree, sctx, tf, o) {
    o = o || {}; var out = [], chain = Promise.resolve();
    function add(v) { if (!v) return; if (Array.isArray(v)) v.forEach(add); else out.push(v); }
    kids(tree).forEach(function (n) {
      var nm = n.localName;
      if (nm === 'AlternateContent') { var fb = kid(n, 'Fallback') || kid(n, 'Choice'); if (fb) chain = chain.then(function () { return walkTree(fb, sctx, tf, o).then(add); }); return; }
      if (nm === 'sp') { if (o.skipPh && phInfo(n)) return; chain = chain.then(function () { var r = spToEl(n, sctx, tf, o); return r && typeof r.then === 'function' ? r.then(add) : add(r); }); }
      else if (nm === 'pic') { if (o.skipPh && phInfo(n)) return; chain = chain.then(function () { return picToEl(n, sctx, tf).then(add); }); }
      else if (nm === 'cxnSp') { chain = chain.then(function () { var spPr = kid(n, 'spPr'), xf = xfrmOf(spPr); if (!xf) return; var g = kid(spPr, 'prstGeom'); add(lineEl(xf, tf, lineOf(spPr, kid(n, 'style'), sctx.ctx), g ? att(g, 'prst', 'line') : 'line', spPr, sctx.ctx)); }); }
      else if (nm === 'grpSp') { chain = chain.then(function () { var gx = xfrmOf(kid(n, 'grpSpPr')); if (!gx) return; return walkTree(n, sctx, groupTf(gx, tf), o).then(add); }); }
      else if (nm === 'graphicFrame') {
        if (o.skipPh && phInfo(n)) return;
        chain = chain.then(function () {
          var gd = descend(n, 'graphicData')[0], uri = gd ? att(gd, 'uri', '') : '';
          if (/table$/.test(uri)) return add(tableEls(n, sctx, tf));
          if (/chart$/.test(uri)) return chartEl(n, sctx, tf).then(add);
          if (/diagram$/.test(uri)) return smartEls(n, sctx, tf).then(add);
          var pic = descend(n, 'pic')[0]; if (pic) return picToEl(pic, sctx, tf).then(add); /* OLE e outros: a imagem de reserva */
          var xf = xfrmOf(n, 'xfrm'); if (xf) { sctx.ctx.w('objUnknown'); add(placeholderEl(boxPx(sctx.ctx, tf ? tf(xf) : xf), 'Objeto', sctx.ctx)); }
        });
      }
    });
    return chain.then(function () { return out; });
  }

  /* ======================= fundo ======================= */
  function bgOf(cSld, sctx) {
    var ctx = sctx.ctx, bg = kid(cSld, 'bg'); if (!bg) return null;
    var pr = kid(bg, 'bgPr');
    if (pr) {
      var blip = kid(pr, 'blipFill'); if (blip) { return { img: blip }; }
      var f = fillOf(pr, ctx); if (f && f !== 'none') return { hex: f.hex }; return null;
    }
    var ref = kid(bg, 'bgRef'); if (ref) { var c = colorNode(ref.firstElementChild, ctx); if (c) { var idx = num(att(ref, 'idx'), 1001), fs = ctx.theme.bgFills[idx - 1001]; if (fs && fs.localName === 'gradFill') { var g = fillOf({ firstElementChild: fs }, Object.assign({}, ctx, { phClr: c.hex })); if (g && g !== 'none') return { hex: g.hex }; } return { hex: c.hex }; } }
    return null;
  }

  /* ======================= PowerPoint: leitura do pacote inteiro ======================= */
  function importPptx(buf, opts) {
    opts = opts || {}; var ctx = new Ctx(opts), zip, pkg, onP = opts.onProgress || function () { }, sig = opts.signal || {};
    try { zip = zipOpen(buf instanceof Uint8Array ? buf : new Uint8Array(buf)); } catch (e) { return Promise.reject(e); }
    if (!zip.has('[Content_Types].xml')) return Promise.reject(new Error('não é um arquivo do PowerPoint (.pptx)'));
    pkg = new Pkg(zip);
    return pkg.rels('').then(function (root) { /* relações do pacote: _rels/.rels */
      var pres = null; Object.keys(root).forEach(function (k) { if (root[k].type === 'officeDocument') pres = root[k].target; });
      if (!pres) throw new Error('não é um arquivo do PowerPoint (.pptx)');
      return Promise.all([pkg.xml(pres), pkg.rels(pres)]).then(function (r) {
        var pdoc = r[0], prels = r[1]; if (!pdoc) throw new Error('presentation.xml ilegível');
        var root2 = pdoc.documentElement, sz = kid(root2, 'sldSz'), sw = num(att(sz, 'cx'), 12192000), sh = num(att(sz, 'cy'), 6858000);
        var spw = sw / EMU_PX, sph = sh / EMU_PX; ctx.k = Math.min(W / spw, H / sph); ctx.ox = (W - spw * ctx.k) / 2; ctx.oy = (H - sph * ctx.k) / 2; ctx.ratio = sw / sh;
        ctx.defaultTextStyle = kid(root2, 'defaultTextStyle');
        var ids = kids(kid(root2, 'sldIdLst'), 'sldId').map(function (s) { return { id: att(s, 'id'), rid: ratt(s, 'id') }; });
        /* seções (capítulos): primeira página de cada seção */
        var secOf = {}; descend(root2, 'section').forEach(function (s) { var nm = att(s, 'name', ''); var first = descend(s, 'sldId')[0]; if (first && nm) secOf[att(first, 'id')] = nm; });
        var slides = [], i = 0, title = '';
        return pkg.xml('docProps/core.xml').then(function (core) { if (core) title = textOf(descend(core.documentElement, 'title')[0]).trim(); })
          .then(function next() {
            if (sig.cancelled) return null;
            if (i >= ids.length) return { title: title, slides: slides, ctx: ctx, ratio: ctx.ratio };
            var it = ids[i], rel = prels[it.rid]; i++;
            onP(i - 1, ids.length);
            if (opts.slow) return new Promise(function (r) { setTimeout(r, opts.slow); }).then(function () { return rel ? readSlide(pkg, rel.target, ctx, i, secOf[it.id]).then(function (s) { if (s) slides.push(s); return next(); }) : next(); }); /* só testes: atraso por slide para exercitar o cancelar */
            if (!rel) return tick().then(next);
            return readSlide(pkg, rel.target, ctx, i, secOf[it.id]).then(function (s) { if (s) slides.push(s); return tick().then(next); });
          });
      });
    });
  }
  /* mestre e layout de um slide (com cache no ctx): tema, clrMap, placeholders, txStyles, formas decorativas, fundo */
  function readMaster(pkg, p, ctx) {
    ctx.masters = ctx.masters || {}; if (ctx.masters[p]) return ctx.masters[p];
    return (ctx.masters[p] = Promise.all([pkg.xml(p), pkg.rels(p)]).then(function (r) {
      var doc = r[0], rels = r[1], th = null; Object.keys(rels).forEach(function (k) { if (rels[k].type === 'theme') th = rels[k].target; });
      return (th ? pkg.xml(th) : Promise.resolve(null)).then(function (tdoc) {
        var root = doc.documentElement, cSld = kid(root, 'cSld'), tree = kid(cSld, 'spTree');
        var m = { path: p, rels: rels, theme: readTheme(tdoc), clrMap: readClrMap(kid(root, 'clrMap')), txStyles: kid(root, 'txStyles'), ph: [], tree: tree, cSld: cSld, doc: doc };
        if (!ctx.theme0) ctx.theme0 = m.theme; /* S29: o tema do primeiro mestre vira o kit de marca da obra importada */
        kids(tree).forEach(function (n) { var ph = phInfo(n); if (ph) m.ph.push({ type: ph.type, idx: ph.idx, sp: n }); });
        return m;
      });
    }));
  }
  function readLayout(pkg, p, ctx) {
    ctx.layouts = ctx.layouts || {}; if (ctx.layouts[p]) return ctx.layouts[p];
    return (ctx.layouts[p] = Promise.all([pkg.xml(p), pkg.rels(p)]).then(function (r) {
      var doc = r[0], rels = r[1], mp = null; Object.keys(rels).forEach(function (k) { if (rels[k].type === 'slideMaster') mp = rels[k].target; });
      return readMaster(pkg, mp, ctx).then(function (master) {
        var root = doc.documentElement, cSld = kid(root, 'cSld'), tree = kid(cSld, 'spTree'), ov = kid(root, 'clrMapOvr'), ovm = ov ? kid(ov, 'overrideClrMapping') : null;
        var l = { path: p, rels: rels, master: master, clrMap: ovm ? readClrMap(ovm) : master.clrMap, ph: [], tree: tree, cSld: cSld, showMaster: att(root, 'showMasterSp', '1') !== '0' };
        kids(tree).forEach(function (n) { var ph = phInfo(n); if (ph) l.ph.push({ type: ph.type, idx: ph.idx, sp: n }); });
        return l;
      });
    }));
  }
  function readSlide(pkg, p, ctx, no, secName) {
    return Promise.all([pkg.xml(p), pkg.rels(p)]).then(function (r) {
      var doc = r[0], rels = r[1]; if (!doc) { ctx.w('slideBad'); return null; }
      var lp = null, notesP = null; Object.keys(rels).forEach(function (k) { if (rels[k].type === 'slideLayout') lp = rels[k].target; if (rels[k].type === 'notesSlide') notesP = rels[k].target; });
      return (lp ? readLayout(pkg, lp, ctx) : Promise.reject(new Error('slide sem layout'))).then(function (layout) {
        var master = layout.master, root = doc.documentElement, cSld = kid(root, 'cSld'), ov = kid(root, 'clrMapOvr'), ovm = ov ? kid(ov, 'overrideClrMapping') : null;
        var theme = master.theme, clrMap = ovm ? readClrMap(ovm) : layout.clrMap;
        var ectx = Object.assign(Object.create(ctx), { theme: theme, clrMap: clrMap });
        var sctx = { ctx: ectx, pkg: pkg, rels: rels, layoutPh: layout.ph, masterPh: master.ph, master: master, defaultTextStyle: ctx.defaultTextStyle, slideNo: no, bg: '#FFFFFF' };
        /* fundo: slide → layout → mestre */
        var bg = bgOf(cSld, sctx) || bgOf(layout.cSld, Object.assign({}, sctx, { rels: layout.rels })) || bgOf(master.cSld, Object.assign({}, sctx, { rels: master.rels })) || { hex: theme.colors[clrMap.bg1 || 'lt1'] || '#FFFFFF' };
        var slide = { id: 's' + Math.random().toString(36).slice(2, 9), bg: bg.hex || '#FFFFFF', tr: 'fade', els: [] };
        sctx.bg = slide.bg;
        if (att(root, 'show', '1') === '0') slide.hidden = true;
        if (secName) slide.sec = secName.slice(0, 80);
        var showMaster = att(root, 'showMasterSp', '1') !== '0';
        var pre = Promise.resolve();
        if (bg.img) pre = picFromBlip(bg.img, { x: 0, y: 0, w: W, h: H }, Object.assign({}, sctx, { rels: bg.img.ownerDocument === doc ? rels : (bg.img.ownerDocument === master.doc ? master.rels : layout.rels) }), {}).then(function (im) { if (im) { slide.bgImg = im.src; ctx.count.images--; } });
        return pre.then(function () {
          /* formas decorativas do mestre e do layout (logos, faixas, rodapés fixos), depois as do slide */
          var jobs = [];
          if (showMaster && layout.showMaster) jobs.push(walkTree(master.tree, Object.assign({}, sctx, { rels: master.rels }), null, { skipPh: true }));
          if (showMaster) jobs.push(walkTree(layout.tree, Object.assign({}, sctx, { rels: layout.rels }), null, { skipPh: true }));
          jobs.push(walkTree(kid(cSld, 'spTree'), sctx, null, {}));
          return Promise.all(jobs);
        }).then(function (parts) {
          parts.forEach(function (list) { list.forEach(function (e) { slide.els.push(e); }); });
          /* título do slide: o espaço reservado de título */
          var tt = kids(kid(cSld, 'spTree'), 'sp').filter(function (sp) { var ph = phInfo(sp); return ph && normPh(ph.type) === 'title'; })[0];
          if (tt) { var pl = descend(kid(tt, 'txBody'), 't').map(textOf).join('').replace(/\s+/g, ' ').trim(); if (pl) slide.title = pl.slice(0, 160); }
          ctx.count.slides++;
          if (!notesP || ctx.opts.notes === false) return slide;
          return pkg.xml(notesP).then(function (nd) {
            if (!nd) return slide;
            var body = kids(descend(nd.documentElement, 'spTree')[0], 'sp').filter(function (sp) { var ph = phInfo(sp); return ph && ph.type === 'body'; })[0];
            if (body) { var txt = kids(kid(body, 'txBody'), 'p').map(function (pp) { return descend(pp, 't').map(textOf).join(''); }).join('\n').trim(); if (txt) { slide.notes = txt.slice(0, 4000); ctx.count.notes++; } }
            return slide;
          });
        });
      });
    }).catch(function (e) { ctx.w('slideBad'); if (window.console && console.warn) console.warn('AMImport slide', p, e); return null; });
  }

  /* ======================= PDF (pdf.js, carregado quando é preciso) ======================= */
  var PDFJS_V = '4.10.38', PDFJS_CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_V + '/',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_V + '/build/',
    'https://unpkg.com/pdfjs-dist@' + PDFJS_V + '/build/'];
  var pdfjs = null;
  function loadPdfjs() {
    if (pdfjs) return pdfjs;
    var bases = (window.AM_PDFJS ? [window.AM_PDFJS] : []).concat(PDFJS_CDN), i = 0;
    function tryNext(lastErr) {
      if (i >= bases.length) return Promise.reject(new Error('não foi possível baixar o leitor de PDF (pdf.js). Verifique a conexão com a internet e tente de novo.' + (lastErr ? ' (' + lastErr.message + ')' : '')));
      var base = bases[i++];
      return new Function('u', 'return import(u)')(base + 'pdf.min.mjs').then(function (lib) { lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'; return lib; }).catch(tryNext);
    }
    return (pdfjs = tryNext().catch(function (e) { pdfjs = null; throw e; }));
  }
  function fontInfo(page, name) {
    var f = null; try { f = page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch (e) { f = null; }
    var raw = f && f.name ? String(f.name) : String(name || ''), nm = raw.replace(/^[A-Z]{6}\+/, ''), fam = nm.split(/[-,_]/)[0].replace(/(MT|PS|PSMT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    var low = nm.toLowerCase(), bold = !!(f && f.bold) || /bold|black|heavy|semibold|demi/.test(low), italic = !!(f && f.italic) || /italic|oblique/.test(low), light = /light|thin/.test(low);
    if (/^(arial|helvetica|liberationsans|calibri|segoe)/i.test(fam.replace(/\s/g, ''))) fam = fam; if (!fam || /^g_d\d/.test(fam)) fam = 'Inter';
    return { family: fam.slice(0, 40), weight: bold ? 700 : light ? 300 : 400, italic: italic, mono: !!(f && f.isMonospace) || /mono|courier|consolas/.test(low) };
  }
  function importPdf(buf, opts) {
    opts = opts || {}; var ctx = new Ctx(opts), onP = opts.onProgress || function () { }, sig = opts.signal || {};
    return loadPdfjs().then(function (lib) {
      return lib.getDocument({ data: buf instanceof Uint8Array ? buf : new Uint8Array(buf), isEvalSupported: false, disableFontFace: false }).promise;
    }).then(function (doc) {
      var n = doc.numPages, slides = [], i = 0, title = '';
      return doc.getMetadata().then(function (m) { try { title = (m && m.info && m.info.Title) || ''; } catch (e) { } }).catch(function () { }).then(function next() {
        if (sig.cancelled) return null;
        if (i >= n) return { title: String(title || '').trim(), slides: slides, ctx: ctx };
        onP(i, n); i++;
        return doc.getPage(i).then(function (page) { return pdfPage(page, ctx, i); }).then(function (s) { slides.push(s); return tick().then(next); });
      });
    });
  }
  function pdfPage(page, ctx, no) {
    var vp1 = page.getViewport({ scale: 1 }), pw = vp1.width, ph = vp1.height, k = Math.min(W / pw, H / ph), ox = (W - pw * k) / 2, oy = (H - ph * k) / 2, sc = 2;
    var vp = page.getViewport({ scale: sc }), cvB = document.createElement('canvas'), cvF = document.createElement('canvas');
    cvB.width = cvF.width = Math.round(vp.width); cvB.height = cvF.height = Math.round(vp.height);
    var cxB = cvB.getContext('2d', { willReadFrequently: true }), cxF = cvF.getContext('2d', { willReadFrequently: true });
    /* fundo sem o texto: o pdf.js desenha os glifos com fillText/strokeText — anulados neste contexto, o resto da página (fundos, formas, fotos) sai normal */
    cxB.fillText = function () { }; cxB.strokeText = function () { };
    var slide = { id: 's' + Math.random().toString(36).slice(2, 9), bg: '#FFFFFF', tr: 'fade', els: [] };
    return page.render({ canvasContext: cxB, viewport: vp }).promise.then(function () {
      return page.render({ canvasContext: cxF, viewport: vp }).promise;
    }).then(function () { return page.getTextContent({ includeMarkedContent: false }); }).then(function (tc) {
      var items = tc.items.filter(function (it) { return it.str && /\S/.test(it.str) && it.transform; }).map(function (it) {
        var t = it.transform, size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10, rot = Math.round(Math.atan2(t[1], t[0]) * 180 / Math.PI);
        var st = tc.styles[it.fontName] || {}, asc = st.ascent || .9, desc = st.descent || -.22;
        return { s: it.str, x: t[4], base: t[5], w: it.width || 0, size: size, rot: rot, font: it.fontName, asc: asc, desc: desc };
      });
      /* linhas: mesma base (±30 % do tamanho) e mesmo giro; ordenadas de cima para baixo e da esquerda para a direita */
      items.sort(function (a, b) { return (b.base - a.base) || (a.x - b.x); });
      var lines = [];
      items.forEach(function (it) {
        var ln = lines[lines.length - 1];
        if (ln && ln.rot === it.rot && Math.abs(ln.base - it.base) < Math.max(ln.size, it.size) * .35) {
          var gap = it.x - ln.x1; if (gap > it.size * .22 && !/\s$/.test(ln.s) && !/^\s/.test(it.s)) ln.s += ' ';
          ln.s += it.s; ln.x1 = Math.max(ln.x1, it.x + it.w); ln.size = Math.max(ln.size, it.size); ln.n++;
        } else lines.push({ s: it.s, x0: it.x, x1: it.x + it.w, base: it.base, size: it.size, rot: it.rot, font: it.font, asc: it.asc, desc: it.desc, n: 1 });
      });
      /* blocos: linhas seguidas, com tamanho parecido, bordas alinhadas (esquerda, centro ou direita) e entrelinha ≤ 1,9× */
      var blocks = [];
      lines.forEach(function (ln) {
        var bk = blocks[blocks.length - 1], last = bk ? bk.lines[bk.lines.length - 1] : null;
        var ok = bk && last && ln.rot === bk.rot && Math.abs(ln.size - bk.size) <= bk.size * .25 && ln.font === bk.font && (last.base - ln.base) > 0 && (last.base - ln.base) <= bk.size * 1.9 &&
          (Math.abs(ln.x0 - bk.x0) < bk.size * 1.5 || Math.abs((ln.x0 + ln.x1) / 2 - (bk.x0 + bk.x1) / 2) < bk.size * 1.5 || Math.abs(ln.x1 - bk.x1) < bk.size * 1.5);
        if (ok) { bk.lines.push(ln); bk.x0 = Math.min(bk.x0, ln.x0); bk.x1 = Math.max(bk.x1, ln.x1); }
        else blocks.push({ lines: [ln], x0: ln.x0, x1: ln.x1, size: ln.size, rot: ln.rot, font: ln.font });
      });
      var dF = cxF.getImageData(0, 0, cvF.width, cvF.height).data, dB = cxB.getImageData(0, 0, cvB.width, cvB.height).data;
      blocks.forEach(function (bk) {
        var L = bk.lines, first = L[0], lastL = L[L.length - 1], fi = fontInfo(page, bk.font), size = bk.size;
        var lh = L.length > 1 ? clamp((first.base - lastL.base) / (L.length - 1) / size, .8, 3) : 1.2;
        var top = ph - first.base - size * Math.max(.8, first.asc), bottom = ph - lastL.base - size * Math.min(-.15, lastL.desc);
        var x0 = bk.x0, x1 = bk.x1;
        var lefts = L.map(function (l) { return l.x0; }), rights = L.map(function (l) { return l.x1; });
        var align = L.length > 1 && Math.max.apply(null, lefts) - Math.min.apply(null, lefts) > size * .8 ? (Math.max.apply(null, rights) - Math.min.apply(null, rights) < size * .8 ? 'right' : 'center') : (L.length === 1 && Math.abs((x0 + x1) / 2 - pw / 2) < size * 1.2 && x0 > size ? 'center' : 'left');
        var color = sampleColor(dF, dB, cvF.width, cvF.height, x0 * sc, top * sc, (x1 - x0) * sc, (bottom - top) * sc) || '#1F1F1F';
        var sizePx = Math.max(4, r1(size * k)), asc = .92;
        var yEl = (ph - first.base) * k + oy - ((lh - 1) / 2 + asc) * sizePx; /* mesma linha de base do PDF */
        var el = { id: uid(), type: 'text', x: r1(x0 * k + ox - 1), y: r1(yEl), w: Math.max(8, r1((x1 - x0) * k * 1.06 + sizePx * .6 + 2)), h: Math.max(8, r1(L.length * lh * sizePx + 2)), html: '<div style="white-space:nowrap">' + L.map(function (l) { return esc(l.s.replace(/\s+/g, ' ').trim()).replace(/ {2}/g, ' &nbsp;'); }).join('<br>') + '</div>', font: FONTS_OK[fi.family] ? fi.family : fi.family, size: sizePx, weight: fi.weight, color: color, align: align, valign: 'top', lh: r1(lh * 100) / 100, anim: { in: 'none' } };
        if (align === 'right') { el.x = r1(x1 * k + ox + 1 - el.w); } else if (align === 'center') { el.x = r1((x0 + x1) / 2 * k + ox - el.w / 2); }
        if (fi.italic) el.italic = true;
        if (bk.rot) { var cx = el.x + el.w / 2, cy = el.y + el.h / 2; el.rot = -bk.rot; el.x = r1(cx - el.w / 2); el.y = r1(cy - el.h / 2); }
        ctx.fonts[fi.family] = (ctx.fonts[fi.family] || 0) + 1;
        slide.els.push(el); ctx.count.texts++;
      });
      /* fundo: a página sem o texto (JPEG 2×); fundo todo branco e sem desenho → sem imagem */
      var blank = isBlank(dB, cvB.width, cvB.height);
      if (!blank) { slide.bgImg = cvB.toDataURL('image/jpeg', .86); ctx.count.images++; }
      slide.bg = blank ? '#FFFFFF' : (sampleEdge(dB, cvB.width, cvB.height) || '#FFFFFF');
      cvB.width = cvB.height = cvF.width = cvF.height = 0;
      ctx.count.slides++;
      return slide;
    });
  }
  function isBlank(d, w, h) { for (var y = 0; y < h; y += 7) for (var x = 0; x < w; x += 7) { var i = (y * w + x) * 4; if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) return false; } return true; }
  function sampleEdge(d, w, h) { var i = ((h - 2) * w + 2) * 4; return rgbHex(d[i], d[i + 1], d[i + 2]); }
  /* cor do texto: pixels que mudam entre a página com e sem texto dentro da caixa → cor mais frequente (quantizada) */
  function sampleColor(dF, dB, w, h, x, y, bw, bh) {
    var x0 = clamp(Math.floor(x), 0, w - 1), y0 = clamp(Math.floor(y), 0, h - 1), x1 = clamp(Math.ceil(x + bw), 0, w), y1 = clamp(Math.ceil(y + bh), 0, h), hist = {}, best = null, bn = 0, tot = 0;
    var step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 20000)));
    for (var yy = y0; yy < y1; yy += step) for (var xx = x0; xx < x1; xx += step) {
      var i = (yy * w + xx) * 4; if (Math.abs(dF[i] - dB[i]) + Math.abs(dF[i + 1] - dB[i + 1]) + Math.abs(dF[i + 2] - dB[i + 2]) < 60) continue;
      tot++; var key = ((dF[i] >> 4) << 8) | ((dF[i + 1] >> 4) << 4) | (dF[i + 2] >> 4), n = (hist[key] = (hist[key] || 0) + 1); if (n > bn) { bn = n; best = [dF[i], dF[i + 1], dF[i + 2]]; }
    }
    if (!best || tot < 4) return null;
    /* média dos pixels da cor vencedora (sem a borda antialiasada) */
    var r = 0, g = 0, b = 0, c = 0, bk = ((best[0] >> 4) << 8) | ((best[1] >> 4) << 4) | (best[2] >> 4);
    for (var y2 = y0; y2 < y1; y2 += step) for (var x2 = x0; x2 < x1; x2 += step) { var j = (y2 * w + x2) * 4; if ((((dF[j] >> 4) << 8) | ((dF[j + 1] >> 4) << 4) | (dF[j + 2] >> 4)) === bk) { r += dF[j]; g += dF[j + 1]; b += dF[j + 2]; c++; } }
    return c ? rgbHex(r / c, g / c, b / c) : rgbHex(best[0], best[1], best[2]);
  }

  /* ======================= resultado → apresentação ======================= */
  function finish(res, file, opts) {
    var A = S(), slides = res.slides, ctx = res.ctx;
    if (!slides.length) throw new Error('nenhum slide foi lido');
    var name = String(file && file.name || 'apresentacao').replace(/\.(pptx|pdf)$/i, ''), title = (res.title || name).slice(0, 160);
    var rep = report(ctx, slides);
    if (opts.mode === 'append') { var n = A.appendSlides(slides); rep.added = n; rep.replaced = false; }
    else { var d = A.newDeck(); d.title = title; d.slides = slides; var bk = brandOf(ctx, name); if (bk) d.brand = bk; if (!A.loadDeck(d, null)) throw new Error('a apresentação lida não passou na validação'); rep.added = A.deck.slides.length; rep.replaced = true; }
    rep.inst = window.AMInst && window.AMInst.scan ? window.AMInst.scan(rep.replaced ? 0 : A.deck.slides.length - rep.added, rep.added) : []; /* S34: slides institucionais reconhecidos → troca pelos oficiais */
    return rep;
  }
  /* S29: kit de marca a partir do tema do arquivo (acentos, dk2, lt2, dk1, sem o branco) e a fonte de corpo do tema; só ao substituir a obra */
  function brandOf(ctx, name) {
    var th = ctx.theme0; if (!th) return null; var c = th.colors || {}, cols = [], seen = {};
    ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'dk2', 'lt2', 'dk1'].forEach(function (k) { var h = typeof c[k] === 'string' ? c[k].toUpperCase() : ''; if (/^#[0-9A-F]{6}$/.test(h) && !seen[h] && h !== '#FFFFFF' && cols.length < 12) { seen[h] = 1; cols.push(h); } });
    var fw = th.min ? famWeight(th.min) : null, font = fw && fw.family && /^[\w\s.%-]{1,40}$/.test(fw.family) ? fw.family : null;
    if (!cols.length && !font) return null;
    var b = { name: ('Tema de ' + String(name || 'arquivo')).slice(0, 60) }; if (cols.length) b.colors = cols; if (font) b.font = font; return b;
  }
  var WARN = { imgFmt: 'imagem em formato que o navegador não desenha (EMF/WMF/TIFF): ficou de fora', imgExt: 'imagem ligada a um arquivo externo: ficou de fora', chartKind: 'gráfico de tipo sem equivalente: virou um quadro “não importado”', smartNoDraw: 'SmartArt sem desenho gravado no arquivo: virou um quadro “não importado”', objUnknown: 'objeto incorporado sem imagem de reserva: virou um quadro “não importado”', slideBad: 'slide que não pôde ser lido: pulado' };
  function report(ctx, slides) {
    var c = ctx.count, lines = [], warns = [];
    lines.push(c.slides + (c.slides === 1 ? ' slide' : ' slides'));
    if (c.texts) lines.push(c.texts + (c.texts === 1 ? ' texto' : ' textos')); if (c.shapes) lines.push(c.shapes + (c.shapes === 1 ? ' forma' : ' formas')); if (c.lines) lines.push(c.lines + (c.lines === 1 ? ' linha' : ' linhas'));
    if (c.images) lines.push(c.images + (c.images === 1 ? ' imagem' : ' imagens')); if (c.tables) lines.push(c.tables + (c.tables === 1 ? ' tabela' : ' tabelas')); if (c.charts) lines.push(c.charts + (c.charts === 1 ? ' gráfico' : ' gráficos'));
    if (c.smart) lines.push(c.smart + ' formas de SmartArt'); if (c.notes) lines.push(c.notes + (c.notes === 1 ? ' slide com anotações' : ' slides com anotações'));
    if (c.approx) warns.push(c.approx + (c.approx === 1 ? ' forma sem equivalente virou retângulo' : ' formas sem equivalente viraram retângulos') + ' (mesmo lugar, cor e texto)');
    Object.keys(ctx.warn).forEach(function (k) { if (WARN[k]) warns.push(ctx.warn[k] + '× ' + WARN[k]); });
    var GF = S() && S().brand && S().brand.GFONTS || {}; /* S29: fontes do Google que o Canteiro carrega sob demanda não faltam */
    var fonts = Object.keys(ctx.fonts).filter(function (f) { return !FONTS_OK[f] && !GF[f]; }).sort(function (a, b) { return ctx.fonts[b] - ctx.fonts[a]; });
    if (fonts.length) warns.push('fontes do arquivo que o Canteiro não traz: ' + fonts.slice(0, 5).join(', ') + (fonts.length > 5 ? '…' : '') + ' — usam a fonte instalada no computador; sem ela, Inter (as quebras de linha podem mudar)');
    if (c.charts) warns.push('gráficos viraram gráficos do Canteiro com os mesmos dados (o visual é o do Canteiro, editável no painel)');
    var hid = slides.filter(function (s) { return s.hidden; }).length; if (hid) lines.push(hid + (hid === 1 ? ' slide oculto' : ' slides ocultos'));
    return { lines: lines, warns: warns, count: c };
  }

  /* ======================= caixa “Importar apresentação” ======================= */
  var dlg = null, st = null;
  function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }
  var IIMP = '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>';
  function fmtKB(b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function build() {
    dlg = document.createElement('div'); dlg.id = 'xmDlg'; dlg.className = 'xp xm'; dlg.hidden = true;
    dlg.innerHTML = '<div class="xp-bk" data-x="bk"></div>' +
      '<form class="xp-box" role="dialog" aria-modal="true" aria-labelledby="xmT" aria-describedby="xmSum" novalidate>' +
      '<header class="xp-h"><div class="xp-ic">' + svg(IIMP) + '</div><div class="xp-hd"><div class="xp-ey">Importar</div><h3 id="xmT">Importar apresentação</h3></div>' +
      '<button type="button" class="xp-x" data-x="close" title="Fechar (Esc)" aria-label="Fechar">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></header>' +
      '<div class="xp-b">' +
      '<p class="xp-sum" id="xmSum"></p>' +
      '<div id="xmOpts">' +
      '<fieldset class="xp-sec" role="radiogroup" aria-label="Onde colocar os slides"><legend class="xp-lg">Onde colocar</legend>' +
      '<label class="xp-rd"><input type="radio" name="xmMode" value="replace" checked><span id="xmRepL">Substituir a apresentação atual</span></label>' +
      '<label class="xp-rd"><input type="radio" name="xmMode" value="append"><span id="xmAppL">Adicionar ao final da apresentação atual</span></label></fieldset>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Opções</legend>' +
      '<label class="xp-ck" id="xmNotesW"><input type="checkbox" id="xmNotes" checked><span>Trazer as anotações do orador para “Sobre este slide”</span></label>' +
      '<p class="note xm-note" id="xmNote"></p></fieldset>' +
      '</div>' +
      '<div class="xp-prog" id="xmProg" hidden><div class="xp-pt"><span id="xmPl" role="status" aria-live="polite">Lendo o arquivo…</span><b id="xmPp">0%</b></div><div class="xp-bar" role="progressbar" aria-labelledby="xmPl" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="xmPb"></i></div></div>' +
      '<div class="xm-rep" id="xmRep" hidden></div>' +
      '</div>' +
      '<footer class="xp-f"><button type="button" class="xp-btn" data-x="cancel" id="xmCancel">Cancelar</button><button type="submit" class="xp-btn pri" id="xmGo">Importar</button></footer></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'bk') { if (st && st.busy) return; closeDialog(); }
      else if (x.dataset.x === 'close') { if (st && st.busy) cancelRun(); else closeDialog(); }
      else if (x.dataset.x === 'cancel') { if (st && st.busy) cancelRun(); else closeDialog(); }
      else if (x.dataset.x === 'inst') { var li = st && st.rep && st.rep.inst || []; if (!li.length || !window.AMInst) return; var nr = window.AMInst.replace(li); x.disabled = true; x.textContent = nr + (nr === 1 ? ' slide trocado' : ' slides trocados') + ' · Ctrl+Z desfaz'; }
    });
    $('form', dlg).addEventListener('submit', function (e) { e.preventDefault(); if (st.done) closeDialog(); else run(); });
  }
  function focusables() { return [].slice.call(dlg.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null && x.tabIndex >= 0; }); }
  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (st.busy) cancelRun(); else closeDialog(); return; }
    if (e.key === 'Tab') { var f = focusables(); if (!f.length) return; var i = f.indexOf(document.activeElement); e.preventDefault(); e.stopImmediatePropagation(); (f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length] || f[0]).focus(); return; }
    var inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && dlg.contains(e.target);
    if (e.key === 'F1' || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^[sodpzy]$/i.test(e.key) && !inField)) e.preventDefault();
    e.stopImmediatePropagation();
  }
  function isOpen() { return !!(dlg && !dlg.hidden); }
  function kindOf(file, head) {
    var nm = String(file.name || '').toLowerCase();
    if (head && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
    if (head && head[0] === 0x50 && head[1] === 0x4B) return /\.pdf$/.test(nm) ? null : 'pptx';
    if (/\.pdf$/.test(nm)) return 'pdf'; if (/\.pptx$/.test(nm)) return 'pptx'; if (/\.ppt$/.test(nm)) return 'ppt'; if (/\.(odp|key)$/.test(nm)) return 'other';
    return null;
  }
  function openDialog(file, opener) {
    var A = S(); if (!A || !file) return;
    if (!dlg) build();
    if (A.closeMenus) A.closeMenus();
    if (window.AMExport) { if (window.AMExport.isOpen && window.AMExport.isOpen()) window.AMExport.closeDialog(); if (window.AMExport.pptxDialog && window.AMExport.pptxDialog.isOpen()) window.AMExport.pptxDialog.close(); }
    var ae = document.activeElement;
    st = { file: file, kind: null, busy: false, done: false, sig: null, prev: opener || (ae && ae !== document.body ? ae : null) };
    file.slice(0, 8).arrayBuffer().then(function (b) { st.kind = kindOf(file, new Uint8Array(b)); update(); }).catch(function () { st.kind = kindOf(file); update(); });
    $('#xmProg').hidden = true; $('#xmRep').hidden = true; $('#xmOpts').hidden = false; dlg.classList.remove('busy');
    $('#xmCancel').textContent = 'Cancelar'; $('#xmGo').textContent = 'Importar'; $('#xmGo').disabled = true;
    var blank = A.isBlank ? A.isBlank() : false; $('input[name=xmMode][value=' + (blank ? 'replace' : 'append') + ']', dlg).checked = true;
    $('#xmNotes').checked = true;
    dlg.hidden = false; document.documentElement.classList.add('xp-open');
    addEventListener('keydown', onKey, true);
    update();
    setTimeout(function () { if (isOpen()) ($('#xmGo').disabled ? $('#xmCancel') : $('#xmGo')).focus(); }, 30);
  }
  function update() {
    if (!isOpen()) return;
    var A = S(), f = st.file, k = st.kind, n = A.deck.slides.length;
    var what = k === 'pptx' ? 'PowerPoint' : k === 'pdf' ? 'PDF' : null;
    $('#xmRepL').textContent = 'Substituir a apresentação atual' + (A.isBlank && A.isBlank() ? '' : ' (' + n + (n === 1 ? ' slide' : ' slides') + ' — a atual sai; Ctrl+Z não desfaz)');
    $('#xmAppL').textContent = 'Adicionar ao final da apresentação atual (' + n + (n === 1 ? ' slide' : ' slides') + ')';
    $('#xmNotesW').hidden = k !== 'pptx';
    if (!what) {
      $('#xmSum').innerHTML = '<b>' + esc(f.name) + '</b> (' + fmtKB(f.size) + ') — <span class="xp-warn">' + (k === 'ppt' ? 'formato antigo (.ppt): abra no PowerPoint e salve como .pptx' : k === 'other' ? 'formato não suportado: salve como .pptx ou .pdf' : k === null && st.kind !== undefined ? 'não é um PowerPoint (.pptx) nem um PDF' : '') + '</span>';
      $('#xmNote').textContent = ''; $('#xmGo').disabled = true; return;
    }
    $('#xmSum').innerHTML = '<b>' + esc(f.name) + '</b> (' + fmtKB(f.size) + ') — ' + (k === 'pptx'
      ? 'cada slide vira um slide editável: <b>textos</b> com formato, <b>formas</b>, <b>linhas e setas</b>, <b>fotos</b>, <b>tabelas</b> (células), <b>gráficos</b> (com os dados) e <b>SmartArt</b>; anotações do orador, slides ocultos e seções também vêm. Animações e transições não são importadas.'
      : 'cada página vira um slide: os <b>textos</b> ficam editáveis (fonte, tamanho, cor e alinhamento lidos da página) e o desenho da página (fundos, formas, fotos) vem como <b>imagem de fundo</b>. O leitor de PDF (pdf.js) é baixado da internet na primeira vez.');
    $('#xmNote').textContent = k === 'pptx' ? 'Fontes do arquivo que não existem no Canteiro usam a fonte instalada no computador (sem ela, Inter). Formas sem equivalente viram retângulos com a mesma cor e texto.' : 'Textos em imagem (fotos, logos) não viram texto. Formas e linhas da página ficam no fundo, não editáveis.';
    $('#xmGo').disabled = !!st.busy;
  }
  function setBusy(b) {
    st.busy = b; dlg.classList.toggle('busy', b);
    dlg.querySelectorAll('.xp-b input').forEach(function (x) { x.disabled = b; });
    $('#xmProg').hidden = !b; $('#xmGo').disabled = b; $('#xmCancel').textContent = b ? 'Cancelar importação' : 'Cancelar';
    $('.xp-x', dlg).setAttribute('aria-disabled', b ? 'true' : 'false');
    if (isOpen()) { var fc = b ? $('#xmCancel') : $('#xmGo'); if (fc && !fc.disabled) fc.focus({ preventScroll: true }); }
  }
  function progress(i, n, label) {
    var pc = n ? Math.round(i / n * 100) : 0;
    $('#xmPl').textContent = label || (i < n ? 'Lendo slide ' + (i + 1) + ' de ' + n + '…' : 'Montando a apresentação…');
    $('#xmPp').textContent = pc + '%'; $('#xmPb').style.width = pc + '%'; $('.xp-bar', dlg).setAttribute('aria-valuenow', String(pc));
  }
  function cancelRun() { if (!(st && st.sig)) return; st.sig.cancelled = true; st.sig = null; setBusy(false); $('#xmProg').hidden = true; toast('Importação cancelada'); }
  function closeDialog() {
    if (!isOpen()) return;
    if (st && st.busy) cancelRun();
    dlg.hidden = true; document.documentElement.classList.remove('xp-open');
    removeEventListener('keydown', onKey, true);
    var p = st && st.prev; if (p && document.contains(p) && p.focus) p.focus({ preventScroll: true });
  }
  function run() {
    if (st.busy || !st.kind || (st.kind !== 'pptx' && st.kind !== 'pdf')) return;
    var A = S(); if (A.flush) A.flush();
    var mode = ($('input[name=xmMode]:checked', dlg) || {}).value || 'replace', notes = $('#xmNotes').checked, sig = st.sig = { cancelled: false }, t0 = Date.now(), file = st.file, kind = st.kind;
    setBusy(true); progress(0, 1, kind === 'pdf' ? 'Carregando o leitor de PDF…' : 'Lendo o arquivo…');
    importFile(file, kind, { notes: notes, signal: sig, slow: window.AMImport && window.AMImport.slowMs || 0, onProgress: function (i, n) { if (st.sig === sig) progress(i, n); } }).then(function (res) {
      if (st.sig !== sig) return;
      if (!res || sig.cancelled) { st.sig = null; setBusy(false); $('#xmProg').hidden = true; return; }
      var rep = finish(res, file, { mode: mode });
      st.sig = null; st.done = true; setBusy(false); $('#xmProg').hidden = true;
      showReport(rep, file, kind, Date.now() - t0);
      toast((rep.replaced ? 'Apresentação importada: ' : 'Slides adicionados: ') + rep.count.slides + (rep.count.slides === 1 ? ' slide' : ' slides') + (rep.replaced ? '' : ' · Ctrl+Z desfaz'));
    }).catch(function (err) {
      if (st.sig === sig) { st.sig = null; setBusy(false); $('#xmProg').hidden = true; }
      if (window.console && console.warn) console.warn('AMImport', err);
      toast('Não foi possível importar: ' + (err && err.message || err));
    });
  }
  function showReport(rep, file, kind, ms) {
    $('#xmOpts').hidden = true; var r = $('#xmRep'); r.hidden = false; if (st) st.rep = rep;
    var inst = rep.inst || [];
    r.innerHTML = '<h4>' + (rep.replaced ? 'Apresentação importada' : 'Slides adicionados ao final') + ' <small>' + esc(file.name) + ' · ' + (ms / 1000).toFixed(1).replace('.', ',') + ' s</small></h4>' +
      '<ul class="xm-ok">' + rep.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      (inst.length ? '<div class="xm-inst"><b>' + inst.length + (inst.length === 1 ? ' slide institucional reconhecido' : ' slides institucionais reconhecidos') + '</b> (' + inst.map(function (o) { return esc(o.name); }).join(', ') + '). <button type="button" class="xp-btn sm" data-x="inst">Usar os modelos oficiais</button><p class="note">Troca esses slides, no mesmo lugar, pela versão oficial do Canteiro, que nunca perde o padrão. Um Ctrl+Z desfaz.</p></div>' : '') +
      (rep.warns.length ? '<h5>Atenção</h5><ul class="xm-warn">' + rep.warns.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="note">' + (kind === 'pptx' ? 'Animações e transições do PowerPoint não foram lidas: use o painel “Animação” do Canteiro para dar vida aos slides.' : 'O fundo de cada slide é a página sem o texto. Para trocar o fundo, use o painel do slide.') + ' Confira os slides no painel à esquerda e salve com Ctrl+S.</p>';
    $('#xmGo').textContent = 'Concluir'; $('#xmGo').disabled = false; $('#xmCancel').hidden = true; $('#xmGo').focus();
  }
  function importFile(file, kind, opts) {
    return file.arrayBuffer().then(function (buf) { return kind === 'pdf' ? importPdf(new Uint8Array(buf), opts) : importPptx(new Uint8Array(buf), opts); });
  }
  /* entrada de arquivo própria (não mexe no #fOpen, que abre .html/.json) */
  var inp = null;
  function pick(opener) {
    if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.id = 'fImport'; inp.accept = '.pptx,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf'; inp.className = 'hidden'; inp.setAttribute('aria-hidden', 'true'); inp.tabIndex = -1; document.body.appendChild(inp); inp.addEventListener('change', function () { if (inp.files[0]) openDialog(inp.files[0], pick._opener); }); }
    pick._opener = opener || null; inp.value = ''; inp.click();
  }

  window.AMImport = {
    open: function (file, opener) { openDialog(file, opener); }, pick: pick, isOpen: isOpen, close: closeDialog,
    pptx: importPptx, pdf: importPdf, finish: finish, zipOpen: zipOpen, loadPdfjs: loadPdfjs,
    isImportFile: function (f) { return !!f && (/\.(pptx|pdf)$/i.test(f.name || '') || /presentationml\.presentation|application\/pdf/.test(f.type || '')); }
  };
})();
