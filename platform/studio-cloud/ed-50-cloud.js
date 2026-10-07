/* ===== ed-50-cloud.js — Canteiro online: extensão de nuvem do editor =====
   Só age quando window.AM_CLOUD existe (definido pelo script de boot que o build acrescenta, a partir de /editor/<uuid> ou /visualizar/<uuid>).
   Sem AM_CLOUD este arquivo não faz NADA e o editor se comporta como o original (modo inerte).
   Depende de: AMStudio, AMRT, AMCloudCore (ed-49-cloud-core.js) e dos eventos 'am:commit' / 'am:load' (patches.json).
   Partes: API (cookies + CSRF + refresh) · estado e pílula · caixas de diálogo · carregar (hidratar) · autosave com fila local (IndexedDB)
   · conflito 409 · histórico · modo visualizar · ponte de interações · atalhos (Ctrl+S) e navegação (início → acervo). */
(function () {
  'use strict';
  var CFG = window.AM_CLOUD;
  if (!CFG) return;
  var S = window.AMStudio, RT = window.AMRT, CC = window.AMCloudCore;
  if (!S || !RT || !CC) { try { console.error('Canteiro online: editor ou cloud-core ausente'); } catch (e) { } return; }

  var ID = String(CFG.presentationId), VIEW = CFG.mode === 'view', API = String(CFG.apiBase || '/api').replace(/\/$/, '');
  var DEBOUNCE = 3000, THUMB_EVERY = 60000, MAX_UP = 3.6 * 1024 * 1024;

  /* ---------------------------------------------------------------- utilidades */
  function $(s, r) { return (r || document).querySelector(s); }
  function h(tag, a, kids) {
    var e = document.createElement(tag);
    if (a) for (var k in a) {
      var v = a[k]; if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { d = d instanceof Date ? d : new Date(d); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function when(iso) {
    var d = new Date(iso), n = new Date(); if (isNaN(d)) return '';
    var same = d.toDateString() === n.toDateString();
    return (same ? 'hoje' : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + (d.getFullYear() !== n.getFullYear() ? '/' + d.getFullYear() : '')) + ' às ' + hhmm(d);
  }
  function toast(m) { try { S.toast(m); } catch (e) { } }
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function goEditor(id) { if (!UUID.test(String(id))) throw new Error('resposta inesperada do servidor'); A.allowLeave = true; location.assign('/editor/' + String(id).toLowerCase()); }
  function ApiError(status, code, message, details, network) { this.status = status; this.code = code; this.message = message; this.details = details || null; this.network = !!network; }
  ApiError.prototype = Object.create(Error.prototype);
  function liveSay(msg) { var l = $('#cloudLive'); if (l) l.textContent = msg; }

  /* ---------------------------------------------------------------- API (cookies HttpOnly + CSRF; o navegador nunca vê token de sessão) */
  var csrfCache = null, me = null, refreshing = null, refreshRetryAfter = 0;
  function readCookie(names) {
    var all = String(document.cookie || '').split(/;\s*/);
    for (var i = 0; i < names.length; i++) for (var j = 0; j < all.length; j++) { var p = all[j].indexOf('='); if (p > 0 && all[j].slice(0, p) === names[i]) return decodeURIComponent(all[j].slice(p + 1)); }
    return null;
  }
  async function csrfToken() { return readCookie(['__Host-am_csrf', 'am_csrf']) || csrfCache || (await loadSession()).csrfToken; }
  async function loadSession() {
    var res = await fetch(API + '/auth/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).catch(function () { throw new ApiError(0, 'network', 'Sem conexão com o servidor.', null, true); });
    if (!res.ok) throw await readError(res);
    var j = await res.json(); csrfCache = j.csrfToken || csrfCache; me = j.authenticated ? j.user : null; return j;
  }
  async function readError(res) {
    var j = null; try { j = await res.json(); } catch (e) { }
    var er = j && j.error ? j.error : {}, e = new ApiError(res.status, er.code || 'http_' + res.status, er.message || 'Erro ' + res.status, er.details, false);
    e.requestId = er.requestId || res.headers.get('X-Request-Id'); e.retryAfter = +res.headers.get('Retry-After') || 0; return e;
  }
  function tryRefresh() {
    if (!refreshing) refreshing = (async function () {
      try {
        var res = await fetch(API + '/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': await csrfToken(), Accept: 'application/json' } });
        if (res.status === 429) { /* limite de taxa compartilhado (escritório atrás de um só IP): não é sessão expirada — espera e repete uma vez */
          var wait = Math.min(61, Math.max(1, +res.headers.get('Retry-After') || 5)); await new Promise(function (r) { setTimeout(r, wait * 1000); });   /* a janela do balde é de 60 s */
          res = await fetch(API + '/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': await csrfToken(), Accept: 'application/json' } });
        }
        if (res.status === 429) { refreshRetryAfter = Math.max(1, +res.headers.get('Retry-After') || 30); return 'rate_limited'; }   /* ainda limitado: a sessão continua válida — quem chamou agenda nova tentativa */
        if (!res.ok) return false; await loadSession().catch(function () { }); return true;
      }
      catch (e) { return false; } finally { setTimeout(function () { refreshing = null; }, 0); }
    })();
    return refreshing;
  }
  async function raw(method, path, o) {
    o = o || {}; var authTry = 0, csrfTry = 0;
    for (; ;) {
      var headers = Object.assign({ Accept: o.accept || 'application/json' }, o.headers || {}), body = o.body;
      if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
      if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = await csrfToken();
      var res;
      try { res = await fetch(API + path, { method: method, headers: headers, body: body, credentials: 'same-origin', cache: 'no-store' }); }
      catch (e) { throw new ApiError(0, 'network', 'Sem conexão com o servidor.', null, true); }
      if (res.ok) return res;
      var err = await readError(res);
      if (res.status === 401 && !authTry++ && /session_expired|unauthenticated/.test(err.code)) {
        var rf = await tryRefresh(); if (rf === true) continue;
        if (rf === 'rate_limited') { var lim = new ApiError(429, 'rate_limited', 'Muitas renovações de sessão ao mesmo tempo. Tentando de novo em instantes.', null, false); lim.retryAfter = refreshRetryAfter; throw lim; }   /* transitório: o autosave recua e repete, sem "sessão expirada" */
      }
      if (res.status === 403 && err.code === 'csrf' && !csrfTry++) { csrfCache = null; await loadSession().catch(function () { }); continue; }
      throw err;
    }
  }
  async function jreq(method, path, json) { var res = await raw(method, path, json === undefined ? {} : { json: json }); return res.status === 204 ? null : res.json(); }
  var assetApi = {
    check: async function (shas) { var r = await jreq('POST', '/assets/check', { shas: shas }); return (r && r.missing) || []; },
    put: async function (sha, bytes, mime, kind) { await raw('PUT', '/assets/' + sha, { body: bytes, headers: { 'Content-Type': mime || 'application/octet-stream', 'X-Asset-Kind': kind || 'image' } }); }
  };
  async function fetchAsset(sha) {
    var res = await raw('GET', '/assets/' + sha, { accept: '*/*' });
    return { mime: (res.headers.get('Content-Type') || 'application/octet-stream').split(';')[0], bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  /* imagens maiores que o limite de envio da função (4 MB) são recomprimidas no navegador (WebP preserva transparência) antes de enviar */
  async function shrinkImage(bytes, mime) {
    try {
      var bmp = await createImageBitmap(new Blob([bytes], { type: mime })), k = 1, out = null;
      for (var i = 0; i < 6; i++) {
        var w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k)), cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
        cv.getContext('2d').drawImage(bmp, 0, 0, w, hh);
        var blob = await new Promise(function (r) { cv.toBlob(r, 'image/webp', i < 2 ? .9 : .8); });
        if (!blob) break; out = new Uint8Array(await blob.arrayBuffer()); if (out.length <= MAX_UP) return { bytes: out, mime: 'image/webp' }; k *= .75;
      }
      return out ? { bytes: out, mime: 'image/webp' } : null;
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- estado */
  var A = {
    rev: 0, dirty: false, seq: 0, timer: null, retryTimer: null, inflight: null, again: false, failures: 0, blocked: false, status: 'loading', savedAt: null,
    lastSavedStr: '', lastContent: null, preSnapshot: false, conflict: null, shaCache: new Map(), thumbAt: 0, thumbSrc: '', thumbSha: null,
    meta: null, loading: true, own: 0, allowLeave: false
  };
  function fixId() { try { var d = S.deck; if (d && d.id !== ID) d.id = ID; } catch (e) { } }
  function unsaved() { return !VIEW && (A.dirty || !!A.inflight); }
  /* texto em edição só entra no deck ao sair do campo: ao fechar/sair, sai do campo para o que foi digitado ser salvo */
  function endTextEdit() { try { var ae = document.activeElement; if (ae && ae.isContentEditable && ae.blur) ae.blur(); } catch (e) { } try { S.flush(); } catch (e) { } }

  /* ---------------------------------------------------------------- fila local (IndexedDB "canteiro-cloud") */
  var dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var r = indexedDB.open('canteiro-cloud', 1);
        r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('pending')) d.createObjectStore('pending', { keyPath: 'id' }); if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); }; r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function idbOp(store, mode, fn) {
    var db = await idb(); if (!db) return null;
    return new Promise(function (res) {
      try { var tx = db.transaction(store, mode), rq = fn(tx.objectStore(store)); tx.oncomplete = function () { res(rq && 'result' in rq ? rq.result : true); }; tx.onerror = tx.onabort = function () { res(null); }; }
      catch (e) { res(null); }
    });
  }
  function pendingPut(rec) { return idbOp('pending', 'readwrite', function (s) { return s.put(rec); }); }
  function pendingGet() { return idbOp('pending', 'readonly', function (s) { return s.get(ID); }); }
  function pendingDel() { return idbOp('pending', 'readwrite', function (s) { return s.delete(ID); }); }
  function pendingSnapshot() { try { S.flush(); } catch (e) { } fixId(); return pendingPut({ id: ID, json: JSON.stringify(S.deck), baseRev: A.rev, ts: Date.now(), title: S.deck.title || '' }); }

  /* ---------------------------------------------------------------- pílula de estado */
  var pill = null, pillWrap = null;
  var LAB = {
    loading: function () { return { l: 'Abrindo…', m: 'Abrindo…' }; },
    saved: function () { var t = hhmm(A.savedAt || new Date()); return { l: 'Salvo na nuvem às ' + t, m: 'Salvo às ' + t }; },
    saving: function () { return { l: 'Salvando…', m: 'Salvando…' }; },
    offline: function () { return { l: 'Sem conexão — alterações guardadas neste computador', m: 'Sem conexão' }; },
    reconnecting: function () { return { l: 'Reconectando…', m: 'Reconectando…' }; },
    conflict: function () { return { l: 'Conflito — escolha como resolver', m: 'Conflito' }; },
    readonly: function () { return { l: 'Somente leitura', m: 'Somente leitura' }; },
    expired: function () { return { l: 'Sessão expirada — alterações guardadas neste computador', m: 'Sessão expirada' }; },
    error: function () { return { l: 'Não foi possível salvar — abra o menu', m: 'Erro ao salvar' }; }
  };
  function setStatus(k) {
    var was = A.status; A.status = k; if (!pill) return;
    if (k === 'offline' && was !== 'offline' && was !== 'reconnecting' && was !== 'loading') toast(LAB.offline().l + '.');
    var t = LAB[k](); pill.dataset.state = k;
    pill.querySelector('.cl-t-long').textContent = t.l; pill.querySelector('.cl-t-mid').textContent = t.m;
    pill.setAttribute('aria-label', t.l + '. Abrir menu da nuvem'); pill.title = t.l;
    liveSay(t.l); fitPill();
  }
  /* o texto da pílula se adapta: completo → curto → só o ícone, sem nunca estourar a barra nem espremer o nome da apresentação */
  var fitRaf = 0;
  function fitPill() { doFit(); cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(doFit); } /* de novo no próximo quadro: fontes e media queries assentam */
  function doFit() {
    if (!pill) return;
    var top = $('#top'), title = $('#title'); if (!top || !title) return;
    var sizes = ['long', 'mid', 'icon'];
    for (var i = 0; i < sizes.length; i++) { pill.dataset.size = sizes[i]; if (top.scrollWidth <= top.clientWidth && title.getBoundingClientRect().width >= 130) break; }
  }
  function buildPill() {
    var redo = $('#bRedo'); if (!redo || pill) return;
    pillWrap = h('div', { class: 'cl-pillwrap', id: 'cloudPillWrap' });
    pill = h('button', { type: 'button', class: 'cl-pill', id: 'cloudPill', 'data-state': 'loading', 'data-size': 'long', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'cloudMenu' }, [
      h('span', { class: 'cl-dot', 'aria-hidden': 'true' }), h('span', { class: 'cl-t cl-t-long' }), h('span', { class: 'cl-t cl-t-mid' })]);
    pill.addEventListener('click', function () { toggleMenu(); });
    pillWrap.appendChild(pill); pillWrap.appendChild(h('span', { id: 'cloudLive', class: 'cl-sr', role: 'status', 'aria-live': 'polite' }));
    redo.insertAdjacentElement('afterend', pillWrap);
    try { new ResizeObserver(function () { fitPill(); }).observe(document.body); } catch (e) { } addEventListener('resize', fitPill);
    try { document.fonts.addEventListener('loadingdone', fitPill); document.fonts.ready.then(fitPill); } catch (e) { }
    setStatus(A.status);
  }

  /* ---------------------------------------------------------------- menu da pílula */
  var menu = null, menuOpen = false;
  function menuItems() {
    var it = [];
    if (A.status === 'error' || A.status === 'offline') it.push({ id: 'retry', t: 'Tentar salvar de novo', fn: function () { A.failures = 0; A.blocked = false; saveNow({ force: true }); } });
    if (A.status === 'conflict') it.push({ id: 'conflict', t: 'Resolver o conflito…', fn: function () { if (A.conflict) showConflict(A.conflict); } });
    if (A.status === 'expired') it.push({ id: 'login', t: 'Entrar de novo…', fn: showExpired });
    it.push({ id: 'snap', t: 'Salvar versão agora…', k: 'Ctrl+S', fn: versionDialog });
    it.push({ id: 'hist', t: 'Histórico de versões…', fn: historyDialog });
    it.push({ id: 'copy', t: 'Criar cópia', fn: makeCopy });
    it.push({ id: 'share', t: 'Compartilhar (copiar link)', fn: shareLink });
    it.push({ sep: 1 });
    it.push({ id: 'home', t: 'Voltar ao acervo', fn: goAcervo });
    return it;
  }
  function buildMenu() {
    if (menu) menu.remove();
    menu = h('div', { id: 'cloudMenu', class: 'cl-menu', role: 'menu', 'aria-label': 'Menu da nuvem' });
    var st = LAB[A.status]();
    menu.appendChild(h('div', { class: 'cl-mh', role: 'presentation' }, [h('b', { text: st.l }), h('span', { text: 'Versão ' + A.rev + ' na nuvem' + (A.savedAt ? ' · última gravação às ' + hhmm(A.savedAt) : '') })]));
    menuItems().forEach(function (m) {
      if (m.sep) { menu.appendChild(h('div', { class: 'cl-sep', role: 'separator' })); return; }
      var b = h('button', { type: 'button', class: 'cl-mi', role: 'menuitem', 'data-id': m.id, tabindex: '-1' }, [h('span', { text: m.t })].concat(m.k ? [h('kbd', { text: m.k })] : []));
      b.addEventListener('click', function () { closeMenu(false); m.fn(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
  }
  function toggleMenu() { if (menuOpen) closeMenu(true); else openMenu(); }
  function openMenu() {
    if (!pill) return; try { S.closeMenus(); } catch (e) { }
    buildMenu(); menuOpen = true; pill.setAttribute('aria-expanded', 'true');
    var r = pill.getBoundingClientRect(); menu.style.top = Math.round(r.bottom + 6) + 'px'; menu.classList.add('open');
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left)) + 'px';
    var first = menu.querySelector('.cl-mi'); if (first) first.focus();
  }
  function closeMenu(focusPill) {
    if (!menuOpen) return; menuOpen = false; if (menu) menu.classList.remove('open'); pill.setAttribute('aria-expanded', 'false');
    if (focusPill) pill.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', function (e) { if (menuOpen && !e.target.closest('#cloudMenu, #cloudPill')) closeMenu(false); }, true);

  /* ---------------------------------------------------------------- caixas de diálogo (foco preso, Esc, rolagem do fundo travada) */
  var dlg = null;
  function openDialog(o) {
    closeDialog('replace');
    var prev = document.activeElement, id = 'cld' + Math.random().toString(36).slice(2, 7);
    var box = h('div', { class: 'cl-dlg' + (o.wide ? ' wide' : ''), role: o.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + 't', 'aria-describedby': id + 'd' });
    box.appendChild(h('div', { class: 'cl-dh' }, [o.eyebrow ? h('div', { class: 'cl-ey', text: o.eyebrow }) : null, h('h2', { id: id + 't', text: o.title })]));
    var body = h('div', { class: 'cl-db', id: id + 'd' }); (o.body || []).forEach(function (n) { body.appendChild(typeof n === 'string' ? h('p', { text: n }) : n); }); box.appendChild(body);
    var act = h('div', { class: 'cl-da' });
    (o.actions || []).forEach(function (a) {
      var b = h('button', { type: 'button', class: 'cl-b ' + (a.kind || ''), text: a.label, 'data-act': a.id || '' });
      b.addEventListener('click', function () {
        var r = a.fn ? a.fn(d) : null;
        if (r && r.then) { b.disabled = true; r.then(function (keep) { b.disabled = false; if (keep !== true) d.close('action'); }, function () { b.disabled = false; }); }
        else if (r !== true) d.close('action');
      });
      act.appendChild(b);
    });
    box.appendChild(act);
    var ov = h('div', { class: 'cl-ov' }, [box]);
    var d = {
      el: box, ov: ov, dismissible: o.dismissible !== false, onClose: o.onClose, prev: prev, enter: null,
      close: function (why) { if (dlg !== d) return; dlg = null; ov.remove(); document.documentElement.classList.remove('cl-lock'); if (d.onClose) d.onClose(why); if (why !== 'replace' && d.prev && document.contains(d.prev) && d.prev.focus) d.prev.focus({ preventScroll: true }); }
    };
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && d.dismissible) d.close('backdrop'); });
    document.body.appendChild(ov); document.documentElement.classList.add('cl-lock'); dlg = d;
    var f = box.querySelector('[data-autofocus]') || box.querySelector('.cl-b.pri, .cl-b.or') || box.querySelector('button, input, textarea');
    setTimeout(function () { if (f && dlg === d) f.focus({ preventScroll: true }); }, 20);
    return d;
  }
  function closeDialog(why) { if (dlg) dlg.close(why || 'api'); }
  function confirmDialog(title, msg, ok, cancel, danger) {
    return new Promise(function (res) {
      openDialog({ title: title, body: [msg], alert: true, actions: [{ label: cancel || 'Cancelar', fn: function () { res(false); } }, { label: ok || 'Confirmar', kind: danger ? 'dng' : 'pri', fn: function () { res(true); } }], onClose: function (why) { if (why === 'esc' || why === 'backdrop') res(false); } });
    });
  }
  /* o editor inteiro fica sem teclado enquanto uma caixa ou o menu da nuvem estão abertos (digitar nos campos continua valendo) */
  addEventListener('keydown', function (e) {
    if (dlg) {
      if (e.key === 'Escape') { if (dlg.dismissible) { e.preventDefault(); dlg.close('esc'); } e.stopPropagation(); return; }
      if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(dlg.el.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'), function (x) { return x.offsetParent !== null; });
        if (f.length) { var i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus(); }
        e.stopPropagation(); return;
      }
      if (e.key === 'Enter' && dlg.enter && e.target && e.target.matches && e.target.matches('input')) { e.preventDefault(); dlg.enter(); }
      e.stopPropagation(); return;
    }
    if (menuOpen) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('.cl-mi')), i2 = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i2 + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i2 - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Tab') { closeMenu(false); return; }
      else if (e.key !== 'Enter' && e.key !== ' ') return;
      e.stopPropagation(); return;
    }
    /* Ctrl+S na nuvem = salvar uma versão agora. O botão Salvar (e "Salvar como…") continuam baixando HTML/PDF/PowerPoint */
    if (!VIEW && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key || '').toLowerCase() === 's') {
      var md = $('#modal'); if (md && md.classList.contains('open')) return;
      var pr = $('#presenter'); if (pr && pr.classList.contains('open')) return;
      e.preventDefault(); e.stopPropagation(); try { S.flush(); } catch (er) { }
      saveVersion('').then(function (ok) { if (ok) toast('Versão salva na nuvem'); });
    }
  }, true);

  /* ---------------------------------------------------------------- tela de carregamento / erro */
  var loadEl = null;
  function loadingUI(msg) {
    if (!loadEl) {
      loadEl = h('div', { class: 'cl-load', id: 'cloudLoad', role: 'status', 'aria-live': 'polite' }, [h('div', { class: 'cl-lc' }, [h('div', { class: 'cl-lm', id: 'cloudLoadMsg' }), h('div', { class: 'cl-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Progresso' }, [h('i')])])]);
      document.body.appendChild(loadEl);
    }
    $('#cloudLoadMsg').textContent = msg; return loadEl;
  }
  function loadProgress(p) { if (!loadEl) return; var b = $('.cl-bar', loadEl), pct = Math.max(0, Math.min(100, Math.round(p))); b.setAttribute('aria-valuenow', pct); b.firstChild.style.width = pct + '%'; }
  function loadDone() { if (loadEl) { loadEl.remove(); loadEl = null; } }
  function fatal(title, msg, links) {
    loadDone(); A.loading = false;
    var ov = h('div', { class: 'cl-load', id: 'cloudFatal', role: 'alert' }, [h('div', { class: 'cl-lc' }, [h('h2', { text: title }), h('p', { text: msg }), h('div', { class: 'cl-da' }, (links || [{ label: 'Voltar ao acervo', href: '/acervo' }]).map(function (l) { return h('a', { class: 'cl-b pri', href: l.href, text: l.label }); }))])]);
    document.body.appendChild(ov);
  }
  function goLogin() { location.replace('/entrar?next=' + encodeURIComponent(location.pathname + location.search)); }

  /* pdf.js: sob 'strict-dynamic' o Chromium recusa import()/módulos vindos de script autorizado por hash; <script> clássico criado por ele é aceito.
     O build gera vendor/pdfjs-4.10.38/pdf.classic.js (mesmo arquivo, sem sintaxe de módulo) e o patch d-pdfjs chama esta função. */
  window.AM_PDFJS_IMPORT = function (url) {
    var classic = String(url).replace(/pdf\.min\.mjs(\?.*)?$/, 'pdf.classic.js');
    return new Promise(function (res, rej) {
      if (window.__am_pdfjs) return res(window.__am_pdfjs);
      var sc = document.createElement('script'); sc.src = classic; sc.async = true;
      sc.onload = function () { window.__am_pdfjs ? res(window.__am_pdfjs) : rej(new Error('pdf.js sem exportações')); };
      sc.onerror = function () { rej(new Error('não foi possível carregar ' + classic)); };
      document.head.appendChild(sc);
    });
  };

  /* ---------------------------------------------------------------- carregar / hidratar */
  var hydCache = new Map();
  async function hydrate(content, withProgress) {
    var stats = {};
    var deck = await CC.hydrateDeck(content, { fetchAsset: fetchAsset, cache: hydCache, maxConcurrent: 4, stats: stats, onProgress: function (p) { if (withProgress && p.total) loadProgress(10 + 80 * p.done / p.total); } });
    if (stats.missing && stats.missing.length) toast(stats.missing.length === 1 ? 'Uma imagem não pôde ser carregada e foi substituída por um aviso.' : stats.missing.length + ' imagens não puderam ser carregadas e foram substituídas por um aviso.');
    return deck;
  }
  /* troca o deck do editor (sem Minhas obras local) e fixa o id da apresentação; keepBase: não toca no "último salvo" (recuperação de pendência) */
  function applyDeck(deck, keepBase) {
    A.own++; try { deck.id = ID; S.loadDeck(deck, null, true, true); fixId(); } finally { A.own--; }
    if (!keepBase) A.lastSavedStr = JSON.stringify(S.deck);
    document.title = (S.deck.title || 'Apresentação') + ' · Canteiro';
  }
  function loadPresentation() { return jreq('GET', '/presentations/' + ID); }
  async function boot() {
    loadingUI(VIEW ? 'Abrindo apresentação…' : 'Abrindo apresentação para edição…'); loadProgress(4);
    var sess;
    try { sess = await loadSession(); } catch (e) { return fatal('Sem conexão', 'Não foi possível falar com o servidor. Verifique a internet e tente de novo.', [{ label: 'Tentar de novo', href: location.pathname }, { label: 'Voltar ao acervo', href: '/acervo' }]); }
    if (!sess.authenticated) return goLogin();
    var p;
    try { p = await loadPresentation(); }
    catch (e) {
      if (e.status === 401) return goLogin();
      if (e.status === 404 || e.status === 403) return fatal('Apresentação não encontrada', 'Ela não existe mais ou você não tem acesso. Volte ao acervo para escolher outra.');
      return fatal('Não foi possível abrir', e.message || 'Tente de novo em instantes.', [{ label: 'Tentar de novo', href: location.pathname }, { label: 'Voltar ao acervo', href: '/acervo' }]);
    }
    if (!VIEW && !p.canEdit) { location.replace('/visualizar/' + ID); return; }
    A.meta = p; A.rev = p.rev; A.savedAt = new Date(p.updatedAt || Date.now()); A.thumbSha = p.thumbSha || null; A.lastContent = p.content;
    loadProgress(10);
    var deck = await hydrate(p.content, true); loadProgress(92);
    if (!deck.title && p.title) deck.title = p.title;
    applyDeck(deck);
    if (!VIEW) await offerRecovery(p);
    loadProgress(100); loadDone(); A.loading = false;
    quietLocalStores(); bridgeStart();
    if (VIEW) { startView(p); return; }
    setStatus(A.dirty ? 'saving' : 'saved'); if (!navigator.onLine) setStatus('offline');
    if (A.dirty) saveNow({ force: true });
  }

  /* ---------------------------------------------------------------- recuperar alterações não salvas (fila local) */
  async function offerRecovery(p) {
    var rec = await pendingGet(); if (!rec || !rec.json) return;
    var newer = rec.ts > Date.parse(p.updatedAt || 0), same = false, pd = null;
    try { pd = JSON.parse(rec.json); var a = S.safeDeck ? S.safeDeck(JSON.parse(rec.json)) : pd; if (a) { a.id = ID; same = JSON.stringify(a) === A.lastSavedStr; } } catch (e) { pd = null; }
    if (!pd || !newer || same) { await pendingDel(); return; }
    loadDone();
    await new Promise(function (res) {
      openDialog({
        eyebrow: 'Alterações neste computador', title: 'Recuperar alterações não salvas?', alert: true, dismissible: false,
        body: ['Este computador guardou alterações feitas ' + when(rec.ts) + ' que ainda não chegaram à nuvem' + (rec.baseRev < p.rev ? '. Depois disso, a apresentação foi alterada na nuvem: se recuperar, você escolherá como juntar as duas versões' : '') + '.'],
        actions: [
          { label: 'Descartar', id: 'discard', fn: function () { return pendingDel().then(function () { res(); }); } },
          { label: 'Recuperar alterações', id: 'recover', kind: 'pri', fn: function () { applyDeck(pd, true); A.rev = rec.baseRev; A.dirty = true; A.seq++; res(); } }
        ]
      });
    });
  }

  /* ---------------------------------------------------------------- autosave */
  addEventListener('am:commit', function () { onChange(); });
  addEventListener('am:load', function () {
    if (A.own || VIEW || A.loading) return;
    fixId(); A.preSnapshot = true; onChange(); /* Abrir…, Novo, importar (substituir) e modelos prontos trocam o deck inteiro */
  });
  function onChange() {
    if (VIEW || A.loading) return;
    fixId(); A.seq++; A.dirty = true; document.title = (S.deck.title || 'Apresentação') + ' · Canteiro';
    schedulePersist();
    if (A.blocked) return;
    if (A.status !== 'offline' && A.status !== 'reconnecting') setStatus('saving');
    clearTimeout(A.timer); A.timer = setTimeout(function () { saveNow({}); }, DEBOUNCE);
  }
  var persistT = null;
  var persistedStr = '';
  function schedulePersist() { clearTimeout(persistT); persistT = setTimeout(function () { try { S.flush(); } catch (e) { } fixId(); var str = JSON.stringify(S.deck); if (str === persistedStr || str === A.lastSavedStr) return; persistedStr = str; pendingPut({ id: ID, json: str, baseRev: A.rev, ts: Date.now(), title: S.deck.title || '' }); }, 1200); }
  function backoff() { var n = Math.min(6, A.failures), base = Math.min(60000, 1000 * Math.pow(2, Math.max(0, n - 1))); return Math.round(base * (0.75 + Math.random() * 0.5)); }
  function saveNow(o) {
    o = o || {};
    if (VIEW || (A.blocked && !o.resolution)) return Promise.resolve(false);
    if (A.inflight) { A.again = true; return (o.snapshot || o.resolution) ? A.inflight.then(function () { return saveNow(o); }) : A.inflight; }
    clearTimeout(A.timer); clearTimeout(A.retryTimer);
    var run = doSave(o).then(function (ok) { return ok; }, function (e) { return handleSaveError(e, o); });
    A.inflight = run;
    run.then(function () { A.inflight = null; if (A.again && A.dirty && !A.blocked) { A.again = false; clearTimeout(A.timer); A.timer = setTimeout(function () { saveNow({}); }, 400); } else A.again = false; });
    return run;
  }
  function saveVersion(label) { return saveNow({ snapshot: true, label: label || '', force: true }); }
  function putContent(body) { return jreq('PUT', '/presentations/' + ID + '/content', body); }
  function forgetKnown() { A.shaCache.forEach(function (v, k) { if (String(k).slice(0, 6) === 'known:') A.shaCache.delete(k); }); }
  async function doSave(o) {
    try { S.flush(); } catch (e) { }
    fixId();
    var str = JSON.stringify(S.deck), seqAt = A.seq, baseRev = o.baseRev != null ? o.baseRev : A.rev;
    if (!o.snapshot && !o.resolution && str === A.lastSavedStr) { A.dirty = false; await pendingDel(); setStatus(navigator.onLine ? 'saved' : 'offline'); return true; }
    if (A.status !== 'reconnecting') setStatus('saving');
    await pendingPut({ id: ID, json: str, baseRev: A.rev, ts: Date.now(), title: S.deck.title || '' }); /* guarda aqui antes de tentar a rede */
    var deck = JSON.parse(str), ext;
    try { ext = await CC.externalizeDeck(deck, { api: assetApi, cache: A.shaCache, maxConcurrent: 4, maxBytes: MAX_UP, shrink: shrinkImage }); }
    catch (e) { forgetKnown(); throw e; }
    if (A.preSnapshot && A.lastContent && !o.resolution) { /* o deck inteiro foi trocado (Abrir…, Novo…): guarda um ponto com o que estava na nuvem */
      try { await putContent({ baseRev: baseRev, content: A.lastContent, snapshot: true, label: 'Antes de substituir' }); } catch (e) { if (e.status === 409 || e.network) throw e; }
      A.preSnapshot = false;
    }
    var body = { baseRev: baseRev, content: ext.content };
    if (o.snapshot) { body.snapshot = true; if (o.label) body.label = String(o.label).slice(0, 80); }
    if (o.resolution) body.resolution = o.resolution;
    var th = await maybeThumb(deck); if (th) body.thumbSha = th;
    var r;
    try { r = await putContent(body); }
    catch (e) { if (e.status === 422 && e.details && e.details.missing && !o.retried422) { forgetKnown(); return doSave(Object.assign({}, o, { retried422: true })); } throw e; }
    A.rev = r.rev; A.lastSavedStr = str; A.lastContent = ext.content; A.failures = 0; A.savedAt = new Date(r.savedAt || Date.now()); A.preSnapshot = false;
    if (th) A.thumbSha = th;
    if (A.seq === seqAt) { A.dirty = false; await pendingDel(); setStatus('saved'); } else { A.again = true; setStatus('saving'); }
    return true;
  }
  async function maybeThumb(deck) {
    try {
      var s0 = JSON.stringify(deck.slides[0]);
      if (s0 === A.thumbSrc && A.thumbSha) return null;
      if (A.thumbAt && Date.now() - A.thumbAt < THUMB_EVERY) return null;
      if (!window.AMExport || !AMExport.rasterSlide) return null;
      A.thumbAt = Date.now();
      var q = .72, out = null;
      for (var i = 0; i < 4; i++) {
        var r = await AMExport.rasterSlide(deck.slides[0], { scale: .25, type: 'jpeg', quality: q, bg: '#FFFFFF', texts: false });
        out = new Uint8Array(await r.blob.arrayBuffer()); if (out.length <= 60 * 1024) break; q -= .15;
      }
      if (!out || out.length > 60 * 1024) return null;
      var sha = await CC.sha256Hex(out); A.thumbSrc = s0;
      var miss = await assetApi.check([sha]); if (miss.length) await assetApi.put(sha, out, 'image/jpeg', 'thumb');
      return sha;
    } catch (e) { return null; }
  }
  function handleSaveError(e, o) {
    if (!(e instanceof ApiError)) { try { console.error(e); } catch (x) { } e = new ApiError(0, 'client', 'Erro inesperado ao salvar.', null, false); }
    if (e.status === 409) { showConflict(e.details || {}); return false; }
    if (e.status === 401) { A.blocked = true; setStatus('expired'); showExpired(); return false; }
    if (e.status === 403) { A.blocked = true; setStatus('readonly'); showReadOnly(); return false; }
    if (e.status === 404) { A.blocked = true; setStatus('error'); fatalDeleted(); return false; }
    if (e.network || e.status >= 500 || e.status === 429 || e.status === 408) {
      A.failures++; setStatus('offline');
      var wait = Math.max(backoff(), (e.retryAfter || 0) * 1000);
      clearTimeout(A.retryTimer); A.retryTimer = setTimeout(function () { if (A.dirty && !A.blocked) { setStatus('reconnecting'); saveNow({ force: true }); } }, wait);
      return false;
    }
    setStatus('error'); toast(e.message || 'Não foi possível salvar.'); return false;
  }
  addEventListener('online', function () {
    if (VIEW) return;
    if (A.dirty && !A.blocked) { A.failures = 0; setStatus('reconnecting'); saveNow({ force: true }); } else if (!A.dirty && A.status === 'offline') setStatus('saved');
    bridgeFlush();
  });
  addEventListener('offline', function () { if (!VIEW && pill) setStatus('offline'); });
  document.addEventListener('visibilitychange', function () {
    if (VIEW) return;
    if (document.visibilityState === 'hidden') { try { S.flush(); } catch (e) { } if (A.dirty && !A.blocked) saveNow({ force: true }); else if (A.dirty) schedulePersist(); }
    else if (A.dirty && !A.blocked && A.status === 'offline') saveNow({ force: true });
    bridgeFlush();
  });
  addEventListener('pagehide', function () { if (VIEW || A.loading) return; endTextEdit(); if (A.dirty) { pendingSnapshot(); if (!A.blocked) saveNow({ force: true }); } });
  addEventListener('beforeunload', function (e) {
    if (VIEW) return;
    endTextEdit();
    if (A.allowLeave) return;
    if (unsaved()) { e.preventDefault(); e.returnValue = ''; if (!A.blocked) saveNow({ force: true }); }
    else e.stopImmediatePropagation(); /* já está na nuvem: o aviso de "desfazer" do editor não se aplica */
  }, true);

  /* ---------------------------------------------------------------- conflito (409) */
  function showConflict(d) {
    d = d || {}; A.blocked = true; A.conflict = d; setStatus('conflict'); clearTimeout(A.timer); clearTimeout(A.retryTimer); schedulePersist();
    var who = d.updatedBy && d.updatedBy.displayName ? d.updatedBy.displayName : 'Outra pessoa';
    var info = h('p', { text: who + ' salvou uma versão mais nova ' + (d.updatedAt ? when(d.updatedAt) : 'há pouco') + (d.serverRev != null ? ' (versão ' + d.serverRev + ')' : '') + '. Você também tem alterações aqui que ainda não foram salvas.' });
    return openDialog({
      eyebrow: 'Conflito de edição', title: 'Esta apresentação mudou em outro lugar', alert: true, wide: true,
      body: [info, h('ul', { class: 'cl-opts' }, [
        h('li', {}, [h('b', { text: 'Manter a minha versão' }), ' — a versão da nuvem fica guardada no histórico e a sua passa a valer.']),
        h('li', {}, [h('b', { text: 'Carregar a versão da nuvem' }), ' — descarta as alterações deste computador (você pode baixá-las antes).']),
        h('li', {}, [h('b', { text: 'Salvar a minha como cópia' }), ' — a sua versão vira uma nova apresentação; a da nuvem não muda.'])])],
      actions: [
        { label: 'Decidir depois', id: 'later', fn: function () { return false; } },
        { label: 'Salvar a minha como cópia', id: 'copy', fn: function () { return conflictCopy().then(function () { return true; }, function () { return true; }); } },
        { label: 'Carregar a versão da nuvem', id: 'cloud', fn: function () { conflictLoadCloud(); return true; } },
        { label: 'Manter a minha versão', id: 'mine', kind: 'pri', fn: function () { return conflictOverwrite(d); } }
      ]
    });
  }
  async function conflictOverwrite(d) {
    A.blocked = false; A.conflict = null; setStatus('saving');
    var ok = await saveNow({ resolution: 'overwrite', baseRev: d.serverRev != null ? d.serverRev : A.rev, force: true });
    if (ok) toast('Sua versão foi salva; a anterior ficou no histórico.');
    return !ok; /* se falhou (outra caixa já foi aberta ou a rede caiu), esta caixa não precisa continuar aberta nem fechada à força */
  }
  function conflictLoadCloud() {
    var go = async function () {
      A.blocked = true; setStatus('saving');
      try {
        var p = await loadPresentation(), deck = await hydrate(p.content, false);
        A.rev = p.rev; A.lastContent = p.content; A.savedAt = new Date(p.updatedAt || Date.now()); applyDeck(deck); A.dirty = false; A.conflict = null; A.blocked = false; A.failures = 0; A.seq++;
        await pendingDel(); setStatus('saved'); toast('Versão da nuvem carregada.');
      } catch (e) { A.blocked = true; setStatus('conflict'); toast('Não foi possível carregar a versão da nuvem: ' + (e.message || 'tente de novo') + '.'); }
    };
    return openDialog({
      eyebrow: 'Conflito de edição', title: 'Descartar as alterações deste computador?', alert: true,
      body: ['Se continuar, o que você mudou aqui desde o último salvamento será substituído pela versão da nuvem. Quer guardar uma cópia sua, em arquivo, antes?'],
      actions: [
        { label: 'Voltar', id: 'back', fn: function () { if (A.conflict) setTimeout(function () { showConflict(A.conflict); }, 0); } },
        { label: 'Carregar sem baixar', id: 'nodl', kind: 'dng', fn: function () { go(); } },
        { label: 'Baixar a minha (.html) e carregar', id: 'dl', kind: 'pri', fn: function () { try { S.flush(); fixId(); S.download(S.slug(S.deck.title) + '-minha-versao.html', S.exportHTML()); } catch (e) { } go(); } }
      ]
    });
  }
  async function conflictCopy() {
    try {
      S.flush(); fixId(); var str = JSON.stringify(S.deck), t = (S.deck.title || 'Apresentação') + ' (minha versão)';
      var dup = await jreq('POST', '/presentations/' + ID + '/duplicate', { title: t });
      var deck = JSON.parse(str); deck.id = dup.id; deck.title = t;
      var ext = await CC.externalizeDeck(deck, { api: assetApi, cache: A.shaCache, maxBytes: MAX_UP, shrink: shrinkImage });
      await jreq('PUT', '/presentations/' + dup.id + '/content', { baseRev: dup.rev, content: ext.content, snapshot: true, label: 'Cópia a partir de um conflito' });
      A.dirty = false; await pendingDel(); toast('Cópia criada. Abrindo…'); goEditor(dup.id);
    } catch (e) { toast('Não foi possível criar a cópia: ' + (e.message || 'tente de novo') + '.'); if (A.conflict) setTimeout(function () { showConflict(A.conflict); }, 0); throw e; }
  }

  /* ---------------------------------------------------------------- sessão expirada / sem permissão / apagada */
  function showExpired() {
    openDialog({
      eyebrow: 'Sessão', title: 'Sua sessão expirou', alert: true,
      body: ['Suas alterações continuam guardadas neste computador e nada foi perdido. Entre de novo numa nova aba (este editor permanece aberto) e volte aqui para continuar.'],
      actions: [
        { label: 'Fechar', fn: function () { } },
        { label: 'Entrar numa nova aba', id: 'login', kind: 'pri', fn: function () { window.open('/entrar?next=' + encodeURIComponent('/editor/' + ID) + '&aba=1', '_blank', 'noopener'); return true; } },
        { label: 'Já entrei — tentar de novo', id: 'retry', kind: 'or', fn: function () {
          return loadSession().then(function (s) { if (s.authenticated) { A.blocked = false; A.failures = 0; setStatus('saving'); saveNow({ force: true }); return false; } toast('Ainda não há sessão ativa. Entre na outra aba primeiro.'); return true; }, function () { toast('Sem conexão.'); return true; });
        } }
      ]
    });
  }
  function showReadOnly() {
    openDialog({
      eyebrow: 'Permissão', title: 'Você não pode mais alterar esta apresentação', alert: true,
      body: ['Somente o dono (ou um administrador) altera uma apresentação. Suas alterações não foram enviadas, mas continuam neste computador. Crie uma cópia para continuar de onde parou.'],
      actions: [{ label: 'Fechar', fn: function () { } }, { label: 'Criar cópia com as minhas alterações', id: 'copyro', kind: 'pri', fn: function () { return conflictCopy().then(function () { return true; }, function () { return true; }); } }]
    });
  }
  function fatalDeleted() {
    openDialog({
      eyebrow: 'Apresentação', title: 'Esta apresentação foi excluída', alert: true, body: ['Ela está na lixeira ou foi apagada. Suas alterações continuam neste computador; baixe o arquivo para não perdê-las.'],
      actions: [{ label: 'Fechar', fn: function () { } }, { label: 'Baixar o .html', fn: function () { try { S.flush(); fixId(); S.download(S.slug(S.deck.title) + '.html', S.exportHTML()); } catch (e) { } return true; } }, { label: 'Voltar ao acervo', kind: 'pri', fn: function () { A.allowLeave = true; location.assign('/acervo'); return true; } }]
    });
  }

  /* ---------------------------------------------------------------- versões, histórico, cópia, link */
  function versionDialog() {
    var inp = h('input', { type: 'text', class: 'cl-in', id: 'cloudVerLabel', maxlength: '80', placeholder: 'Ex.: versão enviada ao cliente', 'data-autofocus': '1' });
    var dd = openDialog({
      eyebrow: 'Histórico de versões', title: 'Salvar versão agora',
      body: ['Guarda um ponto no histórico com o estado atual da apresentação. Você poderá restaurá-lo depois.', h('label', { class: 'cl-lb', for: 'cloudVerLabel', text: 'Rótulo (opcional)' }), inp],
      actions: [{ label: 'Cancelar', fn: function () { } }, { label: 'Salvar versão', id: 'dosnap', kind: 'pri', fn: function () { return doIt(); } }]
    });
    function doIt() { return saveVersion(inp.value.trim()).then(function (ok) { if (ok) { toast('Versão salva na nuvem'); return false; } toast('Não foi possível salvar a versão agora.'); return true; }); }
    dd.enter = function () { var b = dd.el.querySelector('[data-act=dosnap]'); if (b) b.click(); };
  }
  var KIND = { create: 'Criada', auto: 'Automática', manual: 'Manual', pre_overwrite: 'Antes de sobrescrever', pre_restore: 'Antes de restaurar', restore: 'Restauração', copy: 'Cópia', import: 'Importação' };
  async function historyDialog() {
    var list = h('ul', { class: 'cl-vl', role: 'listbox', 'aria-label': 'Versões', tabindex: '0' }), prevBox = h('div', { class: 'cl-vp' }, [h('p', { class: 'cl-mut', text: 'Escolha uma versão para ver o primeiro slide.' })]), sel = null, items = [];
    var dd = openDialog({
      eyebrow: 'Histórico de versões', title: 'Versões desta apresentação', wide: true,
      body: [h('div', { class: 'cl-vwrap' }, [list, prevBox])],
      actions: [{ label: 'Fechar', fn: function () { } }, { label: 'Baixar (.html)', id: 'vdl', fn: function () { return downloadVersion(); } }, { label: 'Restaurar esta versão', id: 'vrs', kind: 'pri', fn: function () { return restoreVersion(); } }]
    });
    var bDl = dd.el.querySelector('[data-act=vdl]'), bRs = dd.el.querySelector('[data-act=vrs]'); bDl.disabled = bRs.disabled = true;
    list.appendChild(h('li', { class: 'cl-mut', text: 'Carregando…' }));
    try { items = (await jreq('GET', '/presentations/' + ID + '/versions')).items || []; }
    catch (e) { list.textContent = ''; list.appendChild(h('li', { class: 'cl-err', text: e.status === 403 ? 'Somente o dono vê o histórico.' : 'Não foi possível carregar o histórico.' })); return; }
    list.textContent = ''; if (!items.length) list.appendChild(h('li', { class: 'cl-mut', text: 'Ainda não há versões.' }));
    items.forEach(function (v) {
      var li = h('li', { class: 'cl-vi', role: 'option', tabindex: '-1', 'aria-selected': 'false', 'data-no': v.no }, [
        h('div', { class: 'cl-vt' }, [h('b', { text: v.label || KIND[v.kind] || v.kind })].concat(v.label ? [h('span', { class: 'cl-tag', text: KIND[v.kind] || v.kind })] : [])),
        h('div', { class: 'cl-vm', text: when(v.createdAt) + ' · ' + ((v.createdBy && v.createdBy.displayName) || '—') + ' · ' + (v.slideCount || 0) + (v.slideCount === 1 ? ' slide' : ' slides') })]);
      li.addEventListener('click', function () { choose(v, li); }); list.appendChild(li);
    });
    list.addEventListener('keydown', function (e) {
      var lis = Array.prototype.slice.call(list.querySelectorAll('.cl-vi')), i = lis.indexOf(list.querySelector('.cl-vi[aria-selected=true]'));
      if (e.key === 'ArrowDown') { e.preventDefault(); var n = lis[i + 1] || (i < 0 ? lis[0] : null); if (n) n.click(); } else if (e.key === 'ArrowUp') { e.preventDefault(); if (lis[i - 1]) lis[i - 1].click(); }
    });
    function choose(v, li) {
      sel = v; Array.prototype.forEach.call(list.querySelectorAll('.cl-vi'), function (x) { x.setAttribute('aria-selected', x === li ? 'true' : 'false'); });
      bDl.disabled = bRs.disabled = false; prevBox.textContent = ''; prevBox.appendChild(h('p', { class: 'cl-mut', text: 'Carregando pré-visualização…' }));
      jreq('GET', '/presentations/' + ID + '/versions/' + v.no).then(function (full) {
        return hydrate(full.content, false).then(function (deck) {
          if (sel !== v) return; prevBox.textContent = '';
          var s0 = (deck.slides || [])[0], wrap = h('div', { class: 'cl-vthumb', role: 'img', 'aria-label': 'Primeiro slide da versão' });
          if (s0) { try { wrap.appendChild(RT.renderSlide(s0, { play: false })); } catch (e) { } }
          prevBox.appendChild(wrap); var nsl = (deck.slides || []).length; prevBox.appendChild(h('p', { class: 'cl-vmeta' }, [h('b', { text: deck.title || v.title || 'Apresentação' }), ' — ' + nsl + (nsl === 1 ? ' slide' : ' slides')]));
        });
      }).catch(function () { if (sel === v) { prevBox.textContent = ''; prevBox.appendChild(h('p', { class: 'cl-err', text: 'Não foi possível carregar esta versão.' })); } });
    }
    async function downloadVersion() {
      if (!sel) return true;
      try { var full = await jreq('GET', '/presentations/' + ID + '/versions/' + sel.no), deck = await hydrate(full.content, false); S.download(S.slug(deck.title || sel.title) + '-v' + sel.no + '.html', S.exportDeck(deck)); } catch (e) { toast('Não foi possível baixar esta versão.'); }
      return true;
    }
    function restoreVersion() {
      if (!sel) return true; var v = sel;
      return confirmDialog('Restaurar a versão “' + (v.label || KIND[v.kind] || v.no) + '”?', 'A apresentação volta ao estado de ' + when(v.createdAt) + '. O estado atual fica guardado no histórico, então dá para voltar atrás.', 'Restaurar', 'Cancelar').then(async function (ok) {
        if (!ok) { historyDialog(); return true; }
        try {
          await saveNow({ force: true });
          await jreq('POST', '/presentations/' + ID + '/versions/' + v.no + '/restore', { baseRev: A.rev });
          var p = await loadPresentation(), deck = await hydrate(p.content, false);
          A.rev = p.rev; A.lastContent = p.content; applyDeck(deck); A.dirty = false; A.seq++; await pendingDel(); A.savedAt = new Date(); setStatus('saved'); toast('Versão restaurada.');
        } catch (e) { if (e.status === 409) showConflict(e.details); else toast('Não foi possível restaurar: ' + (e.message || 'tente de novo') + '.'); }
        return true;
      });
    }
  }
  async function makeCopy() {
    try {
      if (!VIEW) { try { S.flush(); } catch (e) { } await saveNow({ force: true }); }
      var dup = await jreq('POST', '/presentations/' + ID + '/duplicate', {});
      toast('Cópia criada. Abrindo…'); goEditor(dup.id);
    } catch (e) { toast('Não foi possível criar a cópia: ' + (e.message || 'tente de novo') + '.'); }
  }
  async function shareLink() {
    try {
      var r = await jreq('GET', '/presentations/' + ID + '/share'), url = r.url, ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { }
      if (ok) toast('Link copiado: todos os usuários do Canteiro podem visualizar.');
      else openDialog({ eyebrow: 'Compartilhar', title: 'Copie o link', body: ['Todos os usuários do Canteiro podem visualizar esta apresentação (somente leitura).', h('input', { class: 'cl-in', type: 'text', readonly: '', value: url, 'data-autofocus': '1', 'aria-label': 'Link da apresentação' })], actions: [{ label: 'Fechar', kind: 'pri', fn: function () { } }] });
    } catch (e) { toast('Não foi possível gerar o link.'); }
  }
  async function goAcervo() {
    endTextEdit();
    if (!VIEW && (A.dirty || A.inflight) && !A.blocked) { setStatus('saving'); await saveNow({ force: true }); }
    if (!VIEW && A.dirty) {
      var go = await confirmDialog('Sair com alterações não enviadas?', 'Há alterações que ainda não chegaram à nuvem. Elas ficam guardadas neste computador e você poderá recuperá-las ao abrir esta apresentação de novo.', 'Sair mesmo assim', 'Continuar editando', true);
      if (!go) return;
    }
    A.allowLeave = true; location.assign('/acervo?foco=' + encodeURIComponent(ID));
  }

  /* ---------------------------------------------------------------- Início (capa) → acervo; "Minhas obras" local segue igual */
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('#bHome, #top .brand'); if (!b) return; e.preventDefault(); e.stopImmediatePropagation(); goAcervo(); }, true);
  document.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('#top .brand')) { e.preventDefault(); e.stopImmediatePropagation(); goAcervo(); } }, true);
  function wrapCover() {
    var C = window.AMCover; if (!C || C.__cloud) return !!C;
    var orig = C.open; C.__cloud = true;
    C.open = function (s) { if (s === 'manual' || s === 'tpl' || s === 'hist') return orig.apply(C, arguments); goAcervo(); };
    return true;
  }
  function quietLocalStores() {
    /* Minhas obras (IndexedDB local) não recebe cópias das apresentações da nuvem: o acervo é o servidor, e um computador compartilhado não guarda o que não deve */
    var H = window.AMHist; if (H) ['touch', 'put', 'saveNow'].forEach(function (k) { if (typeof H[k] === 'function' && !H[k].__cloud) { var f = function () { return Promise.resolve(null); }; f.__cloud = true; H[k] = f; } });
    wrapCover(); try { S.hideDraftBanner(); S.clearDraft(); } catch (e) { }
  }
  addEventListener('load', quietLocalStores);
  try { S.hideDraftBanner(); } catch (e) { }

  /* ---------------------------------------------------------------- interações: formulários, quadros e votações → API */
  var KEYRE = /^(amForm|amBoard|amVote)\.([\w-]{1,40})\.([\w-]{1,40})$/, KIND_OF = { amForm: 'form_response', amBoard: 'board_state', amVote: 'vote_state' };
  var seen = {}, bTimers = {}, outbox = [], outBusy = false, outFail = 0, outTimer = null, origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
  function ls() { try { return window.localStorage; } catch (e) { return null; } }
  function rowsOf(v) { try { var o = JSON.parse(v); return o && Array.isArray(o.rows) ? o : null; } catch (e) { return null; } }
  function seedSeen() { var L = ls(); if (!L) return; try { for (var i = 0; i < L.length; i++) { var k = L.key(i), m = KEYRE.exec(k); if (m && m[1] === 'amForm') { var o = rowsOf(L.getItem(k)); if (o) seen[k] = o.rows.length; } } } catch (e) { } }
  function enqueue(item) {
    item.pid = ID; item.ts = Date.now(); outbox.push(item);
    item.stored = idbOp('outbox', 'readwrite', function (s) { var r = s.add({ pid: ID, ts: item.ts, kind: item.kind, elementId: item.elementId, payload: item.payload }); r.onsuccess = function () { item.seq = r.result; }; return r; });
    outFlushSoon(300);
  }
  function outFlushSoon(ms) { clearTimeout(outTimer); outTimer = setTimeout(bridgeFlush, ms); }
  async function bridgeFlush() {
    if (outBusy || !outbox.length) return; outBusy = true;
    try {
      while (outbox.length) {
        var it = outbox[0];
        try { await jreq('POST', '/presentations/' + ID + '/interactions', { kind: it.kind, elementId: it.elementId, payload: it.payload }); }
        catch (e) {
          if (e.network || e.status >= 500 || e.status === 429 || e.status === 401) { outFail++; outFlushSoon(Math.max(Math.min(60000, 2000 * Math.pow(2, Math.min(outFail, 5))), (e.retryAfter || 0) * 1000)); return; } /* tenta depois (respeitando o Retry-After); a apresentação nunca para por isso */
        }
        outbox.shift(); outFail = 0; if (it.stored) await it.stored; if (it.seq != null) idbOp('outbox', 'readwrite', function (s) { return s.delete(it.seq); });
      }
    } finally { outBusy = false; }
  }
  async function outboxLoad() {
    var all = await idbOp('outbox', 'readonly', function (s) { return s.getAll(); });
    (all || []).forEach(function (r) { if (r.pid === ID && !outbox.some(function (x) { return x.seq === r.seq; })) outbox.push(r); });
    if (outbox.length) outFlushSoon(1500);
  }
  function bridge(k, v) {
    var m = KEYRE.exec(k); if (!m || m[2] !== ID) return;
    if (m[1] === 'amForm') {
      var o = rowsOf(v); if (!o) return; var prev = seen[k] || 0;
      if (o.rows.length > prev) o.rows.slice(prev).forEach(function (r) { enqueue({ kind: 'form_response', elementId: m[3], payload: { at: r.at, q: o.q, a: r.a } }); });
      seen[k] = o.rows.length; return;
    }
    clearTimeout(bTimers[k]);
    bTimers[k] = setTimeout(function () { try { var p = JSON.parse(v); if (JSON.stringify(p).length <= 64 * 1024) enqueue({ kind: KIND_OF[m[1]], elementId: m[3], payload: p }); } catch (e) { } }, 1200);
  }
  Storage.prototype.setItem = function (k, v) {
    if (this === ls()) {
      if (k === 'amStudio.draft') return; /* na nuvem o rascunho local é a fila do IndexedDB (apagada após o salvamento confirmado) */
      var r = origSet.apply(this, arguments);
      try { bridge(String(k), String(v)); } catch (e) { }
      return r;
    }
    return origSet.apply(this, arguments);
  };
  Storage.prototype.removeItem = function (k) { if (this === ls()) { try { if (KEYRE.test(String(k))) seen[k] = 0; } catch (e) { } } return origRemove.apply(this, arguments); };
  async function restoreInteractions() {
    try {
      var j = await jreq('GET', '/presentations/' + ID + '/interactions'), items = (j && j.items) || [], L = ls(); if (!L) return;
      /* só o que é comprovadamente MEU entra no localStorage: item sem autor, ou sem sessão carregada, nunca é restaurado (E2E-01) */
      var mine = items.filter(function (it) { var who = it.author || it.user; return !!(who && me && who.id === me.id); }), forms = {};
      mine.forEach(function (it) {
        var key = it.kind === 'form_response' ? 'amForm.' : it.kind === 'board_state' ? 'amBoard.' : it.kind === 'vote_state' ? 'amVote.' : null;
        if (!key || !it.payload) return; key += ID + '.' + it.elementId;
        if (it.kind === 'form_response') {
          var pl = it.payload, okA = pl && Array.isArray(pl.a) && pl.a.length <= 40 && pl.a.every(function (x) { return typeof x === 'string' && x.length <= 4000; }), okQ = pl && Array.isArray(pl.q) && pl.q.length <= 40 && pl.q.every(function (x) { return typeof x === 'string' && x.length <= 400; });
          if (!okA || !okQ || typeof pl.at !== 'string') return; /* só entra o que o formulário realmente produz */
          forms[key] = forms[key] || { q: [], rows: [] }; forms[key].q = pl.q; forms[key].rows.push({ at: pl.at.slice(0, 40), a: pl.a });
        }
        else if (!L.getItem(key)) origSet.call(L, key, JSON.stringify(it.payload));
      });
      Object.keys(forms).forEach(function (key) { var cur = rowsOf(L.getItem(key)), n = cur ? cur.rows.length : 0; if (forms[key].rows.length > n) { origSet.call(L, key, JSON.stringify({ v: 1, q: forms[key].q, rows: forms[key].rows })); seen[key] = forms[key].rows.length; } });
    } catch (e) { /* sem rede ou sem permissão: o estado local continua valendo */ }
  }
  function bridgeStart() { seedSeen(); restoreInteractions(); outboxLoad(); }

  /* ---------------------------------------------------------------- modo visualizar */
  function startView(p) {
    document.documentElement.classList.add('am-cloud-view');
    var bar = h('div', { class: 'cl-vbar', id: 'cloudViewBar', role: 'region', 'aria-label': 'Apresentação em modo de leitura' }, [
      h('button', { type: 'button', class: 'cl-vb', id: 'cloudBack', text: '← Acervo', title: 'Voltar ao acervo (Esc)' }),
      h('div', { class: 'cl-vtitle' }, [h('b', { text: S.deck.title || p.title || 'Apresentação' }), h('span', { text: ' · de ' + ((p.owner && p.owner.displayName) || '—') })]),
      p.canEdit ? h('a', { class: 'cl-vb', id: 'cloudEdit', href: '/editor/' + ID, text: 'Editar' }) : null,
      h('button', { type: 'button', class: 'cl-vb or', id: 'cloudCopy', text: 'Criar cópia para usar', title: 'Cria uma cópia sua, que você pode editar' })]);
    document.body.appendChild(bar);
    $('#cloudBack').addEventListener('click', goAcervo); $('#cloudCopy').addEventListener('click', makeCopy);
    ['dragover', 'drop'].forEach(function (t) { addEventListener(t, function (e) { e.preventDefault(); e.stopImmediatePropagation(); }, true); });
    document.title = (S.deck.title || 'Apresentação') + ' · Canteiro';
    var pr = $('#presenter'), started = false;
    new MutationObserver(function () { if (started && !pr.classList.contains('open')) { A.allowLeave = true; location.assign('/acervo?foco=' + encodeURIComponent(ID)); } }).observe(pr, { attributes: true, attributeFilter: ['class'] });
    try { S.present(0); started = true; } catch (e) { toast('Não foi possível iniciar a apresentação.'); }
  }

  /* ---------------------------------------------------------------- arranque */
  try {
    var save = $('#bSave'); if (save && !VIEW) save.title = 'Baixar a apresentação como arquivo .html (Ctrl+S salva uma versão na nuvem)';
    if (S.HK) S.HK.forEach(function (g) { (g[1] || []).forEach(function (r) { if (r[0] === 'Salvar apresentação') r[2] = 'Na nuvem: salva uma versão no histórico (o botão Salvar baixa o .html)'; }); });
  } catch (e) { }
  window.AMCloud = {
    id: ID, mode: CFG.mode, get status() { return A.status; }, get rev() { return A.rev; }, get dirty() { return A.dirty; }, get inflight() { return !!A.inflight; }, get meta() { return A.meta; },
    saveNow: saveNow, saveVersion: saveVersion, history: historyDialog, bridgeFlush: bridgeFlush, get outbox() { return outbox.length; }
  };
  if (!VIEW) buildPill();
  boot().catch(function (e) { try { console.error(e); } catch (x) { } fatal('Não foi possível abrir', 'Ocorreu um erro inesperado ao abrir a apresentação.', [{ label: 'Tentar de novo', href: location.pathname }, { label: 'Voltar ao acervo', href: '/acervo' }]); });
})();
