# Configuração do zero — passo a passo

Para quem vai **instalar** o Canteiro online pela primeira vez (pessoa de TI, sem precisar ser especialista). Siga na ordem. Cada passo diz **o que fazer** e **como saber que deu certo**.
Tempo estimado: 1 dia de trabalho para staging + produção (sem contar a espera de DNS e a aprovação de contas).

> **O que NÃO foi possível testar ao escrever isto:** não havia acesso à Vercel, ao Supabase nem ao GitHub reais. Tudo que roda **sozinho** (migrações, backup, restauração, GC, verificações, testes) foi executado e tem evidência (`docs/evidencias/restore-drill.md`). Os passos de **painel** (telas do Supabase/Vercel/GitHub) são instruções escritas e **precisam ser conferidos no primeiro staging**; onde houver dúvida, o texto diz "validar em staging".

## 0. Mapa rápido

```
GitHub (código + CI + backup/manutenção agendados)
   ├── Vercel Pro ........ site estático + 1 função /api (Node 22, região gru1)
   ├── Supabase Pro ...... Postgres + Auth + Storage S3   (2 projetos: staging e produção)
   ├── Provedor de e-mail  SMTP próprio (convites e recuperação de senha)
   └── Bucket de backup .. OUTRA conta/provedor (ex.: Cloudflare R2 ou Backblaze B2)
```

## 1. Contas e pessoas necessárias

| Serviço | Para quê | Plano | Observação |
|---|---|---|---|
| GitHub (organização) | código, CI/CD, backup diário, monitoramento | Team recomendado (ambientes com revisores obrigatórios em repositório privado exigem plano pago) | 2 donos |
| Vercel | hospedagem do site e da API | **Pro** | 1 projeto, ambientes `Production` e `staging` (ambiente personalizado) |
| Supabase | banco, login, arquivos | **Pro** | **2 projetos**: `canteiro-staging` e `canteiro-prod`, região São Paulo |
| Provedor de e-mail (SMTP) | convites e senha esquecida | Resend, Amazon SES, Postmark… | domínio próprio com SPF/DKIM/DMARC |
| Provedor do bucket de backup | cópia cifrada do banco e dos arquivos | Cloudflare R2 ou Backblaze B2 (conta **diferente** do armazenamento principal) | veja `docs/pesquisa/monitoramento-backup-seguranca.md` |
| Cofre de senhas | guardar chaves e senhas | 1Password/Bitwarden… | **obrigatório** para a `BACKUP_ENCRYPTION_KEY` |
| Monitor externo | avisar quando cair | **Better Stack** (plano gratuito: 10 monitores, checagem a cada 3 min, uso comercial permitido) | o UptimeRobot gratuito é só para uso pessoal/não comercial desde out/2024; `docs/MONITORAMENTO.md` |
| DNS do domínio | `canteiro.<seu-dominio>` | — | quem administra o domínio da empresa |

Custos e comparação de alternativas: `docs/pesquisa/recomendacao-e-custos.md`.

## 2. Preparar o seu computador

