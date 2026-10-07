/* Entrada da Vercel (api/index.js): o carregador Node da Vercel (@vercel/node — serverless-handler/bundling-handler, compileUserCode)
   desembrulha `.default` até 5 vezes e SÓ depois decide: se houver GET/POST/…/fetch, trata como "web handler" (Request → Response);
   senão, se for função, chama como (req, res) do Node. Com `export default <função>` a API inteira ficava sem resposta na Vercel
   (os testes locais não pegavam porque usam src/server.js). Este teste reproduz a mesma decisão e chama a rota de verdade. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'];
/** Mesma lógica do @vercel/node 22 (unwrapDefaults + detecção de web handler). */
function vercelKind(mod) {
  let listener = mod;
  for (let i = 0; i < 5; i++) { if (listener && listener.default) listener = listener.default; else break; }
  const web = HTTP_METHODS.some((m) => typeof listener[m] === 'function') || typeof listener.fetch === 'function';
  return { web, listener, kind: web ? 'web' : typeof listener === 'function' ? 'node(req,res)' : 'outro' };
}

test('api/index.js é tratado pela Vercel como web handler (GET/POST…), nunca como função (req, res)', async () => {
  Object.assign(process.env, {
    APP_ENV: 'local', APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/canteiro_dev', DATABASE_SSL: 'disable',
    SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'chave-anon-local-de-teste', SUPABASE_JWT_SECRET: 'segredo-jwt-local-de-teste-com-32-bytes-ou-mais',
    STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-vercel-entry-')), CSRF_SECRET: 'segredo-csrf-local-com-pelo-menos-32-caracteres', LOG_LEVEL: 'silent',
  });
  const mod = await import('../../api/index.js');
  assert.equal(mod.default, undefined, 'sem export default: a Vercel o desembrulharia antes de procurar GET/POST');
  const { web, listener, kind } = vercelKind(mod);
  assert.equal(kind, 'web', `a Vercel trataria a entrada como ${kind}`); assert.ok(web);
  for (const m of HTTP_METHODS) assert.equal(typeof listener[m], 'function', `${m} exportado`);
  const res = await listener.GET(new Request('https://canteiro.exemplo/api/health'));
  assert.equal(res.status, 200, 'GET /api/health responde pela entrada da Vercel');
  const body = await res.json(); assert.equal(body.ok, true);
});

test('a detecção reproduzida reprova o formato antigo (export default de função) — o teste acima pegaria a regressão', () => {
  const h = () => new Response('x');
  assert.equal(vercelKind({ default: h, GET: h, POST: h }).kind, 'node(req,res)');
  assert.equal(vercelKind({ GET: h, POST: h }).kind, 'web');
  assert.equal(vercelKind({ default: { fetch: h } }).kind, 'web');
});
