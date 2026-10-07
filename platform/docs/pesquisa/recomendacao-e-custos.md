# Recomendação de plataformas e custos do MVP (50 usuários)

Data de consulta: 2026-10-06. Escopo: plataforma interna da Alvarez & Marsal (Brasil) para criar apresentações; cerca de 50 usuários (pico de 50 simultâneos); app estático + API Node (Hono); Postgres; arquivos de 0 a 500 GB-1 TB; login por convite; SSO (provavelmente Microsoft Entra ID) no futuro; staging e produção.

## 0. Como ler este documento

**Origem dos números.** Este arquivo consolida, sem inventar nada, os números dos 4 arquivos já verificados desta pasta: `vercel.md`, `supabase.md`, `alternativas-banco-arquivos.md` e `monitoramento-backup-seguranca.md`. Esses arquivos registram que as páginas renderizadas dos fornecedores estavam bloqueadas (proxy de saída) e que o Firecrawl estava sem créditos. Por isso os valores vêm de arquivos-fonte oficiais (repositórios de docs no GitHub), da lista oficial de preços da AWS ou de trechos de busca restritos ao domínio oficial. Nenhuma página foi reaberta nesta etapa.

**Legenda de confiança** (aparece nas tabelas):

| Marca | Significado |
|---|---|
| F | Lido em arquivo-fonte oficial do fornecedor ou na lista oficial de preços da AWS |
| T | Trecho de busca restrita ao domínio oficial; página não aberta |
| NC | Não confirmado (ambíguo, conflitante ou sem página aberta) |
| H | Hipótese de volume minha, declarada abaixo; não vem de fonte |
| CP | Conta própria feita neste arquivo com os preços da linha |

**Cotação e data.** Premissa de planejamento: **R$ 5,00 por US$ 1,00**, em 2026-10-06. A PTAX de venda do dia não foi confirmada: um trecho indicou R$ 4,9698 (então a premissa fica 0,6% acima: 5,00 ÷ 4,9698 = 1,006) e outros trechos mostraram de 4,9692 a 5,2238 (com 5,2238 os valores em reais sobem 4,5%: 5,2238 ÷ 5,00 = 1,0448) [74]. Valores em USD, sem impostos (IOF e tributos de serviço importado não estão incluídos; Supabase aceita só cartão de crédito, faturado em USD [40]). Antes de orçar, trocar pela PTAX de venda do dia.

**Hipóteses de volume (H)**, usadas nas contas:

| Hipótese | Valor | Origem |
|---|---|---|
| Horas por mês | 730 | `supabase.md` §10 |
| 1 TB | 1.000 GB | `alternativas-banco-arquivos.md` §0 |
| Saída de arquivos (downloads) | 300 GB/mês, nos 3 cenários de arquivos | `alternativas-banco-arquivos.md` §0 |
| E-mails | 1.000/mês (o escopo prevê centenas; usei o teto) | `alternativas-banco-arquivos.md` §0 |
| Banco de produção | 10 GB (staging cabe nos 8 GB inclusos) | `alternativas-banco-arquivos.md` §0 |
| Uso das Functions da Vercel | 1 M invocações; 20 h de CPU ativa; 100 GB-h de memória; 300 mil Edge Requests; tráfego abaixo de 1 TB | `vercel.md` §12 |
| Pessoas com deploy (seats Vercel) | 2 | `vercel.md` §12 |
| Dumps externos do banco | 7 dumps diários de 10 GB, sem compressão (pior caso) = 70 GB | minha |
| Eventos do Observability Plus | 1 M por mês | minha |
| Tráfego do app no container (cenário C) | 20 GB/mês (páginas e API; arquivos saem do R2) | minha |
| Neon staging (cenário C) | 20 CU-h por mês e 1 GB de disco | minha |
| Histórico de restauração Neon (cenário C) | 10 GB | minha |

## 1. Resumo para decisão

| Cenário | 50 GB | 500 GB | 1 TB |
|---|---|---|---|
| A) Vercel Pro + Supabase Pro | US$ 113,55 (R$ 567,75) | US$ 128,82 (R$ 644,10) | US$ 146,97 (R$ 734,85) |
| B) A, com arquivos no R2 e e-mail Resend | US$ 109,30 (R$ 546,50) | US$ 119,18 (R$ 595,90) | US$ 130,15 (R$ 650,75) |
| C) Container Node + Neon + R2 | US$ 95,66 (R$ 478,30) | US$ 105,54 (R$ 527,70) | US$ 116,51 (R$ 582,55) |

- **Recomendação: cenário A**, com tudo em São Paulo (Vercel `gru1`, Supabase `sa-east-1`) e uma cópia externa criptografada dos arquivos e dos dumps do banco. A diferença para B é de US$ 4,25 a US$ 16,82 por mês e para C é de US$ 17,89 a US$ 30,46 (contas na seção 2.4).
- Entre 74% e 96% do custo de A é fixo (assentos, Supabase, Sentry): 108,45 ÷ 146,97 = 0,74 e 108,45 ÷ 113,55 = 0,96. Arquivos mudam pouco o total; não vale trocar de arquitetura só por centavos por GB.
- A plataforma já usa Supabase Auth (cliente GoTrue chamado pela API) e um driver S3 configurável por variáveis (`docs/API.md` §9). Então B é uma troca de configuração mais cópia de dados, feita depois se a saída de arquivos justificar. C exige substituir o login e construir o SSO.
- Maior decisão pendente com a A&M: se o relatório SOC 2 do fornecedor do banco é exigido. No Supabase isso só existe no Team (+US$ 574,00 por mês) [37].

## 2. Modelo de custo mensal

Convenção: N = GB de arquivos (50, 500 ou 1.000). Cada linha traz a conta e a fonte. Totais em reais = USD × 5,00.

### 2.1 Cenário A: Vercel Pro + Supabase Pro