1. Instale **Node 22**, **git** e o **cliente PostgreSQL** (`psql`, `pg_dump`, `pg_restore`) **da mesma versão do servidor** (Supabase novo = 17: `postgresql-client-17`).
2. `git clone <repositório>` e `cd platform && npm ci`.
3. Gere os segredos (copie cada resultado direto para o cofre de senhas, **não** para arquivos ou chats):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # rode 2x: APP_API_DB_PASSWORD e APP_OPS_DB_PASSWORD (um para cada ambiente = 4 senhas)
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"      # CSRF_SECRET (um para cada ambiente)
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # BACKUP_ENCRYPTION_KEY (uma só, vale para os backups de produção)
   ```
   Use `base64url` nas senhas do banco: elas vão dentro de URLs e não podem ter caracteres que precisem de tradução.
4. ✔ Confirmado quando: `node tools/secret-scan.js` (na pasta `platform`) imprime "nenhum segredo encontrado".

## 3. GitHub: ambientes, revisores e proteção da `main`

1. Settings → **Branches** → regra para `main`: exigir Pull Request, exigir os checks `CI` e `E2E`, bloquear *force push* e exclusão.
2. Settings → **Environments** → criar `staging`, `production`, `production-ops`, `monitoring` (tabela em `docs/AMBIENTES.md`):
   - `production`: **Required reviewers** = 2 pessoas; *Deployment branches and tags* = `main` e `v*`.
   - `production-ops` e `monitoring`: sem revisores; *Deployment branches* = somente `main`.
3. Cadastre os **secrets** e **variables** conforme a tabela do passo 15 (os modelos `infra/env/ci-*.secrets.example` mostram o formato). Faça isto **aos poucos**, no passo em que cada valor nasce.
4. Settings → Actions → General: *Workflow permissions* = **Read repository contents**; *Allow actions* = somente ações do GitHub e as já fixadas por SHA nos workflows.
5. ✔ Confirmado quando: um Pull Request qualquer mostra o CI rodando (ele só usa um Postgres efêmero; não precisa de nenhum segredo).

## 4. Supabase — criar e configurar os 2 projetos

Faça primeiro **staging**; só depois repita para produção.

1. supabase.com → New project: nome `canteiro-staging`, região **South America (São Paulo)**, senha forte do banco (cofre). Anote o **`ref`** (aparece na URL do painel).
2. Aplique **cada item** de `infra/supabase/auth-settings.md` (cadastro desligado, senha ≥ 12, SMTP próprio, URLs, chaves JWT assimétricas…) e cole os modelos de e-mail de `infra/supabase/templates/`.
3. Storage → crie o bucket **privado** `canteiro-arquivos-staging` e uma **chave S3** (anote `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
4. Anote as chaves da API: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e a URL das chaves públicas `SUPABASE_JWKS_URL` (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`). Projetos criados a partir de nov/2025 **não têm** as chaves legadas `anon`/`service_role`: use a **publishable key** (`sb_publishable_…`) como `SUPABASE_ANON_KEY` e uma **secret key** (`sb_secret_…`) como `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys). A API aceita os dois formatos.
5. Escolha a conexão administrativa (leia o aviso de IPv6 em `infra/supabase/README.md`) e monte `DATABASE_ADMIN_URL`:
   `postgres://postgres:<SENHA>@db.<ref>.supabase.co:5432/postgres?sslmode=require` (conexão direta) **ou** a do pooler em modo sessão.
6. ✔ Confirmado quando: o teste de "cadastro bloqueado" do item 1 de `auth-settings.md` responde "Signups not allowed".

## 5. Criar o esquema do banco (papéis, tabelas, RLS)

Faça **uma vez do seu computador** (depois, só o CI faz isso).

```bash
cd platform
read -rs APP_API_DB_PASSWORD;  export APP_API_DB_PASSWORD     # cole a senha e Enter (não aparece nem fica no histórico)
read -rs APP_OPS_DB_PASSWORD;  export APP_OPS_DB_PASSWORD
export DATABASE_ADMIN_URL='postgres://postgres:<SENHA>@db.<ref>.supabase.co:5432/postgres?sslmode=require'
node tools/migrate.js            # cria papéis app_owner/app_user/app_system/app_api/app_ops, schema app, RLS e políticas
node tools/migrate.js --check    # precisa terminar sem "pendentes"
node tools/verify-deploy.js      # confere RLS, permissões, papéis, Data API, TLS
```

✔ Confirmado quando `verify-deploy` termina com **0 falhas**. Avisos como "API S3 deste provedor não permite consultar políticas" são normais no Supabase.
Monte a `DATABASE_URL` da API: usuário `app_api.<ref>`, senha `APP_API_DB_PASSWORD`, host do **pooler** (Project Settings → Database → Connection pooling), **porta 6543** (modo transação):
`postgres://app_api.<ref>:<APP_API_DB_PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` (copie o host exato do painel).

