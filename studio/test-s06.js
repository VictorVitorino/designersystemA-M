/* test-s06: SmartArt (item 4.3). rt-40-smartart.js/.css: um modelo `smart` (cat SmartArt) com 12 layouts (processo, chevrons,
   degraus, ciclo, radial, Venn, hierarquia, lista em blocos, matriz 2×2, pirâmide, funil, alvo) alimentado por um painel de texto
   (codec outline: um item por linha, Tab = nível abaixo); trocar o layout mantém o texto; 4 efeitos (um por um, por nível, tudo
   junto, foco percorrendo); edição no slide por duplo clique; Inserir › SmartArt ▸ (12 layouts com miniatura), seletor visual
   #mSmart a partir de “Gráficos ▾”, categoria SmartArt na gaveta de modelos; números e textos saneados (safeEl + norm), export
   autônomo e reabertura. Correções do QA (rodada 1, S06-23…27): clamp de toda caixa (alvo em caixas quadradas/estreitas, html() puro com
   NaN/negativo), prefixo “=” da interseção do Venn na edição em linha (data-ep), nome por elemento (AMRT.fxLabel) no painel e no rodapé
   do “Ampliar”, duplo clique na linha inteira de um tópico quebrado, saneamento de texto objeto. Uso: python3 assemble.py && node test-s06.js
   (o qa-gate.sh pega qualquer test-s[0-9][0-9]*.js) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s06-'+f+'.png');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'canteiro-s06-'));
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
const LAYOUTS=['process','chevron','stepup','cycle','hub','venn','org','blocks','matrix','pyramid','funnel','target','flow','mindmap']; /* S32: + fluxograma e mapa mental (fim do registro) */
const LAYOUTS_G=['process','chevron','stepup','flow','cycle','hub','venn','mindmap','org','blocks','matrix','pyramid','funnel','target']; /* ordem por grupo (seletor visual) */
const DEMO={
  process:null,
  chevron:'Descobrir\n  Entrevistas\n  Dados\nDefinir\n  Problema-chave\nDesenvolver\n  Protótipos\nEntregar\n  Piloto e escala',
  stepup:'Inicial\n  Ad hoc\nRepetível\n  Processos básicos\nDefinido\n  Padrões únicos\nGerenciado\n  Métricas\nOtimizado\n  Melhoria contínua',
  cycle:'Planejar\nExecutar\nVerificar\nAgir', hub:'PMO\nFinanças\nTI\nOperações\nRH\nJurídico\nComercial', venn:'Desejável\nViável\nFactível\n= Inovação',
  org:'CEO\n  Operações\n    Supply\n    Fábricas\n  Finanças\n    Controladoria\n    Tesouraria\n  Pessoas\n    Talentos',
  blocks:'Pessoas\n  Novo modelo de papéis\n  Plano de capacitação\nProcessos\n  Fluxo de aprovação em 2 níveis\nTecnologia\n  Workflow único e painel de status',
  matrix:'Manter\n  Processos estáveis\nInvestir\n  Alto potencial\nRevisar\n  Baixo retorno\nDescontinuar\n  Sem aderência',
  pyramid:'Propósito\n  Por que existimos\nEstratégia\n  Onde jogar e como vencer\nCapacidades\n  O que precisamos dominar\nOperação\n  Processos, sistemas e pessoas',
  funnel:'Ideias\n  120 propostas\nTriagem\n  45 viáveis\nPilotos\n  12 testes\nEscala\n  4 iniciativas',
  flow:'Início\nReceber pedido\n  Portal ou e-mail\n? Dados completos\nValidar crédito\nSeparar e faturar\n? Entrega no prazo\nNotificar cliente\nFim',
  mindmap:'Transformação digital\nClientes\n  Portal único\n  Autoatendimento\nOperações\n  Automação\n  Painéis de status\nPessoas\n  Capacitação\n  Novos papéis\nDados\n  Dados mestres\n  Governança',
  target:'Núcleo: propósito\n  O que nunca muda\nValores\n  Como decidimos\nComportamentos\n  O que se vê no dia a dia\nSímbolos\n  Rituais, espaços e marcas' };
/* paleta A&M + branco/transparente: toda cor de fundo/fill/stroke do SmartArt tem de estar aqui (nunca vermelho) */
const PAL=['#002A46','#4A6FA5','#A3B8D6','#F78C16','#C9D6E8','#13406A','#43698F','#7EA1C3','#DCE5F0','#EEF2F7','#E3EAF2','#FFFFFF','#FFF','NONE','TRANSPARENT','CURRENTCOLOR'];
/* bancada: palco 1280×720 em escala 1:1 por cima do editor (a mesma do test-s05) */
const LAB=`window.__lab=function(slide,play){ var d=document.getElementById('s6lab'); if(!d){ d=document.createElement('div'); d.id='s6lab'; d.style.cssText='position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;background:#fff'; document.body.appendChild(d); }
  d.innerHTML=''; d.style.display='block'; var st=AMRT.renderSlide(slide,{play:!!play}); d.appendChild(st); if(play){ st.classList.remove('am-pre'); void st.offsetWidth; st.classList.add('am-in'); if(d._c) d._c(); d._c=AMRT.runFx(st); } return st; };
  window.__labOff=function(){ var d=document.getElementById('s6lab'); if(d){ if(d._c) d._c(); d.innerHTML=''; d.style.display='none'; } };`;
/* o mesmo detector de sobreposição/transbordamento do test-cover / test-s05, num palco qualquer (seletor) */
async function stageCheck(p, sel){
  return p.evaluate((sel)=>{
    const st=document.querySelector(sel), sr=st.getBoundingClientRect(), k=1280/sr.width, issues=[], boxes=[];
    const L=r=>({x:(r.left-sr.left)*k,y:(r.top-sr.top)*k,r:(r.right-sr.left)*k,b:(r.bottom-sr.top)*k});
    st.querySelectorAll('.am-el[data-id]').forEach(n=>{
      let u=null; const add=r=>{ if(r.width<1||r.height<1) return; const q=L(r); u=u?{x:Math.min(u.x,q.x),y:Math.min(u.y,q.y),r:Math.max(u.r,q.r),b:Math.max(u.b,q.b)}:q; };
      const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT); let t; while((t=walker.nextNode())){ if(!t.textContent.trim()) continue; const rg=document.createRange(); rg.selectNodeContents(t); [...rg.getClientRects()].forEach(add); }
      n.querySelectorAll('svg rect,svg circle,svg path,svg line,img,.sa-n,.sa-sub,.sa-bt').forEach(e=>add(e.getBoundingClientRect()));
      n.querySelectorAll('.sa-n,.sa-sub,.sa-bt').forEach(x=>{ if(x.scrollHeight>x.clientHeight+1||x.scrollWidth>x.clientWidth+1) issues.push('corte em "'+x.textContent.slice(0,24)+'"'); });
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

  /* ---------- 1. registro, layouts e codec ---------- */
  const reg=await p.evaluate((LAYOUTS)=>{ const F=AMRT.FX.smart; if(!F) return {missing:true}; const L=AMRT.SMART_LAYOUTS||[]; return {model:!!F.model, cat:F.cat, nv:(F.variants||[]).length, labels:(F.variants||[]).every(v=>v[1]&&v[2]), keys:(F.variants||[]).map(v=>v[0]), defOk:(F.variants||[]).some(v=>v[0]===F.variant), size:[F.w,F.h], fields:(F.fields||[]).map(f=>f[0]+':'+f[2]), tip:!!F.tip, kw:!!F.kw, norm:typeof F.norm==='function', layouts:L.map(l=>l[0]), lab:L.every(l=>l[1]&&l[2]&&l[3]&&l[4]>=1&&l[5]>=l[4]), fns:['smartParse','smartText','smartIcon','smartFind'].every(k=>typeof AMRT[k]==='function'), icons:L.every(l=>/^<svg /.test(AMRT.smartIcon(l[0]))), defItems:Array.isArray(F.data.items)&&F.data.items.length===8}; },LAYOUTS);
  check('S06-01: FX.smart registrado como modelo (cat SmartArt), 4 efeitos com rótulo e descrição (um/por nível/tudo/foco), tamanho ≤ 1172×470, campos layout (smartlayout) + items (outline), dica, busca, norm(); 14 layouts na ordem do CATALOG com rótulo, grupo, dica e limites; smartParse/Text/Icon/Find', !reg.missing&&reg.model&&reg.cat==='SmartArt'&&reg.nv===4&&reg.labels&&JSON.stringify(reg.keys)==='["one","level","all","focus"]'&&reg.defOk&&reg.size[0]<=1172&&reg.size[1]<=470&&JSON.stringify(reg.fields)==='["layout:smartlayout","items:outline"]'&&reg.tip&&reg.kw&&reg.norm&&JSON.stringify(reg.layouts)===JSON.stringify(LAYOUTS)&&reg.lab&&reg.fns&&reg.icons&&reg.defItems, reg);
  const cod=await p.evaluate(()=>{ const P=AMRT.smartParse, T=AMRT.smartText;
    const a=P('Raiz\n  Filho\n\tFilho tab\n- Marcador\n\n      Pulo (vira 1)\n    Neto\r\nOutra'); const arr=P([{t:' Um ',lv:0},null,{t:'',lv:1},{t:'Dois',lv:'7'},'solto',{t:'x'.repeat(300),lv:0}]);
    return {lv:a.map(o=>o.lv+':'+o.t), rt:T(a)===T(P(T(a))), txt:T(a), idx:arr.map(o=>o.i+':'+o.lv+':'+o.t.length), empty:P('').length+P(null).length+P([]).length, max:P(new Array(100).join('a\n')).length}; });
  check('S06-02: codec outline: Tab/2 espaços = nível, marcadores ignorados, linhas vazias somem, nível nunca pula (6 espaços → 1), texto ↔ itens estável; arrays guardam o índice original (.i), nulos e vazios caem, nível e tamanho com clamp, no máximo 60 itens', JSON.stringify(cod.lv)==='["0:Raiz","1:Filho","1:Filho tab","0:Marcador","1:Pulo (vira 1)","2:Neto","0:Outra"]'&&cod.rt&&cod.txt.split('\n')[5]==='    Neto'&&JSON.stringify(cod.idx)==='["0:0:2","3:1:4","4:0:5","5:0:200"]'&&cod.empty===0&&cod.max===60, cod);

  /* ---------- 2. gaveta de modelos, “Gráficos ▾” › SmartArt (seletor visual), Inserir › SmartArt ▸ ---------- */
  await p.click('#bModels'); await sleep(700);
  const dr=await p.evaluate(()=>{ const cats=[...document.querySelectorAll('#modelsBody .dcat')].map(c=>c.dataset.cat); const card=document.querySelector('#modelsBody .fxi[data-k=smart]'); return {cats, last:cats[cats.length-1], card:!!card, pv:!!(card&&card.querySelector('.pv .am-stage .fxsa')), pills:card?card.querySelectorAll('.vl span').length:0}; });
  await p.fill('#mSearch','organograma'); await sleep(300);
  const srch=await p.evaluate(()=>[...document.querySelectorAll('#modelsBody .fxi')].filter(c=>c.style.display!=='none').map(c=>c.dataset.k));
  await p.fill('#mSearch',''); await sleep(200); await p.evaluate(()=>{ const c=document.querySelector('#modelsBody .dcat[data-cat=SmartArt]'); c&&c.scrollIntoView(); }); await sleep(300); await p.screenshot({path:SH('01-gaveta')}); await p.click('#bFxClose'); await sleep(300);
  check('S06-03: gaveta Modelos: categoria “SmartArt” (a última da ordem), card com prévia viva e 4 pílulas de efeito; a busca “organograma” acha só o SmartArt', dr.last==='SmartArt'&&dr.card&&dr.pv&&dr.pills===4&&srch.length===1&&srch[0]==='smart', {dr,srch});
  await fresh(p);
  await p.click('#bCharts'); await sleep(350);
  const rib=await p.evaluate(()=>{ const m=document.getElementById('mChart'); return {fx:m.querySelectorAll('button[data-fx]').length, heads:m.querySelectorAll('.mh').length, icons:m.querySelectorAll('button .mi-ic svg').length, entry:!!m.querySelector('[data-open=mSmart]'), title:/SmartArt/.test(document.getElementById('bCharts').title)}; });
  await p.click('#mChart [data-open=mSmart]'); await sleep(400);
  const sm=await p.evaluate(()=>{ const m=document.getElementById('mSmart'), r=m.getBoundingClientRect(); return {open:m.classList.contains('open'), chartClosed:!document.getElementById('mChart').classList.contains('open'), tiles:[...m.querySelectorAll('[data-smart]')].map(b=>b.dataset.smart), heads:m.querySelectorAll('.sh').length, svg:m.querySelectorAll('[data-smart] svg').length, view:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight, titles:[...m.querySelectorAll('[data-smart]')].every(b=>b.title.length>10)}; });
  await p.screenshot({path:SH('02-seletor-msmart')});
  await p.click('#mSmart [data-smart=cycle]'); await sleep(500);
  const ins1=await last(p); const after1=await p.evaluate(()=>({closed:!document.getElementById('mSmart').classList.contains('open'), name:document.querySelector('#props .ph h2').firstChild.textContent, n:AMStudio.deck.slides[0].els.length}));
  check('S06-04: “Gráficos ▾” mantém os 11 gráficos em 3 grupos (S05) e ganha a entrada SmartArt; ela abre o seletor visual com os 14 layouts em 4 grupos (miniatura e dica em cada um), dentro da janela; “Ciclo” insere o SmartArt já nesse layout com os itens de exemplo do ciclo, com o efeito padrão, e fecha o seletor; o painel diz “SmartArt · Ciclo”', rib.fx===11&&rib.heads===3&&rib.icons===11&&rib.entry&&rib.title&&sm.open&&sm.chartClosed&&JSON.stringify(sm.tiles)===JSON.stringify(LAYOUTS_G)&&sm.heads===4&&sm.svg===14&&sm.view&&sm.titles&&ins1&&ins1.kind==='smart'&&ins1.data.layout==='cycle'&&ins1.variant==='one'&&ins1.data.panel==null&&Array.isArray(ins1.data.items)&&ins1.data.items.map(o=>o.t).join('|')==='Planejar|Executar|Verificar|Agir'&&after1.closed&&after1.name==='SmartArt · Ciclo'&&after1.n===1, {rib,sm,ins1:ins1&&ins1.data,after1});
  await sleep(2600); /* prévia automática termina */
  await p.click('#mbar [data-m=insert]'); await sleep(300);
  const insMenu=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi .xl')].map(x=>x.textContent));
  await p.locator('.xmenu .xi',{hasText:'SmartArt'}).first().hover(); await sleep(450);
  const sub=await p.evaluate(()=>{ const m=[...document.querySelectorAll('.xmenu')].pop(), r=m.getBoundingClientRect(); return {items:[...m.querySelectorAll('.xi .xl')].map(x=>x.textContent), heads:[...m.querySelectorAll('.xhd')].map(x=>x.textContent), icons:m.querySelectorAll('.xi .xic svg').length, cols:m.classList.contains('xcols'), view:r.right<=innerWidth&&r.bottom<=innerHeight, cut:[...m.querySelectorAll('.xi .xl')].some(x=>x.scrollWidth>x.clientWidth+1)}; });
  await p.screenshot({path:SH('03-inserir-smartart')});
  await p.locator('.xmenu .xi',{hasText:'Pirâmide'}).last().click(); await sleep(400);
  const ins2=await last(p);
  check('S06-05: Inserir › SmartArt ▸ lista os 14 layouts em 4 grupos com miniatura, em duas colunas, sem cortar rótulos; “Pirâmide” insere o layout pirâmide; o menu Inserir mantém um único item com “forma” e os três primeiros itens de texto', insMenu.filter(t=>/forma/i.test(t)).length===1&&insMenu.slice(0,3).join('|')==='Título|Subtítulo em destaque|Texto corrido'&&insMenu.some(t=>t==='SmartArt')&&sub.items.length===14&&sub.heads.length===4&&sub.icons===14&&sub.cols&&sub.view&&!sub.cut&&ins2&&ins2.kind==='smart'&&ins2.data.layout==='pyramid'&&ins2.data.items[0].t==='Propósito', {insMenu,sub,ins2:ins2&&ins2.data});
  await sleep(2600);

  /* ---------- 3. painel: grade de layouts (troca mantém o texto), painel de texto (codec + Tab/Shift+Tab/Enter), commit, desfazer ---------- */
  await fresh(p); await p.evaluate(()=>AMStudio.insertFx('smart')); await sleep(300);
  const pr=await p.evaluate(()=>{ const q=s=>document.querySelector('#props '+s); const ta=q('textarea[data-codec=outline]'); return {secs:[...document.querySelectorAll('#props .sec h3')].map(h=>h.textContent), chips:[...document.querySelectorAll('#props [data-var]')].map(x=>x.dataset.var), tiles:[...document.querySelectorAll('#props .salg [data-set="data.layout"]')].map(b=>b.dataset.v), on:q('.salg .on')&&q('.salg .on').dataset.v, ta:!!ta, mono:ta&&/Mono/.test(getComputedStyle(ta).fontFamily), txt:ta&&ta.value, hint:!!q('.outl-h'), panel:!!q('[data-set="data.panel"]'), zoom:q('[data-set=zoom]')&&/\bon\b/.test(q('[data-set=zoom]').className), note:(q('.salg')&&q('.salg').nextElementSibling.textContent)||''}; });
  await p.screenshot({path:SH('04-painel')});
  check('S06-06: painel do SmartArt: efeitos como chips, Conteúdo com a grade dos 14 layouts (o atual marcado) e a dica do layout com os limites, painel de texto mono (codec outline) com o texto dos itens recuado, dica das teclas, Painel branco e “Ampliar na apresentação” ligado', pr.secs.indexOf('Conteúdo')>=0&&pr.secs.indexOf('Ampliar na apresentação')>=0&&JSON.stringify(pr.chips)==='["one","level","all","focus"]'&&JSON.stringify(pr.tiles)===JSON.stringify(LAYOUTS)&&pr.on==='process'&&pr.ta&&pr.mono&&pr.txt==='Diagnóstico\n  Entrevistas e dados\nDesenho\n  Modelo TO-BE\nImplementação\n  Ondas e squads\nSustentação\n  KPIs e rituais'&&pr.hint&&pr.panel&&pr.zoom&&/Processo/.test(pr.note)&&/2 a 8/.test(pr.note), pr);
  const before=JSON.stringify((await last(p)).data.items);
  await p.click('#props .salg [data-v=org]'); await sleep(400);
  const sw=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0], st=document.querySelector('#wrap .am-stage'); return {layout:e.data.layout, items:JSON.stringify(e.data.items), org:!!st.querySelector('.fxsa.sal-org'), d0:st.querySelectorAll('.sa-org.sa-d0').length, d1:st.querySelectorAll('.sa-org.sa-d1').length, lines:st.querySelectorAll('.sa-ln').length, on:document.querySelector('#props .salg .on').dataset.v, name:document.querySelector('#props .ph h2').firstChild.textContent}; });
  await p.click('#bUndo'); await sleep(400);
  const un=await p.evaluate(()=>({layout:AMStudio.deck.slides[0].els[0].data.layout, proc:!!document.querySelector('#wrap .am-stage .fxsa.sal-process'), boxes:document.querySelectorAll('#wrap .am-stage .sa-box').length, arrows:document.querySelectorAll('#wrap .am-stage .sa-hd').length}));
  check('S06-07: trocar o layout pela grade mantém os itens (4 etapas + 4 tópicos viram hierarquia com conectores), marca a miniatura e renomeia o elemento; é um passo de desfazer (Ctrl+Z volta ao processo com 4 caixas e 3 setas)', sw.layout==='org'&&sw.items===before&&sw.org&&sw.d0===4&&sw.d1===4&&sw.lines===4&&sw.on==='org'&&sw.name==='SmartArt · Hierarquia'&&un.layout==='process'&&un.proc&&un.boxes===4&&un.arrows===3, {sw,un});
  /* painel de texto: digitar (input ao vivo) e teclas */
  await p.fill('#props textarea[data-codec=outline]','Planejar\n  Metas\n  Orçamento\nExecutar\n- Verificar\nAgir'); await sleep(300);
  const ed=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0], st=document.querySelector('#wrap .am-stage'); return {items:e.data.items.map(o=>o.lv+':'+o.t), boxes:st.querySelectorAll('.sa-box').length, lis:st.querySelectorAll('.sa-box li').length, focus:document.activeElement===document.querySelector('#props textarea[data-codec=outline]')}; });
  check('S06-08: digitar no painel de texto atualiza os itens ao vivo (2 espaços = nível 1, marcador “-” ignorado) e redesenha o processo (4 caixas, 2 tópicos), sem tirar o foco do campo', JSON.stringify(ed.items)==='["0:Planejar","1:Metas","1:Orçamento","0:Executar","0:Verificar","0:Agir"]'&&ed.boxes===4&&ed.lis===2&&ed.focus, ed);
  const ta=await p.$('#props textarea[data-codec=outline]');
  const setCaret=(line,col)=>p.evaluate(([line,col])=>{ const t=document.querySelector('#props textarea[data-codec=outline]'), ls=t.value.split('\n'); let pos=0; for(let i=0;i<line;i++) pos+=ls[i].length+1; t.focus(); t.setSelectionRange(pos+col,pos+col); },[line,col]);
  const val=()=>p.evaluate(()=>({v:document.querySelector('#props textarea[data-codec=outline]').value, sel:document.querySelector('#props textarea[data-codec=outline]').selectionStart, active:document.activeElement&&document.activeElement.tagName, items:AMStudio.deck.slides[0].els[0].data.items.map(o=>o.lv+':'+o.t), n:AMStudio.deck.slides[0].els.length}));
  await ta.focus(); await setCaret(3,2); await p.keyboard.press('Tab'); await sleep(200); const k1=await val();                 /* "Executar" → nível 1 */
  await p.keyboard.press('Tab'); await sleep(200); const k2=await val();                                                        /* → nível 2 */
  await p.keyboard.press('Tab'); await sleep(200); const k3=await val();                                                        /* fica no 2 */
  await p.keyboard.press('Shift+Tab'); await sleep(200); const k4=await val();                                                  /* → 1 */
  await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.type('Novo'); await sleep(200); const k5=await val(); /* Enter mantém o recuo */
  await p.evaluate(()=>{ const t=document.querySelector('#props textarea[data-codec=outline]'); t.setSelectionRange(0, t.value.indexOf('Executar')); }); await p.keyboard.press('Tab'); await sleep(200); const k6=await val(); /* bloco de 3 linhas */
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab'); await sleep(200); const k7=await val();
  await p.keyboard.press('Delete'); await sleep(200); const k8=await val();
  check('S06-09: no painel de texto, Tab recua a linha do cursor (até o nível 2) e Shift+Tab volta, Enter mantém o recuo da linha, Tab/Shift+Tab agem no bloco de linhas selecionado (o modelo acompanha e nunca pula nível: “Planejar” recuado continua 0 e “Metas” fica em 1); o foco fica no campo e Delete apaga texto, não o elemento', k1.v.split('\n')[3]==='  Executar'&&k1.items[3]==='1:Executar'&&k1.sel===4+ (k1.v.indexOf('Executar')-2)&&k2.v.split('\n')[3]==='    Executar'&&k2.items[3]==='2:Executar'&&k3.v===k2.v&&k4.v.split('\n')[3]==='  Executar'&&k5.v.split('\n')[4]==='  Novo'&&k5.items[4]==='1:Novo'&&k6.v.split('\n').slice(0,3).join('|')==='  Planejar|    Metas|    Orçamento'&&k6.items[0]==='0:Planejar'&&k6.items[1]==='1:Metas'&&k7.v.split('\n').slice(0,3).join('|')==='Planejar|Metas|Orçamento'&&k7.active==='TEXTAREA'&&k8.n===1&&k8.active==='TEXTAREA'&&k8.v.length<k7.v.length, {k1:[k1.v,k1.sel],k2:k2.v,k4:k4.v,k5:k5.v,k6:k6.v,k7:[k7.v,k7.active],k8:[k8.n,k8.active]});
  /* commit no change (blur), desfazer devolve o texto anterior */
  const txtNow=(await val()).v; await p.click('#cv', {position:{x:30,y:30}}); await sleep(300);
  const cm=await p.evaluate(()=>({sel:AMStudio.selected?AMStudio.selected().length:-1, undo:!document.getElementById('bUndo').disabled}));
  await p.evaluate(()=>AMStudio.select(AMStudio.deck.slides[0].els[0].id)); await sleep(200); await p.click('#bUndo'); await sleep(300);
  const un2=await p.evaluate(()=>({items:AMStudio.deck.slides[0].els[0].data.items.map(o=>o.lv+':'+o.t).join('|'), ta:document.querySelector('#props textarea[data-codec=outline]').value}));
  check('S06-10: sair do campo grava um passo de desfazer com todo o texto editado; Ctrl+Z devolve os itens anteriores e o painel de texto acompanha', cm.undo&&un2.items!==txtNow&&un2.ta===AMRT_TEXT(un2.items)&&un2.items.indexOf('Novo')<0, {cm,un2,txtNow});
  function AMRT_TEXT(s){ return s.split('|').map(x=>{ const m=/^(\d):(.*)$/.exec(x); return new Array(+m[1]+1).join('  ')+m[2]; }).join('\n'); }

  /* ---------- 4. edição no slide (duplo clique), limites, dados hostis ---------- */
  await fresh(p); await p.evaluate(()=>AMStudio.smart.insert('blocks')); await sleep(300);
  const sp=await p.$('#wrap .am-stage [data-e="items.2.t"]'); const sb=await sp.boundingBox();
  await p.mouse.dblclick(sb.x+sb.width/2, sb.y+sb.height/2); await sleep(250);
  const ce=await p.evaluate(()=>{ const a=document.activeElement; return {edit:!!(a&&a.dataset&&a.dataset.e==='items.2.t'&&a.isContentEditable)}; });
  await p.keyboard.press('Control+A'); await p.keyboard.type('Projeto'); await p.keyboard.press('Enter'); await sleep(300);
  const ip=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els[0], st=document.querySelector('#wrap .am-stage'); return {t2:e.data.items[2].t, n:e.data.items.length, shown:st.querySelector('[data-e="items.2.t"]').textContent, ta:document.querySelector('#props textarea[data-codec=outline]').value.split('\n')[2], editing:!!document.querySelector('#wrap .am-el.editing')}; });
  check('S06-11: duplo clique num texto do diagrama (aqui um tópico de nível 1) edita no lugar (contenteditable); Enter conclui, grava no item certo (items.2.t), redesenha e atualiza o painel de texto com o recuo', ce.edit&&ip.t2==='Projeto'&&ip.n===7&&ip.shown==='Projeto'&&ip.ta==='  Projeto'&&!ip.editing, {ce,ip});
  const lim=await p.evaluate((DEMO)=>{ const out={}, st=()=>document.querySelector('#wrap .am-stage'), e=AMStudio.deck.slides[0].els[0];
    const set=(layout,items)=>{ e.data.layout=layout; e.data.items=AMRT.smartParse(items); AMStudio.renderAll(); };
    set('process', new Array(11).join('Etapa\n')); out.process=st().querySelectorAll('.sa-box').length+'/'+st().querySelectorAll('.sa-hd').length;
    set('matrix', 'A\nB\nC\nD\nE\nF'); out.matrix=st().querySelectorAll('.sa-q').length;
    set('venn', DEMO.venn); out.venn=st().querySelectorAll('.sa-vc').length+'/'+st().querySelectorAll('.sa-vm').length+'/'+(st().querySelector('.sa-vm b')||{}).textContent;
    set('cycle', new Array(13).join('Passo\n')); out.cycle=st().querySelectorAll('.sa-pill').length+'/'+st().querySelectorAll('.sa-hd').length;
    set('org', 'A\n'+new Array(30).join('  B\n')); out.org=st().querySelectorAll('.sa-org').length;
    set('target', 'A\nB\nC\nD\nE\nF\nG'); out.target=st().querySelectorAll('.sa-tc').length;
    set('hub', 'Centro\n  R1\n  R2\n  R3'); out.hubKids=st().querySelectorAll('.sa-spk').length+'/'+st().querySelectorAll('.sa-hubc').length;
    set('funnel', ''); out.empty=!!st().querySelector('.sa-empty')&&getComputedStyle(st().querySelector('.sa-empty')).display!=='none'&&st().querySelectorAll('.sa-n').length===0;
    e.data.items=[{t:'<img src=x>&amp;',lv:'9'},null,5,{t:'ok',lv:-3}]; e.data.layout='stepup'; AMStudio.renderAll();
    out.hostile={img:!!st().querySelector('.fxsa img'), txt:st().querySelector('.sa-step b').textContent, n:st().querySelectorAll('.sa-step').length, lv:[...st().querySelectorAll('.sa-step')].map(x=>x.style.getPropertyValue('--lv'))};
    e.data.layout='process'; e.data.items=AMRT.smartParse(DEMO.chevron); AMStudio.renderAll(); return out; }, DEMO);
  check('S06-12: limites por layout (processo 8 caixas/7 setas, matriz 4, Venn 3 círculos + interseção “=”, ciclo 10 pílulas e 10 setas, hierarquia 20 caixas, alvo 6 anéis, hub com os filhos como raios), sem itens só o lembrete do editor; dados hostis: HTML vira texto, nulos e números caem, nível com clamp', lim.process==='8/7'&&lim.matrix===4&&lim.venn==='3/1/Inovação'&&lim.cycle==='10/10'&&lim.org===20&&lim.target===6&&lim.hubKids==='3/1'&&lim.empty===true&&!lim.hostile.img&&lim.hostile.txt==='<img src=x>&amp;'&&lim.hostile.n===3&&JSON.stringify(lim.hostile.lv)==='["0","0","0"]', lim);

  /* ---------- 5. todos os layouts, branco e navy (painel), tamanho padrão e 50 %: nada corta, nada sai, paleta A&M ---------- */
  const fit=await p.evaluate(async (DEMO)=>{ const out=[], bad=[]; const PAL=['#002A46','#4A6FA5','#A3B8D6','#F78C16','#C9D6E8','#13406A','#43698F','#7EA1C3','#DCE5F0','#EEF2F7','#E3EAF2','#FFFFFF','#FFF','NONE','TRANSPARENT','CURRENTCOLOR'];
    const hex=c=>{ const m=/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c); if(!m) return c.toUpperCase(); if(m[4]==='0') return 'NONE'; return '#'+[m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('').toUpperCase(); };
    for(const k of Object.keys(DEMO)) for(const dark of [false,true]) for(const sc of [1,.5]){
      const F=AMRT.FX.smart, w=F.w*sc, h=F.h*sc, data={layout:k, items:AMRT.smartParse(DEMO[k]==null?F.data.items:DEMO[k])}; if(dark) data.panel='white';
      window.__lab({bg:dark?'#002A46':'#fff', els:[{id:'sa',type:'fx',kind:'smart',variant:'one',x:(1280-w)/2,y:(720-h)/2,w,h,data,anim:{in:'none'}}]}, false);
      await new Promise(r=>setTimeout(r,30));
      const st=document.querySelector('#s6lab .am-stage'), nodes=st.querySelectorAll('.sa-n').length;
      st.querySelectorAll('.sa-n,.sa-sub,.sa-bt').forEach(x=>{ const cs=getComputedStyle(x); [cs.backgroundColor, cs.color].forEach(c=>{ const hx=hex(c); if(PAL.indexOf(hx)<0) bad.push(k+':'+hx); }); });
      st.querySelectorAll('svg [fill],svg [stroke]').forEach(x=>{ ['fill','stroke'].forEach(a=>{ const v=x.getAttribute(a); if(v&&PAL.indexOf(v.toUpperCase())<0) bad.push(k+':'+a+':'+v); }); });
      st.querySelectorAll('.sa-ln,.sa-hd').forEach(x=>{ const cs=getComputedStyle(x); [cs.stroke,cs.fill].forEach(c=>{ const hx=hex(c); if(PAL.indexOf(hx)<0) bad.push(k+':ln:'+hx); }); });
      out.push({k,dark,sc,nodes}); }
    return {out, bad}; }, DEMO);
  const fitIssues=[];
  for(const c of fit.out){ await p.evaluate(async ([k,dark,sc,DEMO])=>{ const F=AMRT.FX.smart, w=F.w*sc, h=F.h*sc, data={layout:k, items:AMRT.smartParse(DEMO[k]==null?F.data.items:DEMO[k])}; if(dark) data.panel='white'; window.__lab({bg:dark?'#002A46':'#fff', els:[{id:'sa',type:'fx',kind:'smart',variant:'one',x:(1280-w)/2,y:(720-h)/2,w,h,data,anim:{in:'none'}}]}, false); },[c.k,c.dark,c.sc,DEMO]); await sleep(60);
    const iss=await stageCheck(p,'#s6lab .am-stage'); if(iss.length) fitIssues.push(c.k+(c.dark?' navy':'')+' '+(c.sc*100)+'%: '+iss.join('; '));
    if(c.sc===1&&!c.dark) await p.screenshot({path:SH('10-layout-'+c.k)}); if(c.sc===1&&c.dark&&c.k==='hub') await p.screenshot({path:SH('11-layout-hub-navy')}); }
  await p.evaluate(()=>window.__labOff());
  check('S06-13: os 14 layouts no tamanho padrão e a 50 %, em slide branco e em navy com painel: nenhum texto cortado, nada fora da caixa nem do slide, todos com nós; cores só da paleta A&M (navy, aços, gelos, laranja, branco), nunca vermelho', fitIssues.length===0&&fit.bad.length===0&&fit.out.length===56&&fit.out.every(o=>o.nodes>=2), {fitIssues,bad:fit.bad.slice(0,20)});

  /* ---------- 6. efeitos: um por um (conectores se desenham), por nível, tudo junto, foco percorrendo ---------- */
  const fxs=await p.evaluate(async (DEMO)=>{ const out={}; const F=AMRT.FX.smart;
    const run=async (variant,layout,wait)=>{ window.__lab({bg:'#fff',els:[{id:'sa',type:'fx',kind:'smart',variant,x:140,y:150,w:1000,h:420,data:{layout, items:AMRT.smartParse(DEMO[layout]||F.data.items)},anim:{in:'none'}}]}, true); await new Promise(r=>setTimeout(r,wait)); return document.querySelector('#s6lab .am-stage'); };
    let st=await run('one','process',60); const n=st.querySelectorAll('.sa-n'); out.one={anim:getComputedStyle(n[0]).animationName, d0:getComputedStyle(n[0]).animationDelay, d3:getComputedStyle(n[3]).animationDelay, ln:getComputedStyle(st.querySelector('.sa-ln')).animationName, dash:getComputedStyle(st.querySelector('.sa-ln')).strokeDasharray};
    st=await run('level','process',60); const L=st.querySelectorAll('.sa-n'); out.level={d0:getComputedStyle(L[0]).animationDelay, li:getComputedStyle(st.querySelector('.sa-n li')).animationDelay};
    st=await run('all','cycle',60); out.all=getComputedStyle(st.querySelector('.fxsa')).animationName;
    st=await run('focus','blocks',2400); out.focus={cycle:st.querySelector('.fxsa').dataset.cycle, active:st.querySelector('.fxsa').classList.contains('cy-active'), on:st.querySelectorAll('.cy-on').length, dim:+getComputedStyle(st.querySelector('[data-g]:not(.cy-on)')).opacity};
    window.__labOff(); return out; }, DEMO);
  check('S06-14: “Um por um” sobe os nós em escada (180 ms) e desenha os conectores (amDraw, dasharray 1); “Por nível” segura os tópicos (900 ms); “Tudo junto” dá zoom no diagrama inteiro; “Foco percorrendo” cicla os grupos na apresentação (cy-active, um grupo aceso, os outros esmaecidos)', fxs.one.anim==='amRise'&&fxs.one.d0==='0s'&&/0\.54s/.test(fxs.one.d3)&&fxs.one.ln==='amDraw'&&/^1(px)?$/.test(fxs.one.dash)&&fxs.level.d0==='0s'&&fxs.level.li==='0.9s'&&fxs.all==='amZoom'&&fxs.focus.cycle==='g'&&fxs.focus.active&&fxs.focus.on>=1&&fxs.focus.dim<.5, fxs);

  /* ---------- 7. slide navy (painel branco), arrastar do seletor, vitrine, apresentação e ampliar ---------- */
  await fresh(p); await p.evaluate(()=>{ AMStudio.addSlide('blank-dark'); AMStudio.smart.insert('hub'); }); await sleep(400);
  const dk=await p.evaluate(()=>{ const e=AMStudio.deck.slides[1].els[0], st=document.querySelector('#wrap .am-stage'); return {panel:e.data.panel, pin:!!st.querySelector('.fx-panel .fx-pin .fxsa'), hub:st.querySelectorAll('.sa-spk').length}; });
  const dkIss=await stageCheck(p,'#wrap .am-stage'); await sleep(2600); await p.screenshot({path:SH('05-navy-hub')});
  const drop=await p.evaluate(()=>{ const w=document.getElementById('wrap'), r=w.getBoundingClientRect(), n0=AMStudio.deck.slides[1].els.length; ['amfx:smart::target','amfx:smart::nao-existe'].forEach(t=>{ const dt=new DataTransfer(); dt.setData('text/plain',t); w.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+r.width*.5,clientY:r.top+r.height*.5})); }); const e=AMStudio.deck.slides[1].els; return {n0, n:e.length, layouts:e.slice(1).map(x=>x.data.layout), first:e[1]&&e[1].data.items[0].t}; });
  const pay=await p.evaluate(()=>{ AMStudio.closeMenus(); AMStudio.smart.open(); const b=document.querySelector('#mSmart [data-smart=venn]'), dt=new DataTransfer(); b.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt})); AMStudio.closeMenus(); return dt.getData('text/plain'); });
  check('S06-15: em slide navy o SmartArt entra no painel branco (sem perder nada); arrastar do seletor leva o layout (“amfx:smart::venn”); soltar “amfx:smart::target” insere o alvo com os itens de exemplo do alvo e um layout inexistente cai no padrão', dk.panel==='white'&&dk.pin&&dk.hub===6&&dkIss.length===0&&drop.n===drop.n0+2&&JSON.stringify(drop.layouts)==='["target","process"]'&&drop.first==='Núcleo: propósito'&&pay==='amfx:smart::venn', {dk,dkIss,drop,pay});
  const gal=await p.evaluate(()=>{ const it=AMStudio.gallery.items().filter(i=>/^model:smart:/.test(i.id)); return {ids:it.map(i=>i.id), cat:it.every(i=>i.cat==='SmartArt')}; });
  check('S06-16: a vitrine de efeitos lista os 4 efeitos do SmartArt (Modelos animados, categoria SmartArt)', JSON.stringify(gal.ids)==='["model:smart:one","model:smart:level","model:smart:all","model:smart:focus"]'&&gal.cat, gal);
  await p.evaluate(()=>AMStudio.goSlide(1)); await sleep(200);
  await p.keyboard.press('F5'); await sleep(900); await p.keyboard.press('ArrowRight'); await sleep(2500);
  const pres=await p.evaluate(()=>{ const on=document.querySelector('#presenter .amp-slide.on'); return {open:document.getElementById('presenter').classList.contains('open'), pos:document.querySelector('#presenter .amp-pos').textContent.trim(), sa:on.querySelectorAll('.fxsa').length, nodes:on.querySelectorAll('.sa-n').length, visible:[...on.querySelectorAll('.sa-n')].every(x=>+getComputedStyle(x).opacity>.95), zoomables:AMRT.zoomables(AMStudio.deck.slides[1]).length}; });
  await p.screenshot({path:SH('06-apresentacao-navy')});
  await p.keyboard.press('z'); await sleep(500);
  const zm=await p.evaluate(()=>{ const z=document.querySelector('#presenter .amp-zm'); return {open:!!z, sa:z?z.querySelectorAll('.fxsa').length:0, foot:z?z.textContent:''}; });
  await p.keyboard.press('Escape'); await sleep(300); await p.keyboard.press('Escape'); await sleep(400);
  check('S06-17: na apresentação (F5 → slide 2) os três SmartArts entram inteiros, são ampliáveis (⤢ / Z abre o ampliado com o diagrama re-renderizado, rodapé com o nome do modelo); Esc fecha o ampliado e depois sai da apresentação', pres.open&&/^02/.test(pres.pos)&&pres.sa===3&&pres.nodes>=15&&pres.visible&&pres.zoomables===3&&zm.open&&zm.sa===1&&/SmartArt/.test(zm.foot)&&await p.evaluate(()=>!document.getElementById('presenter').classList.contains('open')), {pres,zm});

  /* ---------- 8. saneamento ao abrir (safeEl + norm), export autônomo e reabertura ---------- */
  const d0=await p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  d0.slides[0].els.push({id:'sOld',type:'fx',kind:'smart',x:100,y:100,w:900,h:380,variant:'focus',data:{layout:'evil<script>',items:'Um\n  Dois\nTrês',panel:'white'}}, {id:'sBad',type:'fx',kind:'smart',x:100,y:100,w:900,h:380,variant:'nope',data:{layout:'venn',items:[{t:'A',lv:0},{t:'B',lv:0},{t:'= AB',lv:0}]}}, {id:'sNo',type:'fx',kind:'smart',x:100,y:100,w:900,h:380,data:'texto'});
  await p.evaluate(d=>AMStudio.loadDeck(d,null,true,true), d0); await sleep(300);
  const ld=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els, f=id=>e.filter(x=>x.id===id)[0]; return {old:{layout:f('sOld').data.layout, items:f('sOld').data.items, variant:f('sOld').variant}, bad:{layout:f('sBad').data.layout, variant:f('sBad').variant, items:f('sBad').data.items}, no:{layout:f('sNo').data.layout, n:f('sNo').data.items.length}}; });
  check('S06-18: ao abrir, safeEl + norm saneiam o SmartArt: layout desconhecido vira “process”, itens em texto (formato antigo) viram [{t, lv}], efeito inválido cai, data inválido volta ao padrão (8 itens)', ld.old.layout==='process'&&JSON.stringify(ld.old.items)==='[{"t":"Um","lv":0},{"t":"Dois","lv":1},{"t":"Três","lv":0}]'&&ld.old.variant==='focus'&&ld.bad.layout==='venn'&&ld.bad.variant==null&&ld.bad.items.length===3&&ld.no.layout==='process'&&ld.no.n===8, ld);
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(TMP,'saved-s06.html'); fs.writeFileSync(f,html);
  const dj=deckJSON(html); const q=await page(ctx,'file://'+f,'exp',1200);
  const ex=await q.evaluate(()=>{ const sl=document.querySelectorAll('.amp .amp-slide'); return {slides:sl.length, rt:typeof AMRT!=='undefined'&&!!AMRT.FX.smart&&!!AMRT.SMART_LAYOUTS, ed:typeof AMStudio==='undefined'&&typeof AMCover==='undefined', sa:sl[0].querySelectorAll('.fxsa').length, nodes:sl[0].querySelectorAll('.sa-n').length, css:!![...document.styleSheets].some(s=>{ try{ return [...s.cssRules].some(r=>/\.fxsa/.test(r.selectorText||'')); }catch(e){ return false; } }), empty:!!sl[0].querySelector('.sa-empty')&&getComputedStyle(sl[0].querySelector('.sa-empty')||document.body).display}; });
  await q.keyboard.press('ArrowRight'); await sleep(2500); await q.screenshot({path:SH('07-exportado')});
  const ex2=await q.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent.trim(), sa:document.querySelector('.amp-slide.on').querySelectorAll('.fxsa').length}));
  check('S06-19: o arquivo exportado é autônomo (runtime + rt-40-smartart, sem editor/capa), guarda o deck em #am-deck-data com os itens [{t, lv}], renderiza os SmartArts no player (CSS incluído) e navega', ex.slides===2&&ex.rt&&ex.ed&&ex.sa===3&&ex.nodes>=8&&ex.css&&dj&&dj.slides[0].els.filter(e=>e.kind==='smart').length===3&&dj.slides[0].els.filter(e=>e.kind==='smart').every(e=>Array.isArray(e.data.items))&&/^02/.test(ex2.pos)&&ex2.sa===3, {ex,ex2});
  check('S06-20: export sem onerror/onmouseover/onclick (CR-04) e sem “</script” fora das tags', !/onerror|onmouseover|onclick/i.test(html)&&(html.match(/<\/script/g)||[]).length===(html.match(/<script[\s>]/g)||[]).length, {s:(html.match(/<script[\s>]/g)||[]).length,e:(html.match(/<\/script/g)||[]).length});
  await q.close();
  const r=await page(ctx, FILE+'?nocover', 'reopen');
  await r.evaluate(h=>AMStudio.openFile(new File([h],'saved-s06.html',{type:'text/html'})), html); await sleep(1200);
  const ro=await r.evaluate(()=>{ const e=AMStudio.deck.slides[0].els.filter(x=>x.kind==='smart'); return {n:e.length, layouts:e.map(x=>x.data.layout), items:e.map(x=>x.data.items.length), v:e.map(x=>x.variant||'-'), st:document.querySelectorAll('#wrap .am-stage .fxsa').length}; });
  check('S06-21: reabrir o arquivo exportado no editor devolve os 3 SmartArts com layout, itens e efeito (sem efeito gravado = padrão)', ro.n===3&&JSON.stringify(ro.layouts)==='["process","venn","process"]'&&JSON.stringify(ro.items)==='[3,3,8]'&&JSON.stringify(ro.v)==='["focus","-","-"]'&&ro.st===3, ro);
  await r.close();

  /* ---------- 8b. correções do QA S6 (rodada 1): clamp do alvo e de toda caixa, prefixo “=” do Venn, nome por elemento, duplo clique na linha inteira, saneamento ---------- */
  /* S06-23: os 12 layouts em caixas quadradas, estreitas e achatadas (pelo painel Largura/Altura, como no QA): nada fora da caixa, nenhum estilo negativo/NaN; html() puro no piso 40×40, com NaN e negativo */
  const SZ=[[420,420],[380,420],[300,300],[1000,140],[200,500]]; const narrow={};
  for(const Lk of LAYOUTS){ for(const [w,h] of SZ){ await fresh(p);
      const id=await p.evaluate(([Lk,w,h])=>{ const S=AMStudio; const e=S.insertFx('smart',null,null,null,{layout:Lk,items:AMRT.smartSample(Lk)}); e.w=w; e.h=h; e.x=Math.round((1280-w)/2); e.y=Math.round((720-h)/2); e.anim={in:'none'}; S.renderAll(); S.commit(); S.select(e.id); return e.id; },[Lk,w,h]);
      await p.fill('#props [data-p="w"]',String(w)); await p.fill('#props [data-p="h"]',String(h)); await p.click('#props .ph h2'); await sleep(200);
      const r1=await p.evaluate(id=>{ const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]'), bad=[]; n.querySelectorAll('[style]').forEach(x=>{ const s=x.getAttribute('style').replace(/--i:[^;]*|--lv:[^;]*/g,''); if(/NaN|Infinity|undefined|:\s*-/.test(s)) bad.push(x.className+' '+s.slice(0,80)); }); n.querySelectorAll('svg *').forEach(x=>['d','cx','cy','r'].forEach(a=>{ const v=x.getAttribute(a); if(v&&/NaN|Infinity/.test(v)) bad.push(a+'='+v.slice(0,40)); })); const rr=n.getBoundingClientRect(); return {bad, geo:[Math.round(rr.width),Math.round(rr.height)], nodes:n.querySelectorAll('.sa-n').length}; },id);
      const iss=(await stageCheck(p,'#wrap .am-stage')).filter(i=>/fora/.test(i));
      if(iss.length||r1.bad.length||r1.nodes<2) narrow[Lk+' '+w+'x'+h]={iss,bad:r1.bad.slice(0,2),nodes:r1.nodes,geo:r1.geo};
      if(Lk==='target'&&w===420) await p.screenshot({path:SH('12-alvo-420x420')}); } }
  const floor=await p.evaluate((LAYOUTS)=>{ const bad=[]; LAYOUTS.forEach(k=>[[40,40],[NaN,NaN],[-5,0],[2000,100],[100,2000]].forEach(([w,h])=>{ const s=AMRT.FX.smart.html({layout:k,items:AMRT.smartSample(k)},w,h,{}).replace(/--i:[^;"]*|--lv:[^;"]*/g,''); if(/NaN|Infinity|undefined/.test(s)||/style="[^"]*:\s*-/.test(s)) bad.push(k+' '+w+'x'+h); })); const t=AMRT.FX.smart.html({layout:'target',items:AMRT.smartSample('target')},420,420,{}); return {bad, t420:(t.match(/width:-[\d.]+%/)||[])[0]||null, lab:(t.match(/sa-side[^>]*left:([\d.]+)%/)||[])[1]}; },LAYOUTS);
  check('S06-23: os 12 layouts em 420×420, 380×420, 300×300, 1000×140 e 200×500 (via painel): conteúdo dentro da caixa, nós desenhados e nenhum estilo negativo/NaN; html() puro (40×40, NaN, negativo, 2000×100, 100×2000) nunca escreve NaN nem valor negativo; no alvo 420×420 os rótulos começam dentro da caixa (≈ 55 %), não em 110 %', !Object.keys(narrow).length&&!floor.bad.length&&floor.t420===null&&+floor.lab>40&&+floor.lab<60, {narrow,floor});
  /* S06-24: Venn: editar em linha a interseção mantém o “=” (data-ep) e a pílula; digitar já com “=” não duplica; o painel de texto acompanha */
  await fresh(p); await p.evaluate(()=>AMStudio.smart.insert('venn')); await sleep(2600);
  const vmEl=await p.$('#wrap .am-stage .sa-vm [data-e]'); const vmb=await vmEl.boundingBox(); await p.mouse.dblclick(vmb.x+vmb.width/2,vmb.y+vmb.height/2); await sleep(250);
  const vEd=await p.evaluate(()=>{ const a=document.activeElement; return {ce:!!(a&&a.isContentEditable), path:a&&a.dataset.e, ep:a&&a.dataset.ep, txt:a&&a.textContent}; });
  await p.keyboard.press('Control+A'); await p.keyboard.type('Sweet spot'); await p.keyboard.press('Enter'); await sleep(350);
  const v1=await p.evaluate(()=>({t3:AMStudio.deck.slides[0].els[0].data.items[3].t, vm:(document.querySelector('#wrap .am-stage .sa-vm b')||{}).textContent, ta:document.querySelector('#props textarea[data-codec=outline]').value.split('\n')[3], circles:document.querySelectorAll('#wrap .am-stage .sa-vc').length, labels:[...document.querySelectorAll('#wrap .am-stage .sa-vl')].map(n=>n.textContent).join('|')}));
  const vmEl2=await p.$('#wrap .am-stage .sa-vm [data-e]'); const vmb2=await vmEl2.boundingBox(); await p.mouse.dblclick(vmb2.x+vmb2.width/2,vmb2.y+vmb2.height/2); await sleep(250);
  await p.keyboard.press('Control+A'); await p.keyboard.type('=Foco'); await p.keyboard.press('Enter'); await sleep(350);
  const v2=await p.evaluate(()=>({t3:AMStudio.deck.slides[0].els[0].data.items[3].t, vm:(document.querySelector('#wrap .am-stage .sa-vm b')||{}).textContent}));
  await p.screenshot({path:SH('13-venn-intersecao-editada')});
  check('S06-24: duplo clique na pílula da interseção do Venn edita só “Inovação” (data-ep “= ”); Enter grava “= Sweet spot” em items[3], a pílula continua no diagrama com os 3 círculos e o painel de texto mostra “= Sweet spot”; digitar “=Foco” não duplica o marcador', vEd.ce&&vEd.path==='items.3.t'&&vEd.ep==='= '&&vEd.txt==='Inovação'&&v1.t3==='= Sweet spot'&&v1.vm==='Sweet spot'&&v1.ta==='= Sweet spot'&&v1.circles===3&&v1.labels==='Desejável|Viável|Factível'&&v2.t3==='=Foco'&&v2.vm==='Foco', {vEd,v1,v2});
  /* S06-25: nome por elemento: FX.smart.label via AMRT.fxLabel; cabeçalho do painel e rodapé do “Ampliar” (editor e arquivo exportado) dizem o mesmo; os demais modelos continuam com o nome */
  await fresh(p); await p.evaluate(()=>AMStudio.insertFx('smart')); await sleep(300);
  const lb=await p.evaluate(()=>({fx:AMRT.fxLabel({type:'fx',kind:'smart',data:{layout:'funnel'}}), def:AMRT.fxLabel({type:'fx',kind:'smart',data:{}}), swot:AMRT.fxLabel({type:'fx',kind:'swot',data:{}})===AMRT.FX.swot.name, none:AMRT.fxLabel({type:'fx',kind:'nope'}), head:document.querySelector('#props .ph h2').firstChild.textContent}));
  await p.keyboard.press('F5'); await sleep(900); await p.keyboard.press('z'); await sleep(500);
  const zf=await p.evaluate(()=>(document.querySelector('#presenter .amp-zm .e')||{}).textContent);
  await p.keyboard.press('Escape'); await sleep(300); await p.keyboard.press('Escape'); await sleep(400);
  const html2=await p.evaluate(()=>AMStudio.exportHTML()); const f2=path.join(TMP,'saved-s06-label.html'); fs.writeFileSync(f2,html2);
  const q2=await page(ctx,'file://'+f2,'exp2',1200); await q2.keyboard.press('z'); await sleep(500);
  const zf2=await q2.evaluate(()=>({open:!!document.querySelector('.amp-zm.on'), foot:(document.querySelector('.amp-zm .e')||{}).textContent, ed:typeof AMStudio==='undefined'})); await q2.screenshot({path:SH('14-exportado-ampliar-rodape')}); await q2.close();
  check('S06-25: AMRT.fxLabel devolve “SmartArt · Funil” pelo layout (padrão “SmartArt · Processo”), o nome do modelo para os demais e “Elemento” para um kind desconhecido; cabeçalho do painel, rodapé do “Ampliar” no editor e no arquivo exportado (autônomo) mostram “SmartArt · Processo”', lb.fx==='SmartArt · Funil'&&lb.def==='SmartArt · Processo'&&lb.swot&&lb.none==='Elemento'&&lb.head==='SmartArt · Processo'&&zf==='SmartArt · Processo'&&zf2.open&&zf2.foot==='SmartArt · Processo'&&zf2.ed, {lb,zf,zf2});
  /* S06-26: duplo clique no espaço vazio à direita da 1ª linha de um tópico quebrado edita em linha; no marcador (fora do span) o painel de texto recebe o foco sem selecionar tudo */
  await fresh(p); await p.evaluate(()=>AMStudio.insertFx('smart')); await sleep(2600);
  const li1=await p.$('#wrap .am-stage .sa-n li'); const lbb=await li1.boundingBox();
  const wrapped=await p.evaluate(()=>{ const s=document.querySelector('#wrap .am-stage .sa-n li [data-e]'), r=document.createRange(); r.selectNodeContents(s); return {lines:r.getClientRects().length, block:getComputedStyle(s).display, title:getComputedStyle(document.querySelector('#wrap .am-stage .sa-n b [data-e]')).display}; });
  const hit=await p.evaluate(([x,y])=>{ const n=document.elementFromPoint(x,y); return n.tagName+(n.dataset.e?':'+n.dataset.e:''); },[lbb.x+lbb.width-5,lbb.y+6]);
  await p.mouse.dblclick(lbb.x+lbb.width-5,lbb.y+6); await sleep(300);
  const e1=await p.evaluate(()=>{ const a=document.activeElement; return {ce:!!(a&&a.isContentEditable), path:a&&a.dataset.e}; });
  await p.keyboard.press('Enter'); await sleep(300);
  await p.mouse.dblclick(lbb.x-9,lbb.y+6); await sleep(300); /* no marcador laranja: fora do span → painel de texto */
  const e2=await p.evaluate(()=>{ const a=document.activeElement; return {tag:a.tagName, codec:a.dataset&&a.dataset.codec, collapsed:a.selectionStart===a.selectionEnd, items:AMStudio.deck.slides[0].els[0].data.items.length}; });
  check('S06-26: o tópico “Entrevistas e dados” quebra em 2 linhas e o span editável é um bloco (título também): duplo clique no espaço vazio da 1ª linha cai no span e edita em linha (items.1.t); duplo clique no marcador leva o foco ao painel de texto com o cursor recolhido (nada selecionado, os 8 itens intactos)', wrapped.lines>=2&&wrapped.block==='block'&&wrapped.title==='block'&&/^SPAN:items\.1\.t$/.test(hit)&&e1.ce&&e1.path==='items.1.t'&&e2.tag==='TEXTAREA'&&e2.codec==='outline'&&e2.collapsed&&e2.items===8, {wrapped,hit,e1,e2});
  /* S06-27: saneamento: texto que é objeto/array/booleano some (nunca “[object Object]”), número vira texto */
  const san=await p.evaluate(()=>{ const P=AMRT.smartParse; return {obj:P([{t:{a:1},lv:0},{t:['x'],lv:0},{t:'ok',lv:1},{t:7,lv:0},{t:true,lv:0},[]]).map(o=>o.lv+':'+o.t), norm:AMRT.FX.smart.norm({layout:'cycle',items:[{t:{a:1}},{t:'A'}]}).items.map(o=>o.t).join('|')}; });
  check('S06-27: smartParse/norm descartam itens cujo texto é objeto, array ou booleano (nunca “[object Object]”), mantêm números como texto e o nível do primeiro item restante volta a 0', JSON.stringify(san.obj)==='["0:ok","0:7"]'&&san.norm==='A', san);

  /* ---------- 9. barra de ferramentas continua cabendo (só o title do “Gráficos ▾” mudou) ---------- */
  await p.setViewportSize({width:1280,height:720}); await sleep(300);
  const ov=await p.evaluate(()=>{const t=document.getElementById('top'), rb=document.getElementById('rib'), s=document.getElementById('bSave').getBoundingClientRect(); return {top:t.scrollWidth<=t.clientWidth, rib:rb.scrollWidth<=rb.clientWidth, save:s.right<=innerWidth}; });
  await p.setViewportSize({width:1180,height:720}); await sleep(300);
  const ov2=await p.evaluate(()=>{const rb=document.getElementById('rib'); return rb.scrollWidth<=rb.clientWidth; });
  check('S06-22: barra de ferramentas sem estouro em 1280 e 1180 (SmartArt vive no “Gráficos ▾” e no Inserir, sem botão novo)', ov.top&&ov.rib&&ov.save&&ov2, {ov,ov2});

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
