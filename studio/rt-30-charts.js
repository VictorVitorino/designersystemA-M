/* ===== Gráficos (item 4.2): colunas agrupadas / empilhadas / 100%, ranking, cascata, bullet, bolas de Harvey, funil e radar =====
   Modelos FX no contrato de runtime.js (html(d, w, h, el) puro; CSS em rt-30-charts.css, sempre dentro de .am-in e com
   calc(var(--d,0ms) + …)). Vai junto em todo arquivo exportado (assemble.py concatena rt-*.js ao runtime).
   Regras de cor (CATALOG §C.2): no máximo 4 séries, na ordem fixa navy → aço → aço claro → laranja; destaque só em laranja;
   negativos em aço claro hachurado (nunca vermelho); legenda com 2+ séries; rótulos de valor sempre; texto em #3E4C5E / #002A46.
   Com data.style = 'dark' (sem painel branco, em slide escuro) a ordem vira branco → aço claro → gelo → laranja.
   Cores escolhidas (S19): data.colors = ['#rrggbb' | '', …] (até 6; '' = cor padrão da posição). theme(d) devolve uma CÓPIA do tema com
   pal[k] = colors[k] e, com colors[0], a rampa do funil em tons de colors[0] (escuro → claro). Cada gráfico diz o que cada posição pinta
   no campo 'colors:N' (rótulos) e em cols(d) (cores efetivas, usadas pelo painel do editor); legendas usam as mesmas cores. */