## 6. Vercel — projeto e variáveis

Siga `infra/vercel/README.md` (Root Directory `platform`, incluir arquivos fora da raiz no build, ambiente `staging`, região `gru1`, proteção de previews, domínio). Resumo:

1. Add New Project → importar o repositório → *Root Directory* = `platform`; marcar *Include source files outside of the Root Directory in the Build Step* (o build usa `studio/`).
2. Cadastrar as variáveis do **ambiente certo** com os modelos `infra/env/api.staging.env.example` / `api.production.env.example`. Marque como **Sensitive** tudo que for segredo.
3. **Nunca** cadastre `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL`, `BACKUP_*` ou `GOTRUE_FAKE` na Vercel (a API recusa iniciar se achar as duas primeiras).
4. Settings → Git → desligue os deploys automáticos (quem publica é o GitHub Actions): *Ignored Build Step* = `exit 0`.
5. Crie um token (Account Settings → Tokens, escopo só do time) → secret `VERCEL_TOKEN`. Anote `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` (Project Settings → General) → *variables* do repositório.
6. ✔ Confirmado quando o primeiro push na `main` publica em staging e o passo "Smoke test (/api/ready)" fica verde.

## 7. Domínio, DNS e e-mail

1. **Domínio do site:** na Vercel → Domains → adicione `canteiro.<seu-dominio>` (produção) e `staging.canteiro.<seu-dominio>` (atribuído ao ambiente `staging`). Crie no DNS o `CNAME` que a Vercel indicar. O HTTPS (certificado) é automático.
2. **Atualize** a *Site URL* e as *Redirect URLs* do Supabase para o domínio final (`auth-settings.md` itens 12–13) e `APP_ORIGIN` na Vercel (devem ser **idênticos**).
3. **E-mail (convites chegam?)** — no DNS do domínio remetente, crie os 3 registros do provedor de e-mail:

   | Registro | Tipo | Exemplo | Para quê |
   |---|---|---|---|
   | SPF | TXT em `<seu-dominio>` | `v=spf1 include:<provedor> -all` | quem pode enviar em nome do domínio |
   | DKIM | TXT/CNAME fornecido pelo provedor | (copiar do painel do provedor) | assinatura que prova que a mensagem não foi alterada |
   | DMARC | TXT em `_dmarc.<seu-dominio>` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@<seu-dominio>` | o que fazer com mensagens que falham SPF/DKIM |

   ✔ Teste: envie um convite para um Gmail e para o Outlook **e veja se chega na caixa de entrada** (não em spam). Ferramenta gratuita para conferir os registros: mail-tester.com.
4. Quando tudo estiver estável, endureça o DMARC para `p=reject`.

## 8. Backup externo (antes de colocar dados reais!)

1. Na **outra conta/provedor** crie dois buckets/prefixos privados (um para staging, outro para produção) e **duas chaves**: uma de **escrita** (backup) e uma **somente leitura** (monitoramento). Ative a retenção/bloqueio de objeto do provedor se existir (proteção extra contra apagar).
2. Guarde a `BACKUP_ENCRYPTION_KEY` **em dois lugares**: cofre de senhas e uma segunda pessoa de confiança. **Sem ela os backups não abrem.** Ela é diferente de qualquer credencial de bucket (o `tools/backup.js` recusa configurações em que sejam iguais).
3. Cadastre `BACKUP_*` nos ambientes `production`, `production-ops` (escrita) e `monitoring` (leitura, **sem** a chave de criptografia).
4. Teste do seu computador:
   ```bash
   cd platform
   export DATABASE_ADMIN_URL=… BACKUP_TARGET='s3://<bucket-de-backup>/producao' BACKUP_ENCRYPTION_KEY=… BACKUP_S3_ENDPOINT=… BACKUP_S3_ACCESS_KEY_ID=… BACKUP_S3_SECRET_ACCESS_KEY=…
   export STORAGE_DRIVER=s3 S3_ENDPOINT=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…
   node tools/backup.js check       # valida configuração e SEPARAÇÃO do bucket principal
   node tools/backup.js all         # banco + arquivos
   node tools/backup.js list
   ```
5. **Ensaio de restauração (obrigatório antes de usar de verdade)** — `docs/BACKUP-E-RESTAURACAO.md` §Restaurar: restaure em um projeto/banco **novo** e rode `verify-deploy`.
6. ✔ Confirmado quando `backup.yml` (Actions → Backup → Run workflow) termina verde e `uptime.yml` → "O último backup tem menos de 26 horas?" fica verde.

## 9. Criar o primeiro administrador

Não existe cadastro aberto: alguém precisa convidar o primeiro. Do seu computador (credenciais de operação **só aqui**):

```bash
cd platform
export DATABASE_OPS_URL='postgres://app_ops.<ref>:<APP_OPS_DB_PASSWORD>@<host-do-pooler-modo-sessao>:5432/postgres?sslmode=require'
export SUPABASE_URL='https://<ref>.supabase.co'  SUPABASE_SERVICE_ROLE_KEY='<chave-de-servico>'
node tools/create-first-admin.js --email fulano@<seu-dominio> --name "Fulano de Tal"
```
A pessoa recebe o e-mail, clica no link, **cria a senha (mín. 12)** e vira administradora. ✔ Confirmado quando ela consegue entrar e abrir **Admin → Usuários**. Crie um **segundo administrador** (continuidade) pelo próprio painel.

## 10. Convidar a equipe

Admin → Usuários → **Convidar** (e-mail + nome + papel `membro` ou `administrador`). Se `INVITE_ALLOWED_DOMAINS` estiver preenchido, só e-mails desses domínios são aceitos. O link vale 24 horas (configuração do Supabase); se expirar, use **Reenviar** (até 5 vezes). Convide em pequenos grupos (o SMTP novo precisa "esquentar" a reputação).

## 11. Importar o acervo local existente

1. Cada pessoa abre `https://canteiro.<seu-dominio>/importar` e seleciona os arquivos `.html` do Canteiro que já tem (ou arrasta a pasta: os `.json`/`.html` dentro dela são lidos). O navegador separa as imagens (que vão para o armazenamento, **sem duplicar**: o mesmo arquivo vira um só objeto) e cria as apresentações **no nome de quem importou**; tudo fica visível no acervo para os demais (somente leitura; para editar, **Criar cópia**).
2. Importação em lote feita pela TI (acervo de uma pasta compartilhada): peça a lista dos arquivos aos donos e faça a importação **pela conta de cada dono** (ou de uma conta administrativa e depois **transfira** a propriedade: no acervo, menu “Mais ações” do cartão → “Transferir propriedade…” (só administradores; chama `POST /api/presentations/:id/transfer`)).
3. Acompanhe: `node tools/maintenance.js stats` (número de apresentações e bytes) e a auditoria (`import.acervo`).
4. ✔ Confirmado quando o número de apresentações bate com o esperado e um arquivo importado abre no editor sem imagens quebradas.