Linhas fixas (iguais nos três volumes de arquivos):

| Linha | Conta | US$/mês | Fonte |
|---|---|---|---|
| Assentos (Vercel) | 20 (plataforma Pro, inclui 1 seat) + 20 (2º seat) = 40,00 | 40,00 | [1][2] T |
| Computação da API (Vercel, gru1) | invocações 1 M × 0,60 = 0,60; CPU ativa 20 h × 0,221 = 4,42; memória 100 GB-h × 0,0183 = 1,83; soma 6,85, menor que o crédito de 20 | 0,00 | [3][4] T, H |
| Tráfego do app (Vercel) | 300 mil Edge Requests (franquia 10 M) e tráfego (franquia 1 TB): dentro da franquia | 0,00 | [1][3] T, H |
| Supabase Pro | preço base por organização | 25,00 | [18] F |
| Computação do banco | produção Small 0,0206 × 730 = 15,04; staging Micro 0,01344 × 730 = 9,81; crédito de 10,00: 15,04 + 9,81 − 10,00 = 14,85 | 14,85 | [19][20] F |
| Disco do banco (produção) | (10 − 8 GB inclusos) × 0,125 = 0,25 | 0,25 | [19][21] F, H |
| E-mail (SMTP próprio, obrigatório) | Amazon SES, São Paulo: 1.000 × 0,0001 = 0,10 | 0,10 | [55] F, H |
| Backup do banco: diário do Supabase | 7 dias, incluso no Pro | 0,00 | [18][24] F |
| Backup do banco: dumps externos no R2 | 70 GB × 0,015 = 1,05 | 1,05 | [44] F, H |
| Monitoramento: Sentry Team | 26,00 (anual; 29,00 no mensal) | 26,00 | [63][64] T |
| Monitoramento: Observability Plus (alertas, logs de 30 dias) | 1 M eventos × 1,20 = 1,20 | 1,20 | [8] T, H |
| Uptime (UptimeRobot ou Better Stack Free), Turnstile, Firewall e rate limit da Vercel | franquias gratuitas | 0,00 | [10][47][65][66] T, NC |
| **Subtotal fixo** | 40,00 + 25,00 + 14,85 + 0,25 + 0,10 + 1,05 + 26,00 + 1,20 | **108,45** | CP |

Linhas que variam com os arquivos:

| Linha | Conta | 50 GB | 500 GB | 1 TB | Fonte |
|---|---|---|---|---|---|
| Armazenamento (Supabase Storage) | (N − 100 GB inclusos) × 0,0213 | 0,00 | 400 × 0,0213 = 8,52 | 900 × 0,0213 = 19,17 | [22] F |
| Saída de arquivos | (300 − 250 GB inclusos) × 0,09 (conservador, sem acerto de cache); com cache seria 50 × 0,03 = 1,50 | 4,50 | 4,50 | 4,50 | [18][23] F, H |
| Backup externo dos arquivos (R2, outro provedor) | (N − 10 GB grátis) × 0,015 | 40 × 0,015 = 0,60 | 490 × 0,015 = 7,35 | 990 × 0,015 = 14,85 | [44] F |
| **Subtotal variável** | | 5,10 | 20,37 | 38,52 | CP |
| **Total A (USD)** | 108,45 + subtotal | **113,55** | **128,82** | **146,97** | CP |
| **Total A (BRL, × 5,00)** | | R$ 567,75 | R$ 644,10 | R$ 734,85 | CP |

Notas do cenário A:
- Staging: segundo projeto Supabase Micro na mesma organização (alternativa: branch persistente, mesmo preço de US$ 9,81) [39]; na Vercel, o Pro inclui 1 ambiente customizado, usado como staging [6] T.
- O crédito de US$ 20 da Vercel cobre o uso estimado (6,85). Se cada seat extra soma outros US$ 20 de crédito é NC [2].
- Com o teto de gasto (spend cap) do Supabase ligado, usar Storage acima de 100 GB fica bloqueado; para importar 500 GB a 1 TB o teto precisa ficar desligado [26] F. O teto não cobre computação de qualquer forma.
- Resend Free (0) ou Pro (20) no lugar do SES muda o total em −0,10 ou +19,90 (valores do Resend NC) [57].

### 2.2 Cenário B: Vercel Pro + Supabase Pro (banco e login) + R2 (arquivos) + Resend (e-mail)

Linhas fixas:

| Linha | Conta | US$/mês | Fonte |
|---|---|---|---|
| Assentos Vercel | 20 + 20 | 40,00 | [1][2] T |
| Computação e tráfego Vercel | igual ao cenário A (6,85 dentro do crédito de 20) | 0,00 | [3][4] T, H |
| Supabase Pro | base | 25,00 | [18] F |
| Computação do banco | 15,04 + 9,81 − 10,00 | 14,85 | [19][20] F |
| Disco do banco | (10 − 8) × 0,125 | 0,25 | [19][21] F, H |
| E-mail Resend, plano Free (3.000/mês e 100/dia) | 0,00 (Pro seria 20,00) | 0,00 | [57] NC |
| Backup do banco: diário do Supabase | incluso | 0,00 | [24] F |
| Backup do banco: dumps no R2 | 70 GB × 0,015 | 1,05 | [44] F, H |
| Sentry Team | | 26,00 | [63][64] T |
| Observability Plus | 1 M × 1,20 | 1,20 | [8] T, H |
| **Subtotal fixo** | 40,00 + 25,00 + 14,85 + 0,25 + 0,00 + 1,05 + 26,00 + 1,20 | **108,35** | CP |

Linhas que variam com os arquivos:

