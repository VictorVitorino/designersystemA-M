# Pesquisa: alternativas ao par Vercel + Supabase para banco, arquivos, e-mail e autenticação

Data da consulta: 2026-10-06. Moeda de referência: USD, sem impostos (IOF e tributos de importação de serviço não incluídos). Os números entre colchetes, como [7], remetem à seção "Fontes" no fim do arquivo.

## 0. Como esta pesquisa foi feita (leia antes dos números)

| Item | Situação |
|---|---|
| Firecrawl | Sem créditos ("Insufficient credits"), na pesquisa e na segunda leitura. Não foi usado. |
| Páginas de preço dos fornecedores via WebFetch | Bloqueadas pelo proxy de saída (EGRESS_BLOCKED): neon.com, developers.cloudflare.com, backblaze.com, resend.com, aws.amazon.com, clerk.com, supabase.com, azure.microsoft.com, prices.azure.com, render.com, postmarkapp.com, twilio.com, auth0.com, workos.com, stack-auth.com, brevo.com, b0.p.awsstatic.com. Na segunda leitura também ficaram bloqueados docs.aws.amazon.com, learn.microsoft.com e olinda.bcb.gov.br. |
| O que abriu | (a) arquivos-fonte dos repositórios públicos oficiais de docs (Cloudflare, Neon, Supabase e Microsoft Learn/entra-docs) em raw.githubusercontent.com; (b) a lista pública de preços da AWS (pricing.us-east-1.amazonaws.com), cujo arquivo do RDS em sa-east-1 tem 17 MB e foi baixado com curl por exceder o limite de 10 MB do WebFetch; (c) cloud.google.com, mas a página de preço do Cloud SQL é montada por JavaScript e voltou vazia. |
| WebSearch restrito ao domínio oficial | Usado na pesquisa para o restante. Devolve resumos de páginas oficiais, sem abrir a página. Na segunda leitura o limite de buscas estava esgotado, então nenhum resumo foi reconferido. |

Legenda do grau de confirmação, que aparece em cada fonte na seção "Fontes":

| Marca | Significado |
|---|---|
| P | Valor lido em arquivo ou API oficial do fornecedor (lista de preços da AWS, arquivo-fonte do repositório oficial de docs). Confiança alta. Reconferido na segunda leitura. |
| B | Valor lido em resumo de busca restrita ao domínio oficial; a página de preço não abriu, nem na pesquisa nem na segunda leitura. Tratar como não confirmado e confirmar antes de contratar. |
| A | Ambíguo ou conflitante entre resumos. Explicado na linha. |
| N | Não confirmado. Explicado na linha. |

Cotação BRL: não confirmada. A busca no Banco Central (dadosabertos.bcb.gov.br) só devolveu o endereço do conjunto de dados, sem a PTAX de 2026-10-05 [31]; a API olinda.bcb.gov.br ficou bloqueada na segunda leitura. Por isso este arquivo não converte para reais. Para converter, multiplicar o valor em USD pela PTAX de venda do dia da contratação.

Cenário usado nas contas (hipóteses minhas, não vêm de fonte): 50 usuários; 730 horas por mês; 1 TB = 1.000 GB; arquivos de 500 GB e de 1 TB; saída (download) de 300 GB por mês; cerca de 1.000 e-mails por mês; banco de dados de 10 GB (os arquivos ficam fora do banco; nas linhas do RDS usei 20 GB de disco, hipótese minha que não vem de fonte); computação média de 0,5 unidade (0,5 CU na Neon, 0,5 ACU no Aurora) ligada 24 horas. As contas estão escritas para você refazer com outras hipóteses.

## 1. Resumo para decisão

| Categoria | Menor custo confirmado no cenário | Observação principal |
|---|---|---|
| Banco | Neon Launch, cerca de USD 15 a 42/mês, região São Paulo [4][5] | Preço por uso. RDS e Aurora em São Paulo custam bem mais: USD 55 a 210/mês no RDS (instância mais disco) e USD 29 a 93/mês no Aurora [9]. Cloud SQL e Azure: não confirmado. |
| Arquivos (500 GB a 1 TB, 300 GB/mês de saída) | Cloudflare R2, USD 7,35 a 14,85 com saída grátis [1]. Backblaze B2, USD 3,48 a 6,95: não confirmado [19] | S3 em São Paulo + CloudFront: USD 20,25 a 40,50 só de armazenamento [7]. O R2 não tem dica de localização na América do Sul [3]; região do B2 no Brasil: não confirmada. |
| E-mail (~1.000/mês) | Amazon SES, USD 0,10 [11]. Resend e Brevo gratuitos: não confirmado [21][25] | Postmark USD 15 [22] e SendGrid USD 19,95 [24]: não confirmados. |
| Autenticação com SSO futuro | Não confirmado: Entra External ID (gratuito até 50.000 MAU) [29], Clerk Pro (USD 25/mês com 1 conexão SSO) [26]; números vindos de resumos de busca | WorkOS, USD 125 por conexão SSO: não confirmado [28]. A documentação oficial da Microsoft confirma a federação de um tenant Entra como provedor OIDC personalizado no External ID [29]. |

