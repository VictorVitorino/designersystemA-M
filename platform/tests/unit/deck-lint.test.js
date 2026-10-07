import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lintDeck, LIMITS } from '../../src/lib/deck-lint.js';
import { HttpError } from '../../src/lib/errors.js';
import { sampleDeck, refOf } from '../fixtures/deck.js';
import { ATTACKS, LEGIT } from '../fixtures/xss-corpus.js';
import { sha256Hex } from '../../src/lib/canonical.js';
import { readFileSync } from 'node:fs';

// Decks gerados pelo EDITOR REAL (tests/fixtures/extract-real-decks.mjs): 6 projetos prontos + 137 slides cobrindo os 49 componentes e os 18 layouts.
const REAL = JSON.parse(readFileSync(new URL('../fixtures/real-decks.json', import.meta.url), 'utf8'));
const refsIn = (d) => new Set(JSON.stringify(d).match(/asset:sha256:[0-9a-f]{64}/g)?.map((r) => r.slice(13)) || []);

const deckWith = (html, extra = {}) => ({ v: 1, title: 'T', slides: [{ id: 's1', els: [{ id: 'e1', type: 'text', html }] }], ...extra });
/** Executa e devolve o HttpError (ou falha o teste se não lançou). */
const rejected = (content, opts) => { try { lintDeck(content, opts); } catch (e) { assert.ok(e instanceof HttpError, 'esperava HttpError, veio ' + e); return e; } assert.fail('deveria ter sido recusado'); };
const assertRejected = (content, reason, opts) => {
  const e = rejected(content, opts);
  assert.equal(e.status, 422); assert.equal(e.code, 'rejected_content');
  assert.ok(Array.isArray(e.details?.reasons) && e.details.reasons.length > 0, 'details.reasons[]');
  if (reason) assert.ok(e.details.reasons.includes(reason), `esperava ${reason}, veio ${e.details.reasons}`);
  return e;
};

describe('deck-lint — o que é devolvido para um deck legítimo', () => {
  test('metadados: bytes, slideCount, título, assetRefs', () => {
    const imgs = [refOf(1), refOf(2)];
    const d = sampleDeck({ slides: 3, images: imgs });
    const r = lintDeck(d);
    assert.equal(r.slideCount, 3); assert.equal(r.title, 'Plano 2026 — Alvarez & Marsal');
    assert.equal(r.bytes, Buffer.byteLength(JSON.stringify(d)));
    assert.ok(r.assetRefs instanceof Set); assert.deepEqual([...r.assetRefs].sort(), imgs.map((x) => x.slice('asset:sha256:'.length)).sort());
    for (const h of r.assetRefs) assert.match(h, /^[0-9a-f]{64}$/);
  });
  test('deck sem slides (array vazio) é válido: slideCount 0', () => { assert.equal(lintDeck({ slides: [] }).slideCount, 0); });
  test('título: aparado, espaços colapsados, controles e bidi removidos, ≤ 200, padrão "Sem título"', () => {
    assert.equal(lintDeck({ title: '  Plano\t  2026\n', slides: [] }).title, 'Plano 2026');
    assert.equal(lintDeck({ slides: [] }).title, 'Sem título');
    assert.equal(lintDeck({ title: '   ', slides: [] }).title, 'Sem título');
    assert.equal(lintDeck({ title: 42, slides: [] }).title, 'Sem título');
    assert.equal(lintDeck({ title: 'a‮b', slides: [] }).title, 'ab');
    assert.equal(lintDeck({ title: 'x'.repeat(300), slides: [] }).title.length, 200);
    const emoji = '😀'.repeat(250); assert.equal(Array.from(lintDeck({ title: emoji, slides: [] }).title).length, 200); // não corta no meio de um par substituto
  });
  test('lintDeck não altera o conteúdo recebido', () => {
    const d = sampleDeck(); const before = JSON.stringify(d); lintDeck(d); assert.equal(JSON.stringify(d), before);
  });
});

