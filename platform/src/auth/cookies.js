/* Cookies de sessão (docs/API.md §2). O navegador NUNCA recebe tokens no corpo: só estes cookies.
     at   = access token JWT        HttpOnly, SameSite=Lax, Path=/, ~1 h
     rt   = refresh token           HttpOnly, SameSite=Lax, Path=/, 30 d
     csrf = token CSRF (double-submit) NÃO HttpOnly de propósito (o JS do app o devolve no cabeçalho X-CSRF-Token)
     np   = "precisa definir senha" (só UX: mantém a tela de nova senha após recarregar a página)
   Em produção/staging (HTTPS) os nomes levam o prefixo `__Host-`: o navegador então exige Secure + Path=/ + sem Domain,
   o que impede um subdomínio (ou HTTP) de plantar/sobrescrever o cookie. Em local/test (HTTP) usamos os nomes sem prefixo e sem Secure. */
import { setCookie, getCookie } from 'hono/cookie';

export const RT_MAX_AGE_S = 30 * 24 * 3600;
export const cookieNames = (config) => ({ at: `${config.cookiePrefix}am_at`, rt: `${config.cookiePrefix}am_rt`, csrf: `${config.cookiePrefix}am_csrf`, np: `${config.cookiePrefix}am_np` });

const base = (config, httpOnly) => ({ path: '/', httpOnly, secure: !!config.cookieSecure, sameSite: 'Lax' });

export function readCookie(c, name) { return getCookie(c, name) || null; }

/** Grava access + refresh (sem expor no corpo). expires_in vem do GoTrue (segundos). */
export function setSessionCookies(c, config, { accessToken, refreshToken, expiresIn }) {
  const n = cookieNames(config);
  const atAge = Math.max(60, Math.min(Number(expiresIn) || 3600, 24 * 3600));
  setCookie(c, n.at, accessToken, { ...base(config, true), maxAge: atAge });
  if (refreshToken) setCookie(c, n.rt, refreshToken, { ...base(config, true), maxAge: RT_MAX_AGE_S });
}
export function setCsrfCookie(c, config, token) { setCookie(c, cookieNames(config).csrf, token, { ...base(config, false), maxAge: RT_MAX_AGE_S }); }
export function setNeedsPasswordCookie(c, config, on) {
  const n = cookieNames(config).np;
  if (on) setCookie(c, n, '1', { ...base(config, true), maxAge: 3600 });
  else setCookie(c, n, '', { ...base(config, true), maxAge: 0 });
}
/** Apaga os cookies de sessão (o CSRF permanece, a menos que `csrf: true`). */
export function clearSessionCookies(c, config, { csrf = false } = {}) {
  const n = cookieNames(config);
  for (const name of [n.at, n.rt, n.np]) setCookie(c, name, '', { ...base(config, true), maxAge: 0 });
  if (csrf) setCookie(c, n.csrf, '', { ...base(config, false), maxAge: 0 });
}
