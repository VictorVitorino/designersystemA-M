# Monitoramento, backup, segredos, proteção a abuso e LGPD: opções e recomendação para o MVP

Data de consulta de todos os itens: **2026-10-06**. Cenário: plataforma interna da Alvarez & Marsal (Brasil), cerca de 50 usuários (pico de 50 simultâneos), app estático + API serverless Node (Hono) na Vercel, Postgres no Supabase, objetos (imagens e arquivos) crescendo de 0 a 500 GB-1 TB, 2 ambientes (staging e produção). As referências entre colchetes, como [17], apontam para a lista numerada da seção "Fontes".

## 0. Como esta pesquisa foi feita e o que ela NÃO garante

Leia isto antes de usar qualquer número.

- A leitura direta das páginas oficiais (pricing, docs) **falhou neste ambiente**. O WebFetch devolveu `EGRESS_BLOCKED` para betterstack.com, uptimerobot.com, checklyhq.com, sentry.io, grafana.com, supabase.com, developers.cloudflare.com, backblaze.com e aws.amazon.com. O Firecrawl respondeu "Insufficient credits" (HTTP 402).
- Por isso os valores abaixo vêm de **buscas restritas ao domínio oficial de cada fornecedor** (parâmetro `allowed_domains`). Cada valor é um resumo do buscador sobre a página oficial citada, e não uma leitura integral da página. É a evidência mais próxima da fonte que consegui obter.
- Convenção de confiança nas tabelas:
  - **Confirmado (domínio oficial)**: o número apareceu no resumo de uma busca restrita ao domínio oficial, e a URL citada é a página oficial. É uma única leitura de resumo: a segunda leitura das páginas oficiais, feita em 2026-10-06, não foi possível (ver a última linha deste arquivo).
  - **A reconfirmar**: houve ambiguidade ou conflito entre resumos, ou o valor só apareceu em páginas comparativas do próprio fornecedor.
  - **Não confirmado**: não consegui um número confiável. Nenhum número foi inventado.
- Antes de contratar, abra a página oficial de cada fornecedor e confira o valor vigente no dia. Os preços mudam.
- **Câmbio: não confirmado.** Os resumos de busca para a PTAX de 2026-10-06 foram inconsistentes: 4,9692/4,9698, depois 4,9859 para 05/10 e 5,2238 para 02/10, e um deles tratou 6/10/2026 como domingo (é terça-feira). Não adotei nenhuma cotação como fato. As conversões em reais deste documento usam a **premissa de planejamento de R$ 5,00 por US$ 1,00**, apenas para ordem de grandeza. Substitua pela PTAX de venda do dia em [49] antes de orçar.

## 1. Resumo executivo

| Tema | Essencial no MVP | Pode esperar |
|---|---|---|
| Disponibilidade e alertas | UptimeRobot Free (50 monitores, 5 min; uso comercial do plano gratuito não confirmado) ou Better Stack Free (10 monitores, 3 min, 1 status page) | Better Stack pago (plantão com telefone/SMS), Checkly, Grafana Synthetic |
| Erros | Sentry Team, ou Developer (grátis, 1 usuário) enquanto houver 1 dev | Replays, tracing pago, cotas extras |
| Logs | Logs de auditoria no próprio Postgres + logs da Vercel (1 dia) e do Supabase (7 dias) | Log drain para Better Stack ou Grafana; Observability Plus |
| Backup do banco | Backup diário do Supabase (7 dias, incluso no Pro) + dump lógico diário criptografado para bucket externo + teste de restauração | PITR (US$ 100/mês para 7 dias) quando o RPO de 24 h deixar de servir |
| Backup de arquivos | Cópia dos objetos para um segundo provedor (R2 ou B2) | AWS Backup (não cobre o Postgres do Supabase) |
| Segredos | Variáveis da Vercel + secrets do GitHub Actions + cofre de senhas para administradores | Doppler, rotação automatizada |
| WAF e abuso | Vercel Firewall (regras e rate limit) + Turnstile nos formulários de login, convite e recuperação | Cloudflare Pro na frente (a Vercel desaconselha proxy), managed rulesets pagos |
| LGPD | DPAs, registro de operações, encarregado, plano de incidente (3 dias úteis), análise de transferência internacional | Certificações próprias, auditoria externa |

