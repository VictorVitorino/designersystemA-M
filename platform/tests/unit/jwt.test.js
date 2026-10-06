/* Verificação do JWT: cada ataque conhecido (alg none, confusão de algoritmo, emissor/audiência trocados, expirado, sem sub…) tem um teste. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { startFakeGoTrue } from '../../tools/fake-gotrue.js';
import { createJwtVerifier } from '../../src/auth/jwt.js';

const SUB = '3f0f6a52-0000-4000-8000-000000000001';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const claims = (over = {}) => ({ sub: SUB, email: 'Ana@AM.test', session_id: 's1', user_metadata: { email_verified: true }, ...over });
const reason = async (v, token) => { try { await v.verify(token); return 'ACEITO'; } catch (e) { return e.reason || 'erro:' + e.message; } };

describe('modo JWKS (ES256)', () => {
  let fake, v;
  before(async () => { fake = await startFakeGoTrue({ mode: 'jwks' }); v = createJwtVerifier({ supabase: { url: fake.url, jwksUrl: fake.jwksUrl } }); });
  after(() => fake.close());

  test('token válido: devolve sub, e-mail normalizado e sessão', async () => {
    const c = await v.verify(await fake.mintToken(claims()));
    assert.equal(c.sub, SUB); assert.equal(c.email, 'ana@am.test'); assert.equal(c.emailVerified, true); assert.equal(c.sessionId, 's1');
  });
  test('expirado → expired', async () => assert.equal(await reason(v, await fake.mintToken(claims(), { ttl: -60 })), 'expired'));
  test('alg none (sem assinatura) → recusado', async () => {
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims(), iss: fake.issuer, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600, role: 'authenticated' })}.`;
    assert.equal(await reason(v, t), 'invalid');
    assert.equal(await reason(v, t.slice(0, -1) + 'AAAA'), 'invalid');
    assert.equal(await reason(v, t.replace('"none"', '"None"')), 'invalid');
  });
  test('confusão HS×ES: token HS256 assinado com a chave PÚBLICA como segredo → recusado', async () => {
    const payload = { ...claims(), iss: fake.issuer, aud: 'authenticated', role: 'authenticated' };
    for (const secret of [JSON.stringify(fake.publicJwk), fake.publicJwk.x, fake.publicJwk.x + fake.publicJwk.y]) {
      const t = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256', kid: fake.publicJwk.kid }).setExpirationTime('10m').sign(new TextEncoder().encode(secret));
      assert.equal(await reason(v, t), 'invalid');
    }
  });
  test('assinado por OUTRA chave (mesmo kid) → recusado', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const t = await new SignJWT({ ...claims(), role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: fake.publicJwk.kid }).setIssuer(fake.issuer).setAudience('authenticated').setExpirationTime('10m').sign(privateKey);
    assert.equal(await reason(v, t), 'invalid');
  });
  test('outro emissor, outra audiência → recusado', async () => {
    assert.equal(await reason(v, await fake.mintToken(claims({ iss: 'https://outro.supabase.co/auth/v1' }))), 'invalid');
    assert.equal(await reason(v, await fake.mintToken(claims({ aud: 'anon' }))), 'invalid');
    assert.equal(await reason(v, await fake.mintToken(claims({ aud: ['x', 'y'] }))), 'invalid');
  });
  test('sem sub, sem e-mail, papel anon/service_role, anônimo → recusado', async () => {
    assert.equal(await reason(v, await fake.mintToken({ email: 'a@b.co' })), 'invalid');
    assert.equal(await reason(v, await fake.mintToken({ sub: SUB })), 'invalid');
    assert.equal(await reason(v, await fake.mintToken(claims({ role: 'anon' }))), 'invalid');
    assert.equal(await reason(v, await fake.mintToken(claims({ role: 'service_role' }))), 'invalid');
    assert.equal(await reason(v, await fake.mintToken(claims({ is_anonymous: true }))), 'invalid');
  });
  test('lixo, vazio, grande demais, tipo errado → recusado sem exceção inesperada', async () => {
    for (const t of ['', 'abc', 'a.b.c', 'a.b', '....', 'x'.repeat(5000), null, undefined, 123, {}]) assert.equal(await reason(v, t), 'invalid');
  });
  test('algoritmo fora da lista (RS512, PS256, EdDSA, ES384) → recusado', async () => {
    for (const alg of ['RS512', 'PS256', 'EdDSA', 'ES384', 'HS512']) assert.equal(await reason(v, `${b64({ alg, typ: 'JWT' })}.${b64(claims())}.c2ln`), 'invalid');
  });
  test('e-mail_verified:false explícito é respeitado', async () => {
    const c = await v.verify(await fake.mintToken(claims({ user_metadata: { email_verified: false } })));
    assert.equal(c.emailVerified, false);
  });
  test('JWKS fora do ar → unavailable (não vira "token inválido")', async () => {
    const dead = await startFakeGoTrue({ mode: 'jwks' }); const url = dead.url, jwksUrl = dead.jwksUrl; const tok = await dead.mintToken(claims()); await dead.close();
    const v2 = createJwtVerifier({ supabase: { url, jwksUrl } });
    assert.equal(await reason(v2, tok), 'unavailable');
  });
});

describe('modo segredo (HS256)', () => {
  let fake, v;
  before(async () => { fake = await startFakeGoTrue({ mode: 'hs256' }); v = createJwtVerifier({ supabase: { url: fake.url, jwtSecret: fake.jwtSecret } }); });
  after(() => fake.close());

  test('token válido', async () => assert.equal((await v.verify(await fake.mintToken(claims()))).sub, SUB));
  test('segredo errado → recusado', async () => {
    const t = await new SignJWT({ ...claims(), role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(fake.issuer).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode('outro-segredo-qualquer-0123456789'));
    assert.equal(await reason(v, t), 'invalid');
  });
  test('ES256 (mesmo bem assinado) não é aceito no modo segredo; alg none também não', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const t = await new SignJWT({ ...claims(), role: 'authenticated' }).setProtectedHeader({ alg: 'ES256' }).setIssuer(fake.issuer).setAudience('authenticated').setExpirationTime('10m').sign(privateKey);
    assert.equal(await reason(v, t), 'invalid');
    assert.equal(await reason(v, `${b64({ alg: 'none' })}.${b64({ ...claims(), iss: fake.issuer, aud: 'authenticated', exp: 9999999999, role: 'authenticated' })}.`), 'invalid');
  });
  test('expirado e emissor errado', async () => {
    assert.equal(await reason(v, await fake.mintToken(claims(), { ttl: -60 })), 'expired');
    assert.equal(await reason(v, await fake.mintToken(claims({ iss: 'https://x.supabase.co/auth/v1' }))), 'invalid');
  });
});

describe('configuração', () => {
  test('sem URL ou sem chave: not_configured (falha fechada)', async () => {
    assert.equal(await reason(createJwtVerifier({ supabase: {} }), 'a.b.c'), 'not_configured');
    assert.equal(await reason(createJwtVerifier({ supabase: { url: 'http://x.test' } }), 'a.b.c'), 'not_configured');
    assert.equal(createJwtVerifier({ supabase: { url: 'http://x.test' } }).configured, false);
  });
  test('JWKS + segredo juntos: cada algoritmo usa a SUA chave', async () => {
    const a = await startFakeGoTrue({ mode: 'jwks' }), b = await startFakeGoTrue({ mode: 'hs256' });
    try {
      const v = createJwtVerifier({ supabase: { url: a.url, jwksUrl: a.jwksUrl, jwtSecret: b.jwtSecret } });
      assert.equal(await reason(v, await a.mintToken(claims())), 'ACEITO');
      const hs = await new SignJWT({ ...claims(), role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(a.issuer).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(b.jwtSecret));
      assert.equal(await reason(v, hs), 'ACEITO');
      const hsPub = await new SignJWT({ ...claims(), role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(a.issuer).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(JSON.stringify(a.publicJwk)));
      assert.equal(await reason(v, hsPub), 'invalid');
    } finally { await a.close(); await b.close(); }
  });
});
