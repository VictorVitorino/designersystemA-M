/* Preservação do editor (B2). Prova que o editor em nuvem NÃO alterou o editor atual e separa as duas garantias:
     1. studio/ e original/ ficam intactos (hash de todos os arquivos antes/depois do build; git sem diferenças);
     2. BUILD PUBLICADO: o build autônomo (python3 studio/assemble.py) é BYTE-IDÊNTICO ao build publicado na raiz (AM-Studio-Editor.html =
        Canteiro-AM.html, e = studio/AM-Studio-Editor.html quando existir) — cada etapa de studio/ publica o build que passou no portão
        (regra 5 do CLAUDE.md) e o build em nuvem segue esse build;
        ORIGINAL: original/Canteiro-AM (3).html é a cópia preservada do arquivo enviado (S34b) e confere com original/SHA256SUMS
        (ORIGINAL_SHA256 = dc93ceac…5099); ele NÃO precisa ser igual ao build atual;
     3. o build cloud = o autônomo + (os patches de patches.json) + (extensão de nuvem e script de boot): a diferença textual é só essa;
     4. cada patch precisa existir exatamente uma vez — se studio/ mudar, o build falha (testado com patches errados);
     5. o build cloud cabe no orçamento de 2000 KB do test-s90-perf;
     6. SEM window.AM_CLOUD o build cloud é o editor atual: roda o portão rápido de studio/ (test.js, test2.js, test-s34, test-s29)
        sobre uma cópia platform/.tmp/preserve com AM-Studio-Editor.html trocado pelo build cloud.
   Variáveis: PRESERVE_FULL=1 roda o portão COMPLETO (todas as baterias do qa-gate.sh, ~10 min) em vez do rápido.   Uso: node platform/tests/cloud/preservacao.test.js */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCloudEditor, verifyStandalone, originalSums, applyPatches, loadPatches, STUDIO, REPO, PLATFORM, ORIGINAL_SHA256, ORIGINAL_NAME, ORIGINAL_FILE, STANDALONE_CHECK, BOOT_JS } from '../../tools/build-cloud-editor.js';

const PRE = path.join(PLATFORM, '.tmp', 'preserve');
const results = []; let failed = 0, passed = 0;
function check(name, ok, info) { results.push((ok ? 'PASS ' : 'FAIL ') + name + (!ok && info !== undefined ? '  ' + JSON.stringify(info).slice(0, 600) : '')); if (ok) passed++; else { failed++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 600) : '')); } }
const sha = (b) => createHash('sha256').update(b).digest('hex');
function treeHash(dir, skip) {
  const out = {};
  (function walk(d) { for (const f of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name), rel = path.relative(dir, p); if (skip && skip.test(rel)) continue; if (f.isDirectory()) walk(p); else out[rel] = sha(readFileSync(p)); } })(dir);
  return out;
}
const SKIP = /^(shots|\.gate|qa|__pycache__)([\\/]|$)|saved[^\\/]*\.html$|[\\/]__pycache__[\\/]/;
const before = treeHash(STUDIO, SKIP), beforeOrig = treeHash(path.join(REPO, 'original'));

/* 2: build autônomo = build publicado na raiz (o original/ é conferido à parte, em PR-11/PR-11b) */
const v = verifyStandalone();
check('PR-01 build autônomo (python3 studio/assemble.py) é BYTE-IDÊNTICO ao build publicado na raiz (AM-Studio-Editor.html e Canteiro-AM.html): ' + v.built, !!v.built && v.built === v.published && v.built === v.canteiro, v);
const standalone = readFileSync(STANDALONE_CHECK, 'utf8');
const studioHtml = path.join(STUDIO, 'AM-Studio-Editor.html'), studioSha = existsSync(studioHtml) ? sha(readFileSync(studioHtml)) : null;
check('PR-02 AM-Studio-Editor.html e Canteiro-AM.html da raiz são o mesmo arquivo (sha256 ' + String(v.published).slice(0, 8) + '…)' + (studioSha ? ' e = studio/AM-Studio-Editor.html' : ' (studio/AM-Studio-Editor.html ausente: não comparado)'), !!v.published && v.published === v.canteiro && (studioSha === null || studioSha === v.published), { published: v.published, canteiro: v.canteiro, studio: studioSha });