Custo operacional estimado do essencial, **sem contar** Supabase Pro e Vercel Pro (tratados em outro documento): cerca de **US$ 60 a US$ 67 por mês** com o cofre de senhas (R$ 299 a R$ 337 na premissa de R$ 5,00) e cerca de **US$ 35 a US$ 42** sem o cofre (R$ 174 a R$ 212); a soma original "35 a 67" misturava os dois casos. Detalhes na seção 9.

## 2. Monitoramento de disponibilidade e alertas

| Opção | Plano gratuito | Plano pago relevante | Confiança | Fonte |
|---|---|---|---|---|
| Better Stack Uptime | 10 monitores e heartbeats, 1 status page, alertas por e-mail e Slack, checagem de 3 min | A partir de US$ 29 por responder/mês no anual (US$ 34 no mensal), com telefone e SMS ilimitados; +US$ 25/mês por bloco de 50 monitores; status page extra US$ 12/mês | A reconfirmar (valores vistos em páginas do domínio betterstack.com, não confirmei na página /pricing) | [10] [11] |
| UptimeRobot | Free: 50 monitores, intervalo de 5 min, 1 status page; uso comercial **não confirmado** (a única fonte citada, [13], é um artigo sobre trabalho para clientes, não os termos nem a página de preços; o plano gratuito pode ser restrito a uso não comercial) | Solo "a partir de" 10 (moeda não confirmada, o resumo indicou euros), 60 s; Team "a partir de" 41; Enterprise sob consulta | A reconfirmar (moeda e valores) | [12] [13] |
| Checkly | Hobby grátis: 10 monitores de uptime, 2 min, limite rígido de 10 mil execuções de API e 1 mil de browser | Starter US$ 24/mês (50 monitores, 1 min); Team US$ 64/mês (75 monitores, 30 s) | Confirmado (domínio oficial) | [14] |
| Grafana Cloud Free | 10 mil séries ativas de métricas, 50 GB de logs, 50 GB de traces, 3 usuários ativos | Pro pago por uso (valores não confirmados) | A reconfirmar (os resumos divergiram: retenção de logs 14 ou 30 dias; métricas 14 dias ou 13 meses) | [15] [16] |

Leitura para o MVP:

- **Recomendado**: UptimeRobot Free para uptime externo (50 monitores cobrem produção e staging com folga) mais status page simples. Alternativa: Better Stack Free, que tem intervalo menor (3 min) mas apenas 10 monitores.
- Monitores mínimos: página inicial, `/api/health`, login, uma leitura autenticada sintética, endpoint de arquivos, expiração de certificado, e um heartbeat do job de backup (alerta se o dump diário não rodar).
- **Pode esperar**: alertas por telefone (Better Stack pago, US$ 29 por responder) e monitoramento sintético com navegador (Checkly). Para 50 usuários internos, e-mail e Slack/Teams costumam bastar.
- Observação: **não confirmado** que o plano gratuito do UptimeRobot permita uso comercial; [13] não foi reaberto e não é a página de termos nem a de preços. Se a A&M exigir uso comercial licenciado, use o Better Stack Free ou um plano pago. Confirme os termos vigentes antes de adotar.

## 3. Rastreio de erros (Sentry)

| Item | Valor | Confiança | Fonte |
|---|---|---|---|
| Developer | Grátis, 1 usuário, 5.000 erros/mês | Confirmado (domínio oficial) | [7] [8] |
| Team | US$ 26/mês no anual (US$ 29 no mensal), usuários ilimitados, cota base de 50 mil erros, 5 M de spans, 50 replays | Confirmado (domínio oficial) | [7] [8] |
| Business | US$ 80/mês (o resumo não diz se é no anual ou no mensal; para o Team há dois valores), dashboards ilimitados, gestão avançada de cotas | Confirmado (domínio oficial) para o valor; periodicidade não confirmada | [7] |
| Excedente de erros (Team) | Pay-as-you-go em faixas, de US$ 0,000150 a US$ 0,0003625 por evento | Não confirmado (o valor foi visto só em fonte secundária; a fonte oficial [7] listada não o sustenta de forma verificada) | sem fonte oficial |
| Retenção de erros | Developer 30 dias; Team e Business 90 dias | Confirmado (domínio oficial) | [9] |
| Teste gratuito | 14 dias para contas novas | Confirmado (domínio oficial) | [8] |

