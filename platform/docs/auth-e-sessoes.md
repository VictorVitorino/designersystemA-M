# Autenticação, sessões e administração

Escopo: `src/auth/*` (inclusive `sso.js`), `src/middleware/{request-id,security-headers,access-log,csrf,session}.js`, `src/routes/{auth,admin,health}.js`, `src/static.js`, `tools/{fake-gotrue,create-first-admin}.js`.
O contrato HTTP continua em `docs/API.md` (§2, §3, §7, §8). Este arquivo explica **como funciona por dentro** e o que operar.

## Visão geral

A API é o único cliente do Supabase Auth (GoTrue). O navegador nunca recebe nem guarda token: só cookies `HttpOnly`.

```
navegador ──cookies──▶ API (Hono) ──fetch──▶ GoTrue (Supabase Auth)
                         │
                         └─ Postgres: app.users / app.user_identities / app.invites / app.audit_log / app.rate_limits (RLS)
```

Ordem dos middlewares (`src/app.js`): `requestId` → `securityHeaders` → `accessLog` → `csrf` → `session` → rotas.

## Cookies

| Cookie (produção) | Conteúdo | Flags |
|---|---|---|
| `__Host-am_at` | access token (JWT, ~1 h) | HttpOnly, Secure, SameSite=Lax, Path=/ |
| `__Host-am_rt` | refresh token (30 d) | idem |
| `__Host-am_csrf` | 32 bytes aleatórios (base64url) | **não** HttpOnly (o app o devolve no cabeçalho), Secure, Lax |
| `__Host-am_np` | estado de **recuperação** (pode definir senha): `exp.HMAC-SHA256(segredo, sessão do JWT, exp)`, emitido só por `/verify`, 1 h — é **autorização**, não só UX; um valor forjado não passa | HttpOnly |
| `__Host-am_sso` | estado do login corporativo em andamento: `base64url({verifier PKCE, destino, validade}).HMAC-SHA256(segredo)`, 10 min, **uso único** (apagado no retorno) — só entre `/api/auth/sso` e `/api/auth/sso/callback` | HttpOnly, Lax |

Em `local`/`test` com `http://` os nomes não têm prefixo e não há `Secure`. O prefixo `__Host-` obriga Secure + Path=/ + sem Domain: nenhum subdomínio ou HTTP consegue plantar o cookie.

## Sessão (middleware)

1. Lê `am_at`, verifica o JWT (`src/auth/jwt.js`): ES256/RS256 por JWKS **ou** HS256 por segredo; exige `iss`, `aud=authenticated`, `exp`, `sub`, papel `authenticated`. `alg: none` e confusão de algoritmo são recusados.
2. Mapeia (provedor, `sub`) → usuário com `app.resolve_identity(provedor, sub, …)` (só funciona para convidados). O provedor vem do token: `sso:<id-do-provedor>` quando `app_metadata.provider` é de SSO; `supabase` para e-mail/senha (convite, recuperação, login). Resultado em cache de memória por **no máximo 15 s**.
3. Estados: sem cookie → `user=null`; expirado → 401 `session_expired`; adulterado → 401; sem convite → 403 `not_invited` (inclui convite **vencido, expirado ou revogado**: desde a migração 0010, `resolve_identity` só reconhece um usuário `invited` com convite `pending` dentro do prazo `invites.ttl_days` — o administrador reenvia o convite); suspenso → 403 `suspended`; `invited` (ainda sem senha) → só `/api/auth/*`.
4. `GET /api/auth/session` renova sozinho (pelo refresh token) se o access token sumiu/expirou — é o que o app chama ao abrir. Renovações simultâneas com o mesmo refresh token viram uma só chamada ao GoTrue.

Suspender alguém: o banco passa a recusar na hora (cache invalidado nesta instância; nas outras, em até 15 s). O bloqueio no GoTrue (`ban_duration`) impede novo login e renovação.

## Fluxos

- **Convite**: admin → `POST /api/admin/invites` (usuário `invited` + convite + e-mail do GoTrue na mesma transação; falha do GoTrue desfaz tudo) → usuário abre o link `/auth/confirmar?token_hash=…&type=invite` → `POST /api/auth/verify` (sessão, `needsPassword`) → `POST /api/auth/password` (ativa) → login normal.
- **Login**: limite de taxa (8/10 min por e-mail+IP, 30/10 min por IP) **antes** de falar com o GoTrue; falhas idênticas e com tempo equalizado; auditoria `auth.login` / `auth.login_failed` (só HMAC do e-mail).
- **Esqueci a senha**: sempre 202; limite 5/15 min por IP e por e-mail; link `type=recovery` → `verify` → `password`.
- **Trocar senha**: só em **estado de recuperação** — logo depois de abrir um link de convite ou de “esqueci a senha” (`status = invited` ou cookie `am_np = 1`); uma sessão ativa comum recebe **403** (uma sessão roubada não toma a conta). Trocar encerra as *outras* sessões (`logout?scope=others`).
- **Sair**: revoga só este dispositivo (`scope=local`) e apaga os cookies.

