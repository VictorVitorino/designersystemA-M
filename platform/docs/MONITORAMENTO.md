# Monitoramento e alertas

Objetivo: **saber antes dos usuários** que algo está errado, com o mínimo de ferramentas e custo. Tudo que é "automático" aqui roda no GitHub Actions ou em um monitor externo gratuito.

## 1. O que monitorar, limiares e quem é avisado

| # | O quê | Como medir | Alerta quando | Gravidade | Quem recebe | Onde está configurado |
|---|---|---|---|---|---|---|
| 1 | **Disponibilidade** do site e da API | `GET /api/health` (sem dependências) e `GET /api/ready` (banco, arquivos, login, migrações) | 2 falhas seguidas (≈ 6 min) em qualquer um | crítica | TI 1º nível + substituto | monitor externo (**a cada 3 min**) e `uptime.yml` (de hora em hora, segunda opinião) |
| 2 | **Taxa de erros 5xx** | logs da Vercel (filtro `status:5xx`) / Observability | > 2% das requisições por 5 min, ou ≥ 20 erros em 5 min | alta | TI + desenvolvedor | Vercel → Observability (alerta) ou Sentry |
| 3 | **Latência p95** da API | Vercel → Observability → Functions (duration) | p95 > **1,5 s** por 15 min (leitura/salvar); uploads podem ser mais lentos | média | desenvolvedor | Vercel / Sentry |
| 4 | **Conexões do banco** | Supabase → Reports → Database (connections) | > **80%** do limite do pooler/direto | alta | TI | Supabase (alerta de uso) / revisão semanal |
| 5 | **Tamanho do banco** | `node tools/maintenance.js stats` | > **70%** do disco contratado (aviso) / > 85% (crítico) | média/alta | TI | `maintenance.yml` (semanal, `WARN_DB_GB`): issue **"Alerta de capacidade"** |
| 6 | **Tamanho do bucket** (arquivos) | `stats` (soma de `app.assets`) e painel do Storage | > **80%** do orçamento (ex.: 800 GB de 1 TB) | média | TI + gestor | `maintenance.yml` (`WARN_STORAGE_GB`): issue **"Alerta de capacidade"** |
| 7 | **Falhas de login** e **429** | `app.audit_log` (`auth.login_failed`, `security.rate_limited`) | > 50 falhas de login em 10 min, ou > 10 IPs bloqueados na hora | alta (suspeita de ataque) | TI | consulta semanal (§3) / log drain opcional |
| 8 | **Backup fresco** | `node tools/maintenance.js backup-freshness` | último backup do banco **ou** espelho de arquivos > **26 h**, MAC inválido ou terminou com falhas | alta | TI | `uptime.yml` (a cada 4 h, ambiente `monitoring`, token só de leitura) + `backup.yml` |
| 9 | **Backup que falha** | status do workflow *Backup* | qualquer falha | alta | TI | `backup.yml` abre a issue "Falha no backup" |
| 9b | **Backup que não restaura** | *Ensaio de restauração* mensal (restaura o último backup num Postgres descartável e confere) | reprovado | alta | TI | `ensaio-restauracao.yml` abre a issue "Falha no ensaio de restauração" |
| 10 | **Certificado/domínio** | monitor externo (expiração do TLS) | < 14 dias para vencer | média | TI | UptimeRobot/Better Stack |
| 11 | **E-mail** (convites) | bounce/complaint no painel do provedor SMTP | taxa de rejeição > 5% | média | TI | provedor de e-mail |
| 12 | **Usuários admin** | `stats` | menos de 2 administradores ativos | média | TI | aviso no `stats` |
| 13 | **Custos/cotas** | painéis Vercel e Supabase | > 80% da cota do mês | média | TI + gestor | alertas de cobrança dos provedores |
| 14 | **Inchaço de `app.presentations`** (o autosave reescreve o deck inteiro) | `stats` → `bloat` (tuplas vivas × mortas, último autovacuum) | mortas > vivas e > 10 000 (aviso do `stats`), ou `last_autovacuum` > 1 dia com uso | média | TI | `maintenance.yml` (semanal, issue "Alerta de capacidade"); limiares de autovacuum já reduzidos na migração 0005 |

Gravidade → resposta: **crítica** (§1 do OPERACAO: 15 min), **alta** (mesmo dia útil), **média** (esta semana).

### Readiness sob carga (API)

A rota `GET /api/ready` executa verificações independentes de **banco, Storage, Auth e objetos das migrações**; cada uma tem prazo máximo de 3 segundos. Para poupar conexões do PostgreSQL/Supabase Free em picos de acessos ou retomadas após suspensão do Render, **sondas simultâneas compartilham uma única medição** (*single-flight*). O estado positivo **ou negativo** fica em cache por 5 segundos **contados da conclusão**. Se alguma dependência cair, a rota devolve HTTP 503 e apenas os quatro booleanos, não uma mensagem interna de erro. `GET /api/health` permanece independente e devolve 200 mesmo quando as dependências estão fora.