| Linha | Conta | 50 GB | 500 GB | 1 TB | Fonte |
|---|---|---|---|---|---|
| Arquivos no R2 | (N − 10 GB grátis) × 0,015 | 0,60 | 7,35 | 14,85 | [44] F |
| Saída do R2 | 300 GB × 0,00 (saída grátis) | 0,00 | 0,00 | 0,00 | [44] F |
| Saída do Supabase | só API e login: dentro dos 250 GB | 0,00 | 0,00 | 0,00 | [23] F, H |
| Operações do R2 | dentro de 1 M Classe A e 10 M Classe B grátis | 0,00 | 0,00 | 0,00 | [44] F, H |
| Cópia dos arquivos em outro provedor (Backblaze B2) | (N ÷ 1.000) × 6,95 | 0,35 | 3,48 | 6,95 | [56] NC |
| **Subtotal variável** | | 0,95 | 10,83 | 21,80 | CP |
| **Total B (USD)** | 108,35 + subtotal | **109,30** | **119,18** | **130,15** | CP |
| **Total B (BRL, × 5,00)** | | R$ 546,50 | R$ 595,90 | R$ 650,75 | CP |

Notas do cenário B:
- A cópia dos arquivos não pode ficar no mesmo provedor do original. Se o B2 não for aprovado, usar S3 em São Paulo (USD 0,0405/GB) [54] F: 50 GB = 2,03; 500 GB = 20,25; 1 TB = 40,50. A diferença sobre o B2 é +1,68 (2,03 − 0,35), +16,77 (20,25 − 3,48) e +33,55 (40,50 − 6,95).
- O R2 não tem dica de localização para a América do Sul (opções: wnam, enam, weur, eeur, apac, oc) [46] F; a lista veio de um resumo e a latência a partir do Brasil não foi medida.

### 2.3 Cenário C: container Node + Neon (Postgres) + R2, autogerido

Escolhi Fly.io para o container por ser a única opção de container com região em São Paulo nos arquivos (preço e região NC) [58][59]; alternativas na seção 2.4.

Linhas fixas:

| Linha | Conta | US$/mês | Fonte |
|---|---|---|---|
| Assentos | sem cobrança por assento (não confirmado para Fly.io); GitHub Actions dentro da franquia | 0,00 | [58][68] NC |
| Container de produção (API + estático, 2 máquinas shared-cpu-1x 1 GB) | 2 × 6,70 = 13,40 | 13,40 | [58] NC |
| Container de staging (1 máquina) | 1 × 6,70 | 6,70 | [58] NC, H |
| Neon Launch, produção, sempre ligado | 0,5 CU × 730 h = 365 CU-h × 0,106 = 38,69; disco 10 GB × 0,35 = 3,50; soma 42,19 | 42,19 | [52] F, H |
| Neon, staging | 20 CU-h × 0,106 = 2,12; 1 GB × 0,35 = 0,35; soma 2,47 | 2,47 | [52] F, H |
| Neon, histórico de restauração (até 7 dias no Launch) | 10 GB × 0,20 = 2,00 | 2,00 | [52] F, H |
| Neon, saída | 500 GB por projeto incluídos | 0,00 | [52] F |
| Tráfego do app (Fly.io, América do Sul) | 20 GB × 0,04 = 0,80 | 0,80 | [58] NC, H |
| E-mail (SES) | 1.000 × 0,0001 | 0,10 | [55] F, H |
| Backup do banco: dumps no R2 | 70 GB × 0,015 | 1,05 | [44] F, H |
| Sentry Team | | 26,00 | [63][64] T |
| Uptime, Turnstile, Cloudflare Free na frente do container | franquias gratuitas | 0,00 | [47][48][65] T, NC |
| **Subtotal fixo** | 13,40 + 6,70 + 42,19 + 2,47 + 2,00 + 0,80 + 0,10 + 1,05 + 26,00 | **94,71** | CP |

Linhas que variam com os arquivos:

| Linha | Conta | 50 GB | 500 GB | 1 TB | Fonte |
|---|---|---|---|---|---|
| Arquivos no R2 (saída grátis) | (N − 10) × 0,015 | 0,60 | 7,35 | 14,85 | [44] F |
| Cópia em outro provedor (B2) | (N ÷ 1.000) × 6,95 | 0,35 | 3,48 | 6,95 | [56] NC |
| **Subtotal variável** | | 0,95 | 10,83 | 21,80 | CP |
| **Total C (USD)** | 94,71 + subtotal | **95,66** | **105,54** | **116,51** | CP |
| **Total C (BRL, × 5,00)** | | R$ 478,30 | R$ 527,70 | R$ 582,55 | CP |

Notas do cenário C:
- Se a computação do Neon suspender fora do expediente (suspende após 5 minutos de inatividade no Launch), o banco de produção cai de 42,19 para 15,16 (110 CU-h × 0,106 = 11,66 + 3,50; as 220 h ativas são H) [52]. Economia de 27,03 (42,19 − 15,16); totais passam a 68,63, 78,51 e 89,48.
- Sem o login do Supabase: o código atual chama o Supabase Auth para convite e login (`src/auth/gotrue.js`; `docs/API.md` §9). O custo de refazer o login e construir o SSO não está nas contas (não há número nas fontes).

### 2.4 Comparação e sensibilidades

| Comparação | 50 GB | 500 GB | 1 TB |
|---|---|---|---|
| A − B (USD) | 113,55 − 109,30 = 4,25 | 128,82 − 119,18 = 9,64 | 146,97 − 130,15 = 16,82 |
| A − C (USD) | 113,55 − 95,66 = 17,89 | 128,82 − 105,54 = 23,28 | 146,97 − 116,51 = 30,46 |

Sensibilidades sobre o cenário A em 500 GB (US$ 128,82):