## 12. Monitoramento mínimo

1. Crie 2 monitores no **Better Stack** (plano gratuito): `https://canteiro.<seu-dominio>/api/health` e `/api/ready` (alerta por e-mail de 2 pessoas). `docs/MONITORAMENTO.md` detalha limiares e consultas de log. O `uptime.yml` do GitHub é só a segunda opinião (de hora em hora, para não gastar os minutos do plano em repositório privado).
2. Cadastre as variáveis `PRODUCTION_URL` e `STAGING_URL` no GitHub para `uptime.yml`.
3. Opcional: Sentry pela integração da Vercel (**dependência externa**; preencha `SENTRY_DSN`).

## 13. Checklist de aceite (marque tudo antes de convidar usuários reais)

- [ ] `node tools/verify-deploy.js --url https://canteiro.<seu-dominio> --expect-env production` sem **nenhuma** falha
- [ ] Cadastro público bloqueado (`/auth/v1/signup` recusa) e e-mail de convite chega na caixa de entrada (Gmail e Outlook)
- [ ] Login, criar apresentação, salvar, fechar, abrir em **outro computador** e continuar
- [ ] Duas contas diferentes: A cria uma apresentação; B **vê** (somente leitura), **não consegue editar**, consegue **Criar cópia** e editar a cópia
- [ ] Uma conta suspensa perde o acesso imediatamente
- [ ] Imagem enviada duas vezes por pessoas diferentes ocupa **um só** objeto no bucket
- [ ] `backup.yml` rodou verde; `backup-freshness` verde; **restauração testada em banco novo** com `verify-deploy` verde
- [ ] `uptime.yml` verde; alerta de teste chegou aos 2 e-mails
- [ ] ≥ 2 administradores; `BACKUP_ENCRYPTION_KEY` guardada por 2 pessoas
- [ ] `docs/OPERACAO.md` com os contatos preenchidos
- [ ] Repositório sem segredos (`secret-scan` verde) e `main` protegida

