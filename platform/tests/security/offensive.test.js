/* tests/security/offensive.test.js — revisão de segurança OFENSIVA (caixa-branca) contra a API inteira em memória (tests/helpers/boot.js:
   Postgres real com RLS + GoTrue falso + armazenamento local temporário). Cada teste é um ATAQUE: passa quando a defesa funciona e FALHA
   quando a defesa não existe — um teste vermelho aqui é um achado em docs/SEGURANCA.md (não se "ajusta" o teste para ficar verde).
   Como rodar:  TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_sec_unit node --test tests/security/offensive.test.js
   Blocos: autenticação/sessão · CSRF/CORS/cabeçalhos/redirect · autorização (IDOR/BOLA) · injeção · XSS (corpus) · uploads · abuso · segredos/log · cadeia de suprimento. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import sharp from 'sharp';
import { boot } from '../helpers/boot.js';
import { ATTACKS, LEGIT } from '../fixtures/xss-corpus.js';
import { lintDeck, LIMITS } from '../../src/lib/deck-lint.js';
import { sha256Hex } from '../../src/lib/canonical.js';
import { assertSha, objectKey } from '../../src/storage/keys.js';
import { encodeCursor, cursorKey } from '../../src/lib/cursor.js';
import { loadConfig } from '../../src/config.js';
import { safeNext } from '../../web/js/format.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), PLATFORM = path.resolve(HERE, '..', '..'), REPO = path.resolve(PLATFORM, '..');
const require = createRequire(import.meta.url);
const UUID0 = '00000000-0000-4000-8000-000000000000';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const png = (seed, size = 8) => sharp({ create: { width: size, height: size, channels: 3, background: { r: seed % 256, g: (seed * 7) % 256, b: (seed * 13) % 256 } } }).png().toBuffer();
const deck = (title = 'Teste', { slides = 1, html = 'Olá', extra = {} } = {}) => ({
  v: 1, app: 'AM Studio', id: 'dtest', title,
  slides: Array.from({ length: slides }, (_, i) => ({ id: `s${i}`, bg: '#FFFFFF', tr: 'fade', layout: 'blank-light', els: [{ id: `t${i}`, type: 'text', x: 10, y: 10, w: 300, h: 40, html }] })),
  ...extra,
});
const errCode = (r) => r.json && r.json.error && r.json.error.code;

/* Logger que guarda TODAS as linhas (para a varredura de segredos no fim) */
const LOG = [];
const logger = { debug: (m, f) => LOG.push({ level: 'debug', m, f }), info: (m, f) => LOG.push({ level: 'info', m, f }), warn: (m, f) => LOG.push({ level: 'warn', m, f }), error: (m, f) => LOG.push({ level: 'error', m, f }) };

let t, A, B, C, ADM, cA, cB, cC, cAdm, P, PT, SHA_A;
const SECRETS = new Set();
/** Zera os contadores de taxa (testes que não são sobre taxa não devem esbarrar neles). */
const resetRates = () => t.ops.asSystem((tx) => tx`delete from app.rate_limits`);
before(async () => {
  // estas verificações leem o site GERADO (CSP por página, editor publicado, pdf.js, varredura de segredos): sem ele, uma falha só e clara
  assert.ok(fs.existsSync(path.join(PLATFORM, 'dist', 'public', 'editor', 'index.html')), 'dist/public ausente: rode "npm run build:web" antes de "npm run test:security"');
  t = await boot({ withStatic: true, publicDir: path.join(PLATFORM, 'dist', 'public'), deps: { logger }, authTiming: { failMinMs: 250, forgotMinMs: 250 } });
  A = await t.createUser({ displayName: 'Ana Dona' }); B = await t.createUser({ displayName: 'Bruno Membro' }); C = await t.createUser({ displayName: 'Carla Terceira' }); ADM = await t.createUser({ role: 'admin', displayName: 'Admin Geral' });
  cA = await t.as(A); cB = await t.as(B); cC = await t.as(C); cAdm = await t.as(ADM);
  for (const c of [cA, cB, cC, cAdm]) { SECRETS.add(c.cookie('am_at')); SECRETS.add(c.cookie('am_rt')); }
  SECRETS.add(t.DEFAULT_PASSWORD); SECRETS.add(t.fake.serviceKey); SECRETS.add(t.fake.jwtSecret);
  // apresentação de A com uma imagem (asset) e uma na lixeira
  const buf = await png(1); SHA_A = sha256(buf);
  assert.equal((await cA.request('PUT', `/api/assets/${SHA_A}`, { body: buf, headers: { 'content-type': 'image/png', 'x-asset-kind': 'image' } })).status, 201);
  const d = deck('Da Ana'); d.slides[0].els.push({ id: 'img1', type: 'image', x: 0, y: 0, w: 10, h: 10, src: `asset:sha256:${SHA_A}` });
  P = (await cA.post('/api/presentations', { title: 'Da Ana', content: d })).json;
  PT = (await cA.post('/api/presentations', { title: 'Na lixeira da Ana' })).json;
  assert.equal((await cA.del(`/api/presentations/${PT.id}`)).status, 204);
});
after(async () => { await t.stop(); });

