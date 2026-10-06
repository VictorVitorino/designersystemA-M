/* ===== ed-45-institucional.js — Slides institucionais A&M (S34; só no editor) =====
   Os cinco slides institucionais (capa “Somos a A&M Performance”, presença global, clientes, esferas de atuação, cadeia de valor)
   nascem de specs JSON (inst/*.json, medidos contra as imagens de referência com tools/inst-check.js) que o assemble.py embute aqui
   no lugar do marcador INST_SPECS (comentário + null, logo abaixo). Cada um vira um layout OCULTO do editor (LAYOUTS['inst-…'], hidden: fora do seletor de layouts) e os cinco
   formam o bloco “Institucional A&M” (SEQS, primeiro; também como tile no seletor “Novo slide”, em Marca A&M ▸ e no painel do slide).
   Os slides são editáveis como qualquer outro (textos, linhas, logos); mapa, clientes e cadeia de valor usam a arte oficial como
   imagem de fundo (os textos variáveis ficam por cima, editáveis). O kit de marca (S29) não mexe neles.
   Importação (ed-42): AMInst.scan(início, n) reconhece slides importados pelo texto (título) e AMInst.replace(lista) troca-os, no
   mesmo lugar, pela versão oficial (um Ctrl+Z).
   API: window.AMInst = { ORDER, NAMES, KEY(k) → 'inst-k', scan(from, n) → [{i, key, name}], replace(list) → n, insert(), match(slide) → key|null } */
(function () {
  'use strict';
  var A = window.AMStudio, RT = window.AMRT; if (!A || !A.LAYOUTS || !A.SEQS) return;
  var SPECS = /*%%INST_SPECS%%*/null; if (!SPECS) return;
  var ORDER = ['cover', 'map', 'clients', 'spheres', 'chain'].filter(function (k) { return SPECS[k]; });
  var NAMES = { cover: 'Capa “Somos a A&M Performance”', map: 'Presença global', clients: 'Clientes', spheres: 'Esferas de atuação', chain: 'Cadeia de valor' };
  var RATIO = { perfW: 743 / 134, perfN: 743 / 134, wmW: 262 / 42, wmN: 262 / 42 };
  function KEY(k) { return 'inst-' + k; }
  /* spec → elementos do Canteiro (mesma conversão do harness tools/inst-check.js) */
  function els(spec) {
    var mk = A.mk, out = [];
    (spec.els || []).forEach(function (e) {
      var el;
      if (e.type === 'text') { el = mk.text('body', null, false); delete el.font; delete el.size; delete el.weight; delete el.lh; }
      else if (e.type === 'line') el = mk.line(!!e.headEnd, false);
      else if (e.type === 'shape') el = mk.shape(e.shape || 'rect', false);
      else if (e.type === 'image') el = mk.image(e.src, e.nw || 1600, e.nh || 900);
      else if (e.type === 'brand') { el = mk.brand(e.key || 'wmW', { x: e.x, y: e.y, h: e.h || 22 }); el.w = Math.round((RATIO[e.key || 'wmW'] || 262 / 42) * el.h); }
      else return;
      var o = Object.assign({}, e); delete o.type; delete o.shape; delete o.key; delete o.src; delete o.nw; delete o.nh;
      if (e.type === 'image') o.src = e.src;
      Object.assign(el, o); el.anim = { in: 'none' }; out.push(el);
    });
    return out;
  }
  ORDER.forEach(function (k) {
    var sp = SPECS[k];
    A.LAYOUTS[KEY(k)] = { name: 'Institucional · ' + NAMES[k], bg: sp.bg || '#002A46', bgImg: sp.bgImg || null, bgImgOp: sp.bgImgOp == null ? 1 : sp.bgImgOp, hidden: true, inst: k, els: function () { return els(sp); } };
  });
  if (!A.SEQS.some(function (s) { return s[0] === 'inst'; })) A.SEQS.unshift(['inst', 'Institucional A&M', ORDER.map(KEY), true]);
  if (A.rebuildSlidePicker) A.rebuildSlidePicker();
  if (A.renderAll) A.renderAll(); /* S34b: o editor já desenhou o painel antes deste script; redesenha para a seção “Slides institucionais A&M” existir no primeiro render (sem commit/histórico) */
  /* ---------- reconhecimento de slides importados ---------- */
  var SIG = { cover: /^somos a a ?m performance/, map: /^fazemos parte da alvarez marsal/, clients: /^clientes de diferentes portes perfis e segmentos/, spheres: /^esferas de atuacao da alvarez marsal/, chain: /melhorias especificas nas atividades primarias|evolucoes que reinventam negocios/ };
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function textsOf(s) {
    var out = [];
    (s.els || []).forEach(function (e) { if (e.type === 'text' || e.type === 'shape') { var t = RT && RT.plain ? RT.plain(e.html) : String(e.html || '').replace(/<[^>]+>/g, ' '); if (t.trim()) out.push({ t: t, size: +e.size || 0, y: +e.y || 0 }); } });
    out.sort(function (a, b) { return b.size - a.size || a.y - b.y; }); /* o maior texto primeiro (título) */
    return out.map(function (o) { return norm(o.t); });
  }
  function match(s) {
    if (!s || !s.els) return null; var T = textsOf(s); if (!T.length) return null; var all = T.join(' ');
    for (var i = 0; i < ORDER.length; i++) { var k = ORDER[i]; if (SIG[k].test(T[0]) || (k === 'chain' && SIG[k].test(all))) return k; }
    for (var j = 0; j < ORDER.length; j++) { var k2 = ORDER[j]; if (k2 !== 'chain' && T.some(function (t) { return SIG[k2].test(t); })) return k2; }
    return null;
  }
  function scan(from, n) {
    var out = [], sl = A.deck.slides; from = Math.max(0, from | 0); n = n == null ? sl.length - from : n | 0;
    for (var i = from; i < Math.min(sl.length, from + n); i++) { var s = sl[i]; if (s.layout && /^inst-/.test(s.layout)) continue; var k = match(s); if (k) out.push({ i: i, key: k, name: NAMES[k] }); }
    return out;
  }
  function replace(list) {
    var n = 0; (list || []).forEach(function (o) { var i = o.i | 0, k = o.key; if (!A.deck.slides[i] || !A.LAYOUTS[KEY(k)]) return; var old = A.deck.slides[i], s = A.mk.slide(KEY(k)); if (old.hidden === true) s.hidden = true; if (old.sec) s.sec = old.sec; A.deck.slides[i] = s; n++; });
    if (n) { A.renderAll(); A.commit(); A.toast(n + (n === 1 ? ' slide trocado pela versão oficial' : ' slides trocados pela versão oficial') + ' · Ctrl+Z desfaz'); }
    return n;
  }
  window.AMInst = { ORDER: ORDER, NAMES: NAMES, KEY: KEY, scan: scan, replace: replace, match: match, insert: function () { A.insertSeq('inst'); }, specs: SPECS };
})();
