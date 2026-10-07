/* Apresentações: visibilidade/edição (membro × dono × admin), cópia isolada, lixeira/restore/purge, transferência, listagem paginada,
   entrada maliciosa, auditoria sem conteúdo e limites. Banco Postgres real (RLS) + rotas reais (mini-app). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, deck, png, asset } from '../helpers/mini-app.js';
import postgres from 'postgres';
import { contentHash } from '../../src/lib/canonical.js';
import { ADMIN_URL } from '../db/helpers.js';

let env, A, B, C, ADM, SUSP;
before(async () => {
  env = await makeEnv();
  A = await env.mkUser({ name: 'Ana' }); B = await env.mkUser({ name: 'Bruno' }); C = await env.mkUser({ name: 'Carla' });
  ADM = await env.mkUser({ role: 'admin', name: 'Admin' }); SUSP = await env.mkUser({ status: 'suspended', name: 'Suspenso' });
});
after(async () => { await env.stop(); });
const audits = (action, id) => env.sys((tx) => tx`select actor_id, action, entity_type, entity_id, meta, host(ip) as ip from app.audit_log where action = ${action} and entity_id = ${id} order by id`);
const row = async (id) => (await env.sys((tx) => tx`select * from app.presentations where id = ${id}`))[0];

describe('criar e abrir', () => {
  test('cria em branco (201): dono = quem criou, rev 1, 1 slide, sem versão inicial; Location e meta completos', async () => {
    const r = await env.post(A, '/api/presentations', { json: {} });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.rev, 1); assert.equal(r.json.owner.id, A.id); assert.equal(r.json.owner.displayName, 'Ana'); assert.equal(r.json.slideCount, 1);
    assert.equal(r.json.deleted, false); assert.equal(r.json.canEdit, true); assert.equal(r.headers.get('location'), `/api/presentations/${r.json.id}`);
    const [{ n }] = await env.sys((tx) => tx`select count(*)::int n from app.presentation_versions where presentation_id = ${r.json.id}`); assert.equal(n, 0);
  });
  test('cria com título e conteúdo: título/slide_count/hash vêm do servidor; conteúdo e título do deck ficam consistentes', async () => {
    const content = deck('Ignorado', { slides: 3 });
    const r = await env.post(A, '/api/presentations', { json: { title: '  Plano  de   Negócios \n', content } });
    assert.equal(r.status, 201, r.text); assert.equal(r.json.title, 'Plano de Negócios'); assert.equal(r.json.slideCount, 3);
    const p = await row(r.json.id);
    assert.equal(p.content.title, 'Plano de Negócios'); assert.equal(p.content_hash, contentHash(p.content));
    assert.equal(p.owner_id, A.id); assert.equal(p.updated_by, A.id);
  });
  test('importação cria a versão "import" (nº 1)', async () => {
    const r = await env.post(A, '/api/presentations', { json: { source: 'import', content: deck('Importada', { slides: 2 }) } });
    assert.equal(r.status, 201);
    const v = await env.sys((tx) => tx`select version_no, kind from app.presentation_versions where presentation_id = ${r.json.id}`);
    assert.deepEqual(v.map((x) => [x.version_no, x.kind]), [[1, 'import']]);
    assert.equal((await env.post(A, '/api/presentations', { json: { source: 'import' } })).status, 400, 'importar sem conteúdo');
  });
  test('o cliente não escolhe o dono nem campos de sistema (corpo estrito)', async () => {
    for (const extra of [{ ownerId: B.id }, { owner_id: B.id }, { rev: 99 }, { role: 'admin' }, { deleted: true }]) {
      const r = await env.post(A, '/api/presentations', { json: { title: 'x', ...extra } });
      assert.equal(r.status, 400, JSON.stringify(extra)); assert.equal(r.json.error.code, 'invalid_request');
    }
  });
  test('abrir: dono e admin têm canEdit; outro membro vê (acervo) com canEdit=false; ETag = "<rev>"', async () => {
    const p = await env.create(A, 'Do acervo', deck('Do acervo'));
    const own = await env.get(A, `/api/presentations/${p.id}`); assert.equal(own.status, 200);
    assert.equal(own.json.canEdit, true); assert.equal(own.headers.get('etag'), `"${p.rev}"`); assert.equal(own.json.content.slides.length, 1);
    const other = await env.get(B, `/api/presentations/${p.id}`); assert.equal(other.status, 200); assert.equal(other.json.canEdit, false); assert.equal(other.json.owner.displayName, 'Ana');
    const adm = await env.get(ADM, `/api/presentations/${p.id}`); assert.equal(adm.json.canEdit, true);
  });
  test('não autenticado = 401; suspenso = 403; id que não é UUID ou não existe = 404', async () => {
    const p = await env.create(A, 'X');
    assert.equal((await env.get(null, `/api/presentations/${p.id}`)).status, 401);
    assert.equal((await env.get(null, '/api/presentations')).status, 401);
    assert.equal((await env.post(null, '/api/presentations', { json: {} })).status, 401);
    const s = await env.get(SUSP, `/api/presentations/${p.id}`); assert.equal(s.status, 403); assert.equal(s.json.error.code, 'suspended');
    assert.equal((await env.get(A, '/api/presentations/nao-e-uuid')).status, 404);
    assert.equal((await env.get(A, '/api/presentations/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await env.get(A, `/api/presentations/${p.id.toUpperCase()}`)).status, 200, 'UUID em maiúsculas é o mesmo id');
  });
});

describe('regra do produto: todos veem, só o dono/admin altera', () => {
  let P, T;
  before(async () => { P = await env.create(A, 'Proposta da Ana', deck('Proposta da Ana')); T = await env.create(A, 'Na lixeira', deck('Na lixeira')); await env.del(A, `/api/presentations/${T.id}`); });
  test('outro membro NÃO salva, NÃO renomeia, NÃO exclui, NÃO restaura (403) — e nada muda no banco', async () => {
    const before_ = await row(P.id);
    const put = await env.put(B, `/api/presentations/${P.id}/content`, { json: { baseRev: P.rev, content: deck('sequestrada', { text: 'hack' }) } });
    assert.equal(put.status, 403); assert.equal(put.json.error.code, 'forbidden');
    assert.equal((await env.patch(B, `/api/presentations/${P.id}`, { json: { title: 'sequestrada' } })).status, 403);
    assert.equal((await env.del(B, `/api/presentations/${P.id}`)).status, 403);
    assert.equal((await env.post(B, `/api/presentations/${P.id}/restore`)).status, 403);
    assert.equal((await env.post(B, `/api/presentations/${P.id}/versions/1/restore`, { json: { baseRev: 1 } })).status, 403);
    const after_ = await row(P.id);
    assert.equal(after_.rev, before_.rev); assert.equal(after_.title, 'Proposta da Ana'); assert.equal(after_.deleted_at, null); assert.deepEqual(after_.content, before_.content);
  });
  test('"visível mas sem permissão" é 403; "invisível" é 404 (a lixeira dos outros não existe para ninguém além do dono/admin)', async () => {
    for (const [m, p, body] of [['GET', `/api/presentations/${T.id}`], ['PUT', `/api/presentations/${T.id}/content`, { baseRev: 1, content: deck('x') }], ['PATCH', `/api/presentations/${T.id}`, { title: 'x' }],
      ['DELETE', `/api/presentations/${T.id}`], ['POST', `/api/presentations/${T.id}/restore`], ['POST', `/api/presentations/${T.id}/duplicate`, {}], ['GET', `/api/presentations/${T.id}/versions`],
      ['GET', `/api/presentations/${T.id}/share`], ['GET', `/api/presentations/${T.id}/comments`], ['GET', `/api/presentations/${T.id}/interactions`]]) {
      const r = await env.request(B, m, p, { json: body }); assert.equal(r.status, 404, `${m} ${p} → ${r.status}`); assert.equal(r.json.error.code, 'not_found');
    }
    assert.equal((await env.get(A, `/api/presentations/${T.id}`)).status, 200, 'o dono ainda enxerga a própria lixeira');
    assert.equal((await env.get(ADM, `/api/presentations/${T.id}`)).status, 200, 'o admin também');
  });
  test('o admin modera: edita, renomeia, exclui e restaura a apresentação de qualquer um', async () => {
    const x = await env.create(A, 'Para moderar', deck('Para moderar'));
    const put = await env.put(ADM, `/api/presentations/${x.id}/content`, { json: { baseRev: x.rev, content: deck('Moderada', { text: 'ajuste do admin' }) } });
    assert.equal(put.status, 200, put.text);
    assert.equal((await row(x.id)).updated_by, ADM.id); assert.equal((await row(x.id)).owner_id, A.id, 'o dono continua sendo a Ana');
    assert.equal((await env.patch(ADM, `/api/presentations/${x.id}`, { json: { title: 'Renomeada pelo admin' } })).status, 200);
    assert.equal((await env.del(ADM, `/api/presentations/${x.id}`)).status, 204);
    assert.equal((await env.post(ADM, `/api/presentations/${x.id}/restore`)).status, 200);
  });
  test('IDOR: o :id da URL é a única fonte — trocar o dono no corpo, ou usar o id de outro, não dá poder', async () => {
    const forged = await env.put(B, `/api/presentations/${P.id}/content`, { json: { baseRev: 1, content: deck('x'), ownerId: B.id } });
    assert.equal(forged.status, 400, 'campo desconhecido é recusado antes de qualquer coisa');
    const mine = await env.create(B, 'Do Bruno', deck('Do Bruno'));
    const r = await env.put(B, `/api/presentations/${P.id}/content`, { json: { baseRev: mine.rev, content: deck('x', { text: 'misturado' }) } });
    assert.equal(r.status, 403);
    assert.equal((await row(mine.id)).rev, 1);
  });
});

describe('cópia: usar a apresentação de outra pessoa', () => {
  test('duplicar cria a SUA cópia (dono = quem copiou, source_id, versão "copy", rev 1) e não toca o original', async () => {
    const img = await png(11); const sha = await env.upload(A, img);
    const orig = await env.create(A, 'Original', deck('Original', { slides: 2, images: [sha] }));
    const snapshot = await row(orig.id);
    const r = await env.post(B, `/api/presentations/${orig.id}/duplicate`, { json: {} });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.title, 'Cópia de Original'); assert.equal(r.json.owner.id, B.id); assert.equal(r.json.sourceId, orig.id); assert.equal(r.json.rev, 1); assert.equal(r.json.canEdit, true);
    const copy = await row(r.json.id);
    assert.equal(copy.content.title, 'Cópia de Original'); assert.equal(copy.content.slides.length, 2); assert.equal(copy.content_hash, contentHash(copy.content));
    const v = await env.sys((tx) => tx`select version_no, kind from app.presentation_versions where presentation_id = ${copy.id}`); assert.deepEqual(v.map((x) => [x.version_no, x.kind]), [[1, 'copy']]);
    const refs = await env.sys((tx) => tx`select version_no, sha256 from app.asset_refs where presentation_id = ${copy.id} order by version_no`);
    assert.deepEqual(refs.map((x) => [x.version_no, x.sha256]), [[0, sha], [1, sha]], 'a cópia usa o mesmo arquivo (um só objeto no armazenamento)');
    const afterOrig = await row(orig.id);
    assert.equal(afterOrig.rev, snapshot.rev); assert.deepEqual(afterOrig.content, snapshot.content); assert.equal(afterOrig.owner_id, A.id); assert.equal(afterOrig.title, 'Original');
    assert.equal((await audits('presentation.duplicate', copy.id)).length, 1);
  });
  test('alterar a cópia não toca o original — e alterar o original não toca a cópia', async () => {
    const orig = await env.create(A, 'Base', deck('Base', { text: 'base' }));
    const copy = (await env.post(B, `/api/presentations/${orig.id}/duplicate`, { json: { title: 'Minha versão' } })).json;
    assert.equal(copy.title, 'Minha versão');
    const o0 = await row(orig.id), c0 = await row(copy.id);
    const putCopy = await env.put(B, `/api/presentations/${copy.id}/content`, { json: { baseRev: copy.rev, content: deck('Minha versão', { text: 'editado pelo Bruno' }) } });
    assert.equal(putCopy.status, 200);
    assert.deepEqual((await row(orig.id)).content, o0.content); assert.equal((await row(orig.id)).rev, o0.rev);
    const putOrig = await env.put(A, `/api/presentations/${orig.id}/content`, { json: { baseRev: orig.rev, content: deck('Base', { text: 'editado pela Ana' }) } });
    assert.equal(putOrig.status, 200);
    const c1 = await row(copy.id);
    assert.equal(c1.content.slides[0].els[0].html, 'editado pelo Bruno 0'); assert.notDeepEqual(c1.content, c0.content);
    assert.equal((await env.put(A, `/api/presentations/${copy.id}/content`, { json: { baseRev: 2, content: deck('x') } })).status, 403, 'a Ana não altera a cópia do Bruno');
  });
  test('qualquer usuário copia qualquer apresentação visível; da lixeira alheia (invisível) não', async () => {
    const orig = await env.create(A, 'Aberta', deck('Aberta'));
    assert.equal((await env.post(C, `/api/presentations/${orig.id}/duplicate`, { json: {} })).status, 201);
    assert.equal((await env.post(ADM, `/api/presentations/${orig.id}/duplicate`, { json: {} })).status, 201);
    await env.del(A, `/api/presentations/${orig.id}`);
    assert.equal((await env.post(C, `/api/presentations/${orig.id}/duplicate`, { json: {} })).status, 404);
    assert.equal((await env.post(A, `/api/presentations/${orig.id}/duplicate`, { json: {} })).status, 201, 'o dono copia a própria lixeira');
  });
  test('título da cópia é limitado a 200 caracteres', async () => {
    const orig = await env.create(A, 'Z'.repeat(200), deck('Z'.repeat(200)));
    const r = await env.post(B, `/api/presentations/${orig.id}/duplicate`, { json: {} });
    assert.equal(r.status, 201); assert.ok(Array.from(r.json.title).length <= 200); assert.ok(r.json.title.startsWith('Cópia de Z'));
  });
});

describe('lixeira, restauração, apagar de vez e transferência', () => {
  test('excluir move para a lixeira (reversível); some do acervo dos outros, aparece em scope=trash do dono e do admin', async () => {
    const p = await env.create(A, 'Vai para a lixeira', deck('Vai'));
    assert.equal((await env.del(A, `/api/presentations/${p.id}`)).status, 204);
    assert.equal((await env.del(A, `/api/presentations/${p.id}`)).status, 204, 'idempotente');
    const row_ = await row(p.id); assert.ok(row_.deleted_at); assert.equal(row_.deleted_by, A.id);
    const ids = (r) => r.json.items.map((i) => i.id);
    assert.ok(!ids(await env.get(B, '/api/presentations?scope=all&limit=100')).includes(p.id));
    assert.ok(!ids(await env.get(A, '/api/presentations?scope=all&limit=100')).includes(p.id), 'nem o dono a vê no acervo');
    assert.ok(ids(await env.get(A, '/api/presentations?scope=trash&limit=100')).includes(p.id));
    assert.ok(ids(await env.get(ADM, '/api/presentations?scope=trash&limit=100')).includes(p.id));
    assert.ok(!ids(await env.get(B, '/api/presentations?scope=trash&limit=100')).includes(p.id));
    const item = (await env.get(A, '/api/presentations?scope=trash&limit=100')).json.items.find((i) => i.id === p.id); assert.equal(item.deleted, true);
    assert.equal((await audits('presentation.delete', p.id)).length, 1, 'auditado uma vez (a 2ª exclusão é no-op)');
  });
  test('salvar numa apresentação da lixeira é recusado (409 in_trash) até restaurar', async () => {
    const p = await env.create(A, 'Lixo', deck('Lixo')); await env.del(A, `/api/presentations/${p.id}`);
    const r = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: deck('Lixo', { text: 'x' }) } });
    assert.equal(r.status, 409); assert.equal(r.json.error.code, 'in_trash');
    const back = await env.post(A, `/api/presentations/${p.id}/restore`); assert.equal(back.status, 200); assert.equal(back.json.deleted, false);
    assert.equal((await env.post(A, `/api/presentations/${p.id}/restore`)).status, 200, 'restaurar o que não está na lixeira é no-op');
    assert.equal((await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: deck('Lixo', { text: 'x' }) } })).status, 200);
    assert.equal((await audits('presentation.restore', p.id)).length, 1);
  });
  test('apagar de vez: só admin, só se já estiver na lixeira; dono comum não (403) — e tudo some em cascata', async () => {
    const sha = await env.upload(A, await png(21));
    const p = await env.create(A, 'Para purgar', deck('Para purgar', { images: [sha] }));
    await env.post(B, `/api/presentations/${p.id}/duplicate`, { json: {} });
    const q = `/api/presentations/${p.id}?purge=1`;
    assert.equal((await env.del(A, q)).status, 403, 'dono comum não apaga de vez');
    assert.equal((await env.del(B, q)).status, 403);
    const notTrashed = await env.del(ADM, q); assert.equal(notTrashed.status, 409, 'ainda não está na lixeira'); assert.ok(await row(p.id));
    await env.del(A, `/api/presentations/${p.id}`);
    assert.equal((await env.del(A, q)).status, 403, 'mesmo na lixeira, o dono não purga');
    assert.ok(await row(p.id));
    assert.equal((await env.del(ADM, q)).status, 204);
    assert.equal(await row(p.id), undefined);
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.asset_refs where presentation_id = ${p.id}`))[0].n, 0);
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.presentations where source_id = ${p.id}`))[0].n, 0, 'cópias ficam (source_id vira nulo)');
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.presentations where title = 'Cópia de Para purgar'`))[0].n, 1);
    assert.equal((await audits('presentation.purge', p.id)).length, 1);
    assert.equal((await env.del(ADM, `/api/presentations/${p.id}?purge=talvez`)).status, 400);
  });
  test('transferir: só admin; o novo dono passa a editar e o antigo perde o poder; destino inexistente/suspenso/convidado → 404', async () => {
    const p = await env.create(A, 'Transferível', deck('Transferível'));
    assert.equal((await env.post(A, `/api/presentations/${p.id}/transfer`, { json: { toUserId: B.id } })).status, 403, 'nem o dono transfere');
    assert.equal((await env.post(B, `/api/presentations/${p.id}/transfer`, { json: { toUserId: B.id } })).status, 403, 'nem se auto-atribui');
    assert.equal((await row(p.id)).owner_id, A.id);
    const ok = await env.post(ADM, `/api/presentations/${p.id}/transfer`, { json: { toUserId: B.id } });
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.owner.id, B.id);
    assert.equal((await env.put(B, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: deck('Transferível', { text: 'do Bruno' }) } })).status, 200);
    assert.equal((await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 2, content: deck('x') } })).status, 403);
    assert.equal((await env.post(ADM, `/api/presentations/${p.id}/transfer`, { json: { toUserId: SUSP.id } })).status, 404);
    assert.equal((await env.post(ADM, `/api/presentations/${p.id}/transfer`, { json: { toUserId: '00000000-0000-4000-8000-000000000000' } })).status, 404);
    assert.equal((await env.post(ADM, `/api/presentations/${p.id}/transfer`, { json: { toUserId: 'x' } })).status, 400);
    const a = await audits('presentation.transfer', p.id); assert.equal(a.length, 1); assert.deepEqual([a[0].meta.from, a[0].meta.to], [A.id, B.id]);
  });
  test('renomear altera a coluna e o título dentro do conteúdo (rev+1, hash coerente); título vazio/gigante é tratado', async () => {
    const p = await env.create(A, 'Antes', deck('Antes'));
    const r = await env.patch(A, `/api/presentations/${p.id}`, { json: { title: ' Depois\u0000‮  novo ' } });
    assert.equal(r.status, 200); assert.equal(r.json.title, 'Depois novo'); assert.equal(r.json.rev, 2);
    const db = await row(p.id); assert.equal(db.content.title, 'Depois novo'); assert.equal(db.content_hash, contentHash(db.content));
    assert.equal((await env.patch(A, `/api/presentations/${p.id}`, { json: { title: '   ' } })).status, 400);
    assert.equal((await env.patch(A, `/api/presentations/${p.id}`, { json: { title: 'x'.repeat(401) } })).status, 400);
    assert.equal((await env.patch(A, `/api/presentations/${p.id}`, { json: { title: 'ok', rev: 5 } })).status, 400);
    const long = await env.patch(A, `/api/presentations/${p.id}`, { json: { title: 'L'.repeat(300) } }); assert.equal(long.status, 200); assert.equal(Array.from(long.json.title).length, 200);
    assert.equal((await audits('presentation.rename', p.id)).length, 2);
  });
  test('compartilhar: link interno do acervo para quem vê; auditado; invisível = 404', async () => {
    const p = await env.create(A, 'Link', deck('Link'));
    const r = await env.get(B, `/api/presentations/${p.id}/share`);
    assert.equal(r.status, 200); assert.equal(r.json.url, `${env.config.origin}/visualizar/${p.id}`); assert.equal(r.json.visibility, 'acervo');
    const a = await audits('presentation.share', p.id); assert.equal(a.length, 1); assert.equal(a[0].actor_id, B.id);
  });
});

describe('listagem: filtros, paginação estável e plano de consulta', () => {
  let L1, L2, ids;
  before(async () => {
    await env.resetRates();
    L1 = await env.mkUser({ name: 'Lista Um' }); L2 = await env.mkUser({ name: 'Lista Dois' });
    // 25 linhas com o MESMO updated_at (mesma transação): só o desempate por id garante paginação estável
    ids = await env.sys(async (tx) => {
      const out = [];
      for (let i = 0; i < 25; i++) {
        const [p] = await tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count) values (${i % 5 === 0 ? L2.id : L1.id}, ${'Lote ' + String(i).padStart(2, '0') + (i === 3 ? ' 100% real_ok' : '')}, ${tx.json({ v: 1, slides: [] })}, ${'a'.repeat(64)}, 0) returning id`;
        out.push(p.id);
      }
      return out;
    });
  });
  const walk = async (user, qs, limit) => {
    const seen = []; let cursor = null, pages = 0;
    do {
      const r = await env.get(user, `/api/presentations?${qs}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(r.status, 200, r.text); seen.push(...r.json.items.map((i) => i.id)); cursor = r.json.nextCursor; pages++;
      assert.ok(pages < 100, 'paginação em laço');
    } while (cursor);
    return { seen, pages };
  };
  test('percorre tudo em páginas de 4 sem repetir nem perder nenhum item (mesmo com updated_at idêntico)', async () => {
    const { seen, pages } = await walk(L1, 'scope=all&owner=' + L1.id, 4);
    assert.equal(new Set(seen).size, seen.length, 'sem duplicatas'); assert.equal(seen.length, 20); assert.equal(pages, 5);
    const mine = await walk(L1, 'scope=mine', 7); assert.equal(mine.seen.length, 20);
    for (const id of mine.seen) assert.ok(ids.includes(id));
  });
  test('ordenação: updated_at desc; itens mais novos primeiro; nunca devolve conteúdo', async () => {
    const x = await env.create(L1, 'Mais novo', deck('Mais novo'));
    const r = await env.get(L2, '/api/presentations?limit=5'); assert.equal(r.json.items[0].id, x.id);
    for (const it of r.json.items) { assert.equal(it.content, undefined); assert.deepEqual(Object.keys(it).sort(), ['createdAt', 'deleted', 'id', 'owner', 'rev', 'slideCount', 'sourceId', 'thumbSha', 'title', 'updatedAt'].sort()); }
    const times = r.json.items.map((i) => Date.parse(i.updatedAt)); assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });
  test('busca q com ILIKE e escape de % _ \\ (curinga literal, não coringa)', async () => {
    const lit = await env.get(L1, '/api/presentations?q=' + encodeURIComponent('100% real_ok'));
    assert.deepEqual(lit.json.items.map((i) => i.id), [ids[3]]);
    assert.equal((await env.get(L1, '/api/presentations?q=' + encodeURIComponent('%'))).json.items.length, 1, '% só casa com o título que tem %');
    assert.equal((await env.get(L1, '/api/presentations?q=' + encodeURIComponent('_'))).json.items.length, 1, '_ só casa com o título que tem _');
    assert.equal((await env.get(L1, '/api/presentations?q=' + encodeURIComponent('\\'))).json.items.length, 0);
    assert.equal((await env.get(L1, '/api/presentations?q=lote 0')).json.items.length, 10, 'case-insensitive');
    const evil = await env.get(L1, '/api/presentations?q=' + encodeURIComponent("x'); drop table app.users; --")); assert.equal(evil.status, 200); assert.equal(evil.json.items.length, 0);
    assert.equal((await env.get(L1, '/api/presentations?q=' + 'a'.repeat(101))).status, 400);
  });
  test('filtro por dono (com nome do dono vindo do diretório) e validação dos parâmetros', async () => {
    const r = await env.get(L1, `/api/presentations?owner=${L2.id}&limit=100`);
    assert.equal(r.json.items.length, 5); assert.ok(r.json.items.every((i) => i.owner.id === L2.id && i.owner.displayName === 'Lista Dois'));
    for (const bad of ['limit=0', 'limit=101', 'limit=abc', 'scope=tudo', 'owner=nao-uuid']) assert.equal((await env.get(L1, '/api/presentations?' + bad)).status, 400, bad);
  });
  test('cursor adulterado, de outro filtro, de outro usuário ou lixo → 400 (assinado)', async () => {
    const r = await env.get(L1, '/api/presentations?scope=all&limit=2'); const cur = r.json.nextCursor; assert.ok(cur);
    assert.equal((await env.get(L1, `/api/presentations?scope=all&limit=2&cursor=${encodeURIComponent(cur)}`)).status, 200);
    const [body, sig] = cur.split('.');
    const forgedBody = Buffer.from(JSON.stringify(['2000-01-01T00:00:00.000000Z', ids[0]])).toString('base64url');
    for (const bad of [`${forgedBody}.${sig}`, `${body}.${sig.slice(0, -2)}AA`, body, `${body}.`, '.', 'xx', 'a.b.c', cur + 'x', '%00', 'e30.e30', 'x'.repeat(600)]) {
      const e = await env.get(L1, `/api/presentations?scope=all&limit=2&cursor=${encodeURIComponent(bad)}`); assert.equal(e.status, 400, bad.slice(0, 40)); assert.equal(e.json.error.code, 'invalid_request');
    }
    assert.equal((await env.get(L1, `/api/presentations?scope=mine&limit=2&cursor=${encodeURIComponent(cur)}`)).status, 400, 'outro escopo');
    assert.equal((await env.get(L1, `/api/presentations?scope=all&q=x&limit=2&cursor=${encodeURIComponent(cur)}`)).status, 400, 'outro filtro');
    assert.equal((await env.get(L2, `/api/presentations?scope=all&limit=2&cursor=${encodeURIComponent(cur)}`)).status, 400, 'outro usuário');
  });
  test('os índices do esquema são usados (EXPLAIN; o outro índice é removido DENTRO de uma transação descartada para provar que o certo atende)', async () => {
    const { listQuery } = await import('../../src/lib/presentations-service.js');
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    const plan = async (dropIdx, args) => {
      try {
        return await admin.begin(async (tx) => {
          if (dropIdx) await tx.unsafe(`drop index app.${dropIdx}`);
          await tx`set local role app_user`; await tx`select set_config('app.user_id', ${L1.id}, true)`;
          await tx`set local enable_seqscan = off`; await tx`set local enable_bitmapscan = off`;
          const rows = await tx`explain (format json) ${listQuery(tx, L1.id, args)}`;
          const text = JSON.stringify(rows[0]['QUERY PLAN']);
          await tx.unsafe('select 1 from app.presentations limit 0');
          throw Object.assign(new Error('rollback'), { plan: text });      // desfaz o DROP INDEX
        });
      } catch (e) { if (e.plan) return e.plan; throw e; }
    };
    try {
      const all = await plan(null, { scope: 'all', limit: 30 });
      assert.match(all, /presentations_updated_idx/, 'scope=all usa (updated_at desc, id) parcial'); assert.doesNotMatch(all, /"Node Type":"Sort"/, 'a ordem vem do índice, sem Sort');
      const next = await plan(null, { scope: 'all', limit: 30, after: { ts: '2026-01-01T00:00:00.000000Z', id: ids[0] } }); assert.match(next, /presentations_updated_idx/, 'a página seguinte também');
      const mine = await plan('presentations_updated_idx', { scope: 'mine', limit: 30 }); assert.match(mine, /presentations_owner_idx/, 'scope=mine é atendido por (owner_id, updated_at desc)');
      const own = await plan('presentations_updated_idx', { scope: 'all', owner: L1.id, limit: 30 }); assert.match(own, /presentations_owner_idx/, 'filtro por dono também');
    } finally { await admin.end(); }
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from pg_indexes where schemaname = 'app' and indexname in ('presentations_updated_idx','presentations_owner_idx')`))[0].n, 2, 'nenhum índice foi perdido');
  });
});

describe('entrada maliciosa e limites', () => {
  test('deck com HTML ativo → 422 e NADA é gravado (linha, versões, referências); a rejeição é auditada sem o conteúdo', async () => {
    const p = await env.create(A, 'Alvo', deck('Alvo', { text: 'limpo' }));
    const before_ = await row(p.id);
    const evil = deck('Alvo', { text: 'x' }); evil.slides[0].els[0].html = '<img src=x onerror="alert(1)"><script>fetch("//evil")</script>SEGREDO-NAO-VAZAR';
    const r = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: evil, snapshot: true } });
    assert.equal(r.status, 422); assert.equal(r.json.error.code, 'rejected_content'); assert.ok(r.json.error.details.reasons.length);
    const after_ = await row(p.id);
    assert.equal(after_.rev, before_.rev); assert.deepEqual(after_.content, before_.content); assert.equal(after_.snap_seq, 0);
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.presentation_versions where presentation_id = ${p.id}`))[0].n, 0);
    const a = await audits('security.rejected_content', p.id); assert.equal(a.length, 1); assert.ok(a[0].meta.reasons.length);
    assert.ok(!JSON.stringify(a).includes('SEGREDO-NAO-VAZAR') && !JSON.stringify(a).includes('onerror'));
    const c = await env.post(A, '/api/presentations', { json: { content: evil } }); assert.equal(c.status, 422);
    const d = await env.post(B, `/api/presentations/${p.id}/duplicate`, { json: {} }); assert.equal(d.status, 201, 'duplicar o conteúdo já limpo segue funcionando');
  });
  test('BE-ED-09: 422 rejected_content traz details.issues [{slide (1-based), elementId, reason}] — salvar e criar — sem ecoar o conteúdo', async () => {
    const p = await env.create(A, 'Onde', deck('Onde', { slides: 3 }));
    const evil = deck('Onde', { slides: 3 }); evil.slides[2].els[0].html = '<script>SEGREDO-ISSUES</script>'; evil.slides[1].notes = 'javascript:alert(1)';
    const r = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: evil } });
    assert.equal(r.status, 422); assert.equal(r.json.error.code, 'rejected_content');
    assert.deepEqual(r.json.error.details.issues, [{ slide: 2, elementId: null, reason: 'url_perigosa' }, { slide: 3, elementId: 't2', reason: 'tag_perigosa' }]);
    assert.ok(!r.text.includes('SEGREDO-ISSUES') && !r.text.includes('alert('), 'nem o texto recusado nem o trecho voltam');
    const c = await env.post(A, '/api/presentations', { json: { content: evil } }); assert.equal(c.status, 422); assert.deepEqual(c.json.error.details.issues, r.json.error.details.issues);
    const many = deck('Muitos', { slides: 30 }); many.slides.forEach((s) => { s.els[0].html = '<iframe src=//x>'; });
    const m = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: many } }); assert.equal(m.status, 422); assert.equal(m.json.error.details.issues.length, 20, 'no máximo 20');
    assert.equal((await row(p.id)).rev, p.rev, 'nada gravado');
  });
  test('BE-ED-09: texto digitado citando tags (como o editor guarda) salva; o mesmo HTML literal é recusado com a localização', async () => {
    const p = await env.create(A, 'Tags', deck('Tags'));
    const ok = deck('Tags', { slides: 2 }); ok.slides[1].els[0].html = 'use a tag &lt;form&gt; para formulários; &lt;b&gt; para negrito; if (a &lt; b &amp;&amp; c &gt; d)';
    const r = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: ok } }); assert.equal(r.status, 200, r.text);
    const lit = deck('Tags', { slides: 2 }); lit.slides[1].els[0].html = 'use a tag <form action="https://evil.example"> para formulários';
    const bad = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: r.json.rev, content: lit } });
    assert.equal(bad.status, 422); assert.deepEqual(bad.json.error.details.issues, [{ slide: 2, elementId: 't1', reason: 'tag_perigosa' }]);
  });
  test('BE-ED-09: caractere inválido e arquivo inexistente também apontam slide/elemento', async () => {
    const p = await env.create(A, 'Chars2', deck('Chars2', { slides: 2 }));
    const nul = deck('Chars2', { slides: 2 }); nul.slides[1].els[0].html = 'a\u0000b';
    const r = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: nul } });
    assert.equal(r.status, 422); assert.deepEqual(r.json.error.details.issues, [{ slide: 2, elementId: 't1', reason: 'caractere_invalido' }]);
    const ghost = 'e'.repeat(64); const g = deck('Chars2', { slides: 2 }); g.slides[1].els.push({ id: 'img9', type: 'image', src: asset(ghost) });
    const r2 = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: g } });
    assert.equal(r2.status, 422); assert.deepEqual(r2.json.error.details.reasons, ['asset_inexistente']); assert.deepEqual(r2.json.error.details.missing, [ghost]);
    assert.deepEqual(r2.json.error.details.issues, [{ slide: 2, elementId: 'img9', reason: 'asset_inexistente' }]);
    const c = await env.post(A, '/api/presentations', { json: { content: g } }); assert.deepEqual(c.json.error.details.issues, [{ slide: 2, elementId: 'img9', reason: 'asset_inexistente' }]);
    const th = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: deck('Chars2', { text: 'novo' }), thumbSha: 'f'.repeat(64) } });
    assert.equal(th.status, 422); assert.deepEqual(th.json.error.details.issues, [{ slide: null, elementId: null, reason: 'thumb_invalida' }]);
  });
  test('NUL e surrogate solto (o jsonb do Postgres não aceita) viram 422, nunca 500', async () => {
    const p = await env.create(A, 'Chars', deck('Chars'));
    for (const bad of ['a\u0000b', 'x\ud83dy', '\udc00']) {
      const dk = deck('Chars', { text: 'ok' }); dk.slides[0].els[0].html = bad;
      const r = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: dk } });
      assert.equal(r.status, 422, JSON.stringify(bad)); assert.deepEqual(r.json.error.details.reasons, ['caractere_invalido']);
    }
    const key = deck('Chars'); key.slides[0]['k\u0000'] = 1; assert.equal((await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: key } })).status, 422);
    const lit = deck('Chars', { text: 'ok' }); lit.slides[0].els[0].html = 'texto literal \\u0000 com barra'; // barra + "u0000" como TEXTO é válido
    assert.equal((await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: lit } })).status, 200);
    const emoji = deck('Chars', { text: 'ok' }); emoji.slides[0].els[0].html = 'par válido 😀 ok'; assert.equal((await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 2, content: emoji } })).status, 200);
  });
  test('corpo inválido: JSON quebrado, não-objeto, campos errados, baseRev inválido, imagem base64 grande → 400/422; corpo gigante → 413', async () => {
    const p = await env.create(A, 'Corpo', deck('Corpo'));
    const put = (json, extra = {}) => env.request(A, 'PUT', `/api/presentations/${p.id}/content`, { json, ...extra });
    assert.equal((await env.request(A, 'PUT', `/api/presentations/${p.id}/content`, { body: '{nope', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await env.request(A, 'PUT', `/api/presentations/${p.id}/content`, { body: '[1]', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await put({ baseRev: 1 })).status, 400, 'sem content');
    assert.equal((await put({ content: deck('x') })).status, 400, 'sem baseRev');
    for (const baseRev of [0, -1, 1.5, '1', null, 1e12]) assert.equal((await put({ baseRev, content: deck('x') })).status, 400, String(baseRev));
    assert.equal((await put({ baseRev: 1, content: [] })).status, 400); assert.equal((await put({ baseRev: 1, content: 'x' })).status, 400);
    assert.equal((await put({ baseRev: 1, content: { v: 1, title: 'sem slides' } })).status, 422, 'estrutura inválida');
    assert.equal((await put({ baseRev: 1, content: deck('x'), resolution: 'merge' })).status, 400);
    assert.equal((await put({ baseRev: 1, content: deck('x'), thumbSha: 'zz' })).status, 400);
    assert.equal((await put({ baseRev: 1, content: deck('x'), label: 'a\u0001b' })).status, 400);
    const big = deck('Big', { text: 'x' }); big.slides[0].els[0].src = 'data:image/png;base64,' + 'A'.repeat(200000);
    const r = await put({ baseRev: 1, content: big }); assert.equal(r.status, 422); assert.ok(r.json.error.details.reasons.includes('imagem_nao_externalizada'));
    const huge = await env.request(A, 'PUT', `/api/presentations/${p.id}/content`, { body: Buffer.alloc(14 * 1024 * 1024, 0x20), headers: { 'content-type': 'application/json' } });
    assert.equal(huge.status, 413); assert.equal(huge.json.error.code, 'too_large'); assert.match(huge.json.error.message, /limite de 13 MB por salvamento/, 'fora da Vercel o padrão é 13 MiB (PUB-08)');
    const lying = await env.request(A, 'PUT', `/api/presentations/${p.id}/content`, { body: '{}', headers: { 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) } });
    assert.equal(lying.status, 413, 'Content-Length declarado grande demais é barrado antes de ler');
    assert.equal((await row(p.id)).rev, 1);
  });
  test('deck grande (~9 MB, 400 slides): salva, lê de volta idêntico e o hash bate; acima de 12 MB → 422 (nunca 500)', async () => {
    const p = await env.create(A, 'Grande', deck('Grande'));
    const big = { v: 1, app: 'AM Studio', id: 'dgrande', title: 'Grande', slides: Array.from({ length: 400 }, (_, i) => ({ id: 's' + i, bg: '#FFF', els: Array.from({ length: 30 }, (_, j) => ({ id: `e${j}`, type: 'text', html: 'Texto de consultoria '.repeat(40) + i + '-' + j })) })) };
    const t0 = Date.now(); const r = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 1, content: big } });
    assert.equal(r.status, 200, r.text.slice(0, 200)); assert.ok(Date.now() - t0 < 8000, 'tempo de salvamento razoável');
    const g = await env.get(A, `/api/presentations/${p.id}`); assert.equal(g.status, 200); assert.equal(g.json.slideCount, 400); assert.equal(contentHash(g.json.content), r.json.hash, 'o que volta é exatamente o que foi salvo');
    const huge = JSON.parse(JSON.stringify(big)); const pad = Math.ceil((12.9e6 - Buffer.byteLength(JSON.stringify(big))) / 400);
    huge.slides.forEach((s) => { s.els[0].html += 'z'.repeat(pad); });          // entre 12 MiB (limite do conteúdo) e 13 MiB (limite do corpo)
    const over = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 2, content: huge } }); assert.equal(over.status, 422); assert.ok(over.json.error.details.reasons.includes('tamanho_excedido'));
  });
  test('respostas JSON de dados de usuários não vão para cache compartilhado', async () => {
    const p = await env.create(A, 'Cache', deck('Cache'));
    assert.equal((await env.get(A, '/api/presentations')).headers.get('cache-control'), 'no-store');
    assert.equal((await env.get(A, `/api/presentations/${p.id}`)).headers.get('cache-control'), 'private, no-cache');
    assert.equal((await env.get(A, `/api/presentations/${p.id}/comments`)).headers.get('cache-control'), 'no-store');
    assert.equal((await env.get(A, `/api/presentations/${p.id}/interactions`)).headers.get('cache-control'), 'no-store');
    assert.equal((await env.get(A, `/api/presentations/${p.id}/versions`)).headers.get('cache-control'), 'no-store');
  });
  test('texto malicioso vira dado: SQL no título/busca não executa; HTML ativo no título (criar, renomear, copiar) é barrado pelo lint', async () => {
    const sql = "'); drop table app.presentations; -- é \\ % _";
    const r = await env.post(A, '/api/presentations', { json: { title: sql, content: deck(sql) } });
    assert.equal(r.status, 201); assert.equal(r.json.title, sql, 'texto puro é guardado como está (a interface escapa)');
    assert.ok((await env.sys((tx) => tx`select count(*)::int n from app.presentations`))[0].n > 0);
    assert.equal((await env.get(A, '/api/presentations?q=' + encodeURIComponent('drop table'))).json.items.length, 1);
    const html = '<img src=x onerror=alert(1)>';
    assert.equal((await env.post(A, '/api/presentations', { json: { title: html } })).status, 422);
    assert.equal((await env.patch(A, `/api/presentations/${r.json.id}`, { json: { title: html } })).status, 422);
    assert.equal((await env.post(B, `/api/presentations/${r.json.id}/duplicate`, { json: { title: '<script>x</script>' } })).status, 422);
    assert.equal((await row(r.json.id)).title, sql, 'nada mudou');
    assert.equal((await env.patch(A, `/api/presentations/${r.json.id}`, { json: { title: 'Lucro < Custo > 0' } })).status, 200, 'sinais < e > em prosa continuam valendo');
  });
  test('limite de taxa de escrita: 120/min por usuário → 429 com Retry-After; leitura segue em outro balde; outro usuário não é afetado', async () => {
    await env.resetRates();
    // janela fixa por minuto: se faltar pouco para virar o minuto, espera a próxima janela (senão o teste ficaria instável)
    const left = 60000 - (Date.now() % 60000); if (left < 15000) await new Promise((r) => setTimeout(r, left + 200));
    await env.resetRates();
    const U = await env.mkUser({ name: 'Rajada' }), V = await env.mkUser({ name: 'Calmo' });
    const p = await env.create(U, 'Rajada', deck('Rajada'));          // 1ª escrita
    let last;
    for (let i = 0; i < 119; i++) { last = await env.put(U, `/api/presentations/${p.id}/content`, { json: { baseRev: 1, content: deck('Rajada') }, ip: '198.51.100.9' }); }
    assert.ok(last.status === 200 || last.status === 429);
    const over = await env.put(U, `/api/presentations/${p.id}/content`, { json: { baseRev: 1, content: deck('Rajada') } });
    assert.equal(over.status, 429, 'a 121ª escrita no minuto'); assert.equal(over.json.error.code, 'rate_limited'); assert.ok(Number(over.headers.get('retry-after')) > 0);
    assert.equal((await env.get(U, `/api/presentations/${p.id}`)).status, 200, 'leitura tem balde próprio');
    assert.equal((await env.post(V, '/api/presentations', { json: {} })).status, 201, 'outro usuário não é afetado');
    const [r] = await env.sys((tx) => tx`select count(*)::int n from app.audit_log where action = 'security.rate_limited'`); assert.ok(r.n >= 1);
    await env.resetRates();
  });
});

describe('auditoria: ações relevantes, sem conteúdo nem segredos', () => {
  test('cada ação gera 1 registro do autor certo, com ids/contagens/tamanhos — jamais o conteúdo dos slides', async () => {
    const SECRET = 'CONFIDENCIAL-CLIENTE-XPTO-9981';
    const p = await env.create(A, 'Auditada', deck('Auditada', { text: SECRET }));
    const put = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 1, content: deck('Auditada', { text: SECRET + ' v2' }), snapshot: true, label: 'Rótulo secreto ' + SECRET } });
    assert.equal(put.status, 200);
    await env.post(B, `/api/presentations/${p.id}/duplicate`, { json: {} }); await env.patch(A, `/api/presentations/${p.id}`, { json: { title: 'Nome ' + SECRET } });
    await env.del(A, `/api/presentations/${p.id}`); await env.post(A, `/api/presentations/${p.id}/restore`);
    const all = await env.sys((tx) => tx`select actor_id, action, entity_id, meta, host(ip) as ip, user_agent, request_id from app.audit_log where entity_id = ${p.id} or meta::text like ${'%' + p.id + '%'} order by id`);
    const actions = all.map((a) => a.action);
    for (const want of ['presentation.create', 'presentation.update', 'presentation.rename', 'presentation.delete', 'presentation.restore']) assert.ok(actions.includes(want), want);
    assert.ok(actions.includes('presentation.duplicate'));
    const upd = all.find((a) => a.action === 'presentation.update'); assert.equal(upd.actor_id, A.id); assert.equal(upd.meta.rev, 2); assert.equal(upd.meta.slideCount, 1); assert.ok(upd.meta.bytes > 0);
    assert.equal(all.find((a) => a.action === 'presentation.duplicate').actor_id, B.id);
    assert.ok(all.every((a) => a.ip === '203.0.113.7' && a.user_agent === 'teste' && a.request_id === 'req-test-0001'));
    const text = JSON.stringify(all);
    assert.ok(!text.includes(SECRET), 'conteúdo/título/rótulo vazou para a auditoria');
    assert.ok(!/senha|password|token|authorization|cookie/i.test(text));
  });
});
void asset;
