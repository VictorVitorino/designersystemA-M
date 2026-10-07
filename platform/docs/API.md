# Contrato da API — Canteiro online (v1)

Este documento é o **contrato** entre banco, API, cliente web, extensão do editor, ferramentas e testes. Mudou o contrato → mude aqui primeiro.

Pilha: Node 22 (ESM, JavaScript puro com JSDoc), **Hono** (roda igual em Node e na Vercel), **postgres** (porsager), **zod** para validar toda entrada, **jose** para JWT,
`@aws-sdk/client-s3` para objetos, `sharp` para validar imagens. Banco: `platform/db/migrations` (RLS; veja `db/migrations/0003_security.sql`).

## 1. Regras do produto (não negociáveis)

1. **Acervo comum**: toda apresentação salva por qualquer usuário fica visível (somente leitura) para **todos os usuários ativos**.
2. **Só o dono altera** a própria apresentação. Quem quer usar a de outra pessoa **cria uma cópia** (`POST /api/presentations/:id/duplicate`) e altera a cópia (dono = quem copiou).
3. **Admin** gerencia usuários/convites/configurações, vê a auditoria e pode moderar (editar, excluir, restaurar, transferir) qualquer apresentação. Demais usuários são **membros** (criam, editam as suas, copiam, comentam).
4. **Cadastro aberto não existe.** Só entra quem foi convidado por um admin, com e-mail verificado e senha.
5. Excluir = **lixeira** (reversível). Apagar de vez = só admin.
6. O banco decide permissões (RLS). O código da API **nunca** confia em papel enviado pelo cliente; ele só informa *quem* é o usuário (uuid) ao banco.

## 2. Convenções HTTP

- Base: `/api`. JSON UTF-8 (`Content-Type: application/json`), exceto upload de arquivo (binário) e CSV.
- Erros: `{ "error": { "code": "snake_case", "message": "texto em pt-BR para exibir", "details"?: {...}, "requestId": "…" } }`.
  Códigos HTTP: 400 `invalid_request` (zod; `details.fields`), 401 `unauthenticated` | `session_expired` | `invalid_credentials`, 403 `forbidden` | `not_invited` | `suspended` | `csrf`,
  404 `not_found` (também para itens que o usuário não pode ver — nunca revele existência), 409 `conflict` | `already_exists`, 413 `too_large`, 415 `unsupported_media`, 422 `rejected_content`,
  429 `rate_limited` (cabeçalho `Retry-After`), 500 `internal`, 501 `not_configured`, 503 `unavailable`.
- Todo response leva `X-Request-Id` (aceita o do cliente se for `^[A-Za-z0-9_-]{8,64}$`, senão gera).
- **Sessão**: cookies `__Host-am_at` (access token JWT do Supabase Auth, HttpOnly, Secure, SameSite=Lax, Path=/, ~1 h) e `__Host-am_rt` (refresh token, HttpOnly, Secure, SameSite=Lax, Path=/, 30 d).
  Em `APP_ENV=local` sem HTTPS usa-se os nomes sem prefixo (`am_at`, `am_rt`, `am_csrf`) e sem `Secure`. **O navegador nunca recebe nem guarda token em JS/localStorage.**
- **CSRF** (toda requisição que não seja GET/HEAD/OPTIONS): (a) cabeçalho `X-CSRF-Token` igual ao cookie `__Host-am_csrf` (não-HttpOnly, 32 bytes aleatórios, emitido por `GET /api/auth/session`);
  (b) `Origin` (ou, na falta, `Sec-Fetch-Site: same-origin`) igual a `APP_ORIGIN`; (c) `Content-Type` JSON ou o tipo permitido do endpoint. Falhou → 403 `csrf`.
- **Paginação**: `?limit=` (1–100, padrão 30) e `?cursor=` opaco; resposta `{ items: [...], nextCursor: string|null }`.
- IDs são UUID v4. Datas ISO-8601 UTC.
- **Limites de taxa** (janela fixa, `app.hit_rate`; estourou → 429 com `Retry-After`): login 8/10 min por e-mail+IP e 30/10 min por IP; esqueci a senha 5/15 min por IP e por e-mail; `verify` 10/15 min **por link** e 100/15 min por IP; `refresh` 30/min **por token de renovação** e 600/min por IP; convites 300/h por admin. Rotas autenticadas: por **usuário** — escrita de conteúdo 120/min, upload 60/min, comentários 30/min, leitura 600/min — e, por **IP**, o mesmo valor × `RATE_IP_MULTIPLIER` (padrão 25: um escritório inteiro atrás do mesmo NAT não se bloqueia; teto contra abuso em massa continua). Os dois baldes são consultados em uma só ida ao banco, em cadeia: o balde por IP só é incrementado se o do usuário permitiu (uma requisição já barrada não consome o balde do escritório).
- Idempotência: `PUT` de conteúdo e upload de arquivo são idempotentes por conteúdo.

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
| Bloquear/apagar | `PUT /auth/v1/admin/users/{id}` `{ban_duration}` / `DELETE …` (service) |
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
| `GET /api/auth/sso/start`, `/callback` | — | **501 `not_configured`** até existir IdP. Veja `docs/SEGURANCA.md` §SSO (vínculo por e-mail verificado preserva contas e dados). |
| `PATCH /api/me` | `{displayName}` | 200 usuário. |

