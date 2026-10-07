/* Arquivos: upload validado por conteúdo, hash conferido, deduplicação entre pessoas, leitura só para quem pode ver, cabeçalhos de segurança,
   upload direto/finalize, redirecionamento para URL assinada e limites. Banco real (RLS) + armazenamento local temporário (mini-app). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { makeEnv, deck, png, sha256Hex } from '../helpers/mini-app.js';

let env, A, B, C, ADM;
before(async () => {
  env = await makeEnv();
  A = await env.mkUser({ name: 'Ana' }); B = await env.mkUser({ name: 'Bruno' }); C = await env.mkUser({ name: 'Carla' }); ADM = await env.mkUser({ role: 'admin', name: 'Admin' });
});
after(async () => { await env.stop(); });

const putRaw = (u, sha, buf, headers = {}) => env.put(u, `/api/assets/${sha}`, { body: buf, headers: { 'content-type': 'application/octet-stream', ...headers } });
const rowOf = async (sha) => (await env.sys((tx) => tx`select * from app.assets where sha256 = ${sha}`))[0];
const ownersOf = async (sha) => (await env.sys((tx) => tx`select user_id from app.asset_uploads where sha256 = ${sha} order by user_id`)).map((r) => r.user_id);   // posses (prova de bytes)
const owners = async (sha) => (await env.sys((tx) => tx`select user_id from app.asset_uploads where sha256 = ${sha}`)).map((r) => r.user_id).sort();
const audits = (action, id) => env.sys((tx) => tx`select actor_id, meta from app.audit_log where action = ${action} and entity_id = ${id} order by id`);
const noise = (w, h) => sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();   // PNG válido e GRANDE
const tiny = (seed) => png(seed, 8);
const CSV = Buffer.from('nome;valor\nAna;10\nBruno;20\n');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('PUT /api/assets/:sha256 — envio pela API', () => {
  test('feliz: valida pelo conteúdo, grava no armazenamento ANTES de marcar pronto, registra posse e audita sem bytes', async () => {
    const buf = await tiny(101); const sha = sha256Hex(buf);
    const r = await putRaw(A, sha, buf, { 'x-asset-kind': 'image' });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json, { sha256: sha, size: buf.length, mime: 'image/png', width: 8, height: 8, deduplicated: false });
    const a = await rowOf(sha); assert.equal(a.status, 'ready'); assert.equal(a.uploaded_by, A.id); assert.equal(a.mime, 'image/png'); assert.equal(Number(a.size_bytes), buf.length); assert.ok(a.ready_at);
    assert.deepEqual(await owners(sha), [A.id]);
    const obj = await env.storage.get(sha); assert.ok(obj && obj.body.equals(buf), 'objeto idêntico no armazenamento');
    const au = await audits('asset.upload', sha); assert.equal(au.length, 1); assert.equal(au[0].actor_id, A.id); assert.deepEqual(Object.keys(au[0].meta).sort(), ['deduplicated', 'kind', 'mime', 'size']);
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.assets where status = 'pending'`))[0].n, 0, 'nada ficou "pending"');
  });
  test('o Content-Type e o nome enviados pelo cliente são ignorados: o tipo sai dos bytes', async () => {
    const buf = await tiny(102); const sha = sha256Hex(buf);
    const r = await putRaw(A, sha, buf, { 'content-type': 'text/html', 'x-asset-kind': 'image', 'content-disposition': 'attachment; filename="../../x.html"' });
    assert.equal(r.status, 201); assert.equal(r.json.mime, 'image/png'); assert.equal((await rowOf(sha)).mime, 'image/png');
  });
  test('reenvio do mesmo arquivo: 200, deduplicated:true e NADA é regravado no armazenamento', async () => {
    const buf = await tiny(103); const sha = sha256Hex(buf);
    assert.equal((await putRaw(A, sha, buf)).status, 201);
    const puts = env.calls.put;
    const again = await putRaw(A, sha, buf); assert.equal(again.status, 200); assert.equal(again.json.deduplicated, true);
    assert.equal(env.calls.put, puts, 'o armazenamento não foi tocado'); assert.deepEqual(await owners(sha), [A.id]);
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.assets where sha256 = ${sha}`))[0].n, 1);
  });
  test('2ª pessoa com os MESMOS bytes: só ganha a posse (deduplicated, sem regravar); antes disso não enxerga o arquivo', async () => {
    const buf = await tiny(104); const sha = sha256Hex(buf);
    await putRaw(A, sha, buf);
    assert.equal((await env.get(B, `/api/assets/${sha}`)).status, 404, 'sem posse nem apresentação visível: invisível');
    assert.equal((await env.post(B, '/api/assets/check', { json: { shas: [sha] } })).json.missing[0], sha);
    const puts = env.calls.put;
    const r = await putRaw(B, sha, buf); assert.equal(r.status, 200, r.text); assert.equal(r.json.deduplicated, true);
    assert.equal(env.calls.put, puts, 'um só objeto para as duas pessoas'); assert.deepEqual(await owners(sha), [A.id, B.id].sort());
    assert.equal((await rowOf(sha)).uploaded_by, A.id, 'o 1º envio continua sendo o registro de origem');
    assert.deepEqual((await env.post(B, '/api/assets/check', { json: { shas: [sha] } })).json.missing, []);
    assert.equal((await env.get(B, `/api/assets/${sha}`)).status, 200);
    assert.equal((await env.get(C, `/api/assets/${sha}`)).status, 404, 'a Carla continua sem acesso');
    const au = await audits('asset.upload', sha); assert.equal(au.length, 2); assert.equal(au[1].meta.deduplicated, true);
  });
  test('envio simultâneo dos mesmos bytes por 5 pessoas: 1 linha, 1 objeto íntegro, 5 posses, todos com sucesso', async () => {
    const buf = await tiny(105); const sha = sha256Hex(buf);
    const users = await Promise.all([1, 2, 3, 4, 5].map((i) => env.mkUser({ name: 'Corredor ' + i })));
    const res = await Promise.all(users.map((u, i) => putRaw(u, sha, buf, { 'x-test-ip': '198.51.100.' + (30 + i) })));
    assert.ok(res.every((r) => r.status === 200 || r.status === 201), res.map((r) => r.status + ' ' + r.text.slice(0, 80)).join(' | '));
    assert.equal(res.filter((r) => r.status === 201).length, 1, 'exatamente um criou');
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.assets where sha256 = ${sha}`))[0].n, 1); assert.equal((await owners(sha)).length, 5);
    assert.deepEqual(await env.storage.verify(sha), { ok: true, size: buf.length, actualSha: sha });
  });
  test('hash da URL diferente do conteúdo → 400, e nada é registrado nem gravado', async () => {
    const buf = await tiny(106); const other = sha256Hex(await tiny(107));
    const r = await putRaw(A, other, buf); assert.equal(r.status, 400); assert.equal(r.json.error.code, 'invalid_request');
    assert.equal(await rowOf(other), undefined); assert.equal(await env.storage.head(other), null); assert.equal(await rowOf(sha256Hex(buf)), undefined);
    for (const bad of ['xyz', sha256Hex(buf).toUpperCase(), sha256Hex(buf).slice(1), '..%2f..%2fetc%2fpasswd', '%00']) assert.equal((await putRaw(A, bad, buf)).status, 400, bad);
  });
  test('SVG, HTML disfarçado, imagem corrompida, vazio, tipo/kind incompatível: 415/422 e NADA gravado (nem "pending"); a rejeição é auditada', async () => {
    const cases = [
      ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>1</script></svg>'), 415],
      ['html .png', Buffer.from('<!doctype html><html><script>alert(1)</script></html>'), 415],
      ['png corrompido', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]), 422],
      ['jpeg truncado', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(50)]), 422],
      ['vazio', Buffer.alloc(0), 422],
      ['zip genérico', Buffer.concat([Buffer.from('PK\x03\x04'), randomBytes(100)]), 415],
      ['executável', Buffer.concat([Buffer.from('MZ'), randomBytes(100)]), 415],
      ['pdf em kind image', PDF, 415],
    ];
    for (const [nome, buf, status] of cases) {
      const sha = sha256Hex(buf);
      const r = await putRaw(A, sha, buf, { 'x-asset-kind': 'image' });
      assert.equal(r.status, status, `${nome}: ${r.status} ${r.text.slice(0, 120)}`); assert.ok(r.json.error.details.reasons.length, nome);
      assert.equal(await rowOf(sha), undefined, `${nome}: registrou`); assert.equal(await env.storage.head(sha), null, `${nome}: gravou`);
      if (buf.length) assert.equal((await audits('asset.reject', sha)).length, 1, `${nome}: sem auditoria`);
    }
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.assets where status <> 'ready'`))[0].n, 0);
    assert.equal((await putRaw(A, sha256Hex(CSV), CSV, { 'x-asset-kind': 'image' })).status, 415, 'CSV só como anexo');
    assert.equal((await putRaw(A, sha256Hex(await tiny(108)), await tiny(108), { 'x-asset-kind': 'attachment' })).status, 415, 'imagem não é anexo');
    assert.equal((await putRaw(A, sha256Hex(await tiny(109)), await tiny(109), { 'x-asset-kind': 'documento' })).status, 400, 'kind desconhecido');
  });
  test('anexos válidos (PDF, CSV) são aceitos como attachment e servidos como download', async () => {
    for (const [buf, mime] of [[PDF, 'application/pdf'], [CSV, 'text/csv']]) {
      const sha = sha256Hex(buf); const r = await putRaw(A, sha, buf, { 'x-asset-kind': 'attachment' });
      assert.equal(r.status, 201, r.text); assert.equal(r.json.mime, mime); assert.equal(r.json.width, undefined);
      const g = await env.get(A, `/api/assets/${sha}`); assert.equal(g.status, 200); assert.match(g.headers.get('content-disposition'), /^attachment; filename="[0-9a-f]{16}\.(pdf|csv)"/); assert.equal(g.headers.get('content-type'), mime);
    }
  });
  test('limites: corpo > 4 MB → 413 (sem ler o resto); Content-Length mentiroso → 413; miniatura > 512 KB → 413; uploads.max_bytes do admin vale', async () => {
    const big = await noise(1200, 1200); assert.ok(big.length > 4 * 1024 * 1024, 'o PNG de teste precisa passar de 4 MB');
    const r = await putRaw(A, sha256Hex(big), big); assert.equal(r.status, 413); assert.equal(r.json.error.code, 'too_large'); assert.equal(await env.storage.head(sha256Hex(big)), null);
    const lying = await env.put(A, `/api/assets/${sha256Hex(CSV)}`, { body: CSV, headers: { 'content-length': String(50 * 1024 * 1024), 'x-asset-kind': 'attachment' } });
    assert.equal(lying.status, 413);
    const th = await noise(500, 500); assert.ok(th.length > 512 * 1024);
    assert.equal((await putRaw(A, sha256Hex(th), th, { 'x-asset-kind': 'thumb' })).status, 413, 'miniatura grande');
    const mid = await noise(620, 620); assert.ok(mid.length > 1048576 && mid.length < 4 * 1024 * 1024);
    await env.sys((tx) => tx`update app.settings set value = '1048576' where key = 'uploads.max_bytes'`);
    try { assert.equal((await putRaw(A, sha256Hex(mid), mid)).status, 413, 'acima do limite configurado pelo admin'); }
    finally { await env.sys((tx) => tx`update app.settings set value = '104857600' where key = 'uploads.max_bytes'`); }
    assert.equal((await putRaw(A, sha256Hex(mid), mid)).status, 201, 'com o limite padrão (25 MB p/ imagem) passa');
  });
  test('sem login 401; usuário suspenso 403', async () => {
    const buf = await tiny(110); const sha = sha256Hex(buf);
    assert.equal((await putRaw(null, sha, buf)).status, 401);
    const S = await env.mkUser({ status: 'suspended' }); assert.equal((await putRaw(S, sha, buf)).status, 403);
    assert.equal(await rowOf(sha), undefined);
  });
});

describe('GET /api/assets/:sha256 — leitura', () => {
  let buf, sha;
  before(async () => { buf = await tiny(120); sha = sha256Hex(buf); await putRaw(A, sha, buf); });
  test('bytes + cabeçalhos exigidos (tipo do banco, nosniff, CSP sandbox, cache imutável privado, inline só p/ imagem, ETag = sha)', async () => {
    const r = await env.get(A, `/api/assets/${sha}`);
    assert.equal(r.status, 200); assert.ok(r.buffer.equals(buf));
    const h = (k) => r.headers.get(k);
    assert.equal(h('content-type'), 'image/png'); assert.equal(h('x-content-type-options'), 'nosniff'); assert.equal(h('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(h('cache-control'), 'private, max-age=31536000, immutable'); assert.equal(h('content-disposition'), 'inline'); assert.equal(h('etag'), `"${sha}"`); assert.equal(h('content-length'), String(buf.length));
    assert.equal(h('cross-origin-resource-policy'), 'same-origin');
  });
  test('If-None-Match com o ETag → 304 sem corpo (mas só para quem pode ver)', async () => {
    const r = await env.get(A, `/api/assets/${sha}`, { headers: { 'if-none-match': `"${sha}"` } }); assert.equal(r.status, 304); assert.equal(r.buffer.length, 0); assert.equal(r.headers.get('etag'), `"${sha}"`);
    const o = await env.get(C, `/api/assets/${sha}`, { headers: { 'if-none-match': `"${sha}"` } }); assert.equal(o.status, 404, 'o ETag não revela nada a quem não vê o arquivo');
  });
  test('quem não pode ver recebe 404 IDÊNTICO ao de arquivo inexistente (sem vazar existência); sem login 401', async () => {
    const ghost = 'a'.repeat(64);
    const hidden = await env.get(C, `/api/assets/${sha}`), nothing = await env.get(C, `/api/assets/${ghost}`);
    assert.equal(hidden.status, 404); assert.equal(hidden.text, nothing.text); assert.equal(hidden.headers.get('content-type'), nothing.headers.get('content-type'));
    assert.equal((await env.get(null, `/api/assets/${sha}`)).status, 401);
    for (const bad of ['xyz', sha.toUpperCase(), '..%2f..%2fetc%2fpasswd', sha.slice(2)]) assert.equal((await env.get(A, `/api/assets/${bad}`)).status, 404, bad);
  });
  test('acesso por apresentação: quem VÊ a apresentação que usa o arquivo o lê; lixeira alheia/exclusão fecha o acesso; admin lê tudo', async () => {
    const b2 = await tiny(121); const s2 = sha256Hex(b2); await putRaw(A, s2, b2);
    assert.equal((await env.get(B, `/api/assets/${s2}`)).status, 404);
    assert.equal((await env.get(ADM, `/api/assets/${s2}`)).status, 200, 'admin vê tudo');
    const p = await env.create(A, 'Com imagem', deck('Com imagem', { images: [s2] }));
    assert.equal((await env.get(B, `/api/assets/${s2}`)).status, 200, 'acervo comum: a imagem de apresentação visível é visível');
    assert.equal((await env.get(C, `/api/assets/${s2}`)).status, 200);
    await env.del(A, `/api/presentations/${p.id}`);
    assert.equal((await env.get(B, `/api/assets/${s2}`)).status, 404, 'na lixeira, some para os outros');
    assert.equal((await env.get(A, `/api/assets/${s2}`)).status, 200, 'e continua do dono');
    await env.post(A, `/api/presentations/${p.id}/restore`);
    assert.equal((await env.get(B, `/api/assets/${s2}`)).status, 200);
  });
  test('arquivo "pending" não é servido; objeto ausente no armazenamento = 404 (sem erro 500 nem vazamento)', async () => {
    const x = sha256Hex(Buffer.from('so-no-banco-' + Date.now()));
    await env.sys((tx) => tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by) values (${x}, 10, 'image/png', 'image', 'pending', ${A.id})`);
    assert.equal((await env.get(A, `/api/assets/${x}`)).status, 404);
    await env.sys((tx) => tx`update app.assets set status = 'ready' where sha256 = ${x}`);
    const r = await env.get(A, `/api/assets/${x}`); assert.equal(r.status, 404); assert.ok(!/ENOENT|\/tmp|canteiro-a3/.test(r.text));
  });
  test('arquivo grande (> 8 MB) com URL assinada → 302 sem cache; sem URL assinada (driver local) transmite os bytes', async () => {
    const x = sha256Hex(Buffer.from('grande-' + Date.now())); const small = await tiny(122); const sm = sha256Hex(small);
    await env.sys(async (tx) => { await tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by) values (${x}, ${9 * 1024 * 1024}, 'application/pdf', 'attachment', 'ready', ${A.id})`; });
    env.hooks.signedGetUrl = async (s, o) => `https://bucket.example/${s}?sig=1&disp=${o.disposition}`;
    try {
      const r = await env.get(A, `/api/assets/${x}`); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `https://bucket.example/${x}?sig=1&disp=attachment`); assert.equal(r.headers.get('cache-control'), 'private, no-store');
      assert.equal((await env.get(C, `/api/assets/${x}`)).status, 404, 'sem permissão não há redirecionamento');
      await putRaw(A, sm, small); assert.equal((await env.get(A, `/api/assets/${sm}`)).status, 200, 'pequeno continua transmitido pela API');
    } finally { delete env.hooks.signedGetUrl; }
  });
});

describe('POST /api/assets/check', () => {
  test('devolve só o que falta para ESTE usuário; valida entrada (≤ 200, hex64) e deduplica', async () => {
    const b1 = await tiny(130), b2 = await tiny(131); const s1 = sha256Hex(b1), s2 = sha256Hex(b2), s3 = 'c'.repeat(64);
    await putRaw(A, s1, b1); await putRaw(B, s2, b2);
    const r = await env.post(A, '/api/assets/check', { json: { shas: [s1, s2, s3, s3] } }); assert.equal(r.status, 200);
    assert.deepEqual(r.json.missing.sort(), [s2, s3].sort(), 's2 existe mas é do Bruno: falta a prova de posse da Ana');
    assert.deepEqual((await env.post(A, '/api/assets/check', { json: { shas: [] } })).json, { missing: [] });
    const many = Array.from({ length: 200 }, (_, i) => sha256Hex(Buffer.from('m' + i))); assert.equal((await env.post(A, '/api/assets/check', { json: { shas: many } })).status, 200);
    assert.equal((await env.post(A, '/api/assets/check', { json: { shas: [...many, s3] } })).status, 400);
    for (const bad of [{ shas: ['x'] }, { shas: [s1.toUpperCase()] }, { shas: 'x' }, {}, { shas: [s1], extra: 1 }, { shas: [null] }]) assert.equal((await env.post(A, '/api/assets/check', { json: bad })).status, 400, JSON.stringify(bad));
    assert.equal((await env.post(null, '/api/assets/check', { json: { shas: [] } })).status, 401);
  });
  test('limite de taxa de upload: 60/min → 429 com Retry-After', async () => {
    const left = 60000 - (Date.now() % 60000); if (left < 12000) await new Promise((r) => setTimeout(r, left + 200));
    await env.resetRates();
    const U = await env.mkUser({ name: 'Rajada de uploads' });
    let last; for (let i = 0; i < 60; i++) last = await env.post(U, '/api/assets/check', { json: { shas: [] }, ip: '198.51.100.77' });
    assert.equal(last.status, 200);
    const over = await env.post(U, '/api/assets/check', { json: { shas: [] }, ip: '198.51.100.77' });
    assert.equal(over.status, 429); assert.equal(over.json.error.code, 'rate_limited'); assert.ok(Number(over.headers.get('retry-after')) > 0);
    await env.resetRates();
  });
});

describe('upload direto (arquivos grandes) e finalize', () => {
  // S3 falso: URL assinada para a área de PREPARO do usuário (up/<usuário>/<sha>) e preparo em memória; promoteStaging grava na chave canônica do armazenamento real
  const staged = new Map(); const k = (u, sha) => `${u}/${sha}`;
  const fakeS3 = () => {
    env.hooks.driver = 's3';
    env.hooks.createUpload = async (sha, o) => ({ url: `https://bucket.example/up/${o.stagingFor}/${sha}`, method: 'PUT', headers: { 'Content-Type': o.mime }, expiresAt: new Date(Date.now() + 300000).toISOString() });
    env.hooks.getStaging = async (u, sha) => { const b = staged.get(k(u, sha)); return b ? { body: b, size: b.length } : null; };
    env.hooks.promoteStaging = async function (u, sha, o) { const b = staged.get(k(u, sha)); if (!b) return { promoted: false, existed: !!(await this.head(sha)) }; const existed = !!(await this.head(sha)); if (!existed) await this.put(sha, b, { mime: (o && o.mime) || 'application/octet-stream', verify: false }); staged.delete(k(u, sha)); return { promoted: !existed, existed }; };
    env.hooks.deleteStaging = async (u, sha) => ({ deleted: staged.delete(k(u, sha)) });
  };
  const stage = (user, sha, bytes) => { staged.set(k(user.id, sha), Buffer.from(bytes)); };   // = o navegador enviou os bytes para a URL assinada
  const real = () => { for (const h of ['driver', 'createUpload', 'getStaging', 'promoteStaging', 'deleteStaging']) delete env.hooks[h]; staged.clear(); };
  test('driver local → {mode:"api"} (e nada é registrado); entrada inválida → 400', async () => {
    const sha = sha256Hex(await tiny(140));
    const r = await env.post(A, '/api/assets/uploads', { json: { sha256: sha, size: 100, mime: 'image/png', kind: 'image' } }); assert.equal(r.status, 200); assert.deepEqual(r.json, { mode: 'api' });
    assert.equal(await rowOf(sha), undefined);
    for (const bad of [{ sha256: 'x', size: 1, mime: 'image/png', kind: 'image' }, { sha256: sha, size: 0, mime: 'image/png', kind: 'image' }, { sha256: sha, size: 1.5, mime: 'image/png', kind: 'image' },
      { sha256: sha, size: 10, mime: 'image/svg+xml', kind: 'image' }, { sha256: sha, size: 10, mime: 'text/html', kind: 'image' }, { sha256: sha, size: 10, mime: 'application/pdf', kind: 'image' },
      { sha256: sha, size: 10, mime: 'image/png', kind: 'outro' }, { sha256: sha, size: 10, mime: 'image/png', kind: 'image', x: 1 }]) assert.equal((await env.post(A, '/api/assets/uploads', { json: bad })).status, 400, JSON.stringify(bad));
    assert.equal((await env.post(A, '/api/assets/uploads', { json: { sha256: sha, size: 30 * 1024 * 1024, mime: 'image/png', kind: 'image' } })).status, 413, 'acima do limite de imagem');
  });
  test('fluxo completo: uploads → (navegador grava no bucket) → finalize valida, promove a ready e audita', async () => {
    fakeS3();
    try {
      const buf = await tiny(141); const sha = sha256Hex(buf);
      const up = await env.post(A, '/api/assets/uploads', { json: { sha256: sha, size: buf.length, mime: 'image/png', kind: 'image' } });
      assert.equal(up.status, 200, up.text); assert.equal(up.json.mode, 'direct'); assert.equal(up.json.method, 'PUT'); assert.ok(up.json.url.startsWith(`https://bucket.example/up/${A.id}/`), 'a URL escreve na área de preparo do próprio usuário'); assert.ok(Date.parse(up.json.expiresAt));
      const reg = await rowOf(sha); assert.equal(reg.status, 'pending'); assert.equal(reg.uploaded_by, A.id);
      assert.deepEqual(await ownersOf(sha), [], 'pedir a URL não concede posse: só o finalize, depois de conferir os bytes');
      assert.equal((await env.get(A, `/api/assets/${sha}`)).status, 404, 'pending não é servido');
      assert.equal((await env.post(B, `/api/assets/${sha}/finalize`)).status, 404, 'quem não iniciou o envio não finaliza');
      assert.equal((await env.post(A, `/api/assets/${sha}/finalize`)).status, 409, 'o objeto ainda não chegou ao bucket');
      stage(A, sha, buf);                                                           // = o navegador enviou para a URL assinada (área de preparo de A)
      const fin = await env.post(A, `/api/assets/${sha}/finalize`); assert.equal(fin.status, 201, fin.text);
      assert.ok(await env.storage.head(sha), 'promovido para a chave canônica'); assert.equal(await env.hooks.getStaging(A.id, sha), null, 'preparo apagado'); assert.deepEqual(await ownersOf(sha), [A.id]);
      assert.deepEqual(fin.json, { sha256: sha, size: buf.length, mime: 'image/png', width: 8, height: 8, deduplicated: false });
      assert.equal((await rowOf(sha)).status, 'ready'); assert.equal((await env.get(A, `/api/assets/${sha}`)).status, 200);
      assert.equal((await env.post(A, `/api/assets/${sha}/finalize`)).status, 200, 'finalize repetido é idempotente');
      const au = await audits('asset.upload', sha); assert.equal(au.length, 1); assert.equal(au[0].meta.direct, true);
    } finally { real(); }
  });
  test('finalize com bytes que NÃO têm o hash declarado: 422, objeto apagado, registro descartado, rejeição auditada', async () => {
    fakeS3();
    try {
      const good = await tiny(142); const sha = sha256Hex(good);
      await env.post(A, '/api/assets/uploads', { json: { sha256: sha, size: good.length, mime: 'image/png', kind: 'image' } });
      stage(A, sha, randomBytes(64));                                                     // lixo enviado para a área de preparo sob este hash
      const r = await env.post(A, `/api/assets/${sha}/finalize`); assert.equal(r.status, 422); assert.deepEqual(r.json.error.details.reasons, ['hash_divergente']);
      assert.equal(await env.storage.head(sha), null, 'nada chegou à chave canônica'); assert.equal(await env.hooks.getStaging(A.id, sha), null, 'o lixo foi removido do preparo'); assert.equal(await rowOf(sha), undefined, 'o registro pendente foi descartado');
      assert.equal((await audits('asset.reject', sha)).length, 1);
      // depois disso o arquivo bom ainda pode ser enviado normalmente
      assert.equal((await putRaw(B, sha, good)).status, 201);
    } finally { real(); }
  });
  test('finalize de arquivo com o hash certo mas conteúdo inválido (SVG anunciado como PNG): 422 e nada fica', async () => {
    fakeS3();
    try {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'); const sha = sha256Hex(svg);
      assert.equal((await env.post(A, '/api/assets/uploads', { json: { sha256: sha, size: svg.length, mime: 'image/png', kind: 'image' } })).status, 200, 'o servidor ainda não viu os bytes');
      stage(A, sha, svg);
      const r = await env.post(A, `/api/assets/${sha}/finalize`); assert.equal(r.status, 415);
      assert.equal(await env.storage.head(sha), null); assert.equal(await rowOf(sha), undefined); assert.equal((await audits('asset.reject', sha)).length, 1);
    } finally { real(); }
  });
  test('quem pré-registra (pending) um hash alheio NÃO consegue envenenar metadados: quando os bytes reais chegam, tipo/tamanho verdadeiros prevalecem', async () => {
    const buf = await tiny(143); const sha = sha256Hex(buf);
    await env.sys((tx) => tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by) values (${sha}, 7, 'application/pdf', 'attachment', 'pending', ${C.id})`);   // C pré-registrou com mentiras
    const r = await putRaw(A, sha, buf); assert.equal(r.status, 200, r.text);
    const a = await rowOf(sha); assert.equal(a.status, 'ready'); assert.equal(a.mime, 'image/png'); assert.equal(Number(a.size_bytes), buf.length); assert.equal(a.kind, 'image'); assert.equal(a.width, 8);
    assert.equal((await env.get(C, `/api/assets/${sha}`)).status, 200, 'C continua sendo possuidor do próprio registro');
    assert.equal((await env.get(B, `/api/assets/${sha}`)).headers.get('content-type'), 'application/json', 'B (sem acesso) recebe só o erro JSON');
  });
});
