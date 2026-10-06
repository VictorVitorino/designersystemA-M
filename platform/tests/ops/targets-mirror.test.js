import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { newKey, tmp, rmrf, sha, startMoto, makeBucket } from './_helpers.js';
import { FileStore, S3Store, openTarget, assertSeparateFromPrimary, assertKey } from '../../tools/lib/targets.js';
import { mirrorObjects, restoreObjects, verifyObjects, keyOfSha, OBJ_PREFIX } from '../../tools/lib/mirror.js';
import { parseKey, encryptBuffer } from '../../tools/lib/backup-crypto.js';

const KEY = parseKey(newKey()); const read = async (rs) => { const c = []; for await (const x of rs) c.push(x); return Buffer.concat(c); };
let moto = null;
before(async () => { moto = await startMoto(4301); if (moto) await makeBucket(moto.endpoint, 'principal'), await makeBucket(moto.endpoint, 'backup'); });
after(async () => { if (moto) await moto.stop(); });

const s3 = (bucket, prefix = '') => new S3Store({ bucket, prefix, endpoint: moto.endpoint, accessKeyId: 'test', secretAccessKey: 'test', forcePathStyle: true });

for (const kind of ['file', 's3']) {
  test(`${kind}: put/get/head/list/delete e chaves seguras`, async (t) => {
    if (kind === 's3' && !moto) return t.skip('moto_server não instalado neste ambiente');
    const dir = tmp('store'); try {
      const st = kind === 'file' ? new FileStore(dir) : s3('backup', 'teste-' + crypto.randomBytes(3).toString('hex'));
      await st.put('db/a.txt', Buffer.from('olá')); await st.put('db/b/c.bin', (async function* () { yield Buffer.from('x'.repeat(10)); yield Buffer.from('y'.repeat(10)); })());
      assert.equal((await read(await st.get('db/a.txt'))).toString(), 'olá'); assert.equal((await st.head('db/b/c.bin')).size, 20); assert.equal(await st.head('nao/existe'), null);
      const keys = []; for await (const o of st.list('db/')) keys.push(o.key); assert.deepEqual(keys.sort(), ['db/a.txt', 'db/b/c.bin']);
      await st.delete('db/a.txt'); assert.equal(await st.head('db/a.txt'), null);
      await assert.rejects(() => st.get('db/nao-existe'), /não encontrado/);
      for (const bad of ['../fora', '/abs', 'a/../../b', 'a//b', '', 'a/./b']) assert.throws(() => assertKey(bad), /inválida/, bad);
    } finally { rmrf(dir); }
  });
}
test('file: falha no meio do fluxo não deixa arquivo parcial nem arquivo final', async () => {
  const dir = tmp('atomic'); try {
    const st = new FileStore(dir);
    await assert.rejects(() => st.put('db/x.enc', (async function* () { yield Buffer.from('parcial'); throw new Error('queda de rede'); })()), /queda de rede/);
    const all = []; for await (const o of st.list('')) all.push(o.key); assert.deepEqual(all, []); assert.deepEqual(fs.readdirSync(path.join(dir, 'db')), []);
  } finally { rmrf(dir); }
});
test('S3: upload multipart (> 5 MB) é íntegro e falha no meio aborta o multipart', async (t) => {
  if (!moto) return t.skip('moto_server não instalado neste ambiente');
  const st = s3('backup', 'mp'); const big = crypto.randomBytes(12 * 1024 * 1024);
  await st.put('big.bin', (async function* () { for (let i = 0; i < big.length; i += 1024 * 1024) yield big.subarray(i, i + 1024 * 1024); })());
  assert.ok((await read(await st.get('big.bin'))).equals(big));
  await assert.rejects(() => st.put('quebra.bin', (async function* () { yield big.subarray(0, 6 * 1024 * 1024); yield big.subarray(0, 6 * 1024 * 1024); throw new Error('boom'); })()), /boom/);
  assert.equal(await st.head('quebra.bin'), null);
});
test('openTarget valida destino e exige credenciais próprias do bucket de backup', () => {
  assert.throws(() => openTarget(''), /BACKUP_TARGET/); assert.throws(() => openTarget('ftp://x/y'), /não suportado/); assert.throws(() => openTarget('file:///'), /absoluto/);
  assert.throws(() => openTarget('s3://bucket/p', {}), /BACKUP_S3_ACCESS_KEY_ID/);
  assert.equal(openTarget('s3://b/p/q', { BACKUP_S3_ACCESS_KEY_ID: 'a', BACKUP_S3_SECRET_ACCESS_KEY: 'b' }).prefix, 'p/q');
});
test('separação: backup nunca no mesmo bucket/pasta/credencial do armazenamento principal', () => {
  const e = { STORAGE_DRIVER: 's3', S3_BUCKET: 'arq', S3_ENDPOINT: 'https://x.supabase.co/storage/v1/s3', S3_ACCESS_KEY_ID: 'AK1', S3_SECRET_ACCESS_KEY: 'sec1' };
  assert.ok(assertSeparateFromPrimary('s3://arq/backup', { ...e, BACKUP_S3_ENDPOINT: e.S3_ENDPOINT }).errors.some((x) => /MESMO bucket/.test(x)));
  assert.ok(assertSeparateFromPrimary('s3://outro/b', { ...e, BACKUP_S3_ENDPOINT: 'https://r2.exemplo', BACKUP_S3_ACCESS_KEY_ID: 'AK1' }).errors.some((x) => /credenciais próprias/.test(x)));
  assert.equal(assertSeparateFromPrimary('s3://outro/b', { ...e, BACKUP_S3_ENDPOINT: 'https://r2.exemplo', BACKUP_S3_ACCESS_KEY_ID: 'AK2' }).errors.length, 0);
  assert.ok(assertSeparateFromPrimary('file:///dados/arquivos/backup', { STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: '/dados/arquivos' }).errors.length === 1);
  assert.ok(assertSeparateFromPrimary('s3://outro/b', { ...e, BACKUP_ENCRYPTION_KEY: 'sec1', BACKUP_S3_ENDPOINT: 'https://r2.exemplo' }).errors.some((x) => /BACKUP_ENCRYPTION_KEY/.test(x)));
});

