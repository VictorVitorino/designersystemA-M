# Operação — runbook da TI

Para quem **opera** o Canteiro no dia a dia. Todos os comandos rodam na pasta `platform/` de um computador com Node 22 e as variáveis necessárias (os mesmos nomes de `docs/CONFIGURACAO.md`; segredos ficam no cofre de senhas, **nunca** em mensagem/e-mail/chat).
Convenção: o que o GitHub Actions já faz sozinho aparece como **(automático)**.

## 1. Contatos e escalonamento (PREENCHER antes de entrar no ar)

| Papel | Nome | E-mail | Telefone | Quando acionar |
|---|---|---|---|---|
| Responsável de TI (1º nível) | | | | qualquer alerta |
| Substituto do responsável | | | | ausência do 1º nível por > 1 h útil |
| Desenvolvedor da plataforma | | | | erro de aplicação, deploy com problema |
| Encarregado de dados (LGPD) | | | | **suspeita de vazamento** (prazo legal de comunicação) |
| Gestor da área / dono do produto | | | | indisponibilidade > 1 h ou vazamento |
| Suporte Supabase (plano Pro) | | support.supabase.com | | banco/login/arquivos do provedor fora do ar |
| Suporte Vercel (plano Pro) | | vercel.com/help | | site/API do provedor fora do ar |
| Quem guarda a `BACKUP_ENCRYPTION_KEY` (2 pessoas) | | | | restauração |

Escalonamento: alerta chega → 1º nível confirma em **15 min** (horário comercial) → não resolve em **1 h** → aciona o desenvolvedor → indisponibilidade > **2 h** ou qualquer vazamento → gestor + encarregado. Registre horários no modelo da §8.

## 2. Rotina

### Diária (5 minutos, de preferência todo dia útil de manhã)
1. **E-mails de alerta** do GitHub (issues "Indisponibilidade", "Backup desatualizado", "Falha no backup") e do monitor externo. Issue aberta = tratar hoje.
2. GitHub → Actions: os workflows **Backup** (rodou às 05:15 UTC), **Uptime** e **CI** da `main` estão verdes? **(automático)** o backup é verificado ao terminar.
3. Se estiver desconfiado de algo: `node tools/maintenance.js stats` (usuários, apresentações, tamanho do banco e dos arquivos, avisos).

### Semanal (15 minutos, segunda-feira)
1. Abra o resumo da execução **Manutenção** de domingo (Actions → Manutenção): convites expirados, versões podadas, auditoria apagada, **estatísticas** e **relatório de arquivos órfãos** (GC em modo relatório). **(automático)**
2. Convites pendentes antigos: Admin → Usuários → revogar os que não serão usados.
3. Falhas de login e bloqueios (consultas em `docs/MONITORAMENTO.md` §Consultas): picos de `auth.login_failed`, `security.rate_limited`, `security.csrf_blocked`.
4. Atualizações: Pull Requests de dependências pendentes; `npm audit --omit=dev` (relatório do CI) — **corrigir alertas "high" em até 7 dias** (o relatório atual aponta o pacote `sharp`: atualize e rode os testes).
5. Custos e cotas: painéis de uso da Vercel e do Supabase (banco, arquivos, tráfego) — comparar com `docs/pesquisa/recomendacao-e-custos.md`.

### Mensal (1 hora)
1. **Verificação de backup**: `node tools/backup.js verify` (baixa o mais recente, decifra e confere SHA-256 + índice do dump) e `node tools/backup.js list` (retenção conforme política).
2. Revisão de **acessos**: usuários ativos × quem ainda trabalha na empresa (suspender os que saíram); administradores (≥ 2); membros da organização no GitHub, Vercel e Supabase.
3. Revisar issues abertas de segurança (CodeQL, secret scanning) e atualizar a Vercel CLI/ações do GitHub fixadas (SHAs) se houver versões novas relevantes.
4. Rodar o GC **em relatório** e decidir se apaga (veja §5.7).

