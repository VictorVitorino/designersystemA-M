# Backup e restauração

> **Em uma frase:** todo dia, às 05:15 UTC, o banco e os arquivos são copiados — **cifrados** — para um bucket de **outra conta**, e o backup é **relido e conferido** na hora. Uma restauração sempre acontece em **banco novo** e termina com verificações automáticas.
> **Evidência real do ensaio** (executado de ponta a ponta nesta entrega): `docs/evidencias/restore-drill.md` (+ `.json`).

## 1. Política

| Item | Regra |
|---|---|
| **O que** | (1) banco: schemas `app` e `public.schema_migrations` (sem os dados de `app.rate_limits`, que são efêmeros e guardam IPs); (2) arquivos (imagens/anexos/miniaturas); (3) *opcional* os dados do Supabase Auth (`BACKUP_INCLUDE_AUTH=1`, §8) |
| **Quando** | banco e arquivos: **diário 05:15 UTC** (`backup.yml`); backup extra obrigatório **antes de cada deploy em produção** |
| **Como (banco)** | `pg_dump -Fc` (formato custom, já comprimido) de um **snapshot consistente** → criptografia **AES-256-GCM em blocos** → destino. Mantém donos e permissões (`app_owner`, GRANT, RLS): **sem** `--no-owner/--no-privileges` de propósito |
| **Como (arquivos)** | espelho **incremental**: os arquivos são imutáveis e endereçados por SHA-256, então só o que **falta** no destino é copiado (conferido contra o hash e **cifrado** antes de sair). **Nunca apaga nada no destino** automaticamente |
| **Onde** | bucket **de outra conta/provedor**, credenciais **próprias** (`BACKUP_S3_*`); `tools/backup.js` **recusa** destino no mesmo bucket/pasta/credencial do armazenamento principal |
| **Criptografia** | cada arquivo tem chave própria derivada (HKDF) da `BACKUP_ENCRYPTION_KEY` (32 bytes). Qualquer alteração, reordenação ou **truncamento** é detectado. O manifesto tem MAC. A chave **nunca** fica junto das credenciais do bucket |
| **Verificação** | ao terminar, o backup é **baixado e decifrado de novo**: SHA-256 do arquivo e do dump, autenticação de todos os blocos e índice do `pg_restore`. Falhou = o workflow falha e abre a issue "Falha no backup" |
| **Retenção** | **14 diários + 8 semanais + 12 mensais** (poda automática depois de um backup verificado; sempre mantém o mais recente e ao menos 3). Arquivos espelhados: **não são podados** (só crescem; apagar é decisão humana) |
| **Quem** | execução: GitHub Actions (ambiente `production-ops`). Guarda da chave: 2 pessoas + cofre. Responsável pelo ensaio trimestral: TI |
| **Alerta** | `uptime.yml` vigia a cada 4 h: último backup > 26 h → issue "Backup desatualizado" |

## 2. Metas e o que foi medido

| | **Meta (política)** | **Medido no ensaio desta entrega** | Como interpretar |
|---|---|---|---|
| **RPO** (quanto dado se perde) | **≤ 24 h** (banco e arquivos). Com o add-on PITR do Supabase: minutos (opcional, ~US$ 100/mês) | **8,2 s** entre o início do backup e o desastre simulado; **25 registros** gravados depois do backup foram perdidos *de propósito* e confirmados ausentes | no ensaio o desastre foi imediato. **Em produção o pior caso é ~24 h + duração do backup**: o que foi salvo depois das 05:15 do dia é perdido |
| **RTO** (tempo para voltar) | banco + serviço funcionando: **≤ 4 h** (inclui criar o projeto novo e trocar variáveis); arquivos: **ver tabela abaixo** | **2,5 s** do início da restauração até tudo verificado (banco em 0,60 s, arquivos em 1,12 s, re-hash de 448 objetos e verificações) | **com 9,5 MB de arquivos e 7,7 mil linhas.** É prova de que o **procedimento funciona de ponta a ponta**, **não** previsão de tempo em produção |

