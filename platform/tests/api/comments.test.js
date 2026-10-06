/* Comentários: matriz de permissões (autor × dono da apresentação × admin × outro membro), texto puro, limites, exclusão lógica, auditoria. Banco real (RLS + gatilho). */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, deck } from '../helpers/mini-app.js';

let env, OWNER, AUTHOR, OTHER, ADM, P;
before(async () => {
  env = await makeEnv();
  OWNER = await env.mkUser({ name: 'Dona' }); AUTHOR = await env.mkUser({ name: 'Autor' }); OTHER = await env.mkUser({ name: 'Outro' }); ADM = await env.mkUser({ role: 'admin', name: 'Admin' });
  P = await env.create(OWNER, 'Para comentar', deck('Para comentar', { slides: 3 }));
});
after(async () => { await env.stop(); });
beforeEach(async () => { await env.resetRates(); });   // cada teste começa com o limitador zerado (o teste de taxa tem os próprios usuários)
const base = (id = P.id) => `/api/presentations/${id}/comments`;
const dbRow = async (id) => (await env.sys((tx) => tx`select * from app.comments where id = ${id}`))[0];
const mk = async (user, body = 'Comentário de teste', extra = {}, id = P.id) => { const r = await env.post(user, base(id), { json: { body, ...extra } }); assert.equal(r.status, 201, r.text); return r.json; };

