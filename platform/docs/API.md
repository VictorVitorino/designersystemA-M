# Contrato da API — Canteiro online (v1)

Este documento é o **contrato** entre banco, API, cliente web, extensão do editor, ferramentas e testes. Mudou o contrato → mude aqui primeiro.

Pilha: Node 22 (ESM, JavaScript puro com JSDoc), **Hono** (roda igual em Node e na Vercel), **postgres** (porsager), **zod** para validar toda entrada, **jose** para JWT,
`@aws-sdk/client-s3` para objetos, `sharp` para validar imagens. Banco: `platform/db/migrations` (RLS; veja `db/migrations/0003_security.sql`).

## 1. Regras do produto (não negociáveis)

1. **Acervo comum**: toda apresentação salva por qualquer usuário fica visível (somente leitura) para **todos os usuários ativos**.
2. **Só o dono altera** a própria apresentação. Quem quer usar a de outra pessoa **cria uma cópia** (`POST /api/presentations/:id/duplicate`) e altera a cópia (dono = quem copiou).
3. **Admin** gerencia usuários/convites/configurações, vê a auditoria e pode moderar (editar, excluir, restaurar, transferir) qualquer apresentação. Demais usuários são **membros** (criam, editam as suas, copiam, comentam).
4. **Cadastro aberto não existe.** Só entra quem foi convidado por um admin, com e-mail verificado e senha — ou pelo login corporativo (SSO), quando ligado, que vincula a identidade nova à conta **já convidada** do mesmo e-mail e nunca cria conta.
5. Excluir = **lixeira** (reversível). Apagar de vez = só admin.
6. O banco decide permissões (RLS). O código da API **nunca** confia em papel enviado pelo cliente; ele só informa *quem* é o usuário (uuid) ao banco.

## 2. Convenções HTTP

- Base: `/api`. JSON UTF-8 (`Content-Type: application/json`), exceto upload de arquivo (binário) e CSV.
- Erros: `{ "error": { "code": "snake_case", "message": "texto em pt-BR para exibir", "details"?: {...}, "requestId": "…" } }`.
  Códigos HTTP: 400 `invalid_request` (zod; `details.fields`), 401 `unauthenticated` | `session_expired` | `invalid_credentials`, 403 `forbidden` | `not_invited` | `suspended` | `csrf`,
  404 `not_found` (também para itens que o usuário não pode ver — nunca revele existência), 409 `conflict` | `already_exists`, 413 `too_large` | `quota_exceeded`, 415 `unsupported_media`, 422 `rejected_content`,
  429 `rate_limited` (cabeçalho `Retry-After`), 500 `internal`, 501 `not_configured`, 503 `unavailable`.
- Todo response leva `X-Request-Id` (aceita o do cliente se for `^[A-Za-z0-9_-]{8,64}$`, senão gera).
- **Sessão**: cookies `__Host-am_at` (access token JWT do Supabase Auth, HttpOnly, Secure, SameSite=Lax, Path=/, ~1 h) e `__Host-am_rt` (refresh token, HttpOnly, Secure, SameSite=Lax, Path=/, 30 d).
  Em `APP_ENV=local` sem HTTPS usa-se os nomes sem prefixo (`am_at`, `am_rt`, `am_csrf`) e sem `Secure`. **O navegador nunca recebe nem guarda token em JS/localStorage.**
- **CSRF** (toda requisição que não seja GET/HEAD/OPTIONS): (a) cabeçalho `X-CSRF-Token` igual ao cookie `__Host-am_csrf` (não-HttpOnly, 32 bytes aleatórios, emitido por `GET /api/auth/session`);
  (b) `Origin` (ou, na falta, `Sec-Fetch-Site: same-origin`) igual a `APP_ORIGIN`; (c) `Content-Type` JSON ou o tipo permitido do endpoint. Falhou → 403 `csrf`.