/* ═══════════════════════════════════════════════════════════ 1. autenticação e sessão ═══════════════════════════════════════════ */
describe('autenticação e sessão', () => {
  test('enumeração de contas: login (mensagem + tempo), forgot (sempre 202) e verify (sempre 410) não distinguem e-mail existente de inexistente', async () => {
    t.fake.state.latency.existingUserMs = 120;   // simula o bcrypt do GoTrue: e-mail existente demora mais no provedor
    // piso de PRODUÇÃO (src/auth/kit.js: 700 ms). Com o piso artificial de 250 ms deste arquivo, uma máquina carregada faz o caminho do
    // e-mail existente (latência simulada + scrypt do GoTrue falso) passar do piso e o teste mediria a carga, não a equalização.
    const floor0 = t.kit.timing.failMinMs; t.kit.timing.failMinMs = 700;
    try {
      const timed = async (email) => { const c = t.anon(); await c.ensureCsrf(); const t0 = Date.now(); const r = await c.post('/api/auth/login', { email, password: 'Senha-Errada-Qualquer-123' }); return { r, ms: Date.now() - t0 }; };
      const ex = [], ne = [];
      for (let i = 0; i < 4; i++) { ex.push(await timed(A.email)); ne.push(await timed(`inexistente${i}@am.test`)); }
      for (const x of [...ex, ...ne]) { assert.equal(x.r.status, 401); assert.equal(errCode(x.r), 'invalid_credentials'); assert.equal(x.r.json.error.message, 'E-mail ou senha incorretos.'); }
      const med = (a) => a.map((x) => x.ms).sort((p, q) => p - q)[Math.floor(a.length / 2)];
      assert.ok(med(ex) >= 690 && med(ne) >= 690, `piso de tempo aplicado (${med(ex)} / ${med(ne)} ms)`);
      assert.ok(Math.abs(med(ex) - med(ne)) < 80, `tempos equalizados: existente ${med(ex)} ms × inexistente ${med(ne)} ms`);
    } finally { t.fake.state.latency.existingUserMs = 0; t.kit.timing.failMinMs = floor0; }
    const f = t.anon(); await f.ensureCsrf();
    const f1 = await f.post('/api/auth/forgot', { email: A.email }), f2 = await f.post('/api/auth/forgot', { email: 'ninguem@am.test' });
    assert.equal(f1.status, 202); assert.equal(f2.status, 202); assert.equal(f1.text, f2.text);
    const v = t.anon(); await v.ensureCsrf();
    const v1 = await v.post('/api/auth/verify', { tokenHash: 'a'.repeat(48), type: 'invite' }), v2 = await v.post('/api/auth/verify', { tokenHash: 'b'.repeat(48), type: 'recovery' });
    assert.equal(v1.status, 410); assert.equal(v2.status, 410); assert.equal(v1.json.error.message, v2.json.error.message);
  });
  test('força bruta: 8 erros por e-mail+IP → 429 antes do GoTrue; e-mail correto + senha certa também fica barrado; outro IP segue', async () => {
    await t.awayFromWindowEdge(600, 15000);   // janela fixa de 10 min: a rajada não pode cruzar a virada
    const victim = await t.createUser(); const c = t.anon(); await c.ensureCsrf();
    for (let i = 0; i < 8; i++) assert.equal((await c.post('/api/auth/login', { email: victim.email, password: 'errada-errada-' + i })).status, 401);
    const calls = t.fake.calls.filter((x) => x.path === '/auth/v1/token').length;
    const r = await c.post('/api/auth/login', { email: victim.email, password: victim.password });
    assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.equal(t.fake.calls.filter((x) => x.path === '/auth/v1/token').length, calls, 'bloqueado sem consultar o provedor');
    assert.equal((await t.anon().login(victim.email, victim.password)).status, 200);
  });
  test('fixação de sessão: o token CSRF é trocado no login; cookies de acesso plantados antes do login são substituídos', async () => {
    const u = await t.createUser(); const c = t.anon(); await c.ensureCsrf(); const before = c.cookie('am_csrf');
    c.jar.set('am_at', 'plantado.pelo.atacante'); c.jar.set('am_rt', 'rt-plantado');
    const r = await c.login(u.email, u.password); assert.equal(r.status, 200);
    assert.notEqual(c.cookie('am_csrf'), before, 'CSRF rotacionado');
    assert.notEqual(c.cookie('am_at'), 'plantado.pelo.atacante'); assert.notEqual(c.cookie('am_rt'), 'rt-plantado');
    const by = Object.fromEntries(r.setCookies.map((x) => [x.name, x]));
    for (const n of ['am_at', 'am_rt']) { assert.ok(by[n].attrs.httponly, n + ' HttpOnly'); assert.equal(by[n].attrs.samesite, 'Lax'); assert.equal(by[n].attrs.path, '/'); }
    assert.doesNotMatch(r.text, /eyJ[A-Za-z0-9_-]{10,}\./, 'nenhum JWT no corpo');
  });
  test('token fora do cookie não autentica (Authorization: Bearer, ?access_token=, cookie com nome parecido)', async () => {
    const at = cA.cookie('am_at'); const bare = t.anon();
    assert.equal((await bare.get('/api/me', { headers: { authorization: `Bearer ${at}` } })).status, 401);
    assert.equal((await bare.get('/api/me?access_token=' + at)).status, 401);
    const fake = t.anon(); fake.jar.set('__Host-am_at', at); assert.equal((await fake.get('/api/me')).status, 401, 'em HTTP local o nome é am_at; o prefixo não é lido');
  });
  test('JWT forjado: alg none, confusão HS256 com a chave pública, iss/aud errados, expirado, role service_role, anônimo → 401', async () => {
    const sub = t.fake.userByEmail(A.email).id, claims = { sub, email: A.email, session_id: 'x' };
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, role: 'authenticated', iss: t.fake.issuer, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.`;
    const hsPub = await new SignJWT({ ...claims, role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(t.fake.issuer).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(JSON.stringify(t.fake.publicJwk)));
    const variants = [['alg none', none], ['HS256 com JWK pública como segredo', hsPub],
      ['iss errado', await t.fake.mintToken({ ...claims, iss: 'https://outro.supabase.co/auth/v1' })], ['aud errado', await t.fake.mintToken({ ...claims, aud: 'service' })],
      ['expirado', await t.fake.mintToken(claims, { ttl: -30 })], ['role service_role', await t.fake.mintToken({ ...claims, role: 'service_role' })], ['anônimo', await t.fake.mintToken({ ...claims, is_anonymous: true })]];
    for (const [name, tok] of variants) {
      const c = t.anon(); c.jar.set('am_at', tok); const r = await c.get('/api/me'); assert.equal(r.status, 401, name);
      assert.ok(['unauthenticated', 'session_expired'].includes(errCode(r)), name + ': ' + r.text);
      assert.equal((await c.get('/api/admin/users')).status, 401, name + ' (admin)');
    }
  });
  test('refresh: reutilizar o refresh token antigo depois de renovar → 401; renovações simultâneas viram 1 chamada ao GoTrue', async () => {
    const u = await t.createUser(); const c = t.anon(); await c.login(u.email, u.password); const oldRt = c.cookie('am_rt');
    const calls = () => t.fake.calls.filter((x) => x.path === '/auth/v1/token' && x.query.includes('refresh_token')).length; const n0 = calls();
    const rs = await Promise.all([1, 2, 3].map(() => c.request('POST', '/api/auth/refresh', { headers: { cookie: `am_rt=${oldRt}; am_csrf=${c.cookie('am_csrf')}` }, cookies: false })));
    assert.equal(rs.filter((r) => r.status === 200).length >= 1, true, rs.map((r) => r.status).join());
    assert.ok(rs.every((r) => r.status === 200 || (r.status === 401 && !r.setCookies.some((x) => x.name === 'am_at' && x.value))), 'uma única renovação vale; as demais não emitem token');
    LOG.push({ level: 'metric', m: 'refresh_concurrent_gotrue_calls', f: { calls: calls() - n0, statuses: rs.map((r) => r.status) } });   // single-flight é melhor-esforço (janela do laço de eventos)
    const replay = t.anon(); replay.jar.set('am_rt', oldRt); await replay.ensureCsrf();
    const r = await replay.post('/api/auth/refresh'); assert.equal(r.status, 401); assert.equal(errCode(r), 'session_expired');
    assert.ok(!replay.cookie('am_at'), 'nenhum cookie de acesso emitido na reutilização');
  });
  test('logout revoga o refresh token (reutilização → 401 e sessão não renova); cookies apagados', async () => {
    const u = await t.createUser(); const c = t.anon(); await c.login(u.email, u.password); const rt = c.cookie('am_rt'), at = c.cookie('am_at');
    const r = await c.post('/api/auth/logout'); assert.equal(r.status, 204);
    for (const n of ['am_at', 'am_rt']) assert.ok(r.setCookies.find((x) => x.name === n && x.attrs['max-age'] === '0'), n + ' apagado');
    const thief = t.anon(); thief.jar.set('am_rt', rt); await thief.ensureCsrf();
    assert.equal((await thief.post('/api/auth/refresh')).status, 401, 'refresh token revogado no provedor');
    const s = t.anon(); s.jar.set('am_rt', rt); const sess = await s.get('/api/auth/session'); assert.equal(sess.json.authenticated, false);
    // RESÍDUO DOCUMENTADO (docs/auth-e-sessoes.md): o access token é stateless e continua válido até expirar (≤ 1 h). Não é defesa falha, é limite conhecido.
    const ghost = t.anon(); ghost.jar.set('am_at', at); const g = await ghost.get('/api/me');
    assert.ok([200, 401].includes(g.status)); if (g.status === 200) LOG.push({ level: 'note', m: 'residual:jwt_stateless_after_logout', f: {} });
  });
  test('convite: o link é de uso único; link de recuperação usado 2× → 410; convite revogado → link não dá sessão', async () => {
    const inv = await cAdm.post('/api/admin/invites', { email: 'convidado.sec@am.test', displayName: 'Convidado Sec' }); assert.equal(inv.status, 201, inv.text);
    const th = t.fake.outbox('convidado.sec@am.test').at(-1).token_hash; SECRETS.add(th);
    const u1 = t.anon(); await u1.ensureCsrf(); assert.equal((await u1.post('/api/auth/verify', { tokenHash: th, type: 'invite' })).status, 200);
    const u2 = t.anon(); await u2.ensureCsrf(); const again = await u2.post('/api/auth/verify', { tokenHash: th, type: 'invite' }); assert.equal(again.status, 410); assert.ok(!u2.cookie('am_at'));
    assert.equal((await u1.post('/api/auth/password', { password: 'Senha-Do-Convidado-Forte-77!' })).status, 200);
    // recuperação 2×
    const f = t.anon(); await f.ensureCsrf(); assert.equal((await f.post('/api/auth/forgot', { email: 'convidado.sec@am.test' })).status, 202);
    const rh = t.fake.outbox('convidado.sec@am.test').filter((m) => m.type === 'recovery').at(-1).token_hash; SECRETS.add(rh);
    const r1 = t.anon(); await r1.ensureCsrf(); assert.equal((await r1.post('/api/auth/verify', { tokenHash: rh, type: 'recovery' })).status, 200);
    const r2 = t.anon(); await r2.ensureCsrf(); assert.equal((await r2.post('/api/auth/verify', { tokenHash: rh, type: 'recovery' })).status, 410);
    assert.equal((await r2.post('/api/auth/verify', { tokenHash: rh, type: 'invite' })).status, 410, 'trocar o type não ajuda');
    // convite revogado antes do clique
    const inv2 = await cAdm.post('/api/admin/invites', { email: 'revogado.sec@am.test', displayName: 'Revogado' }); assert.equal(inv2.status, 201);
    const th2 = t.fake.outbox('revogado.sec@am.test').at(-1).token_hash; SECRETS.add(th2);
    assert.equal((await cAdm.del(`/api/admin/invites/${inv2.json.id}`)).status, 204);
    const rv = t.anon(); await rv.ensureCsrf(); const rr = await rv.post('/api/auth/verify', { tokenHash: th2, type: 'invite' });
    assert.ok([403, 410].includes(rr.status), rr.text); assert.ok(!rv.cookie('am_at') && !rv.cookie('am_rt'), 'sem cookies de sessão');
    assert.equal((await rv.get('/api/me')).status, 401);
  });
  test('usuário suspenso com token válido perde o acesso na hora (cache invalidado) e não renova; reativado volta', async () => {
    const u = await t.createUser(); const c = t.anon(); await c.login(u.email, u.password); assert.equal((await c.get('/api/me')).status, 200);
    assert.equal((await cAdm.patch(`/api/admin/users/${u.id}`, { status: 'suspended' })).status, 200);
    const r = await c.get('/api/presentations'); assert.equal(r.status, 403); assert.equal(errCode(r), 'suspended');
    assert.equal((await c.post('/api/presentations', { title: 'x' })).status, 403);
    const rf = await c.post('/api/auth/refresh'); assert.ok([401, 403].includes(rf.status), 'refresh de suspenso: ' + rf.status + ' ' + rf.text); assert.ok(!rf.setCookies.some((x) => x.name === 'am_at' && x.value), 'nenhum token novo');
    assert.equal((await t.anon().login(u.email, u.password)).status, 403, 'login barrado (banido no GoTrue)');
    assert.equal((await cAdm.patch(`/api/admin/users/${u.id}`, { status: 'active' })).status, 200);
    assert.equal((await t.anon().login(u.email, u.password)).status, 200);
  });
  test('convidado que ainda não definiu a senha só alcança /api/auth/*', async () => {
    const inv = await cAdm.post('/api/admin/invites', { email: 'semsenha.sec@am.test', displayName: 'Sem Senha' }); assert.equal(inv.status, 201);
    const th = t.fake.outbox('semsenha.sec@am.test').at(-1).token_hash; SECRETS.add(th);
    const c = t.anon(); await c.ensureCsrf(); const v = await c.post('/api/auth/verify', { tokenHash: th, type: 'invite' }); assert.equal(v.status, 200); assert.equal(v.json.needsPassword, true);
    for (const [m, p, j] of [['GET', '/api/presentations'], ['POST', '/api/presentations', {}], ['GET', '/api/me'], ['PATCH', '/api/me', { displayName: 'x' }], ['GET', `/api/assets/${SHA_A}`], ['GET', '/api/admin/users']]) {
      const r = await c.request(m, p, j ? { json: j } : {}); assert.equal(r.status, 403, `${m} ${p}: ${r.status}`);
    }
    assert.equal((await c.get('/api/auth/session')).status, 200);
  });
  test('ACHADO? troca de senha sem reautenticação: usuário ATIVO logado (sem link de recuperação) não deveria poder definir nova senha em POST /api/auth/password', async () => {
    const u = await t.createUser(); const c = t.anon(); await c.login(u.email, u.password);
    const r = await c.post('/api/auth/password', { password: 'Nova-Senha-Sem-Reauth-2026!' });
    assert.notEqual(r.status, 200, 'sessão roubada (cookie) consegue trocar a senha e expulsar o dono: exigir estado needsPassword/recovery ou a senha atual');
  });
});

/* ═══════════════════════════════════════════════════════════ 2. CSRF · CORS · cabeçalhos · redirect ══════════════════════════════ */
describe('CSRF, CORS, clickjacking e open redirect', () => {
  const WRITES = () => [
    ['POST', '/api/presentations', { title: 'x' }], ['PUT', `/api/presentations/${P.id}/content`, { baseRev: 1, content: deck() }], ['PATCH', `/api/presentations/${P.id}`, { title: 'y' }],
    ['POST', `/api/presentations/${P.id}/duplicate`, {}], ['DELETE', `/api/presentations/${P.id}`], ['POST', `/api/presentations/${P.id}/restore`, {}], ['POST', `/api/presentations/${P.id}/transfer`, { toUserId: B.id }],
    ['POST', `/api/presentations/${P.id}/versions/1/restore`, { baseRev: 1 }], ['POST', `/api/presentations/${P.id}/comments`, { body: 'oi' }], ['PATCH', `/api/comments/${UUID0}`, { body: 'x' }], ['DELETE', `/api/comments/${UUID0}`],
    ['POST', `/api/presentations/${P.id}/interactions`, { kind: 'view', elementId: '', payload: {} }], ['POST', '/api/assets/check', { shas: [] }], ['POST', '/api/assets/uploads', {}], ['POST', `/api/assets/${SHA_A}/finalize`, {}],
    ['PATCH', '/api/me', { displayName: 'x' }], ['POST', '/api/auth/logout'], ['POST', '/api/auth/password', { password: 'x' }],
    ['POST', '/api/admin/invites', { email: 'a@b.co', displayName: 'x' }], ['PATCH', `/api/admin/users/${B.id}`, { role: 'admin' }], ['DELETE', `/api/admin/invites/${UUID0}`], ['PUT', '/api/admin/settings/invites.ttl_days', { value: 1 }],
  ];
  test('TODA rota de escrita, com a sessão da vítima (admin): sem token, Origin de outro site, sem Origin, Content-Type text/plain → 403 csrf; nada muda', async () => {
    const victim = await t.as(ADM, { fresh: true }); const before = (await victim.get(`/api/presentations/${P.id}`)).json;
    for (const [m, p, j] of WRITES()) {
      const body = j === undefined ? undefined : JSON.stringify(j);
      const cases = [
        ['sem token', { body, headers: body ? { 'content-type': 'application/json' } : {}, csrf: false }],
        ['Origin alheio', { body, headers: { ...(body ? { 'content-type': 'application/json' } : {}), origin: 'https://evil.example' } }],
        ['Origin null', { body, headers: { ...(body ? { 'content-type': 'application/json' } : {}), origin: 'null' } }],
        ['sem Origin/Sec-Fetch-Site', { body, headers: body ? { 'content-type': 'application/json' } : {}, origin: false }],
        ['text/plain', { body: body || '{}', headers: { 'content-type': 'text/plain' } }],
        ['form urlencoded', { body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }],
      ];
      for (const [name, o] of cases) { const r = await victim.request(m, p, o); assert.equal(r.status, 403, `${m} ${p} (${name}): ${r.status} ${r.text.slice(0, 80)}`); assert.equal(errCode(r), 'csrf', `${m} ${p} (${name})`); }
    }
    const after = (await victim.get(`/api/presentations/${P.id}`)).json; assert.equal(after.rev, before.rev); assert.equal(after.title, before.title); assert.equal(after.owner.id, A.id);
    assert.equal((await victim.get('/api/me')).status, 200, 'o logout cross-site não derrubou a sessão');
    assert.equal((await cB.get('/api/me')).json.role, 'member', 'a tentativa de promover B não surtiu efeito');
  });
  test('CORS: nenhum Access-Control-Allow-* em GET/POST/OPTIONS com Origin alheio (com e sem sessão)', async () => {
    for (const c of [t.anon(), cA]) {
      for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/presentations'], ['OPTIONS', '/api/presentations'], ['POST', '/api/presentations'], ['GET', '/api/health'], ['GET', `/api/assets/${SHA_A}`]]) {
        const r = await c.request(m, p, { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-csrf-token,content-type' }, csrf: false });
        for (const [k] of r.headers) assert.ok(!k.toLowerCase().startsWith('access-control-'), `${m} ${p}: ${k}`);
      }
    }
  });
  test('clickjacking e cabeçalhos: API e páginas (acervo, editor, visualizar, entrar) com frame-ancestors none, X-Frame-Options DENY, nosniff, COOP/CORP, Referrer-Policy; CSP do editor sem unsafe-inline em script', async () => {
    const c = t.anon();
    for (const p of ['/acervo', `/editor/${P.id}`, `/visualizar/${P.id}`, '/entrar', '/admin', '/api/me', '/api/health']) {
      const r = await c.get(p); const csp = r.headers.get('content-security-policy') || '';
      assert.match(csp, /frame-ancestors 'none'/, p + ': ' + csp.slice(0, 80)); assert.equal(r.headers.get('x-frame-options'), 'DENY', p); assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin', p); assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin', p); assert.ok(r.headers.get('referrer-policy'), p);
      if (!p.startsWith('/api')) { assert.match(csp, /object-src 'none'/, p); assert.match(csp, /base-uri 'none'/, p); const sd = /script-src ([^;]+)/.exec(csp); assert.ok(sd && !/'unsafe-inline'|'unsafe-eval'/.test(sd[1]), p + ': script-src sem unsafe-*: ' + (sd && sd[1])); }
    }
    const ed = (await c.get(`/editor/${P.id}`)).headers.get('content-security-policy'); assert.match(ed, /'sha256-[A-Za-z0-9+/=]+'/); assert.match(ed, /'strict-dynamic'/);
    assert.equal((await c.get('/acervo')).headers.get('content-security-policy'), (await c.get('/admin')).headers.get('content-security-policy'));
  });
  test('open redirect: ?next= só aceita caminho interno (safeNext) — 20 cargas maliciosas caem no padrão', () => {
    const origin = 'http://localhost:4403';
    const bad = ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/./..//evil.example', '/\u0000/x', 'http:evil.example', '/entrar?next=/x', '/auth/confirmar?token_hash=x', '', 'acervo', '/\t/evil', '//localhost:4403@evil.example/', '/x\r\nLocation: https://evil.example', '////evil.example', '/\\\\evil.example', '/..//evil.example', 'HTTP://evil.example', 'data:text/html,x', 'vbscript:x'];
    for (const b of bad) { const out = safeNext(b, '/acervo', origin); assert.equal(out, '/acervo', JSON.stringify(b) + ' → ' + out); }
    for (const ok of ['/editor/' + P.id, '/acervo?foco=1', '/admin#usuarios', '/importar']) assert.equal(safeNext(ok, '/acervo', origin), ok);
    for (const enc of ['/%2F%2Fevil.example', '/%5C%5Cevil.example']) { const out = safeNext(enc, '/acervo', origin); assert.ok(out.startsWith('/') && !out.startsWith('//') && new URL(out, origin).origin === origin, enc + ' → ' + out + ' (caminho interno, não redirect)'); }
  });
});

/* ═══════════════════════════════════════════════════════════ 3. autorização (IDOR/BOLA) ═════════════════════════════════════════ */
describe('autorização: IDOR/BOLA, escalada e admin-only', () => {
  test('membro × apresentação alheia: ver/copiar/comentar sim; editar, renomear, apagar, restaurar, versões, transferir, purgar, CSV não', async () => {
    const g = await cB.get(`/api/presentations/${P.id}`); assert.equal(g.status, 200); assert.equal(g.json.canEdit, false);
    const rev = g.json.rev; const content = g.json.content;
    const fail = async (m, p, j, status) => { const r = await cB.request(m, p, j === undefined ? {} : { json: j }); assert.equal(r.status, status, `${m} ${p} → ${r.status} ${r.text.slice(0, 100)}`); };
    await fail('PUT', `/api/presentations/${P.id}/content`, { baseRev: rev, content: { ...content, title: 'Hackeada' } }, 403);
    await fail('PUT', `/api/presentations/${P.id}/content`, { baseRev: rev, content, resolution: 'overwrite' }, 403);
    await fail('PATCH', `/api/presentations/${P.id}`, { title: 'Hackeada' }, 403);
    await fail('DELETE', `/api/presentations/${P.id}`, undefined, 403);
    await fail('DELETE', `/api/presentations/${P.id}?purge=1`, undefined, 403);
    await fail('POST', `/api/presentations/${P.id}/restore`, {}, 403);
    await fail('POST', `/api/presentations/${P.id}/transfer`, { toUserId: B.id }, 403);
    await fail('GET', `/api/presentations/${P.id}/versions`, undefined, 403);
    await fail('GET', `/api/presentations/${P.id}/versions/1`, undefined, 403);
    await fail('POST', `/api/presentations/${P.id}/versions/1/restore`, { baseRev: rev }, 403);
    await fail('GET', `/api/presentations/${P.id}/interactions.csv?kind=form_response`, undefined, 403);
    const dup = await cB.post(`/api/presentations/${P.id}/duplicate`, {}); assert.equal(dup.status, 201); assert.equal(dup.json.owner.id, B.id); assert.equal(dup.json.sourceId, P.id);
    const after = (await cA.get(`/api/presentations/${P.id}`)).json; assert.equal(after.rev, rev); assert.equal(after.title, 'Da Ana'); assert.equal(after.owner.id, A.id);
    assert.equal((await t.ops.asSystem((tx) => tx`select owner_id from app.presentations where id = ${P.id}`))[0].owner_id, A.id);
    // id inexistente e id malformado → 404, sem diferença
    for (const bad of [UUID0, 'x', '../', `${P.id}'`, P.id.toUpperCase().slice(0, -1) + 'Z']) { const r = await cB.get(`/api/presentations/${bad}`); assert.equal(r.status, 404, bad); }
  });
  test('lixeira alheia é invisível: GET/comentários/interações/cópia/restaurar/asset → 404; o dono e o admin veem', async () => {
    for (const [m, p, j] of [['GET', `/api/presentations/${PT.id}`], ['GET', `/api/presentations/${PT.id}/comments`], ['POST', `/api/presentations/${PT.id}/comments`, { body: 'oi' }], ['GET', `/api/presentations/${PT.id}/interactions`],
      ['POST', `/api/presentations/${PT.id}/interactions`, { kind: 'view', elementId: '', payload: {} }], ['POST', `/api/presentations/${PT.id}/duplicate`, {}], ['POST', `/api/presentations/${PT.id}/restore`, {}], ['GET', `/api/presentations/${PT.id}/share`], ['GET', `/api/presentations/${PT.id}/versions`]]) {
      const r = await cB.request(m, p, j ? { json: j } : {}); assert.equal(r.status, 404, `${m} ${p} → ${r.status}`);
    }
    assert.ok(!(await cB.get('/api/presentations?scope=trash')).json.items.some((x) => x.id === PT.id), 'lixeira de B não lista a de A');
    assert.ok(!(await cB.get('/api/presentations?scope=all&limit=100')).json.items.some((x) => x.id === PT.id));
    assert.equal((await cA.get(`/api/presentations/${PT.id}`)).status, 200); assert.equal((await cAdm.get(`/api/presentations/${PT.id}`)).status, 200);
    // asset usado SÓ por uma apresentação na lixeira: invisível para terceiros
    const buf = await png(77); const sha = sha256(buf);
    assert.equal((await cA.request('PUT', `/api/assets/${sha}`, { body: buf, headers: { 'content-type': 'image/png', 'x-asset-kind': 'image' } })).status, 201);
    const d = deck('Só lixeira'); d.slides[0].els.push({ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, src: `asset:sha256:${sha}` });
    const p2 = (await cA.post('/api/presentations', { content: d })).json; assert.equal((await cB.get(`/api/assets/${sha}`)).status, 200, 'visível enquanto a apresentação está no acervo');
    assert.equal((await cA.del(`/api/presentations/${p2.id}`)).status, 204);
    assert.equal((await cB.get(`/api/assets/${sha}`)).status, 404, 'invisível depois que a apresentação foi para a lixeira');
    assert.deepEqual((await cB.post('/api/assets/check', { shas: [sha] })).json.missing, [sha], 'check não é oráculo');
  });
  test('comentários: editar/apagar/resolver o comentário de outra pessoa (sem ser dono nem admin) → 403; o dono modera; o banco também barra', async () => {
    const c1 = await cC.post(`/api/presentations/${P.id}/comments`, { body: 'da Carla' }); assert.equal(c1.status, 201);
    assert.equal((await cB.patch(`/api/comments/${c1.json.id}`, { body: 'alterado por Bruno' })).status, 403);
    assert.equal((await cB.patch(`/api/comments/${c1.json.id}`, { resolved: true })).status, 403);
    assert.equal((await cB.del(`/api/comments/${c1.json.id}`)).status, 403);
    assert.equal((await cA.patch(`/api/comments/${c1.json.id}`, { body: 'dono tenta editar texto' })).status, 403, 'nem o dono edita o TEXTO alheio');
    assert.equal((await cA.patch(`/api/comments/${c1.json.id}`, { resolved: true })).status, 200, 'o dono resolve');
    assert.equal((await cA.del(`/api/comments/${c1.json.id}`)).status, 204, 'o dono apaga');
    // tentativa direta no banco como B (RLS + gatilho)
    const c2 = (await cC.post(`/api/presentations/${P.id}/comments`, { body: 'outro da Carla' })).json;
    await assert.rejects(() => t.db.asUser(B.id, (tx) => tx`update app.comments set body = 'hack' where id = ${c2.id}::uuid`), /42501|permiss|autor/i);
    await assert.rejects(() => t.db.asUser(B.id, (tx) => tx`update app.comments set author_id = ${B.id}::uuid where id = ${c2.id}::uuid`));
  });
  test('interações: cada um lê só as suas; dono/admin leem tudo; user_id vem da sessão (não do corpo); CSV só dono/admin', async () => {
    const ok = await cB.post(`/api/presentations/${P.id}/interactions`, { kind: 'form_response', elementId: 'f1', payload: { at: 'x', q: ['Nome'], a: ['Bruno secreto'] } }); assert.equal(ok.status, 201, ok.text);
    const forged = await cC.post(`/api/presentations/${P.id}/interactions`, { kind: 'form_response', elementId: 'f1', payload: { a: ['x'] }, userId: B.id }); assert.equal(forged.status, 400, 'campo extra recusado (strict)');
    const seenByC = (await cC.get(`/api/presentations/${P.id}/interactions`)).json.items; assert.ok(!seenByC.some((i) => JSON.stringify(i.payload).includes('Bruno secreto')), 'Carla não vê a resposta do Bruno');
    const seenByA = (await cA.get(`/api/presentations/${P.id}/interactions?kind=form_response&elementId=f1`)).json.items; assert.ok(seenByA.some((i) => i.user.id === B.id && i.payload.a[0] === 'Bruno secreto'));
    assert.equal((await cC.get(`/api/presentations/${P.id}/interactions.csv?kind=form_response`)).status, 403);
    const csv = await cA.get(`/api/presentations/${P.id}/interactions.csv?kind=form_response&elementId=f1`); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /^attachment; filename="respostas-[0-9a-f]{8}\.csv"$/);
    assert.ok(csv.text.includes('Bruno secreto'));
  });
  test('escalada de papel: PATCH /me com role/status → 400 e nada muda; PATCH /api/admin/users como membro → 403; UPDATE direto no banco → negado', async () => {
    for (const body of [{ role: 'admin' }, { displayName: 'B', role: 'admin' }, { status: 'active', role: 'admin' }, { id: ADM.id, displayName: 'x' }]) { const r = await cB.patch('/api/me', body); assert.equal(r.status, 400, JSON.stringify(body) + ' → ' + r.status); }
    assert.equal((await cB.patch(`/api/admin/users/${B.id}`, { role: 'admin' })).status, 403);
    assert.equal((await cB.patch(`/api/admin/users/${A.id}`, { status: 'suspended' })).status, 403);
    await assert.rejects(() => t.db.asUser(B.id, (tx) => tx`update app.users set role = 'admin' where id = ${B.id}::uuid`), /42501|admin/i);
    assert.equal((await t.db.asUser(B.id, (tx) => tx`update app.users set status = 'suspended' where id = ${A.id}::uuid`)).count, 0, 'RLS: a linha de A é invisível para B');
    assert.equal((await t.db.asUser(B.id, (tx) => tx`update app.presentations set owner_id = ${B.id}::uuid where id = ${P.id}::uuid`)).count, 0, 'RLS: B não altera a linha de A');
    await assert.rejects(() => t.db.asUser(B.id, (tx) => tx`insert into app.users(email, display_name, role, status) values ('x@y.co', 'x', 'admin', 'active')`));
    await assert.rejects(() => t.db.asUser(B.id, (tx) => tx`set local role app_system`), /permission|permissão|42501/i);
    const me = (await cB.get('/api/me')).json; assert.equal(me.role, 'member'); assert.equal((await t.ops.asSystem((tx) => tx`select role from app.users where id = ${B.id}`))[0].role, 'member');
  });
  test('rotas de admin para membro: 403 em todas (inclusive caminhos inexistentes), sem vazar existência de usuários/convites', async () => {
    for (const [m, p, j] of [['GET', '/api/admin/users'], ['GET', '/api/admin/users?q=admin'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/settings'], ['GET', '/api/admin/stats'], ['GET', '/api/admin/nao-existe'],
      ['POST', '/api/admin/invites', { email: 'novo@am.test', displayName: 'Novo' }], ['POST', `/api/admin/invites/${UUID0}/resend`, {}], ['DELETE', `/api/admin/invites/${UUID0}`], ['PUT', '/api/admin/settings/uploads.max_bytes', { value: 1048576 }], ['PATCH', `/api/admin/users/${UUID0}`, { role: 'admin' }]]) {
      const r = await cB.request(m, p, j ? { json: j } : {}); assert.equal(r.status, 403, `${m} ${p} → ${r.status}`); assert.equal(errCode(r), 'forbidden');
    }
    assert.equal((await t.anon().get('/api/admin/users')).status, 401);
    const invites = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.invites where email = 'novo@am.test'`); assert.equal(invites[0].n, 0);
  });
  test('arquivo alheio por sha adivinhado: GET → 404; check → "faltante"; finalize → 404; reenviar os MESMOS bytes dá posse (prova de posse, por desenho)', async () => {
    const buf = await png(500); const sha = sha256(buf);
    assert.equal((await cA.request('PUT', `/api/assets/${sha}`, { body: buf, headers: { 'content-type': 'image/png', 'x-asset-kind': 'image' } })).status, 201);
    assert.equal((await cB.get(`/api/assets/${sha}`)).status, 404); assert.deepEqual((await cB.post('/api/assets/check', { shas: [sha] })).json.missing, [sha]);
    assert.equal((await cB.post(`/api/assets/${sha}/finalize`, {})).status, 404);
    assert.equal((await cB.post('/api/assets/uploads', { sha256: sha, size: buf.length, mime: 'image/png', kind: 'image' })).json.mode, 'api', 'driver local: sem URL assinada');
    assert.equal((await cB.get(`/api/assets/${sha}`)).status, 404, 'o pedido de upload direto não deu posse');
    const d = deck('Usa asset alheio'); d.slides[0].els.push({ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, src: `asset:sha256:${sha}` });
    const r = await cB.post('/api/presentations', { content: d }); assert.equal(r.status, 422); assert.deepEqual(r.json.error.details.reasons, ['asset_inexistente']);
    const re = await cB.request('PUT', `/api/assets/${sha}`, { body: buf, headers: { 'content-type': 'image/png', 'x-asset-kind': 'image' } }); assert.equal(re.status, 200); assert.equal(re.json.deduplicated, true);
    assert.equal((await cB.get(`/api/assets/${sha}`)).status, 200, 'quem tem os bytes prova a posse');
  });
  test('ACHADO? (driver s3) POST /api/assets/uploads com o sha de um arquivo ALHEIO não pode dar posse nem revelar metadados no finalize', async () => {
    // armazenamento S3 falso em memória: devolve URL assinada (como o Supabase Storage/S3 fariam), para exercitar o fluxo direto sem rede
    const mem = new Map();
    const fakeS3 = {
      driver: 's3',
      async put(sha, bytes) { mem.set(sha, Buffer.from(bytes)); return { created: true, size: bytes.length }; },
      async get(sha) { const b = mem.get(sha); return b ? { body: b, size: b.length } : null; },
      async getStream(sha) { const b = mem.get(sha); return b ? { stream: new Blob([b]).stream(), size: b.length } : null; },
      async head(sha) { const b = mem.get(sha); return b ? { size: b.length } : null; },
      async delete(sha) { return { deleted: mem.delete(sha) }; },
      async signedGetUrl(sha) { return `https://bucket.example/a/${sha}?X-Amz-Signature=x`; },
      async createUpload(sha, { size, mime }) { return { url: `https://bucket.example/a/${sha}?X-Amz-Signature=up`, method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(size) }, expiresAt: new Date(Date.now() + 300000).toISOString() }; },
      async verify(sha) { const b = mem.get(sha); return { ok: !!b && sha256(b) === sha, size: b ? b.length : null, actualSha: b ? sha256(b) : null }; },
      async list() { return { keys: [], items: [], next: null }; }, async ping() { return true; },
      /* área de preparo (o atacante nunca envia bytes, então fica vazia) */
      async getStaging() { return null; }, async promoteStaging(u, sha) { return { promoted: false, existed: mem.has(sha) }; }, async deleteStaging() { return { deleted: false }; }, async purgeStaging() { return { deleted: 0, bytes: 0 }; },
    };
    // a MESMA API (mesmo banco, GoTrue e config), só com o driver de armazenamento trocado: nada de novo boot (que recriaria o banco)
    const { createApp } = await import('../../src/app.js');
    const app2 = createApp({ ...t.deps, storage: fakeS3 });
    const via = async (client, method, p, { json, body, headers = {} } = {}) => {
      const h = new Headers({ Origin: t.config.origin, 'X-Forwarded-For': client.ip, Cookie: [...client.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers });
      if (method !== 'GET') h.set('X-CSRF-Token', client.cookie('am_csrf'));
      let payload = body; if (json !== undefined) { payload = JSON.stringify(json); h.set('Content-Type', 'application/json'); }
      const res = await app2.request(p, { method, headers: h, body: payload }); const text = await res.text(); let j; try { j = JSON.parse(text); } catch { j = undefined; }
      return { status: res.status, text, json: j };
    };
    const owner = await t.createUser({ displayName: 'Dona S3' }), thief = await t.createUser({ displayName: 'Ladrão S3' });
    const co = await t.as(owner), ct = await t.as(thief);
    const buf = await png(900); const sha = sha256(buf);
    const up = await via(co, 'PUT', `/api/assets/${sha}`, { body: buf, headers: { 'content-type': 'image/png', 'x-asset-kind': 'image' } }); assert.equal(up.status, 201, up.text);
    assert.equal((await via(ct, 'GET', `/api/assets/${sha}`)).status, 404, 'antes do ataque: invisível');
    // ataque: pedir URL de upload direto para o sha alheio (sem ter os bytes) e depois tentar ler/finalizar
    const req = await via(ct, 'POST', '/api/assets/uploads', { json: { sha256: sha, size: buf.length, mime: 'image/png', kind: 'image' } }); assert.equal(req.status, 200, req.text); assert.equal(req.json.mode, 'direct');
    const fin = await via(ct, 'POST', `/api/assets/${sha}/finalize`, { json: {} });
    const get = await via(ct, 'GET', `/api/assets/${sha}`);
    const owners = (await t.ops.asSystem((tx) => tx`select user_id from app.asset_uploads where sha256 = ${sha}`)).map((r) => r.user_id);
    const problems = [];
    if (owners.includes(thief.id)) problems.push('o pedido de upload direto registrou POSSE (app.asset_uploads) de um arquivo que o atacante nunca enviou');
    if (fin.status !== 404) problems.push(`finalize revelou o arquivo alheio: ${fin.status} ${fin.text.slice(0, 120)}`);
    if (get.status !== 404) problems.push(`GET devolveu o arquivo alheio ao atacante: ${get.status}`);
    assert.deepEqual(problems, [], problems.join(' | '));
  });
  test('ACHADO? asset removido da cópia de trabalho mas presente só em versão antiga (histórico é privado) continua legível por terceiros', async () => {
    const buf = await png(600); const sha = sha256(buf);
    assert.equal((await cA.request('PUT', `/api/assets/${sha}`, { body: buf, headers: { 'content-type': 'image/png', 'x-asset-kind': 'image' } })).status, 201);
    const d = deck('Com imagem depois removida'); d.slides[0].els.push({ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, src: `asset:sha256:${sha}` });
    const p = (await cA.post('/api/presentations', { content: d })).json;
    assert.equal((await cA.put(`/api/presentations/${p.id}/content`, { baseRev: p.rev, content: d, snapshot: true, label: 'com imagem' })).json.snapshotNo, 1);
    const d2 = deck('Sem a imagem'); const r2 = await cA.put(`/api/presentations/${p.id}/content`, { baseRev: p.rev, content: d2 }); assert.equal(r2.status, 200, r2.text);
    assert.equal((await cB.get(`/api/presentations/${p.id}/versions`)).status, 403, 'o histórico é privado para B');
    assert.equal((await cB.get(`/api/assets/${sha}`)).status, 404, 'B ainda baixa o arquivo que só existe numa versão do histórico privado (RLS assets_select conta asset_refs de version_no > 0)');
  });
});

