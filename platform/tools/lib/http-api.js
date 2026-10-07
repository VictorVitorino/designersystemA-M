/* tools/lib/http-api.js — cliente HTTP/JSON mínimo para as APIs de configuração (Supabase Management API, Vercel, Resend).
   • Tenta de novo em 429/5xx/falha de rede (até 3 vezes, respeitando Retry-After curto).
   • Erros viram ToolError com status e a mensagem do provedor — sempre REDIGIDA (nunca ecoa tokens/chaves, mesmo que o provedor os repita).
   • Nunca registra cabeçalhos nem corpos enviados. */
import { ToolError, sleep } from './common.js';

export class ApiError extends ToolError {
  constructor(message, { status = 0, code = 'api_error', body = null } = {}) { super(message, { code, exit: 1 }); this.name = 'ApiError'; this.status = status; this.body = body; }
}

function mensagemDoCorpo(json, text) {
  if (json && typeof json === 'object') {
    const e = json.error; const cand = [json.message, json.msg, e && typeof e === 'object' ? e.message : e, json.error_description, json.detail, Array.isArray(json.errors) ? json.errors.map((x) => x.message || x).join('; ') : null];
    const m = cand.find((x) => typeof x === 'string' && x.trim()); if (m) return m.trim();
  }
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{base:string, headers?:Record<string,string>, fetchImpl?:Function, redact?:(s:string)=>string, nome?:string, tentativas?:number, timeoutMs?:number, esperaMs?:number}} o
 */
export function clienteHttp({ base, headers = {}, fetchImpl = fetch, redact = (s) => s, nome = 'API', tentativas = 3, timeoutMs = 30000, esperaMs = 1000 }) {
  const raiz = String(base).replace(/\/+$/, '');
  async function req(method, caminho, { body, query, aceitar = [] } = {}) {
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
    const url = raiz + caminho + (qs === '?' ? '' : qs);
    let ultimo;
    for (let t = 1; t <= tentativas; t++) {
      let r;
      try {
        r = await fetchImpl(url, { method, headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        const motivo = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `sem resposta em ${Math.round(timeoutMs / 1000)} s` : String(e?.cause?.code || e?.cause?.message || e?.message || e);
        ultimo = new ApiError(`${nome}: falha de rede em ${method} ${caminho} (${redact(motivo).slice(0, 120)})`, { code: 'network' });
        if (t < tentativas) { await sleep(esperaMs * t); continue; } throw ultimo;
      }
      const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (r.ok || aceitar.includes(r.status)) return { status: r.status, json, text, headers: r.headers };
      const msg = redact(mensagemDoCorpo(json, text)).slice(0, 400);
      ultimo = new ApiError(`${nome} respondeu HTTP ${r.status} em ${method} ${caminho}${msg ? ': ' + msg : ''}`, { status: r.status, code: r.status === 401 || r.status === 403 ? 'unauthorized' : r.status === 404 ? 'not_found' : 'api_error', body: json });
      if ((r.status === 429 || r.status >= 500) && t < tentativas) { const ra = Number(r.headers.get('retry-after')); await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : esperaMs * t); continue; }
      throw ultimo;
    }
    throw ultimo;
  }
  return {
    req,
    get: (c, o) => req('GET', c, o), post: (c, body, o) => req('POST', c, { ...o, body }), patch: (c, body, o) => req('PATCH', c, { ...o, body }),
    put: (c, body, o) => req('PUT', c, { ...o, body }), del: (c, o) => req('DELETE', c, o),
  };
}

/** Cabeçalhos para chamar o Supabase com uma chave de API: as chaves novas (sb_…) vão SÓ em `apikey` (não são JWT e o Supabase as recusa como Bearer);
 *  as legadas (JWT) vão em `apikey` e em `Authorization`, como antes. Mesmo critério de src/auth/gotrue.js. */
export function cabecalhosSupabase(chave) {
  const k = String(chave || '');
  return k.startsWith('sb_') ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };
}
