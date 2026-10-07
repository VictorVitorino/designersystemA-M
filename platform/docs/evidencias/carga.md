# Evidências — teste de carga (50 e 100 usuários simultâneos)

Executado em 2026-10-06 21:21 UTC por `npm run test:load` (`platform/tests/load/run.js`), duração total 489 s. Resultado bruto: `.tmp/load/resultado-2026-10-06T21-21-15.json`; log da API: `.tmp/load/dev-2026-10-06T21-21-15.log` (ambos em `.tmp/`, fora do git).

## 1. Metodologia

- **Hardware/ambiente**: 4 CPUs (Intel(R) Xeon(R) Processor @ 2.80GHz), 15.7 GB de RAM, Linux 6.18.44-fc-v70, Node v22.22.0, PostgreSQL 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1) **local** (mesma máquina), armazenamento de arquivos em disco local (`STORAGE_DRIVER=local`), **sem rede** (cliente de carga, API e banco no mesmo host, em 127.0.0.1). A produção difere: Vercel Functions (sem estado, 1 instância por requisição concorrente, pool de 5 por instância), Supabase Postgres atrás do pooler em modo transação (porta 6543), Supabase Storage/S3 por HTTPS, latência de rede real entre API e banco (~1–5 ms por ida e volta na mesma região) e entre navegador e API. Os números abaixo medem a **lógica** (SQL, RLS, lint, hash, validação de imagem, I/O) e servem de piso; latências de produção serão maiores em termo absoluto.
- **Pilha real** em um comando: `APP_ENV=local node tools/dev.js --port 4402 --db canteiro_t_load --admin admin@am.test --name "Admin" --reset` (Postgres local + GoTrue falso + build do site + API Hono; PID guardado e encerrado ao fim). Nenhum mock: cada requisição passa por CSRF, sessão (JWT ES256 + `app.resolve_identity`), limites de taxa em `app.hit_rate`, transação `SET LOCAL ROLE app_user` com RLS, lint de segurança do deck, hash canônico e validação de imagem por `sharp`.
- **Usuários**: 100 criados pela API como o admin faria (`POST /api/admin/invites` → e-mail na outbox do GoTrue falso → `POST /api/auth/verify` → `POST /api/auth/password`), cada um com cookie jar e CSRF próprios (sessão real, nunca token em JS) em 7.1 s. **Todas as sessões saem do mesmo IP (127.0.0.1)** — equivalente a um escritório inteiro atrás do mesmo NAT; `tools/dev.js` fixa `TRUST_PROXY=0`, então cabeçalhos `X-Forwarded-For` são ignorados (correto). Para ativar 100 contas foi preciso zerar o balde `verify_ip` (5 por 15 min por IP) antes de cada ativação — veja o achado A1.
- **Dados**: decks no formato do editor (`{v:1, app:'AM Studio', slides:[…]}`, texto rico, formas, linhas ligadas, componentes `fx`, notas) com 150–400 KB de JSON e **3 imagens já externalizadas** (`asset:sha256:…`) enviadas por **todos** os usuários (prova de deduplicação: 251 KB png, 422 KB png, 592 KB jpeg); imagens "novas" reais (PNG/JPEG de ruído incompressível, 200–800 KB): 80 % **únicas**, geradas na hora para cada envio (881 nesta execução, 437.4 MB), e 20 % de um conjunto de 30 imagens comuns (208–788 KB, 7 JPEG) que várias pessoas enviam; 1 imagem privada por usuário (8 KB, nunca referenciada) como alvo das sondas de vazamento; miniaturas únicas (`X-Asset-Kind: thumb`).
- **Mix por sessão** (`tests/load/scenario.cjs`, sequencial como um navegador): a cada 3–5 s um autosave (`PUT /content` com `baseRev`, deck inteiro, edição real do slide 1 → hash novo); em 20 % dos ciclos antes do autosave uma imagem nova de 200–800 KB (`POST /api/assets/check` + `PUT /api/assets/:sha`) passa a ser referenciada no deck; 1×/60 s a miniatura (`PUT /api/assets/:sha` thumb + `thumbSha` no PUT). Depois de cada autosave, UMA ação secundária sorteada: 25 % abrir acervo (`GET /api/presentations`), 20 % abrir apresentação alheia (`GET /:id`), 15 % listar versões, 15 % baixar um arquivo (`GET /api/assets/:sha`, tamanho conferido), 10 % criar cópia de apresentação alheia, 5 % comentar, 5 % sonda de vazamento (versões alheias → 403; arquivo privado alheio → 404; `PUT` em apresentação alheia → 403; `scope=mine` só com itens meus), 5 % salvamento obsoleto (`baseRev` errado → 409 **esperado**; um 200 aqui seria perda de integridade).
- **Medições**: por endpoint no cliente (req/s, p50/p95/p99 incluindo rede local e leitura do corpo; códigos de resposta classificados em ok / esperado / 429 / 4xx / 5xx / rede) e pela própria API (campo `ms` do log de acesso); `pg_stat_activity` do banco do teste a cada 2 s (total, ativas, idle in transaction, aguardando lock); `pg_database_size` e tamanho por tabela antes/depois; nº e bytes dos objetos em `.data/objects`; RSS/CPU do processo da API lidos de `/proc/<pid>`. Ao fim de cada fase: `GET /:id` e consulta direta ao banco de cada apresentação comparados com o **último PUT 200** de cada sessão (rev **e** hash canônico), `rev` final = inicial + nº de PUT 200 alterados; vazamentos = qualquer sonda com 200; deduplicação = linhas em `app.assets`/objetos em disco por imagem compartilhada × posses em `app.asset_uploads`.
- **Fases**: (1) 50 usuários × 180 s, limites por IP **como estão** (escritório atrás de um NAT); (2) 50 usuários × 180 s, limites por IP **neutralizados** (as linhas `%:ip` de app.rate_limits são apagadas a cada 2 s — simula usuários em IPs distintos: casa, VPN, cliente); (3) 100 usuários × 60 s, limites por IP **neutralizados** (as linhas `%:ip` de app.rate_limits são apagadas a cada 2 s — simula usuários em IPs distintos: casa, VPN, cliente). Entre fases, 5 s de pausa; cada fase cria apresentações novas para os seus usuários (as anteriores continuam no acervo).
- **Abertura do editor**: Chromium real (Playwright) abre `/editor/<id>` 10× em contexto novo e mede até a pílula "Salvo" com o deck hidratado; o original `original/Canteiro-AM (3).html` é aberto 10× em `file://` até `AMStudio` pronto.

## 2. Antes e depois

| Medida | Antes | Depois |
|---|---|---|
| Tamanho do banco `canteiro_t_load` | 8.37 MB | 232.2 MB (+223.8 MB) |
| Conexões ao banco (fora a do medidor) | 0 | 6 (max_connections 100) |
| Objetos no diretório de arquivos `.data/objects` (compartilhado por todas as instâncias locais) | 1.112 (206.3 MB) | 2.516 (660.2 MB); criados nesta execução: 1.404 (453.8 MB) |
| Linhas: apresentações / versões / comentários / auditoria / rate_limits | 0 (banco recriado com --reset) | 727 / 727 / 233 / 8.343 / 2.276 |

