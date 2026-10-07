/* Driver S3 testado contra um servidor S3 de verdade (moto, `python3 -m moto.server -p 4102`). Se o moto não puder ser iniciado, a suíte
   inteira é marcada como SKIP com o motivo — nunca simulamos o servidor para "passar". Os testes de degradação de checksum usam um
   cliente falso porque moto aceita o cabeçalho; eles verificam só a LÓGICA do driver, e estão rotulados como tal. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import util from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { S3Client, CreateBucketCommand, HeadObjectCommand, GetObjectAclCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createStorage, createS3Storage, objectKey, StorageKeyError, StorageIntegrityError } from '../../src/storage/index.js';
import { sha256Hex } from '../../src/lib/canonical.js';

const PORT = 4102, ENDPOINT = `http://127.0.0.1:${PORT}`, SECRET = 'segredo-de-teste-que-nunca-pode-vazar';
const probe = spawnSync('python3', ['-c', 'import moto.server'], { encoding: 'utf8' });
const skip = probe.status === 0 ? false : 'moto indisponível (instale com: pip install "moto[server]"): ' + String(probe.stderr || probe.error).split('\n').filter(Boolean).pop();

const cfgFor = (bucket, extra = {}) => ({ endpoint: ENDPOINT, region: 'us-east-1', bucket, accessKeyId: 'AKIATESTE', secretAccessKey: SECRET, forcePathStyle: true, ...extra });
const mk = (s) => { const b = Buffer.from(s); return [sha256Hex(b), b]; };
const portInUse = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });

let moto, raw, bucket, st, seen;
before(async () => {
  if (skip) return;
  if (await portInUse(PORT)) throw new Error(`porta ${PORT} já está em uso; não vou usar um servidor que não iniciei`);
  moto = spawn('python3', ['-m', 'moto.server', '-H', '127.0.0.1', '-p', String(PORT)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; moto.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 100 && !(await portInUse(PORT)); i++) { if (moto.exitCode !== null) throw new Error('moto encerrou: ' + err.slice(-500)); await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(await portInUse(PORT), 'moto não subiu: ' + err.slice(-500));
  bucket = 'canteiro-' + sha256Hex(String(Date.now()) + Math.random()).slice(0, 12);
  raw = new S3Client({ endpoint: ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'AKIATESTE', secretAccessKey: SECRET } });
  await raw.send(new CreateBucketCommand({ Bucket: bucket }));
  // cliente "espião": registra comando e cabeçalhos de cada requisição que o driver faz
  seen = [];
  const spy = new S3Client({ endpoint: ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'AKIATESTE', secretAccessKey: SECRET }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  spy.middlewareStack.add((next, ctx) => async (args) => { seen.push({ cmd: ctx.commandName, headers: { ...args.request.headers }, query: { ...(args.request.query || {}) } }); return next(args); }, { step: 'finalizeRequest', name: 'spy', priority: 'low' });
  st = createS3Storage(cfgFor(bucket), { client: spy });
});
after(async () => {
  if (moto && moto.exitCode === null) { const done = new Promise((r) => moto.once('exit', r)); moto.kill('SIGTERM'); await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]); if (moto.exitCode === null) moto.kill('SIGKILL'); }
});
const cmds = () => seen.map((s) => s.cmd);

describe('s3 (moto): operações básicas', { skip }, () => {
  test('put → head/get/getStream/verify/list/delete', async () => {
    const [sha, b] = mk('olá s3'); seen.length = 0;
    assert.deepEqual(await st.put(sha, b, { mime: 'image/png' }), { created: true, size: b.length });
    assert.deepEqual(cmds(), ['HeadObjectCommand', 'PutObjectCommand']);
    assert.deepEqual(await st.head(sha), { size: b.length });
    const g = await st.get(sha); assert.ok(g.body.equals(b)); assert.equal(g.size, b.length);
    const s = await st.getStream(sha); assert.ok(s.stream instanceof ReadableStream); assert.equal(s.size, b.length);
    const chunks = []; for await (const c of s.stream) chunks.push(Buffer.from(c)); assert.ok(Buffer.concat(chunks).equals(b));
    assert.deepEqual(await st.verify(sha), { ok: true, size: b.length, actualSha: sha });
    const l = await st.list({ prefix: sha.slice(0, 6) }); assert.deepEqual(l.keys, [objectKey(sha)]); assert.equal(l.items[0].size, b.length);
    assert.deepEqual(await st.delete(sha), { deleted: true }); assert.deepEqual(await st.delete(sha), { deleted: false });
    assert.equal(await st.get(sha), null); assert.equal(await st.getStream(sha), null); assert.equal(await st.head(sha), null);
    assert.deepEqual(await st.verify(sha), { ok: false, size: null, actualSha: null });
  });
  test('put grava Content-Type e Cache-Control imutável, só na chave a/xx/yy/sha, e NUNCA envia ACL', async () => {
    const [sha, b] = mk('headers'); seen.length = 0; await st.put(sha, b, { mime: 'application/pdf' });
    const h = await raw.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(sha) }));
    assert.equal(h.ContentType, 'application/pdf'); assert.equal(h.CacheControl, 'private, max-age=31536000, immutable'); assert.deepEqual(h.Metadata, {});
    for (const r of seen) for (const k of Object.keys(r.headers)) assert.ok(!/^x-amz-(acl|grant)/i.test(k), `cabeçalho de ACL enviado: ${k}`);
    const acl = await raw.send(new GetObjectAclCommand({ Bucket: bucket, Key: objectKey(sha) }));
    assert.ok(acl.Grants.every((g) => g.Grantee.Type === 'CanonicalUser' && !/AllUsers|AuthenticatedUsers/.test(JSON.stringify(g))), 'objeto não pode ter grant público');
  });
  test('put é idempotente: a 2ª chamada só faz HEAD (nenhuma escrita)', async () => {
    const [sha, b] = mk('idem-s3'); await st.put(sha, b, { mime: 'image/png' }); seen.length = 0;
    assert.deepEqual(await st.put(sha, b, { mime: 'image/png' }), { created: false, size: b.length }); assert.deepEqual(cmds(), ['HeadObjectCommand']);
  });
  test('objeto com mesmo sha mas tamanho errado (corrompido) é regravado', async () => {
    const [sha, b] = mk('cura-s3'); await raw.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey(sha), Body: Buffer.from('xx') }));
    assert.deepEqual(await st.put(sha, b, { mime: 'image/png' }), { created: true, size: b.length }); assert.equal((await st.verify(sha)).ok, true);
  });
  test('o SHA-256 vai como x-amz-checksum-sha256 (o servidor de objetos também confere)', async () => {
    const [sha, b] = mk('checksum-s3'); seen.length = 0; await st.put(sha, b, { mime: 'image/png' });
    const put = seen.find((r) => r.cmd === 'PutObjectCommand'); assert.equal(put.headers['x-amz-checksum-sha256'], Buffer.from(sha, 'hex').toString('base64'));
  });
  test('put recusa bytes diferentes do sha antes de qualquer requisição; vazio e mime inválido também', async () => {
    const [sha] = mk('a'); seen.length = 0;
    await assert.rejects(() => st.put(sha, Buffer.from('b'), { mime: 'image/png' }), (e) => e instanceof StorageIntegrityError && e.code === 'sha_mismatch');
    await assert.rejects(() => st.put(sha, Buffer.alloc(0), { mime: 'image/png' }), (e) => e.code === 'empty');
    await assert.rejects(() => st.put(sha, Buffer.from('a'), { mime: 'x\r\ny' }), StorageKeyError);
    assert.equal(seen.length, 0);
  });
  test('verify detecta objeto adulterado direto no bucket', async () => {
    const [sha, b] = mk('integro-s3'); await st.put(sha, b, { mime: 'image/png' });
    await raw.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey(sha), Body: Buffer.from('adulterad') }));
    const v = await st.verify(sha); assert.equal(v.ok, false); assert.notEqual(v.actualSha, sha); assert.equal(v.size, 9);
  });
  test('ping: bucket existe → true; bucket inexistente → false', async () => {
    assert.equal(await st.ping(), true); assert.equal(await createS3Storage(cfgFor('bucket-que-nao-existe-xyz')).ping(), false);
  });
  test('objetos de 12 MiB: put/verify/getStream', async () => {
    const b = Buffer.alloc(12 * 1024 * 1024, 5), sha = sha256Hex(b); await st.put(sha, b, { mime: 'application/pdf' });
    assert.equal((await st.verify(sha)).ok, true); const s = await st.getStream(sha); let n = 0; for await (const c of s.stream) n += c.length; assert.equal(n, b.length);
  });
});

describe('s3 (moto): entradas maliciosas', { skip }, () => {
  const [good] = mk('ok');
  const BAD = ['', 'abc', 'A'.repeat(64), '../'.repeat(30), '..' + 'a'.repeat(62), 'a'.repeat(63), 'a'.repeat(65), good + '\n', good + '/', '/etc/passwd', null, undefined, 5, [good], { toString: () => good }];
  for (const op of ['put', 'get', 'getStream', 'head', 'delete', 'verify', 'signedGetUrl', 'createUpload']) {
    test(`${op}: sha inválido lança StorageKeyError e NÃO faz requisição`, async () => {
      seen.length = 0;
      for (const bad of BAD) {
        const call = op === 'put' ? () => st.put(bad, Buffer.from('x'), { mime: 'image/png' }) : op === 'createUpload' ? () => st.createUpload(bad, { size: 1, mime: 'image/png' }) : () => st[op](bad);
        await assert.rejects(call, (e) => e instanceof StorageKeyError);
      }
      assert.equal(seen.length, 0);
    });
  }
  test('list: prefixo/cursor/limit inválidos', async () => {
    for (const p of ['XYZ', '../', 'a/b', 'A']) await assert.rejects(() => st.list({ prefix: p }), StorageKeyError);
    for (const c of ['abc', '../x']) await assert.rejects(() => st.list({ cursor: c }), StorageKeyError);
    for (const l of [0, -1, 1.5, 'x']) await assert.rejects(() => st.list({ limit: l }), StorageKeyError);
  });
});

describe('s3 (moto): URLs assinadas', { skip }, () => {
  test('GET assinado: baixa os bytes; attachment por padrão, inline só quando pedido; nome sanitizado; tipo forçado; TTL', async () => {
    const [sha, b] = mk('assinada'); await st.put(sha, b, { mime: 'image/png' });
    const u = await st.signedGetUrl(sha, { filename: 'rel "x"\r\n.png', mime: 'image/png' });
    const url = new URL(u); assert.equal(url.searchParams.get('X-Amz-Expires'), '300'); assert.ok(url.searchParams.get('X-Amz-Signature'));
    assert.ok(!u.includes(SECRET), 'segredo nunca aparece na URL'); assert.ok(url.pathname.endsWith(objectKey(sha)));
    const r = await fetch(u); assert.equal(r.status, 200); assert.ok(Buffer.from(await r.arrayBuffer()).equals(b));
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="rel _x_\.png"; filename\*=UTF-8''rel%20_x_\.png$/); assert.ok(!/[\r\n]/.test(r.headers.get('content-disposition'))); assert.equal(r.headers.get('content-type'), 'image/png');
    const inline = await fetch(await st.signedGetUrl(sha, { disposition: 'inline', filename: 'foto.png', mime: 'image/png' })); assert.match(inline.headers.get('content-disposition'), /^inline;/); await inline.arrayBuffer();
    const dflt = await fetch(await st.signedGetUrl(sha)); assert.equal(dflt.headers.get('content-disposition'), 'attachment'); await dflt.arrayBuffer();
  });
  test('TTL: ≤ 1 h (limitado), inteiro ≥ 1', async () => {
    const [sha] = mk('ttl'); const exp = async (ttlS) => new URL(await st.signedGetUrl(sha, { ttlS })).searchParams.get('X-Amz-Expires');
    assert.equal(await exp(60), '60'); assert.equal(await exp(999999), '3600'); assert.equal(await exp(10.9), '10');
    for (const bad of [0, -5, NaN, 'abc']) await assert.rejects(() => st.signedGetUrl(sha, { ttlS: bad }), StorageKeyError);
  });
  test('PUT assinado: o navegador envia o arquivo direto ao bucket; verify confirma; cabeçalhos assinados', async () => {
    const [sha, b] = mk('upload direto de um anexo'); const up = await st.createUpload(sha, { size: b.length, mime: 'application/pdf' });
    assert.equal(up.method, 'PUT'); assert.ok(Math.abs(Date.parse(up.expiresAt) - (Date.now() + 300_000)) < 5000);
    const u = new URL(up.url); const signed = u.searchParams.get('X-Amz-SignedHeaders').split(';');
    for (const h of ['content-length', 'content-type', 'host', 'x-amz-checksum-sha256', 'cache-control']) assert.ok(signed.includes(h), `${h} deve ser assinado: ${signed}`);
    assert.equal(up.headers['Content-Type'], 'application/pdf'); assert.equal(up.headers['x-amz-checksum-sha256'], Buffer.from(sha, 'hex').toString('base64'));
    assert.ok(!up.url.includes(SECRET)); assert.ok(!('Content-Length' in up.headers), 'Content-Length quem define é o navegador');
    const r = await fetch(up.url, { method: 'PUT', headers: up.headers, body: b }); assert.equal(r.status, 200, await r.text());
    assert.deepEqual(await st.verify(sha), { ok: true, size: b.length, actualSha: sha });
    assert.equal((await raw.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(sha) }))).ContentType, 'application/pdf');
  });
  test('upload direto com bytes ERRADOS: o provedor recusa OU o verify() do finalize denuncia (nunca fica "ok")', async () => {
    const [sha] = mk('o que foi declarado'); const evil = Buffer.from('conteúdo malicioso!!!'); const up = await st.createUpload(sha, { size: evil.length, mime: 'application/pdf' });
    const r = await fetch(up.url, { method: 'PUT', headers: up.headers, body: evil }); await r.arrayBuffer();
    if (r.ok) { const v = await st.verify(sha); assert.equal(v.ok, false); assert.notEqual(v.actualSha, sha); } else assert.ok(r.status >= 400);
  });
  test('área de preparo (AF-2): a URL escreve em up/<usuário>/<sha>; getStaging só lê a pasta do usuário; promoteStaging copia para a chave canônica e apaga o preparo; purgeStaging limpa abandonados', async () => {
    const uid = '11111111-2222-4333-8444-555555555555', other = '99999999-2222-4333-8444-555555555555';
    const [sha, b] = mk('arquivo grande enviado direto para o preparo'); const up = await st.createUpload(sha, { size: b.length, mime: 'application/pdf', stagingFor: uid });
    assert.ok(new URL(up.url).pathname.endsWith(`/up/${uid}/${sha}`), up.url);
    const r = await fetch(up.url, { method: 'PUT', headers: up.headers, body: b }); assert.equal(r.status, 200, await r.text());
    assert.equal(await st.head(sha), null, 'nada na chave canônica antes do finalize');
    assert.equal(await st.getStaging(other, sha), null, 'a pasta de preparo é por usuário');
    const stg = await st.getStaging(uid, sha); assert.ok(stg && stg.body.equals(b) && stg.size === b.length);
    assert.deepEqual(await st.promoteStaging(uid, sha, { mime: 'application/pdf' }), { promoted: true, existed: false });
    assert.deepEqual(await st.verify(sha), { ok: true, size: b.length, actualSha: sha }); assert.equal(await st.getStaging(uid, sha), null, 'preparo apagado após promover');
    assert.equal((await raw.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(sha) }))).ContentType, 'application/pdf');
    // segundo usuário com os MESMOS bytes: promover não regrava (deduplicação) e apaga o preparo dele
    const up2 = await st.createUpload(sha, { size: b.length, mime: 'application/pdf', stagingFor: other }); await (await fetch(up2.url, { method: 'PUT', headers: up2.headers, body: b })).arrayBuffer();
    assert.deepEqual(await st.promoteStaging(other, sha, { mime: 'application/pdf' }), { promoted: false, existed: true });
    assert.deepEqual(await st.deleteStaging(other, sha), { deleted: false });
    // preparo abandonado: a limpeza (idade zero aqui) apaga
    const up3 = await st.createUpload(sha, { size: b.length, mime: 'application/pdf', stagingFor: other }); await (await fetch(up3.url, { method: 'PUT', headers: up3.headers, body: b })).arrayBuffer();
    const pg = await st.purgeStaging({ olderThanMs: -60000 }); assert.ok(pg.deleted >= 1 && pg.bytes >= b.length); assert.equal(await st.getStaging(other, sha), null);
    for (const bad of ['nao-uuid', '', null, '../../x']) await assert.rejects(() => st.getStaging(bad, sha), StorageKeyError);
    await assert.rejects(() => st.createUpload(sha, { size: 1, mime: 'application/pdf', stagingFor: 'x' }), StorageKeyError);
  });
  test('createUpload: size/mime/ttl inválidos lançam; checksum:"off" não envia o cabeçalho', async () => {
    const [sha] = mk('cu');
    for (const size of [0, -1, 1.5, 2 ** 30 + 1, '10', undefined, NaN]) await assert.rejects(() => st.createUpload(sha, { size, mime: 'image/png' }), StorageKeyError);
    await assert.rejects(() => st.createUpload(sha, { size: 1, mime: 'image/png\r\nX: 1' }), StorageKeyError);
    await assert.rejects(() => st.createUpload(sha, { size: 1, mime: 'image/png', ttlS: 0 }), StorageKeyError);
    const off = createS3Storage(cfgFor(bucket, { checksum: 'off' })); const up = await off.createUpload(sha, { size: 1, mime: 'image/png' });
    assert.ok(!('x-amz-checksum-sha256' in up.headers)); assert.ok(!new URL(up.url).searchParams.get('X-Amz-SignedHeaders').includes('x-amz-checksum-sha256'));
  });
});

describe('s3 (moto): list', { skip }, () => {
  test('paginação por cursor, prefixos de 1 a 64 caracteres e chaves fora do formato são ignoradas', async () => {
    const own = createS3Storage(cfgFor(bucket)); // listagem global do bucket: usa prefixos únicos para isolar este teste
    const items = Array.from({ length: 30 }, (_, i) => mk('lista-s3-' + i)); for (const [s, b] of items) await own.put(s, b, { mime: 'image/png' });
    await raw.send(new PutObjectCommand({ Bucket: bucket, Key: 'a/zz/top/secret', Body: 'x' })); await raw.send(new PutObjectCommand({ Bucket: bucket, Key: 'x/fora.txt', Body: 'x' }));
    const mine = new Set(items.map(([s]) => s)); const sorted = [...mine].sort();
    const all = []; let cursor, pages = 0; do { const r = await own.list({ limit: 4, cursor }); all.push(...r.items.map((i) => i.sha)); cursor = r.next; pages++; } while (cursor);
    assert.deepEqual(all.filter((s) => mine.has(s)), sorted); assert.ok(pages > 7); assert.ok(all.every((s) => /^[0-9a-f]{64}$/.test(s)), 'só chaves canônicas'); assert.deepEqual([...all].sort(), all, 'ordenado');
    for (const n of [1, 2, 3, 4, 5, 12, 64]) { const pref = sorted[5].slice(0, n); const got = (await own.list({ prefix: pref, limit: 1000 })).items.map((i) => i.sha); assert.ok(got.includes(sorted[5]), 'prefixo ' + n); assert.ok(got.every((s) => s.startsWith(pref))); }
    const p1 = await own.list({ limit: 10 }); const p2 = await own.list({ limit: 10, cursor: p1.next }); assert.ok(p2.items[0].sha > p1.items[9].sha);
    assert.deepEqual((await own.list({ prefix: 'f'.repeat(64) })).items, []);
  });
});

describe('s3: lógica de degradação do checksum (cliente falso — só o driver é testado, não o provedor)', () => {
  // cliente REAL (para o presign funcionar) com `send` substituído: nenhuma rede é usada
  const fake = (onSend) => { const c = new S3Client({ region: 'us-east-1', endpoint: 'http://127.0.0.1:9', forcePathStyle: true, credentials: { accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake' } }); c.calls = []; c.send = async (cmd) => { c.calls.push({ name: cmd.constructor.name, input: cmd.input }); return onSend(cmd, c.calls.length); }; return c; };
  const notFound = () => Object.assign(new Error('nf'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
  test('provedor sem suporte ao cabeçalho (501/InvalidArgument checksum): repete sem checksum e lembra', async () => {
    const [sha, b] = mk('degrade'); const c = fake((cmd) => { if (cmd.constructor.name === 'HeadObjectCommand') throw notFound(); if (cmd.input.ChecksumSHA256) throw Object.assign(new Error('x-amz-checksum not implemented'), { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } }); return {}; });
    const s = createS3Storage({ bucket: 'b' }, { client: c });
    await s.put(sha, b, { mime: 'image/png' }); const puts = c.calls.filter((x) => x.name === 'PutObjectCommand'); assert.equal(puts.length, 2); assert.ok(puts[0].input.ChecksumSHA256); assert.ok(!puts[1].input.ChecksumSHA256);
    const [sha2, b2] = mk('degrade2'); await s.put(sha2, b2, { mime: 'image/png' }); const puts2 = c.calls.filter((x) => x.name === 'PutObjectCommand').slice(2); assert.equal(puts2.length, 1); assert.ok(!puts2[0].input.ChecksumSHA256);
    const up = await s.createUpload(sha, { size: b.length, mime: 'image/png' }); assert.ok(!('x-amz-checksum-sha256' in up.headers), 'depois de degradar, o upload direto também não exige checksum');
  });
  test('BadDigest (bytes errados) NÃO degrada: o erro sobe', async () => {
    const [sha, b] = mk('baddigest'); const c = fake((cmd) => { if (cmd.constructor.name === 'HeadObjectCommand') throw notFound(); throw Object.assign(new Error('digest'), { name: 'BadDigest', $metadata: { httpStatusCode: 400 } }); });
    await assert.rejects(() => createS3Storage({ bucket: 'b' }, { client: c }).put(sha, b, { mime: 'image/png' }), /digest/); assert.equal(c.calls.filter((x) => x.name === 'PutObjectCommand').length, 1);
  });
  test('erros de rede/5xx comuns sobem sem mascarar', async () => {
    const c = fake(() => { throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); });
    const s = createS3Storage({ bucket: 'b' }, { client: c }); const [sha] = mk('x');
    await assert.rejects(() => s.head(sha), /AccessDenied/); await assert.rejects(() => s.get(sha), /AccessDenied/);
  });
});

describe('s3: segredos, timeouts e retentativas', { skip }, () => {
  test('o objeto do driver não expõe credenciais (JSON, inspect, chaves enumeráveis)', () => {
    const s = createStorage({ storage: { driver: 's3', s3: cfgFor(bucket) } });
    assert.ok(!JSON.stringify(s).includes(SECRET)); assert.ok(!util.inspect(s, { depth: 6, showHidden: true }).includes(SECRET)); assert.ok(!Object.keys(s).join().match(/secret|key|credential/i));
    s.destroy();
  });
  test('retentativas FINITAS: servidor que derruba toda conexão → erro após 3 tentativas, não infinito', async () => {
    let conns = 0; const srv = net.createServer((sock) => { conns++; sock.destroy(); }); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const s = createS3Storage({ ...cfgFor('b'), endpoint: `http://127.0.0.1:${srv.address().port}` }); const [sha] = mk('retry');
    const t0 = Date.now(); await assert.rejects(() => s.head(sha)); const ms = Date.now() - t0;
    srv.close(); s.destroy(); assert.equal(conns, 3, `tentativas: ${conns}`); assert.ok(ms < 15000, ms + ' ms');
  });
  test('porta fechada (conexão recusada) falha rápido', async () => {
    const free = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const s = createS3Storage({ ...cfgFor('b'), endpoint: `http://127.0.0.1:${free}` }); const [sha] = mk('closed'); const t0 = Date.now(); await assert.rejects(() => s.get(sha)); assert.ok(Date.now() - t0 < 15000); s.destroy();
  });
  test('exigências mínimas de configuração', () => { assert.throws(() => createS3Storage({}), /S3_BUCKET/); assert.throws(() => createS3Storage(null), /S3_BUCKET/); });
});