/* 3: o que o cloud muda */
const cloud = buildCloudEditor();
const patches = loadPatches();
let expected = standalone;
for (const p of patches) { const n = expected.split(p.before).length - 1; if (n !== 1) { check('PR-03 patch ' + p.id + ' aparece exatamente 1× no HTML autônomo', false, n); } expected = expected.replace(p.before, () => p.after); }
let stripped = cloud.html;
stripped = stripped.replace(/<script id="am-ed-49-cloud-core">[\s\S]*?<\/script>\n/, '');
stripped = stripped.replace(/<script id="am-ed-50-cloud">[\s\S]*?<\/script>\n/, '');
stripped = stripped.replace(/\/\* ---- ed-50-cloud\.css ---- \*\/\n[\s\S]*?(?=\/\* ---- ed-colors\.css ---- \*\/)/, '');
stripped = stripped.replace(/<meta name="robots" content="noindex, nofollow">\n<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">\n<script id="am-cloud-boot">[\s\S]*?<\/script>\n<\/head>/, '</head>');
check('PR-03 build cloud − (extensão de nuvem: ed-49/ed-50 js+css, boot, meta/ícone) = build autônomo + os ' + patches.length + ' patches (igualdade exata de texto, ' + Math.round(expected.length / 1024) + ' KB)', stripped === expected, { lenStripped: stripped.length, lenExpected: expected.length, firstDiff: (() => { let i = 0; while (i < stripped.length && stripped[i] === expected[i]) i++; return { i, a: stripped.slice(i - 40, i + 80), b: expected.slice(i - 40, i + 80) }; })() });
check('PR-04 a lista de patches é curta e explícita: ' + patches.map((p) => p.id + '@' + p.file).join(', '), patches.length === 6 && patches.every((p) => p.before && p.after && p.why) && ['editor.js', 'ed-42-import.js', 'cover.js'].every((f) => patches.some((p) => p.file === f)));
const ADD = /\s?window\.dispatchEvent\(new CustomEvent\('am:(commit|load)'\)\);( \/\* nuvem: autosave \*\/)?/g;
check('PR-05 os patches a, b, c só ACRESCENTAM um dispatchEvent (tirando-o, "depois" = "antes"); os outros três trocam código: pdf.js (new Function → AM_PDFJS_IMPORT/import()), a capa (skip || AM_CLOUD) e o aviso de saída (&& !AM_CLOUD)', patches.filter((p) => !['d-pdfjs', 'e-cover', 'f-beforeunload'].includes(p.id)).every((p) => p.after.replace(ADD, '') === p.before) && patches.filter((p) => ['d-pdfjs', 'e-cover', 'f-beforeunload'].includes(p.id)).length === 3, patches.map((p) => [p.id, p.after.replace(ADD, '') === p.before]));
check('PR-06 sem "new Function(" no JS do editor em nuvem (a CSP não tem unsafe-eval; o padrão foi trocado por import() dinâmico)', !/new Function\(/.test(cloud.html), { nf: (cloud.html.match(/new Function\(/g) || []).length });
check('PR-07 orçamento de tamanho do test-s90-perf: build cloud ' + Math.round(cloud.bytes / 1024) + ' KB ≤ 2000 KB', Math.round(cloud.bytes / 1024) <= 2000, Math.round(cloud.bytes / 1024));

/* 4: patches errados falham em vez de gerar editor quebrado */
const T = path.join(PLATFORM, '.tmp', 'patch-neg'); rmSync(T, { recursive: true, force: true }); mkdirSync(T, { recursive: true });
cpSync(path.join(STUDIO, 'editor.js'), path.join(T, 'editor.js'));
let e0 = null, e2 = null;
try { applyPatches(T, [{ id: 'x-ausente', file: 'editor.js', before: 'TRECHO QUE NAO EXISTE', after: 'x' }]); } catch (e) { e0 = e.message; }
try { applyPatches(T, [{ id: 'x-duplicado', file: 'editor.js', before: 'var ', after: 'var ' }]); } catch (e) { e2 = e.message; }
check('PR-08 patch cujo trecho "antes" não existe → o build FALHA (' + (e0 || '').slice(0, 60) + '…)', /aparece 0× /.test(e0 || ''), e0);
check('PR-09 patch cujo trecho "antes" aparece mais de uma vez → o build FALHA', /aparece \d+× /.test(e2 || '') && !/aparece 1× /.test(e2 || ''), e2);
rmSync(T, { recursive: true, force: true });

/* 1 (depois do build): studio/ e original/ intactos */
const after = treeHash(STUDIO, SKIP), afterOrig = treeHash(path.join(REPO, 'original'));
const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
check('PR-10 studio/ intacto depois de construir o cloud e o autônomo (' + Object.keys(after).length + ' arquivos, hash antes = depois)', changed.length === 0, changed);
check('PR-11 original/ intacto (cópia preservada do upload S34b: hash de cada arquivo antes = depois)', JSON.stringify(beforeOrig) === JSON.stringify(afterOrig));
const origSha = existsSync(ORIGINAL_FILE) ? sha(readFileSync(ORIGINAL_FILE)) : null, sums = originalSums();
check('PR-11b original/' + ORIGINAL_NAME + ' confere com original/SHA256SUMS: sha256 ' + ORIGINAL_SHA256.slice(0, 8) + '…' + ORIGINAL_SHA256.slice(-4) + ' (não precisa ser igual ao build atual)', origSha === ORIGINAL_SHA256 && sums[ORIGINAL_NAME] === ORIGINAL_SHA256 && v.original === ORIGINAL_SHA256 && v.originalOk === true, { arquivo: origSha, sha256sums: sums[ORIGINAL_NAME] || null, verify: { original: v.original, originalOk: v.originalOk } });
const git = spawnSync('git', ['status', '--porcelain', '--', 'studio', 'original', 'AM-Studio-Editor.html', 'Canteiro-AM.html', 'am'], { cwd: REPO, encoding: 'utf8' });
check('PR-12 git: nenhuma alteração em studio/, original/, am/ nem nos HTML da raiz', git.status === 0 && git.stdout.trim() === '', git.stdout);

/* 6: portão de studio/ sobre o build cloud (modo inerte) */
rmSync(PRE, { recursive: true, force: true }); mkdirSync(path.join(PRE, 'studio'), { recursive: true });
cpSync(STUDIO, path.join(PRE, 'studio'), { recursive: true, filter: (s) => { const rel = path.relative(STUDIO, s); return !rel || !SKIP.test(rel) && !/inst[\\/]work/.test(rel); } });
cpSync(path.join(REPO, 'am'), path.join(PRE, 'am'), { recursive: true }); cpSync(path.join(REPO, 'fonts2'), path.join(PRE, 'fonts2'), { recursive: true });
writeFileSync(path.join(PRE, 'studio', 'AM-Studio-Editor.html'), cloud.html);
writeFileSync(path.join(PRE, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }) + '\n'); /* os testes de studio/ são CommonJS (require); sem isto herdariam o "type":"module" de platform/ */
let gate = readFileSync(path.join(PRE, 'studio', 'qa-gate.sh'), 'utf8');
const asm = 'python3 assemble.py || { echo "GATE FAIL: assemble"; exit 1; }';
check('PR-13 qa-gate.sh da cópia tem a linha de montagem que será desligada (o HTML sob teste é o build cloud)', gate.includes(asm));
gate = gate.replace(asm, 'echo "(montagem pulada: o HTML sob teste é o build cloud em modo inerte)"');
writeFileSync(path.join(PRE, 'studio', 'qa-gate.sh'), gate, { mode: 0o755 });
if (process.env.PRESERVE_SKIP_GATE === '1') { console.log('\n' + results.join('\n')); console.log('\nPASS ' + passed + ' · FAIL ' + failed + ' (portão pulado por PRESERVE_SKIP_GATE=1)'); process.exit(failed ? 1 : 0); }
const full = process.env.PRESERVE_FULL === '1';
const args = full ? ['qa-gate.sh'] : ['qa-gate.sh', 'quick', 'test-s34-institucional.js', 'test-s29-marca.js'];
console.log('rodando ' + (full ? 'o portão COMPLETO' : 'o portão rápido (test.js, test2.js, test-s34-institucional.js, test-s29-marca.js)') + ' sobre o build cloud sem AM_CLOUD… (alguns minutos)');
const t0 = Date.now();
const g = spawnSync('bash', args, { cwd: path.join(PRE, 'studio'), encoding: 'utf8', env: { ...process.env, PATH: '/opt/node22/bin:' + process.env.PATH }, timeout: full ? 3000000 : 900000, maxBuffer: 1 << 26 });
const out = (g.stdout || '') + (g.stderr || ''); writeFileSync(path.join(PRE, 'gate.log'), out);
const lines = out.split('\n').filter((l) => /^(PASS|FAIL|GATE|tempo)/.test(l));
console.log(lines.join('\n'));
check('PR-14 portão de studio/ ' + (full ? 'COMPLETO' : 'rápido (4 baterias)') + ' sobre o build cloud sem AM_CLOUD: GATE PASS (' + Math.round((Date.now() - t0) / 1000) + ' s)', g.status === 0 && /GATE PASS/.test(out), lines.slice(-8));
const nb = (out.match(/^PASS /gm) || []).length;
check('PR-15 baterias aprovadas: ' + nb + (full ? ' (esperado 39)' : ' (esperado 4)'), full ? nb >= 39 : nb === 4, nb); /* S35–S38: + test-s35-personagens.js, test-s36-estudio.js, test-s37-montagem.js, test-s38-acabamento.js */

console.log('\n' + results.join('\n'));
console.log('\nPASS ' + passed + ' · FAIL ' + failed);
process.exit(failed ? 1 : 0);
