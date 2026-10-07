import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tmp, rmrf, sha, startMoto, makeBucket } from './_helpers.js';
import { createStorage } from '../../src/storage/index.js';
import { FileStore, S3Store } from '../../tools/lib/targets.js';
import { mirrorObjects, verifyObjects, keyOfSha, restoreObjects } from '../../tools/lib/mirror.js';
import { parseKey } from '../../tools/lib/backup-crypto.js';

// Compatibilidade entre o driver de armazenamento da API (src/storage) e as ferramentas de operação (tools/lib): mesma chave a/xx/yy/<sha>.
const KEY = parseKey(crypto.randomBytes(32).toString('base64')); let moto;
before(async () => { moto = await startMoto(); if (moto) await makeBucket(moto.endpoint, 'compat'); });
after(async () => { if (moto) await moto.stop(); });
const files = (n) => Array.from({ length: n }, (_, i) => { const b = crypto.randomBytes(800 + i * 91); return { b, h: sha(b) }; });

for (const kind of ['local', 's3']) {
  test(`${kind}: objetos gravados pela API são lidos, espelhados, verificados e restaurados pelas ferramentas — e vice-versa`, async (t) => {
    if (kind === 's3' && !moto) return t.skip('moto_server não instalado neste ambiente');
    const dir = tmp('compat'), bk = tmp('compatbk'), out = tmp('compatout'); try {
      const prefix = 'c' + crypto.randomBytes(3).toString('hex');
      const api = kind === 'local' ? createStorage({ storage: { driver: 'local', localDir: dir } })
        : createStorage({ storage: { driver: 's3', s3: { endpoint: moto.endpoint, region: 'us-east-1', bucket: 'compat', accessKeyId: 'test', secretAccessKey: 'test', forcePathStyle: true } } });
      const ops = kind === 'local' ? new FileStore(dir, { secure: false }) : new S3Store({ bucket: 'compat', prefix: '', endpoint: moto.endpoint, accessKeyId: 'test', secretAccessKey: 'test', forcePathStyle: true });
      if (kind === 's3') for await (const o of ops.list('a/')) await ops.delete(o.key);   // bucket compartilhado entre testes: começa vazio
      const A = files(5), B = files(3);
      for (const f of A) await api.put(f.h, f.b, { mime: 'image/png' });               // a API grava
      for (const f of B) await ops.put(keyOfSha(f.h), f.b);                            // as ferramentas gravam (seed, restore)
      for (const f of [...A, ...B]) { assert.equal((await api.head(f.h))?.size, f.b.length, 'a API enxerga'); assert.ok((await api.verify(f.h)).ok, 'a API confere o hash'); }
      const listed = new Set(); for await (const o of ops.list('a/')) listed.add(o.key); for (const f of [...A, ...B]) assert.ok(listed.has(keyOfSha(f.h)), 'as ferramentas listam');
      const vr = await verifyObjects({ store: ops, items: [...A, ...B].map((f) => ({ sha256: f.h, size: f.b.length })) }); assert.ok(vr.pass, JSON.stringify(vr));
      const D = new FileStore(bk); const r = await mirrorObjects({ source: ops, dest: D, key: KEY }); assert.equal(r.copied, 8); assert.ok(r.complete);
      const O = new FileStore(out, { secure: false }); const rr = await restoreObjects({ backup: D, dest: O, keys: [KEY] }); assert.equal(rr.restored, 8);
      for (const f of [...A, ...B]) assert.ok((await O.head(keyOfSha(f.h)))?.size === f.b.length);
    } finally { rmrf(dir); rmrf(bk); rmrf(out); }
  });
}