Tabelas ao fim (tamanho total com índices e TOAST):

| Tabela | Tamanho | Tuplas vivas | Tuplas mortas |
|---|---|---|---|
| app.presentations | 144.7 MB | 728 | 761 |
| app.presentation_versions | 69.9 MB | 728 | 0 |
| app.audit_log | 4.23 MB | 8.360 | 0 |
| app.asset_refs | 2.66 MB | 9.063 | 0 |
| app.assets | 0.68 MB | 1.406 | 108 |
| app.asset_uploads | 0.55 MB | 1.427 | 0 |
| app.rate_limits | 0.55 MB | 2.252 | 516 |
| app.comments | 0.20 MB | 234 | 0 |

## 3. Resultados por fase

### Fase 1 — 50 usuários × 180 s (limites por IP como estão)

Decks de 153 KB a 373 KB (média 263 KB), 5.294 requisições em 180.1 s (**29.4 req/s**), p50/p95/p99 geral 45 ms / 153 ms / 209 ms.
Mix executado: 2.177 ciclos de autosave, 1.743 PUT /content gravados (200), 421 imagens novas incorporadas aos decks — 355 enviadas de fato por `PUT /api/assets/:sha` (176.8 MB; 0 deduplicadas pelo servidor) e 66 que o `check` já dava como disponíveis (a mesma imagem comum enviada antes por outra pessoa e visível pelo acervo) —, 150 miniaturas, 167 cópias, 97 comentários, 300 downloads de arquivo, 111 sondas de vazamento, 122 salvamentos obsoletos (409 esperado).

Erros: **0 × 5xx**, 537 × 429 (limite de taxa), 0 × 4xx inesperados, 0 falhas de rede/tempo esgotado; 172 respostas esperadas das sondas (403/404/409).

**19.9 % dos autosaves (434 de 2.177) receberam 429** por causa do limite de escrita **por IP** (600/min = 5 × 120 do limite por usuário, janela fixa de 60 s): 50 pessoas salvando a cada 3–5 s geram ~750 PUT/min do mesmo IP; o balde enche a cada ~40 s e todos recebem 429 até a janela virar (veja as rajadas na linha do tempo). O editor real trataria cada 429 como "Sem conexão — alterações guardadas neste computador", com recuo exponencial de 1 s a 60 s. Nenhum dado se perdeu (o próximo autosave leva as edições; integridade abaixo), mas a experiência num escritório atrás de NAT seria essa. Os 429 em `POST /api/assets/check` e nas miniaturas vêm do balde de upload por IP (300/min).

#### Por endpoint (medido no cliente, inclui rede local e leitura do corpo)

| Endpoint | Req. | req/s | p50 | p95 | p99 | máx. | p95 (só 2xx) | Respostas por código | Transferido |
|---|---|---|---|---|---|---|---|---|---|
| GET /api/assets/:sha | 300 | 1.67 | 23 ms | 99 ms | 177 ms | 185 ms | 99 ms | 200: 300 | 139.8 MB |
| GET /api/assets/:sha `[alheio→404]` | 49 | 0.27 | 34 ms | 131 ms | 156 ms | 156 ms | — | 404: 49 | 0.01 MB |
| GET /api/presentations | 538 | 2.99 | 19 ms | 86 ms | 139 ms | 188 ms | 86 ms | 200: 538 | 5.97 MB |
| GET /api/presentations?scope=mine | 17 | 0.09 | 22 ms | 83 ms | 83 ms | 83 ms | 83 ms | 200: 17 | 0.02 MB |
| GET /api/presentations/:id | 437 | 2.43 | 27 ms | 93 ms | 121 ms | 209 ms | 93 ms | 200: 437 | 113.8 MB |
| GET /api/presentations/:id/versions | 358 | 1.99 | 16 ms | 87 ms | 104 ms | 201 ms | 87 ms | 200: 358 | 0.08 MB |
| GET /api/presentations/:id/versions `[alheia→403]` | 11 | 0.06 | 19 ms | 120 ms | 120 ms | 120 ms | — | 403: 11 | 0.00 MB |
| POST /api/assets/check | 433 | 2.4 | 17 ms | 84 ms | 134 ms | 170 ms | 84 ms | 200: 423, 429: 10 | 0.06 MB |
| POST /api/presentations/:id/comments | 97 | 0.54 | 30 ms | 103 ms | 215 ms | 215 ms | 103 ms | 201: 97 | 0.04 MB |
| POST /api/presentations/:id/duplicate | 214 | 1.19 | 75 ms | 176 ms | 224 ms | 259 ms | 198 ms | 201: 167, 429: 47 | 0.08 MB |
| PUT /api/assets/:sha | 357 | 1.98 | 52 ms | 172 ms | 248 ms | 331 ms | 172 ms | 201: 355, 429: 2 | 177.9 MB |
| PUT /api/assets/:sha `[thumb]` | 150 | 0.83 | 52 ms | 131 ms | 167 ms | 178 ms | 131 ms | 201: 150 | 2.27 MB |
| PUT /api/presentations/:id/content | 2.177 | 12.09 | 72 ms | 173 ms | 230 ms | 306 ms | 178 ms | 200: 1743, 429: 434 | 576.4 MB |
| PUT /api/presentations/:id/content `[alheia→403]` | 34 | 0.19 | 20 ms | 101 ms | 136 ms | 136 ms | — | 403: 27, 429: 7 | 0.01 MB |
| PUT /api/presentations/:id/content `[obsoleto→409]` | 122 | 0.68 | 36 ms | 98 ms | 155 ms | 210 ms | — | 409: 85, 429: 37 | 32.5 MB |

#### Latência medida pela própria API (log de acesso, campo `ms`)

| Rota (medida pela API) | Req. | p50 | p95 | p99 | máx. | 5xx | 429 |
|---|---|---|---|---|---|---|---|
| GET /api/assets/:sha | 349 | 19 ms | 87 ms | 129 ms | 154 ms | 0 | 0 |
| GET /api/presentations | 555 | 15 ms | 77 ms | 129 ms | 183 ms | 0 | 0 |
| GET /api/presentations/:id | 487 | 21 ms | 79 ms | 109 ms | 202 ms | 0 | 0 |
| GET /api/presentations/:id/versions | 369 | 14 ms | 78 ms | 103 ms | 196 ms | 0 | 0 |
| POST /api/assets/check | 433 | 12 ms | 70 ms | 126 ms | 156 ms | 0 | 10 |
| POST /api/presentations/:id/comments | 97 | 25 ms | 92 ms | 189 ms | 189 ms | 0 | 0 |
| POST /api/presentations/:id/duplicate | 214 | 73 ms | 174 ms | 206 ms | 253 ms | 0 | 47 |
| PUT /api/assets/:sha | 507 | 48 ms | 157 ms | 221 ms | 326 ms | 0 | 2 |
| PUT /api/presentations/:id/content | 2.333 | 64 ms | 156 ms | 210 ms | 283 ms | 0 | 478 |

