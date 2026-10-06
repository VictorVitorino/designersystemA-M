# Pesquisa: Vercel Pro e alternativas de hospedagem (app estático + API Node/Hono)

Data de consulta: 2026-10-06. Escopo: plataforma interna da Alvarez & Marsal (Brasil), cerca de 50 usuários (pico de 50 simultâneos), app estático + API serverless Node (Hono) + Postgres externo + armazenamento de objetos externo, 2 ambientes (staging e produção).

## 0. Como esta pesquisa foi feita e o que ela NÃO garante (ler primeiro)

- Nesta sessão, a abertura direta das páginas foi impossível: o `firecrawl_scrape` respondeu "Insufficient credits" e o `WebFetch` respondeu `EGRESS_BLOCKED` para vercel.com, netlify.com, render.com, railway.com, fly.io e cloudflare.com. Não contornei o bloqueio.
- Todos os números abaixo vieram de `WebSearch` restrito aos domínios oficiais de cada fornecedor (parâmetro `allowed_domains`). O que a ferramenta devolve é um resumo de trechos das páginas oficiais, não a página inteira. As URLs listadas em "Fontes" são as páginas oficiais que apareceram nos resultados, mas nenhuma foi aberta por mim.
- Marcação usada: **[T]** = número presente em trecho de busca de página oficial; **[NC]** = não confirmado (motivo indicado); **[CP]** = cálculo próprio, com hipóteses declaradas (não é preço publicado).
- Antes de contratar, um humano deve abrir as páginas de "Fontes" 1, 5, 6 e 11 (Vercel) e conferir os valores. Preços de nuvem mudam com frequência.
- Cotação: o trecho de busca em bcb.gov.br indicou PTAX de venda de R$ 4,9698 por US$ 1 para 06/10. O trecho não mostrou o ano de forma inequívoca e a página não foi aberta, então a cotação é **[NC]**. Valores em BRL abaixo são só indicativos (US$ x 4,97).

## 1. Resumo executivo

- A Vercel Pro atende ao caso: US$ 20/mês por seat que faz deploy, com US$ 20 de crédito de uso, 1 TB de tráfego e 10 M de Edge Requests incluídos, funções com até 800 s de duração (30 min em beta), 30.000 execuções concorrentes e região São Paulo (gru1) disponível para as funções. **[T]**
- Pontos de atenção: (a) corpo de requisição de função limitado a 4,5 MB, então uploads de imagens/arquivos devem ir direto ao armazenamento por URL assinada; (b) logs de runtime ficam só 1 dia no Pro (30 dias exige Observability Plus ou Log Drains pagos); (c) Pro não tem SLA nem suporte com prazo contratual (99,99% é só Enterprise); (d) preços em São Paulo são maiores que na base (tráfego US$ 0,22/GB e requests US$ 3,20/M após a franquia). **[T]**
- Para 50 usuários o custo esperado da Vercel Pro fica perto do valor dos seats (US$ 20 a US$ 60/mês), pois o consumo cabe nos US$ 20 de crédito segundo estimativa própria **[CP]**.
- Alternativa mais barata: Cloudflare Workers Paid (a partir de US$ 5/mês) com R2 (egress zero), ao custo de rodar em runtime Workers, não Node puro. Alternativa mais simples de operar para código Node tradicional: container 24/7 (Fly.io tem região gru; Render e Railway não têm São Paulo). **[T]**

## 2. Vercel Pro: preço por usuário e créditos

| Item | Valor | Marca |
|---|---|---|
| Taxa da plataforma Pro | US$ 20/mês, inclui 1 seat que faz deploy e US$ 20/mês de crédito de uso | [T] |
| Seats pagos adicionais (Owner/Member) | US$ 20/mês cada | [T] |
| Seats Viewer (somente leitura) | gratuitos e ilimitados no Pro | [T] |
| Crédito de uso | US$ 20/mês, flexível entre dimensões (transferência, compute, cache etc.); excedente cobrado sob demanda | [T] |
| Cada seat adicional soma mais US$ 20 de crédito? | não confirmado: o trecho não diz | [NC] |
| Spend Management | ativo por padrão em novos times, limite de US$ 200/ciclo; avisos em 50%, 75% e 100%; pode pausar projetos ou chamar webhook | [T] |
| Flat Rate CDN (opcional) | Pro inclui o menor nível (1 M requests e 1 TB/mês); níveis acima: US$ 20 (10 M req, 50 TB), US$ 100 (50 M req, 50 TB), US$ 300 (150 M req, 50 TB) | [T] |

