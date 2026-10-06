import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, contentHash, sha256Hex } from '../../src/lib/canonical.js';
import { readFileSync } from 'node:fs';

describe('sha256Hex — vetores conhecidos (calculados fora do Node, com hashlib)', () => {
  test('string vazia, "abc" e frase clássica (FIPS 180-2 / NIST)', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(sha256Hex('The quick brown fox jumps over the lazy dog'), 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });
  test('texto é UTF-8 (acentos) e Buffer/Uint8Array/ArrayBuffer dão o mesmo resultado', () => {
    const want = 'bc52309f8f43f460512b7f3fe2ee32f2bf4176bb4c6db01bcaabb227021aa9c4';
    assert.equal(sha256Hex('apresentação'), want);
    const b = Buffer.from('apresentação', 'utf8');
    assert.equal(sha256Hex(b), want);
    assert.equal(sha256Hex(new Uint8Array(b)), want);
    assert.equal(sha256Hex(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), want);
  });
  test('respeita o recorte (byteOffset/length) de um Buffer que é "view" de outro maior', () => {
    const big = Buffer.from('xxabcxx'); assert.equal(sha256Hex(big.subarray(2, 5)), sha256Hex('abc'));
  });
  test('tipos inválidos lançam (nada de hash de "[object Object]")', () => {
    for (const bad of [undefined, null, 1, {}, [], Symbol('x')]) assert.throws(() => sha256Hex(bad), TypeError);
  });
  test('saída é sempre hex minúsculo de 64 caracteres', () => { assert.match(sha256Hex('qualquer coisa'), /^[0-9a-f]{64}$/); });
});