Leitura para o MVP: com 50 usuários internos, 50 mil erros/mês costumam sobrar, desde que haja amostragem e agrupamento. Use **Developer** enquanto só uma pessoa acompanhar os erros e migre para **Team (US$ 26)** quando houver mais de um desenvolvedor ou for preciso reter 90 dias. Configure limpeza de dados pessoais antes do envio (scrubbing), pois conteúdo de apresentações de clientes não deve ir para o Sentry. A região de armazenamento de dados do Sentry (EUA ou UE) **não foi confirmada nesta pesquisa**; veja a seção 8.

## 4. Logs

| Fonte de log | Retenção / custo | Confiança | Fonte |
|---|---|---|---|
| Vercel runtime logs (Pro) | 1 dia; 30 dias com Observability Plus | Confirmado (domínio oficial) | [27] [28] |
| Vercel Observability Plus | US$ 1,20 por 1 milhão de eventos, sem eventos inclusos; vem **ativado por padrão** para times criados ou migrados para Pro a partir de 2026-04-03 (confira a fatura) | Confirmado (domínio oficial) | [28] |
| Vercel Drains (log drain) | Disponível em Pro e Enterprise; US$ 0,50 por GB | Confirmado (domínio oficial) | [29] |
| Supabase (Pro) | 7 dias de retenção de logs | Confirmado (domínio oficial) | [2] [6] |
| Better Stack Logs (grátis) | 3 GB ingeridos/mês, retenção de 3 dias | A reconfirmar | [11] |
| Better Stack Logs (pago) | US$ 0,10/GB de ingestão + US$ 0,05/GB/mês de retenção | A reconfirmar | [11] |
| Grafana Cloud Free | 50 GB de logs/mês; retenção 14 ou 30 dias (divergente) | A reconfirmar | [15] [16] |

Leitura para o MVP: o **registro de auditoria (quem fez o quê, quando) deve ficar no próprio Postgres**, em tabela de acesso restrito, sem conteúdo sensível, com retenção definida por política. Isso independe de plano pago. Logs técnicos da Vercel e do Supabase bastam para depuração no início. Um log drain só vale a pena se a retenção de 1 dia (Vercel) atrapalhar investigações. Nesse caso, enviar ao Better Stack Free ou ao Grafana Free custa apenas o drain (US$ 0,50/GB). Não registre corpo de requisições, tokens, senhas nem conteúdo de apresentações.

## 5. Backup do banco e dos arquivos

### 5.1 Como funciona no Supabase

| Item | Valor | Confiança | Fonte |
|---|---|---|---|
| Backups diários | Pro: últimos 7 dias; Team: 14 dias; Enterprise: até 30 dias | Confirmado (domínio oficial) | [1] |
| PITR | Complemento pago em Pro, Team e Enterprise; granularidade de segundos; exige no mínimo compute **Small** | Confirmado (domínio oficial) | [1] |
| Preço do PITR | Aproximadamente US$ 100/mês (7 dias), US$ 200 (14 dias), US$ 400 (28 dias) | Confirmado (domínio oficial; a página usa "~") | [1] |
| PITR e backup diário | Com PITR ativo o Supabase **deixa de fazer o backup diário** (o PITR o substitui) | Confirmado (domínio oficial) | [3] |
| Restauração | Pelo Dashboard; o **projeto fica inacessível** durante a restauração, e o tempo cresce com o tamanho do banco | Confirmado (domínio oficial) | [1] |
| Restaurar em um novo projeto | Só em planos pagos e com backups físicos habilitados; útil para o **teste de restauração** sem tocar na produção | Confirmado (domínio oficial) | [3] |
| Objetos do Storage | **Os backups do banco NÃO incluem os objetos** enviados pela Storage API (o banco guarda só os metadados) | Confirmado (domínio oficial) | [1] |
| Custo de referência | Pro US$ 25 + compute Small US$ 15 - créditos de US$ 10 + PITR US$ 100 = cerca de US$ 130/mês por projeto | Calculado a partir de [2] [6] | [2] [6] |

Compute: Micro US$ 10, Small US$ 15, Medium US$ 60 por mês, segundo o resumo do domínio oficial [2]. Planos pagos incluem US$ 10/mês em créditos de compute [6].

### 5.2 Cópia externa: custo de manter 500 GB-1 TB

