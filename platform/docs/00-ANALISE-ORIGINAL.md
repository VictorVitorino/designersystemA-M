# Análise do arquivo original e plano de preservação

**Arquivo analisado:** `Canteiro-AM (3).html` (1.893.245 bytes). Cópia preservada, sem alteração, em [`original/Canteiro-AM (3).html`](../../original/) com checksum em `original/SHA256SUMS`:

```
dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099
```

É byte a byte o build publicado da etapa S34b (portão de qualidade 35/35 aprovado). Montar o editor a partir de `studio/` (`python3 studio/assemble.py`) reproduz exatamente esse arquivo.

## 1. O que o arquivo é

Um editor de apresentações completo em **um único HTML** (sem servidor): edita, apresenta e exporta tudo no navegador. Medido no próprio arquivo, com o editor aberto num Chromium real e **zero erros de console**:

| Item | Quantidade / estado |
|---|---|
| Efeitos e componentes animados (registro `AMRT.FX`) | **49**, em 14 categorias: Gráficos 8, Evolução 7, Estratégia 6, Cards 5, Matrizes 4, Interativo 4, Indicadores 3, Processos 3, Números & dados 2, Destaques 2, Ícones animados 2, Marca A&M 1, Riscos 1, SmartArt 1 |
| SmartArt / modelos de consultoria | 14 leiautes (listas, ciclo, funil, fluxograma, mapa mental, PDCA, Gantt, AS-IS/TO-BE, Porter, BCG, roadmap, árvore de problemas, cadeia de valor, BMC, OKR, BSC…) |
| Layouts de slide | 18 (13 no seletor "Novo slide" + 5 institucionais A&M ocultos) |
| Blocos prontos | 5 sequências (institucional A&M 5, proposta comercial 6, painel executivo 3, roadmap 3, apresentação executiva 5) e 6 projetos prontos na capa |
| Animações | 18 de entrada, 11 contínuas, 11 de passagem do mouse, 8 transições de slide |
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
| Rascunho em `localStorage` (`amStudio.draft`, ≤ 4,5 MB) a cada alteração | **mantido** como rede de segurança local; a fonte da verdade passa a ser o servidor |
| "Minhas obras" (IndexedDB `canteiro`, `AMHist`) | **mantido** intacto; o acervo da nuvem é um segundo lugar. "Exportar acervo (.json)" alimenta a importação para a nuvem |
| "Salvar" baixa um `.html` com o deck em `<script id="am-deck-data">` | **mantido** (exportação offline continua); salvar na nuvem é automático e confirmado |
| Imagens como `data:` URI dentro do JSON do deck | externalizadas para o armazenamento de arquivos (endereçadas por SHA-256, sem duplicação); o editor continua trabalhando com `data:` em memória (hidratação ao abrir) |
| Respostas de formulário/quadro/votação em `localStorage` do espectador | ponte para a API (centraliza as respostas de todos); `localStorage` continua como cache |
| Fontes do Google e pdf.js por CDN | pdf.js passa a ser servido pela própria plataforma (`/vendor`); fontes do Google continuam permitidas na política de segurança |
| Sem login, sem permissões, sem versões | login por convite, acervo comum com regras de acesso, histórico de versões, comentários |

## 3. O que muda e o que NÃO muda

**Não muda (e é verificado):** todo o código de `studio/` (editor, efeitos, animações, modelos, atalhos, componentes interativos, importação/exportação). O build **standalone** (`python3 studio/assemble.py`) continua sendo exatamente o arquivo original.

**O que a versão online acrescenta, sem tocar em `studio/`:** o build "cloud" é feito numa **cópia temporária** de `studio/`, onde se adicionam a extensão de nuvem (`platform/studio-cloud/ed-50-cloud.js`) e **três ajustes de texto cirúrgicos e verificados** (cada um exige que o trecho original exista exatamente uma vez, senão o build falha):

1. `commit()` do editor emite um evento (`am:commit`) para o salvamento automático saber que algo mudou;
2. o carregamento do leitor de PDF deixa de usar `new Function` (incompatível com uma política de segurança estrita) e passa a usar `import()` nativo;
3. a capa não abre quando o editor roda dentro da plataforma (o ponto de entrada passa a ser o acervo).

## 4. Como a preservação é provada

| Prova | O que garante |
|---|---|
| Hash do build standalone = hash do arquivo original | `studio/` não foi alterado em nada |
| Gate de 35 suítes do editor executado sobre o **build cloud em modo inerte** (sem `window.AM_CLOUD`) | os 3 ajustes e a extensão não quebram nenhum comportamento existente |
| Suítes novas em modo nuvem: abrir/editar/salvar, importar PPTX/PDF, exportar HTML/PDF/PowerPoint com imagens hidratadas, player, atalhos, formulários | as funções continuam funcionando **dentro** da plataforma |
| Zero violações de CSP em Chromium real durante todos os fluxos | a política de segurança estrita não desliga nenhum recurso |
| Medição do tempo de abertura/salvamento e do peso do arquivo | a fluidez não piora |

Resultados reais de cada prova ficam em [`EVIDENCIAS.md`](EVIDENCIAS.md).
