# Passagem de bastão — Canteiro (A&M Studio)

**Atualizado em 10/10/2026**, `main` em `b4866ee` (PR #42). Escrito para que **outra ferramenta ou agente** continue o desenvolvimento sem refazer a investigação.
Leia antes, nesta ordem: `CLAUDE.md` (regras do repositório), `studio/docs/ARCH.md` §0 e §9.5, `platform/README.md`, `platform/docs/API.md`, `platform/docs/STATUS-MVP.md`.

---

## 1. Onde o projeto está

| Item | Estado verificado |
|---|---|
| Editor original (`studio/`) | Intocado. O build autônomo é byte-idêntico ao original (`original/SHA256SUMS`, teste PR-01). **Não modificar.** |
| Plataforma (`platform/`) | Node 22 + Hono, PostgreSQL com RLS (`db/migrations/0001`–`0010`), Supabase Auth (GoTrue), armazenamento compatível com S3 (`@aws-sdk/client-s3`), editor em nuvem gerado de `studio/` + `studio-cloud/` |
| Hospedagem alvo do MVP | Render Free + Supabase Free (`render.yaml`, `docs/MVP-GRATUITO.md`). **Nada publicado ainda.** |
| CI na `main` (`b4866ee`) | CI, PostgreSQL 17, E2E Chromium, CodeQL e Build Render Free verdes |
| PRs abertos | Nenhum |
| Aceite do MVP | 1/6 etapas (`docs/STATUS-MVP.md`). CI verde **não** é publicação nem homologação |

### Integrado em 09–10/10/2026 (esta rodada)
- **#31**: preparação do teste de carga de 50 usuários em PostgreSQL 17 isolado (workflow manual, **nunca executado**).
- **#39**: o logout só declara a limpeza do IndexedDB quando o navegador confirma (fechou a issue #37).
- **#42**: auditoria do backend, sem achados P0/P1, com 5 correções e regressões que falham sem elas (detalhes em `platform/docs/SEGURANCA.md`, AF-6 a AF-10):
  - cota reconferida no PUT dentro da transação do `asset_mark_ready`;
  - convite vencido não autentica (migração **0010**);
  - o finalize usa o `X-Asset-Kind` de quem finaliza;
  - a corrida com o GC (FK 23503) vira 409;
  - data impossível no admin vira 400.

### AWS Amplify + AppSync (issue #41)
Não há **nenhuma** implementação Amplify/AppSync em nenhuma branch remota nem em PR. A única parte AWS é o SDK S3. O dono do projeto escolheu (10/10) **seguir na arquitetura atual Render/Supabase**. Não comece uma migração AWS sem nova decisão explícita e sem a branch AWS que a issue #41 diz existir fora do GitHub.

---

## 2. Ambiente para rodar os testes (o que foi preciso nesta máquina)

```bash
cd platform && npm ci
# PostgreSQL 16 ou 17 com senha (NÃO use trust: o teste 28P01 de ops espera recusa de senha errada)
#   usuário postgres / senha postgres em 127.0.0.1:5432, banco canteiro_test criado
pip install "moto[server]==5.2.3" python-pptx==1.0.2   # S3 falso (sem ele ~10 testes de ops ficam SKIP)
export APP_ENV=test \
  TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_test \
  DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_test \
  E2E_EXTERNAL_POSTGRES=1
(cd ../studio && python3 assemble.py)   # gera studio/AM-Studio-Editor.html (os testes de nuvem precisam dele)
npm run build:web
```

- **Playwright fixado em 1.63.0** (Chromium 1243). Se a máquina tiver outra versão do Chromium, aponte `PLAYWRIGHT_BROWSERS_PATH` para uma pasta com o navegador certo. Com versão diferente, a suíte `tests/web` reprova por contraste (4,24) e miniaturas, e a paridade (`test:parity`) quebra com `Target crashed`, **também na `main`**: é ambiente, não regressão. A referência é o CI.
- Resultado esperado na `main` (medido em 10/10):

| Comando | Resultado |
|---|---|
| `npm test` | 869/869 |
| `npm run test:security` | 135/135 |
| `node --test --test-concurrency=1 "tests/ops/*.test.js"` | 150/150 |
| `npm run test:e2e` | 102/102, CSP 0, console 0 |

---

## 3. Portões obrigatórios antes de integrar qualquer PR

1. Branch própria a partir da `main` mais recente. Commits pequenos, em português.
2. Testes da área tocada mais a regressão nova (que **falhe sem a correção**: prove removendo a correção).
3. CI do PR verde no **SHA final**: CI, Postgres 17, Playwright (Chromium), CodeQL e, se aplicável, Build Render Free.
4. Mudou o editor em nuvem (`studio-cloud/`, `tools/build-cloud-editor.js`) → `npm run test:parity` (ou `:quick`) e `tests/cloud`.
5. Mudou contrato → atualize `platform/docs/API.md` **antes**.
6. **Merge**: o dono ainda não autorizou merges sem revisão humana (o modo automático bloqueou como "merge sem revisão" em 10/10). Abra o PR, deixe os checks verdes e **peça a aprovação** dele.

**Nunca:** alterar `studio/` para a plataforma; force-push na branch de outro; pular, desligar ou colocar teste em quarentena; aplicar migração direto no Supabase real (só pelo workflow com aprovação); criar recursos pagos (AWS, Render pago, Supabase Pro); versionar `.env`, `platform/.data/`, `platform/.tmp/`, `platform/dist/`, PDFs confidenciais, `.mp4`.

---

## 4. O que a próxima ferramenta precisa fazer (em ordem)

### P1 — dependem do dono (credenciais, painel, aprovação); prepare e peça
1. **Aplicar a migração 0010 ao Supabase `canteiro-mvp`** pelo mecanismo versionado (`tools/migrate.js` no workflow protegido). Depois, conferir com `tools/verify-deploy.js`. Hoje o banco real está em `0009`.
2. **Proteger a `main` (issue #28)**: exigir CI, Postgres 17, Playwright e CodeQL como checks obrigatórios e proibir push direto. É configuração do GitHub (Settings → Branches), feita pelo dono. Entregar o passo a passo exato.
3. **Publicar o piloto no Render Free** (`docs/MVP-GRATUITO.md`, `docs/CHAVES.md`): conta Render, variáveis secretas, cadastro aberto desligado no Supabase e primeiro admin (workflow `mvp-first-admin.yml`). Aceite: `/api/ready` = 200 em HTTPS.

### P2 — executáveis sem credenciais
4. **Continuar a auditoria do backend** nas áreas que a rodada de 10/10 **não** revisou:
   - `src/lib/presentations-service.js` (salvar, versões, restaurar, duplicar, lixeira);
   - `src/routes/comments.js` e `src/routes/interactions.js` (só revisados pelo ângulo de autorização);
   - `tools/gc-assets.js`, `tools/maintenance.js` e `db/migrations/0002`, `0004`, `0007`.

   Método: auditoria independente → reproduzir → teste que falha → menor correção → PR.

   Candidato já visto, de baixa prioridade: em `saveContent`, um salvamento com conteúdo idêntico (caminho de idempotência) **ignora um `thumbSha` novo**, e a miniatura não atualiza até a próxima mudança real. Confirme e decida se vale a correção.
5. **Carga de 50 usuários (issue #29)**: rodar o workflow manual `load-isolated-pg17.yml` (Actions → *Run workflow*; banco descartável, sem serviços reais). Registrar p50/p95/p99, erros e throughput em `docs/evidencias/` e atualizar a issue.
6. **Paridade visual completa** no CI ou numa máquina com o Chromium 1243: `npm run build:cloud && npm run test:parity`, com o resultado em `docs/evidencias/paridade.md`. Localmente, com o Chromium errado, não serve como prova.
7. **Branches remotas antigas**: cerca de 35 branches `fix/*`, `feat/*`, `security/*`, `test/*` sobraram de PRs já integrados por squash. As diferenças que ainda mostram contra a `main` refletem a evolução posterior da `main`, não trabalho perdido, mas confira cada uma (PR correspondente fechado e integrado) antes de propor apagá-las ao dono. **Não apague sem autorização.**

### P3 — depois do piloto no ar
8. Homologação real: login, salvar, reabrir em um **segundo computador**, imagens, exportações e permissões entre dois usuários (etapas 4 e 5 do `STATUS-MVP.md`).
9. Backup cifrado e restauração contra o R2/S3 real (issue #27). Hoje só foi ensaiado com o S3 falso (moto).
10. Corrigir a documentação desatualizada: `platform/docs/00-ANALISE-ORIGINAL.md` diz que não há tela para as respostas de formulário/votação, mas o acervo já tem essa tela (`web/js/pages/acervo.js`: lista, CSV, apagar).

---

## 5. Bloqueios conhecidos (precisam do dono)

| Bloqueio | O que é preciso |
|---|---|
| Publicação Render/Supabase | conta Render, segredos no GitHub/Render, painel do Supabase |
| Migração 0010 em produção/piloto | aprovação do workflow de banco |
| Proteção da `main` | ação do dono em Settings do GitHub |
| Merge autônomo de PRs | autorização explícita, ou revisão humana por PR |
| Arquitetura AWS (issue #41) | decisão e acesso à branch AWS (não está no GitHub) |
