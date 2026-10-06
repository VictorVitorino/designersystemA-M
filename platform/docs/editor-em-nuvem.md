# Editor em nuvem (B2) — como funciona, como operar, o que foi provado

Este documento descreve o build "cloud" do editor Canteiro, a extensão `ed-50-cloud.js`, o módulo compartilhado `cloud-core.js`, o build do site com CSP
e as provas de preservação. O contrato da API é `platform/docs/API.md` (fonte da verdade); aqui só o que o cliente faz com ele.

## 1. Princípio: o editor original não muda

- `studio/` e `original/` ficam **intocados** (os testes calculam o hash de cada arquivo antes e depois do build e conferem `git status`).
- `python3 studio/assemble.py` continua produzindo o arquivo **byte-idêntico** ao original: sha256 `dc93ceac9ab85f6cf5d233b94639ea2051e58d9f61da3a5d1a9b5148b5135099`.
- O build cloud trabalha numa **cópia** (`platform/.tmp/cloud-build`): acrescenta `ed-49-cloud-core.js` e `ed-50-cloud.js/.css` e aplica **6 patches** de texto
  (`studio-cloud/patches.json`, cada `antes` exatamente 1×). `preservacao.test.js` prova que *build cloud − extensão = build autônomo + patches* por igualdade exata de texto.
- Sem `window.AM_CLOUD` o editor cloud é o original (modo inerte): o portão de `studio/` roda sobre ele numa cópia (`platform/.tmp/preserve`).

## 2. Como o editor sabe que está na nuvem

O build acrescenta ao `<head>` um pequeno script (com hash na CSP) que lê `location.pathname`:

| Caminho | `window.AM_CLOUD` |
|---|---|
| `/editor/<uuid>` | `{apiBase:'/api', presentationId, mode:'edit', pdfjsBase:'/vendor/pdfjs-4.10.38/'}` |
| `/visualizar/<uuid>` | idem, `mode:'view'` |
| qualquer outro (inclusive `file://`) | não define nada → editor original |

A Vercel serve o **mesmo** HTML nas duas rotas (`/editor/:id` e `/visualizar/:id` → rewrites).

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

### Estados da pílula (ao lado de Desfazer/Refazer; `aria-live=polite`)
| Estado | Texto | Quando |
|---|---|---|
| `saved` | Salvo na nuvem às 14:32 | PUT confirmado |
| `saving` | Salvando… | mudança pendente ou PUT em andamento |
| `offline` | Sem conexão — alterações guardadas neste computador | sem rede / 5xx / 429 (retry 1 s → 60 s, jitter ±25 %, e já no evento `online`) |
| `reconnecting` | Reconectando… | durante a nova tentativa |
| `conflict` | Conflito — escolha como resolver | 409 |
| `readonly` | Somente leitura | 403 (perdeu a permissão) |
| `expired` | Sessão expirada — … | 401 que o refresh não resolveu |
| `error` | Não foi possível salvar — abra o menu | 4xx inesperado (mensagem do servidor) |

O texto se adapta (completo → curto → só o ícone) por medição: a barra do editor **nunca** estoura (testado de 1180 a 1920 px) e o nome da apresentação
nunca fica abaixo de 110 px. O texto completo está sempre no menu (cabeçalho), no `title`, no `aria-label` e na região `aria-live`.
Clique/Enter na pílula abre o menu: Salvar versão agora… (`Ctrl+S`), Histórico de versões…, Criar cópia, Compartilhar (copiar link), Voltar ao acervo
(mais "Tentar salvar de novo", "Resolver o conflito…", "Entrar de novo…" quando fizer sentido).

### Falha de conexão e fila local
IndexedDB `canteiro-cloud`, depósito `pending`, chave = id da apresentação: `{json (deck com data:), baseRev, ts}` — gravado ~1 s depois de cada mudança e a cada tentativa de PUT,
apagado após a confirmação do servidor. Ao reabrir: pendência **mais nova** que o servidor e diferente dele → "Recuperar alterações não salvas?" (**Recuperar** reaproveita o `baseRev`
original: se a nuvem mudou nesse meio-tempo, o conflito aparece na hora e nada é sobrescrito em silêncio) × **Descartar**. `beforeunload` só pergunta com alterações não confirmadas
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

### Abrir…/Novo/modelos dentro da nuvem
Trocam o deck inteiro (`am:load`): o `deck.id` continua o da nuvem e, **antes** de gravar o novo conteúdo, a extensão grava um ponto "Antes de substituir" com o que estava na nuvem.

### Visualizar (`/visualizar/<id>`, qualquer usuário ativo)
Carrega, hidrata, **oculta a interface do editor** e inicia a apresentação; `Esc` volta a `/acervo?foco=<id>`. Uma barra discreta **fora do palco** traz "← Acervo", o título/dono e **Criar cópia para usar**
(`duplicate` → `/editor/<novo>`); o dono também vê "Editar". Nenhum PUT parte do cliente (e o servidor também bloqueia).

### Interações (formulários, quadros, votações)
`Storage.prototype.setItem` é envolvido **só** para as chaves `amForm.<id>.<el>`, `amBoard.…`, `amVote.…` (e para descartar `amStudio.draft`, ver §6):
cada **novo** envio de formulário vira um `POST …/interactions {kind:'form_response'}`; quadro/votação enviam o estado da pessoa (`board_state`/`vote_state`, 1,2 s de debounce).
Fila com retry (e persistida no IndexedDB): falha de rede **nunca** quebra a apresentação. Ao abrir, `GET …/interactions` restaura **o estado próprio** (filtrado por `author.id`) no `localStorage`.

