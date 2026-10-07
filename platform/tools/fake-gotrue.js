#!/usr/bin/env node
/* tools/fake-gotrue.js — GoTrue (Supabase Auth) FALSO, só para teste e desenvolvimento local.
   Implementa o MESMO contrato HTTP que a API usa (docs/API.md §3): invite, verify, token (password/refresh_token), PUT user, recover, logout,
   admin (ban/delete/list), health e .well-known/jwks.json (ES256) — ou emite tokens HS256 (modo 'hs256').
   E-mails de convite/recuperação não são enviados: caem numa "caixa de saída" consultável em GET /__outbox (inclui o token_hash).
   RECUSA INICIAR com APP_ENV=production. Escuta apenas em 127.0.0.1.

   Uso em teste:  const fake = await startFakeGoTrue({ port: 0, mode: 'jwks' });  fake.url, fake.outbox(), fake.addUser(...), fake.close()
   Uso manual:    FAKE_GOTRUE_PORT=54321 node tools/fake-gotrue.js */
import http from 'node:http';
import crypto from 'node:crypto';
import { SignJWT, jwtVerify, generateKeyPair, exportJWK } from 'jose';

const json = (res, status, body, extra = {}) => { const s = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s), ...extra }); res.end(s); };
const err = (res, status, error_code, msg) => json(res, status, { code: status, error_code, msg });
const scrypt = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

/** keyFormat 'opaque' imita as chaves novas do Supabase (sb_publishable_…/sb_secret_…): a chave de serviço vale SÓ no cabeçalho apikey e
    é recusada se vier como Authorization: Bearer (não é JWT), como no Supabase real.
    @param {{port?:number, mode?:'jwks'|'hs256', keyFormat?:'legacy'|'opaque', appOrigin?:string, anonKey?:string, serviceKey?:string, jwtSecret?:string, accessTtl?:number, latency?:{existingUserMs?:number}}} [opts] */
