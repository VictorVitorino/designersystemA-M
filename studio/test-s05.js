/* test-s05: Gráficos + Ampliar (itens 4.2 e 8). rt-30-charts.js/.css: colunas (agrupadas / empilhadas / 100%), ranking, cascata,
   bullet, bolas de Harvey, funil e radar como modelos FX (3–4 efeitos cada, dados pelos codecs do painel, paleta A&M: até 4 séries
   navy → aço → aço claro → laranja, negativos hachurados em aço claro, nunca vermelho); ribbon “Gráficos ▾”, Inserir › Gráfico ▸,
   gaveta de modelos; “Ampliar” no player (editor e arquivo exportado): botão ⤢ ao passar o mouse, duplo clique / Z abrem o elemento
   re-renderizado num palco maior (nítido), ← → trocam de gráfico, Esc / fundo fecham, foco devolvido, nada fica para trás ao trocar de
   slide; zonas de avançar ignoram cliques nos gráficos; teclado conforme KEYMAP (Enter/Espaço em botão em foco são do botão; clique
   do mouse não rouba o foco). Uso: python3 assemble.py && node test-s05.js   (o qa-gate.sh pega qualquer test-s[0-9][0-9]*.js) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s05-'+f+'.png');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'canteiro-s05-'));
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
const deckJSON=html=>{ const m=html.match(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/); return m?JSON.parse(m[1]):null; };
const NEW=['columns','hbars','waterfall','bullet','harvey','funnel','radar'];
/* paleta A&M (CATALOG §C.2) + branco/transparente: toda cor de fill/stroke dos gráficos tem de estar aqui */
const PAL=['#002A46','#4A6FA5','#A3B8D6','#F78C16','#C9D6E8','#13406A','#43698F','#7EA1C3','#DCE5F0','#EEF2F7','#3E4C5E','#E2E7EF','#CBD4E1','#FFFFFF','#FFF','NONE','TRANSPARENT','CURRENTCOLOR'];
/* bancada: palco 1280×720 em escala 1:1 por cima do editor */
const LAB=`window.__lab=function(slide,play){ var d=document.getElementById('s5lab'); if(!d){ d=document.createElement('div'); d.id='s5lab'; d.style.cssText='position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;background:#fff'; document.body.appendChild(d); }
  d.innerHTML=''; d.style.display='block'; var st=AMRT.renderSlide(slide,{play:!!play}); d.appendChild(st); if(play){ st.classList.remove('am-pre'); void st.offsetWidth; st.classList.add('am-in'); if(d._c) d._c(); d._c=AMRT.runFx(st); } return st; };
  window.__labOff=function(){ var d=document.getElementById('s5lab'); if(d){ if(d._c) d._c(); d.innerHTML=''; d.style.display='none'; } };`;
