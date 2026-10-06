/* ===== Modelos de consultoria B (item 5): mapa de stakeholders, cadeia de valor (Porter), Business Model Canvas, jornada do
   cliente, OKR, Balanced Scorecard (mapa estratégico) e curva da mudança / ADKAR + presets baratos sobre motores existentes
   (Ansoff, Eisenhower, Kano, SCR, Minto, Iceberg, 5W2H, SIPOC) =====
   Mesmo contrato de rt-models2.js: html(d, w, h, el) puro; CSS em rt-models3.css, sempre dentro de .am-in e com
   calc(var(--d,0ms) + …); keyframes com prefixo m8; todo texto por esc()/E(); todo número por num() + clamp; o tipo de uma
   linha (st, c) vira uma única letra antes de virar classe; cores só da paleta A&M (navy, aços, gelos, laranja, branco), nunca
   vermelho; com o painel branco (slide escuro) dims() ajusta w/h ao recuo de 5 % (.fx-pin). Vai junto em todo arquivo exportado. */
(function (R) {
  'use strict';
  var U = R.util, esc = U.esc, num = U.num, CQ = U.CQ, E = U.E, arr = U.arr, VV = U.VV, fmtN = U.fmtN, nid = U.nid;
  var NAVY = '#002A46', STEEL = '#4A6FA5', LSTEEL = '#7EA1C3', ORANGE = '#F78C16';
  function f1(v) { return (+v || 0).toFixed(1); }
  function f3(v) { return (+v || 0).toFixed(3); }
  function pc(v, t) { return (t ? v / t * 100 : 0).toFixed(3) + '%'; }
  function cl(v, a, b) { v = +v; if (!isFinite(v)) v = a; return Math.max(a, Math.min(b, v)); }
  function tok(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z]/g, '').charAt(0); }
  function nrm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function txt(v, n) { return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n || 200) : ''; }
  function lst(v) { return Array.isArray(v) ? v : typeof v === 'string' ? arr(v) : []; }
  function strs(v, max, n) { return lst(v).slice(0, max).map(function (s) { return txt(s, n); }); }
  function rows(v, max) { return (Array.isArray(v) ? v : []).slice(0, max).map(function (o) { return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }); }
  function dims(el, w, h) { var k = el && el.data && el.data.panel === 'white' ? .9 : 1; return [Math.max(40, (+w || 40) * k), Math.max(40, (+h || 40) * k)]; }
  function root(cls, v, fs, extra, focus) { return '<div class="fx ' + cls + ' fxv-' + esc(v) + '"' + (focus ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + (extra || '') + '">'; }
  function has(v) { return v != null && v !== '' && num(v) !== 0; }
  function prow(spec, v) {
    var cols = spec.split('|');
    function one(l) { var p = String(l).split('|'), o = {}; cols.forEach(function (c, i) { if (c.charAt(0) === '*') o[c.slice(1)] = p.slice(i).map(function (s) { return s.trim(); }); else o[c] = (p[i] || '').trim(); }); return o; }
    if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : typeof x === 'string' ? one(x) : {}; });
    return typeof v === 'string' ? v.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(one) : [];
  }
  function normer(lists, rowsMap) { return function (d) { lists.forEach(function (k) { if (d[k] != null && !Array.isArray(d[k])) d[k] = lst(d[k]); }); Object.keys(rowsMap).forEach(function (k) { if (d[k] != null) d[k] = prow(rowsMap[k], d[k]); }); return d; }; }
  function nlines(n, em, s, tw, mx) { var r = n * em * s / Math.max(1, tw); return Math.min(mx || 9, Math.max(1, Math.ceil(r <= .92 ? r : r * 1.12))); }
  function shrink(fs, floor, over) { var k = 1, s = fs; while (k > floor && over(s)) { k = Math.max(floor, Math.round((k - .04) * 100) / 100); s = fs * k; } return k; }
  function ov(a, b) { return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); }
  /* rótulo ao lado de um ponto (px, py, raio r): lado preferido centrado / alinhado ao topo / à base, depois o outro lado, acima e abaixo —
     o primeiro lugar sem colisão com obstáculos (obs), rótulos já postos (lbs) nem com a borda (pw × ph); se todos colidem, o de menor área em conflito */
  function place(px, py, r, lw, lh, lft, obs, lbs, pw, ph, skip) {
    function side(cls, sx, dy) { var x = px + sx * (r + 5), y = py + dy; return [cls, x, y, [sx > 0 ? x : x - lw, y - lh / 2, sx > 0 ? x + lw : x, y + lh / 2]]; }
    var sh = Math.max(0, r - lh / 2), Rr = [side('', 1, 0), side('', 1, -sh), side('', 1, sh)], Lf = [side('l', -1, 0), side('l', -1, -sh), side('l', -1, sh)], best = null, bs = Infinity;
    (lft ? Lf.concat(Rr) : Rr.concat(Lf)).concat([['u', px, py - r - 4, [px - lw / 2, py - r - 4 - lh, px + lw / 2, py - r - 4]], ['d', px, py + r + 4, [px - lw / 2, py + r + 4, px + lw / 2, py + r + 4 + lh]]]).forEach(function (c) {
      var bx = c[3], sc = lw * lh - ov(bx, [-4, -4, pw + 4, ph + 4]); obs.forEach(function (ob) { if (ob !== skip) sc += ov(bx, ob); }); lbs.forEach(function (lb) { sc += ov(bx, lb); }); if (sc < bs - .5) { bs = sc; best = c; } });
    lbs.push(best[3]); return best;
  }
  /* curva suave (Catmull-Rom → Bézier cúbica) por uma lista de pontos [x, y]; devolve o caminho e os segmentos (para avaliar um ponto no meio) */
  function spline(P) {
    var d = 'M' + f1(P[0][0]) + ' ' + f1(P[0][1]), segs = [], i;
    for (i = 0; i < P.length - 1; i++) {
      var p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2, c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      segs.push([p1, c1, c2, p2]); d += 'C' + f1(c1[0]) + ' ' + f1(c1[1]) + ' ' + f1(c2[0]) + ' ' + f1(c2[1]) + ' ' + f1(p2[0]) + ' ' + f1(p2[1]);
    }
    return { d: d, segs: segs };
  }
  function bez(s, t) { var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t; return [a * s[0][0] + b * s[1][0] + c * s[2][0] + e * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + e * s[3][1]]; }
  function at(sp, p) { var n = sp.segs.length; if (!n) return null; var i = cl(Math.floor(p), 0, n - 1), t = cl(p - i, 0, 1); return bez(sp.segs[i], t); }

  /* ---------- 1. Mapa de stakeholders (poder × interesse) ---------- */
  R.FX.stake = {
    name: 'Mapa de stakeholders', cat: 'Estratégia', model: true, w: 900, h: 470, variant: 'drop',
    kw: 'stakeholders partes interessadas mapa poder interesse influência gestão da mudança apoiadores resistentes neutros engajamento comunicação patrocinadores',
    variants: [['drop', 'Pousando no mapa', 'Os quadrantes surgem e cada stakeholder cai na sua posição.'], ['move', 'Rumo à posição desejada', 'Depois da entrada, as setas tracejadas mostram para onde levar cada stakeholder.'], ['quadrants', 'Quadrante a quadrante', 'Cada quadrante entra com os seus stakeholders.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de quadrante em quadrante.']],
    data: { xlab: 'Interesse', ylab: 'Poder', q: ['Manter satisfeito', 'Gerenciar de perto', 'Monitorar', 'Manter informado'], items: [{ t: 'CEO', x: 58, y: 88, st: 'a' }, { t: 'Diretor financeiro', x: 30, y: 78, st: 'n', tx: 68, ty: 80 }, { t: 'Gerentes de planta', x: 76, y: 62, st: 'r', tx: 84, ty: 72 }, { t: 'Sindicato', x: 60, y: 38, st: 'r' }, { t: 'TI corporativa', x: 38, y: 32, st: 'n' }, { t: 'Equipes de campo', x: 84, y: 22, st: 'a' }, { t: 'Fornecedor principal', x: 18, y: 16, st: 'n' }] },
    fields: [['items', 'Stakeholders (nome | interesse 0–100 | poder 0–100 | postura: a = apoiador, n = neutro, r = resistente | interesse desejado | poder desejado)', 'rows:t|x:n|y:n|st|tx:n|ty:n'], ['q', 'Nome dos quadrantes (4 linhas: sup. esq., sup. dir., inf. esq., inf. dir.)', 'lines'], ['xlab', 'Eixo horizontal'], ['ylab', 'Eixo vertical']],
    tip: 'Apoiadores em navy, neutros em branco e resistentes com anel laranja e “!”. A posição desejada (opcional) desenha a seta tracejada. Até 16 stakeholders; os rótulos desviam dos vizinhos.',
    norm: normer(['q'], { items: 't|x|y|st|tx|ty' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'stake'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var q = strs(d.q, 4, 40), DEFQ = ['Manter satisfeito', 'Gerenciar de perto', 'Monitorar', 'Manter informado'], IT = rows(d.items, 16), fs = Math.max(9, Math.min(h * .036, w * .02)), pw = w * .93, ph = h * .83, r = fs * .62, o = '', ar = '', obs = [], lbs = [], B = [], ST = { a: 'Apoiador', n: 'Neutro', r: 'Resistente' };
      [0, 1, 2, 3].forEach(function (g) { var qn = q[g] || DEFQ[g], qw = qn.length * .45 * fs + 1.7 * fs, qh = 2.25 * fs; o += '<div class="sk-q sk-q' + g + '" data-g="' + g + '" style="--g:' + g + '">' + E('q.' + g, qn) + '</div>'; obs.push([g % 2 ? pw - qw : 0, g > 1 ? ph - qh : 0, g % 2 ? pw : qw, g > 1 ? ph : qh]); });
      IT.forEach(function (it, k) {
        if (!txt(it.t, 60) && !has(it.x) && !has(it.y)) return;
        var x = cl(num(it.x), 0, 100), y = cl(num(it.y), 0, 100), px = x / 100 * pw, py = (100 - y) / 100 * ph, st = tok(it.st); if (!st || 'anr'.indexOf(st) < 0) st = 'n';
        var b = { k: k, px: px, py: py, g: (y >= 50 ? 0 : 2) + (x >= 50 ? 1 : 0), st: st, lft: px / pw > .7, tg: has(it.tx) || has(it.ty), t: txt(it.t, 60), box: [px - r, py - r, px + r, py + r] };
        if (b.tg) { var qx = cl(num(it.tx), 0, 100) / 100 * pw, qy = (100 - cl(num(it.ty), 0, 100)) / 100 * ph, dx = qx - px, dy = qy - py; b.qx = qx; b.qy = qy; b.L = Math.hypot(dx, dy) || 1; b.ux = dx / b.L; b.uy = dy / b.L; if (Math.abs(b.ux) > .3) b.lft = b.ux > 0; if (v === 'move') obs.push([qx - r, qy - r, qx + r, qy + r]); }
        obs.push(b.box); B.push(b);
      });
      B.forEach(function (b) {
        var k = b.k, st = ';--n:' + k + ';--g:' + b.g, best = place(b.px, b.py, r, b.t.length * .56 * fs + 2, fs * 1.1, b.lft, obs, lbs, pw, ph, b.box);
        o += '<div class="sk-it" data-g="' + b.g + '" style="left:' + pc(b.px, pw) + ';top:' + pc(b.py, ph) + st + '"><i class="sk-d sk-s' + b.st + '">' + (b.st === 'r' ? '<b>!</b>' : '') + '</i></div><div class="sk-lb' + (best[0] ? ' ' + best[0] : '') + '" data-g="' + b.g + '" style="left:' + pc(Math.max(0, best[1]), pw) + ';top:' + pc(Math.max(0, best[2]), ph) + st + '">' + E('items.' + k + '.t', b.t) + '</div>';
        if (b.tg && b.L > r * 2 + 12) { /* posição desejada: seta tracejada laranja; o anel-fantasma só na variante “Rumo à posição desejada” */
          var ux = b.ux, uy = b.uy, x1 = b.px + ux * (r + 4), y1 = b.py + uy * (r + 4), x2 = b.qx - ux * (r + 4), y2 = b.qy - uy * (r + 4);
          ar += '<g class="sk-ar' + (ux < 0 ? ' l' : '') + '" data-g="' + b.g + '" style="--n:' + k + '"><path class="sk-al" pathLength="1" d="M' + f1(x1) + ' ' + f1(y1) + 'L' + f1(x2) + ' ' + f1(y2) + '"/><path class="sk-ah" d="M' + f1(x2) + ' ' + f1(y2) + 'L' + f1(x2 - ux * 11 - uy * 5.5) + ' ' + f1(y2 - uy * 11 + ux * 5.5) + 'L' + f1(x2 - ux * 11 + uy * 5.5) + ' ' + f1(y2 - uy * 11 - ux * 5.5) + 'Z"/></g>';
          o += '<div class="sk-gh" data-g="' + b.g + '" style="left:' + pc(b.qx, pw) + ';top:' + pc(b.qy, ph) + st + '"></div>';
        }
      });
      var leg = '<span class="sk-leg">' + ['a', 'n', 'r'].map(function (s) { return '<span><i class="sk-d sk-s' + s + '">' + (s === 'r' ? '<b>!</b>' : '') + '</i>' + ST[s] + '</span>'; }).join('') + '</span>';
      return root('fxsk', v, fs, '', v === 'focus') + '<div class="sk-plot">' + o + '<svg class="sk-ax" viewBox="0 0 ' + f1(pw) + ' ' + f1(ph) + '" preserveAspectRatio="none">' + ar + '</svg></div><div class="sk-y">' + E('ylab', txt(d.ylab, 60)) + ' →</div><div class="sk-x"><span>' + E('xlab', txt(d.xlab, 60)) + ' →</span>' + leg + '</div></div>';
    }
  };

  /* ---------- 2. Cadeia de valor (Porter) ---------- */
  R.FX.valuechain = {
    name: 'Cadeia de valor', cat: 'Processos', model: true, w: 1100, h: 420, variant: 'build',
    kw: 'cadeia de valor atividades primárias apoio margem operações logística marketing vendas serviços compras tecnologia infraestrutura pessoas custos diagnóstico operacional',
    variants: [['build', 'Montando a cadeia', 'As atividades de apoio entram de cima para baixo; depois as primárias, da esquerda para a direita, e a margem.'], ['flow', 'Fluxo de valor', 'Depois da montagem, uma luz percorre as atividades primárias em ciclo, mostrando o fluxo até a margem.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de atividade em atividade.']],
    data: { support: ['Infraestrutura da empresa', 'Gestão de pessoas', 'Desenvolvimento de tecnologia', 'Compras'], primary: ['Logística de entrada', 'Operações', 'Logística de saída', 'Marketing e vendas', 'Serviços'], margin: 'Margem', hl: '2, 6', notes: [{ n: 2, x: 'Academia de líderes e trilhas por função' }, { n: 6, x: 'Automação do chão de fábrica: OEE +8 p.p.' }] },
    fields: [['support', 'Atividades de apoio (uma por linha, de cima para baixo)', 'lines'], ['primary', 'Atividades primárias (uma por linha, da esquerda para a direita)', 'lines'], ['hl', 'Destaques (posições 1–9: apoio de cima para baixo, depois primárias; vazio = nenhum)'], ['notes', 'Notas (posição | texto)', 'rows:n:n|x'], ['margin', 'Rótulo da margem']],
    tip: 'Até 6 atividades de apoio e 8 primárias. Os destaques acendem em laranja; cada nota ganha um número na atividade e um texto abaixo da cadeia. Duplo clique num nome para editar no slide.',
    norm: normer(['support', 'primary'], { notes: 'n|x' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'valuechain'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var S = strs(d.support, 6, 60), P = strs(d.primary, 8, 60), ns = Math.max(1, S.length), np = Math.max(1, P.length), N = rows(d.notes, 6), NT = [], HL = {}, pos = 0, svg = '', html = '', k;
      String(d.hl == null ? '' : d.hl).split(/[,;\s]+/).forEach(function (s) { var n = parseInt(s, 10); if (n > 0 && n <= 14) HL[n] = 1; });
      N.forEach(function (n, i) { var p = Math.round(num(n.n)), x = txt(n.x, 160); if (p > 0 && p <= ns + np && x) NT.push({ i: i, p: p, x: x }); });
      var Hd = NT.length ? h * .8 : h, fs = Math.max(8, Math.min(Hd * .052, w * .017, Hd / ns * .3)), Wb = w * .86, tipY = Hd / 2, Ys = Hd * .55, gap = Hd * .022, nd = Math.min(w * .035, (Hd - Ys) * .32), bh = Ys / ns;
      function xr(y) { return y <= tipY ? Wb + (w - Wb) * y / tipY : Wb + (w - Wb) * (Hd - y) / (Hd - tipY); }
      function badge(p) { return NT.some(function (n) { return n.p === p; }) ? '<b class="vc-n">' + p + '</b>' : ''; }
      for (k = 0; k < ns; k++) {
        var y0 = k * bh + (k ? gap / 2 : 0), y1 = (k + 1) * bh - gap / 2, p = ++pos, g = p - 1, hl = HL[p] ? ' hl' : '', pts = 'M0 ' + f1(y0) + 'L' + f1(xr(y0)) + ' ' + f1(y0) + (y0 < tipY && y1 > tipY ? 'L' + f1(w) + ' ' + f1(tipY) : '') + 'L' + f1(xr(y1)) + ' ' + f1(y1) + 'L0 ' + f1(y1) + 'Z';
        svg += '<path class="vc-s' + hl + '" data-g="' + g + '" style="--i:' + k + ';--g:' + g + '" d="' + pts + '"/>';
        html += '<div class="vc-sl' + hl + '" data-g="' + g + '" style="--i:' + k + ';--g:' + g + ';top:' + pc(y0, h) + ';height:' + pc(y1 - y0, h) + ';width:' + pc(Wb * .92, w) + '">' + E('support.' + k, S[k]) + badge(p) + '</div>';
      }
      var py0 = Ys + gap / 2, py1 = Hd, ym = (py0 + py1) / 2, cw = (Wb - nd) / np, gp = Math.max(2, Hd * .012), prim = [], PR = [];
      for (k = 0; k < np; k++) {
        var x0 = k * cw, x1 = x0 + cw + nd - gp, last = k === np - 1, lx = x0 + (k ? nd : 0) + fs * .4, nt = k ? 'L' + f1(x0 + nd) + ' ' + f1(ym) : '';
        /* a última atividade segue a rampa inferior da seta (ponta em w, tipY), como na cadeia clássica; as demais são chevrons */
        PR.push({ lx: lx, lw: Math.max(10, (last ? Wb + nd * .5 : x1 - nd) - lx - fs * .25), wd: Math.max.apply(null, P[k].split(' ').map(function (x) { return x.length; }).concat([1])), pd: last ? 'M' + f1(x0) + ' ' + f1(py0) + 'L' + f1(xr(py0)) + ' ' + f1(py0) + 'L' + f1(Wb) + ' ' + f1(py1) + 'L' + f1(x0) + ' ' + f1(py1) + nt + 'Z' : 'M' + f1(x0) + ' ' + f1(py0) + 'L' + f1(x1 - nd) + ' ' + f1(py0) + 'L' + f1(x1) + ' ' + f1(ym) + 'L' + f1(x1 - nd) + ' ' + f1(py1) + 'L' + f1(x0) + ' ' + f1(py1) + nt + 'Z' });
      }
      /* ajuste ao texto das primárias (fator único até ,6): a palavra mais longa cabe na largura do chevron e o nome ocupa até 3 linhas */
      var kp = shrink(fs, .6, function (sz) { return PR.some(function (r, j) { return r.wd * .56 * sz > r.lw || nlines(P[j].length, .53, sz, r.lw, 6) * 1.15 * sz + .6 * sz > py1 - py0 || nlines(P[j].length, .53, sz, r.lw, 6) > 3; }); });
      PR.forEach(function (r, j) {
        var pp = ++pos, gg = pp - 1, hp = HL[pp] ? ' hl' : '';
        prim.push(r.pd); svg += '<path class="vc-p' + hp + '" data-g="' + gg + '" style="--j:' + j + ';--g:' + gg + '" d="' + r.pd + '"/>';
        html += '<div class="vc-pl' + hp + '" data-g="' + gg + '" style="--j:' + j + ';--g:' + gg + (kp < 1 ? ';font-size:' + f3(kp) + 'em' : '') + ';left:' + pc(r.lx, w) + ';top:' + pc(py0, h) + ';width:' + pc(r.lw, w) + ';height:' + pc(py1 - py0, h) + '">' + E('primary.' + j, P[j]) + badge(pp) + '</div>';
      });
      if (v === 'flow') { var cid = nid('vcc'), gid = nid('vcg'); svg = '<defs><clipPath id="' + cid + '">' + prim.map(function (pd) { return '<path d="' + pd + '"/>'; }).join('') + '</clipPath><linearGradient id="' + gid + '" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".45"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>' + svg + '<g clip-path="url(#' + cid + ')"><rect class="vc-sw" x="' + f1(-w * .25) + '" y="' + f1(py0) + '" width="' + f1(w * .25) + '" height="' + f1(py1 - py0) + '" fill="url(#' + gid + ')" style="--tw:' + f1(w * 1.3) + 'px"/></g>'; } /* o recorte fica no grupo (estático): no próprio rect ele viajaria junto com a translação */
      var ang = Math.atan2(tipY, w - Wb), ml = Math.hypot(w - Wb, tipY); /* “Margem” corre ao longo da rampa superior, do lado de fora (canto branco), como no diagrama clássico */
      html += '<div class="vc-mg" style="left:' + pc((Wb + w) / 2 + Math.sin(ang) * fs * .7, w) + ';top:' + pc(tipY / 2 - Math.cos(ang) * fs * .7, h) + ';--ang:' + f1(ang * 180 / Math.PI) + 'deg;--mw:' + f1(ml * .85 / fs) + 'em">' + E('margin', txt(d.margin, 20)) + '</div>';
      if (NT.length) html += '<div class="vc-nts" style="top:' + pc(Hd + h * .03, h) + '">' + NT.map(function (n) { return '<div class="vc-nt" data-g="' + (n.p - 1) + '" style="--g:' + (n.p - 1) + '"><b class="vc-n">' + n.p + '</b>' + E('notes.' + n.i + '.x', n.x) + '</div>'; }).join('') + '</div>';
      return root('fxvc', v, fs, ';--ns:' + ns + ';--np:' + np, v === 'focus') + '<svg viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="none">' + svg + '</svg>' + html + '</div>';
    }
  };

  /* ---------- 3. Business Model Canvas ---------- */
  var BM_KEYS = ['kp', 'ka', 'kr', 'vp', 'cr', 'ch', 'cs', 'cost', 'rev'], BM_TIT = ['Parcerias-chave', 'Atividades-chave', 'Recursos-chave', 'Proposta de valor', 'Relacionamento com clientes', 'Canais', 'Segmentos de clientes', 'Estrutura de custos', 'Fontes de receita'];
  var BM_AREA = ['1/1/3/3', '1/3/2/5', '2/3/3/5', '1/5/3/7', '1/7/2/9', '2/7/3/9', '1/9/3/11', '3/1/4/6', '3/6/4/11'], BM_ORD = [7, 6, 5, 1, 3, 2, 0, 8, 4], BM_SIDE = [7, 6, 5, 0, 2, 3, 1, 8, 4];
  R.FX.bmc = {
    name: 'Business Model Canvas', cat: 'Estratégia', model: true, w: 1160, h: 470, variant: 'blocks',
    kw: 'business model canvas bmc modelo de negócio proposta de valor segmentos clientes canais relacionamento receitas custos parcerias atividades recursos osterwalder inovação',
    variants: [['blocks', 'Contando a história', 'Os blocos entram na ordem da narrativa: segmentos, proposta de valor, canais, relacionamento, receitas, recursos, atividades, parcerias e custos.'], ['sides', 'Valor, depois eficiência', 'Primeiro o lado direito (valor para o cliente), depois o esquerdo (como entregar).'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de bloco em bloco.']],
    data: { titles: BM_TIT.slice(), kp: ['Distribuidores regionais', 'Parceiro de tecnologia'], ka: ['Desenvolvimento do produto', 'Gestão de canais'], kr: ['Marca', 'Base de dados de clientes'], vp: ['Entrega em 24 h com rastreamento', 'Preço 15% abaixo da média', 'Atendimento especializado'], cr: ['Gerente de conta dedicado', 'Autoatendimento no app'], ch: ['Força de vendas', 'E-commerce e marketplaces'], cs: ['Varejo de médio porte', 'Indústria alimentícia'], cost: ['Logística e frota', 'Tecnologia e dados', 'Equipe comercial'], rev: ['Assinatura mensal', 'Taxa por entrega', 'Serviços premium'] },
    fields: [['vp', 'Proposta de valor (uma por linha)', 'lines'], ['cs', 'Segmentos de clientes', 'lines'], ['ch', 'Canais', 'lines'], ['cr', 'Relacionamento com clientes', 'lines'], ['rev', 'Fontes de receita', 'lines'], ['kr', 'Recursos-chave', 'lines'], ['ka', 'Atividades-chave', 'lines'], ['kp', 'Parcerias-chave', 'lines'], ['cost', 'Estrutura de custos', 'lines'], ['titles', 'Títulos dos blocos (9 linhas, na ordem: parcerias, atividades, recursos, proposta, relacionamento, canais, segmentos, custos, receitas)', 'lines']],
    tip: 'Até 8 tópicos curtos por bloco; blocos mais cheios reduzem a fonte do canvas inteiro. Duplo clique num tópico ou num título para editar no slide.',
    norm: normer(BM_KEYS.concat(['titles']), {}),
    html: function (d, w, h, el) {
      var v = VV(el, 'bmc'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var T = strs(d.titles, 9, 40), fs = Math.max(8, Math.min(h * .034, w * .0135)), gap = fs * .45, cwu = (w - 9 * gap) / 10, rf = (h - 2 * gap) / 2.72, box = [];
      BM_KEYS.forEach(function (key, i) { var bw = i < 7 ? 2 * cwu + gap : 5 * cwu + 4 * gap, bh = i === 0 || i === 3 || i === 6 ? 2 * rf + gap : i > 6 ? .72 * rf : rf; box.push({ key: key, i: i, bw: bw, bh: bh, items: strs(d[key], 8, 120).filter(Boolean), t: T[i] || BM_TIT[i] }); });
      function need(b, s) { var tw = b.bw - 1.5 * s, n = nlines(b.t.length, .45 * 1.02, s, tw, 2) * 1.2 + .6; b.items.forEach(function (it) { n += nlines(it.length, .53, s, tw - .9 * s) * 1.3 + .22; }); return n * s + 1.3 * s; }
      var k = shrink(fs, .6, function (s) { return box.some(function (b) { return need(b, s) > b.bh; }); });
      return root('fxbm', v, fs * k, '', v === 'focus') + box.map(function (b) {
        return '<div class="bm-b bm-' + b.key + '" data-g="' + b.i + '" style="grid-area:' + BM_AREA[b.i] + ';--g:' + b.i + ';--o:' + BM_ORD[b.i] + ';--s:' + BM_SIDE[b.i] + '"><b>' + E('titles.' + b.i, b.t) + '</b><ul>' + b.items.map(function (it, j) { return '<li style="--i:' + j + '">' + E(b.key + '.' + j, it) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</div>';
    }
  };

  /* ---------- 4. Jornada do cliente ---------- */
  var JR_AV = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/></svg>';
  R.FX.journey = {
    name: 'Jornada do cliente', cat: 'Evolução', model: true, w: 1160, h: 470, variant: 'walk',
    kw: 'jornada do cliente customer journey map experiência cx etapas pontos de contato touchpoints emoção dores oportunidades persona digital usuário',
    variants: [['walk', 'Cliente caminhando', 'O cliente percorre a curva de emoção etapa por etapa e cada coluna aparece à sua passagem.'], ['draw', 'Curva desenhando', 'A curva de emoção se desenha e, em seguida, as dores pulsam.'], ['stages', 'Etapa a etapa', 'Cada coluna entra da esquerda para a direita, com o seu ponto na curva.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de etapa em etapa.']],
    data: { stages: ['Descoberta', 'Consideração', 'Compra', 'Uso', 'Suporte', 'Recompra'], emo: [1, 0, 2, 1, -2, 1], rows: [{ k: 'Ações', v: ['Pesquisa no site e redes', 'Compara planos e preços', 'Fecha o pedido no app', 'Configura e usa o serviço', 'Abre um chamado', 'Renova e indica'] }, { k: 'Pontos de contato', v: ['Site, Instagram', 'Comparador, consultor', 'App, e-mail', 'App, manual', 'Chat, telefone', 'E-mail, app'] }, { k: 'Dores', v: ['Informação dispersa', 'Planos confusos', 'Cadastro longo', 'Configuração manual', 'Espera de 2 dias', 'Sem benefício claro'] }, { k: 'Oportunidades', v: ['Página comparativa', 'Simulador de plano', 'Cadastro em 3 passos', 'Onboarding guiado', 'Resposta em 2 h', 'Programa de indicação'] }] },
    fields: [['stages', 'Etapas da jornada (uma por linha)', 'lines'], ['rows', 'Linhas (nome da linha | uma célula por etapa)', 'rows:k|*v'], ['emo', 'Emoção por etapa (um número por linha, de −2 a +2)', 'lines']],
    tip: 'Até 8 etapas e 6 linhas; a linha “Dores” ganha marcadores laranja. A curva de emoção fica após a 2ª linha. Duplo clique numa célula ou numa etapa para editar no slide.',
    norm: normer(['stages', 'emo'], { rows: 'k|*v' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'journey'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var ST = strs(d.stages, 8, 40), n = Math.max(1, ST.length), RW = rows(d.rows, 6), EM = lst(d.emo).slice(0, n).map(function (e) { return cl(Math.round(num(e)), -2, 2); }), LW = .13, k;
      while (EM.length < n) EM.push(0);
      var fs = Math.max(8, Math.min(h * .034, w / n * .082, w * .0135)), cw = w * (1 - LW) / n, nr = RW.length;
      /* linhas lidas numa cópia (html() nunca escreve nos dados do elemento): nome, se é a linha “Dores”, uma célula por etapa */
      var RS = RW.map(function (r) { var vals = lst(r.v), kk = txt(r.k, 40), o = { k: kk, pain: /\bdor/.test(nrm(kk)), v: [] }; for (k = 0; k < n; k++) o.v.push(txt(vals[k], 120)); return o; });
      /* ajuste ao texto: cabeçalho ≈ 2,3 em; a faixa de emoção vale 1,7 linha; cada célula precisa das suas linhas × 1,3 em + ,8 em de padding */
      function need(s) { var hh = 2.3 * s, rowH = (h - hh - (nr + 1) * s * .3) / Math.max(1, nr + 1.7); return RS.some(function (r) { return nlines(r.k.length, .5, s, LW * w - 1.4 * s, 3) * 1.15 * s + .6 * s > rowH || r.v.some(function (t) { return nlines(t.length, .53, s, cw - 1.3 * s - (r.pain ? .9 * s : 0)) * 1.3 * s + .8 * s > rowH; }); }); }
      var kf = shrink(fs, .6, need), pts = [], dots = '', av = '';
      for (k = 0; k < n; k++) pts.push([(k + .5) / n * 1000, 50 - EM[k] * 19]);
      var sp = n > 1 ? spline(pts) : { d: '' }, area = n > 1 ? sp.d + 'L' + f1(pts[n - 1][0]) + ' 50L' + f1(pts[0][0]) + ' 50Z' : ''; /* preenche entre a curva e a linha neutra (regra nonzero: os dois lados) */
      pts.forEach(function (p, j) { var e = EM[j]; dots += '<i class="jr-dot' + (e < 0 ? ' lo' : e > 0 ? ' hi' : '') + '" data-g="' + j + '" style="--k:' + j + ';--p:' + f3(n > 1 ? j / (n - 1) : 0) + ';left:' + pc(p[0], 1000) + ';top:' + pc(p[1], 100) + '"></i>'; });
      if (v === 'walk') { for (k = 0; k < n - 1; k++) av += '<i class="jr-av" style="--k:' + k + ';--x0:' + pc(pts[k][0], 1000) + ';--y0:' + pc(pts[k][1], 100) + ';--x1:' + pc(pts[k + 1][0], 1000) + ';--y1:' + pc(pts[k + 1][1], 100) + '">' + JR_AV + '</i>'; av += '<i class="jr-av end" style="--k:' + (n - 1) + ';left:' + pc(pts[n - 1][0], 1000) + ';top:' + pc(pts[n - 1][1], 100) + '">' + JR_AV + '</i>'; }
      var hd = '<div class="jr-l jr-h0"></div>' + ST.map(function (s, j) { return '<div class="jr-h" data-g="' + j + '" style="--k:' + j + '"><i>' + (j + 1) + '</i>' + E('stages.' + j, s) + '</div>'; }).join('');
      var emo = '<div class="jr-l jr-el">' + E('emolab', txt(d.emolab, 30) || 'Emoção') + '</div><div class="jr-emo" style="grid-column:2/-1"><b class="jr-pm">+</b><b class="jr-pm mn">−</b><svg viewBox="0 0 1000 100" preserveAspectRatio="none"><line class="jr-mid" x1="0" x2="1000" y1="50" y2="50"/>' + (n > 1 ? '<path class="jr-ar" d="' + area + '"/><path class="jr-cv" pathLength="1" d="' + sp.d + '"/>' : '') + '</svg>' + dots + av + '</div>';
      var body = '', rowsCss = 'auto';
      RS.forEach(function (r, i) {
        body += '<div class="jr-l">' + E('rows.' + i + '.k', r.k) + '</div>' + r.v.map(function (t, j) { return '<div class="jr-c' + (r.pain ? ' jr-pain' : '') + '" data-g="' + j + '" style="--k:' + j + '">' + E('rows.' + i + '.v.' + j, t) + '</div>'; }).join(''); rowsCss += ' 1fr';
        if (i === 1 || (nr < 2 && i === nr - 1)) { body += emo; rowsCss += ' 1.7fr'; }
      });
      if (!nr) { body += emo; rowsCss += ' 1.7fr'; }
      return root('fxjr', v, fs * kf, ';--n:' + n + ';grid-template-columns:' + (LW * 100) + '% repeat(' + n + ',1fr);grid-template-rows:' + rowsCss, v === 'focus') + hd + body + '</div>';
    }
  };

  /* ---------- 5. OKR ---------- */
  var OK_CF = { o: ['c-o', 'No caminho'], r: ['c-r', 'Em risco'], c: ['c-c', 'Crítico'] };
  R.FX.okr = {
    name: 'OKR: objetivo e resultados-chave', cat: 'Indicadores', model: true, w: 1000, h: 420, variant: 'cascade',
    kw: 'okr objetivos resultados-chave key results metas acompanhamento trimestre confiança progresso realizado alvo desempenho',
    variants: [['cascade', 'Em cascata', 'O objetivo entra e os resultados-chave descem um a um, com as suas barras.'], ['fill', 'Barras e contadores', 'As barras preenchem até o realizado enquanto os números contam.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de resultado-chave em resultado-chave.']],
    data: { eyebrow: 'Objetivo', obj: 'Tornar o atendimento ao cliente referência no setor até dezembro', owner: 'Diretoria de Operações · 4º tri 2026', krs: [{ t: 'Elevar o NPS de 42 para 60', v: 51, tg: 60, u: 'pts', c: 'ok' }, { t: 'Resolver 85% dos chamados no 1º contato', v: 71, tg: 85, u: '%', c: 'risco' }, { t: 'Elevar a satisfação com o suporte para 90%', v: 64, tg: 90, u: '%', c: 'crítico' }, { t: 'Treinar 100% da equipe no novo fluxo', v: 100, tg: 100, u: '%', c: 'ok' }] },
    fields: [['obj', 'Objetivo'], ['krs', 'Resultados-chave (texto | realizado | meta | unidade | confiança: ok, risco ou crítico)', 'rows:t|v:n|tg:n|u|c'], ['eyebrow', 'Rótulo acima do objetivo'], ['owner', 'Dono e período (linha de apoio)']],
    tip: 'A barra mostra realizado ÷ meta (até 100%). Confiança: ok em navy, risco em aço, crítico em laranja. Até 8 resultados-chave; duplo clique num texto para editar no slide.',
    norm: normer([], { krs: 't|v|tg|u|c' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'okr'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var KR = rows(d.krs, 8), n = Math.max(1, KR.length), fs = Math.max(8, Math.min(h / (n + 1.2) * .22, w * .018)), CW = .32, tl = h / n >= fs * 3.6 ? 2 : 1, obj = txt(d.obj, 160), own = txt(d.owner, 80), eye = txt(d.eyebrow, 30) || 'Objetivo';
      /* o objetivo (1,5 em, Roboto Condensed) cabe no card: reduz só a fonte do objetivo até ,6 */
      var ko = shrink(fs, .6, function (s) { return (nlines(obj.length, .45, s * 1.5, CW * w - 2.6 * s, 8) * 1.15 * 1.5 + 1.8 + (own ? 1.8 : 0)) * s > h - 2.4 * s; });
      var card = '<div class="ok-obj"><small>' + E('eyebrow', eye) + '</small><b' + (ko < 1 ? ' style="font-size:' + f3(1.5 * ko) + 'em"' : '') + '>' + E('obj', obj) + '</b>' + (own ? '<span>' + E('owner', own) + '</span>' : '') + '</div>';
      var list = KR.map(function (r, k) {
        var c = tok(r.c), cf = OK_CF[c] || ['c-n', 'Sem status'], val = num(r.v), tg = num(r.tg), p = tg > 0 ? cl(val / tg * 100, 0, 100) : 0, u = txt(r.u, 12), dec = Math.abs(val % 1) > .001 ? 1 : 0;
        return '<div class="ok-r" data-g="' + k + '" style="--r:' + k + '"><i class="ok-n">KR' + (k + 1) + '</i><div class="ok-m"><b>' + E('krs.' + k + '.t', txt(r.t, 90)) + '</b><span class="ok-t"><i class="ok-b" style="width:' + f1(p) + '%"></i></span></div><b class="ok-v">' + (v === 'fill' ? '<span data-count="' + f1(val) + '" data-dec="' + dec + '">' + esc(fmtN(val)) + '</span>' : '<span>' + esc(fmtN(val)) + '</span>') + '<small> / ' + esc(fmtN(tg)) + (u ? ' ' + esc(u) : '') + '</small></b><span class="ok-c ' + cf[0] + '"><i></i>' + cf[1] + '</span></div>';
      }).join('');
      return root('fxok', v, fs, ';--tl:' + tl, v === 'focus') + card + '<div class="ok-l">' + list + '</div></div>';
    }
  };

  /* ---------- 6. Balanced Scorecard / mapa estratégico ---------- */
  R.FX.bsc = {
    name: 'Balanced Scorecard (mapa estratégico)', cat: 'Estratégia', model: true, w: 1160, h: 470, variant: 'bottomup',
    kw: 'balanced scorecard bsc mapa estratégico perspectivas financeira clientes processos internos aprendizado crescimento objetivos estratégicos causa efeito kaplan norton execução da estratégia',
    variants: [['bottomup', 'De baixo para cima', 'As perspectivas entram da base ao topo e as setas de causa e efeito sobem até os resultados financeiros.'], ['perspectives', 'Perspectiva a perspectiva', 'Cada perspectiva entra com os seus objetivos, de cima para baixo; as relações aparecem depois.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de perspectiva em perspectiva.']],
    data: { persp: ['Financeira', 'Clientes', 'Processos internos', 'Aprendizado e crescimento'], objs: [{ p: 1, t: 'Crescer a receita 12% ao ano' }, { p: 1, t: 'Elevar a margem EBITDA a 18%' }, { p: 2, t: 'Ser a marca preferida no segmento premium' }, { p: 2, t: 'Reduzir o churn para 5%' }, { p: 3, t: 'Entregar no prazo em 97% dos pedidos' }, { p: 3, t: 'Automatizar o atendimento de 1º nível' }, { p: 4, t: 'Desenvolver líderes de operação' }, { p: 4, t: 'Implantar a plataforma de dados' }], links: [{ a: 7, b: 5 }, { a: 8, b: 6 }, { a: 5, b: 3 }, { a: 6, b: 4 }, { a: 3, b: 1 }, { a: 4, b: 2 }, { a: 4, b: 1 }] },
    fields: [['objs', 'Objetivos (perspectiva 1–n | objetivo)', 'rows:p:n|t'], ['links', 'Relações de causa e efeito (nº do objetivo de origem | nº do objetivo de destino)', 'rows:a:n|b:n'], ['persp', 'Perspectivas (uma por linha, de cima para baixo)', 'lines']],
    tip: 'Cada objetivo recebe um número (no canto do card) para montar as relações. Até 6 perspectivas, 16 objetivos e 24 relações; até 4 objetivos por perspectiva para leitura confortável.',
    norm: normer(['persp'], { objs: 'p|t', links: 'a|b' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'bsc'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var PS = strs(d.persp, 6, 40), nb = Math.max(2, PS.length), OB = rows(d.objs, 16), LK = rows(d.links, 24), fs = Math.max(8, Math.min(h / nb * .13, w * .015)), LW = .15, bands = [], cards = [], o = '', s = '', k, n = 0;
      for (k = 0; k < nb; k++) bands.push([]);
      OB.forEach(function (ob, i) { var t = txt(ob.t, 90); n++; if (!t) return; var b = cl(Math.round(num(ob.p)) - 1, 0, nb - 1), c = { i: i, t: t, b: b, n: n }; bands[b].push(c); cards[i] = c; });
      var bh = h / nb, gap = fs * .7, aw = w * (1 - LW) - fs, x00 = w * LW + fs * .5;
      /* ajuste ao texto: o card mais cheio da faixa define a fonte (fator único até ,6) */
      var kf = shrink(fs, .6, function (sz) { return bands.some(function (L) { var m = L.length; if (!m) return false; var cw = Math.min(aw / m - gap, w * .24), ch = Math.min(bh * .62, sz * 4.2); return L.some(function (c) { return nlines(c.t.length, .53, sz, cw - 2.4 * sz, 4) * 1.2 * sz + .9 * sz > ch; }); }); });
      var S = fs * kf;
      bands.forEach(function (L, b) {
        var m = L.length, cw = m ? Math.min(aw / m - gap, w * .24) : 0, tot = m * cw + (m - 1) * gap, x0 = x00 + (aw - tot) / 2, ch = Math.min(bh * .62, S * 4.2), y0 = b * bh + (bh - ch) / 2, lv = nb > 1 ? Math.round(b / (nb - 1) * 3) : 0;
        o += '<div class="bs-bd' + (b % 2 ? ' alt' : '') + '" data-g="' + b + '" style="--b:' + b + ';--u:' + (nb - 1 - b) + ';top:' + pc(b * bh, h) + ';height:' + pc(bh, h) + '"><b>' + E('persp.' + b, PS[b]) + '</b></div>';
        var cln = Math.max(1, Math.floor((ch - .9 * S) / (1.2 * S))); /* linhas que cabem no card: o resto termina em reticências */
        L.forEach(function (c, j) { c.x = x0 + j * (cw + gap); c.y = y0; c.w = cw; c.h = ch; o += '<div class="bs-c l' + lv + '" data-g="' + b + '" style="--b:' + b + ';--u:' + (nb - 1 - b) + ';--j:' + j + ';--cl:' + cln + ';left:' + pc(c.x, w) + ';top:' + pc(c.y, h) + ';width:' + pc(cw, w) + ';height:' + pc(ch, h) + '"><i>' + c.n + '</i>' + E('objs.' + c.i + '.t', c.t) + '</div>'; });
      });
      var links = [];
      LK.forEach(function (l) { var a = cards[Math.round(num(l.a)) - 1], b = cards[Math.round(num(l.b)) - 1]; if (a && b && a !== b) links.push([a, b]); });
      links.sort(function (p, q) { return q[0].b - p[0].b || p[0].n - q[0].n; });
      links.forEach(function (l, i) {
        var a = l[0], b = l[1], dd, hd, ax = a.x + a.w / 2, bx = b.x + b.w / 2;
        if (a.b > b.b) { var ym = (a.y + b.y + b.h) / 2, ty = b.y + b.h + 3; dd = 'M' + f1(ax) + ' ' + f1(a.y) + 'V' + f1(ym) + 'H' + f1(bx) + 'V' + f1(ty); hd = 'M' + f1(bx) + ' ' + f1(ty - 1) + 'l-5 9h10z'; }
        else if (a.b < b.b) { var ym2 = (a.y + a.h + b.y) / 2, ty2 = b.y - 3; dd = 'M' + f1(ax) + ' ' + f1(a.y + a.h) + 'V' + f1(ym2) + 'H' + f1(bx) + 'V' + f1(ty2); hd = 'M' + f1(bx) + ' ' + f1(ty2 + 1) + 'l-5 -9h10z'; }
        else { var rt = b.x > a.x, x1 = rt ? a.x + a.w : a.x, x2 = rt ? b.x - 3 : b.x + b.w + 3, cy = a.y + a.h / 2; dd = 'M' + f1(x1) + ' ' + f1(cy) + 'H' + f1(x2); hd = 'M' + f1(x2 + (rt ? -1 : 1)) + ' ' + f1(cy) + 'l' + (rt ? -9 : 9) + ' -5v10z'; }
        s += '<g class="bs-a" data-g="' + a.b + '" style="--i:' + i + ';--b:' + a.b + ';--u:' + (nb - 1 - a.b) + '"><path class="bs-l" pathLength="1" d="' + dd + '"/><path class="bs-h" d="' + hd + '"/></g>';
      });
      return root('fxbs', v, S, ';--nb:' + nb + ';--lw:' + (LW * 100) + '%', v === 'focus') + o + '<svg viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="none">' + s + '</svg></div>';
    }
  };

  /* ---------- 7. Curva da mudança (Kübler-Ross) / ADKAR ---------- */
  var CH_PRO = [.62, .7, .45, .12, .35, .62, .88], AD_LET = ['A', 'D', 'K', 'A', 'R'], AD_DEF = ['Consciência', 'Desejo', 'Conhecimento', 'Habilidade', 'Reforço'];
  R.FX.change = {
    name: 'Curva da mudança / ADKAR', cat: 'Processos', model: true, w: 1100, h: 420, variant: 'draw',
    kw: 'curva da mudança kübler-ross kubler ross adkar gestão da mudança change management resistência choque negação aceitação integração cultura transformação pessoas prosci',
    variants: [['draw', 'Curva desenhando', 'A curva se desenha da esquerda para a direita e as etapas surgem ao longo dela; no ADKAR, as barras crescem em sequência.'], ['walk', 'Até o “estamos aqui”', 'A curva se desenha e um rastro percorre as etapas até o marcador; no ADKAR, o ponto de barreira pulsa no fim.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de etapa em etapa.']],
    data: { mode: 'curve', stages: ['Choque', 'Negação', 'Frustração', 'Depressão', 'Experimentação', 'Decisão', 'Integração'], pos: 3.4, marker: 'Estamos aqui', adkar: [{ t: 'Consciência', v: 4 }, { t: 'Desejo', v: 4 }, { t: 'Conhecimento', v: 2 }, { t: 'Habilidade', v: 3 }, { t: 'Reforço', v: 3 }] },
    fields: [['mode', 'Modo', 'sel:curve=Curva da mudança (Kübler-Ross)|adkar=ADKAR (5 etapas com nota)'], ['stages', 'Etapas da curva (uma por linha)', 'lines'], ['pos', 'Marcador “estamos aqui” (0 = 1ª etapa; decimais entre etapas; vazio oculta)'], ['marker', 'Rótulo do marcador'], ['adkar', 'Etapas ADKAR (nome | nota 1–5)', 'rows:t|v:n']],
    tip: 'Na curva, os rótulos ficam do lado de fora (acima nos picos, abaixo nos vales); até 9 etapas. No ADKAR, a menor nota vira o ponto de barreira, em laranja. Duplo clique numa etapa para editar no slide.',
    norm: normer(['stages'], { adkar: 't|v' }),
    label: function (el) { return el && el.data && String(el.data.mode) === 'adkar' ? 'ADKAR (curva da mudança)' : 'Curva da mudança'; },
    html: function (d, w, h, el) {
      var v = VV(el, 'change'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      if (String(d.mode) === 'adkar') {
        var AD = rows(d.adkar, 5), vals = [], mn = 6, bi = -1, fsA = Math.max(9, Math.min(h * .05, w * .022)), k;
        for (k = 0; k < 5; k++) { vals.push(cl(Math.round(num((AD[k] || {}).v)), 0, 5)); }
        vals.forEach(function (x, i) { if (x > 0 && x < mn) { mn = x; bi = i; } }); if (mn >= 5) bi = -1; /* todas no máximo: sem barreira */
        return root('fxch fxad', v, fsA, '', v === 'focus') + vals.map(function (x, i) {
          var t = txt((AD[i] || {}).t, 30) || AD_DEF[i], bar = i === bi;
          return '<div class="ad-s' + (bar ? ' bar' : '') + '" data-g="' + i + '" style="--k:' + i + '"><b class="ad-l">' + AD_LET[i] + '</b><span class="ad-t">' + E('adkar.' + i + '.t', t) + '</span><div class="ad-tr' + (x >= 4 ? ' in' : '') + '" style="--h:' + (x / 5 * 100) + '%"><i class="ad-b" style="height:' + (x / 5 * 100) + '%"></i><em>' + x + '/5</em></div><small class="ad-bp">' + (bar ? 'ponto de barreira' : '&nbsp;') + '</small></div>';
        }).join('') + '</div>';
      }
      var ST = strs(d.stages, 9, 30), n = Math.max(2, ST.length), fs = Math.max(8, Math.min(h * .045, w / n * .085, w * .017)), pad = w * .075, top = h * .14, ch = h * .54, pts = [], o = '', seg = (w - 2 * pad) / (n - 1), j;
      for (j = 0; j < n; j++) { var u = j / (n - 1) * 6, i0 = Math.min(5, Math.floor(u)), m = CH_PRO[i0] + (CH_PRO[i0 + 1] - CH_PRO[i0]) * (u - i0); pts.push([pad + seg * j, top + (1 - m) * ch, m]); }
      var sp = spline(pts), hasPos = d.pos != null && String(d.pos).trim() !== '', pos = hasPos ? cl(num(d.pos), 0, n - 1) : -1, mk = hasPos ? at(sp, pos) : null, trail = '', K = 18, LB = [];
      /* rótulo do lado livre da curva: pico → acima, vale → abaixo, rampa → acima, estendendo-se para o lado em que a curva desce (nunca por cima do traço);
         nas pontas, para dentro do gráfico. Largura 1,25 trecho quando ancorado (ou o que sobra até a borda) e ,95 trecho quando centrado */
      pts.forEach(function (p, i) {
        var a = i ? pts[i - 1][2] : null, b = i < n - 1 ? pts[i + 1][2] : null, m = p[2], up, anc = '', c;
        if (a != null && b != null) { c = m - (a + b) / 2; if (c > .06) up = true; else if (c < -.06) up = false; else { up = true; anc = b < a ? 'r' : 'l'; } }
        else if (a == null) { up = b < m; anc = 'r'; } else { up = a < m; anc = 'l'; }
        var lw = anc ? Math.min(seg * 1.25, (anc === 'r' ? w - p[0] : p[0]) - fs * .8) : seg * .95, lx = p[0] + (anc === 'r' ? fs * .7 : anc === 'l' ? -fs * .7 : 0), ly = p[1] + (up ? -1 : 1) * fs * (anc ? .95 : 1.25), st = '--k:' + i + ';--p:' + f3(i / (n - 1)), tw = Math.min(lw, (ST[i] || '').length * .5 * fs * .95 + fs);
        LB.push([anc === 'l' ? lx - tw : anc === 'r' ? lx : lx - tw / 2, up ? ly - fs * 1.1 : ly, anc === 'l' ? lx : anc === 'r' ? lx + tw : lx + tw / 2, up ? ly : ly + fs * 1.1]); /* caixa do rótulo (1 linha) */
        o += '<i class="ch-dot" data-g="' + i + '" style="' + st + ';left:' + pc(p[0], w) + ';top:' + pc(p[1], h) + '"></i><div class="ch-lb' + (up ? ' up' : '') + (anc ? ' a' + anc : '') + '" data-g="' + i + '" style="' + st + ';left:' + pc(lx, w) + ';top:' + pc(ly, h) + ';width:' + pc(Math.max(fs * 2, lw), w) + '">' + E('stages.' + i, ST[i] || ('Etapa ' + (i + 1))) + '</div>';
      });
      if (mk) {
        if (v === 'walk') for (j = 0; j <= K; j++) { var q = at(sp, pos * j / K); trail += '<i class="ch-tr" style="--i:' + j + ';left:' + pc(q[0], w) + ';top:' + pc(q[1], h) + '"></i>'; } /* rastro: 19 pontos da 1ª etapa ao marcador */
        var qa = at(sp, Math.max(0, pos - .25))[1], qb = at(sp, Math.min(n - 1, pos + .25))[1], dn = !(qa < mk[1] && qb < mk[1]); /* a pílula sobe só num vale (vizinhos acima, rótulos abaixo); em rampas e picos desce, longe dos rótulos */
        var pw = (txt(d.marker, 30) || 'Estamos aqui').length * .6 * fs * .8 + 1.4 * fs, phh = fs * .8 * 1.9; /* …e se o lado escolhido cobre um rótulo de etapa, vai para o outro lado */
        function pillFree(down) { var y0 = down ? mk[1] + fs * 1.1 : mk[1] - fs * 1.1 - phh, bx = [mk[0] - pw / 2, y0, mk[0] + pw / 2, y0 + phh]; return !LB.some(function (b) { return ov(bx, b) > 0; }); }
        if (!pillFree(dn) && pillFree(!dn)) dn = !dn;
        o += trail + '<div class="ch-mk' + (dn ? ' dn' : '') + '" style="--p:' + f3(pos / (n - 1)) + ';--k:' + K + ';left:' + pc(mk[0], w) + ';top:' + pc(mk[1], h) + '"><i></i><span>' + E('marker', txt(d.marker, 30) || 'Estamos aqui') + '</span></div>';
      }
      return root('fxch', v, fs, ';--n:' + n, v === 'focus') + '<svg viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="none"><path class="ch-cv" pathLength="1" d="' + sp.d + '"/></svg>' + o + '<div class="ch-y">Moral e desempenho →</div><div class="ch-x">Tempo →</div></div>';
    }
  };

  /* ---------- presets baratos: dados prontos sobre motores existentes (matriz 2×2, grade de cards, SmartArt) ----------
     A Biblioteca de modelos (editor) mostra cada preset como um card próprio; inserir = insertFx(kind) + Object.assign(el.data, clone(data))
     + data.preset = chave, que dá nome ao elemento (painel e rodapé do “Ampliar”) pelo gancho label do motor. */
  function ol(s) { return s.split('\n').map(function (l) { var m = /^( *)(.*)$/.exec(l); return { t: m[2], lv: Math.min(2, m[1].length / 2 | 0) }; }); }
  R.PRESETS = {
    ansoff: { name: 'Matriz de Ansoff', kind: 'matrix', cat: 'Estratégia', variant: 'quadrants', kw: 'ansoff crescimento produtos mercados penetração de mercado diversificação desenvolvimento de mercado desenvolvimento de produto expansão', data: { xlab: 'Produtos (existentes → novos)', ylab: 'Mercados (existentes → novos)', q: ['Desenvolvimento de mercado', 'Diversificação', 'Penetração de mercado', 'Desenvolvimento de produto'], items: [{ t: 'Expansão para o Nordeste', x: 24, y: 78 }, { t: 'Nova linha B2B', x: 76, y: 80 }, { t: 'Programa de fidelidade', x: 22, y: 26 }, { t: 'Versão premium', x: 74, y: 30 }] } },
    eisenhower: { name: 'Matriz de Eisenhower', kind: 'matrix', cat: 'Matrizes', variant: 'quadrants', kw: 'eisenhower urgente importante urgência importância priorização tarefas fazer agora agendar delegar eliminar gestão do tempo', data: { xlab: 'Urgência', ylab: 'Importância', q: ['Agendar', 'Fazer agora', 'Eliminar', 'Delegar'], items: [{ t: 'Plano de capacitação', x: 28, y: 80 }, { t: 'Resposta ao regulador', x: 80, y: 86 }, { t: 'Relatórios duplicados', x: 24, y: 22 }, { t: 'Pedidos de dados ad hoc', x: 74, y: 28 }] } },
    kano: { name: 'Modelo de Kano (2×2)', kind: 'matrix', cat: 'Matrizes', variant: 'quadrants', kw: 'kano satisfação do cliente atributos básicos desempenho encantadores indiferentes produto requisitos funcionalidades', data: { xlab: 'Insatisfação se ausente', ylab: 'Satisfação se presente', q: ['Encantadores', 'Desempenho', 'Indiferentes', 'Básicos'], items: [{ t: 'Entrega no mesmo dia', x: 26, y: 84 }, { t: 'Preço competitivo', x: 76, y: 78 }, { t: 'Embalagem premium', x: 24, y: 24 }, { t: 'Rastreamento do pedido', x: 78, y: 26 }] } },
    scr: { name: 'SCR: situação, complicação, resolução', kind: 'cardgrid', cat: 'Estratégia', variant: 'number', kw: 'scr situação complicação resolução storytelling narrativa mensagem estrutura executiva síntese', data: { cards: [{ tag: 'S', t: 'Situação', x: 'A empresa cresceu 20% ao ano e dobrou o número de pedidos.' }, { tag: 'C', t: 'Complicação', x: 'O atendimento não acompanhou: o tempo de resposta triplicou e o NPS caiu 15 pontos.' }, { tag: 'R', t: 'Resolução', x: 'Novo modelo de atendimento em 3 níveis, com automação do 1º nível e metas por squad.' }], style: 'light' } },
    minto: { name: 'Pirâmide de Minto', kind: 'smart', cat: 'Estratégia', variant: 'level', kw: 'minto pirâmide piramide mensagem principal argumentos lógica comunicação executiva storytelling resposta primeiro', data: { layout: 'org', items: ol('Devemos centralizar as compras em 12 meses\n  Economia de 8% no gasto endereçável\n    Volume consolidado em 3 categorias\n    Contratos-guarda-chuva\n  Risco de fornecimento menor\n    Base de fornecedores homologada\n    Dupla fonte nos itens críticos\n  Implantação viável\n    Equipe e sistema já existem\n    Piloto em 2 unidades no 1º tri') } },
    iceberg: { name: 'Iceberg da cultura', kind: 'smart', cat: 'Processos', variant: 'one', kw: 'iceberg cultura organizacional comportamentos normas crenças valores visível invisível mudança cultural', data: { layout: 'pyramid', items: ol('Comportamentos (visível)\n  O que se vê e se ouve no dia a dia\nNormas\n  Regras não escritas e rituais\nCrenças\n  O que as pessoas acreditam que funciona\nValores\n  O que a organização considera certo') } },
    w5h2: { name: '5W2H', kind: 'cardgrid', cat: 'Processos', variant: 'stagger', kw: '5w2h plano de ação o que por que onde quando quem como quanto custa checklist', data: { cards: [{ tag: '01', t: 'O quê', x: 'Implantar o novo fluxo de aprovação' }, { tag: '02', t: 'Por quê', x: 'Reduzir o ciclo de 12 para 4 dias' }, { tag: '03', t: 'Onde', x: 'Unidades Sul e Sudeste' }, { tag: '04', t: 'Quando', x: 'De março a junho' }, { tag: '05', t: 'Quem', x: 'PMO com as áreas de negócio' }, { tag: '06', t: 'Como', x: 'Workflow único e alçadas revisadas' }, { tag: '07', t: 'Quanto', x: 'R$ 180 mil, já orçados' }], style: 'light' } },
    sipoc: { name: 'SIPOC', kind: 'smart', cat: 'Processos', variant: 'one', kw: 'sipoc fornecedores entradas processo saídas clientes mapeamento de processo escopo seis sigma lean', data: { layout: 'process', items: ol('Fornecedores\n  Transportadoras\n  Centro de distribuição\nEntradas\n  Pedido aprovado\n  Estoque disponível\nProcesso\n  Separar, embalar e expedir\nSaídas\n  Pedido entregue\n  Nota fiscal\nClientes\n  Lojas e consumidor final') } }
  };
  function presetOf(el) { var p = el && el.data && el.data.preset, P = typeof p === 'string' && Object.prototype.hasOwnProperty.call(R.PRESETS, p) ? R.PRESETS[p] : null; return P && P.kind === el.kind ? P : null; }
  ['matrix', 'cardgrid', 'smart'].forEach(function (k) { var F = R.FX[k]; if (!F) return; var old = F.label; F.label = function (el) { var P = presetOf(el); return P ? P.name : old ? old(el) : F.name; }; });
  R.presetOf = presetOf; R.spline = spline;
})(window.AMRT);
