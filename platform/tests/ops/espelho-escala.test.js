import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { setup, OPS_URL, newKey, tmp, rmrf, sha, freshDb, dropDb, seedSmall, startMoto, makeBucket } from './_helpers.js';
import { createOpsDb } from '../../src/db.js';
import { migrate } from '../../tools/migrate.js';
import { backupDb, backupObjects, verifyDbBackup, pruneBackups, pruneObjects, loadRefs } from '../../tools/backup.js';
import { backupFreshness } from '../../tools/maintenance.js';
import { mirrorObjects, pruneMirror, restoreObjects, verifyObjects, keyOfSha, OBJ_PREFIX, SHARDS } from '../../tools/lib/mirror.js';
import { FileStore, openTarget } from '../../tools/lib/targets.js';
import { keyringFromEnv, parseKey, signManifest, encryptBuffer } from '../../tools/lib/backup-crypto.js';
import { manifestKey, refsKey, readJson, STATUS_OBJECTS } from '../../tools/lib/backup-catalog.js';
import { withDatabase } from '../../tools/lib/pg.js';

// Escala do backup de arquivos (achado F9, 500 GB–1 TB): comparação POR FATIA de prefixo (memória limitada), horário-limite com retomada,
// e poda SEGURA e opcional do espelho (só o que nenhum backup retido nem o banco atual usam, fora da origem e com idade mínima).
const KEY = parseKey(newKey()); const dirs = []; const dbs = [];
const pasta = (p) => { const d = tmp(p); dirs.push(d); return d; };
async function encher(store, n, tamanho = 300) { const shas = []; for (let i = 0; i < n; i++) { const b = crypto.randomBytes(tamanho + i); const h = sha(b); await store.put(keyOfSha(h), b); shas.push(h); } return shas; }
/** Embrulha um store contando as listagens (prefixo e quantos itens cada uma devolveu) e as leituras. */
function espiao(store) {
  const listas = []; let gets = 0; const onGet = { fn: null };
  return { listas, get gets() { return gets; }, onGet,
    store: { describe: () => store.describe(), head: (k) => store.head(k), put: (k, d) => store.put(k, d), delete: (k) => store.delete(k),
      async get(k) { gets++; if (onGet.fn) onGet.fn(); return store.get(k); },
      async *list(prefix) { const r = { prefix, n: 0 }; listas.push(r); for await (const o of store.list(prefix)) { r.n++; yield o; } } } };
}
after(() => { for (const d of dirs) rmrf(d); });

test('comparação por FATIA: cada listagem pede só a/xx/ (origem) e objects/a/xx/ (espelho), nunca o acervo inteiro', async () => {
  const S = new FileStore(pasta('esrc')), D = new FileStore(pasta('edst')); const shas = await encher(S, 60);
  const es = espiao(S), ed = espiao(D);
  const r = await mirrorObjects({ source: es.store, dest: ed.store, key: KEY, concurrency: 4 });
  assert.equal(r.copied, 60); assert.ok(r.complete); assert.equal(r.shardsDone, 256); assert.equal(r.shardsTotal, 256); assert.equal(r.stoppedByTime, false);
  assert.equal(es.listas.length, 256); assert.equal(ed.listas.length, 256);
  assert.ok(es.listas.every((l) => /^a\/[0-9a-f]{2}\/$/.test(l.prefix)), 'origem listada fatia por fatia'); assert.ok(ed.listas.every((l) => /^objects\/a\/[0-9a-f]{2}\/$/.test(l.prefix)), 'espelho listado fatia por fatia');
  const porFatia = new Map(); for (const h of shas) porFatia.set(h.slice(0, 2), (porFatia.get(h.slice(0, 2)) || 0) + 1);
  assert.equal(Math.max(...es.listas.map((l) => l.n)), Math.max(...porFatia.values()), 'a maior listagem tem o tamanho da maior fatia (memória ~ 1/256 do acervo)');
  // 2ª execução: nada a copiar e nenhum arquivo lido da origem
  const es2 = espiao(S); const r2 = await mirrorObjects({ source: es2.store, dest: D, key: KEY }); assert.equal(r2.copied, 0); assert.equal(r2.alreadyInDestination, 60); assert.equal(es2.gets, 0);
  assert.deepEqual(SHARDS.slice(0, 3), ['00', '01', '02']); assert.equal(SHARDS.at(-1), 'ff');
});