### Estimativa de tempo de restauração dos arquivos (cálculo, **não medido** em escala)

O tempo é dominado pela **rede** entre o bucket de backup e o armazenamento principal. Tempo = tamanho ÷ vazão:

| Tamanho do acervo | a 50 MB/s | a 100 MB/s | a 200 MB/s |
|---|---|---|---|
| 100 GB | ~34 min | ~17 min | ~9 min |
| 500 GB | ~2,8 h | ~1,4 h | ~43 min |
| 1 TB | ~5,8 h | ~2,9 h | ~1,5 h |

Banco de ~5 GB: espere de **minutos a ~1 h** (depende de índices; **estimativa**, não medida — o ensaio restaurou 430 KB). O Supabase tem durabilidade própria para os arquivos; o espelho existe para **perda de conta, exclusão acidental/maliciosa e corrupção**. **Pendência:** ensaiar em staging com volume próximo do real (500 GB) e registrar os tempos aqui.

## 3. Pré-requisitos para restaurar (tenha à mão)

- `BACKUP_ENCRYPTION_KEY` (cofre) e, se foi rotacionada, `BACKUP_ENCRYPTION_KEYS_OLD`.
- `BACKUP_TARGET` e `BACKUP_S3_*` (credencial de **leitura** basta).
- Um **banco novo e vazio** com a mesma versão do Postgres do backup **ou mais nova** (um dump de PG 17 não restaura em PG 16) e `DATABASE_ADMIN_URL` dele (papel `postgres`).
- Cliente `pg_restore` de versão ≥ a do servidor de destino.
- O código do repositório (`platform/`) e `npm ci`.

## 4. Restaurar o banco — passo a passo (cenário: banco perdido/corrompido)

1. **Declare o incidente** (`docs/OPERACAO.md` §6/§8) e avise a equipe; decida o horário de corte (quem editar depois dele perde o trabalho).
2. **Crie o destino:** um **projeto Supabase novo** (`canteiro-restore`, mesma região) — aplique `infra/supabase/auth-settings.md` — **ou** um Postgres vazio. **Não** restaure sobre o banco em uso: a ferramenta recusa.
3. Exporte as variáveis (do cofre): `BACKUP_TARGET`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_*`, e `DATABASE_ADMIN_URL` **do banco novo**.
4. Veja o que existe: `node tools/restore.js list` (mais recente por último; escolha o último **anterior** ao problema).
5. **Restaure:**
   ```bash
   cd platform
   node tools/restore.js db --name canteiro-production-AAAAMMDDTHHMMSSZ \
        --to 'postgres://postgres:<SENHA>@db.<ref-novo>.supabase.co:5432/postgres?sslmode=require' \
        --verify-objects                      # re-hash de TODOS os arquivos referenciados (usa S3_* do bucket principal)
   ```
   O que a ferramenta faz sozinha: baixa e **autentica** o backup (se algo não confere, para **antes** de tocar no banco) → cria os papéis → `pg_restore` em uma transação → `migrate --check` → compara contagens e amostras de linhas de **todas** as tabelas com o manifesto → verifica os arquivos. Saída final: `RESTAURAÇÃO OK`.
   - Banco **não vazio** → recusa. Para um banco de **ensaio**, `--drop-existing=<nome-do-banco>` (precisa digitar o nome exato).
6. **Arquivos** (só se o bucket principal também foi perdido ou está incompleto): `node tools/restore.js objects --to-primary --yes` (com `S3_*` do **novo** bucket). Repõe só o que falta, conferindo o SHA-256 de cada objeto. Para só o necessário: `--only-referenced --db '<banco restaurado>'`.
7. **Confira a configuração de segurança do banco restaurado:** `node tools/verify-deploy.js` (RLS, papéis, permissões, gatilhos, migrações) → **0 falhas**.
8. **Contas do login:** veja §8 (Auth). Sem os dados do Auth, as pessoas precisam de novo convite.
9. **Troque a produção (corte):**
   1. Vercel → variáveis de **Production**: `DATABASE_URL` (pooler do projeto novo), `SUPABASE_*`, `S3_*` do projeto novo; conferir `APP_ORIGIN`.
   2. Supabase novo: *Site URL* e *Redirect URLs* = domínio de produção.
   3. Redeploy (Actions → Deploy produção, ou *Redeploy* na Vercel).
   4. `curl https://canteiro.<seu-dominio>/api/ready` → tudo `true`; faça login; abra uma apresentação **com imagens**; crie e salve uma cópia.
