/* S36 — Estúdio do personagem (ed-46-personas.js/.css) e ligação com os slides (rt-70-personas.js/.css): o painel vira um estúdio visual
   (elenco em miniaturas, abas Visual/Cores/Movimento/Fala/Ligar, peças e poses em miniatura, amostras da paleta A&M, 🎲 Surpresa,
   campos originais em “Ajustes finos”); “Ao clicar nele, ir para o slide N”; o mesmo personagem em vários slides (personagem guia),
   com roupa e cores sincronizadas e, na apresentação, a caminhada da posição do slide anterior até a nova; gesto do clique só com
   “Ao entrar”; wordmark embutido uma vez só (orçamento de tamanho).
   Uso: python3 assemble.py && node test-s36-estudio.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s36-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s36'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
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
  /* ---------- 0. wordmark embutido uma vez só ---------- */
  const html=fs.readFileSync(path.join(__dirname,'AM-Studio-Editor.html'),'utf8');
  const wm=(html.match(/data:image\/png;base64,[A-Za-z0-9+/=]{5000,}/g)||[]).reduce((m,u)=>{ m[u]=(m[u]||0)+1; return m; },{});
  const cv=await open(ctx, FILE, 'capa');
  const cw=await cv.evaluate(()=>{ const c=document.querySelector('.cv-wm'), t=document.querySelector('img.brand-wm'); return {c:c&&c.naturalWidth, src:c&&c.src===t.src, t:t.naturalWidth, brand:/^data:image\/png/.test(AMStudio.BRAND.wmW)}; });
  await cv.close();
  check('S36-01: cada imagem PNG grande aparece uma vez só no HTML (o wordmark branco não é mais repetido 3×); capa, topo do editor e BRAND.wmW mostram o mesmo wordmark', Object.values(wm).every(n=>n===1) && cw.c>0 && cw.src && cw.t>0 && cw.brand, {wm:Object.values(wm), cw});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=id=>p.evaluate(id=>{ for(const s of AMStudio.deck.slides){ const e=s.els.find(x=>x.id===id); if(e) return JSON.parse(JSON.stringify(e)); } return null; }, id);
  const undo=async()=>{ await p.evaluate(()=>{ if(document.activeElement) document.activeElement.blur(); }); await p.keyboard.press('Control+z'); await sleep(250); };
  /* ---------- 1. o estúdio no painel ---------- */
  const id=await p.evaluate(()=>{ const A=AMStudio; A.addSlide('blank-light'); A.addSlide('blank-light'); A.goSlide(0); const z=A.insertFx('persona',null,null,'eng'); z.x=60; z.y=300; A.selectMany([z.id]); A.renderAll(); return z.id; });
  await sleep(300);
  const st=await p.evaluate(()=>{ const P=document.getElementById('props'), z=P.querySelector('.pzs'), fine=P.querySelector('details.pzs-fine');
    return {z:!!z, cast:z?z.querySelectorAll('.pzs-g5 [data-var]').length:0, on:(z.querySelector('.pzs-g5 .on')||{}).dataset, tabs:[...z.querySelectorAll('[data-pzs-tab]')].map(t=>t.textContent).join('|'), oldChips:P.querySelectorAll('.chip[data-var]').length,
      fine:!!fine, closed:fine&&!fine.open, inFine:!!(fine&&fine.querySelector('select[data-p="data.hat"]')), parts:z.querySelectorAll('[data-pzs-part]').length, tiles:z.querySelectorAll('.pzs-g:not(.pzs-g5) .pzs-t').length, svg:!!z.querySelector('.pzs-t svg.pz-svg'), rnd:!!z.querySelector('[data-pzs=rnd]')}; });
  await (await p.$('#props')).screenshot({path:SH('estudio')});
  const other=await p.evaluate(async()=>{ const A=AMStudio; const c=A.insertFx('counter'); A.selectMany([c.id]); A.renderAll(); await new Promise(r=>setTimeout(r,120)); const r=!!document.querySelector('#props .pzs'); const s=A.deck.slides[0]; s.els.splice(s.els.indexOf(c),1); A.renderAll(); A.commit(); return r; });
  check('S36-02: personagem selecionado: estúdio com o elenco (10 miniaturas, a atual marcada), abas Visual · Cores · Movimento · Fala · Ligar, 🎲 Surpresa, peças em miniatura (Roupa: 8 opções); as fichas antigas saem e os campos originais ficam em “Ajustes finos”, recolhido; outro componente não ganha estúdio',
    st.z && st.cast===10 && st.on && st.on.var==='eng' && st.tabs==='Visual|Cores|Movimento|Fala|Ligar' && st.oldChips===0 && st.fine && st.closed && st.inFine && st.parts===6 && st.tiles===8 && st.svg && st.rnd && !other, {st, other});
  await p.evaluate(()=>AMStudio.selectMany([document.querySelector('#cv .am-edit .am-el .pz').closest('.am-el').dataset.id])); await sleep(200);
  await p.click('#props .pzs [data-pzs="outfit"][data-v="jaleco"]'); await sleep(300);
  const o1=await D(id); const jal=await p.evaluate(id=>!!document.querySelector('#cv .am-edit .am-el[data-id="'+id+'"] .pz-svg') && AMRT.personas.resolve(AMStudio.deck.slides[0].els.find(e=>e.id===id).data,{variant:'eng'}).outfit, id);
  await undo(); const o2=await D(id);
  check('S36-03: Visual › Roupa: clicar na miniatura “Jaleco” veste o personagem no palco (um passo de desfazer volta ao “Do personagem”)', o1.data.outfit==='jaleco' && jal==='jaleco' && (o2.data.outfit||'')==='', {o1:o1.data.outfit, jal, o2:o2.data.outfit});
  await p.click('#props .pzs [data-pzs-part="hat"]'); await sleep(200);
  const hatTiles=await p.evaluate(()=>[...document.querySelectorAll('#props .pzs .pzs-g:not(.pzs-g5) [data-pzs="hat"]')].map(t=>t.dataset.v).join(','));
  await p.click('#props .pzs [data-pzs="hat"][data-v="capO"]'); await sleep(250);
  await p.click('#props .pzs [data-var="mestre"]'); await sleep(450);
  const o3=await D(id);
  check('S36-04: a aba Visual troca de peça (Chapéu: 8 miniaturas, recortadas na cabeça); escolher outro do elenco (Mestre de obras) veste o preset inteiro e limpa as peças trocadas à mão', hatTiles.split(',').length===8 && o3.variant==='mestre' && (o3.data.hat||'')==='' , {hatTiles, v:o3.variant, hat:o3.data.hat});
  /* cores, surpresa */
  await p.click('#props .pzs [data-pzs-tab="cor"]'); await sleep(200);
  const sw=await p.evaluate(()=>[...document.querySelectorAll('#props .pzs [data-pzs="c1"]')].map(b=>b.dataset.v));
  await p.click('#props .pzs [data-pzs="c1"][data-v="'+sw[3]+'"]'); await sleep(250);
  const c1=await p.evaluate(id=>({m:AMStudio.deck.slides[0].els.find(e=>e.id===id).data.c1, css:document.querySelector('#cv .am-edit .am-el[data-id="'+id+'"] .pz').style.getPropertyValue('--c1').trim()}), id);
  await p.click('#props .pzs [data-pzs="c1"][data-v=""]'); await sleep(250); const c1b=(await D(id)).data.c1;
  check('S36-05: Cores: as amostras são a paleta A&M do campo “Cor do corpo” (com o círculo dividido = do personagem); clicar pinta o corpo no palco; o círculo dividido volta à cor do personagem', sw[0]==='' && sw.length>=6 && c1.m===sw[3] && c1.css.toUpperCase()===sw[3].toUpperCase() && (c1b||'')==='', {sw, c1, c1b});
  await p.click('#props .pzs [data-pzs="rnd"]'); await sleep(300); const rz=await D(id);
  await undo(); const rz2=await D(id);
  const KS=['outfit','hat','hair','glasses','tool','c1','c2','mood'];
  check('S36-06: 🎲 Surpresa sorteia roupa, chapéu, cabelo, óculos, ferramenta, expressão e as duas cores (todas das listas do componente); um Ctrl+Z desfaz tudo', KS.every(k=>rz.data[k]) && KS.every(k=>!(rz2.data[k])), {rz:KS.map(k=>rz.data[k]), rz2:KS.map(k=>rz2.data[k]||'')});
  /* movimento */
  await p.click('#props .pzs [data-pzs-tab="mov"]'); await sleep(200);
  const mv0=await p.evaluate(()=>({acts:document.querySelectorAll('#props .pzs .pzs-g:not(.pzs-g5) [data-pzs="act"]').length, g:document.querySelectorAll('#props .pzs [data-pzs="act2"]').length, trig:[...document.querySelectorAll('#props .pzs [data-pzs="trig"]')].map(b=>b.textContent).join('|')}));
  await p.click('#props .pzs [data-pzs="act"][data-v="pensar"]'); await sleep(250);
  await p.click('#props .pzs [data-pzs="trig"][data-v="loop"]'); await sleep(250);
  const mv1=await p.evaluate(id=>({act:AMStudio.deck.slides[0].els.find(e=>e.id===id).data.act, trig:AMStudio.deck.slides[0].els.find(e=>e.id===id).data.trig, g:document.querySelectorAll('#props .pzs [data-pzs="act2"]').length, a2:document.querySelector('#cv .am-edit .am-el[data-id="'+id+'"] .pz').dataset.act2, pose:document.querySelector('#cv .am-edit .am-el[data-id="'+id+'"] .pz').dataset.act}), id);
  check('S36-07: Movimento: 10 poses em miniatura, 4 gatilhos e “Gesto ao clicar” (só com “Ao entrar”); “Pensar” + “Sem parar”: o gesto do clique some do painel e o personagem sai com data-act2 = none (corte de escopo da S36)', mv0.acts===10 && mv0.g===10 && mv0.trig.split('|').length===4 && mv1.act==='pensar' && mv1.trig==='loop' && mv1.g===0 && mv1.a2==='none' && mv1.pose==='pensar', {mv0, mv1});
  /* fala */
  await p.click('#props .pzs [data-pzs-tab="fala"]'); await sleep(200);
  await p.fill('#props .pzs textarea[data-pzs-proxy="data.say"]','Oi, time!'); await sleep(200);
  const fl1=await p.evaluate(id=>({m:AMStudio.deck.slides[0].els.find(e=>e.id===id).data.say, stage:(document.querySelector('#cv .am-edit .am-el[data-id="'+id+'"] .pz-s1')||{}).textContent, focus:document.activeElement&&document.activeElement.dataset.pzsProxy}), id);
  await p.click('#props .pzs [data-pzs="bubble"][data-v="grita"]'); await sleep(250); await p.click('#props .pzs [data-pzs="bcol"][data-v="laranja"]'); await sleep(250);
  const fl2=await D(id);
  check('S36-08: Fala: o texto digitado no estúdio vai ao vivo para o balão do palco (o foco fica no campo); “Grito” e a cor laranja mudam o balão', fl1.m==='Oi, time!' && /Oi, time!/.test(fl1.stage) && fl1.focus==='data.say' && fl2.data.bubble==='grita' && fl2.data.bcol==='laranja', {fl1, b:fl2.data.bubble, c:fl2.data.bcol});
  /* ligar: ir para o slide, aparece nos slides */
  await p.click('#props .pzs [data-pzs-tab="lig"]'); await sleep(200);
  await p.selectOption('#props .pzs select[data-pzs-proxy="data.link"]','3'); await sleep(250);
  const lk=await D(id);
  const chipsS=await p.evaluate(()=>[...document.querySelectorAll('#props .pzs [data-pzs-slide]')].map(b=>b.textContent+(b.disabled?'d':'')+(b.classList.contains('on')?'*':'')).join(','));
  await p.click('#props .pzs [data-pzs-slide="1"]'); await sleep(300); await p.click('#props .pzs [data-pzs-slide="2"]'); await sleep(300);
  const gp=await p.evaluate(id=>{ const A=AMStudio, me=A.deck.slides[0].els.find(e=>e.id===id), g=me.data.grp, cps=[1,2].map(i=>A.deck.slides[i].els.find(e=>e.kind==='persona')); return {g, cps:cps.map(c=>c&&{grp:c.data.grp, id:c.id!==id, in:c.anim&&c.anim.in, aim:c.data.aim, v:c.variant}), chips:[...document.querySelectorAll('#props .pzs [data-pzs-slide].on')].length}; }, id);
  check('S36-09: Ligar: “Ao clicar nele” guarda o nº do slide (data.link = 3, número); “Aparece nos slides” lista 1–3 (o atual travado) e marcar 2 e 3 põe nesses slides uma cópia do mesmo personagem (mesmo grupo, id novo, sem entrada nem alvo)',
    lk.data.link===3 && chipsS==='1d*,2,3' && /^g[\w-]+$/.test(gp.g) && gp.cps.every(c=>c&&c.grp===gp.g&&c.id&&c.in==='none'&&!c.aim&&c.v==='mestre') && gp.chips===3, {link:lk.data.link, chipsS, gp});
  /* sincronia do visual no grupo */
  await p.click('#props .pzs [data-pzs-tab="look"]'); await sleep(200); await p.click('#props .pzs [data-pzs-part="outfit"]'); await sleep(200);
  await p.evaluate(()=>{ const A=AMStudio; A.deck.slides[1].els.find(e=>e.kind==='persona').data.say='Slide 2'; A.commit(); });
  await p.click('#props .pzs [data-pzs="outfit"][data-v="moletom"]'); await sleep(300);
  const sy=await p.evaluate(id=>{ const A=AMStudio, g=A.deck.slides[0].els.find(e=>e.id===id).data.grp; return AMPersonas.groupEls(g).map(e=>e.data.outfit+'/'+e.data.say); }, id);
  await p.click('#props .pzs-fine > summary'); await sleep(150);
  await p.selectOption('#props select[data-p="data.glasses"]','round'); await sleep(300);
  const sy2=await p.evaluate(id=>{ const A=AMStudio, g=A.deck.slides[0].els.find(e=>e.id===id).data.grp; return AMPersonas.groupEls(g).map(e=>e.data.glasses); }, id);
  await undo(); const sy3=await p.evaluate(id=>{ const A=AMStudio, g=A.deck.slides[0].els.find(e=>e.id===id).data.grp; return AMPersonas.groupEls(g).map(e=>e.data.glasses||''); }, id);
  await p.click('#props .pzs-fine > summary'); await sleep(150);
  check('S36-10: personagem guia: a roupa escolhida no estúdio e os óculos trocados em “Ajustes finos” valem nos 3 slides (a fala continua de cada um); um Ctrl+Z desfaz os óculos nos 3', sy.length===3 && sy.every(x=>/^moletom\//.test(x)) && sy.filter(x=>x==='moletom/Slide 2').length===1 && sy2.every(x=>x==='round') && sy3.every(x=>x===''), {sy, sy2, sy3});
  await p.evaluate(()=>{ const A=AMStudio; A.goSlide(0); }); await sleep(150);
  await p.evaluate(id=>{ AMStudio.selectMany([id]); AMStudio.renderAll(); }, id); await sleep(200);
  await p.click('#props .pzs [data-pzs-tab="lig"]'); await sleep(150); await p.click('#props .pzs [data-pzs-slide="2"]'); await sleep(300);
  const rm=await p.evaluate(id=>{ const A=AMStudio; return {s2:A.deck.slides[2].els.filter(e=>e.kind==='persona').length, n:AMPersonas.groupEls(A.deck.slides[0].els.find(e=>e.id===id).data.grp).length}; }, id);
  await undo(); const rm2=await p.evaluate(()=>AMStudio.deck.slides[2].els.filter(e=>e.kind==='persona').length);
  check('S36-11: desmarcar o slide 3 tira a cópia de lá (o grupo fica com 2); Ctrl+Z devolve', rm.s2===0 && rm.n===2 && rm2===1, {rm, rm2});
  /* correções da revisão enxuta: duplicar/colar solta do grupo; elenco limpa a expressão; cópia bloqueada; link além do fim */
  const cp=await p.evaluate(async id=>{ const A=AMStudio; A.goSlide(0); const g=A.deck.slides[0].els.find(e=>e.id===id).data.grp, n0=AMPersonas.groupEls(g).length; A.selectMany([id]); A.renderAll(); await new Promise(r=>setTimeout(r,100));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'d',ctrlKey:true,bubbles:true})); await new Promise(r=>setTimeout(r,200));
    const dup=A.deck.slides[0].els.filter(e=>e.kind==='persona').find(e=>e.id!==id); return {g, dup:dup&&(dup.data.grp||''), n0, n:AMPersonas.groupEls(g).length}; }, id);
  await p.evaluate(id=>{ AMStudio.selectMany([id]); }, id); await p.keyboard.press('Control+c'); await sleep(150);
  await p.evaluate(()=>{ const A=AMStudio; A.addSlide('blank-light'); }); await sleep(150); await p.keyboard.press('Control+v'); await sleep(400);
  cp.pasted=await p.evaluate(()=>{ const A=AMStudio, s=A.deck.slides[A.cur]; return s.els.filter(e=>e.kind==='persona').map(e=>e.data.grp||''); });
  await p.evaluate(()=>{ const A=AMStudio; A.deck.slides.splice(A.cur,1); A.goSlide(0); A.renderAll(); A.commit(); });
  check('S36-18: duplicar (Ctrl+D) ou copiar e colar um personagem do grupo cria outro personagem, solto (sem grupo); o grupo original continua com os mesmos membros', cp.dup==='' && cp.n===cp.n0 && cp.n0>=2 && cp.pasted.length===1 && cp.pasted[0]==='', cp);
  const ex=await p.evaluate(async id=>{ const A=AMStudio; const me=A.deck.slides[0].els.find(e=>e.id===id); me.data.mood='triste'; A.selectMany([id]); A.renderAll(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#props .pzs [data-var="consultor"]').click(); await new Promise(r=>setTimeout(r,250)); const mood=A.deck.slides[0].els.find(e=>e.id===id).data.mood||'';
    const g=me.data.grp, m=A.deck.slides[1].els.find(e=>e.kind==='persona'&&e.data.grp===g); m.lock=true; A.renderAll(); A.selectMany([id]); A.renderAll(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#props .pzs [data-pzs-tab="lig"]').click(); await new Promise(r=>setTimeout(r,120)); document.querySelector('#props .pzs [data-pzs-slide="1"]').click(); await new Promise(r=>setTimeout(r,200));
    const kept=!!A.deck.slides[1].els.find(e=>e.kind==='persona'&&e.data.grp===g); m.lock=false;
    me.data.link=9; A.renderAll(); await new Promise(r=>setTimeout(r,150)); const sl=document.querySelector('#props .pzs select[data-pzs-proxy="data.link"]'); const opt=sl.options[sl.selectedIndex].textContent;
    me.data.link=''; A.renderAll(); A.commit(); return {mood, kept, opt}; }, id);
  check('S36-19: escolher do elenco veste o preset inteiro, expressão incluída; “Aparece nos slides” não tira uma cópia bloqueada; “ir para o slide 9” num deck de 3 aparece como “não existe”', ex.mood==='' && ex.kept && /Slide 9 \(não existe/.test(ex.opt), ex);
  /* ---------- 2. apresentação ---------- */
  const ids=await p.evaluate(()=>{ const A=AMStudio; const dk=A.newDeck(); A.loadDeck(dk,null); A.addSlide('blank-light'); A.addSlide('blank-light'); A.goSlide(0);
    const g=A.insertFx('persona',null,null,'consultora'); g.x=40; g.y=330; g.w=240; g.h=320; Object.assign(g.data,{bubble:'none',act:'acenar',trig:'in',grp:'gTour'});
    const k=A.insertFx('persona',null,null,'ia'); k.x=900; k.y=330; k.w=240; k.h=320; Object.assign(k.data,{bubble:'none',act:'parado',link:3,mood2:'animado'});
    const l=A.insertFx('persona',null,null,'dev'); l.x=520; l.y=330; l.w=200; l.h=280; Object.assign(l.data,{bubble:'none',act:'pular',trig:'loop',act2:'acenar',mood2:'surpreso'});
    A.goSlide(1); const g2=JSON.parse(JSON.stringify(g)); g2.id='gTour2'; g2.x=900; g2.y=330; g2.anim={in:'none',delay:0,loop:'float'}; A.deck.slides[1].els.push(g2);
    A.selectMany([]); A.renderAll(); A.commit(); return {g:g.id, k:k.id, l:l.id, g2:g2.id}; });
  const h=await p.evaluate(()=>AMStudio.exportHTML()); const hp=path.join(TMP,'s36.html'); fs.writeFileSync(hp,h);
  const v=await open(ctx,'file://'+hp,'player');
  const Q=(id,sel)=>'.amp-slide.on .am-el[data-id="'+id+'"] '+(sel||'.pz');
  await sleep(600);
  const la=await v.evaluate(sel=>{ const pz=document.querySelector(sel); return pz.dataset.act2; }, Q(ids.l));
  const lb=await v.evaluate(sel=>{ const b=document.querySelector(sel).getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height*.6}; }, Q(ids.l,'.pz-char'));
  await v.mouse.click(lb.x,lb.y); await sleep(200);
  const lc=await v.evaluate(sel=>{ const pz=document.querySelector(sel); return {go:pz.classList.contains('pz-go'), mood:pz.dataset.mood, an:getComputedStyle(pz.querySelector('.pz-char')).animationName}; }, Q(ids.l));
  check('S36-12: arquivo com “Sem parar” + gesto ao clicar: o gesto não entra (data-act2 = none, sem pz-go), o clique ainda troca a expressão e o laço segue', la==='none' && !lc.go && lc.mood==='surpreso' && lc.an==='pzJump', {la, lc});
  await v.keyboard.press('ArrowRight'); await sleep(120);
  const g0=await v.evaluate(sel=>{ const pz=document.querySelector(sel); const r=pz.querySelector('.pz-svg').getBoundingClientRect(); return {from:pz.classList.contains('pz-from'), gfx:pz.style.getPropertyValue('--gfx').trim(), walk:pz.dataset.walk, wf:pz.dataset.wf, x:r.x, arr:pz.classList.contains('pz-arr')}; }, Q(ids.g2));
  await sleep(1200); const g1=await v.evaluate(sel=>{ const r=document.querySelector(sel).querySelector('.pz-svg').getBoundingClientRect(); return r.x; }, Q(ids.g2));
  await v.waitForFunction(sel=>document.querySelector(sel).classList.contains('pz-arr'), Q(ids.g2), {timeout:9000}); await sleep(300);
  const g3=await v.evaluate(sel=>{ const pz=document.querySelector(sel); const r=pz.querySelector('.pz-svg').getBoundingClientRect(); return {x:r.x, an:getComputedStyle(pz.querySelector('.pz-aR')).animationName, walk:pz.dataset.walk||'', fx:getComputedStyle(pz.closest('.am-fxw')).animationName}; }, Q(ids.g2));
  await v.screenshot({path:SH('guia')});
  check('S36-13: personagem guia: ao passar para o slide 2 ele começa onde estava no slide 1 (à esquerda), anda para a direita olhando para lá e, ao chegar, acena (pzWave); a caminhada era emprestada: o efeito contínuo do elemento (Flutuar) volta', g0.from && /cqw$/.test(g0.gfx) && parseFloat(g0.gfx)<-40 && g0.walk==='0' && g0.wf==='r' && !g0.arr && g0.x<g1 && g1<g3.x && g3.an==='pzWave' && g3.walk==='' && g3.fx!=='none', {g0, g1, g3});
  await v.keyboard.press('ArrowLeft'); await sleep(200);
  const back=await v.evaluate(sel=>{ const pz=document.querySelector(sel); return {from:pz.classList.contains('pz-from'), gfx:pz.style.getPropertyValue('--gfx').trim(), wf:pz.dataset.wf}; }, Q(ids.g));
  check('S36-14: voltando ao slide 1 ele faz o caminho de volta (sai da direita, anda para a esquerda)', back.from && parseFloat(back.gfx)>40 && back.wf==='l', back);
  await v.waitForFunction(sel=>document.querySelector(sel).classList.contains('pz-arr'), Q(ids.g), {timeout:9000});
  const kb=await v.evaluate(sel=>{ const b=document.querySelector(sel).getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height*.6}; }, Q(ids.k,'.pz-char'));
  await v.mouse.click(kb.x,kb.y); await sleep(150); const k1=await v.evaluate(sel=>({mood:document.querySelector(sel).dataset.mood, pos:document.querySelector('.amp-pos').textContent}), Q(ids.k));
  await sleep(900); const k2=await v.evaluate(()=>document.querySelector('.amp-pos').textContent);
  check('S36-15: “Ao clicar nele, ir para o slide 3”: o clique mostra a reação (expressão animado) e, logo depois, a apresentação vai para o slide 3', k1.mood==='animado' && /^01/.test(k1.pos) && /^03/.test(k2), {k1, k2});
  await v.close();
  /* ---------- 3. dados ---------- */
  const sd=await p.evaluate(()=>{ const A=AMStudio; const els=A.safeDeck({slides:[{id:'s1',els:[
      {id:'p1',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,data:{link:'abc',grp:'bad id!'}},
      {id:'p2',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,data:{link:5.4,grp:'gOk_1'}},
      {id:'p3',type:'fx',kind:'persona',x:0,y:0,w:300,h:380,data:{link:true,grp:'<b>'}}]}]}).slides[0].els;
    return {d:els.map(e=>[e.data.link==null?'':e.data.link, e.data.grp==null?'':e.data.grp])}; });
  check('S36-16: arquivo editado à mão: “ir para o slide” só aceita nº inteiro de 1 a 999 (texto e booleano viram vazio, 5,4 vira 5) e o grupo só aceita id simples (o resto sai)', JSON.stringify(sd.d)===JSON.stringify([['',''],[5,'gOk_1'],['','']]), sd);
  const sz=fs.statSync(path.join(__dirname,'AM-Studio-Editor.html')).size;
  check('S36-17: orçamento: o editor autônomo continua ≤ 1854 KB (folga para os ~146 KB do editor em nuvem, limite 2000)', sz<=1854*1024, Math.round(sz/1024)+' KB');
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