test('horário-limite: para de começar cópias, relata PARCIAL, e a execução seguinte continua de onde parou (sem copiar de novo)', async () => {
  const S = new FileStore(pasta('hsrc')), D = new FileStore(pasta('hdst')); const shas = await encher(S, 30);
  let relogio = 0; const es = espiao(S); es.onGet.fn = () => { relogio++; };   // cada arquivo lido "gasta" 1 unidade de tempo
  const r1 = await mirrorObjects({ source: es.store, dest: D, key: KEY, concurrency: 1, deadline: 5, now: () => relogio });
  assert.equal(r1.stoppedByTime, true); assert.equal(r1.copied, 5); assert.equal(r1.complete, false, 'parcial não é "completo"'); assert.ok(r1.shardsDone < 256); assert.equal(r1.failed.length, 0);
  const r2 = await mirrorObjects({ source: S, dest: D, key: KEY });
  assert.equal(r2.copied, 25); assert.equal(r2.alreadyInDestination, 5); assert.ok(r2.complete);
  const O = new FileStore(pasta('hout')); const rr = await restoreObjects({ backup: D, dest: O, keys: [KEY] }); assert.equal(rr.restored, 30);
  assert.ok((await verifyObjects({ store: O, items: shas.map((s) => ({ sha256: s })) })).pass);
  // horário já vencido antes de começar: nenhuma fatia, nada copiado
  const r3 = await mirrorObjects({ source: S, dest: new FileStore(pasta('hvaz')), key: KEY, deadline: 0, now: () => 1 }); assert.deepEqual([r3.stoppedByTime, r3.shardsDone, r3.copied], [true, 0, 0]);
});

test('status PARCIAL do espelho: guarda desde quando, mantém a data entre execuções parciais, e o frescor só reclama depois de 7 dias', async () => {
  const objs = pasta('pobjs'), bk = pasta('pbk'); await encher(new FileStore(objs), 12);
  const env = { BACKUP_TARGET: `file://${bk}`, BACKUP_ENCRYPTION_KEY: newKey(), STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: objs };
  const target = openTarget(env.BACKUP_TARGET, env); const keyring = keyringFromEnv(env);
  const a = await backupObjects({ env, target, keyring, deadline: Date.now() - 1 }); assert.equal(a.partial, true); assert.ok(a.partialSince); assert.equal(a.ok, true, 'parar no horário não é falha');
  const b = await backupObjects({ env, target, keyring, deadline: Date.now() - 1 }); assert.equal(b.partialSince, a.partialSince, 'continua parcial desde a 1ª vez');
  const desde = new Date(a.partialSince);
  const f1 = await backupFreshness({ target, keys: keyring.all, checkObjects: true, now: new Date(desde.getTime() + 86400e3) });
  assert.ok(!f1.problems.some((p) => /INCOMPLETO/.test(p)), 'parcial há 1 dia: normal na 1ª cópia'); assert.equal(f1.objects.partial, true);
  const f2 = await backupFreshness({ target, keys: keyring.all, checkObjects: true, maxHours: 24 * 30, now: new Date(desde.getTime() + 8 * 86400e3) });
  assert.ok(f2.problems.some((p) => /INCOMPLETO há 8\.0 dias/.test(p)), f2.problems.join(' | '));
  const c = await backupObjects({ env, target, keyring }); assert.deepEqual([c.partial, c.partialSince, c.copied], [false, null, 12]);
  const st = await readJson(target, STATUS_OBJECTS); assert.equal(st.partial, false);
});