## 14. Alternativa autohospedada (sem Vercel/Supabase) — **não executada neste ambiente**

`platform/Dockerfile` + `platform/docker-compose.yml` sobem API + Caddy (HTTPS automático) + Postgres, e o perfil `completo` acrescenta GoTrue (login) e MinIO (arquivos S3). A sintaxe do compose foi validada com `docker compose config`; **build e execução não foram testados** (sem Docker daemon aqui).

1. VM Linux com Docker, portas 80/443 abertas, DNS apontando para ela.
2. `cp infra/env/compose.env.example .env` e preencha (o compose recusa variáveis vazias).
3. `bash infra/docker/gen-certs.sh` (certificado TLS do Postgres).
4. `docker compose build` → `docker compose run --rm migrate` → `docker compose up -d`.
5. Backups: `tools/backup.js` funciona igual (rode com `docker compose run`/cron no host). Atualizações e correções de segurança do sistema operacional e das imagens passam a ser **responsabilidade da TI**.

## 15. Secrets e variables (tabela completa)

**Secrets** (valores sigilosos) por **ambiente do GitHub** — "obrig." = o workflow falha sem ele:

| Secret | `staging` | `production` | `production-ops` | `monitoring` | Para quê | Onde nasce |
|---|:-:|:-:|:-:|:-:|---|---|
| `VERCEL_TOKEN` | obrig. | obrig. | — | — | publicar com a CLI da Vercel | Vercel → Account Settings → Tokens |
| `DATABASE_ADMIN_URL` | obrig. | obrig. | obrig. | — | migrar, verificar, backup (papel `postgres`, conexão direta) | Supabase → Database |
| `DATABASE_OPS_URL` | — | obrig. (GC) | obrig. | — | manutenção e GC (papel `app_ops`) | montada com `APP_OPS_DB_PASSWORD` |
| `APP_API_DB_PASSWORD` | obrig. | obrig. | — | — | senha do papel `app_api` (o migrate a define) | gerada por você (passo 2) |
| `APP_OPS_DB_PASSWORD` | obrig. | obrig. | — | — | senha do papel `app_ops` | gerada por você |
| `SUPABASE_URL` | obrig. | obrig. | — | — | testes do verify-deploy (Data API) | Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | obrig. | obrig. | — | — | idem (sonda anônima) | idem |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` | obrig. | obrig. | obrig. | — | arquivos principais (verificação, espelho, GC) | Supabase → Storage |
| `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | obrig. | obrig. | obrig. | — | chave S3 do bucket principal | Supabase → Storage → S3 Connection |
| `BACKUP_TARGET` | opc. | obrig. | obrig. | obrig. | `s3://bucket/prefixo` do backup | passo 8 |
| `BACKUP_ENCRYPTION_KEY` | opc. | obrig. | obrig. | **não** | chave de criptografia dos backups | gerada por você; **cofre** |
| `BACKUP_S3_ENDPOINT` `BACKUP_S3_REGION` | opc. | obrig. | obrig. | obrig. | provedor do bucket de backup | provedor do backup |
| `BACKUP_S3_ACCESS_KEY_ID` `BACKUP_S3_SECRET_ACCESS_KEY` | opc. | obrig. (escrita) | obrig. (escrita) | obrig. (**só leitura**) | credenciais do bucket de backup | provedor do backup |

