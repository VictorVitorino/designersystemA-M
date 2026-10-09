(function () {
  'use strict';
  var RT = window.AMRT, W = RT.W, H = RT.H;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var BRAND = { perfW: '%%LOGO_PERF_W%%', perfN: '%%LOGO_PERF_N%%', wmW: '%%WM_W%%', wmN: '%%WM_N%%' };
  var BRAND_SIZE = { perfW: [743, 134], perfN: [743, 134], wmW: [262, 42], wmN: [262, 42] };
  /* paleta A&M: navy, azuis-aço, gelos, branco e um único laranja */
  var SW = ['#002A46', '#001E32', '#13315C', '#43698F', '#4A6FA5', '#7EA1C3', '#A3B8D6', '#E3EAF2', '#EBEEF1', '#FFFFFF', '#F78C16', '#3E4C5E', '#6B7A90'];
  /* S29: kit de marca da apresentação (deck.brand = {name, colors: [#RRGGBB…], pal: {p, a}, font}). As cores do kit vêm primeiro nas
     amostras e em “Mais cores…” (seção “Cores da marca”); a fonte vale para os textos e formas novos; pal (cores dos componentes) vale
     para os componentes novos; “aplicar a todos” é uma ação explícita (um passo de desfazer). Fontes do Google fora das quatro do
     Canteiro entram por <link> sob demanda (ensureFonts) e no arquivo salvo (fontLink); as do computador (Arial, Calibri…) não
     precisam de nada. A caixa “Kit de marca” fica em ed-43-brand.js (só no editor). */
  var GFONTS = { 'Montserrat': 'Montserrat:wght@300;400;500;600;700', 'Open Sans': 'Open+Sans:wght@300;400;500;600;700', 'Lato': 'Lato:wght@300;400;700', 'Poppins': 'Poppins:wght@300;400;500;600;700', 'Source Sans 3': 'Source+Sans+3:wght@300;400;500;600;700', 'Nunito Sans': 'Nunito+Sans:wght@300;400;500;600;700', 'Raleway': 'Raleway:wght@300;400;500;600;700', 'Work Sans': 'Work+Sans:wght@300;400;500;600;700', 'Oswald': 'Oswald:wght@300;400;500;600;700', 'PT Sans': 'PT+Sans:wght@400;700', 'Merriweather': 'Merriweather:wght@300;400;700', 'Playfair Display': 'Playfair+Display:wght@400;500;600;700' };
  var SYS_FONTS = ['Arial', 'Calibri', 'Segoe UI', 'Verdana', 'Georgia', 'Times New Roman'];
  var GF_BASE = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Roboto:wght@300;400;500;700&family=Roboto+Condensed:wght@400;700';
  function brand() { return deck && deck.brand ? deck.brand : null; }
  function brandCols() { var b = brand(); return b && Array.isArray(b.colors) ? b.colors : []; }
  function swList() { var bc = brandCols(); return bc.map(function (c) { return [c, 'Marca']; }).concat(SW.filter(function (c) { return bc.indexOf(c) < 0; }).map(function (c) { return [c, c]; })); }
  function kitOpt() { var b = brand(), bc = brandCols(); return bc.length ? { title: 'Cores da marca' + (b.name ? ' · ' + b.name : ''), colors: bc } : null; }
  /* o kit vale para o que o usuário insere na obra aberta (addEl, addSlide, blocos, texto no clique): mk* continuam puros, porque também
     montam modelos, prévias e outras obras (capa, Minhas obras) enquanto esta está aberta. kitSlide: aplica e regrava a base (Redefinir) */
  function kitify(el) { var b = brand(); if (!b || !el) return el; if (b.font && (el.type === 'text' || el.type === 'shape')) el.font = b.font; if (b.pal && palOk(el)) el.pal = clone(b.pal); return el; }
  function kitSlide(s) { if (brand() && s && s.els && !(LAYOUTS[s.layout] && LAYOUTS[s.layout].inst)) { s.els.forEach(kitify); stampSlide(s); } return s; } /* slides institucionais (S34) ficam no padrão oficial, sem o kit */
  /* fontes que um JSON (obra, slides, elementos) usa: textos, formas, componentes com campo de fonte e a do kit */
  function fontsIn(s) { var out = {}, re = /"font":"([^"\\]{1,40})"/g, m; while ((m = re.exec(s))) out[m[1]] = 1; return Object.keys(out); }
  function deckFonts(d) { return fontsIn(JSON.stringify(d || deck)); }
  function fontLink(d, json) { var ex = fontsIn(json || JSON.stringify(d || deck)).filter(function (f) { return GFONTS[f]; }); return GF_BASE + ex.map(function (f) { return '&family=' + GFONTS[f]; }).join('') + '&display=swap'; } /* json: o JSON já gerado da obra (exportHTML), para não serializar duas vezes */
  function ensureFonts(list) {
    (list || deckFonts()).forEach(function (f) {
      if (!GFONTS[f] || document.querySelector('link[data-gf="' + f + '"]')) return;
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.gf = f; l.href = 'https://fonts.googleapis.com/css2?family=' + GFONTS[f] + '&display=swap'; document.head.appendChild(l);
    });
  }
  var esc = RT.esc;
  function uid() { return 'e' + Math.random().toString(36).slice(2, 9); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isDark(c) {
    var m = String(c || '#fff').match(/^#?([0-9a-f]{6})$/i); if (!m) return false;
    var n = parseInt(m[1], 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 140;
  }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2400); }

  /* ---------------- modelo ---------------- */
  var TEXT = {
    title: { w: 760, h: 110, html: 'Título', font: 'Roboto', size: 44, weight: 300, lh: 1.1 },
    subtitle: { w: 700, h: 36, html: 'Subtítulo em destaque', font: 'Roboto Condensed', size: 22, weight: 700, lh: 1.2 },
    body: { w: 560, h: 110, html: 'Escreva aqui o seu texto.', font: 'Inter', size: 18, weight: 400, lh: 1.45 },
    bullets: { w: 560, h: 130, html: '• Primeiro ponto<br>• Segundo ponto<br>• Terceiro ponto', font: 'Inter', size: 18, weight: 400, lh: 1.6 },
    eyebrow: { w: 520, h: 22, html: 'RÓTULO · SEÇÃO', font: 'JetBrains Mono', size: 13, weight: 500, ls: .16, color: '#7EA1C3', lh: 1.2 },
    number: { w: 120, h: 116, html: '1', font: 'Roboto', size: 96, weight: 300, color: '#7EA1C3', lh: 1 }
  };
  function mkText(kind, over, dark) {
    var t = TEXT[kind];
    var e = Object.assign({ id: uid(), type: 'text', x: Math.round((W - t.w) / 2), y: Math.round((H - t.h) / 2), align: 'left', anim: { in: 'none' } }, clone(t));
    /* subtítulo: laranja só sobre fundo escuro (no branco, laranja em texto não tem contraste) */
    if (!t.color) e.color = kind === 'subtitle' ? (dark ? '#F78C16' : '#002A46') : dark ? (kind === 'body' || kind === 'bullets' ? '#DCE5F0' : '#FFFFFF') : (kind === 'body' || kind === 'bullets' ? '#3E4C5E' : '#002A46');
    return Object.assign(e, over || {});
  }
  /* tamanho inicial por forma (quadradas 200×200; setas 280×140; o resto 300×140). Colchetes e chaves: só traço, cor no contorno.
     Anel: o texto fica no furo, sobre o fundo do slide, então leva a cor de texto do slide (navy no claro, branco no escuro).
     No slide escuro o preenchimento padrão é aço (#43698F): o azul profundo quase sumia no azul-marinho */
  var SQ_SHAPES = ['ellipse', 'diamond', 'triangle', 'octagon', 'star', 'plus', 'ring'], SHAPE_SZ = { chevron: [280, 140], arrow: [280, 140], para: [280, 140], pentagon: [280, 140], darrow: [280, 140], notch: [280, 140], callout: [300, 160], cylinder: [160, 200], brackets: [300, 160], braces: [300, 160] };
  function isBrace(s) { return s === 'brackets' || s === 'braces'; }
  function mkShape(shape, dark) {
    var z = SQ_SHAPES.indexOf(shape) >= 0 ? [200, 200] : SHAPE_SZ[shape] || [300, 140], w = z[0], h = z[1], br = isBrace(shape);
    return { id: uid(), type: 'shape', shape: shape, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: w, h: h, fill: br ? 'none' : shape === 'chevron' || shape === 'arrow' ? '#F78C16' : (dark ? '#43698F' : '#002A46'), stroke: br ? (dark ? '#FFFFFF' : '#002A46') : '#7EA1C3', strokeW: br ? 3 : 0, radius: 14, html: '', font: 'Inter', size: 20, weight: 600, color: (br || shape === 'ring') && !dark ? '#002A46' : '#FFFFFF', align: 'center', valign: 'middle', anim: { in: 'none' } };
  }
  /* card pronto (Formas › Retângulos e cards): arredondado 320×180 com o estilo escolhido e o texto já legível sobre ele */
  function mkCard(look, dark) {
    var c = mkShape('round', dark); c.w = 320; c.h = 180; c.x = Math.round((W - c.w) / 2); c.y = Math.round((H - c.h) / 2);
    if (dark) c.fill = '#13315C'; /* card no escuro: azul profundo, tom sobre tom (o estilo dá o contraste) */
    else if (look === 'accent' || look === 'topbar') c.fill = '#EEF2F7';
    if (look === 'gradient' && dark) { c.strokeW = 1.5; c.stroke = '#4A6FA5'; }
    applyLook(c, look); return c;
  }
  /* estilo de card (el.look): ajusta só o necessário para o texto continuar legível (claro sobre escuro, navy sobre claro) */
  var LIGHT_LOOK = { outline: 1, lift: 1, ice: 1 }, LOOK_FILL = { outline: 1, lift: 1, ice: 1, gradient: 1 }; /* LOOK_FILL: o estilo define o preenchimento (as amostras não teriam efeito) */
  function lumOf(c) { var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || ''); if (!m) return null; var x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1], n = parseInt(x, 16); return (.299 * (n >> 16) + .587 * (n >> 8 & 255) + .114 * (n & 255)) / 255; }
  function darkC(c) { var l = lumOf(c); return l != null && l < .55; }
  function applyLook(el, k) {
    var was = el.look; if (k === 'flat') delete el.look; else el.look = k;
    if (was === 'header' && k !== 'header' && el.valign === 'top') el.valign = 'middle';
    if (k === 'header') { if (darkC(el.fill) || !el.fill || el.fill === 'none') el.fill = '#FFFFFF'; if (!+el.strokeW) { el.strokeW = 1.5; el.stroke = '#DCE5F0'; } el.valign = 'top'; }
    var bg = k === 'gradient' || k === 'header' ? true : LIGHT_LOOK[k] ? false : el.fill && el.fill !== 'none' ? darkC(el.fill) : null, tl = lumOf(el.color || '#002A46');
    if (bg === true && tl != null && tl < .55) el.color = '#FFFFFF';
    else if (bg === false && tl != null && tl >= .55) el.color = '#002A46';
  }
  function mkLine(arrow, dark) { return { id: uid(), type: 'line', x1: 440, y1: 380, x2: 840, y2: 300, stroke: dark ? '#FFFFFF' : '#002A46', strokeW: 3, headEnd: !!arrow, headStart: false, dash: false, anim: { in: 'none' } }; }
  /* galeria “Linhas e setas” (▾ da Seta e Inserir › Linhas e setas): [chave, rótulo, campos, título do grupo, posição no slide, pede rt-10] */
  var LINE_PRESETS = [['line', 'Linha', {}, 'Linhas e setas'], ['arrow', 'Seta', { headEnd: true }], ['double', 'Seta dupla', { headStart: true, headEnd: true }],
    ['elbow', 'Conector em cotovelo', { curve: 'elbow', headEnd: true }, 'Conectores', { y1: 420 }, 1], ['curve', 'Conector curvo', { curve: 'curve', headEnd: true }, '', { y1: 420 }, 1],
    ['dashed', 'Linha tracejada', { dash: true }, 'Estilos', { y2: 380 }], ['dotball', 'Pontilhada com bola', { dash: true, dashS: 'dot', headS: 'dot', headStart: true }, '', { y2: 380 }, 1],
    ['dim', 'Cota / medida', { headS: 'bar', headE: 'bar', headStart: true, headEnd: true }, '', { y2: 380 }, 1]].filter(function (p) { return !p[5] || RT.LINE_ROUTES; });
  function mkLinePreset(k, dark) { var p = LINE_PRESETS.find(function (x) { return x[0] === k; }) || LINE_PRESETS[0]; return Object.assign(mkLine(false, dark), clone(p[2]), p[4] || {}); }
  function mkImage(src, nw, nh, over) {
    if (!(nw > 0) || !(nh > 0)) { nw = 520; nh = 360; }
    var k = Math.min(520 / nw, 360 / nh, 1.5), w = Math.max(8, Math.round(nw * k)), h = Math.max(8, Math.round(nh * k));
    return Object.assign({ id: uid(), type: 'image', src: src, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: w, h: h, fit: 'cover', radius: 0, anim: { in: 'none' } }, over || {});
  }
  function mkBrand(key, over) { var s = BRAND_SIZE[key], h = key.indexOf('perf') === 0 ? 52 : 22; return mkImage(BRAND[key], s[0], s[1], Object.assign({ w: Math.round(s[0] / s[1] * h), h: h, fit: 'contain', x: 54, y: 40 }, over || {})); }
  function mkFx(kind, over, dark) {
    var d = RT.FX[kind];
    var e = { id: uid(), type: 'fx', kind: kind, x: Math.round((W - d.w) / 2), y: Math.round((H - d.h) / 2), w: d.w, h: d.h, data: clone(d.data), anim: Object.assign({ in: 'none', delay: 0, dur: 700, loop: 'none', hover: 'none' }, clone(d.anim || {})) };
    if (dark) {
      if ('tcolor' in e.data) e.data.tcolor = '#FFFFFF';
      if (kind === 'headline') e.data.color = '#FFFFFF';
      if (kind === 'bars' || kind === 'progress') e.data.style = e.data.style === 'clear' ? 'clear' : e.data.style;
      if (kind === 'icon' || kind === 'iconmorph') e.data.color = '#FFFFFF'; /* ícones em slide escuro: traço branco, detalhe laranja */
    }
    if (kind === 'bars' && dark) e.data.style = 'dark';
    return Object.assign(e, over || {});
  }
  var LAYOUTS = {
    'blank-light': { name: 'Em branco (claro)', bg: '#FFFFFF', els: function () { return []; } },
    'blank-dark': { name: 'Em branco (navy)', bg: '#002A46', els: function () { return []; } },
    cover: { name: 'Capa A&M', bg: '#002A46', els: function () {
      return [mkBrand('perfW', { x: 54, y: 44 }), mkFx('amlines', { x: 700, y: 0, w: 580, h: 720 }),
        mkText('title', { x: 54, y: 360, w: 640, h: 150, html: 'Título da<br>apresentação', size: 54, color: '#FFFFFF', anim: { in: 'rise', delay: 300, dur: 900 } }),
        mkText('body', { x: 54, y: 640, w: 400, h: 30, html: 'Outubro de 2026', font: 'Roboto', size: 16, color: '#FFFFFF', anim: { in: 'fade', delay: 900 } })];
    } },
    content: { name: 'Título e conteúdo', bg: '#FFFFFF', els: function () {
      return [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'TEMA · SEÇÃO', color: '#4A6FA5' }), mkBrand('wmN', { x: 1098, y: 30, w: 128, h: 21 }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 90, html: 'Mensagem principal do slide em uma frase clara e objetiva', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } }),
        mkText('body', { x: 54, y: 156, w: 1170, h: 56, html: 'Subtítulo com o contexto que ajuda a ler o slide.', font: 'Roboto', size: 18, color: '#43698F', anim: { in: 'fade', delay: 150 } }),
        mkText('bullets', { x: 54, y: 250, w: 560, h: 200, color: '#3E4C5E', anim: { in: 'rise', delay: 300 } })];
    } },
    section: { name: 'Divisor de capítulo', bg: '#002A46', els: function () {
      return [mkText('number', { x: 54, y: 292, w: 120, h: 116, html: '1', color: '#7EA1C3', anim: { in: 'fade' } }),
        mkText('title', { x: 176, y: 312, w: 900, h: 80, html: 'Nome do capítulo', size: 46, color: '#FFFFFF', anim: { in: 'left', delay: 200 } }),
        mkFx('amlines', { x: 860, y: 260, w: 420, h: 460 })];
    } },
    kpis: { name: 'Indicadores', bg: '#FFFFFF', els: function () {
      return [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'RESULTADOS', color: '#4A6FA5' }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 60, html: 'Resultados que comprovam a transformação', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } }),
        mkFx('counter', { x: 54, y: 200, w: 370, h: 220, anim: { in: 'rise', delay: 200, dur: 700, loop: 'none', hover: 'lift' } }),
        mkFx('counter', { x: 455, y: 200, w: 370, h: 220, data: { label: 'Iniciativas concluídas', value: 127, decimals: 0, prefix: '', suffix: '', sub: '+31 no trimestre', bar: 58, style: 'light' }, anim: { in: 'rise', delay: 350, dur: 700, loop: 'none', hover: 'lift' } }),
        mkFx('counter', { x: 856, y: 200, w: 370, h: 220, data: { label: 'Adoção pelas áreas', value: 68, decimals: 0, prefix: '', suffix: '%', sub: 'meta de 75%', bar: 68, style: 'light' }, anim: { in: 'rise', delay: 500, dur: 700, loop: 'none', hover: 'lift' } }),
        mkFx('quote', { x: 54, y: 480, w: 1172, h: 80, data: { text: 'Mensagem-chave do slide: o que o comitê precisa decidir a partir destes números.', style: 'ice' }, anim: { in: 'wipe', delay: 900, dur: 900, loop: 'none', hover: 'none' } })];
    } },
    /* S28: layouts prontos e editáveis (agenda, resumo executivo, painel, roadmap, comparativo, próximos passos) — mesmos componentes do Canteiro */
    agenda: { name: 'Agenda', bg: '#FFFFFF', els: function () {
      var els = [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'AGENDA', color: '#4A6FA5' }), mkBrand('wmN', { x: 1098, y: 30, w: 128, h: 21 }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 60, html: 'O que vamos ver hoje', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } })];
      [['Contexto e objetivos', 'Por que estamos aqui e o que queremos decidir', '10 min'], ['Diagnóstico', 'O que os dados e as entrevistas mostram', '20 min'], ['Recomendações', 'Caminhos possíveis e a proposta', '20 min'], ['Próximos passos', 'Decisões, responsáveis e prazos', '10 min']].forEach(function (it, i) {
        var y = 170 + i * 110, d = 200 + i * 120;
        els.push(mkText('number', { x: 54, y: y, w: 90, h: 50, html: '0' + (i + 1), size: 44, lh: 1, color: i === 0 ? '#F78C16' : '#7EA1C3', anim: { in: 'fade', delay: d } }));
        els.push(mkText('body', { x: 160, y: y + 2, w: 820, h: 32, html: it[0], font: 'Roboto', size: 24, color: '#002A46', lh: 1.2, anim: { in: 'fade', delay: d } }));
        els.push(mkText('body', { x: 160, y: y + 40, w: 820, h: 26, html: it[1], font: 'Inter', size: 15, color: '#6B7A90', lh: 1.3, anim: { in: 'fade', delay: d + 60 } }));
        els.push(mkText('eyebrow', { x: 1006, y: y + 12, w: 220, h: 22, html: it[2], align: 'right', size: 14, ls: .06, color: '#43698F', anim: { in: 'fade', delay: d + 60 } }));
        if (i < 3) els.push(Object.assign(mkLine(false, false), { x1: 54, y1: y + 92, x2: 1226, y2: y + 92, stroke: '#DCE3EC', strokeW: 1, anim: { in: 'none' } }));
      });
      return els;
    } },
    exec: { name: 'Resumo executivo', bg: '#FFFFFF', els: function () {
      return [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'RESUMO EXECUTIVO', color: '#4A6FA5' }), mkBrand('wmN', { x: 1098, y: 30, w: 128, h: 21 }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 90, html: 'A mensagem principal em uma frase: o que recomendamos e por quê', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } }),
        mkFx('cardgrid', { x: 54, y: 180, w: 1172, h: 300, data: { cards: [{ tag: '01', t: 'Situação', x: 'Onde estamos e o que mudou no contexto.' }, { tag: '02', t: 'Complicação', x: 'O que impede o resultado hoje.' }, { tag: '03', t: 'Resposta', x: 'A proposta e o que ela entrega.' }], style: 'light' }, anim: { in: 'rise', delay: 200, dur: 700, loop: 'none', hover: 'lift' } }),
        mkFx('quote', { x: 54, y: 520, w: 1172, h: 80, data: { text: 'Decisão pedida ao comitê: aprovar a onda 1 e nomear os responsáveis.', style: 'ice' }, anim: { in: 'wipe', delay: 800, dur: 900, loop: 'none', hover: 'none' } })];
    } },
    dashboard: { name: 'Painel de indicadores', bg: '#FFFFFF', els: function () {
      var K = [['Receita', 128, 'R$ ', ' mi', '+12% vs. plano', 72], ['Margem EBITDA', 23.4, '', '%', 'meta 25%', 60], ['NPS', 62, '', '', '+8 pontos', 62], ['Entregas no prazo', 91, '', '%', '34 de 37', 91]];
      return [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'PAINEL EXECUTIVO', color: '#4A6FA5' }), mkBrand('wmN', { x: 1098, y: 30, w: 128, h: 21 }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 60, html: 'Indicadores do mês em um só painel', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } })].concat(K.map(function (k, i) {
          return mkFx('counter', { x: 54 + i * 298, y: 140, w: 280, h: 150, data: { label: k[0], value: k[1], decimals: k[1] % 1 ? 1 : 0, prefix: k[2], suffix: k[3], sub: k[4], bar: k[5], style: 'light' }, anim: { in: 'rise', delay: 150 + i * 120, dur: 700, loop: 'none', hover: 'lift' } });
        }), [mkFx('columns', { x: 54, y: 320, w: 700, h: 330, anim: { in: 'rise', delay: 600, dur: 700, loop: 'none', hover: 'none' } }), mkFx('bullet', { x: 790, y: 320, w: 436, h: 330, anim: { in: 'rise', delay: 750, dur: 700, loop: 'none', hover: 'none' } })]);
    } },
    roadmap: { name: 'Roadmap', bg: '#FFFFFF', els: function () {
      return [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'ROADMAP', color: '#4A6FA5' }), mkBrand('wmN', { x: 1098, y: 30, w: 128, h: 21 }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 60, html: 'Três ondas até o modelo-alvo', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } }),
        mkText('body', { x: 54, y: 120, w: 1170, h: 28, html: 'Cada onda entrega valor por si; as frentes andam em paralelo com um comitê mensal.', font: 'Roboto', size: 18, color: '#43698F', lh: 1.3, anim: { in: 'fade', delay: 150 } }),
        mkFx('roadmap', { x: 54, y: 170, w: 1172, h: 440, anim: { in: 'rise', delay: 300, dur: 700, loop: 'none', hover: 'none' } }),
        mkText('body', { x: 54, y: 640, w: 1000, h: 24, html: 'Marcos em laranja = decisões do comitê · Edite as ondas, frentes e itens no painel à direita.', font: 'Inter', size: 12, color: '#6B7A90', lh: 1.3 })];
    } },
    compare: { name: 'Comparativo', bg: '#FFFFFF', els: function () {
      return [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'OPÇÕES', color: '#4A6FA5' }), mkBrand('wmN', { x: 1098, y: 30, w: 128, h: 21 }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 60, html: 'Duas opções lado a lado', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } }),
        mkFx('card', { x: 54, y: 160, w: 560, h: 400, data: { tag: 'OPÇÃO A', title: 'Manter o modelo atual', text: 'Menor esforço e risco de mudança; mantém os gargalos de hoje e adia o ganho de escala.', style: 'light' }, anim: { in: 'left', delay: 200, dur: 700, loop: 'none', hover: 'lift' } }),
        mkFx('card', { x: 666, y: 160, w: 560, h: 400, data: { tag: 'OPÇÃO B · RECOMENDADA', title: 'Nova estrutura em ondas', text: 'Investimento concentrado na onda 1, ganhos a partir do 2º semestre e governança única desde o início.', style: 'dark' }, anim: { in: 'right', delay: 350, dur: 700, loop: 'none', hover: 'lift' } }),
        mkFx('quote', { x: 54, y: 590, w: 1172, h: 80, data: { text: 'Recomendação: Opção B, com a onda 1 iniciada ainda neste trimestre.', style: 'ice' }, anim: { in: 'wipe', delay: 800, dur: 900, loop: 'none', hover: 'none' } })];
    } },
    next: { name: 'Próximos passos', bg: '#FFFFFF', els: function () {
      var els = [mkText('eyebrow', { x: 54, y: 30, w: 760, h: 22, html: 'PRÓXIMOS PASSOS', color: '#4A6FA5' }), mkBrand('wmN', { x: 1098, y: 30, w: 128, h: 21 }),
        mkText('title', { x: 54, y: 60, w: 1170, h: 60, html: 'O que acontece a partir de hoje', size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } }),
        mkFx('timeline', { x: 54, y: 150, w: 1172, h: 210, data: { items: 'Semana 1 | Validar o plano\nSemana 2 | Nomear os responsáveis\nMês 1 | Iniciar a onda 1\nMês 3 | Primeira revisão', current: 0, style: 'clear', tcolor: '#002A46' }, anim: { in: 'draw', delay: 200, dur: 900, loop: 'none', hover: 'none' } })];
      [['Validar o plano com a diretoria', 'Patrocinador', 'até sexta'], ['Nomear os líderes de cada frente', 'PMO', '2 semanas'], ['Abrir a onda 1 com o kickoff', 'Equipe A&M', 'mês 1']].forEach(function (r, i) {
        var y = 400 + i * 80, d = 500 + i * 150;
        els.push(Object.assign(mkShape('round', false), { x: 54, y: y, w: 1172, h: 64, fill: i === 0 ? '#EEF2F7' : '#FFFFFF', stroke: '#DCE5F0', strokeW: 1.5, radius: 12, html: '', anim: { in: 'rise', delay: d, dur: 600 } }));
        els.push(mkText('number', { x: 74, y: y + 10, w: 60, h: 44, html: String(i + 1), size: 36, lh: 1.2, color: '#F78C16', anim: { in: 'fade', delay: d + 100 } }));
        els.push(mkText('body', { x: 140, y: y + 18, w: 700, h: 30, html: r[0], font: 'Roboto', size: 21, color: '#002A46', lh: 1.2, anim: { in: 'fade', delay: d + 100 } }));
        els.push(mkText('eyebrow', { x: 860, y: y + 22, w: 200, h: 22, html: r[1], size: 13, ls: .06, color: '#43698F', anim: { in: 'fade', delay: d + 150 } }));
        els.push(mkText('eyebrow', { x: 1060, y: y + 22, w: 146, h: 22, html: r[2], align: 'right', size: 13, ls: .06, color: '#F78C16', anim: { in: 'fade', delay: d + 150 } }));
      });
      return els;
    } },
    closing: { name: 'Encerramento', bg: '#002A46', els: function () {
      return [mkBrand('perfW', { x: 54, y: 44 }), mkFx('amlines', { x: 700, y: 0, w: 580, h: 720 }),
        mkFx('headline', { x: 54, y: 300, w: 760, h: 110, data: { text: 'Obrigado.', hl: '', size: 72, color: '#FFFFFF', font: 'Roboto', weight: 300 } }),
        mkText('body', { x: 54, y: 430, w: 600, h: 60, html: 'Nome do responsável · email@alvarezandmarsal.com', font: 'Roboto', size: 18, color: '#A3B8D6', anim: { in: 'fade', delay: 600 } })];
    } }
  };
  function mkSlide(layout) {
    if (!LAYOUTS.hasOwnProperty(layout)) layout = 'blank-light';
    var L = LAYOUTS[layout], o = { id: uid(), bg: L.bg, tr: 'fade', layout: layout, els: L.els() }; if (layout === 'section') o.kind = 'section';
    if (L.bgImg) { o.bgImg = L.bgImg; o.bgImgOp = L.bgImgOp == null ? 1 : L.bgImgOp; } /* S34: layout com imagem de fundo (slides institucionais) */
    return stampSlide(o); /* S21: posições e formatos originais para “Redefinir slide” */
  }
  /* ---------- Redefinir slide (S21) ----------
     Cada elemento original do slide ganha el.ph ('p0', 'p1'… = ordem em que o layout o criou) e o slide guarda
     slide.base = {bg, bgImgOp?, els: {ph: posição, tamanho, giro, espelho e formato}} — nunca o conteúdo (texto, imagem, dados).
     “Redefinir slide” devolve esses campos (os que não existiam somem: giro, espelho, cores do componente), mantém o que foi escrito,
     não mexe nos elementos que o usuário acrescentou e recria, a partir do layout (slide.layout), os originais que foram apagados. */
  var SNAP_GEO = ['x', 'y', 'w', 'h', 'rot', 'flipH', 'flipV', 'opacity', 'radius'],
    SNAP_TXT = ['font', 'size', 'weight', 'color', 'align', 'valign', 'lh', 'ls', 'bg', 'italic', 'upper', 'fill', 'stroke', 'strokeW', 'dash', 'shadow', 'look', 'shape'],
    SNAP_K = { text: SNAP_GEO.concat(SNAP_TXT), shape: SNAP_GEO.concat(SNAP_TXT), image: SNAP_GEO.concat(['fit', 'shadow']), fx: SNAP_GEO.concat(['variant', 'pal']),
      line: ['x1', 'y1', 'x2', 'y2', 'bend', 'curve', 'stroke', 'strokeW', 'dash', 'headS', 'headE', 'headStart', 'headEnd', 'dashS', 'a1', 'a2'] },
    SNAP_B = { flipH: 1, flipV: 1, italic: 1, upper: 1, dash: 1, shadow: 1, headStart: 1, headEnd: 1 }, /* booleanos: só true é guardado */
    SNAP_REQ = { x: 1, y: 1, w: 1, h: 1, x1: 1, y1: 1, x2: 1, y2: 1 }, PH_MAX = 200, PH_RE = /^p\d{1,3}$/;
  /* fontes do painel; uma fonte importada (PowerPoint/PDF) que não é do Canteiro aparece como opção extra, para não sumir do seletor */
  var FONT_OPTS = [['Roboto', 'Roboto (A&M)'], ['Roboto Condensed', 'Roboto Condensed'], ['Inter', 'Inter'], ['JetBrains Mono', 'JetBrains Mono']];
  /* S29: Canteiro + fonte do kit (primeiro, quando não é das quatro) + Google (carregadas sob demanda) + do computador + a importada */
  function fontOpts(cur, plain) {
    var b = brand(), out = FONT_OPTS.slice(), seen = {}; out.forEach(function (o) { seen[o[0]] = 1; });
    if (!plain && b && b.font && !seen[b.font]) { out.unshift([b.font, b.font + ' (kit de marca)']); seen[b.font] = 1; }
    Object.keys(GFONTS).forEach(function (f) { if (!seen[f]) { out.push([f, f + ' (Google)']); seen[f] = 1; } });
    SYS_FONTS.forEach(function (f) { if (!seen[f]) { out.push([f, f + ' (do computador)']); seen[f] = 1; } });
    if (typeof cur === 'string' && cur && !seen[cur]) out.push([cur, cur + ' (do arquivo importado)']);
    return out;
  }
  var cropOpen = null; /* S27b: id da foto com os controles de recorte abertos (sem recorte ainda) */
  function fxStyleField(kind) { var F = RT.FX.hasOwnProperty(kind) ? RT.FX[kind] : null; return !!(F && Array.isArray(F.fields) && F.fields.some(function (f) { return f && f[0] === 'style'; })); }
  /* campos de escolha fechada do componente (sel:…, smartlayout): formato que “Redefinir” devolve — fonte/cor do título de impacto, cores das
     Linhas A&M, tipo do velocímetro, legenda da RACI… (os campos de texto e números ficam como estão: são conteúdo) */
  function fxSelFields(kind) { var F = RT.FX.hasOwnProperty(kind) ? RT.FX[kind] : null; return F && Array.isArray(F.fields) ? F.fields.filter(function (f) { return f && typeof f[0] === 'string' && typeof f[2] === 'string' && (f[2].indexOf('sel') === 0 || f[2] === 'smartlayout'); }).map(function (f) { return f[0]; }) : []; }
  function snapOf(e) {
    var o = { t: e.type === 'fx' ? 'fx:' + e.kind : e.type };
    (SNAP_K[e.type] || []).forEach(function (k) {
      var v = e[k]; if (v == null) return;
      if (SNAP_B[k]) { if (v === true) o[k] = true; } else if (k === 'pal' || k === 'a1' || k === 'a2') { if (v && typeof v === 'object') o[k] = clone(v); } else o[k] = v;
    });
    if (e.type === 'fx' && e.data) {
      if (Array.isArray(e.data.colors) && e.data.colors.length) o.cols = e.data.colors.slice(); if (e.data.style != null && fxStyleField(e.kind)) o.ds = e.data.style;
      var ds = {}; fxSelFields(e.kind).forEach(function (k) { var v = e.data[k]; if ((typeof v === 'string' && (TOKEN_RE.test(v) || COLOR_RE.test(v))) || (typeof v === 'number' && isFinite(v))) ds[k] = v; }); o.dsel = ds; /* sempre presente (mesmo vazio): campo ausente = valor padrão, e “Redefinir” apaga o que foi escolhido depois */
    }
    return o;
  }
  /* cópia do elemento para “Redefinir” trazer de volta um original apagado num slide sem layout (modelo pronto, arquivo aberto);
     fotos não entram (dobrariam o arquivo): essas só voltam com Ctrl+Z */
  function tplOf(e) { if (!e || e.type === 'image') return null; var c = clone(e); delete c.ph; return c; }
  function stampSlide(s) {
    var b = { bg: s.bg || '#FFFFFF', els: {} }, L = typeof s.layout === 'string' && LAYOUTS.hasOwnProperty(s.layout), tpl = {}, nt = 0;
    if (s.bgImg && s.bgImgOp != null) b.bgImgOp = s.bgImgOp;
    (s.els || []).forEach(function (e, i) { if (i < PH_MAX) { e.ph = 'p' + i; b.els[e.ph] = snapOf(e); if (!L) { var t = tplOf(e); if (t) { tpl[e.ph] = t; nt++; } } } else delete e.ph; });
    if (nt) b.tpl = tpl;
    s.base = b; return s;
  }
  function applySnap(e, sn) {
    (SNAP_K[e.type] || []).forEach(function (k) {
      if (sn[k] == null) { if (!SNAP_REQ[k]) delete e[k]; } /* sem x/y/w/h na base (arquivo editado à mão): a medida atual fica */
      else if (k === 'variant' && !(e.type === 'fx' && RT.FX[e.kind] && RT.FX[e.kind].variants && RT.FX[e.kind].variants.some(function (x) { return x[0] === sn[k]; }))) delete e[k];
      else e[k] = (k === 'pal' || k === 'a1' || k === 'a2') ? clone(sn[k]) : sn[k];
    });
    if (e.type === 'fx') {
      if (!e.data || typeof e.data !== 'object') e.data = {}; if (sn.cols) e.data.colors = sn.cols.slice(); else delete e.data.colors; if (sn.ds != null && fxStyleField(e.kind)) e.data.style = sn.ds;
      if (sn.dsel) fxSelFields(e.kind).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(sn.dsel, k)) e.data[k] = sn.dsel[k]; else delete e.data[k]; }); /* base antiga (sem dsel): as escolhas ficam como estão */
    }
  }
  /* id estável da apresentação: histórico (Minhas obras), notas e edições locais do arquivo exportado usam esta chave */
  function deckId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function newDeck() { return { v: 1, app: 'AM Studio', id: deckId(), title: 'Nova apresentação', slides: [mkSlide('blank-light')] }; }

  /* ---------------- estado ---------------- */
  var deck = newDeck(), cur = 0, selId = null, selIds = [], editingId = null, freshId = null, clip = null, stage = null, zone = 'canvas';
  var hist = [], fut = [], rev = 0, last = JSON.stringify(deck); /* rev: conta cada mudança da obra (o histórico tem teto de 50 passos) */
  var wrap = $('#wrap'), selLayer = $('#sel');
  function slide() { return deck.slides[cur]; }
  function getEl(id) { return slide().els.find(function (e) { return e.id === id; }); }
  /* seleção: selId = elemento principal; selIds = conjunto selecionado (inclui selId) */
  function sel() { return selIds.length === 1 ? getEl(selId) || null : null; }
  function sels() { return slide().els.filter(function (e) { return selIds.indexOf(e.id) >= 0; }); }
  function pick(ids, primary) {
    var ok = []; (ids || []).forEach(function (id) { if (id && ok.indexOf(id) < 0 && getEl(id)) ok.push(id); });
    selIds = ok; selId = primary && ok.indexOf(primary) >= 0 ? primary : (ok.length ? ok[ok.length - 1] : null);
    if (ok.length) setZone('canvas');
  }
  function setSel(ids, primary) { stopPreview(); pick(ids, primary); drawSel(); renderProps(); }
  function setZone(z) { zone = z; var sd = $('#side'); if (sd) sd.classList.toggle('focus', z === 'thumbs'); }
  var draftTimer = null, draftWarned = false;
  function commit() {
    RT.stampNums(deck); /* S27: número do slide acompanha inserções, cópias e reordenações */
    deck.slides.forEach(syncLinks); /* S32: o que vai para o arquivo já tem as pontas presas no lugar */
    var now = JSON.stringify(deck);
    if (now === last) return;
    hist.push(last); if (hist.length > 50) hist.shift();
    last = now; fut.length = 0; rev++; updUndo(); renderThumb(cur);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try { if (now.length < 4500000) localStorage.setItem('amStudio.draft', now); else throw new Error('big'); }
      catch (e) { if (!draftWarned) { draftWarned = true; toast('Rascunho grande demais para o navegador. Use “Salvar apresentação”.'); } }
    }, 500);
    histCall('touch', now); /* Minhas obras: grava com atraso próprio, fora do caminho da edição */
  }
  /* Minhas obras (history.js, window.AMHist): opcional — sem ele o editor funciona igual; nunca lança */
  function histCall(fn, arg) { var H = window.AMHist; if (!H || typeof H[fn] !== 'function') return null; try { return H[fn](arg); } catch (e) { return null; } }
  function restore(json) { deck = JSON.parse(json); cur = Math.max(0, Math.min(cur, deck.slides.length - 1)); pick(selIds, selId); editingId = null; freshId = null; $('#title').value = deck.title || ''; renderAll(); }
  /* grava alterações ainda pendentes (setas com atraso, campo do painel ou título em foco) como um passo próprio */
  function flush() {
    if (nudge._k) { clearTimeout(nudge._k); nudge._k = null; commit(); renderProps(); }
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && (ae.id === 'title' || $('#props').contains(ae))) ae.blur();
    if (JSON.stringify(deck) !== last) commit();
  }
  function undo() { if (editingId) endEdit(); flush(); if (!hist.length) return; fut.push(last); last = hist.pop(); rev++; restore(last); updUndo(); }
  function redo() { if (editingId) endEdit(); flush(); if (!fut.length) return; hist.push(last); last = fut.pop(); rev++; restore(last); updUndo(); }
  function updUndo() { $('#bUndo').disabled = !hist.length; $('#bRedo').disabled = !fut.length; }
  /* ---------- validação de dados vindos de fora (arquivo, área de transferência) ---------- */
  var COLOR_RE = /^(#[0-9a-f]{3,8}|none|transparent|rgba?\([\d.,\s%]+\)|[a-z]{3,20})$/i, TOKEN_RE = /^[\w\s.%-]{0,40}$/, DATA_TOKENS = ['style', 'weight', 'color', 'tcolor', 'c1', 'c2', 'variant', 'name', 'trig', 'accent', 'bg', 'stroke', 'pair', 'layout', 'mode', 'sort',
    'hat', 'hair', 'lashes', 'glasses', 'outfit', 'tool', 'mood', 'mood2', 'act', 'act2', 'dir', 'look', 'bubble', 'side', 'bcol', 'aim', 'tail']; /* S35: personagens (partes, movimentos, balão, alvo) */
  /* DATA_TOKENS: data.* que viram classe/atributo (ícones, SmartArt, gráficos). Só texto simples (TOKEN_RE) ou cor; texto livre usa outras chaves e sai com esc().
     EL_TOKENS: campos do elemento com valores fechados (linhas e cards); os booleanos antigos dash/headStart/headEnd continuam valendo */
  var HEADS = ['arrow', 'open', 'dot', 'diamond', 'bar'], EL_TOKENS = { curve: ['straight', 'elbow', 'curve'], dashS: ['dash', 'dot', 'dashdot', 'long'], headS: HEADS, headE: HEADS, look: ['flat', 'outline', 'lift', 'accent', 'topbar', 'header', 'gradient', 'ice'] };
  function numOr(v, d) { v = +v; return isFinite(v) ? v : d; }
  /* giro normalizado: inteiro em (-180, 180] (270 → -90, -180 → 180) */
  function normRot(v) { v = Math.round(+v) || 0; v = ((v % 360) + 360) % 360; return v > 180 ? v - 360 : v; }
  function safeStr(v, n) { return typeof v === 'string' ? v.slice(0, n) : null; }
  function pickN(v, list, def) { v = +v; return list.indexOf(v) >= 0 ? v : def; }
  function safePal(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var o = {}; ['p', 'a'].forEach(function (k) { if (typeof v[k] === 'string' && /^#[0-9a-f]{6}$/i.test(v[k])) o[k] = v[k].toUpperCase(); });
    return o.p || o.a ? o : null;
  }
  /* S29: kit de marca — nome ≤ 60, até 12 cores #RRGGBB únicas (maiúsculas), pal como safePal, fonte TOKEN_RE; vazio sai */
  function safeBrand(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    var o = {}, seen = {};
    if (typeof b.name === 'string' && b.name.trim()) o.name = b.name.trim().slice(0, 60);
    if (Array.isArray(b.colors)) { var cs = []; b.colors.forEach(function (c) { var m = typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : null; if (m && !seen[m] && cs.length < 12) { seen[m] = 1; cs.push(m); } }); if (cs.length) o.colors = cs; }
    var pl = safePal(b.pal); if (pl) o.pal = pl;
    if (typeof b.font === 'string' && b.font.trim() && TOKEN_RE.test(b.font.trim())) o.font = b.font.trim();
    return o.name || o.colors || o.pal || o.font ? o : null;
  }
  function safeSrc(s) { return typeof s === 'string' && /^(data:image\/[\w.+-]+[;,]|https?:|blob:)/i.test(s) && !/["\\\n\r]/.test(s) ? s : null; }
  function safeEl(e) {
    if (!e || typeof e !== 'object' || ['text', 'shape', 'line', 'image', 'fx'].indexOf(e.type) < 0) return null;
    if (e.type === 'fx' && !(typeof e.kind === 'string' && RT.FX.hasOwnProperty(e.kind))) return null;
    var o = clone(e), F = e.type === 'fx' ? RT.FX[e.kind] : null;
    o.id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : uid();
    if (o.type === 'line') {
      ['x1', 'y1', 'x2', 'y2'].forEach(function (k, i) { o[k] = numOr(o[k], [440, 380, 840, 300][i]); });
      ['a1', 'a2'].forEach(function (k) { var a = o[k]; if (a && typeof a === 'object' && !Array.isArray(a) && typeof a.id === 'string' && /^[\w-]{1,40}$/.test(a.id)) o[k] = { id: a.id, s: /^[nesw]$/.test(a.s) ? a.s : 'c' }; else delete o[k]; }); /* S32: ponta presa a um elemento */
    }
    else if (o.type === 'image' && !(e.w > 0 && e.h > 0)) { o.w = 520; o.h = 360; o.x = (W - 520) / 2; o.y = (H - 360) / 2; } /* imagem gravada sem medidas (inserção antiga com NaN → null): volta visível, no centro */
    else { o.x = numOr(o.x, 0); o.y = numOr(o.y, 0); o.w = Math.max(8, numOr(o.w, F ? F.w : 300)); o.h = Math.max(8, numOr(o.h, F ? F.h : 140)); }
    ['fill', 'stroke', 'color', 'bg'].forEach(function (k) { if (o[k] != null && !(typeof o[k] === 'string' && COLOR_RE.test(o[k]))) delete o[k]; });
    ['align', 'valign', 'fit', 'shape', 'font'].forEach(function (k) { if (o[k] != null && !(typeof o[k] === 'string' && TOKEN_RE.test(o[k]))) delete o[k]; });
    ['weight', 'lh', 'ls', 'size', 'radius', 'strokeW', 'rot', 'opacity'].forEach(function (k) { if (o[k] != null) { var v = +o[k]; if (isFinite(v)) o[k] = v; else delete o[k]; } });
    Object.keys(EL_TOKENS).forEach(function (k) { if (o[k] != null && EL_TOKENS[k].indexOf(o[k]) < 0) delete o[k]; });
    if (o.rot != null) { var rr = normRot(o.rot); if (rr) o.rot = rr; else delete o.rot; } /* giro em graus inteiros, (-180, 180] */
    if (o.type === 'line' && o.rot != null) { turnEl(o, o.rot); delete o.rot; } /* linha não guarda giro (arquivo antigo/editado à mão): vira pontas giradas, o desenho fica igual e as alças batem */
    ['flipH', 'flipV'].forEach(function (k) { if (o[k] !== true || !RT.flipOK || !RT.flipOK(o)) delete o[k]; }); /* espelho: só true, e só onde ele existe (foto, forma, ícone) */
    if (o.bend != null) { if (isFinite(+o.bend)) o.bend = Math.max(0.05, Math.min(0.95, +o.bend)); else delete o.bend; }
    if (o.pal != null) { var pl = palOk(o) ? safePal(o.pal) : null; if (pl) o.pal = pl; else delete o.pal; } /* cores do componente (S20): só #rrggbb; vazio sai; só onde o painel oferece a seção (não em ícones nem na Marca A&M) */
    if (o.zoom != null) { if (o.zoom === false || o.zoom === true) { } else delete o.zoom; } /* ampliar na apresentação: só booleano (false desliga num modelo/imagem; true liga num componente) */
    if (o.html != null) o.html = cleanHTML(String(o.html));
    if (o.ph != null && !(typeof o.ph === 'string' && PH_RE.test(o.ph))) delete o.ph; /* S21: marca do elemento original do layout (safeSlide confere com slide.base) */
    if (o.lock !== true) delete o.lock; /* S27: bloqueado (só true) */
    if (o.crop != null) { var cc = o.type === 'image' && o.crop && typeof o.crop === 'object' ? {} : null; if (cc) ['l', 't', 'r', 'b'].forEach(function (k) { var v = +o.crop[k]; cc[k] = isFinite(v) ? Math.max(0, Math.min(.9, Math.round(v * 1000) / 1000)) : 0; }); if (cc && (cc.l || cc.t || cc.r || cc.b) && cc.l + cc.r <= .95 && cc.t + cc.b <= .95) o.crop = cc; else delete o.crop; } /* S27b: recorte da foto (frações) */
    if (o.grp != null && !(typeof o.grp === 'string' && /^[\w-]{1,40}$/.test(o.grp))) delete o.grp; /* S27: grupo = id compartilhado */
    if (o.type === 'image') { o.src = safeSrc(o.src); if (!o.src) return null; }
    var a = o.anim && typeof o.anim === 'object' ? o.anim : {}; o.anim = { in: TOKEN_RE.test(a.in || '') ? a.in || 'none' : 'none' };
    ['loop', 'hover'].forEach(function (k) { if (typeof a[k] === 'string' && /^\w{1,20}$/.test(a[k])) o.anim[k] = a[k]; });
    ['delay', 'dur'].forEach(function (k) { if (a[k] != null && isFinite(+a[k])) o.anim[k] = +a[k]; });
    if (a.spd != null) o.anim.spd = pickN(a.spd, [0.5, 0.75, 1, 1.5, 2], 1);
    if (a.rep != null) o.anim.rep = pickN(a.rep, [0, 1, 3], 0);
    ['step', 'emphAt'].forEach(function (k) { if (a[k] != null && isFinite(+a[k])) o.anim[k] = Math.max(0, Math.min(9, a[k] | 0)); });
    if (typeof a.emph === 'string' && /^(none|sweep|beat|spot|raise|recount)$/.test(a.emph)) o.anim.emph = a.emph;
    if (a.rest != null) o.anim.rest = pickN(a.rest, [0, 1, 2, 3], 0);
    if (a.lift != null) o.anim.lift = pickN(a.lift, [1, 2, 3], 2);
    if (a.glow != null) o.anim.glow = pickN(a.glow, [0, 1, 2], 0);
    if (a.gcol === 's' || a.gcol === 'o') o.anim.gcol = a.gcol;
    if (a.sweep != null) o.anim.sweep = pickN(a.sweep, [0, -1, 3, 5, 8], 0);
    if (a.depth != null) o.anim.depth = pickN(a.depth, [0, 1, 2], 0);
    if (F) {
      o.data = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : clone(F.data);
      DATA_TOKENS.forEach(function (k) { var v = o.data[k]; if (v != null && !(typeof v === 'string' && (TOKEN_RE.test(v) || COLOR_RE.test(v))) && !(typeof v === 'number' && isFinite(v))) delete o.data[k]; }); /* texto simples, cor ou número finito (ex.: espessura do traço do ícone em stroke); lista, objeto e booleano saem */
      if (o.data.colors != null) { /* cores das séries (gráficos): até 6 posições, só #rrggbb; posição inválida = '' (cor padrão) */
        var dc = Array.isArray(o.data.colors) ? o.data.colors.slice(0, 6).map(function (c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : ''; }) : [];
        while (dc.length && !dc[dc.length - 1]) dc.pop();
        if (dc.length) o.data.colors = dc; else delete o.data.colors;
      }
      if (o.variant != null && !(F.variants && F.variants.some(function (x) { return x[0] === o.variant; }))) delete o.variant;
      if (typeof F.norm === 'function') { try { o.data = F.norm(o.data) || o.data; } catch (er) { } } /* normalização própria do modelo (SmartArt: itens do painel de texto viram [{t, lv}]) */
    }
    return o;
  }
  function safeSlide(s) {
    if (!s || typeof s !== 'object') return null;
    var o = { id: typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) && !/^__proto__$|^constructor$|^prototype$/.test(s.id) ? s.id : uid(), bg: typeof s.bg === 'string' && COLOR_RE.test(s.bg) ? s.bg : '#FFFFFF', tr: typeof s.tr === 'string' && /^\w{1,12}$/.test(s.tr) ? s.tr : 'fade', els: (Array.isArray(s.els) ? s.els : []).map(safeEl).filter(Boolean) };
    var bi = safeSrc(s.bgImg); if (bi) { o.bgImg = bi; if (s.bgImgOp != null) o.bgImgOp = Math.max(0, Math.min(1, numOr(s.bgImgOp, 1))); }
    [['notes', 4000], ['sec', 80], ['secSub', 160], ['title', 160]].forEach(function (f) { var v = safeStr(s[f[0]], f[1]); if (v) v = cleanText(v).replace(/\u000B/g, '\n'); if (v) o[f[0]] = v; });
    if (s.kind === 'section') o.kind = 'section';
    var ids = {}; o.els.forEach(function (e) { if (ids[e.id]) e.id = uid(); ids[e.id] = 1; });
    if (s.hidden === true) o.hidden = true; /* S21: oculto na apresentação */
    var bs = safeBase(s.base), phs = {};
    if (bs) { o.base = bs; if (typeof s.layout === 'string' && LAYOUTS.hasOwnProperty(s.layout)) o.layout = s.layout; }
    o.els.forEach(function (e) { if (e.ph != null && (!bs || !bs.els[e.ph] || phs[e.ph])) delete e.ph; else if (e.ph) phs[e.ph] = 1; }); /* ph só vale uma vez e só com a base */
    return o;
  }
  /* base do slide (S21): só medidas e formato, cada campo validado (números finitos e limitados, cores, palavras fechadas); até 200 elementos */
  function clampN(v, a, b) { v = +v; return isFinite(v) ? Math.max(a, Math.min(b, v)) : null; }
  var SNAP_NUM = { x: [-10000, 10000], y: [-10000, 10000], w: [8, 10000], h: [8, 10000], x1: [-10000, 10000], y1: [-10000, 10000], x2: [-10000, 10000], y2: [-10000, 10000],
    opacity: [0, 1], radius: [0, 2000], size: [1, 400], weight: [100, 900], lh: [0.5, 5], ls: [-1, 3], strokeW: [0, 200], bend: [0.05, 0.95] };
  function safeSnap(v) {
    var o = {};
    Object.keys(SNAP_NUM).forEach(function (k) { if (v[k] != null) { var n = clampN(v[k], SNAP_NUM[k][0], SNAP_NUM[k][1]); if (n != null) o[k] = n; } });
    if (v.rot != null) { var r = normRot(v.rot); if (r) o.rot = r; }
    if (typeof v.t === 'string' && /^(text|shape|line|image|fx:[\w-]{1,40})$/.test(v.t)) o.t = v.t;
    Object.keys(SNAP_B).forEach(function (k) { if (v[k] === true) o[k] = true; });
    ['color', 'fill', 'stroke', 'bg'].forEach(function (k) { if (typeof v[k] === 'string' && COLOR_RE.test(v[k])) o[k] = v[k]; });
    ['font', 'align', 'valign', 'fit', 'shape', 'variant', 'ds'].forEach(function (k) { if (typeof v[k] === 'string' && TOKEN_RE.test(v[k])) o[k] = v[k]; });
    Object.keys(EL_TOKENS).forEach(function (k) { if (EL_TOKENS[k].indexOf(v[k]) >= 0) o[k] = v[k]; });
    var pl = safePal(v.pal); if (pl) o.pal = pl;
    if (v.dsel && typeof v.dsel === 'object' && !Array.isArray(v.dsel)) { var dd = {}; Object.keys(v.dsel).slice(0, 12).forEach(function (k) { var x = v.dsel[k]; if (/^[a-z][\w-]{0,30}$/i.test(k) && !/^(__proto__|constructor|prototype)$/.test(k) && ((typeof x === 'string' && (TOKEN_RE.test(x) || COLOR_RE.test(x))) || (typeof x === 'number' && isFinite(x)))) dd[k] = x; }); o.dsel = dd; }
    if (Array.isArray(v.cols)) { var dc = v.cols.slice(0, 6).map(function (c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : ''; }); while (dc.length && !dc[dc.length - 1]) dc.pop(); if (dc.length) o.cols = dc; }
    return o;
  }
  function safeBase(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    var o = { bg: typeof b.bg === 'string' && COLOR_RE.test(b.bg) ? b.bg : '#FFFFFF', els: {} }, src = b.els && typeof b.els === 'object' && !Array.isArray(b.els) ? b.els : {};
    if (b.bgImgOp != null) { var op = clampN(b.bgImgOp, 0, 1); if (op != null) o.bgImgOp = op; }
    Object.keys(src).filter(function (k) { return PH_RE.test(k) && src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]); }).slice(0, PH_MAX).forEach(function (k) { o.els[k] = safeSnap(src[k]); });
    var tp = b.tpl && typeof b.tpl === 'object' && !Array.isArray(b.tpl) ? b.tpl : null, tpl = {}, nt = 0;
    if (tp) Object.keys(tp).filter(function (k) { return PH_RE.test(k) && o.els[k]; }).slice(0, PH_MAX).forEach(function (k) { var e = safeEl(tp[k]); if (e && e.type !== 'image') { delete e.ph; tpl[k] = e; nt++; } });
    if (nt) o.tpl = tpl;
    return o;
  }
  function safeComment(c) {
    if (!c || typeof c !== 'object') return null;
    var t = safeStr(c.text, 4000); if (!t || !t.trim()) return null;
    var o = { id: typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : uid(), text: t, ts: numOr(c.ts, Date.now()) };
    var au = safeStr(c.author, 80); if (au) o.author = au;
    if (typeof c.slide === 'string' && /^[\w-]{1,40}$/.test(c.slide)) o.slide = c.slide;
    if (c.x != null && c.y != null) { o.x = Math.max(0, Math.min(W, numOr(c.x, 0))); o.y = Math.max(0, Math.min(H, numOr(c.y, 0))); }
    if (c.done) o.done = true;
    return o;
  }
  function safeDeck(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.slides)) return null;
    var sl = d.slides.map(safeSlide).filter(Boolean); if (!sl.length) return null;
    var sids = {}; sl.forEach(function (x) { if (sids[x.id]) x.id = uid(); sids[x.id] = 1; }); /* resumo editado no player e miniaturas usam o id do slide */
    var o = { v: 1, app: 'AM Studio', title: typeof d.title === 'string' ? d.title.slice(0, 300) : 'Apresentação', slides: sl };
    if (typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id)) o.id = d.id;
    if (d.nav && typeof d.nav === 'object') o.nav = { chapters: d.nav.chapters !== false };
    if (d.num && typeof d.num === 'object' && d.num.on === true) { o.num = { on: true, pos: /^(tl|tr|bl|br)$/.test(d.num.pos) ? d.num.pos : 'br' }; if (d.num.from != null && isFinite(+d.num.from)) o.num.from = Math.max(0, Math.min(999, +d.num.from | 0)); } /* S27: numeração dos slides */
    var bk = safeBrand(d.brand); if (bk) o.brand = bk; /* S29: kit de marca */
    ['created', 'updated'].forEach(function (k) { if (d[k] != null && isFinite(+d[k])) o[k] = +d[k]; });
    if (Array.isArray(d.comments)) { var cm = d.comments.slice(0, 2000).map(safeComment).filter(Boolean); if (cm.length) o.comments = cm; }
    return o;
  }
  function loadDeck(d, msg, quiet, noHist) {
    d = safeDeck(d);
    if (!d) { if (!quiet) toast('Arquivo sem apresentação reconhecível.'); return false; }
    if (!d.id) d.id = deckId(); /* modelos prontos e arquivos antigos ganham id ao abrir */
    d.slides.forEach(function (s) { if (!s.base) stampSlide(s); }); /* S21: arquivo antigo, modelo pronto ou rascunho sem base: o estado de agora vira o original de “Redefinir slide” */
    deck = d; cur = 0; pick([]); editingId = null; freshId = null; hist.length = 0; fut.length = 0; rev++; last = JSON.stringify(deck);
    ensureFonts(fontsIn(last)); /* S29: fontes do Google que a obra usa */
    $('#title').value = deck.title || ''; renderAll(); $('#thumbs').scrollTop = 0; /* outra obra: a lista começa no slide 1, não na rolagem da anterior */
    updUndo(); if (msg) toast(msg);
    if (!noHist) histCall('put', JSON.parse(last)); /* arquivo aberto, projeto pronto ou rascunho entram em Minhas obras */
    return true;
  }

  /* ---------------- render ---------------- */
  function renderAll() { RT.stampNums(deck); renderThumbs(); renderStage(); renderProps(); }
  function fit() {
    var cv = $('#cv'), aw = cv.clientWidth - 56, ah = cv.clientHeight - 72, w = Math.max(320, Math.min(aw, ah * 16 / 9));
    wrap.style.width = w + 'px'; wrap.style.height = (w * 9 / 16) + 'px';
  }
  function renderStage() {
    stopPreview(); if (stage) stage.remove();
    syncLinks(slide()); /* S32: pontas presas acompanham as formas */
    stage = RT.renderSlide(slide(), { play: false });
    wrap.insertBefore(stage, wrap.firstChild);
    stageHidden(); fit(); drawSel();
  }
  function rerenderEl(el) {
    stopPreview(); var i = slide().els.indexOf(el), old = stage.querySelector('.am-el[data-id="' + el.id + '"]'), n = RT.renderEl(el, i);
    if (old) old.replaceWith(n); else stage.appendChild(n);
    if (el.type !== 'line') refreshLinks(el); /* S32: tamanho/posição nova → as linhas presas se redesenham */
    drawSel();
  }
  /* ---------- S32: conectores presos (el.a1 / el.a2 = {id, s}) ----------
     s = n/e/s/w: meio daquele lado; c = automático: onde a reta até a outra ponta (ou até o centro da outra forma presa) cruza a caixa.
     As coordenadas x1/y1/x2/y2 continuam gravadas (o player e as exportações não precisam saber de nada): syncLinks recalcula
     antes de desenhar e ao gravar; mover a forma (posNode) e redimensionar (rerenderEl) redesenham as linhas presas ao vivo */
  var SIDE_N = { c: 'Lado automático', n: 'Em cima', e: 'À direita', s: 'Embaixo', w: 'À esquerda' };
  function anchorPt(t, side, ox, oy) {
    var b = aabb(t), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (side === 'n') return [Math.round(cx), Math.round(b.y)]; if (side === 's') return [Math.round(cx), Math.round(b.y + b.h)];
    if (side === 'w') return [Math.round(b.x), Math.round(cy)]; if (side === 'e') return [Math.round(b.x + b.w), Math.round(cy)];
    var dx = ox - cx, dy = oy - cy; if (!dx && !dy) return [Math.round(cx), Math.round(b.y)];
    var k = Math.min(Math.abs(dx) > 1e-6 ? (b.w / 2) / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? (b.h / 2) / Math.abs(dy) : 1e9);
    return [Math.round(cx + dx * k), Math.round(cy + dy * k)];
  }
  function syncLine(s, ln) {
    var ch = false, byId = function (id) { return (s.els || []).find(function (e) { return e.id === id && e.type !== 'line'; }); };
    ['a1', 'a2'].forEach(function (k) {
      var a = ln[k]; if (!a) return; var t = byId(a.id); if (!t) { delete ln[k]; ch = true; return; }
      var oa = ln[k === 'a1' ? 'a2' : 'a1'], ot = oa && byId(oa.id), o = ot ? (function () { var b = aabb(ot); return [b.x + b.w / 2, b.y + b.h / 2]; })() : (k === 'a1' ? [ln.x2, ln.y2] : [ln.x1, ln.y1]);
      var p = anchorPt(t, a.s, o[0], o[1]), kx = k === 'a1' ? 'x1' : 'x2', ky = k === 'a1' ? 'y1' : 'y2';
      if (ln[kx] !== p[0] || ln[ky] !== p[1]) { ln[kx] = p[0]; ln[ky] = p[1]; ch = true; }
    });
    return ch;
  }
  function syncLinks(s) { var ch = []; ((s && s.els) || []).forEach(function (e) { if (e.type === 'line' && (e.a1 || e.a2) && syncLine(s, e)) ch.push(e); }); return ch; }
  function linkedLines(s, id) { return ((s && s.els) || []).filter(function (e) { return e.type === 'line' && ((e.a1 && e.a1.id === id) || (e.a2 && e.a2.id === id)); }); }
  function refreshLinks(el) { var s = slide(); linkedLines(s, el.id).forEach(function (ln) { syncLine(s, ln); if (stage && stage.querySelector('.am-el[data-id="' + ln.id + '"]')) rerenderEl(ln); }); }
  function detachMoved(list) { var ids = list.map(function (e) { return e.id; }); list.forEach(function (e) { if (e.type !== 'line') return; ['a1', 'a2'].forEach(function (k) { if (e[k] && ids.indexOf(e[k].id) < 0) delete e[k]; }); }); } /* mover a linha sozinha solta as pontas; mover junto com a forma mantém */
  function remapLinks(list, map) { list.forEach(function (e) { if (e.type !== 'line') return; ['a1', 'a2'].forEach(function (k) { if (!e[k]) return; if (map[e[k].id]) e[k] = { id: map[e[k].id], s: e[k].s }; else delete e[k]; }); }); return list; }
  /* alvo para prender a ponta arrastada: elemento (não linha) sob o ponteiro (até 12 px fora da caixa); a 22 px do meio de um lado = esse lado, senão automático; o menor elemento ganha */
  function snapTarget(x, y, selfId) {
    var best = null;
    slide().els.forEach(function (t) {
      if (t.id === selfId || t.type === 'line') return; var b = aabb(t); if (x < b.x - 12 || x > b.x + b.w + 12 || y < b.y - 12 || y > b.y + b.h + 12) return;
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2, side = 'c', dm = 22;
      [['n', cx, b.y], ['e', b.x + b.w, cy], ['s', cx, b.y + b.h], ['w', b.x, cy]].forEach(function (c) { var d = Math.hypot(c[1] - x, c[2] - y); if (d < dm) { dm = d; side = c[0]; } });
      var area = b.w * b.h; if (!best || area < best.area) best = { el: t, s: side, area: area };
    });
    return best;
  }
  function markTarget(t) { if (!stage) return; $$('.am-el.lnk-t', stage).forEach(function (n) { n.classList.remove('lnk-t'); }); if (t) { var n = stage.querySelector('.am-el[data-id="' + t.id + '"]'); if (n) n.classList.add('lnk-t'); } }
  function linkSec(el) {
    var s = slide(), row = function (k, label) {
      var a = el[k], t = a && s.els.find(function (e) { return e.id === a.id; });
      return '<div class="row r1"><label class="pf"><span>' + label + (t ? ' <small>presa a ' + esc(elName(t)) + '</small>' : '') + '</span>' + (t ? '<div class="row lnk">' + selIn(k + '.s', a.s || 'c', Object.keys(SIDE_N).map(function (q) { return [q, SIDE_N[q]]; })) + '<button type="button" class="btnw ic" data-act="unlink-' + k + '" title="Soltar esta ponta da forma">' + svgI('unlink') + 'Soltar</button></div>' : '<span class="note" style="margin:0">Solta. Arraste esta ponta até uma forma para prender.</span>') + '</label></div>';
    };
    return '<div class="sec"><h3>Pontas presas</h3>' + row('a1', 'Início') + row('a2', 'Fim') + '<p class="note">Uma ponta presa acompanha a forma quando ela se move ou muda de tamanho. Ao arrastar a ponta, <b>Alt</b> = não prender.</p></div>';
  }
  function pc(v, t) { return (v / t * 100) + '%'; }
  function boxCss(b) { return 'left:' + pc(b.x, W) + ';top:' + pc(b.y, H) + ';width:' + pc(b.w, W) + ';height:' + pc(b.h, H); }
  /* girar e inverter no quadro: busy = arrastando / redimensionando / girando / laço (a barra do quadro some); rotTip = ângulo ao vivo junto do ponteiro */
  var busy = null, rotTip = null;
  var RCUR = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'], HANG = { e: 0, se: 1, s: 2, sw: 3, w: 4, nw: 5, n: 6, ne: 7 };
  /* cursor da alça num elemento girado: o mais próximo dos 8 de redimensionar (sem giro = o próprio nome da alça) */
  function hdlCur(h, rot) { return RCUR[((HANG[h] + Math.round((+rot || 0) / 45)) % 8 + 8) % 8] + '-resize'; }
  /* quadro girado: centro e ponto do mundo para um ponto local da caixa sem giro (c + R(θ)(p − c)) */
  function rotFrame(el) {
    var t = (+el.rot || 0) * Math.PI / 180, cx = el.x + el.w / 2, cy = el.y + el.h / 2, c = Math.cos(t), s = Math.sin(t);
    return { cx: cx, cy: cy, p: function (lx, ly) { var dx = lx - cx, dy = ly - cy; return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }; } };
  }
  /* caixa alinhada aos eixos que contém o elemento girado (sem giro = a própria caixa) */
  function aabb(el) {
    if (el.type === 'line' || !+el.rot) return bbox(el);
    var f = rotFrame(el), q = [f.p(el.x, el.y), f.p(el.x + el.w, el.y), f.p(el.x + el.w, el.y + el.h), f.p(el.x, el.y + el.h)], xs = q.map(function (a) { return a.x; }), ys = q.map(function (a) { return a.y; });
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys); return { x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 };
  }
  function drawSel(guides) {
    var html = '', list = sels(), el = sel(), k = wrap.clientWidth / W || 1;
    if (list.length > 1) {
      list.forEach(function (e) { var b = bbox(e); if (e.type === 'line') b = { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 }; html += '<div class="sbox multi" style="' + boxCss(b) + (e.rot && e.type !== 'line' ? ';transform:rotate(' + e.rot + 'deg)' : '') + '"></div>'; });
      var sameG = list.every(function (e) { return e.grp && e.grp === list[0].grp; }), nLk = list.filter(isLocked).length;
      html += '<div class="gbox' + (sameG ? ' grp' : '') + '" style="' + boxCss(groupBox(list)) + '"><span>' + (sameG ? 'Grupo · ' : '') + '<b>' + list.length + '</b> elementos' + (nLk ? ' · ' + (nLk === list.length ? 'bloqueado' : nLk + ' bloqueado' + (nLk > 1 ? 's' : '')) : '') + '</span></div>';
    }
    if (el) {
      if (el.type === 'line' && isLocked(el)) { var lb = bbox(el); html += '<div class="sbox locked" style="' + boxCss({ x: lb.x - 3, y: lb.y - 3, w: lb.w + 6, h: lb.h + 6 }) + '"><i class="lockb" title="Bloqueado (Ctrl+Shift+L desbloqueia)">' + svgI('lock') + '</i></div>'; }
      else if (el.type === 'line') {
        html += '<div class="hdl p" data-h="p1" style="left:' + pc(el.x1, W) + ';top:' + pc(el.y1, H) + '"></div><div class="hdl p" data-h="p2" style="left:' + pc(el.x2, W) + ';top:' + pc(el.y2, H) + '"></div>';
        if (el.curve === 'elbow' && RT.lineBendPt) { var bp = RT.lineBendPt(el); html += '<div class="hdl bd" data-h="bend" title="Arraste para mover a dobra do cotovelo" style="left:' + pc(bp.x, W) + ';top:' + pc(bp.y, H) + ';cursor:' + (bp.hz ? 'ew' : 'ns') + '-resize"></div>'; }
      } else {
        var box = 'left:' + pc(el.x, W) + ';top:' + pc(el.y, H) + ';width:' + pc(el.w, W) + ';height:' + pc(el.h, H);
        html += '<div class="sbox' + (editingId === el.id ? ' edit' : '') + (isLocked(el) ? ' locked' : '') + '" style="' + box + (el.rot ? ';transform:rotate(' + el.rot + 'deg)' : '') + '">' + (isLocked(el) ? '<i class="lockb" title="Bloqueado: não move nem redimensiona (Ctrl+Shift+L desbloqueia)">' + svgI('lock') + '</i>' : '') + '</div>';
        if (editingId !== el.id && !isLocked(el)) {
          var fr = rotFrame(el);
          /* alças nos cantos e lados do quadro girado; o cursor gira junto */
          [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]].forEach(function (h) {
            var q = fr.p(el.x + el.w * h[1], el.y + el.h * h[2]);
            html += '<div class="hdl" data-h="' + h[0] + '" style="left:' + pc(q.x, W) + ';top:' + pc(q.y, H) + ';cursor:' + hdlCur(h[0], el.rot) + '"></div>';
          });
          /* alça de girar: ~26 px acima do meio da borda de cima (gira com o elemento); sem espaço acima do palco, vai para baixo */
          var dd = 26 / k, st = fr.p(el.x + el.w / 2, el.y), hp = fr.p(el.x + el.w / 2, el.y - dd), dn = false, mt = (($('#cv').clientHeight - wrap.clientHeight) / 2 - 12) / k;
          if (hp.y < -mt) { dn = true; st = fr.p(el.x + el.w / 2, el.y + el.h); hp = fr.p(el.x + el.w / 2, el.y + el.h + dd); }
          html += '<div class="rstem" style="left:' + pc(st.x, W) + ';top:' + pc(st.y, H) + ';transform:translate(-50%,-100%) rotate(' + ((+el.rot || 0) + (dn ? 180 : 0)) + 'deg)"></div>' +
            '<div class="rhdl" data-h="rot" title="Arraste para girar · Shift: de 15 em 15°" style="left:' + pc(hp.x, W) + ';top:' + pc(hp.y, H) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12.5a7.5 7.5 0 1 1-2.2-5.8"/><path d="M19.5 3.5v4.5H15"/></svg></div>';
        }
      }
    }
    if (el && editingId !== el.id) {
      var FDx = el.type === 'fx' ? RT.FX[el.kind] : null, lbl, bx = aabb(el);
      if (FDx && FDx.variants) { var vv = el.variant || FDx.variant; lbl = (FDx.vlabel || (FDx.gal === 'icon' ? 'Movimento' : 'Efeito')) + ': <b>' + esc((FDx.variants.find(function (x) { return x[0] === vv; }) || FDx.variants[0])[1]) + '</b>'; }
      else { var ai = (el.anim && el.anim.in) || 'none'; lbl = 'Animação: <b>' + esc((ANIM_IN.find(function (x) { return x[0] === ai; }) || ANIM_IN[0])[1]) + '</b>'; }
      var ax = Math.min(bx.x + bx.w, W - 10), ay = Math.max(bx.y, 40);
      html += '<button class="fxarrow" id="fxArrow" style="left:' + pc(ax, W) + ';top:' + pc(ay, H) + ';transform:translate(-100%,calc(-100% - 8px))" title="Escolher o efeito deste elemento"><svg viewBox="0 0 24 24" style="stroke:#F78C16"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>' + lbl + '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>';
    }
    if (rotTip) html += '<div class="rottip" style="left:' + pc(rotTip.x, W) + ';top:' + pc(rotTip.y, H) + '">' + rotTip.a + '°</div>';
    /* barra do quadro (girar 90° e inverter): some ao editar texto e enquanto arrasta, redimensiona ou gira */
    var bar = !busy && list.length && !editingId && (list.length > 1 || canFlip(el));
    if (bar) html += '<div class="frbar" id="frBar" role="toolbar" aria-label="Girar e inverter">' + barBtns(list) + '</div>';
    /* S26: barra de formatação do texto enquanto se edita (negrito, itálico, sublinhado, riscado, tamanho, cor, marcador, listas, alinhamento, limpar) */
    var ted = editingId && el && el.id === editingId && (el.type === 'text' || el.type === 'shape') ? el : null;
    if (ted) html += '<div class="frbar txbar" id="txBar" role="toolbar" aria-label="Formatar o texto">' + txBtns() + '</div>';
    (guides || []).forEach(function (g) { html += g.v != null ? '<div class="guide v" style="left:' + pc(g.v, W) + '"></div>' : '<div class="guide h" style="top:' + pc(g.h, H) + '"></div>'; });
    selLayer.innerHTML = html;
    fitArrow();
    if (bar) placeBar(list, el);
    if (ted) { placeTxBar(ted); syncTxBar(); }
  }
  /* ---------------- S26: formatação do texto na edição ---------------- */
  var TXB = [['bold', 'Negrito (Ctrl+B)'], ['italic', 'Itálico (Ctrl+I)'], ['underline', 'Sublinhado (Ctrl+U)'], ['strike', 'Riscado'], null,
    ['sizedown', 'Diminuir o texto selecionado'], ['sizeup', 'Aumentar o texto selecionado'], ['fcolor', 'Cor do texto selecionado'], ['hilite', 'Marcador (fundo laranja)'], null,
    ['bullets', 'Lista com marcadores (Ctrl+Shift+8)'], ['numbered', 'Lista numerada (Ctrl+Shift+7)'], null, ['alignl', 'Alinhar à esquerda'], ['alignc', 'Centralizar'], ['alignr', 'Alinhar à direita'], null, ['clearfmt', 'Limpar formatação do trecho']];
  function txBtns() { return TXB.map(function (b) { return b ? '<button type="button" data-tx="' + b[0] + '" title="' + esc(b[1]) + '" aria-label="' + esc(b[1]) + '"' + (b[0] === 'fcolor' ? ' data-cpick="tx"' : '') + '>' + svgI(b[0]) + '</button>' : '<i class="sep" aria-hidden="true"></i>'; }).join(''); }
  /* no alto à esquerda do quadro; sem espaço em cima (topo do slide), embaixo; nunca fora do palco */
  function placeTxBar(el) {
    var bar = $('#txBar'); if (!bar) return;
    var wr = wrap.getBoundingClientRect(), k = wr.width / W, g = aabb(el), bw = bar.offsetWidth, bh = bar.offsetHeight;
    var x = Math.max(4, Math.min(g.x * k, wr.width - bw - 4)), y = g.y * k - bh - 8; if (y < 4) y = Math.min((g.y + g.h) * k + 8, wr.height - bh - 4);
    bar.style.left = (x / wr.width * 100) + '%'; bar.style.top = (y / wr.height * 100) + '%';
  }
  var TX_STATE = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough', bullets: 'insertUnorderedList', numbered: 'insertOrderedList', alignl: 'justifyLeft', alignc: 'justifyCenter', alignr: 'justifyRight' };
  function syncTxBar() {
    var bar = $('#txBar'); if (!bar || !editingId) return;
    Object.keys(TX_STATE).forEach(function (k) { var b = bar.querySelector('button[data-tx="' + k + '"]'); if (!b) return; var on = false; try { on = document.queryCommandState(TX_STATE[k]); } catch (e) { } b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  document.addEventListener('selectionchange', function () { if (editingId) syncTxBar(); });
  function editingTx() { if (!editingId) return null; var n = stage.querySelector('.am-el[data-id="' + editingId + '"]'); return n && n.querySelector('.am-tx'); }
  /* css=false → o navegador grava <b>/<i>/<u>/<strike> (compactos, os mesmos da importação); css=true → <span style> (cor, marcador) */
  function cmd(c, v, css) { try { document.execCommand('styleWithCSS', false, !!css); } catch (e) { } try { return document.execCommand(c, false, v == null ? null : v); } catch (e) { return false; } }
  /* tamanho do trecho: um <span style="font-size:1.15em"> (ou 0.87em) em volta da seleção — em, para acompanhar o slide e as miniaturas;
     repetir aninha outro span (×1,15 de novo). Sem execCommand('fontSize'): ele grava <font size> em tamanhos fixos e funde spans */
  function sizeSel(up) {
    var tx = editingTx(); if (!tx) return;
    var sl = getSelection(); if (!sl || !sl.rangeCount || sl.isCollapsed) return;
    var rg = sl.getRangeAt(0); if (!tx.contains(rg.commonAncestorContainer)) return;
    var sp = document.createElement('span'); sp.style.fontSize = up ? '1.15em' : '0.87em';
    sp.appendChild(rg.extractContents()); rg.insertNode(sp);
    var r2 = document.createRange(); r2.selectNodeContents(sp); sl.removeAllRanges(); sl.addRange(r2); /* o trecho continua selecionado: dá para clicar A+ de novo */
    tx.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function txFmt(k) {
    var tx = editingTx(); if (!tx) return;
    if (document.activeElement !== tx) tx.focus();
    if (k === 'sizeup' || k === 'sizedown') return sizeSel(k === 'sizeup');
    if (k === 'hilite') { var on = false; try { var bg = document.queryCommandValue('hiliteColor'); on = /247, 140, 22|F78C16/i.test(bg || ''); } catch (e) { } cmd('hiliteColor', on ? 'transparent' : '#F78C16', true); }
    else if (k === 'clearfmt') { cmd('removeFormat'); cmd('unlink'); }
    else if (TX_STATE[k]) cmd(TX_STATE[k], null, /^justify/.test(TX_STATE[k]));
    syncTxBar();
  }
  var txHold = false; /* seletor de cores aberto a partir da barra: perder o foco não encerra a edição */
  function txColor(b, kb) {
    var tx = editingTx(); if (!tx || !window.AMColorPop) return;
    txHold = true;
    var sel = getSelection(), saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null, cur = '#002A46';
    try { var v = document.queryCommandValue('foreColor'); var m = /(\d+),\s*(\d+),\s*(\d+)/.exec(v || ''); if (m) cur = '#' + [m[1], m[2], m[3]].map(function (x) { x = (+x).toString(16); return x.length < 2 ? '0' + x : x; }).join('').toUpperCase(); } catch (e) { }
    function restore() { if (!saved) return; var s2 = getSelection(); s2.removeAllRanges(); s2.addRange(saved); }
    AMColorPop.open(b, { value: cur, title: 'Cor do texto selecionado', keyboard: !!kb,
      onPick: function (c) { tx.focus(); restore(); cmd('foreColor', c, true); tx.dispatchEvent(new Event('input', { bubbles: true })); },
      onClose: function () { txHold = false; if (editingId && document.contains(tx) && document.activeElement !== tx) { tx.focus(); restore(); } } });
  }
  selLayer.addEventListener('mousedown', function (e) { if (e.target.closest('#txBar')) e.preventDefault(); });
  selLayer.addEventListener('click', function (e) { var b = e.target.closest('#txBar button[data-tx]'); if (!b) return; e.stopPropagation(); if (b.dataset.tx === 'fcolor') txColor(b, !e.detail); else txFmt(b.dataset.tx); });
  /* quadro estreito: o “Animação” (#fxArrow, ancorado no canto de cima à direita) cobriria a alça de girar; ele passa para o lado
     direito da alça (ou para o esquerdo, se faltar palco) */
  function fitArrow() {
    var fa = $('#fxArrow', selLayer), rh = $('.rhdl', selLayer); if (!fa || !rh) return;
    var wr = wrap.getBoundingClientRect(), cr = $('#cv').getBoundingClientRect(), a = fa.getBoundingClientRect(), r = rh.getBoundingClientRect(), x;
    if (a.right < r.left - 6 || a.left > r.right + 6 || a.bottom < r.top - 6 || a.top > r.bottom + 6) return;
    /* ao lado da alça dentro do slide; sem espaço (palco estreito e rótulo longo, ex.: “Efeito: Quadrante a quadrante”), ao lado da alça na
       margem cinza do #cv; nem assim, acima da alça */
    if (r.right + 8 + a.width <= wr.right - 4) x = r.right + 8 + a.width; else if (r.left - 8 - a.width >= wr.left + 4) x = r.left - 8;
    else if (r.right + 8 + a.width <= cr.right - 4) x = r.right + 8 + a.width; else if (r.left - 8 - a.width >= cr.left + 4) x = r.left - 8;
    else { fa.style.top = ((r.top - 8 - wr.top) / wr.height * 100) + '%'; return; }
    fa.style.left = ((x - wr.left) / wr.width * 100) + '%';
  }
  /* barra presa: depois de um clique num botão dela, fica no mesmo lugar (o quadro muda de forma a cada 90°) enquanto o ponteiro estiver sobre
     ela e a seleção for a mesma — assim o segundo clique cai no mesmo botão. Sai ao tirar o ponteiro da barra */
  var barPin = null;
  function pinBar() { var b = $('#frBar'); barPin = b ? { k: selIds.join(','), l: b.style.left, t: b.style.top } : null; }
  document.addEventListener('pointermove', function (e) {
    if (!barPin || (e.target && e.target.closest && e.target.closest('#frBar'))) return;
    barPin = null; if (!busy && $('#frBar')) placeBar(sels(), sel());
  }, { passive: true });
  /* posição da barra: no alto à esquerda do quadro (espelho do “Animação” à direita); quadro estreito, alça de girar ou topo do slide no
     caminho → embaixo do quadro. Nunca sobre o #fxArrow, a alça de girar ou o rótulo do grupo; sempre dentro do palco */
  function placeBar(list, el) {
    var bar = $('#frBar'); if (!bar) return;
    if (barPin) { if (barPin.k === selIds.join(',')) { bar.style.left = barPin.l; bar.style.top = barPin.t; return; } barPin = null; }
    var wr = wrap.getBoundingClientRect(), k = wr.width / W, multi = list.length > 1, g = multi ? groupBox(list) : aabb(el), pad = multi ? 7 : el.type === 'line' ? 6 : 0;
    var bw = bar.offsetWidth, bh = bar.offsetHeight, gap = 8, X0 = g.x * k - pad, Y0 = g.y * k - pad, X1 = (g.x + g.w) * k + pad, Y1 = (g.y + g.h) * k + pad;
    var avoid = $$('#fxArrow,.rhdl,.gbox span', selLayer).map(function (n) { var r = n.getBoundingClientRect(); return { l: r.left - wr.left - 4, t: r.top - wr.top - 4, r: r.right - wr.left + 4, b: r.bottom - wr.top + 4 }; });
    var rh = $('.rhdl', selLayer), rhl = rh ? rh.getBoundingClientRect().left - wr.left - 8 : null;
    /* acima à esquerda; acima, terminando antes da alça de girar (quadro estreito); embaixo à esquerda / à direita; ao lado esquerdo */
    var cands = multi ? [[X1 - bw, Y0 - gap - bh], [X1 - bw, Y1 + gap], [X0, Y1 + gap]] : [[X0, Y0 - gap - bh]].concat(rhl != null ? [[rhl - bw, Y0 - gap - bh]] : [], [[X0, Y1 + gap], [X1 - bw, Y1 + gap], [X0 - gap - bw, Y0]]), best = null;
    cands.forEach(function (c, i) {
      var x = Math.max(4, Math.min(wr.width - bw - 4, c[0])), y = Math.max(4, Math.min(wr.height - bh - 4, c[1])), o = 0;
      avoid.forEach(function (a) { var ox = Math.min(x + bw, a.r) - Math.max(x, a.l), oy = Math.min(y + bh, a.b) - Math.max(y, a.t); if (ox > 0 && oy > 0) o += ox * oy; });
      var sc = o * 100 + Math.abs(x - c[0]) + Math.abs(y - c[1]) * 3 + i;
      if (!best || sc < best.s) best = { s: sc, x: x, y: y };
    });
    bar.style.left = (best.x / wr.width * 100) + '%'; bar.style.top = (best.y / wr.height * 100) + '%';
  }
  /* botões de girar e inverter (barra do quadro, painel e menu usam as mesmas ações) */
  var FR = [['rot-l', 'Girar 90° à esquerda'], ['rot-r', 'Girar 90° à direita'], ['flip-h', 'Inverter na horizontal'], ['flip-v', 'Inverter na vertical']];
  function canFlip(el) { return !!el && (el.type === 'line' || !!(RT.flipOK && RT.flipOK(el))); }
  /* '' = ao menos um elemento da lista pode ser espelhado; senão, o motivo (vai no title do botão desativado e no aviso) */
  function flipWhy(list) {
    if (list.some(canFlip)) return '';
    if (list.length > 1) return 'Nenhum elemento da seleção pode ser espelhado: textos, gráficos e modelos com texto ficariam de trás para frente.';
    return list[0] && list[0].type === 'text' ? 'Textos não se espelham: a leitura ficaria de trás para frente.' : 'Gráficos e modelos com texto não se espelham: a leitura ficaria de trás para frente.';
  }
  /* barra do quadro: só os botões que valem para a seleção (sem botões desativados no palco; o painel e o menu mostram o motivo) */
  function barBtns(list) {
    var fl = list.some(canFlip);
    return FR.filter(function (f) { return fl || f[0].indexOf('flip') < 0; }).map(function (f) { return '<button type="button" data-fr="' + f[0] + '" title="' + esc(f[1]) + '" aria-label="' + esc(f[1]) + '">' + svgI(f[0]) + '</button>'; }).join('');
  }
  function hasRot(list) { return list.some(function (e) { return e.type !== 'line' && +e.rot; }); }
  function frBtns(list, attr, zero) {
    var why = flipWhy(list);
    return FR.map(function (f) {
      var off = why && f[0].indexOf('flip') === 0, t = off ? f[1] + ' (indisponível). ' + why : f[1];
      return '<button type="button" ' + attr + '="' + f[0] + '"' + (off ? ' class="off" aria-disabled="true"' : '') + ' title="' + esc(t) + '" aria-label="' + esc(t) + '">' + svgI(f[0]) + '</button>';
    }).join('') + (zero ? '<button type="button" ' + attr + '="rot-0"' + (hasRot(list) ? '' : ' class="off" aria-disabled="true"') + ' title="Zerar rotação" aria-label="Zerar rotação">' + svgI('rot-0') + '</button>' : '');
  }
  function renderThumbs() {
    var box = $('#thumbs'); box.innerHTML = '';
    deck.slides.forEach(function (s, i) {
      var t = document.createElement('div'); t.className = 'th' + (i === cur ? ' on' : ''); t.dataset.i = i; t.draggable = true;
      t.innerHTML = '<span class="n">' + (i + 1) + '</span><div class="box"><div class="act"><button data-ta="dup" title="Duplicar slide" aria-label="Duplicar slide">' + svgI('dup') + '</button><button data-ta="del" title="Apagar slide" aria-label="Apagar slide">' + svgI('del') + '</button></div></div>';
      t.querySelector('.box').appendChild(RT.renderSlide(s, { play: false }));
      thHidden(t, s);
      box.appendChild(t);
    });
    sidePos();
  }
  function renderThumb(i) {
    var t = $('#thumbs .th[data-i="' + i + '"] .box'); if (!t || !deck.slides[i]) return;
    var old = t.querySelector('.am-stage'); if (old) old.remove(); t.appendChild(RT.renderSlide(deck.slides[i], { play: false }));
    thHidden(t.parentNode, deck.slides[i]);
  }
  /* S21: miniatura de slide oculto = esmaecida, número riscado e selo de olho cortado; no palco, uma faixa discreta */
  var HID_TIP = 'Slide oculto: não aparece na apresentação';
  function thHidden(t, s) {
    var on = s.hidden === true, b = t.querySelector('.hb'); t.classList.toggle('hid', on);
    if (on && !b) t.insertAdjacentHTML('beforeend', '<span class="hb" title="' + HID_TIP + '" aria-label="' + HID_TIP + '" role="img">' + svgI('eyeoff') + '</span>');
    else if (!on && b) b.remove();
  }
  function stageHidden() { var b = $('#hidBan'); if (b) b.hidden = slide().hidden !== true; }
  function goSlide(i) { if (editingId) endEdit(); flush(); cur = Math.max(0, Math.min(deck.slides.length - 1, i)); pick([]); $$('#thumbs .th').forEach(function (t, k) { t.classList.toggle('on', k === cur); }); renderStage(); renderProps(); sidePos(); var on = $('#thumbs .th.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }

  /* ---------------- propriedades ---------------- */
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function fld(label, inner) { return '<label class="pf"><span>' + label + '</span>' + inner + '</label>'; }
  function num(p, v, step, min, max) { return '<input type="number" data-p="' + p + '" data-n="1" value="' + (v == null ? '' : Math.round(v * 100) / 100) + '" step="' + (step || 1) + '"' + (min != null ? ' min="' + min + '"' : '') + (max != null ? ' max="' + max + '"' : '') + '>'; }
  function txtIn(p, v) { return '<input type="text" data-p="' + p + '" value="' + esc(v) + '">'; }
  function area(p, v) { return '<textarea data-p="' + p + '">' + esc(v) + '</textarea>'; }
  function selIn(p, v, opts, isNum) { return '<select data-p="' + p + '"' + (isNum ? ' data-n="1"' : '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  /* linha de amostras de cor: [cor atual fora da lista] + [sem cor] + lista (padrão: paleta A&M; campos de cor de componentes passam as
     próprias opções [[cor, nome]]) + “Mais cores…” (abre o seletor AMColorPop: paleta ampliada, recentes, hex, conta-gotas) */
  var HEXC = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  function swatches(p, v, none, list) {
    var cur = String(v || '').toUpperCase(), L = list || swList(), inL = L.some(function (o) { return String(o[0]).toUpperCase() === cur; });
    var cust = HEXC.test(cur) && !inL ? '<button class="cust on" style="background:' + cur + '" data-set="' + p + '" data-v="' + cur + '" title="Cor atual: ' + cur + '" aria-label="Cor atual ' + cur + '"></button>' : '';
    return '<div class="sw">' + cust + (none ? '<button class="none' + (!v || v === 'none' ? ' on' : '') + '" data-set="' + p + '" data-v="none" title="Sem cor"></button>' : '') + L.map(function (o) { var c = String(o[0]); return '<button style="background:' + c + '" class="' + (cur === c.toUpperCase() ? 'on' : '') + '" data-set="' + p + '" data-v="' + c + '" title="' + esc(o[1] === c ? c : o[1] + ' · ' + c) + '"></button>'; }).join('') +
      '<button type="button" class="more" data-cpick="' + p + '" data-cv="' + (HEXC.test(cur) ? cur : '') + '" title="Mais cores…" aria-label="Mais cores…" aria-haspopup="dialog"></button></div>';
  }
  /* campo 'sel:#hex=Nome|…' de componente em que todas as opções são cores: vira amostras + “Mais cores…” (qualquer cor) */
  function colorOpts(t) { var o = t.indexOf('sel:') === 0 ? t.slice(4).split('|').map(function (x) { return x.split('='); }) : null; return o && o.length && o.every(function (x) { return HEXC.test(x[0]); }) ? o : null; }
  /* 'colors:N' (gráficos): N cores de série em data.colors (posição vazia = cor A&M do gráfico). f[3] = nomes fixos ou a chave da lista
     cujos .t nomeiam as séries; FX.cols(d) = cores efetivas. “Cores A&M” apaga data.colors */
  var QUICK = [['#002A46', 'Navy'], ['#13315C', 'Azul profundo'], ['#4A6FA5', 'Azul-aço'], ['#7EA1C3', 'Aço claro'], ['#A3B8D6', 'Gelo azulado'], ['#F78C16', 'Laranja'], ['#3E4C5E', 'Grafite'], ['#FFFFFF', 'Branco']];
  function colorsField(el, f) {
    var F = RT.FX[el.kind], d = el.data || {}, n = Math.max(1, Math.min(6, +f[2].split(':')[1] || 1)), eff = F.cols ? F.cols(d) : [], nm = f[3], names;
    if (Array.isArray(nm)) names = nm.slice(0, n);
    else { var rows = Array.isArray(d[nm]) ? d[nm] : []; names = rows.slice(0, n).map(function (r, k) { return (r && typeof r.t === 'string' && r.t.trim()) || 'Série ' + (k + 1); }); if (!names.length) names = ['Série 1']; }
    var u = Array.isArray(d.colors) ? d.colors : [], custom = u.some(function (c) { return HEXC.test(c || ''); });
    /* a cor que o gráfico desenha: a escolhida (exata, também com “Cores do componente”) ou a padrão — que, com el.pal, vira o tom da paleta */
    var shown = eff.map(function (c, k) { return HEXC.test(u[k] || '') ? String(u[k]).toUpperCase() : el.pal && RT.pal && HEXC.test(c || '') ? RT.pal.map(c, el.pal) : c; });
    return '<div class="cser-w"><span class="pf"><span>' + esc(f[1]) + '</span></span>' + names.map(function (t, k) {
      return '<div class="cser"><span class="cser-n"><i style="background:' + (HEXC.test(shown[k] || '') ? shown[k] : '#FFFFFF') + '"></i>' + esc(t) + '</span>' + swatches('data.colors.' + k, shown[k], false, QUICK) + '</div>';
    }).join('') + (el.pal ? '<p class="note cser-pal">Com “Cores do componente”, as séries sem cor própria seguem a cor principal; uma cor escolhida aqui fica exatamente como foi escolhida.</p>' : '') + '<div class="row r1"><button type="button" class="btnw" data-act="colors-reset"' + (custom ? '' : ' disabled') + ' title="Volta às cores padrão do gráfico (paleta A&amp;M)">Cores A&amp;M</button></div></div>';
  }
  function seg(p, v, opts) { return '<div class="seg">' + opts.map(function (o) { return '<button class="' + (String(o[0]) === String(v) ? 'on' : '') + '" data-set="' + p + '" data-v="' + o[0] + '" title="' + (o[2] || o[1]) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
  /* alinhamento vertical; no card “Cabeçalho” o título fica sempre na faixa do alto, então os botões aparecem desativados */
  function vaSeg(el) {
    var hd = el.type === 'shape' && el.look === 'header' && /^(rect|round|pill)$/.test(el.shape || 'rect'), t = 'No Cabeçalho, o título fica sempre na faixa do alto';
    var h = seg('valign', hd ? 'top' : el.valign || (el.type === 'shape' ? 'middle' : 'top'), [['top', svgI('va-t'), 'Texto no topo'], ['middle', svgI('va-m'), 'Texto no meio'], ['bottom', svgI('va-b'), 'Texto na base']]);
    return hd ? h.replace('<div class="seg"', '<div class="seg va-off" title="' + t + '"').replace(/<button /g, '<button disabled ').replace(/ title="[^"]*"(?=>)/g, ' title="' + t + '"') : h;
  }
  function tog(p, v, label) { return '<button class="chip' + (v ? ' on' : '') + '" data-set="' + p + '" data-v="' + (v ? '0' : '1') + '" data-b="1">' + label + '</button>'; }
  var ICONS = {
    dup: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    front: '<svg viewBox="0 0 24 24"><path d="M14 9.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h5.5"/><rect class="fl" x="10" y="10" width="11" height="11" rx="1.5"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path class="fl" d="M4 3h9a1 1 0 0 1 1 1v6h-4v4H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><rect x="10" y="10" width="11" height="11" rx="1.5"/></svg>'
  };
  /* ícones de linha (menus, alinhamento) */
  var IC = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
    import: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    find: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>', crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    grp: '<rect x="3" y="3" width="9" height="9" rx="1.5"/><rect x="12" y="12" width="9" height="9" rx="1.5"/><path d="M3 16v5h5M21 8V3h-5" stroke-dasharray="2 2"/>', ungrp: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M13 7l3-3M7 13l-3 3"/>',
    brush: '<path d="M14 3l7 7-9 9H5v-7z"/><path d="M5 12l7 7"/>', brushp: '<path d="M14 3l7 7-9 9H5v-7z"/><path d="M5 12l7 7"/><path d="M17 19h4M19 17v4"/>', layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    num: '<rect x="3" y="4" width="18" height="16" rx="2"/><text x="12.5" y="17" class="tl" font-size="9">7</text>', 'num-tl': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="7" cy="8" r="1.8" fill="currentColor"/>', 'num-tr': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="17" cy="8" r="1.8" fill="currentColor"/>', 'num-bl': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="7" cy="16" r="1.8" fill="currentColor"/>', 'num-br': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="17" cy="16" r="1.8" fill="currentColor"/>',
    bold: '<text x="6.5" y="17.5" class="tl" font-weight="800">B</text>', italic: '<text x="8.5" y="17.5" class="tl" font-style="italic">I</text>', underline: '<text x="6.5" y="16" class="tl">U</text><path d="M6 20h12"/>', strike: '<text x="7" y="17.5" class="tl">S</text><path d="M5 12h14"/>',
    sizeup: '<text x="3" y="18" class="tl" font-size="14">A</text><path d="M16 5v8M12 9h8"/>', sizedown: '<text x="3" y="18" class="tl" font-size="11">A</text><path d="M13 11h8"/>', fcolor: '<text x="6" y="15" class="tl">A</text><path d="M4 20h16" stroke-width="3"/>', hilite: '<path d="M9 15l-4 4h6l1-1"/><path d="M14 4l6 6-8 8-6-6z"/><path d="M4 21h16"/>',
    bullets: '<circle cx="5" cy="7" r="1.6" fill="currentColor"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="5" cy="17" r="1.6" fill="currentColor"/><path d="M10 7h10M10 12h10M10 17h10"/>', numbered: '<text x="2.5" y="9.5" class="tl" font-size="8">1</text><text x="2.5" y="19.5" class="tl" font-size="8">2</text><path d="M10 7h10M10 12h10M10 17h10"/>',
    alignl: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', alignc: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', alignr: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>', clearfmt: '<text x="4" y="17" class="tl">T</text><path d="M14 14l6 6M20 14l-6 6"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
    open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    playcur: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M10 8.5l5 2.5-5 2.5z"/><path d="M8 21h8"/>',
    reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    cut: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.2 16L18 4M15.8 16L6 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h4"/>',
    dup: '<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>',
    all: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    clear: '<path d="M7 21h13"/><path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L11 18H8z"/><path d="M10 11l4 4"/>',
    title: '<path d="M6 4v16M18 4v16M6 12h12"/>',
    sub: '<path d="M4 7h16M4 12h11M4 17h7"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    shape: '<rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="16" cy="16" r="5"/>',
    line: '<path d="M4 20L20 4"/>',
    arrow: '<path d="M4 20L19 5M10 5h9v9"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6"/>',
    brand: '<path d="M5 20L12 4l7 16M12 4v16"/>',
    models: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/>',
    fx: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    slide: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M12 9v5M9.5 11.5h5"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    front: '<path d="M14 9.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h5.5"/><rect class="fl" x="10" y="10" width="11" height="11" rx="1.5"/>',
    back: '<path class="fl" d="M4 3h9a1 1 0 0 1 1 1v6h-4v4H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><rect x="10" y="10" width="11" height="11" rx="1.5"/>',
    'ta-l': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', 'ta-c': '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', 'ta-r': '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>', 'ta-j': '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    'va-t': '<path d="M4 4h16"/><path d="M8 9h8M8 13h5"/>', 'va-m': '<path d="M4 4h16M4 20h16" opacity=".35"/><path d="M8 10h8M8 14h5"/>', 'va-b': '<path d="M4 20h16"/><path d="M8 11h8M8 15h5"/>',
    top: '<path d="M4 3h16"/><rect x="7" y="7" width="10" height="13" rx="1"/><path d="M12 11v5M10 13l2-2 2 2"/>',
    bottom: '<path d="M4 21h16"/><rect x="7" y="4" width="10" height="13" rx="1"/><path d="M12 8v5M10 11l2 2 2-2"/>',
    'al-l': '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
    'al-c': '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
    'al-r': '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
    'al-t': '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
    'al-m': '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
    'al-b': '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
    'dist-h': '<path d="M3 3v18M21 3v18"/><rect x="9" y="7" width="6" height="10" rx="1"/>',
    'dist-v': '<path d="M3 3h18M3 21h18"/><rect x="7" y="9" width="10" height="6" rx="1"/>',
    keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5M12 17h.01"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    texthere: '<path d="M4 7V5h11v2M9.5 5v13M7 18h5"/><path d="M18 13v7M14.5 16.5h7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    obras: '<path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M3 4h18v4H3z"/><path d="M10 12h4"/>',
    icons: '<rect x="3" y="7" width="14" height="14" rx="3.5"/><path d="M6.8 14.2l2.3 2.3 4.4-4.6"/><path d="M19.5 2.5v4.5M17.25 4.75h4.5"/>',
    chart: '<path d="M4 20h16"/><path d="M6 16v-5M11 16V6M16 16v-8"/><path d="M20 4l-4 4"/>',
    zoom: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
    flip: '<path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/>',
    /* girar e inverter (barra do quadro, painel, menu de contexto) */
    'rot-l': '<path d="M4.5 12.5a7.5 7.5 0 1 0 2.2-5.8"/><path d="M4.5 3.5v4.5H9"/><rect x="9.5" y="10" width="5" height="5" rx="1"/>',
    'rot-r': '<path d="M19.5 12.5a7.5 7.5 0 1 1-2.2-5.8"/><path d="M19.5 3.5v4.5H15"/><rect x="9.5" y="10" width="5" height="5" rx="1"/>',
    'flip-h': '<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M9 6.5L3 17.5h6z"/><path class="fl" d="M15 6.5l6 11h-6z"/>',
    'flip-v': '<path d="M3 12h18" stroke-dasharray="2 2.4"/><path d="M6.5 9L17.5 3v6z"/><path class="fl" d="M6.5 15l11 6v-6z"/>',
    'rot-0': '<path d="M3 20h18"/><rect x="6" y="9" width="12" height="8" rx="1.5"/><path d="M12 3v3"/>',
    side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    persona: '<path d="M12 3c4.4 0 7 3.6 7 8.5V16c0 2.5-3 4-7 4s-7-1.5-7-4v-4.5C5 6.6 7.6 3 12 3z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/><path d="M9.5 14.5c1.5 1.2 3.5 1.2 5 0"/>', bubble: '<path d="M4 5h16v10h-9l-4 4v-4H4z"/>',
    note: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    csv: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/><path d="M4 4l16 16"/>',
    vote: '<path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
    smart: '<rect x="3" y="9" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M9 12h3M12 12V5.5h3M12 12v6.5h3"/>',
    /* S21: slide oculto / reexibir / redefinir slide */
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 8.5 4.3 9.5 7-.4 1-1.1 2.2-2.1 3.3M6.6 6.6C4.6 7.9 3.2 9.9 2.5 12c1 2.7 4.5 7 9.5 7 1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    eye: '<path d="M2.5 12C3.5 9.3 7 5 12 5s8.5 4.3 9.5 7c-1 2.7-4.5 7-9.5 7s-8.5-4.3-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
    slreset: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M9 10.5a3.2 3.2 0 1 0 1-2.3"/><path d="M9 6.5v2.2h2.2"/>',
    /* S22: Salvar como… (HTML, PDF, PDF pelo navegador, PowerPoint) */
    html: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5"/>',
    pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h2.2a1.3 1.3 0 0 1 0 2.6H8V13zm0 2.6V18M13.4 13v5h1a2.5 2.5 0 0 0 0-5h-1z"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    ppt: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="M9.5 13V7.5h2.3a1.8 1.8 0 0 1 0 3.6H9.5"/>'
  };
  function svgI(k, cls) { return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + '>' + (IC[k] || '') + '</svg>'; }
  var ALIGNS = [['al-l', 'Alinhar à esquerda'], ['al-c', 'Centralizar na horizontal'], ['al-r', 'Alinhar à direita'], ['al-t', 'Alinhar ao topo'], ['al-m', 'Centralizar na vertical'], ['al-b', 'Alinhar à base']];
  /* linha “Girar e inverter” do painel (girar 90°, espelhar e, fora das linhas, zerar a rotação) */
  function frRow(list, zero) { return '<span class="pf frlbl"><span>Girar e inverter</span></span><div class="seg ic frseg" role="group" aria-label="Girar e inverter">' + frBtns(list, 'data-act', zero) + '</div>'; }
  function alignSeg() { return '<div class="seg ic">' + ALIGNS.map(function (a) { return '<button data-act="' + a[0] + '" title="' + a[1] + '">' + svgI(a[0]) + '</button>'; }).join('') + '</div>'; }
  var TYPE_NAME = { text: 'Texto', shape: 'Forma', line: 'Linha / seta', image: 'Imagem' };
  /* nome do elemento: fx usa AMRT.fxLabel (FX.kind.label(el) opcional, ex. “SmartArt · Processo”, senão o nome do modelo) — o mesmo do rodapé do “Ampliar” */
  function elName(e) { var ic = e.kind === 'icon' && RT.iconFind && RT.iconFind(e.data && e.data.name); return ic ? 'Ícone · ' + ic.n.split(' /')[0] : e.type === 'fx' ? (RT.fxLabel ? RT.fxLabel(e) : ((RT.FX[e.kind] || {}).name || 'Elemento')) : (TYPE_NAME[e.type] || 'Elemento'); }
  /* vocabulário de animações: vem do runtime (AMRT.ANIMS), o mesmo que o player e a vitrine de efeitos usam */
  var ANIM_TIP = {}, ANIM_ONLY = {}, ANIM_IN = RT.ANIMS.in.map(function (a) { ANIM_TIP[a[0]] = a[2] || ''; return [a[0], a[1]]; });
  Object.keys(RT.ANIMS).forEach(function (f) { RT.ANIMS[f].forEach(function (a) { if (a[4]) ANIM_ONLY[f + ':' + a[0]] = a[4]; }); });
  /* traço desenhável: “Desenhar” vale para linhas, setas, Linhas A&M e ícones animados (cada traço do ícone se desenha);
     “Fluxo contínuo” (tracejado andando) só para linhas e Linhas A&M */
  function isStroke(el) { return !!el && (el.type === 'line' || el.kind === 'amlines'); }
  function isIcon(el) { return !!el && el.type === 'fx' && (el.kind === 'icon' || el.kind === 'iconmorph'); }
  function canDraw(el) { return isStroke(el) || isIcon(el); }
  /* o efeito f:k serve para este elemento? ('ln' = só traços, 'tx' = só textos e formas com texto) */
  function hasText(el) { return el.type === 'text' || (el.type === 'shape' && /\S/.test(String(el.html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' '))); }
  function animFits(el, f, k) { var o = ANIM_ONLY[f + ':' + k]; return !o || (o === 'ln' ? (f === 'in' ? canDraw(el) : isStroke(el)) : o === 'tx' ? hasText(el) : true); }
  var ONLY_MSG = { ln: 'funciona em linhas, setas e Linhas A&M', lnIn: 'funciona em linhas, setas, Linhas A&M e ícones animados', tx: 'funciona em textos e formas com texto' };
  function onlyMsg(it) { return ONLY_MSG[it.only === 'ln' && it.fam === 'in' ? 'lnIn' : it.only]; }
  var holdProps = false;
  function animChips(el, f, v) { return RT.ANIMS[f].filter(function (o) { return o[0] === 'none' || animFits(el, f, o[0]) || o[0] === v; }).map(function (o) { return '<button class="chip' + ((v || 'none') === o[0] ? ' on' : '') + '" data-set="anim.' + f + '" data-v="' + o[0] + '" title="' + esc(o[2] || '') + '">' + esc(o[1]) + '</button>'; }).join(''); }
  function renderProps() { renderPropsBody(); galSync(); }
  function renderPropsBody() {
    if (holdProps) return;
    var p = $('#props'), el = sel(), s = slide(), h = '', list = sels();
    if (list.length > 1) {
      var n3 = list.length >= 3;
      var sameGrp = list.every(function (e) { return e.grp && e.grp === list[0].grp; });
      h += '<div class="ph"><h2>' + (sameGrp ? 'Grupo · ' : '') + list.length + ' elementos selecionados<small>Shift+clique soma ou retira da seleção · Esc limpa</small></h2></div>' +
        '<div class="sec"><h3>Grupo e bloqueio</h3><div class="chips">' + (sameGrp ? '<button type="button" class="chip" data-act="ungroup" title="Desagrupar (Ctrl+Shift+G)">Desagrupar</button>' : '<button type="button" class="chip" data-act="group" title="Agrupar (Ctrl+G)">Agrupar</button>') + '<button type="button" class="chip" data-act="lock" title="Bloquear/desbloquear (Ctrl+Shift+L)">' + (list.every(isLocked) ? 'Desbloquear' : 'Bloquear') + '</button><button type="button" class="chip" data-act="fmtpaste" title="Colar formato (Ctrl+Alt+V)"' + (fmtClip ? '' : ' disabled') + '>Colar formato</button></div></div>';
      h += '<div class="sec"><h3>Seleção</h3><div class="msel">' + list.map(function (e) { return '<span><i></i>' + esc(elName(e)) + '</span>'; }).join('') + '</div></div>';
      h += '<div class="sec"><h3>Alinhar entre si</h3>' + alignSeg() + '<p class="note">Com vários elementos, o alinhamento usa os limites da seleção.</p></div>';
      h += '<div class="sec"><h3>Distribuir</h3><div class="row"><button class="btnw ic" data-act="dist-h"' + (n3 ? '' : ' disabled') + '>' + svgI('dist-h') + 'Horizontal</button><button class="btnw ic" data-act="dist-v"' + (n3 ? '' : ' disabled') + '>' + svgI('dist-v') + 'Vertical</button></div><p class="note">' + (n3 ? 'Deixa o mesmo espaço entre os elementos, mantendo os das pontas no lugar.' : 'Selecione 3 ou mais elementos para distribuir.') + '</p></div>';
      h += '<div class="sec"><h3>Girar e inverter</h3><div class="seg ic frseg" role="group" aria-label="Girar e inverter">' + frBtns(list, 'data-act', hasRot(list)) + '</div><p class="note">Cada elemento gira ou espelha no próprio lugar.</p></div>';
      h += '<div class="sec"><h3>Organizar</h3><div class="seg ic">' + [['front', 'Trazer para frente'], ['back', 'Enviar para trás'], ['top', 'Trazer ao topo'], ['bottom', 'Enviar ao fundo']].map(function (a) { return '<button data-act="' + a[0] + '" title="' + a[1] + '">' + svgI(a[0]) + '</button>'; }).join('') + '</div></div>';
      h += '<div class="sec"><h3>Ações</h3><div class="row"><button class="btnw ic" data-act="dup">' + svgI('dup') + 'Duplicar</button><button class="btnw ic" data-act="del">' + svgI('del') + 'Apagar</button></div><div class="row"><button class="btnw ic" data-act="copy">' + svgI('copy') + 'Copiar</button><button class="btnw ic" data-act="cut">' + svgI('cut') + 'Recortar</button></div><div class="row r1"><button class="btnw ic" data-act="seqsel">' + svgI('fx') + 'Animar a seleção em sequência</button></div></div>';
      h += '<div class="empty">Arraste qualquer elemento da seleção para mover o grupo; use as <b>setas</b> para ajustes finos (Shift = 10 px).</div>';
      p.innerHTML = h; return;
    }
    if (!el) {
      var SC = RT.sectionsOf(deck), scn = SC.secOf[cur] != null ? SC.list[SC.secOf[cur]] : null;
      var nVis = deck.slides.filter(function (x) { return x.hidden !== true; }).length;
      h += '<div class="ph"><h2>Slide ' + (cur + 1) + '<small>' + plural(s.els.length, 'elemento', 'elementos') + ' · ' + (nVis === deck.slides.length ? plural(deck.slides.length, 'slide', 'slides') + ' na apresentação' : plural(deck.slides.length, 'slide', 'slides') + ' · ' + nVis + ' na apresentação') + (scn && !scn.intro ? ' · capítulo “' + esc(scn.name) + '”' : '') + '</small></h2></div>';
      h += showSec(s); /* S21: ocultar e redefinir logo no topo (cabem sem rolar a 1280×720) */
      h += numSec(); /* S27 */
      if (hasInst()) h += '<div class="sec"><h3>Slides institucionais A&amp;M</h3><div class="row r1"><button class="btnw pri ic" data-act="inst">' + svgI('brand') + 'Inserir os 5 slides institucionais</button></div><p class="note">Capa “Somos a A&amp;M Performance”, presença global, clientes, esferas de atuação e cadeia de valor, no padrão oficial, logo depois deste slide. Um Ctrl+Z tira o bloco.</p></div>'; /* S34b: logo abaixo de Exibição e layout, à vista sem rolar */
      h += '<div class="sec"><h3>Sobre este slide</h3>' +
        '<div class="row r1">' + fld('Título no índice', '<input type="text" data-p="s.title" maxlength="160" value="' + esc(s.title || '') + '" placeholder="' + esc(RT.slideTitle(s, cur)) + '">') + '</div>' +
        '<div class="row r1">' + fld('Capítulo (botão da linha do tempo)', '<input type="text" data-p="s.sec" maxlength="80" value="' + esc(s.sec || '') + '" placeholder="' + esc(scn && !scn.intro && !s.sec ? 'herda “' + scn.name + '”' : 'ex.: Contexto, Cultura, Benchmarks') + '">') + '</div>' +
        '<div class="row r1">' + fld('Resumo do slide', '<textarea data-p="s.notes" maxlength="4000" style="min-height:96px" placeholder="O que o público precisa saber sobre este slide">' + esc(s.notes || '') + '</textarea>') + '</div>' +
        '<div class="row r1"><button class="btnw ic" data-act="autonotes">' + svgI('fx') + 'Gerar resumo automático</button></div><div class="row r1"><button class="btnw ic" data-act="viewnotes">' + svgI('zoom') + 'Ver na apresentação</button></div>' +
        '<p class="note">Na apresentação e no arquivo salvo, <b>Sobre este slide</b> (tecla <b>I</b>) mostra este resumo' + (s.notes ? '' : ' — sem texto, o apresentador gera um automático') + '; <b>G</b> abre o índice com todos os slides; o capítulo vira um botão da linha do tempo e vale até o próximo capítulo.</p></div>';
      h += '<div class="sec"><h3>Fundo</h3>' + swatches('s.bg', s.bg) + '<div class="row" style="margin-top:10px"><button class="btnw" data-act="bgimg">' + (s.bgImg ? 'Trocar imagem de fundo' : 'Imagem de fundo…') + '</button><button class="btnw ic" data-act="brandkit" title="Cores e fonte desta apresentação">' + svgI('palette') + 'Kit de marca…</button></div>' + (s.bgImg ? '<div class="row">' + fld('Opacidade da imagem', num('s.bgImgOp', s.bgImgOp == null ? 1 : s.bgImgOp, .05, 0, 1)) + '<label class="pf"><span>&nbsp;</span><button class="btnw" data-act="bgimgdel">Remover</button></label></div>' : '') + '</div>';
      h += '<div class="sec"><h3>Transição ao entrar</h3><div class="chips">' + RT.ANIMS.tr.map(function (o) { return '<button class="chip' + ((s.tr || 'fade') === o[0] ? ' on' : '') + '" data-set="s.tr" data-v="' + o[0] + '" title="' + esc(o[2] || '') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div><div class="row r1" style="margin-top:10px"><button class="btnw ic" data-act="gallery-tr">' + svgI('models') + 'Ver transições em caixas</button></div></div>';
      h += '<div class="sec"><h3>Animações do slide</h3><div class="row r1"><button class="btnw pri" data-act="seq">Animar elementos em sequência</button></div><div class="row r1"><button class="btnw" data-act="noanim">Remover animações</button></div><p class="note">“Em sequência” faz os elementos entrarem um a um, de cima para baixo, como numa apresentação de consultoria.</p></div>';
      h += '<div class="empty">Monte o slide peça por peça: use o menu <b>Inserir</b> ou a barra de ferramentas (<b>Texto</b>, <b>Formas</b>, <b>Imagem</b>, <b>Modelos</b>…). <b>Duplo clique</b> no vazio cria uma caixa de texto; <b>clique direito</b> abre o menu de opções; arraste no vazio para selecionar vários elementos. Atalhos: <b>F1</b>.</div>';
      h += layersSec(s); /* S27: camadas (fim do painel do slide) */
      p.innerHTML = h; return;
    }
    var name = elName(el);
    h += '<div class="ph"><h2>' + esc(name) + (isLocked(el) ? ' <span class="lkt">bloqueado</span>' : '') + '<small>' + (el.type === 'text' || el.type === 'shape' ? 'Duplo clique para escrever' : el.type === 'fx' ? 'Edite o conteúdo nos campos abaixo' : '&nbsp;') + '</small></h2><div class="ib"><button data-act="front" title="Trazer para frente">' + ICONS.front + '</button><button data-act="back" title="Enviar para trás">' + ICONS.back + '</button><button data-act="dup" title="Duplicar">' + ICONS.dup + '</button><button class="del" data-act="del" title="Apagar">' + ICONS.del + '</button></div></div>' +
      '<div class="sec s27"><div class="chips"><button type="button" class="chip' + (isLocked(el) ? ' on' : '') + '" data-act="lock" title="' + (isLocked(el) ? 'Desbloquear (Ctrl+Shift+L)' : 'Bloquear: não move, não redimensiona, não apaga (Ctrl+Shift+L)') + '" aria-pressed="' + (isLocked(el) ? 'true' : 'false') + '">' + svgI(isLocked(el) ? 'lock' : 'unlock') + (isLocked(el) ? 'Bloqueado' : 'Bloquear') + '</button><button type="button" class="chip" data-act="fmtcopy" title="Copiar formato (Ctrl+Alt+C)">' + svgI('brush') + 'Copiar formato</button><button type="button" class="chip" data-act="fmtpaste" title="Colar formato (Ctrl+Alt+V)"' + (fmtClip ? '' : ' disabled') + '>' + svgI('brushp') + 'Colar formato</button><button type="button" class="chip" data-act="layers" title="Ver as camadas do slide">' + svgI('layers') + 'Camadas</button></div></div>';
    var FD = el.type === 'fx' ? RT.FX[el.kind] : null, h0 = h; /* ícone: Conteúdo (qual ícone) vem antes da lista de movimentos */
    if (FD && FD.variants) {
      var cv = el.variant || FD.variant, cvd = FD.variants.find(function (x) { return x[0] === cv; }) || FD.variants[0];
      h += '<div class="sec"><h3>' + esc(FD.vtitle || 'Efeito do modelo') + '</h3><div class="chips">' + FD.variants.map(function (o) { return '<button class="chip' + (o[0] === cv ? ' on' : '') + '" data-var="' + o[0] + '" title="' + esc(o[2] || '') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div><p class="note">' + esc(cvd[2]) + '</p><div class="row r1" style="margin-top:8px"><button class="btnw pri" data-act="pvel">▶ Ver ' + (FD.gal === 'icon' ? 'movimento' : 'efeito') + ' no slide</button></div>' + (FD.gal === 'icon' ? '<div class="row r1"><button class="btnw ic" data-act="gallery-icon">' + svgI('models') + 'Comparar os movimentos em caixas</button></div>' : '') + (FD.tip ? '<p class="vtip">' + esc(FD.tip) + '</p>' : '') + '</div>';
    }
    if (el.type === 'fx') {
      h += '<div class="sec"><h3>Conteúdo</h3>' + RT.FX[el.kind].fields.map(function (f) {
        var k = 'data.' + f[0], v = el.data[f[0]], t = f[2] || 'text';
        if (t === 'help') return '<div class="note fhelp">' + f[1] + '</div>'; /* S30: texto de ajuda do componente (HTML do registro, sem campo) */
        if (t === 'lines') return '<div class="row r1">' + fld(f[1], '<textarea data-p="' + k + '" data-codec="lines">' + esc((Array.isArray(v) ? v : String(v || '').split(/\n/)).join('\n')) + '</textarea>') + '</div>';
        if (t.indexOf('rows:') === 0) return '<div class="row r1">' + fld(f[1], '<textarea data-p="' + k + '" data-codec="' + t + '" style="min-height:120px">' + esc(rowsToText(v, t.slice(5))) + '</textarea>') + '</div>';
        if (t === 'number') return '<div class="row r1">' + fld(f[1], num(k, v, 'any')) + '</div>';
        if (t === 'area') return '<div class="row r1">' + fld(f[1], area(k, v)) + '</div>';
        var co = colorOpts(t); if (co) return '<div class="cfld"><span class="pf"><span>' + esc(f[1]) + '</span></span>' + swatches(k, v, false, co) + '</div>';
        if (t.indexOf('colors:') === 0) return colorsField(el, f);
        if (t.indexOf('sel:') === 0) return '<div class="row r1">' + fld(f[1], selIn(k, v, t.slice(4).split('|').map(function (o) { return o.split('='); }))) + '</div>';
        if (t === 'icon') return '<div class="row r1">' + iconField(k, v) + '</div>';
        if (t === 'outline' || t.indexOf('outline:') === 0) { /* 'outline:3' = até 3 níveis abaixo; FD.outlineText = codec próprio do modelo (árvore de problemas: “ = valor”, “[*]”) */
          var mxl = Math.max(1, Math.min(6, +t.split(':')[1] || 2)), otx = FD.outlineText ? FD.outlineText(v) : RT.smartText ? RT.smartText(v) : (Array.isArray(v) ? v.map(function (o) { return o && o.t; }).join('\n') : String(v || ''));
          return '<div class="row r1">' + fld(f[1], '<textarea class="outl" data-p="' + k + '" data-codec="outline" data-maxlv="' + mxl + '" spellcheck="false" style="min-height:150px">' + esc(otx) + '</textarea>') + '<p class="note outl-h"><b>Tab</b> / <b>Shift+Tab</b> mudam o nível da linha' + (mxl > 2 ? ' (até ' + mxl + ')' : '') + ' · <b>Enter</b> mantém o recuo · duplo clique num texto do slide edita no lugar.</p></div>';
        }
        if (t === 'smartlayout') return smartLayoutField(k, v);
        return '<div class="row r1">' + fld(f[1], txtIn(k, v)) + '</div>';
      }).join('') + (FD.model ? '<div class="chips">' + tog('data.panel', el.data.panel === 'white', 'Painel branco (para fundo escuro)').replace('data-v="1"', 'data-v="white"').replace('data-v="0"', 'data-v=""').replace(' data-b="1"', '') + '</div>' : '') + '</div>';
      if (palOk(el)) h += palSec(el);
    }
    if (FD && FD.gal === 'icon') { var hv = h.slice(h0.length), ci = hv.indexOf('<div class="sec"><h3>Conteúdo</h3>'); if (ci > 0) h = h0 + hv.slice(ci) + hv.slice(0, ci); }
    if (el.type === 'line') {
      h += '<div class="sec"><h3>Posição</h3><div class="row r4">' + fld('X1', num('x1', el.x1)) + fld('Y1', num('y1', el.y1)) + fld('X2', num('x2', el.x2)) + fld('Y2', num('y2', el.y2)) + '</div>' + frRow([el], false) + '</div>';
      h += linkSec(el); /* S32 */
      h += RT.LINE_ROUTES ? lineSec(el) : '<div class="sec"><h3>Linha</h3>' + swatches('stroke', el.stroke) + '<div class="row" style="margin-top:10px">' + fld('Espessura', num('strokeW', el.strokeW, 1, 1, 40)) + '<label class="pf"><span>&nbsp;</span>' + tog('dash', el.dash, 'Tracejada') + '</label></div><div class="chips">' + tog('headStart', el.headStart, '← Seta no início') + tog('headEnd', el.headEnd, 'Seta no fim →') + '</div></div>';
    } else {
      h += '<div class="sec"><h3>Posição e tamanho</h3><div class="row r4">' + fld('X', num('x', el.x)) + fld('Y', num('y', el.y)) + fld('Largura', num('w', el.w, 1, 8)) + fld('Altura', num('h', el.h, 1, 8)) + '</div><div class="row">' + fld('Rotação (°)', num('rot', el.rot || 0, 1, -360, 360)) + fld('Opacidade', num('opacity', el.opacity == null ? 1 : el.opacity, .05, 0, 1)) + '</div>' + frRow([el], true) + '<h3 style="margin-top:6px">Alinhar no slide</h3>' + alignSeg() + '</div>';
    }
    if (el.type === 'shape') {
      var cardOk = LOOKS.length > 1 && (!el.shape || /^(rect|round|pill)$/.test(el.shape)), lk = el.look || 'flat';
      h += '<div class="sec"><h3>Forma</h3><div class="row r1">' + fld('Tipo', shapeSel(el.shape)) + '</div>' +
        (cardOk ? '<span class="pf"><span>Estilo do card</span></span><div class="lkg" role="group" aria-label="Estilo do card">' + LOOKS.map(function (l) { return '<button type="button" class="' + (l[0] === lk ? 'on' : '') + '" data-act="look-' + l[0] + '" title="' + esc(l[1] + ': ' + l[3]) + '" aria-pressed="' + (l[0] === lk) + '">' + lookSvg(l[0]) + '<span>' + esc(l[2]) + '</span></button>'; }).join('') + '</div>' + (lk === 'header' ? '<p class="note" style="margin:0 0 10px">O texto da forma vai na faixa azul-marinho, que cresce com o título. Para o corpo do card, use uma caixa de texto por cima.</p>' : '') : '') +
        (isBrace(el.shape) ? '<span class="pf"><span>Cor do traço</span></span>' + swatches('stroke', el.stroke) + '<div class="row" style="margin-top:10px">' + fld('Espessura do traço', num('strokeW', Math.max(3, +el.strokeW || 0), 1, 3, 40)) + '</div><div class="chips">' + tog('shadow', el.shadow, 'Sombra') + tog('dash', el.dash, 'Tracejado') + '</div></div>'
          : '<span class="pf"><span>Preenchimento</span></span>' + (cardOk && LOOK_FILL[lk] ? '<p class="note lk-fill" style="margin:0">Definido pelo estilo “' + esc(LOOKS.filter(function (l) { return l[0] === lk; }).map(function (l) { return l[2]; })[0] || lk) + '”. Para escolher a cor, use Chapado, Barra lateral, Barra no topo ou Cabeçalho.</p>' : swatches('fill', el.fill, true)) + '<span class="pf" style="margin-top:10px"><span>Contorno</span></span>' + swatches('stroke', el.stroke) + '<div class="row" style="margin-top:10px">' + fld('Espessura do contorno', num('strokeW', el.strokeW, 1, 0, 40)) + fld('Arredondamento', num('radius', el.radius, 1, 0, 400)) + '</div>' + wSeg(el.strokeW, 'sw-') + '<div class="chips">' + tog('shadow', el.shadow, 'Sombra') + tog('dash', el.dash, 'Contorno tracejado') + '</div></div>');
    }
    if (el.type === 'text' || el.type === 'shape') {
      h += '<div class="sec"><h3>Texto</h3>' + (el.type === 'text' ? '<div class="chips" style="margin-bottom:10px">' + ['title', 'subtitle', 'body', 'eyebrow'].map(function (k) { return '<button class="chip" data-act="preset-' + k + '">' + { title: 'Título', subtitle: 'Subtítulo', body: 'Corpo', eyebrow: 'Rótulo' }[k] + '</button>'; }).join('') + '</div>' : '') +
        '<div class="row">' + fld('Fonte', selIn('font', el.font, fontOpts(el.font))) + fld('Tamanho', num('size', el.size, 1, 6, 400)) + '</div>' +
        '<div class="row r1">' + seg('weight', el.weight || 400, [[300, 'Leve'], [400, 'Normal'], [500, 'Médio'], [700, 'Negrito']]) + '</div>' +
        '<div class="row">' + seg('align', el.align || 'left', [['left', svgI('ta-l'), 'Alinhar à esquerda'], ['center', svgI('ta-c'), 'Centralizar'], ['right', svgI('ta-r'), 'Alinhar à direita'], ['justify', svgI('ta-j'), 'Justificar']]) + vaSeg(el) + '</div>' +
        '<div class="chips" style="margin-bottom:10px">' + tog('italic', el.italic, 'Itálico') + tog('upper', el.upper, 'CAIXA ALTA') + '</div>' +
        '<span class="pf"><span>Cor do texto</span></span>' + swatches('color', el.color) +
        '<div class="row" style="margin-top:10px">' + fld('Entrelinha', num('lh', el.lh || 1.2, .05, .8, 3)) + fld('Espaçamento', num('ls', el.ls || 0, .01, -.1, .5)) + '</div>' +
        (el.type === 'text' ? '<span class="pf"><span>Fundo do texto</span></span>' + swatches('bg', el.bg, true) + (el.bg && el.bg !== 'none' ? '<div class="row" style="margin-top:8px">' + fld('Arredondamento', num('radius', el.radius || 0, 1, 0, 200)) + '</div>' : '') : '') + '</div>';
    }
    if (el.type === 'image') {
      var cropOn = !!el.crop || cropOpen === el.id, cr = el.crop || { l: 0, t: 0, r: 0, b: 0 };
      h += '<div class="sec"><h3>Imagem</h3><div class="row r1">' + seg('fit', el.fit || 'cover', [['cover', 'Preencher'], ['contain', 'Inteira']]) + '</div><div class="row">' + fld('Arredondamento', num('radius', el.radius || 0, 1, 0, 400)) + '<label class="pf"><span>&nbsp;</span>' + tog('shadow', el.shadow, 'Sombra') + '</label></div>' +
        '<div class="row r1"><button class="btnw ic" data-act="crop" aria-expanded="' + cropOn + '" title="Recortar: escolha quanto tirar de cada lado; a foto original fica guardada">' + svgI('crop') + (cropOn ? 'Recortando…' : 'Recortar') + '</button></div>' +
        (cropOn ? '<div class="crop">' + [['l', 'Esquerda'], ['t', 'Topo'], ['r', 'Direita'], ['b', 'Base']].map(function (k) { return '<label class="pf"><span>' + k[1] + ' <em>' + Math.round((+cr[k[0]] || 0) * 100) + '%</em></span><input type="range" data-p="crop.' + k[0] + '" data-n="1" min="0" max="0.9" step="0.01" value="' + (+cr[k[0]] || 0) + '" aria-label="Recortar ' + k[1].toLowerCase() + '"></label>'; }).join('') +
          '<div class="chips"><button type="button" class="chip" data-act="crop-fit" title="Altura da caixa pela proporção da fatia (como o PowerPoint)">Ajustar à caixa</button><button type="button" class="chip" data-act="crop-none">Sem recorte</button></div><p class="note">O recorte vai para o PDF e para o PowerPoint; “Sem recorte” devolve a foto inteira.</p></div>' : '') +
        '<div class="row r1"><button class="btnw" data-act="replace">Trocar imagem…</button></div></div>';
    }
    if (el.type === 'fx') h += '<div class="sec"><h3>Cantos</h3><div class="row">' + fld('Arredondamento', num('radius', el.radius || 0, 1, 0, 200)) + '</div></div>';
    if (RT.zoomables && (el.type === 'image' || (el.type === 'fx' && FD && (FD.model || el.zoom === true)))) { /* ampliar (⤢) na apresentação: modelos, gráficos e imagens */
      var zOn = RT.zoomables({ els: [el] }).length > 0, zBig = el.w >= 160 && el.h >= 90;
      h += '<div class="sec"><h3>Ampliar na apresentação</h3><div class="chips">' + tog('zoom', zOn, '⤢ Permitir ampliar') + '</div><p class="note">' + (zOn ? 'Na apresentação, o público vê o botão ⤢ ao passar o mouse; duplo clique ou a tecla <b>Z</b> abrem o elemento ampliado e nítido.' : zBig ? 'Este elemento não oferece o botão ⤢ na apresentação.' : 'Elementos menores que 160 × 90 não são ampliados.') + '</p>' + (zOn ? '<div class="row r1"><button class="btnw ic" data-act="zoomview">' + svgI('zoom') + 'Ver ampliado na apresentação</button></div>' : '') + '</div>';
    }
    var a = el.anim || {};
    h += '<div class="sec"><h3>Animação</h3><div class="row r1">' + fld('Entrada', selIn('anim.in', a.in || 'none', ANIM_IN)) + '</div>' + (isIcon(el) && a.in === 'draw' ? '<span class="pf"><span>Velocidade do traço</span></span><div class="row r1" style="margin-top:4px">' + seg('anim.dur', a.dur || 900, [[500, 'Rápido', 'Rápido: 500 ms por traço'], [900, 'Normal', 'Normal: 900 ms por traço'], [1600, 'Lento', 'Lento: 1,6 s por traço']]) + '</div>' : '') + '<div class="row">' + fld('Atraso (ms)', num('anim.delay', a.delay || 0, 100, 0, 20000)) + fld('Duração (ms)', num('anim.dur', a.dur || 700, 100, 100, 10000)) + '</div>' +
      '<span class="pf"><span>Efeito contínuo</span></span><div class="chips" style="margin:4px 0 10px">' + animChips(el, 'loop', a.loop) + '</div>' +
      '<span class="pf"><span>Ao passar o mouse (na apresentação)</span></span><div class="chips" style="margin:4px 0 10px">' + animChips(el, 'hover', a.hover) + '</div>' +
      '<div class="row r1"><button class="btnw pri" data-act="preview">▶ Ver animação no slide</button></div><div class="row r1"><button class="btnw ic" data-act="gallery">' + svgI('models') + 'Ver todos os efeitos em caixas</button></div></div>';
    p.innerHTML = h;
    var ion = p.querySelector('.icf-g .on'); if (ion) ion.parentNode.scrollTop = ion.offsetTop - (ion.parentNode.clientHeight - ion.offsetHeight) / 2; /* o ícone atual no meio da grade (a grade é o offsetParent) */
  }
  /* “Cores do componente” (S20): el.pal = {p, a}; o runtime (rt-05-pal.js) troca o azul-marinho/azuis pela cor principal e o laranja
     pela de destaque, só neste elemento. Não vale para a Marca A&M nem para ícones (que já têm cores próprias) */
  function palOk(el) { var F = el && el.type === 'fx' && RT.FX[el.kind]; return !!(F && RT.palTag && F.cat !== 'Marca A&M' && !isIcon(el)); }
  /* S29: kit de marca — cada chamada é um passo de desfazer; devolvem o que ficou gravado / quantos elementos mudaram */
  function setBrand(b, msg) { var nb = safeBrand(b); if (editingId) endEdit(); flush(); if (nb) deck.brand = nb; else delete deck.brand; ensureFonts(); renderAll(); commit(); if (msg) toast(msg); return nb; }
  function fxHasFont(e) { var F = e.type === 'fx' && RT.FX[e.kind]; return !!(F && F.fields && F.fields.some(function (f) { return f[0] === 'font'; })); }
  function brandApplyFont(font) {
    font = typeof font === 'string' ? font.trim() : ''; if (!font || !TOKEN_RE.test(font)) return 0;
    if (editingId) endEdit(); flush(); var n = 0;
    deck.slides.forEach(function (s) { s.els.forEach(function (e) {
      if (e.type === 'text' || e.type === 'shape') {
        var h = typeof e.html === 'string' && /font-family/i.test(e.html) ? e.html.replace(/font-family\s*:[^;"']*;?/gi, '') : e.html; /* fontes de trechos (arquivo importado) saem: a fonte vale para o texto inteiro */
        if (e.font !== font || h !== e.html) { e.font = font; if (h !== e.html) e.html = h; n++; }
      } else if (fxHasFont(e)) { e.data = e.data || {}; if (e.data.font !== font) { e.data.font = font; n++; } }
    }); });
    if (n) { ensureFonts([font]); renderAll(); commit(); }
    return n;
  }
  function brandApplyPal(pal) {
    var nb = pal ? safePal(pal) : null, want = JSON.stringify(nb), n = 0; if (editingId) endEdit(); flush();
    deck.slides.forEach(function (s) { s.els.forEach(function (e) { if (!palOk(e) || JSON.stringify(e.pal || null) === want) return; if (nb) e.pal = clone(nb); else delete e.pal; n++; }); });
    if (n) { renderAll(); commit(); }
    return n;
  }
  function openBrandKit(opener) { if (window.AMBrand && window.AMBrand.open) window.AMBrand.open(opener && opener.isConnected ? opener : null); else toast('A caixa do kit de marca não está disponível nesta versão.'); }
  /* contraste dos textos DESTE componente com as cores escolhidas × com as cores A&M: desenha as duas versões fora da tela (sem
     animação) e compara texto a texto; devolve o pior texto que ficou abaixo de 3:1 e pior que no A&M ({t, c}) ou null. Guardado por
     tipo/dados/paleta: o painel redesenha muitas vezes */
  var palProbeMemo = {}, palProbeN = 0;
  function palProbe(el) {
    var key = JSON.stringify([el.kind, el.variant, el.w, el.h, el.data, el.pal, slide().bg]);
    if (palProbeMemo.hasOwnProperty(key)) return palProbeMemo[key];
    if (++palProbeN > 40) { palProbeMemo = {}; palProbeN = 1; }
    var host = document.createElement('div'), sbg = /^#[0-9a-f]{6}$/i.test(slide().bg || '') ? slide().bg : '#FFFFFF', res = null;
    host.className = 'am-stage am-edit'; host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-40000px;top:0;width:' + W + 'px;opacity:0;pointer-events:none;background:' + sbg;
    var mk = function (id, pal) { var o = clone(el); o.id = id; o.x = 0; o.y = 0; delete o.rot; delete o.opacity; o.anim = { in: 'none' }; if (pal) o.pal = pal; else delete o.pal; return RT.renderEl(o, 0); };
    var na = mk('pal-probe-a', null), nb = mk('pal-probe-b', el.pal);
    host.appendChild(na); host.appendChild(nb); document.body.appendChild(host);
    try {
      var rgb = function (s) { var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(s || ''); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
      var lin = function (c) { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }, lum = function (c) { return .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]); };
      var bgOf = function (e) { for (var x = e; x && x !== host; x = x.parentElement) { var c = rgb(getComputedStyle(x).backgroundColor); if (c && c[3] > .6) return c; } return rgb(getComputedStyle(host).backgroundColor) || [255, 255, 255]; };
      var pairs = function (root) {
        var out = [], tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), t;
        while ((t = tw.nextNode())) {
          var e = t.parentElement, tx = t.nodeValue.trim(); if (!tx || !e) continue;
          var cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
          var f = rgb(e.closest('svg') ? cs.fill : '') || rgb(cs.color), b = bgOf(e); if (!f) continue;
          var x = lum(f), y = lum(b); out.push({ t: tx, c: (Math.max(x, y) + .05) / (Math.min(x, y) + .05) });
        }
        return out;
      };
      var A = pairs(na), B = pairs(nb);
      B.forEach(function (o, i) { if (A[i] && o.c < 3 && o.c < A[i].c - .05 && (!res || o.c < res.c)) res = o; });
    } catch (er) { res = null; }
    host.remove();
    return (palProbeMemo[key] = res);
  }
  function palSec(el) {
    var pl = el.pal || {}, bad = el.pal && RT.pal ? palProbe(el) : null;
    /* sem cor própria, a amostra marcada é a cor A&M da linha (navy / laranja); clicá-la volta só aquela cor (applyProp apaga a chave) */
    var row = function (def) { return swList().map(function (o) { return [o[0], o[0] === def ? 'Cor A&M (sem troca)' : o[1]]; }); };
    return '<div class="sec" id="palSec"><h3>Cores do componente</h3>' +
      '<span class="pf"><span>Cor principal <small>(no lugar do azul-marinho)</small></span></span>' + swatches('pal.p', pl.p || '#002A46', false, row('#002A46')) +
      '<span class="pf" style="margin-top:10px"><span>Cor de destaque <small>(no lugar do laranja)</small></span></span>' + swatches('pal.a', pl.a || '#F78C16', false, row('#F78C16')) +
      (el.pal && RT.pal ? '<div class="pal-tones" title="Tons que o componente usa com estas cores">' + ['#002A46', '#13406A', '#43698F', '#7EA1C3', '#C9D6E8', '#EEF2F7', '|', '#F78C16', '#FEF1E2'].map(function (c) { return c === '|' ? '<b></b>' : '<i style="background:' + RT.pal.map(c, el.pal) + '"></i>'; }).join('') + '</div>' : '') +
      '<p class="note">Cada azul do modelo vira um tom da cor principal com a mesma claridade (o azul-marinho vira a versão escura dela), então os textos continuam legíveis; o laranja vira a cor de destaque. Vale só para este elemento, também na apresentação e no arquivo salvo.</p>' +
      (bad ? '<p class="note pal-warn">Pouco contraste com estas cores: “' + esc(bad.t.length > 32 ? bad.t.slice(0, 31) + '…' : bad.t) + '” fica difícil de ler (' + String(Math.round(bad.c * 10) / 10).replace('.', ',') + ':1; o mínimo recomendado é 3:1). Experimente outra cor de destaque ou principal.</p>' : '') +
      '<div class="row r1"><button class="btnw ic" data-act="palreset"' + (el.pal ? '' : ' disabled') + '>' + svgI('reset') + 'Restaurar cores A&amp;M</button></div></div>';
  }
  function focusPal() {
    var sc = $('#palSec'); if (!sc) return;
    sc.scrollIntoView({ block: 'nearest' }); sc.classList.remove('flash'); void sc.offsetWidth; sc.classList.add('flash');
    var b = sc.querySelector('.sw button'); if (b) b.focus({ preventScroll: true });
  }
  /* campo “Layout” do SmartArt: grade de miniaturas (clique troca o layout: data-set; os itens ficam) + dica do layout atual */
  function smartLayoutField(k, v) {
    var L = RT.SMART_LAYOUTS || [], cur = RT.smartFind && RT.smartFind(v) || L[0];
    if (!L.length) return '<div class="row r1">' + fld('Layout', txtIn(k, v)) + '</div>';
    return '<span class="pf"><span>Layout do diagrama</span></span><div class="lkg salg" role="group" aria-label="Layout do diagrama">' + L.map(function (l) { return '<button type="button" class="' + (cur && l[0] === cur[0] ? 'on' : '') + '" data-set="' + k + '" data-v="' + l[0] + '" title="' + esc(l[1] + ': ' + l[3]) + '" aria-pressed="' + (cur && l[0] === cur[0]) + '">' + RT.smartIcon(l[0]) + '<span>' + esc(l[1]) + '</span></button>'; }).join('') + '</div>' +
      (cur ? '<p class="note" style="margin:-4px 0 10px"><b>' + esc(cur[1]) + '</b> · ' + esc(cur[3]) + (cur[4] === cur[5] ? ' Exatamente ' + cur[5] + ' itens principais.' : ' De ' + cur[4] + ' a ' + cur[5] + ' itens principais.') + '</p>' : '');
  }
  /* campo “Ícone” do painel: busca + grade compacta (clique troca o ícone: data-set) + atalho para o seletor grande com prévia */
  function iconField(k, v) {
    var L = RT.ICONS || [], cur = RT.iconFind && RT.iconFind(v);
    return '<div class="pf icf"><span>Ícone' + (cur ? ' · <b>' + esc(cur.n) + '</b>' : '') + '</span><input type="search" class="icf-q" placeholder="Buscar ícone… (ex.: meta, risco)" aria-label="Buscar ícone" autocomplete="off"><div class="icf-g" role="group" aria-label="Ícones">' +
      L.map(function (ic) { return '<button type="button" class="' + (ic.k === v ? 'on' : '') + '" data-set="' + k + '" data-v="' + ic.k + '" data-kw="' + esc(icKw(ic)) + '" title="' + esc(ic.n) + '" aria-label="' + esc(ic.n) + '">' + RT.iconSVG(ic.k) + '</button>'; }).join('') +
      '<p class="icf-none" hidden>Nenhum ícone. Tente “meta”, “dados” ou “prazo”.</p></div><button type="button" class="btnw ic" data-act="icons">' + svgI('icons') + 'Ver todos os ícones, com prévia</button></div>';
  }
  /* seção “Linha” (com rt-10-shapes): cor, espessura, traçado (reta / cotovelo / curva + dobra), tracejado e as pontas de cada lado.
     As miniaturas são desenhadas pelo próprio runtime (currentColor: ficam brancas no botão ativo) */
  var LN_RT = [['straight', 'Reta'], ['elbow', 'Cotovelo'], ['curve', 'Curva']], LN_DASH = [['none', 'Contínua'], ['dash', 'Tracejada'], ['dot', 'Pontilhada'], ['dashdot', 'Traço e ponto'], ['long', 'Traço longo']],
    LN_HEAD = [['none', 'Sem ponta'], ['arrow', 'Seta'], ['open', 'Seta aberta'], ['dot', 'Bola'], ['diamond', 'Losango'], ['bar', 'Barra']];
  function lnIco(o) { return lineThumb(Object.assign({ x1: 0, y1: 0, x2: 64, y2: 0, stroke: 'currentColor', strokeW: 4 }, o), 'lni'); }
  /* S26: espessuras prontas (px do slide) — o campo numérico continua para qualquer valor */
  var LN_W = [[1, 'Fina'], [2, 'Normal'], [3, 'Média'], [4, 'Grossa'], [6, 'Extra'], [8, 'Máxima']];
  function wSeg(cur, pre) { return '<div class="seg lnseg ln-w" role="group" aria-label="Espessura"><span class="pf" style="margin:0 6px 0 0"><span>Rápido</span></span>' + LN_W.map(function (o) { return '<button type="button" class="' + (Math.abs(+cur - o[0]) < .01 ? 'on' : '') + '" data-act="' + pre + o[0] + '" title="' + o[1] + ' (' + o[0] + ' px)" aria-label="' + o[1] + ' (' + o[0] + ' px)"><svg viewBox="0 0 48 24"><path d="M6 12h36" stroke-width="' + Math.min(10, o[0] * 1.5) + '"/></svg></button>'; }).join('') + '</div>'; }
  function lnSeg(kind, cur, opts, ico) { return '<div class="seg lnseg ln-' + kind + '">' + opts.map(function (o) { return '<button type="button" class="' + (o[0] === cur ? 'on' : '') + '" data-act="ln-' + kind + '-' + o[0] + '" title="' + o[1] + '" aria-label="' + o[1] + '" aria-pressed="' + (o[0] === cur) + '">' + ico(o[0]) + (kind === 'rt' ? '<span>' + o[1] + '</span>' : '') + '</button>'; }).join('') + '</div>'; }
  function headCur(el, k, b) { return RT.LINE_HEADS.indexOf(el[k]) >= 0 ? el[k] : el[b] ? 'arrow' : 'none'; }
  function lineSec(el) {
    var rt = RT.LINE_ROUTES.indexOf(el.curve) > 0 ? el.curve : 'straight', ds = el.dash ? (RT.LINE_DASHES.indexOf(el.dashS) >= 0 ? el.dashS : 'dash') : 'none';
    return '<div class="sec"><h3>Linha</h3>' + swatches('stroke', el.stroke) +
      '<div class="row" style="margin-top:10px">' + fld('Espessura', num('strokeW', el.strokeW, 1, 1, 40)) + '<label class="pf"><span>&nbsp;</span><button type="button" class="btnw ic" data-act="ln-flip" title="Troca o início e o fim; as pontas vão junto">' + svgI('flip') + 'Inverter</button></label></div>' + wSeg(el.strokeW, 'sw-') +
      '<span class="pf"><span>Traçado</span></span>' + lnSeg('rt', rt, LN_RT, function (k) { return lnIco({ curve: k, x2: 44, y1: 30, strokeW: 4.5 }); }) +
      (rt === 'elbow' ? '<div class="row r1" style="margin:10px 0 0">' + fld('Dobra do cotovelo', '<input type="range" data-p="bend" data-n="1" min="0.1" max="0.9" step="0.05" value="' + (el.bend == null ? .5 : el.bend) + '">') + '</div><p class="note" style="margin:0">Ou arraste o ponto laranja da dobra, no slide.</p>' : '') +
      '<span class="pf" style="margin-top:10px"><span>Tracejado</span></span>' + lnSeg('dash', ds, LN_DASH, function (k) { return lnIco(k === 'none' ? {} : { dash: true, dashS: k }); }) +
      '<span class="pf" style="margin-top:10px"><span>Ponta no início</span></span>' + lnSeg('hs', headCur(el, 'headS', 'headStart'), LN_HEAD, function (k) { return lnIco(k === 'none' ? { x2: 44 } : { x2: 44, headS: k, headStart: true }); }) +
      '<span class="pf" style="margin-top:10px"><span>Ponta no fim</span></span>' + lnSeg('he', headCur(el, 'headE', 'headEnd'), LN_HEAD, function (k) { return lnIco(k === 'none' ? { x2: 44 } : { x2: 44, headE: k, headEnd: true }); }) + '</div>';
  }
  /* rota, tracejado e pontas: grava o booleano antigo junto (arquivos antigos e o runtime base continuam entendendo); seta e tracejado
     padrão não gravam o tipo. Inverter troca as pontas de lado e espelha a dobra */
  function lineAct(el, a) {
    var m = /^ln-(rt|dash|hs|he)-(\w+)$/.exec(a);
    if (a === 'ln-flip') {
      var x = el.x1, y = el.y1, hs = el.headStart, hS = el.headS; el.x1 = el.x2; el.y1 = el.y2; el.x2 = x; el.y2 = y;
      el.headStart = !!el.headEnd; el.headEnd = !!hs; if (el.headE) el.headS = el.headE; else delete el.headS; if (hS) el.headE = hS; else delete el.headE;
      if (el.bend != null) el.bend = Math.round((1 - el.bend) * 100) / 100;
    } else if (!m) return;
    else if (m[1] === 'rt') { if (m[2] === 'straight') delete el.curve; else el.curve = m[2]; }
    else if (m[1] === 'dash') { el.dash = m[2] !== 'none'; if (el.dash && m[2] !== 'dash') el.dashS = m[2]; else delete el.dashS; }
    else { var hb = m[1] === 'hs' ? 'headStart' : 'headEnd', hk = m[1] === 'hs' ? 'headS' : 'headE'; el[hb] = m[2] !== 'none'; if (m[2] === 'none' || m[2] === 'arrow') delete el[hk]; else el[hk] = m[2]; }
    rerenderEl(el); renderProps(); commit();
  }
  /* Tipo da forma (lista agrupada) */
  function shapeSel(v) {
    var cur = SHAPE_N[v] ? v : 'rect';
    return '<select data-p="shape">' + SHAPE_GROUPS.map(function (g) { return '<optgroup label="' + esc(g[0]) + '">' + g[1].map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(SHAPE_N[k]) + '</option>'; }).join('') + '</optgroup>'; }).join('') + '</select>';
  }
  /* trocar para colchetes/chaves (só traço) leva a cor do preenchimento para o traço; voltar para forma cheia devolve o preenchimento */
  function shapeSwitch(el, v) {
    var lk = el.look, fromBrace = isBrace(el.shape) && !isBrace(v);
    /* o estilo do card só existe em retângulo/arredondado/pílula: na forma nova ficam as cores que se viam (o runtime ignoraria o estilo) */
    if (lk && /^(rect|round|pill)$/.test(el.shape || 'rect') && !/^(rect|round|pill)$/.test(v)) {
      delete el.look; if (lk === 'header' && el.valign === 'top') el.valign = 'middle';
      if (isBrace(v)) el.fill = dark() ? '#FFFFFF' : '#002A46'; /* o traço das chaves sai na cor de texto do slide */
      else if (LIGHT_LOOK[lk] || (lk === 'header' && dark())) { el.fill = lk === 'ice' ? '#EEF2F7' : '#FFFFFF'; if (lk === 'lift') el.shadow = true; else if (!+el.strokeW) { el.stroke = lk === 'ice' ? '#CFDAE6' : '#CBD4E1'; el.strokeW = 1.5; } }
      else if (lk === 'header') { el.fill = '#002A46'; if (el.stroke === '#DCE5F0') el.strokeW = 0; }
      else if (lk === 'gradient' && !darkC(el.fill)) el.fill = '#002A46';
      if (!isBrace(v)) inkOn(el);
    }
    if (isBrace(v) && !isBrace(el.shape)) { if (el.fill && el.fill !== 'none') el.stroke = el.fill; el.strokeW = Math.max(3, +el.strokeW || 0); el.color = dark() ? '#FFFFFF' : '#002A46'; }
    else if (fromBrace && (!el.fill || el.fill === 'none')) { el.fill = el.stroke && el.stroke !== 'none' ? el.stroke : '#002A46'; el.strokeW = 0; el.color = darkC(el.fill) ? '#FFFFFF' : '#002A46'; }
    else if (fromBrace) inkOn(el);
    /* anel: o texto fica no furo (fundo do slide); ao sair do anel, o texto volta a contrastar com o preenchimento */
    if (v === 'ring' && el.shape !== 'ring') el.color = dark() ? '#FFFFFF' : '#002A46';
    else if (el.shape === 'ring' && v !== 'ring' && !isBrace(v)) inkOn(el);
  }
  /* texto quase da mesma claridade do preenchimento (navy no navy, branco no branco): vira branco no escuro, navy no claro */
  function inkOn(el) { var f = lumOf(el.fill), t = lumOf(el.color || '#002A46'); if (f != null && t != null && Math.abs(f - t) < .3) el.color = f < .55 ? '#FFFFFF' : '#002A46'; }
  /* tira cores embutidas no texto (colado de outro lugar): style color e <font color> */
  function stripColor(h) {
    var t = document.createElement('template'); t.innerHTML = h;
    $$('[style]', t.content).forEach(function (x) { x.style.removeProperty('color'); if (!x.getAttribute('style').trim()) x.removeAttribute('style'); });
    $$('font[color]', t.content).forEach(function (x) { x.removeAttribute('color'); });
    return t.innerHTML;
  }
  function setPath(obj, path, val) { var ks = path.split('.'), o = obj; for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; }
  function applyProp(path, val, live) {
    if (/^s\.(title|sec|secSub|notes)$/.test(path)) { /* campos de texto do slide: não redesenham o palco a cada tecla */
      var sk = path.slice(2), sv = String(val == null ? '' : val); if (sv.trim()) slide()[sk] = sv; else delete slide()[sk];
      if (!live) { commit(); renderProps(); } return;
    }
    if (path.indexOf('s.') === 0) {
      setPath(slide(), path.slice(2), val); renderStage(); if (!live) { commit(); renderProps(); } return;
    }
    var el = sel(); if (!el) return;
    if (/^a[12]\.s$/.test(path)) { var ak = path.slice(0, 2); if (!el[ak]) return; el[ak].s = /^[nesw]$/.test(val) ? val : 'c'; syncLine(slide(), el); rerenderEl(el); if (!live) { commit(); renderProps(); } return; } /* S32 */
    if (/(^|\.)font$/.test(path) && typeof val === 'string') ensureFonts([val]); /* S29 */
    if (/^pal\.[pa]$/.test(path)) { /* cores do componente: a cor A&M da linha (navy / laranja) ou nenhuma = sem troca, apaga só essa chave */
      var pk = path.slice(4), pv = typeof val === 'string' ? val.toUpperCase() : '';
      if (!/^#[0-9A-F]{6}$/.test(pv) || pv === (pk === 'p' ? '#002A46' : '#F78C16')) { if (el.pal) { delete el.pal[pk]; if (!el.pal.p && !el.pal.a) delete el.pal; } rerenderEl(el); if (!live) commit(); return; }
      val = pv;
    }
    var mc = /^data\.colors\.([0-5])$/.exec(path);
    if (mc) { /* cor de uma série: data.colors[k] (as posições antes dela ficam '' = cor padrão) */
      if (el.type !== 'fx' || !el.data) return;
      var ca = Array.isArray(el.data.colors) ? el.data.colors.slice(0, 6) : [], ci = +mc[1];
      while (ca.length < ci) ca.push('');
      ca[ci] = typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val) ? val.toUpperCase() : '';
      while (ca.length && !ca[ca.length - 1]) ca.pop();
      if (ca.length) el.data.colors = ca; else delete el.data.colors;
      rerenderEl(el); if (!live) commit(); return;
    }
    if (path === 'color' && el.html && /color/i.test(el.html)) el.html = stripColor(el.html); /* a cor do painel vale para a caixa inteira */
    if (path === 'anim.in' && val === 'draw' && !canDraw(el)) toast('“Desenhar” funciona em linhas, setas, Linhas A&M e ícones animados.');
    if (path === 'anim.in' && val === 'words' && !hasText(el)) toast('“Palavra a palavra” funciona em textos e formas com texto.');
    if (path === 'shape' && el.type === 'shape') shapeSwitch(el, val);
    if (path === 'rot') { val = normRot(val); if (!val) { delete el.rot; rerenderEl(el); if (!live) commit(); return; } } /* giro sempre em (-180, 180] */
    if (/^crop\.[ltrb]$/.test(path)) { /* S27b: cada lado 0–90 %; lados opostos nunca passam de 95 % juntos */
      var ck = path.slice(5), cv = Math.max(0, Math.min(.9, Math.round((+val || 0) * 1000) / 1000)), op = { l: 'r', r: 'l', t: 'b', b: 't' }[ck];
      el.crop = el.crop && typeof el.crop === 'object' ? el.crop : { l: 0, t: 0, r: 0, b: 0 }; if (cv + (+el.crop[op] || 0) > .95) cv = Math.max(0, .95 - (+el.crop[op] || 0)); el.crop[ck] = cv;
      rerenderEl(el); if (!live) { commit(); renderProps(); } return;
    }
    setPath(el, path, val);
    rerenderEl(el);
    if (!live) { commit(); }
  }
  var props = $('#props');
  /* clique no painel durante a edição de um texto: conclui a edição já (sem perder o que foi digitado)
     e sem redesenhar o painel embaixo do ponteiro, para o clique chegar ao controle */
  props.addEventListener('pointerdown', function () {
    if (zone === 'thumbs') setZone('panel');
    if (editingId) { holdProps = true; try { endEdit(); } finally { holdProps = false; } }
  }, true);
  $('#drawer').addEventListener('pointerdown', function () { if (zone === 'thumbs') setZone('panel'); }, true);
  props.addEventListener('input', function (e) {
    var t = e.target, p = t.dataset.p; if (!p) return;
    var v = t.value; if (t.dataset.n) { v = parseFloat(v); if (isNaN(v)) return; }
    if (t.dataset.codec === 'lines') v = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    else if (t.dataset.codec === 'outline') { var oe = sel(), OF = oe && oe.type === 'fx' && RT.FX[oe.kind]; v = OF && OF.outlineParse ? OF.outlineParse(v) : RT.smartParse ? RT.smartParse(v) : v; } /* codec próprio do modelo (FX.outlineParse), senão o do SmartArt */
    else if (t.dataset.codec && t.dataset.codec.indexOf('rows:') === 0) v = textToRows(v, t.dataset.codec.slice(5));
    applyProp(p, v, true);
  });
  /* painel de texto do SmartArt (codec outline): Tab / Shift+Tab mudam o nível das linhas tocadas pela seleção (2 espaços por
     nível, até o nível 2); Enter mantém o recuo da linha. Edita pelo insertText (desfazer nativo do campo) e dispara input. */
  props.addEventListener('keydown', function (e) {
    var t = e.target; if (!t || t.tagName !== 'TEXTAREA' || t.dataset.codec !== 'outline' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    var val = t.value, s0 = t.selectionStart, s1 = t.selectionEnd, a = val.lastIndexOf('\n', s0 - 1) + 1;
    function put(from, to, txt, c0, c1) { t.setSelectionRange(from, to); var ok = false; try { ok = document.execCommand('insertText', false, txt); } catch (er) { } if (!ok) { t.value = val.slice(0, from) + txt + val.slice(to); t.dispatchEvent(new Event('input', { bubbles: true })); } t.setSelectionRange(c0, c1); }
    if (e.key === 'Enter') { var ind = /^[ \t]*/.exec(val.slice(a, s0))[0]; put(s0, s1, '\n' + ind, s0 + 1 + ind.length, s0 + 1 + ind.length); return; }
    var b = val.indexOf('\n', s1); if (b < 0) b = val.length;
    var block = val.slice(a, b), ls = block.split('\n'), out = ls.map(function (l) { if (!l.trim() && ls.length > 1) return l; var lv = Math.floor(/^ */.exec(l.replace(/\t/g, '  '))[0].length / 2); lv = e.shiftKey ? Math.max(0, lv - 1) : Math.min(+t.dataset.maxlv || 2, lv + 1); return new Array(lv + 1).join('  ') + l.replace(/^[ \t]*/, ''); }).join('\n');
    if (out === block) return;
    var d0 = /^ */.exec(out)[0].length - /^ */.exec(block)[0].length;
    if (s0 === s1) put(a, b, out, Math.max(a, s0 + d0), Math.max(a, s0 + d0)); else put(a, b, out, a, a + out.length);
  });
  /* busca no campo “Ícone” do painel: filtra a grade sem redesenhar o painel */
  props.addEventListener('input', function (e) {
    if (!e.target.classList.contains('icf-q')) return;
    var q = norm(e.target.value).trim().split(/\s+/).filter(Boolean), g = e.target.parentNode.querySelector('.icf-g'), n = 0;
    $$('button', g).forEach(function (b) { var ok = q.every(function (w) { return b.dataset.kw.indexOf(w) >= 0; }); b.hidden = !ok; if (ok) n++; });
    g.querySelector('.icf-none').hidden = n > 0;
  });
  props.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset.p) return; commit(); if (t.tagName === 'SELECT' || t.type === 'color' || t.dataset.p === 'rot') renderProps();
    /* campos do slide: o cabeçalho (capítulo), os placeholders e a dica dependem deles; redesenha depois que o foco saiu do painel, sem engolir o clique */
    else if (/^s\.(title|sec|secSub|notes)$/.test(t.dataset.p)) setTimeout(function () { if (!props.contains(document.activeElement) && !sel()) renderProps(); }, 0);
  });
  props.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cpick) { openColorPop(b, !e.detail); return; }
    if (b.dataset.set) {
      var v = b.dataset.v; if (b.dataset.b) v = v === '1'; else if (/^-?\d+(\.\d+)?$/.test(v) && b.dataset.set !== 'anim.in') v = parseFloat(v);
      applyProp(b.dataset.set, v); renderProps(); return;
    }
    if (b.dataset.var) { setVariant(sel(), b.dataset.var); return; }
    if (b.dataset.act) act(b.dataset.act);
  });
  /* “Mais cores…”: o seletor (ed-colors.js) aplica a cor pelo mesmo caminho das amostras (applyProp + commit = um passo de desfazer).
     Cor do seletor nativo arrastando: prévia ao vivo (sem commit); a escolha final grava */
  function openColorPop(b, kb) {
    if (!window.AMColorPop) return;
    /* título do seletor: o nome do campo sem a dica em <small> (“Cor principal”, não “Cor principal (no lugar do…”) */
    var path = b.dataset.cpick, lab = b.closest('.cser') ? $('.cser-n', b.closest('.cser')).textContent : (function () { var q = b.parentNode.previousElementSibling; if (!q || !(q.classList.contains('pf') || q.tagName === 'H3')) return ''; var c = (q.firstElementChild && q.classList.contains('pf') ? q.firstElementChild : q).cloneNode(true); $$('small', c).forEach(function (x) { x.remove(); }); return c.textContent.trim(); })();
    flush(); /* pendências viram um passo próprio antes: a prévia do seletor do sistema volta exatamente ao que estava (onCancel) */
    var refocus = function () { var nb = $$('#props [data-cpick]').filter(function (x) { return x.dataset.cpick === path; })[0]; if (nb) nb.focus(); };
    window.AMColorPop.open(b, {
      value: b.dataset.cv, title: lab, keyboard: kb, brand: SW, kit: kitOpt(), row: b.closest('.cser') || b.parentNode, /* sem espaço em cima nem embaixo, abre ao lado desta linha */
      onLive: function (c) { applyProp(path, c, true); },
      onPick: function (c, viaKey) { applyProp(path, c); renderProps(); if (viaKey) refocus(); },
      onCancel: function (live) { if (live) { if (JSON.stringify(deck) !== last) restore(last); renderProps(); } }, /* Esc / clique fora depois da prévia: desfaz a prévia, sem gravar */
      onClose: function (viaKey) { if (viaKey) refocus(); }
    });
  }
  function rowsToText(v, spec) {
    var cols = spec.split('|');
    return (v || []).map(function (o) { return cols.map(function (c) { if (c[0] === '*') return (o[c.slice(1)] || []).join(' | '); return o[c.split(':')[0]] == null ? '' : o[c.split(':')[0]]; }).join(' | '); }).join('\n');
  }
  function textToRows(txt, spec) {
    var cols = spec.split('|');
    return txt.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var parts = l.split('|').map(function (s) { return s.trim(); }), o = {};
      cols.forEach(function (c, i) { if (c[0] === '*') o[c.slice(1)] = parts.slice(i); else { var k = c.split(':'); o[k[0]] = k[1] === 'n' ? (parseFloat(String(parts[i] || '').replace(',', '.')) || 0) : (parts[i] || ''); } });
      return o;
    });
  }
  function setVariant(el, v) {
    if (!el) return;
    if (el.type === 'fx' && RT.FX[el.kind].variants) el.variant = v;
    else { el.anim = el.anim || {}; el.anim.in = v; if (v === 'draw' && !canDraw(el)) el.anim.in = 'wipe'; }
    rerenderEl(el); commit(); renderProps(); previewEl(el);
  }
  var pvTimer = null;
  /* a prévia é só uma camada visual por cima do slide: qualquer interação a encerra na hora */
  function stopPreview() {
    clearTimeout(pvTimer); pvTimer = null;
    var old = wrap.querySelector('.prevov'); if (old) { old._clean && old._clean(); old.remove(); }
    $$('.am-el.previewing', wrap).forEach(function (x) { x.classList.remove('previewing'); });
  }
  function previewEl(el) {
    if (!el) return;
    stopPreview();
    var ov = document.createElement('div'); ov.className = 'prevov';
    var c = clone(el), st;
    /* ícone: a prévia mostra o movimento sem esperar o mouse ou o clique (só a prévia; o elemento guarda o gatilho escolhido) */
    if (c.kind === 'icon' && c.data && c.data.trig !== 'loop') c.data.trig = 'in-loop';
    if (c.kind === 'iconmorph') c.variant = 'loop';
    st = RT.renderSlide({ bg: 'transparent', els: [c] }, { play: true });
    st.querySelector('.am-el').style.zIndex = slide().els.indexOf(el) + 1;
    ov.appendChild(st); wrap.insertBefore(ov, selLayer);
    var node = stage.querySelector('.am-el[data-id="' + el.id + '"]'); if (node) node.classList.add('previewing');
    void st.offsetWidth; st.classList.remove('am-pre'); st.classList.add('am-in'); ov._clean = RT.runFx(st);
    var cyc = !!st.querySelector('[data-cycle="g"],[data-cycle="1"]');
    clearTimeout(pvTimer); pvTimer = setTimeout(stopPreview, cyc ? 7200 : isIcon(c) ? 6800 : 4200);
  }

  /* ---------------- ações ---------------- */
  /* formas: as 9 do runtime base + as 15 do rt-10-shapes (só as que o runtime sabe desenhar: RT.SHAPES_X). “rect” fica em primeiro */
  var SHAPES = [['rect', 'Retângulo'], ['round', 'Arredondado'], ['pill', 'Pílula'], ['ellipse', 'Elipse'], ['triangle', 'Triângulo'], ['diamond', 'Losango'], ['para', 'Paralelogramo'], ['chevron', 'Chevron'], ['arrow', 'Seta bloco'],
    ['pentagon', 'Pentágono-seta'], ['hexagon', 'Hexágono'], ['callout', 'Balão de fala'], ['darrow', 'Seta bloco dupla'], ['notch', 'Seta entalhada'], ['cylinder', 'Cilindro'], ['ring', 'Anel'], ['brackets', 'Colchetes'], ['braces', 'Chaves'],
    ['octagon', 'Octógono'], ['trapezoid', 'Trapézio'], ['rtri', 'Triângulo retângulo'], ['star', 'Estrela'], ['plus', 'Cruz'], ['wave', 'Documento']].filter(function (s, i) { return i < 9 || (RT.SHAPES_X || []).indexOf(s[0]) >= 0; });
  var SHAPE_N = {}; SHAPES.forEach(function (s) { SHAPE_N[s[0]] = s[1]; });
  var SHAPE_GROUPS = [['Retângulos e cards', ['rect', 'round', 'pill']], ['Básicas', ['ellipse', 'triangle', 'rtri', 'trapezoid', 'hexagon', 'octagon', 'star', 'plus', 'ring', 'callout']],
    ['Setas', ['arrow', 'chevron', 'pentagon', 'darrow', 'notch']], ['Fluxo', ['diamond', 'para', 'cylinder', 'wave']], ['Chaves', ['brackets', 'braces']]]
    .map(function (g) { return [g[0], g[1].filter(function (k) { return SHAPE_N[k]; })]; }).filter(function (g) { return g[1].length; });
  /* estilos de card (rect / round / pill): [chave, rótulo, rótulo curto, o que faz] — só os que o runtime desenha (RT.LOOKS) */
  var LOOKS = [['flat', 'Chapado', 'Chapado', 'Preenchimento sólido, sem detalhes.'], ['outline', 'Contorno', 'Contorno', 'Card branco com contorno cinza-gelo.'], ['lift', 'Elevado', 'Elevado', 'Card branco com sombra suave.'],
    ['accent', 'Barra lateral', 'Barra lateral', 'Barra laranja na lateral esquerda.'], ['topbar', 'Barra no topo', 'Barra no topo', 'Barra laranja no alto do card.'], ['header', 'Cabeçalho navy', 'Cabeçalho', 'Faixa azul-marinho no alto; o texto da forma vai nela.'],
    ['gradient', 'Gradiente navy', 'Gradiente', 'Gradiente azul-marinho, como os cards escuros da A&M.'], ['ice', 'Gelo', 'Gelo', 'Gelo translúcido: claro no fundo branco e no azul-marinho.']].filter(function (l) { return (RT.LOOKS || ['flat']).indexOf(l[0]) >= 0; });
  /* miniaturas (galeria, menus, painel): cada forma na proporção certa dentro de 42×28 */
  var SHAPE_BOX = { ellipse: 28, diamond: 28, triangle: 28, octagon: 28, star: 28, plus: 28, ring: 28, cylinder: 22 };
  function shapeSvg(k, cls, fill) {
    var bw = SHAPE_BOX[k] || 42, e = isBrace(k) ? { shape: k, fill: 'none', stroke: fill || '#002A46', strokeW: 2 } : { shape: k, fill: fill || '#002A46', strokeW: 0, radius: 5 };
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="' + (bw - 42) / 2 + ' 0 42 28" aria-hidden="true">' + RT.shapeBody(e, bw, 28) + '</svg>';
  }
  function lookSvg(k, cls) {
    var e = { shape: 'round', radius: 5, look: k, fill: k === 'accent' || k === 'topbar' ? '#EEF2F7' : k === 'header' ? '#FFFFFF' : '#002A46', strokeW: k === 'header' ? 1 : 0, stroke: '#DCE5F0' };
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="-2 -1 42 28" aria-hidden="true">' + RT.shapeBody(e, 38, 24) + '</svg>';
  }
  function addEls(list, noCommit) { if (editingId) endEdit(); ensureFonts(fontsIn(JSON.stringify(list))); list.forEach(function (el) { slide().els.push(el); }); pick(list.map(function (el) { return el.id; })); renderStage(); renderProps(); if (!noCommit) commit(); return list; }
  function addEl(el) { addEls([kitify(el)]); return el; } /* S29: inserção pela interface leva fonte/cores do kit; colar e duplicar (addEls) não */
  function delSel() {
    var ids = selIds.filter(function (id) { return !isLocked(getEl(id)); }), lk = selIds.length - ids.length; if (lk) toast(lk > 1 ? lk + ' elementos bloqueados não foram apagados' : 'Elemento bloqueado não foi apagado · desbloqueie para apagar');
    if (!ids.length) return;
    if (editingId) { editingId = null; freshId = null; }
    slide().els = slide().els.filter(function (e) { return ids.indexOf(e.id) < 0; }); pick([]); renderStage(); renderProps(); commit();
  }
  function dupSel() { var list = sels(); if (!list.length) return; var map = {}; addEls(remapLinks(remapGrp(list.map(function (el) { var c = clone(el); map[el.id] = c.id = uid(); delete c.ph; shift(c, 24); return c; })), map)); } /* cópia de um elemento do layout é do usuário (sem ph); grupo copiado vira outro grupo */
  /* ---------------- S27: grupos, bloqueio, camadas e pincel de formato ----------------
     grupo = el.grp (id compartilhado): clicar num membro seleciona o grupo inteiro, mover/redimensionar/girar/apagar valem para todos;
     bloqueio = el.lock: o elemento pode ser selecionado (e o texto, editado), mas não move, não redimensiona, não gira e não é apagado */
  function grpIds(id) { var e = getEl(id); if (!e || typeof e.grp !== 'string') return [id]; var g = e.grp; return slide().els.filter(function (x) { return x.grp === g; }).map(function (x) { return x.id; }); }
  function withGroups(ids) { var out = []; ids.forEach(function (id) { grpIds(id).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); }); return out; }
  function isLocked(e) { return !!e && e.lock === true; }
  function anyLocked(list) { return (list || sels()).some(isLocked); }
  function lockHint() { var t = Date.now(); if (lockHint._t && t - lockHint._t < 2500) return; lockHint._t = t; toast('Elemento bloqueado: não move nem redimensiona · Desbloquear: menu de contexto ou Ctrl+Shift+L'); }
  function groupSel() { var list = sels(); if (list.length < 2) { toast('Selecione 2 ou mais elementos para agrupar (Shift+clique ou laço)'); return; } var g = 'g' + uid().slice(1); list.forEach(function (e) { e.grp = g; }); drawSel(); renderProps(); commit(); toast(list.length + ' elementos agrupados · clicar em um seleciona o grupo · Ctrl+Shift+G desagrupa'); }
  function ungroupSel() { var list = sels().filter(function (e) { return e.grp; }); if (!list.length) { toast('A seleção não tem grupo'); return; } list.forEach(function (e) { delete e.grp; }); drawSel(); renderProps(); commit(); toast('Grupo desfeito · Ctrl+Z desfaz'); }
  function lockSel(on) { var list = sels(); if (!list.length) return; if (on == null) on = !list.every(isLocked); list.forEach(function (e) { if (on) e.lock = true; else delete e.lock; }); renderStage(); renderProps(); commit(); toast(on ? (list.length > 1 ? list.length + ' elementos bloqueados' : 'Bloqueado') + ': não move, não redimensiona, não apaga · Ctrl+Shift+L desbloqueia' : 'Desbloqueado · Ctrl+Z desfaz'); }
  function remapGrp(list) { var m = {}; list.forEach(function (e) { if (typeof e.grp === 'string') { if (!m[e.grp]) m[e.grp] = 'g' + uid().slice(1); e.grp = m[e.grp]; } }); return list; }
  /* pincel de formato: copia o formato (nunca o conteúdo) de um elemento e aplica à seleção; texto e forma compartilham o formato do texto */
  var FMT = { text: ['font', 'size', 'weight', 'color', 'align', 'valign', 'lh', 'ls', 'bg', 'italic', 'upper', 'radius', 'opacity'], shape: ['font', 'size', 'weight', 'color', 'align', 'valign', 'lh', 'ls', 'italic', 'upper', 'fill', 'stroke', 'strokeW', 'dash', 'shadow', 'look', 'radius', 'opacity'], line: ['stroke', 'strokeW', 'dash', 'dashS', 'headS', 'headE', 'headStart', 'headEnd', 'curve', 'opacity'], image: ['radius', 'shadow', 'fit', 'opacity'], fx: ['pal', 'opacity'] }, FMT_TX = ['font', 'size', 'weight', 'color', 'align', 'valign', 'lh', 'ls', 'italic', 'upper'], fmtClip = null;
  function copyFmt() {
    var el = sel(); if (!el) { toast('Selecione um elemento para copiar o formato'); return; }
    var o = { type: el.type, name: elName(el) }; (FMT[el.type] || []).forEach(function (k) { if (el[k] != null) o[k] = clone(el[k]); });
    if (el.type === 'fx' && el.data) { if (Array.isArray(el.data.colors)) o.cols = el.data.colors.slice(); if (el.data.style != null && fxStyleField(el.kind)) o.ds = el.data.style; }
    fmtClip = o; renderProps(); toast('Formato copiado de “' + o.name + '” · selecione outro elemento e use Colar formato (Ctrl+Alt+V)');
  }
  function pasteFmt() {
    if (!fmtClip) { toast('Nada copiado: use Copiar formato (Ctrl+Alt+C) primeiro'); return; }
    var list = sels(), n = 0;
    list.forEach(function (e) {
      var ok = false, same = fmtClip.type === e.type, txt = /^(text|shape)$/.test(e.type) && /^(text|shape)$/.test(fmtClip.type);
      (FMT[e.type] || []).forEach(function (k) { if (!(k in fmtClip)) return; if (same || (txt && FMT_TX.indexOf(k) >= 0)) { e[k] = clone(fmtClip[k]); ok = true; } });
      if (same && !('bg' in fmtClip) && e.type === 'text') delete e.bg; if (same && e.type === 'shape' && !('look' in fmtClip)) delete e.look;
      if (e.type === 'fx' && same) { e.data = e.data || {}; if (fmtClip.cols) { e.data.colors = fmtClip.cols.slice(); ok = true; } if (fmtClip.ds != null && fxStyleField(e.kind)) { e.data.style = fmtClip.ds; ok = true; } if ('pal' in fmtClip) ok = true; }
      if (ok) { n++; rerenderEl(e); }
    });
    if (n) { renderProps(); commit(); toast('Formato aplicado em ' + (n > 1 ? n + ' elementos' : '1 elemento') + ' · Ctrl+Z desfaz'); } else toast('O formato copiado (' + fmtClip.name + ') não se aplica a esta seleção');
  }
  /* camadas: lista do slide (de cima para baixo), com subir/descer, bloquear e selecionar */
  function layersSec(s) {
    var els = s.els.slice().reverse(); if (!els.length) return '';
    return '<div class="sec ly" id="secLayers"><h3>Camadas <small>' + els.length + '</small></h3><div class="lyl" role="list" aria-label="Camadas do slide">' + els.map(function (e, i) {
      var on = selIds.indexOf(e.id) >= 0, k = s.els.length - 1 - i;
      var pv = (e.type === 'text' || e.type === 'shape') && RT.plain ? RT.plain(e.html).replace(/\s+/g, ' ').trim().slice(0, 30) : ''; /* trecho do texto ajuda a achar a camada */
      return '<div class="lyr' + (on ? ' on' : '') + (e.lock ? ' lk' : '') + '" role="listitem"><button type="button" class="lyn" data-act="ly-sel:' + e.id + '" title="Selecionar">' + svgI(e.type) + '<span>' + esc(elName(e)) + (pv ? ' <small>· ' + esc(pv) + '</small>' : '') + (e.grp ? ' <i>grupo</i>' : '') + '</span></button>' +
        '<button type="button" class="lyb" data-act="ly-up:' + e.id + '" title="Subir uma camada" aria-label="Subir"' + (k === s.els.length - 1 ? ' disabled' : '') + '>' + svgI('up') + '</button><button type="button" class="lyb" data-act="ly-down:' + e.id + '" title="Descer uma camada" aria-label="Descer"' + (k === 0 ? ' disabled' : '') + '>' + svgI('down') + '</button>' +
        '<button type="button" class="lyb lk' + (e.lock ? ' on' : '') + '" data-act="ly-lock:' + e.id + '" title="' + (e.lock ? 'Desbloquear' : 'Bloquear') + '" aria-pressed="' + (e.lock ? 'true' : 'false') + '">' + svgI(e.lock ? 'lock' : 'unlock') + '</button></div>';
    }).join('') + '</div><p class="note">O primeiro da lista fica na frente. Clique no nome para selecionar; bloqueado = não move, não redimensiona nem apaga (o texto continua editável).</p></div>';
  }
  function layerAct(a) {
    var m = /^ly-(sel|up|down|lock):(.+)$/.exec(a); if (!m) return; var s = slide(), e = getEl(m[2]); if (!e) return; var i = s.els.indexOf(e);
    if (m[1] === 'sel') { setSel(withGroups([e.id]), e.id); return; }
    if (m[1] === 'lock') { if (e.lock) delete e.lock; else e.lock = true; renderStage(); renderProps(); commit(); return; }
    var j = m[1] === 'up' ? i + 1 : i - 1; if (j < 0 || j >= s.els.length) return;
    s.els.splice(i, 1); s.els.splice(j, 0, e); renderStage(); renderProps(); commit();
  }
  function showLayers() { if (editingId) endEdit(); select(null); setZone('canvas'); renderProps(); var sec = $('#secLayers'); if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'start' }); var f = sec && sec.querySelector('.lyn'); if (f) f.focus({ preventScroll: true }); }
  /* numeração dos slides (deck.num) */
  function numSec() {
    var nm = deck.num && deck.num.on === true ? deck.num : null, pos = nm ? nm.pos || 'br' : 'br';
    return '<div class="sec"><h3>Numeração dos slides</h3><div class="row r1"><button type="button" class="swt" role="switch" aria-checked="' + !!nm + '" data-act="num-on" title="Número do slide em todos os slides — também no arquivo salvo, no PDF e no PowerPoint">' + svgI('num') + '<span class="sl">Mostrar o número do slide</span><span class="sk" aria-hidden="true"></span></button></div>' +
      (nm ? '<span class="pf"><span>Posição</span></span><div class="seg ic numpos">' + [['tl', 'Canto superior esquerdo'], ['tr', 'Canto superior direito'], ['bl', 'Canto inferior esquerdo'], ['br', 'Canto inferior direito']].map(function (p) { return '<button type="button" class="' + (p[0] === pos ? 'on' : '') + '" data-act="num-pos-' + p[0] + '" title="' + p[1] + '" aria-label="' + p[1] + '">' + svgI('num-' + p[0]) + '</button>'; }).join('') + '</div>' : '') + '</div>';
  }
  function numAct(a) {
    if (a === 'num-on') { if (deck.num && deck.num.on === true) delete deck.num; else deck.num = { on: true, pos: 'br' }; }
    else { var m = /^num-pos-(tl|tr|bl|br)$/.exec(a); if (!m) return; deck.num = { on: true, pos: m[1] }; }
    renderAll(); commit();
  }
  function shift(el, d, dy) { if (dy == null) dy = d; if (el.type === 'line') { el.x1 += d; el.x2 += d; el.y1 += dy; el.y2 += dy; } else { el.x += d; el.y += dy; } }
  function bbox(el) { if (el.type === 'line') return { x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2), w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) }; return { x: el.x, y: el.y, w: el.w, h: el.h }; }
  function groupBox(list) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (e) { var b = aabb(e); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    return list.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
  }
  function moveTo(el, nx, ny) { if (el.type === 'line') { var b = bbox(el), dx = nx - b.x, dy = ny - b.y; el.x1 += dx; el.x2 += dx; el.y1 += dy; el.y2 += dy; } else { el.x = nx; el.y = ny; } }
  function posNode(el) {
    var node = stage && stage.querySelector('.am-el[data-id="' + el.id + '"]'); if (!node) return;
    if (el.type === 'line') { var lb = RT.lineBox(el); node.style.left = pc(lb.x, W); node.style.top = pc(lb.y, H); } else { node.style.left = pc(el.x, W); node.style.top = pc(el.y, H); refreshLinks(el); }
  }
  /* ordem de empilhamento: um passo (front/back) ou extremos (top/bottom), para um ou vários elementos */
  function reorder(a) {
    var s = slide(), on = function (e) { return selIds.indexOf(e.id) >= 0; }, els = s.els.slice(), i, t;
    if (a === 'top') s.els = els.filter(function (e) { return !on(e); }).concat(els.filter(on));
    else if (a === 'bottom') s.els = els.filter(on).concat(els.filter(function (e) { return !on(e); }));
    else if (a === 'front') { for (i = els.length - 2; i >= 0; i--) if (on(els[i]) && !on(els[i + 1])) { t = els[i]; els[i] = els[i + 1]; els[i + 1] = t; } s.els = els; }
    else if (a === 'back') { for (i = 1; i < els.length; i++) if (on(els[i]) && !on(els[i - 1])) { t = els[i]; els[i] = els[i - 1]; els[i - 1] = t; } s.els = els; }
  }
  function alignTo(list, k) {
    var ref = list.length > 1 ? groupBox(list) : { x: 0, y: 0, w: W, h: H };
    list.forEach(function (el) {
      var b = aabb(el), o = bbox(el), x = b.x, y = b.y; /* mede pelo desenho (girado: a caixa que o contém); move a origem sem giro pelo mesmo tanto */
      if (k === 'l') x = ref.x; else if (k === 'c') x = ref.x + (ref.w - b.w) / 2; else if (k === 'r') x = ref.x + ref.w - b.w;
      else if (k === 't') y = ref.y; else if (k === 'm') y = ref.y + (ref.h - b.h) / 2; else if (k === 'b') y = ref.y + ref.h - b.h;
      moveTo(el, Math.round(o.x + x - b.x), Math.round(o.y + y - b.y));
    });
  }
  function distribute(list, k) {
    if (list.length < 3) { toast('Selecione 3 ou mais elementos para distribuir.'); return false; }
    var hz = k === 'h', o = list.map(function (el) { return { el: el, b: aabb(el), o: bbox(el) }; });
    o.sort(function (p, q) { return hz ? (p.b.x + p.b.w / 2) - (q.b.x + q.b.w / 2) : (p.b.y + p.b.h / 2) - (q.b.y + q.b.h / 2); });
    var first = o[0].b, lastB = o[o.length - 1].b, span = hz ? (lastB.x + lastB.w) - first.x : (lastB.y + lastB.h) - first.y;
    var sum = o.reduce(function (a, q) { return a + (hz ? q.b.w : q.b.h); }, 0), gap = (span - sum) / (o.length - 1), pos = hz ? first.x : first.y;
    o.forEach(function (q) { if (hz) moveTo(q.el, Math.round(q.o.x + pos - q.b.x), q.o.y); else moveTo(q.el, q.o.x, Math.round(q.o.y + pos - q.b.y)); pos += (hz ? q.b.w : q.b.h) + gap; });
    return true;
  }
  /* ---------- girar e inverter: cada elemento no próprio centro (linhas: as pontas giram/espelham em torno do meio, sem campos novos) ---------- */
  function r2(v) { return Math.round(v * 100) / 100; }
  function turnEl(el, deg) {
    if (el.type === 'line') {
      var mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2, t = deg * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
      [['x1', 'y1'], ['x2', 'y2']].forEach(function (k) { var dx = el[k[0]] - mx, dy = el[k[1]] - my; el[k[0]] = r2(mx + dx * c - dy * sn); el[k[1]] = r2(my + dx * sn + dy * c); });
      return true;
    }
    var r = normRot((+el.rot || 0) + deg); if (r) el.rot = r; else delete el.rot; return true;
  }
  /* espelhar: a linha troca as pontas de lado (o cotovelo mantém a dobra); foto, forma e ícone ganham flipH/flipV.
     Como no PowerPoint, espelhar um elemento girado também espelha o giro (30° vira -30°) */
  function flipEl(el, ax) {
    if (el.type === 'line') { var a = ax === 'h' ? ['x1', 'x2'] : ['y1', 'y2'], t = el[a[0]]; el[a[0]] = el[a[1]]; el[a[1]] = t; return true; }
    if (!canFlip(el)) return false;
    var k = ax === 'h' ? 'flipH' : 'flipV'; if (el[k]) delete el[k]; else el[k] = true;
    if (+el.rot) { var r = normRot(-el.rot); if (r) el.rot = r; else delete el.rot; }
    return true;
  }
  function frameAct(a) {
    var list = sels(); if (!list.length) return;
    if (editingId) endEdit();
    var n = 0;
    list.forEach(function (el) {
      var ok = a === 'rot-l' ? turnEl(el, -90) : a === 'rot-r' ? turnEl(el, 90) : a === 'flip-h' ? flipEl(el, 'h') : a === 'flip-v' ? flipEl(el, 'v') : (el.type !== 'line' && +el.rot ? (delete el.rot, true) : false);
      if (ok) { n++; rerenderEl(el); }
    });
    if (!n) { toast(a === 'rot-0' ? 'A rotação já está em 0°.' : flipWhy(list)); return; }
    drawSel(); renderProps(); commit();
    if (a.indexOf('flip') === 0 && n < list.length) toast('Textos, gráficos e modelos com texto ficaram como estavam: espelhados, seriam lidos de trás para frente.');
  }
  /* Alt+← / Alt+→: gira a seleção 15° (Alt+Shift: 1°), um passo de desfazer por toque */
  function turnSel(deg) { var list = sels(); if (!list.length) return; list.forEach(function (el) { turnEl(el, deg); rerenderEl(el); }); drawSel(); renderProps(); commit(); }
  /* ---------- S21: ocultar / reexibir e redefinir slide ---------- */
  var NOBASE = 'Este slide não tem posições originais guardadas', RESET_TIP = 'Volta posições, tamanhos e formatos originais dos elementos do slide; os textos ficam';
  function showSec(s) {
    var hid = s.hidden === true;
    return '<div class="sec" id="secShow"><h3>Exibição e layout</h3>' +
      '<div class="row r1"><button type="button" class="swt" role="switch" aria-checked="' + hid + '" data-act="hideslide" title="' + (hid ? 'Reexibir: o slide volta para a apresentação' : 'O slide continua na obra, mas F5 e o arquivo salvo pulam ele') + '">' + svgI('eyeoff') + '<span class="sl">Ocultar na apresentação</span><span class="sk" aria-hidden="true"></span></button></div>' +
      '<div class="row r1"><button type="button" class="btnw ic" data-act="slreset" title="' + (s.base ? RESET_TIP : NOBASE) + '"' + (s.base ? '' : ' disabled') + '>' + svgI('slreset') + 'Redefinir slide</button></div>' +
      '<p class="note">' + (hid ? '<b>Oculto:</b> F5 e o arquivo salvo pulam este slide; ele continua aqui para editar.' : 'Oculto, o slide fica na obra mas sai da apresentação.') + ' <b>Redefinir</b> volta posições e formatos originais, mantendo os textos.</p></div>';
  }
  function toggleHidden(i) {
    if (i == null) i = cur; var s = deck.slides[i]; if (!s) return;
    var foc = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.act === 'hideslide';
    if (editingId) endEdit(); flush();
    if (s.hidden === true) delete s.hidden; else s.hidden = true;
    var t = $('#thumbs .th[data-i="' + i + '"]'); if (t) thHidden(t, s);
    if (i === cur) { stageHidden(); if (!sel() && !sels().length) renderProps(); }
    commit();
    if (foc) { var sw = $('#props [data-act=hideslide]'); if (sw) sw.focus(); }
    var vis = deck.slides.filter(function (x) { return x.hidden !== true; }).length;
    toast(s.hidden ? (vis ? 'Slide ' + (i + 1) + ' oculto: a apresentação pula este slide · Ctrl+Z desfaz' : 'Todos os slides estão ocultos — a apresentação mostrará todos') : 'Slide ' + (i + 1) + ' reexibido na apresentação · Ctrl+Z desfaz');
  }
  function phN(e) { return e && typeof e.ph === 'string' && PH_RE.test(e.ph) ? +e.ph.slice(1) : -1; }
  function resetSlide(i) {
    if (i == null) i = cur; var s = deck.slides[i]; if (!s) return;
    if (!s.base) { toast(NOBASE + '.'); return; }
    if (i !== cur) goSlide(i);
    if (editingId) endEdit(); flush(); stopPreview();
    var B = s.base.els || {}, have = {};
    s.els.forEach(function (e) { if (e.ph && B.hasOwnProperty(e.ph) && !have[e.ph]) { applySnap(e, B[e.ph]); have[e.ph] = 1; } });
    var L = typeof s.layout === 'string' && LAYOUTS.hasOwnProperty(s.layout) ? LAYOUTS[s.layout] : null, back = 0, lost = 0, ids = {};
    s.els.forEach(function (e) { ids[e.id] = 1; });
    function putBack(g, k) { /* original apagado volta no mesmo lugar da pilha (antes do próximo original) */
      var at = -1; s.els.forEach(function (e, j) { if (at < 0 && phN(e) > k) at = j; });
      if (at < 0) { at = 0; s.els.forEach(function (e, j) { var n = phN(e); if (n >= 0 && n < k) at = j + 1; }); }
      s.els.splice(at, 0, g); have[g.ph] = 1; back++;
    }
    var lay = L ? L.els() : null, T = s.base.tpl || {};
    Object.keys(B).sort(function (a, b) { return +a.slice(1) - +b.slice(1); }).forEach(function (ph) {
      if (have[ph]) return;
      var k = +ph.slice(1), g = lay && lay[k] ? lay[k] : null, snap = B[ph];
      if (g && snap.t && snap.t !== (g.type === 'fx' ? 'fx:' + g.kind : g.type)) g = null; /* o layout mudou de versão: não é mais o mesmo elemento */
      if (!g && T[ph]) { g = safeEl(clone(T[ph])); if (g && ids[g.id]) g.id = uid(); } /* modelo pronto/arquivo aberto: volta da cópia guardada */
      if (!g) { lost++; return; } /* foto apagada (ou arquivo antigo sem cópia): só com Ctrl+Z */
      g.ph = ph; applySnap(g, snap); ids[g.id] = 1; putBack(g, k);
    });
    /* ordem da pilha: os originais voltam à ordem original; o que foi acrescentado fica logo depois do original que seguia */
    var buckets = { '-1': [] }, order = [], lastPh = -1;
    s.els.forEach(function (e) { var n = phN(e); if (n >= 0) { order.push(n); buckets[n] = [e]; lastPh = n; } else buckets[lastPh].push(e); });
    s.els = buckets['-1'].concat.apply(buckets['-1'], order.sort(function (a, b) { return a - b; }).map(function (n) { return buckets[n]; }));
    s.bg = s.base.bg; if (s.bgImg && s.base.bgImgOp != null) s.bgImgOp = s.base.bgImgOp;
    pick(selIds, selId); renderStage();
    s.els.forEach(function (e) { if (e.type === 'text' && e.ph) fitTextEl(e); }); /* texto mais longo que o original: a caixa cresce para baixo (como ao digitar), nada fica cortado */
    renderProps(); renderThumb(i); commit();
    toast('Slide redefinido: posições e formatos originais, textos mantidos' + (back ? ' · ' + (back > 1 ? back + ' elementos apagados voltaram' : '1 elemento apagado voltou') : '') + (lost ? ' · ' + (lost > 1 ? lost + ' fotos apagadas não voltam' : '1 foto apagada não volta') + ' (use Ctrl+Z)' : '') + ' · Ctrl+Z desfaz');
  }
  function act(a) {
    var el = sel(), s = slide(), list = sels();
    if (a === 'hideslide') return toggleHidden(cur);
    if (a === 'slreset') return resetSlide(cur);
    if (a === 'group') return groupSel(); if (a === 'ungroup') return ungroupSel(); if (a === 'lock') return lockSel(); if (a === 'unlock') return lockSel(false); /* S27 */
    if (a === 'fmtcopy') return copyFmt(); if (a === 'fmtpaste') return pasteFmt(); if (a === 'layers') return showLayers();
    if (a === 'crop' && el && el.type === 'image') { cropOpen = cropOpen === el.id && !el.crop ? null : el.id; renderProps(); var r0 = $('#props input[data-p="crop.l"]'); if (r0) r0.focus(); return; }
    if (a === 'crop-none' && el && el.type === 'image') { delete el.crop; cropOpen = null; rerenderEl(el); renderProps(); commit(); toast('Foto inteira de volta · Ctrl+Z desfaz'); return; }
    if (a === 'crop-fit' && el && el.type === 'image') { var cim = stage.querySelector('.am-el[data-id="' + el.id + '"] img'), nw = cim && cim.naturalWidth, nh = cim && cim.naturalHeight, cro = RT.cropOf(el); if (!nw || !nh) return; var asp = (nw * (1 - (cro ? cro.l + cro.r : 0))) / (nh * (1 - (cro ? cro.t + cro.b : 0))); el.h = Math.max(8, Math.round(el.w / asp)); rerenderEl(el); renderProps(); commit(); return; }
    if (a.indexOf('ly-') === 0) return layerAct(a); if (a.indexOf('num-') === 0) return numAct(a);
    if (/^(rot-[lr0]|flip-[hv])$/.test(a)) { if (anyLocked()) return lockHint(); return frameAct(a); }
    if (a === 'del') return delSel();
    if (a === 'dup') return dupSel();
    if (a === 'copy') return doCopy(false);
    if (a === 'cut') return doCopy(true);
    if (/^(front|back|top|bottom)$/.test(a)) { if (!list.length) return; reorder(a); renderStage(); commit(); return; }
    if (a.indexOf('al-') === 0) { if (!list.length) return; alignTo(list, a.slice(3)); renderStage(); renderProps(); commit(); return; }
    if (a.indexOf('dist-') === 0) { if (distribute(list, a.slice(5))) { renderStage(); renderProps(); commit(); } return; }
    if (a === 'seqsel') {
      list.slice().sort(function (p, q) { var bp = bbox(p), bq = bbox(q); return (Math.round(bp.y / 40) - Math.round(bq.y / 40)) || (bp.x - bq.x); }).forEach(function (e, i) { e.anim = e.anim || {}; if (!e.anim.in || e.anim.in === 'none') e.anim.in = canDraw(e) ? 'draw' : (e.type === 'image' ? 'fade' : 'rise'); e.anim.delay = i * 180; });
      renderStage(); commit(); toast('Seleção animada em sequência. Veja com “Apresentar deste slide” (Shift+F5).'); return;
    }
    if (a.indexOf('preset-') === 0 && el) { var t = TEXT[a.slice(7)]; ['font', 'size', 'weight', 'ls', 'lh'].forEach(function (k) { el[k] = t[k] != null ? t[k] : (k === 'ls' ? 0 : el[k]); }); el.color = a === 'preset-subtitle' ? (dark() ? '#F78C16' : '#002A46') : t.color || el.color; el.upper = a === 'preset-eyebrow'; rerenderEl(el); renderProps(); commit(); return; }
    if (a === 'replace') { pickImage(function (src) { el.src = src; rerenderEl(el); commit(); }); return; }
    if (a === 'bgimg') { pickImage(function (src) { s.bgImg = src; renderStage(); renderProps(); commit(); }); return; }
    if (a === 'bgimgdel') { delete s.bgImg; renderStage(); renderProps(); commit(); return; }
    if (a === 'colors-reset') { if (el && el.data && el.data.colors) { delete el.data.colors; rerenderEl(el); renderProps(); commit(); toast('Cores A&M de volta.'); } return; }
    if (a === 'autonotes') { var vs = deck.slides.filter(function (x) { return x.hidden !== true; }), vi = vs.indexOf(s); s.notes = vi >= 0 ? RT.autoNotes(s, vi, { slides: vs }) : RT.autoNotes(s, cur, deck); commit(); renderProps(); var nta = $('#props textarea[data-p="s.notes"]'); if (nta) nta.focus(); toast('Resumo gerado a partir do conteúdo do slide · edite à vontade · Ctrl+Z desfaz'); return; }
    if (a === 'viewnotes') { closeMenus(); present(cur, s.hidden === true); if (player && player.nav) player.nav.notes(true); return; }
    if (a === 'seq') {
      var order = s.els.slice().sort(function (p, q) { var bp = bbox(p), bq = bbox(q); return (Math.round(bp.y / 40) - Math.round(bq.y / 40)) || (bp.x - bq.x); });
      order.forEach(function (e, i) { e.anim = e.anim || {}; if (!e.anim.in || e.anim.in === 'none') e.anim.in = canDraw(e) ? 'draw' : (e.type === 'image' ? 'fade' : 'rise'); e.anim.delay = i * 180; });
      renderStage(); commit(); toast('Animações em sequência aplicadas. Veja com “Apresentar deste slide” (Shift+F5).'); return;
    }
    if (a === 'noanim') { s.els.forEach(function (e) { if (e.anim) { e.anim.in = 'none'; e.anim.delay = 0; } }); renderStage(); commit(); return; }
    if (a === 'preview') return present(cur);
    if (a === 'zoomview') { if (!el) return; present(cur, s.hidden === true); if (player && player.zoom) player.zoom.open(el.id); return; }
    if (a === 'pvel') return previewEl(el);
    if (a === 'brandkit') { openBrandKit(document.activeElement); return; } /* S29 */
    if (a === 'inst') { if (hasInst()) insertSeq('inst'); return; } /* S34 */
    if (a === 'unlink-a1' || a === 'unlink-a2') { if (!el || !el[a.slice(7)]) return; delete el[a.slice(7)]; commit(); renderProps(); toast('Ponta solta · Ctrl+Z desfaz'); return; } /* S32 */
    if (a === 'palreset') { if (!el || !el.pal) return; delete el.pal; rerenderEl(el); renderProps(); commit(); toast('Cores A&M restauradas neste elemento · Ctrl+Z desfaz'); return; }
    if (a === 'gallery') return openGallery('in');
    if (a === 'gallery-tr') return openGallery('tr');
    if (a === 'gallery-icon') return openGallery('icon');
    if (a === 'icons') return openIcons($('#props [data-act=icons]'), { right: true });
    if (a.indexOf('ln-') === 0 && el && el.type === 'line') return lineAct(el, a);
    if (a.indexOf('sw-') === 0 && el && (el.type === 'line' || el.type === 'shape')) { el.strokeW = +a.slice(3); if (el.type === 'shape' && (!el.stroke || el.stroke === 'none')) el.stroke = dark() ? '#FFFFFF' : '#002A46'; rerenderEl(el); renderProps(); commit(); return; } /* S26 */
    if (a.indexOf('look-') === 0 && el && el.type === 'shape') { applyLook(el, a.slice(5)); rerenderEl(el); renderProps(); commit(); return; }
  }
  function pickImage(cb) {
    var f = $('#fImg'); f.value = ''; f.onchange = function () { if (f.files[0]) readImage(f.files[0], cb); }; f.click(); /* cb(src, largura, altura): sem as medidas a imagem entrava com x/y/w/h NaN, invisível e sem poder mover */
  }
  function readImage(file, cb) {
    var r = new FileReader(), turned = false;
    /* JPEG com orientação EXIF (foto de celular): o navegador já mostra em pé, mas o arquivo bruto está deitado — o PowerPoint exportado e
       leitores antigos o mostrariam assim. A foto passa pelo canvas (que “assa” a orientação) antes de entrar na obra */
    var JO = window.AMExport && window.AMExport.jpegOrient, head = /jpe?g/i.test(file.type) && JO && file.slice ? file.slice(0, 262144).arrayBuffer().then(function (b) { turned = JO(new Uint8Array(b)) !== 1; }).catch(function () { }) : Promise.resolve();
    r.onload = function () {
      var img = new Image();
      img.onload = function () { head.then(go); };
      function go() {
        var max = 1920, k = Math.min(1, max / Math.max(img.width, img.height)), src = r.result;
        if (k < 1 || file.size > 900000 || turned) {
          var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          src = /png|gif|webp/.test(file.type) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', .86);
          if (src.length > r.result.length && k === 1 && !turned) src = r.result;
        }
        cb(src, img.width, img.height);
      }
      img.src = r.result;
    };
    r.readAsDataURL(file);
  }

  /* ---------------- inserir ---------------- */
  function dark() { return isDark(slide().bg); }
  function insertText(kind) { var el = addEl(mkText(kind, null, dark())); startEdit(el, true); }
  /* elemento de efeito pronto para inserir (também usado pelo provador para a prévia, sem tocar no slide) */
  function fxFor(kind, style, variant) {
    var over = {}; if (style) over.data = Object.assign(clone(RT.FX[kind].data), { style: style });
    var el = mkFx(kind, over, dark()), F = RT.FX[kind];
    if (style === 'dark' && kind === 'card') el.data.style = 'dark';
    if (F.model) { el.variant = F.variant; if (dark() && ['timeline', 'process', 'bars'].indexOf(kind) < 0) el.data.panel = 'white'; }
    if (variant && F.variants && F.variants.some(function (x) { return x[0] === variant; })) el.variant = variant;
    return el;
  }
  /* data (opcional): campos que já entram prontos (ex.: { name: 'gear' } num ícone), num passo só de desfazer */
  function insertFx(kind, style, at, variant, data) {
    var el = fxFor(kind, style, variant);
    if (data) Object.keys(data).forEach(function (k) { el.data[k] = data[k]; });
    if (at) { el.x = Math.round(Math.max(0, Math.min(W - el.w, at.x - el.w / 2))); el.y = Math.round(Math.max(0, Math.min(H - el.h, at.y - el.h / 2))); }
    return addEl(el);
  }
  function insertBrand(k) {
    if (k === 'slash') return addEl(Object.assign(mkLine(false), { x1: 900, y1: 600, x2: 1000, y2: 420, stroke: '#F78C16', strokeW: 3, anim: { in: 'draw', dur: 900 } }));
    addEl(mkBrand(k));
  }
  $('#rib').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.menu === 'icMenu') { if (icOpen()) closeIcons(true); else openIcons(b); return; }
    if (b.dataset.menu) { toggleMenu(b.dataset.menu, b); return; }
    var a = b.dataset.add;
    if (a === 'line') addEl(mkLine(false, dark()));
    else if (a === 'arrow') addEl(mkLine(true, dark()));
    else if (a === 'image') pickImage(function (src, w, h) { addEl(mkImage(src, w, h)); });
  });
  if (!RT.ICONS && $('#bIcons')) $('#bIcons').style.display = 'none'; /* runtime sem rt-20-icons: sem botão de ícones */
  function toggleMenu(id, btn) {
    var m = $('#' + id), open = m.classList.contains('open'); closeMenus(); if (open) return;
    var r = btn.getBoundingClientRect(); m.style.left = Math.min(r.left, innerWidth - 260) + 'px'; m.style.top = (r.bottom + 6) + 'px'; m.classList.add('open'); btn.classList.add('open');
    if (m.offsetWidth && r.left + m.offsetWidth > innerWidth - 8) m.style.left = Math.max(8, innerWidth - m.offsetWidth - 8) + 'px'; /* galeria larga (Formas): mede aberta e cabe na janela */
  }
  function openVarMenu(btn) {
    var el = sel(); if (!el) return; var m = $('#mVar'), FDx = el.type === 'fx' ? RT.FX[el.kind] : null, opts, cv, title;
    if (FDx && FDx.variants) { opts = FDx.variants; cv = el.variant || FDx.variant; title = 'Efeitos para ' + FDx.name; }
    else { opts = ANIM_IN.filter(function (a) { return a[0] === 'none' || animFits(el, 'in', a[0]); }).map(function (a) { return [a[0], a[1], ANIM_TIP[a[0]] || '']; }); cv = (el.anim && el.anim.in) || 'none'; title = 'Animação de entrada'; }
    m.innerHTML = '<div class="vh"><b>' + esc(title) + '</b><button data-vprev="1">▶ Ver</button></div><div class="vlist">' + opts.map(function (o) { return '<button class="vo' + (o[0] === cv ? ' on' : '') + '" data-v="' + o[0] + '"><i></i><b>' + esc(o[1]) + '</b><span>' + esc(o[2] || '') + '</span></button>'; }).join('') + '</div>' + (FDx && FDx.tip ? '<p class="vtip">' + esc(FDx.tip) + '</p>' : '') +
      '<button class="vall" data-vall="1">' + svgI('models') + 'Ver todos em caixas, com prévia…</button>';
    var open = m.classList.contains('open'); closeMenus(); if (open) return;
    var r = btn.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(r.right - 340, innerWidth - 350)) + 'px'; m.classList.add('open');
    m.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8)) + 'px'; /* mede depois de abrir: a lista de entradas cresceu e rola */
  }
  $('#mVar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; e.stopPropagation();
    if (b.dataset.vprev) { closeMenus(); previewEl(sel()); return; }
    if (b.dataset.vall) { var ve = sel(), vF = ve && ve.type === 'fx' ? RT.FX[ve.kind] : null; closeMenus(); if (vF && vF.gal === 'icon') openGallery('icon'); else if (vF && vF.variants) openGallery(vF.model ? 'model' : 'cmp', vF.name); else openGallery('in'); return; }
    if (b.dataset.v) { closeMenus(); setVariant(sel(), b.dataset.v); }
  });
  var menuFrom = null; /* { m: menu antigo, b: botão } quando o menu foi aberto pelo teclado: Esc devolve o foco ao botão */
  function closeOld() { menuFrom = null; if (icOpen()) closeIcons(false); $$('.menu.open').forEach(function (m) { m.classList.remove('open'); }); $$('.rb.open').forEach(function (b) { b.classList.remove('open'); }); }
  function closeMenus() { closeOld(); if (typeof closeAllX === 'function') closeAllX(); }
  document.addEventListener('pointerdown', function (e) { if (!e.target.closest('.menu,[data-menu],#addSlide,#sideAdd,#fxArrow')) closeOld(); if (!e.target.closest('.xmenu,#mbar,#bSaveMore')) closeAllX(); });
  /* galeria “Formas ▾”: grupos (Retângulos e cards, Básicas, Setas, Fluxo, Chaves) em grade de 6; os cards prontos vêm com o retângulo */
  (function () {
    function grp(g, gi, cols) {
      var t = g[1].map(function (k) { return '<button data-shape="' + k + '" title="' + esc(SHAPE_N[k]) + '">' + shapeSvg(k) + '<span>' + esc(SHAPE_N[k]) + '</span></button>'; });
      if (!gi) t = t.concat(LOOKS.slice(1).map(function (l) { return '<button data-shape="round" data-look="' + l[0] + '" title="Card · ' + esc(l[1] + ': ' + l[3]) + '">' + lookSvg(l[0]) + '<span>' + esc(l[2]) + '</span></button>'; }));
      return '<div class="gg"><div class="mh">' + esc(g[0]) + '</div><div class="grid" style="grid-template-columns:repeat(' + cols + ',1fr)">' + t.join('') + '</div></div>';
    }
    var h = '', G = SHAPE_GROUPS;
    for (var gi = 0; gi < G.length; gi++) { /* grupos pequenos vizinhos (Fluxo + Chaves) dividem a mesma linha da grade de 6 */
      var a = G[gi][1].length, b = G[gi + 1] ? G[gi + 1][1].length : 9;
      if (gi && a + b <= 6) { h += '<div class="gpair" style="grid-template-columns:' + a + 'fr ' + b + 'fr">' + grp(G[gi], gi, a) + grp(G[gi + 1], gi + 1, b) + '</div>'; gi++; }
      else h += grp(G[gi], gi, 6);
    }
    $('#shapeGrid').innerHTML = h;
  })();
  /* miniatura de linha: desenhada pelo próprio runtime (mesmas rotas, pontas e tracejados do slide), com o viewBox recortado rente ao traço */
  function lineThumb(e, cls) {
    var b = RT.lineBox(e), mg = (+e.strokeW || 2) * 2.2, x = Math.min(e.x1, e.x2) - b.x - mg, y = Math.min(e.y1, e.y2) - b.y - mg;
    return RT.lineSVG(e).replace(/^<svg viewBox="[^"]*"/, '<svg' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true" viewBox="' + x + ' ' + y + ' ' + (Math.abs(e.x2 - e.x1) + 2 * mg) + ' ' + (Math.abs(e.y2 - e.y1) + 2 * mg) + '"');
  }
  function linePrev(k, cls) {
    var p = LINE_PRESETS.find(function (x) { return x[0] === k; }), e = Object.assign({ x1: 0, y1: 0, x2: 120, y2: 0, stroke: '#43698F', strokeW: 6 }, p ? p[2] : {});
    if (e.curve) e.y1 = 34;
    return '<span class="' + (cls || 'mi-ln') + '" aria-hidden="true">' + lineThumb(e) + '</span>';
  }
  $('#mLine').innerHTML = LINE_PRESETS.map(function (p) { return (p[3] ? '<div class="mh">' + esc(p[3]) + '</div>' : '') + '<button data-line="' + p[0] + '">' + linePrev(p[0]) + esc(p[1]) + '</button>'; }).join('');
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.menu button'); if (!b || b.closest('#mVar,#icMenu')) return;
    closeMenus();
    if (b.dataset.text) insertText(b.dataset.text);
    else if (b.dataset.shape) addEl(b.dataset.look ? mkCard(b.dataset.look, dark()) : mkShape(b.dataset.shape, dark()));
    else if (b.dataset.fx) { var nf = insertFx(b.dataset.fx, b.dataset.style); if (b.closest('#mChart')) { toast('Gráfico inserido. Edite os dados no painel à direita; o efeito fica no seletor “Efeito” acima dele.'); setTimeout(function () { previewEl(nf); }, 250); } }
    else if (b.dataset.brand) insertBrand(b.dataset.brand);
    else if (b.dataset.smart) insertSmart(b.dataset.smart);
    else if (b.dataset.open) toggleMenu(b.dataset.open, $('#bCharts') || b); /* “Gráficos ▾” › SmartArt: troca para o seletor de layouts */
    else if (b.dataset.line) addEl(mkLinePreset(b.dataset.line, dark()));
    else if (b.dataset.layout) addSlide(b.dataset.layout);
    else if (b.dataset.seq) insertSeq(b.dataset.seq); /* S34: bloco pronto no seletor “Novo slide” */
  });
  /* seletor “Novo slide”: layouts visíveis (os ocultos, como os institucionais, entram só pelo bloco) + blocos prontos marcados para o seletor (SEQS[i][3]) */
  function buildSlidePicker() {
    var vis = Object.keys(LAYOUTS).filter(function (k) { return !LAYOUTS[k].hidden; }), sq = (typeof SEQS !== 'undefined' && SEQS || []).filter(function (s) { return s[3]; });
    $('#bInst').hidden = !sq.some(function (s) { return s[0] === 'inst'; }); /* S34b: o botão da barra só aparece com o bloco institucional carregado */
    $('#mSlide').innerHTML = '<div class="mh">Escolha o layout</div>' + vis.map(function (k) { return '<button data-layout="' + k + '"><span class="mi-sw" style="background:' + LAYOUTS[k].bg + '"></span>' + LAYOUTS[k].name + '</button>'; }).join('') +
      (sq.length ? '<div class="mh">Slides institucionais A&amp;M</div>' + sq.map(function (s) { return '<button data-seq="' + s[0] + '" title="' + esc(s[2].map(function (k) { return LAYOUTS[k] ? LAYOUTS[k].name.replace(/^Institucional · /, '') : k; }).join(' · ')) + ' · depois do slide atual"><span class="mi-sw"></span>Inserir os ' + s[2].length + ' slides institucionais</button>'; }).join('') : '');
  }
  buildSlidePicker();
  /* galeria “Gráficos ▾” (e Inserir › Gráfico ▸): os gráficos do runtime (rt-30-charts.js + bars, linechart, donut, gauge), em três grupos */
  var CH_IC = { columns: '<path d="M4 20h16"/><path d="M6 17v-6h3v6M10.5 17V5h3v12M15 17v-8h3v8"/>', bars: '<path d="M4 20h16"/><path d="M7 16V9M12 16V5M17 16v-4"/>', hbars: '<path d="M4 4v16"/><path d="M4 7h13M4 12h9M4 17h5"/>',
    waterfall: '<path d="M3 20h18"/><path d="M4 18V7h3v11M9.5 7V4h3v3M14 7v6h3V7M19 13v5"/>', linechart: '<path d="M4 20h16"/><path d="M4 15l5-6 4 3 7-8"/>', donut: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 4v4.8M18.9 9.5l-4.4 1.6"/>',
    funnel: '<path d="M3 4h18l-7 8.5V20l-4-2v-5.5z"/>', radar: '<path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z"/><path d="M12 8.5l4 2.9-1.5 4.7h-5L8 11.4z"/><path d="M12 3v16M3.5 9.2l17 0M6.7 19.2L20.5 9.2M17.3 19.2L3.5 9.2"/>',
    bullet: '<path d="M3 9h18v6H3z"/><path d="M3 12h11"/><path d="M16.5 7.5v9"/>', harvey: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5H12z" fill="currentColor" stroke="none"/>', gauge: '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l3.5-5"/><path d="M4 20h16"/>' };
  var CH_GROUPS = [['Colunas e barras', ['columns', 'bars', 'hbars', 'waterfall']], ['Linhas e composição', ['linechart', 'donut', 'funnel', 'radar']], ['Indicadores e comparativos', ['bullet', 'harvey', 'gauge']]];
  function chartKinds() { var seen = {}, out = []; CH_GROUPS.forEach(function (g) { g[1].forEach(function (k) { if (RT.FX[k]) { seen[k] = 1; out.push(k); } }); }); Object.keys(RT.FX).forEach(function (k) { if (!seen[k] && (RT.FX[k].chart || RT.FX[k].cat === 'Gráficos')) out.push(k); }); return out; }
  function chartIcon(k, cls) { return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + '>' + (CH_IC[k] || IC.chart) + '</svg>'; }
  function buildChartMenu() {
    var extra = chartKinds().filter(function (k) { return !CH_GROUPS.some(function (g) { return g[1].indexOf(k) >= 0; }); });
    $('#mChart').innerHTML = CH_GROUPS.concat(extra.length ? [['Outros', extra]] : []).map(function (g) {
      var ks = g[1].filter(function (k) { return RT.FX[k]; }); if (!ks.length) return '';
      return '<div class="mh">' + esc(g[0]) + '</div>' + ks.map(function (k) { var d = RT.FX[k]; return '<button data-fx="' + k + '" title="' + esc(d.name + (d.variants ? ' · ' + d.variants.length + ' efeitos' : '')) + '"><span class="mi-ic">' + chartIcon(k) + '</span>' + esc(d.name) + (d.variants ? '<small>' + d.variants.length + ' efeitos</small>' : '') + '</button>'; }).join('');
    }).join('');
    if (RT.SMART_LAYOUTS && RT.FX.smart) $('#mChart').innerHTML += '<div class="msep"></div><button type="button" class="mi-more" data-open="mSmart" title="SmartArt: processo, chevrons, degraus, ciclo, radial, Venn, hierarquia, lista em blocos, matriz, pirâmide, funil e alvo"><span class="mi-sa">' + RT.smartIcon('process') + '</span>SmartArt · diagramas por texto<small>' + RT.SMART_LAYOUTS.length + ' layouts</small></button>';
    if ($('#bCharts')) $('#bCharts').style.display = RT.CHARTS ? '' : 'none'; /* runtime sem rt-30-charts: sem botão (os gráficos antigos seguem em Modelos) */
  }
  buildChartMenu();
  /* SmartArt (rt-40-smartart.js): um modelo com 12 layouts. insertSmart(k) insere já no layout escolhido (um passo de desfazer);
     o seletor visual #mSmart (popover .menu.gmenu.smenu) abre do “Gráficos ▾” e o Inserir › SmartArt ▸ lista os mesmos layouts com miniatura */
  function smartLayouts() { return RT.SMART_LAYOUTS || []; }
  /* dados iniciais de um SmartArt novo: o layout e os itens de exemplo desse layout (a troca de layout no painel não mexe nos itens) */
  function smartSeed(k) { var d = { layout: k }; if (RT.smartSample) d.items = RT.smartSample(k); return d; }
  function insertSmart(k) {
    var l = RT.smartFind && RT.smartFind(k); if (!l || !RT.FX.smart) return null;
    var ne = insertFx('smart', null, null, null, smartSeed(l[0]));
    toast('SmartArt “' + l[1] + '” inserido. Escreva os itens no painel à direita (um por linha, Tab = nível abaixo); trocar o layout mantém o texto.');
    setTimeout(function () { previewEl(ne); }, 250); return ne;
  }
  function smartItems() {
    var out = [], groups = [], by = {};
    smartLayouts().forEach(function (l) { if (!by[l[2]]) { by[l[2]] = []; groups.push(l[2]); } by[l[2]].push(l); }); /* por grupo, na ordem em que cada grupo aparece (um layout novo no fim do registro entra no seu grupo) */
    groups.forEach(function (g) { out.push({ hd: g }); by[g].forEach(function (l) { out.push({ t: l[1], raw: RT.smartIcon(l[0], 'shp sa'), fn: function () { insertSmart(l[0]); } }); }); });
    out.cls = 'xcols xsa'; return out; /* xsa: mais largo, para “Processo em chevrons” não cortar */
  }
  function buildSmartMenu() {
    var m = $('#mSmart'), L = smartLayouts(), gs = []; if (!m) return;
    L.forEach(function (l) { var g = gs.filter(function (x) { return x[0] === l[2]; })[0]; if (!g) { g = [l[2], []]; gs.push(g); } g[1].push(l); });
    m.innerHTML = '<div class="mh">SmartArt · diagramas por texto</div>' + gs.map(function (g) { return '<div class="sh">' + esc(g[0]) + '</div><div class="grid">' + g[1].map(function (l) { return '<button type="button" data-smart="' + l[0] + '" draggable="true" title="' + esc(l[1] + ': ' + l[3]) + '">' + RT.smartIcon(l[0]) + '<span>' + esc(l[1]) + '</span></button>'; }).join('') + '</div>'; }).join('') +
      '<p class="sm-ft">Um item por linha no painel de texto; <b>Tab</b> = nível abaixo. Trocar o layout depois mantém os itens.</p>';
    m.addEventListener('dragstart', function (e) { var b = e.target.closest('[data-smart]'); if (!b) return; e.dataTransfer.setData('text/plain', 'amfx:smart::' + b.dataset.smart); e.dataTransfer.effectAllowed = 'copy'; });
  }
  buildSmartMenu();
  function chartItems() { var out = []; CH_GROUPS.forEach(function (g) { var ks = g[1].filter(function (k) { return RT.FX[k]; }); if (!ks.length) return; out.push({ hd: g[0] }); ks.forEach(function (k) { out.push({ t: RT.FX[k].name, raw: chartIcon(k, 'icx'), fn: function () { var ne = insertFx(k); toast('Gráfico inserido. Edite os dados no painel à direita.'); setTimeout(function () { previewEl(ne); }, 250); } }); }); }); return out; }
  $('#addSlide').addEventListener('click', function (e) { var m = $('#mSlide'), open = m.classList.contains('open'); closeMenus(); if (open) return; var r = e.currentTarget.getBoundingClientRect(); m.style.left = (r.left) + 'px'; m.style.top = Math.max(60, r.top - 330) + 'px'; m.classList.add('open'); });
  function addSlide(layout) { if (editingId) endEdit(); deck.slides.splice(cur + 1, 0, kitSlide(mkSlide(layout))); cur++; pick([]); renderAll(); commit(); }
  /* S28: blocos prontos = sequências de layouts, inseridas depois do slide atual (um Ctrl+Z tira o bloco inteiro) */
  var SEQS = [['proposal', 'Proposta comercial', ['cover', 'agenda', 'content', 'roadmap', 'compare', 'closing']], ['panel', 'Painel executivo', ['section', 'dashboard', 'kpis']], ['roadmap', 'Roadmap de transformação', ['section', 'roadmap', 'next']], ['exec', 'Apresentação executiva', ['cover', 'exec', 'content', 'next', 'closing']]];
  function insertSeq(key) {
    var sq = SEQS.filter(function (x) { return x[0] === key; })[0]; if (!sq) return;
    if (editingId) endEdit(); var ins = sq[2].map(function (k) { return kitSlide(mkSlide(k)); });
    Array.prototype.splice.apply(deck.slides, [cur + 1, 0].concat(ins)); cur++; pick([]); setZone('thumbs'); renderAll(); commit();
    var th = $('#thumbs .th.on'); if (th && th.scrollIntoView) th.scrollIntoView({ block: 'nearest' });
    toast(sq[1] + ': ' + ins.length + ' slides inseridos depois do slide ' + cur + ' · Ctrl+Z desfaz');
  }
  function seqItems() { return SEQS.map(function (sq) { return { t: sq[1] + ' (' + sq[2].length + ' slides)', ic: 'models', tip: sq[2].map(function (k) { return LAYOUTS[k].name; }).join(' · '), fn: function () { insertSeq(sq[0]); } }; }); }

  /* ---------------- ícones animados: seletor “Ícones” (popover .menu.icmenu; não o #modal, que engole Enter, Tab e Ctrl+A) ----------------
     Busca sem acento (todas as palavras), chips por tema, grade de 6 colunas com prévia do movimento ao passar o mouse,
     teclado (setas na grade, Enter/Espaço escolhem, qualquer letra vai para a busca, Esc fecha e devolve o foco).
     Nada selecionado: insere no centro (traço branco em slide escuro). Um ícone selecionado: troca o desenho e mantém o resto. */
  var IC_FAV = ['target', 'rocket', 'chartup', 'gear', 'users', 'shield', 'clock', 'idea'];
  var IC_CHIP = { estrategia: 'Estratégia', tecnologia: 'Inovação', operacoes: 'Operações', financas: 'Finanças', pessoas: 'Pessoas', risco: 'Risco', tempo: 'Tempo', mercado: 'Mercado & ESG', morph: 'Transformações' };
  var icp = { g: 'all', q: '', opener: null, hot: null, over: null, n: 0 };
  function icGroup(g) { var r = (RT.ICON_GROUPS || []).filter(function (x) { return x[0] === g; })[0]; return r ? r[1] : ''; }
  function icKw(ic) { return norm(ic.n + ' ' + ic.kw + ' ' + icGroup(ic.g)); }
  function icShort(n) { return String(n).split(' /')[0]; }
  /* nome em até 2 linhas na peça de 66 px: palavra longa ganha um hífen opcional numa fronteira de sílaba (vogal | consoante + vogal), perto do meio */
  function icHy(t) {
    var V = /[aeiouáéíóúâêôãõà]/i;
    return String(t).split(' ').map(function (w) {
      if (w.length < 10) return w; var m = w.length >> 1, best = -1;
      for (var d = 0; d < m - 2 && best < 0; d++) [m - d, m + d].forEach(function (i) { if (best < 0 && i > 2 && i < w.length - 3 && V.test(w[i - 1]) && !V.test(w[i]) && w[i] !== 'h' && V.test(w[i + 1])) best = i; });
      return best < 0 ? w : w.slice(0, best) + '\u00AD' + w.slice(best);
    }).join(' ');
  }
  function icMoName(ic) { return ((RT.IC_MO || {})[ic.m.split(':')[0]] || [''])[0]; }
  function icMorphs() { return (RT.ICON_MORPHS || []).map(function (m) { var a = RT.iconFind(m[2]), b = RT.iconFind(m[3]); return { k: m[0], n: m[1], kw: norm(m[1] + ' transformação morph ' + (a ? a.kw : m[2]) + ' ' + (b ? b.kw : m[3])) }; }); }
  function icOpen() { return $('#icMenu').classList.contains('open'); }
  function icTiles() { return $$('#icGrid .ict'); }
  function icTile(ic, morph) {
    var cur = sel(), on = cur && (morph ? cur.kind === 'iconmorph' && cur.data.pair === ic.k : cur.kind === 'icon' && cur.data.name === ic.k);
    var g = morph ? RT.FX.iconmorph.html({ pair: ic.k, bg: 'none' }, 64, 64, { variant: 'click' }) : RT.FX.icon.html({ name: ic.k, trig: 'hover', bg: 'none' }, 64, 64, { variant: 'auto', anim: {} });
    return '<button type="button" class="ict am-play am-in' + (on ? ' cur' : '') + '" tabindex="-1" draggable="true" ' + (morph ? 'data-mp' : 'data-ic') + '="' + ic.k + '" aria-label="' + esc(ic.n) + '" title="' + esc(ic.n + (morph ? '' : ' · ' + icGroup(ic.g))) + '"><span class="ict-g">' + g + '</span><span class="ict-n">' + esc(icHy(morph ? ic.n : icShort(ic.n))) + '</span></button>';
  }
  function icRender() {
    var q = norm(icp.q).trim().split(/\s+/).filter(Boolean), L = RT.ICONS || [], M = icMorphs(), h = '', n = 0, flat = q.length || icp.g !== 'all';
    function ok(kw) { return q.every(function (w) { return kw.indexOf(w) >= 0; }); }
    (RT.ICON_GROUPS || []).forEach(function (g) {
      if (icp.g !== 'all' && icp.g !== g[0]) return;
      var t = L.filter(function (ic) { return ic.g === g[0] && ok(icKw(ic)); }); if (!t.length) return; n += t.length;
      h += (flat ? '' : '<div class="icp-gh">' + esc(g[1]) + '</div>') + t.map(function (ic) { return icTile(ic, false); }).join('');
    });
    if (icp.g === 'all' || icp.g === 'morph') { var m = M.filter(function (x) { return ok(x.kw); }); if (m.length) { n += m.length; h += (flat ? '' : '<div class="icp-gh">Transformações <small>dois estados que se alternam</small></div>') + m.map(function (x) { return icTile(x, true); }).join(''); } }
    $('#icGrid').innerHTML = h || '<p class="icp-none">Nenhum ícone encontrado. Tente “meta”, “dados”, “pessoas” ou “prazo”.</p>';
    $$('#icMenu [data-icg]').forEach(function (c) { var on = c.dataset.icg === icp.g; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    var t = icTiles(), f = t.filter(function (x) { return x.classList.contains('cur'); })[0] || t[0];
    icMark(f || null); icFoot(q.length ? f : null, n); /* buscando: o rodapé mostra o que o Enter vai escolher */
  }
  function icFoot(b, n) {
    var ft = $('#icFt'); if (!ft) return; var el = sel(), mo = b ? !!b.dataset.mp : icp.g === 'morph', sw = el && el.kind === (mo ? 'iconmorph' : 'icon'), info = ''; /* troca só entre o mesmo tipo */
    if (b) { var ic = b.dataset.ic ? RT.iconFind(b.dataset.ic) : null, mp = b.dataset.mp ? icMorphs().filter(function (x) { return x.k === b.dataset.mp; })[0] : null;
      info = ic ? '<b>' + esc(icShort(ic.n)) + '</b> · ' + esc(icMoName(ic)) : mp ? '<b>' + esc(mp.n) + '</b> · transformação' : ''; }
    if (n != null) icp.n = n;
    ft.innerHTML = '<span class="icp-ro">' + (info || esc(plural(icp.n || 0, 'ícone', 'ícones'))) + '</span><span class="icp-k">' + (sw ? '<kbd>Enter</kbd> troca o selecionado · <kbd>Shift</kbd>+<kbd>Enter</kbd> insere novo' : '<kbd>Enter</kbd> insere no slide') + '</span>';
  }
  function icPlay(b) { var f = b && b.querySelector('.fxic'); if (!f) return; if (b.dataset.mp) { f.classList.add('ic-on'); return; } if (f.classList.contains('ic-go')) return; f.classList.add('ic-go'); setTimeout(function () { f.classList.remove('ic-go'); }, +f.dataset.ms || 2000); }
  function icStop(b) { var f = b && b.dataset.mp && b.querySelector('.fxic'); if (f) f.classList.remove('ic-on'); }
  function icMark(b) { icTiles().forEach(function (x) { x.tabIndex = x === b ? 0 : -1; x.classList.toggle('hot', x === b); }); icp.hot = b; }
  function icHot(b, focus) { icMark(b); icFoot(b); if (focus && b) { b.focus({ preventScroll: true }); b.scrollIntoView({ block: 'nearest' }); } icPlay(b); }
  function openIcons(opener, opts) {
    if (!RT.ICONS || !RT.FX.icon) return;
    opts = opts || {}; closeMenus(); stopPreview(); if (editingId) endEdit();
    var m = $('#icMenu'), cnt = { all: RT.ICONS.length + (RT.ICON_MORPHS || []).length, morph: (RT.ICON_MORPHS || []).length };
    RT.ICONS.forEach(function (ic) { cnt[ic.g] = (cnt[ic.g] || 0) + 1; });
    icp.g = opts.g || 'all'; icp.q = ''; icp.opener = opener && opener !== document.body ? opener : null;
    m.innerHTML = '<div class="icp-h"><span class="icp-eye">Ícones animados</span><label class="icp-s"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><input id="icQ" type="search" placeholder="Buscar ícone… (ex.: meta, risco, nuvem)" aria-label="Buscar ícone" autocomplete="off" spellcheck="false"></label></div>' +
      '<div class="icp-chips" role="group" aria-label="Filtrar por tema">' + [['all', 'Todos']].concat((RT.ICON_GROUPS || []).map(function (g) { return [g[0], IC_CHIP[g[0]] || g[1], g[1]]; })).concat([['morph', IC_CHIP.morph, 'Ícones que alternam entre dois estados']]).map(function (c) { return '<button type="button" data-icg="' + c[0] + '" aria-pressed="false" title="' + esc(c[2] || c[1]) + '">' + esc(c[1]) + ' <i>' + (cnt[c[0]] || 0) + '</i></button>'; }).join('') + '</div>' +
      '<div class="icp-grid" id="icGrid" role="group" aria-label="Ícones"></div><div class="icp-ft" id="icFt" aria-live="polite"></div>';
    m.classList.add('open'); m.style.left = '-9999px'; m.style.top = '0px'; icRender();
    var r = opener && opener.getBoundingClientRect && opener.offsetParent !== null ? opener.getBoundingClientRect() : { left: innerWidth / 2 - m.offsetWidth / 2, right: innerWidth / 2 + m.offsetWidth / 2, bottom: 110, top: 110 };
    var x = opts.right ? r.right - m.offsetWidth : r.left; x = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8));
    var y = r.bottom + 6; if (y + m.offsetHeight > innerHeight - 8) y = Math.max(8, innerHeight - m.offsetHeight - 8);
    m.style.left = Math.round(x) + 'px'; m.style.top = Math.round(y) + 'px';
    var rb = $('#bIcons'); if (rb && opener === rb) rb.classList.add('open');
    $('#icQ').focus();
  }
  function closeIcons(back) {
    var m = $('#icMenu'); if (!m.classList.contains('open')) return;
    var had = m.contains(document.activeElement); m.classList.remove('open'); m.innerHTML = ''; var rb = $('#bIcons'); if (rb) rb.classList.remove('open');
    if (back && icp.opener && document.contains(icp.opener) && icp.opener.offsetParent !== null) icp.opener.focus({ preventScroll: true }); else if (had && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    icp.opener = null;
  }
  /* escolher: troca o ícone selecionado (mesmo tipo) ou insere um novo no centro; Shift força inserir */
  function icPick(b, fresh) {
    var k = b.dataset.ic, mp = b.dataset.mp, el = sel(), ne, ic = k && RT.iconFind(k);
    closeIcons(false);
    if (mp) {
      var nm = (icMorphs().filter(function (x) { return x.k === mp; })[0] || {}).n || '';
      if (el && el.kind === 'iconmorph' && !fresh) { if (el.data.pair !== mp) { el.data.pair = mp; rerenderEl(el); commit(); renderProps(); } toast('Transformação: ' + nm + ' · Ctrl+Z desfaz'); previewEl(el); return; }
      ne = insertFx('iconmorph', null, null, null, { pair: mp }); toast('“' + nm + '” inserido · Ctrl+Z desfaz'); setTimeout(function () { previewEl(ne); }, 250); return;
    }
    if (!ic) return;
    if (el && el.kind === 'icon' && !fresh) { if (el.data.name !== k) { el.data.name = k; rerenderEl(el); commit(); renderProps(); } toast('Ícone trocado: ' + icShort(ic.n) + ' · Ctrl+Z desfaz'); previewEl(el); return; }
    ne = insertFx('icon', null, null, null, { name: k }); toast('Ícone “' + icShort(ic.n) + '” inserido · Ctrl+Z desfaz'); setTimeout(function () { previewEl(ne); }, 250);
  }
  /* setas na grade: ← → seguem a ordem; ↑ ↓ vão para a linha de cima/baixo, na coluna mais próxima (os títulos de tema quebram as linhas) */
  function icMove(b, k) {
    var t = icTiles(), i = t.indexOf(b); if (!t.length) return null;
    if (i < 0) return t[0];
    if (k === 'ArrowLeft') return t[Math.max(0, i - 1)]; if (k === 'ArrowRight') return t[Math.min(t.length - 1, i + 1)];
    if (k === 'Home') return t[0]; if (k === 'End') return t[t.length - 1];
    var r0 = b.getBoundingClientRect(), dn = k === 'ArrowDown' || k === 'PageDown', rows = {}, best = null, row = null;
    t.forEach(function (x) { var r = x.getBoundingClientRect(), dy = r.top - r0.top; if (dn ? dy > 4 : dy < -4) { var key = Math.round(r.top); (rows[key] = rows[key] || []).push(x); } });
    Object.keys(rows).forEach(function (y) { if (row == null || (dn ? +y < row : +y > row)) row = +y; });
    if (row == null) return b;
    rows[row].forEach(function (x) { var d = Math.abs(x.getBoundingClientRect().left - r0.left); if (!best || d < best.d) best = { x: x, d: d }; });
    return best.x;
  }
  /* teclado com o seletor aberto (chamado pelo keydown do editor antes de qualquer atalho). true = a tecla é do seletor */
  function icKey(e) {
    var k = e.key, t = e.target, inQ = t && t.id === 'icQ', tiles = icTiles(), i = tiles.indexOf(t), m = $('#icMenu');
    if (!m.contains(t) && t !== document.body) { closeIcons(false); return false; }
    if (k === 'Escape') { e.preventDefault(); closeIcons(true); return true; }
    if (e.ctrlKey || e.metaKey || /^F\d+$/.test(k)) { if (inQ && !/^F\d+$/.test(k)) return true; closeIcons(false); return false; } /* Ctrl+S, F1 etc. seguem para o editor */
    if (k === 'Tab') {
      e.preventDefault(); var f = [$('#icQ')].concat($$('#icMenu [data-icg]')).concat(tiles.filter(function (x) { return x.tabIndex === 0; })), j = f.indexOf(t);
      var n = f[(j + (e.shiftKey ? -1 : 1) + f.length) % f.length]; if (n) n.focus(); if (n && n.classList.contains('ict')) icHot(n, true); return true;
    }
    if ((k === 'Enter' && (inQ || i >= 0)) || (k === ' ' && i >= 0)) { e.preventDefault(); var b = i >= 0 ? t : icp.hot; if (b) icPick(b, e.shiftKey); return true; }
    if (k === 'ArrowDown' && inQ) { e.preventDefault(); if (icp.hot) icHot(icp.hot, true); return true; }
    if (/^(Arrow|Home|End|Page)/.test(k) && i >= 0) { e.preventDefault(); var nx = icMove(t, k); if (nx === t && (k === 'ArrowUp' || k === 'PageUp')) { $('#icQ').focus(); return true; } if (nx) icHot(nx, true); return true; }
    if (/^Arrow(Left|Right)$/.test(k) && t.dataset && t.dataset.icg) { e.preventDefault(); var cs = $$('#icMenu [data-icg]'), ci = cs.indexOf(t); cs[(ci + (k === 'ArrowRight' ? 1 : -1) + cs.length) % cs.length].focus(); return true; }
    if (k === 'ArrowDown' && t.dataset && t.dataset.icg) { e.preventDefault(); if (icp.hot) icHot(icp.hot, true); return true; }
    if (!inQ && ((k.length === 1 && k !== ' ') || k === 'Backspace') && !e.altKey) { $('#icQ').focus(); return true; } /* a letra cai na busca (Espaço num chip continua sendo o clique do chip) */
    return true;
  }
  $('#icMenu').addEventListener('input', function (e) { if (e.target.id !== 'icQ') return; icp.q = e.target.value; icRender(); });
  $('#icMenu').addEventListener('click', function (e) {
    var c = e.target.closest('[data-icg]'); if (c) { icp.g = c.dataset.icg; icRender(); $('#icGrid').scrollTop = 0; return; }
    var b = e.target.closest('.ict'); if (b) icPick(b, e.shiftKey);
  });
  $('#icMenu').addEventListener('pointerover', function (e) { var b = e.target.closest('.ict'); if (b && b !== icp.over) { icStop(icp.over); icp.over = b; icFoot(b); icPlay(b); } });
  $('#icMenu').addEventListener('pointerleave', function () { icStop(icp.over); icp.over = null; icFoot(icp.q || $('#icMenu').contains(document.activeElement) && document.activeElement.classList.contains('ict') ? icp.hot : null); });
  $('#icMenu').addEventListener('focusin', function (e) { var b = e.target.closest && e.target.closest('.ict'); if (b) { icp.hot = b; icFoot(b); icPlay(b); } });
  $('#icMenu').addEventListener('focusout', function (e) { var b = e.target.closest && e.target.closest('.ict'); if (b) icStop(b); });
  $('#icMenu').addEventListener('dragstart', function (e) { var b = e.target.closest('.ict'); if (!b) return; e.dataTransfer.setData('text/plain', b.dataset.mp ? 'amfx:iconmorph::' + b.dataset.mp : 'amfx:icon::' + b.dataset.ic); e.dataTransfer.effectAllowed = 'copy'; });
  /* Inserir › Ícone animado ▸: os 8 mais usados + “Ver todos” */
  function iconItems() {
    return IC_FAV.map(function (k) { var ic = RT.iconFind(k); return ic ? { t: icShort(ic.n), raw: RT.iconSVG(k), fn: function () { var ne = insertFx('icon', null, null, null, { name: k }); toast('Ícone “' + icShort(ic.n) + '” inserido · Ctrl+Z desfaz'); setTimeout(function () { previewEl(ne); }, 250); } } : null; })
      .concat([{ sep: 1 }, { t: 'Ver todos os ícones…', ic: 'icons', fn: function () { openIcons($('#bIcons')); } }]);
  }

  /* ---------------- slides (lateral) ---------------- */
  function freshSlide(s) { var c = clone(s), map = {}; c.id = uid(); c.els = (c.els || []).map(function (x) { map[x.id] = uid(); x.id = map[x.id]; return x; }); remapLinks(c.els, map); return c; }
  function dupSlide(i) { if (i == null) i = cur; if (editingId) endEdit(); deck.slides.splice(i + 1, 0, freshSlide(deck.slides[i])); cur = i + 1; pick([]); renderAll(); commit(); }
  function delSlide(i) {
    if (i == null) i = cur; if (editingId) endEdit();
    if (deck.slides.length <= 1) { toast('A apresentação precisa ter ao menos um slide. Use “Limpar slide” para esvaziá-lo.'); return false; }
    deck.slides.splice(i, 1); if (i < cur || cur >= deck.slides.length) cur--; cur = Math.max(0, cur); pick([]); renderAll(); commit(); return true;
  }
  function moveSlide(i, d) {
    var j = i + d; if (j < 0 || j >= deck.slides.length) return; if (editingId) endEdit();
    var s = deck.slides.splice(i, 1)[0]; deck.slides.splice(j, 0, s); cur = j; pick([]); renderAll(); commit();
  }
  function newSlideAfter() { addSlide(isDark(slide().bg) ? 'blank-dark' : 'blank-light'); }
  var thumbs = $('#thumbs'), dragFrom = null;
  thumbs.addEventListener('pointerdown', function (e) { if (e.target.closest('.th')) { if (editingId) endEdit(); setZone('thumbs'); } });
  thumbs.addEventListener('click', function (e) {
    var t = e.target.closest('.th'); if (!t) return; var i = +t.dataset.i, b = e.target.closest('[data-ta]');
    setZone('thumbs');
    if (b && b.dataset.ta === 'dup') { dupSlide(i); return; }
    if (b && b.dataset.ta === 'del') { delSlide(i); return; }
    goSlide(i);
  });
  thumbs.addEventListener('dragstart', function (e) { var t = e.target.closest('.th'); if (!t) return; dragFrom = +t.dataset.i; e.dataTransfer.setData('text/plain', 'slide'); e.dataTransfer.effectAllowed = 'move'; });
  /* posição de inserção (0…n) sob o ponteiro: sobre uma miniatura = antes dela; num vão (margem, espaço entre colunas ou entre linhas)
     = antes da miniatura seguinte daquela linha/coluna; abaixo da última linha, ou na casa vazia ao lado da última = no fim */
  function dropIndex(e) {
    var t = e.target.closest && e.target.closest('#thumbs .th'); if (t) return +t.dataset.i;
    var ths = $$('#thumbs .th'), n = ths.length, x = e.clientX, y = e.clientY; if (!n) return 0;
    var R = ths.map(function (q) { return q.getBoundingClientRect(); }), cols = 1, i = 0, j, k;
    while (cols < n && Math.abs(R[cols].top - R[0].top) < 2) cols++;
    while (i < n && R[i].bottom < y) i++; /* primeira linha que não fica toda acima do ponteiro */
    if (i === n) return n;
    for (j = i; j < n && Math.abs(R[j].top - R[i].top) < 2; j++); /* a linha é [i, j) */
    for (k = i; k < j; k++) if (x < R[k].right) return k;
    return j === n && j - i < cols ? n : j - 1; /* à direita da linha: antes da última dela (como soltar sobre ela); na linha final incompleta, no fim */
  }
  function dropMark(to) {
    $$('#thumbs .th.drop-before, #thumbs .th.drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
    var ths = $$('#thumbs .th'); if (to == null || !ths.length) return;
    if (to < ths.length) ths[to].classList.add('drop-before'); else ths[ths.length - 1].classList.add('drop-after');
  }
  thumbs.addEventListener('dragover', function (e) { if (dragFrom == null) return; e.preventDefault(); dropMark(dropIndex(e)); });
  thumbs.addEventListener('drop', function (e) { if (dragFrom == null) return; e.preventDefault(); var to = dropIndex(e); dropMark(null); var s = deck.slides.splice(dragFrom, 1)[0]; if (to > dragFrom) to--; deck.slides.splice(to, 0, s); cur = to; dragFrom = null; pick([]); renderAll(); commit(); });
  thumbs.addEventListener('dragend', function () { dragFrom = null; dropMark(null); });

  /* ---------------- painel de slides: largura ajustável e recolher (S18) ----------------
     --side-w no <body> alimenta a grade; a divisória (#sideSplit) arrasta, aceita ← → Home End e duplo clique (padrão);
     recolhido vira uma faixa de 40 px (», posição "3/14", +). Largura e estado ficam no localStorage (amStudio.sideW / amStudio.sideOff). */
  /* SIDE_COLS2: 2 colunas só quando cada miniatura fica pelo menos do tamanho da miniatura na largura padrão
     (196 px → 147 px de largura; em 2 colunas: (w − 31) / 2 − 24 ≥ 147 ⇔ w ≥ 373) */
  var SIDE_MIN = 132, SIDE_DEF = 196, SIDE_MAX = 440, SIDE_OFF_W = 40, SIDE_COLS2 = 380;
  var sideW = SIDE_DEF, sideOff = false, sideRaf = 0, sideKey = '', sideFrz = 0, sideFree = false, sideWheel = 0, sideWheelT = 0;
  try {
    var sw0 = parseInt(localStorage.getItem('amStudio.sideW'), 10); if (isFinite(sw0)) sideW = sw0;
    sideOff = localStorage.getItem('amStudio.sideOff') === '1';
  } catch (e) { }
  function sideMax() { return Math.max(SIDE_MIN, Math.min(SIDE_MAX, innerWidth - 304 - 520)); }
  function sideClamp(w) { w = Math.round(+w); if (!isFinite(w)) w = SIDE_DEF; return Math.max(SIDE_MIN, Math.min(sideMax(), w)); }
  function sideSave() { try { localStorage.setItem('amStudio.sideW', String(sideW)); localStorage.setItem('amStudio.sideOff', sideOff ? '1' : '0'); } catch (e) { } }
  function sidePos() {
    var n = deck.slides.length, c = $('#sideCount'), ps = $('#sidePos');
    if (c) c.textContent = n;
    if (ps) { var hid = deck.slides[cur] && deck.slides[cur].hidden === true; ps.innerHTML = '<b></b><span></span>'; ps.firstChild.textContent = cur + 1; ps.lastChild.textContent = '/' + n; ps.title = 'Slide ' + (cur + 1) + ' de ' + n + (hid ? ' · oculto na apresentação' : ''); ps.classList.toggle('hid', hid); }
  }
  /* aplica a largura (sem salvar); a mesma largura vale para o recolhido voltar */
  function drawerOpen() { var d = $('#drawer'); return !!(d && d.classList.contains('open')); }
  /* largura à vista: com a Biblioteca aberta o painel fica no máximo na largura padrão, para a gaveta não cobrir metade do slide;
     se a pessoa ajustar a largura com a gaveta aberta, vale o que ela escolheu (sideFree) até a gaveta fechar */
  function sideNow() { var w = sideClamp(sideW); return drawerOpen() && !sideFree ? Math.min(w, SIDE_DEF) : w; }
  function sideTouch() { if (drawerOpen() && !sideFree) { sideW = sideNow(); sideFree = true; } return sideClamp(sideW); }
  function sideKeyNow() { var w = sideNow(); return sideOff ? 'off' : w + (w >= SIDE_COLS2 ? 'c' : ''); }
  /* a miniatura do slide atual fica no mesmo ponto da lista quando a largura muda (e, se estava fora, volta para a vista) */
  function keepThumb(on, rel) {
    var tb = $('#thumbs'), r = tb.getBoundingClientRect(), o = on.getBoundingClientRect();
    rel = Math.max(0, Math.min(rel, tb.clientHeight - o.height)); tb.scrollTop += (o.top - r.top) - rel;
  }
  function applySide() {
    var w = sideNow(), sp = $('#sideSplit'), cols = !sideOff && w >= SIDE_COLS2, key = sideKeyNow(), tb = $('#thumbs'), on = $('#thumbs .th.on'), rel = null;
    if (on && key !== sideKey && sideKey && sideKey !== 'off' && key !== 'off') rel = on.getBoundingClientRect().top - tb.getBoundingClientRect().top;
    document.body.style.setProperty('--side-w', (sideOff ? SIDE_OFF_W : w) + 'px');
    document.body.classList.toggle('side-off', sideOff);
    $('#side').classList.toggle('cols2', cols);
    if (sp) { sp.setAttribute('aria-valuenow', w); sp.setAttribute('aria-valuemax', sideMax()); sp.setAttribute('aria-valuemin', SIDE_MIN); sp.setAttribute('aria-valuetext', w + ' pixels'); }
    if (sideFrz) { var bx = $('#thumbs .th .box'); if (bx) tb.style.setProperty('--tk', bx.getBoundingClientRect().width / sideFrz); }
    if (rel != null) keepThumb(on, rel);
    sideKey = key;
    fit(); drawSel();
  }
  /* durante o arraste da divisória as miniaturas guardam o tamanho do início e só escalam (CSS #thumbs.frz): cada quadro refaz
     só as caixas, não o conteúdo dos slides; ao soltar, um único layout de verdade (as fora da vista ficam para quando aparecerem) */
  function freezeThumbs(on) {
    var tb = $('#thumbs');
    if (on) { var bx = !sideOff && $('#thumbs .th .box'), bw = bx ? bx.getBoundingClientRect().width : 0; if (!bw) return; sideFrz = bw; tb.style.setProperty('--tw0', bw + 'px'); tb.style.setProperty('--tk', '1'); tb.classList.add('frz'); }
    else if (sideFrz) { sideFrz = 0; tb.classList.remove('frz'); tb.style.removeProperty('--tw0'); tb.style.removeProperty('--tk'); }
  }
  function setSideW(w, save) { sideW = sideClamp(w); if (sideRaf) { cancelAnimationFrame(sideRaf); sideRaf = 0; } applySide(); if (save) sideSave(); }
  function sideLater(w) { sideW = sideClamp(w); if (!sideRaf) sideRaf = requestAnimationFrame(function () { sideRaf = 0; applySide(); }); }
  function toggleSide(off, kb) {
    off = off == null ? !sideOff : !!off; if (off === sideOff) return;
    var ae = document.activeElement, hadFocus = ae && $('#side').contains(ae);
    sideOff = off; applySide(); sideSave();
    if (off && zone === 'thumbs') setZone('canvas'); /* miniaturas escondidas: setas, Delete, Ctrl+D e Shift+F10 voltam a agir no slide à vista */
    var on = $('#thumbs .th.on'); if (!off && on) on.scrollIntoView({ block: 'nearest' });
    /* pelo teclado o foco passa ao botão par (« ↔ »); com o mouse o botão solta o foco, e ↓/PageDown/Espaço voltam ao slide */
    if (hadFocus) { if (kb) { var f = $(off ? '#sideExpand' : '#sideCollapse'); if (f) f.focus(); } else ae.blur(); }
  }
  var split = $('#sideSplit'), sDrag = null;
  split.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return; e.preventDefault(); closeMenus();
    sDrag = { x: e.clientX, w: sideTouch(), id: e.pointerId };
    try { split.setPointerCapture(e.pointerId); } catch (er) { }
    split.classList.add('drag'); document.body.classList.add('side-drag'); freezeThumbs(true);
  });
  split.addEventListener('pointermove', function (e) { if (sDrag && e.pointerId === sDrag.id) sideLater(sDrag.w + e.clientX - sDrag.x); });
  function endSideDrag(e) {
    if (!sDrag || (e && e.pointerId !== sDrag.id)) return;
    if (e && e.type === 'pointerup') sideW = sideClamp(sDrag.w + e.clientX - sDrag.x);
    sDrag = null; split.classList.remove('drag'); document.body.classList.remove('side-drag'); freezeThumbs(false); setSideW(sideW, true);
  }
  split.addEventListener('pointerup', endSideDrag);
  split.addEventListener('pointercancel', endSideDrag);
  split.addEventListener('lostpointercapture', endSideDrag);
  /* Esc durante o arraste cancela: volta à largura do início e não salva (como girar/redimensionar no slide) */
  addEventListener('keydown', function (e) {
    if (!sDrag || e.key !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation();
    var d = sDrag; sDrag = null; try { split.releasePointerCapture(d.id); } catch (er) { }
    split.classList.remove('drag'); document.body.classList.remove('side-drag'); freezeThumbs(false); setSideW(d.w, false);
  }, true);
  split.addEventListener('dblclick', function () { sideTouch(); setSideW(SIDE_DEF, true); toast('Painel de slides na largura padrão'); });
  split.addEventListener('keydown', function (e) {
    var w = sideNow(), st = e.shiftKey ? 64 : 16, n = null;
    if (e.key === 'ArrowLeft') n = w - st; else if (e.key === 'ArrowRight') n = w + st;
    else if (e.key === 'Home') n = SIDE_MIN; else if (e.key === 'End') n = sideMax();
    else if (e.key === 'Enter' || e.key === ' ') n = SIDE_DEF;
    if (n == null || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); sideTouch(); setSideW(n, true);
  });
  /* Ctrl/⌘ + rolar sobre as miniaturas muda a largura (no lugar do zoom da página): proporcional ao giro (16 px por “dente” de 100),
     no máximo 16 px por evento, para a pinça do trackpad (muitos eventos pequenos) não saltar; aplica no quadro seguinte e salva quando para */
  $('#side').addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey) || sideOff || !e.deltaY) return;
    e.preventDefault();
    var dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
    sideWheel += Math.max(-16, Math.min(16, -dy * 0.16));
    var n = sideWheel < 0 ? Math.ceil(sideWheel) : Math.floor(sideWheel); if (!n) return;
    sideWheel -= n; sideLater(sideTouch() + n);
    clearTimeout(sideWheelT); sideWheelT = setTimeout(sideSave, 300);
  }, { passive: false });
  $('#sideCollapse').addEventListener('click', function (e) { toggleSide(true, !e.detail); });
  $('#sideExpand').addEventListener('click', function (e) { toggleSide(false, !e.detail); });
  $('#sideAdd').addEventListener('click', function (e) {
    var m = $('#mSlide'), open = m.classList.contains('open'); closeMenus(); if (open) return;
    var r = e.currentTarget.getBoundingClientRect(); m.classList.add('open');
    m.style.left = (r.right + 8) + 'px'; m.style.top = Math.max(60, Math.min(r.top, innerHeight - m.offsetHeight - 8)) + 'px';
    /* pelo teclado (Enter/Espaço) o foco entra no primeiro layout; Esc fecha e devolve o foco ao + */
    if (!e.detail) { var f = m.querySelector('button[data-layout]'); if (f) f.focus(); menuFrom = { m: m, b: e.currentTarget }; }
  });

  /* ---------------- canvas: selecionar, mover, redimensionar, editar ---------------- */
  function toLogical(e) { var r = wrap.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
  function select(id) { if (id ? (selIds.length === 1 && selId === id) : !selIds.length) return; setSel(id ? [id] : []); }
  function stageNode(t) { var n = t && t.closest && t.closest('.am-el'); return n && stage && stage.contains(n) ? n : null; }
  $('#cv').addEventListener('pointerdown', function (e) {
    stopPreview(); if (e.button !== 0) return;
    setZone('canvas');
    if (e.target.closest('#fxArrow')) { e.preventDefault(); openVarMenu(e.target.closest('#fxArrow')); return; }
    if (e.target.closest('#frBar,#txBar')) { e.preventDefault(); return; } /* barras do quadro e do texto: o clique age (selLayer click); a seleção e a edição ficam */
    if (e.target.closest('.rhdl')) { e.preventDefault(); if (anyLocked()) { lockHint(); return; } startRotate(e); return; }
    var hd = e.target.closest('.hdl');
    if (hd) { e.preventDefault(); if (anyLocked()) { lockHint(); return; } startResize(e, hd.dataset.h); return; }
    var n = stageNode(e.target);
    if (editingId) { var en = stage.querySelector('.am-el[data-id="' + editingId + '"]'); if (en && en.contains(e.target) && (e.target.isContentEditable || e.target.closest('[contenteditable]'))) return; var ae = document.activeElement; if (ae && ae.dataset && ae.dataset.e) ae.blur(); else endEdit(); }
    var multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!n) { startMarquee(e, multi); return; }
    var id = n.dataset.id; if (!getEl(id)) return;
    var gids = withGroups([id]); /* S27: membro de grupo → o grupo inteiro; bloqueado → seleciona, não arrasta */
    if (multi) {
      if (selIds.indexOf(id) >= 0) { setSel(selIds.filter(function (x) { return gids.indexOf(x) < 0; })); return; }
      setSel(selIds.concat(gids.filter(function (x) { return selIds.indexOf(x) < 0; })), id); if (anyLocked()) { lockHint(); return; } startMove(e, sels(), null); return;
    }
    if (selIds.length > 1 && selIds.indexOf(id) >= 0) { selId = id; if (anyLocked()) { lockHint(); return; } startMove(e, sels(), null, id); return; }
    if (gids.length > 1) { setSel(gids, id); if (anyLocked()) { lockHint(); return; } startMove(e, sels(), null, null); return; } /* 1º clique = o grupo; clicar de novo num membro do grupo já selecionado = só ele (caminho acima) */
    var wasSel = selIds.length === 1 && selId === id; select(id); if (isLocked(getEl(id))) { lockHint(); return; } startMove(e, [getEl(id)], wasSel ? e.target.closest('[data-cyc]') : null);
  });
  /* barra do quadro (girar 90° / inverter): o mouse não tira o foco nem a seleção; o clique age em toda a seleção */
  selLayer.addEventListener('mousedown', function (e) { if (e.target.closest('#frBar')) e.preventDefault(); });
  selLayer.addEventListener('click', function (e) { var b = e.target.closest('#frBar button[data-fr]'); if (!b) return; e.stopPropagation(); pinBar(); act(b.dataset.fr); });
  /* laço de seleção: arrastar no espaço vazio seleciona os elementos tocados (Shift soma) */
  function startMarquee(e, add) {
    var p0 = toLogical(e), base = add ? selIds.slice() : [], moved = false, mq = $('#marq');
    if (!add) select(null);
    function mv(ev) {
      var p = toLogical(ev); if (!moved && Math.abs(p.x - p0.x) < 4 && Math.abs(p.y - p0.y) < 4) return; moved = true; busy = 'marq';
      var r = { x: Math.min(p.x, p0.x), y: Math.min(p.y, p0.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      mq.style.cssText = boxCss(r); mq.classList.add('on');
      var hit = slide().els.filter(function (el) { var b = aabb(el), pad = el.type === 'line' ? 4 : 0; return b.x - pad < r.x + r.w && b.x + b.w + pad > r.x && b.y - pad < r.y + r.h && b.y + b.h + pad > r.y; }).map(function (el) { return el.id; });
      var hg = withGroups(hit), ids = base.concat(hg.filter(function (id) { return base.indexOf(id) < 0; })); /* S27: o laço pega grupos inteiros */
      selIds = ids; selId = ids.length ? ids[ids.length - 1] : null; drawSel();
    }
    function up() {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); mq.classList.remove('on');
      if (busy === 'marq') busy = null;
      if (moved) setSel(selIds, selId);
    }
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  /* mover um elemento ou um grupo; guias de alinhamento pelo contorno do grupo (Alt desliga) */
  function startMove(e, list, cyc, collapseTo) {
    var p0 = toLogical(e), moved = false, b0 = groupBox(list), ids = list.map(function (el) { return el.id; });
    var s0 = list.map(function (el) { return el.type === 'line' ? [el.x1, el.y1, el.x2, el.y2] : [el.x, el.y]; });
    var others = slide().els.filter(function (o) { return ids.indexOf(o.id) < 0; }).map(aabb); /* guias pelo desenho girado (a caixa que o contém), não pela caixa sem giro */
    function mv(ev) {
      var p = toLogical(ev), dx = p.x - p0.x, dy = p.y - p0.y;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return; if (!moved) detachMoved(list); moved = true; busy = 'move';
      var nx = b0.x + dx, ny = b0.y + dy, g = [];
      if (!ev.altKey) {
        var xs = [0, W / 2, W], ys = [0, H / 2, H]; others.forEach(function (o) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); });
        var bx = null, by = null;
        [0, b0.w / 2, b0.w].forEach(function (off) { xs.forEach(function (c) { var d = c - (nx + off); if (Math.abs(d) < 6 && (bx == null || Math.abs(d) < Math.abs(bx.d))) bx = { d: d, c: c }; }); });
        [0, b0.h / 2, b0.h].forEach(function (off) { ys.forEach(function (c) { var d = c - (ny + off); if (Math.abs(d) < 6 && (by == null || Math.abs(d) < Math.abs(by.d))) by = { d: d, c: c }; }); });
        if (bx) { nx += bx.d; g.push({ v: bx.c }); } if (by) { ny += by.d; g.push({ h: by.c }); }
      }
      var ddx = Math.round(nx - b0.x), ddy = Math.round(ny - b0.y);
      list.forEach(function (el, i) { var s = s0[i]; if (el.type === 'line') { el.x1 = s[0] + ddx; el.y1 = s[1] + ddy; el.x2 = s[2] + ddx; el.y2 = s[3] + ddy; } else { el.x = s[0] + ddx; el.y = s[1] + ddy; } posNode(el); });
      drawSel(g);
    }
    function up() {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      if (busy === 'move') busy = null;
      if (moved) { drawSel(); commit(); renderProps(); return; }
      if (collapseTo) { select(collapseTo); return; }
      var el = list[0];
      /* célula que cicla ao clicar: RACI (R → A → C → I → –) ou a sequência própria do modelo (data-cyc-seq, ex.: bolas de Harvey 0 → 4) */
      if (cyc && el && el.type === 'fx') { var path = cyc.dataset.cyc, seq = cyc.dataset.cycSeq ? cyc.dataset.cycSeq.split(',') : ['R', 'A', 'C', 'I', '-'], raw0 = getPath(el.data, path), cur0 = cyc.dataset.cycSeq ? String(raw0 == null ? '' : raw0).trim() : String(raw0 || '-').toUpperCase().charAt(0), nx = seq[(seq.indexOf(cur0) + 1) % seq.length]; setPath(el.data, path, cyc.dataset.cycSeq && /^-?\d+(\.\d+)?$/.test(nx) ? +nx : nx); rerenderEl(el); commit(); renderProps(); }
    }
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function startFxEdit(el, span) {
    pick([el.id]); editingId = el.id;
    var n = stage.querySelector('.am-el[data-id="' + el.id + '"]'); n.classList.add('editing');
    try { span.contentEditable = 'plaintext-only'; } catch (er) { span.contentEditable = 'true'; }
    if (span.contentEditable !== 'plaintext-only') span.contentEditable = 'true';
    span.focus(); var r = document.createRange(); r.selectNodeContents(span); var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    span.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); span.blur(); } };
    span.onpaste = function (ev) { ev.preventDefault(); document.execCommand('insertText', false, clipPlain((ev.clipboardData || window.clipboardData).getData('text/plain')).replace(/\s+/g, ' ')); };
    span.onblur = function () {
      if (editingId !== el.id) return; editingId = null;
      var val = span.textContent.replace(/\s+/g, ' ').trim(), path = span.dataset.e, ep = span.getAttribute('data-ep') || '';
      if (ep && val && val.indexOf(ep.trim()) !== 0) val = ep + val; /* prefixo escondido na tela (SmartArt Venn “= ”) volta ao gravar */
      try { setPath(el.data, path, val); } catch (er) { toast('Não foi possível gravar este texto: o dado do modelo está em texto; edite-o pelo painel.'); } /* lista guardada como texto num arquivo editado à mão (modelo sem gancho norm): nunca deixa a edição presa */
      n.classList.remove('editing'); rerenderEl(el); commit(); renderProps();
    };
    drawSel();
  }
  /* alça de girar: gira em torno do centro, com o ângulo ao vivo junto do ponteiro; Shift = passos de 15°; sem Shift, ímã em 0/90/180/270 (±3°).
     Um passo de desfazer ao soltar */
  function startRotate(e) {
    var el = sel(); if (!el || el.type === 'line') return;
    var cx = el.x + el.w / 2, cy = el.y + el.h / 2, p0 = toLogical(e), a0 = Math.atan2(p0.y - cy, p0.x - cx), r0 = +el.rot || 0, moved = false;
    var node = stage.querySelector('.am-el[data-id="' + el.id + '"]'), rn = node && node.querySelector(':scope>.am-rot');
    stopPreview(); busy = 'rotate'; document.body.classList.add('am-rotating');
    function mv(ev) {
      var p = toLogical(ev), r = r0 + (Math.atan2(p.y - cy, p.x - cx) - a0) * 180 / Math.PI;
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      else { var m = Math.round(r / 90) * 90; if (Math.abs(r - m) <= 3) r = m; }
      r = normRot(r); moved = true;
      if (r) el.rot = r; else delete el.rot;
      rotTip = { x: p.x, y: p.y, a: r };
      /* o conteúdo não depende do giro: durante o arraste só o transform do .am-rot muda (sem refazer a foto de vários MB a cada movimento) */
      if (rn) { rn.style.transform = r ? 'rotate(' + r + 'deg)' : ''; drawSel(); } else rerenderEl(el);
    }
    function up() {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      busy = null; rotTip = null; document.body.classList.remove('am-rotating'); drawSel();
      if (moved) { commit(); renderProps(); }
    }
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function startResize(e, h) {
    var pend; /* S32: alvo da ponta arrastada */
    var el = sel(); if (!el) return;
    var p0 = toLogical(e), o = clone(el), keep = el.type === 'image';
    /* elemento girado: o arraste vira coordenada local (gira −θ); a caixa nova volta ao mundo pelo centro, então a alça oposta fica parada na tela */
    var th = el.type === 'line' ? 0 : (+el.rot || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    busy = 'resize';
    function mv(ev) {
      var p = toLogical(ev), dx = p.x - p0.x, dy = p.y - p0.y;
      if (th) { var lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs; dx = lx; dy = ly; }
      if (h === 'bend') { /* dobra do cotovelo: posição do segmento do meio entre as pontas (5–95 %) */
        var bx = el.x2 - el.x1, by = el.y2 - el.y1, hz = Math.abs(bx) >= Math.abs(by), bv = hz ? (bx ? (p.x - el.x1) / bx : .5) : (by ? (p.y - el.y1) / by : .5);
        el.bend = Math.round(Math.max(.05, Math.min(.95, bv)) * 100) / 100;
      } else if (h === 'p1' || h === 'p2') {
        var k = h === 'p1' ? ['x1', 'y1', 'x2', 'y2'] : ['x2', 'y2', 'x1', 'y1'], x = Math.round(p.x), y = Math.round(p.y);
        if (ev.shiftKey) { var ax = el[k[2]], ay = el[k[3]], ang = Math.round(Math.atan2(y - ay, x - ax) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(x - ax, y - ay); x = Math.round(ax + Math.cos(ang) * len); y = Math.round(ay + Math.sin(ang) * len); }
        var tg = ev.altKey ? null : snapTarget(x, y, el.id); /* S32: perto de uma forma, a ponta prende nela (Alt = não) */
        if (tg) { var ap = anchorPt(tg.el, tg.s, el[k[2]], el[k[3]]); x = ap[0]; y = ap[1]; pend = { id: tg.el.id, s: tg.s }; } else pend = null;
        markTarget(tg && tg.el);
        el[k[0]] = x; el[k[1]] = y;
      } else {
        var x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (h.indexOf('w') >= 0) x0 = Math.min(x1 - 8, o.x + dx); if (h.indexOf('e') >= 0) x1 = Math.max(x0 + 8, o.x + o.w + dx);
        if (h.indexOf('n') >= 0) y0 = Math.min(y1 - 8, o.y + dy); if (h.indexOf('s') >= 0) y1 = Math.max(y0 + 8, o.y + o.h + dy);
        var nw = x1 - x0, nh = y1 - y0;
        if ((keep !== ev.shiftKey) && h.length === 2) { /* proporção travada: a escala segue o eixo mais arrastado (como no PowerPoint), para aumentar e diminuir com naturalidade */
          var sx = nw / o.w, sy = nh / o.h, sc = Math.max(8 / Math.min(o.w, o.h), Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy); nw = o.w * sc; nh = o.h * sc;
          if (h.indexOf('w') >= 0) x0 = x1 - nw; else x1 = x0 + nw; if (h.indexOf('n') >= 0) y0 = y1 - nh; else y1 = y0 + nh; }
        if (th) { var ocx = o.x + o.w / 2, ocy = o.y + o.h / 2, ux = (x0 + x1) / 2 - ocx, uy = (y0 + y1) / 2 - ocy; x0 = ocx + ux * cs - uy * sn - nw / 2; y0 = ocy + ux * sn + uy * cs - nh / 2; }
        el.x = Math.round(x0); el.y = Math.round(y0); el.w = Math.round(nw); el.h = Math.round(nh);
      }
      rerenderEl(el);
    }
    function up() {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); busy = null;
      if (h === 'p1' || h === 'p2') { var ak = h === 'p1' ? 'a1' : 'a2'; if (pend) el[ak] = pend; else if (pend === null) delete el[ak]; markTarget(null); if (el[ak]) toast('Ponta presa ' + (SIDE_N[el[ak].s] === 'Lado automático' ? '(lado automático)' : SIDE_N[el[ak].s].toLowerCase()) + ' · Alt ao arrastar = não prender'); }
      drawSel(); commit(); renderProps();
    }
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  wrap.addEventListener('dblclick', function (e) {
    stopPreview(); var n = stageNode(e.target);
    if (!n) { if (!e.target.closest('.hdl,#fxArrow,.gbox,.rhdl,#frBar,#txBar')) createTextAt(toLogical(e)); return; }
    var el = getEl(n.dataset.id); if (!el) return;
    if (el.type === 'text' || el.type === 'shape') { startEdit(el, false); selectWordAt(e.clientX, e.clientY, stage.querySelector('.am-el[data-id="' + el.id + '"] .am-tx')); }
    else if (el.type === 'image') act('replace');
    else if (el.type === 'fx') { var sp = e.target.closest('[data-e]'); if (sp) { startFxEdit(el, sp); return; } var f = $('#props [data-p^="data."]'); if (f) { f.focus(); if (f.select && f.tagName !== 'TEXTAREA') f.select(); } } /* num textarea (painel de texto, linhas) selecionar tudo apagaria o conteúdo ao digitar */
  });
  /* duplo clique numa palavra: entra em edição com a palavra selecionada (como no PowerPoint) */
  function selectWordAt(x, y, root) {
    if (!root) return; var r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) { var cp = document.caretPositionFromPoint(x, y); if (cp) { r = document.createRange(); r.setStart(cp.offsetNode, cp.offset); } }
    if (!r || !root.contains(r.startContainer)) return;
    var n = r.startContainer, wc = /[0-9A-Za-z\u00C0-\u024F_]/;
    if (n.nodeType === 3) { var t = n.data, a = r.startOffset, b = a; while (a > 0 && wc.test(t.charAt(a - 1))) a--; while (b < t.length && wc.test(t.charAt(b))) b++; r.setStart(n, a); r.setEnd(n, b); }
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  /* duplo clique no vazio: caixa de texto já em edição; se ficar vazia, some sem deixar rastro no histórico */
  function createTextAt(p) {
    if (editingId) endEdit();
    var w = 440, h = 34, el = kitify(mkText('body', { html: '', w: w, h: h, x: Math.round(Math.max(0, Math.min(W - w, p.x - 6))), y: Math.round(Math.max(0, Math.min(H - h, p.y - h / 2))) }, dark()));
    slide().els.push(el); pick([el.id]); renderStage(); freshId = el.id; startEdit(el, false); return el;
  }
  function startEdit(el, selectAll) {
    pick([el.id]); editingId = el.id; renderProps();
    var n = stage.querySelector('.am-el[data-id="' + el.id + '"]'), tx = n && n.querySelector('.am-tx'); if (!tx) return;
    n.classList.add('editing'); tx.contentEditable = 'true'; tx.focus();
    var r = document.createRange(); r.selectNodeContents(tx); if (!selectAll) r.collapse(false); var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    tx.oninput = function () {
      if (el.type !== 'text') return; var need = textNeed(n) + 4;
      if (need > el.h) {
        var r0 = +el.rot; growText(el, Math.min(H, Math.ceil(need))); n.style.height = pc(el.h, H);
        if (r0) { n.style.left = pc(el.x, W); n.style.top = pc(el.y, H); }
        ['h', 'x', 'y'].forEach(function (k) { var fi = $('#props [data-p="' + k + '"]'); if (fi && (k === 'h' || r0)) fi.value = Math.round(el[k] * 100) / 100; });
      }
      drawSel();
    };
    tx.onpaste = function (ev) { ev.preventDefault(); document.execCommand('insertText', false, clipPlain((ev.clipboardData || window.clipboardData).getData('text/plain'))); };
    tx.onblur = function () { if (txHold) { txHold = false; return; } setTimeout(function () { if (editingId === el.id && !txHold) endEdit(); }, 0); }; /* S26: o 1º blur ao abrir o seletor de cores não encerra */
    drawSel();
  }
  /* HTML de texto: só marcação simples (lista de permissão); <template> é inerte, nada carrega nem executa ao analisar */
  var KEEP_TAGS = /^(B|STRONG|I|EM|U|S|STRIKE|SUB|SUP|BR|SPAN|DIV|P|FONT|UL|OL|LI|SMALL|MARK)$/, DROP_TAGS = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|TEMPLATE|NOSCRIPT|LINK|META|BASE|FORM|INPUT|TEXTAREA|SELECT|BUTTON|IMG|VIDEO|AUDIO|CANVAS|FRAME|FRAMESET|TITLE|HEAD)$/;
  /* caracteres que o XML não aceita (controle C0, U+FFFE/FFFF) e surrogates sem par: vindos de colagens do PowerPoint/Word, quebravam o PDF e o
     PowerPoint inteiros (S22/S23). O U+000B é a quebra de linha “Shift+Enter” do Office: vira <br>; os outros somem; surrogate solto vira U+FFFD */
  var BAD_CH = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/;
  function cleanText(t) {
    return String(t == null ? '' : t).replace(/[\u0000-\u0008\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, function (m) { return m.length === 2 ? m : '\uFFFD'; });
  }
  function fixTextNode(x) {
    var v = x.nodeValue; if (!BAD_CH.test(v)) return;
    var parts = cleanText(v).split('\u000B'), pn = x.parentNode;
    parts.forEach(function (pt, i) { if (i) pn.insertBefore(document.createElement('br'), x); if (pt) pn.insertBefore(document.createTextNode(pt), x); });
    x.remove();
  }
  function cleanHTML(h) {
    var t = document.createElement('template'); t.innerHTML = String(h == null ? '' : h);
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (x) {
        if (x.nodeType === 3) { fixTextNode(x); return; }
        if (x.nodeType !== 1) { x.remove(); return; }
        var tag = x.tagName.toUpperCase();
        if (DROP_TAGS.test(tag)) { x.remove(); return; }
        walk(x);
        if (!KEEP_TAGS.test(tag)) { while (x.firstChild) x.parentNode.insertBefore(x.firstChild, x); x.remove(); return; }
        Array.prototype.slice.call(x.attributes).forEach(function (a) {
          var n = a.name.toLowerCase(), ok = (n === 'style' && !/url\s*\(|expression|javascript:|@import|[<>]/i.test(a.value)) || (tag === 'FONT' && (n === 'color' || n === 'face' || n === 'size') && !/[<>"]/.test(a.value));
          if (!ok) x.removeAttribute(a.name);
        });
      });
    })(t.content);
    var out = t.innerHTML.trim(); return out === '<br>' ? '' : out;
  }
  function endEdit() {
    var id = editingId; if (!id) return;
    var ae = document.activeElement; if (ae && ae.dataset && ae.dataset.e) { ae.blur(); return; }
    editingId = null;
    var el = getEl(id), n = stage.querySelector('.am-el[data-id="' + id + '"]'), tx = n && n.querySelector('.am-tx'), fresh = freshId === id; freshId = null;
    if (el && tx) {
      el.html = cleanHTML(tx.innerHTML); tx.contentEditable = 'false'; n.classList.remove('editing');
      if (fresh && !tx.textContent.replace(/\u00a0/g, ' ').trim()) { slide().els = slide().els.filter(function (x) { return x !== el; }); pick(selIds.filter(function (x) { return x !== id; })); renderStage(); renderProps(); commit(); return; }
      rerenderEl(el); fitTextEl(el);
    }
    commit(); renderProps();
  }

  /* ---------------- teclado e área de transferência ---------------- */
  function typingTarget(t) { return !!t && t.nodeType === 1 && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable); }
  function modalOpen() { return $('#modal').classList.contains('open'); }
  function presenting() { return $('#presenter').classList.contains('open'); }
  /* com a capa aberta, o editor não reage a teclado, área de transferência nem clique direito */
  function coverOpen() { try { return !!(window.AMCover && typeof window.AMCover.isOpen === 'function' && window.AMCover.isOpen()); } catch (er) { return false; } }
  /* formato: text/plain legível (e-mail, Teams, caixas de texto); o conteúdo do Canteiro vai num tipo próprio
     e num text/html marcado com data-amstudio (vale entre abas). "AMSTUDIO/1:" em texto é o formato antigo, só lido. */
  var CLIP_TAG = 'AMSTUDIO/1:', CLIP_MIME = 'application/x-amstudio+json', clipLocalNewer = false, cbWait = null;
  /* o que copiar: slides (miniatura em foco) ou os elementos selecionados */
  function payload(kind) {
    kind = kind || (zone === 'thumbs' ? 'slides' : 'els');
    if (kind === 'slides') return { slides: [clone(slide())], from: slide().id };
    var list = sels(); return list.length ? { els: clone(list), from: slide().id } : null;
  }
  function htmlText(h) {
    var t = document.createElement('template'); t.innerHTML = String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d)>/gi, '\n');
    return (t.content.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  var NOTEXT = DATA_TOKENS.concat(['kind', 'legend', 'panel', 'font', 'hl', 'highlight', 'bands', 'k']);
  function dataText(d) {
    var out = [];
    (function walk(v, k) { if (typeof v === 'string') { if (NOTEXT.indexOf(k) < 0 && v.length > 1 && /[A-Za-zÀ-ɏ]/.test(v) && !COLOR_RE.test(v)) out.push(v); } else if (Array.isArray(v)) v.forEach(function (x) { walk(x, k); }); else if (v && typeof v === 'object') Object.keys(v).forEach(function (kk) { walk(v[kk], kk); }); })(d, '');
    return out.join('\n');
  }
  /* texto legível do que foi copiado */
  function plainOf(p) {
    var list = (p && (p.els || (p.slides || []).reduce(function (a, s) { return a.concat((s && s.els) || []); }, []))) || [];
    return list.map(function (e) {
      if (!e) return '';
      if (e.type === 'text' || e.type === 'shape') return htmlText(e.html);
      if (e.type === 'fx') { var n = stage && typeof e.id === 'string' && /^[\w-]+$/.test(e.id) && stage.querySelector('.am-el[data-id="' + e.id + '"]'); return n && n.innerText ? n.innerText.replace(/\n{2,}/g, '\n').trim() : dataText(e.data); }
      return '';
    }).filter(Boolean).join('\n');
  }
  function payloadFromText(t) { try { return JSON.parse(String(t).slice(CLIP_TAG.length)); } catch (er) { return {}; } }
  /* texto colado num campo: conteúdo do Canteiro no formato antigo vira o texto legível dos elementos */
  function clipPlain(t) { t = String(t || ''); return t.indexOf(CLIP_TAG) === 0 ? plainOf(payloadFromText(t)) : t; }
  function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function clipHTML(p, plain) { return '<div data-amstudio="' + escAttr(JSON.stringify(p)) + '">' + (esc(plain).replace(/\n/g, '<br>') || '&nbsp;') + '</div>'; }
  function payloadFromHTML(h) {
    var m = /data-amstudio="([^"]*)"/.exec(String(h || '')); if (!m) return null;
    var t = document.createElement('textarea'); t.innerHTML = m[1]; try { return JSON.parse(t.value); } catch (er) { return {}; }
  }
  function payloadFromDT(cd) {
    var j = ''; try { j = cd.getData(CLIP_MIME); } catch (er) { }
    if (j) { try { return JSON.parse(j); } catch (er) { return {}; } }
    var p = payloadFromHTML(cd.getData('text/html')); if (p) return p;
    var t = cd.getData('text/plain'); return t && t.indexOf(CLIP_TAG) === 0 ? payloadFromText(t) : null;
  }
  function cutRemove(p) {
    if (p.slides) { if (deck.slides.length <= 1) { toast('Slide copiado. A apresentação precisa ter ao menos um slide.'); return; } delSlide(cur); toast('Slide recortado'); return; }
    delSel(); toast(p.els.length > 1 ? p.els.length + ' elementos recortados' : 'Elemento recortado');
  }
  /* cópia sem evento nativo (menus, atalho sintético): API assíncrona com texto legível + HTML marcado */
  function writeClip(p) {
    var cb = navigator.clipboard; clipLocalNewer = true; if (!cb) return;
    var plain = plainOf(p);
    try {
      if (window.ClipboardItem && cb.write) cb.write([new ClipboardItem({ 'text/plain': new Blob([plain], { type: 'text/plain' }), 'text/html': new Blob([clipHTML(p, plain)], { type: 'text/html' }) })]).then(function () { clipLocalNewer = false; }, function () { });
      else if (plain) cb.writeText(plain); /* sem o conteúdo do Canteiro: a cópia interna continua valendo */
    } catch (er) { }
  }
  function doCopy(cut, kind, quiet) {
    if (editingId) endEdit();
    var p = payload(kind); if (!p) { if (!quiet) toast('Selecione algo para ' + (cut ? 'recortar' : 'copiar') + '.'); return false; }
    clip = p; writeClip(p);
    if (cut) cutRemove(p); else toast(p.slides ? 'Slide copiado' : (p.els.length > 1 ? p.els.length + ' elementos copiados' : 'Elemento copiado'));
    return true;
  }
  /* cascata: +24 px por colagem, no primeiro lugar livre (depois de desfazer uma colagem, a vaga volta a valer) */
  function pasteOffset(list) {
    var els = slide().els;
    for (var n = 0; n < 30; n++) {
      var d = n * 24;
      if (!list.some(function (x) { var b = bbox(x); return els.some(function (o) { var q = bbox(o); return o.type === x.type && q.x === b.x + d && q.y === b.y + d && q.w === b.w && q.h === b.h; }); })) return d;
    }
    return 0;
  }
  /* tudo o que chega de fora passa pela mesma validação de arquivos abertos (tipos, números, cores, HTML limpo) */
  function pastePayload(p, at) {
    if (!p || typeof p !== 'object') return false;
    if (Array.isArray(p.slides) && p.slides.length) {
      var ins = p.slides.map(safeSlide).filter(Boolean).map(freshSlide).map(function (s) { return s.base ? s : stampSlide(s); }); if (!ins.length) return false; /* slide colado mantém base e ph (S21); vindo de versão antiga, ganha base */
      if (editingId) endEdit();
      Array.prototype.splice.apply(deck.slides, [cur + 1, 0].concat(ins)); cur = cur + 1; pick([]); setZone('thumbs'); renderAll(); commit();
      var on = $('#thumbs .th.on'); if (on) on.scrollIntoView({ block: 'nearest' });
      toast(ins.length > 1 ? ins.length + ' slides colados' : 'Slide colado'); return true;
    }
    if (Array.isArray(p.els) && p.els.length) {
      var list = remapGrp(p.els.map(safeEl).filter(Boolean)); if (!list.length) return false; /* S27: grupo colado é outro grupo */
      var off = pasteOffset(list), map = {}, els = remapLinks(list.map(function (x) { var c = clone(x); map[x.id] = c.id = uid(); delete c.ph; shift(c, off); return c; }), map);
      addEls(els); var nd = p.els.length - list.length; if (nd) toast(nd > 1 ? nd + ' elementos não reconhecidos ficaram de fora.' : '1 elemento não reconhecido ficou de fora.');
      return true;
    }
    return false;
  }
  function pasteAny(p, at) { if (pastePayload(p, at)) return true; toast('O conteúdo copiado não é reconhecido por esta versão do Canteiro.'); return false; }
  /* altura lógica que o conteúdo de um texto pede (o .am-tx encolhe dentro da caixa flex; scrollHeight não) */
  function textNeed(n) {
    var tx = n && n.querySelector('.am-tx'); if (!tx) return 0;
    var box = tx.parentNode, cs = getComputedStyle(box);
    return (Math.max(tx.scrollHeight, tx.offsetHeight) + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)) / wrap.clientWidth * W;
  }
  function fitTextEl(el) {
    var n = stage && stage.querySelector('.am-el[data-id="' + el.id + '"]'); if (!n || el.type !== 'text') return;
    var need = Math.ceil(textNeed(n) + 6); if (need > el.h) { growText(el, Math.min(need, H)); rerenderEl(el); }
  }
  /* texto que cresce ao digitar: sem giro, cresce para baixo (x/y iguais); girado, o meio da borda de cima (a primeira linha) fica parado
     no slide — o centro anda R(θ)(0, dh/2), então x −= dh/2·sen θ e y += dh/2·(cos θ − 1) */
  function growText(el, nh) {
    var dh = nh - el.h, t = (+el.rot || 0) * Math.PI / 180; el.h = nh;
    if (t && dh) { el.x = r2(el.x - dh / 2 * Math.sin(t)); el.y = r2(el.y + dh / 2 * (Math.cos(t) - 1)); }
  }
  function pastePlain(txt, at) {
    var t = cleanText(String(txt).replace(/\r\n?/g, '\n').replace(/\u000B/g, '\n')).replace(/\t/g, '    ').replace(/^\n+|\s+$/g, ''); if (!t) return false;
    var lines = t.split('\n'), w = t.length > 420 ? 900 : 560, rows = lines.reduce(function (a, l) { return a + Math.max(1, Math.ceil(l.length / (w / 9.6))); }, 0);
    var el = mkText('body', { html: lines.map(function (l) { return esc(l); }).join('<br>'), w: w }, dark()); el.h = Math.min(H - 40, Math.round(rows * el.size * el.lh + 8));
    if (at) { el.x = Math.round(Math.max(0, Math.min(W - el.w, at.x))); el.y = Math.round(Math.max(0, Math.min(H - el.h, at.y))); } else { el.x = Math.round((W - el.w) / 2); el.y = Math.round((H - el.h) / 2); }
    addEls([el], true); fitTextEl(el); drawSel(); commit(); toast('Texto colado'); return true;
  }
  function pasteImageBlob(blob, at) {
    readImage(blob, function (src, w, h) { var el = mkImage(src, w, h); if (at) { el.x = Math.round(Math.max(0, Math.min(W - el.w, at.x - el.w / 2))); el.y = Math.round(Math.max(0, Math.min(H - el.h, at.y - el.h / 2))); } addEl(el); toast('Imagem colada'); });
  }
  /* com imagem e texto juntos (ex.: Office), o texto vence; a imagem vale quando não há texto útil */
  function preferImage(txt) { var t = String(txt || '').trim(); return !t || /^\S+\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(t); }
  /* Editar › Colar durante a edição de um texto: insere no cursor, como Ctrl+V */
  function pasteIntoEdit() {
    var ae = document.activeElement, cb = navigator.clipboard; if (!ae || !ae.isContentEditable) return;
    var single = !!(ae.dataset && ae.dataset.e);
    function put(t) { t = clipPlain(t); if (single) t = t.replace(/\s+/g, ' '); if (document.activeElement !== ae) ae.focus(); if (t) document.execCommand('insertText', false, t); }
    if (!cb || !cb.readText) { toast('Use Ctrl+V para colar dentro do texto.'); return; }
    cb.readText().then(put, function () { toast('Sem acesso à área de transferência. Use Ctrl+V para colar dentro do texto.'); });
  }
  function pasteInternal(at, quiet) { if (clip && pastePayload(clip, at)) return true; if (!quiet) toast('Nada para colar. Copie um elemento, um slide ou um texto.'); return false; }
  function pasteText(txt, at) {
    if (txt && txt.indexOf(CLIP_TAG) === 0) return pasteAny(payloadFromText(txt), at); /* nunca cai na cópia interna */
    if (txt && txt.trim()) return pastePlain(txt, at);
    return pasteInternal(at);
  }
  /* "Colar" de menus: lê a área de transferência do sistema (com permissão) e recorre à cópia interna */
  function pasteFromSystem(at, onlySlides) {
    if (editingId) endEdit();
    var cb = navigator.clipboard, done = false;
    function fb() { if (done) return; done = true; if (onlySlides) { if (clip && clip.slides) pastePayload(clip); else toast('Nenhum slide copiado.'); return; } pasteInternal(at); }
    function usePayload(p) { done = true; if (onlySlides && !(p && p.slides)) { done = false; fb(); return; } pasteAny(p, at); }
    if (!cb || clipLocalNewer) { fb(); return Promise.resolve(); }
    function viaText() { if (done) return Promise.resolve(); return cb.readText().then(function (t) { if (done) return; if (t && t.indexOf(CLIP_TAG) === 0) { usePayload(payloadFromText(t)); return; } if (onlySlides) { fb(); return; } done = true; pasteText(t, at); }); }
    function txtOf(it, type) { return it ? it.getType(type).then(function (b) { return b.text(); }) : Promise.resolve(''); }
    var pr;
    try {
      pr = cb.read ? cb.read().then(function (items) {
        var img = null, txtItem = null, htmItem = null;
        items.forEach(function (it) { var im = it.types.find(function (t) { return t.indexOf('image/') === 0; }); if (im && !img) img = { it: it, t: im }; if (it.types.indexOf('text/plain') >= 0 && !txtItem) txtItem = it; if (it.types.indexOf('text/html') >= 0 && !htmItem) htmItem = it; });
        return txtOf(htmItem, 'text/html').then(function (h) {
          var p = payloadFromHTML(h); if (p) { usePayload(p); return; }
          return txtOf(txtItem, 'text/plain').then(function (t) {
            if (t && t.indexOf(CLIP_TAG) === 0) { usePayload(payloadFromText(t)); return; }
            if (onlySlides) { fb(); return; }
            if (img && preferImage(t)) return img.it.getType(img.t).then(function (b) { done = true; pasteImageBlob(b, at); });
            done = true; pasteText(t, at);
          });
        });
      }) : viaText();
    } catch (er) { fb(); return Promise.resolve(); }
    return pr.catch(function () { return viaText().catch(fb); }).catch(fb);
  }
  /* atalhos Ctrl+C/X/V: deixamos o navegador disparar os eventos nativos; se nada chegar em ~60 ms, usamos a cópia interna */
  function cbKey(op) {
    if (cbWait) clearTimeout(cbWait);
    cbWait = setTimeout(function () {
      cbWait = null;
      if (op === 'v') pasteFromSystem(null); else doCopy(op === 'x', null, true);
    }, 60);
  }
  function cbGot() { if (cbWait) { clearTimeout(cbWait); cbWait = null; } }
  function canCopy() { return zone === 'thumbs' || selIds.length > 0; }
  ['beforecopy', 'beforecut'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (!typingTarget(e.target) && !editingId && !modalOpen() && !presenting() && canCopy()) e.preventDefault(); }); });
  document.addEventListener('beforepaste', function (e) { if (!typingTarget(e.target) && !editingId && !modalOpen() && !presenting()) e.preventDefault(); });
  function onCopyEvt(e, cut) {
    if (typingTarget(e.target) || editingId || modalOpen() || presenting() || coverOpen()) return;
    cbGot();
    var p = payload(); if (!p || !e.clipboardData) { if (p) doCopy(cut); return; }
    e.preventDefault();
    var plain = plainOf(p), cd = e.clipboardData;
    cd.setData('text/plain', plain); cd.setData('text/html', clipHTML(p, plain)); try { cd.setData(CLIP_MIME, JSON.stringify(p)); } catch (er) { }
    clip = p; clipLocalNewer = false;
    if (cut) cutRemove(p); else toast(p.slides ? 'Slide copiado' : (p.els.length > 1 ? p.els.length + ' elementos copiados' : 'Elemento copiado'));
  }
  document.addEventListener('copy', function (e) { onCopyEvt(e, false); });
  document.addEventListener('cut', function (e) { onCopyEvt(e, true); });
  document.addEventListener('paste', function (e) {
    if (editingId || typingTarget(e.target) || modalOpen() || presenting() || coverOpen()) return;
    cbGot();
    var cd = e.clipboardData; if (!cd) { pasteInternal(); return; }
    e.preventDefault();
    var p = payloadFromDT(cd); if (p) { pasteAny(p, null); return; }
    var it = Array.prototype.slice.call(cd.items || []).find(function (i) { return i.kind === 'file' && i.type.indexOf('image') === 0; });
    var txt = cd.getData('text/plain');
    if (it && preferImage(txt)) { pasteImageBlob(it.getAsFile(), null); return; }
    pasteText(txt, null);
  });
  /* campos de texto (título, painel): um conteúdo antigo "AMSTUDIO/1:" entra como texto legível, nunca como JSON */
  document.addEventListener('paste', function (e) {
    var t = e.target; if (!e.clipboardData || !typingTarget(t) || t.isContentEditable) return;
    var v = e.clipboardData.getData('text/plain'); if (v.indexOf(CLIP_TAG) !== 0) return;
    e.preventDefault(); document.execCommand('insertText', false, clipPlain(v));
  }, true);
  function selectAll() { if (editingId) endEdit(); setZone('canvas'); setSel(slide().els.map(function (e) { return e.id; })); }
  function nudge(dx, dy) {
    var list = sels().filter(function (e) { return !isLocked(e); }); if (!list.length) { if (sels().length) lockHint(); return; }
    list.forEach(function (el) { var b = bbox(el); moveTo(el, b.x + dx, b.y + dy); posNode(el); }); drawSel();
    clearTimeout(nudge._k); nudge._k = setTimeout(function () { commit(); renderProps(); }, 400);
  }
  /* botão clicado com o mouse não guarda o foco: o teclado volta ao slide (setas, Delete, digitar), como no PowerPoint */
  document.addEventListener('click', function (e) {
    var b = e.detail && e.target.closest && e.target.closest('button'); if (!b || b !== document.activeElement) return;
    if (b.closest('#modal,#cover,.xmenu,.menu,#mbar,#presenter,.cpop,.xp,#bSaveMore')) return;
    b.blur();
  });
  var MODS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS'];
  /* menus antigos (.menu): setas percorrem, Enter ativa, Esc fecha; qualquer outra tecla só fecha o menu */
  function oldMenuKey(e, m) {
    var bs = $$('button', m).filter(function (b) { return b.offsetParent !== null; }), i = bs.indexOf(document.activeElement), k = e.key;
    if ((k === 'ArrowDown' || k === 'ArrowUp') && i >= 0 && m.classList.contains('gmenu')) { /* galeria em grade (Formas): ↓ ↑ vão para a linha de baixo/de cima, coluna mais próxima */
      var r0 = bs[i].getBoundingClientRect(), cx = r0.left + r0.width / 2, best = null, bd = Infinity;
      bs.forEach(function (b) { var r = b.getBoundingClientRect(), dy = k === 'ArrowDown' ? r.top - r0.top : r0.top - r.top, d = dy * 4 + Math.abs(r.left + r.width / 2 - cx); if (dy > 4 && d < bd) { bd = d; best = b; } });
      if (best) { e.preventDefault(); best.focus(); return; }
    }
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault(); if (!bs.length) return;
      if (i < 0) { var on = m.querySelector('button.on'); i = on ? bs.indexOf(on) - (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1) : -1; if (i < -1) i = -1; }
      bs[(i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : bs.length - 1) + bs.length) % bs.length].focus(); return;
    }
    if ((k === 'Enter' || k === ' ') && i >= 0) return; /* o próprio botão em foco é ativado */
    var back = k === 'Escape' && menuFrom && menuFrom.m === m ? menuFrom.b : null;
    e.preventDefault(); closeOld();
    if (back && back.offsetParent) back.focus();
  }
  var kbCtx = 0;
  function openCtxKeyboard() {
    var r, items;
    if (zone === 'thumbs') { /* painel recolhido: o menu do slide abre ao lado da faixa (posição “3/14”), não no canto da tela */
      var th = $(sideOff ? '#sidePos' : '#thumbs .th.on .box'); if (!th) return; r = th.getBoundingClientRect(); if (sideOff) r = { left: $('#side').getBoundingClientRect().right - 4, top: r.top - 8 }; items = ctxThumbItems;
    }
    else {
      var wr = wrap.getBoundingClientRect(), g = selIds.length ? groupBox(sels()) : { x: W / 2, y: H / 2, w: 0, h: 0 };
      r = { left: wr.left + (g.x + g.w / 2) / W * wr.width, top: wr.top + (g.y + g.h / 2) / H * wr.height };
      var p = { x: Math.max(0, Math.min(W - 20, g.x + g.w / 2)), y: Math.max(0, Math.min(H - 20, g.y + g.h / 2)) };
      items = selIds.length ? ctxElItems : function () { return ctxCanvasItems(p); };
    }
    kbCtx = Date.now();
    var m = openX(items, { x: Math.round(r.left + 8), y: Math.round(r.top + 8), ctx: 1, kb: 1 }), f = m.querySelector('.xi:not(.dis)'); if (f) hotX(m, f, true);
  }
  /* foco num botão/controle (Tab): Enter/Espaço/setas/Delete ficam com o controle, não com o slide */
  function onControl(t) { return !!(t && t !== document.body && t.closest && t.closest('button,a[href],summary,[role=button],[role=menuitem],[role=tab],[tabindex]:not([tabindex="-1"])')); }
  document.addEventListener('keydown', function (e) {
    if (modalOpen() || coverOpen()) return;
    if (e.key === 'F5') { e.preventDefault(); if (!presenting()) { closeMenus(); present(e.shiftKey ? cur : 0); } return; }
    if (presenting()) return;
    if (MODS.indexOf(e.key) >= 0) return;
    stopPreview();
    if (XM.stack.length) {
      var mod0 = e.ctrlKey || e.metaKey, k0 = (e.key || '').toLowerCase();
      if (mod0 && !e.altKey && (k0 === 's' || k0 === 'p')) { e.preventDefault(); closeAllX(); if (editingId) endEdit(); if (k0 === 's') save(); else exportAs('pdf'); return; } /* o menu ▾ mostra Ctrl+S: vale mesmo com ele aberto */
      if (!menuKey(e)) { e.preventDefault(); closeAllX(); } return;
    }
    var om = $('.menu.open');
    if (om && om.id === 'icMenu') { if (icKey(e)) return; om = $('.menu.open'); } /* seletor de ícones: busca, chips e grade têm teclado próprio */
    if (om) { oldMenuKey(e, om); return; }
    var mod = e.ctrlKey || e.metaKey, t = e.target, typing = typingTarget(t), k = (e.key || '').toLowerCase();
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { if (typing || t.isContentEditable) return; e.preventDefault(); if (editingId) endEdit(); openCtxKeyboard(); return; }
    if (e.key === 'F1') { e.preventDefault(); showHelp(); return; }
    if (mod && !e.altKey && k === 's') { e.preventDefault(); if (editingId) endEdit(); save(); return; }
    if (mod && !e.altKey && k === 'p') { e.preventDefault(); if (editingId) endEdit(); exportAs('pdf'); return; } /* Ctrl+P: Salvar como PDF (imprimir o editor não serve para nada) */
    if (mod && !e.altKey && (k === 'f' || k === 'h') && !(t.closest && t.closest('#xfDlg'))) { e.preventDefault(); if (editingId) endEdit(); openFind(); return; } /* S27b: Localizar e substituir */
    if (mod && !e.altKey && k === 'o') { e.preventDefault(); openPicker(); return; }
    if (mod && !e.altKey && k === 'd' && (typing || t.isContentEditable)) { e.preventDefault(); return; } /* nunca abre o "favoritos" do navegador */
    if (t.isContentEditable) {
      if (e.key === 'Escape') { e.preventDefault(); t.blur(); return; }
      if (editingId && e.key === 'Tab' && !mod && !e.altKey) { /* S27b: Tab / Shift+Tab mudam o nível do item da lista */
        var sl0 = getSelection(), an = sl0 && sl0.anchorNode, li0 = an && (an.nodeType === 1 ? an : an.parentElement), lit = li0 && li0.closest && li0.closest('li');
        if (lit && t.contains(lit)) { e.preventDefault(); cmd(e.shiftKey ? 'outdent' : 'indent'); syncTxBar(); return; }
      }
      if (editingId && mod && !e.altKey) { /* S26: formatação do trecho (as mesmas teclas do PowerPoint/Word) */
        if (!e.shiftKey && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); txFmt(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'); return; }
        if (e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7')) { e.preventDefault(); txFmt(e.code === 'Digit8' ? 'bullets' : 'numbered'); return; }
      }
      return;
    }
    if (typing) return;
    /* provador aberto e foco nele (ou no corpo da página depois de um clique na gaveta): as teclas não chegam ao slide por trás */
    if (gxIsOpen() && !(mod && !e.altKey) && (t === document.body ? gx.pin : $('#drawer').contains(t)) && gxKeys(e)) return;
    var list = sels(), el = sel();
    if (mod && !e.altKey) {
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (k === 'y') { e.preventDefault(); redo(); return; }
      if (k === 'c' || k === 'x' || k === 'v') { cbKey(k); return; }
      if (k === 'd') { e.preventDefault(); if (zone === 'thumbs') dupSlide(cur); else dupSel(); return; }
      if (k === 'a') { e.preventDefault(); selectAll(); return; }
      if (k === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); return; } /* S27: Ctrl+G agrupa, Ctrl+Shift+G desagrupa */
      if (k === 'l' && e.shiftKey) { e.preventDefault(); lockSel(); return; } /* Ctrl+Shift+L bloqueia/desbloqueia */
      return;
    }
    if (e.ctrlKey && e.altKey && !e.metaKey && (k === 'c' || k === 'v') && !e.getModifierState('AltGraph')) { e.preventDefault(); if (k === 'c') copyFmt(); else pasteFmt(); return; } /* S27: pincel de formato (Ctrl+Alt+C copia, Ctrl+Alt+V aplica) */
    if (e.key === 'Escape') { if (gxIsOpen()) { gxClose(); return; } if (xf && !xf.hidden) { closeFind(); return; } closeMenus(); openDrawer(false); select(null); return; }
    if (onControl(t)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (zone === 'thumbs') delSlide(cur); else if (list.length && zone === 'canvas') delSel(); return; }
    if (e.key === 'Enter' && el && (el.type === 'text' || el.type === 'shape')) { e.preventDefault(); startEdit(el, false); return; }
    /* digitar com um texto/forma selecionado começa a edição já com o caractere (AltGr vale; Ctrl+Alt+letra não) */
    var altgr = e.getModifierState && e.getModifierState('AltGraph'), plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key.length === 1 && (plain || altgr) && el && (el.type === 'text' || el.type === 'shape') && zone === 'canvas') { e.preventDefault(); startEdit(el, false); document.execCommand('insertText', false, e.key); return; }
    if (e.key === '?') { e.preventDefault(); showHelp(); return; }
    /* Alt+← / Alt+→ giram a seleção 15° (com Shift, 1°), como no PowerPoint; AltGr nunca gira (só digita) */
    if (e.altKey && !e.ctrlKey && !e.metaKey && !altgr && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && list.length && zone === 'canvas') { e.preventDefault(); turnSel((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 15)); return; }
    if (e.key.indexOf('Arrow') === 0 && list.length && zone === 'canvas') {
      e.preventDefault(); var d = e.shiftKey ? 10 : 1;
      nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0); return;
    }
    /* miniaturas em 2 colunas (painel largo): ↑ ↓ andam uma linha (2 slides) */
    if (!list.length && zone === 'thumbs' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && $('#side').classList.contains('cols2')) {
      /* como na grade do PowerPoint: ↑ na primeira linha e ↓ na última ficam onde estão; ↓ vai ao último slide só se ele estiver na linha de baixo */
      e.preventDefault(); var last = deck.slides.length - 1, to = cur + (e.key === 'ArrowDown' ? 2 : -2);
      if (to > last && e.key === 'ArrowDown' && (cur >> 1) < (last >> 1)) to = last;
      if (to >= 0 && to <= last) goSlide(to); return;
    }
    if (!list.length && (e.key === 'PageDown' || e.key === 'ArrowDown' || (zone === 'thumbs' && e.key === 'ArrowRight'))) { e.preventDefault(); goSlide(cur + 1); }
    if (!list.length && (e.key === 'PageUp' || e.key === 'ArrowUp' || (zone === 'thumbs' && e.key === 'ArrowLeft'))) { e.preventDefault(); goSlide(cur - 1); }
  });

  /* ---------------- acervo de efeitos ---------------- */
  var drawerTimers = [];
  function previewSlide(k, it, pre) {
    if (k === 'icon' || k === 'iconmorph') { /* ícone grande num círculo gelo; o movimento se repete depois do desenho */
      var ie = { id: 'pv' + k, type: 'fx', kind: k, variant: k === 'icon' ? (it && it.variant) || 'auto' : 'loop', x: 380, y: 100, w: 520, h: 520, data: Object.assign(clone(RT.FX[k].data), { bg: 'circle', trig: 'in-loop' }, icSample(it) || {}), anim: k === 'icon' ? { in: 'draw', dur: 900 } : { in: 'zoom', dur: 700 } };
      return { bg: '#FFFFFF', els: [ie] };
    }
    var d = RT.FX[k], darkPv = ['counter', 'holo', 'glass', 'amlines', 'quote'].indexOf(k) >= 0 || (d.data.style === 'dark');
    var sc = Math.min(1120 / d.w, 600 / d.h), w = d.w * sc, hh = d.h * sc, data = clone(d.data), variant = d.variant;
    if (k === 'beacon' || k === 'timeline') data.tcolor = '#002A46';
    if (pre) { Object.assign(data, clone(pre.data)); data.preset = pre.key; if (d.variants && d.variants.some(function (x) { return x[0] === pre.variant; })) variant = pre.variant; } /* preset (Ansoff, SIPOC…): dados prontos sobre o motor */
    var el = { id: 'pv' + k + (pre ? '-' + pre.key : ''), type: 'fx', kind: k, variant: variant, x: (W - w) / 2, y: (H - hh) / 2, w: w, h: hh, data: data, anim: Object.assign({}, d.anim) };
    if (k === 'glass') return { bg: '#13315C', els: [{ id: 'b1', type: 'shape', shape: 'ellipse', x: 200, y: 120, w: 420, h: 420, fill: '#F78C16', strokeW: 0 }, { id: 'b2', type: 'shape', shape: 'ellipse', x: 700, y: 60, w: 380, h: 380, fill: '#4A6FA5', strokeW: 0 }, el] };
    return { bg: darkPv ? '#002A46' : '#FFFFFF', els: [el] };
  }
  /* presets (AMRT.PRESETS, rt-models3): dados prontos sobre um motor existente (Ansoff e Eisenhower sobre a matriz 2×2, SIPOC sobre o
     SmartArt…). Cada um vira um card próprio na sua categoria, depois dos motores; inserir = o motor + os dados + data.preset (nome no painel) */
  function presetOf(p, kind) { var P = p && RT.PRESETS && Object.prototype.hasOwnProperty.call(RT.PRESETS, p) ? RT.PRESETS[p] : null; return P && P.kind === kind && RT.FX[kind] ? P : null; }
  function presetData(p, kind) { var P = presetOf(p, kind); return P ? Object.assign(clone(P.data), { preset: p }) : null; }
  function presetVar(p, kind) { var P = presetOf(p, kind); return P ? P.variant : null; }
  function buildModels() {
    var cats = {}, b = $('#modelsBody'), order = ['Matrizes', 'Riscos', 'Estratégia', 'Processos', 'Cards', 'Evolução', 'Gráficos', 'Indicadores', 'SmartArt'], PR = RT.PRESETS || {};
    Object.keys(RT.FX).forEach(function (k) { if (RT.FX[k].model) (cats[RT.FX[k].cat] = cats[RT.FX[k].cat] || []).push({ k: k }); });
    Object.keys(PR).forEach(function (p) { var P = presetOf(p, PR[p] && PR[p].kind); if (!P || !RT.FX[P.kind].model) return; var c = P.cat || RT.FX[P.kind].cat; (cats[c] = cats[c] || []).push({ k: P.kind, p: p, P: P }); });
    Object.keys(cats).forEach(function (c) { if (order.indexOf(c) < 0) order.push(c); }); /* categoria nova de um rt-*.js entra no fim, nunca some */
    order = order.filter(function (c) { return cats[c]; });
    b.innerHTML = order.map(function (c) {
      return '<div class="dcat" data-cat="' + esc(c) + '">' + esc(c) + '</div><div class="dgrid">' + cats[c].map(function (it) {
        var d = RT.FX[it.k], P = it.P, name = P ? P.name : d.name, pa = P ? ' data-preset="' + esc(it.p) + '"' : '';
        return '<div class="fxi' + (P ? ' fxi-pre' : '') + '" draggable="true" data-k="' + it.k + '"' + pa + ' data-kw="' + esc(norm(name + ' ' + (P ? (P.kw || '') + ' ' + d.name + ' preset' : d.kw || '') + ' ' + c)) + '"><div class="pv"></div><div class="ft"><span><b>' + esc(name) + '</b><small>' + (P ? 'Preset · ' + esc(d.name) : d.variants.length + ' efeitos compatíveis') + '</small></span><button data-ins="' + it.k + '"' + pa + '>Inserir</button></div><div class="vl">' + d.variants.map(function (v) { return '<span>' + esc(v[1]) + '</span>'; }).join('') + '</div></div>'; }).join('') + '</div>';
    }).join('') + '<p class="note" id="mEmpty" style="display:none">Nenhum modelo encontrado. Tente “matriz”, “risco”, “gráfico”, “jornada” ou “canvas”.</p>';
    $$('.fxi', b).forEach(function (card) { var P = presetOf(card.dataset.preset, card.dataset.k); card._slide = previewSlide(card.dataset.k, null, P ? Object.assign({ key: card.dataset.preset }, P) : null); });
    var ch = $('#mCats'); if (ch) ch.innerHTML = order.map(function (c) { return '<button class="chip" type="button" data-cat="' + esc(c) + '">' + esc(c) + '<small>' + cats[c].length + '</small></button>'; }).join('');
  }
  /* chips de categoria: atalho de rolagem dentro da gaveta; o chip aceso acompanha a categoria no topo da rolagem */
  if ($('#mCats')) $('#mCats').addEventListener('click', function (e) { var c = e.target.closest('button[data-cat]'); if (!c) return; var h = $$('#modelsBody .dcat').filter(function (x) { return x.dataset.cat === c.dataset.cat && x.style.display !== 'none'; })[0], b = $('#modelsBody'); if (!h) return; b.scrollTo({ top: Math.max(0, h.offsetTop - b.offsetTop - 4), behavior: 'smooth' }); $$('#mCats .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); });
  function catChipSync() { var b = $('#modelsBody'), top = b.scrollTop + b.offsetTop + 40, cur = null; $$('#modelsBody .dcat').forEach(function (h) { if (h.style.display !== 'none' && h.offsetTop <= top) cur = h.dataset.cat; }); $$('#mCats .chip').forEach(function (x) { x.classList.toggle('on', x.dataset.cat === cur); }); }
  function norm(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  $('#mSearch').addEventListener('input', function () {
    var q = norm(this.value).trim().split(/\s+/).filter(Boolean), any = false;
    $$('#modelsBody .fxi').forEach(function (c) { var ok = q.every(function (w) { return c.dataset.kw.indexOf(w) >= 0; }); c.style.display = ok ? '' : 'none'; if (ok) any = true; });
    $$('#modelsBody .dgrid').forEach(function (g) { var vis = $$('.fxi', g).some(function (c) { return c.style.display !== 'none'; }); g.style.display = vis ? '' : 'none'; g.previousElementSibling.style.display = vis ? '' : 'none'; });
    $('#mEmpty').style.display = any ? 'none' : '';
    $$('#mCats .chip').forEach(function (x) { x.style.display = $$('#modelsBody .dcat').some(function (h) { return h.dataset.cat === x.dataset.cat && h.style.display !== 'none'; }) ? '' : 'none'; });
    playVisible();
  });
  var drawerTab = 'models';
  function setTab(t) {
    drawerTab = t; $$('.dtabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    $('#modelsBody').classList.toggle('hidden', t !== 'models'); $('#dSearch').classList.toggle('hidden', t !== 'models'); $('#drawerBody').classList.toggle('hidden', t !== 'fx' || !!gx.prov); /* provador aberto: a grade fica escondida atrás dele */
    $('#dTitle').firstChild.textContent = t === 'models' ? 'Biblioteca de modelos' : 'Acervo de efeitos';
    $('#dSub').textContent = t === 'models' ? 'Escolha um modelo e insira. Depois, escolha o efeito no seletor “Efeito” acima do elemento.' : 'Clique numa caixa para provar o efeito no slide; depois escolha “Usar este efeito” ou “Descartar”.';
    if (t !== 'fx') gxClose(true);
    $('#drawer').classList.toggle('gxw', t === 'fx' && gx.wide);
    playPreviews(); gxRun();
  }
  $$('.dtabs button').forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.tab === 'fx' && drawerTab === 'fx' && gx.prov) gxClose(); else setTab(b.dataset.tab); }); }); /* a aba ativa, com o provador aberto, volta à vitrine */
  /* prévias: só os cards visíveis na gaveta (ou a 160 px dela) animam e redesenham a cada 5,2 s; os demais recebem um desenho estático na
     abertura e passam a animar quando a rolagem (ou a busca) os traz — com ~45 cards (modelos + presets) o custo por ciclo cai a uma fração */
  function pvOn() { return !(coverOpen() || document.hidden || drawerTab !== 'models' || !$('#drawer').classList.contains('open')); } /* capa por cima, aba oculta ou gaveta fechada: nada de animar prévias escondidas; a vitrine de efeitos tem relógio próprio */
  function cardVis(card, b) { var r = card.getBoundingClientRect(); return r.bottom > b.top - 160 && r.top < b.bottom + 160; }
  function playCard(card, live) {
    var pv = card.querySelector('.pv'); if (card._clean) { card._clean(); card._clean = null; } pv.innerHTML = '';
    var st = RT.renderSlide(card._slide, { play: true }); pv.appendChild(st); void st.offsetWidth; st.classList.remove('am-pre'); st.classList.add('am-in'); if (live) card._clean = RT.runFx(st); card._live = !!live;
  }
  function stopCard(card) { if (card._clean) { card._clean(); card._clean = null; } card._live = false; }
  function playPreviews() {
    if (!pvOn()) return;
    var b = $('#modelsBody').getBoundingClientRect();
    $$('#modelsBody .fxi').forEach(function (card) { if (card.style.display === 'none') return; if (cardVis(card, b)) playCard(card, true); else if (!card.querySelector('.pv .am-stage')) playCard(card, false); else stopCard(card); });
    catChipSync();
  }
  function playVisible() { /* rolagem ou busca: liga o que entrou na janela, sem redesenhar o que já anima; desliga o que saiu */
    if (!pvOn()) return;
    var b = $('#modelsBody').getBoundingClientRect();
    $$('#modelsBody .fxi').forEach(function (card) { if (card.style.display === 'none') return; var vis = cardVis(card, b); if (vis && !card._live) playCard(card, true); else if (!vis && card._live) stopCard(card); });
    catChipSync();
  }
  var pvScrollT = null;
  $('#modelsBody').addEventListener('scroll', function () { clearTimeout(pvScrollT); pvScrollT = setTimeout(playVisible, 120); });
  function openDrawer(v, tab) {
    var d = $('#drawer'), open = v == null ? !(d.classList.contains('open') && (!tab || tab === drawerTab)) : v;
    if (tab) setTab(tab);
    d.classList.toggle('open', open); $('#bFx').classList.toggle('open', open && drawerTab === 'fx'); $('#bModels').classList.toggle('open', open && drawerTab === 'models');
    if (!open) sideFree = false; if (sideKeyNow() !== sideKey) applySide(); /* painel de slides largo: estreita enquanto a gaveta está aberta (S18) */
    drawerTimers.forEach(clearInterval); drawerTimers = [];
    if (open) { playPreviews(); drawerTimers.push(setInterval(playPreviews, 5200)); }
    else { $$('.fxi', d).forEach(stopCard); gxClose(true); if (d.contains(document.activeElement)) document.activeElement.blur(); } /* fechada: para contadores e ciclos das prévias e solta o foco (setas e Espaço voltam ao slide e ao modo apresentação) */
    gxRun();
  }
  $('#bFx').addEventListener('click', function () { openDrawer(null, 'fx'); });
  $('#bModels').addEventListener('click', function () { openDrawer(null, 'models'); });
  $('#bInst').addEventListener('click', function () { if (hasInst()) insertSeq('inst'); }); /* S34b: botão sempre à vista para jogar os 5 slides institucionais em qualquer apresentação */
  $('#modelsBody').addEventListener('click', function (e) { var b = e.target.closest('button[data-ins]'); if (!b) return; var el = insertFx(b.dataset.ins, null, null, presetVar(b.dataset.preset, b.dataset.ins), presetData(b.dataset.preset, b.dataset.ins)); openDrawer(false); toast('Modelo inserido. Escolha o efeito no seletor “Efeito” acima dele.'); setTimeout(function () { previewEl(el); }, 250); });
  $('#modelsBody').addEventListener('dragstart', function (e) { var c = e.target.closest('.fxi'); if (!c) return; e.dataTransfer.setData('text/plain', 'amfx:' + c.dataset.k + (c.dataset.preset ? ':' + (presetVar(c.dataset.preset, c.dataset.k) || '') + ':' + c.dataset.preset : '')); e.dataTransfer.effectAllowed = 'copy'; }); /* preset: 'amfx:matrix:quadrants:ansoff' */
  $('#bFxClose').addEventListener('click', function () { openDrawer(false); });

  /* ---------------- vitrine de efeitos: caixas com prévia viva, filtros, busca e o provador (Usar / Descartar) ----------------
     Itens vêm de AMRT.ANIMS (entrada, ênfase, contínuo, mouse, transição) e de AMRT.FX (componentes e efeitos dos modelos):
     um rt-*.js novo aparece aqui sozinho. Só as caixas visíveis animam (IntersectionObserver); um relógio único de 200 ms
     repete as entradas; tudo para com a gaveta fechada, na outra aba, com a capa aberta ou com a aba do navegador oculta. */
  var GX_FAM = [['in', 'Entrada', 'como o elemento aparece'], ['emph', 'Ênfase', 'destaque depois que o elemento já está no slide'], ['loop', 'Contínuo', 'movimento que se repete enquanto o slide está na tela'], ['hover', 'Ao passar o mouse', 'resposta ao cursor, na apresentação'], ['tr', 'Transição de slide', 'como o slide entra na apresentação'], ['cmp', 'Componentes', 'peças animadas prontas para inserir'], ['icon', 'Ícones animados', 'movimentos do acervo de ícones (Icon Motion): prove no ícone selecionado'], ['model', 'Modelos animados', 'cada efeito dos modelos de consultoria']];
  var GX_CHIP = { in: 'Entrada', emph: 'Ênfase', loop: 'Contínuo', hover: 'Ao passar o mouse', tr: 'Transição', cmp: 'Componentes', icon: 'Ícones', model: 'Modelos' };
  /* ícone de amostra para cada movimento (vitrine, provador e “Inserir” sem nada selecionado) */
  var IC_SAMPLE = { auto: 'target', redraw: 'trend', pulse: 'bolt', beat: 'heart', spin: 'gear', bounce: 'rocket', float: 'cash', wiggle: 'alert', swing: 'bell', nudge: 'cloud', tick: 'clock', grow: 'chartup', blink: 'idea', wave: 'flag', flow: 'network', flip: 'coin', orbit: 'search', ping: 'pin' };
  function icSample(it) { return it && it.fam === 'icon' ? { name: IC_SAMPLE[it.variant] || 'target' } : null; }
  /* 'amfx:icon:spin:gear' / 'amfx:iconmorph::x-check': o 3º campo escolhe o ícone (ou a transformação), se existir */
  function dropData(kv) { var v = kv[2]; if (!v) return null; if (kv[0] === 'icon' && RT.iconFind && RT.iconFind(v)) return { name: v }; if (kv[0] === 'iconmorph' && (RT.ICON_MORPHS || []).some(function (m) { return m[0] === v; })) return { pair: v }; if (kv[0] === 'smart' && RT.smartFind && RT.smartFind(v)) return smartSeed(v); return presetData(v, kv[0]); }
  function icTrigNote(els) { var tr = (els[0].data && els[0].data.trig) || 'in-hover', o = (RT.IC_TRIGS || []).filter(function (x) { return x[0] === tr; })[0]; return 'na apresentação: ' + (o ? o[1].toLowerCase() : 'ao entrar'); }
  var GX_TAG = { in: 'Entrada', emph: 'Ênfase', loop: 'Contínuo', hover: 'Mouse', tr: 'Transição' };
  var GX_PATH = { in: 'in', emph: 'emph', loop: 'loop', hover: 'hover' };
  var GX_WHEN = { counter: 'Um KPI que conta até o valor diante da plateia.', progress: 'Meta × realizado, em barra ou anel.', beacon: 'Chamar atenção para um risco ou uma pendência.', headline: 'Título de abertura que entra palavra a palavra.', card: 'Iniciativas, pilares ou serviços em blocos.', holo: 'Destaque nobre que inclina com o mouse.', glass: 'Mensagem sobre foto ou fundo colorido.', quote: 'A mensagem-chave que o comitê deve levar.', amlines: 'Assinatura visual A&M em capas e encerramentos.', persona: 'Um personagem A&M que fala, aponta, anda e reage ao clique na apresentação.', bubble: 'Fala, pensamento ou grito ao lado de quem fala; prende-se a conectores.' };
  var GX_SAMPLE = { 'in:draw': 'line', 'in:words': 'text', 'in:iris': 'photo', 'in:grow': 'bar', 'loop:flow': 'line', 'loop:beacon': 'badge', 'loop:wiggle': 'badge', 'hover:spot': 'trio', 'hover:uline': 'text', 'hover:inzoom': 'photo', 'hover:zoom': 'photo' };
  var GX_DUR = { draw: 1000, iris: 900, land: 950, flip: 850, grow: 800 };
  var GX_IMG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B3A63"/><stop offset="1" stop-color="#7EA1C3"/></linearGradient></defs><rect width="640" height="400" fill="url(#s)"/><circle cx="462" cy="140" r="48" fill="#F78C16"/><path d="M0 270L120 186L232 252L352 164L474 258L566 206L640 246V400H0Z" fill="#43698F"/><path d="M0 326L152 250L304 314L436 240L640 322V400H0Z" fill="#002A46"/></svg>');
  var GX_CUR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 1.5l10.6 6.1-4.7 1.1-2.3 4.3z" fill="#fff" stroke="#002A46" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  var gx = { items: [], byId: {}, fam: 'all', q: '', vis: [], tick: null, io: null, prov: null, key: '', pts: [], pclean: null, ptg: [], built: false, wide: false };
  try { gx.wide = localStorage.getItem('amStudio.gxWide') === '1'; } catch (e) { }
  function gxItems() {
    var L = [];
    GX_FAM.forEach(function (f) { (RT.ANIMS[f[0]] || []).forEach(function (a) { if (a[0] === 'none') return; L.push({ id: f[0] + ':' + a[0], fam: f[0], key: a[0], name: a[1], tip: a[2] || '', when: a[3] || '', only: a[4] || '', cat: GX_TAG[f[0]] }); }); });
    Object.keys(RT.FX).forEach(function (k) {
      var d = RT.FX[k], fam = d.model ? 'model' : 'cmp';
      /* ícones: uma caixa de componente por tipo; cada movimento do ícone vira uma caixa da família “Ícones animados” */
      if (d.gal) { L.push({ id: 'cmp:' + k, fam: 'cmp', kind: k, name: d.name, tip: d.tip || '', when: d.gal === 'icon' ? '54 ícones que se desenham e se movem; escolha o ícone no painel.' : GX_WHEN[k] || 'Dois estados que se alternam: problema → solução, queda → alta…', cat: d.cat });
        if (d.gal === 'icon') d.variants.forEach(function (v) { L.push({ id: 'icon:' + v[0], fam: 'icon', kind: k, variant: v[0], name: v[1], host: d.name, tip: v[2] || '', when: v[2] || '', cat: d.cat }); });
        return; }
      if (d.variants && d.variants.length) d.variants.forEach(function (v) { L.push({ id: fam + ':' + k + ':' + v[0], fam: fam, kind: k, variant: v[0], name: v[1], host: d.name, tip: v[2] || '', when: d.name + ' · ' + (v[2] || ''), cat: d.cat || GX_CHIP[fam] }); });
      else L.push({ id: 'cmp:' + k, fam: 'cmp', kind: k, name: d.name, tip: d.tip || 'Componente animado: insira e edite o conteúdo no painel à direita.', when: GX_WHEN[k] || d.tip || 'Insira e edite o conteúdo no painel à direita.', cat: d.cat || GX_CHIP.cmp });
    });
    return L;
  }
  /* amostras (coordenadas lógicas 1280×720): o elemento-alvo é sempre o id 'gxt' */
  function gxSample(it, a) {
    var k = GX_SAMPLE[it.fam + ':' + it.key] || 'card', A = Object.assign({ in: 'none', delay: 0, dur: 700, loop: 'none', hover: 'none' }, a), N = { in: 'none' }, T = 'gxt';
    function card(id, x, y, w, h, fill, html, an, size) { return { id: id, type: 'shape', shape: 'round', x: x, y: y, w: w, h: h, radius: 30, fill: fill, strokeW: 0, font: 'Roboto Condensed', size: size || 30, weight: 700, color: '#A3B8D6', align: 'center', valign: 'middle', lh: 1.1, ls: .12, html: html, anim: an }; }
    if (k === 'line') return { bg: '#FFFFFF', els: [{ id: 'gn1', type: 'shape', shape: 'ellipse', x: 120, y: 430, w: 150, h: 150, fill: '#002A46', strokeW: 0, anim: N }, { id: 'gn2', type: 'shape', shape: 'ellipse', x: 1010, y: 140, w: 150, h: 150, fill: '#F78C16', strokeW: 0, anim: N }, { id: T, type: 'line', x1: 290, y1: 470, x2: 990, y2: 250, stroke: '#43698F', strokeW: 14, headEnd: true, anim: A }] };
    if (k === 'text') return { bg: '#FFFFFF', els: [{ id: 'gx2', type: 'text', x: 120, y: 170, w: 700, h: 50, font: 'Roboto Condensed', size: 34, weight: 700, color: '#F78C16', ls: .14, upper: true, html: 'Mensagem-chave', anim: N }, { id: T, type: 'text', x: 120, y: 232, w: 1060, h: 300, font: 'Roboto Condensed', size: 112, weight: 700, color: '#002A46', lh: 1.02, html: 'Crescer com disciplina<br>de caixa', anim: A }] };
    if (k === 'badge') return { bg: '#EEF2F7', els: [{ id: T, type: 'shape', shape: 'ellipse', x: 490, y: 210, w: 300, h: 300, fill: '#002A46', strokeW: 0, font: 'Roboto Condensed', size: 180, weight: 700, color: '#F78C16', align: 'center', valign: 'middle', lh: 1, html: '!', anim: A }] };
    if (k === 'photo') return { bg: '#EEF2F7', els: [{ id: T, type: 'image', src: GX_IMG, x: 250, y: 100, w: 780, h: 520, radius: 28, fit: 'cover', anim: A }] };
    if (k === 'bar') return { bg: '#FFFFFF', els: [{ id: 'gb0', type: 'text', x: 240, y: 236, w: 800, h: 60, font: 'Roboto Condensed', size: 34, weight: 700, color: '#002A46', ls: .08, upper: true, html: 'Adoção pelas áreas <span style="color:#F78C16">68%</span>', anim: N }, { id: 'gb1', type: 'shape', shape: 'pill', x: 240, y: 320, w: 800, h: 66, fill: '#DCE3EC', strokeW: 0, anim: N }, { id: T, type: 'shape', shape: 'pill', x: 240, y: 320, w: 544, h: 66, fill: '#F78C16', strokeW: 0, anim: A }] };
    if (k === 'trio') return { bg: '#EEF2F7', els: ['A', 'B', 'C'].map(function (t, i) { return card(i === 1 ? T : 'gq' + i, 110 + i * 370, 200, 320, 320, i === 1 ? '#002A46' : '#43698F', 'OPÇÃO<br><span style="font-size:2.7em;letter-spacing:0;color:' + (i === 1 ? '#F78C16' : '#FFFFFF') + '">' + t + '</span>', i === 1 ? A : N, 32); }) };
    return { bg: '#EEF2F7', els: [card(T, 290, 130, 700, 460, '#002A46', 'RECEITA LÍQUIDA<br><span style="font-size:3.4em;letter-spacing:-.02em;color:#FFFFFF">+18<span style="color:#F78C16">%</span></span>', A, 40)] };
  }
  function gxAnim(it) { var a = {}; a[GX_PATH[it.fam]] = it.key; if (it.fam === 'in') a.dur = GX_DUR[it.key] || 700; return a; }
  function gxTrSlides() {
    return [{ bg: '#002A46', els: [{ id: 'ta1', type: 'shape', shape: 'rect', x: 110, y: 300, w: 96, h: 10, fill: '#F78C16', strokeW: 0 }, { id: 'ta2', type: 'text', x: 110, y: 330, w: 1000, h: 130, font: 'Roboto Condensed', size: 104, weight: 700, color: '#FFFFFF', lh: 1, html: 'Diagnóstico' }, { id: 'ta3', type: 'text', x: 110, y: 470, w: 900, h: 50, font: 'Roboto Condensed', size: 30, weight: 700, color: '#7EA1C3', ls: .14, upper: true, html: 'Capítulo 01' }] },
      { bg: '#FFFFFF', els: [{ id: 'tb1', type: 'text', x: 110, y: 90, w: 1000, h: 100, font: 'Roboto Condensed', size: 72, weight: 700, color: '#002A46', lh: 1, html: 'Plano de ação' }, { id: 'tb2', type: 'shape', shape: 'rect', x: 110, y: 420, w: 300, h: 220, fill: '#7EA1C3', strokeW: 0 }, { id: 'tb3', type: 'shape', shape: 'rect', x: 470, y: 340, w: 300, h: 300, fill: '#002A46', strokeW: 0 }, { id: 'tb4', type: 'shape', shape: 'rect', x: 830, y: 240, w: 300, h: 400, fill: '#F78C16', strokeW: 0 }] }];
  }
  /* duas lâminas com as mesmas classes do player (.amp-deck/.amp-slide): a prévia usa o CSS real da transição */
  function gxTrDeck(host, A, B, key, play) {
    var dk = document.createElement('div'); dk.className = 'amp-deck';
    var sl = [A, B].map(function (s, i) { var d = document.createElement('div'); d.className = 'amp-slide' + (i ? '' : ' on'); d.dataset.tr = i ? key : (key === 'iris' ? 'fade' : key); d.appendChild(RT.renderSlide(s, { play: !!(play && i) })); dk.appendChild(d); return d; });
    host.appendChild(dk); return sl;
  }
  function gxPlay(st) { if (!st) return; st.classList.remove('am-in'); st.classList.add('am-pre'); void st.offsetWidth; st.classList.remove('am-pre'); st.classList.add('am-in'); }
  function gxTargets(st, ids) { return ids.map(function (id) { return st.querySelector('.am-el[data-id="' + id + '"]>.am-rot>.am-fxw'); }).filter(Boolean); }
  function gxCurAt(host, b) { var c = host.querySelector('.gx-cur'); if (!c) { c = document.createElement('i'); c.className = 'gx-cur'; c.innerHTML = GX_CUR; host.appendChild(c); } c.style.left = ((b.x + b.w * .62) / W * 100) + '%'; c.style.top = ((b.y + b.h * .58) / H * 100) + '%'; return c; }
  function gxBox(it) {
    var ins = it.fam === 'cmp' || it.fam === 'model' || it.fam === 'icon', smp = icSample(it), kw = norm([it.name, it.host, it.tip, it.when, it.cat, GX_CHIP[it.fam], it.kind ? (RT.FX[it.kind].kw || '') : '', it.key || ''].join(' '));
    return '<div class="gx-box" data-gx="' + esc(it.id) + '" data-fam="' + it.fam + '" data-kw="' + esc(kw) + '"' + (ins ? ' draggable="true" data-k="' + esc(it.kind) + '"' + (it.variant ? ' data-v="' + esc(it.variant) + '"' : '') + (smp ? ' data-n="' + smp.name + '"' : '') : '') + '>' +
      '<div class="gx-pv"></div>' + (ins ? '<button class="gx-ins" type="button" data-ins="' + esc(it.kind) + '"' + (it.variant ? ' data-v="' + esc(it.variant) + '"' : '') + (smp ? ' data-n="' + smp.name + '"' : '') + ' title="Inserir no slide sem provar" aria-label="Inserir “' + esc(it.name) + '” no slide sem provar"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9"/></svg><span>Inserir</span></button>' : '') +
      '<div class="gx-ft"><span class="gx-cat">' + esc(it.cat) + '</span><b title="' + esc(it.name) + '">' + esc(it.name) + '</b><small>' + esc(it.when || it.tip) + '</small></div>' +
      '<button class="gx-try" type="button" aria-label="Provar: ' + esc(it.name) + (it.host ? ' (' + esc(it.host) + ')' : '') + ' — ' + esc(GX_CHIP[it.fam]) + '"></button><span class="gx-on" aria-hidden="true">✓ Em uso</span></div>';
  }
  function buildDrawer() {
    var b = $('#drawerBody'), cnt = {}, h;
    gx.items = gxItems(); gx.byId = {}; gx.items.forEach(function (it) { gx.byId[it.id] = it; cnt[it.fam] = (cnt[it.fam] || 0) + 1; });
    h = '<div class="gx-top"><div class="gx-bar"><p class="gx-count"><b id="gxN">' + gx.items.length + '</b> efeitos disponíveis</p>' +
      '<label class="gx-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><input id="gxSearch" type="search" placeholder="Buscar: íris, pulsar, holofote, SWOT…" autocomplete="off" aria-label="Buscar efeito"></label>' +
      '<button class="gx-wide" type="button" data-gw="1" title="Ampliar a vitrine" aria-label="Ampliar a vitrine" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M4 10V4h6M20 14v6h-6M4 4l6.5 6.5M20 20l-6.5-6.5"/></svg></button></div>' +
      '<div class="gx-chips" role="group" aria-label="Filtrar por tipo de efeito"><button type="button" data-gf="all" class="on" aria-pressed="true">Todos <i>' + gx.items.length + '</i></button>' +
      GX_FAM.filter(function (f) { return cnt[f[0]]; }).map(function (f) { return '<button type="button" data-gf="' + f[0] + '" aria-pressed="false">' + GX_CHIP[f[0]] + ' <i>' + cnt[f[0]] + '</i></button>'; }).join('') + '</div>' +
      '<div class="gx-ctxl"><p class="gx-ctx" id="gxCtx"></p><em class="gx-shown" id="gxShown"></em></div></div>';
    GX_FAM.forEach(function (f) { if (!cnt[f[0]]) return; h += '<section class="gx-sec" data-fam="' + f[0] + '"><div class="dcat">' + f[1] + '<small>' + f[2] + '</small></div><div class="gx-grid">' + gx.items.filter(function (it) { return it.fam === f[0]; }).map(gxBox).join('') + '</div></section>'; });
    b.innerHTML = h + '<p class="note gx-empty" id="gxEmpty" hidden>Nenhum efeito encontrado. Tente “entrada”, “mouse”, “transição”, “card” ou o nome de um modelo.</p>';
    $$('.gx-box', b).forEach(function (bx) { bx._it = gx.byId[bx.dataset.gx]; bx.addEventListener('pointerenter', function () { gxPoke(bx, true); }); bx.addEventListener('pointerleave', function () { gxPoke(bx, false); }); });
    if (gx.io) gx.io.disconnect();
    gx.vis = [];
    if (window.IntersectionObserver) { gx.io = new IntersectionObserver(gxSeen, { root: b, rootMargin: '80px 0px' }); $$('.gx-box', b).forEach(function (bx) { gx.io.observe(bx); }); }
    $('#gxSearch').addEventListener('input', function () { gx.q = this.value; gxApply(); });
    $('#gxProv').innerHTML = '<div class="gp-nav"><button class="gp-back" type="button" data-gp="back">‹ Vitrine</button><span class="gp-pos" id="gpPos"></span><span class="gp-arr"><button type="button" data-gp="prev" title="Efeito anterior (←)" aria-label="Efeito anterior">‹</button><button type="button" data-gp="next" title="Próximo efeito (→)" aria-label="Próximo efeito">›</button></span></div>' +
      '<div class="gp-grid"><div class="gp-head"><span class="gp-eye">Provador de efeito</span><h3 id="gpName"></h3><p><span class="gx-cat" id="gpCat"></span><span id="gpTip"></span></p></div>' +
      '<div class="gp-stage"><div class="gp-box" id="gpBox"></div><div class="gp-cap"><span class="gp-tag" id="gpTag"></span><button class="gp-rep" type="button" data-gp="replay" title="Repetir a prévia (Espaço)">↻ Repetir</button></div></div>' +
      '<div class="gp-info"><p class="gp-when"><b>Quando usar</b><span id="gpWhen"></span></p><p class="gp-tgt" id="gpTgt"></p></div>' +
      '<div class="gp-dec"><button class="btnw" type="button" data-gp="discard">Descartar</button><button class="btnw pri" type="button" data-gp="use" id="gpUse">✓ Usar este efeito</button></div></div>';
    var pb = $('#gpBox'); RT.bindTilt(pb); if (RT.bindIcons) RT.bindIcons(pb);
    pb.addEventListener('pointerenter', function () { gx.preal = true; if (gx.prov && gx.prov.fam === 'hover') gxProvHov(false, true); });
    pb.addEventListener('pointerleave', function () { gx.preal = false; if (gx.prov && gx.prov.fam === 'hover') gxProvCycle(); });
    gx.built = true; gxApply(); gxMarks(); gxCtx();
  }
  /* caixa entrou/saiu da área visível: desenha na primeira vez; fora da tela, pausa (CSS) e sai do relógio */
  function gxSeen(entries) {
    var now = Date.now(), k = 0;
    entries.forEach(function (en) {
      var bx = en.target, i = gx.vis.indexOf(bx);
      if (en.isIntersecting) { if (!bx._st) gxRender(bx); if (i < 0) { gx.vis.push(bx); bx._next = now + 400 + 140 * (k++); } bx.classList.remove('gx-off'); }
      else { if (i >= 0) gx.vis.splice(i, 1); bx.classList.add('gx-off'); if (bx._h) gxHov(bx, false); }
    });
  }
  function gxRender(bx) {
    var it = bx._it, pv = bx.querySelector('.gx-pv'), s, st;
    if (it.fam === 'tr') { var T = gxTrSlides(); bx._sl = gxTrDeck(pv, T[0], T[1], it.key, false); bx._st = pv.firstChild; return; }
    if (it.fam === 'icon') s = previewSlide(it.kind, it);
    else if (it.fam === 'cmp' || it.fam === 'model') { s = previewSlide(it.kind); if (it.variant) s.els[s.els.length - 1].variant = it.variant; bx._fx = true; }
    else s = gxSample(it, gxAnim(it));
    st = RT.renderSlide(s, { play: true }); pv.appendChild(st); bx._st = st;
    if (it.fam === 'hover') { bx._tg = gxTargets(st, ['gxt']); var e = s.els.filter(function (x) { return x.id === 'gxt'; })[0]; gxCurAt(pv, e.type === 'line' ? RT.lineBox(e) : e); }
    gxReplay(bx);
  }
  function gxReplay(bx) { if (bx._clean) { bx._clean(); bx._clean = null; } gxPlay(bx._st); if (bx._fx) bx._clean = RT.runFx(bx._st); }
  function gxHov(bx, on) { bx._h = on; (bx._tg || []).forEach(function (n) { n.classList.toggle('am-hov', on); }); bx.classList.toggle('gx-hovon', on); }
  function gxFlip(bx) { if (!bx._sl) return; var b2 = !bx._sl[1].classList.contains('on'); bx._sl[0].classList.toggle('on', !b2); bx._sl[1].classList.toggle('on', b2); }
  /* ponteiro (ou foco) sobre a caixa: mostra o efeito na hora e segura o estado enquanto ficar ali */
  function gxPoke(bx, on) {
    if (!bx._st) return; var f = bx._it.fam; bx._hold = on;
    if (f === 'hover') gxHov(bx, on);
    else if (on && f === 'tr') gxFlip(bx);
    else if (on && f !== 'loop') gxReplay(bx);
    bx._next = Date.now() + 1600;
  }
  function gxTick() {
    var db = $('#drawerBody'), off = coverOpen() || document.hidden || !!gx.prov;
    db.classList.toggle('gx-paused', coverOpen() || document.hidden);
    if (off) return;
    var now = Date.now();
    gx.vis.forEach(function (bx) {
      if (bx._hold || now < bx._next || !bx._st) return; var f = bx._it.fam;
      if (f === 'hover') { gxHov(bx, !bx._h); bx._next = now + (bx._h ? 1900 : 1300); }
      else if (f === 'tr') { gxFlip(bx); bx._next = now + 2700; }
      else if (f === 'loop' || f === 'icon') bx._next = Infinity; /* contínuos e movimentos de ícone já se repetem sozinhos */
      else { gxReplay(bx); bx._next = now + (bx._fx ? 5600 : 3000); }
    });
  }
  /* liga/desliga o relógio conforme a gaveta (aberta, aba Efeitos, sem capa) */
  function gxRun() {
    var on = $('#drawer').classList.contains('open') && drawerTab === 'fx' && !coverOpen();
    $('#drawerBody').classList.toggle('gx-paused', !on);
    clearInterval(gx.tick); gx.tick = null;
    if (on) { gx.tick = setInterval(gxTick, 200); return; }
    $$('#drawerBody .gx-box').forEach(function (bx) { if (bx._clean) { bx._clean(); bx._clean = null; } if (bx._h) gxHov(bx, false); bx._hold = false; });
  }
  function gxApply() {
    var q = norm(gx.q).trim().split(/\s+/).filter(Boolean), n = 0;
    $$('#drawerBody .gx-box').forEach(function (bx) { var ok = (gx.fam === 'all' || bx._it.fam === gx.fam) && q.every(function (w) { return bx.dataset.kw.indexOf(w) >= 0; }); bx.hidden = !ok; if (ok) n++; });
    $$('#drawerBody .gx-sec').forEach(function (s) { s.hidden = !$$('.gx-box', s).some(function (bx) { return !bx.hidden; }); });
    $$('#drawerBody [data-gf]').forEach(function (c) { var on = c.dataset.gf === gx.fam; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('#gxShown').textContent = n === gx.items.length ? '' : 'mostrando ' + n + ' de ' + gx.items.length;
    $('#gxEmpty').hidden = n > 0;
  }
  function gxFilter(f) { gx.fam = f; gxApply(); $('#drawerBody').scrollTop = 0; }
  function gxNames(list) { var n = list.slice(0, 2).map(function (e) { return '<b>' + esc(elName(e)) + '</b>'; }).join(', '); return n + (list.length > 2 ? ' e mais ' + (list.length - 2) : ''); }
  function gxCtx() {
    var c = $('#gxCtx'), list = sels(); if (!c) return;
    c.innerHTML = list.length ? 'Provar em: ' + gxNames(list) + ' · slide ' + (cur + 1) : 'Nada selecionado: as caixas mostram um exemplo · slide ' + (cur + 1);
  }
  /* “Em uso”: o efeito que a seleção (ou o slide, para transições) já tem */
  function gxMarks() {
    var list = sels(), s = slide();
    $$('#drawerBody .gx-box').forEach(function (bx) {
      var it = bx._it, p = GX_PATH[it.fam], on = false;
      if (p) on = list.length > 0 && list.every(function (e) { return ((e.anim && e.anim[p]) || 'none') === it.key; });
      else if (it.fam === 'tr') on = (s.tr || 'fade') === it.key;
      else if (it.variant) on = list.length === 1 && list[0].kind === it.kind && (list[0].variant || RT.FX[it.kind].variant) === it.variant;
      bx.classList.toggle('gx-used', on);
    });
  }
  /* o que o provador mostra depende do slide, da seleção e do estado da obra (desfazer/refazer também atualiza a prova) */
  function gxKey() { return cur + '|' + selIds.join(',') + '|' + rev; }
  function galSync() {
    if (!gx || !gx.built) return;
    var key = gxKey(); gxMarks(); gxCtx();
    if (gx.prov && key !== gx.key) { gx.key = key; gxProvShow(); }
    gx.key = key;
  }
  /* ---------- provador ---------- */
  function gxTarget(it) {
    var list = sels();
    if (it.fam === 'tr') return { kind: 'slide' };
    if (it.fam === 'cmp') return { kind: 'insert' };
    if (it.fam === 'model' || it.fam === 'icon') { var same = list.filter(function (e) { return e.type === 'fx' && e.kind === it.kind; }); return same.length ? { kind: 'variant', els: same } : { kind: 'insert' }; }
    if (!list.length) return { kind: 'none' };
    var ok = list.filter(function (e) { return animFits(e, it.fam, it.key); });
    return { kind: 'els', els: ok, skip: list.length - ok.length };
  }
  function gxOpen(id) {
    var it = gx.byId[id]; if (!it) return;
    if (!gx.prov) gx.scroll = $('#drawerBody').scrollTop;
    gx.prov = it; gx.key = gxKey();
    $('#drawerBody').classList.add('hidden'); $('#gxProv').classList.remove('hidden'); $('#gxProv').scrollTop = 0; $('#drawer').classList.add('gxp');
    gxProvShow();
    var u = $('#gpUse'); (u.disabled ? $('#gxProv [data-gp=discard]') : u).focus({ preventScroll: true });
  }
  function gxIsOpen() { return !!gx.prov; }
  function gxClose(quiet) {
    if (!gx.prov) return; var id = gx.prov.id;
    gxProvStop(); gx.prov = null; $('#gpBox').innerHTML = '';
    $('#gxProv').classList.add('hidden'); $('#drawer').classList.remove('gxp');
    if (drawerTab === 'fx') { $('#drawerBody').classList.remove('hidden'); $('#drawerBody').scrollTop = gx.scroll || 0; }
    if (!quiet) { var t = $('#drawerBody .gx-box[data-gx="' + id + '"] .gx-try'); if (t) t.focus({ preventScroll: true }); }
  }
  function gxProvStop() { gx.pts.forEach(function (x) { clearTimeout(x); clearInterval(x); }); gx.pts = []; if (gx.pclean) { gx.pclean(); gx.pclean = null; } }
  /* ordem de navegação ‹ ›: as caixas visíveis no filtro atual */
  function gxOrder() { return $$('#drawerBody .gx-box').filter(function (bx) { return !bx.hidden; }).map(function (bx) { return bx.dataset.gx; }); }
  function gxStep(d) { var o = gxOrder(), i = o.indexOf(gx.prov.id); if (!o.length) return; gx.prov = gx.byId[o[(i + d + o.length) % o.length]]; gxProvShow(); }
  function gxProvShow() {
    var it = gx.prov, t = gxTarget(it), o = gxOrder(), i = o.indexOf(it.id), box = $('#gpBox'), use = $('#gpUse'), msg, tag, st, s, ids = [];
    gxProvStop(); box.innerHTML = ''; gx.ptg = []; gx.pt = t;
    $('#gpPos').textContent = (i >= 0 ? (i + 1) + ' de ' + o.length + ' · ' : '') + GX_CHIP[it.fam];
    $('#gpName').textContent = it.name; $('#gpCat').textContent = it.cat; $('#gpTip').textContent = it.host || it.tip;
    $('#gpWhen').textContent = it.host ? it.tip : (it.when || it.tip);
    if (it.fam === 'tr') {
      var A = cur > 0 ? deck.slides[cur - 1] : gxTrSlides()[0], B = slide();
      tag = (cur > 0 ? 'Slide ' + cur + ' → ' : 'Exemplo → ') + 'slide ' + (cur + 1);
      msg = 'Vai para: <b>transição de entrada do slide ' + (cur + 1) + '</b>.'; use.disabled = false;
      gxProvTr(A, B, it.key);
    } else {
      if (t.kind === 'none') { s = gxSample(it, gxAnim(it)); ids = ['gxt']; tag = 'Exemplo'; }
      else {
        s = clone(slide()); var add = null, tg = t.els || [], min = Infinity;
        if (t.kind === 'insert') { add = fxFor(it.kind, null, it.variant); Object.assign(add.data, icSample(it) || {}); s.els.push(add); ids = [add.id]; }
        else { ids = tg.map(function (e) { return e.id; }); tg.forEach(function (e) { min = Math.min(min, (e.anim && +e.anim.delay) || 0); }); }
        s.els.forEach(function (e) {
          var on = ids.indexOf(e.id) >= 0; e.anim = Object.assign({}, e.anim);
          if (on && it.fam === 'icon') e.data = Object.assign({}, e.data, { trig: e.data.trig === 'loop' ? 'loop' : 'in-loop' }); /* a prova mostra o movimento sem esperar o mouse */
          if (e === add) return;
          if (on && (it.fam === 'model' || it.fam === 'icon')) e.variant = it.variant;
          if (on && GX_PATH[it.fam]) { e.anim[GX_PATH[it.fam]] = it.key; if (it.fam === 'in') e.anim.delay = Math.max(0, (+e.anim.delay || 0) - min); }
          if (!(on && (it.fam === 'in' || it.fam === 'emph' || it.fam === 'model' || it.fam === 'icon'))) e.anim.in = 'none';
        });
        tag = 'Slide ' + (cur + 1) + (t.kind === 'insert' ? ' · novo elemento' : ' · ' + (ids.length === 1 ? elName(tg[0]) : ids.length + ' elementos'));
      }
      st = RT.renderSlide(s, { play: true }); box.appendChild(st); gx.pst = st; gx.ptg = gxTargets(st, ids);
      if (it.fam === 'hover' && ids.length) { var e0 = s.els.filter(function (x) { return x.id === ids[0]; })[0]; gxCurAt(box, e0.type === 'line' ? RT.lineBox(e0) : e0); }
      if (t.kind === 'none') { msg = '<b>Nada selecionado.</b> Selecione um elemento no slide e o provador mostra o efeito nele.'; use.disabled = true; }
      else if (t.kind === 'els' && !t.els.length) { msg = 'Este efeito ' + onlyMsg(it) + '. Selecione um elemento compatível.'; use.disabled = true; }
      else if (t.kind === 'els') { msg = 'Vai para: ' + gxNames(t.els) + (t.skip ? ' · ' + plural(t.skip, 'elemento fica', 'elementos ficam') + ' de fora (' + onlyMsg(it) + ')' : '') + '.'; use.disabled = false; }
      else if (t.kind === 'variant') { msg = 'Vai para: ' + gxNames(t.els) + (it.fam === 'icon' ? ' (troca o movimento; ' + icTrigNote(t.els) + ').' : ' (troca o efeito do modelo).'); use.disabled = false; }
      else { msg = 'Vai para: um novo <b>' + esc(RT.FX[it.kind].name) + '</b> no centro do slide ' + (cur + 1) + '.'; use.disabled = false; }
      gxProvPlay();
    }
    $('#gpTag').textContent = tag; $('#gpTgt').innerHTML = msg;
    use.title = use.disabled ? 'Selecione um elemento compatível no slide' : 'Aplicar (Ctrl+Z desfaz)';
    gxFit();
  }
  /* tela baixa (gaveta estreita, barra de decisão fixa embaixo): o palco encolhe só o necessário para que legenda, Repetir,
     “Quando usar” e “Vai para” fiquem à vista, acima de “Usar” e “Descartar” (sem passar de 55% da largura; abaixo disso, rola) */
  function gxFit() {
    var st = $('#gxProv .gp-stage'), dec = $('#gxProv .gp-dec'), w, over; if (!st || !gx.prov) return;
    st.style.width = st.style.marginLeft = st.style.marginRight = '';
    if (getComputedStyle(dec).position !== 'sticky') return;
    over = $('#gpTgt').getBoundingClientRect().bottom + 6 - dec.getBoundingClientRect().top; if (over <= 0) return;
    w = st.offsetWidth; st.style.width = Math.round(Math.max(w * .55, w - over * 16 / 9)) + 'px'; st.style.marginLeft = st.style.marginRight = 'auto';
  }
  addEventListener('resize', function () { if (gx && gx.prov) gxFit(); });
  function gxProvTr(A, B, key) {
    var box = $('#gpBox'); box.innerHTML = '';
    var sl = gxTrDeck(box, A, B, key, true), stB = sl[1].firstChild;
    gx.pts.push(setTimeout(function () { if (coverOpen()) return; sl[0].classList.remove('on'); sl[1].classList.add('on'); gxPlay(stB); gx.pclean = RT.runFx(stB); }, 700));
    gx.pts.push(setTimeout(function () { if (gx.pclean) { gx.pclean(); gx.pclean = null; } if (gx.prov && gx.prov.fam === 'tr') gxProvTr(A, B, key); }, 4300));
  }
  /* toca a prévia: entradas e componentes repetem sozinhos; mouse alterna entre com/sem cursor; contínuos só rodam */
  function gxProvPlay() {
    var it = gx.prov, st = gx.pst; gxProvStop();
    gxPlay(st); if (it.fam === 'cmp' || it.fam === 'model') gx.pclean = RT.runFx(st);
    if (it.fam === 'hover') { gxProvCycle(); return; }
    if (it.fam === 'loop' || it.fam === 'icon') return;
    var per = it.fam === 'cmp' || it.fam === 'model' ? 5600 : 3400;
    gx.pts.push(setInterval(function () { if (coverOpen() || document.hidden) return; if (gx.pclean) { gx.pclean(); gx.pclean = null; } gxPlay(gx.pst); if (it.fam === 'cmp' || it.fam === 'model') gx.pclean = RT.runFx(gx.pst); }, per));
  }
  function gxProvHov(on, real) { gx.ptg.forEach(function (n) { n.classList.toggle('am-hov', on); }); $('#gpBox').classList.toggle('gx-hovon', on && !real); }
  function gxProvCycle() {
    gx.pts.forEach(function (x) { clearTimeout(x); }); gx.pts = [];
    var on = false;
    (function step() { if (!gx.prov || gx.preal) return; on = !on; gxProvHov(on); gx.pts.push(setTimeout(step, on ? 1900 : 1300)); })();
  }
  /* decisão: Usar = um passo só de desfazer; Descartar = nada muda */
  function gxUse() {
    var it = gx.prov; if (!it) return; var t = gxTarget(it), n, p = GX_PATH[it.fam];
    if (t.kind === 'none' || (t.els && !t.els.length)) return;
    if (editingId) endEdit(); flush();
    gxClose(true);
    if (t.kind === 'slide') { slide().tr = it.key; commit(); renderProps(); toast('Transição “' + it.name + '” no slide ' + (cur + 1) + ' · Ctrl+Z desfaz'); }
    else if (t.kind === 'insert') { insertFx(it.kind, null, null, it.variant, icSample(it)); toast('“' + (it.host || it.name) + '” inserido · edite no painel à direita · Ctrl+Z desfaz'); }
    else {
      t.els.forEach(function (e) { if (p) { e.anim = e.anim || {}; e.anim[p] = it.key; } else e.variant = it.variant; rerenderEl(e); });
      commit(); renderProps(); n = t.els.length;
      toast('“' + it.name + '” aplicado' + (n > 1 ? ' a ' + n + ' elementos' : '') + ' · Ctrl+Z desfaz');
    }
    var bt = $('#drawerBody .gx-box[data-gx="' + it.id + '"] .gx-try'); if (bt) bt.focus({ preventScroll: true });
  }
  function openGallery(fam, q) {
    openDrawer(true, 'fx'); gxClose(true);
    gx.fam = fam && (fam === 'all' || GX_CHIP[fam]) ? fam : 'all'; gx.q = q || ''; $('#gxSearch').value = gx.q; gxApply(); $('#drawerBody').scrollTop = 0;
  }
  function gxWide(on) { gx.wide = on; try { localStorage.setItem('amStudio.gxWide', on ? '1' : '0'); } catch (e) { } $('#drawer').classList.toggle('gxw', on && drawerTab === 'fx'); var w = $('#drawerBody [data-gw]'); if (w) { w.setAttribute('aria-pressed', on ? 'true' : 'false'); w.title = on ? 'Reduzir a vitrine' : 'Ampliar a vitrine'; } }
  $('#drawerBody').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.gf) { gxFilter(b.dataset.gf); return; }
    if (b.dataset.gw) { gxWide(!gx.wide); return; }
    if (b.dataset.ins) { insertFx(b.dataset.ins, null, null, b.dataset.v, b.dataset.n ? { name: b.dataset.n } : null); toast('Efeito inserido. Edite o conteúdo no painel à direita.'); return; }
    if (b.classList.contains('gx-try')) gxOpen(b.parentNode.dataset.gx);
  });
  $('#drawerBody').addEventListener('focusin', function (e) { var bx = e.target.classList && e.target.classList.contains('gx-try') && e.target.parentNode; if (bx) gxPoke(bx, true); });
  $('#drawerBody').addEventListener('focusout', function (e) { var bx = e.target.classList && e.target.classList.contains('gx-try') && e.target.parentNode; if (bx) gxPoke(bx, false); });
  /* setas movem o foco entre as caixas (grade), sem mexer no slide */
  $('#drawerBody').addEventListener('keydown', function (e) {
    var t = e.target; if (!t.classList || !t.classList.contains('gx-try') || e.key.indexOf('Arrow') !== 0 || !$('#drawer').classList.contains('open') || presenting()) return;
    var all = $$('#drawerBody .gx-box').filter(function (bx) { return !bx.hidden; }), i = all.indexOf(t.parentNode), g = t.parentNode.parentNode;
    var cols = Math.max(1, Math.round(g.clientWidth / Math.max(1, t.parentNode.offsetWidth)));
    var j = i + ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols })[e.key];
    e.preventDefault(); e.stopPropagation();
    if (all[j]) { all[j].querySelector('.gx-try').focus(); all[j].scrollIntoView({ block: 'nearest' }); }
  });
  /* arrastar a caixa leva o efeito mostrado nela (modelo + variante: 'amfx:raci:focus') */
  $('#drawerBody').addEventListener('dragstart', function (e) { var c = e.target.closest('.gx-box[draggable]'); if (!c) return; e.dataTransfer.setData('text/plain', 'amfx:' + c.dataset.k + (c.dataset.v || c.dataset.n ? ':' + (c.dataset.v || '') : '') + (c.dataset.n ? ':' + c.dataset.n : '')); e.dataTransfer.effectAllowed = 'copy'; });
  function gxAgain() { if (gx.prov.fam === 'tr' || gx.prov.fam === 'loop') gxProvShow(); else gxProvPlay(); }
  $('#gxProv').addEventListener('click', function (e) {
    var b = e.target.closest('[data-gp]'); if (!b || !gx.prov) return; var a = b.dataset.gp;
    if (a === 'use') gxUse(); else if (a === 'discard' || a === 'back') gxClose(); else if (a === 'prev') gxStep(-1); else if (a === 'next') gxStep(1);
    else if (a === 'replay') gxAgain();
  });
  /* teclado no provador: ← → navegam, Esc descarta (sem fechar a gaveta nem tirar a seleção), Espaço/Enter repetem, ? ajuda;
     Delete, Backspace, letras e ↑ ↓ ficam aqui (↑ ↓ rolam o provador): nada mexe no elemento selecionado por trás.
     Devolve true quando a tecla é do provador; num botão, Espaço/Enter seguem com o botão. */
  function gxKeys(e) {
    var k = e.key, alt = e.altKey;
    if (k === 'Escape') { e.preventDefault(); gxClose(); return true; }
    if (!alt && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); gxStep(k === 'ArrowRight' ? 1 : -1); return true; }
    if (onControl(e.target)) return false;
    if (!alt && (k === ' ' || k === 'Enter')) { e.preventDefault(); gxAgain(); return true; }
    if (!alt && k === '?') { e.preventDefault(); showHelp(); return true; }
    if (k === 'Delete' || k === 'Backspace' || k.length === 1) { e.preventDefault(); return true; }
    return /^(Arrow|Page|Home|End)/.test(k);
  }
  $('#gxProv').addEventListener('keydown', function (e) {
    if (!gx.prov || presenting() || typingTarget(e.target) || e.ctrlKey || e.metaKey) return;
    if (gxKeys(e)) e.stopPropagation();
  });
  /* clique na gaveta (fora de um controle) deixa o foco no corpo da página: as teclas seguintes ainda são do provador */
  document.addEventListener('pointerdown', function (e) { gx.pin = !!(e.target.closest && e.target.closest('#drawer')); }, true);
  /* arrastar para o slide: imagens, modelos da biblioteca ou uma apresentação salva (.html/.json) */
  function dragKind(dt) {
    var fs = Array.prototype.slice.call(dt.items || []).filter(function (i) { return i.kind === 'file'; }), types = Array.prototype.slice.call(dt.types || []);
    if (fs.some(function (i) { return /^image\//.test(i.type); })) return 'image';
    if (fs.some(function (i) { return /^(text\/html|application\/json)$/.test(i.type); })) return 'deck';
    if (window.AMImport && fs.some(function (i) { return /presentationml\.presentation|application\/pdf/.test(i.type); })) return 'import'; /* S24: .pptx / .pdf */
    if (fs.length) return fs.some(function (i) { return !i.type; }) ? 'file' : 'other';
    if (types.indexOf('Files') >= 0) return 'file';
    if (types.indexOf('text/plain') >= 0) return 'text';
    return null;
  }
  wrap.addEventListener('dragover', function (e) { var k = dragFrom == null && dragKind(e.dataTransfer); if (!k) return; e.preventDefault(); e.dataTransfer.dropEffect = k === 'other' ? 'none' : 'copy'; wrap.classList.toggle('dragover', k !== 'other'); });
  wrap.addEventListener('dragleave', function (e) { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('dragover'); });
  wrap.addEventListener('drop', function (e) {
    e.preventDefault(); wrap.classList.remove('dragover'); var p = toLogical(e);
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.indexOf('image') === 0) { readImage(f, function (src, w, h) { var el = mkImage(src, w, h); el.x = Math.round(Math.max(0, Math.min(W - el.w, p.x - el.w / 2))); el.y = Math.round(Math.max(0, Math.min(H - el.h, p.y - el.h / 2))); addEl(el); }); return; }
    if (f && window.AMImport && window.AMImport.isImportFile(f)) { if (editingId) endEdit(); flush(); window.AMImport.open(f); return; } /* S24 */
    if (f && isDeckFile(f)) {
      if (editingId) endEdit(); flush();
      if (isBlank()) openFile(f); else confirmBox({ eyebrow: 'Abrir', icon: 'open', title: 'Abrir “' + f.name + '”?', msg: 'A apresentação atual será substituída. ' + LOSE, ok: 'Abrir' }, function () { openFile(f); });
      return;
    }
    if (f) { toast('Arquivo não suportado. Solte uma imagem, uma apresentação .html salva' + (window.AMImport ? ', um PowerPoint (.pptx) ou um PDF' : '') + '.'); return; }
    var t = e.dataTransfer.getData('text/plain'), kv = t.slice(5).split(':'); if (t.indexOf('amfx:') === 0 && Object.prototype.hasOwnProperty.call(RT.FX, kv[0])) insertFx(kv[0], null, p, kv[1], dropData(kv));
  });

  /* ---------------- menus do aplicativo e menu de contexto ---------------- */
  /* item: { t: rótulo, ic: ícone, k: atalho, fn: ação, dis: desativado, sub: itens|função } · { sep: 1 } · { hd: 'título' } */
  var XM = { stack: [], bar: null, timer: null, n: 0, prev: null };
  function buildX(items) {
    var m = document.createElement('div'); m.className = 'xmenu' + (items.cls ? ' ' + items.cls : ''); m.setAttribute('role', 'menu'); /* cls: 'xcols' (duas colunas), 'xwide' (miniatura larga) */
    items.forEach(function (it) {
      if (!it) return;
      if (it.sep) { if (m.lastChild && !m.lastChild.classList.contains('xsep')) m.insertAdjacentHTML('beforeend', '<div class="xsep" role="separator"></div>'); return; }
      if (it.hd) { m.insertAdjacentHTML('beforeend', '<div class="xhd">' + esc(it.hd) + '</div>'); return; }
      var b = document.createElement('button'); b.type = 'button'; b.className = 'xi' + (it.dis ? ' dis' : ''); b.setAttribute('role', 'menuitem'); b.tabIndex = -1; b.id = 'xi' + (++XM.n);
      if (it.dis) b.setAttribute('aria-disabled', 'true'); if (it.sub) b.setAttribute('aria-haspopup', 'true'); if (it.id) b.dataset.x = it.id; if (it.tip) b.title = it.tip;
      b.innerHTML = '<span class="xic">' + (it.raw || (it.ic ? svgI(it.ic) : '')) + '</span><span class="xl">' + esc(it.t) + '</span>' + (it.k ? '<kbd>' + esc(it.k) + '</kbd>' : '<span></span>') + (it.sub ? '<svg class="xar" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' : '<span></span>');
      b._it = it; m.appendChild(b);
    });
    if (m.lastChild && m.lastChild.classList.contains('xsep')) m.lastChild.remove();
    return m;
  }
  function placeX(m, o) {
    var r = m.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, x, y;
    if (o.from) { var pr = o.from; x = pr.right + 4; if (x + r.width > vw - 8) x = Math.max(8, pr.left - r.width - 4); y = pr.top - 7; }
    else { x = o.x; y = o.y; if (x + r.width > vw - 8) x = Math.max(8, vw - 8 - r.width); if (y + r.height > vh - 8) y = o.ctx ? Math.max(8, y - r.height) : Math.max(8, vh - 8 - r.height); }
    if (y + r.height > vh - 8) y = Math.max(8, vh - 8 - r.height);
    m.style.left = Math.round(x) + 'px'; m.style.top = Math.round(y) + 'px'; m.style.transformOrigin = (o.from ? 'left' : 'top') + ' left';
  }
  function openX(items, o) {
    o = o || {}; var level = o.level || 0; closeXFrom(level);
    if (!level) { closeOld(); stopPreview(); var ae = document.activeElement; XM.prev = ae && ae !== document.body && !ae.closest('.xmenu') ? ae : null; }
    var m = buildX(typeof items === 'function' ? items() : items); m.style.left = '-9999px'; m.style.top = '0px'; document.body.appendChild(m); placeX(m, o);
    XM.stack[level] = { el: m, owner: o.owner || null };
    m.addEventListener('mousedown', function (e) { e.preventDefault(); });
    m.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    m.addEventListener('pointerover', function (e) {
      var b = e.target.closest('.xi'); if (!b || !m.contains(b)) return; hotX(m, b);
      clearTimeout(XM.timer);
      XM.timer = setTimeout(function () { if (!XM.stack[level] || XM.stack[level].el !== m) return; if (b._it.sub && !b._it.dis) openSubX(b, level); else closeXFrom(level + 1); }, b._it.sub ? 90 : 160);
    });
    m.addEventListener('pointerleave', function () { var nx = XM.stack[level + 1]; if (!nx) $$('.xi.hot', m).forEach(function (x) { x.classList.remove('hot'); }); });
    m.addEventListener('click', function (e) { var b = e.target.closest('.xi'); if (b && m.contains(b)) activateX(b, level); });
    return m;
  }
  /* item em destaque; pelo teclado ele também recebe o foco (leitores de tela anunciam o item) */
  function hotX(m, b, kb) {
    $$('.xi.hot', m).forEach(function (x) { if (x !== b) x.classList.remove('hot'); }); if (!b || b.classList.contains('dis')) return;
    b.classList.add('hot'); m.setAttribute('aria-activedescendant', b.id); if (kb && !editingId) b.focus({ preventScroll: true });
  }
  function openSubX(b, level) {
    var nx = XM.stack[level + 1]; if (nx && nx.owner === b) return nx.el;
    $$('.xi.subopen', XM.stack[level].el).forEach(function (x) { x.classList.remove('subopen'); });
    var m = openX(b._it.sub, { level: level + 1, from: b.getBoundingClientRect(), owner: b }); b.classList.add('subopen'); return m;
  }
  function activateX(b, level) {
    var it = b._it; if (!it || it.dis) return;
    if (it.sub) { var m = openSubX(b, level); var f = m && m.querySelector('.xi:not(.dis)'); if (f) hotX(m, f, true); return; }
    closeAllX(); if (editingId && !it.keepEdit) endEdit();
    if (it.fn) it.fn();
  }
  function closeXFrom(level) {
    var ae = document.activeElement, had = false;
    while (XM.stack.length > level) { var s = XM.stack.pop(); if (s) { if (s.el.contains(ae)) had = true; s.el.remove(); if (s.owner) s.owner.classList.remove('subopen', 'open'); } }
    if (had) { var top = XM.stack[level - 1], h = top && top.el.querySelector('.xi.subopen,.xi.hot'); if (h) h.focus({ preventScroll: true }); else if (XM.prev && document.contains(XM.prev)) XM.prev.focus({ preventScroll: true }); else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }
  }
  function closeAllX() { clearTimeout(XM.timer); closeXFrom(0); XM.bar = null; $$('#mbar button.open,#bSaveMore[aria-expanded=true]').forEach(function (b) { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }); }
  /* teclado dentro dos menus: setas, Enter, Esc */
  function menuKey(e) {
    var lv = XM.stack.length - 1, top = XM.stack[lv], m = top.el, its = $$('.xi:not(.dis)', m), hot = m.querySelector('.xi.hot'), i = its.indexOf(hot);
    /* menu em duas colunas (Inserir › Forma): setas andam pela grade (↓ ↑ na mesma coluna, → ← para a coluna vizinha); sem vizinho, segue o padrão */
    if (hot && m.classList.contains('xcols') && /^Arrow(Down|Up|Left|Right)$/.test(e.key) && !(e.key === 'ArrowRight' && hot._it.sub)) {
      var hr = hot.getBoundingClientRect(), k = e.key.slice(5), best = null, bd = Infinity;
      its.forEach(function (b) { if (b === hot) return; var r = b.getBoundingClientRect(), dy = r.top - hr.top, dx = r.left - hr.left, col = Math.abs(dx) < 4, row = Math.abs(dy) < 4;
        if ((k === 'Down' ? dy > 2 && col : k === 'Up' ? dy < -2 && col : k === 'Right' ? dx > 4 && row : dx < -4 && row) && Math.abs(dx) + Math.abs(dy) < bd) { bd = Math.abs(dx) + Math.abs(dy); best = b; } });
      if (best) { e.preventDefault(); hotX(m, best, true); return true; }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (its.length) hotX(m, its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1) + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % its.length] || its[0], true); return true; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); if (its.length) hotX(m, e.key === 'Home' ? its[0] : its[its.length - 1], true); return true; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (hot && hot._it.sub) { activateX(hot, lv); return true; } if (XM.bar) barStep(1); return true; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (lv > 0) { closeXFrom(lv); return true; } if (XM.bar) barStep(-1); return true; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (hot) activateX(hot, lv); return true; }
    if (e.key === 'Escape') { e.preventDefault(); if (lv > 0) closeXFrom(lv); else closeAllX(); return true; }
    if (e.key === 'Tab') { e.preventDefault(); closeAllX(); return true; }
    return false;
  }
  var BAR = ['file', 'edit', 'insert', 'slide', 'arrange', 'present', 'help'];
  function barStep(d) { var i = BAR.indexOf(XM.bar); openBar(BAR[(i + d + BAR.length) % BAR.length], true); }
  function openBar(k, kb) {
    var b = $('#mbar [data-m="' + k + '"]'); if (!b) return;
    closeAllX(); var r = b.getBoundingClientRect(), m = openX(MENUS[k], { x: r.left, y: r.bottom + 6, owner: b });
    b.classList.add('open'); b.setAttribute('aria-expanded', 'true'); XM.bar = k;
    if (kb) { var f = m.querySelector('.xi:not(.dis)'); if (f) hotX(m, f, true); }
  }
  $('#mbar').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('#mbar').addEventListener('pointerdown', function (e) { var b = e.target.closest('button[data-m]'); if (!b || e.button !== 0) return; if (XM.bar === b.dataset.m) { closeAllX(); return; } openBar(b.dataset.m); });
  $('#mbar').addEventListener('pointerover', function (e) { var b = e.target.closest('button[data-m]'); if (b && XM.bar && XM.bar !== b.dataset.m) openBar(b.dataset.m); });
  $('#mbar').addEventListener('keydown', function (e) { var b = e.target.closest('button[data-m]'); if (b && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') && !XM.stack.length) { e.preventDefault(); e.stopPropagation(); openBar(b.dataset.m, true); } });

  /* listas de itens */
  var KEY = { cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', dup: 'Ctrl+D', all: 'Ctrl+A', del: 'Delete', undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z', save: 'Ctrl+S', open: 'Ctrl+O', f5: 'F5', sf5: 'Shift+F5', f1: 'F1', group: 'Ctrl+G', ungroup: 'Ctrl+Shift+G', lock: 'Ctrl+Shift+L', fmtc: 'Ctrl+Alt+C', fmtv: 'Ctrl+Alt+V' };
  function hasSel() { return selIds.length > 0; }
  function shapeIcon(s) { return shapeSvg(s, 'shp', '#43698F'); }
  /* Inserir › Forma ▸: os mesmos grupos da galeria, em duas colunas (cabe em 720 px); “Retângulo” é o primeiro item com esse nome */
  function shapeItems() {
    var out = [];
    SHAPE_GROUPS.forEach(function (g, gi) {
      out.push({ hd: g[0] });
      g[1].forEach(function (k) { out.push({ t: SHAPE_N[k], raw: shapeIcon(k), fn: function () { addEl(mkShape(k, dark())); } }); });
      if (!gi && LOOKS.length > 1) out.push({ t: 'Cards com estilo', ic: 'card', sub: cardLookItems });
    });
    out.cls = 'xcols'; return out;
  }
  function cardLookItems() { return LOOKS.slice(1).map(function (l) { return { t: l[1], raw: lookSvg(l[0], 'shp'), fn: function () { addEl(mkCard(l[0], dark())); } }; }); }
  function lineItems() { var out = []; LINE_PRESETS.forEach(function (p) { if (p[3]) out.push({ hd: p[3] }); out.push({ t: p[1], raw: linePrev(p[0], 'xln').replace('<svg ', '<svg class="shp lnp" '), fn: function () { addEl(mkLinePreset(p[0], dark())); } }); }); out.cls = 'xwide'; return out; }
  function layoutItems(after) { return Object.keys(LAYOUTS).filter(function (k) { return !LAYOUTS[k].hidden; }).map(function (k) { return { t: LAYOUTS[k].name, raw: '<span class="mi-sw" style="background:' + LAYOUTS[k].bg + '"></span>', fn: function () { addSlide(k); } }; }); }
  function hasInst() { return SEQS.some(function (s) { return s[0] === 'inst'; }); }
  function brandItems() {
    return (hasInst() ? [{ hd: 'Slides institucionais' }, { t: 'Inserir os 5 slides institucionais', ic: 'brand', tip: 'Capa, presença global, clientes, esferas de atuação e cadeia de valor, no padrão oficial, depois do slide atual', fn: function () { insertSeq('inst'); } }] : []).concat([{ hd: 'Logos' }, { t: 'A&M Performance (branco)', raw: '<span class="mi-sw" style="background:#002A46"></span>', fn: function () { insertBrand('perfW'); } }, { t: 'A&M Performance (navy)', raw: '<span class="mi-sw" style="background:#fff"></span>', fn: function () { insertBrand('perfN'); } },
      { t: 'Alvarez & Marsal (branco)', raw: '<span class="mi-sw" style="background:#002A46"></span>', fn: function () { insertBrand('wmW'); } }, { t: 'Alvarez & Marsal (navy)', raw: '<span class="mi-sw" style="background:#fff"></span>', fn: function () { insertBrand('wmN'); } },
      { hd: 'Elementos' }, { t: 'Linhas diagonais A&M', ic: 'brand', fn: function () { insertFx('amlines'); } }, { t: 'Traço laranja', raw: '<span class="mi-sw" style="background:linear-gradient(120deg,#fff 45%,#F78C16 45%,#F78C16 55%,#fff 55%)"></span>', fn: function () { insertBrand('slash'); } }]);
  }
  /* mesmos itens do menu "Cards" da faixa de ferramentas */
  /* S30/S31: componentes interativos da apresentação (formulário; depois post-its, votação, cronômetro) */
  var INTERACTIVE = [['form', 'Formulário inserido. Escreva as perguntas no painel à direita; na apresentação, as pessoas respondem no slide.', 'form'],
    ['board', 'Quadro inserido. Defina as colunas e as notas iniciais no painel; na apresentação, cada coluna ganha “+ Nota”.', 'note'],
    ['vote', 'Votação inserida. Escreva as opções e os pontos por pessoa no painel; na apresentação, cada um distribui os pontos e vota.', 'vote'],
    ['timer', 'Cronômetro inserido. Defina minutos e segundos no painel; na apresentação, Iniciar/Pausar, Reiniciar e ±1 min.', 'timer']];
  /* S35: personagens A&M (rt-70-personas.js): um item por preset do elenco + o balão solto */
  function personaItems() {
    var P = RT.personas; if (!P || !RT.FX.persona) return [];
    return P.PRESETS.map(function (p) { return { t: p[1], ic: 'persona', tip: p[3], fn: function () { insertFx('persona', null, null, p[0]); toast('Personagem inserido. Roupa, ferramenta, expressão, fala e movimento ficam no painel à direita; na apresentação ele reage ao clique.'); } }; })
      .concat(RT.FX.bubble ? [{ sep: 1 }, { t: 'Balão de fala', ic: 'bubble', fn: function () { insertFx('bubble'); toast('Balão inserido: duplo clique escreve; prenda uma linha a ele para ligar a quem fala.'); } }] : []);
  }
  function interactiveItems() { return INTERACTIVE.filter(function (o) { return RT.FX[o[0]]; }).map(function (o) { return { t: RT.FX[o[0]].name, ic: o[2] || 'form', fn: function () { insertFx(o[0]); toast(o[1]); } }; }); }
  function cardItems() { return $$('#mCard button').map(function (b) { return { t: b.textContent, ic: 'card', fn: function () { insertFx(b.dataset.fx, b.dataset.style || (b.dataset.fx === 'card' && dark() ? 'dark' : null)); } }; }); }
  function alignItems() {
    var list = sels(), n = list.length, many = n > 1;
    return [{ hd: many ? 'Alinhar entre si' : 'Alinhar no slide' }].concat(ALIGNS.map(function (a) { return { t: a[1].replace('Alinhar ', '').replace(/^à /, '').replace(/^ao /, '').replace(/^./, function (c) { return c.toUpperCase(); }), ic: a[0], dis: !n, fn: function () { act(a[0]); } }; }));
  }
  /* Girar e inverter ▸ (menu de contexto do elemento e Organizar): as mesmas ações da barra do quadro e do painel */
  function rotItems() {
    var list = sels(), why = flipWhy(list), lineOnly = list.length && list.every(function (e) { return e.type === 'line'; });
    return FR.map(function (f) { return { t: f[1], ic: f[0], dis: !list.length || (f[0].indexOf('flip') === 0 && !!why), fn: function () { act(f[0]); } }; })
      .concat(lineOnly ? [] : [{ sep: 1 }, { t: 'Zerar rotação', ic: 'rot-0', dis: !hasRot(list), fn: function () { act('rot-0'); } }]);
  }
  function distItems() { var n = sels().length; return [{ t: 'Horizontalmente', ic: 'dist-h', dis: n < 3, fn: function () { act('dist-h'); } }, { t: 'Verticalmente', ic: 'dist-v', dis: n < 3, fn: function () { act('dist-v'); } }]; }
  var MENUS = {
    file: function () {
      return [{ t: 'Início (capa)', ic: 'home', fn: goHome }, { sep: 1 },
        { t: 'Nova apresentação', ic: 'file', fn: newPresentation }, { t: 'Abrir…', ic: 'open', k: KEY.open, fn: openPicker }, { t: 'Minhas obras…', ic: 'obras', fn: goObras }, { t: 'Kit de marca…', ic: 'palette', fn: function () { openBrandKit(XM.prev); }, dis: !window.AMBrand, tip: 'Cores e fonte desta apresentação: vêm primeiro nas amostras, valem para o que você inserir e podem ser aplicadas a tudo' }, { t: 'Importar PowerPoint ou PDF…', ic: 'import', fn: importPicker, dis: !window.AMImport, tip: window.AMImport ? 'Converte um .pptx ou .pdf em slides editáveis (textos, formas, linhas, fotos, tabelas)' : 'Importação indisponível' }, { t: 'Salvar apresentação', ic: 'save', k: KEY.save, fn: save },
        { t: 'Salvar como PDF…', ic: 'pdf', fn: function () { exportAs('pdf'); } }, { t: 'Salvar como PowerPoint…', ic: 'ppt', dis: !pptxOk(), tip: pptxOk() ? '' : PPTX_SOON, fn: function () { exportAs('pptx'); } }, { sep: 1 },
        { t: 'Apresentar', ic: 'play', k: KEY.f5, fn: function () { present(0); } }, { sep: 1 },
        { t: 'Recomeçar apresentação…', ic: 'reset', fn: askReset }];
    },
    edit: function () {
      var any = hasSel(), sl = zone === 'thumbs';
      if (editingId) {
        /* editando um texto: copiar, recortar, colar e selecionar tudo agem dentro do texto (como Ctrl+C/X/V) */
        var txs = String(getSelection() || '').length > 0;
        return [{ t: 'Desfazer', ic: 'undo', k: KEY.undo, dis: !hist.length, fn: undo }, { t: 'Refazer', ic: 'redo', k: KEY.redo, dis: !fut.length, fn: redo }, { sep: 1 },
          { t: 'Recortar', ic: 'cut', k: KEY.cut, dis: !txs, keepEdit: 1, fn: function () { document.execCommand('cut'); } },
          { t: 'Copiar', ic: 'copy', k: KEY.copy, dis: !txs, keepEdit: 1, fn: function () { document.execCommand('copy'); } },
          { t: 'Colar', ic: 'paste', k: KEY.paste, keepEdit: 1, fn: pasteIntoEdit }, { sep: 1 },
          { t: 'Selecionar todo o texto', ic: 'all', k: KEY.all, keepEdit: 1, fn: function () { document.execCommand('selectAll'); } },
          { t: 'Concluir edição', ic: 'edit', k: 'Esc', fn: function () { } }];
      }
      return [{ t: 'Desfazer', ic: 'undo', k: KEY.undo, dis: !hist.length, fn: undo }, { t: 'Refazer', ic: 'redo', k: KEY.redo, dis: !fut.length, fn: redo }, { t: 'Localizar e substituir…', ic: 'find', k: 'Ctrl+F', fn: openFind }, { sep: 1 },
        { t: sl ? 'Recortar slide' : 'Recortar', ic: 'cut', k: KEY.cut, dis: !any && !sl, fn: function () { doCopy(true); } },
        { t: sl ? 'Copiar slide' : 'Copiar', ic: 'copy', k: KEY.copy, dis: !any && !sl, fn: function () { doCopy(false); } },
        { t: 'Colar', ic: 'paste', k: KEY.paste, fn: function () { pasteFromSystem(null); } },
        { t: sl ? 'Duplicar slide' : 'Duplicar', ic: 'dup', k: KEY.dup, dis: !any && !sl, fn: function () { if (zone === 'thumbs') dupSlide(cur); else dupSel(); } }, { sep: 1 },
        { t: 'Selecionar tudo', ic: 'all', k: KEY.all, dis: !slide().els.length, fn: selectAll },
        sl ? { t: 'Apagar slide', ic: 'del', k: KEY.del, dis: deck.slides.length < 2, fn: function () { delSlide(cur); } } : { t: 'Apagar seleção', ic: 'del', k: KEY.del, dis: !any, fn: delSel }, { sep: 1 },
        { t: 'Limpar slide', ic: 'clear', dis: !slide().els.length, fn: clearSlide }];
    },
    insert: function () {
      return [{ t: 'Título', ic: 'title', fn: function () { insertText('title'); } }, { t: 'Subtítulo em destaque', ic: 'sub', fn: function () { insertText('subtitle'); } }, { t: 'Texto corrido', ic: 'text', fn: function () { insertText('body'); } },
        { t: 'Forma', ic: 'shape', sub: shapeItems }, { sep: 1 },
        { t: 'Linhas e setas', ic: 'arrow', sub: lineItems },
        { t: 'Imagem…', ic: 'image', fn: function () { pickImage(function (src, w, h) { addEl(mkImage(src, w, h)); }); } },
        RT.ICONS ? { t: 'Ícone animado', ic: 'icons', sub: iconItems } : null,
        { t: 'Gráfico', ic: 'chart', sub: chartItems },
        RT.SMART_LAYOUTS ? { t: 'SmartArt', ic: 'smart', sub: smartItems } : null,
        { t: 'Cards', ic: 'card', sub: cardItems }, RT.FX.form ? { t: 'Interativo', ic: 'form', sub: interactiveItems } : null, RT.FX.persona ? { t: 'Personagens', ic: 'persona', sub: personaItems } : null, { t: 'Marca A&M', ic: 'brand', sub: brandItems }, { sep: 1 },
        { t: 'Modelos…', ic: 'models', fn: function () { openDrawer(true, 'models'); } }, { t: 'Efeitos…', ic: 'fx', fn: function () { openDrawer(true, 'fx'); } }];
    },
    slide: function () {
      var n = deck.slides.length;
      return [{ t: 'Novo slide', ic: 'slide', sub: layoutItems }, { t: 'Inserir bloco pronto', ic: 'models', sub: seqItems }].concat(hasInst() ? [{ t: 'Inserir slides institucionais A&M', ic: 'brand', tip: 'Os 5 slides oficiais depois do slide atual · Ctrl+Z desfaz', fn: function () { insertSeq('inst'); } }] : [], [{ t: 'Gerar slides de uma planilha (CSV)…', ic: 'csv', dis: !window.AMBatch, tip: 'Um slide por linha da planilha: o slide atual é o modelo, com {{Coluna}} nos textos', fn: function () { if (window.AMBatch) window.AMBatch.open(XM.prev); } }, { t: 'Duplicar slide', ic: 'dup', fn: function () { dupSlide(cur); } }].concat(slideShowItems(), [{ sep: 1 },
        { t: 'Copiar slide', ic: 'copy', fn: function () { doCopy(false, 'slides'); } }, { t: 'Colar slide', ic: 'paste', fn: function () { pasteFromSystem(null, true); } },
        { t: 'Apagar slide', ic: 'del', dis: n < 2, fn: function () { delSlide(cur); } }, { sep: 1 },
        { t: 'Mover para cima', ic: 'up', dis: cur === 0, fn: function () { moveSlide(cur, -1); } }, { t: 'Mover para baixo', ic: 'down', dis: cur >= n - 1, fn: function () { moveSlide(cur, 1); } }, { sep: 1 },
        { t: sideOff ? 'Mostrar painel de slides' : 'Ocultar painel de slides', ic: 'side', fn: function () { toggleSide(); } }]));
    },
    arrange: function () {
      var any = hasSel();
      return [{ t: 'Trazer para frente', ic: 'front', dis: !any, fn: function () { act('front'); } }, { t: 'Enviar para trás', ic: 'back', dis: !any, fn: function () { act('back'); } },
        { t: 'Trazer ao topo', ic: 'top', dis: !any, fn: function () { act('top'); } }, { t: 'Enviar ao fundo', ic: 'bottom', dis: !any, fn: function () { act('bottom'); } }, { sep: 1 },
        { t: 'Alinhar', ic: 'al-c', dis: !any, sub: alignItems }, { t: 'Distribuir', ic: 'dist-h', dis: sels().length < 3, sub: distItems }, { t: 'Girar e inverter', ic: 'rot-r', dis: !any, sub: rotItems }, { sep: 1 },
        { t: 'Agrupar', ic: 'grp', k: KEY.group, dis: sels().length < 2, fn: groupSel }, { t: 'Desagrupar', ic: 'ungrp', k: KEY.ungroup, dis: !sels().some(function (e) { return e.grp; }), fn: ungroupSel },
        { t: sels().length && sels().every(isLocked) ? 'Desbloquear' : 'Bloquear', ic: sels().length && sels().every(isLocked) ? 'unlock' : 'lock', k: KEY.lock, dis: !any, tip: 'Bloqueado: não move, não redimensiona, não apaga', fn: function () { lockSel(); } }, { sep: 1 },
        { t: 'Copiar formato', ic: 'brush', k: KEY.fmtc, dis: !sel(), fn: copyFmt }, { t: 'Colar formato', ic: 'brushp', k: KEY.fmtv, dis: !any || !fmtClip, fn: pasteFmt }, { sep: 1 },
        { t: 'Camadas do slide…', ic: 'layers', fn: showLayers }];
    },
    present: function () { return [{ t: 'Do início', ic: 'play', k: KEY.f5, fn: function () { present(0); } }, { t: 'Do slide atual', ic: 'playcur', k: KEY.sf5, fn: function () { present(cur); } }]; },
    help: function () { return [{ t: 'Atalhos de teclado', ic: 'keys', k: KEY.f1, fn: showHelp }, { t: 'Manual da obra', ic: 'help', fn: howTo }]; }
  };
  function ctxElItems() {
    var list = sels(), el = sel(), n = list.length, name = n > 1 ? n + ' elementos' : (el ? elName(el) : '');
    return [{ hd: name },
      el && (el.type === 'text' || el.type === 'shape') ? { t: 'Editar texto', ic: 'edit', k: 'Enter', fn: function () { startEdit(el, false); } } : null,
      el && (el.type === 'text' || el.type === 'shape') ? { sep: 1 } : null,
      { t: 'Recortar', ic: 'cut', k: KEY.cut, fn: function () { doCopy(true, 'els'); } }, { t: 'Copiar', ic: 'copy', k: KEY.copy, fn: function () { doCopy(false, 'els'); } },
      { t: 'Colar', ic: 'paste', k: KEY.paste, fn: function () { pasteFromSystem(null); } }, { t: 'Duplicar', ic: 'dup', k: KEY.dup, fn: dupSel },
      { t: 'Apagar', ic: 'del', k: KEY.del, fn: delSel }, { sep: 1 },
      { t: 'Trazer para frente', ic: 'front', fn: function () { act('front'); } }, { t: 'Enviar para trás', ic: 'back', fn: function () { act('back'); } }, { sep: 1 },
      { t: 'Alinhar', ic: 'al-c', sub: alignItems }, n >= 3 ? { t: 'Distribuir', ic: 'dist-h', sub: distItems } : null, { t: 'Girar e inverter', ic: 'rot-r', sub: rotItems }, { sep: 1 },
      n >= 2 && !list.every(function (e) { return e.grp && e.grp === list[0].grp; }) ? { t: 'Agrupar', ic: 'grp', k: KEY.group, fn: groupSel } : null, list.some(function (e) { return e.grp; }) ? { t: 'Desagrupar', ic: 'ungrp', k: KEY.ungroup, fn: ungroupSel } : null,
      { t: list.every(isLocked) ? 'Desbloquear' : 'Bloquear', ic: list.every(isLocked) ? 'unlock' : 'lock', k: KEY.lock, fn: function () { lockSel(); } },
      el ? { t: 'Copiar formato', ic: 'brush', k: KEY.fmtc, fn: copyFmt } : null, fmtClip ? { t: 'Colar formato', ic: 'brushp', k: KEY.fmtv, fn: pasteFmt } : null,
      el && palOk(el) ? { sep: 1 } : null, el && palOk(el) ? { t: 'Cores do componente…', ic: 'palette', fn: function () { setTimeout(focusPal, 0); } } : null];
  }
  function ctxCanvasItems(p) {
    return [{ hd: 'Slide ' + (cur + 1) }, { t: 'Colar', ic: 'paste', k: KEY.paste, fn: function () { pasteFromSystem(p); } },
      { t: 'Inserir texto aqui', ic: 'texthere', fn: function () { createTextAt(p); } }, { t: 'Inserir modelo…', ic: 'models', fn: function () { openDrawer(true, 'models'); } }, { sep: 1 },
      { t: 'Novo slide', ic: 'slide', fn: newSlideAfter }, { t: 'Selecionar tudo', ic: 'all', k: KEY.all, dis: !slide().els.length, fn: selectAll }];
  }
  /* S21: “Ocultar slide” / “Reexibir slide” e “Redefinir slide” (menu Slide e menu de contexto da miniatura) */
  function slideShowItems() {
    var s = slide(), hid = s.hidden === true;
    return [{ sep: 1 }, { t: hid ? 'Reexibir slide' : 'Ocultar slide', ic: hid ? 'eye' : 'eyeoff', tip: hid ? 'O slide volta para a apresentação' : 'O slide continua na obra, mas a apresentação e o arquivo salvo pulam ele', fn: function () { toggleHidden(cur); } },
      { t: 'Redefinir slide', ic: 'slreset', dis: !s.base, tip: s.base ? RESET_TIP : NOBASE, fn: function () { resetSlide(cur); } }];
  }
  function ctxThumbItems() {
    var n = deck.slides.length;
    return [{ hd: 'Slide ' + (cur + 1) + ' de ' + n + (slide().hidden === true ? ' · oculto' : '') }, { t: 'Novo slide depois', ic: 'slide', fn: newSlideAfter }].concat(hasInst() ? [{ t: 'Inserir slides institucionais A&M', ic: 'brand', tip: 'Os 5 slides oficiais (capa, presença global, clientes, esferas, cadeia de valor) depois deste slide · Ctrl+Z desfaz', fn: function () { insertSeq('inst'); } }] : [], [{ t: 'Duplicar slide', ic: 'dup', k: KEY.dup, fn: function () { dupSlide(cur); } }], slideShowItems(), [{ sep: 1 },
      { t: 'Copiar slide', ic: 'copy', k: KEY.copy, fn: function () { doCopy(false, 'slides'); } }, { t: 'Colar slide', ic: 'paste', k: KEY.paste, fn: function () { pasteFromSystem(null, true); } },
      { t: 'Apagar slide', ic: 'del', k: KEY.del, dis: n < 2, fn: function () { delSlide(cur); } }, { sep: 1 },
      { t: 'Mover para cima', ic: 'up', dis: cur === 0, fn: function () { moveSlide(cur, -1); } }, { t: 'Mover para baixo', ic: 'down', dis: cur >= n - 1, fn: function () { moveSlide(cur, 1); } }]);
  }
  document.addEventListener('contextmenu', function (e) {
    if (presenting() || modalOpen() || coverOpen()) return;
    if (Date.now() - kbCtx < 800) { e.preventDefault(); return; } /* já aberto por Shift+F10 / tecla de menu */
    var th = e.target.closest('#thumbs .th'), inCv = e.target.closest('#cv');
    if (th) { e.preventDefault(); if (editingId) endEdit(); var i = +th.dataset.i; if (i !== cur) goSlide(i); else select(null); setZone('thumbs'); openX(ctxThumbItems, { x: e.clientX + 2, y: e.clientY + 2, ctx: 1 }); return; }
    if (!inCv) return;
    if (editingId) { var en = stage.querySelector('.am-el[data-id="' + editingId + '"]'); if (en && en.contains(e.target)) return; endEdit(); }
    e.preventDefault(); setZone('canvas');
    var n = stageNode(e.target), onSel = e.target.closest('#sel .hdl,#fxArrow,#sel .rhdl,#frBar,#txBar');
    if (n && selIds.indexOf(n.dataset.id) < 0) select(n.dataset.id);
    if (n || (onSel && selIds.length)) { openX(ctxElItems, { x: e.clientX + 2, y: e.clientY + 2, ctx: 1 }); return; }
    var p = toLogical(e); p = { x: Math.max(0, Math.min(W - 20, p.x)), y: Math.max(0, Math.min(H - 20, p.y)) };
    select(null); openX(function () { return ctxCanvasItems(p); }, { x: e.clientX + 2, y: e.clientY + 2, ctx: 1 });
  });

  /* ---------------- modais: confirmação e atalhos ---------------- */
  var modalCb = null, modalPrev = null;
  function showModal(html, cls, cb) {
    var ae = document.activeElement; modalPrev = ae && ae !== document.body && !$('#modal').contains(ae) ? ae : null;
    var md = $('#modal'); md.innerHTML = '<div class="mdl ' + (cls || '') + '" role="dialog" aria-modal="true" aria-labelledby="mdlT">' + html + '</div>'; md.classList.add('open'); md.setAttribute('aria-hidden', 'false');
    var h = md.querySelector('h3'); if (h) h.id = 'mdlT'; var d = md.querySelector('.mdl-b p,.hk-h p'); if (d) { d.id = 'mdlD'; md.firstChild.setAttribute('aria-describedby', 'mdlD'); }
    modalCb = cb || null; closeMenus();
    var f = md.querySelector('.mb.pri') || md.querySelector('button'); if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal(ok) {
    var md = $('#modal'); if (!md.classList.contains('open')) return;
    md.classList.remove('open'); md.setAttribute('aria-hidden', 'true'); md.innerHTML = '';
    var pv = modalPrev; modalPrev = null; if (pv && document.contains(pv) && pv.offsetParent !== null) pv.focus({ preventScroll: true });
    var cb = modalCb; modalCb = null; if (cb) cb(!!ok);
  }
  $('#modal').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mc]'); if (b) { closeModal(b.dataset.mc === '1'); return; }
    if (e.target === e.currentTarget) closeModal(false);
  });
  /* o modal fica com o teclado inteiro: nada chega ao editor nem à capa por trás (stopImmediatePropagation) */
  addEventListener('keydown', function (e) {
    if (!modalOpen()) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeModal(false); }
    else if (e.key === 'Enter') { e.preventDefault(); var fb = document.activeElement; closeModal(fb && fb.closest && fb.closest('#modal [data-mc]') ? fb.dataset.mc === '1' : true); }
    else if (e.key === 'Tab') { var bs = $$('#modal button'), i = bs.indexOf(document.activeElement); e.preventDefault(); if (bs.length) bs[(i + (e.shiftKey ? bs.length - 1 : 1) + bs.length) % bs.length].focus(); }
    else if (e.key === ' ') { if (!(document.activeElement && $('#modal').contains(document.activeElement))) e.preventDefault(); }
    else if (e.key === 'F1' || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^[sodpa]$/i.test(e.key))) e.preventDefault();
  }, true);
  function confirmBox(o, ok) {
    showModal('<div class="mdl-b"><div class="mdl-ic">' + svgI(o.icon || 'help') + '</div><div><div class="mdl-ey">' + esc(o.eyebrow || 'Confirmar') + '</div><h3>' + esc(o.title) + '</h3><p>' + o.msg + '</p></div></div>' +
      '<div class="mdl-a"><button class="mb" data-mc="0" type="button">Cancelar <kbd>Esc</kbd></button><button class="mb pri" data-mc="1" type="button">' + esc(o.ok || 'Confirmar') + ' <kbd>Enter</kbd></button></div>', 'cf', function (r) { if (r && ok) ok(); });
  }
  /* fonte única dos atalhos: o modal F1 e o Manual da obra (capa) usam esta mesma lista.
     linha: [rótulo, combinações, nota, '/'] — '/' = respectivamente; sem ele, as combinações são alternativas ("ou") */
  var HK = [
    ['Editar', [['Copiar / recortar / colar', [['Ctrl', 'C'], ['Ctrl', 'X'], ['Ctrl', 'V']], 'Elementos ou, com a miniatura em foco, slides', '/'], ['Duplicar', [['Ctrl', 'D']]], ['Selecionar tudo no slide', [['Ctrl', 'A']]], ['Apagar seleção', [['Delete'], ['Backspace']], 'Ou o slide, com a miniatura em foco']]],
    ['Histórico e arquivo', [['Desfazer', [['Ctrl', 'Z']]], ['Refazer', [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']]], ['Abrir apresentação', [['Ctrl', 'O']]], ['Salvar apresentação', [['Ctrl', 'S']], 'Gera um novo arquivo HTML']]],
    ['Mover e selecionar', [['Mover 1 px / 10 px', [['Setas'], ['Shift', 'Setas']], 'Alt+← / Alt+→ giram 15° · com Shift, 1°', '/'], ['Somar à seleção', [['Shift', '~clique']]], ['Seleção por área', [['~arrastar no vazio']]], ['Editar texto', [['~duplo clique'], ['Enter']], 'No vazio, cria uma caixa de texto'], ['Menu de opções', [['~clique direito'], ['Shift', 'F10']]], ['Sair da edição / limpar seleção', [['Esc']]]]],
    ['Apresentar e ajuda', [['Apresentar do início', [['F5']], 'F tela cheia · Z amplia o gráfico · G índice de slides · I sobre este slide'], ['Apresentar do slide atual', [['Shift', 'F5']]], ['Atalhos de teclado', [['F1'], ['?']]]]]
  ];
  /* "Ctrl+C / Ctrl+X / Ctrl+V" vira "Ctrl + C / X / V" quando todas as combinações têm o mesmo modificador */
  function sharedMod(combos) { return combos.length > 1 && combos.every(function (c) { return c.length === 2 && c[0] === combos[0][0] && c[1].charAt(0) !== '~'; }); }
  function kbdHTML(combos, sep) {
    if (sep === '/' && sharedMod(combos)) return '<span class="hk-c"><kbd class="k">' + esc(combos[0][0]) + '</kbd><i>+</i>' + combos.map(function (c) { return '<kbd class="k">' + esc(c[1]) + '</kbd>'; }).join('<i>/</i>') + '</span>';
    return combos.map(function (c, i) { return '<span class="hk-c">' + (i ? '<i>' + (sep === '/' ? '/' : 'ou') + '</i>' : '') + c.map(function (k) { return k.charAt(0) === '~' ? '<kbd class="k m">' + esc(k.slice(1)) + '</kbd>' : '<kbd class="k">' + esc(k) + '</kbd>'; }).join('<i>+</i>') + '</span>'; }).join('');
  }
  function showHelp() {
    var b = HK.map(function (g) {
      return '<section class="hk-g"><h4>' + esc(g[0]) + '</h4>' + g[1].map(function (r) { return '<div class="hk-r"><span>' + esc(r[0]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</span><span class="hk-k">' + kbdHTML(r[1], r[3]) + '</span></div>'; }).join('') + (g[2] ? '<div class="hk-r"><small>' + esc(g[2]) + '</small></div>' : '') + '</section>';
    }).join('') + '<div class="hk-tip"><b>Dica do canteiro</b>Com um texto selecionado, basta começar a digitar. Arraste modelos e efeitos da biblioteca direto para o slide, encaixe as peças com as guias laranja e use <b style="display:inline;font:inherit;letter-spacing:0;text-transform:none;color:var(--navy)">clique direito</b> para ver tudo o que dá para fazer com cada peça.</div>';
    showModal('<header class="hk-h"><div><div class="hk-ey">CANTEIRO · ACERVO DE APRESENTAÇÕES</div><h3>Atalhos de teclado</h3><p>Monte, encaixe e apresente — peça por peça.</p></div><button class="hk-x" data-mc="0" type="button" title="Fechar (Esc)">' + svgI('x') + '</button></header><div class="hk-b">' + b + '</div><footer class="hk-f"><span>No Mac, use <kbd class="k">⌘</kbd> no lugar de <kbd class="k">Ctrl</kbd>.</span><button class="mb pri" data-mc="1" type="button">Entendi <kbd>Enter</kbd></button></footer>', 'hk');
  }
  /* clique do mouse em "Início" não deixa foco no botão: ao voltar da capa, o teclado age no slide */
  function goHome(e) { if (e && e.detail && document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (editingId) endEdit(); flush(); closeMenus(); openDrawer(false); stopPreview(); if (window.AMCover && typeof window.AMCover.open === 'function') window.AMCover.open(); else toast('Capa indisponível'); }
  /* Arquivo › Minhas obras…: a capa abre direto no acervo; Esc ou "Voltar à obra" devolve ao editor */
  function goObras(e) { if (e && e.detail && document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (editingId) endEdit(); flush(); closeMenus(); openDrawer(false); stopPreview(); var C = window.AMCover; if (C && typeof C.openHist === 'function') C.openHist(); else toast('Minhas obras indisponível'); }
  function howTo() { var C = window.AMCover; if (C && typeof C.openManual === 'function') C.openManual(); else if (C && typeof C.open === 'function') C.open('manual'); else showHelp(); }
  /* apresentação "intocada": um slide branco, sem elementos, título padrão e sem histórico */
  function isBlank() { var s = deck.slides; return s.length === 1 && !s[0].els.length && !s[0].bgImg && String(s[0].bg || '#FFFFFF').toUpperCase() === '#FFFFFF' && (deck.title || '') === 'Nova apresentação' && !hist.length; }
  var LOSE = 'O que não foi salvo com <b>Salvar apresentação</b> será perdido, e o histórico de desfazer será zerado.';
  /* ---------------- S27b: Localizar e substituir (painel flutuante, não modal) ----------------
     procura em textos e formas (nós de texto, a marcação fica) e nas palavras dos componentes (campos de texto de el.data); nunca em cores,
     ids ou nomes fechados. Substituir = a ocorrência atual; Substituir tudo = todas, num só passo de Ctrl+Z */
  var xf = null, xfM = { list: [], at: -1, q: '' };
  function xfSlots(el) { /* caixas de texto de um elemento: [{get(), set(v)}] */
    var out = [];
    if (el.type === 'text' || el.type === 'shape') { out.push({ html: true }); return out; }
    if (el.type === 'fx' && el.data) (function walk(o, pk) { if (!o || typeof o !== 'object') return; Object.keys(o).forEach(function (k) { var v = o[k]; if (typeof v === 'string') { if (NOTEXT.indexOf(k) < 0 && !/^(id|kind|src|href|url)$/.test(k) && /[A-Za-zÀ-ɏ]/.test(v) && !COLOR_RE.test(v)) out.push({ obj: o, key: k }); } else if (v && typeof v === 'object') walk(v, k); }); })(el.data, '');
    return out;
  }
  function xfRe(q, cs, all) { return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), (cs ? '' : 'i') + (all ? 'g' : '')); }
  function xfCountIn(el, re) {
    var n = 0, slots = xfSlots(el);
    slots.forEach(function (sl) {
      if (sl.html) { var tp = document.createElement('template'); tp.innerHTML = String(el.html || ''); var tw = document.createTreeWalker(tp.content, NodeFilter.SHOW_TEXT), nd; while ((nd = tw.nextNode())) n += (nd.nodeValue.match(re) || []).length; }
      else n += (String(sl.obj[sl.key]).match(re) || []).length;
    });
    return n;
  }
  function xfReplaceIn(el, re, rep, only) { /* only = índice da ocorrência a trocar dentro do elemento (null = todas); devolve quantas trocou */
    var k = 0, done = 0;
    xfSlots(el).forEach(function (sl) {
      if (sl.html) {
        var tp = document.createElement('template'); tp.innerHTML = String(el.html || ''); var tw = document.createTreeWalker(tp.content, NodeFilter.SHOW_TEXT), nd, ch = false;
        while ((nd = tw.nextNode())) { nd.nodeValue = nd.nodeValue.replace(re, function (m) { var hit = only == null || k === only; k++; if (hit) { done++; ch = true; return rep; } return m; }); }
        if (ch) el.html = cleanHTML(tp.innerHTML);
      } else { var v = String(sl.obj[sl.key]), nv = v.replace(re, function (m) { var hit = only == null || k === only; k++; if (hit) { done++; return rep; } return m; }); if (nv !== v) sl.obj[sl.key] = nv; }
    });
    return done;
  }
  function xfScan() {
    var q = $('#xfQ').value, cs = $('#xfCase').checked, list = [];
    xfM.q = q; xfM.cs = cs;
    if (q) { var re = xfRe(q, cs, true); deck.slides.forEach(function (s, si) { s.els.forEach(function (e) { var n = xfCountIn(e, re); for (var i = 0; i < n; i++) list.push({ si: si, id: e.id, i: i }); }); }); }
    xfM.list = list; if (xfM.at >= list.length) xfM.at = -1;
    xfLabel();
  }
  function xfLabel() {
    var n = xfM.list.length, sl = {}; xfM.list.forEach(function (m) { sl[m.si] = 1; }); var ns = Object.keys(sl).length;
    $('#xfCount').textContent = !xfM.q ? 'Digite o que procurar' : !n ? 'Nenhuma ocorrência' : (xfM.at >= 0 ? (xfM.at + 1) + ' de ' + n + ' · ' : '') + n + (n === 1 ? ' ocorrência em ' : ' ocorrências em ') + ns + (ns === 1 ? ' slide' : ' slides');
    $('#xfRep').disabled = $('#xfAll').disabled = !n; $('#xfPrev').disabled = $('#xfNext').disabled = !n;
    var ae = document.activeElement; if (ae && ae.disabled && xf.contains(ae)) $('#xfQ').focus(); /* botão que ficou desabilitado não segura o foco (Esc continuaria funcionando) */
  }
  function xfGo(dir) {
    if (!xfM.list.length) return; xfM.at = ((xfM.at < 0 ? (dir > 0 ? -1 : 0) : xfM.at) + dir + xfM.list.length) % xfM.list.length;
    var m = xfM.list[xfM.at]; if (editingId) endEdit(); if (m.si !== cur) goSlide(m.si); setSel([m.id], m.id); xfLabel();
    var th = $('#thumbs .th.on'); if (th && th.scrollIntoView) th.scrollIntoView({ block: 'nearest' });
  }
  function xfReplace(all) {
    if (!xfM.list.length) return; var re = xfRe(xfM.q, xfM.cs, true), rep = $('#xfR').value, n = 0, touched = {};
    if (all) { deck.slides.forEach(function (s, si) { s.els.forEach(function (e) { var d = xfReplaceIn(e, re, rep, null); if (d) { n += d; touched[si] = 1; } }); }); }
    else { if (xfM.at < 0) xfGo(1); var m = xfM.list[xfM.at], e = deck.slides[m.si].els.filter(function (x) { return x.id === m.id; })[0]; if (e) { n = xfReplaceIn(e, re, rep, m.i); touched[m.si] = 1; } }
    if (!n) return;
    if (touched[cur]) renderStage(); Object.keys(touched).forEach(function (si) { renderThumb(+si); }); renderProps(); commit();
    var at = xfM.at; xfScan(); if (!all && xfM.list.length) { xfM.at = Math.min(at, xfM.list.length - 1) - 1; xfGo(1); }
    toast(all ? n + (n === 1 ? ' ocorrência substituída' : ' ocorrências substituídas') + ' · Ctrl+Z desfaz' : 'Substituído · Ctrl+Z desfaz');
  }
  function buildFind() {
    xf = document.createElement('div'); xf.id = 'xfDlg'; xf.className = 'xf'; xf.hidden = true; xf.setAttribute('role', 'dialog'); xf.setAttribute('aria-label', 'Localizar e substituir');
    xf.innerHTML = '<div class="xf-h"><span>Localizar e substituir</span><button type="button" class="xf-x" data-x="close" title="Fechar (Esc)" aria-label="Fechar">×</button></div>' +
      '<label class="xf-f"><span>Localizar</span><input type="text" id="xfQ" autocomplete="off" spellcheck="false" placeholder="palavra ou trecho"></label>' +
      '<label class="xf-f"><span>Substituir por</span><input type="text" id="xfR" autocomplete="off" spellcheck="false"></label>' +
      '<div class="xf-o"><label><input type="checkbox" id="xfCase"> Diferenciar maiúsculas</label><span id="xfCount" aria-live="polite">Digite o que procurar</span></div>' +
      '<div class="xf-b"><button type="button" id="xfPrev" title="Anterior (Shift+Enter)">Anterior</button><button type="button" id="xfNext" title="Próximo (Enter)">Próximo</button><span class="sp"></span><button type="button" id="xfRep">Substituir</button><button type="button" id="xfAll" class="pri">Substituir tudo</button></div>';
    document.body.appendChild(xf);
    xf.addEventListener('input', function (e) { if (e.target.id === 'xfQ') { xfM.at = -1; xfScan(); } });
    xf.addEventListener('change', function (e) { if (e.target.id === 'xfCase') { xfM.at = -1; xfScan(); } });
    xf.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x === 'close') closeFind(); else if (b.id === 'xfPrev') xfGo(-1); else if (b.id === 'xfNext') xfGo(1); else if (b.id === 'xfRep') xfReplace(false); else if (b.id === 'xfAll') xfReplace(true);
    });
    xf.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); return; }
      if (e.key === 'Enter' && (e.target.id === 'xfQ' || e.target.id === 'xfR')) { e.preventDefault(); e.stopPropagation(); xfGo(e.shiftKey ? -1 : 1); return; }
      if ((e.ctrlKey || e.metaKey) && /^[fh]$/i.test(e.key)) { e.preventDefault(); e.stopPropagation(); $('#xfQ').focus(); $('#xfQ').select(); return; }
      e.stopPropagation(); /* teclas do painel não chegam ao slide (Delete não apaga, setas não movem) */
    });
  }
  function openFind() { if (!xf) buildFind(); closeMenus(); xf.hidden = false; var q = $('#xfQ'); var sel0 = sel(); if (!q.value && sel0 && (sel0.type === 'text' || sel0.type === 'shape')) { var w = RT.plain(sel0.html).split(/\s+/)[0] || ''; if (w.length > 2 && w.length < 24) q.value = w; } xfM.at = -1; xfScan(); q.focus(); q.select(); }
  function closeFind() { if (!xf || xf.hidden) return; xf.hidden = true; var f = $('#cv'); if (f) f.focus({ preventScroll: true }); }
  function openPicker() {
    if (editingId) endEdit(); flush();
    function pick() { var f = $('#fOpen'); f.value = ''; f.click(); }
    if (isBlank()) { pick(); return; }
    confirmBox({ eyebrow: 'Abrir', icon: 'open', title: 'Abrir outra apresentação?', msg: 'A apresentação atual será substituída. ' + LOSE, ok: 'Escolher arquivo' }, pick);
  }
  /* S24: importar PowerPoint/PDF (ed-42-import.js): a caixa de importação decide entre substituir e acrescentar */
  function importPicker() { if (editingId) endEdit(); flush(); closeMenus(); if (window.AMImport) window.AMImport.pick($('#mbar button[data-m=file]')); else toast('Importação indisponível'); }
  /* slides importados entram no fim, validados como um arquivo aberto (safeSlide), com base para “Redefinir”; um passo de Ctrl+Z */
  function appendSlides(list, at, before) { /* at (S33): posição de inserção (padrão: fim); o primeiro slide inserido vira o atual; before(): mudança que entra no mesmo passo de desfazer (ex.: ocultar o modelo) */
    if (editingId) endEdit(); flush();
    var ins = (Array.isArray(list) ? list : []).map(safeSlide).filter(Boolean).map(freshSlide).map(function (s) { return s.base ? s : stampSlide(s); });
    if (!ins.length) return 0;
    if (typeof before === 'function') { try { before(); } catch (er) { } }
    at = at == null || !isFinite(+at) ? deck.slides.length : Math.max(0, Math.min(deck.slides.length, +at | 0));
    Array.prototype.splice.apply(deck.slides, [at, 0].concat(ins)); cur = at; pick([]); ensureFonts(fontsIn(JSON.stringify(ins))); renderAll(); commit();
    var th = $('#thumbs .th.on'); if (th && th.scrollIntoView) th.scrollIntoView({ block: 'nearest' });
    return ins.length;
  }
  function newPresentation() {
    function go() { loadDeck(newDeck(), 'Nova apresentação em branco'); try { localStorage.removeItem('amStudio.draft'); } catch (e) { } }
    if (editingId) endEdit(); flush();
    if (isBlank()) { go(); return; }
    confirmBox({ eyebrow: 'Nova apresentação', icon: 'file', title: 'Começar uma apresentação em branco?', msg: LOSE, ok: 'Começar em branco' }, go);
  }
  function clearSlide() { if (editingId) endEdit(); if (!slide().els.length) return; slide().els = []; pick([]); renderStage(); renderProps(); commit(); toast('Slide limpo · Ctrl+Z desfaz'); }
  function resetDeck() { if (editingId) endEdit(); deck.slides = [mkSlide('blank-light')]; cur = 0; pick([]); setZone('canvas'); renderAll(); commit(); toast('Apresentação recomeçada · Ctrl+Z desfaz'); }
  function askReset() {
    confirmBox({ eyebrow: 'Recomeçar', icon: 'reset', title: 'Recomeçar a apresentação?', msg: 'Todos os slides serão substituídos por <b>um slide em branco</b>. O título é mantido e você pode desfazer com <b>Ctrl+Z</b>.', ok: 'Recomeçar' }, resetDeck);
  }

  /* ---------------- Salvar como… (S22): ▾ ao lado de Salvar e Arquivo › Salvar como PDF / PowerPoint ----------------
     o clique simples em #bSave continua baixando o .html; PDF e PowerPoint moram em ed-40-export.js (window.AMExport) */
  var PPTX_SOON = 'Disponível na próxima etapa';
  function pptxOk() { return !!(window.AMExport && typeof window.AMExport.pptx === 'function'); }
  function exportAs(k, opener) {
    if (editingId) endEdit(); flush(); closeMenus();
    var X = window.AMExport;
    if (k === 'html') { save(); return; }
    if (k === 'pptx') { if (pptxOk()) X.pptx(deck, { opener: opener }); else toast('PowerPoint: ' + PPTX_SOON.toLowerCase()); return; }
    if (!X || typeof X.openDialog !== 'function') { toast('Exportação indisponível'); return; }
    X.openDialog(k === 'print' ? 'print' : 'pdf', opener || null); /* sem opener: o foco volta para onde estava (Arquivo › Salvar como PDF…) */
  }
  function saveAsItems() {
    return [{ hd: 'Salvar como' },
      { t: 'HTML interativo (.html) — com efeitos', ic: 'html', k: KEY.save, id: 'save-html', fn: function () { exportAs('html'); } },
      { t: 'PDF (.pdf) — imagem em alta resolução, idêntico', ic: 'pdf', id: 'save-pdf', fn: function () { exportAs('pdf', $('#bSaveMore')); } },
      { t: 'PDF pelo navegador — texto selecionável', ic: 'print', id: 'save-print', fn: function () { exportAs('print', $('#bSaveMore')); } },
      { t: 'PowerPoint (.pptx)…', ic: 'ppt', id: 'save-pptx', dis: !pptxOk(), tip: pptxOk() ? 'Gera um arquivo do PowerPoint com todos os slides' : PPTX_SOON, fn: function () { exportAs('pptx', $('#bSaveMore')); } }];
  }
  function openSaveAs(kb) {
    var b = $('#bSaveMore'); if (!b) return;
    if (b.getAttribute('aria-expanded') === 'true') { closeAllX(); return; }
    if (editingId) endEdit(); closeAllX();
    var r = b.getBoundingClientRect(), it = saveAsItems(); it.cls = 'xsave';
    var m = openX(it, { x: r.right - 404, y: r.bottom + 6, owner: b }); placeX(m, { x: r.right - m.offsetWidth, y: r.bottom + 6 });
    b.classList.add('open'); b.setAttribute('aria-expanded', 'true');
    if (kb) { var f = m.querySelector('.xi:not(.dis)'); if (f) hotX(m, f, true); }
  }
  if ($('#bSaveMore')) {
    $('#bSaveMore').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('#bSaveMore').addEventListener('click', function (e) { openSaveAs(!e.detail); });
    $('#bSaveMore').addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' && !XM.stack.length) { e.preventDefault(); e.stopPropagation(); openSaveAs(true); } });
  }

  /* ---------------- apresentar, salvar, abrir ---------------- */
  var player = null;
  /* all (S21): mostra também os slides ocultos (ex.: “Ver na apresentação” / ampliar a partir de um slide oculto) */
  function present(start, all) {
    if (editingId) endEdit(); openDrawer(false);
    start = Math.max(0, Math.min(deck.slides.length - 1, +start || 0));
    var vis = deck.slides.filter(function (x) { return x.hidden !== true; }).length;
    if (!all && !vis) toast('Todos os slides estão ocultos — mostrando todos');
    else if (!all && deck.slides[start].hidden === true) toast('Slide ' + (start + 1) + ' está oculto — a apresentação começa no ' + (deck.slides.slice(start + 1).some(function (x) { return x.hidden !== true; }) ? 'próximo' : 'último') + ' slide visível');
    /* campo do painel com o cursor (ex.: Resumo do slide + F5): sem o blur, o player ignoraria todas as teclas, inclusive o Esc */
    var ae = document.activeElement; if (ae && ae !== document.body && ae.blur) ae.blur();
    if (player) { player.destroy(); player = null; } /* um player por vez: o anterior sairia com teclado e hooks ativos */
    var pr = $('#presenter'); pr.classList.add('open');
    var me = player = RT.player(clone(deck), pr, { start: start, showHidden: !!all, noHash: true, brand: BRAND.wmW, onExit: function () { if (player !== me) return; player.destroy(); player = null; pr.classList.remove('open'); if (document.fullscreenElement) document.exitFullscreen().catch(function () { }); } });
  }
  /* Imprimir pelo menu do navegador (sem Ctrl+P): sai a apresentação, uma página por slide, e não a tela do editor */
  addEventListener('beforeprint', function () {
    var X = window.AMExport; if (!X || !X.preparePrint || presenting() || coverOpen() || document.getElementById('amPrint')) return;
    if (editingId) endEdit(); flush(); X.preparePrint(deck, { range: 'all' });
  });
  function slug(s) { return (String(s || 'apresentacao').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]+/g, ' ').trim().replace(/[\s_-]+/g, '-').toLowerCase().slice(0, 80).replace(/-+$/, '') || 'apresentacao'); } /* “Q3/2026” → q3-2026 (não q32026) */
  /* d (opcional): outra apresentação (ex.: "Baixar .html" em Minhas obras); sem d, a obra aberta */
  function exportHTML(d) {
    d = d && typeof d === 'object' && Array.isArray(d.slides) ? d : deck;
    var data = JSON.stringify(d).replace(/</g, '\\u003c');
    var css = $('#am-runtime-css').textContent, js = $('#am-runtime').textContent;
    var S = 'script';
    return '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="Canteiro · Acervo de Apresentações A&amp;M">\n<title>' + esc(d.title || 'Apresentação') + '</title>\n<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="' + fontLink(d, data) + '" rel="stylesheet">\n<style id="am-runtime-css">' + css + '</style>\n<style>html,body{margin:0;height:100%;background:#00192b}</style>\n</head>\n<body>\n<div id="am-player"></div>\n<' + S + ' type="application/json" id="am-deck-data">' + data + '</' + S + '>\n<' + S + '>' + js + '</' + S + '>\n<' + S + '>AMRT.player(JSON.parse(document.getElementById("am-deck-data").textContent),document.getElementById("am-player"),{brand:' + JSON.stringify(BRAND.wmW) + '});</' + S + '>\n</body>\n</html>\n';
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/html;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function save(quiet) {
    if (editingId) endEdit(); flush();
    var name = slug(deck.title) + '.html';
    download(name, exportHTML());
    histCall('saveNow'); /* o arquivo salvo também fica em Minhas obras */
    if (quiet !== true) toast('Apresentação salva: ' + name); return name;
  }
  function openFile(file, quiet) {
    var r = new FileReader();
    r.onload = function () {
      var txt = String(r.result), d = null;
      try {
        if (/am-deck-data/.test(txt)) { var doc = new DOMParser().parseFromString(txt, 'text/html'), sc = doc.getElementById('am-deck-data'); d = JSON.parse(sc.textContent); }
        else d = JSON.parse(txt);
      } catch (err) { d = null; }
      loadDeck(d, 'Apresentação aberta: ' + file.name, quiet);
    };
    r.readAsText(file);
  }
  function isDeckFile(f) { return !!f && (/\.(html?|json)$/i.test(f.name || '') || /^(text\/html|application\/json)$/.test(f.type || '')); }
  $('#bSave').addEventListener('click', function () { save(); });
  $('#bPlay').addEventListener('click', function () { present(0); });
  $('#bPreview').addEventListener('click', function () { present(cur); });
  $('#bOpen').addEventListener('click', openPicker);
  $('#bHome').addEventListener('click', goHome);
  /* com a capa aberta, quem avisa sobre arquivo inválido é a própria capa */
  $('#fOpen').addEventListener('change', function () { if (this.files[0]) openFile(this.files[0], coverOpen()); });
  $('#bNew').addEventListener('click', newPresentation);
  $('#bUndo').addEventListener('click', undo); $('#bRedo').addEventListener('click', redo);
  $('#bFront').addEventListener('click', function () { act('front'); }); $('#bBack').addEventListener('click', function () { act('back'); });
  /* Duplicar / Apagar da faixa seguem o foco: miniatura em foco = slide */
  $('#bDup').addEventListener('click', function () { if (zone === 'thumbs') dupSlide(cur); else dupSel(); });
  $('#bDel').addEventListener('click', function () { if (zone === 'thumbs') delSlide(cur); else delSel(); });
  $('#title').addEventListener('input', function () { deck.title = this.value; });
  $('#title').addEventListener('change', commit);
  $('#fBg').addEventListener('change', function () { });
  addEventListener('resize', function () { applySide(); }); /* re-limita a largura do painel de slides e reencaixa o palco */
  addEventListener('beforeunload', function (e) { if (hist.length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- início ---------------- */
  buildModels(); buildDrawer(); applySide(); renderAll(); updUndo();
  try {
    var dr = localStorage.getItem('amStudio.draft'), dd = dr && JSON.parse(dr);
    if (dd && dd.slides && dd.slides.some(function (s) { return s.els && s.els.length; })) {
      $('#banner').classList.add('open');
      $('#bDraftYes').onclick = function () { $('#banner').classList.remove('open'); loadDeck(dd, 'Rascunho recuperado'); };
      $('#bDraftNo').onclick = function () { $('#banner').classList.remove('open'); try { localStorage.removeItem('amStudio.draft'); } catch (e) { } };
    }
  } catch (e) { }
  window.AMStudio = {
    get deck() { return deck; }, exportHTML: exportHTML, present: present, goSlide: goSlide, insertFx: insertFx, addSlide: addSlide, select: select,
    setVariant: function (v) { setVariant(sel(), v); }, previewEl: function () { previewEl(sel()); },
    /* API estável para a capa (cover.js) e extensões */
    W: W, H: H, BRAND: BRAND, LAYOUTS: LAYOUTS, uid: uid, clone: clone, toast: toast,
    mk: { slide: mkSlide, text: mkText, shape: mkShape, line: mkLine, image: mkImage, brand: mkBrand, fx: mkFx },
    newDeck: newDeck, newId: deckId, loadDeck: loadDeck, openFile: openFile, pickFile: function () { $('#fOpen').click(); }, appendSlides: appendSlides, isBlank: isBlank, openFind: openFind, insertSeq: insertSeq, SEQS: SEQS,
    /* S29: kit de marca (ed-43-brand.js usa) */
    brand: { get: brand, set: setBrand, safe: safeBrand, kitify: kitify, applyFont: brandApplyFont, applyPal: brandApplyPal, fonts: fontOpts, GFONTS: GFONTS, SYS_FONTS: SYS_FONTS, ensureFonts: ensureFonts, fontLink: fontLink, open: openBrandKit, palOk: palOk, SW: SW },
    pickImage: pickImage, confirmBox: confirmBox, insertText: insertText, dupSlide: dupSlide, rebuildSlidePicker: buildSlidePicker,
    /* Minhas obras (capa + history.js): validar um deck vindo do banco, gerar o .html de qualquer deck, baixar, renomear a obra aberta */
    safeDeck: safeDeck, exportDeck: function (d) { return exportHTML(d); }, slug: slug, download: download, openObras: goObras,
    setTitle: function (t) { t = String(t == null ? '' : t).slice(0, 300); if (editingId) endEdit(); deck.title = t; $('#title').value = t; commit(); },
    openDrawer: openDrawer, renderAll: renderAll, commit: commit,
    /* vazia = intocada: um slide branco, sem elementos, título padrão e sem histórico (título, fundo e desfazer contam como obra) */
    isEmpty: isBlank, get cur() { return cur; }, HK: HK, save: save,
    getDraft: function () { try { var r = localStorage.getItem('amStudio.draft'), d = r && JSON.parse(r); return d && Array.isArray(d.slides) && d.slides.length ? d : null; } catch (e) { return null; } },
    clearDraft: function () { try { localStorage.removeItem('amStudio.draft'); } catch (e) { } },
    hideDraftBanner: function () { $('#banner').classList.remove('open'); },
    /* camada de edição (seleção múltipla, área de transferência, menus) */
    selected: function () { return selIds.slice(); },
    selectMany: function (ids) { if (editingId) endEdit(); setSel(Array.isArray(ids) ? ids : []); },
    copy: function () { return doCopy(false); }, cut: function () { return doCopy(true); }, paste: function (at) { return pasteFromSystem(at || null); },
    clearSlide: clearSlide,
    /* S21: ocultar/reexibir (alterna) e redefinir o slide i (padrão: o atual) */
    toggleHidden: function (i) { toggleHidden(i == null ? cur : i); }, resetSlide: function (i) { resetSlide(i == null ? cur : i); },
    resetDeck: function (opts) { if (opts && opts.confirm) askReset(); else resetDeck(); },
    showHelp: showHelp, closeMenus: closeMenus, flush: flush, exportAs: exportAs, saveAsItems: saveAsItems,
    /* vitrine de efeitos: abrir (filtro: all|in|loop|hover|tr|cmp|model, busca), provar um efeito pelo id, usar, descartar, listar */
    gallery: { open: openGallery, tryFx: function (id) { if (drawerTab !== 'fx' || !$('#drawer').classList.contains('open')) openDrawer(true, 'fx'); gxOpen(id); }, use: function () { gxUse(); }, discard: function () { gxClose(); }, current: function () { return gx.prov ? gx.prov.id : null; },
      items: function () { return gx.items.map(function (it) { return { id: it.id, fam: it.fam, name: it.name, cat: it.cat }; }); } },
    /* ícones animados: o seletor (Ícones ▾) e os favoritos do menu Inserir */
    icons: { open: function (opts) { openIcons($('#bIcons'), opts); }, close: function () { closeIcons(true); }, isOpen: icOpen, favorites: IC_FAV.slice() },
    smart: { insert: insertSmart, layouts: smartLayouts, open: function () { if ($('#mSmart')) toggleMenu('mSmart', $('#bCharts')); } },
    confirm: function (o) { return new Promise(function (res) { confirmBox(o || {}, function () { res(true); }); var cb = modalCb; modalCb = function (r) { if (cb) cb(r); if (!r) res(false); }; }); }
  };
})();
