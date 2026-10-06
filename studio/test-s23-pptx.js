/* S23 — Salvar como PowerPoint (.pptx): ed-41-pptx.js (AMExport.pptx / pptxBuild / zip) sobre o motor do S22.
   Pela interface real: ▾ (#bSaveMore) → “PowerPoint (.pptx)…” → caixa #xkDlg → modo (Idêntico | Editável) → Exportar → download.
   Cada arquivo baixado passa por: python-pptx (slides, tamanho 16:9, ocultos, anotações, tipos de forma, textos e formatos),
   `python3 -m zipfile -t`, `unzip -t`, XML bem formado em todas as partes (xml.etree), relações e tipos de conteúdo;
   LibreOffice Impress (`soffice --convert-to pdf`, com os slides ocultos) + `pdftoppm -r 192` → cada página comparada com o slide
   desenhado pelo editor a 2× (Idêntico: ≥ 97 % dos pixels a ±24 e média < 4; Editável: ≥ 90 % a ±40).
   Fontes: test-s23-tools.py fonts gera TTFs estáticos (Inter, Roboto, Roboto Light, Roboto Condensed, JetBrains Mono) a partir de
   ../fonts2 e um fonts.conf só para o soffice = “as fontes estão instaladas no computador de quem abre” (precisa de fontTools).
   Precisa de: playwright, python3 + python-pptx, soffice com o Impress (apt: libreoffice-impress), pdftoppm, unzip.
   Uso: python3 assemble.py && node test-s23-pptx.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const zlib=require('zlib'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s23-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s23'); fs.rmSync(path.join(TMP,'out'),{recursive:true,force:true}); fs.mkdirSync(path.join(TMP,'out'),{recursive:true});
const OUT=path.join(TMP,'out');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,1500):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){
  if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const PHOTO='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'test-foto.png')).toString('base64');
const TITLE='Cobertura PowerPoint — ação & coração', SLUG='cobertura-powerpoint-acao-coracao';

/* deck de cobertura: textos com formatação mista e acentos, formas (giradas, espelhadas, com texto, sem equivalente), linhas com
   pontas e rotas, fotos (preencher arredondada espelhada, inteira girada com sombra, transparente), ícone, Linhas A&M, gráficos com
   cores próprias, SWOT com “Cores do componente”, SmartArt, slide escuro com foto de fundo + contador, slide oculto, anotações */
const BUILD=([PHOTO,TITLE])=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title=TITLE;
  const s1=mk.slide('blank-light'); s1.els=[]; s1.notes='Abertura: falar da receita.\nSegunda linha das anotações — ação.';
  const t=mk.text('title'); Object.assign(t,{x:60,y:40,w:900,h:80}); t.html='Receita <b>cresce 18%</b> com <span style="color:#F78C16">margem</span> — ação, coração'; s1.els.push(t);
  const bt=mk.text('body'); Object.assign(bt,{x:60,y:150,w:520,h:200}); bt.html='Primeiro parágrafo com <i>itálico</i>, <u>sublinhado</u> e <b>negrito</b>.<div>Segundo parágrafo: é, ê, õ, ç, ü — “aspas”.</div><div><br></div><div>Depois de uma linha vazia.</div>'; s1.els.push(bt);
  const eb=mk.text('eyebrow'); Object.assign(eb,{x:640,y:160,w:560}); eb.html='RÓTULO · SEÇÃO 01'; s1.els.push(eb);
  const ct=mk.text('subtitle'); Object.assign(ct,{x:640,y:200,w:560,h:60,align:'center'}); ct.html='Centralizado em duas linhas<br>segunda linha'; s1.els.push(ct);
  const bx=mk.text('body'); Object.assign(bx,{x:640,y:290,w:560,h:120,bg:'#EEF2F7',radius:12,valign:'middle',rot:-4}); bx.html='Caixa com fundo, girada e centrada na vertical.'; s1.els.push(bx);
  const bl=mk.text('bullets'); Object.assign(bl,{x:60,y:420,w:520,h:150}); s1.els.push(bl);
  const nm=mk.text('number'); Object.assign(nm,{x:660,y:440}); s1.els.push(nm);
  const s2=mk.slide('blank-light'); s2.els=[];
  const r=mk.shape('rect'); Object.assign(r,{x:40,y:40,w:220,h:140,html:'Retângulo'}); s2.els.push(r);
  const rr=mk.shape('round'); Object.assign(rr,{x:300,y:40,w:240,h:140,html:'Arredondado com texto longo que quebra',strokeW:3,stroke:'#F78C16',dash:true}); s2.els.push(rr);
  const e2=mk.shape('ellipse'); Object.assign(e2,{x:580,y:30,w:200,h:160,rot:30,html:'Elipse'}); s2.els.push(e2);
  const c=mk.shape('chevron'); Object.assign(c,{x:820,y:40,w:220,h:120,flipH:true}); s2.els.push(c);
  const ar=mk.shape('arrow'); Object.assign(ar,{x:1060,y:40,w:200,h:120,rot:-20,flipV:true}); s2.els.push(ar);
  const st=mk.shape('star'); Object.assign(st,{x:40,y:230,w:180,h:180,html:'5'}); s2.els.push(st);
  const tr=mk.shape('triangle'); Object.assign(tr,{x:260,y:230,w:180,h:180,html:'Tri'}); s2.els.push(tr);
  const dm=mk.shape('diamond'); Object.assign(dm,{x:480,y:230,w:180,h:180,shadow:true,html:'Losango'}); s2.els.push(dm);
  const pg=mk.shape('pentagon'); Object.assign(pg,{x:700,y:250,w:260,h:120,html:'Etapa 1'}); s2.els.push(pg);
  const co=mk.shape('callout'); Object.assign(co,{x:1000,y:230,w:260,h:160,html:'Balão de fala'}); s2.els.push(co);
  const cd=mk.shape('round'); Object.assign(cd,{x:40,y:460,w:300,h:200,html:'<b>Card cabeçalho</b><div>corpo do card</div>'}); cd.look='header'; cd.fill='#FFFFFF'; cd.strokeW=1.5; cd.stroke='#DCE5F0'; cd.color='#FFFFFF'; cd.valign='top'; s2.els.push(cd);
  const cy=mk.shape('cylinder'); Object.assign(cy,{x:380,y:460,w:160,h:200}); s2.els.push(cy);
  const pl=mk.shape('pill'); Object.assign(pl,{x:580,y:500,w:300,h:90,html:'Pílula',fill:'#F78C16',color:'#002A46'}); s2.els.push(pl);
  const hx=mk.shape('hexagon'); Object.assign(hx,{x:920,y:460,w:220,h:180,html:'Hexágono',opacity:.6}); s2.els.push(hx);
  const s3=mk.slide('blank-light'); s3.els=[];
  const l1=mk.line(); Object.assign(l1,{x1:80,y1:100,x2:500,y2:260,headEnd:true,headE:'arrow',headStart:true,headS:'dot'}); s3.els.push(l1);
  const l2=mk.line(); Object.assign(l2,{x1:600,y1:120,x2:1100,y2:120,headEnd:true,dash:true,strokeW:4}); s3.els.push(l2);
  const l3=mk.line(); Object.assign(l3,{x1:620,y1:200,x2:900,y2:420,curve:'elbow',headEnd:true,stroke:'#F78C16'}); s3.els.push(l3);
  const l4=mk.line(); Object.assign(l4,{x1:950,y1:200,x2:1200,y2:420,curve:'curve',headEnd:true,headE:'open'}); s3.els.push(l4);
  const l5=mk.line(); Object.assign(l5,{x1:80,y1:400,x2:520,y2:330,curve:'elbow',headEnd:true,headE:'diamond',dash:true,dashS:'dot',bend:.3}); s3.els.push(l5);
  const l6=mk.line(); Object.assign(l6,{x1:500,y1:620,x2:80,y2:520,headEnd:true,headE:'bar',headStart:true,headS:'bar'}); s3.els.push(l6);
  const l7=mk.line(); Object.assign(l7,{x1:700,y1:640,x2:640,y2:460,curve:'curve',headEnd:true,strokeW:2}); s3.els.push(l7);
  const s4=mk.slide('blank-light'); s4.els=[];
  const im=mk.image(PHOTO,800,600); Object.assign(im,{x:60,y:60,w:520,h:380,radius:28,flipH:true,fit:'cover'}); s4.els.push(im);
  const im2=mk.image(PHOTO,800,600); Object.assign(im2,{x:640,y:60,w:300,h:300,fit:'contain',rot:12,shadow:true}); s4.els.push(im2);
  const im3=mk.image(PHOTO,800,600); Object.assign(im3,{x:980,y:60,w:240,h:380,fit:'cover',opacity:.7}); s4.els.push(im3);
  const ic=mk.fx('icon'); Object.assign(ic,{x:640,y:460,rot:15}); s4.els.push(ic);
  const al=mk.fx('amlines'); Object.assign(al,{x:60,y:500}); s4.els.push(al);
  const s5=mk.slide('blank-light'); s5.els=[];
  const ch1=mk.fx('columns'); Object.assign(ch1,{x:20,y:40,w:400,h:300}); ch1.data.colors=['#1B7F3B','#C0392B']; s5.els.push(ch1);
  const ch2=mk.fx('donut'); Object.assign(ch2,{x:440,y:40,w:400,h:300}); ch2.data.colors=['#7B5BB3']; s5.els.push(ch2);
  const ch3=mk.fx('hbars'); Object.assign(ch3,{x:860,y:40,w:400,h:300}); ch3.data.colors=['#3B82C4','#D23F55']; s5.els.push(ch3);
  const sw=mk.fx('swot'); Object.assign(sw,{x:20,y:370,w:600,h:330}); sw.pal={p:'#1B7F3B',a:'#C0392B'}; s5.els.push(sw);
  const sa=mk.fx('smart'); Object.assign(sa,{x:660,y:370,w:600,h:330}); s5.els.push(sa);
  const s6=mk.slide('blank-dark'); s6.els=[]; s6.bg='#002A46'; s6.bgImg=PHOTO; s6.bgImgOp=.35; s6.notes='Slide escuro: foto de fundo a 35 %.';
  const hd=mk.text('title'); Object.assign(hd,{x:60,y:60,w:900,h:90,color:'#FFFFFF'}); hd.html='Slide escuro com <b>foto de fundo</b>'; s6.els.push(hd);
  const cn=mk.fx('counter',null,true); Object.assign(cn,{x:80,y:260}); s6.els.push(cn);
  const s7=mk.slide('blank-light'); s7.els=[]; s7.hidden=true; s7.notes='Slide oculto.';
  const hh=mk.text('title'); Object.assign(hh,{x:60,y:60}); hh.html='Slide oculto'; s7.els.push(hh);
  d.slides=[s1,s2,s3,s4,s5,s6,s7]; A.loadDeck(d,'Deck de cobertura'); };
const SHOW=i=>{ let v=document.getElementById('cmpView'); if(v) v.remove(); v=document.createElement('div'); v.id='cmpView';
  v.style.cssText='position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;overflow:hidden';
  const st=AMRT.renderSlide(AMStudio.deck.slides[i],{play:false}); st.style.width='1280px'; st.style.height='720px'; v.appendChild(st); document.body.appendChild(v); };
/* comparação a 2× (2560×1440): pixels a ±24 e a ±40 por canal, média; melhor registro global em ±1 px (fase do pdftoppm) */
const CMP=async ([a,b])=>{ const ld=s=>new Promise((r,j)=>{const im=new Image(); im.onload=()=>r(im); im.onerror=j; im.src=s;});
  const A=await ld(a), B=await ld(b); const W=2560,H=1440;
  const g=im=>{const c=document.createElement('canvas'); c.width=W;c.height=H; const x=c.getContext('2d'); x.drawImage(im,0,0,W,H); return x.getImageData(0,0,W,H).data;};
  const da=g(A), db=g(B); let best=null;
  for(const dx of [-1,0,1]) for(const dy of [-1,0,1]){ let ok=0,ok40=0,sum=0,N=0;
    for(let y=Math.max(0,-dy);y<H-Math.max(0,dy);y++) for(let x=Math.max(0,-dx);x<W-Math.max(0,dx);x++){ const i=(y*W+x)*4, j=((y+dy)*W+(x+dx))*4;
      const r=Math.abs(da[i]-db[j]),gg=Math.abs(da[i+1]-db[j+1]),bb=Math.abs(da[i+2]-db[j+2]), m=Math.max(r,gg,bb); if(m<=24) ok++; if(m<=40) ok40++; sum+=(r+gg+bb)/3; N++; }
    const m={match:+(ok/N*100).toFixed(2),m40:+(ok40/N*100).toFixed(2),mean:+(sum/N).toFixed(2),dx,dy}; if(!best||m.match>best.match) best=m; }
  return best; };
const b64=buf=>'data:image/png;base64,'+buf.toString('base64');
const TOOLS=path.join(__dirname,'test-s23-tools.py');
const inspect=f=>JSON.parse(execFileSync('python3',[TOOLS,'inspect',f],{encoding:'utf8',maxBuffer:64<<20}));
let FCONF=null;
try{ FCONF=JSON.parse(execFileSync('python3',[TOOLS,'fonts',path.join(TMP,'fonts')],{encoding:'utf8'})).conf; }catch(e){ console.log('Aviso: sem fontTools/brotli — o LibreOffice usa fontes substitutas no modo Editável ('+String(e.message).split('\n')[0]+')'); }
const LOENV=Object.assign({},process.env,FCONF?{FONTCONFIG_FILE:FCONF}:{});
const LOPROF='-env:UserInstallation=file://'+path.join(TMP,'lo-profile');
/* PPTX → PDF pelo Impress; hidden=true leva os slides ocultos (opção do filtro); lossless: a comparação mede o PPTX, não o JPEG do PDF */
function lo(f, tag, hidden){
  const opt=hidden?'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"},"UseLosslessCompression":{"type":"boolean","value":"true"},"ReduceImageResolution":{"type":"boolean","value":"false"}}':'pdf';
  const dir=path.join(OUT,tag); fs.mkdirSync(dir,{recursive:true});
  execFileSync('soffice',[LOPROF,'--headless','--convert-to',opt,'--outdir',dir,f],{env:LOENV,stdio:'pipe',timeout:180000});
  const pdf=path.join(dir,path.basename(f).replace(/\.pptx$/,'.pdf')); if(!fs.existsSync(pdf)) throw new Error('soffice não gerou o PDF (o LibreOffice Impress está instalado? apt-get install libreoffice-impress)');
  return pdf; }