/* ═══════════════════════════════════════════════════════════ 4. injeção ═════════════════════════════════════════════════════════ */
describe('injeção: SQL, cursor, JSON/protótipo, CSV, cabeçalhos, caminhos, SSRF', () => {
  test('SQL: q com aspas/comentário/%/_/\\ nunca quebra (200 com filtro literal) e parâmetros inválidos dão 400/404, nunca 500', async () => {
    await cA.post('/api/presentations', { title: 'Alvo 100% único_x' });
    const bad500 = [];
    for (const q of ["' OR 1=1 --", "'; drop table app.presentations; --", '%', '_', '\\', '%_\\', "\\' or ''='", 'x" or "1"="1', '${1+1}', '{{7*7}}', '\u0000', 'a\u0000b']) {
      const r = await cA.get('/api/presentations?q=' + encodeURIComponent(q)); if (![200, 400].includes(r.status)) bad500.push(`GET /api/presentations?q=${JSON.stringify(q)} → ${r.status}`);
      if (r.status === 200 && q === '%') assert.ok(r.json.items.every((i) => i.title.includes('%')), '% é literal, não curinga');
      if (r.status === 200 && q === '_') assert.ok(r.json.items.every((i) => i.title.includes('_')), '_ é literal');
      const au = await cAdm.get('/api/admin/users?q=' + encodeURIComponent(q)); if (![200, 400].includes(au.status)) bad500.push(`GET /api/admin/users?q=${JSON.stringify(q)} → ${au.status}`);
    }
    for (const [m, p, j] of [['POST', '/api/presentations', { title: 'a\u0000b' }], ['PATCH', '/api/me', { displayName: 'a\u0000b' }], ['POST', '/api/admin/invites', { email: 'nul\u0000@am.test', displayName: 'x' }], ['GET', '/api/presentations?owner=' + encodeURIComponent('\u0000')], ['POST', `/api/presentations/${P.id}/interactions`, { kind: 'view', elementId: 'a\u0000b', payload: {} }]]) {
      const r = await cAdm.request(m, p, j ? { json: j } : {}); if (r.status >= 500) bad500.push(`${m} ${p} → ${r.status}`);
    }
    assert.deepEqual(bad500, [], 'byte NUL em parâmetro vira 500 (deveria ser 400): ' + bad500.join(' | '));
    assert.equal((await cAdm.get('/api/admin/users?q=%')).json.items.length, 0, 'nenhum e-mail contém % literal');
    for (const [p, st] of [['/api/presentations?owner=x', 400], ["/api/presentations?owner=' or 1=1--", 400], ['/api/presentations?limit=0', 400], ['/api/presentations?limit=1e9', 400], ['/api/presentations?scope=evil', 400], ['/api/presentations?cursor=' + encodeURIComponent("' or 1=1--"), 400],
      ['/api/admin/audit?action=' + encodeURIComponent("x' or '1'='1"), 400], ['/api/admin/audit?cursor=' + encodeURIComponent('1 or 1=1'), 400], ['/api/admin/audit?from=' + encodeURIComponent("2026-01-01'; drop table"), 400], ['/api/admin/users?cursor=' + encodeURIComponent(Buffer.from('["2026-01-01 00:00:00+00\'; drop","' + UUID0 + '"]').toString('base64url')), 400],
      ['/api/presentations/' + UUID0 + '/versions/1e3', 404], ['/api/presentations/' + P.id + '/versions/-1', 404], ['/api/presentations/' + P.id + '/versions/' + encodeURIComponent('1 or 1=1'), 404], ['/api/presentations/' + P.id + '/interactions?kind=x', 400], ['/api/presentations/' + P.id + "/interactions?elementId=" + encodeURIComponent("a' or 1=1"), 400]]) {
      const r = await cAdm.get(p); assert.equal(r.status, st, p + ' → ' + r.status + ' ' + r.text.slice(0, 80));
    }
    assert.equal((await cAdm.put('/api/admin/settings/__proto__', { value: 1 })).status, 404);
    assert.equal((await cAdm.put('/api/admin/settings/constructor', { value: 1 })).status, 404);
    assert.equal((await cAdm.put('/api/admin/settings/uploads.max_bytes', { value: '1048576' })).status, 400, 'tipo errado');
  });
  test('cursor opaco adulterado (assinatura, contexto de outro usuário/filtro, posição forjada) → 400', async () => {
    for (let i = 0; i < 3; i++) await cA.post('/api/presentations', { title: 'Cursor ' + i });
    const first = await cA.get('/api/presentations?limit=1'); const cur = first.json.nextCursor; assert.ok(cur);
    assert.equal((await cA.get('/api/presentations?limit=1&cursor=' + cur)).status, 200, 'cursor legítimo');
    const [body, sig] = cur.split('.');
    const forgedBody = Buffer.from(JSON.stringify(['2099-01-01T00:00:00.000000Z', UUID0])).toString('base64url');
    for (const bad of [`${forgedBody}.${sig}`, `${body}.${sig.slice(0, -2)}AA`, body, `${body}.`, `${body}.${sig}.x`, forgedBody, 'x'.repeat(600), encodeURIComponent(`${body}.${sig}`) + '%00']) {
      const r = await cA.get('/api/presentations?limit=1&cursor=' + bad); assert.equal(r.status, 400, bad.slice(0, 30) + ' → ' + r.status);
    }
    assert.equal((await cB.get('/api/presentations?limit=1&cursor=' + cur)).status, 400, 'cursor de A não serve para B (contexto no HMAC)');
    assert.equal((await cA.get('/api/presentations?limit=1&scope=mine&cursor=' + cur)).status, 400, 'nem com outro filtro');
    const key = cursorKey(t.config); const mine = encodeCursor(['2099-01-01T00:00:00.000000Z', UUID0], { key, ctx: `${A.id}|all||` });
    assert.equal((await cA.get('/api/presentations?limit=1&cursor=' + mine)).status, 200, 'assinatura correta com a chave do servidor (só o servidor a tem)');
  });
  test('protótipo: __proto__ no deck → 422; __proto__/constructor no payload de interação não polui o servidor nem o cloud-core', async () => {
    const polluted = () => ({}).polluted !== undefined || Object.prototype.polluted !== undefined;
    const d = JSON.parse('{"v":1,"app":"AM Studio","id":"d","title":"T","slides":[{"id":"s","els":[]}],"__proto__":{"polluted":1}}');
    const r = await cA.post('/api/presentations', { content: d }); assert.equal(r.status, 422); assert.ok(r.json.error.details.reasons.includes('chave_proibida'));
    const d2 = JSON.parse('{"v":1,"app":"AM Studio","id":"d","title":"T","slides":[{"id":"s","els":[{"id":"e","type":"text","html":"x","constructor":{"prototype":{"polluted":1}}}]}]}');
    const r2 = await cA.post('/api/presentations', { content: d2 }); assert.ok([201, 422].includes(r2.status)); assert.ok(!polluted(), 'servidor não poluído pelo deck');
    const payloads = ['{"__proto__":{"polluted":1}}', '{"constructor":{"prototype":{"polluted":1}}}', '{"a":{"__proto__":{"polluted":1}}}'];
    for (const p of payloads) {
      const ir = await cA.request('POST', `/api/presentations/${P.id}/interactions`, { body: `{"kind":"board_state","elementId":"b1","payload":${p}}`, headers: { 'content-type': 'application/json' } });
      assert.ok([200, 201, 400].includes(ir.status), ir.text); assert.ok(!polluted(), 'servidor não poluído por ' + p);
    }
    const cc = require(path.join(PLATFORM, 'studio-cloud', 'cloud-core.js'));
    const nasty = JSON.parse('{"v":1,"slides":[{"__proto__":{"polluted":1},"els":[{"src":"asset:sha256:' + 'a'.repeat(64) + '","constructor":{"prototype":{"polluted":1}}}]}]}');
    const hyd = await cc.hydrateDeck(nasty, { fetchAsset: async () => ({ mime: 'image/png', bytes: new Uint8Array([1]) }) });
    assert.ok(!polluted(), 'hydrateDeck não polui o protótipo GLOBAL');
    if (Object.getPrototypeOf(hyd.slides[0]) !== Object.prototype) LOG.push({ level: 'note', m: 'residual:cloud-core mapStrings copia __proto__ como protótipo LOCAL do objeto (sem poluição global; o servidor recusa a chave)', f: {} });
    const ext = await cc.externalizeDeck(nasty, { api: { check: async (s) => s, put: async () => {} } }); assert.ok(!polluted(), 'externalizeDeck não polui'); assert.ok(ext.content);
    assert.ok(!polluted());
  });
  test('CSV: células que começam com = + - @ TAB CR ganham apóstrofo (inclusive cabeçalhos/perguntas); aspas e ; escapados', async () => {
    const p = (await cA.post('/api/presentations', { title: 'CSV' })).json;
    const r = await cB.post(`/api/presentations/${p.id}/interactions`, { kind: 'form_response', elementId: 'f', payload: { at: '2026-01-01', q: ['=HYPERLINK("http://evil")', 'Nome;"x"', 'q3', 'q4', 'q5', 'q6', 'q7'], a: ['=cmd|\' /C calc\'!A0', '+1234', '-2+3', '@SUM(A1)', '\tx', '\rx', 'texto; com "aspas"'] } }); assert.equal(r.status, 201, r.text);
    // bytes crus (Response.text() descarta o BOM): o CSV começa com EF BB BF
    const rawRes = await t.app.request(`/api/presentations/${p.id}/interactions.csv?kind=form_response&elementId=f`, { headers: { Cookie: [...cA.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'X-Forwarded-For': cA.ip } });
    const rawBuf = Buffer.from(await rawRes.arrayBuffer()); assert.equal(rawRes.status, 200); assert.deepEqual([...rawBuf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8');
    const csv = rawBuf.toString('utf8'); const lines = csv.replace(/^﻿/, '').split('\r\n');
    assert.ok(lines[0].includes(`"'=HYPERLINK(""http://evil"")"`), lines[0]); assert.ok(lines[0].includes('"Nome;""x"""'));
    for (const cell of [`'=cmd|' /C calc'!A0`, "'+1234", "'-2+3", "'@SUM(A1)", `'\tx`, `"'\rx"`, '"texto; com ""aspas"""']) assert.ok(lines[1].includes(cell), `${JSON.stringify(cell)} em ${JSON.stringify(lines[1])}`);
    assert.ok(!/(^|;)[=+\-@]/.test(lines[1].replace(/"[^"]*"/g, '""')), 'nenhuma célula sem aspas começa com fórmula');
  });
  test('injeção de cabeçalho: X-Request-Id com CRLF/injeção é descartado; título com CRLF/unicode não vaza para Location/ETag', async () => {
    for (const bad of ['abc def!@#', 'x'.repeat(100), 'curto', '<script>alert(1)</script>', 'a;b=c']) { const r = await cA.get('/api/me', { headers: { 'x-request-id': bad } }); assert.notEqual(r.headers.get('x-request-id'), bad); assert.match(r.headers.get('x-request-id'), /^[A-Za-z0-9_-]{8,64}$/); }
    const r2 = await cA.get('/api/me', { headers: { 'x-request-id': 'legit-id-123' } }); assert.equal(r2.headers.get('x-request-id'), 'legit-id-123'); assert.equal(r2.json.id, A.id);
    const title = 'Título\r\nSet-Cookie: x=1‮evil"<>'; const c = await cA.post('/api/presentations', { title }); assert.equal(c.status, 201, c.text);
    assert.match(c.headers.get('location'), /^\/api\/presentations\/[0-9a-f-]{36}$/); assert.ok(!c.headers.get('set-cookie')); assert.ok(!c.json.title.includes('\r') && !c.json.title.includes('‮'));
    const g = await cA.get(`/api/presentations/${c.json.id}`); assert.match(g.headers.get('etag'), /^"\d+"$/);
    const csv = await cA.get(`/api/presentations/${c.json.id}/interactions.csv?kind=${encodeURIComponent('form_response"\r\nX: y')}`); assert.equal(csv.status, 400);
  });
  test('path traversal: estático (../, %2e%2e, %2f, backslash, dotfiles, symlink, /api codificado) e armazenamento (sha com ../) → 404/400', async () => {
    const c = t.anon();
    for (const p of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/assets/..%5c..%5cpackage.json', '/assets\\..\\package.json', '/.git/config', '/.env', '/js/../../src/config.js', '/api%2fhealth', '/API/health', '/editor/../../../etc/passwd', '/%00', '/assets/%00.png', '/vendor/pdfjs-4.10.38/../../../package.json']) {
      const r = await c.get(p); assert.ok([404, 400].includes(r.status), `${p} → ${r.status}`); assert.ok(!r.text.includes('"name": "canteiro-plataforma"') && !r.text.includes('loadConfig'), p + ' vazou conteúdo');
    }
    assert.equal((await c.get('/js/cloud-core.js')).status, 200, 'controle: arquivo legítimo');
    for (const bad of ['../../etc/passwd', 'a'.repeat(63), 'A'.repeat(64), 'a'.repeat(64) + '/', '%2e%2e%2f' + 'a'.repeat(58), 'a'.repeat(32) + '\u0000' + 'a'.repeat(31)]) {
      const r = await cA.get('/api/assets/' + bad); assert.ok([404, 400].includes(r.status), bad + ' → ' + r.status);
      const w = await cA.request('PUT', '/api/assets/' + bad, { body: 'x', headers: { 'content-type': 'image/png' } }); assert.ok([400, 403, 404, 405].includes(w.status), 'PUT ' + bad + ' → ' + w.status);
      assert.throws(() => assertSha(decodeURIComponent(bad)), 'assertSha ' + bad);
    }
    assert.equal(objectKey('a'.repeat(64)), 'a/aa/aa/' + 'a'.repeat(64));
    assert.ok(!fs.existsSync(path.join(t.storageDir, 'etc')));
  });
  test('SSRF: nenhuma URL vinda do cliente é buscada pelo servidor (fetch só para o GoTrue/JWKS/S3 configurados)', () => {
    const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(path.join(PLATFORM, 'src'));
    const callers = files.filter((f) => /\bfetch\(|createRemoteJWKSet|http\.request|https\.request|net\.connect|undici/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(PLATFORM, f));
    assert.deepEqual(callers.sort(), ['src/auth/gotrue.js', 'src/auth/jwt.js', 'src/static.js'].sort(), 'quem chama a rede: ' + callers.join(', '));
    const gotrue = fs.readFileSync(path.join(PLATFORM, 'src/auth/gotrue.js'), 'utf8'); assert.match(gotrue, /doFetch\(base \+ path/); assert.match(gotrue, /redirect: 'error'/, 'o GoTrue não pode redirecionar a API para outro host');
    assert.match(fs.readFileSync(path.join(PLATFORM, 'src/static.js'), 'utf8'), /apiApp\.fetch\(c\.req\.raw/, 'static.js só repassa à própria API em memória');
    assert.match(fs.readFileSync(path.join(PLATFORM, 'src/auth/jwt.js'), 'utf8'), /createRemoteJWKSet\(new URL\(jwksUrl\)/);
  });
  test('JSON hostil: aninhamento de 100 000 níveis, 13 MB de corpo, UTF-8 inválido, NaN/Infinity, chaves gigantes → 400/413/422, nunca 500', async () => {
    const deep = '['.repeat(100000) + ']'.repeat(100000);
    const r1 = await cA.request('POST', '/api/presentations', { body: `{"content":{"v":1,"slides":${deep}}}`, headers: { 'content-type': 'application/json' } }); assert.ok([400, 422].includes(r1.status), r1.status + ' ' + r1.text.slice(0, 80));
    const big = '{"title":"' + 'x'.repeat(13.5 * 1024 * 1024) + '"}'; const r2 = await cA.request('POST', '/api/presentations', { body: big, headers: { 'content-type': 'application/json' } }); assert.equal(r2.status, 413);
    const r3 = await cA.request('POST', '/api/presentations', { body: Buffer.from([0x7b, 0x22, 0x74, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]), headers: { 'content-type': 'application/json' } }); assert.equal(r3.status, 400);
    const r4 = await cA.request('POST', '/api/presentations', { body: '{"title":NaN}', headers: { 'content-type': 'application/json' } }); assert.equal(r4.status, 400);
    const r5 = await cA.request('POST', '/api/presentations', { body: '{"content":{"v":1,"slides":[{"els":[{"n":1e999}]}]}}', headers: { 'content-type': 'application/json' } }); assert.ok([400, 422].includes(r5.status), r5.text);
    const r6 = await cA.request('POST', '/api/presentations', { body: '[1,2,3]', headers: { 'content-type': 'application/json' } }); assert.equal(r6.status, 400);
    const r7 = await cA.request('POST', '/api/presentations', { body: '{"content":{"v":1,"slides":[],"x":"\\ud800"}}', headers: { 'content-type': 'application/json' } }); assert.equal(r7.status, 422, 'surrogate solto não vira 500 no jsonb: ' + r7.text.slice(0, 100));
    const r8 = await cA.request('POST', '/api/presentations', { body: '{"content":{"v":1,"slides":[],"x":"a\\u0000b"}}', headers: { 'content-type': 'application/json' } }); assert.equal(r8.status, 422, r8.text.slice(0, 100));
  });
});

/* ═══════════════════════════════════════════════════════════ 5. XSS ═════════════════════════════════════════════════════════════ */
describe('XSS: corpus no deck via API, títulos, comentários e nomes', () => {
  test(`corpus: ${ATTACKS.length} ataques → 422 em texto, título do deck, chave de JSON, notas e nome de slide; ${LEGIT.length} textos legítimos → aceitos`, async () => {
    const p = (await cA.post('/api/presentations', { title: 'XSS' })).json; let rev = p.rev;
    const failures = []; let n = 0; const tick = async () => { if (++n % 15 === 0) await resetRates(); };
    for (const a of ATTACKS) {
      await tick();
      const spots = {
        html: deck('XSS', { html: a.value }), title: deck(a.value), notes: deck('XSS', { extra: {} }), key: JSON.parse(JSON.stringify(deck('XSS'))),
      };
      spots.notes.slides[0].notes = a.value; spots.key.slides[0].els[0][a.value] = 'x';
      for (const [where, content] of Object.entries(spots)) {
        const r = await cA.put(`/api/presentations/${p.id}/content`, { baseRev: rev, content }); if (r.status === 200) { rev = r.json.rev; failures.push(`${a.name} [${where}]`); }
        else if (r.status !== 422) failures.push(`${a.name} [${where}] → ${r.status}`);
      }
      // título: normalizeTitle corta em 200 chars e troca controles (\t \n \0) por espaço — cargas que dependem disso ficam inofensivas por construção; as demais têm de ser recusadas
      if (a.value.length <= 180 && !/[\u0000-\u001f]/.test(a.value)) { const t2 = await cA.patch(`/api/presentations/${p.id}`, { title: a.value }); if (t2.status === 200) { rev = t2.json.rev; failures.push(`${a.name} [PATCH title]`); } }
      else if (a.value.length <= 180) { const t2 = await cA.patch(`/api/presentations/${p.id}`, { title: a.value }); if (t2.status === 200) { rev = t2.json.rev; const stored = t2.json.title; if (/javascript\s*:|<script|<svg|\bon(error|load|focus|toggle)\s*=/i.test(stored)) failures.push(`${a.name} [PATCH title → título gravado perigoso: ${stored.slice(0, 60)}]`); } }
    }
    assert.deepEqual(failures, [], 'ataques que passaram: ' + failures.join(' | '));
    const okFail = [];
    for (const s0 of LEGIT) { await tick(); const s = s0.split('a'.repeat(64)).join(SHA_A); const r = await cA.put(`/api/presentations/${p.id}/content`, { baseRev: rev, content: deck('XSS', { html: s }) }); if (r.status !== 200) okFail.push(s.slice(0, 50) + ' → ' + r.status + ' ' + JSON.stringify(r.json && r.json.error && r.json.error.details)); else rev = r.json.rev; }
    assert.deepEqual(okFail, [], 'falsos positivos: ' + okFail.join(' | '));
    const audits = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.audit_log where action = 'security.rejected_content' and entity_id = ${p.id}`); assert.ok(audits[0].n >= ATTACKS.length, 'recusas auditadas: ' + audits[0].n);
    const leak = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.audit_log where meta::text ilike '%alert(1)%' or meta::text ilike '%<script%'`); assert.equal(leak[0].n, 0, 'a auditoria não guarda o conteúdo recusado');
  });
  test('ACHADO? evasão por caractere de formato: form feed (\\f, U+000C) entre atributos é espaço em branco para o navegador e precisa ser recusado', async () => {
    const variants = { 'img FF onerror': '<img src=x\fonerror="window.__xss=1">', 'img FF antes do src': '<img\fsrc=x\fonerror=alert(1)>', 'a FF href js': '<a\fhref="javascript:alert(1)">x</a>', 'svg FF onload': '<svg\fonload=alert(1)>', 'FF em tag deny': '<scr\fipt>alert(1)</script>' };
    const passed = [];
    for (const [name, html] of Object.entries(variants)) {
      let lint = 'rejeitado'; try { lintDeck(deck('x', { html })); lint = 'PASSOU'; } catch { /* esperado */ }
      const r = await cA.post('/api/presentations', { content: deck('FF', { html }) }); if (r.status !== 422) passed.push(`${name}: lint=${lint} api=${r.status}`);
    }
    assert.deepEqual(passed, [], 'variantes aceitas (o lint remove U+000C antes de analisar e junta "src=x" com "onerror="): ' + passed.join(' | '));
  });
  test('título com HTML no PATCH → 422; nome de usuário com < > → 400; comentário guarda texto puro (a interface escapa) e recusa controles', async () => {
    assert.equal((await cA.patch(`/api/presentations/${P.id}`, { title: '<img src=x onerror=alert(1)>' })).status, 422);
    assert.equal((await cA.patch(`/api/presentations/${P.id}`, { title: 'javascript:alert(1)' })).status, 422);
    assert.equal((await cA.patch(`/api/presentations/${P.id}`, { title: 'Título normal <3 & "aspas" 100%' })).status, 200);
    for (const n of ['<b>x</b>', 'Ana<script>', 'x>y', 'a\u0000b', 'a\u001fb']) assert.equal((await cB.patch('/api/me', { displayName: n })).status, 400, n);
    assert.equal((await cAdm.post('/api/admin/invites', { email: 'nome.html@am.test', displayName: '<svg onload=alert(1)>' })).status, 400);
    assert.equal((await cAdm.patch(`/api/admin/users/${B.id}`, { displayName: 'B <i>x</i>' })).status, 400);
    const ok = await cB.patch('/api/me', { displayName: 'Bruno & "Membro" ‮' }); assert.equal(ok.status, 200, 'bidi é aceito (resíduo: spoofing visual, não XSS)');
    await cB.patch('/api/me', { displayName: 'Bruno Membro' });
    const c = await cB.post(`/api/presentations/${P.id}/comments`, { body: '<img src=x onerror=alert(1)> & "x"' }); assert.equal(c.status, 201); assert.equal(c.json.body, '<img src=x onerror=alert(1)> & "x"', 'texto puro guardado tal qual (nunca interpretado como HTML pela interface)');
    assert.equal((await cB.post(`/api/presentations/${P.id}/comments`, { body: 'a\u0000b' })).status, 400);
    assert.equal((await cB.post(`/api/presentations/${P.id}/comments`, { body: 'x'.repeat(2001) })).status, 400);
    assert.equal((await cB.post(`/api/presentations/${P.id}/comments`, { body: 'ok', slideIndex: 500 })).status, 400);
    await cB.del(`/api/comments/${c.json.id}`);
  });
});

/* ═══════════════════════════════════════════════════════════ 6. uploads ═════════════════════════════════════════════════════════ */
describe('uploads hostis', () => {
  const put = (c, sha, buf, h = {}) => c.request('PUT', `/api/assets/${sha}`, { body: buf, headers: { 'content-type': 'image/png', 'x-asset-kind': 'image', ...h } });
  const pngChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  test('polyglot PNG+HTML (tEXt com <script>), PNG com lixo após IEND, SVG, HTML como .png, PDF disfarçado de imagem → 415/422; nada gravado', async () => {
    const good = await png(10);
    const iend = good.lastIndexOf(Buffer.from('IEND')) - 4; const poly = Buffer.concat([good.subarray(0, iend), pngChunk('tEXt', Buffer.from('Comment\0<script>alert(1)</script><html>')), good.subarray(iend)]);
    const trailing = Buffer.concat([good, Buffer.from('<html><script>alert(1)</script></html>')]);
    const cases = [['polyglot tEXt', poly, 422], ['lixo após IEND', trailing, 422], ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 415], ['SVG com BOM e espaço', Buffer.from('﻿  <?xml version="1.0"?><svg/>'), 415],
      ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>'), 415], ['PDF como image', Buffer.from('%PDF-1.4\n%%EOF'), 415], ['GIF com script', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(7), Buffer.from('<script>alert(1)</script>')]), 422], ['vazio', Buffer.alloc(0), 422], ['EXE', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 415]];
    for (const [name, buf, st] of cases) {
      const sha = sha256(buf); const r = await put(cA, sha, buf); assert.equal(r.status, st, `${name} → ${r.status} ${r.text.slice(0, 100)}`);
      assert.equal((await t.ops.asSystem((tx) => tx`select count(*)::int n from app.assets where sha256 = ${sha}`))[0].n, 0, name + ': nada no banco');
      assert.equal(await t.storage.head(sha), null, name + ': nada no armazenamento');
    }
    const html = await put(cA, sha256(good), good, { 'content-type': 'text/html', 'x-asset-kind': 'image' }); assert.equal(html.status, 403); assert.equal(errCode(html), 'csrf', 'Content-Type fora da lista binária morre já na camada CSRF');
    const ok = await put(cA, sha256(good), good, { 'content-type': 'image/jpeg', 'x-asset-kind': 'image' }); assert.ok([200, 201].includes(ok.status), ok.text); assert.equal(ok.json.mime, 'image/png', 'o tipo declarado é ignorado: o PNG é PNG');
  });
  test('kind/tipo incompatível, sha falso, X-Asset-Kind inválido, 100 MB declarado (413 sem ler), PDF com JavaScript (aceito como anexo, servido como download sandboxado)', async () => {
    const good = await png(11);
    assert.equal((await put(cA, sha256(good), good, { 'x-asset-kind': 'attachment' })).status, 415, 'imagem como anexo');
    assert.equal((await put(cA, sha256(await png(12)), await png(13))).status, 400, 'sha ≠ bytes');
    assert.equal((await put(cA, sha256(good), good, { 'x-asset-kind': 'evil' })).status, 400);
    const declared = await cA.request('PUT', `/api/assets/${'c'.repeat(64)}`, { body: 'x', headers: { 'content-type': 'image/png', 'content-length': String(100 * 1024 * 1024) } }); assert.ok([413, 400].includes(declared.status), 'Content-Length de 100 MB: ' + declared.status);
    const five = Buffer.alloc(5 * 1024 * 1024, 1); const huge = await cA.request('PUT', `/api/assets/${sha256(five)}`, { body: five, headers: { 'content-type': 'image/png' } }); assert.equal(huge.status, 413, 'corpo de 5 MB acima do teto de 4 MB da API');
    assert.equal(await t.storage.head(sha256(five)), null);
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog/OpenAction<</S/JavaScript/JS(app.alert(1))>>>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'); const sp = sha256(pdf);
    const r = await put(cA, sp, pdf, { 'content-type': 'application/pdf', 'x-asset-kind': 'attachment' }); assert.equal(r.status, 201, r.text);
    const g = await cA.get(`/api/assets/${sp}`); assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'application/pdf'); assert.match(g.headers.get('content-disposition'), /^attachment; filename="[0-9a-f]{16}\.pdf"/);
    assert.equal(g.headers.get('x-content-type-options'), 'nosniff'); assert.equal(g.headers.get('content-security-policy'), "default-src 'none'; sandbox"); assert.equal(g.headers.get('cross-origin-resource-policy'), 'same-origin');
    const img = await cA.get(`/api/assets/${SHA_A}`); assert.equal(img.headers.get('content-disposition'), 'inline'); assert.equal(img.headers.get('content-type'), 'image/png'); assert.equal(img.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  });
  test('ZIP bomb disfarçado de PPTX (razão > 200:1) e PPTX com macro → 422; ZIP genérico → 415; PPTX mínimo válido → 201', async () => {
    const entry = (name, data, { store = false } = {}) => {
      const comp = store ? data : zlib.deflateRawSync(data); const crc = zlib.crc32(data) >>> 0; const n = Buffer.from(name);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
      return { name: n, comp, crc, usize: data.length, method: store ? 0 : 8, local: Buffer.concat([lh, n, comp]) };
    };
    const zip = (entries) => {
      const locals = [], cds = []; let off = 0;
      for (const e of entries) { const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(e.method, 10); cd.writeUInt32LE(e.crc, 16); cd.writeUInt32LE(e.comp.length, 20); cd.writeUInt32LE(e.usize, 24); cd.writeUInt16LE(e.name.length, 28); cd.writeUInt32LE(off, 42); cds.push(Buffer.concat([cd, e.name])); locals.push(e.local); off += e.local.length; }
      const cdBuf = Buffer.concat(cds); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
      return Buffer.concat([...locals, cdBuf, eocd]);
    };
    const ct = entry('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')), slide = entry('ppt/slides/slide1.xml', Buffer.from('<p:sld/>'));
    const bomb = zip([ct, slide, entry('ppt/media/bomb.bin', Buffer.alloc(64 * 1024 * 1024, 0))]);   // 64 MB de zeros → ~65 KB comprimidos
    const up = (buf) => cA.request('PUT', `/api/assets/${sha256(buf)}`, { body: buf, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'x-asset-kind': 'attachment' } });
    assert.ok(bomb.length < 4 * 1024 * 1024, 'bomba cabe no limite da API: ' + bomb.length);
    const rb = await up(bomb); assert.equal(rb.status, 422, rb.text); assert.ok(rb.json.error.details.reasons.includes('zip_bomb'));
    const macro = await up(zip([ct, slide, entry('ppt/vbaProject.bin', Buffer.from('macro'))])); assert.equal(macro.status, 422); assert.ok(macro.json.error.details.reasons.includes('macros_ou_executaveis'));
    const generic = await up(zip([entry('a.txt', Buffer.from('oi'))])); assert.equal(generic.status, 415);
    const traversal = await up(zip([ct, entry('ppt/../../../etc/passwd', Buffer.from('x'))])); assert.equal(traversal.status, 422);
    const ok = await up(zip([ct, slide])); assert.equal(ok.status, 201, ok.text); assert.equal(ok.json.mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const g = await cA.get(`/api/assets/${ok.json.sha256}`); assert.match(g.headers.get('content-disposition'), /^attachment; filename="[0-9a-f]{16}\.pptx"/);
  });
  test('upload como kind=thumb: só imagens pequenas; thumbSha alheio/inexistente/não-thumb no PUT de conteúdo → 422', async () => {
    const big = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png({ compressionLevel: 0 }).toBuffer();
    assert.ok(big.length > 512 * 1024); assert.equal((await put(cA, sha256(big), big, { 'x-asset-kind': 'thumb' })).status, 413);
    const g = (await cA.get(`/api/presentations/${P.id}`)).json; const changed = { ...g.content, title: 'Thumb ' + Date.now() };
    assert.equal((await cA.put(`/api/presentations/${P.id}/content`, { baseRev: g.rev, content: changed, thumbSha: 'd'.repeat(64) })).status, 422, 'thumb inexistente');
    assert.equal((await cA.put(`/api/presentations/${P.id}/content`, { baseRev: g.rev, content: changed, thumbSha: SHA_A })).status, 422, 'imagem comum não serve como thumb');
    assert.equal((await cA.get(`/api/presentations/${P.id}`)).json.rev, g.rev, 'nada foi gravado');
  });
});

/* ═══════════════════════════════════════════════════════════ 7. abuso e limites ═════════════════════════════════════════════════ */
describe('abuso: custo do lint, tetos e limites de taxa', () => {
  test('deck de ~11,9 MB com 500 slides e strings de 2 MB passa no lint em tempo linear; 12 MB+, 501 slides, profundidade 41, string 2 MB+1 → 422', async () => {
    const big = deck('Grande', { slides: 500 }); const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. <b>neg</b> & "x" 100% '; const str2mb = filler.repeat(Math.floor((2 * 1024 * 1024 - 10) / filler.length));
    for (let i = 0; i < 5; i++) big.slides[i].els[0].html = str2mb;
    big.slides[5].notes = 'x'.repeat(12 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(big)) - 2000);
    const bytes = Buffer.byteLength(JSON.stringify(big)); assert.ok(bytes > 11.5 * 1024 * 1024 && bytes <= LIMITS.maxBytes, `tamanho ${bytes}`);
    const t0 = performance.now(); const info = lintDeck(big); const lintMs = performance.now() - t0; assert.equal(info.slideCount, 500);
    LOG.push({ level: 'metric', m: 'lint_12mb_ms', f: { ms: Math.round(lintMs), bytes } }); assert.ok(lintMs < 8000, `lint levou ${lintMs} ms`);
    const t1 = performance.now(); const r = await cA.post('/api/presentations', { content: big }); const apiMs = performance.now() - t1; assert.equal(r.status, 201, r.text.slice(0, 200));
    LOG.push({ level: 'metric', m: 'api_put_12mb_ms', f: { ms: Math.round(apiMs) } });
    const over = { ...big }; over.slides = [...big.slides, { id: 's500', els: [] }]; assert.throws(() => lintDeck(over), /recusado/);
    const over2 = deck('x'); over2.slides[0].notes = 'y'.repeat(12 * 1024 * 1024); assert.throws(() => lintDeck(over2), (e) => e.details.reasons.includes('tamanho_excedido'));
    let nest = {}; const root = nest; for (let i = 0; i < 41; i++) { nest.k = {}; nest = nest.k; } const dd = deck('x'); dd.slides[0].els[0].deep = root; assert.throws(() => lintDeck(dd), (e) => e.details.reasons.includes('profundidade_excedida'));
    let nest40 = {}; const root40 = nest40; for (let i = 0; i < 30; i++) { nest40.k = {}; nest40 = nest40.k; } const d40 = deck('x'); d40.slides[0].els[0].deep = root40; assert.doesNotThrow(() => lintDeck(d40), 'profundidade 35 (≤ 40) é aceita');
    const ds = deck('x', { html: 'a'.repeat(2 * 1024 * 1024 + 1) }); assert.throws(() => lintDeck(ds), (e) => e.details.reasons.includes('string_grande_demais'));
    // texto hostil para regex (sem ReDoS): 2 MB de aspas/espaços/"on"
    const hostile = ('" ' + 'on'.repeat(50) + ' ' + '&#x'.repeat(30) + '%2' + '\\u'.repeat(20)).repeat(9000).slice(0, 2 * 1024 * 1024 - 100);
    const t2 = performance.now(); try { lintDeck(deck('x', { html: hostile })); } catch { /* recusa é aceitável */ } const hostileMs = performance.now() - t2; LOG.push({ level: 'metric', m: 'lint_hostile_2mb_ms', f: { ms: Math.round(hostileMs) } }); assert.ok(hostileMs < 5000, `regex hostil levou ${hostileMs} ms`);
  });
  test('tetos: 1000 comentários ativos por apresentação (1001º → 409); 500 interações por pessoa/elemento (501ª → 409); resposta > 64 KB e estado de quadro > 256 KB → 413', async () => {
    await resetRates(); const p = (await cA.post('/api/presentations', { title: 'Tetos' })).json;
    await t.ops.asSystem((tx) => tx`insert into app.comments(presentation_id, author_id, body) select ${p.id}::uuid, ${B.id}::uuid, 'c' || g from generate_series(1, 999) g`);
    assert.equal((await cB.post(`/api/presentations/${p.id}/comments`, { body: 'nº 1000' })).status, 201);
    const r = await cB.post(`/api/presentations/${p.id}/comments`, { body: 'nº 1001' }); assert.equal(r.status, 409);
    await t.ops.asSystem((tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload) select ${p.id}::uuid, ${B.id}::uuid, 'form_response', 'f', '{}'::jsonb from generate_series(1, 499)`);
    assert.equal((await cB.post(`/api/presentations/${p.id}/interactions`, { kind: 'form_response', elementId: 'f', payload: { a: [] } })).status, 201);
    assert.equal((await cB.post(`/api/presentations/${p.id}/interactions`, { kind: 'form_response', elementId: 'f', payload: { a: [] } })).status, 409);
    assert.equal((await cB.post(`/api/presentations/${p.id}/interactions`, { kind: 'form_response', elementId: 'g', payload: { x: 'y'.repeat(65 * 1024) } })).status, 413, 'resposta > 64 KB');
    assert.equal((await cB.post(`/api/presentations/${p.id}/interactions`, { kind: 'board_state', elementId: 'b', payload: { x: 'y'.repeat(257 * 1024) } })).status, 413, 'estado de quadro > 256 KB (o teto subiu de 64 KB para 256 KB no contrato: BE-ED-14)');
    let deepP = 1; for (let i = 0; i < 26; i++) deepP = { a: deepP };
    assert.equal((await cB.post(`/api/presentations/${p.id}/interactions`, { kind: 'board_state', elementId: 'b', payload: deepP })).status, 400, 'profundidade > 20');
    assert.equal((await t.ops.asSystem((tx) => tx`select count(*)::int n from app.comments where presentation_id = ${p.id} and deleted_at is null`))[0].n, 1000);
  });
  test('limites de taxa reais: comentários 30/min por usuário → 429 com Retry-After; escrita 120/min; auditoria security.rate_limited', async () => {
    await t.awayFromWindowEdge(60, 20000);    // janela fixa de 1 min: a rajada não pode cruzar a virada (já derrubou o CI uma vez)
    await resetRates(); const u = await t.createUser(); const c = await t.as(u); const p = (await c.post('/api/presentations', { title: 'Rate' })).json;
    let status = []; for (let i = 0; i < 31; i++) status.push((await c.post(`/api/presentations/${p.id}/comments`, { body: 'spam ' + i })).status);
    assert.equal(status.filter((s) => s === 201).length, 30); assert.equal(status[30], 429);
    const r = await c.post(`/api/presentations/${p.id}/comments`, { body: 'mais um' }); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) >= 1);
    assert.equal((await cB.post(`/api/presentations/${p.id}/comments`, { body: 'outro usuário' })).status, 201, 'o limite é por usuário');
    status = []; for (let i = 0; i < 122; i++) status.push((await c.patch(`/api/presentations/${p.id}`, { title: 'R' + i })).status);   // 1 criação já contou
    assert.ok(status.includes(429), 'escrita 120/min: ' + status.filter((s) => s === 429).length + ' bloqueios'); assert.equal(status.filter((s) => s === 200).length, 119, JSON.stringify(status.slice(115)));
    const au = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.audit_log where action = 'security.rate_limited'`); assert.ok(au[0].n >= 2);
  });
});

/* ═══════════════════════════════════════════════════════════ 8. segredos e logs ═════════════════════════════════════════════════ */
describe('segredos em logs, auditoria e cliente', () => {
  test('nenhum log emitido durante toda a suíte contém senha, token de sessão, refresh token, token_hash, chave de serviço, cookie ou query string', () => {
    const text = JSON.stringify(LOG); assert.ok(LOG.length > 300, 'logs capturados: ' + LOG.length);
    for (const s of SECRETS) if (s && s.length > 8) assert.ok(!text.includes(s), 'segredo no log: ' + s.slice(0, 6) + '…');
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.eyJ/, 'JWT no log'); assert.doesNotMatch(text, /"cookie"|set-cookie|am_at=|am_rt=/i);
    assert.doesNotMatch(text, /Senha-|Errada-Qualquer|token_hash=|\?q=|cursor=/i, 'corpo/query string no log');
    const http = LOG.filter((l) => l.m === 'http'); assert.ok(http.length > 200); for (const l of http) { assert.ok(!String(l.f.route).includes('?'), 'rota com query: ' + l.f.route); assert.deepEqual(Object.keys(l.f).sort(), ['ip', 'method', 'ms', 'requestId', 'route', 'status', 'userId']); }
  });
  test('auditoria: sem senha/token/e-mail em claro de login/forgot; meta só com ids/contagens; append-only inclusive para o app_system sem a flag', async () => {
    const rows = await t.ops.asSystem((tx) => tx`select * from app.audit_log`); const text = JSON.stringify(rows); assert.ok(rows.length > 100);
    for (const s of SECRETS) if (s && s.length > 8) assert.ok(!text.includes(s));
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.eyJ/); assert.ok(!rows.some((r) => /^(auth\.|invite\.)/.test(r.action) && JSON.stringify(r.meta).includes('@')), 'e-mail em claro em auth.*/invite.*');
    assert.ok(!text.includes('alert(1)'), 'conteúdo recusado não é copiado');
    await assert.rejects(() => t.ops.asSystem((tx) => tx`delete from app.audit_log where id = ${rows[0].id}`), /acréscimo|42501/);
    await assert.rejects(() => t.ops.asSystem((tx) => tx`update app.audit_log set action = 'x' where id = ${rows[0].id}`));
    await assert.rejects(() => t.db.asUser(ADM.id, (tx) => tx`delete from app.audit_log where id = ${rows[0].id}`));
  });
  test('o build do site (dist/public) não contém a chave de serviço, variáveis de servidor, nem referência a service_role; o cliente nunca guarda token', () => {
    const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(html|js|mjs|css|json|svg|txt)$/.test(p)) files.push(p); } })(path.join(PLATFORM, 'dist', 'public'));
    assert.ok(files.length > 10);
    for (const f of files) { const s = fs.readFileSync(f, 'utf8'); for (const bad of ['service_role', 'SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role-key', 'DATABASE_URL', 'CSRF_SECRET', 'S3_SECRET_ACCESS_KEY', 'postgres://']) assert.ok(!s.includes(bad), `${path.relative(PLATFORM, f)} contém ${bad}`); }
    for (const f of ['web/js/api.js', 'web/js/session.js', 'studio-cloud/ed-50-cloud.js']) { const s = fs.readFileSync(path.join(PLATFORM, f), 'utf8'); assert.ok(!/localStorage\.setItem\([^)]*(token|jwt|at|rt)\b/i.test(s), f); assert.ok(!/Authorization['"]?\s*[:=]\s*['"`]Bearer/.test(s), f + ' não manda Bearer'); }
    assert.match(fs.readFileSync(path.join(PLATFORM, 'web/js/api.js'), 'utf8'), /credentials: 'same-origin'/);
  });
  test('config: produção recusa DATABASE_ADMIN_URL/OPS_URL, GOTRUE_FAKE, http, segredo curto, storage local, SSL desligado; staging idem; local aceita', () => {
    const PROD = { APP_ENV: 'production', APP_ORIGIN: 'https://canteiro.exemplo.com.br', DATABASE_URL: 'postgres://app_api:x@db:6543/postgres', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon-key-0123456789', SUPABASE_SERVICE_ROLE_KEY: 'service-key-0123456789', SUPABASE_JWKS_URL: 'https://abc.supabase.co/auth/v1/.well-known/jwks.json', CSRF_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    assert.doesNotThrow(() => loadConfig(PROD));
    for (const [patch, re] of [[{ DATABASE_ADMIN_URL: 'postgres://postgres:x@h/db' }, /DATABASE_ADMIN_URL/], [{ DATABASE_OPS_URL: 'postgres://x' }, /DATABASE_OPS_URL|ADMIN_URL/], [{ GOTRUE_FAKE: '1' }, /GOTRUE_FAKE/], [{ APP_ORIGIN: 'http://x.com' }, /https/], [{ CSRF_SECRET: 'curto' }, /CSRF|inválida/], [{ STORAGE_DRIVER: 'local' }, /STORAGE_DRIVER/], [{ DATABASE_SSL: 'disable' }, /DATABASE_SSL/], [{ SUPABASE_JWKS_URL: undefined, SUPABASE_JWT_SECRET: undefined }, /JWKS|JWT_SECRET/]]) {
      assert.throws(() => loadConfig({ ...PROD, ...patch }), re, JSON.stringify(patch));
    }
    // NOTA: a antiga flag ALLOW_SERVICE_KEY_IN_API foi removida (era documentada mas nunca lida); a chave de serviço é OBRIGATÓRIA no processo da API em staging/produção e nunca vai ao navegador (teste do build). Variável desconhecida no ambiente não derruba a partida:
    // (texto original da nota: a doc fala em ALLOW_SERVICE_KEY_IN_API para a chave de serviço; o código EXIGE a chave e não lê a flag (drift de documentação, não de segurança).
    assert.doesNotThrow(() => loadConfig({ ...PROD, ALLOW_SERVICE_KEY_IN_API: '0' }));
  });
});

/* ═══════════════════════════════════════════════════════════ 9. cadeia de suprimento ════════════════════════════════════════════ */
describe('cadeia de suprimento', () => {
  test('pdf.js do build é byte-idêntico ao vendor de studio/ (pdf.classic.js é derivado do pdf.min.mjs com transformação verificável)', async () => {
    const src = path.join(REPO, 'studio', 'vendor', 'pdfjs-4.10.38'), out = path.join(PLATFORM, 'dist', 'public', 'vendor', 'pdfjs-4.10.38');
    const files = fs.readdirSync(src); assert.ok(files.includes('pdf.min.mjs') && files.includes('pdf.worker.min.mjs'));
    for (const f of files) assert.equal(sha256(fs.readFileSync(path.join(out, f))), sha256(fs.readFileSync(path.join(src, f))), f);
    const classic = fs.readFileSync(path.join(out, 'pdf.classic.js'), 'utf8'), orig = fs.readFileSync(path.join(src, 'pdf.min.mjs'), 'utf8');
    assert.ok(classic.includes('globalThis.__am_pdfjs='));
    const { pdfjsClassic } = await import('../../tools/build-web.js');
    assert.equal(classic, pdfjsClassic(orig), 'pdf.classic.js publicado = transformação determinística do pdf.min.mjs do vendor');
    assert.deepEqual(fs.readdirSync(out).sort(), [...files, 'pdf.classic.js'].sort(), 'nenhum arquivo extra no vendor publicado');
  });
  test('build reprodutível: duas montagens do editor em nuvem dão o mesmo sha256 e a mesma CSP; a CSP publicada (dist/csp.json, vercel.json) confere com o editor publicado', async () => {
    const { buildWeb } = await import('../../tools/build-web.js'); const { inlineScriptHashes } = await import('../../tools/csp.js');
    const a = buildWeb({ write: false }), b = buildWeb({ write: false });
    assert.equal(a.editorSha256, b.editorSha256); assert.equal(a.cspText, b.cspText); assert.equal(a.vercelText, b.vercelText);
    const published = fs.readFileSync(path.join(PLATFORM, 'dist', 'public', 'editor', 'index.html'), 'utf8');
    assert.equal(sha256(published), a.editorSha256, 'dist/public/editor/index.html é o que o build produz agora');
    assert.equal(fs.readFileSync(path.join(PLATFORM, 'dist', 'public', 'visualizar', 'index.html'), 'utf8'), published);
    const csp = JSON.parse(fs.readFileSync(path.join(PLATFORM, 'dist', 'csp.json'), 'utf8')); assert.equal(JSON.stringify(csp, null, 2) + '\n', a.cspText);
    for (const h of inlineScriptHashes(published)) assert.ok(csp['/editor/'].includes(`'${h}'`), h);
    assert.equal(fs.readFileSync(path.join(PLATFORM, 'vercel.json'), 'utf8'), a.vercelText, 'vercel.json versionado está atualizado');
    LOG.push({ level: 'metric', m: 'editor_sha256', f: { sha: a.editorSha256, hashes: a.inlineScriptHashes } });
  });
  test('dependências: lockfile íntegro, ferramentas de desenvolvimento isoladas e imagem de produção sem pacotes dev', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(PLATFORM, 'package-lock.json'), 'utf8')); const pkgs = Object.entries(lock.packages).filter(([k]) => k);
    assert.ok(pkgs.length > 20); for (const [k, v] of pkgs) if (!v.link) assert.ok(v.integrity || v.resolved === undefined, k + ' sem integrity');
    const pkg = JSON.parse(fs.readFileSync(path.join(PLATFORM, 'package.json'), 'utf8'));
    const caret = Object.entries(pkg.dependencies).filter(([, v]) => /^[\^~]/.test(v)); LOG.push({ level: 'metric', m: 'deps_caret', f: { n: caret.length, names: caret.map(([k]) => k) } });
    // Playwright é necessário para os testes, mas não deve entrar na imagem de produção.
    assert.deepEqual(lock.packages[''].devDependencies || {}, pkg.devDependencies || {}, 'lockfile deve refletir as ferramentas de desenvolvimento');
    for (const name of Object.keys(pkg.devDependencies || {})) {
      assert.ok(!(name in (pkg.dependencies || {})), name + ': não pode estar nas dependências de produção');
      assert.equal(lock.packages['node_modules/' + name]?.dev, true, name + ': deve ser marcado como dev no lockfile');
    }
    const dockerfile = fs.readFileSync(path.join(PLATFORM, 'Dockerfile'), 'utf8');
    assert.equal((dockerfile.match(/RUN npm ci --omit=dev\b/g) || []).length, 2,
      'as etapas web e deps da imagem devem instalar apenas dependências de produção');
  });
  test('métricas coletadas nesta execução (impressas para o relatório)', () => {
    const m = LOG.filter((l) => l.level === 'metric' || l.level === 'note'); console.log('\nMÉTRICAS: ' + JSON.stringify(m.map((x) => ({ [x.m]: x.f }))));
    assert.ok(m.length >= 3);
  });
});
