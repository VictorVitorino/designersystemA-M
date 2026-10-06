/* test-s04: Linhas e formas (item 4.1). rt-10-shapes.js (rotas reta/cotovelo/curva com dobra, 4 tracejados, 5 pontas por lado,
   15 formas novas, 8 estilos de card, recuo do texto), correção do tracejado que saía cheio (runtime.js: traço visível sem pathLength,
   “Desenhar” na máscara), galeria “Formas ▾” agrupada, “Seta ▾” com 8 linhas prontas, Inserir › Forma ▸ em duas colunas e
   Inserir › Linhas e setas ▸, painel (traçado, dobra, tracejado, pontas, inverter; estilo do card; colchetes só com traço),
   alça da dobra no slide, decks antigos idênticos (pixel a pixel contra o código anterior), export e player.
   QA rodada 1: trocar o Tipo de um card com estilo mantém o texto legível (S04-38), faixa do cabeçalho cresce com o título (S04-39),
   nota no lugar das amostras de preenchimento que não teriam efeito (S04-40), miniaturas das linhas em tamanho cheio (S04-21b).
   QA rodada 2: texto do Anel no furo, na cor de texto do slide (S04-41, S04-42); estrela e anel não quebram palavras comuns no meio
   (S04-43); alinhamento vertical desativado no Cabeçalho (S04-44); formas no slide escuro em aço, cards tom sobre tom (S04-45);
   player no celular com a marca inteira (S04-46).
   Uso: python3 assemble.py && node test-s04.js   (o qa-gate.sh pega qualquer test-s[0-9][0-9]*.js) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s04-'+f+'.png');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'canteiro-s04-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined&&!ok?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function page(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  if(url) await p.goto(url); await sleep(wait||800); return p; }
const els=p=>p.evaluate(()=>AMStudio.deck.slides[AMStudio.cur].els.map(e=>JSON.parse(JSON.stringify(e))));
const last=async p=>{ const e=await els(p); return e[e.length-1]; };
const fresh=p=>p.evaluate(()=>{ AMStudio.closeMenus(); AMStudio.loadDeck(AMStudio.newDeck(),null,true,true); });
const clip=(p,sel,pad)=>p.evaluate(([s,d])=>{ const r=document.querySelector(s).getBoundingClientRect(); return {x:Math.max(0,r.x-d),y:Math.max(0,r.y-d),width:Math.min(innerWidth-Math.max(0,r.x-d),r.width+d*2),height:Math.min(innerHeight-Math.max(0,r.y-d),r.height+d*2)}; },[sel,pad||8]);
const deckJSON=html=>{ const m=html.match(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/); return m?JSON.parse(m[1]):null; };
/* pixels: trechos escuros numa linha da imagem (tracejado = muitos trechos; linha cheia = 1) e diferença entre duas imagens */
const runs=(p,buf,y,x0,x1)=>p.evaluate(async([b,y,x0,x1])=>{ const im=new Image(); im.src='data:image/png;base64,'+b; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height; const g=c.getContext('2d'); g.drawImage(im,0,0);
  const d=g.getImageData(x0,y,x1-x0,1).data; let n=0,ink=0,pv=false; for(let i=0;i<d.length;i+=4){ const k=(d[i]*.299+d[i+1]*.587+d[i+2]*.114)<170; if(k){ink++; if(!pv) n++;} pv=k; } return {n,ink}; },[buf.toString('base64'),Math.round(y),Math.round(x0),Math.round(x1)]);
const diff=(p,a,b)=>p.evaluate(async([a,b])=>{ const ld=async s=>{ const im=new Image(); im.src='data:image/png;base64,'+s; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height; const g=c.getContext('2d'); g.drawImage(im,0,0); return g.getImageData(0,0,c.width,c.height).data; };
  const A=await ld(a),B=await ld(b); if(A.length!==B.length) return {n:-1}; let n=0,mx=0; for(let i=0;i<A.length;i+=4){ const d=Math.max(Math.abs(A[i]-B[i]),Math.abs(A[i+1]-B[i+1]),Math.abs(A[i+2]-B[i+2])); if(d>mx) mx=d; if(d>40) n++; } return {n,mx}; },[a.toString('base64'),b.toString('base64')]);
/* bancada: palco 1280×720 em escala 1:1 por cima do editor (px lógico = px de tela) */
const LAB=`window.__lab=function(slide,play){ var d=document.getElementById('s4lab'); if(!d){ d=document.createElement('div'); d.id='s4lab'; d.style.cssText='position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;background:#fff'; document.body.appendChild(d); }
  d.innerHTML=''; d.style.display='block'; var st=AMRT.renderSlide(slide,{play:!!play}); d.appendChild(st); if(play){ st.classList.remove('am-pre'); void st.offsetWidth; st.classList.add('am-in'); } return st; };
  window.__labOff=function(){ var d=document.getElementById('s4lab'); if(d){ d.innerHTML=''; d.style.display='none'; } };`;
/* código de formas e linhas de ANTES do S4 (runtime.js do passo S3), para provar que decks antigos saem idênticos */
const LEGACY=`(function(){
  function shapeBody(el, w, h) {
    var sw = +el.strokeW || 0, i = sw / 2, r = Math.max(0, Math.min(+el.radius || 0, w / 2, h / 2)), k;
    var a = 'fill="' + (el.fill || 'none') + '" stroke="' + (sw ? (el.stroke || 'none') : 'none') + '" stroke-width="' + sw + '"' + (el.dash ? ' stroke-dasharray="' + sw * 3 + ' ' + sw * 2 + '"' : '');
    switch (el.shape) {
      case 'round': return '<rect x="' + i + '" y="' + i + '" width="' + (w - sw) + '" height="' + (h - sw) + '" rx="' + (r || Math.min(w, h) * .12) + '" ' + a + '/>';
      case 'pill': return '<rect x="' + i + '" y="' + i + '" width="' + (w - sw) + '" height="' + (h - sw) + '" rx="' + (Math.min(w, h) / 2 - i) + '" ' + a + '/>';
      case 'ellipse': return '<ellipse cx="' + w / 2 + '" cy="' + h / 2 + '" rx="' + (w / 2 - i) + '" ry="' + (h / 2 - i) + '" ' + a + '/>';
      case 'triangle': return '<path d="M' + w / 2 + ' ' + i + 'L' + (w - i) + ' ' + (h - i) + 'L' + i + ' ' + (h - i) + 'Z" ' + a + '/>';
      case 'diamond': return '<path d="M' + w / 2 + ' ' + i + 'L' + (w - i) + ' ' + h / 2 + 'L' + w / 2 + ' ' + (h - i) + 'L' + i + ' ' + h / 2 + 'Z" ' + a + '/>';
      case 'chevron': k = Math.min(w * .3, h * .5); return '<path d="M' + i + ' ' + i + 'L' + (w - k) + ' ' + i + 'L' + (w - i) + ' ' + h / 2 + 'L' + (w - k) + ' ' + (h - i) + 'L' + i + ' ' + (h - i) + 'L' + k + ' ' + h / 2 + 'Z" ' + a + '/>';
      case 'para': k = Math.min(w * .4, h * .45); return '<path d="M' + k + ' ' + i + 'L' + (w - i) + ' ' + i + 'L' + (w - k) + ' ' + (h - i) + 'L' + i + ' ' + (h - i) + 'Z" ' + a + '/>';
      case 'arrow': k = Math.min(w * .38, h * .7); return '<path d="M' + i + ' ' + h * .28 + 'L' + (w - k) + ' ' + h * .28 + 'L' + (w - k) + ' ' + i + 'L' + (w - i) + ' ' + h / 2 + 'L' + (w - k) + ' ' + (h - i) + 'L' + (w - k) + ' ' + h * .72 + 'L' + i + ' ' + h * .72 + 'Z" ' + a + '/>';
      default: return '<rect x="' + i + '" y="' + i + '" width="' + (w - sw) + '" height="' + (h - sw) + '" rx="' + r + '" ' + a + '/>';
    }
  }
  function lineBox(el) {
    var pad = Math.max(14, (+el.strokeW || 2) * 4);
    var x = Math.min(el.x1, el.x2) - pad, y = Math.min(el.y1, el.y2) - pad;
    return { x: x, y: y, w: Math.abs(el.x2 - el.x1) + pad * 2, h: Math.abs(el.y2 - el.y1) + pad * 2 };
  }
  function lineSVG(el) {
    var b = lineBox(el), x1 = el.x1 - b.x, y1 = el.y1 - b.y, x2 = el.x2 - b.x, y2 = el.y2 - b.y, sw = +el.strokeW || 2, c = el.stroke || '#002A46';
    var ang = Math.atan2(y2 - y1, x2 - x1), s = Math.max(9, sw * 3.4), heads = '';
    function head(px, py, a) {
      var bx = px - s * Math.cos(a), by = py - s * Math.sin(a), ox = -Math.sin(a) * s * .55, oy = Math.cos(a) * s * .55;
      return '<path class="am-head" d="M' + px + ' ' + py + 'L' + (bx + ox) + ' ' + (by + oy) + 'L' + (bx - ox) + ' ' + (by - oy) + 'Z" fill="' + c + '"/>';
    }
    var sx = x1, sy = y1, ex = x2, ey = y2;
    if (el.headEnd) { heads += head(x2, y2, ang); ex = x2 - Math.cos(ang) * s * .8; ey = y2 - Math.sin(ang) * s * .8; }
    if (el.headStart) { heads += head(x1, y1, ang + Math.PI); sx = x1 + Math.cos(ang) * s * .8; sy = y1 + Math.sin(ang) * s * .8; }
    var dash = el.dash ? ' stroke-dasharray="' + sw * 3 + ' ' + sw * 2.2 + '"' : '';
    /* am-hit: traço invisível e largo que recebe o clique no editor (a caixa da linha não captura cliques) */
    return '<svg viewBox="0 0 ' + b.w + ' ' + b.h + '"><path class="am-hit" d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + '" stroke="transparent" stroke-width="' + Math.max(14, sw + 10) + '" stroke-linecap="round" fill="none"/><path class="am-ln" pathLength="1" d="M' + sx + ' ' + sy + 'L' + ex + ' ' + ey + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" fill="none"' + dash + '/>' + heads + '</svg>';
  }
window.__legacy={shapeBody:shapeBody,lineSVG:lineSVG}; })();`;

