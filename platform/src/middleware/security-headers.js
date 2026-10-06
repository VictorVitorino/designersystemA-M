/* Cabeçalhos de segurança em TODAS as respostas (API e arquivos estáticos).
   Definidos DEPOIS do handler (next) para valer também em respostas de erro; CSP e Cache-Control só entram se o handler não definiu
   (o endpoint de arquivos define o seu próprio — docs/API.md §5). Nunca emitimos CORS: a API só atende a própria origem. */

/** Define um cabeçalho na resposta final (reconstrói a Response se os cabeçalhos forem imutáveis, ex.: redirecionamento vindo do fetch). */
export function setHeader(c, name, value, { ifAbsent = false } = {}) {
  if (ifAbsent && c.res.headers.has(name)) return;
  try { c.res.headers.set(name, value); }
  catch { c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers: new Headers(c.res.headers) }); c.res.headers.set(name, value); }
}

export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=(), fullscreen=(self)';
export const HSTS = 'max-age=63072000; includeSubDomains';
const NO_STORE_PREFIXES = ['/api/auth', '/api/admin', '/api/me'];

/** @param {{isSecure?:boolean, cookieSecure?:boolean}} config */
export function securityHeaders(config) {
  const secure = !!(config?.isSecure || config?.cookieSecure);
  return async (c, next) => {
    await next();
    const path = c.req.path;
    const isApi = path === '/api' || path.startsWith('/api/');
    if (secure) setHeader(c, 'Strict-Transport-Security', HSTS);
    setHeader(c, 'X-Content-Type-Options', 'nosniff');
    setHeader(c, 'Referrer-Policy', 'strict-origin-when-cross-origin');
    setHeader(c, 'Permissions-Policy', PERMISSIONS_POLICY);
    setHeader(c, 'Cross-Origin-Opener-Policy', 'same-origin');
    setHeader(c, 'Cross-Origin-Resource-Policy', 'same-origin');
    setHeader(c, 'X-Frame-Options', 'DENY');
    if (isApi) {
      setHeader(c, 'Content-Security-Policy', API_CSP, { ifAbsent: true });
      // dados de sessão/administração nunca podem ficar em cache (compartilhado ou do navegador)
      if (NO_STORE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) setHeader(c, 'Cache-Control', 'no-store');
      else setHeader(c, 'Cache-Control', 'no-store', { ifAbsent: true });
      // defesa em profundidade: nenhum CORS, mesmo que alguma rota o tenha definido por engano
      for (const h of [...c.res.headers.keys()]) if (h.toLowerCase().startsWith('access-control-')) { try { c.res.headers.delete(h); } catch { /* imutável: já reconstruído acima */ } }
    }
  };
}