- **Paginação**: `?limit=` (1–100, padrão 30) e `?cursor=` opaco; resposta `{ items: [...], nextCursor: string|null }`.
- IDs são UUID v4. Datas ISO-8601 UTC.
- **Limites de taxa** (janela fixa, `app.hit_rate`; estourou → 429 com `Retry-After`): login 8/10 min por e-mail+IP e 30/10 min por IP; esqueci a senha 5/15 min por IP e por e-mail; `verify` 10/15 min **por link** e 100/15 min por IP; `refresh` 30/min **por token de renovação** e 600/min por IP; convites 300/h por admin. Rotas autenticadas: por **usuário** — escrita de conteúdo 120/min, upload 300/min (importar PPTX/PDF com dezenas de imagens envia `check` + `PUT` por imagem), comentários 30/min, gravação de preferências 60/min, leitura 600/min — e, por **IP**, o mesmo valor × `RATE_IP_MULTIPLIER` (padrão 25: um escritório inteiro atrás do mesmo NAT não se bloqueia; teto contra abuso em massa continua). Os dois baldes são consultados em uma só ida ao banco, em cadeia: o balde por IP só é incrementado se o do usuário permitiu (uma requisição já barrada não consome o balde do escritório).
- Idempotência: `PUT` de conteúdo e upload de arquivo são idempotentes por conteúdo; `POST …/interactions` com `clientId` é idempotente por (apresentação, pessoa, `clientId`) — o reenvio devolve o item já gravado (§6).

## 3. Autenticação (BFF sobre Supabase Auth / GoTrue)

A API é o único cliente do GoTrue; o navegador só fala com a API. Config: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (chamadas de usuário), `SUPABASE_SERVICE_ROLE_KEY` (somente servidor: convites e admin),
verificação do JWT por `SUPABASE_JWKS_URL` (ES256/RS256) **ou** `SUPABASE_JWT_SECRET` (HS256 legado). Cadastro público desligado no GoTrue (`DISABLE_SIGNUP=true`) e, em profundidade, a API nega qualquer identidade sem convite (`app.resolve_identity`).

Chamadas GoTrue usadas (todas via `fetch`, `apikey: <anon|service>`):

| Uso | Chamada |
|---|---|
| Convidar | `POST {SUPABASE_URL}/auth/v1/invite` (service) `{email, data:{display_name}}` — e-mail do template com link `{APP_ORIGIN}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite` |
| Trocar o link por sessão | `POST /auth/v1/verify` `{type, token_hash}` → `{access_token, refresh_token, expires_in, user}` |
| Definir senha | `PUT /auth/v1/user` (Bearer access) `{password}` |
| Login | `POST /auth/v1/token?grant_type=password` `{email,password}` |
| Renovar | `POST /auth/v1/token?grant_type=refresh_token` `{refresh_token}` |
| Esqueci a senha | `POST /auth/v1/recover` `{email}` — link `…/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery` |
| Sair | `POST /auth/v1/logout?scope=global|local` (Bearer) |
| Bloquear/apagar | `PUT /auth/v1/admin/users/{id}` `{ban_duration}` / `DELETE …` (service) — ao suspender, **todas** as contas do GoTrue com o e-mail (a de senha e a do SSO) |
| SSO: URL do IdP | `POST /auth/v1/sso` `{domain, redirect_to:'{APP_ORIGIN}/api/auth/sso/callback', skip_http_redirect:true, code_challenge, code_challenge_method:'s256'}` → `{url}` |
| SSO: trocar o código | `POST /auth/v1/token?grant_type=pkce` `{auth_code, code_verifier}` → sessão (o mesmo formato do login) |
| Chaves | `GET /auth/v1/.well-known/jwks.json` |

Em testes o GoTrue é substituído por `tools/fake-gotrue.js` (mesmo contrato HTTP; **bloqueado quando `APP_ENV=production`**).

Senha: mínimo 12 caracteres, não pode conter o e-mail, não pode estar na lista de senhas comuns embutida (≥ 200 itens); o Supabase Auth ainda aplica "leaked password protection" quando habilitado.

