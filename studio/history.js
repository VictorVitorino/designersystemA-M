/* ===== CANTEIRO · Minhas obras — acervo local das apresentações (window.AMHist) =====
   Banco IndexedDB "canteiro", depósito "obras", chave = deck.id: {id, title, createdAt, updatedAt, slideCount, deck}.
   Sem IndexedDB (bloqueado, modo privado, navegador antigo): localStorage "canteiro.obras". Sem nenhum dos dois: desligado
   (kind() === 'none'). Tudo é assíncrono e protegido por try/catch: nenhuma promessa rejeita e nada aqui trava o editor.
   Quem grava: o editor (commit → touch, com atraso; salvar, abrir arquivo, carregar projeto pronto → put) e a capa
   (renomear, duplicar, excluir, importar). Gravações passam por uma fila única (seq), então nunca se atropelam.
   Atenção: em file:// o Chromium compartilha este banco com qualquer HTML local aberto no mesmo navegador. */
(function () {
  'use strict';
  var S = window.AMStudio, DBN = 'canteiro', ST = 'obras', LSK = 'canteiro.obras', WAIT = 1200, ID_RE = /^[\w-]{1,40}$/;
  var kind = 'none', db = null, metas = [], subs = [], pend = null, tm = 0, warned = {}, asked = false, line = Promise.resolve();
  function noop() { }
  function T() { return Date.now(); }
  function ok(v) { return Promise.resolve(v); }
  function ts(v, d) { v = +v; return isFinite(v) && v > 0 ? Math.round(v) : d; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function newId() { try { if (S && typeof S.newId === 'function') return S.newId(); } catch (e) { } return 'd' + T().toString(36) + Math.random().toString(36).slice(2, 8); }
  function meta(r) { return { id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, slideCount: r.slideCount }; }
  function byRecent(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }
  function metaOf(id) { for (var i = 0; i < metas.length; i++) if (metas[i].id === id) return metas[i]; return null; }
  function emit() { var m = metas.slice(); subs.slice().forEach(function (f) { try { f(m); } catch (e) { } }); }
  function setMeta(r, gone) { var id = gone ? r : r.id; metas = metas.filter(function (m) { return m.id !== id; }); if (!gone) metas.push(meta(r)); metas.sort(byRecent); emit(); }
  /* obra intocada (um slide branco vazio com o título padrão): não entra no acervo, a não ser que já esteja nele */
  function trivial(d) { var s = d.slides || []; return s.length === 1 && !((s[0] || {}).els || []).length && !s[0].bgImg && String(s[0].bg || '#FFFFFF').toUpperCase() === '#FFFFFF' && (d.title || '') === 'Nova apresentação'; }
  function valid(r) { return !!(r && typeof r === 'object' && typeof r.id === 'string' && ID_RE.test(r.id) && r.deck && typeof r.deck === 'object' && Array.isArray(r.deck.slides) && r.deck.slides.length); }
  /* registro lido do banco: completa e normaliza os campos de resumo sem confiar no que veio gravado */
  function fix(r) { var u = ts(r.updatedAt, 0); return { id: r.id, title: String(r.title || r.deck.title || 'Apresentação').slice(0, 300), createdAt: ts(r.createdAt, u), updatedAt: u, slideCount: r.deck.slides.length, deck: r.deck }; }
  /* avisa uma vez por sessão (cota esgotada, gravação recusada) — nunca lança */
  function report(e) {
    var quota = !!e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || e))), k = quota ? 'q' : 'w';
    if (warned[k]) return; warned[k] = true;
    try { if (S && S.toast) S.toast(quota ? 'Sem espaço no navegador para guardar esta obra em Minhas obras. Use “Salvar apresentação” para não perder o trabalho.' : 'Não foi possível guardar a obra em Minhas obras neste navegador. Use “Salvar apresentação”.'); } catch (er) { }
  }
  /* fila única: cada operação começa quando a anterior termina (as operações nunca rejeitam) */
  function seq(fn) { var p = line.then(fn, fn); line = p.then(noop, noop); return p; }

  /* ---------------- IndexedDB ---------------- */
  function idbOpen() {
    return new Promise(function (res) {
      var rq, done = false;
      function fin(v) { if (done) { if (v) try { v.close(); } catch (e) { } return; } done = true; res(v); }
      try { if (!window.indexedDB) { fin(null); return; } rq = indexedDB.open(DBN, 1); } catch (e) { fin(null); return; }
      rq.addEventListener('upgradeneeded', function () { try { var d = rq.result; if (!d.objectStoreNames.contains(ST)) d.createObjectStore(ST, { keyPath: 'id' }); } catch (e) { } });
      rq.addEventListener('success', function () {
        var d = rq.result;
        try { d.addEventListener('versionchange', function () { try { d.close(); } catch (e) { } if (db === d) { db = null; kind = 'none'; } }); } catch (e) { }
        fin(d);
      });
      rq.addEventListener('error', function () { fin(null); });
      setTimeout(function () { fin(null); }, 5000); /* banco travado por outra aba: segue sem ele, sem esperar para sempre */
    });
  }
  function idbReq(mode, fn) {
    return new Promise(function (res, rej) {
      if (!db) { rej(new Error('acervo indisponível')); return; }
      var tx, rq;
      try { tx = db.transaction(ST, mode); rq = fn(tx.objectStore(ST)); } catch (e) { rej(e); return; }
      tx.addEventListener('complete', function () { res(rq ? rq.result : undefined); });
      tx.addEventListener('abort', function () { rej(tx.error || (rq && rq.error) || new Error('gravação cancelada')); });
    });
  }
  /* ---------------- localStorage (alternativa) ---------------- */
  function lsOK() { try { localStorage.setItem('canteiro.probe', '1'); localStorage.removeItem('canteiro.probe'); return true; } catch (e) { return false; } }
  function lsRead() { try { var o = JSON.parse(localStorage.getItem(LSK) || 'null'); return o && o.obras && typeof o.obras === 'object' ? o.obras : {}; } catch (e) { return {}; } }
  function lsWrite(m) { localStorage.setItem(LSK, JSON.stringify({ v: 1, obras: m })); } /* pode lançar (cota): quem chama trata */

  /* ---------------- operações básicas (nunca rejeitam) ---------------- */
  function all() {
    var p;
    if (kind === 'idb') p = idbReq('readonly', function (s) { return s.getAll(); });
    else if (kind === 'ls') { var m = lsRead(); p = ok(Object.keys(m).map(function (k) { return m[k]; })); }
    else p = ok([]);
    return p.then(function (l) { return (l || []).filter(valid).map(fix).sort(byRecent); }, function () { return []; });
  }
  function getRec(id) {
    var p;
    if (typeof id !== 'string' || !ID_RE.test(id)) return ok(null);
    if (kind === 'idb') p = idbReq('readonly', function (s) { return s.get(id); });
    else if (kind === 'ls') p = ok(lsRead()[id]);
    else p = ok(null);
    return p.then(function (r) { return valid(r) ? fix(r) : null; }, function () { return null; });
  }
  function putRec(r) {
    if (kind === 'idb') return idbReq('readwrite', function (s) { return s.put(r); }).then(function () { return true; }, function (e) { report(e); return false; });
    if (kind === 'ls') { try { var m = lsRead(); m[r.id] = r; lsWrite(m); return ok(true); } catch (e) { report(e); return ok(false); } }
    return ok(false);
  }
  function delRec(id) {
    if (kind === 'idb') return idbReq('readwrite', function (s) { return s.delete(id); }).then(function () { return true; }, function () { return false; });
    if (kind === 'ls') { try { var m = lsRead(); delete m[id]; lsWrite(m); return ok(true); } catch (e) { return ok(false); } }
    return ok(false);
  }
  function refresh() { return all().then(function (l) { metas = l.map(meta); emit(); return metas.slice(); }); }
  /* o navegador pode apagar dados "descartáveis" sob pressão de espaço: pede armazenamento persistente uma vez
     (no Chromium não há pergunta ao usuário; no Firefox haveria, então lá não pedimos) */
  function askPersist() {
    if (asked) return; asked = true;
    try { var n = navigator.storage; if (n && n.persist && n.persisted && !/Firefox\//.test(navigator.userAgent)) n.persisted().then(function (p) { return p || n.persist(); }).then(noop, noop); } catch (e) { }
  }
  /* registros que ficaram no localStorage (sessão sem IndexedDB) passam para o banco: o mais novo vence */
  function migrate() {
    var m = lsRead(), ids = Object.keys(m); if (!ids.length) return ok();
    var p = ok();
    ids.forEach(function (id) {
      var r = m[id]; if (!valid(r)) return; r = fix(r);
      p = p.then(function () { return getRec(id).then(function (cur) { if (!cur || cur.updatedAt < r.updatedAt) return putRec(r); }); });
    });
    return p.then(function () { try { localStorage.removeItem(LSK); } catch (e) { } });
  }

  var ready = idbOpen().then(function (d) {
    if (d) { db = d; kind = 'idb'; } else kind = lsOK() ? 'ls' : 'none';
    return (kind === 'idb' ? migrate() : ok()).then(refresh);
  }).then(function () { return kind; }, function () { return kind; });

  /* ---------------- gravar ---------------- */
  function putNow(d, o) {
    o = o || {};
    if (kind === 'none' || !d || typeof d !== 'object' || !Array.isArray(d.slides) || !d.slides.length || typeof d.id !== 'string' || !ID_RE.test(d.id)) return ok(null);
    var prev = metaOf(d.id);
    if (!prev && !o.force && trivial(d)) return ok(null);
    var t = T(), r = { id: d.id, title: String(d.title || 'Apresentação').slice(0, 300), createdAt: prev ? prev.createdAt : t, updatedAt: t, slideCount: d.slides.length, deck: d };
    return putRec(r).then(function (done) { if (!done) return null; setMeta(r); askPersist(); return r; });
  }
  /* grava uma cópia da obra (objeto já desvinculado do editor) — salvar, abrir arquivo, projeto pronto */
  function put(d, o) { return ready.then(function () { return seq(function () { return putNow(d, o); }); }).then(null, function () { return null; }); }
  /* autossalvamento do editor: guarda o JSON da última alteração e grava depois de WAIT ms sem novas alterações */
  function touch(json) { if (typeof json !== 'string') return; pend = json; clearTimeout(tm); tm = setTimeout(flush, WAIT); }
  /* grava já o que estiver pendente; resolve true quando nada ficou por guardar */
  function flush() {
    clearTimeout(tm); tm = 0;
    var j = pend; pend = null;
    if (!j) return ready.then(function () { return kind !== 'none'; });
    var d; try { d = JSON.parse(j); } catch (e) { return ok(false); }
    return put(d).then(function (r) { return !!r || (kind !== 'none' && !metaOf(d.id) && trivial(d)); });
  }
  /* grava agora a obra aberta no editor (antes de trocar de obra pela capa ou ao salvar o arquivo) */
  function saveNow() { try { if (S && S.deck) pend = JSON.stringify(S.deck); } catch (e) { } return flush(); }
  function copyName(t) {
    var base = String(t || 'Apresentação').replace(/ \(cópia(?: \d+)?\)$/, ''), n = 1, nm = base + ' (cópia)', names = metas.map(function (m) { return m.title; });
    while (names.indexOf(nm) >= 0) { n++; nm = base + ' (cópia ' + n + ')'; }
    return nm.slice(0, 300);
  }
  function rename(id, title) {
    title = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!title) return ok(null);
    return ready.then(function () { return seq(function () {
      return getRec(id).then(function (r) {
        if (!r) return null;
        r.title = title; r.deck.title = title; r.updatedAt = T();
        return putRec(r).then(function (done) { if (!done) return null; setMeta(r); return r; });
      });
    }); }).then(null, function () { return null; });
  }
  function duplicate(id) {
    return ready.then(function () { return seq(function () {
      return getRec(id).then(function (r) {
        if (!r) return null;
        var d = clone(r.deck); d.id = newId(); d.title = copyName(r.title);
        return putNow(d, { force: true });
      });
    }); }).then(null, function () { return null; });
  }
  function remove(id) {
    return ready.then(function () { return seq(function () { return delRec(id).then(function (done) { if (done) setMeta(id, true); return done; }); }); }).then(null, function () { return false; });
  }
  /* ---------------- levar para outro computador ---------------- */
  function exportJSON() {
    return flush().then(function () { return seq(all); }).then(function (l) {
      return JSON.stringify({ app: 'Canteiro · Acervo de Apresentações A&M', kind: 'canteiro-acervo', v: 1, exportedAt: T(), count: l.length, obras: l });
    });
  }
  /* aceita o acervo exportado, uma lista de registros, um registro ou um deck solto; junta por id e o mais novo vence.
     Todo deck passa pela mesma validação do editor (AMStudio.safeDeck) antes de entrar no banco. */
  function importJSON(text) {
    var res = { total: 0, added: 0, updated: 0, kept: 0, invalid: 0, failed: 0 }, data, list;
    try { data = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return ok(null); }
    list = Array.isArray(data) ? data : data && Array.isArray(data.obras) ? data.obras : data && Array.isArray(data.slides) ? [{ deck: data }] : data && data.deck ? [data] : null;
    if (!list) return ok(null);
    function one(x) {
      res.total++;
      var raw = x && typeof x === 'object' ? (x.deck && typeof x.deck === 'object' ? x.deck : Array.isArray(x.slides) ? x : null) : null, d = null;
      try { d = raw && S && typeof S.safeDeck === 'function' ? S.safeDeck(raw) : null; } catch (e) { d = null; }
      if (!d) { res.invalid++; return ok(); }
      var id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : d.id && ID_RE.test(d.id) ? d.id : newId();
      d.id = id;
      if (typeof x.title === 'string' && x.title.trim()) d.title = x.title.trim().slice(0, 300);
      var up = ts(x.updatedAt, ts(d.updated, 0)) || T(), cr = Math.min(ts(x.createdAt, up), up);
      return getRec(id).then(function (cur) {
        if (cur && cur.updatedAt >= up) { res.kept++; return; }
        var r = { id: id, title: d.title || 'Apresentação', createdAt: cur ? Math.min(cur.createdAt || cr, cr) : cr, updatedAt: up, slideCount: d.slides.length, deck: d };
        return putRec(r).then(function (done) { if (!done) res.failed++; else if (cur) res.updated++; else res.added++; });
      });
    }
    return ready.then(function () { return seq(function () {
      if (kind === 'none') return null;
      var p = ok();
      list.slice(0, 5000).forEach(function (x) { p = p.then(function () { return one(x); }); });
      return p.then(refresh).then(function () { if (res.added || res.updated) askPersist(); return res; });
    }); }).then(null, function () { return null; });
  }

  /* o que estiver pendente vai para o banco antes de a página sair ou ficar oculta (melhor esforço) */
  window.addEventListener('pagehide', function () { if (pend) flush(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && pend) flush(); });

  window.AMHist = {
    ready: ready,
    kind: function () { return kind; },
    available: function () { return kind !== 'none'; },
    count: function () { return metas.length; },
    metas: function () { return metas.slice(); },
    recent: function () { return metas[0] || null; },
    has: function (id) { return !!metaOf(id); },
    pending: function () { return !!pend; },
    list: function () { return ready.then(function () { return seq(all); }).then(function (l) { metas = l.map(meta); emit(); return l; }); },
    get: function (id) { return ready.then(function () { return seq(function () { return getRec(id); }); }); },
    refresh: function () { return ready.then(function () { return seq(refresh); }); },
    put: put, touch: touch, flush: flush, saveNow: saveNow,
    rename: rename, duplicate: duplicate, remove: remove,
    exportJSON: exportJSON, importJSON: importJSON,
    on: function (f) { if (typeof f === 'function') subs.push(f); }
  };
})();
