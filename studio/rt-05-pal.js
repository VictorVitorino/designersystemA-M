/* ===== rt-05-pal.js — "Cores do componente" (S20): recolore UM componente (el.pal = {p: cor principal, a: cor de destaque}) =====
   Vai junto em todo arquivo exportado (concatenado ao runtime). Sem el.pal nada aqui roda (runtime.js só chama palHTML/palTag
   quando el.pal existe).
   Família AZUL (navy #002A46 e os azuis/aços/gelos da marca: matiz 195–225°, saturação ≥ 0,26) -> matiz da cor principal,
   saturação proporcional e a MESMA luminância do original (navy -> versão escura da principal, gelo -> versão clara): todo
   contraste entre esses tons, o branco e os cinzas fica igual ao do A&M. Família LARANJA (#F78C16 e tons: matiz 20–45°,
   saturação ≥ 0,5) -> cor de destaque, com os tons claros/escuros na mesma posição relativa. Branco, preto, cinzas (#3E4C5E…)
   e cores de status ficam como estão. Alfa preservado.
   1) markup: só os atributos de cor (style, fill, stroke, stop-color, flood-color, color) do HTML que FX[kind].html devolveu;
      textos (nós de texto) nunca são tocados. Cores escritas como #RRGGBBAA (8 dígitos) ficam como estão: é assim que os gráficos
      escrevem as cores de série que o usuário escolheu (data.colors, U.ukeep), que valem exatamente como foram escolhidas.
   2) folhas de estilo: na primeira vez, um índice das regras do CSS do runtime (#am-runtime-css; no arquivo exportado, o <style>
      do runtime) que mexem em propriedades que levam cores da marca (inclusive dentro de @media/@supports e os @keyframes com
      cores). Para cada paleta distinta, UM <style id="am-pal-<chave>"> logo depois do CSS do runtime, só com as regras das
      classes presentes nos elementos dessa paleta (mesma especificidade, graças ao :where), restritas a [data-pal="<chave>"] e
      às cores trocadas; vence a original pela ordem no documento. Keyframes com cores usados por essas regras ganham uma cópia
      renomeada (<nome>--<chave>). Sobre o fundo de destaque, o texto vira branco ou a principal escura quando o destaque
      escolhido deixaria o par ilegível (ink). Folhas que nenhum elemento usa mais saem sozinhas (palSweep). */
