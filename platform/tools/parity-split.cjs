#!/usr/bin/env node
/* tools/parity-split.cjs — a PROVA DE PARIDADE (tools/parity.cjs) em N processos paralelos, mesmo resultado em ~1/N do tempo.
   1. a parte 0 monta o deck de prova (pelo caminho do usuário, em A) e compara os slides i % N === 0;
   2. assim que o deck existe, as outras partes o reaproveitam (--deck) e comparam as suas fatias (--part k/N, --no-final);
   3. uma parte que o cão de guarda derrubar (saída 3) é retomada com --resume (até 2 vezes);
   4. os progress.jsonl e as imagens de diff/ vão para <out> e um --resume único faz as camadas globais (catálogo, exportações HTML/PPTX)
      e o relatório — a identidade de cada registro (harness, A, B, deck, parâmetros) é conferida como em qualquer retomada.
   Uso: node tools/parity-split.cjs --a <A.html> --b <B.html> --out <pasta> [--quick] [--n 2] */
const { spawn } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const N = Math.max(1, Math.min(4, Number(args.n || 2))), OUT = path.resolve(args.out || '.tmp/parity/split'), H = path.join(__dirname, 'parity.cjs');
const base = ['--a', args.a, '--b', args.b].concat(args.quick ? ['--quick'] : []);
const log = (...m) => console.error(new Date().toISOString().slice(11, 19), '[split]', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(extra, tag) { return new Promise((res) => { const p = spawn(process.execPath, [H].concat(base, extra), { stdio: ['ignore', 'inherit', 'pipe'] });
  p.stderr.on('data', (d) => process.stderr.write(String(d).split('\n').filter(Boolean).map((l) => '[' + tag + '] ' + l + '\n').join(''))); p.on('exit', (c) => res(c)); }); }
async function part(k, deckDir) {
  const out = path.join(OUT, 'p' + k), ex = ['--out', out, '--part', k + '/' + N, '--no-final'].concat(deckDir ? ['--deck', deckDir] : []);
  let c = await run(ex, 'p' + k);
  for (let t = 0; c === 3 && t < 2; t++) { log('parte', k, 'retomada (cão de guarda)'); c = await run(['--out', out, '--part', k + '/' + N, '--no-final', '--resume'], 'p' + k); }
  if (c !== 0) throw new Error('parte ' + k + ' saiu com ' + c); return out;
}
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); const t0 = Date.now();
  const p0 = part(0, null), d0 = path.join(OUT, 'p0', 'deck-prova.json');
  while (!fs.existsSync(d0) || !fs.existsSync(path.join(OUT, 'p0', 'tags.json'))) await sleep(2000);
  log('deck de prova pronto; lançando as outras', N - 1, 'parte(s)');
  const outs = await Promise.all([p0].concat([...Array(N - 1).keys()].map((k) => part(k + 1, path.join(OUT, 'p0')))));
  fs.copyFileSync(d0, path.join(OUT, 'deck-prova.json')); fs.copyFileSync(path.join(OUT, 'p0', 'tags.json'), path.join(OUT, 'tags.json'));
  fs.mkdirSync(path.join(OUT, 'diff'), { recursive: true }); let lines = '';
  for (const o of outs) { lines += fs.readFileSync(path.join(o, 'progress.jsonl'), 'utf8'); for (const f of fs.readdirSync(path.join(o, 'diff'))) if (fs.statSync(path.join(o, 'diff', f)).isFile()) fs.copyFileSync(path.join(o, 'diff', f), path.join(OUT, 'diff', f)); }
  fs.writeFileSync(path.join(OUT, 'progress.jsonl'), lines);
  log('partes concluídas em', Math.round((Date.now() - t0) / 60000), 'min; juntando (--resume: camadas globais + relatório)');
  const c = await run(['--out', OUT, '--resume'], 'final'); log('total', Math.round((Date.now() - t0) / 60000), 'min, saída', c); process.exit(c);
})().catch((e) => { log('ERRO', e.message); process.exit(2); });
