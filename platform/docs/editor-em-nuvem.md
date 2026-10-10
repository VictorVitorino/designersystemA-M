# Editor em nuvem (B2) — como funciona, como operar, o que foi provado

Este documento descreve o build "cloud" do editor Canteiro, a extensão `ed-50-cloud.js`, o módulo compartilhado `cloud-core.js`, o build do site com CSP
e as provas de preservação. O contrato da API é `platform/docs/API.md` (fonte da verdade); aqui só o que o cliente faz com ele.

## 1. Princípio: a plataforma não muda o editor

- `studio/` e `original/` ficam **intocados** (os testes calculam o hash de cada arquivo antes e depois do build e conferem `git status`).
- Duas garantias, separadas:
  - **Original**: `original/Canteiro-AM (3).html` é a cópia preservada do arquivo enviado (S34b) e confere com `original/SHA256SUMS`
    (`ORIGINAL_SHA256` = `dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099`). Ele **não** precisa ser igual ao build atual: `studio/` evolui, o original não.
  - **Build publicado**: `AM-Studio-Editor.html` e `Canteiro-AM.html` na raiz são o build que a última etapa de `studio/` publicou depois do portão
    (regra 5 do processo no `CLAUDE.md`). `python3 studio/assemble.py` tem de produzir esse arquivo **byte a byte** (`node tools/build-cloud-editor.js --verify-standalone`;
    hoje sha256 `«PREENCHER»`). O build em nuvem e a prova de paridade (lado A = `../AM-Studio-Editor.html`) seguem esse build, não o `original/`.
  - Uma etapa nova em `studio/` muda o SHA-256 do build sem quebrar a plataforma: passa o portão de `studio/`, publica na raiz e roda de novo
    `--verify-standalone`, `tests/cloud/preservacao.test.js` e `npm run test:parity`. Os patches continuam sendo conferidos 1× cada (se o trecho mudou, o build falha).
- O build cloud trabalha numa **cópia** (`platform/.tmp/cloud-build`): acrescenta `ed-49-cloud-core.js` e `ed-50-cloud.js/.css` e aplica **6 patches** de texto
  (`studio-cloud/patches.json`, cada `antes` exatamente 1×). `preservacao.test.js` prova que *build cloud − extensão = build autônomo + patches* por igualdade exata de texto.
- Sem `window.AM_CLOUD` o editor cloud é o editor autônomo (modo inerte): o portão de `studio/` roda sobre ele numa cópia (`platform/.tmp/preserve`).

## 2. Como o editor sabe que está na nuvem

O build acrescenta ao `<head>` um pequeno script (com hash na CSP) que lê `location.pathname`:

| Caminho | `window.AM_CLOUD` |
|---|---|
| `/editor/<uuid>` | `{apiBase:'/api', presentationId, mode:'edit', pdfjsBase:'/vendor/pdfjs-4.10.38/'}` |
| `/visualizar/<uuid>` | idem, `mode:'view'` |
| qualquer outro (inclusive `file://`) | não define nada → editor autônomo (modo inerte) |

A Vercel serve o **mesmo** HTML nas duas rotas (rewrites `/editor/:id(<uuid>)` e `/visualizar/:id(<uuid>)`). **Sem o UUID** de uma apresentação
(`/editor`, `/editor/`, `/editor/abc`, `/editor/index.html`, `/visualizar/x`…) o servidor responde **302 → `/acervo`** — nos `redirects` do `vercel.json`
(gerados por `tools/build-web.js`) e em `src/static.js` (`editorWithoutId`). Assim um link cortado nunca abre o editor autônomo fora da nuvem (sem salvar
no servidor e sem aviso). O modo inerte continua existindo para `file://` e para o portão de preservação (cópia local do HTML).

## 3. Fluxos

### Abrir (`/editor/<id>`)
`GET /api/auth/session` (sem sessão → `/entrar?next=…`) → `GET /api/presentations/:id` → `canEdit=false` em `/editor` redireciona para `/visualizar` →
`cloud-core.hydrateDeck` troca `asset:sha256:…` por `data:` (4 downloads em paralelo, barra de progresso; uma imagem que falha vira um aviso SVG, não derruba o deck) →
`AMStudio.loadDeck(deck, null, true, true)` (que sanitiza) com `deck.id` = id da apresentação. Nenhum PUT é feito só por abrir.

