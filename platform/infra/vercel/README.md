# Vercel — projeto, variáveis, domínio e limites

Um **projeto** na Vercel (plano **Pro**) serve o site estático (CDN) e **uma** função Node (`platform/api/index.js` → todas as rotas `/api/*`). Dois ambientes: **Production** e um ambiente personalizado **`staging`**.

> Passos de painel **não validados** contra a Vercel real (sem acesso ao escrever). Confira no primeiro staging; fontes e limites: `docs/pesquisa/vercel.md`.

## 1. Criar o projeto

1. Vercel → *Add New… → Project* → importar o repositório do GitHub.
2. **Root Directory = `platform`**. *Framework Preset* = **Other**.
3. Marcar **Include source files outside of the Root Directory in the Build Step** — o build do site usa `studio/`, `am/` e `fonts2/`, que ficam fora de `platform/`.
4. *Node.js Version* = **22.x**.
5. Comandos (já definidos em `platform/vercel.json`; deixe em branco no painel): *Build* `node tools/build-web.js`, *Output* `dist/public`. *Install* `npm ci`. (O build usa Python 3 — presente na imagem de build da Vercel.)
6. **Região das funções: `gru1` (São Paulo)** — também fixada no `vercel.json`. Banco e arquivos do Supabase em `sa-east-1`.
7. Settings → **Git**: desligue os deploys automáticos (o GitHub Actions publica): *Ignored Build Step* = `exit 0`. (Se quiser *previews* de Pull Request, deixe ligado só para eles e **sem segredos** — §3.)

## 2. Ambientes e variáveis

| Ambiente Vercel | Quem publica | Variáveis |
|---|---|---|
| **Production** | `deploy-production.yml` (`vercel deploy --prebuilt --prod`) | `infra/env/api.production.env.example` |
| **`staging`** (*Settings → Environments → Create Environment*; recurso do Pro) | `deploy-staging.yml` (`--target=staging`) | `infra/env/api.staging.env.example` |
| Preview | não usado em produção | **nenhuma variável de produção/staging**; se usar, dados de demonstração |
| Development | não usado | — |

- Cadastre cada variável **apenas no ambiente certo** (a Vercel permite escolher por variável). Marque como **Sensitive** os segredos (não podem ser lidos depois no painel).
- **Proibido** na Vercel: `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL`, `APP_API_DB_PASSWORD`, `APP_OPS_DB_PASSWORD`, `BACKUP_*`, `GOTRUE_FAKE`, `TEST_DATABASE_ADMIN_URL` e qualquer variável com prefixo público (`NEXT_PUBLIC_`, `VITE_`…) contendo segredo. A API recusa iniciar se achar as duas primeiras, e `verify-deploy.js --api-env-file` confere a lista.
- A chave de serviço do Supabase (`SUPABASE_SERVICE_ROLE_KEY`) **precisa** existir na Vercel (convidar usuários) e exige `ALLOW_SERVICE_KEY_IN_API=1`; ela é *Sensitive* e nunca vai ao navegador.
- `RELEASE`: a Vercel expõe `VERCEL_GIT_COMMIT_SHA`; para marcar a versão no `/api/health`, defina `RELEASE` no deploy (opcional).

## 3. Proteção de deployments (previews e staging)

Settings → **Deployment Protection**: *Vercel Authentication* = **Standard Protection** (previews e URLs `*.vercel.app` pedem login na Vercel). O domínio de **produção** e o de **staging** (atribuído ao ambiente `staging`) ficam públicos **na internet**, mas o Canteiro exige login próprio; se quiser esconder o staging da internet, use *Password Protection* (add-on) ou restrinja por Firewall (regra por IP). O monitor externo precisa alcançar `/api/health`.

## 4. Domínio

1. Settings → **Domains** → adicionar `canteiro.<seu-dominio>` (Production) e `staging.canteiro.<seu-dominio>` (atribuir ao ambiente `staging`).
2. DNS: registro `CNAME` para o alvo que a Vercel mostrar (ou `A` para apex). Certificado TLS e renovação são automáticos; **HSTS** vem do `vercel.json`.
3. `APP_ORIGIN` = exatamente `https://canteiro.<seu-dominio>`; *Site URL* do Supabase idem.

## 5. Firewall (WAF) — recomendado

Security → **Firewall** (regras valem sem novo deploy): rate limit por IP para `/api/auth/*` (ex.: 60/min), `PUT /api/assets/*` e `/api/presentations/*/content`; bloquear países/IPs se a empresa quiser. Isto **complementa** o limite do próprio app (`app.hit_rate`), que continua sendo a defesa principal. Não ponha o Cloudflare em modo proxy na frente da Vercel (recomendação da própria Vercel).

## 6. Limites que importam (Pro)

| Limite | Valor | Consequência no Canteiro |
|---|---|---|
| **Corpo da requisição/resposta da função** | **4,5 MB** (acima: erro 413 `FUNCTION_PAYLOAD_TOO_LARGE`) | upload de arquivo > 4 MB **não** passa pela API: usa **URL assinada** do bucket (`POST /api/assets/uploads` → `PUT` direto). `src/config.js` limita o corpo de upload pela API a 4 MB |
| Duração máxima | configurada em **60 s** (`vercel.json`); o Pro permite mais (padrão 300 s) | salvar/abrir apresentações de até 12 MB cabe com folga |
| Memória | configurada em **1024 MB** (`vercel.json`) | `sharp` (validação de imagens) cabe; suba para 2 GB se processar imagens muito grandes |
| Conexões ao banco | cada instância serverless abre poucas conexões | por isso `DB_POOL_MAX` ≤ 3–5 e **pooler em modo transação (6543)** |
| Logs de função | **1 dia** no Pro | exporte o que precisar; log drain é opcional e pago |
| Tráfego/Execuções | cotas do plano | veja `docs/pesquisa/vercel.md` e `docs/pesquisa/recomendacao-e-custos.md` |
| *Cold start* | primeira requisição depois de ociosidade é mais lenta | `/api/health` do monitor mantém a função aquecida |

## 7. Operação

- **Rollback:** Deployments → versão anterior → *Instant Rollback*, ou `npx vercel@62.5.0 rollback`. Não altera o banco.
- **Logs:** Logs (filtrar por `status`, rota, `requestId`). Observabilidade/Sentry: `docs/MONITORAMENTO.md` (**Sentry é opcional e externo**).
- **Token de CI:** Account Settings → Tokens (escopo do time); rotação em `docs/OPERACAO.md` §3.
- **Variáveis do CI:** `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` (Project Settings → General) como *variáveis do repositório*; `VERCEL_TOKEN` como secret dos ambientes `staging` e `production`. O workflow roda a CLI **na raiz do repositório** (porque o Root Directory é uma configuração do projeto) com a versão **fixa** `vercel@62.5.0` (atualize em `deploy-*.yml`, variável `VERCEL_CLI_VERSION`).
