/* ===== rt-70-personas.js — Personagens A&M (S35): bonecos com vida própria na apresentação =====
   Vai junto em todo arquivo exportado (assemble.py concatena rt-*.js ao runtime). Nada global além de AMRT.
   · FX.persona — um personagem desenhado em SVG (corpo “ovo”, rosto branco, capacete/boné/headset/antena, cabelo, roupa,
     ferramenta na mão, óculos, expressão), sempre nas cores da marca A&M (navy, azuis-aço, gelo, laranja, grafite; as cores do
     corpo e da roupa são escolhidas entre elas). Dez presets (“elenco”: engenheira de obra, mestre de obras, desenvolvedor(a),
     agente de IA, consultor(a), analista e cientista de dados, apresentador) são as variantes do componente; cada parte pode ser
     trocada no painel (“Do personagem” = a do preset).
     Movimentos (data.act): acenar, apontar, andar, pular, pensar, comemorar, falar, concordar, negar (ou parado); gatilho
     (data.trig): ao entrar no slide, sem parar, ao passar o mouse, só ao clicar. Tudo em CSS (rt-70-personas.css): o movimento
     define as animações de cada parte (--kR braço direito, --kL esquerdo, --kG/--kG2 pernas, --kB tronco, --kC personagem,
     --kM boca, --kF confete) e o gatilho as arma (--aR = var(--kR) …) com a contagem (--n) e o atraso (--d0). No palco do
     editor, nas miniaturas e nos rasters (PDF/PowerPoint) o personagem fica na pose de repouso do movimento (sem animação).
     · Balão (data.bubble: fala, pensamento, grito, nota; data.side: em cima, à direita, à esquerda; data.bcol: cor) com a fala
       (data.say, editável no lugar por duplo clique), a fala ao clicar (data.say2) e “decisões” (data.choices: botões que levam
       a um slide e/ou mudam a expressão).
     · Apontar para um elemento do slide (data.aim = id): a mira (--aim) e o lado para onde o personagem olha (data-face) são
       calculados a partir das caixas dos dois elementos (aimStage, chamada depois de cada renderSlide e, no player, ao abrir);
       andar até um X do slide (data.walk): ao entrar, balão e boneco (.pz-mv) caminham do lugar onde estão até lá (--wq em cqw).
     · Na apresentação (R.hooks.player): os olhos seguem o cursor (data.look = 1); um clique no personagem alterna a reação
       (expressão data.mood2, fala data.say2, movimento data.act2 e um brilho no elemento apontado — .pz-hl + .am-hov, que
       também dispara o efeito de mouse que aquele elemento tiver); os botões de decisão mudam a expressão e vão ao slide.
       O componente leva .am-ia: cliques nele nunca caem nas zonas de avançar/voltar.
   · FX.bubble — Balão de fala solto (fala, pensamento, grito, nota; rabicho em 7 posições; texto editável no lugar), para
     ligar com conectores presos (S32) a qualquer elemento.
   API: AMRT.personas = { PRESETS, HATS, HAIRS, OUTFITS, TOOLS, GLASSES, MOODS, ACTS, TRIGS, BUBS, BCOLS, resolve(d, el),
     aimNode(root), aimStage(stage), presetOf(el) } */
