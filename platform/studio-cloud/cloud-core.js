/* ===== CANTEIRO online · cloud-core (window.AMCloudCore) =====
   Módulo compartilhado e isomórfico (navegador e Node 22), sem dependências. Usado pelas páginas (acervo, importação do acervo local),
   pela extensão do editor em nuvem (ed-50-cloud.js) e por ferramentas Node (tools/import-acervo etc.).
   Como carregar:
     navegador  tag script com src="/js/cloud-core.js"       → window.AMCloudCore   (no editor ele entra inline como ed-49-cloud-core.js)
     Node       import cc from '…/studio-cloud/cloud-core.js'  (studio-cloud/package.json marca a pasta como CommonJS)  ou  require()
   Funções:
     sha256Hex(bytes|string)                  → Promise<hex64>
     canonicalJSON(valor)                     → string (chaves ordenadas recursivamente, sem espaços; igual a src/lib/canonical.js)
     dataUrlToBytes(dataUrl)                  → { mime, bytes:Uint8Array }
     bytesToDataUrl(bytes, mime)              → string
     rasterizeForeignImages(deck, opts)       → Promise<deck>   (SVG/BMP/AVIF/ICO… viram PNG antes de externalizar; opts.rasterize, opts.cache, opts.stats)
     browserRasterize(dataUrl)                → Promise<data:image/png | null>   (só no navegador: Image + canvas)
     externalizeDeck(deck, opts)              → Promise<{ content, stats:{found, uploaded, deduplicated, bytes, unique, placeholders} }>
     hydrateDeck(content, opts)               → Promise<deck>   (opts.stats recebe {found, fetched, cached, missing:[sha]}; também em deck.hydration, não enumerável)
     extractDeckFromHtml(htmlText)            → deck | null
     parseAcervoJson(text)                    → [{ id, title, deck }]
     switchLocalUser(userId)                  → true se apagou os dados locais de quem usou antes (computador compartilhado)
     pendingLocalCount()                      → Promise<n>  (alterações e respostas da fila local que ainda não chegaram ao servidor)
     clearLocalData()                         → Promise     (apaga os dados locais da nuvem: "Sair")
   Referências de imagem: "asset:sha256:<64 hex>". Imagens que não puderam ser baixadas ao hidratar viram um SVG de aviso que carrega o hash
   no próprio data URL (parâmetro ;am-missing=<sha>): ao externalizar de novo, voltam a ser "asset:sha256:<sha>" (nada se perde por uma falha
   de rede passageira) — o SVG nunca sobe ao servidor (o servidor recusa data:image/svg+xml). */