## 2. (a) Postgres gerenciado

### 2.1 Preços e custo no cenário

| Opção | Preço de lista | Cálculo no cenário | USD/mês | Fonte |
|---|---|---|---|---|
| Neon Launch (aws-sa-east-1) | USD 0,106 por CU-hora; USD 0,35 por GB-mês; sem mínimo mensal | 0,5 CU x 730 h = 365 CU-h x 0,106 = 38,69; mais 10 GB x 0,35 = 3,50 | 42,19 | [4] P; [6] não reaberto (não confirmado) |
| Neon Launch, se a computação suspender fora do expediente | Igual | Hipótese: 220 h/mês ativas a 0,5 CU = 110 CU-h x 0,106 = 11,66; mais 3,50. [4] confirma que a computação do Launch suspende após 5 minutos de inatividade e que isso pode ser desativado; as 220 h/mês ativas seguem como hipótese. | 15,16 | [4] P, hipótese |
| Neon Scale | USD 0,222 por CU-hora; USD 0,35 por GB-mês | 365 CU-h x 0,222 = 81,03; mais 3,50 | 84,53 | [4] P |
| Render Postgres Basic-1gb | USD 19/mês com 1 GB de RAM e 100 conexões; 1 GB de disco incluso; disco extra USD 0,30/GB | 19 + 9 GB x 0,30 | 21,70 | [18] B, não confirmado |
| AWS RDS PostgreSQL db.t4g.small, Single-AZ, sa-east-1 | USD 0,069/h; gp3 USD 0,219/GB-mês | 0,069 x 730 = 50,37; mais 20 GB x 0,219 = 4,38 | 54,75 | [9] P |
| AWS RDS db.t4g.small, Multi-AZ | USD 0,137/h; gp3 Multi-AZ USD 0,438/GB-mês | 0,137 x 730 = 100,01; mais 20 GB x 0,438 = 8,76 | 108,77 | [9] P |
| AWS RDS db.t4g.medium, Single-AZ | USD 0,137/h | 100,01 + 4,38 | 104,39 | [9] P |
| AWS RDS db.t4g.medium, Multi-AZ | USD 0,275/h | 0,275 x 730 = 200,75; mais 8,76 | 209,51 | [9] P |
| AWS Aurora PostgreSQL Serverless v2, sa-east-1 | USD 0,25 por ACU-hora (Standard) ou USD 0,33 (I/O-Optimized); armazenamento USD 0,19/GB-mês no Standard (USD 0,428/GB-mês no I/O-Optimized); USD 0,28 por milhão de I/O (Standard) | 0,5 ACU x 730 = 365 ACU-h x 0,25 = 91,25; mais 10 GB x 0,19 = 1,90; mais I/O | 93,15 mais I/O | [9] P |
| Aurora Serverless v2 com escala a zero fora do expediente | Igual | Hipótese: 110 ACU-h x 0,25 = 27,50; mais 1,90. O artigo da AWS sobre "scaling to 0 capacity" [14] não foi reaberto na segunda leitura: a existência do recurso, a regra exata e a versão do Postgres exigida são não confirmadas. | 29,40 | [14] não confirmado, hipótese |
| Google Cloud SQL (São Paulo) | Não confirmado | A página é montada por JavaScript e o WebFetch recebeu texto vazio. Um resumo de busca trouxe USD 0,0413 por vCPU-hora, USD 0,007 por GiB-hora de memória e USD 0,17 por GiB-mês de SSD, mas sem dizer a região. Não usar para São Paulo. | N | [15] N |
| Azure Database for PostgreSQL (Brasil Sul) | Não confirmado | A página mostra "$-" nas tabelas sem JavaScript e prices.azure.com está bloqueado. Os "fatos documentais" da pesquisa (SKUs Burstable B1ms com 1 vCore e 2 GiB e B2s com 2 vCore e 4 GiB; Brasil Sul suporta Burstable; backup gratuito até 100% do armazenamento provisionado) não puderam ser reconferidos, porque learn.microsoft.com está bloqueado: não confirmado. | N | [16] não confirmado |
| Referência: Supabase Pro (par atual) | USD 25/mês por organização; 8 GB de disco; backup diário por 7 dias; PITR é complemento pago (cerca de USD 100/mês para 7 dias, exige computação Small) | Preço base, sem a computação | 25 mais computação | [20] P (documentação oficial no repositório supabase/supabase) |