#### Linha do tempo (janelas de 10 s)

| Janela (s) | Req. | req/s | PUT 200 | p95 PUT | p95 GET | 5xx | 429 | rede |
|---|---|---|---|---|---|---|---|---|
| 0–10 | 318 | 31.8 | 117 | 204 ms | 98 ms | 0 | 0 | 0 |
| 10–20 | 312 | 31.2 | 123 | 211 ms | 139 ms | 0 | 0 | 0 |
| 20–30 | 290 | 29 | 118 | 152 ms | 87 ms | 0 | 0 | 0 |
| 30–40 | 272 | 27.2 | 118 | 206 ms | 115 ms | 0 | 0 | 0 |
| 40–50 | 284 | 28.4 | 124 | 184 ms | 101 ms | 0 | 0 | 0 |
| 50–60 | 300 | 30 | 120 | 178 ms | 103 ms | 0 | 0 | 0 |
| 60–70 | 322 | 32.2 | 117 | 152 ms | 69 ms | 0 | 0 | 0 |
| 70–80 | 283 | 28.3 | 36 | 228 ms | 93 ms | 0 | 101 | 0 |
| 80–90 | 297 | 29.7 | 2 | 146 ms | 42 ms | 0 | 148 | 0 |
| 90–100 | 286 | 28.6 | 123 | 138 ms | 61 ms | 0 | 0 | 0 |
| 100–110 | 286 | 28.6 | 118 | 155 ms | 81 ms | 0 | 0 | 0 |
| 110–120 | 288 | 28.8 | 122 | 141 ms | 78 ms | 0 | 0 | 0 |
| 120–130 | 331 | 33.1 | 123 | 186 ms | 83 ms | 0 | 0 | 0 |
| 130–140 | 288 | 28.8 | 22 | 153 ms | 50 ms | 0 | 124 | 0 |
| 140–150 | 295 | 29.5 | 1 | 52 ms | 32 ms | 0 | 164 | 0 |
| 150–160 | 290 | 29 | 121 | 143 ms | 83 ms | 0 | 0 | 0 |
| 160–170 | 281 | 28.1 | 119 | 175 ms | 102 ms | 0 | 0 | 0 |
| 170–180 | 269 | 26.9 | 119 | 208 ms | 93 ms | 0 | 0 | 0 |
| 180–190 | 2 | 0.2 | 0 | — | 16 ms | 0 | 0 | 0 |

#### Postgres, memória e CPU durante a fase

| Medida | Valor |
|---|---|
| Conexões ao banco (pg_stat_activity, só este banco) | máx. 5 (média 5); ativas máx. 4 (média 0.61); idle in transaction máx. 4; aguardando lock máx. 0 |
| Pool da API (DB_POOL_MAX) | 5 (padrão de src/config.js) |
| Tamanho do banco antes → depois da fase | 14.1 MB → 100.1 MB (+86.0 MB) |
| Tuplas mortas em app.presentations ao fim da fase | 89 |
| Memória RSS do processo da API (dev.js: API + GoTrue falso) | início 204.5 MB · máx. 250.2 MB · fim 228.8 MB (pico histórico 269.6 MB) |
| CPU do processo da API (de 400 % possíveis em 4 CPUs) | média 46 % · máx. 75.5 % · threads máx. 15 |
| Amostras | 92 (a cada 2 s) |

#### Integridade, vazamento e conflitos

| Verificação | Resultado |
|---|---|
| Último PUT 200 de cada sessão = estado do servidor (rev e hash, via GET e via banco) | 50/50 apresentações íntegras |
| rev final = rev inicial + nº de PUT 200 alterados (nenhum salvamento perdido ou duplicado) | ok |
| 409 inesperados em autosave com baseRev correto | 0 |
| Salvamentos com baseRev obsoleto aceitos (deveriam dar 409) | 0 de 122 |
| Downloads com tamanho diferente do enviado | 0 de 300 |
| Vazamentos entre usuários (sondas: versões alheias, arquivo privado alheio, PUT alheio, scope=mine) | 0 em 111 sondas |
| Cópias criadas de apresentações alheias (dono = quem copiou) | 167 |

Anomalias registradas pelas sessões (10; primeiras): `carga003@am.test: assets/check 429`, `carga010@am.test: assets/check 429`, `carga011@am.test: assets/check 429`, `carga015@am.test: assets/check 429`, `carga021@am.test: assets/check 429`, `carga028@am.test: assets/check 429`, `carga035@am.test: assets/check 429`, `carga036@am.test: assets/check 429`

#### Critérios (50 usuários)

| Critério | Medido | Atende |
|---|---|---|
| p95 de PUT /content ≤ 800 ms (respostas 200) | 178 ms | sim |
| p95 de GET ≤ 300 ms (todas as leituras 2xx) | 91 ms | sim |
| 0 erros 5xx | 0 | sim |
| Sem perda de dados, sem vazamento, sem download corrompido | ok | sim |
| **Resultado da fase** |  | **APROVADA** |


### Fase 2 — 50 usuários × 180 s (limites por IP neutralizados)

Decks de 154 KB a 403 KB (média 283 KB), 5.286 requisições em 180.1 s (**29.35 req/s**), p50/p95/p99 geral 61 ms / 176 ms / 247 ms.
Mix executado: 2.161 ciclos de autosave, 2.161 PUT /content gravados (200), 448 imagens novas incorporadas aos decks — 366 enviadas de fato por `PUT /api/assets/:sha` (183.3 MB; 0 deduplicadas pelo servidor) e 82 que o `check` já dava como disponíveis (a mesma imagem comum enviada antes por outra pessoa e visível pelo acervo) —, 150 miniaturas, 228 cópias, 82 comentários, 323 downloads de arquivo, 123 sondas de vazamento, 105 salvamentos obsoletos (409 esperado).

Erros: **0 × 5xx**, 0 × 429 (limite de taxa), 0 × 4xx inesperados, 0 falhas de rede/tempo esgotado; 203 respostas esperadas das sondas (403/404/409). Limites por IP neutralizados (426 linhas de app.rate_limits zeradas a cada 2 s).

#### Por endpoint (medido no cliente, inclui rede local e leitura do corpo)

