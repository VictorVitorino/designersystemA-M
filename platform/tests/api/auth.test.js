/* Fluxos de autenticação ponta a ponta: convite → e-mail (caixa de saída do GoTrue falso) → link → senha → ativo → login; falhas; recuperação; refresh; logout. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';

let t, admin, adminC;
const PW = 'Uma-senha-bem-longa-2026!';
before(async () => { t = await boot(); admin = await t.createUser({ role: 'admin', displayName: 'Admin' }); adminC = await t.as(admin); });
after(async () => { await t.stop(); });

const invite = async (email, displayName = 'Convidada', role = 'member') => {
  const r = await adminC.post('/api/admin/invites', { email, displayName, role }); assert.equal(r.status, 201, r.text); return r.json;
};
const lastMail = (email, type) => t.fake.outbox(email).filter((m) => m.type === type).at(-1);
const noTokens = (res, c) => {
  const secrets = [t.names.at, t.names.rt].map((n) => c.cookie(n)).filter(Boolean);   // (o token CSRF vai no corpo de propósito)
  for (const s of secrets) assert.ok(!res.text.includes(s), 'valor de cookie vazou no corpo');
  assert.ok(!/access_token|refresh_token|"token"/i.test(res.text), 'corpo menciona token');
};

describe('convite → ativação → login', () => {
  test('fluxo completo', async () => {
    const email = 'maria.convidada@am.test';
    const inv = await invite(email, 'Maria Convidada');
    assert.equal(inv.status, 'pending');
    const mail = lastMail(email, 'invite');
    assert.ok(mail, 'e-mail de convite na caixa de saída'); assert.match(mail.link, /\/auth\/confirmar\?token_hash=[0-9a-f]+&type=invite$/); assert.equal(mail.displayName, 'Maria Convidada');

    const c = t.anon();
    const s0 = await c.get('/api/auth/session'); assert.deepEqual([s0.status, s0.json.authenticated], [200, false]); assert.match(s0.json.csrfToken, /^[A-Za-z0-9_-]{43}$/);

    const v = await c.post('/api/auth/verify', { tokenHash: mail.token_hash, type: 'invite' });
    assert.equal(v.status, 200, v.text);
    assert.deepEqual([v.json.authenticated, v.json.needsPassword, v.json.user.status, v.json.user.role, v.json.user.displayName], [true, true, 'invited', 'member', 'Maria Convidada']);
    noTokens(v, c);
    // enquanto não define a senha: só session/password/logout
    assert.equal((await c.get('/api/me')).status, 403);
    assert.equal((await c.get('/api/admin/users')).status, 403);
    const s1 = await c.get('/api/auth/session'); assert.equal(s1.json.needsPassword, true); assert.equal(s1.json.user.status, 'invited');

    const p = await c.post('/api/auth/password', { password: PW });
    assert.equal(p.status, 200, p.text); assert.deepEqual([p.json.user.status, p.json.needsPassword], ['active', false]);
    assert.equal((await c.get('/api/me')).status, 200);

    const login = await t.anon().login(email, PW);
    assert.equal(login.status, 200, login.text); assert.equal(login.json.user.email, email); assert.equal(login.json.user.status, 'active');
    const [row] = await t.ops.asSystem((tx) => tx`select status, activated_at, last_login_at from app.users where email = ${email}`);
    assert.equal(row.status, 'active'); assert.ok(row.activated_at && row.last_login_at);
    const [invRow] = await t.ops.asSystem((tx) => tx`select status, accepted_at from app.invites where email = ${email}`);
    assert.equal(invRow.status, 'accepted'); assert.ok(invRow.accepted_at);
  });

  test('o link do convite só vale uma vez e o tipo tem que bater', async () => {
    const email = 'link.unico@am.test'; await invite(email);
    const m = lastMail(email, 'invite');
    const wrongType = await t.anon().post('/api/auth/verify', { tokenHash: m.token_hash, type: 'recovery' }, { csrf: false });
    assert.equal(wrongType.status, 403);   // sem CSRF → barrado antes; abaixo repete com CSRF
    const c = t.anon(); await c.ensureCsrf();
    assert.equal((await c.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'recovery' })).status, 410);
    assert.equal((await c.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'invite' })).status, 200);
    const again = await t.anon(); await again.ensureCsrf();
    const r = await again.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'invite' });
    assert.equal(r.status, 410); assert.equal(r.json.error.code, 'link_invalid');
  });

  test('link expirado → 410 link_invalid', async () => {
    const email = 'link.expirado@am.test'; await invite(email); const m = lastMail(email, 'invite');
    t.fake.state.otpTtlMs = -1000;   // (só afeta e-mails gerados DEPOIS) → gera outro e-mail já vencido
    try {
      await adminC.post(`/api/admin/invites/${(await t.ops.asSystem((tx) => tx`select id from app.invites where email = ${email}`))[0].id}/resend`);
    } finally { delete t.fake.state.otpTtlMs; }
    const expired = lastMail(email, 'invite'); assert.notEqual(expired.token_hash, m.token_hash);
    const c = t.anon(); await c.ensureCsrf();
    assert.equal((await c.post('/api/auth/verify', { tokenHash: expired.token_hash, type: 'invite' })).status, 410);
  });

  test('entradas inválidas no verify: 400 (sem eco do valor) ou 410, nunca 500', async () => {
    const c = t.anon(); await c.ensureCsrf();
    for (const body of [{}, { tokenHash: 'x', type: 'invite' }, { tokenHash: "' or 1=1 --", type: 'invite' }, { tokenHash: 'a'.repeat(500), type: 'invite' }, { tokenHash: 'abcdefghijkl', type: 'magiclink' }, { tokenHash: 'abcdefghijkl', type: 'invite', extra: 1 }, { tokenHash: ['abcdefghijkl'], type: 'invite' }]) {
      const r = await c.post('/api/auth/verify', body); assert.equal(r.status, 400, JSON.stringify(body) + r.text);
      assert.ok(!r.text.includes("or 1=1"));
    }
    assert.equal((await c.post('/api/auth/verify', { tokenHash: 'abcdefghijklmnop', type: 'invite' })).status, 410);
    const bad = await c.request('POST', '/api/auth/verify', { body: '{nao-e-json', headers: { 'content-type': 'application/json' } }); assert.equal(bad.status, 400);
  });

  test('definir senha: política (fraca, comum, com o e-mail, curta) e exige sessão', async () => {
    const email = 'politica.senha@am.test'; await invite(email); const m = lastMail(email, 'invite');
    const anon = t.anon(); await anon.ensureCsrf();
    assert.equal((await anon.post('/api/auth/password', { password: PW })).status, 401);
    const c = t.anon(); await c.ensureCsrf(); await c.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'invite' });
    for (const password of ['curta1!', 'senha123456', '123456789012', 'politica.senha@am.test', 'xx-politica.senha-xx-Zk9', 'a'.repeat(100)]) {
      const r = await c.post('/api/auth/password', { password }); assert.equal(r.status, 400, password); assert.equal(r.json.error.code, 'invalid_request'); assert.equal(r.json.error.details.fields[0].path, 'password');
      assert.ok(!r.text.includes(password), 'eco da senha');
    }
    assert.equal((await c.get('/api/auth/session')).json.user.status, 'invited');   // continua convidado
    assert.equal((await c.post('/api/auth/password', { password: PW })).status, 200);
  });

  test('o GoTrue recusar a senha (fraca/vazada) vira 400 amigável', async () => {
    const email = 'senha.vazada@am.test'; await invite(email); const m = lastMail(email, 'invite');
    const c = t.anon(); await c.ensureCsrf(); await c.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'invite' });
    t.fake.state.rejectPasswords = ['Vazou-na-internet-2026!'];
    try { const r = await c.post('/api/auth/password', { password: 'Vazou-na-internet-2026!' }); assert.equal(r.status, 400); assert.match(r.json.error.message, /fraca|vazado/i); }
    finally { delete t.fake.state.rejectPasswords; }
  });

  test('quem NÃO foi convidado nunca ganha sessão (conta existe só no GoTrue)', async () => {
    const email = 'penetra@am.test';
    const res = await fetch(`${t.fake.url}/auth/v1/invite`, { method: 'POST', headers: { apikey: t.fake.serviceKey, Authorization: `Bearer ${t.fake.serviceKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    assert.equal(res.status, 200);
    const m = lastMail(email, 'invite');
    const c = t.anon(); await c.ensureCsrf();
    const r = await c.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'invite' });
    assert.equal(r.status, 403); assert.equal(r.json.error.code, 'not_invited'); assert.equal(r.setCookies.filter((x) => x.name === t.names.at || x.name === t.names.rt).length, 0);
    assert.equal(t.fake.calls.filter((x) => x.path === '/auth/v1/logout').length > 0, true, 'sessão órfã revogada no GoTrue');
    const [n] = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.users where email = ${email}`); assert.equal(n.n, 0);
    // e login com a mesma conta (agora com senha) também é barrado
    const g = t.fake.userByEmail(email); g.pwHash = null; t.fake.addUser({ email: 'penetra2@am.test', password: PW });
    const l = await t.anon().login('penetra2@am.test', PW); assert.equal(l.status, 403); assert.equal(l.json.error.code, 'not_invited'); assert.equal(l.setCookies.length === 0 || l.setCookies.every((x) => x.name === t.names.csrf), true);
  });
});

describe('login', () => {
  let ana;
  before(async () => { ana = await t.createUser({ displayName: 'Ana' }); });

  test('sucesso: corpo sem token, cookies HttpOnly, CSRF novo', async () => {
    const c = t.anon(); const s = await c.get('/api/auth/session'); const before = s.json.csrfToken;
    const r = await c.login(ana.email, ana.password);
    assert.equal(r.status, 200); assert.equal(r.json.user.id, ana.id); assert.equal(r.json.needsPassword, false);
    assert.notEqual(r.json.csrfToken, before, 'CSRF rotacionado no login'); assert.equal(c.cookie(t.names.csrf), r.json.csrfToken);
    noTokens(r, c);
    const at = r.setCookies.find((x) => x.name === t.names.at), rt = r.setCookies.find((x) => x.name === t.names.rt);
    assert.ok(at.attrs.httponly && rt.attrs.httponly);
    assert.equal((await c.get('/api/me')).json.email, ana.email);
  });
  test('e-mail é normalizado (maiúsculas e espaços)', async () => {
    const r = await t.anon().login(`  ${ana.email.toUpperCase()}  `, ana.password); assert.equal(r.status, 200);
  });
  test('senha errada × e-mail inexistente: resposta IDÊNTICA (código, mensagem, forma)', async () => {
    const a = await t.anon().login(ana.email, 'senha-errada-qualquer-1'); const b = await t.anon().login('nao.existe@am.test', 'senha-errada-qualquer-1');
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    const strip = (r) => { const e = JSON.parse(r.text).error; delete e.requestId; return e; };
    assert.deepEqual(strip(a), strip(b)); assert.equal(a.json.error.code, 'invalid_credentials');
    assert.equal(a.setCookies.filter((x) => x.name !== t.names.csrf).length, 0);
    assert.equal(a.headers.get('content-length'), b.headers.get('content-length'));
  });
  test('tempo equalizado: e-mail existente (lento no GoTrue) × inexistente diferem pouco', async () => {
    const oldFloor = t.kit.timing.failMinMs; t.kit.timing.failMinMs = 300; t.fake.state.latency.existingUserMs = 90;
    try {
      const time = async (email) => { const c = t.anon(); await c.ensureCsrf(); const t0 = Date.now(); const r = await c.request('POST', '/api/auth/login', { json: { email, password: 'errada-errada-12' } }); assert.equal(r.status, 401); return Date.now() - t0; };
      const ex = await time(ana.email), nx = await time('fantasma@am.test');
      assert.ok(ex >= 295 && nx >= 295, `ambos ≥ piso (existente ${ex} ms, inexistente ${nx} ms)`); assert.ok(Math.abs(ex - nx) < 70, `diferença ${Math.abs(ex - nx)} ms`);
    } finally { t.kit.timing.failMinMs = oldFloor; t.fake.state.latency.existingUserMs = 0; }
  });
  test('suspenso: 403 suspended e nenhum cookie de sessão', async () => {
    const u = await t.createUser(); assert.equal((await t.anon().login(u.email, u.password)).status, 200);   // 1º login vincula a identidade
    await t.ops.asSystem((tx) => tx`update app.users set status = 'suspended' where id = ${u.id}`);
    const r = await t.anon().login(u.email, u.password);
    assert.equal(r.status, 403); assert.equal(r.json.error.code, 'suspended'); assert.equal(r.setCookies.filter((x) => x.name === t.names.at || x.name === t.names.rt).length, 0);
    assert.ok(t.fake.calls.filter((x) => x.path === '/auth/v1/logout').length > 0, 'sessão recém-criada foi revogada no GoTrue');
  });
  test('suspenso que nunca entrou (sem identidade) também não passa: not_invited', async () => {
    const u = await t.createUser({ status: 'suspended' });
    const r = await t.anon().login(u.email, u.password); assert.equal(r.status, 403); assert.equal(r.json.error.code, 'not_invited');
  });
  test('bloqueado no GoTrue (ban) com a senha certa → 403 suspended', async () => {
    const u = await t.createUser(); t.fake.userByEmail(u.email).banned = true;
    const r = await t.anon().login(u.email, u.password); assert.deepEqual([r.status, r.json.error.code], [403, 'suspended']);
  });
  test('entradas inválidas: 400 e sem 500 (campos extras, tipos errados, JSON inválido, corpo enorme)', async () => {
    const c = t.anon(); await c.ensureCsrf();
    for (const body of [{}, { email: ana.email }, { password: 'x' }, { email: 'nao-e-email', password: 'x' }, { email: ana.email, password: '' }, { email: ana.email, password: 'x', admin: true },
      { email: { $ne: null }, password: 'x' }, { email: ana.email, password: ['a'] }, { email: ana.email, password: 'x'.repeat(2000) }, { email: "a'@b.co; drop table app.users;--", password: 'x' }]) {
      const r = await c.post('/api/auth/login', body); assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80) + ' → ' + r.text.slice(0, 120));
    }
    assert.equal((await c.request('POST', '/api/auth/login', { body: 'x'.repeat(50_000), headers: { 'content-type': 'application/json' } })).status, 413);
    assert.equal((await c.request('POST', '/api/auth/login', { body: '[]', headers: { 'content-type': 'application/json' } })).status, 400);
  });
  test('auditoria do login: sucesso ligado ao usuário; falha sem e-mail em claro', async () => {
    const c = t.anon(); await c.login(ana.email, ana.password);
    await t.anon().login('quem.quer.que.seja@am.test', 'chute-de-senha-123');
    const rows = await t.ops.asSystem((tx) => tx`select action, actor_id, meta from app.audit_log where action in ('auth.login','auth.login_failed') order by id desc limit 50`);
    assert.ok(rows.some((r) => r.action === 'auth.login' && r.actor_id === ana.id));
    const failed = rows.find((r) => r.action === 'auth.login_failed' && r.meta.email_hash === t.kit.hashEmail('quem.quer.que.seja@am.test'));
    assert.ok(failed, 'falha registrada com HMAC do e-mail'); assert.equal(failed.actor_id, null);
    assert.ok(!JSON.stringify(rows).includes('quem.quer.que.seja'));
  });
});

describe('esqueci a senha e recuperação', () => {
  let u;
  before(async () => { u = await t.createUser({ displayName: 'Rita' }); });

  test('sempre 202 e mesmo corpo: e-mail existente, inexistente e suspenso', async () => {
    const susp = await t.createUser({ status: 'suspended' });
    const out = [];
    for (const email of [u.email, 'ninguem@am.test', susp.email]) { const c = t.anon(); await c.ensureCsrf(); const r = await c.post('/api/auth/forgot', { email }); out.push(r); }
    for (const r of out) { assert.equal(r.status, 202); assert.deepEqual(r.json, { ok: true }); }
    assert.ok(lastMail(u.email, 'recovery')); assert.equal(lastMail('ninguem@am.test', 'recovery'), undefined);
  });
  test('e-mail malformado → 400 (não é oráculo de existência); falha do provedor continua 202', async () => {
    const c = t.anon(); await c.ensureCsrf();
    assert.equal((await c.post('/api/auth/forgot', { email: 'sem-arroba' })).status, 400);
    t.fake.state.fail.recover = 500;
    try { const r = await c.post('/api/auth/forgot', { email: u.email }); assert.equal(r.status, 202); assert.deepEqual(r.json, { ok: true }); } finally { t.fake.state.fail.recover = 0; }
  });
  test('tempo de resposta do forgot é equalizado (piso configurável)', async () => {
    const old = t.kit.timing.forgotMinMs; t.kit.timing.forgotMinMs = 250;
    try {
      const time = async (email) => { const c = t.anon(); await c.ensureCsrf(); const t0 = Date.now(); const r = await c.post('/api/auth/forgot', { email }); assert.equal(r.status, 202); return Date.now() - t0; };
      const a = await time(u.email), b = await time('outro.fantasma@am.test');
      assert.ok(a >= 245 && b >= 245 && Math.abs(a - b) < 70, `${a} × ${b}`);
    } finally { t.kit.timing.forgotMinMs = old; }
  });
  test('recuperação: link → needsPassword → nova senha → login novo funciona, o antigo não', async () => {
    const c = t.anon(); await c.ensureCsrf(); await c.post('/api/auth/forgot', { email: u.email });
    const m = lastMail(u.email, 'recovery');
    const v = await c.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'recovery' });
    assert.equal(v.status, 200, v.text); assert.equal(v.json.needsPassword, true); assert.equal(v.json.user.status, 'active'); noTokens(v, c);
    assert.equal((await c.get('/api/auth/session')).json.needsPassword, true, 'continua pedindo senha após recarregar');
    const NEW = 'Nova-Senha-Depois-Da-Recuperacao-7!';
    const p = await c.post('/api/auth/password', { password: NEW }); assert.equal(p.status, 200, p.text); assert.equal(p.json.needsPassword, false);
    assert.equal((await t.anon().login(u.email, NEW)).status, 200);
    assert.equal((await t.anon().login(u.email, u.password)).status, 401);
    // o link não pode ser reusado
    const c2 = t.anon(); await c2.ensureCsrf(); assert.equal((await c2.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'recovery' })).status, 410);
  });
  test('sessão ativa NÃO troca a senha sem o link de recuperação (uma sessão roubada não toma a conta): 403 e a senha antiga continua valendo', async () => {
    const x = await t.createUser(); const c = t.anon(); assert.equal((await c.login(x.email, x.password)).status, 200);
    const r = await c.post('/api/auth/password', { password: 'Tentativa-Sem-Reautenticacao-99!' }); assert.equal(r.status, 403, r.text); assert.match(r.json.error.message, /Esqueci a senha/);
    assert.equal((await t.anon().login(x.email, x.password)).status, 200, 'a senha antiga continua valendo');
    assert.equal((await t.anon().login(x.email, 'Tentativa-Sem-Reautenticacao-99!')).status, 401);
  });
  test('trocar a senha (pelo link de recuperação) encerra as OUTRAS sessões', async () => {
    const x = await t.createUser(); const c1 = t.anon(), c2 = t.anon();
    assert.equal((await c1.login(x.email, x.password)).status, 200); assert.equal((await c2.login(x.email, x.password)).status, 200);
    await c1.post('/api/auth/forgot', { email: x.email }); const m = lastMail(x.email, 'recovery');
    assert.equal((await c1.post('/api/auth/verify', { tokenHash: m.token_hash, type: 'recovery' })).status, 200);
    assert.equal((await c1.post('/api/auth/password', { password: 'Outra-Senha-Forte-Ainda-55!' })).status, 200);
    const r = await c2.post('/api/auth/refresh'); assert.equal(r.status, 401); assert.equal(r.json.error.code, 'session_expired');
    assert.equal((await c1.post('/api/auth/refresh')).status, 200, 'a sessão que trocou a senha continua');
  });
});

describe('refresh, expiração e logout', () => {
  let u;
  before(async () => { u = await t.createUser(); });
  const expiredToken = (user) => t.fake.mintToken({ sub: t.fake.userByEmail(user.email).id, email: user.email, session_id: 'x' }, { ttl: -120 });

  test('refresh: cookies novos, refresh antigo não serve mais', async () => {
    const c = t.anon(); await c.login(u.email, u.password);
    const oldRt = c.cookie(t.names.rt), oldAt = c.cookie(t.names.at);
    const r = await c.post('/api/auth/refresh'); assert.equal(r.status, 200, r.text); noTokens(r, c);
    assert.notEqual(c.cookie(t.names.rt), oldRt); assert.notEqual(c.cookie(t.names.at), oldAt);
    const thief = t.anon(); await thief.ensureCsrf(); thief.jar.set(t.names.rt, oldRt);
    const bad = await thief.post('/api/auth/refresh'); assert.equal(bad.status, 401); assert.equal(bad.json.error.code, 'session_expired');
    assert.ok(bad.setCookies.some((x) => x.name === t.names.rt && x.attrs['max-age'] === '0'), 'cookies apagados');
  });
  test('sem cookie de refresh → 401 session_expired', async () => {
    const c = t.anon(); await c.ensureCsrf(); const r = await c.post('/api/auth/refresh'); assert.deepEqual([r.status, r.json.error.code], [401, 'session_expired']);
  });
  test('access token expirado → 401 session_expired; refresh recupera e a rota volta a funcionar', async () => {
    const c = t.anon(); await c.login(u.email, u.password);
    c.jar.set(t.names.at, await expiredToken(u));
    const r = await c.get('/api/me'); assert.deepEqual([r.status, r.json.error.code], [401, 'session_expired']);
    assert.equal((await c.post('/api/auth/refresh')).status, 200);
    assert.equal((await c.get('/api/me')).status, 200);
  });
  test('GET /session renova sozinho quando o access expirou ou sumiu (abrir o app depois de 1 h)', async () => {
    const c = t.anon(); await c.login(u.email, u.password);
    c.jar.delete(t.names.at);
    const s = await c.get('/api/auth/session'); assert.equal(s.json.authenticated, true); assert.equal(s.json.user.email, u.email); assert.ok(c.cookie(t.names.at));
    c.jar.set(t.names.at, await expiredToken(u));
    assert.equal((await c.get('/api/auth/session')).json.authenticated, true);
  });
  test('várias renovações simultâneas com o mesmo refresh viram UMA chamada ao GoTrue', async () => {
    const c = t.anon(); await c.login(u.email, u.password); c.jar.delete(t.names.at);
    const n0 = t.fake.calls.filter((x) => x.path === '/auth/v1/token' && x.query.includes('refresh_token')).length;
    const clones = Array.from({ length: 5 }, () => { const k = t.anon(); k.jar.set(t.names.rt, c.cookie(t.names.rt)); k.jar.set(t.names.csrf, c.cookie(t.names.csrf)); return k; });
    const rs = await Promise.all(clones.map((k) => k.get('/api/auth/session')));
    assert.ok(rs.every((r) => r.json.authenticated === true));
    assert.equal(t.fake.calls.filter((x) => x.path === '/auth/v1/token' && x.query.includes('refresh_token')).length - n0, 1);
  });
  test('logout: 204, cookies apagados, sessão revogada no GoTrue, auditado', async () => {
    const c = t.anon(); await c.login(u.email, u.password); const rt = c.cookie(t.names.rt);
    const r = await c.post('/api/auth/logout'); assert.equal(r.status, 204); assert.equal(r.text, '');
    for (const n of [t.names.at, t.names.rt]) assert.ok(r.setCookies.some((x) => x.name === n && x.attrs['max-age'] === '0'));
    assert.equal(c.cookie(t.names.at), null);
    assert.equal((await c.get('/api/auth/session')).json.authenticated, false);
    const old = t.anon(); await old.ensureCsrf(); old.jar.set(t.names.rt, rt); assert.equal((await old.post('/api/auth/refresh')).status, 401);
    const [a] = await t.ops.asSystem((tx) => tx`select count(*)::int n from app.audit_log where action = 'auth.logout' and actor_id = ${u.id}`); assert.ok(a.n >= 1);
  });
  test('logout sem sessão não falha (idempotente) e exige CSRF', async () => {
    const c = t.anon(); await c.ensureCsrf(); assert.equal((await c.post('/api/auth/logout')).status, 204);
    assert.equal((await c.post('/api/auth/logout', undefined, { csrf: false })).status, 403);
  });
  test('logout com access expirado ainda revoga (renova só para revogar)', async () => {
    const c = t.anon(); await c.login(u.email, u.password); const rt = c.cookie(t.names.rt);
    c.jar.set(t.names.at, await expiredToken(u));
    assert.equal((await c.post('/api/auth/logout')).status, 204);
    const old = t.anon(); await old.ensureCsrf(); old.jar.set(t.names.rt, rt); assert.equal((await old.post('/api/auth/refresh')).status, 401);
  });
  test('GoTrue fora do ar: refresh → 503 e os cookies NÃO são apagados', async () => {
    const c = t.anon(); await c.login(u.email, u.password); c.jar.delete(t.names.at);
    t.fake.state.fail.refresh = 500;
    try {
      const r = await c.post('/api/auth/refresh'); assert.equal(r.status, 503); assert.ok(c.cookie(t.names.rt), 'refresh preservado');
      const s = await c.get('/api/auth/session'); assert.equal(s.status, 503);
    } finally { t.fake.state.fail.refresh = 0; }
    assert.equal((await c.get('/api/auth/session')).json.authenticated, true);
  });
});

describe('perfil e SSO', () => {
  test('PATCH /api/me altera só o próprio nome; rejeita HTML e campos extras', async () => {
    const a = await t.createUser({ displayName: 'Antes' }), b = await t.createUser({ displayName: 'Intocada' }); const c = await t.as(a);
    const ok = await c.patch('/api/me', { displayName: '  Depois  ' }); assert.equal(ok.status, 200); assert.equal(ok.json.displayName, 'Depois');
    assert.equal((await c.get('/api/me')).json.displayName, 'Depois');
    for (const body of [{ displayName: '<script>alert(1)</script>' }, { displayName: '' }, { displayName: 'a'.repeat(121) }, { displayName: 'x\u0000y' }, { displayName: 'ok', role: 'admin' }, { role: 'admin' }, { id: b.id, displayName: 'x' }, {}]) {
      assert.equal((await c.patch('/api/me', body)).status, 400, JSON.stringify(body));
    }
    const [r] = await t.ops.asSystem((tx) => tx`select display_name, role from app.users where id = ${b.id}`); assert.equal(r.display_name, 'Intocada');
    const [me] = await t.ops.asSystem((tx) => tx`select role from app.users where id = ${a.id}`); assert.equal(me.role, 'member');
    const anon = t.anon(); await anon.ensureCsrf(); assert.equal((await anon.patch('/api/me', { displayName: 'x' })).status, 401);
  });
  test('SSO ainda não configurado: 501 not_configured', async () => {
    const c = t.anon();
    for (const p of ['/api/auth/sso/start', '/api/auth/sso/callback']) { const r = await c.get(p); assert.deepEqual([r.status, r.json.error.code], [501, 'not_configured']); }
  });
});