A API registra `ready_check_failed` com `check` (nome da dependência) e `kind` (`timeout` ou `dependency_error`). **Nunca registra a mensagem original da exceção**, pois a biblioteca de banco ou Storage pode incluí-la junto de strings de conexão ou credenciais. O limite de 3 segundos é o tempo de espera da rota, não o cancelamento garantido da operação iniciada no fornecedor.

## 2. Configurar o monitor externo (grátis)

Use o **Better Stack** (plano gratuito: 10 monitores, checagem a cada 3 min, alertas por e-mail, uso comercial permitido). O plano gratuito do **UptimeRobot** é restrito a uso pessoal/não comercial desde out/2024 — não serve para a A&M sem plano pago (custos e limites em `docs/pesquisa/monitoramento-backup-seguranca.md` §2).

**Better Stack — 5 monitores:**
1. `HTTPS` → `https://canteiro.<seu-dominio>/api/health` — procurar a palavra-chave `"ok":true` — intervalo 3 min.
2. `HTTPS` → `https://canteiro.<seu-dominio>/api/ready` — **código 200** — 3 min. (`503` = alguma dependência fora; o corpo diz qual: `db`, `storage`, `auth`, `migrations`.)
3. `HTTPS` → `https://canteiro.<seu-dominio>/` — código 200 (página inicial).
4. `HTTPS` → `https://staging.canteiro.<seu-dominio>/api/ready` — 200 (staging; alerta só por e-mail).
5. **Certificado SSL** (expiração) para o domínio de produção.
- **Contatos de alerta:** 2 e-mails (a TI e o substituto) + opcional canal Teams/Slack. Teste o alerta uma vez (pause o monitor de staging).
- **Página de status** (opcional): mostra "operacional" para a equipe.
- Regra de ouro: **monitor externo é a fonte primária**; o `uptime.yml` do GitHub é a segunda opinião, **de hora em hora** (em repositório privado cada execução gasta minutos do plano: de 5 em 5 min seriam ~8.600 min/mês), pode atrasar alguns minutos e **para** depois de 60 dias sem atividade no repositório — ligue os alertas por e-mail de Actions: GitHub → Settings → Notifications → Actions. Cada endereço só é sondado depois de ligado (`PRODUCTION_ENABLED=true`, `STAGING_ENABLED=true`); o frescor do backup (a cada 4 h) só roda com `BACKUP_ENABLED=true`. Antes disso, nada roda nem abre alerta.

## 3. Logs e consultas

### 3.1 Log de acesso da API (JSON, uma linha por requisição)
Cada linha: `{"t":"…","level":"info","msg":"http","env":"production","release":"…","method":"PUT","route":"/api/presentations/<id>/content","status":200,"ms":84,"requestId":"…","userId":"…","ip":"…"}` (erros 5xx saem com `"level":"error"`; a rota é o caminho real, sem query string). **Nunca** há corpo, token, senha, cookies nem query string.
No painel da Vercel (Logs) filtre por texto: `"status":5`, `"route":"/api/auth/login"`, ou pelo `requestId` que o usuário vê no erro (`X-Request-Id`). Em logs exportados (arquivo de linhas JSON):
```bash
# erros 5xx por rota
jq -r 'select(.msg=="http" and .status>=500) | .route' logs.jsonl | sort | uniq -c | sort -rn | head
# p95 de latência por rota (aproximado; ids de apresentação aparecem no caminho: agrupe com sed se quiser)
jq -r 'select(.msg=="http") | "\(.route) \(.ms)"' logs.jsonl | sort -k1,1 -k2,2n | awk '{a[$1]=a[$1]" "$2} END{for(r in a){n=split(a[r],v," ");print r, v[int(n*0.95)+1]}}'
# IPs com mais 401/429
jq -r 'select(.msg=="http" and (.status==401 or .status==429)) | .ip' logs.jsonl | sort | uniq -c | sort -rn | head
```
A retenção de logs é **curta** (Vercel Pro: 1 dia; Supabase Pro: 7 dias — `docs/pesquisa/monitoramento-backup-seguranca.md` §4). Para investigar depois, **exporte** ou use um *log drain* (custo extra; dependência externa).

### 3.2 Auditoria no banco (guardada 180 dias)
Rode como operação (leitura): `psql "$DATABASE_OPS_URL"` e cada consulta dentro de `begin; set local role app_system; …; commit;`.

