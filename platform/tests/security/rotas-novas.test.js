/* tests/security/rotas-novas.test.js — revisão OFENSIVA das rotas e regras acrescentadas em 2026-10-07 (preferências, apagar/idempotência de
   interações, details.issues, citação de tags no lint, cota). Mesma regra de offensive.test.js: cada teste é um ATAQUE; vermelho = achado.
   API inteira em memória (tests/helpers/boot.js): Postgres real com RLS + GoTrue falso + armazenamento local temporário. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';
import { ATTACKS } from '../fixtures/xss-corpus.js';

const deck = (title = 'Teste', { slides = 1, html = 'Olá' } = {}) => ({
  v: 1, app: 'AM Studio', id: 'dtest', title,
  slides: Array.from({ length: slides }, (_, i) => ({ id: `s${i}`, bg: '#FFFFFF', tr: 'fade', layout: 'blank-light', els: [{ id: `t${i}`, type: 'text', x: 10, y: 10, w: 300, h: 40, html }] })),
});
const errCode = (r) => r.json && r.json.error && r.json.error.code;

let t, A, B, ADM, cA, cB, cAdm, P;
before(async () => {
  t = await boot();
  A = await t.createUser({ displayName: 'Ana Dona' }); B = await t.createUser({ displayName: 'Bruno Membro' }); ADM = await t.createUser({ role: 'admin', displayName: 'Admin' });
  cA = await t.as(A); cB = await t.as(B); cAdm = await t.as(ADM);
  P = (await cA.post('/api/presentations', { title: 'Workshop da Ana', content: deck('Workshop da Ana') })).json;
});
after(async () => { await t.stop(); });
const resetRates = () => t.ops.asSystem((tx) => tx`delete from app.rate_limits`);

describe('CSRF nas rotas de escrita novas', () => {
  test('PUT /api/me/prefs e DELETE …/interactions com a sessão da vítima: sem token, Origin alheio/null, sem Origin, text/plain, formulário → 403 csrf; nada muda', async () => {
    await resetRates();
    await cA.put('/api/me/prefs', { prefs: { brandKits: [{ name: 'Kit legítimo' }] } });
    await cB.post(`/api/presentations/${P.id}/interactions`, { kind: 'form_response', elementId: 'f1', payload: { a: ['resposta do Bruno'] } });
    const victim = await t.as(A, { fresh: true });
    const writes = [['PUT', '/api/me/prefs', { prefs: { brandKits: [] } }], ['DELETE', `/api/presentations/${P.id}/interactions?elementId=f1`]];
    for (const [m, p, j] of writes) {
      const body = j === undefined ? undefined : JSON.stringify(j);
      for (const [name, o] of [
        ['sem token', { body, headers: body ? { 'content-type': 'application/json' } : {}, csrf: false }],
        ['Origin alheio', { body, headers: { ...(body ? { 'content-type': 'application/json' } : {}), origin: 'https://evil.example' } }],
        ['Origin null', { body, headers: { ...(body ? { 'content-type': 'application/json' } : {}), origin: 'null' } }],
        ['sem Origin/Sec-Fetch-Site', { body, headers: body ? { 'content-type': 'application/json' } : {}, origin: false }],
        ['text/plain', { body: body || '{}', headers: { 'content-type': 'text/plain' } }],
        ['form urlencoded', { body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }],
      ]) { const r = await victim.request(m, p, o); assert.equal(r.status, 403, `${m} ${p} (${name}): ${r.status}`); assert.equal(errCode(r), 'csrf', `${m} ${p} (${name})`); }
    }
    assert.deepEqual((await cA.get('/api/me/prefs')).json.prefs, { brandKits: [{ name: 'Kit legítimo' }] }, 'as preferências da vítima não mudaram');
    const [{ n }] = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.interactions where presentation_id = ${P.id} and element_id = 'f1'`); assert.equal(n, 1, 'nenhuma resposta apagada');
  });
});

describe('autorização (IDOR/BOLA)', () => {
  test('preferências: não há como ler ou gravar as de outra pessoa (parâmetros, cabeçalhos, caminhos) — cada um só vê as suas', async () => {
    await resetRates();
    await cA.put('/api/me/prefs', { prefs: { brandKits: [{ name: 'SEGREDO-KIT-ANA' }] } });
    for (const p of [`/api/me/prefs?userId=${A.id}`, `/api/me/prefs?user_id=${A.id}`, `/api/me/prefs/${A.id}`, `/api/users/${A.id}/prefs`, `/api/me/prefs/../prefs?id=${A.id}`]) {
      const r = await cB.get(p); assert.ok(!r.text.includes('SEGREDO-KIT-ANA'), p);
    }
    const h = await cB.request('GET', '/api/me/prefs', { headers: { 'x-user-id': A.id, 'x-test-user': A.id } }); assert.ok(!h.text.includes('SEGREDO-KIT-ANA'), 'cabeçalhos não trocam a identidade');
    assert.ok(!(await cAdm.get('/api/me/prefs')).text.includes('SEGREDO-KIT-ANA'), 'nem o admin');
    assert.equal((await cB.put('/api/me/prefs', { prefs: {}, userId: A.id })).status, 400);
    assert.ok((await cA.get('/api/me/prefs')).text.includes('SEGREDO-KIT-ANA'));
  });
  test('apagar interações: membro não apaga as dos outros (nem em massa, nem por kind); quem não vê a apresentação recebe 404 (não descobre que existe)', async () => {
    await resetRates();
    await cA.post(`/api/presentations/${P.id}/interactions`, { kind: 'form_response', elementId: 'alvo', payload: { a: ['da Ana'] } });
    await cAdm.post(`/api/presentations/${P.id}/interactions`, { kind: 'vote_state', elementId: 'alvo', payload: { v: 1 } });
    for (const q of ['elementId=alvo', 'elementId=alvo&kind=form_response', 'elementId=alvo&kind=vote_state']) assert.deepEqual((await cB.del(`/api/presentations/${P.id}/interactions?${q}`)).json, { deleted: 0 }, q);
    const [{ n }] = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.interactions where presentation_id = ${P.id} and element_id = 'alvo'`); assert.equal(n, 2);
    const trash = (await cA.post('/api/presentations', { title: 'Lixo da Ana' })).json; await cA.post(`/api/presentations/${trash.id}/interactions`, { kind: 'form_response', elementId: 'x', payload: {} }); await cA.del(`/api/presentations/${trash.id}`);
    const r = await cB.del(`/api/presentations/${trash.id}/interactions?elementId=x`); assert.equal(r.status, 404); assert.equal(errCode(r), 'not_found');
    assert.equal((await cB.del('/api/presentations/00000000-0000-4000-8000-000000000000/interactions?elementId=x')).status, 404, 'inexistente = invisível');
  });
  test('clientId não vaza item alheio: outra pessoa com o MESMO clientId recebe um item novo dela (201), nunca o id/conteúdo do item da vítima', async () => {
    await resetRates();
    const a = await cA.post(`/api/presentations/${P.id}/interactions`, { kind: 'form_response', elementId: 'cid', clientId: 'adivinhado-123', payload: { a: ['SEGREDO-RESPOSTA'] } }); assert.equal(a.status, 201);
    const b = await cB.post(`/api/presentations/${P.id}/interactions`, { kind: 'form_response', elementId: 'cid', clientId: 'adivinhado-123', payload: { a: ['minha'] } });
    assert.equal(b.status, 201); assert.notEqual(b.json.id, a.json.id); assert.ok(!b.text.includes('SEGREDO-RESPOSTA'));
    const mine = (await cB.get(`/api/presentations/${P.id}/interactions?elementId=cid`)).json.items; assert.equal(mine.length, 1); assert.equal(mine[0].author.id, B.id);
  });
});

describe('XSS e eco de conteúdo', () => {
  test('details.issues nunca ecoa o conteúdo recusado — nem quando o próprio id do elemento é o ataque', async () => {
    await resetRates();
    const d = deck('Eco', { slides: 2 }); d.slides[1].els[0].html = '"><img src=x onerror=alert("SEGREDO-ECO")>'; d.slides[0].els[0].id = '<svg onload=alert(1)>'; d.slides[0].els[0].html = '<script>x</script>';
    for (const r of [await cA.put(`/api/presentations/${P.id}/content`, { baseRev: P.rev, content: d }), await cA.post('/api/presentations', { content: d })]) {
      assert.equal(r.status, 422); const { issues } = r.json.error.details;
      assert.ok(Array.isArray(issues) && issues.length >= 2 && issues.length <= 20);
      assert.ok(!r.text.includes('SEGREDO-ECO') && !r.text.includes('<') && !r.text.includes('onload'), r.text.slice(0, 300));
      assert.deepEqual([...new Set(issues.map((i) => `${i.slide}|${i.elementId}`))].sort(), ['1|null', '2|t1']);
      for (const i of issues) { assert.deepEqual(Object.keys(i).sort(), ['elementId', 'reason', 'slide']); assert.match(i.reason, /^[a-z_]+$/); }
    }
  });
  test('o corpus de ataques continua recusado pela API num texto; as citações escapadas que o editor grava passam', async () => {
    await resetRates();
    const p = (await cA.post('/api/presentations', { title: 'Corpus' })).json; let rev = p.rev;
    for (const a of ATTACKS) { const r = await cA.put(`/api/presentations/${p.id}/content`, { baseRev: rev, content: deck('Corpus', { html: a.value }) }); assert.equal(r.status, 422, a.name); assert.ok(r.json.error.details.issues.length, a.name); }
    for (const html of ['use a tag &lt;form&gt; para formulários', 'Coloque &lt;link&gt; e &lt;meta&gt; no &lt;head&gt;', 'O elemento &lt;iframe&gt; incorpora; feche com &lt;/form&gt;']) {
      const r = await cA.put(`/api/presentations/${p.id}/content`, { baseRev: rev, content: deck('Corpus', { html }) }); assert.equal(r.status, 200, `${html}: ${r.text.slice(0, 200)}`); rev = r.json.rev;
    }
    for (const html of ['a tag &lt;script&gt;alert(1)&lt;/script&gt;', '&lt;form action="https://evil.example"&gt;', '&lt;button formaction="https://evil.example"&gt;x&lt;/button&gt;', '&lt;svg&gt;', '&lt;style&gt;']) {
      assert.equal((await cA.put(`/api/presentations/${p.id}/content`, { baseRev: rev, content: deck('Corpus', { html }) })).status, 422, html);
    }
  });
  test('preferências não guardam HTML ativo nem poluem protótipos', async () => {
    await resetRates();
    for (const raw of ['{"prefs":{"__proto__":{"isAdmin":true}}}', '{"prefs":{"editor":{"constructor":{"prototype":{"isAdmin":true}}}}}']) {
      assert.equal((await cA.request('PUT', '/api/me/prefs', { body: raw, headers: { 'content-type': 'application/json' } })).status, 400);
    }
    assert.equal({}.isAdmin, undefined);
    const r = await cA.put('/api/me/prefs', { prefs: { brandKits: [{ name: '<img src=x onerror=alert(document.cookie)>' }] } }); assert.equal(r.status, 422); assert.ok(!r.text.includes('onerror'));
  });
});

describe('abuso', () => {
  test('auditoria das exclusões e das preferências não guarda conteúdo', async () => {
    await resetRates();
    await cB.post(`/api/presentations/${P.id}/interactions`, { kind: 'form_response', elementId: 'lgpd', payload: { a: ['CPF-123.456.789-00'] } });
    assert.equal((await cA.del(`/api/presentations/${P.id}/interactions?elementId=lgpd`)).json.deleted, 1);
    await cA.put('/api/me/prefs', { prefs: { brandKits: [{ name: 'KIT-NAO-AUDITADO' }] } });
    const text = JSON.stringify(await t.ops.asSystem((tx) => tx`select action, meta from app.audit_log`));
    assert.ok(!text.includes('CPF-123') && !text.includes('KIT-NAO-AUDITADO'));
    assert.ok(text.includes('interactions.delete'));
  });
  test('preferências: corpo gigante → 413 sem ler tudo; 60 gravações/min por pessoa', async () => {
    await t.awayFromWindowEdge(60, 15000); await resetRates();
    const huge = await cA.request('PUT', '/api/me/prefs', { body: '{"prefs":{"x":"' + 'y'.repeat(2 * 1024 * 1024) + '"}}', headers: { 'content-type': 'application/json' } }); assert.equal(huge.status, 413);
    const st = []; for (let i = 0; i < 61; i++) st.push((await cB.put('/api/me/prefs', { prefs: { editor: { i } } })).status);
    assert.equal(st.filter((s) => s === 200).length, 60); assert.equal(st[60], 429);
  });
});
