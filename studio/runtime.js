/* ===== AM Studio runtime: renderiza slides e executa a apresentação (usado no editor e no arquivo salvo) ===== */
window.AMRT = (function () {
  'use strict';
  var W = 1280, H = 720;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function P(v, t) { return (v / t * 100).toFixed(4) + '%'; }
  function CQ(v) { return (v / W * 100).toFixed(4) + 'cqw'; }
  /* fonte fora da lista (arquivo importado do PowerPoint/PDF): usa a fonte instalada no computador de quem vê, com a pilha padrão de reserva */
  function fontStack(name, dflt) { if (FONTS[name]) return FONTS[name]; return typeof name === 'string' && /^[\w][\w\s.-]{0,39}$/.test(name) ? "'" + name + "'," + dflt : dflt; }
  var FONTS = { 'Roboto': "Roboto,'Arial Nova',Arial,sans-serif", 'Roboto Condensed': "'Roboto Condensed','Arial Nova Cond',Arial,sans-serif", 'Inter': "Inter,Arial,sans-serif", 'JetBrains Mono': "'JetBrains Mono',Consolas,monospace",
    /* S29 (kit de marca): fontes do computador e serifadas do Google com reserva do mesmo tipo (Calibri → Carlito no Linux) */
    'Calibri': "Calibri,Carlito,'Segoe UI',Arial,sans-serif", 'Segoe UI': "'Segoe UI',Roboto,Arial,sans-serif", 'Georgia': "Georgia,'Times New Roman',serif", 'Times New Roman': "'Times New Roman',Times,serif", 'Merriweather': "Merriweather,Georgia,serif", 'Playfair Display': "'Playfair Display',Georgia,serif" };
  function fmt(v, dec) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  function lines(s) { return String(s || '').split(/\n|;/).map(function (x) { return x.trim(); }).filter(Boolean); }
  /* cores vindas dos dados (campos de cor dos componentes e data.colors dos gráficos): só valores seguros chegam ao markup.
     colOr: cor de um campo (hex, nome ou rgb[a]) ou o padrão; ucols(d): data.colors com até 6 posições, '' = cor padrão da posição */
  var COL_OK = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d.,\s%]+\))$/i, HEX6 = /^#[0-9a-f]{6}$/i;
  function colOr(v, d) { return typeof v === 'string' && COL_OK.test(v) ? v : d; }
  function ucols(d) { var c = d && d.colors; return Array.isArray(c) ? c.slice(0, 6).map(function (x) { return typeof x === 'string' && HEX6.test(x) ? x : ''; }) : []; }
  /* cor de série escolhida num elemento com “Cores do componente” (el.pal): sai como #RRGGBBFF (a mesma cor, opaca), que o recolorir
     (rt-05-pal.js) não troca — a cor escolhida aparece exatamente como foi escolhida; sem el.pal, nada muda. kcols(d, el, cols) =
     cols(d) com as posições escolhidas marcadas assim */
  function ukeep(el) { return el && el.pal && API.pal && API.pal.norm(el.pal) ? function (c) { return HEX6.test(c) ? c + 'FF' : c; } : function (c) { return c; }; }
  function kcols(d, el, cc) { var u = ucols(d), K = ukeep(el); return cc.map(function (c, k) { return u[k] ? K(c) : c; }); }
  function lumHex(c) { var m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return null; var n = parseInt(m[1], 16); return (0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; }
  /* mistura c (#rrggbb) com branco (t > 0) ou preto (t < 0); t de -1 a 1 */
  function mixHex(c, t) {
    var m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return c; var n = parseInt(m[1], 16), to = t > 0 ? 255 : 0, a = Math.abs(t);
    return '#' + [n >> 16, n >> 8 & 255, n & 255].map(function (v) { var x = Math.round(v + (to - v) * a); return (x < 16 ? '0' : '') + x.toString(16); }).join('').toUpperCase();
  }

  /* ---------- formas ---------- */
  function shapeBody(el, w, h) {
    var sw = +el.strokeW || 0, i = sw / 2, r = Math.max(0, Math.min(+el.radius || 0, w / 2, h / 2)), k;
    var a = 'fill="' + (el.fill || 'none') + '" stroke="' + (sw ? (el.stroke || 'none') : 'none') + '" stroke-width="' + sw + '"' + (el.dash ? ' stroke-dasharray="' + sw * 3 + ' ' + sw * 2 + '"' : '');
    switch (el.shape) {
      case 'round': return '<rect x="' + i + '" y="' + i + '" width="' + (w - sw) + '" height="' + (h - sw) + '" rx="' + (r || Math.min(w, h) * .12) + '" ' + a + '/>';
      case 'pill': return '<rect x="' + i + '" y="' + i + '" width="' + (w - sw) + '" height="' + (h - sw) + '" rx="' + (Math.min(w, h) / 2 - i) + '" ' + a + '/>';
      case 'ellipse': return '<ellipse cx="' + w / 2 + '" cy="' + h / 2 + '" rx="' + (w / 2 - i) + '" ry="' + (h / 2 - i) + '" ' + a + '/>';
      case 'triangle': return '<path d="M' + w / 2 + ' ' + i + 'L' + (w - i) + ' ' + (h - i) + 'L' + i + ' ' + (h - i) + 'Z" ' + a + '/>';
      case 'diamond': return '<path d="M' + w / 2 + ' ' + i + 'L' + (w - i) + ' ' + h / 2 + 'L' + w / 2 + ' ' + (h - i) + 'L' + i + ' ' + h / 2 + 'Z" ' + a + '/>';
      case 'chevron': k = Math.min(w * .3, h * .5); return '<path d="M' + i + ' ' + i + 'L' + (w - k) + ' ' + i + 'L' + (w - i) + ' ' + h / 2 + 'L' + (w - k) + ' ' + (h - i) + 'L' + i + ' ' + (h - i) + 'L' + k + ' ' + h / 2 + 'Z" ' + a + '/>';
      case 'para': k = Math.min(w * .4, h * .45); return '<path d="M' + k + ' ' + i + 'L' + (w - i) + ' ' + i + 'L' + (w - k) + ' ' + (h - i) + 'L' + i + ' ' + (h - i) + 'Z" ' + a + '/>';
      case 'arrow': k = Math.min(w * .38, h * .7); return '<path d="M' + i + ' ' + h * .28 + 'L' + (w - k) + ' ' + h * .28 + 'L' + (w - k) + ' ' + i + 'L' + (w - i) + ' ' + h / 2 + 'L' + (w - k) + ' ' + (h - i) + 'L' + (w - k) + ' ' + h * .72 + 'L' + i + ' ' + h * .72 + 'Z" ' + a + '/>';
      default: return '<rect x="' + i + '" y="' + i + '" width="' + (w - sw) + '" height="' + (h - sw) + '" rx="' + r + '" ' + a + '/>';
    }
  }
  function lineBox(el) {
    var pad = Math.max(14, (+el.strokeW || 2) * 4);
    var x = Math.min(el.x1, el.x2) - pad, y = Math.min(el.y1, el.y2) - pad;
    return { x: x, y: y, w: Math.abs(el.x2 - el.x1) + pad * 2, h: Math.abs(el.y2 - el.y1) + pad * 2 };
  }
  function lineSVG(el) {
    var b = lineBox(el), x1 = el.x1 - b.x, y1 = el.y1 - b.y, x2 = el.x2 - b.x, y2 = el.y2 - b.y, sw = +el.strokeW || 2, c = el.stroke || '#002A46';
    var ang = Math.atan2(y2 - y1, x2 - x1), s = Math.max(9, sw * 3.4), heads = '';
    function head(px, py, a) {
      var bx = px - s * Math.cos(a), by = py - s * Math.sin(a), ox = -Math.sin(a) * s * .55, oy = Math.cos(a) * s * .55;
      return '<path class="am-head" d="M' + px + ' ' + py + 'L' + (bx + ox) + ' ' + (by + oy) + 'L' + (bx - ox) + ' ' + (by - oy) + 'Z" fill="' + c + '"/>';
    }
    var sx = x1, sy = y1, ex = x2, ey = y2;
    if (el.headEnd) { heads += head(x2, y2, ang); ex = x2 - Math.cos(ang) * s * .8; ey = y2 - Math.sin(ang) * s * .8; }
    if (el.headStart) { heads += head(x1, y1, ang + Math.PI); sx = x1 + Math.cos(ang) * s * .8; sy = y1 + Math.sin(ang) * s * .8; }
    /* am-hit: traço invisível e largo que recebe o clique no editor (a caixa da linha não captura cliques) */
    var d = 'M' + sx + ' ' + sy + 'L' + ex + ' ' + ey, hit = '<svg viewBox="0 0 ' + b.w + ' ' + b.h + '"><path class="am-hit" d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + '" stroke="transparent" stroke-width="' + Math.max(14, sw + 10) + '" stroke-linecap="round" fill="none"/>';
    if (!el.dash) return hit + '<path class="am-ln" pathLength="1" d="' + d + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" fill="none"/>' + heads + '</svg>';
    /* tracejada: pathLength="1" reescala o tracejado (um traço ficava maior que a linha inteira = linha cheia). O traço visível (.am-lnd)
       fica em unidades reais; “Desenhar” anima a máscara (.am-ln). Id da máscara único por desenho (miniaturas e palco convivem) */
    var mid = nid('lm');
    return hit + '<mask id="' + mid + '" maskUnits="userSpaceOnUse" x="0" y="0" width="' + b.w + '" height="' + b.h + '"><path class="am-ln" pathLength="1" d="' + d + '" stroke="#fff" stroke-width="' + (sw + 4) + '" stroke-linecap="round" fill="none"/></mask><path class="am-lnd" d="' + d + '" stroke="' + c + '" stroke-width="' + sw + '" fill="none" stroke-dasharray="' + sw * 3 + ' ' + sw * 2.2 + '" style="--dp:' + sw * 5.2 + 'px" mask="url(#' + mid + ')"/>' + heads + '</svg>';
  }
  function textHTML(el, inShape) {
    var va = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.valign || (inShape ? 'middle' : 'top')];
    var st = ['font-family:' + fontStack(el.font, FONTS.Inter), 'font-size:' + CQ(el.size || 24), 'font-weight:' + (el.weight || 400), 'color:' + (el.color || '#002A46'), 'text-align:' + (el.align || (inShape ? 'center' : 'left')), 'line-height:' + (el.lh || 1.2), 'letter-spacing:' + (+el.ls || 0) + 'em', 'justify-content:' + va];
    if (el.italic) st.push('font-style:italic');
    if (el.upper) st.push('text-transform:uppercase');
    if (!inShape && el.bg && el.bg !== 'none') st.push('background:' + el.bg, 'padding:' + CQ(16), 'border-radius:' + CQ(+el.radius || 0));
    if (inShape) st.push('padding:' + CQ(14));
    return '<div class="am-text" style="' + st.join(';') + '"><div class="am-tx" data-ph="Digite aqui">' + (el.html || '') + '</div></div>';
  }

  /* ---------- componentes de efeito ---------- */
  var FX = {
    counter: {
      name: 'Contador KPI', cat: 'Números & dados', w: 380, h: 210, anim: { in: 'rise' },
      data: { label: 'Economia identificada', value: 4.8, decimals: 1, prefix: 'R$ ', suffix: ' mi', sub: '+18% vs ano anterior', bar: 72, style: 'dark' },
      fields: [['label', 'Rótulo'], ['value', 'Valor', 'number'], ['decimals', 'Casas decimais', 'number'], ['prefix', 'Prefixo'], ['suffix', 'Sufixo'], ['sub', 'Linha de apoio'], ['bar', 'Barra (0 a 100, 0 oculta)', 'number'], ['style', 'Estilo', 'sel:dark=Navy|light=Branco|ice=Gelo|clear=Transparente']],
      html: function (d, w, h) {
        var pre = String(d.prefix || ''), suf = String(d.suffix || ''), nt = fmt(+d.value || 0, d.decimals | 0);
        /* largura estimada: algarismos inteiros + prefixo/sufixo a 50% */
        var fs = Math.min(h * .3, w * .86 / Math.max(3, nt.length * .6 + (pre.trim().length + suf.trim().length) * .3 + (pre.trim() ? .18 : 0) + (/^\s/.test(suf) ? .18 : 0)));
        var val = (pre.trim() ? '<small class="fxc-u pre">' + esc(pre.trim()) + '</small>' : '') + '<span data-count="' + (+d.value || 0) + '" data-dec="' + (d.decimals | 0) + '">' + esc(nt) + '</span>' + (suf.trim() ? '<small class="fxc-u suf' + (/^\s/.test(suf) ? ' sp' : '') + '">' + esc(suf.trim()) + '</small>' : '');
        return '<div class="fx fxc fx-' + (d.style || 'dark') + '" style="border-radius:' + CQ(Math.min(w, h) * .06) + '"><span class="fxc-lbl" style="font-size:' + CQ(Math.max(10, h * .072)) + '">' + esc(d.label) + '</span><b class="fxc-val" style="font-size:' + CQ(fs) + '">' + val + '</b>' + (d.sub ? '<span class="fxc-sub" style="font-size:' + CQ(Math.max(10, h * .068)) + '">' + esc(d.sub) + '</span>' : '') + (+d.bar > 0 ? '<i class="fxc-bar"><i style="--w:' + Math.min(100, +d.bar) + '%"></i></i>' : '') + '</div>';
      }
    },
    progress: {
      name: 'Régua / progresso', cat: 'Números & dados', w: 460, h: 110, anim: { in: 'fade' },
      data: { label: 'Adoção pelas áreas', value: 68, target: 75, kind: 'bar', style: 'clear' },
      fields: [['label', 'Rótulo'], ['value', 'Valor (%)', 'number'], ['target', 'Meta (%) — 0 oculta', 'number'], ['kind', 'Formato', 'sel:bar=Barra|ring=Anel'], ['style', 'Estilo', 'sel:clear=Transparente|light=Branco|ice=Gelo|dark=Navy']],
      html: function (d, w, h) {
        var v = Math.max(0, Math.min(100, +d.value || 0)), t = +d.target || 0;
        if (d.kind === 'ring') {
          var fs = Math.min(w, h) * .2;
          return '<div class="fx fx-' + (d.style || 'clear') + '" style="border-radius:' + CQ(Math.min(w, h) * .06) + '"><svg viewBox="0 0 100 100" style="position:absolute;left:50%;top:6%;height:72%;transform:translateX(-50%);overflow:visible"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(127,150,180,.25)" stroke-width="9"/><circle class="fxr-ring fxr-arc" cx="50" cy="50" r="42" fill="none" stroke="#F78C16" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + (100 - v) + '"/><text x="50" y="57" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-size="22" font-weight="600" fill="currentColor">' + v + '%</text></svg><div style="position:absolute;left:0;right:0;bottom:4%;text-align:center;font-weight:600;font-size:' + CQ(Math.max(11, fs * .55)) + '">' + esc(d.label) + '</div></div>';
        }
        var f = Math.max(11, Math.min(h * .2, 22));
        return '<div class="fx fxp fx-' + (d.style || 'clear') + '" style="font-size:' + CQ(f) + ';border-radius:' + CQ(Math.min(w, h) * .08) + '"><div class="fxp-top"><span>' + esc(d.label) + '</span><b>' + v + '%</b></div><div class="fxp-track"><i class="fxp-fill" style="width:' + v + '%"></i>' + (t > 0 ? '<i class="fxp-tgt" data-l="meta ' + t + '%" style="left:' + Math.min(100, t) + '%"></i>' : '') + '</div></div>';
      }
    },
    bars: {
      name: 'Gráfico de barras', cat: 'Gráficos', model: true, kw: 'gráfico grafico barras colunas comparação ranking volume', w: 640, h: 340, anim: { in: 'fade' }, variant: 'grow',
      variants: [['grow', 'Barras crescendo', 'As barras sobem uma a uma; os destaques já nascem em laranja.'], ['highlight', 'Destaque depois', 'Todas as barras sobem em navy e, em seguida, os destaques acendem em laranja.']],
      data: { title: 'Horas liberadas por área', labels: 'Finanças, Operações, Supply, TI, RH, Comercial', values: '1240, 980, 860, 640, 520, 470', unit: ' h', highlight: '1, 2, 3', style: 'clear' },
      fields: [['title', 'Título'], ['labels', 'Categorias (separe por vírgula)'], ['values', 'Valores (separe por vírgula)'], ['unit', 'Unidade'], ['highlight', 'Destacar posições (ex.: 1, 3)'], ['style', 'Estilo', 'sel:clear=Transparente|light=Branco|ice=Gelo|dark=Navy'], ['colors', 'Cores', 'colors:2', ['Barras', 'Destaque']]],
      cols: function (d) { var c = ucols(d); return [c[0] || (d.style === 'dark' ? '#7EA1C3' : '#002A46'), c[1] || '#F78C16']; },
      html: function (d, w, h, el) {
        var cc = kcols(d, el, FX.bars.cols(d)), labs = String(d.labels || '').split(',').map(function (s) { return s.trim(); }), vals = String(d.values || '').split(',').map(function (s) { return parseFloat(s) || 0; });
        var n = Math.max(1, Math.min(labs.length, vals.length)), mx = Math.max.apply(null, vals.slice(0, n).concat([1])), hl = String(d.highlight || '').split(',').map(function (s) { return parseInt(s, 10); });
        var dark = d.style === 'dark', top = d.title ? h * .17 : h * .06, bot = h * .13, ch = h - top - bot, gap = w / n, bw = gap * .58, fs = Math.max(10, Math.min(h * .05, gap * .2)), out = '';
        for (var k = 0; k < n; k++) {
          var bh = Math.max(2, vals[k] / mx * ch * .88), x = gap * k + (gap - bw) / 2, y = top + ch - bh, on = hl.indexOf(k + 1) >= 0;
          out += '<rect class="fxb-bar' + (on ? ' hl' : '') + '" style="--i:' + k + (on ? ';--bc:' + cc[0] : '') + '" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="' + Math.min(4, bw * .08) + '" fill="' + (on ? cc[1] : cc[0]) + '"/>';
          out += '<text class="fxb-v" style="--i:' + k + '" x="' + (x + bw / 2) + '" y="' + (y - fs * .6) + '" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-weight="600" font-size="' + fs + '" fill="' + (dark ? '#fff' : '#002A46') + '">' + esc(fmt(vals[k], vals[k] % 1 ? 1 : 0) + (d.unit || '')) + '</text>';
          out += '<text x="' + (x + bw / 2) + '" y="' + (h - bot * .3) + '" text-anchor="middle" font-family="Roboto Condensed,Arial,sans-serif" font-weight="700" font-size="' + fs * 1.05 + '" fill="' + (dark ? '#C9D6E8' : '#3E4C5E') + '">' + esc(labs[k]) + '</text>';
        }
        out += '<line x1="0" x2="' + w + '" y1="' + (top + ch) + '" y2="' + (top + ch) + '" stroke="' + (dark ? 'rgba(255,255,255,.3)' : '#CBD4E1') + '"/>';
        var title = d.title ? '<text x="0" y="' + h * .08 + '" font-family="Roboto Condensed,Arial,sans-serif" font-weight="700" font-size="' + Math.max(12, h * .065) + '" fill="' + (dark ? '#fff' : '#002A46') + '">' + esc(d.title) + '</text>' : '';
        return '<div class="fx fxv-' + ((el && el.variant) || 'grow') + ' fx-' + (d.style || 'clear') + '" style="border-radius:' + CQ(Math.min(w, h) * .04) + ';overflow:visible"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="position:absolute;inset:' + (d.style === 'clear' ? '0' : '6%') + ';width:' + (d.style === 'clear' ? '100%' : '88%') + ';height:' + (d.style === 'clear' ? '100%' : '88%') + ';overflow:visible">' + title + out + '</svg></div>';
      }
    },
    timeline: {
      name: 'Linha do tempo', cat: 'Evolução', model: true, kw: 'linha do tempo timeline roadmap cronograma marcos ondas fases', w: 960, h: 210, anim: { in: 'fade' }, variant: 'draw',
      variants: [['draw', 'Linha desenhando', 'A linha é traçada e os marcos surgem em sequência.'], ['steps', 'Marco a marco', 'Na apresentação, o destaque avança de marco em marco.'], ['progress', 'Até o marco atual', 'A linha preenche até o marco atual, que pulsa; os próximos ficam em cinza.']],
      data: { items: '2026 T1 | Diagnóstico\n2026 T2 | Desenho\n2026 T4 | Implementação\n2027 | Escala', current: 2, style: 'clear', tcolor: '#002A46' },
      fields: [['items', 'Marcos (um por linha: data | texto)', 'area'], ['current', 'Marco atual (para “Até o marco atual”)', 'number'], ['tcolor', 'Cor do texto', 'sel:#002A46=Navy|#FFFFFF=Branco'], ['style', 'Fundo', 'sel:clear=Transparente|light=Branco|ice=Gelo|dark=Navy']],
      html: function (d, w, h, el) {
        var v = (el && el.variant) || 'draw', it = lines(d.items).map(function (s) { var p = s.split('|'); return { a: (p[0] || '').trim(), b: (p[1] || '').trim() }; }), n = Math.max(1, it.length), y = h * .34, x0 = w * .06, x1 = w * .94, fs = Math.max(11, Math.min(h * .1, (x1 - x0) / n * .11)), col = colOr(d.tcolor, '#002A46'), cur = Math.max(1, Math.min(n, Math.round(+d.current || 1))) - 1;
        function X(k) { return n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * k / (n - 1); }
        var sw = Math.max(2, h * .016), svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><line class="fxt-line" pathLength="1" x1="' + x0 + '" y1="' + y + '" x2="' + x1 + '" y2="' + y + '" stroke="' + (v === 'progress' ? '#CBD4E1' : '#7EA1C3') + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
        if (v === 'progress') svg += '<line class="fxt-prog" pathLength="1" x1="' + x0 + '" y1="' + y + '" x2="' + X(cur) + '" y2="' + y + '" stroke="#002A46" stroke-width="' + sw * 1.4 + '" stroke-linecap="round"/>';
        var labs = '';
        it.forEach(function (o, k) {
          var x = X(k), r = Math.max(6, h * .055), fill = v === 'progress' ? (k < cur ? '#002A46' : k === cur ? '#F78C16' : '#CBD4E1') : (k === n - 1 ? '#F78C16' : '#002A46');
          svg += '<circle class="fxt-node' + (v === 'progress' && k === cur ? ' cur' : '') + '" data-g="' + k + '" style="--i:' + k + '" cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" stroke="#fff" stroke-width="' + r * .45 + '"/>';
          labs += '<div class="fxt-lab' + (v === 'progress' && k > cur ? ' fut' : '') + (/^#fff(fff)?$/i.test(col) || lumHex(col) > .6 ? ' on-dark' : '') + '" data-g="' + k + '" style="--i:' + k + ';left:' + P(x, w) + ';top:' + P(y + h * .12, h) + ';width:' + P((x1 - x0) / n * .95, w) + ';font-size:' + CQ(fs) + ';color:' + col + '"><b>' + esc(o.a) + '</b>' + esc(o.b) + '</div>';
        });
        return '<div class="fx fxtl fxv-' + v + ' fx-' + (d.style || 'clear') + '"' + (v === 'steps' ? ' data-cycle="g"' : '') + ' style="overflow:visible;border-radius:' + CQ(Math.min(w, h) * .06) + '">' + svg + '</svg>' + labs + '</div>';
      }
    },
    process: {
      name: 'Fluxo de etapas', cat: 'Evolução', model: true, kw: 'fluxo processo etapas fases chevron jornada metodologia passos', w: 960, h: 120, anim: { in: 'fade' }, variant: 'cycle',
      variants: [['cycle', 'Destaque percorrendo', 'As etapas entram e o destaque passa de uma etapa à outra.'], ['cascade', 'Cascata', 'As etapas entram em sequência, da esquerda para a direita.'], ['final', 'Destino em evidência', 'A última etapa pulsa, reforçando onde o processo quer chegar.']],
      data: { steps: 'Diagnóstico\nDesenho\nImplementação\nSustentação' },
      fields: [['steps', 'Etapas (uma por linha)', 'area']],
      html: function (d, w, h, el) {
        var v = (el && el.variant) || (d.cycle === 'nao' ? 'cascade' : 'cycle'), st = lines(d.steps), n = Math.max(1, st.length), fs = Math.max(11, Math.min(h * .2, w / n * .1));
        return '<div class="fx fxs fxv-' + v + '" data-cycle="' + (v === 'cycle' ? '1' : '0') + '" style="font-size:' + CQ(fs) + '">' + st.map(function (s, k) { return '<div class="fxs-step' + (k === n - 1 ? ' hl' : '') + '" style="--i:' + k + '">' + esc(s) + '</div>'; }).join('') + '</div>';
      }
    },
    beacon: {
      name: 'Ponto de atenção (pulso)', cat: 'Destaques', w: 360, h: 80, anim: { in: 'zoom' },
      data: { title: 'Ponto de atenção', text: 'Aprovação pendente do comitê', tcolor: '#002A46' },
      fields: [['title', 'Título'], ['text', 'Texto'], ['tcolor', 'Cor do texto', 'sel:#002A46=Navy|#FFFFFF=Branco']],
      html: function (d, w, h) {
        var fs = Math.max(11, Math.min(h * .24, 22));
        return '<div class="fx fxbe" style="overflow:visible;color:' + colOr(d.tcolor, '#002A46') + ';font-size:' + CQ(fs) + '"><span class="fxbe-dot" style="margin-left:' + CQ(h * .46 * .6) + '"></span><div class="fxbe-txt"><b>' + esc(d.title) + '</b>' + esc(d.text) + '</div></div>';
      }
    },
    headline: {
      name: 'Título animado (palavra a palavra)', cat: 'Destaques', w: 900, h: 160, anim: { in: 'none' },
      data: { text: 'Do conteúdo à experiência', hl: 'experiência', size: 60, color: '#002A46', font: 'Roboto', weight: 300 },
      fields: [['text', 'Frase'], ['hl', 'Palavra em destaque (laranja)'], ['size', 'Tamanho', 'number'], ['color', 'Cor', 'sel:#002A46=Navy|#FFFFFF=Branco'], ['font', 'Fonte', 'sel:Roboto=Roboto|Roboto Condensed=Roboto Condensed|Inter=Inter'], ['weight', 'Peso', 'sel:300=Leve|400=Regular|700=Negrito']],
      html: function (d) {
        var ws = String(d.text || '').split(/\s+/).filter(Boolean), hl = String(d.hl || '').toLowerCase().replace(/[^\wÀ-ú]/g, ''), n = -1;
        var out = ws.map(function (wd, k) { var on = hl && wd.toLowerCase().replace(/[^\wÀ-ú]/g, '') === hl; if (on && n < 0) n = k; return '<span class="fxhl-w' + (on ? ' fxhl-hl' : '') + '" style="--i:' + k + '">' + esc(wd) + '</span>'; }).join(' ');
        return '<div class="fx fxhl" style="--n:' + Math.max(0, n) + ';font-family:' + fontStack(d.font, FONTS.Roboto) + ';font-weight:' + (d.weight || 300) + ';font-size:' + CQ(+d.size || 60) + ';line-height:1.08;letter-spacing:-.02em;color:' + colOr(d.color, '#002A46') + '"><div>' + out + '</div></div>';
      }
    },
    card: {
      name: 'Card', cat: 'Cards', w: 340, h: 220, anim: { in: 'rise', hover: 'lift' },
      data: { tag: 'Iniciativa', title: 'Torre de Controle', text: 'Painel único de status das iniciativas, com semáforo de prazo, orçamento e adoção.', style: 'light' },
      fields: [['tag', 'Etiqueta'], ['title', 'Título'], ['text', 'Texto', 'area'], ['style', 'Estilo', 'sel:light=Branco|ice=Gelo|dark=Navy']],
      html: function (d, w, h) {
        var f = Math.max(11, Math.min(w * .05, h * .085));
        return '<div class="fx fxcd fx-' + (d.style || 'light') + '" style="font-size:' + CQ(f) + '"><i class="fxcd-acc"></i>' + (d.tag ? '<span class="fxcd-tag" style="font-size:.72em">' + esc(d.tag) + '</span>' : '') + '<b class="fxcd-tt" style="font-size:1.35em">' + esc(d.title) + '</b><span class="fxcd-tx">' + esc(d.text) + '</span></div>';
      }
    },
    holo: {
      name: 'Card holográfico 3D', cat: 'Cards', w: 420, h: 260, anim: { in: 'zoom', hover: 'tilt' },
      data: { eyebrow: 'Comunidade · Dados & IA', title: 'Data & AI Community', text: '128 membros · 14 squads · 6 aceleradores' },
      fields: [['eyebrow', 'Etiqueta'], ['title', 'Título'], ['text', 'Texto', 'area']],
      html: function (d, w, h) {
        var f = Math.max(10, Math.min(w * .045, h * .07));
        return '<div class="fx fxh fx-dark" style="font-size:' + CQ(f) + '"><span class="fxh-dot"></span><span class="fxh-eye" style="font-size:.75em">' + esc(d.eyebrow) + '</span><b class="fxh-tt" style="font-size:2em">' + esc(d.title) + '</b><span class="fxh-tx">' + esc(d.text) + '</span></div>';
      }
    },
    glass: {
      name: 'Card de vidro', cat: 'Cards', w: 380, h: 200, anim: { in: 'focus' },
      data: { title: 'Visão 2027', text: 'Um portfólio único, com dados confiáveis e decisões em tempo real.' },
      fields: [['title', 'Título'], ['text', 'Texto', 'area']],
      html: function (d, w, h) {
        var f = Math.max(11, Math.min(w * .05, h * .09));
        return '<div class="fx fxg" style="font-size:' + CQ(f) + '"><b style="font-size:1.5em">' + esc(d.title) + '</b><span style="line-height:1.4;opacity:.92">' + esc(d.text) + '</span></div>';
      }
    },
    quote: {
      name: 'Citação / mensagem-chave', cat: 'Cards', w: 900, h: 90, anim: { in: 'wipe' },
      data: { text: '“Sem uma função dedicada de Gestão de Mudanças, o resultado depende de sorte — não de método.”', style: 'dark' },
      fields: [['text', 'Mensagem', 'area'], ['style', 'Estilo', 'sel:dark=Navy|ice=Gelo|light=Branco']],
      html: function (d, w, h) {
        var f = Math.max(12, Math.min(h * .24, 24));
        return '<div class="fx fxq fx-' + (d.style || 'dark') + '" style="font-size:' + CQ(f) + '"><i class="fxq-bar"></i><i>' + esc(d.text) + '</i></div>';
      }
    },
    amlines: {
      name: 'Linhas A&M', cat: 'Marca A&M', w: 520, h: 720, anim: { in: 'draw', dur: 1600 },
      data: { c1: '#F78C16', c2: '#3D5A74' },
      fields: [['c1', 'Cor da linha fina', 'sel:#F78C16=Laranja|#FFFFFF=Branco|#7EA1C3=Steel'], ['c2', 'Cor das linhas largas', 'sel:#3D5A74=Steel escuro|#7EA1C3=Steel|#DFE8F0=Gelo']],
      html: function (d, w, h) {
        var c1 = colOr(d.c1, '#F78C16'), c2 = colOr(d.c2, '#3D5A74'), u = Math.min(w, h) / 100;
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="overflow:hidden"><path class="am-ln" pathLength="1" d="M' + w * .02 + ' ' + h + 'L' + w * .46 + ' ' + h * .35 + 'L' + w * .46 + ' ' + h + '" fill="none" stroke="' + c1 + '" stroke-width="' + Math.max(1.6, u * .45) + '"/><path class="am-ln" pathLength="1" d="M' + w * .26 + ' ' + h + 'L' + w * .86 + ' ' + h * .14 + 'L' + w * .86 + ' ' + h + '" fill="none" stroke="' + c2 + '" stroke-width="' + Math.max(4, u * 1.9) + '" stroke-linecap="round"/><path class="am-ln" pathLength="1" d="M' + w * .54 + ' ' + h + 'L' + w * 1.15 + ' ' + h * .05 + '" fill="none" stroke="' + c2 + '" stroke-width="' + Math.max(7, u * 3.4) + '"/></svg>';
      }
    }
  };

  /* ===================== MODELOS (com efeitos próprios) ===================== */
  function E(path, txt, cls) { return '<span class="' + (cls || '') + '" data-e="' + path + '">' + esc(txt) + '</span>'; }
  function arr(v) { return Array.isArray(v) ? v : lines(v); }
  function VV(el, k) { return (el && el.variant) || FX[k].variant; }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }
  var M = {};
  M.raci = {
    name: 'Matriz RACI', cat: 'Matrizes', model: true, kw: 'raci matriz responsabilidade papeis papéis responsavel aprovador consultado informado governança', w: 1000, h: 430, variant: 'cascade',
    variants: [['cascade', 'Linhas em cascata', 'Cada atividade entra em sequência e as letras aparecem logo depois.'], ['columns', 'Papel por papel', 'As colunas de cada papel são reveladas uma a uma.'], ['accountable', 'Destaque do “A”', 'Os responsáveis finais (A) pulsam em laranja; os demais recuam.'], ['focus', 'Foco percorrendo os papéis', 'Na apresentação, o destaque passa de papel em papel.']],
    data: { roles: ['Sponsor', 'PMO', 'Squad', 'Negócio', 'TI'], rows: [{ t: 'Definir escopo e metas', v: ['A', 'R', 'C', 'C', 'I'] }, { t: 'Priorizar o portfólio', v: ['A', 'R', 'I', 'C', 'C'] }, { t: 'Desenhar a solução', v: ['I', 'C', 'R', 'A', 'C'] }, { t: 'Implementar e testar', v: ['I', 'C', 'R', 'C', 'A'] }, { t: 'Gestão da mudança', v: ['A', 'C', 'C', 'R', 'I'] }], legend: 'sim' },
    fields: [['roles', 'Papéis (um por linha)', 'lines'], ['rows', 'Atividades (atividade | letra de cada papel)', 'rows:t|*v'], ['legend', 'Legenda', 'sel:sim=Mostrar|nao=Ocultar']],
    tip: 'Clique numa letra para trocar (R → A → C → I → –). Duplo clique num nome para editar.',
    html: function (d, w, h, el) {
      var v = VV(el, 'raci'), roles = arr(d.roles), rows = d.rows || [], m = Math.max(1, roles.length), n = Math.max(1, rows.length), leg = d.legend !== 'nao';
      var fs = Math.max(9, Math.min(h / (n + 1.2 + (leg ? .8 : 0)) * .3, w / (m + 2.6) * .14));
      var g = '<div class="fx fxraci fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + ';grid-template-columns:2.6fr repeat(' + m + ',1fr);grid-template-rows:1.15fr repeat(' + n + ',1fr)' + (leg ? ' .75fr' : '') + '"><div></div>';
      roles.forEach(function (r, k) { g += '<div class="raci-h" data-g="' + k + '" style="--g:' + k + '">' + E('roles.' + k, r) + '</div>'; });
      rows.forEach(function (row, i) {
        g += '<div class="raci-t" style="--r:' + i + '">' + E('rows.' + i + '.t', row.t) + '</div>';
        for (var k = 0; k < m; k++) {
          var c = String((row.v || [])[k] || '-').trim().toUpperCase().charAt(0); if ('RACI'.indexOf(c) < 0 || !c) c = '-';
          g += '<div class="raci-c" data-g="' + k + '" style="--r:' + i + ';--g:' + k + '"><b class="raci-b b-' + (c === '-' ? 'x' : c) + '" data-cyc="rows.' + i + '.v.' + k + '">' + (c === '-' ? '–' : c) + '</b></div>';
        }
      });
      if (leg) g += '<div class="raci-leg" style="grid-column:1/-1"><span><b class="raci-b b-R">R</b>Responsável (executa)</span><span><b class="raci-b b-A">A</b>Aprova e responde</span><span><b class="raci-b b-C">C</b>Consultado</span><span><b class="raci-b b-I">I</b>Informado</span></div>';
      return g + '</div>';
    }
  };
  M.riskmap = {
    name: 'Mapa de riscos', cat: 'Riscos', model: true, kw: 'risco riscos mapa calor heatmap probabilidade impacto severidade matriz', w: 960, h: 480, variant: 'heat',
    variants: [['heat', 'Calor por severidade', 'As células acendem das menos às mais críticas; depois os riscos entram.'], ['drop', 'Riscos pousando', 'Cada risco cai na sua posição, um a um, junto da legenda.'], ['critical', 'Alerta nos críticos', 'Riscos na zona crítica pulsam com anel de alerta.'], ['scan', 'Varredura de calor', 'Uma onda de luz percorre a matriz do baixo ao alto risco.']],
    data: { xlab: 'Impacto', ylab: 'Probabilidade', risks: [{ t: 'Atraso na migração de dados', p: 4, i: 5 }, { t: 'Baixa adoção pelas áreas', p: 4, i: 4 }, { t: 'Estouro de orçamento', p: 2, i: 4 }, { t: 'Dependência de fornecedor', p: 3, i: 3 }, { t: 'Rotatividade do time', p: 2, i: 2 }] },
    fields: [['risks', 'Riscos (nome | probabilidade 1–5 | impacto 1–5)', 'rows:t|p:n|i:n'], ['xlab', 'Eixo horizontal'], ['ylab', 'Eixo vertical']],
    tip: 'Ajuste probabilidade e impacto de cada risco no campo “Riscos”. Duplo clique no nome para editar.',
    html: function (d, w, h, el) {
      var v = VV(el, 'riskmap'), rs = d.risks || [], fs = Math.max(9, Math.min(h * .042, w * .022));
      function lv(s) { return s <= 4 ? 1 : s <= 9 ? 2 : s <= 14 ? 3 : 4; }
      var LV = ['', 'Baixo', 'Moderado', 'Alto', 'Crítico'], cells = [], o = '';
      for (var p = 5; p >= 1; p--) for (var i = 1; i <= 5; i++) cells.push({ p: p, i: i, s: p * i });
      var order = cells.slice().sort(function (a, b) { return a.s - b.s; });
      cells.forEach(function (c) { var r = 5 - c.p, k = order.indexOf(c); o += '<div class="rk-cell lv' + lv(c.s) + '" style="left:' + (c.i - 1) * 20 + '%;top:' + r * 20 + '%;--k:' + k + ';--q:' + ((c.p - 1) + (c.i - 1)) + '"></div>'; });
      var seen = {}, bubs = '', legs = '';
      rs.forEach(function (r, j) {
        var p = Math.max(1, Math.min(5, Math.round(num(r.p)))), i = Math.max(1, Math.min(5, Math.round(num(r.i)))), key = p + '-' + i, nth = seen[key] = (seen[key] || 0) + 1, s = p * i;
        var ox = [0, 0, -5, 5, -5, 5][nth] || 0, oy = [0, 0, -4, 4, 4, -4][nth] || 0; if (nth === 2) { ox = 5; oy = 0; }
        bubs += '<div class="rk-bub' + (s >= 15 ? ' crit' : '') + '" data-g="' + j + '" style="left:' + ((i - .5) * 20 + ox) + '%;top:' + ((5 - p + .5) * 20 + oy) + '%;--n:' + j + '">' + (j + 1) + '</div>';
        legs += '<div class="rk-li" data-g="' + j + '" style="--n:' + j + '"><b>' + (j + 1) + '</b>' + E('risks.' + j + '.t', r.t) + '<i class="lv' + lv(s) + '">' + LV[lv(s)] + '</i></div>';
      });
      return '<div class="fx fxrisk fxv-' + v + '" style="font-size:' + CQ(fs) + '"><div class="rk-plot">' + o + bubs + '</div><div class="rk-y">' + E('ylab', d.ylab) + ' →</div><div class="rk-x">' + E('xlab', d.xlab) + ' →</div><div class="rk-leg">' + legs + '</div></div>';
    }
  };
  M.swot = {
    name: 'Matriz SWOT', cat: 'Matrizes', model: true, kw: 'swot fofa forças fraquezas oportunidades ameaças diagnóstico estratégia matriz', w: 980, h: 470, variant: 'quadrants',
    variants: [['quadrants', 'Quadrante a quadrante', 'Forças, Fraquezas, Oportunidades e Ameaças entram em sequência.'], ['flip', 'Virada 3D', 'Cada quadrante gira para dentro, como um card.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de um quadrante ao outro.'], ['items', 'Tópicos em cascata', 'Os quadrantes surgem e os tópicos entram um a um.']],
    data: { s: ['Equipe experiente e engajada', 'Marca reconhecida no mercado'], w: ['Processos manuais e lentos', 'Dados dispersos entre áreas'], o: ['IA generativa nos processos', 'Novos canais digitais'], t: ['Concorrentes mais ágeis', 'Mudanças regulatórias'] },
    fields: [['s', 'Forças (uma por linha)', 'lines'], ['w', 'Fraquezas (uma por linha)', 'lines'], ['o', 'Oportunidades (uma por linha)', 'lines'], ['t', 'Ameaças (uma por linha)', 'lines']],
    tip: 'Duplo clique num tópico para editar no próprio slide.',
    html: function (d, w, h, el) {
      var v = VV(el, 'swot'), fs = Math.max(9, Math.min(h * .04, w * .019)), Q = [['s', 'Forças', 'S'], ['w', 'Fraquezas', 'W'], ['o', 'Oportunidades', 'O'], ['t', 'Ameaças', 'T']];
      return '<div class="fx fxswot fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + '">' + Q.map(function (q, g) {
        return '<div class="sw-q sw-' + q[0] + '" data-g="' + g + '" style="--g:' + g + '"><b class="sw-l">' + q[2] + '</b><div class="sw-h">' + q[1] + '</div><ul>' + arr(d[q[0]]).map(function (it, i) { return '<li style="--i:' + i + '">' + E(q[0] + '.' + i, it) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</div>';
    }
  };
  M.matrix = {
    name: 'Matriz de priorização (2×2)', cat: 'Matrizes', model: true, kw: 'matriz priorização priorizacao 2x2 impacto esforço quick wins quadrante portfólio', w: 900, h: 500, variant: 'bubbles',
    variants: [['bubbles', 'Iniciativas pousando', 'Os quadrantes surgem e as iniciativas caem nas suas posições.'], ['quadrants', 'Quadrante a quadrante', 'Cada quadrante entra com as suas iniciativas.'], ['quickwins', 'Destaque dos quick wins', 'Depois da entrada, o quadrante de quick wins brilha e o resto recua.'], ['axis', 'Eixos desenhando', 'Os eixos se desenham a partir da origem e depois entram os itens.']],
    data: { xlab: 'Esforço', ylab: 'Impacto', q: ['Quick wins', 'Projetos estratégicos', 'Baixa prioridade', 'Evitar'], items: [{ t: 'Automação do intake', x: 22, y: 80 }, { t: 'Torre de Controle', x: 72, y: 84 }, { t: 'Catálogo de Skills', x: 34, y: 62 }, { t: 'Migração Cloud', x: 82, y: 64 }, { t: 'Relatórios manuais', x: 70, y: 22 }, { t: 'Templates de status', x: 22, y: 30 }] },
    fields: [['items', 'Iniciativas (nome | esforço 0–100 | impacto 0–100)', 'rows:t|x:n|y:n'], ['q', 'Nome dos quadrantes (4 linhas: sup. esq., sup. dir., inf. esq., inf. dir.)', 'lines'], ['xlab', 'Eixo horizontal'], ['ylab', 'Eixo vertical']],
    tip: 'Posicione cada iniciativa com esforço e impacto de 0 a 100. Duplo clique nos nomes para editar.',
    html: function (d, w, h, el) {
      var v = VV(el, 'matrix'), q = arr(d.q), fs = Math.max(9, Math.min(h * .036, w * .02)), o = '';
      [0, 1, 2, 3].forEach(function (g) { o += '<div class="mx-q mx-q' + g + '" data-g="' + g + '" style="--g:' + g + '">' + E('q.' + g, q[g] || '') + '</div>'; });
      o += '<svg class="mx-ax" viewBox="0 0 100 100" preserveAspectRatio="none"><path class="mx-axl" pathLength="1" d="M0 100L0 0"/><path class="mx-axl" pathLength="1" d="M0 100L100 100"/></svg>';
      (d.items || []).forEach(function (it, k) {
        var x = Math.max(2, Math.min(98, num(it.x))), y = Math.max(2, Math.min(98, num(it.y))), g = (y >= 50 ? 0 : 2) + (x >= 50 ? 1 : 0);
        o += '<div class="mx-it mx-c' + g + '" data-g="' + g + '" style="left:' + x + '%;top:' + (100 - y) + '%;--n:' + k + ';--g:' + g + '"><i></i>' + E('items.' + k + '.t', it.t) + '</div>';
      });
      return '<div class="fx fxmx fxv-' + v + '" style="font-size:' + CQ(fs) + '"><div class="mx-plot">' + o + '</div><div class="mx-y">' + E('ylab', d.ylab) + ' →</div><div class="mx-x">' + E('xlab', d.xlab) + ' →</div></div>';
    }
  };
  M.cardgrid = {
    name: 'Grade de cards', cat: 'Cards', model: true, kw: 'cards grade pilares frentes etapas blocos serviços portfólio', w: 1100, h: 300, variant: 'stagger',
    variants: [['stagger', 'Cascata', 'Os cards sobem um após o outro.'], ['flip', 'Virada 3D', 'Cada card gira para dentro em sequência.'], ['spotlight', 'Holofote percorrendo', 'Na apresentação, o destaque passa de card em card.'], ['number', 'Número primeiro', 'O número de cada card aparece antes do texto, dando ritmo à leitura.']],
    data: { cards: [{ tag: '01', t: 'Diagnóstico', x: 'Entendimento do AS-IS, dores e oportunidades.' }, { tag: '02', t: 'Desenho', x: 'Modelo TO-BE, governança e plano de transição.' }, { tag: '03', t: 'Implementação', x: 'Squads, sprints e gestão da mudança.' }, { tag: '04', t: 'Sustentação', x: 'Indicadores, rituais e melhoria contínua.' }], style: 'light' },
    fields: [['cards', 'Cards (número | título | texto)', 'rows:tag|t|x'], ['style', 'Estilo', 'sel:light=Branco|ice=Gelo|dark=Navy']],
    tip: 'Duplo clique em qualquer texto do card para editar no próprio slide.',
    html: function (d, w, h, el) {
      var v = VV(el, 'cardgrid'), cs = d.cards || [], n = Math.max(1, cs.length), fs = Math.max(9, Math.min(h * .058, w / n * .07));
      return '<div class="fx fxcg fxv-' + v + '"' + (v === 'spotlight' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + '">' + cs.map(function (c, g) {
        return '<div class="cg-card fx-' + (d.style || 'light') + '" data-g="' + g + '" style="--g:' + g + '"><b class="cg-n">' + E('cards.' + g + '.tag', c.tag) + '</b><b class="cg-t">' + E('cards.' + g + '.t', c.t) + '</b><span class="cg-x">' + E('cards.' + g + '.x', c.x) + '</span></div>';
      }).join('') + '</div>';
    }
  };
  M.maturity = {
    name: 'Régua de evolução / maturidade', cat: 'Evolução', model: true, kw: 'régua regua maturidade evolução evolucao nível adoção meta escala termometro progresso', w: 980, h: 220, variant: 'fill',
    variants: [['fill', 'Preenchimento', 'A régua preenche até o nível atual; a meta aparece em laranja.'], ['steps', 'Nível a nível', 'Cada nível acende em sequência até o atual.'], ['marker', 'Marcador deslizando', 'O marcador percorre a régua enquanto o número conta.'], ['compare', 'Antes × agora', 'Mostra o ponto de partida e a evolução até o nível atual.']],
    data: { label: 'Maturidade digital', levels: ['Inicial', 'Repetível', 'Definido', 'Gerenciado', 'Otimizado'], current: 2.7, prev: 1.8, target: 4 },
    fields: [['label', 'Título'], ['current', 'Nível atual (0 a nº de níveis)', 'number'], ['prev', 'Ponto de partida (para “Antes × agora”)', 'number'], ['target', 'Meta (0 oculta)', 'number'], ['levels', 'Níveis (um por linha)', 'lines']],
    tip: 'Duplo clique no título ou nos níveis para editar no slide.',
    html: function (d, w, h, el) {
      var v = VV(el, 'maturity'), lv = arr(d.levels), n = Math.max(1, lv.length), c = Math.max(0, Math.min(n, num(d.current))), p = Math.max(0, Math.min(n, num(d.prev))), t = num(d.target), fs = Math.max(9, Math.min(h * .085, w * .02));
      var pc = c / n * 100, pp = p / n * 100, segs = lv.map(function (l, k) { var f = Math.max(0, Math.min(1, c - k)); return '<div class="mt-seg' + (f >= .5 ? ' mt-on' : '') + '" style="--k:' + k + ';--f:' + f + '"><i></i>' + E('levels.' + k, l) + '</div>'; }).join('');
      var dv = v === 'compare' ? '<em class="mt-delta">+' + fmtN(c - p) + '</em>' : '';
      return '<div class="fx fxmt fxv-' + v + '" style="font-size:' + CQ(fs) + ';--pc:' + pc + '%;--pp:' + pp + '%"><div class="mt-top">' + E('label', d.label, 'mt-lbl') + '<b class="mt-val"><span' + (v === 'marker' || v === 'compare' ? ' data-count="' + c + '" data-dec="1" data-from="' + (v === 'compare' ? p : 0) + '"' : '') + '>' + fmtN(c) + '</span><small> de ' + n + '</small>' + dv + '</b></div><div class="mt-track">' + segs + '<div class="mt-fill"></div>' + (v === 'compare' ? '<div class="mt-mk mt-prev" style="left:' + pp + '%"><span>Antes ' + fmtN(p) + '</span></div>' : '') + '<div class="mt-mk mt-cur" style="left:' + pc + '%"><span>Atual ' + fmtN(c) + '</span></div>' + (t > 0 ? '<div class="mt-tg" style="left:' + Math.min(100, t / n * 100) + '%"><span>Meta ' + fmtN(t) + '</span></div>' : '') + '</div></div>';
    }
  };
  function fmtN(v) { return fmt(v, Math.abs(v % 1) > .001 ? 1 : 0); }
  M.linechart = {
    name: 'Gráfico de evolução (linha)', cat: 'Gráficos', model: true, kw: 'gráfico grafico linha evolução evolucao tendência série histórico curva adoção', w: 800, h: 360, variant: 'draw',
    variants: [['draw', 'Linha desenhando', 'A linha é traçada da esquerda para a direita.'], ['points', 'Ponto a ponto', 'Cada ponto surge com seu valor no ritmo da linha.'], ['area', 'Área subindo', 'A área sobe da base e a linha aparece por cima.'], ['last', 'Destaque do último ponto', 'O último valor pulsa, chamando atenção para o resultado atual.']],
    data: { title: 'Evolução da adoção (%)', labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'], values: [12, 18, 27, 35, 48, 62], target: 60, unit: '%' },
    fields: [['title', 'Título'], ['labels', 'Rótulos do eixo (um por linha)', 'lines'], ['values', 'Valores (um por linha)', 'lines'], ['unit', 'Unidade'], ['target', 'Meta (0 oculta)', 'number'], ['colors', 'Cores', 'colors:2', ['Linha e pontos', 'Último ponto']]],
    cols: function (d) { var c = ucols(d); return [c[0] || '#002A46', c[1] || '#F78C16']; },
    html: function (d, w, h, el) {
      var cu = ucols(d), c0 = M.linechart.cols(d), cc = kcols(d, el, c0), lastT = lumHex(c0[1]) > .75 ? '#002A46' : cc[1], v = VV(el, 'linechart'), lb = arr(d.labels), vs = arr(d.values).map(num), n = Math.max(2, Math.min(lb.length, vs.length)), t = num(d.target);
      var mx = Math.max.apply(null, vs.slice(0, n).concat([t, 1])) * 1.15, top = d.title ? h * .16 : h * .06, bot = h * .12, L = w * .04, R = w * .96, ch = h - top - bot, fs = Math.max(10, h * .045);
      function X(k) { return L + (R - L) * k / (n - 1); } function Y(val) { return top + ch - val / mx * ch; }
      var pts = vs.slice(0, n).map(function (val, k) { return [X(k), Y(val)]; }), dl = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L');
      var o = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + (d.title ? '<text x="0" y="' + h * .08 + '" font-family="Roboto Condensed,Arial" font-weight="700" font-size="' + Math.max(12, h * .06) + '" fill="#002A46">' + esc(d.title) + '</text>' : '');
      [0, .5, 1].forEach(function (f) { o += '<line x1="' + L + '" x2="' + R + '" y1="' + (top + ch * f) + '" y2="' + (top + ch * f) + '" stroke="#E2E7EF"/>'; });
      if (t > 0) o += '<line x1="' + L + '" x2="' + R + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="#F78C16" stroke-dasharray="6 5" stroke-width="1.5"/><text x="' + R + '" y="' + (Y(t) - 6) + '" text-anchor="end" font-family="Roboto,Arial,sans-serif" font-size="' + fs * .9 + '" fill="#43698F">meta ' + fmtN(t) + (d.unit || '') + '</text>';
      o += '<path class="lc-area" d="' + dl + 'L' + X(n - 1) + ' ' + (top + ch) + 'L' + L + ' ' + (top + ch) + 'Z" fill="' + (cu[0] ? cc[0] + '" fill-opacity=".14' : 'rgba(74,111,165,.14)') + '"/><path class="lc-line" pathLength="1" d="' + dl + '" fill="none" stroke="' + cc[0] + '" stroke-width="' + Math.max(2.5, h * .009) + '" stroke-linecap="round" stroke-linejoin="round"/>';
      pts.forEach(function (p, k) { var last = k === n - 1; o += '<g class="lc-pt' + (last ? ' last' : '') + '" style="--k:' + k + ';--kn:' + (k / (n - 1)) + '"><circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + Math.max(4, h * .014) * (last ? 1.35 : 1) + '" fill="' + (last ? cc[1] : cc[0]) + '" stroke="#fff" stroke-width="2"/><text x="' + p[0] + '" y="' + (p[1] - fs * .9) + '" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-weight="600" font-size="' + fs * (last ? 1.15 : .9) + '" fill="' + (last ? lastT : '#002A46') + '">' + esc(fmtN(vs[k]) + (d.unit || '')) + '</text></g><text x="' + p[0] + '" y="' + (h - bot * .25) + '" text-anchor="middle" font-family="Roboto Condensed,Arial" font-weight="700" font-size="' + fs + '" fill="#3E4C5E">' + esc(lb[k]) + '</text>'; });
      return '<div class="fx fxlc fxv-' + v + '" style="overflow:visible">' + o + '</svg></div>';
    }
  };
  var DN_C = ['#002A46', '#4A6FA5', '#7EA1C3', '#F78C16', '#A3B8D6', '#13315C'];
  M.donut = {
    name: 'Gráfico de rosca', cat: 'Gráficos', model: true, kw: 'rosca pizza donut distribuição composição participação percentual gráfico', w: 720, h: 340, variant: 'sweep',
    variants: [['sweep', 'Fatias desenhando', 'Cada fatia é traçada em sequência ao redor do círculo.'], ['pop', 'Fatias surgindo', 'As fatias aparecem com um leve zoom.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de fatia em fatia, junto da legenda.']],
    data: { center: 'Portfólio', items: [{ t: 'Transformação', v: 40 }, { t: 'Turnaround', v: 25 }, { t: 'Estratégia & M&A', v: 20 }, { t: 'Data & AI', v: 15 }] },
    fields: [['items', 'Fatias (nome | valor)', 'rows:t|v:n'], ['center', 'Texto no centro'], ['colors', 'Cores das fatias', 'colors:6', 'items']],
    cols: function (d) { var c = ucols(d); return DN_C.map(function (x, k) { return c[k] || x; }); },
    html: function (d, w, h, el) {
      var v = VV(el, 'donut'), it = d.items || [], tot = it.reduce(function (a, b) { return a + Math.max(0, num(b.v)); }, 0) || 1, C = kcols(d, el, M.donut.cols(d)), acc = 0, segs = '', leg = '', fs = Math.max(10, Math.min(h * .055, w * .028));
      it.forEach(function (o, g) {
        var p = Math.max(0, num(o.v)) / tot * 100;
        segs += '<circle class="dn-seg" data-g="' + g + '" style="--g:' + g + '" cx="50" cy="50" r="38" fill="none" stroke="' + C[g % C.length] + '" stroke-width="16" pathLength="100" stroke-dasharray="' + Math.max(0, p - .6).toFixed(2) + ' ' + (100 - Math.max(0, p - .6)).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"/>';
        leg += '<div class="dn-li" data-g="' + g + '" style="--g:' + g + '"><i style="background:' + C[g % C.length] + '"></i>' + E('items.' + g + '.t', o.t) + '<b>' + Math.round(p) + '%</b></div>';
        acc += p;
      });
      return '<div class="fx fxdn fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + '"><div class="dn-c"><svg viewBox="0 0 100 100"><g transform="rotate(-90 50 50)">' + segs + '</g></svg><div class="dn-ct">' + E('center', d.center) + '</div></div><div class="dn-leg">' + leg + '</div></div>';
    }
  };
  M.gauge = {
    name: 'Termômetro / velocímetro', cat: 'Indicadores', model: true, kw: 'termômetro termometro velocímetro velocimetro gauge medidor indicador saúde nível kpi', w: 420, h: 300, variant: 'needle',
    variants: [['needle', 'Ponteiro com mola', 'O ponteiro (ou o mercúrio) sobe até o valor com um leve balanço.'], ['fill', 'Preenchimento suave', 'O indicador preenche devagar enquanto o número conta.'], ['pulse', 'Valor pulsando', 'Ao chegar no valor, o número pulsa em laranja para dar ênfase.']],
    data: { label: 'Saúde do programa', value: 72, max: 100, unit: '%', kind: 'gauge' },
    fields: [['label', 'Título'], ['value', 'Valor', 'number'], ['max', 'Máximo', 'number'], ['unit', 'Unidade'], ['kind', 'Formato', 'sel:gauge=Velocímetro|thermo=Termômetro']],
    html: function (d, w, h, el) {
      var v = VV(el, 'gauge'), mx = num(d.max) || 100, val = Math.max(0, Math.min(mx, num(d.value))), pc = val / mx * 100, fs = Math.max(10, Math.min(h * .07, w * .05)), u = esc(d.unit || '');
      var vt = '<b class="gg-v" data-count="' + val + '" data-dec="' + (val % 1 ? 1 : 0) + '" data-suf="' + u + '">' + esc(fmtN(val)) + u + '</b>';
      if (d.kind === 'thermo') {
        return '<div class="fx fxgg fxth fxv-' + v + '" style="font-size:' + CQ(fs) + ';--pc:' + pc + '%"><div class="th-tube"><i class="th-fill"></i>' + [25, 50, 75].map(function (k) { return '<s style="bottom:' + k + '%"></s>'; }).join('') + '</div><div class="th-bulb"></div><div class="th-txt">' + E('label', d.label, 'gg-l') + vt + '</div></div>';
      }
      var ang = -90 + pc * 1.8, gid = nid('gg'); /* id único por desenho: palco, miniaturas e páginas da impressão convivem (um id repetido apagava o arco do PDF pelo navegador) */
      return '<div class="fx fxgg fxv-' + v + '" style="font-size:' + CQ(fs) + '"><svg viewBox="0 0 200 118"><path d="M20 100A80 80 0 0 1 180 100" fill="none" stroke="#E3EAF2" stroke-width="18" stroke-linecap="round" pathLength="100"/><defs><linearGradient id="' + gid + '" x1="0" x2="1"><stop offset="0" stop-color="#A3B8D6"/><stop offset=".7" stop-color="#002A46"/><stop offset="1" stop-color="#002A46"/></linearGradient></defs><path class="gg-arc" d="M20 100A80 80 0 0 1 180 100" fill="none" stroke="url(#' + gid + ')" stroke-width="18" stroke-linecap="round" pathLength="100" stroke-dasharray="' + pc + ' 100"/><g class="gg-nd" style="transform:rotate(' + ang + 'deg)"><path d="M97 100L100 34L103 100Z" fill="#002A46"/></g><circle cx="100" cy="100" r="8" fill="#002A46"/><circle cx="100" cy="100" r="3" fill="#F78C16"/></svg><div class="gg-txt">' + vt + E('label', d.label, 'gg-l') + '</div></div>';
    }
  };

  Object.keys(M).forEach(function (k) { FX[k] = M[k]; });

  /* espelhar (el.flipH / el.flipV): só o desenho — a foto, o corpo da forma e o traço do ícone. Textos, gráficos e modelos com texto
     não se espelham (a leitura ficaria ao contrário). O espelho nunca vai em .am-rot nem em .am-fxw (giro e animações moram lá) */
  /* recorte válido de uma foto: {l,t,r,b} em frações (0–0,9), com alguma fatia cortada e algo sobrando */
  function cropOf(el) {
    var c = el && el.crop; if (!c || typeof c !== 'object') return null;
    var o = { l: cl(c.l), t: cl(c.t), r: cl(c.r), b: cl(c.b) }; if (!(o.l || o.t || o.r || o.b) || o.l + o.r > .95 || o.t + o.b > .95) return null; return o;
    function cl(v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(.9, v)) : 0; }
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function flipOK(el) { if (!el) return false; if (el.type === 'image' || el.type === 'shape') return true; var F = el.type === 'fx' && FX[el.kind]; return !!F && (F.gal === 'icon' || F.flip === true); }
  function flipOf(el) { var fh = el.flipH === true, fv = el.flipV === true; return (fh || fv) && flipOK(el) ? [fh ? -1 : 1, fv ? -1 : 1] : null; }
  /* recuo do texto (CSS inset: topo direita base esquerda) acompanha a forma espelhada: a área útil do balão, triângulo-retângulo… troca de lado */
  function flipInset(ins, f) {
    var q = String(ins).trim().split(/\s+/); if (q.length === 1) return ins; if (q.length === 2) q = [q[0], q[1], q[0], q[1]]; else if (q.length === 3) q = [q[0], q[1], q[2], q[1]];
    if (f[0] < 0) { var t = q[1]; q[1] = q[3]; q[3] = t; } if (f[1] < 0) { var u = q[0]; q[0] = q[2]; q[2] = u; }
    return q.join(' ');
  }
  function content(el, w, h) {
    if (el.type === 'text') return textHTML(el, false);
    var fl = flipOf(el);
    if (el.type === 'shape') { /* shapeInset (rt-10-shapes): recuo do texto dentro de formas com ponta, rabicho ou tampa (balão, triângulo, cilindro…) */
      var tx = textHTML(el, true), ins = API.shapeInset ? API.shapeInset(el) : null, body = API.shapeBody(el, w, h); if (API.shapeText) tx = API.shapeText(el, w, h, tx);
      if (fl) { /* espelho dentro do SVG: a sombra (filtro no <svg>) continua para baixo e o texto (.am-text) continua legível */
        var sy = el.look === 'header' ? 1 : fl[1]; /* card Cabeçalho: a faixa do título fica sempre no alto */
        if (fl[0] < 0 || sy < 0) { body = '<g data-flip="' + (fl[0] < 0 ? 'h' : '') + (sy < 0 ? 'v' : '') + '" transform="matrix(' + fl[0] + ' 0 0 ' + sy + ' ' + (fl[0] < 0 ? w : 0) + ' ' + (sy < 0 ? h : 0) + ')">' + body + '</g>'; if (ins) ins = flipInset(ins, [fl[0], sy]); }
      }
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"' + (el.shadow ? ' style="filter:drop-shadow(0 .8cqh 1.6cqh rgba(0,30,50,.3))"' : '') + '>' + body + '</svg>' + (ins ? tx.replace('class="am-text" style="', 'class="am-text" style="inset:' + ins + ';') : tx); }
    if (el.type === 'line') return API.lineSVG(el);
    /* foto espelhada: propriedade scale (soma com o “Zoom interno” do mouse, que usa transform); a sombra é desenhada já espelhada, então inverte o deslocamento */
    if (el.type === 'image') {
      var cr = cropOf(el);
      if (cr) { /* S27b: recorte (frações da foto original): só a fatia aparece, esticada na caixa; cantos, sombra e espelho no quadro */
        var sw = 100 / (1 - cr.l - cr.r), sh = 100 / (1 - cr.t - cr.b);
        return '<div class="am-crop"' + (fl ? ' data-flip="' + (fl[0] < 0 ? 'h' : '') + (fl[1] < 0 ? 'v' : '') + '"' : '') + ' style="border-radius:' + CQ(+el.radius || 0) + (fl ? ';scale:' + fl[0] + ' ' + fl[1] : '') + (el.shadow ? ';box-shadow:0 ' + (fl && fl[1] < 0 ? '-' : '') + '1cqh 2.4cqh rgba(0,30,50,.3)' : '') + '"><img class="am-img" alt="" draggable="false" src="' + esc(el.src) + '" style="position:absolute;left:-' + r2(cr.l * sw) + '%;top:-' + r2(cr.t * sh) + '%;width:' + r2(sw) + '%;height:' + r2(sh) + '%;object-fit:fill;border-radius:0"></div>';
      }
      return '<img class="am-img" alt="" draggable="false" src="' + esc(el.src) + '"' + (fl ? ' data-flip="' + (fl[0] < 0 ? 'h' : '') + (fl[1] < 0 ? 'v' : '') + '"' : '') + ' style="object-fit:' + (el.fit || 'cover') + ';border-radius:' + CQ(+el.radius || 0) + (fl ? ';scale:' + fl[0] + ' ' + fl[1] : '') + (el.shadow ? ';box-shadow:0 ' + (fl && fl[1] < 0 ? '-' : '') + '1cqh 2.4cqh rgba(0,30,50,.3)' : '') + '">';
    }
    if (el.type === 'fx' && FX[el.kind]) {
      var inner; try { inner = FX[el.kind].html(el.data || {}, w, h, el); } /* um componente com defeito nunca derruba o slide nem o player exportado */
      catch (ex) { inner = '<div class="fx fx-falha" title="' + esc(ex && ex.message || ex) + '"></div>'; if (window.console && console.warn) console.warn('AMRT: componente “' + el.kind + '” falhou', ex); }
      if (fl) inner = String(inner).replace(/<svg class="ic"/, '<svg class="ic" data-flip="' + (fl[0] < 0 ? 'h' : '') + (fl[1] < 0 ? 'v' : '') + '" style="scale:' + fl[0] + ' ' + fl[1] + '"'); /* ícone: só o desenho; a legenda continua legível */
      if (el.data && el.data.panel === 'white') inner = '<div class="fx fx-panel"><div class="fx-pin">' + inner + '</div></div>';
      return el.pal && API.palHTML ? API.palHTML(el, inner) : inner; /* “Cores do componente” (rt-05-pal.js): só com el.pal */
    }
    return '';
  }
  /* ---------- vocabulário de animações: uma lista só para o painel, o menu “Animação”, a vitrine de efeitos e o player ----------
     [chave, rótulo, o que faz, quando usar, restrição]  ·  restrição: 'ln' = só traços (linhas, setas, Linhas A&M) · 'tx' = só textos e formas com texto */
  var ANIMS = {
    in: [['none', 'Nenhuma', 'Aparece pronto, sem animação.'],
      ['fade', 'Surgir', 'Aparece suavemente.', 'Padrão discreto para textos, fotos e fundos.'],
      ['rise', 'Subir', 'Sobe um pouco enquanto aparece.', 'Cards e blocos de texto: entrada elegante e versátil.'],
      ['left', 'Da esquerda', 'Desliza da esquerda.', 'Etapas e itens que seguem a ordem de leitura.'],
      ['right', 'Da direita', 'Desliza da direita.', 'Conclusões e próximos passos que chegam ao slide.'],
      ['zoom', 'Zoom', 'Cresce a partir do centro.', 'Números e selos que pedem um pequeno impacto.'],
      ['focus', 'Foco (desfoque)', 'Sai do desfoque.', 'Mensagem-chave que ganha nitidez diante da plateia.'],
      ['wipe', 'Revelar (cortina)', 'Cortina da esquerda para a direita.', 'Faixas, citações e linhas de destaque.'],
      ['draw', 'Desenhar (linhas)', 'O traço se desenha (linhas e setas).', 'Setas, conectores e as Linhas A&M.', 'ln'],
      ['iris', 'Íris', 'Revela a partir do centro, como a abertura de uma lente.', 'Fotos, logos e o número que abre a conversa.'],
      ['diag', 'Diagonal', 'Revela em diagonal, do canto superior esquerdo.', 'Cards e faixas com energia, sem exagero.'],
      ['wipeup', 'Revelar de baixo', 'Cortina de baixo para cima.', 'Colunas, barras e blocos que “crescem”.'],
      ['drop', 'Descer', 'Desce suavemente até o lugar.', 'Títulos e rótulos que pousam na página.'],
      ['pop', 'Saltar', 'Surge com um pequeno salto elástico.', 'Ícones, selos e marcadores de destaque.'],
      ['land', 'Pouso 3D', 'Pousa em perspectiva, como um card sobre a mesa.', 'Cards de iniciativa e destaques nobres.'],
      ['flip', 'Virar 3D', 'Gira em 3D até ficar de frente.', 'Revelações do tipo antes × depois.'],
      ['grow', 'Expandir', 'Abre na horizontal, a partir da esquerda.', 'Réguas, divisórias e barras de progresso.'],
      ['words', 'Palavra a palavra', 'O texto entra uma palavra por vez.', 'Títulos curtos e frases de impacto.', 'tx']],
    loop: [['none', 'Nenhum', 'Sem movimento contínuo.'],
      ['pulse', 'Pulsar', 'Cresce e volta, num ritmo calmo.', 'O número ou botão que pede atenção contínua.'],
      ['float', 'Flutuar', 'Sobe e desce suavemente.', 'Cards de capa e elementos decorativos.'],
      ['glow', 'Brilho', 'Halo laranja que acende e apaga.', 'O único ponto quente do slide.'],
      ['shimmer', 'Reflexo', 'Faixa de luz que atravessa o elemento.', 'Selos, cards especiais e logotipos.'],
      ['beacon', 'Sinalizar (anéis)', 'Anéis laranja se expandem ao redor.', 'Pontos de atenção, riscos e marcos críticos.'],
      ['flow', 'Fluxo contínuo', 'Tracejado em movimento ao longo do traço.', 'Conectores que mostram fluxo de dados ou de processo.', 'ln'],
      ['drift', 'Deriva orgânica', 'Flutua com um leve giro, como em suspensão.', 'Composições de capa e ícones ilustrativos.'],
      ['breathe', 'Respirar', 'A opacidade sobe e desce devagar.', 'Elementos de fundo e marcas-d’água.'],
      ['wiggle', 'Balançar', 'Balança rápido, de tempos em tempos.', 'Ícones de alerta e chamadas para ação.'],
      ['beat', 'Batimento', 'Duas batidas curtas e uma pausa.', 'KPI crítico ou ponto de decisão.']],
    hover: [['none', 'Nenhum', 'Sem resposta ao mouse.'],
      ['lift', 'Elevar', 'Sobe com sombra ao passar o mouse.', 'Cards clicáveis e opções lado a lado.'],
      ['zoom', 'Zoom', 'Aproxima levemente.', 'Fotos, miniaturas e cards.'],
      ['glow', 'Brilho', 'Acende um halo laranja.', 'Destaques e botões de navegação.'],
      ['tilt', 'Inclinar 3D', 'Inclina acompanhando o cursor.', 'Cards holográficos e capas interativas.'],
      ['spot', 'Holofote', 'Escurece o restante do slide.', 'Comparar opções, uma de cada vez.'],
      ['sheen', 'Varrer luz', 'Uma faixa de luz atravessa o elemento.', 'Cards especiais, selos e imagens.'],
      ['ring', 'Contorno em destaque', 'Um contorno laranja se aproxima.', 'Itens de lista, cards e botões.'],
      ['uline', 'Sublinhar', 'Linha laranja surge sob o texto.', 'Títulos, rótulos e chamadas.'],
      ['lean', 'Inclinar leve', 'Gira um pouco e cresce.', 'Notas, ícones e elementos lúdicos.'],
      ['inzoom', 'Zoom interno', 'O conteúdo aproxima dentro da moldura.', 'Fotos e cards com imagem.']],
    tr: [['fade', 'Esmaecer', 'Um slide se dissolve no outro.', 'Padrão: funciona em qualquer sequência.'],
      ['slide', 'Deslizar', 'O novo slide entra deslizando.', 'Sequências de conteúdo do mesmo capítulo.'],
      ['zoom', 'Zoom', 'O novo slide se aproxima.', 'Aberturas e mudanças de assunto.'],
      ['navy', 'Passagem azul-marinho', 'Escurece no azul-marinho e revela o próximo.', 'Troca de capítulo ou de assunto.'],
      ['iris', 'Íris', 'O novo slide se abre a partir do centro.', 'Revelar a conclusão ou o grande número.'],
      ['up', 'Subir', 'O novo slide sobe suavemente.', 'Aprofundar um tema: “vamos aos detalhes”.'],
      ['blur', 'Desfoque', 'O novo slide sai do desfoque.', 'Visão de futuro e cenários.'],
      ['none', 'Nenhuma', 'Corte seco, sem transição.', 'Comparações rápidas entre dois slides.']]
  };
  /* “Palavra a palavra”: só no palco que toca (player, prévias); o palco de edição nunca é tocado, então o texto salvo não muda */
  function splitWords(root) {
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], t, i = 0;
    while ((t = tw.nextNode())) nodes.push(t);
    nodes.forEach(function (tn) {
      var f = document.createDocumentFragment();
      tn.nodeValue.split(/(\s+)/).forEach(function (p) {
        if (!p) return;
        if (/^\s+$/.test(p)) { f.appendChild(document.createTextNode(p)); return; }
        var s = document.createElement('span'); s.className = 'amx-w'; s.style.setProperty('--i', Math.min(i++, 40)); s.textContent = p; f.appendChild(s);
      });
      tn.parentNode.replaceChild(f, tn);
    });
  }
  function renderEl(el, idx) {
    var x = el.x, y = el.y, w = el.w, h = el.h;
    if (el.type === 'line') { var b = lineBox(el); x = b.x; y = b.y; w = b.w; h = b.h; }
    var n = document.createElement('div');
    n.className = 'am-el am-t-' + el.type + (el.kind ? ' am-k-' + el.kind : '');
    n.dataset.id = el.id;
    n.style.cssText = 'left:' + P(x, W) + ';top:' + P(y, H) + ';width:' + P(w, W) + ';height:' + P(h, H) + ';z-index:' + ((idx || 0) + 1);
    var a = el.anim || {};
    n.style.setProperty('--d', (+a.delay || 0) + 'ms');
    if (a.in && a.in !== 'none') { n.dataset.in = a.in; n.style.setProperty('--t', (+a.dur || (a.in === 'draw' ? 1000 : 700)) + 'ms'); }
    var rot = document.createElement('div'); rot.className = 'am-rot'; if (+el.rot) rot.style.transform = 'rotate(' + (+el.rot) + 'deg)';
    var fx = document.createElement('div'); fx.className = 'am-fxw';
    if (a.loop && a.loop !== 'none') fx.dataset.loop = a.loop;
    if (a.hover && a.hover !== 'none') fx.dataset.hover = a.hover;
    if (el.opacity != null && +el.opacity < 1) fx.style.opacity = el.opacity;
    if (el.type === 'image' || el.type === 'fx' || el.type === 'text') fx.style.borderRadius = CQ(+el.radius || 0);
    else if (el.type === 'shape') { /* mesmo raio do desenho: reflexo, anéis, contorno e varredura acompanham a forma */
      var sr = Math.max(0, Math.min(+el.radius || 0, w / 2, h / 2)), rr = el.shape === 'ellipse' ? '50%' : el.shape === 'pill' ? CQ(Math.min(w, h) / 2) : el.shape === 'round' ? CQ(sr || Math.min(w, h) * .12) : sr && (!el.shape || el.shape === 'rect') ? CQ(sr) : '';
      if (rr) fx.style.borderRadius = rr; }
    fx.innerHTML = content(el, w, h);
    if (el.type === 'fx' && !(+el.radius)) { /* componente sem raio próprio: o invólucro segue o canto do cartão (anéis, brilho, contorno, varredura) */
      var c0 = fx.firstElementChild, cr = c0 && (c0.style.borderRadius || FX_RAD[(String(c0.className).match(/\bfx(?:h|g|cd|q|-panel)\b/) || [''])[0]]);
      if (cr) fx.style.borderRadius = cr; }
    rot.appendChild(fx); n.appendChild(rot);
    if (el.pal && el.type === 'fx' && API.palTag) API.palTag(n, el); /* data-pal + folha de estilo restrita às classes do elemento (rt-05-pal.js) */
    if (API.palSweep) API.palSweep(); /* folhas de paletas que ninguém usa mais saem depois (rt-05-pal.js) */
    return n;
  }
  var FX_RAD = { fxh: '4%/7%', fxg: '5%/9%', fxcd: '3%/6%', fxq: '1cqh', 'fx-panel': '1.2cqh' }; /* mesmos cantos do runtime.css (.fxh, .fxg, .fxcd, .fxq, .fx-panel) */
  /* S27: número do slide (deck.num = {on, pos, from}) — gravado em cada slide como _num (não enumerável: não vai para o JSON) por stampNums;
     editor, miniaturas, player e exportações desenham a partir daí. map[i] = posição original do i-ésimo slide (player só com os visíveis) */
  function stampNums(deck, map) {
    var on = !!(deck && deck.num && deck.num.on === true), pos = on && /^(tl|tr|bl|br)$/.test(deck.num.pos) ? deck.num.pos : 'br', from = on && isFinite(+deck.num.from) ? Math.max(0, +deck.num.from | 0) : 1;
    (deck && deck.slides || []).forEach(function (s, i) {
      if (!s || typeof s !== 'object') return;
      if (on) Object.defineProperty(s, '_num', { value: { n: (map ? map[i] : i) + from, pos: pos }, enumerable: false, configurable: true, writable: true });
      else if (s._num) delete s._num;
    });
  }
  function renderSlide(slide, opts) {
    opts = opts || {};
    var st = document.createElement('div');
    st.className = 'am-stage' + (opts.play ? ' am-play am-pre' : ' am-edit');
    st.style.background = slide.bg || '#FFFFFF';
    if (slide.bgImg) { var bi = document.createElement('div'); bi.className = 'am-bgimg'; bi.style.backgroundImage = 'url("' + slide.bgImg + '")'; bi.style.opacity = slide.bgImgOp == null ? 1 : slide.bgImgOp; st.appendChild(bi); }
    (slide.els || []).forEach(function (el, i) { st.appendChild(renderEl(el, i)); });
    if (slide._num && slide._num.n != null) { var nm = document.createElement('div'); nm.className = 'am-num am-num-' + slide._num.pos + (isDark(slide.bg) ? ' dk' : ''); nm.setAttribute('aria-hidden', 'true'); nm.textContent = String(slide._num.n); st.appendChild(nm); }
    if (API.palSweep) API.palSweep();
    if (opts.play) st.querySelectorAll('.am-el[data-in=words] .am-tx').forEach(splitWords);
    return st;
  }
  /* executa efeitos com JS (contadores, ciclo de etapas); devolve função de limpeza */
  function runFx(st) {
    var raf = [], iv = [];
    st.querySelectorAll('[data-count]').forEach(function (b) {
      var to = +b.dataset.count, from = +b.dataset.from || 0, dec = +b.dataset.dec || 0, pre = b.dataset.pre || '', suf = b.dataset.suf || '';
      var host = b.closest('.am-el'), delay = parseFloat(getComputedStyle(host).getPropertyValue('--d')) || 0, t0 = performance.now() + delay + 250, dur = 1500;
      b.textContent = pre + fmt(from, dec) + suf;
      (function tick(t) { var p = Math.max(0, Math.min(1, (t - t0) / dur)), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p); b.textContent = pre + fmt(from + (to - from) * e, dec) + suf; if (p < 1) raf.push(requestAnimationFrame(tick)); })(performance.now());
    });
    st.querySelectorAll('.fxs[data-cycle="1"]').forEach(function (box) {
      var steps = box.querySelectorAll('.fxs-step'), k = -1;
      iv.push(setTimeout(function () { iv.push(setInterval(function () { steps.forEach(function (s) { s.classList.remove('on'); }); k = (k + 1) % steps.length; steps[k].classList.add('on'); }, 1400)); }, 1400));
    });
    st.querySelectorAll('[data-cycle="g"]').forEach(function (root) {
      var gs = []; root.querySelectorAll('[data-g]').forEach(function (x) { if (gs.indexOf(x.dataset.g) < 0) gs.push(x.dataset.g); });
      if (!gs.length) return; var k = -1;
      iv.push(setTimeout(function () {
        root.classList.add('cy-active');
        var step = function () { root.querySelectorAll('.cy-on').forEach(function (x) { x.classList.remove('cy-on'); }); k = (k + 1) % gs.length; root.querySelectorAll('[data-g="' + gs[k] + '"]').forEach(function (x) { x.classList.add('cy-on'); }); };
        step(); iv.push(setInterval(step, 2200));
      }, 1900));
    });
    return function () { raf.forEach(cancelAnimationFrame); iv.forEach(function (x) { clearTimeout(x); clearInterval(x); }); st.querySelectorAll('.cy-active').forEach(function (x) { x.classList.remove('cy-active'); }); st.querySelectorAll('.cy-on').forEach(function (x) { x.classList.remove('cy-on'); }); };
  }
  function bindTilt(root) {
    function mv(e) {
      var f = e.target.closest && e.target.closest('.am-fxw[data-hover=tilt]');
      root.querySelectorAll('.am-fxw[data-hover=tilt].tilting').forEach(function (o) { if (o !== f) { o.classList.remove('tilting'); o.style.transform = ''; } });
      if (!f) return;
      var r = f.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      f.classList.add('tilting'); f.style.transform = 'rotateX(' + ((.5 - y) * 14).toFixed(2) + 'deg) rotateY(' + ((x - .5) * 16).toFixed(2) + 'deg) scale(1.02)';
      f.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); f.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    }
    root.addEventListener('pointermove', mv);
    root.addEventListener('pointerleave', function () { root.querySelectorAll('.tilting').forEach(function (o) { o.classList.remove('tilting'); o.style.transform = ''; }); });
  }
  /* ---------- texto e título de um slide (índice, resumo, cabeçalho do “Ampliar”) ---------- */
  function plain(html) { var t = document.createElement('template'); t.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n'); return (t.content.textContent || '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim(); }
  function textsOf(s) { return (s.els || []).filter(function (e) { return e.type === 'text'; }).map(function (e) { return { t: plain(e.html), size: +e.size || 18, x: +e.x || 0, y: +e.y || 0 }; }).filter(function (o) { return o.t; }); }
  function isDark(c) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return false; var n = parseInt(m[1], 16); return 0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255) < 110; }
  function clip(t, n) { t = String(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  /* título: explícito > maior texto (ignorando números de capítulo e rótulos em caixa alta; empate = o mais alto) > “Slide N” */
  function slideTitle(s, i) {
    if (s.title) return clip(s.title, 72);
    var best = null; textsOf(s).forEach(function (o) { if (/^\d{1,2}$/.test(o.t) || (o.size <= 14 && o.t === o.t.toUpperCase() && /[A-ZÀ-Ý]/.test(o.t))) return; if (!best || o.size > best.size || (o.size === best.size && o.y < best.y)) best = o; });
    return best ? clip(best.t, 72) : 'Slide ' + (i + 1);
  }
  var NUM_ONLY = /^\d{1,2}$/;
  function isEyebrow(o) { return o.size <= 14 && o.t === o.t.toUpperCase() && /[A-ZÀ-Ý]/.test(o.t); }
  /* divisor de capítulo: kind explícito (layout “Divisor de capítulo”) ou slide escuro com número de 1–2 dígitos ≥ 64 px e título ≥ 34 px */
  function dividerOf(s) {
    if (!s || (s.kind !== 'section' && !isDark(s.bg))) return null; /* atalho: só slides escuros ou kind=section podem ser divisor (evita ler o texto de todos) */
    var tx = textsOf(s), num = null, ttl = null;
    tx.forEach(function (o) { if (NUM_ONLY.test(o.t) && o.size >= 64) num = o; else if (!isEyebrow(o) && o.size >= 34 && (!ttl || o.size > ttl.size)) ttl = o; });
    if (s.kind === 'section' && ttl) return { num: num ? +num.t : null, name: clip(ttl.t, 48) };
    return isDark(s.bg) && num && ttl ? { num: +num.t, name: clip(ttl.t, 48) } : null;
  }
  /* capítulos da apresentação: slide.sec explícito (herdado pelos seguintes) ou divisores detectados (um divisor sempre abre capítulo);
     slides antes do primeiro capítulo = “Abertura”. Numeração “Parte n”: única e crescente; usa o número do divisor quando ele é maior que o
     anterior (respeita a numeração do autor), senão o seguinte; capítulos nomeados antes do primeiro divisor ficam sem número (num 0), como a abertura.
     Devolve { list: [{name, num, idx, first, divider, intro, sub}], secOf: [índice do capítulo por slide] }; sem capítulos, listas vazias */
  function sectionsOf(deck) {
    var out = [], c = null, secOf = [];
    (deck && deck.slides || []).forEach(function (s, i) {
      var dv = dividerOf(s), name = (s.sec && String(s.sec).trim()) || (dv && dv.name) || null;
      if (name && (!c || c.intro || c.name !== clip(name, 48) || dv)) {
        c = { name: clip(name, 48), num: 0, dnum: dv && dv.num ? dv.num : 0, idx: [], first: i, divider: dv ? i : -1, intro: false, sub: s.secSub ? clip(s.secSub, 160) : '' }; out.push(c);
      } else if (!c) { c = { name: 'Abertura', num: 0, dnum: 0, idx: [], first: i, divider: -1, intro: true, sub: '' }; out.push(c); }
      c.idx.push(i); secOf[i] = out.length - 1;
    });
    var fd = -1; out.forEach(function (x, k) { if (fd < 0 && x.divider >= 0) fd = k; });
    var n = 0; out.forEach(function (x, k) { if (x.intro || (fd >= 0 && k < fd)) return; n = x.dnum > n ? x.dnum : n + 1; x.num = n; });
    var real = out.filter(function (x) { return !x.intro; }).length;
    return real ? { list: out, secOf: secOf } : { list: [], secOf: [] };
  }
  /* textos livres de el.data (rótulos, valores), sem chaves de estilo/cor: alimenta o resumo automático */
  var NOTEXT_KEYS = ['colors', 'style', 'weight', 'color', 'tcolor', 'c1', 'c2', 'variant', 'name', 'trig', 'accent', 'bg', 'stroke', 'pair', 'layout', 'mode', 'sort', 'kind', 'legend', 'panel', 'font', 'hl', 'highlight', 'bands', 'k', 'qs', 'sheet', 'tools',
    'hat', 'hair', 'lashes', 'glasses', 'outfit', 'tool', 'mood', 'mood2', 'act', 'act2', 'dir', 'look', 'bubble', 'side', 'bcol', 'aim', 'tail']; /* qs/sheet/tools: codec e endereço do formulário (S30); o resto: partes e gatilhos dos personagens (S35) */
  var COLOR_LIKE = /^(#[0-9a-f]{3,8}|none|transparent|rgba?\([\d.,\s%]+\)|[a-z]{3,20})$/i;
  function dataStrings(d) {
    var out = [];
    (function walk(v, k) { if (typeof v === 'string') { if (NOTEXT_KEYS.indexOf(k) < 0 && v.length > 1 && /[A-Za-zÀ-ɏ]/.test(v) && !COLOR_LIKE.test(v)) out.push(v); } else if (Array.isArray(v)) v.forEach(function (x) { walk(x, k); }); else if (v && typeof v === 'object') Object.keys(v).forEach(function (kk) { walk(v[kk], kk); }); })(d, '');
    return out.join('\n');
  }
  /* resumo automático do slide (“Sobre este slide”): determinístico, voltado a quem lê a apresentação (sem instruções ao apresentador),
     texto simples com linhas separadas por \n, ≤ 700 caracteres. secs = sectionsOf(deck) já calculado (opcional) */
  function autoNotes(s, i, deck, secs) {
    var n = (deck && deck.slides || []).length, title = slideTitle(s, i).replace(/[.:;,\s]+$/, ''), out = [title + '.'];
    secs = secs || sectionsOf(deck);
    var sc = secs.list[secs.secOf[i]], dv = dividerOf(s);
    var where = sc && !sc.intro ? (sc.num ? 'Parte ' + sc.num + ' · ' : 'Capítulo ') + sc.name + ' · ' : '';
    if (dv) {
      var nxt = sc ? sc.idx.filter(function (k) { return k !== i; }).slice(0, 5).map(function (k) { return slideTitle(deck.slides[k], k); }) : [];
      out.push(where + 'abre o capítulo' + (sc ? ' (slides ' + (sc.idx[0] + 1) + '–' + (sc.idx[sc.idx.length - 1] + 1) + ')' : '') + '.');
      if (nxt.length) out.push('Neste capítulo: ' + nxt.join('; ') + '.');
      return out.join('\n').slice(0, 700);
    }
    var pts = [], kinds = [], blob = [], ttl = slideTitle(s, i);
    textsOf(s).sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (o) {
      blob.push(o.t); if (clip(o.t, 72) === ttl || NUM_ONLY.test(o.t) || isEyebrow(o)) return;
      o.t.split(/\n|•/).forEach(function (ln) { ln = ln.replace(/^[\s\-–—·]+/, '').replace(/[.;:\s]+$/, '').trim(); if (ln.length > 3 && pts.length < 3) pts.push(clip(ln, 120)); });
    });
    (s.els || []).forEach(function (e) { if (e.type === 'fx' && FX[e.kind] && FX[e.kind].cat !== 'Marca A&M') { if (kinds.indexOf(FX[e.kind].name) < 0) kinds.push(FX[e.kind].name); blob.push(dataStrings(e.data)); } });
    var nums = []; ((blob.join(' ')).match(/(?:R\$\s?)?\d+(?:[.,]\d+)*(?:\s?(?:%|p\.?p\.?|mi|bi|mil|k|x))?/gi) || []).forEach(function (m) {
      m = m.trim(); if (/^(19|20)\d{2}$/.test(m)) return;
      if ((/[%$]|mi|bi|mil|k|x|pp/i.test(m) || m.replace(/\D/g, '').length >= 2) && nums.indexOf(m) < 0 && nums.length < 4) nums.push(m); });
    out.push(where + 'slide ' + (i + 1) + ' de ' + n + '.');
    if (kinds.length) out.push('Visual: ' + kinds.slice(0, 3).join(', ') + '.');
    if (pts.length) out.push('Neste slide: ' + pts.join('; ') + '.');
    if (nums.length) out.push('Números-chave: ' + nums.join(' · ') + '.');
    return out.join('\n').slice(0, 700);
  }
  /* ---------- ampliar: o que pode ser ampliado num slide (modelos, gráficos e imagens; el.zoom === false desliga, el.zoom === true liga um componente) ---------- */
  function zoomables(s) {
    return (s && s.els || []).filter(function (e) { return e.zoom !== false && e.w >= 160 && e.h >= 90 && (e.type === 'image' || (e.type === 'fx' && FX[e.kind] && (FX[e.kind].model || e.zoom === true))); })
      .sort(function (a, b) { return b.w * b.h - a.w * a.h; });
  }
  var ZOOM_IC = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>';
  /* ---------- player ---------- */
  function player(deck, root, opts) {
    opts = opts || {};
    root.innerHTML = '';
    /* slides ocultos (slide.hidden === true) ficam fora da apresentação: o player, o índice, a linha do tempo, o contador e o resumo
       automático recebem só os visíveis. map[k] = posição original do k-ésimo slide visível. Todos ocultos (ou opts.showHidden): mostra todos */
    var all = deck.slides || [], map = [], vis = [];
    all.forEach(function (s, i) { if (opts.showHidden || !s || s.hidden !== true) { vis.push(s); map.push(i); } });
    if (!vis.length) { vis = all.slice(); map = all.map(function (s, i) { return i; }); }
    stampNums({ num: deck.num, slides: vis }, map); /* S27: número do slide = posição original (como no PowerPoint), mesmo com ocultos */
    if (vis.length < all.length) { var dv = {}; Object.keys(deck).forEach(function (k) { dv[k] = deck[k]; }); dv.slides = vis; deck = dv; }
    /* início pedido num slide oculto: o próximo visível (senão o anterior) */
    function visIdx(i) { i = +i || 0; for (var k = 0; k < map.length; k++) if (map[k] >= i) return k; return map.length - 1; }
    var wrap = document.createElement('div'); wrap.className = 'amp';
    wrap.innerHTML = '<div class="amp-view"><div class="amp-deck"></div></div><div class="amp-prog"></div><div class="amp-bar"><div class="amp-brand">' + (opts.brand ? '<img class="amp-wm" alt="Alvarez &amp; Marsal" src="' + esc(opts.brand) + '">' : '<b>Alvarez &amp; Marsal</b>') + '<span></span></div><div class="amp-c"><button class="amp-b" data-a="prev" type="button" aria-label="Anterior">← <span class="amp-bw">Anterior</span></button><button type="button" class="amp-pos" data-a="index" aria-haspopup="dialog" aria-expanded="false" title="Índice de slides (G)" aria-label="Índice de slides (G)"><b>01</b> / 01</button><button class="amp-b" data-a="next" type="button" aria-label="Próximo"><span class="amp-bw">Próximo</span> →</button></div><div class="amp-r">' + (opts.onExit ? '<button class="amp-b amp-ic" data-a="exit" type="button" aria-label="Sair (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg><span class="amp-bw">Sair (Esc)</span></button>' : '') +
      '<button class="amp-b amp-ic" data-a="zoom" type="button" title="Ampliar o gráfico (Z)" aria-label="Ampliar (Z)" hidden>' + ZOOM_IC + '<span class="amp-bw">Ampliar</span></button><button class="amp-b amp-ic" data-a="full" type="button" title="Tela cheia (F)" aria-label="Tela cheia (F)"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div></div>' +
      '<button class="amp-zb" type="button" aria-label="Ampliar (Z)" title="Ampliar · duplo clique também amplia (Z)">' + ZOOM_IC + '</button>' +
      '<div class="amp-zm" role="dialog" aria-modal="true" aria-label="Elemento ampliado"><div class="amp-zm-box"><div class="amp-zm-h"><span class="t"></span><span class="n"></span><button class="amp-zx" data-z="prev" type="button" aria-label="Anterior (←)" title="Anterior (←)">‹</button><button class="amp-zx" data-z="next" type="button" aria-label="Próximo (→)" title="Próximo (→)">›</button><button class="amp-zx" data-z="close" type="button" aria-label="Fechar (Esc)" title="Fechar (Esc)">×</button></div><div class="amp-zm-vp"></div><div class="amp-zm-f"><span class="e"></span><span>Esc ou clique fora para fechar · ← → outros gráficos do slide</span></div></div></div>';
    root.appendChild(wrap);
    wrap.querySelector('.amp-brand span').textContent = deck.title || '';
    var deckEl = wrap.querySelector('.amp-deck'), list = (deck.slides || []).map(function (s) {
      var sl = document.createElement('div'); sl.className = 'amp-slide'; sl.dataset.tr = s.tr || 'fade';
      var st = renderSlide(s, { play: true }); sl.appendChild(st); deckEl.appendChild(sl); return { sl: sl, st: st };
    });
    var cur = -1, clean = null, pad = function (n) { return String(n).padStart(2, '0'); };
    /* ampliar: botão ⤢ ao passar o mouse, duplo clique ou Z abrem o elemento re-renderizado num palco maior (cqw escala tudo, sem borrar) */
    var zb = wrap.querySelector('.amp-zb'), zm = wrap.querySelector('.amp-zm'), zbox = zm.querySelector('.amp-zm-box'), zvp = zm.querySelector('.amp-zm-vp'), zBtn = wrap.querySelector('[data-a=zoom]');
    var zs = [], zoomOpen = false, zi = 0, zClean = null, zReturn = null, hoverId = null, zbT = null;
    function hideZb(ms) { clearTimeout(zbT); zbT = setTimeout(function () { zb.classList.remove('on'); }, ms || 0); }
    function showZb(n) {
      clearTimeout(zbT); var r = (n.querySelector(':scope>.am-rot') || n).getBoundingClientRect(), a = wrap.getBoundingClientRect(); /* girado: canto do desenho, não da caixa sem giro */
      zb.style.left = Math.max(0, r.right - 40 - a.left) + 'px'; zb.style.top = Math.max(0, r.top + 8 - a.top) + 'px'; zb.classList.add('on');
    }
    function zoomableNode(t) { var n = t && t.closest && t.closest('.am-el'); return n && zs.some(function (e) { return e.id === n.dataset.id; }) ? n : null; }
    function openZoom(ref) {
      if (!zs.length) return false;
      var s = deck.slides[cur], n = typeof ref === 'string' ? Math.max(0, zs.map(function (e) { return e.id; }).indexOf(ref)) : (+ref || 0);
      zi = ((n % zs.length) + zs.length) % zs.length; var el = zs[zi];
      if (!zoomOpen) zReturn = document.activeElement;
      if (zClean) { zClean(); zClean = null; }
      /* elemento girado: a janela tem o tamanho da caixa que contém o desenho girado (|w cos|+|h sin| × |w sin|+|h cos|), com o elemento
         no meio — nada é cortado e a foto continua na orientação escolhida */
      var t = el.type === 'line' ? 0 : (+el.rot || 0) * Math.PI / 180, cs = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t)), bw = el.w * cs + el.h * sn, bh = el.w * sn + el.h * cs;
      var maxW = Math.min(innerWidth * .94, 1700) - 52, maxH = innerHeight * .92 - 90, k = Math.max(.1, Math.min(maxW / bw, maxH / bh, 4));
      var st = renderSlide({ bg: s.bg || '#FFFFFF', els: [el] }, { play: true });
      st.classList.remove('am-pre'); /* estado final, pronto para ler: contadores e ciclos ainda rodam (runFx) */
      st.style.cssText += ';position:absolute;left:' + (-(el.x - (bw - el.w) / 2) * k) + 'px;top:' + (-(el.y - (bh - el.h) / 2) * k) + 'px;width:' + (W * k) + 'px;height:' + (H * k) + 'px;aspect-ratio:auto' + (t ? ';overflow:visible' : '');
      zvp.style.width = (bw * k) + 'px'; zvp.style.height = (bh * k) + 'px'; zvp.style.background = s.bg || '#FFFFFF'; zbox.style.width = (bw * k + 52) + 'px';
      zvp.innerHTML = ''; zvp.appendChild(st); zClean = runFx(st);
      zbox.classList.toggle('dark', isDark(s.bg));
      zm.querySelector('.t').textContent = slideTitle(s, cur); zm.querySelector('.n').textContent = zs.length > 1 ? (zi + 1) + ' / ' + zs.length : '';
      zm.querySelector('.e').textContent = el.type === 'image' ? 'Imagem' : fxLabel(el);
      zm.querySelector('[data-z=prev]').hidden = zm.querySelector('[data-z=next]').hidden = zs.length < 2;
      zm.classList.add('on'); zoomOpen = true; hideZb(); zm.querySelector('[data-z=close]').focus();
      return true;
    }
    function closeZoom() {
      if (!zoomOpen) return; zm.classList.remove('on'); zoomOpen = false; if (zClean) { zClean(); zClean = null; } zvp.innerHTML = '';
      var r = zReturn; zReturn = null; if (r && r !== document.body && document.contains(r) && r.focus) r.focus(); else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    function go(i) {
      i = Math.max(0, Math.min(list.length - 1, i)); if (i === cur || !list.length) return;
      if (clean) clean(); closeZoom(); hideZb(); hoverId = null;
      list.forEach(function (o, k) { o.sl.classList.toggle('on', k === i); if (k !== i) { o.st.classList.remove('am-in'); o.st.classList.add('am-pre'); } });
      cur = i; var st = list[i].st; st.classList.remove('am-in'); st.classList.add('am-pre'); void st.offsetWidth; st.classList.remove('am-pre'); st.classList.add('am-in'); clean = runFx(st);
      wrap.querySelector('.amp-pos').innerHTML = '<b>' + pad(i + 1) + '</b> / ' + pad(list.length);
      wrap.querySelector('[data-a=prev]').disabled = i === 0; wrap.querySelector('[data-a=next]').disabled = i === list.length - 1;
      wrap.querySelector('.amp-prog').style.width = ((i + 1) / list.length * 100) + '%';
      zs = zoomables(deck.slides[i]); zBtn.hidden = !zs.length;
      if (!opts.noHash) try { history.replaceState(null, '', '#/' + (i + 1)); } catch (e) { }
      API.hooks.show.forEach(function (f) { try { f(i, hd); } catch (err) { if (window.console) console.error(err); } });
    }
    function full() { if (document.fullscreenElement) document.exitFullscreen(); else (document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : Promise.resolve()).catch(function () { }); }
    function key(e) {
      var kt = e.target, k = e.key;
      if (kt && (/input|textarea|select/i.test(kt.tagName) || kt.isContentEditable)) return; /* campos, notas e textos em edição */
      if ((e.ctrlKey || e.metaKey || e.altKey) && !(e.getModifierState && e.getModifierState('AltGraph'))) return; /* Ctrl+S, Ctrl+Z etc. pertencem à camada de edição; AltGr só digita */
      var onBtn = kt && kt.closest && kt.closest('button,[role=button],a[href]');
      if (zoomOpen) { /* camada “Ampliar” por cima de tudo: Esc fecha, ← → trocam de gráfico, Tab circula nos botões; nada mais chega ao slide */
        if (k === 'Escape') closeZoom();
        else if (k === 'ArrowLeft' || k === 'ArrowRight') openZoom(zi + (k === 'ArrowRight' ? 1 : -1));
        else if (k === 'Tab') { var fb = Array.prototype.filter.call(zm.querySelectorAll('button'), function (b) { return !b.hidden; }), fi = fb.indexOf(document.activeElement); fb[((fi < 0 ? 0 : fi + (e.shiftKey ? -1 : 1)) + fb.length) % fb.length].focus(); }
        else if ((k === 'Enter' || k === ' ') && onBtn && zm.contains(kt)) return;
        e.preventDefault(); return;
      }
      if ((k === 'Enter' || k === ' ') && onBtn) return; /* botão em foco (teclado): Enter e Espaço acionam o próprio botão */
      for (var hk = 0; hk < API.hooks.key.length; hk++) { try { if (API.hooks.key[hk](e, hd)) return; } catch (err) { if (window.console) console.error(err); } } /* camadas das extensões (índice, resumo): true = tecla consumida */
      if (k === 'z' || k === 'Z') { if (zs.length) openZoom(hoverId || 0); return; }
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].indexOf(k) >= 0) { e.preventDefault(); go(cur + 1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].indexOf(k) >= 0) { e.preventDefault(); go(cur - 1); }
      else if (k === 'Home') go(0); else if (k === 'End') go(list.length - 1);
      else if (k === 'f' || k === 'F') full();
      else if (k === 'Escape' && opts.onExit) opts.onExit();
    }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', function (e) { if (e.target.closest('.amp-b,.amp-zb,.amp-zx,.amp-pos')) e.preventDefault(); }); /* clique não rouba o foco: Espaço continua sendo “Avançar” */
    wrap.addEventListener('click', function (e) {
      if (zm.contains(e.target)) { var z = e.target.closest('[data-z]'); if (z) { if (z.dataset.z === 'close') closeZoom(); else openZoom(zi + (z.dataset.z === 'next' ? 1 : -1)); } else if (e.target === zm) closeZoom(); return; }
      if (e.target.closest('.amp-zb')) { openZoom(hoverId || 0); return; }
      var b = e.target.closest('[data-a]');
      if (b) { var a = b.dataset.a; if (a === 'prev') go(cur - 1); else if (a === 'next') go(cur + 1); else if (a === 'full') full(); else if (a === 'zoom') openZoom(hoverId || 0); else if (a === 'exit' && opts.onExit) opts.onExit(); return; }
      if (!deckEl.contains(e.target) || zoomableNode(e.target) || (e.target.closest && e.target.closest('.am-ia'))) return; /* clique num gráfico é dele (duplo clique amplia) e num componente interativo (.am-ia: formulário, quadro, votação…) também; nunca das zonas de avançar/voltar */
      var r = deckEl.getBoundingClientRect(); if (e.clientX > r.left + r.width * .82) go(cur + 1); else if (e.clientX < r.left + r.width * .18) go(cur - 1);
    });
    deckEl.addEventListener('dblclick', function (e) { var n = zoomableNode(e.target); if (n) { e.preventDefault(); openZoom(n.dataset.id); } });
    deckEl.addEventListener('pointermove', function (e) { var n = zoomableNode(e.target); if (n) { hoverId = n.dataset.id; if (!zoomOpen) showZb(n); } else { hoverId = null; if (!zb.matches(':hover')) hideZb(450); } });
    deckEl.addEventListener('pointerleave', function () { hideZb(450); });
    zb.addEventListener('pointerenter', function () { clearTimeout(zbT); });
    zb.addEventListener('pointerleave', function () { hideZb(300); });
    bindTilt(deckEl);
    var start = visIdx(opts.start || 0); if (!opts.noHash) { var m = location.hash.match(/#\/(\d+)/); if (m) start = +m[1] - 1; }
    /* editar #/N na barra de endereço leva ao slide N */
    function onHash() { var h = location.hash.match(/#\/(\d+)/); if (h) go(+h[1] - 1); }
    if (!opts.noHash) window.addEventListener('hashchange', onHash);
    var kills = [], hd = { go: go, cur: function () { return cur; }, deck: deck, map: map.slice(), allHidden: all.length > 0 && all.every(function (s) { return s && s.hidden === true; }), root: wrap, deckEl: deckEl, opts: opts,
      zoom: { open: openZoom, close: closeZoom, isOpen: function () { return zoomOpen; }, list: function () { return zs.slice(); }, index: function () { return zi; } },
      onDestroy: function (f) { kills.push(f); },
      destroy: function () { closeZoom(); clearTimeout(zbT); if (clean) clean(); document.removeEventListener('keydown', key); window.removeEventListener('hashchange', onHash); kills.forEach(function (f) { try { f(); } catch (err) { } }); root.innerHTML = ''; } };
    /* extensões (rt-*.js) entram aqui: AMRT.hooks.player.push(function (hd) { … hd.deckEl … hd.onDestroy(fn) }) */
    API.hooks.player.forEach(function (f) { try { f(hd); } catch (err) { if (window.console) console.error(err); } });
    go(start);
    return hd;
  }
  /* ids únicos por render para clipPath/mask/gradiente (miniaturas e palco convivem no mesmo documento) */
  var NID = 0; function nid(p) { return (p || 'am') + (++NID).toString(36); }
  /* nome de um elemento fx para a interface (rodapé do “Ampliar”, cabeçalho do painel do editor): FX.kind.label(el) opcional, senão o nome do modelo */
  function fxLabel(el) { var F = el && FX[el.kind]; return (F && (typeof F.label === 'function' ? F.label(el) : F.name)) || 'Elemento'; }
  var API = { W: W, H: H, FX: FX, FONTS: FONTS, shapeBody: shapeBody, lineSVG: lineSVG, renderEl: renderEl, renderSlide: renderSlide, runFx: runFx, lineBox: lineBox, player: player, esc: esc,
    /* título do slide (índice, resumo, “Ampliar”), elementos ampliáveis de um slide, nome de um elemento fx e texto simples de um HTML guardado */
    slideTitle: slideTitle, zoomables: zoomables, flipOK: flipOK, fxLabel: fxLabel, plain: plain, isDark: isDark, stampNums: stampNums, cropOf: cropOf,
    /* capítulos (linha do tempo e índice), divisor de um slide, resumo automático (“Sobre este slide”) e textos livres de el.data */
    sectionsOf: sectionsOf, dividerOf: dividerOf, autoNotes: autoNotes, dataStrings: dataStrings,
    /* vocabulário de animações (entrada, contínuo, mouse, transição; extensões podem acrescentar famílias, ex.: emph) e inclinação 3D por cursor */
    ANIMS: ANIMS, bindTilt: bindTilt,
    /* pontos de extensão para rt-*.js: player = funções chamadas a cada player criado; shapeBody/lineSVG acima podem ser embrulhados;
       shapeInset(el) devolve o recuo do texto de uma forma ('0 0 22% 0') ou null; shapeText(el, w, h, html) pode reescrever o texto da forma */
    hooks: { player: [], show: [], key: [] }, shapeInset: null, shapeText: null,
    /* cores do componente (rt-05-pal.js): palHTML(el, html) troca as cores do markup, palTag(node, el) marca o .am-el e injeta o CSS */
    palHTML: null, palTag: null, palSweep: null,
    /* para arquivos de extensão rt-*.js (modelos, gráficos, ícones): os mesmos utilitários dos modelos internos */
    util: { E: E, arr: arr, VV: VV, num: num, fmt: fmt, fmtN: fmtN, CQ: CQ, P: P, lines: lines, textHTML: textHTML, esc: esc, nid: nid, colOr: colOr, ucols: ucols, lumHex: lumHex, mixHex: mixHex, ukeep: ukeep, kcols: kcols } };
  return API;
})();
