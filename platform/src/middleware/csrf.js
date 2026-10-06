/* Proteção CSRF (docs/API.md §2) — três camadas, TODAS precisam passar em requisições que alteram estado (POST/PUT/PATCH/DELETE):
     (a) double-submit: cabeçalho X-CSRF-Token == cookie am_csrf (32 bytes aleatórios; comparação em tempo constante);
     (b) Origin == APP_ORIGIN (ou, sem Origin, Sec-Fetch-Site: same-origin) — um site externo não consegue forjar o Origin de um fetch/form;
     (c) Content-Type permitido: JSON (ou o binário do upload de arquivo). Formulários HTML só enviam urlencoded/multipart/text-plain,
         então um <form> de outro site já cai aqui mesmo antes do token.
   GET/HEAD/OPTIONS são isentos (e nenhuma rota altera estado em GET). Falhou → 403 `csrf` + auditoria `security.csrf_blocked` SEM dados do corpo. */
import { E } from '../lib/errors.js';
import { cookieNames, readCookie } from '../auth/cookies.js';
import { CSRF_TOKEN_RE, safeEqual } from '../auth/hash.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const BINARY_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const ASSET_PUT = /^\/api\/assets\/[0-9a-f]{64}$/;

const mediaType = (v) => String(v || '').split(';')[0].trim().toLowerCase();

function contentTypeOk(c) {
  const ct = c.req.header('content-type');
  const len = c.req.header('content-length');
  const hasBody = (len !== undefined && len !== '0') || c.req.header('transfer-encoding') !== undefined;
  if (ct === undefined) return !hasBody;                       // sem corpo → sem Content-Type (ex.: logout); com corpo → obrigatório
  const t = mediaType(ct);
  if (t === 'application/json') return true;
  return c.req.method === 'PUT' && ASSET_PUT.test(c.req.path) && BINARY_TYPES.has(t);
}

/** Auditoria do bloqueio, com limite (20/min por IP) para o próprio ataque não encher a tabela. Nunca derruba a resposta 403. */
async function auditBlocked(c, reason) {
  try {
    const { db } = c.get('deps'); const ip = c.get('ip');
    await db.anon(async (tx) => {
      const [r] = await tx`select * from app.hit_rate('csrf_audit', ${ip || 'unknown'}, 60, 20)`;
      if (!r.allowed) return;
      await tx`select app.audit('security.csrf_blocked', 'request', null, ${ip}::inet, ${c.get('ua')}, ${c.get('requestId')}, ${tx.json({ reason, method: c.req.method, route: c.req.path.slice(0, 120) })})`;
    });
  } catch { /* auditoria é melhor-esforço aqui */ }
}

export function csrf(config) {
  const cookieName = cookieNames(config).csrf;
  return async (c, next) => {
    if (SAFE.has(c.req.method)) return next();
    let reason = null;
    const origin = c.req.header('origin');
    if (origin !== undefined) { if (origin !== config.origin) reason = 'origin'; }
    else if (c.req.header('sec-fetch-site') !== 'same-origin') reason = 'origin';
    if (!reason && !contentTypeOk(c)) reason = 'content_type';
    if (!reason) {
      const header = c.req.header('x-csrf-token'), cookie = readCookie(c, cookieName);
      if (!header || !cookie) reason = 'token_missing';
      else if (!CSRF_TOKEN_RE.test(header) || !CSRF_TOKEN_RE.test(cookie) || !safeEqual(header, cookie)) reason = 'token_mismatch';
    }
    if (reason) { await auditBlocked(c, reason); throw E.csrf(); }
    return next();
  };
}