| Endpoint | Req. | req/s | p50 | p95 | p99 | máx. | p95 (só 2xx) | Respostas por código | Transferido |
|---|---|---|---|---|---|---|---|---|---|
| GET /api/assets/:sha | 323 | 1.79 | 23 ms | 123 ms | 173 ms | 210 ms | 123 ms | 200: 323 | 144.5 MB |
| GET /api/assets/:sha `[alheio→404]` | 52 | 0.29 | 73 ms | 130 ms | 143 ms | 143 ms | — | 404: 52 | 0.01 MB |
| GET /api/presentations | 529 | 2.94 | 19 ms | 93 ms | 150 ms | 254 ms | 93 ms | 200: 529 | 5.87 MB |
| GET /api/presentations?scope=mine | 25 | 0.14 | 22 ms | 72 ms | 85 ms | 85 ms | 72 ms | 200: 25 | 0.09 MB |
| GET /api/presentations/:id | 423 | 2.35 | 33 ms | 111 ms | 151 ms | 238 ms | 111 ms | 200: 423 | 118.3 MB |
| GET /api/presentations/:id/versions | 348 | 1.93 | 17 ms | 88 ms | 114 ms | 188 ms | 88 ms | 200: 348 | 0.08 MB |
| GET /api/presentations/:id/versions `[alheia→403]` | 10 | 0.06 | 12 ms | 74 ms | 74 ms | 74 ms | — | 403: 10 | 0.00 MB |
| POST /api/assets/check | 448 | 2.49 | 22 ms | 123 ms | 177 ms | 185 ms | 123 ms | 200: 448 | 0.06 MB |
| POST /api/presentations/:id/comments | 82 | 0.46 | 22 ms | 118 ms | 160 ms | 160 ms | 118 ms | 201: 82 | 0.03 MB |
| POST /api/presentations/:id/duplicate | 228 | 1.27 | 104 ms | 199 ms | 297 ms | 349 ms | 199 ms | 201: 228 | 0.10 MB |
| PUT /api/assets/:sha | 366 | 2.03 | 65 ms | 237 ms | 317 ms | 339 ms | 237 ms | 201: 366 | 183.3 MB |
| PUT /api/assets/:sha `[thumb]` | 150 | 0.83 | 46 ms | 159 ms | 263 ms | 282 ms | 159 ms | 201: 150 | 2.27 MB |
| PUT /api/presentations/:id/content | 2.161 | 12 | 89 ms | 195 ms | 260 ms | 378 ms | 195 ms | 200: 2161 | 614.8 MB |
| PUT /api/presentations/:id/content `[alheia→403]` | 36 | 0.2 | 18 ms | 145 ms | 155 ms | 155 ms | — | 403: 36 | 0.01 MB |
| PUT /api/presentations/:id/content `[obsoleto→409]` | 105 | 0.58 | 49 ms | 123 ms | 152 ms | 158 ms | — | 409: 105 | 30.3 MB |

#### Latência medida pela própria API (log de acesso, campo `ms`)

| Rota (medida pela API) | Req. | p50 | p95 | p99 | máx. | 5xx | 429 |
|---|---|---|---|---|---|---|---|
| GET /api/assets/:sha | 375 | 22 ms | 112 ms | 145 ms | 167 ms | 0 | 0 |
| GET /api/presentations | 554 | 15 ms | 88 ms | 140 ms | 243 ms | 0 | 0 |
| GET /api/presentations/:id | 473 | 26 ms | 95 ms | 143 ms | 218 ms | 0 | 0 |
| GET /api/presentations/:id/versions | 358 | 14 ms | 80 ms | 102 ms | 185 ms | 0 | 0 |
| POST /api/assets/check | 448 | 15 ms | 100 ms | 162 ms | 176 ms | 0 | 0 |
| POST /api/presentations/:id/comments | 82 | 20 ms | 105 ms | 159 ms | 159 ms | 0 | 0 |
| POST /api/presentations/:id/duplicate | 228 | 100 ms | 194 ms | 272 ms | 332 ms | 0 | 0 |
| PUT /api/assets/:sha | 516 | 54 ms | 216 ms | 299 ms | 324 ms | 0 | 0 |
| PUT /api/presentations/:id/content | 2.302 | 79 ms | 178 ms | 234 ms | 322 ms | 0 | 0 |

#### Linha do tempo (janelas de 10 s)

| Janela (s) | Req. | req/s | PUT 200 | p95 PUT | p95 GET | 5xx | 429 | rede |
|---|---|---|---|---|---|---|---|---|
| 0–10 | 323 | 32.3 | 120 | 151 ms | 86 ms | 0 | 0 | 0 |
| 10–20 | 305 | 30.5 | 128 | 166 ms | 81 ms | 0 | 0 | 0 |
| 20–30 | 271 | 27.1 | 115 | 260 ms | 99 ms | 0 | 0 | 0 |
| 30–40 | 283 | 28.3 | 122 | 190 ms | 118 ms | 0 | 0 | 0 |
| 40–50 | 283 | 28.3 | 119 | 200 ms | 119 ms | 0 | 0 | 0 |
| 50–60 | 282 | 28.2 | 117 | 153 ms | 90 ms | 0 | 0 | 0 |
| 60–70 | 333 | 33.3 | 120 | 185 ms | 83 ms | 0 | 0 | 0 |
| 70–80 | 301 | 30.1 | 120 | 231 ms | 154 ms | 0 | 0 | 0 |
| 80–90 | 276 | 27.6 | 119 | 158 ms | 76 ms | 0 | 0 | 0 |
| 90–100 | 282 | 28.2 | 119 | 181 ms | 94 ms | 0 | 0 | 0 |
| 100–110 | 272 | 27.2 | 116 | 278 ms | 150 ms | 0 | 0 | 0 |
| 110–120 | 299 | 29.9 | 121 | 220 ms | 122 ms | 0 | 0 | 0 |
| 120–130 | 322 | 32.2 | 120 | 208 ms | 127 ms | 0 | 0 | 0 |
| 130–140 | 281 | 28.1 | 120 | 190 ms | 80 ms | 0 | 0 | 0 |
| 140–150 | 294 | 29.4 | 123 | 184 ms | 102 ms | 0 | 0 | 0 |
| 150–160 | 287 | 28.7 | 119 | 176 ms | 111 ms | 0 | 0 | 0 |
| 160–170 | 290 | 29 | 122 | 183 ms | 87 ms | 0 | 0 | 0 |
| 170–180 | 300 | 30 | 121 | 158 ms | 85 ms | 0 | 0 | 0 |
| 180–190 | 2 | 0.2 | 0 | — | 17 ms | 0 | 0 | 0 |

#### Postgres, memória e CPU durante a fase

| Medida | Valor |
|---|---|
| Conexões ao banco (pg_stat_activity, só este banco) | máx. 5 (média 5); ativas máx. 3 (média 0.66); idle in transaction máx. 4; aguardando lock máx. 1 |
| Pool da API (DB_POOL_MAX) | 5 (padrão de src/config.js) |
| Tamanho do banco antes → depois da fase | 100.2 MB → 183.6 MB (+83.3 MB) |
| Tuplas mortas em app.presentations ao fim da fase | 225 |
| Memória RSS do processo da API (dev.js: API + GoTrue falso) | início 233.1 MB · máx. 265.4 MB · fim 248 MB (pico histórico 272.8 MB) |
| CPU do processo da API (de 400 % possíveis em 4 CPUs) | média 53.4 % · máx. 76 % · threads máx. 13 |
| Amostras | 92 (a cada 2 s) |

