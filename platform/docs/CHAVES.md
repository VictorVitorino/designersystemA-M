# Chaves: o que copiar e onde colar

**Total: 29 valores colados no GitHub** — repositório 4 (1 deles temporário) · ambiente `staging` 10 · ambiente `production-ops` 13 · ambiente `monitoring` 2 · ambiente `production` 0 — e, no fim, **3 interruptores** (digitar `true`).
Todo o resto (endereços do banco, endpoints, nomes de bucket, variáveis da API na Vercel) os workflows **montam sozinhos** a partir destes valores (`tools/chaves.js`).

> **Regra de ouro:** chave **nunca** vai por chat, e-mail, documento ou arquivo. Você copia do painel do serviço e cola **direto** no GitHub (ou no cofre de senhas). Quem opera os workflows só dispara e lê os resultados: os valores não aparecem em lugar nenhum (os logs mostram `***`).

## Onde colar (as 2 telas do GitHub)

- **Ambiente** (`staging`, `production-ops`, `monitoring`): GitHub → repositório → **Settings → Environments →** nome do ambiente → **Environment secrets → Add environment secret** (ou **Environment variables → Add environment variable**). Nome exatamente como na tabela, valor colado, **Add secret**.
- **Repositório**: GitHub → repositório → **Settings → Secrets and variables → Actions →** aba **Variables** (ou **Secrets**) **→ New repository variable/secret**.

Os 4 ambientes são criados uma vez (Settings → Environments → **New environment**), com a regra de quem pode usar cada um — veja `docs/CONFIGURACAO.md` §3.

## Antes de colar: gerar 7 senhas no cofre

Use o gerador do cofre de senhas da empresa (1Password, Bitwarden…), **só letras e números**, e salve cada uma no cofre com o nome indicado:

| No cofre, com o nome | Tamanho | Vai para |
|---|---|---|
| Canteiro staging — senha do banco | 32 letras e números | criação do projeto `canteiro-staging` no Supabase → depois `SUPABASE_DB_PASSWORD` (staging) |
| Canteiro produção — senha do banco | 32 letras e números | criação do projeto `canteiro-prod` → depois `SUPABASE_DB_PASSWORD` (production-ops) |
| Canteiro staging — app_api | 40 letras e números | `APP_API_DB_PASSWORD` (staging) |
| Canteiro staging — app_ops | 40 letras e números | `APP_OPS_DB_PASSWORD` (staging) |
| Canteiro produção — app_api | 40 letras e números | `APP_API_DB_PASSWORD` (production-ops) |
| Canteiro produção — app_ops | 40 letras e números | `APP_OPS_DB_PASSWORD` (production-ops) |
| Canteiro — chave dos backups | **43** letras e números | `BACKUP_ENCRYPTION_KEY` (production-ops). **Guarde também com uma 2ª pessoa**: sem ela nenhum backup abre |

## Repositório — 4 valores (Settings → Secrets and variables → Actions)

| # | Nome | Tipo | Copie daqui (tela exata) |
|---|---|---|---|
| 1 | `R2_ACCOUNT_ID` | Variable | Cloudflare → **R2 Object Storage** → **Overview** → painel da direita → **Account ID** (32 caracteres) |
| 2 | `PRODUCTION_URL` | Variable | digite o endereço de produção: `https://canteiro.<dominio-da-empresa>` |
| 3 | `STAGING_URL` | Variable | digite o endereço de staging: `https://staging.canteiro.<dominio-da-empresa>` |
| 4 | `SUPABASE_ACCESS_TOKEN` | Secret **TEMPORÁRIO** | supabase.com → avatar → **Account preferences → Access Tokens → Generate new token** (nome `canteiro-configurar`, validade 1 dia). **Apague** do GitHub e revogue no Supabase assim que os dois "Configurar Supabase" ficarem verdes: ele abre todos os projetos da conta |

## Ambiente `staging` — 10 valores (projeto `canteiro-staging`)

