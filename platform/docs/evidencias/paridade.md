# Prova de paridade — original × editor em nuvem (todos os efeitos, modelos, layouts e quadros)

**Resultado: IDÊNTICO** — gerado em 2026-10-07T02:19:29.941Z por `platform/tools/parity.cjs` (33 min 12 s), documento montado por `tools/parity-evidence.cjs`. Relatório bruto: `platform/.tmp/parity/cloud/relatorio.{json,md}` (não versionado; reproduza com `npm run test:parity`).

| Lado | Arquivo | SHA-256 |
|---|---|---|
| A (original) | `original.html` | `dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099` |
| B (candidato: editor em nuvem) | `cloud-editor.html` | `8e20f87c28cec75439c46ea8eecdb76978ef2ac5b65d8c318a18fc51ae3fa579` |

Execução em **passagens retomáveis** (`--resume`): 311 slides vieram do checkpoint `progress.jsonl` de uma passagem anterior (mesmo deck de prova — conferido pelo hash — e os mesmos dois arquivos), 112 foram comparados nesta passagem; os 7 slides de transição foram recalculados nesta passagem com o harness definitivo. O tempo acima é só desta passagem.

## 1. O que a prova garante

O editor em nuvem é o original acrescido da extensão de nuvem e de seis ajustes de uma linha. Esta prova mostra que **tudo o que o usuário vê** — cada efeito do Acervo de efeitos com suas variantes, cada caixa da Biblioteca de modelos, todos os ícones e transformações, layouts, projetos prontos da capa, blocos, SmartArt, formas, textos, linhas e marcas — **rende de forma idêntica** nos dois arquivos, quadro a quadro, inclusive durante as animações e as transições, e que as exportações (HTML e PowerPoint) são as mesmas.

## 2. Método (determinístico e reproduzível)

1. **Mesmo Chromium, mesmas fontes**: A e B abertos no mesmo navegador (1280×720, `--disable-lcd-text`, sem *hinting*), fontes do Google servidas de `fonts2/` (sem rede), `Math.random`/`crypto.getRandomValues` com semente fixa, relógio da página controlado (`page.clock`).
2. **Deck de prova construído pelo caminho do usuário em A**: lê a gaveta “Acervo de efeitos” (196 caixas: Entrada 17, Contínuo 10, Ao passar o mouse 10, Transição 7, Componentes 15, Ícones 18, Modelos 119), aciona “Provar → Usar este efeito” em cada uma sobre 5 tipos de elemento (título, forma, linha, imagem, componente); insere as 42 caixas da Biblioteca de modelos, os 54 ícones e 7 transformações, os 18 layouts, os 6 projetos prontos da capa, os 5 blocos, os 14 SmartArt, formas, textos, linhas e marcas → **423 slides**, outro 1, anim 37, tr 7, cmp 15, icon 18, model 119, biblioteca 42, icon54 54, morph 7, smart 14, layout 18, template 39, seq 22, shape 17, text 6, line 3, brand 4.
3. **O mesmo JSON do deck é carregado em A e em B** (recarregados do zero, para que contadores internos e temporizadores partam do mesmo estado). Catálogo da gaveta idêntico nos dois (conferido); CSS e JS do runtime embutido idênticos (sha 788b4dd72c4a31b2 / a03c02de0bbd11e3).
4. **Por slide, cinco camadas**: (a) DOM renderizado (`AMRT.renderSlide`), com os relógios de A e B pausados no mesmo instante absoluto; (b) raster 1280×720 pelo caminho do PDF (`AMExport.rasterSlide`), pixel a pixel; (c) quadros do player em t = 0, 150, 400, 800, 1500 e 3000 ms, com toda animação fixada em t e conferida (pausada, em t) antes da captura; (d) nas transições, quadros a 80, 250 e 500 ms após avançar, **cada instante numa sequência nova do player** (medir os três na mesma sequência deixava o raster dos blocos da lâmina em movimento dependente do histórico de pausas); (e) barra de controles do player. Toda foto é uma captura estável: repetida até duas capturas seguidas saírem byte-idênticas.
5. **Exportações**: HTML autônomo (sha256 do arquivo inteiro) e PowerPoint (sha256 de cada entrada do zip, exceto `docProps/core.xml`, que leva a data).
6. **Ruído do Chromium**: calibrado comparando o original **consigo mesmo** (base-anims: 2 quadros em 135, ambos em bordas de `clip-path` — íris 43 px/máx 49, diagonal 174 px/máx 11). Diferenças ≤ 300 px, ≤ 0.05 % e ≤ 64/255 em bordas de máscara não são atribuíveis ao candidato; mesmo assim cada caso é listado abaixo com a imagem de diferença. DOM, raster e exportações exigem igualdade exata.
7. **Recaptura**: uma divergência na 1ª captura é recapturada imediatamente uma vez, em faixa própria do relógio. Uma diferença real entre A e B reproduz; instabilidade de captura (compositor atrasado sob carga) não — e fica registrada como “captura instável”, com as imagens da 1ª tentativa (`diff/<slide>-t1-*`). Nesta execução: **1 recaptura(s), 1 instável(is), 0 divergência(s) reproduzida(s)**.

