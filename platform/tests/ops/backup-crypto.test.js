import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createEncryptStream, createDecryptStream, encryptBuffer, decryptBuffer, encryptedSize, parseKey, keyringFromEnv, signManifest, verifyManifest, HEADER_LEN, RECORD_OVERHEAD } from '../../tools/lib/backup-crypto.js';
import { plainSizeFromEncrypted } from '../../tools/lib/mirror.js';

const KEY = crypto.randomBytes(32), OTHER = crypto.randomBytes(32);
const CH = 1024; // blocos de 1 KiB nos testes (mínimo permitido) para exercitar vários blocos
const rnd = (n) => crypto.randomBytes(n);
const enc = (b, key = KEY) => encryptBuffer(key, b, { chunkSize: CH });

test('ida e volta em tamanhos de borda (0, 1, bloco-1, bloco, bloco+1, vários blocos)', async () => {
  for (const n of [0, 1, CH - 1, CH, CH + 1, 3 * CH, 3 * CH + 17, 50 * CH + 5]) {
    const plain = rnd(n), c = await enc(plain);
    assert.equal(c.length, encryptedSize(n, CH), `tamanho previsto para ${n}`);
    assert.equal(plainSizeFromEncrypted(c.length, CH), n, `tamanho em claro derivado para ${n}`);
    assert.ok((await decryptBuffer(KEY, c)).equals(plain), `conteúdo ${n}`);
  }
});

test('dois cifrados do mesmo conteúdo são diferentes (salt/nonce aleatórios) e o texto não aparece em claro', async () => {
  const plain = Buffer.from('SEGREDO-DE-TESTE-'.repeat(200));
  const a = await enc(plain), b = await enc(plain);
  assert.ok(!a.equals(b)); assert.equal(a.indexOf('SEGREDO-DE-TESTE'), -1);
});

test('streaming: pedaços de tamanhos irregulares dão o mesmo resultado', async () => {
  const plain = rnd(10 * CH + 123); const parts = []; let o = 0; while (o < plain.length) { const k = 1 + Math.floor(Math.random() * 3000); parts.push(plain.subarray(o, o + k)); o += k; }
  const out = []; await pipeline(Readable.from(parts), createEncryptStream(KEY, { chunkSize: CH }), createDecryptStream(KEY), async function (src) { for await (const c of src) out.push(c); });
  assert.ok(Buffer.concat(out).equals(plain));
  // decifrar em pedaços de 7 bytes (fronteiras de bloco no meio de pedaços)
  const c = await enc(plain); const small = []; for (let i = 0; i < c.length; i += 7) small.push(c.subarray(i, i + 7));
  const out2 = []; await pipeline(Readable.from(small), createDecryptStream(KEY), async function (src) { for await (const x of src) out2.push(x); });
  assert.ok(Buffer.concat(out2).equals(plain));
});

test('adulteração: qualquer byte alterado (cabeçalho, tamanho, nonce, texto, tag) é detectado', async () => {
  const plain = rnd(5 * CH + 9), c = await enc(plain);
  const positions = [0, 3, 5, 6, 9, 13, 25, 40, HEADER_LEN, HEADER_LEN + 2, HEADER_LEN + 4, HEADER_LEN + 10, HEADER_LEN + 4 + 12 + 100, HEADER_LEN + 4 + 12 + CH + 3, c.length - 1, c.length - 20, Math.floor(c.length / 2)];
  for (const p of positions) {
    const t = Buffer.from(c); t[p] ^= 0x01;
    await assert.rejects(() => decryptBuffer(KEY, t), (e) => e.name === 'ToolError', `byte ${p} alterado deveria falhar`);
  }
});

test('truncamento: cortar o arquivo em qualquer ponto (inclusive na fronteira de bloco) falha', async () => {
  const plain = rnd(4 * CH + 1), c = await enc(plain);
  const rec = 4 + 12 + CH + 16;
  const cuts = [0, 10, HEADER_LEN, HEADER_LEN + 3, HEADER_LEN + rec, HEADER_LEN + 2 * rec, HEADER_LEN + 4 * rec, c.length - 1, c.length - 16];
  for (const n of cuts) await assert.rejects(() => decryptBuffer(KEY, c.subarray(0, n)), /trunca|vazio|incomplet|autentica/i, `corte em ${n}`);
  // a mensagem para corte exatamente na fronteira diz TRUNCADO (o ataque mais sutil)
  await assert.rejects(() => decryptBuffer(KEY, c.subarray(0, HEADER_LEN + 2 * rec)), /TRUNCADO/);
});

