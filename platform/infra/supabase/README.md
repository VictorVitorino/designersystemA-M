# Supabase — como o Canteiro usa (e o que configurar)

O Canteiro usa **três coisas** do Supabase. Nada mais: o navegador **nunca** fala com o Supabase; só a API fala.

| Parte | Para quê | Onde a API usa |
|---|---|---|
| **Postgres** | todos os dados (usuários, apresentações, versões, comentários, auditoria) | `DATABASE_URL` (papel `app_api`, pooler porta 6543) |
| **Auth** (GoTrue) | convite, senha, sessão | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL` |
| **Storage** (S3) | imagens e anexos (bucket **privado**) | `S3_*` |

Não usamos PostgREST/Data API, Realtime, Edge Functions nem o cliente JavaScript do Supabase.

## Dois projetos, nunca um só

Crie **um projeto para staging e outro para produção** (organizações iguais, projetos separados). Staging nunca recebe dados de produção.
Região: **South America (São Paulo) `sa-east-1`** (a mesma da Vercel `gru1`, menor latência para o Brasil e dados no país).

## Como o banco fica protegido (resumo)

- Todas as tabelas ficam no schema **`app`**, que **não** está exposto à Data API. Mesmo assim a RLS é ligada em todas as tabelas (defesa em profundidade).
- `anon` e `authenticated` (papéis do Supabase) não têm **nenhuma** permissão no schema `app`. `tools/verify-deploy.js` confere isso a cada publicação.
- A API entra como **`app_api`** (sem privilégio em tabelas) e, **por transação**, assume `app_user` com o id do usuário; quem decide o que cada um vê é o **banco** (RLS).
- Jobs/ferramentas entram como **`app_ops`** (assume `app_system`); a credencial dele **não existe** na Vercel.
- Migrações são aplicadas só pelo CI (`tools/migrate.js`, no Deploy de cada ambiente) com o papel dono (`postgres`) pelo **pooler em modo sessão** (IPv4). O controle de migrações (`public.schema_migrations`) fica com RLS ligada e sem acesso para `anon`/`authenticated`/`service_role` nem para os papéis da aplicação (o Supabase daria acesso por padrão a toda tabela nova do schema `public`).

## Passo a passo (o detalhado está em `docs/PUBLICACAO.md`)

1. Criar o projeto (nome `canteiro-staging` / `canteiro-prod`), região `sa-east-1`, **senha forte do banco** (cofre de senhas), compute Micro (staging) / Small (produção).
2. Colar as chaves do projeto no GitHub (`docs/CHAVES.md`: Project ID, senha do banco, publishable e secret key, chave S3 do Storage).
3. **Actions → Configurar Supabase** (`tools/supabase-setup.js`, a partir de `config.toml` e `templates/`): aplica pela Management API e **relê** para conferir — cadastro desligado, senha mínima 12, SMTP do Resend, Site URL e Redirect URLs (`/auth/confirmar` e `/api/auth/sso/callback`), modelos de e-mail, sessões, limites de taxa, bucket **privado** com 100 MB, protocolo S3, Data API sem `app`, SSL obrigatório — e confere as chaves coladas, as chaves JWT assimétricas (JWKS), a senha do banco e o domínio de e-mail no Resend. Precisa do token temporário `SUPABASE_ACCESS_TOKEN` (apague depois). **Não executado contra o Supabase real** ao ser escrito: a primeira execução (staging) é o teste.
4. As migrações rodam no **Deploy** do ambiente (nunca do computador de alguém); o `verify-deploy.js` confere RLS, papéis, permissões e o controle de migrações a cada publicação.
5. O que continua manual (uma vez): MFA e 2 donos da organização, *Spend cap*, PITR (opcional) — `auth-settings.md` itens 16, 21 e 22.

## Conexões (qual usar onde)

Todas as conexões usam o **pooler compartilhado (Supavisor)** do Supabase, que é IPv4 (os runners do GitHub não têm IPv6). O servidor do pooler (`aws-N-sa-east-1.pooler.supabase.com`) é **descoberto sozinho** pelo `tools/chaves.js` (tenta os servidores da região e para na primeira resposta de senha errada, que prova que o projeto está ali); fixe com a variável `SUPABASE_POOLER_HOST` só se o resumo pedir.

| Quem | Modo do pooler | Porta | Usuário |
|---|---|---|---|
| API (Vercel) — `DATABASE_URL` gravada pelo *Configurar Vercel* | **transação** | 6543 | `app_api.<ref>` (o código não usa *prepared statements*) |
| Migração, verificação, backup, ensaio (CI) — `DATABASE_ADMIN_URL` montada | **sessão** | 5432 | `postgres.<ref>` (`pg_dump --snapshot` funciona em modo sessão) |
| Manutenção, GC, primeiro administrador (CI) — `DATABASE_OPS_URL` montada | **sessão** | 5432 | `app_ops.<ref>` |

A conexão **direta** (`db.<ref>.supabase.co`) é IPv6 e não é usada (dispensa o add-on de IPv4). Configurações antigas que já tenham `DATABASE_ADMIN_URL`/`DATABASE_OPS_URL` prontas continuam valendo (têm prioridade).

## Arquivos desta pasta

| Arquivo | Para quê |
|---|---|
| `auth-settings.md` | checklist do painel (Authentication, Database, Storage, API) |
| `templates/invite.html`, `recovery.html`, `confirm.html` | e-mails em português, prontos para colar |
| `sso-saml.md` | como ligar o SSO da A&M sem perder contas e dados |
| `config.toml` | a FONTE que o workflow *Configurar Supabase* aplica (e que também serve à Supabase CLI) — **não executado contra o Supabase real** |

## Limites a conhecer

- O backup diário do Supabase **não inclui os arquivos do Storage** (só o banco). Por isso o Canteiro faz o espelho cifrado dos arquivos (`tools/backup.js objects`).
- O Storage do Supabase **não tem versionamento**, e apagar é definitivo: a única proteção é o nosso espelho e o fato de os arquivos serem imutáveis e só serem apagados pelo GC.
- Restaurar um backup do Supabase deixa o projeto **indisponível** durante a restauração. Por isso o nosso procedimento restaura em **banco novo** e só depois troca a conexão (`docs/BACKUP-E-RESTAURACAO.md`).
- Fontes e preços: `docs/pesquisa/supabase.md`. Confira sempre a página oficial no dia da contratação.