| # | Nome | Tipo | Copie daqui (tela exata) |
|---|---|---|---|
| 1 | `SUPABASE_PROJECT_REF` | Variable | Supabase → projeto `canteiro-staging` → **Project Settings → General → Project ID** (20 letras; é o mesmo trecho do endereço do painel) |
| 2 | `SUPABASE_DB_PASSWORD` | Secret | cofre → "Canteiro staging — senha do banco" (a que você usou ao criar o projeto) |
| 3 | `SUPABASE_ANON_KEY` | Secret | Supabase → **Project Settings → API Keys → Publishable key** → copiar (começa com `sb_publishable_`) |
| 4 | `SUPABASE_SERVICE_ROLE_KEY` | Secret | mesma tela → **Secret keys** → chave `default` → ícone de copiar (começa com `sb_secret_`) |
| 5 | `S3_ACCESS_KEY_ID` | Secret | Supabase → **Storage → S3 Configuration** (aba *S3 Connection*) → **New access key** (descrição `canteiro-api`) → **Access key ID** |
| 6 | `S3_SECRET_ACCESS_KEY` | Secret | mesma janela → **Secret access key** (só aparece uma vez: cole antes de fechar) |
| 7 | `APP_API_DB_PASSWORD` | Secret | cofre → "Canteiro staging — app_api" |
| 8 | `APP_OPS_DB_PASSWORD` | Secret | cofre → "Canteiro staging — app_ops" |
| 9 | `RESEND_API_KEY` | Secret | Resend → **API Keys → Create API Key** → nome `canteiro`, permissão **Full access** → copiar (começa com `re_`). A mesma chave serve para os dois ambientes |
| 10 | `VERCEL_TOKEN` | Secret | Vercel → avatar → **Account Settings → Tokens → Create Token** → nome `canteiro-github`, escopo **Canteiro A&M**, validade 1 ano → copiar. O mesmo token serve para os dois ambientes |

## Ambiente `production-ops` — 13 valores (projeto `canteiro-prod` + backup)

Os 10 primeiros são os **mesmos itens** do staging, copiados agora do projeto **`canteiro-prod`** (e com as senhas de produção do cofre):

| # | Nome | Tipo | Copie daqui (tela exata) |
|---|---|---|---|
| 1 | `SUPABASE_PROJECT_REF` | Variable | Supabase → projeto `canteiro-prod` → **Project Settings → General → Project ID** |
| 2 | `SUPABASE_DB_PASSWORD` | Secret | cofre → "Canteiro produção — senha do banco" |
| 3 | `SUPABASE_ANON_KEY` | Secret | `canteiro-prod` → **Project Settings → API Keys → Publishable key** |
| 4 | `SUPABASE_SERVICE_ROLE_KEY` | Secret | `canteiro-prod` → **Project Settings → API Keys → Secret keys** → `default` |
| 5 | `S3_ACCESS_KEY_ID` | Secret | `canteiro-prod` → **Storage → S3 Configuration → New access key** → **Access key ID** |
| 6 | `S3_SECRET_ACCESS_KEY` | Secret | mesma janela → **Secret access key** |
| 7 | `APP_API_DB_PASSWORD` | Secret | cofre → "Canteiro produção — app_api" |
| 8 | `APP_OPS_DB_PASSWORD` | Secret | cofre → "Canteiro produção — app_ops" |
| 9 | `RESEND_API_KEY` | Secret | a mesma do staging (Resend → API Keys) |
| 10 | `VERCEL_TOKEN` | Secret | o mesmo do staging (Vercel → Account Settings → Tokens) |
| 11 | `BACKUP_S3_ACCESS_KEY_ID` | Secret | Cloudflare → **R2 Object Storage → Manage API tokens → Create Account API token** → nome `canteiro-backup-escrita`, permissão **Object Read & Write**, **Apply to specific buckets only: `canteiro-backup`** → **Access Key ID** |
| 12 | `BACKUP_S3_SECRET_ACCESS_KEY` | Secret | mesma tela → **Secret Access Key** (só aparece uma vez) |
| 13 | `BACKUP_ENCRYPTION_KEY` | Secret | cofre → "Canteiro — chave dos backups" (43 letras e números) |

## Ambiente `monitoring` — 2 valores (só LEITURA do backup)

| # | Nome | Tipo | Copie daqui (tela exata) |
|---|---|---|---|
| 1 | `BACKUP_S3_ACCESS_KEY_ID` | Secret | Cloudflare → **R2 Object Storage → Manage API tokens → Create Account API token** → nome `canteiro-backup-leitura`, permissão **Object Read only**, bucket `canteiro-backup` → **Access Key ID** |
| 2 | `BACKUP_S3_SECRET_ACCESS_KEY` | Secret | mesma tela → **Secret Access Key** |

Este ambiente **não** recebe a chave dos backups: ele só confere, de 4 em 4 horas, se o último backup existe e é recente.

## Ambiente `production` — nenhum valor

É o **portão** da produção: só aceita versões (tags `v*`). Não guarda segredo. Os segredos de produção ficam todos em `production-ops`.

## Interruptores (variáveis do repositório, valor `true`) — 3, um de cada vez

| Nome | Quando ligar | O que acontece |
|---|---|---|
| `STAGING_ENABLED` | quando o staging estiver configurado (`docs/PUBLICACAO.md` etapa 1) | cada push na `main` publica no staging; o monitor do GitHub passa a sondar o staging |
| `PRODUCTION_ENABLED` | depois da 1ª publicação em produção | o monitor do GitHub sonda a produção; a manutenção semanal passa a rodar |
| `BACKUP_ENABLED` | depois do 1º backup manual verde | backup diário, conferência de frescor a cada 4 h e ensaio de restauração mensal |

