/* S32 — Conectores presos a elementos (el.a1/el.a2) e SmartArt “Fluxograma” e “Mapa mental”.
   Prender: arrastar a ponta de uma linha até uma forma (lado mais perto ou automático; Alt = não prender; destaque no alvo);
   a ponta acompanha ao mover, redimensionar, empurrar com as setas e ao alinhar; painel “Pontas presas” (lado, Soltar); mover a
   linha sozinha solta; duplicar slide / copiar e colar / duplicar remapeiam; apagar a forma solta; salvar/reabrir e safeDeck;
   Ctrl+Z; PowerPoint Editável. SmartArt: dois layouts novos (14 no seletor), render, raster.
   Uso: python3 assemble.py && node test-s32-conectores.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s32-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s32'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS23=path.join(__dirname,'test-s23-tools.py');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,900):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const L=()=>p.evaluate(()=>{ const l=AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.type==='line'); return l?{x1:l.x1,y1:l.y1,x2:l.x2,y2:l.y2,a1:l.a1||null,a2:l.a2||null}:null; });
  /* ponto lógico (1280×720) → tela */
  const scr=async(x,y)=>p.evaluate(([x,y])=>{ const r=document.querySelector('#cv .am-stage').getBoundingClientRect(); return [r.left+x/1280*r.width, r.top+y/720*r.height]; },[x,y]);
  const hdl=async h=>{ const e=await p.$('.hdl.p[data-h="'+h+'"]'); const bb=await e.boundingBox(); return [bb.x+bb.width/2, bb.y+bb.height/2]; };
  async function dragTo(from, to, opts){ await p.mouse.move(from[0],from[1]); await p.mouse.down(); await p.mouse.move(from[0]+4,from[1]+3); if(opts&&opts.alt) await p.keyboard.down('Alt'); await p.mouse.move(to[0],to[1],{steps:8}); const mid=opts&&opts.mid?await opts.mid():null; await p.mouse.up(); if(opts&&opts.alt) await p.keyboard.up('Alt'); await sleep(250); return mid; }
  /* ---------- deck: A, B e a linha L ---------- */
  const ids=await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Conectores'; A.loadDeck(d,null);
    const a=mk.shape('rect'); Object.assign(a,{x:100,y:100,w:300,h:140,html:'A'}); const bb=mk.shape('round'); Object.assign(bb,{x:800,y:400,w:300,h:140,html:'B'}); const l=mk.line(true); Object.assign(l,{x1:500,y1:170,x2:700,y2:400});
    A.deck.slides[0].els.push(a,bb,l); A.renderAll(); A.commit(); return {a:a.id,b:bb.id,l:l.id}; });
  await p.evaluate(id=>AMStudio.select(id), ids.l); await sleep(250);
  /* 1. arrastar a ponta final até o meio do lado esquerdo de B */
  const mid=await dragTo(await hdl('p2'), await scr(804,470), {mid:async()=>p.evaluate(()=>!!document.querySelector('#cv .am-el.lnk-t'))});
  let l=await L();
  check('S32-01: arrastar a ponta até perto do meio do lado esquerdo de B prende ali (a2 = {B, w}; x2/y2 no meio do lado); o alvo fica destacado durante o arraste', mid && l.a2 && l.a2.id===ids.b && l.a2.s==='w' && l.x2===800 && l.y2===470 && !l.a1, {mid,l});
  const pan=await p.evaluate(()=>{ const P=document.getElementById('props'); const sec=[...P.querySelectorAll('.sec')].find(s=>s.querySelector('h3')&&/Pontas presas/.test(s.querySelector('h3').textContent)); return sec?{t:sec.textContent.replace(/\s+/g,' ').slice(0,200), sel:(sec.querySelector('select[data-p="a2.s"]')||{}).value, un:!!sec.querySelector('[data-act="unlink-a2"]'), noA1:!sec.querySelector('select[data-p="a1.s"]')}:null; });
  check('S32-02: painel “Pontas presas”: Fim presa a Forma (lado À esquerda, botão Soltar); Início solta', !!pan && /Fim presa a/.test(pan.t) && pan.sel==='w' && pan.un && pan.noA1 && /Início\s*Solta/.test(pan.t), pan);
  /* 2. mover B → a ponta acompanha; Ctrl+Z volta */
  await p.evaluate(id=>AMStudio.select(id), ids.b); await sleep(150);
  await dragTo(await scr(950,470), await scr(1050,520)); l=await L();
  check('S32-03: mover B leva a ponta junto (x2 900, y2 520) e a ponta continua presa', l.x2===900 && l.y2===520 && l.a2 && l.a2.id===ids.b, l);
  await p.keyboard.press('Control+z'); await sleep(250); l=await L();
  check('S32-04: um Ctrl+Z devolve B e a ponta (800, 470)', l.x2===800 && l.y2===470 && !!l.a2, l);
  /* 3. redimensionar B pela alça de baixo: o meio do lado esquerdo desce */
  await p.evaluate(id=>AMStudio.select(id), ids.b); await sleep(150);
  const hs=await p.$('.hdl[data-h="s"]'); const hb=await hs.boundingBox();
  await dragTo([hb.x+hb.width/2, hb.y+hb.height/2], await scr(950,600)); l=await L(); const Bz=await p.evaluate(id=>{ const e=AMStudio.deck.slides[0].els.find(x=>x.id===id); return {y:e.y,h:e.h}; }, ids.b);
  check('S32-05: redimensionar B (altura 200) move a ponta para o novo meio do lado (y2 500)', Bz.h===200 && l.y2===500 && l.x2===800, {l,Bz});
  /* 4. setas: empurrar B 3 px para a direita */
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await sleep(600); l=await L();
  check('S32-06: setas do teclado em B empurram a ponta junto (x2 803)', l.x2===803, l);
  /* 5. lado pelo painel: em cima, depois automático */
  await p.evaluate(id=>AMStudio.select(id), ids.l); await sleep(150);
  await p.selectOption('#props select[data-p="a2.s"]','n'); await sleep(250); l=await L();
  check('S32-07: lado “Em cima” pelo painel: ponta no meio de cima de B (953, 400)', l.a2.s==='n' && l.x2===953 && l.y2===400, l);
  await p.selectOption('#props select[data-p="a2.s"]','c'); await sleep(250); l=await L();
  const exp=await p.evaluate(id=>{ const e=AMStudio.deck.slides[0].els.find(x=>x.id===id); const cx=e.x+e.w/2, cy=e.y+e.h/2; const l=AMStudio.deck.slides[0].els.find(x=>x.type==='line'); const dx=l.x1-cx, dy=l.y1-cy; const k=Math.min((e.w/2)/Math.abs(dx),(e.h/2)/Math.abs(dy)); return [Math.round(cx+dx*k), Math.round(cy+dy*k)]; }, ids.b);
  check('S32-08: lado automático: a ponta fica onde a reta até a outra ponta cruza a caixa de B', l.a2.s==='c' && l.x2===exp[0] && l.y2===exp[1], {l,exp});
  /* 6. prender o início dentro de A (automático); as duas pontas automáticas se olham pelos centros */
  await dragTo(await hdl('p1'), await scr(250,140)); l=await L();
  const ex2=await p.evaluate(ids=>{ const S=AMStudio.deck.slides[0].els; const A=S.find(x=>x.id===ids.a), B=S.find(x=>x.id===ids.b); const c=e=>[e.x+e.w/2,e.y+e.h/2]; const pt=(t,o)=>{ const cc=c(t), dx=o[0]-cc[0], dy=o[1]-cc[1]; const k=Math.min((t.w/2)/Math.abs(dx),(t.h/2)/Math.abs(dy)); return [Math.round(cc[0]+dx*k), Math.round(cc[1]+dy*k)]; }; return {p1:pt(A,c(B)), p2:pt(B,c(A))}; }, ids);
  check('S32-09: soltar a ponta inicial dentro de A prende com lado automático; com as duas pontas presas, cada uma aponta para o centro da outra forma', l.a1 && l.a1.id===ids.a && l.a1.s==='c' && l.x1===ex2.p1[0] && l.y1===ex2.p1[1] && l.x2===ex2.p2[0] && l.y2===ex2.p2[1], {l,ex2});
  /* 7. Alt ao arrastar = não prender */
  await dragTo(await hdl('p1'), await scr(380,230), {alt:true}); l=await L();
  check('S32-10: Alt ao arrastar solta a ponta e deixa onde ficou (380, 230)', !l.a1 && l.x1===380 && l.y1===230 && !!l.a2, l);
  /* 8. mover a linha sozinha solta a ponta presa */
  await dragTo(await scr(Math.round((l.x1+l.x2)/2), Math.round((l.y1+l.y2)/2)), await scr(Math.round((l.x1+l.x2)/2)+60, Math.round((l.y1+l.y2)/2)+40)); l=await L();
  check('S32-11: mover a linha sozinha solta as pontas (sem a2) e desloca a linha', !l.a2 && !l.a1 && l.x1===440 && l.y1===270, l);
  /* 9. prender pela API e sincronizar; duplicar slide remapeia; copiar/colar remapeia; colar só a linha solta */
  await p.evaluate(ids=>{ const A=AMStudio; const l=A.deck.slides[0].els.find(x=>x.id===ids.l); l.a1={id:ids.a,s:'e'}; l.a2={id:ids.b,s:'w'}; A.renderAll(); A.commit(); }, ids); l=await L();
  check('S32-12: pontas presas pela API ficam no lugar certo ao desenhar/gravar (A direita 400,170 → B esquerda 803,500)', l.x1===400 && l.y1===170 && l.x2===803 && l.y2===500, l);
  await p.evaluate(()=>AMStudio.dupSlide(0)); await sleep(300);
  const dup=await p.evaluate(ids=>{ const s=AMStudio.deck.slides[1]; const l=s.els.find(e=>e.type==='line'); const a=s.els.find(e=>e.html==='A'), b=s.els.find(e=>e.html==='B'); return {cur:AMStudio.cur, ok:l.a1.id===a.id && l.a2.id===b.id && a.id!==ids.a && b.id!==ids.b}; }, ids);
  check('S32-13: duplicar o slide remapeia as pontas para as cópias de A e B', dup.cur===1 && dup.ok, dup);
  await p.evaluate(()=>{ AMStudio.goSlide(0); }); await sleep(150);
  await p.evaluate(ids=>AMStudio.selectMany([ids.a, ids.l]), ids); await p.keyboard.press('Control+c'); await sleep(150); await p.keyboard.press('Control+v'); await sleep(400);
  const pst=await p.evaluate(ids=>{ const S=AMStudio.deck.slides[0].els; const ls=S.filter(e=>e.type==='line'); const nl=ls[ls.length-1]; const na=S.filter(e=>e.html==='A'); const copyA=na[na.length-1]; return {n:S.length, a1:nl.a1&&nl.a1.id===copyA.id&&copyA.id!==ids.a, a2:nl.a2||null, sel:AMStudio.selected().length}; }, ids);
  check('S32-14: colar A + linha: a ponta inicial prende na cópia de A; a final (B não copiado) fica solta', pst.n===5 && pst.a1 && pst.a2===null && pst.sel===2, pst);
  await p.keyboard.press('Control+z'); await sleep(250);
  await p.evaluate(ids=>AMStudio.selectMany([ids.l]), ids); await p.keyboard.press('Control+d'); await sleep(300);
  const dp=await p.evaluate(()=>{ const ls=AMStudio.deck.slides[0].els.filter(e=>e.type==='line'); return {n:ls.length, free:!ls[1].a1&&!ls[1].a2, orig:!!ls[0].a1&&!!ls[0].a2}; });
  check('S32-15: Ctrl+D numa linha presa: a cópia vem solta e a original continua presa', dp.n===2 && dp.free && dp.orig, dp);
  await p.keyboard.press('Control+z'); await sleep(250);
  /* 10. apagar B solta a ponta; Ctrl+Z traz B e a ponta de volta */
  await p.evaluate(id=>AMStudio.select(id), ids.b); await p.keyboard.press('Delete'); await sleep(300); l=await L();
  check('S32-16: apagar B solta a ponta final (coordenadas ficam)', !l.a2 && l.x2===803 && l.y2===500 && !!l.a1, l);
  await p.keyboard.press('Control+z'); await sleep(300); l=await L();
  check('S32-17: Ctrl+Z traz B e a ponta presa de volta', !!l.a2 && l.a2.id===ids.b, l);
  /* 11. salvar/reabrir; safeDeck limpa pontas inválidas */
  const re=await p.evaluate(ids=>{ const A=AMStudio; const html=A.exportHTML(); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]); const l0=dk.slides[0].els.find(e=>e.type==='line'); A.loadDeck(dk,'re'); const l=A.deck.slides[0].els.find(e=>e.type==='line'); const bad=A.safeDeck({slides:[{id:'s1',els:[{id:'q',type:'line',x1:0,y1:0,x2:10,y2:10,a1:{id:'zzz',s:'n'},a2:{id:ids.a,s:'xx'}}]}]}).slides[0].els[0]; return {saved:l0.a1.s+l0.a2.s, kept:l.a1.id===ids.a&&l.a2.id===ids.b, badA1:bad.a1||null, badA2:bad.a2}; }, ids);
  check('S32-18: o arquivo salvo leva a1/a2 e reabre preso; safeDeck mantém id válido (lado inválido vira automático) e aceita o formato', re.saved==='ew' && re.kept && re.badA1 && re.badA1.id==='zzz' && re.badA2.s==='c', re);
  const sy=await p.evaluate(()=>{ const A=AMStudio; const s=A.deck.slides[0]; const l=s.els.find(e=>e.type==='line'); l.a1={id:'nao-existe',s:'n'}; A.renderAll(); return !l.a1; });
  check('S32-19: ponta presa a um id que não existe no slide é solta ao desenhar', sy);
  /* 12. PowerPoint Editável com a linha presa */
  const pk=path.join(TMP,'con.pptx'); fs.writeFileSync(pk, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  check('S32-20: PowerPoint Editável válido com a linha presa (vira conector comum)', insp.zipBad===null && insp.xmlBad.length===0 && insp.slides.length===2, {bad:insp.xmlBad, n:insp.slides.length});
  await p.evaluate(ids=>AMStudio.select(ids.l), ids); await sleep(200); await p.screenshot({path:SH('editor')});
  /* ---------- SmartArt: Fluxograma e Mapa mental ---------- */
  const sm=await p.evaluate(()=>{ const A=AMStudio; const d=A.newDeck(); d.title='SmartArt'; A.loadDeck(d,null);
    const f=A.insertFx('smart',null,null,null,{layout:'flow', items:AMRT.smartSample('flow')}); f.x=40; f.y=40; f.w=1200; f.h=300;
    A.addSlide('blank-light'); const m=A.insertFx('smart',null,null,null,{layout:'mindmap', items:AMRT.smartSample('mindmap')}); m.x=40; m.y=40; m.w=1200; m.h=640; A.goSlide(0); A.selectMany([]); A.renderAll(); A.commit();
    const q=(sel,st)=>st.querySelectorAll(sel).length; const st0=document.querySelector('#cv .am-stage');
    return {layouts:AMRT.SMART_LAYOUTS.length, names:AMRT.SMART_LAYOUTS.slice(-2).map(l=>l[1]), flow:{dia:q('.sa-dia',st0), end:q('.sa-flowend',st0), box:q('.sa-flowbox',st0), arw:q('.sa-arw',st0), n:q('.sa-n',st0), fail:!!st0.querySelector('.fx-falha')}}; });
  check('S32-21: 14 layouts de SmartArt (Fluxograma e Mapa mental); fluxograma de exemplo: 8 caixas (2 decisões em losango, Início/Fim em pílula, 4 etapas) e 7 setas', sm.layouts===14 && sm.names.join('|')==='Fluxograma|Mapa mental' && sm.flow.n===8 && sm.flow.dia===2 && sm.flow.end===2 && sm.flow.box===4 && sm.flow.arw===7 && !sm.flow.fail, sm);
  const inb=await p.evaluate(()=>{ const st=document.querySelector('#cv .am-stage'); const el=st.querySelector('.am-el'); const r=el.getBoundingClientRect(); return [...st.querySelectorAll('.sa-n')].every(n=>{ const q=n.getBoundingClientRect(); return q.left>=r.left-1&&q.right<=r.right+1&&q.top>=r.top-1&&q.bottom<=r.bottom+1; }); });
  check('S32-22: todas as caixas do fluxograma ficam dentro do elemento', inb);
  const r1=await p.evaluate(async()=>{ const rr=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1,type:'png'}); const png=rr.canvas.toDataURL('image/png'); rr.canvas.width=0; return png; });
  fs.writeFileSync(SH('flow'), Buffer.from(r1.split(',')[1],'base64'));
  const mm=await p.evaluate(()=>{ AMStudio.goSlide(1); const st=document.querySelector('#cv .am-stage'); const q=sel=>st.querySelectorAll(sel).length; return {c:q('.sa-mm-c'), b:q('.sa-mm-b'), s:q('.sa-mm-s'), l:q('.sa-ln.sa-mm-l'), l2:q('.sa-ln.sa-mm-l2'), fail:!!st.querySelector('.fx-falha'), cols:[...st.querySelectorAll('.sa-mm-b')].map(n=>n.style.getPropertyValue('--c')).filter((v,i,a)=>a.indexOf(v)===i).length}; });
  check('S32-23: mapa mental de exemplo: centro, 4 ramos (cores diferentes), 8 sub-ramos, 12 curvas', mm.c===1 && mm.b===4 && mm.s===8 && mm.l===12 && mm.l2===8 && mm.cols===4 && !mm.fail, mm);
  const r2=await p.evaluate(async()=>{ const rr=await AMExport.rasterSlide(AMStudio.deck.slides[1],{scale:1,type:'png'}); const png=rr.canvas.toDataURL('image/png'); rr.canvas.width=0; return png; });
  fs.writeFileSync(SH('mindmap'), Buffer.from(r2.split(',')[1],'base64'));
  const tiles=await p.evaluate(()=>{ const A=AMStudio; A.select(A.deck.slides[1].els[0].id); const g=document.querySelector('#props .salg'); return g?{n:g.querySelectorAll('button').length, on:(g.querySelector('button.on')||{}).textContent}:null; });
  check('S32-24: o painel do SmartArt mostra 14 layouts com “Mapa mental” marcado', !!tiles && tiles.n===14 && /Mapa mental/.test(tiles.on||''), tiles);
  await p.click('#mbar button[data-m=insert]'); await sleep(250); await p.hover('.xmenu .xi:has-text("SmartArt")'); await sleep(350);
  const smm=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi')].map(x=>x.textContent.trim()).filter(t=>/Fluxograma|Mapa mental/.test(t)));
  check('S32-25: Inserir › SmartArt ▸ lista Fluxograma e Mapa mental', smm.length===2, smm);
  await p.keyboard.press('Escape');
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
