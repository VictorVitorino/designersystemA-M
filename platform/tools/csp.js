/* CSP do Canteiro online — fonte única das políticas (usada por build-web.js, pelo servidor de testes e pelo servidor local).
   Páginas comuns (login, acervo, admin): sem script/estilo inline (nem atributo style=, nem on…=).
   Editor (/editor/<id> e /visualizar/<id>): o editor original é um arquivo único com <script> inline, então cada <script> inline do HTML
   montado entra por hash SHA-256 + 'strict-dynamic' (pdf.js é carregado por import() de um script já autorizado). Estilo inline é aceito
   só no editor ('unsafe-inline' em style-src — o editor usa style="" em centenas de pontos); script nunca. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const COMMON_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

const EDITOR_REST = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  "img-src 'self' data: blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://script.google.com https://script.googleusercontent.com",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests'
];

const JS_TYPES = /^(|text\/javascript|application\/javascript|application\/x-javascript|text\/ecmascript|application\/ecmascript|module)$/i;

export function sha256Base64(text) { return createHash('sha256').update(text, 'utf8').digest('base64'); }

/** Todos os <script> inline EXECUTÁVEIS do HTML (sem src e com tipo JS). Blocos application/json e text/plain não executam: sem hash. */
export function inlineScripts(html) {
  const out = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi; let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) { out.push({ external: true, attrs, text: '' }); continue; }
    const t = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const type = t ? (t[1] ?? t[2] ?? t[3] ?? '').trim() : '';
    if (!JS_TYPES.test(type)) continue;
    out.push({ external: false, attrs, text: m[2], type });
  }
  return out;
}

/** 'sha256-…' únicos, na ordem em que aparecem. Falha se houver <script src> (sob 'strict-dynamic' ele não carregaria). */
export function inlineScriptHashes(html) {
  const list = inlineScripts(html);
  const ext = list.find((s) => s.external);
  if (ext) throw new Error('o HTML do editor tem <script src>; sob strict-dynamic ele seria bloqueado (' + ext.attrs.trim().slice(0, 80) + ')');
  const seen = new Set(), hs = [];
  for (const s of list) { const h = 'sha256-' + sha256Base64(s.text); if (!seen.has(h)) { seen.add(h); hs.push(h); } }
  return hs;
}

export function editorCsp(html) {
  const hashes = inlineScriptHashes(html).map((h) => `'${h}'`);
  return [`script-src ${hashes.join(' ')} 'strict-dynamic'`, ...EDITOR_REST].join('; ');
}

/** { default, "/editor/", "/visualizar/" } */
export function buildCspJson(editorHtml) {
  const ed = editorCsp(editorHtml);
  return { default: COMMON_CSP, '/editor/': ed, '/visualizar/': ed };
}

export function readCspJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }

/** CSP aplicável a um caminho de URL (pathname). */
export function cspFor(pathname, json) {
  for (const k of Object.keys(json)) if (k !== 'default' && pathname.startsWith(k)) return json[k];
  return json.default;
}

/** Demais cabeçalhos de segurança das páginas (Vercel e servidor local usam a mesma lista). */
export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
};
