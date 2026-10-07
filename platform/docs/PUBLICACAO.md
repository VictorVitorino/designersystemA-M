# Publicação — do zero ao Canteiro no ar

O roteiro, em ordem: **staging → checklist de aceite (10 itens, ~30 min) → produção (por versão) → primeiro administrador → convites → monitor → backup e ensaio de restauração.**
Você só **cria contas, paga e cola chaves** (`docs/CHAVES.md`). Todo o resto é feito pelos workflows do GitHub (aba **Actions**), que configuram, conferem e escrevem um **resumo** em português no fim de cada execução. Contas e custos: `docs/CONFIGURACAO.md`.

> **Leia antes:** os workflows foram testados contra **servidores falsos** que imitam o Supabase, a Vercel e o R2 — **não** contra os serviços reais (não havia contas). A primeira execução de cada um é o teste de verdade: por isso staging vem primeiro, e os assistentes de configuração têm a opção **simular** (mostra o que mudaria sem alterar nada). Se um resumo mostrar **ERRO**, ele diz o que fazer; se não ficar claro, peça ajuda ao assistente informando o link da execução (nunca a chave).

Como rodar um workflow: GitHub → **Actions** → nome do workflow na lista da esquerda → **Run workflow** → preencher → **Run workflow**. O resultado aparece ao clicar na execução (resumo no topo).

## Etapa 1 — Staging (um ensaio completo, sem dados reais)

1. **Supabase:** *New project* → organização da A&M → nome `canteiro-staging`, região **South America (São Paulo)**, senha do banco = a do cofre ("Canteiro staging — senha do banco"), *Compute* **Micro**.
2. **GitHub:** crie os ambientes e as regras (`docs/CONFIGURACAO.md` §3) e cole, conforme `docs/CHAVES.md`, os valores do **repositório** — `PRODUCTION_URL`, `STAGING_URL` e o token temporário `SUPABASE_ACCESS_TOKEN` (o `R2_ACCOUNT_ID` entra na etapa 2) — e os 10 do ambiente **`staging`**.
3. **Actions → Configurar Supabase** → ambiente `staging` → Run. Configura login (sem cadastro aberto, senha ≥ 12, convites em português, e-mail pelo Resend, endereços de retorno — inclusive o do login corporativo), arquivos privados, banco e confere **relendo tudo**. O resumo termina com a **tabela de DNS do e-mail**: envie-a à TI.
4. **Actions → Configurar Vercel** → `staging` → Run. Cria/ajusta o projeto (região São Paulo, Node 22, ambiente `staging`), grava as variáveis da API (segredos como *Sensitive*) e o domínio; o resumo traz o **registro de DNS do site** (CNAME de `staging.canteiro…`): envie à TI.
5. **TI cria os registros de DNS** (e-mail e site). Pronto quando: no Resend o domínio fica **Verified** e na Vercel o domínio fica **Valid Configuration** (minutos a algumas horas). Rode o **Configurar Supabase** (staging) de novo: a linha do e-mail passa a "domínio verificado".
6. **Ligue o staging:** variável do repositório `STAGING_ENABLED = true`. Depois **Actions → Deploy staging → Run workflow**. O deploy espera o CI do commit, aplica as migrações, confere banco e login, publica, confere o site (o HTML publicado tem de ser idêntico ao gerado, e a política de segurança do editor igual à do `vercel.json`) e faz o teste de fumaça. Tudo verde = staging no ar.
7. **Actions → Criar primeiro administrador** → seu e-mail, seu nome, ambiente `staging` → Run. Abra o e-mail "Você foi convidado para o Canteiro A&M" e crie a senha.
8. Faça o **checklist de aceite** abaixo. Só siga para a produção com os 10 itens marcados.

## Checklist de aceite (staging, cerca de 30 minutos)

Use duas pessoas (ou dois navegadores, um deles em janela anônima): **A** (administradora) e **B** (convidada por A no passo 2).

- [ ] **1. Publicação verde (2 min).** A última execução de *Deploy staging* está verde e o resumo mostra **0 falhas** em "Banco e login de staging" e em "Site de staging publicado".
- [ ] **2. Convite chega (5 min).** A convida B (Admin → Usuários → Convidar) em um Gmail **e** em um Outlook: o e-mail chega na **caixa de entrada** (não no spam), remetente "Canteiro A&M", texto em português.
- [ ] **3. Primeiro acesso (3 min).** O link do convite abre a página de criar senha; uma senha curta (ou sem maiúscula/número) é **recusada**; uma senha forte entra direto no acervo.
- [ ] **4. Esqueci a senha (3 min).** B pede "Esqueci a senha", recebe o e-mail, troca a senha; a senha antiga deixa de funcionar.
- [ ] **5. Salvar e continuar em outro lugar (4 min).** A cria uma apresentação com 3 slides, fecha a aba, abre em **outro navegador ou computador** e continua de onde parou.
- [ ] **6. Imagens e anexos (3 min).** A envia uma foto grande e um PDF; recarrega a página: os dois aparecem.
- [ ] **7. Duas pessoas, regras certas (4 min).** B **vê** a apresentação de A no acervo, **não consegue editar**, usa **Criar cópia** e edita a cópia (que é de B).
- [ ] **8. Apresentar e importar (3 min).** O modo apresentação abre em tela cheia; em **Importar**, um arquivo `.html` do Canteiro local vira apresentação com as imagens.
- [ ] **9. Lixeira e versões (2 min).** A apaga uma apresentação e a restaura da **Lixeira**; volta a uma versão anterior pelo **Histórico de versões**.
- [ ] **10. Administração (2 min).** A **suspende** B: B perde o acesso em segundos; A **reativa** B: B entra de novo.

