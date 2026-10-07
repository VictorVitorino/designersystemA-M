/* Build do site (Vercel e local).  Uso:
     node tools/build-web.js            monta platform/dist/public + dist/csp.json e GRAVA platform/vercel.json
     node tools/build-web.js --check    não grava nada: falha (exit 1) se vercel.json estiver desatualizado em relação ao build (use no CI)
   dist/public = web/ (páginas, B1) + /js/cloud-core.js + /editor/index.html e /visualizar/index.html (o MESMO editor em nuvem; o boot lê o
   caminho) + /vendor/pdfjs-4.10.38/ + /assets/brand/* + /favicon.svg.  Requer python3 (studio/assemble.py) e a pasta studio/ do repositório
   (na Vercel: habilitar "Include source files outside of the Root Directory in the Build Step"). */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCloudEditor, PLATFORM, REPO, STUDIO, CLOUD_SRC, PDFJS_BASE } from './build-cloud-editor.js';
import { buildCspJson, inlineScriptHashes, SECURITY_HEADERS } from './csp.js';

const DIST = path.join(PLATFORM, 'dist'), PUB = path.join(DIST, 'public');
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#002A46"/><path d="M45 21a17 17 0 1 0 0 22" fill="none" stroke="#F78C16" stroke-width="7" stroke-linecap="round"/></svg>\n';
const CACHE = {
  immutable: 'public, max-age=31536000, immutable',   /* /vendor/pdfjs-4.10.38/: a versão está no caminho */
  assets: 'public, max-age=86400, stale-while-revalidate=604800',
  revalidate: 'public, max-age=0, must-revalidate'    /* /js: nome estável, sempre revalida (ETag) */
};

/** pdf.js 4.x só vem como módulo ES (.mjs). Sob CSP com 'strict-dynamic' o Chromium recusa import()/<script type=module> vindos de script autorizado por hash;
 *  <script> clássico criado por esse script é aceito. Por isso o build gera, SEM tocar em studio/vendor, uma versão clássica do mesmo arquivo:
 *  o `export{…}` final vira atribuição a globalThis.__am_pdfjs e o único import.meta.url (ramo de Node) vira location.href. A sintaxe é conferida aqui. */
export function pdfjsClassic(src) {
  const m = /export\{([^{}]+)\};?\s*$/.exec(src);
  if (!m) throw new Error('pdf.min.mjs: export{…} final não encontrado (pdf.js mudou?)');
  const map = m[1].split(',').map((p) => { const [a, b] = p.split(' as ').map((x) => x.trim()); return (b || a) + ':' + a; }).join(',');
  let out = src.slice(0, m.index) + 'globalThis.__am_pdfjs={' + map + '};\n';
  const metas = out.split('import.meta').length - 1;
  if (metas !== 1) throw new Error('pdf.min.mjs: esperado 1 import.meta, achei ' + metas);
  out = '(function(){"use strict";\n' + out.replace('import.meta.url', 'location.href') + '\n})();\n'; /* escopo de função: os nomes minificados não colidem com globais; "use strict" como no módulo */
  new vm.Script(out, { filename: 'pdf.classic.js' }); /* lança SyntaxError se sobrar import/export estático ou await no topo */
  return '/* gerado por tools/build-web.js a partir de pdf.min.mjs (4.10.38): versão clássica para CSP com strict-dynamic */\n' + out;
}