describe('deck-lint — estrutura e limites', () => {
  test('raiz inválida: null, array, string, sem slides, slides que não é array, objeto de classe', () => {
    for (const bad of [null, undefined, [], 'x', 1, {}, { slides: {} }, { slides: 'x' }, new (class X { constructor() { this.slides = []; } })()]) assertRejected(bad, 'estrutura_invalida');
  });
  test('slide que não é objeto', () => { assertRejected({ slides: [1] }, 'estrutura_invalida'); assertRejected({ slides: [null] }, 'estrutura_invalida'); assertRejected({ slides: [[]] }, 'estrutura_invalida'); });
  test('≤ 500 slides: 500 passa, 501 não', () => {
    assert.equal(lintDeck({ slides: Array.from({ length: 500 }, (_, i) => ({ id: 's' + i, els: [] })) }).slideCount, 500);
    assertRejected({ slides: Array.from({ length: 501 }, (_, i) => ({ id: 's' + i, els: [] })) }, 'slides_demais');
  });
  test('tamanho: padrão 12 MB; maxBytes configurável; bytes contados em UTF-8', () => {
    assert.equal(LIMITS.maxBytes, 12 * 1024 * 1024);
    const chunk = 'a'.repeat(1024 * 1024);
    const big = { slides: [], blobs: Array.from({ length: 13 }, () => chunk) }; // 13 MB, nenhuma string > 2 MB
    assertRejected(big, 'tamanho_excedido');
    assert.equal(lintDeck({ slides: [], blobs: Array.from({ length: 11 }, () => chunk) }).slideCount, 0);
    assertRejected({ slides: [], t: 'a'.repeat(200) }, 'tamanho_excedido', { maxBytes: 100 });
    const utf8 = { slides: [], t: 'ã'.repeat(100) }; // 100 chars = 200 bytes
    assertRejected(utf8, 'tamanho_excedido', { maxBytes: 150 });
    assert.equal(lintDeck(utf8, { maxBytes: 300 }).bytes, Buffer.byteLength(JSON.stringify(utf8)));
  });
  test('string ≤ 2 MB: 2 MiB passa; 2 MiB + 1 não; também para chaves e para texto multibyte', () => {
    assert.equal(lintDeck({ slides: [], t: 'a'.repeat(2 * 1024 * 1024) }).slideCount, 0);
    assertRejected({ slides: [], t: 'a'.repeat(2 * 1024 * 1024 + 1) }, 'string_grande_demais');
    assertRejected({ slides: [], t: 'ã'.repeat(1.2 * 1024 * 1024) }, 'string_grande_demais'); // 2.4 MiB em UTF-8 apesar de < 2 M caracteres
    assertRejected({ slides: [], ['k'.repeat(2 * 1024 * 1024 + 1)]: 1 }, 'string_grande_demais');
  });
  test('profundidade ≤ 40: aninhar 40 contêineres passa, 41 não (iterativo: 100 mil níveis não estouram a pilha)', () => {
    const nest = (n) => { let v = 'x'; for (let i = 0; i < n; i++) v = [v]; return { slides: [], deep: v }; };
    assert.equal(lintDeck(nest(39)).slideCount, 0);
    assert.equal(lintDeck(nest(40)).slideCount, 0);
    assertRejected(nest(41), 'profundidade_excedida');
    assertRejected(nest(400), 'profundidade_excedida');
    // 100 mil níveis: JSON.stringify do próprio Node pode estourar; o lint tem de recusar (não travar nem lançar RangeError)
    let v = []; for (let i = 0; i < 100_000; i++) v = [v];
    assertRejected({ slides: [], deep: v });
  });
  test('ciclo, BigInt, NaN, Infinity, função, Date, Map', () => {
    const c = { slides: [] }; c.self = c; assertRejected(c, 'estrutura_invalida');
    assertRejected({ slides: [], n: 1n }, 'estrutura_invalida');
    assertRejected({ slides: [], n: NaN }, 'numero_invalido'); assertRejected({ slides: [], n: [Infinity] }, 'numero_invalido');
    assertRejected({ slides: [], f: () => 1 }, 'estrutura_invalida');
    assertRejected({ slides: [], d: new Date() }, 'estrutura_invalida'); assertRejected({ slides: [], m: new Map() }, 'estrutura_invalida');
  });
  test('chave __proto__ (poluição de protótipo) é recusada, inclusive aninhada', () => {
    assertRejected(JSON.parse('{"slides":[],"__proto__":{"admin":true}}'), 'chave_proibida');
    assertRejected(JSON.parse('{"slides":[{"els":[{"data":{"__proto__":{"x":1}}}]}]}'), 'chave_proibida');
    assert.equal({}.admin, undefined);
  });
  test('"constructor" e "prototype" como dado comum NÃO são recusados', () => { assert.equal(lintDeck({ slides: [], constructor_note: 'ok', data: { prototype: 'v1' } }).slideCount, 0); });
});