## SSO corporativo (SAML do Supabase Auth com PKCE)

Desligado por padrão (`/api/auth/sso*` → 501). Liga com `SSO_ENABLED=true` + `SSO_DOMAINS=<domínios>`; o lado do Supabase (provedor SAML, URL de retorno permitida) está em `infra/supabase/sso-saml.md`.
Peças puras em `src/auth/sso.js` (PKCE, estado assinado, destino seguro), rotas em `src/routes/auth.js`, chamadas ao GoTrue em `src/auth/gotrue.js` (`ssoUrl`, `exchangeCode`).

```
navegador ──GET /api/auth/sso?email=ana@empresa.com&next=/editor/<id>──▶ API
   API: domínio em SSO_DOMAINS? par PKCE (verifier, desafio S256) → POST {SUPABASE_URL}/auth/v1/sso {domain, redirect_to, desafio}
   API ◀── {url do IdP} ── GoTrue           API ──302 Location: <IdP> + Set-Cookie am_sso=<verifier+next assinado> (HttpOnly, 10 min)──▶ navegador
navegador ──▶ IdP da empresa (login corporativo, MFA do IdP) ──POST SAML──▶ GoTrue (ACS) ──302 {APP_ORIGIN}/api/auth/sso/callback?code=…──▶ navegador
navegador ──GET /api/auth/sso/callback?code=… (+ cookie am_sso)──▶ API
   API: apaga am_sso (uso único) → POST /auth/v1/token?grant_type=pkce {auth_code, code_verifier} → sessão → JWT verificado → provedor é sso:<id>?
        e-mail do IdP em SSO_DOMAINS e verificado? → resolve_identity('sso:<id>', sub, e-mail, true, allow_link, touch) → cookies de sessão + CSRF novo → 302 next
```

- **Contas preservadas**: o Supabase cria para o SSO **outro** `auth.users` (mesmo e-mail, id diferente). Na plataforma, `resolve_identity` acrescenta a identidade `('sso:<id>', sub)` à pessoa **já existente** em `app.users` pelo e-mail verificado — mesmo id interno, mesmo papel, mesmas apresentações. Da 2ª vez em diante resolve direto pela identidade. O login por senha continua valendo (convivência).
- **Nunca cria conta**: sem `app.users` com o e-mail (convite), nada é vinculado → `motivo=not_invited`; a sessão que o GoTrue emitiu é revogada (`logout`). Convidado que ainda não definiu senha entra e tem o convite aceito (o IdP provou o e-mail, como o link do convite provaria). Suspenso → `motivo=suspended` (com identidade SSO já vinculada) ou `not_invited` (o banco nunca vincula identidade nova a conta suspensa). Convite revogado = conta suspensa.
- **Amarração ao navegador (login CSRF / fixação de sessão)**: o código do IdP só vira sessão com o `code_verifier` que está no cookie HttpOnly do navegador que **começou** o fluxo; o código de outra pessoa, um replay ou um cookie forjado/vencido dão `motivo=sso_expirou` e nenhuma sessão. O verifier nunca vai ao IdP nem à URL (só o desafio S256).
- **Domínio duas vezes**: no início (o e-mail/domínio pedido) e no retorno (o e-mail que o IdP afirmou) — um IdP mal configurado ou de outra empresa não vincula conta de um domínio que não é dele (`motivo=sso_dominio`). O vínculo por e-mail exige `email_verified === true` explícito no token de SSO (o GoTrue afirma isso nas asserções SAML); no `kit.resolve` a identidade SSO só é vinculada com e-mail de `SSO_DOMAINS` (defesa em profundidade).
- **Erros são navegações**: tudo volta para `/entrar?motivo=<código>` (`sso_email`, `sso_dominio`, `sso_indisponivel`, `sso_expirou`, `sso_falhou`, `sso_limite`, `not_invited`, `suspended`) com `next` preservado; a descrição de erro do IdP nunca é ecoada. `next` só aceita caminho interno (`sso.js › safeNext`, a mesma regra do cliente).
- **Limites**: 100 inícios e 100 retornos por IP a cada 10 min (`sso_ip`, `sso_cb_ip`; um escritório inteiro entra de manhã sem travar).
- **Suspender** alguém bane no GoTrue **todas** as contas com o e-mail (senha e SSO) — `findUserIdsByEmail`; a barreira principal continua sendo o banco (≤ 15 s).
- **Auditoria**: `auth.sso_start` (domínio), `auth.login` com `{via:'sso', provider}`, `auth.login_failed` com `{email_hash, reason, via:'sso'}`, `auth.sso_refused` com o motivo. Nunca código, verifier, token ou e-mail em claro.
- **Testes**: `tests/unit/sso.test.js` (PKCE com o vetor do RFC 7636, estado, destino), `tests/unit/{jwt,gotrue,config}.test.js`, `tests/api/sso.test.js` (fluxo inteiro no GoTrue falso: conta existente, admin, convidado, não convidado, suspenso, cancelamento, retorno sem cookie, suspensão bane as duas contas, limite) e `tests/security/sso.test.js` (fixação, replay, cookie forjado, IdP de outro domínio, e-mail não verificado, redirecionamento aberto, eco, segredos).
  O GoTrue falso (`tools/fake-gotrue.js`) implementa `POST /auth/v1/sso`, o `grant_type=pkce` e um IdP falso em `GET /__sso/idp?flow=…&email=…[&sub=…][&verified=0][&cancel=1]`; `fake.addSsoProvider('empresa.com')` cadastra o provedor.

