# Análise do arquivo original e plano de preservação

**Arquivo analisado:** `Canteiro-AM (3).html` (1.893.245 bytes). Cópia preservada, sem alteração, em [`original/Canteiro-AM (3).html`](../../original/) com checksum em `original/SHA256SUMS`:

```
dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099
```

É byte a byte o build publicado da etapa S34b (portão de qualidade 35/35 aprovado); até a S34b, montar o editor a partir de `studio/` (`python3 studio/assemble.py`) reproduzia exatamente esse arquivo.

**Regra a partir da S35 (duas garantias separadas):** `original/` é a cópia preservada do upload (S34b) — não muda, confere com `original/SHA256SUMS` e **não** precisa
ser igual ao build atual. O build autônomo de `studio/` é conferido contra o **build publicado na raiz** (`AM-Studio-Editor.html` = `Canteiro-AM.html`,
hoje sha256 `631ad7213fb7b63f…`, S38), que cada etapa de `studio/` atualiza depois do portão (regra 5 do processo no `CLAUDE.md`); o build em nuvem e a prova de
paridade seguem esse build. A análise abaixo descreve o arquivo original enviado.

## 1. O que o arquivo é

Um editor de apresentações completo em **um único HTML** (sem servidor): edita, apresenta e exporta tudo no navegador. Medido no próprio arquivo, com o editor aberto num Chromium real e **zero erros de console**:

| Item | Quantidade / estado |
|---|---|
| Efeitos e componentes animados (registro `AMRT.FX`) | **49**, em 14 categorias: Gráficos 8, Evolução 7, Estratégia 6, Cards 5, Matrizes 4, Interativo 4, Indicadores 3, Processos 3, Números & dados 2, Destaques 2, Ícones animados 2, Marca A&M 1, Riscos 1, SmartArt 1 |
| SmartArt / modelos de consultoria | 14 leiautes (listas, ciclo, funil, fluxograma, mapa mental, PDCA, Gantt, AS-IS/TO-BE, Porter, BCG, roadmap, árvore de problemas, cadeia de valor, BMC, OKR, BSC…) |
| Layouts de slide | 18 (13 no seletor "Novo slide" + 5 institucionais A&M ocultos) |
| Blocos prontos | 5 sequências (institucional A&M 5, proposta comercial 6, painel executivo 3, roadmap 3, apresentação executiva 5) e 6 projetos prontos na capa |
| Animações | 17 de entrada, 10 contínuas, 10 ao passar o mouse, 7 transições de slide (cada seletor tem ainda a opção “nenhuma”) — com componentes, ícones e modelos, 196 caixas no Acervo de efeitos |
| Menus | Arquivo, Editar, Inserir, Slide, Organizar, Apresentar, Ajuda; barra de ferramentas com 17 botões; atalhos documentados em `studio/docs/KEYMAP.md` (118 linhas) |
| Importar | `.pptx` e `.pdf` → slides editáveis; reconhecimento dos slides institucionais A&M |
| Exportar | HTML autônomo (apresentação com player), PDF, PowerPoint editável |
| Interativos | formulários com respostas guardadas e CSV (+ Google Sheets opcional), quadros de post-its, votação por pontos, cronômetro |
| Marca | kit de marca por apresentação (cores e fontes), logos A&M embutidos |
| Organização | agrupar, bloquear, camadas, alinhar/distribuir, pincel de formato, recorte de imagem, localizar/substituir, numeração, conectores que acompanham objetos, slides em lote a partir de CSV |
| APIs públicas | `AMStudio`, `AMRT`, `AMExport`, `AMImport`, `AMColorPop`, `AMBrand`, `AMBatch`, `AMInst`, `AMHist`, `AMCover` |
| Suítes de teste do editor | 35 (portão `studio/qa-gate.sh`), invariantes fixados em `studio/docs/ARCH.md` §9.5 |

## 2. Onde o editor guarda e lê dados hoje (pontos de contato com a nuvem)