### Trimestral (meio dia)
1. **Ensaio completo de restauração em staging** (`docs/BACKUP-E-RESTAURACAO.md` §Testar): registrar data, tempo e resultado ali.
2. **Rotação de segredos** (§3) — no mínimo: senhas de banco, chave S3, chave de serviço, `CSRF_SECRET`, token da Vercel.
3. Revisar este runbook e os contatos; simular um incidente (ex.: "login fora do ar") com a equipe.
4. Revisar `docs/AMBIENTES.md` (quem tem acesso a quê) e as regras do Supabase/Vercel (`infra/supabase/auth-settings.md`).

## 3. Rotação de chaves e segredos

Princípio: **troque sem derrubar** — crie o novo valor, ponha em uso, confirme, só então revogue o antigo. Depois de cada rotação: `node tools/verify-deploy.js --url …` e um login de teste.

| Segredo | Onde fica | Como rotacionar |
|---|---|---|
| Senha do `postgres` (Supabase) | cofre; `DATABASE_ADMIN_URL` (GitHub: staging, production, production-ops) | Supabase → Database → *Reset database password*; atualizar `DATABASE_ADMIN_URL` nos 3 ambientes do GitHub; rodar `verify-deploy` |
| `APP_API_DB_PASSWORD` (`app_api`) | Vercel (`DATABASE_URL`) + GitHub (`production`, `staging`) | gerar nova senha; atualizar o secret; rodar `node tools/migrate.js` (ele aplica `ALTER ROLE app_api … PASSWORD`); atualizar `DATABASE_URL` na Vercel; **redeploy**; conferir `/api/ready` |
| `APP_OPS_DB_PASSWORD` (`app_ops`) | GitHub (`DATABASE_OPS_URL`) | idem; atualizar `DATABASE_OPS_URL` em `production` e `production-ops` |
| Chave de serviço do Supabase (`SUPABASE_SERVICE_ROLE_KEY`) | Vercel | criar a nova chave no painel (chaves secretas permitem várias ativas); atualizar na Vercel + redeploy; testar **convidar** um usuário; revogar a antiga |
| Chave anônima (`SUPABASE_ANON_KEY`) | Vercel + GitHub | idem |
| Chaves JWT do Supabase | painel do Supabase (*JWT Keys*) | criar nova chave de assinatura (standby) → *Rotate* → aguardar 1 h (tokens antigos expiram) → revogar a antiga. A API lê o JWKS: **sem redeploy** |
| Chave S3 do bucket principal | Vercel + GitHub (`S3_*`) | criar a nova chave em Storage → S3; atualizar Vercel e GitHub; redeploy; testar upload/abrir imagem; apagar a antiga |
| `CSRF_SECRET` | Vercel | gerar novo e fazer redeploy. Efeito: tokens CSRF abertos deixam de valer (as pessoas só precisam recarregar a página) e os identificadores de e-mail na **auditoria** (HMAC) mudam dali em diante (correlação com registros antigos é perdida) |
| **`BACKUP_ENCRYPTION_KEY`** | cofre + GitHub (`production`, `production-ops`) | **nunca apague a chave antiga**: ponha a **antiga** em `BACKUP_ENCRYPTION_KEYS_OLD` (separadas por vírgula) e a **nova** em `BACKUP_ENCRYPTION_KEY`. Backups novos usam a nova; os antigos continuam abríveis. Faça `node tools/backup.js verify` e um restore de teste. Só retire uma chave antiga quando todos os backups feitos com ela estiverem fora da retenção |
| Credenciais do bucket de backup | GitHub (`BACKUP_S3_*`) | criar nova chave no provedor; atualizar os 3 ambientes; rodar o workflow Backup; apagar a antiga |
| `VERCEL_TOKEN` | GitHub (`staging`, `production`) | criar novo token → atualizar → revogar o antigo |
| Contas pessoais (GitHub, Vercel, Supabase, cofre) | cada pessoa | MFA obrigatório; ao desligar alguém, **remover o acesso no mesmo dia** |

**Se um segredo vazou** (apareceu em log, chat, repositório): considere-o comprometido, **rotacione na hora** (não espere a rotina) e siga §6.4.

## 4. Pessoas e conteúdo (tarefas do dia a dia)

> Quase tudo isto é pela tela de **Admin** (os nomes exatos dos botões podem diferir do texto; o equivalente por API está em `docs/API.md` §4 e §7). Os comandos/SQL abaixo são o "plano B" para a TI.

