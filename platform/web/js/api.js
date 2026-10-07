/* api.js — cliente da API (docs/API.md). Regras:
   • cookies HttpOnly de sessão (o JS nunca vê nem guarda token); credentials same-origin;
   • CSRF: cabeçalho X-CSRF-Token lido do cookie __Host-am_csrf (produção) ou am_csrf (dev); se faltar, busca em GET /api/auth/session;
   • 401 session_expired → UM refresh compartilhado (single-flight) e repete a chamada; se falhar → /entrar?next=…;
   • timeout de 20 s com mensagem amigável; 429 mostra o tempo de espera (Retry-After);
   • erros no formato do contrato → ApiError(status, code, message, details). */
import { waitText } from './format.js';

export const DEFAULT_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(status, code, message, details = null, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = extra.requestId || null;
    this.retryAfter = extra.retryAfter ?? null;
    this.redirecting = false;
  }
}

/* ───────── cookies / CSRF ───────── */
function readCookie(name) {
  for (const part of document.cookie.split('; ')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) { try { return decodeURIComponent(part.slice(i + 1)); } catch { return part.slice(i + 1); } }
  }
  return null;
}
const csrfFromCookie = () => readCookie('__Host-am_csrf') || readCookie('am_csrf');

let csrfInflight = null;
/** Garante o cookie CSRF (GET /api/auth/session) e devolve o token. */
export function ensureCsrf() {
  if (!csrfInflight) {
    csrfInflight = request('GET', '/api/auth/session', { auth: false })
      .then((s) => csrfFromCookie() || s?.csrfToken || null)
      .finally(() => { csrfInflight = null; });
  }
  return csrfInflight;
}

