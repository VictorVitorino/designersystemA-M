/* S28 — Layouts prontos e editáveis: Agenda, Resumo executivo, Painel de indicadores, Roadmap, Comparativo, Próximos passos (Novo slide ▸)
   e “Inserir bloco pronto ▸” (Proposta comercial, Painel executivo, Roadmap de transformação, Apresentação executiva).
   Verifica: os 13 layouts no seletor (cabe na tela a 1280×720), cada layout novo nasce com base e ph (Redefinir), todos os elementos
   dentro do slide, render sem erro (rasterSlide), prévia em PNG (shots/s28-*.png), Redefinir volta a posição, blocos inseridos depois
   do slide atual com um Ctrl+Z, PDF e PowerPoint Editável de um deck com os 13 layouts, salvar/reabrir, menu Slide com o item (um só).
   Uso: python3 assemble.py && node test-s28-layouts.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s28-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s28'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS23=path.join(__dirname,'test-s23-tools.py');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,1000):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const NEW=['agenda','exec','dashboard','roadmap','compare','next'];
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const keys=await p.evaluate(()=>Object.keys(AMStudio.LAYOUTS).filter(k=>!AMStudio.LAYOUTS[k].hidden));
  check('S28-01: 13 layouts visíveis, com os 6 novos (os institucionais do S34 ficam ocultos no seletor)', keys.length===13 && NEW.every(k=>keys.indexOf(k)>=0), keys);
  await p.click('#addSlide'); await sleep(300);
  const pick=await p.evaluate(()=>{ const m=document.getElementById('mSlide'); const r=m.getBoundingClientRect(); return {open:m.classList.contains('open'), n:m.querySelectorAll('button[data-layout]').length, fits:r.bottom<=innerHeight&&r.right<=innerWidth&&r.top>=0, names:[].map.call(m.querySelectorAll('button[data-layout]'),x=>x.textContent.trim())}; });
  check('S28-02: o seletor “Novo slide” lista os 13 e cabe na tela a 1280×720', pick.open && pick.n===13 && pick.fits && /Agenda/.test(pick.names.join('|')) && /Próximos passos/.test(pick.names.join('|')), pick);
  await p.keyboard.press('Escape'); await sleep(150);
  /* cada layout novo: base/ph, dentro do slide, render */
  for (const k of NEW) {
    const r=await p.evaluate(async k=>{ const A=AMStudio; A.addSlide(k); const s=A.deck.slides[A.cur]; const bad=s.els.filter(e=>{ const b=e.type==='line'?{x:Math.min(e.x1,e.x2),y:Math.min(e.y1,e.y2),w:Math.abs(e.x2-e.x1),h:Math.abs(e.y2-e.y1)}:e; return b.x<0||b.y<0||b.x+b.w>1280.5||b.y+b.h>720.5; }).map(e=>e.type+':'+(e.kind||'')); const rr=await AMExport.rasterSlide(s,{scale:1,type:'png'}); const png=rr.canvas.toDataURL('image/png'); rr.canvas.width=0; return {layout:s.layout, base:!!s.base, ph:s.els.every((e,i)=>e.ph==='p'+i), n:s.els.length, bad, png, fail:!!document.querySelector('#wrap .fx-falha')}; }, k);
    fs.writeFileSync(SH(k), Buffer.from(r.png.split(',')[1],'base64'));
    check('S28-'+k+': nasce com base e ph, '+r.n+' elementos dentro do slide, render sem componente com falha', r.layout===k && r.base && r.ph && r.n>=4 && r.bad.length===0 && !r.fail, {n:r.n,bad:r.bad,fail:r.fail});
  }
  /* Redefinir num layout novo */
  const rd=await p.evaluate(()=>{ const A=AMStudio; const s=A.deck.slides[A.cur]; const e=s.els.find(x=>x.type==='text'); const x0=e.x; e.x+=120; A.renderAll(); A.commit(); A.resetSlide(A.cur); return {x0, x:A.deck.slides[A.cur].els.find(x=>x.id===e.id).x}; });
  check('S28-03: Redefinir devolve a posição original no layout novo', rd.x===rd.x0, rd);
  /* blocos prontos */
  await p.evaluate(()=>{ AMStudio.loadDeck(AMStudio.newDeck(),null); }); await sleep(200);
  await p.click('#mbar button[data-m=slide]'); await sleep(250);
  const it=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xm .xi, .xmenu .xi'),x=>x.textContent.trim()));
  check('S28-04: menu Slide tem um só “Inserir bloco pronto”', it.filter(t=>/^Inserir bloco pronto/.test(t)).length===1, it);
  await p.hover('.xmenu .xi:has-text("Inserir bloco pronto"), .xm .xi:has-text("Inserir bloco pronto")').catch(()=>{}); await sleep(350);
  const sub=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xm .xi, .xmenu .xi'),x=>x.textContent.trim()).filter(t=>/slides\)$/.test(t)));
  check('S28-05: submenu com os 4 blocos (+ o institucional do S34, quando existe) e a contagem de slides', (sub.length===4||sub.length===5) && /Proposta comercial \(6 slides\)/.test(sub.join('|')) && /Apresentação executiva \(5 slides\)/.test(sub.join('|')), sub);
  await p.keyboard.press('Escape'); await sleep(150);
  await p.evaluate(()=>AMStudio.insertSeq('proposal')); await sleep(400);
  let d=await D();
  check('S28-06: “Proposta comercial” insere 6 slides depois do atual (capa, agenda, conteúdo, roadmap, comparativo, encerramento); atual = 1º do bloco', d.slides.length===7 && d.slides.slice(1).map(s=>s.layout).join()==='cover,agenda,content,roadmap,compare,closing' && await p.evaluate(()=>AMStudio.cur)===1 && await p.evaluate(()=>document.querySelectorAll('#thumbs .th').length)===7, d.slides.map(s=>s.layout));
  await p.click('#wrap', {position:{x:5,y:5}}); await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await sleep(300); d=await D();
  check('S28-07: um Ctrl+Z tira o bloco inteiro', d.slides.length===1);
  await p.keyboard.press('Control+y'); await sleep(300);
  /* deck com todos os layouts: PDF, PowerPoint, salvar/reabrir */
  await p.evaluate(()=>{ const A=AMStudio; const d=A.newDeck(); d.title='Todos os layouts'; d.slides=Object.keys(A.LAYOUTS).filter(k=>!A.LAYOUTS[k].hidden).map(k=>A.mk.slide(k)); A.loadDeck(d,null); });
  const ex=await p.evaluate(async()=>{ const pdf=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); return pdf.size; });
  check('S28-08: PDF com os 13 layouts', ex>60000, ex);
  const pk=path.join(TMP,'layouts.pptx'); fs.writeFileSync(pk, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  check('S28-09: PowerPoint Editável válido com 13 slides', insp.slides.length===13 && insp.zipBad===null && insp.xmlBad.length===0 && insp.relBad.length===0, {n:insp.slides.length,bad:insp.xmlBad});
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const re=await p.evaluate(dk=>{ const before=AMStudio.deck.slides.map(s=>s.els.length).join(); AMStudio.loadDeck(dk,'re'); return before===AMStudio.deck.slides.map(s=>s.els.length).join() && AMStudio.deck.slides.every(s=>s.base&&s.layout); }, dk);
  check('S28-10: salvar e reabrir mantém elementos, base e layout de todos', re);
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
