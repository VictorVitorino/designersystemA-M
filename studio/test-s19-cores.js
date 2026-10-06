/* S19 · “Outras cores”: seletor “Mais cores…” (paleta ampliada, recentes, hex, seletor do sistema), campos de cor dos componentes e
   cores das séries dos gráficos — tudo pela interface real, com desfazer, salvar → reabrir e arquivo exportado.
   Uso: python3 assemble.py && node test-s19-cores.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(800); return p; }
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
  let p=await open(ctx, FILE+'?nocover', 'ed');
  await p.evaluate(()=>{ try{ localStorage.removeItem('amStudio.recentColors'); }catch(e){} });
  const selEl=()=>p.evaluate(()=>{ const id=AMStudio.selected()[0]; return JSON.parse(JSON.stringify(AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id)||null)); });
  const popInfo=()=>p.evaluate(()=>{ const c=document.querySelector('.cpop'); if(!c) return {open:false}; const r=c.getBoundingClientRect();
    return {open:true, inModal:!!c.closest('#modal'), pos:getComputedStyle(c).position, r:{l:r.left,t:r.top,r:r.right,b:r.bottom}, side:c.dataset.side, heads:[...c.querySelectorAll('h4')].map(h=>h.textContent),
      nBrand:c.querySelectorAll('.cp-sec:nth-of-type(2) .cp-s').length, nExt:c.querySelectorAll('.cp-ext .cp-s').length, rec:[...c.querySelectorAll('.cp-rec .cp-s')].map(x=>x.dataset.c),
      focus:document.activeElement&&c.contains(document.activeElement)?(document.activeElement.className+'|'+(document.activeElement.dataset.c||'')):null}; });
  /* botão “Mais cores…” da linha de amostras cujo rótulo (span.pf ou h3 logo antes) contém txt */
  const moreBtn=async(txt)=>{ const h=await p.evaluateHandle((txt)=>[...document.querySelectorAll('#props .sw')].filter(s=>{ const q=s.previousElementSibling; return q&&q.textContent.trim().toLowerCase().indexOf(txt.toLowerCase())>=0; }).map(s=>s.querySelector('button.more'))[0]||null, txt); return h.asElement(); };
  const stageEl=(id)=>`#wrap > .am-stage .am-el[data-id="${id}"]`;

  /* ---------- 1. texto: botão visível, popover, cor ampliada ---------- */
  await p.click('[data-menu=mText]'); await sleep(150); await p.click('[data-text=title]'); await sleep(300);
  let t=await selEl();
  const row=await p.evaluate(()=>{ const s=[...document.querySelectorAll('#props .sw')].find(s=>/cor do texto/i.test(s.previousElementSibling&&s.previousElementSibling.textContent||'')); const m=s&&s.querySelector('button.more'); const r=m&&m.getBoundingClientRect();
    return {more:!!m, title:m&&m.title, w:r&&r.width, h:r&&r.height, nativeInRow:!!(s&&s.querySelector('input[type=color]')), nativeInProps:document.querySelectorAll('#props .sw input[type=color]').length, noDataV:m&&!m.hasAttribute('data-v')}; });
  check('S19-01: linha “Cor do texto” tem o botão “Mais cores…” visível (≥ 20 px, sem data-v) e nenhum input nativo minúsculo no painel', row.more&&row.title==='Mais cores…'&&row.w>=20&&row.h>=20&&!row.nativeInRow&&row.nativeInProps===0&&row.noDataV, row);
  await (await moreBtn('Cor do texto')).click(); await sleep(250);
  let pi=await popInfo();
  check('S19-02: o popover abre ancorado (position fixed, fora do #modal) com Cores A&M (13), Mais cores (48), Recentes e Personalizada; foco numa amostra; dentro da janela', pi.open&&!pi.inModal&&pi.pos==='fixed'&&JSON.stringify(pi.heads)==='["Cores A&M","Mais cores","Recentes","Personalizada"]'&&pi.nBrand===13&&pi.nExt===48&&/cp-s/.test(pi.focus||'')&&pi.r.l>=0&&pi.r.t>=0&&pi.r.r<=1280&&pi.r.b<=720, pi);
  await p.screenshot({path:path.join(SHOTS,'s19-01-popover-texto.png')});
  await p.click('.cpop .cp-s[data-c="#1F66A8"]'); await sleep(250);
  t=await selEl(); pi=await popInfo();
  const txc=await p.evaluate((sel)=>getComputedStyle(document.querySelector(sel+' .am-tx')).color, stageEl(t.id));
  const cust=await p.evaluate(()=>{ const s=[...document.querySelectorAll('#props .sw')].find(s=>/cor do texto/i.test(s.previousElementSibling.textContent)); const f=s.querySelector('button'); return {first:f.className, v:f.dataset.v, set:f.dataset.set}; });
  check('S19-03: clicar uma cor da paleta ampliada aplica no texto do palco (#1F66A8), fecha o popover e a linha mostra a cor atual como primeira amostra marcada', !pi.open&&t.color==='#1F66A8'&&txc==='rgb(31, 102, 168)'&&/cust/.test(cust.first)&&/on/.test(cust.first)&&cust.v==='#1F66A8'&&cust.set==='color', {color:t.color,txc,cust});
  await p.mouse.click(600,690); await sleep(150); /* foco fora dos campos (rodapé do palco) */
  await p.evaluate((id)=>AMStudio.select(id), t.id); await sleep(100);
  await p.keyboard.press('Control+z'); await sleep(200); const u1=await p.evaluate((id)=>AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id).color, t.id);
  await p.keyboard.press('Control+y'); await sleep(200); const r1=await p.evaluate((id)=>AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id).color, t.id);
  check('S19-04: Ctrl+Z desfaz a cor num passo só (volta ao navy) e Ctrl+Y refaz', u1==='#002A46'&&r1==='#1F66A8', {u1,r1});

  /* ---------- 2. campo hex ---------- */
  await p.evaluate((id)=>AMStudio.select(id), t.id); await sleep(150);
  await (await moreBtn('Cor do texto')).click(); await sleep(200);
  pi=await popInfo();
  const hexInit=await p.$eval('.cpop .cp-hex', x=>x.value);
  await p.fill('.cpop .cp-hex','zz12'); await p.press('.cpop .cp-hex','Enter'); await sleep(150);
  const bad=await p.evaluate(()=>{ const i=document.querySelector('.cpop .cp-hex'); return i?{bad:i.classList.contains('bad'), aria:i.getAttribute('aria-invalid'), err:!document.querySelector('.cpop .cp-err').hidden, outline:getComputedStyle(i).borderTopColor}:null; });
  const still=(await selEl()).color;
  await p.fill('.cpop .cp-hex','#7b5bb3'); await sleep(80); const goodState=await p.$eval('.cpop .cp-hex', i=>i.classList.contains('bad'));
  await p.press('.cpop .cp-hex','Enter'); await sleep(250);
  t=await selEl(); pi=await popInfo();
  check('S19-05: campo hex: abre com a cor atual; valor inválido + Enter marca contorno vermelho (aria-invalid) e não aplica; #7b5bb3 + Enter aplica #7B5BB3 e fecha', hexInit==='#1F66A8'&&bad&&bad.bad&&bad.aria==='true'&&bad.err&&bad.outline==='rgb(210, 63, 85)'&&still==='#1F66A8'&&!goodState&&t.color==='#7B5BB3'&&!pi.open, {hexInit,bad,still,goodState,color:t.color});

  /* ---------- 3. teclado: Enter abre, setas andam, Esc fecha e devolve o foco ---------- */
  const x0=t.x;
  await p.evaluate(()=>{ const s=[...document.querySelectorAll('#props .sw')].find(s=>/cor do texto/i.test(s.previousElementSibling.textContent)); s.querySelector('button.more').focus(); });
  await p.keyboard.press('Enter'); await sleep(200);
  const k0=await popInfo();
  await p.keyboard.press('ArrowRight'); await sleep(60); const k1=await popInfo();
  await p.keyboard.press('ArrowDown'); await sleep(60); const k2=await popInfo();
  const top1=await p.evaluate(()=>document.activeElement.getBoundingClientRect().top);
  await p.keyboard.press('ArrowUp'); await sleep(60); const top0=await p.evaluate(()=>document.activeElement.getBoundingClientRect().top);
  await p.keyboard.press('Escape'); await sleep(150);
  const k3=await popInfo(), fb=await p.evaluate(()=>({cp:document.activeElement&&document.activeElement.dataset.cpick, cls:document.activeElement&&document.activeElement.className}));
  t=await selEl();
  check('S19-06: teclado: Enter no botão abre com foco na cor atual; → e ↓ andam entre amostras (sem mover o elemento); Esc fecha e devolve o foco ao botão “Mais cores…”', k0.open&&/on/.test(k0.focus)&&k1.focus!==k0.focus&&k2.focus!==k1.focus&&top1>top0&&!k3.open&&fb.cp==='color'&&/more/.test(fb.cls)&&t.x===x0&&t.color==='#7B5BB3', {k0:k0.focus,k1:k1.focus,k2:k2.focus,top0,top1,fb,x:t.x});
  await (await moreBtn('Cor do texto')).click(); await sleep(200); const o1=(await popInfo()).open;
  await p.mouse.click(400,650); await sleep(200); const o2=(await popInfo()).open;
  check('S19-07: clique fora fecha o popover sem mudar a cor', o1&&!o2&&(await p.evaluate((id)=>AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id).color, t.id))==='#7B5BB3', {o1,o2});

  /* ---------- 4. texto com cores embutidas: a cor do painel vale para a caixa inteira ---------- */
  const mixId=await p.evaluate(()=>{ const e=AMStudio.mk.text('body',{html:'<span style="color:#ff0000;font-weight:700">Vermelho</span> e <font color="#00ff00">verde</font> e normal', x:80, y:560, w:600, h:80}); AMStudio.deck.slides[AMStudio.cur].els.push(e); AMStudio.renderAll(); AMStudio.commit(); AMStudio.select(e.id); return e.id; }); await sleep(200);
  await p.click('#props .sw button[data-set="color"][data-v="#F78C16"]'); await sleep(200);
  const mix=await p.evaluate((sel)=>{ const n=document.querySelector(sel+' .am-tx'); const cs=[...n.querySelectorAll('*')].map(x=>getComputedStyle(x).color); return {html:n.innerHTML, all:cs.concat([getComputedStyle(n).color])}; }, stageEl(mixId));
  const mixEl=await selEl();
  check('S19-08: texto colado com cores próprias: a cor escolhida no painel vale para a caixa inteira (cores embutidas removidas, negrito mantido)', !/color/i.test(mixEl.html)&&/font-weight/.test(mixEl.html)&&mix.all.every(c=>c==='rgb(247, 140, 22)'), {html:mixEl.html, all:mix.all});

  /* ---------- 5. forma: preenchimento e contorno (contorno com a linha perto do pé do painel) ---------- */
  await p.click('[data-menu=mShape]'); await sleep(150); await p.click('.menu.open [data-shape=rect]'); await sleep(300);
  const sh=await selEl();
  await (await moreBtn('Preenchimento')).click(); await sleep(200);
  await p.click('.cpop .cp-s[data-c="#D23F55"]'); await sleep(200);
  const shFill=await p.evaluate((sel)=>{ const n=document.querySelector(sel+' svg [fill]'); return n&&n.getAttribute('fill'); }, stageEl(sh.id));
  /* rola o painel para a linha do contorno ficar no pé (y ≈ 680) */
  await p.evaluate(()=>{ const s=[...document.querySelectorAll('#props .sw')].find(s=>/contorno/i.test(s.previousElementSibling.textContent)); const m=s.querySelector('button.more'); const pr=document.querySelector('#props'); pr.scrollTop+= m.getBoundingClientRect().top-680; }); await sleep(250);
  const mb=await p.evaluate(()=>{ const s=[...document.querySelectorAll('#props .sw')].find(s=>/contorno/i.test(s.previousElementSibling.textContent)); return s.querySelector('button.more').getBoundingClientRect().top; });
  await (await moreBtn('Contorno')).click(); await sleep(250);
  pi=await popInfo();
  await p.screenshot({path:path.join(SHOTS,'s19-02-popover-pe-do-painel.png')});
  check('S19-09: com a linha no pé do painel (y ≈ '+Math.round(mb)+'), o popover abre para cima e fica inteiro dentro da janela 1280×720', pi.open&&mb>640&&pi.side==='above'&&pi.r.t>=0&&pi.r.b<=720&&pi.r.l>=0&&pi.r.r<=1280&&pi.r.b<=mb, {mb,pi:pi.r,side:pi.side});
  await p.fill('.cpop .cp-hex','#0B2F55'); await p.press('.cpop .cp-hex','Enter'); await sleep(200);
  const sh2=await selEl();
  check('S19-10: forma: preenchimento #D23F55 (palco) e contorno #0B2F55 escolhidos no seletor', sh2.fill==='#D23F55'&&shFill==='#D23F55'&&sh2.stroke==='#0B2F55', {fill:sh2.fill,shFill,stroke:sh2.stroke});

  /* ---------- 6. linha: cor do traço ---------- */
  await p.click('[data-menu=mLine]'); await sleep(150); await p.click('#mLine [data-line=line]'); await sleep(300);
  const ln=await selEl();
  const lineRow=await p.evaluate(()=>{ const s=document.querySelector('#props .sw'); return s&&s.closest('.sec').querySelector('h3').textContent; });
  await p.evaluate(()=>document.querySelector('#props .sw button.more').scrollIntoView({block:'center'})); await sleep(150);
  await p.click('#props .sw button.more'); await sleep(200);
  await p.click('.cpop .cp-s[data-c="#34A05E"]'); await sleep(200);
  const ln2=await selEl(), lnStroke=await p.evaluate((sel)=>{ const n=document.querySelector(sel+' .am-ln'); return n&&n.getAttribute('stroke'); }, stageEl(ln.id));
  check('S19-11: linha: “Mais cores…” da seção Linha pinta o traço de verde #34A05E no palco', ln.type==='line'&&/linha/i.test(lineRow)&&ln2.stroke==='#34A05E'&&lnStroke==='#34A05E', {lineRow,stroke:ln2.stroke,lnStroke});

  /* ---------- 7. ícone animado: campo de cor do componente ---------- */
  await p.evaluate(()=>AMStudio.insertFx('icon')); await sleep(300);
  const ic=await selEl();
  const icRow=await p.evaluate(()=>{ const s=[...document.querySelectorAll('#props .cfld')].find(f=>/cor do traço/i.test(f.textContent)); return s?{n:s.querySelectorAll('.sw button[data-v]').length, sel:!!document.querySelector('#props select[data-p="data.color"]'), more:!!s.querySelector('button.more')}:null; });
  await (await moreBtn('Cor do traço')).click(); await sleep(200);
  await p.click('.cpop .cp-s[data-c="#6BA3DC"]'); await sleep(200);
  const ic2=await selEl(), icVar=await p.evaluate((sel)=>document.querySelector(sel+' .fxic').style.getPropertyValue('--ic'), stageEl(ic.id));
  check('S19-12: ícone: “Cor do traço” virou amostras (3 opções + Mais cores, sem select) e aceita qualquer cor (#6BA3DC no --ic do palco)', icRow&&icRow.n===3&&!icRow.sel&&icRow.more&&ic2.data.color==='#6BA3DC'&&icVar.trim()==='#6BA3DC', {icRow,color:ic2.data.color,icVar});

  /* ---------- 8. Linhas A&M: c1 ---------- */
  await p.evaluate(()=>AMStudio.insertFx('amlines')); await sleep(300);
  const am=await selEl();
  await (await moreBtn('Cor da linha fina')).click(); await sleep(200);
  await p.click('.cpop .cp-s[data-c="#9C7FCB"]'); await sleep(200);
  const am2=await selEl(), amStroke=await p.evaluate((sel)=>document.querySelector(sel+' svg path').getAttribute('stroke'), stageEl(am.id));
  check('S19-13: Linhas A&M: cor da linha fina #9C7FCB (campo de cor com amostras + Mais cores)', am2.data.c1==='#9C7FCB'&&amStroke==='#9C7FCB', {c1:am2.data.c1,amStroke});

  /* ---------- 9. gráfico de colunas: série 1 verde, legenda junto, Cores A&M ---------- */
  await p.click('[data-menu=mChart]'); await sleep(150); await p.click('#mChart [data-fx=columns]'); await sleep(700);
  const ch=await selEl();
  const ser=await p.evaluate(()=>({names:[...document.querySelectorAll('#props .cser .cser-n')].map(x=>x.textContent), reset:document.querySelector('#props [data-act="colors-reset"]').disabled}));
  await p.evaluate(()=>document.querySelector('#props .cser').scrollIntoView({block:'center'})); await sleep(200);
  await p.click('#props .cser:nth-of-type(1) button.more'); await sleep(200);
  await p.click('.cpop .cp-s[data-c="#34A05E"]'); await sleep(250);
  const colInfo=()=>p.evaluate((sel)=>{ const n=document.querySelector(sel); return {s0:[...n.querySelectorAll('.ch-bar[data-g="0"]')].map(r=>r.getAttribute('fill')), s1:[...n.querySelectorAll('.ch-bar[data-g="1"]')].map(r=>r.getAttribute('fill')), leg0:getComputedStyle(n.querySelector('.ch-leg span[data-g="0"] i')).backgroundColor, leg1:getComputedStyle(n.querySelector('.ch-leg span[data-g="1"] i')).backgroundColor}; }, stageEl(ch.id));
  let ci=await colInfo(); let ch2=await selEl();
  await p.screenshot({path:path.join(SHOTS,'s19-03-colunas-serie-verde.png')});
  check('S19-14: colunas: “Cores das séries” lista as séries (Varejo, Atacado, Digital); série 1 = #34A05E nas 4 barras E na legenda; série 2 continua A&M', JSON.stringify(ser.names)==='["Varejo","Atacado","Digital"]'&&ser.reset&&JSON.stringify(ch2.data.colors)==='["#34A05E"]'&&ci.s0.length===4&&ci.s0.every(f=>f==='#34A05E')&&ci.leg0==='rgb(52, 160, 94)'&&ci.s1.every(f=>f==='#4A6FA5')&&ci.leg1==='rgb(74, 111, 165)', {ser,colors:ch2.data.colors,ci});
  await p.click('#props .cser:nth-of-type(3) .sw button[data-v="#F78C16"]'); await sleep(200);
  ch2=await selEl(); const before=JSON.stringify(ch2.data.colors);
  await p.evaluate(()=>document.querySelector('#props [data-act="colors-reset"]').scrollIntoView({block:'center'})); await sleep(100);
  await p.click('#props [data-act="colors-reset"]'); await sleep(250);
  ch2=await selEl(); ci=await colInfo(); const rs=await p.evaluate(()=>document.querySelector('#props [data-act="colors-reset"]').disabled);
  check('S19-15: amostra rápida na série 3 grava ["#34A05E","","#F78C16"]; “Cores A&M” apaga data.colors e as barras voltam ao navy (botão desativa)', before==='["#34A05E","","#F78C16"]'&&ch2.data.colors===undefined&&ci.s0.every(f=>f==='#002A46')&&ci.leg0==='rgb(0, 42, 70)'&&rs, {before,after:ch2.data.colors,s0:ci.s0,rs});
  await p.keyboard.press('Control+z'); await sleep(250); ch2=await selEl();
  check('S19-16: Ctrl+Z depois de “Cores A&M” devolve as cores escolhidas', JSON.stringify(ch2.data.colors)==='["#34A05E","","#F78C16"]', ch2.data.colors);

  /* ---------- 10. gráfico de barras (interno): cor do destaque ---------- */
  await p.click('[data-menu=mChart]'); await sleep(150); await p.click('#mChart [data-fx=bars]'); await sleep(700);
  const bs=await selEl();
  const bRows=await p.evaluate(()=>[...document.querySelectorAll('#props .cser .cser-n')].map(x=>x.textContent));
  await p.evaluate(()=>document.querySelectorAll('#props .cser')[1].scrollIntoView({block:'center'})); await sleep(150);
  await p.click('#props .cser:nth-of-type(2) button.more'); await sleep(200);
  await p.click('.cpop .cp-s[data-c="#7B5BB3"]'); await sleep(250);
  const bs2=await selEl(), bInfo=await p.evaluate((sel)=>{ const n=document.querySelector(sel); return {hl:[...n.querySelectorAll('.fxb-bar.hl')].map(r=>r.getAttribute('fill')), lo:[...n.querySelectorAll('.fxb-bar:not(.hl)')].map(r=>r.getAttribute('fill'))}; }, stageEl(bs.id));
  check('S19-17: gráfico de barras: “Destaque” = #7B5BB3 nas barras destacadas; as demais seguem navy', JSON.stringify(bRows)==='["Barras","Destaque"]'&&JSON.stringify(bs2.data.colors)==='["","#7B5BB3"]'&&bInfo.hl.length===3&&bInfo.hl.every(f=>f==='#7B5BB3')&&bInfo.lo.every(f=>f==='#002A46'), {bRows,colors:bs2.data.colors,bInfo});

  /* ---------- 11. fundo do slide: seletor do sistema (input nativo) ---------- */
  await p.mouse.click(260,140); await sleep(100); await p.evaluate(()=>AMStudio.select(null)); await sleep(150);
  await (await moreBtn('Fundo')).click(); await sleep(200);
  await p.fill('.cpop .cp-nat','#eef6ff'); await sleep(250);
  const bg=await p.evaluate(()=>({bg:AMStudio.deck.slides[AMStudio.cur].bg, st:getComputedStyle(document.querySelector('#wrap > .am-stage')).backgroundColor, open:!!document.querySelector('.cpop')}));
  check('S19-18: fundo do slide pelo seletor nativo (#eef6ff → #EEF6FF no slide e no palco; popover fecha)', bg.bg==='#EEF6FF'&&bg.st==='rgb(238, 246, 255)'&&!bg.open, bg);

  /* ---------- 12. Recentes ---------- */
  await (await moreBtn('Fundo')).click(); await sleep(200);
  const rec1=(await popInfo()).rec; await p.keyboard.press('Escape'); await sleep(100);
  check('S19-19: Recentes = cores personalizadas usadas, a mais nova primeiro, sem cores A&M e sem repetir (máx. 8)', JSON.stringify(rec1)==='["#EEF6FF","#7B5BB3","#34A05E","#9C7FCB","#6BA3DC","#0B2F55","#D23F55","#1F66A8"]', rec1);

  /* ---------- 13. salvar → reabrir ---------- */
  const want=await p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const pickC=(d)=>{ const s=d.slides[0], E=s.els; const f=k=>E.find(e=>e.kind===k)||{}; const ty=k=>E.filter(e=>e.type===k); return {bg:s.bg, text:ty('text')[0].color, shapeFill:ty('shape')[0].fill, shapeStroke:ty('shape')[0].stroke, line:ty('line')[0].stroke, icon:f('icon').data.color, c1:f('amlines').data.c1, cols:JSON.stringify(f('columns').data.colors), bars:JSON.stringify(f('bars').data.colors)}; };
  await p.evaluate(()=>AMStudio.loadDeck(JSON.parse(JSON.stringify(AMStudio.deck)),'reaberto')); await sleep(400);
  const got=await p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const cw=pickC(want), cg=pickC(got);
  check('S19-20: salvar → reabrir mantém todas as cores (fundo, texto, forma, contorno, linha, ícone, Linhas A&M, séries das colunas, destaque das barras)', JSON.stringify(cw)===JSON.stringify(cg)&&cg.cols==='["#34A05E","","#F78C16"]'&&cg.bg==='#EEF6FF', {cw,cg});

  /* ---------- 14. dados hostis ---------- */
  const host=await p.evaluate(()=>{
    const d=JSON.parse(JSON.stringify(AMStudio.deck)); const s=d.slides[0];
    s.els.push({id:'hz1',type:'fx',kind:'columns',x:40,y:40,w:400,h:220,data:{cats:['a','b'],series:[{t:'x',v:[1,2]},{t:'y',v:[2,1]}],colors:['red;background:url(x)','#12345g','"><img src=x>']}});
    s.els.push({id:'hz2',type:'fx',kind:'columns',x:40,y:300,w:400,h:220,data:{cats:['a','b'],series:[{t:'x',v:[1,2]},{t:'y',v:[2,1]}],colors:['#12345G','#00ff00',7,null,{a:1},'#123456','#654321','#ABCDEF']}});
    s.els.push({id:'hz3',type:'fx',kind:'columns',x:40,y:300,w:400,h:220,data:{cats:['a'],series:[{t:'x',v:[1]}],colors:'#00ff00'}});
    s.els.push({id:'hz4',type:'fx',kind:'beacon',x:40,y:300,w:300,h:80,data:{title:'t',text:'x',tcolor:'#fff" onload="x'}});
    AMStudio.loadDeck(d,'hostil'); const S=AMStudio.deck.slides[0].els, g=id=>S.find(e=>e.id===id);
    const st=document.querySelector('#wrap > .am-stage');
    /* runtime direto (arquivo exportado adulterado, sem a validação do editor): cores inválidas viram as padrão */
    const raw=AMRT.renderSlide({bg:'#fff',els:[{id:'r1',type:'fx',kind:'columns',x:0,y:0,w:400,h:200,data:{cats:['a'],series:[{t:'x',v:[1]},{t:'y',v:[1]}],colors:['"><img src=x>','url(x)']}},{id:'r2',type:'fx',kind:'bars',x:0,y:0,w:400,h:200,data:{labels:'a,b',values:'1,2',highlight:'1',colors:['x" y="1','#ff0000']}},{id:'r3',type:'fx',kind:'donut',x:0,y:0,w:400,h:200,data:{items:[{t:'a',v:1}],colors:['<b>']}},{id:'r4',type:'fx',kind:'beacon',x:0,y:0,w:300,h:80,data:{title:'t',text:'x',tcolor:'red;background:url(x)'}}]},{play:false});
    return {h1:g('hz1').data.colors, h2:g('hz2').data.colors, h3:g('hz3').data.colors, h4:g('hz4').data.tcolor, img:st.querySelectorAll('img').length, rawImg:raw.querySelectorAll('img').length, rawDn:raw.querySelector('.am-el[data-id=r3] .dn-seg').getAttribute('stroke'), rawFill:[...raw.querySelectorAll('.am-el[data-id=r1] .ch-bar')].map(r=>r.getAttribute('fill')).join(','), rawBars:[...raw.querySelectorAll('.am-el[data-id=r2] .fxb-bar')].map(r=>r.getAttribute('fill')).join(','), rawUrl:/url\(/.test(raw.innerHTML), rawBe:raw.querySelector('.am-el[data-id=r4] .fxbe').style.color};
  });
  check('S19-21: dados hostis via loadDeck: cores inválidas descartadas (["red;…","#12345g","\\"><img…"] some; posições inválidas viram ""; máx. 6), nenhuma tag injetada; o runtime sozinho também ignora cores inválidas', host.h1===undefined&&JSON.stringify(host.h2)==='["","#00FF00","","","","#123456"]'&&host.h3===undefined&&host.h4===undefined&&host.img===0&&host.rawImg===0&&host.rawFill==='#002A46,#4A6FA5'&&host.rawBars==='#ff0000,#002A46'&&host.rawDn==='#002A46'&&!host.rawUrl&&host.rawBe==='rgb(0, 42, 70)', host);
  await p.evaluate((d)=>AMStudio.loadDeck(d,'volta'), got); await sleep(400);

  /* ---------- 15. arquivo exportado: o player mostra as mesmas cores ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(__dirname,'saved-s19.html'); fs.writeFileSync(f,html);
  const q=await open(ctx,'file://'+f,'exp'); await sleep(2500);
  const ex=await q.evaluate((want)=>{
    const sl=document.querySelector('.amp-slide.on, .amp-slide')||document; const S=want.slides[0].els, id=k=>(S.find(e=>e.kind===k)||{}).id, ty=k=>S.filter(e=>e.type===k)[0].id;
    const q1=(i,s)=>sl.querySelector('.am-el[data-id="'+i+'"] '+s);
    return {n:document.querySelectorAll('.amp-slide').length, bg:getComputedStyle(sl.querySelector('.am-stage')||sl).backgroundColor,
      text:getComputedStyle(q1(ty('text'),'.am-tx')).color, fill:q1(ty('shape'),'svg [fill]').getAttribute('fill'), line:q1(ty('line'),'.am-ln').getAttribute('stroke'),
      icon:q1(id('icon'),'.fxic').style.getPropertyValue('--ic').trim(), c1:q1(id('amlines'),'svg path').getAttribute('stroke'),
      cols0:[...sl.querySelectorAll('.am-el[data-id="'+id('columns')+'"] .ch-bar[data-g="0"]')].map(r=>r.getAttribute('fill')), cols2:[...sl.querySelectorAll('.am-el[data-id="'+id('columns')+'"] .ch-bar[data-g="2"]')].map(r=>r.getAttribute('fill')),
      leg:getComputedStyle(q1(id('columns'),'.ch-leg span[data-g="0"] i')).backgroundColor, hl:[...sl.querySelectorAll('.am-el[data-id="'+id('bars')+'"] .fxb-bar.hl')].map(r=>r.getAttribute('fill'))};
  }, got);
  await q.screenshot({path:path.join(SHOTS,'s19-04-exportado.png')});
  const exOk=ex.n===1&&ex.bg==='rgb(238, 246, 255)'&&ex.fill==='#D23F55'&&ex.line==='#34A05E'&&ex.icon==='#6BA3DC'&&ex.c1==='#9C7FCB'&&ex.cols0.length===4&&ex.cols0.every(c=>c==='#34A05E')&&ex.cols2.every(c=>c==='#F78C16')&&ex.leg==='rgb(52, 160, 94)'&&ex.hl.length===3&&ex.hl.every(c=>c==='#7B5BB3')&&ex.text==='rgb(123, 91, 179)';
  check('S19-22: arquivo exportado: o player mostra fundo, texto, forma, linha, ícone, Linhas A&M, séries (barras + legenda) e destaque nas cores escolhidas', exOk, ex);
  check('S19-23: export sem on* (CR-04) e sem o seletor do editor', !/onerror|onmouseover|onclick/i.test(html)&&!/AMColorPop|cp-hex/.test(html));
  await q.close(); try{ fs.unlinkSync(f); }catch(e){}

  /* ---------- 16. Recentes sobrevivem a recarregar a página ---------- */
  await p.reload(); await sleep(1000);
  await p.evaluate(()=>AMStudio.select(null)); await sleep(150);
  await (await moreBtn('Fundo')).click(); await sleep(200);
  const rec2=(await popInfo()).rec; await p.keyboard.press('Escape'); await sleep(100);
  check('S19-24: Recentes continuam lá depois de recarregar a página (localStorage amStudio.recentColors)', JSON.stringify(rec2)===JSON.stringify(rec1), rec2);


  /* ---------- 17. revisão do seletor: atalhos dentro do popover, prévia cancelada, posição, código colado, título, funil claro ---------- */
  await p.evaluate(()=>AMStudio.loadDeck({title:'Revisão',slides:[{id:'s1',bg:'#FFFFFF',els:[]},{id:'s2',bg:'#FFFFFF',els:[]}]},null,true,true)); await sleep(300);
  await p.evaluate(()=>AMStudio.select(null)); await sleep(150);
  /* F5 com o foco no popover (aberto pelo mouse): fecha o seletor e apresenta; o navegador não recebe a tecla */
  const keyTrap=()=>p.evaluate(()=>{ window.__kp=[]; window.__kh=e=>window.__kp.push(e.key+':'+e.defaultPrevented); addEventListener('keydown',window.__kh); });
  const keyLog=()=>p.evaluate(()=>{ removeEventListener('keydown',window.__kh); return window.__kp; });
  await (await moreBtn('Fundo')).click(); await sleep(250);
  const inPop=await p.evaluate(()=>!!(document.activeElement&&document.activeElement.closest('.cpop')));
  await keyTrap(); await p.keyboard.press('F5'); await sleep(700);
  const k5=await keyLog(), pres5=await p.evaluate(()=>({pres:document.querySelector('#presenter').classList.contains('open'), pop:!!document.querySelector('.cpop')}));
  await p.keyboard.press('Escape'); await sleep(600);
  await p.evaluate(()=>AMStudio.select(null)); await sleep(150);
  await (await moreBtn('Fundo')).click(); await sleep(250);
  await keyTrap(); await p.keyboard.press('F1'); await sleep(400);
  const kF1=await keyLog(), help=await p.evaluate(()=>({modal:document.querySelector('#modal').classList.contains('open'), pop:!!document.querySelector('.cpop')}));
  await p.keyboard.press('Escape'); await sleep(300);
  await (await moreBtn('Fundo')).click(); await sleep(250);
  await keyTrap(); const dl=p.waitForEvent('download',{timeout:5000}).catch(()=>null); await p.keyboard.press('Control+s'); const dlo=await dl; await sleep(300);
  const ks=await keyLog(), popS=await p.evaluate(()=>!!document.querySelector('.cpop'));
  await (await moreBtn('Fundo')).click(); await sleep(250);
  await keyTrap(); await p.keyboard.press('Control+o'); await sleep(400);
  const ko=await keyLog(), openM=await p.evaluate(()=>({modal:document.querySelector('#modal').classList.contains('open'), txt:(document.querySelector('#modal h3')||{}).textContent}));
  await p.keyboard.press('Escape'); await sleep(300);
  check('S19-25: com o foco dentro do popover, F5 / F1 / Ctrl+S / Ctrl+O fecham o seletor e fazem o que fazem no editor (apresentar, ajuda, salvar o .html, abrir) — o navegador nunca recebe a tecla (defaultPrevented)', inPop&&k5[0]==='F5:true'&&pres5.pres&&!pres5.pop&&kF1[0]==="F1:true"&&help.modal&&!help.pop&&ks.some(x=>/^s:true$/i.test(x))&&!!dlo&&/\.html$/.test(dlo&&dlo.suggestedFilename()||'')&&!popS&&ko.some(x=>/^o:true$/i.test(x))&&openM.modal&&/Abrir/i.test(openM.txt||''), {inPop,k5,pres5,kF1,help,ks,dl:dlo&&dlo.suggestedFilename(),popS,ko,openM});

  /* prévia do seletor do sistema + Esc (ou clique fora) = nada muda, nenhum passo de desfazer */
  await p.evaluate(()=>AMStudio.select(null)); await sleep(150);
  const bg0=await p.evaluate(()=>({bg:AMStudio.deck.slides[AMStudio.cur].bg, undo:document.querySelector('#bUndo').disabled, json:JSON.stringify(AMStudio.deck)}));
  await (await moreBtn('Fundo')).click(); await sleep(200);
  await p.evaluate(()=>{ const n=document.querySelector('.cpop .cp-nat'); for(let i=0;i<40;i++){ n.value='#'+(0x958e00+i).toString(16); n.dispatchEvent(new Event('input',{bubbles:true})); } });
  const bgLive=await p.evaluate(()=>getComputedStyle(document.querySelector('#wrap > .am-stage')).backgroundColor);
  await p.keyboard.press('Escape'); await sleep(250);
  const bgEsc=await p.evaluate(()=>({bg:AMStudio.deck.slides[AMStudio.cur].bg, st:getComputedStyle(document.querySelector('#wrap > .am-stage')).backgroundColor, undo:document.querySelector('#bUndo').disabled, json:JSON.stringify(AMStudio.deck), focus:document.activeElement&&document.activeElement.dataset.cpick}));
  await (await moreBtn('Fundo')).click(); await sleep(200);
  await p.evaluate(()=>{ const n=document.querySelector('.cpop .cp-nat'); n.value='#123456'; n.dispatchEvent(new Event('input',{bubbles:true})); });
  await p.mouse.click(600,690); await sleep(250);
  const bgOut=await p.evaluate(()=>({bg:AMStudio.deck.slides[AMStudio.cur].bg, undo:document.querySelector('#bUndo').disabled, json:JSON.stringify(AMStudio.deck), pop:!!document.querySelector('.cpop')}));
  check('S19-26: arrastar no seletor do sistema mostra a prévia; Esc ou clique fora desfaz a prévia sem gravar (fundo e deck como antes, nenhum passo de desfazer; Esc devolve o foco ao botão)', bgLive==='rgb(149, 142, 39)'&&bgEsc.json===bg0.json&&bgEsc.st==='rgb(255, 255, 255)'&&bgEsc.undo===bg0.undo&&bgEsc.focus==='s.bg'&&bgOut.json===bg0.json&&!bgOut.pop&&bgOut.undo===bg0.undo, {bg0:{bg:bg0.bg,undo:bg0.undo},bgLive,bgEsc:{bg:bgEsc.bg,st:bgEsc.st,undo:bgEsc.undo,focus:bgEsc.focus,same:bgEsc.json===bg0.json},bgOut:{bg:bgOut.bg,undo:bgOut.undo,same:bgOut.json===bg0.json}});

  /* sem espaço acima nem abaixo do botão (série 2 de colunas no meio do painel): o popover abre ao lado, sem cobrir o botão nem a linha */
  await p.evaluate(()=>AMStudio.insertFx('columns')); await sleep(350);
  const ser2=await p.evaluateHandle(()=>document.querySelectorAll('#props .cser [data-cpick]')[1]);
  await p.evaluate(b=>{ const pr=document.querySelector('#props'); const sc=[pr,...pr.querySelectorAll('*')].find(x=>x.scrollHeight>x.clientHeight+4&&/(auto|scroll)/.test(getComputedStyle(x).overflowY))||pr; const r=b.getBoundingClientRect(); sc.scrollTop+=r.top-370; }, ser2); await sleep(200);
  const aR=await p.evaluate(b=>{ const r=b.getBoundingClientRect(); const row=b.closest('.cser').getBoundingClientRect(); return {l:r.left,t:r.top,r:r.right,b:r.bottom,rowL:row.left,rowT:row.top,rowB:row.bottom}; }, ser2);
  await ser2.asElement().click(); await sleep(250);
  const pp=await popInfo();
  const hit=(a,b)=>!(a.r<=b.l||b.r<=a.l||a.b<=b.t||b.b<=a.t);
  await p.screenshot({path:path.join(SHOTS,'s19-25-popover-ao-lado.png')});
  await p.keyboard.press('Escape'); await sleep(150);
  check('S19-27: botão no meio do painel (sem espaço acima nem abaixo): o popover abre ao lado (data-side=left), dentro da janela, sem cobrir o botão nem a linha da série', aR.t>280&&aR.t<440&&pp.open&&pp.side==='left'&&!hit(pp.r,aR)&&pp.r.r<=aR.rowL+1&&pp.r.t>=0&&pp.r.b<=720&&pp.r.l>=0, {aR,pp:pp.r,side:pp.side});

  /* código colado com espaços / rgb(): aceito; título do seletor das cores do componente sem cortar no meio */
  await p.evaluate(()=>AMStudio.insertFx('swot')); await sleep(350);
  await p.evaluate(()=>document.querySelector('#palSec').scrollIntoView({block:'center'})); await sleep(100);
  await p.click('#palSec [data-cpick="pal.p"]'); await sleep(200);
  const ttl=await p.evaluate(()=>{ const s=document.querySelector('.cpop .cp-hd span'); return {t:s.textContent, cut:s.scrollWidth>s.clientWidth+1}; });
  await p.focus('.cpop .cp-hex'); await p.keyboard.press('Control+a'); await p.keyboard.insertText(' #1f66a8 ');
  const hx1=await p.evaluate(()=>({v:document.querySelector('.cpop .cp-hex').value, bad:document.querySelector('.cpop .cp-hex').classList.contains('bad')}));
  await p.keyboard.press('Enter'); await sleep(300); const pa=(await selEl()).pal;
  await p.click('#palSec [data-cpick="pal.a"]'); await sleep(200);
  await p.focus('.cpop .cp-hex'); await p.keyboard.press('Control+a'); await p.keyboard.insertText('rgb(52, 160, 94)'); await p.keyboard.press('Enter'); await sleep(300); const pb=(await selEl()).pal;
  check('S19-28: título do seletor = nome do campo (“Cor principal”, sem a dica cortada); código colado com espaços (“ #1f66a8 ”) e em rgb() é aceito e aplicado', ttl.t==='Cor principal'&&!ttl.cut&&hx1.v===' #1f66a8 '&&!hx1.bad&&pa&&pa.p==='#1F66A8'&&pb&&pb.a==='#34A05E', {ttl,hx1,pa,pb});

  /* funil com cor clara: tons escurecendo (visíveis no slide branco); cor escura continua clareando como antes */
  await p.evaluate(()=>AMStudio.insertFx('funnel')); await sleep(350);
  await p.evaluate(()=>document.querySelector('#props .cser').scrollIntoView({block:'center'})); await sleep(100);
  await p.click('#props .cser [data-cpick]'); await sleep(200); await p.click('.cpop .cp-s[data-c="#FFF6DB"]'); await sleep(300);
  let fu=await selEl();
  const fnL=await p.evaluate((sel)=>[...document.querySelectorAll(sel+' .fn-s')].map(x=>{ const m=getComputedStyle(x).fill.match(/\d+/g).map(Number), f=v=>{ v/=255; return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4); }; return +(.2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])).toFixed(3); }), stageEl(fu.id));
  await p.click('#props .cser [data-cpick]'); await sleep(200); await p.click('.cpop .cp-s[data-c="#1F66A8"]'); await sleep(300);
  const fnD=await p.evaluate((sel)=>[...document.querySelectorAll(sel+' .fn-s')].map(x=>x.getAttribute('fill')), stageEl(fu.id));
  const mixW=(c,t)=>'#'+[1,3,5].map(i=>{ const v=parseInt(c.substr(i,2),16); return Math.round(v+(255-v)*t).toString(16).padStart(2,'0'); }).join('').toUpperCase();
  check('S19-29: funil com a 1ª cor clara (#FFF6DB): as etapas escurecem passo a passo e a última fica bem visível no branco (contraste ≥ 1,5); com #1F66A8 os tons continuam clareando como antes', JSON.stringify(fu.data.colors)==='["#FFF6DB"]'&&fnL.every((l,i)=>!i||l<fnL[i-1])&&(1.05/(fnL[fnL.length-1]+.05))>=1.5&&fnD[0]==='#1F66A8'&&fnD[1]===mixW('#1F66A8',.16), {fnL,fnD});

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