const pdfPages=pdf=>+(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo',[pdf],{encoding:'utf8'}))||[])[1];
function pages2x(pdf, tag){ execFileSync('pdftoppm',['-r','192','-png',pdf,path.join(OUT,tag)]); return fs.readdirSync(OUT).filter(n=>n.startsWith(tag+'-')&&n.endsWith('.png')).sort().map(n=>fs.readFileSync(path.join(OUT,n))); }
function zipOK(f){ try{ execFileSync('python3',['-m','zipfile','-t',f],{stdio:'pipe'}); execFileSync('unzip',['-tq',f],{stdio:'pipe'}); return true; }catch(e){ return String(e.stdout||e.message).slice(0,300); } }

(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  await p.evaluate(BUILD,[PHOTO,TITLE]); await sleep(900);
  const N=await p.evaluate(()=>AMStudio.deck.slides.length);
  const deckJSON=await p.evaluate(()=>JSON.stringify(AMStudio.deck));
  let downloads=0; p.on('download',()=>downloads++);
  async function grab(fn){ const [dl]=await Promise.all([p.waitForEvent('download',{timeout:180000}),fn()]); const f=path.join(OUT,dl.suggestedFilename()); await dl.saveAs(f); return {f,name:dl.suggestedFilename()}; }
  async function openFromMore(){ await p.click('#bSaveMore'); await sleep(250); await p.click('.xmenu.xsave .xi:has-text("PowerPoint")'); await sleep(350); }
  const dlgState=()=>p.evaluate(()=>{ const d=document.getElementById('xkDlg'); if(!d||d.hidden) return null; const q=s=>d.querySelector(s), bx=q('.xp-box').getBoundingClientRect();
    return {title:q('#xkT').textContent, mode:(q('input[name=xkMode]:checked')||{}).value, hid:q('#xkHid').checked, hidL:q('#xkHidL').textContent, all:q('#xkAllL').textContent, est:q('#xkEst').textContent, font:!q('#xkFont').hidden, fontT:q('#xkFont').textContent,
      go:q('#xkGo').textContent, goDis:q('#xkGo').disabled, focus:document.activeElement&&document.activeElement.id, inView:bx.left>=0&&bx.right<=innerWidth+.5&&bx.top>=0&&bx.bottom<=innerHeight+.5, hscroll:q('.xp-b').scrollWidth>q('.xp-b').clientWidth+1||q('.xp-box').scrollWidth>q('.xp-box').clientWidth+1,
      pdfOpen:!!(document.getElementById('xpDlg')&&!document.getElementById('xpDlg').hidden), notesL:q('#xkNotesL').textContent}; });

  /* ---------- 1. menus: PowerPoint ativo no ▾ e no Arquivo ---------- */
  await p.click('#bSaveMore'); await sleep(250);
  const mi=await p.evaluate(()=>{ const b=[...document.querySelectorAll('.xmenu.xsave .xi')].find(x=>/PowerPoint/.test(x.textContent)); return b&&{t:b.querySelector('.xl').textContent,dis:b.classList.contains('dis'),tip:b.title}; });
  await p.keyboard.press('Escape'); await sleep(150);
  await p.click('#mbar [data-m=file]'); await sleep(250);
  const fm=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi')].map(b=>({t:b.querySelector('.xl').textContent,dis:b.classList.contains('dis')})));
  await p.keyboard.press('Escape'); await sleep(150);
  const fp=fm.find(i=>i.t==='Salvar como PowerPoint…');
  check('S23-01: ▾ “PowerPoint (.pptx)…” e Arquivo “Salvar como PowerPoint…” ativos (gancho AMExport.pptx); Arquivo continua com “Início (capa)” e um só “abrir…”', mi&&mi.t==='PowerPoint (.pptx)…'&&!mi.dis&&fp&&!fp.dis&&fm[0].t==='Início (capa)'&&fm.filter(i=>/abrir…/i.test(i.t)).length===1, {mi,fp});

  /* ---------- 2. caixa pelo ▾: padrão Idêntico, ocultos incluídos ---------- */
  await openFromMore();
  const d1=await dlgState(); await p.screenshot({path:SH('caixa-identico-1280')});
  check('S23-02: ▾ → PowerPoint abre a caixa #xkDlg “Salvar como PowerPoint” (não o #modal nem a caixa do PDF): Idêntico marcado, “Incluir slides ocultos (1)” marcado, 7 slides, foco em Exportar', d1&&d1.title==='Salvar como PowerPoint'&&d1.mode==='image'&&d1.hid&&/\(1\)/.test(d1.hidL)&&/Todos \(7 slides\)/.test(d1.all)&&/7 slides/.test(d1.est)&&!d1.font&&d1.focus==='xkGo'&&d1.inView&&!d1.pdfOpen&&!(await p.evaluate(()=>document.getElementById('modal').classList.contains('open'))), d1);

  /* ---------- 3. Idêntico: Exportar → download ---------- */
  const t0=Date.now();
  const g1=await grab(()=>p.click('#xkGo')); const msI=Date.now()-t0; await sleep(300);
  const toast1=await p.evaluate(()=>document.getElementById('toast').textContent);
  const closed1=await p.evaluate(()=>document.getElementById('xkDlg').hidden&&document.activeElement&&document.activeElement.id);
  check('S23-03: Exportar baixa '+SLUG+'.pptx, fecha a caixa (foco volta ao ▾) e avisa “PowerPoint salvo … 7 slides (1 oculto)”', g1.name===SLUG+'.pptx'&&closed1==='bSaveMore'&&/^PowerPoint salvo: cobertura-powerpoint-acao-coracao\.pptx · 7 slides \(1 oculto\) · /.test(toast1), {name:g1.name,toast1,closed1,ms:msI});
  const I1=inspect(g1.f);
  /* revisão S23: cada slide leva um espaço reservado de título (nome do slide no contorno do PowerPoint) atrás da imagem em tela cheia */
  check('S23-04: Idêntico — python-pptx abre: 7 slides 16:9 (12192000×6858000 EMU), título, cada slide = título (atrás) + 1 imagem JPEG em tela cheia', I1.slides.length===7&&I1.w===12192000&&I1.h===6858000&&I1.title===TITLE&&I1.slides.every(s=>s.shapes.length===2&&s.shapes[0].ph==='title'&&s.title&&s.shapes[1].tag==='pic'&&s.shapes[1].img==='image/jpeg'&&s.shapes[1].x===0&&s.shapes[1].y===0&&s.shapes[1].w===1280&&s.shapes[1].h===720), {n:I1.slides.length,w:I1.w,h:I1.h,title:I1.title,kb:Math.round(I1.size/1024),titles:I1.slides.map(s=>s.title)});
  check('S23-05: slide oculto sai oculto (<p:sld show="0">) e as anotações (Resumo do slide) vão para notesSlide', I1.slides.map(s=>s.hidden).join()==='false,false,false,false,false,false,true'&&I1.slides[0].notes==='Abertura: falar da receita.\nSegunda linha das anotações — ação.'&&I1.slides[5].notes==='Slide escuro: foto de fundo a 35 %.'&&I1.slides[6].notes==='Slide oculto.'&&I1.slides[1].notes===null, I1.slides.map(s=>[s.hidden,s.notes]));
  const z1=zipOK(g1.f);
  check('S23-06: pacote íntegro — zipfile -t e unzip -t, todas as partes XML bem formadas, relações e tipos de conteúdo completos, [Content_Types].xml primeiro', z1===true&&I1.zipBad===null&&!I1.xmlBad.length&&!I1.relBad.length&&!I1.ctMissing.length&&I1.first==='[Content_Types].xml', {z1,xmlBad:I1.xmlBad,relBad:I1.relBad,ct:I1.ctMissing});

  /* referência: o editor desenha cada slide a 2× (outro contexto, deviceScaleFactor 2) */
  const ctx2=await b.newContext({viewport:{width:1280,height:720},deviceScaleFactor:2});
  const q=await open(ctx2, FILE+'?nocover', 'ref'); await q.evaluate(j=>AMStudio.loadDeck(JSON.parse(j),'ref'),deckJSON); await sleep(800);
  const refs=[]; for(let i=0;i<N;i++){ await q.evaluate(SHOW,i); await sleep(350); const s=await q.screenshot({clip:{x:0,y:0,width:1280,height:720}}); refs.push(s); fs.writeFileSync(SH('editor-'+(i+1)),s); }
  /* LibreOffice: por padrão só os visíveis (respeita show="0"); com ExportHiddenSlides, todos */
  let pdfI=null, pv=null;
  try{ pv=pdfPages(lo(g1.f,'lo-vis',false)); pdfI=lo(g1.f,'lo-img',true); }catch(e){ check('S23-07: LibreOffice Impress converte o PPTX', false, String(e.message).slice(0,300)); }
  if(pdfI){
    const pg=pages2x(pdfI,'img'); const ms=[];
    for(let i=0;i<pg.length&&i<N;i++){ const m=await p.evaluate(CMP,[b64(refs[i]),b64(pg[i])]); ms.push(m); if(i===4) fs.writeFileSync(SH('lo-identico-5'),pg[i]); }
    console.log('Idêntico × editor (% a ±24 / média):', ms.map(m=>m.match+'/'+m.mean).join(' · '));
    check('S23-07: LibreOffice abre o Idêntico — 6 páginas sem os ocultos (show="0" respeitado), 7 com eles', pv===6&&pg.length===7, {pv,pages:pg.length});
    check('S23-08: Idêntico × editor, slide a slide (pdftoppm 192 dpi × tela 2×): ≥ 97 % dos pixels a ±24 e média < 4', ms.length===7&&ms.every(m=>m.match>=97&&m.mean<4), ms);
  }

  /* ---------- 4. Editável pelo Arquivo › Salvar como PowerPoint… ---------- */
  await p.click('#mbar [data-m=file]'); await sleep(250); await p.click('.xmenu .xi:has-text("Salvar como PowerPoint…")'); await sleep(350);
  await p.click('#xkDlg .xp-card:has(input[value=edit])'); await sleep(200);
  const d2=await dlgState(); await p.screenshot({path:SH('caixa-editavel-1280')});
  check('S23-09: Arquivo › Salvar como PowerPoint… abre a mesma caixa; no Editável aparece o aviso das fontes (Inter, Roboto…) que o PowerPoint troca se não estiverem instaladas', d2&&d2.mode==='edit'&&d2.font&&/Inter/.test(d2.fontT)&&/Roboto/.test(d2.fontT)&&/JetBrains Mono/.test(d2.fontT)&&/instaladas/.test(d2.fontT)&&d2.inView, d2);
  const t1=Date.now(); const g2=await grab(()=>p.click('#xkGo')); const msE=Date.now()-t1; await sleep(300);
  const I2=inspect(g2.f), S=I2.slides;
  const z2=zipOK(g2.f);
  check('S23-10: Editável — íntegro (zip, XML, relações), 7 slides 16:9, 1 oculto, anotações', z2===true&&!I2.xmlBad.length&&!I2.relBad.length&&!I2.ctMissing.length&&S.length===7&&I2.w===12192000&&S[6].hidden&&!S[0].hidden&&S[0].notes&&S[0].notes.indexOf('ação')>0, {z2,kb:Math.round(I2.size/1024),ms:msE});
  const sh1=S[0].shapes, T=k=>sh1.find(x=>x.text&&x.text.indexOf(k)>=0);
  const tt=T('Receita'), body=T('Primeiro'), eb=T('RÓTULO'), bx=T('Caixa com fundo'), ttR=tt&&tt.runs;
  /* <b> dentro do título fino (300) é “bolder” = 400 no navegador → Roboto (Regular), não Light nem negrito */
  check('S23-11: textos nativos — título com trechos (“cresce 18%” em Roboto Regular como o <b> sobre peso 300, laranja “margem”, resto Roboto Light 33 pt), acentos intactos', sh1.every(x=>x.tag==='sp')&&tt&&tt.text==='Receita cresce 18% com margem — ação, coração'&&ttR.some(r=>r.t==='cresce 18%'&&r.font==='Roboto'&&!r.b)&&ttR.some(r=>r.t==='margem'&&r.color==='F78C16')&&ttR[0].font==='Roboto Light'&&ttR[0].sz===33&&tt.x===60&&tt.y===40&&tt.w===900, tt);
  check('S23-12: parágrafos (<div>, linha vazia) e formatos — 4 parágrafos, itálico, sublinhado, negrito, Inter 13,5 pt; rótulo em JetBrains Mono; caixa com fundo girada −4°', body&&body.paras===4&&body.runs.some(r=>r.t==='itálico'&&r.i)&&body.runs.some(r=>r.t==='sublinhado'&&r.u)&&body.runs.some(r=>r.t==='negrito'&&r.b)&&body.runs[0].font==='Inter'&&body.runs[0].sz===13.5&&/é, ê, õ, ç, ü — “aspas”/.test(body.text)&&eb&&eb.runs[0].font==='JetBrains Mono'&&bx&&Math.round(bx.rot)===356, {body,eb:eb&&eb.runs,bx:bx&&bx.rot});
  const sh2=S[1].shapes, P=k=>sh2.filter(x=>x.prst===k);
  const ell=P('ellipse')[0], chev=P('chevron')[0], arr=P('rightArrow')[0];
  check('S23-13: formas nativas com geometria do PowerPoint — retângulo de cantos (roundRect), elipse girada 30° com texto, divisa espelhada, seta girada + espelhada na vertical, estrela, triângulo, losango, pentágono, pílula, hexágono', P('roundRect').length>=3&&ell&&Math.round(ell.rot)===30&&ell.text==='Elipse'&&chev&&chev.flipH&&arr&&arr.flipV&&Math.round(arr.rot)===340&&P('star5').length===1&&P('triangle').length===1&&P('diamond').length===1&&P('homePlate').length===1&&P('hexagon').length===1, sh2.map(x=>[x.tag,x.prst,x.rot,x.flipH,x.flipV,x.text]));
  const grp=sh2.filter(x=>x.tag==='grpSp');
  check('S23-14: forma sem equivalente (balão, card Cabeçalho) = desenho em imagem + texto editável por cima, agrupados; cilindro sem texto = imagem', grp.length===2&&sh2.filter(x=>x.tag==='pic').length>=3&&sh2.some(x=>x.text==='Balão de fala'&&x.prst==='rect')&&sh2.some(x=>x.text&&/Card cabeçalho/.test(x.text)), grp.map(g=>g.name));
  const ln=S[2].shapes.filter(x=>x.tag==='cxnSp');
  check('S23-15: linhas = conectores — reta (bola → seta), tracejada, cotovelo (bentConnector3), curva (curvedConnector3, ponta aberta), losango pontilhado, cota com barras', ln.length===9&&ln.some(x=>x.head==='oval'&&x.tail==='triangle')&&ln.some(x=>x.dash&&x.tail==='triangle'&&x.prst==='straightConnector1')&&ln.filter(x=>x.prst==='bentConnector3').length===2&&ln.some(x=>x.prst==='curvedConnector3'&&x.tail==='arrow')&&ln.some(x=>x.tail==='diamond'&&x.dash), ln.map(x=>[x.prst,x.head,x.tail,x.dash,x.rot,x.flipH,x.flipV]));
  const pics=S[3].shapes.filter(x=>x.tag==='pic');
  const cov=pics.find(x=>x.flipH), con=pics.find(x=>Math.round(x.rot)===12), tra=pics.find(x=>x.alpha!=null);
  check('S23-16: fotos — preencher com recorte (srcRect) + espelho + cantos, inteira girada 12° com faixas (recorte negativo), transparente 70 %; ícone e Linhas A&M em PNG', pics.length===5&&cov&&cov.crop&&cov.prst==='roundRect'&&con&&con.crop&&+con.crop.t<0&&con.w===300&&tra&&Math.abs(tra.alpha-.7)<.001&&pics.filter(x=>x.img==='image/png').length>=2, pics.map(x=>[x.name,x.crop,x.prst,x.rot,x.alpha,x.img]));
  check('S23-17: gráficos, SWOT com cores e SmartArt = imagens PNG transparentes com texto alternativo; slide escuro: fundo #002A46 + foto de fundo a 35 %, título editável', S[4].shapes.filter(x=>x.ph!=='title').length===5&&S[4].shapes.filter(x=>x.ph!=='title').every(x=>x.tag==='pic'&&x.img==='image/png')&&S[4].shapes.filter(x=>x.ph==='title').length===1&&S[5].bg==='002A46'&&S[5].shapes.some(x=>x.name==='Imagem de fundo'&&Math.abs(x.alpha-.35)<.001&&x.w===1280)&&S[5].shapes.some(x=>x.text==='Slide escuro com foto de fundo'), {s5:S[4].shapes.map(x=>x.name),s6:S[5].shapes.map(x=>[x.name,x.alpha,x.text])});
  let pdfE=null; try{ pdfE=lo(g2.f,'lo-edit',true); }catch(e){ check('S23-18: LibreOffice converte o Editável', false, String(e.message).slice(0,300)); }
  if(pdfE){
    const pg=pages2x(pdfE,'edit'); const ms=[];
    for(let i=0;i<pg.length&&i<N;i++){ const m=await p.evaluate(CMP,[b64(refs[i]),b64(pg[i])]); ms.push(m); fs.writeFileSync(SH('lo-editavel-'+(i+1)),pg[i]); }
    console.log('Editável × editor (% a ±40 / % a ±24 / média):', ms.map(m=>m.m40+'/'+m.match+'/'+m.mean).join(' · '), FCONF?'(fontes instaladas para o soffice)':'(fontes substitutas)');
    check('S23-18: Editável × editor no LibreOffice, slide a slide: ≥ 90 % dos pixels a ±40', ms.length===7&&ms.every(m=>m.m40>=90), ms);
  }

  /* ---------- 5. intervalo, ocultos fora, slide atual ---------- */
  await openFromMore();
  await p.click('#xkDlg .xp-card:has(input[value=image])'); await sleep(100);
  await p.fill('#xkFrom','2'); await p.fill('#xkTo','3'); await p.press('#xkTo','Tab'); await sleep(150);
  const d3=await dlgState();
  const g3=await grab(()=>p.click('#xkGo')); const I3=inspect(g3.f);
  check('S23-19: intervalo “De 2 a 3” → 2 slides (o 2 e o 3 do deck), sem anotações onde não há resumo', /2 slides/.test(d3.est)&&I3.slides.length===2&&I3.slides.every(s=>!s.hidden&&s.notes===null), {est:d3.est,n:I3.slides.length});
  await openFromMore();
  await p.click('#xkDlg label.xp-ck:has(#xkHid)'); await sleep(150);
  const d4=await dlgState();
  const g4=await grab(()=>p.click('#xkGo')); const I4=inspect(g4.f);
  check('S23-20: “Incluir slides ocultos” desmarcado → 6 slides, nenhum oculto; marcado (padrão) → o oculto entra oculto', !d4.hid&&/Todos \(6 slides\)/.test(d4.all)&&I4.slides.length===6&&I4.slides.every(s=>!s.hidden)&&I1.slides[6].hidden, {all:d4.all,n:I4.slides.length});
  await p.evaluate(()=>AMStudio.goSlide(6)); await sleep(300);
  await openFromMore();
  await p.click('#xkDlg label.xp-rd:has(input[value=cur])'); await sleep(100);
  const g5=await grab(()=>p.click('#xkGo')); const I5=inspect(g5.f);
  /* revisão S23: um arquivo só com slides ocultos teria a apresentação vazia no PowerPoint → o único slide sai visível, e a caixa avisa */
  const warnH=await p.evaluate(()=>document.getElementById('xkEst').textContent);
  check('S23-21: “Slide atual” num slide oculto → 1 slide, visível no arquivo (senão a apresentação ficaria vazia); a caixa avisou', I5.slides.length===1&&I5.slides[0].hidden===false&&I5.slides[0].notes==='Slide oculto.'&&/Todos os slides escolhidos estão ocultos/.test(warnH), {sl:I5.slides.map(s=>[s.hidden,s.notes]),warnH});
  await p.evaluate(()=>AMStudio.goSlide(0)); await sleep(200);

  /* ---------- 6. cancelar no meio (16 slides) ---------- */
  await p.evaluate(()=>{ const d=JSON.parse(JSON.stringify(AMStudio.deck)); const s=d.slides.slice(0,6); d.slides=[]; for(let k=0;k<16;k++){ const c=JSON.parse(JSON.stringify(s[k%6])); c.id='c'+k; c.els.forEach((e,j)=>e.id='c'+k+'e'+j); delete c.hidden; d.slides.push(c); } AMStudio.loadDeck(d,'16'); }); await sleep(600);
  await openFromMore();
  const before=downloads;
  await p.click('#xkGo');
  await p.waitForFunction(()=>/Gerando slide ([3-9]|1\d) de 16/.test(document.getElementById('xkPl').textContent),null,{timeout:60000});
  const prog=await p.evaluate(()=>({l:document.getElementById('xkPl').textContent,c:document.getElementById('xkCancel').textContent,busy:document.getElementById('xkDlg').classList.contains('busy'),pb:document.querySelector('#xkDlg .xp-bar').getAttribute('aria-valuenow'),dis:document.getElementById('xkGo').disabled}));
  await p.screenshot({path:SH('progresso-1280')});
  await p.click('#xkCancel'); await sleep(2500);
  const after=await p.evaluate(()=>({open:!document.getElementById('xkDlg').hidden,busy:document.getElementById('xkDlg').classList.contains('busy'),go:document.getElementById('xkGo').disabled,c:document.getElementById('xkCancel').textContent,toast:document.getElementById('toast').textContent,prog:document.getElementById('xkProg').hidden}));
  check('S23-22: cancelar no meio — progresso “Gerando slide n de 16…” com barra, “Cancelar exportação”; depois: nada baixado, caixa aberta e livre, aviso “Exportação cancelada”', prog.busy&&prog.dis&&prog.c==='Cancelar exportação'&&+prog.pb>0&&downloads===before&&after.open&&!after.busy&&!after.go&&after.c==='Cancelar'&&after.prog&&/Exportação cancelada/.test(after.toast), {prog,after});
  /* teclado: Tab preso na caixa, Delete/Ctrl+Z não vazam para o editor, Esc fecha e devolve o foco ao ▾ */
  const nEls=await p.evaluate(()=>AMStudio.deck.slides[0].els.length);
  for(let k=0;k<14;k++) await p.keyboard.press('Tab');
  const inside=await p.evaluate(()=>document.getElementById('xkDlg').contains(document.activeElement));
  await p.keyboard.press('Delete'); await p.keyboard.press('Control+z'); await sleep(150);
  const nEls2=await p.evaluate(()=>AMStudio.deck.slides[0].els.length);
  await p.keyboard.press('Escape'); await sleep(200);
  const esc=await p.evaluate(()=>({hidden:document.getElementById('xkDlg').hidden,f:document.activeElement&&document.activeElement.id}));
  check('S23-23: teclado — Tab fica na caixa, Delete e Ctrl+Z não mexem no slide, Esc fecha e o foco volta ao ▾', inside&&nEls===nEls2&&esc.hidden&&esc.f==='bSaveMore', {inside,nEls,nEls2,esc});

  /* ---------- 7. caixa responsiva: 390, 1440 ---------- */
  await p.evaluate(j=>AMStudio.loadDeck(JSON.parse(j),'cobertura'),deckJSON); await sleep(2700); /* o aviso do loadDeck some antes das fotos da caixa */
  const sizes=[[390,800,'390'],[1440,900,'1440'],[1280,720,'1280b']], lay=[];
  for(const [w,h,tag] of sizes){
    await p.setViewportSize({width:w,height:h}); await sleep(300);
    await p.evaluate(()=>AMExport.pptx(AMStudio.deck,{opener:document.getElementById('bSaveMore')})); await sleep(350);
    await p.click('#xkDlg .xp-card:has(input[value=edit])'); await sleep(150);
    const s=await dlgState(); await p.screenshot({path:SH('caixa-'+tag)});
    const btn=await p.evaluate(()=>{ const a=document.getElementById('xkGo').getBoundingClientRect(), c=document.getElementById('xkCancel').getBoundingClientRect(), bd=document.querySelector('#xkDlg .xp-b'); return {go:a.right<=innerWidth&&a.bottom<=innerHeight&&a.width>60, can:c.left>=0&&c.bottom<=innerHeight, scroll:bd.scrollHeight>bd.clientHeight, trunc:[...document.querySelectorAll('#xkDlg .xp-card b, #xkDlg .xp-btn')].some(x=>x.scrollWidth>x.clientWidth+1)}; });
    lay.push({tag,inView:s.inView,hscroll:s.hscroll,...btn});
    await p.keyboard.press('Escape'); await sleep(150);
  }
  await p.setViewportSize({width:1280,height:720}); await sleep(300);
  check('S23-24: caixa responsiva a 390×800, 1440×900 e 1280×720 — inteira na tela, sem rolagem horizontal, botões visíveis, rótulos sem corte', lay.every(l=>l.inView&&!l.hscroll&&l.go&&l.can&&!l.trunc), lay);
  const bar=await p.evaluate(()=>{ const t=document.getElementById('top'), r=document.getElementById('rib'), s=document.getElementById('bSave').getBoundingClientRect(); return {top:t.scrollWidth<=t.clientWidth,rib:r.scrollWidth<=r.clientWidth,save:s.right<=innerWidth}; });
  check('S23-25: barra do topo e faixa sem transbordar a 1280×720; #bSave na janela', bar.top&&bar.rib&&bar.save, bar);

  /* ---------- 8. exportar não muda o deck; reabrir e exportar de novo; #bSave continua .html ---------- */
  const now=await p.evaluate(()=>JSON.stringify(AMStudio.deck));
  const re=await p.evaluate(async()=>{ AMStudio.loadDeck(JSON.parse(JSON.stringify(AMStudio.deck)),'reaberto'); await new Promise(r=>setTimeout(r,300)); const bl=await AMExport.pptxBuild(AMStudio.deck,{mode:'edit',includeHidden:true}); return {size:bl.size,type:bl.type,n:AMStudio.deck.slides.length}; });
  check('S23-26: exportar não altera o deck; depois de reabrir (loadDeck do JSON) o Editável sai de novo, mesmo tamanho ±2 %', now===deckJSON&&re.n===7&&re.type==='application/vnd.openxmlformats-officedocument.presentationml.presentation'&&Math.abs(re.size-I2.size)/I2.size<.02, {same:now===deckJSON,re,first:I2.size});
  const g6=await grab(()=>p.click('#bSave'));
  check('S23-27: clique simples em #bSave continua baixando o .html', /\.html$/.test(g6.name), g6.name);

  /* ---------- 9. ZIP de 100 MB: CRC-32 e cabeçalhos ---------- */
  const big=await p.evaluate(async()=>{ const n=100*1024*1024, u=new Uint8Array(n); for(let i=0;i<n;i++) u[i]=(i*31+(i>>>11))&255; const t=performance.now();
    const bl=await AMExport.zip([{name:'dados/ação.bin',data:u},{name:'b.xml',data:'<a>ç</a>'}]); const ms=Math.round(performance.now()-t);
    const h=new DataView(await bl.slice(0,30).arrayBuffer()), e=new DataView(await bl.slice(bl.size-22).arrayBuffer());
    return {size:bl.size,ms,crc:h.getUint32(14,true),sz:h.getUint32(18,true),flag:h.getUint16(6,true),entries:e.getUint16(10,true),cdOff:e.getUint32(16,true)}; });
  const ref=Buffer.alloc(100*1024*1024); for(let i=0;i<ref.length;i++) ref[i]=(i*31+(i>>>11))&255;
  const crc=zlib.crc32(ref);
  check('S23-28: ZIP de 100 MB — CRC-32 igual ao do zlib, tamanho e flag UTF-8 certos, 2 entradas no diretório central', big.crc===crc&&big.sz===ref.length&&big.flag===0x0800&&big.entries===2&&big.size>ref.length&&big.cdOff>ref.length, {big,crc});

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({ms:{identico:msI,editavel:msE},kb:{identico:Math.round(I1.size/1024),editavel:Math.round(I2.size/1024)}}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