### Salvar (autosave)
```
edição ─► patch: commit()/desfazer/refazer dispara 'am:commit'
       ─► pílula "Salvando…"; debounce de 3 s  (flush imediato: aba escondida, pagehide, beforeunload, Início → acervo)
       ─► grava a fila local (IndexedDB) ─► cloud-core.externalizeDeck: hash (cache por string), POST /assets/check, PUT só do que falta (4 em paralelo)
       ─► (miniatura do slide 1: ≤ 60 KB, no máx. 1×/60 s e só se o slide 1 mudou, kind=thumb)
       ─► PUT /presentations/:id/content {baseRev, content, thumbSha?}
       ─► 200 → rev local = rev do servidor (CONFIRMAÇÃO), fila local apagada, pílula "Salvo na nuvem às HH:MM"
```
Um PUT por vez; mudança durante um PUT agenda outro depois dele (baseRev encadeado). Imagens > ~3,6 MB (limite de 4 MB das Functions) são recomprimidas
no navegador em WebP antes do envio (`shrink`); o deck do editor continua com a original.

### Imagens que o servidor não guarda (SVG, BMP, AVIF, ICO…)
O editor aceita qualquer imagem que o navegador desenhe; o servidor só guarda PNG, JPEG, WebP e GIF (e recusa `data:image/svg+xml`). Antes de externalizar,
`cloud-core.rasterizeForeignImages(deck, {rasterize: browserRasterize, cache})` desenha cada `data:image/<outro tipo>` (string inteira: `src`, `bgImg`…) num
canvas e troca por PNG — SVG com o maior lado em 1920 px (nítido em tela cheia; sem tamanho próprio, usa o `viewBox`), as demais no tamanho natural até
1920 px. Isso vale **só na cópia que sobe**: o deck do editor continua com a imagem original (nada de passo de desfazer fantasma) e o cache evita desenhar
de novo a cada salvamento. O que o navegador não consegue desenhar (TIFF, HEIC) fica como está: o servidor recusa e a caixa de "conteúdo recusado" diz o slide.
A página `/importar` aplica o mesmo passo antes do `POST`.

### Estados da pílula (ao lado de Desfazer/Refazer; `aria-live=polite`)
| Estado | Texto | Quando |
|---|---|---|
| `saved` | Salvo na nuvem às 14:32 | PUT confirmado |
| `saving` | Salvando… (ou "Enviando imagens (12 de 80)…") | mudança pendente ou PUT em andamento; com 3+ imagens novas mostra o progresso do envio |
| `offline` | Sem conexão — alterações guardadas neste computador | sem rede / 5xx / 408 (retry 1 s → 60 s, jitter ±25 %, e já no evento `online`) |
| `reconnecting` | Reconectando… | durante a nova tentativa |
| `throttled` | Aguardando o servidor — alterações guardadas neste computador | **429** (limite de envios, ex.: importar um PDF com muitas imagens): espera o `Retry-After` e continua de onde parou (o que já subiu não sobe de novo); sem aviso de "Sem conexão" |
| `conflict` | Conflito — escolha como resolver | 409 |
| `readonly` | Somente leitura | 403 (perdeu a permissão) ou outra conta entrou neste navegador |
| `expired` | Sessão expirada — … | 401 que o refresh não resolveu |
| `rejected` | Conteúdo recusado pela nuvem — abra o menu | **422 `rejected_content`**: ver abaixo |
| `error` | Não foi possível salvar — abra o menu | 413 (grande demais) ou 4xx inesperado (mensagem do servidor) |

### Conteúdo recusado (422) e tamanho (413)
O servidor devolve `error.details.issues = [{slide (1-based), elementId, reason}]` (até 20; sem eco do conteúdo; `slide`/`elementId` podem vir `null` quando o problema
não é de um slide — a linha diz "Apresentação: …"; servidor antigo: `details.findings[].path` `slides[i].els[j]…`, também entendido). A extensão mostra uma caixa "A nuvem não aceitou parte desta apresentação" com uma linha por problema —
"Slide 2 · texto: código HTML não permitido (como <script>, <form> ou <iframe>)", "Slide 5 · imagem: imagem SVG embutida"… — e o botão **Ir ao slide N**
(vai ao slide e seleciona o elemento). Se a pessoa estiver digitando, vira um aviso e a caixa fica no menu da pílula ("Ver o que impede salvar…").
Enquanto o trecho recusado não mudar (impressão digital dos elementos/slides apontados), o autosave **não repete o PUT** — as edições ficam na fila local;
mudou o trecho, volta a tentar sozinho ("Tentar salvar de novo" força). O limite de **4 MB por salvamento é medido em bytes UTF-8** (o corpo JSON é codificado
uma vez, medido e enviado assim — acentos contam 2 bytes); acima dele, nada é enviado e uma caixa explica (uma vez; depois só avisa até voltar a salvar). Um 413 do
servidor (`too_large`) recebe a mesma explicação.

