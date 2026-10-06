/* S15 — linha do tempo de seções (rail), índice (G) e “Sobre este slide” (I): editor (campos do slide), player e arquivo exportado.
   Uso: python3 assemble.py && node test-s15-nav.js  (o qa-gate.sh roda todo test-s[0-9][0-9]*.js; decide pelo código de saída) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=n=>path.join(SHOTS,'s15-'+n+'.png');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(wait||800); return p; }
/* deck de teste (TMG-FEATURES §11): 2 de abertura, 1 divisor (layout section), 3 slides, 3 com sec "Benchmarks", 2 com sec "Plano" = 11 slides, 4 capítulos */
const BUILD=`(function(){ var M=AMStudio.mk, d=AMStudio.newDeck? null:null; var sl=[];
  function t(txt,extra){ var s=M.slide('blank-light'); s.els=[M.text('title',Object.assign({x:80,y:80,w:1100,h:90,html:txt,size:40},{}))]; if(extra) Object.assign(s,extra); return s; }
  sl.push(t('Abertura da leitura')); sl.push(t('Resumo executivo'));
  var dv=M.slide('section'); sl.push(dv);
  sl.push(t('Visão única')); sl.push(t('Termômetro cultural',{notes:'Texto escrito no editor.\\nSegunda linha.'})); sl.push(t('Liderança'));
  sl.push(t('Bayer',{sec:'Benchmarks'})); sl.push(t('Cargill')); sl.push(t('Unilever'));
  sl.push(t('Caminhos',{sec:'Plano'})); sl.push(t('Proposta de trabalho'));
  return {v:1,app:'AM Studio',id:'s15test01',title:'S15 teste',slides:sl}; })()`;
