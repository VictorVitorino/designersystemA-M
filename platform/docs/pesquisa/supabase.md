# Pesquisa: Supabase (planos Pro e Team) para a plataforma de apresentações

Data da consulta: 2026-10-06. Moeda de referência: USD. Os números entre colchetes, como [3], remetem à seção "Fontes" no fim do arquivo.

## 0. Como esta pesquisa foi feita (leia antes dos números)

| Item | Situação |
|---|---|
| Páginas renderizadas de supabase.com (pricing, docs, status, trust) | Não abertas. O proxy de saída do ambiente bloqueou supabase.com, status.supabase.com e trust.supabase.com (erro EGRESS_BLOCKED). O Firecrawl estava sem créditos. |
| Fonte efetivamente lida | Os arquivos-fonte que geram essas páginas, no repositório oficial github.com/supabase/supabase (branch `master`), baixados de raw.githubusercontent.com em 2026-10-06. Cada fonte em "Fontes" traz a URL pública oficial e o arquivo lido. |
| Risco | O `master` pode estar à frente ou atrás do site publicado. Antes de contratar, confirme os valores em https://supabase.com/pricing. |
| Itens marcados "(via busca)" | Vieram de resumo de resultado de busca na web, sem abrir a página. Tratar como indício. |
| Cotação BRL | Não confirmada. O Banco Central (olinda.bcb.gov.br) estava bloqueado e a busca só devolveu um valor sem página primária. Não uso cotação neste arquivo. Converter no relatório consolidado com a PTAX oficial. |

## 1. Resumo para decisão

| Pergunta | Resposta curta |
|---|---|
| Qual plano para o MVP de ~50 usuários? | Pro (USD 25/mês por organização) [1][2]. O Team (USD 599/mês) só se a A&M exigir relatório SOC 2/ISO, SLA de suporte, audit logs da plataforma ou papéis por projeto [1][2][40][49]. |
| Dá para ter staging e produção? | Sim: dois projetos na mesma organização Pro, ou uma branch persistente. Custo extra de staging em Micro: cerca de USD 9,81/mês [3][5][44][45]. |
| Computação inicial | Produção em Small (USD 0,0206/h, cerca de USD 15/mês) e staging em Micro. Os USD 10 de crédito cobrem só parte da computação [3][5]. |
| Arquivos de 500 GB a 1 TB | Cabem no Storage do Supabase (limite de arquivo 500 GB, S3 compatível, Smart CDN). Custo de armazenamento: cerca de USD 8,52 (500 GB) a USD 19,17 (1 TB) por mês acima dos 100 GB inclusos (cálculo derivado) [1][7]. |
| SSO SAML (Entra ID) | Disponível a partir do Pro: 50 usuários SSO inclusos, depois USD 0,015 por usuário/mês [1][9][29]. Atenção: contas SAML não se vinculam a contas e-mail/senha existentes [29][30]. |
| Maior risco operacional | O backup do Supabase não cobre os objetos do Storage, e o Storage não tem versionamento S3 [10][22]. É preciso um backup independente dos arquivos. |

## 2. Planos e preço base

| Item | Pro | Team | Fonte |
|---|---|---|---|
| Preço base (por organização) | USD 25/mês ("From") | USD 599/mês ("From") | [2] |
| Projeto incluso | Um projeto em computação Micro | Um projeto em computação Micro | [2] |
| Créditos de computação | USD 10/mês, reiniciam todo mês e não acumulam; cobrem um projeto Micro ou parte de tamanhos maiores | Igual (planos pagos) | [5] |
| Disco do banco incluso | 8 GB por projeto; depois USD 0,125/GB | Igual | [1][53] |
| Armazenamento de arquivos | 100 GB; depois USD 0,0213/GB | Igual | [1][7] |
| Egress (tráfego de saída) | 250 GB; depois USD 0,09/GB | Igual | [1] |
| Egress em cache (CDN) | 250 GB; depois USD 0,03/GB | Igual | [1] |
| MAU (usuários ativos no mês) | 100.000; depois USD 0,00325/MAU | Igual | [1] |
| Backups diários | 7 dias | 14 dias | [1][10] |
| Retenção de logs (API e banco) | 7 dias | 28 dias | [1] |
| Suporte | E-mail, sem SLA | E-mail prioritário com SLA | [1][2] |
| SOC 2 e ISO 27001 | Não listados | Listados | [1][2] |
| Audit logs da plataforma | Não | Sim | [1][40] |
| Spend cap (teto de gasto) | Disponível | Documentado como disponível só no Pro | [6] |
| Papéis | Owner, Admin, Developer | Inclui Read-only e papéis por projeto | [1][49] |

