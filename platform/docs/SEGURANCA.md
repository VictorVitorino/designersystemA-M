# Segurança — Canteiro online (modelo de ameaças, controles, achados e recomendações)

Data da revisão: **2026-10-06**. Escopo: a plataforma online do editor “Canteiro” (A&M) — API (Hono), banco (Postgres + RLS), armazenamento de
objetos, cliente web e extensão de nuvem do editor. Fora de escopo: o editor `studio/` autônomo (preservado byte a byte) e o conteúdo educacional.

Este documento é a saída da **revisão de segurança ofensiva (caixa-branca)**. As provas são executáveis:

- `tests/security/offensive.test.js` — ataques contra a API inteira em memória (Postgres real com RLS + GoTrue falso + armazenamento local).
  Execução desta revisão (2026-10-06, antes das correções): **50 testes, 45 passam, 5 falham**. Cada falha é um **achado** (o teste codifica a defesa desejada; falha vermelha = defeito, não se ajusta o teste). **Depois das correções do mesmo dia: 50/50** (faz parte de `npm run test:security`).
- `tests/security/offensive-browser.cjs` — ataques pelo navegador (Playwright/Chromium) contra a **pilha real** em `http://localhost:4403`.
  Execução desta revisão: **62 verificações, 62 passam, 0 falham, 6 violações de CSP** (todas das injeções de teste, nenhuma espontânea).
- Cadeia de suprimento: `npm audit --omit=dev` → **1 alta** (sharp/libvips) na revisão; **0 vulnerabilidades** depois de fixar `sharp` em 0.35.5 (2026-10-07); build reprodutível (dois builds → mesmo sha256 do editor; o sha vigente está em `EVIDENCIAS.md` §1); vendor pdf.js do build **byte-idêntico** ao de `studio/vendor` (`pdf.min.mjs` `27fc2a05…`, `pdf.worker.min.mjs` `1baa1844…`).

Como reproduzir tudo:

```bash
# pilha real (navegador):
cd platform && APP_ENV=local node tools/dev.js --port 4403 --db canteiro_t_sec --admin admin@am.test --name "Admin" --reset
NODE_PATH=/opt/node22/lib/node_modules node tests/security/offensive-browser.cjs
# API em memória (NÃO rode junto com a pilha acima: o boot redefine a senha do papel app_api no cluster):
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_sec_unit node --test tests/security/offensive.test.js
npm audit --omit=dev
```

---

## 1. Modelo de ameaças

### Atores (de quem defendemos)

| Ator | Capacidade | O que quer |
|---|---|---|
| **Anônimo na internet** | fala com a API/CDN sem sessão; lê HTML/JS público; força bruta | entrar sem convite, enumerar contas, derrubar o serviço, achar segredos no bundle |
| **Usuário autenticado malicioso** (membro) | sessão válida; pode criar/editar as suas, copiar, comentar, responder formulários | ler/alterar apresentações alheias (IDOR), escalar para admin, poluir o servidor, XSS armazenado, abusar de limites |
| **Ex-funcionário** | tinha sessão/senha; pode ter cópias locais | continuar acessando após desligamento; usar tokens/links antigos |
| **Admin comprometido** | papel admin via phishing/roubo de sessão | exfiltrar o acervo, apagar auditoria, criar contas, transferir propriedade |
| **Fornecedor / cadeia de suprimento** | controla uma dependência npm, o CDN de fontes, o Supabase/Vercel | injetar código no cliente, ler dados em trânsito, adulterar o vendor |

### Bens protegidos
Apresentações (acervo comum, só o dono altera), arquivos (bucket privado), identidades e sessões, trilha de auditoria, respostas de
formulários/quadros/votações (dados de pessoas), configurações, e os **segredos do servidor** (chave de serviço do Supabase, `CSRF_SECRET`,
credenciais de banco) — que **nunca** chegam ao navegador.

### Princípios de arquitetura (verificados nesta revisão)
1. **O banco decide permissões (RLS)**, não o JavaScript: cada requisição roda numa transação `SET LOCAL ROLE app_user` + `app.user_id`. Um erro
   de lógica na API não concede acesso que o banco nega (provado atacando o banco direto: `offensive.test.js › autorização`).
