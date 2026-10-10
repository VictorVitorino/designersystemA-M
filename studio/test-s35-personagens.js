/* S35 — Personagens A&M (rt-70-personas.js/.css + ed-46-personas.js): bonecos no estilo dos mascotes, na paleta A&M, com roupa,
   ferramenta, expressão e movimento trocáveis; balão de fala (fala, pensamento, grito, nota) com decisões; apontar para um
   elemento; andar até um X; na apresentação os olhos seguem o mouse, o clique reage e acende o alvo, os botões de decisão
   navegam. Editor: Inserir › Personagens ▸, painel (presets como variantes, partes, “Aponta para” dinâmico), edição no lugar,
   mira ao mover, vitrine, raster/PDF, Ctrl+Z, salvar/reabrir, balão solto preso a conector.
   Correções da revisão adversarial (S35-24…41): fora do kit de cores, arquivo editado à mão, “Andar até” vazio, alvo nas cópias e no
   Redefinir, rótulos, efeitos que não servem, PowerPoint editável, caminhada + mira + linha presa, poses finais, gesto do clique,
   decisões (foco, salto cancelado), ponteiro só no desenho, giro, alvo acima da cabeça, texto que cabe, vitrine e Marca ▾.
   Rodada 3 (S35-55…65): chegada só com a pose, gesto na virada do ciclo, laço sem gesto intacto, “Fala ao clicar” cortada, decisões alcançáveis,
   efeitos recusados ao ligar “Andar até”, pontas presas da base depois de reabrir, vitrine por palavra, prévia depois de trocar o preset e sua duração.
   Verificação final (S35-66…69): aviso vivo no painel, um passo de desfazer, classe de espessura sem colisão, prévia sem caminhada.
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
  await p.click('#props .pzs-fine > summary'); await sleep(150); /* S36: os campos originais ficam em “Ajustes finos” */
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
  check('S35-15: player: 3 personagens; A aponta uma vez (pzPoint ×1, mira para o gráfico, olha à direita); B comemora sem parar (trilha cíclica pzCheerRL ∞, pula, confete); C espera o mouse (boca parada), olha à esquerda, grito laranja com texto navy legível; pálpebras piscam, antena da IA pulsa; só a fala 1 aparece', pl.n===3 && pl.aR==='pzPoint' && pl.aN==='1' && /deg/.test(pl.aim) && pl.face==='r' && pl.bR==='pzCheerRL' && pl.bN==='infinite' && pl.bC==='pzHop' && pl.conf==='inline' && pl.bChs===2 && pl.bPensa && pl.cM==='pzNone' && pl.cFace==='l' && pl.cGrita && pl.cTxt==='rgb(0, 42, 70)' && pl.cBg==='rgb(247, 140, 22)' && pl.lid==='pzBlink' && pl.led==='pzLed' && pl.s1!=='none' && pl.s2==='none', pl);
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
  check('S35-18: clique em A: reage (animado, fala 2 no lugar da 1, pula) e acende o gráfico apontado (.pz-hl + .am-hov) sem mudar de slide; passado o tempo, o brilho e o pulo saem e o braço volta à mira; segundo clique volta à expressão e fala originais', ck.on && ck.go && ck.mood==='animado' && ck.s1==='none' && ck.s2!=='none' && ck.jump==='pzJumpG' && ck.hl && ck.hov && /^01/.test(ck.pos) && !ck2.go && !ck2.hl && !ck2.hov && /deg/.test(ck2.rot) && !ck3.on && ck3.mood==='feliz' && ck3.s1!=='none', {ck,ck2,ck3});
  await q.click('.amp-slide.on .am-el[data-id="'+ids.b+'"] .pz-ch:has-text("Não")'); await sleep(300);
  const dn=await q.evaluate(id=>({mood:document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz').dataset.mood, pos:document.querySelector('.amp-pos').textContent}), ids.b);
  await q.click('.amp-slide.on .am-el[data-id="'+ids.b+'"] .pz-ch:has-text("Sim")'); await sleep(800);
  const ds=await q.evaluate(id=>({mood:document.querySelector('.amp-slide:not(.on) .am-el[data-id="'+id+'"] .pz').dataset.mood, pos:document.querySelector('.amp-pos').textContent}), ids.b);
  check('S35-19: decisões no balão: “Não” deixa a IA preocupada no mesmo slide; “Sim” a anima e leva ao slide 2', dn.mood==='preocupado' && /^01/.test(dn.pos) && ds.mood==='animado' && /^02/.test(ds.pos), {dn,ds});
  await sleep(600); await q.screenshot({path:SH('walk-mid')});
  const wmid=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); return {legs:getComputedStyle(z.querySelector('.pz-lgL')).animationName, arr:z.classList.contains('pz-arr'), wf:z.dataset.wf}; }, ids.w);
  await sleep(3400);
  const wk=await q.evaluate(ids=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+ids.w+'"] .pz'); const mv=z.querySelector('.pz-mv'); const st=document.querySelector('.amp-slide.on .am-stage').getBoundingClientRect(); const tr=getComputedStyle(mv).translate; const px=parseFloat(tr); const exp=(900-40)/1280*st.width;
    const er=z.closest('.am-el').getBoundingClientRect(), br=z.querySelector('.pz-say').getBoundingClientRect(); return {tr, px, exp, ok:Math.abs(px-exp)<2, wq:z.style.getPropertyValue('--wq'), legs:getComputedStyle(z.querySelector('.pz-lgL')).animationName, bubbleMoved:br.x-er.x>exp-40, an:getComputedStyle(mv).animationName}; }, ids);
  const arr=await q.evaluate(id=>document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz').classList.contains('pz-arr'), ids.w);
  check('S35-20: “Andar até 900”: no caminho as pernas andam (pzLegA) e ele olha para a direita; na chegada o personagem e o balão estão juntos no X pedido (translate = (900−40)/1280 da largura do palco), as pernas param e .pz-arr marca a chegada', wmid.legs==='pzLegA' && !wmid.arr && wmid.wf==='r' && wk.ok && wk.legs==='pzNone' && arr && wk.bubbleMoved && wk.an==='pzWalkTo', {wmid, wk, arr});
  await q.screenshot({path:SH('walk-end')});
  const kB=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); const r=z.querySelector('.pz-svg').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2, before:getComputedStyle(z.querySelector('.pz-aR')).animationName, lx:z.style.getPropertyValue('--lx')}; }, ids.k);
  await q.mouse.click(kB.x,kB.y); await sleep(200);
  const kA=await q.evaluate(id=>{ const z=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); return {an:getComputedStyle(z.querySelector('.pz-aR')).animationName, n:getComputedStyle(z.querySelector('.pz-aR')).animationIterationCount, pos:document.querySelector('.amp-pos').textContent}; }, ids.k);
  check('S35-21: “só ao clicar”: o apresentador fica parado até o clique, que faz o aceno uma vez como gesto (pzWaveG, parte e volta à pose; sem avançar o slide); olhos fixos não recebem --lx', kB.before==='pzNone' && kB.lx==='' && kA.an==='pzWaveG' && kA.n==='1' && /^02/.test(kA.pos), {kB,kA});
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
  { /* ---------- 8. correções da revisão adversarial (bloco próprio: nomes locais) ---------- */
  const W8=ms=>new Promise(r=>setTimeout(r,ms));
  const kit=await p.evaluate(ids=>{ const A=AMStudio; const a=A.deck.slides[0].els.find(e=>e.id===ids.a); A.selectMany([a.id]); A.renderAll();
    const secs=[...document.querySelectorAll('#props .sec h3')].map(h=>h.textContent);
    const bad=A.safeDeck({slides:[{id:'s1',els:[{id:'p1',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,variant:'mestre',pal:{p:'#C2185B',a:'#00A651'},data:{}}]}]}).slides[0].els[0];
    return {palOk:A.brand.palOk(a), secs, palKept:!!bad.pal}; }, ids);
  check('S35-24: personagens ficam fora do kit “Cores do componente” (só cores A&M): palOk falso, o painel não oferece a seção e uma cor de fora gravada no arquivo é descartada ao abrir', !kit.palOk && !kit.secs.some(t=>/Cores do componente/i.test(t)) && !kit.palKept, kit);
  /* arquivo editado à mão: decisões em texto/objeto/número, fala numérica, bcol com nome do protótipo, walk inválido */
  const hand=await p.evaluate(async()=>{ const A=AMStudio;
    const dk={title:'Mão',slides:[{id:'s1',bg:'#FFFFFF',els:[{id:'pA',type:'fx',kind:'persona',x:40,y:40,w:300,h:380,variant:'eng',data:{say:'Escolha',choices:'Sim | 2 | feliz\nNão | 0 | triste',bcol:'__proto__',walk:'abc'}},
      {id:'pB',type:'fx',kind:'persona',x:400,y:40,w:300,h:380,variant:'ia',data:{choices:[null,{t:'ok',go:1},5,'x'],say:7,bcol:'constructor'}},{id:'pC',type:'fx',kind:'persona',x:800,y:40,w:300,h:380,data:{choices:{t:'x'},say2:{a:1}}}]}]};
    A.loadDeck(A.safeDeck(dk),'mao'); await new Promise(r=>setTimeout(r,250)); const s=A.deck.slides[0];
    const pan=id=>{ A.selectMany([id]); const t=document.querySelector('#props textarea[data-p="data.choices"]'); return {h2:(document.querySelector('#props h2')||{}).textContent||'', ch:t?t.value:null}; };
    const a=pan('pA'), b=pan('pB'), c=pan('pC'); const bg=id=>getComputedStyle(document.querySelector('#cv .am-edit .am-el[data-id="'+id+'"] .pz-say')).backgroundColor;
    return {a, b, c, ca:s.els[0].data.choices, cb:s.els[1].data.choices, cc:s.els[2].data.choices, sayB:s.els[1].data.say, say2C:s.els[2].data.say2, walkA:s.els[0].data.walk, bgA:bg('pA'), bgB:bg('pB')}; });
  check('S35-25: arquivo editado à mão: decisões em texto viram lista (Sim→2 feliz, Não→0 triste), lista com lixo fica só com os itens válidos, objeto vira lista vazia; o painel abre nos três; fala numérica vira texto, fala-objeto some; bcol “__proto__”/“constructor” cai no balão branco; walk inválido fica vazio',
    /Personagem/.test(hand.a.h2) && hand.a.ch==='Sim | 2 | feliz\nNão | 0 | triste' && /Personagem/.test(hand.b.h2) && hand.b.ch==='ok | 1 | ' && /Personagem/.test(hand.c.h2) && hand.c.ch==='' && hand.ca.length===2 && hand.ca[0].go===2 && hand.cb.length===1 && Array.isArray(hand.cc) && hand.cc.length===0 && hand.sayB==='7' && hand.say2C==='' && hand.walkA==='' && hand.bgA==='rgb(255, 255, 255)' && hand.bgB==='rgb(255, 255, 255)', hand);
  const wf=await p.evaluate(async()=>{ const A=AMStudio; A.selectMany(['pA']); await new Promise(r=>setTimeout(r,120)); const q=()=>document.querySelector('#props input[data-p="data.walk"]'); const v0=q().value;
    q().value='700'; q().dispatchEvent(new Event('input',{bubbles:true})); q().dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,150)); const w1=A.deck.slides[0].els[0].data.walk, at1=!!document.querySelector('#cv .am-edit .am-el[data-id="pA"] .pz[data-walk]');
    q().value=''; q().dispatchEvent(new Event('input',{bubbles:true})); q().dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,150));
    return {v0, w1, at1, w2:A.deck.slides[0].els[0].data.walk, v2:q().value, at2:!!document.querySelector('#cv .am-edit .am-el[data-id="pA"] .pz[data-walk]')}; });
  check('S35-26: “Andar até” começa vazio (não 0), aceita 700 e volta a vazio ao apagar (o personagem deixa de andar)', wf.v0==='' && wf.w1===700 && wf.at1 && wf.w2==='' && wf.v2==='' && !wf.at2, wf);
  /* duplicar slide, Ctrl+D e a base do “Redefinir” levam o alvo para as cópias */
  const rm=await p.evaluate(async()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null);
    A.appendSlides([{id:'sx',bg:'#FFFFFF',els:[{id:'c0',type:'fx',kind:'bars',x:620,y:100,w:600,h:300},{id:'p0',type:'fx',kind:'persona',variant:'consultor',x:40,y:100,w:300,h:380,data:Object.assign(JSON.parse(JSON.stringify(AMRT.FX.persona.data)),{aim:'c0',act:'apontar',bcol:'gelo',side:'top',bubble:'pensa',say:'Base'})}]}], 1);
    await new Promise(r=>setTimeout(r,200)); const s1=A.deck.slides[1], ch=s1.els.find(e=>e.kind==='bars'), pz=s1.els.find(e=>e.kind==='persona');
    const base1=Object.values(s1.base.els).map(sn=>sn.dsel&&sn.dsel.aim).filter(Boolean)[0];
    A.dupSlide(1); await new Promise(r=>setTimeout(r,200)); const s2=A.deck.slides[2], ch2=s2.els.find(e=>e.kind==='bars'), pz2=s2.els.find(e=>e.kind==='persona');
    const base2=Object.values(s2.base.els).map(sn=>sn.dsel&&sn.dsel.aim).filter(Boolean)[0];
    A.goSlide(1); A.selectMany([ch.id, pz.id]); return {pzAim:pz.data.aim===ch.id, base1:base1===ch.id, dup:pz2.data.aim===ch2.id && ch2.id!==ch.id, base2:base2===ch2.id, nkeys:Object.keys(Object.values(s1.base.els).find(sn=>sn.dsel&&sn.dsel.aim).dsel).length}; });
  await p.keyboard.press('Control+d'); await sleep(250);
  const cd=await p.evaluate(()=>{ const s=AMStudio.deck.slides[1]; const cps=s.els.slice(2); const c=cps.find(e=>e.kind==='bars'), z=cps.find(e=>e.kind==='persona'); return {n:cps.length, ok:!!(c&&z&&z.data.aim===c.id)}; });
  check('S35-27: o alvo acompanha as cópias: slide colado já aponta para o gráfico novo (inclusive na base do Redefinir, que guarda as 19 escolhas), “Duplicar slide” e Ctrl+D (personagem + gráfico) apontam para os novos', rm.pzAim && rm.base1 && rm.dup && rm.base2 && rm.nkeys>=19 && cd.n===2 && cd.ok, {rm, cd});
  const rs=await p.evaluate(async()=>{ const A=AMStudio; const html=A.exportHTML(); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]); A.loadDeck(dk,'re2'); await new Promise(r=>setTimeout(r,200));
    A.goSlide(1); const z=A.deck.slides[1].els.find(e=>e.kind==='persona'), aim0=z.data.aim; Object.assign(z.data,{bcol:'navy',side:'left',bubble:'grita',aim:''}); A.renderAll(); A.commit();
    A.resetSlide(1); await new Promise(r=>setTimeout(r,200)); const z2=A.deck.slides[1].els.find(e=>e.kind==='persona'); return {bcol:z2.data.bcol, side:z2.data.side, bubble:z2.data.bubble, aim:z2.data.aim===aim0 && !!aim0}; });
  check('S35-28: salvar → reabrir → mudar cor, lado, tipo de balão e alvo → “Redefinir slide” devolve os quatro (a base guarda as 19 escolhas do personagem)', rs.bcol==='gelo' && rs.side==='top' && rs.bubble==='pensa' && rs.aim, rs);
  /* menu de variantes, prévia, efeitos que não servem */
  await p.evaluate(()=>{ const A=AMStudio; const z=A.deck.slides[1].els.find(e=>e.kind==='persona'); A.selectMany([z.id]); }); await sleep(200);
  await p.click('#fxArrow'); await sleep(200);
  const vm=await p.evaluate(async()=>{ const A=AMStudio; const t=(document.querySelector('#mVar .vh b')||{}).textContent; A.closeMenus();
    const pv=(document.querySelector('#props [data-act="pvel"]')||{}).textContent, loops=[...document.querySelectorAll('#props [data-set="anim.loop"]')].map(b=>b.dataset.v), hov=[...document.querySelectorAll('#props [data-set="anim.hover"]')].map(b=>b.dataset.v);
    const sh=A.insertFx('card'); A.selectMany([sh.id]); await new Promise(r=>setTimeout(r,120)); const loops2=[...document.querySelectorAll('#props [data-set="anim.loop"]')].map(b=>b.dataset.v); return {t, pv, loops, hov, loops2}; });
  check('S35-29: menu do seletor “Personagem: Personagem A&M” e botão “▶ Ver movimento no slide”; “Reflexo” (contínuo) e “Zoom interno” (mouse) não são oferecidos ao personagem, mas continuam para um card', vm.t==='Personagem: Personagem A&M' && /Ver movimento no slide/.test(vm.pv) && vm.loops.length>3 && !vm.loops.includes('shimmer') && !vm.hov.includes('inzoom') && vm.hov.length>3 && vm.loops2.includes('shimmer'), vm);
  /* PowerPoint editável: o personagem sai com o lado e a mira do slide inteiro */
  const px=await p.evaluate(async()=>{ const A=AMStudio; const F=AMRT.FX.persona, orig=F.html, seen=[]; F.html=function(d,w,h,el){ if(el&&el._pzAim) seen.push(el._pzAim); return orig.apply(this,arguments); };
    try { const dk=A.newDeck(); A.loadDeck(dk,null); const ch=A.insertFx('bars'); ch.x=40; ch.y=100; ch.w=600; ch.h=300; const pz=A.insertFx('persona',null,null,'consultor'); pz.x=900; pz.y=100; pz.data.aim=ch.id; pz.data.act='apontar'; A.selectMany([]); A.renderAll(); A.commit();
      const z=document.querySelector('#cv .am-edit .pz'); const stage={aim:z.style.getPropertyValue('--aim').trim(), face:z.dataset.face};
      const bl=await AMExport.pptxBuild(A.deck,{mode:'edit'}); return {size:bl.size, seen, stage}; } finally { F.html=orig; } });
  check('S35-30: PowerPoint editável: o personagem vira imagem com o mesmo lado (esquerda, para o gráfico) e a mesma mira medidos no slide', px.size>10000 && px.seen.length>=1 && px.seen[0].face==='l' && px.stage.face==='l' && px.seen[0].deg===px.stage.aim, px);
  /* deck de comportamento no player */
  const ids2=await p.evaluate(()=>{ const A=AMStudio; const dk=A.newDeck(); dk.title='Correções'; A.loadDeck(dk,null); const s0=A.deck.slides[0];
    const ch=A.insertFx('bars'); ch.x=820; ch.y=80; ch.w=440; ch.h=260;
    const w=A.insertFx('persona',null,null,'eng'); w.x=20; w.y=300; w.w=260; w.h=360; Object.assign(w.data,{walk:420,act:'apontar',aim:ch.id,say:'Cheguei!'});
    const ln=A.mk.line(true,false); ln.x1=200; ln.y1=60; ln.x2=150; ln.y2=300; ln.a2={id:w.id,s:'n'}; s0.els.push(ln);
    const tw=A.insertFx('persona',null,null,'eng'); tw.x=420; tw.y=300; tw.w=260; tw.h=360; Object.assign(tw.data,{act:'apontar',aim:ch.id,say:'Cheguei!',trig:'click'});
    A.addSlide('blank-light'); const s1=A.deck.slides[1];
    const a=A.insertFx('persona',null,null,'mestre'); a.x=20; a.y=40; a.w=280; a.h=360; Object.assign(a.data,{act:'acenar',act2:'pular',trig:'in'}); a.anim={in:'none'};
    const b=A.insertFx('persona',null,null,'dev'); b.x=330; b.y=40; b.w=280; b.h=360; Object.assign(b.data,{act:'andar',trig:'in',bubble:'none'});
    const c=A.insertFx('persona',null,null,'apresentador'); c.x=640; c.y=40; c.w=280; c.h=360; Object.assign(c.data,{act:'comemorar',trig:'hover',say:'Viva!'});
    const d=A.insertFx('persona',null,null,'ia'); d.x=950; d.y=40; d.w=310; d.h=420; Object.assign(d.data,{act:'acenar',trig:'loop',say:'Escolha um caminho',choices:[{t:'Seguir',go:3,m:'animado'},{t:'Ficar',go:0,m:'preocupado'}]});
    A.addSlide('blank-light'); const big=A.insertFx('persona',null,null,'cientista'); big.x=500; big.y=0; big.w=780; big.h=720; Object.assign(big.data,{bubble:'none',act:'parado'});
    A.addSlide('blank-light'); A.goSlide(0); A.selectMany([]); A.renderAll(); A.commit();
    return {ch:ch.id, w:w.id, ln:ln.id, tw:tw.id, a:a.id, b:b.id, c:c.id, d:d.id, big:big.id}; });
  const tw0=await p.evaluate(ids2=>{ const t=document.querySelector('#cv .am-edit .am-el[data-id="'+ids2.tw+'"] .pz'); return t.style.getPropertyValue('--aim').trim(); }, ids2);
  const h2=await p.evaluate(()=>AMStudio.exportHTML()); const hp2=path.join(TMP,'pz2.html'); fs.writeFileSync(hp2,h2);
  const r=await open(ctx,'file://'+hp2,'player2'); await sleep(500);
  const z=(id,sel)=>r.evaluate(([id,sel])=>{ const n=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] '+(sel||'.pz')); return n; },[id,sel]);
  const mid=await r.evaluate(ids2=>{ const zz=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.w+'"] .pz'); return {arr:zz.classList.contains('pz-arr'), aR:getComputedStyle(zz.querySelector('.pz-aR')).animationName, face:getComputedStyle(zz.querySelector('.pz-svg')).transform, lnHidden:getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.ln+'"]')).visibility}; }, ids2);
  const pre=await r.evaluate(ids2=>parseFloat(getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.w+'"] .pz-mv')).translate)||0, ids2);
  const wb2=await r.evaluate(ids2=>{ const b=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.w+'"] .pz-char').getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; }, ids2);
  await r.mouse.click(wb2.x,wb2.y); await sleep(60);
  const post=await r.evaluate(ids2=>{ const zz=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.w+'"] .pz'); return {t:parseFloat(getComputedStyle(zz.querySelector('.pz-mv')).translate)||0, go:zz.classList.contains('pz-go')}; }, ids2);
  check('S35-31: clique no meio da caminhada não teletransporta nem interrompe: o deslocamento só cresce e o gesto não toca enquanto anda; os braços balançam (pzSwingR) e a linha presa some durante a caminhada', post.t>=pre && !post.go && !mid.arr && mid.aR==='pzSwingR' && mid.lnHidden==='hidden', {pre, post, mid});
  await sleep(2600);
  const ar2=await r.evaluate(ids2=>{ const zz=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.w+'"] .pz'); const lx=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.ln+'-pz"]'); const lo=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.ln+'"]');
    return {arr:zz.classList.contains('pz-arr'), aR:getComputedStyle(zz.querySelector('.pz-aR')).animationName, aim:zz.style.getPropertyValue('--aim').trim(), face:zz.dataset.face, clone:!!lx, origHidden:getComputedStyle(lo).visibility, cloneLeft:lx?parseFloat(lx.style.left):null, origLeft:parseFloat(lo.style.left)}; }, ids2);
  check('S35-32: ao chegar, o personagem aponta (pzPoint) com a mira calculada da posição de chegada (= a de um igual parado ali), olhando para o gráfico; a linha presa reaparece com a ponta no ponto de chegada', ar2.arr && ar2.aR==='pzPoint' && ar2.face==='r' && ar2.aim===tw0 && ar2.clone && ar2.origHidden==='hidden' && ar2.cloneLeft>ar2.origLeft, {ar2, tw0});
  await r.keyboard.press('ArrowRight'); await sleep(1200);
  const sl2=await r.evaluate(ids2=>{ const q=id=>document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .pz'); const A=q(ids2.a), B=q(ids2.b), C=q(ids2.c), D=q(ids2.d);
    return {aDelay:getComputedStyle(A.querySelector('.pz-aR')).animationDelay, tL:getComputedStyle(A.querySelector('.pz-tL')).display, tR:getComputedStyle(A.querySelector('.pz-tR')).display, tRB:getComputedStyle(B.querySelector('.pz-tR')).display,
      dLoop:getComputedStyle(D.querySelector('.pz-aR')).animationName, confC:getComputedStyle(C.querySelector('.pz-conf circle')).opacity, confD:getComputedStyle(C.querySelector('.pz-conf')).display,
      bkA:A.style.getPropertyValue('--bk'), bkB:B.style.getPropertyValue('--bk'), lidPath:!!A.querySelector('.pz-lid .pz-lidl')}; }, ids2);
  check('S35-33: sem animação de entrada o movimento começa em 150 ms; quem acena segura a ferramenta na mão esquerda (a direita fica livre), quem anda na direita; “acenar sem parar” usa a trilha cíclica pzWaveL; confete do “ao passar o mouse” fica invisível parado; cada personagem pisca no seu tempo e a pálpebra tem o traço do olho fechado',
    sl2.aDelay==='0.15s' && sl2.tL==='inline' && sl2.tR==='none' && sl2.tRB!=='none' && sl2.dLoop==='pzWaveL' && sl2.confC==='0' && sl2.bkA && sl2.bkA!==sl2.bkB && sl2.lidPath, sl2);
  await sleep(2600);
  const wv=await r.evaluate(ids2=>{ const A=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.a+'"] .pz'), B=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.b+'"] .pz'); return {aR:getComputedStyle(A.querySelector('.pz-aR')).rotate, lg:getComputedStyle(B.querySelector('.pz-lgL')).rotate, lgAn:getComputedStyle(B.querySelector('.pz-lgL')).animationName}; }, ids2);
  const ed=await p.evaluate(ids2=>{ AMStudio.goSlide(1); const B=document.querySelector('#cv .am-edit .am-el[data-id="'+ids2.b+'"] .pz'), A=document.querySelector('#cv .am-edit .am-el[data-id="'+ids2.a+'"] .pz'); return {aR:getComputedStyle(A.querySelector('.pz-aR')).rotate, lg:getComputedStyle(B.querySelector('.pz-lgL')).rotate, conf:getComputedStyle(document.querySelector('#cv .am-edit .am-el[data-id="'+ids2.c+'"] .pz-conf')).display}; }, ids2);
  check('S35-34: as entradas terminam exatamente na pose do editor (acenar: braço em −140°; andar: perna em −12°), e no editor o confete não aparece', wv.aR===ed.aR && ed.aR==='-140deg' && wv.lg===ed.lg && ed.lg==='-12deg' && ed.conf==='none', {wv, ed});
  const ca=await r.evaluate(ids2=>{ const b=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.a+'"] .pz-char').getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height*.6}; }, ids2);
  await r.mouse.click(ca.x,ca.y); await sleep(150);
  const g1=await r.evaluate(ids2=>getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.a+'"] .pz-char')).animationName, ids2);
  await sleep(1300);
  const g2=await r.evaluate(ids2=>{ const A=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.a+'"] .pz'); return {go:A.classList.contains('pz-go'), done:A.classList.contains('pz-done'), aR:getComputedStyle(A.querySelector('.pz-aR')).animationName, rot:getComputedStyle(A.querySelector('.pz-aR')).rotate}; }, ids2);
  check('S35-35: depois da reação ao clique (pular), a entrada não recomeça: o braço fica parado na pose (−140°) e a classe pz-done marca que a entrada já tocou', g1==='pzJumpG' && !g2.go && g2.done && g2.aR==='pzNone' && g2.rot==='-140deg', {g1, g2});
  /* decisões: sem pz-on, sem foco preso, Espaço volta a avançar */
  const dn=await r.evaluate(ids2=>{ const b=[...document.querySelectorAll('.amp-slide.on .am-el[data-id="'+ids2.d+'"] .pz-ch')].find(x=>x.textContent==='Ficar').getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; }, ids2);
  await r.mouse.click(dn.x,dn.y); await sleep(200);
  const dd=await r.evaluate(ids2=>{ const D=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.d+'"] .pz'); return {on:D.classList.contains('pz-on'), mood:D.dataset.mood, pick:(D.querySelector('.pz-ch.pz-pick')||{}).textContent, focus:document.activeElement&&document.activeElement.classList.contains('pz-ch'), s1:getComputedStyle(D.querySelector('.pz-s1')).display, pos:document.querySelector('.amp-pos').textContent}; }, ids2);
  await r.keyboard.press(' '); await sleep(500);
  const sp=await r.evaluate(()=>document.querySelector('.amp-pos').textContent);
  check('S35-36: decisão “Ficar”: o personagem fica preocupado, o botão escolhido fica marcado, a fala continua (sem a reação do clique), o foco não fica no botão e o Espaço volta a avançar o slide', !dd.on && dd.mood==='preocupado' && dd.pick==='Ficar' && !dd.focus && dd.s1!=='none' && /^02/.test(dd.pos) && /^03/.test(sp), {dd, sp});
  const bb=await r.evaluate(ids2=>{ const st=document.querySelector('.amp-slide.on .am-stage').getBoundingClientRect(); const ch=document.querySelector('.amp-slide.on .am-el[data-id="'+ids2.big+'"] .pz-char').getBoundingClientRect(); return {empty:{x:st.x+st.width*.93,y:st.y+st.height*.08}, body:{x:ch.x+ch.width*.5,y:ch.y+ch.height*.6}}; }, ids2);
  await r.mouse.click(bb.body.x,bb.body.y); await sleep(300); const pb=await r.evaluate(()=>document.querySelector('.amp-pos').textContent);
  await r.mouse.click(bb.empty.x,bb.empty.y); await sleep(500); const pe=await r.evaluate(()=>document.querySelector('.amp-pos').textContent);
  check('S35-37: só o desenho do personagem recebe o clique: no corpo ele reage e o slide fica; no vazio da caixa (zona de avançar) o slide avança', /^03/.test(pb) && /^04/.test(pe), {pb, pe});
  await r.close();
  /* decisão com o player fechado antes do salto (editor: Apresentar → Esc) */
  const ps=await p.evaluate(async ids2=>{ const A=AMStudio; A.goSlide(1); A.present(1); await new Promise(r=>setTimeout(r,900));
    const b=[...document.querySelectorAll('#presenter .amp-slide.on .am-el[data-id="'+ids2.d+'"] .pz-ch')].find(x=>x.textContent==='Seguir'); b.click(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await new Promise(r=>setTimeout(r,800)); return {open:document.getElementById('presenter').classList.contains('open'), cur:A.cur}; }, ids2);
  check('S35-38: decisão clicada e apresentação fechada logo em seguida (Esc): o salto agendado é cancelado, sem erro e sem mexer no editor', !ps.open && ps.cur===1, ps);
  /* geometria: personagem girado, alvo acima da cabeça, texto longo, decisões, balão de pensamento solto */
  const geo=await p.evaluate(async()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null);
    const t=A.insertFx('bars'); t.x=900; t.y=40; t.w=340; t.h=200;
    const p0=A.insertFx('persona',null,null,'consultor'); p0.x=200; p0.y=260; Object.assign(p0.data,{aim:t.id,act:'apontar',bubble:'none'});
    const p1=A.insertFx('persona',null,null,'consultor'); p1.x=200; p1.y=260; p1.rot=30; Object.assign(p1.data,{aim:t.id,act:'apontar',bubble:'none'});
    const up=A.insertFx('card'); up.x=470; up.y=0; up.w=120; up.h=60; const p2=A.insertFx('persona',null,null,'consultor'); p2.x=520; p2.y=300; Object.assign(p2.data,{aim:up.id,act:'apontar',bubble:'none'});
    const lg=A.insertFx('persona',null,null,'consultora'); lg.x=40; lg.y=40; lg.w=240; lg.h=300; lg.data.say='Este é um texto propositalmente longo para conferir se o balão reduz a letra até caber, sem cortar nada do que o personagem precisa dizer à plateia durante a apresentação do projeto.';
    const cs=A.insertFx('persona',null,null,'ia'); cs.x=700; cs.y=300; cs.w=300; cs.h=380; Object.assign(cs.data,{say:'Qual caminho seguimos agora?',choices:[{t:'Plano A',go:0},{t:'Plano B',go:0},{t:'Plano C',go:0}]});
    const bu=A.insertFx('bubble'); bu.x=1000; bu.y=520; bu.w=260; bu.h=150; Object.assign(bu.data,{style:'pensa',tail:'bl',text:'Pensando…'});
    A.selectMany([]); A.renderAll(); await new Promise(r=>setTimeout(r,150));
    const q=id=>document.querySelector('#cv .am-edit .am-el[data-id="'+id+'"]'); const aim=id=>parseFloat(q(id).querySelector('.pz').style.getPropertyValue('--aim'));
    const L=q(lg.id).querySelector('.pz-s1'), fsL=parseFloat(getComputedStyle(q(lg.id).querySelector('.pz-say')).fontSize), fs0=parseFloat(getComputedStyle(q(cs.id).querySelector('.pz-say')).fontSize);
    const S1=q(cs.id).querySelector('.pz-s1').getBoundingClientRect(), CH=q(cs.id).querySelector('.pz-chs').getBoundingClientRect(), SAY=q(cs.id).querySelector('.pz-say').getBoundingClientRect();
    const say=q(bu.id).querySelector('.pz-say'), fsB=parseFloat(getComputedStyle(say).fontSize);
    return {a0:aim(p0.id), a1:aim(p1.id), rotAttr:q(p1.id).querySelector('.pz').dataset.rot, up:aim(p2.id), longFits:L.scrollHeight<=L.clientHeight+1, fsL, fs0, s1h:S1.height, chIn:CH.bottom<=SAY.bottom+1&&CH.top>=SAY.top-1, pensaGap:parseFloat(getComputedStyle(say).bottom)/fsB}; });
  check('S35-39: personagem girado 30° compensa a mira (≈ a do não girado − 30°); alvo logo acima da cabeça: o braço sobe por fora (mira ≤ 90°, nunca entre 90° e 180°); fala longa reduz a letra até caber; com decisões a fala continua visível e os botões ficam dentro do balão; o balão de pensamento solto reserva 2em para as bolinhas',
    geo.rotAttr==='30.00' && Math.abs(geo.a1-(geo.a0-30))<8 && geo.up<=90 && !(geo.up>90&&geo.up<=180) && geo.longFits && geo.fsL<geo.fs0 && geo.s1h>5 && geo.chIn && Math.abs(geo.pensaGap-2)<0.05, geo);
  await p.screenshot({path:SH('geometria')});
  /* vitrine e menu Marca ▾ */
  const gs=await p.evaluate(async()=>{ const A=AMStudio; const out={}; for (const q of ['mestre de obras','agente de ia','cientista','robô']) { A.gallery.open('all', q); await new Promise(r=>setTimeout(r,250)); const b=document.querySelector('#drawerBody .gx-box[data-gx="cmp:persona"]'); out[q]=!!b&&!b.hidden; } A.openDrawer(false); return out; });
  check('S35-40: a busca da vitrine acha o personagem por qualquer nome do elenco (mestre de obras, agente de IA, cientista, robô)', Object.values(gs).every(Boolean), gs);
  await p.click('#rib [data-menu=mBrand]'); await sleep(250);
  const mb=await p.evaluate(()=>({n:document.querySelectorAll('#mBrand .pzm button').length, hd:[...document.querySelectorAll('#mBrand .mh')].map(x=>x.textContent), vis:document.getElementById('mBrand').classList.contains('open'), fit:document.getElementById('mBrand').getBoundingClientRect().bottom<=innerHeight}));
  await p.click('#mBrand .pzm button[data-pz="ia"]'); await sleep(300);
  const mi=await p.evaluate(()=>{ const s=AMStudio.deck.slides[AMStudio.cur]; const e=s.els[s.els.length-1]; return {kind:e.kind, v:e.variant, open:document.getElementById('mBrand').classList.contains('open')}; });
  check('S35-41: Marca ▾ da faixa de ferramentas tem a seção “Personagens A&M” (10 do elenco + balão, cabendo na tela) e o clique insere o personagem escolhido', mb.vis && mb.n===11 && mb.hd.includes('Personagens A&M') && mb.fit && mi.kind==='persona' && mi.v==='ia' && !mi.open, {mb, mi});
  }
  {
  /* ---------- 9. segunda rodada da revisão adversarial ---------- */
  const ids3=await p.evaluate(()=>{ const A=AMStudio; const dk=A.newDeck(); dk.title='Rodada 2'; A.loadDeck(dk,null); const s0=A.deck.slides[0];
    const ch=A.insertFx('bars'); ch.x=900; ch.y=60; ch.w=360; ch.h=220;
    const wi=A.insertFx('persona',null,null,'mestre'); wi.x=20; wi.y=330; wi.w=240; wi.h=340; Object.assign(wi.data,{walk:640,act:'acenar',trig:'in',bubble:'none'});
    const wl=A.insertFx('persona',null,null,'dev'); wl.x=20; wl.y=0; wl.w=240; wl.h=320; Object.assign(wl.data,{walk:1000,act:'acenar',trig:'loop',bubble:'none'});
    const l1=A.mk.line(false,false); l1.x1=700; l1.y1=700; l1.x2=150; l1.y2=330; l1.a2={id:wi.id,s:'n'}; l1.anim={in:'none',loop:'flow'}; s0.els.push(l1);
    const l2=A.mk.line(false,false); l2.x1=700; l2.y1=10; l2.x2=150; l2.y2=20; l2.a2={id:wl.id,s:'n'}; s0.els.push(l2);
    A.addSlide('blank-light');
    const pj=A.insertFx('persona',null,null,'analista'); pj.x=20; pj.y=40; pj.w=280; pj.h=360; Object.assign(pj.data,{act:'pular',act2:'pular',trig:'loop',bubble:'none'});
    const pc=A.insertFx('persona',null,null,'apresentador'); pc.x=330; pc.y=40; pc.w=280; pc.h=360; Object.assign(pc.data,{act:'comemorar',trig:'in',bubble:'none'});
    const pf=A.insertFx('persona',null,null,'consultor'); pf.x=640; pf.y=40; pf.w=280; pf.h=360; Object.assign(pf.data,{act:'pensar',act2:'acenar',trig:'in',bubble:'none'});
    const pr=A.insertFx('persona',null,null,'ia'); pr.x=960; pr.y=200; pr.w=280; pr.h=360; pr.rot=180; Object.assign(pr.data,{act:'parado',bubble:'none'});
    const pd=A.insertFx('persona',null,null,'consultora'); pd.x=330; pd.y=420; pd.w=520; pd.h=290; Object.assign(pd.data,{say:'Para onde?',choices:[{t:'Longe',go:3},{t:'Fico',go:0}]});
    A.addSlide('blank-light'); A.addSlide('blank-light'); A.goSlide(0); A.selectMany([]); A.renderAll(); A.commit();
    return {ch:ch.id, wi:wi.id, wl:wl.id, l1:l1.id, l2:l2.id, pj:pj.id, pc:pc.id, pf:pf.id, pr:pr.id, pd:pd.id}; });
  const h3=await p.evaluate(()=>AMStudio.exportHTML()); const hp3=path.join(TMP,'pz3.html'); fs.writeFileSync(hp3,h3);
  const v=await open(ctx,'file://'+hp3,'player3');
  const Q=(id,sel)=>'.amp-slide.on .am-el[data-id="'+id+'"] '+(sel||'.pz');
  await sleep(1300);
  const wk1=await v.evaluate(([a,b])=>({rot:parseFloat(getComputedStyle(document.querySelector(a)).rotate), an:getComputedStyle(document.querySelector(a)).animationName, tool:getComputedStyle(document.querySelector(b)).rotate}),[Q(ids3.wi,'.pz-aR'),Q(ids3.wi,'.pz-tR')]);
  const flowCopy0=await v.evaluate(id=>!!document.querySelector('.amp-slide.on .am-el[data-id="'+id+'-pz"]'), ids3.l1);
  await sleep(1300);
  const arrI=await v.evaluate(([a,z])=>({an:getComputedStyle(document.querySelector(a)).animationName, arr:document.querySelector(z).classList.contains('pz-arr')}),[Q(ids3.wi,'.pz-aR'),Q(ids3.wi)]);
  const cp1=await v.evaluate(id=>{ const n=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'-pz"]'); if(n) n.__mark=1; return n?{loop:(n.querySelector('.am-fxw')||{}).dataset.loop}:null; }, ids3.l1);
  check('S35-42: caminhada “ao entrar”: no caminho o braço balança em volta da pose neutra (−16°, sem ficar erguido) e a ferramenta não vira; na chegada o aceno parte dali (sem salto); a cópia da linha presa mantém o efeito contínuo (Fluxo)', wk1.an==='pzSwingR' && wk1.rot>-45 && wk1.rot<15 && /^0deg$|^none$/.test(wk1.tool) && !flowCopy0 && arrI.arr && arrI.an==='pzWave' && cp1 && cp1.loop==='flow', {wk1, arrI, cp1});
  await v.waitForFunction(sel=>document.querySelector(sel).classList.contains('pz-arr'), Q(ids3.wl), {timeout:8000}); await sleep(150);
  const ent=await v.evaluate(([a,z])=>({an:getComputedStyle(document.querySelector(a)).animationName, n:getComputedStyle(document.querySelector(a)).animationIterationCount, pose:document.querySelector(z).classList.contains('pz-pose'), arr:document.querySelector(z).classList.contains('pz-arr')}),[Q(ids3.wl,'.pz-aR'),Q(ids3.wl)]);
  const keep=await v.evaluate(id=>{ const n=document.querySelector('.amp-slide.on .am-el[data-id="'+id+'-pz"]'); return !!(n&&n.__mark); }, ids3.l1);
  await sleep(2300);
  const lp=await v.evaluate(([a,z])=>({an:getComputedStyle(document.querySelector(a)).animationName, n:getComputedStyle(document.querySelector(a)).animationIterationCount, pose:document.querySelector(z).classList.contains('pz-pose')}),[Q(ids3.wl,'.pz-aR'),Q(ids3.wl)]);
  check('S35-43: caminhada com “sem parar”: na chegada o braço só vai para a pose (pz-pose, pzPoseR ×1, sem tocar o aceno inteiro) e depois o laço assume (pzWaveL ∞); a chegada do segundo personagem não refaz a cópia da linha do primeiro', ent.arr && ent.pose && ent.an==='pzPoseR' && ent.n==='1' && !lp.pose && lp.an==='pzWaveL' && lp.n==='infinite' && keep, {ent, lp, keep});
  await v.keyboard.press('ArrowRight'); await sleep(2600);
  const s2b=await v.evaluate(([cf,ct,pc,pj])=>({conf:getComputedStyle(document.querySelector(cf)).pointerEvents, tool:getComputedStyle(document.querySelector(ct)).animationName, toolRot:getComputedStyle(document.querySelector(ct)).rotate, pjAn:getComputedStyle(document.querySelector(pj)).animationName}),[Q(ids3.pc,'.pz-conf'),Q(ids3.pc,'.pz-tR'),Q(ids3.pc),Q(ids3.pj,'.pz-char')]);
  const pjb=await v.evaluate(sel=>{ const b=document.querySelector(sel).getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height*.6}; }, Q(ids3.pj,'.pz-char'));
  await v.mouse.click(pjb.x,pjb.y); await v.waitForFunction(sel=>document.querySelector(sel).classList.contains('pz-go'), Q(ids3.pj), {timeout:3000}).catch(()=>{}); await sleep(150);
  const t1=await v.evaluate(sel=>getComputedStyle(document.querySelector(sel)).translate, Q(ids3.pj,'.pz-char')); await sleep(200); const t2=await v.evaluate(sel=>({tr:getComputedStyle(document.querySelector(sel)).translate, an:getComputedStyle(document.querySelector(sel)).animationName}), Q(ids3.pj,'.pz-char'));
  check('S35-44: comemorar: a ferramenta sobe junto com o braço (trilha pzToolUp, termina em 160°) e o confete não recebe o clique; “pular sem parar” + clique “pular”: na virada do ciclo o gesto (pzJumpG) toca de verdade, não congela (S38 devolveu o gesto aos gatilhos em laço)', s2b.conf==='none' && s2b.tool==='pzToolUp' && s2b.toolRot==='160deg' && s2b.pjAn==='pzJump' && t2.an==='pzJumpG' && t1!==t2.tr, {s2b, t1, t2});
  const pfb=await v.evaluate(sel=>{ const b=document.querySelector(sel).getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height*.6}; }, Q(ids3.pf,'.pz-char'));
  await v.mouse.click(pfb.x,pfb.y); await sleep(200);
  const pfg=await v.evaluate(([l,r,a])=>({tL:getComputedStyle(document.querySelector(l)).display, tR:getComputedStyle(document.querySelector(r)).display, an:getComputedStyle(document.querySelector(a)).animationName}),[Q(ids3.pf,'.pz-tL'),Q(ids3.pf,'.pz-tR'),Q(ids3.pf,'.pz-aR')]);
  const eyeR=await v.evaluate(sel=>{ const r=document.querySelector(sel).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; }, Q(ids3.pr,'.pz-eyes'));
  await v.mouse.move(eyeR.x-250, eyeR.y); await sleep(250); const lxr=await v.evaluate(sel=>parseFloat(document.querySelector(sel).style.getPropertyValue('--lx')), Q(ids3.pr));
  check('S35-45: gesto “acenar” num personagem que pensa (mão esquerda no queixo, direita acenando): nenhuma mão livre, a ferramenta some durante o gesto e o aceno toca (pzWaveG); personagem girado 180°: os olhos acompanham o mouse no referencial dele (mouse à esquerda na tela → pupilas para a direita do desenho, que está de cabeça para baixo)', pfg.tL==='none' && pfg.tR==='none' && pfg.an==='pzWaveG' && lxr>2, {pfg, lxr});
  const lb=await v.evaluate(sel=>{ const b=[...document.querySelectorAll(sel)]; const r=b.find(x=>x.textContent==='Longe').getBoundingClientRect(), f=b.find(x=>x.textContent==='Fico').getBoundingClientRect(); return {l:{x:r.x+r.width/2,y:r.y+r.height/2}, f:{x:f.x+f.width/2,y:f.y+f.height/2}}; }, Q(ids3.pd,'.pz-ch'));
  await v.mouse.click(lb.l.x,lb.l.y); await sleep(100); await v.mouse.click(lb.f.x,lb.f.y); await sleep(700);
  const stay=await v.evaluate(()=>document.querySelector('.amp-pos').textContent);
  check('S35-46: decidir “Longe” e, logo em seguida, “Fico” cancela o salto pendente (o slide fica)', /^02/.test(stay), stay);
  await v.close();
  /* editor: prévia com caminhada, efeitos recusados, pincel de formato, cores fora da paleta, Redefinir na cópia, alvo órfão, giro pela alça, reticências, vitrine */
  const pv=await p.evaluate(async ids3=>{ const A=AMStudio; A.goSlide(0); const e=A.deck.slides[0].els.find(x=>x.id===ids3.wi); e.data.aim=ids3.ch; e.data.act='apontar'; A.selectMany([e.id]); A.renderAll(); await new Promise(r=>setTimeout(r,120));
    const stg=document.querySelector('#cv .am-edit .am-el[data-id="'+e.id+'"] .pz'); const face=stg.dataset.face, aim=stg.style.getPropertyValue('--aim').trim();
    A.previewEl(); await new Promise(r=>setTimeout(r,3300)); const z=document.querySelector('.prevov .pz'); return z?{arr:z.classList.contains('pz-arr'), an:getComputedStyle(z.querySelector('.pz-aR')).animationName, face:z.dataset.face, aim:z.style.getPropertyValue('--aim').trim(), sFace:face, sAim:aim, fix:z.dataset.fix}:null; }, ids3);
  check('S35-47: “▶ Ver movimento no slide” com caminhada: a prévia chega (pz-arr), aponta (pzPoint) com o mesmo lado e a mesma mira do palco', pv && pv.arr && pv.an==='pzPoint' && pv.face===pv.sFace && pv.aim===pv.sAim && pv.fix==='1', pv);
  const ef=await p.evaluate(async ids3=>{ const A=AMStudio; const e=A.deck.slides[0].els.find(x=>x.id===ids3.wi); A.selectMany([e.id]); await new Promise(r=>setTimeout(r,150));
    const L=[...document.querySelectorAll('#props [data-set="anim.loop"]')].map(b=>b.dataset.v), Hh=[...document.querySelectorAll('#props [data-set="anim.hover"]')].map(b=>b.dataset.v);
    const bad=A.safeDeck({slides:[{id:'s1',els:[{id:'p1',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,data:{walk:800},anim:{in:'rise',loop:'pulse',hover:'ring'}},{id:'p2',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,data:{},anim:{in:'rise',loop:'pulse',hover:'tilt'}}]}]}).slides[0].els;
    A.gallery.tryFx('hover:ring'); await new Promise(r=>setTimeout(r,300)); const msg=(document.getElementById('gpTgt')||{}).textContent||''; A.gallery.discard(); A.openDrawer(false);
    return {L, H:Hh, b1:bad[0].anim, b2:bad[1].anim, msg}; }, ids3);
  check('S35-48: personagem que anda não recebe efeitos que giram/escalam em volta da caixa de origem (pulsar, batida, balançar, deriva, inclinar 3D, zoom, inclinar leve, holofote) nem os que contornam a caixa vazia (anéis, contorno, varrer luz, sublinhar); ao reabrir um arquivo esses efeitos saem; a vitrine explica sem “undefined”',
    !['shimmer','beacon','pulse','beat','wiggle','drift'].some(k=>ef.L.includes(k)) && ef.L.includes('float') && !['inzoom','ring','sheen','uline','tilt','zoom','lean','spot'].some(k=>ef.H.includes(k)) && ef.H.includes('lift') && !ef.b1.loop && !ef.b1.hover && ef.b2.loop==='pulse' && ef.b2.hover==='tilt' && !/undefined/.test(ef.msg) && /personagens/.test(ef.msg), ef);
  const fm=await p.evaluate(async ids3=>{ const A=AMStudio; A.goSlide(0); const c=A.insertFx('counter'); c.pal={p:'#C2185B',a:'#00A651'}; A.selectMany([c.id]); A.renderAll(); await new Promise(r=>setTimeout(r,100));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,altKey:true,bubbles:true})); await new Promise(r=>setTimeout(r,100));
    const e=A.deck.slides[0].els.find(x=>x.id===ids3.wi); A.selectMany([e.id]); await new Promise(r=>setTimeout(r,100)); document.dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true,altKey:true,bubbles:true})); await new Promise(r=>setTimeout(r,150));
    const hand=A.safeDeck({slides:[{id:'s1',els:[{id:'p1',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,variant:'mestre',data:{c1:'#00FF00',c2:'#FF00FF'}}]}]}).slides[0].els[0];
    const r=AMRT.personas.resolve(hand.data, hand); return {pal:!!e.pal, c1:r.c1, c2:r.c2}; }, ids3);
  check('S35-49: o pincel de formato não leva “Cores do componente” para o personagem; cores fora da paleta A&M num arquivo editado à mão voltam às do personagem', !fm.pal && fm.c1==='#4A6FA5' && fm.c2==='#002A46', fm);
  const tb=await p.evaluate(async()=>{ const A=AMStudio; A.appendSlides([{id:'sy',bg:'#FFFFFF',els:[{id:'c9',type:'fx',kind:'bars',x:620,y:100,w:600,h:300},{id:'p9',type:'fx',kind:'persona',variant:'consultor',x:40,y:100,w:300,h:380,data:Object.assign(JSON.parse(JSON.stringify(AMRT.FX.persona.data)),{aim:'c9',act:'apontar'})}]}], 1);
    await new Promise(r=>setTimeout(r,150)); A.dupSlide(1); await new Promise(r=>setTimeout(r,150)); const k=2, s=A.deck.slides[k], ch=s.els.find(e=>e.kind==='bars'), pz=s.els.find(e=>e.kind==='persona'); const cid=ch.id;
    s.els.splice(s.els.indexOf(ch),1); A.goSlide(k); A.renderAll(); A.commit(); A.resetSlide(k); await new Promise(r=>setTimeout(r,150));
    const s2=A.deck.slides[k], ch2=s2.els.find(e=>e.kind==='bars'), pz2=s2.els.find(e=>e.kind==='persona'), other=A.deck.slides[1].els.find(e=>e.kind==='bars');
    return {restored:!!ch2, sameId:ch2&&ch2.id===cid, notOrig:ch2&&ch2.id!==other.id, aimOk:pz2.data.aim===(ch2&&ch2.id)}; });
  check('S35-50: “Duplicar slide” → apagar o gráfico na cópia → “Redefinir slide”: o gráfico volta com o id da cópia (não o do slide de origem) e o personagem continua apontando para ele', tb.restored && tb.sameId && tb.notOrig && tb.aimOk, tb);
  const orf=await p.evaluate(async()=>{ const A=AMStudio; const k=2, s=A.deck.slides[k], pz=s.els.find(e=>e.kind==='persona'), ch=s.els.find(e=>e.kind==='bars'); s.els.splice(s.els.indexOf(ch),1); A.goSlide(k); A.renderAll(); A.commit(); A.selectMany([pz.id]); await new Promise(r=>setTimeout(r,150));
    const sl=document.querySelector('#props select[data-p="data.aim"]'); const o0=sl.options[sl.selectedIndex].textContent; sl.value=''; sl.dispatchEvent(new Event('input',{bubbles:true})); sl.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,150));
    return {o0, aim:A.deck.slides[k].els.find(e=>e.kind==='persona').data.aim}; });
  check('S35-51: alvo apagado: o seletor “Aponta para” mostra “(alvo que não está neste slide)” selecionado e escolher “Nenhum” limpa o alvo', /não está neste slide/.test(orf.o0) && orf.aim==='', orf);
  const rt=await p.evaluate(async()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null); const ch=A.insertFx('bars'); ch.x=880; ch.y=60; ch.w=360; ch.h=220; const z=A.insertFx('persona',null,null,'consultor'); z.x=300; z.y=300; Object.assign(z.data,{aim:ch.id,act:'apontar',bubble:'none'}); A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,120));
    const n=document.querySelector('#cv .am-edit .am-el[data-id="'+z.id+'"]'), pz=n.querySelector('.pz'), a0=parseFloat(pz.style.getPropertyValue('--aim'));
    z.rot=45; n.querySelector('.am-rot').style.transform='rotate(45deg)'; document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); await new Promise(r=>setTimeout(r,120));
    return {rot:pz.dataset.rot, a0, a1:parseFloat(pz.style.getPropertyValue('--aim'))}; });
  check('S35-52: girar pela alça (o palco não redesenha): ao soltar, o personagem relê o giro e reaponta (≈ mira sem giro − 45°)', rt.rot==='45.00' && Math.abs(rt.a1-(rt.a0-45))<8, rt);
  const ov=await p.evaluate(async()=>{ const A=AMStudio; const z=A.insertFx('persona',null,null,'eng'); z.x=40; z.y=40; z.w=120; z.h=150; z.data.say='Uma fala comprida demais para um personagem tão pequeno: não cabe nem com a menor letra, então o balão corta com reticências e o editor avisa com um contorno.'; A.selectMany([]); A.renderAll(); await new Promise(r=>setTimeout(r,120));
    const n=document.querySelector('#cv .am-edit .am-el[data-id="'+z.id+'"] .pz'), t=n.querySelector('.pz-s1 .pz-txt'); return {over:n.classList.contains('pz-over'), clamp:getComputedStyle(t).webkitLineClamp, outline:getComputedStyle(n.querySelector('.pz-say')).outlineStyle, fs:parseFloat(getComputedStyle(n.querySelector('.pz-say')).fontSize)}; });
  const six=await p.evaluate(async()=>{ const A=AMStudio; const z=A.insertFx('persona',null,null,'ia'); z.x=700; z.y=200; z.data.say='Escolha uma das seis opções a seguir'; z.data.choices=[1,2,3,4,5,6].map(i=>({t:'Opção número '+i,go:0})); A.selectMany([]); A.renderAll(); await new Promise(r=>setTimeout(r,120));
    const n=document.querySelector('#cv .am-edit .am-el[data-id="'+z.id+'"]'), say=n.querySelector('.pz-say').getBoundingClientRect(); const bs=[...n.querySelectorAll('.pz-ch')].map(b=>b.getBoundingClientRect()); return {n:bs.length, inside:bs.every(b=>b.top>=say.top-1&&b.bottom<=say.bottom+1&&b.left>=say.left-1&&b.right<=say.right+1), s1:n.querySelector('.pz-s1').getBoundingClientRect().height, over:n.querySelector('.pz').classList.contains('pz-over')}; });
  check('S35-53: fala que não cabe nem com a menor letra: reticências (line-clamp) e contorno tracejado no editor; seis decisões cabem inteiras no balão com a fala visível', ov.over && ov.clamp!=='none' && ov.outline==='dashed' && six.n===6 && six.inside && six.s1>5 && !six.over, {ov, six});
  const gv=await p.evaluate(async()=>{ const A=AMStudio; A.gallery.open('all','mestre de obras'); await new Promise(r=>setTimeout(r,400)); const bx=document.querySelector('#drawerBody .gx-box[data-gx="cmp:persona"]'); const b=bx.querySelector('.gx-ins'); const v=b&&b.dataset.v;
    const n0=A.deck.slides[A.cur].els.length; b.click(); await new Promise(r=>setTimeout(r,250)); const s=A.deck.slides[A.cur], e=s.els[s.els.length-1]; A.openDrawer(false); return {v, ins:s.els.length===n0+1 && e.kind==='persona' && e.variant}; });
  check('S35-54: vitrine: buscar “mestre de obras” faz o card do personagem inserir o Mestre de obras', gv.v==='mestre' && gv.ins==='mestre', gv);
  await p.screenshot({path:SH('rodada2')});
  }
  /* ---------- rodada 3: chegada só com a pose, gesto na virada do ciclo, laço sem gesto, “Fala ao clicar” que não cabe, seis decisões num boneco pequeno,
     efeitos recusados ao ligar “Andar até”, pontas presas da base depois de reabrir, vitrine por palavra, prévia depois de trocar o preset, duração da prévia ---------- */
  {
  const LONG='Esta é uma fala ao clicar comprida de propósito: não cabe num boneco pequeno nem com a menor letra, então o balão precisa cortar com reticências em vez de vazar por cima das decisões e do resto do slide.';
  const ids4=await p.evaluate(LONG=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null);
    const mk=(v,x,y,w,h,d)=>{ const z=A.insertFx('persona',null,null,v); z.x=x; z.y=y; z.w=w; z.h=h; Object.assign(z.data,{bubble:'none'},d); return z; };
    const pk=mk('eng',20,380,200,300,{walk:300,act:'comemorar',trig:'click'}), ph=mk('dev',20,40,200,300,{walk:300,act:'pular',trig:'hover'});
    const pg=mk('analista',560,40,200,300,{act:'acenar',trig:'loop',act2:'apontar'}), pn=mk('ia',780,40,200,300,{act:'acenar',trig:'loop',act2:'none'});
    const ps=mk('consultora',560,420,180,240,{bubble:'fala',say:'Oi!',say2:LONG+' '+LONG+' '+LONG,trig:'in',act:'parado',act2:'none'});
    const p6=mk('ia',1000,380,240,300,{bubble:'fala',say:'Escolha um caminho para seguir agora',choices:[1,2,3,4,5,6].map(i=>({t:'Caminho número '+i+' com uma decisão comprida',go:0})),trig:'in',act:'parado'});
    A.selectMany([]); A.renderAll(); A.commit(); return {pk:pk.id, ph:ph.id, pg:pg.id, pn:pn.id, ps:ps.id, p6:p6.id}; }, LONG);
  const h4=await p.evaluate(()=>AMStudio.exportHTML()); const hp4=path.join(TMP,'pz4.html'); fs.writeFileSync(hp4,h4);
  const v=await open(ctx,'file://'+hp4,'player4');
  const Q=(id,sel)=>'.amp-slide.on .am-el[data-id="'+id+'"] '+(sel||'.pz');
  await v.waitForFunction(sel=>document.querySelector(sel).classList.contains('pz-arr'), Q(ids4.pk), {timeout:9000});
  const ar0=await v.evaluate(([a,z,c])=>({an:getComputedStyle(document.querySelector(a)).animationName, pose:document.querySelector(z).classList.contains('pz-pose'), conf:[...document.querySelectorAll(c)].map(x=>getComputedStyle(x).animationName).filter(n=>n!=='pzNone'&&n!=='none').length}),[Q(ids4.pk,'.pz-aR'),Q(ids4.pk),Q(ids4.pk,'.pz-conf circle')]);
  await v.waitForFunction(sel=>document.querySelector(sel).classList.contains('pz-arr'), Q(ids4.ph), {timeout:9000}); await sleep(250);
  const hj=await v.evaluate(sel=>getComputedStyle(document.querySelector(sel)).animationName, Q(ids4.ph,'.pz-char'));
  await sleep(800);
  const ar1=await v.evaluate(([a,z])=>({an:getComputedStyle(document.querySelector(a)).animationName, rot:getComputedStyle(document.querySelector(a)).rotate, pose:document.querySelector(z).classList.contains('pz-pose')}),[Q(ids4.pk,'.pz-aR'),Q(ids4.pk)]);
  check('S35-55: “Andar até” com “Só ao clicar” / “Ao passar o mouse”: na chegada só os braços vão para a pose (pzPoseR ×1, sem confete) e ficam nela; o boneco que pula ao passar o mouse não pula sozinho',
    ar0.pose && ar0.an==='pzPoseR' && ar0.conf===0 && hj!=='pzJump' && !ar1.pose && ar1.an==='pzNone' && Math.abs(Math.abs(parseFloat(ar1.rot))-160)<1, {ar0, hj, ar1});
  /* gesto em laço: espera a virada do ciclo (todas as trilhas na pose) e só então toca */
  const gs=await v.evaluate(async sel=>{ const pz=document.querySelector(sel), T={it:[], go:0, click:0};
    pz.addEventListener('animationiteration', e=>{ if(/\bpz-(aR|aL|char|torso|mouth)\b/.test(e.target.getAttribute('class')||'')) T.it.push(performance.now()); });
    new MutationObserver(()=>{ if(!T.go && pz.classList.contains('pz-go')) T.go=performance.now(); }).observe(pz,{attributes:true, attributeFilter:['class']});
    await new Promise(r=>setTimeout(r,500)); const ch=pz.querySelector('.pz-char').getBoundingClientRect(); T.click=performance.now();
    pz.querySelector('.pz-char').dispatchEvent(new MouseEvent('click',{bubbles:true, clientX:ch.x+ch.width/2, clientY:ch.y+ch.height*.6}));
    const early=pz.classList.contains('pz-go'); await new Promise(r=>setTimeout(r,2900)); const an=T.go?getComputedStyle(pz.querySelector('.pz-aR')).animationName:'';
    const near=T.it.filter(t=>t<=T.go+5).map(t=>T.go-t).sort((a,b)=>a-b)[0]; return {early, wait:Math.round(T.go-T.click), near:near==null?null:Math.round(near), go:!!T.go}; }, Q(ids4.pg));
  const gan=await v.evaluate(sel=>getComputedStyle(document.querySelector(sel)).animationName, Q(ids4.pg,'.pz-aR'));
  check('S35-56: clique num personagem “Sem parar”: o gesto espera a virada do ciclo (começa da pose, sem salto) e toca em seguida (S38: virada medida no próprio laço)', gs.go && !gs.early && gs.near!=null && gs.near<60 && gs.wait<2800, {gs, gan});
  const ln=await v.evaluate(async sel=>{ const pz=document.querySelector(sel), a=pz.querySelector('.pz-aR'), an0=a.getAnimations()[0], t0=an0&&an0.currentTime, d0=getComputedStyle(a).animationDelay;
    const ch=pz.querySelector('.pz-char').getBoundingClientRect(); pz.querySelector('.pz-char').dispatchEvent(new MouseEvent('click',{bubbles:true, clientX:ch.x+ch.width/2, clientY:ch.y+ch.height*.6}));
    await new Promise(r=>setTimeout(r,120)); const an1=a.getAnimations()[0]; return {same:an0===an1, adv:an1?an1.currentTime-t0:null, d0, d1:getComputedStyle(a).animationDelay, g1:pz.classList.contains('pz-g1'), pos:document.querySelector('.amp-pos').textContent}; }, Q(ids4.pn));
  check('S35-57: “Sem parar” com “Movimento ao clicar = Nenhum”: o clique não reinicia nem atrasa o laço (mesma animação, mesmo atraso) e não troca de slide', ln.same && ln.adv>60 && ln.d0===ln.d1 && !ln.g1 && /^01/.test(ln.pos), ln);
  const sb=await v.evaluate(async sel=>{ const pz=document.querySelector(sel), ch=pz.querySelector('.pz-char').getBoundingClientRect();
    pz.querySelector('.pz-char').dispatchEvent(new MouseEvent('click',{bubbles:true, clientX:ch.x+ch.width/2, clientY:ch.y+ch.height*.6})); await new Promise(r=>setTimeout(r,400));
    const say=pz.querySelector('.pz-say').getBoundingClientRect(), t=pz.querySelector('.pz-s2 .pz-txt'), r=t.getBoundingClientRect();
    return {on:pz.classList.contains('pz-on'), over:pz.classList.contains('pz-over'), clamp:getComputedStyle(t).webkitLineClamp, inside:r.top>=say.top-1 && r.bottom<=say.bottom+1, h:Math.round(r.height)}; }, Q(ids4.ps));
  check('S35-58: “Fala ao clicar” que não cabe: no player ela também sai cortada com reticências, dentro do balão', sb.on && sb.over && sb.clamp!=='none' && sb.inside && sb.h>5, sb);
  const six=await v.evaluate(sel=>{ const pz=document.querySelector(sel), bs=[...pz.querySelectorAll('.pz-ch')]; return bs.map(b=>{ b.scrollIntoView({block:'nearest'}); const r=b.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return !!(hit && hit.closest('.pz-ch')===b); }); }, Q(ids4.p6));
  check('S35-59: boneco pequeno (240×300) com seis decisões compridas: todas ficam alcançáveis no player (cabem ou rolam dentro do balão)', six.length===6 && six.every(Boolean), six);
  await v.close();
  /* editor */
  const tip=await p.evaluate(async id=>{ const A=AMStudio; A.selectMany([id]); await new Promise(r=>setTimeout(r,150)); const t=document.querySelector('#props .vtip'); const a=t?t.textContent:''; A.selectMany([]); return a; }, ids4.ps);
  check('S35-60: personagem com fala que não cabe: o painel avisa (“⚠ A fala não cabe no balão…”)', /^⚠ A fala não cabe no balão/.test(tip), tip.slice(0,80));
  const sr=await p.evaluate(async()=>{ const A=AMStudio; const z=A.insertFx('persona',null,null,'mestre'); z.x=40; z.y=40; z.anim=Object.assign(z.anim||{},{loop:'pulse',hover:'tilt'}); A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,150));
    const i=document.querySelector('#props input[data-p="data.walk"]'); i.value='600'; i.dispatchEvent(new Event('input',{bubbles:true})); const mid=z.anim.loop; i.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,150));
    const e=A.deck.slides[A.cur].els.find(x=>x.id===z.id); return {mid, loop:e.anim.loop, hover:e.anim.hover, walk:e.data.walk, toast:document.getElementById('toast').textContent}; });
  check('S35-61: ligar “Andar até” num personagem com Pulsar e Inclinar 3D: os dois saem ao confirmar o campo (não a cada tecla), com aviso', sr.mid==='pulse' && sr.loop==='none' && sr.hover==='none' && +sr.walk===600 && /Andar até/.test(sr.toast), sr);
  const bs=await p.evaluate(async()=>{ const A=AMStudio; const at=A.deck.slides.length;
    A.appendSlides([{id:'sq',bg:'#FFFFFF',els:[{id:'q1',type:'fx',kind:'persona',variant:'dev',x:60,y:200,w:300,h:380,data:{}},{id:'q2',type:'line',x1:900,y1:120,x2:210,y2:200,stroke:'#002A46',strokeW:3,a2:{id:'q1',s:'n'}}]}], at);
    await new Promise(r=>setTimeout(r,100)); const dk=A.safeDeck(JSON.parse(JSON.stringify(A.deck))); A.loadDeck(dk,null); A.goSlide(at); await new Promise(r=>setTimeout(r,100));
    const s=A.deck.slides[at], pz=s.els.find(e=>e.kind==='persona'), l=s.els.find(e=>e.type==='line'); const before=l.a2&&l.a2.id===pz.id; delete l.a2; l.x2=500; l.y2=600; A.renderAll(); A.commit(); A.resetSlide(at); await new Promise(r=>setTimeout(r,150));
    const l2=A.deck.slides[at].els.find(e=>e.type==='line'); return {before, a2:l2.a2&&l2.a2.id===pz.id, x2:l2.x2}; });
  check('S35-62: ponta presa ao personagem: depois de salvar e reabrir, “Redefinir slide” devolve a linha presa (a1/a2 na base)', bs.before && bs.a2, bs);
  const gv=await p.evaluate(async()=>{ const A=AMStudio, out={}; for(const q of ['consultor','ia','robô','personagem']){ A.gallery.open('all',q); await new Promise(r=>setTimeout(r,300)); const bx=document.querySelector('#drawerBody .gx-box[data-gx="cmp:persona"]'); out[q]=[bx.dataset.v||'', bx.querySelector('.gx-ft b').textContent]; A.openDrawer(false); await new Promise(r=>setTimeout(r,100)); } return out; });
  check('S35-63: vitrine por palavra: “consultor” → Consultor (não a Consultora), “ia” e “robô” → IA; “personagem” não escolhe ninguém; o título do card diz qual', gv.consultor[0]==='consultor' && /· Consultor$/.test(gv.consultor[1]) && gv.ia[0]==='ia' && gv['robô'][0]==='ia' && gv.personagem[0]==='' && !/·/.test(gv.personagem[1]), gv);
  const pv=await p.evaluate(async()=>{ const A=AMStudio; A.goSlide(0); const ch=A.insertFx('bars'); ch.x=40; ch.y=60; ch.w=360; ch.h=220; const z=A.insertFx('persona',null,null,'eng'); z.x=900; z.y=300; Object.assign(z.data,{aim:ch.id,act:'apontar',bubble:'none'}); A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,150));
    document.querySelector('#props [data-var="consultor"]').click(); A.previewEl(); const q=document.querySelector('.prevov .pz'), r={face:q&&q.dataset.face, aim:q&&q.style.getPropertyValue('--aim').trim()}; A.stopPreview&&A.stopPreview(); await new Promise(r=>setTimeout(r,150));
    const s=document.querySelector('#cv .am-edit .am-el[data-id="'+z.id+'"] .pz'); r.sFace=s.dataset.face; r.sAim=s.style.getPropertyValue('--aim').trim(); r.v=A.deck.slides[0].els.find(e=>e.id===z.id).variant; return r; });
  check('S35-64: trocar o preset e abrir a prévia na hora: o personagem da prévia vira para o alvo com a mesma mira do palco', pv.v==='consultor' && pv.face===pv.sFace && pv.aim===pv.sAim && pv.aim!=='' && pv.aim!=='-100deg', pv);
  const pd=await p.evaluate(async()=>{ const A=AMStudio; const z=A.insertFx('persona',null,null,'dev'); z.x=20; z.y=320; Object.assign(z.data,{walk:900,act:'acenar',trig:'in',bubble:'none'}); z.anim=Object.assign(z.anim||{},{in:'rise',dur:1500,delay:300}); A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,150));
    const wt=parseFloat(document.querySelector('#cv .am-edit .am-el[data-id="'+z.id+'"] .pz').style.getPropertyValue('--wt'))||0; A.previewEl(); const t0=performance.now();
    await new Promise(r=>setTimeout(r,300+1500+wt+350)); const q=document.querySelector('.prevov .pz'); const r={wt, open:!!q, arr:!!q&&q.classList.contains('pz-arr'), dt:Math.round(performance.now()-t0)};
    while(document.querySelector('.prevov') && performance.now()-t0<20000) await new Promise(r=>setTimeout(r,200)); r.closed=Math.round(performance.now()-t0); return r; });
  check('S35-65: prévia com entrada longa + caminhada: fica aberta até o personagem chegar e fazer o movimento, e depois fecha sozinha', pd.wt>1000 && pd.open && pd.arr && pd.closed>pd.dt && pd.closed<20000, pd);
  const tp=await p.evaluate(async()=>{ const A=AMStudio; const z=A.insertFx('persona',null,null,'consultora'); z.x=40; z.y=40; z.w=200; z.h=260; z.data.say='Oi!'; A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,150));
    const set=async v=>{ const t=document.querySelector('#props textarea[data-p="data.say"]'); t.value=v; t.dispatchEvent(new Event('input',{bubbles:true})); t.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,150)); return (document.querySelector('#props .vtip')||{}).textContent||''; };
    const long=await set('Uma fala comprida demais para este tamanho: '.repeat(12)), short=await set('Oi de novo!'); return {long:/^⚠/.test(long), short:/^⚠/.test(short)}; });
  check('S35-66: o aviso “a fala não cabe” acompanha a edição feita no próprio painel (aparece com a fala longa e some ao encurtar)', tp.long && !tp.short, tp);
  const un=await p.evaluate(async()=>{ const A=AMStudio; const z=A.insertFx('persona',null,null,'mestre'); z.x=40; z.y=40; z.anim=Object.assign(z.anim||{},{loop:'pulse'}); A.selectMany([z.id]); A.renderAll(); A.commit(); await new Promise(r=>setTimeout(r,150));
    const i=document.querySelector('#props input[data-p="data.walk"]'); i.value='700'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,150));
    if(document.activeElement) document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true})); await new Promise(r=>setTimeout(r,150));
    const e=A.deck.slides[A.cur].els.find(x=>x.id===z.id); return {walk:e.data.walk, loop:e.anim.loop}; });
  check('S35-67: um só Ctrl+Z desfaz “Andar até” e a retirada dos efeitos juntos (nunca sobra caminhada com Pulsar)', (un.walk===''||un.walk==null) && un.loop==='pulse', un);
  const vs=await p.evaluate(async()=>{ const A=AMStudio; const z=A.insertFx('persona',null,null,'ia'); z.data.tool='prancheta'; A.selectMany([]); A.renderAll(); await new Promise(r=>setTimeout(r,120));
    const n=document.querySelector('#cv .am-edit .am-el[data-id="'+z.id+'"] .pz'), v=n.querySelector('.pz-vs path'), k=n.querySelector('.pz-tR .pz-k2'); return {vis:v&&getComputedStyle(v).display, vw:v&&v.getBoundingClientRect().width, tool:k&&getComputedStyle(k).display, sw:k&&getComputedStyle(k).strokeWidth}; });
  check('S35-68: a linha do visor da IA e os traços da prancheta são desenhados (a classe de espessura não colide mais com a “Fala ao clicar”)', vs.vis!=='none' && vs.vw>5 && vs.tool!=='none' && vs.sw==='2px', vs);
  const pn=await p.evaluate(async()=>{ const A=AMStudio; const ch=A.insertFx('bars'); ch.x=880; ch.y=60; const z=A.insertFx('persona',null,null,'consultor'); z.x=300; z.y=300; Object.assign(z.data,{aim:ch.id,act:'apontar',trig:'in',bubble:'none'}); z.anim=Object.assign(z.anim||{},{in:'rise',dur:1500,delay:1500}); A.selectMany([z.id]); A.renderAll(); await new Promise(r=>setTimeout(r,150));
    A.previewEl(); await new Promise(r=>setTimeout(r,5300)); const open=!!document.querySelector('.prevov'); while(document.querySelector('.prevov')) await new Promise(r=>setTimeout(r,200)); return {open}; });
  check('S35-69: prévia de um personagem sem caminhada, com entrada lenta: fica aberta até o movimento terminar', pn.open, pn);
  }
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
