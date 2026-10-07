/* Interações (formulários, quadro, votação, reações, visualizações): gravação por pessoa, upsert × acúmulo, teto por elemento, leitura filtrada pelo RLS,
   exportação CSV só para dono/admin com proteção contra CSV injection. Banco real. */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, deck } from '../helpers/mini-app.js';
import { csvCell, toCsv, cellText, interactionsCsv, csvFilename, BOM } from '../../src/lib/csv.js';

let env, OWNER, V1, V2, ADM, P;
before(async () => {
  env = await makeEnv();
  OWNER = await env.mkUser({ name: 'Dona' }); V1 = await env.mkUser({ name: 'Visitante Um' }); V2 = await env.mkUser({ name: '=cmd|"/c calc"!A1' }); ADM = await env.mkUser({ role: 'admin', name: 'Admin' });
  P = await env.create(OWNER, 'Com formulário', deck('Com formulário'));
});
after(async () => { await env.stop(); });
beforeEach(async () => { await env.resetRates(); });

const url = (id = P.id) => `/api/presentations/${id}/interactions`;
const post = (u, body, id) => env.post(u, url(id), { json: body });
const rows = (where = {}) => env.sys((tx) => tx`select * from app.interactions where presentation_id = ${where.p || P.id} ${where.u ? tx`and user_id = ${where.u}` : tx``} ${where.kind ? tx`and kind = ${where.kind}` : tx``} ${where.el ? tx`and element_id = ${where.el}` : tx``} order by id`);