(function (R) {
  'use strict';
  var U = R.util, ucols = U.ucols, ukeep = U.ukeep, kcols = U.kcols, mixHex = U.mixHex, lumHex = U.lumHex, esc = U.esc, num = U.num, fmt = U.fmt, fmtN = U.fmtN, CQ = U.CQ, E = U.E, arr = U.arr, VV = U.VV, nid = U.nid;
  /* paletas: séries categóricas, rampa ordinal (funil), texto, grade e eixo; k = 'light' | 'dark' */
  var TH = {
    light: { dk: false, pal: ['#002A46', '#4A6FA5', '#A3B8D6', '#F78C16'], ramp: ['#002A46', '#13406A', '#43698F', '#7EA1C3', '#A3B8D6', '#C9D6E8'], txt: '#3E4C5E', val: '#002A46', mut: '#43698F', grid: '#E2E7EF', axis: '#CBD4E1', neg: '#C9D6E8', hatch: '#fff', band: ['#EEF2F7', '#DCE5F0', '#C9D6E8'], ice: '#EEF2F7' },
    dark: { dk: true, pal: ['#FFFFFF', '#7EA1C3', '#C9D6E8', '#F78C16'], ramp: ['#FFFFFF', '#DCE5F0', '#C9D6E8', '#A3B8D6', '#7EA1C3', '#43698F'], txt: '#C9D6E8', val: '#FFFFFF', mut: '#A3B8D6', grid: 'rgba(255,255,255,.16)', axis: 'rgba(255,255,255,.35)', neg: '#7EA1C3', hatch: '#002A46', band: ['rgba(255,255,255,.08)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.22)'], ice: 'rgba(255,255,255,.12)' }
  };
  function base(d) { return TH[d && d.style === 'dark' ? 'dark' : 'light']; }
  /* el: com “Cores do componente” (el.pal) as cores escolhidas saem marcadas (U.ukeep: #RRGGBBFF) e o recolorir não as troca.
     Rampa do funil: tons de colors[0] em direção ao branco; com uma cor clara num gráfico para fundo claro, em direção ao preto
     (senão as últimas etapas somem no slide branco) */
  function theme(d, el) {
    var b = base(d), c = ucols(d), K = ukeep(el); if (!c.some(Boolean)) return b;
    var t = {}; Object.keys(b).forEach(function (k) { t[k] = b[k]; });
    t.pal = b.pal.map(function (x, k) { return c[k] ? K(c[k]) : x; });
    if (c[0]) { var dn = !b.dk && lumHex(c[0]) > .7; t.ramp = [0, .16, .32, .48, .62, .74].map(function (f) { return K(f ? mixHex(c[0], dn ? -f * .8 : f) : c[0].toUpperCase()); }); }
    return t;
  }
  /* cores efetivas de cada posição de data.colors (painel do editor): idx = posições da paleta base usadas por padrão */
  function colsOf(d, idx, extra) { var c = ucols(d), b = base(d); return idx.map(function (k, i) { return c[i] || (typeof k === 'number' ? b.pal[k] : k) || extra; }); }
  function lum(c) { var m = /^#?([0-9a-f]{6})(?:ff)?$/i.exec(c || ''); if (!m) return 1; var n = parseInt(m[1], 16); return (0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; }
  function inkOn(c) { return lum(c) < .55 ? '#FFFFFF' : '#002A46'; }
  var STYLE = ['style', 'Paleta', 'sel:light=Para fundo claro|dark=Para fundo escuro'];
  /* texto SVG: o = {fs, a (âncora), w (peso), c (condensada), f (cor), cls, st (style)} */
  function T(x, y, s, o) {
    o = o || {};
    return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '"' + (o.a ? ' text-anchor="' + o.a + '"' : '') + ' font-family="' + (o.c ? "'Roboto Condensed',Roboto,Arial" : 'Roboto,Arial') + ',sans-serif" font-weight="' + (o.w || 400) + '" font-size="' + o.fs.toFixed(1) + '" fill="' + (o.f || '#3E4C5E') + '"' + (o.cls ? ' class="' + o.cls + '"' : '') + (o.st ? ' style="' + o.st + '"' : '') + '>' + esc(s) + '</text>';
  }
  function legend(names, cols, th, cls) { return '<div class="ch-leg' + (cls ? ' ' + cls : '') + '" style="color:' + th.txt + '">' + names.map(function (n, k) { return '<span data-g="' + k + '" style="--g:' + k + '"><i style="background:' + cols[k] + '"></i>' + E('series.' + k + '.t', n) + '</span>'; }).join('') + '</div>'; }
  function hlList(s) { return String(s || '').split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; }); }
  function rowsOf(v) { return Array.isArray(v) ? v.filter(function (o) { return o && typeof o === 'object'; }) : []; }

  /* ---------- 1. Colunas agrupadas / empilhadas / 100% ---------- */
  R.FX.columns = {
    name: 'Colunas (agrupadas, empilhadas, 100%)', cat: 'Gráficos', model: true, chart: true, w: 820, h: 400, anim: { in: 'fade' }, variant: 'grow',
    kw: 'gráfico grafico colunas agrupadas empilhadas 100% comparação séries composição barras verticais mix anos',
    variants: [['grow', 'Série a série', 'As colunas crescem do eixo, uma série depois da outra.'], ['cat', 'Categoria a categoria', 'Cada grupo (ano, área…) entra inteiro, da esquerda para a direita.'], ['stack', 'Empilhando', 'Cada camada pousa sobre a anterior, de baixo para cima.'], ['focus', 'Foco por série', 'Na apresentação, o destaque passa de série em série, com a legenda junto.']],
    data: { title: 'Receita por unidade (R$ mi)', cats: ['2023', '2024', '2025', '2026E'], series: [{ t: 'Varejo', v: [42, 48, 55, 61] }, { t: 'Atacado', v: [30, 31, 35, 40] }, { t: 'Digital', v: [8, 14, 22, 31] }], mode: 'stack', unit: '', style: 'light' },
    fields: [['title', 'Título'], ['cats', 'Categorias (uma por linha)', 'lines'], ['series', 'Séries (nome | um valor por categoria; até 4)', 'rows:t|*v'], ['mode', 'Tipo', 'sel:cluster=Agrupadas|stack=Empilhadas|pct=100% empilhadas'], ['unit', 'Unidade (ex.: %, mi)'], STYLE, ['colors', 'Cores das séries', 'colors:4', 'series']],
    cols: function (d) { return colsOf(d, [0, 1, 2, 3]); },
    tip: 'Duplo clique no nome de uma série (legenda) para editar no slide.',
    html: function (d, w, h, el) {
      var v = VV(el, 'columns'), th = theme(d, el), cats = arr(d.cats), S = rowsOf(d.series).slice(0, 4), n = Math.max(1, cats.length), m = Math.max(1, S.length), mode = ['cluster', 'stack', 'pct'].indexOf(d.mode) >= 0 ? d.mode : 'cluster', u = String(d.unit || '');
      var top = d.title ? h * .15 : h * .06, bot = h * .16, L = w * .02, Rr = w * .98, ch = h - top - bot, gw = (Rr - L) / n, fs = Math.max(10, Math.min(h * .042, gw * .14)), o = '';
      var val = function (s, i) { return Math.max(0, num(((S[s] || {}).v || [])[i])); }, tot = cats.map(function (c, i) { var t = 0; for (var s = 0; s < m; s++) t += val(s, i); return t; });
      var mx = mode === 'cluster' ? Math.max.apply(null, S.map(function (s, k) { return Math.max.apply(null, cats.map(function (c, i) { return val(k, i); }).concat([0])); }).concat([1])) : mode === 'pct' ? 100 : Math.max.apply(null, tot.concat([1]));
      var sc = ch * .9 / mx;
      if (d.title) o += T(0, h * .07, d.title, { fs: Math.max(12, h * .055), w: 700, c: 1, f: th.val });
      o += '<line x1="' + L + '" x2="' + Rr + '" y1="' + (top + ch) + '" y2="' + (top + ch) + '" stroke="' + th.axis + '" stroke-width="1.5"/>';
      cats.forEach(function (c, i) {
        var gx = L + gw * i, acc = 0, bw = mode === 'cluster' ? gw * .78 / m : gw * .5, gap = mode === 'cluster' ? 0 : 2;
        for (var s = 0; s < m; s++) {
          var raw = val(s, i), vv = mode === 'pct' ? (tot[i] ? raw / tot[i] * 100 : 0) : raw, bh = vv * sc, x = mode === 'cluster' ? gx + gw * .11 + bw * s : gx + (gw - bw) / 2, y = top + ch - (mode === 'cluster' ? bh : acc + bh);
          var hh = Math.max(0, bh - (mode === 'cluster' ? 0 : gap)), lab = mode === 'pct' ? Math.round(vv) + '%' : fmtN(raw) + u, fill = th.pal[s];
          o += '<rect class="ch-bar" data-g="' + s + '" style="--i:' + i + ';--s:' + s + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - (mode === 'cluster' ? 3 : 0)).toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="' + Math.min(4, bw * .08).toFixed(1) + '" fill="' + fill + '"/>';
          if (mode === 'cluster') { if (raw > 0) o += T(x + (bw - 3) / 2, y - fs * .5, lab, { fs: fs * .9, a: 'middle', w: 600, f: th.val, cls: 'ch-v', st: '--i:' + i + ';--s:' + s }); }
          else if (hh > fs * 1.5) o += T(x + bw / 2, y + hh / 2 + fs * .35, lab, { fs: fs * .85, a: 'middle', w: 600, f: inkOn(fill), cls: 'ch-v', st: '--i:' + i + ';--s:' + s });
          acc += bh;
        }
        if (mode === 'stack') o += T(gx + gw / 2, top + ch - acc - fs * .55, fmtN(tot[i]) + u, { fs: fs, a: 'middle', w: 700, f: th.val, cls: 'ch-v ch-tot', st: '--i:' + i + ';--s:' + m });
        o += T(gx + gw / 2, h - bot * .42, c, { fs: fs * 1.05, a: 'middle', w: 700, c: 1, f: th.txt });
      });
      return '<div class="fx fxch fxcol fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + '"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + o + '</svg>' + (m > 1 ? legend(S.map(function (s) { return s.t; }), th.pal, th) : '') + '</div>';
    }
  };

  /* ---------- 2. Ranking: barras horizontais (HTML, rótulos editáveis no slide) ---------- */
  R.FX.hbars = {
    name: 'Ranking (barras horizontais)', cat: 'Gráficos', model: true, chart: true, w: 760, h: 380, anim: { in: 'fade' }, variant: 'race',
    kw: 'ranking barras horizontais classificação top comparação ordenado economia iniciativas benchmark',
    variants: [['race', 'Corrida', 'As barras correm da esquerda enquanto os valores contam.'], ['cascade', 'Cascata', 'As linhas entram de cima para baixo, uma a uma.'], ['highlight', 'Destaque depois', 'Todas entram em navy; em seguida, os destaques acendem em laranja.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque desce linha a linha.']],
    data: { title: 'Economia por iniciativa (R$ mi)', items: [{ t: 'Compras estratégicas', v: 14.2 }, { t: 'Logística', v: 9.8 }, { t: 'Automação', v: 7.5 }, { t: 'Energia', v: 4.1 }, { t: 'Facilities', v: 2.6 }], unit: '', hl: '1', sort: 'desc', style: 'light' },
    fields: [['title', 'Título'], ['items', 'Itens (nome | valor)', 'rows:t|v:n'], ['hl', 'Destacar posições (ex.: 1, 3)'], ['sort', 'Ordem', 'sel:desc=Maior → menor|none=Como digitado'], ['unit', 'Unidade'], STYLE, ['colors', 'Cores', 'colors:2', ['Barras', 'Destaque']]],
    cols: function (d) { return colsOf(d, [0, '#F78C16']); },
    tip: 'Duplo clique num nome ou no título para editar no slide.',
    html: function (d, w, h, el) {
      var v = VV(el, 'hbars'), th = theme(d, el), it = rowsOf(d.items).map(function (o, k) { return { t: o.t, v: num(o.v), k: k }; }), hl = hlList(d.hl), u = String(d.unit || '');
      if (d.sort !== 'none') it.sort(function (a, b) { return b.v - a.v; });
      var mx = Math.max.apply(null, it.map(function (o) { return Math.abs(o.v); }).concat([1])), n = Math.max(1, it.length), fs = Math.max(10, Math.min(h / (n + 1.5) * .34, w * .026));
      return '<div class="fx fxch fxhb fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + ';color:' + th.txt + ';--chv:' + th.val + ';--chb:' + th.pal[0] + (ucols(d)[1] ? ';--chh:' + ukeep(el)(ucols(d)[1]) : '') + '">' + (d.title ? E('title', d.title, 'ch-tt') : '') + '<div class="hb-rows">' + it.map(function (o, r) {
        var on = hl.indexOf(r + 1) >= 0;
        return '<div class="hb-r' + (on ? ' hl' : '') + '" data-g="' + r + '" style="--r:' + r + '"><span class="hb-l">' + E('items.' + o.k + '.t', o.t) + '</span><span class="hb-t"><i class="hb-b" style="width:' + (Math.abs(o.v) / mx * 86).toFixed(2) + '%"></i><b class="hb-v"' + (v === 'race' ? ' data-count="' + o.v + '" data-dec="' + (Math.abs(o.v % 1) > .001 ? 1 : 0) + '" data-suf="' + esc(u) + '"' : '') + '>' + esc(fmtN(o.v) + u) + '</b></span></div>';
      }).join('') + '</div></div>';
    }
  };

  /* ---------- 3. Cascata (ponte de valor) ---------- */
  R.FX.waterfall = {
    name: 'Cascata (ponte de valor)', cat: 'Gráficos', model: true, chart: true, w: 900, h: 400, anim: { in: 'fade' }, variant: 'bridge',
    kw: 'cascata waterfall ponte bridge variação ebitda receita drivers efeitos custos margem',
    variants: [['bridge', 'Ponte se construindo', 'Cada barra parte do nível da anterior; os conectores se desenham entre elas.'], ['build', 'Totais e depois efeitos', 'Os totais entram primeiro; os efeitos crescem um a um entre eles.'], ['driver', 'Maior efeito em destaque', 'Depois da entrada, o maior efeito acende em laranja e os demais recuam.']],
    data: { title: 'EBITDA 2024 → 2025 (R$ mi)', items: [{ t: 'EBITDA 2024', v: 120, k: 't' }, { t: 'Volume', v: 18 }, { t: 'Preço', v: 9 }, { t: 'Mix', v: -6 }, { t: 'Custos', v: -11 }, { t: 'Eficiência', v: 14 }, { t: 'EBITDA 2025', v: 0, k: 't' }], unit: '', style: 'light' },
    fields: [['title', 'Título'], ['items', 'Barras (nome | valor | t = total; total com valor 0 é calculado)', 'rows:t|v:n|k'], ['unit', 'Unidade'], STYLE, ['colors', 'Cores', 'colors:3', ['Totais', 'Aumentos', 'Reduções']]],
    cols: function (d) { return colsOf(d, [0, 1, 'neg']).map(function (x, k) { return k === 2 && x === 'neg' ? base(d).neg : x; }); },
    tip: 'Marque as barras de total com “t” na terceira coluna. Valores negativos saem hachurados em azul-claro.',
    html: function (d, w, h, el) {
      var v = VV(el, 'waterfall'), th = theme(d, el), cu = ucols(d), negC = cu[2] ? ukeep(el)(cu[2]) : th.neg, negS = cu[2] ? ukeep(el)(mixHex(cu[2], -.25)) : th.pal[2], con = base(d).pal[2], it = rowsOf(d.items), n = Math.max(1, it.length), run = 0, bars = [], u = String(d.unit || '');
      it.forEach(function (o, i) {
        var isT = String(o.k || '').trim().toLowerCase().charAt(0) === 't';
        if (isT) { var tv = i === 0 || num(o.v) ? num(o.v) : run; run = tv; bars.push({ t: o.t, a: 0, b: tv, tot: 1, val: tv }); } /* total: usa o valor digitado; com 0, a soma corrente */
        else { var dv = num(o.v); bars.push({ t: o.t, a: run, b: run + dv, tot: 0, val: dv }); run += dv; }
      });
      var lo = Math.min(0, Math.min.apply(null, bars.map(function (b) { return Math.min(b.a, b.b); }).concat([0]))), hi = Math.max.apply(null, bars.map(function (b) { return Math.max(b.a, b.b); }).concat([1]));
      var top = d.title ? h * .17 : h * .07, bot = h * .15, ch = h - top - bot, gw = w / n, bw = gw * .56, fs = Math.max(10, Math.min(h * .045, gw * .17)), Y = function (x) { return top + ch - (x - lo) / (hi - lo) * ch * .9; };
      var big = -1, bv = 0; bars.forEach(function (b, i) { if (!b.tot && Math.abs(b.val) > bv) { bv = Math.abs(b.val); big = i; } });
      var pid = nid('wfh'), o = d.title ? T(0, h * .075, d.title, { fs: Math.max(12, h * .055), w: 700, c: 1, f: th.val }) : '';
      o += '<defs><pattern id="' + pid + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="' + negC + '"/><line x1="0" y1="0" x2="0" y2="6" stroke="' + th.hatch + '" stroke-width="2"/></pattern></defs>';
      bars.forEach(function (b, i) {
        var x = gw * i + (gw - bw) / 2, y1 = Y(Math.max(b.a, b.b)), y2 = Y(Math.min(b.a, b.b)), neg = !b.tot && b.val < 0, fill = b.tot ? th.pal[0] : (neg ? 'url(#' + pid + ')' : th.pal[1]);
        var lab = (b.tot ? '' : (b.val > 0 ? '+' : b.val < 0 ? '−' : '')) + fmtN(Math.abs(b.val)) + u;
        o += '<rect class="wf-bar' + (b.tot ? ' tot' : neg ? ' neg' : ' pos') + (i === big ? ' big' : '') + '" data-g="' + i + '" style="--i:' + i + ';--from:' + (b.tot ? 0 : (Y(b.a) - (neg ? y1 : y2))).toFixed(1) + 'px" x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(2, y2 - y1).toFixed(1) + '" rx="3" fill="' + fill + '"' + (neg ? ' stroke="' + negS + '" stroke-width="1"' : '') + '/>';
        o += T(x + bw / 2, y1 - fs * .55, lab, { fs: fs, a: 'middle', w: b.tot ? 700 : 600, f: th.val, cls: 'wf-v', st: '--i:' + i });
        o += T(x + bw / 2, h - bot * .45, b.t, { fs: fs * .95, a: 'middle', w: 700, c: 1, f: th.txt });
        if (i < n - 1) { var yy = Y(b.b); o += '<line class="wf-con" pathLength="1" style="--i:' + i + '" x1="' + (x + bw).toFixed(1) + '" x2="' + (x + gw).toFixed(1) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="' + con + '" stroke-width="1.2" stroke-dasharray="3 3"/>'; }
      });
      o += '<line x1="0" x2="' + w + '" y1="' + Y(lo).toFixed(1) + '" y2="' + Y(lo).toFixed(1) + '" stroke="' + th.axis + '" stroke-width="1.5"/>';
      return '<div class="fx fxch fxwf fxv-' + v + '" style="font-size:' + CQ(fs) + '"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + o + '</svg></div>';
    }
  };

  /* ---------- 4. Meta × realizado (bullet) ---------- */
  R.FX.bullet = {
    name: 'Meta × realizado (bullet)', cat: 'Indicadores', model: true, chart: true, w: 820, h: 300, anim: { in: 'fade' }, variant: 'fill',
    kw: 'bullet meta realizado kpi indicador desempenho alvo faixa scorecard status',
    variants: [['fill', 'Preenchimento', 'As barras preenchem até o realizado enquanto os números contam.'], ['target', 'Meta primeiro', 'As metas aparecem antes; depois o realizado corre até elas.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de indicador em indicador.']],
    data: { rows: [{ t: 'NPS', v: 62, tg: 70, mx: 100 }, { t: 'Adoção (%)', v: 81, tg: 75, mx: 100 }, { t: 'Lead time (dias)', v: 34, tg: 30, mx: 60 }, { t: 'Custo/pedido (R$)', v: 18.5, tg: 16, mx: 30 }], bands: '50, 80', style: 'light' },
    fields: [['rows', 'Indicadores (nome | realizado | meta | máximo)', 'rows:t|v:n|tg:n|mx:n'], ['bands', 'Faixas qualitativas (% do máximo, ex.: 50, 80)'], STYLE, ['colors', 'Cores', 'colors:2', ['Realizado', 'Meta']]],
    cols: function (d) { return colsOf(d, [0, '#F78C16']); },
    tip: 'A marca laranja é a meta; a barra navy, o realizado. Duplo clique no nome para editar no slide.',
    html: function (d, w, h, el) {
      var v = VV(el, 'bullet'), th = theme(d, el), rs = rowsOf(d.rows), n = Math.max(1, rs.length), fs = Math.max(10, Math.min(h / n * .26, w * .024)), bd = String(d.bands || '').split(',').map(num).filter(function (x) { return x > 0 && x < 100; }).sort(function (a, b) { return a - b; });
      var bands = '<i class="bu-z" style="left:0;width:100%;background:' + th.band[0] + '"></i>' + bd.map(function (p, k) { return '<i class="bu-z" style="left:' + p + '%;width:' + (100 - p) + '%;background:' + th.band[1 + k % 2] + '"></i>'; }).join('');
      return '<div class="fx fxch fxbu fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + ';color:' + th.txt + ';--chv:' + th.val + ';--chb:' + th.pal[0] + ';--chm:' + th.mut + (ucols(d)[1] ? ';--cht:' + ukeep(el)(ucols(d)[1]) : '') + '">' + rs.map(function (r, k) {
        var mx = num(r.mx) || 100, val = num(r.v), tg = num(r.tg), pv = Math.max(0, Math.min(100, val / mx * 100)), pt = Math.max(0, Math.min(100, tg / mx * 100));
        return '<div class="bu-r" data-g="' + k + '" style="--r:' + k + '"><span class="bu-l">' + E('rows.' + k + '.t', r.t) + '</span><span class="bu-t">' + bands + '<i class="bu-b" style="width:' + pv.toFixed(2) + '%"></i><i class="bu-tg" style="left:' + pt.toFixed(2) + '%"></i></span><b class="bu-v"><span data-count="' + val + '" data-dec="' + (Math.abs(val % 1) > .001 ? 1 : 0) + '">' + esc(fmtN(val)) + '</span><small> / ' + esc(fmtN(tg)) + '</small></b></div>';
      }).join('') + '</div>';
    }
  };

  /* ---------- 5. Bolas de Harvey (comparativo) ---------- */
  R.FX.harvey = {
    name: 'Bolas de Harvey (comparativo)', cat: 'Matrizes', model: true, chart: true, w: 900, h: 380, anim: { in: 'fade' }, variant: 'fill',
    kw: 'harvey bolas comparativo avaliação fornecedores opções critérios scoring benchmark notas',
    variants: [['fill', 'Preenchendo', 'Cada bola preenche no sentido horário, linha a linha.'], ['cols', 'Opção por opção', 'As colunas são avaliadas uma de cada vez.'], ['best', 'Vencedora em destaque', 'Depois do preenchimento, a melhor opção ganha moldura laranja.']],
    data: { cols: ['Opção A', 'Opção B', 'Opção C'], rows: [{ t: 'Custo total', v: [3, 2, 4] }, { t: 'Prazo de implantação', v: [2, 4, 3] }, { t: 'Aderência ao processo', v: [4, 3, 2] }, { t: 'Risco', v: [1, 3, 4] }], best: 3, style: 'light' },
    fields: [['cols', 'Opções (uma por linha)', 'lines'], ['rows', 'Critérios (nome | nota 0–4 por opção)', 'rows:t|*v'], ['best', 'Opção vencedora (nº, 0 = nenhuma)', 'number'], STYLE, ['colors', 'Cor', 'colors:1', ['Bolas']]],
    cols: function (d) { return colsOf(d, [0]); },
    tip: 'Clique numa bola para trocar a nota (0 → 4). Duplo clique num nome para editar.',
    html: function (d, w, h, el) {
      var v = VV(el, 'harvey'), th = theme(d, el), cols = arr(d.cols), rows = rowsOf(d.rows), m = Math.max(1, cols.length), n = Math.max(1, rows.length), best = Math.round(num(d.best)) - 1, fs = Math.max(9, Math.min(h / (n + 1.3) * .3, w / (m + 2.4) * .13)), ink = th.pal[0];
      var g = '<div class="fx fxch fxhv fxv-' + v + '" style="font-size:' + CQ(fs) + ';color:' + th.txt + ';--chv:' + th.val + ';--chg:' + th.grid + ';grid-template-columns:2.4fr repeat(' + m + ',1fr);grid-template-rows:1.1fr repeat(' + n + ',1fr)"><div></div>';
      cols.forEach(function (c, k) { g += '<div class="hv-h' + (k === best ? ' best' : '') + '" style="--c:' + k + '">' + E('cols.' + k, c) + '</div>'; });
      rows.forEach(function (r, i) {
        g += '<div class="hv-t" style="--r:' + i + '">' + E('rows.' + i + '.t', r.t) + '</div>';
        for (var k = 0; k < m; k++) {
          var q = Math.max(0, Math.min(4, Math.round(num((r.v || [])[k]))));
          g += '<div class="hv-c' + (k === best ? ' best' : '') + '" style="--r:' + i + ';--c:' + k + '" data-cyc="rows.' + i + '.v.' + k + '" data-cyc-seq="0,1,2,3,4" title="Nota ' + q + ' de 4"><svg viewBox="0 0 40 40" aria-label="' + q + ' de 4"><circle cx="20" cy="20" r="17" fill="' + (th.dk ? 'transparent' : '#fff') + '" stroke="' + ink + '" stroke-width="2.4"/>' + (q ? '<circle class="hv-f" cx="20" cy="20" r="8.5" fill="none" stroke="' + ink + '" stroke-width="17" pathLength="100" stroke-dasharray="' + q * 25 + ' 100" transform="rotate(-90 20 20)"/>' : '') + '</svg></div>';
        }
      });
      return g + '</div>';
    }
  };

  /* ---------- 6. Funil ---------- */
  R.FX.funnel = {
    name: 'Funil', cat: 'Gráficos', model: true, chart: true, w: 760, h: 420, anim: { in: 'fade' }, variant: 'drop',
    kw: 'funil conversão vendas pipeline etapas jornada leads clientes comercial',
    variants: [['drop', 'Etapas descendo', 'Cada etapa desce e se encaixa abaixo da anterior.'], ['conv', 'Taxas de conversão', 'Depois do funil, as taxas entre etapas aparecem; a menor acende em laranja.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque desce etapa a etapa.']],
    data: { items: [{ t: 'Leads', v: 12000 }, { t: 'Qualificados', v: 5400 }, { t: 'Propostas', v: 1900 }, { t: 'Negociação', v: 820 }, { t: 'Contratos', v: 410 }], unit: '', style: 'light' },
    fields: [['items', 'Etapas (nome | valor)', 'rows:t|v:n'], ['unit', 'Unidade'], STYLE, ['colors', 'Cor', 'colors:1', ['Etapas (tons da cor)']]],
    cols: function (d) { return colsOf(d, [base(d).ramp[0]]); },
    tip: 'A largura de cada etapa segue a raiz do valor (como na leitura de área). Duplo clique num nome para editar.',
    html: function (d, w, h, el) {
      var v = VV(el, 'funnel'), th = theme(d, el), it = rowsOf(d.items), n = Math.max(1, it.length), v0 = Math.max(1, num((it[0] || {}).v)), fw = w * .58, cx = fw / 2, sh = h / n, fs = Math.max(10, Math.min(sh * .26, w * .028)), o = '', conv = '', worst = -1, wr = 2, u = String(d.unit || '');
      var Wd = function (k) { return Math.max(.12, Math.sqrt(Math.max(0, num((it[k] || {}).v)) / v0)) * fw; }, C = th.ramp;
      it.forEach(function (s, k) { if (k) { var r = num(s.v) / Math.max(1, num(it[k - 1].v)); if (r < wr) { wr = r; worst = k; } } });
      it.forEach(function (s, k) {
        var a = Wd(k), b = k < n - 1 ? Wd(k + 1) : a * .82, y = sh * k, fill = C[Math.min(C.length - 1, Math.round(k * (C.length - 1) / Math.max(1, n - 1)))];
        o += '<path class="fn-s" data-g="' + k + '" style="--i:' + k + '" d="M' + (cx - a / 2).toFixed(1) + ' ' + (y + 1).toFixed(1) + 'H' + (cx + a / 2).toFixed(1) + 'L' + (cx + b / 2).toFixed(1) + ' ' + (y + sh - 1).toFixed(1) + 'H' + (cx - b / 2).toFixed(1) + 'Z" fill="' + fill + '"/>';
        o += T(cx, y + sh * .5 + fs * .35, fmtN(num(s.v)) + u, { fs: fs * 1.05, a: 'middle', w: 700, f: inkOn(fill), cls: 'fn-v', st: '--i:' + k });
        conv += '<div class="fn-r" data-g="' + k + '" style="--i:' + k + ';top:' + (k / n * 100).toFixed(3) + '%;height:' + (100 / n).toFixed(3) + '%"><b>' + E('items.' + k + '.t', s.t) + '</b>' + (k ? '<em class="fn-c' + (k === worst ? ' worst' : '') + '">↓ ' + fmt(num(s.v) / Math.max(1, num(it[k - 1].v)) * 100, 0) + '%</em>' : '') + '</div>';
      });
      return '<div class="fx fxch fxfn fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + ';color:' + th.txt + ';--chv:' + th.val + ';--chm:' + th.mut + ';--chi:' + th.ice + ';--chg:' + th.grid + '"><svg viewBox="0 0 ' + fw.toFixed(1) + ' ' + h + '" preserveAspectRatio="none" style="width:58%">' + o + '</svg><div class="fn-side">' + conv + '</div></div>';
    }
  };

  /* ---------- 7. Radar (teia) ---------- */
  R.FX.radar = {
    name: 'Radar (teia)', cat: 'Gráficos', model: true, chart: true, w: 640, h: 440, anim: { in: 'fade' }, variant: 'grow',
    kw: 'radar teia aranha maturidade dimensões avaliação perfil competências comparação as-is to-be gap',
    variants: [['grow', 'Crescendo do centro', 'Cada série se expande do centro até os seus valores.'], ['draw', 'Contorno desenhando', 'O contorno de cada série é traçado ao redor da teia.'], ['compare', 'Atual × meta', 'A situação atual entra; depois a meta se desenha por cima, mostrando o gap.']],
    data: { axes: ['Estratégia', 'Processos', 'Pessoas', 'Tecnologia', 'Dados', 'Governança'], series: [{ t: 'Atual', v: [3, 2.5, 2, 3.5, 1.5, 2] }, { t: 'Meta 2026', v: [4.5, 4, 3.5, 4, 4, 4] }], max: 5, style: 'light' },
    fields: [['axes', 'Dimensões (uma por linha, 3 ou mais)', 'lines'], ['series', 'Séries (nome | nota por dimensão; até 3)', 'rows:t|*v'], ['max', 'Nota máxima', 'number'], STYLE, ['colors', 'Cores das séries', 'colors:3', 'series']],
    cols: function (d) { return colsOf(d, [0, 3, 1]); },
    tip: 'A 2ª série sai tracejada em laranja (meta). Duplo clique no nome de uma série para editar.',
    html: function (d, w, h, el) {
      var v = VV(el, 'radar'), th = theme(d, el), ax = arr(d.axes), m = Math.max(3, ax.length), S = rowsOf(d.series).slice(0, 3), mx = num(d.max) || 5, sz = Math.min(w * .78, h * .8), cx = w / 2, cy = h * .47, Rr = sz / 2 * .78, fs = Math.max(10, Math.min(h * .042, w * .03));
      while (ax.length < m) ax.push('');
      var Pt = function (k, r) { var a = -Math.PI / 2 + k * 2 * Math.PI / m; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }, o = '', lv = Math.max(1, Math.min(10, Math.round(mx)));
      for (var l = 1; l <= lv; l++) o += '<path d="M' + ax.map(function (x, k) { return Pt(k, Rr * l / lv).map(function (q) { return q.toFixed(1); }).join(' '); }).join('L') + 'Z" fill="none" stroke="' + th.grid + '" stroke-width="1"/>';
      ax.forEach(function (a, k) { var p = Pt(k, Rr), q = Pt(k, Rr + fs * 1.3), an = Math.abs(q[0] - cx) < 4 ? 'middle' : (q[0] > cx ? 'start' : 'end'); o += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="' + th.grid + '"/>' + T(q[0], q[1] + fs * .35, a, { fs: fs, a: an, w: 700, c: 1, f: th.txt }); });
      var col = kcols(d, el, R.FX.radar.cols(d));
      S.forEach(function (s, j) {
        var pts = ax.map(function (x, k) { return Pt(k, Rr * Math.max(0, Math.min(mx, num((s.v || [])[k]))) / mx); }), dd = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z';
        var per = pts.reduce(function (a, p, k) { var q = pts[(k + 1) % pts.length]; return a + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0) || 1; /* tracejado em unidades de pathLength=1 */
        o += '<g class="rd-s" data-g="' + j + '" style="--s:' + j + ';transform-origin:' + cx.toFixed(1) + 'px ' + cy.toFixed(1) + 'px"><path class="rd-a" d="' + dd + '" fill="' + col[j] + '" fill-opacity="' + (j ? 0 : .16) + '"/><path class="rd-l" pathLength="1" d="' + dd + '" fill="none" stroke="' + col[j] + '" stroke-width="2.5" stroke-linejoin="round"' + (j === 1 ? ' stroke-dasharray="' + (7 / per).toFixed(4) + ' ' + (5 / per).toFixed(4) + '"' : '') + '/>' + pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + col[j] + '" stroke="' + (th.dk ? '#002A46' : '#fff') + '" stroke-width="1.5"/>'; }).join('') + '</g>';
      });
      return '<div class="fx fxch fxrd fxv-' + v + '" style="font-size:' + CQ(fs) + '"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' + o + '</svg>' + (S.length ? legend(S.map(function (s) { return s.t; }), col, th) : '') + '</div>';
    }
  };
  R.CHARTS = ['columns', 'bars', 'hbars', 'waterfall', 'linechart', 'donut', 'funnel', 'radar', 'bullet', 'harvey', 'gauge']; /* ordem do menu “Gráficos ▾” do editor */
})(window.AMRT);
