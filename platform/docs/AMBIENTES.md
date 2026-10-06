# Ambientes: local, teste, staging e produção

Quatro ambientes, cada um com **seu próprio banco, seus próprios arquivos, suas próprias chaves**. Regra de ouro: **nada de produção existe em outro ambiente** — nem dado, nem chave, nem senha.

## Visão geral

| | **Local** | **Teste (CI)** | **Staging** | **Produção** |
|---|---|---|---|---|
| Para quê | desenvolver | testes automáticos | ensaio de tudo antes de produção (inclusive migrações e restauração) | usuários reais |
| `APP_ENV` | `local` | `test` | `staging` | `production` |
| Onde roda | máquina da pessoa | runner do GitHub Actions | Vercel (ambiente personalizado `staging`) | Vercel (Production) |
| Banco | Postgres local (`canteiro_dev`) | Postgres 16 efêmero do CI (`canteiro_test`) | **projeto Supabase `canteiro-staging`** | **projeto Supabase `canteiro-prod`** |
| Arquivos | pasta local (`./.data/objects`) | pasta temporária / "moto" (S3 falso) | bucket privado `canteiro-arquivos-staging` | bucket privado `canteiro-arquivos` |
| Login | `tools/fake-gotrue.js` (falso) | idem | Supabase Auth do projeto de staging | Supabase Auth do projeto de produção |
| E-mail | caixa de saída falsa (`/__outbox`) | idem | SMTP real, remetente de staging | SMTP real |
| Domínio | `http://localhost:3000` | — | `https://staging.canteiro.<seu-dominio>` | `https://canteiro.<seu-dominio>` |
| Dados | `seed-demo` | criados pelos testes | **só dados de demonstração** (`seed-demo`) ou cópia anonimizada | reais |
| Backup | não | não | opcional (`STAGING_BACKUP=true`) | **diário, cifrado, externo** |
| HTTPS / HSTS / `__Host-` | não | não | **sim** | **sim** |
| Quem publica | — | — | automático a cada push em `main` (depois do CI) | **manual com aprovação** (revisores) |

## Do código ao usuário (branch → ambiente)

```
branch de trabalho ──push/PR──▶ CI (ci.yml, e2e.yml, codeql.yml)           [ambiente: teste]
        │ merge via Pull Request (CI verde + 1 revisão)
        ▼
      main ──push──▶ CI ─ ok ─▶ deploy-staging.yml                          [ambiente: staging]
        │                        (migrações → verify-deploy → Vercel → smoke)
        │ tag v1.2.3 ou "Run workflow" (digitar PRODUCAO)
        ▼
 deploy-production.yml ── aprovação dos revisores ──▶ backup → migrações → Vercel → verify-deploy → smoke   [ambiente: produção]
```

Regras: ninguém publica direto em produção pelo seu computador; ninguém faz *push* direto na `main` (proteja a branch: Pull Request obrigatório, CI obrigatório, sem *force push*). Hotfix segue o mesmo caminho (mais curto, mas o mesmo).

## O que muda entre os ambientes

Tudo vem de variáveis de ambiente (`.env.example` lista todas). As que **nunca** podem ser iguais entre staging e produção:

| Variável | Por quê |
|---|---|
| `DATABASE_URL`, `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL`, senhas dos papéis | bancos diferentes, senhas diferentes |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL` | projetos diferentes: um token de staging **não pode** valer em produção |
| `S3_*` e o nome do bucket | arquivos diferentes; chaves diferentes |
| `CSRF_SECRET` | também é a chave dos HMAC de e-mail na auditoria |
| `BACKUP_*` | prefixo de destino diferente (`.../staging`, `.../producao`) |
| `APP_ORIGIN` | domínio diferente (o cookie `__Host-` é por domínio) |

`APP_ENV` muda o rigor: em `staging`/`production` a API **se recusa a iniciar** com HTTP, sem `CSRF_SECRET`, com `GOTRUE_FAKE`, com `DATABASE_SSL=disable` ou com `DATABASE_ADMIN_URL`/`DATABASE_OPS_URL` presentes (`src/config.js`). `production` exige ainda `STORAGE_DRIVER=s3`.

## Onde cada coisa é configurada

| O quê | Local | Observação |
|---|---|---|
| Variáveis da API | Vercel → Settings → Environment Variables (por ambiente) | modelos em `infra/env/api.*.env.example` |
| Segredos de CI e operação | GitHub → Settings → Environments (`staging`, `production`, `production-ops`, `monitoring`) | modelos `infra/env/ci-*.secrets.example`; tabela completa em `docs/CONFIGURACAO.md` §Secrets |
| Variáveis não sigilosas do CI | GitHub → Settings → Variables (repositório) | `PRODUCTION_URL`, `STAGING_URL`, `STAGING_HOST`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `PG_CLIENT_MAJOR`… |
| Projetos Supabase | painel do Supabase | `infra/supabase/auth-settings.md` |
| Projeto Vercel | painel da Vercel | `infra/vercel/README.md` |

Ambientes do GitHub (Settings → Environments):

| Ambiente | Revisores | Restrição de branch/tag | Usado por |
|---|---|---|---|
| `staging` | nenhum | `main` | `deploy-staging.yml` |
| `production` | **2 pessoas** (o autor do deploy não aprova o próprio, se houver 3+) | `main` e tags `v*` | `deploy-production.yml`, GC aprovado |
| `production-ops` | nenhum (precisa rodar de madrugada) | **somente `main`** | `backup.yml`, `maintenance.yml` (cron) |
| `monitoring` | nenhum | `main` | `uptime.yml` (credencial **somente leitura** do bucket de backup) |

Por que `production-ops` existe separado: um ambiente com revisores obrigatórios **trava** jobs agendados esperando aprovação. Mantê-lo restrito à `main` (que exige Pull Request) é o que impede um branch qualquer de ler os segredos.

## Quem pode o quê

| Papel | Pode | Não pode |
|---|---|---|
| **Desenvolvedor** | abrir PR, ver logs do CI, rodar local/test | ver segredos, aprovar produção, mexer em Vercel/Supabase de produção |
| **Revisor de produção** (2 pessoas) | aprovar `deploy-production`, rodar GC | alterar segredos |
| **Admin de TI** | gerir segredos dos ambientes, Vercel, Supabase, DNS, backup, restauração | — (mas toda ação sensível deixa rastro no GitHub/Supabase/Vercel) |
| **Admin da plataforma** (no Canteiro) | convidar/suspender usuários, moderar apresentações, ver auditoria | acessar banco/infraestrutura |
| **Membro** | criar/editar as próprias apresentações, copiar, comentar | alterar apresentações de outros (só copiar) |

Mantenha **pelo menos 2 pessoas** em cada papel de continuidade (dono da organização no Supabase, dono do time na Vercel, admin do GitHub, admin da plataforma) e a lista no cofre de senhas.

## Registro do que foi configurado (preencher)

| Item | Staging | Produção |
|---|---|---|
| `ref` do projeto Supabase | | |
| Região | `sa-east-1` | `sa-east-1` |
| Conexão de operação escolhida (IPv4 dedicado **ou** pooler em modo sessão) | | |
| Domínio | | |
| Bucket de arquivos | | |
| Bucket/prefixo de backup e provedor | | |
| Quem guarda a `BACKUP_ENCRYPTION_KEY` (2 pessoas + cofre) | | |
| Data do último ensaio de restauração | | |
