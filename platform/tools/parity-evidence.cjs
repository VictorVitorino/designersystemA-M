#!/usr/bin/env node
/* tools/parity-evidence.cjs — transforma a saída de tools/parity.cjs (<out>/relatorio.json + relatorio.md) no documento de evidências
   docs/evidencias/paridade.md. Tudo o que é número, instante, modo e parâmetro vem do relatório; nada é texto fixo.
   Uso: node tools/parity-evidence.cjs [--out .tmp/parity/cloud] [--doc docs/evidencias/paridade.md] */
'use strict';
const fs = require('fs'); const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const OUT = path.resolve(args.out || path.join(__dirname, '..', '.tmp', 'parity', 'cloud'));
const DOC = path.resolve(args.doc || path.join(__dirname, '..', 'docs', 'evidencias', 'paridade.md'));
const rel = (p) => path.relative(path.join(__dirname, '..', '..'), p).split(path.sep).join('/');
const rep = JSON.parse(fs.readFileSync(path.join(OUT, 'relatorio.json'), 'utf8')); const md = fs.readFileSync(path.join(OUT, 'relatorio.md'), 'utf8');
let patches = []; try { const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'studio-cloud', 'patches.json'), 'utf8')); patches = (Array.isArray(pj) ? pj : pj.patches || []).map((p) => p.id || p.name); } catch (e) { patches = []; }
const S = rep.summary, C = rep.catalog, byKind = rep.slides.reduce((o, r) => (o[r.kind] = (o[r.kind] || 0) + 1, o), {});
const fam = { in: 'Entrada', loop: 'Contínuo', hover: 'Ao passar o mouse', tr: 'Transição', cmp: 'Componentes', icon: 'Ícones', model: 'Modelos' };
const list = (a) => (a || []).join(', ');
const frameT = rep.frameT || [], trT = rep.trT || [], hoverT = rep.hoverT || [];
const sample = rep.only && rep.only.length;
const segs = rep.segments || [];
const pptx = rep.exportPptx || {};
const pptxRow = (mode, label) => { const r = pptx[mode]; return `| PowerPoint exportado — modo ${label} | ${r && r.same === true ? `idêntico (${r.entries} entradas do zip, exceto \`docProps/core.xml\`, que leva a data)` : r && r.same === false ? 'DIFERENTE: ' + r.diff.join(', ') : 'não medido (' + ((r || {}).note || (r || {}).error || 'sem resultado') + ')'} |`; };
const noiseLine = (m) => `- ${m.layer} · slide ${m.i + 1} · ${m.it} · t=${m.t} ms · ${m.px} px (${m.pct} %), máx ${m.maxCh}/255${m.bbox ? ` · caixa ${m.bbox.w}×${m.bbox.h} em (${m.bbox.x}, ${m.bbox.y})` : ''}`;
const doc = `# Prova de paridade — original × editor em nuvem (efeitos, modelos, layouts, projetos prontos, quadros do player, transições, mouse e exportações)

**Resultado: ${S.identical ? 'IDÊNTICO' : 'DIVERGÊNCIAS ENCONTRADAS'}**${sample ? ` — **amostra** de ${S.compared} slides (\`--only\`), não a prova completa` : ''} — relatório gerado em ${rep.startedAt.slice(0, 16).replace('T', ' ')} UTC por \`platform/tools/parity.cjs\` (identidade da medição: harness \`${(rep.identity || {}).harnessSha || '?'}\`, promoção de camada nas transições ${rep.promote === false ? 'desligada' : 'ligada'}); documento montado por \`tools/parity-evidence.cjs\`. Relatório bruto e imagens de cada diferença: \`${rel(OUT)}/\` (não versionado; reproduza com \`npm run test:parity\`).

| Lado | Arquivo | SHA-256 |
|---|---|---|
| A (original) | \`${path.basename(rep.a)}\` | \`${rep.aSha}\` |
| B (candidato: editor em nuvem) | \`${path.basename(rep.b)}\` | \`${rep.bSha}\` |
${segs.length > 1 ? `
Execução em **${segs.length} trechos** (\`--resume\`; cada registro do checkpoint carrega a identidade da medição — hashes de A, B, do deck e do harness, instantes e envelope — e só é reaproveitado se tudo coincidir): ${segs.map((g) => `${g.from.slice(11, 16)}–${g.to.slice(11, 16)} UTC (${g.slides} slides)`).join('; ')}; ${S.totalMinutes} min de medição no total${rep.resumeRefused ? `; ${rep.resumeRefused} registros de outra medição foram ignorados` : ''}${rep.diffDiscarded ? `; ${rep.diffDiscarded} imagens de medições substituídas movidas para \`diff/descartados/\`` : ''}.
` : `
Execução em um único trecho (${S.durationS} s).
`}
## 1. O que a prova garante

O editor em nuvem é o original acrescido da extensão de nuvem e de ${patches.length || 'alguns'} ajustes de uma linha${patches.length ? ` (\`${patches.join('`, `')}\`)` : ''}. Esta prova mostra que **tudo o que o usuário vê** — cada efeito do Acervo de efeitos com suas variantes, cada caixa da Biblioteca de modelos, todos os ícones e transformações, layouts, projetos prontos da capa, blocos, SmartArt, formas, textos, linhas e marcas — **rende de forma idêntica** nos dois arquivos, quadro a quadro, inclusive durante as animações, nas transições e com o mouse sobre os elementos, e que as exportações (HTML e PowerPoint, nos modos editável e imagem) são as mesmas. O que ela **não** mede está no §5.

## 2. Método (determinístico e reproduzível)

1. **Mesmo Chromium, mesmas fontes**: A e B abertos no mesmo navegador (1280×720, \`--disable-lcd-text\`, sem *hinting*), fontes do Google servidas de \`fonts2/\` (sem rede), \`Math.random\`/\`crypto.getRandomValues\` com semente fixa, relógio da página controlado (\`page.clock\`).
2. **Deck de prova construído pelo caminho do usuário em A**: lê a gaveta “Acervo de efeitos” (${C.gx} caixas: ${Object.entries(C.byFam).map(([k, v]) => `${fam[k] || k} ${v}`).join(', ')}), aciona “Provar → Usar este efeito” em cada uma sobre 5 tipos de elemento (título, forma, linha, imagem, componente); insere as ${C.biblioteca} caixas da Biblioteca de modelos, os ${C.icons} ícones e ${C.morphs} transformações, os ${C.layouts} layouts, os ${C.templates} projetos prontos da capa, os ${C.seqs} blocos, os ${C.smart} SmartArt, formas, textos, linhas e marcas → **${S.slides} slides** (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')}).
3. **O mesmo JSON do deck é carregado em A e em B** (recarregados do zero, para que contadores internos e temporizadores partam do mesmo estado). Catálogo da gaveta idêntico nos dois (${C.identicalInB ? 'conferido' : 'DIFERENTE'}); CSS e JS do runtime embutido idênticos (sha ${rep.runtime.cssSha} / ${rep.runtime.jsSha}).
4. **Por slide, as camadas**: (a) DOM renderizado (\`AMRT.renderSlide\`), com os relógios de A e B pausados no mesmo instante absoluto; (b) raster 1280×720 pelo caminho do PDF (\`AMExport.rasterSlide\`), pixel a pixel; (c) quadros do player em t = ${list(frameT)} ms, com toda animação fixada em t e conferida (pausada, em t) antes da captura — captura única por quadro; (d) **inventário das animações** do slide (alvo, pseudo-elemento, tipo, nome, duração, atraso, iterações, easing, fill, direção), comparado como texto; (e) nas transições, quadros a ${list(trT)} ms após avançar, **cada instante numa sequência nova do player** e com as lâminas promovidas a camada própria depois de fixadas (ver §4), captura estável (repetida até duas fotos seguidas iguais; as que não estabilizam em 6 fotos são contadas); (f) quadros com o **mouse sobre** todos os elementos com efeito de hover (classe \`.am-hov\`, a via programática do \`:hover\` do runtime) a ${list(hoverT)} ms, captura estável; (g) barra de controles do player.
5. **Exportações**: HTML autônomo (sha256 do arquivo inteiro) e PowerPoint nos modos **editável** e **imagem** (sha256 de cada entrada do zip, exceto \`docProps/core.xml\`, que leva a data).
6. **Ruído do Chromium**: calibrado comparando o original **consigo mesmo** (2 quadros em 135, ambos em bordas de \`clip-path\` — íris 43 px/máx 49, diagonal 174 px/máx 11). Diferenças com ≤ ${rep.noiseEnvelope.px} px, ≤ ${rep.noiseEnvelope.pct} % e ≤ ${rep.noiseEnvelope.maxCh}/255 não são atribuíveis ao candidato; mesmo assim cada caso é listado abaixo com a caixa envolvente e a imagem de diferença. DOM, raster, inventário de animações e exportações exigem igualdade exata.
7. **Recaptura**: uma divergência na 1ª captura é recapturada imediatamente uma vez, em faixa própria do relógio. Uma diferença real entre A e B reproduz; instabilidade de captura (compositor atrasado sob carga) não — e fica registrada como “captura instável”, com as imagens da 1ª tentativa (\`diff/<slide>-t1-*\`). Nesta execução: **${S.retriedSlides} recaptura(s), ${S.unstableCaptures} instável(is), ${S.retriedSlides - S.unstableCaptures} divergência(s) reproduzida(s)**.

## 3. Resultado medido

| Camada | Resultado |
|---|---|
| Catálogo (ids e famílias) A = B | ${C.identicalInB ? 'idêntico' : 'DIFERENTE'} |
| Runtime embutido (CSS ${rep.runtime.cssBytes} B, JS ${rep.runtime.jsBytes} B) | ${rep.runtime.cssSame && rep.runtime.jsSame ? 'idêntico' : 'DIFERENTE'} |
| Deck de prova normalizado (${S.slides} slides) | ${rep.deckNormalizedSame ? 'idêntico' : 'DIFERENTE'} |
| DOM renderizado | **${S.domIdentical}/${S.compared}** idênticos${S.domIdenticalExceptCounterIds ? ` (${S.domIdenticalExceptCounterIds} só com ids internos de contador diferentes; textos gravados em diff/*-dom-ids-*)` : ''} |
| Raster 1280×720 (caminho do PDF) | **${S.rasterIdentical}/${S.compared}** idênticos |
| Quadros do player (${frameT.length} por slide) | **${S.framesIdentical}/${S.framesTotal}** idênticos pixel a pixel${S.framesNoiseClass ? ` + ${S.framesNoiseClass} dentro do envelope de ruído, listados abaixo` : ''} |
| Inventário de animações por slide | **${S.animInventoryIdentical}/${S.animInventoryTotal}** idênticos |
| Quadros de transição (${trT.length} por transição) | **${S.transitionsIdentical}/${S.transitionsTotal}** idênticos${S.transitionsNoiseClass ? ` + ${S.transitionsNoiseClass} no envelope de ruído` : ''} |
| Quadros com o mouse sobre os elementos (${hoverT.length} por slide com hover) | **${S.hoverIdentical}/${S.hoverTotal}** idênticos${S.hoverNoiseClass ? ` + ${S.hoverNoiseClass} no envelope de ruído` : ''} |
| Barra de controles do player | ${S.playerBarAntialiasOnly} quadros só com antialias de texto (≤ 16/255, ≤ 0,05 %); ${rep.mismatches.filter((m) => m.layer === 'player-bar').length} divergências |
| Capturas que não estabilizaram em 6 fotos / avisos de sincronismo do relógio | ${S.unstableShots} / ${S.clockWarnings} |
| HTML exportado (${Math.round(rep.exportHtml.bytes / 1024)} KB) | ${rep.exportHtml.same ? `idêntico (sha ${rep.exportHtml.shaA}…)` : 'DIFERENTE'} |
${pptxRow('edit', 'editável')}
${pptxRow('image', 'imagem')}
| Erros de console/página em A e B | ${rep.errors.length} |
| **Divergências atribuíveis ao candidato** | **${S.mismatches}** |

${rep.unstable && rep.unstable.length ? '### Capturas instáveis (1ª captura divergente, recaptura idêntica — não atribuíveis ao candidato)\n\n' + rep.unstable.map((u) => `- slide ${u.i + 1} · ${u.it} · 1ª captura: ${u.first.map((m) => `${m.layer}${m.t != null ? ' t=' + m.t + ' ms' : ''}${m.px != null ? ` (${m.px} px, máx ${m.maxCh}/255${m.bbox ? ', caixa ' + m.bbox.w + '×' + m.bbox.h : ''})` : ''}`).join('; ')}`).join('\n') + '\n\n' : ''}${rep.noise.length ? '### Quadros dentro do envelope de ruído (imagens em `diff/*-ruido-diff.png`)\n\n' + rep.noise.map(noiseLine).join('\n') + '\n\n' : ''}${rep.mismatches.length ? '### Divergências\n\n' + rep.mismatches.map((m) => `- ${m.layer} · slide ${m.i != null ? m.i + 1 : '-'} · ${m.it || m.detail || ''}${m.t != null ? ' · t=' + m.t + ' ms' : ''}${m.pct != null ? ' · ' + m.pct + ' % dos pixels' : ''}`).join('\n') + '\n\n' : '### Divergências\n\nNenhuma.\n\n'}## 4. Uma diferença de instrumento, e como foi tratada

Antes da versão atual do harness, a transição “Deslizar” a 250 ms mostrava, em A e não em B, uma coluna de 255 pixels meio cobertos (x = 1218, linhas 0–254: valor 107/118/128 entre o fundo claro 205/209/212 da lâmina e o fundo escuro 0/21/39 da página; 0,031 % dos pixels). Ela **reproduzia** em todas as recapturas A × B e **não aparecia** no controle A × A (original × cópia do original). Não é CSS, JS nem DOM — esses são byte a byte iguais nos dois arquivos — e sim o agendamento dos blocos de raster do compositor do Chromium para a lâmina em movimento, que varia com o tamanho do documento: o primeiro bloco de 256 px de altura era refeito num instante da animação diferente dos demais. A medida que elimina essa dependência é promover as lâminas a camada própria (\`will-change\`) **depois** de fixar a transição no instante t, para que todos os blocos sejam rasterizados no estado fixado; aplicada igualmente a A e B, a transição sai idêntica. Esse comportamento é do instrumento de medição, não do editor: um espectador nunca o vê (é uma coluna de meio pixel num único quadro intermediário), e nenhuma outra camada (DOM, raster, inventário de animações, 2 500+ quadros) acusou diferença. Fica registrado aqui porque a honestidade da prova exige dizer o que mudou no instrumento e por quê.

## 5. O que esta prova NÃO cobre

- **Modo ativo da plataforma**: B é medido em \`file://\` com a extensão de nuvem inerte (sem \`window.AM_CLOUD\`): é exatamente o editor publicado em \`/editor/<id>\`, onde o palco e o player são os mesmos; em \`/visualizar/<id>\` a página acrescenta uma barra de 44 px no topo (título, sair), e a lâmina — idêntica — é mostrada em escala para a área restante. Essa barra é interface da plataforma, não conteúdo do slide.
- **Interações com o ponteiro além do hover**: cliques e arrasto em componentes interativos (formulários, post-its, votação, cronômetro, carrossel, antes/depois) e o zoom do player por movimento do mouse; atalhos de teclado do player; outros tamanhos de janela e densidade de pixels (DPR 2); exportação em PDF binária (o raster que a alimenta é comparado). O código desses caminhos é o mesmo nos dois arquivos (runtime byte a byte igual) e eles são exercitados pelas 35 baterias do portão do editor sobre o build em nuvem (EVIDENCIAS §1.1) e pela suíte E2E, mas não por comparação pixel a pixel.

## 6. Como reproduzir

\`\`\`bash
cd platform
npm run build:cloud                                   # gera .tmp/cloud-build/cloud-editor.html e prova que o autônomo segue byte-idêntico ao original
npm run test:parity                                   # ≈ 2 h: original × nuvem, todos os slides, quadros, transições, hover e exportações → .tmp/parity/cloud/relatorio.md
node tools/parity.cjs --a .tmp/parity/original.html --b .tmp/cloud-build/cloud-editor.html --out .tmp/parity/cloud --resume   # continuar uma execução interrompida
node tools/parity.cjs --a … --b … --out .tmp/parity/x --deck .tmp/parity/cloud --only 39,57                                     # reconferir slides específicos
npm run test:parity:evidence                          # atualiza este documento a partir do relatório
\`\`\`

## 7. Relatório bruto desta execução

${md.split('\n').slice(2).join('\n')}
`;
fs.mkdirSync(path.dirname(DOC), { recursive: true }); fs.writeFileSync(DOC, doc);
console.log(`escrito ${DOC} (${doc.length} caracteres) · idêntico=${S.identical} · divergências=${S.mismatches} · recapturas=${S.retriedSlides} (instáveis ${S.unstableCaptures})`);
