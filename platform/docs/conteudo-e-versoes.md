# Conteúdo, versões, arquivos, comentários e interações

Este documento explica **como** e **por quê** funcionam as rotas de conteúdo (contrato HTTP em `docs/API.md` §4, §5 e §6).
Código: `src/routes/{presentations,assets,comments,interactions}.js` (HTTP) e `src/lib/{presentations-service,cursor,csv}.js` (regras).
Testes: `tests/api/{presentations,versions,assets,comments,interactions,prefs,quota}.test.js` com Postgres real (RLS) — veja o fim do documento.

## 1. Princípio: o banco decide, a API traduz

Toda rota autenticada abre **uma transação como o usuário** (`txAsUser` → `SET LOCAL ROLE app_user` + `app.user_id`). Quem pode ver/alterar é decidido pelas políticas
de `0003_security.sql` e pelos gatilhos; o JavaScript nunca recebe um "papel" do cliente. O que a API acrescenta é o **status HTTP certo**:

| Situação | Resposta |
|---|---|
| item que o usuário não vê (inclusive a lixeira dos outros, id inexistente, id que não é UUID) | **404** (igual nos três casos — nunca revela existência) |
| item visível, mas sem permissão para a ação (outro membro tentando salvar/renomear/excluir) | **403** |
| sem login | 401 · conta suspensa | 403 `suspended` |

`accessOf(tx, id)` pergunta ao banco `can_view_presentation` / `can_edit_presentation` e separa 404 de 403. Mesmo se uma checagem daqui fosse esquecida, o RLS/gatilho
negaria (`42501` vira 403 em `middleware/error.js`).

## 2. Apresentações

* **Criar** (`POST /api/presentations`): dono = quem chama (o corpo é estrito: `ownerId`, `rev` etc. dão 400). Sem conteúdo, nasce um deck em branco igual ao `newDeck()` do editor (1 slide `blank-light`).
  `source:'import'` exige conteúdo e grava o ponto `import` (nº 1).
* **Abrir** (`GET /:id`): meta + `content` + `canEdit` (decidido pelo banco) + `ETag: "<rev>"`. A listagem **nunca** devolve `content`.
* **Cópia** (`POST /:id/duplicate`): lê o que o usuário **vê**, cria **nova linha dele** (`source_id` = original), copia `asset_refs`, cria a versão `copy` (nº 1), rev 1. O título do deck acompanha
  ("Cópia de …", ≤ 200). O original é só lido: o teste compara linha e conteúdo antes/depois, e prova o isolamento nos dois sentidos (alterar a cópia não toca o original e vice-versa).
* **Renomear** (`PATCH`): muda a coluna **e** `content.title`, recalcula o hash e faz `rev + 1` (senão um "salvar" idêntico ao conteúdo antigo seria engolido como "sem alteração"). O novo título passa pelo lint.
* **Lixeira** (`DELETE`): reversível, idempotente. Salvar numa apresentação da lixeira → `409 in_trash`. **Apagar de vez** (`?purge=1`): **só admin** (dono comum → 403) e só se já estiver na lixeira
  (senão 409); versões e referências saem em cascata, os arquivos ficam para a coleta de lixo (`tools/gc-assets.js`).
* **Transferir** (admin): destino precisa ser usuário **ativo** (`app.directory`); o novo dono passa a editar/moderar e o antigo perde o poder (inclusive comentários e respostas).
* **Compartilhar** (`GET /:id/share`): o acervo é comum; devolve o link interno `…/visualizar/<id>` e audita `presentation.share`.

### Listagem e paginação

`GET /api/presentations?scope=all|mine|trash&q=&owner=&limit=&cursor=`

* **Keyset** por `(updated_at desc, id asc)` — a mesma ordem dos índices `presentations_updated_idx` / `presentations_owner_idx`, sem `Sort`. O instante do cursor viaja como **texto**
  (`::text::timestamptz`) porque o driver converteria um parâmetro `timestamptz` em `Date` (milissegundos) e perderia os microssegundos do Postgres — com linhas de mesmo `updated_at` isso pularia itens
  (o teste cria 25 linhas com o mesmo instante e percorre as páginas).
