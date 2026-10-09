import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage, objectKey, shaFromKey, contentDisposition, assertMime, StorageKeyError, StorageIntegrityError, toBuffer } from '../../src/storage/index.js';
import { sha256Hex } from '../../src/lib/canonical.js';

const mk = (s) => { const b = Buffer.from(s); return [sha256Hex(b), b]; };
let base, root, st;
const newStorage = (dir = root) => createStorage({ storage: { driver: 'local', localDir: dir } });
before(async () => { base = await fsp.mkdtemp(path.join(os.tmpdir(), 'canteiro-st-')); });
after(async () => { await fsp.rm(base, { recursive: true, force: true }); });
beforeEach(async () => { root = await fsp.mkdtemp(path.join(base, 'r-')); st = newStorage(); });
const walk = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort();
const files = (d) => walk(d).filter((f) => fs.lstatSync(path.join(d, f)).isFile());

describe('fábrica e chaves', () => {
  test('driver desconhecido, config ausente, local sem pasta e s3 sem bucket lançam; criar não toca o disco', () => {
    assert.throws(() => createStorage({ storage: { driver: 'ftp' } }), /driver desconhecido/);
    assert.throws(() => createStorage({}), /config\.storage/);
    assert.throws(() => createStorage({ storage: { driver: 'local', localDir: '' } }), /STORAGE_LOCAL_DIR/);
    assert.throws(() => createStorage({ storage: { driver: 's3', s3: {} } }), /S3_BUCKET/);
    const dir = path.join(base, 'nao-existe-ainda'); newStorage(dir); assert.equal(fs.existsSync(dir), false);
  });
  test('objectKey = a/<sha[0..2]>/<sha[2..4]>/<sha>; shaFromKey é o inverso estrito', () => {
    const [sha] = mk('x'); assert.equal(objectKey(sha), `a/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`);
    assert.equal(shaFromKey(objectKey(sha)), sha);
    for (const bad of ['', 'a/xx/yy/zz', `a/00/00/${sha}`, `b/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`, `a/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}/`, null, 5]) assert.equal(shaFromKey(bad), null);
  });
  test('contentDisposition: sem injeção de cabeçalho, sem caminho, sem aspas; padrão attachment', () => {
    assert.equal(contentDisposition(), 'attachment'); assert.equal(contentDisposition('inline'), 'inline'); assert.equal(contentDisposition('qualquer'), 'attachment');
    const h = contentDisposition('attachment', 'a"b\r\nSet-Cookie: x=1\\..\\..\\/etc/passwd.pdf');
    assert.ok(!/[\r\n]/.test(h)); assert.ok(!h.includes('/') || h.includes("UTF-8''")); assert.match(h, /^attachment; filename="[^"\\]*"; filename\*=UTF-8''[A-Za-z0-9%._-]*$/);
    assert.match(contentDisposition('inline', 'relatório ação.png'), /filename="relat_rio a__o\.png"; filename\*=UTF-8''relat%C3%B3rio%20a%C3%A7%C3%A3o\.png$/);
    assert.match(contentDisposition('attachment', '...'), /filename="arquivo"/); assert.match(contentDisposition('attachment', '\u202Egpj.exe'), /filename="gpj\.exe"/);
  });
  test('assertMime e toBuffer', () => {
    assert.equal(assertMime('image/png'), 'image/png');
    for (const bad of [undefined, '', 'png', 'image/', 'image/png\r\nX: 1', 'IMAGE/PNG', 'a'.repeat(200) + '/x', 5]) assert.throws(() => assertMime(bad), StorageKeyError);
    assert.ok(Buffer.isBuffer(toBuffer(new Uint8Array(3)))); assert.throws(() => toBuffer('texto'), TypeError);
  });
});