| Variação | Conta | Resultado |
|---|---|---|
| Sentry Developer (grátis, 1 usuário) em vez de Team | 128,82 − 26,00 | 102,82 (R$ 514,10) [63] T |
| Apenas 1 seat na Vercel | 128,82 − 20,00 | 108,82 (R$ 544,10) [2] T |
| Os dois cortes acima | 128,82 − 46,00 | 82,82 (R$ 414,10) |
| Sentry cobrado no mensal | 29,00 − 26,00 | +3,00 [63] T |
| Saída de 1.000 GB/mês sem cache | (1.000 − 250) × 0,09 = 67,50; menos 4,50 da base | +63,00 (R$ 315,00) [23] F, H |
| Saída de 1.000 GB/mês com cache | (1.000 − 250) × 0,03 = 22,50; menos 4,50 | +18,00 (R$ 90,00) [23] F, H |
| Cópia dos arquivos em S3 São Paulo em vez de R2 | 20,25 − 7,35 | +12,90 (+25,65 em 1 TB; +1,43 em 50 GB) [54] F |
| Computação do banco em Medium (4 GB) | 0,0822 × 730 = 60,01; menos 15,04 | +44,97 [19] F |

Alternativas de hospedagem da API consideradas (todas com pontos NC; fonte `vercel.md` §13):

| Opção | Preço-base | Ressalva principal | Fonte |
|---|---|---|---|
| Cloudflare Workers Paid | a partir de US$ 5/mês; sem cobrança de egress | runtime Workers (não Node puro); São Paulo não confirmado como região | [51] T |
| Netlify Pro | US$ 20/mês (3.000 créditos) | função síncrona de 60 s; payload de 6 MB | [62] T |
| Render Standard | US$ 25/mês (1 CPU, 2 GB), mais taxa de workspace se aplicável (NC) | sem região em São Paulo | [60] T, NC |
| Railway Pro | US$ 20/mês de uso mínimo; cerca de US$ 30 com 1 vCPU e 1 GB (CP) | sem São Paulo (NC) | [61] T, NC |
| Fly.io | cerca de US$ 6,70 por máquina de 1 GB | preço, região `gru` e conformidade NC | [58][59] NC |

### 2.5 Itens que não estão nos totais

| Item | Preço | Conta | Quando considerar | Fonte |
|---|---|---|---|---|
| PITR de 7 dias (produção) | 0,137/h | 0,137 × 730 = 100,01 (R$ 500,05); exige Small | quando perder até 24 h de dados deixar de ser aceitável (com PITR o backup diário deixa de ser feito) | [25] F |
| Supabase Team | 599/mês | 599 − 25 = +574,00 (R$ 2.870,00) | se a A&M exigir relatório SOC 2 do fornecedor, SLA de suporte ou audit logs da plataforma | [18][37] F |
| Cofre de senhas (1Password Teams Starter) | 24,95/mês | R$ 124,75 | recomendado para 2 a 3 administradores | [67] NC |
| Log drain da Vercel | 0,50/GB | 3 GB × 0,50 = 1,50 (R$ 7,50), 3 GB é H | se a retenção de 1 dia atrapalhar investigações | [9] T |
| Resend Pro | 20/mês | R$ 100,00 | se passar de 100 e-mails/dia ou 3.000/mês | [57] NC |
| Password Protection do staging (Vercel) | 20/mês por projeto | R$ 100,00 | só se Vercel Authentication (grátis) não bastar | [16] T |
| Log drain do Supabase | 60/mês por drain, mais 0,20 por milhão de eventos e 0,09/GB | 60,00 + volume | adiar | [42] F |
| Complemento IPv4 do Supabase | 4/mês por projeto (0,0055/h) | | só se usar conexão direta; o pooler em modo transação é IPv4 | [38][41] F |
| Better Stack pago (alerta por telefone) | 29 por responder | | adiar | [66] NC |
| Neon Scale (SLA, SOC 2, ISO) em vez de Launch | 0,222/CU-h | 365 × 0,222 = 81,03; mais 3,50 = 84,53; 84,53 − 42,19 = +42,34 | só no cenário C, se o relatório SOC 2 do banco for exigido | [52] F |

## 3. Segurança, capacidade e limitações

### 3.1 Segurança e conformidade

| Tema | A: Vercel Pro + Supabase Pro | B: diferenças | C: container + Neon + R2 |
|---|---|---|---|
| Certificações | Vercel: SOC 2 Tipo 2 (01/07/2025 a 30/06/2026), ISO 27001:2022, PCI DSS v4.0 [14] T. Supabase: SOC 2 Tipo 2, mas o relatório só vai a clientes Team e Enterprise [37] F; ISO 27001 listado em Team e Enterprise [18], acesso ao certificado NC | Cloudflare (R2): ISO 27001:2022, ISO 27701, ISO 27018, SOC 2 Tipo II, PCI DSS nível 1 [49] T. Resend: NC | Neon: SOC 2, ISO, GDPR, HIPAA (cobrança extra) e SLA só no plano Scale [52] F. Fly.io: NC |
| DPA e LGPD | Vercel: DPA publicado; se vale para o Pro é NC [13]. Supabase: DPA existe; restrição por plano NC. Nenhum cita a LGPD de forma explícita (NC) | Cloudflare: DPA no painel, com cláusulas-padrão [50] T | Neon: GDPR só na Scale |
| SLA e suporte | Vercel Pro: suporte por e-mail, sem SLA (99,99% só no Enterprise) [15][16] T. Supabase: SLA de disponibilidade só no Enterprise; Team tem suporte prioritário com SLA [18] F | = A | Neon: SLA só na Scale. Hosts de container: NC |
| WAF e abuso | Vercel Firewall em todos os planos: DDoS e bloqueio de IP grátis, até 40 regras customizadas, rate limit com 1 M de requisições incluídas e depois 0,50 por milhão; OWASP gerenciado só no Enterprise [10] T. Cloudflare em modo proxy na frente da Vercel não é recomendado [17] T | Turnstile grátis para login, convite e recuperação [47] T | Pode usar Cloudflare na frente do container sem a restrição da Vercel; plano Free com 1 regra de rate limit (NC) [48] |
| Segredos | Variáveis da Vercel (64 KB por deployment, até 1.000 por ambiente) e secrets de ambiente do GitHub; chave de serviço do Supabase e chaves S3 ignoram as regras de acesso do banco e só podem ficar no servidor [28] F | = A | Segredos do host: NC |
| Login | Supabase Pro: checagem de senha vazada, timeout de sessão e sessão única [43] F; log de auditoria do Auth por 7 dias [18] F; limites por IP (login e cadastro: 30 por 5 min) [34] F | = A | A implementar na aplicação |
| Logs e auditoria | Logs da Vercel: 1 dia (30 com Observability Plus); do Supabase: 7 dias; audit logs de plataforma só em Team e Enterprise [8][18]. A auditoria de negócio fica no Postgres da aplicação | = A | Logs do host: NC |