## 3. Limites das Functions

| Limite | Valor no Pro | Marca |
|---|---|---|
| Tamanho máximo de corpo (requisição ou resposta) | 4,5 MB; acima retorna 413 FUNCTION_PAYLOAD_TOO_LARGE | [T] |
| Duração máxima (Fluid compute) | padrão 300 s, máximo 800 s; até 1800 s (30 min) em beta, configurado por função | [T] |
| Memória / CPU | padrão 2 GB e 1 vCPU; máximo 4 GB e 2 vCPU | [T] |
| Concorrência | auto-escala até 30.000 (Hobby e Pro); 100.000+ no Enterprise | [T] |
| Runtimes | Node.js, Python, Bun, Rust e Edge; Node 24 (`nodejs24.x`) aparece como versão suportada | [T] |
| Hono | detecção sem configuração; rotas viram Vercel Functions com Fluid compute | [T] |
| WebSocket em Functions | não confirmado (existe artigo de KB sobre o tema, o trecho não traz a resposta) | [NC] |

Implicação para o projeto: o limite de 4,5 MB impede upload de arquivos pela API. Usar URL assinada (upload direto ao armazenamento de objetos) e enviar à API apenas metadados e o hash.

## 4. Regiões

| Item | Valor | Marca |
|---|---|---|
| São Paulo | existe: código `gru1` (referência São Paulo, Brasil; mapeia para sa-east-1) | [T] |
| Regiões de compute | 19 | [T] |
| Funções em múltiplas regiões | Pro pode configurar até 3 regiões para Functions | [T] |
| Como fixar | `regions` no `vercel.json`, por função, ou `--regions` no CLI | [T] |

## 5. Tráfego incluído e preço excedente (Pro)

| Métrica | Incluído | Excedente (base) | Excedente em São Paulo (gru1) | Marca |
|---|---|---|---|---|
| Fast Data Transfer | 1 TB/mês | US$ 0,15/GB | US$ 0,22/GB | [T] |
| Edge Requests | 10 M/mês | US$ 2,00 por 1 M | US$ 3,20 por 1 M | [T] |
| Faixa regional de FDT | | US$ 0,15 a US$ 0,35/GB conforme a região | | [T] |

Observação: a página de preços regionais informa que o preço depende da região de origem das requisições. Para usuários no Brasil, vale esperar as tarifas de São Paulo. Tráfego bloqueado, desafiado ou limitado pelo WAF não gera cobrança de CDN Requests nem FDT. **[T]**

## 6. Fluid compute

| Item | Valor | Marca |
|---|---|---|
| Padrão em projetos novos | ativo por padrão desde 23/04/2025 | [T] |
| Active CPU | cobrado só enquanto o código executa (pausa em espera de banco/API externa); de US$ 0,128/h (EUA) até US$ 0,221/h (São Paulo) | [T] |
| Memória provisionada | de US$ 0,0106 a US$ 0,0183 por GB-hora (o último em São Paulo) | [T] |
| Invocações | a partir de US$ 0,60 por 1 M no Pro | [T] |

## 7. Segurança de borda: Deployment Protection, WAF e Firewall