```sql
-- falhas de login por hora (24 h)
select date_trunc('hour', at) as hora, count(*) from app.audit_log
 where action = 'auth.login_failed' and at > now() - interval '24 hours' group by 1 order by 1;

-- IPs que mais falharam na última hora (suspeita de força bruta)
select ip, count(*) from app.audit_log
 where action = 'auth.login_failed' and at > now() - interval '1 hour' group by 1 order by 2 desc limit 10;

-- eventos de segurança do dia (CSRF bloqueado, limite de taxa, conteúdo rejeitado)
select action, count(*) from app.audit_log
 where action like 'security.%' and at > now() - interval '1 day' group by 1 order by 2 desc;

-- o que um usuário fez nas últimas 48 h
select at, action, entity_type, entity_id, ip from app.audit_log
 where actor_id = '<UUID>' and at > now() - interval '48 hours' order by at;

-- quem apagou/restaurou/transferiu apresentações esta semana
select at, actor_id, action, entity_id from app.audit_log
 where action in ('presentation.delete','presentation.purge','presentation.restore','presentation.transfer') and at > now() - interval '7 days' order by at;

-- convites e mudanças de usuários
select at, actor_id, action, meta from app.audit_log where action like 'invite.%' or action = 'user.update' order by at desc limit 50;
```
A auditoria **nunca** grava senha, token nem conteúdo de slides; o e-mail de tentativas de login aparece só como HMAC.

### 3.3 Painéis prontos
- **Supabase → Reports:** conexões, CPU, memória, disco e latência do banco; **Logs Explorer** (Auth, Postgres, Storage); *Query Performance* (consultas lentas).
- **Vercel → Observability:** execuções, duração (p95), erros e *cold starts* da função `/api`; **Firewall** (requisições bloqueadas).
- **GitHub → Actions:** estado dos workflows (Backup, Uptime, Manutenção, CI).

## 4. Alertas automáticos do repositório (já configurados)

Cada alerta é uma **issue** do GitHub com título fixo: abre na primeira falha, recebe um comentário a cada nova falha (sem duplicar) e **fecha sozinha** quando o problema some. Quem "observa" o repositório recebe o e-mail (`docs/CONFIGURACAO.md` §3.4).

| Workflow | Frequência | Liga com | Falha → |
|---|---|---|---|
| `uptime.yml` → *disponibilidade* | de hora em hora | `PRODUCTION_ENABLED` / `STAGING_ENABLED` | issue **"Indisponibilidade"** |
| `uptime.yml` → *backup-fresco* | a cada 4 h | `BACKUP_ENABLED` | issue **"Backup desatualizado"** |
| `backup.yml` | diário 05:15 UTC (02:15 em Brasília) | `BACKUP_ENABLED` | issue **"Falha no backup"** |
| `maintenance.yml` | domingo 04:30 UTC | `PRODUCTION_ENABLED` | issue **"Alerta de capacidade"** (banco > `WARN_DB_GB`, arquivos > `WARN_STORAGE_GB` ou tuplas mortas demais), com os números no resumo; menos de 2 administradores aparece como aviso no resumo |
| `ensaio-restauracao.yml` | dia 3 de cada mês, 06:40 UTC | `BACKUP_ENABLED` | issue **"Falha no ensaio de restauração"** + relatório (artefato de 90 dias) |
| `codeql.yml` | semanal e em PRs | público ou `CODEQL_ENABLED` | alertas na aba Security; no privado sem a licença, só um aviso "CodeQL pulado" |

Chaves necessárias: só as de `docs/CHAVES.md` (o ambiente `monitoring` tem o token **somente leitura** do backup).

## 5. Erros de aplicação (Sentry) — **opcional, dependência externa**

- Instale pela integração da Vercel (Marketplace → Sentry) e preencha `SENTRY_DSN` no ambiente. Plano gratuito *Developer* basta enquanto só uma pessoa acompanha; *Team* (US$ 26/mês, valores em `docs/pesquisa/monitoramento-backup-seguranca.md` §3) quando houver mais gente.
- **Privacidade:** ative a limpeza de dados (*data scrubbing*) e **não** envie corpo de requisição, cabeçalhos de cookie ou conteúdo de apresentações. Confirme a região de armazenamento do Sentry com o jurídico (a pesquisa **não confirmou** a região).
- Sem Sentry o sistema funciona: o log estruturado + `X-Request-Id` bastam para depurar.

## 6. Revisão trimestral do monitoramento
Disparar um alerta de teste de ponta a ponta (pausar o monitor de staging; simular backup velho com `--max-hours 0.001`); conferir que os 2 e-mails recebem; revisar limiares com os números reais (`stats`); remover monitores que ninguém lê.