10. **Depois:** novo backup completo imediato (`Backup → Run workflow`), atualizar `docs/AMBIENTES.md` (novo `ref`), relatório do incidente, e **mantenha o projeto antigo até ter certeza** (não apague no mesmo dia).

## 5. Restaurar um item (uma apresentação, um usuário…) sem trocar o banco

1. Restaure o backup desejado em um **banco temporário** (passo 5 acima, `--to` o temporário; sem `--verify-objects`).
2. Exporte as linhas necessárias do temporário e importe na produção com o papel de operação (exemplo: apresentação apagada de vez; ajuste o UUID):
   ```bash
   # no banco temporário (leitura)
   psql "$TEMP_URL" -c "\copy (select * from app.presentations where id = '<UUID>') to 'p.csv' csv"
   psql "$TEMP_URL" -c "\copy (select * from app.presentation_versions where presentation_id = '<UUID>') to 'v.csv' csv"
   psql "$TEMP_URL" -c "\copy (select * from app.asset_refs where presentation_id = '<UUID>') to 'r.csv' csv"
   # na produção (papel de sistema): a ordem importa (apresentação → versões → referências)
   psql "$DATABASE_OPS_URL" <<'SQL'
   begin; set local role app_system;
   \copy app.presentations from 'p.csv' csv
   \copy app.presentation_versions from 'v.csv' csv
   \copy app.asset_refs from 'r.csv' csv
   commit;
   SQL
   ```
   O dono (`owner_id`) e os arquivos (`app.assets`) referenciados precisam existir na produção; se o dono saiu da empresa, transfira depois. Apague os CSVs ao terminar (têm conteúdo de apresentações).
3. Os **arquivos** da apresentação continuam no bucket (imutáveis). Se faltarem: `restore.js objects --only-referenced`.
4. Apague o banco temporário.

## 6. Testar (obrigatório, **trimestral** e antes de produção)

**Ensaio automático completo (qualquer máquina com Postgres local):**
```bash
cd platform
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_ensaio node tools/restore-drill.js --s3
```
Ele recria um banco de teste, popula dados realistas (~30 usuários, 200 apresentações, ~450 arquivos), faz backup (pasta e S3 falso), **destrói** o banco e os arquivos, **restaura em banco novo** e verifica: contagens e amostras por tabela, `migrate --check`, re-hash de **todos** os arquivos, `verify-deploy`, isolamento entre usuários. Escreve `docs/evidencias/restore-drill.md`. Anexe o resultado ao registro trimestral.

**Ensaio em staging com o bucket real (a cada trimestre):**
1. Crie um projeto Supabase **descartável**; 2. execute o §4 com o backup **de produção** mais recente (leitura apenas) em um projeto **de ensaio**; 3. registre o **tempo** de cada fase na tabela abaixo; 4. apague o projeto de ensaio.

| Data | Responsável | Backup usado | Tamanho banco / arquivos | Tempo banco | Tempo arquivos | verify-deploy | Observações |
|---|---|---|---|---|---|---|---|
| (entrega) 2026-10-06 | restore-drill (automático) | `canteiro-drill-…` | 0,4 MB / 9,5 MB | 0,60 s | 1,12 s (448 objetos) | ok | ambiente local; sem rede |
| | | | | | | | |