## 3. Resultado medido

| Camada | Resultado |
|---|---|
| Catálogo (ids e famílias) A = B | idêntico |
| Runtime embutido (CSS 139455 B, JS 382949 B) | idêntico |
| Deck de prova normalizado (423 slides) | idêntico |
| DOM renderizado | **423/423** idênticos |
| Raster 1280×720 (caminho do PDF) | **423/423** idênticos |
| Quadros do player (6 por slide) | **2530/2538** idênticos pixel a pixel + 8 dentro do envelope de ruído (bordas de máscara), listados abaixo |
| Quadros de transição (3 por transição) | **19/21** idênticos + 2 no envelope de ruído |
| Barra de controles do player | 0 quadros só com antialias de texto (≤ 16/255, ≤ 0,05 %); 0 divergências |
| HTML exportado (2922 KB) | idêntico (sha 6fe4b9cde68129a6…) |
| PowerPoint exportado | idêntico (1285 entradas) |
| Erros de console/página em A e B | 0 |
| **Divergências atribuíveis ao candidato** | **0** |

### Capturas instáveis (1ª captura divergente, recaptura idêntica — não atribuíveis ao candidato)

- slide 82 · model:timeline:steps · frame t=3000 ms (1165 px, máx 130/255)
### Quadros dentro do envelope de ruído (imagens em `diff/*-ruido-diff.png`)

- frame · slide 24 · loop:flow · t=800 ms · 8 px (0.001 %), máx 4/255
- frame · slide 24 · loop:flow · t=1500 ms · 8 px (0.001 %), máx 4/255
- frame · slide 24 · loop:flow · t=3000 ms · 9 px (0.001 %), máx 5/255
- transition · slide 41 · tr:zoom · t=80 ms · 255 px (0.031 %), máx 9/255
- transition · slide 41 · tr:zoom · t=250 ms · 255 px (0.031 %), máx 7/255
- frame · slide 84 · model:process:cycle · t=800 ms · 9 px (0.001 %), máx 18/255
- frame · slide 86 · model:process:final · t=800 ms · 5 px (0.001 %), máx 11/255
- frame · slide 153 · model:gantt:phase · t=3000 ms · 1 px (0 %), máx 1/255
- frame · slide 201 · lib:harvey · t=150 ms · 123 px (0.015 %), máx 35/255
- frame · slide 222 · lib:process · t=800 ms · 5 px (0.001 %), máx 11/255
### Divergências

Nenhuma.

## 4. Como reproduzir

```bash
cd platform
npm run build:cloud                                   # gera .tmp/cloud-build/cloud-editor.html e prova que o autônomo segue byte-idêntico ao original
npm run test:parity                                   # ≈ 1 h: original × nuvem, todos os slides e quadros → .tmp/parity/cloud/relatorio.md
node tools/parity.cjs --a .tmp/parity/original.html --b .tmp/cloud-build/cloud-editor.html --out .tmp/parity/x --deck .tmp/parity/cloud --only 57,134   # reconferir slides específicos
node tools/parity-evidence.cjs                        # atualiza este documento a partir do relatório
```

