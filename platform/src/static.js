/* Servidor estático (desenvolvimento, testes E2E e hospedagem em contêiner). Na Vercel os arquivos saem da CDN; aqui valem as mesmas regras:
   • serve só dentro de config.publicDir (path traversal, byte nulo, barra invertida, %2f, links simbólicos que escapam → recusados);
   • sem listagem de diretório; sem dotfiles; GET/HEAD apenas;
   • SPA: /editor/<uuid> → /editor/index.html, /visualizar/<uuid> → /visualizar/index.html e as telas (/acervo, /admin, /entrar, /importar,
     /esqueci-senha, /auth/confirmar) → index.html da própria pasta; caminho com extensão que não existe → 404 (nunca cai no HTML);
   • /editor e /visualizar SEM o id (UUID) de uma apresentação (/editor/, /editor/abc, /editor/index.html) → 302 para /acervo: sem o id o
     HTML abriria o editor original, fora da nuvem (nada salvo no servidor e sem aviso). A mesma regra está nos redirects do vercel.json;
   • CSP por página, lida de dist/csp.json ({default, "/editor/", "/visualizar/"}); sem o arquivo, CSP padrão estrita;
   • Cache-Control: HTML no-cache; /assets e /js com hash no nome → 1 ano imutável; o resto revalida (ETag);
   • nunca atende /api: repassa para a API (e um caminho codificado que desembrulhe em /api é 404). */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { createLogger } from './lib/log.js';

const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8',
};
/** Pastas-tela: a rota /<pasta>[/…] cai no index.html da pasta. `auth` serve /auth/confirmar. */
const SCREEN_DIRS = new Set(['editor', 'visualizar', 'acervo', 'admin', 'entrar', 'importar', 'esqueci-senha', 'auth']);
const HASHED = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i;
/** Páginas do editor só existem com o id da apresentação. Caminho "limpo" (letras, números, _ - . /) sem UUID → /acervo; com extensão de
 *  arquivo que não seja .html, ou com caracteres codificados, segue as regras de sempre (404). */
const EDITOR_ANY = /^\/(?:editor|visualizar)(?:\/[\w.-]*)*$/i;
const EDITOR_UUID = /^\/(?:editor|visualizar)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
export const editorWithoutId = (p) => EDITOR_ANY.test(p) && !EDITOR_UUID.test(p) && !/\.(?!html?$)[a-z0-9]+$/i.test(p);

const isApiPath = (p) => p === '/api' || p.startsWith('/api/');