/* ───────── refresh single-flight ───────── */
let refreshing = null;
let refreshEpoch = 0;
/** Renova a sessão. Chamadas simultâneas compartilham UMA requisição. */
export function refreshSession() {
  if (!refreshing) {
    refreshing = request('POST', '/api/auth/refresh', { auth: false })
      .catch(async (e) => {
        // 429 = limite de taxa compartilhado (vários usuários atrás do mesmo IP), não sessão expirada: espera o Retry-After (≤ 30 s) e repete uma vez
        if (!(e instanceof ApiError) || e.status !== 429) throw e;
        await new Promise((r) => setTimeout(r, Math.min(30, Math.max(1, e.retryAfter || 5)) * 1000));
        return request('POST', '/api/auth/refresh', { auth: false });
      })
      .then((r) => { refreshEpoch++; return r; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

let redirecting = false;
export function goToLogin(reason = 'sessao') {
  if (redirecting) return;
  const here = location.pathname + location.search;
  if (/^\/entrar(\/|$|\?)/.test(here)) return;
  redirecting = true;
  const q = new URLSearchParams({ next: here });
  if (reason) q.set('motivo', reason);
  location.assign(`/entrar?${q.toString()}`);
}

/* ───────── núcleo ───────── */
function buildUrl(path, query) {
  if (!query) return path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); }
  const s = q.toString();
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path;
}

function parseRetryAfter(res) {
  const v = res.headers.get('Retry-After');
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

function genericMessage(status) {
  if (status === 413) return 'O conteúdo é grande demais para ser enviado.';
  if (status === 429) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  if (status >= 500) return 'O servidor está indisponível no momento. Tente novamente em instantes.';
  if (status === 404) return 'Não encontramos o que você procurou.';
  if (status === 403) return 'Você não tem permissão para fazer isso.';
  return 'Não foi possível concluir a operação.';
}

async function toApiError(res) {
  let body = null;
  const ctype = res.headers.get('Content-Type') || '';
  try { body = ctype.includes('json') ? await res.json() : null; } catch { body = null; }
  const e = body && typeof body === 'object' ? body.error : null;
  const retryAfter = res.status === 429 ? parseRetryAfter(res) : null;
  const requestId = e?.requestId || res.headers.get('X-Request-Id') || null;
  if (e && typeof e === 'object') {
    let message = typeof e.message === 'string' && e.message ? e.message : genericMessage(res.status);
    if (res.status === 429) message = retryAfter ? `Muitas tentativas. Tente novamente em ${waitText(retryAfter)}.` : 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return new ApiError(res.status, String(e.code || `http_${res.status}`), message, e.details ?? null, { requestId, retryAfter });
  }
  const message = res.status === 429 ? (retryAfter ? `Muitas tentativas. Tente novamente em ${waitText(retryAfter)}.` : genericMessage(429)) : genericMessage(res.status);
  return new ApiError(res.status, res.status === 429 ? 'rate_limited' : `http_${res.status}`, message, null, { requestId, retryAfter });
}

const isBinaryBody = (b) => b instanceof Blob || b instanceof ArrayBuffer || ArrayBuffer.isView(b) || typeof b === 'string';

/**
 * request(method, path, { body, query, headers, auth = true, timeout, signal, binary = false, text = false })
 * Devolve o JSON (ou null em 204; texto/Blob quando `text`/`blob`). Lança ApiError.
 */
export async function request(method, path, opts = {}) {
  const { body, query, headers, auth = true, timeout = DEFAULT_TIMEOUT_MS, signal, text = false, blob = false } = opts;
  const retry = opts._retry || {};
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const h = new Headers(headers || {});
  if (!h.has('Accept')) h.set('Accept', text || blob ? '*/*' : 'application/json');
  let payload;
  if (body !== undefined && body !== null) {
    if (opts.binary || (isBinaryBody(body) && typeof body !== 'string')) payload = body;
    else { if (!h.has('Content-Type')) h.set('Content-Type', 'application/json'); payload = JSON.stringify(body); }
  }
  if (write) {
    let token = csrfFromCookie();
    if (!token) token = await ensureCsrf();
    if (token) h.set('X-CSRF-Token', token);
  }

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const epochAtSend = refreshEpoch;
  let res; let data = null; let err = null;
  try {
    try {
      res = await fetch(buildUrl(path, query), { method, headers: h, body: payload, credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    } catch (e) {
      if (timedOut) throw new ApiError(0, 'timeout', 'A resposta demorou demais. Verifique sua conexão e tente novamente.');
      if (e?.name === 'AbortError') throw e;
      throw new ApiError(0, 'network', 'Não foi possível conectar ao servidor. Verifique sua conexão e tente de novo.');
    }
    if (res.ok) {
      if (res.status === 204) data = null;
      else if (text) data = await res.text();
      else if (blob) data = await res.blob();
      else if ((res.headers.get('Content-Type') || '').includes('json')) data = await res.json();
      else data = null;
    } else {
      err = await toApiError(res);
    }
  } catch (e) {
    if (timedOut && !(e instanceof ApiError)) throw new ApiError(0, 'timeout', 'A resposta demorou demais. Verifique sua conexão e tente novamente.');
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (!err) return data;

  // 401: sessão expirada → um refresh compartilhado e repete a chamada uma vez
  if (auth && err.status === 401 && (err.code === 'session_expired' || err.code === 'unauthenticated') && !retry.refreshed) {
    try {
      if (epochAtSend === refreshEpoch) await refreshSession(); // se outro refresh terminou depois do envio, só repete
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) throw e;   // limite de taxa compartilhado (escritório atrás de um IP): a sessão continua válida — mostra a mensagem do 429, não manda para /entrar
      err.redirecting = true;
      goToLogin('sessao');
      throw err;
    }
    return request(method, path, { ...opts, _retry: { ...retry, refreshed: true } });
  }
  if (auth && err.status === 401 && retry.refreshed) { err.redirecting = true; goToLogin('sessao'); }
  // 403 csrf: cookie ausente/rotacionado → busca de novo e repete uma vez
  if (write && err.status === 403 && err.code === 'csrf' && !retry.csrf) {
    await ensureCsrf().catch(() => null);
    return request(method, path, { ...opts, _retry: { ...retry, csrf: true } });
  }
  throw err;
}

export const api = {
  request,
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body: body === undefined ? {} : body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  session: (opts) => request('GET', '/api/auth/session', { ...opts, auth: false }),
};

/** details.fields do contrato → { campo: 'mensagem' }. Aceita [{path, message}] (servidor) e { campo: [mensagens] }. */
export function fieldErrors(err) {
  const f = err?.details?.fields;
  const out = {};
  if (Array.isArray(f)) { for (const it of f) { if (it && typeof it.path === 'string' && !(it.path in out)) out[it.path] = String(it.message || ''); } }
  else if (f && typeof f === 'object') { for (const [k, v] of Object.entries(f)) out[k] = String(Array.isArray(v) ? v[0] : v); }
  return out;
}

/** Mensagem pronta para mostrar ao usuário a partir de qualquer erro. */
export function friendlyMessage(err, fallback = 'Algo deu errado. Tente novamente.') {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}