2. **BFF**: o navegador só fala com a API; a API é o único cliente do GoTrue. Tokens só em cookies `HttpOnly`; o JS nunca vê o access/refresh token.
3. **Defesa em profundidade de conteúdo**: editor sanitiza → API faz o *lint* (2ª camada, recusa) → CSP no render → RLS no acesso.
4. **404 em vez de “existe mas você não pode”**: sondagem não revela a existência de recursos alheios (apresentações, arquivos, usuários).

---

## 2. Controles por camada

### 2.1 Navegador (cliente)
- **Cookies**: `am_at`/`am_rt` `HttpOnly`, `SameSite=Lax`, `Path=/`; em produção com `__Host-` + `Secure` (sem `Domain`, nenhum subdomínio/HTTP planta cookie). `am_csrf` legível só para o double-submit. Provado: `offensive-browser §1` (`document.cookie` só expõe `am_csrf`; `localStorage`/`sessionStorage` sem token; `Authorization: Bearer` não autentica).
- **CSP**: páginas comuns `script-src 'self'`; editor/visualizar `script-src '<15 hashes sha256>' 'strict-dynamic'` (sem `unsafe-inline`/`unsafe-eval` em script). Injeção de `<script>` pelo parser, `onerror`, `javascript:` → bloqueados nas duas políticas (`offensive-browser §2/§5`, 0 violações espontâneas). `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`.
- **Clickjacking**: `frame-ancestors 'none'` + `X-Frame-Options: DENY` — iframes cross-site de outra origem são bloqueados (`§3`).
- **Sem token/segredo no bundle**: varredura de `dist/public` não acha `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `postgres://`, `CSRF_SECRET`, `S3_SECRET_*` (`offensive.test.js §8`).
- **`?next=` seguro** (`format.js › safeNext`): só caminho interno; `//evil`, `https://`, `javascript:`, `\`, codificações → caem no padrão (`§4`).

### 2.2 CDN / Vercel
- Mesmos cabeçalhos de segurança aplicados por `vercel.json` (gerado e versionado; `build-web.js --check` falha no CI se desatualizar). HSTS, `nosniff`, `X-Robots-Tag: noindex`.
- Estático servido da CDN; `/api/*` vai para a função Node. `src/static.js` (dev/contêiner) bloqueia traversal/dotfiles/symlink e nunca atende `/api`.

### 2.3 API (Hono)
- **CSRF** em toda escrita: `X-CSRF-Token == cookie` (tempo constante) **e** `Origin == APP_ORIGIN` (ou `Sec-Fetch-Site: same-origin`) **e** `Content-Type` permitido. `<form>`/`fetch` cross-site → 403 `csrf`, sem efeito (`offensive.test.js §2`, `offensive-browser §3` com servidor atacante em `127.0.0.1:<porta>`).
- **CORS**: nenhum cabeçalho `Access-Control-Allow-*` é emitido (defesa em profundidade: o middleware os remove mesmo se surgirem).
- **Sessão**: JWT verificado com algoritmo escolhido por nós; `alg:none`, confusão HS×ES, `iss`/`aud` errados, expirado, `role=service_role`, anônimo → 401 (`§1`). Suspensão vale em ≤ 15 s (cache) e no login (ban no GoTrue).
- **Limites de taxa** no Postgres (`app.hit_rate`): login 8/10 min por e-mail+IP e 30/10 min por IP (antes do GoTrue); esqueci a senha 5/15 min por IP e por e-mail; `verify` 10/15 min por link e 100/15 min por IP; `refresh` 30/min por token e 600/min por IP; convites 300/h por admin; rotas autenticadas por usuário (escrita 120/min, upload 300/min, comentários 30/min, preferências 60/min, leitura 600/min) e por IP × `RATE_IP_MULTIPLIER` (25), em cadeia numa só consulta (uma requisição barrada no balde do usuário não consome o do IP). 429 com `Retry-After` (`§7`, `offensive-browser §10`). Valores completos em `API.md` §2.
- **Validação**: zod `.strict()` em toda entrada; corpo limitado; UTF-8 obrigatório; o deck passa pelo `deck-lint` (recusa HTML ativo, URLs perigosas, `__proto__`, imagens não externalizadas) antes de tocar o banco. A recusa diz **onde** (`details.issues`: slide e id do elemento) sem nunca ecoar o conteúdo (§7).
- **Erros**: nunca vazam stack/SQL; mensagens em pt-BR; `X-Request-Id` do cliente só com formato seguro (sem injeção de cabeçalho — `§4`).

### 2.4 Banco (RLS)
- RLS ligada em todas as tabelas; papel `app_api` sem privilégio direto, só assume `app_user` por transação e não vira `app_system`/`app_owner` (provado: `set local role app_system` como `app_user` → negado).
- Acervo comum (todos os ativos veem o não-deletado); só dono/admin alteram; lixeira alheia invisível; histórico só do dono/admin; interações só as próprias (dono/admin veem e apagam tudo do elemento); preferências (`app.user_prefs`) só da própria pessoa — nem o admin lê. Gatilhos barram troca de papel/propriedade/autor (e do `client_id` de uma interação) e tornam a auditoria *append-only* (`§3`, `§8`).

### 2.5 Armazenamento
- Bucket **privado**; chave derivada só do SHA-256 validado (sem path traversal por construção). Tipo conferido por *magic bytes* (SVG/HTML recusados; PPTX com macro, ZIP bomb, polyglot → 422/415). `GET` com `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: attachment` para PDF/PPTX (inline só imagem). Driver local nunca segue symlink; S3 assina checksum SHA-256 na escrita direta (`§6`, `offensive-browser §8`).

---

## 3. O que a plataforma **NÃO** protege (resíduos aceitos / limites)

1. **Dispositivo comprometido**: com o cookie de sessão roubado (malware/acesso físico), o atacante age como o usuário — inclusive **trocar a senha** (ver Achado AF-1) até a mitigação.
2. **Sem MFA/SSO hoje**: phishing da senha + entrega do e-mail de convite basta para entrar. SSO está previsto (`/api/auth/sso/*` → 501) mas não implementado.
3. **Access token *stateless***: após logout/suspensão, o JWT ainda verifica até expirar (≤ 1 h). O que protege é o banco (≤ 15 s), o cookie `HttpOnly` apagado e o ban no GoTrue; a janela do JWT é resíduo conhecido (reduzir “JWT expiry” no Supabase).
4. **Acervo é comum por produto**: todo usuário ativo vê todas as apresentações não deletadas. “Confidencialidade entre membros” **não** é um objetivo — é a regra do produto.
5. **Admin comprometido**: um admin pode ler/mover/apagar tudo e criar contas. A auditoria é *append-only* (nem o admin a edita/apaga pela API), mas um admin malicioso é um ponto único de falha (ver recomendações: 4-olhos, SSO+MFA para admins).
6. **Spoofing visual de nome** (bidi/homóglifos no `displayName`): aceito (não é XSS; o nome entra por `textContent`). Resíduo cosmético.
7. **IndexedDB `canteiro-cloud` em computador compartilhado**: guarda só a fila de uma gravação **não confirmada** (apagada após o salvamento). Em um computador compartilhado, um logout **não** limpa o IndexedDB de uma apresentação que ficou com pendência offline (`offensive-browser §7`, nota). Resíduo documentado em `docs/editor-em-nuvem.md §6`.
8. **XXE no `.pptx` importado**: a importação do PPTX é 100% no **cliente** (`studio/ed-42-import.js` usa `DOMParser` do navegador, que não resolve entidades externas). O servidor só recebe o deck já convertido e o valida; nunca faz parsing de XML do usuário. Sem superfície XXE no servidor (confirmado: nenhum parser XML server-side).
9. **SSRF**: o servidor **não** busca nenhuma URL fornecida pelo usuário. `fetch`/JWKS só vão para GoTrue/JWKS/S3 **configurados**; o cliente GoTrue usa `redirect: 'error'` (`offensive.test.js §4 SSRF`).

---

## 4. Achados

Classificação por risco residual (considerando as mitigações existentes). Cada um tem teste que **falha** enquanto o defeito existir.

### AF-1 — Troca de senha sem reautenticação (takeover persistente de sessão roubada) — **ALTO**
- **Estado: CORRIGIDO** (mesmo dia; endurecido após a revisão adversarial de 2026-10-07). `POST /api/auth/password` só aceita quem está em estado de recuperação: `status = invited` ou cookie `am_np` **assinado** (HMAC-SHA256 com o segredo do servidor, vinculado à sessão do JWT, validade 1 h), emitido exclusivamente pelo `verify` de convite/“esqueci a senha”. Um valor forjado (`1`, vencido ou de outra sessão) recebe **403** — teste em `tests/api/auth.test.js`. Sessão ativa comum recebe 403 com a orientação de usar “Esqueci a senha”. Testes: `offensive.test.js › "ACHADO? troca de senha sem reautenticação"` (passa) e `tests/api/auth.test.js` (403 + forjados + troca pelo link de recuperação continua encerrando as outras sessões).
- **Onde**: `src/routes/auth.js › POST /api/auth/password`. `requireUser(c, { allowInvited: true })` aceita usuário **ativo**; não exige estado `needsPassword`/recovery nem a senha atual.
- **Reprodução** (`offensive.test.js › autenticação › "ACHADO? troca de senha sem reautenticação"`, confirmado manualmente): com uma sessão ativa (cookie), `POST /api/auth/password {password}` → **200**; a senha antiga para de funcionar (dono trancado para fora) e as **outras** sessões são revogadas (`logout?scope=others`). Um cookie de sessão roubado vira takeover permanente da conta.
- **Correção proposta** (pequena): no handler, só permitir quando o usuário está em `needsPassword` (convite/recuperação): trocar `requireUser(c,{allowInvited:true})` por uma checagem que exija `c.get('user').status === 'invited'` **ou** o cookie `am_np === '1'`; para troca de senha de usuário já ativo, exigir a senha atual (reautenticação) e/ou habilitar “Secure password change / reauthentication” no GoTrue. Diff conceitual:
  ```js
  const user = requireUser(c, { allowInvited: true });
  const needs = user.status === 'invited' || readCookie(c, names.np) === '1';
  if (!needs) throw E.forbidden('Para trocar a senha, use "Esqueci a senha" (reautenticação).');
  ```

### AF-2 — `POST /api/assets/uploads` concede posse de arquivo alheio (IDOR no upload direto, driver S3) — **ALTO**
- **Estado: CORRIGIDO** (mesmo dia), com desenho mais forte que o proposto: a URL assinada escreve numa **área de preparo por usuário** (`up/<uuid>/<sha>`, `storage/keys.js › stagingKey`), nunca na chave canônica; `/uploads` registra só o `pending` (sem posse); o `finalize` lê **o preparo da própria pessoa**, confere o SHA-256 e o tipo pelos bytes, só então concede a posse (`app.asset_uploads`), promove o objeto com cópia **condicional ao ETag** lido na conferência (se o dono da URL assinada trocar o preparo nesse meio-tempo, o provedor recusa e nada é promovido — 422), nada é regravado se já existir, e apaga o preparo; `ready` só é gravado se o objeto canônico existir. A posse do registro (`uploaded_by`) passa a quem provou os bytes (migração 0006): quem só pré-registrou o hash não ganha acesso. Quem não enviou bytes recebe 404 (igual a um sha desconhecido). Preparos abandonados são limpos pelo GC (`gc-assets.js --apply`, > 48 h). Testes: `offensive.test.js › "(driver s3) …"` (passa), `tests/api/assets.test.js` (fluxo direto reescrito), `tests/unit/storage-s3.test.js` (preparo contra S3 real/moto).
- **Onde**: `src/routes/assets.js › POST /uploads` chama `register(tx, user.id, …)`, que insere em `app.asset_uploads` **antes** de qualquer prova de posse. No driver `s3` (produção), o fluxo direto é usado.
- **Reprodução** (`offensive.test.js › autorização › "ACHADO? (driver s3) …"`, com armazenamento S3 falso em memória): o atacante pede `POST /api/assets/uploads {sha256 de um arquivo alheio, size, mime, kind}` → 200 `direct`; isso insere `asset_uploads(sha, atacante)`. Em seguida `POST /api/assets/:sha/finalize` lê o objeto que **já existe** (enviado pelo dono), confere o SHA (bate) e marca `ready`; `GET /api/assets/:sha` passa a devolver os bytes ao atacante. Ele ganha posse e leitura de um arquivo que nunca enviou.
- **Correção proposta**: **não** gravar posse em `/uploads`. Registrar só o `assets` pendente (uploaded_by via `on conflict do nothing`, que não muda o dono existente) e inserir `app.asset_uploads` **somente no `finalize`, após** `verify`/`sameHash` dos bytes reais. Assim, para um sha já existente de outro dono, `/uploads` não concede nada e `app.asset_mark_ready` (que exige `uploaded_by = me` ou `asset_uploads` com `me`) recusa o atacante. Patch: separar `register` em `registerPending` (sem `asset_uploads`) para `/uploads`, e inserir a posse dentro do `finalize` depois da verificação de SHA.

### AF-3 — Byte NUL em parâmetro de consulta vira 500 (erro não tratado) — **MÉDIO**
- **Estado: CORRIGIDO** (mesmo dia): `error.js` mapeia `22021`/`22P05` (NUL / codificação inválida) para **400** `Valor inválido.`; nenhum 500 para `%00` em `q`, `title`, `displayName`.
- **Onde**: `src/lib/presentations-service.js › listQuery` (`p.title ilike ${like}`) e `src/routes/admin.js › /users` (`ilike`), com `q` contendo `\u0000`; também `PATCH /me`, `POST /admin/invites` com `\u0000`. O texto do Postgres não aceita NUL → erro `22021`, que o `error.js` não mapeia → **500 internal**.
- **Reprodução** (`offensive.test.js › injeção › "SQL: … nunca 500"`): `GET /api/presentations?q=%00` → 500; idem `GET /api/admin/users?q=%00`, `POST /api/presentations {title:"a\u0000b"}`. Não há risco de injeção (é parametrizado), mas é erro não tratado (ruído/990 e possível enumeração de comportamento).
- **Correção proposta** (duas camadas): (1) recusar controles nos campos de texto do cliente — nos schemas zod de `q`/`title`/`displayName`/`elementId`, adicionar `.refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), 'Contém caracteres não permitidos.')` (o `displayName` já faz isso; estender a `q` e `title`); (2) defesa em profundidade no `error.js`: mapear `e.code === '22021' || e.code === '22P05'` para `E.badRequest('Valor inválido.')`.

### AF-4 — Evasão do *lint* por *form feed* U+000C entre atributos (bypass da 2ª camada de XSS) — **MÉDIO**
- **Estado: CORRIGIDO** (mesmo dia): `deck-lint.js` passa a tratar U+000C como espaço (`INVISIBLE` preserva `\f`; `WS_CTRL` o inclui), então `src=x\fonerror=` é tokenizado como dois atributos e o atributo de evento é recusado. Teste `offensive.test.js › "evasão por caractere de formato"` passa.
- **Onde**: `src/lib/deck-lint.js`. `INVISIBLE = /[^\P{Cc}\t\n\r]|\p{Cf}/gu` **remove** U+000C (form feed) antes de tokenizar. O navegador trata U+000C como **espaço separador de atributos**; a remoção junta `src=x` + `onerror=…` num só token, então o *lint* não vê o atributo de evento.
- **Reprodução** (`offensive.test.js › XSS › "ACHADO? evasão por caractere de formato"`): `lintDeck` **aceita** `"<img src=x\fonerror=\"window.__xss=1\">"` (e variantes `<img\fsrc=x\fonerror=…>`, `<a\fhref="javascript:…">`, `<svg\fonload=…>`). A API grava o deck (a segunda camada falhou). Mitigado no render pelo sanitizador do editor (`cleanHTML`) e pela CSP (handlers inline bloqueados); o risco é no **HTML exportado offline** (sem CSP) e como falha de defesa em profundidade documentada.
- **Correção proposta** (uma linha de regex): tratar U+000C como espaço em vez de apagá-lo — `const INVISIBLE = /[^\P{Cc}\t\n\r\f]|\p{Cf}/gu;` e `const WS_CTRL = /[\t\n\r\f]/g;` (o tokenizador `isWs` já considera 0x0C como espaço). Assim `src=x\fonerror` vira `src=x onerror` e o atributo de evento é detectado. (U+000B *vertical tab* pode continuar removido: o navegador não o trata como separador de atributo, então a junção é inofensiva.)

### AF-5 — Arquivo de versão antiga continua legível por terceiros após remoção da cópia de trabalho — **BAIXO**
- **Estado: CORRIGIDO** (mesmo dia) em `db/migrations/0005_hardening.sql`: a *policy* `assets_select` só considera referências da cópia de trabalho (`version_no = 0`) para quem apenas **vê** a apresentação; referências de versões do histórico (`version_no > 0`) exigem `can_edit_presentation` (dono/admin).
- **Onde**: `db/migrations/0003_security.sql › policy assets_select` autoriza quem pode **ver** qualquer apresentação que referencie o arquivo, incluindo `asset_refs` de `version_no > 0` (histórico). O histórico é privado (dono/admin), mas a *policy* de arquivos conta qualquer `asset_ref` cuja apresentação seja visível.
- **Reprodução** (`offensive.test.js › autorização › "ACHADO? asset removido … versão antiga"`): o dono salva um ponto com a imagem, remove a imagem da cópia de trabalho; um membro (403 ao listar versões) ainda faz `GET /api/assets/:sha` → **200**. Exige conhecer/adivinhar o SHA-256 (inviável por força bruta), então o risco é baixo e, dado o acervo comum, o membro já via a imagem quando ela estava no deck.
- **Correção proposta**: restringir `assets_select` via `asset_refs` à **cópia de trabalho** (`version_no = 0`) — ou exigir `can_edit_presentation` para refs de versões do histórico. Patch: na subconsulta `exists (select 1 from app.asset_refs r where r.sha256 = assets.sha256 and app.can_view_presentation(r.presentation_id))` acrescentar `and r.version_no = 0` (e manter a visibilidade do histórico só para dono/admin via `can_edit_presentation`).

### Resíduos verificados (não são achados)
- **JWT stateless após logout** (§3.3): limite conhecido e documentado; teste confirma que o refresh é revogado e os cookies apagados.
- **`cloud-core.mapStrings` copia `__proto__` como protótipo *local*** do objeto hidratado: **sem** poluição do protótipo global (`Object.prototype` intacto) e o servidor recusa a chave `__proto__` no deck (`offensive.test.js › injeção › protótipo`). Inofensivo.
- **Single-flight do refresh é melhor-esforço**: sob concorrência, a reutilização do refresh token antigo nunca emite novo cookie (as corridas extras recebem 401 sem token); não é vazamento.

---

## 5. O que foi testado (cobertura)

- **Autenticação/sessão**: enumeração (login — mensagem idêntica e **tempo equalizado** com latência simulada do bcrypt; forgot sempre 202; verify sempre 410), força bruta + limites, fixação de sessão, cookie sem token em JS, JWT (`alg:none`, confusão, iss/aud, expirado, service_role, anônimo), reuso de refresh, logout revoga refresh, convite de uso único, recuperação usada 2×, convite revogado, suspenso com token válido, cache de identidade ≤ 15 s.
- **CSRF** (toda rota de escrita, Origin ausente/alheio/`null`, `text/plain`, form urlencoded), **CORS** (nenhum ACAO), **clickjacking** (frame-ancestors + XFO, iframes cross-site), **open redirect** (`?next=` — API e tela de login), cabeçalhos.
- **Autorização/IDOR/BOLA**: cada rota com id alheio (ver/editar/apagar/restaurar/duplicar/versões/comentários/interações/assets/thumb/transferir/admin), escalada de papel (`PATCH /me` com role, `PATCH users` como membro, UPDATE direto no banco), admin-only, lixeira de terceiros, asset por SHA adivinhado, asset de apresentação na lixeira.
- **Injeção**: SQL (aspas/comentário/`%`/`_`/`\`/NUL; cursor opaco adulterado; owner/limit/scope/cursor/action/from), protótipo (`__proto__`/`constructor` no deck e no payload; API e `cloud-core`), CSV injection, injeção de cabeçalho, path traversal (estático e armazenamento), SSRF (ausência de fetch de URL do usuário), XXE (importação só no cliente).
- **XSS**: corpus `tests/fixtures/xss-corpus.js` (98 ataques → 422; 35 legítimos → aceitos e **renderizados sem executar** no editor e no visualizar, sentinela `window.__xss`); títulos; nome de usuário; comentários como texto puro; CSP bloqueando injeção via DOM nas duas políticas.
- **Uploads**: polyglot PNG+HTML, dados após IEND, SVG, HTML/PDF disfarçados, EXE, vazio, kind/tipo incompatível, sha falso, 100 MB (413 sem ler), corpo > 4 MB, ZIP bomb/PPTX com macro/ZIP genérico/traversal interno, PDF com JavaScript (anexo sandboxado, `Content-Disposition: attachment`), thumb alheio/não-thumb.
- **Abuso**: custo do *lint* de deck de ~12 MB / 500 slides / strings de 2 MB (lint ≈ 234 ms, PUT ≈ 713 ms), texto hostil para regex sem ReDoS (≈ 34 ms), tetos (1000 comentários, 500 interações/elemento, payload 64 KB, profundidade 20), limites reais de taxa, privacidade em computador compartilhado.
- **Segredos/log**: varredura de todo o log estruturado da API (sem senha/token/cookie/JWT/query string), auditoria sem segredos e *append-only*, `dist/public` sem chave de serviço, config de produção (recusa `DATABASE_ADMIN_URL`/`OPS_URL`, `GOTRUE_FAKE`, http, segredo curto, storage local, SSL off).
- **Cadeia de suprimento**: `npm audit`, integridade do vendor pdf.js, build reprodutível.

### Observação de documentação (não é vulnerabilidade)
`docs/API.md §9` mencionava a flag `ALLOW_SERVICE_KEY_IN_API=1` (removida em 2026-10-07: nunca era lida pelo código) para permitir a chave de serviço no processo da API; o código (`src/config.js`)
atualmente **exige** `SUPABASE_SERVICE_ROLE_KEY` em produção e **não lê** essa flag (ela só é usada por `tools/dev.js`). É *drift* de documentação —
alinhar o texto do contrato ao comportamento do código.

---

## 6. Recomendações priorizadas

**P0 — corrigir antes de produção** — **feito** (ver “Estado” em cada achado do §4)
1. **AF-1** (takeover por troca de senha): ~~exigir estado de recuperação~~ **feito** (403 fora do convite/recuperação). Habilitar também “Secure password change” no painel do Supabase (defesa extra, não executado aqui).
2. **AF-2** (posse de arquivo alheio no upload direto): **feito** (área de preparo por usuário + posse só após conferir os bytes).

**P1 — endurecimento**
3. **MFA/TOTP** para todos e **obrigatório para admins** (hoje não há segundo fator — item §3.2).
4. **SSO corporativo (SAML/OIDC)** da A&M (desprovisionamento no desligamento resolve o “ex-funcionário”; o esquema já preserva contas/dados por `app.user_identities`).
5. **AF-3/AF-4**: ~~tratar NUL (400, não 500) e fechar a evasão por U+000C no *lint*~~ **feito**.
6. **Atualizar `sharp`** — **feito**: `sharp` fixado em **0.35.5** (sem `^`; `npm audit --omit=dev` sem alertas altos nesta versão), testes de upload (`tests/api/assets.test.js`, `tests/unit/asset-validate*.test.js`) reexecutados. O `ci.yml` roda `npm audit --omit=dev` como **relatório** (não bloqueia; o resumo vai para o *step summary* e o JSON para os artefatos); para bloquear em severidade alta, troque o `|| true` por `--audit-level=high`.

**P2 — operação e resiliência**
7. **WAF/rate-limit de borda** (Vercel/Cloudflare) à frente da API: os limites por IP hoje podem punir um NAT de escritório; um WAF ajuda contra volumetria e padrões conhecidos.
8. **PITR / backup com restauração testada** do Postgres e do bucket (há `tools/backup.js`/`restore-drill.js`; garantir PITR no Supabase e ensaio periódico).
9. **Rotação de segredos** (`CSRF_SECRET`, chave de serviço do Supabase, credenciais de banco) com procedimento e periodicidade; **fixar versões** das dependências (hoje 8 com `^`; o lockfile trava, mas fixar reduz surpresa em `npm i`) e manter `npm audit` + verificação de integridade do vendor no CI.
10. **Reduzir o “JWT expiry”** no Supabase para encurtar a janela do token stateless após logout/suspensão (§3.3).
11. **AF-5**: ~~restringir a leitura de arquivos a referências da cópia de trabalho~~ **feito** (migração 0005).
12. **Processo de 4 olhos / alertas** para ações de admin sensíveis (transferência, purga, promoção), aproveitando a auditoria já existente.

---

## 7. Controles acrescentados em 2026-10-07 (rodada do editor em nuvem)

Provas executáveis: `tests/security/rotas-novas.test.js` (ataques), `tests/api/{prefs,interactions,quota,presentations}.test.js`, `tests/unit/{deck-lint,rates}.test.js`.

- **Preferências da pessoa** (`GET/PUT /api/me/prefs`, kits de marca e preferências do editor): tabela `app.user_prefs` com RLS — leitura e escrita só
  com `user_id = app.current_user_id()` **e conta ativa** (suspenso/convidado: nada); nem o admin lê as dos outros; `user_id` não é alterável (grant só em
  `prefs`/`updated_at`), não há DELETE para o app. A rota não recebe id de ninguém. Corpo: objeto ≤ 64 KB, profundidade ≤ 10, chaves
  `__proto__`/`constructor`/`prototype` recusadas em qualquer nível (400, sem poluição de protótipo), strings pela mesma varredura de HTML ativo do
  conteúdo (422 sem eco) — defesa em profundidade: uma sessão roubada não planta script nas preferências que o editor da vítima vai ler. CSRF e 60
  gravações/min por pessoa.
- **Apagar interações** (`DELETE …/interactions?elementId=&kind=`): a consulta não filtra por pessoa de propósito — quem decide é o RLS (`inter_delete`):
  dono/admin apagam tudo do elemento, os demais só os próprios (provado também direto no banco). Quem não vê a apresentação recebe 404 (lixeira alheia
  e inexistente iguais). Auditoria `interactions.delete` só com identificador do elemento e contagens (`deleted`, `others`) — nunca respostas (dados
  pessoais, LGPD).
- **Idempotência por `clientId`**: (apresentação, pessoa, `clientId`) é único no banco (índice parcial) e o `client_id` é imutável (gatilho). A busca do
  item existente é sempre restrita à própria pessoa: o mesmo `clientId` de outra pessoa cria um item novo — nunca devolve o item (ou o id) alheio.
  Conferido depois da trava por elemento: reenvios simultâneos não duplicam e não esbarram no teto de 500.
- **Tetos de interação por tipo**: estado de quadro/votação ≤ 256 KB de JSON e respostas/reações/visualizações ≤ 64 KB na API; corpo limitado a
  264 KB antes de ler; o CHECK do banco é rede de segurança (2 MB para estados — o binário do jsonb de listas de números pequenos chega a ~6× o
  texto —, 64 KB para os demais).
- **Lint × texto digitado (BE-ED-09)**: o editor guarda o que a pessoa digita escapado (`&lt;form&gt;`), inerte no navegador; as formas decodificadas
  existem só contra quem decodificasse duas vezes. Nelas passa a ser aceita apenas a **citação de tag passiva sem atributos** (`<form>`, `<link>`,
  `<meta>`, `<base>`, `<iframe>`, `<object>`, `<embed>`, `<template>`, `<noscript>`…: mesmo decodificadas não executam, não carregam nada e não
  enviam dados). Continuam recusados em qualquer forma `<script>`, `<style>`, `<svg>`, `<math>`, tags da lista **com** atributo, eventos, `srcdoc`,
  URLs/CSS perigosos e, nas formas decodificadas, `action`/`formaction`/`form` (um `<form>` citado não vira formulário que envia para fora). A forma
  crua não mudou (tag literal = HTML de verdade = recusada) e o corpus `tests/fixtures/xss-corpus.js` continua **todo** recusado, inclusive as
  codificações de `<script>`. Resíduo aceito: citar `<script>`/`<style>`/`<svg>`/`<math>` ou um atributo de evento entre aspas (`"onclick="`) numa
  caixa de texto continua recusado — agora com o slide e o elemento apontados, para a pessoa reescrever ("tag script").
- **`details.issues` sem eco**: `{slide, elementId, reason}`, no máximo 20; o id do elemento só volta se for identificador simples
  (`[A-Za-z0-9_-]{1,64}`) — um id hostil vira `null`; `reason` é sempre um código fixo.
- **Uploads**: 300/min por pessoa (importação de PPTX/PDF com muitas imagens); o teto por IP continua sendo × `RATE_IP_MULTIPLIER` e o 301º envio
  (barrado no balde da pessoa) não consome o do IP. **Cota opcional por pessoa** (`STORAGE_QUOTA_USER_MB`): impede que uma conta (ou sessão
  comprometida) encha o armazenamento; conferida com trava por pessoa na transação do registro, pelo tamanho declarado no upload direto e pelo
  tamanho REAL antes de promover o objeto (quem declara pouco e envia muito é barrado sem nada chegar à chave canônica); deduplicação nunca é
  barrada.

