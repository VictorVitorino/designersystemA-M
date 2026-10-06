/* Salvamento, conflitos, histórico de versões, retenção, restauração e integridade de referências a arquivos.
   Inclui o teste de 20 salvamentos concorrentes da MESMA apresentação. Banco real (RLS) + rotas reais (mini-app). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, deck, png, asset, sha256Hex } from '../helpers/mini-app.js';
import { contentHash } from '../../src/lib/canonical.js';
import { pruneVersions, pruneAllVersions } from '../../src/lib/presentations-service.js';

let env, A, B, C, ADM;
before(async () => {
  env = await makeEnv();
  A = await env.mkUser({ name: 'Ana' }); B = await env.mkUser({ name: 'Bruno' }); C = await env.mkUser({ name: 'Carla' }); ADM = await env.mkUser({ role: 'admin', name: 'Admin' });
});
after(async () => { await env.stop(); });

const row = async (id) => (await env.sys((tx) => tx`select * from app.presentations where id = ${id}`))[0];
const versions = (id) => env.sys((tx) => tx`select version_no, kind, label, content_hash, created_by, title from app.presentation_versions where presentation_id = ${id} order by version_no`);
const refs = async (id, no) => (await env.sys((tx) => tx`select sha256 from app.asset_refs where presentation_id = ${id} and version_no = ${no} order by sha256`)).map((r) => r.sha256);
const audits = (action, id) => env.sys((tx) => tx`select actor_id, meta from app.audit_log where action = ${action} and entity_id = ${id} order by id`);
const save = (u, p, content, extra = {}, baseRev) => env.put(u, `/api/presentations/${p.id}/content`, { json: { baseRev: baseRev ?? p.rev, content, ...extra } });
const backdateSnapshot = (id, min = 11) => env.sys((tx) => tx`update app.presentations set last_snapshot_at = now() - make_interval(mins => ${min}) where id = ${id}`);

describe('salvar: revisão, hash no servidor, idempotência', () => {
  test('salva: rev+1, hash canônico calculado no SERVIDOR, título e nº de slides vêm do conteúdo', async () => {
    const p = await env.create(A, 'Inicial', deck('Inicial'));
    const content = deck('Título novo', { slides: 4, text: 'primeira edição' });
    const r = await save(A, p, content);
    assert.equal(r.status, 200, r.text); assert.equal(r.json.rev, 2); assert.equal(r.json.unchanged, false); assert.equal(r.json.hash, contentHash(content)); assert.ok(Date.parse(r.json.savedAt));
    const db = await row(p.id);
    assert.equal(db.rev, 2); assert.equal(db.title, 'Título novo'); assert.equal(db.slide_count, 4); assert.equal(db.content_hash, contentHash(content)); assert.equal(db.updated_by, A.id);
    assert.deepEqual(db.content, content);
    const mismatch = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 2, content: deck('x', { text: 'z' }), hash: 'a'.repeat(64) } });
    assert.equal(mismatch.status, 400, 'o cliente não pode informar o hash (o servidor calcula)');
    const g = await env.get(A, `/api/presentations/${p.id}`); assert.equal(g.json.title, 'Título novo'); assert.equal(g.headers.get('etag'), '"2"');
  });
  test('"nada mudou" não toca em nada: mesmo rev, mesma updated_at, sem versão, sem nova auditoria — mesmo com chaves em outra ordem', async () => {
    const p = await env.create(A, 'Igual', deck('Igual'));
    const r1 = await save(A, p, deck('Igual', { text: 'estado final' })); assert.equal(r1.json.rev, 2);
    const snap = await row(p.id); const nAudit = (await audits('presentation.update', p.id)).length; const nVer = (await versions(p.id)).length;
    const same = deck('Igual', { text: 'estado final' });
    const reordered = JSON.parse(JSON.stringify(same, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
    for (const content of [same, reordered]) {
      const r = await save(A, p, content, {}, 2);
      assert.equal(r.status, 200); assert.equal(r.json.unchanged, true); assert.equal(r.json.rev, 2); assert.equal(r.json.hash, r1.json.hash); assert.equal(r.json.snapshotNo, undefined);
    }
    const after_ = await row(p.id);
    assert.equal(after_.rev, snap.rev); assert.equal(after_.updated_at.getTime(), snap.updated_at.getTime()); assert.equal(after_.snap_seq, snap.snap_seq);
    assert.equal((await versions(p.id)).length, nVer); assert.equal((await audits('presentation.update', p.id)).length, nAudit);
  });
  test('reenvio depois de resposta perdida (baseRev velho, mesmo conteúdo) é idempotente: 200 unchanged, não 409', async () => {
    const p = await env.create(A, 'Retry', deck('Retry'));
    const c = deck('Retry', { text: 'edição' });
    assert.equal((await save(A, p, c)).json.rev, 2);
    const retry = await save(A, p, c, {}, 1);            // o navegador não recebeu a resposta e reenviou com o baseRev antigo
    assert.equal(retry.status, 200); assert.equal(retry.json.unchanged, true); assert.equal(retry.json.rev, 2);
    const future = await save(A, p, c, {}, 9); assert.equal(future.status, 409, 'baseRev maior que o do servidor é inválido');
  });
});

describe('conflito de edição', () => {
  test('dois editores da mesma base: o 2º recebe 409 com serverRev/updatedBy/updatedAt e NADA do 2º é gravado', async () => {
    const p = await env.create(A, 'Conflito', deck('Conflito'));
    const mine = await save(A, p, deck('Conflito', { text: 'edição da Ana' })); assert.equal(mine.status, 200);
    const theirs = await save(ADM, p, deck('Conflito', { text: 'edição do admin (base velha)' }));
    assert.equal(theirs.status, 409); assert.equal(theirs.json.error.code, 'conflict');
    const d = theirs.json.error.details; assert.equal(d.serverRev, 2); assert.deepEqual(d.updatedBy, { id: A.id, displayName: 'Ana' }); assert.ok(Date.parse(d.updatedAt));
    const db = await row(p.id); assert.equal(db.rev, 2); assert.equal(db.content.slides[0].els[0].html, 'edição da Ana 0');
  });
  test('"manter a minha": baseRev = serverRev + resolution overwrite grava, cria o ponto pre_overwrite (com o estado sobrescrito) e audita', async () => {
    const p = await env.create(A, 'Sobrescrever', deck('Sobrescrever'));
    await save(A, p, deck('Sobrescrever', { text: 'versão da Ana' }));
    const stale = await save(ADM, p, deck('Sobrescrever', { text: 'versão do admin' })); assert.equal(stale.status, 409);
    const staleOverwrite = await save(ADM, p, deck('Sobrescrever', { text: 'versão do admin' }), { resolution: 'overwrite' }, 1);
    assert.equal(staleOverwrite.status, 409, 'overwrite só vale confirmando a revisão ATUAL do servidor');
    const ok = await save(ADM, p, deck('Sobrescrever', { text: 'versão do admin' }), { resolution: 'overwrite' }, stale.json.error.details.serverRev);
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.rev, 3); assert.ok(ok.json.preOverwriteNo);
    const v = (await versions(p.id)).find((x) => x.kind === 'pre_overwrite'); assert.ok(v); assert.equal(v.version_no, ok.json.preOverwriteNo); assert.equal(v.created_by, ADM.id);
    const pre = (await env.get(A, `/api/presentations/${p.id}/versions/${v.version_no}`)).json;
    assert.equal(pre.content.slides[0].els[0].html, 'versão da Ana 0', 'o trabalho sobrescrito fica recuperável');
    assert.equal((await row(p.id)).content.slides[0].els[0].html, 'versão do admin 0');
    assert.equal((await audits('presentation.conflict_overwrite', p.id)).length, 1);
  });
});

describe('histórico: pontos manuais × automáticos', () => {
  test('autosave só cria ponto no 1º salvamento com mudança após ≥ 10 min do último ponto; manual sempre cria', async () => {
    const p = await env.create(A, 'Histórico', deck('Histórico'));
    let rev = p.rev; const edit = async (text, extra = {}) => { const r = await save(A, { id: p.id }, deck('Histórico', { text }), extra, rev); assert.equal(r.status, 200, r.text); rev = r.json.rev; return r.json; };
    const r1 = await edit('1'); assert.equal(r1.snapshotNo, 1, 'primeira mudança: nunca houve ponto → cria');
    const r2 = await edit('2'); assert.equal(r2.snapshotNo, undefined, 'menos de 10 min: só a cópia de trabalho');
    const r3 = await edit('3'); assert.equal(r3.snapshotNo, undefined);
    assert.deepEqual((await versions(p.id)).map((v) => [v.version_no, v.kind]), [[1, 'autosave']]);
    await backdateSnapshot(p.id, 9); const r4 = await edit('4'); assert.equal(r4.snapshotNo, undefined, '9 min ainda é cedo');
    await backdateSnapshot(p.id, 11); const r5 = await edit('5'); assert.equal(r5.snapshotNo, 2, '≥ 10 min: novo ponto automático');
    const r6 = await edit('6'); assert.equal(r6.snapshotNo, undefined, 'o relógio recomeçou');
    const r7 = await edit('7', { snapshot: true, label: '  Antes da reunião  ' }); assert.equal(r7.snapshotNo, 3, 'manual cria mesmo sem esperar os 10 min');
    const list = await versions(p.id);
    assert.deepEqual(list.map((v) => [v.version_no, v.kind, v.label]), [[1, 'autosave', null], [2, 'autosave', null], [3, 'manual', 'Antes da reunião']]);
    assert.equal(list[2].content_hash, contentHash(deck('Histórico', { text: '7' })), 'o ponto guarda o estado salvo naquele momento');
    assert.equal((await row(p.id)).snap_seq, 3);
    assert.deepEqual(await refs(p.id, 3), [], 'sem imagens');
  });
  test('"salvar versão" sem alterações (já salvo pelo autosave) ainda cria o ponto manual — uma vez só', async () => {
    const p = await env.create(A, 'Manual sem mudança', deck('M'));
    const r1 = await save(A, p, deck('M', { text: 'novo' })); assert.equal(r1.json.rev, 2);
    const man = await save(A, p, deck('M', { text: 'novo' }), { snapshot: true, label: 'Fechada' }, 2);
    assert.equal(man.status, 200); assert.equal(man.json.unchanged, true); assert.equal(man.json.rev, 2); assert.equal(man.json.snapshotNo, 2);
    const again = await save(A, p, deck('M', { text: 'novo' }), { snapshot: true }, 2); assert.equal(again.json.snapshotNo, 2, 'não duplica o ponto idêntico');
    assert.deepEqual((await versions(p.id)).map((v) => [v.version_no, v.kind]), [[1, 'autosave'], [2, 'manual']]);
    assert.equal((await row(p.id)).rev, 2);
  });
  test('rótulo: até 120 caracteres, sem controles; só vale em ponto manual', async () => {
    const p = await env.create(A, 'Rótulo', deck('R'));
    assert.equal((await save(A, p, deck('R', { text: 'a' }), { label: 'x'.repeat(121), snapshot: true })).status, 400);
    const r = await save(A, p, deck('R', { text: 'a' }), { label: 'só manual conta' });   // sem snapshot:true o rótulo é ignorado
    assert.equal(r.status, 200); assert.equal((await versions(p.id)).find((v) => v.kind === 'autosave').label, null);
  });
  test('quem pode ver o histórico: dono e admin (200); outro membro 403; invisível 404; conteúdo da versão idem', async () => {
    const p = await env.create(A, 'Privado do histórico', deck('P')); await save(A, p, deck('P', { text: 'x' }), { snapshot: true });
    for (const u of [A, ADM]) { const r = await env.get(u, `/api/presentations/${p.id}/versions`); assert.equal(r.status, 200); assert.equal(r.json.items.length, 1); }
    const item = (await env.get(A, `/api/presentations/${p.id}/versions`)).json.items[0];
    assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'createdBy', 'kind', 'label', 'no', 'slideCount', 'title']); assert.deepEqual(item.createdBy, { id: A.id, displayName: 'Ana' }); assert.equal(item.content, undefined);
    assert.equal((await env.get(B, `/api/presentations/${p.id}/versions`)).status, 403);
    assert.equal((await env.get(B, `/api/presentations/${p.id}/versions/1`)).status, 403);
    assert.equal((await env.get(A, `/api/presentations/${p.id}/versions/1`)).json.content.slides.length, 1);
    assert.equal((await env.get(A, `/api/presentations/${p.id}/versions/99`)).status, 404); assert.equal((await env.get(A, `/api/presentations/${p.id}/versions/0`)).status, 404);
    assert.equal((await env.get(A, `/api/presentations/${p.id}/versions/abc`)).status, 404);
    await env.del(A, `/api/presentations/${p.id}`);
    assert.equal((await env.get(B, `/api/presentations/${p.id}/versions`)).status, 404);
  });
});

describe('restaurar uma versão', () => {
  test('cria pre_restore (estado atual) e restore; a cópia de trabalho volta ao conteúdo antigo com rev+1; arquivos acompanham', async () => {
    const sha1 = await env.upload(A, await png(31)), sha2 = await env.upload(A, await png(32));
    const p = await env.create(A, 'Restaurar', deck('Restaurar', { text: 'v1', images: [sha1] }));
    const s1 = await save(A, p, deck('Restaurar', { text: 'v1 manual', images: [sha1] }), { snapshot: true, label: 'Boa' }); assert.equal(s1.json.snapshotNo, 1);
    const s2 = await save(A, p, deck('Restaurar', { text: 'v2', images: [sha2] }), {}, s1.json.rev);
    assert.deepEqual(await refs(p.id, 0), [sha2]);
    const stale = await env.post(A, `/api/presentations/${p.id}/versions/1/restore`, { json: { baseRev: 1 } }); assert.equal(stale.status, 409, 'baseRev desatualizado');
    const r = await env.post(A, `/api/presentations/${p.id}/versions/1/restore`, { json: { baseRev: s2.json.rev } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.rev, s2.json.rev + 1); assert.ok(r.json.preRestoreNo && r.json.snapshotNo);
    const db = await row(p.id); assert.equal(db.content.slides[0].els[0].html, 'v1 manual 0'); assert.equal(db.content_hash, contentHash(db.content)); assert.equal(db.rev, 4);
    assert.deepEqual(await refs(p.id, 0), [sha1], 'referências da cópia de trabalho = as da versão restaurada');
    const list = await versions(p.id);
    const pre = list.find((v) => v.kind === 'pre_restore'), rest = list.find((v) => v.kind === 'restore');
    assert.ok(pre && rest); assert.equal(rest.label, 'Restaurada da versão 1'); assert.equal(rest.content_hash, db.content_hash);
    const preC = (await env.get(A, `/api/presentations/${p.id}/versions/${pre.version_no}`)).json.content; assert.equal(preC.slides[0].els[0].html, 'v2 0', 'o estado desfeito fica no histórico');
    assert.deepEqual(await refs(p.id, pre.version_no), [sha2]); assert.deepEqual(await refs(p.id, rest.version_no), [sha1]);
    assert.equal((await audits('presentation.version_restore', p.id)).length, 1);
    const same = await env.post(A, `/api/presentations/${p.id}/versions/${rest.version_no}/restore`, { json: { baseRev: 4 } }); assert.equal(same.json.unchanged, true, 'restaurar o que já está no ar não faz nada');
    assert.equal((await env.post(A, `/api/presentations/${p.id}/versions/77/restore`, { json: { baseRev: 4 } })).status, 404);
    assert.equal((await env.post(B, `/api/presentations/${p.id}/versions/1/restore`, { json: { baseRev: 4 } })).status, 403);
    assert.equal((await env.post(A, `/api/presentations/${p.id}/versions/1/restore`, { json: {} })).status, 400);
  });
});

describe('retenção de versões (manutenção, nunca na requisição)', () => {
  test('a manutenção mantém as N últimas, as manuais e 1 por dia; remove também as referências de arquivo da versão podada', async () => {
    const sha = await env.upload(A, await png(41));
    const p = await env.create(A, 'Retenção', deck('Retenção', { images: [sha] }));
    await save(A, p, deck('Retenção', { text: 'x', images: [sha] }));       // ponto automático nº 1 (hoje)
    // versões 11..15 manuais e 16..75 automáticas, todas "de ontem ao meio-dia" (mesmo dia ≠ hoje: sem depender da hora do teste), todas com a imagem
    await env.sys(async (tx) => {
      for (let i = 1; i <= 65; i++) {
        await tx`insert into app.presentation_versions(presentation_id, version_no, content, content_hash, slide_count, title, kind, created_by, created_at)
                 select id, ${i + 10}, content, ${'c'.repeat(64)}, slide_count, title, ${i <= 5 ? 'manual' : 'autosave'}, ${A.id},
                        date_trunc('day', now()) - interval '12 hours' + make_interval(secs => ${i}) from app.presentations where id = ${p.id}`;
        await tx`insert into app.asset_refs(presentation_id, version_no, sha256) values (${p.id}, ${i + 10}, ${sha})`;
      }
    });
    const nums = async () => (await env.sys((tx) => tx`select version_no, kind from app.presentation_versions where presentation_id = ${p.id} order by version_no`));
    assert.equal((await nums()).length, 66);
    // a API nunca poda: salvar de novo não remove nada
    await save(A, { id: p.id }, deck('Retenção', { text: 'y', images: [sha] }), {}, 3); assert.equal((await nums()).length, 66);
    const denied = await env.db.asUser(A.id, (tx) => tx`select app.prune_versions(${p.id}, 50, 90)`).catch((e) => e.code);
    assert.equal(denied, '42501', 'um usuário não consegue podar pelo banco (função só do papel de sistema)');
    const removed = await env.sys((tx) => pruneVersions(tx, p.id, { keepLast: 50, dailyDays: 90 }));
    assert.equal(removed, 10, 'só as 10 automáticas mais antigas fora das 50 últimas (16..25); manuais e o representante do dia ficam');
    const left = await nums(); const set = new Set(left.map((v) => v.version_no));
    assert.equal(left.length, 56);
    assert.equal(left.filter((v) => v.kind === 'manual').length, 5, 'todas as manuais ficam');
    assert.ok(set.has(1), 'a última de cada dia (hoje) ficou'); for (let n = 16; n <= 25; n++) assert.ok(!set.has(n), `versão ${n} devia ter saído`); for (let n = 26; n <= 75; n++) assert.ok(set.has(n), `versão ${n}`);
    const stray = await env.sys((tx) => tx`select count(*)::int n from app.asset_refs r where r.presentation_id = ${p.id} and r.version_no > 0 and not exists (select 1 from app.presentation_versions v where v.presentation_id = r.presentation_id and v.version_no = r.version_no)`);
    assert.equal(stray[0].n, 0, 'referência de versão podada também some (o arquivo pode ser coletado depois)');
    assert.deepEqual(await refs(p.id, 0), [sha], 'a cópia de trabalho mantém a imagem');
    const again = await env.sys((tx) => pruneVersions(tx, p.id)); assert.equal(again, 0, 'idempotente');
    const all = await pruneAllVersions(env.ops); assert.equal(all.keepLast, 50); assert.equal(all.dailyDays, 90); assert.equal(all.pruned, 0);
  });
  test('arquivo usado só por versões antigas NÃO é órfão (a coleta de lixo não o apaga) — até a versão ser podada', async () => {
    const shaOld = await env.upload(A, await png(42));
    const p = await env.create(A, 'Só no histórico', deck('H', { images: [shaOld] }));
    const s1 = await save(A, p, deck('H', { text: 'com imagem', images: [shaOld] }));     // ponto automático 1 guarda a imagem
    assert.deepEqual(await refs(p.id, 1), [shaOld]);
    await save(A, { id: p.id }, deck('H', { text: 'sem imagem' }), {}, s1.json.rev);       // a cópia de trabalho deixa de usar
    assert.deepEqual(await refs(p.id, 0), []);
    const orphans = async () => (await env.sys((tx) => tx`select sha256 from app.orphan_assets('0 seconds')`)).map((o) => o.sha256);
    assert.ok(!(await orphans()).includes(shaOld), 'ainda referenciado pelo histórico');
    await env.sys((tx) => pruneVersions(tx, p.id, { keepLast: 0, dailyDays: 0 }));
    assert.equal((await versions(p.id)).length, 0, 'versão podada');
    assert.ok((await orphans()).includes(shaOld), 'sem referência nenhuma → candidato à coleta de lixo (que ainda aplica a carência)');
  });
});

describe('integridade das referências a arquivos', () => {
  test('sha desconhecido → 422 e nada é gravado', async () => {
    const p = await env.create(A, 'Refs', deck('Refs'));
    const ghost = 'e'.repeat(64);
    const r = await save(A, p, deck('Refs', { text: 'x', images: [ghost] }));
    assert.equal(r.status, 422); assert.equal(r.json.error.code, 'rejected_content'); assert.deepEqual(r.json.error.details.reasons, ['asset_inexistente']); assert.deepEqual(r.json.error.details.missing, [ghost]);
    assert.equal((await row(p.id)).rev, 1); assert.deepEqual(await refs(p.id, 0), []);
    assert.equal((await env.post(A, '/api/presentations', { json: { content: deck('N', { images: [ghost] }) } })).status, 422);
  });
  test('arquivo de OUTRA pessoa que a apresentação dela ainda não referencia → 422 (não dá para "adivinhar" hashes alheios)', async () => {
    const mine = await png(51); const sha = await env.upload(A, mine);
    const p = await env.create(B, 'Do Bruno', deck('Do Bruno'));
    const r = await save(B, p, deck('Do Bruno', { text: 'x', images: [sha] }));
    assert.equal(r.status, 422, 'o arquivo é da Ana, e ninguém o referencia ainda');
    assert.equal(r.json.error.message, (await save(B, p, deck('Do Bruno', { text: 'x', images: ['f'.repeat(64)] }))).json.error.message, 'mesma resposta para "alheio" e "inexistente"');
    assert.equal((await env.post(B, '/api/assets/check', { json: { shas: [sha] } })).json.missing[0], sha);
    assert.equal(await env.upload(B, mine), sha, 'quem TEM os bytes prova a posse reenviando (deduplicado)');
    assert.equal((await save(B, p, deck('Do Bruno', { text: 'x', images: [sha] }))).status, 200);
  });
  test('arquivo usado por apresentação VISÍVEL (acervo) pode ser referenciado por qualquer um; o de apresentação na lixeira alheia não', async () => {
    const sha = await env.upload(A, await png(52));
    const pa = await env.create(A, 'Com imagem', deck('Com imagem', { images: [sha] }));
    const pc = await env.create(C, 'Da Carla', deck('Da Carla'));
    assert.equal((await save(C, pc, deck('Da Carla', { text: 'copiei a imagem do acervo', images: [sha] }))).status, 200);
    await env.del(A, `/api/presentations/${pa.id}`);                            // some do acervo, mas a Carla já a referencia na dela (visível)
    const sha2 = await env.upload(A, await png(53));
    const hidden = await env.create(A, 'Escondida', deck('Escondida', { images: [sha2] })); await env.del(A, `/api/presentations/${hidden.id}`);
    const r = await save(C, { id: pc.id }, deck('Da Carla', { text: 'x2', images: [sha2] }), {}, 2);
    assert.equal(r.status, 422, 'imagem só usada por apresentação na lixeira alheia está invisível');
  });
  test('arquivo ainda "pending" (envio não concluído) ou "rejected" não pode ser referenciado', async () => {
    const sha = sha256Hex(Buffer.from('pendente-' + Date.now()));
    await env.sys((tx) => tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by) values (${sha}, 10, 'image/png', 'image', 'pending', ${A.id})`);
    const p = await env.create(A, 'Pendente', deck('Pendente'));
    assert.equal((await save(A, p, deck('Pendente', { text: 'x', images: [sha] }))).status, 422);
    await env.sys((tx) => tx`update app.assets set status = 'rejected' where sha256 = ${sha}`);
    assert.equal((await save(A, p, deck('Pendente', { text: 'x', images: [sha] }))).status, 422);
  });
  test('asset_refs acompanha o conteúdo por diferença (entra/sai) e last_ref_at marca o relógio da coleta de lixo', async () => {
    const [s1, s2, s3] = [await env.upload(A, await png(61)), await env.upload(A, await png(62)), await env.upload(A, await png(63))];
    await env.sys((tx) => tx`update app.assets set last_ref_at = null where sha256 in (${s1}, ${s2}, ${s3})`);
    const p = await env.create(A, 'Diferença', deck('Diferença', { images: [s1, s2] }));
    assert.deepEqual(await refs(p.id, 0), [s1, s2].sort());
    const r = await save(A, p, deck('Diferença', { text: 'troca', images: [s2, s3] }));
    assert.equal(r.status, 200); assert.deepEqual(await refs(p.id, 0), [s2, s3].sort());
    const touched = await env.sys((tx) => tx`select sha256, last_ref_at from app.assets where sha256 in (${s1}, ${s2}, ${s3})`);
    assert.ok(touched.every((a) => a.last_ref_at), 'entrou/saiu → relógio de carência atualizado');
    const dup = await save(A, { id: p.id }, deck('Diferença', { text: 'dup', images: [s2, s2, s3, s3] }), {}, r.json.rev); assert.equal(dup.status, 200); assert.deepEqual(await refs(p.id, 0), [s2, s3].sort(), 'mesma imagem 2× conta 1 vez');
  });
  test('miniatura: precisa ser um arquivo "thumb" pronto e visível; thumbSha:null remove; aparece na listagem', async () => {
    const th = await env.upload(A, await png(71, 16), 'thumb'); const img = await env.upload(A, await png(72));
    const p = await env.create(A, 'Com miniatura', deck('Miniatura'));
    assert.equal((await save(A, p, deck('Miniatura', { text: 'a' }), { thumbSha: img })).status, 422, 'imagem comum não serve de miniatura');
    assert.equal((await save(A, p, deck('Miniatura', { text: 'a' }), { thumbSha: 'd'.repeat(64) })).status, 422);
    const other = await env.upload(B, await png(73, 16), 'thumb');
    assert.equal((await save(A, p, deck('Miniatura', { text: 'a' }), { thumbSha: other })).status, 422, 'miniatura de outra pessoa que não está em apresentação visível');
    const ok = await save(A, p, deck('Miniatura', { text: 'a' }), { thumbSha: th }); assert.equal(ok.status, 200);
    assert.equal((await env.get(B, '/api/presentations?q=Miniatura')).json.items[0].thumbSha, th);
    assert.equal((await env.get(B, `/api/assets/${th}`)).status, 200, 'todos veem a miniatura de apresentação visível');
    const keep = await save(A, p, deck('Miniatura', { text: 'b' }), {}, ok.json.rev); assert.equal((await row(p.id)).thumb_sha, th, 'omitir thumbSha mantém a atual');
    const clear = await save(A, p, deck('Miniatura', { text: 'c' }), { thumbSha: null }, keep.json.rev); assert.equal(clear.status, 200); assert.equal((await row(p.id)).thumb_sha, null);
  });
});

describe('concorrência: 20 salvamentos da MESMA apresentação', () => {
  test('mesma base (baseRev 1) com 20 conteúdos diferentes: exatamente UM vence, 19 recebem 409, nada se mistura nem se perde', async () => {
    await env.resetRates();
    const p = await env.create(A, 'Corrida', deck('Corrida'));
    const contents = Array.from({ length: 20 }, (_, i) => deck('Corrida', { text: `autor-${i}` }));
    const res = await Promise.all(contents.map((content, i) => env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 1, content }, ip: `198.51.100.${i + 1}` })));
    const ok = res.filter((r) => r.status === 200), conflict = res.filter((r) => r.status === 409);
    assert.equal(ok.length, 1, `vencedores: ${res.map((r) => r.status).join(',')}`); assert.equal(conflict.length, 19); assert.equal(ok[0].json.rev, 2);
    for (const c of conflict) assert.equal(c.json.error.details.serverRev, 2);
    const winner = res.findIndex((r) => r.status === 200);
    const db = await row(p.id);
    assert.equal(db.rev, 2); assert.deepEqual(db.content, contents[winner], 'o conteúdo é inteiro de UM autor (sem mistura)'); assert.equal(db.content_hash, contentHash(contents[winner]));
    assert.equal((await versions(p.id)).length, 1, 'um único ponto automático');
    assert.equal((await audits('presentation.update', p.id)).length, 1);
  });
  test('20 editores com "ler → alterar → salvar → refazer em 409": todos os 20 acréscimos entram, revisões consecutivas, nenhum dado perdido', async () => {
    await env.resetRates();
    const p = await env.create(A, 'Fila', deck('Fila', { slides: 1 }));
    // 20 editores = a dona + 19 administradores (moderação); cada um tem o próprio limite de taxa (a disputa é pela linha, não pelo limitador)
    const editors = [A, ...(await Promise.all(Array.from({ length: 19 }, (_, i) => env.mkUser({ role: 'admin', name: 'Editor ' + i }))))];
    let retries = 0;
    const worker = async (i) => {
      const U = editors[i];
      for (let attempt = 0; attempt < 60; attempt++) {
        const cur = await env.get(U, `/api/presentations/${p.id}`, { ip: `198.51.100.${100 + i}` });
        assert.equal(cur.status, 200);
        const content = cur.json.content; content.slides.push({ id: `novo-${i}`, bg: '#FFFFFF', tr: 'fade', layout: 'blank-light', els: [{ id: `x${i}`, type: 'text', x: 0, y: 0, w: 10, h: 10, html: `slide do editor ${i}` }] });
        const r = await env.put(U, `/api/presentations/${p.id}/content`, { json: { baseRev: cur.json.rev, content }, ip: `198.51.100.${100 + i}` });
        if (r.status === 200) return r.json.rev;
        assert.equal(r.status, 409, r.text); retries++;
      }
      throw new Error('não conseguiu salvar');
    };
    const revs = await Promise.all(Array.from({ length: 20 }, (_, i) => worker(i)));
    assert.deepEqual([...revs].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2), 'cada revisão foi vencida por exatamente um editor (2..21)');
    const db = await row(p.id);
    assert.equal(db.rev, 21); assert.equal(db.slide_count, 21);
    const ids = db.content.slides.map((s) => s.id); assert.equal(new Set(ids).size, 21, 'sem slides repetidos');
    for (let i = 0; i < 20; i++) assert.ok(ids.includes(`novo-${i}`), `o acréscimo do editor ${i} se perdeu`);
    assert.ok(retries > 0, 'houve disputa de verdade');
    const vs = await versions(p.id); assert.equal(new Set(vs.map((v) => v.version_no)).size, vs.length);
  });
  test('10 envios simultâneos do MESMO conteúdo (reenvio/duas abas): um grava, os demais voltam unchanged — sem erro e sem duplicar pontos', async () => {
    await env.resetRates();
    const p = await env.create(A, 'Mesma', deck('Mesma'));
    const content = deck('Mesma', { text: 'idêntico' });
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: 1, content }, ip: `198.51.100.${200 + i}` })));
    assert.ok(res.every((r) => r.status === 200), res.map((r) => r.status).join(','));
    assert.equal(res.filter((r) => !r.json.unchanged).length, 1); assert.ok(res.every((r) => r.json.rev === 2));
    assert.equal((await row(p.id)).rev, 2); assert.equal((await versions(p.id)).length, 1);
  });
  test('linha travada por outra transação além de 8 s → 503 amigável (não 500), e nada é gravado; depois que libera, salva normalmente', async () => {
    await env.resetRates();
    const p = await env.create(A, 'Travada', deck('Travada'));
    let release; const held = new Promise((r) => { release = r; });
    const holder = env.ops.sql.begin(async (tx) => { await tx`set local role app_system`; await tx`select id from app.presentations where id = ${p.id} for update`; await held; });
    await new Promise((r) => setTimeout(r, 300));
    const r = await save(A, p, deck('Travada', { text: 'esperando' }));
    release(); await holder;
    assert.equal(r.status, 503, r.text); assert.equal(r.json.error.code, 'unavailable'); assert.equal((await row(p.id)).rev, 1);
    assert.equal((await save(A, p, deck('Travada', { text: 'agora vai' }))).status, 200);
  });
  test('dono e admin salvando ao mesmo tempo: o banco serializa (um 200, um 409) e o usuário que salvou fica registrado', async () => {
    await env.resetRates();
    const p = await env.create(A, 'Dois', deck('Dois'));
    const [r1, r2] = await Promise.all([save(A, p, deck('Dois', { text: 'ana' })), save(ADM, p, deck('Dois', { text: 'admin' }))]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    const db = await row(p.id); assert.equal(db.updated_by, r1.status === 200 ? A.id : ADM.id);
  });
});

void asset;