#### Integridade, vazamento e conflitos

| Verificação | Resultado |
|---|---|
| Último PUT 200 de cada sessão = estado do servidor (rev e hash, via GET e via banco) | 50/50 apresentações íntegras |
| rev final = rev inicial + nº de PUT 200 alterados (nenhum salvamento perdido ou duplicado) | ok |
| 409 inesperados em autosave com baseRev correto | 0 |
| Salvamentos com baseRev obsoleto aceitos (deveriam dar 409) | 0 de 105 |
| Downloads com tamanho diferente do enviado | 0 de 323 |
| Vazamentos entre usuários (sondas: versões alheias, arquivo privado alheio, PUT alheio, scope=mine) | 0 em 123 sondas |
| Cópias criadas de apresentações alheias (dono = quem copiou) | 228 |

#### Critérios (50 usuários)

| Critério | Medido | Atende |
|---|---|---|
| p95 de PUT /content ≤ 800 ms (respostas 200) | 195 ms | sim |
| p95 de GET ≤ 300 ms (todas as leituras 2xx) | 104 ms | sim |
| 0 erros 5xx | 0 | sim |
| Sem perda de dados, sem vazamento, sem download corrompido | ok | sim |
| **Resultado da fase** |  | **APROVADA** |


### Fase 3 — 100 usuários × 60 s (limites por IP neutralizados)

Decks de 152 KB a 403 KB (média 277 KB), 2.922 requisições em 60.4 s (**48.39 req/s**), p50/p95/p99 geral 362 ms / 1053 ms / 1525 ms.
Mix executado: 1.205 ciclos de autosave, 1.205 PUT /content gravados (200), 232 imagens novas incorporadas aos decks — 180 enviadas de fato por `PUT /api/assets/:sha` (85.7 MB; 0 deduplicadas pelo servidor) e 52 que o `check` já dava como disponíveis (a mesma imagem comum enviada antes por outra pessoa e visível pelo acervo) —, 100 miniaturas, 132 cópias, 54 comentários, 166 downloads de arquivo, 51 sondas de vazamento, 59 salvamentos obsoletos (409 esperado).

Erros: **0 × 5xx**, 0 × 429 (limite de taxa), 0 × 4xx inesperados, 0 falhas de rede/tempo esgotado; 110 respostas esperadas das sondas (403/404/409). Limites por IP neutralizados (156 linhas de app.rate_limits zeradas a cada 2 s).

#### Por endpoint (medido no cliente, inclui rede local e leitura do corpo)

| Endpoint | Req. | req/s | p50 | p95 | p99 | máx. | p95 (só 2xx) | Respostas por código | Transferido |
|---|---|---|---|---|---|---|---|---|---|
| GET /api/assets/:sha | 166 | 2.75 | 292 ms | 739 ms | 1073 ms | 1136 ms | 739 ms | 200: 166 | 71.8 MB |
| GET /api/assets/:sha `[alheio→404]` | 41 | 0.68 | 470 ms | 982 ms | 1233 ms | 1233 ms | — | 404: 41 | 0.00 MB |
| GET /api/presentations | 305 | 5.05 | 281 ms | 761 ms | 1062 ms | 1114 ms | 761 ms | 200: 305 | 3.38 MB |
| GET /api/presentations/:id | 230 | 3.81 | 287 ms | 941 ms | 1079 ms | 1117 ms | 941 ms | 200: 230 | 65.3 MB |
| GET /api/presentations/:id/versions | 208 | 3.44 | 336 ms | 839 ms | 1112 ms | 1119 ms | 839 ms | 200: 208 | 0.05 MB |
| POST /api/assets/check | 232 | 3.84 | 329 ms | 806 ms | 1066 ms | 1073 ms | 806 ms | 200: 232 | 0.03 MB |
| POST /api/presentations/:id/comments | 54 | 0.89 | 320 ms | 962 ms | 1079 ms | 1079 ms | 962 ms | 201: 54 | 0.02 MB |
| POST /api/presentations/:id/duplicate | 132 | 2.19 | 451 ms | 1060 ms | 1154 ms | 1158 ms | 1060 ms | 201: 132 | 0.05 MB |
| PUT /api/assets/:sha | 180 | 2.98 | 538 ms | 1500 ms | 1778 ms | 1783 ms | 1500 ms | 201: 180 | 85.8 MB |
| PUT /api/assets/:sha `[thumb]` | 100 | 1.66 | 870 ms | 1843 ms | 1896 ms | 1964 ms | 1843 ms | 201: 100 | 1.51 MB |
| PUT /api/presentations/:id/content | 1.205 | 19.95 | 378 ms | 972 ms | 1159 ms | 1206 ms | 972 ms | 200: 1205 | 335.8 MB |
| PUT /api/presentations/:id/content `[alheia→403]` | 10 | 0.17 | 147 ms | 599 ms | 599 ms | 599 ms | — | 403: 10 | 0.00 MB |
| PUT /api/presentations/:id/content `[obsoleto→409]` | 59 | 0.98 | 397 ms | 933 ms | 1124 ms | 1124 ms | — | 409: 59 | 16.2 MB |

#### Latência medida pela própria API (log de acesso, campo `ms`)

| Rota (medida pela API) | Req. | p50 | p95 | p99 | máx. | 5xx | 429 |
|---|---|---|---|---|---|---|---|
| GET /api/assets/:sha | 207 | 297 ms | 825 ms | 1083 ms | 1212 ms | 0 | 0 |
| GET /api/presentations | 305 | 274 ms | 745 ms | 1059 ms | 1112 ms | 0 | 0 |
| GET /api/presentations/:id | 330 | 124 ms | 768 ms | 1053 ms | 1109 ms | 0 | 0 |
| GET /api/presentations/:id/versions | 208 | 314 ms | 837 ms | 1103 ms | 1117 ms | 0 | 0 |
| POST /api/assets/check | 232 | 319 ms | 798 ms | 1054 ms | 1062 ms | 0 | 0 |
| POST /api/presentations/:id/comments | 54 | 317 ms | 959 ms | 1068 ms | 1068 ms | 0 | 0 |
| POST /api/presentations/:id/duplicate | 132 | 438 ms | 1056 ms | 1152 ms | 1154 ms | 0 | 0 |
| PUT /api/assets/:sha | 280 | 582 ms | 1749 ms | 1871 ms | 1959 ms | 0 | 0 |
| PUT /api/presentations/:id/content | 1.274 | 362 ms | 964 ms | 1152 ms | 1196 ms | 0 | 0 |

#### Linha do tempo (janelas de 10 s)

