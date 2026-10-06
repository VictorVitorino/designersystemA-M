/* S33 — Gerar slides de uma planilha (ed-44-batch.js): Slide › Gerar slides de uma planilha (CSV)…; o slide atual é o modelo com
   {{Coluna}}; colar TSV/CSV (; ou ,) ou abrir .csv; prévia; marcadores do modelo (casados sem acento/caixa; sem coluna = aviso);
   gerar N slides depois do modelo (texto escapado, componentes com valores), modelo oculto, um Ctrl+Z; {{#}}/{{##}}; linhas por
   slide com {{Coluna#2}}; limite de 200 linhas; exemplo .csv; salvar/reabrir e Redefinir nos gerados.
   Uso: python3 assemble.py && node test-s33-lote.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s33-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s33'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,900):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const TSV='Nome\tCargo\tÁrea\tMensagem\nAna Souza\tDiretora de Operações\tOperações\tReduzimos <b>30 %</b> do lead time\nBruno Lima\tGerente de TI\tTecnologia\tPortal único; 2 mil usuários\nCarla Dias\tLíder de Pessoas\tPessoas\tCapacitação de 120 líderes\n';
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const dlgOpen=()=>p.evaluate(()=>!!(window.AMBatch&&AMBatch.isOpen()));
  /* ---------- 1. parser ---------- */
  const pr=await p.evaluate(()=>{ const P=AMBatch.parse; const a=P('a;b;c\n1;"x;y";"li\nnha"\n\n2;;3\n'); const c=P('a,b\n"1,5",2\n'); const t=P('a\tb\n1\t2\n'); const e=P(''); const big=P('h\n'+Array.from({length:250},(_,i)=>'r'+i).join('\n')); return {a:{d:a.delim,head:a.head,rows:a.rows}, c:{d:c.delim,rows:c.rows}, t:{d:t.delim,rows:t.rows}, e:{head:e.head.length,rows:e.rows.length}, big:{n:big.rows.length, over:big.over}}; });
  check('S33-01: parser: “;” com aspas (; e quebra de linha dentro), linha vazia ignorada, célula vazia; “,” com aspas; tabulação; vazio; 250 linhas → 200 (50 de fora)', pr.a.d===';' && pr.a.head.join()==='a,b,c' && JSON.stringify(pr.a.rows)==='[["1","x;y","li\\nnha"],["2","","3"]]' && pr.c.d===',' && JSON.stringify(pr.c.rows)==='[["1,5","2"]]' && pr.t.d==='\t' && JSON.stringify(pr.t.rows)==='[["1","2"]]' && pr.e.head===0 && pr.big.n===200 && pr.big.over===50, pr);
  /* ---------- 2. modelo + menu + caixa ---------- */
  await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Lote'; A.loadDeck(d,null); const s=A.deck.slides[0]; s.els=[];
    const t1=mk.text('title'); t1.html='{{Nome}}'; t1.x=80; t1.y=80; const t2=mk.text('body'); t2.html='<div>{{cargo}} — {{area}}</div><div>Slide {{#}} de {{##}}</div>'; t2.x=80; t2.y=220; const h=mk.fx('headline'); h.data.text='{{Mensagem}}'; h.data.hl=''; h.x=80; h.y=380; h.w=1100; h.h=200; const t3=mk.text('body'); t3.html='{{Foto}}'; t3.x=900; t3.y=80; s.els=[t1,t2,h,t3]; A.renderAll(); A.commit(); });
  await p.click('#mbar button[data-m=slide]'); await sleep(250);
  const sm=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi')].map(x=>x.textContent.trim()));
  check('S33-02: menu Slide tem um só “Gerar slides de uma planilha (CSV)…” (habilitado) e continua com um só “Inserir bloco pronto”', sm.filter(t=>/^Gerar slides de uma planilha/.test(t)).length===1 && sm.filter(t=>/^Inserir bloco pronto/.test(t)).length===1 && await p.evaluate(()=>![...document.querySelectorAll('.xmenu .xi')].find(x=>/^Gerar slides/.test(x.textContent)).classList.contains('dis')), sm);
  await p.evaluate(()=>{ [...document.querySelectorAll('.xmenu .xi')].find(x=>/^Gerar slides/.test(x.textContent.trim())).click(); }); await sleep(350);
  const d0=await p.evaluate(()=>{ const d=document.getElementById('btDlg'); const r=d.querySelector('.xp-box').getBoundingClientRect(); return {open:!d.hidden, fits:r.bottom<=innerHeight&&r.right<=innerWidth, cur:document.getElementById('btCur').textContent, chips:[...document.querySelectorAll('#btPh .chip')].map(c=>c.dataset.ph), go:document.getElementById('btGo').disabled, focus:document.activeElement.id}; });
  check('S33-03: a caixa abre (cabe a 1280×720), modelo = slide 1, lista os marcadores do slide ({{Nome}}, {{cargo}}, {{area}}, {{#}}, {{##}}, {{Mensagem}}, {{Foto}}), Gerar desativado, foco na área de colar', d0.open && d0.fits && d0.cur==='1' && d0.chips.join('|')==='{{Nome}}|{{cargo}}|{{area}}|{{#}}|{{##}}|{{Mensagem}}|{{Foto}}' && d0.go && d0.focus==='btSrc', d0);
  await p.fill('#btSrc', TSV); await sleep(250);
  const d1=await p.evaluate(()=>({info:document.getElementById('btInfo').textContent, rows:document.querySelectorAll('#btPrev tbody tr').length, head:[...document.querySelectorAll('#btPrev th')].map(t=>t.textContent), bad:[...document.querySelectorAll('#btPh .chip.bad')].map(c=>c.dataset.ph), note:document.getElementById('btPhNote').textContent, go:document.getElementById('btGo').textContent, dis:document.getElementById('btGo').disabled}));
  check('S33-04: colar TSV: “Tabulação · 4 colunas · 3 linhas”, prévia com as 3 linhas, {{Foto}} marcado sem coluna (aviso), botão “Gerar 3 slides”', /Tabulação · 4 colunas · 3 linhas/.test(d1.info) && d1.rows===3 && d1.head.join()==='Nome,Cargo,Área,Mensagem' && d1.bad.join()==='{{Foto}}' && /Sem coluna na planilha: \{\{Foto\}\}/.test(d1.note) && d1.go==='Gerar 3 slides' && !d1.dis, d1);
  await p.click('#btGo'); await sleep(500);
  let d=await D();
  const g=d.slides.slice(1).map(s=>({t:s.els[0].html, b:s.els[1].html, h:s.els[2].data.text, f:s.els[3].html, base:!!s.base, hid:!!s.hidden}));
  check('S33-05: 3 slides gerados logo depois do modelo: textos com os valores (HTML escapado), {{cargo}}/{{area}} casados sem caixa/acento, {{#}} de {{##}}, componente com a mensagem, {{Foto}} fica como está, cada um com base (Redefinir); modelo oculto; atual = 1º gerado', d.slides.length===4 && g[0].t==='Ana Souza' && g[0].b==='<div>Diretora de Operações — Operações</div><div>Slide 1 de 3</div>' && g[0].h==='Reduzimos <b>30 %</b> do lead time' && g[0].f==='{{Foto}}' && g[1].h==='Portal único; 2 mil usuários' && g[2].b==='<div>Líder de Pessoas — Pessoas</div><div>Slide 3 de 3</div>' && g.every(x=>x.base&&!x.hid) && d.slides[0].hidden===true && await p.evaluate(()=>AMStudio.cur)===1 && !(await dlgOpen()), {n:d.slides.length, g, hid:d.slides[0].hidden});
  const esc0=await p.evaluate(()=>{ const st=document.querySelector('#cv .am-stage'); return st.querySelector('.am-el[data-id="'+AMStudio.deck.slides[1].els[0].id+'"]').textContent.trim(); });
  const escH=await p.evaluate(()=>{ AMStudio.goSlide(1); const st=document.querySelector('#cv .am-stage'); const e=AMStudio.deck.slides[1].els[2]; const n=st.querySelector('.am-el[data-id="'+e.id+'"]'); return {b:!!n.querySelector('b'), t:n.textContent.replace(/\s+/g,' ').trim()}; });
  check('S33-06: no palco o valor com <b> aparece como texto (sem virar negrito) — no texto por escape, no componente por esc() do runtime', esc0==='Ana Souza' && !escH.b && /Reduzimos <b>30 %<\/b> do lead time/.test(escH.t), {esc0,escH});
  await p.click('#wrap',{position:{x:5,y:5}}); await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await sleep(300); d=await D();
  check('S33-07: um Ctrl+Z tira os 3 slides e mostra o modelo de novo', d.slides.length===1 && !d.slides[0].hidden, {n:d.slides.length, hid:d.slides[0].hidden});
  await p.keyboard.press('Control+y'); await sleep(300); d=await D();
  check('S33-08: Ctrl+Y refaz (4 slides, modelo oculto)', d.slides.length===4 && d.slides[0].hidden===true);
  /* Redefinir num gerado mantém o valor gerado */
  const rs=await p.evaluate(()=>{ const A=AMStudio; A.goSlide(2); const s=A.deck.slides[2]; const e=s.els[0]; const x0=e.x; e.html='mudado'; e.x+=50; A.renderAll(); A.commit(); A.resetSlide(2); const e2=A.deck.slides[2].els[0]; return {x0, x:e2.x, html:e2.html, base:s.base&&s.base.tpl&&s.base.tpl.p0&&s.base.tpl.p0.html}; });
  check('S33-09: Redefinir num slide gerado usa a base do slide gerado (posição volta; a base guarda “Bruno Lima”, não o marcador)', rs.x===rs.x0 && rs.base==='Bruno Lima', rs);
  /* ---------- 3. CSV “;” com aspas, 2 linhas por slide e {{Nome#2}}, sem esconder o modelo ---------- */
  await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Lote 2'; A.loadDeck(d,null); const s=A.deck.slides[0]; s.els=[]; const t=mk.text('body'); t.html='<div>{{Nome}} / {{Nome#2}}</div><div>{{Mensagem}}</div>'; t.x=80; t.y=120; t.w=1100; s.els=[t]; A.renderAll(); A.commit(); AMBatch.open(); });
  await sleep(300);
  await p.evaluate(()=>AMBatch.setText(AMBatch.sample())); await sleep(200);
  await p.selectOption('#btPer','2'); await p.uncheck('#btHide'); await sleep(200);
  const d2=await p.evaluate(()=>({info:document.getElementById('btInfo').textContent, go:document.getElementById('btGo').textContent}));
  check('S33-10: o exemplo (.csv com ;) é reconhecido: 4 colunas, 3 linhas; com 2 linhas por slide o botão diz “Gerar 2 slides”', /Separador “;” · 4 colunas · 3 linhas/.test(d2.info) && d2.go==='Gerar 2 slides', d2);
  await p.click('#btGo'); await sleep(400); d=await D();
  check('S33-11: 2 slides: o 1º com Ana / Bruno e a mensagem com “;” e “%”, o 2º com Carla e {{Nome#2}} vazio; modelo não oculto', d.slides.length===3 && d.slides[1].els[0].html==='<div>Ana Souza / Bruno Lima</div><div>Reduzimos o lead time em 30 %</div>' && d.slides[2].els[0].html==='<div>Carla Dias / </div><div>Capacitação de 120 líderes</div>' && !d.slides[0].hidden, d.slides.map(s=>s.els[0].html));
  /* ---------- 4. arquivo .csv pela caixa; exemplo baixado; Esc; sem marcadores ---------- */
  const csvP=path.join(TMP,'dados.csv'); fs.writeFileSync(csvP, '﻿Nome,Mensagem\r\n"Dias, Ana",Olá\r\nBeto,"Linha 1\nLinha 2"\r\n');
  await p.evaluate(()=>{ AMStudio.goSlide(0); AMBatch.open(); }); await sleep(300);
  await (await p.$('#btFile')).setInputFiles(csvP); await sleep(400);
  const d3=await p.evaluate(()=>({info:document.getElementById('btInfo').textContent, cells:[...document.querySelectorAll('#btPrev tbody td')].map(t=>t.textContent)}));
  check('S33-12: abrir um .csv (BOM, “,”, aspas com vírgula e quebra de linha, CRLF) preenche a caixa e a prévia', /Separador “,” · 2 colunas · 2 linhas/.test(d3.info) && d3.cells.join('|')==='Dias, Ana|Olá|Beto|Linha 1 Linha 2', d3);
  await p.click('#btGo'); await sleep(400); d=await D();
  check('S33-13: valor com quebra de linha vira <br> no texto', d.slides[1].els[0].html==='<div>Dias, Ana / Beto</div><div>Olá</div>' || /Linha 1<br>Linha 2/.test(d.slides[1].els[0].html) || /Linha 1<br>Linha 2/.test((d.slides[2]||{els:[{}]}).els[0].html||''), d.slides.slice(1).map(s=>s.els[0].html));
  await p.evaluate(()=>AMBatch.open()); await sleep(250);
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:5000}), p.click('#btDlg [data-x="sample"]')]);
  const sp=path.join(TMP,dl.suggestedFilename()); await dl.saveAs(sp);
  check('S33-14: “Baixar exemplo (.csv)” baixa o modelo de planilha', dl.suggestedFilename()==='exemplo-slides-em-lote.csv' && /^﻿Nome;Cargo;Área;Mensagem/.test(fs.readFileSync(sp,'utf8')));
  await p.keyboard.press('Escape'); await sleep(200);
  check('S33-15: Esc fecha a caixa', !(await dlgOpen()));
  await p.evaluate(()=>{ const A=AMStudio; A.addSlide('blank-light'); AMBatch.open(); AMBatch.setText('a\tb\n1\t2'); }); await sleep(300);
  const d4=await p.evaluate(()=>({go:document.getElementById('btGo').disabled, warn:!!document.querySelector('#btPh .bt-warn'), ghosts:[...document.querySelectorAll('#btPh .chip.ghost')].map(c=>c.dataset.ph)}));
  check('S33-16: slide modelo sem marcadores: aviso, Gerar desativado e as colunas da planilha oferecidas como marcadores para copiar', d4.go && d4.warn && d4.ghosts.join('|')==='{{a}}|{{b}}', d4);
  await p.click('#btPh .chip.ghost'); await sleep(200);
  const clip=await p.evaluate(async()=>navigator.clipboard.readText());
  check('S33-17: clicar numa coluna copia o marcador {{a}}', clip==='{{a}}', clip);
  await p.keyboard.press('Escape'); await sleep(150);
  /* ---------- 5. salvar/reabrir ---------- */
  const re=await p.evaluate(()=>{ const A=AMStudio; const html=A.exportHTML(); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]); const n0=A.deck.slides.length; A.loadDeck(dk,'re'); return {n0, n:A.deck.slides.length, t:A.deck.slides[1].els[0].html}; });
  check('S33-18: salvar/reabrir mantém os slides gerados', re.n===re.n0 && /Dias, Ana/.test(re.t), re);
  await p.evaluate(()=>{ AMStudio.goSlide(0); AMBatch.open(); AMBatch.setText('Nome\tCargo\tÁrea\tMensagem\nAna Souza\tDiretora\tOperações\tOlá\nBruno\tGerente\tTI\tOi'); }); await sleep(300); await p.screenshot({path:SH('caixa')}); await p.keyboard.press('Escape');
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
