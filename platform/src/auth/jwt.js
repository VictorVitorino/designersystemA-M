/* Verificação do JWT do Supabase Auth (jose). Regras (cada uma tem teste em tests/unit/jwt.test.js):
   • algoritmo é escolhido por NÓS (lista fixa), nunca pelo token: `alg: none` e confusão HS×RS/ES são recusados.
     Com JWKS só ES256/RS256 (chaves públicas); com segredo só HS256. A chave pública NUNCA é usada como segredo HMAC —
     a chave é escolhida pelo algoritmo, e o jose ainda recusa chave assimétrica em HS256 (e vice-versa).
   • exige iss (= {SUPABASE_URL}/auth/v1), aud ('authenticated'), exp e sub; papel 'authenticated'; recusa sessão anônima.
   • provedor da identidade vem de app_metadata.provider (só o servidor do GoTrue escreve app_metadata): "sso:<uuid>" para o SSO (SAML) — a
     identidade é guardada como ('sso:<uuid>', sub); qualquer outro (e-mail/senha, convite, recuperação) é 'supabase', como sempre foi.
   • e-mail verificado: no SSO (e em qualquer provedor externo) só com a declaração explícita user_metadata.email_verified === true; no
     e-mail/senha a falta da declaração conta como verificado, porque o GoTrue só emite sessão depois de confirmar o e-mail (F10).
   • erros de REDE ao buscar o JWKS não viram "token inválido" (senão uma falha do provedor deslogaria todo mundo): viram 'unavailable'. */
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader, errors } from 'jose';
import { isSsoProvider } from './sso.js';

export class JwtRejected extends Error {
  /** @param {'expired'|'invalid'|'unavailable'|'not_configured'} reason */
  constructor(reason) { super(reason); this.name = 'JwtRejected'; this.reason = reason; }
}

const TOKEN_ERRORS = new Set(['ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWT_INVALID', 'ERR_JWS_INVALID', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED', 'ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS', 'ERR_JOSE_NOT_SUPPORTED', 'ERR_JWKS_INVALID']);

/** @param {{supabase:{url?:string,jwksUrl?:string,jwtSecret?:string}}} config @param {{jwks?:Function}} [opts] */
export function createJwtVerifier(config, opts = {}) {
  const { url, jwksUrl, jwtSecret } = config.supabase || {};
  const issuer = url ? `${url.replace(/\/$/, '')}/auth/v1` : null;
  const secret = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;
  const remote = opts.jwks || (jwksUrl ? createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 10 * 60 * 1000 }) : null);
  const algorithms = [...(secret ? ['HS256'] : []), ...(remote ? ['ES256', 'RS256'] : [])];

  /** @returns {Promise<{sub:string,email:string,emailVerified:boolean,sessionId:string|null,exp:number,provider:string}>} */
  async function verify(token) {
    if (!issuer || !algorithms.length) throw new JwtRejected('not_configured');
    if (typeof token !== 'string' || token.length > 4096 || token.split('.').length !== 3) throw new JwtRejected('invalid');
    let alg;
    try { alg = decodeProtectedHeader(token).alg; } catch { throw new JwtRejected('invalid'); }
    if (!algorithms.includes(alg)) throw new JwtRejected('invalid');          // none, HS256 no modo JWKS, ES256 no modo segredo…
    const key = alg === 'HS256' ? secret : remote;
    let payload;
    try {
      ({ payload } = await jwtVerify(token, key, { algorithms: [alg], issuer, audience: 'authenticated', requiredClaims: ['sub', 'exp', 'iss', 'aud'], clockTolerance: 5 }));
    } catch (e) {
      if (e instanceof errors.JWTExpired) throw new JwtRejected('expired');
      if (e && TOKEN_ERRORS.has(e.code)) throw new JwtRejected('invalid');
      throw new JwtRejected('unavailable');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 255) throw new JwtRejected('invalid');
    if (payload.role !== 'authenticated' || payload.is_anonymous === true) throw new JwtRejected('invalid');
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email) throw new JwtRejected('invalid');
    const method = typeof payload.app_metadata?.provider === 'string' ? payload.app_metadata.provider.toLowerCase() : '';
    const provider = isSsoProvider(method) ? method : 'supabase';
    // E-mail/senha: o GoTrue só emite token depois de confirmar o e-mail (convite/recuperação/login exigem isso); `email_verified: false` explícito
    // é respeitado. SSO e outros provedores externos: só a declaração explícita `true` vale (um IdP que não a mande não vincula conta por e-mail).
    const declared = payload.user_metadata?.email_verified;
    const emailVerified = method === '' || method === 'email' ? declared !== false : declared === true;
    return { sub: payload.sub, email, emailVerified, sessionId: typeof payload.session_id === 'string' ? payload.session_id : null, exp: payload.exp, provider };
  }
  return { verify, configured: !!issuer && algorithms.length > 0 };
}
