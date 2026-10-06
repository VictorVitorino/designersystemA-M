process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
/* Testes da capa CANTEIRO (cover.html/css/js). Uso: python3 assemble.py && node test-cover.js */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const SHOTS=path.join(__dirname,'shots-cover'); fs.mkdirSync(SHOTS,{recursive:true});
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2'); /* opcional: cópia local das Google Fonts para screenshots fiéis */
const results=[], errs=[];
function ok(name,cond,info){ results.push({name,ok:!!cond,info:info===undefined?'':info}); if(!cond) console.log('FAIL',name,JSON.stringify(info===undefined?'':info)); }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
let browser;
async function open(o={}){
  const ctx=await browser.newContext({viewport:o.vp||{width:1440,height:900},reducedMotion:o.reduce?'reduce':'no-preference',acceptDownloads:true});
  if(o.draft) await ctx.addInitScript(d=>{ try{ localStorage.setItem('amStudio.draft',d); }catch(e){} },JSON.stringify(o.draft));
  const p=await ctx.newPage(); await fonts(p); p.on('filechooser',()=>{}); /* liga a interceptação do seletor de arquivo antes de qualquer tecla */
  const tag=o.tag||'page';
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(FILE+(o.q||'')); await sleep(o.wait||900);
  return {p,ctx};
}
const S=p=>p.evaluate(()=>({open:AMCover.isOpen(), view:document.getElementById('cover').dataset.view, gone:document.getElementById('cover').classList.contains('cv-gone'), slides:AMStudio.deck.slides.length, els:AMStudio.deck.slides.reduce((a,s)=>a+s.els.length,0), title:AMStudio.deck.title, drawer:document.getElementById('drawer').classList.contains('open'), banner:document.getElementById('banner').classList.contains('open')}));
const EXPECT=[['Proposta comercial',7],['Diagnóstico de maturidade',7],['Status report executivo',6],['Kickoff de projeto',6],['Comitê / Workshop',6],['Apresentação institucional A&M',7]]; /* S34b: 6º projeto = bloco institucional + conteúdo + encerramento */

/* mede sobreposição e transbordamento no slide atual do editor (coordenadas lógicas 1280×720) */
async function slideCheck(p){
  return p.evaluate(()=>{
    const st=document.querySelector('#wrap .am-stage'), sr=st.getBoundingClientRect(), k=1280/sr.width;
    const deck=AMStudio.deck, idx=[...document.querySelectorAll('#thumbs .th')].findIndex(t=>t.classList.contains('on')), els=deck.slides[idx].els;
    if(/^inst-/.test(deck.slides[idx].layout||'')) return []; /* S34b: slides institucionais = arte oficial em camadas (fidelidade medida em test-s34) */
    const L=r=>({x:(r.left-sr.left)*k,y:(r.top-sr.top)*k,r:(r.right-sr.left)*k,b:(r.bottom-sr.top)*k});
    const issues=[], boxes=[];
    els.forEach(el=>{
      const n=st.querySelector('.am-el[data-id="'+el.id+'"]'); if(!n) { issues.push('missing '+el.id); return; }
      const deco=el.type==='line'||el.kind==='amlines', chev=el.type==='shape'&&el.shape==='chevron';
      let u=null; const add=r=>{ if(r.width<1||r.height<1) return; const q=L(r); u=u?{x:Math.min(u.x,q.x),y:Math.min(u.y,q.y),r:Math.max(u.r,q.r),b:Math.max(u.b,q.b)}:q; };
      const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT); let t; while((t=walker.nextNode())){ if(!t.textContent.trim()) continue; const rg=document.createRange(); rg.selectNodeContents(t); [...rg.getClientRects()].forEach(add); }
      n.querySelectorAll('svg rect,svg circle,svg path,svg line,img,.raci-b,.rk-cell,.rk-bub,.cg-card,.sw-q,.mx-q,.fxs-step,.fxc,.fxq,.fxcd,.mt-track,.dn-c').forEach(e=>add(e.getBoundingClientRect()));
      if(!u) return;
      if(!deco&&(u.x<-1||u.y<-1||u.r>1281||u.b>721)) issues.push('fora do slide: '+(el.kind||el.type)+' '+JSON.stringify([u.x,u.y,u.r,u.b].map(Math.round)));
      if(el.type==='text'){ const tx=n.querySelector('.am-tx').getBoundingClientRect(), nb=n.getBoundingClientRect(); if(tx.bottom>nb.bottom+3) issues.push('texto transborda a caixa: '+(el.html||'').slice(0,40)); }
      if(!deco) boxes.push({id:(el.kind||el.type)+':'+String(el.html||el.kind||'').replace(/<[^>]+>/g,' ').slice(0,24),u,chev});
    });
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){ const a=boxes[i].u,b=boxes[j].u; if(boxes[i].chev&&boxes[j].chev) continue;
      const w=Math.min(a.r,b.r)-Math.max(a.x,b.x), h=Math.min(a.b,b.b)-Math.max(a.y,b.y); if(w>2&&h>2) issues.push('sobreposição: '+boxes[i].id+' × '+boxes[j].id+' ('+Math.round(w)+'×'+Math.round(h)+')'); }
    return issues;
  });
}

