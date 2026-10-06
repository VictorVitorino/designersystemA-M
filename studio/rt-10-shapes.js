/* ===== Linhas e formas (S4, item 4.1): vai junto em todo arquivo exportado (assemble.py concatena rt-*.js ao runtime) =====
   Linhas: 3 rotas (reta, cotovelo com dobra ajustável, curva), 4 tracejados (tracejado, pontilhado, traço-ponto, traço longo) e
   5 pontas por extremidade (seta, seta aberta, bola, losango, barra). Os booleanos antigos headStart/headEnd continuam valendo
   (= seta); headS/headE escolhem o tipo. Tracejado: o traço visível não tem pathLength (tracejado em unidades reais) e “Desenhar”
   anima a máscara (.am-ln), como no runtime.js. Formas: 15 novas (shapeExtra) e 8 estilos de card (el.look) para retângulo,
   arredondado e pílula. Ids de máscara, recorte, filtro e gradiente vêm do contador do runtime (U.nid), nunca de el.id. */
(function (R) {
  'use strict';
  var U = R.util, baseShape = R.shapeBody;
  function f2(v) { return Math.round(v * 100) / 100; }
  function pts(P) { return 'M' + P.map(function (p) { return f2(p[0]) + ' ' + f2(p[1]); }).join('L') + 'Z'; }
  function fin(v, d) { v = +v; return isFinite(v) ? v : d; }

  /* ---------- tracejados: múltiplos da espessura; 0.01 + ponta redonda = ponto ---------- */
  var DASH = { dash: [3, 2], dot: [0.01, 2], dashdot: [3, 1.6, 0.01, 1.6], long: [6, 2.5] };
  function dashAttr(el, sw) {
    var k = el.dash ? (DASH.hasOwnProperty(el.dashS) ? el.dashS : 'dash') : null; if (!k || !sw) return '';
    return ' stroke-dasharray="' + DASH[k].map(function (m) { return f2(m * sw); }).join(' ') + '"' + (k === 'dot' || k === 'dashdot' ? ' stroke-linecap="round"' : '') +
      ' style="--dp:' + f2(DASH[k].reduce(function (s, m) { return s + m; }, 0) * sw) + 'px"';
  }

  /* ---------- rota: reta | cotovelo (horizontal primeiro quando |dx| ≥ |dy|; dobra = posição do segmento do meio) | curva ---------- */
  function bendOf(el) { var b = fin(el.bend, .5); return Math.max(.05, Math.min(.95, b)); }
  function routeOf(el) { return el.curve === 'elbow' || el.curve === 'curve' ? el.curve : 'straight'; }
  function lineGeom(el, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, route = routeOf(el);
    if (route === 'curve') {
      var hz = Math.abs(dx) >= Math.abs(dy), c1 = hz ? [x1 + dx * .5, y1] : [x1, y1 + dy * .5], c2 = hz ? [x2 - dx * .5, y2] : [x2, y2 - dy * .5];
      return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'C' + f2(c1[0]) + ' ' + f2(c1[1]) + ' ' + f2(c2[0]) + ' ' + f2(c2[1]) + ' ' + e[0] + ' ' + e[1]; }, a0: Math.atan2(c1[1] - y1, c1[0] - x1), a1: Math.atan2(y2 - c2[1], x2 - c2[0]) };
    }
    if (route === 'elbow') {
      var hz2 = Math.abs(dx) >= Math.abs(dy), b = bendOf(el), rr = Math.min(10, Math.abs(dx) / 2, Math.abs(dy) / 2), sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
      if (hz2) { var xm = f2(x1 + dx * b);
        return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'H' + f2(xm - sx * rr) + 'Q' + xm + ' ' + s[1] + ' ' + xm + ' ' + f2(s[1] + sy * rr) + 'V' + f2(e[1] - sy * rr) + 'Q' + xm + ' ' + e[1] + ' ' + f2(xm + sx * rr) + ' ' + e[1] + 'H' + e[0]; }, a0: dx < 0 ? Math.PI : 0, a1: dx < 0 ? Math.PI : 0 }; }
      var ym = f2(y1 + dy * b);
      return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'V' + f2(ym - sy * rr) + 'Q' + s[0] + ' ' + ym + ' ' + f2(s[0] + sx * rr) + ' ' + ym + 'H' + f2(e[0] - sx * rr) + 'Q' + e[0] + ' ' + ym + ' ' + e[0] + ' ' + f2(ym + sy * rr) + 'V' + e[1]; }, a0: dy < 0 ? -Math.PI / 2 : Math.PI / 2, a1: dy < 0 ? -Math.PI / 2 : Math.PI / 2 };
    }
    var an = Math.atan2(dy, dx);
    return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'L' + e[0] + ' ' + e[1]; }, a0: an, a1: an };
  }
  /* ---------- pontas: o traço recua HEAD_BACK × tamanho para não atravessar a ponta ---------- */
  var HEAD_BACK = { arrow: .8, open: .12, dot: .7, diamond: 1.5, bar: 0 };
  function headSVG(kind, px, py, a, s, c, sw) {
    var co = Math.cos(a), si = Math.sin(a), bx = px - s * co, by = py - s * si, ox = -si * s * .55, oy = co * s * .55;
    if (kind === 'open') return '<path class="am-head" d="M' + f2(bx + ox) + ' ' + f2(by + oy) + 'L' + px + ' ' + py + 'L' + f2(bx - ox) + ' ' + f2(by - oy) + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
    if (kind === 'dot') return '<circle class="am-head" cx="' + f2(px - co * s * .4) + '" cy="' + f2(py - si * s * .4) + '" r="' + f2(s * .42) + '" fill="' + c + '"/>';
    if (kind === 'diamond') { var mx = px - co * s * .9, my = py - si * s * .9, bx2 = px - co * s * 1.8, by2 = py - si * s * 1.8; return '<path class="am-head" d="M' + px + ' ' + py + 'L' + f2(mx + ox * .8) + ' ' + f2(my + oy * .8) + 'L' + f2(bx2) + ' ' + f2(by2) + 'L' + f2(mx - ox * .8) + ' ' + f2(my - oy * .8) + 'Z" fill="' + c + '"/>'; }
    if (kind === 'bar') return '<path class="am-head" d="M' + f2(px + ox) + ' ' + f2(py + oy) + 'L' + f2(px - ox) + ' ' + f2(py - oy) + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
    return '<path class="am-head" d="M' + px + ' ' + py + 'L' + (bx + ox) + ' ' + (by + oy) + 'L' + (bx - ox) + ' ' + (by - oy) + 'Z" fill="' + c + '"/>';
  }
  function headOf(el, k, b) { return HEAD_BACK.hasOwnProperty(el[k]) ? el[k] : (el[b] ? 'arrow' : null); }
  R.lineSVG = function (el) {
    var b = R.lineBox(el), x1 = el.x1 - b.x, y1 = el.y1 - b.y, x2 = el.x2 - b.x, y2 = el.y2 - b.y, sw = +el.strokeW || 2, c = U.esc(el.stroke || '#002A46'), s = Math.max(9, sw * 3.4);
    var hs = headOf(el, 'headS', 'headStart'), he = headOf(el, 'headE', 'headEnd'), g = lineGeom(el, x1, y1, x2, y2), heads = '', S = [x1, y1], E = [x2, y2];
    if (he) { heads += headSVG(he, x2, y2, g.a1, s, c, sw); E = [x2 - Math.cos(g.a1) * s * HEAD_BACK[he], y2 - Math.sin(g.a1) * s * HEAD_BACK[he]]; }
    if (hs) { heads += headSVG(hs, x1, y1, g.a0 + Math.PI, s, c, sw); S = [x1 + Math.cos(g.a0) * s * HEAD_BACK[hs], y1 + Math.sin(g.a0) * s * HEAD_BACK[hs]]; }
    S = S.map(f2); E = E.map(f2);
    var d = g.d(S, E), dsh = dashAttr(el, sw), svg = '<svg viewBox="0 0 ' + b.w + ' ' + b.h + '"><path class="am-hit" d="' + g.d([f2(x1), f2(y1)], [f2(x2), f2(y2)]) + '" stroke="transparent" stroke-width="' + Math.max(14, sw + 10) + '" stroke-linecap="round" fill="none"/>';
    if (!dsh) return svg + '<path class="am-ln" pathLength="1" d="' + d + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"' + (routeOf(el) === 'straight' ? '' : ' stroke-linejoin="round"') + ' fill="none"/>' + heads + '</svg>';
    var mid = U.nid('lm');
    return svg + '<mask id="' + mid + '" maskUnits="userSpaceOnUse" x="0" y="0" width="' + b.w + '" height="' + b.h + '"><path class="am-ln" pathLength="1" d="' + d + '" stroke="#fff" stroke-width="' + (sw + 4) + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/></mask><path class="am-lnd" d="' + d + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linejoin="round" fill="none"' + dsh + ' mask="url(#' + mid + ')"/>' + heads + '</svg>';
  };
  /* ponto da dobra do cotovelo (coordenadas do slide), para a alça que o editor deixa arrastar */
  R.lineBendPt = function (el) {
    var dx = el.x2 - el.x1, dy = el.y2 - el.y1, b = bendOf(el);
    return Math.abs(dx) >= Math.abs(dy) ? { x: el.x1 + dx * b, y: (el.y1 + el.y2) / 2, hz: true } : { x: (el.x1 + el.x2) / 2, y: el.y1 + dy * b, hz: false };
  };
  R.LINE_ROUTES = ['straight', 'elbow', 'curve']; R.LINE_DASHES = ['dash', 'dot', 'dashdot', 'long']; R.LINE_HEADS = ['arrow', 'open', 'dot', 'diamond', 'bar'];

  /* ---------- formas novas (i = metade do contorno, a = atributos de preenchimento/contorno) ---------- */
  function shapeExtra(el, w, h, i, a) {
    var k, t, s = el.shape;
    switch (s) {
      case 'pentagon': k = Math.min(w * .3, h * .5); return '<path d="' + pts([[i, i], [w - k, i], [w - i, h / 2], [w - k, h - i], [i, h - i]]) + '" ' + a + '/>';
      case 'hexagon': k = Math.min(w * .25, h * .5); return '<path d="' + pts([[k, i], [w - k, i], [w - i, h / 2], [w - k, h - i], [k, h - i], [i, h / 2]]) + '" ' + a + '/>';
      case 'octagon': k = Math.min(w, h) * .29; return '<path d="' + pts([[k, i], [w - k, i], [w - i, k], [w - i, h - k], [w - k, h - i], [k, h - i], [i, h - k], [i, k]]) + '" ' + a + '/>';
      case 'trapezoid': k = Math.min(w * .22, h * .6); return '<path d="' + pts([[k, i], [w - k, i], [w - i, h - i], [i, h - i]]) + '" ' + a + '/>';
      case 'rtri': return '<path d="' + pts([[i, i], [w - i, h - i], [i, h - i]]) + '" ' + a + '/>';
      case 'star': {
        var Rx = (w - 2 * i) / 1.902, Ry = (h - 2 * i) / 1.809, cx = w / 2, cy = i + Ry, P = [];
        for (k = 0; k < 10; k++) { var ang = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? .45 : 1; P.push([cx + Math.cos(ang) * Rx * q, cy + Math.sin(ang) * Ry * q]); }
        return '<path d="' + pts(P) + '" ' + a + '/>';
      }
      case 'plus': { t = Math.min(w, h) * .34; var x1 = (w - t) / 2, x2 = (w + t) / 2, y1 = (h - t) / 2, y2 = (h + t) / 2;
        return '<path d="' + pts([[x1, i], [x2, i], [x2, y1], [w - i, y1], [w - i, y2], [x2, y2], [x2, h - i], [x1, h - i], [x1, y2], [i, y2], [i, y1], [x1, y1]]) + '" ' + a + '/>'; }
      case 'ring': { t = Math.min(w, h) * .15; var rx = f2(w / 2 - i), ry = f2(h / 2 - i), ix = f2(Math.max(1, rx - t)), iy = f2(Math.max(1, ry - t));
        return '<path fill-rule="evenodd" d="M' + i + ' ' + h / 2 + 'a' + rx + ' ' + ry + ' 0 1 0 ' + 2 * rx + ' 0a' + rx + ' ' + ry + ' 0 1 0-' + 2 * rx + ' 0zM' + f2(w / 2 - ix) + ' ' + h / 2 + 'a' + ix + ' ' + iy + ' 0 1 0 ' + 2 * ix + ' 0a' + ix + ' ' + iy + ' 0 1 0-' + 2 * ix + ' 0z" ' + a + '/>'; }
      case 'callout': { /* retângulo arredondado + rabicho embaixo à esquerda */
        var bb = f2(h * .78), rr = f2(Math.max(0, Math.min(fin(el.radius, 12) || 12, w / 4, bb / 3))), t1 = f2(w * .16), t2 = f2(w * .3), tx = f2(w * .12);
        return '<path d="M' + (i + rr) + ' ' + i + 'H' + (w - i - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (w - i) + ' ' + (i + rr) + 'V' + (bb - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (w - i - rr) + ' ' + bb + 'H' + t2 + 'L' + tx + ' ' + (h - i) + 'L' + t1 + ' ' + bb + 'H' + (i + rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + i + ' ' + (bb - rr) + 'V' + (i + rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (i + rr) + ' ' + i + 'Z" ' + a + '/>';
      }
      case 'darrow': k = Math.min(w * .26, h * .7); return '<path d="' + pts([[i, h / 2], [k, i], [k, h * .28], [w - k, h * .28], [w - k, i], [w - i, h / 2], [w - k, h - i], [w - k, h * .72], [k, h * .72], [k, h - i]]) + '" ' + a + '/>';
      case 'notch': k = Math.min(w * .32, h * .7); return '<path d="' + pts([[i, h * .28], [w - k, h * .28], [w - k, i], [w - i, h / 2], [w - k, h - i], [w - k, h * .72], [i, h * .72], [k * .45, h / 2]]) + '" ' + a + '/>';
      case 'cylinder': { var e = f2(Math.min(h * .14, w * .25)), crx = f2(w / 2 - i);
        return '<path d="M' + i + ' ' + (i + e) + 'V' + f2(h - i - e) + 'A' + crx + ' ' + e + ' 0 0 0 ' + (w - i) + ' ' + f2(h - i - e) + 'V' + (i + e) + '" ' + a + '/><ellipse cx="' + w / 2 + '" cy="' + (i + e) + '" rx="' + crx + '" ry="' + e + '" ' + a + '/>';
      }
      case 'wave': { /* documento de fluxograma: base ondulada */
        var y = f2(h * .84), ww = w - 2 * i;
        return '<path d="M' + i + ' ' + i + 'H' + (w - i) + 'V' + y + 'C' + f2(i + ww * .75) + ' ' + f2(y - h * .16) + ' ' + f2(i + ww * .5) + ' ' + f2(h - i + h * .02) + ' ' + f2(i + ww * .25) + ' ' + f2(h - i - h * .06) + 'S' + i + ' ' + y + ' ' + i + ' ' + y + 'Z" ' + a + '/>';
      }
      case 'brackets': case 'braces': { /* só traço; a cor vem do contorno (ou do preenchimento, se não houver contorno) */
        var sw = Math.max(+el.strokeW || 0, 3), c = U.esc(el.stroke && el.stroke !== 'none' ? el.stroke : (el.fill && el.fill !== 'none' ? el.fill : '#002A46')), j = sw / 2, qq = Math.min(w * .1, 22), L, Rt;
        var at = 'fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"' + dashAttr(el, sw);
        if (s === 'brackets') { L = 'M' + f2(j + qq) + ' ' + j + 'H' + j + 'V' + f2(h - j) + 'H' + f2(j + qq); Rt = 'M' + f2(w - j - qq) + ' ' + j + 'H' + f2(w - j) + 'V' + f2(h - j) + 'H' + f2(w - j - qq); }
        else { var m = Math.min(qq, h * .12), xm = f2(j + qq / 2);
          L = 'M' + f2(j + qq) + ' ' + j + 'Q' + xm + ' ' + j + ' ' + xm + ' ' + f2(j + m) + 'V' + f2(h / 2 - m) + 'Q' + xm + ' ' + f2(h / 2) + ' ' + j + ' ' + f2(h / 2) + 'Q' + xm + ' ' + f2(h / 2) + ' ' + xm + ' ' + f2(h / 2 + m) + 'V' + f2(h - j - m) + 'Q' + xm + ' ' + f2(h - j) + ' ' + f2(j + qq) + ' ' + f2(h - j);
          Rt = L.replace(/([MQHVL ])(-?[\d.]+) (-?[\d.]+)/g, function (all, cmd, x, yy) { return cmd + f2(w - x) + ' ' + yy; }); }
        return '<path d="' + L + '" ' + at + '/><path d="' + Rt + '" ' + at + '/>';
      }
    }
    return null;
  }
  R.SHAPES_X = ['pentagon', 'hexagon', 'octagon', 'trapezoid', 'rtri', 'star', 'plus', 'ring', 'callout', 'darrow', 'notch', 'cylinder', 'wave', 'brackets', 'braces'];

  /* ---------- estilos de card (el.look) para retângulo / arredondado / pílula: camadas sobre o corpo ou troca de preenchimento ---------- */
  var LOOKS = ['flat', 'outline', 'lift', 'accent', 'topbar', 'header', 'gradient', 'ice'];
  R.LOOKS = LOOKS;
  function setAttr(body, k, v) { return body.replace(new RegExp(' ' + k + '="[^"]*"'), ' ' + k + '="' + v + '"'); }
  function cardLook(el, w, h, body) {
    var lk = el.look; if (!lk || lk === 'flat' || LOOKS.indexOf(lk) < 0 || (el.shape && ['rect', 'round', 'pill'].indexOf(el.shape) < 0)) return body;
    var sw = +el.strokeW || 0, i = sw / 2, r = Math.max(0, Math.min(+el.radius || 0, w / 2, h / 2)), id = U.nid('kl');
    r = el.shape === 'pill' ? Math.min(w, h) / 2 - i : el.shape === 'round' ? (r || Math.min(w, h) * .12) : r;
    var clip = '<defs><clipPath id="' + id + '"><rect x="' + i + '" y="' + i + '" width="' + (w - sw) + '" height="' + (h - sw) + '" rx="' + f2(r) + '"/></clipPath></defs>', cp = ' clip-path="url(#' + id + ')"';
    if (lk === 'accent') return body + clip + '<rect width="' + f2(Math.max(6, w * .018)) + '" height="' + h + '" fill="#F78C16"' + cp + '/>';
    if (lk === 'topbar') return body + clip + '<rect width="' + w + '" height="' + f2(Math.max(5, h * .03)) + '" fill="#F78C16"' + cp + '/>';
    if (lk === 'header') return body + clip + '<rect width="' + w + '" height="' + f2(h * .26) + '" fill="#002A46"' + cp + '/>';
    if (lk === 'gradient') return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2=".55" y2="1"><stop offset="0" stop-color="#0B3A63"/><stop offset=".55" stop-color="#002A46"/><stop offset="1" stop-color="#001E32"/></linearGradient></defs>' + setAttr(body, 'fill', 'url(#' + id + ')');
    var light = sw ? body : setAttr(setAttr(body, 'stroke', lk === 'ice' ? '#CFDAE6' : '#CBD4E1'), 'stroke-width', lk === 'lift' ? '0' : lk === 'ice' ? '1.2' : '1.5');
    if (lk === 'outline') return setAttr(light, 'fill', '#FFFFFF');
    if (lk === 'lift') { var m = Math.min(w, h); /* card elevado: branco, sombra suave em azul-marinho (camada própria, sem depender do “Sombra”) */
      return '<defs><filter id="' + id + '" x="-20%" y="-20%" width="140%" height="175%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="' + f2(Math.max(2, m * .035)) + '" stdDeviation="' + f2(Math.max(3, m * .055)) + '" flood-color="#002A46" flood-opacity=".16"/></filter></defs>' + setAttr(light, 'fill', '#FFFFFF').replace(/^<(\w+) /, '<$1 filter="url(#' + id + ')" '); }
    /* ice: gelo translúcido (gradiente branco → gelo) com fio de luz por dentro; serve no fundo branco e no azul-marinho */
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".96"/><stop offset="1" stop-color="#DCE5F0" stop-opacity=".88"/></linearGradient></defs>' + setAttr(light, 'fill', 'url(#' + id + ')') +
      '<rect x="' + f2(i + 1.5) + '" y="' + f2(i + 1.5) + '" width="' + f2(Math.max(0, w - sw - 3)) + '" height="' + f2(Math.max(0, h - sw - 3)) + '" rx="' + f2(Math.max(0, r - 1.5)) + '" fill="none" stroke="#FFFFFF" stroke-opacity=".85" stroke-width="1"/>';
  }

  R.shapeBody = function (el, w, h) {
    var sw = +el.strokeW || 0, i = sw / 2, a = 'fill="' + U.esc(el.fill || 'none') + '" stroke="' + U.esc(sw ? (el.stroke || 'none') : 'none') + '" stroke-width="' + sw + '"' + (el.dash ? ' stroke-dasharray="' + sw * 3 + ' ' + sw * 2 + '"' : '');
    var x = shapeExtra(el, w, h, i, a);
    return x != null ? x : cardLook(el, w, h, baseShape(el, w, h));
  };
  /* cabeçalho navy: o título leva o próprio fundo navy até as bordas do card, então a faixa cresce com ele (título longo ou card
     pequeno não deixa linha branca sobre o corpo branco). Mínimo = a faixa de 26 % desenhada no SVG (miniaturas e card vazio);
     recorte no mesmo raio do card, estendido para baixo. Texto sempre no alto: é a faixa que carrega o título */
  R.shapeText = function (el, w, h, tx) {
    var C = U.CQ;
    if (PADX.hasOwnProperty(el.shape)) return tx.replace('padding:' + C(14) + '"', 'padding:' + C(14) + ' ' + C(PADX[el.shape]) + '"');
    if (el.look !== 'header' || (el.shape && ['rect', 'round', 'pill'].indexOf(el.shape) < 0)) return tx;
    var sw = +el.strokeW || 0, i = sw / 2, r = Math.max(0, Math.min(+el.radius || 0, w / 2, h / 2));
    r = el.shape === 'pill' ? Math.min(w, h) / 2 - i : el.shape === 'round' ? (r || Math.min(w, h) * .12) : r;
    return tx.replace('"><div class="am-tx"', ';justify-content:flex-start"><div class="am-tx" style="background:#002A46;flex-shrink:0;margin:-' + C(14) + ' -' + C(14) + ' 0;padding:' + C(14) + ' ' + C(14) + ' ' + C(10) +
      ';min-height:' + C(h * .26) + ';clip-path:inset(' + C(i) + ' ' + C(i) + ' -100cqw ' + C(i) + ' round ' + C(Math.max(0, r)) + ')"');
  };
  /* recuo do texto (% da caixa: topo direita base esquerda) nas formas com ponta, rabicho ou tampa. Estrela: faixa dos braços (a parte
     mais larga, 66 % da caixa); anel: o furo (o traço do anel tem 15 % do lado menor; o texto leva a cor de texto do slide) */
  var INSET = { callout: '0 0 22% 0', triangle: '35% 18% 0 18%', rtri: '42% 38% 4% 4%', star: '28% 17% 30% 17%', ring: '15%', cylinder: '18% 0 6% 0', wave: '0 0 16% 0', pentagon: '0 18% 0 0', notch: '0 18% 0 0', darrow: '0 14%', trapezoid: '0 12%', brackets: '0 8%', braces: '0 8%' };
  /* respiro lateral menor (px do slide) onde a área do texto já é estreita: palavras comuns não quebram no meio (“Priorid/ade”) */
  var PADX = { star: 4, ring: 4 };
  R.shapeInset = function (el) { return INSET.hasOwnProperty(el.shape) ? INSET[el.shape] : null; };
})(window.AMRT);
