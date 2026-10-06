/* S20 — “Cores do componente”: cor principal (no lugar do azul-marinho/azuis) e cor de destaque (no lugar do laranja) em qualquer
   componente (modelos, matrizes, cards, SmartArt, gráficos, cronogramas). Pela interface real: Modelos › SWOT, painel “Cores do
   componente” (amostras + seletor de cor), menu de contexto “Cores do componente…”, Restaurar cores A&M, Ctrl+Z, salvar → reabrir,
   arquivo exportado (player + Ampliar por duplo clique), valores hostis, desempenho sem paleta, zero erros de console, CR-04.
   Uso: python3 assemble.py && node test-s20-recolor.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s20-'+n+'.png');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,1500):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(800); return p; }
/* ferramentas de página: varredura de cores computadas e contraste dos textos */
const TOOLS=()=>{
  const P=['fill','stroke','color','background-color','background-image','border-top-color','border-right-color','border-bottom-color','border-left-color','outline-color','box-shadow','text-decoration-color','stop-color','flood-color'];
  const AM=/rgba?\(0, 42, 70[,)]|rgba?\(247, 140, 22[,)]/;
  /* cores A&M (navy, laranja) ainda visíveis em qualquer descendente (ignora traços/contornos de largura 0 e bordas sem estilo) */
  window.__am=(root)=>{ const bad=[]; [root,...root.querySelectorAll('*')].forEach(e=>{ const cs=getComputedStyle(e); P.forEach(p=>{ const v=cs.getPropertyValue(p); if(!AM.test(v)) return;
      if(/^border-(\w+)-color$/.test(p)){ const s=p.split('-')[1]; if(cs.getPropertyValue('border-'+s+'-style')==='none'||parseFloat(cs.getPropertyValue('border-'+s+'-width'))===0) return; }
      if(p==='outline-color'&&(cs.outlineStyle==='none'||parseFloat(cs.outlineWidth)===0)) return;
      if(p==='text-decoration-color'&&!/underline|overline|line-through/.test(cs.textDecorationLine)) return;
      bad.push(((e.getAttribute('class')||e.tagName)+'').slice(0,40)+' '+p+' '+v.slice(0,50)); }); }); return bad; };
  window.__amCount=(root)=>{ let n=0; [root,...root.querySelectorAll('*')].forEach(e=>{ const cs=getComputedStyle(e); P.forEach(p=>{ if(AM.test(cs.getPropertyValue(p))) n++; }); }); return n; };
  const rgb=s=>{ const m=/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(s||''); return m?[+m[1],+m[2],+m[3],m[4]==null?1:+m[4]]:null; };
  const lin=c=>{ c/=255; return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4); }, lum=c=>.2126*lin(c[0])+.7152*lin(c[1])+.0722*lin(c[2]);
  const bgOf=(e)=>{ for(let x=e;x;x=x.parentElement){ const c=rgb(getComputedStyle(x).backgroundColor); if(c&&c[3]>.5) return c; if(x.classList&&x.classList.contains('am-stage')) break; } return [255,255,255,1]; };
  /* contraste de cada texto HTML (fora de SVG) contra o fundo opaco mais próximo, na ordem do DOM */
  window.__contrast=(root)=>{ const out=[]; [root,...root.querySelectorAll('*')].forEach(e=>{ if(e.closest('svg')) return; if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())) return;
      const cs=getComputedStyle(e); if(cs.visibility==='hidden'||cs.display==='none') return; const f=rgb(cs.color), b=bgOf(e); if(!f) return;
      const a=lum(f), c=lum(b); out.push({c:+((Math.max(a,c)+.05)/(Math.min(a,c)+.05)).toFixed(2), acc:orange(f)||orange(b)}); }); return out; };
  /* família laranja (o destaque A&M): texto ou fundo laranja dependem do par escolhido (o painel avisa quando falta contraste) */
  const hsl=c=>{ const r=c[0]/255,g=c[1]/255,b=c[2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn; let h=0,s=0; if(d){ s=l>.5?d/(2-mx-mn):d/(mx+mn); h=(mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4)*60; } return [h,s,l]; };
  const orange=c=>{ const x=hsl(c); return x[1]>=.5&&x[0]>=20&&x[0]<=45; };
  /* quantos descendentes pintam fundo/fill no matiz pedido (± 10°, saturação ≥ 0,15) */
  window.__hue=(root,H)=>[root,...root.querySelectorAll('*')].filter(e=>{ const cs=getComputedStyle(e); return [cs.backgroundColor,cs.fill].some(v=>{ const c=rgb(v); if(!c||c[3]<.3) return false; const x=hsl(c); return x[1]>=.15&&Math.abs(x[0]-H)<=10&&x[2]>.03&&x[2]<.97; }); }).length;
};
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed'); await p.evaluate(TOOLS);
  const PAL={p:'#1B7F3B',a:'#C0392B'};
  const els=()=>p.evaluate(()=>AMStudio.deck.slides[AMStudio.cur].els);
  const center=async(id)=>{ const r=await p.evaluate(id=>{ const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]').getBoundingClientRect(); return {x:n.x+n.width/2,y:n.y+n.height/2}; },id); return r; };

  /* ---------- 1. SWOT pela Biblioteca de modelos; seção “Cores do componente” logo depois de “Conteúdo” ---------- */
  await p.click('#bModels'); await sleep(900);
  await p.click('#modelsBody [data-ins=swot]'); await sleep(1200);
  await p.keyboard.press('Escape'); await sleep(200);
  let E=await els(); const sw=E[E.length-1];
  await p.evaluate(id=>AMStudio.select(id), sw.id); await sleep(250);
  const secs=await p.evaluate(()=>[...document.querySelectorAll('#props .sec>h3')].map(h=>h.textContent.trim()));
  const iC=secs.indexOf('Conteúdo'), iP=secs.indexOf('Cores do componente');
  const ui0=await p.evaluate(()=>{ const s=document.querySelector('#palSec'); return s?{sw:s.querySelectorAll('.sw').length, inp:[...s.querySelectorAll('[data-cpick]')].map(i=>i.dataset.cpick), reset:(s.querySelector('[data-act=palreset]')||{}).disabled, note:(s.querySelector('.note')||{}).textContent}:null; });
  check('S20-01: SWOT inserido pela Biblioteca; painel tem “Cores do componente” logo depois de “Conteúdo”, com “Cor principal” (pal.p) e “Cor de destaque” (pal.a) e “Restaurar cores A&M” desativado sem cores próprias', sw.kind==='swot'&&iC>=0&&iP===iC+1&&ui0&&ui0.sw===2&&ui0.inp.join()==='pal.p,pal.a'&&ui0.reset===true, {secs,ui0});
  const n0=await p.evaluate(id=>__amCount(document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]')), sw.id);

  /* ---------- 2. escolher as cores pelo painel: amostra (clique) e seletor de cor ---------- */
  await p.click('#palSec .sw >> nth=0 >> button[data-v="#43698F"]'); await sleep(250);
  const afterSw=await p.evaluate(()=>(id=>AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id))(AMStudio.selected()[0]).pal);
  const histSw=await p.evaluate(()=>document.querySelector('#bUndo').disabled);
  /* cor livre pelo seletor “Mais cores…” (S19): código #hex + Enter */
  await p.click('#palSec [data-cpick="pal.p"]'); await sleep(200); await p.fill('.cpop .cp-hex','#1b7f3b'); await p.press('.cpop .cp-hex','Enter'); await sleep(300);
  await p.click('#palSec [data-cpick="pal.a"]'); await sleep(200); await p.fill('.cpop .cp-hex','#c0392b'); await p.press('.cpop .cp-hex','Enter'); await sleep(400);
  const pal1=await p.evaluate(()=>(id=>AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id))(AMStudio.selected()[0]).pal);
  check('S20-02: clicar a amostra grava pal.p (um passo de desfazer); o seletor de cor grava a principal e a de destaque', afterSw&&afterSw.p==='#43698F'&&!histSw&&pal1&&/^#1b7f3b$/i.test(pal1.p)&&/^#c0392b$/i.test(pal1.a), {afterSw,pal1});
  const st1=await p.evaluate(id=>{ const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]'); return {k:n.dataset.pal, bad:__am(n), green:__hue(n,139), red:[...n.querySelectorAll('*')].filter(e=>/rgb\(192, 57, 43\)/.test(getComputedStyle(e).backgroundColor+getComputedStyle(e).fill+getComputedStyle(e).color+getComputedStyle(e).borderTopColor)).length, style:!!document.getElementById('am-pal-'+n.dataset.pal)}; }, sw.id);
  check('S20-03: no palco, a SWOT não tem mais azul-marinho nem laranja A&M (cores computadas de todos os descendentes) e usa tons da cor principal (matiz verde) e a de destaque exata; CSS restrito #am-pal-<chave> injetado', n0>0&&st1.bad.length===0&&st1.green>0&&st1.red>0&&st1.k==='1b7f3bc0392b'&&st1.style, {n0,st1});
  await p.screenshot({path:SH('01-swot-painel')});

  /* ---------- 3. vizinho sem paleta não muda; miniatura mostra as cores ---------- */
  await p.evaluate(()=>AMStudio.insertFx('bars')); await sleep(400);
  E=await els(); const nb=E[E.length-1];
  await p.evaluate(([id,x])=>{ const e=AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id); e.x=x; e.y=420; e.w=400; e.h=260; AMStudio.renderAll(); }, [nb.id, 860]); await sleep(300);
  const nbr=await p.evaluate(([a,b2])=>{ const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+b2+'"]'); const t=document.querySelector('#thumbs .th.on .am-el[data-id="'+a+'"]');
    return {nbPal:n.hasAttribute('data-pal'), nbAm:__amCount(n), nbBars:[...n.querySelectorAll('.fxb-bar:not(.hl)')].map(r=>getComputedStyle(r).fill), th:t?{pal:t.dataset.pal, bad:__am(t).length}:null}; }, [sw.id, nb.id]);
  check('S20-04: um gráfico de barras sem paleta no mesmo slide continua A&M (barras navy, sem data-pal)', !nbr.nbPal&&nbr.nbAm>0&&nbr.nbBars.every(f=>f==='rgb(0, 42, 70)'), nbr);
  check('S20-05: a miniatura do slide mostra a SWOT recolorida (data-pal, nenhum navy/laranja)', nbr.th&&nbr.th.pal==='1b7f3bc0392b'&&nbr.th.bad===0, nbr.th);

  /* ---------- 4. menu de contexto: “Cores do componente…” leva à seção; invariantes do menu ---------- */
  await p.evaluate(id=>AMStudio.select(id), sw.id); await sleep(200);
  let cc=await center(sw.id); await p.mouse.click(cc.x,cc.y,{button:'right'}); await sleep(250);
  const cm=await p.evaluate(()=>{ const it=[...document.querySelectorAll('.xmenu .xi')].map(x=>x.textContent.toLowerCase()); return {pal:it.filter(t=>t.includes('cores do componente')).length, al:it.filter(t=>t.includes('alinhar')).length, fr:it.filter(t=>t.includes('trazer para frente')).length}; });
  await p.screenshot({path:SH('02-contexto')});
  await p.locator('.xmenu .xi',{hasText:'Cores do componente'}).click(); await sleep(400);
  const foc=await p.evaluate(()=>({inSec:!!(document.activeElement&&document.activeElement.closest('#palSec')), flash:document.querySelector('#palSec').classList.contains('flash'), vis:(r=>r.top>=0&&r.bottom<=innerHeight+1)(document.querySelector('#palSec').getBoundingClientRect())}));
  check('S20-06: clique direito no componente mostra “Cores do componente…” (1 item; continua 1 “Alinhar” e 1 “Trazer para frente”); o item leva o foco à seção, visível e destacada', cm.pal===1&&cm.al===1&&cm.fr===1&&foc.inSec&&foc.flash&&foc.vis, {cm,foc});
  await p.keyboard.press('Escape'); await sleep(100);
  /* texto e linha não oferecem a seção nem o item */
  const noPal=await p.evaluate(()=>{ const s=AMStudio.deck.slides[AMStudio.cur]; const t=AMStudio.mk.text('body',{html:'Olá'}); s.els.push(t); AMStudio.renderAll(); AMStudio.select(t.id); const a=!!document.querySelector('#palSec'); s.els.pop(); AMStudio.renderAll(); return a; });
  check('S20-07: texto selecionado não mostra “Cores do componente”', noPal===false);

  /* ---------- 5. Restaurar cores A&M (um passo) e Ctrl+Z / Ctrl+Y ---------- */
  await p.evaluate(id=>AMStudio.select(id), sw.id); await sleep(200);
  await p.click('#palSec [data-act=palreset]'); await sleep(350);
  const rs=await p.evaluate(id=>{ const e=AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id); const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]'); return {pal:e.pal===undefined, attr:n.hasAttribute('data-pal'), am:__amCount(n), dis:document.querySelector('#palSec [data-act=palreset]').disabled}; }, sw.id);
  check('S20-08: “Restaurar cores A&M” apaga el.pal, o componente volta ao navy/laranja e o botão fica desativado', rs.pal&&!rs.attr&&rs.am===n0&&rs.dis, {rs,n0});
  await p.keyboard.press('Control+z'); await sleep(350);
  const u1=await p.evaluate(id=>{ const e=AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id); const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]'); return {pal:e.pal, bad:__am(n).length}; }, sw.id);
  /* histórico: … pal.p · pal.a · (barras inseridas) · restaurar  →  2 Ctrl+Z a mais tiram as barras e depois a cor de destaque */
  await p.keyboard.press('Control+z'); await sleep(300); await p.keyboard.press('Control+z'); await sleep(350);
  const u2=await p.evaluate(id=>{ const E=AMStudio.deck.slides[AMStudio.cur].els; return {pal:E.find(o=>o.id===id).pal, n:E.length}; }, sw.id);
  await p.keyboard.press('Control+y'); await sleep(350);
  const u3=await p.evaluate(id=>AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id).pal, sw.id);
  await p.keyboard.press('Control+y'); await p.keyboard.press('Control+y'); await sleep(350);
  const u4=await p.evaluate(id=>AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id).pal, sw.id);
  check('S20-09: Ctrl+Z desfaz o “Restaurar” (cores de volta, sem navy/laranja); voltando mais, o seletor de cor foi um passo por cor (só a principal); Ctrl+Y refaz até o “Restaurar”', u1.pal&&/^#1b7f3b$/i.test(u1.pal.p)&&/^#c0392b$/i.test(u1.pal.a)&&u1.bad===0&&u2.pal&&/^#1b7f3b$/i.test(u2.pal.p)&&!u2.pal.a&&u2.n===1&&u3&&/^#c0392b$/i.test(u3.a)&&u4===undefined, {u1,u2,u3,u4});

  /* ---------- 6. salvar → reabrir ---------- */
  await p.keyboard.press('Control+z'); await sleep(350); /* de volta às cores escolhidas */
  await p.evaluate(()=>AMStudio.loadDeck(JSON.parse(JSON.stringify(AMStudio.deck)))); await sleep(400);
  const ro=await p.evaluate(id=>{ const e=AMStudio.deck.slides[AMStudio.cur].els.find(o=>o.id===id); const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]'); return {pal:e&&e.pal, bad:n?__am(n).length:-1}; }, sw.id);
  check('S20-10: salvar → reabrir mantém el.pal (normalizado em maiúsculas) e o desenho recolorido', ro.pal&&ro.pal.p==='#1B7F3B'&&ro.pal.a==='#C0392B'&&ro.bad===0, ro);

  /* ---------- 7. valores hostis pelo loadDeck ---------- */
  const hos=await p.evaluate(()=>{
    const mk=(pal,type)=>Object.assign(type==='text'?{id:'t'+Math.random().toString(36).slice(2,8),type:'text',x:0,y:0,w:200,h:60,html:'x'}:{id:'h'+Math.random().toString(36).slice(2,8),type:'fx',kind:'swot',x:0,y:0,w:600,h:300,data:JSON.parse(JSON.stringify(AMRT.FX.swot.data))},{pal});
    const cases=[{p:'red',a:'#12345'}, {p:'#00ff00;background:url(x)',a:'#c0392b'}, ['#1B7F3B'], 'x', {p:'#1b7f3b',q:'<b>',a:null}, {p:'" onx="1',a:'#C0392Bz'}, {}, {p:'#1b7f3b',a:'#c0392b'}];
    const d={title:'h',slides:[{id:'s1',bg:'#FFFFFF',els:cases.map(c=>mk(c)).concat([mk({p:'#1B7F3B'},'text')])}]};
    AMStudio.loadDeck(d); const E=AMStudio.deck.slides[0].els;
    const marks=[...document.querySelectorAll('#wrap .am-stage .am-el')].map(n=>n.getAttribute('data-pal'));
    return {pals:E.map(e=>e.pal===undefined?null:e.pal), marks, bad:[...document.querySelectorAll('#wrap .am-stage [data-pal]')].some(n=>!/^([0-9a-f]{6}|x){2}$/.test(n.dataset.pal)), styles:[...document.querySelectorAll('style[data-am-pal]')].map(s=>s.id)};
  });
  const hp=hos.pals;
  check('S20-11: el.pal hostil é filtrado ao abrir: cor inválida/injeção/array/texto/vazio saem; chave desconhecida some; só #rrggbb (maiúsculas); texto nunca leva pal; data-pal só [0-9a-f]', hp[0]===null&&JSON.stringify(hp[1])==='{"a":"#C0392B"}'&&hp[2]===null&&hp[3]===null&&JSON.stringify(hp[4])==='{"p":"#1B7F3B"}'&&hp[5]===null&&hp[6]===null&&JSON.stringify(hp[7])==='{"p":"#1B7F3B","a":"#C0392B"}'&&hp[8]===null&&!hos.bad&&hos.marks[1]==='xc0392b'&&hos.marks[8]===null, hos);
  /* o runtime também valida (arquivo exportado editado à mão): pal inválido não marca nem troca cor */
  const rtv=await p.evaluate(()=>{ const el={id:'q1',type:'fx',kind:'swot',x:0,y:0,w:600,h:300,data:AMRT.FX.swot.data,pal:{p:'url(javascript:x)',a:'#zzzzzz'}}; const n=AMRT.renderEl(el,0); return {attr:n.hasAttribute('data-pal'), same:n.innerHTML===AMRT.renderEl(Object.assign({},el,{pal:undefined}),0).innerHTML}; });
  check('S20-12: o runtime ignora el.pal inválido mesmo sem passar pelo editor (sem data-pal, markup idêntico)', !rtv.attr&&rtv.same, rtv);

  /* ---------- 8. sete tipos (SWOT, card, barras, SmartArt, Gantt, roadmap, BCG, Canvas, timeline, donut): nada A&M sobra, vizinho intacto, textos legíveis ---------- */
  const KINDS=['swot','card','bars','smart','gantt','roadmap','bcg','bmc','timeline','donut','columns','pdca'];
  const kin=[];
  for(const k of KINDS){
    const r=await p.evaluate(([k,PAL])=>{
      const F=AMRT.FX[k]; const d={title:'k',slides:[{id:'s1',bg:'#FFFFFF',els:[]}]};
      const w=Math.min(F.w,620), h=Math.min(F.h,330);
      const base={type:'fx',kind:k,w,h,data:JSON.parse(JSON.stringify(F.data)),anim:{in:'none'}}; if(F.variant) base.variant=F.variant;
      d.slides[0].els.push(Object.assign({id:'a1',x:10,y:20},JSON.parse(JSON.stringify(base))), Object.assign({id:'b1',x:650,y:20,pal:PAL},JSON.parse(JSON.stringify(base))));
      if(k==='card'){ d.slides[0].els.push(Object.assign({id:'c1',x:10,y:380,pal:PAL},JSON.parse(JSON.stringify(base)),{data:Object.assign({},F.data,{style:'dark'})})); }
      AMStudio.loadDeck(d,null,true,true);
      const A=document.querySelector('#wrap .am-stage .am-el[data-id=a1]'), B=document.querySelector('#wrap .am-stage .am-el[data-id=b1]'), C=document.querySelector('#wrap .am-stage .am-el[data-id=c1]');
      const ca=__contrast(A), cb=__contrast(B);
      const worse=cb.map((c,i)=>({i,o:ca[i]&&ca[i].c,c:c.c,acc:ca[i]&&ca[i].acc})).filter(o=>o.o!=null&&!o.acc&&o.c<Math.min(4.5,o.o*.95));
      return {k, bad:__am(B).concat(C?__am(C):[]), nbAm:__amCount(A), nbPal:A.hasAttribute('data-pal'), nTxt:cb.length, sameN:ca.length===cb.length, worse:worse.slice(0,5), minC:Math.min.apply(null,cb.filter((c,i)=>!(ca[i]&&ca[i].acc)).map(c=>c.c).concat([99]))};
    },[k,PAL]);
    kin.push(r); await sleep(80);
    if(['swot','card','bars','smart','gantt','roadmap','bcg','bmc'].includes(k)) await p.screenshot({path:SH('k-'+k), clip:await p.evaluate(()=>{ const r=document.querySelector('#wrap').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })});
  }
  const kBad=kin.filter(r=>r.bad.length||r.nbPal||!r.nbAm||!r.sameN);
  check('S20-13: em '+KINDS.length+' tipos (SWOT, card claro e navy, barras, SmartArt, Gantt, roadmap, BCG, Canvas, linha do tempo, rosca, colunas, PDCA) com {p:#1B7F3B, a:#C0392B}: nenhum descendente com navy rgb(0,42,70) nem laranja rgb(247,140,22) (fill, stroke, color, fundo, bordas, sombra, gradiente); a cópia sem paleta ao lado continua A&M', kBad.length===0, kBad.length?kBad:kin.map(r=>r.k+':'+r.nbAm));
  const cBad=kin.filter(r=>r.worse.length);
  check('S20-14: textos continuam legíveis: o contraste de cada texto HTML recolorido (fora os de destaque/laranja, que dependem do par escolhido) fica ≥ 4,5 ou ≥ 95 % do original A&M', cBad.length===0, cBad.length?cBad:kin.map(r=>r.k+':'+r.nTxt+'/'+r.minC));

  /* ---------- 9. variantes com cor no fim da animação (player): Gantt “crítico”, barras “destaque depois”, PDCA, okr ---------- */
  const PLAY=[['gantt','critical'],['bars','highlight'],['roadmap','focus'],['okr','fill'],['swot','quadrants'],['bcg','quadrants'],['smart','all']];
  const pdeck=await p.evaluate(([PLAY,PAL])=>({title:'Cores do componente',slides:PLAY.map(([k,v],i)=>{ const F=AMRT.FX[k]; const ok=F.variants&&F.variants.some(x=>x[0]===v);
      return {id:'p'+i,bg:'#FFFFFF',tr:'none',els:[{id:'z'+i,type:'fx',kind:k,variant:ok?v:F.variant,x:(1280-Math.min(F.w,1100))/2,y:120,w:Math.min(F.w,1100),h:Math.min(F.h,470),data:JSON.parse(JSON.stringify(F.data)),anim:{in:'fade'},pal:PAL}]}; })}),[PLAY,PAL]);
  await p.evaluate(d=>AMStudio.loadDeck(d,null,true,true), pdeck); await sleep(300);
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(__dirname,'saved-s20.html'); fs.writeFileSync(f,html);
  check('S20-15: export sem on* (CR-04) e com o CSS do runtime identificado (#am-runtime-css)', !/onerror|onmouseover|onclick/i.test(html)&&/<style id="am-runtime-css">/.test(html));
  const q=await open(ctx,'file://'+f,'exp'); await q.evaluate(TOOLS);
  const pl=[];
  for(let i=0;i<PLAY.length;i++){
    if(i) { await q.keyboard.press('ArrowRight'); }
    await sleep(4200);
    pl.push(await q.evaluate(i=>{ const n=document.querySelector('.amp-slide.on .am-el[data-id=z'+i+']'); return {i, pal:n&&n.dataset.pal, bad:n?__am(n):['sem elemento'], pos:document.querySelector('.amp-pos').textContent}; }, i));
    if(i===0) await q.screenshot({path:SH('03-export-gantt')});
  }
  const plBad=pl.filter(r=>r.bad.length||r.pal!=='1b7f3bc0392b');
  check('S20-16: arquivo exportado: o player mostra os componentes recoloridos no estado final das animações (Gantt crítico, barras com destaque, roadmap, OKR, SWOT, BCG, SmartArt) — sem navy nem laranja', plBad.length===0, plBad.length?plBad:pl.map(r=>r.pos));
  /* Ampliar por duplo clique */
  const zr=await q.evaluate(()=>{ const r=document.querySelector('.amp-slide.on .am-el').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await q.mouse.dblclick(zr.x,zr.y); await sleep(1600);
  const zm=await q.evaluate(()=>{ const z=document.querySelector('.amp-zm'); const n=z&&z.querySelector('.am-el'); return {on:!!z&&z.classList.contains('on'), pal:n&&n.dataset.pal, bad:n?__am(n):['sem elemento'], st:document.querySelectorAll('style[data-am-pal]').length}; });
  await q.screenshot({path:SH('04-export-ampliar')});
  check('S20-17: Ampliar (duplo clique) no arquivo exportado re-renderiza o componente com as mesmas cores (data-pal, nada A&M), usando a mesma folha restrita', zm.on&&zm.pal==='1b7f3bc0392b'&&zm.bad.length===0&&zm.st===1, zm);
  await q.close();

  /* ---------- 10. desempenho: slide de 20 componentes sem paleta = mesmo custo; com paleta, custo moderado ---------- */
  const perf=await p.evaluate(()=>{
    const ks=['swot','bars','card','smart','gantt','bcg','donut','timeline','process','raci'];
    const mkS=(pal)=>({bg:'#FFFFFF',els:Array.from({length:20},(_,i)=>{ const k=ks[i%ks.length], F=AMRT.FX[k]; const e={id:'pf'+i,type:'fx',kind:k,x:(i%5)*250,y:Math.floor(i/5)*170,w:240,h:160,data:JSON.parse(JSON.stringify(F.data)),anim:{in:'none'}}; if(pal) e.pal=pal; return e; })});
    const host=document.createElement('div'); host.style.cssText='position:fixed;left:0;top:0;width:640px;height:360px;opacity:0;pointer-events:none'; document.body.appendChild(host);
    const run=(s,n)=>{ let t=0; for(let i=0;i<n;i++){ const t0=performance.now(); const st=AMRT.renderSlide(s,{}); host.appendChild(st); void st.offsetHeight; host.removeChild(st); t+=performance.now()-t0; } return t/n; };
    const s0=mkS(null), s1=mkS({p:'#6A1B9A',a:'#00897B'});
    run(s0,4); const H=AMRT.palHTML, T=AMRT.palTag;
    const res={with:[],without:[]};
    for(let r=0;r<5;r++){ res.with.push(run(s0,6)); AMRT.palHTML=null; AMRT.palTag=null; res.without.push(run(s0,6)); AMRT.palHTML=H; AMRT.palTag=T; }
    const t1=performance.now(); const st=AMRT.renderSlide(s1,{}); host.appendChild(st); void st.offsetHeight; const first=performance.now()-t1; host.removeChild(st);
    const again=run(s1,4); host.remove();
    const med=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];
    return {noPal:+med(res.with).toFixed(2), base:+med(res.without).toFixed(2), palFirst:+first.toFixed(1), palAgain:+again.toFixed(2)};
  });
  check('S20-18: 20 componentes sem paleta renderizam no mesmo tempo que sem a extensão (dentro do ruído: ≤ base × 1,15 + 1 ms); com paleta nova ≤ 250 ms na 1ª vez (índice + CSS) e ≤ 2,5× a base depois', perf.noPal<=perf.base*1.15+1&&perf.palFirst<=250&&perf.palAgain<=perf.base*2.5+2, perf);

  /* ---------- 11. sem paleta, nada é injetado; Marca A&M sem a seção ---------- */
  const fresh=await open(ctx, FILE+'?nocover', 'ed2');
  const fr=await fresh.evaluate(()=>{ AMStudio.insertFx('swot'); AMStudio.insertFx('amlines'); const E=AMStudio.deck.slides[AMStudio.cur].els; AMStudio.select(E[E.length-1].id); const am=!!document.querySelector('#palSec'); AMStudio.select(E[E.length-2].id); return {styles:document.querySelectorAll('style[data-am-pal]').length, marks:document.querySelectorAll('[data-pal]').length, amlines:am, swot:!!document.querySelector('#palSec')}; });
  check('S20-19: deck sem paleta não injeta nenhum <style> nem data-pal; “Linhas A&M” (Marca A&M) não oferece “Cores do componente”, SWOT oferece', fr.styles===0&&fr.marks===0&&fr.amlines===false&&fr.swot===true, fr);
  await fresh.close();

  /* ---------- 12. barra e menus continuam cabendo (1280) ---------- */
  await p.setViewportSize({width:1280,height:720}); await sleep(300);
  const fit=await p.evaluate(()=>({rib:document.querySelector('#rib').scrollWidth<=document.querySelector('#rib').clientWidth+1, top:document.querySelector('#top').scrollWidth<=document.querySelector('#top').clientWidth+1}));
  check('S20-20: faixa de ferramentas e barra do topo sem transbordar em 1280×720 (nenhum botão novo)', fit.rib&&fit.top, fit);


  /* ---------- 13. revisão das cores (S20 × S19): destaque claro, séries escolhidas, ícone/Marca A&M, tamanho do CSS, amostras ---------- */
  const rv=await open(ctx, FILE+'?nocover', 'rv'); await rv.setViewportSize({width:1280,height:720}); await rv.evaluate(TOOLS);
  const blank=()=>rv.evaluate(()=>AMStudio.loadDeck({title:'r',slides:[{id:'s1',bg:'#FFFFFF',els:[]}]},null,true,true));
  const rvSel=()=>rv.evaluate(()=>{ const id=AMStudio.selected()[0]; return JSON.parse(JSON.stringify(AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id)||null)); });
  const rvNode=(id)=>`#wrap > .am-stage .am-el[data-id="${id}"]`;
  const palHex=async(k,hex)=>{ await rv.evaluate(()=>document.querySelector('#palSec').scrollIntoView({block:'center'})); await sleep(80); await rv.click('#palSec [data-cpick="pal.'+k+'"]'); await sleep(200); await rv.fill('.cpop .cp-hex',hex); await rv.press('.cpop .cp-hex','Enter'); await sleep(450); };
  const ins=async(k)=>{ await rv.evaluate(k=>AMStudio.insertFx(k),k); await sleep(350); return rvSel(); };
  /* contraste de um nó (texto × fundo computados) */
  const pairC=(sel)=>rv.evaluate((sel)=>[...document.querySelectorAll(sel)].map(n=>{ const L=s=>{ const m=s.match(/[\d.]+/g).map(Number), f=v=>{ v/=255; return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4); }; return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2]); }; const cs=getComputedStyle(n), a=L(cs.color), b=L(cs.backgroundColor); return +((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2); }), sel);
  const warnTxt=()=>rv.evaluate(()=>{ const w=document.querySelector('#palSec .pal-warn'); return w?w.textContent:null; });

  /* (a) destaque claro: roadmap — o texto branco das barras de destaque vira a principal escura (legível); contador — aviso nomeia o texto */
  await blank(); let rm=await ins('roadmap');
  const rmA=await pairC(rvNode(rm.id)+' .rm-ch.c');
  await palHex('a','#FFE7A3'); rm=await rvSel();
  const rmB=await pairC(rvNode(rm.id)+' .rm-ch.c'), rmW=await warnTxt();
  await rv.screenshot({path:SH('rv-roadmap-light')});
  await blank(); let ct=await ins('counter'); const ctW0=await warnTxt();
  await palHex('a','#FFE7A3'); const ctW=await warnTxt();
  await rv.screenshot({path:SH('rv-counter-warn')});
  check('S20-21: destaque claro (#FFE7A3): no roadmap, o texto das barras de destaque troca de branco para a principal escura (contraste A&M '+rmA[0]+' → ≥ 3) e não há aviso; no contador, o texto de destaque sobre branco fica abaixo de 3:1 e o painel avisa citando o texto (sem aviso antes)', rm.pal&&rm.pal.a==='#FFE7A3'&&rmB.length===3&&rmB.every(c=>c>=3)&&rmW===null&&ctW0===null&&/Pouco contraste/.test(ctW||'')&&/\+18%/.test(ctW||'')&&/3:1/.test(ctW||''), {rmA,rmB,rmW,ctW0,ctW});
  /* destaque escuro na RACI: o “A” (navy sobre o laranja) passa a branco; destaque próximo do laranja A&M não muda nada */
  await blank(); let rc=await ins('raci');
  const rcA=await rv.evaluate(s=>getComputedStyle(document.querySelector(s+' .b-A')).color, rvNode(rc.id));
  await palHex('a','#5E141F'); const rcB=await pairC(rvNode(rc.id)+' .b-A'), rcCol=await rv.evaluate(s=>getComputedStyle(document.querySelector(s+' .b-A')).color, rvNode(rc.id));
  await palHex('a','#D96F0B'); const rcN=await rv.evaluate(s=>getComputedStyle(document.querySelector(s+' .b-A')).color, rvNode(rc.id));
  await blank(); await ins('swot'); await palHex('a','#5E141F'); const swW=await warnTxt();
  check('S20-22: destaque escuro (#5E141F): na RACI o “A” troca o navy por branco (contraste ≥ 3); com um destaque próximo do laranja A&M (#D96F0B) o texto continua navy; na SWOT (título de destaque sobre a principal escura) o painel avisa', rcA==='rgb(0, 42, 70)'&&rcB.length>0&&rcB.every(c=>c>=3)&&rcCol==='rgb(255, 255, 255)'&&rcN==='rgb(0, 42, 70)'&&/Pouco contraste/.test(swW||''), {rcA,rcB,rcCol,rcN,swW});

  /* (b) gráfico com Cores do componente + cores das séries: a cor escolhida aparece exata; o painel mostra as cores desenhadas */
  await blank(); let co=await ins('columns');
  await rv.click('#palSec .sw >> nth=0 >> button[data-v="#43698F"]'); await sleep(300);
  await rv.evaluate(()=>document.querySelector('#props .cser').scrollIntoView({block:'center'})); await sleep(80);
  await rv.click('#props .cser >> nth=0 >> button[data-v="#A3B8D6"]'); await sleep(300);
  await rv.click('#props .cser >> nth=1 >> button[data-v="#002A46"]'); await sleep(300);
  co=await rvSel();
  const chI=await rv.evaluate(([s,pal])=>{ const n=document.querySelector(s); const bar=k=>[...n.querySelectorAll('.ch-bar[data-g="'+k+'"]')].map(r=>getComputedStyle(r).fill); const leg=k=>getComputedStyle(n.querySelector('.ch-leg span[data-g="'+k+'"] i')).backgroundColor;
    const hx=c=>'#'+c.match(/\d+/g).slice(0,3).map(v=>(+v).toString(16).padStart(2,'0')).join('').toUpperCase();
    return {b0:bar(0), b1:bar(1), b2:bar(2), l:[leg(0),leg(1),leg(2)], dots:[...document.querySelectorAll('#props .cser .cser-n i')].map(i=>getComputedStyle(i).backgroundColor), on:[...document.querySelectorAll('#props .cser')].map(r=>(r.querySelector('.sw button.on')||{dataset:{}}).dataset.v), map2:AMRT.pal.map('#A3B8D6',pal), note:!!document.querySelector('#props .cser-pal'), hx2:hx(getComputedStyle(n.querySelector('.ch-bar[data-g="2"]')).fill)}; }, [rvNode(co.id), co.pal]);
  await rv.screenshot({path:SH('rv-chart-series')});
  check('S20-23: colunas com cor principal #43698F + séries escolhidas (Gelo azulado, Navy): as barras e a legenda usam exatamente as cores escolhidas; a série 3 (sem cor própria) segue a paleta; os pontos e as amostras marcadas de “Cores das séries” mostram as cores desenhadas; há a nota', JSON.stringify(co.data.colors)==='["#A3B8D6","#002A46"]'&&co.pal.p==='#43698F'&&chI.b0.every(c=>c==='rgb(163, 184, 214)')&&chI.b1.every(c=>c==='rgb(0, 42, 70)')&&chI.l[0]==='rgb(163, 184, 214)'&&chI.l[1]==='rgb(0, 42, 70)'&&chI.hx2===chI.map2&&chI.map2!=='#A3B8D6'&&JSON.stringify(chI.dots)===JSON.stringify(chI.l)&&chI.on[0]==='#A3B8D6'&&chI.on[1]==='#002A46'&&chI.on[2]===chI.map2&&chI.note, chI);
  /* o mesmo no arquivo exportado */
  const exH=await rv.evaluate(()=>AMStudio.exportHTML()); const exF=path.join(__dirname,'saved-s20-rv.html'); fs.writeFileSync(exF,exH);
  const qx=await open(ctx,'file://'+exF,'exp-rv'); await sleep(2500);
  const exI=await qx.evaluate(()=>{ const n=document.querySelector('.amp-slide.on .am-el'); return {b0:getComputedStyle(n.querySelector('.ch-bar[data-g="0"]')).fill, b1:getComputedStyle(n.querySelector('.ch-bar[data-g="1"]')).fill}; });
  await qx.close(); try{ fs.unlinkSync(exF); }catch(e){}
  check('S20-24: arquivo exportado: as séries escolhidas continuam exatas no player (sem CR-04)', exI.b0==='rgb(163, 184, 214)'&&exI.b1==='rgb(0, 42, 70)'&&!/onerror|onmouseover|onclick/i.test(exH), exI);

  /* (c) el.pal em ícone e Marca A&M (sem a seção no painel) sai ao abrir; DATA_TOKENS só texto/cor */
  const icp=await rv.evaluate(()=>{ AMStudio.loadDeck({title:'i',slides:[{id:'s1',bg:'#FFFFFF',els:[{id:'i1',type:'fx',kind:'icon',x:100,y:100,w:200,h:200,data:JSON.parse(JSON.stringify(AMRT.FX.icon.data)),pal:{p:'#00FF00',a:'#FF00FF'}},{id:'l1',type:'fx',kind:'amlines',x:400,y:100,w:400,h:200,data:{c1:['x'],c2:{a:1}},pal:{p:'#00FF00'}},{id:'s9',type:'fx',kind:'swot',x:0,y:300,w:600,h:300,data:JSON.parse(JSON.stringify(AMRT.FX.swot.data)),pal:{p:'#00FF00'}}]}]},null,true,true);
    const E=AMStudio.deck.slides[0].els; return {icon:E[0].pal===undefined, aml:E[1].pal===undefined, swot:JSON.stringify(E[2].pal), marks:[...document.querySelectorAll('#wrap .am-stage [data-pal]')].map(n=>n.dataset.id), c1:E[1].data.c1===undefined, c2:E[1].data.c2===undefined}; });
  check('S20-25: ao abrir, el.pal de ícone e de “Linhas A&M” (sem “Cores do componente” no painel) é descartado (só a SWOT fica marcada); c1/c2 que não são texto/cor saem', icp.icon&&icp.aml&&icp.swot==='{"p":"#00FF00"}'&&JSON.stringify(icp.marks)==='["s9"]'&&icp.c1&&icp.c2, icp);

  /* (d) CSS por paleta só com as regras do tipo; folhas sem uso saem (troca de cor, deck novo) */
  const css=await rv.evaluate(()=>{ const ks=['swot','gantt','roadmap','columns','bmc'], pals=[{p:'#1B7F3B',a:'#C0392B'},{p:'#8E44AD',a:'#16A085'},{p:'#13406A',a:'#C0392B'},{p:'#B02A3E',a:'#1F66A8'},{p:'#6A1B9A',a:'#00897B'}];
    AMStudio.loadDeck({title:'c',slides:[{id:'s1',bg:'#FFFFFF',els:ks.map((k,i)=>({id:'e'+i,type:'fx',kind:k,x:20,y:20,w:600,h:330,data:JSON.parse(JSON.stringify(AMRT.FX[k].data)),pal:pals[i]}))}]},null,true,true);
    const S=pals.map(x=>document.getElementById('am-pal-'+AMRT.pal.key(x))).filter(Boolean); const sw=document.getElementById('am-pal-1b7f3bc0392b');
    return {n:S.length, sizes:S.map(s=>s.textContent.length), total:S.reduce((a,s)=>a+s.textContent.length,0), swotGantt:/\.gt-/.test(sw.textContent), swotOwn:/\.sw-/.test(sw.textContent), bad:['e0','e1','e2','e3','e4'].map(id=>__am(document.querySelector('#wrap > .am-stage .am-el[data-id='+id+']')).length)}; });
  check('S20-26: 5 componentes com 5 paletas: 5 folhas, cada uma só com as regras do próprio tipo (a da SWOT não leva regras do Gantt), total < 160 KB (antes: ≈ 120 KB por paleta, 602 KB) e nenhum navy/laranja sobrando', css.n===5&&css.total<160000&&css.sizes.every(s=>s<40000)&&!css.swotGantt&&css.swotOwn&&css.bad.every(x=>x===0), css);
  await blank(); let sw2=await ins('swot');
  await rv.click('#palSec .sw >> nth=0 >> button[data-v="#43698F"]'); await sleep(250);
  await rv.click('#palSec .sw >> nth=0 >> button[data-v="#13315C"]'); await sleep(250);
  await rv.click('#palSec [data-cpick="pal.a"]'); await sleep(200);
  await rv.evaluate(()=>{ const n=document.querySelector('.cpop .cp-nat'); for(let i=0;i<40;i++){ n.value='#'+(0x9a3000+i*0x10203).toString(16).slice(0,6); n.dispatchEvent(new Event('input',{bubbles:true})); } });
  await rv.keyboard.press('Escape'); await sleep(1800);
  const gc=await rv.evaluate(()=>({ids:[...document.querySelectorAll('style[data-am-pal]')].map(s=>s.id), marks:[...new Set([...document.querySelectorAll('[data-pal]')].map(n=>n.dataset.pal))]}));
  sw2=await rvSel();
  await blank(); await sleep(1800); const gc2=await rv.evaluate(()=>document.querySelectorAll('style[data-am-pal]').length);
  check('S20-27: trocar a cor duas vezes e arrastar o seletor do sistema (40 passos) e cancelar deixa só a folha da paleta em uso (as outras saem em ≈ 1 s); deck novo sem paleta → nenhuma folha', JSON.stringify(sw2.pal)==='{"p":"#13315C"}'&&gc.ids.length===1&&gc.ids[0]==='am-pal-13315cx'&&gc.marks.join()==='13315cx'&&gc2===0, {pal:sw2.pal,gc,gc2});

  /* (e) amostras: sem cor própria, a linha marca a cor A&M (navy / laranja); clicá-la volta só aquela cor */
  await blank(); let sw3=await ins('swot');
  const on0=await rv.evaluate(()=>[...document.querySelectorAll('#palSec .sw')].map(s=>[...s.querySelectorAll('button.on')].map(x=>x.dataset.v).join('|')));
  await rv.click('#palSec .sw >> nth=0 >> button[data-v="#43698F"]'); await sleep(250);
  await palHex('a','#C0392B');
  await rv.click('#palSec .sw >> nth=0 >> button[data-v="#002A46"]'); await sleep(250); const s3a=(await rvSel()).pal;
  await rv.click('#palSec .sw >> nth=1 >> button[data-v="#F78C16"]'); await sleep(250); const s3b=(await rvSel()).pal;
  const rsDis=await rv.evaluate(()=>document.querySelector('#palSec [data-act=palreset]').disabled);
  await rv.mouse.click(640,700); await sleep(100); await rv.evaluate(id=>AMStudio.select(id), sw3.id); await sleep(100);
  await rv.keyboard.press('Control+z'); await sleep(250); const s3u=(await rvSel()).pal;
  check('S20-28: sem cores próprias as linhas marcam navy e laranja (cor A&M); clicar o navy apaga só a principal, clicar o laranja apaga a de destaque (sem pal, “Restaurar” desativado); Ctrl+Z volta um passo', on0[0]==='#002A46'&&on0[1]==='#F78C16'&&JSON.stringify(s3a)==='{"a":"#C0392B"}'&&s3b===undefined&&rsDis&&JSON.stringify(s3u)==='{"a":"#C0392B"}', {on0,s3a,s3b,rsDis,s3u});
  await rv.close();

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); try{ fs.unlinkSync(f); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
