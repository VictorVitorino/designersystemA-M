/* test-s01: Vitrine de efeitos em caixas (F1). Caixas com prévia viva (só as visíveis), filtros, busca, provador no slide real
   (Usar = um passo de desfazer · Descartar = nada muda), efeitos novos no runtime (entradas, contínuos, mouse, transições)
   valendo no arquivo exportado, painel e menu “Animação” lendo o mesmo vocabulário, tela de celular e movimento reduzido.
   Uso: python3 assemble.py && node test-s01.js   (o qa-gate.sh pega qualquer test-s[0-9][0-9]*.js) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s01-'+f+'.png');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined&&!ok?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(wait||800); return p; }
const J=p=>p.evaluate(()=>JSON.stringify(AMStudio.deck));
const cur=p=>p.evaluate(()=>AMStudio.gallery.current());
const provOpen=p=>p.evaluate(()=>!document.getElementById('gxProv').classList.contains('hidden'));
async function tryBox(p,id){ if(await p.evaluate(id=>document.querySelector('#drawerBody .gx-box[data-gx="'+id+'"]').hidden,id)){ await p.fill('#gxSearch',''); await p.click('#drawerBody [data-gf="all"]'); await sleep(200); }
  await p.evaluate(id=>{ const b=document.querySelector('#drawerBody .gx-box[data-gx="'+id+'"]'); b.scrollIntoView({block:'center'}); },id); await sleep(150);
  await p.locator('#drawerBody .gx-box[data-gx="'+id+'"] .gx-try').click(); await sleep(350); }
async function filt(p,f){ await p.click('#drawerBody [data-gf="'+f+'"]'); await sleep(250); }
/* um passo de desfazer: Ctrl+Z volta exatamente ao estado anterior e Ctrl+Shift+Z refaz exatamente o aplicado */
async function oneStep(p, before, after){ await p.evaluate(()=>document.activeElement&&document.activeElement.blur());
  await p.keyboard.press('Control+z'); await sleep(150); const u=await J(p); await p.keyboard.press('Control+Shift+z'); await sleep(150); const r=await J(p); return u===before&&r===after; }