export async function startFakeGoTrue(opts = {}) {
  if (process.env.APP_ENV === 'production') throw new Error('fake-gotrue é só para teste/desenvolvimento: recusado com APP_ENV=production');
  const mode = opts.mode || 'jwks';
  const opaque = opts.keyFormat === 'opaque';
  const anonKey = opts.anonKey || (opaque ? 'sb_publishable_fake' + crypto.randomBytes(12).toString('hex') : 'fake-anon-key-0000000000');
  const serviceKey = opts.serviceKey || (opaque ? 'sb_secret_fake' + crypto.randomBytes(12).toString('hex') : 'fake-service-role-key-000000');
  const jwtSecret = opts.jwtSecret || crypto.randomBytes(32).toString('hex');
  const appOrigin = opts.appOrigin || 'http://localhost:3000';
  // state.fail = { invite: 500, recover: 500, login: 500, refresh: 500, verify: 500, logout: 500, admin: 500 } → a operação responde com esse status (testes de falha do provedor)
  const state = { accessTtl: opts.accessTtl ?? 3600, latency: opts.latency || {}, fail: {} };
  const users = new Map();          // id → usuário
  const tokens = new Map();         // token_hash → { userId, type, expiresAt, used }
  const sessions = new Map();       // sid → { userId }
  const refresh = new Map();        // refresh_token → { sid, userId, used }
  const outbox = [];
  const calls = [];                 // registro (sem corpo) das chamadas, para asserções
  const kid = 'fake-' + crypto.randomBytes(4).toString('hex');
  let privateKey, publicJwk, publicKey;
  if (mode === 'jwks') { const kp = await generateKeyPair('ES256', { extractable: true }); privateKey = kp.privateKey; publicKey = kp.publicKey; publicJwk = { ...(await exportJWK(kp.publicKey)), kid, alg: 'ES256', use: 'sig' }; }
  const hsKey = new TextEncoder().encode(jwtSecret);
  let issuer = '';

  const publicUser = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.confirmedAt, invited_at: u.invitedAt, banned_until: u.banned ? '2125-01-01T00:00:00Z' : null, user_metadata: u.metadata, created_at: u.createdAt });

  async function mint(claims, { alg, ttl } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const useAlg = alg || (mode === 'jwks' ? 'ES256' : 'HS256');
    const jwt = new SignJWT({ role: 'authenticated', aal: 'aal1', ...claims }).setProtectedHeader(useAlg === 'ES256' ? { alg: 'ES256', kid, typ: 'JWT' } : { alg: useAlg, typ: 'JWT' })
      .setIssuedAt(now).setExpirationTime(now + (ttl ?? state.accessTtl));
    if (!('iss' in claims)) jwt.setIssuer(issuer);
    if (!('aud' in claims)) jwt.setAudience('authenticated');
    return jwt.sign(useAlg === 'ES256' ? privateKey : hsKey);
  }
  async function newSession(u) {
    const sid = crypto.randomUUID(); sessions.set(sid, { userId: u.id });
    const rt = crypto.randomBytes(16).toString('base64url'); refresh.set(rt, { sid, userId: u.id, used: false });
    const access = await mint({ sub: u.id, email: u.email, session_id: sid, app_metadata: { provider: 'email' }, user_metadata: { ...u.metadata, email_verified: true }, is_anonymous: false });
    return { access_token: access, token_type: 'bearer', expires_in: state.accessTtl, expires_at: Math.floor(Date.now() / 1000) + state.accessTtl, refresh_token: rt, user: publicUser(u) };
  }
  async function authUser(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) return null;
    try {
      const { payload } = await jwtVerify(m[1], mode === 'jwks' ? publicKey : hsKey, { issuer, audience: 'authenticated', algorithms: [mode === 'jwks' ? 'ES256' : 'HS256'] });
      const u = users.get(payload.sub); if (!u || !sessions.has(payload.session_id)) return null;
      return { u, sid: payload.session_id };
    } catch { return null; }
  }
  const readBody = (req) => new Promise((resolve) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString() || '{}')); } catch { resolve({}); } }); });
  const apikeyOk = (req) => [anonKey, serviceKey].includes(req.headers.apikey);
  // legado: service_role no apikey E como Bearer (padrão do GoTrue); chaves novas: sb_secret_ só no apikey (o gateway deriva o papel)
  const isService = (req) => req.headers.apikey === serviceKey && (opaque ? !req.headers.authorization : req.headers.authorization === `Bearer ${serviceKey}`);
  // o Supabase real recusa chave nova (não-JWT) no Authorization: imita isso para o teste pegar um cliente que ainda a mande como Bearer
  const opaqueInBearer = (req) => opaque && /^Bearer sb_(publishable|secret)_/.test(req.headers.authorization || '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byEmail = (email) => [...users.values()].find((u) => u.email === String(email || '').trim().toLowerCase());
  function mail(u, type) {
    const token_hash = crypto.randomBytes(24).toString('hex');
    tokens.set(token_hash, { userId: u.id, type, expiresAt: Date.now() + (state.otpTtlMs ?? 3600_000), used: false });
    outbox.push({ to: u.email, type, token_hash, link: `${appOrigin}/auth/confirmar?token_hash=${token_hash}&type=${type}`, displayName: u.metadata?.display_name || null, at: new Date().toISOString() });
    return token_hash;
  }
  function addUser({ email, password, confirmed = true, displayName = 'Usuário de teste', id } = {}) {
    const e = String(email).trim().toLowerCase(); const salt = crypto.randomBytes(8).toString('hex');
    const u = { id: id || crypto.randomUUID(), email: e, salt, pwHash: password ? scrypt(password, salt) : null, confirmedAt: confirmed ? new Date().toISOString() : null, invitedAt: null, banned: false, metadata: { display_name: displayName }, createdAt: new Date().toISOString() };
    users.set(u.id, u); return u;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'); const p = url.pathname; const method = req.method;
      calls.push({ method, path: p, query: url.search, at: Date.now() });
      if (p === '/__outbox') {
        if (method === 'DELETE') { outbox.length = 0; return json(res, 200, { ok: true }); }
        const to = url.searchParams.get('to'); return json(res, 200, { items: outbox.filter((m) => !to || m.to === to.toLowerCase()) });
      }
      if (p === '/auth/v1/.well-known/jwks.json') return json(res, 200, { keys: mode === 'jwks' ? [publicJwk] : [] });
      if (!apikeyOk(req)) return err(res, 401, 'no_authorization', 'No API key found in request');
      if (opaqueInBearer(req)) return err(res, 401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is malformed');
      if (p === '/auth/v1/health' && method === 'GET') return json(res, 200, { version: 'fake', name: 'GoTrue' });
      const body = ['POST', 'PUT'].includes(method) ? await readBody(req) : {};
      const grantType = url.searchParams.get('grant_type');
      const op = p === '/auth/v1/invite' ? 'invite' : p === '/auth/v1/recover' ? 'recover' : p === '/auth/v1/verify' ? 'verify' : p === '/auth/v1/logout' ? 'logout'
        : p === '/auth/v1/token' ? (grantType === 'refresh_token' ? 'refresh' : 'login') : p.startsWith('/auth/v1/admin/') ? 'admin' : null;
      if (op && state.fail[op]) return err(res, state.fail[op], 'unexpected_failure', 'simulated failure');

      if (p === '/auth/v1/invite' && method === 'POST') {
        if (!isService(req)) return err(res, 401, 'not_admin', 'User not allowed');
        const email = String(body.email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+$/.test(email)) return err(res, 422, 'validation_failed', 'Unable to validate email address');
        let u = byEmail(email);
        if (u && u.confirmedAt) return err(res, 422, 'email_exists', 'A user with this email address has already been registered');
        if (!u) { u = addUser({ email, confirmed: false, displayName: body.data?.display_name || '' }); }
        u.invitedAt = new Date().toISOString(); u.banned = false; mail(u, 'invite');
        return json(res, 200, publicUser(u));
      }
      if (p === '/auth/v1/verify' && method === 'POST') {
        const t = tokens.get(String(body.token_hash || ''));
        if (!t || t.used || t.type !== body.type || t.expiresAt < Date.now()) return err(res, 403, 'otp_expired', 'Email link is invalid or has expired');
        const u = users.get(t.userId); if (!u) return err(res, 403, 'otp_expired', 'Email link is invalid or has expired');
        if (u.banned) return err(res, 403, 'user_banned', 'User is banned');
        t.used = true; u.confirmedAt = u.confirmedAt || new Date().toISOString();
        return json(res, 200, await newSession(u));
      }
      if (p === '/auth/v1/token' && method === 'POST') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const u = byEmail(body.email);
          if (u && state.latency.existingUserMs) await sleep(state.latency.existingUserMs);   // simula o bcrypt: e-mail existente é mais lento
          if (!u || !u.pwHash || scrypt(String(body.password || ''), u.salt) !== u.pwHash) return err(res, 400, 'invalid_credentials', 'Invalid login credentials');
          if (!u.confirmedAt) return err(res, 400, 'email_not_confirmed', 'Email not confirmed');
          if (u.banned) return err(res, 403, 'user_banned', 'User is banned');       // senha conferida ANTES do bloqueio (como o GoTrue)
          return json(res, 200, await newSession(u));
        }
        if (grant === 'refresh_token') {
          const r = refresh.get(String(body.refresh_token || ''));
          if (!r) return err(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
          if (r.used) return err(res, 400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used');
          if (!sessions.has(r.sid)) return err(res, 400, 'session_not_found', 'Invalid Refresh Token: Session Not Found');
          const u = users.get(r.userId); if (!u) return err(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
          if (u.banned) return err(res, 403, 'user_banned', 'User is banned');
          r.used = true; sessions.delete(r.sid);
          return json(res, 200, await newSession(u));
        }
        return err(res, 400, 'validation_failed', 'unsupported_grant_type');
      }
      if (p === '/auth/v1/user' && method === 'PUT') {
        const a = await authUser(req); if (!a) return err(res, 401, 'bad_jwt', 'invalid JWT');
        if (a.u.banned) return err(res, 403, 'user_banned', 'User is banned');
        if (typeof body.password === 'string') {
          if (body.password.length < 6) return err(res, 422, 'weak_password', 'Password should be at least 6 characters.');
          if (state.rejectPasswords?.includes(body.password)) return err(res, 422, 'weak_password', 'Password is known to be weak and easy to guess, please choose a different one.');
          if (a.u.pwHash && scrypt(body.password, a.u.salt) === a.u.pwHash) return err(res, 422, 'same_password', 'New password should be different from the old password.');
          a.u.pwHash = scrypt(body.password, a.u.salt);
        }
        return json(res, 200, publicUser(a.u));
      }
      if (p === '/auth/v1/recover' && method === 'POST') {
        const u = byEmail(body.email);
        if (u && !u.banned) mail(u, 'recovery');                                     // e-mail inexistente: 200 do mesmo jeito
        return json(res, 200, {});
      }
      if (p === '/auth/v1/logout' && method === 'POST') {
        const a = await authUser(req); if (!a) return err(res, 401, 'bad_jwt', 'invalid JWT');
        const scope = url.searchParams.get('scope') || 'global';
        for (const [sid, s] of [...sessions]) if (s.userId === a.u.id && (scope === 'global' || (scope === 'local' && sid === a.sid) || (scope === 'others' && sid !== a.sid))) sessions.delete(sid);
        res.writeHead(204); return res.end();
      }
      const am = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(p);
      if (p === '/auth/v1/admin/users' && method === 'GET') {
        if (!isService(req)) return err(res, 403, 'not_admin', 'User not allowed');
        const page = Number(url.searchParams.get('page') || 1), per = Number(url.searchParams.get('per_page') || 50);
        const all = [...users.values()]; return json(res, 200, { users: all.slice((page - 1) * per, page * per).map(publicUser), aud: 'authenticated' });
      }
      if (am) {
        if (!isService(req)) return err(res, 403, 'not_admin', 'User not allowed');
        const u = users.get(am[1]); if (!u) return err(res, 404, 'user_not_found', 'User not found');
        if (method === 'PUT') { if ('ban_duration' in body) u.banned = body.ban_duration !== 'none'; return json(res, 200, publicUser(u)); }
        if (method === 'DELETE') { users.delete(u.id); for (const [sid, s] of [...sessions]) if (s.userId === u.id) sessions.delete(sid); return json(res, 200, {}); }
      }
      return err(res, 404, 'not_found', 'path not found');
    } catch (e) { return err(res, 500, 'unexpected_failure', 'fake error'); }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port ?? 0, '127.0.0.1', resolve); });
  const port = server.address().port; const url = `http://127.0.0.1:${port}`; issuer = `${url}/auth/v1`;
  return {
    url, port, mode, keyFormat: opaque ? 'opaque' : 'legacy', anonKey, serviceKey, jwtSecret, issuer, appOrigin,
    jwksUrl: mode === 'jwks' ? `${url}/auth/v1/.well-known/jwks.json` : undefined,
    publicJwk,
    outbox: (to) => outbox.filter((m) => !to || m.to === String(to).toLowerCase()),
    clearOutbox: () => { outbox.length = 0; },
    calls, state, users,
    addUser, userByEmail: byEmail,
    /** Assina um token arbitrário (testes de adulteração: iss/aud/exp errados, outro alg…). */
    mintToken: mint,
    /** Falsifica uma sessão válida (útil para forçar expiração): invalida refresh tokens/sessões de um usuário. */
    revokeSessions(userId) { for (const [sid, s] of [...sessions]) if (s.userId === userId) sessions.delete(sid); },
    setAccessTtl(s) { state.accessTtl = s; },
    isBanned: (userId) => !!users.get(userId)?.banned,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await startFakeGoTrue({ port: Number(process.env.FAKE_GOTRUE_PORT || 54321), mode: process.env.FAKE_GOTRUE_MODE === 'hs256' ? 'hs256' : 'jwks', appOrigin: process.env.APP_ORIGIN });
  console.log(JSON.stringify({ msg: 'fake-gotrue no ar', url: f.url, anonKey: f.anonKey, serviceKey: f.serviceKey, jwksUrl: f.jwksUrl, jwtSecret: f.mode === 'hs256' ? f.jwtSecret : undefined }));
  process.once('SIGINT', () => f.close().then(() => process.exit(0)));
  process.once('SIGTERM', () => f.close().then(() => process.exit(0)));
}
