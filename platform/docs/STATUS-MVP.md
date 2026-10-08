# Status do MVP gratuito — Canteiro / AM Studio

**Referência:** 08/10/2026. **Objetivo:** piloto pequeno, em serviços gratuitos, sem alterar o editor standalone.

> **Maturidade técnica estimada: cerca de 85%** — leitura gerencial, **não** medição objetiva por tarefas. **Etapas de aceitação concluídas: 1/6**. O MVP ainda não está publicado em hospedagem real.

## Indicadores com evidências

| Indicador | Estado | Prova |
|---|---|---|
| Código principal do editor/plataforma | ✅ implementado | Repositório GitHub |
| Testes de aplicação, segurança e PostgreSQL 17 | ✅ aprovados na main | [CI da main 37856550986](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37856550986) |
| Testes completos de navegador / E2E | ✅ aprovados na main | [E2E da main 37856550988](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37856550988) |
| PR #2: infraestrutura gratuita Render + Supabase | ✅ integrado na main | [PR #2](https://github.com/VictorVitorino/designersystemA-M/pull/2) com CI e E2E aprovados |
| PR #5: convite seguro de administrador + correção de Esc | 🔄 teste E2E/CI em nova execução | [PR #5](https://github.com/VictorVitorino/designersystemA-M/pull/5) |
| Banco Supabase dedicado Canteiro | ⏳ não criado | Consulta da organização Free em 08/10/2026: apenas projeto **Portfolio FE DEV** (não usar para este MVP) |
| Render Free publicado | ⏳ não configurado | A infraestrutura está preparada, mas sem implantação real |
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
- Implementados fluxo manual seguro e testes do convite do primeiro administrador ([PR #5](https://github.com/VictorVitorino/designersystemA-M/pull/5)).

## Limites e proteção de custo

- Não criar projetos ou consumir planos pagos sem verificar os limites gratuitos e obter autorização explícita quando houver custos.
- Não reutilizar o banco **Portfolio FE DEV** em nenhuma hipótese.
- Não cadastrar dados confidenciais reais antes de revisar acesso e privacidade, sobretudo enquanto o repositório permanecer público.
- CI verde não equivale a hospedagem real em produção: os passos 2–6 dependem de validações adicionais.
- Nunca alterar `studio/` para implementar plataforma/infraestrutura.

**Regra de atualização:** só mudar status de uma etapa com evidência reproduzível e verificada; indicar links dos testes e da implantação. O percentual de 85% é estimativo e não deve ser aumentado automaticamente ao criar documentação ou infraestrutura.