describe('criar e listar', () => {
  test('qualquer um que VÊ a apresentação comenta; autor = sessão; resposta completa e flags de permissão', async () => {
    const c = await mk(AUTHOR, 'Ótimo slide!', { slideIndex: 2 });
    assert.deepEqual(Object.keys(c).sort(), ['author', 'body', 'canDelete', 'canEdit', 'canResolve', 'createdAt', 'editedAt', 'id', 'resolvedAt', 'slideIndex']);
    assert.deepEqual(c.author, { id: AUTHOR.id, displayName: 'Autor' }); assert.equal(c.slideIndex, 2); assert.equal(c.editedAt, null); assert.equal(c.resolvedAt, null);
    assert.equal(c.canDelete, true); assert.equal(c.canResolve, true); assert.equal(c.canEdit, true);
    const db = await dbRow(c.id); assert.equal(db.author_id, AUTHOR.id); assert.equal(db.presentation_id, P.id);
    const asOwner = (await env.get(OWNER, base())).json.items.find((x) => x.id === c.id); assert.equal(asOwner.canDelete, true); assert.equal(asOwner.canResolve, true); assert.equal(asOwner.canEdit, false, 'dono não edita o texto alheio');
    const asOther = (await env.get(OTHER, base())).json.items.find((x) => x.id === c.id); assert.equal(asOther.canDelete, false); assert.equal(asOther.canResolve, false); assert.equal(asOther.canEdit, false);
    const asAdm = (await env.get(ADM, base())).json.items.find((x) => x.id === c.id); assert.equal(asAdm.canDelete, true); assert.equal(asAdm.canResolve, true); assert.equal(asAdm.canEdit, false);
  });
  test('o cliente não escolhe autor, apresentação nem datas (corpo estrito)', async () => {
    for (const extra of [{ authorId: OWNER.id }, { author_id: OWNER.id }, { presentationId: P.id }, { createdAt: '2000-01-01' }, { resolved: true }]) {
      const r = await env.post(AUTHOR, base(), { json: { body: 'x', ...extra } }); assert.equal(r.status, 400, JSON.stringify(extra));
    }
  });
  test('texto: 1–2000 caracteres (code points), puro; vazio/branco/NUL/controle/surrogate solto → 400; HTML é guardado como TEXTO', async () => {
    assert.equal((await env.post(AUTHOR, base(), { json: { body: '' } })).status, 400);
    assert.equal((await env.post(AUTHOR, base(), { json: { body: '   \n\t ' } })).status, 400);
    assert.equal((await env.post(AUTHOR, base(), { json: { body: 'a'.repeat(2001) } })).status, 400);
    assert.equal((await env.post(AUTHOR, base(), { json: { body: 'a'.repeat(2000) } })).status, 201);
    assert.equal((await env.post(AUTHOR, base(), { json: { body: '😀'.repeat(2000) } })).status, 201, '2000 emojis = 2000 caracteres');
    assert.equal((await env.post(AUTHOR, base(), { json: { body: '😀'.repeat(2001) } })).status, 400);
    for (const bad of ['a\u0000b', 'a\u0001b', 'x\ud83dy', '\udc00', 'a\u007fb']) assert.equal((await env.post(AUTHOR, base(), { json: { body: bad } })).status, 400, JSON.stringify(bad));
    for (const bad of [1, null, ['a'], { a: 1 }]) assert.equal((await env.post(AUTHOR, base(), { json: { body: bad } })).status, 400);
    const html = '<img src=x onerror=alert(1)> & <script>1</script>\nlinha 2\tcom tab';
    const c = await mk(AUTHOR, html); assert.equal(c.body, html, 'texto puro: nenhuma sanitização que altere o que a pessoa escreveu; a interface escapa');
    assert.equal((await dbRow(c.id)).body, html);
    assert.equal((await mk(AUTHOR, '  com espaços nas pontas  ')).body, 'com espaços nas pontas');
  });
  test('slideIndex: opcional, inteiro 0..499 (ou null)', async () => {
    assert.equal((await mk(AUTHOR, 'sem slide')).slideIndex, null); assert.equal((await mk(AUTHOR, 'nulo', { slideIndex: null })).slideIndex, null); assert.equal((await mk(AUTHOR, 'zero', { slideIndex: 0 })).slideIndex, 0); assert.equal((await mk(AUTHOR, 'max', { slideIndex: 499 })).slideIndex, 499);
    for (const bad of [-1, 500, 1.5, '1', true]) assert.equal((await env.post(AUTHOR, base(), { json: { body: 'x', slideIndex: bad } })).status, 400, String(bad));
  });
  test('listagem: ordem de criação, resolvidos escondidos por padrão (includeResolved=1 mostra), apagados nunca aparecem', async () => {
    const Q = await env.create(OWNER, 'Lista de comentários', deck('Lista'));
    const a = await mk(AUTHOR, 'primeiro', {}, Q.id), b = await mk(OTHER, 'segundo', {}, Q.id), c = await mk(AUTHOR, 'terceiro', {}, Q.id);
    await env.patch(OWNER, `/api/comments/${b.id}`, { json: { resolved: true } }); await env.del(AUTHOR, `/api/comments/${c.id}`);
    assert.deepEqual((await env.get(OTHER, base(Q.id))).json.items.map((x) => x.body), ['primeiro']);
    assert.deepEqual((await env.get(OTHER, base(Q.id) + '?includeResolved=1')).json.items.map((x) => x.body), ['primeiro', 'segundo']);
    assert.equal((await env.get(OTHER, base(Q.id) + '?includeResolved=talvez')).status, 400);
    const item = (await env.get(OTHER, base(Q.id) + '?includeResolved=true')).json.items[1]; assert.ok(item.resolvedAt); void a;
  });
  test('apresentação na lixeira alheia ou inexistente → 404 em tudo; sem login → 401; suspenso → 403', async () => {
    const T = await env.create(OWNER, 'Lixo', deck('Lixo')); const c = await mk(OWNER, 'do dono', {}, T.id); await env.del(OWNER, `/api/presentations/${T.id}`);
    assert.equal((await env.get(OTHER, base(T.id))).status, 404); assert.equal((await env.post(OTHER, base(T.id), { json: { body: 'x' } })).status, 404);
    assert.equal((await env.patch(OTHER, `/api/comments/${c.id}`, { json: { resolved: true } })).status, 404, 'comentário de presentação invisível não existe');
    assert.equal((await env.del(OTHER, `/api/comments/${c.id}`)).status, 404);
    assert.equal((await env.get(OTHER, base('00000000-0000-4000-8000-000000000000'))).status, 404); assert.equal((await env.get(OTHER, base('x'))).status, 404);
    assert.equal((await env.patch(OTHER, '/api/comments/nao-uuid', { json: { resolved: true } })).status, 404);
    assert.equal((await dbRow(c.id)).deleted_at, null, 'nada foi alterado');
    assert.equal((await env.get(null, base())).status, 401); assert.equal((await env.post(null, base(), { json: { body: 'x' } })).status, 401);
    const S = await env.mkUser({ status: 'suspended' }); assert.equal((await env.post(S, base(), { json: { body: 'x' } })).status, 403);
  });
  test('teto de 1000 comentários ativos por apresentação (409); apagar libera espaço', async () => {
    const F = await env.create(OWNER, 'Cheia', deck('Cheia'));
    await env.sys((tx) => tx`insert into app.comments(presentation_id, author_id, body) select ${F.id}::uuid, ${AUTHOR.id}::uuid, 'c' || g from generate_series(1, 1000) g`);
    const r = await env.post(OTHER, base(F.id), { json: { body: 'um a mais' } }); assert.equal(r.status, 409);
    const first = (await env.sys((tx) => tx`select id from app.comments where presentation_id = ${F.id} limit 1`))[0].id;
    await env.del(OWNER, `/api/comments/${first}`);
    assert.equal((await env.post(OTHER, base(F.id), { json: { body: 'agora cabe' } })).status, 201);
  });
});