| Item | Situação no Pro | Marca |
|---|---|---|
| Standard Protection | disponível em todos os planos; protege todos os domínios exceto os de produção (previews e URLs de deployment) | [T] |
| Vercel Authentication | restringe a usuários da Vercel com acesso adequado; se um Viewer seat basta para passar não foi confirmado | [T] / [NC] |
| Password Protection | US$ 20/mês por projeto protegido no Pro | [T] |
| DDoS, IP Blocking e regras customizadas | gratuitos em todos os planos | [T] |
| Limites de regras no Pro | até 100 regras de IP Blocking e até 40 regras customizadas | [T] |
| Rate limiting (WAF) | em todos os planos; 1 M de requests permitidas/mês incluído; depois US$ 0,50 por 1 M; chaves de contagem IP e JA4; janela de 10 s a 10 min; 40 regras por projeto | [T] |
| Regras gerenciadas (ex.: OWASP) e Trusted IPs | em qual plano ficam não foi confirmado | [NC] |

Observação: o sistema terá login próprio (convite, e-mail verificado e senha), então Deployment Protection serve para esconder o staging e previews, não como controle de acesso dos usuários finais.

## 8. Domínios, HTTPS, ambientes e variáveis

| Item | Valor | Marca |
|---|---|---|
| HTTPS / certificados | emitidos automaticamente para domínios verificados | [T] |
| Domínios por projeto | ilimitados no Pro (limite flexível de 100.000) | [T] |
| Ambientes | Production, Preview e Development; ambientes customizados (ex.: staging): Pro tem 1, Enterprise até 12 | [T] |
| Variáveis de ambiente | total de 64 KB por deployment (runtimes Node, Python etc.); até 1.000 por ambiente por projeto | [T] |

Implicação: o Pro comporta exatamente 1 ambiente customizado, suficiente para "staging" além de produção e previews.

## 9. Logs, observabilidade e alertas

| Item | Valor | Marca |
|---|---|---|
| Retenção de runtime logs | Pro: 1 dia; 30 dias com Observability Plus | [T] |
| Observability Plus | a partir de US$ 10/mês, mais US$ 1,20 por 1 M de eventos | [T] |
| Alertas (anomalia de uso e de erros em funções) | disponíveis em Enterprise e no Pro com Observability Plus | [T] |
| Log Drains / Drains | disponíveis no Pro e Enterprise; US$ 0,50 por GB (volume medido em JSON não comprimido) | [T] |
| Audit Log Drains | só Enterprise | [T] |

Implicação: para auditoria e investigação de incidentes, enviar logs a um destino externo (Drains) ou contratar Observability Plus; 1 dia é pouco.

## 10. Cron Jobs

| Item | Valor | Marca |
|---|---|---|
| Quantidade | 100 por projeto em todos os planos | [T] |
| Frequência mínima no Pro | 1 por minuto (precisão de minuto) | [T] |
| Cobrança | cron invoca Functions, então vale o preço de Functions | [T] |

Uso previsto: limpeza de convites expirados, rotinas de retenção, verificações. Backups do banco e dos arquivos não devem depender de Cron na Vercel.

## 11. Conformidade, DPA e LGPD

| Item | Situação | Marca |
|---|---|---|
| SOC 2 Type 2 | atestado para Segurança, Confidencialidade e Disponibilidade; relatório 2026 (auditor Schellman, período 01/07/2025 a 30/06/2026) | [T] |
| ISO 27001 | certificada (ISO 27001:2022, auditoria de vigilância concluída) | [T] |
| PCI DSS v4.0 | atestado | [T] |
| DPA | publicado em vercel.com/legal/dpa (alinhado ao GDPR) | [T] |
| LGPD explícita | não confirmada: os trechos citam GDPR, CCPA e EU-US DPF, sem menção à LGPD | [NC] |
| Acesso aos documentos | Trust Center e Team Settings > Compliance no painel | [T] |
| SLA e suporte | Pro e Hobby não têm SLA nem suporte com prazo contratual; 99,99% de SLA e suporte 24x7 são do Enterprise | [T] |

## 12. Custo estimado do MVP na Vercel Pro [CP]

Hipóteses (minhas, não publicadas): 50 usuários, 22 dias úteis, cerca de 300.000 Edge Requests/mês, 1 M de invocações, 20 horas de Active CPU, 100 GB-hora de memória, tráfego bem abaixo de 1 TB (uploads e downloads de arquivos passam pelo armazenamento externo, não pela Vercel).