Nota sobre a Neon: a documentação oficial [4] confirma que o histórico de restauração é cobrado a USD 0,20/GB-mês no Launch e na Scale. O volume de histórico depende da taxa de alteração do banco e não foi estimado. A Neon Launch lista "Up to 7 days" de histórico e a Scale "Up to 30 days" [4].

### 2.2 Limitações relevantes

| Opção | Saída (egress) | Limites de taxa e capacidade | Regiões | Observações |
|---|---|---|---|---|
| Neon | 500 GB por projeto por mês incluídos nos dois planos pagos, depois USD 0,10/GB; Free tem 5 GB [4] P | Launch até 16 CU (64 GB de RAM); Scale até 16 CU com autoescala ou tamanhos fixos até 56 CU; 100 projetos no Launch, 1.000 no Scale [4] P | 8 regiões AWS, incluindo São Paulo (aws-sa-east-1). A região de um projeto não pode ser alterada depois [5] P | A tabela de planos compara Free, Launch e Scale (sem plano Business); a mesma página cita ainda um "Agent Plan" para plataformas de agentes de IA [4] P. SLA de disponibilidade, IP Allow, SOC 2, ISO, GDPR e HIPAA (este com cobrança adicional) aparecem apenas na Scale; na linha "Compliance and security" o Launch lista só "Protected branches" [4] P. Object Storage e Functions da Neon não estão em São Paulo [5] P. |
| Render Postgres | Não confirmado | 100 conexões nos planos listados: não confirmado [18] B | Não confirmado (não sei se há região no Brasil) | PITR: 3 dias no workspace Hobby, 7 dias no Pro ou superior: não confirmado [18] B. O preço do plano de workspace não foi confirmado. Um resumo listou "Pro-4gb a USD 40" com "2 GB de RAM", o que é incoerente (A); usei só o Basic-1gb. |
| AWS RDS / Aurora | Saída para a internet a partir de sa-east-1: USD 0,150/GB até 10 TB/mês [8] P | Aurora Serverless v2 cobra por ACU por segundo, com capacidade mínima e máxima configuráveis: não confirmado [14] (a lista de preços [9] confirma o preço por ACU-hora, não a cobrança por segundo) | São Paulo (sa-east-1) | Multi-AZ dobra o preço da instância e do armazenamento [9] P. Backup acima da franquia custa USD 0,095/GB-mês no RDS e USD 0,037 no Aurora [9] P. |
| Cloud SQL | N | N | N | N |
| Azure PG | N | N | Brasil Sul suporta Burstable: não confirmado [16] | N |

## 3. (b) Objetos S3-compatíveis para 500 GB a 1 TB

### 3.1 Preços e custo no cenário (armazenamento mais 300 GB/mês de saída)

| Opção | Preço de lista | 500 GB | 1 TB | Fonte |
|---|---|---|---|---|
| Cloudflare R2 Standard | USD 0,015/GB-mês; saída grátis; Classe A USD 4,50 por milhão; Classe B USD 0,36 por milhão; franquia mensal: 10 GB-mês, 1 milhão de Classe A, 10 milhões de Classe B | 7,50 (7,35 depois dos 10 GB grátis) | 15,00 (14,85) | [1] P |
| Cloudflare R2 Infrequent Access | USD 0,01/GB-mês; retirada USD 0,01/GB; Classe A USD 9,00 e Classe B USD 0,90 por milhão; mínimo de 30 dias | 5,00 mais retirada | 10,00 mais retirada | [1] P |
| Backblaze B2 | USD 6,95 por TB por mês; saída grátis até 3 vezes o armazenamento médio mensal, depois USD 0,01/GB; saída grátis para CDNs parceiras (Cloudflare, Fastly, bunny.net, CacheFly, CoreWeave, Equinix Metal, Vultr, phoenixNAP); primeiros 10 GB grátis (todos os valores desta linha: não confirmado) | 3,48 (0,5 TB x 6,95) | 6,95 | [19] B, não confirmado |
| Supabase Storage (sobre o Pro de USD 25) | 100 GB inclusos; excedente USD 0,0213/GB; saída: 250 GB a USD 0,09 depois; saída em cache: 250 GB a USD 0,03 depois (cota de saída unificada por organização, compartilhada com banco e Auth; cotas de armazenamento e saída também são por organização) | 8,52 de armazenamento (400 GB x 0,0213) mais saída de 1,50 a 4,50 = 10,02 a 13,02 | 19,17 (900 GB x 0,0213) mais saída 1,50 a 4,50 = 20,67 a 23,67 | [20] P |
| AWS S3 Standard, sa-east-1 | USD 0,0405/GB-mês (primeiros 50 TB); PUT/COPY/POST/LIST USD 0,007 por mil; GET USD 0,0056 por 10.000 | 20,25 | 40,50 | [7] P |
| AWS CloudFront, para entregar o S3 | América do Sul: USD 0,110/GB (primeiros 10 TB); requisição HTTPS USD 0,022 por 10.000; HTTP USD 0,016 por 10.000. Franquia perpétua de 1 TB/mês de saída: não confirmado [12] (a lista de preços [10] não traz franquia). | Saída: 300 x 0,110 = 33,00; seria 0 apenas se a franquia de 1 TB se confirmar | Idem | [10] P, [12] B, não confirmado |
| S3 direto à internet (sem CloudFront) | USD 0,150/GB até 10 TB; um resumo diz que 100 GB/mês são grátis somando todos os serviços: não confirmado [13] | 300 x 0,150 = 45,00; ou 30,00 se os 100 GB grátis valerem (não confirmado) | Idem | [8] P, [13] A (não confirmado) |
| Azure Blob (Brasil Sul) | Armazenamento: não confirmado. Saída da América do Sul, segundo resumo (não confirmado): 100 GB/mês grátis; depois USD 0,181/GB (rede Premium da Microsoft) ou USD 0,12/GB (rede de ISP) para os próximos 10 TB | Saída: 200 x 0,181 = 36,20 ou 200 x 0,12 = 24,00 (não confirmado); armazenamento N | Idem | [17] A/N, não confirmado |

Observação sobre o S3: um resumo de busca trouxe "USD 0,0265/GB" (sem dizer a região) e outro "USD 0,138/GB de saída", tirado de um artigo de 2020. Nenhum vale para este caso. O arquivo oficial de preços (versão publicada em 2026-09-28) mostra USD 0,0405/GB-mês em sa-east-1 [7], e a saída para a internet de São Paulo custa USD 0,150/GB nos primeiros 10 TB [8]. O valor de USD 0,138 hoje é a faixa de 10 a 50 TB por mês para a internet e também a transferência de São Paulo para outras regiões AWS [8].

Observação sobre o CloudFront: a AWS oferece planos de preço fixo. Um resumo cita Pro a USD 15/mês, com até 50 TB de transferência, 10 milhões de requisições e créditos de armazenamento S3 [12] B. Não confirmado: a lista de preços [10] não traz esses planos e as páginas da AWS estão bloqueadas. Não usei no cálculo.

Observação sobre S3 para CloudFront: o arquivo de preços do S3 lista USD 0,00/GB para "S3-DT-AWS Outbound" (saída do S3 para serviços AWS) [7]. A conclusão de que isso cobre o trecho S3 para CloudFront segue a documentação da AWS, que não foi lida nesta consulta.

Segunda cópia independente (conta derivada): manter uma cópia do bucket no B2 custa de USD 3,48 (500 GB) a USD 6,95 (1 TB) por mês de armazenamento (não confirmado) [19]. A saída do R2 é grátis [1].

### 3.2 Limitações relevantes

| Opção | Saída | Taxa de requisição e limites | Regiões | Observações |
|---|---|---|---|---|
| Cloudflare R2 | Grátis nas duas classes [1] P | 1 escrita por segundo por mesma chave (acima disso, HTTP 429); objeto de até 5 TiB; 100 domínios próprios por bucket; endpoint r2.dev tem limite variável, com 429 e possível estrangulamento de banda; API REST da Cloudflare limitada a 1.200 requisições por 5 minutos [2] P | Dicas de localização: wnam, enam, weur, eeur, apac e oc. Não há América do Sul. Jurisdições: eu, fedramp e us [3] P | Para alto volume, usar a API S3 ou Workers, não a API REST [2] P. Latência a partir do Brasil precisa ser testada (não confirmado). |
| Backblaze B2 | Grátis até 3x o armazenamento médio; depois USD 0,01/GB: não confirmado [19] B | Classe A grátis; Classe B e C: 2.500 chamadas por dia grátis, depois USD 0,004 por 10.000 (B) e USD 0,004 por mil (C). O resumo diz "Free" e "then" na mesma frase, por isso é A; não confirmado [19] | Não confirmado (nenhuma região no Brasil confirmada) | Existe teto de uso e alertas de custo configuráveis: não confirmado [19] B. |
| Supabase Storage | 250 GB mais 250 GB em cache por organização (cota unificada, compartilhada com banco e Auth), depois USD 0,09 e USD 0,03/GB [20] P | Ver supabase.md (arquivo irmão desta pasta) para limites de objeto, S3 e backup | Região do projeto Supabase | O backup do banco não cobre os objetos; ver supabase.md. |
| AWS S3 + CloudFront | S3 para internet: USD 0,150/GB; via CloudFront: USD 0,110/GB depois da franquia [8][10] P | Não confirmado nesta consulta | São Paulo (sa-east-1) para o S3; CloudFront global | Mesma nuvem e mesma região do RDS. |
| Azure Blob | Ver tabela acima | N | N | N |

## 4. (c) E-mail transacional (convite e recuperação, cerca de 1.000/mês)

### 4.1 Preços no cenário e autenticação de domínio

| Opção | Plano de entrada e limites | Custo com 1.000 e-mails/mês | Excedente | SPF, DKIM e DMARC | Fonte |
|---|---|---|---|---|---|
| Resend | Free: 3.000/mês, 100/dia, 3 domínios. Pro: USD 20/mês com 50.000. Scale: USD 160/mês com 200.000 | 0 (Free) ou 20 (Pro) | USD 0,90 por mil no Pro | DKIM e SPF por registros TXT mais MX ou CNAME no domínio; DMARC opcional e recomendado. Regiões de envio: N. Virginia, Irlanda, São Paulo (sa-east-1) e Tóquio [21] | [21] B, todos os valores da linha não confirmados |
| Postmark | Developer gratuito: 100/mês. Basic: USD 15/mês com 10.000 | 15 | USD 1,80 por mil | DKIM obrigatório para verificar o domínio; Return-Path próprio (CNAME pm-bounces para pm.mtasv.net) para o SPF alinhar e o DMARC passar. IP dedicado: USD 50/mês por IP, para quem envia 300.000 por mês ou mais [22] | [22] B, todos os valores da linha não confirmados |
| Amazon SES (sa-east-1) | Pagamento por uso: USD 0,0001 por destinatário = USD 0,10 por mil | 0,10 | Mesmo preço; anexos USD 0,12/GB; IP dedicado padrão USD 24,95/mês por IP | Easy DKIM (2048 bits por padrão); SPF via domínio MAIL FROM próprio (registros MX e TXT); DMARC por TXT em _dmarc [23]. Conta nova fica em sandbox: 200 mensagens por 24 h e 1 por segundo; em produção a cota padrão é 50.000 por dia [23]. Preços (USD 0,10 por mil, anexos, IP dedicado) confirmados em [11]; DKIM, SPF, DMARC, sandbox e cotas: não confirmado (docs.aws.amazon.com bloqueado) | [11] P, [23] B, não confirmado |
| SendGrid (Twilio) | Plano gratuito aposentado em 27 de maio de 2025; hoje só teste de 60 dias com 100/dia. Essentials: USD 19,95/mês com 50.000. Pro: a partir de USD 89,95 | 19,95 | Cerca de USD 0,00133 por e-mail (resumo; as faixas Essentials de 40 mil e 100 mil mudaram, então o valor é A) | Autenticação de domínio gera DKIM, SPF e DMARC; com "automated security" a Twilio cria e mantém os registros [24] | [24] B/A, todos os valores da linha não confirmados |
| Brevo | Free: 300/dia (9.000/mês). Starter: a partir de USD 9/mês com 5.000. Standard: a partir de USD 18/mês com 5.000. Professional: a partir de USD 499/mês com 150.000 | 0 (Free) | Não confirmado | Código Brevo, DKIM e DMARC no painel de Domínios; SPF e MX só são exigidos com IP dedicado [25]. O resumo mistura planos de marketing e transacional, então os valores acima são A | [25] B/A, todos os valores da linha não confirmados |

Observação sobre o SES: a lista oficial de São Paulo também traz um plano mensal novo "Pro" a USD 105/mês (e "Enterprise" a USD 500/mês) e preços por mensagem: Essentials USD 0,00016, Pro USD 0,00022 e Enterprise USD 0,00023 [11]. Não analisei esses planos, porque o preço por uso de USD 0,10 por mil basta para o volume do cenário; porém, se uma conta nova for enquadrada no Essentials, o custo de 1.000 e-mails seria USD 0,16. Qual preço vale para conta nova: não confirmado (aws.amazon.com/ses/pricing bloqueada).

### 4.2 Limitações relevantes

| Opção | Taxa de envio | Regiões | Observação |
|---|---|---|---|
| Resend | Limite de API por segundo: não confirmado (a página de cotas existe [21], mas o arquivo-fonte do repositório de docs deu 404) | us-east-1, eu-west-1, sa-east-1, ap-northeast-1 [21] B, não confirmado | Free limita a 100 e-mails por dia: um convite em lote para todos os 50 usuários cabe, mais que isso não (não confirmado). |
| Postmark | Não confirmado | Não confirmado | Plano gratuito de 100/mês não cobre 1.000 (não confirmado). |
| SES | Sandbox: 1 mensagem por segundo; produção: cota diária de 50.000 por padrão, medida em destinatários [23] B, não confirmado | São Paulo (preços em sa-east-1 [11] P) | É preciso pedir saída do sandbox (processo manual da AWS): não confirmado [23]. |
| SendGrid | Não confirmado | Não confirmado | Sem plano gratuito permanente: não confirmado [24]. |
| Brevo | Free: 300 por dia: não confirmado [25] | Não confirmado | Domínio próprio e DKIM/DMARC são necessários, inclusive no transacional: não confirmado [25]. |

## 5. (d) Autenticação gerenciada, caso não use o Supabase Auth

Contexto: 50 usuários, login por convite, e-mail e senha hoje, SSO SAML ou OIDC com o Entra ID da A&M no futuro, uma conexão corporativa. Para o que o Supabase oferece de SSO, ver supabase.md.

| Opção | Preço de lista | Custo no cenário (50 MAU) | SAML e SSO | Fonte |
|---|---|---|---|---|
| Clerk | Free: até 50.000 usuários retidos por mês (MRU). Pro: USD 25/mês (USD 20 no anual), 50.000 MRU; acima disso USD 0,02/MRU de 50.001 a 100.000. Business: USD 250/mês no anual | 0 hoje; 25 quando precisar de SSO | O Pro inclui 1 conexão SSO (SAML, OIDC ou EASIE). Conexões extras: USD 75 cada de 2 a 15; USD 60 de 16 a 100 [26] | [26] B, todos os valores da linha não confirmados |
| Auth0 | Free: 25.000 MAU, 1 domínio próprio, "1 conexão enterprise". Essentials B2C: USD 35/mês para 500 MAU. B2B Essentials: a partir de USD 150/mês para 500 MAU. B2B Professional: a partir de USD 800/mês para 500 MAU, com 5 conexões enterprise (até 15) | 0 no Free; pelo menos 150 no B2B Essentials se precisar de SSO | O Free lista 1 conexão enterprise, mas a comunidade da Auth0 diz que usar conexão enterprise no Free estoura a cota; não confirmado se SAML de produção é permitido no Free (A) [27] | [27] B/A, todos os valores da linha não confirmados |
| WorkOS | AuthKit gratuito até 1 milhão de MAU; USD 2.500/mês por milhão adicional. Domínio próprio: USD 99/mês | 0 hoje | SSO a USD 125 por conexão por mês de 1 a 15 conexões; USD 100 de 16 a 30; USD 80 de 31 a 50; USD 65 de 51 a 100. Conexões OAuth e de staging são grátis [28] | [28] B, todos os valores da linha não confirmados |
| Microsoft Entra External ID | Não confirmado: "primeiros 50.000 MAU grátis; USD 0,03 por MAU depois (desconto de lançamento até maio de 2025, já vencido)" e "complementos sem franquia gratuita" vieram de resumos de busca. A documentação oficial [29] diz apenas que existe uma faixa gratuita ("free tier"), que o modelo é por MAU e remete à página de preço (aka.ms/ExternalIDPricing, não aberta) para os números. Complementos pagos listados na documentação: M2M, SMS, Go-Local, ID Governance e GSA for Guests | Não confirmado (0 apenas se a faixa de 50.000 MAU se confirmar) | A documentação oficial (data 2026-03-09) confirma que um tenant Microsoft Entra ID pode ser configurado como provedor OIDC personalizado de um tenant externo do External ID, inclusive vários tenants, e exposto nos fluxos de cadastro e login [29] P. Isso resolve o conflito (A) da pesquisa: a afirmação de que tenant-para-tenant não é suportado, vinda de uma pergunta e resposta, contradiz a documentação. "SAML e WS-Fed são pensados para IdPs que não são Entra": não confirmado | [29] P (federação OIDC) / N (preço) |
| Stack Auth | Free: 10.000 usuários, 1 admin de painel, 1.000 e-mails/mês. Team: USD 49/mês com 50.000 usuários, 4 admins e 25.000 e-mails | 0 (Free) ou 49 | OIDC e OAuth SSO e provedores OIDC personalizados em ambos; SAML não confirmado [30] | [30] B, todos os valores da linha não confirmados |

Observações a verificar (não mudam os números): as páginas de docs da Neon chamam parte do produto de "Lakebase Postgres" [5] (confirmado na segunda leitura; a página de planos [4] também cita o suporte da Databricks), e o domínio de docs do Stack Auth mostra um título "Hexclave Documentation" [30] (não confirmado). Podem ser renomeações de marca; vale perguntar ao fornecedor antes de contratar.

## 6. Faixa mensal do cenário (USD, sem impostos; itens sem prova estão marcados "não confirmado")

| Item | Menor | Maior | Comentário |
|---|---|---|---|
| Banco | 15,16 (Neon Launch com suspensão, hipótese) | 209,51 (RDS db.t4g.medium Multi-AZ) | Neon Launch sem suspensão: 42,19. Render: 21,70 (não confirmado). Aurora: 29,40 (escala a zero, hipótese não confirmada) a 93,15. Cloud SQL e Azure: N. |
| Arquivos, armazenamento mais saída | 3,48 (B2, 500 GB; não confirmado). Menor valor confirmado: 7,35 (R2, 500 GB) | 40,50 (S3, 1 TB; mais 33,00 de CloudFront se a franquia de 1 TB, não confirmada, não existir) | R2: 7,35 a 14,85. Supabase: 10,02 a 23,67 mais USD 25 de base. |
| E-mail | 0 (Resend Free, Brevo Free; não confirmado) | 19,95 (SendGrid; não confirmado) | SES: 0,10. Postmark: 15 (não confirmado). |
| Autenticação | 0 (Entra, Clerk Free, Stack Free, WorkOS; todos não confirmados) | 125 (WorkOS com 1 SSO; não confirmado) | Clerk Pro com SSO: 25. Stack Team: 49. Auth0 B2B com SSO: pelo menos 150. Todos não confirmados. |

## 7. Leitura preliminar (julgamento meu, não é dado de fonte)

1. Banco: se a decisão for sair do Supabase por custo, a Neon Launch em São Paulo é a opção de menor custo com região no Brasil. RDS e Aurora só se a A&M exigir conta AWS corporativa: o RDS custa de USD 55 (Single-AZ, sem alta disponibilidade) a USD 210/mês neste cenário, contra USD 15 a 42 da Neon Launch.
2. Arquivos: a R2 tem a melhor relação entre custo e simplicidade para 500 GB a 1 TB com 300 GB/mês de saída, porque a saída é grátis. O B2 aparece como o mais barato por GB e como segunda cópia independente, mas seus valores são não confirmados. Antes de decidir, medir a latência a partir de escritórios da A&M no Brasil, porque o R2 não tem dica de localização na América do Sul [3] e o B2 não teve região no Brasil confirmada.
3. E-mail: SES (centavos, conforme a lista de preços [11]) ou Resend (gratuito ou USD 20, com região em São Paulo; não confirmado). O Postmark custa USD 15 (não confirmado) e tem fama de entregabilidade, que não foi verificada aqui.
4. Autenticação: se o SSO com o Entra for requisito firme, o Clerk Pro (USD 25 com 1 conexão; não confirmado) seria o mais barato entre os pagos. O Entra External ID tem faixa gratuita segundo a documentação oficial, mas o limite de 50.000 MAU e o preço por MAU não foram confirmados; a documentação oficial confirma a federação de outro tenant Entra por OIDC personalizado [29], e ainda assim vale uma prova de conceito com o tenant da A&M.
5. Antes de contratar, abrir as páginas de preço marcadas B, A ou N em um navegador sem bloqueio e confirmar os valores.

## Fontes

Todas consultadas em 2026-10-06. A marca (P, B, A, N) indica como o dado foi lido, conforme a legenda da seção 0.

1. [P] Cloudflare R2, preços: https://developers.cloudflare.com/r2/pricing/ (lido pelo arquivo-fonte https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/pricing.mdx)
2. [P] Cloudflare R2, limites: https://developers.cloudflare.com/r2/platform/limits/ (arquivo-fonte https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/platform/limits.mdx)
3. [P] Cloudflare R2, localização dos dados: https://developers.cloudflare.com/r2/reference/data-location/ (arquivo-fonte https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/reference/data-location.mdx)
4. [P] Neon, planos: https://neon.com/docs/introduction/plans (arquivo-fonte https://raw.githubusercontent.com/neondatabase/website/main/content/docs/introduction/plans.md)
5. [P] Neon, regiões: https://neon.com/docs/introduction/regions (arquivo-fonte https://raw.githubusercontent.com/neondatabase/website/main/content/docs/introduction/regions.md)
6. [B, não confirmado: não reaberto; os valores da Neon foram confirmados em [4]] Neon, preço e modelo por uso: https://neon.com/pricing e https://neon.com/blog/new-usage-based-pricing
7. [P] AWS Price List, S3 em sa-east-1 (versão 20260928230416, publicada em 2026-09-28): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/sa-east-1/index.json
8. [P] AWS Price List, transferência de dados em sa-east-1 (versão 20260916132208): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/sa-east-1/index.json
9. [P] AWS Price List, RDS e Aurora em sa-east-1 (versão 20261006024742, publicada em 2026-10-06): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006024742/sa-east-1/index.json (baixado com curl; 17 MB)
10. [P] AWS Price List, CloudFront (versão 20261003000426): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json
11. [P] AWS Price List, SES (versão 20260911124507): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/current/index.json
12. [B, não confirmado] AWS CloudFront, preços e planos de preço fixo: https://aws.amazon.com/cloudfront/pricing/ e https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html
13. [A, não confirmado] AWS S3, preços (franquia de 100 GB de saída): https://aws.amazon.com/s3/pricing/
14. [B, não confirmado] AWS Aurora Serverless v2, funcionamento e escala a zero: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html e https://aws.amazon.com/blogs/database/introducing-scaling-to-0-capacity-with-amazon-aurora-serverless-v2/
15. [N] Google Cloud SQL, preços: https://cloud.google.com/sql/pricing (página montada por JavaScript, sem texto legível)
16. [B/N, não confirmado] Azure Database for PostgreSQL, preços e docs: https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/ (bloqueada), https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute e https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore
17. [A/N, não confirmado] Azure Blob e largura de banda: https://azure.microsoft.com/en-us/pricing/details/storage/blobs/ e https://azure.microsoft.com/en-us/pricing/details/bandwidth/
18. [B, não confirmado] Render Postgres: https://render.com/pricing e https://render.com/docs/postgresql-backups
19. [B, não confirmado] Backblaze B2: https://www.backblaze.com/cloud-storage/pricing, https://www.backblaze.com/cloud-storage/transaction-pricing e https://www.backblaze.com/docs/cloud-storage-data-caps-and-alerts
20. [P] Supabase (valores lidos na documentação oficial, arquivos-fonte do repositório supabase/supabase; supabase.com/pricing continua bloqueada): https://supabase.com/docs/guides/storage/pricing, https://supabase.com/docs/guides/platform/backups, https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery, https://supabase.com/docs/guides/platform/manage-your-usage/egress, https://supabase.com/docs/guides/platform/manage-your-usage/storage-size, https://supabase.com/docs/guides/platform/compute-and-disk e https://supabase.com/docs/guides/platform/billing-faq (arquivos-fonte em https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/ e _partials/billing/pricing/)
21. [B, não confirmado] Resend: https://resend.com/pricing, https://resend.com/docs/knowledge-base/account-quotas-and-limits, https://resend.com/docs/dashboard/domains/regions e https://resend.com/docs/add-a-domain
22. [B, não confirmado] Postmark: https://postmarkapp.com/pricing, https://postmarkapp.com/support/article/1107-how-does-monthly-pricing-work, https://postmarkapp.com/support/article/910-how-do-i-add-a-custom-return-path e https://postmarkapp.com/guides/dmarc
23. [B, não confirmado] Amazon SES (os preços estão em [11], confirmados): https://aws.amazon.com/ses/pricing/, https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html, https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim.html, https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-spf.html e https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html
24. [B/A, não confirmado] SendGrid (Twilio): https://www.twilio.com/en-us/products/email-api/pricing, https://www.twilio.com/en-us/changelog/sendgrid-free-plan e https://www.twilio.com/docs/sendgrid/ui/account-and-settings/how-to-set-up-domain-authentication
25. [B/A, não confirmado] Brevo: https://www.brevo.com/products/transactional-email/ e https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC
26. [B, não confirmado] Clerk: https://clerk.com/pricing e https://clerk.com/changelog/2026-02-05-new-plans-more-value
27. [B/A, não confirmado] Auth0: https://auth0.com/pricing
28. [B, não confirmado] WorkOS: https://workos.com/pricing.md e https://workos.com/compare/auth0
29. [P para a federação OIDC e para a lista de complementos; N para preço e limite gratuito] Microsoft Entra External ID: https://azure.microsoft.com/en-us/pricing/details/microsoft-entra-external-id/ (bloqueada, não confirmado), https://learn.microsoft.com/en-us/entra/external-id/external-identities-pricing (arquivo-fonte https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/main/docs/external-id/external-identities-pricing.md, lido, sem números) e https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-entra-id-federation-customers (arquivo-fonte https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/main/docs/external-id/customers/how-to-entra-id-federation-customers.md, lido; data da página 2026-03-09)
30. [B, não confirmado] Stack Auth: https://stack-auth.com/pricing e https://docs.stack-auth.com/
31. [N] Banco Central do Brasil, cotação PTAX (valor de 2026-10-05 não obtido; a API olinda.bcb.gov.br também foi bloqueada na segunda leitura): https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios

Verificado em 2026-10-06 por segunda leitura das páginas oficiais; itens marcados 'não confirmado' ficaram sem prova