(function (R) {
  'use strict';
  if (!R) return;
  var HEX = /^#[0-9a-f]{6}$/i;
  function norm(pal) {
    if (!pal || typeof pal !== 'object' || Array.isArray(pal)) return null;
    var o = {};
    if (typeof pal.p === 'string' && HEX.test(pal.p)) o.p = pal.p.toUpperCase();
    if (typeof pal.a === 'string' && HEX.test(pal.a)) o.a = pal.a.toUpperCase();
    return o.p || o.a ? o : null;
  }
  function keyOf(n) { return ((n.p ? n.p.slice(1) : 'x') + (n.a ? n.a.slice(1) : 'x')).toLowerCase(); }

  /* ---------- cor ---------- */
  function hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) {
      s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [h, s, l];
  }
  function rgb(h, s, l) {
    function f(n) { var k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }
    return [f(0), f(8), f(4)];
  }
  function lin(c) { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
  function lum(c) { return .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]); }
  function hexRGB(x) { var n = parseInt(x.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; }
  function cl(v) { return Math.max(0, Math.min(1, v)); }
  var NAVY = hsl(0, 42, 70), ORANGE = hsl(247, 140, 22);
  /* 'p' = família azul/navy, 'a' = família laranja, '' = não mexe */
  function family(c) {
    var x = hsl(c[0], c[1], c[2]);
    if (x[1] >= .26 && x[0] >= 195 && x[0] <= 225) return 'p';
    if (x[1] >= .5 && x[0] >= 20 && x[0] <= 45) return 'a';
    return '';
  }
  /* mapeador de uma paleta: [r,g,b] -> [r,g,b] (ou null = fica como está) */
  /* claridade L (matiz h, saturação sa) cuja luminância relativa é y: o tom recolorido tem o mesmo contraste que o original
     com o branco, os cinzas e os outros azuis do modelo (textos continuam legíveis) */
  function solveL(h, sa, y) { var lo = 0, hi = 1; for (var i = 0; i < 20; i++) { var m = (lo + hi) / 2; if (lum(rgb(h, sa, m)) < y) lo = m; else hi = m; } return (lo + hi) / 2; }
  function mapper(n) {
    var P = n.p ? hsl.apply(null, hexRGB(n.p)) : null, A = n.a ? hsl.apply(null, hexRGB(n.a)) : null;
    return function (col) {
      var f = family(col); if (!f || (f === 'p' && !P) || (f === 'a' && !A)) return null;
      var x = hsl(col[0], col[1], col[2]), L, sa;
      if (f === 'p') { sa = cl(x[1] * P[1] / NAVY[1]); return rgb(P[0], sa, solveL(P[0], sa, lum(col))); }
      L = x[2] > ORANGE[2] ? A[2] + (1 - A[2]) * (x[2] - ORANGE[2]) / (1 - ORANGE[2]) : A[2] * x[2] / ORANGE[2];
      return rgb(A[0], cl(x[1] * A[1] / ORANGE[1]), cl(L));
    };
  }
  function h2(v) { return (v < 16 ? '0' : '') + v.toString(16).toUpperCase(); }
  var RE_HEX = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z_-])/gi, RE_RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+%?)\s*)?\)/gi;
  /* troca as cores de um texto CSS/atributo; cache por paleta */
  function recolor(str, M) {
    if (str.indexOf('#') < 0 && str.indexOf('rgb') < 0) return str;
    return str.replace(RE_HEX, function (m, hx) {
      if (M.memo[m] !== undefined) return M.memo[m];
      if (hx.length === 3) hx = hx[0] + hx[0] + hx[1] + hx[1] + hx[2] + hx[2];
      var o = M.fn(hexRGB('#' + hx)); return (M.memo[m] = o ? '#' + h2(o[0]) + h2(o[1]) + h2(o[2]) : m);
    }).replace(RE_RGB, function (m, r, g, b, a) {
      if (M.memo[m] !== undefined) return M.memo[m];
      var o = M.fn([+r, +g, +b]); return (M.memo[m] = o ? (a != null ? 'rgba(' + o.join(',') + ',' + a + ')' : 'rgb(' + o.join(',') + ')') : m);
    });
  }
  var MAPS = {};
  function mapOf(n, k) { return MAPS[k] || (MAPS[k] = { fn: mapper(n), memo: {} }); }

  /* ---------- 1) markup ---------- */
  var RE_TAG = /<[^>]*>/g, RE_ATTR = /(\s(?:style|fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
  function palHTML(el, html) {
    var n = norm(el && el.pal); if (!n || typeof html !== 'string') return html;
    var M = mapOf(n, keyOf(n));
    return html.replace(RE_TAG, function (t) {
      if (t.indexOf('#') < 0 && t.indexOf('rgb') < 0) return t;
      return t.replace(RE_ATTR, function (m, a, v2, v1) { return v2 != null ? a + '"' + recolor(v2, M) + '"' : a + "'" + recolor(v1, M) + "'"; });
    });
  }

  /* ---------- 2) folhas de estilo ---------- */
  /* IDX.items = regras do CSS do runtime (achatadas, na ordem do documento) que mexem em grupos com cor da marca; cada uma guarda
     as classes do composto final (o "sujeito") de cada seletor, sem as classes de estado que o player liga depois (DYN) */
  var IDX = null, KF = [], STY = {}, sweepT = 0, sigs = {};
  var DYN = { on: 1, 'cy-on': 1, 'cy-active': 1, tilting: 1, 'ic-go': 1, 'ic-on': 1, dark: 1, 'am-in': 1, 'am-pre': 1, 'am-play': 1, 'am-edit': 1, previewing: 1 };
  function runtimeSheet() {
    var n = document.getElementById('am-runtime-css');
    if (!n) { var ss = document.querySelectorAll('style'); for (var i = 0; i < ss.length; i++) if (/\.am-stage\b/.test(ss[i].textContent) && /\.am-el\b/.test(ss[i].textContent)) { n = ss[i]; break; } }
    return n && n.sheet ? n : null;
  }
  function hasFam(s) {
    var f = false;
    if (s.indexOf('#') < 0 && s.indexOf('rgb') < 0) return false;
    s.replace(RE_HEX, function (m, hx) { if (hx.length === 3) hx = hx[0] + hx[0] + hx[1] + hx[1] + hx[2] + hx[2]; if (family(hexRGB('#' + hx))) f = true; return m; })
      .replace(RE_RGB, function (m, r, g, b) { if (family([+r, +g, +b])) f = true; return m; });
    return f;
  }
  /* divide no nível 0 (fora de parênteses, colchetes e aspas) */
  function split(s, ch) {
    var out = [], d = 0, q = '', a = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; else if (c === ch && !d) { out.push(s.slice(a, i)); a = i + 1; }
    }
    out.push(s.slice(a)); return out;
  }
  function decls(css) {
    return split(css, ';').map(function (x) { var i = x.indexOf(':'); if (i < 0) return null; var p = x.slice(0, i).trim(), v = x.slice(i + 1).trim(); return p && v ? [p, v] : null; }).filter(Boolean);
  }
  /* propriedades que disputam a mesma cor na cascata (abreviação + longas): background*, border*-color, outline*, animation* … */
  function group(p) {
    if (p.indexOf('--') === 0) return p;
    p = p.replace(/^-(webkit|moz|ms)-/, '');
    if (/^background/.test(p)) return 'background';
    if (/^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?$/.test(p)) return 'border';
    if (/^(outline|text-decoration|text-emphasis|column-rule|animation)/.test(p)) return p.split('-')[0] + (/^text|^column/.test(p) ? '-' + p.split('-')[1] : '');
    return p;
  }
  /* início do composto final de um seletor simples (depois do último combinador no nível 0) */
  function lastCompound(s) {
    var d = 0, q = '', st = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
      else if (!d && (c === ' ' || c === '>' || c === '+' || c === '~')) st = i + 1;
    }
    return st;
  }
  /* classes que identificam o componente de cada seletor da lista: as do composto mais à direita que tem alguma classe (o sujeito;
     “.gt-grid i” → gt-grid), fora de :not()/:is() e das classes de estado (DYN). Classes de contexto do runtime (am-stage, am-el,
     amp-slide…, menos am-k-… e am-t-…) valem para todos: [] = regra genérica, entra sempre */
  function subj(sel) {
    return split(sel, ',').map(function (s) {
      s = s.trim();
      for (var end = s.length; end > 0;) {
        var st = lastCompound(s.slice(0, end)), t = s.slice(st, end), d = 0, out = [], ctx = false, m;
        for (var i = 0; i < t.length; i++) {
          var c = t[i];
          if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
          else if (c === '.' && !d && (m = /^[\w-]+/.exec(t.slice(i + 1)))) { if (DYN[m[0]]) { } else if (/^amp?-/.test(m[0]) && !/^am-[kt]-/.test(m[0])) ctx = true; else out.push(m[0]); i += m[0].length; }
        }
        if (out.length || ctx) return out;
        end = st; while (end > 0 && /[\s>+~]/.test(s[end - 1])) end--;
      }
      return [];
    });
  }
  function build() {
    var node = runtimeSheet(); IDX = { node: node, items: [], groups: {}, kre: null }; KF = []; sigs = {};
    if (!node) return IDX;
    var raw = [], kf = {};
    function walk(rules, med) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.type === 1 && r.selectorText) { var ds = decls(r.style.cssText); if (ds.length) raw.push({ s: r.selectorText, d: ds, m: med }); }
        else if (r.type === 4 || r.type === 12) walk(r.cssRules, med.concat([r.type === 4 ? '@media ' + r.conditionText : '@supports ' + r.conditionText]));
        else if (r.type === 7 && hasFam(r.cssText)) { kf[r.name] = 1; KF.push({ n: r.name, t: r.cssText }); }
      }
    }
    try { walk(node.sheet.cssRules, []); } catch (er) { return IDX; }
    var names = Object.keys(kf);
    IDX.kre = names.length ? new RegExp('(^|[\\s,])(' + names.map(function (x) { return x.replace(/[^\w-]/g, '\\$&'); }).join('|') + ')(?=$|[\\s,;!])', 'g') : null;
    /* grupos de propriedades que levam cor da marca (background, border, color, fill, stroke, box, filter, --var…) */
    raw.forEach(function (it) { it.d.forEach(function (d) { if (hasFam(d[1])) IDX.groups[group(d[0])] = 1; }); });
    if (IDX.kre) IDX.groups.animation = 1;
    /* fica só o que toca esses grupos (todas as declarações desses grupos, mesmo sem cor da marca: a ordem da cascata se mantém) */
    raw.forEach(function (it) {
      var ds = it.d.filter(function (d) { return IDX.groups[group(d[0])]; });
      if (ds.length) IDX.items.push({ s: it.s, d: ds, m: it.m.join('\u0001'), mq: it.m, sj: subj(it.s) });
    });
    return IDX;
  }
  /* regras que valem para um elemento: alguma classe exigida pelo sujeito existe no elemento (ou o sujeito não exige classe) */
  function needed(node) {
    var cls = {}, list = [node].concat(Array.prototype.slice.call(node.querySelectorAll('[class]')));
    list.forEach(function (e) { String(e.getAttribute('class') || '').split(/\s+/).forEach(function (c) { if (c) cls[c] = 1; }); });
    var sig = Object.keys(cls).sort().join(' ');
    if (sigs[sig]) return sigs[sig];
    var out = [];
    IDX.items.forEach(function (it, i) { if (it.sj.some(function (l) { return !l.length || l.some(function (c) { return cls[c]; }); })) out.push(i); });
    return (sigs[sig] = out);
  }
  /* :where(escopo) no composto final de cada seletor, antes de um pseudo-elemento */
  function scope(sel, sc) {
    return split(sel, ',').map(function (s) {
      s = s.trim(); var st = lastCompound(s);
      var tail = s.slice(st), pm = /::|:(before|after|first-line|first-letter)\b/i.exec(tail), at = pm ? st + pm.index : s.length;
      return s.slice(0, at) + ':where(' + sc + ')' + s.slice(at);
    }).join(',');
  }
  /* cor sólida de um valor CSS (o CSSOM serializa as cores como rgb()/rgba()); null = gradiente, var(), translúcida… */
  function solid(v) {
    v = String(v).replace(/\s*!important\s*$/i, '').trim();
    var m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v);
    if (m) { var hx = m[1]; if (hx.length === 3) hx = hx[0] + hx[0] + hx[1] + hx[1] + hx[2] + hx[2]; return hexRGB('#' + hx); }
    m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
    if (m && (m[4] == null || +m[4] >= .95)) return [+m[1], +m[2], +m[3]];
    if (/^white$/i.test(v)) return [255, 255, 255];
    return null;
  }
  function con(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  var WHITE = [255, 255, 255], NAVYC = [0, 42, 70];
  /* tinta legível sobre a cor de destaque: numa regra cujo fundo é o laranja A&M (agora a cor de destaque), se o texto (o declarado
     ali ou — sem declaração — o branco/navy que a A&M usa sobre o laranja) cair abaixo de 3:1 E abaixo do contraste original, o texto
     vira o melhor entre o branco e a principal escura. Um destaque tão escuro quanto o laranja A&M não muda nada */
  function ink(it, M) {
    var bg = null; it.d.forEach(function (d) { if (group(d[0]) === 'background') { var c = solid(d[1]); bg = c && family(c) === 'a' ? c : null; } });
    if (!bg) return null;
    var bn = M.fn(bg); if (!bn) return null;
    var nv = M.fn(NAVYC) || NAVYC, best = con(WHITE, bn) >= con(nv, bn) ? WHITE : nv, fg = null;
    it.d.forEach(function (d) { if (d[0] === 'color') fg = solid(d[1]); });
    if (fg) { var fn = M.fn(fg) || fg, cn = con(fn, bn); return cn < Math.min(3, con(fg, bg)) - .05 && con(best, bn) > cn ? 'rgb(' + best.join(',') + ')' : null; }
    return con(WHITE, bn) < Math.min(3, con(WHITE, bg)) - .05 || con(nv, bn) < Math.min(3, con(NAVYC, bg)) - .05 ? 'rgb(' + best.join(',') + ')' : null;
  }
  function closeMq(m) { return m ? new Array(m.split('\u0001').length + 1).join('}') + '\n' : ''; }
  function css(k, M, inc) {
    var ix = IDX, sc = '[data-pal="' + k + '"],[data-pal="' + k + '"] *', out = '', used = {}, body = '', open = '';
    function val(p, v) {
      v = recolor(v, M);
      if (ix.kre && group(p) === 'animation') v = v.replace(ix.kre, function (m, a, nm) { used[nm] = 1; return a + nm + '--' + k; });
      return v;
    }
    Object.keys(inc).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
      var it = ix.items[i];
      if (it.m !== open) { body += closeMq(open); open = it.m; if (open) body += it.mq.join('{') + '{'; }
      var tx = ink(it, M), ds = it.d.map(function (d) { return d[0] + ':' + (tx && d[0] === 'color' ? tx : val(d[0], d[1])); });
      if (tx && !it.d.some(function (d) { return d[0] === 'color'; })) ds.push('color:' + tx);
      body += scope(it.s, sc) + '{' + ds.join(';') + '}\n';
    });
    body += closeMq(open);
    /* só os keyframes que as regras incluídas usam */
    KF.forEach(function (f) { if (used[f.n]) out += recolor(f.t, M).replace(/^@(-webkit-)?keyframes\s+("?)([\w-]+)\2/, function (m, w, q, nm) { return '@keyframes ' + nm + '--' + k; }) + '\n'; });
    /* a cor herdada do palco (.am-stage{color:#002A46}) entra pelo próprio .am-el */
    out += ':where([data-pal="' + k + '"]){color:' + recolor('#002A46', M) + '}\n';
    return out + body;
  }
  /* UMA folha por paleta com a união (sem repetição) das regras de que os elementos dessa paleta precisam — só as das classes
     presentes em cada elemento, ou seja, do tipo dele; cresce quando entra um tipo novo na mesma paleta (o texto é refeito na
     ordem original, então a cascata se mantém) */
  function ensure(k, n, node) {
    if (!IDX || !IDX.node || !IDX.node.isConnected) { build(); Object.keys(STY).forEach(function (x) { if (STY[x].st) STY[x].st.remove(); }); STY = {}; }
    if (!IDX.node) return;
    var S = STY[k] || (STY[k] = { st: null, inc: {} }), add = false;
    needed(node).forEach(function (i) { if (!S.inc[i]) { S.inc[i] = 1; add = true; } });
    if (S.st && S.st.isConnected && !add) return;
    if (!S.st || !S.st.isConnected) { S.st = document.createElement('style'); S.st.id = 'am-pal-' + k; S.st.setAttribute('data-am-pal', k); IDX.node.parentNode.insertBefore(S.st, IDX.node.nextSibling); }
    S.st.textContent = css(k, mapOf(n, k), S.inc);
  }
  /* limpeza: as folhas de paletas que nenhum elemento da página usa mais (outra cor escolhida, slide trocado, desfazer, seletor do
     sistema arrastando = uma paleta por passo) saem pouco depois do último desenho (runtime.js chama palSweep a cada renderEl) */
  function sweep() {
    sweepT = 0;
    Object.keys(STY).forEach(function (k) {
      if (document.querySelector('[data-pal="' + k + '"]')) return;
      if (STY[k].st) STY[k].st.remove(); delete STY[k]; delete MAPS[k];
    });
  }
  function palSweep() { if (!sweepT && Object.keys(STY).length) sweepT = setTimeout(sweep, 1200); }
  function palTag(node, el) {
    var n = norm(el && el.pal); if (!n || !node) return;
    var k = keyOf(n); node.setAttribute('data-pal', k);
    try { ensure(k, n, node); } catch (er) { if (window.console && console.warn) console.warn('AMRT: cores do componente', er); }
  }
  R.palHTML = palHTML; R.palTag = palTag; R.palSweep = palSweep;
  R.pal = { norm: norm, key: keyOf, family: function (hex) { return HEX.test(hex) ? family(hexRGB(hex)) : ''; }, map: function (hex, pal) { var n = norm(pal); if (!n || !HEX.test(hex)) return hex; var o = mapOf(n, keyOf(n)).fn(hexRGB(hex)); return o ? '#' + h2(o[0]) + h2(o[1]) + h2(o[2]) : hex.toUpperCase(); }, recolor: function (s, pal) { var n = norm(pal); return n ? recolor(String(s), mapOf(n, keyOf(n))) : s; }, index: function () { return IDX || build(); }, sweep: sweep,
    contrast: function (x, y) { if (!HEX.test(x) || !HEX.test(y)) return 0; var a = lum(hexRGB(x)), b = lum(hexRGB(y)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); } };
})(window.AMRT);
