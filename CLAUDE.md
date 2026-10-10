# CLAUDE.md — regras do Canteiro (Design System A&M)

Editor de apresentações em arquivo único (HTML), interface em **pt-BR**. Tudo vive em `studio/`; o detalhe técnico completo está em
`studio/docs/ARCH.md` (leia o §0 “15 regras” e o §9.5 “Invariantes fixadas por testes” antes de mexer em qualquer coisa).

## Processo de cada mudança (nesta ordem)

1. Implementar nas fontes (`studio/`), nunca no HTML montado. Recurso novo mora no **próprio módulo** (`rt-NN-*.js/.css` no runtime,
   `ed-NN-*.js/.css` no editor); em `editor.js`/`runtime.js` só entram pontos de extensão genéricos (ex.: `FX.animOk`, `FX.vlabel`, `FX.pvl`),
   nunca código de um componente específico. Orçamento: nuvem ~1769 KB de 2000 desde a S37 (montagem sem comentários).
2. Iterar com `./qa-gate.sh affected` (monta e roda `test.js`, `test2.js` e só as baterias ligadas aos arquivos alterados desde a última
   publicação, pelo mapa `studio/qa-map.txt`; arquivo fora do mapa, `am/` ou `fonts2/` → portão completo). `./qa-gate.sh rerun` repete só
   as reprovadas, sem remontar (uso: bateria sensível a carga, ex.: S20-18; registrar).
3. **Revisão enxuta** (seção abaixo) para mudanças que tocam UI, menus ou dados.
4. **Portão completo uma vez por etapa**, antes de publicar: `./qa-gate.sh` precisa terminar em `GATE PASS` com todas as baterias; ele grava
   `.gate/APROVADO` (sha256 do HTML, modo, nº de baterias) e usa uma trava (dois portões não rodam juntos; nada de outro teste na pasta:
   o assemble sobrescreve o HTML). Qualquer falha que não seja de carga se corrige e reabre o portão.
5. Publicar **exatamente o build que passou**: `./publish.sh` (em `studio/`; recusa se o HTML não tiver o sha do `APROVADO` do portão completo;
   copia para `AM-Studio-Editor.html` e `Canteiro-AM.html` na raiz, regenera `platform/vercel.json` e roda `build-cloud-editor --verify-standalone`).
6. Atualizar `studio/docs/ARCH.md` (seção de status da etapa) e `studio/docs/KEYMAP.md`; commit e push. Depois do commit, em série e sem
   outro Chromium: `node tests/cloud/preservacao.test.js` (rápido) e a prova de paridade (seção Plataforma).

## Revisão enxuta

- Tamanho proporcional ao diff (sem testes e docs): até ~300 linhas, um revisor; acima, três lentes: (1) dados e editor (`safeEl/safeSnap/SNAP_K`,
  `DATA_TOKENS/NOTEXT_KEYS`, desfazer, cópias); (2) runtime, player e CSS (trilhas de animação, ponteiro, classes com dois sentidos); (3) export
  e as invariantes deste arquivo. A plataforma fica fora: seus comandos mecânicos rodam nos passos 5–6.
- Cada achado é **BLOQUEANTE** (perda de dados, export ou player quebrado, erro de console, segurança, invariante deste arquivo quebrada,
  recurso inutilizável) ou **POLIMENTO** (borda visual de combinação rara, texto, acabamento). A severidade “alta/média/baixa” do revisor não filtra.
- Só BLOQUEANTE vai a cético: um cético de reprodução (o segundo só se o primeiro refutar); achados com a mesma causa são fundidos.
- Cada correção de BLOQUEANTE ganha um teste dirigido na bateria da etapa; depois de cada lote de correções, uma passada curta só de BLOQUEANTE
  sobre o diff das correções (um agente com Chromium por módulo tocado, chamadores incluídos, e um cético). Nada de nova rodada completa.