`GITHUB_TOKEN` é automático (permissões mínimas declaradas em cada workflow). "opc." em `staging` só vale se `STAGING_BACKUP=true`.

**Variables** (não sigilosas) — cadastre como **variáveis do repositório** (Settings → Secrets and variables → Actions → *Variables*):

| Variable | Exemplo | Usada por |
|---|---|---|
| `PRODUCTION_URL` | `https://canteiro.<seu-dominio>` | deploy-production, uptime |
| `STAGING_URL` | `https://staging.canteiro.<seu-dominio>` | deploy-staging, uptime |
| `STAGING_HOST` | `staging.canteiro.<seu-dominio>` | deploy-staging (alias na Vercel) |
| `STAGING_BACKUP` | `false` | deploy-staging (backup antes de migrar) |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | (Project Settings → General) | deploy-staging, deploy-production |
| `PG_CLIENT_MAJOR` | `17` (versão do Postgres do Supabase) | deploy-*, backup |
| `WARN_DB_GB`, `WARN_STORAGE_GB` | `6`, `800` | maintenance (alerta de tamanho) |
| `BACKUP_ENABLED` | `true` | backup.yml (agendamento diário) e uptime.yml (frescor do backup): enquanto não for `true`, os agendamentos não rodam (evita falha diária e issue "Backup desatualizado" antes de o backup existir). Ligue **depois** de cadastrar os segredos `BACKUP_*` e ver o primeiro backup manual verde |
| `BACKUP_INCLUDE_AUTH` | `1` | backup e deploy-production: inclui o esquema `auth` do Supabase (contas e identidades) no dump cifrado — recomendado `1` em produção |

**Variáveis da Vercel (API)** — modelos completos em `infra/env/api.*.env.example`; contrato em `docs/API.md` §9. Opcional: `RATE_IP_MULTIPLIER` (padrão 25) — quantas vezes o limite por usuário cabe no mesmo IP antes do 429; aumente se mais de ~200 pessoas usarem a plataforma atrás de um único NAT.

## 16. Problemas comuns

| Mensagem | Causa | Solução |
|---|---|---|
| `Configuração insegura/incompleta: … é obrigatório em production` | falta variável na Vercel | cadastre a variável citada no ambiente certo e faça novo deploy |
| `DATABASE_ADMIN_URL/DATABASE_OPS_URL não devem existir no ambiente da API` | alguém as cadastrou na Vercel | remova-as da Vercel (ficam só no GitHub) |
| `/api/ready` com `migrations:false` | migrações pendentes | rode o deploy (ele migra) ou `node tools/migrate.js` |
| `/api/ready` com `auth:false` | `SUPABASE_URL`/chaves erradas ou JWKS inacessível | confira as chaves do ambiente |
| Convite não chega | SMTP não configurado, SPF/DKIM/DMARC faltando, limite de e-mails por hora | `auth-settings.md` itens 10–11; olhe a pasta de spam |
| `pg_dump ... server version mismatch` | cliente mais velho que o servidor | instale `postgresql-client-<versão do servidor>` e defina `PG_BIN_DIR` / `PG_CLIENT_MAJOR` |
| `ENETUNREACH` / timeout na conexão direta | IPv6 sem suporte (runner do GitHub) | use o pooler em modo sessão ou o add-on IPv4 (`infra/supabase/README.md`) |
| `BACKUP_TARGET usa o MESMO bucket…` | backup e arquivos no mesmo lugar | crie o bucket de backup em **outra conta/provedor** |