| Endpoint | Entrada | Resposta |
|---|---|---|
| `GET /api/auth/session` | — | `{authenticated:false, csrfToken}` ou `{authenticated:true, csrfToken, user:{id,email,displayName,role,status}, needsPassword:boolean}`. Sempre garante o cookie CSRF. |
| `POST /api/auth/login` | `{email,password}` | 200 igual à sessão acima + cookies. 401 `invalid_credentials` (mesma mensagem para e-mail inexistente e senha errada, com tempo de resposta equalizado). 403 `not_invited` / `suspended`. 429. |
| `POST /api/auth/logout` | — | 204; apaga cookies; revoga no GoTrue. |
| `POST /api/auth/verify` | `{tokenHash, type:'invite'\|'recovery'}` | 200 sessão com `needsPassword:true`; usuário convidado fica `status=invited` até definir a senha (nesse estado só `/api/auth/session`, `/api/auth/password`, `/api/auth/logout` funcionam). 400/410 `link_invalid` se expirado/usado. |
| `POST /api/auth/password` | `{password}` | 200 sessão; ativa o convite (`resolve_identity(..., touch=true)`) e registra auditoria `auth.password_set`. |
| `POST /api/auth/forgot` | `{email}` | **sempre 202** (não revela se existe). Limitado por taxa. |
| `POST /api/auth/refresh` | — | 200 sessão (cookies novos), 401 `session_expired`, ou **429 `rate_limited`** com `Retry-After` (limite compartilhado; a sessão continua válida — o cliente espera e repete em vez de considerar a sessão expirada). |
| `GET /api/auth/sso?email=<e-mail>` ou `?domain=<domínio>` (e `&next=<caminho interno>`) | — | Login corporativo (SAML do Supabase Auth com **PKCE**). Só com `SSO_ENABLED=true`; desligado → **501 `not_configured`** (inclusive no nome antigo `/api/auth/sso/start`, que continua valendo). O domínio (do e-mail ou o informado) precisa estar em `SSO_DOMAINS`. Gera o par PKCE, pede ao GoTrue a URL do IdP e responde **302** para ela, gravando o cookie HttpOnly `am_sso` (verifier + destino, assinado, 10 min). É uma **navegação** do navegador: erros voltam com **302 `/entrar?motivo=<código>`** (e `&next=` quando houver) — `sso_email` (e-mail/domínio inválido), `sso_dominio` (domínio fora de `SSO_DOMAINS`), `sso_indisponivel` (provedor não cadastrado no Supabase ou GoTrue fora do ar), `sso_limite` (100 inícios/10 min por IP). |
| `GET /api/auth/sso/callback?code=…` | — | Retorno do IdP (via GoTrue). Troca o código por sessão **com o verifier do cookie do mesmo navegador** (código de outra pessoa não serve; uso único), confere que a sessão é de SSO, que o e-mail afirmado pelo IdP é de um domínio de `SSO_DOMAINS` e está verificado, e chama `resolve_identity('sso:<id-do-provedor>', sub, e-mail, true, allow_link=true, touch=true)`: **vincula a identidade nova à conta EXISTENTE do mesmo e-mail** (convidado ou ativo; o convidado tem o convite aceito) e **nunca cria conta**. Sucesso → cookies de sessão + CSRF novo e **302 para `next`** (caminho interno; padrão `/acervo`). Recusas → `/entrar?motivo=` `not_invited`, `suspended`, `sso_expirou` (sem o cookie do início, cookie adulterado/vencido, código inválido/usado), `sso_falhou` (o IdP recusou ou não afirmou e-mail verificado), `sso_dominio`, `sso_indisponivel`, `sso_limite`; a sessão que o GoTrue chegou a emitir é revogada. Auditoria: `auth.login` com `{via:'sso', provider}`, `auth.login_failed` (só HMAC do e-mail), `auth.sso_start`, `auth.sso_refused` (só o motivo). |
| `PATCH /api/me` | `{displayName}` | 200 usuário. |
| `GET /api/me/prefs` | — | 200 `{prefs:{…}}` — `{}` se a pessoa nunca gravou. Preferências da **própria** pessoa (kits de marca salvos, preferências do editor), para valerem em qualquer computador. |
| `PUT /api/me/prefs` | `{prefs:{…}}` | 200 `{prefs}` (substitui o objeto inteiro). `prefs`: objeto JSON **≤ 64 KB** serializado (UTF-8), **profundidade ≤ 10** (o próprio `prefs` conta 1), **sem chaves** `__proto__`/`constructor`/`prototype` em nenhum nível; chaves que o editor usa: `brandKits` (lista) e `editor` (objeto) — outras chaves são aceitas. 400 forma/chave/profundidade, 413 tamanho, 422 `rejected_content` se alguma string tiver HTML ativo (mesma varredura do conteúdo dos decks; `details.reasons`, sem eco). CSRF obrigatório; 60 gravações/min por pessoa. Só a própria pessoa lê e grava (RLS em `app.user_prefs`: nem o admin lê as dos outros); suspenso/convidado → 403. |

## 4. Apresentações

`content` = o JSON do deck do editor (`AMStudio.deck`: `{v:1, app:'AM Studio', id, title, slides:[…], brand?, comments?…}`) **com imagens externalizadas**:
toda ocorrência de `data:image/(png|jpeg|webp|gif);base64,…` (inteira, ou dentro de strings/HTML) é trocada por `asset:sha256:<64 hex>`. O servidor valida que cada referência existe e é acessível a quem salva.

