# Status do MVP gratuito — Canteiro / AM Studio

**Referência:** 09/10/2026. **Objetivo:** piloto pequeno, em serviços gratuitos, sem alterar o editor standalone.

> **Maturidade técnica percentual: não mensurada.** **Etapas de aceitação concluídas: 1/6.** O MVP ainda não foi homologado em hospedagem real. Testes automatizados não equivalem a publicação e aceite com usuários.

## Indicadores com evidências

| Indicador | Estado | Prova |
|---|---|---|
| Código principal do editor/plataforma | ✅ implementado | Repositório GitHub |
| Testes de aplicação, segurança e PostgreSQL 17 | ✅ aprovados na main | [CI da main 37856550986](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37856550986) |
| Testes completos de navegador / E2E | ✅ aprovados na main | [E2E da main 37856550988](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37856550988) |
| PR #2: infraestrutura gratuita Render + Supabase | ✅ integrado na main | [PR #2](https://github.com/VictorVitorino/designersystemA-M/pull/2) com CI e E2E aprovados |
| PR #5: convite seguro de administrador + correção de Esc | ✅ integrado com CI, segurança e E2E aprovados | [PR #5](https://github.com/VictorVitorino/designersystemA-M/pull/5) |
| Banco Supabase dedicado Canteiro | ✅ projeto criado em organização Free; 9 migrações de app aplicadas e verificadas | Supabase **canteiro-mvp**, região `sa-east-1`, banco PostgreSQL 17, 14 tabelas com RLS e 1 view (`app.directory`) no schema `app` |
| Storage Supabase privado | ✅ criado, sem arquivos | Bucket `canteiro-mvp-files`, **private**, limite por arquivo de 50 MB; acesso público e políticas a validar no piloto |
| Primeiro administrador/convite real | ⏳ ainda não enviado | Workflow no GitHub existe, mas requer desabilitar cadastro aberto e configurar credenciais por canal seguro |
| Render Free publicado | ⏳ não configurado | Botão de implantação na README e Blueprint Free aprovados, mas nenhuma conta Render conectada ou URL validada |
| Login/salvamento online com serviços reais | ⏳ não homologado | E2E prova o fluxo com ambiente de teste, não Render/Supabase reais |
| Custo contratado | ✅ R$ 0 adicional | Nenhuma nova contratação realizada nesta atividade |

## Passos e portões objetivos

| Passo | Descrição | Situação | Quando está realmente concluído |
|---|---|---|---|
| **1** | Estabilizar editor, CI, segurança, banco e E2E | ✅ concluído | CI + Postgres 17 + E2E aprovados e PR #1 integrado à main |
| **2** | Preparar banco e login do piloto gratuito | 🔄 em preparação | Projeto Canteiro Free criado, migrações concluídas, primeiro admin convidado, bucket privado e Auth comprovados |
| **3** | Publicar site e API gratuitos | ⏳ não iniciado | Render Free real, HTTPS, /api/ready = 200 |
| **4** | Salvar e retomar em segundo computador | ⏳ não iniciado | Fluxo real com imagens e exportações sem perda de dados |
| **5** | Testar com usuários, permissões e restauração | ⏳ não iniciado | Testes de aceite e privacidade aprovados no piloto |
| **6** | Liberar piloto para convidados | ⏳ não iniciado | Credenciais, instruções, monitoramento mínimo e recuperação validados |

**Etapas concluídas: 1/6. Passo atual: 2/6.**

## Mudanças entregues em 08/10/2026

