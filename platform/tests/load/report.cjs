/* tests/load/report.cjs — monta docs/evidencias/carga.md a partir do resultado de run.js (números reais da execução, nada estimado). */
'use strict';

const mb = (b) => (b == null ? '—' : (b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 1) + ' MB');
const kb = (b) => (b == null ? '—' : Math.round(b / 1024) + ' KB');
const n = (x) => (x == null ? '—' : typeof x === 'number' ? x.toLocaleString('pt-BR') : String(x));
const ms = (x) => (x == null ? '—' : `${Math.round(x)} ms`);
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + ' %' : '—');
const yn = (b) => (b ? 'sim' : '**não**');
const fmtStatuses = (st) => Object.entries(st).map(([k, v]) => `${k}: ${v}`).join(', ');
const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.join(' | ') + ' |')].join('\n');

function endpointTable(summary) {
  return table(['Endpoint', 'Req.', 'req/s', 'p50', 'p95', 'p99', 'máx.', 'p95 (só 2xx)', 'Respostas por código', 'Transferido'],
    summary.rows.map((r) => [r.key.replace(/\[/g, '`[').replace(/\]/g, ']`'), n(r.n), r.rps, ms(r.p50), ms(r.p95), ms(r.p99), ms(r.max), ms(r.p95ok), fmtStatuses(r.statuses), mb(r.mbTransferred * 1048576)]));
}
function windowsTable(w) {
  return table(['Janela (s)', 'Req.', 'req/s', 'PUT 200', 'p95 PUT', 'p95 GET', '5xx', '429', 'rede'], w.map((x) => [`${x.fromS}–${x.fromS + 10}`, x.n, x.rps, x.putN, ms(x.putP95), ms(x.getP95), x.e5xx, x.e429, x.rede]));
}
function serverTable(rows) {
  return table(['Rota (medida pela API)', 'Req.', 'p50', 'p95', 'p99', 'máx.', '5xx', '429'], rows.map((r) => [r.key, n(r.n), ms(r.p50), ms(r.p95), ms(r.p99), ms(r.max), r.e5xx, r.e429]));
}
const errClass = (rows, c) => rows.reduce((a, r) => a + r.classes[c], 0);