(async()=>{
  if(!fs.existsSync(path.join(FONTS,'gf.css'))) console.log('aviso: sem a cópia local das fontes em '+FONTS+' (defina AM_FONTS_DIR ou crie ../fonts2): os textos usam a fonte substituta e as medidas da capa mudam');
  browser=await chromium.launch();
  /* 1. capa visível ao abrir */
  { const {p,ctx}=await open({tag:'load',wait:3400});
    const s=await S(p); const box=await p.evaluate(()=>{const r=document.getElementById('cover').getBoundingClientRect(); return [r.x,r.y,r.width,r.height,getComputedStyle(document.getElementById('cover')).display,document.activeElement&&document.getElementById('cover').contains(document.activeElement), document.getElementById('cover').getAttribute('role'), document.getElementById('cover').getAttribute('aria-modal')];});
    ok('capa visível ao carregar',s.open&&!s.gone&&box[0]===0&&box[1]===0&&box[2]===1440&&box[3]===900&&box[4]!=='none',box);
    ok('foco dentro da capa (dialog aria-modal)',box[5]&&box[6]==='dialog'&&box[7]==='true',box);
    ok('6 opções com dicas 1–6',(await p.$$eval('.cv-opt',b=>b.map(x=>x.dataset.k+x.querySelector('.cv-key').textContent).join(',')))==='11,22,33,44,55,66');
    ok('textos de identidade',await p.evaluate(()=>{const t=document.getElementById('cover').innerText; return /Canteiro/.test(t)&&/ACERVO DE APRESENTAÇÕES A&M/i.test(t)&&/Monte, encaixe e apresente — peça por peça\./.test(t)&&/Digital & Technology Services/.test(t)&&/O arquivo-mestre nunca é alterado · “Salvar” gera um novo HTML da sua apresentação/.test(t);}));
    ok('sem rascunho: Retomar desabilitado',await p.evaluate(()=>{const b=document.querySelector('.cv-opt[data-k="3"]'); return b.getAttribute('aria-disabled')==='true'&&/Nenhum rascunho salvo ainda/.test(b.textContent);}));
    ok('cena: grua anima peças',await p.evaluate(async()=>{const a=document.getElementById('scHook').getAttribute('transform'); await new Promise(r=>setTimeout(r,700)); return a!==document.getElementById('scHook').getAttribute('transform');}));
    await p.screenshot({path:path.join(SHOTS,'01-capa-1440x900.png')});
    await p.keyboard.press('Escape'); await sleep(400); ok('Esc na abertura inicial não fecha',(await S(p)).open);
    await p.keyboard.press('3'); await sleep(300); ok('tecla 3 sem rascunho: continua aberta',(await S(p)).open);
    /* setas + Enter */
    await p.focus('.cv-opt[data-k="1"]'); await p.keyboard.press('ArrowRight'); const f1=await p.evaluate(()=>document.activeElement.dataset.k);
    await p.keyboard.press('ArrowDown'); const f2=await p.evaluate(()=>document.activeElement.dataset.k);
    await p.keyboard.press('ArrowLeft'); const f3=await p.evaluate(()=>document.activeElement.dataset.k);
    await p.keyboard.press('ArrowUp'); const f4=await p.evaluate(()=>document.activeElement.dataset.k);
    ok('setas movem o foco (→ ↓ ← ↑)',f1==='2'&&f2==='5'&&f3==='4'&&f4==='1',[f1,f2,f3,f4]);
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await sleep(500);
    ok('Enter ativa a opção focada (Projetos prontos)',(await S(p)).view==='tpl');
    await p.keyboard.press('Escape'); await sleep(300); ok('Esc no painel volta ao início',(await S(p)).view==='home'&&(await S(p)).open);
    /* Tab fica preso na capa */
    let inside=true; for(let i=0;i<14;i++){ await p.keyboard.press('Tab'); inside=inside&&await p.evaluate(()=>document.getElementById('cover').contains(document.activeElement)); }
    ok('Tab permanece dentro da capa',inside);
    await ctx.close(); }

  /* 2. ?nocover */
  { const {p,ctx}=await open({tag:'nocover',q:'?nocover'}); const s=await S(p);
    ok('?nocover pula a capa',!s.open&&await p.evaluate(()=>getComputedStyle(document.getElementById('cover')).display==='none'));
    await p.evaluate(()=>AMCover.open()); await sleep(900); ok('AMCover.open() funciona mesmo com ?nocover',(await S(p)).open&&await p.evaluate(()=>getComputedStyle(document.getElementById('cover')).display!=='none'));
    await ctx.close(); }

  /* 3. opção 1 — clique e tecla */
  for(const how of ['click','key']){ const {p,ctx}=await open({tag:'o1-'+how});
    if(how==='click') await p.click('.cv-opt[data-k="1"]'); else await p.keyboard.press('1'); await sleep(900);
    const s=await S(p); ok('1 Obra nova ('+how+')',!s.open&&s.gone&&s.slides===1&&s.els===0,s);
    ok('foco devolvido ao editor ('+how+')',await p.evaluate(()=>!document.getElementById('cover').contains(document.activeElement)));
    await ctx.close(); }

  /* 4. opção 2 — projetos prontos, cada um carregado e conferido slide a slide */
  let saved=null;
  for(let t=0;t<EXPECT.length;t++){
    const {p,ctx}=await open({tag:'tpl'+t,vp:{width:1440,height:900}});
    if(t%2===0) await p.click('.cv-opt[data-k="2"]'); else await p.keyboard.press('2'); await sleep(900);
    if(t===0){ const info=await p.evaluate(()=>({cards:document.querySelectorAll('.cv-tcard').length, stages:document.querySelectorAll('.cv-tcard .cv-pv .am-stage').length, strip:document.querySelectorAll('#cvStrip .cv-th .am-stage').length, names:[...document.querySelectorAll('.cv-tname')].map(n=>n.textContent), counts:[...document.querySelectorAll('.cv-tn')].map(n=>n.textContent)}));
      ok('painel com 6 projetos e prévias vivas',info.cards===6&&info.stages===6&&info.strip===7&&info.names.join('|')===EXPECT.map(e=>e[0]).join('|'),info);
      ok('nº de slides em cada cartão',info.counts.join(',')===EXPECT.map(e=>String(e[1]).padStart(2,'0')+' slides').join(','),info.counts);
      await p.screenshot({path:path.join(SHOTS,'02-projetos-1440x900.png')}); }
    if(t%2===0) await p.click(`.cv-tcard[data-t="${t}"]`); else await p.keyboard.press(String(t+1)); await sleep(1000);
    const s=await S(p); ok(`2 → projeto ${t+1} “${EXPECT[t][0]}” (${t%2===0?'clique':'tecla'})`,!s.open&&s.slides===EXPECT[t][1]&&s.title&&s.els>0,s);
    let bad=[];
    for(let k=0;k<s.slides;k++){ await p.evaluate(k=>AMStudio.goSlide(k),k); await sleep(250);
      const w=await p.$('#wrap'); await w.screenshot({path:path.join(SHOTS,`tpl${t+1}-slide${String(k+1).padStart(2,'0')}.png`)});
      const iss=await slideCheck(p); if(iss.length) bad.push({slide:k+1,iss}); }
    ok(`projeto ${t+1}: todos os slides sem sobreposição/transbordamento`,!bad.length,bad);
    if(t===0) saved=await p.evaluate(()=>AMStudio.exportHTML());
    await ctx.close(); }

  /* 5. opção 3 — retomar rascunho */
  for(const how of ['click','key']){
    const {p:p0,ctx:c0}=await open({tag:'draftmk',q:'?nocover'}); const draft=await p0.evaluate(()=>{const d=AMCover.buildTemplate(2); d.slides=d.slides.slice(0,3); d.title='Rascunho de teste'; return d;}); await c0.close();
    const {p,ctx}=await open({tag:'o3-'+how,draft});
    const lab=await p.evaluate(()=>{const b=document.querySelector('.cv-opt[data-k="3"]'); return {dis:b.getAttribute('aria-disabled'), t:b.textContent.replace(/\s+/g,' '), banner:document.getElementById('banner').classList.contains('open')};});
    ok('3 com rascunho: título e nº de slides ('+how+')',lab.dis!=='true'&&/Retomar obra/.test(lab.t)&&/Rascunho de teste/.test(lab.t)&&/3 slides/.test(lab.t)&&!lab.banner,lab);
    if(how==='click') await p.click('.cv-opt[data-k="3"]'); else await p.keyboard.press('3'); await sleep(900);
    const s=await S(p); ok('3 Retomar obra carrega o rascunho ('+how+')',!s.open&&s.slides===3&&s.title==='Rascunho de teste',s);
    await ctx.close(); }

  /* 6. opção 4 — abrir planta (seletor de arquivo) */
  const fx=path.join(os.tmpdir(),'canteiro-teste-'+process.pid+'.html'); fs.writeFileSync(fx,saved||'');
  for(const how of ['click','key']){ const {p,ctx}=await open({tag:'o4-'+how});
    let [fc]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}), how==='click'?p.click('.cv-opt[data-k="4"]'):p.keyboard.press('4')]);
    await fc.setFiles([]); await sleep(600); ok('4 cancelado: capa continua aberta ('+how+')',(await S(p)).open);
    [fc]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}), how==='click'?p.click('.cv-opt[data-k="4"]'):p.keyboard.press('4')]);
    await fc.setFiles(fx); await sleep(1200);
    const s=await S(p); ok('4 Abrir planta carrega o .html e fecha ('+how+')',!s.open&&s.slides===7,s);
    await ctx.close(); }
  /* arrastar e soltar um .html na capa */
  { const {p,ctx}=await open({tag:'drop'});
    await p.evaluate(txt=>{const dt=new DataTransfer(); dt.items.add(new File([txt],'proposta.html',{type:'text/html'})); const c=document.getElementById('cover'); c.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true})); window.__dragUI=c.classList.contains('cv-dragover'); c.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));},saved);
    await sleep(1200); const s=await S(p); ok('arrastar e soltar .html abre a planta',!s.open&&s.slides===7&&await p.evaluate(()=>window.__dragUI),s);
    await ctx.close(); }

  /* 7. opção 5 — almoxarifado */
  for(const how of ['click','key']){ const {p,ctx}=await open({tag:'o5-'+how});
    if(how==='click') await p.click('.cv-opt[data-k="5"]'); else await p.keyboard.press('5'); await sleep(1000);
    const s=await S(p); const tab=await p.evaluate(()=>!document.getElementById('modelsBody').classList.contains('hidden'));
    ok('5 Almoxarifado: deck em branco + biblioteca de modelos ('+how+')',!s.open&&s.drawer&&tab&&s.slides===1&&s.els===0,s);
    await ctx.close(); }

  /* 8. opção 6 — manual da obra */
  for(const how of ['click','key','F1','?']){ const {p,ctx}=await open({tag:'o6-'+how});
    if(how==='click') await p.click('.cv-opt[data-k="6"]'); else await p.keyboard.press(how==='key'?'6':how); await sleep(800);
    const info=await p.evaluate(()=>({view:document.getElementById('cover').dataset.view, steps:document.querySelectorAll('.cv-step').length, rows:document.querySelectorAll('.cv-kt tr:not(.cv-kg)').length, kbd:document.querySelectorAll('.cv-kt kbd').length, txt:document.getElementById('cvHelp').innerText}));
    const must=['Copiar / recortar / colar','Duplicar','Selecionar tudo no slide','Apagar seleção','Desfazer','Refazer','Salvar apresentação','Apresentar do início','Apresentar do slide atual','Mover 1 px / 10 px','Somar à seleção','Seleção por área','Editar texto','Menu de opções','Sair da edição / limpar seleção','Atalhos','Escolha','Construa','Apresente e salve'];
    ok('6 Manual da obra ('+how+')',info.view==='help'&&info.steps===3&&info.rows===17&&info.kbd>=25&&must.every(m=>info.txt.includes(m)),{view:info.view,rows:info.rows,kbd:info.kbd,missing:must.filter(m=>!info.txt.includes(m))});
    if(how==='click') await p.screenshot({path:path.join(SHOTS,'03-manual-1440x900.png')});
    await p.keyboard.press('Escape'); await sleep(300); ok('Esc no manual volta ao início ('+how+')',(await S(p)).view==='home');
    await ctx.close(); }

  /* 9. reabrir pelo editor, Esc, “Voltar à obra atual” e confirmação de troca */
  { const {p,ctx}=await open({tag:'reopen'});
    await p.keyboard.press('2'); await sleep(600); await p.keyboard.press('1'); await sleep(900);
    const before=await S(p);
    await p.focus('#bPlay'); await p.evaluate(()=>AMCover.open()); await sleep(900);
    let s=await S(p); const r=await p.evaluate(()=>({o3:document.querySelector('.cv-opt[data-k="3"]').textContent.replace(/\s+/g,' '), resume:!document.getElementById('cvResume').hidden, inside:document.getElementById('cover').contains(document.activeElement)}));
    ok('AMCover.open() a partir do editor',s.open&&r.inside,r);
    ok('opção 3 vira “Voltar à obra atual”',/Voltar à obra atual/.test(r.o3)&&r.resume,r);
    await p.screenshot({path:path.join(SHOTS,'04-reaberta-com-obra-1440x900.png')});
    await p.keyboard.press('Escape'); await sleep(900); s=await S(p);
    ok('Esc fecha quando a obra já tem conteúdo',!s.open&&s.slides===before.slides&&s.els===before.els,s);
    ok('foco volta ao elemento de origem',await p.evaluate(()=>document.activeElement&&document.activeElement.id==='bPlay'));
    await p.evaluate(()=>AMCover.open()); await sleep(800); await p.click('.cv-opt[data-k="3"]'); await sleep(900); s=await S(p);
    ok('“Voltar à obra atual” só fecha',!s.open&&s.slides===before.slides&&s.els===before.els,s);
    await p.evaluate(()=>AMCover.open()); await sleep(800); await p.keyboard.press('1'); await sleep(300);
    const cf=await p.evaluate(()=>!document.getElementById('cvConfirm').hidden&&document.activeElement.id);
    ok('trocar obra pede confirmação',cf==='cvCfOk',cf);
    await p.screenshot({path:path.join(SHOTS,'05-confirmacao-1440x900.png')});
    await p.keyboard.press('Escape'); await sleep(300); s=await S(p);
    ok('Esc cancela a confirmação sem perder a obra',s.open&&s.els===before.els&&await p.evaluate(()=>document.getElementById('cvConfirm').hidden),s);
    await p.keyboard.press('1'); await sleep(200); await p.click('#cvCfOk'); await sleep(900); s=await S(p);
    ok('confirmar substitui por obra nova',!s.open&&s.slides===1&&s.els===0,s);
    await p.evaluate(()=>AMCover.open()); await sleep(900); await p.keyboard.press('Escape'); await sleep(900);
    ok('aberta pelo editor, Esc sempre volta à obra (mesmo vazia)',!(await S(p)).open);
    await p.evaluate(()=>AMCover.open()); await sleep(800);
    await p.evaluate(()=>AMCover.close()); await sleep(900); ok('AMCover.close()',!(await S(p)).open);
    await p.click('#top .brand'); await sleep(900); ok('clicar na marca do editor reabre a capa (atalho extra)',(await S(p)).open); await p.evaluate(()=>AMCover.close()); await sleep(900);
    /* atalhos do editor ficam bloqueados enquanto a capa está aberta */
    await p.evaluate(()=>AMStudio.loadDeck(AMCover.buildTemplate(3))); await p.evaluate(()=>AMCover.open()); await sleep(800);
    const n0=(await S(p)).slides; await p.keyboard.press('Control+z'); await p.keyboard.press('PageDown'); await sleep(200);
    ok('teclas não vazam para o editor com a capa aberta',(await S(p)).slides===n0&&(await S(p)).open);
    await ctx.close(); }

  /* 9b. regressões da revisão (capa ↔ editor) */
  { const {p,ctx}=await open({tag:'rev-a',q:'?nocover'});
    /* CI-01/CR-08: obra sem elementos, mas com título e fundo → Esc volta, nada é perdido; trocar pede confirmação */
    await p.fill('#title','Board deck Q4 — versão do CFO'); await p.keyboard.press('Tab'); await sleep(100);
    await p.click('#bHome'); await sleep(900);
    let r=await p.evaluate(()=>({resume:!document.getElementById('cvResume').hidden, o3:document.querySelector('.cv-opt[data-k="3"]').textContent.replace(/\s+/g,' ')}));
    ok('CI-01: obra só com título → “Voltar à obra” visível',r.resume&&/Voltar à obra atual/.test(r.o3)&&/1 slide/.test(r.o3),r);
    await p.keyboard.press('1'); await sleep(250);
    ok('CI-01: Obra nova sobre obra titulada pede confirmação',await p.evaluate(()=>!document.getElementById('cvConfirm').hidden));
    await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Escape'); await sleep(900);
    let s=await S(p), undo=await p.evaluate(()=>!document.getElementById('bUndo').disabled); ok('CI-01: Esc volta à obra com título e histórico intactos',!s.open&&s.title==='Board deck Q4 — versão do CFO'&&undo,{s,undo});
    /* VB-14: cartão 3 mostra título e nº de slides em linhas próprias */
    await p.evaluate(()=>AMStudio.loadDeck(AMCover.buildTemplate(0))); await p.evaluate(()=>AMCover.open()); await sleep(900);
    r=await p.evaluate(()=>{const q=document.querySelector('#cvO3s .cv-q'), n=document.querySelector('#cvO3s .cv-n'); return {n:n&&n.textContent, nVis:n&&n.getBoundingClientRect().height>0&&n.getBoundingClientRect().bottom<=document.querySelector('.cv-opt[data-k="3"]').getBoundingClientRect().bottom, q:q&&q.textContent};});
    ok('VB-14: “7 slides” sempre visível no cartão 3',r.n==='7 slides'&&r.nVis&&/Proposta comercial/.test(r.q),r);
    /* CI-06: modal do editor por cima da capa fica com o teclado */
    await p.evaluate(()=>{ window.__cf=null; AMStudio.confirm({title:'Teste',msg:'x'}).then(v=>window.__cf=v); }); await sleep(250);
    await p.keyboard.press('1'); await sleep(150); await p.keyboard.press('Tab'); await sleep(100);
    r=await p.evaluate(()=>({cf:!document.getElementById('cvConfirm').hidden, inModal:document.getElementById('modal').contains(document.activeElement)}));
    await p.keyboard.press('Escape'); await sleep(250); s=await S(p);
    ok('CI-06: com o modal aberto, teclas não agem na capa; Esc fecha só o modal',!r.cf&&r.inModal&&s.open&&!s.modal,{r,s});
    /* CI-10/CR-09: F5 na capa nunca recarrega; vindo do editor, apresenta */
    const f5=await p.evaluate(()=>{ const e=new KeyboardEvent('keydown',{key:'F5',bubbles:true,cancelable:true}); document.activeElement.dispatchEvent(e); return e.defaultPrevented; }); await sleep(900);
    s=await S(p); const pres=await p.evaluate(()=>document.getElementById('presenter').classList.contains('open')); ok('CI-10: F5 na capa é tratado (apresenta a obra)',f5&&!s.open&&pres,{f5,s,pres});
    await p.keyboard.press('Escape'); await sleep(300);
    /* CI-08: Ajuda › Manual da obra → Esc volta direto ao editor */
    await p.click('#mbar [data-m=help]'); await sleep(200); await p.locator('.xmenu .xi',{hasText:'Manual da obra'}).click(); await sleep(900);
    r=await p.evaluate(()=>({view:document.getElementById('cover').dataset.view, back:document.querySelector('#cvHelp [data-back]').textContent.replace(/\s+/g,' ').trim(), txt:document.getElementById('cvHelp').innerText}));
    await p.keyboard.press('Escape'); await sleep(900); s=await S(p);
    ok('CI-08: manual aberto pela Ajuda volta à obra com Esc',r.view==='help'&&/Voltar à obra/.test(r.back)&&!s.open,{r:r.back,s});
    ok('CI-13: manual diz como ter tela cheia e onde fica F1',/F alterna a tela cheia/i.test(r.txt)&&/No editor, F1 mostra os atalhos/i.test(r.txt)&&/Abrir apresentação/i.test(r.txt));
    /* CI-05: Ctrl+A na capa não seleciona a página */
    await p.evaluate(()=>AMCover.open()); await sleep(800);
    const ca=await p.evaluate(()=>{ const e=new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true}); document.activeElement.dispatchEvent(e); return e.defaultPrevented; });
    await p.evaluate(()=>getSelection().selectAllChildren(document.body)); await p.keyboard.press('Escape'); await sleep(900);
    ok('CI-05: Ctrl+A prevenido na capa e seleção limpa ao fechar',ca&&await p.evaluate(()=>String(getSelection()).length===0),ca);
    /* CI-14: decisões do comitê batem com a matriz */
    const tc=await p.evaluate(()=>{const d=AMCover.buildTemplate(4); const mx=d.slides[2].els.find(e=>e.kind==='matrix'), cg=d.slides[4].els.find(e=>e.kind==='cardgrid'); return {qw:mx.data.items.filter(i=>i.x<50&&i.y>50).length, d1:cg.data.cards[0].t};});
    ok('CI-14: Comitê — nº de quick wins na matriz = decisão D1',tc.qw===2&&/dois quick wins/.test(tc.d1),tc);
    await ctx.close(); }
  { /* CI-02: com rascunho salvo, Obra nova avisa que o rascunho será substituído */
    const {p:p0,ctx:c0}=await open({tag:'rev-dmk',q:'?nocover'}); const draft=await p0.evaluate(()=>{const d=AMCover.buildTemplate(2); d.slides=d.slides.slice(0,4); d.title='Rascunho de ontem'; return d;}); await c0.close();
    const {p,ctx}=await open({tag:'rev-b',draft});
    await p.keyboard.press('1'); await sleep(250);
    let r=await p.evaluate(()=>({shown:!document.getElementById('cvConfirm').hidden, d:document.getElementById('cvCfD').textContent}));
    ok('CI-02: Obra nova com rascunho salvo pede confirmação',r.shown&&/Rascunho de ontem/.test(r.d)&&/Retomar obra/.test(r.d),r);
    await p.keyboard.press('Escape'); await sleep(150);
    ok('CI-02: cancelar mantém a capa e o rascunho',(await S(p)).open&&await p.evaluate(()=>JSON.parse(localStorage.getItem('amStudio.draft')).title==='Rascunho de ontem'));
    await p.keyboard.press('3'); await sleep(900);
    ok('CI-02: Retomar não pede confirmação',(await S(p)).title==='Rascunho de ontem');
    await ctx.close(); }
  { /* CI-07/CR-15: arquivo inválido pela capa → uma só mensagem (a da capa) */
    const {p,ctx}=await open({tag:'rev-c'});
    const bad=path.join(os.tmpdir(),'canteiro-invalido-'+process.pid+'.html'); fs.writeFileSync(bad,'<html><body>oi</body></html>');
    const [fc]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}),p.keyboard.press('4')]); await fc.setFiles(bad); await sleep(600);
    const r=await p.evaluate(()=>({toast:document.getElementById('toast').classList.contains('show'), note:document.getElementById('cvNote').classList.contains('show')}));
    ok('CI-07: arquivo inválido mostra só o aviso da capa',r.note&&!r.toast,r);
    try{ fs.unlinkSync(bad); }catch(e){}
    await ctx.close(); }

  /* 10. tamanhos de tela e movimento reduzido */
  for(const [w,h] of [[1440,900],[1280,720],[1366,768],[1024,768],[390,844]]){
    const {p,ctx}=await open({tag:'vp'+w,vp:{width:w,height:h},wait:3600});
    await p.mouse.move(w/2,h/2); await p.mouse.wheel(600,0); await sleep(250);
    const m=await p.evaluate(()=>{const c=document.getElementById('cover'); return {sh:c.scrollHeight,ch:c.clientHeight,sw:c.scrollWidth,cw:c.clientWidth,winX:window.scrollX,coverX:c.scrollLeft};});
    if(w>=1024) ok(`${w}×${h}: cabe sem rolagem`,m.sh<=m.ch+1&&m.sw<=m.cw,m);
    /* o alinhamento depende da fonte dos títulos: com a fonte substituta (sem a cópia local das fontes) “Projetos prontos” quebra em 2 linhas
       a 1280 px e a linha 1 dá [74,53,74,…]. Mede só depois de a face Roboto Condensed 700 carregar e diz no resultado se ela está em uso. */
    if(w>=1024){ const r=await p.evaluate(async()=>{ try{ await document.fonts.load("700 18px 'Roboto Condensed'"); await document.fonts.ready; }catch(e){}
        await new Promise(z=>requestAnimationFrame(()=>requestAnimationFrame(z)));
        const brand=[...document.fonts].some(f=>/Roboto Condensed/.test(f.family)&&String(f.weight)==='700'&&f.status==='loaded');
        return {brand, tops:[...document.querySelectorAll('.cv-opt')].map(o=>Math.round(o.querySelector('.cv-lbl').getBoundingClientRect().top-o.getBoundingClientRect().top))}; });
      const tops=r.tops; ok(`${w}×${h}: títulos das opções alinhados por linha`,tops[0]===tops[1]&&tops[1]===tops[2]&&tops[3]===tops[4]&&tops[4]===tops[5],r.brand?tops:{tops,fonte:'Roboto Condensed 700 não carregou (sem a cópia local das fontes: defina AM_FONTS_DIR ou crie ../fonts2)'}); }
    ok(`${w}×${h}: sem rolagem horizontal`,m.sw<=m.cw&&m.winX===0&&m.coverX===0,m);
    await p.screenshot({path:path.join(SHOTS,`10-capa-${w}x${h}.png`),fullPage:false});
    if(w<=640) await p.screenshot({path:path.join(SHOTS,`10-capa-${w}x${h}-rolagem.png`),fullPage:false,clip:undefined});
    await p.keyboard.press('2'); await sleep(900);
    const m2=await p.evaluate(()=>{const c=document.getElementById('cover'); return {sh:c.scrollHeight,ch:c.clientHeight,sw:c.scrollWidth,cw:c.clientWidth};});
    if(w>=1100) ok(`${w}×${h}: projetos cabem sem rolagem`,m2.sh<=m2.ch+1,m2); else ok(`${w}×${h}: projetos sem rolagem horizontal`,m2.sw<=m2.cw,m2);
    await p.screenshot({path:path.join(SHOTS,`11-projetos-${w}x${h}.png`)});
    await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('6'); await sleep(900);
    const m3=await p.evaluate(()=>{const c=document.getElementById('cover'); return {sh:c.scrollHeight,ch:c.clientHeight,sw:c.scrollWidth,cw:c.clientWidth};});
    if(w>=1100) ok(`${w}×${h}: manual cabe sem rolagem`,m3.sh<=m3.ch+1,m3); else ok(`${w}×${h}: manual sem rolagem horizontal`,m3.sw<=m3.cw,m3);
    await p.screenshot({path:path.join(SHOTS,`12-manual-${w}x${h}.png`)});
    if(w===390){ await p.keyboard.press('Escape'); await sleep(300); await p.evaluate(()=>document.getElementById('cover').scrollTo(0,99999)); await sleep(300); await p.screenshot({path:path.join(SHOTS,`10-capa-${w}x${h}-fim.png`)}); }
    await ctx.close(); }
  { const {p,ctx}=await open({tag:'reduce',reduce:true,wait:1200});
    const placed=await p.evaluate(()=>[0,1,2,3,4].every(i=>parseFloat(document.getElementById('scPc'+i).getAttribute('opacity'))>=.99));
    const still=await p.evaluate(async()=>{const a=document.getElementById('scHook').getAttribute('transform'); await new Promise(r=>setTimeout(r,800)); return a===document.getElementById('scHook').getAttribute('transform');});
    ok('movimento reduzido: cena composta e parada',placed&&still,{placed,still});
    await p.screenshot({path:path.join(SHOTS,'13-movimento-reduzido-1440x900.png')});
    await p.click('.cv-opt[data-k="1"]'); await sleep(500); ok('movimento reduzido: fecha',!(await S(p)).open);
    await ctx.close(); }

  try{ fs.unlinkSync(fx); }catch(e){}
  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log(JSON.stringify({total:results.length, passed:results.length-fails.length, failed:fails.map(f=>f.name), errs},null,1));
  process.exit(fails.length||errs.length?1:0);
})().catch(async e=>{ console.error('ERRO', e); try{ if(browser) await browser.close(); }catch(_){} process.exit(1); });
