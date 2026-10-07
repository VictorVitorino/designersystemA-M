/* Cota de armazenamento por pessoa (STORAGE_QUOTA_USER_MB, F9): vale ao registrar arquivo NOVO (PUT pela API, /uploads e finalize do upload direto);
   deduplicação nunca é barrada nem conta para quem só reenviou; 413 quota_exceeded com mensagem amigável; o admin vê storageBytes por pessoa.
   Banco real (RLS) + armazenamento local temporário (mini-app). Arquivo próprio: makeEnv recria o banco, então a cota ligada não afeta os outros testes. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { makeEnv, sha256Hex } from '../helpers/mini-app.js';
import { loadConfig } from '../../src/config.js';
import { Hono } from 'hono';
import { adminRoutes } from '../../src/routes/admin.js';
import { onError } from '../../src/middleware/error.js';

let env, A, B, ADM;
before(async () => {
  env = await makeEnv({ env: { STORAGE_QUOTA_USER_MB: '1' } });
  A = await env.mkUser({ name: 'Ana' }); B = await env.mkUser({ name: 'Bruno' }); ADM = await env.mkUser({ role: 'admin', name: 'Admin' });
});
after(async () => { await env.stop(); });

/** PNG válido com ~n bytes (ruído não comprime). */
async function pngOf(kb) { const side = Math.ceil(Math.sqrt((kb * 1024) / 3)); return sharp(randomBytes(side * side * 3), { raw: { width: side, height: side, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer(); }
const putRaw = (u, buf) => env.put(u, `/api/assets/${sha256Hex(buf)}`, { body: buf, headers: { 'content-type': 'application/octet-stream', 'x-asset-kind': 'image' } });
const usedBy = async (u) => Number((await env.sys((tx) => tx`select coalesce(sum(size_bytes), 0)::bigint n from app.assets where uploaded_by = ${u.id} and status in ('ready', 'pending')`))[0].n);

describe('cota por pessoa (1 MB neste teste)', () => {
  let first;
  test('dentro da cota passa; o arquivo novo que estoura → 413 quota_exceeded, mensagem amigável, nada gravado e rejeição auditada', async () => {
    first = await pngOf(600); assert.equal((await putRaw(A, first)).status, 201);
    const second = await pngOf(600); const puts = env.calls.put;
    const r = await putRaw(A, second);
    assert.equal(r.status, 413, r.text); assert.equal(r.json.error.code, 'quota_exceeded');
    assert.match(r.json.error.message, /limite é de 1 MB por pessoa e você já usa 0,6 MB/); assert.match(r.json.error.message, /administrador/);
    assert.deepEqual(Object.keys(r.json.error.details).sort(), ['fileBytes', 'quotaBytes', 'usedBytes']); assert.equal(r.json.error.details.quotaBytes, 1048576); assert.equal(r.json.error.details.usedBytes, first.length);
    assert.equal(env.calls.put, puts, 'os bytes não foram gravados');
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.assets where sha256 = ${sha256Hex(second)}`))[0].n, 0, 'nem o registro pendente ficou');
    const au = await env.sys((tx) => tx`select meta from app.audit_log where action = 'asset.reject' and entity_id = ${sha256Hex(second)}`); assert.deepEqual(au[0].meta.reasons, ['quota_exceeded']);
    assert.ok(await usedBy(A) <= 1048576);
  });
  test('deduplicação nunca é barrada: reenviar o que já existe (a própria pessoa ou outra) não ocupa espaço nem conta na cota de quem reenviou', async () => {
    assert.equal((await putRaw(A, first)).status, 200, 'a Ana reenvia o mesmo arquivo mesmo no limite');
    const bigB = await pngOf(900); assert.equal((await putRaw(B, bigB)).status, 201);
    assert.equal((await putRaw(B, first)).status, 200, 'o Bruno (quase sem espaço) reenvia o arquivo da Ana: deduplicado, liberado');
    assert.equal(await usedBy(B), bigB.length, 'o que veio da Ana não conta para o Bruno');
  });
  test('espaço liberado (arquivo marcado pela coleta de lixo) volta a valer', async () => {
    await env.sys((tx) => tx`update app.assets set status = 'deleted' where sha256 = ${sha256Hex(first)}`);
    assert.equal((await putRaw(A, await pngOf(600))).status, 201);
  });
  test('envios SIMULTÂNEOS da mesma pessoa não passam juntos do limite (trava por pessoa)', async () => {
    const C = await env.mkUser({ name: 'Rajada' }); const files = await Promise.all([pngOf(400), pngOf(400), pngOf(400), pngOf(400)]);
    const res = await Promise.all(files.map((f, i) => env.request(C, 'PUT', `/api/assets/${sha256Hex(f)}`, { body: f, headers: { 'content-type': 'application/octet-stream', 'x-asset-kind': 'image' }, ip: `198.51.100.${30 + i}` })));
    assert.equal(res.filter((r) => r.status === 201).length, 2, res.map((r) => r.status).join(',')); assert.equal(res.filter((r) => r.status === 413).length, 2);
    assert.ok(await usedBy(C) <= 1048576);
  });
  test('admin: GET /api/admin/users devolve storageBytes por pessoa (mesmo critério da cota)', async () => {
    // o mini-app não monta /api/admin: compõe aqui só essa rota, com o mesmo onError e o usuário admin "logado"
    const h = new Hono(); h.use('*', async (c, next) => { c.set('deps', env.deps); c.set('user', { id: ADM.id, role: 'admin', status: 'active', email: 'adm@am.test', displayName: 'Admin' }); await next(); });
    h.route('/api/admin', adminRoutes({ config: env.config, db: env.db, gotrue: {} })); h.onError(onError(env.deps));
    const res = await h.request('/api/admin/users?limit=100'); assert.equal(res.status, 200);
    const items = (await res.json()).items; const by = Object.fromEntries(items.map((u) => [u.id, u.storageBytes]));
    assert.equal(by[A.id], await usedBy(A)); assert.ok(by[A.id] > 0); assert.equal(by[B.id], await usedBy(B)); assert.equal(by[ADM.id], 0);
    assert.ok(items.every((u) => Number.isInteger(u.storageBytes)));
  });
});

describe('upload direto (driver s3 falso): cota pelo tamanho declarado em /uploads e pelo tamanho REAL no finalize', () => {
  const staged = new Map();
  before(() => {
    env.hooks.driver = 's3';
    env.hooks.createUpload = async (sha, o) => ({ url: `https://bucket.example/up/${o.stagingFor}/${sha}`, method: 'PUT', headers: { 'Content-Type': o.mime }, expiresAt: new Date(Date.now() + 300000).toISOString() });
    env.hooks.getStaging = async (u, sha) => { const b = staged.get(`${u}/${sha}`); return b ? { body: b, size: b.length } : null; };
    env.hooks.deleteStaging = async (u, sha) => { staged.delete(`${u}/${sha}`); };
    env.hooks.promoteStaging = async function (u, sha, o) { const b = staged.get(`${u}/${sha}`); const existed = !!(await this.head(sha)); if (!b) return { promoted: false, existed }; if (!existed) await this.put(sha, b, { mime: (o && o.mime) || 'application/octet-stream', verify: false }); staged.delete(`${u}/${sha}`); return { promoted: !existed, existed }; };
  });
  after(() => { for (const k of ['driver', 'createUpload', 'getStaging', 'deleteStaging', 'promoteStaging']) delete env.hooks[k]; });
  test('/uploads com tamanho declarado acima da cota → 413 sem URL nem registro', async () => {
    const D = await env.mkUser({ name: 'Direto' }); const sha = 'd'.repeat(64);
    const r = await env.post(D, '/api/assets/uploads', { json: { sha256: sha, size: 2 * 1048576, mime: 'image/png', kind: 'image' } });
    assert.equal(r.status, 413); assert.equal(r.json.error.code, 'quota_exceeded');
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.assets where sha256 = ${sha}`))[0].n, 0);
  });
  test('declarou pouco e enviou muito: o finalize confere o tamanho real → 413, preparo e registro descartados, nada promovido', async () => {
    const D = await env.mkUser({ name: 'Mentiroso' }); const buf = await pngOf(1200); const sha = sha256Hex(buf);
    const r = await env.post(D, '/api/assets/uploads', { json: { sha256: sha, size: 1000, mime: 'image/png', kind: 'image' } }); assert.equal(r.status, 200); assert.equal(r.json.mode, 'direct');
    staged.set(`${D.id}/${sha}`, buf);
    const f = await env.post(D, `/api/assets/${sha}/finalize`); assert.equal(f.status, 413, f.text); assert.equal(f.json.error.code, 'quota_exceeded');
    assert.equal(staged.has(`${D.id}/${sha}`), false, 'preparo apagado'); assert.equal(await env.storage.head(sha), null, 'nada na chave canônica');
    assert.equal((await env.sys((tx) => tx`select count(*)::int n from app.assets where sha256 = ${sha}`))[0].n, 0, 'registro pendente descartado');
  });
  test('dentro da cota o upload direto conclui normalmente', async () => {
    const D = await env.mkUser({ name: 'Direto ok' }); const buf = await pngOf(300); const sha = sha256Hex(buf);
    assert.equal((await env.post(D, '/api/assets/uploads', { json: { sha256: sha, size: buf.length, mime: 'image/png', kind: 'image' } })).status, 200);
    staged.set(`${D.id}/${sha}`, buf); const f = await env.post(D, `/api/assets/${sha}/finalize`); assert.equal(f.status, 201, f.text);
    assert.equal(await usedBy(D), buf.length);
  });
});

describe('configuração', () => {
  test('STORAGE_QUOTA_USER_MB: padrão 0 (desligada); inteiro ≥ 0; vira bytes', () => {
    assert.equal(loadConfig({ APP_ENV: 'test' }).storage.quotaUserBytes, 0);
    assert.equal(loadConfig({ APP_ENV: 'test', STORAGE_QUOTA_USER_MB: '2048' }).storage.quotaUserBytes, 2048 * 1048576);
    for (const bad of ['-1', '1.5', 'muito']) assert.throws(() => loadConfig({ APP_ENV: 'test', STORAGE_QUOTA_USER_MB: bad }), /STORAGE_QUOTA_USER_MB/);
  });
});