const RAIL=()=>({n:document.querySelectorAll('.amp-rail .amp-rs').length, labels:[...document.querySelectorAll('.amp-rail .amp-rs-l')].map(l=>l.textContent), fills:[...document.querySelectorAll('.amp-rail .amp-rs b')].map(b=>b.style.width), on:[...document.querySelectorAll('.amp-rail .amp-rs')].map(b=>b.classList.contains('on')), pos:document.querySelector('.amp-pos').textContent, railH:getComputedStyle(document.querySelector('.amp')).getPropertyValue('--amp-rail-h').trim()});
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  /* ---------- 1. editor: campos do slide ---------- */
  const ok=await p.evaluate(B=>AMStudio.loadDeck(eval(B),'teste'), BUILD); await sleep(400);
  const e1=await p.evaluate(()=>({n:AMStudio.deck.slides.length, kind:AMStudio.deck.slides[2].kind, secs:AMRT.sectionsOf(AMStudio.deck).list.map(s=>[s.name,s.num,s.idx.join(',')])}));
  check('S15-01: deck de 11 slides com 4 capítulos (Abertura, divisor kind=section, Benchmarks, Plano)', ok&&e1.n===11&&e1.kind==='section'&&e1.secs.length===4&&e1.secs[0][0]==='Abertura'&&e1.secs[1][0]==='Nome do capítulo'&&e1.secs[1][2]==='2,3,4,5'&&e1.secs[2][0]==='Benchmarks'&&e1.secs[2][1]===2&&e1.secs[3][0]==='Plano', e1);
  const e2=await p.evaluate(()=>({t:!!document.querySelector('#props [data-p="s.title"]'), s:!!document.querySelector('#props [data-p="s.sec"]'), n:!!document.querySelector('#props textarea[data-p="s.notes"]'), a:!!document.querySelector('#props [data-act=autonotes]'), v:!!document.querySelector('#props [data-act=viewnotes]'), ph:document.querySelector('#props [data-p="s.title"]').placeholder}));
  check('S15-02: painel do slide tem Título no índice, Capítulo, Resumo, Gerar automaticamente e Ver na apresentação', e2.t&&e2.s&&e2.n&&e2.a&&e2.v&&e2.ph==='Abertura da leitura', e2);
  await p.click('#props [data-act=autonotes]'); await sleep(250);
  const e3=await p.evaluate(()=>({ta:document.querySelector('#props textarea[data-p="s.notes"]').value, m:AMStudio.deck.slides[0].notes}));
  check('S15-03: Gerar automaticamente preenche o resumo (título + posição), sem frases de orientação ao apresentador', /^Abertura da leitura\./.test(e3.ta)&&e3.m===e3.ta&&/slide 1 de 11/.test(e3.m)&&!/Conduza|Antecipe|apresente o objetivo|Fechamento:/.test(e3.m), e3);
  await p.fill('#props textarea[data-p="s.notes"]', 'Resumo digitado no editor'); await p.fill('#props [data-p="s.sec"]', 'Contexto'); await p.fill('#props [data-p="s.title"]', 'Capa da leitura');
  await p.evaluate(()=>document.querySelector('#props [data-p="s.title"]').blur()); await sleep(200);
  const e4=await p.evaluate(()=>{ const s=AMStudio.deck.slides[0]; return {notes:s.notes, sec:s.sec, title:s.title, secs:AMRT.sectionsOf(AMStudio.deck).list.map(x=>x.name), els:s.els.length}; });
  check('S15-04: digitar nos campos grava notes/sec/title no slide; Abertura vira capítulo “Contexto”', e4.notes==='Resumo digitado no editor'&&e4.sec==='Contexto'&&e4.title==='Capa da leitura'&&e4.secs[0]==='Contexto'&&e4.els===1, e4);
  await p.fill('#props [data-p="s.sec"]', ''); await p.evaluate(()=>document.querySelector('#props [data-p="s.sec"]').blur()); await sleep(150);
  const e5=await p.evaluate(()=>('sec' in AMStudio.deck.slides[0]));
  check('S15-05: campo vazio remove a chave do slide', e5===false, e5);
  await p.keyboard.press('Control+z'); await sleep(150); await p.keyboard.press('Control+z'); await sleep(150);
  const e6=await p.evaluate(()=>({sec:AMStudio.deck.slides[0].sec, title:AMStudio.deck.slides[0].title}));
  check('S15-06: Ctrl+Z desfaz os campos do slide (2 passos: capítulo limpo, depois título)', e6.sec==='Contexto'&&e6.title===undefined, e6);
  await p.keyboard.press('Control+Shift+z'); await sleep(150); await p.keyboard.press('Control+Shift+z'); await sleep(150);
  /* reabrir: safeSlide mantém os campos */
  const rt=await p.evaluate(()=>{ const d=JSON.parse(JSON.stringify(AMStudio.deck)); AMStudio.loadDeck(d,'reaberto'); const s=AMStudio.deck.slides; return {n0:s[0].notes, n4:s[4].notes, k:s[2].kind, s6:s[6].sec, s9:s[9].sec}; });
  check('S15-07: reabrir mantém notes, sec e kind (allow-list do safeSlide)', rt.n0==='Resumo digitado no editor'&&rt.n4==='Texto escrito no editor.\nSegunda linha.'&&rt.k==='section'&&rt.s6==='Benchmarks'&&rt.s9==='Plano', rt);
  /* o redo acima deixou o capítulo do slide 1 vazio de novo: nomeia “Contexto” para ver o nome no rail e no índice */
  await p.fill('#props [data-p="s.sec"]', 'Contexto'); await p.evaluate(()=>document.querySelector('#props [data-p="s.sec"]').blur()); await sleep(200);
  await p.screenshot({path:SH('01-editor-panel')});
  /* ---------- 2. player no editor: rail ---------- */
  await p.keyboard.press('F5'); await sleep(900);
  const r1=await p.evaluate(RAIL);
  check('S15-08: F5 abre o player com rail de 4 segmentos (Contexto primeiro), slide 1 = 50% no primeiro, rail-h 30px', r1.n===4&&r1.labels[0]==='Contexto'&&r1.fills[0]==='50%'&&r1.fills[1]==='0%'&&r1.on[0]&&!r1.on[1]&&/^01/.test(r1.pos)&&r1.railH==='30px', r1);
  await p.keyboard.press('ArrowRight'); await sleep(250); await p.keyboard.press('ArrowRight'); await sleep(250);
  const r2=await p.evaluate(RAIL);
  check('S15-09: no divisor (slide 3): 100%, 25%, 0, 0 e segmento 2 ativo', r2.fills.join()==='100%,25%,0%,0%'&&r2.on[1]&&/^03/.test(r2.pos), r2);
  await p.keyboard.press('ArrowRight'); await sleep(250);
  const r3=await p.evaluate(RAIL);
  check('S15-10: slide 4: 100%, 50%, 0, 0', r3.fills.join()==='100%,50%,0%,0%', r3);
  await p.click('.amp-rail .amp-rs:nth-child(3)'); await sleep(400);
  const r4=await p.evaluate(RAIL);
  check('S15-11: clicar no 3º segmento vai ao slide 7 (primeiro de Benchmarks)', /^07/.test(r4.pos)&&r4.on[2]&&r4.fills.join()==='100%,100%,34%,0%'||(/^07/.test(r4.pos)&&r4.on[2]&&/^33\.3/.test(r4.fills[2])), r4);
  await p.click('.amp-rail .amp-rs:nth-child(1)'); await sleep(400);
  const r5=await p.evaluate(()=>document.querySelector('.amp-pos').textContent);
  check('S15-12: clicar no 1º segmento volta ao slide 1', /^01/.test(r5), r5);
  await p.screenshot({path:SH('02-player-rail')});
  /* ---------- 3. índice (G) ---------- */
  await p.keyboard.press('g'); await sleep(350);
  const i1=await p.evaluate(()=>({on:document.querySelector('.amp-idx').classList.contains('on'), exp:document.querySelector('.amp-pos').getAttribute('aria-expanded'), cur:document.activeElement&&document.activeElement.getAttribute('aria-current'), fi:document.activeElement&&document.activeElement.dataset.i, groups:[...document.querySelectorAll('.amp-idx-g')].map(g=>g.textContent), items:document.querySelectorAll('.amp-idx-i').length, head:document.querySelector('.amp-idx .amp-pop-h span').textContent, t0:document.querySelector('.amp-idx-i[data-i="0"] span').textContent, nums:AMRT.sectionsOf(AMStudio.deck).list.map(s=>s.num).join()}));
  check('S15-13: G abre o índice com foco no item atual; grupos Contexto / Parte 1 · Nome do capítulo / Parte 2 · Benchmarks / Parte 3 · Plano; título explícito do slide 1', i1.on&&i1.exp==='true'&&i1.cur==='page'&&i1.fi==='0'&&i1.items===11&&i1.groups.join('|')==='Contexto|Parte 1 · Nome do capítulo|Parte 2 · Benchmarks|Parte 3 · Plano'&&i1.nums==='0,1,2,3'&&i1.head==='Índice · 11 slides'&&i1.t0==='Capa da leitura', i1);
  await p.screenshot({path:SH('03-player-index')});
  await p.keyboard.press('ArrowDown'); await sleep(100); await p.keyboard.press('Enter'); await sleep(400);
  const i2=await p.evaluate(()=>({on:document.querySelector('.amp-idx').classList.contains('on'), pos:document.querySelector('.amp-pos').textContent}));
  check('S15-14: ↓ e Enter vão ao slide 2 e fecham o índice', !i2.on&&/^02/.test(i2.pos), i2);
  await p.keyboard.press('g'); await sleep(300); await p.keyboard.press('ArrowRight'); await sleep(300);
  const i3=await p.evaluate(()=>({on:document.querySelector('.amp-idx').classList.contains('on'), cur:document.querySelector('.amp-idx-i[aria-current=page]').dataset.i, pos:document.querySelector('.amp-pos').textContent}));
  check('S15-15: com o índice aberto, → navega e o destaque acompanha (slide 3)', i3.on&&i3.cur==='2'&&/^03/.test(i3.pos), i3);
  await p.keyboard.press('Escape'); await sleep(250);
  const i4=await p.evaluate(()=>({on:document.querySelector('.amp-idx').classList.contains('on'), focus:document.activeElement&&document.activeElement.className, pres:document.querySelector('#presenter').classList.contains('open')}));
  await p.focus('.amp-pos'); await p.keyboard.press('Enter'); await sleep(300);
  const i4b=await p.evaluate(()=>document.querySelector('.amp-idx').classList.contains('on'));
  await p.keyboard.press('Escape'); await sleep(250);
  const i4c=await p.evaluate(()=>({on:document.querySelector('.amp-idx').classList.contains('on'), focus:document.activeElement&&document.activeElement.className}));
  check('S15-16: Esc fecha só o índice (player continua aberto); aberto por G o foco não fica no contador; aberto pelo teclado no contador (Tab+Enter) o foco volta a ele', !i4.on&&i4.pres&&!/amp-pos/.test(i4.focus)&&i4b&&!i4c.on&&/amp-pos/.test(i4c.focus), [i4,i4b,i4c]);
  await p.evaluate(()=>document.activeElement.blur());
  await p.click('.amp-pos'); await sleep(300);
  const i5=await p.evaluate(()=>document.querySelector('.amp-idx').classList.contains('on'));
  await p.click('.amp-idx-i[data-i="10"]'); await sleep(400);
  const i6=await p.evaluate(()=>({on:document.querySelector('.amp-idx').classList.contains('on'), pos:document.querySelector('.amp-pos').textContent, fills:[...document.querySelectorAll('.amp-rail .amp-rs b')].map(b=>b.style.width)}));
  check('S15-17: clique no contador abre; clique no item 11 vai ao último slide e fecha; rail 100% em todos', i5&&!i6.on&&/^11/.test(i6.pos)&&i6.fills.join()==='100%,100%,100%,100%', [i5,i6]);
  /* ---------- 4. Sobre este slide (I) ---------- */
  await p.keyboard.press('Home'); await sleep(300);
  await p.keyboard.press('g'); await sleep(200); await p.keyboard.press('i'); await sleep(350);
  const n1=await p.evaluate(()=>({idx:document.querySelector('.amp-idx').classList.contains('on'), on:document.querySelector('.amp-note').classList.contains('on'), exp:document.querySelector('[data-a=notes]').getAttribute('aria-expanded'), t:document.querySelector('.amp-note-t').textContent, b:document.querySelector('.amp-note-b').textContent, tag:document.querySelector('.amp-note-tag').hidden, btn:document.querySelector('.amp-c [data-a=notes]')===document.querySelector('.amp-c').firstElementChild}));
  check('S15-18: I abre “Sobre este slide” (fecha o índice); slide 1 mostra o resumo escrito no editor, sem a tag automático; botão é o primeiro do grupo central', !n1.idx&&n1.on&&n1.exp==='true'&&n1.t==='Capa da leitura'&&n1.b==='Resumo digitado no editor'&&n1.tag===true&&n1.btn, n1);
  await p.screenshot({path:SH('04-player-notes')});
  await p.keyboard.press('ArrowRight'); await sleep(300);
  const n2=await p.evaluate(()=>({on:document.querySelector('.amp-note').classList.contains('on'), t:document.querySelector('.amp-note-t').textContent, b:document.querySelector('.amp-note-b').textContent, tag:document.querySelector('.amp-note-tag').hidden}));
  check('S15-19: o painel acompanha a navegação: slide 2 sem notas mostra resumo automático com a tag', n2.on&&n2.t==='Resumo executivo'&&/^Resumo executivo\./.test(n2.b)&&n2.tag===false, n2);
  await p.keyboard.press('Escape'); await sleep(250);
  const n3=await p.evaluate(()=>({on:document.querySelector('.amp-note').classList.contains('on'), pres:document.querySelector('#presenter').classList.contains('open')}));
  await p.keyboard.press('Escape'); await sleep(400);
  const n4=await p.evaluate(()=>document.querySelector('#presenter').classList.contains('open'));
  check('S15-20: Esc fecha o resumo; o Esc seguinte sai da apresentação (invariante do test-core)', !n3.on&&n3.pres&&!n4, [n3,n4]);
  /* Ver na apresentação abre o player já com o resumo */
  await p.click('#props [data-act=viewnotes]'); await sleep(900);
  const n5=await p.evaluate(()=>({pres:document.querySelector('#presenter').classList.contains('open'), on:document.querySelector('.amp-note').classList.contains('on'), pos:document.querySelector('.amp-pos').textContent}));
  check('S15-21: “Ver na apresentação” abre o player no slide atual com o resumo aberto', n5.pres&&n5.on&&/^01/.test(n5.pos), n5);
  await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Escape'); await sleep(300);
  /* abrir o player de novo: hooks não acumulam (um só painel responde) */
  await p.keyboard.press('F5'); await sleep(800);
  const h1=await p.evaluate(()=>({keys:AMRT.hooks.key.length, shows:AMRT.hooks.show.length, panels:document.querySelectorAll('.amp-note').length}));
  check('S15-22: reabrir o player não acumula hooks nem painéis', h1.keys===1&&h1.shows===1&&h1.panels===1, h1);
  await p.keyboard.press('Escape'); await sleep(300);
  const h2=await p.evaluate(()=>({keys:AMRT.hooks.key.length, shows:AMRT.hooks.show.length}));
  check('S15-23: destroy remove os hooks', h2.keys===0&&h2.shows===0, h2);
  /* ---------- 5. arquivo exportado ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(__dirname,'saved-s15.html'); fs.writeFileSync(f,html);
  check('S15-24: export sem on* (CR-04) e sem </script fora do JSON', !/onerror|onmouseover|onclick/i.test(html));
  const q=await open(ctx,'file://'+f,'exp',1200);
  const x1=await q.evaluate(RAIL);
  const x1b=await q.evaluate(()=>({notes:!!document.querySelector('[data-a=notes]'), idx:!!document.querySelector('.amp-idx'), deckW:document.querySelector('.amp-deck').getBoundingClientRect().width, viewH:document.querySelector('.amp-view').getBoundingClientRect().height, slides:document.querySelectorAll('.amp-slide').length}));
  check('S15-25: arquivo exportado abre com rail (4), botão Sobre este slide e índice; 11 slides; palco cabe acima do rail', x1.n===4&&x1.fills[0]==='50%'&&x1b.notes&&x1b.idx&&x1b.slides===11&&x1b.deckW<=x1b.viewH*16/9+1, [x1,x1b]);
  await q.keyboard.press('ArrowRight'); await sleep(300); await q.keyboard.press('i'); await sleep(350);
  const x2=await q.evaluate(()=>({on:document.querySelector('.amp-note').classList.contains('on'), tag:document.querySelector('.amp-note-tag').hidden, b:document.querySelector('.amp-note-b').textContent}));
  check('S15-26: no arquivo, slide 2 mostra resumo automático', x2.on&&x2.tag===false&&/^Resumo executivo\./.test(x2.b), x2);
  await q.click('.amp-note-ed'); await sleep(200);
  const x3=await q.evaluate(()=>({ce:document.querySelector('.amp-note-b').getAttribute('contenteditable'), focus:document.activeElement===document.querySelector('.amp-note-b'), lab:document.querySelector('.amp-note-ed').textContent}));
  await q.keyboard.press('Control+a'); await q.keyboard.type('Nota do apresentador i g'); await q.keyboard.press('Space'); await q.keyboard.type('ok'); await sleep(150);
  const x4=await q.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent, on:document.querySelector('.amp-note').classList.contains('on'), idx:document.querySelector('.amp-idx').classList.contains('on')}));
  check('S15-27: Editar deixa o corpo editável com foco; digitar “i”, “g” e Espaço não navega nem alterna painéis', /plaintext-only|true/.test(x3.ce)&&x3.focus&&x3.lab==='Salvar'&&/^02/.test(x4.pos)&&x4.on&&!x4.idx, [x3,x4]);
  await q.keyboard.press('Control+Enter'); await sleep(250);
  const x5=await q.evaluate(()=>({ce:document.querySelector('.amp-note-b').hasAttribute('contenteditable'), b:document.querySelector('.amp-note-b').textContent, tag:document.querySelector('.amp-note-tag').hidden, rs:document.querySelector('.amp-note-rs').hidden, ls:localStorage.getItem('amPlayer.notes:s15test01')}));
  check('S15-28: Ctrl+Enter salva: texto novo, tag escondida, “Restaurar original” visível, localStorage gravado', !x5.ce&&x5.b==='Nota do apresentador i g ok'&&x5.tag===true&&x5.rs===false&&/Nota do apresentador/.test(x5.ls||''), x5);
  await q.reload(); await sleep(1200); /* o arquivo reabre no slide da URL (#/2): Home e → deixam o teste determinístico */
  await q.keyboard.press('Home'); await sleep(250); await q.keyboard.press('ArrowRight'); await sleep(300); await q.keyboard.press('i'); await sleep(350);
  const x6=await q.evaluate(()=>({b:document.querySelector('.amp-note-b').textContent, rs:document.querySelector('.amp-note-rs').hidden}));
  check('S15-29: a nota editada persiste após recarregar', x6.b==='Nota do apresentador i g ok'&&x6.rs===false, x6);
  await q.click('.amp-note-rs'); await sleep(250);
  const x7=await q.evaluate(()=>({b:document.querySelector('.amp-note-b').textContent, tag:document.querySelector('.amp-note-tag').hidden, ls:localStorage.getItem('amPlayer.notes:s15test01')}));
  check('S15-30: Restaurar original volta ao automático e limpa o localStorage', /^Resumo executivo\./.test(x7.b)&&x7.tag===false&&x7.ls===null, x7);
  await q.keyboard.press('Escape'); await sleep(200);
  await q.keyboard.press('g'); await sleep(300); await q.keyboard.press('End'); await sleep(100);
  const x8=await q.evaluate(()=>({fi:document.activeElement&&document.activeElement.dataset.i}));
  await q.keyboard.press('Home'); await sleep(100);
  const x9=await q.evaluate(()=>({fi:document.activeElement&&document.activeElement.dataset.i}));
  await q.mouse.click(700, 200); await sleep(300);
  const x10=await q.evaluate(()=>({on:document.querySelector('.amp-idx').classList.contains('on'), pos:document.querySelector('.amp-pos').textContent}));
  check('S15-31: End/Home movem o foco no índice; clique fora fecha sem navegar', x8.fi==='10'&&x9.fi==='0'&&!x10.on&&/^02/.test(x10.pos), [x8,x9,x10]);
  await q.screenshot({path:SH('05-export')});
  /* celular: sem transbordamento horizontal; rótulos do rail escondidos */
  await q.setViewportSize({width:390,height:844}); await sleep(400);
  const m1=await q.evaluate(()=>({sw:document.documentElement.scrollWidth, iw:innerWidth, lab:getComputedStyle(document.querySelector('.amp-rs-l')).display, railH:getComputedStyle(document.querySelector('.amp')).getPropertyValue('--amp-rail-h').trim(), barW:document.querySelector('.amp-bar').scrollWidth, barC:document.querySelector('.amp-bar').clientWidth}));
  check('S15-32: 390 px: sem rolagem horizontal, rótulos do rail escondidos, rail 16px, barra não transborda', m1.sw===m1.iw&&m1.lab==='none'&&m1.railH==='16px'&&m1.barW<=m1.barC, m1);
  await q.screenshot({path:SH('06-export-390')});
  await q.setViewportSize({width:1024,height:768}); await sleep(300);
  const m2=await q.evaluate(()=>[...document.querySelectorAll('.amp-rs')].map(b=>getComputedStyle(b.querySelector('.amp-rs-l')).opacity));
  check('S15-33: 1024 px: os nomes de todos os capítulos continuam visíveis no rail (só segmentos estreitos escondem o nome)', m2.length===4&&m2.every(o=>o==='1'), m2);
  await q.emulateMedia({media:'print'}); await sleep(100);
  const m3=await q.evaluate(()=>({rail:getComputedStyle(document.querySelector('.amp-rail')).display, pop:getComputedStyle(document.querySelector('.amp-idx')).display}));
  check('S15-34: impressão esconde rail e popovers', m3.rail==='none'&&m3.pop==='none', m3);
  await q.emulateMedia({media:'screen'});
  await q.close();
  /* ---------- 6. deck sem capítulos: player igual ao de antes (sem rail), índice plano ---------- */
  await p.evaluate(()=>{ AMStudio.resetDeck(); }); await sleep(300);
  await p.keyboard.press('F5'); await sleep(700);
  const z1=await p.evaluate(()=>({rail:!!document.querySelector('.amp-rail'), has:document.querySelector('.amp').classList.contains('has-rail'), groups:document.querySelectorAll('.amp-idx-g').length, items:document.querySelectorAll('.amp-idx-i').length, deckW:Math.round(document.querySelector('.amp-deck').getBoundingClientRect().width), viewH:Math.round(document.querySelector('.amp-view').getBoundingClientRect().height)}));
  check('S15-35: sem capítulos não há rail; índice plano (sem grupos); palco usa toda a altura', !z1.rail&&!z1.has&&z1.groups===0&&z1.items===1&&Math.abs(z1.deckW-Math.min(1440,z1.viewH*16/9))<=2, z1);
  await p.keyboard.press('Escape'); await sleep(300);

  /* ---------- 7. achados da revisão adversarial (cada um reproduzido antes da correção) ---------- */
  await p.evaluate(B=>AMStudio.loadDeck(eval(B),'teste'), BUILD); await sleep(300);
  await p.evaluate(()=>{ try{ localStorage.removeItem('amPlayer.notes:s15test01'); }catch(e){} });
  await p.keyboard.press('F5'); await sleep(800);
  const POS=()=>document.querySelector('.amp-pos').textContent;
  check('S15-36: contador = “01 / 11” (seta ▾ só no CSS)', await p.evaluate(POS)==='01 / 11', await p.evaluate(POS));
  await p.keyboard.press('g'); await sleep(250); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(300);
  await p.keyboard.press('Space'); await sleep(300); const sp1=await p.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent, idx:document.querySelector('.amp-idx').classList.contains('on')}));
  await p.keyboard.press('g'); await sleep(250); await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Space'); await sleep(300); const sp2=await p.evaluate(POS);
  await p.keyboard.press('i'); await sleep(250); await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Space'); await sleep(300); const sp3=await p.evaluate(POS);
  await p.click('.amp-pos'); await sleep(250); await p.click('.amp-idx-i[data-i="6"]'); await sleep(300); await p.keyboard.press('Space'); await sleep(300); const sp4=await p.evaluate(POS);
  check('S15-37: Espaço continua avançando depois de G→↓→Enter, G→Esc, I→Esc e clique no índice (o foco não fica preso no contador)', /^03/.test(sp1.pos)&&!sp1.idx&&/^04/.test(sp2)&&/^05/.test(sp3)&&/^08/.test(sp4), [sp1,sp2,sp3,sp4]);
  await p.keyboard.press('g'); await sleep(250); for(let k=0;k<15;k++) await p.keyboard.press('Tab'); await sleep(100);
  const tb=await p.evaluate(()=>({inIdx:document.querySelector('.amp-idx').contains(document.activeElement), on:document.querySelector('.amp-idx').classList.contains('on')}));
  await p.click('.amp-idx .amp-pop-h span'); await sleep(150);
  const hd0=await p.evaluate(()=>document.querySelector('.amp-idx').contains(document.activeElement));
  await p.evaluate(()=>document.activeElement.blur()); await p.keyboard.press('Enter'); await sleep(250);
  const hdr=await p.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent, on:document.querySelector('.amp-idx').classList.contains('on'), inIdx:document.querySelector('.amp-idx').contains(document.activeElement), cur:document.activeElement.getAttribute('aria-current')}));
  check('S15-38: com o índice aberto, Tab circula só dentro dele; clique no cabeçalho não tira o foco do item; com o foco fora dos itens, Enter/Espaço não mexem no slide de trás', tb.inIdx&&tb.on&&hd0&&/^08/.test(hdr.pos)&&hdr.on&&hdr.inIdx&&hdr.cur==='page', [tb,hd0,hdr]);
  await p.keyboard.press('Escape'); await sleep(200);
  /* edição no player presa ao slide em que começou */
  await p.keyboard.press('Home'); await sleep(250); await p.keyboard.press('ArrowRight'); await sleep(250);
  await p.keyboard.press('i'); await sleep(250); await p.click('.amp-note-ed'); await sleep(150);
  const hint=await p.evaluate(()=>({k:document.querySelector('.amp-note-k').textContent, tag:document.querySelector('.amp-note-tag').hidden}));
  await p.keyboard.press('Control+a'); await p.keyboard.type('NOTA DO SLIDE 2'); await p.click('[data-a=next]'); await sleep(350);
  const ed1=await p.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent, b:document.querySelector('.amp-note-b').textContent, ls:JSON.parse(localStorage.getItem('amPlayer.notes:s15test01')||'{}'), id2:AMStudio.deck.slides[1].id}));
  await p.click('[data-a=prev]'); await sleep(350);
  const ed2=await p.evaluate(()=>document.querySelector('.amp-note-b').textContent);
  check('S15-39: nota digitada no slide 2 e “Próximo” clicado sem salvar: fica no slide 2 (não no 3); durante a edição a dica diz “Ctrl+Enter … · Esc cancela” e a tag some', /^03/.test(ed1.pos)&&!/NOTA DO SLIDE 2/.test(ed1.b)&&Object.keys(ed1.ls).length===1&&ed1.ls['s:'+ed1.id2]&&ed1.ls['s:'+ed1.id2].t==='NOTA DO SLIDE 2'&&ed2==='NOTA DO SLIDE 2'&&/Esc cancela/.test(hint.k)&&hint.tag, [hint,ed1,ed2]);
  await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Escape'); await sleep(300);
  /* a edição antiga do player perde para um resumo novo escrito no editor */
  await p.evaluate(()=>AMStudio.goSlide(1)); await sleep(200);
  await p.fill('#props textarea[data-p="s.notes"]', 'Resumo novo escrito no editor'); await p.evaluate(()=>document.querySelector('#props textarea[data-p="s.notes"]').blur()); await sleep(200);
  await p.click('#props [data-act=viewnotes]'); await sleep(900);
  const ov=await p.evaluate(()=>({b:document.querySelector('.amp-note-b').textContent, rs:document.querySelector('.amp-note-rs').hidden, ls:localStorage.getItem('amPlayer.notes:s15test01')}));
  check('S15-40: resumo mudado no editor vence a edição antiga feita no player (a edição é descartada)', ov.b==='Resumo novo escrito no editor'&&ov.rs===true&&ov.ls===null, ov);
  await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Escape'); await sleep(300);
  /* painel do slide atualiza depois de sair do campo */
  await p.fill('#props [data-p="s.sec"]', 'Capítulo X'); await p.mouse.click(700, 860); await sleep(250);
  const hd1=await p.evaluate(()=>document.querySelector('#props .ph small').textContent);
  check('S15-41: depois de sair do campo Capítulo, o cabeçalho do painel mostra o capítulo do slide', /capítulo “Capítulo X”/.test(hd1), hd1);
  await p.keyboard.press('Control+z'); await sleep(200);
  /* dois present() seguidos: um player só, sem erro no Esc */
  const errsBefore=errs.length;
  await p.evaluate(()=>{ AMStudio.present(0); AMStudio.present(1); }); await sleep(600);
  const pt=await p.evaluate(()=>({keys:AMRT.hooks.key.length, shows:AMRT.hooks.show.length, amps:document.querySelectorAll('#presenter .amp').length, pos:document.querySelector('.amp-pos').textContent}));
  await p.keyboard.press('Escape'); await sleep(300);
  const pt2=await p.evaluate(()=>({pres:document.querySelector('#presenter').classList.contains('open'), keys:AMRT.hooks.key.length}));
  await p.keyboard.press('Escape'); await sleep(200);
  check('S15-42: present() chamado duas vezes deixa um único player; Esc sai sem erro e sem hooks órfãos', pt.keys===1&&pt.shows===1&&pt.amps===1&&/^02/.test(pt.pos)&&!pt2.pres&&pt2.keys===0&&errs.length===errsBefore, [pt,pt2,errs.slice(errsBefore)]);
  /* F5 com o cursor no Resumo do slide */
  await p.evaluate(()=>AMStudio.goSlide(0)); await sleep(200);
  await p.click('#props textarea[data-p="s.notes"]'); await p.keyboard.press('End'); await p.keyboard.press('F5'); await sleep(800);
  await p.keyboard.press('ArrowRight'); await sleep(300); const f5a=await p.evaluate(POS);
  await p.keyboard.press('Escape'); await sleep(300); const f5b=await p.evaluate(()=>document.querySelector('#presenter').classList.contains('open'));
  check('S15-43: F5 com o cursor no Resumo do slide: → avança e Esc sai', /^02/.test(f5a)&&!f5b, [f5a,f5b]);
  /* numeração de capítulos e divisores não renomeados; ids reservados/duplicados */
  const nm=await p.evaluate(()=>{ const M=AMStudio.mk, sl=[M.slide('cover')]; for(let k=0;k<3;k++){ sl.push(M.slide('section')); sl.push(M.slide('content')); }
    const two=JSON.parse(JSON.stringify(sl)); two[0].id='__proto__'; two[2].id=two[1].id;
    AMStudio.loadDeck({v:1,app:'AM Studio',id:'s15num',title:'num',slides:two},'x'); const d=AMStudio.deck, S=AMRT.sectionsOf(d);
    const ids=d.slides.map(s=>s.id); return {chap:S.list.map(c=>c.name+':'+c.num).join('|'), uniq:new Set(ids).size===ids.length, proto:ids.includes('__proto__')}; });
  check('S15-44: 3 divisores deixados como “1 · Nome do capítulo” viram 3 capítulos numerados 1, 2, 3; id “__proto__” e ids repetidos são trocados ao abrir', nm.chap==='Abertura:0|Nome do capítulo:1|Nome do capítulo:2|Nome do capítulo:3'&&nm.uniq&&!nm.proto, nm);
  /* desempenho: capítulos num deck grande (60 slides, 14 textos cada) */
  const pf=await p.evaluate(()=>{ const M=AMStudio.mk, sl=[]; for(let i=0;i<60;i++){ const s=M.slide(i%10===2?'section':'blank-light'); if(i%10!==2){ const e=[]; for(let k=0;k<14;k++) e.push(M.text('body',{x:80,y:40+k*44,w:900,h:36,html:'<b>Item '+k+'</b> texto do slide '+i,size:14})); s.els=e; } sl.push(s); }
    AMStudio.loadDeck({v:1,app:'AM Studio',id:'s15perf',title:'perf',slides:sl},'x'); const d=AMStudio.deck; let t=performance.now(); for(let k=0;k<20;k++) AMRT.sectionsOf(d); const sec=(performance.now()-t)/20;
    t=performance.now(); for(let k=0;k<10;k++) AMStudio.goSlide(k*5); const go=(performance.now()-t)/10; return {sec:+sec.toFixed(2), go:+go.toFixed(1), n:AMRT.sectionsOf(d).list.length}; });
  check('S15-45: 60 slides: sectionsOf ≤ 3 ms e trocar de slide no editor ≤ 40 ms', pf.sec<=3&&pf.go<=40&&pf.n===7, pf);
  /* barra do player em várias larguras: marca inteira, sem botão quebrando linha, sem transbordar */
  await p.evaluate(B=>AMStudio.loadDeck(eval(B),'teste'), BUILD); await sleep(300);
  const BAR=()=>{ const q=s=>document.querySelector(s), br=q('.amp-brand'); return {brand:br.scrollWidth<=br.clientWidth+1, over:q('.amp-bar').scrollWidth>q('.amp-bar').clientWidth+1, wrapped:[...document.querySelectorAll('.amp-bar button')].filter(x=>x.offsetParent&&x.scrollHeight>x.clientHeight+2).map(x=>x.dataset.a||x.className)}; };
  const bars={};
  for (const w of [390,768,1024,1280]) { await p.setViewportSize({width:w,height:Math.max(720,Math.round(w*.75))}); await p.evaluate(()=>AMStudio.present(1)); await sleep(450); bars['ed'+w]=await p.evaluate(BAR); await p.keyboard.press('Escape'); await sleep(250); }
  await p.setViewportSize({width:1440,height:900}); await sleep(200);
  const html2=await p.evaluate(()=>AMStudio.exportHTML()); const f2=path.join(__dirname,'saved-s15b.html'); fs.writeFileSync(f2,html2);
  const q2=await open(ctx,'file://'+f2,'exp2',1000);
  for (const w of [390,768,1024]) { await q2.setViewportSize({width:w,height:Math.max(720,Math.round(w*.75))}); await sleep(300); bars['ex'+w]=await q2.evaluate(BAR); }
  await q2.close(); try{ fs.unlinkSync(f2); }catch(e){}
  const badBars=Object.entries(bars).filter(([k,v])=>!v.brand||v.over||v.wrapped.length);
  check('S15-46: barra do player (editor e arquivo, 390–1280 px): marca A&M inteira, nenhum botão quebra linha, nada transborda', badBars.length===0, badBars.length?badBars:bars);
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); try{ fs.unlinkSync(f); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
