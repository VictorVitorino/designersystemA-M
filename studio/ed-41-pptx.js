/* ===== S23 · Salvar como PowerPoint (.pptx). Só no editor: não vai para o arquivo exportado.
   Usa o motor do S22 (window.AMExport: rasterSlide, rasterEls, pick) e escreve o pacote OOXML à mão (sem biblioteca):
   [Content_Types].xml, _rels, docProps (core/app), ppt/presentation.xml, presProps, viewProps, tableStyles, tema, slide mestre,
   layout em branco, slides, slide mestre de anotações (+ tema 2), anotações e mídia — num ZIP (STORE, CRC-32, nomes UTF-8).
   Dois modos:
     'image' (Idêntico, recomendado): cada slide = uma imagem JPEG 2× em tela cheia, igual ao editor + as anotações (slide.notes).
     'edit'  (Editável): textos (parágrafos, negrito/itálico/sublinhado/cor, fonte, tamanho, entrelinha, espaçamento, alinhamento),
             formas (geometrias do PowerPoint + texto dentro), linhas e conectores (pontas, tracejado), fotos (recorte, cantos,
             espelho, giro), fundo (cor + foto com transparência) como objetos nativos; gráficos, modelos, SmartArt, ícones,
             cards e contadores viram imagens PNG transparentes 2× no mesmo lugar e com o mesmo giro.
   1 px lógico = 9525 EMU (1280×720 → 12192000×6858000); fonte px → pt × 0,75.
   window.AMExport.pptx(deck, {opener})          → abre a caixa “Salvar como PowerPoint” (gancho do S22: menus ▾ e Arquivo).
   window.AMExport.pptxBuild(deck, {list | range, from, to, cur, includeHidden, mode, notes, signal, onProgress}) → Promise<Blob|null>
   window.AMExport.zip(files[{name, data}]) → Promise<Blob>   ·   pptxDialog: {open, close, isOpen} */