| Componente | Conta | Valor |
|---|---|---|
| Seats (2 pessoas fazendo deploy) | 2 x US$ 20 | US$ 40 |
| Invocações | 1 M x US$ 0,60 | US$ 0,60 |
| Active CPU (gru1) | 20 h x US$ 0,221 | US$ 4,42 |
| Memória (gru1) | 100 GB-h x US$ 0,0183 | US$ 1,83 |
| Edge Requests e FDT | dentro da franquia | US$ 0 |
| Uso total vs. crédito | US$ 6,85 vs. US$ 20 | coberto pelo crédito |
| Total mensal estimado | | cerca de US$ 40 (cerca de R$ 199 [NC]) |

Com 1 seat o total seria US$ 20; com 3 seats, US$ 60. Observability Plus (US$ 10 + eventos) e Password Protection do staging (US$ 20) são opcionais e somam à conta.

## 13. Comparação com alternativas (para este caso)

| Plataforma e plano | Preço base | Execução / limites que importam | Brasil | Conformidade citada |
|---|---|---|---|---|
| Vercel Pro | US$ 20/mês por seat que faz deploy (+ US$ 20 de crédito) | Functions: corpo 4,5 MB, 300 s padrão (máx. 800 s), 2 a 4 GB, 30.000 concorrentes [T] | gru1 (São Paulo) [T] | SOC 2 Type 2, ISO 27001, PCI, DPA [T] |
| Cloudflare Workers Paid (Pages Functions cobrados como Workers) | mínimo US$ 5/mês; 10 M requests e 30 M ms de CPU incluídos; excedente US$ 0,30/M requests e US$ 0,02/M ms de CPU; sem cobrança de egress; assets estáticos grátis e ilimitados [T] | CPU até 30 s (padrão), configurável até 5 min; tempo de relógio sem limite para HTTP com cliente conectado; 128 MB por isolate; corpo 100 MB (plano Free/Pro da zona); 10.000 subrequests no Paid [T]; runtime Workers com `nodejs_compat`, não Node puro; Postgres via Hyperdrive (incluído) [T] | região de execução escolhível: não confirmado [NC] | ISO 27001:2022, ISO 27701, ISO 27018, SOC 2 Type II, PCI DSS nível 1; DPA no painel com SCCs [T] |
| Netlify Pro (créditos) | US$ 20/mês com 3.000 créditos, seats ilimitados; outros níveis: 5.000 por US$ 33, 10.000 por US$ 63; recarga de 1.500 créditos por US$ 10 [T] | Functions síncronas 60 s (fixo); payload 6 MB (binário em base64 cai para cerca de 4,5 MB); 1.024 MB padrão, 1.024 a 4.096 MB configurável no Pro com créditos [T]; custo em créditos: banda 20/GB, compute 10/GB-h, requests 2 por 10 mil, deploy de produção 15 [T] | gru (São Paulo) disponível para Functions; padrão cmh (Ohio) [T] | SOC 2 Type II e DPA indicados (datas do trecho ambíguas) [T]/[NC] |
| Render (container 24/7) | Web service: Starter US$ 7 (0,5 CPU/512 MB), Standard US$ 25 (1 CPU/2 GB), Pro US$ 85 (2 CPU/4 GB) [T]; plano de workspace Pro US$ 25/mês fixo, membros ilimitados (trecho de changelog; necessidade para este caso não confirmada) [T]/[NC] | sem limite de corpo/duração de função; banda excedente US$ 0,15/GB [T]; franquia de banda do workspace: valor ambíguo [NC] | sem São Paulo: Oregon, Ohio, Virginia, Frankfurt, Singapura [T] | SOC 2 Type 2 e ISO 27001:2022; DPA para todos os clientes; relatório SOC 2 só a partir do tier Organization [T] |
| Railway (container 24/7) | Hobby US$ 5/mês (crédito de US$ 5); Pro US$ 20/mês de uso mínimo, seats ilimitados [T]; CPU cerca de US$ 20 por vCPU/mês, RAM cerca de US$ 10 por GB/mês, egress US$ 0,05/GB [T] | por réplica no Pro: até 24 GB de RAM e 24 vCPU (documentação atual; fontes antigas citam 32/32) [T]; volume Pro até 1 TB [T] | sem São Paulo: US West, US East, EU West (Amsterdã), Sudeste Asiático [T] | SOC 2 Type II, SOC 3, atestado HIPAA; DPA publicado [T] |
| Fly.io (container 24/7) | shared-cpu-1x com 1 GB: cerca de US$ 6,70/mês (varia por região; Frankfurt US$ 7,73); RAM extra US$ 6/GB/mês [T]; egress US$ 0,04/GB para América do Sul [T] | sem limite de corpo/duração de função; faturamento por segundo | gru (São Paulo) existe [T]; preço em gru não confirmado [NC] | SOC 2 / DPA: não confirmado nesta pesquisa [NC] |

