/* test-s00: Fundação (F0). Campos novos sobrevivem a abrir / rascunho / colar / exportar-reabrir; o player ignora teclas
   digitadas em campos e contentEditable; extensões rt-* vão no arquivo exportado e ed-* ficam só no editor.
   Uso: python3 assemble.py && node test-s00.js   (o qa-gate.sh pega qualquer test-s[0-9][0-9]*.js) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const cp=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s00-'+f+'.png');
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
const deckJSON=html=>{ const m=html.match(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/); return m?JSON.parse(m[1]):null; };

/* assinatura dos campos da fundação (sem ids de slide/elemento, que mudam ao colar) */
const SIG=`d=>{ const pk=(o,ks)=>{const r={}; ks.forEach(k=>{ if(o&&o[k]!==undefined) r[k]=o[k]; }); return r; };
  const EL=['curve','bend','headS','headE','dashS','dash','headStart','headEnd','look'], DT=['name','trig','accent','bg','stroke','pair','layout','mode','sort'];
  const sl=s=>Object.assign(pk(s,['notes','sec','secSub','title','kind']),{els:s.els.map(e=>Object.assign({type:e.type,anim:e.anim},pk(e,EL),e.data?{data:pk(e.data,DT)}:{}))});
  return {deck:pk(d,['id','title','nav','created','updated','comments']), slides:d.slides.map(sl)}; }`;
const sig=(p,expr)=>p.evaluate(`(${SIG})(${expr})`);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sortK=o=>Object.keys(o||{}).sort().reduce((r,k)=>(r[k]=o[k],r),{});