describe('matriz de permissões: editar texto × resolver × apagar', () => {
  // quem → [editar o texto, resolver/reabrir, apagar]
  const matrix = { autor: [200, 200, 204], 'dono da apresentação': [403, 200, 204], admin: [403, 200, 204], 'outro membro': [403, 403, 403] };
  for (const [quem, [edit, resolve, del]] of Object.entries(matrix)) {
    test(`${quem}: editar texto ${edit}, resolver ${resolve}, apagar ${del}`, async () => {
      const who = { autor: AUTHOR, 'dono da apresentação': OWNER, admin: ADM, 'outro membro': OTHER }[quem];
      const c = await mk(AUTHOR, 'texto original');
      const e = await env.patch(who, `/api/comments/${c.id}`, { json: { body: 'texto novo' } }); assert.equal(e.status, edit, e.text);
      if (edit === 200) { assert.equal(e.json.body, 'texto novo'); assert.ok(e.json.editedAt); assert.equal((await dbRow(c.id)).body, 'texto novo'); }
      else { assert.equal((await dbRow(c.id)).body, 'texto original'); assert.equal((await dbRow(c.id)).edited_at, null); }
      const r = await env.patch(who, `/api/comments/${c.id}`, { json: { resolved: true } }); assert.equal(r.status, resolve, r.text);
      if (resolve === 200) { assert.ok(r.json.resolvedAt); assert.equal((await dbRow(c.id)).resolved_by, who.id); const re = await env.patch(who, `/api/comments/${c.id}`, { json: { resolved: false } }); assert.equal(re.json.resolvedAt, null); assert.equal((await dbRow(c.id)).resolved_by, null); }
      else assert.equal((await dbRow(c.id)).resolved_at, null);
      const d = await env.del(who, `/api/comments/${c.id}`); assert.equal(d.status, del);
      if (del === 204) { assert.ok((await dbRow(c.id)).deleted_at, 'exclusão LÓGICA: a linha fica'); assert.equal((await dbRow(c.id)).body, e.status === 200 ? 'texto novo' : 'texto original'); assert.equal((await env.del(who, `/api/comments/${c.id}`)).status, 404, 'já apagado'); }
      else assert.equal((await dbRow(c.id)).deleted_at, null);
    });
  }
  test('resolver duas vezes não muda o instante; reabrir limpa; PATCH com texto igual não marca como editado', async () => {
    const c = await mk(AUTHOR, 'idempotência');
    const r1 = await env.patch(OWNER, `/api/comments/${c.id}`, { json: { resolved: true } }); const r2 = await env.patch(AUTHOR, `/api/comments/${c.id}`, { json: { resolved: true } });
    assert.equal(r1.json.resolvedAt, r2.json.resolvedAt); assert.equal((await dbRow(c.id)).resolved_by, OWNER.id);
    const same = await env.patch(AUTHOR, `/api/comments/${c.id}`, { json: { body: 'idempotência' } }); assert.equal(same.status, 200); assert.equal(same.json.editedAt, null);
    const both = await env.patch(AUTHOR, `/api/comments/${c.id}`, { json: { body: 'novo texto', resolved: false } }); assert.equal(both.status, 200); assert.equal(both.json.resolvedAt, null); assert.equal(both.json.body, 'novo texto');
  });
  test('PATCH inválido: vazio, campos desconhecidos (autor, presentationId), texto fora dos limites → 400 e nada muda', async () => {
    const c = await mk(AUTHOR, 'intacto');
    for (const bad of [{}, { authorId: OTHER.id }, { presentationId: P.id }, { body: '' }, { body: 'a'.repeat(2001) }, { resolved: 'sim' }, { deleted: true }, { body: 'x\u0000' }]) {
      assert.equal((await env.patch(AUTHOR, `/api/comments/${c.id}`, { json: bad })).status, 400, JSON.stringify(bad));
    }
    const db = await dbRow(c.id); assert.equal(db.body, 'intacto'); assert.equal(db.author_id, AUTHOR.id); assert.equal(db.deleted_at, null);
  });
  test('o dono perde o poder de moderar quando a apresentação é transferida; o novo dono ganha', async () => {
    const Q = await env.create(OWNER, 'Transferida', deck('T')); const c = await mk(AUTHOR, 'moderável', {}, Q.id);
    await env.post(ADM, `/api/presentations/${Q.id}/transfer`, { json: { toUserId: OTHER.id } });
    assert.equal((await env.patch(OWNER, `/api/comments/${c.id}`, { json: { resolved: true } })).status, 403, 'a antiga dona não modera mais');
    assert.equal((await env.patch(OTHER, `/api/comments/${c.id}`, { json: { resolved: true } })).status, 200, 'o novo dono modera');
  });
});