describe('local: operações básicas', () => {
  test('put → get/head/getStream/verify/delete (ciclo completo)', async () => {
    const [sha, b] = mk('olá, acervo');
    assert.deepEqual(await st.put(sha, b, { mime: 'text/csv' }), { created: true, size: b.length });
    assert.deepEqual(await st.head(sha), { size: b.length });
    const g = await st.get(sha); assert.ok(g.body.equals(b)); assert.equal(g.size, b.length);
    const s = await st.getStream(sha); assert.ok(s.stream instanceof ReadableStream); assert.equal(s.size, b.length);
    const chunks = []; for await (const c of s.stream) chunks.push(Buffer.from(c)); assert.ok(Buffer.concat(chunks).equals(b));
    assert.deepEqual(await st.verify(sha), { ok: true, size: b.length, actualSha: sha });
    assert.deepEqual(await st.delete(sha), { deleted: true });
    assert.equal(await st.get(sha), null); assert.equal(await st.head(sha), null); assert.equal(await st.getStream(sha), null);
    assert.deepEqual(await st.delete(sha), { deleted: false });
    assert.deepEqual(await st.verify(sha), { ok: false, size: null, actualSha: null });
  });
  test('layout em disco, permissões 0600 (arquivo) e 0700 (pastas)', async () => {
    const [sha, b] = mk('perm'); await st.put(sha, b, { mime: 'image/png' });
    const f = path.join(root, 'a', sha.slice(0, 2), sha.slice(2, 4), sha);
    assert.ok(fs.existsSync(f)); assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    for (const d of [root, path.join(root, 'a'), path.join(root, 'a', sha.slice(0, 2)), path.join(root, 'a', sha.slice(0, 2), sha.slice(2, 4))]) assert.equal(fs.statSync(d).mode & 0o777, 0o700, d);
    assert.deepEqual(files(root), [`a/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`]);
  });
  test('put é idempotente: não reescreve objeto igual (mesmo inode e mtime)', async () => {
    const [sha, b] = mk('idem'); await st.put(sha, b, { mime: 'image/png' });
    const f = path.join(root, objectKey(sha)); const a = fs.statSync(f); await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await st.put(sha, b, { mime: 'image/png' }), { created: false, size: b.length });
    const c = fs.statSync(f); assert.equal(c.ino, a.ino); assert.equal(c.mtimeMs, a.mtimeMs);
  });
  test('overwrite explícito repara objeto de mesmo tamanho; put normal continua idempotente', async () => {
    const [sha, bytes] = mk('integridade-mesmo-tamanho');
    await st.put(sha, bytes, { mime: 'text/csv' });
    const wrong = Buffer.from(bytes); wrong[0] ^= 0xff;
    await st.put(sha, wrong, { mime: 'text/csv', verify: false, overwrite: true });
    assert.equal((await st.verify(sha)).ok, false);
    assert.deepEqual(await st.put(sha, bytes, { mime: 'text/csv', overwrite: true }), { created: true, size: bytes.length });
    assert.equal((await st.verify(sha)).ok, true);
    assert.deepEqual(await st.put(sha, bytes, { mime: 'text/csv' }), { created: false, size: bytes.length });
  });
  test('put recusa bytes que não correspondem ao sha (envenenamento da dedup) e não grava nada', async () => {
    const [sha] = mk('verdadeiro'); await assert.rejects(() => st.put(sha, Buffer.from('falso'), { mime: 'image/png' }), (e) => e instanceof StorageIntegrityError && e.code === 'sha_mismatch');
    assert.deepEqual(files(root), []); assert.equal(await st.head(sha), null);
  });
  test('put: vazio, string, mime inválido e verify:false (opt-out explícito)', async () => {
    const [sha, b] = mk('v');
    await assert.rejects(() => st.put(sha, Buffer.alloc(0), { mime: 'image/png' }), (e) => e.code === 'empty');
    await assert.rejects(() => st.put(sha, 'texto', { mime: 'image/png' }), TypeError);
    await assert.rejects(() => st.put(sha, b, { mime: 'text/html\r\nX: y' }), StorageKeyError);
    await assert.rejects(() => st.put(sha, b, {}), StorageKeyError);
    const other = sha256Hex('outro'); await st.put(other, b, { mime: 'image/png', verify: false }); assert.equal((await st.verify(other)).ok, false); // opt-out existe, e o verify() denuncia
  });
  test('put aceita Uint8Array e ArrayBuffer', async () => {
    const [sha, b] = mk('tipos'); await st.put(sha, new Uint8Array(b), { mime: 'image/png' }); assert.ok((await st.get(sha)).body.equals(b));
    const [s2, b2] = mk('tipos2'); await st.put(s2, b2.buffer.slice(b2.byteOffset, b2.byteOffset + b2.length), { mime: 'image/png' }); assert.ok((await st.get(s2)).body.equals(b2));
  });
  test('URL assinada e upload direto não existem no driver local (null)', async () => {
    const [sha] = mk('x'); assert.equal(await st.signedGetUrl(sha, { ttlS: 60, filename: 'a.png' }), null); assert.equal(await st.createUpload(sha, { size: 1, mime: 'image/png' }), null);
  });
  test('ping', async () => { assert.equal(await st.ping(), true); });
  test('objetos grandes (30 MiB): put/verify/getStream sem estourar memória do teste', async () => {
    const b = Buffer.alloc(30 * 1024 * 1024, 7), sha = sha256Hex(b); await st.put(sha, b, { mime: 'application/pdf' });
    assert.equal((await st.verify(sha)).ok, true); const s = await st.getStream(sha); let n = 0; for await (const c of s.stream) n += c.length; assert.equal(n, b.length);
  });
});

describe('local: entradas maliciosas (path traversal e sha inválido)', () => {
  const [good] = mk('ok');
  const BAD = ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), '../'.repeat(30), '..' + 'a'.repeat(62), 'a'.repeat(62) + '..', 'a'.repeat(63), 'a'.repeat(65), good + '\n', ' ' + good, good + '/', `${good.slice(0, 2)}/${good.slice(2)}`,
    '/etc/passwd', 'C:\\Windows\\x', good.replace(/^./, '\0'), null, undefined, 123, [good], { toString: () => good }, Buffer.from(good), new String(good)];
  for (const op of ['put', 'get', 'getStream', 'head', 'delete', 'verify', 'signedGetUrl', 'createUpload']) {
    test(`${op}: todo sha que não seja 64 hex minúsculos lança StorageKeyError e não toca o disco`, async () => {
      const before = walk(base);
      for (const bad of BAD) {
        const call = op === 'put' ? () => st.put(bad, Buffer.from('x'), { mime: 'image/png' }) : op === 'createUpload' ? () => st.createUpload(bad, { size: 1, mime: 'image/png' }) : () => st[op](bad);
        await assert.rejects(call, (e) => e instanceof StorageKeyError, `${op}(${JSON.stringify(String(bad)).slice(0, 40)})`);
      }
      assert.deepEqual(walk(base), before);
    });
  }
  test('list: prefixo e cursor inválidos, limit inválido', async () => {
    for (const p of ['XYZ', '../', 'a/b', 'A', 'g', 'a'.repeat(65), 5, {}]) await assert.rejects(() => st.list({ prefix: p }), StorageKeyError);
    for (const c of ['abc', '../x', 'A'.repeat(64), {}]) await assert.rejects(() => st.list({ cursor: c }), StorageKeyError);
    for (const l of [0, -1, 1.5, 'x', NaN]) await assert.rejects(() => st.list({ limit: l }), StorageKeyError);
  });
  test('nada é criado fora da raiz, mesmo com raiz relativa com ".."', async () => {
    const parent = await fsp.mkdtemp(path.join(base, 'p-')); const sentinel = path.join(parent, 'sentinel'); fs.writeFileSync(sentinel, 'não mexa');
    const inner = path.join(parent, 'x', '..', 'obj'); const s2 = newStorage(inner); const [sha, b] = mk('dentro'); await s2.put(sha, b, { mime: 'image/png' });
    assert.deepEqual(fs.readdirSync(parent).sort(), ['obj', 'sentinel']); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'não mexa');
  });
});