- POLIMENTO vai para o backlog da etapa no `ARCH.md` (“Limits / next”, em inglês, por nome de função); só entra na etapa se for correção
  local de poucas linhas. **Parada**: nenhum BLOQUEANTE aberto depois da passada curta.

## Estrutura do build (`assemble.py`)

- `editor.html` + `editor.js` (editor) · `runtime.js/.css` + `rt-*.js/.css` (player e componentes; **vão dentro do arquivo exportado**) ·
  `ed-*.js/.css` (extensões **só do editor**, um `<script>` por arquivo, depois de `editor.js`) · `cover.*` (tela inicial) · `history.js`.
- Marcas A&M vêm de `am/brand/` (`%%LOGO_PERF_W%%` etc.). Os slides institucionais entram por `/*%%INST_SPECS%%*/null` em `ed-45-institucional.js`,
  substituído pelo JSON de `studio/inst/*.json` (imagens viram `data:` JPEG). **Não escreva esse marcador dentro de um comentário.**
- Orçamento do arquivo do editor: **≤ 2000 KB** (`test-s90-perf.js`) — vale também para o editor em nuvem (`platform/tests/cloud/preservacao.test.js` PR-07), que soma ~146 KB ao autônomo. Hoje (S37): autônomo ~1649 KiB, nuvem ~1769 KB (~230 KB de folga). Desde a S37 o `assemble.py` monta **sem comentários, indentação e linhas vazias** (`strip_js`/`strip_css`, cada pedaço passa por `node --check`; `AM_NOSTRIP=1` monta com comentários para depurar) e `test-s37-montagem.js` prova que os tokens são os mesmos. Consequências: escreva comentários à vontade nas fontes (não pesam); âncoras de patch da nuvem (`platform/studio-cloud/patches.json`) **nunca** incluem comentário; `assemble.py` fora do `qa-map.txt` (mudou a montagem → portão completo).

## Invariantes que não podem quebrar

- O arquivo exportado **nunca** contém `onerror`, `onmouseover`, `onclick` (nem em comentários do runtime/rt-*). Use `addEventListener` (ex.: `formClick`, não `onClick`).
- `</script` não pode aparecer em nenhum JS (o assemble reprova); monte a tag com `var S = 'script'`.
- Campos novos de deck/slide/elemento **só sobrevivem** se entrarem nas listas de permissão `safeDeck/safeSlide/safeEl/safeSnap` (`editor.js`); `SNAP_K` inclui os campos que o desfazer precisa. `commit()` roda `stampNums` + `syncLinks`.
- Menus: **Arquivo** com “Início (capa)” primeiro e um só item com “abrir…”; “Minhas obras…” depois de “Abrir…”. **Inserir** com exatamente um item contendo “forma”. **Editar** com um só “colar” e um só “desfazer”. Menu de contexto do elemento: um só “trazer para frente” e um só “alinhar”. Menu **Slide**: um só “Inserir bloco pronto” e um só “Gerar slides de uma planilha”.
- Seletor “Novo slide” (`#mSlide`): exatamente **13** `button[data-layout]` (layouts `hidden: true`, como os institucionais, ficam fora) + tile do bloco institucional.
- Capa: 6 `.cv-opt` (teclas 1–6); **6 projetos prontos** (7/7/6/6/6/7 slides; o 6º é “Apresentação institucional A&M”); cabe sem rolagem de 1024 a 1440; sem rolagem horizontal a 390. Manual (F1) com 17 linhas.
- Barra de ferramentas sem estouro de 1180 a 1920 px (`#rib` e `#top`); `#bSave` dentro da viewport. Rótulos curtos até 1640 px; grupo de edição só com ícones até 1800 px; Gráficos só ícone ≤ 1300; “Apresentar deste slide” só ícone ≤ 1380; botão Institucional só ícone ≤ 1220.
- Player: `hooks.show` só deve conter o gancho de navegação enquanto um player está aberto (extensões não registram `show` próprio; formulários e workshop armam no init do player). Cliques em `.am-ia` não navegam.
- Menu **Inserir**: um só item “Personagens” (submenu com os 10 presets de `AMRT.personas.PRESETS`, na ordem, + “Balão de fala”). Menu **Marca ▾** da faixa: seção “Personagens A&M” com os mesmos 11 botões, cabendo na tela a 1280×720.
- Zero erros de console em todas as baterias.

