# Configuração — contas, custos e regras

O que contratar, quanto custa e como deixar o GitHub pronto. O **passo a passo da publicação** está em `docs/PUBLICACAO.md`; **o que copiar e onde colar**, em `docs/CHAVES.md`. Detalhes técnicos ficam em `docs/OPERACAO.md`, `docs/BACKUP-E-RESTAURACAO.md` e `docs/MONITORAMENTO.md`.

```
GitHub Pro (código privado, CI, deploy, backup e alertas agendados)
   ├── Vercel Pro ............ site + API (/api), região São Paulo (gru1)
   ├── Supabase Pro .......... banco, login e arquivos — 2 projetos em São Paulo: canteiro-staging e canteiro-prod
   ├── Resend ................ e-mails de convite e senha (SMTP do Supabase), domínio canteiro.<dominio>
   ├── Cloudflare R2 ......... backup cifrado (bucket canteiro-backup), em OUTRA empresa
   └── Better Stack .......... monitor externo (avisa quando cair)
```

## 1. Contas

| Conta | Plano | Para quê | Quem cria / observação |
|---|---|---|---|
| **GitHub** (repositório `VictorVitorino/designersystemA-M`) | **Pro** | código **privado**, ambientes com segredos, CI, publicação, backup e alertas | dono do repositório; MFA ligado |
| **Vercel** — time **"Canteiro A&M"** | **Pro**, 1 assento | site e API | o time é criado no Pro; o projeto é criado pelo workflow "Configurar Vercel" |
| **Supabase** — organização da A&M | **Pro** | 2 projetos: `canteiro-staging` (Compute **Micro**) e `canteiro-prod` (Compute **Small**), região **South America (São Paulo)** | 2 pessoas como donas da organização; MFA |
| **Cloudflare** | R2 (pago pelo uso) | backup cifrado do banco e dos arquivos | cartão cadastrado para ativar o R2 |
| **Resend** | Free | envio dos e-mails de convite e "esqueci a senha" | o domínio é cadastrado pelo workflow "Configurar Supabase" |
| **Better Stack** | Free | monitor externo (`docs/MONITORAMENTO.md` §2) | 2 e-mails de alerta |
| Cofre de senhas da empresa | — | guardar as senhas geradas e a chave dos backups | obrigatório; a chave dos backups com **2 pessoas** |
| DNS do domínio da A&M | — | `canteiro.<dominio>`, `staging.canteiro.<dominio>` e os registros de e-mail | a TI cria os registros que os resumos dos workflows listam |

## 2. Custos (mensais, em dólar; preços públicos de out/2026 — confira no dia da contratação)

| Item | Início | Com 1 TB de arquivos | Observação |
|---|---:|---:|---|
| GitHub Pro | 4 | 4 | 3.000 min/mês de Actions (§8) |
| Vercel Pro (1 assento) | 20 | 20 | inclui US$ 20 de uso; tráfego e execuções acima disso são cobrados |
| Supabase Pro (organização) | 25 | 25 | inclui US$ 10 de computação, 8 GB de disco por projeto, 100 GB de arquivos e 250 GB de tráfego |
| Computação Supabase (Micro US$ 10 + Small US$ 15 − crédito US$ 10) | 15 | 15 | líquido |
| Arquivos acima de 100 GB no Supabase (US$ 0,021/GB) | 0 | ≈ 19 | cresce com o acervo |
| Cloudflare R2 (US$ 0,015/GB; 10 GB grátis; **sem** taxa de saída) | 0 | ≈ 15 | backup cifrado do banco + espelho dos arquivos |
| Resend Free (3.000 e-mails/mês, 100/dia) | 0 | 0 | plano pago só se convidar mais de 100 pessoas por dia |
| Better Stack Free (10 monitores, a cada 3 min) | 0 | 0 | |
| **Total aproximado** | **≈ 64** | **≈ 98** | |

Opcionais que **não** estão na conta: PITR do Supabase (~US$ 100/mês; só se perder até 24 h for inaceitável), licença de Code Security do GitHub (CodeQL em repositório privado, §3.5), Sentry, assentos extras na Vercel. O Supabase Pro vem com **Spend cap** ligado (bloqueia em vez de cobrar além da cota): decida em `infra/supabase/auth-settings.md` item 22.

## 3. GitHub: repositório privado, ambientes e versões

### 3.1 Plano e visibilidade
Settings → **Billing and plans** → **Pro**. Depois Settings → General → *Danger Zone* → **Change visibility → Private**. No Pro, repositório privado tem ambientes e segredos de ambiente, mas **não** tem "Required reviewers" (aprovação obrigatória por revisores): por isso **a aprovação da produção é a criação da versão** (§3.3).

### 3.2 Ambientes (Settings → Environments → New environment)