- **Hash de conteúdo**: `sha256(UTF-8(JSON canônico))`, JSON canônico = chaves ordenadas recursivamente, sem espaços. Calculado **no servidor**.
- **Tamanho do salvamento (413 `too_large`)**: o corpo de `POST /api/presentations` e `PUT …/content` é medido em **BYTES** (UTF-8 do corpo inteiro, não em caracteres) e limitado por `MAX_JSON_BYTES`: padrão **13 MiB** em servidor Node e **4 MiB na Vercel** (lá a função não recebe nem devolve mais que 4,5 MB; a API reconhece a Vercel pela variável `VERCEL`, que a própria plataforma define). Acima → 413 com mensagem que diz o limite e o que fazer ("A apresentação passa do limite de 4 MB por salvamento…"); `Content-Length` declarado maior é barrado antes de ler, e corpo em fluxo para de ser lido ao passar do limite.
- **Validação (servidor, `422 rejected_content`)**: tamanho do conteúdo ≤ 12 MB (só alcançável fora da Vercel); profundidade ≤ 40; ≤ 500 slides; strings ≤ 2 MB; rejeita `<script`, `<iframe`, `<object`, `<embed`, `<link`, `<meta`, `<base`, `<form` (tags de HTML ativo), atributos `on…=`, `javascript:`/`vbscript:` em `href|src|xlink:href|action|formaction`, `data:text/html`, `data:image/svg+xml` embutido. (O editor já sanitiza ao abrir; isto é a segunda camada.) Lista exata em `src/lib/deck-lint.js` com testes.
  Cada texto é testado cru **e** decodificado (entidades, `%XX`, `\uXXXX`). Texto que a pessoa **digita** citando tags fica guardado escapado (`use a tag &lt;form&gt;`) e é inerte: na forma decodificada, a citação de uma tag passiva **sem atributos** (`<form>`, `<link>`, `<meta>`, `<base>`, `<iframe>`, `<object>`, `<embed>`, `<template>`, `<noscript>`…) é aceita. Continuam recusados em qualquer forma: `<script>`, `<style>`, `<svg>`, `<math>`, qualquer dessas tags **com** atributo, atributos de evento, `srcdoc`, URLs/CSS perigosos e — na forma decodificada — `action`/`formaction`/`form`. A tag literal (forma crua) continua recusada.
- **Onde está o problema**: todo `422 rejected_content` do salvamento, da criação (e de copiar/renomear/restaurar versão) traz `error.details.issues: [{slide, elementId, reason}]` — `slide` 1-based (`null` se o problema não está dentro de um slide, ex.: título do deck ou tamanho total), `elementId` = id do elemento em `slides[i].els[j]` (`null` fora de um elemento ou se o id não for um identificador simples `[A-Za-z0-9_-]{1,64}`), `reason` = código (`tag_perigosa`, `atributo_evento`, `url_perigosa`, `caractere_invalido`, `asset_inexistente`, `thumb_invalida`, …). No máximo 20, sem repetição (mesmo ponto + mesma razão = 1). **Nunca** ecoa o texto recusado. `details.reasons` (códigos únicos) e `details.findings` (≤ 10 caminhos sanitizados) continuam por compatibilidade; `asset_inexistente` mantém `details.missing`/`missingCount`.
- **Revisão otimista**: toda apresentação tem `rev` (inteiro). Salvar exige `baseRev`; divergência → 409 `conflict` com `{serverRev, updatedBy:{id,displayName}, updatedAt}`.
- **Versões**: a cópia de trabalho é atualizada a cada autosave (barato). Um **ponto no histórico** (`presentation_versions`) é criado: ao salvar manualmente (`snapshot:true`), no primeiro autosave após ≥ 10 min do último ponto (se mudou), ao restaurar, antes de sobrescrever em conflito (`pre_overwrite`), ao importar e ao copiar. Retenção: 50 últimas + 1 por dia por 90 dias + todas as manuais (`app.prune_versions`).