* **Cursor opaco e assinado** (`lib/cursor.js`): `base64url([ts,id]).HMAC`. A assinatura cobre o contexto (usuário + escopo + filtros); cursor adulterado, de outro filtro ou de outro usuário → **400**.
  A chave deriva de `CSRF_SECRET` (separação de domínio); sem ele (local/teste) usa-se um segredo por processo.
* `q`: `ILIKE` com escape de `%`, `_` e `\` (curinga digitado é literal). Nome do dono vem de `app.directory` (sem e-mail).
* `trash`: o RLS limita ao próprio usuário (admin vê todas). O teste de `EXPLAIN` remove, **dentro de uma transação descartada**, o outro índice para provar que cada índice atende a consulta.

## 3. Salvar conteúdo (`PUT /:id/content`) — o coração

Ordem (tudo em **uma transação**, depois de validar fora dela):

1. **Fora do banco**: ler o corpo com teto em bytes (`MAX_JSON_BYTES`: 13 MiB em servidor Node, 4 MiB na Vercel; interrompe a leitura ao estourar → 413 com o limite na mensagem), validar com zod estrito (`baseRev` inteiro ≥ 1; **o cliente não envia hash**), `lintDeck` (HTML ativo, URL perigosa,
   `data:image` grande, `asset:` malformado, limites — 422 `rejected_content`), `JSON.stringify` seguro para `jsonb` (o Postgres **não aceita** `\u0000` nem surrogate solto — viram 422 `caractere_invalido`, nunca 500)
   e hash canônico no servidor (`canonical.js`). Rejeição → auditoria `security.rejected_content` (só os códigos de motivo) e **nada** é gravado.
   Toda recusa diz **onde** está o problema: `details.issues: [{slide, elementId, reason}]` (slide 1-based; id do elemento quando o problema está em
   `slides[i].els[j]` e o id é um identificador simples; no máximo 20; nunca o texto recusado) — o editor leva a pessoa ao slide/elemento em vez de só
   dizer "conteúdo recusado". Vale também para `caractere_invalido`, `asset_inexistente` (passo 5) e `thumb_invalida`.
   **Texto digitado citando tags** (BE-ED-09): o editor guarda o texto escapado (`use a tag &lt;form&gt;`), e o lint aceita, nas formas decodificadas,
   a citação de uma tag passiva **sem atributos**; HTML de verdade (a tag literal), `<script>`/`<style>`/`<svg>`/`<math>` em qualquer forma e tags
   citadas com atributo continuam recusados (detalhes em `docs/SEGURANCA.md` §7).
2. `SELECT … FOR UPDATE` da linha (sem ler o JSON). Dois salvamentos da mesma apresentação **se enfileiram aqui** (`lock_timeout` 8 s → 503 amigável, não 500).
3. **Idempotência por conteúdo**: se `content_hash` é igual e `baseRev ≤ rev` → `200 {unchanged:true}` **sem tocar em nada** (cobre o reenvio após resposta perdida, mesmo com chaves em outra ordem).
   Exceção útil: `snapshot:true` com conteúdo igual cria o ponto **manual** (uma vez; não duplica) — senão "Salvar versão" depois de um autosave nunca geraria ponto.
4. **Conflito**: `baseRev ≠ rev` → `409 conflict` com `{serverRev, updatedBy:{id,displayName}, updatedAt}`.
   `resolution:'overwrite'` só vale com `baseRev === rev` (o cliente confirma que viu a revisão atual): grava e cria antes um ponto **`pre_overwrite`** com o estado sobrescrito, auditando `conflict_overwrite`.
5. **Integridade das referências**: cada `asset:sha256:<hash>` precisa existir, estar `ready` e ser **visível a quem salva** (policy `assets_select`: enviou, provou posse ou está em apresentação que ele vê).
   "Inexistente" e "de outra pessoa" dão a **mesma** resposta (422 `asset_inexistente`) — hashes alheios não podem ser sondados. Miniatura (`thumbSha`) idem, exigindo `kind='thumb'`.
6. Atualiza `asset_refs` (versão 0) **por diferença**, `title`/`slide_count` **vêm do conteúdo**, `rev + 1`, `updated_by`, `snap_seq`/`last_snapshot_at`.
7. **Pontos do histórico** (`presentation_versions`): `manual` (`snapshot:true`, rótulo ≤ 120), `autosave` no **primeiro salvamento com mudança após ≥ 10 min** do último ponto, `pre_overwrite`, `pre_restore`,
   `restore`, `import`, `copy`. Cada ponto grava as `asset_refs` da sua versão (arquivo usado só por versão antiga **não** é órfão). Os pontos são copiados por `INSERT … SELECT` (o JSON não trafega pela aplicação).
8. `app.asset_touch` marca o relógio de carência da coleta de lixo só dos arquivos que **entraram/saíram**; auditoria `presentation.update` com `{rev, bytes, slideCount, assets}` — **nunca o conteúdo**.

A poda de versões **não** roda na requisição. `lib/presentations-service.js` exporta, para `tools/maintenance.js`:

```js
pruneVersions(tx /* como app_system */, presentationId, { keepLast = 50, dailyDays = 90 })  // → nº de pontos removidos
pruneAllVersions(ops /* createOpsDb() */, { log })   // lê versions.keep_last / keep_daily_days de app.settings
```

Retenção (`app.prune_versions`): as N últimas + o último de cada dia na janela + **todas as manuais**; as referências de arquivo das versões podadas saem junto.

### Restaurar versão (`POST /:id/versions/:no/restore {baseRev}`)

`baseRev` obrigatório (409 se defasado). Cria `pre_restore` (estado atual) e `restore` (estado restaurado), troca a cópia de trabalho, `rev + 1`, sincroniza as referências.
O conteúdo da versão passa **de novo** pelo lint (as regras podem ter ficado mais rígidas). Restaurar o que já está no ar devolve `unchanged:true`. Histórico: só dono/admin (outro membro 403).

## 4. Arquivos (`assets.js`)

* **Ordem segura**: validar bytes → registrar `pending` + posse (`app.asset_uploads`) → gravar no armazenamento → só então `app.asset_mark_ready`. Nunca existe `ready` sem objeto.
* **Tipo/tamanho pelos bytes** (`asset-validate.js`); `Content-Type`/nome do cliente são ignorados; SVG/HTML → 415; corrompido → 422; corpo > 4 MB no PUT → 413 (lido em fluxo, interrompe). Limite efetivo =
  `min(padrão do tipo, uploads.max_bytes)`. O SHA-256 é recalculado e comparado (400 se diferente).
* **Deduplicação**: se o objeto já existe com o mesmo tamanho, **não é regravado**; quem reenvia os mesmos bytes só ganha a **posse** (a prova de que os possui) e passa a poder referenciar/ler o arquivo.
  Se alguém pré-registrar (`pending`) um hash com metadados falsos, quando os bytes reais chegam tipo/tamanho/`kind` verdadeiros **substituem** os declarados.
* **Direto** (`POST /uploads` + `/finalize`): driver `local` → `{mode:'api'}`; no S3 a URL assinada escreve na **área de preparo da própria pessoa** (`up/<usuário>/<sha>`) e exige o checksum SHA-256. `/uploads` registra só o `pending`, sem posse. `finalize` lê o preparo da própria pessoa, confere hash e tipo pelos bytes, só então concede a posse, promove para a chave canônica (cópia condicional ao ETag; verificação dos bytes depois da cópia) e marca `ready`; se não confere, **apaga o preparo**, descarta o registro pendente (só se foi ela que o criou) e audita `asset.reject`. A posse do registro passa a quem provou os bytes (migração 0006).
* **Leitura** (`GET`): só quem pode ver (policy) — o 404 é idêntico ao de arquivo inexistente. Cabeçalhos: `Content-Type` do banco, `nosniff`, `CSP: default-src 'none'; sandbox`, `CORP: same-origin`,
  `Cache-Control: private, max-age=31536000, immutable`, `Content-Disposition: inline` só para imagens, `ETag: "<sha>"` (+ `If-None-Match` → 304). Acima de 8 MiB (4 MiB na Vercel) com URL assinada → 302 (`no-store`, a URL expira em 5 min); na Vercel, sem URL assinada → 413 claro.

## 5. Comentários e interações

**Comentários** — ver/criar: quem **vê** a apresentação. Editar o **texto**: só o autor. Resolver/reabrir e apagar (exclusão lógica): autor, dono da apresentação ou admin. Texto **puro** (1–2000 caracteres,
sem NUL/controles/surrogate solto; a interface escapa). Teto de 1000 ativos por apresentação (409). A matriz é aplicada pelo gatilho `trg_comments_guard`; os testes percorrem autor × dono × admin × outro membro.

**Interações** — `board_state`/`vote_state`: **upsert** por (usuário, elemento) (201 na 1ª, 200 depois). `form_response`/`view`/`reaction`: **acumulam**, teto de **500** por usuário+tipo+elemento (409), garantido mesmo com
envios simultâneos (`pg_advisory_xact_lock` por chave). `payload` objeto, profundidade ≤ 20, sem NUL; tamanho: estado de quadro/votação ≤ **256 KB** (um quadro com 200 notas
ou uma votação com milhares de linhas passa de 64 KB), respostas/reações/visualizações ≤ 64 KB. `user_id` vem da sessão. Leitura: dono/admin veem tudo (com autor); os demais, só as próprias (RLS).

* **Idempotência do reenvio** (`clientId`, 1–64 `[A-Za-z0-9_-]`): a fila offline do editor manda o mesmo `clientId` ao reenviar um item depois de uma resposta perdida; o
  servidor devolve o item já gravado (200, mesmo `id`, vale o conteúdo do primeiro envio) em vez de criar outro. Único no banco por (apresentação, pessoa, `clientId`)
  (índice parcial `interactions_client_uniq`, migração 0007) e conferido depois da trava por elemento — reenvios simultâneos não duplicam nem esbarram no teto. Em
  `board_state`/`vote_state` o `clientId` é aceito e ignorado (o estado já é único por pessoa+elemento).
* **Apagar** (`DELETE …/interactions?elementId=&kind=` → `{deleted}`): o "Limpar" do participante apaga só os itens dele; o dono da apresentação (ou um admin) apaga os
  de todas as pessoas daquele elemento — para reutilizar a apresentação noutro workshop ou atender a um pedido de exclusão (LGPD). A consulta não filtra por pessoa: o
  RLS (`inter_delete`) decide. Auditoria `interactions.delete` com `{elementId, kind, deleted, others}` (sem conteúdo).

**Preferências da pessoa** (`GET/PUT /api/me/prefs`, `src/routes/prefs.js`, tabela `app.user_prefs` da migração 0007): kits de marca salvos e preferências do editor
deixam de ficar só no navegador. Um objeto por pessoa (PUT substitui), ≤ 64 KB, profundidade ≤ 10; só a própria pessoa lê/grava (RLS).

**CSV** (`interactions.csv`, só dono/admin — exportar dados de pessoas é auditado como `interactions.export`, só com contagem): UTF-8 com **BOM**, separador `;` e CRLF (igual ao CSV do próprio editor, para abrir direto no
Excel pt-BR). Para `form_response` o cabeçalho é **dinâmico**: `Data/hora (UTC); Respondente; Elemento` + uma coluna por pergunta de `payload.q` (união entre as respostas; repetidas ganham ` (2)`), valores de `payload.a`.
**Anti CSV-injection**: toda célula (inclusive cabeçalhos e o nome do respondente) que começa com `= + - @` TAB ou CR recebe `'`. Teto de 50 000 linhas (`X-Truncated: 1`) e 300 colunas.