## Marca e slides institucionais

- Kit de marca (`deck.brand`: cores e fonte) é aplicado **na inserção** (addEl/addSlide/insertSeq/createTextAt), não dentro de `mk.*`. Layouts institucionais ficam isentos do kit (`kitSlide` pula `LAYOUTS[...].inst`).
- Os 5 slides institucionais (capa “Somos a A&M Performance”, presença global, clientes, esferas de atuação, cadeia de valor) vêm de `studio/inst/*.json`, medidos contra `studio/inst/ref-*.png` com `node tools/inst-check.js spec.json ref.png out` (fidelidade mínima nos testes: capa 96,5 · mapa 97,5 · clientes 98 · esferas 93 · cadeia 99). Mapa, clientes e cadeia usam a arte oficial como fundo com textos editáveis por cima; **trocar pelos assets nativos quando o .pptx original chegar**.
- A importação (.pptx/.pdf) reconhece esses slides pelo título e oferece “Usar os modelos oficiais” (`AMInst.scan/replace`, um Ctrl+Z).
- Pontos de entrada do bloco: botão laranja `#bInst`, menu de contexto da miniatura, menu Slide, painel do slide (topo), tile do “Novo slide”, Marca A&M ▸ e cover › Projetos prontos › 6.

## Personagens A&M (S35)

- `rt-70-personas.js/.css` (runtime, vai no exportado) + `ed-46-personas.js` (só editor). `FX.persona`: SVG procedural (viewBox 200×240) com partes em
  `AMRT.personas` (chapéus, cabelos, óculos, roupas, ferramentas, expressões) e 10 presets como **variantes**; cada campo de parte vazio = “Do personagem”
  (`resolve(d, el)`). Cores só da paleta A&M: o personagem fica **fora** do kit “Cores do componente” (`palOk` falso para a categoria Personagens); só os seletores
  “Cor do corpo/da roupa” (paleta A&M) mudam as cores. `FX.persona.norm` saneia arquivos editados à mão (decisões em texto viram lista, falas viram texto).
- Movimentos/gatilhos são CSS. A pose de repouso vem de variáveis (`--rR/--rL` braços, `--rGL/--rGR` pernas) que o `data-act` define; cada movimento tem três
  trilhas: entrada `--kX` (toca uma vez e **termina na pose**), laço `--lX` (cíclica em volta da pose, para “Sem parar” e “Ao passar o mouse”) e gesto `--gX`
  (começa e termina na pose, para o clique, `.pz-go`). O `data-trig` arma a trilha (`--aX`). `.pz-done` impede a entrada de recomeçar depois de um clique.
  **Nunca** use `none` como nome de animação nessas variáveis (o atalho `animation` lê `none` como fill-mode): o nome inerte é `pzNone`. Loops, hover,
  piscar e LED só sob `.am-play`; palco de edição, miniaturas e rasters mostram a pose de repouso (sem confete). No player só o desenho e o balão recebem
  o ponteiro (o vazio da caixa deixa o clique chegar às zonas de avançar/voltar).