## 4. Apresentações

`content` = o JSON do deck do editor (`AMStudio.deck`: `{v:1, app:'AM Studio', id, title, slides:[…], brand?, comments?…}`) **com imagens externalizadas**:
toda ocorrência de `data:image/(png|jpeg|webp|gif);base64,…` (inteira, ou dentro de strings/HTML) é trocada por `asset:sha256:<64 hex>`. O servidor valida que cada referência existe e é acessível a quem salva.

- **Hash de conteúdo**: `sha256(UTF-8(JSON canônico))`, JSON canônico = chaves ordenadas recursivamente, sem espaços. Calculado **no servidor**.
- **Validação (servidor, `422 rejected_content`)**: tamanho ≤ 12 MB; profundidade ≤ 40; ≤ 500 slides; strings ≤ 2 MB; rejeita `<script`, `<iframe`, `<object`, `<embed`, `<link`, `<meta`, `<base`, `<form` (tags de HTML ativo), atributos `on…=`, `javascript:`/`vbscript:` em `href|src|xlink:href|action|formaction`, `data:text/html`, `data:image/svg+xml` embutido. (O editor já sanitiza ao abrir; isto é a segunda camada.) Lista exata em `src/lib/deck-lint.js` com testes.
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
| `PUT /api/assets/:sha256` | corpo binário; `Content-Type` do arquivo; `X-Asset-Kind: image\|thumb\|attachment` | 201/200 `{sha256,size,mime,width?,height?,deduplicated:boolean}`. O servidor recalcula o SHA-256 e compara com `:sha256` (400 se diferente), valida o tipo, grava (idempotente) e registra a posse do usuário. Corpo ≤ 4 MB (limite das Functions da Vercel); acima disso use o fluxo direto abaixo. |
| `POST /api/assets/uploads` | `{sha256,size,mime,kind}` | `{mode:'direct', url, method:'PUT', headers, expiresAt}` (URL assinada, 5 min, que escreve na **área de preparo da própria pessoa** `up/<usuário>/<sha>` — nunca na chave canônica) **ou** `{mode:'api'}` quando o driver não suporta (local). Registra o arquivo como `pending`; **não** concede posse. |
| `POST /api/assets/:sha256/finalize` | — | Lê o que a pessoa enviou à sua área de preparo, confere o SHA-256 e o tipo pelos bytes, **só então** concede a posse, promove o objeto para a chave canônica (nada é regravado se já existir) e marca `ready`. 201 igual ao `PUT` (200 se já estava pronto). 404 se não há registro visível nem bytes enviados; 409 se os bytes ainda não chegaram; 422/415 se não conferem (preparo apagado). |
| `GET /api/assets/:sha256` | — | Bytes (≤ 8 MB: transmitidos) ou `302` para URL assinada (5 min). Cabeçalhos: `Content-Type` do banco, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=31536000, immutable`, `Content-Disposition: inline` só para imagens (demais `attachment`). 404 se o usuário não puder ver. |

Coleta de lixo: `tools/gc-assets.js` (padrão simulação) remove objetos sem referência há > 14 dias.

## 6. Comentários e interações

| Endpoint | Entrada | Resposta |
|---|---|---|
| `GET /api/presentations/:id/comments` | `?includeResolved=1` | `{items:[{id,slideIndex,body,author:{id,displayName},createdAt,editedAt,resolvedAt,canDelete,canResolve}]}` |
| `POST /api/presentations/:id/comments` | `{body(1–2000), slideIndex?}` | 201 comentário. Texto puro (a interface escapa). |
| `PATCH /api/comments/:id` | `{body?}` (autor) ou `{resolved:boolean}` (dono/admin/autor) | 200 |
| `DELETE /api/comments/:id` | — | 204 (autor, dono da apresentação ou admin; exclusão lógica) |
| `POST /api/presentations/:id/interactions` | `{kind:'form_response'\|'board_state'\|'vote_state'\|'view'\|'reaction', elementId, payload}` | 201/200. `board_state`/`vote_state` fazem upsert por (usuário, elemento); os demais acumulam. payload ≤ 64 KB; ≤ 500 respostas por usuário/elemento. |
| `GET /api/presentations/:id/interactions?kind=&elementId=` | — | `{items:[{id, kind, elementId, payload, createdAt, updatedAt, author:{id, displayName}}], truncated}`: dono/admin veem tudo; demais, só as próprias. O cliente só restaura no dispositivo o que tem `author.id` igual ao da sessão (`user` é um alias de `author`, mantido por compatibilidade). |
| `GET /api/presentations/:id/interactions.csv?kind=form_response&elementId=` | — | CSV (UTF-8 com BOM; células iniciadas por `= + - @` recebem apóstrofo — anti CSV-injection). Dono/admin. |

## 7. Administração (somente admin; tudo auditado)

| Endpoint | Entrada | Resposta |
|---|---|---|
| `GET /api/admin/users?status=&q=` | — | usuários com e-mail, papel, status, último acesso, nº de apresentações |
| `POST /api/admin/invites` | `{email, displayName, role?:'member'\|'admin'}` | 201 `{id,email,status:'pending',expiresAt}`; cria `app.users(invited)`, `app.invites` e dispara o convite no GoTrue. 409 se já houver usuário/convite. Domínios permitidos opcionais: `INVITE_ALLOWED_DOMAINS`. |
| `POST /api/admin/invites/:id/resend` | — | 200 (novo e-mail; `resent_count`+1; máx. 5) |
| `DELETE /api/admin/invites/:id` | — | 204 (revoga; bane o usuário no GoTrue) |
| `PATCH /api/admin/users/:id` | `{role?, status?:'active'\|'suspended', displayName?}` | 200. Suspender revoga sessões (GoTrue `ban_duration` + logout global). Não rebaixa o último admin (409). |
| `GET /api/admin/audit?actor=&action=&from=&to=&limit=&cursor=` | — | trilha de auditoria |
| `GET /api/admin/settings` / `PUT /api/admin/settings/:key` | `{value}` | chaves conhecidas apenas |
| `GET /api/admin/stats` | — | usuários, apresentações, arquivos (nº e bytes) |

Auditoria (`app.audit`): `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_set`, `auth.forgot`, `invite.create|resend|revoke`, `user.update`, `presentation.create|update|rename|duplicate|delete|restore|purge|transfer|share|version_restore|conflict_overwrite`, `comment.create|delete`, `asset.upload|reject`, `import.acervo`, `security.csrf_blocked|rate_limited|rejected_content`. **Nunca** grava senha, token, corpo de requisição nem conteúdo de slides; `meta` leva só ids, contagens e tamanhos. IP completo é guardado (retenção de 180 dias, `tools/maintenance.js`).

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
| `CSRF_SECRET` | segredo ≥ 32 bytes (HMAC de tokens auxiliares) |
| `INVITE_ALLOWED_DOMAINS` | lista opcional (ex.: `alvarezandmarsal.com`) |
| `LOG_LEVEL`, `SENTRY_DSN` | observabilidade |
| `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL`, `APP_API_DB_PASSWORD`, `APP_OPS_DB_PASSWORD` | **somente ferramentas/CI** (migração, backup, GC) — não configurar na API em produção |

A API **falha ao iniciar** em produção se faltar variável obrigatória, se `APP_ORIGIN` não for `https://`, se `CSRF_SECRET` for curto, ou se `DATABASE_ADMIN_URL`/`DATABASE_OPS_URL`/`SUPABASE_SERVICE_ROLE_KEY` estiverem presentes no mesmo processo que serve o navegador **sem** a flag `ALLOW_SERVICE_KEY_IN_API=1` (a chave de serviço é necessária para convidar; as de banco de operação, nunca).

## 10. Extensão de nuvem do editor (cliente) — resumo do contrato

Detalhes em `docs/ARQUITETURA.md`. O build "cloud" (`studio-cloud/`) acrescenta ao editor, sem alterar `studio/`:
carregamento por `/editor/<id>` → `GET /api/presentations/:id` → hidratar `asset:` em `data:` → `AMStudio.loadDeck`; autosave com debounce (3 s) → externalizar imagens (`POST /api/assets/check` + `PUT /api/assets/:sha`) → `PUT …/content` com `baseRev`;
indicador de estado (Salvando… / Salvo às HH:MM / Sem conexão — alterações guardadas neste computador / Conflito); fila local em IndexedDB para falhas de rede, com recuperação; tela de conflito; histórico de versões; "Criar cópia"; modo **visualizar** (apresentação direta, sem edição) para apresentações de outras pessoas;
interações (formulários) enviadas à API quando há `window.AM_CLOUD`.