describe('deck-lint — imagens: asset: válido, malformado e data: não externalizado', () => {
  const H = 'abcdef0123456789'.repeat(4);
  test('referências válidas em campo, dentro de HTML/CSS, repetidas e em chaves são coletadas (sem duplicar)', () => {
    const r = lintDeck({ slides: [{ els: [{ type: 'image', src: `asset:sha256:${H}` }, { type: 'text', html: `<span style="background:url(asset:sha256:${H})">x</span> e asset:sha256:${sha256Hex('2')}` }] }], [`asset:sha256:${sha256Hex('3')}`]: 1 });
    assert.deepEqual([...r.assetRefs].sort(), [H, sha256Hex('2'), sha256Hex('3')].sort());
  });
  const MALFORMED = [
    ['hex maiúsculo', 'asset:sha256:' + H.toUpperCase()], ['63 hex', 'asset:sha256:' + H.slice(1)], ['65 hex', 'asset:sha256:' + H + 'a'],
    ['64 hex + letra', 'asset:sha256:' + H + 'z'], ['64 hex + sublinhado', 'asset:sha256:' + H + '_x'], ['caracter não-hex', 'asset:sha256:' + 'g'.repeat(64)],
    ['algoritmo errado', 'asset:sha1:' + H], ['sem algoritmo', 'asset:' + H], ['traversal', 'asset:../../etc/passwd'], ['traversal com sha', `asset:sha256:../${H}`],
    ['esquema em maiúsculas', 'ASSET:sha256:' + H], ['caminho', 'asset:/a/b/c'], ['url-encoded', 'asset:sha256:%61%62'], ['vazio após os dois-pontos colado', 'asset:#x'],
    ['dentro de HTML', `<img src="asset:sha256:${H.slice(2)}">`], ['dentro de url()', `<div style="background:url(asset:foo)">x</div>`],
  ];
  for (const [nome, v] of MALFORMED) test('malformada: ' + nome, () => { assertRejected({ slides: [{ els: [{ type: 'image', src: v }] }] }, 'referencia_asset_invalida'); });
  test('"asset:" em prosa, com espaço depois, não é referência', () => { lintDeck(deckWith('Asset: Real Estate e asset: ativos fixos')); });
  test('data:image até 64 KB passa; acima disso é "imagem_nao_externalizada" (src, HTML e CSS)', () => {
    const b64 = (n) => 'A'.repeat(n);
    assert.equal(lintDeck({ slides: [{ els: [{ type: 'image', src: 'data:image/png;base64,' + b64(60_000) }] }] }).slideCount, 1);
    const big = 'data:image/png;base64,' + b64(70_000);
    assertRejected({ slides: [{ els: [{ type: 'image', src: big }] }] }, 'imagem_nao_externalizada');
    assertRejected(deckWith(`<span style="background:url(${big})">x</span>`), 'imagem_nao_externalizada');
    assertRejected(deckWith(`texto ${big} texto`), 'imagem_nao_externalizada');
    for (const t of ['jpeg', 'jpg', 'webp', 'gif']) assertRejected({ slides: [{ els: [{ type: 'image', src: `data:image/${t};base64,` + b64(70_000) }] }] }, 'imagem_nao_externalizada');
  });
  test('base64 "picado" com espaços/quebras de linha para burlar o limite também é pego', () => {
    const chunks = Array.from({ length: 70 }, () => 'A'.repeat(1000)).join('\n ');
    assertRejected({ slides: [{ els: [{ type: 'image', src: 'data:image/png;base64,' + chunks }] }] }, 'imagem_nao_externalizada');
  });
  test('data:image/svg+xml é recusado mesmo pequeno', () => { assertRejected({ slides: [{ els: [{ type: 'image', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }] }] }, 'svg_embutido'); });
  test('https:, blob: e relativos continuam permitidos (o editor aceita)', () => { lintDeck({ slides: [{ els: [{ type: 'image', src: 'https://exemplo.com/a.png' }, { type: 'image', src: 'blob:https://x/abc' }, { type: 'image', src: '/img/a.png' }] }] }); });
});

