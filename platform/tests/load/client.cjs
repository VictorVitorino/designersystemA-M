/* tests/load/client.cjs — cliente HTTP de UMA sessão simulada (cookie jar próprio, CSRF automático, Origin, medição por requisição).
   Reproduz o que o navegador faz (docs/API.md §2): cookies HttpOnly guardados pelo jar, X-CSRF-Token = cookie am_csrf,
   Origin = APP_ORIGIN em toda escrita. Cada requisição é registrada em `metrics` com chave normalizada (sem ids). */
'use strict';
const { performance } = require('node:perf_hooks');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseSetCookie(line) {
  const [pair, ...attrs] = line.split(';').map((s) => s.trim());
  const i = pair.indexOf('=');
  const a = {}; for (const x of attrs) { const [k, v] = x.split('='); a[k.toLowerCase()] = v === undefined ? true : v; }
  return { name: pair.slice(0, i), value: pair.slice(i + 1), attrs: a };
}

class Client {
  /** @param {{base:string, origin:string, name:string, metrics:import('./metrics.cjs').Metrics, timeoutMs?:number}} o */
  constructor({ base, origin, name, metrics, timeoutMs = 30000 }) {
    this.base = base; this.origin = origin; this.name = name; this.metrics = metrics; this.timeoutMs = timeoutMs;
    this.jar = new Map(); this.user = null; this.errors = [];
  }
  cookie(n) { return this.jar.get(n) ?? null; }
  cookieNames() { return { csrf: this.jar.has('__Host-am_csrf') ? '__Host-am_csrf' : 'am_csrf', at: this.jar.has('__Host-am_at') ? '__Host-am_at' : 'am_at', rt: this.jar.has('__Host-am_rt') ? '__Host-am_rt' : 'am_rt' }; }
  /** Cookies no formato do Playwright (context.addCookies). */
  exportCookies(domain = 'localhost') { return [...this.jar].map(([name, value]) => ({ name, value, domain, path: '/', httpOnly: !/csrf/.test(name), secure: false, sameSite: 'Lax' })); }

  /**
   * @param {string} method @param {string} path
   * @param {{json?:any, body?:Buffer, headers?:object, key?:string, expect?:number, record?:boolean}} o
   * @returns {Promise<{status:number, json:any, text:string, headers:Headers|null, ms:number, bytes:number}>}
   */
  async request(method, path, { json, body, headers = {}, key, expect, record = true } = {}) {
    const h = new Headers(headers);
    if (!SAFE.has(method)) {
      if (!h.has('origin')) h.set('Origin', this.origin);
      const csrf = this.jar.get(this.cookieNames().csrf);
      if (csrf && !h.has('x-csrf-token')) h.set('X-CSRF-Token', csrf);
    }
    if (this.jar.size && !h.has('cookie')) h.set('Cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); if (!h.has('content-type')) h.set('Content-Type', 'application/json'); }
    const k = key || `${method} ${path.replace(/\?.*$/, '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/[0-9a-f]{64}/g, ':sha')}`;
    const at = Date.now(); const t0 = performance.now();
    let res, text = '', bytes = 0, status = 0, parsed;
    try {
      res = await fetch(this.base + path, { method, headers: h, body: payload, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      status = res.status;
      for (const line of res.headers.getSetCookie()) {
        const sc = parseSetCookie(line);
        if (sc.value === '' || sc.attrs['max-age'] === '0') this.jar.delete(sc.name); else this.jar.set(sc.name, sc.value);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.startsWith('application/json') || ct.startsWith('text/')) { text = await res.text(); bytes = Buffer.byteLength(text); try { parsed = JSON.parse(text); } catch { parsed = undefined; } }
      else { const buf = Buffer.from(await res.arrayBuffer()); bytes = buf.length; text = ''; parsed = buf; }
    } catch (e) {
      status = 0; text = String(e && (e.cause && e.cause.code || e.name || e.message));
      if (this.errors.length < 20) this.errors.push({ at, key: k, error: text });
    }
    const ms = performance.now() - t0;
    if (record) this.metrics.record({ key: k, ms, status, expect, bytes: bytes + (payload ? Buffer.byteLength(payload) : 0), at });
    return { status, json: parsed, text, headers: res ? res.headers : null, ms, bytes };
  }
  get(p, o) { return this.request('GET', p, o); }
  post(p, json, o) { return this.request('POST', p, { json, ...o }); }
  put(p, json, o) { return this.request('PUT', p, { json, ...o }); }
  async ensureCsrf() { if (!this.jar.get(this.cookieNames().csrf)) await this.get('/api/auth/session', { record: false }); return this.jar.get(this.cookieNames().csrf); }
}

module.exports = { Client, parseSetCookie };