test('poda do espelho (lógica): só fora da origem, sem referência e velho; simulação não apaga; travas de origem vazia e de fração', async () => {
  const S = new FileStore(pasta('psrc')), D = new FileStore(pasta('pdst')); const shas = await encher(S, 10);
  await mirrorObjects({ source: S, dest: D, key: KEY });
  const [emUso, referenciado, orfao] = shas; await S.delete(keyOfSha(referenciado)); await S.delete(keyOfSha(orfao));   // o GC apagou dois da origem
  const futuro = new Date(Date.now() + 60 * 86400e3); const protegidos = new Set([referenciado]);
  const sim = await pruneMirror({ source: S, dest: D, protegidos, now: futuro, maxFraction: 0.5 });
  assert.deepEqual([sim.candidates, sim.deleted, sim.keptReferenced, sim.keptInSource, sim.refused], [1, 0, 1, 8, null]); assert.ok(await D.head(`${OBJ_PREFIX}${keyOfSha(orfao)}.enc`), 'simulação não apaga');
  const novo = await pruneMirror({ source: S, dest: D, protegidos, apply: true, now: new Date() }); assert.deepEqual([novo.candidates, novo.keptYoung, novo.deleted], [0, 1, 0], 'menos de 30 dias no espelho: fica');
  const ap = await pruneMirror({ source: S, dest: D, protegidos, apply: true, now: futuro, maxFraction: 0.5 }); assert.deepEqual([ap.deleted, ap.ok], [1, true]);
  assert.equal(await D.head(`${OBJ_PREFIX}${keyOfSha(orfao)}.enc`), null); assert.ok(await D.head(`${OBJ_PREFIX}${keyOfSha(referenciado)}.enc`), 'referenciado por backup retido: fica'); assert.ok(await D.head(`${OBJ_PREFIX}${keyOfSha(emUso)}.enc`));
  // travas: origem vazia (configuração errada) e poda grande demais
  const vazia = await pruneMirror({ source: new FileStore(pasta('pvazia')), dest: D, protegidos: new Set(), apply: true, now: futuro }); assert.match(vazia.refused, /VAZIA/); assert.equal(vazia.deleted, 0);
  for (const h of shas.slice(3, 9)) await S.delete(keyOfSha(h));
  const muito = await pruneMirror({ source: S, dest: D, protegidos: new Set(), apply: true, now: futuro, maxFraction: 0.1 }); assert.match(muito.refused, /mais que 10%/); assert.equal(muito.deleted, 0);
  await assert.rejects(() => pruneMirror({ source: S, dest: D, protegidos: [] }), /protegidos/);
});

// ------------------------------------------------------------------------------------------------ ponta a ponta com banco + S3 falso
let e2e = null;
before(async () => {
  const moto = await startMoto(); if (!moto) return;
  const { db, ops } = await setup(); await db.end(); await ops.end();
  const src = await freshDb('espelho'); dbs.push(src); await migrate(src, { apiPassword: 'app_api_test', log: () => {} });
  const nome = new URL(src).pathname.slice(1); const opsSrc = createOpsDb({ url: withDatabase(OPS_URL, nome) });
  const objs = pasta('e2eobjs'); const store = new FileStore(objs, { secure: false }); const seeded = await seedSmall(opsSrc, store, { files: 5 });
  await makeBucket(moto.endpoint, 'canteiro-backup');
  const env = { ...process.env, DATABASE_ADMIN_URL: src, BACKUP_TARGET: `s3://canteiro-backup/esc-${crypto.randomBytes(3).toString('hex')}`, BACKUP_S3_ENDPOINT: moto.endpoint, BACKUP_S3_REGION: 'auto', BACKUP_S3_ACCESS_KEY_ID: 'test', BACKUP_S3_SECRET_ACCESS_KEY: 'test',
    BACKUP_ENCRYPTION_KEY: newKey(), BACKUP_ENV_NAME: 'production', STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: objs, PG_BIN_DIR: process.env.PG_BIN_DIR || '' };
  e2e = { moto, src, opsSrc, store, seeded, env, target: openTarget(env.BACKUP_TARGET, env), keyring: keyringFromEnv(env) };
});
after(async () => { if (e2e) { await e2e.opsSrc.end(); await e2e.moto.stop(); } for (const u of dbs) await dropDb(u).catch(() => {}); });