describe('deck-lint — chaves de URL', () => {
  for (const key of ['href', 'src', 'url', 'link', 'action', 'formaction', 'xlink:href', 'poster', 'bgImg', 'srcset', 'sheet']) {
    test(`${key}: javascript:/vbscript:/data:text/html recusados; https/mailto/tel/#/relativo/asset OK`, () => {
      for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'data:text/html,<b>', 'file:///etc/passwd']) assertRejected({ slides: [{ els: [{ [key]: bad }] }] });
      for (const ok of ['https://a.com/x?y=1', 'http://a.com', 'mailto:a@b.com', 'tel:+5511999999999', '#slide-3', '/relativo/x', 'asset:sha256:' + H64, 'x.png']) lintDeck({ slides: [{ els: [{ [key]: ok }] }] });
    });
  }
  test('arrays sob chave de URL e qualquer valor que COMECE com javascript:+código', () => {
    assertRejected({ slides: [{ els: [{ links: ['https://a.com', 'javascript:alert(1)'] }] }] }, 'url_perigosa');
    assertRejected({ slides: [{ els: [{ qualquer: 'javascript:alert(1)' }] }] }, 'url_perigosa');
  });
  test('style/css como chave: expression() e @import recusados', () => {
    assertRejected({ slides: [{ els: [{ style: 'width:expression(alert(1))' }] }] }, 'estilo_perigoso');
    assertRejected({ slides: [{ els: [{ css: '@import url(//x/y.css)' }] }] }, 'estilo_perigoso');
    lintDeck({ slides: [{ els: [{ style: 'bold', css: 'color:#fff;font-weight:700' }] }] });
  });
});
const H64 = 'f'.repeat(64);

describe('deck-lint — corpus de ataques (todos DEVEM ser recusados, em qualquer campo)', () => {
  test('o corpus tem ≥ 40 payloads', () => assert.ok(ATTACKS.length >= 40, `só ${ATTACKS.length}`));
  for (const { name, value } of ATTACKS) {
    test(`ataque: ${name}`, () => {
      assertRejected(deckWith(value));                                                            // html de um texto
      assertRejected({ slides: [{ els: [], notes: value }] });                                      // notas do slide
      assertRejected({ slides: [{ els: [{ type: 'fx', kind: 'smart', data: { items: [{ t: value, lv: 0 }] } }] }] }); // dentro de um componente
      assertRejected({ slides: [], comments: [{ text: value }] });                                  // comentários do deck
      assertRejected({ slides: [], [value]: 'x' });                                                 // como NOME de propriedade
    });
  }
  test('o mesmo payload vindo de JSON.parse com escapes \\uXXXX do JSON (formato real de transporte)', () => {
    const wire = '{"slides":[{"els":[{"html":"\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"}]}]}';
    assertRejected(JSON.parse(wire), 'tag_perigosa');
    assertRejected(JSON.parse('{"slides":[{"els":[{"html":"\\u003cimg src=x onerror=alert(1)\\u003e"}]}]}'), 'atributo_evento');
  });
  test('razões específicas para as famílias principais', () => {
    assertRejected(deckWith('<script>1</script>'), 'tag_perigosa');
    assertRejected(deckWith('<img src=x onerror=alert(1)>'), 'atributo_evento');
    assertRejected(deckWith('<a href="javascript:alert(1)">x</a>'), 'url_perigosa');
    assertRejected(deckWith('data:text/html;base64,PHNjcmlwdD4='), 'data_html');
    assertRejected(deckWith('data:image/svg+xml;base64,PHN2Zz4='), 'svg_embutido');
    assertRejected(deckWith('<div style="width:expression(1)">x</div>'), 'estilo_perigoso');
    assertRejected(deckWith('<iframe srcdoc="x"></iframe>'), 'atributo_perigoso');
  });
  test('o erro nunca devolve o conteúdo do ataque; mostra só razões e caminhos (sanitizados)', () => {
    const e = assertRejected({ slides: [{ els: [{ html: '<script>SEGREDO_NO_PAYLOAD</script>', ['<x onload=1>']: 1 }] }] });
    const wire = JSON.stringify({ message: e.message, details: e.details });
    assert.ok(!wire.includes('SEGREDO_NO_PAYLOAD')); assert.ok(!wire.includes('<'));
    assert.ok(e.details.findings.every((f) => /^[\w$.\[\]()-]+$/.test(f.path)), JSON.stringify(e.details.findings));
    assert.ok(e.details.findings.some((f) => f.path === 'slides[0].els[0].html'));
    assert.ok(e.details.findings.some((f) => f.path === 'slides[0].els[0]._x_onload_1_(chave)'), 'a chave hostil aparece só sanitizada');
  });
  test('várias famílias no mesmo deck: todas as razões são listadas (sem duplicar) e limitadas', () => {
    const e = assertRejected({ slides: [{ els: [{ html: '<script>1</script>' }, { html: '<img onerror=1>' }, { src: 'javascript:alert(1)' }] }] });
    assert.deepEqual([...new Set(e.details.reasons)].sort(), [...e.details.reasons].sort());
    assert.ok(['tag_perigosa', 'atributo_evento', 'url_perigosa'].every((r) => e.details.reasons.includes(r)));
    const many = rejected({ slides: Array.from({ length: 300 }, () => ({ els: [{ html: '<script>1</script>' }] })) });
    assert.ok(many.details.findings.length <= 10);
  });
});