(function () {
  'use strict';
  var X = window.AMExport, RT = window.AMRT;
  if (!X || !RT) return;
  var W = 1280, H = 720, EMU = 9525, SW = W * EMU, SH = H * EMU;
  function S() { return window.AMStudio; }
  function $(s, r) { return (r || document).querySelector(s); }
  function toast(m) { var A = S(); if (A && A.toast) A.toast(m); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function E(v) { return Math.round(v * EMU); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  /* texto XML: sem caracteres de controle nem surrogates soltos; & < > " escapados */
  function xe(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, function (m) { return m.length === 2 ? m : '\uFFFD'; })
      .replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  var enc = new TextEncoder();

  /* ---------------- ZIP (STORE): cabeçalho local + diretório central + fim; CRC-32; flag UTF-8 (bit 11) ---------------- */
  var CRC_T = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8, c) { c = c == null ? 0xFFFFFFFF : c; for (var i = 0, n = u8.length; i < n; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; }
  function dosTime(d) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
  /* files: [{name, data: Uint8Array|string}] → Blob. Calcula o CRC em fatias de 4 MB com pausas (100 MB não travam a página) */
  function zip(files, mime) {
    var parts = [], cen = [], off = 0, dt = dosTime(new Date()), i = 0;
    function one() {
      if (i >= files.length) return Promise.resolve(fin());
      var f = files[i++], nm = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, c = 0xFFFFFFFF, p = 0, CH = 4 << 20;
      function crcStep() {
        while (p < data.length) { var e = Math.min(data.length, p + CH); c = crc32(data.subarray(p, e), c); p = e; if (p < data.length) return tick().then(crcStep); }
        var crc = (c ^ 0xFFFFFFFF) >>> 0, lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dt.time, true); lh.setUint16(12, dt.date, true);
        lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dt.time, true); ch.setUint16(14, dt.date, true);
        ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
        ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, off, true);
        parts.push(new Uint8Array(lh.buffer), nm, data); cen.push(new Uint8Array(ch.buffer), nm);
        off += 30 + nm.length + data.length;
        return one();
      }
      return crcStep();
    }
    function fin() {
      var cs = cen.reduce(function (a, b) { return a + b.length; }, 0), eo = new DataView(new ArrayBuffer(22));
      eo.setUint32(0, 0x06054b50, true); eo.setUint16(4, 0, true); eo.setUint16(6, 0, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
      eo.setUint32(12, cs, true); eo.setUint32(16, off, true); eo.setUint16(20, 0, true);
      return new Blob(parts.concat(cen, [new Uint8Array(eo.buffer)]), { type: mime || 'application/zip' });
    }
    return one();
  }

  /* ---------------- cores: qualquer cor CSS → {hex:'RRGGBB', a:0..1} (o canvas normaliza nomes, #rgb, #rrggbbaa, rgba) ---------------- */
  var cx2d = document.createElement('canvas').getContext('2d');
  function col(c) {
    if (c == null) return null; c = String(c).trim(); if (!c || /^(none|transparent)$/i.test(c)) return null;
    var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(c);
    if (!m) { cx2d.fillStyle = '#010203'; cx2d.fillStyle = c; var n = cx2d.fillStyle; if (n === '#010203' && !/^#010203$/i.test(c)) return null; c = n; m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(c); }
    if (!m) { var h = /^#([0-9a-f]{6})$/i.exec(c); return h ? { hex: h[1].toUpperCase(), a: 1 } : null; }
    var a = m[4] == null ? 1 : +m[4] / (m[5] ? 100 : 1);
    if (!(a > 0)) return null;
    return { hex: [m[1], m[2], m[3]].map(function (v) { var x = clamp(Math.round(+v), 0, 255).toString(16); return x.length < 2 ? '0' + x : x; }).join('').toUpperCase(), a: clamp(a, 0, 1) };
  }
  function clrXml(c, alpha) { var a = (c.a == null ? 1 : c.a) * (alpha == null ? 1 : alpha); return '<a:srgbClr val="' + c.hex + '"' + (a < .999 ? '><a:alpha val="' + Math.round(a * 100000) + '"/></a:srgbClr>' : '/>'); }
  function solid(c, alpha) { return c ? '<a:solidFill>' + clrXml(c, alpha) + '</a:solidFill>' : '<a:noFill/>'; }

  /* ---------------- partes fixas do pacote ---------------- */
  var NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  var HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var CT = 'application/vnd.openxmlformats-officedocument.presentationml.';
  function rels(list) { return HDR + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map(function (r) { return '<Relationship Id="' + r[0] + '" Type="' + (r[1].indexOf('http') === 0 ? r[1] : RN + r[1]) + '" Target="' + xe(r[2]) + '"/>'; }).join('') + '</Relationships>'; }
  var GRP0 = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  var CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
  /* bk (S29, deck.brand): as cores do kit viram os acentos do tema (destaque primeiro, depois as cores da marca; o que faltar fica A&M),
     a cor principal vira dk2 e a fonte do kit vira a fonte do tema — o seletor de cores e fontes do PowerPoint mostra a marca */
  function theme(name, bk) {
    var c = function (k, v) { return '<a:' + k + '><a:srgbClr val="' + v + '"/></a:' + k + '>'; }, sf = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    var H6 = function (x) { return typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x.slice(1).toUpperCase() : null; }, bc = bk && Array.isArray(bk.colors) ? bk.colors.map(H6).filter(Boolean) : [], pa = bk && bk.pal ? H6(bk.pal.a) : null, pp = bk && bk.pal ? H6(bk.pal.p) : null;
    var acc = (pa ? [pa] : []).concat(bc.filter(function (x) { return x !== pa; })), dflt = ['F78C16', '002A46', '4A6FA5', '7EA1C3', '43698F', 'A3B8D6'];
    acc = acc.concat(dflt.filter(function (x) { return acc.indexOf(x) < 0; })).slice(0, 6);
    var fnt = bk && typeof bk.font === 'string' && bk.font.trim() ? xe(bk.font.trim()) : null;
    return HDR + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="' + name + '"><a:themeElements><a:clrScheme name="' + (bk && bc.length ? xe(bk.name || 'Kit de marca') : 'Alvarez &amp; Marsal') + '">' +
      c('dk1', '002A46') + c('lt1', 'FFFFFF') + c('dk2', pp || '13315C') + c('lt2', 'EEF2F7') + acc.map(function (x, i) { return c('accent' + (i + 1), x); }).join('') + c('hlink', '4A6FA5') + c('folHlink', '7EA1C3') +
      '</a:clrScheme><a:fontScheme name="Canteiro"><a:majorFont><a:latin typeface="' + (fnt || 'Roboto') + '"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="' + (fnt || 'Inter') + '"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Canteiro"><a:fillStyleLst>' + sf + sf + sf + '</a:fillStyleLst><a:lnStyleLst>' + [6350, 12700, 19050].map(function (w) { return '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr">' + sf + '<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'; }).join('') +
      '</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>' + sf + sf + sf + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }
  var LVL = '<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>';
  function master() {
    return HDR + '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + GRP0 + layoutTitle() + '</p:spTree></p:cSld>' + CLRMAP +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>' + LVL.replace('sz="1800"', 'sz="4400"').replace('+mn-lt', '+mj-lt').replace('+mn-ea', '+mj-ea').replace('+mn-cs', '+mj-cs') + '</p:titleStyle><p:bodyStyle>' + LVL + '</p:bodyStyle><p:otherStyle>' + LVL + '</p:otherStyle></p:txStyles></p:sldMaster>';
  }
  function layout() { return HDR + '<p:sldLayout ' + NS + ' type="titleOnly" preserve="1"><p:cSld name="Somente título"><p:spTree>' + GRP0 + layoutTitle() + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'; }
  function notesMaster() {
    return HDR + '<p:notesMaster ' + NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + GRP0 +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Espaço Reservado para Imagem de Slide 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Espaço Reservado para Anotações 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="pt-BR"/><a:t>Clique para editar o texto</a:t></a:r></a:p></p:txBody></p:sp>' +
      '</p:spTree></p:cSld>' + CLRMAP + '<p:notesStyle>' + LVL.replace('sz="1800"', 'sz="1200"') + '</p:notesStyle></p:notesMaster>';
  }
  function notesSlide(n, text) {
    var ps = String(text).replace(/\r\n?/g, '\n').split('\n').map(function (l) { return '<a:p>' + (l ? '<a:r><a:rPr lang="pt-BR" dirty="0"/><a:t>' + xe(l) + '</a:t></a:r>' : '<a:endParaRPr lang="pt-BR" dirty="0"/>') + '</a:p>'; }).join('');
    return HDR + '<p:notes ' + NS + '><p:cSld><p:spTree>' + GRP0 +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Espaço Reservado para Imagem de Slide ' + n + '"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Espaço Reservado para Anotações ' + n + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>' + ps + '</p:txBody></p:sp>' +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
  }
  function isoNow() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }

  /* ---------------- mídia: cada imagem uma vez (mesma origem = mesmo arquivo) ---------------- */
  function b64bytes(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function loadImage(src) {
    return new Promise(function (res) {
      var im = new Image(); im.decoding = 'async';
      im.addEventListener('load', function () { res(im); }); im.addEventListener('error', function () { res(null); });
      im.src = src;
    });
  }
  /* imagem → PNG/JPEG pelo canvas em w×h (SVG e logos pequenos saem no tamanho em que aparecem, ×2, não no tamanho intrínseco minúsculo).
     Canvas “contaminado” (foto http sem CORS) lança SecurityError no toBlob: devolve null e quem chamou tenta de novo com crossOrigin */
  function canvasImg(im, w, h, type, q) {
    try {
      var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      return new Promise(function (r) { try { cv.toBlob(function (b) { r(b); }, type || 'image/png', q); } catch (e) { r(null); } });
    } catch (e) { return Promise.resolve(null); }
  }
  function loadImageCORS(src) {
    return new Promise(function (res) {
      var im = new Image(); im.decoding = 'async'; im.crossOrigin = 'anonymous';
      im.addEventListener('load', function () { res(im); }); im.addEventListener('error', function () { res(null); });
      im.src = src;
    });
  }
  /* orientação EXIF de um JPEG (1 = normal; 3/6/8 = girado; 2/4/5/7 = espelhado) lida do APP1; 1 quando não há tag */
  function jpegOrient(u8) {
    if (!u8 || u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) return 1;
    var i = 2, n = Math.min(u8.length, 262144);
    while (i + 4 <= n && u8[i] === 0xFF) {
      var mk = u8[i + 1], len = (u8[i + 2] << 8) | u8[i + 3];
      if (mk === 0xDA || mk === 0xD9) break;
      if (mk === 0xE1 && i + 10 <= n && u8[i + 4] === 0x45 && u8[i + 5] === 0x78 && u8[i + 6] === 0x69 && u8[i + 7] === 0x66) {
        var t = i + 10, le = u8[t] === 0x49, rd = function (p, k) { if (p + k > n) return -1; return k === 2 ? (le ? u8[p] | (u8[p + 1] << 8) : (u8[p] << 8) | u8[p + 1]) : (le ? (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0 : ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0); };
        var ifd = t + rd(t + 4, 4), cnt = rd(ifd, 2); if (cnt < 0 || cnt > 500) return 1;
        for (var k = 0; k < cnt; k++) { var e = ifd + 2 + k * 12; if (rd(e, 2) === 0x0112) { var v = rd(e + 8, 2); return v >= 1 && v <= 8 ? v : 1; } }
        return 1;
      }
      i += 2 + len;
    }
    return 1;
  }
  function Media() { this.files = []; this.bySrc = {}; this.n = 0; this.dropped = 0; }
  Media.prototype.addBlob = function (blob, ext) { var self = this; return blob.arrayBuffer().then(function (buf) { var name = 'image' + (++self.n) + '.' + ext; self.files.push({ name: 'ppt/media/' + name, data: new Uint8Array(buf) }); return name; }); };
  /* imagem do deck (data:, http, blob) → {name, nw, nh} ou null (não carregou: conta em dropped).
     want = maior lado em que a imagem aparece no slide (px): SVG e imagens pequenas são rasterizadas em até 2× esse tamanho (máx. 4096) */
  Media.prototype.addSrc = function (src, want) {
    var self = this, px = Math.min(4096, Math.max(64, Math.ceil((+want || 0) * 2 / 256) * 256)), key = src + '#' + px;
    if (this.bySrc[key]) return this.bySrc[key];
    function done(im, name) { return { name: name, nw: im.naturalWidth, nh: im.naturalHeight }; }
    function raster(im) {
      var nw = im.naturalWidth, nh = im.naturalHeight, k = Math.max(1, px / Math.max(nw, nh)), w = Math.min(4096, Math.round(nw * k)), h = Math.min(4096, Math.round(nh * k));
      return canvasImg(im, w, h, 'image/png').then(function (b) {
        if (b) return self.addBlob(b, 'png').then(function (name) { return { name: name, nw: w, nh: h }; });
        if (!/^(https?|blob):/i.test(src) || im.crossOrigin) return null;
        return loadImageCORS(src).then(function (im2) { return im2 && im2.naturalWidth ? canvasImg(im2, w, h, 'image/png').then(function (b2) { return b2 ? self.addBlob(b2, 'png').then(function (name) { return { name: name, nw: w, nh: h }; }) : null; }) : null; });
      });
    }
    var p = loadImage(src).then(function (im) {
      if (!im || !im.naturalWidth) return null;
      var m = /^data:image\/(png|jpe?g|gif);base64,/i.exec(src);
      if (m) {
        var ext = m[1].toLowerCase().replace('jpg', 'jpeg'), bytes = b64bytes(src.slice(m[0].length));
        /* JPEG girado por EXIF: o PowerPoint lê o arquivo bruto (sairia deitado); o canvas já aplica a orientação ao desenhar */
        if (ext === 'jpeg' && jpegOrient(bytes) !== 1) return canvasImg(im, im.naturalWidth, im.naturalHeight, 'image/jpeg', .9).then(function (b) { return b ? self.addBlob(b, 'jpeg').then(function (name) { return done(im, name); }) : raster(im); });
        if (Math.max(im.naturalWidth, im.naturalHeight) * 1.5 < px && ext !== 'gif') return raster(im); /* pequena para o lugar onde aparece: ampliada ×2 do tamanho em tela (nítida no zoom) */
        var name = 'image' + (++self.n) + '.' + ext; self.files.push({ name: 'ppt/media/' + name, data: bytes }); return done(im, name);
      }
      /* SVG, WebP, http(s), blob: → PNG pelo canvas (o PowerPoint antigo não lê WebP; SVG sem PNG de reserva some) */
      return raster(im);
    }).then(function (r) { if (!r) self.dropped++; return r; });
    this.bySrc[key] = p; return p;
  };

  /* ---------------- formas: geometria do PowerPoint + retângulo de texto da geometria (fórmulas do presetShapeDefinitions) ---------------- */
  var C45 = Math.SQRT1_2;
  function ssOf(w, h) { return Math.min(w, h); }
  /* cada entrada: prst, adj(el, w, h) → [[nome, valor]] e tr(w, h, adj) → retângulo de texto [l, t, r, b] em px */
  var GEO = {
    rect: { prst: 'rect', tr: function (w, h) { return [0, 0, w, h]; } },
    rrect: { prst: 'roundRect', adj: function (el, w, h) { return [['adj', clamp(Math.round(Math.min(+el.radius || 0, w / 2, h / 2) / ssOf(w, h) * 100000), 0, 50000)]]; }, tr: function (w, h, a) { var il = ssOf(w, h) * a[0][1] / 100000 * .29289; return [il, il, w - il, h - il]; } },
    round: { prst: 'roundRect', adj: function (el, w, h) { var r = Math.max(0, Math.min(+el.radius || 0, w / 2, h / 2)) || ssOf(w, h) * .12; return [['adj', clamp(Math.round(r / ssOf(w, h) * 100000), 0, 50000)]]; }, tr: function (w, h, a) { var il = ssOf(w, h) * a[0][1] / 100000 * .29289; return [il, il, w - il, h - il]; } },
    pill: { prst: 'roundRect', adj: function () { return [['adj', 50000]]; }, tr: function (w, h) { var il = ssOf(w, h) * .5 * .29289; return [il, il, w - il, h - il]; } },
    ellipse: { prst: 'ellipse', tr: function (w, h) { var dx = w / 2 * C45, dy = h / 2 * C45; return [w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy]; } },
    triangle: { prst: 'triangle', tr: function (w, h) { return [w / 4, h / 2, w * .75, h]; } },
    diamond: { prst: 'diamond', tr: function (w, h) { return [w / 4, h / 4, w * .75, h * .75]; } },
    para: { prst: 'parallelogram', adj: function (el, w, h) { return [['adj', Math.round(Math.min(w * .4, h * .45) / ssOf(w, h) * 100000)]]; }, tr: function (w, h, a) { var mx = 100000 * w / ssOf(w, h), k = (1 + 5 * a[0][1] / mx) / 12; return [k * w, k * h, w - k * w, h - k * h]; } },
    chevron: { prst: 'chevron', adj: function (el, w, h) { return [['adj', Math.round(Math.min(w * .3, h * .5) / ssOf(w, h) * 100000)]]; }, tr: function (w, h, a) { var x1 = ssOf(w, h) * a[0][1] / 100000; return w - 2 * x1 > 0 ? [x1, 0, w - x1, h] : [0, 0, w, h]; } },
    arrow: { prst: 'rightArrow', adj: function (el, w, h) { return [['adj1', 44000], ['adj2', Math.round(Math.min(w * .38, h * .7) / ssOf(w, h) * 100000)]]; }, tr: function (w, h, a) { var dx2 = ssOf(w, h) * a[1][1] / 100000, y1 = h / 2 - h * a[0][1] / 200000; return [0, y1, w - dx2 + y1 * dx2 / (h / 2), h - y1]; } },
    pentagon: { prst: 'homePlate', adj: function (el, w, h) { return [['adj', Math.round(Math.min(w * .3, h * .5) / ssOf(w, h) * 100000)]]; }, tr: function (w, h, a) { var x1 = w - ssOf(w, h) * a[0][1] / 100000; return [0, 0, (x1 + w) / 2, h]; } },
    hexagon: { prst: 'hexagon', adj: function (el, w, h) { return [['adj', Math.round(Math.min(w * .25, h * .5) / ssOf(w, h) * 100000)], ['vf', 115470]]; }, tr: function (w, h, a) { var mx = 50000 * w / ssOf(w, h), q1 = -mx / 2, q2 = a[0][1] + q1, q3 = q2 > 0 ? 4 : 2, q4 = q2 > 0 ? 3 : 2, q5 = q2 > 0 ? q1 : 0, q8 = q3 - (a[0][1] + q5) / q1 * q4, il = w * q8 / 24, it = h * q8 / 24; return [il, it, w - il, h - it]; } },
    octagon: { prst: 'octagon', adj: function () { return [['adj', 29000]]; }, tr: function (w, h, a) { var il = ssOf(w, h) * a[0][1] / 100000 / 2; return [il, il, w - il, h - il]; } },
    trapezoid: { prst: 'trapezoid', adj: function (el, w, h) { return [['adj', Math.round(Math.min(w * .22, h * .6) / ssOf(w, h) * 100000)]]; }, tr: function (w, h, a) { var mx = 50000 * w / ssOf(w, h), il = w / 3 * a[0][1] / mx, it = h / 3 * a[0][1] / mx; return [il, it, w - il, h]; } },
    rtri: { prst: 'rtTriangle', tr: function (w, h) { return [w / 12, h * 7 / 12, w * 7 / 12, h * 11 / 12]; } },
    darrow: { prst: 'leftRightArrow', adj: function (el, w, h) { return [['adj1', 44000], ['adj2', Math.round(Math.min(w * .26, h * .7) / ssOf(w, h) * 100000)]]; }, tr: function (w, h, a) { var x2 = ssOf(w, h) * a[1][1] / 100000, y1 = h / 2 - h * a[0][1] / 200000, dx = y1 * x2 / (h / 2); return [x2 - dx, y1, w - x2 + dx, h - y1]; } },
    ring: { prst: 'donut', adj: function () { return [['adj', 15000]]; }, tr: function (w, h) { var dx = w / 2 * C45, dy = h / 2 * C45; return [w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy]; } },
    star: { prst: 'star5', adj: function () { return [['adj', 22500], ['hf', 105146], ['vf', 110557]]; }, tr: function (w, h, a) { var sw2 = w / 2 * a[1][1] / 100000, sh2 = h / 2 * a[2][1] / 100000, svc = h / 2 * a[2][1] / 100000, iw = sw2 * a[0][1] / 50000, ih = sh2 * a[0][1] / 50000, c = Math.cos(Math.PI * 1.9), s = Math.sin(Math.PI * .3); return [w / 2 - iw * c, svc - ih * s, w / 2 + iw * c, svc + ih]; } },
    plus: { prst: 'plus', ok: function (el) { return Math.abs(el.w - el.h) <= 1; }, adj: function () { return [['adj', 33000]]; }, tr: function (w, h, a) { var x1 = ssOf(w, h) * a[0][1] / 100000; return w - h > 0 ? [0, x1, w, h - x1] : [x1, 0, w - x1, h]; } }
  };
  /* estilos de card que o PowerPoint desenha igual: plano, contorno (branco + fio), elevado (branco + sombra) */
  var LOOK_OK = { flat: 1, outline: 1, lift: 1 };
  function geoOf(el) {
    var k = el.shape || 'rect'; if (k === 'rect' && +el.radius > 0) k = 'rrect'; /* retângulo com raio = cantos arredondados (o runtime desenha rx) */
    var g = GEO[k] || null;
    if (!g || (g.ok && !g.ok(el))) return null;
    if (el.look && !LOOK_OK[el.look]) return null;
    if (el.look && el.look !== 'flat' && el.shape && ['rect', 'round', 'pill'].indexOf(el.shape) < 0) return null;
    return g;
  }

  /* ---------------- texto: lido do palco montado (estilos calculados pelo navegador), parágrafo a parágrafo ---------------- */
  var FAMS = { 'inter': 'Inter', 'roboto': 'Roboto', 'roboto condensed': 'Roboto Condensed', 'jetbrains mono': 'JetBrains Mono', 'arial': 'Arial', 'arial nova': 'Arial Nova', 'consolas': 'Consolas', 'sans-serif': 'Arial', 'serif': 'Times New Roman', 'monospace': 'Courier New', 'system-ui': 'Arial' };
  /* métricas (ascendente, descendente, em em) que o navegador usa para centrar a linha: o PowerPoint põe a entrelinha extra acima */
  var MET = { 'Inter': [.96875, .24121], 'Roboto': [.92773, .24414], 'Roboto Light': [.92773, .24414], 'Roboto Condensed': [.92773, .24414], 'JetBrains Mono': [1.02, .3] };
  var LIGHT = { 'Roboto': 1 }; /* pesos finos que o Google Fonts da página realmente traz (Roboto 300); os demais caem no Regular */
  function famOf(cs) {
    var f = String(cs.fontFamily || '').split(',')[0].trim().replace(/^['"]|['"]$/g, ''), k = f.toLowerCase();
    return FAMS[k] || f || 'Inter';
  }
  function faceOf(fam, wt) { return wt <= 349 && LIGHT[fam] ? fam + ' Light' : fam; }
  var BLOCK = /^(block|list-item|flex|grid|table|flow-root)/;
  function decoOf(n, stop) { var u = false, s = false, hl = null, va = null, vfs = 0; for (var e = n; e && e !== stop.parentElement; e = e.parentElement) { var cs = getComputedStyle(e), d = cs.textDecorationLine || ''; if (/underline/.test(d)) u = true; if (/line-through/.test(d)) s = true; if (!hl && e !== stop && cs.backgroundColor) { var bc = col(cs.backgroundColor); if (bc) hl = bc; } if (!va && /^(sub|super)$/.test(cs.verticalAlign)) { va = cs.verticalAlign; vfs = e.parentElement ? parseFloat(getComputedStyle(e.parentElement).fontSize) : 0; } if (e === stop) break; } return { u: u, s: s, hl: hl, va: va, vfs: vfs }; }
  function runOf(t, pe, tx, opa) {
    var cs = getComputedStyle(pe), fam = famOf(cs), wt = parseInt(cs.fontWeight, 10) || 400, fs = parseFloat(cs.fontSize) || 16, dc = decoOf(pe, tx), c = col(cs.color) || { hex: '000000', a: 1 };
    var lh = parseFloat(cs.lineHeight); if (!isFinite(lh)) lh = fs * 1.2;
    var ls = parseFloat(cs.letterSpacing); if (!isFinite(ls)) ls = 0;
    /* índice/expoente: o PowerPoint já diminui o texto deslocado → tamanho do texto em volta */
    return { t: t, fam: fam, face: faceOf(fam, wt), b: wt >= 550, i: /italic|oblique/.test(cs.fontStyle), u: dc.u, s: dc.s, hl: dc.hl, va: dc.va, cap: cs.textTransform === 'uppercase' ? 'all' : cs.textTransform === 'lowercase' ? 'lower' : '', sz: dc.va && dc.vfs ? dc.vfs : fs, ls: ls, c: c, op: opa, lh: dc.va ? 0 : lh };
  }
  /* parágrafos: <br> termina a linha; bloco (div, p, li…) começa e termina parágrafo; br final dentro de bloco não cria linha vazia */
  function parasOf(tx, opa) {
    var out = [], cur = null;
    function start(blk) { if (!cur) cur = { blk: blk, runs: [] }; }
    function push() { if (cur) out.push(cur); cur = null; }
    (function walk(node, blk) {
      [].forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) {
          var pe = n.parentElement, cs = getComputedStyle(pe); if (cs.display === 'none' || cs.visibility === 'hidden') return;
          /* U+000B (quebra de linha “Shift+Enter” do PowerPoint/Word colada) quebra a linha, como <br>; antes o caractere era apagado e as palavras se juntavam */
          n.nodeValue.split('\u000B').forEach(function (part, k) {
            if (k) { start(blk); push(); }
            var t = part.replace(/[ \t\n\r\f]+/g, ' '); if (!t) return;
            start(blk); cur.runs.push(runOf(t, pe, tx, opa));
          });
          return;
        }
        if (n.nodeType !== 1) return;
        if (n.tagName === 'BR') { start(blk); push(); return; }
        var d = getComputedStyle(n).display; if (d === 'none') return;
        if (BLOCK.test(d)) { push(); walk(n, n); push(); }
        else walk(n, blk);
      });
    })(tx, tx);
    push();
    /* espaços: sem espaço no começo/fim do parágrafo nem dois seguidos entre trechos */
    out.forEach(function (p) {
      var prevSp = true;
      p.runs.forEach(function (r) { if (prevSp) r.t = r.t.replace(/^ /, ''); prevSp = / $/.test(r.t) || (prevSp && !r.t); });
      for (var k = p.runs.length - 1; k >= 0; k--) { p.runs[k].t = p.runs[k].t.replace(/ $/, ''); if (p.runs[k].t) break; }
      p.runs = p.runs.filter(function (r) { return r.t; });
      var cs = getComputedStyle(p.blk), fs = parseFloat(cs.fontSize) || 16, lh = parseFloat(cs.lineHeight);
      p.fs = fs; p.lh = isFinite(lh) ? lh : fs * 1.2; p.algn = cs.textAlign; p.ref = runOf('', p.blk, tx, opa);
      p.runs.forEach(function (r) { p.lh = Math.max(p.lh, r.lh); });
      p.chain = []; for (var e = p.blk; e && e !== tx; e = e.parentElement) p.chain.push(e);
      if (cs.display === 'list-item') {
        var ul = p.blk.parentElement, ucs = ul ? getComputedStyle(ul) : cs, lt = cs.listStyleType || 'disc', depth = 0, mlSum = 0;
        for (var an = p.blk.parentElement; an && an !== tx; an = an.parentElement) if (/^(UL|OL)$/.test(an.tagName)) { depth++; mlSum += parseFloat(getComputedStyle(an).paddingLeft) || 0; } /* S27b: níveis = listas aninhadas (recuo acumulado) */
        p.li = { ol: ul && ul.tagName === 'OL', type: lt, ml: mlSum || parseFloat(ucs.paddingLeft) || 0, lvl: Math.max(0, Math.min(8, depth - 1)), start: ul && ul.tagName === 'OL' ? ([].indexOf.call(ul.children, p.blk) + (+ul.getAttribute('start') || 1)) : 1 };
      }
    });
    /* margens dos blocos (p, ul, ol…): o bloco que começa no parágrafo dá o espaço antes, o que termina dá o espaço depois; entre dois
       parágrafos vale a maior das duas (as margens do navegador se fundem), como espaço antes do segundo */
    function mg(e, k) { return parseFloat(getComputedStyle(e)[k]) || 0; }
    out.forEach(function (p, i) {
      var prev = out[i - 1], next = out[i + 1];
      p.bef = p.chain.filter(function (e) { return !prev || prev.chain.indexOf(e) < 0; }).reduce(function (a, e) { return Math.max(a, mg(e, 'marginTop')); }, 0);
      p.aft = p.chain.filter(function (e) { return !next || next.chain.indexOf(e) < 0; }).reduce(function (a, e) { return Math.max(a, mg(e, 'marginBottom')); }, 0);
    });
    out.forEach(function (p, i) { p.mt = i ? Math.max(p.bef, out[i - 1].aft) : p.bef; p.mb = i === out.length - 1 ? p.aft : 0; });
    /* trechos vizinhos com o mesmo formato viram um só */
    out.forEach(function (p) {
      var m = []; p.runs.forEach(function (r) { var l = m[m.length - 1]; if (l && l.face === r.face && l.b === r.b && l.i === r.i && l.u === r.u && l.s === r.s && l.va === r.va && l.cap === r.cap && l.sz === r.sz && l.ls === r.ls && l.c.hex === r.c.hex && l.c.a === r.c.a && JSON.stringify(l.hl) === JSON.stringify(r.hl)) l.t += r.t; else m.push(r); }); p.runs = m;
    });
    return out;
  }
  function rPr(r, end) {
    var a = ' lang="pt-BR" sz="' + clamp(Math.round(r.sz * 75), 100, 400000) + '"' + (r.b ? ' b="1"' : ' b="0"') + (r.i ? ' i="1"' : '') + (r.u ? ' u="sng"' : '') + (r.s ? ' strike="sngStrike"' : '') +
      (r.cap ? ' cap="' + (r.cap === 'all' ? 'all' : 'none') + '"' : '') + (r.ls ? ' spc="' + clamp(Math.round(r.ls * 75), -400000, 400000) + '"' : '') + (r.va ? ' baseline="' + (r.va === 'super' ? 30000 : -25000) + '"' : '') + ' dirty="0"';
    var f = xe(r.face);
    return '<a:' + (end ? 'endParaRPr' : 'rPr') + a + '>' + solid(r.c, r.op) + (r.hl && !end ? '<a:highlight>' + clrXml({ hex: r.hl.hex, a: 1 }) + '</a:highlight>' : '') +
      '<a:latin typeface="' + f + '"/><a:ea typeface="' + f + '"/><a:cs typeface="' + f + '"/></a:' + (end ? 'endParaRPr' : 'rPr') + '>';
  }
  var ALG = { left: 'l', start: 'l', center: 'ctr', right: 'r', end: 'r', justify: 'just' };
  function pXml(p) {
    var bu = '<a:buNone/>', mar = '';
    if (p.li) {
      var ml = Math.max(p.li.ml, p.fs * 1.2); mar = ' marL="' + E(ml) + '" indent="' + E(-Math.min(p.fs * 1.2, p.fs * 1.1)) + '"' + (p.li.lvl ? ' lvl="' + p.li.lvl + '"' : '');
      bu = p.li.ol ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="' + ({ 'lower-alpha': 'alphaLcPeriod', 'upper-alpha': 'alphaUcPeriod', 'lower-roman': 'romanLcPeriod', 'upper-roman': 'romanUcPeriod' }[p.li.type] || 'arabicPeriod') + '"' + (p.li.start > 1 ? ' startAt="' + p.li.start + '"' : '') + '/>'
        : p.li.type === 'none' ? '<a:buNone/>' : '<a:buFont typeface="Arial"/><a:buChar char="' + ({ circle: '◦', square: '▪' }[p.li.type] || '•') + '"/>';
    }
    return '<a:p><a:pPr algn="' + (ALG[p.algn] || 'l') + '"' + mar + '><a:lnSpc><a:spcPts val="' + clamp(Math.round(p.lh * 75), 0, 158400) + '"/></a:lnSpc><a:spcBef><a:spcPts val="' + clamp(Math.round(p.mt * 75), 0, 158400) + '"/></a:spcBef><a:spcAft><a:spcPts val="' + clamp(Math.round(p.mb * 75), 0, 158400) + '"/></a:spcAft>' + bu + '</a:pPr>' +
      p.runs.map(function (r) { return '<a:r>' + rPr(r) + '<a:t>' + xe(r.t) + '</a:t></a:r>'; }).join('') + rPr(p.ref, true) + '</a:p>';
  }
  /* corpo do texto: ins = recuos [l, t, r, b] px; o navegador centra cada linha na entrelinha (meia entrelinha acima e abaixo),
     o PowerPoint põe a sobra toda acima — compensa com d = (entrelinha − altura da fonte) / 2 no topo e na base */
  function txBody(paras, ins, anchor, wrap) {
    var p0 = paras[0], d = 0;
    if (p0) { var r0 = p0.runs[0] || p0.ref, m = MET[r0.face] || MET[r0.fam] || [.92, .24]; d = (p0.lh - (m[0] + m[1]) * (r0.sz || p0.fs)) / 2; }
    var l = ins[0], t = ins[1] - d, r = ins[2], b = ins[3] + d;
    /* espaço antes do 1º parágrafo e depois do último (margem de <ul>, <p>): vai para o recuo da caixa — PowerPoint e LibreOffice
       nem sempre aplicam o espaçamento nas pontas */
    if (p0 && p0.mt) { t += p0.mt; p0.mt = 0; }
    var pl = paras[paras.length - 1]; if (pl && pl.mb) { b += pl.mb; pl.mb = 0; }
    return '<p:txBody><a:bodyPr rot="0" spcFirstLastPara="0" vertOverflow="overflow" horzOverflow="overflow" vert="horz" wrap="' + (wrap === false ? 'none' : 'square') + '" lIns="' + E(l) + '" tIns="' + E(t) + '" rIns="' + E(r) + '" bIns="' + E(b) + '" numCol="1" anchor="' + anchor + '" anchorCtr="0" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>' +
      (paras.length ? paras.map(pXml).join('') : '<a:p><a:endParaRPr lang="pt-BR" dirty="0"/></a:p>') + '</p:txBody>';
  }
  /* retângulo útil do texto dentro da caixa do elemento (px): .am-text (inset, já espelhado como na tela) + padding */
  function textRect(node, w, h) {
    var tx = node.querySelector('.am-text'); if (!tx) return null;
    var cs = getComputedStyle(tx), pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0, pr = parseFloat(cs.paddingRight) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    var l = tx.offsetLeft + pl, t = tx.offsetTop + pt, r = w - (tx.offsetLeft + tx.offsetWidth) + pr, b = h - (tx.offsetTop + tx.offsetHeight) + pb;
    var jc = cs.justifyContent, anchor = /center/.test(jc) ? 'ctr' : /end/.test(jc) ? 'b' : 't';
    return { ins: [l, t, r, b], anchor: anchor, tx: tx.querySelector('.am-tx') || tx, el: tx };
  }

  /* ---------------- XML dos objetos ---------------- */
  function xfrm(x, y, w, h, o, grp) {
    o = o || {}; var rot = ((Math.round((+o.rot || 0) * 60000) % 21600000) + 21600000) % 21600000;
    return '<a:xfrm' + (rot ? ' rot="' + rot + '"' : '') + (o.flipH ? ' flipH="1"' : '') + (o.flipV ? ' flipV="1"' : '') + '><a:off x="' + E(x) + '" y="' + E(y) + '"/><a:ext cx="' + Math.max(0, E(w)) + '" cy="' + Math.max(0, E(h)) + '"/>' +
      (grp ? '<a:chOff x="' + E(x) + '" y="' + E(y) + '"/><a:chExt cx="' + Math.max(0, E(w)) + '" cy="' + Math.max(0, E(h)) + '"/>' : '') + '</a:xfrm>';
  }
  function geom(prst, adj) { return '<a:prstGeom prst="' + prst + '"><a:avLst>' + (adj || []).map(function (g) { return '<a:gd name="' + g[0] + '" fmla="val ' + Math.round(g[1]) + '"/>'; }).join('') + '</a:avLst></a:prstGeom>'; }
  /* sombra do runtime: drop-shadow(0 .8cqh 1.6cqh rgba(0,30,50,.3)) nas formas, box-shadow 0 1cqh 2.4cqh nas fotos (cqh = 7,2 px) */
  function shadow(dy, blur) { return '<a:effectLst><a:outerShdw blurRad="' + E(blur) + '" dist="' + E(dy) + '" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="001E32"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst>'; }
  function nvSp(id, name, txBox, descr, ph) { return '<p:nvSpPr><p:cNvPr id="' + id + '" name="' + xe(name) + '"' + (descr ? ' descr="' + xe(descr) + '"' : '') + '/><p:cNvSpPr' + (txBox && !ph ? ' txBox="1"' : '') + '/><p:nvPr>' + (ph ? '<p:ph type="title"/>' : '') + '</p:nvPr></p:nvSpPr>'; }
  /* título do slide (contorno, navegação e verificador de acessibilidade do PowerPoint): no Idêntico, um espaço reservado de título com o texto
     atrás da imagem do slide (nada muda na tela); no Editável, o texto que é o título do slide vira o espaço reservado, com seu formato explícito */
  var TITLE_BOX = { x: 64, y: 40, w: 1152, h: 96 };
  function titlePh(id, text, name) {
    return '<p:sp>' + nvSp(id, name || 'Título', false, null, true) + '<p:spPr>' + xfrm(TITLE_BOX.x, TITLE_BOX.y, TITLE_BOX.w, TITLE_BOX.h) + geom('rect') + '<a:noFill/></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR" sz="2400" dirty="0"/><a:t>' + xe(String(text || '').slice(0, 300)) + '</a:t></a:r></a:p></p:txBody></p:sp>';
  }
  function layoutTitle() { return '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Título 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>' + xfrm(TITLE_BOX.x, TITLE_BOX.y, TITLE_BOX.w, TITLE_BOX.h) + geom('rect') + '</p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR"/><a:t>Título</a:t></a:r></a:p></p:txBody></p:sp>'; }
  function normT(t) { return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function picXml(id, name, rid, box, o) {
    o = o || {};
    var sr = o.src ? '<a:srcRect' + ['l', 't', 'r', 'b'].map(function (k, i) { var v = Math.round(o.src[i] * 100000); return v ? ' ' + k + '="' + v + '"' : ''; }).join('') + '/>' : '';
    return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="' + xe(name) + '"' + (o.descr ? ' descr="' + xe(String(o.descr).slice(0, 1000)) + '"' : '') + '/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="' + rid + '">' + (o.alpha != null && o.alpha < .999 ? '<a:alphaModFix amt="' + Math.round(clamp(o.alpha, 0, 1) * 100000) + '"/>' : '') + '</a:blip>' + sr + '<a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr>' + xfrm(box.x, box.y, box.w, box.h, o) + geom(o.prst || 'rect', o.adj) + (o.ln || '') + (o.fx || '') + '</p:spPr></p:pic>';
  }

  /* ---------------- um slide ---------------- */
  function Slide(n) { this.n = n; this.id = 1; this.rels = []; this.parts = []; }
  Slide.prototype.nid = function () { return ++this.id; };
  Slide.prototype.rel = function (type, target) { var r = 'rId' + (this.rels.length + 2); this.rels.push([r, type, target]); return r; };
  Slide.prototype.img = function (name) { return this.rel('image', '../media/' + name); };
  Slide.prototype.xml = function (bg, hidden) {
    return HDR + '<p:sld ' + NS + (hidden ? ' show="0"' : '') + '><p:cSld>' + (bg || '') + '<p:spTree>' + GRP0 + this.parts.join('') + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  };
  function bgXml(c) { return c ? '<p:bg><p:bgPr>' + solid(c) + '<a:effectLst/></p:bgPr></p:bg>' : ''; }

  /* palco estático fora da tela (1280×720 CSS px: px calculado = px lógico) para ler o texto */
  var host = null;
  function mount(slide) {
    if (!host || !host.isConnected) { host = document.createElement('div'); host.id = 'amkHost'; host.setAttribute('aria-hidden', 'true'); host.style.cssText = 'position:fixed;left:-42000px;top:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;pointer-events:none;z-index:-1'; document.body.appendChild(host); }
    var st = RT.renderSlide(slide, { play: false }); st.style.width = W + 'px'; st.style.height = H + 'px'; st.style.aspectRatio = 'auto';
    host.appendChild(st); return st;
  }
  function nodeOf(st, el) { var all = st.querySelectorAll('.am-el'); for (var i = 0; i < all.length; i++) if (all[i].dataset.id === el.id) return all[i]; return null; }
  function plainOf(node) {
    if (!node) return ''; var out = [], tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), n;
    while ((n = tw.nextNode())) { var p = n.parentElement; if (p && !p.closest('style,script')) out.push(n.nodeValue); }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  /* imagem PNG transparente de elementos (giro zerado; centralizada no palco para nada sair da área de desenho), recortada no que
     tem pixel. Devolve a caixa do recorte em coordenadas do slide, sem giro (o giro vai no xfrm, em torno do centro do recorte) */
  function rasterCut(slide, els, pad) {
    var bx = X.boxOf(els), cxo = (W - bx.w) / 2 - bx.x, cyo = (H - bx.h) / 2 - bx.y;
    var list = els.map(function (e) { var c = clone(e); if (c.type === 'line') { c.x1 += cxo; c.x2 += cxo; c.y1 += cyo; c.y2 += cyo; } else { c.x += cxo; c.y += cyo; } return c; });
    /* folga generosa em volta (legendas, sombras e brilhos passam da caixa do elemento), limitada ao palco; depois recorta no que tem pixel */
    var pd = Math.max(pad, Math.round(Math.max(bx.w, bx.h) * .3)), x0 = Math.max(0, bx.x + cxo - pd), y0 = Math.max(0, bx.y + cyo - pd), box = { x: x0, y: y0, w: Math.min(W, bx.x + cxo + bx.w + pd) - x0, h: Math.min(H, bx.y + cyo + bx.h + pd) - y0 };
    return X.rasterEls({ els: list }, list, box, { scale: 2 }).then(function (r) {
      var cv = r.canvas, w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var y = 0; y < h; y++) { var row = y * w * 4; for (var x = 0; x < w; x++) if (d[row + x * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) { cv.width = cv.height = 0; return null; }
      x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
      var c2 = document.createElement('canvas'); c2.width = x1 - x0 + 1; c2.height = y1 - y0 + 1; c2.getContext('2d').drawImage(cv, -x0, -y0);
      cv.width = cv.height = 0;
      return new Promise(function (res) { c2.toBlob(function (b) { var k = r.width / box.w; res({ blob: b, box: { x: box.x - cxo + x0 / k, y: box.y - cyo + y0 / k, w: c2.width / k, h: c2.height / k } }); c2.width = c2.height = 0; }, 'image/png'); });
    });
  }
  /* caixa de um recorte girado junto com o elemento: o PowerPoint gira em torno do centro da figura, o navegador em torno do
     centro do elemento → o centro do recorte gira em volta do centro do elemento */
  function rotBox(b, el) {
    var r = (+el.rot || 0) * Math.PI / 180; if (!r) return b;
    var cx = el.x + el.w / 2, cy = el.y + el.h / 2, dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy, c = Math.cos(r), s = Math.sin(r);
    return { x: cx + dx * c - dy * s - b.w / 2, y: cy + dx * s + dy * c - b.h / 2, w: b.w, h: b.h };
  }
  var KIND_NAME = { text: 'Texto', shape: 'Forma', line: 'Linha', image: 'Imagem' };
  function nameOf(el, n) { var b = el.type === 'fx' ? (RT.fxLabel ? RT.fxLabel(el) : el.kind) : KIND_NAME[el.type] || 'Objeto'; return b + ' ' + n; }

  /* --- texto e forma --- */
  function spXml(sl, el, node, o) {
    var id = sl.nid(), w = el.w, h = el.h, opa = el.opacity != null && +el.opacity < 1 ? clamp(+el.opacity, 0, 1) : 1, tr = textRect(node, w, h);
    /* transparência do elemento: o navegador aplica ao conjunto; sobre preenchimento opaco o texto fica com a cor cheia */
    var filled = o.kind === 'shape' ? !!col(el.fill) || (el.look === 'outline' || el.look === 'lift') : o.kind === 'text' ? !!(el.bg && el.bg !== 'none' && col(el.bg)) : false;
    var paras = tr ? parasOf(tr.tx, filled ? 1 : opa) : [];
    var ins = tr ? tr.ins.slice() : [0, 0, 0, 0], prst = 'rect', adj = null, fill = '<a:noFill/>', ln = '<a:ln><a:noFill/></a:ln>', fx = '';
    if (o.kind === 'text') {
      var bg = el.bg && el.bg !== 'none' ? col(el.bg) : null;
      if (bg) { fill = solid(bg, opa); var rr = Math.max(0, Math.min(+el.radius || 0, w / 2, h / 2)); if (rr) { prst = 'roundRect'; adj = [['adj', Math.round(rr / ssOf(w, h) * 100000)]]; var il = rr * .29289; ins = ins.map(function (v) { return v - il; }); } }
    } else if (o.kind === 'shape') {
      var g = o.geo, lk = el.look, sw = +el.strokeW || 0, f = col(el.fill), s = sw ? col(el.stroke) : null;
      if (lk === 'outline' || lk === 'lift') { f = { hex: 'FFFFFF', a: 1 }; if (!sw) { sw = lk === 'lift' ? 0 : 1.5; s = lk === 'lift' ? null : { hex: 'CBD4E1', a: 1 }; } }
      prst = g.prst; adj = g.adj ? g.adj(el, w, h) : null;
      var t = g.tr(w, h, adj || []); if (el.flipH) t = [w - t[2], t[1], w - t[0], t[3]]; if (el.flipV) t = [t[0], h - t[3], t[2], h - t[1]];
      ins = [ins[0] - t[0], ins[1] - t[1], ins[2] - (w - t[2]), ins[3] - (h - t[3])];
      fill = solid(f, opa);
      if (s && sw) ln = '<a:ln w="' + E(sw) + '">' + solid(s, opa) + (el.dash ? '<a:custDash><a:ds d="300000" sp="200000"/></a:custDash>' : '') + '<a:round/></a:ln>';
      if (el.shadow) fx = shadow(5.76, 11.52);
      else if (lk === 'lift') { var m = Math.min(w, h); fx = '<a:effectLst><a:outerShdw blurRad="' + E(Math.max(3, m * .055) * 2) + '" dist="' + E(Math.max(2, m * .035)) + '" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="002A46"><a:alpha val="16000"/></a:srgbClr></a:outerShdw></a:effectLst>'; }
    } else if (o.kind === 'overlay') { ins = tr ? tr.ins.slice() : ins; }
    var box = o.box || el;
    return '<p:sp>' + nvSp(id, o.name || nameOf(el, id - 1), o.kind !== 'shape', null, o.ph === true) + '<p:spPr>' + xfrm(box.x, box.y, box.w, box.h, o.kind === 'shape' ? { rot: o.rot, flipH: el.flipH, flipV: el.flipV } : { rot: o.rot }) + geom(prst, adj) + fill + ln + fx + '</p:spPr>' +
      txBody(paras, ins, tr ? tr.anchor : 'ctr', true) + '</p:sp>';
  }
  /* cópia do elemento com o texto invisível (mesmo lugar, mesma faixa do card Cabeçalho): só o desenho vai para a imagem */
  function inkless(el) {
    var c = clone(el); c.color = 'transparent';
    c.html = String(c.html || '').replace(/style="([^"]*)"/gi, function (m, v) { return 'style="' + v.replace(/(^|;)\s*color\s*:[^;]*/gi, '$1') + '"'; }).replace(/(<font[^>]*?)\scolor="[^"]*"/gi, '$1');
    return c;
  }
  function hasText(node) { var t = node && node.querySelector('.am-tx'); return !!(t && /\S/.test(t.textContent || '')); }

  /* --- linha / conector --- */
  var HEAD = { arrow: 'triangle', open: 'arrow', dot: 'oval', diamond: 'diamond' };
  var LDASH = { dash: [300000, 200000], dot: [1000, 200000], dashdot: [300000, 160000, 1000, 160000], long: [600000, 250000] };
  function headOf(el, k, b) { return ['arrow', 'open', 'dot', 'diamond', 'bar'].indexOf(el[k]) >= 0 ? el[k] : (el[b] ? 'arrow' : null); }
  function headSz(v) { return v >= 4 ? 'lg' : v >= 2.5 ? 'med' : 'sm'; }
  function lineXml(sl, el) {
    var x1 = +el.x1, y1 = +el.y1, x2 = +el.x2, y2 = +el.y2, dx = x2 - x1, dy = y2 - y1, sw = +el.strokeW || 2, c = col(el.stroke || '#002A46') || { hex: '002A46', a: 1 }, opa = el.opacity != null && +el.opacity < 1 ? +el.opacity : 1;
    var route = el.curve === 'elbow' ? 'bentConnector3' : el.curve === 'curve' ? 'curvedConnector3' : 'straightConnector1', o, box;
    if (route === 'straightConnector1' || Math.abs(dx) >= Math.abs(dy)) { box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(dx), h: Math.abs(dy) }; o = { flipH: dx < 0, flipV: dy < 0 }; }
    else { var cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, ew = Math.abs(dy), eh = Math.abs(dx); box = { x: cx - ew / 2, y: cy - eh / 2, w: ew, h: eh }; o = { rot: 90, flipH: dy < 0, flipV: dx > 0 }; }
    var s = Math.max(9, sw * 3.4), hs = headOf(el, 'headS', 'headStart'), he = headOf(el, 'headE', 'headEnd'), ds = el.dash ? (LDASH[el.dashS] || LDASH.dash) : null;
    var cap = !ds || el.dashS === 'dot' || el.dashS === 'dashdot' ? 'rnd' : 'flat';
    function end(tag, k) { return k && HEAD[k] ? '<a:' + tag + ' type="' + HEAD[k] + '" w="' + headSz(s * 1.1 / sw) + '" len="' + headSz(s / sw) + '"/>' : ''; }
    var adj = route === 'bentConnector3' ? [['adj1', Math.round((el.bend == null ? .5 : clamp(+el.bend, .05, .95)) * 100000)]] : route === 'curvedConnector3' ? [['adj1', 50000]] : null;
    var lnx = '<a:ln w="' + E(sw) + '" cap="' + cap + '">' + solid(c, opa) + (ds ? '<a:custDash>' + ds.reduce(function (a, v, i) { return i % 2 ? a : a + '<a:ds d="' + v + '" sp="' + ds[i + 1] + '"/>'; }, '') + '</a:custDash>' : '') + '<a:round/>' + end('headEnd', hs) + end('tailEnd', he) + '</a:ln>';
    var id = sl.nid(), out = '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + id + '" name="' + xe((he || hs ? 'Seta ' : 'Linha ') + (id - 1)) + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>' + xfrm(box.x, box.y, box.w, box.h, o) + geom(route, adj) + lnx + '</p:spPr></p:cxnSp>';
    /* ponta “barra” (cota): o PowerPoint não tem; vira um traço perpendicular na ponta */
    function bar(px, py, ang) {
      var ox = -Math.sin(ang) * s * .55, oy = Math.cos(ang) * s * .55, ax = px + ox, ay = py + oy, bx = px - ox, by = py - oy, i2 = sl.nid();
      return '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + i2 + '" name="Ponta ' + (i2 - 1) + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>' + xfrm(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), { flipH: bx < ax, flipV: by < ay }) + geom('line') +
        '<a:ln w="' + E(sw) + '" cap="rnd">' + solid(c, opa) + '<a:round/></a:ln></p:spPr></p:cxnSp>';
    }
    var a1 = route === 'straightConnector1' ? Math.atan2(dy, dx) : (Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? Math.PI : 0) : (dy < 0 ? -Math.PI / 2 : Math.PI / 2));
    if (he === 'bar') out += bar(x2, y2, a1);
    if (hs === 'bar') out += bar(x1, y1, a1);
    return out;
  }

  /* --- foto --- */
  function imageXml(sl, el, media) {
    return media.addSrc(el.src, Math.max(el.w, el.h)).then(function (m) {
      if (!m) return '';
      var id = sl.nid(), rid = sl.img(m.name), o = { rot: el.rot, flipH: el.flipH, flipV: el.flipV, alpha: el.opacity != null && +el.opacity < 1 ? +el.opacity : null, descr: 'Imagem' }, box = { x: el.x, y: el.y, w: el.w, h: el.h };
      var ia = m.nw / m.nh, ba = el.w / el.h, rad = Math.max(0, +el.radius || 0), cr = RT.cropOf ? RT.cropOf(el) : null;
      if (cr) { /* S27b: recorte do editor = srcRect do PowerPoint (a foto inteira vai no arquivo) */
        o.src = [cr.l, cr.t, cr.r, cr.b];
        if (rad) { o.prst = 'roundRect'; o.adj = [['adj', clamp(Math.round(Math.min(rad, el.w / 2, el.h / 2) / ssOf(el.w, el.h) * 100000), 0, 50000)]]; }
      } else if ((el.fit || 'cover') === 'contain') {
        var k = Math.min(el.w / m.nw, el.h / m.nh), iw = m.nw * k, ih = m.nh * k;
        /* “Inteira”: a moldura é a caixa toda (como no editor) e a foto fica centralizada com faixas transparentes (recorte negativo) */
        var lx = (el.w - iw) / 2 / iw, ly = (el.h - ih) / 2 / ih; if (lx > .0005 || ly > .0005) o.src = [-lx, -ly, -lx, -ly];
        if (rad && lx < .002 && ly < .002) { o.prst = 'roundRect'; o.adj = [['adj', clamp(Math.round(Math.min(rad, el.w / 2, el.h / 2) / ssOf(el.w, el.h) * 100000), 0, 50000)]]; }
      } else {
        if (ia > ba) { var f = (1 - ba / ia) / 2; o.src = [f, 0, f, 0]; } else if (ia < ba) { var g = (1 - ia / ba) / 2; o.src = [0, g, 0, g]; }
        if (rad) { o.prst = 'roundRect'; o.adj = [['adj', clamp(Math.round(Math.min(rad, el.w / 2, el.h / 2) / ssOf(el.w, el.h) * 100000), 0, 50000)]]; }
      }
      if (el.shadow) o.fx = shadow(7.2, 17.28);
      return picXml(id, 'Imagem ' + (id - 1), rid, box, o);
    });
  }
  /* --- foto de fundo: tela cheia, recorte “cover” centralizado, transparência = bgImgOp --- */
  function bgImageXml(sl, slide, media) {
    return media.addSrc(slide.bgImg, W).then(function (m) {
      if (!m) return '';
      var ia = m.nw / m.nh, ba = W / H, o = { alpha: slide.bgImgOp == null ? 1 : clamp(+slide.bgImgOp, 0, 1), descr: 'Imagem de fundo' };
      if (ia > ba) { var f = (1 - ba / ia) / 2; o.src = [f, 0, f, 0]; } else if (ia < ba) { var g = (1 - ia / ba) / 2; o.src = [0, g, 0, g]; }
      var id = sl.nid(); return picXml(id, 'Imagem de fundo', sl.img(m.name), { x: 0, y: 0, w: W, h: H }, o);
    });
  }
  /* --- elemento como imagem (gráficos, modelos, ícones, cards, contadores; formas que o PowerPoint não desenha igual) --- */
  function rasterXml(sl, slide, el, media, node, name) {
    var c = clone(el); delete c.rot; delete c.anim;
    return rasterCut(slide, [c], 80).then(function (r) {
      if (!r) return '';
      return media.addBlob(r.blob, 'png').then(function (nm) {
        var id = sl.nid(), b = rotBox(r.box, el);
        return picXml(id, name || nameOf(el, id - 1), sl.img(nm), b, { rot: el.rot, descr: (name || nameOf(el, id - 1)) + (plainOf(node) ? ': ' + plainOf(node) : '') });
      });
    });
  }
  /* forma com estilo/geometria sem equivalente: o corpo vira imagem e o texto continua editável por cima (agrupados) */
  function hybridXml(sl, slide, el, media, node) {
    var body = inkless(el); delete body.rot; delete body.anim;
    return rasterCut(slide, [body], 48).then(function (r) {
      var gid = sl.nid(), nm = nameOf(el, gid - 1);
      var pic = r ? media.addBlob(r.blob, 'png').then(function (mn) { var id = sl.nid(); return picXml(id, nm + ' (desenho)', sl.img(mn), r.box, { descr: nm }); }) : Promise.resolve('');
      return pic.then(function (px) {
        var tx = hasText(node) ? spXml(sl, el, node, { kind: 'overlay', name: nm + ' (texto)', box: { x: el.x, y: el.y, w: el.w, h: el.h } }) : '';
        if (!tx) { if (!r) return ''; var b = rotBox(r.box, el); return px.replace(/<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/, xfrm(b.x, b.y, b.w, b.h, { rot: el.rot })); }
        return '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="' + gid + '" name="' + xe(nm) + '"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>' + xfrm(el.x, el.y, el.w, el.h, { rot: el.rot }, true) + '</p:grpSpPr>' + px + tx + '</p:grpSp>';
      });
    });
  }

  function editSlide(sl, slide, media, title) {
    var st = mount(slide), els = slide.els || [], i = 0, pre = slide.bgImg ? bgImageXml(sl, slide, media) : Promise.resolve(''), tt = normT(title), gotTitle = false;
    function next() {
      if (i >= els.length) { if (!gotTitle && tt) sl.parts.unshift(titlePh(sl.nid(), title)); return Promise.resolve(); } /* nenhum texto é o título (ex.: só imagem): título escondido atrás, só para o contorno */
      var el = els[i++], node = nodeOf(st, el), job;
      if (el.type === 'text') { var isT = !gotTitle && tt && normT(plainOf(node)) === tt && !el.rot; if (isT) gotTitle = true; job = Promise.resolve(spXml(sl, el, node, { kind: 'text', rot: el.rot, ph: isT })); }
      else if (el.type === 'shape') {
        var g = geoOf(el);
        job = g && !((el.flipH || el.flipV) && hasText(node)) ? Promise.resolve(spXml(sl, el, node, { kind: 'shape', geo: g, rot: el.rot })) : hybridXml(sl, slide, el, media, node);
      } else if (el.type === 'line') job = Promise.resolve(lineXml(sl, el));
      else if (el.type === 'image') job = imageXml(sl, el, media);
      else job = rasterXml(sl, slide, el, media, node);
      return job.then(function (x) { if (x) sl.parts.push(x); }).then(next);
    }
    return pre.then(function (x) { if (x) sl.parts.push(x); }).then(next).then(function () { return bgXml(col(slide.bg) || { hex: 'FFFFFF', a: 1 }); }).finally(function () { st.remove(); });
  }
  function imageSlide(sl, slide, media, title) {
    return X.rasterSlide(slide, { scale: 2, type: 'jpeg', quality: .92, bg: '#FFFFFF', texts: false }).catch(function (err) { throw new Error('slide ' + sl.n + ' não pôde ser desenhado'); }).then(function (r) {
      return media.addBlob(r.blob, 'jpeg').then(function (nm) {
        r.canvas.width = r.canvas.height = 0;
        var id = sl.nid(), txt = '';
        try { var st = mount(slide); txt = plainOf(st); st.remove(); } catch (e) { }
        if (title) sl.parts.push(titlePh(sl.nid(), title)); /* atrás da imagem: o slide continua idêntico, mas tem nome no contorno */
        sl.parts.push(picXml(id, 'Slide ' + sl.n, sl.img(nm), { x: 0, y: 0, w: W, h: H }, { descr: txt || ('Slide ' + sl.n) }));
        return bgXml(col(slide.bg) || { hex: 'FFFFFF', a: 1 });
      });
    });
  }

  /* ---------------- o pacote ---------------- */
  var PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  function build(deck, o) {
    o = o || {};
    var list = o.list || X.pick(deck, o), n = list.length, mode = o.mode === 'edit' ? 'edit' : 'image', sig = o.signal || {}, media = new Media(), slides = [], i = 0;
    var notesOn = o.notes !== false;
    if (!n) return Promise.resolve(null);
    function next() {
      if (sig.cancelled) return Promise.resolve(null);
      if (i >= n) return finish();
      if (o.onProgress) o.onProgress(i, n);
      var it = list[i], sl = new Slide(i + 1);
      var ttl = ''; try { ttl = RT.slideTitle ? String(RT.slideTitle(it.slide, it.index | 0) || '') : ''; } catch (e) { }
      return tick().then(function () { return mode === 'edit' ? editSlide(sl, it.slide, media, ttl) : imageSlide(sl, it.slide, media, ttl); }).then(function (bg) {
        if (sig.cancelled) return null;
        var notes = notesOn && typeof it.slide.notes === 'string' && it.slide.notes.trim() ? it.slide.notes : '';
        if (notes) sl.rel('notesSlide', '../notesSlides/notesSlide' + sl.n + '.xml');
        slides.push({ sl: sl, bg: bg, notes: notes, hidden: it.slide.hidden === true });
        i++; return tick().then(next);
      });
    }
    function finish() {
      if (o.onProgress) o.onProgress(n, n);
      var title = String((deck && deck.title) || 'Apresentação').slice(0, 300), now = isoNow(), files = [], nNotes = 0, nHid = 0;
      var allHid = slides.length && slides.every(function (s) { return s.hidden; }); /* só ocultos (ex.: “Slide atual” num slide oculto): saem visíveis, senão a apresentação do PowerPoint ficaria vazia */
      slides.forEach(function (s) { if (allHid) s.hidden = false; s.xml = s.sl.xml(s.bg, s.hidden); if (s.notes) nNotes++; if (s.hidden) nHid++; });
      var ct = HDR + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="' + CT + 'presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="' + CT + 'slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="' + CT + 'slideLayout+xml"/>' +
        slides.map(function (s) { return '<Override PartName="/ppt/slides/slide' + s.sl.n + '.xml" ContentType="' + CT + 'slide+xml"/>' + (s.notes ? '<Override PartName="/ppt/notesSlides/notesSlide' + s.sl.n + '.xml" ContentType="' + CT + 'notesSlide+xml"/>' : ''); }).join('') +
        '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="' + CT + 'notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        '<Override PartName="/ppt/presProps.xml" ContentType="' + CT + 'presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="' + CT + 'viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="' + CT + 'tableStyles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
      files.push({ name: '[Content_Types].xml', data: ct });
      files.push({ name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', 'extended-properties', 'docProps/app.xml']]) });
      files.push({ name: 'docProps/core.xml', data: HDR + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + xe(title) + '</dc:title><dc:creator>Canteiro</dc:creator><cp:lastModifiedBy>Canteiro</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>' });
      files.push({ name: 'docProps/app.xml', data: HDR + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><TotalTime>0</TotalTime><Words>0</Words><Application>Canteiro · Acervo de Apresentações A&amp;M</Application><PresentationFormat>Widescreen</PresentationFormat><Paragraphs>0</Paragraphs><Slides>' + slides.length + '</Slides><Notes>' + nNotes + '</Notes><HiddenSlides>' + nHid + '</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>' });
      files.push({ name: 'ppt/presentation.xml', data: HDR + '<p:presentation ' + NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>' +
        slides.map(function (s, k) { return '<p:sldId id="' + (256 + k) + '" r:id="rId' + (10 + k) + '"/>'; }).join('') + '</p:sldIdLst><p:sldSz cx="' + SW + '" cy="' + SH + '"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle>' + LVL + '</p:defaultTextStyle></p:presentation>' });
      files.push({ name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'notesMaster', 'notesMasters/notesMaster1.xml'], ['rId3', 'presProps', 'presProps.xml'], ['rId4', 'viewProps', 'viewProps.xml'], ['rId5', 'theme', 'theme/theme1.xml'], ['rId6', 'tableStyles', 'tableStyles.xml']].concat(slides.map(function (s, k) { return ['rId' + (10 + k), 'slide', 'slides/slide' + s.sl.n + '.xml']; }))) });
      files.push({ name: 'ppt/presProps.xml', data: HDR + '<p:presentationPr ' + NS + '/>' });
      files.push({ name: 'ppt/viewProps.xml', data: HDR + '<p:viewPr ' + NS + '><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>' });
      files.push({ name: 'ppt/tableStyles.xml', data: HDR + '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>' });
      files.push({ name: 'ppt/theme/theme1.xml', data: theme('Canteiro', deck.brand) });
      files.push({ name: 'ppt/theme/theme2.xml', data: theme('Canteiro anotações', deck.brand) });
      files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: master() });
      files.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) });
      files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: layout() });
      files.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) });
      files.push({ name: 'ppt/notesMasters/notesMaster1.xml', data: notesMaster() });
      files.push({ name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: rels([['rId1', 'theme', '../theme/theme2.xml']]) });
      slides.forEach(function (s) {
        files.push({ name: 'ppt/slides/slide' + s.sl.n + '.xml', data: s.xml });
        files.push({ name: 'ppt/slides/_rels/slide' + s.sl.n + '.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']].concat(s.sl.rels)) });
        if (s.notes) {
          files.push({ name: 'ppt/notesSlides/notesSlide' + s.sl.n + '.xml', data: notesSlide(s.sl.n, s.notes) });
          files.push({ name: 'ppt/notesSlides/_rels/notesSlide' + s.sl.n + '.xml.rels', data: rels([['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'], ['rId2', 'slide', '../slides/slide' + s.sl.n + '.xml']]) });
        }
      });
      files = files.concat(media.files);
      if (sig.cancelled) return Promise.resolve(null);
      return zip(files, PPTX_MIME).then(function (b) { if (b) b.dropped = media.dropped; return b; });
    }
    return next();
  }
  /* fontes usadas pelos textos e formas da seleção (para o aviso do modo Editável) */
  function fontsUsed(list) {
    var f = {};
    list.forEach(function (it) { (it.slide.els || []).forEach(function (e) { if ((e.type === 'text' || (e.type === 'shape' && /\S/.test(String(e.html || '').replace(/<[^>]*>/g, '')))) && e.font) { f[e.font] = 1; if (+e.weight <= 349 && LIGHT[FAMS[String(e.font).toLowerCase()] || e.font]) f[(FAMS[String(e.font).toLowerCase()] || e.font) + ' Light'] = 1; } }); });
    return Object.keys(f).sort();
  }
  /* o que vai como imagem no Editável (gráficos, modelos, ícones…): contagem por tipo para a caixa dizer antes de exportar */
  function asImages(list) {
    var c = {}, n = 0;
    list.forEach(function (it) { (it.slide.els || []).forEach(function (e) { if (e.type === 'fx' || (e.type === 'shape' && !geoOf(e))) { var k = e.type === 'fx' ? (RT.fxLabel ? RT.fxLabel(e) : e.kind) : 'Forma'; c[k] = (c[k] || 0) + 1; n++; } }); });
    return { n: n, items: Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.localeCompare(b); }).map(function (k) { return c[k] + '× ' + k; }) };
  }

  /* ---------------- caixa “Salvar como PowerPoint” (mesmo desenho da caixa do PDF: classes .xp do ed-40-export.css) ---------------- */
  var dlg = null, st = null, lastMode = 'image';
  function fmtMB(b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }
  var IPPT = '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="M9.5 13V7.5h2.3a1.8 1.8 0 0 1 0 3.6H9.5"/>';
  var IIMG = '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5.5-5.5L6 19"/>';
  var IEDT = '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 7l3 3"/><path d="M4 4h8M4 8h4"/>';
  function deckNow() { return S().deck; }
  function counts() { var sl = deckNow().slides; return { n: sl.length, hid: sl.filter(function (s) { return s.hidden === true; }).length, cur: S().cur | 0 }; }
  function build_() {
    dlg = document.createElement('div'); dlg.id = 'xkDlg'; dlg.className = 'xp xk'; dlg.hidden = true;
    dlg.innerHTML = '<div class="xp-bk" data-x="bk"></div>' +
      '<form class="xp-box" role="dialog" aria-modal="true" aria-labelledby="xkT" aria-describedby="xkSum" novalidate>' +
      '<header class="xp-h"><div class="xp-ic">' + svg(IPPT) + '</div><div class="xp-hd"><div class="xp-ey">Exportar</div><h3 id="xkT">Salvar como PowerPoint</h3></div>' +
      '<button type="button" class="xp-x" data-x="close" title="Fechar (Esc)" aria-label="Fechar">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></header>' +
      '<div class="xp-b">' +
      '<fieldset class="xp-fmt" role="radiogroup" aria-label="Como os slides vão para o PowerPoint"><legend class="xp-lg">Como os slides vão para o PowerPoint</legend>' +
      '<label class="xp-card"><input type="radio" name="xkMode" value="image"><span class="xp-ci">' + svg(IIMG) + '</span><span><b>Idêntico <em class="xk-rec">recomendado</em></b><small>Cada slide vira uma imagem em alta resolução: igual ao editor em qualquer computador. Para mudar o texto, edite no Canteiro.</small></span></label>' +
      '<label class="xp-card"><input type="radio" name="xkMode" value="edit"><span class="xp-ci">' + svg(IEDT) + '</span><span><b>Editável</b><small>Textos, formas, linhas e fotos viram objetos do PowerPoint. Gráficos, modelos e ícones vão como imagem.</small></span></label></fieldset>' +
      '<p class="xp-sum" id="xkSum"></p>' +
      '<p class="xk-font" id="xkFont" role="note" hidden></p>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Slides</legend>' +
      '<label class="xp-rd"><input type="radio" name="xkRange" value="all" checked><span id="xkAllL">Todos</span></label>' +
      '<label class="xp-rd"><input type="radio" name="xkRange" value="cur"><span id="xkCurL">Slide atual</span></label>' +
      '<div class="xp-rd xp-span"><label><input type="radio" name="xkRange" value="span"><span>De</span></label>' +
      '<input type="number" id="xkFrom" min="1" step="1" inputmode="numeric" aria-label="Do slide"><span>a</span><input type="number" id="xkTo" min="1" step="1" inputmode="numeric" aria-label="Até o slide"></div>' +
      '<label class="xp-ck"><input type="checkbox" id="xkHid"><span id="xkHidL">Incluir slides ocultos</span></label>' +
      '<label class="xp-ck xk-ck2"><input type="checkbox" id="xkNotes" checked><span id="xkNotesL">Levar o resumo de cada slide para as anotações do orador</span></label></fieldset>' +
      '<div class="xp-est" id="xkEst" aria-live="polite"></div>' +
      '<div class="xp-prog" id="xkProg" hidden><div class="xp-pt"><span id="xkPl" role="status" aria-live="polite">Preparando…</span><b id="xkPp">0%</b></div><div class="xp-bar" role="progressbar" aria-labelledby="xkPl" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="xkPb"></i></div></div>' +
      '</div>' +
      '<footer class="xp-f"><button type="button" class="xp-btn" data-x="cancel" id="xkCancel">Cancelar</button><button type="submit" class="xp-btn pri" id="xkGo">Exportar PowerPoint</button></footer></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'bk') { if (st && st.busy) return; closeDialog(); }
      else if (x.dataset.x === 'close') { if (st && st.busy) cancelRun(); else closeDialog(); }
      else if (x.dataset.x === 'cancel') { if (st && st.busy) cancelRun(); else closeDialog(); }
    });
    dlg.addEventListener('change', function (e) {
      if (e.target.name === 'xkMode') setMode(e.target.value);
      if (e.target.id === 'xkNotes') st.notesAuto = false; /* a pessoa decidiu: a caixa não volta a marcar sozinha */
      if (e.target.id === 'xkFrom' || e.target.id === 'xkTo') { $('input[name=xkRange][value=span]', dlg).checked = true; clampSpan(); }
      update();
    });
    dlg.addEventListener('input', function (e) { if (e.target.id === 'xkFrom' || e.target.id === 'xkTo') { $('input[name=xkRange][value=span]', dlg).checked = true; update(); } });
    $('form', dlg).addEventListener('submit', function (e) { e.preventDefault(); run(); });
  }
  function opts() {
    var c = counts(), r = ($('input[name=xkRange]:checked', dlg) || {}).value || 'all';
    return { range: r, from: +$('#xkFrom').value || 1, to: +$('#xkTo').value || c.n, cur: c.cur, includeHidden: $('#xkHid').checked, mode: st.mode, notes: $('#xkNotes').checked };
  }
  function clampSpan() { var n = counts().n; [$('#xkFrom'), $('#xkTo')].forEach(function (x) { var v = Math.round(+x.value); x.value = String(Math.max(1, Math.min(n, isFinite(v) && v ? v : 1))); }); }
  function setMode(m) {
    st.mode = lastMode = m === 'edit' ? 'edit' : 'image'; dlg.dataset.mode = st.mode;
    $('input[name=xkMode][value=' + st.mode + ']', dlg).checked = true;
  }
  /* estimativa medida: Idêntico ≈ 150 KB por slide (JPEG 2560×1440; as fotos já estão na imagem);
     Editável ≈ 6 KB por slide + fotos do deck (uma vez cada) + ~90 KB por gráfico/modelo/ícone em imagem (PNG 2×) */
  function estimate(list, o) {
    var b = 24 * 1024, seen = {};
    list.forEach(function (it) {
      var s = it.slide;
      if (o.mode !== 'edit') { var ph = (s.bgImg ? String(s.bgImg).length : 0) + (s.els || []).reduce(function (a, e) { return a + (e.type === 'image' ? String(e.src || '').length : 0); }, 0); b += 190 * 1024 + Math.min(600 * 1024, ph * .75 * .35); return; } /* medido nos modelos: ≈ 190 KB por slide, mais as fotos (comprimem pior no JPEG da tela) */
      b += 6 * 1024;
      [s.bgImg].concat((s.els || []).map(function (e) { return e.type === 'image' ? e.src : null; })).forEach(function (src) { if (src && !seen[src]) { seen[src] = 1; b += /^data:/.test(src) ? String(src).length * .75 : 200 * 1024; } });
      (s.els || []).forEach(function (e) { if (e.type === 'fx') b += 90 * 1024; else if (e.type === 'shape' && !geoOf(e)) b += 30 * 1024; });
    });
    return b;
  }
  function update() {
    if (!dlg || dlg.hidden) return;
    var c = counts(), o = opts(), list = X.pick(deckNow(), o), d = deckNow();
    $('#xkAllL').textContent = 'Todos (' + (c.n - (o.includeHidden ? 0 : c.hid)) + (c.n === 1 ? ' slide)' : ' slides)');
    $('#xkCurL').textContent = 'Slide atual (' + (c.cur + 1) + (d.slides[c.cur] && d.slides[c.cur].hidden === true ? ', oculto)' : ')');
    $('#xkFrom').max = $('#xkTo').max = String(c.n);
    var hk = $('#xkHid'); hk.disabled = !c.hid || (st && st.busy);
    $('#xkHidL').textContent = c.hid ? 'Incluir slides ocultos (' + c.hid + ') — entram ocultos, como no PowerPoint' : 'Incluir slides ocultos (nenhum nesta apresentação)';
    var withNotes = list.filter(function (it) { return typeof it.slide.notes === 'string' && it.slide.notes.trim(); }).length, nk = $('#xkNotes');
    $('#xkNotesL').textContent = 'Levar o resumo de cada slide para as anotações do orador' + (withNotes ? ' (' + withNotes + (withNotes === 1 ? ' slide tem resumo)' : ' slides têm resumo)') : ' (nenhum slide escolhido tem resumo: escreva em “Sobre este slide”, no painel do slide)');
    nk.disabled = !withNotes || (st && st.busy); if (!withNotes) nk.checked = false; else if (st && !st.busy && st.notesAuto !== false) nk.checked = true;
    var isE = st.mode === 'edit';
    $('#xkSum').innerHTML = isE
      ? 'Um slide do PowerPoint por slide, <b>16:9 (33,867 × 19,05 cm)</b>, no estado final (sem os efeitos). <b>Textos, formas, linhas, setas e fotos</b> ficam editáveis; <b>gráficos, modelos, SmartArt, ícones e cards</b> vão como imagem nítida no mesmo lugar.'
      : 'Um slide do PowerPoint por slide, <b>16:9 (33,867 × 19,05 cm)</b>, cada um como imagem <b>2560 × 1440</b> idêntica ao editor, no estado final (sem os efeitos). Abre igual em qualquer computador, com ou sem as fontes.';
    var fu = fontsUsed(list), fo = $('#xkFont'), ai = isE ? asImages(list) : { n: 0, items: [] };
    fo.hidden = !isE || (!fu.length && !ai.n);
    fo.innerHTML = (fu.length ? 'As fontes <b>' + fu.map(function (f) { return RT.esc(f); }).join(', ').replace(/, ([^,]*)$/, ' e $1') + '</b> precisam estar instaladas no computador de quem abrir o arquivo: sem elas, o PowerPoint usa outra fonte e as quebras de linha podem mudar.' : '') +
      (ai.n ? (fu.length ? '<br>' : '') + 'Vão como <b>imagem</b> (não editáveis no PowerPoint): ' + RT.esc(ai.items.slice(0, 6).join(', ')) + (ai.items.length > 6 ? '…' : '') + '.' : '');
    var allHid = list.length && list.every(function (it) { return it.slide.hidden === true; });
    $('#xkEst').innerHTML = list.length ? '<b>' + list.length + (list.length === 1 ? ' slide' : ' slides') + '</b> · tamanho estimado <b>≈ ' + fmtMB(estimate(list, o)) + '</b>' + (allHid ? '<br><span class="xp-warn">Todos os slides escolhidos estão ocultos: no arquivo eles saem visíveis, para a apresentação do PowerPoint não ficar vazia.</span>' : '') : '<span class="xp-warn">Nenhum slide neste intervalo: todos estão ocultos. Marque “Incluir slides ocultos”.</span>';
    $('#xkGo').disabled = !list.length || (st && st.busy);
  }
  function focusables() { return [].slice.call(dlg.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null && x.tabIndex >= 0; }); }
  function onKey(e) {
    if (!isOpen()) return;
    var inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && dlg.contains(e.target);
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (st.busy) cancelRun(); else closeDialog(); return; }
    if (e.key === 'Tab') { var f = focusables(); if (!f.length) return; var i = f.indexOf(document.activeElement); e.preventDefault(); e.stopImmediatePropagation(); (f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length] || f[0]).focus(); return; }
    if (e.key === 'F1' || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^[sodpzy]$/i.test(e.key) && !inField)) e.preventDefault();
    e.stopImmediatePropagation();
  }
  function isOpen() { return !!(dlg && !dlg.hidden); }
  function openDialog(opener) {
    var A = S(); if (!A) return;
    if (X.isOpen && X.isOpen()) X.closeDialog();
    if (!dlg) build_();
    if (A.closeMenus) A.closeMenus();
    var ae = document.activeElement;
    st = { mode: lastMode, busy: false, sig: null, prev: opener || (ae && ae !== document.body ? ae : null) };
    /* a cada abertura: todos os slides, com os ocultos (o PowerPoint guarda slides ocultos como ocultos) */
    var c = counts(); $('#xkFrom').value = '1'; $('#xkTo').value = String(c.n); $('input[name=xkRange][value=all]', dlg).checked = true; $('#xkHid').checked = c.hid > 0; $('#xkNotes').checked = true;
    $('#xkProg').hidden = true; dlg.classList.remove('busy');
    setMode(lastMode); dlg.hidden = false; document.documentElement.classList.add('xp-open');
    addEventListener('keydown', onKey, true);
    update();
    setTimeout(function () { var g = $('#xkGo'); if (isOpen()) (g.disabled ? $('input[name=xkMode]:checked', dlg) : g).focus(); }, 30);
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
    $('#xkProg').hidden = !b; $('#xkGo').disabled = b;
    $('#xkCancel').textContent = b ? 'Cancelar exportação' : 'Cancelar';
    $('.xp-x', dlg).setAttribute('aria-disabled', b ? 'true' : 'false');
    if (!b) update();
    if (isOpen()) { var fc = b ? $('#xkCancel') : $('#xkGo'); if (fc && !fc.disabled) fc.focus({ preventScroll: true }); }
  }
  function progress(i, n) {
    var pc = n ? Math.round(i / n * 100) : 0;
    $('#xkPl').textContent = i < n ? 'Gerando slide ' + (i + 1) + ' de ' + n + '…' : 'Montando o arquivo…';
    $('#xkPp').textContent = pc + '%'; $('#xkPb').style.width = pc + '%'; $('.xp-bar', dlg).setAttribute('aria-valuenow', String(pc));
  }
  function cancelRun() { if (!(st && st.sig)) return; st.sig.cancelled = true; st.sig = null; setBusy(false); $('#xkProg').hidden = true; toast('Exportação cancelada'); }
  function run() {
    if (st.busy) return;
    var o = opts(), d = deckNow(), list = X.pick(d, o); if (!list.length) return;
    var A = S(); if (A.flush) A.flush();
    var sig = st.sig = { cancelled: false }, t0 = Date.now(); setBusy(true); progress(0, list.length);
    var name = (A.slug ? A.slug(d.title) : 'apresentacao') + '.pptx', hid = list.filter(function (it) { return it.slide.hidden === true; }).length;
    build(d, { list: list, mode: o.mode, notes: o.notes, signal: sig, onProgress: function (i, n) { if (st.sig === sig) progress(i, n); } }).then(function (blob) {
      if (st.sig !== sig) return;
      st.sig = null; setBusy(false);
      if (!blob || sig.cancelled) { $('#xkProg').hidden = true; return; }
      A.download(name, blob, PPTX_MIME);
      var dr = blob.dropped | 0;
      X.last = { name: name, size: blob.size, pages: list.length, ms: Date.now() - t0, mode: o.mode, hidden: hid, dropped: dr };
      closeDialog(); toast('PowerPoint salvo: ' + name + ' · ' + list.length + (list.length === 1 ? ' slide' : ' slides') + (hid ? ' (' + hid + (hid === 1 ? ' oculto)' : ' ocultos)') : '') + ' · ' + fmtMB(blob.size) + (dr ? ' · ' + dr + (dr === 1 ? ' imagem não pôde ser incluída' : ' imagens não puderam ser incluídas') : ''));
    }).catch(function (err) {
      if (st.sig === sig) { st.sig = null; setBusy(false); }
      if (window.console && console.warn) console.warn('AMExport.pptx', err);
      toast('Não foi possível gerar o PowerPoint: ' + (err && err.message || err));
    });
  }

  /* gancho do S22: os menus ▾ e Arquivo habilitam “PowerPoint” quando AMExport.pptx existe */
  X.pptx = function (deck, o) { openDialog(o && o.opener); };
  X.pptxBuild = build;
  X.pptxDialog = { open: openDialog, close: closeDialog, isOpen: isOpen };
  X.zip = zip; X.jpegOrient = jpegOrient;
  X.crc32 = function (u8) { return (crc32(u8) ^ 0xFFFFFFFF) >>> 0; };
})();