| Janela (s) | Req. | req/s | PUT 200 | p95 PUT | p95 GET | 5xx | 429 | rede |
|---|---|---|---|---|---|---|---|---|
| 0–10 | 490 | 49 | 166 | 1173 ms | 1112 ms | 0 | 0 | 0 |
| 10–20 | 472 | 47.2 | 202 | 803 ms | 650 ms | 0 | 0 | 0 |
| 20–30 | 474 | 47.4 | 198 | 875 ms | 664 ms | 0 | 0 | 0 |
| 30–40 | 480 | 48 | 212 | 689 ms | 602 ms | 0 | 0 | 0 |
| 40–50 | 492 | 49.2 | 207 | 504 ms | 437 ms | 0 | 0 | 0 |
| 50–60 | 504 | 50.4 | 218 | 668 ms | 601 ms | 0 | 0 | 0 |
| 60–70 | 10 | 1 | 2 | 119 ms | 142 ms | 0 | 0 | 0 |

#### Postgres, memória e CPU durante a fase

| Medida | Valor |
|---|---|
| Conexões ao banco (pg_stat_activity, só este banco) | máx. 5 (média 5); ativas máx. 5 (média 1.63); idle in transaction máx. 4; aguardando lock máx. 1 |
| Pool da API (DB_POOL_MAX) | 5 (padrão de src/config.js) |
| Tamanho do banco antes → depois da fase | 183.7 MB → 232.2 MB (+48.4 MB) |
| Tuplas mortas em app.presentations ao fim da fase | 752 |
| Memória RSS do processo da API (dev.js: API + GoTrue falso) | início 233.4 MB · máx. 281.2 MB · fim 236.9 MB (pico histórico 285.4 MB) |
| CPU do processo da API (de 400 % possíveis em 4 CPUs) | média 82.8 % · máx. 97 % · threads máx. 14 |
| Amostras | 32 (a cada 2 s) |

#### Integridade, vazamento e conflitos

| Verificação | Resultado |
|---|---|
| Último PUT 200 de cada sessão = estado do servidor (rev e hash, via GET e via banco) | 100/100 apresentações íntegras |
| rev final = rev inicial + nº de PUT 200 alterados (nenhum salvamento perdido ou duplicado) | ok |
| 409 inesperados em autosave com baseRev correto | 0 |
| Salvamentos com baseRev obsoleto aceitos (deveriam dar 409) | 0 de 59 |
| Downloads com tamanho diferente do enviado | 0 de 166 |
| Vazamentos entre usuários (sondas: versões alheias, arquivo privado alheio, PUT alheio, scope=mine) | 0 em 51 sondas |
| Cópias criadas de apresentações alheias (dono = quem copiou) | 132 |


## 3b. Sonda dos limites por IP nas rotas de sessão

Fora das fases, 40 sessões reais (mesmo IP) chamaram `POST /api/auth/refresh` em 127 ms — como acontece quando os access tokens de um escritório expiram no mesmo minuto: respostas 200 × 30, 429 × 10 (Retry-After 59 s). O limite é 30/min por IP (`refresh_ip`, src/routes/auth.js); o cliente web, ao falhar o refresh, envia a pessoa para `/entrar?motivo=sessao`. Na preparação também foi preciso zerar `verify_ip` (5/15 min por IP) e `admin_invite` (60/h por admin) para criar 100 contas — veja os achados.

## 4. Deduplicação de arquivos

| Imagem compartilhada (referenciada por todos) | Linhas em app.assets | Objetos em disco | Posses (app.asset_uploads) | Tamanho no banco = em disco |
|---|---|---|---|---|
| d92612cdb4dc… (592 KB) | 1 (ready) | 1 | 8 | sim |
| 971407089b1e… (422 KB) | 1 (ready) | 1 | 8 | sim |
| d1128c6d0934… (251 KB) | 1 (ready) | 1 | 8 | sim |

A coluna "posses" conta só quem fez `PUT` dos bytes: pelo contrato, `POST /api/assets/check` responde "já disponível" a quem **vê** o arquivo (policy `assets_select`: enviou, provou posse **ou** ele está numa apresentação visível — e no acervo comum toda apresentação é visível), então a partir da 1ª apresentação que referenciou a imagem os demais usuários a referenciam sem reenviar (os poucos reenvios simultâneos aparecem como `deduplicated:true`). O que prova a deduplicação é **1 linha e 1 objeto por imagem distinta**, qualquer que seja o nº de pessoas e de apresentações que a usam.

Imagens comuns do conjunto: 30 distintas, 30 linhas em `app.assets`, 30 posses (a mais reenviada tem 1 donos → 1 objeto). Imagens únicas geradas na hora: 881 (437.4 MB). Total: 1.404 arquivos distintos (453.8 MB, 0 não-ready), 1.425 posses, auditoria `asset.upload` 1.425 (13 marcadas `deduplicated`), `asset.reject` 0. Objetos gravados em disco nesta execução: 1.404 (453.8 MB) — **exatamente 1 objeto por arquivo distinto**, com os bytes do banco iguais aos do disco.

## 5. Abertura do editor em nuvem × original

Chromium 141.0.7390.37 (Playwright), contexto novo a cada abertura (cache frio), fontes do Google servidas localmente (fonts2). Apresentação de referência: 64 slides, 252 KB de JSON, 3 imagens externalizadas (1264 KB no total). Instantes medidos dentro da página com `performance.now()` (precisão ≈ 16 ms, sondagem por quadro).

| Medida (mediana de 10 aberturas) | Tempo |
|---|---|
| Editor em nuvem — `/editor/<id>` até **AMStudio pronto** (editor montado) | 393 ms (mín. 333 ms, máx. 558 ms, média 419 ms, n=10) |
| Editor em nuvem — até pílula **"Salvo na nuvem"** e deck hidratado (conteúdo pronto) | 964 ms (mín. 830 ms, máx. 1471 ms, média 1027 ms, n=10) |
| Editor em nuvem — evento `load` da página | 507 ms (mín. 440 ms, máx. 625 ms, média 524 ms, n=10) |
| Editor em nuvem — bytes transferidos por abertura (HTML + API + imagens) | 3.40 MB |
| Original em `file://` — até **AMStudio pronto** | 379 ms (mín. 324 ms, máx. 450 ms, média 389 ms, n=10) |
| Original em `file://` — evento `load` da página | 460 ms (mín. 369 ms, máx. 538 ms, média 466 ms, n=10) |
| Editor em nuvem — apresentação "pesada" (90 slides, 391 KB de JSON, 5 arquivos referenciados após 3 min de autosave) até "Salvo" | 1011 ms (mín. 991 ms, máx. 1370 ms, média 1124 ms, n=3) |

Aberturas bem-sucedidas: nuvem 10/10, original 10/10. Referências `asset:` restantes no deck após hidratar: [0,0,0,0,0,0,0,0,0,0] (0 = todas as imagens viraram `data:`). Violações de CSP: 0. Erros de console/página: nuvem 0, original 0. No original a capa abre (AMCover.isOpen()=true); na nuvem a capa não abre (patch do build cloud) e o acervo é o ponto de entrada.