describe('local: symlinks e adulteração', () => {
  test('objeto substituído por symlink: get/head/getStream/verify/put/delete não o seguem', async () => {
    const [sha, b] = mk('real'); await st.put(sha, b, { mime: 'image/png' });
    const secret = path.join(base, 'segredo.txt'); fs.writeFileSync(secret, 'SENHA-DO-BANCO');
    const f = path.join(root, objectKey(sha)); fs.rmSync(f); fs.symlinkSync(secret, f);
    for (const op of ['get', 'getStream', 'head', 'verify']) await assert.rejects(() => st[op](sha), (e) => e instanceof StorageIntegrityError && e.code === 'unsafe_path', op);
    await assert.rejects(() => st.put(sha, b, { mime: 'image/png' }), (e) => e.code === 'unsafe_path');
    assert.equal(fs.readFileSync(secret, 'utf8'), 'SENHA-DO-BANCO');
  });
  test('pasta intermediária (a/xx) trocada por symlink: put e get recusam; nada é gravado no destino do link', async () => {
    const [sha, b] = mk('pasta'); await st.put(sha, b, { mime: 'image/png' });  // cria a/xx/yy
    const outside = await fsp.mkdtemp(path.join(base, 'fora-')); const d1 = path.join(root, 'a', sha.slice(0, 2));
    fs.renameSync(d1, outside + '-orig'); fs.symlinkSync(outside, d1);
    const [sha2, b2] = (() => { for (let i = 0; ; i++) { const [s, b] = mk('colide' + i); if (s.startsWith(sha.slice(0, 2))) return [s, b]; } })();
    await assert.rejects(() => st.put(sha2, b2, { mime: 'image/png' }), (e) => e.code === 'unsafe_path');
    await assert.rejects(() => st.get(sha), (e) => e.code === 'unsafe_path');
    assert.deepEqual(fs.readdirSync(outside), []);
  });
  test('pasta "a" trocada por symlink também é recusada', async () => {
    await st.ping(); const outside = await fsp.mkdtemp(path.join(base, 'fora2-')); fs.symlinkSync(outside, path.join(root, 'a'));
    const [sha, b] = mk('a-link'); await assert.rejects(() => st.put(sha, b, { mime: 'image/png' }), (e) => e.code === 'unsafe_path'); assert.deepEqual(fs.readdirSync(outside), []);
    await assert.rejects(() => st.list({}), (e) => e.code === 'unsafe_path');
  });
  test('caminho do objeto é um DIRETÓRIO → recusado (não vira "cura")', async () => {
    const [sha, b] = mk('dir'); await st.put(sha, b, { mime: 'image/png' }); const f = path.join(root, objectKey(sha)); fs.rmSync(f); fs.mkdirSync(f);
    await assert.rejects(() => st.put(sha, b, { mime: 'image/png' }), (e) => e.code === 'unsafe_path'); await assert.rejects(() => st.get(sha), (e) => e.code === 'unsafe_path');
  });
  test('a PRÓPRIA raiz pode ser um symlink escolhido pelo operador (ex.: /data → volume)', async () => {
    const real = await fsp.mkdtemp(path.join(base, 'real-')); const link = path.join(base, 'link-raiz'); fs.symlinkSync(real, link);
    const s2 = newStorage(link); const [sha, b] = mk('via-link'); await s2.put(sha, b, { mime: 'image/png' }); assert.ok(fs.existsSync(path.join(real, objectKey(sha))));
  });
  test('verify detecta adulteração (conteúdo trocado, truncado) e put cura objeto com tamanho errado', async () => {
    const [sha, b] = mk('integro'); await st.put(sha, b, { mime: 'image/png' }); const f = path.join(root, objectKey(sha));
    fs.writeFileSync(f, Buffer.from('integrO')); let v = await st.verify(sha); assert.equal(v.ok, false); assert.notEqual(v.actualSha, sha); assert.equal(v.size, b.length);
    fs.writeFileSync(f, b.subarray(0, 3)); v = await st.verify(sha); assert.equal(v.ok, false); assert.equal(v.size, 3);
    assert.deepEqual(await st.put(sha, b, { mime: 'image/png' }), { created: true, size: b.length }); assert.equal((await st.verify(sha)).ok, true); assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  });
});

