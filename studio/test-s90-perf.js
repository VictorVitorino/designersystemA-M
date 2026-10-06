// Orçamento de desempenho do Canteiro — reprova se o sistema ficar pesado.
// Limites com folga porque a bateria roda em paralelo (3 processos). Mede 2 vezes e usa a melhor.
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE=path.join(__dirname,'AM-Studio-Editor.html'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const B={file_kb:2000, /* S34: +≈380 KB das artes dos slides institucionais (jpeg embutido); antes 1700 */load_ms:2000,heap_idle_mb:40,template_ms:1200,drag_avg_ms:22,drag_worst_ms:80,drawer_ms:1500,gallery_ms:1200,export_kb:800,player_load_ms:1500,player_heap_mb:30,leak_mb:25};
let fails=0; const errs=[];
function check(name,ok,v){console.log((ok?'PASS ':'FAIL ')+name+'  '+JSON.stringify(v)); if(!ok)fails++;}
async function measure(){
  const b=await chromium.launch({args:['--enable-precise-memory-info']}); const ctx=await b.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage();
  p.on('pageerror',e=>errs.push(e.message));
  const t0=Date.now(); await p.goto('file://'+FILE+'?nocover',{waitUntil:'load'}); const load_ms=Date.now()-t0; await sleep(400);
  const heap=()=>p.evaluate(()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):0);
  const heap_idle=await heap();
  const tT=Date.now(); await p.evaluate(()=>AMStudio.loadDeck(AMCover.buildTemplate(0),'t')); await sleep(200); const template_ms=Date.now()-tT;
  const el=await p.$('#wrap .am-el'); const bb=await el.boundingBox();
  await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.mouse.down();
  await p.evaluate(()=>{window.__f=[];window.__l=performance.now();window.__run=true;const t=x=>{window.__f.push(x-window.__l);window.__l=x;if(window.__run)requestAnimationFrame(t)};requestAnimationFrame(t)});
  for(let i=1;i<=40;i++) await p.mouse.move(bb.x+bb.width/2+i*4,bb.y+bb.height/2+i*2);
  await p.mouse.up(); const drag=await p.evaluate(()=>{window.__run=false;const f=window.__f.slice(2);return {avg:f.reduce((a,b)=>a+b,0)/f.length,worst:Math.max(...f)}});
  await p.keyboard.press('Control+z');
  const tD=Date.now(); await p.click('#bModels'); await p.waitForSelector('#drawer.open'); await sleep(100); const drawer_ms=Date.now()-tD; await sleep(800);
  const tG=Date.now(); await p.click('#bFx'); await p.waitForSelector('#drawer.open'); await sleep(100); const gallery_ms=Date.now()-tG; await sleep(800);
  await p.keyboard.press('Escape');
  // vazamento: 30 trocas de slide + 10 aberturas da galeria
  const h1=await heap(); for(let i=0;i<30;i++) await p.evaluate(i=>AMStudio.goSlide(i%7),i); for(let i=0;i<10;i++){await p.click('#bFx'); await sleep(60); await p.keyboard.press('Escape'); await sleep(40);} await sleep(600);
  await p.evaluate(()=>{if(window.gc)gc()}); const h2=await heap();
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const out=path.join(__dirname,'.gate','perf-export.html'); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,html);
  const p2=await ctx.newPage(); p2.on('pageerror',e=>errs.push('player: '+e.message)); const t2=Date.now(); await p2.goto('file://'+out,{waitUntil:'load'}); const player_load_ms=Date.now()-t2; await sleep(600);
  const player_heap=await p2.evaluate(()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):0);
  await b.close();
  return {file_kb:Math.round(fs.statSync(FILE).size/1024),load_ms,heap_idle,template_ms,drag_avg:+drag.avg.toFixed(1),drag_worst:+drag.worst.toFixed(1),drawer_ms,gallery_ms,leak_mb:h2-h1,export_kb:Math.round(html.length/1024),player_load_ms,player_heap};
}
(async()=>{
  const a=await measure(), b=await measure(); const m={}; for(const k in a) m[k]=Math.min(a[k],b[k]);
  check('arquivo do editor ≤ '+B.file_kb+' KB', m.file_kb<=B.file_kb, m.file_kb);
  check('abre em ≤ '+B.load_ms+' ms', m.load_ms<=B.load_ms, m.load_ms);
  check('memória em repouso ≤ '+B.heap_idle_mb+' MB', m.heap_idle<=B.heap_idle_mb, m.heap_idle);
  check('carrega um projeto pronto em ≤ '+B.template_ms+' ms', m.template_ms<=B.template_ms, m.template_ms);
  check('arrastar fluido: quadro médio ≤ '+B.drag_avg_ms+' ms, pior ≤ '+B.drag_worst_ms+' ms', m.drag_avg<=B.drag_avg_ms&&m.drag_worst<=B.drag_worst_ms, {avg:m.drag_avg,worst:m.drag_worst});
  check('Biblioteca de modelos abre em ≤ '+B.drawer_ms+' ms', m.drawer_ms<=B.drawer_ms, m.drawer_ms);
  check('Vitrine de efeitos abre em ≤ '+B.gallery_ms+' ms', m.gallery_ms<=B.gallery_ms, m.gallery_ms);
  check('sem vazamento de memória (≤ '+B.leak_mb+' MB após 30 trocas de slide e 10 aberturas)', m.leak_mb<=B.leak_mb, m.leak_mb);
  check('apresentação exportada (7 slides) ≤ '+B.export_kb+' KB', m.export_kb<=B.export_kb, m.export_kb);
  check('apresentação exportada abre em ≤ '+B.player_load_ms+' ms', m.player_load_ms<=B.player_load_ms, m.player_load_ms);
  check('player em memória ≤ '+B.player_heap_mb+' MB', m.player_heap<=B.player_heap_mb, m.player_heap);
  check('Zero erros de página', errs.length===0, errs);
  console.log(fails?('FALHAS: '+fails):'TUDO OK', JSON.stringify(m)); process.exit(fails?1:0);
})().catch(e=>{console.error('ERRO',e);process.exit(2)});