describe('deck-lint — conteúdo legítimo NÃO pode ser recusado', () => {
  test('o corpus tem ≥ 20 casos', () => assert.ok(LEGIT.length >= 20, `só ${LEGIT.length}`));
  LEGIT.forEach((value, i) => {
    test(`legítimo #${i + 1}: ${value.slice(0, 60).replace(/\n/g, ' ')}`, () => {
      lintDeck(deckWith(value));
      lintDeck({ slides: [{ els: [], notes: value, title: 'Título' }], title: value.length < 300 ? value : 'Título' });
      lintDeck({ slides: [{ els: [{ type: 'fx', kind: 'smart', data: { items: [{ t: value, lv: 0 }] } }] }] });
      lintDeck({ slides: [], comments: [{ text: value }] });
    });
  });
  test('deck inteiro no formato do editor (50 slides) passa e é rápido', () => {
    const t0 = performance.now(); const r = lintDeck(sampleDeck({ slides: 50 })); const ms = performance.now() - t0;
    assert.equal(r.slideCount, 50); assert.ok(ms < 1000, `demorou ${ms.toFixed(0)} ms`);
  });
  test('"onclick" e "script" em prosa, em notas e em título de slide', () => {
    lintDeck({ title: 'Como o script usa onclick', slides: [{ notes: 'Mencionar onclick, onload, script, <3 e a<b', els: [{ type: 'text', html: 'Eventos: onclick, onerror, onload (apenas texto)' }] }] });
  });
});

describe('deck-lint — desempenho e resistência a entrada patológica (sem ReDoS)', () => {
  const bad = (name, s) => test(name, () => {
    const t0 = performance.now();
    try { lintDeck({ slides: [], x: s }); } catch (e) { assert.ok(e instanceof HttpError); }
    const ms = performance.now() - t0; assert.ok(ms < 2500, `${name}: ${ms.toFixed(0)} ms`);
  });
  const N = 1_000_000;
  bad('aspas seguidas de 1 MB de espaços', '"' + ' '.repeat(N) + 'x');
  bad('1 MB de "<" e de "<<<script"', '<'.repeat(N));
  bad('"<" + 1 MB de espaços + "script"', '<' + ' '.repeat(N) + 'script');
  bad('<a href= + 1 MB de espaços', '<a href=' + ' '.repeat(N));
  bad('url( + 1 MB de espaços', 'url(' + ' '.repeat(N) + 'javascript');
  bad('1 MB de "&#" e "&amp;"', '&#'.repeat(N / 2));
  bad('1 MB de "%" e "%3C"', '%3C'.repeat(N / 3));
  bad('1 MB de "\\u003c"', '\\u003c'.repeat(N / 6));
  bad('1 MB de aspas', '"'.repeat(N));
  bad('aspas a cada 150 chars', ('"' + 'a'.repeat(150)).repeat(Math.floor(N / 151)) + '=');
  bad('1 MB de "on" + "="', 'on='.repeat(N / 3));
  bad('1 MB de "asset:"', 'asset:'.repeat(N / 6));
  bad('1 MB de "data:image/png;base64," repetido', 'data:image/png;base64,'.repeat(N / 22));
  bad('atributo sem fechar aspas', '<a title="' + 'x'.repeat(N));
  bad('1 MB de "<a " (muitas tags)', '<a '.repeat(N / 3));
  test('deck de ~11 MB de texto comum é varrido em tempo razoável', () => {
    const para = 'Receita cresce 12% ao ano; margem → 35%. '.repeat(25_000); // ~1 MB
    const d = { slides: [], blobs: Array.from({ length: 10 }, () => para) };
    const t0 = performance.now(); lintDeck(d); const ms = performance.now() - t0; assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
  });
});