(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await page(ctx, FILE+'?nocover', 'ed');
  await p.evaluate(LAB); await p.evaluate(LEGACY);

  /* ===================== 1. runtime: inventário ===================== */
  const inv=await p.evaluate(()=>{ const R=AMRT; return {x:R.SHAPES_X, looks:R.LOOKS, rt:R.LINE_ROUTES, ds:R.LINE_DASHES, hd:R.LINE_HEADS, ins:typeof R.shapeInset, bp:typeof R.lineBendPt}; });
  check('S04-01: rt-10-shapes registra 15 formas, 8 estilos de card, 3 rotas, 4 tracejados e 5 pontas', inv.x.length===15&&new Set(inv.x).size===15&&inv.looks.join()==='flat,outline,lift,accent,topbar,header,gradient,ice'&&inv.rt.join()==='straight,elbow,curve'&&inv.ds.join()==='dash,dot,dashdot,long'&&inv.hd.join()==='arrow,open,dot,diamond,bar'&&inv.ins==='function'&&inv.bp==='function', inv);

  /* formas novas: no tamanho padrão e a 50 %, no branco e no azul-marinho, o desenho cabe na caixa e o texto não transborda */
  const sh=await p.evaluate(()=>{ const S=AMStudio, out=[], bad=[];
    for(const dark of [false,true]) for(const half of [false,true]) for(const k of AMRT.SHAPES_X){
      const e=S.mk.shape(k,dark); if(half){ e.w=Math.round(e.w/2); e.h=Math.round(e.h/2); } e.x=100; e.y=100; if(!half) e.html='Texto';
      const st=__lab({bg:dark?'#002A46':'#FFFFFF',els:[e]}), n=st.querySelector('.am-el'), svg=n.querySelector('svg'), mk=svg.innerHTML, sw=Math.max(+e.strokeW||0,(k==='brackets'||k==='braces')?3:0);
      if(/NaN|undefined|Infinity/.test(mk)) bad.push(k+': NaN no desenho');
      [...svg.querySelectorAll('path,rect,ellipse,circle')].forEach(g=>{ const bb=g.getBBox(); if(bb.x<-.6-sw/2||bb.y<-.6-sw/2||bb.x+bb.width>e.w+.6+sw/2||bb.y+bb.height>e.h+.6+sw/2) bad.push(k+(half?' 50%':'')+': fora da caixa '+JSON.stringify([bb.x,bb.y,bb.width,bb.height].map(Math.round))); });
      if(!half){ const nr=n.getBoundingClientRect(), tx=n.querySelector('.am-tx').getBoundingClientRect(), tb=n.querySelector('.am-text').getBoundingClientRect(); if(tx.right>nr.right+2||tx.left<nr.left-2||tx.bottom>tb.bottom+2||tx.bottom>nr.bottom+2) bad.push(k+': texto transborda'); }
      if(!dark&&!half) out.push(k+':'+e.w+'x'+e.h);
    } __labOff(); return {bad,out}; });
  check('S04-02: as 15 formas novas cabem na própria caixa no tamanho padrão e a 50 %, no branco e no azul-marinho, sem NaN, e o texto não transborda', sh.bad.length===0&&sh.out.length===15&&sh.out.includes('cylinder:160x200')&&sh.out.includes('callout:300x160')&&sh.out.includes('star:200x200')&&sh.out.includes('pentagon:280x140'), sh);

  /* ===================== 2. tracejado: antes saía cheio (pathLength=1 reescalava o padrão) ===================== */
  const DS=['none','dash','dot','dashdot','long'];
  await p.evaluate(DS=>__lab({bg:'#FFFFFF',els:DS.map((k,i)=>({id:'d'+i,type:'line',x1:100,y1:100+i*110,x2:900,y2:100+i*110,stroke:'#002A46',strokeW:6,dash:k!=='none',dashS:k}))}),DS);
  await sleep(150); let shot=await p.screenshot({clip:{x:0,y:0,width:1280,height:720}}); fs.writeFileSync(SH('01-tracejados'),shot);
  const dr=[]; for(let i=0;i<DS.length;i++) dr.push((await runs(p,shot,100+i*110,140,860)).n);
  const dm=await p.evaluate(()=>[...document.querySelectorAll('#s4lab .am-el')].map(n=>{ const v=n.querySelector('.am-lnd'); return v?{pl:v.getAttribute('pathLength'),da:v.getAttribute('stroke-dasharray'),cap:v.getAttribute('stroke-linecap'),mask:!!n.querySelector('mask .am-ln[pathLength="1"]'),css:getComputedStyle(v).strokeDasharray}:{solid:!!n.querySelector('.am-ln[pathLength="1"]:not(mask *)')}; }));
  check('S04-03: linha cheia continua cheia; os 4 tracejados aparecem de verdade (muitos trechos na mesma linha de pixels)', dr[0]===1&&dr[1]>=15&&dr[2]>=40&&dr[3]>=25&&dr[4]>=10&&dm[0].solid, {dr,dm});
  check('S04-04: traço visível tracejado sem pathLength, padrão em múltiplos da espessura (6 px: 18 12 · 0.06 12 redondo · 18 9.6 0.06 9.6 · 36 15) e máscara .am-ln com pathLength', dm.slice(1).every(d=>d.pl===null&&d.mask)&&dm[1].da==='18 12'&&dm[2].da==='0.06 12'&&dm[2].cap==='round'&&dm[3].da==='18 9.6 0.06 9.6'&&dm[4].da==='36 15'&&dm[1].css!=='1px', dm);

  /* “Desenhar” numa linha tracejada: no meio da animação a máscara revela só o começo; no fim, tracejado (não cheio) */
  await p.evaluate(()=>{ __lab({bg:'#FFFFFF',els:[{id:'dd',type:'line',x1:100,y1:360,x2:1100,y2:360,stroke:'#002A46',strokeW:6,dash:true,anim:{in:'draw',dur:1200}}]},true);
    const st=document.querySelector('#s4lab .am-stage'), an=st.getAnimations({subtree:true}).filter(a=>a.animationName==='amDraw'); an.forEach(a=>{ a.pause(); a.currentTime=600; }); window.__an=an; });
  await sleep(120); shot=await p.screenshot({clip:{x:0,y:0,width:1280,height:720}}); fs.writeFileSync(SH('02-desenhar-meio'),shot);
  const mid={l:await runs(p,shot,360,110,560), r:await runs(p,shot,360,640,1090), n:await p.evaluate(()=>__an.length)};
  await p.evaluate(()=>__an.forEach(a=>a.finish())); await sleep(150); shot=await p.screenshot({clip:{x:0,y:0,width:1280,height:720}});
  const end=await runs(p,shot,360,110,1090), endCss=await p.evaluate(()=>getComputedStyle(document.querySelector('#s4lab .am-lnd')).strokeDasharray);
  check('S04-05: “Desenhar” na tracejada: na metade só o começo aparece (e já tracejado); no fim, tracejado inteiro', mid.n===1&&mid.l.n>=10&&mid.r.ink===0&&end.n>=25&&endCss==='18px, 12px', {mid,end,endCss});

  /* runtime base (sem rt-10): a correção do tracejado está no próprio runtime.js */
  { const q=await page(ctx,null,'base',50); await q.setViewportSize({width:1280,height:720});
    await q.setContent('<!doctype html><meta charset="utf-8"><style>'+fs.readFileSync(path.join(__dirname,'runtime.css'),'utf8')+'body{margin:0}</style><div id="lab" style="width:1280px"></div><script>'+fs.readFileSync(path.join(__dirname,'runtime.js'),'utf8')+'</script>');
    await q.evaluate(()=>{ const st=AMRT.renderSlide({bg:'#fff',els:[{id:'a',type:'line',x1:100,y1:200,x2:1100,y2:200,strokeW:6,dash:true,anim:{in:'draw',dur:400}},{id:'b',type:'line',x1:100,y1:400,x2:1100,y2:400,strokeW:6,headEnd:true}]},{play:true}); document.getElementById('lab').appendChild(st); st.classList.remove('am-pre'); void st.offsetWidth; st.classList.add('am-in'); });
    await sleep(900); const s2=await q.screenshot();
    const bs={dash:(await runs(q,s2,200,140,1060)).n, solid:(await runs(q,s2,400,140,1000)).n, m:await q.evaluate(()=>({lnd:!!document.querySelector('[data-id=a] .am-lnd:not([pathLength])'), mask:!!document.querySelector('[data-id=a] mask .am-ln'), plain:!!document.querySelector('[data-id=b] .am-ln[pathLength="1"]')&&!document.querySelector('[data-id=b] mask'), ext:typeof AMRT.SHAPES_X}))};
    check('S04-06: runtime.js sozinho (sem rt-10) também desenha a tracejada tracejada depois do “Desenhar”; linha cheia com a marcação de sempre', bs.dash>=25&&bs.solid===1&&bs.m.lnd&&bs.m.mask&&bs.m.plain&&bs.m.ext==='undefined', bs);
    await q.close(); }

  /* ===================== 3. pontas e rotas ===================== */
  const hd=await p.evaluate(()=>{ const r={}; const one=e=>{ const st=__lab({bg:'#fff',els:[Object.assign({id:'h',type:'line',x1:200,y1:300,x2:800,y2:300,strokeW:4,stroke:'#002A46'},e)]}); return st.querySelector('.am-el'); };
    ['arrow','open','dot','diamond','bar'].forEach(k=>{ const n=one({headS:k,headE:k,headStart:true,headEnd:true}), h=[...n.querySelectorAll('.am-head')];
      r[k]=h.map(x=>x.tagName+(x.getAttribute('fill')==='none'?':vazada':'')+(x.getAttribute('stroke')?':traço':'')).join('|'); });
    const ob=one({headEnd:true}), ob2=one({headEnd:true,headStart:true}), none=one({headE:'<b>',headEnd:false});
    r.bool=[...ob.querySelectorAll('.am-head')].map(x=>x.tagName+(x.getAttribute('fill')||'')).join('|'); r.bool2=ob2.querySelectorAll('.am-head').length; r.none=none.querySelectorAll('.am-head').length;
    const a=one({headE:'arrow',headEnd:true}).querySelector('.am-ln').getAttribute('d'); r.pull=+a.split('L')[1].split(' ')[0]; __labOff(); return r; });
  check('S04-07: 5 pontas por lado (seta cheia, seta aberta, bola, losango, barra); booleanos antigos = seta; tipo inválido sem booleano = sem ponta; o traço recua sob a seta', hd.arrow==='path|path'&&hd.open==='path:vazada:traço|path:vazada:traço'&&hd.dot==='circle|circle'&&hd.diamond==='path|path'&&hd.bar==='path:traço|path:traço'&&hd.bool==='path#002A46'&&hd.bool2===2&&hd.none===0&&hd.pull<816-10, hd);

  const geo=await p.evaluate(()=>{ const r={}, B=AMRT.lineBox;
    const one=e=>{ const el=Object.assign({id:'g',type:'line',strokeW:4,stroke:'#002A46',headEnd:true},e), st=__lab({bg:'#fff',els:[el]}), n=st.querySelector('.am-el'), b=B(el), hit=n.querySelector('.am-hit');
      const inS=(x,y)=>hit.isPointInStroke(new DOMPoint(x-b.x,y-b.y)), hh=n.querySelector('path.am-head'), head=hh?hh.getAttribute('d').match(/-?[\d.]+/g).map(Number):[];
      const inside=[...n.querySelectorAll('svg path,svg circle')].filter(g=>!g.closest('mask')).every(g=>{ const bb=g.getBBox(); return bb.x>=-.5&&bb.y>=-.5&&bb.x+bb.width<=b.w+.5&&bb.y+bb.height<=b.h+.5; });
      return {d:n.querySelector('.am-ln').getAttribute('d'), inS, head, inside, el}; };
    let o=one({x1:100,y1:500,x2:700,y2:200,curve:'elbow',bend:.3}); const bp=AMRT.lineBendPt(o.el);
    r.elbow={cmd:o.d.replace(/[^A-Z]/g,''), bp:[bp.x,bp.y,bp.hz], on:o.inS(280,350), off:o.inS(520,350), flat:Math.abs(o.head[2]-o.head[4])<.02&&Math.abs((o.head[3]+o.head[5])/2-o.head[1])<.02, inside:o.inside};
    o=one({x1:100,y1:500,x2:700,y2:200,curve:'elbow',bend:.7}); r.elbow7={on:o.inS(520,350), off:o.inS(280,350)};
    o=one({x1:100,y1:100,x2:300,y2:600,curve:'elbow'}); const bv=AMRT.lineBendPt(o.el); r.vert={cmd:o.d.replace(/[^A-Z]/g,''), bp:[bv.x,bv.y,bv.hz], on:o.inS(200,350), down:Math.abs(o.head[3]-o.head[5])<.02, inside:o.inside};
    o=one({x1:100,y1:500,x2:700,y2:200,curve:'curve'}); r.curve={cmd:o.d.replace(/[^A-Z]/g,''), flat:Math.abs(o.head[2]-o.head[4])<.02, inside:o.inside};
    o=one({x1:700,y1:200,x2:100,y2:600,curve:'curve',headS:'diamond',headStart:true,headE:'dot',dash:true,dashS:'dashdot',strokeW:9}); r.curve2={inside:o.inside};
    o=one({x1:100,y1:300,x2:800,y2:300,headS:'bar',headE:'bar',headStart:true,strokeW:12}); r.bar={inside:o.inside};
    __labOff(); return r; });
  check('S04-08: cotovelo (horizontal primeiro quando |dx| ≥ |dy|) com cantos arredondados; a dobra move o segmento do meio (30 % / 70 %); a seta final segue o último trecho', geo.elbow.cmd==='MHQVQH'&&geo.elbow.bp.join()==='280,350,true'&&geo.elbow.on&&!geo.elbow.off&&geo.elbow.flat&&geo.elbow7.on&&!geo.elbow7.off, geo);
  check('S04-09: cotovelo vertical quando |dy| > |dx|; curva em S com tangentes horizontais; tudo (traço, pontas grossas, tracejado) dentro da caixa da linha', geo.vert.cmd==='MVQHQV'&&geo.vert.bp.join()==='200,350,false'&&geo.vert.on&&geo.vert.down&&geo.curve.cmd==='MC'&&geo.curve.flat&&geo.elbow.inside&&geo.vert.inside&&geo.curve.inside&&geo.curve2.inside&&geo.bar.inside, geo);

  /* ===================== 4. decks antigos: idênticos, pixel a pixel, ao código de antes do S4 ===================== */
  const OLD=await p.evaluate(()=>{ const SH=['rect','round','pill','ellipse','triangle','diamond','para','chevron','arrow'], E=[];
    SH.forEach((s,k)=>E.push({id:'a'+k,type:'shape',shape:s,x:20+(k%5)*250,y:20+Math.floor(k/5)*150,w:220,h:120,fill:k%2?'#F78C16':'#002A46',stroke:'#7EA1C3',strokeW:0,radius:14,html:s==='triangle'?'':'Fase '+k,font:'Inter',size:20,weight:600,color:'#FFFFFF',align:'center',valign:'middle'}));
    SH.forEach((s,k)=>E.push({id:'b'+k,type:'shape',shape:s,x:20+(k%5)*250,y:330+Math.floor(k/5)*120,w:200,h:90,fill:k%3?'none':'#EEF2F7',stroke:'#002A46',strokeW:k%2?4:2,radius:k*3,shadow:k%2===0,dash:k===4}));
    [[20,600,300,600,0,0,3],[340,690,600,600,1,0,3],[640,600,900,690,1,1,6],[940,690,1240,600,0,1,2],[700,560,1240,560,1,0,12]].forEach((l,k)=>E.push({id:'l'+k,type:'line',x1:l[0],y1:l[1],x2:l[2],y2:l[3],headEnd:!!l[4],headStart:!!l[5],strokeW:l[6],stroke:k%2?'#F78C16':'#002A46'}));
    return {bg:'#FFFFFF',els:E}; });
  await p.evaluate(s=>{ const R=AMRT, k=[R.shapeBody,R.lineSVG]; R.shapeBody=__legacy.shapeBody; R.lineSVG=__legacy.lineSVG; try{ __lab(s); } finally { R.shapeBody=k[0]; R.lineSVG=k[1]; } },OLD);
  await sleep(150); const before=await p.screenshot({clip:{x:0,y:0,width:1280,height:720}});
  await p.evaluate(s=>__lab(s),OLD); await sleep(150); const after=await p.screenshot({clip:{x:0,y:0,width:1280,height:720}}); fs.writeFileSync(SH('03-deck-antigo'),after);
  const dd=await diff(p,before,after); await p.evaluate(()=>__labOff());
  check('S04-10: deck antigo (9 formas com e sem contorno, sombra, raio, tracejado no contorno; linhas e setas cheias) sai idêntico ao código de antes', dd.n===0&&dd.mx<=40, dd);

  /* ===================== 5. estilos de card, colchetes, recuo do texto ===================== */
  const lk=await p.evaluate(()=>{ const r={}, base={id:'c',type:'shape',shape:'round',x:100,y:100,w:320,h:180,fill:'#002A46',stroke:'#7EA1C3',strokeW:0,radius:14};
    const svg=e=>{ const st=__lab({bg:'#fff',els:[Object.assign({},base,e)]}); return st.querySelector('.am-el svg'); };
    const plain=svg({}).innerHTML; r.flat=svg({look:'flat'}).innerHTML===plain;
    let s=svg({look:'outline'}).firstElementChild; r.outline=[s.getAttribute('fill'),s.getAttribute('stroke'),s.getAttribute('stroke-width')].join();
    s=svg({look:'lift'}); r.lift=!!s.querySelector('filter feDropShadow')&&/^url\(#/.test(s.querySelector('rect').getAttribute('filter')||'')&&s.querySelector('rect').getAttribute('fill')==='#FFFFFF';
    s=svg({look:'accent'}); let bar=s.querySelector('rect[fill="#F78C16"]'); r.accent=bar&&[bar.getAttribute('width'),bar.getAttribute('height'),!!s.querySelector('clipPath rect[rx="14"]'),/^url\(#/.test(bar.getAttribute('clip-path'))].join();
    s=svg({look:'topbar'}); bar=s.querySelector('rect[fill="#F78C16"]'); r.topbar=bar&&[bar.getAttribute('width'),bar.getAttribute('height')].join();
    s=svg({look:'header',fill:'#FFFFFF'}); bar=s.querySelector('rect[fill="#002A46"]'); r.header=bar&&bar.getAttribute('height');
    s=svg({look:'gradient'}); r.gradient=s.querySelectorAll('linearGradient stop').length+':'+/^url\(#/.test(s.querySelector('rect').getAttribute('fill'));
    s=svg({look:'ice'}); r.ice=!!s.querySelector('linearGradient')&&!!s.querySelector('rect[stroke="#FFFFFF"]');
    const st2=__lab({bg:'#fff',els:[Object.assign({},base,{id:'c1',look:'accent'}),Object.assign({},base,{id:'c2',look:'accent',x:600})]}); const ids=[...st2.querySelectorAll('clipPath')].map(c=>c.id); r.uniq=ids.length===2&&ids[0]!==ids[1];
    r.ellipse=svg({shape:'ellipse',look:'accent'}).innerHTML===svg({shape:'ellipse'}).innerHTML;
    s=svg({shape:'pill',look:'topbar',strokeW:2}); r.pill=s.querySelector('clipPath rect').getAttribute('rx');
    s=svg({shape:'brackets',fill:'none',stroke:'#F78C16',strokeW:3,w:300,h:160}); const ps=[...s.querySelectorAll('path')], b1=ps[0].getBBox(), b2=ps[1].getBBox();
    r.br=ps.length===2&&ps.every(x=>x.getAttribute('fill')==='none'&&x.getAttribute('stroke')==='#F78C16')&&Math.abs(b2.x-(300-(b1.x+b1.width)))<.6;
    s=svg({shape:'braces',fill:'#43698F',stroke:'none',strokeW:0,w:300,h:160}); r.brc=[...s.querySelectorAll('path')].every(x=>x.getAttribute('stroke')==='#43698F'&&x.getAttribute('stroke-width')==='3');
    const ins=k=>{ const st=__lab({bg:'#fff',els:[Object.assign({},base,{shape:k,w:300,h:200,html:'x'})]}), t=getComputedStyle(st.querySelector('.am-text')); return [t.top,t.right,t.bottom,t.left].join(' '); };
    r.ins={callout:ins('callout'), rect:ins('rect'), cyl:ins('cylinder'), pent:ins('pentagon')}; __labOff(); return r; });
  check('S04-11: 8 estilos de card: chapado = sem mudança; contorno branco #CBD4E1 1,5; elevado com sombra própria; barras laranja recortadas no raio; cabeçalho navy 26 %; gradiente navy; gelo com fio de luz', lk.flat&&lk.outline==='#FFFFFF,#CBD4E1,1.5'&&lk.lift&&lk.accent==='6,180,true,true'&&lk.topbar==='320,5.4'&&lk.header==='46.8'&&lk.gradient==='3:true'&&lk.ice&&lk.pill==='89', lk);
  check('S04-12: ids de recorte únicos por desenho; estilo de card ignorado fora de retângulo/arredondado/pílula; colchetes e chaves só com traço, espelhados, cor do contorno (ou do preenchimento)', lk.uniq&&lk.ellipse&&lk.br&&lk.brc, lk);
  check('S04-13: recuo do texto: balão sem o rabicho (22 % embaixo), cilindro sem a tampa, pentágono sem a ponta; retângulo sem recuo', lk.ins.callout==='0px 0px 44px 0px'&&lk.ins.rect==='0px 0px 0px 0px'&&lk.ins.cyl==='36px 0px 12px 0px'&&lk.ins.pent==='0px 54px 0px 0px', lk.ins);

  /* catálogo para revisão visual: formas novas e cards no branco e no azul-marinho; linhas */
  for (const dark of [false,true]) {
    await p.evaluate(dark=>{ const S=AMStudio, E=[]; AMRT.SHAPES_X.forEach((k,i)=>{ const e=S.mk.shape(k,dark); e.id='n'+i; const s=Math.min(1,150/e.w,110/e.h); e.w=Math.round(e.w*s); e.h=Math.round(e.h*s); e.x=30+(i%8)*156+(150-e.w)/2; e.y=24+Math.floor(i/8)*150+(110-e.h)/2; E.push(e); E.push(S.mk.text('body',{id:'t'+i,x:20+(i%8)*156,y:140+Math.floor(i/8)*150,w:170,h:24,size:13,align:'center',html:k},dark)); });
      ['outline','lift','accent','topbar','header','gradient','ice','flat'].forEach((l,i)=>{ const c=Object.assign(S.mk.shape('round',dark),{id:'k'+i,x:30+(i%4)*310,y:330+Math.floor(i/4)*196,w:280,h:170}); if(l==='accent'||l==='topbar') c.fill=dark?'#13315C':'#EEF2F7'; c.html='Card '+l; c.look=l==='flat'?undefined:l;
        if(l==='header'){ c.fill='#FFFFFF'; c.strokeW=1.5; c.stroke='#DCE5F0'; c.valign='top'; c.color='#FFFFFF'; } else if(['outline','lift','ice'].includes(l)||(!dark&&(l==='accent'||l==='topbar'))) c.color='#002A46'; E.push(c); });
      __lab({bg:dark?'#002A46':'#FFFFFF',els:E}); },dark);
    await sleep(250); await p.screenshot({path:SH(dark?'05-formas-navy':'04-formas-branco'),clip:{x:0,y:0,width:1280,height:720}});
  }
  await p.evaluate(()=>{ const E=[], H=['arrow','open','dot','diamond','bar'], D=[null,'dash','dot','dashdot','long'];
    H.forEach((k,i)=>E.push({id:'h'+i,type:'line',x1:60,y1:60+i*56,x2:400,y2:60+i*56,strokeW:4,stroke:'#002A46',headS:k,headE:k,headStart:true,headEnd:true}));
    D.forEach((k,i)=>E.push({id:'s'+i,type:'line',x1:470,y1:60+i*56,x2:810,y2:60+i*56,strokeW:4,stroke:'#43698F',dash:!!k,dashS:k||undefined,headEnd:true}));
    E.push({id:'r1',type:'line',x1:880,y1:40,x2:1240,y2:180,strokeW:4,stroke:'#002A46',curve:'elbow',headEnd:true},{id:'r2',type:'line',x1:880,y1:200,x2:1240,y2:340,strokeW:4,stroke:'#F78C16',curve:'curve',headE:'arrow',headEnd:true,headS:'dot',headStart:true,dash:true,dashS:'dot'});
    E.push({id:'r3',type:'line',x1:80,y1:380,x2:420,y2:690,strokeW:5,stroke:'#002A46',curve:'elbow',bend:.25,headE:'open',headEnd:true},{id:'r4',type:'line',x1:520,y1:420,x2:1180,y2:420,strokeW:3,stroke:'#43698F',headS:'bar',headE:'bar',headStart:true,headEnd:true},{id:'r5',type:'line',x1:520,y1:640,x2:1180,y2:480,strokeW:6,stroke:'#002A46',curve:'curve',dash:true,dashS:'long',headE:'diamond',headEnd:true});
    __lab({bg:'#FFFFFF',els:E}); });
  await sleep(250); await p.screenshot({path:SH('06-linhas'),clip:{x:0,y:0,width:1280,height:720}}); await p.evaluate(()=>__labOff());

  /* ===================== 6. editor: galeria “Formas ▾” ===================== */
  await p.setViewportSize({width:1280,height:720}); await sleep(300); await fresh(p);
  await p.click('#rib [data-menu=mShape]'); await sleep(300);
  const gal=await p.evaluate(()=>{ const m=document.getElementById('mShape'), r=m.getBoundingClientRect(); return {heads:[...m.querySelectorAll('.mh')].map(x=>x.textContent), tiles:m.querySelectorAll('[data-shape]:not([data-look])').length, looks:[...m.querySelectorAll('[data-look]')].map(x=>x.dataset.look), chev:!!m.querySelector('[data-shape=chevron]'), view:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight, bottom:Math.round(r.bottom), svgs:m.querySelectorAll('button svg').length, names:[...m.querySelectorAll('[data-shape] span')].filter(s=>s.scrollWidth>s.clientWidth+1).map(s=>s.textContent)}; });
  await p.screenshot({path:SH('07-galeria-formas'),clip:await clip(p,'#mShape',10)});
  check('S04-14: “Formas ▾” agrupada (Retângulos e cards · Básicas · Setas · Fluxo · Chaves): 24 formas + 7 cards prontos, todas com miniatura, inteira na janela de 1280×720', gal.heads.join('|')==='Retângulos e cards|Básicas|Setas|Fluxo|Chaves'&&gal.tiles===24&&gal.looks.join()==='outline,lift,accent,topbar,header,gradient,ice'&&gal.chev&&gal.view&&gal.svgs===31&&gal.names.length===0, gal);
  await p.click('#mShape [data-shape=hexagon]'); await sleep(200); const hx=await last(p);
  await p.click('#rib [data-menu=mShape]'); await sleep(200); await p.click('#mShape [data-look=accent]'); await sleep(200); const ca=await last(p);
  await p.click('#rib [data-menu=mShape]'); await sleep(200); await p.click('#mShape [data-shape=braces]'); await sleep(200); const bz=await last(p);
  check('S04-15: galeria insere a forma no tamanho certo (hexágono 300×140), o card pronto (arredondado 320×180, barra lateral, gelo, texto navy) e as chaves só com traço', hx.shape==='hexagon'&&hx.w===300&&hx.h===140&&ca.shape==='round'&&ca.look==='accent'&&ca.fill==='#EEF2F7'&&ca.color==='#002A46'&&ca.w===320&&bz.shape==='braces'&&bz.fill==='none'&&bz.stroke==='#002A46'&&bz.strokeW===3&&bz.color==='#002A46', {hx,ca,bz});
  /* teclado na galeria: ↓ entra na grade; ↓ ↑ trocam de linha na mesma coluna (passando pelos títulos dos grupos); → anda; Enter insere */
  await p.click('#rib [data-menu=mShape]'); await sleep(250);
  const ga=async k=>{ await p.keyboard.press(k); await sleep(60); return p.evaluate(()=>{ const a=document.activeElement; return a&&a.closest('#mShape')?(a.dataset.look||a.dataset.shape):'-'; }); };
  const gk=[await ga('ArrowDown'),await ga('ArrowDown'),await ga('ArrowDown'),await ga('ArrowRight'),await ga('ArrowUp')];
  await p.keyboard.press('ArrowDown'); await sleep(60); await p.keyboard.press('Enter'); await sleep(250); const gt=await last(p);
  check('S04-15b: teclado na galeria “Formas”: ↓ entra (Retângulo), ↓ desce na coluna (Barra no topo → Elipse), → anda (Triângulo), ↑ sobe (Cabeçalho), Enter insere', gk.join()==='rect,topbar,ellipse,triangle,header'&&gt.shape==='triangle', {gk,gt:gt.shape});
  await p.evaluate(()=>{ AMStudio.addSlide('blank-dark'); }); await sleep(200);
  for (const lkk of ['outline','gradient','header']) { await p.click('#rib [data-menu=mShape]'); await sleep(200); await p.click('#mShape [data-look='+lkk+']'); await sleep(150); }
  await p.click('#rib [data-menu=mShape]'); await sleep(200); await p.click('#mShape [data-shape=brackets]'); await sleep(150);
  const dk=(await els(p)).map(e=>[e.look||e.shape,e.fill,e.color,e.strokeW,e.stroke,e.valign].join('/'));
  check('S04-16: no slide escuro: contorno com texto navy; gradiente com fio aço e texto branco; cabeçalho branco com faixa e título no alto; colchetes brancos', dk[0]==='outline/#13315C/#002A46/0/#7EA1C3/middle'&&dk[1]==='gradient/#13315C/#FFFFFF/1.5/#4A6FA5/middle'&&dk[2]==='header/#FFFFFF/#FFFFFF/1.5/#DCE5F0/top'&&dk[3]==='brackets/none/#FFFFFF/3/#FFFFFF/middle', dk);

  /* ===================== 7. “Seta ▾”: linhas prontas ===================== */
  await fresh(p);
  await p.click('#rib [data-add=arrow]'); await sleep(150); const ar=await last(p);
  await p.click('#rib [data-menu=mLine]'); await sleep(250);
  const ml=await p.evaluate(()=>{ const m=document.getElementById('mLine'); return {t:[...m.querySelectorAll('button')].map(b=>b.textContent.trim()), heads:[...m.querySelectorAll('.mh')].map(x=>x.textContent), prev:m.querySelectorAll('button .mi-ln svg .am-hit').length, dash:m.querySelectorAll('button .mi-ln svg .am-lnd').length}; });
  await p.screenshot({path:SH('08-menu-linhas'),clip:await clip(p,'#mLine',10)});
  const LP={}; for (const k of ['line','arrow','double','elbow','curve','dashed','dotball','dim']) { if(k!=='line'){ await p.click('#rib [data-menu=mLine]'); await sleep(180); } await p.click('#mLine [data-line='+k+']'); await sleep(150); const e=await last(p); LP[k]=[e.curve||'-',e.dash?(e.dashS||'dash'):'-',e.headStart?(e.headS||'arrow'):'-',e.headEnd?(e.headE||'arrow'):'-'].join('/'); }
  check('S04-17: “Seta” continua inserindo seta; “▾” traz 8 linhas prontas com miniatura do runtime (Linha · Seta · Seta dupla · conectores em cotovelo e curvo · tracejada · pontilhada com bola · cota)', ar.type==='line'&&ar.headEnd&&!ar.headStart&&ml.t.join('|')==='Linha|Seta|Seta dupla|Conector em cotovelo|Conector curvo|Linha tracejada|Pontilhada com bola|Cota / medida'&&ml.heads.join('|')==='Linhas e setas|Conectores|Estilos'&&ml.prev===8&&ml.dash===2, {ar,ml});
  check('S04-18: cada linha pronta entra com os campos certos', LP.line==='-/-/-/-'&&LP.arrow==='-/-/-/arrow'&&LP.double==='-/-/arrow/arrow'&&LP.elbow==='elbow/-/-/arrow'&&LP.curve==='curve/-/-/arrow'&&LP.dashed==='-/dash/-/-'&&LP.dotball==='-/dot/dot/-'&&LP.dim==='-/-/bar/bar', LP);

  /* ===================== 8. Inserir › Forma ▸ (duas colunas) e Inserir › Linhas e setas ▸ ===================== */
  await fresh(p);
  await p.click('#mbar [data-m=insert]'); await sleep(250);
  const im=await p.evaluate(()=>({forma:[...document.querySelectorAll('.xmenu .xi')].filter(x=>/forma/i.test(x.textContent)).length, t:[...document.querySelectorAll('.xmenu .xi .xl')].map(x=>x.textContent)}));
  for (let i=0;i<4;i++) await p.keyboard.press('ArrowDown'); await sleep(100); await p.keyboard.press('ArrowRight'); await sleep(300);
  const fm=await p.evaluate(()=>{ const m=[...document.querySelectorAll('.xmenu')].pop(), r=m.getBoundingClientRect(); return {cols:m.classList.contains('xcols'), heads:[...m.querySelectorAll('.xhd')].map(x=>x.textContent), items:[...m.querySelectorAll('.xi .xl')].map(x=>x.textContent), hot:(m.querySelector('.xi.hot .xl')||{}).textContent, view:r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth, w:Math.round(r.width), cut:[...m.querySelectorAll('.xi .xl')].filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>x.textContent)}; });
  await p.screenshot({path:SH('09-inserir-forma')});
  const hot=async()=>p.evaluate(()=>([...document.querySelectorAll('.xmenu')].pop().querySelector('.xi.hot .xl')||{}).textContent);
  await p.keyboard.press('ArrowRight'); const k1=await hot(); await p.keyboard.press('ArrowDown'); const k2=await hot(); await p.keyboard.press('ArrowLeft'); const k3=await hot(); await p.keyboard.press('ArrowDown'); const k4=await hot(); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter'); await sleep(250); const pk=await last(p);
  check('S04-19: Inserir tem um só item com “forma” e “Linhas e setas ▸” no lugar de Linha/Seta; Forma ▸ em duas colunas com os 5 grupos, “Retângulo” primeiro, “Cards com estilo ▸”, inteira em 720 px e sem nome cortado', im.forma===1&&im.t.includes('Linhas e setas')&&!im.t.includes('Linha')&&!im.t.includes('Seta')&&fm.cols&&fm.heads.join('|')==='Retângulos e cards|Básicas|Setas|Fluxo|Chaves'&&fm.items.length===25&&fm.items[0]==='Retângulo'&&fm.items.includes('Cards com estilo')&&fm.items.includes('Elipse')&&fm.hot==='Retângulo'&&fm.view&&fm.cut.length===0, {im,fm});
  check('S04-20: teclado na grade de duas colunas: → vai para a coluna ao lado, ↓ ↑ ficam na coluna, Enter insere (Pílula)', k1==='Arredondado'&&k2==='Cards com estilo'&&k3==='Pílula'&&k4==='Elipse'&&pk.shape==='pill', {k1,k2,k3,k4,pk:pk.shape});
  await p.click('#mbar [data-m=insert]'); await sleep(250); await p.locator('.xmenu .xi',{hasText:'Forma'}).hover(); await sleep(350);
  await p.locator('.xmenu .xi',{hasText:'Cards com estilo'}).hover(); await sleep(350);
  const cs=await p.evaluate(()=>[...[...document.querySelectorAll('.xmenu')].pop().querySelectorAll('.xi .xl')].map(x=>x.textContent));
  await p.locator('.xmenu .xi',{hasText:'Elevado'}).click(); await sleep(250); const lf=await last(p);
  await p.click('#mbar [data-m=insert]'); await sleep(250); await p.locator('.xmenu .xi',{hasText:'Linhas e setas'}).hover(); await sleep(350);
  const ls=await p.evaluate(()=>{ const m=[...document.querySelectorAll('.xmenu')].pop(); return {t:[...m.querySelectorAll('.xi .xl')].map(x=>x.textContent), wide:m.classList.contains('xwide'), svg:m.querySelectorAll('.xi .xic svg.lnp').length}; });
  const lw=await p.evaluate(()=>[...[...document.querySelectorAll('.xmenu')].pop().querySelectorAll('svg.lnp')].map(s=>Math.round(s.getBoundingClientRect().width)));
  await p.screenshot({path:SH('10-inserir-linhas')});
  await p.locator('.xmenu .xi',{hasText:'Conector curvo'}).click(); await sleep(250); const cc=await last(p);
  check('S04-21: Cards com estilo ▸ (7 estilos) insere o card escolhido; Linhas e setas ▸ lista as 8 linhas prontas com miniatura e insere', cs.join('|')==='Contorno|Elevado|Barra lateral|Barra no topo|Cabeçalho navy|Gradiente navy|Gelo'&&lf.look==='lift'&&lf.color==='#002A46'&&ls.t.length===8&&ls.wide&&ls.svg===8&&cc.curve==='curve'&&cc.headEnd, {cs,lf:lf.look,ls,cc:cc.curve});
  check('S04-21b: miniaturas de Inserir › Linhas e setas ▸ com 44 px de largura (a regra das formas, 22 px, não as encolhe mais)', lw.length===8&&lw.every(w=>w===44), lw);

  /* ===================== 9. painel da linha ===================== */
  await p.setViewportSize({width:1440,height:900}); await sleep(300); await fresh(p);
  const wb=await (await p.$('#wrap')).boundingBox(); const L=(x,y)=>({x:wb.x+x/1280*wb.width, y:wb.y+y/720*wb.height});
  const lid=await p.evaluate(()=>{ const S=AMStudio, l=Object.assign(S.mk.line(true),{x1:200,y1:520,x2:900,y2:220,strokeW:4}); S.deck.slides[0].els.push(l); S.renderAll(); S.commit(); S.select(l.id); return l.id; }); await sleep(200);
  const L0=async()=>(await els(p))[0];
  const pr=await p.evaluate(()=>({rt:[...document.querySelectorAll('#props .ln-rt button')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')), ds:document.querySelectorAll('#props .ln-dash button svg').length, hs:document.querySelectorAll('#props .ln-hs button').length, he:document.querySelectorAll('#props .ln-he button').length, onHe:(document.querySelector('#props .ln-he button.on')||{}).title, onHs:(document.querySelector('#props .ln-hs button.on')||{}).title, flip:!!document.querySelector('#props [data-act=ln-flip]'), range:!!document.querySelector('#props input[type=range]'), bend:!!document.querySelector('#sel .hdl.bd')}));
  check('S04-22: painel da linha: Traçado (Reta · Cotovelo · Curva), 5 tracejados e 6 pontas de cada lado com miniatura, Inverter; estado atual marcado (seta no fim, sem ponta no início)', pr.rt.join('|')==='Reta*|Cotovelo|Curva'&&pr.ds===5&&pr.hs===6&&pr.he===6&&pr.onHe==='Seta'&&pr.onHs==='Sem ponta'&&pr.flip&&!pr.range&&!pr.bend, pr);
  await p.click('#props [data-act=ln-rt-elbow]'); await sleep(200);
  const e1=await L0(), u1=await p.evaluate(()=>({range:!!document.querySelector('#props input[type=range][data-p=bend]'), bend:!!document.querySelector('#sel .hdl.bd'), on:(document.querySelector('#props .ln-rt button.on')||{}).textContent}));
  await p.click('#bUndo'); await sleep(150); const e1u=await L0(); await p.click('#bRedo'); await sleep(150); await p.evaluate(id=>AMStudio.select(id),lid); await sleep(150);
  check('S04-23: “Cotovelo” vira conector em cotovelo num passo de desfazer, com a dobra no painel e a alça laranja no slide', e1.curve==='elbow'&&u1.range&&u1.bend&&u1.on==='Cotovelo'&&e1u.curve===undefined, {e1:e1.curve,u1,e1u:e1u.curve});
  /* arrastar a alça da dobra */
  const hb=await (await p.$('#sel .hdl.bd')).boundingBox(); const h0={x:hb.x+hb.width/2,y:hb.y+hb.height/2}, to=L(410,370);
  await p.mouse.move(h0.x,h0.y); await p.mouse.down(); await p.mouse.move((h0.x+to.x)/2,h0.y+20,{steps:4}); await p.mouse.move(to.x,h0.y+40,{steps:4}); await p.mouse.up(); await sleep(200);
  const e2=await L0(), hb2=await (await p.$('#sel .hdl.bd')).boundingBox(), rv=await p.evaluate(()=>+document.querySelector('#props input[type=range][data-p=bend]').value);
  await p.screenshot({path:SH('11-dobra-arrastada'),clip:{x:wb.x,y:wb.y,width:wb.width,height:wb.height}});
  await p.click('#bUndo'); await sleep(150); const e2u=await L0(); await p.click('#bRedo'); await sleep(150); await p.evaluate(id=>AMStudio.select(id),lid); await sleep(150);
  check('S04-24: arrastar a alça move a dobra (50 % → 30 %, só no eixo do segmento), a alça acompanha, o painel atualiza e um desfazer volta', Math.abs(e2.bend-.3)<=.02&&Math.abs((hb2.x+hb2.width/2)-to.x)<3&&Math.abs(rv-e2.bend)<.03&&e2u.bend===undefined&&e2.x1===200&&e2.y2===220, {bend:e2.bend,rv,hx:hb2.x+hb2.width/2,to:to.x,e2u:e2u.bend});
  await p.evaluate(()=>{ const r=document.querySelector('#props input[type=range][data-p=bend]'); r.value='0.75'; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); }); await sleep(150);
  const e3=await L0(), hp=await p.evaluate(()=>{ const h=document.querySelector('#sel .hdl.bd'); return h&&parseFloat(h.style.left); });
  check('S04-25: o controle deslizante “Dobra do cotovelo” também move a dobra (e a alça)', e3.bend===.75&&Math.abs(hp-(200+700*.75)/1280*100)<.05, {bend:e3.bend,hp});
  const st=async a=>{ await p.click('#props [data-act='+a+']'); await sleep(140); const e=await L0(); return [e.dash?(e.dashS||'dash'):'-',e.headStart?(e.headS||'arrow'):'-',e.headEnd?(e.headE||'arrow'):'-',e.hasOwnProperty('dashS')?'S':'',e.hasOwnProperty('headE')?'E':''].join('/'); };
  const sq=[await st('ln-dash-dot'),await st('ln-dash-dashdot'),await st('ln-dash-dash'),await st('ln-hs-diamond'),await st('ln-he-open'),await st('ln-he-arrow'),await st('ln-he-none'),await st('ln-dash-none')];
  check('S04-26: tracejado e pontas gravam o booleano antigo junto; “Seta” e “Tracejada” padrão não gravam o tipo (arquivo continua legível pelo código antigo)', sq.join(' ')==='dot/-/arrow/S/ dashdot/-/arrow/S/ dash/-/arrow// dash/diamond/arrow// dash/diamond/open//E dash/diamond/arrow// dash/diamond/-// -/diamond/-//', sq);
  await p.click('#props [data-act=ln-he-dot]'); await sleep(120); const f0=await L0(); await p.click('#props [data-act=ln-flip]'); await sleep(150); const f1=await L0();
  const onAfter=await p.evaluate(()=>[(document.querySelector('#props .ln-hs button.on')||{}).title,(document.querySelector('#props .ln-he button.on')||{}).title]);
  check('S04-27: “Inverter” troca início e fim, as pontas vão junto e a dobra espelha', f1.x1===f0.x2&&f1.y1===f0.y2&&f1.x2===f0.x1&&f1.headS==='dot'&&f1.headE==='diamond'&&f1.headStart&&f1.headEnd&&f1.bend===.25&&onAfter.join()==='Bola,Losango', {f0,f1,onAfter});
  await p.click('#props [data-act=ln-rt-curve]'); await sleep(150); const e4=await L0(), u4=await p.evaluate(()=>({range:!!document.querySelector('#props input[type=range]'), bend:!!document.querySelector('#sel .hdl.bd')}));
  await p.screenshot({path:SH('12-painel-linha'),clip:await clip(p,'#props',0)});
  check('S04-28: “Curva” vira conector curvo e some a dobra (painel e alça)', e4.curve==='curve'&&!u4.range&&!u4.bend, {e4:e4.curve,u4});
  /* IX-04 continua: clique no traço do cotovelo seleciona a linha; longe dele, não */
  await p.evaluate(id=>{ const e=AMStudio.deck.slides[0].els[0]; Object.assign(e,{x1:200,y1:520,x2:900,y2:220,curve:'elbow',bend:.5}); AMStudio.renderAll(); AMStudio.commit(); AMStudio.select(null); },lid); await sleep(150);
  let pt=L(550,370); await p.mouse.click(pt.x,pt.y); await sleep(120); const s1=await p.evaluate(()=>AMStudio.selected());
  await p.keyboard.press('Escape'); pt=L(400,300); await p.mouse.click(pt.x,pt.y); await sleep(120); const s2=await p.evaluate(()=>AMStudio.selected());
  check('S04-29: clique no segmento vertical do cotovelo seleciona a linha; clique no vazio da caixa (fora do traço) não', s1[0]===lid&&s2.length===0, {s1,s2});

  /* ===================== 10. painel da forma ===================== */
  await fresh(p);
  const sid=await p.evaluate(()=>{ const S=AMStudio, e=Object.assign(S.mk.shape('round'),{html:'Resultado'}); S.deck.slides[0].els.push(e); S.renderAll(); S.commit(); S.select(e.id); return e.id; }); await sleep(200);
  const S0=async()=>(await els(p))[0];
  const sp=await p.evaluate(()=>({og:[...document.querySelectorAll('#props select[data-p=shape] optgroup')].map(o=>o.label+':'+o.children.length), sel:document.querySelector('#props select[data-p=shape]').value, lk:[...document.querySelectorAll('#props .lkg button')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')), fill:[...document.querySelectorAll('#props .pf>span')].some(s=>s.textContent==='Preenchimento')}));
  check('S04-30: painel da forma: Tipo agrupado (5 grupos, 24 formas) e “Estilo do card” com 8 miniaturas (Chapado marcado)', sp.og.join('|')==='Retângulos e cards:3|Básicas:10|Setas:5|Fluxo:4|Chaves:2'&&sp.sel==='round'&&sp.lk.join('|')==='Chapado*|Contorno|Elevado|Barra lateral|Barra no topo|Cabeçalho|Gradiente|Gelo'&&sp.fill, sp);
  const lookSeq=[]; for (const k of ['outline','header','gradient','flat']) { await p.click('#props [data-act=look-'+k+']'); await sleep(150); const e=await S0(); lookSeq.push([e.look||'-',e.fill,e.color,e.valign].join('/')); if(k==='header'){ await p.screenshot({path:SH('13-painel-card'),clip:await clip(p,'#props',0)}); } }
  const note=await p.evaluate(()=>/faixa azul-marinho/.test(document.getElementById('props').textContent));
  await p.click('#bUndo'); await sleep(150); const lu=await S0();
  check('S04-31: estilo do card mantém o texto legível: contorno → texto navy; cabeçalho → card branco, título branco no alto; gradiente → texto branco; chapado de volta ao meio; desfazer volta um passo', lookSeq.join(' ')==='outline/#002A46/#002A46/middle header/#FFFFFF/#FFFFFF/top gradient/#FFFFFF/#FFFFFF/middle -/#FFFFFF/#002A46/middle'&&lu.look==='gradient', {lookSeq,lu:lu.look});
  await p.selectOption('#props select[data-p=shape]','ellipse'); await sleep(200); const noLk=await p.evaluate(()=>!document.querySelector('#props .lkg'));
  await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0]; e.fill='#43698F'; e.color='#FFFFFF'; AMStudio.renderAll(); AMStudio.commit(); AMStudio.select(e.id); }); await sleep(150);
  await p.selectOption('#props select[data-p=shape]','brackets'); await sleep(200);
  const bk=await S0(), bkp=await p.evaluate(()=>{ const t=[...document.querySelectorAll('#props .pf>span')].map(s=>s.textContent); return {fill:t.includes('Preenchimento'), cor:t.includes('Cor do traço'), rad:t.some(x=>/Arredondamento/.test(x))}; });
  await p.selectOption('#props select[data-p=shape]','rect'); await sleep(200); const bk2=await S0();
  check('S04-32: estilo do card só em retângulo/arredondado/pílula; trocar para colchetes leva a cor para o traço (3 px) e o painel mostra “Cor do traço” sem preenchimento; voltar mantém a forma cheia', noLk&&bk.shape==='brackets'&&bk.stroke==='#43698F'&&bk.strokeW===3&&bk.color==='#002A46'&&!bkp.fill&&bkp.cor&&!bkp.rad&&bk2.shape==='rect'&&bk2.fill==='#43698F', {noLk,bk,bkp,bk2});

  /* ===================== 10b. QA S4 rodada 1 ===================== */
  /* trocar o Tipo de um card com estilo para forma sem estilo: as cores que se viam vão para a forma nova e o texto continua legível */
  const lum=c=>{ const n=parseInt(String(c).slice(1),16); return (.299*(n>>16)+.587*(n>>8&255)+.114*(n&255))/255; };
  const swc=[];
  for (const dark of [false,true]) for (const lk of ['outline','lift','accent','topbar','header','gradient','ice']) {
    await fresh(p); if(dark) await p.evaluate(()=>{ AMStudio.deck.slides[0].bg='#002A46'; AMStudio.renderAll(); });
    await p.click('#rib [data-menu=mShape]'); await sleep(150); await p.click('#mShape [data-look='+lk+']'); await sleep(150);
    await p.selectOption('#props select[data-p=shape]','hexagon'); await sleep(150); const e=await last(p);
    swc.push({k:(dark?'navy:':'')+lk, fill:e.fill, color:e.color, look:e.look||'', d:Math.round(Math.abs(lum(e.fill)-lum(e.color))*100)/100, lks:await p.evaluate(()=>!!document.querySelector('#props .lkg'))}); }
  await p.selectOption('#props select[data-p=shape]','round'); await sleep(150); const swb=await last(p);
  check('S04-38: os 7 cards prontos viram hexágono com texto legível (branco ≠ preenchimento claro, navy ≠ navy), no slide branco e no azul-marinho; o estilo sai do elemento', swc.length===14&&swc.every(x=>x.d>=.5&&!x.look&&!x.lks)&&swc.find(x=>x.k==='outline').fill==='#FFFFFF'&&swc.find(x=>x.k==='header').fill==='#002A46'&&swc.find(x=>x.k==='navy:header').fill==='#FFFFFF'&&swb.shape==='round'&&!swb.look, swc);
  await fresh(p); await p.click('#rib [data-menu=mShape]'); await sleep(150); await p.click('#mShape [data-look=header]'); await sleep(150);
  await p.selectOption('#props select[data-p=shape]','braces'); await sleep(150); const hz1=await last(p);
  await p.selectOption('#props select[data-p=shape]','rect'); await sleep(150); const hz2=await last(p);
  check('S04-38b: card “Cabeçalho” → chaves: traço navy visível no slide branco (não branco no branco); de volta a retângulo, texto contrasta com o preenchimento', hz1.stroke==="#002A46"&&hz1.color==="#002A46"&&!hz1.look&&hz2.fill==="#002A46"&&hz2.color==="#FFFFFF", {hz1,hz2});
  /* cabeçalho navy: a faixa acompanha o título */
  await fresh(p);
  const hdb=await p.evaluate(()=>{ const S=AMStudio, mk=(id,x,w,h,html,o)=>Object.assign(S.mk.shape('round'),{id,x,y:100,w,h,html,look:'header',fill:'#FFFFFF',strokeW:1.5,stroke:'#DCE5F0',valign:'top',color:'#FFFFFF'},o||{});
    S.deck.slides[0].els.push(mk('H1',60,320,180,'Receita'),mk('H2',420,200,100,'Diagnóstico financeiro'),mk('H3',660,320,180,'Receita',{valign:'bottom'}),mk('H4',1000,240,160,'',{shape:'pill'})); S.renderAll();
    const k=document.getElementById('wrap').getBoundingClientRect().width/1280;
    return ['H1','H2','H3','H4'].map(id=>{ const n=document.querySelector('#wrap .am-el[data-id='+id+']'), t=n.querySelector('.am-tx'), r=n.getBoundingClientRect(), q=t.getBoundingClientRect(), rg=document.createRange(); rg.selectNodeContents(t); const tr=rg.getBoundingClientRect();
      return {bg:getComputedStyle(t).backgroundColor, top:Math.round((q.top-r.top)/k), band:Math.round(q.height/k), w:Math.round(q.width/k), h:Math.round(r.height/k), inB:!t.textContent||(tr.bottom<=q.bottom+.5&&tr.top>=q.top-.5), lines:t.textContent?Math.round(tr.height/k/24):0}; }); });
  await p.screenshot({path:SH('16-cabecalho-faixa'),clip:{x:(await (await p.$('#wrap')).boundingBox()).x,y:(await (await p.$('#wrap')).boundingBox()).y,width:900,height:260}});
  check('S04-39: cabeçalho navy: a faixa (fundo navy do título) vai de borda a borda, tem no mínimo 26 % do card, cresce com o título (2 linhas no card 200×100) e o texto fica sempre dentro dela, mesmo com “texto na base”', hdb.every(x=>x.bg==='rgb(0, 42, 70)'&&x.top===0&&x.inB&&x.band>=Math.round(x.h*.26)-1)&&hdb[0].w===320&&hdb[1].lines>=2&&hdb[1].band>=hdb[1].lines*24+14&&hdb[1].band<hdb[1].h&&hdb[2].top===0&&hdb[3].band===Math.round(160*.26), hdb);
  /* Preenchimento: Contorno, Elevado, Gelo e Gradiente definem a cor (as amostras não teriam efeito): nota no lugar das amostras */
  await fresh(p); await p.evaluate(()=>{ const S=AMStudio, e=Object.assign(S.mk.shape('round'),{html:'X'}); S.deck.slides[0].els.push(e); S.renderAll(); S.commit(); S.select(e.id); }); await sleep(150);
  const fv={}; for (const k of ['outline','lift','ice','gradient','flat','accent','topbar','header']) { await p.click('#props [data-act=look-'+k+']'); await sleep(120); fv[k]=await p.evaluate(()=>(document.querySelector('#props [data-set=fill]')?'sw':'')+(document.querySelector('#props .lk-fill')?'nota':'')); }
  check('S04-40: Preenchimento com nota (sem amostras mortas) em Contorno, Elevado, Gelo e Gradiente; amostras em Chapado, Barras e Cabeçalho', ['outline','lift','ice','gradient'].every(k=>fv[k]==='nota')&&['flat','accent','topbar','header'].every(k=>fv[k]==='sw'), fv);

  /* ===================== 10c. QA S4 rodada 2 ===================== */
  /* Anel inserido pela galeria: o texto fica no furo, sobre o fundo do slide, então leva a cor de texto do slide (antes: branco no branco) */
  const rg=[];
  for (const dark of [false,true]) {
    await fresh(p); if(dark) await p.evaluate(()=>{ AMStudio.deck.slides[0].bg='#002A46'; AMStudio.renderAll(); });
    await p.click('#rib [data-menu=mShape]'); await sleep(150); await p.click('#mShape [data-shape=ring]:not([data-look])'); await sleep(200);
    const bx=await p.locator('#wrap .am-stage .am-el').last().boundingBox();
    await p.mouse.dblclick(bx.x+bx.width/2,bx.y+bx.height/2); await sleep(150); await p.keyboard.type('Ciclo'); await sleep(150); await p.keyboard.press('Escape'); await sleep(150);
    const e=await last(p), g=await p.evaluate(()=>{ const n=document.querySelector('#wrap .am-stage .am-el:last-child'), r=n.getBoundingClientRect(), t=n.querySelector('.am-tx'), q=document.createRange(); q.selectNodeContents(t); const b=q.getBoundingClientRect();
      const cx=r.left+r.width/2, cy=r.top+r.height/2, hr=r.width*.35; return {inHole:[[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]].every(([x,y])=>Math.hypot(x-cx,y-cy)<=hr), col:getComputedStyle(t.parentNode).color}; });
    const shot=await p.screenshot({clip:bx}); const ink=await p.evaluate(async([b64,bg])=>{ const im=new Image(); im.src='data:image/png;base64,'+b64; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height; const x=c.getContext('2d'); x.drawImage(im,0,0);
      const w=im.width, h=im.height, d=x.getImageData(Math.round(w*.3),Math.round(h*.4),Math.round(w*.4),Math.round(h*.2)).data; let n=0; for(let i=0;i<d.length;i+=4){ const l=(d[i]*.299+d[i+1]*.587+d[i+2]*.114); if(bg?l>150:l<110) n++; } return n; },[shot.toString('base64'),dark]);
    rg.push({dark, html:e.html, color:e.color, fill:e.fill, d:Math.round(Math.abs(lum(e.color)-lum(dark?'#002A46':'#FFFFFF'))*100)/100, inHole:g.inHole, ink}); }
  check('S04-41: Anel pela galeria (branco e azul-marinho): texto digitado fica no furo, na cor de texto do slide (navy no branco, branco no azul) e aparece de verdade (pixels de tinta no furo); no escuro o anel sai em aço', rg.every(x=>x.html==='Ciclo'&&x.d>=.5&&x.inHole&&x.ink>=30)&&rg[0].color==='#002A46'&&rg[1].color==='#FFFFFF'&&rg[1].fill==='#43698F', rg);
  /* Tipo → Anel e de volta: a cor do texto acompanha (furo = fundo do slide; forma cheia = contraste com o preenchimento) */
  await fresh(p); await p.evaluate(()=>{ const S=AMStudio, e=Object.assign(S.mk.shape('hexagon'),{html:'Ciclo'}); S.deck.slides[0].els.push(e); S.renderAll(); S.commit(); S.select(e.id); }); await sleep(150);
  const rs=[]; for (const k of ['ring','hexagon','ring','braces','ring']) { await p.selectOption('#props select[data-p=shape]',k); await sleep(120); const e=await S0(); rs.push(k+':'+e.color); }
  await p.evaluate(()=>{ AMStudio.deck.slides[0].bg='#002A46'; AMStudio.renderAll(); AMStudio.select(AMStudio.deck.slides[0].els[0].id); }); await sleep(120);
  await p.selectOption('#props select[data-p=shape]','rect'); await sleep(120); await p.selectOption('#props select[data-p=shape]','ring'); await sleep(120); rs.push('navy:ring:'+(await S0()).color);
  check('S04-42: trocar o Tipo para Anel põe o texto na cor do slide (navy no branco, branco no azul); voltar para forma cheia devolve o contraste com o preenchimento; chaves ↔ anel também', rs.join(' ')==='ring:#002A46 hexagon:#FFFFFF ring:#002A46 braces:#002A46 ring:#002A46 navy:ring:#FFFFFF', rs);
  /* estrela e anel no tamanho padrão: palavras comuns numa linha só (antes “Priorid/ade”, “Me/ta”), no palco 1:1 e em escala de celular */
  const wbk=await p.evaluate(()=>{ const S=AMStudio, W=[['star','Prioridade'],['star','Diagnóstico'],['star','Meta',150],['ring','Ciclo'],['ring','Crescimento'],['ring','Investimento'],['star','Visão de futuro']], out=[];
    for (const scale of [1280,390]) { const host=document.createElement('div'); host.style.cssText='position:fixed;left:0;top:0;z-index:99999;width:'+scale+'px'; document.body.appendChild(host);
      const els=W.map((w,i)=>Object.assign(S.mk.shape(w[0]),{id:'w'+i,html:w[1],x:10+i*180,y:200},w[2]?{w:w[2],h:w[2]}:{})); const st=AMRT.renderSlide({bg:'#FFFFFF',els},{}); host.appendChild(st);
      st.querySelectorAll('.am-el').forEach((n,i)=>{ const q=document.createRange(); q.selectNodeContents(n.querySelector('.am-tx')); out.push(scale+':'+W[i][1]+'='+new Set([...q.getClientRects()].map(r=>Math.round(r.top))).size); }); host.remove(); }
    return out; });
  check('S04-43: estrela (200 e 150) e anel no tamanho padrão: “Prioridade”, “Diagnóstico”, “Meta”, “Ciclo”, “Crescimento”, “Investimento” numa linha só; “Visão de futuro” em 2 linhas, sem quebrar palavra (1:1 e escala de celular)', wbk.filter(x=>!/Visão/.test(x)).every(x=>/=1$/.test(x))&&wbk.filter(x=>/Visão/.test(x)).every(x=>/=2$/.test(x))&&wbk.length===14, wbk);
  /* Cabeçalho: o título fica sempre na faixa do alto, então o alinhamento vertical aparece desativado (no topo); Chapado reativa */
  await fresh(p); await p.click('#rib [data-menu=mShape]'); await sleep(150); await p.click('#mShape [data-look=header]'); await sleep(150);
  const va=async()=>p.evaluate(()=>[...document.querySelectorAll('#props [data-set=valign]')].map(b=>b.dataset.v+(b.disabled?'-':'')+(b.classList.contains('on')?'*':'')).join(' '));
  const va1=await va(); await p.click('#props [data-set=valign][data-v=bottom]',{force:true,timeout:1500}).catch(()=>{}); await sleep(120); const vh=(await last(p)).valign;
  await p.click('#props [data-act=look-flat]'); await sleep(150); const va2=await va(); await p.click('#props [data-set=valign][data-v=bottom]'); await sleep(120); const vf=(await last(p)).valign;
  check('S04-44: card Cabeçalho: botões de alinhamento vertical desativados (topo marcado) e o clique não muda nada; no Chapado voltam a funcionar', va1==='top-* middle- bottom-'&&vh==='top'&&va2==='top middle* bottom'&&vf==='bottom', {va1,vh,va2,vf});
  /* slide escuro: forma nova em aço (#43698F, visível no azul-marinho, texto branco); card pronto continua tom sobre tom (#13315C) */
  await fresh(p); await p.evaluate(()=>{ AMStudio.deck.slides[0].bg='#002A46'; AMStudio.renderAll(); });
  const dfs=[]; for (const k of ['rect','hexagon','star']) { await p.click('#rib [data-menu=mShape]'); await sleep(120); await p.click('#mShape [data-shape='+k+']:not([data-look])'); await sleep(120); const e=await last(p); dfs.push(k+':'+e.fill+':'+e.color); }
  await p.click('#rib [data-menu=mShape]'); await sleep(120); await p.click('#mShape [data-look=accent]'); await sleep(120); const dca=await last(p);
  check('S04-45: no slide azul-marinho as formas novas saem em aço #43698F com texto branco (contraste com o fundo); o card “Barra lateral” continua #13315C', dfs.join(' ')==='rect:#43698F:#FFFFFF hexagon:#43698F:#FFFFFF star:#43698F:#FFFFFF'&&dca.fill==='#13315C'&&Math.abs(lum('#43698F')-lum('#002A46'))>=.2, {dfs,dca:dca.fill});

  /* ===================== 11. salvar → reabrir; arquivo exportado; player ===================== */
  await fresh(p);
  await p.evaluate(()=>{ const S=AMStudio, s=S.deck.slides[0], E=s.els;
    E.push(Object.assign(S.mk.line(true),{id:'L1',x1:80,y1:120,x2:560,y2:120,strokeW:5,dash:true,anim:{in:'draw',dur:700}}));
    E.push(Object.assign(S.mk.line(true),{id:'L2',x1:80,y1:240,x2:560,y2:400,curve:'elbow',bend:.35,dash:true,dashS:'dashdot',headS:'dot',headStart:true,headE:'diamond',strokeW:4,anim:{in:'draw',dur:600}}));
    E.push(Object.assign(S.mk.line(true),{id:'L3',x1:80,y1:640,x2:560,y2:480,curve:'curve',dash:true,dashS:'dot',headE:'open',strokeW:5,stroke:'#F78C16',anim:{in:'none',loop:'flow'}}));
    E.push(Object.assign(S.mk.line(false),{id:'L4',x1:640,y1:680,x2:1220,y2:680,headS:'bar',headE:'bar',headStart:true,headEnd:true}));
    [['K1','lift',640,60],['K2','ice',950,60],['K3','header',640,300],['K4','accent',950,300]].forEach(([id,l,x,y])=>{ const c=Object.assign(S.mk.shape('round'),{id,x,y,w:280,h:200,look:l,html:'Card '+l,color:'#002A46'}); if(l==='header'){ c.fill='#FFFFFF'; c.strokeW=1.5; c.stroke='#DCE5F0'; c.color='#FFFFFF'; c.valign='top'; } if(l==='accent') c.fill='#EEF2F7'; E.push(c); });
    E.push(Object.assign(S.mk.shape('callout'),{id:'K5',x:660,y:520,w:240,h:130,html:'Balão'}),Object.assign(S.mk.shape('cylinder'),{id:'K6',x:1060,y:520,w:110,h:140,html:'Base'}));
    S.renderAll(); S.commit(); });
  await sleep(300);
  const edMk=await p.evaluate(()=>{ const o={}; document.querySelectorAll('#wrap .am-stage .am-el').forEach(n=>{ o[n.dataset.id]=n.querySelector('.am-fxw').innerHTML.replace(/\b(lm|kl)[0-9a-z]+/g,'ID'); }); return o; });
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const xf=path.join(TMP,'s04.html'); fs.writeFileSync(xf,html);
  const dj=deckJSON(html), re=await p.evaluate(d=>{ AMStudio.loadDeck(d,null,true,true); return AMStudio.deck.slides[0].els.map(e=>[e.id,e.curve,e.bend,e.dashS,e.headS,e.headE,e.look].join('/')); },dj);
  check('S04-33: salvar e reabrir mantém rota, dobra, tracejado, pontas e estilo do card (inclusive Elevado e Gelo)', re.join(' ')==='L1////// L2/elbow/0.35/dashdot/dot/diamond/ L3/curve//dot//open/ L4////bar/bar/ K1//////lift K2//////ice K3//////header K4//////accent K5////// K6//////', re);
  check('S04-34: arquivo exportado leva rt-10 dentro do runtime, sem on* (CR-04) e com am-deck-data', /R\.SHAPES_X\s*=/.test(html)&&/amxDash/.test(html)&&!/onerror|onmouseover|onclick/i.test(html)&&/id="am-deck-data"/.test(html)&&!/R\.SHAPES_X[\s\S]*<\/script[\s\S]*R\.lineBendPt/.test(html));
  const xp=await page(ctx,'file://'+xf,'exp',1800); await xp.setViewportSize({width:1280,height:720}); await sleep(400);
  const xMk=await xp.evaluate(()=>{ const o={}; document.querySelectorAll('.amp-slide.on .am-el').forEach(n=>{ o[n.dataset.id]=n.querySelector('.am-fxw').innerHTML.replace(/\b(lm|kl)[0-9a-z]+/g,'ID'); }); return {o, ed:typeof window.AMStudio}; });
  const same=Object.keys(edMk).filter(k=>edMk[k]!==xMk.o[k]);
  check('S04-35: no player exportado cada linha e forma sai com a mesma marcação do editor (rotas, pontas, tracejados, cards)', Object.keys(edMk).length===10&&same.length===0&&xMk.ed==='undefined', {same});
  await sleep(600); const xs=await xp.screenshot(); fs.writeFileSync(SH('14-export-1280'),xs);
  const lnR=await xp.evaluate(()=>{ const r=id=>{ const q=document.querySelector('.amp-slide.on [data-id='+id+'] .am-lnd').getBoundingClientRect(); return {x0:q.left,x1:q.right,y:q.top+q.height/2}; }; const m=document.querySelector('.amp-slide.on [data-id=L3]');
    return {l1:r('L1'), css:getComputedStyle(document.querySelector('.amp-slide.on [data-id=L1] .am-lnd')).strokeDasharray, flow:getComputedStyle(m.querySelector('.am-lnd')).animationName, flowMask:getComputedStyle(m.querySelector('mask .am-ln')).animationName, pos:document.querySelector('.amp-pos').textContent}; });
  const xr=await runs(xp,xs,lnR.l1.y,lnR.l1.x0+4,lnR.l1.x1-4);
  check('S04-36: no player, a tracejada com “Desenhar” termina tracejada; “Fluxo contínuo” anda o próprio tracejado (amxDash) com a máscara parada', xr.n>=12&&lnR.css!=='1px'&&lnR.css!=='none'&&lnR.flow==='amxDash'&&lnR.flowMask==='none'&&/^01/.test(lnR.pos), {xr,lnR});
  await xp.setViewportSize({width:390,height:844}); await sleep(500); await xp.screenshot({path:SH('15-export-390')});
  const bar=await xp.evaluate(()=>{ const r=s=>document.querySelector(s).getBoundingClientRect(), wm=r('.amp-wm'), pv=r('.amp-b[data-a=prev]'), nx=r('.amp-b[data-a=next]'), fl=r('.amp-b[data-a=full]'), vis=s=>getComputedStyle(document.querySelector(s)).display!=='none';
    return {wm:[Math.round(wm.left),Math.round(wm.right)], pv:Math.round(pv.left), gap:Math.round(pv.left-wm.right), fit:nx.right<=fl.left&&fl.right<=innerWidth, words:vis('.amp-b[data-a=prev] .amp-bw'), title:vis('.amp-brand span'), name:document.querySelector('.amp-b[data-a=prev]').getAttribute('aria-label')}; });
  await xp.setViewportSize({width:1280,height:720}); await sleep(300); const bar2=await xp.evaluate(()=>({words:getComputedStyle(document.querySelector('.amp-b[data-a=prev] .amp-bw')).display!=='none', txt:document.querySelector('.amp-b[data-a=prev]').textContent+'|'+document.querySelector('.amp-b[data-a=next]').textContent}));
  check('S04-46: player a 390 px: a marca A&M aparece inteira (sem o “← Anterior” por cima), botões só com a seta (nome acessível mantido) e tudo cabe; a 1280 px os rótulos voltam', bar.wm[0]>=8&&bar.gap>=8&&bar.fit&&!bar.words&&!bar.title&&bar.name==='Anterior'&&bar2.words&&bar2.txt==='← Anterior|Próximo →', {bar,bar2});
  await xp.close();
  { const rc=await b.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}); const rp=await page(rc,'file://'+xf,'reduz',700);
    const r=await rp.evaluate(()=>{ const q=document.querySelector('.amp-slide.on [data-id=L1] .am-lnd').getBoundingClientRect(); return {x0:q.left,x1:q.right,y:q.top+q.height/2}; }); const rs=await rp.screenshot();
    const rr=await runs(rp,rs,r.y,r.x0+4,r.x1-4); check('S04-37: movimento reduzido: a tracejada já aparece inteira e tracejada', rr.n>=12, rr); await rc.close(); }

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length}));
  await b.close(); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(x){} process.exit(2); });
