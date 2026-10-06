process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:860},acceptDownloads:true}); const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message)); p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load/.test(m.text()))errs.push(m.text())});
  await p.goto('file://'+path.join(__dirname,'AM-Studio-Editor.html')+'?nocover'); await sleep(600);
  await p.click('#bModels'); await sleep(900); await p.screenshot({path:'shots/m01-library.png'});
  await p.fill('#mSearch','raci'); await sleep(300); await p.screenshot({path:'shots/m02-search.png'});
  const visible=await p.evaluate(()=>[...document.querySelectorAll('#modelsBody .fxi')].filter(c=>c.style.display!=='none').map(c=>c.dataset.k));
  await p.click('#modelsBody [data-ins=raci]'); await sleep(1600); await p.screenshot({path:'shots/m03-raci-preview.png'});
  await sleep(3000);
  // setinha
  await p.click('#fxArrow'); await sleep(300); await p.screenshot({path:'shots/m04-arrow.png'});
  await p.click('#mVar [data-v=accountable]'); await sleep(2600); await p.screenshot({path:'shots/m05-accountable.png'});
  await sleep(2000);
  // clicar numa célula para trocar letra
  const before=await p.evaluate(()=>AMStudio.deck.slides[0].els[0].data.rows[0].v[1]);
  const cell=await p.$('#wrap .am-stage [data-cyc="rows.0.v.1"]'); const cb=await cell.boundingBox(); await p.mouse.click(cb.x+cb.width/2, cb.y+cb.height/2); await sleep(200);
  const after=await p.evaluate(()=>AMStudio.deck.slides[0].els[0].data.rows[0].v[1]);
  // edição inline do papel
  const role=await p.$('#wrap .am-stage [data-e="roles.0"]'); const rb=await role.boundingBox(); await p.mouse.dblclick(rb.x+rb.width/2, rb.y+rb.height/2); await sleep(150); await p.keyboard.type('Diretoria'); await p.keyboard.press('Enter'); await sleep(200);
  const role0=await p.evaluate(()=>AMStudio.deck.slides[0].els[0].data.roles[0]);
  await p.screenshot({path:'shots/m06-edited.png'});
  // todos os modelos, um por slide
  const kinds=['riskmap','swot','matrix','cardgrid','maturity','linechart','donut','gauge','timeline','process','bars'];
  for(const k of kinds){ await p.evaluate(k=>{AMStudio.addSlide('blank-light'); AMStudio.insertFx(k);},k); await sleep(150); }
  await p.evaluate(()=>{AMStudio.addSlide('blank-dark'); AMStudio.insertFx('riskmap');}); await sleep(200);
  await p.screenshot({path:'shots/m07-dark-risk.png'});
  // variações de cada modelo: screenshot do estado final na apresentação
  const nSlides=await p.evaluate(()=>AMStudio.deck.slides.length);
  await p.click('#bPlay'); await sleep(500);
  for(let i=0;i<nSlides;i++){ await p.evaluate(()=>{}); await sleep(i===0?3500:3800); await p.screenshot({path:`shots/play-${String(i+1).padStart(2,'0')}.png`}); await p.keyboard.press('ArrowRight'); }
  await p.keyboard.press('Escape'); await sleep(300);
  // variações alternativas: aplica cada variant e mede erros
  const varRes=await p.evaluate(async()=>{ const R=window.AMRT, out=[]; for(const k of Object.keys(R.FX).filter(k=>R.FX[k].model)){ out.push(k+':'+R.FX[k].variants.map(v=>v[0]).join('/')); } return out; });
  const [dl]=await Promise.all([p.waitForEvent('download'), p.click('#bSave')]); const out=path.join(__dirname,'saved2.html'); await dl.saveAs(out);
  await p.setInputFiles('#fOpen', out); await sleep(500); const reopened=await p.evaluate(()=>AMStudio.deck.slides.length);
  console.log(JSON.stringify({visible, before, after, role0, nSlides, reopened, varRes, errs},null,1));
  await b.close();
  /* portão: sai com 1 em qualquer erro de página ou de console */
  process.exit(errs.length?1:0);
})().catch(e=>{ console.error('ERRO', e); process.exit(1); });