/** Resolve o caminho da URL num arquivo dentro de publicDir. @returns {string|null} caminho absoluto (real) ou null */
export function resolveFile(publicDirReal, rawPath) {
  if (/%(2f|5c|00)/i.test(rawPath) || rawPath.includes('\\') || rawPath.includes('\0')) return null;
  let p;
  try { p = decodeURIComponent(rawPath); } catch { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  const segs = p.split('/').filter((s) => s !== '');
  if (segs.some((s) => s === '..' || s === '.' || (s.startsWith('.') && s !== '.well-known'))) return null;   // traversal e dotfiles
  const abs = path.join(publicDirReal, ...segs);
  if (abs !== publicDirReal && !abs.startsWith(publicDirReal + path.sep)) return null;
  let real;
  try { real = fs.realpathSync(abs); } catch { return abs; }                      // inexistente: devolve o caminho lógico (404 adiante)
  return real === publicDirReal || real.startsWith(publicDirReal + path.sep) ? real : null;   // symlink que sai da pasta → recusado
}

function loadCsp(cspFile, log) {
  let cache = { mtime: -1, size: -1, value: { default: DEFAULT_CSP } };
  return () => {
    let st; try { st = fs.statSync(cspFile); } catch { return { default: DEFAULT_CSP }; }
    if (st.mtimeMs === cache.mtime && st.size === cache.size) return cache.value;
    let value = { default: DEFAULT_CSP };
    try {
      const j = JSON.parse(fs.readFileSync(cspFile, 'utf8'));
      const clean = (s) => typeof s === 'string' && s.length > 0 && s.length < 8000 && !/[\r\n\0]/.test(s);   // sem quebra de linha: evita injeção de cabeçalho
      if (j && typeof j === 'object') {
        value = { default: clean(j.default) ? j.default : DEFAULT_CSP };
        for (const k of ['/editor/', '/visualizar/']) if (clean(j[k])) value[k] = j[k];
      }
    } catch { log.warn('csp_json_invalid', {}); }
    cache = { mtime: st.mtimeMs, size: st.size, value };
    return value;
  };
}

/** @param {import('hono').Hono} apiApp @param {object} config @param {{cspFile?:string}} [opts] @returns {import('hono').Hono} */
export function serveStatic(apiApp, config, opts = {}) {
  const log = createLogger(config);
  const publicDir = path.resolve(PLATFORM_ROOT, config.publicDir || './dist/public');
  let publicReal; try { publicReal = fs.realpathSync(publicDir); } catch { publicReal = publicDir; }
  const cspFile = opts.cspFile || path.join(path.dirname(publicDir), 'csp.json');
  const readCsp = loadCsp(cspFile, log);
  const root = new Hono({ strict: false });
  const fromStatic = (mw) => (c, next) => (isApiPath(c.req.path) ? next() : mw(c, next));   // a API tem os mesmos middlewares por conta própria

  root.use('*', async (c, next) => { if (!isApiPath(c.req.path) && !c.get('deps')) c.set('deps', { config }); await next(); });
  root.use('*', fromStatic(requestId()));
  root.use('*', fromStatic(securityHeaders(config)));
  root.all('/api', (c) => apiApp.fetch(c.req.raw, c.env));
  root.all('/api/*', (c) => apiApp.fetch(c.req.raw, c.env));

  const notFound = (c) => c.text('Não encontrado.', 404, { 'Cache-Control': 'no-store' });

  // A verificação feita em resolveFile protege o caminho pedido diretamente.
  // Um index.html descoberto depois (diretório ou rewrite SPA) também precisa
  // ser verificado: ele pode ser um link simbólico apontando para fora de publicDir.
  function safeIndex(candidate) {
    try {
      const real = fs.realpathSync(candidate);
      if (real !== publicReal && !real.startsWith(publicReal + path.sep)) return null;
      return fs.statSync(real).isFile() ? real : null;
    } catch { return null; }
  }

  /** Descobre o arquivo a servir para a URL (ou null). */
  function locate(rawPath) {
    const decoded = (() => { try { return decodeURIComponent(rawPath); } catch { return null; } })();
    if (decoded === null || isApiPath(decoded) || isApiPath(decoded.toLowerCase())) return null;
    const file = resolveFile(publicReal, rawPath);
    if (file === null) return null;
    const rel = path.relative(publicReal, file);
    const segs = rel.split(path.sep).filter(Boolean);
    const last = segs[segs.length - 1] || '';
    const isDir = (() => { try { return fs.statSync(file).isDirectory(); } catch { return false; } })();
    if (isDir) return safeIndex(path.join(file, 'index.html')); // sem listagem e sem links para fora da pasta
    try { if (fs.statSync(file).isFile()) return file; } catch { /* segue para as reescritas */ }
    if (path.extname(last)) return null;                                      // asset inexistente: 404 (nunca devolve HTML no lugar)
    const first = segs[0];
    if (first && SCREEN_DIRS.has(first)) {
      for (const cand of [path.join(publicReal, first, 'index.html'), path.join(publicReal, 'index.html')]) {
        const safe = safeIndex(cand);
        if (safe) return safe;
      }
    }
    return null;
  }

  const cspFor = (urlPath) => { const m = readCsp(); const k = urlPath.startsWith('/editor/') || urlPath === '/editor' ? '/editor/' : urlPath.startsWith('/visualizar/') || urlPath === '/visualizar' ? '/visualizar/' : null; return (k && m[k]) || m.default; };

  root.on(['GET', 'HEAD'], '*', async (c) => {
    const url = new URL(c.req.url);
    if (editorWithoutId(url.pathname)) return new Response(null, { status: 302, headers: { Location: '/acervo', 'Cache-Control': 'no-store' } });
    const file = locate(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!file) return notFound(c);
    const st = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const rel = '/' + path.relative(publicReal, file).split(path.sep).join('/');
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = new Headers({ 'Content-Type': type, 'Content-Length': String(st.size), ETag: etag });
    if (ext === '.html') {
      headers.set('Content-Security-Policy', cspFor(url.pathname));        // CSP depende da página PEDIDA (/editor/<id>), não do arquivo físico
      headers.set('Cache-Control', 'no-cache');
    } else {
      if (ext === '.svg') headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");   // SVG aberto direto não executa script
      headers.set('Cache-Control', (rel.startsWith('/assets/') || rel.startsWith('/js/')) && HASHED.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
    if (c.req.header('if-none-match') === etag) { headers.delete('Content-Length'); headers.delete('Content-Type'); return new Response(null, { status: 304, headers }); }
    if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
  });
  root.all('*', (c) => c.text('Método não permitido.', 405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }));
  root.notFound(notFound);
  return root;
}
