/* ===== ed-50-cloud.js — Canteiro online: extensão de nuvem do editor =====
   Só age quando window.AM_CLOUD existe (definido pelo script de boot que o build acrescenta, a partir de /editor/<uuid> ou /visualizar/<uuid>).
   Sem AM_CLOUD este arquivo não faz NADA e o editor se comporta como o original (modo inerte).
   Depende de: AMStudio, AMRT, AMCloudCore (ed-49-cloud-core.js) e dos eventos 'am:commit' / 'am:load' (patches.json).
   Partes: API (cookies + CSRF + refresh) · estado e pílula · caixas de diálogo · teclado · carregar (hidratar) · autosave com fila local (IndexedDB)
   · conflito 409 · conteúdo recusado (422) · histórico · Novo/Abrir/projetos prontos na nuvem · rótulos e capa · parâmetros de URL
   · computador compartilhado · preferências da pessoa · comentários · modo visualizar · ponte de interações. */
(function () {
  'use strict';
  var CFG = window.AM_CLOUD;
  if (!CFG) return;
  var S = window.AMStudio, RT = window.AMRT, CC = window.AMCloudCore;
  if (!S || !RT || !CC) { try { console.error('Canteiro online: editor ou cloud-core ausente'); } catch (e) { } return; }

  var ID = String(CFG.presentationId), VIEW = CFG.mode === 'view', API = String(CFG.apiBase || '/api').replace(/\/$/, '');
  var DEBOUNCE = 3000, THUMB_EVERY = 60000, MAX_UP = 3.6 * 1024 * 1024, MAX_DECK = 4 * 1024 * 1024;   /* corpo de um salvamento: a função da Vercel aceita ~4,5 MB */
  var LIM = { form_response: 64 * 1024 - 1, board_state: 256 * 1024, vote_state: 256 * 1024 };       /* teto de cada interação no servidor, em bytes (docs/API.md §6) */

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
  function editable(t) { return !!(t && t.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)); }
  function byteLen(s) { try { return new Blob([s]).size; } catch (e) { return String(s).length * 3; } }
  function rid() { try { return crypto.randomUUID(); } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); } }
  function isOpenEl(sel) { var x = $(sel); return !!(x && x.classList.contains('open')); }
  function xpOpen() { return document.documentElement.classList.contains('xp-open'); }   /* caixas do editor: exportar, PowerPoint, importar, kit de marca, CSV */
  function coverOpen() { try { return !!(window.AMCover && AMCover.isOpen()); } catch (e) { return false; } }
  /* ícones das caixas (traço 1,8, como os do editor) */
  var IC = {
    cloud: '<path d="M7.5 18.5a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 18 8.6a4 4 0 0 1-.5 7.9z"/>',
    alert: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.4v.1"/>',
    clock: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5M12 7.5V12l3 2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>'
  };
  function svgIc(n) { var w = document.createElement('span'); w.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (IC[n] || IC.cloud) + '</svg>'; return w.firstChild; }

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
  /* SVG, BMP, AVIF, ICO… (que o servidor não guarda) viram PNG só na cópia que sobe; o deck do editor não muda (BE-ED-01) */
  var rasterCache = new Map();
  async function prepareContent(deck, onProgress) {
    var d = await CC.rasterizeForeignImages(deck, { rasterize: CC.browserRasterize, cache: rasterCache });
    return CC.externalizeDeck(d, { api: assetApi, cache: A.shaCache, maxConcurrent: 4, maxBytes: MAX_UP, shrink: shrinkImage, onProgress: onProgress || null });
  }

  /* ---------------------------------------------------------------- estado */
  var A = {
    rev: 0, dirty: false, seq: 0, timer: null, retryTimer: null, inflight: null, again: false, failures: 0, blocked: false, status: 'loading', savedAt: null,
    lastSavedStr: '', lastContent: null, preSnapshot: false, conflict: null, shaCache: new Map(), thumbAt: 0, thumbSrc: '', thumbSha: null,
    meta: null, loading: true, own: 0, allowLeave: false,
    cur: null, hold: false, replaceOk: false, rej: null, waitUntil: 0, upl: null, uid0: null, extN: 0, gone: false
  };
  function fixId() { try { var d = S.deck; if (d && d.id !== ID) d.id = ID; } catch (e) { } }
  function unsaved() { return !VIEW && (A.dirty || !!A.inflight); }
  /* texto em edição só entra no deck ao sair do campo: ao fechar/sair, sai do campo para o que foi digitado ser salvo */
  function endTextEdit() { try { var ae = document.activeElement; if (ae && ae.isContentEditable && ae.blur) ae.blur(); } catch (e) { } try { S.flush(); } catch (e) { } }
  /* apresentação em branco: um slide branco, sem elementos nem imagem de fundo (o título não conta) */
  function blankDeck(d) { var s = d && d.slides; return !!s && s.length === 1 && !(s[0].els || []).length && !s[0].bgImg && String(s[0].bg || '#FFFFFF').toUpperCase() === '#FFFFFF'; }

  /* ---------------------------------------------------------------- fila local (IndexedDB "canteiro-cloud") — cada registro leva o id de quem o criou */
  var dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var r = indexedDB.open('canteiro-cloud', 2);
        r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('pending')) d.createObjectStore('pending', { keyPath: 'id' }); if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }); };
        r.onsuccess = function () { var d = r.result; d.onversionchange = function () { try { d.close(); } catch (e) { } dbp = null; }; res(d); };   /* "Sair" apaga o banco: esta aba solta a conexão */
        r.onerror = function () { res(null); }; r.onblocked = function () { res(null); };
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
  function pendingRec(str) { return { id: ID, json: str, baseRev: A.rev, ts: Date.now(), title: S.deck.title || '', uid: A.uid0 }; }
  function pendingPut(rec) { if (A.gone) return Promise.resolve(null); return idbOp('pending', 'readwrite', function (s) { return s.put(rec); }); }
  function pendingGet() { return idbOp('pending', 'readonly', function (s) { return s.get(ID); }); }
  function pendingDel() { return idbOp('pending', 'readwrite', function (s) { return s.delete(ID); }); }
  function pendingSnapshot() { try { S.flush(); } catch (e) { } fixId(); return pendingPut(pendingRec(JSON.stringify(S.deck))); }

  /* ---------------------------------------------------------------- pílula de estado */
  var pill = null, pillWrap = null;
  var LAB = {
    loading: function () { return { l: 'Abrindo…', m: 'Abrindo…' }; },
    saved: function () { var t = hhmm(A.savedAt || new Date()); return { l: 'Salvo na nuvem às ' + t, m: 'Salvo às ' + t }; },
    saving: function () { var u = A.upl; return u ? { l: 'Enviando imagens (' + u.done + ' de ' + u.total + ')…', m: 'Enviando ' + u.done + '/' + u.total } : { l: 'Salvando…', m: 'Salvando…' }; },
    offline: function () { return { l: 'Sem conexão — alterações guardadas neste computador', m: 'Sem conexão' }; },
    reconnecting: function () { return { l: 'Reconectando…', m: 'Reconectando…' }; },
    throttled: function () { return { l: 'Aguardando o servidor — alterações guardadas neste computador', m: 'Aguardando…' }; },
    conflict: function () { return { l: 'Conflito — escolha como resolver', m: 'Conflito' }; },
    readonly: function () { return { l: 'Somente leitura', m: 'Somente leitura' }; },
    expired: function () { return { l: 'Sessão expirada — alterações guardadas neste computador', m: 'Sessão expirada' }; },
    rejected: function () { return { l: 'Conteúdo recusado pela nuvem — abra o menu', m: 'Não salvo' }; },
    error: function () { return { l: 'Não foi possível salvar — abra o menu', m: 'Erro ao salvar' }; }
  };
  function setStatus(k) {
    var was = A.status; A.status = k; if (!pill) return;
    if (k === 'offline' && was !== 'offline' && was !== 'reconnecting' && was !== 'loading') toast(LAB.offline().l + '.');
    var t = LAB[k](); pill.dataset.state = k;
    pill.querySelector('.cl-t-long').textContent = t.l; pill.querySelector('.cl-t-mid').textContent = t.m;
    pill.setAttribute('aria-label', t.l + '. Abrir menu da nuvem'); pill.title = t.l;
    if (k !== was || k !== 'saving') liveSay(t.l); fitPill();
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
  function retry() { A.failures = 0; A.blocked = false; A.waitUntil = 0; saveNow({ force: true, retryRejected: true }); }
  function menuItems() {
    var it = [];
    if (A.status === 'rejected') it.push({ id: 'why', t: 'Ver o que impede salvar…', fn: showRejected });
    if (/^(error|offline|throttled|rejected)$/.test(A.status)) it.push({ id: 'retry', t: 'Tentar salvar de novo', fn: retry });
    if (A.status === 'conflict') it.push({ id: 'conflict', t: 'Resolver o conflito…', fn: function () { if (A.conflict) showConflict(A.conflict); } });
    if (A.status === 'expired') it.push({ id: 'login', t: 'Entrar de novo…', fn: showExpired });
    it.push({ id: 'snap', t: 'Salvar versão agora…', k: 'Ctrl+S', fn: versionDialog });
    it.push({ id: 'hist', t: 'Histórico de versões…', fn: historyDialog });
    it.push({ id: 'cmts', t: 'Comentários' + (CM.n ? ' (' + CM.n + ')' : '') + '…', fn: cmToggle });
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

  /* ---------------------------------------------------------------- caixas de diálogo (foco preso, Esc, rolagem do fundo travada; visual do modal do editor) */
  var dlg = null;
  function openDialog(o) {
    closeDialog('replace');
    var prev = document.activeElement, id = 'cld' + Math.random().toString(36).slice(2, 7);
    var box = h('div', { class: 'cl-dlg' + (o.wide ? ' wide' : ''), role: o.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + 't', 'aria-describedby': id + 'd' });
    box.appendChild(h('div', { class: 'cl-dh' }, [h('div', { class: 'cl-dic' }, [svgIc(o.icon || (o.alert ? 'alert' : 'cloud'))]), h('div', {}, [o.eyebrow ? h('div', { class: 'cl-ey', text: o.eyebrow }) : null, h('h2', { id: id + 't', text: o.title })])]));
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
  /* "quieto": não abrir caixa por cima de quem digita, de outra caixa, da capa ou da apresentação */
  function busyUser() { return !!(dlg || editable(document.activeElement) || coverOpen() || xpOpen() || isOpenEl('#presenter') || isOpenEl('#modal') || A.loading); }

  /* ---------------------------------------------------------------- teclado
     Enquanto uma caixa, o menu ou as telas "Abrindo…"/erro da nuvem estão abertos, o editor por trás não recebe teclado e o navegador não recarrega,
     não abre "Salvar página como" nem o seletor de arquivos (digitar nos campos continua valendo). */
  var loadEl = null, fatalEl = null;
  function browserKey(e) { var lk = (e.key || '').toLowerCase(); return e.key === 'F1' || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (/^[sodp]$/.test(lk) || (lk === 'a' && !editable(e.target)))); }
  function trapTab(e, root) {
    var f = Array.prototype.filter.call(root.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'), function (x) { return x.offsetParent !== null; });
    e.preventDefault(); if (f.length) { var i = f.indexOf(document.activeElement); f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus(); }
  }
  addEventListener('keydown', function (e) {
    var k = e.key || '', lk = k.toLowerCase(), mod = (e.ctrlKey || e.metaKey) && !e.altKey, t = e.target, scr = loadEl || fatalEl;
    if (scr) { /* "Abrindo…" e erro: nada chega ao editor por trás; F5/Ctrl+R ainda recarregam a página */
      if (k === 'Tab') trapTab(e, scr);
      else if (!(k === 'F5' || (mod && lk === 'r') || ((k === 'Enter' || k === ' ') && scr.contains(t)))) e.preventDefault();
      e.stopImmediatePropagation(); return;
    }
    if (dlg) {
      if (k === 'Escape') { if (dlg.dismissible) { e.preventDefault(); dlg.close('esc'); } }
      else if (k === 'Tab') trapTab(e, dlg.el);
      else if (k === 'Enter' && dlg.enter && t && t.matches && t.matches('input')) { e.preventDefault(); dlg.enter(); }
      else if (browserKey(e)) e.preventDefault();
      e.stopImmediatePropagation(); return;
    }
    if (menuOpen) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('.cl-mi')), i2 = items.indexOf(document.activeElement);
      if (k === 'Escape') { e.preventDefault(); closeMenu(true); }
      else if (k === 'ArrowDown') { e.preventDefault(); items[(i2 + 1) % items.length].focus(); }
      else if (k === 'ArrowUp') { e.preventDefault(); items[(i2 - 1 + items.length) % items.length].focus(); }
      else if (k === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (k === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (k === 'Tab' || k === 'F5' || k === 'F1') { closeMenu(false); return; }   /* F5 apresenta e F1 abre a ajuda sem o menu por cima */
      else if (mod && lk === 's') { e.preventDefault(); closeMenu(false); ctrlS(); }   /* o menu mostra Ctrl+S: salva a versão (não baixa) */
      else if (k !== 'Enter' && k !== ' ') e.preventDefault();   /* Delete, Ctrl+Z, letras…: nada age por trás do menu */
      e.stopImmediatePropagation(); return;
    }
    /* Esc fecha Comentários mesmo quando o foco volta ao body após excluir um item.
       A prioridade continua sendo das caixas e menus tratados acima. */
    if (k === 'Escape' && CM.el && !isOpenEl('#modal') && !xpOpen()) {
      e.preventDefault(); e.stopImmediatePropagation(); cmClose(); return;
    }
    if (!mod || e.shiftKey || (lk !== 's' && lk !== 'o')) return;
    /* Ctrl+S = salvar uma versão agora; Ctrl+O = abrir um arquivo (nova no acervo × substituir esta). "Baixar" e "Baixar como…" continuam baixando HTML/PDF/PowerPoint */
    if (isOpenEl('#modal') || xpOpen()) return;   /* caixas do próprio editor engolem a tecla */
    e.preventDefault(); e.stopImmediatePropagation();
    if (VIEW || A.loading || coverOpen() || isOpenEl('#presenter')) return;   /* capa (manual), apresentação ou visualizar: nada acontece escondido */
    if (lk === 's') ctrlS(); else pickDeckFile();
  }, true);
  function ctrlS() {
    try { S.closeMenus(); S.flush(); } catch (er) { }
    var st = A.status;
    if (st === 'rejected') return showRejected();
    if (st === 'conflict') { toast('Resolva o conflito antes de salvar uma versão.'); if (A.conflict) showConflict(A.conflict); return; }
    if (st === 'expired') { toast('Sessão expirada: entre de novo para salvar a versão.'); return showExpired(); }
    if (st === 'readonly') { toast('Você não pode mais alterar esta apresentação: a versão não foi salva.'); return; }
    saveVersion('').then(function (ok) { toast(ok ? 'Versão salva na nuvem' : failText()); });
  }
  function failText() {
    var st = A.status;
    return st === 'offline' || st === 'reconnecting' ? 'Sem conexão: a versão não foi salva. As alterações estão guardadas neste computador e vão para a nuvem quando a conexão voltar.'
      : st === 'throttled' ? 'O servidor pediu uma pausa: a versão não foi salva agora. Tente de novo em instantes.'
        : /^(conflict|expired|readonly|rejected)$/.test(st) ? 'A versão não foi salva: veja o aviso na tela.' : 'Não foi possível salvar a versão agora.';
  }

  /* ---------------------------------------------------------------- tela de carregamento / erro (fundo da capa do Canteiro) */
  function brandMark() { return h('p', { class: 'cl-lt', 'aria-hidden': 'true' }, ['Canteiro', h('i')]); }
  function loadingUI(msg) {
    if (!loadEl) {
      loadEl = h('div', { class: 'cl-load', id: 'cloudLoad', role: 'status', 'aria-live': 'polite' }, [h('div', { class: 'cl-lc' }, [brandMark(), h('div', { class: 'cl-lm', id: 'cloudLoadMsg' }), h('div', { class: 'cl-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Progresso' }, [h('i')])])]);
      document.body.appendChild(loadEl);
    }
    $('#cloudLoadMsg').textContent = msg; return loadEl;
  }
  function loadProgress(p) { if (!loadEl) return; var b = $('.cl-bar', loadEl), pct = Math.max(0, Math.min(100, Math.round(p))); b.setAttribute('aria-valuenow', pct); b.firstChild.style.width = pct + '%'; }
  function loadDone() { if (loadEl) { loadEl.remove(); loadEl = null; } }
  function fatal(title, msg, links) {
    loadDone(); A.loading = false;
    var ov = fatalEl = h('div', { class: 'cl-load', id: 'cloudFatal', role: 'alert' }, [h('div', { class: 'cl-lc' }, [brandMark(), h('h2', { text: title }), h('p', { text: msg }), h('div', { class: 'cl-da' }, (links || [{ label: 'Voltar ao acervo', href: '/acervo' }]).map(function (l, i) { return h('a', { class: 'cl-b' + (i ? '' : ' pri'), href: l.href, text: l.label }); }))])]);
    document.body.appendChild(ov);
    setTimeout(function () { var a = ov.querySelector('a'); if (a) a.focus({ preventScroll: true }); }, 30);
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
    A.cur = S.deck;
    if (!keepBase) A.lastSavedStr = JSON.stringify(S.deck);
    document.title = (S.deck.title || 'Apresentação') + ' · Canteiro';
  }
  function loadPresentation() { return jreq('GET', '/presentations/' + ID); }
  async function boot() {
    loadingUI(VIEW ? 'Abrindo apresentação…' : 'Abrindo apresentação para edição…'); loadProgress(4);
    var sess;
    try { sess = await loadSession(); } catch (e) { return fatal('Sem conexão', 'Não foi possível falar com o servidor. Verifique a internet e tente de novo.', [{ label: 'Tentar de novo', href: location.pathname }, { label: 'Voltar ao acervo', href: '/acervo' }]); }
    if (!sess.authenticated) return goLogin();
    A.uid0 = me && me.id; userSwitch();
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
    quietLocalStores(); bridgeStart(); cmLoad(true);
    if (VIEW) { startView(p); urlTasks(); return; }
    prefsStart();
    setStatus(A.dirty ? 'saving' : 'saved'); if (!navigator.onLine) setStatus('offline');
    if (A.dirty) saveNow({ force: true });
    urlTasks(); externalCheck(JSON.stringify(S.deck));
  }

  /* ---------------------------------------------------------------- recuperar alterações não salvas (fila local)
     Decide por conteúdo e revisão (baseRev × rev do servidor), nunca pelo relógio deste computador contra o do servidor. */
  async function offerRecovery(p) {
    var rec = await pendingGet(); if (!rec || !rec.json) return;
    if (!A.uid0 || rec.uid !== A.uid0) { await pendingDel(); return; }   /* de outra pessoa (computador compartilhado) ou sem dono: nunca é oferecido nem enviado */
    var same = false, pd = null;
    try { pd = JSON.parse(rec.json); var a = S.safeDeck ? S.safeDeck(JSON.parse(rec.json)) : pd; if (a) { a.id = ID; same = JSON.stringify(a) === A.lastSavedStr; } } catch (e) { pd = null; }
    if (!pd || same) { await pendingDel(); return; }
    var moved = !(rec.baseRev >= p.rev);
    loadDone();
    await new Promise(function (res) {
      openDialog({
        icon: 'clock', eyebrow: 'Alterações neste computador', title: 'Recuperar alterações não salvas?', alert: true, dismissible: false,
        body: ['Este computador guardou alterações (feitas ' + when(rec.ts) + ', sobre a versão ' + rec.baseRev + ') que ainda não chegaram à nuvem' + (moved ? '. Depois disso, a apresentação foi alterada na nuvem (versão ' + p.rev + '): se recuperar, você escolherá como juntar as duas versões' : '') + '.'],
        actions: [
          { label: 'Descartar', id: 'discard', fn: function () { return pendingDel().then(function () { res(); }); } },
          { label: 'Recuperar alterações', id: 'recover', kind: 'pri', fn: function () { applyDeck(pd, true); A.rev = rec.baseRev; A.dirty = true; A.seq++; res(); } }
        ]
      });
    });
  }

  /* ---------------------------------------------------------------- autosave */
  addEventListener('am:commit', function () { if (A.hold) return; A.cur = S.deck; onChange(); });
  /* Abrir…, importar (substituir), projetos prontos: trocam o deck inteiro. Numa apresentação em branco (ou depois de "Substituir esta") a troca
     vale no lugar, com um ponto "Antes de substituir" no histórico; numa apresentação com conteúdo a da nuvem volta e a pessoa escolhe (BE-ED-04). */
  addEventListener('am:load', function () {
    if (A.own || VIEW || A.loading) return;
    var next = S.deck, prev = A.cur;
    if (A.replaceOk || !prev || blankDeck(prev)) { A.replaceOk = false; A.cur = next; fixId(); A.preSnapshot = !!prev && !blankDeck(prev); onChange(); externalCheck(JSON.stringify(next)); return; }
    A.hold = true; /* quem chamou loadDeck ainda termina o trabalho dele (relatório da importação) antes da volta */
    queueMicrotask(function () { A.hold = false; applyDeck(prev, true); askReplace(next); });
  });
  function onChange() {
    if (VIEW || A.loading || A.gone) return;
    fixId(); A.seq++; A.dirty = true; document.title = (S.deck.title || 'Apresentação') + ' · Canteiro';
    schedulePersist();
    if (A.blocked) return;
    if (A.rej) { if (rejFp(A.rej.issues) === A.rej.fp) return; A.rej = null; }   /* o trecho recusado não mudou: não adianta tentar de novo */
    if (A.waitUntil > Date.now()) return;   /* 429: a nova tentativa já está marcada (Retry-After) */
    if (!/^(offline|reconnecting|throttled)$/.test(A.status)) setStatus('saving');
    clearTimeout(A.timer); A.timer = setTimeout(function () { saveNow({}); }, DEBOUNCE);
  }
  var persistT = null;
  var persistedStr = '';
  function schedulePersist() { clearTimeout(persistT); persistT = setTimeout(function () { try { S.flush(); } catch (e) { } fixId(); var str = JSON.stringify(S.deck); if (str === persistedStr || str === A.lastSavedStr) return; persistedStr = str; pendingPut(pendingRec(str)); }, 1200); }
  function backoff() { var n = Math.min(6, A.failures), base = Math.min(60000, 1000 * Math.pow(2, Math.max(0, n - 1))); return Math.round(base * (0.75 + Math.random() * 0.5)); }
  function saveNow(o) {
    o = o || {};
    if (VIEW || A.gone || (A.blocked && !o.resolution)) return Promise.resolve(false);
    if (A.rej && !o.resolution) { if (!o.retryRejected && rejFp(A.rej.issues) === A.rej.fp) { setStatus('rejected'); return Promise.resolve(false); } A.rej = null; }
    if (A.waitUntil > Date.now() && !o.resolution) return Promise.resolve(false);
    if (A.inflight) { A.again = true; return (o.snapshot || o.resolution) ? A.inflight.then(function () { return saveNow(o); }) : A.inflight; }
    clearTimeout(A.timer); clearTimeout(A.retryTimer);
    var run = doSave(o).then(function (ok) { return ok; }, function (e) { return handleSaveError(e, o); });
    A.inflight = run;
    run.then(function () { A.inflight = null; if (A.again && A.dirty && !A.blocked && !A.rej) { A.again = false; clearTimeout(A.timer); A.timer = setTimeout(function () { saveNow({}); }, 400); } else A.again = false; });
    return run;
  }
  function saveVersion(label) { return saveNow({ snapshot: true, label: label || '', force: true }); }
  /* corpo JSON já codificado em UTF-8: o limite da função (4,5 MB) é em BYTES — "ç", "ã", "é" contam 2 —, então mede-se e envia-se a mesma codificação */
  function utf8(obj) { return new TextEncoder().encode(JSON.stringify(obj)); }
  function tooLarge(n) { return new ApiError(413, 'too_large', 'A apresentação ficou grande demais para salvar de uma vez (' + (n / 1048576).toFixed(1).replace('.', ',') + ' MB; limite ' + Math.round(MAX_DECK / 1048576) + ' MB por salvamento). Reduza ou remova imagens pesadas, ou divida em duas apresentações. Seu trabalho continua guardado neste navegador.', null, false); }
  function sendJson(method, path, bytes) { return raw(method, path, { body: bytes, headers: { 'Content-Type': 'application/json' } }).then(function (res) { return res.status === 204 ? null : res.json(); }); }
  function putContent(body) { return body instanceof Uint8Array ? sendJson('PUT', '/presentations/' + ID + '/content', body) : jreq('PUT', '/presentations/' + ID + '/content', body); }
  function forgetKnown() { A.shaCache.forEach(function (v, k) { if (String(k).slice(0, 6) === 'known:') A.shaCache.delete(k); }); }
  function upProgress(p) { if (p.phase !== 'upload' || p.total < 3) return; A.upl = { done: p.done, total: p.total }; if (A.status === 'saving') setStatus('saving'); }
  async function doSave(o) {
    try { S.flush(); } catch (e) { }
    fixId();
    var str = JSON.stringify(S.deck), seqAt = A.seq, baseRev = o.baseRev != null ? o.baseRev : A.rev;
    if (!o.snapshot && !o.resolution && str === A.lastSavedStr) { A.dirty = false; await pendingDel(); setStatus(navigator.onLine ? 'saved' : 'offline'); return true; }
    if (A.status !== 'reconnecting') setStatus('saving');
    await pendingPut(pendingRec(str)); /* guarda aqui antes de tentar a rede */
    var deck = JSON.parse(str), ext;
    try { ext = await prepareContent(deck, upProgress); }
    catch (e) { forgetKnown(); throw e; }
    finally { if (A.upl) { A.upl = null; if (A.status === 'saving') setStatus('saving'); } }
    if (A.preSnapshot && A.lastContent && !o.resolution) { /* o deck inteiro foi trocado (Abrir…, projeto pronto…): guarda um ponto com o que estava na nuvem */
      try { await putContent({ baseRev: baseRev, content: A.lastContent, snapshot: true, label: 'Antes de substituir' }); } catch (e) { if (e.status === 409 || e.network) throw e; }
      A.preSnapshot = false;
    }
    var body = { baseRev: baseRev, content: ext.content };
    if (o.snapshot) { body.snapshot = true; if (o.label) body.label = String(o.label).slice(0, 80); }
    if (o.resolution) body.resolution = o.resolution;
    var th = await maybeThumb(deck); if (th) body.thumbSha = th;
    var bytes = utf8(body);
    if (bytes.length > MAX_DECK) throw tooLarge(bytes.length);
    var r;
    try { r = await putContent(bytes); }
    catch (e) { if (e.status === 422 && e.details && e.details.missing && !o.retried422) { forgetKnown(); return doSave(Object.assign({}, o, { retried422: true })); } e.deck = deck; throw e; }
    A.rev = r.rev; A.lastSavedStr = str; A.lastContent = ext.content; A.failures = 0; A.savedAt = new Date(r.savedAt || Date.now()); A.preSnapshot = false; A.rej = null; A.bigShown = false;
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
    if (e.status === 429) { /* limite de envios (ex.: importar um PDF com muitas imagens): não é falta de conexão — espera o Retry-After e continua de onde parou */
      A.failures++; var w = Math.max(1000, (e.retryAfter || 2) * 1000) + Math.round(Math.random() * 400);
      A.waitUntil = Date.now() + w; setStatus('throttled');
      clearTimeout(A.retryTimer); A.retryTimer = setTimeout(function () { A.waitUntil = 0; if (A.dirty && !A.blocked) { setStatus('saving'); saveNow({ force: true }); } }, w);
      return false;
    }
    if (e.network || e.status >= 500 || e.status === 408) {
      A.failures++; setStatus('offline');
      var wait = Math.max(backoff(), (e.retryAfter || 0) * 1000);
      clearTimeout(A.retryTimer); A.retryTimer = setTimeout(function () { if (A.dirty && !A.blocked) { setStatus('reconnecting'); saveNow({ force: true }); } }, wait);
      return false;
    }
    if (e.status === 413) {   /* grande demais: explica uma vez (caixa) e depois só avisa, até voltar a salvar */
      var tm = e.code === 'too_large' ? e.message : 'A apresentação é grande demais para o servidor aceitar de uma vez (limite de ~4 MB por salvamento). Reduza ou remova imagens pesadas, ou divida em duas apresentações. Seu trabalho continua guardado neste navegador.';
      setStatus('error');
      if (A.bigShown || busyUser()) toast(tm); else { A.bigShown = true; openDialog({ icon: 'alert', eyebrow: 'Tamanho', title: 'A apresentação ficou grande demais para salvar', alert: true, body: [tm], actions: [{ label: 'Entendi', id: 'ok', kind: 'pri', fn: function () { } }] }); }
      return false;
    }
    if (e.status === 422 && e.code === 'rejected_content') { rejected(e); return false; }
    setStatus('error'); toast(e.message || 'Não foi possível salvar.'); return false;
  }
  addEventListener('online', function () {
    if (VIEW) return;
    if (A.dirty && !A.blocked && !A.rej && A.status !== 'throttled') { A.failures = 0; setStatus('reconnecting'); saveNow({ force: true }); } else if (!A.dirty && A.status === 'offline') setStatus('saved');
    bridgeFlush();
  });
  addEventListener('offline', function () { if (!VIEW && pill && A.status !== 'rejected') setStatus('offline'); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && A.uid0 && !A.gone) loadSession().then(function (s) { if (s.authenticated && s.user && s.user.id !== A.uid0) otherUser(s.user); }, function () { });
    if (VIEW) return;
    if (document.visibilityState === 'hidden') { try { S.flush(); } catch (e) { } if (A.dirty && !A.blocked) saveNow({ force: true }); else if (A.dirty) schedulePersist(); }
    else if (A.dirty && !A.blocked && A.status === 'offline') saveNow({ force: true });
    bridgeFlush();
  });
  addEventListener('pagehide', function () { if (VIEW || A.loading) return; endTextEdit(); if (A.dirty) { pendingSnapshot(); if (!A.blocked) saveNow({ force: true }); } });
  addEventListener('beforeunload', function (e) {
    if (VIEW) return;
    endTextEdit();
    if (A.allowLeave || A.gone) return;
    if (unsaved()) { e.preventDefault(); e.returnValue = ''; if (!A.blocked) saveNow({ force: true }); }
    else e.stopImmediatePropagation(); /* já está na nuvem: o aviso de "desfazer" do editor não se aplica */
  }, true);

  /* ---------------------------------------------------------------- conteúdo recusado (422 rejected_content): diz em QUAL slide e não repete o mesmo PUT */
  var WHY = { tag_perigosa: 'código HTML não permitido (como <script>, <form> ou <iframe>)', atributo_evento: 'código HTML com evento (on…=)', atributo_perigoso: 'código HTML não permitido', url_perigosa: 'endereço ou imagem em formato não permitido', svg_embutido: 'imagem SVG embutida', data_html: 'conteúdo embutido não permitido', estilo_perigoso: 'estilo (CSS) não permitido', imagem_nao_externalizada: 'imagem que não foi enviada como arquivo', referencia_asset_invalida: 'referência de imagem inválida', asset_inexistente: 'imagem que não está no servidor (insira de novo)', string_grande_demais: 'texto ou imagem grande demais', slides_demais: 'mais de 500 slides', chave_proibida: 'dado com nome não permitido', estrutura_invalida: 'estrutura inválida' };
  var KINDN = { text: 'texto', image: 'imagem', shape: 'forma', line: 'linha', brand: 'marca', fx: 'elemento' };
  function issuesOf(e) {
    var d = e.details || {}, deck = e.deck, out = [];
    if (Array.isArray(d.issues)) d.issues.slice(0, 20).forEach(function (it) { if (it && typeof it === 'object') out.push({ slide: it.slide >= 1 ? Math.floor(it.slide) : null, el: typeof it.elementId === 'string' ? it.elementId : null, reason: String(it.reason || '') }); });
    else if (Array.isArray(d.findings)) d.findings.slice(0, 20).forEach(function (f) { /* servidor antigo: "slides[2].els[0].src" */
      var m = /^slides\[(\d+)\](?:\.els\[(\d+)\])?/.exec(String(f && f.path || '')), s = m ? +m[1] : -1, x = m && m[2] != null && deck && deck.slides && deck.slides[s] && deck.slides[s].els ? deck.slides[s].els[+m[2]] : null;
      out.push({ slide: m ? s + 1 : null, el: x && x.id || null, reason: String(f && f.reason || '') });
    });
    if (!out.length) out.push({ slide: null, el: null, reason: String((d.reasons || [])[0] || '') });
    return out;
  }
  function findEl(id) { var sl = S.deck.slides; for (var i = 0; i < sl.length; i++) for (var j = 0; j < (sl[i].els || []).length; j++) if (sl[i].els[j].id === id) return { el: sl[i].els[j], i: i }; return null; }
  function issueSlide(it) { var f = it.el && findEl(it.el); return f ? f.i + 1 : it.slide; }
  function issueText(it) {
    var f = it.el && findEl(it.el), n = issueSlide(it);
    return (n ? 'Slide ' + n : 'Apresentação') + (f ? ' · ' + (KINDN[f.el.type] || 'elemento') : '') + ': ' + (WHY[it.reason] || 'conteúdo que a nuvem não aceita');
  }
  /* "impressão digital" do que foi recusado: enquanto não mudar, o autosave não repete o PUT (que seria recusado de novo) */
  function rejFp(issues) {
    var d = S.deck;
    return JSON.stringify(issues.map(function (it) {
      var f = it.el && findEl(it.el); if (f) return f.el;
      if (it.slide && d.slides[it.slide - 1]) return d.slides[it.slide - 1];
      var o = {}; Object.keys(d).forEach(function (k) { if (k !== 'slides') o[k] = d[k]; }); return o;
    }));
  }
  function rejected(e) {
    var issues = issuesOf(e); A.rej = { issues: issues, fp: rejFp(issues) }; A.failures = 0;
    setStatus('rejected');
    if (busyUser()) toast('A nuvem recusou o conteúdo (' + issueText(issues[0]) + '). Abra o menu da nuvem para ver.');
    else showRejected();
  }
  function showRejected() {
    var R = A.rej; if (!R) return;
    var it0 = R.issues[0], n0 = issueSlide(it0);
    openDialog({
      icon: 'alert', eyebrow: 'Conteúdo recusado', title: 'A nuvem não aceitou parte desta apresentação', alert: true,
      body: ['As alterações continuam guardadas neste computador, mas não vão para a nuvem enquanto isto não for corrigido:',
        h('ul', { class: 'cl-opts' }, R.issues.slice(0, 6).map(function (it) { return h('li', { text: issueText(it) }); })),
        'Corrija ou apague o que está indicado (imagem: insira de novo em PNG ou JPEG) e a apresentação volta a ser salva sozinha.'],
      actions: [{ label: 'Fechar', fn: function () { } }].concat(n0 ? [{ label: 'Ir ao slide ' + n0, id: 'goto', kind: 'pri', fn: function () { setTimeout(function () { try { S.goSlide(n0 - 1); if (it0.el && findEl(it0.el)) S.select(it0.el); } catch (x) { } }, 0); } }] : [])
    });
  }

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
      var ext = await prepareContent(deck);
      await jreq('PUT', '/presentations/' + dup.id + '/content', { baseRev: dup.rev, content: ext.content, snapshot: true, label: 'Cópia a partir de um conflito' });
      A.dirty = false; await pendingDel(); toast('Cópia criada. Abrindo…'); goEditor(dup.id);
    } catch (e) { toast('Não foi possível criar a cópia: ' + (e.message || 'tente de novo') + '.'); if (A.conflict) setTimeout(function () { showConflict(A.conflict); }, 0); throw e; }
  }

  /* ---------------------------------------------------------------- sessão expirada / sem permissão / apagada / outra pessoa */
  function showExpired() {
    openDialog({
      icon: 'lock', eyebrow: 'Sessão', title: 'Sua sessão expirou', alert: true,
      body: ['Suas alterações continuam guardadas neste computador e nada foi perdido. Entre de novo numa nova aba (este editor permanece aberto) e volte aqui para continuar.'],
      actions: [
        { label: 'Fechar', fn: function () { } },
        { label: 'Entrar numa nova aba', id: 'login', kind: 'pri', fn: function () { window.open('/entrar?next=' + encodeURIComponent('/editor/' + ID) + '&aba=1', '_blank', 'noopener'); return true; } },
        { label: 'Já entrei — tentar de novo', id: 'retry', kind: 'or', fn: function () {
          return loadSession().then(function (s) { if (s.authenticated && s.user && A.uid0 && s.user.id !== A.uid0) { otherUser(s.user); return false; } if (s.authenticated) { A.blocked = false; A.failures = 0; setStatus('saving'); saveNow({ force: true }); bridgeFlush(); return false; } toast('Ainda não há sessão ativa. Entre na outra aba primeiro.'); return true; }, function () { toast('Sem conexão.'); return true; });
        } }
      ]
    });
  }
  function showReadOnly() {
    openDialog({
      icon: 'lock', eyebrow: 'Permissão', title: 'Você não pode mais alterar esta apresentação', alert: true,
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
  /* outra conta entrou neste navegador (em outra aba): esta página para de salvar e de enviar respostas — nada vai com a identidade errada */
  function otherUser(u) {
    if (A.gone) return; A.gone = true; A.blocked = true; outbox.length = 0; clearTimeout(A.timer); clearTimeout(A.retryTimer); if (pill) setStatus('readonly');
    openDialog({
      icon: 'lock', eyebrow: 'Sessão', title: 'Outra pessoa entrou neste navegador', alert: true, dismissible: false,
      body: ['Agora quem está conectado é ' + ((u && u.displayName) || 'outra conta') + '. Por segurança, esta página parou de salvar e de enviar respostas. Recarregue para continuar com a conta atual.'],
      actions: [{ label: 'Recarregar', id: 'reload', kind: 'pri', fn: function () { A.allowLeave = true; location.reload(); return true; } }]
    });
  }

  /* ---------------------------------------------------------------- versões, histórico, cópia, link */
  function versionDialog() {
    var inp = h('input', { type: 'text', class: 'cl-in', id: 'cloudVerLabel', maxlength: '80', placeholder: 'Ex.: versão enviada ao cliente', 'data-autofocus': '1' });
    var dd = openDialog({
      icon: 'clock', eyebrow: 'Histórico de versões', title: 'Salvar versão agora',
      body: ['Guarda um ponto no histórico com o estado atual da apresentação. Você poderá restaurá-lo depois.', h('label', { class: 'cl-lb', for: 'cloudVerLabel', text: 'Rótulo (opcional)' }), inp],
      actions: [{ label: 'Cancelar', fn: function () { } }, { label: 'Salvar versão', id: 'dosnap', kind: 'pri', fn: function () { return doIt(); } }]
    });
    function doIt() { return saveVersion(inp.value.trim()).then(function (ok) { if (ok) { toast('Versão salva na nuvem'); return false; } toast(failText()); return true; }); }
    dd.enter = function () { var b = dd.el.querySelector('[data-act=dosnap]'); if (b) b.click(); };
  }
  var KIND = { create: 'Criada', auto: 'Automática', manual: 'Manual', pre_overwrite: 'Antes de sobrescrever', pre_restore: 'Antes de restaurar', restore: 'Restauração', copy: 'Cópia', import: 'Importação' };
  async function historyDialog() {
    var list = h('ul', { class: 'cl-vl', role: 'listbox', 'aria-label': 'Versões', tabindex: '0' }), prevBox = h('div', { class: 'cl-vp' }, [h('p', { class: 'cl-mut', text: 'Escolha uma versão para ver o primeiro slide.' })]), sel = null, items = [];
    var dd = openDialog({
      icon: 'clock', eyebrow: 'Histórico de versões', title: 'Versões desta apresentação', wide: true,
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
          var saved = await saveNow({ force: true });
          // Restaurar substitui o deck atual: não descartar alterações locais
          // por acidente se a gravação prévia falhou ou recebeu nova edição.
          if (!saved || A.dirty) {
            toast('Restauração cancelada: suas alterações ainda não foram salvas na nuvem.');
            return true;
          }
          await jreq('POST', '/presentations/' + ID + '/versions/' + v.no + '/restore', { baseRev: A.rev });
          var p = await loadPresentation(), deck = await hydrate(p.content, false);
          A.rev = p.rev; A.lastContent = p.content; applyDeck(deck); A.dirty = false; A.seq++; A.rej = null; await pendingDel(); A.savedAt = new Date(); setStatus('saved'); toast('Versão restaurada.');
        } catch (e) { if (e.status === 409) showConflict(e.details); else toast('Não foi possível restaurar: ' + (e.message || 'tente de novo') + '.'); }
        return true;
      });
    }
  }
  async function makeCopy() {
    try {
      if (!VIEW) {
        endTextEdit();
        var saved = await saveNow({ force: true });
        // O servidor duplica a versão na nuvem, não o deck desta aba. Nunca
        // abrir uma cópia desatualizada quando ainda há alterações por enviar.
        if (!saved || A.dirty) {
          toast('Cópia não criada: suas alterações ainda não foram salvas na nuvem. Tente de novo quando aparecer “Salvo na nuvem”.');
          return;
        }
      }
      var dup = await jreq('POST', '/presentations/' + ID + '/duplicate', {});
      toast('Cópia criada. Abrindo…'); goEditor(dup.id);
    } catch (e) { toast('Não foi possível criar a cópia: ' + (e.message || 'tente de novo') + '.'); }
  }
  async function shareLink() {
    try {
      var r = await jreq('GET', '/presentations/' + ID + '/share'), url = r.url, ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { }
      if (ok) toast('Link copiado: todos os usuários do Canteiro podem visualizar.');
      else openDialog({ icon: 'link', eyebrow: 'Compartilhar', title: 'Copie o link', body: ['Todos os usuários do Canteiro podem visualizar esta apresentação (somente leitura).', h('input', { class: 'cl-in', type: 'text', readonly: '', value: url, 'data-autofocus': '1', 'aria-label': 'Link da apresentação' })], actions: [{ label: 'Fechar', kind: 'pri', fn: function () { } }] });
    } catch (e) { toast('Não foi possível gerar o link.'); }
  }
  /* sair desta apresentação: salva o que estiver pendente; com algo ainda não enviado, pergunta */
  async function leaveOk() {
    endTextEdit();
    if (VIEW || A.gone) return true;
    if ((A.dirty || A.inflight) && !A.blocked) { if (!A.rej) setStatus('saving'); await saveNow({ force: true }); }
    if (A.dirty) return confirmDialog('Sair com alterações não enviadas?', 'Há alterações que ainda não chegaram à nuvem. Elas ficam guardadas neste computador e você poderá recuperá-las ao abrir esta apresentação de novo.', 'Sair mesmo assim', 'Continuar editando', true);
    return true;
  }
  async function goAcervo(aba) {
    if (!(await leaveOk())) return;
    A.allowLeave = true; location.assign('/acervo?' + (typeof aba === 'string' ? 'aba=' + aba + '&' : '') + 'foco=' + encodeURIComponent(ID));
  }

  /* ---------------------------------------------------------------- Novo / Abrir… / projetos prontos na nuvem (nunca apagam nem renomeiam a apresentação aberta) */
  async function cloudNew() {
    if (VIEW || A.loading) return;
    try { S.closeMenus(); } catch (e) { }
    if (!(await leaveOk())) return;
    try { toast('Criando apresentação nova no acervo…'); var r = await jreq('POST', '/presentations', { source: 'new' }); goEditor(r.id); }
    catch (e) { toast('Não foi possível criar a apresentação: ' + (e.message || 'tente de novo') + '.'); }
  }
  function dlHtml() { try { var n = S.save(true); if (n) toast('Arquivo baixado: ' + n); } catch (e) { toast('Não foi possível gerar o arquivo.'); } }
  function pickDeckFile() { if (VIEW || A.loading) return; endTextEdit(); try { S.closeMenus(); } catch (e) { } var f = $('#fOpen'); if (f) { f.value = ''; f.click(); } }
  function askReplace(next) {
    openDialog({
      icon: 'file', eyebrow: 'Abrir na nuvem', title: 'Abrir “' + (next.title || 'Apresentação') + '”', alert: true,
      body: ['Esta apresentação já tem conteúdo. Crie uma apresentação nova no acervo com o que você abriu, ou substitua o conteúdo desta — o estado atual fica guardado no histórico de versões.'],
      actions: [
        { label: 'Cancelar', id: 'cancel', fn: function () { } },
        { label: 'Substituir esta (a atual fica no histórico)', id: 'replace', fn: function () { A.replaceOk = true; S.loadDeck(next, 'Conteúdo substituído · o anterior está no histórico de versões', true, true); } },
        { label: 'Criar como nova apresentação no acervo', id: 'new', kind: 'pri', fn: function () { return createFrom(next).then(function () { return true; }, function () { return true; }); } }
      ]
    });
  }
  async function createFrom(deck) {
    if (!(await leaveOk())) return;
    try {
      toast('Criando apresentação nova no acervo…');
      var d = JSON.parse(JSON.stringify(deck)), ext = await prepareContent(d), bytes = utf8({ title: String(d.title || 'Apresentação').slice(0, 200), content: ext.content, source: 'import' });
      if (bytes.length > MAX_DECK) throw tooLarge(bytes.length);
      var r = await sendJson('POST', '/presentations', bytes);
      goEditor(r.id);
    } catch (e) { toast('Não foi possível criar a apresentação: ' + (e.status === 422 && e.code === 'rejected_content' ? issueText(issuesOf(e)[0]) : e.message || 'tente de novo') + '.'); }
  }
  /* projeto pronto pedido pelo acervo (/editor/<id>?modelo=N): só numa apresentação em branco */
  function applyModel(v) {
    var C = window.AMCover, n = /^\d{1,2}$/.test(v) ? +v : -1;
    if (!C && document.readyState !== 'complete') { addEventListener('load', function () { applyModel(v); }, { once: true }); return; }
    if (!C || !C.buildTemplate || !C.templates || n < 0 || n >= C.templates.length) { toast('Projeto pronto não encontrado.'); return; }
    if (!blankDeck(S.deck)) { toast('O projeto pronto só é aplicado a uma apresentação em branco.'); return; }
    var d = C.buildTemplate(n); A.replaceOk = true; S.loadDeck(d, 'Projeto pronto: ' + C.templates[n] + ' · ' + d.slides.length + ' slides', true, true);
    saveNow({ force: true });
  }
  /* parâmetros pedidos pelo acervo: ?modelo=<0..5>, ?historico=1, ?exportar=html|pdf|pptx (só para quem edita) */
  function urlTasks() {
    var q = new URLSearchParams(location.search), mo = q.get('modelo'), hi = q.get('historico'), ex = q.get('exportar');
    if (mo == null && hi == null && ex == null) return;
    try { history.replaceState(history.state, '', location.pathname); } catch (e) { }
    if (VIEW) return;
    if (mo != null) applyModel(mo);
    if (hi === '1') historyDialog();
    else if (ex === 'html') { try { var nm = S.slug(S.deck.title) + '.html'; S.download(nm, S.exportHTML()); toast('Arquivo baixado: ' + nm); } catch (e) { toast('Não foi possível gerar o arquivo.'); } }
    else if (ex === 'pdf' || ex === 'pptx') { try { S.exportAs(ex); } catch (e) { toast('Exportação indisponível.'); } }
  }
  /* imagens com endereço https:// (vindas de um arquivo aberto): a CSP do editor só mostra imagens do próprio acervo — explica como resolver */
  var EXT_RE = /"(?:src|bgImg)":"https?:\/\//g;
  function externalCheck(str) {
    if (VIEW) return;
    var n = (String(str).match(EXT_RE) || []).length; if (n <= A.extN) { A.extN = n; return; } A.extN = n;
    var t = n === 1 ? 'Uma imagem desta apresentação não aparece na versão online' : n + ' imagens desta apresentação não aparecem na versão online';
    if (busyUser()) { toast(t + ': baixe a imagem e insira do computador.'); return; }
    openDialog({
      icon: 'image', eyebrow: 'Imagens da internet', title: t,
      body: ['Elas apontam para endereços da internet (https://…). Por segurança, o Canteiro online só mostra imagens guardadas no próprio acervo.',
        h('p', {}, [h('b', { text: 'Como resolver: ' }), 'baixe cada imagem para o computador e insira de novo pelo botão Imagem (ou “Trocar imagem”, no painel da direita). Ela passa a ficar guardada na nuvem com a apresentação.'])],
      actions: [{ label: 'Entendi', kind: 'pri', fn: function () { } }]
    });
  }

  /* ---------------------------------------------------------------- Início, marca, Novo e Abrir na barra; arrastar arquivos; menus do editor */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#bHome, #top .brand, #bNew, #bOpen, #bSave'); if (!b || VIEW) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (b.id === 'bNew') cloudNew(); else if (b.id === 'bOpen') pickDeckFile(); else if (b.id === 'bSave') dlHtml(); else goAcervo();
  }, true);
  document.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('#top .brand')) { e.preventDefault(); e.stopImmediatePropagation(); goAcervo(); } }, true);
  ['dragover', 'drop'].forEach(function (ty) {
    document.addEventListener(ty, function (e) {
      if (VIEW || A.loading || !e.dataTransfer) return;
      if (e.target.closest && e.target.closest('#cover')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'none'; return; }   /* capa: soltar arquivo não troca a apresentação da nuvem */
      var f = ty === 'drop' && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /\.(html?|json)$/i.test(f.name || '')) { e.preventDefault(); e.stopPropagation(); var w = $('#wrap'); if (w) w.classList.remove('dragover'); endTextEdit(); S.openFile(f); }   /* sem a caixa do editor ("O que não foi salvo com Salvar apresentação…"): a escolha nova × substituir vem depois */
    }, true);
  });
  /* menus do editor (Arquivo, Baixar como…): na nuvem "Salvar" é automático e o que gera arquivo diz "Baixar"; Início, Novo, Abrir e Minhas obras ganham o comportamento da nuvem */
  var XFIX = {
    'Início (capa)': { t: 'Voltar ao acervo', fn: function () { goAcervo(); } },
    'Nova apresentação': { t: 'Nova apresentação no acervo', fn: cloudNew },
    'Abrir…': { t: 'Abrir arquivo…', fn: pickDeckFile },
    'Minhas obras…': { t: 'Acervo da nuvem…', fn: function () { goAcervo('minhas'); } },
    'Salvar apresentação': { t: 'Baixar arquivo (.html)', k: '', fn: dlHtml },
    'Salvar como PDF…': { t: 'Baixar como PDF…' },
    'Salvar como PowerPoint…': { t: 'Baixar como PowerPoint…' },
    'HTML interativo (.html) — com efeitos': { k: '', fn: dlHtml }
  };
  function fixMenu(m) {
    Array.prototype.forEach.call(m.querySelectorAll('.xhd'), function (x) { if (x.textContent === 'Salvar como') x.textContent = 'Baixar como'; });
    Array.prototype.forEach.call(m.querySelectorAll('.xi'), function (b) {
      var it = b._it, fx = it && XFIX[it.t]; if (!fx) return;
      b._it = Object.assign({}, it, fx.fn ? { fn: fx.fn } : {});
      var l = b.querySelector('.xl'); if (l && fx.t) l.textContent = fx.t;
      var kb = b.querySelector('kbd'); if (kb && fx.k === '') kb.replaceWith(document.createElement('span'));
    });
  }
  if (!VIEW) new MutationObserver(function (ms) { ms.forEach(function (x) { Array.prototype.forEach.call(x.addedNodes, function (n) { if (n.nodeType === 1 && n.classList.contains('xmenu')) fixMenu(n); }); }); }).observe(document.body, { childList: true });
  /* rótulos da barra e dicas: "Salvar" na nuvem é automático (Ctrl+S = versão); o botão laranja baixa o arquivo; Início e a marca levam ao acervo */
  function cloudLabels() {
    if (VIEW) return;
    var sv = $('#bSave'), l = sv && sv.querySelector('.lbl'), T = function (s, t) { var x = $(s); if (x) x.title = t; };
    if (l && !sv.dataset.cl) { sv.dataset.cl = '1'; l.textContent = 'Baixar'; l.appendChild(h('span', { class: 'lbl2', text: ' arquivo (.html)' })); sv.setAttribute('aria-label', 'Baixar arquivo (.html)'); }
    T('#bSave', 'Baixar a apresentação como arquivo .html (Ctrl+S salva uma versão na nuvem)');
    var sm = $('#bSaveMore'); if (sm) { sm.title = 'Baixar como… PDF, PowerPoint ou HTML'; sm.setAttribute('aria-label', 'Baixar como… PDF, PowerPoint ou HTML'); }
    T('#bHome', 'Voltar ao acervo'); T('#top .brand', 'Voltar ao acervo'); T('#bNew', 'Criar uma apresentação nova no acervo');
    T('#bOpen', 'Abrir um arquivo (.html ou .json): como apresentação nova no acervo ou no lugar desta');
  }
  /* Manual da obra (capa) na nuvem: os passos falam do acervo e do salvamento automático, não do rascunho deste navegador */
  function manualFix() {
    var b = $('#cvHelpBody'); if (!b || b.__cl) return; b.__cl = 1;
    var fx = function () { var ps = b.querySelectorAll('.cv-step p'); if (ps[0]) ps[0].textContent = 'Comece pelo acervo: uma apresentação nova, um projeto pronto ou a cópia de outra apresentação.'; if (ps[2]) ps[2].textContent = 'F5 apresenta (F alterna a tela cheia). Na nuvem tudo é salvo sozinho; Ctrl+S guarda uma versão no histórico e “Baixar” gera um arquivo .html.'; };
    fx(); new MutationObserver(fx).observe(b, { childList: true });
  }
  /* capa local: na nuvem só o Manual da obra abre; "Minhas obras" é o acervo da nuvem (o botão da capa some pelo CSS) */
  function wrapCover() {
    var C = window.AMCover; if (!C || C.__cloud) return !!C;
    var man = C.openManual; C.__cloud = true;
    C.open = function (s) { if (s === 'manual' && man) return man.call(C); goAcervo(s === 'hist' ? 'minhas' : null); };
    C.openHist = function () { goAcervo('minhas'); };
    return true;
  }
  function quietLocalStores() {
    /* Minhas obras (IndexedDB local) não recebe cópias das apresentações da nuvem: o acervo é o servidor, e um computador compartilhado não guarda o que não deve */
    var H = window.AMHist; if (H) ['touch', 'put', 'saveNow'].forEach(function (k) { if (typeof H[k] === 'function' && !H[k].__cloud) { var f = function () { return Promise.resolve(null); }; f.__cloud = true; H[k] = f; } });
    wrapCover(); cloudLabels(); manualFix(); try { S.hideDraftBanner(); S.clearDraft(); } catch (e) { }
  }
  addEventListener('load', quietLocalStores);
  try { S.hideDraftBanner(); } catch (e) { }
  var prEl = $('#presenter');   /* apresentação começou: menu e painel da nuvem não ficam por cima nem prendem o teclado */
  if (prEl) new MutationObserver(function () { if (prEl.classList.contains('open')) { closeMenu(false); if (!VIEW) cmClose(); } }).observe(prEl, { attributes: true, attributeFilter: ['class'] });

  /* ---------------------------------------------------------------- computador compartilhado: respostas, quadros, votos, notas e preferências de quem usou antes saem antes de qualquer uso */
  function userSwitch() { if (!me) return; wiping = true; try { CC.switchLocalUser(me.id); } finally { wiping = false; } }

  /* ---------------------------------------------------------------- preferências da pessoa (kits de marca e do editor) ↔ GET/PUT /api/me/prefs */
  var PREF = { 'amStudio.brandKits': 1, 'amStudio.recentColors': 1, 'amStudio.sideW': 1, 'amStudio.sideOff': 1, 'amStudio.gxWide': 1 }, PF = { on: false, data: null, t: null, dirty: {} };
  function jget(L, k) { try { return JSON.parse(L.getItem(k) || 'null'); } catch (e) { return null; } }
  function prefsEd(p) { return p && p.editor && typeof p.editor === 'object' && !Array.isArray(p.editor) ? p.editor : {}; }
  /* servidor → localStorage deste navegador; não sobrescreve o que esta aba mudou e ainda não gravou */
  function prefsApply(p) {
    var L = ls(), ed = prefsEd(p), set = function (k, v) { if (!PF.dirty[k]) try { origSet.call(L, k, v); } catch (e) { } };
    if (!L) return;
    if (Array.isArray(p.brandKits)) set('amStudio.brandKits', JSON.stringify(p.brandKits.slice(0, 20).map(function (k) { var o = S.brand && S.brand.safe(k); if (o && k && typeof k.at === 'number') o.at = k.at; return o && o.name ? o : null; }).filter(Boolean)));
    if (Array.isArray(ed.recentColors)) set('amStudio.recentColors', JSON.stringify(ed.recentColors.filter(function (c) { return /^#[0-9A-F]{6}$/i.test(c); }).slice(0, 8)));
    if (typeof ed.sideW === 'number' && isFinite(ed.sideW)) set('amStudio.sideW', String(Math.round(Math.max(120, Math.min(600, +ed.sideW)))));
    ['sideOff', 'gxWide'].forEach(function (k) { if (typeof ed[k] === 'boolean') set('amStudio.' + k, ed[k] ? '1' : '0'); });
  }
  async function prefsStart() {
    var L = ls(); if (VIEW || !L) return;
    var r; try { r = await jreq('GET', '/me/prefs'); } catch (e) { return; }   /* sem a rota (ou sem rede): fica só no navegador, como no editor original */
    var p = r && r.prefs && typeof r.prefs === 'object' && !Array.isArray(r.prefs) ? r.prefs : {}, ed = prefsEd(p);
    PF.data = p; PF.on = true;
    /* primeira vez nesta conta: o que este navegador já tinha sobe */
    if (!Array.isArray(p.brandKits) && jget(L, 'amStudio.brandKits')) PF.dirty['amStudio.brandKits'] = 1;
    if (!p.editor) Object.keys(PREF).forEach(function (k) { if (k !== 'amStudio.brandKits' && L.getItem(k) != null) PF.dirty[k] = 1; });
    prefsApply(p);
    if (Object.keys(PF.dirty).length) prefsPush();
  }
  function prefsPush(key) {
    if (key) PF.dirty[key] = 1;
    if (!PF.on || A.gone) return; clearTimeout(PF.t);
    PF.t = setTimeout(async function () {
      /* o PUT substitui o objeto inteiro: lê o que está no servidor agora (outro computador pode ter gravado depois que esta aba abriu),
         troca só as chaves que esta aba mudou e grava — o resto fica como está no servidor (e volta para este navegador) */
      var base = PF.data, g, again = function (e) { clearTimeout(PF.t); PF.t = setTimeout(prefsPush, Math.max(5000, (e.retryAfter || 0) * 1000)); };
      try { g = await jreq('GET', '/me/prefs'); if (g && g.prefs && typeof g.prefs === 'object' && !Array.isArray(g.prefs)) base = g.prefs; }
      catch (e) { if (e.status === 429 || e.network) return again(e); }
      if (A.gone) return;
      var L = ls(), d = PF.dirty, p = Object.assign({}, base), ed = Object.assign({}, prefsEd(base)), k, rc, sw;
      PF.dirty = {};
      if (d['amStudio.brandKits'] && Array.isArray(k = jget(L, 'amStudio.brandKits'))) p.brandKits = k.slice(0, 20);
      if (d['amStudio.recentColors'] && Array.isArray(rc = jget(L, 'amStudio.recentColors'))) ed.recentColors = rc.slice(0, 8);
      if (d['amStudio.sideW'] && isFinite(sw = parseInt(L.getItem('amStudio.sideW'), 10))) ed.sideW = sw;
      ['sideOff', 'gxWide'].forEach(function (x) { var v = d['amStudio.' + x] && L.getItem('amStudio.' + x); if (v === '1' || v === '0') ed[x] = v === '1'; });
      p.editor = ed;
      prefsApply(p);
      jreq('PUT', '/me/prefs', { prefs: p }).then(function (r) { if (r && r.prefs) PF.data = r.prefs; }, function (e) {   /* 429 (60 gravações/min) ou sem rede: tenta de novo; 400/413/422: fica só neste navegador */
        if (e.status === 429 || e.network) { Object.keys(d).forEach(function (x) { PF.dirty[x] = 1; }); again(e); }
      });
    }, 1500);
  }

  /* ---------------------------------------------------------------- comentários da plataforma (painel lateral, no editor e no visualizar) */
  var CM = { el: null, items: [], all: false, res: false, n: 0, cur: 0, last: -1, hd: null, mo: null };
  function cmSlide() { return VIEW ? CM.cur : (S.cur || 0); }
  function cmCount() { CM.n = CM.items.filter(function (c) { return !c.resolvedAt; }).length; var l = $('#cloudCmBtn .cl-vbl'); if (l) l.textContent = 'Comentários' + (CM.n ? ' (' + CM.n + ')' : ''); }
  function cmMsg(m) { var x = $('#cloudCmMsg'); if (x) x.textContent = m || ''; if (m) liveSay(m); }
  async function cmLoad(quiet) {
    try { var r = await jreq('GET', '/presentations/' + ID + '/comments' + (CM.res ? '?includeResolved=1' : '')); CM.items = (r && r.items) || []; cmCount(); CM.last = -1; cmRender(); cmMsg(''); }
    catch (e) { if (!quiet) cmMsg('Não foi possível carregar os comentários.'); }
  }
  function cmToggle() { if (CM.el) cmClose(); else cmOpen(); }
  function cmChk(id, label, val, fn) { var i = h('input', { type: 'checkbox', id: id }); i.checked = val; i.addEventListener('change', function () { fn(i.checked); }); return h('label', { class: 'cl-ck', for: id }, [i, label]); }
  function cmOpen() {
    if (CM.el) return; closeMenu(false);
    var ta = h('textarea', { id: 'cloudCmIn', class: 'cl-in cl-ta', rows: '3', maxlength: '2000', 'aria-label': 'Novo comentário' }), send = h('button', { type: 'button', class: 'cl-b pri', id: 'cloudCmSend', text: 'Comentar' });
    var el = CM.el = h('aside', { id: 'cloudComments', class: 'cl-cm', role: 'complementary', 'aria-labelledby': 'cloudCmT' }, [
      h('div', { class: 'cl-cmh' }, [h('div', {}, [h('div', { class: 'cl-ey', text: 'Comentários' }), h('h2', { id: 'cloudCmT' })]), h('button', { type: 'button', class: 'cl-x', id: 'cloudCmX', 'aria-label': 'Fechar comentários', title: 'Fechar (Esc)', text: '×' })]),
      h('div', { class: 'cl-cmo' }, [cmChk('cloudCmAll', 'Todos os slides', CM.all, function (v) { CM.all = v; CM.last = -1; cmRender(); }), cmChk('cloudCmRes', 'Mostrar resolvidos', CM.res, function (v) { CM.res = v; cmLoad(); })]),
      h('ul', { class: 'cl-cml', id: 'cloudCmList', 'aria-live': 'polite' }),
      h('div', { class: 'cl-cmc' }, [ta, h('div', { class: 'cl-cmm', id: 'cloudCmMsg' }), send])]);
    document.body.appendChild(el);
    $('#cloudCmX').addEventListener('click', cmClose); send.addEventListener('click', cmSend);
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); cmSend(); } });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); cmClose(); } e.stopPropagation(); });   /* teclas do painel não mudam o slide nem saem da apresentação */
    var th = $('#thumbs'); if (!VIEW && th) { CM.mo = new MutationObserver(function () { cmRender(); }); CM.mo.observe(th, { subtree: true, attributes: true, attributeFilter: ['class'] }); }
    var b = $('#cloudCmBtn'); if (b) b.setAttribute('aria-expanded', 'true');
    cmRender(); cmLoad(); setTimeout(function () { ta.focus({ preventScroll: true }); }, 30);
  }
  function cmClose() {
    if (!CM.el) return; if (CM.mo) CM.mo.disconnect(); CM.mo = null; CM.el.remove(); CM.el = null; CM.last = -1;
    var b = $('#cloudCmBtn'); if (b) b.setAttribute('aria-expanded', 'false'); if (b || pill) (b || pill).focus({ preventScroll: true });
  }
  function cmRender() {
    if (!CM.el) return; var s = cmSlide(); if (s === CM.last) return; CM.last = s;
    var list = $('#cloudCmList'), its = CM.items.filter(function (c) { return (CM.all || c.slideIndex == null || c.slideIndex === s) && (CM.res || !c.resolvedAt); });
    $('#cloudCmT').textContent = CM.all ? 'Todos os slides' : 'Slide ' + (s + 1); $('#cloudCmIn').placeholder = 'Comentar no slide ' + (s + 1) + '…';
    list.textContent = '';
    if (!its.length) list.appendChild(h('li', { class: 'cl-mut', text: CM.all ? 'Nenhum comentário ainda.' : 'Nenhum comentário neste slide.' }));
    its.forEach(function (c) { list.appendChild(cmItem(c)); });
  }
  function cmItem(c) {
    var li = h('li', { class: 'cl-ci' + (c.resolvedAt ? ' done' : ''), 'data-id': c.id }, [
      h('div', { class: 'cl-cim' }, [h('b', { text: (c.author && c.author.displayName) || 'Usuário' }), ' · ' + when(c.createdAt),
        c.slideIndex != null ? h('button', { type: 'button', class: 'cl-cs', text: 'Slide ' + (c.slideIndex + 1), title: 'Ir ao slide ' + (c.slideIndex + 1) }) : h('span', { class: 'cl-cs', text: 'Geral' })]),
      h('p', { text: c.body }),
      h('div', { class: 'cl-cia' }, [c.canResolve ? h('button', { type: 'button', 'data-a': 'res', text: c.resolvedAt ? 'Reabrir' : 'Resolver' }) : null, c.canDelete ? h('button', { type: 'button', 'data-a': 'del', text: 'Excluir' }) : null])]);
    li.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('cl-cs')) cmGo(c.slideIndex);
      else if (b.dataset.a === 'res') cmAct(jreq('PATCH', '/comments/' + c.id, { resolved: !c.resolvedAt }), c.resolvedAt ? 'Comentário reaberto.' : 'Comentário resolvido.');
      else if (b.dataset.a === 'del') confirmDialog('Excluir este comentário?', 'Ele sai da apresentação para todas as pessoas.', 'Excluir', 'Cancelar', true).then(function (ok) { if (ok) cmAct(jreq('DELETE', '/comments/' + c.id), 'Comentário excluído.'); });
    });
    return li;
  }
  function cmAct(pr, msg) { pr.then(function () { liveSay(msg); return cmLoad(); }, function (e) { cmMsg('Não foi possível concluir: ' + (e.message || 'tente de novo') + '.'); }); }
  function cmGo(i) { if (VIEW) { var hd = CM.hd, k = hd && hd.map ? hd.map.indexOf(i) : -1; if (k >= 0) hd.go(k); } else { try { S.goSlide(i); } catch (e) { } } CM.last = -1; cmRender(); }
  async function cmSend() {
    var ta = $('#cloudCmIn'), b = $('#cloudCmSend'), text = ta.value.trim(); if (!text || b.disabled) return;
    b.disabled = true; cmMsg('');
    try { await jreq('POST', '/presentations/' + ID + '/comments', { body: text.slice(0, 2000), slideIndex: Math.min(499, cmSlide()) }); ta.value = ''; await cmLoad(); liveSay('Comentário publicado.'); }
    catch (e) { cmMsg('Não foi possível publicar: ' + (e.message || 'tente de novo') + '.'); }
    finally { b.disabled = false; }
  }
  RT.hooks.player.push(function (hd) { CM.hd = hd; });
  RT.hooks.show.push(function (i, hd) { if (hd === CM.hd && hd.map) { CM.cur = hd.map[i] || 0; cmRender(); } });

  /* ---------------------------------------------------------------- interações: formulários, quadros e votações → API */
  var KEYRE = /^(amForm|amBoard|amVote)\.([\w-]{1,40})\.([\w-]{1,40})$/, KIND_OF = { amForm: 'form_response', amBoard: 'board_state', amVote: 'vote_state' };
  var seen = {}, bTimers = {}, outbox = [], outBusy = false, outFail = 0, outTimer = null, bigWarned = {}, origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
  function ls() { try { return window.localStorage; } catch (e) { return null; } }
  function rowsOf(v) { try { var o = JSON.parse(v); return o && Array.isArray(o.rows) ? o : null; } catch (e) { return null; } }
  function seedSeen() { var L = ls(); if (!L) return; try { for (var i = 0; i < L.length; i++) { var k = L.key(i), m = KEYRE.exec(k); if (m && m[1] === 'amForm') { var o = rowsOf(L.getItem(k)); if (o) seen[k] = o.rows.length; } } } catch (e) { } }
  /* cada envio leva um clientId: se a resposta do servidor se perder e o envio for repetido, ele devolve o item que já existe em vez de duplicar */
  function enqueue(item) {
    item.pid = ID; item.ts = Date.now(); item.uid = A.uid0; item.cid = rid(); outbox.push(item);
    item.stored = idbOp('outbox', 'readwrite', function (s) { var r = s.add({ pid: ID, ts: item.ts, kind: item.kind, elementId: item.elementId, payload: item.payload, uid: item.uid, cid: item.cid }); r.onsuccess = function () { item.seq = r.result; }; return r; });
    outFlushSoon(300);
  }
  function tooBig(kind, el) {
    if (bigWarned[kind + el]) return; bigWarned[kind + el] = 1;
    toast(kind === 'form_response' ? 'Esta resposta passou de 64 KB e não foi enviada à nuvem: ela ficou só neste computador.' : (kind === 'board_state' ? 'O quadro' : 'A votação') + ' passou de 256 KB e não sincroniza mais com a nuvem: o que mudar agora fica só neste computador. Use “Baixar CSV” para não perder nada.');
  }
  function outFlushSoon(ms) { clearTimeout(outTimer); outTimer = setTimeout(bridgeFlush, ms); }
  async function bridgeFlush() {
    if (outBusy || !outbox.length || A.gone) return; outBusy = true;
    try {
      while (outbox.length && !A.gone) {
        var it = outbox[0];
        if (it.uid && it.uid === A.uid0) { /* item de outra pessoa (computador compartilhado) nunca vai com a identidade de quem está agora */
          try { await jreq('POST', '/presentations/' + ID + '/interactions', { kind: it.kind, elementId: it.elementId, payload: it.payload, clientId: it.cid }); }
          catch (e) {
            if (e.network || e.status >= 500 || e.status === 429 || e.status === 401) { outFail++; outFlushSoon(Math.max(Math.min(60000, 2000 * Math.pow(2, Math.min(outFail, 5))), (e.retryAfter || 0) * 1000)); return; } /* tenta depois (respeitando o Retry-After); a apresentação nunca para por isso */
            if (e.status === 413) tooBig(it.kind, it.elementId); else if (e.status === 409) toast(e.message || 'Limite de respostas atingido.');
          }
        }
        outbox.shift(); outFail = 0; if (it.stored) await it.stored; if (it.seq != null) idbOp('outbox', 'readwrite', function (s) { return s.delete(it.seq); });
      }
    } finally { outBusy = false; }
  }
  async function outboxLoad() {
    var all = await idbOp('outbox', 'readonly', function (s) { return s.getAll(); }), mine = A.uid0;
    (all || []).forEach(function (r) {
      if (!mine || r.uid !== mine) { idbOp('outbox', 'readwrite', function (s) { return s.delete(r.seq); }); return; }   /* de outra pessoa (ou sem dono): apagado, nunca enviado */
      if (r.pid === ID && !outbox.some(function (x) { return x.seq === r.seq; })) outbox.push(r);
    });
    if (outbox.length) outFlushSoon(1500);
  }
  function bridge(k, v) {
    var m = KEYRE.exec(k); if (!m || m[2] !== ID || A.gone) return;
    if (m[1] === 'amForm') {
      var o = rowsOf(v); if (!o) return; var prev = seen[k] || 0;
      if (o.rows.length > prev) o.rows.slice(prev).forEach(function (r) { var p = { at: r.at, q: o.q, a: r.a }; if (byteLen(JSON.stringify(p)) > LIM.form_response) tooBig('form_response', m[3]); else enqueue({ kind: 'form_response', elementId: m[3], payload: p }); });
      seen[k] = o.rows.length; return;
    }
    clearTimeout(bTimers[k]);
    bTimers[k] = setTimeout(function () { try { var p = JSON.parse(v), kind = KIND_OF[m[1]]; if (byteLen(JSON.stringify(p)) > LIM[kind]) tooBig(kind, m[3]); else enqueue({ kind: kind, elementId: m[3], payload: p }); } catch (e) { } }, 1200);
  }
  Storage.prototype.setItem = function (k, v) {
    if (this === ls()) {
      if (k === 'amStudio.draft') return; /* na nuvem o rascunho local é a fila do IndexedDB (apagada após o salvamento confirmado) */
      var r = origSet.apply(this, arguments);
      try { bridge(String(k), String(v)); if (PREF[k]) prefsPush(String(k)); } catch (e) { }
      return r;
    }
    return origSet.apply(this, arguments);
  };
  /* "Limpar" do formulário, do quadro e da votação apaga só deste computador: uma marca (com o id de quem limpou) impede que a restauração
     traga de volta o que já tinha sido enviado; o servidor continua com tudo (o dono da apresentação não perde nada) */
  var wiping = false;
  function limpo(k) { return 'amCloud.limpo.' + k; }
  Storage.prototype.removeItem = function (k) {
    if (this === ls()) { try { var m = KEYRE.exec(String(k)); if (m) { seen[k] = 0; if (!wiping && m[2] === ID && A.uid0) origSet.call(this, limpo(k), String(A.uid0)); } } catch (e) { } }
    return origRemove.apply(this, arguments);
  };
  async function restoreInteractions() {
    try {
      var j = await jreq('GET', '/presentations/' + ID + '/interactions'), items = (j && j.items) || [], L = ls(); if (!L) return;
      /* só o que é comprovadamente MEU entra no localStorage: item sem autor, ou sem sessão carregada, nunca é restaurado (E2E-01) */
      var mine = items.filter(function (it) { var who = it.author || it.user; return !!(who && me && who.id === me.id); }), forms = {};
      mine.forEach(function (it) {
        var key = it.kind === 'form_response' ? 'amForm.' : it.kind === 'board_state' ? 'amBoard.' : it.kind === 'vote_state' ? 'amVote.' : null;
        if (!key || !it.payload) return; key += ID + '.' + it.elementId;
        if (L.getItem(limpo(key)) === String(A.uid0)) return;   /* limpo neste computador por esta pessoa */
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
  function bridgeStart() { seedSeen(); restoreInteractions(); outboxLoad(); watchPlayer(); }
  /* textos do formulário e da votação na nuvem: a resposta vai ao servidor com o nome da pessoa, não fica "neste dispositivo" */
  var TXT = {
    'Registrada neste dispositivo.': 'Resposta enviada com o seu nome ao dono da apresentação.',
    'Registrada aqui e enviada à planilha.': 'Resposta enviada com o seu nome ao dono da apresentação e à planilha.',
    'Voto registrado. Próxima pessoa pode votar.': 'Voto enviado com o seu nome ao dono da apresentação.',
    'Voto registrado aqui e enviado à planilha.': 'Voto enviado com o seu nome ao dono da apresentação e à planilha.',
    'Respostas apagadas neste dispositivo.': 'Respostas apagadas só deste computador (as já enviadas continuam com o dono da apresentação).',
    'Votos apagados neste dispositivo.': 'Votos apagados só deste computador (os já enviados continuam com o dono da apresentação).'
  };
  function fixStatus(n) {
    var tx = n.textContent, root = n.closest('[data-sheet]'), sheet = root ? root.getAttribute('data-sheet') : '';
    if (TXT[tx]) n.textContent = TXT[tx];
    else if (/^(Registrada aqui|Voto registrado aqui); sem internet para a planilha\.$/.test(tx)) n.textContent = (/^Voto/.test(tx) ? 'Voto enviado' : 'Resposta enviada') + ' com o seu nome ao dono da apresentação. ' + (/^https:\/\/script\.google(usercontent)?\.com\//i.test(sheet) ? 'A planilha não respondeu.' : 'A planilha não recebeu: na versão online só vale o endereço de um app do Google (https://script.google.com/…/exec).');
  }
  /* antes de responder, o formulário já diz para onde vai a resposta (o texto some quando o próprio formulário mostra um estado) */
  var HINT = 'Ao enviar, a resposta vai com o seu nome para o dono da apresentação.', NOTE_ED = 'Ctrl+Enter ou clique fora salva · Esc cancela';
  function hintForm(n) { if (n && !n.textContent) { n.textContent = HINT; n.classList.add('cl-hint'); } }
  /* "Sobre este slide" editado no player fica só neste navegador (como no original): avisa enquanto edita */
  function hintNote(n) { if (n.textContent === NOTE_ED) n.textContent = NOTE_ED + ' · vale só neste navegador' + (VIEW ? '' : ' (para todos: “Sobre este slide” no editor)'); }
  function watchPlayer() {
    if (!prEl || prEl.__cl) return; prEl.__cl = 1;
    prEl.querySelectorAll('.amf-st').forEach(hintForm);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        var n = m.target.nodeType === 1 ? m.target : m.target.parentNode;
        if (n && n.matches && n.matches('.amf-st, .amw-st')) { fixStatus(n); if (n.matches('.amf-st')) hintForm(n); }
        else if (n && n.matches && n.matches('.amp-note-k')) hintNote(n);
        else if (m.addedNodes) m.addedNodes.forEach(function (a) { if (a.nodeType === 1) { if (a.matches('.amf-st')) hintForm(a); else a.querySelectorAll('.amf-st').forEach(hintForm); } });
      });
    }).observe(prEl, { subtree: true, childList: true, characterData: true });
  }

  /* ---------------------------------------------------------------- modo visualizar */
  function startView(p) {
    document.documentElement.classList.add('am-cloud-view');
    var cb = h('button', { type: 'button', class: 'cl-vb', id: 'cloudCmBtn', 'aria-expanded': 'false', title: 'Comentários da apresentação' }, [svgIc('chat'), h('span', { class: 'cl-vbl', text: 'Comentários' + (CM.n ? ' (' + CM.n + ')' : '') })]);
    var bar = h('div', { class: 'cl-vbar', id: 'cloudViewBar', role: 'region', 'aria-label': 'Apresentação em modo de leitura' }, [
      h('button', { type: 'button', class: 'cl-vb', id: 'cloudBack', text: '← Acervo', title: 'Voltar ao acervo (Esc)' }),
      h('div', { class: 'cl-vtitle' }, [h('b', { text: S.deck.title || p.title || 'Apresentação' }), h('span', { text: ' · de ' + ((p.owner && p.owner.displayName) || '—') })]),
      cb, p.canEdit ? h('a', { class: 'cl-vb', id: 'cloudEdit', href: '/editor/' + ID, text: 'Editar' }) : null,
      h('button', { type: 'button', class: 'cl-vb or', id: 'cloudCopy', text: 'Criar cópia para usar', title: 'Cria uma cópia sua, que você pode editar' })]);
    document.body.appendChild(bar);
    $('#cloudBack').addEventListener('click', function () { goAcervo(); }); $('#cloudCopy').addEventListener('click', makeCopy); cb.addEventListener('click', cmToggle);
    ['dragover', 'drop'].forEach(function (t) { addEventListener(t, function (e) { e.preventDefault(); e.stopImmediatePropagation(); }, true); });
    document.title = (S.deck.title || 'Apresentação') + ' · Canteiro';
    var pr = $('#presenter'), started = false;
    new MutationObserver(function () { if (started && !pr.classList.contains('open')) { A.allowLeave = true; location.assign('/acervo?foco=' + encodeURIComponent(ID)); } }).observe(pr, { attributes: true, attributeFilter: ['class'] });
    try { S.present(0); started = true; } catch (e) { toast('Não foi possível iniciar a apresentação.'); }
  }

  /* ---------------------------------------------------------------- arranque */
  try {
    if (S.HK && !VIEW) S.HK.forEach(function (g) { (g[1] || []).forEach(function (r) {
      if (r[0] === 'Salvar apresentação') { r[0] = 'Salvar versão na nuvem'; r[2] = 'Na nuvem: salva uma versão no histórico (o botão Baixar gera o .html)'; }
      else if (r[0] === 'Abrir apresentação') r[2] = 'Na nuvem: vira uma apresentação nova no acervo ou substitui esta';
    }); });
  } catch (e) { }
  window.AMCloud = {
    id: ID, mode: CFG.mode, get status() { return A.status; }, get rev() { return A.rev; }, get dirty() { return A.dirty; }, get inflight() { return !!A.inflight; }, get meta() { return A.meta; },
    saveNow: saveNow, saveVersion: saveVersion, history: historyDialog, bridgeFlush: bridgeFlush, get outbox() { return outbox.length; },
    comments: { open: cmOpen, close: cmClose, get count() { return CM.n; } }, get rejected() { return A.rej ? A.rej.issues.slice() : null; }
  };
  if (!VIEW) buildPill();
  boot().catch(function (e) { try { console.error(e); } catch (x) { } fatal('Não foi possível abrir', 'Ocorreu um erro inesperado ao abrir a apresentação.', [{ label: 'Tentar de novo', href: location.pathname }, { label: 'Voltar ao acervo', href: '/acervo' }]); });
})();