Pagamento: somente cartão de crédito (alternativas para pré-pagamentos maiores via ticket de suporte); faturas emitidas em USD; sem reembolso no meio de pagamento; rebaixar de plano gera crédito pelo tempo não usado [47][48]. Fatura vencida faz o Supabase pausar os projetos e rebaixar a organização para Free [47].

## 3. Computação e conexões

### 3.1 Tamanhos de instância (cobrança por hora, hora parcial conta inteira)

| Tamanho | USD/hora | USD/mês (docs) | CPU | RAM | Banco recomendado (máx.) | Conexões diretas máx. | Clientes do pooler máx. |
|---|---|---|---|---|---|---|---|
| Nano (só Free) | 0 | 0 | Compartilhada | até 0,5 GB | 500 MB | 60 | 200 |
| Micro | 0,01344 | ~10 | Compartilhada | 1 GB | 10 GB | 60 | 200 |
| Small | 0,0206 | ~15 | Compartilhada | 2 GB | 50 GB | 90 | 400 |
| Medium | 0,0822 | ~60 | Compartilhada | 4 GB | 100 GB | 120 | 600 |
| Large | 0,1517 | ~110 | Dedicada, 2 vCPU | 8 GB | 200 GB | 160 | 800 |
| XL | 0,2877 | ~210 | Dedicada, 4 vCPU | 16 GB | 500 GB | 240 | 1.000 |
| 2XL | 0,562 | ~410 | Dedicada, 8 vCPU | 32 GB | 1 TB | 380 | 1.500 |

Fonte: [3]. Tamanhos 4XL a 16XL também existem (de USD 1,32/h a USD 5,12/h) [3]. A página de uso de computação mostra Large como ~USD 111 e a de infraestrutura como ~USD 110; diferença irrelevante [3][5].

Regras úteis:
- Planos pagos não criam Nano; o mínimo é Micro [3][5].
- Troca de tamanho costuma ter menos de 2 minutos de indisponibilidade, mas pode demorar mais [3].
- Computação não é coberta pelo spend cap [5][6].
- Créditos de USD 10 valem só para computação, não para branches nem réplicas de leitura [5].
- Disco: gp3 por padrão (3.000 IOPS e 125 MB/s inclusos); aumentar IOPS ou vazão exige Large ou maior e custa à parte; o disco só cresce, não diminui, com espera de cerca de 4 horas entre mudanças [3].

### 3.2 Conexão direta e pooler (Supavisor)

| Modo | Endereço e porta | IP | Quando usar | Fonte |
|---|---|---|---|---|
| Direta | `db.[ref].supabase.co:5432` | IPv6; IPv4 só com add-on | Backend persistente, migrações | [16] |
| Pooler compartilhado, modo sessão (Supavisor) | `aws-[n]-[região].pooler.supabase.com:5432` | IPv4 | Rede só IPv4, ferramentas de BI | [16] |
| Pooler compartilhado, modo transação (Supavisor) | mesmo host, porta `6543` | IPv4 | Funções serverless/edge (muitas conexões curtas) | [16] |
| Pooler dedicado (PgBouncer), só planos pagos | `db.[ref].supabase.co:6543` | IPv6; IPv4 só com add-on | Alta performance; roda na mesma máquina do banco e consome computação | [16][17] |

- O modo transação não suporta prepared statements, cursores `with hold`, estado de sessão nem pipelining; é preciso desligar prepared statements no driver [16].
- O pooler compartilhado é IPv4 em todos os planos [16][17].
- Add-on IPv4: USD 0,0055/hora (USD 4/mês) por projeto; troca o registro IPv6 por IPv4 [19].
- Tamanho do pool: regra do Supabase é não passar de 40% das conexões máximas se usar muito PostgREST e, caso contrário, até 80% [18]. Para Micro (60 conexões), isso dá 24 ou 48 (cálculo derivado). O tamanho padrão do pool não foi confirmado.
- Para 50 usuários simultâneos com API serverless Node, o modo transação (porta 6543) cabe nos 200 clientes do Micro (inferência a partir dos limites acima) [3][16].