O texto se adapta (completo → curto → só o ícone) por medição: a barra do editor **nunca** estoura (testado de 1180 a 1920 px) e o nome da apresentação
nunca fica abaixo de 110 px. O texto completo está sempre no menu (cabeçalho), no `title`, no `aria-label` e na região `aria-live`.
Clique/Enter na pílula abre o menu: Salvar versão agora… (`Ctrl+S`), Histórico de versões…, Comentários (N)…, Criar cópia, Compartilhar (copiar link), Voltar ao acervo
(mais "Ver o que impede salvar…", "Tentar salvar de novo", "Resolver o conflito…", "Entrar de novo…" quando fizer sentido).

### Falha de conexão e fila local
IndexedDB `canteiro-cloud` (versão 2), depósito `pending`, chave = id da apresentação: `{json (deck com data:), baseRev, ts, uid}` — gravado ~1 s depois de cada mudança e a cada tentativa de PUT,
apagado após a confirmação do servidor. Ao reabrir: pendência **da mesma pessoa** (`uid`) e **diferente** do conteúdo do servidor → "Recuperar alterações não salvas?" (**Recuperar** reaproveita o `baseRev`
original: se a nuvem mudou nesse meio-tempo — `baseRev < rev` do servidor —, a caixa avisa e o conflito aparece na hora; nada é sobrescrito em silêncio) × **Descartar**.
A decisão é por **conteúdo e revisão**, nunca comparando o relógio deste computador com o do servidor (um relógio atrasado não apaga mais pendências); a hora só aparece no texto. `beforeunload` só pergunta com alterações não confirmadas
(o aviso próprio do editor, que perguntava sempre que havia histórico de desfazer, é desligado na nuvem pelo patch `f`).

### Sessão
Cookies `HttpOnly` (o JS nunca vê token); CSRF por cabeçalho `X-CSRF-Token` (cookie `…am_csrf`). 401 `session_expired` → `POST /api/auth/refresh` **uma vez** e o pedido é refeito;
se falhar: "Sua sessão expirou", alterações mantidas, "Entrar numa nova aba" abre `/entrar?next=…` sem fechar o editor e "Já entrei — tentar de novo" retoma.

### Conflito (409)
Caixa com quem alterou, quando e a versão (`serverRev/updatedBy/updatedAt`) e três saídas:
**Manter a minha versão** (`PUT resolution:'overwrite'`, `baseRev=serverRev`; o servidor guarda a anterior como `pre_overwrite`),
**Carregar a versão da nuvem** (antes oferece baixar a minha como `.html`), **Salvar a minha como cópia** (`duplicate` + PUT na cópia e abre a cópia). "Decidir depois" mantém o conflito (as edições seguem guardadas localmente).

### Histórico (só dono/admin)
Lista (`GET …/versions`): rótulo/tipo, data, autor, nº de slides; pré-visualização do 1º slide; **Restaurar** (`POST …/versions/:no/restore {baseRev}`, depois de salvar o que estava pendente) e **Baixar (.html)**.
`Ctrl+S` = versão manual imediata (sem baixar nada); o botão **Salvar** e "Salvar como…" continuam baixando HTML/PDF/PowerPoint (exportação offline preservada).

### Novo, Abrir…, projetos prontos e "Minhas obras" dentro da nuvem
Nada disso apaga, troca ou renomeia a apresentação aberta sem a pessoa escolher:
- **Novo** (botão e Arquivo › "Nova apresentação no acervo"): salva o que estiver pendente e cria **outra** apresentação (`POST /api/presentations {source:'new'}`) → `/editor/<nova>`.
- **Abrir…** (botão, Arquivo › "Abrir arquivo…", `Ctrl+O`, arrastar um `.html`/`.json` para o slide) e **importar PowerPoint/PDF substituindo**: vão direto ao arquivo (sem a caixa do
  editor "O que não foi salvo com Salvar apresentação…", que não vale na nuvem). Numa apresentação **em branco** o conteúdo entra no lugar. Numa apresentação **com conteúdo**
  a da nuvem volta ao editor (nada é gravado) e a caixa oferece **Criar como nova apresentação no acervo** (`POST {source:'import', content}` → abre a nova) ×
  **Substituir esta (a atual fica no histórico)** (o `deck.id` continua o da nuvem e, antes do novo conteúdo, grava-se o ponto "Antes de substituir") × Cancelar.