describe('gravar', () => {
  test('form_response/view/reaction ACUMULAM (201 cada); user_id vem da sessão; dono e visitantes gravam as suas', async () => {
    for (const kind of ['form_response', 'reaction']) {
      for (let i = 0; i < 3; i++) { const r = await post(V1, { kind, elementId: 'f1', payload: { n: i } }); assert.equal(r.status, 201, r.text); assert.equal(r.json.kind, kind); assert.equal(r.json.elementId, 'f1'); assert.ok(r.json.id && r.json.createdAt); }
    }
    const v = await post(V1, { kind: 'view', payload: { slide: 3 } }); assert.equal(v.status, 201, 'view pode ficar sem elementId (visualização da apresentação)');
    assert.equal((await rows({ u: V1.id, kind: 'form_response', el: 'f1' })).length, 3); assert.equal((await rows({ u: V1.id, kind: 'reaction' })).length, 3);
    assert.equal((await post(OWNER, { kind: 'form_response', elementId: 'f1', payload: { a: ['dono'] } })).status, 201, 'o dono também responde');
  });
  test('board_state e vote_state são UPSERT por (usuário, elemento): 201 na 1ª, 200 depois, uma só linha; pessoas diferentes têm linhas diferentes', async () => {
    for (const kind of ['board_state', 'vote_state']) {
      const a = await post(V1, { kind, elementId: 'q1', payload: { v: 1 } }); assert.equal(a.status, 201);
      const b = await post(V1, { kind, elementId: 'q1', payload: { v: 2, extra: [1, 2] } }); assert.equal(b.status, 200); assert.equal(b.json.id, a.json.id);
      const mine = await rows({ u: V1.id, kind, el: 'q1' }); assert.equal(mine.length, 1); assert.deepEqual(mine[0].payload, { v: 2, extra: [1, 2] });
      assert.equal((await post(V2, { kind, elementId: 'q1', payload: { v: 9 } })).status, 201);
      assert.equal((await rows({ kind, el: 'q1' })).length, 2);
      assert.equal((await post(V1, { kind, elementId: 'q2', payload: {} })).status, 201, 'outro elemento = outra linha');
    }
  });
  test('o cliente não escolhe usuário nem data; campos desconhecidos → 400', async () => {
    for (const extra of [{ userId: OWNER.id }, { user_id: OWNER.id }, { createdAt: '2000-01-01' }, { presentationId: P.id }]) assert.equal((await post(V1, { kind: 'reaction', elementId: 'x', payload: {}, ...extra })).status, 400, JSON.stringify(extra));
  });
  test('validação: kind, elementId, payload (objeto ≤ 64 KB, sem NUL, profundidade ≤ 20)', async () => {
    const ok = { kind: 'form_response', elementId: 'el_1', payload: { a: 1 } };
    for (const bad of [{ ...ok, kind: 'comment' }, { ...ok, kind: 5 }, { ...ok, elementId: '' }, { ...ok, elementId: 'a'.repeat(81) }, { ...ok, elementId: 'a b' }, { ...ok, elementId: "x'; drop" }, { ...ok, elementId: '<b>' }, { ...ok, elementId: '../x' },
      { ...ok, payload: [] }, { ...ok, payload: 'x' }, { ...ok, payload: null }, { ...ok, payload: 5 }, { kind: 'form_response', elementId: 'x' }, { elementId: 'x', payload: {} }]) {
      const r = await post(V1, bad); assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 80));
    }
    assert.equal((await post(V1, { ...ok, payload: { s: 'a\u0000b' } })).status, 400); assert.equal((await post(V1, { ...ok, payload: { s: '\ud83d' } })).status, 400);
    let deep = {}; const root = deep; for (let i = 0; i < 25; i++) { deep.n = {}; deep = deep.n; }
    assert.equal((await post(V1, { ...ok, payload: root })).status, 400, 'aninhamento excessivo');
    const big = await post(V1, { ...ok, payload: { t: 'x'.repeat(66 * 1024) } }); assert.equal(big.status, 413); assert.equal(big.json.error.code, 'too_large');
    const edge = await post(V1, { ...ok, payload: { t: 'x'.repeat(60 * 1024) } }); assert.equal(edge.status, 201, 'perto do limite (60 KB) passa');
    const huge = await env.request(V1, 'POST', url(), { body: Buffer.alloc(200 * 1024, 0x20), headers: { 'content-type': 'application/json' } }); assert.equal(huge.status, 413);
    assert.equal((await env.request(V1, 'POST', url(), { body: '{x', headers: { 'content-type': 'application/json' } })).status, 400);
  });
  test('teto de 500 por pessoa/elemento (409) — por elemento, por tipo e por pessoa; estados não têm teto', async () => {
    await env.sys((tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload) select ${P.id}::uuid, ${V1.id}::uuid, 'form_response', 'cheio', '{}'::jsonb from generate_series(1, 500)`);
    const over = await post(V1, { kind: 'form_response', elementId: 'cheio', payload: {} }); assert.equal(over.status, 409); assert.equal((await rows({ u: V1.id, el: 'cheio' })).length, 500);
    assert.equal((await post(V1, { kind: 'form_response', elementId: 'outro-el', payload: {} })).status, 201, 'outro elemento');
    assert.equal((await post(V1, { kind: 'reaction', elementId: 'cheio', payload: {} })).status, 201, 'outro tipo');
    assert.equal((await post(V2, { kind: 'form_response', elementId: 'cheio', payload: {} })).status, 201, 'outra pessoa');
    assert.equal((await post(V1, { kind: 'board_state', elementId: 'cheio', payload: {} })).status, 201);
  });
  test('o teto vale mesmo com envios SIMULTÂNEOS (trava por chave): 495 existentes + 20 em paralelo = exatamente 5 aceitos', async () => {
    const W = await env.mkUser({ name: 'Paralelo' });
    await env.sys((tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload) select ${P.id}::uuid, ${W.id}::uuid, 'form_response', 'corrida', '{}'::jsonb from generate_series(1, 495)`);
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => env.post(W, url(), { json: { kind: 'form_response', elementId: 'corrida', payload: { i } }, ip: `198.51.100.${60 + i}` })));
    assert.equal(res.filter((r) => r.status === 201).length, 5, res.map((r) => r.status).join(',')); assert.equal(res.filter((r) => r.status === 409).length, 15);
    assert.equal((await rows({ u: W.id, el: 'corrida' })).length, 500);
  });
  test('upserts simultâneos da mesma pessoa/elemento resultam em UMA linha', async () => {
    const W = await env.mkUser({ name: 'Estado' });
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => env.post(W, url(), { json: { kind: 'board_state', elementId: 'quadro', payload: { v: i } }, ip: `198.51.100.${90 + i}` })));
    assert.ok(res.every((r) => r.status === 200 || r.status === 201), res.map((r) => r.status).join(',')); assert.equal(res.filter((r) => r.status === 201).length, 1);
    assert.equal((await rows({ u: W.id, kind: 'board_state', el: 'quadro' })).length, 1);
  });
  test('apresentação na lixeira alheia, inexistente, sem login: 404/401; suspenso 403 — nada é gravado', async () => {
    const T = await env.create(OWNER, 'Lixo', deck('Lixo')); await env.del(OWNER, `/api/presentations/${T.id}`);
    assert.equal((await post(V1, { kind: 'reaction', elementId: 'x', payload: {} }, T.id)).status, 404); assert.equal((await env.get(V1, url(T.id))).status, 404);
    assert.equal((await post(V1, { kind: 'reaction', elementId: 'x', payload: {} }, '00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await post(null, { kind: 'reaction', elementId: 'x', payload: {} })).status, 401);
    const S = await env.mkUser({ status: 'suspended' }); assert.equal((await post(S, { kind: 'reaction', elementId: 'x', payload: {} })).status, 403);
    assert.equal((await rows({ p: T.id })).length, 0);
  });
});

describe('ler', () => {
  let Q, A1, A2;
  before(async () => {
    Q = await env.create(OWNER, 'Pesquisa', deck('Pesquisa'));
    A1 = await env.mkUser({ name: 'Respondente A' }); A2 = await env.mkUser({ name: 'Respondente B' });
    await post(A1, { kind: 'form_response', elementId: 'f1', payload: { q: ['Nota?'], a: ['9'] } }, Q.id); await post(A2, { kind: 'form_response', elementId: 'f1', payload: { q: ['Nota?'], a: ['3'] } }, Q.id);
    await post(A2, { kind: 'form_response', elementId: 'f2', payload: { q: ['Comentário'], a: ['ok'] } }, Q.id); await post(A1, { kind: 'vote_state', elementId: 'v1', payload: { pts: [1] } }, Q.id);
  });
  test('membro vê SÓ as próprias; dono e admin veem todas, com o autor', async () => {
    const own = await env.get(A1, url(Q.id)); assert.equal(own.status, 200); assert.equal(own.json.items.length, 2); assert.ok(own.json.items.every((i) => i.author.id === A1.id && i.user.id === A1.id), 'author (contrato) e user (compatibilidade) apontam para quem respondeu'); assert.equal(own.json.truncated, false);
    const owner = await env.get(OWNER, url(Q.id)); assert.equal(owner.json.items.length, 4); assert.deepEqual([...new Set(owner.json.items.map((i) => i.author.displayName))].sort(), ['Respondente A', 'Respondente B']);
    assert.equal((await env.get(ADM, url(Q.id))).json.items.length, 4);
    assert.equal((await env.get(V1, url(Q.id))).json.items.length, 0, 'quem não respondeu não vê nada');
    assert.deepEqual(Object.keys(owner.json.items[0]).sort(), ['author', 'createdAt', 'elementId', 'id', 'kind', 'payload', 'updatedAt', 'user']);
  });
  test('filtros kind/elementId; valores inválidos → 400', async () => {
    assert.equal((await env.get(OWNER, url(Q.id) + '?kind=form_response')).json.items.length, 3);
    assert.equal((await env.get(OWNER, url(Q.id) + '?kind=form_response&elementId=f2')).json.items.length, 1);
    assert.equal((await env.get(OWNER, url(Q.id) + '?elementId=v1')).json.items[0].kind, 'vote_state');
    assert.equal((await env.get(A1, url(Q.id) + '?kind=form_response&elementId=f2')).json.items.length, 0, 'f2 é do outro');
    for (const bad of ['kind=x', 'elementId=<b>', 'elementId=' + 'a'.repeat(81)]) assert.equal((await env.get(OWNER, url(Q.id) + '?' + bad)).status, 400, bad);
    assert.equal((await env.get(OWNER, url(Q.id) + "?elementId=f1'%20or%201=1")).status, 400);
  });
  test('o dono perde o acesso às respostas quando a apresentação é transferida (o novo dono ganha)', async () => {
    const R = await env.create(OWNER, 'Transferível', deck('T')); await post(A1, { kind: 'form_response', elementId: 'f', payload: { q: ['q'], a: ['a'] } }, R.id);
    assert.equal((await env.get(OWNER, url(R.id))).json.items.length, 1);
    await env.post(ADM, `/api/presentations/${R.id}/transfer`, { json: { toUserId: V2.id } });
    assert.equal((await env.get(OWNER, url(R.id))).json.items.length, 0); assert.equal((await env.get(V2, url(R.id))).json.items.length, 1);
    assert.equal((await env.get(OWNER, url(R.id) + '.csv')).status, 403);
  });
});

describe('CSV (dono/admin)', () => {
  let Q;
  before(async () => {
    Q = await env.create(OWNER, 'Exportar', deck('Exportar'));
    const w = (u, el, payload) => post(u, { kind: 'form_response', elementId: el, payload }, Q.id);
    await w(V1, 'f1', { q: ['Nome', 'Nota', '=HYPERLINK("http://evil","x")'], a: ['=SUM(1+1)', '+55 11 9999', '@cmd'] });
    await w(V2, 'f1', { q: ['Nome', 'Nota'], a: ['-3', '\tTAB'] });
    await w(V1, 'f1', { q: ['Nome', 'Nome', 'Nova pergunta'], a: ['Ana; "a Sábia"\nlinha 2', 'repetida', ['x', 'y']] });
    await w(V1, 'f2', { q: ['Outra'], a: ['\r=cr'] });
    await post(V1, { kind: 'reaction', elementId: 'r', payload: { emoji: '=1+1' } }, Q.id);
  });
  test('só dono e admin exportam: outro membro 403, invisível 404, sem login 401; cabeçalhos do download e auditoria sem conteúdo', async () => {
    assert.equal((await env.get(V1, url(Q.id) + '.csv')).status, 403, 'quem respondeu não exporta as dos outros'); assert.equal((await env.get(null, url(Q.id) + '.csv')).status, 401);
    const T = await env.create(OWNER, 'Lixo CSV', deck('x')); await env.del(OWNER, `/api/presentations/${T.id}`); assert.equal((await env.get(V1, url(T.id) + '.csv')).status, 404);
    for (const u of [OWNER, ADM]) {
      const r = await env.get(u, url(Q.id) + '.csv'); assert.equal(r.status, 200, r.text);
      assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8'); assert.match(r.headers.get('content-disposition'), /^attachment; filename="respostas-[0-9a-f]{8}\.csv"$/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    }
    const au = await env.sys((tx) => tx`select actor_id, meta from app.audit_log where action = 'interactions.export' and entity_id = ${Q.id}`); assert.equal(au.length, 2);
    assert.deepEqual(au[0].meta, { kind: 'form_response', rows: 4 }); assert.ok(!JSON.stringify(au).includes('HYPERLINK'));
  });
  test('UTF-8 com BOM, separador ";", CRLF, cabeçalho DINÂMICO a partir de payload.q (união das perguntas; repetidas ganham sufixo)', async () => {
    const r = await env.get(OWNER, url(Q.id) + '.csv?kind=form_response&elementId=f1');
    assert.ok(r.buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'BOM UTF-8'); assert.ok(r.text.startsWith(BOM));
    const lines = r.text.slice(1).split('\r\n'); assert.equal(lines[lines.length - 1], '');
    assert.equal(lines[0], 'Data/hora (UTC);Respondente;Elemento;Nome;Nota;"\'=HYPERLINK(""http://evil"",""x"")";Nome (2);Nova pergunta');
  });
  test('ANTI CSV-INJECTION: células que começam com = + - @ TAB CR (respostas, perguntas, nome do respondente) recebem apóstrofo', async () => {
    const r = await env.get(OWNER, url(Q.id) + '.csv?kind=form_response'); const text = r.text;
    assert.ok(text.includes("'=SUM(1+1)")); assert.ok(text.includes("'+55 11 9999")); assert.ok(text.includes("'@cmd")); assert.ok(text.includes("'-3"));
    assert.ok(text.includes("'\tTAB")); assert.ok(text.includes("\"'\r=cr\""), 'CR inicial também (a célula vai entre aspas por causa do \\r)');
    assert.ok(text.includes(`"'=cmd|""/c calc""!A1"`), 'o NOME do respondente também é entrada de usuário');
    assert.ok(text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'o texto da PERGUNTA vira cabeçalho: também protegido');
    // nenhuma célula começa com um caractere de fórmula (parse simples respeitando aspas)
    const cells = parseCsv(text.slice(1)); assert.ok(cells.length > 4);
    for (const row of cells) for (const cell of row) assert.ok(!/^[=+\-@\t\r]/.test(cell), `célula perigosa: ${JSON.stringify(cell)}`);
  });
  test('escapes de CSV: separador, aspas e quebra de linha na resposta; lista vira "x; y"; pergunta ausente fica vazia', async () => {
    const r = await env.get(OWNER, url(Q.id) + '.csv?elementId=f1&kind=form_response'); const cells = parseCsv(r.text.slice(1)); assert.equal(cells.length, 4);
    const hdr = cells[0]; assert.equal(hdr.length, 8);
    const ana = cells.find((c) => c[3] === 'Ana; "a Sábia"\nlinha 2'); assert.ok(ana, 'valor com ; " e quebra de linha preservado'); assert.equal(ana[hdr.indexOf('Nome (2)')], 'repetida'); assert.equal(ana[hdr.indexOf('Nova pergunta')], 'x; y'); assert.equal(ana[hdr.indexOf('Nota')], '');
    assert.ok(cells.every((c) => c.length === hdr.length), 'todas as linhas têm o mesmo nº de colunas');
    const one = cells.find((c) => c[1] === 'Visitante Um' && c[3] === "'=SUM(1+1)"); assert.ok(one); assert.ok(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(one[0]));
  });
  test('filtro por elemento; tipos que não são formulário saem com colunas fixas e JSON do payload (também protegido)', async () => {
    const f2 = parseCsv((await env.get(OWNER, url(Q.id) + '.csv?elementId=f2')).text.slice(1)); assert.equal(f2.length, 2); assert.equal(f2[0][3], 'Outra');
    const re = parseCsv((await env.get(OWNER, url(Q.id) + '.csv?kind=reaction')).text.slice(1)); assert.deepEqual(re[0], ['Data/hora (UTC)', 'Respondente', 'Tipo', 'Elemento', 'Conteúdo (JSON)']); assert.equal(re[1][2], 'reaction'); assert.equal(re[1][4], '{"emoji":"=1+1"}');
    const empty = await env.get(OWNER, url(Q.id) + '.csv?kind=board_state'); assert.equal(empty.status, 200); assert.equal(empty.text.trim().split('\r\n').length, 1, 'só o cabeçalho');
    for (const bad of ['kind=x', 'elementId=%3Cb%3E']) assert.equal((await env.get(OWNER, url(Q.id) + '.csv?' + bad)).status, 400, bad);
  });
  test('muitas perguntas num payload não explodem as colunas (teto de 300)', async () => {
    const R = await env.create(OWNER, 'Larga', deck('Larga')); const q = Array.from({ length: 2000 }, (_, i) => 'p' + i);
    await post(V1, { kind: 'form_response', elementId: 'f', payload: { q, a: q } }, R.id);
    const t = parseCsv((await env.get(OWNER, url(R.id) + '.csv')).text.slice(1)); assert.ok(t[0].length <= 303);
  });
});

describe('csv.js (funções puras)', () => {
  test('csvCell: neutraliza fórmulas, escapa aspas/;/quebras, remove NUL', () => {
    assert.equal(csvCell('=1+1'), "'=1+1"); assert.equal(csvCell('+1'), "'+1"); assert.equal(csvCell('-1'), "'-1"); assert.equal(csvCell('@a'), "'@a"); assert.equal(csvCell('\tx'), "'\tx");
    assert.equal(csvCell('texto normal'), 'texto normal'); assert.equal(csvCell('a=b'), 'a=b'); assert.equal(csvCell(' =1'), ' =1', 'só o PRIMEIRO caractere conta');
    assert.equal(csvCell('a;b'), '"a;b"'); assert.equal(csvCell('diz "oi"'), '"diz ""oi"""'); assert.equal(csvCell('l1\nl2'), '"l1\nl2"'); assert.equal(csvCell('a\u0000b'), 'ab');
    assert.equal(csvCell(null), ''); assert.equal(csvCell(undefined), ''); assert.equal(csvCell(5), '5'); assert.equal(csvCell(-5), "'-5"); assert.equal(csvCell(true), 'true'); assert.equal(csvCell(['a', 'b']), '"a; b"', 'listas viram "a; b" (e, por conter ;, vão entre aspas)'); assert.equal(csvCell({ a: 1 }), '"{""a"":1}"', 'objeto vira JSON entre aspas');
    assert.equal(cellText(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  });
  test('toCsv / interactionsCsv / csvFilename', () => {
    assert.equal(toCsv(['a', 'b'], [[1, '=x']]), BOM + "a;b\r\n1;'=x\r\n");
    const it = (payload, userName = 'U') => ({ createdAt: new Date('2026-01-02T03:04:05Z'), userName, elementId: 'e', kind: 'form_response', payload });
    assert.equal(interactionsCsv('form_response', [it({ q: ['P1'], a: ['R1'] }), it({ q: ['P2'], a: ['R2'] }), it('lixo'), it(null), it({ q: 'x', a: 5 })]), BOM
      + 'Data/hora (UTC);Respondente;Elemento;P1;P2\r\n2026-01-02T03:04:05.000Z;U;e;R1;\r\n2026-01-02T03:04:05.000Z;U;e;;R2\r\n2026-01-02T03:04:05.000Z;U;e;;\r\n2026-01-02T03:04:05.000Z;U;e;;\r\n2026-01-02T03:04:05.000Z;U;e;;\r\n');
    assert.equal(csvFilename('form_response', 'ab12cd34-0000'), 'respostas-ab12cd34.csv'); assert.equal(csvFilename('../x"', '../../etc'), 'x-ec.csv'); assert.equal(csvFilename('"; rm', 'ZZZ'), 'rm-apresentacao.csv'); assert.equal(csvFilename(undefined, 'ab12cd34'), 'interacoes-ab12cd34.csv');
  });
});

/** Leitor de CSV mínimo (separador ;, aspas duplas, CRLF) para conferir o resultado como uma planilha leria. */
function parseCsv(text) {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); out.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}
