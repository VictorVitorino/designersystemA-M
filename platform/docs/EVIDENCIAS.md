# Evidências de teste — plataforma online do Canteiro

Tudo abaixo foi **executado nesta máquina** (Linux, 4 CPUs, 16 GB, Postgres 16 local, Chromium via Playwright, sem rede para fornecedores) em 2026-10-06 e 2026-10-07; cada seção diz a data e o log de origem.
O que depende de contas externas (Supabase, Vercel, GitHub Actions, domínio, e-mail) **não foi executado** e está marcado como tal em [`CONFIGURACAO.md`](CONFIGURACAO.md).

## 1. Preservação do editor original

| Prova | Resultado |
|---|---|
| Cópia do arquivo enviado (`original/Canteiro-AM (3).html`) | SHA-256 `dc93ceac…5099`, 1.893.245 bytes, igual ao build publicado da etapa S34b |
| Build autônomo a partir de `studio/` (`python3 assemble.py`) | **byte-idêntico** ao original (mesmo SHA-256), confirmado por `tools/build-cloud-editor.js --verify-standalone` |
| Build em nuvem (`platform/.tmp/cloud-build/cloud-editor.html`, 1.936 KB) | = `studio/` + extensão `ed-50-cloud` + 6 patches de uma linha, cada um exigido exatamente 1× (o build falha se `studio/` mudar) |
| Arquivo servido em `/editor/` e `/visualizar/` | byte-idêntico ao build em nuvem (mesmo SHA-256) |
| Portão de 35 baterias do editor sobre o build em nuvem (modo inerte) | ver §1.1 |
| Paridade pixel a pixel original × nuvem | ver [`evidencias/paridade.md`](evidencias/paridade.md) e §1.2 |

### 1.1 Portão de qualidade do editor (35 baterias)

Executado por mim (não só pelo agente construtor) com `PRESERVE_FULL=1 node tests/cloud/preservacao.test.js`, que copia `studio/`, troca o HTML sob teste pelo **build em nuvem sem `window.AM_CLOUD`** e roda o `qa-gate.sh` completo:

| Medida | Resultado |
|---|---|
| Baterias aprovadas no portão | **34 de 35** (539 s), com três fazendas de Chromium rodando ao mesmo tempo nesta máquina (prova de paridade + agentes de qualidade) |
| Única falha | `test-s24-import.js`: "Execution context was destroyed", padrão de renderer derrubado por falta de recursos; não é erro de teste nem do build |
| Reexecução isolada da S24 sobre o build em nuvem | **TUDO OK: 38 checagens, 0 erros** |
| Execução do agente construtor (mesmo comando, máquina ociosa) | GATE PASS 35/35 (530 s) |
| Provas estruturais da mesma suíte (PR-01…PR-13) | cloud − extensão = autônomo + 6 patches (igualdade exata de texto); nenhum arquivo de `studio/`, `original/`, `am/` alterado; build autônomo com o SHA-256 do original |

Conclusão: o build em nuvem, sem a plataforma ativa, passa em todas as 35 baterias do editor original.

### 1.2 Prova de paridade (todos os efeitos, modelos, layouts, templates e quadros)

`npm run test:parity` (`tools/parity.cjs`) com o original × build em nuvem final (sha `8e20f87c…`), executada em 2026-10-07 em duas passagens retomáveis (00:46–01:57, 311 slides; travamento transitório do navegador; retomada 02:19–02:52 a partir do checkpoint, com os 7 slides de transição recalculados pelo harness definitivo). Documento completo com método, envelope de ruído e lista de cada quadro fora da igualdade exata: [`evidencias/paridade.md`](evidencias/paridade.md).

| Camada | Resultado |
|---|---|
| Deck de prova montado pelo caminho do usuário em A e carregado em A e B | **423 slides**: 196 caixas do Acervo de efeitos (Entrada 17, Contínuo 10, Mouse 10, Transição 7, Componentes 15, Ícones 18, Modelos 119) sobre 5 tipos de elemento, 42 caixas da Biblioteca de modelos, 54 ícones, 7 transformações, 18 layouts, 6 projetos prontos da capa, 5 blocos, 14 SmartArt, formas, textos, linhas, marcas |
| Catálogo, runtime embutido (CSS/JS), deck normalizado | idênticos |
| DOM renderizado por slide | **423/423** |
| Raster 1280×720 (caminho do PDF) | **423/423** |
| Quadros do player (t = 0, 150, 400, 800, 1500, 3000 ms) | **2 530/2 538** idênticos pixel a pixel; 8 dentro do envelope de ruído do Chromium (bordas de máscara: ≤ 123 px, ≤ 35/255), todos listados com imagem |
| Quadros de transição (t = 80, 250, 500 ms após avançar) | **19/21** idênticos; 2 na borda da transição “Zoom” (1 coluna, ≤ 9/255) |
| HTML exportado (2 922 KB) e PowerPoint (1 285 entradas) | idênticos |
| Erros de console/página | 0 |
| **Divergências atribuíveis ao build em nuvem** | **0** — resultado **IDÊNTICO** |