Antes de ligar, nada disso roda nem abre alerta (só um aviso "desligado" no resumo).

## Opcionais (não precisa no começo)

| Nome | Onde | Para quê |
|---|---|---|
| `SUPABASE_REGION` | variável do ambiente | só se o projeto **não** estiver em São Paulo (`sa-east-1`) |
| `SUPABASE_POOLER_HOST` | variável do ambiente | o servidor do banco (pooler) é descoberto sozinho; fixe aqui só se o resumo pedir |
| `S3_BUCKET`, `BACKUP_BUCKET` | variável | nomes diferentes de `canteiro-arquivos(-staging)` e `canteiro-backup` |
| `BACKUP_INCLUDE_AUTH` | variável do repositório | `0` tira as contas do login do backup (padrão: **incluídas**) |
| `EMAIL_REMETENTE` | variável do repositório | remetente diferente de `nao-responda@<host de PRODUCTION_URL>` |
| `INVITE_ALLOWED_DOMAINS` | variável do repositório ou do ambiente | só aceita convites para estes domínios de e-mail (ex.: `alvarezandmarsal.com`) |
| `SSO_ENABLED`, `SSO_DOMAINS` | variável do ambiente | login corporativo (SAML); passo a passo em `infra/supabase/sso-saml.md`. Para desligar: `SSO_ENABLED=false` e rode "Configurar Vercel" |
| `STORAGE_QUOTA_USER_MB` | variável do ambiente | cota de arquivos por pessoa, em MB (`20480` = 20 GB; `0` = sem cota) |
| `WARN_DB_GB`, `WARN_STORAGE_GB` | variável do repositório | limites do "Alerta de capacidade" (padrão 6 GB de banco e 800 GB de arquivos) |
| `PG_CLIENT_MAJOR` | variável do repositório | versão do cliente PostgreSQL (padrão `17`, a do Supabase) |
| `STAGING_HOST`, `STAGING_BACKUP` | variável do repositório | domínio do alias de staging (padrão: o de `STAGING_URL`); `true` = backup antes de migrar o staging (precisa dos `BACKUP_*` também no `staging`) |
| `VERCEL_TEAM`, `VERCEL_PROJECT`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | variável do repositório | o time e o projeto são achados sozinhos (`Canteiro A&M` / `canteiro`); fixe só se o resumo pedir |
| `CODEQL_ENABLED` | variável do repositório | `true` só depois de contratar a licença de Code Security do GitHub |
| `CSRF_SECRET` | secret do ambiente | o "Configurar Vercel" gera e grava um sozinho; só cole se quiser escolher o valor |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret do ambiente (e do repositório, para o monitor) | só se alguém proteger os domínios do Canteiro na Vercel (por padrão eles ficam abertos e o Canteiro exige login próprio) |
| `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL` | secret do ambiente | **nomes antigos**: se existirem, são usados como estão (compatibilidade). Não precisa criar |

## O que você NÃO cola (é montado pelos workflows)

| Montado | A partir de |
|---|---|
| `DATABASE_ADMIN_URL` (migrações, backup) | `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` + servidor do pooler descoberto (modo sessão, porta 5432, usuário `postgres.<ref>`) |
| `DATABASE_OPS_URL` (rotinas) | ref + `APP_OPS_DB_PASSWORD` (usuário `app_ops.<ref>`) |
| `DATABASE_URL` da API (só na Vercel) | ref + `APP_API_DB_PASSWORD` (modo transação, porta 6543, usuário `app_api.<ref>`) |
| `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | ref e ambiente |
| `BACKUP_TARGET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION` | `R2_ACCOUNT_ID` + bucket `canteiro-backup` + prefixo `producao`/`staging` |
| Variáveis da API na Vercel (`APP_ORIGIN`, chaves, `CSRF_SECRET`…) | gravadas pelo workflow **Configurar Vercel** (segredos como *Sensitive*); nunca as credenciais de ferramentas |

## Colei errado ou preciso trocar uma chave

- **Colou errado:** cole de novo por cima (o GitHub não mostra o valor antigo; **Update** substitui). Rode o workflow que falhou de novo. As mensagens de erro dizem **o nome** que falta ou está errado e **de onde copiar** — nunca mostram o valor.
- **Trocar (rotação, vazamento):** `docs/OPERACAO.md` §3 — sempre: gerar a nova → colar no GitHub → rodar o workflow indicado → conferir → só então revogar a antiga.
- **Conferir sem publicar nada:** os assistentes têm a opção **simular** (Actions → Configurar Supabase / Configurar Vercel → Run workflow → marque *simular*).