## 4. Banco: disco, backups e recuperação

### 4.1 Disco

| Item | Valor | Fonte |
|---|---|---|
| gp3: incluso | 8 GB; depois USD 0,125/GB/mês | [3][53] |
| gp3: IOPS e vazão extras | 3.000 IOPS inclusos, depois USD 0,024/IOPS; 125 MB/s inclusos, depois USD 0,95 por MB/s | [3] |
| io2 (alta performance) | USD 0,195/GB desde o primeiro byte; USD 0,119/IOPS | [3][53] |
| Tamanho máximo | gp3 64 TB; io2 60 TB | [3] |

### 4.2 Backups e PITR

| Plano | Backups diários | PITR (add-on) | Fonte |
|---|---|---|---|
| Free | Nenhum (recomendam exportar com a CLI) | Não | [1][10] |
| Pro | Últimos 7 dias | Sim | [1][10] |
| Team | Últimos 14 dias | Sim | [1][10] |
| Enterprise | Até 30 dias (docs) ou "Custom" (preços) | Sim, mais de 28 dias disponível | [1][10] |

Preço do PITR (add-on por projeto, cobrado por hora) [1][11]:

| Retenção | USD/hora | USD/mês |
|---|---|---|
| 7 dias | 0,137 | ~100 |
| 14 dias | 0,274 | ~200 |
| 28 dias | 0,55 | ~400 |

Detalhes que mudam a operação [10][11][12]:
- PITR exige computação Small ou maior. Ao ativar PITR, os backups diários deixam de ser feitos.
- Pior caso de perda de dados (RPO) com PITR: 2 minutos, pois o log WAL é enviado a cada 2 minutos por padrão.
- O PITR não é coberto pelo spend cap [11].
- Restaurar deixa o projeto inacessível durante o processo; o tempo cresce com o tamanho do banco.
- Backups diários não guardam senhas de papéis customizados do banco; é preciso redefini-las após restaurar.
- Backups do banco NÃO incluem objetos do Storage. Restaurar um backup antigo não recupera objetos apagados depois dele [10].
- "Restore to a new project" existe só em planos pagos e copia banco, usuários do Auth e papéis, mas NÃO copia objetos do Storage, Edge Functions, configurações do Auth nem chaves de API; o novo projeto gera custo mensal mostrado antes de confirmar [12].
- Apagar um projeto apaga também os backups [10].
- Backup lógico manual: `supabase db dump` (CLI) ou `pg_dump` [10].

## 5. Storage (arquivos)

| Item | Valor | Fonte |
|---|---|---|
| Incluso (Pro e Team) | 100 GB, medidos como média de GB-hora no ciclo, somados em todos os projetos da organização | [4][7] |
| Excedente | USD 0,0213/GB/mês (a tabela de cobrança arredonda para USD 0,021) | [4][7] |
| Tamanho máximo de arquivo | 500 GB (Pro/Team), limite global configurável; Free 50 MB; limite por bucket pode ser menor | [1][20] |
| Restrições por bucket | Tipos de arquivo e tamanho máximo | [20] |
| Egress | 250 GB inclusos (todos os serviços somados), depois USD 0,09/GB | [1][8] |
| Egress em cache (CDN) | 250 GB inclusos, depois USD 0,03/GB; cota e preço independentes do egress sem cache | [1][8] |
| Endpoint compatível com S3 | Sim; uploads padrão, retomável (TUS) e S3 são interoperáveis; URLs pré-assinadas SigV4; multipart (Create/UploadPart/Complete/Abort/ListParts) e CopyObject suportados | [22] |
| Chaves S3 | Acesso total, ignoram RLS, só para servidor; alternativa: token de sessão do usuário, sujeito a RLS | [23] |
| Não suportado no S3 | Versionamento, lifecycle, CORS de bucket, SSE-C, object lock, ACLs, tags. Objetos apagados são removidos em definitivo | [22] |
| URLs assinadas | Suportadas e funcionam com o Smart CDN. Cada token único é uma chave de cache distinta | [21] |
| Smart CDN | Automático no Pro ou acima; Free tem CDN básico. Invalidação em até 60 segundos | [1][21] |
| RLS no Storage | Políticas em `storage.objects`; sem política não há upload; a chave de serviço ignora RLS | [24] |
| Uploads | Padrão recomendado até 6 MB; acima disso, TUS retomável; use o host direto `<ref>.storage.supabase.co` | [25][26] |
| Transformação de imagens | 100 imagens de origem inclusas, depois USD 5 por 1.000 (Pro/Team) | [1] |
| Nomes de arquivo | Letras, números e alguns símbolos (`_ - . ' , ! * & $ @ = ; : + ? ( )`) e espaço | [20] |