| Destino | Preço de armazenamento | Egresso e operações | Custo mensal (500 GB / 1 TB) | Confiança | Fonte |
|---|---|---|---|---|---|
| Cloudflare R2 Standard | US$ 0,015/GB-mês; 10 GB grátis | Egresso sem custo; Classe A US$ 4,50/milhão; Classe B US$ 0,36/milhão; grátis: 1 M Classe A e 10 M Classe B/mês | cerca de US$ 7,35 / US$ 14,85 | Confirmado (domínio oficial) | [17] |
| R2 Infrequent Access | US$ 0,01/GB-mês + US$ 0,01/GB de recuperação; sem franquia grátis | Classe A US$ 9,00/milhão; Classe B US$ 0,90/milhão | cerca de US$ 5 / US$ 10 (antes da recuperação) | Confirmado (domínio oficial) | [17] |
| Backblaze B2 | A partir de US$ 6,95 por TB/mês, sem taxa por tamanho mínimo ou duração mínima | Egresso grátis até 3x o armazenado; acima, US$ 0,01/GB; transações incluídas (detalhe por classe não confirmado) | cerca de US$ 3,48 / US$ 6,95 | Confirmado (domínio oficial); transações a reconfirmar | [19] |
| AWS S3 | S3 Standard a partir de US$ 0,023/GB-mês (primeiros 50 TB; valor genérico, **preço de São Paulo não confirmado**) | Egresso e requisições cobrados | Não confirmado para sa-east-1 | Parcial | [22] |
| AWS Backup | Cobre RDS, S3, DynamoDB, EFS e outros recursos AWS; há AWS Backup para S3 em São Paulo desde 2023-04. Preço de armazenamento "warm" **não confirmado** (apareceu US$ 0,05/GB-mês só como exemplo, sem confirmar a região) | | Não confirmado | Parcial | [20] [21] [23] |

Observações:

- O cálculo de 500 GB e 1 TB considera um único conjunto de objetos. Se mantiver versões antigas ou duas cópias, multiplique. Os custos de operação (milhões de requisições) são desprezíveis para este porte.
- **AWS Backup não protege o Postgres hospedado no Supabase**: ele atua sobre recursos da sua conta AWS (inferência a partir da lista de recursos suportados em [21]). Para o banco do Supabase, o caminho prático é `pg_dump` agendado (conforme o guia de dumps lógicos do Supabase [50]) gravado em bucket externo.
- Como os objetos são endereçados por conteúdo (imutáveis), o risco de sobrescrita é baixo. O risco que resta é exclusão acidental ou maliciosa: mantenha a cópia externa em outro provedor, com credenciais separadas e sem permissão de exclusão para o job de backup. Recursos de trava de objeto e versionamento de cada provedor **não foram verificados** aqui.
- Rotina sugerida (sem custo extra de ferramenta): job agendado no GitHub Actions faz o dump do Postgres, criptografa e envia ao bucket externo, e envia um heartbeat ao monitor de uptime. Um job diário de 5 minutos consome cerca de 150 minutos/mês (estimativa), contra 2.000 (Free) ou 3.000 (Team) minutos inclusos em repositórios privados [39].
- **Teste de restauração**: ao menos uma vez por mês, restaurar o último backup em um novo projeto do Supabase [3] e o último dump em um Postgres local; conferir contagem de apresentações, versões e arquivos referenciados. Registrar data, duração e resultado.

## 6. Gestão de segredos

| Opção | Limites e custo | Confiança | Fonte |
|---|---|---|---|
| Variáveis de ambiente da Vercel | Criptografadas em repouso; total de 64 KB por deployment (5 KB por variável no runtime edge); até 1.000 variáveis por ambiente por projeto; tipo "sensitive" com proteção adicional; sem custo extra | Confirmado (domínio oficial) | [26] |
| GitHub Actions secrets | Até 48 KB por secret; 100 por repositório, 100 por ambiente, 1.000 por organização; secrets de **ambiente** com aprovação ajudam a separar staging de produção | Confirmado (domínio oficial) | [38] |
| 1Password | Teams Starter Pack: US$ 2,49/usuário/mês no anual, mínimo de US$ 24,95/mês para até 10 usuários (2,49 x 10 = 24,90, e não 24,95: arredondamento não explicado); Business: US$ 8,99/usuário/mês no anual | Não confirmado (a fonte [40] é a página Business e não sustenta o preço do Starter Pack; valores não reconferidos) | [40] |
| Doppler | Developer grátis para 3 usuários (+US$ 8 por usuário extra); Team US$ 21/usuário/mês (SAML SSO, RBAC, 90 dias de log de atividade) | A reconfirmar | [41] |