describe('local: escrita atômica e concorrência', () => {
  test('30 puts simultâneos do MESMO objeto: conteúdo íntegro, um arquivo, nenhum temporário', async () => {
    const b = Buffer.alloc(2 * 1024 * 1024, 3), sha = sha256Hex(b);
    const rs = await Promise.all(Array.from({ length: 30 }, () => st.put(sha, b, { mime: 'application/pdf' })));
    assert.ok(rs.every((r) => r.size === b.length)); assert.ok(rs.some((r) => r.created));
    assert.deepEqual(files(root), [objectKey(sha)]); assert.equal((await st.verify(sha)).ok, true);
  });
  test('leitor concorrente nunca vê objeto pela metade (escrita via temporário + rename)', async () => {
    const b = Buffer.alloc(8 * 1024 * 1024, 9), sha = sha256Hex(b); let torn = 0, seen = 0, done = false;
    const reader = (async () => { while (!done) { const g = await st.get(sha); if (g) { seen++; if (g.body.length !== b.length) torn++; } await new Promise((r) => setImmediate(r)); } })();
    await st.put(sha, b, { mime: 'application/pdf' }); await new Promise((r) => setTimeout(r, 30)); done = true; await reader;
    assert.equal(torn, 0); assert.ok(seen > 0);
  });
  test('falha no rename: não deixa objeto nem temporário para trás', async () => {
    const [sha, b] = mk('falha'); const orig = fsp.rename;
    fsp.rename = async () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); };
    try { await assert.rejects(() => st.put(sha, b, { mime: 'image/png' }), /boom/); } finally { fsp.rename = orig; }
    assert.deepEqual(files(root), []); assert.equal(await st.head(sha), null);
  });
  test('puts de objetos diferentes em paralelo (200) e list devolve todos, em ordem', async () => {
    const items = Array.from({ length: 200 }, (_, i) => mk('obj' + i)); await Promise.all(items.map(([s, b]) => st.put(s, b, { mime: 'image/png' })));
    const all = []; let cursor; do { const r = await st.list({ limit: 37, cursor }); all.push(...r.items.map((i) => i.sha)); cursor = r.next; } while (cursor);
    assert.deepEqual(all, items.map(([s]) => s).sort());
  });
});

describe('local: list', () => {
  test('páginas, prefixos de 1 a 64 caracteres, cursor, tamanho e chaves', async () => {
    const items = Array.from({ length: 40 }, (_, i) => mk('lst' + i)); for (const [s, b] of items) await st.put(s, b, { mime: 'image/png' });
    const sorted = items.map(([s]) => s).sort();
    const r = await st.list({}); assert.deepEqual(r.items.map((i) => i.sha), sorted); assert.deepEqual(r.keys, sorted.map(objectKey)); assert.equal(r.next, null);
    assert.ok(r.items.every((i) => i.size > 0 && i.lastModified instanceof Date && i.key === objectKey(i.sha)));
    const p1 = await st.list({ limit: 10 }); assert.equal(p1.items.length, 10); assert.equal(p1.next, sorted[9]);
    const p2 = await st.list({ limit: 10, cursor: p1.next }); assert.deepEqual(p2.items.map((i) => i.sha), sorted.slice(10, 20));
    const last = await st.list({ limit: 100, cursor: sorted[38] }); assert.deepEqual(last.items.map((i) => i.sha), [sorted[39]]); assert.equal(last.next, null);
    const exact = await st.list({ limit: 40 }); assert.equal(exact.next, null, 'página cheia sem mais nada não anuncia próxima');
    for (const n of [1, 2, 3, 4, 5, 12, 64]) { const pref = sorted[7].slice(0, n); assert.deepEqual((await st.list({ prefix: pref })).items.map((i) => i.sha), sorted.filter((s) => s.startsWith(pref)), 'prefixo ' + n); }
    assert.deepEqual((await st.list({ prefix: 'f'.repeat(64) })).items, []);
  });
  test('ignora lixo: temporários, nomes fora do formato, subpastas, symlinks', async () => {
    const [sha, b] = mk('so-eu'); await st.put(sha, b, { mime: 'image/png' }); const d = path.join(root, 'a', sha.slice(0, 2), sha.slice(2, 4));
    fs.writeFileSync(path.join(d, '.tmp-123-abc'), 'x'); fs.writeFileSync(path.join(d, 'README'), 'x'); fs.writeFileSync(path.join(d, sha.toUpperCase()), 'x'); fs.writeFileSync(path.join(d, sha.slice(0, 4) + 'zz'), 'x'); fs.writeFileSync(path.join(d, sha.slice(0, 30)), 'x'); fs.writeFileSync(path.join(d, sha + '0'), 'x'); fs.mkdirSync(path.join(d, 'sub'));
    fs.symlinkSync('/etc/passwd', path.join(d, sha.slice(0, 63) + (sha[63] === '0' ? '1' : '0'))); fs.mkdirSync(path.join(root, 'a', 'zz')); fs.writeFileSync(path.join(root, 'a', 'solto'), 'x');
    assert.deepEqual((await st.list({})).items.map((i) => i.sha), [sha]);
  });
  test('list em armazenamento vazio', async () => { assert.deepEqual(await st.list({}), { keys: [], items: [], next: null }); });
});