Uma captura instável (slide 82, `timeline:steps`, t = 3000 ms) divergiu na 1ª foto e saiu idêntica na recaptura imediata, durante uma reconferência que rodava em paralelo; está registrada no documento, com as imagens da 1ª tentativa.

## 2. Banco de dados e isolamento (RLS)

`tests/db/isolation.test.js` contra Postgres real: **32 testes, 32 aprovados**. Cobrem: a API sem usuário não lê nenhuma tabela; o usuário não escala para `app_system`/`app_owner`/`postgres` mesmo por injeção de SQL; só 3 funções pré-login são executáveis; RLS ligada em todas as tabelas; acervo visível a todos; outro membro não altera/exclui (0 linhas); dono e admin alteram; ninguém cria em nome de outro; cópia isolada; lixeira; suspenso/convidado/inexistente não veem nada; versões só do dono; arquivos deduplicados sem vazamento; comentários e interações com matriz de permissões; e-mails invisíveis a membros; último admin protegido; convite só por admin; `resolve_identity` sem convite não entra; auditoria imutável com autor imposto pelo banco; limite de taxa; texto malicioso tratado como dado.

## 3. API, autenticação e segurança (suíte completa)

`npm test` (unit + banco + API) e `npm run test:security`, com a aplicação real (`createApp`) e GoTrue falso, reexecutados em 2026-10-07 **depois** das correções da revisão de qualidade (§6–§8): **684 + 111 = 795 testes, 795 aprovados, 0 falhas** (61 s + 35 s).

Inclui: fluxo convite → e-mail → senha → login; respostas equalizadas para e-mail inexistente × senha errada; `forgot` sempre 202; refresh/expiração/logout; tokens nunca no corpo; cookies com flags; JWT `alg none`/confusão/emissor errado recusados; CSRF (ausente, errado, Origin, Content-Type); limites de taxa; admin (membro 403 em tudo, último admin, suspensão derruba sessão); cabeçalhos; configuração de produção rígida; estático (traversal, MIME, CSP por página); 409 de conflito com `overwrite` e `pre_overwrite`; versões/restauração; integridade de referências de arquivo (sha desconhecido ou alheio → 422); deck malicioso → 422 e nada gravado (corpus de XSS); uploads (hash errado 400, SVG 415, 413, dedup com 2ª pessoa, imagem corrompida 422, GET por quem não pode ver 404); comentários e interações (matriz completa + CSV injection); 20 salvamentos concorrentes da mesma apresentação sem perda.

## 4. Cliente web e editor em nuvem

| Suíte | Resultado |
|---|---|
| `tests/web/web.test.js` (Playwright, páginas sob CSP estrita, com o cloud-core real) | **264 aprovados, 0 falhas** |
| `tests/cloud/cloud-core.test.js` (hash/canônico iguais ao servidor, externalizar/hidratar) | **15/15** |
| `tests/cloud/editor-cloud.test.js` (20 cenários: carregar, autosave, dedup, offline, conflito, histórico, visualizar, interações, exportações, CSP) | **101 aprovados, 0 falhas**; zero violações de CSP; editor 1.936 KB; 15 hashes de script |

## 5. Operação

`tests/ops/*.test.js`: **102 testes, 102 aprovados**. Ensaio de restauração executado de ponta a ponta: [`evidencias/restore-drill.md`](evidencias/restore-drill.md) (seed de 30 usuários, 200 apresentações, 448 arquivos; backup cifrado para pasta e para S3 falso; destruição; restauração em banco novo; 448/448 arquivos íntegros; RTO 2,5 s no acervo de teste).
`tools/dev.js` sobe a pilha inteira localmente: `/api/health` 200, `/api/ready` `{db,storage,auth,migrations: true}`, páginas com CSP por hash, link de convite do primeiro admin impresso.

## 6. Ponta a ponta com a pilha real

PENDENTE_E2E

## 7. Carga: 50 usuários simultâneos

`npm run test:load` (`tests/load/run.js`) contra a pilha completa real (`tools/dev.js --port 4402`: Postgres + GoTrue falso + API + site), 100 usuários criados pela API, decks de 150–400 KB com 3 imagens externalizadas, imagens PNG/JPEG reais de 200–800 KB, autosave a cada 3–5 s + ações secundárias (acervo, abrir alheia, versões, download, cópia, comentário, sonda de vazamento, salvamento obsoleto). Relatório completo: [`evidencias/carga.md`](evidencias/carga.md).