(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  await p.evaluate(()=>AMStudio.hideDraftBanner());

  /* ---------- 1. vocabulário único no runtime ---------- */
  const voc=await p.evaluate(()=>{ const A=AMRT.ANIMS, o={}; Object.keys(A).forEach(f=>{ const ks=A[f].map(a=>a[0]); o[f]={n:A[f].filter(a=>a[0]!=='none').length, tok:ks.every(k=>/^\w{1,12}$/.test(k)), uniq:new Set(ks).size===ks.length, lab:A[f].every(a=>a[1]&&a[2])}; }); return o; });
  check('S01-01: AMRT.ANIMS tem ≥17 entradas, ≥10 contínuos, ≥10 de mouse e ≥7 transições, com chave, rótulo e descrição', voc.in.n>=17&&voc.loop.n>=10&&voc.hover.n>=10&&voc.tr.n>=7&&Object.values(voc).every(v=>v.tok&&v.uniq&&v.lab), voc);
  const sel0=await p.evaluate(()=>{ const s=AMStudio.deck.slides[0]; const t=AMStudio.mk.text('body',{x:100,y:100,w:500,h:80,html:'Teste'}); s.els.push(t); AMStudio.renderAll(); AMStudio.select(t.id);
    const o=[...document.querySelectorAll('#props select[data-p="anim.in"] option')].map(x=>x.value); const loops=[...document.querySelectorAll('#props [data-set="anim.loop"]')].map(x=>x.dataset.v); const hov=[...document.querySelectorAll('#props [data-set="anim.hover"]')].map(x=>x.dataset.v);
    const r={opts:o.length, all:AMRT.ANIMS.in.length, loops, hov, gal:!!document.querySelector('#props [data-act="gallery"]')}; s.els.pop(); AMStudio.select(null); AMStudio.renderAll(); return r; });
  check('S01-02: painel “Animação” lê o vocabulário (entradas, contínuos novos, mouse novos; “Fluxo” só para traços)', sel0.opts===sel0.all&&sel0.loops.includes('beacon')&&sel0.loops.includes('beat')&&!sel0.loops.includes('flow')&&sel0.hov.includes('spot')&&sel0.hov.includes('uline')&&sel0.gal, sel0);
  const trc=await p.evaluate(()=>[...document.querySelectorAll('#props [data-set="s.tr"]')].map(x=>x.dataset.v));
  check('S01-03: painel do slide oferece as transições novas (azul-marinho, íris, subir, desfoque)', ['fade','slide','zoom','none','navy','iris','up','blur'].every(k=>trc.includes(k)), trc);

  /* ---------- 2. vitrine: caixas, contagem, filtros, busca ---------- */
  await p.click('#bFx'); await sleep(1300);
  const g=await p.evaluate(()=>{ const it=AMStudio.gallery.items(), fam={}; it.forEach(i=>fam[i.fam]=(fam[i.fam]||0)+1);
    const chips={}; document.querySelectorAll('#drawerBody [data-gf]').forEach(c=>chips[c.dataset.gf]=+(c.querySelector('i')||{}).textContent);
    return {n:it.length, boxes:document.querySelectorAll('#drawerBody .gx-box').length, head:document.querySelector('.gx-count').textContent.trim(), fam, chips,
      tab:!document.getElementById('drawerBody').classList.contains('hidden'), anims:document.querySelectorAll('#drawerBody [data-anim]').length,
      models:Object.keys(AMRT.FX).filter(k=>AMRT.FX[k].model).reduce((a,k)=>a+AMRT.FX[k].variants.length,0), cmps:Object.keys(AMRT.FX).filter(k=>!AMRT.FX[k].model).length}; });
  check('S01-04: “Efeitos” abre a vitrine com uma caixa por efeito e o total no cabeçalho', g.tab&&g.n>=90&&g.boxes===g.n&&new RegExp('^'+g.n+' efeitos disponíveis').test(g.head), g);
  check('S01-05: famílias completas: entradas, contínuos, mouse, transições, componentes (FX) e cada efeito dos modelos', g.fam.in>=17&&g.fam.loop>=10&&g.fam.hover>=10&&g.fam.tr>=7&&g.fam.cmp===g.cmps&&g.fam.model===g.models, g.fam);
  check('S01-06: filtros com contagem por família (Todos, Entrada, Contínuo, Mouse, Transição, Componentes, Modelos)', g.chips.all===g.n&&['in','loop','hover','tr','cmp','model'].every(f=>g.chips[f]===g.fam[f]), g.chips);
  check('S01-07: chips antigos que aplicavam e abriam a apresentação saíram', g.anims===0);
  await p.screenshot({path:SH('01-vitrine')});
  const lazy=await p.evaluate(()=>{ const bx=[...document.querySelectorAll('#drawerBody .gx-box')]; return {first:!!bx[0].querySelector('.am-stage'), last:!!bx[bx.length-1].querySelector('.am-stage'), lastOff:bx[bx.length-1].classList.contains('gx-off')||!bx[bx.length-1].querySelector('.am-stage'), rendered:bx.filter(b=>b.querySelector('.gx-pv').children.length).length, total:bx.length}; });
  check('S01-08: só as caixas visíveis são desenhadas (IntersectionObserver); as de baixo esperam', lazy.first&&!lazy.last&&lazy.lastOff&&lazy.rendered<lazy.total/2, lazy);
  const live=await p.evaluate(()=>{ const st=document.querySelector('#drawerBody .gx-box[data-gx="in:rise"] .am-stage'), el=st&&st.querySelector('.am-el[data-in]'); return {play:st&&st.classList.contains('am-play'), anim:el&&getComputedStyle(el).animationName}; });
  check('S01-09: caixa de entrada toca a prévia de verdade (palco do runtime, animação amRise)', live.play&&live.anim==='amRise', live);
  await filt(p,'hover'); await sleep(200);
  const hv=[]; for(let i=0;i<14;i++){ hv.push(await p.evaluate(()=>!!document.querySelector('#drawerBody .gx-box[data-gx="hover:spot"] .am-fxw.am-hov'))); await sleep(250); }
  const vis=await p.evaluate(()=>[...document.querySelectorAll('#drawerBody .gx-box')].filter(b=>!b.hidden).map(b=>b.dataset.fam));
  check('S01-10: filtro “Ao passar o mouse” mostra só esses efeitos e a caixa simula o cursor (liga e desliga)', vis.length===g.fam.hover&&vis.every(f=>f==='hover')&&hv.includes(true)&&hv.includes(false), {vis:vis.length,hv});
  await p.hover('#drawerBody .gx-box[data-gx="hover:spot"]'); await sleep(550); const spot2=await p.evaluate(()=>[...document.querySelectorAll('#drawerBody .gx-box[data-gx="hover:spot"] .am-stage .am-el')].map(e=>+getComputedStyle(e.querySelector('.am-rot')).opacity));
  check('S01-11: passar o mouse na caixa segura o efeito: “Holofote” escurece os demais elementos', spot2.filter(o=>o<.5).length===2&&spot2.filter(o=>o>.95).length===1, spot2);
  await p.mouse.move(700,500);
  await filt(p,'all'); await p.fill('#gxSearch','iris'); await sleep(250);
  const sr=await p.evaluate(()=>[...document.querySelectorAll('#drawerBody .gx-box')].filter(b=>!b.hidden).map(b=>b.dataset.gx));
  await p.fill('#gxSearch','HOLOFOTE'); await sleep(200); const sr2=await p.evaluate(()=>[...document.querySelectorAll('#drawerBody .gx-box')].filter(b=>!b.hidden).map(b=>b.dataset.gx));
  await p.fill('#gxSearch','zzqq'); await sleep(200); const sr3=await p.evaluate(()=>({vis:[...document.querySelectorAll('#drawerBody .gx-box')].filter(b=>!b.hidden).length, empty:!document.getElementById('gxEmpty').hidden}));
  check('S01-12: busca sem acento e sem caixa (“iris” acha Íris de entrada e de transição; nada → aviso)', sr.includes('in:iris')&&sr.includes('tr:iris')&&sr2[0]==='hover:spot'&&sr2.every(id=>/spot/.test(id))&&sr3.vis===0&&sr3.empty, {sr,sr2,sr3});
  await p.fill('#gxSearch',''); await sleep(200);

  /* ---------- 3. provador sem seleção: exemplo; Usar desligado; Descartar não muda nada ---------- */
  const j0=await J(p);
  await tryBox(p,'in:iris');
  const pv=await p.evaluate(()=>({open:!document.getElementById('gxProv').classList.contains('hidden'), name:document.getElementById('gpName').textContent, inn:!!document.querySelector('#gpBox .am-stage.am-play .am-el[data-in=iris]'), dis:document.getElementById('gpUse').disabled, tgt:document.getElementById('gpTgt').textContent, pres:document.getElementById('presenter').classList.contains('open')}));
  check('S01-13: clicar numa caixa abre o Provador (palco maior com o efeito num exemplo); não abre a apresentação', pv.open&&pv.name==='Íris'&&pv.inn&&!pv.pres, pv);
  check('S01-14: sem seleção, “Usar este efeito” fica desligado e explica o porquê', pv.dis&&/Selecione um elemento/.test(pv.tgt), pv);
  await p.screenshot({path:SH('02-provador-exemplo')});
  await p.click('[data-gp=discard]'); await sleep(250);
  check('S01-15: “Descartar” fecha o provador e não muda nada', !(await provOpen(p))&&(await J(p))===j0);

  /* ---------- 4. provador no slide real com seleção ---------- */
  await p.evaluate(()=>{ AMStudio.loadDeck(AMCover.buildTemplate(0)); AMStudio.goSlide(1); }); await sleep(300);
  const tid=await p.evaluate(()=>{ const e=AMStudio.deck.slides[1].els.find(x=>x.type==='text'&&/Crescimento/.test(x.html)); AMStudio.select(e.id); return e.id; }); await sleep(200);
  const ctxl=await p.evaluate(()=>document.getElementById('gxCtx').textContent);
  check('S01-16: a vitrine mostra em que elemento o efeito será provado', /Provar em: Texto/.test(ctxl), ctxl);
  const jA=await J(p);
  await tryBox(p,'in:words'); await sleep(250);
  const rw=await p.evaluate(id=>{ const st=document.querySelector('#gpBox .am-stage'), n=AMStudio.deck.slides[1].els.length; const t=st.querySelector('.am-el[data-id="'+id+'"]');
    return {els:st.querySelectorAll(':scope>.am-el').length, n, words:t?t.querySelectorAll('.amx-w').length:0, inn:t&&t.dataset.in, others:[...st.querySelectorAll(':scope>.am-el[data-in]')].length, canvas:document.querySelectorAll('#wrap .amx-w').length, dis:document.getElementById('gpUse').disabled, tag:document.getElementById('gpTag').textContent}; },tid);
  check('S01-17: provador toca o efeito no elemento selecionado, no slide real (só ele anima; o resto fica parado)', rw.els===rw.n&&rw.inn==='words'&&rw.others===1&&!rw.dis&&/Slide 2/.test(rw.tag), rw);
  check('S01-18: “Palavra a palavra” divide o texto só no palco que toca (o slide em edição não muda)', rw.words>=4&&rw.canvas===0&&(await J(p))===jA, rw);
  await p.screenshot({path:SH('03-provador-slide-real')});
  await p.click('#gpUse'); await sleep(300);
  const jB=await J(p); const an=await p.evaluate(id=>AMStudio.deck.slides[1].els.find(e=>e.id===id).anim.in,tid);
  const used=await p.evaluate(()=>document.querySelector('#drawerBody .gx-box[data-gx="in:words"]').classList.contains('gx-used'));
  check('S01-19: “Usar este efeito” aplica, fecha o provador e marca a caixa “Em uso”', an==='words'&&!(await provOpen(p))&&used, {an,used});
  check('S01-20: “Usar” é exatamente um passo de desfazer (Ctrl+Z volta, Ctrl+Shift+Z refaz)', await oneStep(p,jA,jB));
  const pres=await p.evaluate(()=>document.getElementById('presenter').classList.contains('open'));
  check('S01-21: aplicar não abre a apresentação em tela cheia (comportamento antigo removido)', !pres);

  /* incompatível: Desenhar num texto; depois numa seta */
  await p.evaluate(id=>AMStudio.select(id),tid); await sleep(150);
  await filt(p,'in'); await tryBox(p,'in:draw');
  const inc=await p.evaluate(()=>({dis:document.getElementById('gpUse').disabled, msg:document.getElementById('gpTgt').textContent}));
  check('S01-22: efeito incompatível (Desenhar num texto) não pode ser usado e diz onde funciona', inc.dis&&/linhas, setas/.test(inc.msg), inc);
  const lid=await p.evaluate(()=>{ const s=AMStudio.deck.slides[1]; const l=Object.assign(AMStudio.mk.line(true),{x1:200,y1:660,x2:700,y2:660}); s.els.push(l); AMStudio.renderAll(); AMStudio.commit(); AMStudio.select(l.id); return l.id; }); await sleep(300);
  const inc2=await p.evaluate(()=>({dis:document.getElementById('gpUse').disabled, name:document.getElementById('gpName').textContent, ln:!!document.querySelector('#gpBox .am-el[data-in=draw] .am-ln')}));
  check('S01-23: trocar a seleção com o provador aberto atualiza a prova (seta: Desenhar liberado)', !inc2.dis&&inc2.ln&&inc2.name==='Desenhar (linhas)', inc2);
  /* contínuo na seta + descartar: nada muda */
  await p.click('[data-gp=discard]'); await sleep(200); await filt(p,'loop');
  const jC=await J(p); await tryBox(p,'loop:flow'); await sleep(300);
  const fl=await p.evaluate(()=>{ const ln=document.querySelector('#gpBox .am-fxw[data-loop=flow] .am-ln'); return ln&&getComputedStyle(ln).animationName; });
  await p.keyboard.press('Escape'); await sleep(250);
  const esc=await p.evaluate(()=>({prov:AMStudio.gallery.current(), drawer:document.getElementById('drawer').classList.contains('open'), sel:AMStudio.selected().length}));
  check('S01-24: “Fluxo contínuo” na seta (tracejado andando) e Esc descarta sem fechar a gaveta nem perder a seleção', fl==='amxFlow'&&!esc.prov&&esc.drawer&&esc.sel===1&&(await J(p))===jC, {fl,esc});

  /* ← → navegam entre vizinhos do filtro */
  await tryBox(p,'loop:pulse'); const c1=await cur(p);
  await p.keyboard.press('ArrowRight'); await sleep(250); const c2=await cur(p);
  await p.keyboard.press('ArrowLeft'); await sleep(250); const c3=await cur(p);
  const pos=await p.evaluate(()=>document.getElementById('gpPos').textContent);
  check('S01-25: no provador, ← → (e ‹ ›) passam ao efeito vizinho do filtro atual', c1==='loop:pulse'&&c2==='loop:float'&&c3==='loop:pulse'&&/^1 de 10/.test(pos), {c1,c2,c3,pos});
  await p.click('[data-gp=next]'); await sleep(200); const c4=await cur(p); await p.click('[data-gp=back]'); await sleep(200);
  check('S01-26: botão › também navega; “‹ Vitrine” volta à grade', c4==='loop:float'&&!(await provOpen(p)), c4);

  /* transição: vai para o slide atual */
  await filt(p,'tr'); const jD=await J(p); await tryBox(p,'tr:navy'); await sleep(900);
  const trp=await p.evaluate(()=>({sl:document.querySelectorAll('#gpBox .amp-slide').length, on:(document.querySelector('#gpBox .amp-slide.on')||{}).dataset, tag:document.getElementById('gpTag').textContent}));
  await p.screenshot({path:SH('04-provador-transicao')});
  await p.click('#gpUse'); await sleep(250); const jE=await J(p);
  const tr=await p.evaluate(()=>AMStudio.deck.slides[1].tr);
  check('S01-27: transição: o provador toca slide anterior → atual e “Usar” grava a transição do slide', trp.sl===2&&/Slide 1 → slide 2/.test(trp.tag)&&tr==='navy', trp);
  check('S01-28: transição aplicada = um passo de desfazer', await oneStep(p,jD,jE));

  /* componente e efeito de modelo */
  await p.evaluate(()=>AMStudio.select(null)); await filt(p,'cmp'); const jF=await J(p); const n0=await p.evaluate(()=>AMStudio.deck.slides[1].els.length);
  await tryBox(p,'cmp:counter'); await sleep(300);
  const cp=await p.evaluate(()=>({extra:document.querySelectorAll('#gpBox .am-stage>.am-el').length, cnt:!!document.querySelector('#gpBox .am-k-counter')}));
  await p.click('#gpUse'); await sleep(300); const jG=await J(p);
  const ins=await p.evaluate(()=>{ const s=AMStudio.deck.slides[1], e=s.els[s.els.length-1]; return {n:s.els.length, kind:e.kind, sel:AMStudio.selected()[0]===e.id}; });
  check('S01-29: componente: o provador mostra o novo elemento no slide e “Usar” o insere selecionado', cp.cnt&&cp.extra===n0+1&&ins.n===n0+1&&ins.kind==='counter'&&ins.sel, {cp,ins});
  check('S01-30: inserir pelo provador = um passo de desfazer', await oneStep(p,jF,jG));
  await filt(p,'model'); await p.evaluate(()=>AMStudio.select(null)); await sleep(100);
  await tryBox(p,'model:bars:highlight'); await p.click('#gpUse'); await sleep(300);
  const bar=await p.evaluate(()=>{ const s=AMStudio.deck.slides[1], e=s.els[s.els.length-1]; return {kind:e.kind, v:e.variant, id:e.id}; });
  await sleep(200); const jH=await J(p);
  await tryBox(p,'model:bars:grow'); const mv=await p.evaluate(()=>document.getElementById('gpTgt').textContent); await p.click('#gpUse'); await sleep(300);
  const bar2=await p.evaluate(id=>({v:AMStudio.deck.slides[1].els.find(e=>e.id===id).variant, n:AMStudio.deck.slides[1].els.filter(e=>e.kind==='bars').length}),bar.id);
  check('S01-31: efeito de modelo: sem seleção insere já com o efeito; com o modelo selecionado, troca o efeito dele', bar.kind==='bars'&&bar.v==='highlight'&&/troca o efeito/.test(mv)&&bar2.v==='grow'&&bar2.n===1, {bar,bar2,mv});
  check('S01-32: trocar o efeito do modelo = um passo de desfazer', await oneStep(p,jH,await J(p)));

  /* atalho rápido Inserir (test.js) e menu “Animação” → vitrine */
  await filt(p,'all'); const n1=await p.evaluate(()=>AMStudio.deck.slides[1].els.length);
  await p.click('[data-ins=counter]'); await sleep(250);
  check('S01-33: “Inserir” na caixa do componente insere direto (sem provar)', (await p.evaluate(()=>AMStudio.deck.slides[1].els.length))===n1+1&&!(await provOpen(p)));
  await p.click('#bFxClose'); await sleep(400);
  await p.evaluate(id=>AMStudio.select(id),tid); await sleep(150); await p.click('#fxArrow'); await sleep(250);
  const mvar=await p.evaluate(()=>({n:document.querySelectorAll('#mVar .vo').length, want:AMRT.ANIMS.in.filter(a=>a[4]!=='ln').length, draw:!!document.querySelector('#mVar .vo[data-v=draw]'), words:!!document.querySelector('#mVar .vo[data-v=words]'), all:!!document.querySelector('#mVar .vall'), fits:(()=>{ const r=document.getElementById('mVar').getBoundingClientRect(); return r.bottom<=innerHeight&&r.top>=0; })()}));
  await p.click('#mVar .vall'); await sleep(700);
  const fromVar=await p.evaluate(()=>({open:document.getElementById('drawer').classList.contains('open'), f:document.querySelector('#drawerBody [data-gf].on').dataset.gf}));
  check('S01-34: menu “Animação” lista as entradas compatíveis, cabe na tela e leva à vitrine filtrada em Entrada', mvar.n===mvar.want&&!mvar.draw&&mvar.words&&mvar.all&&mvar.fits&&fromVar.open&&fromVar.f==='in', {mvar,fromVar});

  /* ---------- 5. relógio: nada anima com a gaveta fechada, na aba Modelos ou com a capa por cima ---------- */
  const mut=async(sec)=>p.evaluate(async ms=>{ let n=0; const o=new MutationObserver(m=>n+=m.length); o.observe(document.getElementById('drawerBody'),{childList:true,subtree:true,attributes:true,characterData:true}); await new Promise(r=>setTimeout(r,ms)); o.disconnect(); return n; },sec);
  const runMut=await mut(1500);
  await p.click('#bFxClose'); await sleep(500); const closedMut=await mut(2000);
  const paused=await p.evaluate(()=>document.getElementById('drawerBody').classList.contains('gx-paused'));
  await p.click('#bFx'); await sleep(600); await p.click('.dtabs [data-tab=models]'); await sleep(400); const modMut=await mut(1500);
  await p.click('.dtabs [data-tab=fx]'); await sleep(500); await p.evaluate(()=>AMCover.open()); await sleep(600); const covMut=await mut(2000); await p.evaluate(()=>AMCover.close()); await sleep(800);
  check('S01-35: relógio único: com a vitrine aberta anima; fechada, na aba Modelos ou sob a capa, para (0 mudanças) e pausa o CSS', runMut>0&&closedMut===0&&paused&&modMut===0&&covMut===0, {runMut,closedMut,paused,modMut,covMut});

  /* ---------- 6. vitrine ampliada e celular ---------- */
  await p.click('#drawerBody [data-gw]'); await sleep(700);
  const wide=await p.evaluate(()=>{ const d=document.getElementById('drawer'), g=document.querySelector('#drawerBody .gx-grid'); return {w:d.getBoundingClientRect().width, cols:getComputedStyle(g).gridTemplateColumns.split(' ').length, ls:localStorage.getItem('amStudio.gxWide')}; });
  await p.screenshot({path:SH('05-vitrine-ampliada')});
  await tryBox(p,'hover:lift'); await sleep(400); const wp=await p.evaluate(()=>{ const a=document.querySelector('.gp-stage').getBoundingClientRect(), h=document.querySelector('.gp-head').getBoundingClientRect(); return {side:h.left>a.right-1, stageW:a.width}; });
  await p.screenshot({path:SH('06-provador-ampliado')});
  await p.click('[data-gp=discard]'); await p.click('#drawerBody [data-gw]'); await sleep(500);
  check('S01-36: “Ampliar a vitrine” alarga a gaveta (≥5 colunas), lembra a escolha e põe o provador lado a lado', wide.w>900&&wide.cols>=5&&wide.ls==='1'&&wp.side&&wp.stageW>500, {wide,wp});
  const ph=await open(await b.newContext({viewport:{width:390,height:844}}), FILE+'?nocover','phone');
  await ph.evaluate(()=>{ AMStudio.hideDraftBanner(); AMStudio.openDrawer(true,'fx'); }); await sleep(900);
  const pm=await ph.evaluate(()=>{ const db=document.getElementById('drawerBody'), g=db.querySelector('.gx-grid'), d=document.getElementById('drawer').getBoundingClientRect(); return {cols:getComputedStyle(g).gridTemplateColumns.split(' ').length, over:db.scrollWidth-db.clientWidth, dw:d.width, right:d.right}; });
  await ph.screenshot({path:SH('07-celular-vitrine')});
  await ph.evaluate(()=>AMStudio.gallery.tryFx('in:pop')); await sleep(700);
  const pp=await ph.evaluate(()=>{ const u=document.getElementById('gpUse').getBoundingClientRect(), s=document.querySelector('.gp-stage').getBoundingClientRect(), pv=document.getElementById('gxProv'); return {useIn:u.bottom<=innerHeight&&u.right<=innerWidth, stageW:s.width, over:pv.scrollWidth-pv.clientWidth}; });
  await ph.screenshot({path:SH('08-celular-provador')});
  check('S01-37: celular 390 px: vitrine em 2 colunas sem rolagem lateral; provador cabe com “Usar” visível', pm.cols===2&&pm.over<=0&&pm.right<=390.5&&pp.useIn&&pp.over<=0&&pp.stageW>280, {pm,pp});
  await ph.close();

  /* ---------- 6b. rodada 1 de QA: teclas com o provador aberto, arrasto com a variante, textos inteiros, legenda fora do slide ---------- */
  await p.evaluate(()=>{ AMStudio.loadDeck(AMCover.buildTemplate(0)); AMStudio.goSlide(1); }); await sleep(300);
  const kid=await p.evaluate(()=>AMStudio.deck.slides[1].els.find(e=>e.type==='text'&&/Crescimento/.test(e.html)).id);
  const kr=await p.evaluate(id=>{ const b=document.querySelector('#wrap .am-el[data-id="'+id+'"]').getBoundingClientRect(); return {x:b.x+40,y:b.y+b.height/2}; },kid);
  await p.mouse.click(kr.x,kr.y); await sleep(250);
  await filt(p,'all'); await tryBox(p,'hover:lift'); await sleep(250);
  const jK=await J(p);
  const sb=await p.evaluate(()=>{ const b=document.getElementById('gpBox').getBoundingClientRect(); return {x:b.x+b.width*.5,y:b.y+b.height*.3}; });
  await p.mouse.click(sb.x,sb.y); await sleep(200);
  const k0=await cur(p); await p.keyboard.press('ArrowRight'); await sleep(250); const k1=await cur(p);
  await p.keyboard.press('ArrowLeft'); await sleep(250); const k1b=await cur(p);
  await p.keyboard.press('Space'); await p.keyboard.press('Enter'); await p.keyboard.press('Delete'); await p.keyboard.press('Backspace'); await p.keyboard.type('ab'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowDown'); await sleep(300);
  const ks=await p.evaluate(()=>({ce:!!document.querySelector('#wrap [contenteditable=true]'), prov:AMStudio.gallery.current(), sel:AMStudio.selected().length}));
  check('S01-45: clique no palco do provador e depois ← → navegam; Espaço/Enter, Delete, Backspace, letras e ↑ ↓ não mexem no slide por trás', k0==='hover:lift'&&k1!==k0&&k1b===k0&&ks.prov==='hover:lift'&&!ks.ce&&ks.sel===1&&(await J(p))===jK, {k0,k1,k1b,ks});
  await p.click('#dTitle'); await sleep(150); const onBody=await p.evaluate(()=>document.activeElement===document.body);
  await p.keyboard.press('Delete'); await p.keyboard.type('x'); await p.keyboard.press('ArrowRight'); await sleep(250); const k2=await cur(p);
  await p.click('[data-gp=discard]'); await sleep(200);
  const jK2=await J(p);
  await p.mouse.click(kr.x,kr.y); await sleep(200); const x0=await p.evaluate(id=>AMStudio.deck.slides[1].els.find(e=>e.id===id).x,kid);
  await p.keyboard.press('ArrowRight'); await sleep(150); const x1=await p.evaluate(id=>AMStudio.deck.slides[1].els.find(e=>e.id===id).x,kid);
  check('S01-46: foco no corpo da página após clicar na gaveta: as teclas seguem no provador; “Descartar” deixa a obra intacta; fechado, as setas voltam a mover', onBody&&k2!==k0&&jK2===jK&&!(await provOpen(p))&&x1===x0+1, {onBody,k2,same:jK2===jK,x0,x1});
  await p.keyboard.press('Control+z'); await sleep(150);
  const nD=await p.evaluate(()=>{ AMStudio.select(null); return AMStudio.deck.slides[1].els.length; });
  const drop=t=>p.evaluate(t=>{ const src=document.querySelector('#drawerBody .gx-box[data-gx="model:raci:focus"]'), dt=new DataTransfer(); if(t) dt.setData('text/plain',t); else src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    const w=document.getElementById('wrap'), r=w.getBoundingClientRect(), o={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.x+220,clientY:r.y+200}; w.dispatchEvent(new DragEvent('dragover',o)); w.dispatchEvent(new DragEvent('drop',o)); return dt.getData('text/plain'); },t);
  const pay=await drop(null); await sleep(300);
  const dr=await p.evaluate(()=>{ const s=AMStudio.deck.slides[1], e=s.els[s.els.length-1]; return {n:s.els.length, kind:e.kind, v:e.variant}; });
  await drop('amfx:naoexiste:x'); await sleep(200); const nBad=await p.evaluate(()=>AMStudio.deck.slides[1].els.length);
  check('S01-47: arrastar a caixa de um efeito de modelo insere esse efeito (Matriz RACI + “Foco”), não o padrão; tipo desconhecido não insere nada', pay==='amfx:raci:focus'&&dr.n===nD+1&&dr.kind==='raci'&&dr.v==='focus'&&nBad===nD+1, {pay,nD,dr,nBad});
  await filt(p,'all'); await p.evaluate(()=>document.getElementById('drawerBody').scrollTop=0);
  const fit=await p.evaluate(()=>{ const o=[]; document.querySelectorAll('#drawerBody .gx-box').forEach(bx=>{ const n=bx.querySelector('.gx-ft b'), c=bx.querySelector('.gx-cat'); if(n.scrollHeight>n.clientHeight+1||n.scrollWidth>n.clientWidth+1) o.push(bx.dataset.gx); if(c.scrollWidth>c.clientWidth+1) o.push('cat '+bx.dataset.gx); }); return {o, w:document.getElementById('drawer').getBoundingClientRect().width}; });
  await filt(p,'hover');
  const phf=await p.evaluate(()=>{ const i=document.getElementById('gxSearch'), cs=getComputedStyle(i), c=document.createElement('canvas').getContext('2d'); c.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily; return {need:Math.ceil(c.measureText(i.placeholder).width), have:i.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight), shown:document.getElementById('gxShown').textContent}; });
  check('S01-48: gaveta padrão (560 px): nomes e categorias inteiros (nome em até 2 linhas); com filtro, a busca mostra o texto de ajuda inteiro e a contagem vai para a linha de contexto', fit.w<600&&fit.o.length===0&&phf.need<=phf.have&&/^mostrando 10 de \d+$/.test(phf.shown), {fit,phf});
  await filt(p,'in'); await tryBox(p,'in:pop'); await sleep(300);
  const tg=await p.evaluate(()=>{ const b=document.getElementById('gpBox').getBoundingClientRect(), t=document.getElementById('gpTag').getBoundingClientRect(), r=document.querySelector('.gp-rep').getBoundingClientRect(); return {tag:t.top>=b.bottom-.5&&t.height>0, rep:r.top>=b.bottom-.5, txt:document.getElementById('gpTag').textContent}; });
  check('S01-49: a legenda “Slide N · …” e o “Repetir” ficam abaixo do palco, sem cobrir o slide', tg.tag&&tg.rep&&/^Slide 2/.test(tg.txt), tg);
  await p.click('[data-gp=discard]'); await sleep(150);
  await p.evaluate(()=>{ const S=AMStudio, s=S.deck.slides[1]; s.els.push(Object.assign(S.mk.shape('rect'),{id:'eEmpty',x:900,y:600,w:200,h:80,html:''})); S.renderAll(); S.commit(); S.select('eEmpty'); }); await sleep(250);
  await p.evaluate(()=>AMStudio.gallery.tryFx('in:words')); await sleep(400);
  const we=await p.evaluate(()=>({dis:document.getElementById('gpUse').disabled, t:document.getElementById('gpTgt').textContent, chip:!!document.querySelector('#props [data-set="anim.in"][data-v=words]')}));
  await p.click('[data-gp=discard]'); await sleep(150);
  await p.evaluate(()=>{ const S=AMStudio, e=S.deck.slides[1].els.find(x=>x.id==='eEmpty'); e.html='Meta 2027'; S.renderAll(); S.commit(); S.select('eEmpty'); }); await sleep(250);
  await p.evaluate(()=>AMStudio.gallery.tryFx('in:words')); await sleep(400);
  const wt=await p.evaluate(()=>!document.getElementById('gpUse').disabled);
  await p.click('[data-gp=discard]'); await sleep(150);
  check('S01-50: “Palavra a palavra” não vale para forma sem texto (Usar desligado e explica); com texto, vale', we.dis&&/textos e formas com texto/.test(we.t)&&wt, {we,wt});

  /* ---------- 6c. rodada 2 de QA: foco após a vitrine x modo apresentação, histórico no teto, soltar texto forjado, aba ativa, telas baixas ---------- */
  await p.evaluate(()=>{ AMStudio.loadDeck(AMCover.buildTemplate(0)); AMStudio.goSlide(0); AMStudio.select(null); }); await sleep(300);
  if (!(await p.evaluate(()=>document.getElementById('drawer').classList.contains('open')))) { await p.click('#bFx'); await sleep(700); }
  const ppos=()=>p.evaluate(()=>{ const n=document.querySelector('#presenter .amp-pos'); return n?n.textContent:''; });
  await filt(p,'all'); await tryBox(p,'in:rise'); await p.click('[data-gp=discard]'); await sleep(250);
  const fA=await p.evaluate(()=>document.activeElement.classList.contains('gx-try'));
  await p.keyboard.press('F5'); await sleep(700);
  const fB=await p.evaluate(()=>!document.getElementById('drawer').contains(document.activeElement));
  await p.keyboard.press('ArrowRight'); await sleep(500); const pv1=await ppos(); await p.keyboard.press('ArrowLeft'); await sleep(500); const pv0=await ppos();
  await p.keyboard.press('Escape'); await sleep(400);
  await p.click('#bFx'); await sleep(700); const jT=await J(p);
  await tryBox(p,'tr:up'); await p.click('#gpUse'); await sleep(300);
  const fC=await p.evaluate(()=>document.activeElement.classList.contains('gx-try'));
  await p.keyboard.press('Shift+F5'); await sleep(700); await p.keyboard.press('ArrowRight'); await sleep(500); const pv2=await ppos();
  await p.keyboard.press('Escape'); await sleep(400);
  check('S01-52: depois de provar na vitrine (Descartar ou Usar), F5/Shift+F5 e ← → passam os slides; o foco sai da gaveta escondida', fA&&fB&&fC&&/^02/.test(pv1)&&/^01/.test(pv0)&&/^02/.test(pv2)&&(await J(p))!==jT, {fA,fB,fC,pv1,pv0,pv2});
  /* o provador acompanha a obra mesmo com o histórico no teto de 50 passos (arrasto com o mouse de verdade depois de 60 passos) */
  await p.evaluate(()=>{ AMStudio.loadDeck(AMCover.buildTemplate(0)); AMStudio.goSlide(1); const e=AMStudio.deck.slides[1].els[0]; for(let i=0;i<60;i++){ e.x+=1; AMStudio.commit(); } AMStudio.renderAll(); }); await sleep(250);
  const hid=await p.evaluate(()=>{ const id=AMStudio.deck.slides[1].els.find(e=>e.type==='text'&&/Crescimento/.test(e.html)).id; AMStudio.select(id); AMStudio.gallery.tryFx('loop:pulse'); return id; }); await sleep(500);
  const hp=await p.evaluate(id=>{ const b=document.querySelector('#wrap .am-el[data-id="'+id+'"]').getBoundingClientRect(); return {x:b.x+30,y:b.y+b.height/2}; },hid);
  await p.mouse.move(hp.x,hp.y); await p.mouse.down(); await p.mouse.move(hp.x+60,hp.y+40,{steps:6}); await p.mouse.up(); await sleep(450);
  const hr=await p.evaluate(id=>{ const e=AMStudio.deck.slides[1].els.find(x=>x.id===id), n=document.querySelector('#gpBox .am-el[data-id="'+id+'"]'); return {x:e.x, left:n?parseFloat(n.style.left):null, prov:AMStudio.gallery.current()}; },hid);
  check('S01-53: com o histórico no teto (60 passos), arrastar o elemento atualiza a prova', hr.prov==='loop:pulse'&&hr.left!==null&&Math.abs(hr.left-hr.x/1280*100)<.2, hr);
  /* a aba ativa com o provador aberto volta à vitrine (nunca grade e provador empilhados) */
  await p.click('.dtabs button[data-tab="fx"]'); await sleep(300);
  const ta=await p.evaluate(()=>({grid:!document.getElementById('drawerBody').classList.contains('hidden'), prov:!document.getElementById('gxProv').classList.contains('hidden'), cur:AMStudio.gallery.current()}));
  check('S01-54: clicar na aba “Efeitos e animações” com o provador aberto volta à vitrine (sem empilhar grade e provador)', ta.grid&&!ta.prov&&ta.cur===null, ta);
  /* texto forjado arrastado de fora: propriedades herdadas não viram componente */
  const nP=await p.evaluate(()=>{ AMStudio.select(null); return AMStudio.deck.slides[1].els.length; }); const e0=errs.length;
  await p.evaluate(()=>{ const w=document.getElementById('wrap'), r=w.getBoundingClientRect(); ['amfx:constructor','amfx:toString','amfx:__proto__','amfx:hasOwnProperty:x'].forEach(t=>{ const dt=new DataTransfer(); dt.setData('text/plain',t); w.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,clientX:r.x+300,clientY:r.y+200,bubbles:true,cancelable:true})); }); }); await sleep(300);
  const nP2=await p.evaluate(()=>AMStudio.deck.slides[1].els.length);
  check('S01-55: soltar “amfx:constructor”, “amfx:toString” ou “amfx:__proto__” não insere nada nem gera erro', nP2===nP&&errs.length===e0, {nP,nP2,errs:errs.slice(e0)});
  /* telas baixas: legenda, Repetir, “Quando usar” e “Vai para” acima da barra de decisão (texto selecionado, sem seleção, componente) */
  const fold=[];
  for (const vp of [{width:1280,height:720},{width:1366,height:768}]) {
    const fc=await b.newContext({viewport:vp}); const fp=await open(fc, FILE+'?nocover', 'fold'+vp.width, 900);
    await fp.evaluate(()=>{ AMStudio.hideDraftBanner(); AMStudio.loadDeck(AMCover.buildTemplate(0)); AMStudio.goSlide(1); });
    for (const c of [['sel','in:iris'],['none','in:pop'],['none','cmp:counter']]) {
      await fp.evaluate(c=>{ const s=AMStudio.deck.slides[1]; AMStudio.select(c[0]==='sel'?s.els.find(e=>e.type==='text'&&/Crescimento/.test(e.html)).id:null); AMStudio.gallery.tryFx(c[1]); },c); await sleep(450);
      const m=await fp.evaluate(()=>{ const r=s=>document.querySelector(s).getBoundingClientRect(), d=r('.gp-dec'), st=r('.gp-stage'); return {id:AMStudio.gallery.current(), hid:['.gp-cap','.gp-rep','.gp-when','#gpTgt'].filter(s=>r(s).bottom>d.top+.5), stage:Math.round(st.width), col:Math.round(r('.gp-info').width), vis:d.bottom<=innerHeight+.5}; });
      fold.push(vp.width+' '+c[1]+' '+JSON.stringify(m)); if (m.id!==c[1]||m.hid.length||!m.vis||m.stage<m.col*.55) fold.push('NOK');
      if (vp.width===1280&&c[0]==='sel') await fp.screenshot({path:SH('12-provador-1280x720')});
      await fp.evaluate(()=>AMStudio.gallery.discard()); await sleep(150);
    }
    await fc.close();
  }
  check('S01-56: 1280×720 e 1366×768: a legenda, o Repetir, o “Quando usar” e o “Vai para” ficam à vista, acima de “Usar” e “Descartar”', fold.indexOf('NOK')<0, fold);

  /* ---------- 7. arquivo exportado: efeitos novos no player ---------- */
  await p.evaluate(()=>{ const S=AMStudio, d=S.newDeck(); d.title='Vitrine S01';
    const s1=S.mk.slide('blank-light'), s2=S.mk.slide('blank-light'), s3=S.mk.slide('blank-light'), s4=S.mk.slide('blank-light'), s5=S.mk.slide('blank-light');
    const card=(x,o)=>Object.assign(S.mk.shape('round'),{x,y:200,w:300,h:220,fill:'#002A46'},o);
    s1.els=[card(60,{id:'eIris',anim:{in:'iris',dur:900}}),card(380,{id:'eLand',anim:{in:'land',dur:900}}),card(700,{id:'ePop',anim:{in:'pop'}}),
      Object.assign(S.mk.text('title',{x:60,y:480,w:1100,h:100,html:'Crescer com disciplina de caixa'}),{id:'eWords',anim:{in:'words'}}),card(1000,{id:'eDiag',w:240,anim:{in:'diag'}}),card(1000,{id:'eWup',y:600,w:240,h:110,anim:{in:'wipeup',delay:1300,dur:500,loop:'beacon'}})];
    s2.tr='iris'; s2.els=[card(60,{id:'eBeacon',anim:{loop:'beacon'}}),card(380,{id:'eBeat',anim:{loop:'beat'}}),card(700,{id:'eFloat',anim:{loop:'float',hover:'zoom'}}),Object.assign(S.mk.line(true),{id:'eFlow',x1:100,y1:600,x2:1100,y2:600,anim:{loop:'flow'}}),
      Object.assign(S.mk.fx('counter'),{id:'eKpi',x:880,y:440,anim:{loop:'beacon'}})];
    s3.tr='navy'; s3.els=[card(60,{id:'eSpot',anim:{hover:'spot'}}),card(380,{id:'eB'}),card(700,{id:'eC'})];
    s4.tr='blur'; s4.els=[card(60,{id:'eRing',anim:{hover:'ring'}}),Object.assign(S.mk.text('title',{x:420,y:250,w:600,h:100,html:'Sublinhar'}),{id:'eUl',anim:{hover:'uline'}})];
    s5.tr='up'; d.slides=[s1,s2,s3,s4,s5]; S.loadDeck(d); });
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const xf=path.join(__dirname,'saved-s01.html'); fs.writeFileSync(xf,html);
  check('S01-38: export autônomo: am-deck-data, sem editor/vitrine/capa, sem on* (CR-04)', /id="am-deck-data"/.test(html)&&!/window\.AMStudio\s*=|gxProv|gx-box|AMCover/.test(html)&&!/onerror|onmouseover|onclick/.test(html)&&/amxIris/.test(html));
  const x=await open(ctx,'file://'+xf,'exp',400);
  const e1=await x.evaluate(()=>{ const q=id=>document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"]'); const an=id=>getComputedStyle(q(id)).animationName;
    const deckHtml=JSON.parse(document.getElementById('am-deck-data').textContent).slides[0].els.find(e=>e.id==='eWords').html;
    return {iris:an('eIris'), land:an('eLand'), pop:an('ePop'), diag:an('eDiag'), words:q('eWords').querySelectorAll('.amx-w').length, w0:getComputedStyle(q('eWords').querySelector('.amx-w')).animationName, deckHtml}; });
  await sleep(400); await x.screenshot({path:SH('09-export-entradas')});
  const cl0=await x.evaluate(()=>getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="eWup"]')).clipPath); await sleep(2000);
  const cl1=await x.evaluate(()=>{ const o={}; ['eIris','eDiag','eWup'].forEach(id=>o[id]=getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"]')).clipPath); return o; });
  check('S01-57: entradas com recorte (Íris, Diagonal, Revelar de baixo) escondem durante o atraso e soltam o recorte ao terminar (anéis e contornos não são cortados)', /^inset\(100%/.test(cl0)&&Object.values(cl1).every(v=>v==='none'), {cl0,cl1});
  check('S01-39: player exportado: entradas novas (Íris, Pouso 3D, Saltar, Diagonal, Palavra a palavra) com keyframes amx*', e1.iris==='amxIris'&&e1.land==='amxLand'&&e1.pop==='amxPop'&&e1.diag==='amxDiag'&&e1.words===5&&e1.w0==='amxWord'&&e1.deckHtml==='Crescer com disciplina de caixa', e1);
  await x.keyboard.press('ArrowRight'); await sleep(250);
  const e2=await x.evaluate(()=>{ const on=document.querySelector('.amp-slide.on'), f=id=>on.querySelector('.am-el[data-id="'+id+'"] .am-fxw');
    return {tr:getComputedStyle(on).animationName, beacon:getComputedStyle(f('eBeacon'),'::after').animationName, beat:getComputedStyle(f('eBeat')).animationName, flow:getComputedStyle(f('eFlow').querySelector('.am-ln')).animationName,
      kpi:{ring:getComputedStyle(f('eKpi'),'::after').animationName, r:parseFloat(getComputedStyle(f('eKpi')).borderTopLeftRadius), card:parseFloat(getComputedStyle(f('eKpi').firstElementChild).borderTopLeftRadius), after:getComputedStyle(f('eKpi'),'::after').borderTopLeftRadius}}; });
  check('S01-40: transição “Íris” no player e contínuos novos (Sinalizar, Batimento, Fluxo contínuo)', e2.tr==='ampxIris'&&e2.beacon==='amxRing'&&e2.beat==='amxBeat'&&e2.flow==='amxFlow', e2);
  check('S01-51: “Sinalizar” num componente arredondado (Contador KPI): os anéis seguem o canto do cartão', e2.kpi.ring==='amxRing'&&e2.kpi.r>4&&Math.abs(e2.kpi.r-e2.kpi.card)<.6&&parseFloat(e2.kpi.after)>4, e2.kpi);
  await sleep(900); const bx=await x.evaluate(()=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id="eFloat"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await x.mouse.move(bx.x,bx.y); await sleep(600);
  const fz=await x.evaluate(()=>{ const f=document.querySelector('.amp-slide.on .am-el[data-id="eFloat"] .am-fxw'), cs=getComputedStyle(f); return {t:cs.transform, a:cs.animationName}; });
  check('S01-41: contínuo + mouse somam (Flutuar continua e o Zoom do hover aplica: escala 1,06)', fz.a==='amFloat'&&/^matrix\(1\.06/.test(fz.t), fz);
  await x.mouse.move(5,5); await x.keyboard.press('ArrowRight'); await sleep(120);
  const nv=await x.evaluate(()=>{ const on=document.querySelector('.amp-slide.on'), cs=getComputedStyle(on); return {d:cs.transitionDelay, tr:on.dataset.tr}; });
  await sleep(900); const sp=await x.evaluate(()=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id="eSpot"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await x.mouse.move(sp.x,sp.y); await sleep(600);
  const so=await x.evaluate(()=>['eSpot','eB','eC'].map(id=>+getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="'+id+'"] .am-rot')).opacity));
  await x.screenshot({path:SH('10-export-holofote')});
  check('S01-42: “Passagem azul-marinho” espera o slide anterior sair; “Holofote” escurece os outros no player', nv.tr==='navy'&&/0\.38s/.test(nv.d)&&so[0]>.95&&so[1]<.5&&so[2]<.5, {nv,so});
  await x.mouse.move(5,5); await x.keyboard.press('ArrowRight'); await sleep(1000);
  const rg=await x.evaluate(()=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id="eRing"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await x.mouse.move(rg.x,rg.y); await sleep(500);
  const ring=await x.evaluate(()=>getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="eRing"] .am-fxw')).outlineColor);
  const ul=await x.evaluate(()=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id="eUl"]').getBoundingClientRect(); return {x:r.x+r.width/4,y:r.y+r.height/2}; });
  await x.mouse.move(ul.x,ul.y); await sleep(500);
  const uc=await x.evaluate(()=>getComputedStyle(document.querySelector('.amp-slide.on .am-el[data-id="eUl"] .am-tx')).textDecorationColor);
  check('S01-43: “Contorno em destaque” e “Sublinhar” acendem em laranja ao passar o mouse', ring==='rgb(247, 140, 22)'&&uc==='rgb(247, 140, 22)', {ring,uc});
  await x.close();
  /* movimento reduzido no export: íris e contínuos não animam */
  const rctx=await b.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  const r=await open(rctx,'file://'+xf+'#/2','rm',900);
  const rm=await r.evaluate(()=>{ const on=document.querySelector('.amp-slide.on'); return {tr:getComputedStyle(on).animationName, beat:getComputedStyle(on.querySelector('.am-el[data-id="eBeat"] .am-fxw')).animationName, ring:getComputedStyle(on.querySelector('.am-el[data-id="eBeacon"] .am-fxw'),'::after').animationName}; });
  check('S01-44: movimento reduzido: sem íris de transição e sem contínuos', rm.tr==='none'&&rm.beat==='none'&&rm.ring==='none', rm);
  await rctx.close();

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', results.length+' verificações', JSON.stringify({errs}));
  await b.close(); try{ fs.unlinkSync(xf); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
