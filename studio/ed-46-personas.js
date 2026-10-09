/* ===== ed-46-personas.js — Personagens A&M (S35; só no editor) =====
   · “Aponta para”: o campo do painel (data.aim) vira um seletor com os elementos do slide atual (nome do tipo + começo do texto),
     montado na hora em que o painel é desenhado (getter sobre FX.persona.fields; no runtime o campo continua estático).
   · Mira ao vivo: depois de arrastar/redimensionar/mover com as setas (pointerup, keyup) ou editar X/Y no painel (input), o braço
     que aponta e o lado para onde o personagem olha são recalculados no palco (AMRT.personas.aimStage) sem redesenhar nada. */
(function () {
  'use strict';
  var A = window.AMStudio, RT = window.AMRT; if (!A || !RT || !RT.FX || !RT.FX.persona || !RT.personas) return;
  var F = RT.FX.persona, BASE = F.fields.slice();
  function nameOf(e) {
    var base = e.type === 'fx' ? (RT.fxLabel ? RT.fxLabel(e) : 'Componente') : e.type === 'image' ? 'Imagem' : e.type === 'shape' ? 'Forma' : e.type === 'text' ? 'Texto' : 'Elemento';
    var t = (e.type === 'text' || e.type === 'shape') && RT.plain ? RT.plain(e.html).replace(/\s+/g, ' ').trim() : '';
    if (!t && e.type === 'fx' && e.data) t = String(e.data.title || e.data.label || e.data.say || '').replace(/\s+/g, ' ').trim();
    return (t ? base + ' “' + (t.length > 26 ? t.slice(0, 25) + '…' : t) + '”' : base).replace(/[|=]/g, ' ');
  }
  function aimOpts() {
    var s = A.deck && A.deck.slides[A.cur], sel = A.selected(), me = sel.length === 1 ? sel[0] : null, out = ['=Nenhum'];
    ((s && s.els) || []).forEach(function (e) { if (!e || e.id === me || e.type === 'line') return; out.push(e.id + '=' + nameOf(e)); });
    return 'sel:' + out.join('|');
  }
  Object.defineProperty(F, 'fields', { configurable: true, enumerable: true, get: function () { return BASE.map(function (f) { return f[0] === 'aim' ? ['aim', f[1], aimOpts()] : f; }); } });
  var t = 0;
  function reaim() { clearTimeout(t); t = setTimeout(function () { var st = document.querySelector('#wrap .am-stage'); if (st && st.querySelector('.pz[data-aim]')) RT.personas.aimStage(st); }, 0); }
  document.addEventListener('pointerup', reaim, true);
  document.addEventListener('keyup', function (e) { if (/^Arrow/.test(e.key)) reaim(); }, true);
  var pr = document.getElementById('props'); if (pr) pr.addEventListener('input', reaim);
  window.AMPersonas = { reaim: reaim, aimOpts: aimOpts };
})();