- **Projetos prontos**: o acervo cria a apresentação e abre `/editor/<nova>?modelo=N` (ver abaixo).
- **Minhas obras…** vira **Acervo da nuvem…** e leva a `/acervo?aba=minhas`; `AMCover.openHist()`/`open('hist'|'tpl'|…)` também levam ao acervo. A capa local só abre pelo
  **Manual da obra** (com os passos reescritos para a nuvem), sem o botão "Minhas obras"; soltar arquivo sobre ela não faz nada; `Ctrl+S` com ela aberta não baixa nem salva escondido.

### Parâmetros de URL (links do acervo → editor)
Lidos depois de carregar (e de oferecer a recuperação), e retirados da URL (`history.replaceState`):

| Parâmetro | O que faz | Quem |
|---|---|---|
| `?modelo=<0..5>` | aplica o projeto pronto N (`AMCover.buildTemplate(N)`, a mesma lista da capa) **só se a apresentação estiver em branco** e salva; com conteúdo, avisa e não troca | quem edita |
| `?historico=1` | abre "Versões desta apresentação" | quem edita |
| `?exportar=html\|pdf\|pptx` | `html` baixa o arquivo; `pdf`/`pptx` abrem a caixa de exportação do editor | quem edita (dono/admin) — quem não é dono vai ao `/visualizar` e precisa criar cópia |

### Rótulos e teclado na nuvem
- "Salvar" na nuvem é automático (pílula) e `Ctrl+S` = **versão**: o botão laranja diz **Baixar arquivo (.html)** (≤ 1366 px: "Baixar"), a seta **Baixar como… PDF, PowerPoint ou HTML**,
  Arquivo › "Baixar arquivo (.html)" / "Baixar como PDF…" / "Baixar como PowerPoint…" (sem `Ctrl+S` ao lado); o aviso diz "Arquivo baixado". Início, a marca A&M e Arquivo ›
  "Voltar ao acervo" dizem o que fazem; a ajuda (F1) mostra "Salvar versão na nuvem — Ctrl+S".
- Caixas, menu e telas "Abrindo…"/erro da nuvem ficam com o teclado: nada vaza para o editor por trás; F5, F1, `Ctrl+S/O/D/P` (e `Ctrl+A` fora dos campos) não chegam ao navegador
  (sem recarregar, "Salvar página como" ou abrir arquivo). Com o menu da pílula aberto, `Ctrl+S` salva a versão (o menu mostra o atalho) e F5/F1 fecham o menu antes de seguir.
  Com uma caixa do próprio editor aberta (exportar, importar, kit de marca, CSV), `Ctrl+S` fica com ela; na capa e durante a apresentação, não age escondido.
  `Ctrl+S` que não salva diz por quê (sem conexão, servidor pedindo pausa, conflito, sessão expirada, somente leitura, conteúdo recusado).
- Caixas, menu e abertura usam o visual do editor (`.mdl`/`.mb`/`.menu`: faixa laranja/navy, ícone, sobretítulo em JetBrains Mono, fundo com desfoque; abertura com o fundo da capa).

### Imagens com endereço da internet (`https://…`)
A CSP do editor mantém `img-src 'self' data: blob:` (sem `https:`): uma imagem remota vinda de um arquivo aberto não aparece. Ao abrir (ou ao trocar o conteúdo), a extensão
conta essas imagens e explica: "N imagens desta apresentação não aparecem na versão online… baixe cada imagem para o computador e insira de novo pelo botão Imagem".

### Comentários (`/api/presentations/:id/comments`, `/api/comments/:id`)
Painel lateral (editor: menu da pílula › Comentários; visualizar: botão "Comentários" na barra, por cima da apresentação). Mostra os comentários do **slide atual** (e os gerais,
sem slide) ou de todos; "Mostrar resolvidos"; **comentar no slide atual** (`slideIndex` = posição do slide; `Ctrl+Enter` envia); **Resolver/Reabrir** e **Excluir** conforme
`canResolve`/`canDelete` do servidor; clicar em "Slide N" leva ao slide. Teclas digitadas no painel não mudam o slide nem saem da apresentação; `Esc` fecha.

