/* ===== ed-46-personas.js — Personagens A&M (S35; só no editor) =====
   · “Aponta para”: o campo do painel (data.aim) vira um seletor com os elementos do slide atual (nome do tipo + começo do texto),
     montado na hora em que o painel é desenhado (getter sobre FX.persona.fields; no runtime o campo continua estático).
   · Mira ao vivo: depois de arrastar/redimensionar/mover com as setas (pointerup, keyup) ou editar X/Y no painel (input), o braço
     que aponta e o lado para onde o personagem olha são recalculados no palco (AMRT.personas.aimStage) sem redesenhar nada.
   · Faixa de ferramentas › Marca ▾: seção “Personagens A&M” com os 10 do elenco e o balão de fala (o mesmo que Inserir › Personagens ▸). */
(function () {
  'use strict';
  var A = window.AMStudio, RT = window.AMRT; if (!A || !RT || !RT.FX || !RT.FX.persona || !RT.personas) return;
  var F = RT.FX.persona, BASE = F.fields.slice();
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
  window.AMPersonas = { reaim: reaim, aimOpts: aimOpts };
})();