### 4.1 Suspender (ou reativar) um usuário
Admin → Usuários → **Suspender**. Efeito imediato: o banco recusa todas as requisições da pessoa e o Supabase bloqueia novo login e renovação (`ban_duration`). Suas apresentações **continuam no acervo** (visíveis para todos). Para transferir a propriedade: Admin → apresentação → **Transferir** (`POST /api/presentations/:id/transfer`). Reativar: **Ativar**.
Plano B (contas comprometidas, com urgência): Supabase → Authentication → Users → *Ban user*; depois suspenda no Canteiro.

### 4.2 Recuperar apresentação da lixeira
O **dono** (ou admin) abre **Lixeira → Restaurar**. Admin vê a lixeira de todos. Só o admin apaga **de vez**.
Plano B (SQL, papel de operação):
```bash
psql "$DATABASE_OPS_URL" -c "begin; set local role app_system; update app.presentations set deleted_at = null, deleted_by = null where id = '<UUID>'; commit;"
```

### 4.3 Voltar a uma versão anterior
Editor → **Histórico de versões** → escolher a versão → **Restaurar** (cria um ponto "antes de restaurar": nada se perde). Retenção: 50 últimas + 1 por dia por 90 dias + todas as manuais (`app.settings`).

### 4.4 Apresentação apagada **de vez** (purge) ou perdida
1. Descubra a data aproximada e escolha um backup **anterior**: `node tools/restore.js list`.
2. Restaure o backup em um **banco temporário** (`docs/BACKUP-E-RESTAURACAO.md` §Restaurar um item).
3. No banco temporário, copie a linha de `app.presentations` (e, se quiser, `app.presentation_versions` e `app.asset_refs` da apresentação) para a produção **por SQL com o papel de operação** (`set local role app_system`). Os arquivos já estão no bucket (são imutáveis; o GC não apaga o que tinha referência, e o espelho de backup guarda os apagados).
4. Registre o ocorrido (auditoria `presentation.purge` mostra quando/quem).

### 4.5 Convites
Admin → Usuários → **Reenviar** (até 5) ou **Revogar**. Convite não chega → §6.7. Mudar o e-mail de alguém: o administrador altera em Admin; o novo e-mail precisa ser confirmado pelo Supabase.

### 4.6 Promover/rebaixar administrador
Admin → Usuários → papel. O banco **impede** rebaixar o **último** administrador ativo.

### 4.7 Perdeu a senha
A própria pessoa usa **Esqueci a senha** (link de 24 h). Se ela não receber o e-mail: §6.7.

### 4.8 Alguém pediu para apagar seus dados (LGPD)
Não existe "apagar tudo" de um clique: as apresentações são do **acervo** da empresa. Fluxo: (1) transferir as apresentações para outra pessoa (ou apagar, se a empresa decidir); (2) suspender a conta; (3) o encarregado de dados decide o que mais precisa ser anonimizado (comentários, auditoria). Registrar a decisão. Prazos legais: com o encarregado.

## 5. Publicação, rollback e restauração

### 5.1 Publicar
- **Staging:** merge na `main` → automático.
- **Produção:** Actions → *Deploy produção* → **Run workflow** → digite `PRODUCAO` (ou crie a tag `v1.2.3`) → os **revisores aprovam** → o fluxo faz backup verificado → `migrate --check` → migrações → verificação → Vercel → verificação do site → smoke. Qualquer falha **interrompe**.
- Antes de publicar: o último CI da `main` está verde; staging foi testado com o **mesmo** commit; leia as migrações novas (`platform/db/migrations`): devem ser **aditivas** (criar/ampliar; nunca apagar/renomear de uma vez).

### 5.2 Rollback de deploy (o site voltou a ter problema depois de publicar)
1. **Vercel**: Deployments → versão anterior estável → **Instant Rollback** (segundos; não mexe no banco). Ou `npx vercel@62.5.0 rollback` (volta ao deploy de produção anterior).
2. Confirme: `curl https://canteiro.<seu-dominio>/api/ready` e um login.
3. **Banco**: **não** restaure por reflexo. As migrações são aditivas, então o código anterior funciona com o banco novo. Só restaure o banco se houve **corrupção de dados** (§5.3).
4. Corrija no código, publique de novo pelo fluxo normal. Registre o incidente (§8).