describe('canonicalize — ordem, espaços e codificação', () => {
  test('chaves ordenadas, sem espaços (vetores calculados com json.dumps(sort_keys, separators))', () => {
    assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
    assert.equal(contentHash({ b: 2, a: 1 }), '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
    assert.equal(canonicalize({ z: [3, 2, 1], a: { y: null, x: true } }), '{"a":{"x":true,"y":null},"z":[3,2,1]}');
    assert.equal(contentHash({ z: [3, 2, 1], a: { y: null, x: true } }), '263473152654269cca96a2242fc8076ac22be2ec357dc2d54d656f5be84c9985');
    assert.equal(contentHash({ 'título': 'Olá, mundo', n: 1.5, e: 1e21, s: 'a"b\\c\n' }), '5087ac57c75a90125856d9e9d84f88347216f99e834b6750e67f1b8dae931383');
    assert.equal(contentHash([1, '2', null]), '5ad3148e6fc38048574211a1a434e5201b642aa48815d3fc9a00d07734e60867');
  });
  test('ordem de inserção não muda o hash (recursivamente)', () => {
    const a = { slides: [{ id: 1, els: [{ y: 2, x: 1, d: { q: 1, p: 2 } }] }], title: 'T', v: 1 };
    const b = { v: 1, title: 'T', slides: [{ els: [{ d: { p: 2, q: 1 }, x: 1, y: 2 }], id: 1 }] };
    assert.equal(canonicalize(a), canonicalize(b)); assert.equal(contentHash(a), contentHash(b));
  });
  test('ordem de ARRAY importa (é semântica)', () => { assert.notEqual(contentHash([1, 2]), contentHash([2, 1])); });
  test('ordena por unidades UTF-16 como o RFC 8785 (exemplo oficial §3.2.3)', () => {
    const keys = ['€ Euro Sign', '\r Carriage Return', 'דּ Hebrew Letter Dalet With Dagesh', '1 One', '😀 Emoji: Grinning Face', '\u0080 Control', 'ö Latin Small Letter O With Diaeresis'];
    const obj = Object.fromEntries(keys.map((k, i) => [k, i]));
    const order = [...canonicalize(obj).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`));
    assert.deepEqual(order, ['\r Carriage Return', '1 One', '\u0080 Control', 'ö Latin Small Letter O With Diaeresis', '€ Euro Sign', '😀 Emoji: Grinning Face', 'דּ Hebrew Letter Dalet With Dagesh']);
  });
  test('undefined é omitido em objeto e vira null em array (como o JSON)', () => {
    assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
    assert.equal(canonicalize([undefined, 1]), '[null,1]');
    assert.equal(contentHash({ a: undefined, b: 1 }), contentHash({ b: 1 }));
  });
  test('-0 vira 0; números usam a forma do JS (igual ao JCS)', () => {
    assert.equal(canonicalize(-0), '0'); assert.equal(canonicalize([1e21, 1e-7, 0.1, 100]), '[1e+21,1e-7,0.1,100]');
  });
  test('strings: aspas, barra, controles e surrogate solto saem escapados e determinísticos', () => {
    assert.equal(canonicalize('a"b\\c\n\t\u0001'), '"a\\"b\\\\c\\n\\t\\u0001"');
    assert.equal(canonicalize('\ud800'), '"\\ud800"');
    assert.equal(canonicalize('😀'), '"😀"');
  });
  test('o hash é do texto UTF-8: acento em chave e valor', () => {
    assert.equal(contentHash({ 'ação': 'coração' }), sha256Hex('{"ação":"coração"}'));
  });
  test('toJSON é respeitado como no JSON (Date vira string ISO)', () => {
    assert.equal(canonicalize({ d: new Date(Date.UTC(2026, 9, 6)) }), '{"d":"2026-10-06T00:00:00.000Z"}');
  });
  test('chave __proto__ vinda de JSON.parse é dado comum (entra no hash, não polui)', () => {
    const o = JSON.parse('{"__proto__":{"x":1},"a":1}');
    assert.equal(canonicalize(o), '{"__proto__":{"x":1},"a":1}');
    assert.equal({}.x, undefined);
  });
});

describe('canonicalize — valores que o JSON não representa são RECUSADOS', () => {
  for (const [nome, v] of [['NaN', { a: NaN }], ['Infinity', [Infinity]], ['-Infinity', { a: { b: -Infinity } }], ['BigInt', { a: 1n }], ['função', { f() {} }], ['símbolo', { s: Symbol('x') }], ['função em array', [() => 1]], ['Map', { m: new Map() }], ['Set', new Set()], ['Uint8Array', { b: new Uint8Array(2) }], ['undefined no topo', undefined]]) {
    test(nome, () => assert.throws(() => canonicalize(v), TypeError));
  }
  test('ciclo direto e indireto', () => {
    const a = { x: 1 }; a.self = a; assert.throws(() => canonicalize(a), /circular/);
    const b = { c: { d: [] } }; b.c.d.push(b); assert.throws(() => canonicalize(b), /circular/);
  });
  test('referência COMPARTILHADA (sem ciclo) é permitida', () => {
    const s = { k: 1 }; assert.equal(canonicalize({ a: s, b: s, c: [s, s] }), '{"a":{"k":1},"b":{"k":1},"c":[{"k":1},{"k":1}]}');
  });
  test('aninhamento absurdo falha de forma controlada (sem estourar a pilha)', () => {
    let v = []; for (let i = 0; i < 5000; i++) v = [v];
    assert.throws(() => canonicalize(v), /profundidade/);
  });
  test('contentHash propaga o erro (nunca devolve hash de dado perdido)', () => { assert.throws(() => contentHash({ a: NaN }), TypeError); });
});

describe('canonicalize — decks REAIS do editor (tests/fixtures/real-decks.json)', () => {
  const REAL = JSON.parse(readFileSync(new URL('../fixtures/real-decks.json', import.meta.url), 'utf8'));
  /** Reordena as chaves de TODOS os objetos de forma pseudoaleatória determinística (simula outro cliente/versão serializando). */
  const shuffle = (v, seed = { n: 1 }) => {
    if (Array.isArray(v)) return v.map((x) => shuffle(x, seed));
    if (v && typeof v === 'object') { const ks = Object.keys(v).sort((a, b) => ((sha256Hex(a + seed.n).charCodeAt(0)) - sha256Hex(b + seed.n).charCodeAt(0)) || (a < b ? 1 : -1)); seed.n++; return Object.fromEntries(ks.map((k) => [k, shuffle(v[k], seed)])); }
    return v;
  };
  const decks = [...REAL.templates, REAL.kitchenSink];
  test('hash não depende da ordem das chaves, nem de espaços do JSON de origem', () => {
    for (const d of decks) {
      const sh = shuffle(d); assert.notEqual(JSON.stringify(sh), JSON.stringify(d), 'o embaralhamento precisa mudar algo');
      assert.equal(contentHash(sh), contentHash(d)); assert.equal(contentHash(JSON.parse(JSON.stringify(d, null, 2))), contentHash(d));
    }
  });
  test('canonicalize é idempotente e preserva o conteúdo (round-trip)', () => {
    for (const d of decks) { const c = canonicalize(d); assert.equal(canonicalize(JSON.parse(c)), c); assert.deepEqual(JSON.parse(c), d); }
  });
  test('qualquer mudança real no deck muda o hash', () => {
    const d = structuredClone(REAL.kitchenSink); const h = contentHash(d); d.slides[3].bg = d.slides[3].bg === '#000000' ? '#000001' : '#000000'; assert.notEqual(contentHash(d), h);
    const e = structuredClone(REAL.kitchenSink); e.slides.reverse(); assert.notEqual(contentHash(e), h);
  });
  test('é rápido: 6 projetos + kitchen sink (≈ 0,8 MB de JSON) em < 300 ms', () => {
    const t0 = performance.now(); for (const d of decks) contentHash(d); assert.ok(performance.now() - t0 < 300, `${(performance.now() - t0).toFixed(0)} ms`);
  });
});