| Ambiente | *Deployment branches and tags* (Selected branches and tags) | Guarda | Usado por |
|---|---|---|---|
| `staging` | branch `main` | 10 valores do staging | Deploy staging; Configurar Supabase/Vercel e Primeiro administrador (staging) |
| `production` | **somente a tag `v*`** (Add deployment branch or tag rule → *Ref type: Tag* → `v*`) | **nada** — é o portão | Deploy produção (job "Portão") |
| `production-ops` | branch `main` **e** tag `v*` | os 13 valores de produção | Deploy produção (publicação), Backup, Manutenção, Ensaio de restauração, assistentes (produção) |
| `monitoring` | branch `main` | só o token de **leitura** do backup | Uptime (frescor do backup) |

Por que a produção tem dois ambientes: o `production` só aceita **versões** — um branch qualquer nem chega a ele —, e o `production-ops` concentra os segredos num lugar só, para que backup e manutenção (que rodam da `main`, de madrugada) usem os mesmos valores que a publicação. Assim nenhum segredo de produção é colado duas vezes. Detalhes: `docs/AMBIENTES.md`.

### 3.3 Versões = aprovação da produção
Settings → **Rules → Rulesets → New ruleset → New tag ruleset**: nome `versoes`, *Enforcement* **Active**, *Target tags* → **Include by pattern** `v*`, *Bypass list* → **Repository admin**, regras: **Restrict creations**, **Restrict updates**, **Restrict deletions**, **Block force pushes**. Resultado: só administradores do repositório criam (ou mudam) uma versão `v*`, e **só uma versão publica em produção** (o workflow recusa qualquer outra coisa, inclusive "Run workflow" fora de uma tag ou sem digitar `PRODUCAO`).

### 3.4 Branch `main` e Actions
- Settings → Rules → Rulesets → **New branch ruleset** `main`: *Target* = branch padrão; **Restrict deletions**, **Block force pushes**, **Require a pull request before merging** (0 aprovações basta com uma pessoa desenvolvendo) e **Require status checks to pass**: `Testes, migrações, build e varredura de segredos` e `Playwright (Chromium)`.
- Settings → Actions → General: *Actions permissions* → **Allow actions created by GitHub** (todas as ações usadas são do GitHub e estão fixadas por SHA); *Workflow permissions* → **Read repository contents**.
- Avisos por e-mail: Settings (da sua conta) → Notifications → *Actions* → "Only notify for failed workflows"; e no repositório **Watch → All Activity** para receber as *issues* de alerta.

### 3.5 CodeQL em repositório privado
A varredura de código (CodeQL) em repositório **privado** exige a licença paga do GitHub (Code Security). Sem ela, o workflow `CodeQL` **não falha**: um job curto avisa "CodeQL pulado". A cobertura de segurança continua no CI a cada push e PR: **`npm run test:security`** (testes ofensivos, CSRF, cabeçalhos, sessões, limites), **`secret-scan`** (segredos no repositório e no site gerado) e **`npm audit`** (dependências). Contratou a licença? Crie a variável `CODEQL_ENABLED = true`.

## 4. Supabase
Crie os 2 projetos (nome, região São Paulo, senha do cofre, compute) — **o resto o workflow "Configurar Supabase" faz e confere**: cadastro aberto desligado, senha ≥ 12 com maiúscula/minúscula/dígito, proteção contra senha vazada, sessões (30 dias / 7 dias sem uso), endereços (Site URL e Redirect URLs, inclusive `/api/auth/sso/callback` do login corporativo), SMTP do Resend, modelos de e-mail em português, link de 24 h, limites de taxa, bucket **privado** com limite de 100 MB, Data API sem o schema `app`, SSL obrigatório, conferência das chaves e da senha do banco. O que continua **manual** (uma vez): MFA e 2 donos da organização, decisão do *Spend cap*, PITR (opcional) e, quando houver, o SSO (`infra/supabase/sso-saml.md`). Lista completa e conferência item a item: `infra/supabase/auth-settings.md`.

O banco é criado e atualizado **só pelos workflows** (`tools/migrate.js` roda no Deploy, antes de publicar; nunca do computador de alguém). O acesso usa o *pooler* do Supabase em IPv4, descoberto sozinho — não precisa do add-on de IPv4.

## 5. Vercel
Crie o time **"Canteiro A&M"** no plano Pro e um token (`docs/CHAVES.md`). O workflow **"Configurar Vercel"** cria o projeto `canteiro` (pasta `platform`, Node 22, região `gru1`, sem deploy automático pelo Git — quem publica é o GitHub), o ambiente `staging`, as variáveis da API de cada ambiente (segredos como *Sensitive*; **nunca** as credenciais de ferramentas, como `DATABASE_ADMIN_URL`, `DATABASE_OPS_URL` ou `BACKUP_*` — e remove se alguém as tiver posto), o domínio e a proteção das URLs `*.vercel.app` (os domínios do Canteiro ficam abertos; o Canteiro exige login próprio). Detalhes e limites (4 MB por salvamento, 4,5 MB por requisição): `infra/vercel/README.md`.

## 6. DNS e e-mail
A TI cria os registros que os resumos listam (nada é inventado: os valores vêm da Vercel e do Resend):

| Registro | Onde | Para quê |
|---|---|---|
| `CNAME` de `canteiro` e `staging.canteiro` | resumo do "Configurar Vercel" | site (o certificado HTTPS é automático) |
| **SPF** (TXT) e `MX` do subdomínio de envio | resumo do "Configurar Supabase" (tabela do Resend) | autoriza o Resend a enviar por `canteiro.<dominio>` |
| **DKIM** (TXT `resend._domainkey.canteiro…`) | idem | assinatura que prova que o e-mail é legítimo |
| **DMARC** (TXT `_dmarc.canteiro…`) | idem (recomendado) | o que fazer com e-mail falsificado; comece com `p=none` e endureça para `p=quarantine` |

Pronto quando o Resend mostra o domínio **Verified** e o convite do checklist de aceite chega na **caixa de entrada** do Gmail e do Outlook.

## 7. Backup (Cloudflare R2)
Um bucket privado `canteiro-backup` com prefixos por ambiente (`producao/`, `staging/` se ligado) e **dois tokens**: escrita (ambiente `production-ops`) e só leitura (`monitoring`). Os dados saem **cifrados** do GitHub (AES-256-GCM com a `BACKUP_ENCRYPTION_KEY`, que o R2 nunca vê). Política, retenção, ensaio mensal e estimativas para 1 TB: `docs/BACKUP-E-RESTAURACAO.md`.

## 8. Minutos do GitHub Actions (3.000/mês no Pro)
Rotinas fixas, depois de tudo ligado: monitor de hora em hora (~720 min), frescor do backup a cada 4 h (~180), backup diário (~150–300), manutenção semanal (~20), ensaio mensal (~20) → **≈ 1.100–1.250 min/mês**. Cada push na `main` gasta ≈ 40 min (CI, E2E e deploy de staging). Acompanhe em Settings → Billing → *Usage*. Se faltar, o primeiro corte é o monitor do GitHub (o Better Stack é o monitor principal).

## 9. Primeiro administrador, convites e acervo
Não existe cadastro aberto: o **primeiro administrador** é convidado pelo workflow "Criar primeiro administrador" (`docs/PUBLICACAO.md` etapa 2, passo 7) e convida os demais pela tela de Admin. Para **importar o acervo** local, cada pessoa usa a página **Importar** (`docs/OPERACAO.md` §4). O **checklist de aceite** que vale antes de convidar pessoas reais está em `docs/PUBLICACAO.md`.

## 10. Alternativa autohospedada (Docker) — não executada
`platform/Dockerfile` e `platform/docker-compose.yml` sobem API + Caddy (HTTPS) + Postgres; imagens fixadas por *digest* e contexto de build enxuto (`.dockerignore`). A sintaxe foi validada; **build e execução não foram testados** aqui. O perfil `completo` (login com GoTrue próprio) **ainda não autentica** como está: a API chama `<SUPABASE_URL>/auth/v1` e exige `iss=<SUPABASE_URL>/auth/v1`, mas o GoTrue isolado responde na raiz e não emite `iss`; e a senha do papel do GoTrue em `infra/docker/init-gotrue.sql` não acompanha `GOTRUE_DB_PASSWORD`. Para usar: publicar o GoTrue atrás de um caminho `/auth/v1` (ex.: rota no Caddy) com `GOTRUE_JWT_ISSUER=<url>/auth/v1`, e alinhar a senha. Atualizações do sistema e das imagens passam a ser da TI.

## 11. Problemas comuns

| Mensagem no resumo | O que fazer |
|---|---|
| "Falta `NOME` — copie de … e cole em …" | cole o valor indicado (`docs/CHAVES.md`) e rode de novo |
| "senha do banco recusada" / "28P01" | a senha colada em `SUPABASE_DB_PASSWORD` não é a do projeto: copie do cofre ou redefina em Project Settings → Database → *Reset database password* |
| "não achei o servidor do banco (pooler)" | confira `SUPABASE_PROJECT_REF`; se o projeto não estiver em São Paulo, crie `SUPABASE_REGION` |
| Deploy de staging "pulado (desligado)" | crie `STAGING_ENABLED = true` |
| Deploy produção: "só publica VERSÕES" | publique por Releases (`v1.2.3`) ou rode escolhendo a tag e digitando `PRODUCAO` |
| Convite não chega | domínio do Resend não verificado (DNS); rode "Configurar Supabase" e veja a linha do e-mail; olhe o spam |
| "o banco ainda não tem o Canteiro instalado" (primeiro administrador) | publique o ambiente primeiro (o deploy cria as tabelas) |
| `DATABASE_ADMIN_URL/DATABASE_OPS_URL não devem existir no ambiente da API` | rode "Configurar Vercel": ele remove o que for proibido |
| `/api/ready` com `migrations:false` | rode o deploy do ambiente (ele migra) |
| `pg_dump ... server version mismatch` | crie `PG_CLIENT_MAJOR` com a versão do Postgres do Supabase |
