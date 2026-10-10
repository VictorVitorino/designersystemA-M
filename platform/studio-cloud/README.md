# studio-cloud — extensão de nuvem do editor Canteiro

O editor (`studio/`) é um arquivo HTML único montado por `studio/assemble.py`. **Esta pasta não altera `studio/`**: o build cloud copia as
fontes para `platform/.tmp/cloud-build`, acrescenta a extensão daqui, aplica uma lista curta de patches de texto e roda o `assemble.py` da cópia.
Sem `window.AM_CLOUD` o resultado se comporta como o editor autônomo (modo inerte) — é assim que o portão de 38 baterias de `studio/` prova a preservação.

## Original × build publicado (duas garantias separadas)

- **`original/`** = a cópia preservada do arquivo enviado (S34b): `original/Canteiro-AM (3).html`, conferida contra `original/SHA256SUMS`
  (`ORIGINAL_SHA256` = `dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099` em `tools/build-cloud-editor.js`). Não muda nunca e **não** precisa
  ser igual ao build atual.
- **Build publicado** = `AM-Studio-Editor.html` e `Canteiro-AM.html` na raiz do repositório. Cada etapa de `studio/` atualiza os dois depois do portão
  (`./qa-gate.sh` → `GATE PASS`; regra 5 do processo no `CLAUDE.md`). O build autônomo (`python3 studio/assemble.py`) tem de ser **byte-idêntico** a ele,
  e o build em nuvem e a prova de paridade (`npm run test:parity`, lado A = `../AM-Studio-Editor.html`) seguem esse build — não o `original/`.
- Uma etapa nova em `studio/` não quebra a plataforma por mudar o SHA-256: basta passar o portão, publicar o build na raiz e rodar de novo
  `--verify-standalone`, `tests/cloud/preservacao.test.js` e a paridade. Se o build publicado ficar para trás, `--verify-standalone` falha e diz o que fazer.
- Build autônomo publicado hoje (S38): sha256 `631ad7213fb7b63f93b25c22394f11cd64dfbbeba480ae64d7b59d472e1ecb04`; build em nuvem: 1770 KB pelo PR-07 (orçamento 2000 KB; ~230 KB de folga desde a montagem sem comentários).

| Arquivo | Para quê |
|---|---|
| `cloud-core.js` | Módulo isomórfico (navegador e Node 22, sem dependências): `window.AMCloudCore`. Hash, JSON canônico, desenhar em PNG as imagens que o servidor não guarda (SVG, BMP, AVIF, ICO…), trocar imagens `data:` por `asset:sha256:…` e vice-versa, ler `.html`/acervo exportados. Usado pelas páginas (B1, inclusive `/importar`), pela extensão e por ferramentas Node. |
| `ed-50-cloud.js` / `ed-50-cloud.css` | A extensão em si (login por cookie, carregar/hidratar, autosave, fila local, conflito, conteúdo recusado, histórico, Novo/Abrir/projetos prontos na nuvem, parâmetros `?modelo`/`?historico`/`?exportar`, comentários, preferências, computador compartilhado, visualizar, interações, pílula de estado). Entra no editor como `ed-50-*` (o `assemble.py` inclui qualquer `ed-*.js/.css`). O build cloud tem de caber no orçamento de 2000 KB do `test-s90-perf`. |
| `patches.json` | Os **6 patches** de texto (cada `antes` precisa existir exatamente 1× — senão o build falha). |
| `package.json` | Marca a pasta como CommonJS para `cloud-core.js` carregar como script clássico **e** em Node (`import cc from '…/cloud-core.js'`). |

## Construir

```bash
cd platform
node tools/build-cloud-editor.js                 # só o editor  → .tmp/cloud-build/cloud-editor.html
node tools/build-cloud-editor.js --verify-standalone   # + prova que o autônomo de studio/ = o build publicado na raiz (AM-Studio-Editor.html e
                                                       #   Canteiro-AM.html) e que original/ confere com original/SHA256SUMS
node tools/build-web.js                          # o site inteiro → dist/public, dist/csp.json e vercel.json
node tools/build-web.js --check                  # CI: falha se vercel.json (CSP com hashes) estiver desatualizado
```

Requer `python3` (o `assemble.py`) e Node 22. Na Vercel: o build precisa enxergar `../studio` e `../am` — ligue
*Settings › General › "Include source files outside of the Root Directory in the Build Step"*.

## Os patches (studio-cloud/patches.json)

| id | arquivo | o que faz | sem `AM_CLOUD` |
|---|---|---|---|
| `a-commit` | editor.js | `commit()` dispara `am:commit` | evento sem ouvinte |
| `b-undo-redo` | editor.js | `restore()` (desfazer/refazer) dispara `am:commit` | idem |
| `c-load` | editor.js | `loadDeck()` dispara `am:load` (Abrir…, Novo, importar-substituir, modelos) | idem |
| `d-pdfjs` | ed-42-import.js | `new Function(…import…)` (proibido pela CSP) → `AM_PDFJS_IMPORT` ou `import()` | `import()` comum |
| `e-cover` | cover.js | não abre a capa quando `window.AM_CLOUD` existe | idêntico |
| `f-beforeunload` | editor.js | o aviso de "desfazer" ao sair só vale fora da nuvem | idêntico |

Se `studio/` mudar e um `antes` deixar de bater, **o build falha** (`aparece 0× …`): revise o patch, nunca force.

## Depuração e automação

Na página do editor existe `window.AMCloud` (somente leitura + `saveNow()`/`saveVersion()`/`comments.open()`): `status` (`loading|saved|saving|offline|reconnecting|throttled|conflict|readonly|expired|rejected|error`),
`rev`, `dirty`, `inflight`, `outbox`, `rejected` (problemas do último 422). Os testes usam isso; não é contrato de produto.

## Testes

```bash
node --test tests/cloud/cloud-core.test.js     # cloud-core (Node)
node tests/cloud/editor-cloud.test.js          # editor em nuvem (Chromium real + mock da API, CSP real)   ONLY=03,07 filtra cenários
node tests/cloud/preservacao.test.js           # prova de preservação   PRESERVE_FULL=1 roda o portão completo (38 baterias)
node tests/cloud/mock-api.js [porta]           # sobe o mock + o site (platform/dist/public) para ver o editor em nuvem à mão
```

Documentação completa: [`docs/editor-em-nuvem.md`](../docs/editor-em-nuvem.md).
