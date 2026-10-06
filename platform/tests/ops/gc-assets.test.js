import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setup, tmp, rmrf, sha } from './_helpers.js';
import { runGc } from '../../tools/gc-assets.js';
import { FileStore } from '../../tools/lib/targets.js';
import { keyOfSha } from '../../tools/lib/mirror.js';

let db, ops, dir, store, userId, presId;
const sys = (fn) => ops.asSystem(fn);
before(async () => {
  ({ db, ops } = await setup()); dir = tmp('gc'); store = new FileStore(dir, { secure: false });
  [{ id: userId }] = await sys((tx) => tx`insert into app.users(email, display_name, role, status) values ('gc@am.test', 'GC', 'admin', 'active') returning id`);
  [{ id: presId }] = await sys((tx) => tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count) values (${userId}, 'P', ${tx.json({ v: 1 })}, ${sha('p')}, 1) returning id`);
});
after(async () => { await db.end(); await ops.end(); rmrf(dir); });
beforeEach(async () => { await sys(async (tx) => { await tx`delete from app.asset_refs`; await tx`update app.presentations set thumb_sha = null`; await tx`delete from app.assets`; }); rmrf(path.join(dir, 'a')); });

/** cria um arquivo real (objeto + linha). ageDays = idade da linha; objAgeDays = idade do objeto no armazenamento. */
async function mkAsset({ ageDays = 40, objAgeDays = 40, status = 'ready' } = {}) {
  const buf = crypto.randomBytes(300 + Math.floor(Math.random() * 500)); const h = sha(buf); await store.put(keyOfSha(h), buf);
  const t = new Date(Date.now() - objAgeDays * 86400e3); fs.utimesSync(path.join(dir, ...keyOfSha(h).split('/')), t, t);
  await sys((tx) => tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by, created_at) values (${h}, ${buf.length}, 'image/png', 'image', ${status}, ${userId}, now() - make_interval(days => ${ageDays}))`);
  return h;
}
const ref = (h, v = 0) => sys((tx) => tx`insert into app.asset_refs(presentation_id, version_no, sha256) values (${presId}, ${v}, ${h}) on conflict do nothing`);
const row = async (h) => (await sys((tx) => tx`select status, last_ref_at from app.assets where sha256 = ${h}`))[0];
const has = async (h) => !!(await store.head(keyOfSha(h)));
const gc = (o = {}) => runGc({ sql: ops.sql, store, ...o });

test('relatório (padrão) não altera NADA: lista candidatos e bytes', async () => {
  const a = await mkAsset(), b = await mkAsset(); await ref(b);
  const r = await gc(); assert.equal(r.apply, false); assert.equal(r.candidates, 1); assert.ok(r.candidateBytes > 0);
  assert.equal((await row(a)).status, 'ready'); assert.ok(await has(a)); assert.ok(await has(b));
});

test('apply: apaga órfãos antigos e NUNCA o que tem referência (apresentação, versão antiga, miniatura), é recente ou foi reenviado', async () => {
  const orphan = await mkAsset(), pend = await mkAsset({ status: 'pending' }), rej = await mkAsset({ status: 'rejected' });
  const used = await mkAsset(), inVersion = await mkAsset(), thumb = await mkAsset(), young = await mkAsset({ ageDays: 5 }), reup = await mkAsset();
  await ref(used, 0); await ref(inVersion, 3); await sys((tx) => tx`update app.presentations set thumb_sha = ${thumb} where id = ${presId}`);
  await sys((tx) => tx`insert into app.asset_uploads(sha256, user_id, at) values (${reup}, ${userId}, now() - interval '1 hour')`);   // reenviado há 1 h: autosave pode estar a caminho
  const r = await gc({ apply: true, graceHours: 0 });
  assert.equal(r.deleted, 3, JSON.stringify(r)); assert.equal(r.errors.length, 0);
  for (const h of [orphan, pend, rej]) { assert.equal(await row(h), undefined); assert.ok(!(await has(h))); }
  for (const h of [used, inVersion, thumb, young, reup]) { assert.equal((await row(h)).status, 'ready'); assert.ok(await has(h), 'objeto protegido deve existir'); }
});

test('duas fases: com carência o arquivo só é MARCADO (objeto continua); depois da carência é apagado', async () => {
  const a = await mkAsset(); const r1 = await gc({ apply: true, graceHours: 24 });
  assert.equal(r1.marked, 1); assert.equal(r1.deleted, 0); assert.equal((await row(a)).status, 'deleted'); assert.ok(await has(a));
  const r1b = await gc({ apply: true, graceHours: 24 }); assert.equal(r1b.deleted, 0); assert.equal(r1b.pendingDeletion, 1);
  await sys((tx) => tx`update app.assets set last_ref_at = now() - interval '2 days' where sha256 = ${a}`);
  const r2 = await gc({ apply: true, graceHours: 24 }); assert.equal(r2.deleted, 1); assert.equal(await row(a), undefined); assert.ok(!(await has(a)));
});