- Balão (`.pz-say`) é HTML por cima do SVG; `data.say` editável no lugar (`U.E`); botões de decisão `.pz-ch` inertes em `.am-edit/.am-export`.
  Andar até X move o invólucro `.pz-mv` (balão + boneco) em **cqw** (`--wq/--wqy`, no referencial do elemento girado); na chegada (`animationend` →
  `.pz-arr`) só “Ao entrar” toca o movimento; nos outros gatilhos os braços e a ferramenta só vão para a pose (`.pz-pose`, 0,5 s), a mira usa a posição de chegada e as linhas presas reaparecem com a ponta no ponto de chegada (cópia `<id>-pz`). Mira
  (`data.aim` = id) recalculada por `aimStage` depois de cada `AMRT.renderSlide`, no player e após pointerup/keyup/input no editor (`AMPersonas.reaim`);
  copiar/duplicar remapeia `data.aim` (e a base do Redefinir) como as pontas presas. Entradas: Inserir › Personagens ▸ e a seção “Personagens A&M” do
  menu Marca ▾ da faixa de ferramentas (`ed-46-personas.js/.css`).
- Tokens novos de `data.*` entram em `DATA_TOKENS` (editor.js) **e** em `NOTEXT_KEYS` (runtime.js); texto livre (`say`, `say2`, `choices`) fica fora e sai
  sempre com `esc()`. A raiz leva `.am-ia`; o player não registra `hooks.show`.
- Efeitos que o personagem recusa vêm do próprio componente (`FX.persona.animOk`, usado pelo painel, pela vitrine e pelo `safeEl`): nunca Reflexo, anéis,
  Zoom interno, Contorno, Varrer luz, Sublinhar; com “Andar até”, também os que giram/escalam em volta da caixa de origem. A chegada da caminhada é tratada por
  um ouvinte de `animationend` no documento (vale na prévia do editor); durante a caminhada os braços balançam em volta da pose neutra. Trilhas de gesto têm
  nomes próprios (`…G`): o mesmo nome do laço não reiniciaria a animação. Em laço/mouse o gesto do clique espera a virada do ciclo (`animationiteration`)
  para partir da pose; clique sem gesto não mexe no laço (`.pz-done` só vale para `trig=in`). A ferramenta existe nas duas mãos (`.pz-tL/.pz-tR`): o
  gesto usa a mão livre e, sem mão livre, a ferramenta some durante o gesto. Ligar “Andar até” tira os efeitos recusados (`stripRefused`, no `change`).
  Fala que não cabe nem com 8 px (fala 1 ou “Fala ao clicar”): `.pz-over` corta as duas com reticências, o editor contorna e o painel avisa; em
  `.am-play` as decisões rolam dentro do balão. Pincel de formato não leva `pal` onde `palOk` é falso.

## Estúdio do personagem e ligação com os slides (S36)

- O painel do personagem é um estúdio (`ed-46`): `MutationObserver` em `#props` troca as fichas de variante pelo estúdio e recolhe os campos originais em
  `details.pzs-fine` (“Ajustes finos”). As opções vêm dos campos `sel:` do próprio componente; miniaturas = `FX.persona.html` (pose de repouso). Clique em
  miniatura/amostra = muda o modelo + `renderAll` + `commit` (um passo de desfazer); campos de texto/número/seleção do estúdio repassam ao campo original.
  O elenco usa `data-var` (o editor troca a variante). Testes que usam `selectOption` nos campos originais abrem “Ajustes finos” antes.
- `data.grp` (id simples, em `DATA_TOKENS` e `NOTEXT_KEYS`) = o mesmo personagem em vários slides: peças, cores e preset valem para o grupo; no player ele
  anda da posição do slide anterior até a nova (`pz-from` + `data-walk` temporário). `data.link` (inteiro 1–999) = o clique leva ao slide N.
- Gesto do clique (`act2`) só com “Ao entrar” (e “Só ao clicar”); em laço/mouse o `html()` zera. O observador de palcos trata cada palco uma vez por lote.
- Wordmark branco embutido uma vez só (`img.brand-wm` do topo); `BRAND.wmW` e a capa leem o `src` dele. Não volte a usar `%%WM_W%%` em outro arquivo.

## Convenções