### 3.2 Capacidade e limites que moldam o desenho

| Limite | A e B (Vercel + Supabase) | C (container) | Fonte |
|---|---|---|---|
| Corpo de requisição e de resposta | **Functions da Vercel: 4,5 MB**; acima disso responde 413 `FUNCTION_PAYLOAD_TOO_LARGE`. Uploads e downloads de arquivos vão direto ao armazenamento por URL assinada; a API recebe só metadados e hash. O JSON do deck também precisa ficar abaixo de 4,5 MB (as imagens são externalizadas pelo cliente de nuvem, `docs/API.md` §10) | sem limite de corpo | [5] T |
| Duração por requisição | 300 s padrão, 800 s no máximo (1.800 s em beta) | sem limite de função | [5] T |
| Concorrência | Vercel: até 30.000 execuções simultâneas | 1 container compartilhado: capacidade não medida | [6] T |
| Conexões ao banco (Supabase) | Micro: 60 diretas, 200 pelo pooler. Small: 90 e 400. Medium: 120 e 600. 50 usuários simultâneos cabem no modo transação (porta 6543), por inferência | Neon: limite de conexões NC (Launch vai até 16 CU) | [19][38] F |
| Tamanho de arquivo no armazenamento | Supabase: até 500 GB por arquivo (Pro); upload padrão até 6 MB, acima disso retomável (TUS) | R2: objeto de até 5 TiB; 1 escrita por segundo na mesma chave | [30][45] F |
| Ambientes | Vercel Pro: 1 ambiente customizado (staging) e previews. Supabase: 2 projetos ou branch persistente | a montar | [6][39] |
| Cron | Vercel: 100 por projeto, mínimo de 1 por minuto; backups não devem depender dele | agendador do host ou GitHub Actions | [6] T |

### 3.3 Tráfego de saída (egress)

| Fornecedor | Incluído | Excedente | Fonte |
|---|---|---|---|
| Vercel Pro (tráfego rápido) | 1 TB/mês; 10 M Edge Requests | gru1: US$ 0,22/GB e US$ 3,20 por milhão (base: 0,15/GB e 2,00 por milhão) | [1][3] T |
| Supabase Pro | 250 GB sem cache e 250 GB com cache, por organização, somando banco, Auth e Storage | US$ 0,09/GB e US$ 0,03/GB. URL assinada com token único é uma chave de cache distinta (cache pouco útil se a URL mudar a cada pedido) | [18][23][29] F |
| Cloudflare R2 | saída grátis | operações: Classe A US$ 4,50 por milhão; Classe B US$ 0,36 por milhão | [44] F |
| Neon | 500 GB por projeto por mês | US$ 0,10/GB | [52] F |
| Container (Fly.io, Render, Railway) | NC; Fly.io US$ 0,04/GB América do Sul; Render US$ 0,15/GB; Railway US$ 0,05/GB (todos NC) | | [58][60][61] NC |

### 3.4 SAML e SSO futuro (Entra ID)

| Opção | O que as fontes dizem | Fonte |
|---|---|---|
| Supabase Pro (A e B) | SAML 2.0 a partir do Pro, com Entra ID/Azure listado. 50 usuários SSO por ciclo inclusos, depois US$ 0,015 por usuário: 100 usuários SSO = 50 × 0,015 = 0,75. **Conta SAML não se vincula à conta e-mail/senha existente** (o mesmo e-mail pode gerar duas contas): usar o UUID, não o e-mail, como chave e fazer a ligação por e-mail verificado na aplicação para preservar contas e dados | [31][32] F |
| Supabase, login Microsoft por OAuth | Disponível em todos os planos, com vinculação automática por e-mail verificado; preço por MAU nesse caminho NC | [32] F |
| Neon (C) | Não oferece login: é preciso código próprio ou serviço externo | [52] |
| Clerk Pro (serviço externo) | US$ 25/mês com 1 conexão SSO; extras US$ 75 cada (todos NC) | [69] NC |
| Microsoft Entra External ID | A documentação confirma que um tenant Entra pode ser federado por OIDC personalizado; preço e franquia NC | [70] F (federação), NC (preço) |

### 3.5 Backups e restauração

| Item | A e B (Supabase) | C (Neon) | Fonte |
|---|---|---|---|
| Backup diário do banco | Pro: 7 dias; Team: 14 dias. Apagar o projeto apaga os backups | histórico de restauração de até 7 dias no Launch (30 na Scale), cobrado a US$ 0,20/GB-mês | [24][52] F |
| Recuperação ponto no tempo | PITR: US$ 100/200/400 por mês (7/14/28 dias); exige Small; perda máxima de 2 minutos; com PITR o backup diário deixa de ser feito | incluída no histórico acima | [25] F |
| Como restaurar | Pelo painel, com o projeto inacessível durante o processo; ou "restaurar em novo projeto" (planos pagos), que copia banco, usuários do Auth e papéis, mas **não** os objetos do Storage, as configurações do Auth nem as chaves | a validar | [24][27] F |
| Arquivos (objetos) | **O backup do Supabase não inclui objetos**; não há versionamento S3; objetos apagados são removidos em definitivo | R2: versionamento e trava de objeto não verificados | [24][28] F |
| Rotina mínima | Dump lógico diário criptografado para bucket em outro provedor, cópia dos objetos em outro provedor, heartbeat ao monitor de uptime, teste de restauração mensal com registro de data, duração e conferência de contagens | igual | `monitoramento-backup-seguranca.md` §5 |

