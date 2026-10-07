#!/usr/bin/env node
/* tools/parity-evidence.cjs — transforma a saída de tools/parity.cjs (<out>/relatorio.json + relatorio.md) no documento de evidências
   docs/evidencias/paridade.md, com a metodologia fixa e os números medidos. Uso: node tools/parity-evidence.cjs [--out .tmp/parity/cloud] [--doc docs/evidencias/paridade.md] */
'use strict';
const fs = require('fs'); const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const OUT = path.resolve(args.out || path.join(__dirname, '..', '.tmp', 'parity', 'cloud'));
const DOC = path.resolve(args.doc || path.join(__dirname, '..', 'docs', 'evidencias', 'paridade.md'));
const rep = JSON.parse(fs.readFileSync(path.join(OUT, 'relatorio.json'), 'utf8')); const md = fs.readFileSync(path.join(OUT, 'relatorio.md'), 'utf8');
const S = rep.summary, C = rep.catalog, byKind = rep.slides.reduce((o, r) => (o[r.kind] = (o[r.kind] || 0) + 1, o), {});
const fam = { in: 'Entrada', loop: 'Contínuo', hover: 'Ao passar o mouse', tr: 'Transição', cmp: 'Componentes', icon: 'Ícones', model: 'Modelos' };
const dur = (s) => `${Math.floor(s / 60)} min ${s % 60} s`;
const doc = `# Prova de paridade — original × editor em nuvem (todos os efeitos, modelos, layouts e quadros)

**Resultado: ${S.identical ? 'IDÊNTICO' : 'DIVERGÊNCIAS ENCONTRADAS'}** — gerado em ${rep.startedAt} por \`platform/tools/parity.cjs\` (${dur(S.durationS)}), documento montado por \`tools/parity-evidence.cjs\`. Relatório bruto: \`platform/.tmp/parity/cloud/relatorio.{json,md}\` (não versionado; reproduza com \`npm run test:parity\`).

| Lado | Arquivo | SHA-256 |
|---|---|---|
| A (original) | \`${path.basename(rep.a)}\` | \`${rep.aSha}\` |
| B (candidato: editor em nuvem) | \`${path.basename(rep.b)}\` | \`${rep.bSha}\` |

## 1. O que a prova garante

O editor em nuvem é o original acrescido da extensão de nuvem e de seis ajustes de uma linha. Esta prova mostra que **tudo o que o usuário vê** — cada efeito do Acervo de efeitos com suas variantes, cada caixa da Biblioteca de modelos, todos os ícones e transformações, layouts, projetos prontos da capa, blocos, SmartArt, formas, textos, linhas e marcas — **rende de forma idêntica** nos dois arquivos, quadro a quadro, inclusive durante as animações e as transições, e que as exportações (HTML e PowerPoint) são as mesmas.

## 2. Método (determinístico e reproduzível)

1. **Mesmo Chromium, mesmas fontes**: A e B abertos no mesmo navegador (1280×720, \`--disable-lcd-text\`, sem *hinting*), fontes do Google servidas de \`fonts2/\` (sem rede), \`Math.random\`/\`crypto.getRandomValues\` com semente fixa, relógio da página controlado (\`page.clock\`).
2. **Deck de prova construído pelo caminho do usuário em A**: lê a gaveta “Acervo de efeitos” (${C.gx} caixas: ${Object.entries(C.byFam).map(([k, v]) => `${fam[k] || k} ${v}`).join(', ')}), aciona “Provar → Usar este efeito” em cada uma sobre 5 tipos de elemento (título, forma, linha, imagem, componente); insere as ${C.biblioteca} caixas da Biblioteca de modelos, os ${C.icons} ícones e ${C.morphs} transformações, os ${C.layouts} layouts, os ${C.templates} projetos prontos da capa, os ${C.seqs} blocos, os ${C.smart} SmartArt, formas, textos, linhas e marcas → **${S.slides} slides**, ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')}.
3. **O mesmo JSON do deck é carregado em A e em B** (recarregados do zero, para que contadores internos e temporizadores partam do mesmo estado). Catálogo da gaveta idêntico nos dois (${C.identicalInB ? 'conferido' : 'DIFERENTE'}); CSS e JS do runtime embutido idênticos (sha ${rep.runtime.cssSha} / ${rep.runtime.jsSha}).
4. **Por slide, cinco camadas**: (a) DOM renderizado (\`AMRT.renderSlide\`), com os relógios de A e B pausados no mesmo instante absoluto; (b) raster 1280×720 pelo caminho do PDF (\`AMExport.rasterSlide\`), pixel a pixel; (c) quadros do player em t = 0, 150, 400, 800, 1500 e 3000 ms, com toda animação fixada em t e conferida (pausada, em t) antes da captura; (d) nas transições, quadros a 80, 250 e 500 ms após avançar, **cada instante numa sequência nova do player** (medir os três na mesma sequência deixava o raster dos blocos da lâmina em movimento dependente do histórico de pausas); (e) barra de controles do player. Toda foto é uma captura estável: repetida até duas capturas seguidas saírem byte-idênticas.
5. **Exportações**: HTML autônomo (sha256 do arquivo inteiro) e PowerPoint (sha256 de cada entrada do zip, exceto \`docProps/core.xml\`, que leva a data).
6. **Ruído do Chromium**: calibrado comparando o original **consigo mesmo** (base-anims: 2 quadros em 135, ambos em bordas de \`clip-path\` — íris 43 px/máx 49, diagonal 174 px/máx 11). Diferenças ≤ ${rep.noiseEnvelope.px} px, ≤ ${rep.noiseEnvelope.pct} % e ≤ ${rep.noiseEnvelope.maxCh}/255 em bordas de máscara não são atribuíveis ao candidato; mesmo assim cada caso é listado abaixo com a imagem de diferença. DOM, raster e exportações exigem igualdade exata.
7. **Recaptura**: uma divergência na 1ª captura é recapturada imediatamente uma vez, em faixa própria do relógio. Uma diferença real entre A e B reproduz; instabilidade de captura (compositor atrasado sob carga) não — e fica registrada como “captura instável”, com as imagens da 1ª tentativa (\`diff/<slide>-t1-*\`). Nesta execução: **${S.retriedSlides} recaptura(s), ${S.unstableCaptures} instável(is), ${S.retriedSlides - S.unstableCaptures} divergência(s) reproduzida(s)**.

## 3. Resultado medido

| Camada | Resultado |
|---|---|
| Catálogo (ids e famílias) A = B | ${C.identicalInB ? 'idêntico' : 'DIFERENTE'} |
| Runtime embutido (CSS ${rep.runtime.cssBytes} B, JS ${rep.runtime.jsBytes} B) | ${rep.runtime.cssSame && rep.runtime.jsSame ? 'idêntico' : 'DIFERENTE'} |
| Deck de prova normalizado (${S.slides} slides) | ${rep.deckNormalizedSame ? 'idêntico' : 'DIFERENTE'} |
| DOM renderizado | **${S.domIdentical}/${S.compared}** idênticos${S.domIdenticalExceptCounterIds ? ` (${S.domIdenticalExceptCounterIds} só com ids internos de contador diferentes)` : ''} |
| Raster 1280×720 (caminho do PDF) | **${S.rasterIdentical}/${S.compared}** idênticos |
| Quadros do player (6 por slide) | **${S.framesIdentical}/${S.framesTotal}** idênticos pixel a pixel${S.framesNoiseClass ? ` + ${S.framesNoiseClass} dentro do envelope de ruído (bordas de máscara), listados abaixo` : ''} |
| Quadros de transição (3 por transição) | **${S.transitionsIdentical}/${S.transitionsTotal}** idênticos${S.transitionsNoiseClass ? ` + ${S.transitionsNoiseClass} no envelope de ruído` : ''} |
| Barra de controles do player | ${S.playerBarAntialiasOnly} quadros só com antialias de texto (≤ 16/255, ≤ 0,05 %); ${rep.mismatches.filter((m) => m.layer === 'player-bar').length} divergências |
| HTML exportado (${Math.round(rep.exportHtml.bytes / 1024)} KB) | ${rep.exportHtml.same ? `idêntico (sha ${rep.exportHtml.shaA}…)` : 'DIFERENTE'} |
| PowerPoint exportado | ${rep.exportPptx && rep.exportPptx.same === true ? `idêntico (${rep.exportPptx.entries} entradas)` : rep.exportPptx && rep.exportPptx.same === false ? 'DIFERENTE: ' + rep.exportPptx.diff.join(', ') : 'não medido'} |
| Erros de console/página em A e B | ${rep.errors.length} |
| **Divergências atribuíveis ao candidato** | **${S.mismatches}** |

${rep.unstable && rep.unstable.length ? '### Capturas instáveis (1ª captura divergente, recaptura idêntica — não atribuíveis ao candidato)\n\n' + rep.unstable.map((u) => `- slide ${u.i + 1} · ${u.it} · ${u.first.map((m) => `${m.layer}${m.t != null ? ' t=' + m.t + ' ms' : ''}${m.px != null ? ` (${m.px} px, máx ${m.maxCh}/255)` : ''}`).join('; ')}`).join('\n') + '\n' : ''}${rep.noise.length ? '### Quadros dentro do envelope de ruído (imagens em `diff/*-ruido-diff.png`)\n\n' + rep.noise.map((m) => `- ${m.layer} · slide ${m.i + 1} · ${m.it} · t=${m.t} ms · ${m.px} px (${m.pct} %), máx ${m.maxCh}/255`).join('\n') + '\n' : ''}${rep.mismatches.length ? '### Divergências\n\n' + rep.mismatches.map((m) => `- ${m.layer} · slide ${m.i != null ? m.i + 1 : '-'} · ${m.it || m.detail || ''}${m.t != null ? ' · t=' + m.t + ' ms' : ''}${m.pct != null ? ' · ' + m.pct + ' % dos pixels' : ''}`).join('\n') + '\n' : '### Divergências\n\nNenhuma.\n'}
## 4. Como reproduzir

\`\`\`bash
cd platform
npm run build:cloud                                   # gera .tmp/cloud-build/cloud-editor.html e prova que o autônomo segue byte-idêntico ao original
npm run test:parity                                   # ≈ 1 h: original × nuvem, todos os slides e quadros → .tmp/parity/cloud/relatorio.md
node tools/parity.cjs --a .tmp/parity/original.html --b .tmp/cloud-build/cloud-editor.html --out .tmp/parity/x --deck .tmp/parity/cloud --only 57,134   # reconferir slides específicos
node tools/parity-evidence.cjs                        # atualiza este documento a partir do relatório
\`\`\`

## 5. Relatório bruto desta execução

${md.split('\n').slice(2).join('\n')}
`;
fs.mkdirSync(path.dirname(DOC), { recursive: true }); fs.writeFileSync(DOC, doc);
console.log(`escrito ${DOC} (${doc.length} caracteres) · idêntico=${S.identical} · divergências=${S.mismatches} · recapturas=${S.retriedSlides} (instáveis ${S.unstableCaptures})`);