(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  await ctx.grantPermissions(['clipboard-read','clipboard-write']);
  const p=await open(ctx, FILE+'?nocover', 'ed');

  /* ---------- 1. id estável da apresentação ---------- */
  const ids=await p.evaluate(()=>{ const S=AMStudio, a=S.newDeck(), b2=S.newDeck(), d0=S.deck.id;
    const t=AMCover.buildTemplate(0), t2=AMCover.buildTemplate(0);
    const old=S.newDeck(); delete old.id; S.loadDeck(old); const assigned=S.deck.id;
    const keep=S.newDeck(); keep.id='deck-mantido'; S.loadDeck(keep);
    return {d0, a:a.id, b:b2.id, t:t.id, t2:t2.id, assigned, kept:S.deck.id}; });
  const RX=/^[\w-]{1,40}$/;
  check('S00-01: apresentação inicial e newDeck() têm id válido e único', RX.test(ids.d0)&&RX.test(ids.a)&&ids.a!==ids.b&&ids.a!==ids.d0, ids);
  check('S00-02: cada projeto pronto (capa) ganha id próprio', RX.test(ids.t)&&ids.t!==ids.t2, ids);
  check('S00-03: abrir apresentação sem id atribui um; com id, mantém', RX.test(ids.assigned)&&ids.kept==='deck-mantido', ids);

  /* ---------- 2. deck com todos os campos novos (válidos e inválidos) ---------- */
  await p.evaluate(()=>{ const S=AMStudio, d=S.newDeck(), s0=S.mk.slide('blank-light'), s1=S.mk.slide('blank-dark');
    d.id='deck-s00'; d.title='Fundação S00'; d.nav={chapters:false}; d.created=1700000000000; d.updated=1700000500000;
    Object.assign(s0,{notes:'Resumo com <b>marcação</b>, & “aspas” e </script><i id="s00x">fuga</i>', sec:'Contexto', secSub:'Onde estamos', title:'Título no índice', kind:'section'});
    Object.assign(s1,{title:'T'.repeat(300), kind:'capitulo', sec:42, notes:''});
    const t1=S.mk.text('body',{x:60,y:60,w:400,h:80,html:'Camadas válidas',anim:{in:'rise',delay:100,dur:700,spd:1.5,rep:3,step:2,emph:'beat',emphAt:1,rest:2,lift:3,glow:2,gcol:'s',sweep:5,depth:1}});
    const t2=S.mk.text('body',{x:60,y:160,w:400,h:80,html:'Camadas inválidas',anim:{in:'fade',spd:9,rep:2,step:42,emph:'boom',rest:7,glow:'x',gcol:'red',sweep:7,depth:5,lift:0}});
    const l1=Object.assign(S.mk.line(true),{x1:600,y1:100,x2:900,y2:220,curve:'elbow',bend:.3,headS:'dot',headE:'diamond',dashS:'dashdot',dash:true,headStart:true});
    const l2=Object.assign(S.mk.line(false),{x1:600,y1:300,x2:900,y2:300,curve:'zigzag',bend:5,headE:'<b>',dashS:'wavy',headS:'arrow'});
    const r1=Object.assign(S.mk.shape('rect'),{x:60,y:300,w:300,h:120,look:'accent'}), r2=Object.assign(S.mk.shape('round'),{x:400,y:420,w:300,h:120,look:'neon'});
    const f1=S.mk.fx('counter',{x:60,y:460,w:380,h:210}), f2=S.mk.fx('counter',{x:860,y:460,w:380,h:210});
    Object.assign(f1.data,{name:'target',trig:'in-hover',accent:'#F78C16',bg:'soft',stroke:1.85,layout:'cycle',mode:'pct',sort:'desc',pair:'up-down'});
    Object.assign(f2.data,{name:'"><img src=x>',trig:'a"b',bg:'url(x)',layout:'<i>'});
    s0.els=[t1,t2,l1,l2,r1,r2,f1,f2];
    d.slides=[s0,s1];
    d.comments=[{id:'c1',text:'Revisar o número do slide 2',author:'Ana Souza',slide:s0.id,x:100,y:200,ts:1700000001000},{text:'   '},
      {id:'bad id!',text:'Comentário <b>sem</b> id válido',x:5000,y:-30,ts:'x'},{id:'c3',text:'Resolvido',done:1,author:'Zé'}];
    window.__s00src=JSON.parse(JSON.stringify(d));
    S.loadDeck(d); });
  const A=await sig(p,'AMStudio.deck');
  const s0=A.slides[0], s1=A.slides[1], E=s0.els;
  check('S00-04: deck mantém id, nav, created/updated', A.deck.id==='deck-s00'&&same(A.deck.nav,{chapters:false})&&A.deck.created===1700000000000&&A.deck.updated===1700000500000, A.deck);
  const cm=A.deck.comments||[];
  check('S00-05: comentários válidos ficam, vazio sai, id ruim é trocado, posição limitada ao slide', cm.length===3&&cm[0].id==='c1'&&cm[0].author==='Ana Souza'&&cm[0].x===100&&RX.test(cm[1].id)&&cm[1].id!=='bad id!'&&cm[1].x===1280&&cm[1].y===0&&isFinite(cm[1].ts)&&cm[2].done===true, cm);
  check('S00-06: slide mantém notes, sec, secSub, title e kind=section', String(s0.notes).indexOf('<b>marcação</b>')>0&&s0.sec==='Contexto'&&s0.secSub==='Onde estamos'&&s0.title==='Título no índice'&&s0.kind==='section', s0);
  check('S00-07: título do slide cortado em 160, kind desconhecido e sec não-texto descartados', String(s1.title).length===160&&s1.kind===undefined&&s1.sec===undefined&&s1.notes===undefined, s1);
  check('S00-08: anim.* novos (spd rep step emph emphAt rest lift glow gcol sweep depth) preservados', same(sortK(E[0].anim),sortK({in:'rise',delay:100,dur:700,spd:1.5,rep:3,step:2,emph:'beat',emphAt:1,rest:2,lift:3,glow:2,gcol:'s',sweep:5,depth:1})), E[0].anim);
  const a2=E[1].anim;
  check('S00-09: anim.* fora da lista volta ao padrão ou sai', a2.spd===1&&a2.rep===0&&a2.step===9&&a2.emph===undefined&&a2.rest===0&&a2.glow===0&&a2.gcol===undefined&&a2.sweep===0&&a2.depth===0&&a2.lift===2, a2);
  check('S00-10: linha mantém curve, bend, headS, headE, dashS', E[2].curve==='elbow'&&E[2].bend===.3&&E[2].headS==='dot'&&E[2].headE==='diamond'&&E[2].dashS==='dashdot'&&E[2].dash===true&&E[2].headStart===true, E[2]);
  check('S00-11: linha com tokens inválidos: descartados; bend limitado a 0,95', E[3].curve===undefined&&E[3].bend===.95&&E[3].headE===undefined&&E[3].dashS===undefined&&E[3].headS==='arrow', E[3]);
  check('S00-12: estilo de card (look) válido fica, inválido sai', E[4].look==='accent'&&E[5].look===undefined, [E[4].look,E[5].look]);
  check('S00-13: dados de ícone (name trig accent bg stroke …) válidos ficam', same(sortK(E[6].data),sortK({name:'target',trig:'in-hover',accent:'#F78C16',bg:'soft',stroke:1.85,pair:'up-down',layout:'cycle',mode:'pct',sort:'desc'})), E[6].data);
  check('S00-14: dados de ícone com marcação ou aspas são descartados', same(E[7].data,{}), E[7].data);
  const scanned=await p.evaluate(()=>!document.querySelector('#s00x')&&!document.querySelector('img[src="x"]'));
  check('S00-15: nada dos textos novos vira marcação no editor', scanned);

  /* ---------- 3. exportar → JSON do arquivo, reabrir no editor, abrir o player ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const fx=path.join(__dirname,'saved-s00.html'); fs.writeFileSync(fx,html);
  const J=deckJSON(html);
  check('S00-16: export mantém id="am-deck-data" e o JSON traz os campos novos', !!J&&same(await sig(p,JSON.stringify(J)),A));
  check('S00-17: export sem on* (CR-04) e sem código do editor/capa', !/onerror|onmouseover|onclick/.test(html)&&!/window\.AMStudio\s*=|id="am-cover|id="cover"|AMCover/.test(html));
  await p.setInputFiles('#fOpen',fx); await sleep(700);
  check('S00-18: reabrir o arquivo salvo preserva todos os campos', same(await sig(p,'AMStudio.deck'),A), await sig(p,'AMStudio.deck'));

  /* ---------- 4. rascunho (banner "Continuar rascunho") ---------- */
  await p.evaluate(()=>{ AMStudio.deck.title='Fundação S00'; AMStudio.deck.slides[1].bg='#13315C'; AMStudio.renderAll(); AMStudio.commit(); }); await sleep(1000);
  const A2=await sig(p,'AMStudio.deck');
  const r=await open(ctx, FILE+'?nocover', 'draft', 900);
  const banner=await r.evaluate(()=>document.getElementById('banner').classList.contains('open'));
  if(banner){ await r.click('#bDraftYes'); await sleep(500); }
  check('S00-19: rascunho recuperado preserva todos os campos (inclusive id)', banner&&same(await sig(r,'AMStudio.deck'),A2), {banner});
  await r.close();

  /* ---------- 5. colar slide (miniatura) e colar elementos ---------- */
  await p.click('#thumbs .th[data-i="0"] .box'); await sleep(150);
  await p.keyboard.press('Control+c'); await sleep(200); await p.keyboard.press('Control+v'); await sleep(400);
  const P=await sig(p,'AMStudio.deck'), pasted=await p.evaluate(()=>{ const d=AMStudio.deck; return {n:d.slides.length, newId:d.slides[1].id!==d.slides[0].id}; });
  check('S00-20: slide colado mantém notes/sec/title/kind, anim.* e campos de linha/ícone', pasted.n===3&&pasted.newId&&same(P.slides[1],A2.slides[0]), {pasted, got:P.slides[1]});
  await p.evaluate(()=>{ AMStudio.goSlide(0); const e=AMStudio.deck.slides[0].els; AMStudio.selectMany([e[0].id,e[2].id,e[6].id]); if(document.activeElement) document.activeElement.blur(); }); await sleep(150);
  await p.keyboard.press('Control+c'); await sleep(200); await p.keyboard.press('Control+v'); await sleep(400);
  const pe=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els, n=e.length; return {n, a:[e[0],e[2],e[6]].map(x=>JSON.stringify([x.anim,x.curve,x.bend,x.headS,x.headE,x.dashS,x.data&&x.data.name])), b:e.slice(n-3).map(x=>JSON.stringify([x.anim,x.curve,x.bend,x.headS,x.headE,x.dashS,x.data&&x.data.name]))}; });
  check('S00-21: elementos colados mantêm anim.*, campos de linha e dados de ícone', pe.n===11&&same(pe.a,pe.b), pe);
  await p.keyboard.press('Control+z'); await sleep(150); await p.keyboard.press('Control+z'); await sleep(150);

  /* ---------- 6. arquivo exportado: player ignora teclas em campos e contentEditable ---------- */
  const q=await open(ctx,'file://'+fx,'exp',1400);
  const ex=await q.evaluate(()=>({slides:document.querySelectorAll('.amp-slide').length, ed:typeof window.AMStudio, util:Object.keys(AMRT.util||{}), hooks:Array.isArray(AMRT.hooks&&AMRT.hooks.player), fuga:!!document.getElementById('s00x'), pos:document.querySelector('.amp-pos').textContent}));
  check('S00-22: arquivo exportado abre só o player, com AMRT.util e AMRT.hooks', ex.slides===2&&ex.ed==='undefined'&&['E','arr','VV','num','fmt','fmtN','CQ','P','lines','textHTML','esc','nid'].every(k=>ex.util.includes(k))&&ex.hooks&&/^01/.test(ex.pos), ex);
  check('S00-23: notas com </script> não escapam do JSON do arquivo', !ex.fuga);
  await q.evaluate(()=>{ const d=document.createElement('div'); d.id='s00ce'; d.contentEditable='true'; d.style.cssText='position:fixed;left:12px;top:12px;width:240px;height:36px;background:#fff;color:#002A46;font:16px Inter,sans-serif;z-index:999;padding:6px';
    const i=document.createElement('input'); i.id='s00in'; i.style.cssText='position:fixed;left:12px;top:60px;width:240px;z-index:999';
    document.body.append(d,i); window.__prev=[]; document.addEventListener('keydown',e=>{ if(e.key===' ') window.__prev.push(e.defaultPrevented); }); });
  await q.click('#s00ce'); await q.keyboard.type('a b'); await q.keyboard.press('Space'); await sleep(250);
  const ce=await q.evaluate(()=>({t:document.getElementById('s00ce').textContent, pos:document.querySelector('.amp-pos').textContent, prev:window.__prev}));
  check('S00-24: Espaço dentro de contentEditable digita e não avança slide', /^a[\s ]b/.test(ce.t)&&/^01/.test(ce.pos)&&ce.prev.every(x=>x===false), ce);
  await q.click('#s00in'); await q.keyboard.type('x y'); await q.keyboard.press('ArrowRight'); await q.keyboard.press('Home'); await sleep(250);
  const ci=await q.evaluate(()=>({v:document.getElementById('s00in').value, pos:document.querySelector('.amp-pos').textContent}));
  check('S00-25: teclas dentro de input não navegam', ci.v==='x y'&&/^01/.test(ci.pos), ci);
  await q.screenshot({path:SH('01-export-keyguard')});
  await q.evaluate(()=>document.activeElement.blur());
  await q.keyboard.press('Control+ArrowRight'); await q.keyboard.press('Alt+PageDown'); await sleep(250);
  const cm2=await q.evaluate(()=>document.querySelector('.amp-pos').textContent);
  await q.keyboard.press('Space'); await sleep(600);
  const sp=await q.evaluate(()=>document.querySelector('.amp-pos').textContent);
  check('S00-26: Ctrl/Alt+seta não navegam; Espaço fora de campos continua avançando', /^01/.test(cm2)&&/^02/.test(sp), [cm2,sp]);
  await q.close();

  /* ---------- 7. extensões: rt-* no runtime e no export; ed-* só no editor (cópia temporária da obra) ---------- */
  const tmp=fs.mkdtempSync(path.join(__dirname,'.s00-')), ts=path.join(tmp,'studio');
  try{
    fs.mkdirSync(ts); fs.symlinkSync(path.resolve(__dirname,'..','am'),path.join(tmp,'am'));
    ['editor.html','editor.js','runtime.js','runtime.css','cover.html','cover.css','cover.js','assemble.py'].forEach(f=>fs.copyFileSync(path.join(__dirname,f),path.join(ts,f)));
    const W=(f,t)=>fs.writeFileSync(path.join(ts,f),t);
    W('rt-zz-s00.js',`/* amostra S00: um modelo registrado de fora do runtime.js */
(function (R) {
  'use strict'; var U = R.util;
  R.FX.s00probe = { name: 'Sonda S00', cat: 'Teste S00', model: true, kw: 'sonda teste fundacao', w: 640, h: 300, variant: 'a',
    variants: [['a', 'Variação A', 'Primeira.'], ['b', 'Variação B', 'Segunda.']], anim: { in: 'fade', dur: 700 },
    data: { title: 'Sonda <S00> & cia' }, fields: [['title', 'Título']],
    html: function (d, w, h, el) { return '<div class="fx fx-s00 fxv-' + U.VV(el, 's00probe') + '" data-nid="' + U.nid('s0') + '"><b style="font-size:' + U.CQ(40) + '">' + U.E('title', d.title) + '</b></div>'; } };
  var base = R.lineSVG; R.lineSVG = function (el) { return base(el).replace('<svg ', '<svg data-s00="1" '); };
  R.hooks.player.push(function (hd) { hd.deckEl.setAttribute('data-s00-hook', String(hd.deck.slides.length)); hd.onDestroy(function () { window.__s00bye = 1; }); });
})(window.AMRT)`); /* sem ';' no fim de propósito: o assemble separa os arquivos */
    W('rt-zz-s01.js',`(function (R) { R.__s00second = !!R.FX.s00probe; })(window.AMRT);`);
    W('rt-zz-s00.css',`/* amostra S00 */
.fx-s00{display:flex;align-items:center;justify-content:center;background:#002A46;color:#FFFFFF;font-family:'Roboto Condensed',Arial,sans-serif;border-radius:1.2cqw}
.am-in .fx-s00{animation:s00Rise .5s calc(var(--d,0ms) + 80ms) both}
@keyframes s00Rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`);
    W('ed-zz-s00.js',`window.__s00ed = typeof window.AMStudio === 'object' && !!window.AMRT.FX.s00probe;`);
    W('ed-zz-s00.css',`#s00-ed-marker{color:#F78C16}`);
    W('xedit.js',`window.__s00xe = 1;`);
    W('history.js',`window.__s00hist = typeof window.AMStudio;`);
    const asm=(out)=>{ try{ return {code:0,out:cp.execFileSync('python3',['assemble.py',out],{cwd:ts,encoding:'utf8',stdio:'pipe'})}; }catch(e){ return {code:e.status||1,out:String(e.stderr||e.message)}; } };
    const ok1=asm('s00-ext.html');
    check('S00-27: assemble aceita rt-*/ed-*/xedit/history e lista as extensões', ok1.code===0&&/rt-zz-s00\.js/.test(ok1.out)&&/ed-zz-s00\.css/.test(ok1.out), ok1);
    for(const [nm,src,why] of [['rt-zz-bad.js','var b = 1; b.onclick = 2;','on*'],['rt-zz-bad.js','var s = "</script>";','</script'],['rt-zz-bad.js','function (','sintaxe'],['rt-zz-bad.css','.x{}</style>','</style']]){
      W(nm,src); const r2=asm('s00-bad.html'); fs.unlinkSync(path.join(ts,nm));
      check('S00-28: assemble recusa extensão com '+why, r2.code!==0&&!fs.existsSync(path.join(ts,'s00-bad.html')), r2.out.slice(-200)); }
    const e=await open(ctx,'file://'+path.join(ts,'s00-ext.html')+'?nocover','ext',900);
    const ed=await e.evaluate(()=>{ const sc=[...document.scripts].map(s=>s.id||(s.textContent.indexOf('window.AMStudio =')>=0?'(editor)':'(outro)')); return {probe:!!AMRT.FX.s00probe, second:AMRT.__s00second, ed:window.__s00ed, xe:window.__s00xe, xeType:(document.getElementById('am-xedit')||{}).type, hist:window.__s00hist,
      order:sc, css:!!document.getElementById('am-ed-css')&&/s00-ed-marker/.test(document.getElementById('am-ed-css').textContent)}; });
    const io=k=>ed.order.indexOf(k);
    check('S00-29: rt-*.js roda no runtime, em ordem alfabética', ed.probe&&ed.second===true, ed);
    check('S00-30: ed-*.js roda depois do editor e antes da capa; ed-*.css no editor', ed.ed===true&&ed.css&&io('(editor)')<io('am-ed-zz-s00')&&io('am-ed-zz-s00')<io('am-history')&&io('am-history')<io('am-cover'), ed.order);
    check('S00-31: xedit.js fica inerte no editor; history.js roda', ed.xe===undefined&&ed.xeType==='text/plain'&&ed.hist==='object', ed);
    await e.evaluate(()=>AMStudio.hideDraftBanner()); await e.click('#bModels'); await sleep(900);
    const card=await e.evaluate(()=>{ const c=document.querySelector('#modelsBody .fxi[data-k="s00probe"]'); const cats=[...document.querySelectorAll('#modelsBody .dcat')].map(x=>x.textContent); return {card:!!c, cats}; });
    check('S00-32: categoria nova de rt-*.js aparece no fim da Biblioteca de modelos', card.card&&card.cats[card.cats.length-1]==='Teste S00', card);
    await e.evaluate(()=>document.querySelector('#modelsBody .fxi[data-k="s00probe"]').scrollIntoView({block:'center'})); await sleep(300);
    await e.screenshot({path:SH('02-ext-biblioteca')});
    await e.click('#modelsBody button[data-ins="s00probe"]'); await sleep(900);
    await e.evaluate(()=>{ const s=AMStudio.deck.slides[AMStudio.cur]; s.els.push(Object.assign(AMStudio.mk.line(true),{x1:200,y1:600,x2:1080,y2:600})); AMStudio.renderAll(); AMStudio.commit(); }); await sleep(300);
    const edLine=await e.evaluate(()=>!!document.querySelector('#wrap .am-stage .am-t-line svg[data-s00="1"]'));
    check('S00-33: AMRT.lineSVG embrulhado por extensão vale no editor', edLine);
    await e.screenshot({path:SH('03-ext-editor')});
    const xh=await e.evaluate(()=>AMStudio.exportHTML()); const xf=path.join(ts,'s00-ext-export.html'); fs.writeFileSync(xf,xh);
    const iRt=xh.indexOf('window.AMRT = (function'), iPr=xh.indexOf('R.FX.s00probe');
    check('S00-34: export leva rt-*.js dentro do mesmo <script> do runtime e o rt-*.css', iRt>0&&iPr>iRt&&xh.slice(iRt,iPr).toLowerCase().indexOf('</script')<0&&/s00Rise/.test(xh));
    check('S00-35: export não leva ed-*, xedit, history, editor nem capa', !/s00-ed-marker|__s00ed|__s00xe|__s00hist|AMCover|id="am-cover/.test(xh)&&!/window\.AMStudio\s*=/.test(xh)&&/id="am-deck-data"/.test(xh)&&!/onerror|onmouseover|onclick/.test(xh));
    const x=await open(ctx,'file://'+xf,'ext-exp',1600);
    const xr=await x.evaluate(()=>{ const f=document.querySelector('.amp-slide.on .fx-s00'); return {f:!!f, txt:f&&f.textContent, inj:!!document.querySelector('.amp-slide s00'), bg:f&&getComputedStyle(f).backgroundColor, hook:document.querySelector('.amp-deck').getAttribute('data-s00-hook'), line:!!document.querySelector('.amp-slide.on .am-t-line svg[data-s00="1"]')}; });
    check('S00-36: no arquivo exportado o modelo da extensão renderiza com o CSS dela e texto escapado', xr.f&&xr.txt==='Sonda <S00> & cia'&&!xr.inj&&xr.bg==='rgb(0, 42, 70)', xr);
    check('S00-37: AMRT.hooks.player e AMRT.lineSVG da extensão valem no export', xr.hook==='1'&&xr.line, xr);
    await x.screenshot({path:SH('04-ext-export')}); await x.close(); await e.close();
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  check('S00-38: amostras removidas; a obra real não leva a sonda', !fs.existsSync(tmp)&&!fs.readFileSync(path.join(__dirname,'AM-Studio-Editor.html'),'utf8').includes('s00probe')&&!fs.readdirSync(__dirname).some(f=>/^(rt|ed)-.*s00/.test(f)));

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', results.length+' verificações', JSON.stringify({errs}));
  await b.close(); try{ fs.unlinkSync(fx); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