### Preferências da pessoa (`GET/PUT /api/me/prefs`)
Ao abrir (modo edição), `prefs.brandKits` (kits de marca salvos) e `prefs.editor` (`recentColors`, `sideW`, `sideOff`, `gxWide`) voltam ao `localStorage` deste navegador; cada
gravação dessas chaves pelo editor sobe (1,5 s de espera, juntando gravações seguidas) com `PUT {prefs}` — o servidor **substitui o objeto inteiro**, então a extensão lê o que
está no servidor naquele momento, troca só as chaves que esta aba mudou e grava (o que outro computador gravou, e chaves que ela não conhece, continuam; o que veio do servidor
volta para este navegador). 429 (limite de 60 gravações por minuto) ou falta de rede: tenta de novo depois do `Retry-After` (no mínimo 5 s), sem perder o
que mudou; 400/413/422: fica só neste navegador. Sem a rota, tudo fica só no navegador, como no original. Kits valem na hora; largura/estado do painel lateral e da vitrine valem a partir da próxima abertura.

### Visualizar (`/visualizar/<id>`, qualquer usuário ativo)
Carrega, hidrata, **oculta a interface do editor** e inicia a apresentação; `Esc` volta a `/acervo?foco=<id>`. Uma barra discreta **fora do palco** traz "← Acervo", o título/dono e **Criar cópia para usar**
(`duplicate` → `/editor/<novo>`); o dono também vê "Editar". Nenhum PUT parte do cliente (e o servidor também bloqueia).