## 6. Log da API

15.156 requisições registradas pela API em toda a execução (inclui preparação e Playwright); **0 respostas 5xx**.

## 7. Onde degrada (limite encontrado)

| Medida | 50 usuários | 100 usuários |
|---|---|---|
| Requisições por segundo | 29.35 | 48.39 |
| p95 PUT /content (200) | 195 ms | 972 ms |
| p95 GET (todas as leituras 2xx) | 104 ms | 824 ms |
| p99 geral | 247 ms | 1525 ms |
| Latência medida pela API, p95 de PUT /content | 178 ms | 964 ms |
| Conexões ativas no Postgres (média / máx.) | 0.66 / 3 | 1.63 / 5 |
| CPU do processo da API (média / máx., de 400 %) | 53.4 % / 76 % | 82.8 % / 97 % |
| Erros 5xx | 0 | 0 |

Com 100 usuários a vazão quase dobra (29.35 → 48.39 req/s) e a latência **sai do critério de leitura (p95 GET > 300 ms)**; o PUT /content **ultrapassa 800 ms no p95** e não houve nenhum 5xx. A latência medida pela própria API cresce na mesma proporção que a do cliente, ou seja, o tempo está **dentro do processo da API** (fila do pool de 5 conexões — todas ocupadas nas amostras, com até 4 em *idle in transaction* entre as ~18 idas e voltas de cada autosave — e a thread única do JavaScript, que faz lint, hash canônico e parse de 150–400 KB por salvamento), não no banco (ativas em média 1.63 de 5) nem na rede.

## 7b. Experimentos complementares (execuções separadas, `--no-report`)

| Execução | req/s | p95 PUT /content (200) | p95 GET (2xx) | p99 geral | p95 PUT /assets/:sha | 5xx | 429 | CPU média da API | Conexões ativas (média / máx.) | Integridade / vazamentos |
|---|---|---|---|---|---|---|---|---|---|---|
| 100 usuários × 60 s, DB_POOL_MAX=20, limites por IP neutralizados | 49.96 | 1011 ms | 798 ms | 1269 ms | 1420 ms | 0 | 0 | 88.3 % | 3.16 / 8 | 100/100 · 0 |
| 150 usuários × 60 s, DB_POOL_MAX=5, limites por IP neutralizados | 43.74 | 2848 ms | 2679 ms | 3650 ms | 3987 ms | 0 | 0 | 84 % | 1.7 / 5 | 150/150 · 0 |

Com o pool da API em 20 conexões (em vez de 5) e os mesmos 100 usuários, o p95 do PUT /content foi 1011 ms — **o pool não é o gargalo**: o tempo está na thread única do JavaScript (CPU média 88.3 % do processo), que faz lint, hash canônico, parse/serialização de 150–400 KB por salvamento e SHA-256/validação (sharp) das imagens.

Com 150 usuários: 43.74 req/s, p95 PUT /content 2848 ms, p95 GET 2679 ms, p99 3650 ms, **0 × 5xx**, 0 × 429, integridade 150/150, vazamentos 0.


## 8. Como reproduzir

```bash
cd platform && npm run test:load                      # fases padrão: 50x180:keep, 50x180:clear, 100x60:clear + Playwright
node tests/load/run.js --phases 10x30:keep --skip-browser   # fumaça
node tests/load/run.js --phases 150x60:clear --skip-browser --no-report               # procurar o limite
node tests/load/run.js --phases 100x60:clear --pool-max 20 --skip-browser --no-report  # experimento: pool maior
node tests/load/run.js --report-only .tmp/load/resultado-<data>.json --experiments .tmp/load/resultado-<e1>.json,.tmp/load/resultado-<e2>.json   # regenera este arquivo
```

O harness escreve só em `platform/.tmp/load/` e neste arquivo; usa a porta 4402 e o banco `canteiro_t_load` (recriado com `--reset`), e encerra apenas o `dev.js` que iniciou (`kill <pid>`). Durante esta execução outros processos de teste do repositório rodavam na mesma máquina (ex.: outro `dev.js` na porta 4403), disputando as 4 CPUs — os tempos absolutos carregam esse ruído; as comparações entre fases foram feitas em sequência, nas mesmas condições.

## 9. Achados (o que corrigir — proposta, sem alterar código fora do escopo deste teste)

**A1 — Limites de taxa por IP derrubam o autosave de um escritório (alto).** Em `rate()` (src/lib/presentations-service.js:20–24) todo endpoint autenticado tem um balde por usuário e outro por IP com 5× o valor (escrita 600/min, upload 300/min, leitura 3 000/min). 50 pessoas atrás do mesmo NAT salvando a cada 3–5 s geram ~750 PUT/min: **19.9 % dos autosaves (434 de 2.177)** receberam 429 na fase 1, em rajadas (janela fixa de 60 s: o balde enche aos ~40 s e todos ficam bloqueados até a virada), mais 103 × 429 em cópias, `assets/check` e miniaturas. O editor mostra "Sem conexão — alterações guardadas neste computador" e recua até 60 s. Nada se perde, mas 50 usuários num escritório da A&M vivem isso o dia todo. Reprodução: `node tests/load/run.js --phases 50x180:keep --skip-browser` (ou 50 sessões no mesmo IP). Proposta: para usuário autenticado o limite por IP é redundante com o limite por usuário — remover o balde `:ip` de `rate()` ou subir o multiplicador para ≥ 25× (configurável em `app.settings`, ex.: `rate.ip_multiplier`), mantendo os limites por IP só nas rotas anônimas (login, forgot, verify); trocar a janela fixa por janela deslizante/token bucket para não sincronizar os bloqueios.

**A2 — `POST /api/auth/refresh` 30/min por IP desloga quem divide o IP (alto).** src/routes/auth.js:188 (`refresh_ip`, 60 s, 30). Na sonda, 40 sessões reais no mesmo IP renovaram no mesmo instante: 200 × 30, 429 × 10 (Retry-After 59 s). O cliente web (web/js/api.js) trata refresh falho como sessão perdida e manda para `/entrar?motivo=sessao`; a extensão do editor mostra "Sessão expirada". Como os access tokens duram 1 h, quem entrou junto (início do expediente) renova junto. Proposta: chavear o limite do refresh pelo hash do refresh token (ou pelo usuário) em vez do IP, ou ≥ 600/min por IP; no cliente, tratar 429 no refresh com espera do `Retry-After` e nova tentativa antes de redirecionar.

**A3 — `POST /api/auth/verify` 5 por 15 min por IP trava o onboarding presencial (médio).** src/routes/auth.js:138. Num dia de convites no escritório, a 6ª pessoa a clicar no link em 15 min recebe 429 "Muitas tentativas" com um link válido. Para ativar 100 contas o teste precisou zerar o balde `verify_ip` antes de cada ativação. Proposta: limitar por `token_hash` (o token é de uso único e tem 24 bytes aleatórios — força bruta é inviável) e manter por IP só um teto alto (ex.: 100/15 min), ou documentar a restrição no fluxo de convite.