### 3.6 Regiões e residência de dados

| Componente | A | B | C | Fonte |
|---|---|---|---|---|
| API | Vercel `gru1` (São Paulo); o padrão é `iad1` (EUA), então fixar a região | = A | Fly.io `gru` (NC); Render e Railway sem São Paulo | [7][59][60][61] T, NC |
| Banco | Supabase `sa-east-1` | = A | Neon `aws-sa-east-1` (a região não pode mudar depois) | [36][53] F |
| Arquivos | Supabase Storage em `sa-east-1` | R2 sem região na América do Sul: transferência internacional (LGPD art. 33; Resolução CD/ANPD nº 19/2024) | = B | [46][71][72] |
| E-mail | SES em São Paulo | Resend com região `sa-east-1` (NC) | SES | [55][57] |
| Arquivos estáticos | borda global da Vercel (não é possível garantir só Brasil) | = A | do container | [7] T |
| Cópia de backup | se a residência no Brasil for exigida: S3 em São Paulo (US$ 0,0405/GB); senão R2 ou B2 com criptografia do lado do cliente | = A | = A | [54] F |

## 4. Recomendação final

### 4.1 Decisão

Contratar o **cenário A em São Paulo**, com cópia externa criptografada. Motivos:
1. Menor esforço de operação: HTTPS automático, ambientes, previews, banco, login, convite e SAML no mesmo fornecedor de cada camada; a plataforma já foi construída sobre Supabase Auth e pooler em modo transação.
2. Arquivos em São Paulo, sem questão de transferência internacional para o conjunto principal.
3. O ganho de B (US$ 4,25 a US$ 16,82 por mês) e de C (US$ 17,89 a US$ 30,46) é pequeno diante dos custos fixos e do trabalho extra (Auth próprio, SAML, container, preços NC).
4. A troca de A para B depois é de baixo risco, pois os objetos são endereçados por conteúdo (basta copiá-los) e o armazenamento é configurado por `S3_ENDPOINT`, `S3_BUCKET` e chaves (`docs/API.md` §9).

### 4.2 Contratar já

| Item | Configuração | US$/mês (50 GB / 500 GB / 1 TB) | Fonte |
|---|---|---|---|
| Vercel Pro, 2 seats | Functions em `gru1`; ambiente customizado "staging"; Spend Management com alerta (conferir se o teto pausa a produção); rate limit do WAF em login, convite e recuperação; Vercel Authentication no staging | 40,00 | [1][2][10][12] |
| Supabase Pro, 1 organização | 2 projetos em `sa-east-1` (produção Small, staging Micro); pooler na porta 6543; SMTP próprio antes do primeiro convite; spend cap desligado durante a importação do acervo | 25,00 + 14,85 + 0,25 = 40,10 | [18][19][26] |
| Storage do Supabase (S3) e saída | (N − 100) × 0,0213 mais 4,50 de saída | 4,50 / 13,02 / 23,67 | [22][23] |
| Cópia externa (R2), criptografada, credenciais próprias | arquivos (N − 10) × 0,015 mais dumps 1,05; job no GitHub Actions com heartbeat | 1,65 / 8,40 / 15,90 | [44] |
| E-mail transacional | SES (0,10) ou Resend Free (0, NC); SPF, DKIM e DMARC | 0,10 | [55][57] |
| Sentry Team (Developer, grátis, se só 1 pessoa acompanhar) | limpeza de dados pessoais antes do envio | 26,00 | [63][64] |
| Observability Plus | alertas e 30 dias de logs | 1,20 | [8] |
| Uptime, Turnstile, Firewall | UptimeRobot ou Better Stack Free (uso comercial do UptimeRobot NC) | 0,00 | [65][66][47] |
| **Total** | soma das linhas | **113,55 / 128,82 / 146,97** (R$ 567,75 / 644,10 / 734,85) | CP |

Extras recomendados fora do total: cofre de senhas 24,95 (NC) e log drain 1,50, ou seja, 26,45 (R$ 132,25).

### 4.3 Adiar (com gatilho)

| Item | Custo | Gatilho para contratar |
|---|---|---|
| PITR | +100,01 | perda de até 24 h de dados deixa de ser aceitável |
| Supabase Team | +574,00 | A&M exige relatório SOC 2/ISO do fornecedor, SLA de suporte ou audit logs da plataforma |
| Enterprise (Vercel ou Supabase) | sob consulta (NC) | A&M exige SLA de disponibilidade |
| Computação Medium no banco | +44,97 | CPU ou conexões do banco em saturação |
| Migrar arquivos para R2 (cenário B) | economia de 9,64 (500 GB) a 16,82 (1 TB) mais a saída | saída de arquivos passar de cerca de 1 TB/mês (custo extra de 18,00 a 63,00 no Supabase) ou o custo de saída virar problema; medir antes a latência do R2 a partir dos escritórios |
| Log drains, Better Stack pago, Doppler, Cloudflare Pro | ver seção 2.5 | retenção de 1 dia ou plantão por telefone se tornarem necessários |
| SSO (SAML) | 0,00 até 50 usuários SSO | quando a A&M entregar o tenant Entra |

### 4.4 Riscos e mitigação

