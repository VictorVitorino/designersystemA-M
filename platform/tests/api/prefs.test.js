/* Preferências da própria pessoa (GET/PUT /api/me/prefs): só a própria lê/grava (RLS), suspenso/convidado/anônimo não acessam, CSRF obrigatório,
   limites (64 KB, profundidade 10, chaves proibidas, tipos de brandKits/editor) e varredura de HTML ativo. API inteira em memória (boot): sessão real. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';

let t, A, B, ADM, cA, cB, cAdm;
before(async () => {
  t = await boot();
  A = await t.createUser({ displayName: 'Ana' }); B = await t.createUser({ displayName: 'Bruno' }); ADM = await t.createUser({ role: 'admin', displayName: 'Admin' });
  cA = await t.as(A); cB = await t.as(B); cAdm = await t.as(ADM);
});
after(async () => { await t.stop(); });
const resetRates = () => t.ops.asSystem((tx) => tx`delete from app.rate_limits`);
const KIT = { name: 'Cliente X', colors: ['#002A46', '#F78C16'], p: '#002A46', a: '#F78C16', font: 'Roboto', at: 1760000000000 };
const PREFS = { brandKits: [KIT], editor: { sideW: 280, sideOff: false, gxWide: true, recentColors: ['#FFFFFF'] } };

describe('ler e gravar as próprias preferências', () => {
  test('nunca gravou → {prefs:{}}; PUT grava e devolve {prefs}; GET devolve o mesmo; PUT substitui o objeto inteiro', async () => {
    const g0 = await cA.get('/api/me/prefs'); assert.equal(g0.status, 200); assert.deepEqual(g0.json, { prefs: {} });
    const p = await cA.put('/api/me/prefs', { prefs: PREFS }); assert.equal(p.status, 200, p.text); assert.deepEqual(p.json, { prefs: PREFS });
    assert.deepEqual((await cA.get('/api/me/prefs')).json, { prefs: PREFS });
    const p2 = await cA.put('/api/me/prefs', { prefs: { editor: { sideW: 300 } } }); assert.deepEqual(p2.json, { prefs: { editor: { sideW: 300 } } });
    assert.deepEqual((await cA.get('/api/me/prefs')).json, { prefs: { editor: { sideW: 300 } } }, 'PUT substitui (não mescla)');
    assert.deepEqual((await cA.put('/api/me/prefs', { prefs: {} })).json, { prefs: {} }, 'objeto vazio limpa');
    assert.equal((await cA.get('/api/me/prefs')).headers.get('cache-control'), 'no-store');
  });
  test('isolamento: cada pessoa vê só as suas — nem outro membro nem o admin leem as de outra pessoa', async () => {
    await cA.put('/api/me/prefs', { prefs: { brandKits: [{ ...KIT, name: 'Kit da Ana' }] } });
    await cB.put('/api/me/prefs', { prefs: { brandKits: [{ ...KIT, name: 'Kit do Bruno' }] } });
    assert.equal((await cA.get('/api/me/prefs')).json.prefs.brandKits[0].name, 'Kit da Ana');
    assert.equal((await cB.get('/api/me/prefs')).json.prefs.brandKits[0].name, 'Kit do Bruno');
    assert.deepEqual((await cAdm.get('/api/me/prefs')).json, { prefs: {} }, 'o admin vê só as próprias');
    for (const extra of [{ userId: A.id }, { user_id: A.id }, { id: A.id }]) assert.equal((await cB.put('/api/me/prefs', { prefs: {}, ...extra })).status, 400, 'não dá para escolher de quem são');
    assert.equal((await cA.get('/api/me/prefs')).json.prefs.brandKits[0].name, 'Kit da Ana', 'nada mudou');
  });
  test('RLS no banco: o próprio lê/grava; outro membro e o admin não leem nem alteram; ninguém grava em nome de outro', async () => {
    const asU = (u, fn) => t.db.asUser(u.id, fn);
    assert.equal((await asU(B, (tx) => tx`select 1 from app.user_prefs where user_id = ${A.id}`)).length, 0);
    assert.equal((await asU(ADM, (tx) => tx`select 1 from app.user_prefs where user_id = ${A.id}`)).length, 0, 'nem o admin');
    assert.equal((await asU(B, (tx) => tx`update app.user_prefs set prefs = '{"x":1}' where user_id = ${A.id} returning 1`)).length, 0);
    await assert.rejects(() => asU(B, (tx) => tx`insert into app.user_prefs(user_id, prefs) values (${ADM.id}, '{}')`), (e) => e.code === '42501');
    await assert.rejects(() => asU(A, (tx) => tx`update app.user_prefs set user_id = ${B.id} where user_id = ${A.id}`), (e) => e.code === '42501', 'user_id não é alterável');
    await assert.rejects(() => asU(A, (tx) => tx`delete from app.user_prefs where user_id = ${A.id}`), (e) => e.code === '42501');
    await assert.rejects(() => t.db.anon((tx) => tx`select 1 from app.user_prefs`), (e) => e.code === '42501', 'a API sem usuário não lê nada');
    assert.equal((await asU(A, (tx) => tx`select 1 from app.user_prefs where user_id = ${A.id}`)).length, 1);
  });
});

describe('quem não pode', () => {
  test('sem login → 401 (GET e PUT)', async () => {
    const anon = t.anon(); await anon.ensureCsrf();
    assert.equal((await anon.get('/api/me/prefs')).status, 401); assert.equal((await anon.put('/api/me/prefs', { prefs: {} })).status, 401);
  });
  test('suspenso (com sessão ainda válida) → 403 suspended, sem ler nem gravar; o banco também nega', async () => {
    const u = await t.createUser({ displayName: 'Vai ser suspensa' }); const c = await t.as(u, { fresh: true });
    assert.equal((await c.put('/api/me/prefs', { prefs: { editor: { a: 1 } } })).status, 200);
    await t.ops.asSystem((tx) => tx`update app.users set status = 'suspended' where id = ${u.id}`); t.clearIdentityCache();
    for (const r of [await c.get('/api/me/prefs'), await c.put('/api/me/prefs', { prefs: {} })]) { assert.equal(r.status, 403); assert.equal(r.json.error.code, 'suspended'); }
    assert.equal((await t.db.asUser(u.id, (tx) => tx`select 1 from app.user_prefs`)).length, 0, 'RLS: conta suspensa não lê');
    const [row] = await t.ops.asSystem((tx) => tx`select prefs from app.user_prefs where user_id = ${u.id}`); assert.deepEqual(row.prefs, { editor: { a: 1 } }, 'nada foi apagado');
  });
  test('convidado que ainda não definiu a senha → 403', async () => {
    const inv = await cAdm.post('/api/admin/invites', { email: 'prefs.convidada@am.test', displayName: 'Convidada' }); assert.equal(inv.status, 201);
    const th = t.fake.outbox('prefs.convidada@am.test').at(-1).token_hash;
    const c = t.anon(); await c.ensureCsrf(); assert.equal((await c.post('/api/auth/verify', { tokenHash: th, type: 'invite' })).status, 200);
    assert.equal((await c.get('/api/me/prefs')).status, 403); assert.equal((await c.put('/api/me/prefs', { prefs: {} })).status, 403);
  });
  test('CSRF: PUT sem token, com Origin de outro site ou como formulário → 403 csrf; nada muda', async () => {
    await resetRates(); await cA.put('/api/me/prefs', { prefs: { editor: { antes: true } } });
    const body = JSON.stringify({ prefs: { editor: { depois: true } } });
    for (const o of [{ body, headers: { 'content-type': 'application/json' }, csrf: false }, { body, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } },
      { body, headers: { 'content-type': 'text/plain' } }, { body: 'prefs=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { body, headers: { 'content-type': 'application/json' }, origin: false }]) {
      const r = await cA.request('PUT', '/api/me/prefs', o); assert.equal(r.status, 403); assert.equal(r.json.error.code, 'csrf');
    }
    assert.deepEqual((await cA.get('/api/me/prefs')).json.prefs, { editor: { antes: true } });
  });
});

describe('validação e limites', () => {
  test('64 KB serializados: no limite passa; 1 byte a mais → 413; corpo gigante → 413 sem ler', async () => {
    await resetRates();
    const fill = (n) => ({ editor: { s: 'x'.repeat(n) } }); const base = Buffer.byteLength(JSON.stringify(fill(0)));
    assert.equal((await cA.put('/api/me/prefs', { prefs: fill(64 * 1024 - base) })).status, 200, 'exatamente 64 KB');
    const over = await cA.put('/api/me/prefs', { prefs: fill(64 * 1024 - base + 1) }); assert.equal(over.status, 413); assert.equal(over.json.error.code, 'too_large');
    const multi = await cA.put('/api/me/prefs', { prefs: { editor: { s: 'ã'.repeat(33 * 1024) } } }); assert.equal(multi.status, 413, 'bytes UTF-8, não caracteres');
    const huge = await cA.request('PUT', '/api/me/prefs', { body: JSON.stringify({ prefs: { s: 'y'.repeat(200 * 1024) } }), headers: { 'content-type': 'application/json' } }); assert.equal(huge.status, 413);
  });
  test('profundidade ≤ 10 (o próprio prefs conta 1): 10 passa, 11 → 400', async () => {
    await resetRates();
    const nest = (levels) => { let v = { fim: 1 }; for (let i = 1; i < levels; i++) v = { n: v }; return v; };
    assert.equal((await cA.put('/api/me/prefs', { prefs: nest(10) })).status, 200);
    assert.equal((await cA.put('/api/me/prefs', { prefs: nest(11) })).status, 400);
    let arr = [1]; for (let i = 0; i < 10; i++) arr = [arr]; assert.equal((await cA.put('/api/me/prefs', { prefs: { editor: {}, l: arr } })).status, 400, 'listas também contam');
  });
  test('chaves __proto__/constructor/prototype em qualquer nível → 400 e nada é gravado (sem poluição de protótipo)', async () => {
    await resetRates(); await cA.put('/api/me/prefs', { prefs: { editor: { ok: 1 } } });
    for (const raw of ['{"prefs":{"__proto__":{"admin":true}}}', '{"prefs":{"editor":{"constructor":{"prototype":{"x":1}}}}}', '{"prefs":{"brandKits":[{"prototype":1}]}}', '{"prefs":{"a":{"b":{"__proto__":1}}}}']) {
      const r = await cA.request('PUT', '/api/me/prefs', { body: raw, headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, raw);
    }
    assert.equal({}.admin, undefined); assert.equal(Object.prototype.x, undefined);
    assert.deepEqual((await cA.get('/api/me/prefs')).json.prefs, { editor: { ok: 1 } });
    assert.equal((await cA.put('/api/me/prefs', { prefs: { editor: { constructorName: 'ok', prototypes: 2 } } })).status, 200, 'nomes parecidos são dados comuns');
  });
  test('forma: prefs precisa ser objeto; brandKits é lista; editor é objeto; campos extras e JSON quebrado → 400', async () => {
    await resetRates();
    for (const body of [{}, { prefs: [] }, { prefs: 'x' }, { prefs: null }, { prefs: 5 }, { prefs: {}, extra: 1 }, { prefs: { brandKits: {} } }, { prefs: { brandKits: 'kit' } }, { prefs: { editor: [] } }, { prefs: { editor: 'x' } }, { prefs: { editor: null } }]) {
      assert.equal((await cA.put('/api/me/prefs', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await cA.request('PUT', '/api/me/prefs', { body: '{x', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await cA.put('/api/me/prefs', { prefs: { outraChave: [1, 2], editor: {} } })).status, 200, 'chaves futuras são aceitas');
  });
  test('NUL/surrogate solto → 400; HTML ativo nas strings (nome de kit, chave) → 422 sem ecoar; texto comum com < > passa', async () => {
    await resetRates();
    for (const bad of ['a\u0000b', '\ud800']) assert.equal((await cA.put('/api/me/prefs', { prefs: { editor: { s: bad } } })).status, 400);
    for (const prefs of [{ brandKits: [{ name: '<script>SEGREDO_PREFS</script>' }] }, { editor: { link: 'javascript:alert(1)' } }, { editor: { '<img src=x onerror=alert(1)>': 1 } }, { brandKits: [{ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }] }]) {
      const r = await cA.put('/api/me/prefs', { prefs }); assert.equal(r.status, 422, JSON.stringify(prefs)); assert.equal(r.json.error.code, 'rejected_content');
      assert.ok(!r.text.includes('SEGREDO_PREFS') && !r.text.includes('<'), 'não ecoa');
    }
    assert.equal((await cA.put('/api/me/prefs', { prefs: { brandKits: [{ name: 'Cliente <Acme> & Filhos', colors: ['#000000'] }], editor: { nota: 'a < b && c > d' } } })).status, 200);
  });
  test('limite de taxa da gravação: 60/min por pessoa → 429 com Retry-After (a leitura segue o limite de leitura)', async () => {
    await t.awayFromWindowEdge(60, 15000); await resetRates();
    const u = await t.createUser(); const c = await t.as(u, { fresh: true });
    const st = []; for (let i = 0; i < 61; i++) st.push((await c.put('/api/me/prefs', { prefs: { editor: { i } } })).status);
    assert.equal(st.filter((s) => s === 200).length, 60); assert.equal(st[60], 429);
    assert.equal((await c.get('/api/me/prefs')).status, 200, 'ler continua possível');
  });
});
