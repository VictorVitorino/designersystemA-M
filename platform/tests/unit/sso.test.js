/* Peças puras do SSO (src/auth/sso.js): PKCE (vetor do RFC 7636), domínios, destino seguro depois do login e o estado assinado do fluxo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pkcePair, challengeOf, domainOf, ssoDomainAllowed, isSsoProvider, safeNext, sealState, openState, SSO_TTL_S, AUTH_CODE_RE } from '../../src/auth/sso.js';

const CFG = { csrfSecret: 'x'.repeat(48), sso: { enabled: true, domains: ['am.test', 'alvarezandmarsal.com'] } };

test('PKCE S256: vetor do RFC 7636 (apêndice B); pares novos com 43 caracteres base64url e sem repetição', () => {
  assert.equal(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const { verifier, challenge } = pkcePair();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/); assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url')); assert.notEqual(challenge, verifier);
    assert.ok(!seen.has(verifier)); seen.add(verifier);
  }
});
test('domínios: domainOf, ssoDomainAllowed (só com SSO ligado e domínio na lista), isSsoProvider', () => {
  assert.equal(domainOf('Ana.Silva@AM.test'), 'am.test'); assert.equal(domainOf('x@y@z.com'), 'z.com'); for (const bad of ['', 'sem-arroba', '@am.test', 'a@', null]) assert.equal(domainOf(bad), '');
  assert.equal(ssoDomainAllowed(CFG, 'am.test'), true); assert.equal(ssoDomainAllowed(CFG, 'AM.TEST'), true); assert.equal(ssoDomainAllowed(CFG, 'evil.test'), false);
  assert.equal(ssoDomainAllowed(CFG, 'sub.am.test'), false, 'subdomínio não herda'); assert.equal(ssoDomainAllowed({ sso: { enabled: false, domains: ['am.test'] } }, 'am.test'), false);
  assert.equal(isSsoProvider('sso:0f8c1d1e-1b6e-4b5a-9a77-2f6a4a1b2c3d'), true);
  for (const p of ['supabase', 'email', 'sso:', 'sso:entra', 'SSO:0F8C1D1E-1B6E-4B5A-9A77-2F6A4A1B2C3D', 'saml:x', null]) assert.equal(isSsoProvider(p), false, String(p));
});
test('safeNext: só caminho interno; nunca outra origem, a tela de entrada ou a API', () => {
  for (const ok of ['/acervo', '/editor/0f8c1d1e-1b6e-4b5a-9a77-2f6a4a1b2c3d', '/visualizar/x?slide=3#c', '/admin', '/%2F%2Fevil.example']) assert.equal(safeNext(ok), ok);
  for (const bad of ['', '//evil.example', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 'acervo', '/./..//evil.example', '/entrar', '/entrar?next=/x', '/auth/confirmar', '/esqueci-senha', '/api/admin/users', '/api', '/a\nb', '/a\u0000', 'x'.repeat(600), null, 5]) {
    assert.equal(safeNext(bad), '/acervo', JSON.stringify(bad));
  }
  assert.equal(safeNext('//evil', '/x'), '/x');
});
test('estado do fluxo: ida e volta; adulterado, de outro servidor, vencido, malformado → null; o destino é saneado de novo ao abrir', () => {
  const { verifier } = pkcePair(); const now = Date.now();
  const raw = sealState(CFG, { verifier, next: '/editor/abc', now });
  assert.deepEqual(openState(CFG, raw, now), { verifier, next: '/editor/abc' });
  assert.ok(!raw.includes(verifier), 'o verifier não aparece em claro (vai em base64url, assinado)');
  const [body, sig] = raw.split('.');
  const flip = (s) => s.slice(0, -1) + (s.at(-1) === 'A' ? 'B' : 'A');
  assert.equal(openState(CFG, `${flip(body)}.${sig}`, now), null, 'corpo adulterado');
  assert.equal(openState(CFG, `${body}.${flip(sig)}`, now), null, 'assinatura adulterada');
  assert.equal(openState({ csrfSecret: 'y'.repeat(48) }, raw, now), null, 'outro segredo');
  assert.equal(openState(CFG, raw, now + (SSO_TTL_S + 1) * 1000), null, 'vencido (10 min)');
  for (const bad of ['', 'x', 'a.b', `${body}`, `${body}.${sig}.x`, 'x'.repeat(3000), null, 5]) assert.equal(openState(CFG, bad, now), null, String(bad).slice(0, 20));
  const forged = sealState(CFG, { verifier: 'curto', next: '/x', now }); assert.equal(openState(CFG, forged, now), null, 'verifier fora do formato');
  assert.equal(openState(CFG, sealState(CFG, { verifier, next: '//evil.example', now }), now).next, '/acervo');
});
test('formato do código de retorno', () => {
  for (const ok of ['0f8c1d1e-1b6e-4b5a-9a77-2f6a4a1b2c3d', 'abcDEF12_~.-']) assert.ok(AUTH_CODE_RE.test(ok));
  for (const bad of ['', 'curto', 'com espaço aqui', '<script>', 'a'.repeat(300), 'x/y/z/w/k']) assert.ok(!AUTH_CODE_RE.test(bad), bad);
});