| Risco | Evidência | Mitigação |
|---|---|---|
| Perda de arquivos: o backup do Supabase não cobre objetos, não há versionamento e a exclusão é definitiva | [24][28] | Cópia externa em outro provedor, com credenciais separadas e sem permissão de exclusão para o job; teste de restauração mensal |
| Custo de saída e cache fraco com URLs assinadas | [23][29] | Reutilizar a mesma URL assinada por janela de tempo; monitorar o uso em Organização > Usage; gatilho de migração para R2 |
| Importar 500 GB a 1 TB com o spend cap ligado fica bloqueado; o Supabase não envia alerta de custo | [26] | Desligar o teto na importação e acompanhar o uso manualmente |
| Spend Management da Vercel, com teto padrão de US$ 200, pode pausar a produção (NC) | [11][12] | Conferir o changelog e ajustar teto e alertas antes do lançamento |
| Limites do Auth contam por IP e a API intermediária concentra todos no IP do servidor | [34] | Habilitar o cabeçalho `Sb-Forwarded-For` nas configurações de rate limit |
| Convite expira em 1 hora por padrão | [35] | Ajustar o tempo de expiração do convite e o template de e-mail |
| SMTP padrão do Supabase só envia a e-mails da equipe (2 por hora) | [33] | Configurar SMTP próprio antes do primeiro convite |
| SAML cria contas separadas das de e-mail/senha | [31][32] | Chave interna estável na aplicação e ligação por e-mail verificado |
| Sem relatório SOC 2 do Supabase no Pro e sem SLA na Vercel Pro | [15][37] | Levar a exigência à segurança da A&M antes de contratar; se for requisito, Team (+574,00) ou, com troca de Auth, Neon Scale (+42,34 sobre o Launch) |
| Logs de 1 dia na Vercel e 7 dias no Supabase | [8][18] | Auditoria de negócio no Postgres; log drain se preciso |
| Dados pessoais fora do Brasil (R2, B2, Sentry, Resend) | [46][72] | Criptografia do lado do cliente nas cópias; DPAs; cláusulas-padrão; decisão jurídica da A&M |
| Pagamento só por cartão em USD; fatura vencida pausa os projetos | [40] | Cartão corporativo internacional com limite adequado e dois responsáveis |
| Preços NC (Vercel por seat, Resend, B2, Fly.io, 1Password) | seção 6 | Abrir as páginas oficiais e conferir antes de contratar |

## 5. Dependências externas que o cliente precisa providenciar

| Item | Para quê | Observação |
|---|---|---|
| Domínio e acesso ao DNS (ex.: `canteiro.<domínio da A&M>`) | HTTPS, verificação de domínio na Vercel, links de convite (`APP_ORIGIN`) | Alguém com permissão para criar CNAME e TXT |
| Remetente de e-mail e registros SPF, DKIM e DMARC | Convite e recuperação de senha chegarem à caixa de entrada | Usar subdomínio de envio; definir caixa para relatórios DMARC; com SES, pedir saída do sandbox (NC) |
| Conta do provedor de e-mail (SES ou Resend) e credenciais SMTP | SMTP próprio no Supabase Auth | O SMTP padrão não serve para produção |
| Cartão de crédito corporativo internacional | Pagar Vercel e Supabase (Supabase só aceita cartão, em USD) | Definir titular, limite e dois administradores por conta |
| Contas: Vercel, Supabase, GitHub (organização, repositório privado, secrets por ambiente), provedor de cópia (R2, B2 ou S3), Sentry, monitor de uptime | Operação | Dois owners por organização; MFA nas contas |
| Tenant Microsoft Entra ID e um administrador | SSO SAML ou OIDC no futuro | Metadados do IdP, domínio de e-mail, política de provisionamento e decisão de ligação de contas |
| Decisões de compliance | Residência no Brasil, DPAs assinados, encarregado (DPO), registro das operações, plano de incidente com prazo de 3 dias úteis para comunicar a ANPD [73], retenção, aprovação de fornecedores (Sentry, Cloudflare ou Backblaze, Resend) | Parecer jurídico e da segurança da informação; definir se o relatório SOC 2 é exigido |
| Responsáveis operacionais | Rotação de segredos, plantão (e-mail ou Teams), cofre de senhas, chaves de criptografia do backup | As chaves de backup ficam com a A&M, nunca no provedor da cópia |
| Acervo local para importação | Importar 500 GB a 1 TB | Banda de upload e janela de importação; spend cap desligado |
| GitHub com GitHub Advanced Security (CodeQL em repositório privado) **ou** desligar o workflow `codeql.yml` | Análise estática no CI | Em organização sem GHAS o CodeQL falha em repositório privado |
| Python 3 no build da Vercel e no CI | O site é montado por `build-web`, que chama `python3` para montar o editor | A imagem padrão da Vercel e o `ubuntu-latest` do GitHub já trazem Python 3 |
| Ferramentas de teste locais: Node 22, PostgreSQL 16 ou 17 (servidor e cliente), Chromium via Playwright, Python 3 com `moto[server]` e `python-pptx` | Rodar as suítes, o ensaio de restauração e a prova de paridade fora do CI | `platform/README.md` → “Pré-requisitos” |
| Saída do *sandbox* do Amazon SES e verificação do remetente (se SES) | Enviar e-mails a destinatários não verificados | Pedido à AWS; costuma levar 24–48 h |
| Confirmação do uso comercial do monitor de uptime gratuito (UptimeRobot/Better Stack) | Monitoramento externo | Ou contratar o plano pago |
| Conferência dos preços NC nas páginas oficiais | Fechar o orçamento | Seção 6 |

## 6. Itens não confirmados

