process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:860},acceptDownloads:true}); const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message)); p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load/.test(m.text()))errs.push(m.text())});
  await p.goto('file://'+path.join(__dirname,'AM-Studio-Editor.html')+'?nocover'); await sleep(700);
  await p.screenshot({path:'shots/01-blank.png'});
  // texto título
  await p.click('[data-menu=mText]'); await p.click('[data-text=title]'); await p.keyboard.type('Transformação que entrega resultado'); await p.mouse.click(300,700); await sleep(200);
  // forma
  await p.click('[data-menu=mShape]'); await p.click('[data-shape=chevron]'); await sleep(150);
  // mover forma arrastando
  const wrap=await p.$('#wrap'); const wb=await wrap.boundingBox();
  const sx=wb.x+wb.width/2, sy=wb.y+wb.height/2; await p.mouse.move(sx,sy); await p.mouse.down(); await p.mouse.move(sx+150,sy+120,{steps:8}); await p.mouse.up(); await sleep(150);
  // escrever na forma
  await p.mouse.dblclick(sx+150,sy+120); await p.keyboard.type('Etapa 1'); await p.mouse.click(wb.x+20,wb.y+20); await sleep(150);
  // seta
  await p.click('[data-add=arrow]'); await sleep(100);
  // efeito via acervo
  await p.click('#bFx'); await sleep(900); await p.screenshot({path:'shots/02-drawer.png'});
  await p.click('[data-ins=counter]'); await sleep(200);
  await p.fill('#props [data-p="data.value"]','12.5'); await p.dispatchEvent('#props [data-p="data.value"]','change'); await sleep(150);
  await p.click('#bFxClose'); await sleep(400);
  await p.screenshot({path:'shots/03-edit.png'});
  // novo slide capa e kpis
  await p.click('#addSlide'); await p.click('[data-layout=cover]'); await sleep(300);
  await p.click('#addSlide'); await p.click('[data-layout=kpis]'); await sleep(300);
  await p.click('#addSlide'); await p.click('[data-layout=content]'); await sleep(300);
  await p.screenshot({path:'shots/04-content.png'});
  // animar em sequência
  await p.mouse.click(wb.x+5,wb.y+wb.height-5); await sleep(100);
  await p.click('[data-act=seq]'); await sleep(200);
  // undo/redo
  await p.keyboard.press('Control+z'); await sleep(100); await p.keyboard.press('Control+Shift+z'); await sleep(100);
  const state=await p.evaluate(()=>({slides:AMStudio.deck.slides.length, els:AMStudio.deck.slides.map(s=>s.els.length), s1:AMStudio.deck.slides[0].els.map(e=>e.type+(e.kind?':'+e.kind:'')+(e.html?':'+e.html.slice(0,30):''))}));
  console.log(JSON.stringify(state));
  // apresentar
  await p.click('#bPlay'); await sleep(1800); await p.screenshot({path:'shots/05-play1.png'});
  await p.keyboard.press('ArrowRight'); await sleep(2600); await p.screenshot({path:'shots/06-play2.png'});
  await p.keyboard.press('ArrowRight'); await sleep(2600); await p.screenshot({path:'shots/07-play3.png'});
  await p.keyboard.press('Escape'); await sleep(300);
  // salvar
  const [dl]=await Promise.all([p.waitForEvent('download'), p.click('#bSave')]);
  const out=path.join(__dirname,'saved.html'); await dl.saveAs(out); console.log('download', dl.suggestedFilename(), Math.round(fs.statSync(out).size/1024)+'KB');
  // abrir arquivo salvo
  const p2=await ctx.newPage(); const e2=[]; p2.on('pageerror',e=>e2.push(e.message)); p2.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load/.test(m.text()))e2.push(m.text())});
  await p2.goto('file://'+out); await sleep(1500); await p2.screenshot({path:'shots/08-saved-1.png'});
  await p2.keyboard.press('ArrowRight'); await sleep(2500); await p2.screenshot({path:'shots/09-saved-2.png'});
  const n2=await p2.evaluate(()=>document.querySelectorAll('.amp-slide').length);
  // reabrir no editor
  await p.setInputFiles('#fOpen', out); await sleep(600);
  const re=await p.evaluate(()=>AMStudio.deck.slides.length);
  console.log(JSON.stringify({savedSlides:n2, reopenedSlides:re, errs, e2}));
  await b.close();
  /* portão: sai com 1 em qualquer erro de página ou de console (editor ou arquivo salvo) */
  process.exit(errs.length||e2.length?1:0);
})().catch(e=>{ console.error('ERRO', e); process.exit(1); });