Implicações para objetos endereçados por conteúdo, lidos com cache (derivadas da documentação [21]):
- URL assinada nova a cada requisição nunca acerta o cache da CDN. Reutilize a mesma URL assinada ou use bucket público quando o objeto não tiver restrição por usuário.
- Revogar ou expirar o token não limpa o cache da CDN para aquela URL; para cortar acesso, apague o objeto.
- Em arquivos que mudam, use um novo caminho; o cache do navegador pode não ser invalidado.

## 6. Auth (login)

| Item | Valor | Fonte |
|---|---|---|
| MAUs inclusos | 100.000 (Pro/Team); depois USD 0,00325/MAU. Free: 50.000 | [1] |
| SAML 2.0 SSO (no seu projeto) | A partir do Pro. 50 usuários SSO inclusos por ciclo, depois USD 0,015 por usuário SSO; cada usuário conta uma vez por ciclo | [1][9][29] |
| SSO para o painel do Supabase (outro assunto) | Só Team e Enterprise, sob consulta; não confundir com SAML do app | [1][31] |
| Provedores SAML citados | Google Workspace, Okta, Auth0, Microsoft Entra / Azure AD, PingIdentity, OneLogin | [29] |
| Vincular conta SSO a conta existente | Não. Contas SAML não entram em vinculação de identidade (automática ou manual); o mesmo e-mail pode gerar duas contas; use o UUID, não o e-mail, como chave | [29][30] |
| Entra ID via OAuth (alternativa) | Provedor "Azure (Microsoft)" disponível em todos os planos; vinculação automática por e-mail igual e verificado se aplica ao OAuth. Preço por MAU nesse caminho: não confirmado | [1][30][36] |
| Convite por e-mail | Pelo painel ("Invite user") ou `auth.admin.inviteUserByEmail()` no servidor com a chave secreta; o template é editável. O link expira conforme "Email OTP Expiration", padrão 1 hora | [34] |
| SMTP padrão do Supabase | Só envia para endereços da equipe do projeto (erro "Email address not authorized" para os demais), 2 e-mails por hora, pode mudar sem aviso, sem SLA. Não serve para produção | [27][28] |
| SMTP próprio | Todos os planos. Após configurar, o limite inicial é 30 mensagens por hora, ajustável. Provedores citados: Resend, AWS SES, Postmark, SendGrid, ZeptoMail, Brevo | [1][27] |
| Hook de envio de e-mail | "Send custom email/SMS" disponível em Free e Pro | [1][27] |
| MFA | TOTP (app autenticador) básico em todos os planos. MFA por telefone: add-on USD 75/mês no primeiro projeto, USD 10/mês por projeto adicional | [1][35] |
| Senha vazada (HaveIBeenPwned) | Pro ou acima | [32] |
| Timeout de sessão, sessão única por usuário | Pro ou acima | [1][33] |
| Auth Audit Logs | Pro 7 dias; Team 28 dias | [1] |
| Limites de taxa (por IP) | Cadastro e login: 30 por 5 min; token: 150 por 5 min; verificação: 30 por 5 min; redefinir senha: 1 por 60 s por usuário; MFA: 15 por minuto (não ajustável) | [28] |

Atenção para API intermediária (BFF): os limites do Auth contam por IP do cliente que chama. Se o servidor chama o Auth, todos os usuários dividem o IP do servidor. Há o cabeçalho `Sb-Forwarded-For`, aceito só com chave secreta e que precisa ser habilitado nas configurações de rate limit [28].

## 7. Segurança, conformidade e rede