/** id de apresentação nas rotas do editor (o boot do editor só liga a nuvem com um UUID; sem ele o HTML seria o editor original, fora da nuvem) */
export const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export function vercelConfig(csp) {
  const h = (obj) => Object.entries(obj).map(([key, value]) => ({ key, value }));
  const sec = { ...SECURITY_HEADERS, 'X-Robots-Tag': 'noindex, nofollow' };
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    version: 2,
    framework: null,
    buildCommand: 'node tools/build-web.js',
    outputDirectory: 'dist/public',
    cleanUrls: true,
    functions: { 'api/index.js': { maxDuration: 60, memory: 1024 } },
    regions: ['gru1'],
    /* /editor e /visualizar sem o UUID de uma apresentação (/editor/, /editor/abc, /editor/index.html) → acervo (mesma regra de src/static.js) */
    redirects: [
      { source: '/(editor|visualizar)', destination: '/acervo', permanent: false },
      { source: `/(editor|visualizar)/((?!${UUID_SRC}/?$).*)`, destination: '/acervo', permanent: false }
    ],
    rewrites: [
      { source: '/api/(.*)', destination: '/api' },
      { source: `/editor/:id(${UUID_SRC})`, destination: '/editor/index.html' },
      { source: `/visualizar/:id(${UUID_SRC})`, destination: '/visualizar/index.html' }
    ],
    headers: [
      { source: '/((?!api/|editor/|visualizar/).*)', headers: h({ 'Content-Security-Policy': csp.default, ...sec }) },
      { source: '/editor/(.*)', headers: h({ 'Content-Security-Policy': csp['/editor/'], ...sec }) },
      { source: '/visualizar/(.*)', headers: h({ 'Content-Security-Policy': csp['/visualizar/'], ...sec }) },
      { source: '/api/(.*)', headers: h({ 'Strict-Transport-Security': SECURITY_HEADERS['Strict-Transport-Security'], 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' }) },
      { source: '/vendor/(.*)', headers: h({ 'Cache-Control': CACHE.immutable }) },
      { source: '/assets/(.*)', headers: h({ 'Cache-Control': CACHE.assets }) },
      { source: '/js/(.*)', headers: h({ 'Cache-Control': CACHE.revalidate }) }
    ]
  };
}

export function buildWeb({ write = true } = {}) {
  const ed = buildCloudEditor();
  const csp = buildCspJson(ed.html), vercel = vercelConfig(csp);
  const vercelText = JSON.stringify(vercel, null, 2) + '\n', cspText = JSON.stringify(csp, null, 2) + '\n';
  const info = { editorBytes: ed.bytes, editorSha256: ed.sha256, inlineScriptHashes: inlineScriptHashes(ed.html).length, patches: ed.patches.map((p) => p.id), vercelSha256: createHash('sha256').update(vercelText).digest('hex') };
  if (!write) return { ...info, vercelText, cspText };
  rmSync(DIST, { recursive: true, force: true }); mkdirSync(PUB, { recursive: true });
  const web = path.join(PLATFORM, 'web');
  if (existsSync(web)) cpSync(web, PUB, { recursive: true, filter: (s) => !/[\\/]\.(gitkeep|DS_Store)$/.test(s) });
  mkdirSync(path.join(PUB, 'js'), { recursive: true }); cpSync(path.join(CLOUD_SRC, 'cloud-core.js'), path.join(PUB, 'js', 'cloud-core.js'));
  for (const d of ['editor', 'visualizar']) { mkdirSync(path.join(PUB, d), { recursive: true }); writeFileSync(path.join(PUB, d, 'index.html'), ed.html); }
  cpSync(path.join(STUDIO, 'vendor', 'pdfjs-4.10.38'), path.join(PUB, 'vendor', 'pdfjs-4.10.38'), { recursive: true });
  writeFileSync(path.join(PUB, 'vendor', 'pdfjs-4.10.38', 'pdf.classic.js'), pdfjsClassic(readFileSync(path.join(STUDIO, 'vendor', 'pdfjs-4.10.38', 'pdf.min.mjs'), 'utf8')));
  mkdirSync(path.join(PUB, 'assets', 'brand'), { recursive: true });
  for (const f of readdirSync(path.join(REPO, 'am', 'brand'))) if (/\.(png|svg)$/i.test(f)) cpSync(path.join(REPO, 'am', 'brand', f), path.join(PUB, 'assets', 'brand', f));
  if (!existsSync(path.join(PUB, 'favicon.svg'))) writeFileSync(path.join(PUB, 'favicon.svg'), FAVICON);
  writeFileSync(path.join(DIST, 'csp.json'), cspText);
  writeFileSync(path.join(PLATFORM, 'vercel.json'), vercelText);
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const r = buildWeb({ write: false }), cur = existsSync(path.join(PLATFORM, 'vercel.json')) ? readFileSync(path.join(PLATFORM, 'vercel.json'), 'utf8') : '';
      if (cur !== r.vercelText) { console.error('vercel.json DESATUALIZADO: rode "node tools/build-web.js" e faça commit (a CSP do editor leva o hash dos scripts inline).'); process.exit(1); }
      console.log('vercel.json confere com o build (' + r.inlineScriptHashes + ' hashes de script inline).');
    } else {
      const r = buildWeb();
      console.log(`site: ${PUB}\neditor: ${Math.round(r.editorBytes / 1024)} KB · sha256 ${r.editorSha256} · ${r.inlineScriptHashes} scripts inline com hash na CSP\npatches: ${r.patches.join(', ')}\nvercel.json atualizado (${r.vercelSha256.slice(0, 12)})`);
    }
  } catch (e) { console.error('FALHOU: ' + e.message); process.exit(1); }
}