### 5.3 Restaurar o banco ou os arquivos
Siga `docs/BACKUP-E-RESTAURACAO.md` (passo a passo numerado, com verificação). Em resumo: restaure em **banco novo**, valide, troque a conexão. Nunca sobre o banco em uso.

### 5.4 Migração que deu errado
O `migrate.js` aplica cada arquivo em **uma transação**: se falhar, nada é aplicado. Corrija o arquivo **se ainda não foi aplicado em nenhum ambiente**; caso contrário crie uma migração **nova** (arquivos aplicados nunca mudam: o checksum bloqueia). Antes de produção o backup do dia já foi verificado.

### 5.5 Indisponibilidade planejada (manutenção)
Avise com antecedência; publique fora do horário; para operações pesadas (ex.: ligar *Enforce SSL*, trocar chaves JWT) faça antes em staging.

### 5.6 Coleta de lixo de arquivos (GC)
Roda **em relatório** toda semana. Para apagar de verdade: Actions → *Manutenção* → Run workflow → marque `gc_apply` e digite `APAGAR` → aprovação dos revisores. Regras de proteção: só arquivos **sem nenhuma referência** (nem em versões antigas, nem miniaturas) há mais de 14 dias, sem upload recente (48 h), marcados antes e só apagados depois de 24 h; o job exige backup recente. Local: `node tools/gc-assets.js` (relatório) e `--apply`.

## 6. Incidentes

Para cada um: **sintoma → verificar → agir → depois**. Em qualquer incidente: abra uma issue no GitHub (ou o canal combinado) com horário de início, escreva o que foi feito **em tempo real**, e feche com a §8.

### 6.1 "Login fora do ar" (ninguém consegue entrar)
- **Verificar (2 min):** `curl -s https://canteiro.<seu-dominio>/api/ready` → qual campo está `false`?
  - `auth:false` → o Supabase Auth ou as chaves. Veja status.supabase.com; confira `SUPABASE_URL`/chaves na Vercel; se mudou a chave JWT, `SUPABASE_JWKS_URL` está certo?
  - `db:false` → §6.2.
  - tudo `true` mas o login falha → logs da Vercel (`/api/auth/login`, procure 401/403/429/5xx) e `app.audit_log` (`auth.login_failed`).
- **Causas e ações:** (a) Supabase com incidente → aguardar e avisar usuários; (b) chave de serviço/anon revogada → colocar a nova na Vercel + redeploy; (c) **muitos 429** → limite do GoTrue por IP (`auth-settings.md` item 9) ou do app (usuário errou a senha 8× em 10 min: aguardar 10 min ou consultar §4.7); (d) relógio/cookies: confira `APP_ORIGIN` = domínio real (cookie `__Host-` exige HTTPS e o mesmo domínio); (e) deploy recente → rollback (§5.2).
- **Contingência:** nenhuma sessão ativa é derrubada por uma falha do Auth até o cookie de acesso expirar (1 h); o refresh fica indisponível.
- **Depois:** relatório (§8); se foi limite do GoTrue, ajuste e documente.