| Fase | Requisições | PUT conteúdo p50 / p95 / p99 | GET p95 | 429 | 5xx | Integridade | Vazamentos | Critério (p95 PUT ≤ 800 ms, GET ≤ 300 ms, 0 × 5xx, sem perda) |
|---|---|---|---|---|---|---|---|---|
| 1 — 50 usuários × 180 s, limites por IP como estavam (5×) | 5 294 (29,4 req/s) | 72 / 178 / 235 ms | 91 ms | 537 (19,9 % dos autosaves, balde por IP) | 0 | 50/50 | 0 em 111 sondas | **APROVADA** |
| 2 — 50 usuários × 180 s, limites por IP neutralizados | 5 286 (29,4 req/s) | 89 / 195 / 260 ms | 104 ms | 0 | 0 | 50/50 | 0 em 123 sondas | **APROVADA** |
| 3 — 100 usuários × 60 s | 2 922 (48,4 req/s) | 378 / 972 / 1 159 ms | 824 ms | 0 | 0 | 100/100 | 0 | degrada (thread JS a 83 % de CPU), sem erros |
| Experimento — 150 usuários × 60 s | 43,7 req/s | p95 2 848 ms | 2 679 ms | 0 | 0 | 150/150 | 0 | limite de uma instância |

Também medido: 1 404 objetos (454 MB) = 1 404 linhas em `app.assets` (exatamente um objeto por arquivo distinto; imagens compartilhadas com 1 linha/1 objeto); memória da API estável (204 → 281 MB); abertura do editor em nuvem até “Salvo na nuvem” p50 964 ms (original em `file://` até o editor pronto: 379 ms); 0 violações de CSP.

Os 7 achados do teste (A1–A7: limites por IP que penalizavam um escritório atrás de NAT, saturação a ~100 usuários, inchaço do banco) foram tratados no mesmo dia — tabela em `evidencias/carga.md` §10 (multiplicador por IP 25× configurável, limites de `refresh`/`verify` pelo token, uma ida ao banco para os dois baldes, migração 0005 com autovacuum/lz4, documentação de dimensionamento). A fase de 50 usuários não foi reexecutada depois das alterações nesta máquina.

## 8. Revisão ofensiva de segurança

Revisão caixa-branca por um agente independente (modelo de ameaças, controles por camada, resíduos e achados em [`SEGURANCA.md`](SEGURANCA.md)), com duas suítes que ficaram no repositório:

| Suíte | O que faz | Antes das correções | Depois |
|---|---|---|---|
| `tests/security/offensive.test.js` (node:test, Postgres+RLS real, GoTrue falso, S3 falso em memória) | 50 testes ofensivos: autenticação (oráculos de tempo, força bruta, reuso de refresh, logout), autorização (IDOR em arquivos, versões, lixeira), injeção (SQL/NUL/protótipo), XSS (corpus + evasões por caracteres de formato), CSRF, uploads, cadeia de suprimento (build reprodutível, `npm audit`) | 45 aprovados, **5 falhas = 5 achados reais** (AF-1 alto, AF-2 alto, AF-3 médio, AF-4 médio, AF-5 baixo) | **50/50** (faz parte de `npm run test:security`: 111/111) |
| `tests/security/offensive-browser.cjs` (Playwright contra a pilha real do `dev.js`) | 62 verificações no navegador: CSP, cookies, cliques forjados, XSS armazenado no editor/visualizar, exportação | 62/62, 0 violações de CSP espontâneas | não reexecutada (as correções não tocam nas páginas) |

Correções aplicadas no mesmo dia (detalhes e estado em `SEGURANCA.md` §4): **AF-1** senha só em estado de recuperação (403 fora dele); **AF-2** upload direto por área de preparo por usuário, posse só após conferir os bytes; **AF-3** NUL → 400; **AF-4** U+000C tratado como espaço no lint; **AF-5** *policy* de arquivos restrita à cópia de trabalho (migração 0005); **cadeia de suprimento** `sharp` fixado em 0.35.5 (`npm audit --omit=dev` em 2026-10-07: **0 vulnerabilidades**). Resíduos aceitos e documentados: JWT sem estado até expirar após logout (≤ 1 h), ausência de MFA/SSO (recomendações P1).

## 9. O que não pôde ser testado aqui

- Supabase real (Auth, Postgres gerenciado, Storage S3), Vercel (Functions, CDN, limites de 4,5 MB), GitHub Actions, domínio/HTTPS real, SMTP e entregabilidade de e-mail, SSO da A&M.
- Navegadores além do Chromium (Firefox, Safari).
- Latência de rede real entre Brasil e as regiões dos fornecedores.
