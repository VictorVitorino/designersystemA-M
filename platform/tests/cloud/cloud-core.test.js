/* Testes do cloud-core (Node 22, node:test). Uso: node --test platform/tests/cloud/cloud-core.test.js
   O JSON canônico é comparado com src/lib/canonical.js (servidor) quando o arquivo existe; enquanto ele não existe, usa-se uma
   implementação de referência escrita aqui (contrato: chaves ordenadas recursivamente, sem espaços) e o teste informa qual foi usada. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import cc from '../../studio-cloud/cloud-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_CANON = path.join(here, '../../src/lib/canonical.js');

/* ---------- gerador determinístico ---------- */
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const STR = ['', 'a', 'Ação', 'título "com aspas"', 'linha\nquebra\ttab', '  ', '😀 emoji', '<b>html</b>', 'z', 'ß', '\u0000nul', 'x'.repeat(200)];
function gen(r, d = 0) {
  const k = r();
  if (d > 4 || k < 0.35) {
    const t = Math.floor(r() * 7);
    if (t === 0) return null; if (t === 1) return r() < 0.5; if (t === 2) return Math.floor(r() * 2000 - 1000);
    if (t === 3) return Math.round(r() * 1e6) / 1000; if (t === 4) return -0; if (t === 5) return 1e21 * r(); return STR[Math.floor(r() * STR.length)];
  }
  if (k < 0.6) { const n = Math.floor(r() * 5); return Array.from({ length: n }, () => gen(r, d + 1)); }
  const o = {}; const n = Math.floor(r() * 6);
  for (let i = 0; i < n; i++) { const key = r() < 0.2 ? STR[Math.floor(r() * STR.length)] : 'k' + Math.floor(r() * 12); o[key] = gen(r, d + 1); }
  if (r() < 0.1) o.u = undefined;
  return o;
}
function refCanon(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : refCanon(x))).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + refCanon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

test('sha256Hex: vetores conhecidos, texto e bytes', async () => {
  assert.equal(await cc.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await cc.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await cc.sha256Hex(new TextEncoder().encode('ação')), createHash('sha256').update('ação', 'utf8').digest('hex'));
  const b = randomBytes(100000);
  assert.equal(await cc.sha256Hex(new Uint8Array(b)), createHash('sha256').update(b).digest('hex'));
  assert.equal(await cc.sha256Hex(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), createHash('sha256').update(b).digest('hex'));
});

test('canonicalJSON: idêntico ao do servidor em 300 valores gerados (e hash idêntico)', async () => {
  let server = null, which = 'referência local (src/lib/canonical.js ainda não existe)';
  if (existsSync(SERVER_CANON)) {
    const m = await import(pathToFileURL(SERVER_CANON).href);
    server = m.canonicalize || m.canonicalJSON || m.canonical || m.default;
    assert.equal(typeof server, 'function', 'src/lib/canonical.js deve exportar uma função (canonicalize | canonicalJSON | canonical | default)');
    which = 'src/lib/canonical.js';
  }
  const fn = server || refCanon;
  const r = rng(12345); let n = 0, withUndefined = 0;
  for (let i = 0; i < 300; i++) {
    const v = gen(r);
    const a = cc.canonicalJSON(v), b = fn(v);
    assert.equal(a, b, 'valor #' + i + ': ' + a.slice(0, 120));
    if (JSON.stringify(v) !== undefined) assert.equal(await cc.sha256Hex(a), createHash('sha256').update(b, 'utf8').digest('hex'));
    n++; if (a.includes('"u"')) withUndefined++;
  }
  /* o que o JSON não representa é recusado como no servidor */
  for (const bad of [NaN, Infinity, undefined, () => 1, 10n, { a: () => 1 }, new Map(), (() => { const o = {}; o.o = o; return o; })()]) {
    assert.throws(() => cc.canonicalJSON(bad), TypeError);
    if (server) assert.throws(() => server(bad), TypeError);
  }
  assert.equal(cc.canonicalJSON([undefined, { a: undefined, b: 1 }]), '[null,{"b":1}]');
  /* ordem de inserção não importa */
  assert.equal(cc.canonicalJSON({ b: 1, a: { d: 1, c: 2 } }), cc.canonicalJSON({ a: { c: 2, d: 1 }, b: 1 }));
  assert.equal(cc.canonicalJSON({ a: 1, b: [1, 2, { z: 1, y: 2 }] }), '{"a":1,"b":[1,2,{"y":2,"z":1}]}');
  console.log('# canonicalJSON: ' + n + ' valores comparados com ' + which);
  assert.ok(n >= 200);
});