| Tema | O que a documentação diz | Fonte |
|---|---|---|
| SOC 2 Type 2 | Sim, avaliação anual por terceiro. A conformidade não se estende a ambientes fora do produto (modelo de responsabilidade compartilhada). Na lista de preços, SOC 2 aparece só em Team e Enterprise | [1][41] |
| ISO 27001 | Listado em Team e Enterprise. Certificação ISO/IEC 27001:2022 e acesso ao relatório SOC 2 e certificado ISO para clientes Team e Enterprise (via busca) | [1][51][52] |
| HIPAA | Team e Enterprise, como add-on pago, com BAA | [1][42] |
| DPA (acordo de tratamento de dados) | O Supabase fornece DPA; disponível em supabase.com/legal/dpa. Se há restrição por plano: não confirmado | [43][50] |
| LGPD | Não mencionada nas páginas lidas. Não confirmado | [43] |
| SLA de disponibilidade | Só Enterprise. Team tem "priority email support and SLAs" (SLA de suporte). Histórico de uptime: não confirmado (status.supabase.com bloqueado) | [1][2] |
| Regiões | Cada projeto tem uma região primária. São Paulo (`sa-east-1`, "South America (São Paulo)") está na lista; escolha-a como região específica. A região geral "Americas" aponta para East US (N. Virginia). Região é controle de localização de dados, não prova de conformidade | [13] |
| Pausa de projeto | Só Free (após 1 semana sem atividade). Pro, Team e Enterprise: nunca. Projetos pausados não geram cobrança de computação | [1][47] |
| Spend cap | Só Pro. Ligado, o uso acima da cota é bloqueado até o próximo ciclo (sem cobrança, com restrição de serviço). Cobre disco, egress, Storage, MAU, SSO MAU, logs, Edge Functions, Realtime e transformação de imagem. NÃO cobre computação, branches, réplicas, domínio próprio, IOPS e vazão extras, IPv4, log drains, MFA por telefone e PITR. Não há orçamento por item nem alerta de custo | [6] |
| Fair Use | Restrições de serviço podem ocorrer por exceder cotas, fatura vencida ou cartão expirado, com aviso prévio na maioria dos casos | [47] |
| Network Restrictions | Lista de CIDRs IPv4/IPv6 que podem conectar ao Postgres e ao pooler. Não protege as APIs HTTPS (PostgREST, Storage, Auth). Aplicada, as Edge Functions perdem acesso direto ao banco. Restrição por plano: não confirmado nas páginas lidas | [14] |
| SSL | As APIs HTTP sempre exigem SSL. No banco, "Enforce SSL" é opcional, reinicia o banco e deve ser usado com `sslmode=verify-full` e o certificado CA do projeto | [15] |
| Chaves S3 e chave de serviço | Ignoram RLS; devem ficar só no servidor | [23][24] |

## 8. Logs, métricas, alertas e Log Drains

| Item | Valor | Fonte |
|---|---|---|
| Retenção de logs (API e banco) | Free 1 dia; Pro 7 dias; Team 28 dias; Enterprise 90 dias | [1] |
| Ingestão de logs | 20 GB inclusos (Pro/Team), depois USD 0,50/GB; consulta de logs = ingestão x 100 | [1] |
| Log Drains | Pro, Team e Enterprise. USD 60 por drain por mês (USD 0,0822/h) + USD 0,20 por milhão de eventos + USD 0,09/GB de egress. Não coberto pelo spend cap | [1][6][37][38] |
| Destinos do Log Drain | Endpoint HTTP próprio, OpenTelemetry (OTLP), Datadog, Loki, Amazon S3, Sentry, Axiom, Last9, Syslog | [37] |
| Metrics API | Compatível com Prometheus, em beta, cerca de 200 séries do Postgres, autenticação Basic com `service_role` e chave secreta; Pro, Team e Enterprise | [1][39] |
| Alertas | A documentação lida manda montar alertas fora do Supabase (Grafana, Datadog etc.) sobre a Metrics API ou os Log Drains. Alertas nativos de infraestrutura: não confirmado. O spend cap não envia notificações de custo; há aviso quando a cota é excedida | [6][37][39][47] |
| Audit logs da plataforma | Só Team e Enterprise; sem exportação pelo painel | [40] |

## 9. Um projeto = um banco; staging e produção

Cada projeto traz uma instância Postgres dedicada em servidor próprio, e a computação é cobrada por projeto independentemente do uso [4]. Não encontrei, nas páginas lidas, opção de vários bancos isolados dentro de um mesmo projeto (não confirmado); trate "1 projeto = 1 banco". O preço do plano e as cotas (egress, Storage, MAU) são por organização e somam todos os projetos [4]. Planos diferentes não convivem na mesma organização; para ter um projeto Free é preciso outra organização [4].