## 6. Limites de taxa e auditoria

`limit()` por **usuário** com os valores do contrato (escrita 120/min, upload 300/min, comentários 30/min, preferências 60/min, leitura 600/min) e por **IP em `RATE_IP_MULTIPLIER`×** (padrão 25, mínimo 5; os dois baldes em uma só ida ao banco, em cadeia — `limitMany`; vários usuários atrás do mesmo NAT do escritório não se bloqueiam;
um atacante com várias contas num só IP continua limitado). Leitura de arquivos tem balde próprio (`asset_read`, 600/min) para as imagens de um deck não consumirem o orçamento da API. Janela fixa por minuto
(`app.hit_rate`). Estourou → 429 + `Retry-After` + auditoria `security.rate_limited`.

Auditoria (na mesma transação, autor imposto pelo banco): `presentation.create|update|rename|duplicate|delete|restore|purge|transfer|share|version_restore|conflict_overwrite`, `comment.create|delete`,
`asset.upload|reject`, `security.rejected_content`, e `interactions.export|delete`. `meta` só leva ids, contagens, tamanhos e códigos de motivo — os testes procuram um texto secreto no conteúdo/título/rótulo/comentário e provam que **não** aparece.

## 7. Funções de banco que a API precisa (migração proposta)

O `app_user` só tem `select/insert` em `app.assets` — corretamente, para ninguém marcar o próprio arquivo como "pronto" sem validação. A promoção exige funções `SECURITY DEFINER`, que **não existiam** na migração 0003.
O SQL está em `tests/helpers/extra-migration.sql` (aplicado só nos testes); o coordenador deve copiá-lo para `db/migrations/0004_asset_functions.sql`:

