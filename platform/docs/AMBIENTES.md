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
| E-mail | caixa de saída falsa (`/__outbox`) | idem | Resend (SMTP do Supabase), domínio `canteiro.<seu-dominio>` | Resend, mesmo domínio |
| Domínio | `http://localhost:3000` | — | `https://staging.canteiro.<seu-dominio>` | `https://canteiro.<seu-dominio>` |
| Dados | `seed-demo` | criados pelos testes | **só dados de demonstração** (`seed-demo`) ou cópia anonimizada | reais |
| Backup | não | não | opcional (`STAGING_BACKUP=true`) | **diário, cifrado, externo** (Cloudflare R2, prefixo `producao/`) + ensaio mensal |
| HTTPS / HSTS / `__Host-` | não | não | **sim** | **sim** |
| Quem publica | — | — | automático a cada push em `main` (depois do CI), com `STAGING_ENABLED=true` | **só uma versão** (tag `v*`): criar a versão é a aprovação |

## Do código ao usuário (branch → ambiente)

```
branch de trabalho ──push/PR──▶ CI (ci.yml: testes + Postgres 17 do Supabase; e2e.yml; codeql.yml)   [ambiente: teste]
        │ merge via Pull Request (CI verde)
        ▼
      main ──push──▶ CI ─ ok ─▶ deploy-staging.yml                                          [ambiente GitHub: staging]
        │                        (chaves → migrações → verify-deploy → Vercel → verify-deploy do site → smoke)
        │ versão v1.2.3 (Releases; só administradores criam tags v*)
        ▼
 deploy-production.yml ── portão (ambiente production: só tags v*) ──▶ backup obrigatório → migrações →
                          verify-deploy → Vercel --prod → verify-deploy do site → smoke     [ambiente GitHub: production-ops]
```

Regras: ninguém publica em produção pelo computador; produção só sai de uma **versão** (tag `v*`), e só administradores do repositório criam versões (ruleset de tags, `docs/CONFIGURACAO.md` §3.3). No GitHub Pro com repositório privado não existem "Required reviewers": **criar a versão é a aprovação**. Ninguém faz *push* direto na `main` (ruleset: Pull Request e CI obrigatórios, sem *force push*). Hotfix segue o mesmo caminho (mais curto, mas o mesmo). Voltar a uma versão anterior: `docs/OPERACAO.md` §5.2.

## O que muda entre os ambientes

Tudo vem de variáveis de ambiente (`.env.example` lista todas). As que **nunca** podem ser iguais entre staging e produção:

| Variável | Por quê |
|---|---|
| `DATABASE_URL`, `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL`, senhas dos papéis | bancos diferentes, senhas diferentes |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL` | projetos diferentes: um token de staging **não pode** valer em produção |
| `S3_*` e o nome do bucket | arquivos diferentes; chaves diferentes |
| `CSRF_SECRET` | também é a chave dos HMAC de e-mail na auditoria |
| `BACKUP_*` | prefixo de destino diferente (`canteiro-backup/staging`, `canteiro-backup/producao`); o token de **escrita** só existe em `production-ops` |
| `APP_ORIGIN` | domínio diferente (o cookie `__Host-` é por domínio) |

`APP_ENV` muda o rigor: em `staging`/`production` a API **se recusa a iniciar** com HTTP, sem `CSRF_SECRET`, com `GOTRUE_FAKE`, com `DATABASE_SSL=disable` ou com `DATABASE_ADMIN_URL`/`DATABASE_OPS_URL` presentes (`src/config.js`). `production` exige ainda `STORAGE_DRIVER=s3`.

## Onde cada coisa é configurada

| O quê | Onde | Observação |
|---|---|---|
| Chaves (o que colar) | GitHub → Settings → Environments (`staging`, `production-ops`, `monitoring`) e Settings → Secrets and variables → Actions (repositório) | **lista completa e contagem: `docs/CHAVES.md`**; modelos `infra/env/ci-*.example` |
| Variáveis da API | Vercel → Environment Variables (por ambiente) | **gravadas pelo workflow "Configurar Vercel"** a partir das chaves do GitHub; modelos em `infra/env/api.*.env.example` |
| Projetos Supabase | painel do Supabase | **configurados pelo workflow "Configurar Supabase"** (`infra/supabase/config.toml` + `auth-settings.md`) |
| Projeto Vercel | painel da Vercel | criado/ajustado pelo "Configurar Vercel" (`infra/vercel/README.md`) |
| Interruptores | variáveis do repositório `STAGING_ENABLED`, `PRODUCTION_ENABLED`, `BACKUP_ENABLED` (e `CODEQL_ENABLED`) | enquanto não forem `true`, as rotinas agendadas não rodam nem abrem alertas |

Ambientes do GitHub (Settings → Environments). **Nenhum tem revisores** (não existem no plano Pro para repositório privado):

| Ambiente | *Deployment branches and tags* | Guarda | Usado por |
|---|---|---|---|
| `staging` | `main` | as 10 chaves do staging | `deploy-staging.yml`; `configurar-supabase.yml`, `configurar-vercel.yml` e `primeiro-admin.yml` com ambiente staging |
| `production` | **somente tags `v*`** | nada (é o **portão**) | `deploy-production.yml` (job "Portão") |
| `production-ops` | `main` e tags `v*` | as 13 chaves de produção | `deploy-production.yml` (publicação), `backup.yml`, `maintenance.yml`, `ensaio-restauracao.yml` e os assistentes com ambiente production |
| `monitoring` | `main` | só o token de **leitura** do backup | `uptime.yml` (frescor do backup) |

Por que dois ambientes de produção: o portão `production` garante que **só uma versão** chega à publicação (um branch qualquer é recusado pelo próprio GitHub antes de qualquer passo); o `production-ops` guarda os segredos num lugar só, porque backup, manutenção e ensaio rodam agendados a partir da `main` (que não é uma tag) e precisam dos mesmos valores. Restringir o `production-ops` a `main` e `v*` impede que um branch de trabalho leia os segredos; a `main` só muda por Pull Request.

**CodeQL no repositório privado:** exige a licença paga de Code Security; sem ela o workflow pula com um aviso (sem falhar). A cobertura de segurança fica com `npm run test:security`, `secret-scan` e `npm audit`, que rodam no CI a cada push e PR (`docs/CONFIGURACAO.md` §3.5).

## Quem pode o quê

| Papel | Pode | Não pode |
|---|---|---|
| **Desenvolvedor** | abrir PR, ver logs do CI, rodar local/test | ver segredos, criar versões, mexer em Vercel/Supabase de produção |
| **Administrador do repositório** (2 pessoas) | criar versões `v*` (= aprovar a produção), rodar os assistentes e o GC (`APAGAR`), gerir segredos dos ambientes | — (toda ação fica registrada no GitHub) |
| **Admin de TI** | Vercel, Supabase, DNS, Cloudflare, restauração | — (mas toda ação sensível deixa rastro no GitHub/Supabase/Vercel) |
| **Admin da plataforma** (no Canteiro) | convidar/suspender usuários, moderar apresentações, ver auditoria | acessar banco/infraestrutura |
| **Membro** | criar/editar as próprias apresentações, copiar, comentar | alterar apresentações de outros (só copiar) |

Mantenha **pelo menos 2 pessoas** em cada papel de continuidade (dono da organização no Supabase, dono do time na Vercel, administrador do repositório, admin da plataforma, guarda da chave dos backups) e a lista no cofre de senhas.

## Registro do que foi configurado (preencher)

| Item | Staging | Produção |
|---|---|---|
| `ref` do projeto Supabase | | |
| Região | `sa-east-1` | `sa-east-1` |
| Compute | Micro | Small |
| Servidor do banco (pooler) descoberto (aparece no resumo do deploy) | | |
| Domínio | | |
| Bucket de arquivos | `canteiro-arquivos-staging` | `canteiro-arquivos` |
| Bucket/prefixo de backup | `canteiro-backup/staging` (se ligado) | `canteiro-backup/producao` |
| Quem guarda a `BACKUP_ENCRYPTION_KEY` (2 pessoas + cofre) | | |
| Data do último ensaio de restauração aprovado | | |