| Hoje (arquivo local) | Online |
|---|---|
| Rascunho em `localStorage` (`amStudio.draft`, ≤ 4,5 MB) a cada alteração | no editor original, **mantido**; na nuvem o rascunho local é **descartado** e substituído pela fila do IndexedDB `canteiro-cloud` (apagada após o salvamento confirmado; ver `editor-em-nuvem.md` §3 e §6) — a fonte da verdade é o servidor |
| "Minhas obras" (IndexedDB `canteiro`, `AMHist`) | no editor original, **mantido** intacto. Na nuvem nada entra lá e "Minhas obras…" leva ao acervo da nuvem (`/acervo?aba=minhas`); o acervo local antigo chega à nuvem pelo "Exportar acervo (.json)" + `/importar` |
| "Salvar" baixa um `.html` com o deck em `<script id="am-deck-data">` | **mantido** (exportação offline continua); salvar na nuvem é automático e confirmado |
| Imagens como `data:` URI dentro do JSON do deck | externalizadas para o armazenamento de arquivos (endereçadas por SHA-256, sem duplicação); o editor continua trabalhando com `data:` em memória (hidratação ao abrir) |
| Respostas de formulário/quadro/votação em `localStorage` do espectador | ponte para a API: cada envio vai ao servidor **com o nome de quem respondeu**, e o servidor guarda as respostas de todos (o dono as lê por `GET …/interactions` e `…/interactions.csv`; ainda não há tela para isso no editor nem no acervo — no player, "Baixar CSV" continua lendo só este navegador); `localStorage` continua como cache, apagado ao Sair (ver `editor-em-nuvem.md` §6) |
| Fontes do Google e pdf.js por CDN | pdf.js passa a ser servido pela própria plataforma (`/vendor`); fontes do Google continuam permitidas na política de segurança |
| Sem login, sem permissões, sem versões | login por convite, acervo comum com regras de acesso, histórico de versões, comentários |

## 3. O que muda e o que NÃO muda

**Não muda pela plataforma (e é verificado):** todo o código de `studio/` (editor, efeitos, animações, modelos, atalhos, componentes interativos, importação/exportação). O build **standalone** (`python3 studio/assemble.py`) é exatamente o build publicado na raiz (`AM-Studio-Editor.html` = `Canteiro-AM.html`) — na S34b, o próprio arquivo original; a cada etapa nova de `studio/`, o build que passou no portão e foi publicado.

**O que a versão online acrescenta, sem tocar em `studio/`:** o build "cloud" é feito numa **cópia temporária** de `studio/`, onde se adicionam a extensão de nuvem (`platform/studio-cloud/ed-50-cloud.js`) e **seis ajustes de texto cirúrgicos e verificados** (`studio-cloud/patches.json`; cada um exige que o trecho original exista exatamente uma vez, senão o build falha):

1. `commit()` do editor emite um evento (`am:commit`) para o salvamento automático saber que algo mudou;
2. `restore()` (desfazer/refazer) emite o mesmo aviso — sem isso um Ctrl+Z não seria salvo;
3. `loadDeck()` (Abrir…, Novo, importar, modelos prontos) avisa a nuvem que o deck inteiro trocou, para fixar o id da apresentação e salvar;
4. o carregamento do leitor de PDF deixa de usar `new Function` (incompatível com uma política de segurança estrita) e passa a usar `import()` nativo;
5. a capa não abre quando o editor roda dentro da plataforma (o ponto de entrada passa a ser o acervo);
6. a pergunta “sair sem salvar?” do navegador passa a ser decidida pela extensão (só com alterações ainda não confirmadas na nuvem).

Sem `window.AM_CLOUD` (modo inerte) nenhum dos seis muda comportamento; a prova é o portão de 39 baterias do editor sobre o build em nuvem (EVIDENCIAS §1.1).

## 4. Como a preservação é provada

| Prova | O que garante |
|---|---|
| Hash do build standalone = hash do build publicado na raiz (`AM-Studio-Editor.html` = `Canteiro-AM.html`) | a plataforma não alterou `studio/` e o editor publicado é o que `studio/` monta |
| Hash de `original/Canteiro-AM (3).html` = `original/SHA256SUMS` (`dc93ceac…5099`) | a cópia do arquivo enviado (S34b) continua intacta; ela não precisa ser igual ao build atual |
| Gate de 39 suítes do editor executado sobre o **build cloud em modo inerte** (sem `window.AM_CLOUD`) | os 6 ajustes e a extensão não quebram nenhum comportamento existente |
| Suítes novas em modo nuvem: abrir/editar/salvar, importar PPTX/PDF, exportar HTML/PDF/PowerPoint com imagens hidratadas, player, atalhos, formulários | as funções continuam funcionando **dentro** da plataforma |
| Zero violações de CSP em Chromium real durante todos os fluxos | a política de segurança estrita não desliga nenhum recurso |
| Medição do tempo de abertura/salvamento e do peso do arquivo | a fluidez não piora |

Resultados reais de cada prova ficam em [`EVIDENCIAS.md`](EVIDENCIAS.md).