## 5. Relatório bruto desta execução

| Camada | Resultado |
|---|---|
| Catálogo da gaveta (ids dos 196 itens: in 17, loop 10, hover 10, tr 7, cmp 15, icon 18, model 119) + biblioteca 42 + ícones 54 + transformações 7 + layouts 18 + blocos 5 + SmartArt 14 | idêntico |
| Runtime embutido (CSS 139455 B, JS 382949 B) | idêntico (sha 788b4dd72c4a31b2 / a03c02de0bbd11e3) |
| Deck de prova normalizado (423 slides, 2402 KB) | idêntico |
| DOM renderizado por slide | 423/423 idênticos |
| Raster 1280×720 por slide (caminho do PDF) | 423/423 idênticos |
| Quadros do player — palco do slide (t = 0, 150, 400, 800, 1500, 3000 ms) | 2530/2538 idênticos pixel a pixel + 8 dentro do envelope de ruído do Chromium (bordas de máscara: ≤ 300 px, ≤ 0.05 %, ≤ 64/255), listados abaixo |
| Barra de controles do player | 0 divergências reais |
| Quadros de transição (t = 80, 250, 500 ms após avançar) | 19/21 idênticos + 2 no envelope de ruído |
| HTML exportado (2922 KB) | idêntico (sha 6fe4b9cde68129a6) |
| PowerPoint exportado | idêntico (1285 entradas, exceto a data em docProps/core.xml) |
| Recapturas | 1 slide(s) recapturados após divergência na 1ª captura; 1 com recaptura idêntica (captura instável, listados abaixo; imagens em diff/*-t1-*); 0 com divergência reproduzida |
| Erros de console/página | 0 |
Itens não aplicados/inseridos na construção: 0 animações sem alvo compatível (esperado para transições/alvos específicos), 0 caixas sem inserção, 0 erros.
## Capturas instáveis (divergência só na 1ª captura; recaptura imediata idêntica — não atribuível ao candidato)

- slide 82 · model:timeline:steps · 1ª captura: frame t=3000 ms (1165 px, máx 130/255)

## Quadros dentro do envelope de ruído (não atribuíveis ao candidato; imagens em diff/*-ruido-diff.png)

- frame · slide 24 · loop:flow · t=800 ms · 8 px (0.001 %), máx 4/255
- frame · slide 24 · loop:flow · t=1500 ms · 8 px (0.001 %), máx 4/255
- frame · slide 24 · loop:flow · t=3000 ms · 9 px (0.001 %), máx 5/255
- transition · slide 41 · tr:zoom · t=80 ms · 255 px (0.031 %), máx 9/255
- transition · slide 41 · tr:zoom · t=250 ms · 255 px (0.031 %), máx 7/255
- frame · slide 84 · model:process:cycle · t=800 ms · 9 px (0.001 %), máx 18/255
- frame · slide 86 · model:process:final · t=800 ms · 5 px (0.001 %), máx 11/255
- frame · slide 153 · model:gantt:phase · t=3000 ms · 1 px (0 %), máx 1/255
- frame · slide 201 · lib:harvey · t=150 ms · 123 px (0.015 %), máx 35/255
- frame · slide 222 · lib:process · t=800 ms · 5 px (0.001 %), máx 11/255

## Divergências

Nenhuma.
## Itens por categoria
- outro: 1 slides
- anim: 37 slides
- tr: 7 slides
- cmp: 15 slides
- icon: 18 slides
- model: 119 slides
- biblioteca: 42 slides
- icon54: 54 slides
- morph: 7 slides
- smart: 14 slides
- layout: 18 slides
- template: 39 slides
- seq: 22 slides
- shape: 17 slides
- text: 6 slides
- line: 3 slides
- brand: 4 slides
