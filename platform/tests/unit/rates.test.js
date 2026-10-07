/* Limites de taxa das rotas autenticadas (lib/presentations-service.js → rate): valores do contrato e o teto por IP = valor × RATE_IP_MULTIPLIER.
   Sem banco: um `tx` falso registra os baldes que limitMany consultaria (mesma montagem de SQL, só que capturada). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rate, RATES, IP_MULTIPLIER } from '../../src/lib/presentations-service.js';

/** Contexto Hono mínimo: deps.db.anon executa a função com um tx que só captura (bucket, chave, janela, máximo) de cada app.hit_rate. */
function fakeCtx(config, ip = '203.0.113.9') {
  const specs = [];
  const tx = (strings, ...vals) => {
    const text = strings.join('?');
    if (text.includes('app.hit_rate(')) { const [, bucket, key, windowS, max] = vals; specs.push([bucket, key, windowS, max]); }
    return { text, vals };
  };
  const vars = { ip, deps: { config, db: { anon: async (fn) => { fn(tx); return [{ r: { allowed: true, reset_in: 0, next: { allowed: true, reset_in: 0, next: null } } }]; } } } };
  return { c: { get: (k) => vars[k] }, specs };
}
const user = { id: '11111111-1111-4111-8111-111111111111' };

test('valores do contrato (API.md §2): escrita 120, upload 300, comentários 30, leitura 600, preferências 60 — por minuto e por pessoa', () => {
  assert.deepEqual(RATES.write, [60, 120]); assert.deepEqual(RATES.upload, [60, 300]); assert.deepEqual(RATES.comment, [60, 30]);
  assert.deepEqual(RATES.read, [60, 600]); assert.deepEqual(RATES.asset_read, [60, 600]); assert.deepEqual(RATES.prefs, [60, 60]);
  assert.ok(Object.isFrozen(RATES));
});
test('upload: balde da pessoa = 300/min; balde do IP = 300 × RATE_IP_MULTIPLIER (padrão 25 → 7500), consultados em cadeia', async () => {
  const d = fakeCtx({ rateIpMultiplier: IP_MULTIPLIER });
  await rate(d.c, user, 'upload', ...RATES.upload);
  const byBucket = (specs) => Object.fromEntries(specs.map((x) => [x[0], x.slice(1)]));   // a montagem em cadeia captura o balde interno (IP) primeiro
  assert.deepEqual(byBucket(d.specs), { 'upload:u': [user.id, 60, 300], 'upload:ip': ['203.0.113.9', 60, 300 * 25] });
  const m = fakeCtx({ rateIpMultiplier: 5 }, '198.51.100.1');
  await rate(m.c, user, 'upload', ...RATES.upload);
  assert.deepEqual(byBucket(m.specs)['upload:ip'], ['198.51.100.1', 60, 1500], 'o fator configurado vale');
});