| Opção | Como funciona | Custo extra do staging | Observações | Fonte |
|---|---|---|---|---|
| A. Dois projetos na mesma organização Pro (recomendada) | Projeto de staging separado, com migrações aplicadas por GitHub Actions (`supabase db push`) | Micro ~USD 9,81/mês (0,01344 x 730 h), sem crédito sobrando se produção já usa o de USD 10 | Auth, Storage e chaves próprios. Cotas compartilhadas com produção (inclusive 50 SSO MAU). Permite testar SAML (exige plano pago) | [3][5][46] |
| B. Branch persistente "staging" (Branching) | Ambiente completo clonado do projeto principal, com credenciais próprias | USD 0,01344/h em Micro (~USD 9,81/mês 24x7). Não usa créditos de computação nem entra no spend cap | Vem sem dados e sem objetos do Storage (usa seed). Gerência por GitHub ou painel (beta). Branches efêmeras de PR só cobram as horas ligadas. Projeto com integração GitHub ativa não pode ser transferido | [44][45][1] |
| C. Organização Free separada para staging | Projeto em organização Free | USD 0 | Banco de 500 MB, 1 GB de Storage, pausa após 1 semana, máx. 2 projetos Free e sem recursos do Pro (senha vazada, SAML, backups, log drains). Paridade ruim | [1][47] |
| D. Supabase local (CLI) para desenvolvimento | `supabase start` em cada máquina | USD 0 | Complementa A ou B; não substitui staging na nuvem | [46] |

Recomendação: A para o MVP (paridade total com produção e custo igual ao de B). Considere B depois, se quiser ambientes por pull request. O guia oficial de ambientes usa exatamente dois projetos (staging e produção) com GitHub Actions e avisa que o staging precisa ser um projeto novo, não um já alterado [46].

## 10. Estimativa de custo (cálculo derivado, 730 h/mês como nos exemplos oficiais)

| Cenário | Conta | USD/mês |
|---|---|---|
| 1. Pro, produção Micro + staging Micro | 25 + 9,81 + 9,81 - 10 | ~34,62 |
| 2. Pro, produção Small + staging Micro (sugerido) | 25 + 15,04 + 9,81 - 10 | ~39,85 |
| 3. Cenário 2 + PITR 7 dias na produção (exige Small) | 39,85 + 100,01 | ~139,86 |
| 4. Acréscimo de 500 GB no Storage (400 GB cobrados) | 400 x 0,0213 | +8,52 |
| 5. Acréscimo de 1 TB no Storage (900 GB cobrados, 1 TB = 1.000 GB) | 900 x 0,0213 | +19,17 |
| 6. Cenário 2 + PITR + 1 TB | 39,85 + 100,01 + 19,17 | ~159,03 |
| 7. Team com a computação do cenário 1 | 599 + 9,81 + 9,81 - 10 | ~608,62 (USD 574 a mais que o Pro) |

Opcionais: Log Drain USD 60/mês cada; IPv4 USD 4/mês por projeto; domínio próprio USD 10/mês por domínio por projeto; MFA por telefone USD 75/mês [1][19][38]. Excedentes: egress sem cache USD 0,09/GB e com cache USD 0,03/GB acima dos 250 GB de cada [1]. MAU e SSO MAU para 50 a 100 usuários ficam dentro ou quase dentro das cotas (100 usuários SSO custam 50 x 0,015 = USD 0,75) [1][9].

## 11. Ressalvas que afetam o desenho do MVP

1. Spend cap e importação do acervo: com o teto ligado, usar Storage além dos 100 GB inclusos é bloqueado até o próximo ciclo [6]. Para importar 500 GB a 1 TB, o teto precisa ficar desligado, e como não há alerta nativo de custo, monitore o uso em Organização > Usage [6] (inferência).
2. Backup dos arquivos: o Supabase não faz backup dos objetos, não há versionamento S3 e apagar é definitivo [10][22]. Planeje cópia periódica via endpoint S3 para outro provedor (decisão de arquitetura; tarefa de infra).
3. SSO futuro: SAML cria contas separadas das de e-mail/senha [29][30]. Para "preservar contas e dados", mantenha uma tabela de usuários própria da aplicação, com id interno estável, e faça a ligação por e-mail verificado na aplicação. O caminho OAuth com Entra tem vinculação automática por e-mail [30][36] (verificar o comportamento antes de adotar).
4. E-mail de convite: configure SMTP próprio antes do primeiro convite; o padrão do Supabase só entrega a e-mails da equipe e a 2 por hora [27][28]. Convites expiram em 1 hora por padrão [34].
5. Conectividade: o pooler compartilhado é IPv4; conexão direta e pooler dedicado exigem IPv6 ou o add-on de USD 4/mês [16][19]. Confirme o suporte a IPv6 do ambiente de execução da API antes de escolher.
6. Relatório SOC 2/ISO: listado só em Team e Enterprise [1][51][52]. Se o time de risco da A&M exigir o relatório, o Pro pode não bastar. Se o formulário de pedido (forms.supabase.com/soc2, visto na busca) atende clientes Pro: não confirmado.
7. Sem SLA de disponibilidade abaixo do Enterprise [1][2].
8. Pagamento só por cartão em USD; fatura vencida pausa os projetos [47].

