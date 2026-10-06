/* cloud-core-stub.js — STUB de platform/studio-cloud/cloud-core.js (módulo do B2) usado só nos testes das páginas.
   Implementa a MESMA API combinada (window.AMCloudCore / module.exports): sha256Hex, canonicalJSON, dataUrlToBytes, bytesToDataUrl,
   externalizeDeck, hydrateDeck, extractDeckFromHtml, parseAcervoJson. Quando o módulo real existir, rode os testes com WEB_CLOUD_CORE=real. */
(function (root) {
  'use strict';
  var IMG_RE = /data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+/g;
  var ASSET_RE = /asset:sha256:([0-9a-f]{64})/g;

  function toBytes(x) { return typeof x === 'string' ? new TextEncoder().encode(x) : x; }
  async function sha256Hex(x) {
    var d = await crypto.subtle.digest('SHA-256', toBytes(x));
    return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function canonicalJSON(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canonicalJSON(v[k]); }).join(',') + '}';
  }
  function dataUrlToBytes(u) {
    var m = /^data:([^;,]+);base64,(.*)$/.exec(u);
    if (!m) throw new Error('data URL inválida');
    var bin = atob(m[2]); var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes: out };
  }
  function bytesToDataUrl(bytes, mime) {
    var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:' + mime + ';base64,' + btoa(s);
  }
  function mapStrings(v, fn) {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(function (x) { return mapStrings(x, fn); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = mapStrings(v[k], fn); }); return o; }
    return v;
  }
  function walkStrings(v, fn) { mapStrings(v, function (s) { fn(s); return s; }); }

  async function externalizeDeck(deck, opts) {
    opts = opts || {};
    var api = opts.api, cache = opts.cache || new Map(), maxC = opts.maxConcurrent || 4, progress = opts.onProgress || function () {};
    var found = new Map(); // dataUrl -> { sha, bytes, mime }
    var urls = new Set();
    walkStrings(deck, function (s) { var m = s.match(IMG_RE); if (m) m.forEach(function (u) { urls.add(u); }); });
    var list = Array.from(urls);
    progress({ phase: 'hashing', done: 0, total: list.length });
    for (var i = 0; i < list.length; i++) {
      var u = list[i], hit = cache.get(u);
      if (!hit) { var d = dataUrlToBytes(u); hit = { sha: await sha256Hex(d.bytes), bytes: d.bytes, mime: d.mime }; cache.set(u, hit); }
      found.set(u, hit);
    }
    var shas = Array.from(new Set(Array.from(found.values()).map(function (x) { return x.sha; })));
    var missing = shas.length ? await api.check(shas) : [];
    var byShaToUpload = shas.filter(function (s) { return missing.indexOf(s) >= 0; });
    var done = 0, bytes = 0, queue = byShaToUpload.slice();
    progress({ phase: 'uploading', done: 0, total: byShaToUpload.length });
    async function worker() {
      while (queue.length) {
        var sha = queue.shift();
        var rec = Array.from(found.values()).find(function (x) { return x.sha === sha; });
        await api.put(sha, rec.bytes, rec.mime, 'image');
        done++; bytes += rec.bytes.length; progress({ phase: 'uploading', done: done, total: byShaToUpload.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxC, byShaToUpload.length) }, worker));
    var content = mapStrings(deck, function (s) { return s.replace(IMG_RE, function (u) { return 'asset:sha256:' + found.get(u).sha; }); });
    return { content: content, stats: { found: list.length, uploaded: byShaToUpload.length, deduplicated: shas.length - byShaToUpload.length, bytes: bytes } };
  }

  async function hydrateDeck(content, opts) {
    var shas = new Set(); walkStrings(content, function (s) { var m; ASSET_RE.lastIndex = 0; while ((m = ASSET_RE.exec(s))) shas.add(m[1]); });
    var map = new Map();
    for (const sha of shas) {
      try { var r = await opts.fetchAsset(sha); map.set(sha, bytesToDataUrl(r.bytes, r.mime)); } catch (e) { map.set(sha, 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>')); }
    }
    return mapStrings(content, function (s) { return s.replace(ASSET_RE, function (_, sha) { return map.get(sha); }); });
  }

  function extractDeckFromHtml(html) {
    var m = /<script[^>]*\bid=["']am-deck-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html));
    if (!m) return null;
    try { var d = JSON.parse(m[1]); return d && typeof d === 'object' && Array.isArray(d.slides) ? d : null; } catch (e) { return null; }
  }
  function parseAcervoJson(text) {
    var j = JSON.parse(text), out = [];
    function one(o) { if (o && o.deck && Array.isArray(o.deck.slides)) out.push({ id: o.id || o.deck.id, title: o.title || o.deck.title, deck: o.deck }); else if (o && Array.isArray(o.slides)) out.push({ id: o.id, title: o.title, deck: o }); }
    if (Array.isArray(j)) j.forEach(one);
    else if (j && j.kind === 'canteiro-acervo' && Array.isArray(j.obras)) j.obras.forEach(one);
    else one(j);
    return out;
  }

  var api = { sha256Hex: sha256Hex, canonicalJSON: canonicalJSON, dataUrlToBytes: dataUrlToBytes, bytesToDataUrl: bytesToDataUrl, externalizeDeck: externalizeDeck, hydrateDeck: hydrateDeck, extractDeckFromHtml: extractDeckFromHtml, parseAcervoJson: parseAcervoJson, __stub: true };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AMCloudCore = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