### Interações (formulários, quadros, votações)
`Storage.prototype.setItem` é envolvido **só** para as chaves `amForm.<id>.<el>`, `amBoard.…`, `amVote.…`, as de preferências (acima) e para descartar `amStudio.draft` (ver §6):
cada **novo** envio de formulário vira um `POST …/interactions {kind:'form_response', clientId}`; quadro/votação enviam o estado da pessoa (`board_state`/`vote_state`, 1,2 s de debounce).
Fila com retry (e persistida no IndexedDB, com o `uid` de quem a criou): falha de rede **nunca** quebra a apresentação, e cada item leva um **`clientId`** — se a resposta HTTP se perder
depois de gravada, o reenvio devolve o item existente em vez de duplicar (quadro/votação são um estado único por pessoa e elemento: o servidor aceita o `clientId` e o ignora).
Tetos em bytes (contrato): resposta de formulário **abaixo de 64 KB**, estado de quadro/votação até **256 KB**; acima disso
nada sobe e a pessoa é avisada ("passou de 256 KB… use Baixar CSV"); 413/409 do servidor também viram aviso. Ao abrir, `GET …/interactions` restaura **o estado próprio**
(filtrado por `author.id`) no `localStorage` — menos o que a pessoa limpou neste navegador ("Limpar" apaga só daqui e não volta ao reabrir; o servidor continua
com tudo). Os textos do formulário e da votação dizem a verdade na nuvem (antes de responder: "Ao enviar, a resposta vai com o seu nome para o
dono da apresentação"; depois: "Resposta enviada com o seu nome ao dono da apresentação", "Respostas apagadas só deste computador…"), e uma planilha com endereço fora do Google é explicada ("na versão online só vale o endereço de um app do Google") em vez de "sem internet".

## 4. CSP e cabeçalhos (`tools/csp.js`, `tools/build-web.js`)
- Páginas comuns: `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`.
- Editor (`/editor/`, `/visualizar/`): `script-src` = **um `'sha256-…'` por `<script>` inline executável do HTML montado** (hoje «PREENCHER») + `'strict-dynamic'`; `style-src 'self' 'unsafe-inline' fonts.googleapis.com` (o editor usa `style=""` em centenas de pontos);
  `font-src fonts.gstatic.com data:`; `connect-src 'self' fonts.googleapis.com fonts.gstatic.com script.google.com script.googleusercontent.com`; `worker-src 'self' blob:`; `frame-src 'self' blob:`; `frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`.
  Blocos `application/json`/`text/plain` não executam e não levam hash. O hash é calculado do HTML final (inclui o script de boot).
- Todas as páginas: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP `same-origin`, `X-Robots-Tag: noindex`.
- Cache: `/vendor/pdfjs-4.10.38/` imutável (a versão está no caminho); `/assets/` 1 dia + stale-while-revalidate; `/js/` e HTML sempre revalidam.
- `vercel.json` é **gerado** (`node tools/build-web.js`) e **versionado**; `node tools/build-web.js --check` no CI falha se a CSP (hashes) estiver desatualizada.

**Achado em Chromium real (141): `'strict-dynamic'` + hash não autoriza `import()` nem `<script type=module>`** vindos de um script inline (só scripts *clássicos* criados por ele passam).
O editor importa o pdf.js (`.mjs`) por `import()`. Solução sem afrouxar a CSP: o build gera, sem tocar em `studio/vendor`, `vendor/pdfjs-4.10.38/pdf.classic.js`
(o mesmo arquivo, com o `export{…}` final trocado por `globalThis.__am_pdfjs=…` e o único `import.meta.url` por `location.href`, dentro de uma função estrita; a sintaxe é conferida no build);
a extensão define `AM_PDFJS_IMPORT`, que o patch `d-pdfjs` chama, e o carrega por `<script>`. O worker continua `new Worker(…pdf.worker.min.mjs, {type:'module'})` (`worker-src 'self'`).
Resultado: importar PDF, PPTX, exportar HTML/PDF/PowerPoint e apresentar rodam com **zero violações** (listener `securitypolicyviolation` + console em todos os testes).

## 5. Build do site
`dist/public` = `web/` (páginas, B1) + `/js/cloud-core.js` + `/editor/index.html` e `/visualizar/index.html` (o mesmo editor) + `/vendor/pdfjs-4.10.38/` (+ `pdf.classic.js`) + `/assets/brand/*` + `/favicon.svg`; `dist/csp.json` = `{default, "/editor/", "/visualizar/"}`.
O servidor local/mock deve usar `tools/csp.js` (`readCspJson`, `cspFor`, `SECURITY_HEADERS`) para aplicar as mesmas políticas.
Na Vercel: Root Directory `platform`, habilitar *Include source files outside of the Root Directory in the Build Step* e garantir `python3` na imagem de build (o `assemble.py`); `buildCommand: node tools/build-web.js`.

## 6. Privacidade em computador compartilhado — o que fica só no navegador
Na nuvem o editor **não** grava o rascunho em `localStorage` (`amStudio.draft` é descartado) nem copia a apresentação para "Minhas obras" (IndexedDB local `canteiro`): `AMHist.put/touch/saveNow`
viram no-op e "Minhas obras…" leva ao acervo da nuvem. O que ainda fica neste navegador:

| Onde | O quê |
|---|---|
| IndexedDB `canteiro-cloud` | fila do que não chegou ao servidor: `pending` (alterações da apresentação) e `outbox` (respostas, quadros, votos) — cada registro com o `uid` de quem o criou |
| `localStorage` `amForm.` / `amBoard.` / `amVote.` | respostas, notas e votos dados neste navegador (cache; o servidor tem os enviados) |
| `localStorage` `amPlayer.notes:` | notas "Sobre este slide" editadas no player (só locais, como no original; o player avisa ao editar: "vale só neste navegador (para todos: “Sobre este slide” no editor)") |
| `localStorage` `amStudio.` | kits de marca, cores recentes, largura do painel (sincronizados por `/api/me/prefs`) |
| `localStorage` `amCloud.user` | quem usou a nuvem por último neste navegador |
| `localStorage` `amCloud.limpo.*` | o que a pessoa limpou ("Limpar" do formulário, quadro ou votação) neste navegador, para não voltar ao reabrir |

- **Sair** (páginas web: `web/js/session.js` carrega `/js/cloud-core.js` e usa `AMCloudCore.pendingLocalCount()`/`clearLocalData()` — o módulo compartilhado é quem conhece
  esses dados): se a fila tiver algo não enviado, pergunta antes ("Sair e apagar o que não foi enviado?"); depois apaga as chaves acima, `am.import.*` do `sessionStorage` e os
  bancos `canteiro-cloud` e `canteiro` (abas do editor abertas soltam a conexão sozinhas). Só então chama `/api/auth/logout`.
- **Outra pessoa entra** no mesmo navegador (`amCloud.user` diferente, conferido pelo editor ao abrir com `AMCloudCore.switchLocalUser`): respostas, votos, notas e preferências
  de quem usou antes são apagados antes de qualquer uso; registros da fila de outra pessoa nunca são oferecidos nem enviados (são apagados). Uma aba do editor que percebe outra conta na sessão
  (ao voltar a ficar visível) para de salvar e de enviar e pede para recarregar — nada vai com a identidade errada.

## 7. Suposições sobre o contrato (para o backend conferir)
1. `GET …/interactions` devolve itens `{id, kind, elementId, payload, author:{id,displayName}, createdAt, updatedAt}` (`user` é um alias de `author`); a extensão só restaura no dispositivo os itens cujo `author.id` é o da sessão carregada — item sem autor, ou sem sessão, nunca entra (E2E-01).
   `form_response.payload = {at, q:[perguntas], a:[respostas]}` (< 64 KB); `board_state/vote_state.payload` = o objeto guardado em `localStorage` (≤ 256 KB).
2. `PUT …/content` com `snapshot:true` cria o ponto mesmo se o conteúdo for idêntico (`unchanged:true` + `snapshotNo`) — usado em "Antes de substituir" e em "Salvar versão agora" sem mudanças.
3. `POST /api/assets/check` devolve como faltantes também os arquivos que o servidor tem mas o usuário ainda não "possui"; o `PUT` então responde 200 `deduplicated:true`.
4. Arquivos > 4 MB: o contrato prevê URL assinada direta (`/assets/uploads`), mas ela exigiria o host do bucket em `connect-src`, que a CSP pedida não lista. O MVP recomprime no cliente
   (WebP, ≤ 3,6 MB) e usa sempre `PUT /api/assets/:sha`. `GET /api/assets/:sha` precisa responder com os bytes (≤ 8 MB) — um `302` para outro host seria bloqueado por `connect-src`.
5. `/acervo?foco=<id>`, `/acervo?aba=minhas&foco=<id>` e `/entrar?next=<caminho>&aba=1` são páginas do B1.
6. `GET /api/me/prefs` → `{prefs:{…}}`; `PUT /api/me/prefs {prefs}` (CSRF) → `{prefs}`; só a própria pessoa; **substitui o objeto inteiro**. Chaves usadas: `brandKits` (lista), `editor` (objeto).
   400 se a forma não bater (`brandKits` não lista, `editor` não objeto, profundidade > 10 contando `prefs`, chaves `__proto__`/`constructor`/`prototype`); 413 acima de 64 KB em bytes;
   422 com HTML ativo; 429 + `Retry-After` acima de 60 gravações por minuto.
7. `POST …/interactions` aceita `clientId` (≤ 64, `[A-Za-z0-9_-]`): em `form_response`/`view`/`reaction` o mesmo (apresentação, pessoa, `clientId`) devolve o item existente (200);
   em `board_state`/`vote_state` é aceito e ignorado (upsert por pessoa e elemento). Tetos em bytes: `board_state`/`vote_state` 256 KB, `form_response` abaixo de 64 KB.
   `DELETE …/interactions?elementId=&kind=` (`elementId` obrigatório; dono/admin: tudo do elemento; demais: só os próprios) → `{deleted}` existe no contrato; o editor ainda não o usa
   (o "Limpar" do formulário, do quadro e da votação apaga só deste computador, diz isso e o que foi limpo não volta ao reabrir neste navegador; para o dono, o `DELETE`
   apagaria as respostas de todas as pessoas, então fica para uma tela própria do dono, com confirmação).
8. `422 rejected_content` traz `details.issues: [{slide (1-based) | null, elementId | null, reason}]` (≤ 20). Upload: até 300 por minuto por pessoa; acima disso, 429 + `Retry-After`.
   `PUT …/content` aceita até 4 MiB **em bytes** (limite da função na Vercel); acima disso, 413 `too_large`.
9. Comentários: `GET …/comments[?includeResolved=1]` → `{items:[{id, slideIndex, body, author, createdAt, resolvedAt, canResolve, canDelete}]}`, `POST {body, slideIndex}`, `PATCH /api/comments/:id {resolved}`, `DELETE /api/comments/:id`.

## 8. Limites conhecidos
- Texto em edição (campo ativo) só entra no deck ao sair do campo (comportamento do editor); a extensão tira o foco ao fechar/sair para não perdê-lo, mas uma queda do navegador no meio da digitação perde o trecho ainda não confirmado.
- Duas pessoas editando o mesmo deck: a revisão otimista impede sobrescrita silenciosa, mas não há mesclagem automática (por regra de produto só o dono/admin edita).
- Admin que edita a apresentação de outra pessoa aparece como autor da versão (servidor).
- Comentários da plataforma são ancorados pela **posição** do slide (`slideIndex`, contrato atual): inserir ou mover slides depois faz "Slide 3" apontar para outro slide.
  Ancorar pelo id estável do slide exige um campo novo no contrato dos comentários (ex.: `slideId`; hoje o `POST` é estrito e recusaria o campo).
- Não há, no editor nem no acervo, tela para o dono ver/baixar as respostas de todos (formulário, quadro, votação); o "Baixar CSV" do player lê só este navegador
  e o servidor entrega por `GET …/interactions` e `…/interactions.csv`.

## 9. Testes e evidências (reexecutáveis)
| Comando | O que prova | Resultado desta entrega |
|---|---|---|
| `node --test tests/cloud/cloud-core.test.js` | hash e JSON canônico idênticos ao `src/lib/canonical.js` em 300 valores gerados (+ erros iguais para NaN/BigInt/ciclos…); `dataUrl` ida-e-volta byte a byte; externalizar/hidratar sem alterar a entrada, dedup (2× a mesma imagem = 1 envio), cache (0 hashes e 0 consultas no 2º salvamento), concorrência limitada, lotes de 200, falha parcial (aviso SVG + `stats.missing`, e a referência volta ao salvar), `shrink` para imagens grandes, `extractDeckFromHtml`, `parseAcervoJson`, desenho em PNG de SVG/BMP/AVIF/ICO antes de externalizar (entrada intacta, cache, falha mantém o original), dados locais (troca de pessoa e Sair) | **17 de 17** |
| `node tests/cloud/editor-cloud.test.js` | Chromium real contra o mock em memória, servido **com a CSP de `dist/csp.json`**: 20 cenários — boot/modo inerte/hashes da CSP, hidratação, autosave (debounce, `baseRev`, sem `data:` no corpo, dedup, miniatura, Ctrl+Z, título), imagem > 4 MB, offline→online, fechar com pendência e recuperar/descartar, backoff, conflito 409 (3 saídas), histórico (listar/pré-visualizar/restaurar/baixar), Ctrl+S × botão Salvar, menu e teclado, atalhos do editor (F1, F5/Esc, Ctrl+A/D/Delete), sessão (refresh, expirada, nova aba), dono × não-dono × admin, visualizar, criar cópia, formulário/quadro/votação ↔ API (inclusive 503 e restauração em outro computador), exportar HTML/PDF/PowerPoint, importar PPTX e PDF, Abrir…, beforeunload, pílula de 1180 a 1920 px (online e offline), 390 px; e as correções da auditoria (cenários 21–38): SVG/BMP/ICO salvos como PNG, Novo cria outra, Abrir… com escolha nova × substituir, ?modelo/?historico/?exportar, Minhas obras → acervo e capa só com o manual, computador compartilhado e Sair, 422 com o slide e sem repetir o PUT, 429 sem "Sem conexão", tetos 64/256 KB e clientId, preferências (outro computador, 429 com Retry-After, ler e mesclar antes de gravar), textos do formulário (aviso antes de responder, "Limpar" só deste computador) e das notas do player, comentários (editor e visualizar), teclado (menu, caixas, telas de abertura/erro), rótulos, imagens https, visual = modal do editor, relógio atrasado, limite de 4 MB em bytes UTF-8 | **171 de 171** (38 cenários), 0 violações de CSP, 0 erros de console/página |
| `node tests/cloud/preservacao.test.js` (`PRESERVE_FULL=1`: portão completo) | `studio/` e `original/` intactos; build autônomo byte-idêntico ao **build publicado na raiz** (`AM-Studio-Editor.html` = `Canteiro-AM.html`, sha256 `«PREENCHER»`; PR-01/PR-02); `original/` conferindo com `SHA256SUMS` (`dc93ceac…5099`; PR-11/PR-11b); *cloud − extensão = autônomo + 6 patches* (igualdade exata); patches errados quebram o build; «PREENCHER» KB ≤ 2000 KB; portão de `studio/` sobre o build cloud sem `AM_CLOUD` | **«PREENCHER»**, incluindo `GATE PASS` com as **«PREENCHER» baterias** («PREENCHER» s) |
| `node tools/build-web.js --check` | `vercel.json` (CSP com os hashes dos «PREENCHER» scripts inline) confere com o build | ok |

Capturas (ignoradas pelo git) em `platform/tests/screens/cloud-*.png`: barra com a pílula em 1180/1440/1920 (e offline), conflito, histórico, sessão expirada, recuperação, visualizar (1440 e 390 px), editor salvo e importado.

Para ver à mão: `node tools/build-web.js && node tests/cloud/mock-api.js 4202` — o mock cria uma apresentação de teste e imprime os links `…/__test/enter?user=ana&to=/editor/<id>` (entra como Ana, Bia ou Admin e abre o editor ou `/visualizar/<id>`).
