/* Build do editor em nuvem (B2).  Uso:
     node tools/build-cloud-editor.js [--out arquivo.html] [--verify-standalone]
   O editor original (studio/) NUNCA é alterado: o build copia as fontes para platform/.tmp/cloud-build, acrescenta a extensão de nuvem
   (ed-49-cloud-core.js, ed-50-cloud.js/.css), aplica a lista curta de patches de studio-cloud/patches.json (cada 'antes' precisa existir
   EXATAMENTE UMA VEZ; senão o build falha) e roda o assemble.py da cópia. Sem window.AM_CLOUD o resultado se comporta como o editor original.
   --verify-standalone: monta o editor autônomo a partir de studio/ (python3 studio/assemble.py <saída fora de studio/>) e compara o SHA-256
   com o original preservado. */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PLATFORM = path.resolve(here, '..');
export const REPO = path.resolve(PLATFORM, '..');
export const STUDIO = path.join(REPO, 'studio');
export const CLOUD_SRC = path.join(PLATFORM, 'studio-cloud');
export const BUILD_DIR = path.join(PLATFORM, '.tmp', 'cloud-build');
export const STANDALONE_SHA256 = 'dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099';
export const PDFJS_BASE = '/vendor/pdfjs-4.10.38/';

/** Script de boot (inline, com hash na CSP): lê o caminho e define window.AM_CLOUD. Fora de /editor/<uuid> e /visualizar/<uuid> não faz nada. */
export const BOOT_JS = "(function(){try{var m=/^\\/(editor|visualizar)\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\/?$/i.exec(location.pathname);if(!m)return;var c=window.AM_CLOUD={apiBase:'/api',presentationId:m[2].toLowerCase(),mode:m[1]==='editor'?'edit':'view',pdfjsBase:'" + PDFJS_BASE + "'};window.AM_PDFJS=c.pdfjsBase;document.documentElement.classList.add('am-cloud','am-cloud-'+c.mode);}catch(e){}})();";

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const WANT = /^(assemble\.py|editor\.(html|js)|runtime\.(js|css)|rt-.*\.(js|css)|ed-.*\.(js|css)|cover\.(html|css|js)|history\.js|xedit\.js)$/;

export function loadPatches() { return JSON.parse(readFileSync(path.join(CLOUD_SRC, 'patches.json'), 'utf8')).patches; }

function countOf(text, needle) { let n = 0, i = -1; while ((i = text.indexOf(needle, i + 1)) >= 0) n++; return n; }

/** Aplica os patches nos arquivos da cópia; cada 'antes' tem de ocorrer exatamente uma vez. */
export function applyPatches(dir, patches) {
  const applied = [];
  for (const p of patches) {
    const f = path.join(dir, p.file);
    if (!existsSync(f)) throw new Error(`patch ${p.id}: arquivo ${p.file} não existe em studio/`);
    const src = readFileSync(f, 'utf8'), n = countOf(src, p.before);
    if (n !== 1) throw new Error(`patch ${p.id}: o trecho "antes" aparece ${n}× em ${p.file} (precisa ser exatamente 1). O editor em studio/ mudou — revise studio-cloud/patches.json.`);
    writeFileSync(f, src.replace(p.before, () => p.after));
    applied.push({ id: p.id, file: p.file });
  }
  return applied;
}

function python() { for (const c of ['python3', 'python']) { const r = spawnSync(c, ['--version']); if (r.status === 0) return c; } throw new Error('python3 não encontrado (necessário para studio/assemble.py)'); }

export function buildCloudEditor({ outFile } = {}) {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  const sd = path.join(BUILD_DIR, 'studio'); mkdirSync(sd, { recursive: true });
  for (const f of readdirSync(STUDIO)) if (WANT.test(f)) cpSync(path.join(STUDIO, f), path.join(sd, f));
  cpSync(path.join(STUDIO, 'inst'), path.join(sd, 'inst'), { recursive: true, filter: (s) => !/[\\/]inst[\\/]work([\\/]|$)/.test(s) });
  cpSync(path.join(REPO, 'am', 'brand'), path.join(BUILD_DIR, 'am', 'brand'), { recursive: true });
  writeFileSync(path.join(BUILD_DIR, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }) + '\n'); /* assemble.py roda node --check nos ed-*.js: como script clássico */
  for (const f of ['ed-49-cloud-core.js', 'ed-50-cloud.js', 'ed-50-cloud.css']) if (existsSync(path.join(sd, f))) throw new Error(`studio/ já tem ${f}: conflito de nome com a extensão de nuvem`);
  const applied = applyPatches(sd, loadPatches());
  cpSync(path.join(CLOUD_SRC, 'cloud-core.js'), path.join(sd, 'ed-49-cloud-core.js'));
  cpSync(path.join(CLOUD_SRC, 'ed-50-cloud.js'), path.join(sd, 'ed-50-cloud.js'));
  cpSync(path.join(CLOUD_SRC, 'ed-50-cloud.css'), path.join(sd, 'ed-50-cloud.css'));
  const r = spawnSync(python(), ['assemble.py', 'AM-Studio-Editor.html'], { cwd: sd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('assemble.py falhou na cópia:\n' + r.stdout + r.stderr);
  let html = readFileSync(path.join(sd, 'AM-Studio-Editor.html'), 'utf8');
  if (countOf(html, '</head>') < 1) throw new Error('editor montado sem </head>');
  html = html.replace('</head>', () => '<meta name="robots" content="noindex, nofollow">\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<script id="am-cloud-boot">' + BOOT_JS + '</script>\n</head>');
  const out = outFile || path.join(BUILD_DIR, 'cloud-editor.html');
  mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, html);
  return { html, file: out, bytes: Buffer.byteLength(html), sha256: sha256(html), patches: applied, assemble: r.stdout.trim() };
}

/** Monta o editor autônomo a partir de studio/ sem escrever dentro de studio/ e compara com o original preservado. */
export function verifyStandalone() {
  const out = path.join(PLATFORM, '.tmp', 'standalone-check.html'); mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(python(), ['assemble.py', out], { cwd: STUDIO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('assemble.py (studio/) falhou:\n' + r.stdout + r.stderr);
  const built = sha256(readFileSync(out));
  const orig = path.join(REPO, 'original', 'Canteiro-AM (3).html');
  const origSha = existsSync(orig) ? sha256(readFileSync(orig)) : null;
  return { built, expected: STANDALONE_SHA256, original: origSha, ok: built === STANDALONE_SHA256 && (origSha === null || origSha === built) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), oi = a.indexOf('--out');
  try {
    if (a.includes('--verify-standalone')) { const v = verifyStandalone(); console.log(JSON.stringify(v, null, 1)); if (!v.ok) process.exit(1); }
    const b = buildCloudEditor({ outFile: oi >= 0 ? path.resolve(a[oi + 1]) : undefined });
    console.log(`editor em nuvem: ${b.file} · ${Math.round(b.bytes / 1024)} KB · sha256 ${b.sha256}\npatches: ${b.patches.map((p) => p.id).join(', ')}\n${b.assemble}`);
  } catch (e) { console.error('FALHOU: ' + e.message); process.exit(1); }
}
