/* S24/S25 — Importar PowerPoint (.pptx) e PDF como slides editáveis (ed-42-import.js).
   Cobertura: arquivos gerados com python-pptx (test-s24-tools.py make): textos com formato por trecho, formas, conectores, foto com
   recorte, grupo, tabela, gráfico, slide oculto, anotações, espaços reservados herdando do layout/mestre (4:3), texto girado;
   fidelidade medida contra o LibreOffice (soffice → PDF → pdftoppm) e ida-e-volta com o PowerPoint Editável do S23; PDF (pdf.js servido
   de vendor/ pela rota do teste) com fundo + textos editáveis, contra o pdftoppm da mesma página; o PDF confidencial do cliente só
   quando existe (AM_ONS_PDF ou o caminho padrão) e nada dele é gravado. Interface: Arquivo › Importar…, caixa (substituir/adicionar,
   progresso, relatório, Concluir), arrastar e soltar, cancelar no meio, formatos recusados, Esc/foco, painel (fonte importada),
   oculto/anotações/título, salvar e reabrir, exportar PDF/PowerPoint do que foi importado, um Ctrl+Z para “Adicionar ao final”.
   Uso: python3 assemble.py && node test-s24-import.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const PJ=path.join(__dirname,'vendor','pdfjs-4.10.38');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s24-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s24'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS=path.join(__dirname,'test-s24-tools.py'), TOOLS23=path.join(__dirname,'test-s23-tools.py');
const ONS=process.env.AM_ONS_PDF||'/root/.claude/uploads/d1659d46-7fc1-552e-ba5d-02ae16117f1f/41cd022f-202609_ONS_Estrutura_e_Treinamento_GMO_v4.pdf';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,1200):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){
  if(!fs.existsSync(path.join(FONTS,'gf.css'))){ await p.route('https://fonts.googleapis.com/**',r=>r.abort()); await p.route('https://fonts.gstatic.com/**',r=>r.abort()); return; }
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
/* pdf.js: o editor pede ao cdnjs; aqui a rota entrega a cópia de vendor/ (sem internet no portão). As outras CDNs ficam bloqueadas */
async function pdfjs(p){ await p.route('https://cdnjs.cloudflare.com/**',r=>{ const f=path.join(PJ,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'text/javascript',headers:ACAO,body:fs.readFileSync(f)}):r.abort(); }); await p.route('https://cdn.jsdelivr.net/**',r=>r.abort()); await p.route('https://unpkg.com/**',r=>r.abort()); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p); await pdfjs(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const b64f=f=>fs.readFileSync(f).toString('base64');
/* importa pela API (sem a caixa) e carrega: devolve o relatório */
async function importApi(p, f, kind, mode){ return p.evaluate(async ([b64,name,kind,mode])=>{ const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const res=await (kind==='pdf'?AMImport.pdf(u,{}):AMImport.pptx(u,{})); return AMImport.finish(res,{name},{mode}); }, [b64f(f),path.basename(f),kind,mode||'replace']); }
/* comparação no navegador: PNG (data:) × canvas do slide; LO 4:3 (960×720) entra centralizado como no letterbox do editor */
const CMP=`async function cmp(aData, bData, box){ function ld(d){ return new Promise(r=>{ const im=new Image(); im.onload=()=>r(im); im.src=d; }); } const A=await ld(aData), B=await ld(bData); const W=1280,H=720; function draw(im){ const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,W,H); const k=Math.min(W/im.width,H/im.height); x.drawImage(im,(W-im.width*k)/2,(H-im.height*k)/2,im.width*k,im.height*k); return x.getImageData(0,0,W,H).data; } const a=draw(A), b=draw(B); let ok=0,n=0,sum=0; const bx=box||{x:0,y:0,w:W,h:H}; for(let y=bx.y;y<bx.y+bx.h;y++) for(let x=bx.x;x<bx.x+bx.w;x++){ const i=(y*W+x)*4; const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2])); n++; sum+=d; if(d<=40) ok++; } return {match:Math.round(ok/n*10000)/100, mean:Math.round(sum/n*100)/100}; }`;
async function cmpSlide(p, i, pngFile, box){ const b=b64f(pngFile); return p.evaluate(async ([i,b,box,CMP])=>{ eval(CMP); const r=await AMExport.rasterSlide(AMStudio.deck.slides[i],{scale:1,type:'png'}); const a=r.canvas.toDataURL('image/png'); r.canvas.width=0; return cmp(a,'data:image/png;base64,'+b,box); }, [i,b,box||null,CMP]); }
function lo(pptx){ const out=path.join(TMP,'lo'); const r=JSON.parse(execFileSync('python3',[TOOLS,'pdf',pptx,out],{encoding:'utf8'})); if(!r.pdf) throw new Error('soffice: '+r.err); const base=path.join(out,path.basename(pptx,'.pptx')); execFileSync('pdftoppm',['-r','96','-png',r.pdf,base]); return {pdf:r.pdf, png:n=>base+'-'+n+'.png'}; }
(async()=>{
  const FX=path.join(TMP,'fx'); const mk=JSON.parse(execFileSync('python3',[TOOLS,'make',FX],{encoding:'utf8'}));
  check('S24-00: arquivos de cobertura gerados (python-pptx)', mk.files.length===4 && fs.existsSync(path.join(FX,'fx-a.pptx')), mk.files);
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));

  /* ---------- 1. PowerPoint: conteúdo lido ---------- */
  const ra=await importApi(p, path.join(FX,'fx-a.pptx'), 'pptx');
  let d=await D(); const s1=d.slides[0], s2=d.slides[1], s3=d.slides[2];
  check('S24-01: fx-a: 3 slides; relatório conta textos, formas, linhas, imagem, tabela, gráfico, anotações e oculto', d.slides.length===3 && ra.count.texts>=4 && ra.count.shapes>=18 && ra.count.lines===2 && ra.count.images===1 && ra.count.tables===1 && ra.count.charts===1 && ra.count.notes===1 && ra.replaced, ra);
  const tt=s1.els.find(e=>e.type==='text'&&/Receita/.test(e.html));
  check('S24-02: texto com trechos: negrito/itálico/cor laranja/tamanhos em em, 2º parágrafo à direita e sublinhado; caixa = xfrm − recuos (0,5" → 58 px)', !!tt && /<b>/.test(tt.html) && /<i>/.test(tt.html) && /color:#F78C16/.test(tt.html) && /font-size:[\d.]+em/.test(tt.html) && /text-align:right/.test(tt.html) && /<u>/.test(tt.html) && Math.abs(tt.x-57.6)<1.5 && tt.font==='Calibri', tt&&{x:tt.x,y:tt.y,font:tt.font,size:tt.size,html:tt.html.slice(0,200)});
  const kinds=s1.els.filter(e=>e.type==='shape').map(e=>e.shape);
  check('S24-03: geometrias: rect, round, ellipse (girada 30°), chevron, arrow (espelhada), diamond, triangle (só contorno), hexagon', ['rect','round','ellipse','chevron','arrow','diamond','triangle','hexagon'].every(k=>kinds.indexOf(k)>=0) && s1.els.some(e=>e.shape==='ellipse'&&e.rot===30) && s1.els.some(e=>e.shape==='arrow'&&e.flipH===true) && s1.els.some(e=>e.shape==='triangle'&&e.fill==='none'&&e.strokeW>1), kinds);
  const rr=s1.els.find(e=>e.shape==='round'&&/Arredondado/.test(e.html));
  check('S24-04: forma com texto: preenchimento #43698F, contorno laranja 3 pt (4 px), texto branco negrito 14 pt (18,7 px), centrado na vertical', !!rr && rr.fill==='#43698F' && rr.stroke==='#F78C16' && Math.abs(rr.strokeW-4)<.3 && rr.color==='#FFFFFF' && rr.weight===700 && Math.abs(rr.size-18.7)<.2 && rr.valign==='middle', rr&&{fill:rr.fill,stroke:rr.stroke,sw:rr.strokeW,color:rr.color,size:rr.size});
  const ln=s1.els.filter(e=>e.type==='line');
  check('S24-05: conectores: reta navy 3 pt com ponta no fim; cotovelo laranja tracejado', ln.length===2 && ln.some(l=>l.stroke==='#002A46'&&l.headEnd===true&&!l.headStart&&Math.abs(l.strokeW-4)<.3&&!l.dash) && ln.some(l=>l.stroke==='#F78C16'&&l.dash===true&&l.curve==='elbow'), ln.map(l=>[l.stroke,l.strokeW,l.headEnd,l.dash,l.curve]));
  const im=s1.els.find(e=>e.type==='image');
  check('S24-06: foto com recorte à esquerda (25 %): a foto vem inteira (400 px) com el.crop.l = 0,25 (S27b; antes era assada em 300 px)', !!im && /^data:image\/png/.test(im.src) && Math.abs(im.w-230.4)<1 && im.crop && Math.abs(im.crop.l-0.25)<.001 && await p.evaluate(src=>new Promise(r=>{ const i=new Image(); i.onload=()=>r(i.naturalWidth); i.src=src; }), im.src)===400, im&&{w:im.w,h:im.h,crop:im.crop});
  const grp=s1.els.filter(e=>(e.shape==='rect'&&e.fill==='#A3B8D6')||(e.shape==='ellipse'&&e.fill==='#002A46'));
  check('S24-07: grupo achatado: 2 formas no lugar certo (3,5" → 336 px; 5,1" → 490 px)', grp.length===2 && grp.some(e=>Math.abs(e.x-336)<1) && grp.some(e=>Math.abs(e.x-489.6)<1), grp.map(e=>[e.shape,e.x,e.y]));
  const cells=s1.els.filter(e=>e.shape==='rect'&&/Iniciativa|Prazo|Status|Compras|Q3|Em curso|Logística|Q4|Planejado/.test(e.html));
  check('S24-08: tabela 3×3 → 9 células: cabeçalho accent1 com texto branco, faixas claras, célula com cor própria (#1B7F3B), bordas brancas', cells.length===9 && cells.filter(c=>/Iniciativa|Prazo|Status/.test(c.html)).every(c=>c.fill==='#4F81BD'&&c.color==='#FFFFFF') && cells.some(c=>/Em curso/.test(c.html)&&c.fill==='#1B7F3B') && cells.some(c=>/Compras/.test(c.html)&&c.fill==='#DCE6F2') && cells.every(c=>c.stroke==='#FFFFFF'), cells.map(c=>[c.html.replace(/<[^>]+>/g,''),c.fill]));
  check('S24-09: anotações, oculto e ordem', s1.notes==='Abertura: falar da receita.\nSegunda linha das anotações.' && s3.hidden===true && /Slide oculto/.test(s3.els[0].html), {notes:s1.notes,hidden:s3.hidden});
  const ch=s2.els.find(e=>e.type==='fx'&&e.kind==='columns');
  check('S24-10: gráfico de colunas → gráfico do Canteiro com título, categorias e 2 séries', !!ch && ch.data.title==='Receita por canal' && ch.data.cats.join()==='2023,2024,2025' && ch.data.series.length===2 && ch.data.series[0].t==='Varejo' && ch.data.series[0].v.join()==='42,48,55' && ch.data.mode==='cluster', ch&&ch.data);
  const bl=s2.els.find(e=>e.type==='text'&&/Primeiro ponto/.test(e.html));
  check('S24-11: marcadores: 4 parágrafos com “•”, subitem com recuo maior; texto girado 15°; roundRect 50 % vira pílula (raio = metade)', !!bl && (bl.html.match(/>•</g)||[]).length===4 && /padding-left:1\.\d+em/.test(bl.html) && s2.els.some(e=>e.type==='text'&&e.rot===15&&/girado/.test(e.html)) && s2.els.some(e=>e.shape==='round'&&Math.abs(e.radius-48)<1), {bul:(bl&&bl.html.match(/>•</g)||[]).length, rot:s2.els.filter(e=>e.rot).map(e=>e.rot), pill:s2.els.filter(e=>e.shape==='round').map(e=>e.radius)});
  await p.screenshot({path:SH('fx-a')});
  /* fidelidade contra o LibreOffice (fontes diferentes: Calibri→Carlito no LO, Inter aqui) */
  const loa=lo(path.join(FX,'fx-a.pptx'));
  const ca=await cmpSlide(p, 0, loa.png(1));
  check('S24-12: fx-a slide 1 × LibreOffice (pdftoppm 96 dpi): ≥ 90 % dos pixels a ±40 (formas, cores, tabela, linhas no lugar)', ca.match>=90 && ca.mean<12, ca);
  /* ---------- 2. 4:3 com espaços reservados ---------- */
  const rb=await importApi(p, path.join(FX,'fx-b.pptx'), 'pptx');
  d=await D();
  const t1=d.slides[0].els.find(e=>/Título do projeto/.test(e.html)), sub=d.slides[0].els.find(e=>/Subtítulo/.test(e.html)), ag=d.slides[1].els.find(e=>/Contexto/.test(e.html));
  check('S24-13: fx-b (4:3): título herda posição e tamanho do layout (44 pt → 58,7 px, centrado), subtítulo herda a cor do mestre (cinza), corpo com marcadores de 2 níveis (“•” e “–”), letterbox 160 px', d.slides.length===2 && !!t1 && Math.abs(t1.size-58.7)<.2 && t1.align==='center' && !!sub && sub.color==='#404040' && !!ag && />•</.test(ag.html) && />–</.test(ag.html) && d.slides.every(s=>s.els.every(e=>e.x>=150&&e.x+e.w<=1130)) && d.slides[0].title==='Título do projeto' && d.slides[1].notes==='Falar da agenda.', {t1:t1&&[t1.x,t1.y,t1.w,t1.size,t1.align], sub:sub&&sub.color, ag:ag&&ag.html.slice(0,160)});
  const lob=lo(path.join(FX,'fx-b.pptx'));
  const cb=await cmpSlide(p, 1, lob.png(2));
  check('S24-14: fx-b slide 2 × LibreOffice: ≥ 93 % a ±40', cb.match>=93 && cb.mean<8, cb);
  await p.screenshot({path:SH('fx-b')});
  /* ---------- 3. ida e volta: PowerPoint Editável do S23 → importar → mesmo desenho ---------- */
  const PHOTO='data:image/png;base64,'+b64f(path.join(__dirname,'test-foto.png'));
  await p.evaluate((PHOTO)=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Ida e volta';
    const s=mk.slide('blank-light'); s.els=[];
    const t=mk.text('title'); Object.assign(t,{x:60,y:40,w:900,h:80}); t.html='Receita <b>cresce 18%</b> com <span style="color:#F78C16">margem</span>'; s.els.push(t);
    const bt=mk.text('body'); Object.assign(bt,{x:60,y:140,w:560,h:120}); bt.html='Texto corrido com acentuação: é, ê, õ, ç.<br>Segunda linha <i>itálica</i>.'; s.els.push(bt);
    const r=mk.shape('rect'); Object.assign(r,{x:60,y:300,w:220,h:140}); r.html='Caixa'; s.els.push(r);
    const e2=mk.shape('ellipse'); Object.assign(e2,{x:320,y:300,w:200,h:140,rot:30}); s.els.push(e2);
    const c=mk.shape('chevron'); Object.assign(c,{x:560,y:300,w:220,h:120}); s.els.push(c);
    const l1=mk.line(); Object.assign(l1,{x1:80,y1:500,x2:500,y2:640,headEnd:true}); s.els.push(l1);
    const l2=mk.line(); Object.assign(l2,{x1:600,y1:520,x2:1100,y2:520,headEnd:true,dash:true,strokeW:4}); s.els.push(l2);
    const im=mk.image(PHOTO,800,600); Object.assign(im,{x:820,y:60,w:400,h:300,radius:20,fit:'cover'}); s.els.push(im);
    d.slides=[s]; A.loadDeck(d,'rt'); }, PHOTO);
  const origPng=await p.evaluate(async()=>{ const r=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1,type:'png'}); const a=r.canvas.toDataURL('image/png'); r.canvas.width=0; return a; });
  const rt=await p.evaluate(async()=>{ const blob=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await blob.arrayBuffer()); const res=await AMImport.pptx(u,{}); return {rep:AMImport.finish(res,{name:'ida-e-volta.pptx'},{mode:'replace'}), kb:Math.round(blob.size/1024)}; });
  d=await D();
  const cr=await p.evaluate(async ([orig,CMP])=>{ eval(CMP); const r=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1,type:'png'}); const a=r.canvas.toDataURL('image/png'); r.canvas.width=0; return cmp(a,orig); }, [origPng,CMP]);
  const rtt=d.slides[0].els.find(e=>e.type==='text'&&/cresce/.test(e.html));
  check('S24-15: ida e volta (Editável S23 → importar): 8 elementos (2 textos, 3 formas, 2 linhas, 1 foto), negrito/cor mantidos, ≥ 96 % dos pixels iguais a ±40', d.slides[0].els.length===8 && rt.rep.count.texts===2 && rt.rep.count.shapes===3 && rt.rep.count.lines===2 && rt.rep.count.images===1 && !!rtt && rtt.font==='Roboto' && rtt.weight===300 && /(<b>|font-weight:[4-9]00[^>]*>)[^<]*cresce 18%/.test(rtt.html) && /color:#F78C16/.test(rtt.html) && cr.match>=96 && cr.mean<6, {n:d.slides[0].els.length, rep:rt.rep.count, cr, font:rtt&&[rtt.font,rtt.weight], html:rtt&&rtt.html.slice(0,300)});
  await p.screenshot({path:SH('roundtrip')});
  /* ---------- 4. PDF ---------- */
  const loc=lo(path.join(FX,'fx-c.pptx'));
  const rc=await importApi(p, loc.pdf, 'pdf');
  d=await D(); const pc=d.slides[0];
  const tit=pc.els.find(e=>/Programa de Formação/.test(e.html)), body=pc.els.find(e=>/Objetivo/.test(e.html)), cen=pc.els.find(e=>/Centralizado/.test(e.html));
  check('S24-16: PDF (LibreOffice) → 1 slide com fundo (página sem o texto) e 3 textos: título branco negrito 36 pt (48 px) sobre a faixa navy, corpo em 3 linhas cinza 20 pt, linha laranja centrada', d.slides.length===1 && !!pc.bgImg && !!tit && tit.color==='#FFFFFF' && tit.weight===700 && Math.abs(tit.size-48)<1.5 && !!body && body.color==='#3E4C5E' && (body.html.match(/<br>/g)||[]).length===2 && Math.abs(body.size-26.7)<1.5 && !!cen && cen.color==='#F78C16' && cen.align==='center' && rc.count.texts===3, {tit:tit&&[tit.x,tit.y,tit.size,tit.color,tit.weight,tit.font], body:body&&[body.x,body.y,body.size,body.color,body.lh], cen:cen&&[cen.x,cen.align,cen.color]});
  execFileSync('pdftoppm',['-r','96','-png','-f','1','-l','1',loc.pdf,path.join(TMP,'pdfc')]);
  const pdfcPng=fs.readdirSync(TMP).filter(f=>/^pdfc.*\.png$/.test(f)).map(f=>path.join(TMP,f))[0];
  const cc=await cmpSlide(p, 0, pdfcPng);
  check('S24-17: slide importado do PDF × pdftoppm da página: ≥ 94 % a ±40 (fundo idêntico; o texto muda só de fonte)', cc.match>=94 && cc.mean<7, cc);
  await p.screenshot({path:SH('pdf')});
  /* fundo sem o texto: ao apagar um texto, nada fica “impresso” atrás */
  const ghost=await p.evaluate(async()=>{ const s=AMStudio.deck.slides[0]; const keep=s.els; s.els=[]; const r=await AMExport.rasterSlide(s,{scale:1,type:'png'}); const d=r.canvas.getContext('2d').getImageData(0,0,1280,720).data; r.canvas.width=0; s.els=keep; let dark=0; for(let y=160;y<280;y+=2) for(let x=60;x<700;x+=2){ const i=(y*1280+x)*4; if(d[i]<120&&d[i+1]<120&&d[i+2]<120) dark++; } return dark; });
  check('S24-18: o fundo não traz o texto “impresso” (área do corpo sem pixels escuros depois de apagar os textos)', ghost<40, ghost);
  if(fs.existsSync(ONS)){
    const ro=await importApi(p, ONS, 'pdf'); d=await D();
    execFileSync('pdftoppm',['-r','96','-png','-f','1','-l','1',ONS,path.join(TMP,'ons')]);
    const onsPng=fs.readdirSync(TMP).filter(f=>/^ons.*\.png$/.test(f)).map(f=>path.join(TMP,f))[0];
    const co=await cmpSlide(p, 0, onsPng);
    check('S24-19: PDF real (24 páginas, confidencial — só lido): 24 slides, ≥ 250 textos, capa navy com título branco, página 1 ≥ 95 % a ±40', d.slides.length===24 && ro.count.texts>=250 && d.slides[0].bg==='#002A46' && d.slides[0].els.some(e=>e.color==='#FFFFFF'&&e.size>40) && co.match>=95, {n:d.slides.length, texts:ro.count.texts, bg:d.slides[0].bg, co, ms:ro.ms});
  } else check('S24-19: PDF real ausente neste ambiente — pulado', true);
  /* ---------- 5. interface: menu, caixa, substituir/adicionar, Ctrl+Z, relatório ---------- */
  await p.evaluate(()=>AMStudio.loadDeck(AMStudio.newDeck(),null)); await sleep(200);
  await p.click('#mbar button[data-m=file]'); await sleep(250);
  const items=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xm .xi, .xmenu .xi'),x=>({t:x.textContent.trim(),dis:x.classList.contains('dis')})));
  check('S24-20: Arquivo: “Início (capa)” primeiro, um só item com “abrir…”, “Importar PowerPoint ou PDF…” habilitado (sem “abrir” no nome)', items.length>3 && /^Início \(capa\)/.test(items[0].t) && items.filter(i=>/abrir…/i.test(i.t)).length===1 && items.some(i=>/^Importar PowerPoint ou PDF…/.test(i.t)&&!i.dis), items.map(i=>i.t).slice(0,6));
  await p.keyboard.press('Escape'); await sleep(150);
  await p.evaluate(()=>AMImport.pick()); await sleep(100);
  await p.setInputFiles('#fImport', path.join(FX,'fx-a.pptx')); await sleep(400);
  const dl1=await p.evaluate(()=>{ const d=document.getElementById('xmDlg'); return {open:d&&!d.hidden, title:document.getElementById('xmT').textContent, sum:document.getElementById('xmSum').textContent, mode:(document.querySelector('input[name=xmMode]:checked')||{}).value, go:document.getElementById('xmGo').disabled, focus:document.activeElement&&document.activeElement.id}; });
  check('S24-21: escolher o arquivo abre a caixa: nome e tamanho, “Substituir” marcado (apresentação em branco), Importar habilitado e com o foco', dl1.open && /Importar apresentação/.test(dl1.title) && /fx-a\.pptx/.test(dl1.sum) && dl1.mode==='replace' && !dl1.go && dl1.focus==='xmGo', dl1);
  await p.click('#xmGo'); await sleep(900);
  const rep1=await p.evaluate(()=>({rep:document.getElementById('xmRep').hidden, h4:(document.querySelector('#xmRep h4')||{}).textContent, chips:[].map.call(document.querySelectorAll('#xmRep .xm-ok li'),x=>x.textContent), warns:document.querySelectorAll('#xmRep .xm-warn li').length, go:document.getElementById('xmGo').textContent, cancel:document.getElementById('xmCancel').hidden, toast:document.getElementById('toast').textContent}));
  check('S24-22: relatório na caixa: “Apresentação importada”, chips (3 slides, textos, formas…), avisos (fontes, gráfico), botão “Concluir”', !rep1.rep && /Apresentação importada/.test(rep1.h4) && rep1.chips[0]==='3 slides' && rep1.chips.length>=6 && rep1.warns>=2 && rep1.go==='Concluir' && rep1.cancel && /Apresentação importada: 3 slides/.test(rep1.toast), rep1);
  await p.screenshot({path:SH('dialog-report')});
  await p.click('#xmGo'); await sleep(200);
  d=await D();
  check('S24-23: Concluir fecha; 3 slides; título da obra = título do arquivo (core.xml); miniatura do oculto marcada; painel mostra as anotações', await p.evaluate(()=>document.getElementById('xmDlg').hidden) && d.slides.length===3 && d.title==='Cobertura importação A' && await p.evaluate(()=>!!document.querySelector('#thumbs .th:nth-child(3).hid')) && await p.evaluate(()=>{ AMStudio.goSlide(0); return (document.querySelector('#props textarea[data-p="s.notes"]')||{}).value; })==='Abertura: falar da receita.\nSegunda linha das anotações.', {n:d.slides.length,title:d.title});
  /* fonte importada no painel */
  const fsel=await p.evaluate(()=>{ const A=AMStudio; const t=A.deck.slides[0].els.find(e=>e.type==='text'); A.select(t.id); const s=document.querySelector('#props select[data-p="font"]'); return s?{v:s.value, opt:[].map.call(s.options,o=>o.textContent).filter(t=>/^Calibri \((do arquivo importado|do computador|kit de marca)\)$/.test(t))}:null; });
  check('S24-24: painel: a fonte do arquivo (Calibri) aparece selecionada como “Calibri (kit de marca)” (S29: o tema importado vira o kit; fontes do computador saem como “do computador”, outras como “do arquivo importado”)', !!fsel && fsel.v==='Calibri' && fsel.opt.length===1, fsel);
  /* adicionar ao final + Ctrl+Z */
  await p.evaluate(()=>AMImport.pick()); await sleep(100); await p.setInputFiles('#fImport', path.join(FX,'fx-b.pptx')); await sleep(400);
  const dl2=await p.evaluate(()=>({mode:(document.querySelector('input[name=xmMode]:checked')||{}).value, app:document.getElementById('xmAppL').textContent, rep:document.getElementById('xmRepL').textContent}));
  check('S24-25: com uma apresentação aberta, “Adicionar ao final (3 slides)” vem marcado e “Substituir” avisa que Ctrl+Z não desfaz', dl2.mode==='append' && /\(3 slides\)/.test(dl2.app) && /Ctrl\+Z não desfaz/.test(dl2.rep), dl2);
  await p.click('#xmGo'); await sleep(900); await p.click('#xmGo'); await sleep(200);
  d=await D(); const cur=await p.evaluate(()=>AMStudio.cur);
  check('S24-26: 5 slides, o atual é o primeiro adicionado (4), título mantido', d.slides.length===5 && cur===3 && d.title==='Cobertura importação A' && /Título do projeto/.test(d.slides[3].els[0].html), {n:d.slides.length,cur});
  await p.click('#wrap'); await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await sleep(300); d=await D();
  check('S24-27: um Ctrl+Z tira os 2 slides adicionados', d.slides.length===3, d.slides.length);
  await p.keyboard.press('Control+y'); await sleep(300); d=await D();
  check('S24-28: Ctrl+Y traz os 2 de volta', d.slides.length===5, d.slides.length);
  /* ---------- 6. arrastar e soltar, recusas, Esc, cancelar ---------- */
  await p.evaluate(async b64=>{ const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const f=new File([u],'solto.pptx',{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}); const dt=new DataTransfer(); dt.items.add(f); const w=document.getElementById('wrap'); w.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt})); w.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); }, b64f(path.join(FX,'fx-a.pptx'))); await sleep(400);
  const dd=await p.evaluate(()=>({open:!document.getElementById('xmDlg').hidden, sum:document.getElementById('xmSum').textContent}));
  check('S24-29: soltar um .pptx no slide abre a caixa com o arquivo', dd.open && /solto\.pptx/.test(dd.sum), dd);
  await p.keyboard.press('Escape'); await sleep(200);
  check('S24-30: Esc fecha a caixa', await p.evaluate(()=>document.getElementById('xmDlg').hidden));
  const bad=await p.evaluate(async()=>{ const f=new File([new Uint8Array([1,2,3])],'antigo.ppt'); AMImport.open(f); await new Promise(r=>setTimeout(r,250)); const a={sum:document.getElementById('xmSum').textContent, go:document.getElementById('xmGo').disabled}; AMImport.close(); const g=new File(['oi'],'nota.txt'); AMImport.open(g); await new Promise(r=>setTimeout(r,250)); const b={sum:document.getElementById('xmSum').textContent, go:document.getElementById('xmGo').disabled}; AMImport.close(); return {a,b}; });
  check('S24-31: .ppt antigo e .txt são recusados com explicação e Importar desabilitado', /formato antigo/.test(bad.a.sum) && bad.a.go && /não é um PowerPoint/.test(bad.b.sum) && bad.b.go, bad);
  await p.evaluate(()=>{ AMImport.slowMs=60; AMImport.pick(); }); await sleep(100); await p.setInputFiles('#fImport', path.join(FX,'fx-big.pptx')); await sleep(400);
  await p.click('#xmGo'); await sleep(250);
  const busy=await p.evaluate(()=>({busy:document.getElementById('xmDlg').classList.contains('busy'), focus:document.activeElement&&document.activeElement.id}));
  await p.click('#xmCancel'); await sleep(150);
  const after=await p.evaluate(()=>({busy:document.getElementById('xmDlg').classList.contains('busy'), open:!document.getElementById('xmDlg').hidden, toast:document.getElementById('toast').textContent, n:AMStudio.deck.slides.length}));
  check('S24-32: cancelar no meio (40 slides): foco em “Cancelar importação”, cancela na hora, apresentação intacta (5 slides)', busy.busy && busy.focus==='xmCancel' && !after.busy && after.open && /Importação cancelada/.test(after.toast) && after.n===5, {busy,after});
  await sleep(1200); check('S24-33: a leitura atrasada não altera a apresentação', await p.evaluate(()=>AMStudio.deck.slides.length)===5);
  await p.evaluate(()=>{ AMImport.slowMs=0; }); await p.keyboard.press('Escape'); await sleep(150);
  /* ---------- 7. salvar e reabrir, exportar ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const sf=path.join(TMP,'importado.html'); fs.writeFileSync(sf,html);
  const q=await open(ctx,'file://'+sf,'exp'); const nq=await q.evaluate(()=>document.querySelectorAll('.amp .amp-slide').length); await q.close();
  const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const re=await p.evaluate(dk=>{ AMStudio.loadDeck(dk,'re'); return AMStudio.deck.slides.map(s=>s.els.length).join(); }, dk);
  check('S24-34: arquivo salvo abre o player com os 4 visíveis (oculto fora) e reabre no editor com os mesmos elementos; sem on* no export', nq===4 && re===d.slides.map(s=>s.els.length).join() && !/onerror|onmouseover|onclick/.test(html), {nq,re});
  const ex=await p.evaluate(async()=>{ const pdf=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); const pk=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); return {pdf:pdf.size, pptx:pk.size}; });
  check('S24-35: o importado exporta em PDF e em PowerPoint Editável', ex.pdf>30000 && ex.pptx>20000, ex);
  const pkF=path.join(TMP,'reexport.pptx'); fs.writeFileSync(pkF, Buffer.from(await p.evaluate(async()=>{ const pk=await AMExport.pptxBuild(AMStudio.deck,{range:'all',includeHidden:true,mode:'edit'}); const u=new Uint8Array(await pk.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pkF],{encoding:'utf8',maxBuffer:64<<20}));
  check('S24-36: o PowerPoint reexportado é válido (python-pptx abre 5 slides, 1 oculto, zip e XML íntegros)', insp.slides.length===5 && insp.slides.filter(s=>s.hidden).length===1 && insp.zipBad===null && insp.xmlBad.length===0 && insp.relBad.length===0, {n:insp.slides.length, bad:insp.xmlBad});
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
