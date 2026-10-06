/* S22 — Exportar: motor de imagem (AMExport.rasterSlide / rasterEls / fontsCSS), PDF direto (imagem 2× idêntica + texto invisível
   pesquisável), PDF pelo navegador (impressão vetorial) e o menu “Salvar como…” (▾ ao lado de Salvar) + Arquivo › Salvar como PDF…
   Pela interface real: ▾ → PDF → caixa → Exportar → download; pdfinfo / pdftoppm / pdftotext no arquivo baixado; slides ocultos,
   intervalo, slide atual, cancelar no meio, progresso, caixa a 390 px, Esc e foco, impressão via page.pdf, #bSave = .html, barra a 1280.
   Identidade de pixels: cada slide de um deck de cobertura é desenhado VISÍVEL na página (1280×720 CSS px, sem o editor em volta),
   fotografado pelo Playwright e comparado pixel a pixel (getImageData no navegador) com o canvas do rasterSlide.
   Chromium com --disable-lcd-text: o texto da tela sai em tons de cinza, como no canvas (o subpixel colorido do LCD não é geometria).
   Páginas do pdftoppm: o poppler desenha com deslocamento de fase de até 1 px; a comparação procura o melhor registro global em ±1 px.
   Uso: python3 assemble.py && node test-s22-pdf.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s22-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s22'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,1200):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'}; /* o Google Fonts responde com CORS aberto; o motor busca o CSS e os woff2 com fetch() */
async function fonts(p, offline){
  if(offline||!fs.existsSync(path.join(FONTS,'gf.css'))){ await p.route('https://fonts.googleapis.com/**',r=>r.abort()); await p.route('https://fonts.gstatic.com/**',r=>r.abort()); return; }
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag, offline){ const p=await ctx.newPage(); await fonts(p, offline);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const PHOTO='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'test-foto.png')).toString('base64');
const TITLE='Cobertura — Relatório ação';
/* deck de cobertura: texto com negrito/cor, formas giradas e espelhadas, linhas com setas, foto (cover + cantos + espelho), ícone,
   Linhas A&M, 3 gráficos com cores de série + cascata, SmartArt, 3 modelos (SWOT com “Cores do componente”), slide escuro com foto */
const BUILD=([PHOTO,TITLE])=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title=TITLE;
  const s1=mk.slide('blank-light'); s1.els=[];
  const t=mk.text('title'); Object.assign(t,{x:60,y:40,w:900,h:80}); t.html='Receita <b>cresce 18%</b> com <span style="color:#F78C16">margem</span> — ação, coração'; s1.els.push(t);
  const r=mk.shape('rect'); Object.assign(r,{x:60,y:180,w:220,h:140}); s1.els.push(r);
  const e2=mk.shape('ellipse'); Object.assign(e2,{x:320,y:180,w:200,h:140,rot:30}); s1.els.push(e2);
  const c=mk.shape('chevron'); Object.assign(c,{x:560,y:180,w:220,h:120,flipH:true}); s1.els.push(c);
  const ar=mk.shape('arrow'); Object.assign(ar,{x:820,y:180,w:240,h:120,rot:-20,flipV:true}); s1.els.push(ar);
  const l1=mk.line(); Object.assign(l1,{x1:80,y1:420,x2:500,y2:600,headEnd:'arrow',headStart:'dot'}); s1.els.push(l1);
  const l2=mk.line(); Object.assign(l2,{x1:600,y1:450,x2:1100,y2:450,headEnd:'arrow',dash:'dash',strokeW:4}); s1.els.push(l2);
  const bt=mk.text('body'); Object.assign(bt,{x:600,y:500,w:560,h:120}); bt.html='Texto corrido com acentuação: é, ê, õ, ç. Itálico <i>aqui</i>.'; s1.els.push(bt);
  const s2=mk.slide('blank-light'); s2.els=[];
  const im=mk.image(PHOTO,800,600); Object.assign(im,{x:60,y:60,w:520,h:380,radius:28,flipH:true,fit:'cover'}); s2.els.push(im);
  const ic=mk.fx('icon'); Object.assign(ic,{x:640,y:80}); s2.els.push(ic);
  const al=mk.fx('amlines'); Object.assign(al,{x:640,y:360}); s2.els.push(al);
  const s3=mk.slide('blank-light'); s3.els=[];
  const ch1=mk.fx('columns'); Object.assign(ch1,{x:20,y:40,w:400,h:300}); ch1.data.colors=['#1B7F3B','#C0392B']; s3.els.push(ch1);
  const ch2=mk.fx('donut'); Object.assign(ch2,{x:440,y:40,w:400,h:300}); ch2.data.colors=['#7B5BB3']; s3.els.push(ch2);
  const ch3=mk.fx('hbars'); Object.assign(ch3,{x:860,y:40,w:400,h:300}); ch3.data.colors=['#3B82C4','#D23F55']; s3.els.push(ch3);
  const ch4=mk.fx('waterfall'); Object.assign(ch4,{x:20,y:380,w:600,h:320}); s3.els.push(ch4);
  const s4=mk.slide('blank-light'); s4.els=[];
  const sa=mk.fx('smart'); Object.assign(sa,{x:20,y:20,w:600,h:330}); s4.els.push(sa);
  const sw=mk.fx('swot'); Object.assign(sw,{x:660,y:20,w:600,h:330}); sw.pal={p:'#1B7F3B',a:'#C0392B'}; s4.els.push(sw);
  const bc=mk.fx('bcg'); Object.assign(bc,{x:20,y:370,w:600,h:330}); s4.els.push(bc);
  const pd=mk.fx('pdca'); Object.assign(pd,{x:660,y:370,w:600,h:330}); s4.els.push(pd);
  const s5=mk.slide('blank-dark'); s5.els=[]; s5.bg='#002A46'; s5.bgImg=PHOTO; s5.bgImgOp=.35;
  const hd=mk.text('title'); Object.assign(hd,{x:60,y:60,w:900,h:90,color:'#FFFFFF'}); hd.html='Slide escuro com <b>foto de fundo</b>'; s5.els.push(hd);
  const cn=mk.fx('counter',null,true); Object.assign(cn,{x:80,y:260}); s5.els.push(cn);
  d.slides=[s1,s2,s3,s4,s5]; A.loadDeck(d,'Deck de cobertura'); };
/* comparação no navegador: decodifica dois PNG (data:) e conta pixels a ±24 por canal; reg = procura o melhor deslocamento global (±1 px) */
const CMP=async ([a,b,reg])=>{ const ld=s=>new Promise((r,j)=>{const im=new Image(); im.onload=()=>r(im); im.onerror=j; im.src=s;});
  const A=await ld(a), B=await ld(b); const W=1280,H=720;
  const g=im=>{const c=document.createElement('canvas'); c.width=W;c.height=H; const x=c.getContext('2d'); x.drawImage(im,0,0,W,H); return x.getImageData(0,0,W,H).data;};
  const da=g(A), db=g(B); let best=null;
  for(const dx of reg?[-1,0,1]:[0]) for(const dy of reg?[-1,0,1]:[0]){ let ok=0,sum=0,N=0;
    for(let y=Math.max(0,-dy);y<H-Math.max(0,dy);y++) for(let x=Math.max(0,-dx);x<W-Math.max(0,dx);x++){ const i=(y*W+x)*4, j=((y+dy)*W+(x+dx))*4;
      const r=Math.abs(da[i]-db[j]),gg=Math.abs(da[i+1]-db[j+1]),bb=Math.abs(da[i+2]-db[j+2]); if(Math.max(r,gg,bb)<=24) ok++; sum+=(r+gg+bb)/3; N++; }
    const m={match:+(ok/N*100).toFixed(2),mean:+(sum/N).toFixed(2),dx,dy}; if(!best||m.match>best.match) best=m; }
  return best; };
const SHOW=i=>{ let v=document.getElementById('cmpView'); if(v) v.remove(); v=document.createElement('div'); v.id='cmpView';
  v.style.cssText='position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;overflow:hidden';
  const st=AMRT.renderSlide(AMStudio.deck.slides[i],{play:false}); st.style.width='1280px'; st.style.height='720px'; v.appendChild(st); document.body.appendChild(v); };
const b64=buf=>'data:image/png;base64,'+buf.toString('base64');
const pdfinfo=f=>execFileSync('pdfinfo',[f],{encoding:'utf8'});
const pdftext=f=>execFileSync('pdftotext',['-enc','UTF-8',f,'-'],{encoding:'utf8'});
const pages=(f,tag)=>{ execFileSync('pdftoppm',['-r','96','-png',f,path.join(TMP,tag)]); return fs.readdirSync(TMP).filter(n=>n.startsWith(tag+'-')&&n.endsWith('.png')).sort().map(n=>fs.readFileSync(path.join(TMP,n))); };
const OK=m=>m&&m.match>=97&&m.mean<4;

(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  await p.evaluate(BUILD,[PHOTO,TITLE]); await sleep(900);
  const N=await p.evaluate(()=>AMStudio.deck.slides.length);
  const before=await p.evaluate(()=>JSON.stringify(AMStudio.deck));

  /* ---------- 1. identidade de pixels: tela × rasterSlide, slide a slide ---------- */
  const screens=[]; const per=[];
  for(let i=0;i<N;i++){
    await p.evaluate(SHOW,i); await sleep(350);
    const shot=await p.screenshot({clip:{x:0,y:0,width:1280,height:720}}); screens.push(shot); fs.writeFileSync(SH('tela-'+(i+1)),shot);
    await p.evaluate(()=>document.getElementById('cmpView').remove());
    const r=await p.evaluate(async i=>{ const t=performance.now(); const r=await AMExport.rasterSlide(AMStudio.deck.slides[i],{scale:1,type:'png'}); return {u:r.canvas.toDataURL('image/png'),w:r.width,h:r.height,ms:Math.round(performance.now()-t),texts:r.texts.length,type:r.blob.type}; },i);
    fs.writeFileSync(SH('canvas-'+(i+1)),Buffer.from(r.u.split(',')[1],'base64'));
    const m=await p.evaluate(CMP,[b64(shot),r.u,false]); per.push(m.match);
    check('S22-0'+(i+1)+': slide '+(i+1)+' — rasterSlide idêntico à tela (≥ 97 % dos pixels a ±24, média < 4)', OK(m)&&r.w===1280&&r.h===720&&r.type==='image/png', {match:m.match,mean:m.mean,ms:r.ms,texts:r.texts});
  }
  console.log('Identidade por slide (% de pixels a ±24):', per.join(' · '));
  /* escala 2: o mesmo slide em 2560×1440 */
  const s2=await p.evaluate(async()=>{ const r=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:2,type:'jpeg',quality:.9}); return {w:r.canvas.width,h:r.canvas.height,type:r.blob.type,kb:Math.round(r.blob.size/1024)}; });
  check('S22-06: rasterSlide escala 2 = 2560×1440 JPEG', s2.w===2560&&s2.h===1440&&s2.type==='image/jpeg', s2);

  /* ---------- 2. rasterEls: só os elementos, PNG transparente recortado ---------- */
  const re=await p.evaluate(async()=>{ const s=AMStudio.deck.slides[0], rect=s.els[1], ell=s.els[2];
    const a=await AMExport.rasterEls(s,[rect],{x:rect.x-10,y:rect.y-10,w:rect.w+20,h:rect.h+20},{scale:1});
    const x=a.canvas.getContext('2d'), corner=[...x.getImageData(3,3,1,1).data], mid=[...x.getImageData(Math.round(a.width/2),Math.round(a.height/2),1,1).data];
    const full=await AMExport.rasterSlide(s,{scale:1,type:'png'}), fm=[...full.canvas.getContext('2d').getImageData(rect.x+rect.w/2,rect.y+rect.h/2,1,1).data];
    const e=await AMExport.rasterEls(s,[ell.id],null,{scale:2}), bx=AMExport.boxOf([ell]), y=e.canvas.getContext('2d');
    const ec=[...y.getImageData(1,1,1,1).data], em=[...y.getImageData(Math.round(e.width/2),Math.round(e.height/2),1,1).data];
    return {w:a.width,h:a.height,type:a.blob.type,corner,mid,fm,ew:e.width,eh:e.height,bx,ec,em}; });
  check('S22-07: rasterEls — PNG do tamanho da caixa, transparente fora do elemento, mesma cor do slide dentro', re.w===240&&re.h===160&&re.type==='image/png'&&re.corner[3]===0&&re.mid[3]===255&&re.mid.slice(0,3).every((v,k)=>Math.abs(v-re.fm[k])<=2), re);
  check('S22-08: rasterEls sem caixa = caixa do desenho girado × escala (elipse a 30°)', re.ew===Math.round(re.bx.w*2)&&re.eh===Math.round(re.bx.h*2)&&re.ec[3]===0&&re.em[3]===255, {ew:re.ew,eh:re.eh,bx:re.bx,ec:re.ec,em:re.em});
  const fc=await p.evaluate(async()=>{ const c=await AMExport.fontsCSS(); return {n:(c.match(/@font-face/g)||[]).length,data:(c.match(/data:font\/woff2/g)||[]).length,inter:/font-family:'Inter'/.test(c),kb:Math.round(c.length/1024)}; });
  check('S22-09: fontsCSS — @font-face com woff2 embutido (data:), Inter incluída', fc.n>=4&&fc.data===fc.n&&fc.inter, fc);

  /* ---------- 3. menu “Salvar como…” e Arquivo ---------- */
  await p.setViewportSize({width:1280,height:720}); await sleep(400);
  const bar=await p.evaluate(()=>{ const t=document.getElementById('top'), r=document.getElementById('rib'), s=document.getElementById('bSave').getBoundingClientRect(), m=document.getElementById('bSaveMore').getBoundingClientRect();
    return {top:t.scrollWidth<=t.clientWidth, rib:r.scrollWidth<=r.clientWidth, save:s.left>=0&&s.right<=innerWidth, more:m.left>=s.right-1&&m.right<=innerWidth, gap:Math.round(m.left-s.right), mw:Math.round(m.width)}; });
  check('S22-10: barra do topo e faixa sem transbordar a 1280×720; Salvar + ▾ dentro da janela, colados', bar.top&&bar.rib&&bar.save&&bar.more&&Math.abs(bar.gap)<=1&&bar.mw>=24, bar);
  const aria=await p.evaluate(()=>{ const m=document.getElementById('bSaveMore'); return {t:m.title,h:m.getAttribute('aria-haspopup'),e:m.getAttribute('aria-expanded')}; });
  await p.click('#bSaveMore'); await sleep(300);
  const menu=await p.evaluate(()=>{ const m=document.querySelector('.xmenu.xsave'); if(!m) return null; const r=m.getBoundingClientRect(); return {items:[...m.querySelectorAll('.xi')].map(b=>({t:b.querySelector('.xl').textContent,dis:b.classList.contains('dis'),tip:b.title})),inView:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,exp:document.getElementById('bSaveMore').getAttribute('aria-expanded'),trunc:[...m.querySelectorAll('.xl')].some(x=>x.scrollWidth>x.clientWidth+1)}; });
  await p.screenshot({path:SH('menu-1280')});
  const want=['HTML interativo (.html) — com efeitos','PDF (.pdf) — imagem em alta resolução, idêntico','PDF pelo navegador — texto selecionável','PowerPoint (.pptx)…'];
  /* S23 entregou AMExport.pptx (ed-41-pptx.js): o item PowerPoint vem ativo; sem o gancho ele volta a ficar desativado com a dica (S22-33) */
  check('S22-11: ▾ abre “Salvar como”: HTML, PDF, PDF pelo navegador, PowerPoint (ativo desde a S23, com dica) — sem cortar rótulos', aria.t==='Salvar como… PDF, PowerPoint ou HTML'&&aria.h==='menu'&&aria.e==='false'&&menu&&menu.exp==='true'&&JSON.stringify(menu.items.map(i=>i.t))===JSON.stringify(want)&&!menu.items[3].dis&&menu.items[3].tip==='Gera um arquivo do PowerPoint com todos os slides'&&!menu.items[1].dis&&menu.inView&&!menu.trunc, {aria,menu});
  await p.keyboard.press('Escape'); await sleep(200);
  const closed=await p.evaluate(()=>!document.querySelector('.xmenu')&&document.getElementById('bSaveMore').getAttribute('aria-expanded')==='false');
  await p.click('#mbar [data-m=file]'); await sleep(250);
  const fm=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi')].map(b=>({t:b.querySelector('.xl').textContent,dis:b.classList.contains('dis'),tip:b.title})));
  await p.screenshot({path:SH('arquivo-1280')});
  await p.keyboard.press('Escape'); await sleep(150);
  const ab=fm.filter(i=>/abrir…/i.test(i.t)).length, pdfI=fm.find(i=>i.t==='Salvar como PDF…'), pptI=fm.find(i=>i.t==='Salvar como PowerPoint…');
  check('S22-12: Arquivo — 1º item Início (capa), um só “abrir…”, + Salvar como PDF… e Salvar como PowerPoint… (ativo desde a S23)', closed&&fm[0].t==='Início (capa)'&&ab===1&&pdfI&&!pdfI.dis&&pptI&&!pptI.dis, fm.map(i=>i.t));

  /* ---------- 4. PDF pela interface real: ▾ → PDF → caixa → Exportar → download ---------- */
  await p.evaluate(()=>{ window.__lt=[]; try{ new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(Math.round(e.duration)))).observe({entryTypes:['longtask']}); }catch(e){} });
  await p.click('#bSaveMore'); await sleep(250);
  await p.click('.xmenu.xsave .xi:has-text("PDF (.pdf)")'); await sleep(400);
  const dl0=await p.evaluate(()=>{ const d=document.getElementById('xpDlg'); return d&&!d.hidden?{t:document.getElementById('xpT').textContent,mode:d.dataset.mode,sum:document.getElementById('xpSum').textContent,est:document.getElementById('xpEst').textContent,all:document.getElementById('xpAllL').textContent,go:document.getElementById('xpGo').textContent,focus:d.contains(document.activeElement),prog:document.getElementById('xpProg').hidden,modal:document.getElementById('modal').classList.contains('open')}:null; });
  await p.screenshot({path:SH('caixa-1280')});
  check('S22-13: caixa “Salvar como PDF” (não é o #modal): resumo do formato, Todos (5 slides), estimativa, foco dentro', dl0&&dl0.t==='Salvar como PDF'&&dl0.mode==='pdf'&&/16:9/.test(dl0.sum)&&/sem os efeitos/.test(dl0.sum)&&dl0.all==='Todos (5 slides)'&&/5 páginas · tamanho estimado ≈ \d/.test(dl0.est)&&dl0.go==='Exportar PDF'&&dl0.focus&&dl0.prog&&!dl0.modal, dl0);
  const seen=new Set(); let watching=true;
  (async()=>{ while(watching){ try{ const t=await p.evaluate(()=>{ const x=document.getElementById('xpProg'); return x&&!x.hidden?document.getElementById('xpPl').textContent:''; }); if(t) seen.add(t); }catch(e){} await sleep(15); } })();
  const dlP=p.waitForEvent('download',{timeout:60000});
  await p.click('#xpGo');
  await sleep(120); await p.screenshot({path:SH('progresso-1280')});
  const dl=await dlP; watching=false; await sleep(300);
  const pdf1=path.join(TMP,'cobertura.pdf'); await dl.saveAs(pdf1);
  const after=await p.evaluate(()=>({open:AMExport.isOpen(),toast:document.getElementById('toast').textContent,last:AMExport.last,lt:window.__lt||[]}));
  check('S22-14: progresso “Gerando slide N de 5…” aparece durante a exportação', [...seen].some(t=>/^Gerando slide \d de 5…$/.test(t)), [...seen]);
  check('S22-15: download “cobertura-relatorio-acao.pdf”, caixa fecha, aviso com páginas e tamanho', dl.suggestedFilename()==='cobertura-relatorio-acao.pdf'&&!after.open&&/^PDF salvo: cobertura-relatorio-acao\.pdf · 5 páginas · /.test(after.toast), {name:dl.suggestedFilename(),after});
  const lmax=Math.max(0,...after.lt);
  check('S22-16: interface responde durante a exportação (maior tarefa longa < 400 ms)', lmax<400, {longtasks:after.lt,ms:after.last&&after.last.ms});
  const info=pdfinfo(pdf1);
  check('S22-17: pdfinfo — 5 páginas, 960 x 540 pts, título da apresentação', /Pages:\s+5\b/.test(info)&&/Page size:\s+960 x 540 pts/.test(info)&&info.includes('Title:           '+TITLE), info.split('\n').filter(l=>/Title|Pages|Page size|PDF version/.test(l)));
  const pg=pages(pdf1,'cob'); const pm=[];
  for(let i=0;i<pg.length&&i<N;i++) pm.push(await p.evaluate(CMP,[b64(screens[i]),b64(pg[i]),true]));
  fs.writeFileSync(SH('pdf-pagina-4'),pg[3]||Buffer.alloc(0));
  console.log('PDF × tela (pdftoppm -r 96):', pm.map(m=>m.match+'%/'+m.mean).join(' · '));
  check('S22-18: pdftoppm -r 96 — cada página = a tela (≥ 97 %, média < 4)', pg.length===N&&pm.every(OK), pm);
  const tx=pdftext(pdf1);
  check('S22-19: pdftotext — texto pesquisável com acentos certos (ação, coração, é, ê, õ, ç, travessão)', tx.includes('Receita cresce 18% com margem — ação,')&&tx.includes('coração')&&tx.includes('acentuação: é, ê, õ, ç.')&&tx.includes('Slide escuro com foto de fundo')&&tx.includes('Forças'), tx.slice(0,300));
  const now=await p.evaluate(()=>({j:JSON.stringify(AMStudio.deck),undo:document.getElementById('bUndo').disabled}));
  check('S22-20: exportar não mexe na apresentação (sem passo de desfazer)', now.j===before, now.undo);

  /* ---------- 5. slides ocultos: fora por padrão, dentro com “Incluir slides ocultos” (Arquivo › Salvar como PDF…) ---------- */
  await p.evaluate(()=>{ AMStudio.deck.slides[1].hidden=true; AMStudio.deck.slides[3].hidden=true; });
  async function viaFile(){ await p.click('#mbar [data-m=file]'); await sleep(200); await p.click('.xmenu .xi:has-text("Salvar como PDF…")'); await sleep(350); }
  async function exportNow(tag){ const P=p.waitForEvent('download',{timeout:60000}); await p.click('#xpGo'); const d=await P; const f=path.join(TMP,tag+'.pdf'); await d.saveAs(f); await sleep(200); return f; }
  await viaFile();
  const hl=await p.evaluate(()=>({all:document.getElementById('xpAllL').textContent,hid:document.getElementById('xpHidL').textContent,ck:document.getElementById('xpHid').checked,dis:document.getElementById('xpHid').disabled,est:document.getElementById('xpEst').textContent}));
  const fH=await exportNow('ocultos-fora'); const iH=pdfinfo(fH), tH=pdftext(fH);
  check('S22-21: ocultos fora por padrão — 3 páginas, sem o texto do slide oculto', hl.all==='Todos (3 slides)'&&hl.hid==='Incluir slides ocultos (2)'&&!hl.ck&&!hl.dis&&/^3 páginas/.test(hl.est)&&/Pages:\s+3\b/.test(iH)&&!tH.includes('Forças')&&tH.includes('Slide escuro'), {hl,pages:(iH.match(/Pages:\s+\d+/)||[])[0]});
  await viaFile(); await p.check('#xpHid'); await sleep(150);
  const hl2=await p.evaluate(()=>({all:document.getElementById('xpAllL').textContent,est:document.getElementById('xpEst').textContent}));
  const fI=await exportNow('ocultos-dentro'); const iI=pdfinfo(fI), tI=pdftext(fI);
  check('S22-22: “Incluir slides ocultos” — 5 páginas, texto do slide oculto presente', hl2.all==='Todos (5 slides)'&&/^5 páginas/.test(hl2.est)&&/Pages:\s+5\b/.test(iI)&&tI.includes('Forças'), {hl2,pages:(iI.match(/Pages:\s+\d+/)||[])[0]});
  await p.evaluate(()=>{ delete AMStudio.deck.slides[1].hidden; delete AMStudio.deck.slides[3].hidden; });

  /* ---------- 6. intervalo “De … a …” e “Slide atual” ---------- */
  await viaFile(); await p.fill('#xpFrom','3'); await p.fill('#xpTo','4'); await sleep(150);
  const rg=await p.evaluate(()=>({span:document.querySelector('input[name=xpRange][value=span]').checked,est:document.getElementById('xpEst').textContent}));
  const fR=await exportNow('intervalo'); const iR=pdfinfo(fR), tR=pdftext(fR);
  check('S22-23: intervalo De 3 a 4 — 2 páginas na ordem, só esses slides', rg.span&&/^2 páginas/.test(rg.est)&&/Pages:\s+2\b/.test(iR)&&!tR.includes('Receita cresce')&&tR.includes('Forças')&&!tR.includes('Slide escuro'), rg);
  await p.evaluate(()=>AMStudio.goSlide(4)); await sleep(300);
  await viaFile(); await p.check('input[name=xpRange][value=cur]'); await sleep(120);
  const cl=await p.evaluate(()=>document.getElementById('xpCurL').textContent);
  const fC=await exportNow('atual'); const iC=pdfinfo(fC), tC=pdftext(fC);
  check('S22-24: Slide atual (5) — 1 página, só ele', cl==='Slide atual (5)'&&/Pages:\s+1\b/.test(iC)&&tC.includes('Slide escuro')&&!tC.includes('Forças'), cl);

  /* ---------- 7. cancelar no meio: nenhum download, interface utilizável ---------- */
  await p.evaluate(()=>{ const d=AMStudio.deck; const more=[]; for(let k=0;k<2;k++) d.slides.forEach(s=>more.push(AMStudio.clone(s))); more.forEach(s=>{ s.id=AMStudio.uid(); d.slides.push(s); }); AMStudio.renderAll(); });
  const NN=await p.evaluate(()=>AMStudio.deck.slides.length);
  await viaFile(); await p.check('input[name=xpQ][value="3"]'); await sleep(100);
  let gotDl=false; const onDl=()=>{ gotDl=true; }; p.on('download',onDl);
  await p.click('#xpGo');
  await p.waitForFunction(n=>/^Gerando slide [2-9] de /.test(document.getElementById('xpPl').textContent)&&document.getElementById('xpPl').textContent.endsWith(' de '+n+'…'),NN,{timeout:30000});
  const busy=await p.evaluate(()=>({cancel:document.getElementById('xpCancel').textContent,go:document.getElementById('xpGo').disabled,inputs:[...document.querySelectorAll('#xpDlg .xp-b input')].every(i=>i.disabled)}));
  await p.click('#xpCancel'); await sleep(2500);
  p.off('download',onDl);
  const cs=await p.evaluate(()=>({open:AMExport.isOpen(),prog:document.getElementById('xpProg').hidden,go:document.getElementById('xpGo').disabled,toast:document.getElementById('toast').textContent,host:document.querySelectorAll('#amxHost .am-stage').length}));
  check('S22-25: Cancelar no meio — sem download, caixa volta ao normal, aviso “Exportação cancelada”', !gotDl&&busy.cancel==='Cancelar exportação'&&busy.go&&busy.inputs&&cs.open&&cs.prog&&!cs.go&&cs.toast==='Exportação cancelada'&&cs.host===0, {busy,cs});
  await p.keyboard.press('Escape'); await sleep(200);
  await p.click('#thumbs .th[data-i="1"] .box'); await sleep(250);
  const usable=await p.evaluate(()=>({open:AMExport.isOpen(),cur:AMStudio.cur}));
  check('S22-26: depois de cancelar, Esc fecha e o editor responde (miniatura 2 selecionada)', !usable.open&&usable.cur===1, usable);
  await p.evaluate(()=>{ AMStudio.deck.slides.splice(5); AMStudio.renderAll(); AMStudio.goSlide(0); });

  /* ---------- 8. teclado: ▾ por Enter, setas, Tab preso na caixa, teclas do editor não vazam, Esc devolve o foco ---------- */
  await p.evaluate(id=>AMStudio.select(id), await p.evaluate(()=>AMStudio.deck.slides[0].els[1].id)); await sleep(150);
  await p.focus('#bSaveMore'); await p.keyboard.press('Enter'); await sleep(250);
  const hot=await p.evaluate(()=>{ const h=document.querySelector('.xmenu.xsave .xi.hot .xl'); return h&&h.textContent; });
  await p.keyboard.press('ArrowDown'); await sleep(100); await p.keyboard.press('Enter'); await sleep(400);
  const k1=await p.evaluate(()=>({open:AMExport.isOpen(),inside:document.getElementById('xpDlg').contains(document.activeElement)}));
  const n0=await p.evaluate(()=>AMStudio.deck.slides[0].els.length);
  let trap=true; for(let k=0;k<14;k++){ await p.keyboard.press(k%5===4?'Shift+Tab':'Tab'); if(!(await p.evaluate(()=>document.getElementById('xpDlg').contains(document.activeElement)))) trap=false; }
  await p.keyboard.press('Delete'); await p.keyboard.press('Control+z'); await sleep(200);
  const n1=await p.evaluate(()=>AMStudio.deck.slides[0].els.length);
  await p.keyboard.press('Escape'); await sleep(250);
  const k2=await p.evaluate(()=>({open:AMExport.isOpen(),focus:document.activeElement&&document.activeElement.id}));
  check('S22-27: teclado — Enter no ▾ abre o menu, ↓ Enter abre a caixa, Tab fica preso, Delete/Ctrl+Z não vazam, Esc fecha e o foco volta ao ▾', /^HTML interativo/.test(hot||'')&&k1.open&&k1.inside&&trap&&n0===n1&&!k2.open&&k2.focus==='bSaveMore', {hot,k1,trap,n0,n1,k2});

  /* ---------- 9. caixa responsiva: 390 px, 1280 e 1440 ---------- */
  for(const [w,h] of [[390,800],[1440,900],[1280,720]]){
    await p.setViewportSize({width:w,height:h}); await sleep(300);
    await p.evaluate(()=>AMExport.openDialog('pdf')); await sleep(350);
    const g=await p.evaluate(()=>{ const bx=document.querySelector('#xpDlg .xp-box').getBoundingClientRect(), go=document.getElementById('xpGo').getBoundingClientRect(), bd=document.querySelector('#xpDlg .xp-b');
      return {l:Math.round(bx.left),r:Math.round(bx.right),t:Math.round(bx.top),b:Math.round(bx.bottom),go:go.right<=innerWidth&&go.bottom<=innerHeight&&go.width>40,hs:bd.scrollWidth<=bd.clientWidth,vw:innerWidth,vh:innerHeight}; });
    await p.screenshot({path:SH('caixa-'+w)});
    check('S22-28: caixa a '+w+'×'+h+' — inteira na janela, botão Exportar visível, sem rolagem lateral', g.l>=0&&g.r<=g.vw&&g.t>=0&&g.b<=g.vh&&g.go&&g.hs, g);
    await p.keyboard.press('Escape'); await sleep(150);
  }

  /* ---------- 10. PDF pelo navegador: modo impressão pela interface (window.print simulado) + page.pdf no estado preparado ---------- */
  await p.setViewportSize({width:1440,height:900}); await sleep(300);
  await p.evaluate(()=>{ window.__pr=null; window.print=()=>{ window.__pr={pages:document.querySelectorAll('#amPrint .amx-pg').length,cls:document.body.classList.contains('am-printing'),css:!!document.getElementById('am-print-css')}; }; });
  await p.click('#bSaveMore'); await sleep(250); await p.click('.xmenu.xsave .xi:has-text("PDF pelo navegador")'); await sleep(350);
  const pm0=await p.evaluate(()=>({t:document.getElementById('xpT').textContent,mode:document.getElementById('xpDlg').dataset.mode,q:document.querySelector('.xp-q').hidden,go:document.getElementById('xpGo').textContent,sum:document.getElementById('xpSum').textContent}));
  await p.screenshot({path:SH('caixa-impressao-1440')});
  await p.click('#xpGo'); await sleep(900);
  const pr=await p.evaluate(()=>({pr:window.__pr,left:!!document.getElementById('amPrint'),cls:document.body.classList.contains('am-printing'),open:AMExport.isOpen()}));
  check('S22-29: “PDF pelo navegador” — caixa no modo impressão, abre a impressão com 5 páginas e limpa depois', pm0.t==='PDF pelo navegador'&&pm0.mode==='print'&&pm0.q&&pm0.go==='Abrir impressão'&&/Salvar como PDF/.test(pm0.sum)&&pr.pr&&pr.pr.pages===5&&pr.pr.cls&&pr.pr.css&&!pr.left&&!pr.cls&&!pr.open, {pm0,pr});
  await p.evaluate(()=>{ window.__prep=AMExport.preparePrint(AMStudio.deck,{range:'all'}); });
  await p.evaluate(()=>document.fonts.ready); await sleep(400);
  const pdf2=path.join(TMP,'impressao.pdf'); await p.pdf({path:pdf2,preferCSSPageSize:true,printBackground:true});
  await p.evaluate(()=>window.__prep.cleanup());
  const i2=pdfinfo(pdf2), t2=pdftext(pdf2), pg2=pages(pdf2,'imp'); const pm2=[];
  for(let i=0;i<pg2.length&&i<N;i++) pm2.push(await p.evaluate(CMP,[b64(screens[i]),b64(pg2[i]),true]));
  fs.writeFileSync(SH('impressao-pagina-4'),pg2[3]||Buffer.alloc(0));
  console.log('Impressão × tela (pdftoppm -r 96):', pm2.map(m=>m.match+'%/'+m.mean).join(' · '));
  check('S22-30: impressão (page.pdf, tamanho do CSS) — 5 páginas 960 x 540 pts, texto selecionável', /Pages:\s+5\b/.test(i2)&&/Page size:\s+960 x 540 pts/.test(i2)&&t2.includes('acentuação')&&t2.includes('Forças'), i2.split('\n').filter(l=>/Pages|Page size/.test(l)));
  check('S22-31: impressão — cada página rasterizada = a tela (≥ 97 %, média < 4)', pg2.length===N&&pm2.every(OK), pm2);
  const gone=await p.evaluate(()=>!document.getElementById('amPrint')&&!document.getElementById('am-print-css')&&!document.body.classList.contains('am-printing'));
  check('S22-32: depois da impressão o editor volta ao normal (sem contêiner de impressão)', gone);

  /* ---------- 11. PowerPoint: o item chama AMExport.pptx quando a S23 existir ---------- */
  /* sem o gancho: desativado com a dica “Disponível na próxima etapa” */
  await p.evaluate(()=>{ window.__pptxReal=AMExport.pptx; delete AMExport.pptx; });
  await p.click('#bSaveMore'); await sleep(250);
  const pd=await p.evaluate(()=>{ const b=[...document.querySelectorAll('.xmenu.xsave .xi')].find(x=>/PowerPoint/.test(x.textContent)); return {dis:b.classList.contains('dis'),tip:b.title}; });
  await p.keyboard.press('Escape'); await sleep(150);
  await p.evaluate(()=>{ window.__pptx=null; AMExport.pptx=(d,o)=>{ window.__pptx={n:d.slides.length,op:o&&o.opener&&o.opener.id}; }; });
  await p.click('#bSaveMore'); await sleep(250);
  const pe=await p.evaluate(()=>{ const b=[...document.querySelectorAll('.xmenu.xsave .xi')].find(x=>/PowerPoint/.test(x.textContent)); return {dis:b.classList.contains('dis'),tip:b.title}; });
  await p.click('.xmenu.xsave .xi:has-text("PowerPoint")'); await sleep(200);
  const pc=await p.evaluate(()=>{ const r=window.__pptx; AMExport.pptx=window.__pptxReal; delete window.__pptxReal; return r; });
  check('S22-33: PowerPoint (.pptx)… desativado sem AMExport.pptx; ativo e chama AMExport.pptx(deck, {opener}) com ele', pd.dis&&pd.tip==='Disponível na próxima etapa'&&!pe.dis&&pc&&pc.n===5&&pc.op==='bSaveMore', {pd,pe,pc});

  /* ---------- 12. #bSave continua baixando o .html; o arquivo exportado não carrega o motor de PDF ---------- */
  const hP=p.waitForEvent('download',{timeout:15000}); await p.click('#bSave'); const hd=await hP; const hf=path.join(TMP,'salvo.html'); await hd.saveAs(hf);
  const html=fs.readFileSync(hf,'utf8');
  check('S22-34: clique em Salvar = download .html (como sempre), sem AMExport nem on* (CR-04)', hd.suggestedFilename()==='cobertura-relatorio-acao.html'&&/id="am-deck-data"/.test(html)&&!/AMExport|xpDlg|amPrint/.test(html)&&!/onerror|onmouseover|onclick/.test(html), hd.suggestedFilename());
  const q=await open(ctx,'file://'+hf,'exp');
  check('S22-35: arquivo salvo abre o player com os 5 slides', await q.evaluate(()=>document.querySelectorAll('.amp .amp-slide').length)===5);
  await q.close();
  /* reabrir o deck salvo e exportar de novo: mesmo número de páginas */
  const re2=await p.evaluate(async()=>{ AMStudio.loadDeck(JSON.parse(JSON.stringify(AMStudio.deck)),'reaberto'); const bl=await AMExport.pdf(AMStudio.deck,{scale:1}); const t=await bl.text(); return {n:(t.match(/\/Type \/Page\b/g)||[]).length,head:t.slice(0,8),eof:/%%EOF\n$/.test(t)}; });
  check('S22-36: salvar → reabrir → PDF de novo: 5 páginas, PDF-1.4 bem fechado', re2.n===5&&re2.head==='%PDF-1.4'&&re2.eof, re2);

  /* ---------- 13. sem internet: o motor avisa uma vez e continua idêntico à tela (fonte de reserva nos dois) ---------- */
  const ctx2=await b.newContext({viewport:{width:1440,height:900}});
  const o=await open(ctx2, FILE+'?nocover', 'off', true);
  await o.evaluate(BUILD,[PHOTO,TITLE]); await sleep(600);
  await o.evaluate(SHOW,0); await sleep(300); const offShot=await o.screenshot({clip:{x:0,y:0,width:1280,height:720}}); await o.evaluate(()=>document.getElementById('cmpView').remove());
  const off=await o.evaluate(async()=>{ const r=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1}); const t1=document.getElementById('toast').textContent; await AMExport.rasterSlide(AMStudio.deck.slides[2],{scale:1}); return {u:r.canvas.toDataURL('image/png'),t1}; });
  const om=await o.evaluate(CMP,[b64(offShot),off.u,false]);
  check('S22-37: sem acesso às fontes — aviso “Sem acesso às fontes da internet…” e resultado ainda igual à tela', off.t1==='Sem acesso às fontes da internet: o arquivo pode sair com outra fonte'&&OK(om), {t:off.t1,om});
  await ctx2.close();

  check('S22-38: zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close(); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