describe('deck-lint — decks REAIS do editor (preservação: nada do que o editor produz pode ser recusado)', () => {
  test('a fixture veio mesmo do editor (6 projetos, 137 slides de componentes/layouts)', () => {
    assert.equal(REAL.templates.length, 6); assert.equal(REAL.kitchenSink.slides.length, 137); assert.equal(REAL.names[5], 'Apresentação institucional A&M');
  });
  REAL.names.forEach((nome, i) => test(`projeto pronto "${nome}" passa e as referências batem`, () => {
    const d = REAL.templates[i]; const r = lintDeck(d);
    assert.equal(r.slideCount, d.slides.length); assert.equal(r.title, d.title.trim()); assert.deepEqual([...r.assetRefs].sort(), [...refsIn(d)].sort());
    assert.ok(r.bytes < LIMITS.maxBytes);
  }));
  test('kitchen sink: 49 componentes (com variantes) e 18 layouts, 137 slides', () => {
    const t0 = performance.now(); const r = lintDeck(REAL.kitchenSink); const ms = performance.now() - t0;
    assert.equal(r.slideCount, 137); assert.deepEqual([...r.assetRefs].sort(), [...refsIn(REAL.kitchenSink)].sort()); assert.ok(ms < 1000, ms.toFixed(0) + ' ms');
  });
  test('o projeto institucional SEM externalizar as imagens (> 64 KB) é recusado com imagem_nao_externalizada', () => {
    const d = structuredClone(REAL.templates[5]); const j = JSON.stringify(d).replace(/asset:sha256:[0-9a-f]{64}/, 'data:image/jpeg;base64,' + 'A'.repeat(90_000));
    assertRejected(JSON.parse(j), 'imagem_nao_externalizada');
  });
  test('todo ataque do corpus injetado num texto, nas notas e num componente de um deck REAL é recusado e localizado', () => {
    const base = REAL.templates[0]; const where = (d) => { for (let si = 0; si < d.slides.length; si++) for (let ei = 0; ei < d.slides[si].els.length; ei++) if (d.slides[si].els[ei].type === 'text') return [si, ei]; };
    const [si, ei] = where(base);
    for (const { name, value } of ATTACKS) {
      const d = structuredClone(base); d.slides[si].els[ei].html = value;
      const e = assertRejected(d); assert.ok(e.details.findings.some((f) => f.path === `slides[${si}].els[${ei}].html`), `${name}: caminho ${JSON.stringify(e.details.findings)}`);
      const n = structuredClone(base); n.slides[0].notes = value; assertRejected(n);
    }
  });
  test('ataque escondido bem fundo (≈ 35 níveis, dentro do limite de 40) no meio de um deck real também é achado', () => {
    const d = structuredClone(REAL.kitchenSink); let o = { x: '<script>alert(1)</script>' }; for (let i = 0; i < 14; i++) o = { n: [o] }; d.slides[100].els[0].data = { ...d.slides[100].els[0].data, deep: o };
    assertRejected(d, 'tag_perigosa');
  });
});

/* ── BE-ED-09: texto que a pessoa DIGITA citando tags (o editor guarda escapado, como o navegador serializa) × HTML ativo ── */
const typed = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');   // = innerHTML de um nó de texto