| Função | Para quê | Guardas |
|---|---|---|
| `app.asset_mark_ready(sha, size, mime, kind, width, height)` | promove `pending`/`deleted` → `ready` e **grava os metadados verificados** | só o usuário da requisição, só se enviou ou provou posse; devolve o estado só a quem tem posse |
| `app.asset_discard_pending(sha)` | descarta o `pending` de um envio que falhou na validação | só `pending`, só do uploader, sem outra posse/referência |
| `app.asset_touch(shas[])` | atualiza `last_ref_at` (relógio de carência da coleta de lixo) | só arquivos que o usuário enviou/possui/referencia em apresentação que edita; no máx. 1×/hora por arquivo |

Sem elas, salvar conteúdo e enviar arquivos falham (a função não existe). Nenhuma outra operação exige privilégio de sistema na requisição (a poda de versões é de manutenção).

## 8. Limites de implantação a conhecer

* **Vercel Functions** limitam o corpo da requisição **e da resposta** a 4,5 MB. Com a variável `VERCEL` (definida pela plataforma), a API passa a aceitar no máximo **4 MiB por salvamento**
  (`MAX_JSON_BYTES`, contado em bytes do corpo) e a não transmitir arquivos acima de 4 MiB (302 para a URL assinada) — o 413 que a pessoa vê é o da API, com o limite e o que fazer, e não a recusa
  muda da plataforma. Em servidor Node o padrão continua 13 MiB (decks de até 12 MiB). Decks reais têm imagens externalizadas (poucas centenas de KB); se precisar de decks maiores, sirva a API num
  processo Node (Fly/Render/VM) ou comprima o JSON no cliente (não implementado).
* O lint de um deck de ~10 MB leva ~0,3 s de CPU: com muitos salvamentos grandes simultâneos considere mais de uma instância.
* `DB_POOL_MAX` pequeno (padrão 5) basta: numa execução manual (fora da suíte) com **2** conexões, 20 editores disputando a mesma linha + 30 leituras terminaram em ~2 s sem nenhum 5xx (cada transação é curta; nenhuma chamada de rede acontece com transação aberta; a suíte usa 8 conexões).

## 9. Testes

```bash
cd platform
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_<seu_nome> \
  node --test --test-concurrency=1 "tests/api/presentations.test.js" "tests/api/versions.test.js" \
  "tests/api/assets.test.js" "tests/api/comments.test.js" "tests/api/interactions.test.js" "tests/api/quota.test.js" "tests/api/prefs.test.js"
```

`tests/helpers/mini-app.js` monta só estas rotas com banco real, `onError` real, limites reais e armazenamento local temporário; o "usuário logado" vem de `X-Test-User`. Cada arquivo recria o schema do banco de teste.
Cobertura: visibilidade e edição (membro × dono × admin), cópia isolada, lixeira/restore/purge/transferência, conflito/overwrite/`pre_overwrite`, `unchanged`, snapshot manual × automático, retenção, restauração,
integridade de referências (hash inexistente, de outra pessoa, pendente, miniatura), deck malicioso sem escrita, upload (feliz, hash errado, SVG, corrompido, 413, deduplicação entre pessoas e simultânea, direto/finalize,
302 assinado), comentários, interações, CSV e injeção, paginação estável, plano de consulta, auditoria sem conteúdo, taxa, e **20 salvamentos concorrentes** da mesma apresentação.