(function (root) {
  'use strict';
  var IMG_RE = /data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+\/]+={0,2}/g;
  var ASSET_RE = /asset:sha256:([0-9a-f]{64})/g;
  var MISSING_RE = /data:image\/svg\+xml;charset=utf-8;am-missing=([0-9a-f]{64}),[A-Za-z0-9%._~!*-]*/g;
  var HEX64 = /^[0-9a-f]{64}$/;
  var CACHE_MAX = 600;
  var defaultCache = new Map();

  /* ---------------- bytes ---------------- */
  function toBytes(x) {
    if (typeof x === 'string') return new TextEncoder().encode(x);
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new TypeError('sha256Hex: esperado texto, Uint8Array ou ArrayBuffer');
  }
  function subtle() {
    var c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (!c || !c.subtle) throw new Error('crypto.subtle indisponível (use HTTPS ou localhost)');
    return c.subtle;
  }
  function hex(buf) {
    var u = new Uint8Array(buf), s = '', i;
    for (i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
    return s;
  }
  function sha256Hex(data) { return Promise.resolve().then(function () { return subtle().digest('SHA-256', toBytes(data)); }).then(hex); }

  /* ---------------- JSON canônico ---------------- */
  /* Mesmo contrato do servidor (src/lib/canonical.js): valores que o JSON não representa (NaN, Infinity, BigInt, função, símbolo,
     undefined na raiz, Map/Set/binário, ciclos) são RECUSADOS com TypeError em vez de virar null em silêncio. */
  function canonicalJSON(v) { var out = [], anc = new Set(); canonWalk(v, 0, out, anc); return out.join(''); }
  function canonFail(m) { throw new TypeError('canonicalJSON: ' + m); }
  function canonWalk(v, depth, out, anc) {
    if (v === null) { out.push('null'); return; }
    var t = typeof v;
    if (t === 'string') { out.push(JSON.stringify(v)); return; }
    if (t === 'boolean') { out.push(v ? 'true' : 'false'); return; }
    if (t === 'number') { if (!isFinite(v)) canonFail('NaN e Infinity não são JSON'); out.push(JSON.stringify(v)); return; }
    if (t === 'bigint') canonFail('BigInt não é JSON');
    if (t === 'function' || t === 'symbol') canonFail('função/símbolo não é JSON');
    if (t === 'undefined') canonFail('valor indefinido não é JSON');
    if (depth > 512) canonFail('profundidade excessiva');
    if (anc.has(v)) canonFail('referência circular');
    if (typeof v.toJSON === 'function') { var j = v.toJSON(); if (j === v) canonFail('toJSON devolveu o próprio objeto'); canonWalk(j, depth, out, anc); return; }
    anc.add(v);
    var i, x;
    if (Array.isArray(v)) {
      out.push('[');
      for (i = 0; i < v.length; i++) {
        if (i) out.push(',');
        x = v[i];
        if (x === undefined) out.push('null'); else if (typeof x === 'function' || typeof x === 'symbol') canonFail('função/símbolo não é JSON'); else canonWalk(x, depth + 1, out, anc);
      }
      out.push(']');
    } else {
      if ((typeof Map !== 'undefined' && v instanceof Map) || (typeof Set !== 'undefined' && v instanceof Set) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) canonFail('Map/Set/binário não é JSON');
      var keys = Object.keys(v).sort(), first = true;
      out.push('{');
      for (i = 0; i < keys.length; i++) {
        x = v[keys[i]];
        if (x === undefined) continue;
        if (typeof x === 'function' || typeof x === 'symbol') canonFail('função/símbolo não é JSON');
        if (!first) out.push(','); first = false;
        out.push(JSON.stringify(keys[i]), ':'); canonWalk(x, depth + 1, out, anc);
      }
      out.push('}');
    }
    anc.delete(v);
  }

  /* ---------------- base64 / data URL ---------------- */
  function b64decode(b64) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n), i;
    for (i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function b64encode(u) {
    if (typeof u.toBase64 === 'function') return u.toBase64();
    var s = '', CH = 0x8000, i;
    for (i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, Math.min(u.length, i + CH)));
    return btoa(s);
  }
  function dataUrlToBytes(dataUrl) {
    var m = /^data:([^;,]*)((?:;[^;,]*)*),/.exec(String(dataUrl));
    if (!m) throw new Error('data URL inválido');
    var meta = m[2] || '', body = String(dataUrl).slice(m[0].length), mime = (m[1] || 'text/plain').toLowerCase();
    if (/;base64(;|$)/i.test(meta)) return { mime: mime, bytes: b64decode(body) };
    return { mime: mime, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
  }
  function bytesToDataUrl(bytes, mime) { return 'data:' + (mime || 'application/octet-stream') + ';base64,' + b64encode(toBytes(bytes)); }

  /* tipo real pelos primeiros bytes (o servidor também confere; aqui só rotula o upload) */
  function sniffMime(u, fallback) {
    if (u.length > 11 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return 'image/png';
    if (u.length > 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'image/jpeg';
    if (u.length > 5 && u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x38) return 'image/gif';
    if (u.length > 11 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return 'image/webp';
    return fallback;
  }

  /* ---------------- placeholder de imagem ausente ---------------- */
  function placeholderDataUrl(sha) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#EEF2F6"/><path d="M0 0L320 200M320 0L0 200" stroke="#B8C4D0" stroke-width="2"/><text x="160" y="104" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" fill="#43698F">Imagem indisponível</text></svg>';
    var enc = encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
    return 'data:image/svg+xml;charset=utf-8;am-missing=' + sha + ',' + enc;
  }
  /* PNG cinza 2x2 (válido) para quem decide descartar imagens que se perderam de vez */
  var GRAY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPYe+rGf4b/DP8Z/jMwAAAfTAUYn0g1BQAAAABJRU5ErkJggg==';

  /* ---------------- percurso do deck ---------------- */
  /* copia o valor aplicando fn a cada string (objetos e listas são recriados; o original não muda) */
  function mapStrings(v, fn, depth) {
    depth = depth || 0;
    if (depth > 100) throw new Error('deck profundo demais');
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) { var a = new Array(v.length), i; for (i = 0; i < v.length; i++) a[i] = mapStrings(v[i], fn, depth + 1); return a; }
    if (v && typeof v === 'object') { var o = {}, k; for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) { var x = v[k]; if (x !== undefined) o[k] = mapStrings(x, fn, depth + 1); } return o; }
    return v;
  }
  function eachString(v, fn, depth) {
    depth = depth || 0;
    if (depth > 100) throw new Error('deck profundo demais');
    if (typeof v === 'string') { fn(v); return; }
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) eachString(v[i], fn, depth + 1); return; }
    if (v && typeof v === 'object') for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) eachString(v[k], fn, depth + 1);
  }
  function trimCache(c) { if (c.size > CACHE_MAX) { var n = c.size - CACHE_MAX, it = c.keys(), i; for (i = 0; i < n; i++) c.delete(it.next().value); } }
  function pool(items, limit, worker) {
    var i = 0, active = 0, failed = null;
    return new Promise(function (resolve, reject) {
      function next() {
        if (failed) return;
        if (i >= items.length && active === 0) { resolve(); return; }
        while (active < limit && i < items.length) {
          (function (it) {
            active++;
            Promise.resolve().then(function () { return worker(it); }).then(function () { active--; next(); }, function (e) { failed = e; reject(e); });
          })(items[i++]);
        }
      }
      next();
    });
  }

  /* ---------------- imagens em formatos que o servidor não guarda ---------------- */
  /* O servidor só aceita PNG, JPEG, WebP e GIF (e recusa data:image/svg+xml). O editor aceita qualquer imagem que o navegador desenhe
     (SVG, BMP, AVIF, ICO…): antes de externalizar, cada string INTEIRA data:image/<outro tipo> (src, bgImg…) é desenhada e vira PNG.
     opts: { rasterize(dataUrl) → Promise<data URL png|jpeg|webp|gif | null>, cache?:Map(original → convertido), stats?:{} → {found, converted, failed} }.
     O deck de entrada nunca é alterado (sem nada a converter, devolve o próprio deck). O que não puder ser convertido fica como está:
     o servidor recusa e quem chamou mostra onde. O aviso de imagem ausente (am-missing) não é tocado: ele volta a ser asset:sha256 ao externalizar. */
  var FOREIGN_RE = /^data:image\/(?!(?:png|jpeg|webp|gif)[;,])[\w.+-]+[;,]/i, OK_IMG = /^data:image\/(?:png|jpeg|webp|gif);base64,/;
  function isForeignImage(s) { return typeof s === 'string' && s.length > 20 && FOREIGN_RE.test(s) && s.indexOf('am-missing=') < 0; }
  function rasterizeForeignImages(deck, opts) {
    opts = opts || {};
    var fn = opts.rasterize, cache = opts.cache || new Map(), found = new Set(), out = new Map();
    eachString(deck, function (s) { if (isForeignImage(s)) found.add(s); });
    var urls = Array.from(found);
    return pool(typeof fn === 'function' ? urls : [], 2, function (u) {
      if (cache.has(u)) { out.set(u, cache.get(u)); return null; }
      return Promise.resolve().then(function () { return fn(u); }).then(function (r) {
        if (typeof r === 'string' && OK_IMG.test(r)) { out.set(u, r); cache.set(u, r); if (cache.size > 48) cache.delete(cache.keys().next().value); }
      }, function () { /* não convertida: fica como está */ });
    }).then(function () {
      var st = { found: urls.length, converted: out.size, failed: urls.length - out.size };
      if (opts.stats && typeof opts.stats === 'object') Object.assign(opts.stats, st);
      return out.size ? mapStrings(deck, function (s) { return out.has(s) ? out.get(s) : s; }) : deck;
    });
  }
  /* desenho no navegador: SVG com o maior lado em 1920 px (nítido em tela cheia; sem tamanho próprio, usa o viewBox); as demais no tamanho natural, até 1920 px */
  function svgBox(u) {
    try { var t = new TextDecoder().decode(dataUrlToBytes(u).bytes), m = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(t); return m && +m[1] > 0 && +m[2] > 0 ? [+m[1], +m[2]] : null; } catch (e) { return null; }
  }
  function browserRasterize(dataUrl) {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null);
    return new Promise(function (res) {
      var img = new Image(), done = false, t = setTimeout(function () { fin(null); }, 15000);
      function fin(v) { if (!done) { done = true; clearTimeout(t); res(v); } }
      img.onload = function () {
        try {
          var svg = /^data:image\/svg/i.test(dataUrl), w = img.naturalWidth, hh = img.naturalHeight, M = 1920;
          if (svg) { var vb = svgBox(dataUrl); if (vb && (!w || !hh || Math.abs(w / hh - vb[0] / vb[1]) > 0.02)) { w = vb[0]; hh = vb[1]; } }
          if (!w || !hh) { w = M; hh = M; }
          var k = svg ? M / Math.max(w, hh) : Math.min(1, M / Math.max(w, hh)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(hh * k));
          var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          fin(cv.toDataURL('image/png'));
        } catch (e) { fin(null); }
      };
      img.onerror = function () { fin(null); };
      img.src = dataUrl;
    });
  }

  /* ---------------- externalizar ---------------- */
  /* opts: { api:{check(shas)→faltantes, put(sha, bytes, mime, kind)}, onProgress?, maxConcurrent=4, cache?:Map, kind='image', dropMissing?:boolean }
     cache (Map): string do data URL → {sha, mime, size}; 'known:<sha>' → true quando o servidor já confirmou o arquivo.
     O deck de entrada nunca é alterado. */
  function externalizeDeck(deck, opts) {
    opts = opts || {};
    var api = opts.api, cache = opts.cache || defaultCache, conc = Math.max(1, opts.maxConcurrent || 4), kind = opts.kind || 'image';
    var onp = typeof opts.onProgress === 'function' ? opts.onProgress : function () { };
    if (!api || typeof api.check !== 'function' || typeof api.put !== 'function') return Promise.reject(new TypeError('externalizeDeck: api.check e api.put são obrigatórios'));
    var uniq = new Map(), found = 0, placeholders = 0; /* data URL → info {sha, mime, size} */
    if (opts.dropMissing) { /* descartar imagens perdidas de vez: o aviso vira um PNG cinza comum, que sobe como qualquer imagem */
      deck = mapStrings(deck, function (s) { return s.indexOf('am-missing=') < 0 ? s : s.replace(new RegExp(MISSING_RE.source, 'g'), function () { placeholders++; return GRAY_PNG; }); });
    }
    eachString(deck, function (s) {
      if (s.length < 40) return;
      var m, re = new RegExp(IMG_RE.source, 'g');
      while ((m = re.exec(s))) { found++; if (!uniq.has(m[0])) uniq.set(m[0], null); }
    });
    var urls = Array.from(uniq.keys()), total = urls.length, done = 0, bytesBySha = new Map(), shaMime = new Map(), shrunk = 0;
    /* bytes que vão ao servidor para um data URL: o original ou, acima de maxBytes, o que opts.shrink devolver (ex.: recompressão no navegador) */
    function prepare(u) {
      var d = dataUrlToBytes(u), mime = sniffMime(d.bytes, d.mime);
      if (opts.shrink && opts.maxBytes && d.bytes.length > opts.maxBytes) {
        return Promise.resolve(opts.shrink(d.bytes, mime)).then(function (r) { return r && r.bytes && r.bytes.length < d.bytes.length ? { bytes: r.bytes, mime: r.mime || mime, shrunk: true } : { bytes: d.bytes, mime: mime }; });
      }
      return Promise.resolve({ bytes: d.bytes, mime: mime });
    }
    onp({ phase: 'hash', done: 0, total: total });
    return pool(urls, conc, function (u) {
      var hit = cache.get(u);
      if (hit && hit.sha) { uniq.set(u, hit); if (hit.shrunk) shrunk++; done++; onp({ phase: 'hash', done: done, total: total }); return null; }
      return Promise.resolve().then(function () { return prepare(u); }).then(function (pr) {
        return sha256Hex(pr.bytes).then(function (sha) {
          var info = { sha: sha, mime: pr.mime, size: pr.bytes.length, shrunk: !!pr.shrunk };
          cache.set(u, info); uniq.set(u, info); if (pr.shrunk) shrunk++;
          if (!bytesBySha.has(sha)) bytesBySha.set(sha, pr.bytes);
          done++; onp({ phase: 'hash', done: done, total: total });
        });
      });
    }).then(function () {
      trimCache(cache);
      var shas = [], seen = new Set();
      uniq.forEach(function (info) { if (info && !seen.has(info.sha)) { seen.add(info.sha); shas.push(info.sha); shaMime.set(info.sha, info.mime); } });
      var ask = shas.filter(function (s) { return !cache.get('known:' + s); }), missing = [], chunks = [], i;
      for (i = 0; i < ask.length; i += 200) chunks.push(ask.slice(i, i + 200));
      onp({ phase: 'check', done: 0, total: ask.length });
      return pool(chunks, 1, function (ch) {
        return Promise.resolve(api.check(ch)).then(function (r) { (r || []).forEach(function (s) { missing.push(s); }); });
      }).then(function () {
        ask.forEach(function (s) { if (missing.indexOf(s) < 0) cache.set('known:' + s, true); });
        var up = Array.from(new Set(missing)).filter(function (s) { return seen.has(s); }), upDone = 0, upBytes = 0;
        onp({ phase: 'upload', done: 0, total: up.length, bytes: 0 });
        return pool(up, conc, function (sha) {
          var bytes = bytesBySha.get(sha);
          var getBytes = bytes ? Promise.resolve(bytes) : Promise.resolve().then(function () { /* hash veio do cache: decodifica (e, se preciso, recomprime) só agora, só o que falta */
            var found2 = null; uniq.forEach(function (info, u) { if (!found2 && info && info.sha === sha) found2 = u; });
            return prepare(found2).then(function (pr) { return pr.bytes; });
          });
          return getBytes.then(function (b) {
            return Promise.resolve(api.put(sha, b, shaMime.get(sha) || 'application/octet-stream', kind)).then(function () {
              cache.set('known:' + sha, true); upDone++; upBytes += b.length; onp({ phase: 'upload', done: upDone, total: up.length, bytes: upBytes });
            });
          });
        }).then(function () {
          bytesBySha.clear();
          var content = mapStrings(deck, function (s) {
            if (s.length < 40) return s;
            var out = s;
            if (out.indexOf('data:image/') >= 0) {
              out = out.replace(new RegExp(MISSING_RE.source, 'g'), function (m, sha) { placeholders++; return 'asset:sha256:' + sha; });
              out = out.replace(new RegExp(IMG_RE.source, 'g'), function (m) { var info = uniq.get(m); return info ? 'asset:sha256:' + info.sha : m; });
            }
            return out;
          });
          return { content: content, stats: { found: found, unique: shas.length, uploaded: up.length, deduplicated: found - up.length, bytes: upBytes, placeholders: placeholders, shrunk: shrunk } };
        });
      });
    });
  }

  /* ---------------- hidratar ---------------- */
  /* opts: { fetchAsset(sha)→{mime, bytes}, cache?:Map(sha→data URL), onProgress?, maxConcurrent=4, stats?:{} } */
  function hydrateDeck(content, opts) {
    opts = opts || {};
    var fetchAsset = opts.fetchAsset, cache = opts.cache || new Map(), conc = Math.max(1, opts.maxConcurrent || 4);
    var onp = typeof opts.onProgress === 'function' ? opts.onProgress : function () { };
    if (typeof fetchAsset !== 'function') return Promise.reject(new TypeError('hydrateDeck: fetchAsset é obrigatório'));
    var shas = new Set(), found = 0;
    eachString(content, function (s) {
      if (s.indexOf('asset:sha256:') < 0) return;
      var m, re = new RegExp(ASSET_RE.source, 'g');
      while ((m = re.exec(s))) { found++; shas.add(m[1]); }
    });
    var list = Array.from(shas), total = list.length, done = 0, fetched = 0, cached = 0, missing = [], urlBySha = new Map();
    onp({ phase: 'fetch', done: 0, total: total });
    return pool(list, conc, function (sha) {
      if (cache.has(sha)) { urlBySha.set(sha, cache.get(sha)); cached++; done++; onp({ phase: 'fetch', done: done, total: total }); return null; }
      return Promise.resolve().then(function () { return fetchAsset(sha); }).then(function (r) {
        if (!r || !r.bytes) throw new Error('arquivo vazio');
        var url = bytesToDataUrl(r.bytes, r.mime || 'application/octet-stream');
        cache.set(sha, url); urlBySha.set(sha, url); fetched++;
      }).catch(function () { missing.push(sha); urlBySha.set(sha, placeholderDataUrl(sha)); }).then(function () { done++; onp({ phase: 'fetch', done: done, total: total, missing: missing.length }); });
    }).then(function () {
      var deck = mapStrings(content, function (s) {
        if (s.indexOf('asset:sha256:') < 0) return s;
        return s.replace(new RegExp(ASSET_RE.source, 'g'), function (m, sha) { return urlBySha.get(sha) || m; });
      });
      var stats = { found: found, unique: total, fetched: fetched, cached: cached, missing: missing };
      if (opts.stats && typeof opts.stats === 'object') Object.assign(opts.stats, stats);
      if (deck && typeof deck === 'object') Object.defineProperty(deck, 'hydration', { value: stats, enumerable: false, configurable: true });
      return deck;
    });
  }

  /* ---------------- ler arquivos do Canteiro ---------------- */
  function extractDeckFromHtml(html) {
    if (typeof html !== 'string' || html.indexOf('am-deck-data') < 0) return null;
    var re = /<script\b[^>]*\bid\s*=\s*["']am-deck-data["'][^>]*>([\s\S]*?)<\/script>/i, m = re.exec(html);
    if (!m) return null;
    try { var d = JSON.parse(m[1]); return d && typeof d === 'object' && Array.isArray(d.slides) ? d : null; } catch (e) { return null; }
  }
  function isDeck(d) { return !!d && typeof d === 'object' && Array.isArray(d.slides) && d.slides.length > 0; }
  function item(o, i) {
    var deck = o && o.deck && typeof o.deck === 'object' ? o.deck : o;
    if (!isDeck(deck)) return null;
    var id = typeof o.id === 'string' && o.id ? o.id : typeof deck.id === 'string' && deck.id ? deck.id : 'obra-' + (i + 1);
    var title = typeof o.title === 'string' && o.title.trim() ? o.title : typeof deck.title === 'string' && deck.title.trim() ? deck.title : 'Apresentação';
    return { id: id, title: title.slice(0, 300), deck: deck };
  }
  /* {kind:'canteiro-acervo', v:1, obras:[…]} (Minhas obras › exportar) · lista de registros ou decks · registro solto {id,title,deck} · deck solto */
  function parseAcervoJson(text) {
    var j = typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) : text;
    var arr = j && j.kind === 'canteiro-acervo' && Array.isArray(j.obras) ? j.obras : Array.isArray(j) ? j : j ? [j] : [];
    var out = [];
    arr.forEach(function (o, i) { var it = o && typeof o === 'object' ? item(o, i) : null; if (it) out.push(it); });
    return out;
  }

  /* ---------------- dados locais da nuvem (computador compartilhado) ---------------- */
  /* O editor em nuvem guarda neste navegador: a fila do que não chegou ao servidor (IndexedDB "canteiro-cloud"), respostas/quadros/votos
     (amForm./amBoard./amVote.), notas do player (amPlayer.), kits e preferências (amStudio.) e quem usou por último (amCloud.user).
     O editor e as páginas usam estas funções: outra pessoa entrou → o que é de quem usou antes sai; "Sair" → tudo sai. */
  var PERSON_KEYS = /^(?:amForm|amBoard|amVote|amPlayer|amStudio)\./, CLOUD_KEYS = /^(?:amForm|amBoard|amVote|amPlayer|amStudio|amCloud)\.|^am\.import\./;
  function webStore(k) { try { return root[k] || null; } catch (e) { return null; } }
  function dropKeys(st, re) { try { for (var i = st.length - 1; i >= 0; i--) { var k = st.key(i); if (k && re.test(k)) st.removeItem(k); } } catch (e) { } }
  function switchLocalUser(id) {
    var L = webStore('localStorage'), prev = null; if (!L || !id) return false;
    try { prev = L.getItem('amCloud.user'); } catch (e) { }
    if (prev === id) return false;
    if (prev) dropKeys(L, PERSON_KEYS);
    try { L.setItem('amCloud.user', id); } catch (e) { }
    return !!prev;
  }
  /* abre só um banco que JÁ existe (a criação de um vazio é abortada) */
  function openExisting(name) {
    return new Promise(function (res) {
      try { var r = root.indexedDB.open(name); r.onupgradeneeded = function () { try { r.transaction.abort(); } catch (e) { } }; r.onsuccess = function () { res(r.result); }; r.onerror = r.onblocked = function () { res(null); }; }
      catch (e) { res(null); }
    });
  }
  function pendingLocalCount() {
    if (!root.indexedDB) return Promise.resolve(0);
    return openExisting('canteiro-cloud').then(function (db) {
      if (!db) return 0;
      var count = function (n) { return new Promise(function (res) { try { if (!db.objectStoreNames.contains(n)) return res(0); var q = db.transaction(n).objectStore(n).count(); q.onsuccess = function () { res(q.result || 0); }; q.onerror = function () { res(0); }; } catch (e) { res(0); } }); };
      return Promise.all([count('pending'), count('outbox')]).then(function (a) { db.close(); return a[0] + a[1]; });
    });
  }
  /* onblocked/onerror NÃO significam exclusão concluída. A Promise informa
     falha para que o logout alerte quem compartilha este computador. */
  function deleteDb(name) {
    return new Promise(function (res) {
      var done = false, timer = null;
      function finish(ok) { if (done) return; done = true; clearTimeout(timer); res(ok); }
      try {
        var r = root.indexedDB.deleteDatabase(name);
        r.onsuccess = function () { finish(true); };
        r.onerror = r.onblocked = function () { finish(false); };
        timer = setTimeout(function () { finish(false); }, 2000);
      } catch (e) { finish(false); }
    });
  }
  function clearLocalData() {
    ['localStorage', 'sessionStorage'].forEach(function (k) { var st = webStore(k); if (st) dropKeys(st, CLOUD_KEYS); });
    /* "canteiro" = Minhas obras do editor original nesta origem.
       Só declarar limpeza completa quando os DOIS bancos confirmarem onsuccess. */
    return root.indexedDB ? Promise.all(['canteiro-cloud', 'canteiro'].map(deleteDb)).then(function (results) { return results.every(Boolean); }) : Promise.resolve(true);
  }

  var api = {
    sha256Hex: sha256Hex, canonicalJSON: canonicalJSON, dataUrlToBytes: dataUrlToBytes, bytesToDataUrl: bytesToDataUrl,
    externalizeDeck: externalizeDeck, hydrateDeck: hydrateDeck, extractDeckFromHtml: extractDeckFromHtml, parseAcervoJson: parseAcervoJson,
    rasterizeForeignImages: rasterizeForeignImages, browserRasterize: browserRasterize, isForeignImage: isForeignImage,
    switchLocalUser: switchLocalUser, pendingLocalCount: pendingLocalCount, clearLocalData: clearLocalData,
    placeholderDataUrl: placeholderDataUrl, sniffMime: sniffMime, isAssetSha: function (s) { return HEX64.test(String(s)); },
    IMG_RE_SOURCE: IMG_RE.source, GRAY_PNG: GRAY_PNG, version: 1
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.AMCloudCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
