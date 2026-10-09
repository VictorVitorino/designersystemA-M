/* S35 — Personagens A&M (rt-70-personas.js/.css + ed-46-personas.js): bonecos no estilo dos mascotes, na paleta A&M, com roupa,
   ferramenta, expressão e movimento trocáveis; balão de fala (fala, pensamento, grito, nota) com decisões; apontar para um
   elemento; andar até um X; na apresentação os olhos seguem o mouse, o clique reage e acende o alvo, os botões de decisão
   navegam. Editor: Inserir › Personagens ▸, painel (presets como variantes, partes, “Aponta para” dinâmico), edição no lugar,
   mira ao mover, vitrine, raster/PDF, Ctrl+Z, salvar/reabrir, balão solto preso a conector.
   Uso: python3 assemble.py && node test-s35-personagens.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s35-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s35'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
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
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const wb=await (await p.$('#wrap')).boundingBox(); const L=(x,y)=>({x:wb.x+x/1280*wb.width, y:wb.y+y/720*wb.height});
  /* ---------- 1. registro e menu ---------- */
  const reg=await p.evaluate(()=>{ const R=AMRT, P=R.personas; return {persona:!!R.FX.persona, bubble:!!R.FX.bubble, cat:R.FX.persona.cat+'|'+R.FX.bubble.cat, variants:R.FX.persona.variants.map(v=>v[0]).join(','), presets:P.PRESETS.map(x=>x[0]).join(','),
    hats:Object.keys(P.HATS).length, hairs:Object.keys(P.HAIRS).length, outfits:Object.keys(P.OUTFITS).length, tools:Object.keys(P.TOOLS).length, glasses:Object.keys(P.GLASSES).length, moods:Object.keys(P.MOODS).length, acts:P.ACTS.length, trigs:P.TRIGS.length, gal:R.FX.persona.gal, vtitle:R.FX.persona.vtitle}; });
  check('S35-01: AMRT.FX.persona e FX.bubble (categoria Personagens); 10 presets como variantes; 7 chapéus, 5 cabelos, 7 roupas, 12 ferramentas, 4 óculos, 8 expressões, 10 movimentos, 4 gatilhos', reg.persona && reg.bubble && reg.cat==='Personagens|Personagens' && reg.variants===reg.presets && reg.variants.split(',').length===10 && reg.hats===7 && reg.hairs===5 && reg.outfits===7 && reg.tools===12 && reg.glasses===4 && reg.moods===8 && reg.acts===10 && reg.trigs===4 && reg.gal==='one' && reg.vtitle==='Personagem', reg);
  await p.click('#mbar button[data-m=insert]'); await sleep(250);
  const ins=await p.evaluate(()=>[...document.querySelectorAll('.xmenu')][0] && [...[...document.querySelectorAll('.xmenu')][0].querySelectorAll('.xi')].map(x=>x.textContent.trim()));
  await p.hover('.xmenu .xi:has-text("Personagens")'); await sleep(350);
  const sub=await p.evaluate(()=>{ const ms=[...document.querySelectorAll('.xmenu')]; return [...ms[ms.length-1].querySelectorAll('.xi')].map(x=>x.textContent.trim()); });
  check('S35-02: Inserir › Personagens ▸ lista os 10 do elenco e “Balão de fala”; Inserir mantém um só item com “forma” e Título/Subtítulo/Texto corrido no início', ins && ins.slice(0,3).join('|')==='Título|Subtítulo em destaque|Texto corrido' && ins.filter(t=>/forma/i.test(t)).length===1 && ins.includes('Personagens') && sub.join('|')==='Engenheira de obra|Mestre de obras|Desenvolvedor|Desenvolvedora|Agente de IA|Consultora|Consultor|Analista de dados|Cientista de dados|Apresentador|Balão de fala', {ins, sub});
  await p.evaluate(()=>{ [...document.querySelectorAll('.xmenu .xi')].find(x=>x.textContent.trim()==='Mestre de obras').click(); }); await sleep(450);
  let d=await D(); let el=d.slides[0].els.find(e=>e.kind==='persona');
  const st1=await p.evaluate(()=>{ const z=document.querySelector('#cv .am-edit .pz'); const r=AMRT.personas.resolve(AMStudio.deck.slides[0].els[0].data, AMStudio.deck.slides[0].els[0]); return {ia:z.classList.contains('am-ia'), act:z.dataset.act, mood:z.dataset.mood, trig:z.dataset.trig, hat:!!z.querySelector('.pz-hat'), tool:!!z.querySelector('.pz-aR g[transform]'), say:(z.querySelector('.pz-say .pz-txt[data-e=say]')||{}).textContent, r, mouth:getComputedStyle(z.querySelector('.pz-mouth[data-m=feliz]')).display, mouthX:getComputedStyle(z.querySelector('.pz-mouth[data-m=triste]')).display, ch:getComputedStyle(z.querySelector('.pz-aR')).animationName, toast:(document.getElementById('toast')||{}).textContent||''}; });
  check('S35-03: inserir pelo menu cria o personagem (300×380, variante mestre) com capacete laranja, martelo, expressão feliz, acenar ao entrar, balão “Olá! Vamos ao plano.”, .am-ia; no palco de edição nada anima e só a boca da expressão aparece', !!el && el.w===300 && el.h===380 && el.variant==='mestre' && st1.ia && st1.act==='acenar' && st1.mood==='feliz' && st1.trig==='in' && st1.hat && st1.tool && st1.say==='Olá! Vamos ao plano.' && st1.r.hat==='capO' && st1.r.tool==='martelo' && st1.mouth==='inline' && st1.mouthX==='none' && st1.ch==='pzNone' && /Personagem inserido/.test(st1.toast), {el:el&&{w:el.w,h:el.h,v:el.variant}, st1});
  /* ---------- 2. painel ---------- */
  const pan=await p.evaluate(()=>{ const P=document.getElementById('props'); const sel=k=>P.querySelector('select[data-p="data.'+k+'"]'); return {h2:(P.querySelector('h2')||{}).textContent||'', chips:[...P.querySelectorAll('[data-var]')].map(c=>c.textContent), on:(P.querySelector('[data-var].on')||{}).dataset, sels:['hat','hair','lashes','glasses','outfit','tool','c1','c2','mood','act','trig','dir','look','bubble','side','bcol','mood2','act2','aim'].filter(k=>!sel(k)), say:!!P.querySelector('textarea[data-p="data.say"]'), ch:!!P.querySelector('textarea[data-p="data.choices"]'), walk:!!P.querySelector('input[data-p="data.walk"]'), help:P.querySelectorAll('.fhelp').length, aim0:(sel('aim')||{options:[]}).options[0]&&sel('aim').options[0].textContent, hat0:sel('hat').options[0].textContent, pal:!!P.querySelector('[data-p="pal.p"],[data-set^="pal"]'), pill:(document.getElementById('fxArrow')||{}).textContent||''}; });
  check('S35-04: painel: “Personagem · Mestre de obras”, seção Personagem com os 10 presets (mestre ativo), seletores de todas as partes/movimento/gatilho/balão/alvo (“Nenhum”, “Do personagem”), fala e decisões, Andar até, 2 ajudas; pill no quadro “Personagem: Mestre de obras”', /Personagem · Mestre de obras/.test(pan.h2) && pan.chips.length===10 && pan.on && pan.on.var==='mestre' && pan.sels.length===0 && pan.say && pan.ch && pan.walk && pan.help===2 && pan.aim0==='Nenhum' && pan.hat0==='Do personagem' && /Personagem: Mestre de obras/.test(pan.pill), pan);
  await p.screenshot({path:SH('editor')});
  await p.click('#props [data-var="ia"]'); await sleep(350);
  const v2=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0]; const z=document.querySelector('#cv .am-edit .pz'); return {v:e.variant, r:AMRT.personas.resolve(e.data,e), led:!!z.querySelector('.pz-hat .pz-led'), visor:!!z.querySelector('.pz-vs'), h2:document.querySelector('#props h2').textContent}; });
  await p.keyboard.press('Control+z'); await sleep(250);
  const v3=await p.evaluate(()=>({v:AMStudio.deck.slides[0].els[0].variant, hat:!!document.querySelector('#cv .am-edit .pz .pz-hat .pz-or')}));
  check('S35-05: trocar o preset pelas fichas (Agente de IA) muda antena, visor, circuito e chip no palco e o nome no painel; um Ctrl+Z volta ao mestre', v2.v==='ia' && v2.r.hat==='antena' && v2.r.glasses==='visor' && v2.r.outfit==='circuito' && v2.r.tool==='chip' && v2.led && v2.visor && /Agente de IA/.test(v2.h2) && v3.v==='mestre' && v3.hat, {v2,v3});
  await p.selectOption('#props select[data-p="data.hat"]','capN'); await sleep(300);
  await p.selectOption('#props select[data-p="data.mood"]','surpreso'); await sleep(300);
  await p.selectOption('#props select[data-p="data.tool"]','laptop'); await sleep(300);
  const ov=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0]; const z=document.querySelector('#cv .am-edit .pz'); return {hat:e.data.hat, r:AMRT.personas.resolve(e.data,e), mood:z.dataset.mood, navy:!!z.querySelector('.pz-hat .pz-n'), o:getComputedStyle(z.querySelector('.pz-mouth[data-m=surpreso]')).display, hist:AMStudio.deck.slides[0].els[0].data.tool}; });
  await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); await sleep(300);
  const ov2=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0]; return {hat:e.data.hat||'', mood:e.data.mood||'', tool:e.data.tool||''}; });
  check('S35-06: cada parte sobrepõe o preset (capacete navy, surpreso, notebook) e redesenha; três Ctrl+Z devolvem “Do personagem” em todas', ov.hat==='capN' && ov.r.hat==='capN' && ov.r.tool==='laptop' && ov.mood==='surpreso' && ov.navy && ov.o==='inline' && ov.hist==='laptop' && ov2.hat==='' && ov2.mood==='' && ov2.tool==='', {ov,ov2});
  /* edição no lugar da fala */
  const sp=await p.$('#cv .am-edit .pz .pz-txt[data-e=say]'); const sb=await sp.boundingBox();
  await p.mouse.dblclick(sb.x+sb.width/2, sb.y+sb.height/2); await sleep(250); await p.keyboard.press('Control+a'); await p.keyboard.type('Bom dia, comitê'); await p.keyboard.press('Enter'); await sleep(350);
  d=await D(); el=d.slides[0].els[0];
  check('S35-07: duplo clique na fala edita no lugar; Enter grava data.say e o balão redesenha', el.data.say==='Bom dia, comitê' && await p.evaluate(()=>document.querySelector('#cv .am-edit .pz .pz-txt[data-e=say]').textContent==='Bom dia, comitê'), el.data.say);
  await p.evaluate(()=>AMStudio.selectMany([AMStudio.deck.slides[0].els[0].id])); await p.keyboard.press('Control+d'); await sleep(300); d=await D();
  check('S35-08: Ctrl+D duplica o personagem com variante e fala', d.slides[0].els.length===2 && d.slides[0].els[1].kind==='persona' && d.slides[0].els[1].variant==='mestre' && d.slides[0].els[1].data.say==='Bom dia, comitê', d.slides[0].els.map(e=>e.variant));
  await p.keyboard.press('Control+z'); await sleep(200);
  /* ---------- 3. mira num gráfico ---------- */
  const aim=await p.evaluate(()=>{ const A=AMStudio; const pz=A.deck.slides[0].els[0]; pz.x=40; pz.y=160; const ch=A.insertFx('bars'); ch.x=560; ch.y=120; ch.w=680; ch.h=330; pz.data.aim=ch.id; pz.data.act='apontar'; A.selectMany([pz.id]); A.renderAll(); A.commit();
    const z=document.querySelector('#cv .am-edit .pz'); const opts=[...document.querySelector('#props select[data-p="data.aim"]').options].map(o=>o.textContent+'='+o.value); const aim=z.style.getPropertyValue('--aim');
    return {face:z.dataset.face, aim, ok:/^-?\d+(\.\d+)?deg$/.test(aim)&&parseFloat(aim)<-60&&parseFloat(aim)>-140, rot:getComputedStyle(z.querySelector('.pz-aR')).rotate, fing:getComputedStyle(z.querySelector('.pz-fing')).display, opts, sel:document.querySelector('#props select[data-p="data.aim"]').value===ch.id, thumb:(document.querySelector('#thumbs .th[data-i="0"] .pz')||{}).dataset}; });
  check('S35-09: “Aponta para” lista o gráfico do slide e fica selecionado; o braço aponta para ele (mira entre −140° e −60°, dedo visível), olhando para a direita; a miniatura recebe a mesma mira', aim.sel && aim.opts.some(o=>/Gráfico de barras/.test(o)) && aim.face==='r' && aim.ok && aim.fing==='inline' && /deg/.test(aim.rot) && aim.thumb && aim.thumb.face==='r', aim);
  /* arrastar o gráfico para a esquerda do personagem: a mira vira (pointerup re-mira sem redesenhar) */
  const chB=await p.evaluate(()=>{ const ch=AMStudio.deck.slides[0].els.find(e=>e.kind==='bars'); const pz=AMStudio.deck.slides[0].els[0]; pz.x=900; AMStudio.renderAll(); AMStudio.commit(); return {x:ch.x+ch.w/2,y:ch.y+ch.h/2}; });
  const from=L(chB.x,chB.y), to=L(chB.x-480,chB.y+200);
  await p.evaluate(()=>AMStudio.selectMany([AMStudio.deck.slides[0].els.find(e=>e.kind==='bars').id]));
  await p.mouse.move(from.x,from.y); await p.mouse.down(); await p.mouse.move(from.x+30,from.y+20,{steps:3}); await p.mouse.move(to.x,to.y,{steps:12}); await p.mouse.up(); await sleep(250);
  const aim2=await p.evaluate(()=>{ const z=document.querySelector('#cv .am-edit .pz'); const ch=AMStudio.deck.slides[0].els.find(e=>e.kind==='bars'); return {face:z.dataset.face, aim:parseFloat(z.style.getPropertyValue('--aim')), chx:ch.x, flipped:getComputedStyle(z.querySelector('.pz-svg')).transform!=='none'}; });
  check('S35-10: arrastar o gráfico para a esquerda e para baixo vira o personagem (olha para a esquerda, SVG espelhado) e reaponta sem redesenhar o palco', aim2.face==='l' && aim2.flipped && aim2.chx<400 && aim2.aim<0 && aim2.aim>-90, aim2);
  /* ---------- 4. vitrine, raster, PDF, export ---------- */
  const gal=await p.evaluate(()=>{ const it=AMStudio.gallery.items(); const cmp=it.filter(i=>i.fam==='cmp').length, kinds=Object.keys(AMRT.FX).filter(k=>!AMRT.FX[k].model).length; return {pz:it.find(i=>i.id==='cmp:persona'), bb:it.find(i=>i.id==='cmp:bubble'), cmp, kinds}; });
  check('S35-11: a vitrine de efeitos tem uma caixa “Personagem A&M” e uma “Balão de fala” (categoria Personagens), uma por componente', !!gal.pz && gal.pz.cat==='Personagens' && !!gal.bb && gal.cmp===gal.kinds, gal);
  const r1=await p.evaluate(async()=>{ const rr=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1,type:'png'}); const png=rr.canvas.toDataURL('image/png'); rr.canvas.width=0; return {png, fail:!!document.querySelector('#amxHost .fx-falha')}; });
  fs.writeFileSync(SH('raster'), Buffer.from(r1.png.split(',')[1],'base64'));
  const pdf=await p.evaluate(async()=>{ const bl=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); return bl.size; });
  check('S35-12: o slide com personagem e gráfico sai como imagem (raster sem falha) e em PDF', !r1.fail && pdf>20000, {fail:r1.fail, pdf});
  /* ---------- 5. deck de apresentação ---------- */
  const ids=await p.evaluate(()=>{ const A=AMStudio; const dk=A.newDeck(); dk.title='Personagens'; A.loadDeck(dk,null);
    const ch=A.insertFx('bars'); ch.x=560; ch.y=90; ch.w=680; ch.h=330;
    const a=A.insertFx('persona',null,null,'consultora'); a.x=40; a.y=60; a.w=480; a.h=330; Object.assign(a.data,{act:'apontar',aim:ch.id,say:'Veja a barra de Finanças.',say2:'Foi o maior salto do ano!',mood2:'animado',act2:'pular',side:'top'});
    const bb=A.insertFx('persona',null,null,'ia'); bb.x=40; bb.y=400; bb.w=520; bb.h=300; Object.assign(bb.data,{act:'comemorar',trig:'loop',bubble:'pensa',side:'right',say:'O modelo aprende sozinho?',choices:[{t:'Sim',go:2,m:'animado'},{t:'Não',go:0,m:'preocupado'}]});
    const c=A.insertFx('persona',null,null,'dev'); c.x=960; c.y=430; c.w=300; c.h=270; Object.assign(c.data,{act:'falar',trig:'hover',bubble:'grita',bcol:'laranja',say:'Deploy!',side:'top',dir:'l'});
    const sb=A.insertFx('bubble'); sb.x=600; sb.y=440; sb.w=300; sb.h=110; sb.data.text='Balão solto'; sb.data.tail='bc';
    const ln=A.mk.line(true,false); ln.x1=750; ln.y1=560; ln.x2=400; ln.y2=620; ln.a1={id:sb.id,s:'s'}; ln.a2={id:bb.id,s:'e'}; A.deck.slides[0].els.push(ln);
    A.addSlide('blank-dark'); const w=A.insertFx('persona',null,null,'eng'); w.x=40; w.y=200; w.w=260; w.h=330; Object.assign(w.data,{walk:900,say:'Vou até lá.',act:'andar'});
    const k=A.insertFx('persona',null,null,'apresentador'); k.x=1000; k.y=200; k.w=260; k.h=330; Object.assign(k.data,{act:'acenar',trig:'click',bubble:'none',look:'0'});
    A.goSlide(0); A.selectMany([]); A.renderAll(); A.commit(); const s=A.deck.slides[0]; return {chart:ch.id, a:a.id, b:bb.id, c:c.id, sb:sb.id, ln:s.els.find(e=>e.type==='line'), sbx:sb.x+sb.w/2, sby:sb.y+sb.h, bx:bb.x+bb.w, by:bb.y+bb.h/2, w:w.id, k:k.id}; });
  check('S35-13: linha presa ao balão solto (embaixo) e ao personagem (direita) recebe as pontas calculadas no desenho', ids.ln && ids.ln.x1===Math.round(ids.sbx) && ids.ln.y1===Math.round(ids.sby) && ids.ln.x2===Math.round(ids.bx) && ids.ln.y2===Math.round(ids.by), ids.ln);
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const hp=path.join(TMP,'pz.html'); fs.writeFileSync(hp, html);
  check('S35-14: o arquivo exportado leva rt-70-personas (JS e CSS) e não contém onerror/onmouseover/onclick (CR-04)', /rt-70-personas\.js/.test(html) && /rt-70-personas\.css/.test(html) && /\.pz-say\{/.test(html) && !/onerror|onmouseover|onclick/i.test(html));
  /* ---------- 6. apresentação ---------- */
  const q=await open(ctx,'file://'+hp,'player'); await sleep(1800);
  const pl=await q.evaluate(ids=>{ const z=id=>document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); const A=z(ids.a), B=z(ids.b), C=z(ids.c); const cs=(n,s)=>getComputedStyle(n.querySelector(s));
    return {n:document.querySelectorAll('.amp-slide.on .pz').length, aR:cs(A,'.pz-aR').animationName, aN:cs(A,'.pz-aR').animationIterationCount, aim:A.style.getPropertyValue('--aim'), face:A.dataset.face,
      bR:cs(B,'.pz-aR').animationName, bN:cs(B,'.pz-aR').animationIterationCount, bC:cs(B,'.pz-char').animationName, conf:cs(B,'.pz-conf').display, bChs:B.querySelectorAll('.pz-ch').length, bPensa:!!B.querySelector('.pz-say-pensa'),
      cM:cs(C,'.pz-mouth[data-m=focado]').animationName, cFace:C.dataset.face, cGrita:!!C.querySelector('.pz-say-grita'), cTxt:getComputedStyle(C.querySelector('.pz-say-grita')).color, cBg:getComputedStyle(C.querySelector('.pz-say-grita')).backgroundColor,
      lid:cs(A,'.pz-lid').animationName, led:getComputedStyle(B.querySelector('.pz-hat .pz-led')).animationName, s1:getComputedStyle(A.querySelector('.pz-s1')).display, s2:getComputedStyle(A.querySelector('.pz-s2')).display}; }, ids);
  check('S35-15: player: 3 personagens; A aponta uma vez (pzPoint ×1, mira para o gráfico, olha à direita); B comemora sem parar (pzCheer ∞, pula, confete); C espera o mouse (boca parada), olha à esquerda, grito laranja com texto navy legível; pálpebras piscam, antena da IA pulsa; só a fala 1 aparece', pl.n===3 && pl.aR==='pzPoint' && pl.aN==='1' && /deg/.test(pl.aim) && pl.face==='r' && pl.bR==='pzCheerR' && pl.bN==='infinite' && pl.bC==='pzHop' && pl.conf==='inline' && pl.bChs===2 && pl.bPensa && pl.cM==='pzNone' && pl.cFace==='l' && pl.cGrita && pl.cTxt==='rgb(0, 42, 70)' && pl.cBg==='rgb(247, 140, 22)' && pl.lid==='pzBlink' && pl.led==='pzLed' && pl.s1!=='none' && pl.s2==='none', pl);
  await q.screenshot({path:SH('player')});
  const eyeA=await q.evaluate(id=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz-eyes').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; }, ids.a);
  await q.mouse.move(eyeA.x-300, eyeA.y); await sleep(250); const lx1=await q.evaluate(id=>parseFloat(document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz').style.getPropertyValue('--lx')), ids.a);
  await q.mouse.move(eyeA.x+300, eyeA.y+200); await sleep(250); const lx2=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); return {lx:parseFloat(z.style.getPropertyValue('--lx')), ly:parseFloat(z.style.getPropertyValue('--ly')), tr:getComputedStyle(z.querySelector('.pz-pupils')).translate}; }, ids.a);
  check('S35-16: os olhos seguem o mouse: à esquerda as pupilas vão para a esquerda (−lx), à direita e abaixo vão para a direita e para baixo (translate das pupilas acompanha)', lx1<-3 && lx2.lx>3 && lx2.ly>1 && /px/.test(lx2.tr), {lx1,lx2});
  const cC=await q.evaluate(id=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz-svg').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; }, ids.c);
  await q.mouse.move(cC.x,cC.y); await sleep(200);
  const hv=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); const cs=getComputedStyle(z.querySelector('.pz-mouth[data-m=focado]')); return {m:cs.animationName, n:cs.animationIterationCount}; }, ids.c);
  await q.mouse.move(cC.x,cC.y-300); await sleep(200);
  const hv2=await q.evaluate(id=>getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz .pz-mouth[data-m=focado]')).animationName, ids.c);
  check('S35-17: “ao passar o mouse”: a boca fala (pzTalk ∞) só enquanto o cursor está em cima', hv.m==='pzTalk' && hv.n==='infinite' && hv2==='pzNone', {hv,hv2});
  const cA=await q.evaluate(id=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz-svg').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height*.7}; }, ids.a);
  await q.mouse.click(cA.x,cA.y); await sleep(200);
  const ck=await q.evaluate(ids=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+ids.a+'"] .pz'); const t=document.querySelector('.amp-slide.on .am-el[data-id="'+ids.chart+'"]'); return {on:z.classList.contains('pz-on'), go:z.classList.contains('pz-go'), mood:z.dataset.mood, s1:getComputedStyle(z.querySelector('.pz-s1')).display, s2:getComputedStyle(z.querySelector('.pz-s2')).display, jump:getComputedStyle(z.querySelector('.pz-char')).animationName, hl:t.classList.contains('pz-hl'), hov:t.querySelector('.am-fxw').classList.contains('am-hov'), pos:document.querySelector('.amp-pos').textContent}; }, ids);
  await q.screenshot({path:SH('click')});
  await sleep(2200);
  const ck2=await q.evaluate(ids=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+ids.a+'"] .pz'); const t=document.querySelector('.amp-slide.on .am-el[data-id="'+ids.chart+'"]'); return {go:z.classList.contains('pz-go'), hl:t.classList.contains('pz-hl'), hov:t.querySelector('.am-fxw').classList.contains('am-hov'), rot:getComputedStyle(z.querySelector('.pz-aR')).rotate}; }, ids);
  await q.mouse.click(cA.x,cA.y); await sleep(200);
  const ck3=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); return {on:z.classList.contains('pz-on'), mood:z.dataset.mood, s1:getComputedStyle(z.querySelector('.pz-s1')).display}; }, ids.a);
  check('S35-18: clique em A: reage (animado, fala 2 no lugar da 1, pula) e acende o gráfico apontado (.pz-hl + .am-hov) sem mudar de slide; passado o tempo, o brilho e o pulo saem e o braço volta à mira; segundo clique volta à expressão e fala originais', ck.on && ck.go && ck.mood==='animado' && ck.s1==='none' && ck.s2!=='none' && ck.jump==='pzJump' && ck.hl && ck.hov && /^01/.test(ck.pos) && !ck2.go && !ck2.hl && !ck2.hov && /deg/.test(ck2.rot) && !ck3.on && ck3.mood==='feliz' && ck3.s1!=='none', {ck,ck2,ck3});
  await q.click('.amp-slide.on .am-el[data-id="'+ids.b+'"] .pz-ch:has-text("Não")'); await sleep(300);
  const dn=await q.evaluate(id=>({mood:document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz').dataset.mood, pos:document.querySelector('.amp-pos').textContent}), ids.b);
  await q.click('.amp-slide.on .am-el[data-id="'+ids.b+'"] .pz-ch:has-text("Sim")'); await sleep(800);
  const ds=await q.evaluate(id=>({mood:document.querySelector('.amp-slide:not(.on) .am-el[data-id="'+id+'"] .pz').dataset.mood, pos:document.querySelector('.amp-pos').textContent}), ids.b);
  check('S35-19: decisões no balão: “Não” deixa a IA preocupada no mesmo slide; “Sim” a anima e leva ao slide 2', dn.mood==='preocupado' && /^01/.test(dn.pos) && ds.mood==='animado' && /^02/.test(ds.pos), {dn,ds});
  await sleep(600); await q.screenshot({path:SH('walk-mid')});
  await sleep(3400);
  const wk=await q.evaluate(ids=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+ids.w+'"] .pz'); const mv=z.querySelector('.pz-mv'); const st=document.querySelector('.amp-slide.on .am-stage').getBoundingClientRect(); const tr=getComputedStyle(mv).translate; const px=parseFloat(tr); const exp=(900-40)/1280*st.width;
    const er=z.closest('.am-el').getBoundingClientRect(), br=z.querySelector('.pz-say').getBoundingClientRect(); return {tr, px, exp, ok:Math.abs(px-exp)<2, wq:z.style.getPropertyValue('--wq'), legs:getComputedStyle(z.querySelector('.pz-lgL')).animationName, bubbleMoved:br.x-er.x>exp-40, an:getComputedStyle(mv).animationName}; }, ids);
  check('S35-20: “Andar até 900”: o personagem e o balão deslizam juntos até o X pedido (translate = (900−40)/1280 da largura do palco) com as pernas andando', wk.ok && wk.legs==='pzLegA' && wk.bubbleMoved && wk.an==='pzWalkTo', wk);
  await q.screenshot({path:SH('walk-end')});
  const kB=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); const r=z.querySelector('.pz-svg').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2, before:getComputedStyle(z.querySelector('.pz-aR')).animationName, lx:z.style.getPropertyValue('--lx')}; }, ids.k);
  await q.mouse.click(kB.x,kB.y); await sleep(200);
  const kA=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); return {an:getComputedStyle(z.querySelector('.pz-aR')).animationName, n:getComputedStyle(z.querySelector('.pz-aR')).animationIterationCount, pos:document.querySelector('.amp-pos').textContent}; }, ids.k);
  check('S35-21: “só ao clicar”: o apresentador fica parado até o clique, que faz o aceno uma vez (sem avançar o slide); olhos fixos não recebem --lx', kB.before==='pzNone' && kB.lx==='' && kA.an==='pzWave' && kA.n==='1' && /^02/.test(kA.pos), {kB,kA});
  await q.keyboard.press('ArrowLeft'); await sleep(400);
  check('S35-22: as setas continuam navegando (← volta ao slide 1)', await q.evaluate(()=>/^01/.test(document.querySelector('.amp-pos').textContent)));
  /* ---------- 7. salvar/reabrir e saneamento ---------- */
  const re=await p.evaluate(ids=>{ const A=AMStudio; const html=A.exportHTML(); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]); A.loadDeck(dk,'re');
    const s=A.deck.slides[0], a=s.els.find(e=>e.id===ids.a), bb=s.els.find(e=>e.id===ids.b), w=A.deck.slides[1].els.find(e=>e.id===ids.w), ln=s.els.find(e=>e.type==='line');
    const bad=A.safeDeck({slides:[{id:'s1',els:[{id:'p1',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,variant:'zzz',data:{hat:'x<y',aim:'bad id!',mood:'zzz',say:'<b>oi</b>',choices:[{t:'A',go:'3',m:'nada'}],walk:'abc'}}]}]}).slides[0].els[0];
    const r=AMRT.personas.resolve(bad.data, bad), html2=AMRT.FX.persona.html(bad.data,300,380,bad);
    return {a:{v:a.variant, aim:a.data.aim===ids.chart, say2:a.data.say2, mood2:a.data.mood2, act:a.data.act}, b:{ch:bb.data.choices.length, go:bb.data.choices[0].go, m:bb.data.choices[0].m, side:bb.data.side, bubble:bb.data.bubble}, w:{walk:w.data.walk}, ln:ln.a1&&ln.a1.id===ids.sb&&ln.a2&&ln.a2.id===ids.b,
      bad:{variant:bad.variant||'', hat:bad.data.hat, aim:bad.data.aim, r:r.hat+'/'+r.mood, esc:/&lt;b&gt;oi&lt;\/b&gt;/.test(html2)&&!/<b>oi/.test(html2), choices:AMRT.personas.choices(bad.data.choices)[0]}}; }, ids);
  check('S35-23: salvar/reabrir mantém preset, alvo, fala/expressão ao clicar, decisões (botão, slide, expressão), posição do balão, Andar até e as pontas presas; peças inválidas são descartadas (chapéu “x<y”, alvo com “!”, variante desconhecida) e o preset responde; a fala sai escapada', re.a.v==='consultora' && re.a.aim && re.a.say2==='Foi o maior salto do ano!' && re.a.mood2==='animado' && re.a.act==='apontar' && re.b.ch===2 && re.b.go===2 && re.b.m==='animado' && re.b.side==='right' && re.b.bubble==='pensa' && re.w.walk===900 && re.ln && re.bad.variant==='' && re.bad.hat===undefined && re.bad.aim===undefined && re.bad.r==='capW/surpreso' && re.bad.esc && re.bad.choices.go===3 && re.bad.choices.m==='', re);
  /* kit de marca: as cores do personagem acompanham “Cores do componente” */
  const pal=await p.evaluate(ids=>{ const A=AMStudio; const a=A.deck.slides[0].els.find(e=>e.id===ids.a); const before=document.querySelector('#cv .am-edit .am-el[data-id="'+ids.a+'"] .pz').style.getPropertyValue('--c1'); a.pal={p:'#1F66A8',a:'#2BB673'}; A.renderAll(); A.commit(); const n=document.querySelector('#cv .am-edit .am-el[data-id="'+ids.a+'"]'); const z=n.querySelector('.pz'); return {palOk:A.brand.palOk(a), tag:!!n.dataset.pal, before, after:z.style.getPropertyValue('--c1')}; }, ids);
  check('S35-24: “Cores do componente” vale para o personagem: data-pal no elemento e a cor do corpo recolorida', pal.palOk && pal.tag && pal.before!==pal.after && /^#/.test(pal.after), pal);
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