describe('auditoria e limite de taxa', () => {
  test('comment.create / comment.delete: autor certo, ids e tamanhos — nunca o texto', async () => {
    const SECRET = 'TEXTO-CONFIDENCIAL-7731';
    const c = await mk(AUTHOR, SECRET + ' detalhes do cliente'); await env.del(OWNER, `/api/comments/${c.id}`);
    const rows = await env.sys((tx) => tx`select actor_id, action, entity_id, meta from app.audit_log where entity_id = ${c.id} order by id`);
    assert.deepEqual(rows.map((r) => [r.action, r.actor_id]), [['comment.create', AUTHOR.id], ['comment.delete', OWNER.id]]);
    assert.equal(rows[0].meta.presentationId, P.id); assert.ok(rows[0].meta.length > 10); assert.equal(rows[1].meta.byAuthor, false);
    assert.ok(!JSON.stringify(rows).includes(SECRET));
  });
  test('limite de comentários: 30/min por usuário → 429 com Retry-After; outro usuário segue livre', async () => {
    const left = 60000 - (Date.now() % 60000); if (left < 10000) await new Promise((r) => setTimeout(r, left + 200));
    await env.resetRates();
    const U = await env.mkUser({ name: 'Tagarela' }), V = await env.mkUser({ name: 'Quieto' }); let last;
    for (let i = 0; i < 30; i++) last = await env.post(U, base(), { json: { body: 'spam ' + i }, ip: '198.51.100.55' });
    assert.equal(last.status, 201);
    const over = await env.post(U, base(), { json: { body: 'spam 31' }, ip: '198.51.100.55' });
    assert.equal(over.status, 429); assert.equal(over.json.error.code, 'rate_limited'); assert.ok(Number(over.headers.get('retry-after')) > 0);
    assert.equal((await env.post(V, base(), { json: { body: 'oi' } })).status, 201);
    assert.equal((await env.get(U, base())).status, 200, 'ler tem outro balde');
    await env.resetRates();
  });
});
