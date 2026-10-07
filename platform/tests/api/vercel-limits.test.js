/* PUB-08: na Vercel a função não recebe nem devolve corpo maior que 4,5 MB. Com VERCEL definida, salvar/criar apresentação aceita até 4 MiB
   (contados em BYTES do corpo, não em caracteres) com 413 amigável acima disso, e arquivos acima de 4 MiB não passam pela função (302 para a URL
   assinada; sem URL, 413 claro em vez de resposta cortada). Banco real + rotas reais (mini-app); arquivo próprio porque a config é por ambiente. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { makeEnv, deck, sha256Hex } from '../helpers/mini-app.js';

let env, A;
before(async () => { env = await makeEnv({ env: { VERCEL: '1' } }); A = await env.mkUser({ name: 'Ana' }); });
after(async () => { await env.stop(); });
const MiB = 1048576;
/** Deck cujo CORPO de requisição ({baseRev, content}) tem ~`bytes` bytes, com texto `ch` (multibyte para provar a contagem em bytes), repartido em
    caixas de texto de ≤ 512 KiB (cada string do deck tem teto próprio de 2 MiB no lint). */
function sized(bytes, ch = 'a') {
  const d = deck('Grande'); const per = Buffer.byteLength(ch); const chunk = Math.floor((512 * 1024) / per);
  let left = Math.floor((bytes - Buffer.byteLength(JSON.stringify({ baseRev: 1, content: d }))) / per) - 64;
  for (let i = 0; left > 0; i++) { const n = Math.min(chunk, left); d.slides[0].els.push({ id: 'g' + i, type: 'text', x: 0, y: 0, w: 10, h: 10, html: ch.repeat(n) }); left -= n + 80 / per; }
  return d;
}

describe('salvar/criar com VERCEL definida: até 4 MiB (bytes) por salvamento', () => {
  test('config: limites da Vercel em vigor', () => { assert.equal(env.config.onVercel, true); assert.equal(env.config.maxJsonBytes, 4 * MiB); assert.equal(env.config.streamLimitBytes, 4 * MiB); });
  test('3,9 MiB salva; 4,1 MiB → 413 too_large com mensagem amigável (limite e o que fazer); nada gravado', async () => {
    const p = await env.create(A, 'Grande', deck('Grande'));
    const ok = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: p.rev, content: sized(3.9 * MiB) } }); assert.equal(ok.status, 200, ok.text.slice(0, 200));
    const big = await env.put(A, `/api/presentations/${p.id}/content`, { json: { baseRev: ok.json.rev, content: sized(4.1 * MiB) } });
    assert.equal(big.status, 413); assert.equal(big.json.error.code, 'too_large');
    assert.equal(big.json.error.message, 'A apresentação passa do limite de 4 MB por salvamento. Reduza imagens muito grandes ou divida a apresentação em duas e tente de novo.');
    assert.equal((await env.sys((tx) => tx`select rev from app.presentations where id = ${p.id}`))[0].rev, ok.json.rev);
  });
  test('a contagem é em BYTES: texto acentuado com menos de 4 Mi caracteres mas mais de 4 MiB em UTF-8 → 413', async () => {
    const p = await env.create(A, 'Acentos', deck('Acentos'));
    const d = sized(4.2 * MiB, 'ã'); const body = JSON.stringify({ baseRev: p.rev, content: d });
    assert.ok(body.length < 4 * MiB && Buffer.byteLength(body) > 4 * MiB, 'caracteres < 4 Mi, bytes > 4 MiB');
    const r = await env.request(A, 'PUT', `/api/presentations/${p.id}/content`, { body, headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 413); assert.match(r.json.error.message, /4 MB por salvamento/);
    const chunked = await env.app.request(`/api/presentations/${p.id}/content`, { method: 'PUT', body: new Blob([body]).stream(), duplex: 'half', headers: { 'content-type': 'application/json', 'x-test-user': A.id } });
    assert.equal(chunked.status, 413, 'sem Content-Length (em fluxo) também para ao passar do limite');
  });
  test('criar/importar acima de 4 MiB → 413 com a mesma mensagem; Content-Length declarado grande é barrado antes de ler', async () => {
    const r = await env.post(A, '/api/presentations', { json: { source: 'import', content: sized(4.2 * MiB) } }); assert.equal(r.status, 413); assert.match(r.json.error.message, /4 MB por salvamento/);
    const lying = await env.request(A, 'POST', '/api/presentations', { body: '{}', headers: { 'content-type': 'application/json', 'content-length': String(5 * MiB) } }); assert.equal(lying.status, 413);
  });
  test('envio de arquivo pela API acima de 4 MiB → 413 com o limite na mensagem', async () => {
    const buf = randomBytes(4 * MiB + 10);
    const r = await env.put(A, `/api/assets/${sha256Hex(buf)}`, { body: buf, headers: { 'content-type': 'application/octet-stream', 'x-asset-kind': 'image' } });
    assert.equal(r.status, 413); assert.match(r.json.error.message, /limite de 4 MB por envio/);
  });
});

describe('leitura de arquivo com VERCEL definida: acima de 4 MiB não passa pela função', () => {
  /** Arquivo pronto, de `bytes` bytes, enviado pela Ana (posse) — gravado direto no armazenamento e no banco (o PUT só aceita até 4 MiB). */
  async function stored(bytes) {
    const buf = randomBytes(bytes); const sha = sha256Hex(buf);
    await env.storage.put(sha, buf, { mime: 'application/pdf' });
    await env.sys(async (tx) => {
      await tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by, ready_at) values (${sha}, ${bytes}, 'application/pdf', 'attachment', 'ready', ${A.id}, now())`;
      await tx`insert into app.asset_uploads(sha256, user_id) values (${sha}, ${A.id})`;
    });
    return sha;
  }
  test('até 4 MiB: transmitido (200, bytes completos)', async () => {
    const sha = await stored(3 * MiB); const r = await env.get(A, `/api/assets/${sha}`);
    assert.equal(r.status, 200); assert.equal(r.buffer.length, 3 * MiB);
  });
  test('acima de 4 MiB com URL assinada → 302 (não 200 em fluxo, como fora da Vercel até 8 MiB)', async () => {
    const sha = await stored(5 * MiB); env.hooks.signedGetUrl = async () => 'https://bucket.example/assinada';
    try { const r = await env.get(A, `/api/assets/${sha}`); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://bucket.example/assinada'); assert.equal(r.headers.get('cache-control'), 'private, no-store'); }
    finally { delete env.hooks.signedGetUrl; }
  });
  test('acima de 4 MiB sem URL assinada (driver sem URL) → 413 claro, nunca uma resposta cortada pela plataforma', async () => {
    const sha = await stored(5 * MiB); const r = await env.get(A, `/api/assets/${sha}`);
    assert.equal(r.status, 413); assert.equal(r.json.error.code, 'too_large'); assert.match(r.json.error.message, /mais de 4 MB/);
  });
});