| Endpoint | Entrada | Resposta |
|---|---|---|
| `GET /api/presentations?scope=all\|mine\|trash&q=&owner=&limit=&cursor=` | — | `{items:[{id,title,slideCount,rev,owner:{id,displayName},updatedAt,createdAt,thumbSha,sourceId,deleted:boolean}], nextCursor}`; ordenado por `updatedAt desc`. `trash` = só do próprio usuário (admin: todas). |
| `POST /api/presentations` | `{title?, content?, source?:'new'\|'import'}` | 201 `{id, rev, …meta}`. Sem `content`, cria deck em branco. |
| `GET /api/presentations/:id` | — | 200 `{meta…, content, canEdit:boolean}`. `canEdit` = dono ou admin. Cabeçalho `ETag: "<rev>"`. |
| `PUT /api/presentations/:id/content` | `{baseRev:int, content, snapshot?:boolean, label?:string, resolution?:'overwrite', thumbSha?}` | 200 `{rev, savedAt, hash, unchanged:boolean, snapshotNo?:int}`; 409 `conflict`; 403 se não for dono/admin. `resolution:'overwrite'` com `baseRev` = `serverRev` grava e cria ponto `pre_overwrite`. Sem alteração real → `unchanged:true`, `rev` igual. |
| `PATCH /api/presentations/:id` | `{title}` | 200 meta (renomear; também altera `content.title`). |
| `POST /api/presentations/:id/duplicate` | `{title?}` | 201 nova apresentação do usuário (`sourceId` = original; versão `copy`). Funciona para qualquer apresentação visível. |
| `DELETE /api/presentations/:id` | — | 204 → lixeira (dono/admin). `DELETE …?purge=1` → apaga de vez (**só admin**; só se já estiver na lixeira). |
| `POST /api/presentations/:id/restore` | — | 200 (tira da lixeira; dono/admin). |
| `POST /api/presentations/:id/transfer` | `{toUserId}` | 200 (admin). |
| `GET /api/presentations/:id/versions` | — | `{items:[{no,kind,label,createdAt,createdBy:{id,displayName},slideCount,title}]}` (dono/admin). |
| `GET /api/presentations/:id/versions/:no` | — | `{no, content,…}` (dono/admin). |
| `POST /api/presentations/:id/versions/:no/restore` | `{baseRev}` | 200 novo `rev`; cria `pre_restore` do estado atual e `restore`. |
| `GET /api/presentations/:id/share` | — | `{url:'{APP_ORIGIN}/visualizar/<id>', visibility:'acervo'}` — o acervo é comum; compartilhar = link interno. Auditado como `presentation.share`. |

## 5. Arquivos (armazenamento separado do banco, endereçado por conteúdo)

Objeto no armazenamento: chave `a/<sha[0:2]>/<sha[2:4]>/<sha>` (sem extensão; tipo no banco). Bucket **privado**. O mesmo arquivo enviado mil vezes ou por mil pessoas vira **um** objeto.

Tipos aceitos (conferidos por **magic bytes**, nunca pelo nome/Content-Type do cliente): `image/png`, `image/jpeg`, `image/webp`, `image/gif` (validados com `sharp`: dimensões ≤ 12 000 px, ≤ 100 MP, sem animação de milhares de quadros), `application/pdf`
(cabeçalho `%PDF-`, ≤ 100 MB), `application/vnd.openxmlformats-officedocument.presentationml.presentation` (ZIP com `[Content_Types].xml` e `ppt/`, ≤ 100 MB), `text/csv` (UTF-8, ≤ 10 MB). **SVG e HTML são recusados** (415). Limite padrão de 25 MB para imagens (`uploads.max_bytes` ajustável).

| Endpoint | Entrada | Resposta |
|---|---|---|
| `POST /api/assets/check` | `{shas:[hex64…≤200]}` | `{missing:[hex64…]}` — o que ainda precisa enviar para o usuário poder referenciar (já inclui prova de posse quando o servidor já tem o arquivo e o usuário o reenviar via `PUT`). |
| `PUT /api/assets/:sha256` | corpo binário; `Content-Type` do arquivo; `X-Asset-Kind: image\|thumb\|attachment` | 201/200 `{sha256,size,mime,width?,height?,deduplicated:boolean}`. O servidor recalcula o SHA-256 e compara com `:sha256` (400 se diferente), valida o tipo, grava (idempotente) e registra a posse do usuário. Corpo ≤ 4 MiB em bytes (cabe na função da Vercel); acima → 413 "O arquivo passa do limite de 4 MB por envio…" — use o fluxo direto abaixo. |
| `POST /api/assets/uploads` | `{sha256,size,mime,kind}` | `{mode:'direct', url, method:'PUT', headers, expiresAt}` (URL assinada, 5 min, que escreve na **área de preparo da própria pessoa** `up/<usuário>/<sha>` — nunca na chave canônica) **ou** `{mode:'api'}` quando o driver não suporta (local). Registra o arquivo como `pending`; **não** concede posse. Hoje os clientes do produto não usam este caminho: a CSP não lista o host do bucket em `connect-src`, e o editor recomprime imagens para caber no `PUT` pela API (ver `editor-em-nuvem.md` §7.4). |
| `POST /api/assets/:sha256/finalize` | — | Lê o que a pessoa enviou à sua área de preparo, confere o SHA-256 e o tipo pelos bytes, **só então** concede a posse, promove o objeto para a chave canônica (nada é regravado se já existir) e marca `ready`. 201 igual ao `PUT` (200 se já estava pronto). 404 se não há registro visível nem bytes enviados; 409 se os bytes ainda não chegaram; 422/415 se não conferem (preparo apagado). |
| `GET /api/assets/:sha256` | — | Bytes (até 8 MiB transmitidos pela API em servidor Node; **até 4 MiB na Vercel**, cuja função não devolve mais que 4,5 MB) ou, acima disso, `302` para URL assinada (5 min); na Vercel, sem URL assinada (driver sem esse recurso) → 413 claro em vez de resposta cortada. Cabeçalhos: `Content-Type` do banco, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=31536000, immutable`, `Content-Disposition: inline` só para imagens (demais `attachment`). 404 se o usuário não puder ver. |

**Cota por pessoa** (opcional, `STORAGE_QUOTA_USER_MB`; 0 = desligada, o padrão): vale ao registrar um arquivo **novo** — `PUT /api/assets/:sha256` (bytes que ainda não existiam), `POST /api/assets/uploads` (tamanho declarado) e `POST …/finalize` (tamanho real, antes de promover o objeto). Espaço ocupado = arquivos `ready`/`pending` registrados pela pessoa; reenviar o que já existe (deduplicação, inclusive de outra pessoa) não ocupa espaço, não conta e **nunca** é barrado. Estourou → **413 `quota_exceeded`** com mensagem amigável e `details: {quotaBytes, usedBytes, fileBytes}`; a rejeição é auditada (`asset.reject`, sem bytes). O admin vê o espaço de cada pessoa em `GET /api/admin/users` (`storageBytes`).

Coleta de lixo: `tools/gc-assets.js` (padrão simulação) remove objetos sem referência há > 14 dias.

## 6. Comentários e interações

| Endpoint | Entrada | Resposta |
|---|---|---|
| `GET /api/presentations/:id/comments` | `?includeResolved=1` | `{items:[{id,slideIndex,body,author:{id,displayName},createdAt,editedAt,resolvedAt,canDelete,canResolve}]}` |
| `POST /api/presentations/:id/comments` | `{body(1–2000), slideIndex?}` | 201 comentário. Texto puro (a interface escapa). |
| `PATCH /api/comments/:id` | `{body?}` (autor) ou `{resolved:boolean}` (dono/admin/autor) | 200 |
| `DELETE /api/comments/:id` | — | 204 (autor, dono da apresentação ou admin; exclusão lógica) |
| `POST /api/presentations/:id/interactions` | `{kind:'form_response'\|'board_state'\|'vote_state'\|'view'\|'reaction', elementId, payload, clientId?}` | 201 `{id, kind, elementId, createdAt, updatedAt}` (criado) ou 200 (já existia). `board_state`/`vote_state` fazem upsert por (usuário, elemento); os demais acumulam. **payload**: `board_state`/`vote_state` ≤ **256 KB**; `form_response`, `view`, `reaction` ≤ 64 KB (JSON serializado, UTF-8; acima → 413). ≤ 500 respostas por usuário/elemento (409). **`clientId`** opcional (1–64, `[A-Za-z0-9_-]`): chave de idempotência da fila offline — o mesmo (apresentação, pessoa, `clientId`) devolve o item já gravado (**200**, mesmo `id`; vale o conteúdo do primeiro envio) em vez de criar outro (único no banco; reenvios simultâneos também). Em `board_state`/`vote_state` é aceito e ignorado (o estado já é único). |
| `DELETE /api/presentations/:id/interactions?elementId=<id>[&kind=<kind>]` | — | 200 `{deleted:n}`. Dono da apresentação e admin apagam **todos** os itens do elemento (de todas as pessoas); os demais apagam **só os próprios** ("Limpar" do participante) — quem decide é o RLS (`inter_delete`). `elementId` obrigatório; `kind` opcional filtra o tipo. Quem não vê a apresentação → 404. CSRF obrigatório; limite de escrita. Auditado como `interactions.delete` com `{elementId, kind, deleted, others}` — nunca o conteúdo das respostas. |
| `GET /api/presentations/:id/interactions?kind=&elementId=` | — | `{items:[{id, kind, elementId, payload, createdAt, updatedAt, author:{id, displayName}}], truncated}`: dono/admin veem tudo; demais, só as próprias. O cliente só restaura no dispositivo o que tem `author.id` igual ao da sessão (`user` é um alias de `author`, mantido por compatibilidade). |
| `GET /api/presentations/:id/interactions.csv?kind=form_response&elementId=` | — | CSV (UTF-8 com BOM; células iniciadas por `= + - @` recebem apóstrofo — anti CSV-injection). Dono/admin. |

## 7. Administração (somente admin; tudo auditado)

| Endpoint | Entrada | Resposta |
|---|---|---|
| `GET /api/admin/users?status=&q=` | — | usuários com e-mail, papel, status, último acesso, nº de apresentações e `storageBytes` (espaço ocupado: arquivos `ready`/`pending` que a pessoa registrou — o critério da cota `STORAGE_QUOTA_USER_MB`) |
| `POST /api/admin/invites` | `{email, displayName, role?:'member'\|'admin'}` | 201 `{id,email,status:'pending',expiresAt}`; cria `app.users(invited)`, `app.invites` e dispara o convite no GoTrue. 409 se já houver usuário/convite. Domínios permitidos opcionais: `INVITE_ALLOWED_DOMAINS`. |
| `POST /api/admin/invites/:id/resend` | — | 200 (novo e-mail; `resent_count`+1; máx. 5) |
| `DELETE /api/admin/invites/:id` | — | 204 (revoga; bane o usuário no GoTrue) |
| `PATCH /api/admin/users/:id` | `{role?, status?:'active'\|'suspended', displayName?}` | 200. Suspender revoga sessões (GoTrue `ban_duration` + logout global). Não rebaixa o último admin (409). |
| `GET /api/admin/audit?actor=&action=&from=&to=&limit=&cursor=` | — | trilha de auditoria |
| `GET /api/admin/settings` / `PUT /api/admin/settings/:key` | `{value}` | chaves conhecidas apenas |
| `GET /api/admin/stats` | — | usuários, apresentações, arquivos (nº e bytes) |

Auditoria (`app.audit`): `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_set`, `auth.forgot`, `auth.sso_start`, `auth.sso_refused`, `invite.create|resend|revoke`, `user.update`, `presentation.create|update|rename|duplicate|delete|restore|purge|transfer|share|version_restore|conflict_overwrite`, `comment.create|delete`, `interactions.export|delete`, `asset.upload|reject`, `import.acervo`, `security.csrf_blocked|rate_limited|rejected_content`. **Nunca** grava senha, token, corpo de requisição nem conteúdo de slides; `meta` leva só ids, contagens e tamanhos. IP completo é guardado (retenção de 180 dias, `tools/maintenance.js`).

## 8. Saúde

`GET /api/health` → `{ok:true, version, env}` (sem dependências; para balanceador). `GET /api/ready` → 200/503 `{db:boolean, storage:boolean, auth:boolean, migrations:boolean}` (sem detalhes de erro). Detalhes só em log.

## 9. Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `APP_ENV` | `local` \| `test` \| `staging` \| `production` (production exige HTTPS, `__Host-`, HSTS e proíbe o fake do GoTrue) |
| `APP_ORIGIN` | origem pública exata, ex.: `https://canteiro.exemplo.com.br` (CSRF/CORS/links de e-mail) |
| `DATABASE_URL` | conexão do papel `app_api` (Supabase: pooler em modo transação, porta 6543) |
| `DATABASE_SSL` | `require` (padrão em produção) \| `disable` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Auth (a de serviço **nunca** vai ao navegador) |
| `SUPABASE_JWKS_URL` ou `SUPABASE_JWT_SECRET` | verificação do JWT |
| `STORAGE_DRIVER` | `local` \| `s3` |
| `STORAGE_LOCAL_DIR` | pasta (driver local) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | driver s3 (Supabase Storage S3, R2, S3, MinIO) |
| `STORAGE_QUOTA_USER_MB` | cota de armazenamento por pessoa, em MB (inteiro ≥ 0; **0 = desligada**, padrão). Ver §5 |
| `MAX_JSON_BYTES` | teto do corpo de salvar/criar apresentação, em **bytes** (64 KiB–64 MiB). Padrão: 13 MiB (13631488) em servidor Node e 4 MiB (4194304) quando `VERCEL` está definida — a Vercel a define sozinha; valores acima de ~4,5 MB não adiantam lá, a plataforma corta antes. Ver §4 |
| `CSRF_SECRET` | segredo ≥ 32 bytes (HMAC de tokens auxiliares) |
| `INVITE_ALLOWED_DOMAINS` | lista opcional (ex.: `alvarezandmarsal.com`) |
| `SSO_ENABLED` | `true` liga o login corporativo (`/api/auth/sso`, `/api/auth/sso/callback`); padrão desligado (501). Exige `SSO_DOMAINS` e o Supabase configurado; passo a passo em `infra/supabase/sso-saml.md` |
| `SSO_DOMAINS` | domínios de e-mail que entram pelo SSO, separados por vírgula (ex.: `alvarezandmarsal.com`). Vale no início **e** no retorno: o e-mail afirmado pelo IdP também precisa ser de um deles |
| `LOG_LEVEL`, `SENTRY_DSN`, `RELEASE` | observabilidade (nível de log, Sentry opcional, identificador da versão publicada) |
| `RATE_IP_MULTIPLIER` | limite por IP nas rotas autenticadas = limite por usuário × fator (inteiro 5–1000; padrão 25) |
| `TRUST_PROXY` | `1` (padrão) atrás da Vercel/Cloudflare: IP do cliente vem de `x-forwarded-for`/`x-real-ip`; `0` em execução direta |
| `DB_POOL_MAX` | conexões por processo (padrão 5; 2–3 na Vercel, 10 por processo em contêiner) |
| `PORT`, `PUBLIC_DIR` | porta local/contêiner (ignorada na Vercel) e pasta do site gerado (`dist/public`) |
| `GOTRUE_FAKE` | só `local`/`test`: aponta o login para `tools/fake-gotrue.js`; proibido em staging/produção |
| `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL`, `APP_API_DB_PASSWORD`, `APP_OPS_DB_PASSWORD` | **somente ferramentas/CI** (migração, backup, GC) — não configurar na API em produção |

