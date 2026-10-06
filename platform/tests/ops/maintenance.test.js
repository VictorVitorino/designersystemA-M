import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, sha } from './_helpers.js';
import { purgeExpired, pruneVersions, auditRetention, stats } from '../../tools/maintenance.js';
import { attempt } from '../db/helpers.js';

let db, ops, userId, presId; const sys = (fn) => ops.asSystem(fn);
before(async () => {
  ({ db, ops } = await setup());
  [{ id: userId }] = await sys((tx) => tx`insert into app.users(email, display_name, role, status) values ('m1@am.test', 'M', 'admin', 'active') returning id`);
  await sys((tx) => tx`insert into app.users(email, display_name, role, status) values ('m2@am.test', 'M2', 'admin', 'active')`);
  [{ id: presId }] = await sys((tx) => tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count) values (${userId}, 'P', ${tx.json({ v: 1 })}, ${sha('p')}, 1) returning id`);
});
after(async () => { await db.end(); await ops.end(); });

test('purge-expired: expira convites vencidos e limpa contadores antigos', async () => {
  await sys(async (tx) => {
    await tx`insert into app.invites(email, role, status, expires_at) values ('velho@am.test', 'member', 'pending', now() - interval '1 day'), ('novo@am.test', 'member', 'pending', now() + interval '3 days')`;
    await tx`insert into app.rate_limits(bucket, key, window_start, hits) values ('login', 'a', now() - interval '5 days', 1), ('login', 'b', now(), 1)`;
  });
  const r = await purgeExpired(ops.sql); assert.equal(r.invitesExpired, 1); assert.equal(r.rateRowsDeleted, 1);
  const st = await sys((tx) => tx`select email, status from app.invites order by email`); assert.deepEqual(st.map((x) => x.status), ['pending', 'expired']);
});

test('prune-versions: usa app.settings, mantém manuais e as N últimas, simulação não remove, apaga referências das versões podadas', async () => {
  await sys(async (tx) => {
    const mk = (no, kind, age) => tx`insert into app.presentation_versions(presentation_id, version_no, content, content_hash, slide_count, title, kind, created_by, created_at)
      values (${presId}, ${no}, ${tx.json({ v: 1 })}, ${sha('v' + no)}, 1, 'P', ${kind}, ${userId}, now() - ${age}::interval)`;
    for (let n = 1; n <= 10; n++) await mk(n, 'autosave', '100 days');
    await mk(11, 'manual', '120 days'); await mk(12, 'manual', '110 days');
    for (let n = 13; n <= 62; n++) await mk(n, 'autosave', `${n - 12} minutes`);
    const h = sha('img'); await tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by) values (${h}, 10, 'image/png', 'image', 'ready', ${userId})`;
    await tx`insert into app.asset_refs(presentation_id, version_no, sha256) values (${presId}, 2, ${h}), (${presId}, 62, ${h})`;
  });
  const count = async () => (await sys((tx) => tx`select count(*)::int as n from app.presentation_versions where presentation_id = ${presId}`))[0].n;
  assert.equal(await count(), 62);
  const sim = await pruneVersions(ops.sql, { dryRun: true }); assert.equal(sim.versionsRemoved, 10); assert.equal(sim.keepLast, 50); assert.equal(await count(), 62, 'simulação não apaga');
  const real = await pruneVersions(ops.sql); assert.equal(real.versionsRemoved, 10); assert.equal(await count(), 52);
  const kinds = await sys((tx) => tx`select count(*)::int as n from app.presentation_versions where presentation_id = ${presId} and kind = 'manual'`); assert.equal(kinds[0].n, 2, 'versões manuais nunca são podadas');
  assert.equal((await sys((tx) => tx`select count(*)::int as n from app.asset_refs where version_no = 2`))[0].n, 0, 'referências das versões podadas somem'); assert.equal((await sys((tx) => tx`select count(*)::int as n from app.asset_refs where version_no = 62`))[0].n, 1);
  // valores vêm de app.settings
  await sys((tx) => tx`update app.settings set value = '5'::jsonb where key = 'versions.keep_last'`);
  const again = await pruneVersions(ops.sql, { dryRun: true }); assert.equal(again.keepLast, 5); assert.ok(again.versionsRemoved >= 40);
  await sys((tx) => tx`update app.settings set value = '50'::jsonb where key = 'versions.keep_last'`);
});

test('audit-retention: sem o sinal o banco BLOQUEIA o delete; com o job apaga só o antigo, em lotes', async () => {
  await sys(async (tx) => { for (let i = 0; i < 12; i++) await tx`insert into app.audit_log(at, action) values (now() - interval '200 days', 'auth.login')`; for (let i = 0; i < 3; i++) await tx`insert into app.audit_log(at, action) values (now() - interval '2 days', 'auth.login')`; });
  const blocked = await attempt(() => sys((tx) => tx`delete from app.audit_log where at < now() - interval '180 days'`)); assert.equal(blocked.ok, false); assert.equal(blocked.code, '42501');
  const upd = await attempt(() => sys((tx) => tx`update app.audit_log set action = 'x.y'`)); assert.equal(upd.ok, false);
  const sim = await auditRetention(ops.sql, { dryRun: true }); assert.equal(sim.eligible, 12); assert.equal(sim.deleted, 0);
  const r = await auditRetention(ops.sql, { batch: 5 }); assert.equal(r.deleted, 12);
  assert.equal((await sys((tx) => tx`select count(*)::int as n from app.audit_log where at < now() - interval '180 days'`))[0].n, 0); assert.ok((await sys((tx) => tx`select count(*)::int as n from app.audit_log`))[0].n >= 3);
  // e o sinal não vale para a API
  const viaApi = await attempt(() => db.asUser(userId, (tx) => tx`delete from app.audit_log`)); assert.equal(viaApi.ok, false);
});

test('stats: números e alertas de limite', async () => {
  const s = await stats(ops.sql); assert.equal(s.users.active, 2); assert.equal(s.users.admins, 2); assert.equal(s.presentations.live, 1); assert.ok(s.dbBytes > 0); assert.equal(s.warnings.length, 0);
  const w = await stats(ops.sql, { warnDbGb: 0.000001 }); assert.ok(w.warnings.some((x) => /banco com/.test(x))); assert.equal(w.ok, false);
});