- **Cotação**: PTAX de 06/10/2026 (usei R$ 5,00 por US$ 1,00 como premissa). IOF e impostos não incluídos [74].
- **Vercel**: se cada seat extra soma US$ 20 de crédito; se o teto do Spend Management pausa a produção por padrão; se o DPA vale para o Pro; menção explícita à LGPD [2][11][13]. Valores lidos por trechos de busca, sem abrir as páginas.
- **Supabase**: valores lidos dos arquivos-fonte do repositório oficial (podem estar à frente ou atrás do site); acesso ao certificado ISO 27001 por plano; DPA por plano e LGPD; alertas nativos de custo e infraestrutura; tamanho padrão do pool; preço por MAU no login Microsoft por OAuth [18].
- **Neon**: histórico de restauração depende da taxa de alteração (usei 10 GB, H); limites de conexão.
- **Cloudflare R2**: lista de localização sem América do Sul veio de resumo; latência a partir do Brasil não medida [46].
- **Backblaze B2**: todos os valores (6,95 por TB e regras de saída) e a região no Brasil [56].
- **Resend**: planos, limites e região `sa-east-1` [57]. **SES**: sandbox e preço aplicável a conta nova (se fosse o plano Essentials, 1.000 e-mails custariam 0,16) [55].
- **Fly.io, Render, Railway**: preços, regiões, assentos e conformidade; latência Brasil x EUA para Render e Railway [58][60][61].
- **Sentry**: região de dados, DPA e preço de excedente; **UptimeRobot**: uso comercial do plano gratuito; **1Password**: preço do Teams Starter; **Clerk e Entra External ID**: preços [63][65][67][69][70].
- **Hipóteses de volume (H)** da seção 0: se o uso real divergir, refazer as contas (as fórmulas estão nas tabelas).

## Fontes

Todas consultadas em 2026-10-06 por meio dos 4 arquivos de pesquisa desta pasta (arquivo-fonte oficial, lista oficial de preços da AWS ou trecho de busca restrita ao domínio oficial; ver seção 0). Nenhuma página foi reaberta ao escrever este arquivo.

1. https://vercel.com/pricing
2. https://vercel.com/docs/plans/pro-plan
3. https://vercel.com/docs/pricing/regional-pricing/gru1
4. https://vercel.com/docs/functions/usage-and-pricing
5. https://vercel.com/docs/functions/limitations
6. https://vercel.com/docs/limits
7. https://vercel.com/docs/regions
8. https://vercel.com/docs/observability/observability-plus
9. https://vercel.com/docs/drains
10. https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing
11. https://vercel.com/docs/spend-management
12. https://vercel.com/changelog/spend-management-now-pauses-production-deployments-by-default
13. https://vercel.com/legal/dpa
14. https://vercel.com/kb/guide/is-vercel-soc-2-compliant
15. https://vercel.com/legal/sla
16. https://vercel.com/kb/guide/vercel-support-queue-time (suporte do Pro sem SLA) e https://vercel.com/docs/deployment-protection (Password Protection e Vercel Authentication)
17. https://vercel.com/kb/guide/cloudflare-with-vercel
18. https://supabase.com/pricing
19. https://supabase.com/docs/guides/platform/compute-and-disk
20. https://supabase.com/docs/guides/platform/manage-your-usage/compute
21. https://supabase.com/docs/guides/platform/manage-your-usage/disk-size
22. https://supabase.com/docs/guides/platform/manage-your-usage/storage-size
23. https://supabase.com/docs/guides/platform/manage-your-usage/egress
24. https://supabase.com/docs/guides/platform/backups
25. https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery
26. https://supabase.com/docs/guides/platform/cost-control
27. https://supabase.com/docs/guides/platform/clone-project
28. https://supabase.com/docs/guides/storage/s3/compatibility
29. https://supabase.com/docs/guides/storage/cdn/smart-cdn
30. https://supabase.com/docs/guides/storage/uploads/file-limits
31. https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
32. https://supabase.com/docs/guides/auth/auth-identity-linking
33. https://supabase.com/docs/guides/auth/auth-smtp
34. https://supabase.com/docs/guides/auth/rate-limits
35. https://supabase.com/docs/guides/auth/users
36. https://supabase.com/docs/guides/platform/regions
37. https://supabase.com/docs/guides/security/soc-2-compliance
38. https://supabase.com/docs/guides/database/connecting-to-postgres
39. https://supabase.com/docs/guides/deployment/managing-environments
40. https://supabase.com/docs/guides/platform/billing-faq
41. https://supabase.com/docs/guides/platform/ipv4-address
42. https://supabase.com/docs/guides/platform/manage-your-usage/log-drains
43. https://supabase.com/docs/guides/auth/password-security
44. https://developers.cloudflare.com/r2/pricing/
45. https://developers.cloudflare.com/r2/platform/limits/
46. https://developers.cloudflare.com/r2/reference/data-location/
47. https://developers.cloudflare.com/turnstile/plans/
48. https://www.cloudflare.com/plans/
49. https://www.cloudflare.com/trust-hub/
50. https://www.cloudflare.com/cloudflare-customer-dpa/
51. https://developers.cloudflare.com/workers/platform/pricing/
52. https://neon.com/docs/introduction/plans
53. https://neon.com/docs/introduction/regions
54. https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/sa-east-1/index.json
55. https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/current/index.json
56. https://www.backblaze.com/cloud-storage/pricing
57. https://resend.com/pricing
58. https://fly.io/docs/about/pricing/
59. https://fly.io/docs/reference/regions/
60. https://render.com/pricing
61. https://railway.com/pricing
62. https://www.netlify.com/pricing/
63. https://sentry.io/pricing/
64. https://docs.sentry.io/pricing/
65. https://uptimerobot.com/pricing/
66. https://betterstack.com/uptime
67. https://1password.com/pricing/business
68. https://docs.github.com/get-started/learning-about-github/githubs-products
69. https://clerk.com/pricing
70. https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-entra-id-federation-customers
71. https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
72. https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024
73. https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca (prazo de 3 dias úteis para comunicar incidente)
74. https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios
