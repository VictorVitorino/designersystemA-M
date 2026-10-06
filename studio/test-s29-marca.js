/* S29 — Kit de marca (ed-43-brand.js + deck.brand em editor.js): caixa Arquivo › Kit de marca… e botão em Fundo; cores da marca
   (colar códigos, +, trocar, tirar, do logotipo) primeiro nas amostras do painel e em “Mais cores…” (seção “Cores da marca”); fonte do
   kit (Google sob demanda: <link>, PDF embutido, arquivo salvo) nos textos/formas/slides novos e “Aplicar a todos os textos”; cores dos
   componentes (pal) nos componentes novos e “Aplicar a todos”/“Restaurar”; um Ctrl+Z por ação; salvar/reabrir; safeDeck; kits no
   navegador; .json; PowerPoint Editável com o tema da marca; importar .pptx traz o tema como kit.
   Uso: python3 assemble.py && node test-s29-marca.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s29-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s29'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS23=path.join(__dirname,'test-s23-tools.py'), TOOLS24=path.join(__dirname,'test-s24-tools.py');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,900):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
const gfLog=[];
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>{ const u=r.request().url(); gfLog.push(u); let css=fs.readFileSync(path.join(FONTS,'gf.css'),'utf8'); if(/Montserrat/.test(u)&&fs.existsSync(path.join(FONTS,'gf-montserrat.css'))) css=(/family=Inter/.test(u)?css+'\n':'')+fs.readFileSync(path.join(FONTS,'gf-montserrat.css'),'utf8'); return r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:css}); });
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const b64f=f=>fs.readFileSync(f).toString('base64');
async function importApi(p, f, mode){ return p.evaluate(async ([b64,name,mode])=>{ const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const res=await AMImport.pptx(u,{}); return AMImport.finish(res,{name},{mode}); }, [b64f(f),path.basename(f),mode||'replace']); }
async function menuItems(p, m){ await p.click('#mbar button[data-m='+m+']'); await sleep(250); const it=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xmenu .xi'),x=>({t:x.textContent.trim(),dis:x.classList.contains('dis')}))); return it; }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const BR=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.brand.get()||null)));
  const dlgOpen=()=>p.evaluate(()=>!!(window.AMBrand&&AMBrand.isOpen()));
  /* ---------- 1. menu + caixa ---------- */
  const fm=await menuItems(p,'file'); const ft=fm.map(i=>i.t);
  check('S29-01: Arquivo tem um só “Kit de marca…” (habilitado), antes de “Importar…”; invariantes S02 mantidas (Início 1º, um “abrir…”, Minhas obras logo depois de Abrir…)', ft.filter(t=>/^Kit de marca…/.test(t)).length===1 && !fm.find(i=>/^Kit de marca…/.test(i.t)).dis && ft.findIndex(t=>/^Kit de marca…/.test(t))<ft.findIndex(t=>/^Importar/.test(t)) && ft[0]==='Início (capa)' && ft.filter(t=>/abrir…/i.test(t)).length===1 && ft.findIndex(t=>/^Minhas obras…/.test(t))===ft.findIndex(t=>/^Abrir…/.test(t))+1, ft);
  await p.click('.xmenu .xi:has-text("Kit de marca…")'); await sleep(350);
  const d1=await p.evaluate(()=>{ const d=document.getElementById('bkDlg'); const r=d.querySelector('.xp-box').getBoundingClientRect(); return {open:!d.hidden, focus:document.activeElement&&document.activeElement.id, fits:r.bottom<=innerHeight&&r.right<=innerWidth, title:d.querySelector('h3').textContent, brand:AMStudio.brand.get()}; });
  check('S29-02: a caixa “Kit de marca” abre, cabe a 1280×720, foco no nome, sem kit ainda', d1.open && d1.focus==='bkName' && d1.fits && d1.title==='Kit de marca' && d1.brand===null, d1);
  /* ---------- 2. cores: colar códigos, nome, tirar, + (seletor) ---------- */
  await p.fill('#bkPaste', '#1F66A8, f2c94c; rgb(0,42,70) #abc #1F66A8 bobagem'); await p.keyboard.press('Enter'); await sleep(250);
  let br=await BR();
  check('S29-03: colar códigos adiciona as cores reconhecidas (#, sem #, rgb(), #abc), únicas e maiúsculas; a repetida e o texto solto ficam de fora', !!br && JSON.stringify(br.colors)===JSON.stringify(['#1F66A8','#F2C94C','#002A46','#AABBCC']) && await p.$eval('#bkCn',e=>e.textContent)==='(4 de 12)' && await p.$eval('#bkPaste',e=>e.value)==='', br);
  await p.fill('#bkName','Cliente XPTO'); await p.keyboard.press('Tab'); await sleep(200); br=await BR();
  check('S29-04: o nome do kit grava ao sair do campo', br.name==='Cliente XPTO', br);
  await p.hover('#bkSw .bk-c:nth-child(2) .bk-s'); await p.click('#bkSw .bk-c:nth-child(2) .bk-x'); await sleep(250); br=await BR();
  check('S29-05: × tira a cor (a 2ª); as outras ficam na ordem', JSON.stringify(br.colors)===JSON.stringify(['#1F66A8','#002A46','#AABBCC']), br.colors);
  await p.click('#bkSw .bk-add'); await sleep(300);
  const pop=await p.evaluate(()=>{ const c=document.querySelector('.cpop'); if(!c) return null; const r=c.getBoundingClientRect(); const el=document.elementFromPoint(r.left+r.width/2, r.top+Math.min(r.height/2, 60)); return {z:getComputedStyle(c).zIndex, onTop:!!(el&&c.contains(el)), title:c.getAttribute('aria-label')}; });
  check('S29-06: + abre “Mais cores…” por cima da caixa (z-index acima de .xp), com o título “Nova cor da marca”', !!pop && pop.onTop && +pop.z>190 && /Nova cor da marca/.test(pop.title), pop);
  await p.click('.cpop .cp-s[data-c="#1F8048"]'); await sleep(250); br=await BR();
  check('S29-07: a cor escolhida no seletor entra no fim do kit', br.colors.length===4 && br.colors[3]==='#1F8048', br.colors);
  await p.click('#bkSw .bk-c:nth-child(1) .bk-s'); await sleep(250);
  await p.keyboard.press('Escape'); await sleep(200);
  const e1={pop:await p.evaluate(()=>!!document.querySelector('.cpop')), dlg:await dlgOpen()};
  check('S29-08: Esc com o seletor aberto fecha só o seletor; a caixa continua aberta', !e1.pop && e1.dlg, e1);
  /* ---------- 3. fonte do kit ---------- */
  await p.selectOption('#bkFont','Montserrat'); await sleep(300); br=await BR();
  const lk=await p.evaluate(()=>{ const l=document.querySelector('link[data-gf="Montserrat"]'); return l?l.href:null; });
  check('S29-09: fonte do kit = Montserrat (Google): deck.brand.font e <link> da fonte entram sob demanda', br.font==='Montserrat' && !!lk && /family=Montserrat:wght@300;400;500;600;700/.test(lk) && /Montserrat/.test(await p.$eval('#bkFontNote',e=>e.textContent)), {font:br.font,lk});
  const nf=await p.evaluate(()=>{ const A=AMStudio; const snap=JSON.stringify(A.deck); const t=A.brand.kitify(A.mk.text('body')), s=A.brand.kitify(A.mk.shape('rect')), pure=A.mk.text('body').font; A.addSlide('content'); const sl=A.deck.slides[A.cur]; const out={t:t.font, s:s.font, pure, slide:sl.els.filter(e=>e.type==='text').map(e=>e.font), base:Object.keys(sl.base.els).map(k=>sl.base.els[k].font)}; A.loadDeck(JSON.parse(snap),null,true,true); return out; });
  check('S29-10: o que se insere (texto, forma, slide novo — e a base do Redefinir) nasce com a fonte do kit; mk.* continuam puros (modelos e outras obras)', nf.t==='Montserrat' && nf.s==='Montserrat' && nf.pure==='Inter' && nf.slide.length>0 && nf.slide.every(f=>f==='Montserrat') && nf.base.filter(Boolean).every(f=>f==='Montserrat'), nf);
  /* ---------- 4. cores dos componentes (pal) ---------- */
  await p.click('#bkP'); await sleep(250); await p.fill('.cpop .cp-hex','#1F8048'); await p.click('.cpop .cp-ok'); await sleep(250); br=await BR();
  const nfx=await p.evaluate(()=>{ const A=AMStudio; const c=A.insertFx('columns'), i=A.brand.kitify(A.mk.fx('icon')), pure=A.mk.fx('columns'); A.selectMany([]); return {c:c.pal||null, i:i.pal||null, pure:pure.pal||null}; });
  check('S29-11: cor principal #1F8048 gravada no kit; um gráfico inserido nasce com pal; ícones não; mk.fx continua puro', JSON.stringify(br.pal)==='{"p":"#1F8048"}' && JSON.stringify(nfx.c)==='{"p":"#1F8048"}' && nfx.i===null && nfx.pure===null, {pal:br.pal,nfx});
  await p.click('#bkA'); await sleep(250); await p.click('.cpop .cp-s[data-c="#F78C16"]'); await sleep(250); br=await BR();
  check('S29-12: escolher o laranja A&M como destaque = sem troca (a chave não entra)', JSON.stringify(br.pal)==='{"p":"#1F8048"}', br.pal);
  await p.keyboard.press('Escape'); await sleep(250);
  check('S29-13: Esc fecha a caixa; o foco sai dela (menu aberto com o mouse: volta ao corpo, como os menus fazem)', !(await dlgOpen()) && await p.evaluate(()=>!document.activeElement.closest('#bkDlg')));
  /* ---------- 5. painel: amostras com a marca primeiro, botão em Fundo, seção no “Mais cores…” ---------- */
  await p.click('#wrap',{position:{x:5,y:5}}); await p.keyboard.press('Escape'); await sleep(200);
  const sw=await p.evaluate(()=>{ const sec=[].find.call(document.querySelectorAll('#props .sec'),s=>/^Fundo/.test(s.querySelector('h3').textContent)); const bt=[].map.call(sec.querySelectorAll('.sw button:not(.more):not(.none):not(.cust)'),b=>b.title); return {first:bt.slice(0,4), n:bt.length, kit:!!sec.querySelector('[data-act=brandkit]')}; });
  check('S29-14: amostras de Fundo começam pelas 4 cores da marca (“Marca · #…”), depois a paleta A&M sem repetir o navy; botão “Kit de marca…” na seção', sw.first.join('|')==='Marca · #1F66A8|Marca · #002A46|Marca · #AABBCC|Marca · #1F8048' && sw.n===4+12 && sw.kit, sw);
  await p.click('#props [data-act=brandkit]'); await sleep(300);
  check('S29-15: o botão em Fundo abre a caixa', await dlgOpen());
  await p.keyboard.press('Escape'); await sleep(200);
  await p.click('#props .sec:has(h3:text-is("Fundo")) .sw .more'); await sleep(300);
  const ck=await p.evaluate(()=>{ const k=document.querySelector('.cpop .cp-kit'); return k?{t:k.querySelector('h4').textContent, n:k.querySelectorAll('.cp-s').length}:null; });
  check('S29-16: “Mais cores…” do painel mostra a seção “Cores da marca · Cliente XPTO” com as 4 cores antes das cores A&M', !!ck && ck.t==='Cores da marca · Cliente XPTO' && ck.n===4 && await p.evaluate(()=>{ const s=[].map.call(document.querySelectorAll('.cpop .cp-sec h4'),h=>h.textContent); return s[0].indexOf('Cores da marca')===0 && s[1]==='Cores A&M'; }), ck);
  await p.click('.cpop .cp-kit .cp-s[data-c="#1F8048"]'); await sleep(250);
  let d=await D();
  check('S29-17: escolher uma cor da marca no seletor pinta o fundo do slide', d.slides[0].bg==='#1F8048', d.slides[0].bg);
  await p.keyboard.press('Control+z'); await sleep(250); d=await D();
  check('S29-18: um Ctrl+Z devolve o fundo anterior', d.slides[0].bg==='#FFFFFF', d.slides[0].bg);
  /* ---------- 6. aplicar a todos: textos e componentes, um Ctrl+Z cada ---------- */
  await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Kit'; d.brand={name:'Cliente XPTO',colors:['#1F66A8','#1F8048'],pal:{p:'#1F8048'},font:'Montserrat'};
    const s=mk.slide('blank-light'); s.els=[]; const t1=mk.text('title'); t1.font='Roboto'; const t2=mk.text('body'); t2.font='Inter'; t2.html='<span style="font-family:Calibri">Trecho</span> com fonte própria'; const sh=mk.shape('rect'); sh.font='Inter';
    const fx1=mk.fx('headline'); delete fx1.pal; const ch=mk.fx('columns'); delete ch.pal; const ic=mk.fx('icon'); [t1,t2,sh,fx1,ch,ic].forEach((e,i)=>{ e.x=40+i*60; e.y=40+i*40; }); s.els=[t1,t2,sh,fx1,ch,ic];
    const s2=mk.slide('blank-light'); s2.els=[]; const ch2=mk.fx('donut'); delete ch2.pal; s2.els=[ch2]; d.slides=[s,s2]; A.loadDeck(d,null); });
  await sleep(300);
  await p.evaluate(()=>AMBrand.open()); await sleep(300);
  const lab=await p.evaluate(()=>({f:document.getElementById('bkFontAll').textContent, c:document.getElementById('bkPalAll').textContent, fd:document.getElementById('bkFontAll').disabled, cd:document.getElementById('bkPalAll').disabled}));
  check('S29-19: os botões contam o que vão mudar: 4 textos (2 textos + 1 forma + frase de impacto) e 3 componentes (headline, colunas, rosca; ícone não)', lab.f==='Aplicar a todos os textos (4)' && lab.c==='Aplicar a todos os componentes (3)' && !lab.fd && !lab.cd, lab);
  await p.click('#bkFontAll'); await sleep(350); d=await D();
  const af=d.slides[0].els.map(e=>e.type==='fx'?(e.data.font||null):e.font);
  check('S29-20: “Aplicar a todos os textos”: textos e forma viram Montserrat, a fonte do trecho sai do HTML, o headline (campo fonte) também; gráfico e ícone não mudam', af[0]==='Montserrat' && af[1]==='Montserrat' && af[2]==='Montserrat' && af[3]==='Montserrat' && af[4]===null && af[5]===null && !/font-family/.test(d.slides[0].els[1].html) && /Trecho/.test(d.slides[0].els[1].html), {af, html:d.slides[0].els[1].html});
  await p.click('#bkPalAll'); await sleep(350); d=await D();
  const ap=d.slides.map(s=>s.els.map(e=>e.pal?JSON.stringify(e.pal):null));
  check('S29-21: “Aplicar a todos os componentes”: headline, colunas e rosca ganham pal {p}; textos, forma e ícone não', JSON.stringify(ap)===JSON.stringify([[null,null,null,'{"p":"#1F8048"}','{"p":"#1F8048"}',null],['{"p":"#1F8048"}']]), ap);
  await p.keyboard.press('Escape'); await sleep(200); await p.click('#wrap',{position:{x:5,y:5}}); await p.keyboard.press('Escape');
  await p.keyboard.press('Control+z'); await sleep(250); d=await D();
  const u1=d.slides.every(s=>s.els.every(e=>!e.pal)) && d.slides[0].els[0].font==='Montserrat';
  await p.keyboard.press('Control+z'); await sleep(250); d=await D();
  const u2=d.slides[0].els[0].font==='Roboto' && d.slides[0].els[1].font==='Inter' && /font-family:Calibri/.test(d.slides[0].els[1].html) && d.slides[0].els[3].data.font==='Roboto';
  check('S29-22: um Ctrl+Z desfaz “aplicar aos componentes”; outro desfaz “aplicar aos textos” (fontes e trecho de volta)', u1 && u2, {u1,u2});
  await p.keyboard.press('Control+y'); await p.keyboard.press('Control+y'); await sleep(250); d=await D();
  check('S29-23: Ctrl+Y duas vezes refaz as duas aplicações', d.slides[0].els[0].font==='Montserrat' && !!d.slides[1].els[0].pal);
  await p.evaluate(()=>AMBrand.open()); await sleep(250); await p.click('#bkPalNone'); await sleep(300); d=await D();
  check('S29-24: “Restaurar cores A&M em todos” tira o pal de todos os componentes', d.slides.every(s=>s.els.every(e=>!e.pal)) && await p.$eval('#bkPalNone',e=>e.disabled));
  await p.keyboard.press('Escape'); await sleep(200);
  /* ---------- 7. painel do elemento: fonte do kit no seletor; amostras da marca ---------- */
  const fsel=await p.evaluate(()=>{ const A=AMStudio; A.select(A.deck.slides[0].els[0].id); const s=document.querySelector('#props select[data-p="font"]'); const o=[].map.call(s.options,x=>x.textContent); const sw=[].map.call(document.querySelectorAll('#props .sw button:not(.more):not(.none):not(.cust)'),b=>b.title).slice(0,2); return {v:s.value, has:[o.some(t=>t==='Montserrat (Google)'), o.some(t=>t==='Arial (do computador)'), o.some(t=>/kit de marca/.test(t))], n:o.length, sw}; });
  check('S29-25: no painel do texto a fonte Montserrat está selecionada como “(kit de marca)” (no topo, sem repetir na lista Google); a lista traz Google e do computador; amostras começam pela marca', fsel.v==='Montserrat' && !fsel.has[0] && fsel.has[1] && fsel.has[2] && fsel.n===4+12+6 && fsel.sw.join('|')==='Marca · #1F66A8|Marca · #1F8048', fsel);
  /* ---------- 8. salvar/reabrir, arquivo salvo com a fonte, safeDeck ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const lnk=/<link href="(https:\/\/fonts\.googleapis\.com[^"]*)" rel="stylesheet">/.exec(html);
  check('S29-26: o arquivo salvo leva deck.brand e o <link> das fontes inclui Montserrat (além das 4 do Canteiro)', JSON.stringify(dk.brand)===JSON.stringify({name:'Cliente XPTO',colors:['#1F66A8','#1F8048'],pal:{p:'#1F8048'},font:'Montserrat'}) && !!lnk && /family=Montserrat:wght@300;400;500;600;700/.test(lnk[1]) && /family=Inter/.test(lnk[1]) && /family=Roboto\+Condensed/.test(lnk[1]), {brand:dk.brand, lnk:lnk&&lnk[1]});
  const re=await p.evaluate(dk=>{ AMStudio.loadDeck(dk,'re'); return JSON.stringify(AMStudio.brand.get()); }, dk);
  check('S29-27: reabrir mantém o kit', re===JSON.stringify(dk.brand));
  const sf=await p.evaluate(()=>{ const A=AMStudio; const d=A.newDeck(); d.brand={name:' '+'x'.repeat(100), colors:['red','#12345G','#abcdef','#ABCDEF','#000000',5], pal:{p:'#1F8048',a:'nope'}, font:'<script>'}; const o=A.safeDeck(d); const d2=A.newDeck(); d2.brand={colors:[]}; const o2=A.safeDeck(d2); const d3=A.newDeck(); d3.brand={colors:'#111111'.split(',').concat(['#1','#2'].map((x,i)=>'#'+String(i+1).repeat(6)))}; return {b:o.brand, none:o2.brand===undefined, many:A.safeDeck({slides:[A.mk.slide('blank-light')], brand:{colors:Array.from({length:20},(_,i)=>'#'+(100000+i*7919).toString(16).slice(0,6).padEnd(6,'0'))}}).brand.colors.length}; });
  check('S29-28: safeDeck limpa o kit: nome ≤ 60, só #RRGGBB únicos (maiúsculos), pal só com cor válida, fonte inválida sai; kit vazio sai; no máximo 12 cores', sf.b && sf.b.name.length===60 && JSON.stringify(sf.b.colors)==='["#ABCDEF","#000000"]' && JSON.stringify(sf.b.pal)==='{"p":"#1F8048"}' && !('font' in sf.b) && sf.none && sf.many===12, sf);
  /* ---------- 9. kits no navegador, .json ---------- */
  await p.evaluate(()=>{ localStorage.removeItem('amStudio.brandKits'); AMBrand.open(); }); await sleep(250);
  await p.click('#bkSave'); await sleep(250);
  const ks=await p.evaluate(()=>({ls:JSON.parse(localStorage.getItem('amStudio.brandKits')||'[]').map(k=>k.name), sel:document.getElementById('bkKits').value, use:document.getElementById('bkUse').disabled}));
  check('S29-29: “Guardar este kit no navegador” grava em amStudio.brandKits e seleciona o kit na lista', ks.ls.join()==='Cliente XPTO' && ks.sel==='Cliente XPTO' && !ks.use, ks);
  await p.keyboard.press('Escape'); await sleep(150);
  await p.evaluate(()=>{ AMStudio.loadDeck(AMStudio.newDeck(),null); AMBrand.open(); }); await sleep(300);
  check('S29-30: apresentação nova não tem kit; a lista de kits guardados continua', (await BR())===null && await p.$eval('#bkKits',s=>s.options.length)===2 && await p.$eval('#bkDel',b=>b.disabled));
  await p.selectOption('#bkKits','Cliente XPTO'); await p.click('#bkUse'); await sleep(300); br=await BR();
  check('S29-31: “Usar” aplica o kit guardado à apresentação nova (sem a data interna)', !!br && br.name==='Cliente XPTO' && br.font==='Montserrat' && JSON.stringify(br.colors)==='["#1F66A8","#1F8048"]' && !('at' in br), br);
  await p.selectOption('#bkKits','Cliente XPTO'); await p.click('#bkRm'); await sleep(300);
  const cf=await p.evaluate(()=>{ const m=document.getElementById('modal'); const r=m.querySelector('.mdl'); if(!m.classList.contains('open')||!r) return null; const rc=r.getBoundingClientRect(); const el=document.elementFromPoint(rc.left+rc.width/2, rc.top+20); return {t:m.querySelector('h3').textContent, onTop:!!(el&&r.contains(el))}; });
  check('S29-32: “Apagar” pede confirmação A&M por cima da caixa', !!cf && /Apagar o kit “Cliente XPTO”\?/.test(cf.t) && cf.onTop, cf);
  await p.keyboard.press('Enter'); await sleep(300);
  check('S29-33: confirmar apaga o kit da lista; a caixa continua aberta e o kit da apresentação fica', await p.evaluate(()=>!localStorage.getItem('amStudio.brandKits')||JSON.parse(localStorage.getItem('amStudio.brandKits')).length===0) && await dlgOpen() && (await BR()).name==='Cliente XPTO');
  const js=await p.evaluate(()=>{ const t=AMBrand.toJSON(); const o=JSON.parse(t); const back=AMBrand.fromJSON(t); return {kind:o.kind, name:o.name, back:JSON.stringify(back), bad:AMBrand.fromJSON('{"x":1}'), bad2:AMBrand.fromJSON('nope'), wrapped:JSON.stringify(AMBrand.fromJSON(JSON.stringify({brand:{colors:['#111111']}})))}; });
  check('S29-34: kit .json: toJSON (kind brand-kit) e fromJSON voltam o mesmo kit; JSON sem kit → null; {brand:{…}} também vale', js.kind==='brand-kit' && js.name==='Cliente XPTO' && js.back===JSON.stringify(await BR()) && js.bad===null && js.bad2===null && js.wrapped==='{"colors":["#111111"]}', js);
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:5000}), p.click('#bkDl')]);
  const dlPath=path.join(TMP,dl.suggestedFilename()); await dl.saveAs(dlPath); const dlObj=JSON.parse(fs.readFileSync(dlPath,'utf8'));
  check('S29-35: “Baixar kit (.json)” baixa um arquivo com o kit', /kit-de-marca\.json$/.test(dl.suggestedFilename()) && dlObj.kind==='brand-kit' && dlObj.name==='Cliente XPTO', dl.suggestedFilename());
  const fileIn=await p.$('#bkFile'); await p.evaluate(()=>{ AMStudio.brand.set({name:'Outro',colors:['#222222']}); }); await fileIn.setInputFiles(dlPath); await sleep(400); br=await BR();
  check('S29-36: “Abrir kit (.json)…” aplica o kit do arquivo (substitui o atual)', br.name==='Cliente XPTO' && JSON.stringify(br.colors)==='["#1F66A8","#1F8048"]', br);
  await p.click('#bkDel'); await sleep(250);
  check('S29-37: “Remover kit” tira o kit da apresentação', (await BR())===null && await p.$eval('#bkDel',b=>b.disabled));
  await p.keyboard.press('Escape'); await sleep(150);
  /* ---------- 10. logotipo → cores ---------- */
  const lg=await p.evaluate(()=>new Promise(res=>{ const c=document.createElement('canvas'); c.width=100; c.height=100; const g=c.getContext('2d'); g.fillStyle='#FFFFFF'; g.fillRect(0,0,100,100); g.fillStyle='#1F66A8'; g.fillRect(0,0,50,100); g.fillStyle='#F2C94C'; g.fillRect(50,0,30,100); g.fillStyle='#1F67A9'; g.fillRect(80,0,5,100); const im=new Image(); im.onload=()=>res(AMBrand.colorsFromImage(im,5)); im.src=c.toDataURL('image/png'); }));
  check('S29-38: cores do logotipo: as mais presentes primeiro, sem o branco do fundo e sem o tom quase igual ao azul', JSON.stringify(lg)==='["#1F66A8","#F2C94C"]', lg);
  const pc=await p.evaluate(()=>AMBrand.parseColors('Cores: #1F66A8 e 002a46, rgb(31,128,72); #FFF | nada 12345'));
  check('S29-39: parseColors lê #hex, hex sem #, rgb(), #abc na ordem em que aparecem; ignora palavras e códigos incompletos', JSON.stringify(pc)==='["#1F66A8","#002A46","#1F8048","#FFFFFF"]', pc);
  /* ---------- 11. PDF (fonte do Google embutida), PowerPoint Editável (tema da marca), apresentação salva ---------- */
  await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Marca'; d.brand={name:'Cliente XPTO',colors:['#1F66A8','#F2C94C','#1F8048'],pal:{p:'#1F8048',a:'#F2C94C'},font:'Montserrat'}; const s=mk.slide('blank-light'); s.els=[]; const t=mk.text('title'); t.font='Montserrat'; t.html='Título em Montserrat'; t.x=80; t.y=80; const ch=mk.fx('columns'); ch.pal={p:'#1F8048',a:'#F2C94C'}; ch.x=80; ch.y=240; s.els=[t,ch]; d.slides=[s]; A.loadDeck(d,null); });
  await sleep(600);
  const fc=await p.evaluate(async()=>{ const css=await AMExport.fontsCSS({families:['montserrat']}); return {n:(css.match(/font-family:'Montserrat'/g)||[]).length, data:/src:url\(data:font\/woff2/.test(css)}; });
  check('S29-40: fontsCSS embute a Montserrat (@font-face com data:) a partir do <link> da fonte do kit', fc.n>=2 && fc.data, fc);
  const pdf=await p.evaluate(async()=>{ const b=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); return b.size; });
  check('S29-41: PDF do slide com Montserrat e gráfico recolorido sai', pdf>20000, pdf);
  const r1=await p.evaluate(async()=>{ const rr=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1,type:'png'}); const png=rr.canvas.toDataURL('image/png'); rr.canvas.width=0; return png; });
  fs.writeFileSync(SH('pdf-slide'), Buffer.from(r1.split(',')[1],'base64'));
  const pk=path.join(TMP,'marca.pptx'); fs.writeFileSync(pk, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  const thm=execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.read("ppt/theme/theme1.xml").decode()); print("@@"); print(z.read("ppt/slides/slide1.xml").decode())',pk],{encoding:'utf8'});
  const [thx,slx]=thm.split('@@');
  check('S29-42: PowerPoint Editável válido; o tema leva as cores do kit (accent1 = destaque, accent2/3 = cores da marca, dk2 = principal), o nome do kit e Montserrat como fonte do tema', insp.zipBad===null && insp.xmlBad.length===0 && /<a:accent1><a:srgbClr val="F2C94C"\/>/.test(thx) && /<a:accent2><a:srgbClr val="1F66A8"\/>/.test(thx) && /<a:accent3><a:srgbClr val="1F8048"\/>/.test(thx) && /<a:dk2><a:srgbClr val="1F8048"\/>/.test(thx) && /clrScheme name="Cliente XPTO"/.test(thx) && /majorFont><a:latin typeface="Montserrat"/.test(thx) && /typeface="Montserrat"/.test(slx), {bad:insp.xmlBad});
  const saved=await p.evaluate(()=>AMStudio.exportHTML()); const sp=path.join(TMP,'marca.html'); fs.writeFileSync(sp, saved);
  const pv=await open(ctx,'file://'+sp,'player'); await sleep(900);
  const pf=await pv.evaluate(async()=>{ const t=document.querySelector('.am-tx'); const l=document.querySelector('link[rel=stylesheet][href*="fonts.googleapis"]'); const fl=await document.fonts.load('16px Montserrat').catch(()=>[]); return {ff:t?getComputedStyle(t).fontFamily:null, lk:l?l.href:null, loaded:fl.length>0&&document.fonts.check('16px Montserrat')}; });
  check('S29-43: a apresentação salva carrega a Montserrat (link com a família) e o texto usa a fonte', /Montserrat/.test(pf.lk||'') && /^["']?Montserrat/.test(pf.ff||'') && pf.loaded, pf);
  await pv.close();
  /* ---------- 12. importar .pptx: o tema vira kit ---------- */
  const FX=path.join(TMP,'fx'); JSON.parse(execFileSync('python3',[TOOLS24,'make',FX],{encoding:'utf8'}));
  const rep=await importApi(p, path.join(FX,'fx-a.pptx'), 'replace'); br=await BR();
  check('S29-44: importar um .pptx (substituir) traz o tema do arquivo como kit: nome “Tema de fx-a”, cores do tema (sem branco) e a fonte de corpo', rep.replaced && !!br && br.name==='Tema de fx-a' && Array.isArray(br.colors) && br.colors.length>=4 && br.colors.every(c=>/^#[0-9A-F]{6}$/.test(c)) && br.colors.indexOf('#FFFFFF')<0 && typeof br.font==='string' && br.font.length>0, br);
  const rep2=await importApi(p, path.join(FX,'fx-b.pptx'), 'append'); const br2=await BR();
  check('S29-45: adicionar ao final não mexe no kit', rep2.added>0 && JSON.stringify(br2)===JSON.stringify(br));
  /* ---------- 13. fonte importada no seletor segue aparecendo ---------- */
  const imp=await p.evaluate(()=>{ const A=AMStudio; A.goSlide(0); const t=A.deck.slides[0].els.find(e=>e.type==='text'); A.select(t.id); const s=document.querySelector('#props select[data-p="font"]'); return {v:s.value, imp:[].map.call(s.options,o=>o.textContent).filter(t=>/importado|computador|kit de marca/.test(t)&&t.indexOf(s.value)===0)}; });
  check('S29-46: a fonte do arquivo importado continua selecionada no painel (como “kit de marca”, já que veio do tema; ou “do computador”/“do arquivo importado”)', imp.v.length>0 && imp.imp.length===1, imp);
  await p.screenshot({path:SH('kit'),fullPage:false}).catch(()=>{});
  await p.evaluate(()=>{ AMStudio.brand.set({name:'Cliente XPTO',colors:['#1F66A8','#F2C94C','#1F8048','#002A46'],pal:{p:'#1F8048'},font:'Montserrat'}); AMBrand.open(); }); await sleep(400);
  await p.screenshot({path:SH('caixa')});
  await p.keyboard.press('Escape');
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