async function fill(store, n) { const shas = []; for (let i = 0; i < n; i++) { const b = crypto.randomBytes(500 + i * 300); const h = sha(b); await store.put(keyOfSha(h), b); shas.push(h); } return shas; }
test('espelho incremental: copia só o que falta, cifra no destino, não apaga nada, restaura e confere', async () => {
  const src = tmp('src'), dst = tmp('dst'), out = tmp('out'); try {
    const S = new FileStore(src), D = new FileStore(dst), O = new FileStore(out);
    const shas = await fill(S, 12);
    const r1 = await mirrorObjects({ source: S, dest: D, key: KEY }); assert.equal(r1.copied, 12); assert.equal(r1.alreadyInDestination, 0); assert.ok(r1.complete);
    // destino está cifrado: o conteúdo em claro não aparece
    const plain = await read(await S.get(keyOfSha(shas[0]))); const enc = await read(await D.get(`${OBJ_PREFIX}${keyOfSha(shas[0])}.enc`)); assert.equal(enc.indexOf(plain.subarray(0, 64)), -1);
    // segunda rodada: nada a copiar
    const r2 = await mirrorObjects({ source: S, dest: D, key: KEY }); assert.equal(r2.copied, 0); assert.equal(r2.alreadyInDestination, 12);
    // novos arquivos entram sozinhos; o que sumiu da origem NÃO some do destino
    const more = await fill(S, 3); await S.delete(keyOfSha(shas[1]));
    const r3 = await mirrorObjects({ source: S, dest: D, key: KEY }); assert.equal(r3.copied, 3); assert.equal(r3.extraInDestination, 1);
    assert.ok(await D.head(`${OBJ_PREFIX}${keyOfSha(shas[1])}.enc`), 'o espelho nunca apaga');
    // simulação não grava
    await fill(S, 1); const r4 = await mirrorObjects({ source: S, dest: D, key: KEY, dryRun: true }); assert.equal(r4.toCopy, 1); assert.equal(r4.copied, 0);
    // restauração: tudo volta com SHA conferido; segunda vez nada a restaurar
    const rr = await restoreObjects({ backup: D, dest: O, keys: [KEY] }); assert.equal(rr.failed.length, 0); assert.equal(rr.restored, 15);
    const vr = await verifyObjects({ store: O, items: [...shas, ...more].map((s) => ({ sha256: s })) }); assert.ok(vr.pass, JSON.stringify(vr));
    assert.equal((await restoreObjects({ backup: D, dest: O, keys: [KEY] })).alreadyPresent, 15);
  } finally { rmrf(src); rmrf(dst); rmrf(out); }
});
test('espelho: objeto corrompido na origem NÃO é copiado e é relatado; restauração detecta adulteração do espelho', async () => {
  const src = tmp('src'), dst = tmp('dst'), out = tmp('out'); try {
    const S = new FileStore(src), D = new FileStore(dst), O = new FileStore(out); const shas = await fill(S, 4);
    fs.appendFileSync(path.join(src, ...keyOfSha(shas[2]).split('/')), 'LIXO');   // bit rot / corrupção na origem
    const r = await mirrorObjects({ source: S, dest: D, key: KEY }); assert.deepEqual(r.corruptInSource, [shas[2]]); assert.equal(r.copied, 3); assert.equal(await D.head(`${OBJ_PREFIX}${keyOfSha(shas[2])}.enc`), null); assert.ok(!r.complete);
    const vr = await verifyObjects({ store: S, items: shas.map((s) => ({ sha256: s })) }); assert.deepEqual(vr.corrupt, [shas[2]]);
    // adultera um arquivo do espelho (um byte do meio) → restore reporta falha e não grava o objeto
    const p = path.join(dst, OBJ_PREFIX, ...keyOfSha(shas[0]).split('/')) + '.enc'; const b = fs.readFileSync(p); b[Math.floor(b.length / 2)] ^= 1; fs.writeFileSync(p, b);
    const rr = await restoreObjects({ backup: D, dest: O, keys: [KEY] }); assert.equal(rr.failed.length, 1); assert.equal(rr.restored, 2); assert.equal(await O.head(keyOfSha(shas[0])), null);
    // fonte ausente → relatado
    assert.deepEqual((await verifyObjects({ store: O, items: [{ sha256: 'f'.repeat(64) }] })).missing, ['f'.repeat(64)]);
  } finally { rmrf(src); rmrf(dst); rmrf(out); }
});
test('espelho em S3 (moto): origem e destino em buckets diferentes', async (t) => {
  if (!moto) return t.skip('moto_server não instalado neste ambiente');
  const S = s3('principal', 'arq-' + crypto.randomBytes(3).toString('hex')), D = s3('backup', 'espelho-' + crypto.randomBytes(3).toString('hex')); const shas = await fill(S, 8);
  const r = await mirrorObjects({ source: S, dest: D, key: KEY, concurrency: 3 }); assert.equal(r.copied, 8); assert.ok(r.complete);
  assert.equal((await mirrorObjects({ source: S, dest: D, key: KEY })).copied, 0);
  const O = new FileStore(tmp('o')); try { const rr = await restoreObjects({ backup: D, dest: O, keys: [KEY] }); assert.equal(rr.restored, 8); assert.ok((await verifyObjects({ store: O, items: shas.map((s) => ({ sha256: s })) })).pass); } finally { rmrf(O.root); }
});