## CSRF

Em POST/PUT/PATCH/DELETE: (a) `X-CSRF-Token` = cookie `am_csrf` (tempo constante), (b) `Origin == APP_ORIGIN` (ou `Sec-Fetch-Site: same-origin` sem Origin), (c) `Content-Type: application/json` (ou binário só em `PUT /api/assets/<sha256>`). O token é novo a cada login. Bloqueios são auditados (`security.csrf_blocked`, sem corpo, no máximo 20 linhas/min por IP).

## Auditoria e privacidade

Nunca entram na auditoria nem no log: senha, token, corpo de requisição, query string, cookies, e-mail em claro de login/recuperação/convite (usa-se `HMAC-SHA256(CSRF_SECRET, e-mail)`). O log de acesso é uma linha JSON por requisição (método, rota, status, ms, requestId, userId, ip).

## Administração

`GET/POST/PATCH/DELETE /api/admin/*` — só admin (o banco decide; membro recebe 403 até em caminhos inexistentes). O último administrador ativo não pode ser rebaixado (409; os admins ativos são travados em ordem para dois admins não se rebaixarem ao mesmo tempo). Revogar convite deixa o usuário "suspenso" (quem nunca entrou) e bane no GoTrue (melhor-esforço, falha auditada como `user.gotrue_sync_failed`).

### Criar o primeiro administrador

```bash
DATABASE_OPS_URL='postgres://app_ops:…@host:5432/postgres' \
SUPABASE_URL='https://xxxx.supabase.co' SUPABASE_SERVICE_ROLE_KEY='…' \
node tools/create-first-admin.js --email fulano@empresa.com --name "Fulano de Tal"
```

Idempotente (reenvia o convite se ainda pendente; não faz nada se já é admin ativo). As credenciais de operação ficam só no seu computador/CI.

## Servidor estático (`src/static.js`)

Só para dev/E2E/contêiner (na Vercel os arquivos saem da CDN). Serve `config.publicDir` com: bloqueio de path traversal/dotfiles/links simbólicos, sem listagem de diretório, reescritas de SPA, MIME corretos, CSP por página lida de `dist/csp.json` (`{ "default", "/editor/", "/visualizar/" }`; sem o arquivo → CSP estrita padrão), ETag, `Cache-Control` (HTML `no-cache`; `/assets` e `/js` com hash → 1 ano imutável) e repasse de `/api/*` à API.

## Testes

```bash
export TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_<seu_nome>
node --test --test-concurrency=1 tests/unit/*.test.js tests/api/auth.test.js tests/api/admin.test.js tests/api/session.test.js tests/security/*.test.js
```

`tests/helpers/boot.js` sobe API + Postgres real + GoTrue falso e devolve clientes com cookies/CSRF automáticos (uso documentado no topo do arquivo). `tools/fake-gotrue.js` recusa iniciar com `APP_ENV=production`; em teste/dev, os e-mails caem em `GET /__outbox`.

## Limitações conhecidas

- O access token (JWT) é *stateless*: depois do logout/troca de senha ele ainda verifica até expirar (≤ 1 h). O que protege é o banco (suspensão vale em ≤ 15 s) e o cookie ser apagado/HttpOnly. Para reduzir a janela, diminua "JWT expiry" no Supabase.
- O cache de identidade é por instância (serverless): mudanças feitas em outra instância valem em até 15 s.
- Limites por IP: login 30/10 min e esqueci-a-senha 5/15 min podem pegar vários usuários atrás do mesmo NAT de escritório; `verify` e `refresh` são limitados pelo próprio token (tetos por IP altos: 100/15 min e 600/min) justamente para não travar um escritório inteiro.
- O e-mail de convite vale pelo "Email OTP expiration" do Supabase (padrão 1 h, máx. 24 h), mesmo que o convite no app dure 7 dias: use "reenviar".
- SSO: quem não foi convidado e passa pelo IdP fica com uma conta SAML no `auth.users` do Supabase (sem acesso a nada: a plataforma recusa e revoga a sessão); dá para apagá-la pelo painel. Desligar `SSO_ENABLED` não derruba sessões SSO já abertas (a identidade continua vinculada): para cortar alguém, suspenda a pessoa.