A API **falha ao iniciar** em staging/produção se faltar variável obrigatória (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CSRF_SECRET`), se `APP_ORIGIN` não for `https://`, se `CSRF_SECRET` for curto, se `GOTRUE_FAKE` estiver ligado, se `DATABASE_SSL=disable`, ou se `DATABASE_ADMIN_URL`/`DATABASE_OPS_URL` estiverem presentes no ambiente da API (são só de ferramentas/CI). A chave de serviço do Supabase é **necessária** no processo da API (convites e administração) e **nunca** chega ao navegador — o CI confere que o site publicado não contém nenhum segredo.

## 10. Extensão de nuvem do editor (cliente) — resumo do contrato

Detalhes em `docs/editor-em-nuvem.md`. O build "cloud" (`studio-cloud/`) acrescenta ao editor, sem alterar `studio/`:
carregamento por `/editor/<id>` → `GET /api/presentations/:id` → hidratar `asset:` em `data:` → `AMStudio.loadDeck`; autosave com debounce (3 s) → externalizar imagens (`POST /api/assets/check` + `PUT /api/assets/:sha`) → `PUT …/content` com `baseRev`;
indicador de estado (Salvando… / Salvo às HH:MM / Sem conexão — alterações guardadas neste computador / Conflito); fila local em IndexedDB para falhas de rede, com recuperação; tela de conflito; histórico de versões; "Criar cópia"; modo **visualizar** (apresentação direta, sem edição) para apresentações de outras pessoas;
interações (formulários) enviadas à API quando há `window.AM_CLOUD`.

O que a API oferece ao cliente desde 2026-10-07 (contrato acima): preferências da pessoa em `GET/PUT /api/me/prefs` (`brandKits`, `editor`); `clientId` no
`POST …/interactions` para o reenvio da fila offline não duplicar; `DELETE …/interactions?elementId=&kind=` para o "Limpar" (só os próprios itens) e para o
dono apagar as respostas de um elemento; estado de quadro/votação até 256 KB; `details.issues` (`slide` 1-based e `elementId`) no 422 do salvamento, para levar a
pessoa ao ponto exato; 413 do salvamento medido em **bytes** (4 MiB na Vercel); upload 300/min por pessoa; 413 `quota_exceeded` quando a cota estiver ligada.
