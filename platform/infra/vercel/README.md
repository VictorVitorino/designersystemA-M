# Vercel — projeto, variáveis, domínio e limites

Um **projeto** na Vercel (plano **Pro**) serve o site estático (CDN) e **uma** função Node (`platform/api/index.js` → todas as rotas `/api/*`). Dois ambientes: **Production** e um ambiente personalizado **`staging`**.

> **O workflow *Configurar Vercel*** (`tools/vercel-setup.js`) faz os §1–§4 sozinho e confere relendo: cria/ajusta o projeto, o ambiente `staging`, as variáveis da API de cada ambiente (a partir das chaves do GitHub, `docs/CHAVES.md`), o domínio e a proteção, e lista o DNS para a TI. **Não executado contra a Vercel real** ao ser escrito (testado contra uma API falsa): a primeira execução, em staging, é o teste — use a opção *simular* para só ver o que mudaria. Este documento explica o que ele faz e serve de plano B manual. Fontes e limites: `docs/pesquisa/vercel.md`.

## 1. Criar o projeto

1. (automático) O projeto `canteiro` é criado no time **Canteiro A&M** **sem** ligação com o Git (quem publica é o GitHub Actions, com `vercel deploy --prebuilt`). Plano B: Vercel → *Add New… → Project* → importar o repositório.
2. **Root Directory = `platform`**. *Framework Preset* = **Other**.
3. Marcar **Include source files outside of the Root Directory in the Build Step** — o build do site usa `studio/`, `am/` e `fonts2/`, que ficam fora de `platform/`.
4. *Node.js Version* = **22.x**.
5. Comandos (já definidos em `platform/vercel.json`; deixe em branco no painel): *Build* `node tools/build-web.js`, *Output* `dist/public`. *Install* `npm ci`. (O build usa Python 3 — presente na imagem de build da Vercel.)
6. **Região das funções: `gru1` (São Paulo)** — também fixada no `vercel.json`. Banco e arquivos do Supabase em `sa-east-1`.
7. Settings → **Git**: deploys automáticos desligados (*Ignored Build Step* = `exit 0`; o workflow grava isso). (Se quiser *previews* de Pull Request, deixe ligado só para eles e **sem segredos** — §3.)

## 2. Ambientes e variáveis

| Ambiente Vercel | Quem publica | Variáveis |
|---|---|---|
| **Production** | `deploy-production.yml` (`vercel deploy --prebuilt --prod`) | `infra/env/api.production.env.example` |
| **`staging`** (*Settings → Environments → Create Environment*; recurso do Pro) | `deploy-staging.yml` (`--target=staging`) | `infra/env/api.staging.env.example` |
| Preview | não usado em produção | **nenhuma variável de produção/staging**; se usar, dados de demonstração |
| Development | não usado | — |

- O *Configurar Vercel* grava cada variável **apenas no ambiente certo**, com os segredos como **Sensitive** (não podem ser lidos depois no painel): `APP_ENV`, `APP_ORIGIN`, `DATABASE_URL` (pooler em modo transação, usuário `app_api.<ref>`), `DATABASE_SSL`, `DB_POOL_MAX`, `SUPABASE_URL`, `SUPABASE_JWKS_URL`, as duas chaves do Supabase, `STORAGE_DRIVER` e `S3_*`, `CSRF_SECRET` (gerado na 1ª vez), `TRUST_PROXY`, `LOG_LEVEL` e, se existirem no GitHub, `INVITE_ALLOWED_DOMAINS`, `RATE_IP_MULTIPLIER`, `SENTRY_DSN`, `SSO_ENABLED`/`SSO_DOMAINS` e `STORAGE_QUOTA_USER_MB`. As variáveis só valem a partir do **próximo deploy**.
- **Proibido** na Vercel: `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL`, `APP_API_DB_PASSWORD`, `APP_OPS_DB_PASSWORD`, `BACKUP_*`, `RESEND_API_KEY`, `GOTRUE_FAKE`, `TEST_DATABASE_ADMIN_URL` e qualquer variável com prefixo público (`NEXT_PUBLIC_`, `VITE_`…) contendo segredo. O *Configurar Vercel* **remove** essas se alguém as tiver posto; a API recusa iniciar se achar as duas primeiras; e o deploy confere a lista (`verify-deploy.js --api-env-file`).
- A chave de serviço do Supabase (`SUPABASE_SERVICE_ROLE_KEY`) **precisa** existir na Vercel (convidar usuários); ela é *Sensitive* e nunca vai ao navegador. Projetos novos do Supabase (a partir de nov/2025) só têm as chaves novas: use a **secret key** (`sb_secret_…`) em `SUPABASE_SERVICE_ROLE_KEY` e a **publishable key** (`sb_publishable_…`) em `SUPABASE_ANON_KEY` — a API as envia só no cabeçalho `apikey`, como o Supabase exige (`src/auth/gotrue.js`, teste `tests/api/supabase-keys.test.js`).
- `RELEASE`: a Vercel expõe `VERCEL_GIT_COMMIT_SHA`; para marcar a versão no `/api/health`, defina `RELEASE` no deploy (opcional).

## 3. Proteção de deployments (previews e staging)