test('objeto gravado há pouco no armazenamento não é apagado (trava de upload recente)', async () => {
  const a = await mkAsset({ objAgeDays: 0 }); const r = await gc({ apply: true, graceHours: 0 });
  assert.equal(r.deleted, 0); assert.ok(r.skipped.some((s) => /gravado há pouco/.test(s.motivo))); assert.ok(await has(a));
});

test('CORRIDA 1: ganha referência ENTRE a seleção e a marcação → não é marcado nem apagado', async () => {
  const a = await mkAsset(); const r = await gc({ apply: true, graceHours: 0, hooks: { afterCandidates: async () => { await ref(a, 0); } } });
  assert.equal(r.marked, 0); assert.equal(r.deleted, 0); assert.ok(r.skipped.some((s) => /referência/.test(s.motivo))); assert.equal((await row(a)).status, 'ready'); assert.ok(await has(a));
});
test('CORRIDA 2: reenviado por alguém ENTRE a seleção e a marcação → protegido', async () => {
  const a = await mkAsset(); const r = await gc({ apply: true, graceHours: 0, hooks: { afterCandidates: async () => { await sys((tx) => tx`insert into app.asset_uploads(sha256, user_id) values (${a}, ${userId})`); } } });
  assert.equal(r.deleted, 0); assert.ok(r.skipped.some((s) => /enviado novamente/.test(s.motivo))); assert.ok(await has(a));
});
test('CORRIDA 3: ganha referência ENTRE a marcação e a exclusão → é REATIVADO e o objeto fica', async () => {
  const a = await mkAsset(); const r = await gc({ apply: true, graceHours: 0, hooks: { afterMark: async (h) => { if (h === a) await ref(a, 0); } } });
  assert.equal(r.revived, 1); assert.equal(r.deleted, 0); assert.equal((await row(a)).status, 'ready'); assert.ok(await has(a));
  assert.equal((await sys((tx) => tx`select count(*)::int as n from app.asset_refs where sha256 = ${a}`))[0].n, 1);
});
test('CORRIDA 4: referência criada ENQUANTO o GC apaga (linha travada) → ou a referência entra, ou ela FALHA limpa; nunca sobra referência para objeto apagado', async () => {
  const a = await mkAsset(); let late;
  const r = await gc({ apply: true, graceHours: 0, hooks: { beforeObjectDelete: async (h) => {
    if (h !== a) return;
    late = sys((tx) => tx`insert into app.asset_refs(presentation_id, version_no, sha256) values (${presId}, 0, ${a})`).then(() => 'inserido', (e) => e.code);   // bloqueia na trava da linha
    await new Promise((res) => setTimeout(res, 400));
  } } });
  const outcome = await late; assert.equal(r.deleted, 1); assert.equal(outcome, '23503', 'a referência tardia precisa falhar por chave estrangeira (arquivo já apagado)');
  assert.equal((await sys((tx) => tx`select count(*)::int as n from app.asset_refs where sha256 = ${a}`))[0].n, 0); assert.ok(!(await has(a)));
  // invariante global: todo asset_ref aponta para linha e objeto existentes
  const refs = await sys((tx) => tx`select distinct sha256 from app.asset_refs`); for (const x of refs) assert.ok(await has(x.sha256));
});
test('falha ao apagar o objeto desfaz a exclusão no banco (nada fica pela metade)', async () => {
  const a = await mkAsset(); const bad = { head: (k) => store.head(k), delete: async () => { throw new Error('S3 fora do ar'); }, list: (p) => store.list(p) };
  const r = await runGc({ sql: ops.sql, store: bad, apply: true, graceHours: 0 }); assert.equal(r.deleted, 0); assert.equal(r.errors.length, 1);
  assert.equal((await row(a)).status, 'deleted'); assert.ok(await has(a));
  const ok = await gc({ apply: true, graceHours: 0 }); assert.equal(ok.deleted, 1);
});
test('objetos sem registro no banco: relatados; só --delete-unknown + apply apaga os ANTIGOS', async () => {
  const known = await mkAsset(); await ref(known);
  const oldBuf = crypto.randomBytes(100), newBuf = crypto.randomBytes(100), ho = sha(oldBuf), hn = sha(newBuf);
  await store.put(keyOfSha(ho), oldBuf); await store.put(keyOfSha(hn), newBuf); const t = new Date(Date.now() - 30 * 86400e3); fs.utimesSync(path.join(dir, ...keyOfSha(ho).split('/')), t, t);
  const rep = await gc({ scanStorage: true }); assert.equal(rep.unknownObjects.count, 1); assert.ok(await has(ho));
  const del = await gc({ apply: true, scanStorage: true, deleteUnknown: true, graceHours: 0 }); assert.equal(del.unknownObjects.deleted, 1);
  assert.ok(!(await has(ho))); assert.ok(await has(hn)); assert.ok(await has(known));
});