test('dataUrlToBytes / bytesToDataUrl: ida e volta byte a byte', () => {
  for (const size of [0, 1, 2, 3, 4, 100, 4095, 32768, 32769, 70001]) {
    const b = new Uint8Array(randomBytes(size));
    const u = cc.bytesToDataUrl(b, 'image/png');
    assert.ok(u.startsWith('data:image/png;base64,'));
    const back = cc.dataUrlToBytes(u);
    assert.equal(back.mime, 'image/png');
    assert.deepEqual(Buffer.from(back.bytes), Buffer.from(b));
    assert.equal(cc.bytesToDataUrl(back.bytes, back.mime), u);
  }
  assert.equal(new TextDecoder().decode(cc.dataUrlToBytes('data:text/plain,ol%C3%A1').bytes), 'olá');
  assert.throws(() => cc.dataUrlToBytes('http://x/y.png'));
});

/* ---------- servidor de arquivos de mentira ---------- */
function fakeApi(opts = {}) {
  const store = new Map(); const log = { check: [], put: [], active: 0, peak: 0 };
  return {
    store, log,
    api: {
      async check(shas) { log.check.push(shas.slice()); return shas.filter((s) => !store.has(s)); },
      async put(sha, bytes, mime, kind) {
        log.active++; log.peak = Math.max(log.peak, log.active);
        await new Promise((r) => setTimeout(r, opts.delay || 0));
        log.active--;
        if (opts.failPut) throw new Error('queda de rede');
        const real = createHash('sha256').update(bytes).digest('hex'); assert.equal(real, sha, 'put recebeu um sha que não confere com os bytes');
        store.set(sha, { bytes: Buffer.from(bytes), mime, kind }); log.put.push({ sha, mime, kind, size: bytes.length });
      }
    },
    async fetchAsset(sha) { const f = store.get(sha); if (!f) throw new Error('404'); return { mime: f.mime, bytes: new Uint8Array(f.bytes) }; }
  };
}
const png = (n, seed) => { const b = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(rng(seed)().toString()), randomBytes(n)]); return 'data:image/png;base64,' + b.toString('base64'); };
const jpg = (n) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]).toString('base64');
const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');

function sampleDeck() {
  const A = png(3000, 1), B = jpg(5000), C = png(800, 2);
  return {
    A, B, C,
    deck: {
      v: 1, app: 'AM Studio', id: 'd1', title: 'Teste',
      slides: [
        { id: 's1', bg: '#fff', bgImg: A, els: [{ id: 'e1', type: 'image', src: A, x: 1, y: 2, w: 3, h: 4 }, { id: 'e2', type: 'image', src: B }, { id: 'e3', type: 'text', html: '<p>oi <img src="' + C + '" alt="x"> fim</p>' }] },
        { id: 's2', bg: '#000', els: [{ id: 'e4', type: 'fx', kind: 'x', data: { css: 'background:url(' + C + ') center; color:red', svg: SVG, nested: { arr: [A, 'sem imagem', 12, null, true] } } }] }
      ]
    }
  };
}

test('externalizeDeck: troca TODA ocorrência (src, bgImg, HTML, CSS), não altera a entrada, envia só o que falta e deduplica', async () => {
  const { deck, A, B, C } = sampleDeck(); const before = JSON.stringify(deck);
  const f = fakeApi(); const cache = new Map();
  const r = await cc.externalizeDeck(deck, { api: f.api, cache });
  assert.equal(JSON.stringify(deck), before, 'a entrada foi alterada');
  const out = JSON.stringify(r.content);
  assert.ok(!/data:image\/(png|jpeg|webp|gif)/.test(out), 'sobrou data:image no conteúdo');
  assert.ok(out.includes(SVG), 'o SVG embutido não deveria ser tocado');
  assert.equal(r.stats.found, 6, 'ocorrências: A×3 (src, bgImg, arr), B×1, C×2 (html, css)');
  assert.equal(r.stats.unique, 3); assert.equal(r.stats.uploaded, 3); assert.equal(r.stats.deduplicated, 3);
  assert.equal(f.log.put.length, 3);
  assert.equal(r.stats.bytes, f.log.put.reduce((a, p) => a + p.size, 0));
  const shaA = createHash('sha256').update(cc.dataUrlToBytes(A).bytes).digest('hex');
  assert.equal(r.content.slides[0].els[0].src, 'asset:sha256:' + shaA);
  assert.equal(r.content.slides[0].bgImg, 'asset:sha256:' + shaA);
  assert.equal(r.content.slides[1].els[0].data.nested.arr[0], 'asset:sha256:' + shaA);
  assert.match(r.content.slides[0].els[2].html, /<img src="asset:sha256:[0-9a-f]{64}" alt="x">/);
  assert.match(r.content.slides[1].els[0].data.css, /^background:url\(asset:sha256:[0-9a-f]{64}\) center; color:red$/);
  assert.equal(f.log.put.find((p) => p.mime === 'image/jpeg').kind, 'image');
  void B; void C;
});