- Commits em português, descrevendo o efeito; terminar com as linhas de atribuição definidas pela sessão. Nenhum identificador de modelo em código, comentários ou mensagens de commit.
- **Nunca** versionar: PDFs confidenciais (ex.: material ONS), vídeos `.mp4`, `studio/inst/work/`, saídas de teste (`shots/`, `.gate/`, `saved*.html`, `qa/`).
- Fontes dos testes vêm de `fonts2/` (rota local para Google Fonts); testes não dependem de rede.
- Testes são Playwright (Chromium) em `studio/test*.js`; ferramentas Python em `test-s23-tools.py` (inspeciona .pptx) e `test-s24-tools.py` (gera .pptx).

## Plataforma online (`platform/`)

- **`studio/` é intocável pela plataforma.** O editor em nuvem é construído por `platform/tools/build-cloud-editor.js` numa cópia temporária, com a extensão `studio-cloud/ed-50-cloud.js` e os patches de texto de `studio-cloud/patches.json` (cada "antes" precisa existir exatamente uma vez; se `studio/` mudar, o build falha em vez de produzir editor quebrado). Duas garantias separadas (`--verify-standalone`, `preservacao.test.js`): o build autônomo de `studio/` é byte-idêntico ao **build publicado na raiz** (`AM-Studio-Editor.html` = `Canteiro-AM.html`, atualizado a cada etapa depois do portão); `original/` é só a cópia preservada do upload S34b e confere com `original/SHA256SUMS`. Cada etapa de `studio/` também regenera `platform/vercel.json` (`node tools/build-web.js`: a CSP leva o hash de cada script inline do editor; o CI confere com `--check`).
- **Prova de paridade obrigatória** antes de publicar qualquer mudança no build em nuvem: `npm run test:parity` (ou `:quick`) compara o build autônomo publicado (`../AM-Studio-Editor.html`) e o candidato em DOM, raster, quadros do player, transições e exportações, com o mesmo deck de prova (catálogo completo da gaveta). Resultado e envelope de ruído em `docs/evidencias/paridade.md`.
- **Etapa só de `studio/`** (a plataforma não mudou): `./publish.sh` (passo 5) → commit → `node tests/cloud/preservacao.test.js` (rápido; mais `node tests/cloud/editor-cloud.test.js` se mudaram `editor.html`, `editor.js`, `ed-*` ou `cover.*`) → `npm run test:parity:quick` → evidências. `PRESERVE_FULL=1` só quando mudar `platform/studio-cloud/`; nesta máquina, com `platform/node_modules` instalado (Playwright do CI, sem navegador local), rode esses testes com `NODE_OPTIONS="--require $PWD/tools/pw-local.cjs"` (em `platform/`); `npm test` e `test:security` rodam no CI a cada push e, localmente, só quando `platform/` mudar.
- **Processo** (mudança em `platform/`): implementar → `npm test` (unit, banco com RLS, API), `npm run build:web` e `npm run test:security` (lê o site gerado) → suítes afetadas (`tests/web`, `tests/cloud`, `tests/ops`, `tests/e2e`) → `node tools/verify-deploy.js` → commit/push. Produção só pelo workflow com aprovação.
- **Segurança**: o banco decide permissões (RLS; nunca `if` de papel no JS confiando no cliente); SQL só parametrizado; toda entrada passa por zod; nada de segredo/token/senha em log ou auditoria; CSP estrita (sem script/estilo inline nas páginas; editor com hashes + `strict-dynamic`); uploads validados por magic bytes; `app_api` nunca é membro de `app_system`.
- **Regras do produto**: acervo comum visível a todos; só o dono (ou admin) altera; cópia para usar; sem cadastro aberto; lixeira reversível. Mudou o contrato → mude `platform/docs/API.md` primeiro.
- **Nunca versionar**: `.env` reais, `platform/.data/`, `platform/.tmp/`, `platform/dist/` (gerado; só `vercel.json` é commitado), capturas de teste.