test('reordenar, duplicar ou remover blocos falha; dados extras no fim falham', async () => {
  const plain = rnd(4 * CH), c = await enc(plain); const rec = 4 + 12 + CH + 16; const blocks = [0, 1, 2, 3, 4].map((i) => c.subarray(HEADER_LEN + i * rec, HEADER_LEN + (i + 1) * rec));
  const head = c.subarray(0, HEADER_LEN);
  const swap = Buffer.concat([head, blocks[1], blocks[0], blocks[2], blocks[3], blocks[4]]);
  await assert.rejects(() => decryptBuffer(KEY, swap), /autentica/);
  const dup = Buffer.concat([head, blocks[0], blocks[0], blocks[1], blocks[2], blocks[3], blocks[4]]);
  await assert.rejects(() => decryptBuffer(KEY, dup), /autentica/);
  const drop = Buffer.concat([head, blocks[0], blocks[2], blocks[3], blocks[4]]);
  await assert.rejects(() => decryptBuffer(KEY, drop), /autentica/);
  await assert.rejects(() => decryptBuffer(KEY, Buffer.concat([c, Buffer.from('lixo')])), /dados após o fim|extras|autentica|bloco/i);
  await assert.rejects(() => decryptBuffer(KEY, Buffer.concat([c, c])), /extras|após o fim/);
});

test('chave errada → mensagem clara; rotação: chave antiga no chaveiro decifra', async () => {
  const c = await enc(rnd(3000));
  await assert.rejects(() => decryptBuffer(OTHER, c), /chave informada não é a que cifrou/);
  const plain = rnd(3000), c2 = await enc(plain, OTHER);
  assert.ok((await decryptBuffer([KEY, OTHER], c2)).equals(plain));
});

test('não é backup / formato desconhecido', async () => {
  await assert.rejects(() => decryptBuffer(KEY, Buffer.from('PK\u0003\u0004 isto é um zip qualquer, nada a ver com backup'.repeat(5))), /não é um backup/);
  const c = await enc(rnd(10)); c[5] = 9; await assert.rejects(() => decryptBuffer(KEY, c), /não suportado/);
});

test('parseKey: valida tamanho/base64 sem vazar a chave na mensagem', () => {
  assert.equal(parseKey(KEY.toString('base64')).length, 32);
  for (const bad of ['', undefined, 'curta', Buffer.alloc(16).toString('base64'), '!!!não-é-base64!!!']) assert.throws(() => parseKey(bad), (e) => e.name === 'ToolError', `chave inválida ${JSON.stringify(bad)}`);
  try { parseKey(Buffer.alloc(16, 7).toString('base64')); assert.fail(); } catch (e) { assert.match(e.message, /32 bytes/); assert.ok(!e.message.includes(Buffer.alloc(16, 7).toString('base64'))); }
  const ring = keyringFromEnv({ BACKUP_ENCRYPTION_KEY: KEY.toString('base64'), BACKUP_ENCRYPTION_KEYS_OLD: OTHER.toString('base64') });
  assert.equal(ring.all.length, 2);
});

test('manifesto: MAC detecta qualquer alteração e chave errada', () => {
  const m = signManifest(KEY, { format: 'x', a: 1, tables: { 'app.users': { count: 3 } } });
  assert.ok(verifyManifest(KEY, m)); assert.ok(verifyManifest([OTHER, KEY], m));
  assert.ok(!verifyManifest(OTHER, m));
  assert.ok(!verifyManifest(KEY, { ...m, a: 2 }));
  assert.ok(!verifyManifest(KEY, { ...m, tables: { 'app.users': { count: 4 } } }));
  assert.ok(!verifyManifest(KEY, { ...m, mac: undefined }));
  assert.equal(RECORD_OVERHEAD, 32);
});
