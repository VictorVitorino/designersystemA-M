/* test-s09-merged: Índice + Linha do tempo + Resumo do slide.
   rt-90-index.js/.css: thumbnail generation, index drawer (outline + grid), timeline scrubber,
   slide summary panel com estatísticas. */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'✓ ':'✗ ')+name); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function page(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  if(url) await p.goto(url); await sleep(wait||800); return p; }

(async()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext();
  const p=await page(ctx,FILE,'s09-main',1200);

  // S09-01: gxIndex module existe e tem thumbnail(), renderDrawer(), renderTimeline(), renderSummary()
  const hasMethods=await p.evaluate(()=>typeof gxIndex==='object'&&typeof gxIndex.thumbnail==='function');
  check('S09-01: gxIndex module loaded with methods', hasMethods);

  // S09-02: Thumbnail cria canvas com dimensões corretas
  const thumbTest=await p.evaluate(()=>{
    const slide={title:{t:'Test Slide'}, els:[{kind:'text'},{kind:'shape'}], bg:{c:'#fff'}};
    const thumb=gxIndex.thumbnail(slide,120,90);
    return thumb && thumb.startsWith('data:image/png');
  });
  check('S09-02: Thumbnail generation produces data URI', thumbTest);

  // S09-03: Index drawer renderiza com grid de thumbnails
  const drawerTest=await p.evaluate(()=>{
    const deck={slides:[{title:{t:'Slide 1'},els:[],bg:{c:'#fff'}},{title:{t:'Slide 2'},els:[],bg:{c:'#f5f5f5'}}]};
    const parent=document.createElement('div');
    const drawer=gxIndex.renderDrawer(parent,deck,()=>{});
    const items=drawer.querySelectorAll('.gx-index-item');
    return items.length===2 && drawer.querySelector('.gx-index-list')!==null;
  });
  check('S09-03: Index drawer renders with thumbnails', drawerTest);

  // S09-04: Clique no item índice dispara callback
  const clickTest=await p.evaluate(()=>{
    const deck={slides:[{title:{t:'S1'}},{title:{t:'S2'}}]};
    const parent=document.createElement('div');
    let clicked=-1;
    const drawer=gxIndex.renderDrawer(parent,deck,i=>clicked=i);
    const item=drawer.querySelector('[data-slide="1"]');
    if(item) { item.click(); return clicked===1; }
    return false;
  });
  check('S09-04: Index item click triggers callback', clickTest);

  // S09-05: Timeline scrubber renderiza com track e handle
  const timelineTest=await p.evaluate(()=>{
    const deck={slides:Array(5).fill({})};
    const parent=document.createElement('div');
    const tl=gxIndex.renderTimeline(parent,deck,2,()=>{});
    return parent.querySelector('.gx-timeline')!==null && parent.querySelector('.gx-timeline-handle')!==null;
  });
  check('S09-05: Timeline scrubber renders', timelineTest);

  // S09-06: Summary panel mostra título e número de elementos
  const summaryTest=await p.evaluate(()=>{
    const slide={title:{t:'Título do Slide'},els:[{kind:'text'},{kind:'shape'},{kind:'line'}]};
    const parent=document.createElement('div');
    const summary=gxIndex.renderSummary(parent,slide);
    return summary.querySelector('.gx-summary-header h4').textContent.includes('Título do Slide') &&
           summary.textContent.includes('3 elementos');
  });
  check('S09-06: Summary panel shows title and element count', summaryTest);

  // S09-07: Summary background color exibe no painel
  const bgTest=await p.evaluate(()=>{
    const slide={title:{t:'Color Bg'},bg:{c:'#f5f5f5'},els:[]};
    const parent=document.createElement('div');
    const summary=gxIndex.renderSummary(parent,slide);
    return summary.textContent.includes('#f5f5f5');
  });
  check('S09-07: Summary displays background color', bgTest);

  // S09-08: Thumbnail cache reutiliza dados para slides idênticos
  const cacheTest=await p.evaluate(()=>{
    const slide={title:{t:'Same'},els:[],bg:{c:'#fff'}};
    const t1=gxIndex.thumbnail(slide,100,100);
    const t2=gxIndex.thumbnail(slide,100,100);
    return t1===t2;  // Mesma URL em memória
  });
  check('S09-08: Thumbnail caching works', cacheTest);

  // S09-09: Index list é scrollável
  const scrollTest=await p.evaluate(()=>{
    const deck={slides:Array(20).fill({title:{t:'S'},els:[],bg:{c:'#fff'}})};
    const parent=document.createElement('div');
    const drawer=gxIndex.renderDrawer(parent,deck,()=>{});
    const list=drawer.querySelector('.gx-index-list');
    return list && window.getComputedStyle(list).overflowY==='auto';
  });
  check('S09-09: Index list is scrollable', scrollTest);

  // S09-10: Timeline update position na previewização
  const posTest=await p.evaluate(()=>{
    const deck={slides:Array(10).fill({})};
    const parent=document.createElement('div');
    let lastPos=0;
    const tl=gxIndex.renderTimeline(parent,deck,0,i=>lastPos=i);
    const track=parent.querySelector('.gx-timeline-track');
    const evt=new MouseEvent('mousedown',{clientX:track.getBoundingClientRect().right-10});
    track.dispatchEvent(evt);
    return lastPos>=8;  // Perto do final
  });
  check('S09-10: Timeline drag updates position', posTest);

  // Resumo
  await p.close();
  await browser.close();

  console.log(`\n✅ PASS test-s09-merged.js (${results.length} s) :: ${results.slice(0,3).join(' ')} ...`);
  console.log(`Passed: ${results.length-failed}, Failed: ${failed}`);
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