## 4. CSP e cabeçalhos (`tools/csp.js`, `tools/build-web.js`)
- Páginas comuns: `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`.
- Editor (`/editor/`, `/visualizar/`): `script-src` = **um `'sha256-…'` por `<script>` inline executável do HTML montado** (hoje 15) + `'strict-dynamic'`; `style-src 'self' 'unsafe-inline' fonts.googleapis.com` (o editor usa `style=""` em centenas de pontos);
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

## 6. Privacidade em computador compartilhado
Na nuvem o editor **não** grava o rascunho em `localStorage` (`amStudio.draft` é descartado) nem copia a apresentação para "Minhas obras" (IndexedDB local `canteiro`): `AMHist.put/touch/saveNow` viram no-op.
A única cópia local é a fila `canteiro-cloud` (apagada após o salvamento confirmado) e as respostas de formulário que a própria pessoa enviou. "Minhas obras…" (acervo local antigo) continua abrindo, intacto.

## 7. Suposições sobre o contrato (para o backend conferir)
1. `GET …/interactions` devolve itens `{id, kind, elementId, payload, author:{id,displayName}, createdAt, updatedAt}`; a extensão filtra o estado próprio por `author.id`.
   `form_response.payload = {at, q:[perguntas], a:[respostas]}`; `board_state/vote_state.payload` = o objeto guardado em `localStorage` (≤ 64 KB).
2. `PUT …/content` com `snapshot:true` cria o ponto mesmo se o conteúdo for idêntico (`unchanged:true` + `snapshotNo`) — usado em "Antes de substituir" e em "Salvar versão agora" sem mudanças.
3. `POST /api/assets/check` devolve como faltantes também os arquivos que o servidor tem mas o usuário ainda não "possui"; o `PUT` então responde 200 `deduplicated:true`.
4. Arquivos > 4 MB: o contrato prevê URL assinada direta (`/assets/uploads`), mas ela exigiria o host do bucket em `connect-src`, que a CSP pedida não lista. O MVP recomprime no cliente
   (WebP, ≤ 3,6 MB) e usa sempre `PUT /api/assets/:sha`. `GET /api/assets/:sha` precisa responder com os bytes (≤ 8 MB) — um `302` para outro host seria bloqueado por `connect-src`.
5. `/acervo?foco=<id>` e `/entrar?next=<caminho>&aba=1` são páginas do B1.

## 8. Limites conhecidos
- Texto em edição (campo ativo) só entra no deck ao sair do campo (comportamento do editor); a extensão tira o foco ao fechar/sair para não perdê-lo, mas uma queda do navegador no meio da digitação perde o trecho ainda não confirmado.
- Duas pessoas editando o mesmo deck: a revisão otimista impede sobrescrita silenciosa, mas não há mesclagem automática (por regra de produto só o dono/admin edita).
- Admin que edita a apresentação de outra pessoa aparece como autor da versão (servidor).

## 9. Testes e evidências (reexecutáveis)
| Comando | O que prova | Resultado desta entrega |
|---|---|---|
| `node --test tests/cloud/cloud-core.test.js` | hash e JSON canônico idênticos ao `src/lib/canonical.js` em 300 valores gerados (+ erros iguais para NaN/BigInt/ciclos…); `dataUrl` ida-e-volta byte a byte; externalizar/hidratar sem alterar a entrada, dedup (2× a mesma imagem = 1 envio), cache (0 hashes e 0 consultas no 2º salvamento), concorrência limitada, lotes de 200, falha parcial (aviso SVG + `stats.missing`, e a referência volta ao salvar), `shrink` para imagens grandes, `extractDeckFromHtml`, `parseAcervoJson` | **15 de 15** |
| `node tests/cloud/editor-cloud.test.js` | Chromium real contra o mock em memória, servido **com a CSP de `dist/csp.json`**: 20 cenários — boot/modo inerte/hashes da CSP, hidratação, autosave (debounce, `baseRev`, sem `data:` no corpo, dedup, miniatura, Ctrl+Z, título), imagem > 4 MB, offline→online, fechar com pendência e recuperar/descartar, backoff, conflito 409 (3 saídas), histórico (listar/pré-visualizar/restaurar/baixar), Ctrl+S × botão Salvar, menu e teclado, atalhos do editor (F1, F5/Esc, Ctrl+A/D/Delete), sessão (refresh, expirada, nova aba), dono × não-dono × admin, visualizar, criar cópia, formulário/quadro/votação ↔ API (inclusive 503 e restauração em outro computador), exportar HTML/PDF/PowerPoint, importar PPTX e PDF, Abrir…, beforeunload, pílula de 1180 a 1920 px (online e offline), 390 px | **101 de 101**, 0 violações de CSP, 0 erros de console/página |
| `node tests/cloud/preservacao.test.js` (`PRESERVE_FULL=1`: portão completo) | `studio/` e `original/` intactos; build autônomo byte-idêntico (sha256 `dc93ceac…5099`); *cloud − extensão = autônomo + 6 patches* (igualdade exata); patches errados quebram o build; 1936 KB ≤ 2000 KB; portão de `studio/` sobre o build cloud sem `AM_CLOUD` | **15 de 15**, incluindo `GATE PASS` com as **35 baterias** (530 s) |
| `node tools/build-web.js --check` | `vercel.json` (CSP com os hashes dos 15 scripts inline) confere com o build | ok |

Capturas (ignoradas pelo git) em `platform/tests/screens/cloud-*.png`: barra com a pílula em 1180/1440/1920 (e offline), conflito, histórico, sessão expirada, recuperação, visualizar (1440 e 390 px), editor salvo e importado.

Para ver à mão: `node tools/build-web.js && node tests/cloud/mock-api.js 4202` — o mock cria uma apresentação de teste e imprime os links `…/__test/enter?user=ana&to=/editor/<id>` (entra como Ana, Bia ou Admin e abre o editor ou `/visualizar/<id>`).
