/* ===== Modelos de consultoria A (item 5): ciclo PDCA, cronograma (Gantt), AS-IS → TO-BE, 5 Forças de Porter, roadmap em
   ondas / horizontes, árvore de problemas (MECE) e matriz BCG =====
   Modelos FX no contrato de runtime.js (html(d, w, h, el) puro; CSS em rt-models2.css, sempre dentro de .am-in e com
   calc(var(--d,0ms) + …)). Vai junto em todo arquivo exportado (assemble.py concatena rt-*.js ao runtime).
   Regras: todo texto sai por esc()/E() (duplo clique edita no slide); todo número passa por num() + clamp; o tipo de uma linha
   (k) vira uma única letra antes de virar classe; keyframes com prefixo m7; cores só da paleta A&M (navy, aços, gelos, laranja,
   branco), nunca vermelho. Com o painel branco (slide escuro) o conteúdo ocupa o recuo de 5 % (.fx-pin): dims() ajusta w/h. */
(function (R) {
  'use strict';
  var U = R.util, esc = U.esc, num = U.num, CQ = U.CQ, E = U.E, arr = U.arr, VV = U.VV;
  var NAVY = '#002A46', STEEL = '#4A6FA5', LSTEEL = '#7EA1C3', ORANGE = '#F78C16';
  function f1(v) { return (+v || 0).toFixed(1); }
  function f3(v) { return (+v || 0).toFixed(3); }
  function pc(v, t) { return (t ? v / t * 100 : 0).toFixed(3) + '%'; }
  function cl(v, a, b) { v = +v; if (!isFinite(v)) v = a; return Math.max(a, Math.min(b, v)); }
  function tok(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z]/g, '').charAt(0); }
  function nrm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function txt(v, n) { return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n || 200) : ''; }
  /* listas e linhas mantêm a posição original (os caminhos de edição no slide, ex.: tasks.3.t, apontam para o item guardado) */
  function lst(v) { return Array.isArray(v) ? v : typeof v === 'string' ? arr(v) : []; } /* lista: array ou texto (uma por linha / “;”); objeto e número não viram “[object Object]” */
  function strs(v, max, n) { return lst(v).slice(0, max).map(function (s) { return txt(s, n); }); }
  function rows(v, max) { return (Array.isArray(v) ? v : []).slice(0, max).map(function (o) { return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }); }
  function dims(el, w, h) { var k = el && el.data && el.data.panel === 'white' ? .9 : 1; return [Math.max(40, (+w || 40) * k), Math.max(40, (+h || 40) * k)]; }
  function root(cls, v, fs, extra, focus) { return '<div class="fx ' + cls + ' fxv-' + esc(v) + '"' + (focus ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + (extra || '') + '">'; }
  function has(v) { return v != null && v !== '' && num(v) !== 0; }
  /* arquivo editado à mão: lista guardada como texto (“a;b” ou uma por linha) vira array e linhas em texto (“nome | início | fim”) viram
     objetos — a edição no slide (names.2, tasks.3.t) sempre encontra um array. Dados já em array passam intactos (gancho norm, no safeEl). */
  function prow(spec, v) {
    var cols = spec.split('|');
    function one(l) { var p = String(l).split('|'), o = {}; cols.forEach(function (c, i) { o[c] = (p[i] || '').trim(); }); return o; }
    if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : typeof x === 'string' ? one(x) : {}; });
    return typeof v === 'string' ? v.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(one) : [];
  }
  function normer(lists, rowsMap) { return function (d) { lists.forEach(function (k) { if (d[k] != null && !Array.isArray(d[k])) d[k] = lst(d[k]); }); Object.keys(rowsMap).forEach(function (k) { if (d[k] != null) d[k] = prow(rowsMap[k], d[k]); }); return d; }; }
  /* ajuste ao texto: quantas linhas um texto ocupa numa largura útil (em px), com a largura média por caractere em em (Inter ≈ .53, Roboto
     Condensed ≈ .45; maiúsculas ≈ .5); uma linha até 92 % cheia não quebra; a partir daí, 12 % de folga pela quebra em palavras; sempre ≥ 1 e com teto */
  function nlines(n, em, s, tw, mx) { var r = n * em * s / Math.max(1, tw); return Math.min(mx || 9, Math.max(1, Math.ceil(r <= .92 ? r : r * 1.12))); }
  /* fator único de fonte (1 → floor, passos de .04) até over(s) deixar de acusar transbordamento */
  function shrink(fs, floor, over) { var k = 1, s = fs; while (k > floor && over(s)) { k = Math.max(floor, Math.round((k - .04) * 100) / 100); s = fs * k; } return k; }

  /* ---------- 1. Ciclo PDCA ---------- */
  function seg(cx, cy, Ro, ri, a0, a1) { /* fatia de rosca (graus, 0 = topo, sentido horário) */
    function pt(rad, a) { var t = (a - 90) * Math.PI / 180; return f1(cx + rad * Math.cos(t)) + ' ' + f1(cy + rad * Math.sin(t)); }
    return 'M' + pt(Ro, a0) + 'A' + f1(Ro) + ' ' + f1(Ro) + ' 0 0 1 ' + pt(Ro, a1) + 'L' + pt(ri, a1) + 'A' + f1(ri) + ' ' + f1(ri) + ' 0 0 0 ' + pt(ri, a0) + 'Z';
  }
  R.FX.pdca = {
    name: 'Ciclo PDCA', cat: 'Processos', model: true, w: 1040, h: 460, variant: 'cycle',
    kw: 'pdca ciclo melhoria contínua planejar executar verificar agir deming kaizen qualidade roda plan do check act',
    variants: [['cycle', 'Fase a fase', 'Os quadrantes entram no sentido horário, cada um com as suas ações.'], ['spin', 'Roda girando', 'A roda dá uma volta e assenta; depois entram as ações.'], ['ramp', 'Subindo a rampa', 'A roda sobe a rampa da melhoria contínua e o calço (padrão) trava a conquista.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de P para D, C e A, com as suas ações.']],
    data: { names: ['Planejar', 'Executar', 'Verificar', 'Agir'], letters: ['P', 'D', 'C', 'A'], p: ['Definir metas e indicadores', 'Mapear causas-raiz'], d: ['Executar piloto em 2 áreas', 'Treinar as equipes'], c: ['Comparar resultado × meta', 'Auditar aderência'], a: ['Padronizar o que funcionou', 'Corrigir desvios'], center: 'Melhoria contínua' },
    fields: [['p', 'Planejar (uma ação por linha)', 'lines'], ['d', 'Executar', 'lines'], ['c', 'Verificar', 'lines'], ['a', 'Agir', 'lines'], ['center', 'Texto no centro'], ['names', 'Nomes das fases (4 linhas: P, D, C, A)', 'lines'], ['letters', 'Letras da roda (4 linhas)', 'lines']],
    tip: 'Duplo clique numa ação, num nome de fase ou no centro para editar no slide. Até 5 ações curtas (≈30 caracteres) por fase cabem na fonte padrão; listas mais longas (até 6 ações) reduzem a fonte das quatro listas.',
    norm: normer(['names', 'letters', 'p', 'd', 'c', 'a'], {}),
    html: function (d, w, h, el) {
      var v = VV(el, 'pdca'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var ramp = v === 'ramp', fs = Math.max(9, Math.min(h * .04, w * .019)), D = Math.min(h * (ramp ? .66 : .9), w * .38), cx = w / 2, cy = h * (ramp ? .42 : .5), Ro = D / 2, ri = Ro * .42;
      var names = strs(d.names, 4, 40), lets = strs(d.letters, 4, 3), col = [NAVY, STEEL, LSTEEL, ORANGE], KEYS = ['p', 'd', 'c', 'a'], DEF = ['Planejar', 'Executar', 'Verificar', 'Agir'], o = '', lists = '', lw = Math.max(12, (w - D) / 2 / w * 100 - 3), LW = lw / 100 * w;
      /* cada lista vive numa faixa de 46 % da altura (acima ou abaixo do meio; .pd-l tem max-height + overflow:hidden): estima as linhas do
         título (1,3 em, maiúsculas) e das ações na largura da lista e reduz a fonte das 4 listas (fator único, até .6) até a mais cheia caber */
      function need(g, s) { var n = nlines((names[g] || DEF[g]).length, .5 * 1.3, s, LW, 3) * 1.43 + .35; lst(d[KEYS[g]]).slice(0, 6).forEach(function (it, i) { it = txt(it, 120); if (it) n += nlines(it.length, .53, s, LW) * 1.25 + (i ? .3 : 0); }); return n * s; }
      var k = shrink(fs, .6, function (s) { return KEYS.some(function (key, g) { return need(g, s) > h * .46; }); });
      KEYS.forEach(function (key, g) {
        var a0 = g * 90 + 1.5, a1 = (g + 1) * 90 - 1.5, am = (a0 + a1) / 2, t = (am - 90) * Math.PI / 180, lx = cx + Math.cos(t) * (Ro + ri) / 2, ly = cy + Math.sin(t) * (Ro + ri) / 2;
        o += '<g class="pd-q" data-g="' + g + '" style="--g:' + g + '"><path d="' + seg(cx, cy, Ro, ri, a0, a1) + '" fill="' + col[g] + '"/><text x="' + f1(lx) + '" y="' + f1(ly + Ro * .12) + '" text-anchor="middle" font-family="\'Roboto Condensed\',Roboto,Arial,sans-serif" font-weight="300" font-size="' + f1(Ro * .36) + '" fill="' + (g === 2 ? NAVY : '#fff') + '">' + esc(lets[g] || 'PDCA'.charAt(g)) + '</text></g>';
        var left = g >= 2, top = g === 0 || g === 3; /* P sup. dir., D inf. dir., C inf. esq., A sup. esq. (sentido horário) */
        lists += '<div class="pd-l" data-g="' + g + '" style="--g:' + g + ';' + (left ? 'left:0;text-align:right;align-items:flex-end' : 'right:0') + ';' + (top ? 'top:2%' : 'bottom:2%') + ';width:' + lw.toFixed(2) + '%' + (k < 1 ? ';font-size:' + f3(k) + 'em' : '') + '"><b style="color:' + (g === 2 ? '#43698F' : col[g]) + '">' + E('names.' + g, names[g] || DEF[g]) + '</b><ul>' + lst(d[key]).slice(0, 6).map(function (it, i) { it = txt(it, 120); return it ? '<li style="--i:' + i + '">' + E(key + '.' + i, it) + '</li>' : ''; }).join('') + '</ul></div>';
      });
      var ax = cx + Ro * .2, ay = cy - Ro - fs * .9, as = f1(fs * .9);
      var arrow = '<path class="pd-ar" d="M' + f1(ax) + ' ' + f1(ay) + 'l' + as + ' ' + as + 'l-' + as + ' ' + as + '" fill="none" stroke="' + ORANGE + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>', rp = '', rv = '';
      if (ramp) { /* rampa tangente à roda (12°); calço do lado da descida, com o rótulo “padrão” */
        var th = 12 * Math.PI / 180, ux = Math.cos(th), uy = -Math.sin(th), Tx = cx + Ro * Math.sin(th), Ty = cy + Ro * Math.cos(th), A = [Tx - 1.8 * Ro * ux, Ty - 1.8 * Ro * uy], B = [Tx + 1.6 * Ro * ux, Ty + 1.6 * Ro * uy];
        var q0 = [Tx - 1.3 * Ro * ux, Ty - 1.3 * Ro * uy], q1 = [Tx - .82 * Ro * ux, Ty - .82 * Ro * uy], nx = -Math.sin(th), ny = -Math.cos(th), ap = [q1[0] + nx * Ro * .42, q1[1] + ny * Ro * .42];
        rp = '<path class="pd-ramp" d="M' + f1(A[0]) + ' ' + f1(A[1]) + 'L' + f1(B[0]) + ' ' + f1(B[1]) + 'L' + f1(B[0]) + ' ' + f1(A[1]) + 'Z" fill="#DCE5F0"/><path class="pd-chock" d="M' + f1(q0[0]) + ' ' + f1(q0[1]) + 'L' + f1(q1[0]) + ' ' + f1(q1[1]) + 'L' + f1(ap[0]) + ' ' + f1(ap[1]) + 'Z" fill="' + NAVY + '"/><text class="pd-chock" x="' + f1((q0[0] + q1[0]) / 2) + '" y="' + f1(q0[1] + fs * 1.6) + '" text-anchor="middle" font-family="\'JetBrains Mono\',Consolas,monospace" font-size="' + f1(fs * .8) + '" fill="#43698F">padrão</text>';
        rv = ';--rx:' + f1(-1.6 * Ro * ux) + 'px;--ry:' + f1(-1.6 * Ro * uy) + 'px';
      }
      return root('fxpd', v, fs, '', v === 'focus') + '<svg viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="xMidYMid meet">' + rp + '<g class="pd-w" style="transform-origin:' + f1(cx) + 'px ' + f1(cy) + 'px' + rv + '">' + o + '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(ri - 3) + '" fill="#fff"/></g>' + arrow + '</svg><div class="pd-c" style="left:' + pc(cx - ri, w) + ';top:' + pc(cy, h) + ';width:' + pc(2 * ri, w) + '">' + E('center', txt(d.center, 60)) + '</div>' + lists + '</div>';
    }
  };

  /* ---------- 2. Cronograma (Gantt) ---------- */
  var MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  /* posição em períodos a partir de 0: número (vírgula ou ponto), rótulo de um período (fim = +1), “S5” (semana 5),
     “jan/26” / “março” (prefixo de 3 letras do rótulo) ou “dd/mm” (dia dentro do mês cujo rótulo casa); null = não reconhecido */
  function gpos(v, P, end) {
    if (v == null || v === '') return null;
    var s = String(v).trim(), q = nrm(s), labs = P.map(nrm), i = labs.indexOf(q), m, k, yy;
    if (/^-?\d+([.,]\d+)?$/.test(s)) return num(s);
    if (i >= 0) return i + (end ? 1 : 0);
    if ((m = /^s(?:em(?:ana)?)?\.?\s*(\d{1,2})$/.exec(q))) { i = labs.indexOf('s' + m[1]); return (i >= 0 ? i : +m[1] - 1) + (end ? 1 : 0); }
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/.exec(q))) {
      var mo = MON[+m[2] - 1]; yy = m[3] ? m[3].slice(-2) : ''; if (!mo) return null;
      for (k = 0; k < labs.length; k++) if ((labs[k].indexOf(mo) === 0 || labs[k].replace(/\D.*$/, '') === String(+m[2])) && (!yy || labs[k].indexOf(yy) >= 0 || !/\d{2}/.test(labs[k]))) return k + (cl(+m[1], 1, 31) - 1) / 31;
      return null;
    }
    if ((m = /^([a-z]{3})[a-z]*(?:[\/\s.-]+(\d{2,4}))?$/.exec(q))) { yy = m[2] ? m[2].slice(-2) : ''; for (k = 0; k < labs.length; k++) if (labs[k].indexOf(m[1]) === 0 && (!yy || labs[k].indexOf(yy) >= 0 || !/\d{2}/.test(labs[k]))) return k + (end ? 1 : 0); }
    return null;
  }
  R.FX.gantt = {
    name: 'Cronograma (Gantt)', cat: 'Evolução', model: true, w: 1160, h: 440, variant: 'bars',
    kw: 'cronograma gantt plano de trabalho prazos atividades marcos fases semanas meses entregas caminho crítico hoje agenda calendário',
    variants: [['bars', 'Barras crescendo', 'Cada atividade se estende do início ao fim, linha a linha.'], ['phase', 'Fase a fase', 'Cada fase entra com as suas atividades, na ordem do plano.'], ['today', 'Linha do “hoje”', 'O cronograma entra e a linha do hoje corre até a data atual; o que vem depois fica mais claro.'], ['critical', 'Caminho crítico', 'Depois da entrada, as atividades críticas acendem em laranja e as demais recuam.']],
    data: { periods: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'], today: 2.4, tasks: [{ t: 'Diagnóstico', s: 0, e: 1.5, k: 'f' }, { t: 'Entrevistas e dados', s: 0, e: 1, k: '' }, { t: 'Análise AS-IS', s: .75, e: 1.5, k: 'c' }, { t: 'Desenho', s: 1.5, e: 3.5, k: 'f' }, { t: 'Modelo TO-BE', s: 1.5, e: 3, k: 'c' }, { t: 'Validação com o comitê', s: 3, e: 3, k: 'm' }, { t: 'Implementação', s: 3.5, e: 6, k: 'f' }, { t: 'Ondas 1 e 2', s: 3.5, e: 5.5, k: 'c' }, { t: 'Go-live', s: 5.75, e: 5.75, k: 'm' }] },
    fields: [['periods', 'Períodos (um por linha: meses, semanas, trimestres…)', 'lines'], ['tasks', 'Atividades (nome | início | fim | tipo: f = fase, m = marco, c = crítica)', 'rows:t|s|e|k'], ['today', 'Hoje (posição em períodos, rótulo do período ou dd/mm; vazio oculta)']],
    tip: 'Início e fim contam em períodos a partir de 0 (1,5 = meio do 2º período) ou usam o rótulo do período, “S5” e “dd/mm”. Duplo clique num nome para editar no slide. Até 14 atividades para leitura confortável; acima disso, conte com Ampliar (Z) na apresentação.',
    norm: normer(['periods'], { tasks: 't|s|e|k' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'gantt'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var P = strs(d.periods, 36, 24), np = Math.max(1, P.length), T = rows(d.tasks, 24), n = Math.max(1, T.length), td = gpos(d.today, P, false), fs = Math.max(9, Math.min(h / (n + 1.6) * .42, w * .016)), ph = -1;
      td = td == null ? 0 : cl(td, 0, np);
      var head = '<div class="gt-hd"><span></span><div class="gt-ps">' + P.map(function (p, k) { return '<span style="--k:' + k + '">' + E('periods.' + k, p) + '</span>'; }).join('') + '</div></div>', body = '';
      T.forEach(function (t, i) {
        var k = tok(t.k), s = gpos(t.s, P, false), e = gpos(t.e, P, true); if (s == null) s = 0; if (e == null) e = s; s = cl(s, 0, np); e = cl(e, s, np); if (k === 'f') ph++;
        var g = Math.max(0, ph), bar = k === 'm' ? '<i class="gt-ms" style="left:' + pc(s, np) + '"></i>' : '<i class="gt-b' + (k === 'f' ? ' f' : '') + (k === 'c' ? ' c' : '') + (td > 0 && s >= td ? ' fut' : '') + '" style="left:' + pc(s, np) + ';width:' + pc(e - s, np) + '"></i>';
        body += '<div class="gt-r' + (k === 'f' ? ' f' : '') + (k === 'c' ? ' c' : '') + '" data-g="' + g + '" style="--r:' + i + ';--g:' + g + '"><span class="gt-t">' + E('tasks.' + i + '.t', txt(t.t, 80)) + '</span><div class="gt-tr">' + bar + '</div></div>';
      });
      var today = td > 0 ? '<div class="gt-today" style="--x:' + pc(td, np) + '"><span>hoje</span></div>' : '';
      return root('fxgt', v, fs, ';--np:' + np, false) + head + '<div class="gt-body"><div class="gt-grid">' + P.map(function () { return '<i></i>'; }).join('') + '</div>' + body + today + '</div></div>';
    }
  };

  /* ---------- 3. AS-IS → TO-BE ---------- */
  R.FX.asistobe = {
    name: 'AS-IS → TO-BE', cat: 'Evolução', model: true, w: 1100, h: 420, variant: 'reveal',
    kw: 'as-is to-be asis tobe antes depois situação atual futura transformação de para mudança comparação hoje futuro diagnóstico desenho',
    variants: [['reveal', 'Hoje, depois o futuro', 'Todo o AS-IS entra; as setas avançam e o TO-BE aparece em seguida.'], ['rows', 'Linha a linha', 'Cada dimensão mostra o antes e o depois, de cima para baixo.'], ['flip', 'Virada', 'Cada card do AS-IS entra e o TO-BE gira para a frente, como o verso de um cartão.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque desce dimensão a dimensão.']],
    data: { from: 'Hoje (AS-IS)', to: 'Futuro (TO-BE)', rows: [{ t: 'Governança', a: 'Decisões dispersas, sem fórum', b: 'Comitê mensal com alçadas claras' }, { t: 'Processos', a: '14 etapas manuais', b: '6 etapas, 70% automatizadas' }, { t: 'Dados', a: 'Planilhas por área', b: 'Base única e painel diário' }, { t: 'Pessoas', a: 'Papéis sobrepostos', b: 'RACI pactuado e trilha de capacitação' }] },
    fields: [['rows', 'Dimensões (dimensão | hoje | futuro)', 'rows:t|a|b'], ['from', 'Rótulo do “hoje”'], ['to', 'Rótulo do “futuro”']],
    tip: 'Até 8 dimensões. Duplo clique em qualquer texto para editar no slide.',
    norm: normer([], { rows: 't|a|b' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'asistobe'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var Rw = rows(d.rows, 8), n = Math.max(1, Rw.length), fs = Math.max(9, Math.min(h / (n + 1) * .26, w * .018));
      return root('fxab', v, fs, ';grid-template-rows:auto repeat(' + n + ',1fr)', v === 'focus') + '<span></span><b class="ab-h a">' + E('from', txt(d.from, 60)) + '</b><span></span><b class="ab-h b">' + E('to', txt(d.to, 60)) + '</b>' + Rw.map(function (r, i) {
        return '<span class="ab-t" data-g="' + i + '" style="--r:' + i + '">' + E('rows.' + i + '.t', txt(r.t, 60)) + '</span><span class="ab-a" data-g="' + i + '" style="--r:' + i + '">' + E('rows.' + i + '.a', txt(r.a, 160)) + '</span><i class="ab-ar" data-g="' + i + '" style="--r:' + i + '"></i><span class="ab-b" data-g="' + i + '" style="--r:' + i + '">' + E('rows.' + i + '.b', txt(r.b, 160)) + '</span>';
      }).join('') + '</div>';
    }
  };

  /* ---------- 4. 5 Forças de Porter ---------- */
  R.FX.porter = {
    name: '5 Forças de Porter', cat: 'Estratégia', model: true, w: 1000, h: 470, variant: 'converge',
    kw: 'porter cinco 5 forças forcas competitividade indústria setor rivalidade entrantes substitutos fornecedores clientes poder de barganha atratividade',
    variants: [['converge', 'Forças convergindo', 'As forças surgem nas bordas e as setas avançam até o centro.'], ['pressure', 'Pressão por intensidade', 'A espessura das setas segue a intensidade; as forças altas pulsam em laranja.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de força em força.']],
    data: { center: 'Rivalidade entre concorrentes', cn: 4, forces: [{ t: 'Novos entrantes', n: 2, x: 'Capital intensivo e regulação limitam a entrada' }, { t: 'Poder dos fornecedores', n: 4, x: '3 fornecedores detêm 80% do insumo' }, { t: 'Poder dos clientes', n: 3, x: 'Grandes redes negociam preço' }, { t: 'Substitutos', n: 5, x: 'Soluções digitais avançam rápido' }] },
    fields: [['forces', 'Forças (nome | intensidade 1–5 | comentário) — ordem: topo, esquerda, direita, base', 'rows:t|n:n|x'], ['center', 'Força central'], ['cn', 'Intensidade da rivalidade (1–5)', 'number']],
    tip: 'Intensidade 4 ou 5 ganha contorno e seta em laranja. Comentários de até ~2 linhas (≈60 caracteres) mantêm a fonte padrão; textos maiores reduzem a fonte dos quatro cards e, no limite, terminam em reticências. Duplo clique num nome ou comentário para editar no slide.',
    norm: normer([], { forces: 't|n|x' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'porter'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var F = rows(d.forces, 4), fs = Math.max(8, Math.min(h * .036, w * .017)), pos = [[.5, .13], [.135, .5], [.865, .5], [.5, .87]], bw = .26, bh = .24, cw = .3, chh = .26, o = '', ar = '', cmt = bw * w >= fs * 14 && bh * h >= fs * 5.6; /* comentário só quando cabem ≈2 linhas no card (caixa pequena: nome + intensidade) */
      /* ajuste ao texto: estima as linhas do nome (1,15 em, Roboto Condensed) e do comentário (,9 em, Inter) na largura útil do card (padding
         1 em de cada lado) e reduz a fonte dos 4 cards (fator único, até .62) até o mais cheio caber na altura; o que ainda sobrar termina em
         reticências (line-clamp por --nl / --cl), nunca cortado no meio da letra. Orçamento em em: padding 1 + nome × 1,265 + pontos ,85 (+ ,3 + comentário × 1,08) */
      function need(f, s) { var tw = bw * w - 2 * s, nl = nlines(txt(f.t, 60).length, .45 * 1.15, s, tw, 3), c = cmt ? nlines(txt(f.x, 120).length, .53 * .9, s, tw) : 0; return { nl: nl, h: (1.85 + nl * 1.265 + (c ? .3 + c * 1.08 : 0)) * s }; }
      var k = shrink(fs, .62, function (s) { return F.some(function (f) { return need(f, s).h > bh * h; }); }), S = fs * k;
      function dots(nn) { nn = cl(Math.round(num(nn)), 0, 5); return '<span class="pt-dots" aria-label="intensidade ' + nn + ' de 5">' + [1, 2, 3, 4, 5].map(function (k) { return '<i class="' + (k <= nn ? 'on' : '') + '"></i>'; }).join('') + '</span>'; }
      F.forEach(function (f, g) {
        var p = pos[g], nn = cl(Math.round(num(f.n)), 1, 5), hi = nn >= 4, sw = v === 'pressure' ? 2 + nn * 1.4 : 3, nd = need(f, S), cm = cmt ? Math.floor((bh * h / S - 2.15 - nd.nl * 1.265) / 1.08) : 0; /* linhas de comentário que ainda cabem abaixo do nome */
        o += '<div class="pt-f' + (hi ? ' hi' : '') + '" data-g="' + g + '" style="--g:' + g + ';--nl:' + nd.nl + ';--cl:' + Math.max(1, cm) + (k < 1 ? ';font-size:' + f3(k) + 'em' : '') + ';left:' + f3((p[0] - bw / 2) * 100) + '%;top:' + f3((p[1] - bh / 2) * 100) + '%;width:' + (bw * 100) + '%;height:' + (bh * 100) + '%"><b>' + E('forces.' + g + '.t', txt(f.t, 60)) + '</b>' + dots(f.n) + (cm > 0 ? '<span>' + E('forces.' + g + '.x', txt(f.x, 120)) + '</span>' : '') + '</div>';
        var x0 = p[0] * w, y0 = p[1] * h, x1 = w / 2, y1 = h / 2, dx = x1 - x0, dy = y1 - y0, hz = Math.abs(dx) > 1, vt = Math.abs(dy) > 1, sx = hz ? (dx > 0 ? 1 : -1) : 0, sy = vt ? (dy > 0 ? 1 : -1) : 0;
        var X0 = x0 + sx * (bw / 2 * w + 6), Y0 = y0 + sy * (bh / 2 * h + 6), X1 = x1 - sx * (cw / 2 * w + 10), Y1 = y1 - sy * (chh / 2 * h + 10), hx = X1 + sx * 14, hy = Y1 + sy * 14;
        ar += '<g class="pt-a' + (hi ? ' hi' : '') + '" data-g="' + g + '" style="--g:' + g + '"><path class="pt-l" pathLength="1" d="M' + f1(X0) + ' ' + f1(Y0) + 'L' + f1(X1) + ' ' + f1(Y1) + '" stroke-width="' + f1(sw) + '"/><path class="pt-h" d="M' + f1(hx) + ' ' + f1(hy) + 'l' + f1(sy ? -10 : -sx * 14) + ' ' + f1(sx ? -10 : -sy * 14) + 'M' + f1(hx) + ' ' + f1(hy) + 'l' + f1(sy ? 10 : -sx * 14) + ' ' + f1(sx ? 10 : -sy * 14) + '" stroke-width="' + f1(sw) + '"/></g>';
      });
      o += '<div class="pt-c" style="left:' + (50 - cw * 50) + '%;top:' + (50 - chh * 50) + '%;width:' + (cw * 100) + '%;height:' + (chh * 100) + '%"><b>' + E('center', txt(d.center, 80)) + '</b>' + dots(d.cn) + '</div>'; /* centro: até 80 letras (3 linhas; o que sobrar termina em reticências) */
      return root('fxpt', v, fs, '', v === 'focus') + '<svg viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="none">' + ar + '</svg>' + o + '</div>';
    }
  };

  /* ---------- 5. Roadmap em ondas / horizontes ---------- */
  R.FX.roadmap = {
    name: 'Roadmap em ondas', cat: 'Evolução', model: true, w: 1160, h: 440, variant: 'lanes',
    kw: 'roadmap ondas trilhas horizontes 3 horizontes três plano de transformação iniciativas swimlane frentes fases marcos jornada mapa do caminho crítico',
    variants: [['lanes', 'Trilha a trilha', 'Cada trilha entra com as suas iniciativas, de cima para baixo.'], ['waves', 'Onda a onda', 'Uma linha varre as ondas da esquerda para a direita e as iniciativas aparecem à sua passagem.'], ['path', 'Caminho crítico', 'Depois da entrada, as iniciativas em destaque acendem em sequência, ligadas por conectores.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de trilha em trilha.']],
    data: { cols: ['Onda 1 · 1º sem. 2026', 'Onda 2 · 2º sem. 2026', 'Onda 3 · 2027'], lanes: ['Pessoas', 'Processos', 'Tecnologia'], items: [{ t: 'Novo modelo de papéis', l: 1, s: 0, e: 1.2, k: '' }, { t: 'Academia de líderes', l: 1, s: 1.4, e: 3, k: 'c' }, { t: 'Desenho S&OP', l: 2, s: 0, e: .8, k: '' }, { t: 'Piloto em 2 plantas', l: 2, s: .9, e: 1.9, k: 'c' }, { t: 'Go-live do piloto', l: 2, s: 1.9, e: 1.9, k: 'm' }, { t: 'Escala nacional', l: 2, s: 2, e: 3, k: 'c' }, { t: 'Workflow único', l: 3, s: .3, e: 2, k: '' }, { t: 'Painel de gestão', l: 3, s: 2.1, e: 2.85, k: '' }] },
    fields: [['cols', 'Ondas ou horizontes (um por linha)', 'lines'], ['lanes', 'Trilhas (uma por linha)', 'lines'], ['items', 'Iniciativas (nome | trilha 1–n | início | fim | tipo: c = destaque, m = marco)', 'rows:t|l:n|s:n|e:n|k']],
    tip: 'Início e fim contam em ondas a partir de 0 (1,5 = meio da 2ª onda). Para 3 horizontes, nomeie as ondas H1, H2 e H3. Duplo clique num nome para editar no slide.',
    norm: normer(['cols', 'lanes'], { items: 't|l|s|e|k' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'roadmap'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var C = strs(d.cols, 8, 40), nc = Math.max(1, C.length), Ln = strs(d.lanes, 8, 40), nl = Math.max(1, Ln.length), IT = rows(d.items, 30), HD = .14, LW = .17, fs = Math.max(9, Math.min(h * (1 - HD) / nl * .2, w * .015));
      var lanes = [], out = '', cs = [], cn = '', k;
      for (k = 0; k < nl; k++) lanes.push([]);
      IT.forEach(function (o, i) { var kk = tok(o.k), l = cl(Math.round(num(o.l)) - 1, 0, nl - 1), s = cl(num(o.s), 0, nc), e = kk === 'm' ? s : cl(num(o.e), s, nc); var it = { i: i, t: txt(o.t, 80), k: kk, l: l, s: s, e: kk === 'm' ? s : Math.min(nc, Math.max(e, s + .12)) }; lanes[l].push(it); if (kk === 'c') cs.push(it); });
      cs.sort(function (a, b) { return a.s - b.s || a.l - b.l; }); cs.forEach(function (it, n) { it.n = n; });
      var head = '<div class="rm-hd" style="left:' + (LW * 100) + '%;height:' + (HD * 100) + '%">' + C.map(function (c, j) { return '<span style="--k:' + j + '">' + E('cols.' + j, c) + '</span>'; }).join('') + '</div><div class="rm-grid" style="left:' + (LW * 100) + '%;top:' + (HD * 100) + '%">' + C.map(function () { return '<i></i>'; }).join('') + '</div>';
      lanes.forEach(function (L, li) {
        L.sort(function (a, b) { return a.s - b.s; });
        var subs = []; L.forEach(function (it) { var end = it.k === 'm' ? it.s + .45 : it.e, r; for (r = 0; r < subs.length; r++) if (subs[r] <= it.s + 1e-6) { it.r = r; subs[r] = end; return; } it.r = subs.length; subs.push(end); });
        var ns = Math.max(1, subs.length), top = HD + (1 - HD) * li / nl, lh = (1 - HD) / nl, pad = lh * .12, sh = (lh - pad * 2) / ns, hh = Math.min(sh * .88, fs * 2.5 / h);
        out += '<div class="rm-ln' + (li % 2 ? ' alt' : '') + '" data-g="' + li + '" style="--l:' + li + ';top:' + f3(top * 100) + '%;height:' + f3(lh * 100) + '%;padding-right:' + ((1 - LW) * 100) + '%"><b>' + E('lanes.' + li, Ln[li]) + '</b></div>';
        L.forEach(function (it) {
          var y0 = top + pad + it.r * sh + (sh - hh) / 2, x0 = LW + (1 - LW) * it.s / nc, ww = (1 - LW) * (it.e - it.s) / nc, cy = y0 + hh / 2;
          if (it.k === 'm') out += '<div class="rm-ms' + (it.s > nc * .78 ? ' r' : '') + '" data-g="' + it.l + '" style="--l:' + it.l + ';--s:' + f3(it.s / nc) + ';left:' + f3(x0 * 100) + '%;top:' + f3(cy * 100) + '%"><i></i><span>' + E('items.' + it.i + '.t', it.t) + '</span></div>';
          else { out += '<div class="rm-ch' + (it.k === 'c' ? ' c' : '') + '" data-g="' + it.l + '" style="--l:' + it.l + ';--s:' + f3(it.s / nc) + ';--n:' + (it.n || 0) + ';left:' + f3(x0 * 100) + '%;top:' + f3(y0 * 100) + '%;width:' + f3(ww * 100) + '%;height:' + f3(hh * 100) + '%">' + E('items.' + it.i + '.t', it.t) + '</div>'; it.x0 = x0 * w; it.x1 = (x0 + ww) * w; it.y0 = y0 * h; it.y1 = (y0 + hh) * h; it.cy = cy * h; }
        });
      });
      cs.forEach(function (a, n) { /* conector do destaque n ao n+1: cotovelo pela direita; se as iniciativas se sobrepõem no tempo, um elo vertical no meio da sobreposição */
        var b = cs[n + 1], dd; if (!b || a.x1 == null || b.x0 == null) return;
        if (b.x0 > a.x1 + 2) { var xm = (a.x1 + b.x0) / 2; dd = 'M' + f1(a.x1) + ' ' + f1(a.cy) + 'H' + f1(xm) + 'V' + f1(b.cy) + 'H' + f1(b.x0); }
        else { var xv = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2, dn = b.cy > a.cy; dd = 'M' + f1(xv) + ' ' + f1(dn ? a.y1 : a.y0) + 'V' + f1(dn ? b.y0 : b.y1); }
        cn += '<path class="rm-cn" pathLength="1" style="--n:' + n + '" d="' + dd + '"/>'; });
      return root('fxrm', v, fs, ';--nc:' + nc + ';--tt:' + (nc * 700) + 'ms', v === 'focus') + head + out + '<svg class="rm-svg" viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="none">' + cn + '</svg><i class="rm-sw" style="left:' + (LW * 100) + '%;top:' + (HD * 100) + '%;--w:' + ((1 - LW) * 100) + '%"></i></div>';
    }
  };

  /* ---------- 6. Árvore de problemas / MECE (também árvore de KPIs: “Receita = 120”) ---------- */
  /* codec: texto ↔ [{t, lv, v?, hl?}]: Tab ou 2 espaços = 1 nível (até 3 níveis abaixo da raiz; nunca pula um degrau), marcadores
     -, •, * ignorados, “ = valor” à direita vira o valor (mono), “[*]” no fim marca o nó no caminho em destaque. Com um array
     (dados guardados) mantém a posição original em .i, para a edição no slide (items.N.t / items.N.v). */
  function itParse(v) {
    var out = [], prev = -1;
    function push(t, lv, val, hl, i) { t = txt(t, 160); if (!t) return; lv = Math.min(cl(Math.round(num(lv)), 0, 3), prev + 1); prev = lv; var o = { t: t, lv: lv }; val = txt(val, 40); if (val) o.v = val; if (hl) o.hl = 1; if (i != null) o.i = i; out.push(o); }
    function line(l, lv) { var m = /^(.*?)\s*(\[\*\])?\s*$/.exec(String(l)), s = m[1], j = s.lastIndexOf(' = '); push(j > 0 ? s.slice(0, j) : s, lv, j > 0 ? s.slice(j + 3) : '', !!m[2]); }
    if (Array.isArray(v)) v.forEach(function (o, i) { if (o == null) return; if (typeof o === 'object') push(o.t, o.lv, o.v, o.hl === true || o.hl === 1 || o.hl === '1', i); else line(String(o), 0); });
    else String(v == null ? '' : v).replace(/\r/g, '').split('\n').forEach(function (l) { var m = /^([\t ]*)(?:[-•*·]\s+)?(.*)$/.exec(l); if (m[2].trim()) line(m[2], Math.floor(m[1].replace(/\t/g, '  ').length / 2)); });
    return out.slice(0, 40);
  }
  function itText(items) { return itParse(items).map(function (o) { return new Array(o.lv + 1).join('  ') + o.t + (o.v ? ' = ' + o.v : '') + (o.hl ? ' [*]' : ''); }).join('\n'); }
  function itTree(items) { var roots = [], st = []; items.forEach(function (o, k) { var n = { t: o.t, lv: o.lv, v: o.v, hl: !!o.hl, i: o.i != null ? o.i : k, kids: [] }; while (st.length && st[st.length - 1].lv >= n.lv) st.pop(); if (st.length) st[st.length - 1].kids.push(n); else roots.push(n); st.push(n); }); return roots; }
  R.FX.issuetree = {
    name: 'Árvore de problemas (MECE)', cat: 'Estratégia', model: true, w: 1100, h: 440, variant: 'branch',
    kw: 'árvore de problemas arvore mece hipóteses hipoteses issue tree árvore de kpis drivers direcionadores lógica causa decomposição pergunta-chave análise',
    variants: [['branch', 'Nível a nível', 'A pergunta entra, depois cada nível de hipóteses com os seus conectores.'], ['path', 'Caminho em destaque', 'Tudo entra; depois os nós marcados com [*] acendem em laranja e o resto recua.'], ['grow', 'Ramos crescendo', 'Os conectores se desenham primeiro e os nós brotam nas pontas.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de ramo em ramo (nível 1).']],
    data: { items: [{ t: 'Como elevar o EBITDA em 20% até 2027?', lv: 0, hl: 1 }, { t: 'Aumentar a receita', lv: 1, hl: 1 }, { t: 'Reajustar preços nos segmentos premium', lv: 2, hl: 1 }, { t: 'Ampliar a carteira B2B', lv: 2 }, { t: 'Reduzir custos', lv: 1 }, { t: 'Renegociar contratos de insumos', lv: 2 }, { t: 'Automatizar o back-office', lv: 2 }, { t: 'Otimizar o capital', lv: 1 }, { t: 'Reduzir estoques em 15 dias', lv: 2 }] },
    fields: [['items', 'Árvore (uma linha por nó; Tab = nível abaixo; “ = valor” à direita; “[*]” no fim marca o caminho)', 'outline:3']],
    tip: 'Até 4 níveis (pergunta → hipóteses → análises → dados) e 40 nós; até 20 nós para leitura confortável — acima disso, conte com Ampliar (Z) na apresentação. “Receita = 120” vira uma árvore de KPIs, com o valor à direita. Duplo clique num nó edita no slide.',
    norm: function (d) { d.items = itParse(d.items).map(function (o) { var r = { t: o.t, lv: o.lv }; if (o.v) r.v = o.v; if (o.hl) r.hl = 1; return r; }); return d; },
    outlineParse: function (text) { return R.FX.issuetree.norm({ items: text }).items; },
    outlineText: itText,
    html: function (d, w, h, el) {
      var v = VV(el, 'issuetree'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var roots = itTree(itParse(d.items)), nodes = [], D = 0, NL = 0, slot = 0, anyHl = false, g1 = -1, N = '', S = '';
      function leaves(n) { n.nl = n.kids.length ? n.kids.reduce(function (a, c) { return a + leaves(c); }, 0) : 1; return n.nl; }
      function place(n, depth, g) { n.d = depth; n.g = g; if (depth > D) D = depth; if (n.hl) anyHl = true; if (depth === 1) n.g = ++g1; if (!n.kids.length) { n.y = slot + .5; slot++; } else { n.kids.forEach(function (c) { place(c, depth + 1, n.g); }); n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2; } nodes.push(n); }
      roots.forEach(function (r) { NL += leaves(r); }); roots.forEach(function (r) { place(r, 0, null); });
      var gap = w * .035, cw = (w - gap * D) / (D + 1), sh = h / Math.max(1, NL), nh = Math.min(sh * .84, h * .3), fs = Math.max(8, Math.min(w * .015, h * .042, nh / 2.6, cw / 13));
      nodes.forEach(function (n, k) {
        var x = n.d * (cw + gap), y = n.y * sh - nh / 2, gA = n.g == null ? '' : ' data-g="' + n.g + '"';
        N += '<div class="it-n d' + n.d + (n.hl ? ' hl' : '') + '"' + gA + ' style="--i:' + k + ';--lv:' + n.d + ';left:' + pc(x, w) + ';top:' + pc(y, h) + ';width:' + pc(cw, w) + ';height:' + pc(nh, h) + '"><b>' + E('items.' + n.i + '.t', n.t) + '</b>' + (n.v ? '<span class="it-v">' + E('items.' + n.i + '.v', n.v) + '</span>' : '') + '</div>';
        n.kids.forEach(function (c) { S += '<path class="it-c' + (n.hl && c.hl ? ' hl' : '') + '"' + (c.g == null ? '' : ' data-g="' + c.g + '"') + ' pathLength="1" style="--i:' + k + ';--lv:' + c.d + '" d="M' + f1(x + cw) + ' ' + f1(n.y * sh) + 'H' + f1(x + cw + gap / 2) + 'V' + f1(c.y * sh) + 'H' + f1(c.d * (cw + gap)) + '"/>'; });
      });
      if (!nodes.length) N = '<div class="it-empty"><b>Árvore de problemas</b>Escreva a pergunta-chave na primeira linha do painel e as hipóteses abaixo dela (Tab = nível abaixo).</div>';
      return root('fxit' + (anyHl ? ' it-hl' : ''), v, fs, '', v === 'focus') + '<svg viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="none">' + S + '</svg>' + N + '</div>';
    }
  };

  /* ---------- 7. Matriz BCG ---------- */
  R.FX.bcg = {
    name: 'Matriz BCG', cat: 'Estratégia', model: true, w: 900, h: 470, variant: 'drop',
    kw: 'bcg matriz portfólio portfolio estrelas vacas leiteiras abacaxis pontos de interrogação crescimento participação de mercado boston unidades de negócio bolhas',
    variants: [['drop', 'Bolhas pousando', 'Os quadrantes surgem e as unidades caem nas suas posições.'], ['grow', 'Por tamanho', 'As bolhas crescem da maior para a menor receita.'], ['move', 'Rumo à meta', 'Depois da entrada, as setas tracejadas mostram para onde cada unidade deve ir.'], ['quadrants', 'Quadrante a quadrante', 'Cada quadrante entra com as suas unidades: estrelas, interrogações, vacas e abacaxis.']],
    data: { xlab: 'Participação relativa de mercado', ylab: 'Crescimento do mercado', q: ['Estrelas', 'Pontos de interrogação', 'Vacas leiteiras', 'Abacaxis'], items: [{ t: 'Linha premium', x: 78, y: 72, s: 34 }, { t: 'Varejo digital', x: 28, y: 80, s: 16, tx: 62, ty: 76 }, { t: 'Atacado', x: 80, y: 26, s: 48 }, { t: 'Linha básica', x: 30, y: 22, s: 12 }, { t: 'Serviços', x: 42, y: 56, s: 20, tx: 64, ty: 64 }] },
    fields: [['items', 'Unidades (nome | participação relativa 0–100 | crescimento 0–100 | receita | meta de participação | meta de crescimento)', 'rows:t|x:n|y:n|s:n|tx:n|ty:n'], ['q', 'Nome dos quadrantes (4 linhas: sup. esq., sup. dir., inf. esq., inf. dir.)', 'lines'], ['xlab', 'Eixo horizontal'], ['ylab', 'Eixo vertical']],
    tip: 'Participação alta fica à esquerda, como na BCG clássica. O tamanho da bolha segue a receita; a meta (opcional) desenha a seta tracejada. Os rótulos desviam das bolhas vizinhas (ao lado, acima ou abaixo).',
    norm: normer(['q'], { items: 't|x|y|s|tx|ty' }),
    html: function (d, w, h, el) {
      var v = VV(el, 'bcg'), dm = dims(el, w, h); w = dm[0]; h = dm[1];
      var q = strs(d.q, 4, 40), DEFQ = ['Estrelas', 'Pontos de interrogação', 'Vacas leiteiras', 'Abacaxis'], IT = rows(d.items, 12), fs = Math.max(9, Math.min(h * .036, w * .02)), pw = w * .93, ph = h * .87, smax = 0, o = '', ar = '', obs = [], lbs = [];
      IT.forEach(function (it) { smax = Math.max(smax, num(it.s)); });
      var rmax = Math.min(pw, ph) * .085, rmin = Math.min(pw, ph) * .022, order = IT.map(function (it, k) { return [num(it.s), k]; }).sort(function (a, b) { return b[0] - a[0]; }), rank = {};
      order.forEach(function (p, r) { rank[p[1]] = r; });
      [0, 1, 2, 3].forEach(function (g) { var qn = q[g] || DEFQ[g], qw = qn.length * .45 * fs + 1.7 * fs, qh = 2.25 * fs; o += '<div class="bc-q bc-q' + g + '" data-g="' + g + '" style="--g:' + g + '">' + E('q.' + g, qn) + '</div>'; obs.push([g % 2 ? pw - qw : 0, g > 1 ? ph - qh : 0, g % 2 ? pw : qw, g > 1 ? ph : qh]); }); /* o nome do quadrante (canto) é obstáculo para os rótulos */
      function ov(a, b) { return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); }
      var B = []; IT.forEach(function (it, k) { /* linha vazia (nulo num arquivo editado à mão) não vira bolha no canto; a posição k continua a do item guardado */
        if (!txt(it.t, 60) && !has(it.x) && !has(it.y) && !has(it.s)) return;
        var x = cl(num(it.x), 0, 100), y = cl(num(it.y), 0, 100), s = Math.max(0, num(it.s)), r = smax > 0 ? rmin + Math.sqrt(s / smax) * (rmax - rmin) : rmin, px = (100 - x) / 100 * pw, py = (100 - y) / 100 * ph;
        var b = { k: k, r: r, px: px, py: py, g: (y >= 50 ? 0 : 2) + (x >= 50 ? 0 : 1), lft: px / pw > .66, tg: has(it.tx) || has(it.ty), t: txt(it.t, 60), box: [px - r, py - r, px + r, py + r] };
        if (b.tg) { var qx = (100 - cl(num(it.tx), 0, 100)) / 100 * pw, qy = (100 - cl(num(it.ty), 0, 100)) / 100 * ph, dx = qx - px, dy = qy - py; b.qx = qx; b.qy = qy; b.L = Math.hypot(dx, dy) || 1; b.ux = dx / b.L; b.uy = dy / b.L; if (Math.abs(b.ux) > .3) b.lft = b.ux > 0; if (v === 'move') obs.push([qx - r, qy - r, qx + r, qy + r]); } /* o rótulo fica do lado oposto ao da seta */
        obs.push(b.box); B.push(b);
      });
      B.forEach(function (b) {
        var k = b.k, r = b.r, px = b.px, py = b.py, g = b.g, st = ';--n:' + k + ';--g:' + g + ';--k:' + rank[k], lw = b.t.length * .56 * fs + 2, lh = fs * 1.1, best = null, bs = Infinity;
        /* rótulo: lado preferido (oposto à seta) centrado, alinhado ao topo ou à base da bolha; depois o outro lado, acima e abaixo — fica no
           primeiro lugar sem colisão com bolhas, nomes dos quadrantes, rótulos já postos nem com a borda do gráfico; se todos colidem, no de menor área em conflito */
        function side(cls, sx, dy) { var x = px + sx * (r + 6), y = py + dy; return [cls, x, y, [sx > 0 ? x : x - lw, y - lh / 2, sx > 0 ? x + lw : x, y + lh / 2]]; }
        var sh = Math.max(0, r - lh / 2), R = [side('', 1, 0), side('', 1, -sh), side('', 1, sh)], Lf = [side('l', -1, 0), side('l', -1, -sh), side('l', -1, sh)];
        var C = (b.lft ? Lf.concat(R) : R.concat(Lf)).concat([['u', px, py - r - 4, [px - lw / 2, py - r - 4 - lh, px + lw / 2, py - r - 4]], ['d', px, py + r + 4, [px - lw / 2, py + r + 4, px + lw / 2, py + r + 4 + lh]]]);
        C.forEach(function (c) { var bx = c[3], sc = lw * lh - ov(bx, [-4, -4, pw + 4, ph + 4]); obs.forEach(function (ob) { if (ob !== b.box) sc += ov(bx, ob); }); lbs.forEach(function (lb) { sc += ov(bx, lb); }); if (sc < bs - .5) { bs = sc; best = c; } });
        lbs.push(best[3]);
        o += '<div class="bc-b bc-c' + g + '" data-g="' + g + '" style="left:' + pc(px, pw) + ';top:' + pc(py, ph) + ';width:' + pc(2 * r, pw) + st + '"></div><div class="bc-lb' + (best[0] ? ' ' + best[0] : '') + '" data-g="' + g + '" style="left:' + pc(Math.max(0, best[1]), pw) + ';top:' + pc(Math.max(0, best[2]), ph) + st + '">' + E('items.' + k + '.t', b.t) + '</div>';
        if (b.tg) { /* meta: seta tracejada da bolha até a posição desejada; a bolha-fantasma só na variante “Rumo à meta” */
          var ux = b.ux, uy = b.uy, qx = b.qx, qy = b.qy, x1 = px + ux * (r + 4), y1 = py + uy * (r + 4), x2 = qx - ux * (r + 4), y2 = qy - uy * (r + 4);
          if (b.L > r * 2 + 12) ar += '<g class="bc-ar' + (ux < 0 ? ' l' : '') + '" data-g="' + g + '" style="--n:' + k + '"><path class="bc-al" pathLength="1" d="M' + f1(x1) + ' ' + f1(y1) + 'L' + f1(x2) + ' ' + f1(y2) + '"/><path class="bc-ah" d="M' + f1(x2) + ' ' + f1(y2) + 'L' + f1(x2 - ux * 12 - uy * 6) + ' ' + f1(y2 - uy * 12 + ux * 6) + 'L' + f1(x2 - ux * 12 + uy * 6) + ' ' + f1(y2 - uy * 12 - ux * 6) + 'Z"/></g>';
          o += '<div class="bc-gh bc-c' + g + '" data-g="' + g + '" style="left:' + pc(qx, pw) + ';top:' + pc(qy, ph) + ';width:' + pc(2 * r, pw) + st + '"></div>';
        }
      });
      return root('fxbc', v, fs, '', false) + '<div class="bc-plot">' + o + '<svg class="bc-ax" viewBox="0 0 ' + f1(pw) + ' ' + f1(ph) + '" preserveAspectRatio="none">' + ar + '</svg></div><div class="bc-y">' + E('ylab', txt(d.ylab, 60)) + ' →</div><div class="bc-x"><small>alta</small><span>' + E('xlab', txt(d.xlab, 60)) + '</span><small>baixa</small></div></div>';
    }
  };

  /* utilitários expostos (testes e extensões): posição no cronograma e o codec da árvore */
  R.ganttPos = gpos; R.treeParse = itParse; R.treeText = itText;
})(window.AMRT);