- Corrigidos CI, testes de dependência de desenvolvimento e avisos do Chromium.
- Corrigida a inicialização de PostgreSQL isolado no GitHub Actions; os E2E reais locais passaram.
- Corrigidos o teste PPTX/Python isolado e o reconhecimento de contagem de slides com zero à esquerda.
- Incorporado o [PR #1](https://github.com/VictorVitorino/designersystemA-M/pull/1) à main.
- Integrados à main hospedagem gratuita, migrações controladas, testes HTTP externos e inicializador Windows ([PR #2](https://github.com/VictorVitorino/designersystemA-M/pull/2)).
- Integrado verificador de segurança pré-inicialização no Render, isolamento de banco/Auth/Storage e bloqueio a acesso anônimo às apresentações ([PR #6](https://github.com/VictorVitorino/designersystemA-M/pull/6)).
- Integrado fluxo manual seguro e testes do convite do primeiro administrador, com correção do painel de comentários ([PR #5](https://github.com/VictorVitorino/designersystemA-M/pull/5)).
- Criado projeto exclusivo Supabase Free `canteiro-mvp` no Brasil após cotação de **US$ 0/mês**; aplicadas migrações de `0001` a `0009`, com históricos SHA-256, RLS e políticas; criado bucket privado `canteiro-mvp-files`.
- Auditoria Supabase: **0 avisos WARN** depois de aplicar a migração 0008 ([PR #7](https://github.com/VictorVitorino/designersystemA-M/pull/7) aprovado e integrado). Permanece 1 INFO intencional: `public.schema_migrations` usa RLS deny-all sem políticas para não expor o histórico de migrações.
- Integrado [PR #8](https://github.com/VictorVitorino/designersystemA-M/pull/8): dez índices de FK aplicados ao Supabase real e verificados; o Performance Advisor não aponta mais chaves estrangeiras sem índice. Restam apenas avisos INFO de índices ainda não usados em banco vazio.
- Integrado [PR #9](https://github.com/VictorVitorino/designersystemA-M/pull/9): botão oficial para publicar no Render Free e URL APP_ORIGIN automática (sem copiar manualmente).
- A correção de HTTPS dos provedores externos permanece em validação no [PR #4](https://github.com/VictorVitorino/designersystemA-M/pull/4), com CodeQL e E2E anteriores aprovados e nova CI em andamento.
- O próximo bloqueio externo é configurar uma conta **Render Free** com variáveis seguras, desabilitar cadastro público no Supabase e convidar o primeiro administrador. **Não há endereço do site publicado.**

## Limites e proteção de custo

- Não criar projetos ou consumir planos pagos sem verificar os limites gratuitos e obter autorização explícita quando houver custos.
- Não reutilizar o banco **Portfolio FE DEV** em nenhuma hipótese.
- Não cadastrar dados confidenciais reais antes de revisar acesso e privacidade, sobretudo enquanto o repositório permanecer público.
- CI verde não equivale a hospedagem real em produção: os passos 2–6 dependem de validações adicionais.
- Nunca alterar `studio/` para implementar plataforma/infraestrutura.

**Regra de atualização:** só mudar status de uma etapa com evidência reproduzível e verificada; indicar links dos testes e da implantação. Não atribuir percentuais de maturidade sem definição formal do denominador e medição auditável.

## Atualização do desenvolvimento — 09/10/2026 (PRs e qualidade)

Este registro complementa a fotografia anterior; **não altera os critérios de aceite** nem converte CI aprovado em implantação real.

### Integrado à `main` com verificações aprovadas no PR

| Entrega | Evidência | Alteração comprovada |
|---|---|---|
| Correção de teste de cota | [PR #12](https://github.com/VictorVitorino/designersystemA-M/pull/12) | Dados de imagem determinísticos para evitar falso negativo na suíte de quota; CI e E2E aprovados. |
| Proteção de edições ao copiar/restaurar | [PR #13](https://github.com/VictorVitorino/designersystemA-M/pull/13) | Interrompe cópia/restauração se o salvamento prévio falhou ou se ainda existem alterações locais; testes no navegador, CI, Postgres17 e Build Render aprovados. |
| Render Free — parâmetros públicos do Supabase | [PR #11](https://github.com/VictorVitorino/designersystemA-M/pull/11) | Pré-configura URL, JWKS, S3, região e bucket do projeto dedicado, preservando segredos fora do repositório; CI, E2E, Postgres17 e CodeQL aprovados no PR. |
| Readiness concorrente e proteção de logs | [PR #14](https://github.com/VictorVitorino/designersystemA-M/pull/14) | Single-flight, TTL, timeout e mensagens seguras, com 4 regressões novas aprovadas; CI, Postgres17, CodeQL e E2E aprovados no PR. |
| Encerramento seguro do Node | [PR #15](https://github.com/VictorVitorino/designersystemA-M/pull/15) | Requisições ativas terminam antes de fechar o pool PostgreSQL; timeout e idempotência cobertos, CI, Postgres17, CodeQL e E2E aprovados. |
| Pré-deploy: pool e quota válidos | [PR #17](https://github.com/VictorVitorino/designersystemA-M/pull/17) | Rejeita valores ausentes, não inteiros ou inválidos no validador do Render Free; integrado com CI, PostgreSQL17, CodeQL e E2E aprovados. |
| Logs seguros de erros da API e inicialização | [PR #19](https://github.com/VictorVitorino/designersystemA-M/pull/19) | Remove mensagens, stacks e valores arbitrários de erro dos logs; oculta parâmetros de URLs nos logs de acesso. CI, PostgreSQL17, CodeQL e E2E aprovados no SHA integrado. |
| Concorrência de upload e cota | [PR #21](https://github.com/VictorVitorino/designersystemA-M/pull/21) | Confere a cota na transação que conclui o upload e bloqueia bypass por arquivo pendente; regressões com concorrência. CI, PostgreSQL17, CodeQL e E2E aprovados. |
| Logs seguros de autenticação | [PR #22](https://github.com/VictorVitorino/designersystemA-M/pull/22) | Limita códigos externos de erro do Auth a valores conhecidos e preserva o tratamento funcional. CI, PostgreSQL17, CodeQL e E2E aprovados. |
| Bucket S3 exclusivo do piloto | [PR #23](https://github.com/VictorVitorino/designersystemA-M/pull/23) | Valida bucket `canteiro-mvp-files` e região `sa-east-1` antes de inicializar. CI, PostgreSQL17, CodeQL, E2E e build Render aprovados. |

### Alterações em validação (ainda não estão na `main`)

- [PR #4](https://github.com/VictorVitorino/designersystemA-M/pull/4): exige HTTPS e rejeita credenciais em URLs de Auth/JWKS/S3 em staging/produção. CI identificou falha concreta na fixture `tests/security/sessions.test.js` que usava URLs HTTP locais sob `staging`. A fixture foi ajustada na branch do PR e os testes de CI/PostgreSQL17/CodeQL/E2E do último commit estão em execução. **Não integrar sem aprovação total da nova execução.**
- [PR #16](https://github.com/VictorVitorino/designersystemA-M/pull/16): este relatório segue em revisão, sem mudança de critério de aceite nem deploy real.
- [PRs #18](https://github.com/VictorVitorino/designersystemA-M/pull/18) e [#20](https://github.com/VictorVitorino/designersystemA-M/pull/20): soluções sobrepostas encerradas sem merge em favor do PR #19.

### Verificação independente do ambiente Supabase dedicado

- Projeto **`canteiro-mvp`**, região **`sa-east-1`**, estado **`ACTIVE_HEALTHY`** e PostgreSQL **17**.
- Migrações de papéis e aplicação `0001`–`0009` presentes.
- Conferência por catálogo PostgreSQL: **14/14 tabelas** do schema `app` têm RLS ligada, **0 sem RLS**; os papéis `anon` e `authenticated` não têm `USAGE` no schema. Existe também **1 view** (`app.directory`), não uma décima quinta tabela.
- Bucket `canteiro-mvp-files` consultado no banco: **privado**, 50 MiB por arquivo e **zero objetos** no momento da inspeção. Esse resultado não substitui teste de upload/leitura real no S3.
- Auditoria de segurança: nenhum WARN/ERROR; um INFO intencional `rls_enabled_no_policy` na tabela `public.schema_migrations` (RLS deny-all).
- O estado saudável do projeto **não comprova** conexão real de login, upload ou salvamento via Render.

### Próximas tarefas técnicas (somente após comprovar a necessidade)

1. Finalizar os novos checks do PR #4 no SHA vigente, corrigir falhas reais e integrar somente após CI + PostgreSQL17 + CodeQL + E2E aprovados; reexecutar checks de `main` após integrar.
2. Executar verificações de performance e concorrência contra **ambiente isolado de teste**, documentando p50/p95/p99, erro e throughput; não gerar carga sobre o Supabase Free ativo sem avaliação de cota.
3. Exercitar importação, exportação, autorização e restauração com **dados fictícios**, preservando `studio/` e a prova de paridade.
4. Revisar backups e procedimentos de recuperação com evidência, sem marcar como aprovado um restore que não foi realmente ensaiado.
5. Revalidar os checks completos da `main` quando as alterações forem integradas.

### Bloqueios externos para a aceitação do MVP

- Conta e Web Service **Render Free** ainda não configurados; não há URL de piloto comprovada com `/api/ready = 200`.
- Variáveis secretas de Render/GitHub, parâmetros do Auth, cadastro público desligado e primeiro convite administrativo ainda exigem ações autorizadas em painel.
- Persistência real entre **dois computadores**, arquivos, convites, permissões e recuperação de backup ainda sem homologação de ponta a ponta com os serviços externos.

**Resumo de aceite: permanece 1/6; etapa 2/6 em preparação.** Não tratar o `Deploy staging` do GitHub como evidência de um site Render publicado: o workflow pode ser concluído sem infraestrutura externa habilitada.

### Auditoria de checks de 09/10/2026

- PR #4: execução inicial mostrou falha real da fixture de `sessionOverride` com endpoints HTTP sob `staging`/`production`. Nova alteração na branch corrigiu a fixture sem dispensar HTTPS e disparou nova verificação no GitHub. Aprovação do último SHA ainda pendente.
- PRs #19, #21 e #22: CI (incluindo PostgreSQL 17), CodeQL e E2E aprovados nos SHAs integrados à `main` em 09/10/2026.
- PR #23: reexecução do E2E Chromium aprovada; CI, PostgreSQL 17, CodeQL e build Render Free também aprovados. PR integrado à `main`.
- Nenhum deploy Render real comprovado. Maturidade técnica **não mensurada**; aceite permanece **1/6**.

## Atualização de execução — 09/10/2026, manhã

> Esta seção é a fotografia mais recente deste relatório; a seção de auditoria acima preserva **a sequência histórica**, inclusive status de checks que depois evoluíram. O percentual anterior de 85% é uma estimativa antiga, sem cálculo objetivo, e **não é indicador de conclusão**.

### Entregas confirmadas na `main`

| PR | Integração confirmada | Portões registrados no head do PR |
|---|---|---|
| [#17](https://github.com/VictorVitorino/designersystemA-M/pull/17) | `8db837c` | CI, PostgreSQL 17, CodeQL, Chromium, Build Render Free |
| [#19](https://github.com/VictorVitorino/designersystemA-M/pull/19) | `16c60f8` | CI, PostgreSQL 17, CodeQL, Chromium |
| [#22](https://github.com/VictorVitorino/designersystemA-M/pull/22) | `7230196` | CI, PostgreSQL 17, CodeQL, Chromium |
| [#21](https://github.com/VictorVitorino/designersystemA-M/pull/21) | `c7d748d` | CI, PostgreSQL 17, CodeQL, Chromium |
| [#23](https://github.com/VictorVitorino/designersystemA-M/pull/23) | `6563100` | CI, PostgreSQL 17, CodeQL, Chromium e Build Render Free |

Essas verificações cobrem a implementação no repositório. **Não são prova de conexão real ao Render/Supabase** nem do uso do editor por dois computadores.

### PRs ainda pendentes

- [#4 — endpoints HTTPS](https://github.com/VictorVitorino/designersystemA-M/pull/4): a primeira versão teve CI cancelado após regressão na fixture de sessão. O commit corretivo `dbf802f` ajustou a fixture para endpoints HTTPS fictícios; só integrar se o conjunto final de CI, PostgreSQL, CodeQL e E2E terminar aprovado. Não considerar resultados de commits anteriores suficientes.
- [#16 — este relatório](https://github.com/VictorVitorino/designersystemA-M/pull/16): atualização de rastreabilidade e bloqueios de aceitação; não autoriza deploy.
- [#18](https://github.com/VictorVitorino/designersystemA-M/pull/18) e [#20](https://github.com/VictorVitorino/designersystemA-M/pull/20): encerrados como propostas sobrepostas ao #19; nenhum merge duplicado.

### Portões objetivos do piloto

| Etapa | Estado verificável | Evidência exigida para fechar |
|---|---|---|
| 1. Editor, backend, CI, segurança, E2E | Implementada com verificações históricas; **revalidar a main final** | CI, PostgreSQL 17, CodeQL, E2E da exata `main` de liberação |
| 2. Banco, autenticação, primeiro administrador | **Parcial** | Convite e login real, cadastro público desabilitado, Auth/recovery e bucket S3 demonstrados |
| 3. Render Free | **Pendente** | URL HTTPS real, `/api/health` e `/api/ready` retornando HTTP 200 |
| 4. Persistência entre computadores | **Pendente** | Criar, editar, salvar, sair e reabrir no segundo computador com texto e imagens íntegros |
| 5. Segurança, recuperação, regressões no piloto | **Pendente** | Isolamento entre contas, restauração, import/export e evidências de recuperação |
| 6. Liberação a convidados | **Pendente** | Critérios anteriores aprovados, operação básica documentada |

**Aceitação formal: 1/6.** Não aumentar progresso com base apenas na quantidade de PRs integrados. Não executar testes de carga sobre o projeto Free sem avaliação de quotas.

### Dependências externas

Implantação Render Free não comprovada; variáveis secretas em ambientes protegidos e configuração real do Supabase Auth/convite continuam necessárias. Até comprovação por URL real, não marcar o MVP como publicado ou homologado.
