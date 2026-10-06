/* S34 — Slides institucionais A&M (ed-45-institucional.js + inst/*.json): bloco “Institucional A&M” (5 slides) no seletor “Novo slide”,
   em Slide › Inserir bloco pronto ▸, em Inserir › Marca A&M ▸ e no painel do slide; layouts ocultos (o seletor continua com 13);
   S34b: botão “Institucional A&M” na barra (cabe de 1180 a 1600), item no menu de contexto da miniatura e no menu Slide, seção no topo do painel,
   tile destacado no seletor e o 6º projeto pronto da capa “Apresentação institucional A&M” (7 slides);
   fidelidade de cada slide contra a referência (inst/ref-*.png, ±40 por canal); textos editáveis; kit de marca não mexe; um Ctrl+Z;
   salvar/reabrir (imagem de fundo); PDF e PowerPoint Editável; importação: slides reconhecidos pelo título e troca pelos oficiais.
   Uso: python3 assemble.py && node test-s34-institucional.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s34-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s34'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
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
const ORDER=['cover','map','clients','spheres','chain'];
const MIN={cover:96.5, map:97.5, clients:98, spheres:93, chain:99};
const b64f=f=>fs.readFileSync(f).toString('base64');
/* compara o raster de um slide com a referência: % de pixels iguais a ±40 por canal */
async function fidelity(p, idx, refFile){ return p.evaluate(async ([i,ref])=>{ const rr=await AMExport.rasterSlide(AMStudio.deck.slides[i],{scale:1,type:'png'}); const c=rr.canvas, g=c.getContext('2d'); const img=g.getImageData(0,0,1280,720).data; const png=c.toDataURL('image/png'); c.width=0;
  const im=await new Promise(r=>{ const x=new Image(); x.onload=()=>r(x); x.src='data:image/png;base64,'+ref; }); const rc=document.createElement('canvas'); rc.width=1280; rc.height=720; const rg=rc.getContext('2d'); rg.drawImage(im,0,0,1280,720); const rd=rg.getImageData(0,0,1280,720).data;
  let same=0; const tot=1280*720; for(let k=0;k<tot*4;k+=4){ if(Math.abs(img[k]-rd[k])<=40&&Math.abs(img[k+1]-rd[k+1])<=40&&Math.abs(img[k+2]-rd[k+2])<=40) same++; } return {match:Math.round(same/tot*1000)/10, png}; }, [idx, b64f(refFile)]); }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const first=await p.evaluate(()=>{ const b=document.querySelector('#props [data-act="inst"]'); const r=b&&b.getBoundingClientRect(); return {btn:!!b, vis:!!r&&r.top>=0&&r.bottom<=innerHeight, bar:!document.getElementById('bInst').hidden}; });
  check('S34-28: no primeiro render (antes de qualquer clique) o painel já traz a seção “Slides institucionais A&M” com o botão à vista e a barra mostra o botão Institucional', first.btn && first.vis && first.bar, first);
  /* ---------- 1. registro ---------- */
  const reg=await p.evaluate(()=>{ const A=AMStudio; const L=A.LAYOUTS; const inst=Object.keys(L).filter(k=>/^inst-/.test(k)); return {inst, hidden:inst.every(k=>L[k].hidden===true&&L[k].inst), vis:Object.keys(L).filter(k=>!L[k].hidden).length, seq:A.SEQS[0], api:!!(window.AMInst&&AMInst.scan&&AMInst.replace), names:inst.map(k=>L[k].name)}; });
  check('S34-01: os 5 layouts institucionais existem, ocultos do seletor (13 visíveis), o bloco “Institucional A&M” é o primeiro dos blocos prontos e a API AMInst está presente', reg.inst.join()==='inst-cover,inst-map,inst-clients,inst-spheres,inst-chain' && reg.hidden && reg.vis===13 && reg.seq && reg.seq[0]==='inst' && reg.seq[2].length===5 && reg.seq[3]===true && reg.api, reg);
  /* ---------- 2. seletor “Novo slide”: 13 layouts + 1 tile de bloco, cabe na tela ---------- */
  await p.click('#addSlide'); await sleep(300);
  const pick=await p.evaluate(()=>{ const m=document.getElementById('mSlide'); const r=m.getBoundingClientRect(); const t=m.querySelector('button[data-seq="inst"]'); return {open:m.classList.contains('open'), lay:m.querySelectorAll('button[data-layout]').length, tile:t?t.textContent.trim():null, fits:r.bottom<=innerHeight&&r.right<=innerWidth&&r.top>=0}; });
  check('S34-02: o seletor mostra os 13 layouts e o tile “Inserir os 5 slides institucionais”, cabendo a 1280×720', pick.open && pick.lay===13 && pick.tile==='Inserir os 5 slides institucionais' && pick.fits, pick);
  await p.click('#mSlide button[data-seq="inst"]'); await sleep(500);
  let d=await D();
  check('S34-03: o tile insere os 5 slides depois do atual, na ordem capa, mapa, clientes, esferas, cadeia; atual = capa', d.slides.length===6 && d.slides.slice(1).map(s=>s.layout).join()===ORDER.map(k=>'inst-'+k).join() && await p.evaluate(()=>AMStudio.cur)===1, d.slides.map(s=>s.layout));
  /* ---------- 3. fidelidade de cada slide ---------- */
  for (let i=0;i<ORDER.length;i++){ const k=ORDER[i]; const f=await fidelity(p, i+1, path.join(__dirname,'inst','ref-'+k+'.png')); fs.writeFileSync(SH(k), Buffer.from(f.png.split(',')[1],'base64'));
    check('S34-'+k+': fidelidade do slide “'+k+'” ≥ '+MIN[k]+' % contra a referência', f.match>=MIN[k], {match:f.match}); }
  const st=await p.evaluate(()=>{ const S=AMStudio.deck.slides; const q=(i,t)=>S[i].els.filter(e=>e.type===t).length; return {coverTexts:q(1,'text'), coverLines:q(1,'line'), coverImgs:q(1,'image'), mapTexts:q(2,'text'), mapBg:!!S[2].bgImg, clientsTexts:q(3,'text'), clientsBg:!!S[3].bgImg, spheresTexts:q(4,'text'), spheresImgs:q(4,'image'), chainBg:!!S[5].bgImg, chainEls:S[5].els.length, inside:S.slice(1).every(s=>s.els.every(e=>{ const b=e.type==='line'?{x:Math.min(e.x1,e.x2),y:Math.min(e.y1,e.y2),w:Math.abs(e.x2-e.x1),h:Math.abs(e.y2-e.y1)}:e; return b.x>=-1&&b.y>=-1&&b.x+b.w<=1281&&b.y+b.h<=721; }))}; });
  check('S34-04: capa e esferas são nativos (textos + linhas + logos), mapa e clientes têm a arte como fundo e textos editáveis por cima, cadeia de valor é a arte oficial; tudo dentro do slide', st.coverTexts>=2 && st.coverLines>=3 && st.coverImgs>=1 && st.mapBg && st.mapTexts>=6 && st.clientsBg && st.clientsTexts>=1 && st.spheresTexts>=10 && st.spheresImgs>=2 && st.chainBg && st.chainEls===0 && st.inside, st);
  /* editar um texto da capa */
  const ed=await p.evaluate(()=>{ const A=AMStudio; A.goSlide(1); const t=A.deck.slides[1].els.filter(e=>e.type==='text').sort((a,b)=>b.size-a.size)[0]; const before=t.html; t.html='Somos a A&amp;M Performance Brasil'; A.renderAll(); A.commit(); const n=document.querySelector('#cv .am-el[data-id="'+t.id+'"]'); return {before, txt:n.textContent.trim(), base:!!A.deck.slides[1].base}; });
  check('S34-05: o título da capa é texto editável (muda no palco) e o slide tem base para Redefinir', /Somos a A&M Performance/.test(ed.before.replace(/&amp;/g,'&')) && ed.txt==='Somos a A&M Performance Brasil' && ed.base, ed);
  await p.evaluate(()=>{ AMStudio.resetSlide(1); });
  /* ---------- 4. um Ctrl+Z tira o bloco; kit de marca não mexe nos institucionais ---------- */
  await p.click('#wrap',{position:{x:5,y:5}}); await p.keyboard.press('Escape'); await sleep(100);
  await p.evaluate(()=>{ const A=AMStudio; A.loadDeck(A.newDeck(),null); A.brand.set({name:'Cliente',font:'Montserrat',pal:{p:'#1F8048'}}); A.insertSeq('inst'); });
  await sleep(400); d=await D();
  const fonts=d.slides.slice(1).flatMap(s=>s.els.filter(e=>e.type==='text').map(e=>e.font));
  check('S34-06: com kit de marca ativo, os slides institucionais entram no padrão oficial (Roboto/Roboto Condensed, nunca a fonte do kit)', d.slides.length===6 && fonts.length>0 && fonts.every(f=>/^Roboto/.test(f)), fonts.filter((v,i,a)=>a.indexOf(v)===i));
  await p.keyboard.press('Control+z'); await sleep(300); d=await D();
  check('S34-07: um Ctrl+Z tira o bloco inteiro', d.slides.length===1);
  /* ---------- 5. Marca A&M ▸ e painel do slide ---------- */
  await p.click('#mbar button[data-m=insert]'); await sleep(250); await p.hover('.xmenu .xi:has-text("Marca A&M")'); await sleep(350);
  const mi=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi')].map(x=>x.textContent.trim()).filter(t=>/institucionais/.test(t)));
  check('S34-08: Inserir › Marca A&M ▸ começa com “Inserir os 5 slides institucionais”', mi.length===1 && /Inserir os 5 slides institucionais/.test(mi[0]), mi);
  await p.evaluate(()=>{ [...document.querySelectorAll('.xmenu .xi')].find(x=>/Inserir os 5 slides institucionais/.test(x.textContent)).click(); }); await sleep(400); d=await D();
  check('S34-09: o item do menu insere o bloco (6 slides)', d.slides.length===6);
  await p.keyboard.press('Control+z'); await sleep(300);
  const pb=await p.evaluate(()=>{ AMStudio.selectMany([]); const b=document.querySelector('#props [data-act="inst"]'); return b?b.textContent.trim():null; });
  check('S34-10: o painel do slide tem o botão “Inserir os 5 slides institucionais”', pb==='Inserir os 5 slides institucionais', pb);
  await p.click('#props [data-act="inst"]'); await sleep(400); d=await D();
  check('S34-11: o botão do painel insere o bloco', d.slides.length===6);
  /* ---------- 6. salvar/reabrir, PDF, PowerPoint ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const re=await p.evaluate(dk=>{ AMStudio.loadDeck(dk,'re'); const S=AMStudio.deck.slides; return {n:S.length, bg:[S[2].bgImg,S[3].bgImg,S[5].bgImg].every(x=>/^data:image\/jpeg;base64,/.test(x||'')), lay:S.slice(1).map(s=>s.layout).join()}; }, dk);
  check('S34-12: salvar/reabrir mantém os 5 slides com as artes de fundo (jpeg embutido) e os layouts', re.n===6 && re.bg && re.lay===ORDER.map(k=>'inst-'+k).join(), re);
  const pdf=await p.evaluate(async()=>{ const b=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); return b.size; });
  const pk=path.join(TMP,'inst.pptx'); fs.writeFileSync(pk, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  check('S34-13: PDF e PowerPoint Editável (6 slides, válido) saem com o bloco', pdf>100000 && insp.zipBad===null && insp.xmlBad.length===0 && insp.slides.length===6, {pdf, n:insp.slides.length, bad:insp.xmlBad});
  /* ---------- 7. importação: reconhecer e trocar ---------- */
  const mk=path.join(TMP,'inst-src.pptx');
  execFileSync('python3',['-c',`
from pptx import Presentation
from pptx.util import Inches, Pt
prs=Presentation(); prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
def add(title, body=None):
    s=prs.slides.add_slide(prs.slide_layouts[5]); s.shapes.title.text=title
    if body: tb=s.shapes.add_textbox(Inches(1),Inches(3),Inches(10),Inches(2)); tb.text_frame.text=body
add('Somos a A&M Performance','O núcleo de excelência em performance da Alvarez & Marsal')
add('Agenda do dia','Abertura; Diagnóstico; Próximos passos')
add('Esferas de atuação da Alvarez & Marsal','Infra & Capital Projects · FASS · TAX · TAG')
add('Clientes de diferentes portes, perfis e segmentos da economia')
prs.save('${mk}')
`]);
  const rep=await p.evaluate(async ([b64,name])=>{ const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const res=await AMImport.pptx(u,{}); const rep=AMImport.finish(res,{name},{mode:'replace'}); return {inst:rep.inst, n:AMStudio.deck.slides.length}; }, [b64f(mk),'inst-src.pptx']);
  check('S34-14: importar um .pptx reconhece a capa, as esferas e os clientes institucionais (não a agenda)', rep.n===4 && rep.inst.map(o=>o.i+':'+o.key).join()==='0:cover,2:spheres,3:clients', rep);
  const sw=await p.evaluate(()=>{ const n=AMInst.replace(AMInst.scan(0, 4)); const S=AMStudio.deck.slides; return {n, lay:S.map(s=>s.layout||'-').join(), agenda:S[1].els.some(e=>/Agenda do dia/.test(e.html||''))}; });
  check('S34-15: “Usar os modelos oficiais” troca os 3 no lugar (a agenda fica)', sw.n===3 && sw.lay==='inst-cover,'+sw.lay.split(',')[1]+',inst-spheres,inst-clients' && !/^inst-/.test(sw.lay.split(',')[1]) && sw.agenda, sw);
  await p.click('#wrap',{position:{x:5,y:5}}); await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await sleep(300); d=await D();
  check('S34-16: um Ctrl+Z devolve os slides importados', d.slides.length===4 && !d.slides.some(s=>/^inst-/.test(s.layout||'')));
  const f2=await fidelity(p, 0, path.join(__dirname,'inst','ref-cover.png'));
  check('S34-17: o slide importado (capa) não é a oficial: fidelidade bem menor que a do modelo oficial', f2.match<MIN.cover, {match:f2.match});
  /* relatório da caixa de importação com o botão */
  await p.evaluate(()=>{ const A=AMStudio; A.loadDeck(A.newDeck(),null); });
  const fileIn=await p.evaluate(()=>{ AMImport.pick(); return !!document.getElementById('fImport'); });
  await (await p.$('#fImport')).setInputFiles(mk); await sleep(800);
  await p.click('#xmGo'); await sleep(2500);
  const ui=await p.evaluate(()=>{ const r=document.getElementById('xmRep'); const bx=r&&r.querySelector('.xm-inst'); return {hidden:r?r.hidden:true, txt:bx?bx.textContent.replace(/\s+/g,' ').trim().slice(0,160):null, btn:!!(bx&&bx.querySelector('[data-x="inst"]'))}; });
  check('S34-18: o relatório da importação mostra “3 slides institucionais reconhecidos” com o botão “Usar os modelos oficiais”', fileIn && !ui.hidden && /3 slides institucionais reconhecidos/.test(ui.txt||'') && ui.btn, ui);
  await p.click('#xmRep [data-x="inst"]'); await sleep(500);
  const ui2=await p.evaluate(()=>({t:document.querySelector('#xmRep [data-x="inst"]').textContent, dis:document.querySelector('#xmRep [data-x="inst"]').disabled, lay:AMStudio.deck.slides.map(s=>s.layout||'-')}));
  check('S34-19: o botão troca os 3 e fica desativado com a contagem', /3 slides trocados/.test(ui2.t) && ui2.dis && ui2.lay[0]==='inst-cover' && ui2.lay[2]==='inst-spheres' && ui2.lay[3]==='inst-clients', ui2);
  await p.keyboard.press('Escape'); await sleep(200);
  await p.evaluate(()=>AMStudio.goSlide(0)); await sleep(300); await p.screenshot({path:SH('editor')});
  /* ---------- 8. S34b: botão sempre à vista — barra, menu de contexto da miniatura, menu Slide, painel no topo, seletor destacado, projeto pronto ---------- */
  const q=await open(ctx, FILE+'?nocover', 'ed2'); const Q=()=>q.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  await q.setViewportSize({width:1440,height:900}); await sleep(300);
  const tb=await q.evaluate(()=>{ const b=document.getElementById('bInst'); const r=b.getBoundingClientRect(); const lbl=[...b.querySelectorAll('.lbl,.lbs')].find(x=>getComputedStyle(x).display!=='none'); return {hidden:b.hidden, vis:r.width>0&&r.right<=innerWidth, label:lbl?lbl.textContent:null, border:getComputedStyle(b).borderTopColor, before:AMStudio.deck.slides.length}; });
  await q.click('#bInst'); await sleep(500); let dq=await Q();
  check('S34-20: a barra de ferramentas tem o botão “Institucional” (laranja, rótulo curto a 1440) e um clique insere os 5 slides depois do atual', !tb.hidden && tb.vis && tb.label==='Institucional' && tb.border==='rgb(247, 140, 22)' && tb.before===1 && dq.slides.length===6 && dq.slides.slice(1).map(s=>s.layout).join()===ORDER.map(k=>'inst-'+k).join() && (await q.evaluate(()=>AMStudio.cur))===1, tb);
  await q.screenshot({path:SH('barra-1440')});
  const fit=[];
  for (const [w,h] of [[1180,720],[1280,720],[1366,768],[1600,900],[1700,900],[1920,1080]]) { await q.setViewportSize({width:w,height:h}); await sleep(250);
    fit.push(await q.evaluate(([w])=>{ const rib=document.getElementById('rib'), top=document.getElementById('top'), b=document.getElementById('bInst'), r=b.getBoundingClientRect(), s=document.getElementById('bSave').getBoundingClientRect(); const lb=[...b.querySelectorAll('.lbl,.lbs')].find(x=>getComputedStyle(x).display!=='none'); return {w, rib:rib.scrollWidth<=rib.clientWidth+1, top:top.scrollWidth<=top.clientWidth+1, btn:r.width>=30&&r.right<=innerWidth, save:s.right<=innerWidth, label:lb?lb.textContent:null}; },[w])); }
  check('S34-21: a barra cabe sem transbordar com o botão a 1180/1280/1366/1600/1700/1920 (só ícone até 1220, rótulo “Institucional” até 1640, “Institucional A&M” acima)', fit.every(f=>f.rib&&f.top&&f.btn&&f.save) && fit[0].label===null && fit.slice(1,4).every(f=>f.label==='Institucional') && fit.slice(4).every(f=>f.label==='Institucional A&M'), fit);
  await q.setViewportSize({width:1280,height:720}); await sleep(250);
  await q.evaluate(()=>{ AMStudio.loadDeck(AMStudio.newDeck(),null); }); await sleep(250);
  const th=await q.$('#thumbs .th'); const bb=await th.boundingBox(); await q.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2, {button:'right'}); await sleep(250);
  const cm=await q.evaluate(()=>[].map.call(document.querySelectorAll('.xmenu .xi'),x=>x.textContent.trim()));
  const ci=cm.findIndex(t=>/^Inserir slides institucionais A&M/.test(t));
  await q.screenshot({path:SH('menu-contexto')});
  await q.locator('.xmenu .xi',{hasText:'Inserir slides institucionais'}).first().click(); await sleep(500); dq=await Q();
  check('S34-22: o menu de contexto da miniatura tem “Inserir slides institucionais A&M” logo depois de “Novo slide depois”, e insere os 5', cm.filter(t=>/^Inserir slides institucionais/.test(t)).length===1 && ci>0 && /^Novo slide depois/.test(cm[ci-1]) && dq.slides.length===6 && dq.slides[1].layout==='inst-cover', cm);
  await q.click('#mbar button[data-m=slide]'); await sleep(250);
  const sm=await q.evaluate(()=>[].map.call(document.querySelectorAll('.xm .xi, .xmenu .xi'),x=>x.textContent.trim()));
  await q.keyboard.press('Escape'); await sleep(150);
  check('S34-23: o menu Slide tem um só “Inserir slides institucionais A&M” e continua com um só “Inserir bloco pronto”', sm.filter(t=>/^Inserir slides institucionais A&M/.test(t)).length===1 && sm.filter(t=>/^Inserir bloco pronto/.test(t)).length===1, sm);
  await q.click('#wrap',{position:{x:5,y:5}}); await q.keyboard.press('Escape'); await sleep(250);
  const pn=await q.evaluate(()=>{ const b=document.querySelector('[data-act="inst"]'); if(!b) return {missing:true}; let i=0, n=b.closest('.sec'); const sec=n; while((n=n.previousElementSibling)) if(n.classList.contains('sec')) i++; const r=b.getBoundingClientRect(); return {i, title:sec.querySelector('h3').textContent, vis:r.top>=0&&r.bottom<=innerHeight&&r.width>0, scrolled:(b.closest('aside,section,div[id]')||{}).scrollTop||0}; });
  check('S34-24: no painel do slide a seção “Slides institucionais A&M” fica logo abaixo de Exibição e layout (≤ 3ª seção), com o botão à vista sem rolar a 1280×720', !pn.missing && pn.i<=2 && /Slides institucionais/.test(pn.title) && pn.vis, pn);
  await q.click('#addSlide'); await sleep(300);
  const pk2=await q.evaluate(()=>{ const m=document.getElementById('mSlide'); const t=m.querySelector('button[data-seq="inst"]'); const hs=[...m.querySelectorAll('.mh')].map(h=>h.textContent.trim()); return {lay:m.querySelectorAll('button[data-layout]').length, hs, tile:t&&t.textContent.trim(), border:t&&getComputedStyle(t).borderTopColor}; });
  await q.screenshot({path:SH('seletor')}); await q.keyboard.press('Escape'); await q.click('#wrap',{position:{x:5,y:5}}); await sleep(150);
  check('S34-25: o seletor “Novo slide” continua com 13 layouts e destaca “Inserir os 5 slides institucionais” (laranja) sob “Slides institucionais A&M”', pk2.lay===13 && pk2.hs[1]==='Slides institucionais A&M' && pk2.tile==='Inserir os 5 slides institucionais' && pk2.border==='rgb(247, 140, 22)', pk2);
  await q.click('#bHome'); await sleep(900); await q.keyboard.press('2'); await sleep(800);
  const cv=await q.evaluate(()=>{ const cards=[...document.querySelectorAll('.cv-tcard')]; const c=cards[5]; const cover=document.getElementById('cover'); return {n:cards.length, name:c&&c.querySelector('.cv-tname').textContent, count:c&&c.querySelector('.cv-tn').textContent, stage:!!(c&&c.querySelector('.cv-pv .am-stage')), fits:cover.scrollHeight<=cover.clientHeight+1&&cover.scrollWidth<=cover.clientWidth}; });
  await q.screenshot({path:SH('capa-projetos')});
  await q.keyboard.press('6'); await sleep(500);
  if(await q.evaluate(()=>{ const c=document.getElementById('cvConfirm'); return !!c&&!c.hidden; })) { await q.click('#cvCfOk'); }
  await sleep(1200); dq=await Q();
  check('S34-26: Projetos prontos tem o 6º cartão “Apresentação institucional A&M” (07 slides, prévia viva, cabe a 1280×720); a tecla 6 carrega 7 slides: os 5 institucionais, conteúdo e encerramento', cv.n===6 && cv.name==='Apresentação institucional A&M' && cv.count==='07 slides' && cv.stage && cv.fits && dq.slides.length===7 && dq.slides.slice(0,5).map(s=>s.layout).join()===ORDER.map(k=>'inst-'+k).join() && !dq.slides[5].layout && dq.title==='Apresentação institucional A&M', {cv, n:dq.slides.length, title:dq.title});
  const f6=await fidelity(q, 0, path.join(__dirname,'inst','ref-cover.png'));
  check('S34-27: a capa do projeto pronto é a oficial (fidelidade ≥ '+MIN.cover+' %)', f6.match>=MIN.cover, {match:f6.match});
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
