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
- Migrações são aplicadas só pelo CI (`tools/migrate.js`) com o papel dono (`postgres`) por **conexão direta**.

## Passo a passo (resumo; o detalhado está em `docs/CONFIGURACAO.md`)

1. Criar o projeto (nome `canteiro-staging` / `canteiro-prod`), região `sa-east-1`, **senha forte do banco** (cofre de senhas).
2. Aplicar `auth-settings.md` item a item (cadastro desligado, senha mínima 12, SMTP próprio, URLs, e-mails de convite…).
3. Colar os modelos de e-mail de `templates/` (convite, recuperação, confirmação).
4. Storage → criar o bucket **privado** `canteiro-arquivos` (staging: `canteiro-arquivos-staging`) e as **chaves S3** (Storage → S3 Connection).
5. Rodar as migrações **do seu computador** uma vez (`DATABASE_ADMIN_URL=… node tools/migrate.js`), depois só o CI.
6. Montar `DATABASE_URL` do pooler (modo transação) com o usuário `app_api.<ref>` e a senha `APP_API_DB_PASSWORD`.
7. Conferir tudo: `node tools/verify-deploy.js` (precisa passar sem falhas).

## Conexões (qual usar onde)

| Quem | Conexão | Porta | Observação |
|---|---|---|---|
| API (Vercel) | Pooler compartilhado (Supavisor), **modo transação**, usuário `app_api.<ref>` | 6543 | funciona em redes IPv4; o código não usa prepared statements |
| Migração, backup, restauração (CI) | Conexão **direta** `db.<ref>.supabase.co`, usuário `postgres` | 5432 | precisa de IPv6 **ou** do add-on IPv4 do Supabase; os runners do GitHub **não** têm IPv6 — veja abaixo |
| Jobs de manutenção (CI) | Pooler em **modo sessão**, usuário `app_ops.<ref>` | 5432 (host do pooler) | IPv4 |

> **Atenção (IPv6)**: a conexão direta do Supabase é IPv6 por padrão e os runners do GitHub Actions só têm IPv4. Para `DATABASE_ADMIN_URL` (migração/backup) escolha **uma** das opções: (a) contratar o add-on **IPv4 dedicado** (cerca de US$ 4/mês por projeto — valor da pesquisa em `docs/pesquisa/supabase.md`, confira no painel); (b) usar o **pooler em modo sessão** (`aws-0-sa-east-1.pooler.supabase.com:5432`, usuário `postgres.<ref>`), que é IPv4. Com o pooler em modo sessão `pg_dump --snapshot` e `pg_restore` funcionam, mas a verificação TLS completa fica a cargo da URL (`?sslmode=require`). Anote qual opção foi escolhida em `docs/AMBIENTES.md`. **Não validado neste ambiente** (sem acesso ao Supabase).

## Arquivos desta pasta

| Arquivo | Para quê |
|---|---|
| `auth-settings.md` | checklist do painel (Authentication, Database, Storage, API) |
| `templates/invite.html`, `recovery.html`, `confirm.html` | e-mails em português, prontos para colar |
| `sso-saml.md` | como ligar o SSO da A&M sem perder contas e dados |
| `config.toml` | opcional: as mesmas configurações para a Supabase CLI (`supabase config push`) — **não executado aqui** |

## Limites a conhecer

- O backup diário do Supabase **não inclui os arquivos do Storage** (só o banco). Por isso o Canteiro faz o espelho cifrado dos arquivos (`tools/backup.js objects`).
- O Storage do Supabase **não tem versionamento**, e apagar é definitivo: a única proteção é o nosso espelho e o fato de os arquivos serem imutáveis e só serem apagados pelo GC.
- Restaurar um backup do Supabase deixa o projeto **indisponível** durante a restauração. Por isso o nosso procedimento restaura em **banco novo** e só depois troca a conexão (`docs/BACKUP-E-RESTAURACAO.md`).
- Fontes e preços: `docs/pesquisa/supabase.md`. Confira sempre a página oficial no dia da contratação.