/* o mesmo detector de sobreposição/transbordamento do test-cover, num palco qualquer (seletor) */
async function stageCheck(p, sel){
  return p.evaluate((sel)=>{
    const st=document.querySelector(sel), sr=st.getBoundingClientRect(), k=1280/sr.width, issues=[], boxes=[];
    const L=r=>({x:(r.left-sr.left)*k,y:(r.top-sr.top)*k,r:(r.right-sr.left)*k,b:(r.bottom-sr.top)*k});
    st.querySelectorAll('.am-el[data-id]').forEach(n=>{
      let u=null; const add=r=>{ if(r.width<1||r.height<1) return; const q=L(r); u=u?{x:Math.min(u.x,q.x),y:Math.min(u.y,q.y),r:Math.max(u.r,q.r),b:Math.max(u.b,q.b)}:q; };
      const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT); let t; while((t=walker.nextNode())){ if(!t.textContent.trim()) continue; const rg=document.createRange(); rg.selectNodeContents(t); [...rg.getClientRects()].forEach(add); }
      n.querySelectorAll('svg rect,svg circle,svg path,svg line,img,.hb-b,.bu-t,.hv-c,.fn-c,.ch-leg').forEach(e=>add(e.getBoundingClientRect()));
      if(!u) return; const nb=L(n.getBoundingClientRect());
      if(u.x<-1||u.y<-1||u.r>1281||u.b>721) issues.push('fora do slide '+JSON.stringify([u.x,u.y,u.r,u.b].map(Math.round)));
      if(u.x<nb.x-14||u.y<nb.y-14||u.r>nb.r+14||u.b>nb.b+14) issues.push('fora da caixa '+JSON.stringify([u.x-nb.x,u.y-nb.y,u.r-nb.r,u.b-nb.b].map(Math.round)));
      boxes.push({id:n.dataset.id,u});
    });
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){ const a=boxes[i].u,b=boxes[j].u; const w=Math.min(a.r,b.r)-Math.max(a.x,b.x), h=Math.min(a.b,b.b)-Math.max(a.y,b.y); if(w>2&&h>2) issues.push('sobreposição '+boxes[i].id+'×'+boxes[j].id); }
    return issues;
  }, sel);
}
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await page(ctx, FILE+'?nocover', 'ed');
  await p.evaluate(LAB);

  /* ---------- 1. registro dos gráficos ---------- */
  const reg=await p.evaluate((NEW)=>NEW.map(k=>{ const F=AMRT.FX[k]; if(!F) return {k,missing:true}; return {k,model:!!F.model,chart:!!F.chart,cat:F.cat,nv:(F.variants||[]).length,defOk:(F.variants||[]).some(v=>v[0]===F.variant),size:[F.w,F.h],fields:(F.fields||[]).map(f=>f[0]),tip:!!F.tip,kw:!!F.kw,allLabels:(F.variants||[]).every(v=>v[1]&&v[2])}; }),NEW);
  const CAT={columns:'Gráficos',hbars:'Gráficos',waterfall:'Gráficos',funnel:'Gráficos',radar:'Gráficos',bullet:'Indicadores',harvey:'Matrizes'};
  check('S05-01: 7 gráficos novos registrados como modelos (chart:true), categoria certa, 3–4 efeitos com rótulo e descrição, efeito padrão válido, tamanho ≤ 1172×470, dica e palavras de busca', reg.every(r=>!r.missing&&r.model&&r.chart&&r.cat===CAT[r.k]&&r.nv>=3&&r.nv<=4&&r.defOk&&r.size[0]<=1172&&r.size[1]<=470&&r.tip&&r.kw&&r.allLabels&&r.fields.indexOf('style')>=0), reg);
  const ch=await p.evaluate(()=>({list:AMRT.CHARTS, ok:(AMRT.CHARTS||[]).every(k=>!!AMRT.FX[k]), util:['slideTitle','zoomables','plain','isDark'].every(k=>typeof AMRT[k]==='function')}));
  check('S05-02: AMRT.CHARTS lista os 11 gráficos (novos + barras, linha, rosca, termômetro), todos registrados; AMRT expõe slideTitle, zoomables, plain, isDark', ch.list&&ch.list.length===11&&ch.ok&&ch.util, ch);

  /* ---------- 2. gaveta de modelos, ribbon “Gráficos ▾”, Inserir › Gráfico ▸ ---------- */
  await p.click('#bModels'); await sleep(700);
  const dr=await p.evaluate((NEW)=>{ const cats={}; document.querySelectorAll('#modelsBody .dcat').forEach(c=>{ let g=c.nextElementSibling; cats[c.dataset.cat]=[...g.querySelectorAll('.fxi')].map(x=>x.dataset.k); }); return {cats, cards:NEW.map(k=>!!document.querySelector('#modelsBody .fxi[data-k='+k+'] .pv .am-stage'))}; },NEW);
  await p.fill('#mSearch','cascata'); await sleep(300);
  const srch=await p.evaluate(()=>[...document.querySelectorAll('#modelsBody .fxi')].filter(c=>c.style.display!=='none').map(c=>c.dataset.k));
  await p.fill('#mSearch',''); await sleep(200); await p.screenshot({path:SH('01-gaveta-modelos')}); await p.click('#bFxClose'); await sleep(300);
  check('S05-03: gaveta Modelos: os gráficos novos entram nas categorias Gráficos / Indicadores / Matrizes com prévia viva; a busca “cascata” acha a ponte de valor', (dr.cats['Gráficos']||[]).indexOf('waterfall')>=0&&(dr.cats['Gráficos']||[]).indexOf('columns')>=0&&(dr.cats['Indicadores']||[]).indexOf('bullet')>=0&&(dr.cats['Matrizes']||[]).indexOf('harvey')>=0&&dr.cards.every(Boolean)&&srch.length===1&&srch[0]==='waterfall', {dr,srch});
  await fresh(p);
  await p.click('#bCharts'); await sleep(350);
  const rib=await p.evaluate(()=>{ const m=document.getElementById('mChart'), r=m.getBoundingClientRect(); return {open:m.classList.contains('open'), items:[...m.querySelectorAll('button[data-fx]')].map(b=>b.dataset.fx), heads:[...m.querySelectorAll('.mh')].map(x=>x.textContent), icons:m.querySelectorAll('button .mi-ic svg').length, view:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight, btn:getComputedStyle(document.getElementById('bCharts')).display!=='none'}; });
  await p.screenshot({path:SH('02-ribbon-graficos')});
  await p.click('#mChart [data-fx=columns]'); await sleep(500);
  const ins1=await last(p); const menuClosed=await p.evaluate(()=>!document.getElementById('mChart').classList.contains('open'));
  check('S05-04: ribbon “Gráficos ▾” abre a galeria com os 11 gráficos em 3 grupos (ícone em cada um) dentro da janela; clicar em Colunas insere o modelo e fecha o menu', rib.open&&rib.btn&&rib.items.length===11&&rib.heads.length===3&&rib.icons===11&&rib.view&&menuClosed&&ins1&&ins1.kind==='columns'&&ins1.variant==='grow', {rib,ins1:ins1&&ins1.kind});
  await sleep(2500); /* prévia automática termina */
  await p.click('#mbar [data-m=insert]'); await sleep(300);
  const insMenu=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi .xl')].map(x=>x.textContent));
  await p.locator('.xmenu .xi',{hasText:'Gráfico'}).first().hover(); await sleep(400);
  const sub=await p.evaluate(()=>{ const m=[...document.querySelectorAll('.xmenu')].pop(), r=m.getBoundingClientRect(); return {items:[...m.querySelectorAll('.xi .xl')].map(x=>x.textContent), heads:[...m.querySelectorAll('.xhd')].map(x=>x.textContent), icons:m.querySelectorAll('.xi .xic svg').length, view:r.right<=innerWidth&&r.bottom<=innerHeight}; });
  await p.screenshot({path:SH('03-inserir-grafico')});
  await p.locator('.xmenu .xi',{hasText:'Funil'}).last().click(); await sleep(400);
  const ins2=await last(p);
  check('S05-05: Inserir › Gráfico ▸ lista os 11 gráficos em 3 grupos com ícones; “Funil” insere o funil; o menu Inserir mantém um único item com “forma”', insMenu.filter(t=>/forma/i.test(t)).length===1&&insMenu.some(t=>t==='Gráfico')&&sub.items.length===11&&sub.heads.length===3&&sub.icons===11&&sub.view&&ins2&&ins2.kind==='funnel', {insMenu,sub,ins2:ins2&&ins2.kind});
  await sleep(2500);

  /* ---------- 3. painel: campos (codecs), cores, painel branco, ampliar ---------- */
  await fresh(p); await p.evaluate(()=>AMStudio.insertFx('columns')); await sleep(300);
  const pr=await p.evaluate(()=>{ const q=s=>document.querySelector('#props '+s); return {secs:[...document.querySelectorAll('#props .sec h3')].map(h=>h.textContent), series:q('[data-p="data.series"]')&&q('[data-p="data.series"]').dataset.codec, cats:q('[data-p="data.cats"]')&&q('[data-p="data.cats"]').dataset.codec, mode:q('select[data-p="data.mode"]')&&[...q('select[data-p="data.mode"]').options].map(o=>o.value), style:q('select[data-p="data.style"]')&&[...q('select[data-p="data.style"]').options].map(o=>o.textContent), panel:!!q('[data-set="data.panel"]'), zoomTog:q('[data-set=zoom]')&&q('[data-set=zoom]').className, zoomBtn:!!q('[data-act=zoomview]'), chips:[...document.querySelectorAll('#props [data-var]')].map(x=>x.dataset.var)}; });
  await p.screenshot({path:SH('04-painel-colunas')});
  check('S05-06: painel do gráfico: efeitos como chips, Conteúdo com os codecs (séries rows:t|*v, categorias lines, Tipo e Cores como seleção), Painel branco, seção “Ampliar na apresentação” (ligada) com “Ver ampliado”', pr.secs.indexOf('Conteúdo')>=0&&pr.secs.indexOf('Ampliar na apresentação')>=0&&pr.series==='rows:t|*v'&&pr.cats==='lines'&&JSON.stringify(pr.mode)==='["cluster","stack","pct"]'&&pr.style&&pr.style.length===2&&pr.panel&&/\bon\b/.test(pr.zoomTog||'')&&pr.zoomBtn&&JSON.stringify(pr.chips)==='["grow","cat","stack","focus"]', pr);
  /* edição pelos codecs: séries com decimais por vírgula, 5ª série é ignorada no desenho (máx. 4) */
  await p.fill('#props [data-p="data.series"]','Norte | 10 | 12,5 | 14\nSul | 8 | 9 | 11\nLeste | 3 | 4 | 6\nOeste | 2 | 2 | 2\nQuinta | 1 | 1 | 1'); await sleep(250);
  await p.fill('#props [data-p="data.cats"]','2024\n2025\n2026'); await sleep(250);
  await p.selectOption('#props select[data-p="data.mode"]','pct'); await sleep(300);
  const ed=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0], st=document.querySelector('#wrap .am-stage'); return {series:e.data.series.map(s=>s.t+':'+s.v.join(',')), v12:e.data.series[0].v[1], bars:st.querySelectorAll('.ch-bar').length, pct:[...st.querySelectorAll('.ch-v')].every(t=>/%$/.test(t.textContent)), leg:[...st.querySelectorAll('.ch-leg [data-e]')].map(x=>x.textContent), legEd:!!st.querySelector('[data-e="series.0.t"]'), mode:e.data.mode}; });
  check('S05-07: editar séries/categorias pelos textareas atualiza os dados (vírgula decimal é aceita) e redesenha: 4 séries × 3 categorias = 12 colunas, a 5ª série fica fora, 100% mostra “%”, legenda editável no slide', JSON.stringify(ed.series).indexOf('Norte:10,12,5,14')>=0&&String(ed.v12).replace(',','.')==='12.5'&&ed.series.length===5&&ed.bars===12&&ed.pct&&ed.legEd&&JSON.stringify(ed.leg)==='["Norte","Sul","Leste","Oeste"]'&&ed.mode==='pct', ed);
  const undo1=await p.evaluate(()=>{ AMStudio.renderAll(); const n=AMStudio.deck.slides[0].els[0].data.mode; return n; });
  check('S05-08: a troca de Tipo passa pelo painel (select → commit) e persiste no modelo', undo1==='pct', undo1);

  /* ---------- 4. Harvey: clique cicla a nota 0 → 4; RACI segue R → A ---------- */
  await fresh(p); await p.evaluate(()=>AMStudio.insertFx('harvey')); await sleep(300);
  const el0=await last(p); await p.evaluate(id=>AMStudio.select(id), el0.id);
  const cell=await p.$('#wrap .am-stage [data-cyc="rows.0.v.0"]'); const cb=await cell.boundingBox();
  await p.mouse.click(cb.x+cb.width/2, cb.y+cb.height/2); await sleep(150); const h1=await p.evaluate(()=>AMStudio.deck.slides[0].els[0].data.rows[0].v[0]);
  await p.mouse.click(cb.x+cb.width/2, cb.y+cb.height/2); await sleep(150); const h2=await p.evaluate(()=>AMStudio.deck.slides[0].els[0].data.rows[0].v[0]);
  const dash=await p.evaluate(()=>document.querySelector('#wrap .am-stage [data-cyc="rows.0.v.0"] .hv-f')); /* nota 0: sem fatia */
  await fresh(p); await p.evaluate(()=>AMStudio.insertFx('raci')); await sleep(300); const r0=await last(p); await p.evaluate(id=>AMStudio.select(id), r0.id);
  const rc=await p.$('#wrap .am-stage [data-cyc="rows.0.v.1"]'); const rb=await rc.boundingBox(); await p.mouse.click(rb.x+rb.width/2, rb.y+rb.height/2); await sleep(150);
  const rv=await p.evaluate(()=>AMStudio.deck.slides[0].els[0].data.rows[0].v[1]);
  check('S05-09: clique numa bola de Harvey cicla a nota com a sequência própria (3 → 4 → 0, número) e a nota 0 fica vazia; o RACI continua ciclando R → A', h1===4&&h2===0&&dash===null&&rv==='A', {h1,h2,dash,rv});

  /* ---------- 5. regras de cor e cálculo ---------- */
  const colors=await p.evaluate((PAL)=>{ const out={bad:[],ids:[],wf:null,neg:null,cols:null,hb:null,fn:null,rd:null,bu:null,dark:null};
    const K=['columns','hbars','waterfall','bullet','harvey','funnel','radar']; let i=0;
    for(const k of K) for(const mode of ['light','dark']){ const F=AMRT.FX[k], d=JSON.parse(JSON.stringify(F.data)); d.style=mode; const el={id:'c'+(i++),type:'fx',kind:k,variant:F.variant,x:(1280-F.w)/2,y:(720-F.h)/2,w:F.w,h:F.h,data:d,anim:{in:'none'}};
      const st=window.__lab({bg:mode==='dark'?'#002A46':'#FFFFFF',els:[el]},false);
      st.querySelectorAll('[fill],[stroke]').forEach(n=>['fill','stroke'].forEach(a=>{ const v=(n.getAttribute(a)||'').trim(); if(!v) return; if(/^url\(#/.test(v)||/^rgba\(255,255,255,/.test(v)) return; if(PAL.indexOf(v.toUpperCase())<0) out.bad.push(k+'/'+mode+' '+a+'='+v); }));
      st.querySelectorAll('[style]').forEach(n=>{ const m=(n.getAttribute('style')||'').match(/background:\s*(#[0-9a-fA-F]{3,6})/g)||[]; m.forEach(x=>{ const v=x.replace(/background:\s*/,'').toUpperCase(); if(PAL.indexOf(v)<0) out.bad.push(k+'/'+mode+' bg='+v); }); });
      if(k==='waterfall'&&mode==='light'){ const vs=[...st.querySelectorAll('.wf-v')].map(t=>t.textContent); const neg=st.querySelector('.wf-bar.neg'); const pid=(neg.getAttribute('fill').match(/url\(#(.+)\)/)||[])[1]; const pat=st.querySelector('#'+pid); out.wf=vs; out.neg={fill:neg.getAttribute('fill'),patRect:pat&&pat.querySelector('rect').getAttribute('fill'),hatch:pat&&pat.querySelector('line').getAttribute('stroke'),rot:pat&&pat.getAttribute('patternTransform')}; out.ids.push(pid); const st2=window.__lab({bg:'#fff',els:[el]},false); out.ids.push((st2.querySelector('.wf-bar.neg').getAttribute('fill').match(/url\(#(.+)\)/)||[])[1]); }
      if(k==='columns'&&mode==='light'){ out.cols={fills:[...st.querySelectorAll('.ch-bar')].slice(0,3).map(r=>r.getAttribute('fill')), leg:st.querySelectorAll('.ch-leg > span').length, tot:[...st.querySelectorAll('.ch-tot')].map(t=>t.textContent)}; }
      if(k==='hbars'&&mode==='light'){ out.hb={labels:[...st.querySelectorAll('.hb-l')].map(x=>x.textContent), hl:getComputedStyle(st.querySelector('.hb-r.hl .hb-b')).backgroundColor, w:[...st.querySelectorAll('.hb-b')].map(x=>parseFloat(x.style.width))}; }
      if(k==='funnel'&&mode==='light'){ out.fn={worst:st.querySelector('.fn-c.worst')&&st.querySelector('.fn-c.worst').textContent, conv:[...st.querySelectorAll('.fn-c')].map(x=>x.textContent), widths:[...st.querySelectorAll('.fn-s')].map(pth=>pth.getBBox().width)}; }
      if(k==='radar'&&mode==='light'){ out.rd={dash:st.querySelector('.rd-s[data-g="1"] .rd-l').getAttribute('stroke-dasharray'), nSeries:st.querySelectorAll('.rd-s').length, cols:[...st.querySelectorAll('.rd-l')].map(x=>x.getAttribute('stroke'))}; }
      if(k==='bullet'&&mode==='light'){ out.bu={tg:[...st.querySelectorAll('.bu-tg')].map(x=>parseFloat(x.style.left)), bands:st.querySelectorAll('.bu-r:first-child .bu-z').length}; }
      if(k==='columns'&&mode==='dark'){ out.dark={fills:[...st.querySelectorAll('.ch-bar')].slice(0,3).map(r=>r.getAttribute('fill')), title:st.querySelector('text').getAttribute('fill')}; }
    }
    window.__labOff(); return out; }, PAL);
  check('S05-10: toda cor de preenchimento/traço dos 7 gráficos (claro e escuro) está na paleta A&M (sem vermelho); negativos da cascata = padrão hachurado aço claro #C9D6E8 com traços brancos a 45°, id único por desenho; total final calculado = 144', colors.bad.length===0&&colors.wf&&colors.wf[colors.wf.length-1]==='144'&&colors.wf[3]==='−6'&&/^url\(#wfh/.test(colors.neg.fill)&&colors.neg.patRect==='#C9D6E8'&&colors.neg.hatch==='#fff'&&/45/.test(colors.neg.rot)&&colors.ids[0]!==colors.ids[1], colors);
  check('S05-11: colunas: séries na ordem navy → aço → aço claro, legenda com 3 itens, totais da pilha (80, 93, 112, 132); no escuro a ordem vira branco → aço claro → gelo e o título fica branco', JSON.stringify(colors.cols.fills)==='["#002A46","#4A6FA5","#A3B8D6"]'&&colors.cols.leg===3&&JSON.stringify(colors.cols.tot)==='["80","93","112","132"]'&&JSON.stringify(colors.dark.fills)==='["#FFFFFF","#7EA1C3","#C9D6E8"]'&&colors.dark.title==='#FFFFFF', {cols:colors.cols,dark:colors.dark});
  check('S05-12: ranking ordenado do maior para o menor, 1ª posição em laranja, larguras proporcionais (86% para o maior)', colors.hb.labels[0]==='Compras estratégicas'&&colors.hb.labels[4]==='Facilities'&&colors.hb.hl==='rgb(247, 140, 22)'&&Math.abs(colors.hb.w[0]-86)<.1&&colors.hb.w[1]<colors.hb.w[0]&&colors.hb.w[4]<colors.hb.w[3], colors.hb);
  check('S05-13: funil: larguras decrescentes (raiz do valor), 4 taxas de conversão e a pior (35%) marcada em laranja', colors.fn.widths.every((w,i,a)=>!i||w<a[i-1])&&colors.fn.conv.length===4&&/35%/.test(colors.fn.worst||''), colors.fn);
  check('S05-14: radar: 2 séries (navy cheia, meta laranja tracejada em unidades de pathLength); bullet: meta em % do máximo (70, 75, 50, 53,3) e 3 faixas', colors.rd.nSeries===2&&colors.rd.cols[0]==='#002A46'&&colors.rd.cols[1]==='#F78C16'&&/^0\.\d+ 0\.\d+$/.test(colors.rd.dash||'')&&JSON.stringify(colors.bu.tg.map(x=>Math.round(x*10)/10))==='[70,75,50,53.3]'&&colors.bu.bands===3, {rd:colors.rd,bu:colors.bu});

  /* ---------- 6. nada transborda: tamanho padrão (branco e navy com painel) e 50% ---------- */
  const fit={};
  for(const k of NEW){ for(const mode of ['white','navy','half']){
    await p.evaluate(([k,mode])=>{ const F=AMRT.FX[k], sc=mode==='half'?.5:1, w=F.w*sc, h=F.h*sc, el={id:'f'+k,type:'fx',kind:k,variant:F.variant,x:(1280-w)/2,y:(720-h)/2,w,h,data:JSON.parse(JSON.stringify(F.data)),anim:{in:'none'}}; if(mode==='navy') el.data.panel='white'; window.__lab({bg:mode==='navy'?'#002A46':'#FFFFFF',els:[el]},false); },[k,mode]);
    await sleep(60); const iss=await stageCheck(p,'#s5lab .am-stage'); if(iss.length) fit[k+'/'+mode]=iss; } }
  /* composição de capa com os 7 em miniatura, para a foto */
  await p.evaluate((NEW)=>{ const els=NEW.map((k,i)=>{ const F=AMRT.FX[k], sc=Math.min(400/F.w,200/F.h), w=F.w*sc, h=F.h*sc, c=i%3, r=Math.floor(i/3); return {id:'g'+i,type:'fx',kind:k,variant:F.variant,x:40+c*415+(400-w)/2,y:30+r*235+(200-h)/2,w,h,data:JSON.parse(JSON.stringify(F.data)),anim:{in:'none'}}; }); window.__lab({bg:'#FFFFFF',els},true); },NEW);
  await sleep(4200); await p.screenshot({path:SH('05-sete-graficos'),clip:{x:0,y:0,width:1280,height:720}});
  await p.evaluate((NEW)=>{ const els=NEW.map((k,i)=>{ const F=AMRT.FX[k], sc=Math.min(400/F.w,200/F.h), w=F.w*sc, h=F.h*sc, c=i%3, r=Math.floor(i/3), d=JSON.parse(JSON.stringify(F.data)); d.style='dark'; return {id:'g'+i,type:'fx',kind:k,variant:F.variant,x:40+c*415+(400-w)/2,y:30+r*235+(200-h)/2,w,h,data:d,anim:{in:'none'}}; }); window.__lab({bg:'#002A46',els},true); },NEW);
  await sleep(4200); await p.screenshot({path:SH('06-sete-graficos-escuro'),clip:{x:0,y:0,width:1280,height:720}});
  await p.evaluate(()=>window.__labOff());
  check('S05-15: nenhum gráfico transborda o slide ou a própria caixa (tolerância 14 px) no tamanho padrão em branco, em navy com painel branco e a 50%', Object.keys(fit).length===0, fit);

  /* ---------- 7. salvar → reabrir: dados, efeito e zoom:false sobrevivem; zoom inválido cai ---------- */
  await fresh(p);
  await p.evaluate(()=>{ const S=AMStudio; const a=S.insertFx('waterfall',null,null,'driver'); a.zoom=false; const c=S.insertFx('columns'); c.zoom='sim'; const i=S.mk.image('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#7EA1C3"/></svg>'),400,300); S.deck.slides[0].els.push(i); S.renderAll(); S.commit(); });
  const html0=await p.evaluate(()=>AMStudio.exportHTML());
  await p.evaluate(h=>{ const d=new DOMParser().parseFromString(h,'text/html'); AMStudio.loadDeck(JSON.parse(d.getElementById('am-deck-data').textContent),null,true,true); }, html0);
  const re=await els(p);
  check('S05-16: salvar e reabrir mantém a cascata (efeito “driver”, 7 barras, zoom desligado) e as colunas (zoom inválido descartado); a imagem volta', re.length===3&&re[0].kind==='waterfall'&&re[0].variant==='driver'&&re[0].data.items.length===7&&re[0].zoom===false&&re[1].kind==='columns'&&!('zoom' in re[1])&&re[2].type==='image', re.map(e=>({k:e.kind||e.type,v:e.variant,z:e.zoom})));
  const zl=await p.evaluate(()=>({ids:AMRT.zoomables(AMStudio.deck.slides[0]).map(e=>e.kind||e.type), small:AMRT.zoomables({els:[{id:'a',type:'fx',kind:'columns',w:150,h:80,data:{}}]}).length, cmp:AMRT.zoomables({els:[{id:'b',type:'fx',kind:'counter',w:380,h:210,data:{}}]}).length, forced:AMRT.zoomables({els:[{id:'b',type:'fx',kind:'counter',w:380,h:210,data:{},zoom:true}]}).length, text:AMRT.zoomables({els:[{id:'t',type:'text',w:600,h:200}]}).length}));
  check('S05-17: AMRT.zoomables: modelos e imagens (maior área primeiro), nunca o que tem zoom:false, elementos < 160×90, componentes (salvo zoom:true) ou textos', JSON.stringify(zl.ids)==='["columns","image"]'&&zl.small===0&&zl.cmp===0&&zl.forced===1&&zl.text===0, zl);
  const gal=await p.evaluate(()=>{ const it=AMStudio.gallery.items(); return {wf:it.some(i=>i.id==='model:waterfall:bridge'), hv:it.some(i=>i.id==='model:harvey:best'), n:it.filter(i=>i.fam==='model'&&/^model:(columns|hbars|waterfall|bullet|harvey|funnel|radar):/.test(i.id)).length}; });
  check('S05-18: a vitrine de efeitos ganha uma caixa por efeito dos gráficos novos (23 no total), sem mexer no código da vitrine', gal.wf&&gal.hv&&gal.n===23, gal);
  const hk=await p.evaluate(()=>({z:AMStudio.HK.some(g=>g[1].some(r=>/Z amplia/.test(r[2]||''))), rows:AMStudio.HK.reduce((a,g)=>a+g[1].length,0)}));
  await p.keyboard.press('F1'); await sleep(300); const f1=await p.evaluate(()=>/Z amplia o gráfico/.test(document.querySelector('#modal .hk-b').textContent)); await p.keyboard.press('Escape'); await sleep(200);
  check('S05-19: HK (F1 e manual da capa) explica a tecla Z na nota de “Apresentar do início”, sem linha nova (o manual da capa fixa 17 linhas e cabe sem rolagem em 1280×720)', hk.z&&hk.rows===17&&f1, {hk,f1});
  const tt=await p.evaluate(()=>{ const s={els:[{type:'text',html:'TEMA · SEÇÃO',size:12,x:0,y:0},{type:'text',html:'Mensagem <b>principal</b><br>do slide',size:32,x:0,y:60},{type:'text',html:'1',size:96,x:0,y:0}]}; return [AMRT.slideTitle(s,3), AMRT.slideTitle({els:[]},4), AMRT.slideTitle({title:'Explícito',els:[]},0), AMRT.plain('<img src=x onerror="window.__xss=1">a &amp; b'), !!window.__xss]; });
  check('S05-20: AMRT.slideTitle: maior texto (sem o número de capítulo nem o rótulo em caixa alta), “Slide N” sem texto, slide.title explícito; plain() não executa nada', tt[0]==='Mensagem principal do slide'&&tt[1]==='Slide 5'&&tt[2]==='Explícito'&&tt[3]==='a & b'&&tt[4]===false, tt);

  /* ---------- 8. apresentação no editor: “Ver ampliado”, Esc fecha só a camada, depois sai ---------- */
  await fresh(p);
  await p.evaluate(()=>{ const S=AMStudio; S.deck.slides[0].els.push(S.mk.text('eyebrow',{x:54,y:30,w:600,h:22,html:'RESULTADOS'}), S.mk.text('title',{x:54,y:60,w:1100,h:60,html:'Ponte de valor 2024 → 2025',size:32})); const w=S.insertFx('waterfall'); w.x=600; w.y=150; w.w=640; w.h=380; const r=S.insertFx('radar'); r.x=40; r.y=150; r.w=520; r.h=360; S.addSlide('blank-light'); S.deck.slides[1].els.push(S.mk.text('title',{x:54,y:60,w:1100,h:60,html:'Sem gráficos',size:32})); S.addSlide('blank-dark'); S.insertFx('hbars'); S.goSlide(0); S.renderAll(); S.commit(); S.select(w.id); });
  await sleep(300);
  await p.click('#props [data-act=zoomview]'); await sleep(700);
  const ev=await p.evaluate(()=>({pres:document.querySelector('#presenter').classList.contains('open'), on:!!document.querySelector('#presenter .amp-zm.on'), e:(document.querySelector('#presenter .amp-zm .e')||{}).textContent, t:(document.querySelector('#presenter .amp-zm .t')||{}).textContent, n:(document.querySelector('#presenter .amp-zm .n')||{}).textContent}));
  await p.screenshot({path:SH('07-editor-ver-ampliado')});
  await p.keyboard.press('Escape'); await sleep(300); const ev2=await p.evaluate(()=>({pres:document.querySelector('#presenter').classList.contains('open'), on:!!document.querySelector('#presenter .amp-zm.on')}));
  await p.keyboard.press('Escape'); await sleep(400); const ev3=await p.evaluate(()=>document.querySelector('#presenter').classList.contains('open'));
  check('S05-21: “Ver ampliado na apresentação” abre o modo apresentação já com a cascata ampliada (cabeçalho = título do slide, 1 / 2); Esc fecha só a camada; o 2º Esc sai da apresentação', ev.pres&&ev.on&&/Cascata/.test(ev.e)&&ev.t==='Ponte de valor 2024 → 2025'&&ev.n==='1 / 2'&&ev2.pres&&!ev2.on&&ev3===false, {ev,ev2,ev3});
  await p.setViewportSize({width:1366,height:768}); await sleep(300);
  const ovL=await p.evaluate(()=>{const rb=document.getElementById('rib'); return {rib:rb.scrollWidth<=rb.clientWidth, lbl:getComputedStyle(document.querySelector('#bCharts .lbs')).display!=='none'};}); /* S34b: o rótulo curto de Gráficos aparece a partir de 1301 px (até 1300 só o ícone, para caber o botão Institucional) */
  await p.setViewportSize({width:1280,height:720}); await sleep(300);
  const ov=await p.evaluate(()=>{const t=document.getElementById('top'); const r=document.getElementById('bSave').getBoundingClientRect(); const rb=document.getElementById('rib'); return {top:t.scrollWidth<=t.clientWidth, save:r.right<=innerWidth, rib:rb.scrollWidth<=rb.clientWidth, lbl:getComputedStyle(document.querySelector('#bCharts .lbs')).display==='none', title:!!document.getElementById('bCharts').title};});
  await p.setViewportSize({width:1180,height:720}); await sleep(300);
  const ov2=await p.evaluate(()=>{const rb=document.getElementById('rib'); return {rib:rb.scrollWidth<=rb.clientWidth, lbl:getComputedStyle(document.querySelector('#bCharts .lbs')).display==='none', title:!!document.getElementById('bCharts').title};});
  await p.setViewportSize({width:1440,height:900}); await sleep(300);
  check('S05-22: com “Gráficos ▾” a barra de ferramentas cabe em 1366 (rótulo curto), em 1280 e em 1180 (só o ícone, dica no title); barra superior sem estouro', ovL.rib&&ovL.lbl&&ov.top&&ov.save&&ov.rib&&ov.lbl&&ov.title&&ov2.rib&&ov2.lbl&&ov2.title, {ovL,ov,ov2});

  /* ---------- 9. arquivo exportado: gráficos e “Ampliar” ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(TMP,'s05.html'); fs.writeFileSync(f,html);
  const q=await page(ctx,'file://'+f,'exp',1200);
  const ex=await q.evaluate(()=>({ed:typeof window.AMStudio, data:!!document.getElementById('am-deck-data'), slides:document.querySelectorAll('.amp-slide').length, wf:!!document.querySelector('.amp-slide.on .fxwf'), rd:!!document.querySelector('.amp-slide.on .fxrd'), charts:!!(AMRT.FX.columns&&AMRT.FX.harvey), css:!![...document.styleSheets].some(s=>{ try{ return [...s.cssRules].some(r=>/\.fxwf|wfIn/.test(r.cssText)); }catch(e){ return false; } }), zb:!!document.querySelector('.amp-zb'), zm:!!document.querySelector('.amp-zm'), btn:!document.querySelector('.amp-b[data-a=zoom]').hidden, pos:document.querySelector('.amp-pos').textContent}));
  check('S05-23: o arquivo exportado é autônomo (sem AMStudio), mantém id="am-deck-data", leva rt-30-charts (JS + CSS), toca a cascata e o radar no slide 1 e já tem o botão “Ampliar” na barra', ex.ed==='undefined'&&ex.data&&ex.slides===3&&ex.wf&&ex.rd&&ex.charts&&ex.css&&ex.zb&&ex.zm&&ex.btn&&/^01/.test(ex.pos), ex);
  check('S05-24: export sem onerror/onmouseover/onclick (CR-04) e sem “</script” solto no JS', !/onerror|onmouseover|onclick/i.test(html)&&html.split('</script>').length===4, {n:html.split('</script>').length});
  const deck=await (await q.$('.amp-deck')).boundingBox(); const L=(x,y)=>({x:deck.x+x/1280*deck.width, y:deck.y+y/720*deck.height});
  const wfR=await q.evaluate(()=>document.querySelector('.amp-slide.on .am-k-waterfall').getBoundingClientRect().toJSON());
  const c1=L(920,340); await q.mouse.move(c1.x,c1.y); await sleep(220);
  const hv=await q.evaluate(()=>{ const z=document.querySelector('.amp-zb'), r=z.getBoundingClientRect(); return {on:z.classList.contains('on'), vis:getComputedStyle(z).visibility, x:r.x, y:r.y, tab:z.tabIndex}; });
  await q.screenshot({path:SH('08-export-hover')});
  await q.mouse.move(L(640,690).x, L(640,690).y); await sleep(250); const hv2=await q.evaluate(()=>document.querySelector('.amp-zb').classList.contains('on'));
  await sleep(450); const hv3=await q.evaluate(()=>({on:document.querySelector('.amp-zb').classList.contains('on'), vis:getComputedStyle(document.querySelector('.amp-zb')).visibility}));
  check('S05-25: passar o mouse sobre a cascata mostra ⤢ no canto superior direito dela (≤ 220 ms); sair esconde depois de ~450 ms (ainda visível a 250 ms) e o botão escondido não é focável (visibility:hidden)', hv.on&&hv.vis==='visible'&&Math.abs(hv.x-(wfR.right-40))<=2&&Math.abs(hv.y-(wfR.top+8))<=2&&hv2&&!hv3.on&&hv3.vis==='hidden', {hv,wfR,hv2,hv3});
  /* duplo clique na cascata, que ocupa a zona direita (18%) do slide: não avança, amplia */
  const c2=L(1150,400); await q.mouse.click(c2.x,c2.y); await sleep(300); const noNav=await q.evaluate(()=>document.querySelector('.amp-pos').textContent);
  await q.mouse.dblclick(c2.x,c2.y); await sleep(600);
  const k0=await q.evaluate(()=>{ const z=document.querySelector('.amp-zm'), vp=z.querySelector('.amp-zm-vp'), st=vp.querySelector('.am-stage'), el=AMRT.zoomables(JSON.parse(document.getElementById('am-deck-data').textContent).slides[0])[0];
    const ztxt=vp.querySelector('text.wf-v').getBoundingClientRect().height, stxt=document.querySelector('.amp-slide.on .fxwf text.wf-v').getBoundingClientRect().height, dw=document.querySelector('.amp-deck').getBoundingClientRect().width;
    return {on:z.classList.contains('on'), pos:document.querySelector('.amp-pos').textContent, vp:[vp.offsetWidth,vp.offsetHeight], st:[st.offsetWidth,st.offsetHeight], el:[el.w,el.h,el.kind], k:vp.offsetWidth/el.w, ratio:ztxt/stxt, deckScale:dw/1280, pre:st.classList.contains('am-pre'), focus:document.activeElement===z.querySelector('[data-z=close]'), t:z.querySelector('.t').textContent, n:z.querySelector('.n').textContent, e:z.querySelector('.e').textContent, dark:z.querySelector('.amp-zm-box').classList.contains('dark'), inView:(r=>r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight)(z.querySelector('.amp-zm-box').getBoundingClientRect()), zb:document.querySelector('.amp-zb').classList.contains('on')}; });
  await q.screenshot({path:SH('09-export-ampliado')});
  check('S05-26: clique e duplo clique na cascata (zona direita do slide) não avançam; o duplo clique abre a camada: janela = el.w×k por el.h×k, palco interno = 1280k, texto nítido ~k× maior que no slide, estado final (sem am-pre), foco no ✕, cabeçalho com o título do slide, 1 / 2, caixa clara dentro da janela, ⤢ escondido', /^01/.test(noNav)&&k0.on&&/^01/.test(k0.pos)&&k0.el[2]==='waterfall'&&Math.abs(k0.vp[0]-k0.el[0]*k0.k)<=1&&Math.abs(k0.vp[1]-k0.el[1]*k0.k)<=1.5&&Math.abs(k0.st[0]-1280*k0.k)<=1&&Math.abs(k0.ratio-k0.k/k0.deckScale)<0.08&&k0.k>1.5&&!k0.pre&&k0.focus&&k0.t==='Ponte de valor 2024 → 2025'&&k0.n==='1 / 2'&&/Cascata/.test(k0.e)&&!k0.dark&&k0.inView&&!k0.zb, k0);
  await q.keyboard.press('ArrowRight'); await sleep(400);
  const k1=await q.evaluate(()=>({n:document.querySelector('.amp-zm .n').textContent, e:document.querySelector('.amp-zm .e').textContent, pos:document.querySelector('.amp-pos').textContent, rd:!!document.querySelector('.amp-zm-vp .fxrd')}));
  await q.evaluate(()=>document.activeElement.blur()); /* fora dos botões: Espaço e Enter não acionam nada */
  for(const key of ['ArrowDown','PageDown','Space','Enter','Home','End','f','g']) await q.keyboard.press(key);
  await sleep(300); const k2=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), pos:document.querySelector('.amp-pos').textContent, n:document.querySelector('.amp-zm .n').textContent, full:!!document.fullscreenElement}));
  await q.keyboard.press('ArrowRight'); await sleep(300); const k3=await q.evaluate(()=>document.querySelector('.amp-zm .n').textContent);
  await q.keyboard.press('ArrowLeft'); await sleep(300); const k4=await q.evaluate(()=>document.querySelector('.amp-zm .n').textContent);
  check('S05-27: com a camada aberta, → mostra o radar (2 / 2) sem mudar o slide; → de novo dá a volta (1 / 2) e ← volta; Espaço, Enter, PageDown, Home, End, F e G (com o foco fora dos botões) não chegam ao slide', k1.n==='2 / 2'&&/Radar/.test(k1.e)&&/^01/.test(k1.pos)&&k1.rd&&k2.on&&/^01/.test(k2.pos)&&k2.n==='2 / 2'&&!k2.full&&k3==='1 / 2'&&k4==='2 / 2', {k1,k2,k3,k4});
  /* Tab circula nos 3 botões; Enter no ✕ fecha (ação nativa do botão); foco sai da camada */
  const tabs=[]; for(let i=0;i<4;i++){ await q.keyboard.press('Tab'); tabs.push(await q.evaluate(()=>(document.activeElement.dataset||{}).z||document.activeElement.tagName)); }
  await q.keyboard.press('Shift+Tab'); const st1=await q.evaluate(()=>(document.activeElement.dataset||{}).z);
  await q.keyboard.press('Tab'); await q.keyboard.press('Tab'); const stc=await q.evaluate(()=>(document.activeElement.dataset||{}).z); await q.keyboard.press('Tab'); const stx=await q.evaluate(()=>(document.activeElement.dataset||{}).z); await q.keyboard.press('Enter'); await sleep(300);
  const k5=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), vp:document.querySelector('.amp-zm-vp').innerHTML.length, pos:document.querySelector('.amp-pos').textContent, focus:document.activeElement.tagName+'.'+document.activeElement.className}));
  check('S05-28: Tab circula só entre ‹ › ✕ (sem sair da camada), Shift+Tab volta; Enter no ✕ em foco fecha a camada (sem avançar o slide), que fica vazia, e o foco não fica preso nela', JSON.stringify(tabs)==='["prev","next","close","prev"]'&&st1==='close'&&stc==='next'&&stx==='close'&&!k5.on&&k5.vp===0&&/^01/.test(k5.pos)&&!/amp-zx/.test(k5.focus), {tabs,st1,stc,stx,k5});
  /* Z sem mouse em cima abre o maior (cascata); Z com o mouse no radar abre o radar; Esc fecha; clique no fundo fecha */
  await q.mouse.move(L(640,690).x, L(640,690).y); await sleep(500); await q.keyboard.press('z'); await sleep(400);
  const z1=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), e:document.querySelector('.amp-zm .e').textContent}));
  await q.keyboard.press('z'); await sleep(200); const z1b=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), e:document.querySelector('.amp-zm .e').textContent}));
  await q.keyboard.press('Escape'); await sleep(300); const z2=await q.evaluate(()=>document.querySelector('.amp-zm').classList.contains('on'));
  const c3=L(300,330); await q.mouse.move(c3.x,c3.y); await sleep(250); await q.keyboard.press('Z'); await sleep(400);
  const z3=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), e:document.querySelector('.amp-zm .e').textContent, n:document.querySelector('.amp-zm .n').textContent}));
  await q.mouse.click(8,8); await sleep(300); const z4=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), pos:document.querySelector('.amp-pos').textContent}));
  check('S05-29: Z abre o maior gráfico do slide (cascata) e, com o mouse sobre o radar, abre o radar (2 / 2); Z repetido não troca nem fecha; Esc fecha; clique no fundo escurecido fecha sem mudar o slide', z1.on&&/Cascata/.test(z1.e)&&z1b.on&&/Cascata/.test(z1b.e)&&!z2&&z3.on&&/Radar/.test(z3.e)&&z3.n==='2 / 2'&&!z4.on&&/^01/.test(z4.pos), {z1,z1b,z2,z3,z4});
  /* botão da barra: abre; trocar de slide (hash) fecha a camada e esconde o botão onde não há nada a ampliar */
  await q.click('.amp-b[data-a=zoom]'); await sleep(400); const b1=await q.evaluate(()=>document.querySelector('.amp-zm').classList.contains('on'));
  await q.evaluate(()=>{ location.hash='#/2'; }); await sleep(500);
  const b2=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), vp:document.querySelector('.amp-zm-vp').innerHTML.length, pos:document.querySelector('.amp-pos').textContent, btn:document.querySelector('.amp-b[data-a=zoom]').hidden, zb:document.querySelector('.amp-zb').classList.contains('on')}));
  await q.keyboard.press('z'); await sleep(200); const b3=await q.evaluate(()=>document.querySelector('.amp-zm').classList.contains('on'));
  const c4=L(640,360); await q.mouse.dblclick(c4.x,c4.y); await sleep(300); const b4=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), pos:document.querySelector('.amp-pos').textContent}));
  await q.keyboard.press('ArrowRight'); await sleep(500);
  const b5=await q.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent, btn:document.querySelector('.amp-b[data-a=zoom]').hidden}));
  await q.click('.amp-b[data-a=zoom]'); await sleep(500);
  const b6=await q.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), dark:document.querySelector('.amp-zm-box').classList.contains('dark'), e:document.querySelector('.amp-zm .e').textContent, bg:document.querySelector('.amp-zm-vp').style.background, panel:!!document.querySelector('.amp-zm-vp .fx-panel'), fs:parseFloat(getComputedStyle(document.querySelector('.amp-zm-vp .hb-l')).fontSize)/parseFloat(getComputedStyle(document.querySelector('.amp-slide.on .hb-l')).fontSize), k:document.querySelector('.amp-zm-vp .am-stage').offsetWidth/1280*1280/document.querySelector('.amp-deck').getBoundingClientRect().width}));
  await q.screenshot({path:SH('10-export-ampliado-escuro')});
  await q.keyboard.press('Escape'); await sleep(200);
  check('S05-30: o botão “Ampliar” da barra abre a camada; ir para o slide 2 (#/2) fecha e esvazia a camada, esconde o botão da barra e o ⤢; Z e duplo clique não fazem nada ali; no slide 3 (navy) o botão volta e amplia o ranking numa caixa escura, com o painel branco e o texto HTML ~k× maior', b1&&!b2.on&&b2.vp===0&&/^02/.test(b2.pos)&&b2.btn&&!b2.zb&&!b3&&!b4.on&&/^02/.test(b4.pos)&&/^03/.test(b5.pos)&&!b5.btn&&b6.on&&b6.dark&&/Ranking/.test(b6.e)&&b6.panel&&Math.abs(b6.fs-b6.k)<0.08, {b1,b2,b3,b4,b5,b6});
  /* regra 5 (KEYMAP): clique do mouse em “Anterior” não rouba o foco — Espaço continua avançando; clique na zona direita vazia ainda avança */
  await q.click('.amp-b[data-a=prev]'); await sleep(500); const r1=await q.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent, focus:document.activeElement.tagName}));
  await q.keyboard.press('Space'); await sleep(500); const r2=await q.evaluate(()=>document.querySelector('.amp-pos').textContent);
  await q.keyboard.press('Home'); await sleep(500); const c5=L(1200,60); await q.mouse.click(c5.x,c5.y); await sleep(500); const r3=await q.evaluate(()=>document.querySelector('.amp-pos').textContent);
  check('S05-31: depois de clicar em “← Anterior” com o mouse (02), Espaço avança (03) — o clique não deixou o foco no botão; no slide 1, clicar no vazio da zona direita ainda avança (02)', /^02/.test(r1.pos)&&r1.focus!=='BUTTON'&&/^03/.test(r2)&&/^02/.test(r3), {r1,r2,r3});
  /* z dentro de um campo de texto não amplia (regra 1) */
  await q.keyboard.press('Home'); await sleep(400);
  await q.evaluate(()=>{ const i=document.createElement('input'); i.id='s05in'; document.body.appendChild(i); i.focus(); }); await q.keyboard.type('z'); await sleep(200);
  const r4=await q.evaluate(()=>({v:document.getElementById('s05in').value, on:document.querySelector('.amp-zm').classList.contains('on')})); await q.evaluate(()=>document.getElementById('s05in').remove());
  check('S05-32: “z” digitado num campo de texto do player não abre a camada', r4.v==='z'&&!r4.on, r4);
  /* celular: barra com o botão “Ampliar” sem estourar; a camada cabe na tela */
  await q.setViewportSize({width:390,height:844}); await sleep(500);
  const m1=await q.evaluate(()=>{ const r=s=>document.querySelector(s).getBoundingClientRect(); return {bar:document.querySelector('.amp-bar').scrollWidth<=390, wm:Math.round(r('.amp-wm').left), zoomVis:!document.querySelector('.amp-b[data-a=zoom]').hidden&&getComputedStyle(document.querySelector('.amp-b[data-a=zoom]')).display!=='none', fullIn:r('.amp-b[data-a=full]').right<=390, words:getComputedStyle(document.querySelector('.amp-b[data-a=zoom] .amp-bw')).display==='none', doc:document.documentElement.scrollWidth<=390}; });
  await q.keyboard.press('z'); await sleep(500);
  const m2=await q.evaluate(()=>{ const r=document.querySelector('.amp-zm-box').getBoundingClientRect(); return {on:document.querySelector('.amp-zm').classList.contains('on'), fit:r.left>=0&&r.right<=390&&r.top>=0&&r.bottom<=844, w:Math.round(r.width)}; });
  await q.screenshot({path:SH('11-export-390')}); await q.keyboard.press('Escape'); await q.setViewportSize({width:1440,height:900}); await sleep(300);
  check('S05-33: a 390 px a barra cabe (marca inteira, “Ampliar” só com o ícone, tela cheia dentro da tela) e a camada ampliada cabe na janela', m1.bar&&m1.wm>=8&&m1.zoomVis&&m1.fullIn&&m1.words&&m1.doc&&m2.on&&m2.fit, {m1,m2});
  await q.close();
  /* movimento reduzido: sem animação na camada */
  const ctx2=await b.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}); const q2=await page(ctx2,'file://'+f,'rm',900);
  await q2.keyboard.press('z'); await sleep(300);
  const rm=await q2.evaluate(()=>({on:document.querySelector('.amp-zm').classList.contains('on'), box:getComputedStyle(document.querySelector('.amp-zm-box')).animationName, zm:getComputedStyle(document.querySelector('.amp-zm')).animationName}));
  await q2.close(); await ctx2.close();
  check('S05-34: com movimento reduzido a camada abre sem animação', rm.on&&rm.box==='none'&&rm.zm==='none', rm);
  /* destruir o player (editor) não deixa listener de teclado nem camada para trás */
  await p.evaluate(()=>AMStudio.present(0)); await sleep(600); await p.keyboard.press('z'); await sleep(300);
  const d1=await p.evaluate(()=>!!document.querySelector('#presenter .amp-zm.on'));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await sleep(400);
  const d2=await p.evaluate(()=>({pres:document.querySelector('#presenter').classList.contains('open'), left:document.querySelector('#presenter').children.length, sel:AMStudio.selected().length}));
  await p.keyboard.press('z'); await sleep(200); const d3=await p.evaluate(()=>({pres:document.querySelector('#presenter').classList.contains('open'), zm:!!document.querySelector('.amp-zm')}));
  check('S05-35: no editor, Z amplia na apresentação; Esc, Esc sai e o player é destruído (nada no #presenter); um Z depois disso não faz nada', d1&&!d2.pres&&d2.left===0&&!d3.pres&&!d3.zm, {d1,d2,d3});

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