Custos mensais de um container Node 24/7 [CP], só com os preços unitários publicados e consumo constante (teto teórico):

| Opção | Cálculo | Total |
|---|---|---|
| Railway Pro, 1 vCPU e 1 GB | US$ 20 + US$ 10 de uso (maior que o mínimo de US$ 20) | cerca de US$ 30 |
| Render Standard (1 CPU/2 GB) | US$ 25, mais taxa de workspace se aplicável | US$ 25 a US$ 50 [NC] |
| Fly.io, 2 máquinas shared-cpu-1x 1 GB (alta disponibilidade) | 2 x US$ 6,70 | cerca de US$ 13,40 |
| Cloudflare Workers Paid | mínimo, se o uso couber nas franquias | cerca de US$ 5 |
| Netlify Pro | US$ 20; ilustração: 1 M requests (200 créditos) + 20 GB de banda (400) + 100 GB-h (1.000) + 20 deploys (300) = 1.900 créditos, dentro dos 3.000 | cerca de US$ 20 |

## 14. Notas por fornecedor (limitações relevantes)

- **Cloudflare:** menor custo e egress zero no R2 (US$ 0,015/GB-mês de armazenamento padrão, Class A US$ 4,50/M, Class B US$ 0,36/M, franquia de 10 GB, egress gratuito) [T]. Em 1 TB, o armazenamento custaria cerca de US$ 15/mês [CP]. Custo: abandonar Node puro (Workers), conexão ao Postgres por Hyperdrive, e duas contas/consoles diferentes se o banco estiver no Supabase.
- **Netlify:** São Paulo disponível, mas timeout síncrono fixo de 60 s e payload de 6 MB; billing por créditos exige acompanhamento. As regras de crédito foram atualizadas em 14/04/2026 (há changelog "Pricing updates"), então conferir valores na página.
- **Render e Railway:** operam um servidor Node contínuo sem limites de corpo ou duração, mas sem região no Brasil. A latência adicional para usuários no Brasil não foi medida nesta pesquisa **[NC]**.
- **Fly.io:** única alternativa de container com região em São Paulo confirmada; exige mais operação própria (Dockerfile, health checks, rollbacks, TLS gerenciado pela plataforma não verificado nesta pesquisa).

## 15. Recomendação para o MVP

1. **Vercel Pro com Functions em gru1** como padrão: menor esforço de operação (HTTPS automático, previews, ambiente staging customizado, Fluid compute, Hono sem configuração), região no Brasil e conformidade documentada. Custo esperado de US$ 20 a US$ 60/mês com 1 a 3 seats **[CP]**.
2. Obrigatório no desenho por causa dos limites: upload direto ao armazenamento por URL assinada (limite de 4,5 MB); logs enviados a destino externo (retenção de 1 dia no Pro); alertas externos ou Observability Plus; sem depender da Vercel para backups.
3. Ativar Spend Management com teto e alerta (padrão de US$ 200) e rate limiting do WAF nas rotas de login, convite e recuperação.
4. Plano B de menor custo: Cloudflare Workers Paid com R2, aceitando o runtime Workers. Plano B de portabilidade: container no Fly.io (gru), porque Hono roda igual em Node.
5. Se a A&M exigir SLA ou suporte com prazo contratual, o Pro não atende; seria necessário Enterprise (preço sob consulta, **[NC]**).

