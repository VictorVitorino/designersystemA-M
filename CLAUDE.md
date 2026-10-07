# CLAUDE.md — regras do Canteiro (Design System A&M)

Editor de apresentações em arquivo único (HTML), interface em **pt-BR**. Tudo vive em `studio/`; o detalhe técnico completo está em
`studio/docs/ARCH.md` (leia o §0 “15 regras” e o §9.5 “Invariantes fixadas por testes” antes de mexer em qualquer coisa).

## Processo de cada mudança (nesta ordem)

1. Implementar nas fontes (`studio/`), nunca no HTML montado.
2. `python3 assemble.py` (em `studio/`) e a bateria nova `test-sNN-*.js` (exit 0 = passou).
3. Revisão adversarial (agentes independentes tentando refutar achados) para mudanças que tocam UI, menus ou dados.
4. **Portão completo**: `./qa-gate.sh` precisa terminar em `GATE PASS` com todas as baterias. Não rodar o portão enquanto outro teste usa a pasta (o assemble sobrescreve o HTML).
5. Publicar **exatamente o build que passou**: copiar `studio/AM-Studio-Editor.html` para `AM-Studio-Editor.html` e `Canteiro-AM.html` na raiz.
6. Atualizar `studio/docs/ARCH.md` (seção de status da etapa) e `studio/docs/KEYMAP.md`; commit e push.

Se uma bateria sensível a carga (ex.: S20-18, temporização) falhar sozinha, rodar só ela de novo e registrar; qualquer outra falha se corrige e reabre o portão.

## Estrutura do build (`assemble.py`)

- `editor.html` + `editor.js` (editor) · `runtime.js/.css` + `rt-*.js/.css` (player e componentes; **vão dentro do arquivo exportado**) ·
  `ed-*.js/.css` (extensões **só do editor**, um `<script>` por arquivo, depois de `editor.js`) · `cover.*` (tela inicial) · `history.js`.
- Marcas A&M vêm de `am/brand/` (`%%LOGO_PERF_W%%` etc.). Os slides institucionais entram por `/*%%INST_SPECS%%*/null` em `ed-45-institucional.js`,
  substituído pelo JSON de `studio/inst/*.json` (imagens viram `data:` JPEG). **Não escreva esse marcador dentro de um comentário.**
- Orçamento do arquivo do editor: **≤ 2000 KB** (`test-s90-perf.js`). Hoje ~1841 KB; recomprimir artes antes de subir o limite.

## Invariantes que não podem quebrar

- O arquivo exportado **nunca** contém `onerror`, `onmouseover`, `onclick` (nem em comentários do runtime/rt-*). Use `addEventListener` (ex.: `formClick`, não `onClick`).
- `</script` não pode aparecer em nenhum JS (o assemble reprova); monte a tag com `var S = 'script'`.
- Campos novos de deck/slide/elemento **só sobrevivem** se entrarem nas listas de permissão `safeDeck/safeSlide/safeEl/safeSnap` (`editor.js`); `SNAP_K` inclui os campos que o desfazer precisa. `commit()` roda `stampNums` + `syncLinks`.
- Menus: **Arquivo** com “Início (capa)” primeiro e um só item com “abrir…”; “Minhas obras…” depois de “Abrir…”. **Inserir** com exatamente um item contendo “forma”. **Editar** com um só “colar” e um só “desfazer”. Menu de contexto do elemento: um só “trazer para frente” e um só “alinhar”. Menu **Slide**: um só “Inserir bloco pronto” e um só “Gerar slides de uma planilha”.
- Seletor “Novo slide” (`#mSlide`): exatamente **13** `button[data-layout]` (layouts `hidden: true`, como os institucionais, ficam fora) + tile do bloco institucional.
- Capa: 6 `.cv-opt` (teclas 1–6); **6 projetos prontos** (7/7/6/6/6/7 slides; o 6º é “Apresentação institucional A&M”); cabe sem rolagem de 1024 a 1440; sem rolagem horizontal a 390. Manual (F1) com 17 linhas.
- Barra de ferramentas sem estouro de 1180 a 1920 px (`#rib` e `#top`); `#bSave` dentro da viewport. Rótulos curtos até 1640 px; grupo de edição só com ícones até 1800 px; Gráficos só ícone ≤ 1300; “Apresentar deste slide” só ícone ≤ 1380; botão Institucional só ícone ≤ 1220.
- Player: `hooks.show` só deve conter o gancho de navegação enquanto um player está aberto (extensões não registram `show` próprio; formulários e workshop armam no init do player). Cliques em `.am-ia` não navegam.
- Zero erros de console em todas as baterias.

## Marca e slides institucionais

- Kit de marca (`deck.brand`: cores e fonte) é aplicado **na inserção** (addEl/addSlide/insertSeq/createTextAt), não dentro de `mk.*`. Layouts institucionais ficam isentos do kit (`kitSlide` pula `LAYOUTS[...].inst`).
- Os 5 slides institucionais (capa “Somos a A&M Performance”, presença global, clientes, esferas de atuação, cadeia de valor) vêm de `studio/inst/*.json`, medidos contra `studio/inst/ref-*.png` com `node tools/inst-check.js spec.json ref.png out` (fidelidade mínima nos testes: capa 96,5 · mapa 97,5 · clientes 98 · esferas 93 · cadeia 99). Mapa, clientes e cadeia usam a arte oficial como fundo com textos editáveis por cima; **trocar pelos assets nativos quando o .pptx original chegar**.
- A importação (.pptx/.pdf) reconhece esses slides pelo título e oferece “Usar os modelos oficiais” (`AMInst.scan/replace`, um Ctrl+Z).
- Pontos de entrada do bloco: botão laranja `#bInst`, menu de contexto da miniatura, menu Slide, painel do slide (topo), tile do “Novo slide”, Marca A&M ▸ e cover › Projetos prontos › 6.

## Convenções

- Commits em português, descrevendo o efeito; terminar com as linhas de atribuição definidas pela sessão. Nenhum identificador de modelo em código, comentários ou mensagens de commit.
- **Nunca** versionar: PDFs confidenciais (ex.: material ONS), vídeos `.mp4`, `studio/inst/work/`, saídas de teste (`shots/`, `.gate/`, `saved*.html`, `qa/`).
- Fontes dos testes vêm de `fonts2/` (rota local para Google Fonts); testes não dependem de rede.
- Testes são Playwright (Chromium) em `studio/test*.js`; ferramentas Python em `test-s23-tools.py` (inspeciona .pptx) e `test-s24-tools.py` (gera .pptx).

## Plataforma online (`platform/`)

- **`studio/` é intocável pela plataforma.** O editor em nuvem é construído por `platform/tools/build-cloud-editor.js` numa cópia temporária, com a extensão `studio-cloud/ed-50-cloud.js` e os patches de texto de `studio-cloud/patches.json` (cada "antes" precisa existir exatamente uma vez; se `studio/` mudar, o build falha em vez de produzir editor quebrado). O build autônomo tem de continuar byte-idêntico ao original (`original/SHA256SUMS`).
- **Prova de paridade obrigatória** antes de publicar qualquer mudança no build em nuvem: `npm run test:parity` (ou `:quick`) compara o original e o candidato em DOM, raster, quadros do player, transições e exportações, com o mesmo deck de prova (catálogo completo da gaveta). Resultado e envelope de ruído em `docs/evidencias/paridade.md`.
- **Processo**: implementar → `npm test` (unit, banco com RLS, API) e `npm run test:security` → suítes afetadas (`tests/web`, `tests/cloud`, `tests/ops`, `tests/e2e`) → `node tools/verify-deploy.js` → commit/push. Produção só pelo workflow com aprovação.
- **Segurança**: o banco decide permissões (RLS; nunca `if` de papel no JS confiando no cliente); SQL só parametrizado; toda entrada passa por zod; nada de segredo/token/senha em log ou auditoria; CSP estrita (sem script/estilo inline nas páginas; editor com hashes + `strict-dynamic`); uploads validados por magic bytes; `app_api` nunca é membro de `app_system`.
- **Regras do produto**: acervo comum visível a todos; só o dono (ou admin) altera; cópia para usar; sem cadastro aberto; lixeira reversível. Mudou o contrato → mude `platform/docs/API.md` primeiro.
- **Nunca versionar**: `.env` reais, `platform/.data/`, `platform/.tmp/`, `platform/dist/` (gerado; só `vercel.json` é commitado), capturas de teste.
