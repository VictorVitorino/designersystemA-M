/* ===== “Mais cores…” (S19): seletor de cores do painel de propriedades (só no editor; não vai para o arquivo exportado) =====
   AMColorPop.open(botão, {value, title, brand, keyboard, row, onPick(cor, viaTeclado), onLive(cor), onCancel(houvePrevia), onClose(viaTeclado)})
   Popover fixo (position: fixed, preso dentro da janela) com: Cores A&M · Mais cores (paleta ampliada, 6 famílias × 8 tons, claro → escuro)
   · Recentes (8 últimas cores personalizadas, localStorage 'amStudio.recentColors') · Personalizada (#RRGGBB, seletor do sistema e
   conta-gotas quando o navegador tem EyeDropper). Não usa #modal (ARCH regra 15): as teclas ficam dentro do popover (stopPropagation).
   Esc fecha e devolve o foco ao botão; clique fora fecha; setas andam entre as amostras; Tab circula dentro do popover.
   F5 / F1 / Ctrl+S / Ctrl+O fecham o popover e seguem para o editor (apresentar, ajuda, salvar, abrir); Ctrl+P/D/A são engolidos.
   Sem espaço acima nem abaixo do botão, abre ao lado (à esquerda), sem cobrir o botão. */
window.AMColorPop = (function () {
  'use strict';
  var EXT = [
    ['Azuis', ['#E8F0FA', '#C6DBF2', '#9CC1E8', '#6BA3DC', '#3B82C4', '#1F66A8', '#154C80', '#0B2F55']],
    ['Verdes e petróleo', ['#E7F5EC', '#C5E8D1', '#98D5AE', '#5DBB82', '#34A05E', '#1F8048', '#156038', '#0C4127']],
    ['Vermelhos e rosas', ['#FDECEE', '#F8C8CE', '#F09AA5', '#E4677A', '#D23F55', '#B02A3E', '#8A1F2F', '#5E141F']],
    ['Laranjas e amarelos', ['#FFF6DB', '#FFE7A3', '#FFD166', '#FDB833', '#F78C16', '#D96F0B', '#B05408', '#7A3A06']],
    ['Roxos', ['#F1ECF8', '#DCD0EE', '#BFA9DF', '#9C7FCB', '#7B5BB3', '#613F99', '#4A2E7A', '#321E55']],
    ['Cinzas e neutros', ['#F2F3F5', '#D9DCE1', '#B8BDC6', '#9097A3', '#6A717D', '#4A505A', '#2D3138', '#000000']]
  ];
  var KEY = 'amStudio.recentColors', HEX = /^#[0-9a-f]{6}$/i, BRAND = ['#002A46', '#001E32', '#13315C', '#43698F', '#4A6FA5', '#7EA1C3', '#A3B8D6', '#E3EAF2', '#EBEEF1', '#FFFFFF', '#F78C16', '#3E4C5E', '#6B7A90'];
  var pop = null, st = null, lastClose = { a: null, t: 0 };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* '#abc', 'abc', '#AABBCC', ' #aabbcc ', 'rgb(170, 187, 204)' → '#AABBCC'; qualquer outra coisa → null (código colado de um
     documento ou e-mail costuma vir com espaços) */
  function norm(v) {
    v = String(v == null ? '' : v).replace(/\s+/g, '');
    var m = /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,[\d.]+%?)?\)$/i.exec(v);
    if (m && +m[1] < 256 && +m[2] < 256 && +m[3] < 256) v = '#' + [m[1], m[2], m[3]].map(function (x) { return (+x < 16 ? '0' : '') + (+x).toString(16); }).join('');
    if (v && v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return HEX.test(v) ? v.toUpperCase() : null;
  }
  function recent() {
    var a; try { a = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { a = []; }
    var out = []; (Array.isArray(a) ? a : []).forEach(function (c) { c = norm(c); if (c && out.indexOf(c) < 0) out.push(c); });
    return out.slice(0, 8);
  }
  function pushRecent(c, brand) {
    if ((brand || BRAND).indexOf(c) >= 0) return; /* recentes = cores personalizadas (fora da paleta A&M) */
    try { var a = recent().filter(function (x) { return x !== c; }); a.unshift(c); localStorage.setItem(KEY, JSON.stringify(a.slice(0, 8))); } catch (e) { }
  }
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5l4 4M17 3l4 4-3 3-4-4z"/><path d="M14 8l-9 9-1 4 4-1 9-9"/></svg>';
  function sw(c, cur, name) {
    var on = c === cur;
    return '<button type="button" class="cp-s' + (on ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" title="' + esc((name ? name + ' · ' : '') + c) + '" aria-label="' + esc((name ? name + ' ' : '') + c) + '" aria-pressed="' + on + '"></button>';
  }
  function build(o) {
    var cur = norm(o.value), brand = (o.brand || BRAND).map(norm).filter(Boolean), rec = recent();
    var h = '<div class="cp-hd"><b>Mais cores</b>' + (o.title ? '<span>' + esc(o.title) + '</span>' : '') + '<button type="button" class="cp-x" title="Fechar (Esc)" aria-label="Fechar">×</button></div>';
    var kit = o.kit && Array.isArray(o.kit.colors) ? o.kit.colors.map(norm).filter(Boolean) : []; /* S29: cores do kit de marca da obra */
    if (kit.length) h += '<div class="cp-sec cp-kit"><h4>' + esc(o.kit.title || 'Cores da marca') + '</h4><div class="cp-g">' + kit.map(function (c) { return sw(c, cur); }).join('') + '</div></div>';
    h += '<div class="cp-sec"><h4>Cores A&amp;M</h4><div class="cp-g">' + brand.map(function (c) { return sw(c, cur); }).join('') + '</div></div>';
    h += '<div class="cp-sec"><h4>Mais cores</h4><div class="cp-g cp-ext">' + EXT.map(function (r) { return r[1].map(function (c) { return sw(c, cur, r[0]); }).join(''); }).join('') + '</div></div>';
    h += '<div class="cp-sec cp-rec"><h4>Recentes</h4>' + (rec.length ? '<div class="cp-g">' + rec.map(function (c) { return sw(c, cur); }).join('') + '</div>' : '<p class="cp-empty">As cores personalizadas que você usar aparecem aqui.</p>') + '</div>';
    h += '<div class="cp-sec"><h4>Personalizada</h4><div class="cp-cu"><input type="text" class="cp-hex" maxlength="40" spellcheck="false" autocomplete="off" placeholder="#RRGGBB" aria-label="Código da cor (#RRGGBB)" value="' + (cur || '') + '">' +
      '<button type="button" class="cp-ok" title="Aplicar a cor digitada (Enter)">Aplicar</button>' +
      '<input type="color" class="cp-nat" value="' + (cur || '#002A46').toLowerCase() + '" title="Seletor de cores do sistema" aria-label="Seletor de cores do sistema">' +
      (window.EyeDropper ? '<button type="button" class="cp-eye" title="Conta-gotas: pegar uma cor da tela" aria-label="Conta-gotas">' + EYE + '</button>' : '') +
      '</div><p class="cp-err" hidden>Use o formato #RRGGBB (ex.: #1F66A8).</p></div>';
    return h;
  }
  function place() {
    if (!pop || !st) return;
    var m = 8, vw = window.innerWidth, vh = window.innerHeight, r = st.anchor.isConnected ? st.anchor.getBoundingClientRect() : st.rect;
    var rw = st.o.row && st.o.row.isConnected ? st.o.row.getBoundingClientRect() : r;
    pop.style.maxHeight = (vh - m * 2) + 'px';
    var pw = pop.offsetWidth, ph = pop.offsetHeight, left = Math.max(m, Math.min(r.right - pw, vw - pw - m)), top, side;
    if (r.bottom + 6 + ph <= vh - m) { top = r.bottom + 6; side = 'below'; }
    else if (r.top - 6 - ph >= m) { top = r.top - 6 - ph; side = 'above'; }
    else if (Math.min(r.left, rw.left) - 8 - pw >= m) { left = Math.min(r.left, rw.left) - 8 - pw; top = Math.max(m, Math.min(r.top + r.height / 2 - ph / 2, vh - ph - m)); side = 'left'; } /* sem espaço em cima nem embaixo: ao lado (sobre o quadro), sem cobrir o botão nem a linha dele (o.row) */
    else { /* janela estreita: no lado maior, mais baixo e com rolagem interna */
      var up = r.top - 6 - m, dn = vh - m - r.bottom - 6; pop.style.maxHeight = Math.max(120, Math.max(up, dn)) + 'px'; ph = pop.offsetHeight;
      if (dn >= up) { top = r.bottom + 6; side = 'below'; } else { top = Math.max(m, r.top - 6 - ph); side = 'above'; }
    }
    pop.style.left = Math.round(left) + 'px'; pop.style.top = Math.round(top) + 'px';
    pop.dataset.side = side;
  }
  function swatches() { return Array.prototype.slice.call(pop.querySelectorAll('.cp-s')); }
  function focusables() { return Array.prototype.slice.call(pop.querySelectorAll('button,input')).filter(function (x) { return !x.disabled && x.offsetParent !== null; }); }
  /* setas: a amostra vizinha na direção (mesma linha para ←/→; a mais próxima na linha de cima/baixo para ↑/↓, atravessando seções) */
  function move(from, k) {
    var L = swatches(), i = L.indexOf(from); if (i < 0) return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') { var j = i + (k === 'ArrowRight' ? 1 : -1); if (L[j]) L[j].focus(); return; }
    var a = from.getBoundingClientRect(), ax = a.left + a.width / 2, best = null, bs = 1e9;
    L.forEach(function (b) {
      if (b === from) return; var r = b.getBoundingClientRect(), dy = k === 'ArrowDown' ? r.top - a.bottom : a.top - r.bottom; if (dy < -2) return;
      var sc = dy * 1000 + Math.abs(r.left + r.width / 2 - ax); if (sc < bs) { bs = sc; best = b; }
    });
    if (best) best.focus();
  }
  function hexState(show) {
    var inp = pop.querySelector('.cp-hex'), c = norm(inp.value), bad = !c && (show || inp.classList.contains('bad'));
    inp.classList.toggle('bad', !!bad); inp.setAttribute('aria-invalid', bad ? 'true' : 'false');
    pop.querySelector('.cp-err').hidden = !bad;
    if (c) pop.querySelector('.cp-nat').value = c.toLowerCase();
    return c;
  }
  function pick(c, viaKey) {
    c = norm(c); if (!c || !st) return;
    var o = st.o; pushRecent(c, (o.brand || BRAND).map(norm).concat(o.kit && Array.isArray(o.kit.colors) ? o.kit.colors.map(norm) : [])); teardown();
    if (o.onPick) o.onPick(c, !!viaKey);
  }
  function close(viaKey) {
    if (!st) return;
    var o = st.o, live = st.live; teardown();
    if (live && o.onCancel) o.onCancel(true);
    if (o.onClose) o.onClose(!!viaKey);
  }
  function teardown() {
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onWinKey, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('scroll', onScroll, true);
    if (st && st.anchor) st.anchor.setAttribute('aria-expanded', 'false');
    if (pop) pop.remove(); pop = null; st = null;
  }
  function onDown(e) { if (!pop || pop.contains(e.target)) return; if (st.anchor.contains(e.target)) lastClose = { a: st.anchor, t: Date.now() }; close(false); }
  function onWinKey(e) { if (e.key === 'Escape' && pop && !pop.contains(e.target)) { e.preventDefault(); e.stopPropagation(); close(true); } }
  function onResize() { close(false); }
  /* rolagem do painel: o popover acompanha o botão; se o botão sair da área visível (ou do documento), fecha */
  function onScroll(e) {
    if (!pop || pop.contains(e.target)) return;
    var a = st.anchor; if (!a.isConnected) { close(false); return; }
    var r = a.getBoundingClientRect(), box = e.target && e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    if (r.bottom < box.top || r.top > box.bottom || r.bottom < 0 || r.top > window.innerHeight) { close(false); return; }
    place();
  }
  function open(anchor, o) {
    if (st && st.anchor === anchor) { close(false); return; }
    if (lastClose.a === anchor && Date.now() - lastClose.t < 350) return; /* clique no próprio botão com o seletor aberto: só fecha */
    if (st) close(false);
    o = o || {};
    pop = document.createElement('div'); pop.className = 'cpop'; pop.tabIndex = -1; /* clique no fundo do popover mantém o foco dentro dele */ pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Mais cores' + (o.title ? ' · ' + o.title : ''));
    pop.innerHTML = build(o); document.body.appendChild(pop);
    st = { anchor: anchor, rect: anchor.getBoundingClientRect(), o: o, live: false };
    anchor.setAttribute('aria-expanded', 'true');
    place();
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('cp-s')) { pick(b.dataset.c, !e.detail); return; }
      if (b.classList.contains('cp-x')) { close(!e.detail); return; }
      if (b.classList.contains('cp-ok')) { var c = hexState(true); if (c) pick(c, !e.detail); else pop.querySelector('.cp-hex').focus(); return; }
      if (b.classList.contains('cp-eye') && window.EyeDropper) {
        try { new window.EyeDropper().open().then(function (r) { var c = norm(r && r.sRGBHex); if (c && st) pick(c, false); }).catch(function () { }); } catch (er) { }
      }
    });
    pop.addEventListener('input', function (e) {
      var t = e.target;
      if (t.classList.contains('cp-hex')) { hexState(false); return; }
      if (t.classList.contains('cp-nat')) { var c = norm(t.value); if (!c) return; pop.querySelector('.cp-hex').value = c; hexState(false); st.live = true; if (st.o.onLive) st.o.onLive(c); }
    });
    pop.addEventListener('change', function (e) { if (e.target.classList.contains('cp-nat')) pick(e.target.value, false); });
    pop.addEventListener('keydown', function (e) {
      var t = e.target, k = e.key, mod = (e.ctrlKey || e.metaKey) && !e.altKey, lk = String(k || '').toLowerCase();
      /* atalhos do editor (F5 apresentar, F1 ajuda, Ctrl+S salvar, Ctrl+O abrir): o seletor fecha (sem gravar a prévia) e a tecla segue
         para o editor, como fora do popover — nunca para o navegador (recarregar, "Salvar página como", ajuda do Chrome) */
      if (k === 'F5' || k === 'F1' || (mod && (lk === 's' || lk === 'o'))) { e.preventDefault(); close(false); return; }
      e.stopPropagation(); /* as demais teclas do seletor não chegam ao editor (setas não movem o elemento, Delete não apaga) */
      if (mod && (lk === 'p' || lk === 'd' || (lk === 'a' && !t.classList.contains('cp-hex')))) { e.preventDefault(); return; } /* imprimir / favoritos / selecionar a página: engolidos */
      if (k === 'Escape') { e.preventDefault(); close(true); return; }
      if (k === 'Tab') {
        var F = focusables(), i = F.indexOf(t); if (!F.length) return; e.preventDefault();
        F[(i + (e.shiftKey ? -1 : 1) + F.length) % F.length].focus(); return;
      }
      if (t.classList.contains('cp-hex') && k === 'Enter') { e.preventDefault(); var c = hexState(true); if (c) pick(c, true); return; }
      if (t.classList.contains('cp-s') && /^Arrow(Left|Right|Up|Down)$/.test(k)) { e.preventDefault(); move(t, k); return; }
      if (t.classList.contains('cp-s') && (k === 'Home' || k === 'End')) { e.preventDefault(); var L = swatches(); (k === 'Home' ? L[0] : L[L.length - 1]).focus(); }
    });
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onWinKey, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);
    var f = pop.querySelector('.cp-s.on') || pop.querySelector('.cp-s');
    if (f) f.focus({ preventScroll: true });
  }
  return { open: open, close: function () { close(false); }, isOpen: function () { return !!pop; }, el: function () { return pop; }, recent: recent, norm: norm, EXT: EXT };
})();