**A4 — `admin_invite` 60 por hora por admin, não documentado (baixo).** src/routes/admin.js:145 e 173; API.md §2 não lista. Importar 100+ usuários (planilha) leva 2 h ou falha com 429 (`retryAfterS` ≈ 3 500). Proposta: documentar, subir para 300/h ou tornar configurável em `app.settings` (`invites.per_hour`), e devolver no 429 quantos convites ainda cabem.

**A5 — Com 100 usuários o processo da API satura a thread do JavaScript (médio, desempenho).** 48.39 req/s, p95 PUT /content 972 ms, p95 GET 824 ms, p95 do envio de imagem 1500 ms, CPU média 82.8 % (máx. 97 %) do processo — 0 × 5xx e integridade 100/100. Com DB_POOL_MAX=20 o p95 ficou em 1011 ms: o pool não é o gargalo. Por autosave a API faz `JSON.parse` de 150–400 KB, `lintDeck` (percorre todo o JSON e testa cada string em até 4 camadas de decodificação), `canonicalize` + SHA-256, `JSON.stringify` para o jsonb e ~18 idas e voltas ao banco (duas transações só para `hit_rate` + a transação do usuário com `set role`/`set_config`). Proposta: (1) na hospedagem em contêiner, rodar 1 processo por CPU (`node:cluster` ou réplicas atrás do balanceador) — na Vercel cada instância atende 1 requisição e o limite é por instância, então este achado vale para o contêiner/local; (2) mover `prepareContent` (lint + hash) para um pool de `worker_threads` quando o corpo passar de ~100 KB; (3) juntar os dois `hit_rate` numa só consulta sem transação explícita (−4 idas e voltas por requisição; na Supabase cada ida e volta custa 1–2 ms); (4) servir `GET /api/assets/:sha` por URL assinada/CDN também abaixo de 8 MB quando a CSP permitir o host do bucket (hoje os bytes passam pelo Node).

**A6 — Autosave a cada 3–5 s do deck inteiro infla o banco (médio, armazenamento).** 5.109 salvamentos de ~270 KB levaram o banco de 8.37 MB a 232.2 MB; `app.presentations` terminou com 144.7 MB e **761 tuplas mortas para 728 vivas** (cada UPDATE reescreve o jsonb inteiro no TOAST e o autovacuum padrão não acompanha). Extrapolando (50 pessoas × 8 h × 15 salvamentos/min × 270 KB ≈ 100 GB/dia de escrita e WAL), isso pesa em disco, backup e no orçamento de I/O da Supabase. Proposta: `alter table app.presentations set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_delay = 2)` (e o mesmo na tabela TOAST), `toast_compression = lz4`; no cliente, debounce de 3 s → 5–8 s com teto de espera (hoje `DEBOUNCE = 3000` em ed-50-cloud.js) ou autosave só quando o usuário para de digitar; acompanhar `n_dead_tup` de `app.presentations` em MONITORAMENTO.md.

**A7 — Pool da API (DB_POOL_MAX=5) fica 100 % alocado já com 50 usuários (informativo).** Conexões ativas em média 0.61 de 5 (máx. 4) — o banco está folgado; as 5 conexões ficam presas em *idle in transaction* entre as idas e voltas. Em contêiner, 10 conexões por processo são um bom valor; na Vercel (1 requisição por instância) 2–3 bastam e economizam o pooler.

**Positivo** — 0 × 5xx em 15.156 requisições; integridade 100 % (200 apresentações, rev e hash iguais ao último PUT confirmado); 286 salvamentos obsoletos todos recusados com 409 e `serverRev` correto; 0 vazamentos em 285 sondas; deduplicação exata (1 objeto por arquivo distinto, bytes do banco = disco); memória do processo estável (RSS máx. 281.2 MB); zero violações de CSP e zero erros de console ao abrir o editor em nuvem.

## 10. Correções aplicadas depois do teste (mesmo dia)

| Achado | O que foi feito | Onde |
|---|---|---|
| A1 (alto) — limites por IP derrubam o autosave do escritório | Multiplicador por IP das rotas autenticadas passou de 5× para **25× (configurável, `RATE_IP_MULTIPLIER`, mínimo 5)**: 50 pessoas atrás do mesmo NAT salvando a cada 3 s (≈ 1 000/min) ficam longe do teto (3 000/min). Os dois baldes (usuário e IP) são consultados em **uma** ida ao banco (`limitMany`). | `src/lib/presentations-service.js`, `src/lib/request.js` |
| A2 (médio, impacto reavaliado) — `refresh` 30/min por IP | Limite passa a ser **por token de renovação** (30/min; o token é HttpOnly e rotativo, não é superfície de força bruta) com teto por IP de 600/min. Os dois clientes (site e editor) tratam **429 no refresh** esperando o `Retry-After` (≤ 30 s) e repetindo uma vez antes de declarar sessão expirada. | `src/routes/auth.js`, `web/js/api.js`, `studio-cloud/ed-50-cloud.js` |
| A3 (médio) — `verify` 5/15 min por IP | Limite **por link** (10/15 min; o token é de uso único e imprevisível) + teto por IP de 100/15 min: uma equipe inteira abre os convites do mesmo escritório. | `src/routes/auth.js` |
| A4 (baixo) — convites 60/h, não documentado | **300/h por admin** e documentado em `API.md` §2. | `src/routes/admin.js`, `docs/API.md` |
| A5 (médio) — saturação da thread JS a ~100 usuários | Parte barata feita: −1 ida ao banco por requisição autenticada (`limitMany`). O restante (vários processos por contêiner, lint em *worker_threads*) fica como recomendação em `docs/OPERACAO.md`; na Vercel a escala é horizontal por instância. Critérios de 50 usuários já eram atendidos. | `src/lib/request.js` |
| A6 (médio) — inchaço do banco pelo autosave | Migração **0005**: autovacuum agressivo em `app.presentations` (e TOAST), `presentation_versions` e `rate_limits`; compressão **lz4** do `content` quando o servidor tem suporte. `maintenance.js stats` passa a mostrar tuplas vivas/mortas e avisa quando mortas > vivas (> 10 000). | `db/migrations/0005_hardening.sql`, `tools/maintenance.js`, `docs/MONITORAMENTO.md` |
| A7 (info) — pool 100 % alocado | Documentado o dimensionamento por ambiente (contêiner: `DB_POOL_MAX=10` por processo; Vercel: 2–3). | `docs/OPERACAO.md` |

A fase de 50 usuários **não foi reexecutada** depois destas alterações nesta máquina (a prova de paridade ocupava o Chromium); a lógica alterada está coberta pelos testes de API (`tests/api`, `tests/security`) e o `npm run test:load` continua disponível para repetir as fases.