## 16. Itens não confirmados e pendências

- Abertura direta das páginas oficiais (bloqueio de egress e créditos do Firecrawl zerados).
- Cotação PTAX de 06/10/2026 e todos os valores em BRL.
- Se cada seat adicional da Vercel soma US$ 20 de crédito; se Viewer seat passa na Vercel Authentication; plano de Trusted IPs e regras gerenciadas do WAF; suporte a WebSocket em Functions.
- LGPD explícita na Vercel (apenas GDPR/DPA aparecem nos trechos).
- Cloudflare: escolha de região de execução. Fly.io: preço específico em gru e SOC 2. Render: franquia de banda do workspace e necessidade da taxa de workspace. Netlify: datas do trecho de SOC 2.
- Latência real Brasil x EUA/Europa para Render e Railway.

## Fontes

Todas consultadas em 2026-10-06 por trechos de busca restritos ao domínio oficial (páginas não abertas por bloqueio; ver seção 0).

1. https://vercel.com/pricing
2. https://vercel.com/docs/plans/pro-plan
3. https://vercel.com/blog/new-pro-pricing-plan
4. https://vercel.com/changelog/included-pro-usage-is-now-credit-based
5. https://vercel.com/docs/limits
6. https://vercel.com/docs/functions/limitations
7. https://vercel.com/docs/functions/configuring-functions/duration
8. https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute
9. https://vercel.com/docs/regions
10. https://vercel.com/docs/pricing/regional-pricing/gru1
11. https://vercel.com/docs/functions/usage-and-pricing
12. https://vercel.com/changelog/fluid-compute-is-now-the-default-for-new-projects
13. https://vercel.com/docs/manage-cdn-usage
14. https://vercel.com/changelog/pro-customers-can-now-configure-up-to-3-regions-for-vercel-functions
15. https://vercel.com/docs/deployment-protection
16. https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing
17. https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
18. https://vercel.com/docs/observability/observability-plus
19. https://vercel.com/docs/alerts
20. https://vercel.com/docs/drains
21. https://vercel.com/docs/cron-jobs/usage-and-pricing
22. https://vercel.com/docs/environment-variables
23. https://vercel.com/docs/spend-management
24. https://vercel.com/changelog/free-viewer-seats-now-available-on-pro
25. https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams
26. https://vercel.com/kb/guide/is-vercel-soc-2-compliant
27. https://vercel.com/legal/dpa
28. https://security.vercel.com/
29. https://vercel.com/legal/sla
30. https://vercel.com/docs/frameworks/backend/hono
31. https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
32. https://developers.cloudflare.com/workers/platform/pricing/
33. https://developers.cloudflare.com/workers/platform/limits/
34. https://developers.cloudflare.com/changelog/post/2025-03-25-higher-cpu-limits/
35. https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
36. https://developers.cloudflare.com/hyperdrive/platform/pricing/
37. https://developers.cloudflare.com/r2/pricing/
38. https://www.cloudflare.com/trust-hub/
39. https://www.cloudflare.com/cloudflare-customer-dpa/
40. https://www.netlify.com/pricing/
41. https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
42. https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
43. https://docs.netlify.com/build/functions/configuration/
44. https://www.netlify.com/trust-center/
45. https://render.com/pricing
46. https://render.com/docs/compute-plans
47. https://render.com/docs/regions
48. https://render.com/docs/outbound-bandwidth
49. https://render.com/changelog/updated-plans-for-render-workspaces
50. https://render.com/docs/certifications-compliance
51. https://render.com/dpa
52. https://railway.com/pricing
53. https://docs.railway.com/pricing/plans
54. https://docs.railway.com/deployments/regions
55. https://docs.railway.com/enterprise/compliance
56. https://fly.io/docs/about/pricing/
57. https://fly.io/docs/reference/regions/
58. https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios
