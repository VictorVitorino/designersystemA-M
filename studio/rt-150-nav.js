/* rt-150-nav.js — S15: linha do tempo de seções (rail), índice de slides (G) e “Sobre este slide” (I) no player.
   Vale para “Apresentar” no editor e para o arquivo HTML salvo (o runtime e os rt-*.js vão juntos no export).
   Regras: texto do usuário só via textContent; nenhum manipulador inline; hooks e listeners de documento/janela removidos no destroy. */
(function (R) { 'use strict';
  function pad(n) { return String(n).padStart(2, '0'); }
  function h(tag, cls, attrs) { var n = document.createElement(tag); if (cls) n.className = cls; if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function noFocus(el) { el.addEventListener('mousedown', function (e) { e.preventDefault(); }); }
  function hash(t) { var x = 5381; t = String(t); for (var i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) | 0; return (x >>> 0).toString(36) + '.' + t.length; }
  function blurIn(box) { var a = document.activeElement; if (a && box.contains(a) && a.blur) a.blur(); }
  var INFO_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';
  var HINT = 'I abre e fecha · Esc fecha', HINT_ED = 'Ctrl+Enter ou clique fora salva · Esc cancela';

  R.hooks.player.push(function (hd) {
    var wrap = hd.root, deck = hd.deck, slides = deck.slides || [], N = slides.length;
    if (!N) return;
    var SECS = R.sectionsOf(deck), secs = SECS.list;
    var bar = wrap.querySelector('.amp-bar'), posBtn = wrap.querySelector('.amp-pos'), cBox = wrap.querySelector('.amp-c');
    if (!bar || !posBtn || !cBox) return;
    var kills = [];
    function on(t, ev, f, o) { t.addEventListener(ev, f, o); kills.push(function () { t.removeEventListener(ev, f, o); }); }
    function cur() { return Math.max(0, hd.cur()); }

    /* ---------- linha do tempo (rail): um botão por capítulo, com progresso dentro do capítulo ---------- */
    var railBtns = [];
    if (secs.length >= 2) {
      var rail = h('nav', 'amp-rail', { 'aria-label': 'Linha do tempo da apresentação' });
      secs.forEach(function (sc, n) {
        var a = sc.idx[0] + 1, z = sc.idx[sc.idx.length - 1] + 1, rng = a === z ? 'slide ' + a : 'slides ' + a + '–' + z;
        var b = h('button', 'amp-rs', { type: 'button', 'data-sec': String(n), title: sc.name + ' · ' + rng, 'aria-label': sc.name + ', ' + rng });
        b.style.flex = sc.idx.length + ' 1 0';
        var l = h('span', 'amp-rs-l'); l.textContent = sc.name; b.appendChild(l);
        var t = h('i', 'amp-rs-t'); t.appendChild(h('b')); b.appendChild(t);
        noFocus(b);
        b.addEventListener('click', function () { setIdx(false); hd.go(sc.idx[0]); });
        rail.appendChild(b); railBtns.push(b);
      });
      wrap.insertBefore(rail, bar); wrap.classList.add('has-rail');
      /* rótulo some só quando o segmento fica estreito demais para ler (o ativo, o focado e o sob o mouse continuam com nome) */
      var tight = function () { railBtns.forEach(function (b) { b.classList.toggle('tight', b.getBoundingClientRect().width < 64); }); };
      tight(); on(window, 'resize', tight);
    }
    function railSync(i) {
      secs.forEach(function (sc, n) {
        var b = railBtns[n]; if (!b) return;
        var k = sc.idx.indexOf(i), last = sc.idx[sc.idx.length - 1];
        b.classList.toggle('on', k >= 0);
        if (k >= 0) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        b.querySelector('b').style.width = (k < 0 ? (i > last ? 100 : 0) : (k + 1) / sc.idx.length * 100) + '%';
      });
    }

    /* ---------- índice (G): o contador vira botão; lista agrupada por capítulo, cada item leva ao slide ---------- */
    var idx = h('div', 'amp-pop amp-idx', { role: 'dialog', 'aria-label': 'Índice da apresentação' });
    var ih = h('div', 'amp-pop-h'), ihs = h('span'); ihs.textContent = 'Índice · ' + N + (N === 1 ? ' slide' : ' slides'); ih.appendChild(ihs);
    var ix = h('button', 'amp-pop-x', { type: 'button', 'aria-label': 'Fechar índice' }); ix.textContent = '×'; ih.appendChild(ix); idx.appendChild(ih);
    var il = h('div', 'amp-idx-l'); idx.appendChild(il);
    var items = [];
    function addItem(i) {
      var b = h('button', 'amp-idx-i', { type: 'button', 'data-i': String(i) }), nb = h('b'), sp = h('span'), tt = R.slideTitle(slides[i], i);
      nb.textContent = pad(i + 1); sp.textContent = tt; b.title = tt; b.appendChild(nb); b.appendChild(sp);
      noFocus(b); b.addEventListener('click', function () { setIdx(false); hd.go(i); });
      il.appendChild(b); items[i] = b;
    }
    if (secs.length) secs.forEach(function (sc) { var g = h('div', 'amp-idx-g'); g.textContent = sc.num ? 'Parte ' + sc.num + ' · ' + sc.name : sc.name; g.title = g.textContent; il.appendChild(g); sc.idx.forEach(addItem); });
    else slides.forEach(function (s, i) { addItem(i); });
    wrap.appendChild(idx);
    noFocus(ih);
    var idxOpen = false, idxRet = null;
    function markIdx(i) { items.forEach(function (b, k) { if (k === i) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); }
    function setIdx(v) {
      if (v === idxOpen) return;
      if (v) idxRet = document.activeElement === posBtn ? posBtn : null; /* foco volta ao contador só se foi o teclado que o abriu dali */
      idxOpen = v; idx.classList.toggle('on', v); posBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) { setNote(false); var c = cur(); markIdx(c); var a = items[c]; if (a) { a.scrollIntoView({ block: 'center' }); a.focus(); } }
      else if (idx.contains(document.activeElement) || document.activeElement === posBtn) { if (idxRet) idxRet.focus(); else blurIn(wrap); }
    }
    posBtn.addEventListener('click', function (e) { e.stopPropagation(); setIdx(!idxOpen); });
    noFocus(ix); ix.addEventListener('click', function () { setIdx(false); });
    idx.addEventListener('focusout', function (e) { var to = e.relatedTarget; if (idxOpen && to && !idx.contains(to) && to !== posBtn) setIdx(false); });

    /* ---------- “Sobre este slide” (I): resumo escrito no editor (slide.notes), senão automático; editável no player ----------
       A edição feita no player vale só enquanto o texto de origem (notes do editor ou automático) não mudar: guardamos um hash dele. */
    var NK = 'amPlayer.notes:' + (deck.id || deck.title || 'deck'), keys = [], seen = Object.create(null);
    slides.forEach(function (s, i) { var k = 's:' + ((s && s.id) || i); if (seen[k]) k += '#' + i; seen[k] = 1; keys.push(k); });
    var over = Object.create(null);
    try { var raw = JSON.parse(localStorage.getItem(NK) || '{}'); if (raw && typeof raw === 'object' && !Array.isArray(raw)) Object.keys(raw).forEach(function (k) { var o = raw[k]; if (seen[k] && o && typeof o === 'object' && typeof o.t === 'string' && o.t.trim() && typeof o.b === 'string') over[k] = { t: o.t.slice(0, 4000), b: o.b }; }); } catch (e) { }
    function saveOver() { try { if (Object.keys(over).length) localStorage.setItem(NK, JSON.stringify(over)); else localStorage.removeItem(NK); } catch (e) { } }
    var autoCache = Object.create(null);
    function baseOf(i) { var s = slides[i]; if (s.notes && String(s.notes).trim()) return { t: String(s.notes), src: 'deck' }; if (!(i in autoCache)) autoCache[i] = R.autoNotes(s, i, deck, SECS); return { t: autoCache[i], src: 'auto' }; }
    function textOf(i) {
      var b = baseOf(i), o = over[keys[i]];
      if (o) { if (o.b === hash(b.t)) return { t: o.t, src: 'user' }; delete over[keys[i]]; saveOver(); } /* a origem mudou (editor ou outra versão do arquivo): a edição antiga sai */
      return b;
    }
    var nbtn = h('button', 'amp-b amp-ic', { type: 'button', 'data-a': 'notes', 'aria-expanded': 'false', title: 'Sobre este slide (I)', 'aria-label': 'Sobre este slide (I)' });
    nbtn.innerHTML = INFO_IC + '<span class="amp-bw">Sobre este slide</span>';
    cBox.insertBefore(nbtn, cBox.firstChild);
    var note = h('div', 'amp-pop amp-note', { role: 'dialog', 'aria-label': 'Sobre este slide' });
    note.innerHTML = '<div class="amp-pop-h"><span>Sobre este slide <i class="amp-note-tag">automático</i></span><span class="amp-note-a"><button type="button" class="amp-note-ed" aria-pressed="false">Editar</button><button type="button" class="amp-pop-x" aria-label="Fechar">×</button></span></div>' +
      '<div class="amp-note-t"></div><div class="amp-note-b" aria-live="polite"></div>' +
      '<div class="amp-note-f"><button type="button" class="amp-note-rs" hidden>Restaurar original</button><span class="amp-note-k"></span></div>';
    wrap.appendChild(note);
    var nt = note.querySelector('.amp-note-t'), nbody = note.querySelector('.amp-note-b'), ntag = note.querySelector('.amp-note-tag'), ned = note.querySelector('.amp-note-ed'), nrs = note.querySelector('.amp-note-rs'), nx = note.querySelector('.amp-pop-x'), nk = note.querySelector('.amp-note-k');
    nk.textContent = HINT;
    var noteOpen = false, noteRet = null, editing = false, editIdx = -1;
    function fill(i) {
      var o = textOf(i);
      nt.textContent = R.slideTitle(slides[i], i);
      nbody.textContent = '';
      String(o.t).split(/\n/).forEach(function (ln) { ln = ln.trim(); if (!ln) return; var p = document.createElement('p'); p.textContent = ln; nbody.appendChild(p); });
      ntag.hidden = o.src !== 'auto'; nrs.hidden = o.src !== 'user';
    }
    function startEdit() {
      if (editing) return; editing = true; editIdx = cur(); /* a edição pertence ao slide em que começou, mesmo que a navegação mude o slide antes de salvar */
      nbody.textContent = textOf(editIdx).t;
      nbody.setAttribute('contenteditable', 'plaintext-only'); if (!nbody.isContentEditable) nbody.setAttribute('contenteditable', 'true');
      ned.setAttribute('aria-pressed', 'true'); ned.textContent = 'Salvar'; ntag.hidden = true; nk.textContent = HINT_ED;
      nbody.focus();
      try { var r = document.createRange(); r.selectNodeContents(nbody); r.collapse(false); var sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(r); } catch (e) { }
    }
    function endEdit(save) {
      if (!editing) return; editing = false;
      var i = editIdx, k = keys[i];
      var txt = String(nbody.innerText || nbody.textContent || '').replace(/ /g, ' ').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
      nbody.removeAttribute('contenteditable'); ned.setAttribute('aria-pressed', 'false'); ned.textContent = 'Editar'; nk.textContent = HINT;
      if (save) { var base = baseOf(i).t; if (txt && txt !== base.trim()) over[k] = { t: txt, b: hash(base) }; else delete over[k]; saveOver(); }
      fill(cur());
    }
    function setNote(v) {
      if (v === noteOpen) return;
      if (!v && editing) endEdit(true);
      if (v) noteRet = document.activeElement === nbtn ? nbtn : null;
      noteOpen = v; note.classList.toggle('on', v); nbtn.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) { setIdx(false); fill(cur()); }
      else if (note.contains(document.activeElement) || document.activeElement === nbtn) { if (noteRet) noteRet.focus(); else blurIn(wrap); }
    }
    nbtn.addEventListener('click', function (e) { e.stopPropagation(); setNote(!noteOpen); });
    noFocus(nx); nx.addEventListener('click', function () { setNote(false); });
    /* botões do painel: com o mouse não guardam o foco (Espaço segue avançando o slide); pelo teclado (Tab) o foco fica onde estava */
    noFocus(ned); ned.addEventListener('click', function () { var kb = document.activeElement === ned; if (editing) { endEdit(true); if (!kb) blurIn(wrap); } else startEdit(); });
    noFocus(nrs); nrs.addEventListener('click', function () { var kb = document.activeElement === nrs; if (editing) endEdit(false); delete over[keys[cur()]]; saveOver(); fill(cur()); if (kb) ned.focus(); else blurIn(wrap); });
    nbody.addEventListener('keydown', function (e) { /* o player ignora teclas em contentEditable; aqui só Ctrl/⌘+Enter salva e Esc cancela */
      if (!editing) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); endEdit(true); blurIn(wrap); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endEdit(false); blurIn(wrap); }
    });
    nbody.addEventListener('blur', function () { if (editing) endEdit(true); });

    /* ---------- teclado e clique fora ---------- */
    function idxFocusables() { return [ix].concat(items.filter(Boolean)); }
    function keyHook(e, h2) {
      if (h2 !== hd) return false;
      var k = e.key, ae = document.activeElement;
      if (idxOpen) {
        if (k === 'Escape' || k === 'g' || k === 'G') { e.preventDefault(); setIdx(false); return true; }
        if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
          e.preventDefault(); var fi = items.indexOf(ae), n = k === 'Home' ? 0 : k === 'End' ? N - 1 : fi < 0 ? cur() : (fi + (k === 'ArrowDown' ? 1 : -1) + N) % N;
          if (items[n]) items[n].focus(); return true;
        }
        if (k === 'Tab') { /* o foco não sai do índice enquanto ele está aberto */
          e.preventDefault(); var fs = idxFocusables(), fj = fs.indexOf(ae);
          fs[((fj < 0 ? (e.shiftKey ? 0 : -1) : fj) + (e.shiftKey ? -1 : 1) + fs.length) % fs.length].focus(); return true;
        }
        if (k === 'Enter' || k === ' ') { e.preventDefault(); var ci = items[cur()]; if (ci) ci.focus(); return true; } /* foco fora dos itens (clique no cabeçalho): nada passa para o slide de trás */
      }
      if (noteOpen && k === 'Escape') { e.preventDefault(); setNote(false); return true; }
      if (k === 'g' || k === 'G') { e.preventDefault(); setIdx(!idxOpen); return true; }
      if (k === 'i' || k === 'I') { e.preventDefault(); setNote(!noteOpen); return true; }
      return false;
    }
    function showHook(i, h2) { if (h2 !== hd) return; railSync(i); if (idxOpen) markIdx(i); if (noteOpen) { if (editing) endEdit(true); fill(i); } }
    R.hooks.key.push(keyHook); R.hooks.show.push(showHook);
    on(document, 'pointerdown', function (e) { var t = e.target; if (idxOpen && t && !idx.contains(t) && !posBtn.contains(t)) setIdx(false); }, true);
    hd.nav = { index: setIdx, notes: setNote, sections: secs, isIndexOpen: function () { return idxOpen; }, isNotesOpen: function () { return noteOpen; } };
    hd.onDestroy(function () {
      var a = R.hooks.key.indexOf(keyHook); if (a >= 0) R.hooks.key.splice(a, 1);
      var b = R.hooks.show.indexOf(showHook); if (b >= 0) R.hooks.show.splice(b, 1);
      kills.forEach(function (f) { f(); });
    });
  });
})(window.AMRT);