test('externalizeDeck: segundo salvamento com cache não recalcula hash nem reenvia nem consulta de novo', async () => {
  const { deck } = sampleDeck(); const f = fakeApi(); const cache = new Map();
  await cc.externalizeDeck(deck, { api: f.api, cache });
  const subtle = globalThis.crypto.subtle, orig = subtle.digest.bind(subtle); let digests = 0;
  subtle.digest = (...a) => { digests++; return orig(...a); };
  try {
    const checks = f.log.check.length;
    const r2 = await cc.externalizeDeck(deck, { api: f.api, cache });
    assert.equal(digests, 0, 'recalculou hash apesar do cache');
    assert.equal(f.log.check.length, checks, 'consultou o servidor de novo por arquivos já confirmados');
    assert.equal(r2.stats.uploaded, 0); assert.equal(r2.stats.deduplicated, r2.stats.found);
    /* cache vazio: recalcula, mas o servidor já tem tudo → 1 consulta, 0 envios */
    digests = 0; const r3 = await cc.externalizeDeck(deck, { api: f.api, cache: new Map() });
    assert.equal(digests, r3.stats.unique); assert.equal(r3.stats.uploaded, 0);
    assert.equal(f.log.put.length, 3);
  } finally { subtle.digest = orig; }
});

test('externalizeDeck: mesma imagem 2× em slides diferentes = 1 envio; imagem nova = só ela é enviada', async () => {
  const f = fakeApi(); const X = png(1500, 9);
  const mk = (...imgs) => ({ v: 1, title: 't', slides: [{ id: 'a', els: imgs.map((s, i) => ({ id: 'e' + i, type: 'image', src: s })) }] });
  const r1 = await cc.externalizeDeck(mk(X, X), { api: f.api, cache: new Map() });
  assert.equal(r1.stats.found, 2); assert.equal(r1.stats.uploaded, 1); assert.equal(r1.stats.deduplicated, 1); assert.equal(f.log.put.length, 1);
  const Y = jpg(900);
  const r2 = await cc.externalizeDeck(mk(X, X, Y), { api: f.api });
  assert.equal(r2.stats.uploaded, 1); assert.equal(f.log.put.length, 2);
});

test('externalizeDeck: concorrência limitada (maxConcurrent) e falha de envio rejeita', async () => {
  const f = fakeApi({ delay: 15 }); const imgs = Array.from({ length: 12 }, (_, i) => png(500, 100 + i));
  const deck = { v: 1, slides: [{ id: 'a', els: imgs.map((s, i) => ({ id: 'e' + i, type: 'image', src: s })) }] };
  const prog = [];
  const r = await cc.externalizeDeck(deck, { api: f.api, maxConcurrent: 3, onProgress: (p) => prog.push(p) });
  assert.equal(r.stats.uploaded, 12); assert.ok(f.log.peak <= 3 && f.log.peak >= 2, 'pico de envios simultâneos = ' + f.log.peak);
  assert.ok(prog.some((p) => p.phase === 'upload' && p.done === 12) && prog.some((p) => p.phase === 'hash'));
  const bad = fakeApi({ failPut: true });
  await assert.rejects(cc.externalizeDeck(deck, { api: bad.api, cache: new Map() }), /queda de rede/);
  await assert.rejects(cc.externalizeDeck(deck, {}), /api\.check/);
});

test('externalizeDeck: mais de 200 arquivos distintos consultam em lotes de até 200', async () => {
  const f = fakeApi(); const imgs = Array.from({ length: 230 }, (_, i) => png(40, 1000 + i));
  const deck = { v: 1, slides: [{ id: 'a', els: imgs.map((s, i) => ({ id: 'e' + i, type: 'image', src: s })) }] };
  const r = await cc.externalizeDeck(deck, { api: f.api, cache: new Map() });
  assert.equal(r.stats.unique, 230); assert.deepEqual(f.log.check.map((c) => c.length).sort((a, b) => b - a), [200, 30]);
});