Algo falhou? Anote o item, o horário e o que apareceu na tela, e peça a correção. Corrigido, ele chega ao staging sozinho no próximo push da `main`; refaça o item.

## Etapa 2 — Produção

1. **Supabase:** *New project* → `canteiro-prod`, **South America (São Paulo)**, senha do cofre ("Canteiro produção — senha do banco"), *Compute* **Small**.
2. **Cloudflare R2:** *Create bucket* → nome `canteiro-backup` (local automático). Crie os **dois tokens** (escrita e só leitura) como em `docs/CHAVES.md`.
3. **GitHub:** cole o `R2_ACCOUNT_ID` (variável do repositório) e os valores dos ambientes **`production-ops`** (13) e **`monitoring`** (2).
4. **Actions → Configurar Supabase** → `production`; depois **Actions → Configurar Vercel** → `production`. Envie à TI o DNS do site de produção (`canteiro.<dominio>`; o do e-mail já existe desde o staging). Espere o domínio ficar **Valid Configuration** na Vercel.
5. **Publique a versão 1.0.0** — é assim que se aprova a produção: GitHub → **Releases → Draft a new release → Choose a tag** → digite `v1.0.0` → **Create new tag: v1.0.0 on publish** → *Target* `main` → título "Canteiro 1.0.0" → **Publish release**. O **Deploy produção** começa sozinho: espera o CI, passa pelo portão (só versões `v*`), faz o **backup obrigatório** (cifrado e relido), aplica as migrações, confere banco e login, publica e confere o site. Acompanhe em Actions.
6. **Ligue a produção:** variável do repositório `PRODUCTION_ENABLED = true` (monitor do GitHub e manutenção semanal).
7. **Primeiro administrador:** **Actions → Criar primeiro administrador** → e-mail e nome da pessoa responsável, ambiente `production`. Ela aceita o convite, cria a senha e **convida um segundo administrador** (Admin → Usuários). Sempre tenha pelo menos 2.
8. **Backup:** **Actions → Backup → Run workflow** (manual). Verde = backup cifrado no R2. Então crie a variável `BACKUP_ENABLED = true` (backup diário às 02:15 de Brasília, conferência a cada 4 h).
9. **Ensaio de restauração:** **Actions → Ensaio de restauração → Run workflow**. Ele baixa o backup mais recente, restaura num Postgres descartável dentro do GitHub (nada de produção é tocado), confere tudo e escreve o relatório: precisa terminar **APROVADO**. Depois ele roda sozinho todo dia 3.
10. **Monitor externo (Better Stack, grátis):** crie os monitores de `docs/MONITORAMENTO.md` §2 (`/api/health`, `/api/ready`, página inicial, staging e certificado), com alerta por e-mail para 2 pessoas.
11. **Apague o token temporário:** GitHub → Settings → Secrets and variables → Actions → `SUPABASE_ACCESS_TOKEN` → **Remove**; e no Supabase → Account preferences → Access Tokens → **Revoke**.
12. **Convites e acervo:** convide a equipe em grupos pequenos (o e-mail novo precisa ganhar reputação), e cada pessoa importa os próprios arquivos em **Importar** (detalhes em `docs/OPERACAO.md` §4).

## Depois: o dia a dia

- **Versão nova:** tudo que entra na `main` vai sozinho para o **staging**. Testou e está bom? Crie a versão seguinte (`v1.0.1`, `v1.1.0`…) em **Releases** — só isso publica em produção.
- **Algo deu errado depois de publicar:** volte para a versão anterior em segundos pela Vercel (*Instant Rollback*) ou rode o **Deploy produção** escolhendo a tag anterior (`docs/OPERACAO.md` §5.2).
- **Alertas:** chegam por e-mail como *issues* do GitHub ("Indisponibilidade", "Backup desatualizado", "Falha no backup", "Alerta de capacidade", "Falha no ensaio de restauração") e fecham sozinhas quando o problema some. O que fazer em cada uma: `docs/OPERACAO.md` §6 e `docs/MONITORAMENTO.md`.
- **Trocar uma chave:** `docs/CHAVES.md` (fim) e `docs/OPERACAO.md` §3.