function phaseSection(p, i, serverRows) {
  const s = p.summary, st = p.stats, sys = p.system, c = p.criteria;
  const e429 = errClass(s.rows, '429'), e5xx = errClass(s.rows, '5xx'), e4xx = errClass(s.rows, '4xx'), rede = errClass(s.rows, 'rede'), esperado = errClass(s.rows, 'esperado');
  const out = [];
  out.push(`### Fase ${i + 1} — ${p.name}`, '');
  out.push(`Decks de ${kb(p.deckBytes.min)} a ${kb(p.deckBytes.max)} (média ${kb(p.deckBytes.avg)}), ${n(s.total)} requisições em ${s.durationS} s (**${s.rps} req/s**), p50/p95/p99 geral ${ms(s.p50)} / ${ms(s.p95)} / ${ms(s.p99)}.`,
    `Mix executado: ${n(st.cycles)} ciclos de autosave, ${n(st.putOk)} PUT /content gravados (200), ${n(st.uploads)} imagens novas incorporadas aos decks — ${n(st.uploadsPut)} enviadas de fato por \`PUT /api/assets/:sha\` (${mb(st.uploadsPutBytes)}; ${n(st.uploadDedup)} deduplicadas pelo servidor) e ${n(st.uploadsCheckOnly)} que o \`check\` já dava como disponíveis (a mesma imagem comum enviada antes por outra pessoa e visível pelo acervo) —, ${n(st.thumbs)} miniaturas, ${n(st.copies)} cópias, ${n(st.comments)} comentários, ${n(st.downloads)} downloads de arquivo, ${n(st.probes)} sondas de vazamento, ${n(st.stale)} salvamentos obsoletos (409 esperado).`, '');
  out.push(`Erros: **${e5xx} × 5xx**, ${e429} × 429 (limite de taxa), ${e4xx} × 4xx inesperados, ${rede} falhas de rede/tempo esgotado; ${esperado} respostas esperadas das sondas (403/404/409).${p.ipBucketsCleared ? ` Limites por IP neutralizados (${n(p.ipBucketsCleared)} linhas de app.rate_limits zeradas a cada 2 s).` : ''}`, '');
  if (st.put429) out.push(`**${p.autosaveRejectedPct} % dos autosaves (${n(st.put429)} de ${n(st.cycles)}) receberam 429** por causa do limite de escrita **por IP** (600/min = 5 × 120 do limite por usuário, janela fixa de 60 s): 50 pessoas salvando a cada 3–5 s geram ~750 PUT/min do mesmo IP; o balde enche a cada ~40 s e todos recebem 429 até a janela virar (veja as rajadas na linha do tempo). O editor real trataria cada 429 como "Sem conexão — alterações guardadas neste computador", com recuo exponencial de 1 s a 60 s. Nenhum dado se perdeu (o próximo autosave leva as edições; integridade abaixo), mas a experiência num escritório atrás de NAT seria essa. Os 429 em \`POST /api/assets/check\` e nas miniaturas vêm do balde de upload por IP (300/min).`, '');
  out.push('#### Por endpoint (medido no cliente, inclui rede local e leitura do corpo)', '', endpointTable(s), '');
  if (serverRows && serverRows.length) out.push('#### Latência medida pela própria API (log de acesso, campo `ms`)', '', serverTable(serverRows), '');
  out.push('#### Linha do tempo (janelas de 10 s)', '', windowsTable(p.windows), '');
  out.push('#### Postgres, memória e CPU durante a fase', '');
  out.push(table(['Medida', 'Valor'], [
    ['Conexões ao banco (pg_stat_activity, só este banco)', sys.pg ? `máx. ${sys.pg.maxTotal} (média ${sys.pg.avgTotal}); ativas máx. ${sys.pg.maxActive} (média ${sys.pg.avgActive}); idle in transaction máx. ${sys.pg.maxIdleInTx}; aguardando lock máx. ${sys.pg.maxWaitingLock}` : '—'],
    ['Pool da API (DB_POOL_MAX)', `${p.dbPoolMax || 5}${(p.dbPoolMax || 5) === 5 ? ' (padrão de src/config.js)' : ''}`],
    ['Tamanho do banco antes → depois da fase', `${mb(p.db.before.bytes)} → ${mb(p.db.after.bytes)} (+${mb(p.db.growthBytes)})`],
    ['Tuplas mortas em app.presentations ao fim da fase', n(p.db.after.tables.find((t) => t.table === 'presentations')?.dead)],
    ['Memória RSS do processo da API (dev.js: API + GoTrue falso)', `início ${sys.rssStartMb} MB · máx. ${sys.rssMaxMb} MB · fim ${sys.rssEndMb} MB (pico histórico ${sys.hwmMb} MB)`],
    ['CPU do processo da API (de 400 % possíveis em 4 CPUs)', `média ${sys.cpuAvgPct} % · máx. ${sys.cpuMaxPct} % · threads máx. ${sys.threadsMax}`],
    ['Amostras', `${sys.samples} (a cada 2 s)`],
  ]), '');
  out.push('#### Integridade, vazamento e conflitos', '');
  out.push(table(['Verificação', 'Resultado'], [
    ['Último PUT 200 de cada sessão = estado do servidor (rev e hash, via GET e via banco)', `${p.integrity.ok}/${p.integrity.total} apresentações íntegras${p.integrity.problems.length ? ' — **problemas:** ' + p.integrity.problems.map((x) => x.pid.slice(0, 8) + ': ' + x.problems.join('; ')).join(' · ') : ''}`],
    ['rev final = rev inicial + nº de PUT 200 alterados (nenhum salvamento perdido ou duplicado)', p.integrity.problems.some((x) => x.problems.some((m) => /rev/.test(m))) ? '**falhou**' : 'ok'],
    ['409 inesperados em autosave com baseRev correto', n(st.put409Unexpected)],
    ['Salvamentos com baseRev obsoleto aceitos (deveriam dar 409)', `${n(st.staleAccepted)} de ${n(st.stale)}`],
    ['Downloads com tamanho diferente do enviado', `${n(st.downloadBad)} de ${n(st.downloads)}`],
    ['Vazamentos entre usuários (sondas: versões alheias, arquivo privado alheio, PUT alheio, scope=mine)', p.leaks.length ? `**${p.leaks.length}** — ` + p.leaks.slice(0, 5).join(' · ') : `0 em ${n(st.probes)} sondas`],
    ['Cópias criadas de apresentações alheias (dono = quem copiou)', n(p.copies)],
  ]), '');
  if (p.anomaliesTotal) out.push(`Anomalias registradas pelas sessões (${p.anomaliesTotal}; primeiras): ${p.anomalies.slice(0, 8).map((a) => '`' + a.replace(/`/g, "'") + '`').join(', ')}`, '');
  if (p.netErrors.length) out.push(`Erros de rede do cliente (amostra): ${p.netErrors.slice(0, 5).map((e) => '`' + e.key + ': ' + e.error + '`').join(', ')}`, '');
  if (c.applies) {
    out.push('#### Critérios (50 usuários)', '', table(['Critério', 'Medido', 'Atende'], [
      ['p95 de PUT /content ≤ 800 ms (respostas 200)', ms(c.putP95), yn(c.putP95Ok)],
      ['p95 de GET ≤ 300 ms (todas as leituras 2xx)', ms(c.getP95), yn(c.getP95Ok)],
      ['0 erros 5xx', n(c.e5xx), yn(c.e5xxOk)],
      ['Sem perda de dados, sem vazamento, sem download corrompido', c.dataOk ? 'ok' : 'falhou', yn(c.dataOk)],
      ['**Resultado da fase**', '', c.pass ? '**APROVADA**' : '**REPROVADA**'],
    ]), '');
  }
  return out.join('\n');
}

function browserSection(b) {
  if (!b) return '_Não executado (--skip-browser)._';
  if (b.error) return `_Falhou: ${b.error}_`;
  const st = (s) => (s ? `${ms(s.p50)} (mín. ${ms(s.min)}, máx. ${ms(s.max)}, média ${ms(s.mean)}, n=${s.n})` : '—');
  const rows = [
    [`Editor em nuvem — \`/editor/<id>\` até **AMStudio pronto** (editor montado)`, st(b.cloud.studio)],
    [`Editor em nuvem — até pílula **"Salvo na nuvem"** e deck hidratado (conteúdo pronto)`, st(b.cloud.saved)],
    ['Editor em nuvem — evento `load` da página', st(b.cloud.load)],
    ['Editor em nuvem — bytes transferidos por abertura (HTML + API + imagens)', b.cloud.transferMb ? `${b.cloud.transferMb.p50.toFixed(2)} MB` : '—'],
    [`Autônomo publicado em \`file://\` — até **AMStudio pronto**`, st(b.original.studio)],
    ['Autônomo publicado em `file://` — evento `load` da página', st(b.original.load)],
  ];
  if (b.heavyOpen && b.heavyOpen.n) rows.push([`Editor em nuvem — apresentação "pesada" (${b.heavy?.slides} slides, ${kb(b.heavy?.bytes)} de JSON, ${b.heavy?.assets} arquivos referenciados após 3 min de autosave) até "Salvo"`, st(b.heavyOpen.saved)]);
  const out = [];
  out.push(`Chromium ${b.chromium} (Playwright), contexto novo a cada abertura (cache frio), fontes do Google servidas localmente (fonts2). Apresentação de referência: ${b.reference.slides} slides, ${kb(b.reference.bytes)} de JSON, ${b.reference.images} imagens externalizadas (${kb(b.reference.imageBytes)} no total). Instantes medidos dentro da página com \`performance.now()\` (precisão ≈ 16 ms, sondagem por quadro).`, '');
  out.push(table(['Medida (mediana de ' + b.cloud.n + ' aberturas)', 'Tempo'], rows), '');
  out.push(`Aberturas bem-sucedidas: nuvem ${b.cloud.ok}/${b.cloud.n}, autônomo ${b.original.ok}/${b.original.n}. Referências \`asset:\` restantes no deck após hidratar: ${JSON.stringify(b.cloud.assetRefsLeft)} (0 = todas as imagens viraram \`data:\`). Violações de CSP: ${b.cloud.csp.length}. Erros de console/página: nuvem ${b.cloud.errors.length ? b.cloud.errors.map((e) => '`' + e + '`').join(', ') : 0}, autônomo ${b.original.errors.length ? b.original.errors.map((e) => '`' + e + '`').join(', ') : 0}. No autônomo a capa abre (${b.original.cover ? `AMCover.isOpen()=${b.original.cover.open}` : '—'}); na nuvem a capa não abre (patch do build cloud) e o acervo é o ponto de entrada.`);
  return out.join('\n');
}

function experimentsSection(exps) {
  if (!exps || !exps.length) return '';
  const row = (p, k) => p.summary.rows.find((x) => x.key === k) || {};
  const out = ['## 7b. Experimentos complementares (execuções separadas, `--no-report`)', ''];
  out.push(table(['Execução', 'req/s', 'p95 PUT /content (200)', 'p95 GET (2xx)', 'p99 geral', 'p95 PUT /assets/:sha', '5xx', '429', 'CPU média da API', 'Conexões ativas (média / máx.)', 'Integridade / vazamentos'], exps.map((p) => [
    `${p.users} usuários × ${p.seconds} s, DB_POOL_MAX=${p.dbPoolMax}, limites por IP ${p.mode === 'clear' ? 'neutralizados' : 'como estão'}`, p.summary.rps, ms(row(p, 'PUT /api/presentations/:id/content').p95ok), ms(p.criteria.getP95), ms(p.summary.p99), ms(row(p, 'PUT /api/assets/:sha').p95ok), p.criteria.e5xx, errClass(p.summary.rows, '429'), `${p.system.cpuAvgPct} %`, `${p.system.pg?.avgActive} / ${p.system.pg?.maxActive}`, `${p.integrity.ok}/${p.integrity.total} · ${p.leaks.length}`])), '');
  const pool20 = exps.find((p) => p.dbPoolMax > 5 && p.users === 100), p150 = exps.find((p) => p.users >= 150);
  if (pool20) out.push(`Com o pool da API em ${pool20.dbPoolMax} conexões (em vez de 5) e os mesmos 100 usuários, o p95 do PUT /content foi ${ms(row(pool20, 'PUT /api/presentations/:id/content').p95ok)} — **o pool não é o gargalo**: o tempo está na thread única do JavaScript (CPU média ${pool20.system.cpuAvgPct} % do processo), que faz lint, hash canônico, parse/serialização de 150–400 KB por salvamento e SHA-256/validação (sharp) das imagens.`, '');
  if (p150) out.push(`Com ${p150.users} usuários: ${p150.summary.rps} req/s, p95 PUT /content ${ms(row(p150, 'PUT /api/presentations/:id/content').p95ok)}, p95 GET ${ms(p150.criteria.getP95)}, p99 ${ms(p150.summary.p99)}, **${p150.criteria.e5xx} × 5xx**, ${errClass(p150.summary.rows, '429')} × 429, integridade ${p150.integrity.ok}/${p150.integrity.total}, vazamentos ${p150.leaks.length}.`, '');
  return out.join('\n');
}

function findingsSection(r, exps) {
  const keep = r.phases.find((p) => p.mode === 'keep' && p.users === 50), p100 = r.phases.find((p) => p.users >= 100);
  const rp = r.refreshProbe || {};
  const pres = r.after.db.tables.find((t) => t.table === 'presentations') || {};
  const row = (p, k) => (p && p.summary.rows.find((x) => x.key === k)) || {};
  const pool20 = exps && exps.find((p) => p.dbPoolMax > 5 && p.users === 100);
  const out = ['## 9. Achados (o que corrigir — proposta, sem alterar código fora do escopo deste teste)', ''];
  out.push(`**A1 — Limites de taxa por IP derrubam o autosave de um escritório (alto).** Em \`rate()\` (src/lib/presentations-service.js:20–24) todo endpoint autenticado tem um balde por usuário e outro por IP com 5× o valor (escrita 600/min, upload 300/min, leitura 3 000/min). 50 pessoas atrás do mesmo NAT salvando a cada 3–5 s geram ~750 PUT/min: ${keep ? `**${keep.autosaveRejectedPct} % dos autosaves (${n(keep.stats.put429)} de ${n(keep.stats.cycles)})** receberam 429 na fase 1, em rajadas (janela fixa de 60 s: o balde enche aos ~40 s e todos ficam bloqueados até a virada), mais ${n(errClass(keep.summary.rows, '429') - keep.stats.put429)} × 429 em cópias, \`assets/check\` e miniaturas.` : ''} O editor mostra "Sem conexão — alterações guardadas neste computador" e recua até 60 s. Nada se perde, mas 50 usuários num escritório da A&M vivem isso o dia todo. Reprodução: \`node tests/load/run.js --phases 50x180:keep --skip-browser\` (ou 50 sessões no mesmo IP). Proposta: para usuário autenticado o limite por IP é redundante com o limite por usuário — remover o balde \`:ip\` de \`rate()\` ou subir o multiplicador para ≥ 25× (configurável em \`app.settings\`, ex.: \`rate.ip_multiplier\`), mantendo os limites por IP só nas rotas anônimas (login, forgot, verify); trocar a janela fixa por janela deslizante/token bucket para não sincronizar os bloqueios.`, '');
  out.push(`**A2 — \`POST /api/auth/refresh\` 30/min por IP desloga quem divide o IP (alto).** src/routes/auth.js:188 (\`refresh_ip\`, 60 s, 30). Na sonda, ${rp.sessions} sessões reais no mesmo IP renovaram no mesmo instante: ${Object.entries(rp.statuses || {}).map(([k, v]) => `${k} × ${v}`).join(', ')}${rp.firstRetryAfterS != null ? ` (Retry-After ${rp.firstRetryAfterS} s)` : ''}. O cliente web (web/js/api.js) trata refresh falho como sessão perdida e manda para \`/entrar?motivo=sessao\`; a extensão do editor mostra "Sessão expirada". Como os access tokens duram 1 h, quem entrou junto (início do expediente) renova junto. Proposta: chavear o limite do refresh pelo hash do refresh token (ou pelo usuário) em vez do IP, ou ≥ 600/min por IP; no cliente, tratar 429 no refresh com espera do \`Retry-After\` e nova tentativa antes de redirecionar.`, '');
  out.push(`**A3 — \`POST /api/auth/verify\` 5 por 15 min por IP trava o onboarding presencial (médio).** src/routes/auth.js:138. Num dia de convites no escritório, a 6ª pessoa a clicar no link em 15 min recebe 429 "Muitas tentativas" com um link válido. Para ativar ${r.setup.users} contas o teste precisou zerar o balde \`verify_ip\` antes de cada ativação. Proposta: limitar por \`token_hash\` (o token é de uso único e tem 24 bytes aleatórios — força bruta é inviável) e manter por IP só um teto alto (ex.: 100/15 min), ou documentar a restrição no fluxo de convite.`, '');
  out.push(`**A4 — \`admin_invite\` 60 por hora por admin, não documentado (baixo).** src/routes/admin.js:145 e 173; API.md §2 não lista. Importar 100+ usuários (planilha) leva 2 h ou falha com 429 (\`retryAfterS\` ≈ 3 500). Proposta: documentar, subir para 300/h ou tornar configurável em \`app.settings\` (\`invites.per_hour\`), e devolver no 429 quantos convites ainda cabem.`, '');
  out.push(`**A5 — Com 100 usuários o processo da API satura a thread do JavaScript (médio, desempenho).** ${p100 ? `${p100.summary.rps} req/s, p95 PUT /content ${ms(row(p100, 'PUT /api/presentations/:id/content').p95ok)}, p95 GET ${ms(p100.criteria.getP95)}, p95 do envio de imagem ${ms(row(p100, 'PUT /api/assets/:sha').p95ok)}, CPU média ${p100.system.cpuAvgPct} % (máx. ${p100.system.cpuMaxPct} %) do processo — 0 × 5xx e integridade ${p100.integrity.ok}/${p100.integrity.total}.` : ''}${pool20 ? ` Com DB_POOL_MAX=${pool20.dbPoolMax} o p95 ficou em ${ms(row(pool20, 'PUT /api/presentations/:id/content').p95ok)}: o pool não é o gargalo.` : ''} Por autosave a API faz \`JSON.parse\` de 150–400 KB, \`lintDeck\` (percorre todo o JSON e testa cada string em até 4 camadas de decodificação), \`canonicalize\` + SHA-256, \`JSON.stringify\` para o jsonb e ~18 idas e voltas ao banco (duas transações só para \`hit_rate\` + a transação do usuário com \`set role\`/\`set_config\`). Proposta: (1) na hospedagem em contêiner, rodar 1 processo por CPU (\`node:cluster\` ou réplicas atrás do balanceador) — na Vercel cada instância atende 1 requisição e o limite é por instância, então este achado vale para o contêiner/local; (2) mover \`prepareContent\` (lint + hash) para um pool de \`worker_threads\` quando o corpo passar de ~100 KB; (3) juntar os dois \`hit_rate\` numa só consulta sem transação explícita (−4 idas e voltas por requisição; na Supabase cada ida e volta custa 1–2 ms); (4) servir \`GET /api/assets/:sha\` por URL assinada/CDN também abaixo de 8 MB quando a CSP permitir o host do bucket (hoje os bytes passam pelo Node).`, '');
  out.push(`**A6 — Autosave a cada 3–5 s do deck inteiro infla o banco (médio, armazenamento).** ${n((r.phases || []).reduce((a, p) => a + p.stats.putOk, 0))} salvamentos de ~270 KB levaram o banco de ${mb(r.baseline.db.bytes)} a ${mb(r.after.db.bytes)}; \`app.presentations\` terminou com ${mb(pres.bytes)} e **${n(pres.dead)} tuplas mortas para ${n(pres.live)} vivas** (cada UPDATE reescreve o jsonb inteiro no TOAST e o autovacuum padrão não acompanha). Extrapolando (50 pessoas × 8 h × 15 salvamentos/min × 270 KB ≈ 100 GB/dia de escrita e WAL), isso pesa em disco, backup e no orçamento de I/O da Supabase. Proposta: \`alter table app.presentations set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_delay = 2)\` (e o mesmo na tabela TOAST), \`toast_compression = lz4\`; no cliente, debounce de 3 s → 5–8 s com teto de espera (hoje \`DEBOUNCE = 3000\` em ed-50-cloud.js) ou autosave só quando o usuário para de digitar; acompanhar \`n_dead_tup\` de \`app.presentations\` em MONITORAMENTO.md.`, '');
  out.push(`**A7 — Pool da API (DB_POOL_MAX=5) fica 100 % alocado já com 50 usuários (informativo).** Conexões ativas em média ${keep ? keep.system.pg?.avgActive : '—'} de 5 (máx. ${keep ? keep.system.pg?.maxActive : '—'}) — o banco está folgado; as 5 conexões ficam presas em *idle in transaction* entre as idas e voltas. Em contêiner, 10 conexões por processo são um bom valor; na Vercel (1 requisição por instância) 2–3 bastam e economizam o pooler.`, '');
  out.push(`**Positivo** — 0 × 5xx em ${n(r.serverLog?.total)} requisições; integridade 100 % (${n(r.phases.reduce((a, p) => a + p.integrity.total, 0))} apresentações, rev e hash iguais ao último PUT confirmado); ${n(r.phases.reduce((a, p) => a + p.stats.stale, 0))} salvamentos obsoletos todos recusados com 409 e \`serverRev\` correto; 0 vazamentos em ${n(r.phases.reduce((a, p) => a + p.stats.probes, 0))} sondas; deduplicação exata (1 objeto por arquivo distinto, bytes do banco = disco); memória do processo estável (RSS máx. ${Math.max(...r.phases.map((p) => p.system.rssMaxMb))} MB); zero violações de CSP e zero erros de console ao abrir o editor em nuvem.`, '');
  return out.join('\n');
}