test('hydrateDeck: ida e volta byte a byte (hidratar o externalizado devolve o deck original)', async () => {
  const { deck } = sampleDeck(); const f = fakeApi();
  const ext = await cc.externalizeDeck(deck, { api: f.api, cache: new Map() });
  const stats = {}; const cache = new Map();
  const back = await cc.hydrateDeck(ext.content, { fetchAsset: f.fetchAsset, cache, stats });
  assert.equal(JSON.stringify(back), JSON.stringify(deck), 'o deck hidratado não é idêntico ao original');
  assert.deepEqual(stats.missing, []); assert.equal(stats.unique, 3); assert.equal(stats.fetched, 3);
  assert.equal(back.hydration.fetched, 3); assert.ok(!JSON.stringify(back).includes('hydration'));
  /* cache: segunda hidratação não busca nada */
  let fetches = 0; const again = await cc.hydrateDeck(ext.content, { fetchAsset: (s) => { fetches++; return f.fetchAsset(s); }, cache, stats: (Object.keys(stats).forEach((k) => delete stats[k]), stats) });
  assert.equal(fetches, 0); assert.equal(stats.cached, 3); assert.equal(JSON.stringify(again), JSON.stringify(deck));
  /* e o re-externalizar do hidratado, com cache, não reenvia nada */
  const r3 = await cc.externalizeDeck(back, { api: f.api, cache: new Map() });
  assert.equal(JSON.stringify(r3.content), JSON.stringify(ext.content)); assert.equal(r3.stats.uploaded, 0);
});

test('hydrateDeck: falha de um arquivo não derruba o deck (placeholder SVG + stats.missing) e não perde a referência ao salvar de novo', async () => {
  const { deck } = sampleDeck(); const f = fakeApi();
  const ext = await cc.externalizeDeck(deck, { api: f.api, cache: new Map() });
  const lost = [...f.store.keys()][1]; const stats = {};
  const back = await cc.hydrateDeck(ext.content, { fetchAsset: (s) => (s === lost ? Promise.reject(new Error('503')) : f.fetchAsset(s)), stats });
  assert.deepEqual(stats.missing, [lost]); assert.equal(stats.fetched, 2);
  const s = JSON.stringify(back);
  assert.ok(s.includes('data:image/svg+xml;charset=utf-8;am-missing=' + lost));
  assert.ok(!s.includes('asset:sha256:'), 'sobrou referência sem hidratar');
  assert.ok(/data:image\/(png|jpeg);base64,/.test(s), 'as outras imagens foram hidratadas');
  /* o aviso nunca sobe como SVG: ao externalizar, volta a ser a referência original */
  const back2 = await cc.externalizeDeck(back, { api: f.api, cache: new Map() });
  assert.equal(JSON.stringify(back2.content), JSON.stringify(ext.content));
  assert.ok(back2.stats.placeholders >= 1);
  /* decisão de descartar o que se perdeu: vira um PNG comum, que sobe como arquivo */
  const dropped = await cc.externalizeDeck(back, { api: f.api, cache: new Map(), dropMissing: true });
  assert.ok(!JSON.stringify(dropped.content).includes(lost));
  assert.ok(!/data:image\/(png|jpeg|webp|gif)/.test(JSON.stringify(dropped.content)));
});

test('hydrateDeck: concorrência limitada; deck sem imagens passa direto', async () => {
  const shas = Array.from({ length: 10 }, (_, i) => createHash('sha256').update('x' + i).digest('hex'));
  const content = { v: 1, slides: [{ id: 'a', els: shas.map((s, i) => ({ id: 'e' + i, type: 'image', src: 'asset:sha256:' + s })) }] };
  let active = 0, peak = 0;
  const d = await cc.hydrateDeck(content, { maxConcurrent: 2, fetchAsset: async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 10)); active--; return { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }; } });
  assert.ok(peak <= 2); assert.equal(d.slides[0].els[9].src, 'data:image/png;base64,AQID');
  const plain = { v: 1, title: 'x', slides: [{ id: 'a', els: [] }] };
  assert.deepEqual(await cc.hydrateDeck(plain, { fetchAsset: () => assert.fail('não deveria buscar') }), plain);
});

test('extractDeckFromHtml: lê o am-deck-data de uma apresentação salva pelo editor', () => {
  const deck = { v: 1, app: 'AM Studio', title: 'Olá </script><b>', slides: [{ id: 's', els: [{ id: 'e', type: 'text', html: '<b>x</b>' }] }] };
  const json = JSON.stringify(deck).replace(/</g, '\\u003c');
  const html = '<!DOCTYPE html><html><head><title>x</title></head><body><script>var s="am-deck-data"; /* decoy */</script><div id="am-player"></div><script type="application/json" id="am-deck-data">' + json + '</script><script>AMRT.player(JSON.parse(document.getElementById("am-deck-data").textContent))</script></body></html>';
  assert.deepEqual(cc.extractDeckFromHtml(html), deck);
  assert.deepEqual(cc.extractDeckFromHtml(html.replace('type="application/json" id="am-deck-data"', 'id=\'am-deck-data\' type="application/json"')), deck);
  assert.equal(cc.extractDeckFromHtml('<html></html>'), null);
  assert.equal(cc.extractDeckFromHtml('<script id="am-deck-data">{quebrado</script>'), null);
  assert.equal(cc.extractDeckFromHtml('<script id="am-deck-data">{"x":1}</script>'), null);
  assert.equal(cc.extractDeckFromHtml(null), null);
});

