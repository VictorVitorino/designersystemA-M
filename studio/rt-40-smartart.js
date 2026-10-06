/* ===== SmartArt (item 4.3): um modelo, doze layouts, alimentado por um painel de texto =====
   FX.smart no contrato de runtime.js (html(d, w, h, el) puro; CSS em rt-40-smartart.css, dentro de .am-in e com
   calc(var(--d,0ms) + …)). Vai junto em todo arquivo exportado (assemble.py concatena rt-*.js ao runtime).
   Dados: data.layout (um dos SMART_LAYOUTS) e data.items = [{t, lv}] (um item por linha do painel; lv 0–2 = recuo).
   Trocar o layout mantém os itens, como “Alterar layout” do PowerPoint. Todo número que chega à marcação passa por clamp;
   todo texto sai por esc()/E(). Classes: .fxsa (raiz), .sal-<layout> (modificador), .sa-* (peças). Sem keyframes novos. */
(function (R) {
  'use strict';
  var U = R.util, esc = U.esc, CQ = U.CQ, E = U.E, VV = U.VV;
  /* [chave, rótulo, grupo, dica (painel), mínimo, máximo de itens principais] */
  var LAYOUTS = [
    ['process', 'Processo', 'Processos', 'Etapas da esquerda para a direita, ligadas por setas; os detalhes (Tab) viram tópicos dentro de cada caixa.', 2, 8],
    ['chevron', 'Processo em chevrons', 'Processos', 'Etapas encadeadas em setas largas; os detalhes (Tab) ficam embaixo de cada uma.', 2, 7],
    ['stepup', 'Degraus', 'Processos', 'Fases ou níveis de maturidade que sobem; o último degrau acende em laranja.', 2, 8],
    ['cycle', 'Ciclo', 'Ciclos e relações', 'Etapas que se repetem, no sentido horário a partir do topo (só os itens principais).', 3, 10],
    ['hub', 'Radial (hub)', 'Ciclos e relações', 'A primeira linha é o centro; as seguintes, os raios em volta dele.', 3, 11],
    ['venn', 'Venn', 'Ciclos e relações', 'Dois ou três conjuntos; uma linha começando com “=” nomeia a interseção.', 2, 3],
    ['org', 'Hierarquia', 'Hierarquia e listas', 'Organograma com até três níveis (Tab = subordinado), até 20 caixas.', 1, 20],
    ['blocks', 'Lista em blocos', 'Hierarquia e listas', 'Títulos à esquerda e tópicos (Tab) na faixa à direita.', 2, 8],
    ['matrix', 'Matriz 2×2', 'Hierarquia e listas', 'Quatro quadrantes, nesta ordem: superior esquerdo, superior direito, inferior esquerdo, inferior direito.', 4, 4],
    ['pyramid', 'Pirâmide', 'Camadas', 'Camadas do topo para a base; os detalhes (Tab) ficam à direita de cada uma.', 2, 8],
    ['funnel', 'Funil', 'Camadas', 'Camadas da mais larga para a mais estreita; os detalhes (Tab) ficam à direita.', 2, 8],
    ['target', 'Alvo (camadas)', 'Camadas', 'A primeira linha é o núcleo; as seguintes, os anéis em volta, com rótulos à direita.', 2, 6],
    /* S32 */
    ['flow', 'Fluxograma', 'Processos', 'Etapas em serpentina (até 4 por linha), ligadas por setas; “?” no início = decisão (losango); Início/Fim viram pílulas; os detalhes (Tab) ficam dentro da caixa.', 2, 16],
    ['mindmap', 'Mapa mental', 'Ciclos e relações', 'A primeira linha é o tema central; as seguintes, os ramos (alternam direita e esquerda); os detalhes (Tab) são os sub-ramos.', 2, 12]
  ];
  var RAMP = ['#002A46', '#13406A', '#43698F', '#7EA1C3', '#A3B8D6', '#C9D6E8'], SETS = ['#002A46', '#4A6FA5', '#7EA1C3'], RINGS = ['#F78C16', '#002A46', '#43698F', '#7EA1C3', '#A3B8D6', '#C9D6E8'];
  function find(k) { for (var i = 0; i < LAYOUTS.length; i++) if (LAYOUTS[i][0] === k) return LAYOUTS[i]; return null; }
  function lvOf(v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(2, v | 0)) : 0; }
  function clean(t) { return typeof t === 'string' || typeof t === 'number' ? String(t).replace(/\s+/g, ' ').trim().slice(0, 200) : ''; } /* objeto/array/nulo = item descartado (nunca “[object Object]”) */
  /* codec 'outline': texto ↔ [{t, lv}] (Tab ou 2 espaços = 1 nível; marcadores -, •, * ignorados; linhas vazias somem; nível
     nunca pula mais de um degrau). Com um array, mantém o índice original em .i para a edição no slide (items.N.t). */
  function parse(v) {
    var out = [], prev = -1;
    function push(t, lv, i) { t = clean(t); if (!t) return; lv = Math.min(lvOf(lv), prev + 1); prev = lv; var o = { t: t, lv: lv }; if (i != null) o.i = i; out.push(o); }
    if (Array.isArray(v)) v.forEach(function (o, i) { if (o == null) return; if (typeof o === 'object') push(o.t, o.lv, i); else push(o, 0, i); });
    else String(v == null ? '' : v).replace(/\r/g, '').split('\n').forEach(function (l) { var m = /^([\t ]*)(?:[-•*·]\s+)?(.*)$/.exec(l); push(m[2], Math.floor(m[1].replace(/\t/g, '  ').length / 2)); });
    return out.slice(0, 60);
  }
  function text(items) { return parse(items).map(function (o) { return new Array(o.lv + 1).join('  ') + o.t; }).join('\n'); }
  /* árvore: raízes com kids; cada nó {t, lv, i (índice em data.items), kids} */
  function tree(items) {
    var roots = [], stack = [];
    items.forEach(function (o, k) {
      var n = { t: o.t, lv: o.lv, i: o.i != null ? o.i : k, kids: [] };
      while (stack.length && stack[stack.length - 1].lv >= n.lv) stack.pop();
      if (stack.length) stack[stack.length - 1].kids.push(n); else roots.push(n);
      stack.push(n);
    });
    return roots;
  }
  function pc(v, t) { return (t ? v / t * 100 : 0).toFixed(3) + '%'; }
  function f1(v) { return (+v || 0).toFixed(1); }
  function longest(list) { var m = 1; list.forEach(function (t) { String(t).split(' ').forEach(function (wd) { if (wd.length > m) m = wd.length; }); }); return m; }
  /* tamanho de fonte que cabe: a palavra mais longa dos títulos (Roboto Condensed 700, ≈.56em por caractere com 1.12em de
     corpo) numa linha da caixa, descontando o recuo (padEm, em em) */
  function fitW(fs, boxW, padEm, titles) { return Math.max(8, fs * .55, Math.min(fs, boxW / (longest(titles) * .6 + padEm))); } /* nunca abaixo de 55 % do corpo base: palavra rara quebra no meio em vez de a fonte sumir */
  function fitH(fs, boxH, lines) { return Math.max(8, fs * .55, Math.min(fs, boxH / (1.35 + lines * 1.2))); }
  function maxKids(nodes) { var m = 0; nodes.forEach(function (o) { if (o.kids.length > m) m = o.kids.length; }); return m; }
  function titles(nodes) { return nodes.map(function (o) { return o.t; }); }

  /* miniatura de cada layout (48×32): navy, aço, gelo e um toque laranja; cls opcional no <svg> */
  var ICO = {
    process: '<rect x="2" y="8" width="11" height="16" rx="2" fill="#C9D6E8"/><rect x="18.5" y="8" width="11" height="16" rx="2" fill="#C9D6E8"/><rect x="35" y="8" width="11" height="16" rx="2" fill="#C9D6E8"/><path d="M2 8h11M18.5 8h11" stroke="#002A46" stroke-width="2"/><path d="M35 8h11" stroke="#F78C16" stroke-width="2"/><path d="M13.5 16h4.5M30 16h4.5" stroke="#7EA1C3" stroke-width="1.6"/>',
    chevron: '<path d="M2 8h12l5 8-5 8H2z" fill="#002A46"/><path d="M15.5 8h12l5 8-5 8h-12l5-8z" fill="#002A46"/><path d="M29 8h12l5 8-5 8H29l5-8z" fill="#F78C16"/>',
    stepup: '<rect x="2" y="20" width="13" height="10" rx="1" fill="#002A46"/><rect x="17.5" y="12" width="13" height="18" rx="1" fill="#13406A"/><rect x="33" y="3" width="13" height="27" rx="1" fill="#F78C16"/>',
    cycle: '<circle cx="24" cy="16" r="10" fill="none" stroke="#7EA1C3" stroke-width="1.6" stroke-dasharray="9 5"/><rect x="18" y="1" width="12" height="7" rx="3.5" fill="#F78C16"/><rect x="31" y="20" width="12" height="7" rx="3.5" fill="#002A46"/><rect x="5" y="20" width="12" height="7" rx="3.5" fill="#002A46"/>',
    hub: '<path d="M24 16L8 6M24 16l16-10M24 16L8 26M24 16l16 10" stroke="#7EA1C3" stroke-width="1.5"/><circle cx="24" cy="16" r="6.5" fill="#F78C16"/><rect x="2" y="2" width="12" height="7" rx="3.5" fill="#fff" stroke="#002A46" stroke-width="1.5"/><rect x="34" y="2" width="12" height="7" rx="3.5" fill="#fff" stroke="#002A46" stroke-width="1.5"/><rect x="2" y="23" width="12" height="7" rx="3.5" fill="#fff" stroke="#002A46" stroke-width="1.5"/><rect x="34" y="23" width="12" height="7" rx="3.5" fill="#fff" stroke="#002A46" stroke-width="1.5"/>',
    venn: '<circle cx="18" cy="16" r="12" fill="#002A46" fill-opacity=".8"/><circle cx="30" cy="16" r="12" fill="#4A6FA5" fill-opacity=".8"/><circle cx="24" cy="16" r="3" fill="#F78C16"/>',
    org: '<rect x="17" y="2" width="14" height="8" rx="1.5" fill="#002A46"/><rect x="2" y="21" width="12" height="8" rx="1.5" fill="#4A6FA5"/><rect x="18" y="21" width="12" height="8" rx="1.5" fill="#4A6FA5"/><rect x="34" y="21" width="12" height="8" rx="1.5" fill="#4A6FA5"/><path d="M24 10v5.5M8 21v-5.5h32V21M24 15.5V21" fill="none" stroke="#7EA1C3" stroke-width="1.5"/>',
    blocks: '<rect x="2" y="2" width="13" height="8" rx="1" fill="#F78C16"/><rect x="16" y="2" width="30" height="8" rx="1" fill="#EEF2F7"/><rect x="2" y="12" width="13" height="8" rx="1" fill="#002A46"/><rect x="16" y="12" width="30" height="8" rx="1" fill="#EEF2F7"/><rect x="2" y="22" width="13" height="8" rx="1" fill="#002A46"/><rect x="16" y="22" width="30" height="8" rx="1" fill="#EEF2F7"/><path d="M20 6h16M20 16h12M20 26h18" stroke="#A3B8D6" stroke-width="1.5"/>',
    matrix: '<rect x="4" y="2" width="19" height="13" rx="1.5" fill="#002A46"/><rect x="25" y="2" width="19" height="13" rx="1.5" fill="#4A6FA5"/><rect x="4" y="17" width="19" height="13" rx="1.5" fill="#DCE5F0"/><rect x="25" y="17" width="19" height="13" rx="1.5" fill="#DCE5F0"/><rect x="25" y="17" width="2.5" height="13" fill="#F78C16"/>',
    pyramid: '<path d="M24 2l5 9H19z" fill="#002A46"/><path d="M18 12.5h12l5 8.5H13z" fill="#43698F"/><path d="M12.5 22.5h23l5 8.5H7.5z" fill="#A3B8D6"/>',
    funnel: '<path d="M7 2h34l-5.5 8.5h-23z" fill="#002A46"/><path d="M13 12h22l-5 8.5H18z" fill="#43698F"/><path d="M18.5 22h11L24 30.5z" fill="#A3B8D6"/>',
    target: '<circle cx="15" cy="16" r="14" fill="#7EA1C3"/><circle cx="15" cy="16" r="9.5" fill="#43698F"/><circle cx="15" cy="16" r="5" fill="#F78C16"/><path d="M17 16h14M22 10h9M24 22h7" stroke="#A3B8D6" stroke-width="1.5"/>',
    flow: '<rect x="2" y="3" width="12" height="8" rx="4" fill="#F78C16"/><rect x="18" y="3" width="12" height="8" rx="1.5" fill="#002A46"/><path d="M41 2l6 6-6 6-6-6z" fill="#4A6FA5"/><rect x="34" y="21" width="12" height="8" rx="1.5" fill="#002A46"/><rect x="18" y="21" width="12" height="8" rx="1.5" fill="#002A46"/><rect x="2" y="21" width="12" height="8" rx="4" fill="#F78C16"/><path d="M14 7h4M30 7h5M41 14v7M34 25h-4M18 25h-4" stroke="#7EA1C3" stroke-width="1.5" fill="none"/>',
    mindmap: '<rect x="17" y="12" width="14" height="8" rx="4" fill="#002A46"/><rect x="34" y="3" width="12" height="7" rx="2" fill="#F78C16"/><rect x="34" y="22" width="12" height="7" rx="2" fill="#4A6FA5"/><rect x="2" y="3" width="12" height="7" rx="2" fill="#43698F"/><rect x="2" y="22" width="12" height="7" rx="2" fill="#7EA1C3"/><path d="M31 15c3 0 2-8 3-8M31 17c3 0 2 8 3 8M17 15c-3 0-2-8-3-8M17 17c-3 0-2 8-3 8" stroke="#A3B8D6" stroke-width="1.5" fill="none"/>'
  };
  /* itens de exemplo por layout (inserção pelo seletor / Inserir › SmartArt ▸ e arrastar); o painel de texto substitui tudo */
  var SAMPLE = {
    chevron: 'Descobrir\n  Entrevistas\n  Dados\nDefinir\n  Problema-chave\nDesenvolver\n  Protótipos\nEntregar\n  Piloto e escala',
    stepup: 'Inicial\n  Ad hoc\nRepetível\n  Processos básicos\nDefinido\n  Padrões únicos\nGerenciado\n  Métricas\nOtimizado\n  Melhoria contínua',
    cycle: 'Planejar\nExecutar\nVerificar\nAgir', hub: 'PMO\nFinanças\nTI\nOperações\nRH\nJurídico\nComercial', venn: 'Desejável\nViável\nFactível\n= Inovação',
    org: 'CEO\n  Operações\n    Supply\n    Fábricas\n  Finanças\n    Controladoria\n    Tesouraria\n  Pessoas\n    Talentos',
    blocks: 'Pessoas\n  Novo modelo de papéis\n  Plano de capacitação\nProcessos\n  Fluxo de aprovação em 2 níveis\nTecnologia\n  Workflow único e painel de status',
    matrix: 'Manter\n  Processos estáveis\nInvestir\n  Alto potencial\nRevisar\n  Baixo retorno\nDescontinuar\n  Sem aderência',
    pyramid: 'Propósito\n  Por que existimos\nEstratégia\n  Onde jogar e como vencer\nCapacidades\n  O que precisamos dominar\nOperação\n  Processos, sistemas e pessoas',
    funnel: 'Ideias\n  120 propostas\nTriagem\n  45 viáveis\nPilotos\n  12 testes\nEscala\n  4 iniciativas',
    target: 'Núcleo: propósito\n  O que nunca muda\nValores\n  Como decidimos\nComportamentos\n  O que se vê no dia a dia\nSímbolos\n  Rituais, espaços e marcas',
    flow: 'Início\nReceber pedido\n  Portal ou e-mail\n? Dados completos\nValidar crédito\nSeparar e faturar\n? Entrega no prazo\nNotificar cliente\nFim',
    mindmap: 'Transformação digital\nClientes\n  Portal único\n  Autoatendimento\nOperações\n  Automação\n  Painéis de status\nPessoas\n  Capacitação\n  Novos papéis\nDados\n  Dados mestres\n  Governança'
  };
  function sample(k) { return parse(Object.prototype.hasOwnProperty.call(SAMPLE, k) ? SAMPLE[k] : R.FX.smart.data.items).map(function (o) { return { t: o.t, lv: o.lv }; }); }
  function icon(k, cls) { return '<svg viewBox="0 0 48 32"' + (cls ? ' class="' + esc(cls) + '"' : '') + ' aria-hidden="true">' + (ICO[k] || ICO.process) + '</svg>'; }

  R.FX.smart = {
    name: 'SmartArt (diagrama por texto)', cat: 'SmartArt', model: true, w: 1000, h: 420, variant: 'one', anim: { in: 'fade' },
    kw: 'smartart smart art diagrama processo etapas chevron degraus ciclo radial hub organograma hierarquia pirâmide piramide funil venn matriz 2x2 alvo camadas lista blocos painel de texto',
    variants: [['one', 'Um por um', 'Os itens entram na ordem do texto; os conectores se desenham entre eles.'], ['level', 'Por nível', 'Primeiro os itens principais, depois os detalhes.'], ['all', 'Tudo junto', 'O diagrama inteiro surge com um zoom suave.'], ['focus', 'Foco percorrendo', 'Na apresentação, o destaque passa de item principal em item principal.']],
    data: { layout: 'process', items: [{ t: 'Diagnóstico', lv: 0 }, { t: 'Entrevistas e dados', lv: 1 }, { t: 'Desenho', lv: 0 }, { t: 'Modelo TO-BE', lv: 1 }, { t: 'Implementação', lv: 0 }, { t: 'Ondas e squads', lv: 1 }, { t: 'Sustentação', lv: 0 }, { t: 'KPIs e rituais', lv: 1 }] },
    fields: [['layout', 'Layout', 'smartlayout'], ['items', 'Itens (um por linha; Tab = nível abaixo)', 'outline']],
    tip: 'Duplo clique num texto do diagrama para editar no slide. Trocar o layout mantém os itens.',
    /* normalização (safeEl, ao abrir/colar): itens viram [{t, lv}] e o layout fica válido */
    norm: function (d) { d.items = parse(d.items).map(function (o) { return { t: o.t, lv: o.lv }; }); if (!find(d.layout)) d.layout = 'process'; return d; },
    /* nome por elemento (gancho opcional do contrato: cabeçalho do painel e rodapé do “Ampliar” via AMRT.fxLabel): “SmartArt · Processo” */
    label: function (el) { return 'SmartArt · ' + (find(el && el.data && el.data.layout) || LAYOUTS[0])[1]; },
    html: function (d, w, h, el) {
      var v = VV(el, 'smart'), def = find(d.layout) || LAYOUTS[0], L = def[0], items = parse(d.items), all = tree(items), nodes = all.slice(0, def[5]), n = Math.max(1, nodes.length);
      w = Math.max(40, +w || 40); h = Math.max(40, +h || 40); /* antes de qualquer conta: NaN/negativo nunca chega à marcação */
      var fs = Math.max(9, Math.min(h * .05, w * .022)), N = '', S = '', ord = 0, k;
      function li(kids, g) { return kids.length ? '<ul>' + kids.map(function (c) { return '<li>' + E('items.' + c.i + '.t', c.t) + '</li>'; }).join('') + '</ul>' : ''; }
      /* toda caixa que vira marcação passa por aqui: largura/altura entre 0 e a caixa do elemento, posição dentro dela (nunca “width:-10%”) */
      function box(x, y, ww, hh) { ww = Math.max(0, Math.min(w, +ww || 0)); hh = Math.max(0, Math.min(h, +hh || 0)); x = Math.max(0, Math.min(w - ww, +x || 0)); y = Math.max(0, Math.min(h - hh, +y || 0)); return 'left:' + pc(x, w) + ';top:' + pc(y, h) + ';width:' + pc(ww, w) + ';height:' + pc(hh, h); }
      /* texto editável no slide; o.ep = prefixo escondido na tela que o editor devolve ao gravar (Venn: “= ”) */
      function lab(o) { return o.ep ? '<span data-e="items.' + o.i + '.t" data-ep="' + esc(o.ep) + '">' + esc(o.t) + '</span>' : E('items.' + o.i + '.t', o.t); }
      function node(o, x, y, ww, hh, cls, g, extra, noKids, oi) {
        N += '<div class="sa-n lv' + o.lv + ' ' + cls + '" data-g="' + g + '" style="' + box(x, y, ww, hh) + ';--i:' + (oi != null ? oi : ord++) + ';--lv:' + o.lv + (extra || '') + '"><b>' + lab(o) + '</b>' + (noKids ? '' : li(o.kids)) + '</div>';
      }
      function ln(dd, i, cls, extra) { S += '<path class="sa-ln' + (cls ? ' ' + cls : '') + '" pathLength="1" style="--i:' + i + (extra || '') + '" d="' + dd + '"/>'; }
      function head(x, y, a, s, i) { S += '<path class="sa-hd" style="--i:' + i + '" d="M' + f1(x) + ' ' + f1(y) + 'L' + f1(x - s * Math.cos(a - .5)) + ' ' + f1(y - s * Math.sin(a - .5)) + 'L' + f1(x - s * Math.cos(a + .5)) + ' ' + f1(y - s * Math.sin(a + .5)) + 'Z"/>'; }
      var gap, bw, kidsN = maxKids(nodes), tt = titles(nodes);
      if (L === 'process') {
        gap = w * .045; bw = (w - gap * (n - 1)) / n; fs = fitH(fitW(fs, bw, 2.4, tt), h * .88, kidsN + 1);
        nodes.forEach(function (o, k) {
          var x = k * (bw + gap); node(o, x, h * .06, bw, h * .88, 'sa-box' + (k === n - 1 ? ' sa-last' : ''), k);
          if (k < n - 1) { var ax = x + bw + gap * .16, ay = h / 2; ln('M' + f1(ax) + ' ' + f1(ay) + 'H' + f1(ax + gap * .62), k, 'sa-arw'); head(ax + gap * .72, ay, 0, gap * .3, k); }
        });
      } else if (L === 'chevron') {
        var ch = Math.min(h * .32, w * .14), pd = Math.min(w / n * .34, ch * .5), g2 = w * .006; bw = (w + (n - 1) * (pd - g2)) / n; pd = Math.min(bw * .34, ch * .5); bw = (w + (n - 1) * (pd - g2)) / n;
        fs = fitW(fs, bw - 2 * pd, 1.2, tt); var pe = pd / fs, pp = (pd / bw * 100).toFixed(2);
        nodes.forEach(function (o, k) {
          var x = k * (bw - pd + g2), first = k === 0;
          node(o, x, 0, bw, ch, 'sa-chev' + (first ? ' sa-first' : '') + (k === n - 1 ? ' sa-last' : ''), k, ';padding:0 ' + (pe + .3).toFixed(2) + 'em 0 ' + (first ? '.9' : (pe + .4).toFixed(2)) + 'em;clip-path:polygon(0 0,' + (100 - pp) + '% 0,100% 50%,' + (100 - pp) + '% 100%,0 100%' + (first ? '' : ',' + pp + '% 50%') + ')', true);
          if (o.kids.length) N += '<div class="sa-sub" data-g="' + k + '" style="' + box(x + (first ? bw * .04 : pd * .8), ch + h * .05, bw - pd * 1.4 - bw * .04, h - ch - h * .05) + ';--i:' + (ord++) + '">' + li(o.kids) + '</div>';
        });
      } else if (L === 'stepup') {
        bw = w / n; fs = fitW(fs, bw, 2.2, tt); fs = fitH(fs, h * .34, kidsN + 1);
        nodes.forEach(function (o, k) { var hh = h * (.34 + .64 * (k + 1) / n); node(o, k * bw, h - hh, bw - w * .008, hh, 'sa-step' + (k === n - 1 ? ' sa-last' : ''), k); });
      } else if (L === 'cycle') {
        /* elipse (aproveita a largura); as pílulas cabem na corda entre vizinhas; setas em arco entre elas */
        var cx = w / 2, cy = h / 2, ry = h * .36, rx = Math.min(w * .3, ry * 1.7), ang = function (k) { return -Math.PI / 2 + k * 2 * Math.PI / n; }, pt = function (a) { return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; };
        var chord = rx * 2; for (k = 0; k < n && n > 1; k++) { var q0 = pt(ang(k)), q1 = pt(ang(k + 1)); chord = Math.min(chord, Math.hypot(q1[0] - q0[0], q1[1] - q0[1])); }
        var pw = Math.min(w * .22, rx * 1.1, chord * .92), ph = Math.min(h * .2, ry * .8, chord * .6);
        fs = fitW(fs, pw, 1.6, tt); fs = fitH(fs, ph, 1);
        nodes.forEach(function (o, k) { var c = pt(ang(k)); node(o, c[0] - pw / 2, c[1] - ph / 2, pw, ph, 'sa-pill' + (k === 0 ? ' sa-first' : ''), k, '', true); });
        if (n > 1) for (k = 0; k < n; k++) {
          /* o arco começa onde a elipse sai da pílula de partida (+ folga) e termina onde entra na de chegada */
          var a0 = ang(k), a1 = ang(k + 1), c0 = pt(a0), c1 = pt(a1), mg = fs * .45, out = function (p, c) { return Math.abs(p[0] - c[0]) > pw / 2 + mg || Math.abs(p[1] - c[1]) > ph / 2 + mg; }, lim = (a1 - a0) * .45, d0 = 0, d1 = 0;
          while (d0 < lim && !out(pt(a0 + d0), c0)) d0 += .02; while (d1 < lim && !out(pt(a1 - d1), c1)) d1 += .02;
          a0 += d0; a1 -= d1; if (a1 <= a0) continue;
          var p0 = pt(a0), p1 = pt(a1);
          ln('M' + f1(p0[0]) + ' ' + f1(p0[1]) + 'A' + f1(rx) + ' ' + f1(ry) + ' 0 0 1 ' + f1(p1[0]) + ' ' + f1(p1[1]), k, 'sa-arw');
          head(p1[0], p1[1], Math.atan2(ry * Math.cos(a1), -rx * Math.sin(a1)), Math.min(fs * .9, ry * .18), k);
        }
      } else if (L === 'hub') {
        var hubN = nodes[0] || { t: '', i: 0, lv: 0, kids: [] }, sp = nodes.length > 1 ? nodes.slice(1) : hubN.kids.slice(0, def[5] - 1), m = Math.max(1, sp.length), cx2 = w / 2, cy2 = h / 2;
        var hr = Math.min(h * .19, w * .1), sh = Math.min(h * .19, hr * 1.1), sw = Math.min(w * .19, sh * 2.8), rx = w / 2 - sw / 2 - w * .005, ry = h / 2 - sh / 2 - h * .01;
        var per = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2); sw = Math.min(sw, per / m * .82); sh = Math.min(sh, sw * .62); rx = w / 2 - sw / 2 - w * .005; ry = h / 2 - sh / 2 - h * .01;
        fs = fitW(fs, Math.min(sw, hr * 1.9), 1.6, titles(sp).concat([hubN.t])); fs = fitH(fs, sh, 1);
        node({ t: hubN.t, lv: 0, i: hubN.i, kids: [] }, cx2 - hr * 1.15, cy2 - hr, hr * 2.3, hr * 2, 'sa-hubc', 'h', '', true);
        sp.forEach(function (o, k) {
          /* raio: da borda do hub (elipse 1.15hr × hr) até a borda da caixa do raio, na direção centro → caixa */
          var a = -Math.PI / 2 + k * 2 * Math.PI / m, x = cx2 + Math.cos(a) * rx, y = cy2 + Math.sin(a) * ry, len = Math.hypot(x - cx2, y - cy2) || 1, ux = (x - cx2) / len, uy = (y - cy2) / len;
          var t = Math.min(Math.abs(ux) > 1e-6 ? sw / 2 / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-6 ? sh / 2 / Math.abs(uy) : 1e9), s0 = 1 / Math.sqrt(Math.pow(ux / (hr * 1.15), 2) + Math.pow(uy / hr, 2));
          ln('M' + f1(cx2 + ux * s0 * 1.04) + ' ' + f1(cy2 + uy * s0 * 1.04) + 'L' + f1(x - ux * t * 1.03) + ' ' + f1(y - uy * t * 1.03), k);
          node({ t: o.t, lv: 0, i: o.i, kids: [] }, x - sw / 2, y - sh / 2, sw, sh, 'sa-spk', k, '', true);
        });
      } else if (L === 'flow') {
        /* serpentina: até 4 caixas por linha, a linha seguinte volta no sentido contrário; setas entre vizinhas; “?” = decisão (losango);
           Início/Fim = pílulas; os detalhes (Tab) ficam dentro da caixa */
        var cols = Math.min(4, n), rows = Math.ceil(n / cols), gx = w * .05, gy = h * .09, fw = (w - gx * (cols - 1)) / cols, fh = Math.min((h - gy * (rows - 1)) / rows, h * .42);
        var fy0 = (h - (fh * rows + gy * (rows - 1))) / 2, isQ = function (o) { return /^\?/.test(o.t); }, isEnd = function (o) { return /^(in[ií]cio|come[çc]o|start|fim|end|t[ée]rmino|final)\b/i.test(o.t); };
        fs = fitW(fs, fw * .82, 2.2, tt.map(function (t) { return t.replace(/^\?\s*/, ''); })); fs = fitH(fs, fh * .9, kidsN + 1);
        var pos = nodes.map(function (o, k) { var r = Math.floor(k / cols), c = k % cols; if (r % 2) c = cols - 1 - c; return { x: c * (fw + gx), y: fy0 + r * (fh + gy), r: r, c: c }; });
        nodes.forEach(function (o, k) {
          var p = pos[k], q = isQ(o), t = q ? o.t.replace(/^\?\s*/, '') : o.t, cls = q ? 'sa-dia' : isEnd(o) ? 'sa-pill sa-flowend' : 'sa-box sa-flowbox';
          node({ t: t, lv: 0, i: o.i, kids: o.kids, ep: q ? '? ' : '' }, p.x, p.y, fw, fh, cls, k, q ? ';padding:0 ' + f1(fw * .18 / fs) + 'em' : '', q);
          if (k < n - 1) {
            var nx = pos[k + 1], ax, ay, dir;
            if (nx.r === p.r) { dir = nx.c > p.c ? 1 : -1; ax = dir > 0 ? p.x + fw : p.x; ay = p.y + fh / 2; ln('M' + f1(ax) + ' ' + f1(ay) + 'H' + f1(ax + dir * gx * .62), k, 'sa-arw'); head(ax + dir * gx * .72, ay, dir > 0 ? 0 : Math.PI, gx * .3, k); }
            else { ax = p.x + fw / 2; ay = p.y + fh; ln('M' + f1(ax) + ' ' + f1(ay) + 'V' + f1(ay + gy * .62), k, 'sa-arw'); head(ax, ay + gy * .72, Math.PI / 2, gy * .3, k); }
          }
        });
      } else if (L === 'mindmap') {
        /* centro + ramos alternando direita/esquerda, empilhados por lado; sub-ramos (Tab) mais para fora; curvas da cor do ramo */
        var mmC = nodes[0] || { t: '', i: 0, lv: 0, kids: [] }, br = nodes.length > 1 ? nodes.slice(1) : mmC.kids.slice(0, def[5] - 1), MMC = ['#F78C16', '#4A6FA5', '#13406A', '#43698F', '#7EA1C3', '#002A46', '#A3B8D6']; /* só a paleta A&M (laranja e azuis), em ciclo */
        var right = br.filter(function (o, k) { return k % 2 === 0; }), left = br.filter(function (o, k) { return k % 2 === 1; });
        var cw = Math.min(w * .22, h * .5), chh = Math.min(h * .18, cw * .5), bw2 = w * .19, bh2 = h * .1, sw2 = w * .16, sh2 = h * .075, cxm = w / 2, cym = h / 2;
        fs = fitW(fs, bw2, 1.4, titles(br).concat([mmC.t])); fs = fitH(fs, bh2, 1);
        node({ t: mmC.t, lv: 0, i: mmC.i, kids: [] }, cxm - cw / 2, cym - chh / 2, cw, chh, 'sa-mm-c', 'c', '', true);
        var side = function (list, sgn) {
          /* altura de cada ramo = seu bloco (ramo + sub-ramos), distribuídos na altura toda */
          var blocks = list.map(function (o) { return Math.max(bh2, o.kids.length * (sh2 + h * .018) - h * .018); }), tot = blocks.reduce(function (a, b) { return a + b; }, 0), free = Math.max(0, h - tot), gapB = list.length > 1 ? free / (list.length + 1) : free / 2, y = gapB;
          list.forEach(function (o, j) {
            var bi = br.indexOf(o), col = MMC[bi % MMC.length], bx = sgn > 0 ? cxm + cw / 2 + w * .05 : cxm - cw / 2 - w * .05 - bw2, by = y + blocks[j] / 2 - bh2 / 2;
            var sx0 = sgn > 0 ? cxm + cw / 2 : cxm - cw / 2, ex0 = sgn > 0 ? bx : bx + bw2, midx = (sx0 + ex0) / 2;
            ln('M' + f1(sx0) + ' ' + f1(cym) + 'C' + f1(midx) + ' ' + f1(cym) + ' ' + f1(midx) + ' ' + f1(by + bh2 / 2) + ' ' + f1(ex0) + ' ' + f1(by + bh2 / 2), bi, 'sa-mm-l', ';--c:' + col);
            node({ t: o.t, lv: 0, i: o.i, kids: [] }, bx, by, bw2, bh2, 'sa-mm-b', bi, ';--c:' + col, true);
            var ky = y + (blocks[j] - (o.kids.length * (sh2 + h * .018) - h * .018)) / 2;
            o.kids.forEach(function (c2, q) {
              var kx = sgn > 0 ? bx + bw2 + w * .035 : bx - w * .035 - sw2, kyy = ky + q * (sh2 + h * .018), s1 = sgn > 0 ? bx + bw2 : bx, e1 = sgn > 0 ? kx : kx + sw2, m1 = (s1 + e1) / 2;
              ln('M' + f1(s1) + ' ' + f1(by + bh2 / 2) + 'C' + f1(m1) + ' ' + f1(by + bh2 / 2) + ' ' + f1(m1) + ' ' + f1(kyy + sh2 / 2) + ' ' + f1(e1) + ' ' + f1(kyy + sh2 / 2), bi, 'sa-mm-l sa-mm-l2', ';--c:' + col);
              node({ t: c2.t, lv: 1, i: c2.i, kids: [] }, kx, kyy, sw2, sh2, 'sa-mm-s', bi, ';--c:' + col, true);
            });
            y += blocks[j] + gapB;
          });
        };
        side(right, 1); side(left, -1);
      } else if (L === 'org') {
        var cnt = 0, roots2 = [], leaves = 0, depth = 0;
        (function take(a, out) { a.forEach(function (o) { if (cnt >= def[5]) return; var c = { t: o.t, lv: o.lv, i: o.i, kids: [] }; cnt++; out.push(c); take(o.kids, c.kids); }); })(all, roots2);
        (function cnt2(a, dd) { a.forEach(function (o) { depth = Math.max(depth, dd); if (!o.kids.length) leaves++; else cnt2(o.kids, dd + 1); }); })(roots2, 0);
        var lw = w / Math.max(1, leaves), lh = h / (depth + 1), bh = Math.min(lh * .6, h * .24), slot = 0, allT = [], pre = 0;
        (function tl(a) { a.forEach(function (o) { allT.push(o.t); o.o = pre++; tl(o.kids); }); })(roots2); /* pré-ordem: o chefe entra antes da equipe */
        fs = fitW(fs, Math.min(lw * .9, w * .26), 1.4, allT); fs = fitH(fs, bh, 1);
        (function place(a, dd, gi) {
          return a.map(function (o, k) {
            var g = dd === 0 ? k : gi, cxs, bw3 = lw * .9;
            if (!o.kids.length) cxs = (slot++ + .5) * lw;
            else {
              var xs = place(o.kids, dd + 1, dd === 0 ? k : gi); cxs = (xs[0] + xs[xs.length - 1]) / 2; bw3 = Math.min(xs[xs.length - 1] - xs[0] + lw * .9, lw * 1.2, w * .26);
              var yb = dd * lh + (lh - bh) / 2 + bh, ym = yb + (lh - bh) / 2;
              xs.forEach(function (x2) { ln('M' + f1(cxs) + ' ' + f1(yb) + 'V' + f1(ym) + 'H' + f1(x2) + 'V' + f1(ym + (lh - bh) / 2), o.o); });
            }
            node({ t: o.t, lv: dd, i: o.i, kids: [] }, Math.max(0, Math.min(w - bw3, cxs - bw3 / 2)), dd * lh + (lh - bh) / 2, bw3, bh, 'sa-org sa-d' + Math.min(dd, 2), g, '', true, o.o);
            return cxs;
          });
        })(roots2, 0, 0);
      } else if (L === 'pyramid' || L === 'funnel') {
        var pw2 = w * .5, lh2 = h / n, sx = pw2 + w * .04;
        fs = fitW(fs, w - sx, 1, tt); fs = fitH(fs, lh2 - 3, kidsN + 1);
        nodes.forEach(function (o, k) {
          var t0 = L === 'pyramid' ? k / n : 1 - k / n, t1 = L === 'pyramid' ? (k + 1) / n : 1 - (k + 1) / n, y0 = k * lh2, y1 = y0 + lh2 - 3, c = pw2 / 2;
          var col = RAMP[Math.min(5, Math.round(k * 5 / Math.max(1, n - 1)))];
          S += '<path class="sa-py" data-g="' + k + '" style="--i:' + k + '" d="M' + f1(c - c * t0) + ' ' + f1(y0) + 'H' + f1(c + c * t0) + 'L' + f1(c + c * t1) + ' ' + f1(y1) + 'H' + f1(c - c * t1) + 'Z" fill="' + col + '"/>';
          node(o, sx, y0, w - sx, lh2 - 3, 'sa-side' + (k === n - 1 ? ' sa-last' : ''), k);
        });
      } else if (L === 'venn') {
        var cs = nodes.filter(function (o) { return o.t.charAt(0) !== '='; }).slice(0, 3), mid = all.filter(function (o) { return o.t.charAt(0) === '='; })[0], m3 = Math.max(2, cs.length), r3 = Math.min(m3 === 3 ? h * .335 : h * .47, w * .2), cx3 = w / 2, cy3 = m3 === 3 ? (h - 2.9 * r3) / 2 + 1.6 * r3 : h / 2;
        fs = fitW(fs, r3 * 1.1, .6, titles(cs)); fs = Math.min(fs, r3 * .22);
        cs.forEach(function (o, k) {
          var a = m3 === 3 ? -Math.PI / 2 + k * 2 * Math.PI / 3 : Math.PI + k * Math.PI, x = cx3 + Math.cos(a) * r3 * .6, y = cy3 + Math.sin(a) * r3 * (m3 === 3 ? .6 : 0);
          S += '<circle class="sa-vc" data-g="' + k + '" style="--i:' + k + '" cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + f1(r3) + '" fill="' + SETS[k] + '"/>';
          var lx = x + Math.cos(a) * r3 * .5, ly = y + Math.sin(a) * r3 * (m3 === 3 ? .5 : 0);
          node({ t: o.t, lv: 0, i: o.i, kids: [] }, lx - r3 * .55, ly - r3 * .3, r3 * 1.1, r3 * .6, 'sa-vl sa-s' + k, k, '', true);
        });
        if (mid) node({ t: mid.t.replace(/^=\s*/, ''), ep: '= ', lv: 0, i: mid.i, kids: [] }, cx3 - r3 * .45, cy3 - r3 * .2 + (m3 === 3 ? r3 * .1 : 0), r3 * .9, r3 * .4, 'sa-vm', 'm', '', true); /* o “=” fica fora da pílula e volta ao gravar a edição no slide */
      } else if (L === 'matrix') {
        fs = fitH(fitW(fs, w / 2 - 4, 2.6, tt), h / 2 - 4, kidsN + 1);
        nodes.slice(0, 4).forEach(function (o, k) { node(o, (k % 2) * (w / 2 + 4), Math.floor(k / 2) * (h / 2 + 4), w / 2 - 4, h / 2 - 4, 'sa-q sa-q' + k, k); });
      } else if (L === 'target') {
        /* o alvo ocupa a coluna da esquerda (1,1h, mas nunca mais de 55 % da largura): numa caixa estreita ou quadrada ele encolhe e os rótulos ficam dentro */
        var lx4 = Math.min(h * 1.1, w * .55), cx4 = lx4 / 2.2, R4 = Math.min(h * .48, lx4 * .436), st4 = R4 / n, m4 = Math.min(w, h) * .02;
        fs = fitW(fs, w - lx4, 1, tt); fs = fitH(fs, h / n * .9, kidsN + 1);
        for (k = n - 1; k >= 0; k--) S += '<circle class="sa-tc" data-g="' + k + '" style="--i:' + k + '" cx="' + f1(cx4) + '" cy="' + f1(h / 2) + '" r="' + f1(st4 * (k + 1)) + '" fill="' + RINGS[Math.min(5, k)] + '"/>';
        nodes.forEach(function (o, k) {
          var yy = h * (k + .5) / n, rx4 = cx4 + st4 * (k + .5);
          ln('M' + f1(rx4) + ' ' + f1(h / 2) + 'L' + f1(rx4 + st4 * .3) + ' ' + f1(yy) + 'H' + f1(lx4 - m4), k, 'sa-lead');
          node(o, lx4, yy - h / n * .45, w - lx4, h / n * .9, 'sa-side' + (k === n - 1 ? ' sa-last' : ''), k);
        });
      } else if (L === 'blocks') {
        var rh = h / n, hw = w * .28; fs = fitW(fs, hw, 2.2, tt); fs = fitH(fs, rh - 4, Math.max(1, kidsN));
        nodes.forEach(function (o, k) {
          node(o, 0, k * rh, hw, rh - 4, 'sa-bk' + (k === 0 ? ' sa-first' : ''), k, '', true);
          N += '<div class="sa-bt" data-g="' + k + '" style="' + box(hw + w * .01, k * rh, w - hw - w * .01, rh - 4) + ';--i:' + (ord++) + '">' + li(o.kids) + '</div>';
        });
      }
      if (d.panel === 'white') fs *= .9; /* dentro do painel branco o conteúdo fica a 90 %, mas a fonte (cqw) não encolhe */
      if (!items.length) N += '<div class="sa-empty"><b>SmartArt · ' + esc(def[1]) + '</b><span>Escreva os itens no painel à direita: um por linha, Tab = nível abaixo.</span></div>'; /* só no editor (.am-edit) */
      return '<div class="fx fxsa sal-' + L + ' fxv-' + v + '"' + (v === 'focus' ? ' data-cycle="g"' : '') + ' style="font-size:' + CQ(fs) + '"><svg viewBox="0 0 ' + f1(w) + ' ' + f1(h) + '" preserveAspectRatio="none">' + S + '</svg>' + N + '</div>';
    }
  };
  R.SMART_LAYOUTS = LAYOUTS; R.smartFind = find; R.smartParse = parse; R.smartText = text; R.smartIcon = icon; R.smartSample = sample;
})(window.AMRT);