Leitura para o MVP: **essencial** é manter segredos fora do frontend, usar variáveis separadas por ambiente na Vercel, secrets de ambiente no GitHub e **nunca** reutilizar a mesma chave entre staging e produção. A chave de serviço do Supabase, o segredo de sessão e as credenciais do bucket só existem no servidor. Um cofre de senhas (1Password Teams Starter, cerca de US$ 25/mês) para 2 a 3 administradores guarda credenciais de contas dos fornecedores, códigos de recuperação e a cópia de emergência dos segredos. **Pode esperar**: Doppler e rotação automatizada. Defina um procedimento de rotação manual e documente o responsável por cada segredo.

## 7. WAF e proteção a abuso

| Opção | O que oferece | Custo | Confiança | Fonte |
|---|---|---|---|---|
| Vercel Firewall (regras personalizadas, bloqueio de IP, mitigação de DDoS) | Disponível em todos os planos; Hobby 3 regras, **Pro até 40**, Enterprise 1.000; ações log, deny, challenge, bypass, rate limit; aplicado sem novo deploy | Sem custo | Confirmado (domínio oficial) | [30] [31] |
| Vercel WAF Rate Limiting | Pro: 1.000.000 de requisições permitidas inclusas por mês; 40 regras por projeto; janela de 10 s a 10 min; chaves IP e JA4 | US$ 0,50 por milhão acima da franquia | Confirmado (domínio oficial) | [30] |
| Vercel managed rulesets (OWASP CRS) | Conjuntos gerenciados | US$ 0,80 por milhão de requisições inspecionadas + US$ 0,20 por GB; **disponibilidade no plano Pro não confirmada** | A reconfirmar | [30] |
| Cloudflare Free | Free Managed Ruleset e 1 regra de rate limit | US$ 0 | A reconfirmar (contagem de regras) | [42] [43] [44] |
| Cloudflare Pro | Todos os managed rules; 2 regras de rate limit | US$ 20/mês no anual ou US$ 25/mês no mensal | Confirmado (preço); regras a reconfirmar | [42] [44] |
| Cloudflare Business | 5 regras de rate limit | US$ 250/mês (não confirmado se é no mensal ou no anual; para o Pro há dois valores) | Confirmado (domínio oficial) para as 5 regras; periodicidade do preço não confirmada | [42] |
| Cloudflare Turnstile Free | Desafios ilimitados, até 20 widgets por conta, 10 hostnames por widget, análise de 7 dias | Grátis | Confirmado (domínio oficial) | [45] |

Leitura para o MVP:

- **Não ponha o Cloudflare em modo proxy na frente da Vercel.** A própria Vercel não recomenda: o proxy reduz a visibilidade de tráfego do Vercel Firewall, acrescenta latência e complica certificados e cache; se quiser Cloudflare só para DNS, use "DNS only" (nuvem cinza) [32] [33].
- **Essencial**: Vercel Firewall com regras de rate limit para `/login`, `/convite`, `/recuperar-senha`, `/api/auth/*` e uploads; **Turnstile** nos formulários públicos (login, aceite de convite, recuperação). Complementar com bloqueio por tentativas no próprio backend (contador por conta e por IP, com atraso progressivo).
- **Pode esperar**: Cloudflare Pro e managed rulesets pagos. O Cloudflare só faria sentido na frente do **domínio dos arquivos** (por exemplo, `arquivos.suaempresa.com` apontando para o R2), onde não há a restrição da Vercel; isso é uma decisão de arquitetura, não um requisito desta pesquisa.

## 8. Conformidade e LGPD para dados de consultoria

### 8.1 Normas aplicáveis (todas oficiais)