## 7. Chaves: custódia e rotação

- A `BACKUP_ENCRYPTION_KEY` é o único jeito de abrir os backups. **Guarde em 2 lugares independentes** (cofre da empresa + pessoa de confiança/cofre físico). Perdeu a chave = backups inutilizáveis (o banco e os arquivos principais seguem funcionando).
- **Nunca** a coloque no mesmo lugar das credenciais do bucket de backup nem na Vercel.
- Rotação: veja `docs/OPERACAO.md` §3 — a chave antiga vai para `BACKUP_ENCRYPTION_KEYS_OLD` (para abrir backups antigos) e a nova passa a ser usada. Teste `node tools/backup.js verify` depois.
- Se a chave **vazar**: gere outra (backups novos ficam protegidos); os antigos continuam legíveis por quem tem a chave vazada **e** o acesso ao bucket — por isso o bucket tem credenciais próprias e privadas. Avalie rotacionar também as credenciais do bucket e refazer o backup completo.

## 8. Contas do login (Supabase Auth) — leia isto

O dump principal contém o **schema `app`** (usuários, apresentações, permissões…) — **não** contém as contas do Supabase Auth (`auth.users`: e-mail e **hash** de senha). Consequências e opções:

| Cenário | O que acontece | O que fazer |
|---|---|---|
| Só o banco `app` foi perdido (projeto Supabase intacto) | as contas do login continuam; ao restaurar `app`, `app.user_identities` volta a apontar para os mesmos `auth.users.id` | nada além do §4 |
| **Projeto Supabase inteiro perdido** | perdem-se as contas do Auth (as pessoas continuam existindo em `app.users`, mas sem credencial) | **melhor:** restaurar o **backup do próprio Supabase** (inclui o schema `auth`) em um novo projeto **ou** usar o backup de Auth abaixo |
| Backup de Auth ativado (`BACKUP_INCLUDE_AUTH=1`) | cada backup traz também `db/<nome>.authdata.enc` (dados de `auth.users`/`auth.identities`, cifrados) | no projeto novo (que já criou o schema `auth` vazio): `node tools/restore.js auth --to <banco-do-projeto-novo>` (recusa tabela não vazia; confere contagens). Em seguida o login funciona com as mesmas senhas |

Para ativar o backup de Auth: defina `BACKUP_INCLUDE_AUTH=1` no ambiente `production-ops` (e `production`). **Não validado contra um Supabase real** (sem acesso): teste no primeiro ensaio em staging — em particular se o papel `postgres` consegue ler/escrever `auth.users`. O arquivo contém hashes de senha: está **cifrado** como o resto.
Se nada disso existir: cada pessoa precisa de **novo convite** (pendência: ferramenta de reconvite em lote, **não implementada**).

## 9. Limitações conhecidas (e decisões)

- **Não** é PITR: entre dois backups, perde-se o que foi feito. Se 24 h for muito, ative o PITR do Supabase (e continue com este backup externo).
- O backup depende da **conexão direta** (porta 5432) para usar snapshot; atrás de pooler em modo transação cai em backup sem snapshot (aviso no log; contagens podem diferir se houver escrita no meio).
- O espelho de arquivos copia o que **existe** no principal: se um arquivo for apagado do principal, o espelho **mantém** a cópia (é o que permite recuperar). O espelho só cresce; para limpar, decisão humana (nunca automática).
- O primeiro espelho de ~1 TB pode levar mais de uma noite no runner do GitHub (limite de 6 h por job): o job é **incremental e retoma de onde parou** nas noites seguintes; para o primeiro envio, considere rodar de uma VM com rede melhor.
- O Supabase Storage não tem versionamento; objetos apagados somem para sempre — de novo, o espelho é a proteção.
- Segredos da Vercel/GitHub **não** estão no backup (estão no cofre). Sem o cofre, a restauração de variáveis é manual.
