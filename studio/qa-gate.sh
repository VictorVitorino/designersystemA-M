#!/bin/bash
# Portão de QA do Canteiro (v2, paralelo). Uso:
#   ./qa-gate.sh            → monta e roda TODAS as baterias (JOBS=3 em paralelo; GATE_JOBS=n para mudar)
#   ./qa-gate.sh quick X.js → monta e roda só test.js, test2.js e X.js (iteração rápida do construtor)
# Quem decide é o código de saída de cada bateria: 0 = passou; qualquer outro reprova (124 = tempo esgotado).
cd "$(dirname "$0")" || exit 1
python3 assemble.py || { echo "GATE FAIL: assemble"; exit 1; }
t0=$SECONDS; JOBS=${GATE_JOBS:-3}; mkdir -p .gate
if [ "$1" = "quick" ]; then shift; list="test.js test2.js $*"; JOBS=3
else list="test.js test2.js test-core.js test-cover.js $(ls test-s[0-9][0-9]*.js 2>/dev/null)"; fi
run1(){ local t=$1 s=$SECONDS code
  if [ ! -f "$t" ]; then echo "FAIL $t :: arquivo não encontrado" > ".gate/$t.res"; return; fi
  timeout 900 node "$t" > ".gate/$t.out" 2>&1; code=$?
  local last; last=$(tail -4 ".gate/$t.out" | tr '\n' ' ' | cut -c1-300)
  if [ $code -eq 0 ]; then echo "PASS $t ($((SECONDS-s)) s) :: $last" > ".gate/$t.res"
  else { echo "FAIL $t (saída $code, $((SECONDS-s)) s) :: $last"; grep -E '^FAIL|pageerror|ERRO' ".gate/$t.out" | head -20 | sed 's/^/    /'; } > ".gate/$t.res"; fi; }
export -f run1
rm -f .gate/*.res .gate/*.out
printf '%s\n' $list | xargs -P "$JOBS" -I{} bash -c 'run1 {}'
fail=0; for t in $list; do cat ".gate/$t.res" 2>/dev/null || { echo "FAIL $t :: sem resultado"; fail=1; }; grep -q '^PASS' ".gate/$t.res" 2>/dev/null || fail=1; done
echo "tempo total: $((SECONDS-t0)) s (jobs=$JOBS)"
[ $fail -eq 0 ] && echo "GATE PASS" || { echo "GATE FAIL"; exit 1; }
