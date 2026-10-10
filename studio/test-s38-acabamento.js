/* S38 — acabamento dos personagens, sem travamento e sem recurso novo: o gesto do clique só começa com o personagem em repouso (clique durante
   a entrada, a chegada ou outro gesto troca expressão/fala na hora e não corta nada); “Gesto ao clicar” de volta em todos os gatilhos (em laço,
   na virada do ciclo); “ao passar o mouse” estável; guia que já está no ponto de chegada não marcha no lugar; texto dentro do grito e da nuvem;
   estúdio que responde sem redesenhar o editor inteiro (e devolve o foco); prévia preservada ao trocar o personagem de um grupo.
   Uso: python3 assemble.py && node test-s38-acabamento.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const TMP=path.join(__dirname,'.gate','s38'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,900):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  /* ---------- 1. apresentação ---------- */
  const ids=await p.evaluate(()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null); A.addSlide('blank-light'); A.addSlide('blank-light'); A.goSlide(0);
    const mk=(v,x,y,w,h,d,an)=>{ const z=A.insertFx('persona',null,null,v); z.x=x; z.y=y; z.w=w; z.h=h; Object.assign(z.data,{bubble:'none'},d); if(an) z.anim=Object.assign({},z.anim||{},an); return z; };
    const e=mk('eng',20,40,220,300,{act:'comemorar',trig:'in',act2:'pular',mood2:'surpreso'},{in:'none',dur:700,delay:600});   /* entrada do movimento começa ~750 ms depois */
    const k=mk('mestre',260,40,220,300,{act:'parado',trig:'in',act2:'comemorar',mood2:'animado'},{in:'none'});
    const h=mk('analista',520,40,240,320,{act:'pular',trig:'hover',act2:'none'},{in:'none'});
    const g=mk('consultora',900,380,220,300,{act:'parado',trig:'in',grp:'gS38',walk:''},{in:'none'});
    A.goSlide(1); const g2=JSON.parse(JSON.stringify(g)); g2.id='gS38b'; g2.x=40; g2.data.walk=900; A.deck.slides[1].els.push(g2);   /* no slide 2 ele anda de 40 até 900 */
    A.selectMany([]); A.renderAll(); A.commit(); return {e:e.id, k:k.id, h:h.id, g:g.id, g2:g2.id}; });
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const hp=path.join(TMP,'s38.html'); fs.writeFileSync(hp,html);
  const idw=await p.evaluate(()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null); const w=A.insertFx('persona',null,null,'dev'); w.x=20; w.y=380; w.w=200; w.h=280; Object.assign(w.data,{bubble:'none',walk:300,act:'acenar',trig:'click'}); w.anim=Object.assign({},w.anim||{},{in:'none'}); A.renderAll(); A.commit(); return {w:w.id}; });
  const hpw=path.join(TMP,'s38w.html'); fs.writeFileSync(hpw, await p.evaluate(()=>AMStudio.exportHTML()));
  const v=await open(ctx,'file://'+hp,'player'); const Q=(id,sel)=>'.amp-slide.on .am-el[data-id="'+id+'"] '+(sel||'.pz');
  const clickChar=id=>v.evaluate(sel=>{ const c=document.querySelector(sel), r=c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height*.6})); }, Q(id,'.pz-char'));
  /* clique durante a entrada: nada é cortado (mesma animação continua), a expressão muda; depois da entrada, o gesto toca */
  await sleep(250);
  const e0=await v.evaluate(sel=>{ const a=document.querySelector(sel).getAnimations()[0]; window.__e0=a; return {an:a&&a.animationName, st:a&&a.playState}; }, Q(ids.e,'.pz-aR'));
  await clickChar(ids.e); await sleep(80);
  const e1=await v.evaluate(([sel,pzs])=>{ const a=document.querySelector(sel).getAnimations()[0], pz=document.querySelector(pzs); return {same:a===window.__e0, an:a&&a.animationName, go:pz.classList.contains('pz-go'), done:pz.classList.contains('pz-done'), mood:pz.dataset.mood}; }, [Q(ids.e,'.pz-aR'),Q(ids.e)]);
  await v.waitForFunction(sel=>!document.querySelector(sel).getAnimations({subtree:true}).some(a=>a.playState==='running'&&a.animationName!=='pzNone'&&isFinite(a.effect.getComputedTiming().endTime)&&!(a instanceof CSSTransition)), Q(ids.e), {timeout:8000}).catch(()=>{});
  await clickChar(ids.e); await sleep(120);
  const e2=await v.evaluate(sel=>{ const pz=document.querySelector(sel); return {go:pz.classList.contains('pz-go'), an:getComputedStyle(pz.querySelector('.pz-char')).animationName}; }, Q(ids.e));
  check('S38-01: clique durante a entrada (“Ao entrar”): a entrada continua inteira (a mesma animação, sem pz-done nem gesto por cima) e a expressão muda na hora; terminada a entrada, o clique toca o gesto',
    e0.an==='pzCheerR' && e1.same && e1.an==='pzCheerR' && !e1.go && !e1.done && e1.mood==='surpreso' && e2.go && e2.an==='pzJumpG', {e0, e1, e2});
  /* segundo clique durante o gesto: não recomeça (o gesto segue o mesmo) */
  await clickChar(ids.k); await sleep(200);
  const k0=await v.evaluate(sel=>{ const a=document.querySelector(sel).getAnimations()[0]; window.__k0=a; return {an:a&&a.animationName, t:a&&a.currentTime}; }, Q(ids.k,'.pz-aR'));
  await clickChar(ids.k); await sleep(150);
  const k1=await v.evaluate(sel=>{ const a=document.querySelector(sel).getAnimations()[0]; return {same:a===window.__k0, an:a&&a.animationName, t:a&&a.currentTime}; }, Q(ids.k,'.pz-aR'));
  check('S38-02: segundo clique durante o gesto: o gesto não recomeça do zero (a mesma animação segue adiante)', /G$/.test(k0.an) && k1.same && k1.t>k0.t, {k0, k1});
  /* clique durante a pose de chegada (“Andar até” + “Só ao clicar”): a pose termina; nada salta */
  const vw=await open(ctx,'file://'+hpw,'player-w');
  await vw.waitForFunction(sel=>document.querySelector(sel).classList.contains('pz-pose'), Q(idw.w), {timeout:8000, polling:10}).catch(()=>{});
  const w0=await vw.evaluate(sel=>({pose:document.querySelector(sel).classList.contains('pz-pose')}), Q(idw.w));
  await vw.evaluate(sel=>{ const c=document.querySelector(sel), r=c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height*.6})); }, Q(idw.w,'.pz-char')); await sleep(60);
  const w1=await vw.evaluate(sel=>{ const pz=document.querySelector(sel); return {pose:pz.classList.contains('pz-pose'), go:pz.classList.contains('pz-go'), an:getComputedStyle(pz.querySelector('.pz-aR')).animationName}; }, Q(idw.w)); await vw.close();
  check('S38-03: clique durante a pose de chegada: a pose termina normalmente (pzPoseR), sem gesto cortando no meio', w0.pose && w1.pose && !w1.go && w1.an==='pzPoseR', {w0, w1});
  /* ao passar o mouse + pular: o mouse parado perto dos pés não faz o boneco piscar */
  const hb=await v.evaluate(sel=>{ const r=document.querySelector(sel).getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height*.88}; }, Q(ids.h,'.pz-svg'));
  await v.mouse.move(hb.x,hb.y); await sleep(200);
  const hv=await v.evaluate(async sel=>{ const pz=document.querySelector(sel); let flips=0, last=pz.matches(':hover'); const t0=performance.now(); let jumps=0;
    while(performance.now()-t0<2200){ await new Promise(r=>requestAnimationFrame(r)); const h=pz.matches(':hover'); if(h!==last){ flips++; last=h; } if(/^pzJump/.test(getComputedStyle(pz.querySelector('.pz-char')).animationName)) jumps++; }
    return {flips, hover:last, jumping:jumps>0}; }, Q(ids.h));
  await v.mouse.move(5,5);
  check('S38-04: “Ao passar o mouse” + pular, mouse parado perto dos pés: o estado de mouse não pisca (o quadro do desenho recebe o ponteiro, o boneco pula por dentro dele)', hv.flips===0 && hv.hover && hv.jumping, hv);
  /* guia: do slide 2 (chegou em 900) de volta ao slide 1 (está em 900): não marcha no lugar */
  await v.keyboard.press('ArrowRight'); await sleep(150);
  const gb=await v.evaluate(sel=>{ const pz=document.querySelector(sel), r=pz.querySelector('.pz-svg').getBoundingClientRect(); return {here:pz.classList.contains('pz-here'), arr:pz.classList.contains('pz-arr'), from:pz.classList.contains('pz-from'), legs:getComputedStyle(pz.querySelector('.pz-leg')).animationName, x:Math.round(r.x)}; }, Q(ids.g2));
  await sleep(800); const gx2=await v.evaluate(sel=>Math.round(document.querySelector(sel).querySelector('.pz-svg').getBoundingClientRect().x), Q(ids.g2));
  check('S38-05: personagem guia que já está onde o “Andar até” do slide seguinte o levaria: chega na hora, sem marchar no lugar (sem caminhada, parado no mesmo ponto)', gb.here && gb.arr && !gb.from && !/pzLeg/.test(gb.legs) && Math.abs(gb.x-gx2)<3, Object.assign(gb,{gx2}));
  await v.close();
  /* ---------- 2. texto dentro do grito e da nuvem ---------- */
  const LONG='Este cronograma mostra as entregas de cada frente da obra, com os marcos de medição, o caminho crítico e as folgas que ainda temos para absorver chuvas e atrasos.';
  const shapes=await p.evaluate(async LONG=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null); const out=[];
    for(const [bub,w,h,side] of [['grita',520,290,'auto'],['grita',400,400,'top'],['grita',557,180,'left'],['pensa',520,290,'top'],['pensa',300,380,'auto']]){
      const z=A.insertFx('persona',null,null,'eng'); z.x=200; z.y=100; z.w=w; z.h=h; Object.assign(z.data,{bubble:bub,side,say:LONG,act:'parado'}); A.selectMany([]); A.renderAll(); await new Promise(r=>setTimeout(r,80));
      const pz=document.querySelector('#cv .am-edit .am-el[data-id="'+z.id+'"] .pz'), say=pz.querySelector('.pz-say'), bx=say.getBoundingClientRect();
      let poly=null; if(bub==='grita') poly=(getComputedStyle(say).clipPath.match(/polygon\((.*)\)/)||[])[1].split(',').map(q=>q.trim().split(/\s+/).map(x=>parseFloat(x)/100));
      const inside=(x,y)=>{ const u=(x-bx.x)/bx.width, v=(y-bx.y)/bx.height; if(!poly) return Math.pow((u-.5)/.5,2)+Math.pow((v-.5)/.5,2)<=1; let c=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const [xi,yi]=poly[i],[xj,yj]=poly[j]; if(((yi>v)!=(yj>v))&&(u<(xj-xi)*(v-yi)/(yj-yi)+xi)) c=!c; } return c; };
      const rg=document.createRange(); rg.selectNodeContents(pz.querySelector('.pz-s1 .pz-txt')); const rs=[...rg.getClientRects()].filter(x=>x.width>2);
      out.push({bub,w,h,side,over:pz.classList.contains('pz-over'),lines:rs.length,out:rs.filter(x=>![[x.left+1,x.top+2],[x.right-1,x.top+2],[x.left+1,x.bottom-2],[x.right-1,x.bottom-2]].every(([a,b])=>inside(a,b))).length});
      A.deck.slides[0].els.splice(A.deck.slides[0].els.indexOf(z),1); }
    A.renderAll(); return out; }, LONG);
  check('S38-06: texto que cabe no grito e na nuvem fica dentro da forma (cantos de cada linha dentro da estrela/elipse)', shapes.filter(s=>!s.over).length>=4 && shapes.filter(s=>!s.over).every(s=>s.out===0&&s.lines>0), shapes);
  /* ---------- 3. estúdio sem travamento ---------- */
  const perf=await p.evaluate(async()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null);
    for(let i=1;i<40;i++){ A.addSlide(['blank-light','title','bullets','two-col'][i%4]||'blank-light'); ['bars','counter','donut'].forEach(k=>{ try{ A.insertFx(k); }catch(e){} }); }
    A.goSlide(0); const z=A.insertFx('persona',null,null,'eng'); A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,300));
    const ra0=performance.now(); A.renderAll(); const full=performance.now()-ra0; await new Promise(r=>setTimeout(r,120));
    const marks=[...document.querySelectorAll('#thumbs .th .box .am-stage')]; marks.forEach(n=>n.__s38=1); /* miniaturas marcadas: as que forem redesenhadas perdem a marca */
    const tile=document.querySelector('#props .pzs [data-pzs="outfit"][data-v="jaleco"]'); tile.focus(); const t0=performance.now(); tile.click(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const click=performance.now()-t0;
    const now=[...document.querySelectorAll('#thumbs .th .box .am-stage')], kept=now.filter(n=>n.__s38).length;
    const f=document.activeElement; return {click:Math.round(click), full:Math.round(full), thumbs:now.length, kept, focus:!!(f&&f.closest&&f.closest('.pzs')&&f.dataset.v==='jaleco'), outfit:A.deck.slides[0].els.find(e=>e.id===z.id).data.outfit}; });
  check('S38-07: num deck de 40 slides, escolher a roupa no estúdio redesenha só o personagem, o painel e a miniatura do slide atual (as outras 39 miniaturas ficam intactas), responde rápido (teto folgado de 400 ms, mesmo com o portão em paralelo) e o foco fica na miniatura clicada', perf.outfit==='jaleco' && perf.thumbs===40 && perf.kept===39 && perf.click<400 && perf.focus, perf);
  const pv=await p.evaluate(async()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null); A.addSlide('blank-light'); A.goSlide(0); const z=A.insertFx('persona',null,null,'eng'); A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,150));
    document.querySelector('#props .pzs [data-pzs-tab="lig"]').click(); await new Promise(r=>setTimeout(r,100)); document.querySelector('#props .pzs [data-pzs-slide="1"]').click(); await new Promise(r=>setTimeout(r,200));
    document.querySelector('#props .pzs [data-var="mestre"]').click(); await new Promise(r=>setTimeout(r,250));
    const open=!!document.querySelector('.prevov'), other=A.deck.slides[1].els.find(e=>e.kind==='persona'); return {open, v:other&&other.variant}; });
  check('S38-08: trocar o personagem de um grupo pelo elenco abre a prévia e ela não é cortada; a cópia do outro slide troca junto', pv.open && pv.v==='mestre', pv);
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
