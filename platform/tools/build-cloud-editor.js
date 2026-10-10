/* Build do editor em nuvem (B2).  Uso:
     node tools/build-cloud-editor.js [--out arquivo.html] [--verify-standalone]
   O editor (studio/) NUNCA é alterado pela plataforma: o build copia as fontes para platform/.tmp/cloud-build, acrescenta a extensão de nuvem
   (ed-49-cloud-core.js, ed-50-cloud.js/.css), aplica a lista curta de patches de studio-cloud/patches.json (cada 'antes' precisa existir
   EXATAMENTE UMA VEZ; senão o build falha) e roda o assemble.py da cópia. Sem window.AM_CLOUD o resultado se comporta como o editor autônomo.
   --verify-standalone: monta o editor autônomo a partir de studio/ (python3 studio/assemble.py <saída em platform/.tmp>) e confere as duas
   garantias, separadas:
     1. BUILD PUBLICADO: o autônomo montado agora é byte-idêntico ao build publicado na raiz do repositório (AM-Studio-Editor.html e
        Canteiro-AM.html; regra 5 do processo de studio/ no CLAUDE.md: cada etapa publica exatamente o build que passou no portão).
        O build em nuvem segue esse build — não o original/.
     2. ORIGINAL: original/Canteiro-AM (3).html é a cópia preservada do arquivo enviado (S34b) e continua conferindo com original/SHA256SUMS
        (ORIGINAL_SHA256). Não precisa ser igual ao build atual: studio/ evolui, o original não. */
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
/** SHA-256 da cópia preservada do arquivo enviado (S34b), original/Canteiro-AM (3).html — o mesmo de original/SHA256SUMS. Não é o pino do build atual. */
export const ORIGINAL_SHA256 = 'dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099';
export const ORIGINAL_NAME = 'Canteiro-AM (3).html';
export const ORIGINAL_FILE = path.join(REPO, 'original', ORIGINAL_NAME);
export const ORIGINAL_SUMS = path.join(REPO, 'original', 'SHA256SUMS');
/** Build autônomo publicado na raiz (o que a última etapa de studio/ copiou depois do portão) — os dois arquivos têm de ser o mesmo build. */
export const PUBLISHED_FILE = path.join(REPO, 'AM-Studio-Editor.html');
export const PUBLISHED_CANTEIRO = path.join(REPO, 'Canteiro-AM.html');
/** Onde --verify-standalone grava o autônomo montado agora (fora de studio/). */
export const STANDALONE_CHECK = path.join(PLATFORM, '.tmp', 'standalone-check.html');
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

const shaOf = (f) => existsSync(f) ? sha256(readFileSync(f)) : null;

/** Lê original/SHA256SUMS ("<sha256>  <nome>" por linha) → { nome: sha256 }. Sem o arquivo: {}. */
export function originalSums() {
  if (!existsSync(ORIGINAL_SUMS)) return {};
  const out = {};
  for (const line of readFileSync(ORIGINAL_SUMS, 'utf8').split('\n')) { const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim()); if (m) out[m[2]] = m[1]; }
  return out;
}

/** Monta o editor autônomo a partir de studio/ sem escrever dentro de studio/ e confere as duas garantias:
    built     = SHA-256 do autônomo montado agora (STANDALONE_CHECK);
    published = SHA-256 de AM-Studio-Editor.html da raiz; canteiro = SHA-256 de Canteiro-AM.html da raiz (null = arquivo ausente);
    original  = SHA-256 de original/Canteiro-AM (3).html (null = pasta ausente, como na imagem Docker, que não leva original/);
    originalOk = original confere com ORIGINAL_SHA256 e com a linha de original/SHA256SUMS (null = original/ ausente, não conferido);
    ok        = built = published = canteiro E original não divergente (originalOk !== false). O original NÃO precisa ser igual ao build. */
export function verifyStandalone() {
  mkdirSync(path.dirname(STANDALONE_CHECK), { recursive: true });
  const r = spawnSync(python(), ['assemble.py', STANDALONE_CHECK], { cwd: STUDIO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('assemble.py (studio/) falhou:\n' + r.stdout + r.stderr);
  const built = sha256(readFileSync(STANDALONE_CHECK));
  const published = shaOf(PUBLISHED_FILE), canteiro = shaOf(PUBLISHED_CANTEIRO), original = shaOf(ORIGINAL_FILE);
  const originalOk = original === null ? null : original === ORIGINAL_SHA256 && originalSums()[ORIGINAL_NAME] === ORIGINAL_SHA256;
  return { built, published, canteiro, original, originalOk, ok: built === published && built === canteiro && originalOk !== false };
}

/** Texto legível do resultado de verifyStandalone() (usado pelo --verify-standalone). */
export function describeStandalone(v) {
  const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
  const cmp = (x) => x === null ? 'AUSENTE' : x === v.built ? 'igual ao build' : 'DIFERENTE do build';
  const lines = [
    'build autônomo (python3 studio/assemble.py → ' + rel(STANDALONE_CHECK) + '): ' + v.built,
    'build publicado na raiz:',
    '  ' + rel(PUBLISHED_FILE) + ': ' + (v.published || '—') + '  [' + cmp(v.published) + ']',
    '  ' + rel(PUBLISHED_CANTEIRO) + ':      ' + (v.canteiro || '—') + '  [' + cmp(v.canteiro) + ']',
    'original preservado (upload S34b, conferido com original/SHA256SUMS ' + ORIGINAL_SHA256.slice(0, 8) + '…' + ORIGINAL_SHA256.slice(-4) + '):',
    '  ' + rel(ORIGINAL_FILE) + ': ' + (v.original || '—') + '  [' + (v.originalOk === null ? 'ausente: não conferido' : v.originalOk ? 'confere' : 'NÃO CONFERE') + ']',
    v.ok ? 'OK: o build autônomo de studio/ é o build publicado na raiz; original/ preservado.'
      : 'FALHOU: ' + [v.built === v.published && v.built === v.canteiro ? null : 'o build publicado na raiz não é o build atual de studio/ (passe o portão de studio/ e publique: copie studio/AM-Studio-Editor.html para AM-Studio-Editor.html e Canteiro-AM.html — regra 5 do CLAUDE.md)',
        v.originalOk === false ? 'original/ não confere com original/SHA256SUMS (a cópia do upload foi alterada: restaure-a do git)' : null].filter(Boolean).join('; '),
  ];
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), oi = a.indexOf('--out');
  try {
    if (a.includes('--verify-standalone')) { const v = verifyStandalone(); console.log(describeStandalone(v)); if (!v.ok) process.exit(1); }
    const b = buildCloudEditor({ outFile: oi >= 0 ? path.resolve(a[oi + 1]) : undefined });
    console.log(`editor em nuvem: ${b.file} · ${Math.round(b.bytes / 1024)} KB · sha256 ${b.sha256}\npatches: ${b.patches.map((p) => p.id).join(', ')}\n${b.assemble}`);
  } catch (e) { console.error('FALHOU: ' + e.message); process.exit(1); }
}
