/* S18 — painel de slides com largura ajustável (divisória arrastável) e recolhível (faixa de 40 px).
   Tudo pela interface real: arrastar a divisória com o mouse, teclas na divisória, duplo clique, botões « » +,
   menu Slide › Ocultar/Mostrar painel, recarregar a página, arrastar elemento e miniatura depois de mudar a largura.
   Uso: python3 assemble.py && node test-s18-lateral.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(800); return p; }
const near=(a,b,t)=>Math.abs(a-b)<=t;

(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  /* 14 slides; o slide 1 recebe um retângulo para o teste de arrastar */
  await p.evaluate(()=>{ const S=AMStudio, d=S.newDeck(); d.title='S18'; d.slides=[]; for(let i=0;i<14;i++){ const s=S.mk.slide(i%3?'blank-light':'blank-dark'); s.els=[S.mk.text('title',{html:'Slide '+(i+1)},i%3===0)]; d.slides.push(s);} S.loadDeck(d,''); });
  await sleep(300);
  const geo=()=>p.evaluate(()=>{ const r=e=>{const q=document.querySelector(e); if(!q) return null; const b=q.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height};};
    const ths=[...document.querySelectorAll('#thumbs .th')].slice(0,3).map(t=>{const b=t.querySelector('.box').getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width};});
    return {side:r('#side'), wrap:r('#wrap'), cv:r('#cv'), split:r('#sideSplit'), ths, cols2:document.getElementById('side').classList.contains('cols2'),
      off:document.body.classList.contains('side-off'), now:+document.getElementById('sideSplit').getAttribute('aria-valuenow'), max:+document.getElementById('sideSplit').getAttribute('aria-valuemax'),
      pos:document.getElementById('sidePos').textContent, n:AMStudio.deck.slides.length, cur:AMStudio.cur,
      hscroll:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth,
      ls:{w:localStorage.getItem('amStudio.sideW'), off:localStorage.getItem('amStudio.sideOff')}}; });
  async function dragSplitTo(w){ const g=await geo(), s=g.split; const sx=s.x+s.w/2, sy=s.y+s.h/2, x=sx+(w-g.side.w);
    await p.mouse.move(sx,sy); await p.mouse.down(); for(let i=1;i<=8;i++){ await p.mouse.move(sx+(x-sx)*i/8, sy); await sleep(16); } await p.mouse.up(); await sleep(120); }

  const g0=await geo();
  const sp=await p.evaluate(()=>{const s=document.getElementById('sideSplit'); return {role:s.getAttribute('role'), or:s.getAttribute('aria-orientation'), lab:s.getAttribute('aria-label'), ti:s.tabIndex, min:s.getAttribute('aria-valuemin'), cur:getComputedStyle(s).cursor};});
  check('S18-01: painel começa com 196 px; divisória acessível (separator vertical, foco, rótulo, col-resize)', near(g0.side.w,196,1)&&g0.now===196&&sp.role==='separator'&&sp.or==='vertical'&&sp.lab==='Largura do painel de slides'&&sp.ti===0&&sp.min==='132'&&sp.cur==='col-resize'&&g0.max===440, {w:g0.side.w,sp,max:g0.max});
  /* hover: a linha fica laranja */
  await p.mouse.move(g0.split.x+g0.split.w/2, 400); await sleep(200);
  const hov=await p.evaluate(()=>getComputedStyle(document.getElementById('sideSplit'),'::after').backgroundColor);
  check('S18-02: a linha da divisória fica laranja ao passar o mouse', hov==='rgb(247, 140, 22)', hov);
  await p.screenshot({path:path.join(SHOTS,'s18-01-padrao-1440.png')});

  /* arrastar para 320 */
  await dragSplitTo(320); const g1=await geo();
  check('S18-03: arrastar a divisória até 320 → painel 320 px, palco menor e 16:9, miniaturas maiores', near(g1.side.w,320,2)&&g1.wrap.w<g0.wrap.w-40&&near(g1.wrap.w/g1.wrap.h,16/9,.01)&&g1.ths[0].w>g0.ths[0].w+80&&!g1.cols2&&g1.ls.w==='320', {side:g1.side.w,wrap:[g0.wrap.w,g1.wrap.w,g1.wrap.h],th:[g0.ths[0].w,g1.ths[0].w],ls:g1.ls});
  /* a moldura de seleção acompanha: o palco continua dentro de #cv e centrado */
  check('S18-04: palco centrado na área livre depois da mudança', near(g1.wrap.x+g1.wrap.w/2, g1.cv.x+g1.cv.w/2, 2)&&g1.wrap.x>=g1.cv.x, {wrap:g1.wrap,cv:g1.cv});

  /* 400 → duas colunas */
  await dragSplitTo(400); const g2=await geo();
  check('S18-05: em 400 px as miniaturas ficam em 2 colunas (número do slide visível)', near(g2.side.w,400,2)&&g2.cols2&&near(g2.ths[0].y,g2.ths[1].y,1)&&g2.ths[1].x>g2.ths[0].x+g2.ths[0].w&&g2.ths[2].y>g2.ths[0].y
    &&await p.evaluate(()=>{const n=document.querySelector('#thumbs .th[data-i="1"] .n'); const r=n.getBoundingClientRect(); return n.textContent==='2'&&r.width>4&&getComputedStyle(n).display!=='none';}), {w:g2.side.w,ths:g2.ths});
  await p.screenshot({path:path.join(SHOTS,'s18-02-duas-colunas-1440.png')});

  /* limites */
  await dragSplitTo(1300); const g3=await geo();
  await dragSplitTo(20); const g4=await geo();
  check('S18-06: arrastar além dos limites para em 440 (máx.) e 132 (mín.)', near(g3.side.w,440,1)&&near(g4.side.w,132,1)&&g3.cv.w>=520, {max:g3.side.w,min:g4.side.w,cv:g3.cv.w});

  /* teclado na divisória */
  await p.focus('#sideSplit'); const kv=[];
  await p.keyboard.press('ArrowRight'); kv.push((await geo()).now);
  await p.keyboard.press('Shift+ArrowRight'); kv.push((await geo()).now);
  await p.keyboard.press('ArrowLeft'); kv.push((await geo()).now);
  await p.keyboard.press('End'); kv.push((await geo()).now);
  await p.keyboard.press('Home'); kv.push((await geo()).now);
  const g5=await geo();
  check('S18-07: teclado na divisória: → +16, Shift+→ +64, ← −16, End = máx., Home = mín. (sem trocar de slide)', kv.join()==='148,212,196,440,132'&&near(g5.side.w,132,1)&&g5.cur===0, {kv,cur:g5.cur});

  /* duplo clique volta ao padrão */
  await dragSplitTo(300); const gs=(await geo()).split; await p.mouse.dblclick(gs.x+gs.w/2, 500); await sleep(150); const g6=await geo();
  check('S18-08: duplo clique na divisória volta a 196 px', near(g6.side.w,196,1)&&g6.ls.w==='196', {w:g6.side.w,ls:g6.ls});

  /* recolher: slide 3 atual */
  await dragSplitTo(260); await p.click('#thumbs .th[data-i="2"] .box'); await sleep(150);
  const before=await geo();
  await p.click('#sideCollapse'); await sleep(150); const g7=await geo();
  check('S18-09: « recolhe para uma faixa de 40 px; o palco cresce; a faixa mostra “3/14”', g7.off&&near(g7.side.w,40,1)&&g7.wrap.w>before.wrap.w+60&&g7.pos==='3/14'&&near(g7.wrap.w/g7.wrap.h,16/9,.01)&&g7.ls.off==='1', {w:g7.side.w,wrap:[before.wrap.w,g7.wrap.w],pos:g7.pos});
  await p.screenshot({path:path.join(SHOTS,'s18-03-recolhido-1440.png')});
  /* PageDown com a faixa: a posição acompanha */
  await p.mouse.click(g7.cv.x+8, g7.cv.y+8); await p.keyboard.press('PageDown'); await sleep(150);
  check('S18-10: a posição da faixa acompanha a troca de slide (PageDown → 4/14)', (await geo()).pos==='4/14', (await geo()).pos);
  /* + na faixa: abre os layouts, escolhe um, cria o slide; Ctrl+Z desfaz */
  await p.click('#sideAdd'); await sleep(150);
  const mOpen=await p.evaluate(()=>{const m=document.getElementById('mSlide'); const r=m.getBoundingClientRect(); return m.classList.contains('open')&&r.left>=40&&r.bottom<=innerHeight&&r.top>=0;});
  await p.screenshot({path:path.join(SHOTS,'s18-08-faixa-novo-slide-1440.png')});
  await p.click('#mSlide button[data-layout]'); await sleep(200); const g8=await geo();
  await p.keyboard.press('Control+z'); await sleep(200); const g8u=await geo();
  check('S18-11: + da faixa abre os layouts (dentro da tela) e cria o slide (5/15); Ctrl+Z desfaz', mOpen&&g8.n===15&&g8.pos==='5/15'&&g8u.n===14&&g8u.pos.endsWith('/14'), {mOpen,n:g8.n,pos:g8.pos,undo:[g8u.n,g8u.pos]});
  /* » expande e devolve a largura anterior */
  await p.click('#sideExpand'); await sleep(150); const g9=await geo();
  check('S18-12: » mostra o painel de novo na largura anterior (260 px)', !g9.off&&near(g9.side.w,260,1)&&g9.ls.off==='0', {w:g9.side.w});

  /* menu Slide › Ocultar / Mostrar painel de slides */
  const menuItem=async(m,txt)=>{ await p.click('#mbar [data-m="'+m+'"]'); await sleep(150); const it=p.locator('.xmenu .xi',{hasText:txt}); const c=await it.count(); if(c) await it.first().click(); else await p.keyboard.press('Escape'); await sleep(150); return c; };
  const c1=await menuItem('slide','Ocultar painel de slides'); const gm1=await geo();
  const c2=await menuItem('slide','Mostrar painel de slides'); const gm2=await geo();
  check('S18-13: menu Slide › “Ocultar painel de slides” recolhe e “Mostrar painel de slides” expande', c1===1&&c2===1&&gm1.off&&!gm2.off&&near(gm2.side.w,260,1), {c1,c2,off:[gm1.off,gm2.off]});

  /* recarregar mantém largura e estado recolhido */
  await dragSplitTo(400); await p.click('#sideCollapse'); await sleep(100);
  await p.reload(); await sleep(900); let gr=await geo();
  const r1=gr.off&&near(gr.side.w,40,1);
  await p.click('#sideExpand'); await sleep(150); gr=await geo();
  check('S18-14: recarregar a página mantém o painel recolhido e a largura (400 px ao expandir, 2 colunas)', r1&&near(gr.side.w,400,1)&&gr.cols2, {r1,w:gr.side.w});
  await p.reload(); await sleep(900); gr=await geo();
  check('S18-15: recarregar com o painel aberto mantém 400 px', !gr.off&&near(gr.side.w,400,1), gr.side.w);

  /* arrastar/redimensionar um elemento depois da mudança de largura */
  await p.evaluate(()=>{ const S=AMStudio, d=S.newDeck(); d.title='S18b'; d.slides=[]; for(let i=0;i<8;i++){ const s=S.mk.slide('blank-light'); if(i===0){ const r=S.mk.shape('rect',false); Object.assign(r,{id:'rq',x:300,y:200,w:300,h:180}); s.els=[r]; } d.slides.push(s);} S.loadDeck(d,''); });
  await sleep(300);
  const wb=(await geo()).wrap; const L=(x,y)=>({x:wb.x+x/1280*wb.w, y:wb.y+y/720*wb.h});
  let c=L(450,290); await p.mouse.move(c.x,c.y); await p.mouse.down(); for(let i=1;i<=10;i++){ await p.mouse.move(c.x+10*i,c.y); await sleep(16);} await p.mouse.up(); await sleep(150);
  const mv=await p.evaluate(()=>{const e=AMStudio.deck.slides[0].els[0]; return {x:e.x,y:e.y,sel:AMStudio.selected()};});
  const expDx=100/wb.w*1280;
  const hdl=await p.evaluate(()=>{const h=document.querySelector('#sel .hdl[data-h="se"]').getBoundingClientRect(); return {x:h.x+h.width/2,y:h.y+h.height/2};});
  const corner=L(mv.x+300, mv.y+180);
  check('S18-16: com o painel em 400 px, arrastar 100 px na tela move o elemento 100/escala px lógicos e a alça “se” fica no canto (±3 px)', near(mv.x-300,expDx,2.5)&&near(mv.y,200,2.5)&&near(hdl.x,corner.x,3)&&near(hdl.y,corner.y,3), {dx:mv.x-300,expDx,y:mv.y,hdl,corner});
  /* alça de redimensionar após mudar a largura de novo (teclado) */
  await p.focus('#sideSplit'); await p.keyboard.press('Shift+ArrowLeft'); await sleep(100);
  const wb2=(await geo()).wrap; const L2=(x,y)=>({x:wb2.x+x/1280*wb2.w, y:wb2.y+y/720*wb2.h});
  const h2=await p.evaluate(()=>{const h=document.querySelector('#sel .hdl[data-h="se"]').getBoundingClientRect(); return {x:h.x+h.width/2,y:h.y+h.height/2};});
  const e0=await p.evaluate(()=>{const e=AMStudio.deck.slides[0].els[0]; return {x:e.x,y:e.y,w:e.w,h:e.h};});
  const c2c=L2(e0.x+e0.w,e0.y+e0.h);
  await p.mouse.move(h2.x,h2.y); await p.mouse.down(); for(let i=1;i<=6;i++){ await p.mouse.move(h2.x+10*i,h2.y+5*i); await sleep(16);} await p.mouse.up(); await sleep(150);
  const e1=await p.evaluate(()=>{const e=AMStudio.deck.slides[0].els[0]; return {w:e.w,h:e.h};});
  check('S18-17: depois de mudar a largura pelo teclado, a alça segue no canto e redimensionar usa a escala nova', near(h2.x,c2c.x,3)&&near(h2.y,c2c.y,3)&&e1.w>e0.w+60/wb2.w*1280-12&&e1.w<e0.w+60/wb2.w*1280+12, {h2,c2c,w:[e0.w,e1.w],exp:60/wb2.w*1280});
  await p.keyboard.press('Control+z'); await sleep(150); await p.keyboard.press('Control+z'); await sleep(150);
  const eu=await p.evaluate(()=>{const e=AMStudio.deck.slides[0].els[0]; return {x:e.x,w:e.w};});
  check('S18-18: Ctrl+Z desfaz o redimensionamento e o arraste (a largura do painel não entra no histórico)', eu.x===300&&eu.w===300&&near((await geo()).side.w,336,1), {eu,side:(await geo()).side.w});

  /* duas colunas: reordenar arrastando miniatura; botões de duplicar/apagar ao passar o mouse; teclado */
  await p.focus('#sideSplit'); await p.keyboard.press('End'); await sleep(100);
  const ids=await p.evaluate(()=>AMStudio.deck.slides.map(s=>s.id));
  await p.dragAndDrop('#thumbs .th[data-i="3"] .box','#thumbs .th[data-i="0"] .box'); await sleep(250);
  const ids2=await p.evaluate(()=>AMStudio.deck.slides.map(s=>s.id));
  check('S18-19: em 2 colunas, arrastar a miniatura 4 para antes da 1 reordena', (await geo()).cols2&&ids2[0]===ids[3]&&ids2[1]===ids[0]&&ids2.length===ids.length, {a:ids.slice(0,4),b:ids2.slice(0,4)});
  await p.hover('#thumbs .th[data-i="1"] .box'); await sleep(120);
  const actVis=await p.evaluate(()=>getComputedStyle(document.querySelector('#thumbs .th[data-i="1"] .act')).display);
  await p.click('#thumbs .th[data-i="1"] [data-ta="dup"]'); await sleep(200); const nDup=(await geo()).n;
  await p.hover('#thumbs .th[data-i="2"] .box'); await sleep(120); await p.click('#thumbs .th[data-i="2"] [data-ta="del"]'); await sleep(200); const nDel=(await geo()).n;
  check('S18-20: em 2 colunas os botões Duplicar/Apagar da miniatura aparecem e funcionam', actVis==='flex'&&nDup===9&&nDel===8, {actVis,nDup,nDel});
  await p.click('#thumbs .th[data-i="0"] .box'); await sleep(120);
  await p.keyboard.press('ArrowDown'); const k1=(await geo()).cur; await p.keyboard.press('ArrowRight'); const k2=(await geo()).cur; await p.keyboard.press('ArrowUp'); const k3=(await geo()).cur;
  await p.keyboard.press('Control+d'); await sleep(150); const kd=(await geo()).n; await p.keyboard.press('Delete'); await sleep(150); const kx=(await geo()).n;
  check('S18-21: teclado nas miniaturas em 2 colunas: ↓ desce uma linha, → próximo, ↑ sobe; Ctrl+D duplica e Delete apaga', k1===2&&k2===3&&k3===1&&kd===9&&kx===8, {k1,k2,k3,kd,kx});
  await p.screenshot({path:path.join(SHOTS,'s18-04-max-1440.png')});

  /* salvar → reabrir e exportar: o painel é preferência da tela, o deck não muda */
  const r2=await p.evaluate(()=>{ const a=JSON.stringify(AMStudio.deck); AMStudio.loadDeck(JSON.parse(a),''); return {same:JSON.stringify(AMStudio.deck.slides.map(s=>s.id))===JSON.stringify(JSON.parse(a).slides.map(s=>s.id)), side:document.getElementById('side').getBoundingClientRect().width, keys:Object.keys(AMStudio.deck).concat(...AMStudio.deck.slides.map(s=>Object.keys(s))).filter(k=>/side/i.test(k))}; });
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(__dirname,'saved-s18.html'); fs.writeFileSync(f,html);
  const q=await open(ctx,'file://'+f,'exp');
  const ex=await q.evaluate(()=>({n:document.querySelectorAll('.amp .amp-slide').length, side:!!document.getElementById('sideSplit')}));
  check('S18-22: reabrir mantém o deck e o painel; o arquivo exportado abre o player igual (sem divisória) e sem on*', r2.same&&near(r2.side,440,1)&&r2.keys.length===0&&ex.n===8&&!ex.side&&!/onerror|onmouseover|onclick/i.test(html), {r2,ex});
  await q.close();

  /* Ctrl + rolar sobre as miniaturas muda a largura */
  const tb=(await geo()).side; await p.mouse.move(tb.x+tb.w/2, 400);
  await p.keyboard.down('Control'); await p.mouse.wheel(0,120); await sleep(120); await p.mouse.wheel(0,120); await sleep(120); await p.keyboard.up('Control'); const gw=await geo();
  check('S18-23: Ctrl + rolar sobre o painel diminui a largura (−16 px por passo)', near(gw.side.w,408,1), gw.side.w);

  /* 1440: sem rolagem horizontal mesmo no máximo */
  check('S18-24: 1440×900 sem rolagem horizontal', !gw.hscroll);
  /* janela menor: re-limita */
  await p.focus('#sideSplit'); await p.keyboard.press('End'); await p.setViewportSize({width:1100,height:760}); await sleep(250); const gz=await geo();
  check('S18-25: ao estreitar a janela (1100 px) o painel re-limita (≤ 276 px) e o palco mantém ≥ 520 px de área', near(gz.side.w,276,1)&&gz.cv.w>=519&&!gz.hscroll&&gz.max===276, {w:gz.side.w,cv:gz.cv.w,max:gz.max});

  /* 1280×720: barras sem transbordar, sem rolagem, nas larguras mínima, padrão, máxima e recolhida */
  await p.setViewportSize({width:1280,height:720}); await sleep(250);
  const ov=async()=>p.evaluate(()=>{const t=document.getElementById('top'); const r=document.getElementById('bSave').getBoundingClientRect(); return t.scrollWidth<=t.clientWidth&&r.right<=innerWidth&&document.getElementById('rib').scrollWidth<=document.getElementById('rib').clientWidth&&document.documentElement.scrollWidth<=innerWidth;});
  const o=[]; await p.focus('#sideSplit');
  await p.keyboard.press('End'); await sleep(80); o.push(await ov()); const g12=await geo();
  const bn=await p.evaluate(()=>{ const b=document.getElementById('banner'); const was=b.classList.contains('open'); b.classList.add('open'); const r=b.getBoundingClientRect(), s=document.getElementById('side').getBoundingClientRect(), pr=document.getElementById('props').getBoundingClientRect(), c=document.getElementById('sideCollapse').getBoundingClientRect();
    const hit=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2); const res={was, l:r.left, r:r.right, side:s.right, props:pr.left, hit:!!(hit&&hit.closest('#sideCollapse'))}; const h=document.getElementById('hint').getBoundingClientRect(), cv=document.getElementById('cv').getBoundingClientRect(); res.hint=h.left>=cv.left&&h.right<=cv.right; return res; });
  await sleep(250); await p.screenshot({path:path.join(SHOTS,'s18-05-max-1280.png')});
  check('S18-28: o aviso de rascunho fica centrado sobre a área do slide e não cobre o « do painel; a dica do rodapé fica dentro da área do slide (1280, painel em 440)', bn.l>=bn.side&&bn.r<=bn.props&&bn.hit&&bn.hint, bn);
  await p.keyboard.press('Home'); await sleep(80); o.push(await ov()); await p.screenshot({path:path.join(SHOTS,'s18-06-min-1280.png')});
  await p.keyboard.press('Enter'); await sleep(80); o.push(await ov()); const g13=await geo();
  await p.click('#sideCollapse'); await sleep(120); o.push(await ov()); await p.screenshot({path:path.join(SHOTS,'s18-07-recolhido-1280.png')});
  await p.click('#sideExpand'); await sleep(120);
  check('S18-26: 1280×720 sem transbordar a barra/faixa e sem rolagem horizontal (máx. 440, mín., padrão, recolhido); Enter na divisória = 196', o.every(Boolean)&&near(g12.side.w,440,1)&&g12.cv.w>=520&&near(g13.side.w,196,1), {o,max:g12.side.w,cv:g12.cv.w,def:g13.side.w});

  /* foco do teclado: « e » trocam o foco entre si */
  await p.focus('#sideCollapse'); await p.keyboard.press('Enter'); await sleep(120); const fa=await p.evaluate(()=>document.activeElement.id);
  await p.keyboard.press('Enter'); await sleep(120); const fb=await p.evaluate(()=>document.activeElement.id);
  check('S18-27: pelo teclado, « recolhe e leva o foco ao », que expande e devolve o foco ao «', fa==='sideExpand'&&fb==='sideCollapse', {fa,fb});

  /* ---------- correções da revisão (R01–R14) ---------- */
  await p.setViewportSize({width:1440,height:900}); await sleep(200);
  const mkDeck=n=>p.evaluate(n=>{ const S=AMStudio, d=S.newDeck(); d.title='S18r'; d.slides=[]; for(let i=0;i<n;i++){ const s=S.mk.slide('blank-light'); s.els=[S.mk.text('title',{html:'Slide '+(i+1)},false)]; d.slides.push(s);} S.loadDeck(d,''); },n);
  const setW=async w=>{ await p.focus('#sideSplit'); await p.keyboard.press(w===440?'End':'Enter'); if(w!==440){ const st=w>=196?16:-16; for(let x=196;x!==w;x+=st) await p.keyboard.press(st>0?'ArrowRight':'ArrowLeft'); } await sleep(80); };
  const thR=()=>p.evaluate(()=>[...document.querySelectorAll('#thumbs .th')].map(t=>{const r=t.getBoundingClientRect(), b=t.querySelector('.box').getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,bx:b.left+b.width/2,by:b.top+b.height/2,bw:b.width};}));
  const onVis=()=>p.evaluate(()=>{ const tb=document.getElementById('thumbs').getBoundingClientRect(), o=document.querySelector('#thumbs .th.on .box').getBoundingClientRect(); return {vis:o.top>=tb.top-1&&o.bottom<=tb.bottom+1, top:Math.round(o.top), list:[Math.round(tb.top),Math.round(tb.bottom)]}; });
  const order=()=>p.evaluate(()=>AMStudio.deck.slides.map(s=>s.els[0]&&s.els[0].html||'?').map(h=>+String(h).replace(/\D/g,'')));
  /* arrasta a miniatura i com o mouse de verdade até (x,y); 'mark' = classe do indicador visível antes de soltar */
  async function dragThumbTo(i,x,y){ const R=await thR(); const a=R[i]; await p.mouse.move(a.bx,a.by); await p.mouse.down();
    for(let k=1;k<=10;k++){ await p.mouse.move(a.bx+(x-a.bx)*k/10, a.by+(y-a.by)*k/10); await sleep(25); } await p.mouse.move(x+1,y); await sleep(40); await p.mouse.move(x,y); await sleep(120); /* um último dragover parado no alvo */
    const mark=await p.evaluate(()=>{ const q=document.querySelector('#thumbs .th.drop-before,#thumbs .th.drop-after'); if(!q) return null; const pe=getComputedStyle(q, q.classList.contains('drop-before')?'::before':'::after'); return {i:+q.dataset.i, cls:q.classList.contains('drop-before')?'before':'after', bg:pe.backgroundColor, w:parseFloat(pe.width), h:parseFloat(pe.height)}; });
    await p.mouse.up(); await sleep(200); return mark; }

  /* R04: soltar no vão entre miniaturas cai entre as duas vizinhas (2 colunas: vão entre colunas e entre linhas; 1 coluna: margem) */
  await mkDeck(12); await sleep(250); await setW(440);
  let R=await thR(); const m1=await dragThumbTo(5,(R[0].r+R[1].l)/2,R[0].by); const o1=await order();
  await p.keyboard.press('Control+z'); await sleep(150); R=await thR();
  const m2=await dragThumbTo(5,R[0].bx,(R[0].b+R[2].t)/2); const o2=await order();
  await p.keyboard.press('Control+z'); await sleep(150); R=await thR();
  const m3=await dragThumbTo(5,R[1].bx,(R[1].b+R[3].t)/2); const o3=await order();
  await p.keyboard.press('Control+z'); await sleep(150);
  const o3u=await order();
  /* 9 slides: a casa vazia à direita do slide 9 (última linha incompleta) = fim */
  await mkDeck(9); await sleep(200); R=await thR();
  const m4=await dragThumbTo(2,R[1].bx,R[8].by); const o4=await order();
  await p.keyboard.press('Control+z'); await sleep(150);
  check('R04a: 2 colunas — soltar no vão entre as colunas 1|2 põe o slide entre 1 e 2; no vão entre linhas (sob 1 / sob 2) entra antes de 3 / antes de 4; na casa vazia ao lado do último vai para o fim; o indicador mostra o lugar; Ctrl+Z desfaz',
    o1.join()==='1,6,2,3,4,5,7,8,9,10,11,12'&&o2.join()==='1,2,6,3,4,5,7,8,9,10,11,12'&&o3.join()==='1,2,3,6,4,5,7,8,9,10,11,12'&&o3u.join()==='1,2,3,4,5,6,7,8,9,10,11,12'&&o4.join()==='1,2,4,5,6,7,8,9,3'
    &&m1&&m1.i===1&&m1.cls==='before'&&m1.bg==='rgb(247, 140, 22)'&&m2&&m2.i===2&&m3&&m3.i===3&&m4&&m4.i===8&&m4.cls==='after', {o1:o1.join(),o2:o2.join(),o3:o3.join(),o4:o4.join(),m1,m2,m3,m4});
  await mkDeck(12); await sleep(200);
  await setW(196); R=await thR();
  const m5=await dragThumbTo(5,R[0].bx,(R[0].b+R[1].t)/2); const o5=await order();
  await p.keyboard.press('Control+z'); await sleep(150); R=await thR();
  const m6=await dragThumbTo(4,R[0].bx,R[0].by); const o6=await order(); /* sobre a miniatura: antes dela, como sempre */
  await p.keyboard.press('Control+z'); await sleep(150);
  check('R04b: 1 coluna — soltar na margem entre 1 e 2 põe o slide entre os dois (não no fim); soltar sobre a miniatura 1 continua pondo antes dela', o5.join()==='1,6,2,3,4,5,7,8,9,10,11,12'&&m5&&m5.i===1&&o6.join()==='5,1,2,3,4,6,7,8,9,10,11,12'&&m6&&m6.i===0, {o5:o5.join(),o6:o6.join(),m5,m6});

  /* R07: o indicador aparece também sobre a miniatura atual com o painel em foco (antes a sombra de foco o escondia) */
  await p.click('#thumbs .th[data-i="0"] .box'); await sleep(120); R=await thR();
  let a=R[3]; await p.mouse.move(a.bx,a.by); await p.mouse.down(); for(let k=1;k<=8;k++){ await p.mouse.move(a.bx+(R[0].bx-a.bx)*k/8, a.by+(R[0].by-a.by)*k/8); await sleep(25);} await sleep(80);
  const ind1=await p.evaluate(()=>{ const t=document.querySelector('#thumbs .th[data-i="0"]'); const pe=getComputedStyle(t,'::before'); return {focus:document.getElementById('side').classList.contains('focus'), on:t.classList.contains('on'), drop:t.classList.contains('drop-before'), bg:pe.backgroundColor, h:parseFloat(pe.height), w:parseFloat(pe.width)}; });
  await p.screenshot({path:path.join(SHOTS,'s18-09-indicador-1col.png'),clip:{x:0,y:100,width:300,height:300}});
  await p.mouse.up(); await sleep(200); await p.keyboard.press('Control+z'); await sleep(150);
  await setW(440); await p.click('#thumbs .th[data-i="0"] .box'); await sleep(120); R=await thR();
  a=R[4]; await p.mouse.move(a.bx,a.by); await p.mouse.down(); for(let k=1;k<=8;k++){ await p.mouse.move(a.bx+(R[0].bx-a.bx)*k/8, a.by+(R[0].by-a.by)*k/8); await sleep(25);} await sleep(80);
  const ind2=await p.evaluate(()=>{ const t=document.querySelector('#thumbs .th[data-i="0"]'); const pe=getComputedStyle(t,'::before'); return {focus:document.getElementById('side').classList.contains('focus'), drop:t.classList.contains('drop-before'), bg:pe.backgroundColor, h:parseFloat(pe.height), w:parseFloat(pe.width)}; });
  await p.screenshot({path:path.join(SHOTS,'s18-10-indicador-2col.png'),clip:{x:0,y:100,width:460,height:300}});
  await p.mouse.up(); await sleep(200); await p.keyboard.press('Control+z'); await sleep(150);
  check('R07: o indicador de onde a miniatura vai cair aparece sobre a miniatura atual com o painel em foco (barra laranja acima em 1 coluna, à esquerda em 2)', ind1.focus&&ind1.on&&ind1.drop&&ind1.bg==='rgb(247, 140, 22)'&&ind1.h===3&&ind1.w>100&&ind2.focus&&ind2.drop&&ind2.bg==='rgb(247, 140, 22)'&&ind2.w===3&&ind2.h>80, {ind1,ind2});

  /* R11: 2 colunas — ↑ na primeira linha e ↓ na última não andam de lado */
  await mkDeck(9); await sleep(200); await p.click('#thumbs .th[data-i="1"] .box'); await sleep(100);
  await p.keyboard.press('ArrowUp'); const u1=(await geo()).cur;
  await p.click('#thumbs .th[data-i="7"] .box'); await sleep(100); await p.keyboard.press('ArrowDown'); const d1=(await geo()).cur; /* slide 8 (linha 4, dir.) → 9 está na linha de baixo */
  await p.keyboard.press('ArrowDown'); const d2=(await geo()).cur; /* 9 já é a última linha */
  await p.click('#thumbs .th[data-i="6"] .box'); await sleep(100); await p.keyboard.press('ArrowDown'); const d3=(await geo()).cur; await p.keyboard.press('ArrowUp'); const u2=(await geo()).cur;
  check('R11: 2 colunas — ↑ no slide 2 (1ª linha) fica no 2; ↓ no 8 vai ao 9 (linha de baixo); ↓ no 9 fica; ↓ no 7 vai ao 9 e ↑ volta ao 7', u1===1&&d1===8&&d2===8&&d3===8&&u2===6, {u1,d1,d2,d3,u2});

  /* R06: 2 colunas só quando cada miniatura fica ≥ a da largura padrão */
  const bw=[]; for(const w of [196,324,340,372,388,404,440]){ await setW(w); const g=await geo(); bw.push([w,g.cols2,Math.round(g.ths[0].w)]); }
  const def=bw[0][2];
  check('R06: alargar o painel nunca deixa a miniatura menor que na largura padrão (até 372 px 1 coluna; ≥ 380 px 2 colunas com miniatura ≥ a padrão)', bw.every(([w,c,x])=>x>=def&&(c===(w>=380))), bw);

  /* R03: mudar a largura mantém o slide atual à vista (arrastar, teclado, janela) */
  await mkDeck(40); await sleep(300); await setW(196); await p.evaluate(()=>AMStudio.goSlide(29)); await sleep(150);
  const v0=await onVis();
  await dragSplitTo(330); const v1=await onVis(); await dragSplitTo(400); const v2=await onVis(); await dragSplitTo(200); const v3=await onVis();
  await p.focus('#sideSplit'); await p.keyboard.press('End'); await sleep(80); const v4=await onVis(); await p.keyboard.press('Home'); await sleep(80); const v5=await onVis();
  await p.keyboard.press('End'); await sleep(80); await p.setViewportSize({width:1100,height:760}); await sleep(250); const v6=await onVis();
  await p.setViewportSize({width:1440,height:900}); await sleep(250);
  check('R03: o slide atual (30 de 40) continua à vista depois de arrastar a divisória (330, 400, 200), End/Home e estreitar a janela', [v0,v1,v2,v3,v4,v5,v6].every(v=>v.vis), {v0,v1,v2,v3,v4,v5,v6});

  /* R10: abrir outra obra começa a lista no slide 1 (sem a rolagem da anterior, nada escondido sob o cabeçalho) */
  await p.evaluate(()=>AMStudio.loadDeck(AMCover.buildTemplate(3),'')); await sleep(250);
  const l10=await p.evaluate(()=>{ const tb=document.getElementById('thumbs'), r=tb.getBoundingClientRect(), o=document.querySelector('#thumbs .th.on .box').getBoundingClientRect(); return {cur:AMStudio.cur, st:tb.scrollTop, top:Math.round(o.top), list:Math.round(r.top)}; });
  check('R10: depois de rolar até o fim e abrir outra obra, a lista volta ao topo e o slide 1 aparece inteiro', l10.cur===0&&l10.st===0&&l10.top>=l10.list, l10);

  /* R01: arrastar a divisória num deck pesado (40 slides dos projetos prontos): miniaturas fora da vista não são refeitas
     (content-visibility) e, durante o arraste, as miniaturas só escalam (o conteúdo não muda de tamanho); quadros curtos */
  await p.evaluate(()=>{ const all=[]; AMCover.templates.forEach((x,i)=>{ all.push(...AMCover.buildTemplate(i).slides); }); const d=AMCover.buildTemplate(0); d.slides=[]; for(let i=0;i<40;i++) d.slides.push(JSON.parse(JSON.stringify(all[i%all.length]))); d.slides.forEach(s=>{ s.id=AMStudio.uid(); s.els.forEach(e=>e.id=AMStudio.uid()); }); AMStudio.loadDeck(d,''); });
  await sleep(1200); await setW(196);
  const cvs=await p.evaluate(()=>getComputedStyle(document.querySelector('#thumbs .th .box .am-stage')).contentVisibility);
  let s=(await geo()).split; const sx=s.x+s.w/2, sy=s.y+s.h/2;
  await p.evaluate(()=>{ window.__ft=[]; let last=performance.now(); window.__run=true; (function f(t){ window.__ft.push(t-last); last=t; if(window.__run) requestAnimationFrame(f); })(performance.now()); });
  await p.mouse.move(sx,sy); await p.mouse.down(); const fr=[];
  for(let i=1;i<=40;i++){ await p.mouse.move(sx+Math.round(140*Math.sin(i/40*Math.PI))+(i%2), sy); if(i===20) fr.push(await p.evaluate(()=>{ const st=document.querySelector('#thumbs .th .box .am-stage'), bx=st.parentNode; return {frz:document.getElementById('thumbs').classList.contains('frz'), stage:st.offsetWidth, box:Math.round(bx.getBoundingClientRect().width), vis:Math.round(st.getBoundingClientRect().width)}; })); }
  const w0=await p.evaluate(()=>document.querySelector('#thumbs .th .box .am-stage').offsetWidth);
  await p.mouse.up(); await sleep(300);
  const ft=await p.evaluate(()=>{ window.__run=false; return window.__ft.slice(1).sort((a,b)=>a-b); });
  const after=await p.evaluate(()=>{ const st=document.querySelector('#thumbs .th .box .am-stage'); return {frz:document.getElementById('thumbs').classList.contains('frz'), stage:st.offsetWidth, box:Math.round(st.parentNode.getBoundingClientRect().width), w:document.getElementById('side').getBoundingClientRect().width}; });
  const p95=ft[Math.floor(ft.length*.95)], fmax=ft[ft.length-1];
  check('R01: arrastar a divisória com 40 slides pesados — miniaturas com content-visibility:auto; no arraste o slide da miniatura guarda o tamanho e só escala; ao soltar volta ao layout normal; quadro p95 < 150 ms (antes ~200–480 ms)',
    cvs==='auto'&&fr[0].frz&&near(fr[0].vis,fr[0].box,1.5)&&fr[0].box>fr[0].stage+20&&w0===fr[0].stage&&!after.frz&&near(after.stage,after.box,1)&&p95<150, {cvs,mid:fr[0],after,frames:ft.length,p95:Math.round(p95),max:Math.round(fmax)});
  await p.screenshot({path:path.join(SHOTS,'s18-11-deck-pesado-1440.png')});

  /* R12: Esc durante o arraste cancela (volta à largura do início, nada salvo) */
  await setW(196); s=(await geo()).split; await p.mouse.move(s.x+s.w/2,s.y+300); await p.mouse.down();
  for(let i=1;i<=5;i++){ await p.mouse.move(s.x+s.w/2+20*i,s.y+300); await sleep(25);} const mid12=(await geo()).side.w;
  await p.keyboard.press('Escape'); for(let i=1;i<=3;i++){ await p.mouse.move(s.x+120+10*i,s.y+300); await sleep(25);} await p.mouse.up(); await sleep(150); const g12b=await geo();
  check('R12: Esc no meio do arraste da divisória volta a 196 px e não salva a largura do arraste', mid12>250&&near(g12b.side.w,196,1)&&g12b.ls.w==='196'&&!(await p.evaluate(()=>document.getElementById('thumbs').classList.contains('frz'))), {mid12,w:g12b.side.w,ls:g12b.ls});

  /* R05: Ctrl + rolar com passos pequenos (pinça do trackpad) muda pouco; um “dente” de roda continua mudando 16 px */
  const sd=(await geo()).side; await p.mouse.move(sd.x+sd.w/2,400); await p.keyboard.down('Control');
  for(let i=0;i<12;i++){ await p.mouse.wheel(0,-2); await sleep(20);} await sleep(150); const g5a=await geo();
  await p.mouse.wheel(0,-100); await sleep(150); const g5b=await geo(); await p.keyboard.up('Control'); await sleep(450); const ls5=await p.evaluate(()=>localStorage.getItem('amStudio.sideW'));
  check('R05: 12 eventos Ctrl+rolar de −2 (pinça leve) mudam ≤ 8 px e não viram 2 colunas; um dente de 100 soma 16 px e a largura é salva', g5a.side.w-196<=8&&g5a.side.w>=196&&!g5a.cols2&&near(g5b.side.w-g5a.side.w,16,1)&&ls5===String(Math.round(g5b.side.w)), {pinch:g5a.side.w,notch:g5b.side.w,ls:ls5});
  await setW(196);

  /* R02 / R08: « e » com o mouse soltam o foco: ↓ e PageDown trocam de slide, Espaço não reabre; Shift+F10 não abre no canto da tela */
  await mkDeck(6); await sleep(200); await p.click('#thumbs .th[data-i="0"] .box'); await sleep(100);
  await p.click('#sideCollapse'); await sleep(150);
  const ae1=await p.evaluate(()=>document.activeElement.id||document.activeElement.tagName);
  await p.keyboard.press('ArrowDown'); await sleep(100); const c1d=(await geo()).cur; await p.keyboard.press('PageDown'); await sleep(100); const c2d=(await geo()).cur;
  await p.keyboard.press(' '); await sleep(120); const offSp=(await geo()).off;
  await p.keyboard.press('Shift+F10'); await sleep(200);
  const cm=await p.evaluate(()=>{ const m=document.querySelector('.xmenu'); if(!m) return null; const r=m.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y)}; });
  await p.keyboard.press('Escape'); await sleep(100);
  await p.keyboard.press('Control+d'); await sleep(150); const nD=(await geo()).n;
  await p.click('#sideExpand'); await sleep(150); const ae2=await p.evaluate(()=>document.activeElement.id||document.activeElement.tagName);
  await p.keyboard.press('ArrowDown'); await sleep(100); const c3d=(await geo()).cur;
  check('R02: depois de « / » com o mouse, ↓ e PageDown trocam de slide (1→2→3, 3→4), Espaço não reabre o painel, o foco não fica nos botões', ae1==='BODY'&&c1d===1&&c2d===2&&offSp&&ae2==='BODY'&&c3d===3, {ae1,c1d,c2d,offSp,ae2,c3d});
  check('R08: com o painel recolhido pelo mouse, Shift+F10 abre o menu fora do canto do logo/menu (x ≥ 40) e Ctrl+D não duplica o slide escondido', cm&&cm.x>=40&&cm.y>=60&&nD===6, {cm,nD});
  /* menu do slide pelo teclado com o painel recolhido (zona miniaturas): abre ao lado da faixa */
  await p.click('#thumbs .th[data-i="2"] .box'); await sleep(100); await p.focus('#sideCollapse'); await p.keyboard.press('Enter'); await sleep(150);
  await p.evaluate(()=>{ document.activeElement.blur(); }); await p.evaluate(()=>AMStudio.goSlide(2));
  await p.evaluate(()=>{ const t=document.querySelector('#thumbs .th[data-i="2"]'); t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); }); /* zona = miniaturas (como colar slides) */
  await p.keyboard.press('Shift+F10'); await sleep(200);
  const cm2=await p.evaluate(()=>{ const m=document.querySelector('.xmenu'); if(!m) return null; const r=m.getBoundingClientRect(), s=document.getElementById('sideMini').getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),strip:Math.round(s.right),t:m.textContent.slice(0,14)}; });
  await p.keyboard.press('Escape'); await sleep(100);
  check('R08b: menu do slide pelo teclado com o painel recolhido abre ao lado da faixa (não em 8,8)', cm2&&cm2.x>=cm2.strip&&cm2.y>=60&&/Slide 3/i.test(cm2.t), cm2);

  /* R09: + da faixa pelo teclado: o foco entra no menu de layouts e Esc devolve o foco ao + */
  await p.focus('#sideAdd'); await p.keyboard.press('Enter'); await sleep(150);
  const f9=await p.evaluate(()=>({open:document.getElementById('mSlide').classList.contains('open'), inMenu:document.getElementById('mSlide').contains(document.activeElement)}));
  await p.keyboard.press('ArrowDown'); await sleep(60); await p.keyboard.press('Escape'); await sleep(120);
  const f9b=await p.evaluate(()=>({open:document.getElementById('mSlide').classList.contains('open'), ae:document.activeElement.id}));
  await p.focus('#sideAdd'); await p.keyboard.press('Enter'); await sleep(120); await p.keyboard.press('Enter'); await sleep(200); const n9=(await geo()).n;
  await p.keyboard.press('Control+z'); await sleep(150); const n9u=(await geo()).n;
  await p.click('#sideExpand'); await sleep(150);
  check('R09: + da faixa com Enter põe o foco no 1º layout; Esc fecha e devolve o foco ao +; Enter no layout cria o slide e Ctrl+Z desfaz', f9.open&&f9.inMenu&&!f9b.open&&f9b.ae==='sideAdd'&&n9===7&&n9u===6, {f9,f9b,n9,n9u});

  /* R13: 1280×720 com o painel em 440: abrir a Biblioteca estreita o painel (≤ 196) para a gaveta não cobrir metade do slide; fechar devolve 440 */
  await p.setViewportSize({width:1280,height:720}); await sleep(200); await p.focus('#sideSplit'); await p.keyboard.press('End'); await sleep(100);
  await p.click('#bFx'); await sleep(600);
  const d13=await p.evaluate(()=>{ const w=document.getElementById('wrap').getBoundingClientRect(), dr=document.getElementById('drawer').getBoundingClientRect(); return {side:Math.round(document.getElementById('side').getBoundingClientRect().width), vis:+((Math.min(w.right,dr.left)-w.left)/w.width).toFixed(2), ls:localStorage.getItem('amStudio.sideW')}; });
  await p.screenshot({path:path.join(SHOTS,'s18-12-biblioteca-1280.png')});
  await p.click('#bFx'); await sleep(500); const g13b=await geo();
  check('R13: com a Biblioteca aberta o painel largo fica em 196 px (≥ 65% do slide à vista) sem mudar a largura salva; ao fechar volta a 440', d13.side===196&&d13.vis>=0.65&&d13.ls==='440'&&near(g13b.side.w,440,1), {d13,after:g13b.side.w});
  await p.focus('#sideSplit'); await p.keyboard.press('Enter'); await sleep(100);

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); try{ fs.unlinkSync(f); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