### 6.2 "Banco cheio" / lento / conexões esgotadas
- **Sintomas:** `/api/ready` `db:false`, erros 500/503, "too many connections", lentidão.
- **Verificar:** `node tools/maintenance.js stats` (tamanho do banco e maiores tabelas); Supabase → Reports (CPU, conexões, disco); `select count(*) from pg_stat_activity` (admin).
- **Agir, nesta ordem:** (1) **conexões**: confirme que `DATABASE_URL` usa o **pooler porta 6543** e `DB_POOL_MAX` ≤ 5 (3 em produção); (2) **espaço**: rode a poda de versões e retenção de auditoria (`node tools/maintenance.js prune-versions` / `audit-retention`) — a maior parte do banco são as versões (`app.presentation_versions`); reduza `versions.keep_last` em `app.settings` se necessário; (3) **disco do Supabase**: Project Settings → Compute and Disk → aumentar (o disco cresce, não encolhe sem recriar; faça com folga: banco recomendado até ~80% do disco); (4) **CPU**: suba o *compute* (Micro → Small) temporariamente; (5) consultas lentas: Supabase → Query Performance.
- **Inchaço (tuplas mortas) em `app.presentations`:** o autosave reescreve o deck inteiro; a migração 0005 já deixou o autovacuum agressivo nessa tabela. Se `stats` → `bloat` mostrar mortas > vivas por mais de um dia, rode `vacuum (analyze) app.presentations;` como dono do esquema (papel `postgres`/`app_owner`, conexão direta) fora do horário de pico.
- **Dimensionamento (medido no teste de carga, `docs/evidencias/carga.md` §7 e §10):** uma instância da API atende 50 usuários simultâneos com folga (p95 do salvamento < 200 ms) e começa a degradar perto de 100 (p95 ~1 s, CPU do processo > 80 %). Na Vercel a escala é automática por instância. Em contêiner próprio, suba **um processo por CPU** (réplicas atrás do Caddy/balanceador) e use `DB_POOL_MAX=10` por processo (some ao limite do pooler); na Vercel 2–3 conexões por instância bastam.
- **Se o banco ficou somente leitura / indisponível por falta de disco:** aumente o disco primeiro; depois investigue a causa.
- **Depois:** ajustar alertas (`MONITORAMENTO.md`): aviso em 70% do espaço.

### 6.3 "Arquivos faltando" (imagens quebradas nas apresentações)
- **Verificar:** abra a apresentação afetada e anote 1 SHA (a rede do navegador mostra `/api/assets/<sha>` com 404). Pelo banco: `app.assets` tem a linha? status `ready`?
  `node tools/restore.js db --to <banco-temporario> --verify-objects` é o teste completo (re-hash de **todos** os objetos referenciados).
- **Causas e ações:**
  1. Linha existe, objeto **não** está no bucket (apagado/migração mal feita) → **restaurar o objeto do espelho cifrado**: `node tools/restore.js objects --to-primary --yes --only-referenced --db "$DATABASE_ADMIN_URL"` (restaura só o que falta; confere o SHA de cada um).
  2. Objeto existe mas **corrompido** (conteúdo não confere com o SHA-256): o comando acima só repõe os **ausentes**. Apague o objeto corrompido no bucket (`a/<2 primeiros>/<2 seguintes>/<sha>`) e rode o comando de novo.
  3. Foi o **GC**? Veja o relatório da última execução (apagou algo que tinha referência é impossível por desenho; se acontecer é **bug grave**: pare o GC e acione o desenvolvedor).
  4. Upload interrompido (status `pending`): o cliente reenvia ao salvar; se persistir, `rejected`/`pending` antigos são limpos pelo GC.
- **Depois:** descobrir por que sumiu; se o bucket principal perdeu dados, avise o Supabase e considere restaurar tudo do espelho.

### 6.4 Suspeita de vazamento (segredo, conta ou dado)
**Prioridade máxima. Não apague nada (preserve evidências).**
1. **Conter (primeiros 30 min):**
   - **Segredo exposto** (no git, em log, chat): rotacione **já** (§3) — a chave vazada vale como pública. Se foi no git: apagar o commit **não** basta; rotacionar é o que protege.
   - **Conta de usuário comprometida:** suspenda a conta (§4.1) e peça nova senha; revogue sessões (suspender faz isso).
   - **Conta de admin da plataforma/infra comprometida:** troque senhas e MFA, remova sessões; liste os admins; revise o que foi feito (auditoria).
   - **Acesso indevido ao banco/bucket:** troque as senhas/chaves; considere ligar *Network Restrictions* (§auth-settings 15) temporariamente.
2. **Entender (próximas horas):** auditoria — `app.audit_log` (quem, quando, IP, ação): `docs/MONITORAMENTO.md` §Consultas; logs da Vercel/Supabase (retenção curta: **exporte agora**); GitHub → Settings → Security log; `node tools/secret-scan.js` e Secret scanning do GitHub.
3. **Comunicar:** acione o **gestor e o encarregado de dados imediatamente**. Se houver dados pessoais envolvidos, a comunicação à ANPD e aos titulares tem prazo curto (a pesquisa registra 3 dias úteis — confirme com o jurídico: `docs/pesquisa/monitoramento-backup-seguranca.md` §8).
4. **Depois:** relatório com linha do tempo, causa raiz, dados afetados, ações. Revisar o que permitiu o vazamento (ex.: segredo em lugar errado → `secret-scan`, regras do CI).

