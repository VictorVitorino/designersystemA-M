/* SSO corporativo (SAML do Supabase Auth com PKCE) — as peças puras do fluxo, testáveis sem rede (docs/auth-e-sessoes.md §SSO).
   • PKCE (RFC 7636, S256): code_verifier aleatório (32 bytes → 43 caracteres base64url) e code_challenge = base64url(SHA-256(verifier)).
     O GoTrue guarda só o desafio; o código que volta do IdP só vira sessão com o verifier — que nunca sai do servidor e do cookie HttpOnly.
   • Estado do fluxo num cookie HttpOnly ASSINADO (HMAC-SHA256 com o segredo do servidor): verifier + destino depois do login + validade (10 min).
     É ele que amarra o retorno do IdP ao MESMO navegador que começou o login: um código obtido por outra pessoa (login CSRF / fixação de
     sessão) não serve aqui, porque falta o verifier certo. É de uso único (apagado no retorno).
   • Domínios: o pedido (e-mail ou domínio) precisa ser de SSO_DOMAINS; o e-mail que o IdP afirma também (conferido no retorno e no vínculo):
     um IdP mal configurado — ou de outra empresa — não vincula a conta de um domínio que não é dele. */
import { randomBytes, createHash } from 'node:crypto';
import { hmacHex, safeEqual } from './hash.js';

export const SSO_TTL_S = 600;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;
export const SSO_DOMAIN_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Par PKCE novo. @returns {{verifier:string, challenge:string}} */
export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeOf(verifier) };
}
export const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/** Domínio (minúsculo) de um e-mail; '' se não houver. */
export function domainOf(email) {
  const s = String(email || '').trim().toLowerCase(); const at = s.lastIndexOf('@');
  return at > 0 && at < s.length - 1 ? s.slice(at + 1) : '';
}
/** O domínio entra pelo SSO? (SSO ligado e domínio em SSO_DOMAINS.) */
export const ssoDomainAllowed = (config, domain) => !!(config && config.sso && config.sso.enabled && config.sso.domains.includes(String(domain || '').toLowerCase()));
/** Identidade de SSO do GoTrue ("sso:<uuid do provedor>"). */
export const isSsoProvider = (provider) => /^sso:[0-9a-f-]{36}$/.test(String(provider || ''));

/** Destino depois do login: só caminho INTERNO (mesma regra do cliente, web/js/format.js › safeNext) e nunca a própria tela de entrada nem a API. */
export function safeNext(raw, fallback = '/acervo') {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  const base = 'http://canteiro.invalid';
  let u;
  try { u = new URL(raw, base); } catch { return fallback; }
  if (u.origin !== base) return fallback;
  const path = u.pathname + u.search + u.hash;
  if (path[0] !== '/' || path[1] === '/' || path[1] === '\\') return fallback;   // "/./..//host" normaliza para "//host"
  if (/^\/(entrar|auth\/confirmar|esqueci-senha|api)(\/|$|\?|#)/.test(path)) return fallback;
  return path;
}

const secretOf = (config) => (config && config.csrfSecret) || 'canteiro-dev-sso';   // staging/produção exigem CSRF_SECRET (config.js)
/** Sela o estado do fluxo: base64url(JSON) + "." + HMAC — ninguém troca o destino, o verifier nem a validade sem o segredo do servidor. */
export function sealState(config, { verifier, next, now = Date.now() }) {
  const body = Buffer.from(JSON.stringify({ v: verifier, n: next, x: Math.floor(now / 1000) + SSO_TTL_S })).toString('base64url');
  return `${body}.${hmacHex(secretOf(config), `sso|${body}`)}`;
}
/** Abre o estado do cookie: assinatura, formato e validade. @returns {{verifier:string, next:string}|null} */
export function openState(config, raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const m = /^([A-Za-z0-9_-]{16,1800})\.([0-9a-f]{64})$/.exec(raw);
  if (!m || !safeEqual(m[2], hmacHex(secretOf(config), `sso|${m[1]}`))) return null;
  let s;
  try { s = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!s || typeof s !== 'object' || typeof s.v !== 'string' || !VERIFIER_RE.test(s.v) || !(Number(s.x) > Math.floor(now / 1000))) return null;
  return { verifier: s.v, next: safeNext(s.n) };
}

/** Código do retorno (o GoTrue usa UUID): formato conferido antes de qualquer chamada. */
export const AUTH_CODE_RE = /^[A-Za-z0-9._~-]{8,256}$/;
