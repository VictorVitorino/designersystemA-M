#!/bin/bash
# Portão de QA do Canteiro (v3, paralelo). Uso:
#   ./qa-gate.sh                 → monta e roda TODAS as baterias (JOBS=3; GATE_JOBS=n muda); com GATE PASS grava .gate/APROVADO
#                                  (sha256 do HTML, modo, nº de baterias), que o ./publish.sh exige
#   ./qa-gate.sh quick X.js …    → monta e roda só test.js, test2.js e as baterias dadas (iteração rápida)
#   ./qa-gate.sh affected [base] → monta e roda test.js, test2.js e as baterias ligadas aos arquivos alterados desde base (padrão: o último
#                                  commit que publicou ../AM-Studio-Editor.html), pelo mapa qa-map.txt; fora do mapa → portão completo
#   ./qa-gate.sh rerun           → repete só as reprovadas da última rodada, sem remontar (bateria sensível a carga); se a última rodada foi
#                                  o portão completo e o HTML não mudou, um rerun todo verde também grava .gate/APROVADO
# Quem decide é o código de saída de cada bateria: 0 = passou; qualquer outro reprova (124 = tempo esgotado).
cd "$(dirname "$0")" || exit 1
exec 9>"${TMPDIR:-/tmp}/canteiro-gate.lock"; flock -n 9 || { echo "GATE FAIL: outro portão em andamento nesta máquina"; exit 2; }
mkdir -p .gate; JOBS=${GATE_JOBS:-3}; mode=${1:-full}
all="test.js test2.js test-core.js test-cover.js $(ls test-s[0-9][0-9]*.js 2>/dev/null)"
sha(){ sha256sum AM-Studio-Editor.html | cut -d' ' -f1; }
case "$mode" in
  rerun)
    [ -f .gate/RODADA ] || { echo "GATE FAIL: nenhuma rodada anterior"; exit 1; }
    read -r pmode psha < .gate/RODADA; full_list=$(cat .gate/LISTA)
    list=$(for t in $full_list; do grep -q '^PASS' ".gate/$t.res" 2>/dev/null || echo "$t"; done)
    [ -n "$list" ] || { echo "nada reprovado na última rodada"; exit 0; }
    echo "rerun (sem montar): $(echo $list)" ;;
  quick) shift; python3 assemble.py || { echo "GATE FAIL: assemble"; exit 1; }; list="test.js test2.js $*"; full_list=$list ;;
  affected)
    base=${2:-$(git log -1 --format=%H -- ../AM-Studio-Editor.html)}
    list=$(python3 - "$base" "$all" <<'PY'
import sys, subprocess, fnmatch
base, allsuites = sys.argv[1], sys.argv[2].split()
git = lambda *a: subprocess.run(['git', *a], capture_output=True, text=True, check=True).stdout.split()
changed = sorted(set(git('diff', '--name-only', '--relative', base, '--', '.') + git('ls-files', '-o', '--exclude-standard', '--', '.')))
if git('diff', '--name-only', base, '--', '../am', '../fonts2'): print('ALL'); sys.exit()
rules = []
for ln in open('qa-map.txt', encoding='utf-8'):
    ln = ln.split('#', 1)[0] if ln.lstrip().startswith('#') else ln
    if ':' in ln: pats, suites = ln.split(':', 1); rules.append((pats.split(), suites.split()))
out = ['test.js', 'test2.js']
for f in changed:
    if f in allsuites: hit = [f]
    else:
        hit = None
        for pats, suites in rules:
            if any(fnmatch.fnmatch(f, p) for p in pats): hit = (hit or []) + suites
        if hit is None: sys.stderr.write('fora do mapa: %s → portão completo\n' % f); print('ALL'); sys.exit()
    out += [s for s in hit if s not in out]
print(' '.join(out))
PY
) || { echo "GATE FAIL: affected (base $base)"; exit 1; }
    echo "affected desde ${base:0:12}: $list"
    if [ "$list" = ALL ]; then mode=full; list=$all; fi
    python3 assemble.py || { echo "GATE FAIL: assemble"; exit 1; }; full_list=$list ;;
  full) python3 assemble.py || { echo "GATE FAIL: assemble"; exit 1; }; list=$all; full_list=$all ;;
  *) echo "uso: ./qa-gate.sh [quick X.js … | affected [base] | rerun]"; exit 1 ;;
esac
t0=$SECONDS
run1(){ local t=$1 s=$SECONDS code
  if [ ! -f "$t" ]; then echo "FAIL $t :: arquivo não encontrado" > ".gate/$t.res"; return; fi
  timeout 900 node "$t" > ".gate/$t.out" 2>&1; code=$?
  local last; last=$(tail -4 ".gate/$t.out" | tr '\n' ' ' | cut -c1-300)
  if [ $code -eq 0 ]; then echo "PASS $t ($((SECONDS-s)) s) :: $last" > ".gate/$t.res"
  else { echo "FAIL $t (saída $code, $((SECONDS-s)) s) :: $last"; grep -E '^FAIL|pageerror|ERRO' ".gate/$t.out" | head -20 | sed 's/^/    /'; } > ".gate/$t.res"; fi; }
export -f run1
rm -f .gate/APROVADO
if [ "$mode" = rerun ]; then for t in $list; do rm -f ".gate/$t.res" ".gate/$t.out"; done
else rm -f .gate/*.res .gate/*.out; echo "$mode $(sha)" > .gate/RODADA; echo $full_list > .gate/LISTA; fi
printf '%s\n' $list | xargs -P "$JOBS" -I{} bash -c 'run1 {}' 9>&-
[ "$mode" = rerun ] || [ "$(sha)" = "$(cut -d' ' -f2 .gate/RODADA)" ] || { echo "GATE FAIL: o HTML mudou durante o portão (alguém remontou?)"; exit 1; }
fail=0; n=0; for t in $full_list; do cat ".gate/$t.res" 2>/dev/null || { echo "FAIL $t :: sem resultado"; fail=1; }; if grep -q '^PASS' ".gate/$t.res" 2>/dev/null; then n=$((n+1)); else fail=1; fi; done
echo "tempo total: $((SECONDS-t0)) s (jobs=$JOBS, modo $mode)"
[ $fail -eq 0 ] || { echo "GATE FAIL"; exit 1; }
if [ "$mode" = full ] || { [ "$mode" = rerun ] && [ "$pmode" = full ] && [ "$psha" = "$(sha)" ]; }; then
  echo "$(sha) $([ "$mode" = rerun ] && echo full+rerun || echo full) $n" > .gate/APROVADO; echo "aprovado para publicar: $(cut -c1-16 .gate/APROVADO)… ($n baterias)"; fi
echo "GATE PASS"