describe('deck-lint — BE-ED-09: citar tags em caixas de texto não trava o salvamento; HTML ativo continua recusado', () => {
  const CITATIONS = [
    'use a tag <b> para negrito',
    'if (a < b && c > d)',
    'use a tag <form> para formulários',
    'Coloque <link> e <meta> dentro do <head>; feche com </form>',
    'O elemento <iframe> incorpora outra página; <object> e <embed> são antigos',
    'tags <template>, <noscript>, <xmp>, <plaintext>, <frameset>, <frame>, <applet>, <isindex> e <base>',
    'Formulários: <form>…</form> (o envio vai para o próprio site)',
    'x<y && y>z; a <= b; c >= d; <-- seta -->',
    'Escreva &lt; para o sinal de menor e &amp; para o "e" comercial',
    'Use <img src="foto.png" alt="Foto"> e <a href="https://exemplo.com">link</a>',
    'Use <x:form> só em XML',
  ];
  for (const text of CITATIONS) {
    test(`passa (como o editor guarda): ${text.slice(0, 60)}`, () => {
      lintDeck(deckWith(typed(text)));                                                             // html de uma caixa de texto
      const d = structuredClone(REAL.templates[0]); const el = d.slides[0].els.find((e) => e.type === 'text'); el.html = typed(text); lintDeck(d);   // num deck real
    });
  }
  test('as mesmas tags LITERAIS (forma crua = HTML de verdade) continuam recusadas', () => {
    for (const raw of ['use a tag <form> para formulários', 'Coloque <link> no head', 'O elemento <iframe> incorpora', '<template>x</template>', 'feche com </form>', '<base>', '<x:form>']) assertRejected(deckWith(raw), 'tag_perigosa');
  });
  test('citações escapadas que são HTML ATIVO (ou viram, se alguém decodificar duas vezes) continuam recusadas', () => {
    const ACTIVE = [
      ['a tag <script> carrega JavaScript', 'tag_perigosa'], ['</script>', 'tag_perigosa'], ['a tag <style> define estilos', 'tag_perigosa'], ['vetores com <svg>', 'tag_perigosa'], ['fórmulas com <math>', 'tag_perigosa'],
      ['<x:script>', 'tag_perigosa'], ['<iframe src="https://evil.example/">', 'tag_perigosa'], ['<link rel="stylesheet" href="https://evil.example/x.css">', 'tag_perigosa'],
      ['<meta http-equiv="refresh" content="0;url=https://evil.example/">', 'tag_perigosa'], ['<base href="https://evil.example/">', 'tag_perigosa'], ['<object data="https://evil.example/x">', 'tag_perigosa'],
      ['<form action="https://evil.example/">', 'tag_perigosa'], ['<form method=post>', 'tag_perigosa'], ['<form', 'tag_perigosa'],
      ['<form><button formaction="https://evil.example/">Entrar</button></form>', 'atributo_perigoso'], ['<input form="login" name="senha">', 'atributo_perigoso'], ['<isindex action="https://evil.example/">', 'tag_perigosa'],
      ['<img src=x onerror=alert(1)>', 'atributo_evento'], ['<a href="javascript:alert(1)">x</a>', 'url_perigosa'], ['<iframe srcdoc="x">', 'atributo_perigoso'],
    ];
    for (const [text, reason] of ACTIVE) assertRejected(deckWith(typed(text)), reason);
    // codificação dupla e por percentual também
    assertRejected(deckWith('&amp;lt;iframe src=//evil.example&amp;gt;'), 'tag_perigosa');
    assertRejected(deckWith('%3Cform action=//evil.example%3E'), 'tag_perigosa');
    assertRejected(deckWith('&#60;form&#62;&#60;button formaction=//evil.example&#62;'), 'atributo_perigoso');
  });
  test('1 MB de citações escapadas (&lt;form&gt;, &lt;link&gt;&lt;/link&gt;) e "&lt;form" + 1 MB de espaços: tempo linear', () => {
    for (const s of ['&lt;form&gt;'.repeat(100_000), '&lt;link&gt;&lt;/link&gt;'.repeat(50_000), '&lt;form' + ' '.repeat(1_000_000)]) {
      const t0 = performance.now(); try { lintDeck(deckWith(s)); } catch (e) { assert.ok(e instanceof HttpError); } const ms = performance.now() - t0; assert.ok(ms < 2500, `${ms.toFixed(0)} ms`);
    }
  });
  test('o corpus de ataques continua TODO recusado (inclusive as formas codificadas de <script>)', () => {
    for (const { name, value } of ATTACKS) { const e = rejected(deckWith(value)); assert.equal(e.status, 422, name); }
    for (const { name, value } of ATTACKS.filter((a) => /&lt;|&#|%3C|%25|\\u|\\x|%u/i.test(a.value))) assertRejected({ slides: [{ els: [], notes: value }] }, null, undefined, name);
  });
});

describe('deck-lint — details.issues: onde está o problema (slide 1-based e id do elemento), sem ecoar o conteúdo', () => {
  test('aponta slide e elemento; o texto recusado nunca volta (nem no caminho)', () => {
    const d = { title: 'T', slides: [{ id: 's1', els: [{ id: 'e1', type: 'text', html: 'ok' }] }, { id: 's2', els: [{ id: 'eA', type: 'text', html: 'ok' }, { id: 'eB', type: 'text', html: '<script>SEGREDO</script>' }] }] };
    const e = assertRejected(d, 'tag_perigosa');
    assert.deepEqual(e.details.issues, [{ slide: 2, elementId: 'eB', reason: 'tag_perigosa' }]);
    const wire = JSON.stringify(e.details); assert.ok(!wire.includes('SEGREDO') && !wire.includes('<'), wire);
  });
  test('uma entrada por (slide, elemento, razão) — as formas crua e decodificadas não duplicam; várias razões e elementos aparecem', () => {
    const d = { slides: [{ els: [{ id: 'a1', html: '<script>1</script>&lt;script&gt;' }, { id: 'a2', html: '<img src=x onerror=1>' }, { id: 'a3', src: 'javascript:alert(1)' }] }] };
    const e = assertRejected(d);
    assert.deepEqual(e.details.issues, [{ slide: 1, elementId: 'a1', reason: 'tag_perigosa' }, { slide: 1, elementId: 'a2', reason: 'atributo_evento' }, { slide: 1, elementId: 'a3', reason: 'url_perigosa' }]);
  });
  test('problema fora de elemento: notas do slide → só o slide; título/campos do deck → slide nulo', () => {
    assert.deepEqual(assertRejected({ slides: [{ els: [] }, { els: [], notes: '<script>1</script>' }] }).details.issues, [{ slide: 2, elementId: null, reason: 'tag_perigosa' }]);
    assert.deepEqual(assertRejected({ title: '<script>1</script>', slides: [] }).details.issues, [{ slide: null, elementId: null, reason: 'tag_perigosa' }]);
    assert.deepEqual(assertRejected({ slides: [], comments: [{ text: 'javascript:alert(1)' }] }).details.issues, [{ slide: null, elementId: null, reason: 'url_perigosa' }]);
  });
  test('dentro de um componente (dados aninhados) e em NOME de propriedade: o elemento é o dono do campo', () => {
    const comp = { slides: [{ els: [{ id: 'fx9', type: 'fx', kind: 'smart', data: { items: [{ t: 'ok' }, { t: '<svg onload=1>' }] } }] }] };
    const ci = assertRejected(comp).details.issues;
    assert.deepEqual([...new Set(ci.map((i) => `${i.slide}|${i.elementId}`))], ['1|fx9']); assert.deepEqual(ci.map((i) => i.reason).sort(), ['atributo_evento', 'tag_perigosa']);
    const key = { slides: [{ els: [{ id: 'k1', data: { ['<script>']: 1 } }] }] };
    assert.deepEqual(assertRejected(key).details.issues, [{ slide: 1, elementId: 'k1', reason: 'tag_perigosa' }]);
  });
  test('id do elemento que não é identificador simples (ou que é o próprio ataque) vira null', () => {
    for (const id of ['<script>alert(1)</script>', 'a b', 'x'.repeat(65), 42, null, '']) {
      const e = assertRejected({ slides: [{ els: [{ id, html: '<script>1</script>' }] }] });
      assert.deepEqual(e.details.issues.map((i) => [i.slide, i.elementId]), [[1, null]], JSON.stringify(id));
      assert.ok(!JSON.stringify(e.details).includes('alert'), 'o id hostil não é ecoado');
    }
  });
  test('no máximo 20 issues (300 slides com problema) e findings continua ≤ 10 (compatibilidade)', () => {
    const e = rejected({ slides: Array.from({ length: 300 }, (_, i) => ({ els: [{ id: 'e' + i, html: '<script>1</script>' }] })) });
    assert.equal(e.details.issues.length, 20); assert.deepEqual(e.details.issues[0], { slide: 1, elementId: 'e0', reason: 'tag_perigosa' }); assert.deepEqual(e.details.issues[19], { slide: 20, elementId: 'e19', reason: 'tag_perigosa' });
    assert.ok(e.details.findings.length <= 10);
  });
  test('recusa sem lugar definido (estrutura/tamanho) traz issues com slide e elemento nulos; slide que não é objeto aponta o slide', () => {
    assert.deepEqual(rejected(null).details.issues, [{ slide: null, elementId: null, reason: 'estrutura_invalida' }]);
    assert.deepEqual(rejected({ slides: [], t: 'a'.repeat(200) }, { maxBytes: 100 }).details.issues, [{ slide: null, elementId: null, reason: 'tamanho_excedido' }]);
    assert.deepEqual(rejected({ slides: [{}, 5] }).details.issues, [{ slide: 2, elementId: null, reason: 'estrutura_invalida' }]);
  });
});