(function (R) {
  'use strict';
  if (!R || !R.FX || !R.util) return;
  var U = R.util, esc = R.esc, CQ = U.CQ, E = U.E, W = R.W, H = R.H;

  /* ---------- paleta A&M ---------- */
  var COLS = [['#002A46', 'Navy'], ['#13315C', 'Azul profundo'], ['#4A6FA5', 'Azul-aço'], ['#7EA1C3', 'Aço claro'], ['#A3B8D6', 'Gelo azulado'], ['#F78C16', 'Laranja'], ['#3E4C5E', 'Grafite']];
  var COLS2 = COLS.concat([['#FFFFFF', 'Branco'], ['#E3EAF2', 'Gelo claro']]);

  /* ---------- partes (viewBox 0 0 200 240; o personagem ocupa a caixa inteira, pés em y≈226) ---------- */
  var BODY = '<path class="pz-b" d="M100 36C146 36 168 84 168 142C168 196 138 214 100 214C62 214 32 196 32 142C32 84 54 36 100 36Z"/>';
  var FACE = '<path class="pz-w" d="M100 52C134 52 150 82 150 112C150 142 130 158 100 158C70 158 50 142 50 112C50 82 66 52 100 52Z"/>';
  var EYES = '<g class="pz-eyes"><g class="pz-pupils"><g class="pz-eye pz-eL"><circle class="pz-n" cx="84" cy="104" r="9.5"/><circle class="pz-w" cx="80.5" cy="100.5" r="3"/></g><g class="pz-eye pz-eR"><circle class="pz-n" cx="116" cy="104" r="9.5"/><circle class="pz-w" cx="112.5" cy="100.5" r="3"/></g></g>' +
    '<circle class="pz-lid pz-lidL" cx="84" cy="104" r="10.5"/><circle class="pz-lid pz-lidR" cx="116" cy="104" r="10.5"/>' +
    '<path class="pz-arc" data-m="piscada" d="M106 104Q116 95 126 104"/><g data-m="animado"><path class="pz-arc" d="M74 106Q84 95 94 106"/><path class="pz-arc" d="M106 106Q116 95 126 106"/></g></g>';
  var LASH = '<path class="pz-st pz-lash" d="M72 97L66 93M73 91L69 86M128 97L134 93M127 91L131 86"/>';
  var CHEEKS = '<ellipse class="pz-ck" cx="66" cy="124" rx="9" ry="5"/><ellipse class="pz-ck" cx="134" cy="124" rx="9" ry="5"/>';
  var FR = '<path class="pz-h" d="M60 68C70 46 130 46 140 68C124 58 76 58 60 68Z"/>';
  var LOWER = 'M38 150C34 176 42 204 100 214C158 204 166 176 162 150Z';
  var VNECK = 'M38 150C34 176 42 204 100 214C158 204 166 176 162 150L126 150L100 182L74 150Z';
  var HATS = {
    none: ['Sem chapéu', ''],
    capW: ['Capacete branco', '<g class="pz-hat"><path class="pz-w pz-hd" d="M46 70C46 24 154 24 154 70Z"/><rect class="pz-w pz-hd" x="90" y="22" width="20" height="10" rx="5"/><path class="pz-or" d="M50 60C70 55 130 55 150 60V66C130 61 70 61 50 66Z"/><rect class="pz-w pz-hd" x="34" y="66" width="132" height="12" rx="6"/></g>'],
    capO: ['Capacete laranja', '<g class="pz-hat"><path class="pz-or" d="M46 70C46 24 154 24 154 70Z"/><rect class="pz-or" x="90" y="22" width="20" height="10" rx="5"/><ellipse class="pz-i" cx="100" cy="42" rx="11" ry="7"/><ellipse class="pz-w" cx="100" cy="42" rx="6" ry="3.5"/><rect class="pz-or" x="34" y="66" width="132" height="12" rx="6"/></g>'],
    capN: ['Capacete navy', '<g class="pz-hat"><path class="pz-n" d="M46 70C46 24 154 24 154 70Z"/><rect class="pz-n" x="90" y="22" width="20" height="10" rx="5"/><path class="pz-or" d="M50 60C70 55 130 55 150 60V66C130 61 70 61 50 66Z"/><rect class="pz-n" x="34" y="66" width="132" height="12" rx="6"/></g>'],
    bone: ['Boné', '<g class="pz-hat"><path class="pz-o" d="M50 68C50 30 150 30 150 68Z"/><circle class="pz-or" cx="100" cy="31" r="3.5"/><path class="pz-o" d="M96 62H164C172 62 174 72 164 74H96Z"/><path class="pz-or" d="M50 62H150V68H50Z"/></g>'],
    headset: ['Headset', '<g class="pz-hat"><path class="pz-hb" d="M46 110C46 48 154 48 154 110"/><rect class="pz-g" x="36" y="96" width="18" height="32" rx="8"/><rect class="pz-g" x="146" y="96" width="18" height="32" rx="8"/><path class="pz-hm" d="M152 126C152 144 134 150 116 148"/><circle class="pz-or" cx="114" cy="148" r="4.5"/></g>'],
    antena: ['Antena (IA)', '<g class="pz-hat"><rect class="pz-n" x="97" y="14" width="6" height="26" rx="3"/><circle class="pz-or pz-led" cx="100" cy="13" r="7"/></g>']
  };
  var HAIRS = { /* [nome, atrás do rosto, na frente (franja)] */
    none: ['Sem cabelo', '', ''],
    short: ['Curto', '', FR],
    long: ['Longo', '<path class="pz-h" d="M46 112C40 56 160 56 154 112L160 164C156 172 146 172 142 164L144 112C140 76 60 76 56 112L58 164C54 172 44 172 40 164Z"/>', FR],
    bun: ['Coque', '<circle class="pz-h" cx="100" cy="40" r="16"/>', FR],
    tail: ['Rabo de cavalo', '<path class="pz-h" d="M142 92C170 94 182 128 170 170C166 176 158 174 158 166C166 136 160 110 140 106Z"/>', FR]
  };
  var OUTFITS = {
    colete: ['Colete de obra', '<path class="pz-o" d="M38 150C34 176 42 202 68 212L78 212V150Z"/><path class="pz-o" d="M162 150C166 176 158 202 132 212L122 212V150Z"/><rect class="pz-i" x="46" y="180" width="32" height="7" rx="3.5"/><rect class="pz-i" x="122" y="180" width="32" height="7" rx="3.5"/><path class="pz-st pz-zip" d="M100 158V208"/><rect class="pz-or" x="96" y="176" width="8" height="14" rx="3"/>'],
    jaqueta: ['Jaqueta', '<path class="pz-o" d="' + VNECK + '"/><circle class="pz-or" cx="100" cy="194" r="3"/><circle class="pz-or" cx="100" cy="205" r="3"/>'],
    gravata: ['Camisa e gravata', '<path class="pz-w" d="' + LOWER + '"/><path class="pz-o" d="' + VNECK + '"/><path class="pz-or" d="M95 158H105L108 186L100 196L92 186Z"/>'],
    jaleco: ['Jaleco', '<path class="pz-w pz-jl" d="' + VNECK + '"/><rect class="pz-i" x="118" y="180" width="26" height="18" rx="2"/><path class="pz-sl" d="M100 184V210"/>'],
    moletom: ['Moletom', '<path class="pz-o" d="' + LOWER + '"/><path class="pz-o" d="M60 146C70 168 130 168 140 146L132 156C120 172 80 172 68 156Z"/><path class="pz-dk" d="M76 186H124V204C110 211 90 211 76 204Z"/><path class="pz-sl" d="M94 158V178M106 158V178"/>'],
    circuito: ['Circuito (IA)', '<path class="pz-o" d="' + LOWER + '"/><path class="pz-cir" d="M66 172H86V192H114V172H134M100 192V210M84 202H116M74 182H58M126 182H142"/><circle class="pz-or pz-led" cx="100" cy="172" r="3.5"/>'],
    none: ['Só o cinto', '<rect class="pz-o" x="40" y="186" width="120" height="10" rx="5"/><rect class="pz-or" x="92" y="184" width="16" height="14" rx="3"/>']
  };
  var TOOLS = { /* na mão direita (164,196), coordenadas locais do braço */
    none: ['Nada', ''],
    tubo: ['Tubo de projeto', '<g transform="translate(164 196) rotate(-32)"><rect class="pz-i" x="-9" y="-44" width="18" height="80" rx="4"/><ellipse class="pz-n" cx="0" cy="-44" rx="9" ry="4"/><rect class="pz-n" x="-9" y="24" width="18" height="7" rx="2"/><rect class="pz-n" x="-9" y="-12" width="18" height="4"/></g>'],
    martelo: ['Martelo', '<g transform="translate(164 196) rotate(-40)"><rect class="pz-i" x="-5" y="-16" width="10" height="58" rx="3"/><rect class="pz-n" x="-19" y="-30" width="38" height="18" rx="4"/></g>'],
    laptop: ['Notebook', '<g transform="translate(164 196)"><rect class="pz-n" x="-32" y="-8" width="46" height="30" rx="3"/><rect class="pz-i" x="-28" y="-4" width="38" height="20" rx="1.5"/><path class="pz-so pz-s25" d="M-22 10L-14 2L-6 6L2 -2"/><rect class="pz-g" x="-36" y="22" width="54" height="5" rx="2.5"/></g>'],
    tablet: ['Tablet', '<g transform="translate(164 196) rotate(-8)"><rect class="pz-n" x="-14" y="-26" width="30" height="44" rx="4"/><rect class="pz-i" x="-10" y="-22" width="22" height="34" rx="2"/><rect class="pz-or" x="-7" y="0" width="5" height="8"/><rect class="pz-n" x="0" y="-6" width="5" height="14"/><rect class="pz-or" x="7" y="-12" width="5" height="20"/></g>'],
    prancheta: ['Prancheta', '<g transform="translate(164 196) rotate(-8)"><rect class="pz-g" x="-15" y="-26" width="32" height="44" rx="3"/><rect class="pz-w" x="-11" y="-20" width="24" height="34" rx="1.5"/><rect class="pz-n" x="-7" y="-29" width="16" height="7" rx="2"/><path class="pz-st pz-s2" d="M-6 -8H10M-6 -1H10M-6 6H4"/></g>'],
    lupa: ['Lupa', '<g transform="translate(164 196) rotate(-30)"><circle class="pz-lp" cx="0" cy="-32" r="16"/><rect class="pz-n" x="-4" y="-14" width="8" height="32" rx="3"/></g>'],
    chave: ['Chave inglesa', '<g transform="translate(164 196) rotate(-40)"><rect class="pz-g" x="-4" y="-16" width="8" height="50" rx="3"/><path class="pz-g" d="M-13 -36H13V-24L5 -18H-5L-13 -24Z"/><rect class="pz-i" x="-5" y="-35" width="10" height="9"/></g>'],
    grafico: ['Gráfico', '<g transform="translate(164 196)"><rect class="pz-w pz-jl" x="-32" y="-32" width="46" height="42" rx="4"/><rect class="pz-i" x="-26" y="-10" width="8" height="16"/><rect class="pz-n" x="-15" y="-18" width="8" height="24"/><rect class="pz-or" x="-4" y="-26" width="8" height="32"/></g>'],
    megafone: ['Megafone', '<g transform="translate(164 196) rotate(-20)"><path class="pz-n" d="M-8 -16L28 -32V16L-8 0Z"/><path class="pz-or" d="M28 -32V16L22 13V-29Z"/><rect class="pz-i" x="-20" y="-16" width="14" height="16" rx="3"/><rect class="pz-g" x="-16" y="-2" width="8" height="20" rx="3"/></g>'],
    chip: ['Chip de IA', '<g transform="translate(164 196)"><rect class="pz-n" x="-18" y="-36" width="36" height="36" rx="5"/><rect class="pz-or pz-led" x="-8" y="-26" width="16" height="16" rx="2"/><path class="pz-so pz-s25" d="M-12 -42V-36M0 -42V-36M12 -42V-36M-12 0V6M0 0V6M12 0V6M-24 -30H-18M-24 -18H-18M18 -30H24M18 -18H24"/></g>'],
    cafe: ['Café', '<g transform="translate(164 196)"><path class="pz-w pz-jl" d="M-14 -30H14L10 2H-10Z"/><path class="pz-st pz-s3" d="M14 -24C24 -24 24 -8 14 -8"/><path class="pz-sv" d="M-5 -38C-3 -42 -7 -44 -5 -48M5 -38C7 -42 3 -44 5 -48"/></g>']
  };
  var GLASSES = {
    none: ['Sem óculos', ''],
    round: ['Redondos', '<g class="pz-gl"><circle cx="84" cy="104" r="15"/><circle cx="116" cy="104" r="15"/><path d="M99 103H101"/><path d="M69 102L60 100M131 102L140 100"/></g>'],
    square: ['Quadrados', '<g class="pz-gl pz-gq"><rect x="69" y="92" width="30" height="24" rx="5"/><rect x="101" y="92" width="30" height="24" rx="5"/><path d="M99 103H101"/></g>'],
    visor: ['Visor (IA)', '<g class="pz-vs"><rect x="62" y="90" width="76" height="28" rx="14"/><path class="pz-so pz-s2" d="M70 98H130"/></g>']
  };
  var MOODS = { /* [nome, sobrancelhas (um path), boca] */
    feliz: ['Feliz', 'M74 88Q84 82 94 88M106 88Q116 82 126 88', '<path class="pz-st" d="M86 136Q100 150 114 136"/>'],
    animado: ['Animado', 'M74 84Q84 78 94 84M106 84Q116 78 126 84', '<path class="pz-n" d="M82 134Q100 158 118 134Z"/><path class="pz-or" d="M91 144Q100 150 109 144Q100 148 91 144Z"/>'],
    surpreso: ['Surpreso', 'M74 80Q84 73 94 80M106 80Q116 73 126 80', '<ellipse class="pz-n" cx="100" cy="140" rx="8" ry="10"/>'],
    pensativo: ['Pensativo', 'M74 90H94M106 84Q116 78 126 84', '<path class="pz-st" d="M90 140Q98 135 108 141"/>'],
    focado: ['Focado', 'M74 86L94 91M106 91L126 86', '<path class="pz-st" d="M88 140H112"/>'],
    piscada: ['Piscadela', 'M74 88Q84 82 94 88M106 86Q116 80 126 86', '<path class="pz-st" d="M86 136Q102 150 116 134"/>'],
    preocupado: ['Preocupado', 'M74 93Q84 84 94 88M106 88Q116 84 126 93', '<path class="pz-st" d="M86 142Q93 136 100 142T114 142"/>'],
    triste: ['Triste', 'M74 94Q84 86 94 90M106 90Q116 86 126 94', '<path class="pz-st" d="M86 145Q100 133 114 145"/>']
  };
  var ACTS = [['parado', 'Parado (só respira e pisca)'], ['acenar', 'Acenar'], ['apontar', 'Apontar'], ['andar', 'Andar'], ['pular', 'Pular'], ['pensar', 'Pensar'], ['comemorar', 'Comemorar'], ['falar', 'Falar'], ['concordar', 'Concordar (sim)'], ['negar', 'Negar (não)']];
  var ACT_MS = { acenar: 2000, apontar: 2600, andar: 2200, pular: 1100, pensar: 2400, comemorar: 2400, falar: 2200, concordar: 1600, negar: 1600 };
  var TRIGS = [['in', 'Ao entrar no slide'], ['loop', 'Sem parar'], ['hover', 'Ao passar o mouse'], ['click', 'Só ao clicar']];
  var BUBS = [['fala', 'Fala'], ['pensa', 'Pensamento (nuvem)'], ['grita', 'Grito'], ['nota', 'Nota'], ['none', 'Sem balão']];
  var BCOLS = { /* [nome, fundo, texto, linha, fundo do grito, texto do grito] */
    branco: ['Branco', '#FFFFFF', '#002A46', '#002A46', '#002A46', '#FFFFFF'], navy: ['Navy', '#002A46', '#FFFFFF', '#002A46', '#002A46', '#FFFFFF'], laranja: ['Laranja', '#F78C16', '#002A46', '#F78C16', '#F78C16', '#002A46'], gelo: ['Gelo', '#E3EAF2', '#002A46', '#7EA1C3', '#7EA1C3', '#002A46'] };
  var TAILS = { bl: 'b', bc: 'b', br: 'b', l: 'l', r: 'r', tl: 't', tr: 't', none: 'n' }, TAILX = { bl: 22, bc: 50, br: 78, tl: 22, tr: 78 };
  /* elenco: [chave, nome, partes, descrição] */
  var PRESETS = [
    ['eng', 'Engenheira de obra', { hat: 'capW', hair: 'long', lashes: '1', glasses: 'round', outfit: 'colete', tool: 'tubo', c1: '#7EA1C3', c2: '#4A6FA5', mood: 'surpreso' }, 'Capacete branco, colete e o tubo de projeto: a voz da obra.'],
    ['mestre', 'Mestre de obras', { hat: 'capO', hair: 'none', lashes: '0', glasses: 'none', outfit: 'colete', tool: 'martelo', c1: '#4A6FA5', c2: '#002A46', mood: 'feliz' }, 'Capacete laranja e martelo: quem põe a mão na massa.'],
    ['dev', 'Desenvolvedor', { hat: 'headset', hair: 'short', lashes: '0', glasses: 'square', outfit: 'moletom', tool: 'laptop', c1: '#7EA1C3', c2: '#002A46', mood: 'focado' }, 'Headset, moletom e notebook: o time de tecnologia.'],
    ['devf', 'Desenvolvedora', { hat: 'none', hair: 'bun', lashes: '1', glasses: 'round', outfit: 'moletom', tool: 'laptop', c1: '#A3B8D6', c2: '#13315C', mood: 'feliz' }, 'Coque, moletom e notebook: produto e engenharia.'],
    ['ia', 'Agente de IA', { hat: 'antena', hair: 'none', lashes: '0', glasses: 'visor', outfit: 'circuito', tool: 'chip', c1: '#13315C', c2: '#002A46', mood: 'animado' }, 'Antena, visor e circuito: a inteligência artificial em pessoa.'],
    ['consultora', 'Consultora', { hat: 'none', hair: 'long', lashes: '1', glasses: 'none', outfit: 'jaqueta', tool: 'prancheta', c1: '#A3B8D6', c2: '#002A46', mood: 'feliz' }, 'Blazer navy e prancheta: a condução do projeto.'],
    ['consultor', 'Consultor', { hat: 'none', hair: 'short', lashes: '0', glasses: 'square', outfit: 'gravata', tool: 'tablet', c1: '#7EA1C3', c2: '#002A46', mood: 'feliz' }, 'Camisa, gravata laranja e tablet: o comitê executivo.'],
    ['analista', 'Analista de dados', { hat: 'bone', hair: 'tail', lashes: '1', glasses: 'round', outfit: 'colete', tool: 'grafico', c1: '#7EA1C3', c2: '#3E4C5E', mood: 'pensativo' }, 'Boné, rabo de cavalo e um gráfico na mão: números que explicam.'],
    ['cientista', 'Cientista de dados', { hat: 'none', hair: 'short', lashes: '0', glasses: 'round', outfit: 'jaleco', tool: 'lupa', c1: '#4A6FA5', c2: '#FFFFFF', mood: 'surpreso' }, 'Jaleco e lupa: investigação e descoberta.'],
    ['apresentador', 'Apresentador', { hat: 'none', hair: 'short', lashes: '0', glasses: 'none', outfit: 'gravata', tool: 'megafone', c1: '#F78C16', c2: '#002A46', mood: 'animado' }, 'Corpo laranja e megafone: abre e fecha a conversa.']
  ];

  /* ---------- utilitários ---------- */
  function has(o, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); }
  function tok(v, dict, def) { return has(dict, v) ? v : def; }
  function inList(v, list, def) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return v; return def; }
  function hex(v, def) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : def; }
  function str(v, n) { return v == null ? '' : String(v).replace(/\r\n?/g, '\n').slice(0, n || 400); }
  function pct(f) { return (f * 100).toFixed(3) + '%'; }
  function selOf(dict, first) { return 'sel:' + (first ? '=' + first + '|' : '') + Object.keys(dict).map(function (k) { return k + '=' + dict[k][0]; }).join('|'); }
  function selList(list, first) { return 'sel:' + (first ? '=' + first + '|' : '') + list.map(function (o) { return o[0] + '=' + o[1]; }).join('|'); }
  function colSel(list, first) { return 'sel:' + (first ? '=' + first + '|' : '') + list.map(function (c) { return c[0] + '=' + c[1]; }).join('|'); }
  function presetOf(el) { var v = el && el.variant; for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i][0] === v) return PRESETS[i]; return PRESETS[0]; }
  /* partes do personagem: o preset dá o padrão; cada campo do painel (quando não é “Do personagem”) sobrepõe */
  function resolve(d, el) {
    var P = presetOf(el)[2]; d = d || {};
    return { hat: tok(d.hat, HATS, P.hat), hair: tok(d.hair, HAIRS, P.hair), glasses: tok(d.glasses, GLASSES, P.glasses), outfit: tok(d.outfit, OUTFITS, P.outfit), tool: tok(d.tool, TOOLS, P.tool),
      lashes: d.lashes === '1' ? true : d.lashes === '0' ? false : P.lashes === '1', c1: hex(d.c1, P.c1), c2: hex(d.c2, P.c2), mood: tok(d.mood, MOODS, P.mood) };
  }
  /* decisões do balão: [{t, go, m}] (codec rows:t|go:n|m do painel; texto “Rótulo | slide | expressão” por linha num arquivo editado à mão) */
  function choicesOf(v) {
    var list = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n').map(function (l) { var p = l.split('|').map(function (s) { return s.trim(); }); return { t: p[0], go: +p[1] || 0, m: p[2] || '' }; }) : [];
    return list.filter(function (o) { return o && typeof o === 'object' && str(o.t, 40).trim(); }).slice(0, 6).map(function (o) { return { t: str(o.t, 40).trim(), go: isFinite(+o.go) ? Math.max(0, +o.go | 0) : 0, m: has(MOODS, o.m) ? o.m : '' }; });
  }
  function charSVG(p) {
    var hr = HAIRS[p.hair], ht = HATS[p.hat], of = OUTFITS[p.outfit], tl = TOOLS[p.tool], gl = GLASSES[p.glasses], brows = '', mouths = '';
    Object.keys(MOODS).forEach(function (k) { brows += '<path class="pz-st" data-m="' + k + '" d="' + MOODS[k][1] + '"/>'; mouths += '<g class="pz-mouth" data-m="' + k + '">' + MOODS[k][2] + '</g>'; });
    return '<g class="pz-char"><ellipse class="pz-shd" cx="100" cy="226" rx="56" ry="8"/>' +
      '<g class="pz-legs"><g class="pz-leg pz-lgL"><rect class="pz-lg" x="70" y="178" width="28" height="42" rx="13"/><ellipse class="pz-sh" cx="82" cy="222" rx="21" ry="9"/></g><g class="pz-leg pz-lgR"><rect class="pz-lg" x="102" y="178" width="28" height="42" rx="13"/><ellipse class="pz-sh" cx="118" cy="222" rx="21" ry="9"/></g></g>' +
      '<g class="pz-torso">' + BODY + of[1] + hr[1] + FACE + CHEEKS + EYES + (p.lashes ? LASH : '') + brows + mouths + gl[1] + hr[2] + ht[1] +
      '<g class="pz-arm pz-aL"><rect class="pz-b" x="25" y="146" width="22" height="50" rx="11"/><circle class="pz-hand" cx="36" cy="196" r="11"/></g>' +
      '<g class="pz-arm pz-aR"><rect class="pz-b" x="153" y="146" width="22" height="50" rx="11"/>' + tl[1] + '<circle class="pz-hand" cx="164" cy="196" r="11"/><rect class="pz-hand pz-fing" x="160" y="200" width="8" height="18" rx="4"/></g></g>' +
      '<g class="pz-conf"><circle class="pz-or" cx="60" cy="70" r="5"/><circle class="pz-i" cx="140" cy="60" r="4"/><circle class="pz-n" cx="100" cy="40" r="4"/><circle class="pz-or" cx="30" cy="130" r="3.5"/><circle class="pz-i" cx="172" cy="120" r="4"/></g></g>';
  }
  /* caixa do SVG e do balão dentro do elemento (frações de w/h) */
  function layout(side, w, h, hasB, face) {
    if (!/^(top|left|right)$/.test(side)) side = hasB ? (w >= h * 1.15 ? (face === 'l' ? 'left' : 'right') : 'top') : 'none';
    if (!hasB || side === 'none') return { side: 'none', svg: [0, 0, 1, 1], bub: null, tail: 'n' };
    if (side === 'top') return { side: side, svg: [0.05, 0.31, 0.9, 0.69], bub: [0, 0, 1, 0.28], tail: 'b' };
    if (side === 'right') return { side: side, svg: [0, 0.05, 0.5, 0.95], bub: [0.52, 0, 0.48, 0.64], tail: 'l' };
    return { side: 'left', svg: [0.5, 0.05, 0.5, 0.95], bub: [0, 0, 0.48, 0.64], tail: 'r' };
  }
  function bubVars(k) { var c = BCOLS[k] || BCOLS.branco; return '--c-bub:' + c[1] + ';--c-ink:' + c[2] + ';--c-line:' + c[3] + ';--c-sbg:' + c[4] + ';--c-sink:' + c[5]; }
  function bubbleBox(kind, tail, pos, vars, inner) {
    return '<div class="pz-say pz-say-' + kind + ' pz-tl-' + tail + '"' + (pos ? ' style="' + pos + ';' + vars + '"' : ' style="' + vars + '"') + '>' + inner + '</div>';
  }

  /* ---------- FX.persona ---------- */
  R.FX.persona = {
    name: 'Personagem A&M', cat: 'Personagens', w: 300, h: 380, anim: { in: 'rise', dur: 700 }, variant: 'eng', gal: 'one', vtitle: 'Personagem', vlabel: 'Personagem',
    kw: 'personagem boneco mascote avatar engenheira mestre de obras desenvolvedor ia inteligência artificial consultor consultora analista cientista apresentador rive animação fala balão apontar andar',
    variants: PRESETS.map(function (p) { return [p[0], p[1], p[3]]; }),
    label: function (el) { return 'Personagem · ' + presetOf(el)[1]; },
    tip: 'Na apresentação o personagem se move conforme o gatilho, os olhos seguem o mouse e um clique nele muda a expressão, a fala e acende o elemento para onde aponta. Prenda uma linha a ele para ligar o balão a um gráfico.',
    data: { hat: '', hair: '', lashes: '', glasses: '', outfit: '', tool: '', c1: '', c2: '', mood: '', act: 'acenar', trig: 'in', dir: 'auto', look: '1', say: 'Olá! Vamos ao plano.', bubble: 'fala', side: 'auto', bcol: 'branco', mood2: '', say2: '', act2: 'pular', aim: '', walk: '', choices: [] },
    fields: [['hat', 'Chapéu', selOf(HATS, 'Do personagem')], ['hair', 'Cabelo', selOf(HAIRS, 'Do personagem')], ['lashes', 'Cílios', 'sel:=Do personagem|1=Com cílios|0=Sem cílios'], ['glasses', 'Óculos', selOf(GLASSES, 'Do personagem')],
      ['outfit', 'Roupa', selOf(OUTFITS, 'Do personagem')], ['tool', 'Ferramenta na mão', selOf(TOOLS, 'Do personagem')], ['c1', 'Cor do corpo', colSel(COLS, 'Do personagem')], ['c2', 'Cor da roupa', colSel(COLS2, 'Do personagem')],
      ['mood', 'Expressão', selOf(MOODS, 'Do personagem')], ['act', 'Movimento', selList(ACTS)], ['trig', 'Quando se move', selList(TRIGS)], ['dir', 'Olhando para', 'sel:auto=Automático (para o alvo)|r=Direita|l=Esquerda'],
      ['look', 'Olhos na apresentação', 'sel:1=Seguem o mouse|0=Fixos'],
      ['say', 'Fala', 'area'], ['bubble', 'Balão', selList(BUBS)], ['side', 'Posição do balão', 'sel:auto=Automática|top=Em cima|right=À direita|left=À esquerda'], ['bcol', 'Cor do balão', 'sel:' + Object.keys(BCOLS).map(function (k) { return k + '=' + BCOLS[k][0]; }).join('|')],
      ['help', '<b>Ao clicar</b> na apresentação o personagem reage: muda a expressão, troca a fala, faz o movimento abaixo (com o gatilho “Só ao clicar”, faz o movimento principal) e acende o elemento para onde aponta. Um segundo clique volta ao normal.', 'help'],
      ['mood2', 'Expressão ao clicar', selOf(MOODS, 'Não muda')], ['say2', 'Fala ao clicar', 'area'], ['act2', 'Movimento ao clicar', 'sel:none=Nenhum|' + ACTS.slice(1).map(function (o) { return o[0] + '=' + o[1]; }).join('|')],
      ['aim', 'Aponta para', 'sel:=Nenhum'], ['walk', 'Andar até (X no slide, em px; vazio = fica onde está)', 'number'],
      ['choices', 'Decisões no balão — uma por linha: Botão | nº do slide | expressão (feliz, triste…)', 'rows:t|go:n|m'],
      ['help2', 'Cada decisão vira um botão no balão: na apresentação ele muda a expressão e leva ao slide indicado (0 = fica no mesmo). Para o personagem <b>andar</b>, escolha o movimento Andar ou preencha “Andar até”.', 'help']],
    html: function (d, w, h, el) {
      d = d || {}; var p = resolve(d, el), act = inList(d.act, ACTS, 'acenar'), act2 = d.act2 === 'none' ? 'none' : inList(d.act2, ACTS.slice(1), 'pular'), trig = inList(d.trig, TRIGS, 'in');
      if (trig === 'click' && act !== 'parado') act2 = act; /* “só ao clicar”: o clique toca o próprio movimento */
      var dir = d.dir === 'l' || d.dir === 'r' ? d.dir : 'auto', face = dir === 'l' ? 'l' : 'r', mood2 = tok(d.mood2, MOODS, '');
      var say = str(d.say), say2 = str(d.say2), ch = choicesOf(d.choices), bub = inList(d.bubble, BUBS, 'fala'), hasB = bub !== 'none' && !!(say.trim() || say2.trim() || ch.length);
      var aim = typeof d.aim === 'string' && /^[\w-]{1,40}$/.test(d.aim) ? d.aim : '';
      var walk = d.walk === '' || d.walk == null ? null : +d.walk, attrs = '', vars = '';
      var L = layout(d.side, w, h, hasB, face), sx = w * L.svg[0], sy = h * L.svg[1], sw = w * L.svg[2], sh = h * L.svg[3], k = Math.min(sw / 200, sh / 240) || 1;
      if (walk != null && isFinite(walk) && el && isFinite(+el.x) && Math.abs(walk - el.x) >= 2) {
        var dist = Math.max(-W, Math.min(W, walk - el.x)), ms = Math.round(Math.max(600, Math.min(5000, Math.abs(dist) * 3.2))), n = Math.max(1, Math.round(ms / 500));
        if (dir === 'auto') face = dist < 0 ? 'l' : 'r';
        vars += '--wq:' + CQ(dist) + ';--wt:' + ms + 'ms;--wn:' + n + ';'; attrs += ' data-walk="1"'; /* cqw: balão e boneco andam juntos, na escala do palco */
      }
      var f = Math.max(10, Math.min(24, Math.min(w * .058, h * .052)));
      var out = '<div class="fx pz am-ia' + (hasB ? ' pz-hasb' : '') + (say2.trim() ? ' pz-has2' : '') + '" data-act="' + act + '" data-act2="' + act2 + '" data-trig="' + trig + '" data-mood="' + p.mood + '" data-mood1="' + p.mood + '"' + (mood2 ? ' data-mood2="' + mood2 + '"' : '') +
        ' data-face="' + face + '" data-dir="' + dir + '" data-look="' + (d.look === '0' ? '0' : '1') + '"' + (aim ? ' data-aim="' + aim + '"' : '') + ' data-sb="' + L.svg.map(function (v) { return v.toFixed(3); }).join(' ') + '"' + attrs +
        ' style="' + vars + '--c1:' + p.c1 + ';--c2:' + p.c2 + ';font-size:' + CQ(f) + '"><div class="pz-mv">';
      if (hasB) { /* rabicho apontando para a cabeça: x = centro do desenho (em cima) ou y da cabeça (dos lados) */
        var B = L.bub, dw = 200 * k, dh = 240 * k, headX = sx + sw / 2, headY = sy + sh - dh + 100 * k, tx = (headX - w * B[0]) / (w * B[2]) * 100, ty = (headY - h * B[1]) / (h * B[3]) * 100;
        var inner = '<div class="pz-s1">' + (say.trim() ? E('say', say, 'pz-txt') : '') + '</div>' + (say2.trim() ? '<div class="pz-s2">' + E('say2', say2, 'pz-txt') + '</div>' : '') +
          (ch.length ? '<div class="pz-chs">' + ch.map(function (c) { return '<button type="button" class="pz-ch" data-go="' + c.go + '"' + (c.m ? ' data-cm="' + c.m + '"' : '') + '>' + esc(c.t) + '</button>'; }).join('') + '</div>' : '');
        out += bubbleBox(bub, L.tail, 'left:' + pct(B[0]) + ';top:' + pct(B[1]) + ';width:' + pct(B[2]) + ';height:' + pct(B[3]) + ';--tx:' + Math.max(12, Math.min(88, tx)).toFixed(1) + '%;--ty:' + Math.max(15, Math.min(85, ty)).toFixed(1) + '%', bubVars(d.bcol), inner);
        void dw;
      }
      return out + '<svg class="pz-svg" viewBox="0 0 200 240" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false" style="left:' + pct(L.svg[0]) + ';top:' + pct(L.svg[1]) + ';width:' + pct(L.svg[2]) + ';height:' + pct(L.svg[3]) + '">' + charSVG(p) + '</svg></div></div>';
    }
  };

  /* ---------- FX.bubble — balão solto ---------- */
  R.FX.bubble = {
    name: 'Balão de fala', cat: 'Personagens', w: 360, h: 150, anim: { in: 'pop', dur: 600 },
    kw: 'balão balao fala pensamento nuvem grito nota diálogo quadrinho personagem comentário',
    tip: 'Duplo clique escreve no balão. Para ligá-lo a quem fala, insira uma linha e arraste a ponta até o balão: ela fica presa e acompanha.',
    data: { text: 'Uma ideia por balão.', style: 'fala', tail: 'bl', bcol: 'branco' },
    fields: [['text', 'Texto', 'area'], ['style', 'Tipo', selList(BUBS.slice(0, 4))], ['tail', 'Rabicho', 'sel:bl=Embaixo, à esquerda|bc=Embaixo, no centro|br=Embaixo, à direita|l=À esquerda|r=À direita|tl=Em cima, à esquerda|tr=Em cima, à direita|none=Sem rabicho'],
      ['bcol', 'Cor', 'sel:' + Object.keys(BCOLS).map(function (k) { return k + '=' + BCOLS[k][0]; }).join('|')]],
    html: function (d, w, h) {
      d = d || {}; var st = inList(d.style, BUBS.slice(0, 4), 'fala'), tl = has(TAILS, d.tail) ? d.tail : 'bl', f = Math.max(10, Math.min(26, Math.min(w * .07, h * .17)));
      return '<div class="fx pz-bub" style="font-size:' + CQ(f) + '">' + bubbleBox(st, TAILS[tl], null, bubVars(d.bcol) + ';--tx:' + (TAILX[tl] || 50) + '%;--ty:50%', '<div class="pz-s1">' + E('text', str(d.text, 600), 'pz-txt') + '</div>') + '</div>';
    }
  };

  /* ---------- mira: braço que aponta e lado para onde olha, a partir das caixas (% do palco) dos dois elementos ---------- */
  function boxOf(n) { var s = n.style; return { x: parseFloat(s.left) / 100 * W, y: parseFloat(s.top) / 100 * H, w: parseFloat(s.width) / 100 * W, h: parseFloat(s.height) / 100 * H }; }
  function aimNode(pz) {
    var el = pz.closest('.am-el'), st = pz.closest('.am-stage'); if (!el || !st) return;
    var id = pz.dataset.aim, tn = id ? st.querySelector('.am-el[data-id="' + id + '"]') : null, dir = pz.dataset.dir || 'auto';
    if (!tn || tn === el || pz.dataset.walk === '1') { if (!pz.dataset.walk) pz.dataset.face = dir === 'l' ? 'l' : 'r'; pz.style.setProperty('--aim', '-100deg'); return; }
    var b = boxOf(el), t = boxOf(tn), sb = (pz.dataset.sb || '0 0 1 1').split(' ').map(Number);
    if (!(b.w > 0 && t.w > 0)) return;
    var sx = b.x + b.w * sb[0], sy = b.y + b.h * sb[1], sw = b.w * sb[2], sh = b.h * sb[3], k = Math.min(sw / 200, sh / 240), dw = 200 * k, dh = 240 * k, ox = sx + (sw - dw) / 2, oy = sy + sh - dh;
    var tx = t.x + t.w / 2, ty = t.y + t.h / 2, face = dir === 'l' || dir === 'r' ? dir : (tx >= ox + dw / 2 ? 'r' : 'l');
    var shx = ox + (face === 'r' ? 164 : 36) * k, shy = oy + 152 * k, a = Math.atan2(ty - shy, tx - shx) * 180 / Math.PI, rot = face === 'r' ? a - 90 : 90 - a;
    rot = ((rot + 180) % 360 + 360) % 360 - 180;
    pz.dataset.face = face; pz.style.setProperty('--aim', rot.toFixed(1) + 'deg');
  }
  function aimStage(st) { if (!st || !st.querySelectorAll) return; Array.prototype.forEach.call(st.querySelectorAll('.pz[data-aim]'), aimNode); }
  var baseRender = R.renderSlide;
  R.renderSlide = function (slide, opts) { var st = baseRender(slide, opts); aimStage(st); return st; }; /* palco do editor, miniaturas, rasters (o player desenha por dentro: ver o gancho abaixo) */
  var baseEl = R.renderEl;
  R.renderEl = function (el, i) { var n = baseEl(el, i); if (el && el.kind === 'persona' && el.data && el.data.aim) setTimeout(function () { var pz = n.querySelector('.pz'); if (pz && n.isConnected) aimNode(pz); }, 0); return n; };

  /* ---------- player ---------- */
  function flash(pz, cls, ms) { pz.classList.remove(cls); void pz.offsetWidth; pz.classList.add(cls); clearTimeout(pz['_t' + cls]); pz['_t' + cls] = setTimeout(function () { pz.classList.remove(cls); }, ms); }
  function hilite(pz) {
    var st = pz.closest('.am-stage'), id = pz.dataset.aim, tn = id && st ? st.querySelector('.am-el[data-id="' + id + '"]') : null; if (!tn) return;
    var fw = tn.querySelector('.am-fxw'); tn.classList.remove('pz-hl'); void tn.offsetWidth; tn.classList.add('pz-hl'); if (fw) fw.classList.add('am-hov');
    clearTimeout(tn._pzT); tn._pzT = setTimeout(function () { tn.classList.remove('pz-hl'); if (fw) fw.classList.remove('am-hov'); }, 1800);
  }
  function react(pz) {
    var on = pz.classList.toggle('pz-on'), m2 = pz.dataset.mood2;
    if (m2) pz.dataset.mood = on ? m2 : (pz.dataset.mood1 || pz.dataset.mood);
    if (pz.dataset.act2 && pz.dataset.act2 !== 'none') flash(pz, 'pz-go', ACT_MS[pz.dataset.act2] || 2000);
    hilite(pz);
  }
  function visOf(hd, idx) { var m = hd.map || []; for (var k = 0; k < m.length; k++) if (m[k] >= idx) return k; return m.length - 1; }
  R.hooks.player.push(function (hd) {
    var deckEl = hd.deckEl; if (!deckEl) return;
    Array.prototype.forEach.call(deckEl.querySelectorAll('.am-stage'), aimStage);
    var px = 0, py = 0, raf = 0;
    function click(e) {
      var ch = e.target.closest ? e.target.closest('.pz-ch') : null;
      if (ch) {
        var pz = ch.closest('.pz'), m = ch.dataset.cm, go = +ch.dataset.go; e.stopPropagation();
        if (m) pz.dataset.mood = m; pz.classList.add('pz-on'); if (pz.dataset.act2 && pz.dataset.act2 !== 'none') flash(pz, 'pz-go', ACT_MS[pz.dataset.act2] || 2000);
        if (go > 0) setTimeout(function () { hd.go(visOf(hd, go - 1)); }, 420);
        return;
      }
      var p = e.target.closest ? e.target.closest('.pz') : null; if (p) react(p);
    }
    function tick() {
      raf = 0; var sl = deckEl.children[hd.cur()]; if (!sl) return;
      Array.prototype.forEach.call(sl.querySelectorAll('.pz[data-look="1"]'), function (pz) {
        var ey = pz.querySelector('.pz-eyes'); if (!ey) return; var r = ey.getBoundingClientRect(); if (!r.width) return;
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = px - cx, dy = py - cy, d = Math.sqrt(dx * dx + dy * dy) || 1, m = Math.min(1, d / (r.width * 2.5)), fl = pz.dataset.face === 'l' ? -1 : 1;
        pz.style.setProperty('--lx', (dx / d * 4.5 * m * fl).toFixed(2) + 'px'); pz.style.setProperty('--ly', (dy / d * 3.5 * m).toFixed(2) + 'px');
      });
    }
    function move(e) { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(tick); }
    deckEl.addEventListener('click', click); hd.root.addEventListener('pointermove', move);
    hd.onDestroy(function () { deckEl.removeEventListener('click', click); hd.root.removeEventListener('pointermove', move); if (raf) cancelAnimationFrame(raf); raf = 0; });
  });
  R.personas = { PRESETS: PRESETS, HATS: HATS, HAIRS: HAIRS, OUTFITS: OUTFITS, TOOLS: TOOLS, GLASSES: GLASSES, MOODS: MOODS, ACTS: ACTS, TRIGS: TRIGS, BUBS: BUBS, BCOLS: BCOLS, ACT_MS: ACT_MS, resolve: resolve, aimNode: aimNode, aimStage: aimStage, presetOf: presetOf, choices: choicesOf };
})(window.AMRT);