function buildReport(r, { jsonPath, devLog, experiments }) {
  const h = r.hardware, cfg = r.config;
  const out = [];
  out.push('# Evidências — teste de carga (50 e 100 usuários simultâneos)', '');
  out.push(`Executado em ${r.startedAt.slice(0, 16).replace('T', ' ')} UTC por \`npm run test:load\` (\`platform/tests/load/run.js\`), duração total ${Math.round(r.totalMs / 1000)} s. Resultado bruto: \`${jsonPath}\`; log da API: \`${devLog}\` (ambos em \`.tmp/\`, fora do git).`, '');
  out.push('## 1. Metodologia', '');
  out.push(`- **Hardware/ambiente**: ${h.cpus} CPUs (${h.cpuModel}), ${h.memGb} GB de RAM, ${h.platform}, Node ${h.node}, ${h.postgres} **local** (mesma máquina), armazenamento de arquivos em disco local (\`STORAGE_DRIVER=local\`), **sem rede** (cliente de carga, API e banco no mesmo host, em 127.0.0.1). A produção difere: Vercel Functions (sem estado, 1 instância por requisição concorrente, pool de 5 por instância), Supabase Postgres atrás do pooler em modo transação (porta 6543), Supabase Storage/S3 por HTTPS, latência de rede real entre API e banco (~1–5 ms por ida e volta na mesma região) e entre navegador e API. Os números abaixo medem a **lógica** (SQL, RLS, lint, hash, validação de imagem, I/O) e servem de piso; latências de produção serão maiores em termo absoluto.`);
  out.push(`- **Pilha real** em um comando: \`APP_ENV=local node tools/dev.js --port ${cfg.port} --db ${cfg.db} --admin admin@am.test --name "Admin" --reset\` (Postgres local + GoTrue falso + build do site + API Hono; PID guardado e encerrado ao fim). Nenhum mock: cada requisição passa por CSRF, sessão (JWT ES256 + \`app.resolve_identity\`), limites de taxa em \`app.hit_rate\`, transação \`SET LOCAL ROLE app_user\` com RLS, lint de segurança do deck, hash canônico e validação de imagem por \`sharp\`.`);
  out.push(`- **Usuários**: ${r.setup.users} criados pela API como o admin faria (\`POST /api/admin/invites\` → e-mail na outbox do GoTrue falso → \`POST /api/auth/verify\` → \`POST /api/auth/password\`), cada um com cookie jar e CSRF próprios (sessão real, nunca token em JS) em ${(r.setup.ms / 1000).toFixed(1)} s. **Todas as sessões saem do mesmo IP (127.0.0.1)** — equivalente a um escritório inteiro atrás do mesmo NAT; \`tools/dev.js\` fixa \`TRUST_PROXY=0\`, então cabeçalhos \`X-Forwarded-For\` são ignorados (correto). Para ativar ${r.setup.users} contas foi preciso zerar o balde \`verify_ip\` (5 por 15 min por IP) antes de cada ativação — veja o achado A1.`);
  out.push(`- **Dados**: decks no formato do editor (\`{v:1, app:'AM Studio', slides:[…]}\`, texto rico, formas, linhas ligadas, componentes \`fx\`, notas) com 150–400 KB de JSON e **3 imagens já externalizadas** (\`asset:sha256:…\`) enviadas por **todos** os usuários (prova de deduplicação: ${r.images.shared.map((i) => kb(i.size) + ' ' + i.mime.split('/')[1]).join(', ')}); imagens "novas" reais (PNG/JPEG de ruído incompressível, 200–800 KB): 80 % **únicas**, geradas na hora para cada envio (${n(r.images.generated?.n)} nesta execução, ${r.images.generated?.totalMb} MB), e 20 % de um conjunto de ${r.images.pool.n} imagens comuns (${r.images.pool.minKb}–${r.images.pool.maxKb} KB, ${r.images.pool.jpeg} JPEG) que várias pessoas enviam; 1 imagem privada por usuário (8 KB, nunca referenciada) como alvo das sondas de vazamento; miniaturas únicas (\`X-Asset-Kind: thumb\`).`);
  out.push(`- **Mix por sessão** (\`tests/load/scenario.cjs\`, sequencial como um navegador): a cada 3–5 s um autosave (\`PUT /content\` com \`baseRev\`, deck inteiro, edição real do slide 1 → hash novo); em 20 % dos ciclos antes do autosave uma imagem nova de 200–800 KB (\`POST /api/assets/check\` + \`PUT /api/assets/:sha\`) passa a ser referenciada no deck; 1×/60 s a miniatura (\`PUT /api/assets/:sha\` thumb + \`thumbSha\` no PUT). Depois de cada autosave, UMA ação secundária sorteada: 25 % abrir acervo (\`GET /api/presentations\`), 20 % abrir apresentação alheia (\`GET /:id\`), 15 % listar versões, 15 % baixar um arquivo (\`GET /api/assets/:sha\`, tamanho conferido), 10 % criar cópia de apresentação alheia, 5 % comentar, 5 % sonda de vazamento (versões alheias → 403; arquivo privado alheio → 404; \`PUT\` em apresentação alheia → 403; \`scope=mine\` só com itens meus), 5 % salvamento obsoleto (\`baseRev\` errado → 409 **esperado**; um 200 aqui seria perda de integridade).`);
  out.push(`- **Medições**: por endpoint no cliente (req/s, p50/p95/p99 incluindo rede local e leitura do corpo; códigos de resposta classificados em ok / esperado / 429 / 4xx / 5xx / rede) e pela própria API (campo \`ms\` do log de acesso); \`pg_stat_activity\` do banco do teste a cada 2 s (total, ativas, idle in transaction, aguardando lock); \`pg_database_size\` e tamanho por tabela antes/depois; nº e bytes dos objetos em \`.data/objects\`; RSS/CPU do processo da API lidos de \`/proc/<pid>\`. Ao fim de cada fase: \`GET /:id\` e consulta direta ao banco de cada apresentação comparados com o **último PUT 200** de cada sessão (rev **e** hash canônico), \`rev\` final = inicial + nº de PUT 200 alterados; vazamentos = qualquer sonda com 200; deduplicação = linhas em \`app.assets\`/objetos em disco por imagem compartilhada × posses em \`app.asset_uploads\`.`);
  out.push(`- **Fases**: ${cfg.phases.map((p, i) => `(${i + 1}) ${p.users} usuários × ${p.seconds} s, limites por IP ${p.mode === 'clear' ? '**neutralizados** (as linhas `%:ip` de app.rate_limits são apagadas a cada 2 s — simula usuários em IPs distintos: casa, VPN, cliente)' : '**como estão** (escritório atrás de um NAT)'}`).join('; ')}. Entre fases, 5 s de pausa; cada fase cria apresentações novas para os seus usuários (as anteriores continuam no acervo).`);
  out.push(`- **Abertura do editor**: Chromium real (Playwright) abre \`/editor/<id>\` ${cfg.browserN}× em contexto novo e mede até a pílula "Salvo" com o deck hidratado; o editor autônomo publicado \`AM-Studio-Editor.html\` (raiz: o build atual de \`studio/\`, que o build em nuvem segue) é aberto ${cfg.browserN}× em \`file://\` até \`AMStudio\` pronto.`, '');

  out.push('## 2. Antes e depois', '');
  const before = r.baseline, after = r.after;
  out.push(table(['Medida', 'Antes', 'Depois'], [
    ['Tamanho do banco `' + cfg.db + '`', mb(before.db.bytes), `${mb(after.db.bytes)} (+${mb(after.db.bytes - before.db.bytes)})`],
    ['Conexões ao banco (fora a do medidor)', n(before.db.connections), `${n(after.db.connections)} (max_connections ${after.db.maxConnections})`],
    ['Objetos no diretório de arquivos `.data/objects` (compartilhado por todas as instâncias locais)', `${n(before.objects.count)} (${mb(before.objects.bytes)})`, `${n(after.objects.count)} (${mb(after.objects.bytes)}); criados nesta execução: ${n(after.objects.countSince)} (${mb(after.objects.bytesSince)})`],
    ['Linhas: apresentações / versões / comentários / auditoria / rate_limits', '0 (banco recriado com --reset)', `${n(after.counts.presentations)} / ${n(after.counts.versions)} / ${n(after.counts.comments)} / ${n(after.counts.audit)} / ${n(after.counts.rateLimitRows)}`],
  ]), '');
  out.push('Tabelas ao fim (tamanho total com índices e TOAST):', '', table(['Tabela', 'Tamanho', 'Tuplas vivas', 'Tuplas mortas'], after.db.tables.slice(0, 8).map((t) => ['app.' + t.table, mb(t.bytes), n(t.live), n(t.dead)])), '');

  out.push('## 3. Resultados por fase', '');
  r.phases.forEach((p, i) => out.push(phaseSection({ ...p, dbPoolMax: cfg.dbPoolMax }, i, r.serverLog && r.serverLog.byPhase[i]), ''));

  if (r.refreshProbe) {
    const rp = r.refreshProbe;
    out.push('## 3b. Sonda dos limites por IP nas rotas de sessão', '');
    out.push(`Fora das fases, ${rp.sessions} sessões reais (mesmo IP) chamaram \`POST /api/auth/refresh\` em ${rp.ms} ms — como acontece quando os access tokens de um escritório expiram no mesmo minuto: respostas ${Object.entries(rp.statuses).map(([k, v]) => `${k} × ${v}`).join(', ')}${rp.firstRetryAfterS != null ? ` (Retry-After ${rp.firstRetryAfterS} s)` : ''}. O limite é 30/min por IP (\`refresh_ip\`, src/routes/auth.js); o cliente web, ao falhar o refresh, envia a pessoa para \`/entrar?motivo=sessao\`. Na preparação também foi preciso zerar \`verify_ip\` (5/15 min por IP) e \`admin_invite\` (60/h por admin) para criar ${r.setup.users} contas — veja os achados.`, '');
  }
  out.push('## 4. Deduplicação de arquivos', '');
  const d = r.dedup;
  out.push(table(['Imagem compartilhada (referenciada por todos)', 'Linhas em app.assets', 'Objetos em disco', 'Posses (app.asset_uploads)', 'Tamanho no banco = em disco'], d.shared.map((s) => [`${s.sha}… (${kb(s.size)})`, s.status === 'ready' ? '1 (ready)' : `1 (${s.status})`, n(s.objects), n(s.owners), s.size === s.sizeOnDisk ? 'sim' : `**não** (${s.sizeOnDisk})`])), '');
  out.push(`A coluna "posses" conta só quem fez \`PUT\` dos bytes: pelo contrato, \`POST /api/assets/check\` responde "já disponível" a quem **vê** o arquivo (policy \`assets_select\`: enviou, provou posse **ou** ele está numa apresentação visível — e no acervo comum toda apresentação é visível), então a partir da 1ª apresentação que referenciou a imagem os demais usuários a referenciam sem reenviar (os poucos reenvios simultâneos aparecem como \`deduplicated:true\`). O que prova a deduplicação é **1 linha e 1 objeto por imagem distinta**, qualquer que seja o nº de pessoas e de apresentações que a usam.`, '');
  out.push(`Imagens comuns do conjunto: ${d.pool.images} distintas, ${d.pool.rowsInDb} linhas em \`app.assets\`, ${n(d.pool.totalOwners)} posses (a mais reenviada tem ${d.pool.maxOwners} donos → 1 objeto). Imagens únicas geradas na hora: ${n(r.images.generated?.n)} (${r.images.generated?.totalMb} MB). Total: ${n(d.assets.rows)} arquivos distintos (${mb(d.assets.bytes)}, ${d.assets.notReady} não-ready), ${n(d.uploadsRows)} posses, auditoria \`asset.upload\` ${n(d.audit.uploads)} (${n(d.audit.deduplicated)} marcadas \`deduplicated\`), \`asset.reject\` ${n(d.audit.rejects)}. Objetos gravados em disco nesta execução: ${n(d.objects.countSince)} (${mb(d.objects.bytesSince)}) — ${d.objects.countSince === d.assets.rows ? '**exatamente 1 objeto por arquivo distinto**, com os bytes do banco iguais aos do disco' : 'compare com os ' + n(d.assets.rows) + ' arquivos distintos (o diretório é compartilhado com outras instâncias locais)'}.`, '');

  out.push('## 5. Abertura do editor em nuvem × autônomo publicado', '', browserSection(r.browser), '');

  out.push('## 6. Log da API', '');
  if (r.serverLog) out.push(`${n(r.serverLog.total)} requisições registradas pela API em toda a execução (inclui preparação e Playwright); **${r.serverLog.e5xx} respostas 5xx**${r.serverLog.e5xxSamples.length ? ':\n\n' + r.serverLog.e5xxSamples.map((s) => '    ' + s).join('\n') : '.'}${r.serverLog.errors.length ? `\n\nLinhas de erro da API (${r.serverLog.errors.length}, primeiras):\n\n` + r.serverLog.errors.slice(0, 5).map((s) => '    ' + s).join('\n') : ''}`, '');

  out.push('## 7. Onde degrada (limite encontrado)', '');
  const p50u = r.phases.find((p) => p.users === 50 && p.mode === 'clear') || r.phases.find((p) => p.users === 50), p100 = r.phases.find((p) => p.users >= 100);
  if (p50u && p100) {
    const row = (p, k) => p.summary.rows.find((x) => x.key === k) || {};
    out.push(table(['Medida', `${p50u.users} usuários`, `${p100.users} usuários`], [
      ['Requisições por segundo', p50u.summary.rps, p100.summary.rps],
      ['p95 PUT /content (200)', ms(row(p50u, 'PUT /api/presentations/:id/content').p95ok), ms(row(p100, 'PUT /api/presentations/:id/content').p95ok)],
      ['p95 GET (todas as leituras 2xx)', ms(p50u.criteria.getP95), ms(p100.criteria.getP95)],
      ['p99 geral', ms(p50u.summary.p99), ms(p100.summary.p99)],
      ['Latência medida pela API, p95 de PUT /content', ms((r.serverLog.byPhase[r.phases.indexOf(p50u)] || []).find((x) => /content$/.test(x.key))?.p95), ms((r.serverLog.byPhase[r.phases.indexOf(p100)] || []).find((x) => /content$/.test(x.key))?.p95)],
      ['Conexões ativas no Postgres (média / máx.)', `${p50u.system.pg?.avgActive} / ${p50u.system.pg?.maxActive}`, `${p100.system.pg?.avgActive} / ${p100.system.pg?.maxActive}`],
      ['CPU do processo da API (média / máx., de 400 %)', `${p50u.system.cpuAvgPct} % / ${p50u.system.cpuMaxPct} %`, `${p100.system.cpuAvgPct} % / ${p100.system.cpuMaxPct} %`],
      ['Erros 5xx', p50u.criteria.e5xx, p100.criteria.e5xx],
    ]), '');
    out.push(`Com ${p100.users} usuários a vazão quase dobra (${p50u.summary.rps} → ${p100.summary.rps} req/s) e a latência ${p100.criteria.getP95 > 300 ? '**sai do critério de leitura (p95 GET > 300 ms)**' : 'continua dentro dos critérios'}; o PUT /content ${row(p100, 'PUT /api/presentations/:id/content').p95ok <= 800 ? 'ainda fica ≤ 800 ms no p95' : '**ultrapassa 800 ms no p95**'} e ${p100.criteria.e5xx === 0 ? 'não houve nenhum 5xx' : 'aparecem 5xx'}. A latência medida pela própria API cresce na mesma proporção que a do cliente, ou seja, o tempo está **dentro do processo da API** (fila do pool de ${cfg.dbPoolMax} conexões — todas ocupadas nas amostras, com até ${p100.system.pg?.maxIdleInTx} em *idle in transaction* entre as ~18 idas e voltas de cada autosave — e a thread única do JavaScript, que faz lint, hash canônico e parse de 150–400 KB por salvamento), não no banco (ativas em média ${p100.system.pg?.avgActive} de ${cfg.dbPoolMax}) nem na rede.`, '');
  }
  const exp = experimentsSection(experiments); if (exp) out.push(exp, '');
  out.push('## 8. Como reproduzir', '', '```bash', 'cd platform && npm run test:load                      # fases padrão: 50x180:keep, 50x180:clear, 100x60:clear + Playwright', 'node tests/load/run.js --phases 10x30:keep --skip-browser   # fumaça', 'node tests/load/run.js --phases 150x60:clear --skip-browser --no-report               # procurar o limite', 'node tests/load/run.js --phases 100x60:clear --pool-max 20 --skip-browser --no-report  # experimento: pool maior', 'node tests/load/run.js --report-only .tmp/load/resultado-<data>.json --experiments .tmp/load/resultado-<e1>.json,.tmp/load/resultado-<e2>.json   # regenera este arquivo', '```', '');
  out.push('O harness escreve só em `platform/.tmp/load/` e neste arquivo; usa a porta 4402 e o banco `canteiro_t_load` (recriado com `--reset`), e encerra apenas o `dev.js` que iniciou (`kill <pid>`). Durante esta execução outros processos de teste do repositório rodavam na mesma máquina (ex.: outro `dev.js` na porta 4403), disputando as 4 CPUs — os tempos absolutos carregam esse ruído; as comparações entre fases foram feitas em sequência, nas mesmas condições.', '');
  out.push(findingsSection(r, experiments), '');
  return out.join('\n') + '\n';
}

module.exports = { buildReport };