test('parseAcervoJson: formato do "Minhas obras" e variações aceitas', () => {
  const d1 = { v: 1, id: 'd1', title: 'Um', slides: [{ id: 's', els: [] }] }, d2 = { v: 1, title: 'Dois', slides: [{ id: 's', els: [] }] };
  const full = JSON.stringify({ kind: 'canteiro-acervo', v: 1, obras: [{ id: 'o1', title: 'Obra 1', deck: d1, updatedAt: 1 }, { id: 'o2', deck: d2 }, { id: 'ruim', deck: { slides: [] } }, null] });
  const a = cc.parseAcervoJson(full);
  assert.deepEqual(a.map((x) => [x.id, x.title]), [['o1', 'Obra 1'], ['o2', 'Dois']]);
  assert.equal(a[0].deck.id, 'd1');
  assert.deepEqual(cc.parseAcervoJson('﻿' + full).length, 2);
  assert.deepEqual(cc.parseAcervoJson(JSON.stringify([{ id: 'x', title: 'X', deck: d2 }, d1])).map((x) => x.id), ['x', 'd1']);
  assert.deepEqual(cc.parseAcervoJson(JSON.stringify({ id: 'solto', title: 'Solto', deck: d1 })).map((x) => [x.id, x.title]), [['solto', 'Solto']]);
  const solo = cc.parseAcervoJson(JSON.stringify(d1)); assert.equal(solo.length, 1); assert.equal(solo[0].id, 'd1'); assert.equal(solo[0].title, 'Um');
  assert.deepEqual(cc.parseAcervoJson('[]'), []); assert.deepEqual(cc.parseAcervoJson('{"a":1}'), []);
  assert.throws(() => cc.parseAcervoJson('{quebrado'));
});

test('isomórfico: expõe window.AMCloudCore no navegador e módulo em Node', async () => {
  assert.equal(typeof cc.sha256Hex, 'function');
  assert.equal(globalThis.AMCloudCore, cc, 'em Node também fica em globalThis.AMCloudCore');
});

test('externalizeDeck: imagem acima de maxBytes passa por shrink (recompressão) e a referência aponta para o arquivo reduzido', async () => {
  const f = fakeApi(); const big = png(30000, 77), small = png(500, 78);
  const deck = { v: 1, slides: [{ id: 'a', els: [{ id: 'e1', type: 'image', src: big }, { id: 'e2', type: 'image', src: small }, { id: 'e3', type: 'image', src: big }] }] };
  let calls = 0; const shrink = async (bytes, mime) => { calls++; return { bytes: bytes.slice(0, 4000), mime: 'image/jpeg' }; };
  const cache = new Map();
  const r = await cc.externalizeDeck(deck, { api: f.api, cache, maxBytes: 10000, shrink });
  assert.equal(calls, 1, 'a mesma imagem grande 2× é reduzida uma vez');
  assert.equal(r.stats.shrunk, 1); assert.equal(r.stats.uploaded, 2);
  const shrunkPut = f.log.put.find((p) => p.size === 4000); assert.ok(shrunkPut && shrunkPut.mime === 'image/jpeg');
  assert.equal(r.content.slides[0].els[0].src, 'asset:sha256:' + shrunkPut.sha);
  /* segundo salvamento: cache, sem reduzir de novo */
  const r2 = await cc.externalizeDeck(deck, { api: f.api, cache, maxBytes: 10000, shrink });
  assert.equal(calls, 1); assert.equal(r2.stats.uploaded, 0); assert.equal(JSON.stringify(r2.content), JSON.stringify(r.content));
  /* o servidor perdeu o arquivo: reenvia o REDUZIDO (não o original) */
  f.store.delete(shrunkPut.sha); cache.delete('known:' + shrunkPut.sha);
  const r3 = await cc.externalizeDeck(deck, { api: f.api, cache, maxBytes: 10000, shrink });
  assert.equal(r3.stats.uploaded, 1); assert.equal(f.store.get(shrunkPut.sha).bytes.length, 4000);
});
