/* ===== ed-46-personas.js — Personagens A&M (S35; só no editor) =====
   · “Aponta para”: o campo do painel (data.aim) vira um seletor com os elementos do slide atual (nome do tipo + começo do texto),
     montado na hora em que o painel é desenhado (getter sobre FX.persona.fields; no runtime o campo continua estático).
   · Mira ao vivo: depois de arrastar/redimensionar/mover com as setas (pointerup, keyup) ou editar X/Y no painel (input), o braço
     que aponta e o lado para onde o personagem olha são recalculados no palco (AMRT.personas.aimStage) sem redesenhar nada.
   · Faixa de ferramentas › Marca ▾: seção “Personagens A&M” com os 10 do elenco e o balão de fala (o mesmo que Inserir › Personagens ▸). */
(function () {
  'use strict';
  var A = window.AMStudio, RT = window.AMRT; if (!A || !RT || !RT.FX || !RT.FX.persona || !RT.personas) return;
  var F = RT.FX.persona, BASE = F.fields.slice(), P = RT.personas;
  function nameOf(e) {
    var base = e.type === 'fx' ? (RT.fxLabel ? RT.fxLabel(e) : 'Componente') : e.type === 'image' ? 'Imagem' : e.type === 'shape' ? 'Forma' : e.type === 'text' ? 'Texto' : 'Elemento';
    var t = (e.type === 'text' || e.type === 'shape') && RT.plain ? RT.plain(e.html) : '';
    if (!t && e.type === 'fx' && e.data) ['title', 'label', 'say', 'text'].some(function (k) { var v = e.data[k]; if (typeof v === 'string' && v.trim()) { t = v; return true; } return false; });
    t = String(t || '').replace(/\s+/g, ' ').trim();
    return (t ? base + ' “' + (t.length > 26 ? t.slice(0, 25) + '…' : t) + '”' : base).replace(/[|=]/g, ' ');
  }
  function aimOpts() {
    var s = A.deck && A.deck.slides[A.cur], sel = A.selected(), me = sel.length === 1 ? sel[0] : null, out = ['=Nenhum'], els = (s && s.els) || [];
    var meEl = me && els.filter(function (e) { return e && e.id === me; })[0], cur = meEl && meEl.data && typeof meEl.data.aim === 'string' ? meEl.data.aim : '';
    els.forEach(function (e) { if (!e || e.id === me || e.type === 'line' || typeof e.id !== 'string') return; out.push(e.id + '=' + nameOf(e)); });
    /* alvo que não está mais neste slide (apagado, ou personagem colado em outro slide): aparece selecionado, para poder trocar ou limpar */
    if (cur && /^[\w-]{1,40}$/.test(cur) && !els.some(function (e) { return e && e.id === cur; })) out.splice(1, 0, cur + '=(alvo que não está neste slide)');
    return 'sel:' + out.join('|');
  }
  /* aviso no painel quando a fala não cabe no balão (o palco já mostra o contorno tracejado e o texto com reticências) */
  var TIP = F.tip;
  Object.defineProperty(F, 'tip', { configurable: true, enumerable: true, get: function () {
    var sel = A.selected(), n = sel.length === 1 && document.querySelector('#wrap .am-stage .am-el[data-id="' + sel[0] + '"] .pz.pz-over');
    return (n ? '⚠ A fala não cabe no balão: na apresentação ela sai cortada, com reticências. Aumente o personagem, encurte a fala ou use menos decisões. ' : '') + TIP;
  } });
  Object.defineProperty(F, 'fields', { configurable: true, enumerable: true, get: function () { return BASE.map(function (f) { return f[0] === 'aim' ? ['aim', f[1], aimOpts()] : f; }); } });
  var t = 0;
  /* giro (alça, teclado, painel) e posição mudam o palco sem redesenhar o personagem: data-rot e data-walk (distância até o X de chegada)
     vêm do modelo antes de remirar */
  function sync(st) {
    var s = A.deck && A.deck.slides[A.cur]; if (!s) return;
    Array.prototype.forEach.call(st.querySelectorAll('.pz'), function (pz) {
      var n = pz.closest('.am-el'), e = n && s.els.filter(function (x) { return x && x.id === n.dataset.id; })[0]; if (!e) return;
      var r = +e.rot || 0; if (r) pz.dataset.rot = r.toFixed(2); else delete pz.dataset.rot;
      var w = e.data && e.data.walk; if (pz.dataset.walk != null && w !== '' && w != null && isFinite(+w)) pz.dataset.walk = String(Math.round(+w - e.x));
    });
  }
  /* o aviso de fala que não cabe acompanha edições feitas no próprio painel (texto, largura, altura), que não redesenham o painel */
  function tipSync() { var v = document.querySelector('#props .vtip'), s = A.selected(), sl = A.deck && A.deck.slides[A.cur], e = s.length === 1 && sl && sl.els.filter(function (x) { return x && x.id === s[0]; })[0]; if (v && e && e.kind === 'persona') v.textContent = F.tip; }
  function reaim() { clearTimeout(t); t = setTimeout(function () { var st = document.querySelector('#wrap .am-stage'); if (st && st.querySelector('.pz[data-aim]')) { sync(st); RT.personas.aimStage(st); } tipSync(); }, 0); }
  document.addEventListener('pointerup', reaim, true);
  document.addEventListener('keyup', function (e) { if (/^Arrow/.test(e.key)) reaim(); }, true);
  var pr = document.getElementById('props'); if (pr) { pr.addEventListener('input', reaim); pr.addEventListener('change', reaim); }
  /* Marca ▾: personagens à mão, sem passar pelo menu Inserir */
  var mb = document.getElementById('mBrand');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  if (mb && !mb.querySelector('.pzm')) {
    var h = '<div class="mh">Personagens A&amp;M</div><div class="pzm" role="group" aria-label="Personagens A&amp;M">' +
      RT.personas.PRESETS.map(function (p) { return '<button type="button" data-pz="' + esc(p[0]) + '" title="' + esc(p[3]) + '">' + esc(p[1]) + '</button>'; }).join('') +
      (RT.FX.bubble ? '<button type="button" data-pz="bubble" title="Balão solto para ligar com conectores">Balão de fala</button>' : '') + '</div>';
    mb.insertAdjacentHTML('beforeend', h);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#mBrand button[data-pz]'); if (!b) return; /* o menu já fechou (listener genérico de .menu button) */
    if (b.dataset.pz === 'bubble') { A.insertFx('bubble'); A.toast('Balão inserido: duplo clique escreve; prenda uma linha a ele para ligar a quem fala.'); return; }
    A.insertFx('persona', null, null, b.dataset.pz); A.toast('Personagem inserido. Roupa, ferramenta, expressão, fala e movimento ficam no painel à direita; na apresentação ele reage ao clique.');
  });
  /* ===== S36: Estúdio do personagem — o painel vira um estúdio visual: elenco, peças, cores, movimento, fala e ligações com os slides.
     As opções vêm dos próprios campos do componente (codec sel:), as miniaturas do próprio FX.persona.html (pose de repouso, sem animação);
     peças e cores valem para o grupo inteiro (o mesmo personagem em vários slides); os campos originais ficam em “Ajustes finos”. ===== */
  var LOOK = ['hat', 'hair', 'lashes', 'glasses', 'outfit', 'tool', 'c1', 'c2'], HEAD = { hat: 1, hair: 1, glasses: 1, mood: 1 }, tab = 'look', part = 'outfit', fine = false;
  var PARTS = [['outfit', 'Roupa'], ['hat', 'Chapéu'], ['hair', 'Cabelo'], ['glasses', 'Óculos'], ['tool', 'Ferramenta'], ['mood', 'Expressão']];
  var TABS = [['look', 'Visual'], ['cor', 'Cores'], ['mov', 'Movimento'], ['fala', 'Fala'], ['lig', 'Ligar']];
  function selEl() { var s = A.selected(), sl = A.deck && A.deck.slides[A.cur]; return s.length === 1 && sl ? sl.els.filter(function (x) { return x && x.id === s[0]; })[0] : null; }
  function opts(k) { var f = BASE.filter(function (x) { return x[0] === k; })[0], c = f && f[2]; return typeof c === 'string' && c.indexOf('sel:') === 0 ? c.slice(4).split('|').map(function (o) { var i = o.indexOf('='); return [o.slice(0, i), o.slice(i + 1)]; }) : []; }
  var MEMO = {}, memoN = 0; /* S38: miniaturas em cache (o mesmo visual desenha o mesmo SVG): o painel abre e responde sem refazer dezenas de SVGs */
  function mini(e, ch, v, head) {
    var d = Object.assign({}, e.data, ch, { bubble: 'none', walk: '', aim: '', link: '', grp: '', say: '', say2: '', choices: [] }), k = (v || e.variant) + '|' + (head ? 1 : 0) + '|' + JSON.stringify(d);
    if (MEMO[k]) return MEMO[k]; if (++memoN > 400) { MEMO = {}; memoN = 1; }
    var h = F.html(d, 100, 120, { id: 'pzs', variant: v || e.variant });
    return (MEMO[k] = head ? h.replace('viewBox="0 0 200 240"', 'viewBox="34 6 132 126"') : h);
  }
  function tile(attr, label, inner, on) { return '<button type="button" class="pzs-t' + (on ? ' on' : '') + '" ' + attr + ' title="' + esc(label) + '" aria-pressed="' + !!on + '"><span class="pzs-in">' + inner + '</span><i>' + esc(label) + '</i></button>'; }
  function chips(k, cur, list) { return '<div class="chips pzs-c">' + (list || opts(k)).map(function (o) { return '<button type="button" class="chip' + (o[0] === cur ? ' on' : '') + '" data-pzs="' + k + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }
  function sw(k, cur, list) { return '<div class="pzs-sws">' + list.map(function (o) { return '<button type="button" class="pzs-sw' + (o[0] === cur ? ' on' : '') + '" data-pzs="' + k + '" data-v="' + esc(o[0]) + '" title="' + esc(o[1]) + '" style="background:' + (o[2] || o[0] || 'conic-gradient(#002A46 0 50%,#F78C16 0)') + '"></button>'; }).join('') + '</div>'; }
  function lbl(t) { return '<p class="pzs-l">' + t + '</p>'; }
  function proxy(k, tag, ph) { var o = pr && pr.querySelector('[data-p="' + k + '"]'), v = o ? o.value : ''; return tag === 'area' ? '<textarea rows="2" data-pzs-proxy="' + k + '" placeholder="' + esc(ph) + '">' + esc(v) + '</textarea>' : '<input type="number" data-pzs-proxy="' + k + '" value="' + esc(v) + '" placeholder="' + esc(ph) + '">'; }
  function groupEls(g) { var out = []; if (g) A.deck.slides.forEach(function (s) { s.els.forEach(function (x) { if (x && x.kind === 'persona' && x.data && x.data.grp === g) out.push(x); }); }); return out; }
  function member(i, g) { return g ? A.deck.slides[i].els.filter(function (x) { return x && x.kind === 'persona' && x.data && x.data.grp === g; })[0] : null; }
  function body(e) {
    var d = e.data || {}, h = '';
    if (tab === 'look') {
      h += '<div class="chips pzs-c">' + PARTS.map(function (p) { return '<button type="button" class="chip' + (p[0] === part ? ' on' : '') + '" data-pzs-part="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>';
      h += '<div class="pzs-g">' + opts(part).map(function (o) { var c = {}; c[part] = o[0]; return tile('data-pzs="' + part + '" data-v="' + esc(o[0]) + '"', o[1], mini(e, c, null, HEAD[part]), (d[part] || '') === o[0]); }).join('') + '</div>';
    } else if (tab === 'cor') {
      h += '<div class="pzs-cor"><span class="pzs-big">' + mini(e, {}, null, false) + '</span><div>' + lbl('Corpo') + sw('c1', d.c1 || '', opts('c1')) + lbl('Roupa') + sw('c2', d.c2 || '', opts('c2')) + '</div></div>';
      h += '<p class="note">Só cores da paleta A&amp;M. O círculo dividido volta às cores do personagem.' + (d.grp ? ' Vale em todos os slides em que ele aparece.' : '') + '</p>';
    } else if (tab === 'mov') {
      h += '<div class="pzs-g">' + opts('act').map(function (o) { return tile('data-pzs="act" data-v="' + o[0] + '"', o[1], mini(e, { act: o[0] }), (d.act || 'acenar') === o[0]); }).join('') + '</div>';
      h += lbl('Quando se move') + chips('trig', d.trig || 'in');
      if ((d.trig || 'in') !== 'click') h += lbl('Gesto ao clicar') + chips('act2', d.act2 || 'pular'); /* S38: em todos os gatilhos (em laço entra na virada do ciclo) */
      h += '<label class="pzs-row">Andar até o X ' + proxy('data.walk', 'num', 'fica') + '</label><button type="button" class="btnw pri" data-pzs="pv">▶ Ver no slide</button>';
    } else if (tab === 'fala') {
      h += lbl('Balão') + chips('bubble', d.bubble || 'fala') + proxy('data.say', 'area', 'O que ele diz') + lbl('Cor do balão') + sw('bcol', d.bcol || 'branco', Object.keys(P.BCOLS).map(function (k) { return [k, P.BCOLS[k][0], P.BCOLS[k][1]]; }));
      h += lbl('Ao clicar') + proxy('data.say2', 'area', 'Fala depois do clique (opcional)') + chips('mood2', d.mood2 || '');
    } else {
      var n = A.deck.slides.length, ln = '<select data-pzs-proxy="data.link"><option value="">Fica no mesmo slide</option>';
      for (var i = 1; i <= n; i++) ln += '<option value="' + i + '"' + (+d.link === i ? ' selected' : '') + '>Ir para o slide ' + i + '</option>';
      if (+d.link > n) ln += '<option value="' + (+d.link) + '" selected>Slide ' + (+d.link) + ' (não existe: fica no mesmo)</option>';
      var am = pr && pr.querySelector('select[data-p="data.aim"]');
      h += lbl('Aponta para') + '<select data-pzs-proxy="data.aim">' + (am ? am.innerHTML : '') + '</select>' + lbl('Ao clicar nele') + ln + '</select>';
      h += lbl('Aparece nos slides') + '<div class="chips pzs-c">' + A.deck.slides.map(function (s, k) { var on = k === A.cur || !!member(k, d.grp); return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-pzs-slide="' + k + '"' + (k === A.cur ? ' disabled' : '') + ' aria-pressed="' + on + '">' + (k + 1) + '</button>'; }).join('') + '</div>';
      h += '<p class="note">Marque os slides em que ele continua: na apresentação ele sai de onde estava no slide anterior e anda até o novo lugar. Roupa e cores valem para todos.</p>';
    }
    return h;
  }
  function studio(e) {
    return '<div class="pzs"><div class="pzs-hd"><b>Elenco</b><button type="button" class="chip" data-pzs="rnd" title="Sorteia roupa, chapéu, cabelo, óculos, ferramenta, expressão e cores da paleta A&amp;M">🎲 Surpresa</button></div>' +
      '<div class="pzs-g pzs-g5">' + P.PRESETS.map(function (p) { var c = {}; LOOK.concat('mood').forEach(function (k) { c[k] = ''; }); return tile('data-var="' + p[0] + '"', p[1], mini(e, c, p[0], true), p[0] === (e.variant || 'eng')); }).join('') + '</div>' +
      '<div class="pzs-tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-pzs-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '"' + (t[0] === tab ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="pzs-body">' + body(e) + '</div></div>';
  }
  function inject() {
    var e = selEl(); if (!pr || !e || e.kind !== 'persona' || pr.querySelector('.pzs')) return;
    var secs = Array.prototype.slice.call(pr.querySelectorAll('.sec')), find = function (t) { return secs.filter(function (x) { var h = x.querySelector('h3'); return h && h.textContent === t; })[0]; };
    var per = find(F.vtitle), con = find('Conteúdo'), ch = per && per.querySelector('.chips'); if (!ch) return;
    ch.insertAdjacentHTML('beforebegin', studio(e)); ch.remove(); back();
    if (con) { var dt = document.createElement('details'); dt.className = 'pzs-fine'; dt.open = fine; dt.innerHTML = '<summary>Ajustes finos (todos os campos)</summary>'; while (con.children.length > 1) dt.appendChild(con.children[1]); con.appendChild(dt); dt.addEventListener('toggle', function () { fine = dt.open; }); }
  }
  function rebuild() { var e = selEl(), o = pr && pr.querySelector('.pzs'); keep(); if (e && o) { o.insertAdjacentHTML('afterend', studio(e)); o.remove(); back(); } }
  function slidesOf(list) { var out = []; A.deck.slides.forEach(function (s, i) { if (list.some(function (x) { return s.els.indexOf(x) >= 0; })) out.push(i); }); return out; }
  /* S38: o foco volta ao botão equivalente depois de redesenhar (teclado: Tab/Enter seguem do mesmo lugar) */
  var focusKey = null;
  function keyOf(n) { if (!n || !n.closest || !n.closest('.pzs')) return null; var a = ['data-var', 'data-pzs', 'data-v', 'data-pzs-tab', 'data-pzs-part', 'data-pzs-slide', 'data-pzs-proxy'].filter(function (k) { return n.hasAttribute(k); }); return a.length ? a.map(function (k) { return '[' + k + '="' + String(n.getAttribute(k)).replace(/["\\]/g, '\\$&') + '"]'; }).join('') : null; }
  function keep() { focusKey = keyOf(document.activeElement) || focusKey; }
  function back() { if (!focusKey || !pr) return; var n = pr.querySelector('.pzs ' + focusKey); focusKey = null; if (n && n.focus) n.focus({ preventScroll: true }); }
  function apply(e, ch) { /* peças e cores: o grupo inteiro; o resto: só este */
    var all = e.data.grp ? groupEls(e.data.grp) : [e]; Object.keys(ch).forEach(function (k) { (LOOK.indexOf(k) >= 0 ? all : [e]).forEach(function (x) { x.data[k] = ch[k]; }); });
    keep(); A.commit(); A.refresh(e, all.length > 1 ? slidesOf(all) : []);
  }
  function toggleSlide(e, i) { /* o mesmo personagem (data.grp) no slide i: tira a cópia ou põe uma (sem entrada, sem alvo, sem caminhada própria) */
    var g = e.data.grp, m = member(i, g), s = A.deck.slides[i]; if (!s || i === A.cur) return;
    if (m && m.lock) { A.toast('O personagem do slide ' + (i + 1) + ' está bloqueado: desbloqueie para tirá-lo de lá.'); return; }
    if (m) { s.els.splice(s.els.indexOf(m), 1); if (groupEls(g).length < 2) e.data.grp = ''; }
    else { if (!g) g = e.data.grp = 'g' + A.uid(); var c = A.clone(e); c.id = A.uid(); delete c.lock; c.data.aim = ''; c.data.walk = ''; c.anim = Object.assign({}, c.anim || {}, { in: 'none', delay: 0 }); s.els.push(c); }
    keep(); A.commit(); A.refresh(e, [i]); A.toast(m ? 'Personagem retirado do slide ' + (i + 1) + '.' : 'Personagem no slide ' + (i + 1) + ': na apresentação ele anda até lá. Mova-o no slide para escolher onde ele para.');
  }
  F.onCopy = function (el) { if (el.data) el.data.grp = ''; }; /* duplicar/colar um personagem do grupo cria outro personagem, solto (duplicar o slide mantém o grupo) */
  if (pr) {
    if (window.MutationObserver) new MutationObserver(inject).observe(pr, { childList: true });
    pr.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-var],[data-pzs],[data-pzs-tab],[data-pzs-part],[data-pzs-slide]'), e = selEl(); if (!b || !pr.contains(b) || !e || e.kind !== 'persona' || !b.closest('.pzs')) return; focusKey = keyOf(b);
      if (b.dataset.var) { var all = e.data.grp ? groupEls(e.data.grp) : [e]; all.forEach(function (x) { if (x !== e) x.variant = b.dataset.var; LOOK.forEach(function (k) { x.data[k] = ''; }); }); e.data.mood = ''; if (all.length > 1) setTimeout(function () { A.refresh(null, slidesOf(all)); }, 0); return; } /* o editor troca a variante, grava (um passo de desfazer) e abre a prévia; aqui só as miniaturas dos outros slides */
      if (b.dataset.pzsTab) { tab = b.dataset.pzsTab; rebuild(); return; }
      if (b.dataset.pzsPart) { part = b.dataset.pzsPart; rebuild(); return; }
      if (b.dataset.pzsSlide) { toggleSlide(e, +b.dataset.pzsSlide); return; }
      var k = b.dataset.pzs, ch = {};
      if (k === 'pv') { A.previewEl(); return; }
      if (k === 'rnd') { ['outfit', 'hat', 'hair', 'glasses', 'tool', 'c1', 'c2', 'mood'].forEach(function (q) { var l = opts(q).filter(function (o) { return o[0]; }); ch[q] = l[Math.floor(Math.random() * l.length)][0]; }); }
      else ch[k] = b.dataset.v;
      apply(e, ch);
    }, true);
    /* campos espelhados (fala, “andar até”, alvo, ir para o slide): o valor vai para o campo original, que segue o caminho de sempre (desfazer, efeitos recusados) */
    var fwd = function (ev) { var t = ev.target, k = t.dataset && t.dataset.pzsProxy, o = k && pr.querySelector('[data-p="' + k + '"]'); if (!o) return; ev.stopPropagation(); o.value = t.value; o.dispatchEvent(new Event(ev.type, { bubbles: true })); };
    pr.addEventListener('input', fwd, true); pr.addEventListener('change', fwd, true);
    /* peça ou cor trocada em “Ajustes finos”: vale para o grupo, no mesmo passo de desfazer (antes do commit do editor) */
    pr.addEventListener('change', function (ev) { var k = ev.target.dataset && (ev.target.dataset.p || '').replace(/^data\./, ''), e = selEl(); if (!e || e.kind !== 'persona' || !e.data.grp || LOOK.indexOf(k) < 0) return; var all = groupEls(e.data.grp); all.forEach(function (x) { x.data[k] = e.data[k]; }); setTimeout(function () { A.refresh(null, slidesOf(all)); }, 0); }, true);
  }
  window.AMPersonas = { reaim: reaim, aimOpts: aimOpts, groupEls: groupEls };
})();