## 12. Itens não confirmados

- Valores lidos do repositório oficial, não das páginas renderizadas (ver seção 0).
- Cotação USD/BRL.
- Status e histórico de uptime; conteúdo do trust center; acesso de clientes Pro ao relatório SOC 2.
- Plano mínimo para Network Restrictions.
- Alertas nativos de infraestrutura e de custo.
- Tamanho padrão do pool de conexões por tamanho de instância.
- Possibilidade de mais de um banco por projeto.
- Preço por MAU de login via OAuth com Entra ID (Azure).
- Aplicabilidade do DPA por plano e menção a LGPD.
- Tabela de IOPS e vazão por tamanho de computação (componente não lido).

## Fontes

Convenção: a URL pública oficial vem primeiro; entre parênteses, o arquivo-fonte realmente lido em 2026-10-06 em https://raw.githubusercontent.com/supabase/supabase/master/ (abreviado "raw:"). Páginas de docs: `apps/docs/content/guides/<caminho>.mdx`.

1. https://supabase.com/pricing (raw: packages/shared-data/pricing.ts)
2. https://supabase.com/pricing (raw: packages/shared-data/plans.ts)
3. https://supabase.com/docs/guides/platform/compute-and-disk (raw: apps/docs/content/guides/platform/compute-and-disk.mdx)
4. https://supabase.com/docs/guides/platform/billing-on-supabase (raw: .../guides/platform/billing-on-supabase.mdx)
5. https://supabase.com/docs/guides/platform/manage-your-usage/compute (raw: .../guides/platform/manage-your-usage/compute.mdx)
6. https://supabase.com/docs/guides/platform/cost-control (raw: .../guides/platform/cost-control.mdx)
7. https://supabase.com/docs/guides/platform/manage-your-usage/storage-size (raw: .../guides/platform/manage-your-usage/storage-size.mdx e apps/docs/content/_partials/billing/pricing/pricing_storage_size.mdx)
8. https://supabase.com/docs/guides/platform/manage-your-usage/egress (raw: .../guides/platform/manage-your-usage/egress.mdx)
9. https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-sso (raw: .../guides/platform/manage-your-usage/monthly-active-users-sso.mdx)
10. https://supabase.com/docs/guides/platform/backups (raw: .../guides/platform/backups.mdx)
11. https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery (raw: .../guides/platform/manage-your-usage/point-in-time-recovery.mdx e _partials/billing/pricing/pricing_pitr.mdx)
12. https://supabase.com/docs/guides/platform/clone-project (raw: .../guides/platform/clone-project.mdx)
13. https://supabase.com/docs/guides/platform/regions (raw: .../guides/platform/regions.mdx e packages/shared-data/regions.ts)
14. https://supabase.com/docs/guides/platform/network-restrictions (raw: .../guides/platform/network-restrictions.mdx)
15. https://supabase.com/docs/guides/platform/ssl-enforcement (raw: .../guides/platform/ssl-enforcement.mdx)
16. https://supabase.com/docs/guides/database/connecting-to-postgres (raw: .../guides/database/connecting-to-postgres.mdx)
17. https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits (raw: .../guides/database/connecting-to-postgres/pooling-and-limits.mdx)
18. https://supabase.com/docs/guides/database/connection-management (raw: .../guides/database/connection-management.mdx)
19. https://supabase.com/docs/guides/platform/ipv4-address e https://supabase.com/docs/guides/platform/manage-your-usage/ipv4 (raw: .../guides/platform/ipv4-address.mdx e .../manage-your-usage/ipv4.mdx)
20. https://supabase.com/docs/guides/storage/uploads/file-limits (raw: .../guides/storage/uploads/file-limits.mdx)
21. https://supabase.com/docs/guides/storage/cdn/smart-cdn (raw: .../guides/storage/cdn/smart-cdn.mdx)
22. https://supabase.com/docs/guides/storage/s3/compatibility (raw: .../guides/storage/s3/compatibility.mdx)
23. https://supabase.com/docs/guides/storage/s3/authentication (raw: .../guides/storage/s3/authentication.mdx)
24. https://supabase.com/docs/guides/storage/security/access-control (raw: .../guides/storage/security/access-control.mdx)
25. https://supabase.com/docs/guides/storage/uploads/standard-uploads (raw: .../guides/storage/uploads/standard-uploads.mdx)
26. https://supabase.com/docs/guides/storage/uploads/resumable-uploads (raw: .../guides/storage/uploads/resumable-uploads.mdx)
27. https://supabase.com/docs/guides/auth/auth-smtp (raw: .../guides/auth/auth-smtp.mdx)
28. https://supabase.com/docs/guides/auth/rate-limits (raw: .../guides/auth/rate-limits.mdx, _partials/auth_rate_limits.mdx e packages/shared-data/config.ts, que define 2 e-mails/hora do SMTP padrão)
29. https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml (raw: .../guides/auth/enterprise-sso/auth-sso-saml.mdx)
30. https://supabase.com/docs/guides/auth/auth-identity-linking (raw: .../guides/auth/auth-identity-linking.mdx)
31. https://supabase.com/docs/guides/platform/sso (raw: .../guides/platform/sso.mdx)
32. https://supabase.com/docs/guides/auth/password-security (raw: .../guides/auth/password-security.mdx)
33. https://supabase.com/docs/guides/auth/sessions (raw: .../guides/auth/sessions.mdx)
34. https://supabase.com/docs/guides/auth/users (raw: .../guides/auth/users.mdx)
35. https://supabase.com/docs/guides/auth/auth-mfa (raw: .../guides/auth/auth-mfa.mdx)
36. https://supabase.com/docs/guides/auth/social-login/auth-azure (raw: .../guides/auth/social-login/auth-azure.mdx)
37. https://supabase.com/docs/guides/observability/log-drains (raw: .../guides/observability/log-drains.mdx)
38. https://supabase.com/docs/guides/platform/manage-your-usage/log-drains (raw: .../guides/platform/manage-your-usage/log-drains.mdx)
39. https://supabase.com/docs/guides/observability/metrics (raw: .../guides/observability/metrics.mdx e _partials/metrics_access.mdx)
40. https://supabase.com/docs/guides/security/platform-audit-logs (raw: .../guides/security/platform-audit-logs.mdx)
41. https://supabase.com/docs/guides/security/soc-2-compliance (raw: .../guides/security/soc-2-compliance.mdx)
42. https://supabase.com/docs/guides/security/hipaa-compliance (raw: .../guides/security/hipaa-compliance.mdx)
43. https://supabase.com/docs/guides/security/gdpr-compliance (raw: .../guides/security/gdpr-compliance.mdx)
44. https://supabase.com/docs/guides/deployment/branching (raw: .../guides/deployment/branching.mdx)
45. https://supabase.com/docs/guides/platform/manage-your-usage/branching (raw: .../guides/platform/manage-your-usage/branching.mdx e _partials/billing/pricing/pricing_branching.mdx)
46. https://supabase.com/docs/guides/deployment/managing-environments (raw: .../guides/deployment/managing-environments.mdx)
47. https://supabase.com/docs/guides/platform/billing-faq (raw: .../guides/platform/billing-faq.mdx)
48. https://supabase.com/docs/guides/platform/manage-your-subscription (raw: .../guides/platform/manage-your-subscription.mdx)
49. https://supabase.com/docs/guides/platform/access-control (raw: .../guides/platform/access-control.mdx)
50. https://supabase.com/legal/dpa (via busca; página não aberta)
51. https://supabase.com/blog/supabase-is-now-iso-27001-certified (via busca; página não aberta)
52. https://supabase.com/security (via busca; página não aberta)
53. https://supabase.com/docs/guides/platform/manage-your-usage/disk-size (raw: .../guides/platform/manage-your-usage/disk-size.mdx)
