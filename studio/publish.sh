#!/bin/bash
# Publica exatamente o build aprovado pelo portão completo (passo 5 do CLAUDE.md): confere o sha de .gate/APROVADO, copia o HTML para a raiz
# (AM-Studio-Editor.html = Canteiro-AM.html) e regenera/confere a plataforma (vercel.json com os hashes da CSP; build autônomo = publicado).
# Depois: commit e, em série, platform/tests/cloud/preservacao.test.js e npm run test:parity:quick.
cd "$(dirname "$0")" || exit 1
[ -f .gate/APROVADO ] || { echo "PUBLISH FAIL: sem .gate/APROVADO (rode ./qa-gate.sh completo)"; exit 1; }
read -r sha mode n < .gate/APROVADO; cur=$(sha256sum AM-Studio-Editor.html | cut -d' ' -f1)
[ "$sha" = "$cur" ] || { echo "PUBLISH FAIL: o HTML mudou depois do portão (${cur:0:12} ≠ ${sha:0:12}); rode o portão de novo"; exit 1; }
case "$mode" in full|full+rerun) ;; *) echo "PUBLISH FAIL: o APROVADO não é de portão completo ($mode)"; exit 1 ;; esac
exp=$((4 + $(ls test-s[0-9][0-9]*.js | wc -l))); [ "$n" -ge "$exp" ] || { echo "PUBLISH FAIL: $n baterias aprovadas, esperado $exp"; exit 1; }
cp AM-Studio-Editor.html ../AM-Studio-Editor.html && cp AM-Studio-Editor.html ../Canteiro-AM.html || { echo "PUBLISH FAIL: cópia"; exit 1; }
cd ../platform && node tools/build-web.js && node tools/build-web.js --check && node tools/build-cloud-editor.js --verify-standalone > /dev/null || { echo "PUBLISH FAIL: plataforma"; exit 1; }
echo "PUBLICADO ${sha:0:16}… ($n baterias, $mode): raiz + vercel.json; agora commit, preservacao.test.js e test:parity:quick"
