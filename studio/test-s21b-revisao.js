/* S21b — correções da revisão adversarial de S21–S23 (ocultar/redefinir, PDF, PowerPoint).
   Cobre: caracteres de controle (U+000B do Shift+Enter do Office, U+0001, U+000C, surrogate solto) em textos — PDF, PowerPoint Idêntico e
   Editável saem mesmo assim e o U+000B vira quebra de linha; normalização em cleanHTML/loadDeck; id único do degradê do velocímetro na
   impressão; Ctrl+P abre “Salvar como PDF”; Ctrl+S com o menu ▾ aberto salva; cancelar a exportação vale na hora; Redefinir devolve
   campos de escolha do componente, a ordem da pilha e elementos apagados em slides sem layout; contadores com slides ocultos; slug;
   título da página na impressão; dicas do editor fora do PDF; camada de texto com símbolos; PowerPoint: título do slide (contorno),
   JPEG com EXIF girado assado, SVG em tamanho de tela, imagem que não carrega não derruba o Editável, só ocultos saem visíveis.
   Uso: python3 assemble.py && node test-s21b-revisao.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s21b-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s21b'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS=path.join(__dirname,'test-s23-tools.py');
const inspect=f=>JSON.parse(execFileSync('python3',[TOOLS,'inspect',f],{encoding:'utf8',maxBuffer:64<<20}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,1200):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){
  if(!fs.existsSync(path.join(FONTS,'gf.css'))){ await p.route('https://fonts.googleapis.com/**',r=>r.abort()); await p.route('https://fonts.gstatic.com/**',r=>r.abort()); return; }
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load|example\.invalid/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const PHOTO='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'test-foto.png')).toString('base64');
const SVG='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#F78C16"/><rect x="4" y="10" width="16" height="4" fill="#002A46"/></svg>').toString('base64');
const JPG=path.join(TMP,'exif6.jpg'); execFileSync('python3',[TOOLS,'mkjpeg',JPG]); const EXIFJPG='data:image/jpeg;base64,'+fs.readFileSync(JPG).toString('base64');
/* texto com caracteres que o XML não aceita: Shift+Enter do Office (U+000B), U+0001, quebra de página (U+000C) e um surrogate solto */
const BAD='Alpha\u000BBeta \u0001Gama\u000C Delta \uD83D meio';
const toast=async p=>p.evaluate(()=>{ const t=document.querySelector('#toast,.toast'); return t?t.textContent:''; });
async function saveBlob(p, expr, f){ const b64=await p.evaluate(async (ex)=>{ const b=await eval(ex); if(!b) return null; const buf=await b.arrayBuffer(); let s=''; const u=new Uint8Array(buf); for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return {b64:btoa(s), dropped:b.dropped|0}; }, expr); if(!b64) return null; fs.writeFileSync(f, Buffer.from(b64.b64,'base64')); return {size:fs.statSync(f).size, dropped:b64.dropped}; }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));

  /* ---------- 1. caracteres de controle: carregar, exportar PDF e PowerPoint ---------- */
  await p.evaluate(([PHOTO,BAD,SVG,EXIFJPG])=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Revisão Q3/2026 — Teste';
    const s1=mk.slide('blank-light'); s1.els=[];
    const t=mk.text('title'); Object.assign(t,{x:60,y:40,w:900,h:80}); t.html='Título da revisão'; s1.els.push(t);
    const bt=mk.text('body'); Object.assign(bt,{x:60,y:160,w:700,h:200}); bt.html=BAD+' − 5 ≠ 6 → fim'; s1.els.push(bt);
    const gg=mk.fx('gauge'); Object.assign(gg,{x:800,y:160,w:400,h:300}); s1.els.push(gg);
    const s2=mk.slide('blank-light'); s2.els=[];
    const t2=mk.text('title'); Object.assign(t2,{x:60,y:40,w:900,h:80}); t2.html='Fotos e logos'; s2.els.push(t2);
    const im=mk.image(EXIFJPG,200,300); Object.assign(im,{x:60,y:160,w:200,h:300,fit:'cover'}); s2.els.push(im);
    const sv=mk.image(SVG,24,24); Object.assign(sv,{x:320,y:160,w:400,h:400,fit:'contain'}); s2.els.push(sv);
    const bad=mk.image('https://example.invalid/nao-existe.png',400,300); Object.assign(bad,{x:760,y:160,w:400,h:300}); s2.els.push(bad);
    const s3=mk.slide('blank-light'); s3.els=[]; const t3=mk.text('title'); Object.assign(t3,{x:60,y:40,w:900,h:80}); t3.html='Terceiro slide'; s3.els.push(t3);
    d.slides=[s1,s2,s3]; A.loadDeck(d,'Deck revisão'); }, [PHOTO,BAD,SVG,EXIFJPG]);
  await sleep(500);
  let d=await D();
  const bh=d.slides[0].els[1].html;
  check('S21b-01: loadDeck normaliza o texto: U+000B vira <br>, U+0001/U+000C somem, surrogate solto vira U+FFFD', /Alpha<br>Beta Gama Delta � meio/.test(bh) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(bh), bh);
  check('S21b-02: campos do slide (resumo) também limpos', await p.evaluate(()=>{ const A=AMStudio; const d=JSON.parse(JSON.stringify(A.deck)); d.slides[0].notes='linha 1\u000Blinha 2\u0001'; A.loadDeck(d,'x'); return A.deck.slides[0].notes; })==='linha 1\nlinha 2');
  /* o texto cru com os caracteres entra de novo direto no palco (como uma colagem que escapou da limpeza): o motor de imagem ainda desenha */
  await p.evaluate((BAD)=>{ AMStudio.deck.slides[0].els[1].html=BAD+' − 5 ≠ 6 → fim'; AMStudio.renderAll(); }, BAD); await sleep(300);
  const r1=await p.evaluate(()=>AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1}).then(r=>({w:r.width,h:r.height,ok:!!r.blob&&r.blob.size>1000,txt:r.texts.map(t=>t.t).join(' | ')})).catch(e=>({err:e.message})));
  check('S21b-03: rasterSlide desenha o slide com caracteres de controle no texto (antes: “Não foi possível desenhar o slide”)', r1.ok&&r1.w===1280, r1);
  const pdfF=path.join(TMP,'bad.pdf'); const pr=await saveBlob(p,'AMExport.pdf(AMStudio.deck,{range:"all",scale:1})',pdfF);
  check('S21b-04: PDF direto sai com o texto “sujo” (3 páginas)', pr&&pr.size>20000, pr);
  let pinfo='', ptxt=''; try{ pinfo=execFileSync('pdfinfo',[pdfF],{encoding:'utf8'}); ptxt=execFileSync('pdftotext',['-layout',pdfF,'-'],{encoding:'utf8'}); }catch(e){ pinfo='ERR '+e.message; }
  check('S21b-05: pdfinfo: 3 páginas, título da obra', /Pages:\s+3/.test(pinfo) && /Revisão Q3\/2026/.test(pinfo), pinfo.split('\n').slice(0,3));
  check('S21b-06: camada de texto: Alpha e Beta separados (U+000B = espaço), “− 5” vira “- 5”, “≠” vira “!=”, “→” vira “->”', /Alpha\s+Beta/.test(ptxt) && /- 5 != 6 -> fim/.test(ptxt), ptxt.replace(/\s+/g,' ').slice(0,300));
  const pkI=path.join(TMP,'bad-identico.pptx'); const ri=await saveBlob(p,'AMExport.pptxBuild(AMStudio.deck,{range:"all",mode:"image"})',pkI);
  check('S21b-07: PowerPoint Idêntico sai com o texto “sujo”', ri&&ri.size>20000, ri);
  const pkE=path.join(TMP,'bad-editavel.pptx'); const re=await saveBlob(p,'AMExport.pptxBuild(AMStudio.deck,{range:"all",mode:"edit"})',pkE);
  check('S21b-08: PowerPoint Editável sai com o texto “sujo” e com a imagem que não carrega (dropped=1)', re&&re.size>5000&&re.dropped===1, re);
  const ie=inspect(pkE), ii=inspect(pkI);
  check('S21b-09: pacotes válidos (zip, XML bem formado, relações)', ie.zipBad===null&&ie.xmlBad.length===0&&ie.relBad.length===0&&ii.zipBad===null&&ii.xmlBad.length===0&&ii.relBad.length===0, {e:[ie.xmlBad,ie.relBad], i:[ii.xmlBad,ii.relBad]});
  const badSp=ie.slides[0].shapes.find(s=>s.text&&/Alpha/.test(s.text));
  check('S21b-10: Editável: U+000B vira quebra de linha (Alpha / Beta em parágrafos separados), sem caracteres de controle', !!badSp && badSp.paras>=2 && /^Alpha$/m.test(badSp.text) && /Beta/.test(badSp.text) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(badSp.text), badSp&&{paras:badSp.paras,text:badSp.text});
  /* ---------- 2. título do slide no PowerPoint ---------- */
  check('S21b-11: Editável: o texto-título do slide é o espaço reservado de título (contorno do PowerPoint); um só por slide', ie.slides.every(s=>s.shapes.filter(x=>x.ph==='title').length===1) && ie.slides[0].title==='Título da revisão' && ie.slides[1].title==='Fotos e logos', ie.slides.map(s=>s.title));
  check('S21b-12: Idêntico: título atrás da imagem (imagem por cima, slide continua idêntico)', ii.slides.every(s=>s.title&&s.shapes[0].ph==='title'&&s.shapes[1].tag==='pic'), ii.slides.map(s=>[s.title,s.shapes.map(x=>x.tag)]));
  /* ---------- 3. imagens: EXIF, SVG, sem CORS ---------- */
  const pics=ie.slides[1].shapes.filter(s=>s.tag==='pic');
  const jp=pics.find(s=>s.img==='image/jpeg'), sv=pics.find(s=>s.img==='image/png');
  check('S21b-13: JPEG com EXIF 6 entra “assado”: sem tag de orientação e com largura < altura (300×200 girado → 200×300)', !!jp && jp.exifOrient===1 && jp.px && jp.px[0]<jp.px[1], jp&&{px:jp.px,o:jp.exifOrient});
  check('S21b-14: SVG de 24 px rasterizado no tamanho em que aparece (≥ 800 px, 2× de 400)', !!sv && sv.px && sv.px[0]>=800 && sv.px[0]<=4096, sv&&sv.px);
  check('S21b-15: a imagem http que não carrega fica de fora (2 fotos no slide), sem derrubar o arquivo', pics.length===2, pics.length);
  check('S21b-16: jpegOrient lê a tag (6) e devolve 1 para PNG', await p.evaluate((EX)=>{ const b=atob(EX.split(',')[1]); const u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return AMExport.jpegOrient(u)===6 && AMExport.jpegOrient(new Uint8Array([137,80,78,71]))===1; }, EXIFJPG));
  /* ---------- 4. só ocultos → saem visíveis ---------- */
  await p.evaluate(()=>{ AMStudio.toggleHidden(1); });
  const pkH=path.join(TMP,'oculto.pptx'); await saveBlob(p,'AMExport.pptxBuild(AMStudio.deck,{range:"cur",cur:1,mode:"image"})',pkH);
  const ih=inspect(pkH);
  check('S21b-17: “Slide atual” num slide oculto: o único slide do arquivo sai visível (senão a apresentação do PowerPoint ficaria vazia)', ih.slides.length===1 && ih.slides[0].hidden===false, ih.slides);
  const pkH2=path.join(TMP,'oculto2.pptx'); await saveBlob(p,'AMExport.pptxBuild(AMStudio.deck,{range:"all",includeHidden:true,mode:"image"})',pkH2);
  check('S21b-18: com outros visíveis, o oculto continua oculto no arquivo', inspect(pkH2).slides.map(s=>s.hidden).join()==='false,true,false');
  /* ---------- 5. contadores com slide oculto ---------- */
  await p.evaluate(()=>AMStudio.goSlide(1)); await sleep(300);
  const hdr=await p.evaluate(()=>({small:(document.querySelector('#props .ph small')||{}).textContent, pos:document.getElementById('sidePos').className, title:document.getElementById('sidePos').title}));
  check('S21b-19: painel diz “3 slides · 2 na apresentação”; posição do painel recolhido marca o oculto', /3 slides · 2 na apresentação/.test(hdr.small) && /\bhid\b/.test(hdr.pos) && /oculto/.test(hdr.title), hdr);
  await p.evaluate(()=>AMStudio.goSlide(2)); await sleep(200);
  const an=await p.evaluate(()=>{ const A=AMStudio; const b=document.querySelector('#props [data-act=autonotes]'); b.click(); return A.deck.slides[2].notes; });
  check('S21b-20: resumo automático conta só os slides visíveis (slide 2 de 2, não 3 de 3)', /slide 2 de 2/.test(an) && !/3 de 3/.test(an), an);
  await p.evaluate(()=>{ AMStudio.toggleHidden(1); }); await sleep(200);
  /* ---------- 6. Ctrl+P, Ctrl+S com o menu ▾ aberto, cancelar na hora ---------- */
  await p.click('#wrap'); await p.keyboard.press('Escape'); await p.keyboard.press('Control+p'); await sleep(400);
  const dp=await p.evaluate(()=>{ const d=document.getElementById('xpDlg'); return d&&!d.hidden ? {mode:d.dataset.mode, t:document.getElementById('xpT').textContent} : null; });
  check('S21b-21: Ctrl+P abre “Salvar como PDF” (não a impressão do editor)', !!dp && dp.mode==='pdf' && /Salvar como PDF/.test(dp.t), dp);
  await p.keyboard.press('Escape'); await sleep(300);
  await p.click('#bSaveMore'); await sleep(300);
  const dl=p.waitForEvent('download',{timeout:5000}).then(d=>d.suggestedFilename()).catch(()=>null);
  await p.keyboard.press('Control+s'); const fn=await dl;
  check('S21b-22: Ctrl+S com o menu ▾ aberto fecha o menu e salva o .html (nome com o slug “revisao-q3-2026-teste.html”)', fn==='revisao-q3-2026-teste.html' && await p.evaluate(()=>!document.querySelector('.xmenu,.xm')||!document.querySelector('#bSaveMore.open')), fn);
  check('S21b-23: slug: pontuação vira separador (“Q3/2026” → “q3-2026”), limite de 80', await p.evaluate(()=>AMStudio.slug('Q3/2026 Plano: fase_2 — “x”')==='q3-2026-plano-fase-2-x' && AMStudio.slug('a'.repeat(120)).length===80));
  /* cancelar: deck grande, abre a caixa, Exportar, cancela no meio */
  await p.evaluate(()=>{ const A=AMStudio; const d=JSON.parse(JSON.stringify(A.deck)); for(let i=0;i<30;i++){ const s=JSON.parse(JSON.stringify(d.slides[0])); s.id='c'+i; s.els.forEach((e,j)=>e.id='c'+i+'_'+j); d.slides.push(s);} A.loadDeck(d,'grande'); });
  await sleep(300); await p.keyboard.press('Control+p'); await sleep(300); await p.click('#xpGo'); await sleep(900);
  const busy0=await p.evaluate(()=>({busy:document.getElementById('xpDlg').classList.contains('busy'), focus:document.activeElement&&document.activeElement.id}));
  await p.click('#xpCancel'); await sleep(150);
  const busy1=await p.evaluate(()=>({busy:document.getElementById('xpDlg').classList.contains('busy'), open:!document.getElementById('xpDlg').hidden, go:document.getElementById('xpGo').disabled, focus:document.activeElement&&document.activeElement.id}));
  check('S21b-24: durante a exportação o foco está em “Cancelar exportação”; Cancelar vale na hora (caixa livre em < 150 ms, Exportar de volta, foco nele)', busy0.busy && busy0.focus==='xpCancel' && !busy1.busy && busy1.open && !busy1.go && busy1.focus==='xpGo', {busy0,busy1});
  check('S21b-25: aviso “Exportação cancelada”', /Exportação cancelada/.test(await toast(p)));
  await sleep(1500); const late=await p.evaluate(()=>({busy:document.getElementById('xpDlg').classList.contains('busy'), open:!document.getElementById('xpDlg').hidden}));
  check('S21b-26: a promessa atrasada não reabre o estado ocupado nem baixa nada', !late.busy && late.open, late);
  await p.keyboard.press('Escape'); await sleep(200);
  /* ---------- 7. impressão: título, id do velocímetro, dicas do editor ---------- */
  await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Impressão teste'; const s=mk.slide('blank-light'); s.els=[]; const g=mk.fx('gauge'); Object.assign(g,{x:100,y:100,w:500,h:400}); s.els.push(g); const sm=mk.fx('smart'); Object.assign(sm,{x:650,y:100,w:560,h:400}); sm.data.items=''; sm.data.outline=''; s.els.push(sm); d.slides=[s]; A.loadDeck(d,'imp'); });
  await sleep(400);
  const pp=await p.evaluate(()=>{ const t0=document.title; const pr=AMExport.preparePrint(AMStudio.deck,{range:'all'}); const ids={}; document.querySelectorAll('linearGradient[id]').forEach(g=>{ ids[g.id]=(ids[g.id]||0)+1; }); const dup=Object.keys(ids).filter(k=>ids[k]>1); const arc=document.querySelector('#amPrint .gg-arc'); const ref=arc&&/url\(#([^)]+)\)/.exec(arc.getAttribute('stroke')); const hint=document.querySelector('#amPrint .sa-empty'); const hv=hint?getComputedStyle(hint).display:'none'; const edit=!!document.querySelector('#amPrint .am-stage.am-edit'); const t1=document.title; pr.cleanup(); return {t0,t1,t2:document.title,dup,refOk:!!(ref&&ids[ref[1]]===1),hv,edit,count:pr.count}; });
  check('S21b-27: impressão: título da página = título da obra (e volta ao fechar); degradê do velocímetro com id único (o arco aparece)', pp.t1==='Impressão teste' && pp.t2===pp.t0 && pp.dup.length===0 && pp.refOk && pp.count===1, pp);
  check('S21b-28: dicas só do editor (SmartArt vazio) não saem na impressão nem no PDF', pp.hv==='none' && !pp.edit, pp);
  const r2=await p.evaluate(()=>{ const st0=document.getElementById('amxHost'); return AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1}).then(r=>{ return {ok:r.blob.size>1000}; }); });
  check('S21b-29: rasterSlide com o SmartArt vazio desenha (palco sem .am-edit)', r2.ok, r2);
  /* ---------- 8. Redefinir: campos de escolha, ordem da pilha, apagados num slide sem layout ---------- */
  await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Redefinir';
    const s=mk.slide('blank-light'); s.els=[]; const t=mk.text('title'); Object.assign(t,{x:60,y:40,w:900,h:80}); t.html='Título'; s.els.push(t);
    const h=mk.fx('headline'); Object.assign(h,{x:60,y:200,w:800,h:160}); s.els.push(h);
    const g=mk.fx('gauge'); Object.assign(g,{x:900,y:200,w:300,h:260}); s.els.push(g);
    const r=mk.shape('rect'); Object.assign(r,{x:60,y:420,w:300,h:120}); s.els.push(r);
    delete s.layout; delete s.base; d.slides=[s]; A.loadDeck(d,'rd'); });
  await sleep(300);
  d=await D(); const s0=d.slides[0];
  check('S21b-30: slide sem layout ganha base com cópia (tpl) dos elementos ao abrir; a cópia passa pelo safeDeck', !!s0.base && !!s0.base.tpl && Object.keys(s0.base.tpl).length===4 && s0.els.every((e,i)=>e.ph==='p'+i), s0.base&&Object.keys(s0.base.tpl||{}));
  const hl=s0.els[1], gg=s0.els[2];
  const hlFields=await p.evaluate(k=>AMRT.FX[k].fields.filter(f=>typeof f[2]==='string'&&f[2].indexOf('sel')===0).map(f=>[f[0],f[2].slice(4).split('|').map(o=>o.split('=')[0])]), 'headline');
  const selField=hlFields[0];
  const ggField=await p.evaluate(()=>AMRT.FX.gauge.fields.find(f=>f[0]==='kind'));
  const snap=s0.base.els.p1;
  check('S21b-31: a base guarda os campos de escolha (sel:) do componente — cor (#), fonte e peso (número) do título de impacto — e o tipo do elemento', !!snap.dsel && snap.dsel.color==='#002A46' && snap.dsel.font==='Roboto' && snap.dsel.weight===300 && !!selField && snap.t==='fx:headline' && !!s0.base.els.p2.dsel, {dsel:snap.dsel,t:snap.t,g:s0.base.els.p2.dsel});
  /* muda o campo de escolha, o tipo do velocímetro, a pilha (texto p0 ao topo) e apaga a forma p3 */
  await p.evaluate(([f,v])=>{ const A=AMStudio, s=A.deck.slides[0]; s.els[1].data[f]=v; s.els[2].data.kind='thermo'; const t=s.els.shift(); s.els.push(t); s.els=s.els.filter(e=>e.ph!=='p3'); A.renderAll(); A.commit(); }, [selField[0], selField[1].find(o=>o!==hl.data[selField[0]])||selField[1][1]]);
  await sleep(200); await p.evaluate(()=>AMStudio.resetSlide(0)); await sleep(400);
  d=await D(); const s1=d.slides[0];
  check('S21b-32: Redefinir devolve o campo de escolha do título de impacto e o formato do velocímetro', s1.els.find(e=>e.ph==='p1').data[selField[0]]===(hl.data[selField[0]]||s1.base.els.p1.dsel[selField[0]]) && s1.els.find(e=>e.ph==='p2').data.kind===(gg.data.kind||'gauge'), {h:s1.els.find(e=>e.ph==='p1').data[selField[0]], g:s1.els.find(e=>e.ph==='p2').data.kind});
  check('S21b-33: Redefinir volta a ordem da pilha (p0 p1 p2 p3) e traz a forma apagada da cópia guardada', s1.els.map(e=>e.ph).join()==='p0,p1,p2,p3' && s1.els[3].type==='shape', s1.els.map(e=>e.ph+':'+e.type));
  check('S21b-34: aviso diz que 1 elemento apagado voltou', /1 elemento apagado voltou/.test(await toast(p)), await toast(p));
  await p.keyboard.press('Control+z'); await sleep(300); d=await D();
  check('S21b-35: um Ctrl+Z desfaz o Redefinir inteiro (3 elementos, texto no topo)', d.slides[0].els.length===3 && d.slides[0].els[2].type==='text', d.slides[0].els.map(e=>e.ph));
  /* foto apagada não volta: aviso honesto */
  await p.evaluate(([PHOTO])=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); const s=mk.slide('blank-light'); s.els=[]; const im=mk.image(PHOTO,800,600); Object.assign(im,{x:60,y:60,w:400,h:300}); s.els.push(im); const t=mk.text('body'); Object.assign(t,{x:500,y:60,w:400,h:100}); t.html='x'; s.els.push(t); delete s.layout; delete s.base; d.slides=[s]; A.loadDeck(d,'rd2'); }, [PHOTO]);
  await sleep(300); await p.evaluate(()=>{ const A=AMStudio; A.deck.slides[0].els=A.deck.slides[0].els.filter(e=>e.type!=='image'); A.renderAll(); A.commit(); A.resetSlide(0); }); await sleep(300);
  check('S21b-36: foto apagada num slide sem layout: Redefinir avisa que ela não volta (use Ctrl+Z) e não inventa sucesso', /1 foto apagada não volta/.test(await toast(p)) && (await D()).slides[0].els.length===1, await toast(p));
  /* ---------- 9. round-trip: salvar e reabrir mantém base.tpl e dsel ---------- */
  const html=await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); const s=mk.slide('blank-light'); s.els=[]; const h=mk.fx('headline'); Object.assign(h,{x:60,y:200,w:800,h:160}); s.els.push(h); delete s.layout; delete s.base; d.slides=[s]; A.loadDeck(d,'rt'); return A.exportHTML(); });
  const m=/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html); const dk=JSON.parse(m[1]);
  check('S21b-37: o arquivo salvo leva base.tpl e dsel; sem on* no export', !!(dk.slides[0].base&&dk.slides[0].base.tpl&&dk.slides[0].base.tpl.p0&&dk.slides[0].base.els.p0.dsel) && !/onerror|onmouseover|onclick/.test(html));
  const dk2=await p.evaluate(dk=>{ AMStudio.loadDeck(dk,'re'); return JSON.parse(JSON.stringify(AMStudio.deck.slides[0].base)); }, dk);
  check('S21b-38: reabrir mantém a cópia e os campos de escolha (validados)', !!(dk2.tpl&&dk2.tpl.p0&&dk2.tpl.p0.type==='fx'&&dk2.els.p0.dsel), dk2.els.p0);
  /* base hostil: tpl com imagem, chave estranha, dsel inválido → descartados */
  const hostile=await p.evaluate(()=>{ const A=AMStudio; const d=JSON.parse(JSON.stringify(A.deck)); const s=d.slides[0]; s.base.tpl.p0={type:'image',src:'javascript:alert(1)',x:0,y:0,w:10,h:10}; s.base.tpl['__proto__']={type:'text'}; s.base.tpl.p9={type:'text',html:'<b>x</b>'}; s.base.els.p0.dsel={font:'<img>', ok:'roboto'}; A.loadDeck(d,'h'); const b=A.deck.slides[0].base; return {tpl:Object.keys(b.tpl||{}), dsel:b.els.p0.dsel}; });
  check('S21b-39: base hostil: cópia de imagem, chave sem elemento e dsel inválido descartados', hostile.tpl.length===0 && hostile.dsel && hostile.dsel.ok==='roboto' && !hostile.dsel.font, hostile);
  /* base antiga (sem dsel) não apaga as escolhas feitas depois */
  const oldb=await p.evaluate(()=>{ const A=AMStudio; const d=JSON.parse(JSON.stringify(A.deck)); delete d.slides[0].base.els.p0.dsel; d.slides[0].els[0].data.color='#FFFFFF'; A.loadDeck(d,'old'); A.resetSlide(0); return {dsel:A.deck.slides[0].base.els.p0.dsel, color:A.deck.slides[0].els[0].data.color}; });
  check('S21b-40: base de versão anterior (sem dsel): Redefinir mantém as escolhas atuais em vez de apagar', oldb.dsel===undefined && oldb.color==='#FFFFFF', oldb);
  await p.screenshot({path:SH('fim')});
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
