/* S27b — recorte de imagem (el.crop, sem perder a foto original), níveis de lista (Tab / Shift+Tab dentro de listas) e
   Localizar e substituir (Ctrl+F / Editar › Localizar e substituir…: textos, formas e componentes de todos os slides).
   Verifica: controles de recorte no painel, render com .am-crop (fatia visível), “Ajustar à caixa” mantém a proporção, “Sem recorte”,
   Ctrl+Z; PowerPoint Editável grava srcRect do recorte; importação do PowerPoint guarda o recorte sem assar a foto; Tab aninha a lista
   (ul dentro de li), Shift+Tab volta, exportação marca lvl; Localizar: contagem, Próximo/Anterior navegam e selecionam, Substituir um,
   Substituir tudo preserva a marcação (negrito), componente (dados) também, diferenciar maiúsculas, Esc, um Ctrl+Z por substituição;
   invariantes. Uso: python3 assemble.py && node test-s27b-recorte.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s27b-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s27b'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS23=path.join(__dirname,'test-s23-tools.py'), TOOLS24=path.join(__dirname,'test-s24-tools.py');
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
const b64f=f=>fs.readFileSync(f).toString('base64');
async function blobToFile(p, expr, f){ const b64=await p.evaluate(async ex=>{ const b=await eval(ex); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }, expr); fs.writeFileSync(f, Buffer.from(b64,'base64')); }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const E=id=>p.evaluate(id=>JSON.parse(JSON.stringify(AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id))), id);
  const PHOTO='data:image/png;base64,'+b64f(path.join(__dirname,'test-foto.png'));
  /* ---------- 1. recorte ---------- */
  const iid=await p.evaluate(PHOTO=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Recorte'; const s=mk.slide('blank-light'); s.els=[]; const im=mk.image(PHOTO,800,600); Object.assign(im,{x:100,y:100,w:400,h:300}); s.els.push(im); d.slides=[s]; A.loadDeck(d,'c'); A.select(im.id); return im.id; }, PHOTO);
  await sleep(300);
  check('S27b-01: painel da imagem tem “Recortar”', await p.evaluate(()=>!!document.querySelector('#props [data-act=crop]')));
  await p.click('#props [data-act=crop]'); await sleep(200);
  const sl=await p.evaluate(()=>[].map.call(document.querySelectorAll('#props input[type=range][data-p^="crop."]'),x=>x.dataset.p));
  check('S27b-02: abre 4 controles (esquerda, topo, direita, base)', sl.join()==='crop.l,crop.t,crop.r,crop.b', sl);
  await p.evaluate(()=>{ const r=document.querySelector('#props input[data-p="crop.l"]'); r.value='0.25'; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); }); await sleep(250);
  let im=await E(iid);
  const rd=await p.evaluate(id=>{ const n=document.querySelector('#wrap .am-el[data-id="'+id+'"]'); const w=n.querySelector('.am-crop'), i=n.querySelector('img'); if(!w||!i) return null; const cs=getComputedStyle(w); return {ov:cs.overflow, left:i.style.left, width:i.style.width, fit:i.style.objectFit}; }, iid);
  check('S27b-03: crop.l = 0,25 → a foto mostra só a fatia (img com largura 133,33 % e left −33,33 % num quadro com overflow hidden)', im.crop && im.crop.l===0.25 && !!rd && rd.ov==='hidden' && /133\.3/.test(rd.width) && /-33\.3/.test(rd.left), {crop:im.crop, rd});
  const nat=await p.evaluate(id=>{ const i=document.querySelector('#wrap .am-el[data-id="'+id+'"] img'); return [i.naturalWidth,i.naturalHeight]; }, iid);
  await p.click('#props [data-act="crop-fit"]'); await sleep(250); im=await E(iid);
  const expH=Math.round(im.w/((nat[0]*.75)/nat[1]));
  check('S27b-04: “Ajustar à caixa” refaz a altura pela proporção da fatia (75 % da largura natural × altura natural)', Math.abs(im.h-expH)<=1, {nat, w:im.w, h:im.h, expH});
  await p.screenshot({path:SH('crop')});
  const pk=path.join(TMP,'crop.pptx'); await blobToFile(p,'AMExport.pptxBuild(AMStudio.deck,{range:"all",mode:"edit"})',pk);
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  const pic=insp.slides[0].shapes.find(s=>s.tag==='pic');
  check('S27b-05: PowerPoint Editável grava o recorte como srcRect (l = 25000) com a foto inteira', !!pic && pic.crop && +pic.crop.l===25000 && pic.px && pic.px[0]===800, pic&&{crop:pic.crop,px:pic.px});
  await p.click('#props [data-act="crop-none"]'); await sleep(250); im=await E(iid);
  check('S27b-06: “Sem recorte” tira o crop; o render volta ao <img> simples', !im.crop && await p.evaluate(id=>!document.querySelector('#wrap .am-el[data-id="'+id+'"] .am-crop'), iid));
  await p.keyboard.press('Control+z'); await sleep(250); im=await E(iid);
  check('S27b-07: Ctrl+Z devolve o recorte', !!im.crop && im.crop.l===0.25);
  /* importação: foto recortada vem com crop (sem assar) */
  const FX=path.join(TMP,'fx'); execFileSync('python3',[TOOLS24,'make',FX]);
  const rep=await p.evaluate(async ([b64,name])=>{ const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const res=await AMImport.pptx(u,{}); return AMImport.finish(res,{name},{mode:'replace'}); }, [b64f(path.join(FX,'fx-a.pptx')),'fx-a.pptx']);
  const imp=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els.find(e=>e.type==='image'); return e?{crop:e.crop, w:e.w}:null; });
  const nw=await p.evaluate(()=>new Promise(r=>{ const e=AMStudio.deck.slides[0].els.find(e=>e.type==='image'); const i=new Image(); i.onload=()=>r(i.naturalWidth); i.src=e.src; }));
  check('S27b-08: PowerPoint importado: a foto com recorte à esquerda (25 %) vem inteira (400 px) com el.crop.l = 0,25', !!imp && imp.crop && Math.abs(imp.crop.l-0.25)<.001 && nw===400 && rep.count.images===1, {imp,nw});
  /* ---------- 2. níveis de lista ---------- */
  const tid=await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Listas'; const s=mk.slide('blank-light'); s.els=[]; const t=mk.text('body'); Object.assign(t,{x:100,y:100,w:600,h:200}); t.html='<ul><li>Primeiro</li><li>Segundo</li><li>Terceiro</li></ul>'; s.els.push(t); d.slides=[s]; A.loadDeck(d,'l'); return t.id; });
  await sleep(300); await p.evaluate(id=>AMStudio.select(id), tid); await p.keyboard.press('Enter'); await sleep(250);
  /* cursor no “Segundo”: fim do texto, sobe uma linha */
  await p.keyboard.press('Control+End'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('End'); await p.keyboard.press('Tab'); await sleep(150);
  const lv1=await p.evaluate(id=>document.querySelector('#wrap .am-el[data-id="'+id+'"] .am-tx').innerHTML, tid);
  check('S27b-09: Tab no item aninha “Segundo” (ul dentro do ul) sem sair da edição', /<ul>[\s\S]*<ul>[\s\S]*Segundo/.test(lv1) && await p.evaluate(()=>!!document.querySelector('.am-el.editing')), lv1);
  await p.keyboard.press('Shift+Tab'); await sleep(150);
  const lv0=await p.evaluate(id=>document.querySelector('#wrap .am-el[data-id="'+id+'"] .am-tx').innerHTML, tid);
  check('S27b-10: Shift+Tab volta ao nível 1', !/<ul>[\s\S]*<ul>/.test(lv0) && (lv0.match(/<li>/g)||[]).length===3, lv0);
  await p.keyboard.press('Tab'); await sleep(100); await p.keyboard.press('Escape'); await sleep(250);
  const hh=await E(tid);
  check('S27b-11: ao sair, o HTML guarda a lista aninhada', /<ul>[\s\S]*<ul>[\s\S]*Segundo/.test(hh.html), hh.html);
  const pk2=path.join(TMP,'lista.pptx'); await blobToFile(p,'AMExport.pptxBuild(AMStudio.deck,{range:"all",mode:"edit"})',pk2);
  const lvl=execFileSync('python3',['-c',"import zipfile,re,sys; z=zipfile.ZipFile(sys.argv[1]); x=z.read('ppt/slides/slide1.xml').decode(); print(len(re.findall(r'lvl=\"1\"',x)), len(re.findall(r'<a:buChar',x)))",pk2],{encoding:'utf8'}).trim();
  check('S27b-12: PowerPoint Editável marca o item aninhado com lvl=\"1\" (3 marcadores)', lvl==='1 3', lvl);
  /* ---------- 3. localizar e substituir ---------- */
  await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Busca';
    const s1=mk.slide('blank-light'); s1.els=[]; const a=mk.text('title'); Object.assign(a,{x:60,y:40,w:800,h:80}); a.html='<b>Receita</b> cresce'; s1.els.push(a); const c=mk.shape('rect'); Object.assign(c,{x:60,y:200,w:300,h:120}); c.html='receita líquida'; s1.els.push(c);
    const s2=mk.slide('blank-light'); s2.els=[]; const t=mk.text('body'); Object.assign(t,{x:60,y:40,w:800,h:80}); t.html='Sem nada aqui'; s2.els.push(t);
    const s3=mk.slide('blank-light'); s3.els=[]; const k=mk.fx('columns'); k.data.title='Receita por canal'; s3.els.push(k); const u=mk.text('body'); Object.assign(u,{x:60,y:500,w:800,h:60}); u.html='A RECEITA sobe'; s3.els.push(u);
    d.slides=[s1,s2,s3]; A.loadDeck(d,'b'); });
  await sleep(300); await p.click('#wrap', {position:{x:5,y:5}}); await p.keyboard.press('Escape');
  await p.keyboard.press('Control+f'); await sleep(300);
  const dl=await p.evaluate(()=>{ const d=document.getElementById('xfDlg'); return d&&!d.hidden?{focus:document.activeElement&&document.activeElement.id}:null; });
  check('S27b-13: Ctrl+F abre “Localizar e substituir” com o foco no campo', !!dl && dl.focus==='xfQ', dl);
  await p.fill('#xfQ','receita'); await sleep(300);
  const cnt=await p.evaluate(()=>document.getElementById('xfCount').textContent);
  check('S27b-14: contagem: 4 ocorrências em 2 slides (texto, forma, componente, texto em CAIXA ALTA)', /4 ocorrências em 2 slides/.test(cnt), cnt);
  await p.click('#xfNext'); await sleep(300);
  const m1=await p.evaluate(()=>({cur:AMStudio.cur, sel:AMStudio.selected(), label:document.getElementById('xfCount').textContent}));
  check('S27b-15: Próximo vai à 1ª ocorrência (slide 1, texto selecionado) e mostra “1 de 4”', m1.cur===0 && m1.sel.length===1 && /1 de 4/.test(m1.label), m1);
  await p.click('#xfNext'); await p.click('#xfNext'); await sleep(300);
  const m3=await p.evaluate(()=>({cur:AMStudio.cur, label:document.getElementById('xfCount').textContent}));
  check('S27b-16: 3ª ocorrência está no slide 3 (componente)', m3.cur===2 && /3 de 4/.test(m3.label), m3);
  await p.click('#xfPrev'); await sleep(250);
  check('S27b-17: Anterior volta ao slide 1', await p.evaluate(()=>AMStudio.cur)===0);
  await p.fill('#xfR','Faturamento'); await p.click('#xfRep'); await sleep(300);
  const h1=await p.evaluate(()=>AMStudio.deck.slides[0].els[1].html);
  check('S27b-18: Substituir troca só a ocorrência atual (forma), mantendo o caso do texto ao redor', h1==='Faturamento líquida' && /Receita/.test(await p.evaluate(()=>AMStudio.deck.slides[0].els[0].html)) && /3 ocorrências/.test(await p.evaluate(()=>document.getElementById('xfCount').textContent)), h1);
  await p.click('#xfAll'); await sleep(400);
  const after=await p.evaluate(()=>({a:AMStudio.deck.slides[0].els[0].html, k:AMStudio.deck.slides[2].els[0].data.title, u:AMStudio.deck.slides[2].els[1].html, cnt:document.getElementById('xfCount').textContent}));
  check('S27b-19: Substituir tudo: negrito preservado (<b>Faturamento</b>), componente trocado, CAIXA ALTA trocada; contagem 0', after.a==='<b>Faturamento</b> cresce' && after.k==='Faturamento por canal' && after.u==='A Faturamento sobe' && /0 ocorrências|Nenhuma/.test(after.cnt), after);
  await p.keyboard.press('Escape'); await sleep(200);
  check('S27b-20: Esc fecha a caixa', await p.evaluate(()=>document.getElementById('xfDlg').hidden));
  await p.keyboard.press('Control+z'); await sleep(250);
  check('S27b-21: um Ctrl+Z desfaz o “Substituir tudo” inteiro', await p.evaluate(()=>/Receita/.test(AMStudio.deck.slides[0].els[0].html) && /Receita/.test(AMStudio.deck.slides[2].els[0].data.title)));
  await p.keyboard.press('Control+f'); await sleep(200); await p.fill('#xfQ','RECEITA'); await p.click('#xfCase'); await sleep(300);
  check('S27b-22: “Diferenciar maiúsculas”: só 1 ocorrência (RECEITA)', /1 ocorrência em 1 slide/.test(await p.evaluate(()=>document.getElementById('xfCount').textContent)));
  await p.keyboard.press('Escape'); await sleep(150);
  await p.click('#mbar button[data-m=edit]'); await sleep(250);
  const it=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xm .xi, .xmenu .xi'),x=>x.textContent.trim()));
  check('S27b-23: Editar tem um só “Localizar e substituir…”', it.filter(t=>/^Localizar e substituir/.test(t)).length===1, it);
  await p.keyboard.press('Escape');
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
