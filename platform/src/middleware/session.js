/* Sessão: cookie do access token → JWT verificado → usuário do banco. Preenche c.var:
     user   ({id,email,displayName,role,status} | null)      claims ({sub,email,…} | null)      authProblem (string | null)
   Regras:
   • Sem cookie → user=null (rotas públicas funcionam; as protegidas fazem requireUser → 401).
   • Token expirado → 401 `session_expired` (o app chama POST /api/auth/refresh e repete); adulterado/inválido → user=null (→ 401 `unauthenticated`).
   • Token válido de quem NÃO foi convidado → 403 `not_invited`; suspenso → 403 `suspended`; convidado que ainda não definiu a senha (`invited`)
     só alcança /api/auth/* (o resto recebe 403) — defesa em profundidade além do requireUser.
   • /api/auth/* e /api/health|ready cuidam do próprio estado (a rota de sessão, por exemplo, responde `authenticated:false` em vez de erro).
   • Cache de identidade ≤ 15 s: o banco continua sendo a autoridade, e suspender alguém vale na hora ou em até 15 s. */
import { E } from '../lib/errors.js';
import { cookieNames, readCookie } from '../auth/cookies.js';
import { getAuthKit } from '../auth/kit.js';
import { JwtRejected } from '../auth/jwt.js';

const SELF_HANDLED = (p) => p === '/api/auth' || p.startsWith('/api/auth/') || p === '/api/health' || p === '/api/ready';
const SKIP = (p) => p === '/api/health' || p === '/api/ready';

export function session(deps) {
  const kit = getAuthKit(deps);
  const atName = cookieNames(deps.config).at;
  return async (c, next) => {
    c.set('user', null); c.set('claims', null); c.set('authProblem', null);
    const path = c.req.path;
    if (SKIP(path)) return next();
    const token = readCookie(c, atName);
    if (token) {
      let claims = null;
      try { claims = await kit.verifier.verify(token); }
      catch (e) {
        const reason = e instanceof JwtRejected ? e.reason : 'invalid';
        if (reason === 'unavailable' || reason === 'not_configured') { if (!SELF_HANDLED(path)) throw E.unavailable(); }
        c.set('authProblem', reason === 'expired' ? 'expired' : reason === 'invalid' ? 'invalid' : reason);
      }
      if (claims) {
        c.set('claims', claims);
        let user = kit.cache.get(claims.sub);
        if (!user) {
          user = await kit.resolve(claims, { allowLink: false, touch: false });
          if (user) kit.cache.set(claims.sub, user);
        }
        if (!user) c.set('authProblem', 'not_invited');
        else { c.set('user', user); if (user.status === 'suspended') c.set('authProblem', 'suspended'); }
      }
    }
    const problem = c.get('authProblem'), user = c.get('user');
    if (!SELF_HANDLED(path)) {
      if (problem === 'expired') throw E.sessionExpired();
      if (problem === 'not_invited') throw E.notInvited();
      if (problem === 'suspended') throw E.suspended();
      if (user && user.status === 'invited') throw E.forbidden('Conclua a definição da senha para continuar.');
    }
    return next();
  };
}