test('ponta a ponta (banco + R2 falso): cada backup guarda a lista cifrada dos arquivos que referencia; a poda só apaga o que NENHUM backup retido usa', async (t) => {
  if (!e2e) return t.skip('moto_server não instalado neste ambiente');
  const { env, target, keyring, opsSrc, store, seeded } = e2e;
  // um arquivo a mais, registrado no banco: vai para o 1º backup e para o espelho
  const extra = crypto.randomBytes(4321); const hx = sha(extra); await store.put(keyOfSha(hx), extra);
  await opsSrc.asSystem((tx) => tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by, ready_at) values (${hx}, ${extra.length}, 'image/png', 'image', 'ready', ${seeded.userId}, now())`);
  const b1 = await backupDb({ env, target, keyring, now: new Date(Date.now() - 2 * 86400e3) }); assert.equal(b1.verified, true);
  await backupObjects({ env, target, keyring });
  const m1 = await readJson(target, manifestKey(b1.name)); assert.equal(m1.refs.count, 6); assert.equal(m1.refs.key, refsKey(b1.name));
  const lista = await loadRefs({ target, manifest: m1, keys: keyring.all }); assert.ok(lista.has(hx) && seeded.shas.every((s) => lista.has(s)));
  // o GC tirou o arquivo do banco e da origem
  await opsSrc.asSystem((tx) => tx`delete from app.assets where sha256 = ${hx}`); await store.delete(keyOfSha(hx));
  const b2 = await backupDb({ env, target, keyring }); const m2 = await readJson(target, manifestKey(b2.name)); assert.equal(m2.refs.count, 5);
  const futuro = new Date(Date.now() + 60 * 86400e3);
  const p1 = await pruneObjects({ env, target, keyring, apply: true, now: futuro, maxFraction: 0.5 });
  assert.equal(p1.deleted, 0); assert.equal(p1.keptReferenced, 1, 'o 1º backup (ainda retido) referencia o arquivo: ele fica'); assert.equal(p1.backupsConsiderados, 2);
  // o 1º backup sai da retenção → o arquivo pode sair do espelho
  const pr = await pruneBackups({ target, apply: true, minKeep: 1, daily: 1, weekly: 0, monthly: 0 }); assert.ok(pr.removed.includes(b1.name)); assert.equal(await target.head(refsKey(b1.name)), null, 'a lista sai junto com o backup');
  const sim = await pruneObjects({ env, target, keyring, now: futuro, maxFraction: 0.5 }); assert.deepEqual([sim.candidates, sim.deleted], [1, 0]);
  const p2 = await pruneObjects({ env, target, keyring, apply: true, now: futuro, maxFraction: 0.5 }); assert.equal(p2.deleted, 1); assert.equal(await target.head(`${OBJ_PREFIX}${keyOfSha(hx)}.enc`), null);
  for (const h of seeded.shas) assert.ok(await target.head(`${OBJ_PREFIX}${keyOfSha(h)}.enc`), 'os arquivos em uso continuam no espelho');
});

test('ponta a ponta: backup retido SEM a lista (versão antiga) bloqueia a poda; lista adulterada reprova a verificação', async (t) => {
  if (!e2e) return t.skip('moto_server não instalado neste ambiente');
  const { env, target, keyring } = e2e;
  const b = await backupDb({ env, target, keyring, now: new Date(Date.now() - 86400e3) });
  // simula um backup feito antes desta versão: manifesto (com MAC válido) sem o campo refs
  const m = await readJson(target, manifestKey(b.name)); const { mac: _m, ...resto } = m; delete resto.refs; const semRefs = signManifest(keyring.current, resto);
  await target.put(manifestKey(b.name), Buffer.from(JSON.stringify(semRefs)));
  const r = await pruneObjects({ env, target, keyring, apply: true, now: new Date(Date.now() + 60 * 86400e3) });
  assert.match(r.refused, /sem a lista de arquivos referenciados/); assert.deepEqual(r.backupsSemLista, [b.name]); assert.equal(r.deleted, 0);
  await target.put(manifestKey(b.name), Buffer.from(JSON.stringify(m)));   // volta o manifesto original
  // lista trocada por outra (cifrada com a chave certa, mas diferente do manifesto) → a verificação do backup reprova
  await target.put(refsKey(b.name), await encryptBuffer(keyring.current, Buffer.from('nada')));
  await assert.rejects(() => verifyDbBackup({ env, target, name: b.name, keys: keyring.all }), /não confere|NÃO passou/);
  const s = postgres(e2e.src, { max: 1, onnotice: () => {} }); try { const [x] = await s`select count(*)::int as n from app.assets`; assert.equal(x.n, 5); } finally { await s.end(); }
});