### 6.5 Site fora do ar / muitos erros 5xx
`curl -I https://canteiro.<seu-dominio>` e `/api/health`. Se `health` falha: Vercel (vercel-status.com) ou deploy ruim → **rollback (§5.2)**. Se só `ready` falha: dependência (§6.1/6.2). Logs: Vercel → Logs (filtrar status 5xx; retenção de 1 dia no Pro: exporte o que precisar).

### 6.6 Backup falhou / desatualizado
Issue "Falha no backup" ou "Backup desatualizado". (1) Abra a execução do workflow **Backup** e leia o passo que falhou (mensagens em português). Causas comuns: senha do `postgres` trocada e secret não atualizado; credencial do bucket revogada; `pg_dump` com versão errada (`PG_CLIENT_MAJOR`); bucket cheio/sem permissão; IPv6 (§CONFIGURACAO 16). (2) Corrija e rode **Run workflow** do Backup; confirme `backup-freshness` verde. (3) **Enquanto não houver backup novo, evite mudanças arriscadas (deploy com migração, GC)**. Nada é apagado numa falha: o último backup bom continua lá.

### 6.7 Convites/recuperação de senha não chegam
SMTP: Supabase → Auth → Logs (erro de envio?); limite de e-mails por hora; credencial SMTP vencida; SPF/DKIM/DMARC (`CONFIGURACAO` §7); caixa de spam; remetente bloqueado. Teste com outro provedor de caixa (Gmail/Outlook). Reenvie pelo Admin.

### 6.8 Gasto/cota estourando (Vercel ou Supabase)
Veja o painel de uso. Causas típicas: tráfego de arquivos (cache `immutable` em `/api/assets` deve reduzir), loop de requisições de um cliente (consulte os logs por IP/usuário e suspenda), arquivos muito grandes. Ações: GC, reduzir retenção, aumentar plano, Firewall da Vercel (rate limit por IP). Cuidado com *Spend cap* do Supabase (bloqueia o serviço ao estourar; veja `auth-settings.md` item 22).

### 6.9 Pessoa sem acesso (não consegue editar a apresentação)
Por regra do produto, **só o dono (ou admin) edita**. A pessoa deve **Criar cópia** (fica dela). Se for dono e não consegue: sessão expirada (relogar), conta suspensa (§4.1) ou conflito de edição (outra aba salvou; o editor mostra a tela de conflito).

## 7. Referências rápidas

| Preciso… | Comando / lugar |
|---|---|
| ver se está tudo bem | `curl https://canteiro.<seu-dominio>/api/ready` |
| verificar configuração de segurança | `node tools/verify-deploy.js [--url https://…]` |
| números de uso | `node tools/maintenance.js stats` |
| listar backups | `node tools/backup.js list` |
| verificar o último backup | `node tools/backup.js verify` |
| backup manual agora | Actions → Backup → Run workflow (ou `node tools/backup.js all`) |
| restaurar | `docs/BACKUP-E-RESTAURACAO.md` |
| arquivos órfãos | `node tools/gc-assets.js` |
| criar admin | `node tools/create-first-admin.js --email … --name …` |
| segredos no repositório | `node tools/secret-scan.js` |
| onde está cada variável | `docs/CONFIGURACAO.md` §15 |

## 8. Modelo de relatório de incidente (copie e preencha)

```
Incidente: <título>                 Gravidade: baixa | média | alta | crítica
Início: <data/hora>   Detecção: <como>   Fim: <data/hora>   Duração: <min>
Quem atuou: <nomes>
Impacto: <quem/quantos foram afetados; houve perda de dados? vazamento?>
Linha do tempo: <hora — o que foi visto/feito>
Causa raiz: <por quê aconteceu>
Correção imediata: <o que foi feito>
O que vamos mudar para não repetir: <ação — responsável — prazo>
Comunicados feitos: <usuários / gestor / encarregado / ANPD (se aplicável)>
```