| Norma | Ponto relevante | Fonte |
|---|---|---|
| Lei 13.709/2018 (LGPD) | Art. 33: transferência internacional só nas hipóteses previstas; art. 39: o operador trata os dados segundo as instruções do controlador; art. 46: medidas de segurança técnicas e administrativas; art. 48: o controlador comunica a ANPD e o titular sobre incidente de risco ou dano relevante | [46] |
| Resolução CD/ANPD nº 19/2024 (23/08/2024) | Regulamento de transferência internacional: cláusulas-padrão contratuais (texto do Anexo II, adotado integralmente), cláusulas equivalentes, cláusulas específicas, normas corporativas globais e decisões de adequação; prazo de 12 meses para incorporar as cláusulas-padrão aos contratos (já vencido em agosto de 2025) | [47] |
| Resolução CD/ANPD nº 15/2024 (data de 26/04/2024 não confirmada: pode ser a da publicação no DOU e não a da resolução) | Regulamento de comunicação de incidente de segurança: prazo de **três dias úteis** para o controlador comunicar a ANPD e os titulares, contado do conhecimento de que o incidente afetou dados pessoais | [48] |

Aplicação: a LGPD protege dados **pessoais** (nomes, e-mails, logs de acesso dos usuários, e dados pessoais que apareçam dentro das apresentações, como nomes de funcionários de clientes). O sigilo de informações de clientes (cláusulas de confidencialidade) é um dever contratual separado e normalmente mais rígido. Trate ambos. Esta seção é um mapa técnico e não substitui parecer jurídico.

### 8.2 Localização dos dados e contratos dos fornecedores

| Componente | Localização / contrato | Confiança | Fonte |
|---|---|---|---|
| Supabase (banco, Auth, Storage) | Região **São Paulo (sa-east-1)** disponível; Postgres, Auth e objetos do Storage ficam na região escolhida | Confirmado (domínio oficial) | [4] |
| Supabase (certificações) | SOC 2 Tipo 2; **o relatório SOC 2 só é fornecido a clientes Team e Enterprise**; DPA disponível. ISO 27001: **não confirmado** (a fonte [5] é a página de SOC 2 e não é prova de ISO 27001) | Confirmado (domínio oficial) para SOC 2; ISO 27001 não confirmado | [5] |
| Vercel (funções) | Região padrão `iad1` (Washington, EUA); pode ser configurada para `gru1` (São Paulo); preços da região gru1 existem apenas no Pro | Confirmado (domínio oficial) | [34] [35] |
| Vercel (arquivos estáticos) | Servidos pela rede de borda global; **não é possível garantir que fiquem só no Brasil** (inferência) | Inferência | [34] |
| Vercel (contrato) | DPA com subprocessadores; SOC 2 Tipo 2 (segurança, confidencialidade, disponibilidade); ISO 27001:2022; transferências com Cláusulas Contratuais Padrão da UE e adendo do Reino Unido | Confirmado (domínio oficial) | [36] [37] |
| Cloudflare R2 | Dicas de localização: wnam, enam, weur, eeur; jurisdições: eu, fedramp, us. **Sem opção de Brasil / América do Sul** (inferência pela ausência na lista e pela recomendação "enam" para clientes de São Paulo). A lista de dicas e de jurisdições vem de um resumo de busca e **não foi reconferida**: pode estar incompleta ou imprecisa, e a conclusão "sem Brasil" depende dela | Inferência; lista de locais não confirmada | [18] |
| Backblaze B2 | Regiões e contrato **não verificados** nesta pesquisa | Não confirmado | [19] |
| Sentry | Região de dados e DPA **não verificados** nesta pesquisa | Não confirmado | [7] |

Consequência prática:

- **Dados no Brasil**: mantenha banco e objetos principais no Supabase sa-east-1 e as funções da Vercel em `gru1`. Se os objetos ficarem no R2, eles ficam fora do Brasil, o que configura transferência internacional (LGPD art. 33; Res. 19/2024 [47]) e pode conflitar com cláusulas de clientes que exijam dados no país.
- **Cópia de backup**: se a política da A&M ou de algum cliente exigir residência no Brasil, a cópia externa deve ficar em bucket S3 em São Paulo (existe AWS Backup para S3 em sa-east-1 [23]; custo não confirmado). Se a residência no Brasil não for exigida, R2 ou B2 são bem mais baratos, desde que haja cláusulas-padrão ou outra base legal e criptografia do lado do cliente antes do envio (o fornecedor guarda somente dados cifrados).
- Chaves de criptografia do backup ficam com a A&M (cofre de senhas), nunca no mesmo provedor da cópia.

### 8.3 Checklist LGPD enxuto para o MVP

