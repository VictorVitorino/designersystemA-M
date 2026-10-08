# Painel do MVP gratuito — Canteiro / AM Studio

**Data de referência:** 08/10/2026, atualização após retomada do desenvolvimento · **Objetivo:** piloto com poucos usuários e infraestrutura sem mensalidade, antes da comercialização.

> **Estimativa de desenvolvimento técnico: cerca de 85%** (avaliação gerencial, não medição por tarefas). Não significa que 85% das etapas de publicação tenham passado. **Homologação online: ainda não concluída.**

## Indicadores verificáveis

| Indicador | Estado | Evidência |
|---|---|---|
| CI principal (unit, banco, API e segurança) | ✅ verde na branch de correção | [Execução 37810876674](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37810876674) |
| CI de Postgres 17 do Supabase | ✅ aprovado no PR | [Checks do commit](https://github.com/VictorVitorino/designersystemA-M/commit/b5069cb6e5417c4972a42f9642942c7856714c52/checks) |
| Testes de navegador/editor em nuvem | ✅ 171/171 na última execução concluída | [E2E 37813301730](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37813301730): CL-88 corrigido; browser e cloud passaram. A execução geral falhou em etapa posterior de preparação do PostgreSQL |
| Banco persistente do MVP | ⏳ não homologado | Concluir configuração e testar gravação e leitura em um projeto exclusivo do Canteiro |
| Hospedagem online gratuita | ⏳ não homologada | Publicar e validar a URL, API e cabeçalhos de segurança |
| Acesso por segundo computador | ⏳ não homologado | Teste real com usuário A, reabertura da mesma apresentação em outro navegador |
| Primeira liberação do MVP | ⏳ bloqueada | Depende da aprovação de todos os critérios acima |

## Passo a passo / portões de aceite

| Passo | Objetivo | Status | Critério para marcar concluído |
|---|---|---|---|
| **1. Estabilizar os testes** | Corrigir segurança, navegador e infraestrutura de testes E2E | 🔄 em andamento | CI **e** E2E completo sem falhas no PR; revisar e integrar na main |
| **2. Banco gratuito** | Criar ambiente Canteiro separado no Supabase Free | ⏳ a fazer | Migrações, login e armazenamento testados em banco persistente |
| **3. Colocar na internet** | Escolher hospedagem gratuita adequada ao uso de piloto | ⏳ a fazer | Site, API e HTTPS acessíveis; CI/deploy configurados; sem segredos expostos |
| **4. Testar experiência principal** | Login → criar → editar → salvar → abrir em outro computador → exportar | ⏳ a fazer | Roteiro completo documentado, sem perda de dados |
| **5. Validar piloto** | Testar poucos usuários e segurança, limites e restauração | ⏳ a fazer | Testes reais com diferentes contas; nenhuma falha bloqueadora |
| **6. Liberar MVP** | Entregar endereço e instruções de uso ao grupo piloto | ⏳ a fazer | Critérios anteriores aprovados, acesso monitorado e responsáveis definidos |

## Registro de desenvolvimento — 08/10/2026

- ✅ Corrigido o falso positivo de dependências de desenvolvimento. CI principal do PR passou [37813301901](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37813301901); Postgres 17 também aprovado.
- ✅ Corrigidos os avisos de CSP esperados pelo Chromium nos testes visuais: **171/171** no [E2E 37813301730](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37813301730).
- 🔧 Diagnosticado outro bloqueio no teste E2E real: `su postgres` não funciona no runner, porque o PostgreSQL já roda como serviço em contêiner no Actions. Adicionado `tools/external-test-db.js`, com conexão **somente loopback**, banco **somente `canteiro_t_*`**, reset isolado; `dev.js` mantém o modo local normal e usa o modo externo apenas com `E2E_EXTERNAL_POSTGRES=1`.
- 🔄 [Nova bateria de CI](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37842681961) e [E2E](https://github.com/VictorVitorino/designersystemA-M/actions/runs/37842681964) iniciadas. **Resultados ainda não verificados nesta atualização**.
- ✅ Consultada a organização Supabase conectada: plano gratuito; o único projeto listado é `Portfolio FE DEV` (inativo), sem projeto Canteiro criado. O banco de MVP **não** foi criado nem alterado.
- ⚠️ Não houve merge, publicação, criação de projeto pago nem alterações em `studio/`.

**Portões concluídos:** 0 de 6. **Passo atual:** 1 de 6.

## Critérios de custo zero

- Privilegiar planos gratuitos compatíveis com o perfil e termos de uso do piloto, conferidos antes do cadastro.
- Não inserir cartão ou contratar plano sem decisão explícita.
- Recursos enterprise, e-mail com domínio próprio, alta capacidade e disponibilização comercial ficam fora do escopo do piloto.
- Não confundir o ambiente local ou testes automatizados com validação no serviço real.

## Regra de atualização deste painel

Atualizar este arquivo em cada etapa significativa: data, status, link da execução/prova, falhas ainda abertas e próximo passo. **Nunca** marcar um passo como concluído apenas porque o código existe ou a documentação diz que passou. Uma execução de CI com falha bloqueia o passo 1, mesmo que outros checks estejam verdes.