Settings → **Deployment Protection** → *Vercel Authentication* = **Standard Protection** (o workflow grava): as URLs `*.vercel.app` (previews e deploys sem domínio) pedem login na Vercel; os **domínios do Canteiro** (`canteiro.<seu-dominio>` e `staging.canteiro.<seu-dominio>`) ficam abertos **na internet**, e o Canteiro exige o login próprio. É por isso que o deploy, o smoke e o monitor sondam sempre o **domínio** (`PRODUCTION_URL`/`STAGING_URL`), nunca a URL `*.vercel.app`.
Se a empresa quiser esconder o staging da internet (*Password Protection*, add-on, ou proteção também nos domínios): crie em Deployment Protection → **Protection Bypass for Automation** o segredo de automação e cole-o como `VERCEL_AUTOMATION_BYPASS_SECRET` no ambiente do GitHub (e no repositório, para o monitor); o verify-deploy, o smoke e o `uptime.yml` mandam o cabeçalho `x-vercel-protection-bypass` quando ele existe. O monitor externo precisa alcançar `/api/health`.

## 4. Domínio

1. (automático) Settings → **Domains**: `canteiro.<seu-dominio>` (Production, de `PRODUCTION_URL`) e `staging.canteiro.<seu-dominio>` (ambiente `staging`, de `STAGING_URL`). O resumo do workflow traz o registro de DNS que a TI cria.
2. DNS: registro `CNAME` para o alvo que a Vercel mostrar (ou `A` para apex). Certificado TLS e renovação são automáticos; **HSTS** vem do `vercel.json`.
3. `APP_ORIGIN` = exatamente `https://canteiro.<seu-dominio>`; *Site URL* do Supabase idem.

## 5. Firewall (WAF) — recomendado

Security → **Firewall** (regras valem sem novo deploy): rate limit por IP para `/api/auth/*` (ex.: 60/min), `PUT /api/assets/*` e `/api/presentations/*/content`; bloquear países/IPs se a empresa quiser. Isto **complementa** o limite do próprio app (`app.hit_rate`), que continua sendo a defesa principal. Não ponha o Cloudflare em modo proxy na frente da Vercel (recomendação da própria Vercel).

## 6. Limites que importam (Pro)

| Limite | Valor | Consequência no Canteiro |
|---|---|---|
| **Corpo da requisição/resposta da função** | **4,5 MB** (acima: erro 413 `FUNCTION_PAYLOAD_TOO_LARGE`) | a API se ajusta sozinha na Vercel (variável `VERCEL`, que a própria plataforma define): **salvar/criar apresentação até 4 MiB** (medido em bytes; `MAX_JSON_BYTES`), **envio de arquivo pela API até 4 MiB** e **arquivo servido pela API até 4 MiB** (acima disso, redirecionamento para URL assinada do bucket). O editor recomprime imagens para caber; uma apresentação acima de 4 MB recebe uma mensagem clara (413) dizendo o limite. O envio direto ao bucket por URL assinada existe na API, mas os clientes do produto não o usam hoje (a CSP não libera o host do bucket) |
| Duração máxima | configurada em **60 s** (`vercel.json`); o Pro permite mais (padrão 300 s) | salvar/abrir apresentações de até 4 MiB cabe com folga |
| Memória | configurada em **1024 MB** (`vercel.json`; com *Fluid compute* a Vercel pode ignorar e usar a de Settings → Functions — confira no 1º staging) | `sharp` (validação de imagens) cabe; suba para 2 GB se processar imagens muito grandes |
| Conexões ao banco | cada instância serverless abre poucas conexões | por isso `DB_POOL_MAX` ≤ 3–5 e **pooler em modo transação (6543)** |
| Logs de função | **1 dia** no Pro | exporte o que precisar; log drain é opcional e pago |
| Tráfego/Execuções | cotas do plano | veja `docs/pesquisa/vercel.md` e `docs/pesquisa/recomendacao-e-custos.md` |
| *Cold start* | primeira requisição depois de ociosidade é mais lenta | `/api/health` do monitor mantém a função aquecida |

## 7. Operação

- **Rollback:** Deployments → versão anterior → *Instant Rollback*, ou `npx vercel@62.5.0 rollback`, ou o *Deploy produção* rodado na tag anterior (`docs/OPERACAO.md` §5.2). Não altera o banco.
- **Logs:** Logs (filtrar por `status`, rota, `requestId`). Observabilidade/Sentry: `docs/MONITORAMENTO.md` (**Sentry é opcional e externo**).
- **Token de CI:** Account Settings → Tokens (escopo do time); rotação em `docs/OPERACAO.md` §3.
- **Variáveis do CI:** só o `VERCEL_TOKEN` (secret dos ambientes `staging` e `production-ops`). O time e o projeto são **descobertos** pelo próprio token (`vercel-setup.js ids`); `VERCEL_TEAM`, `VERCEL_PROJECT`, `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` são opcionais. O workflow roda a CLI **na raiz do repositório** (porque o Root Directory é uma configuração do projeto) com a versão **fixa** `vercel@62.5.0` (atualize em `deploy-*.yml`, variável `VERCEL_CLI_VERSION`).