| Item | Essencial no MVP? |
|---|---|
| Definir controlador (A&M) e operadores (Supabase, Vercel, Sentry, Cloudflare, provedor de e-mail, provedor de backup) e assinar/aceitar os DPAs de cada um | Sim |
| Registro das operações de tratamento (quais dados pessoais, finalidade, base legal, retenção) | Sim |
| Indicar o encarregado (DPO) e um canal para os titulares | Sim |
| Plano de resposta a incidentes com prazo de 3 dias úteis [48] e responsável nomeado | Sim |
| Análise de transferência internacional por componente (tabela 8.2) e escolha do mecanismo [47] | Sim |
| Minimização: não enviar conteúdo de apresentações a Sentry, logs ou e-mails; logs de auditoria sem dados sensíveis | Sim |
| Política de retenção e exclusão (usuário desligado, apresentação excluída, versões antigas) | Sim, em versão simples |
| Relatório SOC 2 do Supabase (exige plano Team, US$ 599/mês segundo [2]) | Somente se a segurança da informação da A&M exigir; avaliar com ela |
| Avaliação de impacto (RIPD) e auditoria externa | Pode esperar, salvo exigência do jurídico |

## 9. Custo mensal estimado do essencial (premissa R$ 5,00 por US$ 1,00)

| Item | US$/mês | R$/mês (premissa) | Observação |
|---|---|---|---|
| Uptime (UptimeRobot Free ou Better Stack Free) | 0 | 0 | |
| Sentry Team (anual) | 26 | 130 | Developer = 0 enquanto houver 1 usuário |
| Cópia externa dos arquivos, 500 GB a 1 TB (R2) | 7,35 a 14,85 | 37 a 74 | B2 sai por 3,48 a 6,95 |
| Log drain da Vercel (se usado, ~3 GB/mês) | cerca de 1,50 | cerca de 8 | Estimativa; opcional |
| Cofre de senhas (1Password Teams Starter) | 24,95 | 125 | Não confirmado (ver seção 6); opcional mas recomendado |
| Vercel Firewall, Turnstile, GitHub Actions, variáveis de ambiente | 0 | 0 | Rate limit passa de 1 M de requisições/mês a US$ 0,50/M |
| **Total do essencial, com cofre de senhas** (soma das linhas acima: 26 + 7,35 a 14,85 + 1,50 + 24,95) | **cerca de 60 a 67** | **cerca de 299 a 337** | Sem Supabase Pro (US$ 25) e Vercel Pro (US$ 20) |
| **Total sem o cofre de senhas** (26 + 7,35 a 14,85 + 1,50) | **cerca de 35 a 42** | **cerca de 174 a 212** | Com Sentry Developer (US$ 0) subtraia US$ 26 (R$ 130) |

Itens que podem esperar e seus preços de referência: PITR US$ 100/mês (7 dias) [1]; Better Stack pago US$ 29 por responder [10]; Checkly Starter US$ 24 [14]; Cloudflare Pro US$ 20-25 [42]; Observability Plus US$ 1,20 por milhão de eventos [28]; Supabase Team US$ 599 [2]; Doppler Team US$ 21 por usuário [41].

## 10. Recomendação final

1. **Agora (MVP)**: UptimeRobot Free (ou Better Stack Free) com heartbeat do backup; Sentry Developer ou Team; backup diário nativo do Supabase + dump lógico criptografado diário para R2 ou B2 (ou S3 São Paulo se houver exigência de residência) + cópia dos objetos para o segundo provedor; teste de restauração mensal; segredos em variáveis da Vercel e secrets de ambiente do GitHub; Vercel Firewall com rate limit + Turnstile nos formulários públicos; checklist LGPD da seção 8.3.
2. **Depois de estabilizar (primeiros 1 a 3 meses)**: PITR se o RPO de 24 h for insuficiente, log drain com retenção maior, alertas por telefone para o plantão, cofre de segredos dedicado.
3. **Decisões que dependem da A&M**: exigência de residência de dados no Brasil; necessidade do relatório SOC 2 do Supabase (plano Team); fornecedores já homologados pela segurança da informação; política de retenção; quem é o encarregado.

## 11. Lacunas que ficaram abertas

- Leitura direta das páginas de preço e documentação não foi possível (bloqueio de rede e créditos esgotados no Firecrawl); todos os valores devem ser reconferidos nas páginas oficiais antes de contratar.
- Câmbio USD/BRL de 2026-10-06 não confirmado; usar a PTAX oficial [49].
- Sem confirmação: preço de S3 e AWS Backup em São Paulo; regiões e contrato do Backblaze B2; região de dados e DPA do Sentry; moeda e valores do UptimeRobot; retenção exata do Grafana Cloud Free; disponibilidade de managed rulesets da Vercel no plano Pro; preços do Better Stack na página /pricing; uso comercial do plano gratuito do UptimeRobot; ISO 27001 do Supabase; periodicidade (anual ou mensal) dos preços Sentry Business e Cloudflare Business; preço do 1Password Teams Starter Pack; preço de excedente de erros do Sentry; lista de dicas de localização e jurisdições do R2; data da Resolução CD/ANPD nº 15/2024.

## Fontes

Todas consultadas em 2026-10-06 (resumos de busca restritos ao domínio oficial, salvo indicação em contrário na seção 0).

1. https://supabase.com/docs/guides/platform/backups
2. https://supabase.com/pricing
3. https://supabase.com/docs/guides/platform/clone-project
4. https://supabase.com/docs/guides/platform/regions
5. https://supabase.com/docs/guides/security/soc-2-compliance
6. https://supabase.com/docs/guides/platform/billing-on-supabase
7. https://sentry.io/pricing/
8. https://docs.sentry.io/pricing/
9. https://docs.sentry.io/security-legal-pii/security/data-retention-periods/
10. https://betterstack.com/uptime
11. https://betterstack.com/community/comparisons/better-stack-vs-uptime-com/
12. https://uptimerobot.com/pricing/
13. https://uptimerobot.com/knowledge-hub/monitoring/uptimerobot-for-client-work/
14. https://www.checklyhq.com/pricing/
15. https://grafana.com/pricing/
16. https://grafana.com/docs/grafana-cloud/platform/pricing-and-usage/usage-limits/
17. https://developers.cloudflare.com/r2/pricing/
18. https://developers.cloudflare.com/r2/reference/data-location/
19. https://www.backblaze.com/cloud-storage/pricing
20. https://aws.amazon.com/backup/pricing/
21. https://docs.aws.amazon.com/aws-backup/latest/devguide/backup-feature-availability.html
22. https://aws.amazon.com/s3/pricing/
23. https://aws.amazon.com/about-aws/whats-new/2023/04/aws-backup-s3-sao-paulo-region/
24. https://vercel.com/pricing
25. https://vercel.com/docs/plans/pro-plan
26. https://vercel.com/docs/environment-variables
27. https://vercel.com/docs/logs/runtime
28. https://vercel.com/docs/observability/observability-plus
29. https://vercel.com/docs/drains
30. https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing
31. https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
32. https://vercel.com/kb/guide/cloudflare-with-vercel
33. https://vercel.com/docs/security/reverse-proxy
34. https://vercel.com/docs/regions
35. https://vercel.com/docs/pricing/regional-pricing/gru1
36. https://vercel.com/legal/dpa
37. https://vercel.com/docs/security/compliance
38. https://docs.github.com/en/actions/reference/security/secrets
39. https://docs.github.com/get-started/learning-about-github/githubs-products
40. https://1password.com/pricing/business
41. https://www.doppler.com/pricing
42. https://www.cloudflare.com/plans/
43. https://developers.cloudflare.com/waf/
44. https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/
45. https://developers.cloudflare.com/turnstile/plans/
46. https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
47. https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024
48. https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca
49. https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios
50. https://supabase.com/docs/guides/troubleshooting/download-logical-backups

Segunda leitura das páginas oficiais em 2026-10-06 NÃO realizada: WebFetch devolveu EGRESS_BLOCKED em supabase.com, vercel.com, docs.github.com, www.cloudflare.com, www.planalto.gov.br, www.gov.br, 1password.com, www.doppler.com, docs.sentry.io, dadosabertos.bcb.gov.br e aws.amazon.com; o Firecrawl respondeu sem créditos; o limite de buscas da sessão se esgotou. Foram corrigidos apenas erros verificáveis no próprio texto (somas, rótulos sem fonte ou inconsistentes); os itens marcados 'não confirmado' ficaram sem prova e os demais valores seguem como na primeira leitura (resumos de busca), sem segunda prova.
