/* S21 — “Ocultar slide” / “Reexibir slide” e “Redefinir slide” (semântica do PowerPoint), pela interface real:
   menu de contexto da miniatura, menu Slide, interruptor do painel do slide, F5 / Shift+F5 (contador, índice, linha do tempo),
   todos ocultos, arquivo exportado, reabrir, Redefinir num slide de layout e num projeto pronto, duplicar/colar, Ctrl+Z, tamanho do arquivo.
   Uso: python3 assemble.py && node test-s21-ocultar.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s21-'+f+'.png');
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
  await ctx.grantPermissions(['clipboard-read','clipboard-write']);
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const cur=()=>p.evaluate(()=>AMStudio.cur);
  const thumb=async i=>{ const t=p.locator('#thumbs .th[data-i="'+i+'"] .box'); await t.scrollIntoViewIfNeeded(); return t.boundingBox(); };
  const thumbCtx=async(i,label)=>{ const bb=await thumb(i); await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2,{button:'right'}); await sleep(220);
    const it=p.locator('.xmenu .xi',{hasText:label}); const c=await it.count(); if(c){ await it.first().hover(); await sleep(80); await it.first().click(); } else await p.keyboard.press('Escape'); await sleep(250); return c; };
  const clickThumb=async i=>{ const bb=await thumb(i); await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await sleep(250); };
  const menu=async(m,label)=>{ await p.click('#mbar [data-m="'+m+'"]'); await sleep(220); const it=p.locator('.xmenu .xi',{hasText:label}); const c=await it.count(); if(c){ await it.first().hover(); await sleep(80); await it.first().click(); } else await p.keyboard.press('Escape'); await sleep(250); return c; };
  const menuLabels=async m=>{ await p.click('#mbar [data-m="'+m+'"]'); await sleep(220); const r=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi')].map(b=>({t:b.querySelector('.xl').textContent, dis:b.classList.contains('dis'), tip:b.title}))); await p.keyboard.press('Escape'); await sleep(150); return r; };
  const wbox=async()=>(await p.$('#wrap')).boundingBox();
  const L=async(x,y)=>{ const wb=await wbox(); return {x:wb.x+x/1280*wb.width, y:wb.y+y/720*wb.height}; };
  const elBox=async id=>(await p.$('#wrap .am-stage .am-el[data-id="'+id+'"]')).boundingBox();
  const elC=async id=>{ const bb=await elBox(id); return {x:bb.x+bb.width/2,y:bb.y+bb.height/2}; };
  const pickEl=async id=>{ await p.keyboard.press('Escape'); await sleep(120); const c=await elC(id); await p.mouse.click(c.x,c.y); await sleep(220); }; /* Esc antes: o rótulo “Animação: …” do selecionado não cobre o próximo */
  const blank=async()=>{ const q=await L(1240,700); await p.mouse.click(q.x,q.y); await sleep(150); await p.keyboard.press('Escape'); await sleep(150); };
  const pos=()=>p.evaluate(()=>{ const e=document.querySelector('#presenter .amp-pos'); return e?e.textContent.trim():null; });

  /* ---------- 0. monta 5 slides pelo “+ Novo slide”: capa · conteúdo · divisor · indicadores · encerramento ---------- */
  for(const k of ['cover','content','section','kpis','closing']){ await p.click('#addSlide'); await sleep(200); await p.click('#mSlide [data-layout="'+k+'"]'); await sleep(250); }
  await clickThumb(0); await thumbCtx(0,'Apagar slide');
  let d=await D();
  const st0=d.slides.map(s=>({layout:s.layout, base:!!s.base, n:s.els.length, ph:s.els.map(e=>e.ph), keys:s.base?Object.keys(s.base.els):[]}));
  check('S21-01: slides novos guardam layout + base (bg e um registro por elemento) e cada elemento ganha ph único p0…pN; base sem conteúdo',
    d.slides.length===5 && st0.every(s=>s.base&&s.ph.every((x,i)=>x==='p'+i)&&s.keys.length===s.n) && st0.map(s=>s.layout).join()==='cover,content,section,kpis,closing'
    && !JSON.stringify(d.slides.map(s=>s.base)).match(/html|src|"data"|Mensagem principal/), st0);

  /* ---------- 1. ocultar pelo menu de contexto da miniatura ---------- */
  const c1=await thumbCtx(1,'Ocultar slide'); d=await D();
  const v1=await p.evaluate(()=>{ const t=document.querySelector('#thumbs .th[data-i="1"]'), st=t.querySelector('.box>.am-stage'), n=t.querySelector('.n'), hb=t.querySelector('.hb'), ban=document.getElementById('hidBan');
    return {hid:t.classList.contains('hid'), op:+getComputedStyle(st).opacity, strike:getComputedStyle(n).textDecorationLine, badge:!!hb, tip:hb&&hb.title, num:n.textContent, ban:!ban.hidden&&getComputedStyle(ban).display!=='none', banT:ban.textContent.trim(), banPE:getComputedStyle(ban).pointerEvents,
      other:document.querySelector('#thumbs .th[data-i="2"]').classList.contains('hid') }; });
  check('S21-02: miniatura › “Ocultar slide” marca slide.hidden; miniatura esmaecida (~45%), número riscado, selo de olho com título; faixa no palco sem bloquear clique',
    c1===1 && d.slides[1].hidden===true && v1.hid && Math.abs(v1.op-.45)<.02 && /line-through/.test(v1.strike) && v1.badge && v1.tip==='Slide oculto: não aparece na apresentação' && v1.num==='2' && v1.ban && v1.banT==='Slide oculto na apresentação' && v1.banPE==='none' && !v1.other, v1);
  await p.screenshot({path:SH('01-oculto-miniatura-1280x720')});
  const ctxL=await (async()=>{ const bb=await thumb(1); await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2,{button:'right'}); await sleep(220); await p.screenshot({path:SH('02-menu-miniatura-1280x720')});
    const r=await p.evaluate(()=>{ const m=document.querySelector('.xmenu'), rc=m.getBoundingClientRect(); return {items:[...m.querySelectorAll('.xi .xl')].map(x=>x.textContent), hd:m.querySelector('.xhd').textContent, inside:rc.bottom<=innerHeight&&rc.right<=innerWidth&&rc.top>=0}; }); await p.keyboard.press('Escape'); await sleep(150); return r; })();
  const sm1=await menuLabels('slide');
  check('S21-03: com o slide oculto, o rótulo vira “Reexibir slide” (miniatura e menu Slide), cabeçalho “· oculto”; menu cabe na tela; “Redefinir slide” presente; nenhum rótulo com “forma”/“abrir…”',
    ctxL.items.includes('Reexibir slide') && !ctxL.items.includes('Ocultar slide') && ctxL.items.includes('Redefinir slide') && /oculto/.test(ctxL.hd) && ctxL.inside
    && sm1.some(x=>x.t==='Reexibir slide') && sm1.some(x=>x.t==='Redefinir slide'&&!x.dis) && sm1.some(x=>x.t==='Ocultar painel de slides') && !ctxL.items.concat(sm1.map(x=>x.t)).some(t=>/forma|abrir…/i.test(t)), {ctxL,sm1});
  /* Ctrl+Z / Ctrl+Y: um passo */
  await blank(); await p.keyboard.press('Control+z'); await sleep(250);
  const u1=await p.evaluate(()=>({h:AMStudio.deck.slides[1].hidden, cls:document.querySelector('#thumbs .th[data-i="1"]').classList.contains('hid'), badge:!!document.querySelector('#thumbs .th[data-i="1"] .hb'), ban:document.getElementById('hidBan').hidden}));
  await p.keyboard.press('Control+y'); await sleep(250);
  const u2=await p.evaluate(()=>({h:AMStudio.deck.slides[1].hidden, cls:document.querySelector('#thumbs .th[data-i="1"]').classList.contains('hid')}));
  check('S21-04: Ctrl+Z desfaz o ocultar em um passo (miniatura e faixa voltam), Ctrl+Y refaz', u1.h===undefined && !u1.cls && !u1.badge && u1.ban && u2.h===true && u2.cls, {u1,u2});

  /* ---------- 2. ocultar pelo menu Slide (slide 4 = indicadores) ---------- */
  await clickThumb(3); const c2=await menu('slide','Ocultar slide'); d=await D();
  check('S21-05: menu Slide › “Ocultar slide” oculta o slide atual (só ele)', c2===1 && d.slides[3].hidden===true && d.slides.filter(s=>s.hidden).length===2, d.slides.map(s=>!!s.hidden));

  /* ---------- 3. interruptor do painel (slide 5) ---------- */
  await clickThumb(4); await blank();
  const sw0=await p.evaluate(()=>{ const s=document.querySelector('#props [data-act=hideslide]'); return s&&{role:s.getAttribute('role'), ck:s.getAttribute('aria-checked'), t:s.textContent.trim(), sec:s.closest('.sec').querySelector('h3').textContent, rs:!!document.querySelector('#props [data-act=slreset]:not([disabled])')}; });
  await p.click('#props [data-act=hideslide]'); await sleep(250);
  const sw1=await p.evaluate(()=>({h:AMStudio.deck.slides[4].hidden, ck:document.querySelector('#props [data-act=hideslide]').getAttribute('aria-checked'), cls:document.querySelector('#thumbs .th[data-i="4"]').classList.contains('hid'), note:document.querySelector('#secShow .note').textContent}));
  await p.screenshot({path:SH('03-painel-interruptor-1280x720')});
  await p.focus('#props [data-act=hideslide]'); await p.keyboard.press('Space'); await sleep(250);
  const sw2=await p.evaluate(()=>({h:AMStudio.deck.slides[4].hidden, ck:document.querySelector('#props [data-act=hideslide]').getAttribute('aria-checked'), foc:document.activeElement&&document.activeElement.dataset.act}));
  check('S21-06: painel do slide › interruptor “Ocultar na apresentação” (role=switch) liga e desliga, inclusive pelo teclado (foco fica no interruptor)',
    sw0&&sw0.role==='switch'&&sw0.ck==='false'&&sw0.t==='Ocultar na apresentação'&&sw0.rs && sw1.h===true&&sw1.ck==='true'&&sw1.cls&&/Oculto/.test(sw1.note) && sw2.h===undefined&&sw2.ck==='false'&&sw2.foc==='hideslide', {sw0,sw1,sw2});

  /* ---------- 4. F5: só os visíveis (slides 1, 3, 5) ---------- */
  await blank(); await p.keyboard.press('F5'); await sleep(900);
  const f5=[]; for(let i=0;i<3;i++){ f5.push(await p.evaluate(()=>({pos:document.querySelector('#presenter .amp-pos').textContent.trim(), n:document.querySelectorAll('#presenter .amp-slide').length, txt:document.querySelector('#presenter .amp-slide.on').textContent.replace(/\s+/g,' ').slice(0,60)}))); await p.keyboard.press('ArrowRight'); await sleep(500); }
  const endPos=await pos();
  await p.keyboard.press('g'); await sleep(400);
  const idx=await p.evaluate(()=>({n:document.querySelectorAll('#presenter .amp-idx-i').length, t:[...document.querySelectorAll('#presenter .amp-idx-i')].map(x=>x.textContent.replace(/\s+/g,' ').trim().slice(0,40)),
    rail:document.querySelectorAll('#presenter .amp-rail .amp-rs').length,
    exp:(()=>{ const vis=AMStudio.deck.slides.filter(s=>!s.hidden); const sc=AMRT.sectionsOf({slides:vis}); return {n:sc.list.length, sum:sc.list.reduce((a,x)=>a+((x.end!=null&&x.start!=null)?x.end-x.start+1:0),0)}; })() }));
  await p.screenshot({path:SH('04-f5-indice-1280x720')});
  await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Escape'); await sleep(400);
  check('S21-07: F5 pula os ocultos: 3 slides, contador “01 / 03” → “03 / 03”, conteúdo = capa, divisor, encerramento',
    f5[0].pos==='01 / 03'&&f5[1].pos==='02 / 03'&&f5[2].pos==='03 / 03'&&endPos==='03 / 03'&&f5[0].n===3 && /Título da/.test(f5[0].txt)&&/Nome do capítulo/.test(f5[1].txt)&&/Obrigado/.test(f5[2].txt), {f5,endPos});
  check('S21-08: índice (G) lista só os 3 visíveis; a linha do tempo segue os capítulos dos visíveis', idx.n===3 && !idx.t.some(t=>/Mensagem principal|Resultados que comprovam/.test(t)) && (idx.exp.n>=2? idx.rail===idx.exp.n : idx.rail===0), idx);
  const out1=await p.evaluate(()=>!document.querySelector('#presenter').classList.contains('open'));

  /* ---------- 5. Shift+F5 num slide oculto: começa no próximo visível ---------- */
  await clickThumb(1); await blank(); await p.keyboard.press('Shift+F5'); await sleep(900);
  const sf=await p.evaluate(()=>({pos:document.querySelector('#presenter .amp-pos').textContent.trim(), txt:document.querySelector('#presenter .amp-slide.on').textContent, toast:document.getElementById('toast').textContent}));
  await p.keyboard.press('Escape'); await sleep(400);
  /* último slide oculto: começa no anterior (player do runtime, igual no arquivo exportado) */
  const prevCase=await p.evaluate(()=>{ const d=JSON.parse(JSON.stringify(AMStudio.deck)); d.slides[4].hidden=true; const host=document.createElement('div'); host.style.cssText='position:fixed;left:-3000px;top:0;width:800px;height:500px'; document.body.appendChild(host);
    const pl=AMRT.player(d,host,{start:4,noHash:true}); const r={pos:host.querySelector('.amp-pos').textContent.trim(), map:pl.map, cur:pl.cur()}; pl.destroy(); host.remove(); return r; });
  check('S21-09: Shift+F5 num slide oculto começa no próximo visível (02 / 03 = divisor) e avisa; oculto no fim começa no anterior',
    out1 && sf.pos==='02 / 03' && /Nome do capítulo/.test(sf.txt) && /oculto/.test(sf.toast) && prevCase.pos==='02 / 02' && prevCase.map.join()==='0,2', {sf,prevCase});

  /* ---------- 6. todos ocultos: mostra todos e avisa ---------- */
  for(const i of [0,2,4]){ await clickThumb(i); await thumbCtx(i,'Ocultar slide'); }
  d=await D(); const allH=d.slides.every(s=>s.hidden===true);
  await blank(); await p.keyboard.press('F5'); await sleep(900);
  const ah=await p.evaluate(()=>({pos:document.querySelector('#presenter .amp-pos').textContent.trim(), toast:document.getElementById('toast').textContent, toastOn:document.getElementById('toast').classList.contains('show')}));
  await p.screenshot({path:SH('05-todos-ocultos-1280x720')});
  await p.keyboard.press('Escape'); await sleep(400);
  check('S21-10: todos ocultos → F5 mostra os 5 e o editor avisa “Todos os slides estão ocultos — mostrando todos”', allH && ah.pos==='01 / 05' && ah.toast==='Todos os slides estão ocultos — mostrando todos' && ah.toastOn, ah);
  await blank(); for(let i=0;i<3;i++){ await p.keyboard.press('Control+z'); await sleep(200); }
  d=await D(); check('S21-11: 3× Ctrl+Z desfaz os 3 ocultamentos (um passo cada): voltam ocultos só os slides 2 e 4', d.slides.map(s=>!!s.hidden).join()==='false,true,false,true,false', d.slides.map(s=>!!s.hidden));

  /* ---------- 7. arquivo exportado e reabrir ---------- */
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const fx=path.join(__dirname,'saved-s21.html'); fs.writeFileSync(fx,html);
  const q=await open(ctx,'file://'+fx,'exp');
  const x1=await q.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent.trim(), n:document.querySelectorAll('.amp-slide').length, data:JSON.parse(document.getElementById('am-deck-data').textContent).slides.map(s=>!!s.hidden)}));
  await q.keyboard.press('End'); await sleep(500); const x2=await q.evaluate(()=>({pos:document.querySelector('.amp-pos').textContent.trim(), t:document.querySelector('.amp-slide.on').textContent}));
  await q.keyboard.press('g'); await sleep(400); const x3=await q.evaluate(()=>document.querySelectorAll('.amp-idx-i').length);
  await q.screenshot({path:SH('06-exportado-indice-1280x720')}); await q.close();
  check('S21-12: arquivo exportado: player com 3 slides (01 / 03 … 03 / 03 = encerramento), índice com 3; os 5 slides ficam no arquivo (2 ocultos)',
    x1.pos==='01 / 03'&&x1.n===3&&x1.data.join()==='false,true,false,true,false'&&x2.pos==='03 / 03'&&/Obrigado/.test(x2.t)&&x3===3, {x1,x2,x3});
  const ro=await p.evaluate(h=>{ const doc=new DOMParser().parseFromString(h,'text/html'); const dd=JSON.parse(doc.getElementById('am-deck-data').textContent); AMStudio.loadDeck(dd,'reaberto');
    const s=AMStudio.deck.slides; return {h:s.map(x=>!!x.hidden), base:s.every(x=>x.base&&Object.keys(x.base.els).length===x.els.length), lay:s.map(x=>x.layout).join(), thumbs:document.querySelectorAll('#thumbs .th.hid').length}; }, html);
  const ro2=await p.evaluate(()=>{ AMStudio.loadDeck(JSON.parse(JSON.stringify(AMStudio.deck))); return AMStudio.deck.slides.map(x=>!!x.hidden).join(); });
  check('S21-13: reabrir (arquivo salvo e loadDeck do JSON) mantém ocultos, base, ph e layout', ro.h.join()==='false,true,false,true,false'&&ro.base&&ro.lay==='cover,content,section,kpis,closing'&&ro.thumbs===2&&ro2==='false,true,false,true,false', {ro,ro2});
  check('S21-14: exportado sem onerror/onmouseover/onclick (CR-04)', !/onerror|onmouseover|onclick/i.test(html));

  /* ---------- 8. Redefinir slide num slide “Título e conteúdo” ---------- */
  await clickThumb(1); await blank();
  d=await D(); const s1=d.slides[1], E0=s1.els.map(e=>JSON.parse(JSON.stringify(e)));
  const byPh=ph=>s1.els.find(e=>e.ph===ph);
  const eyb=byPh('p0'), logo=byPh('p1'), tit=byPh('p2'), sub=byPh('p3');
  /* mover o título com o mouse */
  let c=await elC(tit.id); await p.mouse.move(c.x,c.y); await p.mouse.down(); await p.mouse.move(c.x,c.y+90,{steps:6}); await p.mouse.up(); await sleep(250);
  /* redimensionar pela alça inferior direita */
  const hd=await p.$('#sel .hdl[data-h="se"]'); const hb=await hd.boundingBox(); await p.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2); await p.mouse.down(); await p.mouse.move(hb.x-120,hb.y+30,{steps:5}); await p.mouse.up(); await sleep(250);
  /* girar (Alt+→), recolorir (amostra laranja) */
  await p.keyboard.press('Alt+ArrowRight'); await sleep(450);
  await p.click('#props .sw button[data-set="color"][data-v="#F78C16"]'); await sleep(250);
  /* editar o texto do título */
  { const tx=await (await p.$('#wrap .am-stage .am-el[data-id="'+tit.id+'"] .am-tx')).boundingBox(); await p.mouse.dblclick(tx.x+tx.width/2,tx.y+tx.height/2); } await sleep(300); await p.keyboard.press('Control+a'); await p.keyboard.type('Novo título curto'); await sleep(150); await p.keyboard.press('Escape'); await sleep(300);
  /* espelhar o logotipo (barra do quadro) */
  await pickEl(logo.id); await p.click('#frBar [data-fr="flip-h"]'); await sleep(250);
  /* subtítulo: fonte maior pelo painel */
  await pickEl(sub.id); await p.fill('#props input[data-p="size"]','26'); await p.press('#props input[data-p="size"]','Enter'); await sleep(250);
  /* apagar o rótulo (p0) */
  await pickEl(eyb.id); await p.keyboard.press('Delete'); await sleep(250);
  /* elemento do usuário: seta da faixa */
  await p.click('[data-add=arrow]'); await sleep(300);
  /* fundo do slide */
  await blank(); await p.click('#props .sw button[data-set="s.bg"][data-v="#EBEEF1"]'); await sleep(250);
  const before=await D(); const b1=before.slides[1]; const tB=b1.els.find(e=>e.ph==='p2'), lB=b1.els.find(e=>e.ph==='p1'), arrow=b1.els.find(e=>e.type==='line'&&!e.ph);
  const edited=tB.y!==tit.y&&tB.w!==tit.w&&tB.rot===15&&/F78C16/i.test(tB.color)&&/Novo título curto/.test(tB.html)&&lB.flipH===true&&b1.els.find(e=>e.ph==='p3').size===26&&!b1.els.some(e=>e.ph==='p0')&&!!arrow&&b1.bg==='#EBEEF1';
  await p.screenshot({path:SH('07-antes-de-redefinir-1280x720')});
  const cr=await thumbCtx(1,'Redefinir slide');
  const after=await D(); const a1=after.slides[1]; const tA=a1.els.find(e=>e.ph==='p2'), lA=a1.els.find(e=>e.ph==='p1'), sA=a1.els.find(e=>e.ph==='p3'), eA=a1.els.find(e=>e.ph==='p0'), arA=a1.els.find(e=>e.id===arrow.id);
  const toastR=await p.evaluate(()=>document.getElementById('toast').textContent);
  await p.screenshot({path:SH('08-depois-de-redefinir-1280x720')});
  check('S21-15: preparo — título movido, redimensionado, girado 15°, laranja e com texto novo; logo espelhado; subtítulo 26; rótulo apagado; seta do usuário; fundo gelo', edited, {tB, lB:{flipH:lB.flipH}, bg:b1.bg});
  check('S21-16: miniatura › “Redefinir slide”: título volta a x/y/w/h, sem giro, cor original, MANTÉM “Novo título curto”; logo sem espelho; subtítulo 18; fundo branco',
    cr===1 && tA.x===tit.x&&tA.y===tit.y&&tA.w===tit.w&&tA.h===tit.h&&tA.rot===undefined&&tA.color===tit.color&&/Novo título curto/.test(tA.html)&&!/Mensagem principal/.test(tA.html)
    && lA.flipH===undefined&&lA.x===logo.x&&lA.w===logo.w && sA.size===sub.size && a1.bg==='#FFFFFF', {tA:[tA.x,tA.y,tA.w,tA.h,tA.rot,tA.color,tA.html], lA:lA.flipH, sA:sA.size, bg:a1.bg});
  check('S21-17: rótulo apagado volta do layout (texto original, posição original, embaixo na pilha); a seta do usuário fica igual; aviso de Ctrl+Z',
    !!eA && eA.html===eyb.html && eA.x===eyb.x && eA.y===eyb.y && a1.els.indexOf(eA)===0 && arA && arA.x1===arrow.x1&&arA.y1===arrow.y1&&arA.x2===arrow.x2 && a1.els.length===b1.els.length+1
    && /^Slide redefinido: posições e formatos originais, textos mantidos/.test(toastR) && /Ctrl\+Z desfaz/.test(toastR), {eA:eA&&[eA.html,eA.x,eA.y], idx:eA&&a1.els.indexOf(eA), arA:!!arA, n:[a1.els.length,b1.els.length], toastR});
  await blank(); await p.keyboard.press('Control+z'); await sleep(300);
  const un=await D(); const uT=un.slides[1].els.find(e=>e.ph==='p2');
  await p.keyboard.press('Control+y'); await sleep(300); const re=await D();
  check('S21-18: Ctrl+Z desfaz o Redefinir em um passo (título girado/laranja de novo, rótulo some, fundo gelo); Ctrl+Y refaz',
    JSON.stringify(un.slides[1])===JSON.stringify(b1) && uT.rot===15 && JSON.stringify(re.slides[1])===JSON.stringify(a1), {u:[uT.rot, un.slides[1].bg]});
  /* menu Slide e botão do painel também redefinem */
  await pickEl(tA.id); await p.keyboard.press('Shift+ArrowDown'); await p.keyboard.press('Shift+ArrowDown'); await sleep(600);
  const cm=await menu('slide','Redefinir slide'); const m1=(await D()).slides[1].els.find(e=>e.ph==='p2');
  await pickEl(tA.id); await p.keyboard.press('Alt+ArrowLeft'); await sleep(450); await blank();
  await p.click('#props [data-act=slreset]'); await sleep(300); const m2=(await D()).slides[1].els.find(e=>e.ph==='p2');
  check('S21-19: menu Slide › “Redefinir slide” e o botão do painel também restauram (setas Shift e Alt+←)', cm===1 && m1.y===tit.y && m2.rot===undefined && m2.y===tit.y, {m1:[m1.y], m2:[m2.rot,m2.y]});

  /* ---------- 9. duplicar / copiar-colar slide e elemento ---------- */
  await clickThumb(1); await thumbCtx(1,'Duplicar slide');
  d=await D(); const dup=d.slides[2], org=d.slides[1];
  const dupOk=dup.base&&JSON.stringify(dup.base)===JSON.stringify(org.base)&&dup.layout==='content'&&dup.hidden===true&&dup.els.map(e=>e.ph).join()===org.els.map(e=>e.ph).join()&&dup.els.every((e,i)=>e.id!==org.els[i].id)&&dup.id!==org.id;
  /* no duplicado: Ctrl+D num original gera cópia sem ph; Redefinir não mexe na cópia */
  const tD=dup.els.find(e=>e.ph==='p2'); await pickEl(tD.id); await p.keyboard.press('Control+d'); await sleep(300);
  let dd=await D(); const copyEl=dd.slides[2].els[dd.slides[2].els.length-1];
  { await p.keyboard.press('Escape'); const tb=await elBox(tD.id); await p.mouse.click(tb.x+12,tb.y+6); await sleep(220); } await p.keyboard.press('Shift+ArrowRight'); /* canto de cima: a cópia (+24) está por cima do centro */ await sleep(600);
  await menu('slide','Redefinir slide'); dd=await D(); const copyAfter=dd.slides[2].els.find(e=>e.id===copyEl.id), tD2=dd.slides[2].els.find(e=>e.ph==='p2');
  /* copiar / colar slide pelo teclado (miniatura em foco) */
  await clickThumb(2); await p.keyboard.press('Control+c'); await sleep(200); await p.keyboard.press('Control+v'); await sleep(400);
  const pd=await D(); const pst=pd.slides[3];
  check('S21-20: duplicar slide mantém base, layout, ph e oculto (ids novos); Ctrl+D num original cria cópia sem ph, que o Redefinir não toca; copiar/colar slide mantém a base',
    dupOk && copyEl.ph===undefined && copyAfter && copyAfter.x===copyEl.x && tD2.x===tit.x && pst.base && JSON.stringify(pst.base)===JSON.stringify(org.base) && pst.els.filter(e=>e.ph).length===org.els.filter(e=>e.ph).length && pst.els.filter(e=>e.ph).length===5 && pst.layout==='content', {dupOk, copyPh:copyEl.ph, copy:[copyAfter&&copyAfter.x, copyEl.x], tD2:[tD2.x, tit.x], pst:{base:!!pst.base, eq:JSON.stringify(pst.base)===JSON.stringify(org.base), ph:pst.els.filter(e=>e.ph).length, lay:pst.layout}, n:pd.slides.length});

  /* ---------- 10. projeto pronto da capa ---------- */
  await p.click('#bHome'); await sleep(900); await p.keyboard.press('2'); await sleep(600); await p.keyboard.press('1'); await sleep(400);
  if(await p.evaluate(()=>!document.getElementById('cvConfirm').hidden)) { await p.click('#cvCfOk'); }
  await sleep(1200);
  d=await D(); const tpl=d.slides.map(s=>({b:!!s.base, n:s.els.length, ph:s.els.every((e,i)=>e.ph==='p'+i), lay:s.layout}));
  await clickThumb(1); await blank();
  d=await D(); const ts=d.slides[1], tq=ts.els.find(e=>e.type==='fx')||ts.els[ts.els.length-1];
  await pickEl(tq.id);
  const tq0=JSON.parse(JSON.stringify(tq)); await p.keyboard.press('Shift+ArrowLeft'); await p.keyboard.press('Shift+ArrowUp'); await sleep(600); await p.keyboard.press('Alt+ArrowRight'); await sleep(450);
  const tdel=ts.els.find(e=>e.type==='text'&&e.id!==tq.id); await pickEl(tdel.id); await p.keyboard.press('Delete'); await sleep(250);
  await thumbCtx(1,'Redefinir slide');
  d=await D(); const tq1=d.slides[1].els.find(e=>e.id===tq.id);
  const tback=d.slides[1].els.find(e=>e.ph===tdel.ph); /* revisão S21: sem layout, o texto apagado volta da cópia guardada em base.tpl (mesmo ph, mesmo texto) */
  check('S21-21: projeto pronto (capa › Projetos prontos › 1): todos os slides ganham base e ph ao abrir; Redefinir volta a posição/giro do componente; sem layout, o texto apagado volta da cópia guardada',
    d.slides.length===7 && tpl.every(s=>s.b&&s.ph&&s.lay===undefined) && tq1.x===tq0.x&&tq1.y===tq0.y&&tq1.rot===undefined && !!tback && tback.type==='text' && tback.html===tdel.html && d.slides[1].els.filter(e=>e.ph===tdel.ph).length===1, {tpl:tpl.length, tq:[tq0.x,tq0.y,tq1.x,tq1.y,tq1.rot], back:!!tback});

  /* ---------- 11. deck feito à mão sem base / base hostil ---------- */
  const hm=await p.evaluate(()=>{
    AMStudio.loadDeck({title:'à mão', slides:[{id:'s1', bg:'#002A46', els:[{id:'a',type:'text',x:10,y:20,w:300,h:60,html:'Oi',size:30,color:'#FFFFFF'},{id:'b',type:'shape',shape:'rect',x:400,y:200,w:200,h:100,fill:'#F78C16',ph:'p9'}]}]});
    const s=AMStudio.deck.slides[0]; AMStudio.renderAll(); const btn=document.querySelector('#props [data-act=slreset]');
    return {base:!!s.base, ph:s.els.map(e=>e.ph).join(), keys:Object.keys(s.base.els).join(), bg:s.base.bg, en:btn&&!btn.disabled, title:btn&&btn.title, snap:s.base.els.p0}; });
  await p.click('#props [data-act=slreset]'); await sleep(250);
  const nb=await p.evaluate(()=>{ delete AMStudio.deck.slides[0].base; AMStudio.renderAll(); const btn=document.querySelector('#props [data-act=slreset]'); return {dis:btn.disabled, title:btn.title}; });
  const nbm=(await menuLabels('slide')).find(x=>x.t==='Redefinir slide');
  check('S21-22: deck sem base aberto por loadDeck ganha base/ph na hora (o ph solto “p9” é refeito); botão ativo; sem base o botão e o menu ficam desativados com explicação',
    hm.base&&hm.ph==='p0,p1'&&hm.keys==='p0,p1'&&hm.bg==='#002A46'&&hm.en&&hm.snap.x===10&&hm.snap.size===30&&!('html' in hm.snap) && nb.dis && /não tem posições originais/.test(nb.title) && nbm && nbm.dis && /não tem posições originais/.test(nbm.tip), {hm,nb,nbm});
  const hs=await p.evaluate(()=>{
    const big={}; for(let i=0;i<300;i++) big['p'+i]={x:i}; big.__proto__x={x:1}; big.p0={x:'1e999', y:-1e9, w:2, size:'x', color:'url(javascript:1)', font:'<b>', rot:270, flipH:'yes', look:'evil', pal:{p:'#12345', a:'#abcdef', z:1}, cols:['#ff0000','bad'], html:'<img>', src:'data:x'};
    AMStudio.loadDeck({title:'hostil', slides:[{id:'s1', bg:'#FFFFFF', hidden:'yes', layout:'__proto__', base:{bg:'javascript:1', bgImgOp:9, els:big}, els:[{id:'a',type:'text',x:0,y:0,w:100,h:40,html:'x',ph:'p0'},{id:'b',type:'text',x:0,y:0,w:100,h:40,html:'y',ph:'p0'},{id:'c',type:'text',x:0,y:0,w:100,h:40,html:'z',ph:'p500'},{id:'d',type:'text',x:0,y:0,w:100,h:40,html:'w',ph:'<x>'}]}]});
    const s=AMStudio.deck.slides[0], b=s.base, p0=b.els.p0; return {hidden:s.hidden, layout:s.layout, n:Object.keys(b.els).length, bg:b.bg, op:b.bgImgOp, p0, ph:s.els.map(e=>e.ph===undefined?'-':e.ph).join()}; });
  check('S21-23: base hostil normalizada: ≤ 200 registros, números finitos e limitados, cor/fonte/estilo inválidos fora, giro 270→−90, pal/cols só #rrggbb, sem html/src; ph repetido ou fora da base sai; hidden só true; layout desconhecido sai',
    hs.hidden===undefined&&hs.layout===undefined&&hs.n===200&&hs.bg==='#FFFFFF'&&hs.op===1&&hs.p0.x===undefined&&hs.p0.y===-10000&&hs.p0.w===8&&hs.p0.size===undefined&&hs.p0.color===undefined&&hs.p0.font===undefined&&hs.p0.rot===-90&&hs.p0.flipH===undefined&&hs.p0.look===undefined
    &&JSON.stringify(hs.p0.pal)==='{"a":"#ABCDEF"}'&&JSON.stringify(hs.p0.cols)==='["#FF0000"]'&&!('html' in hs.p0)&&!('src' in hs.p0)&&hs.ph==='p0,-,-,-', hs);

  /* ---------- 12. tamanho do arquivo: 30 slides ---------- */
  const sz=await p.evaluate(()=>{
    const ks=Object.keys(AMStudio.LAYOUTS), d={title:'30 slides', slides:[]}; for(let i=0;i<30;i++) d.slides.push(AMStudio.mk.slide(ks[i%ks.length]));
    const T=(AMCover.templates||[]);
    const strip=x=>{ const c=JSON.parse(JSON.stringify(x)); c.slides.forEach(s=>{ delete s.base; delete s.layout; s.els.forEach(e=>delete e.ph); }); return c; };
    const a=AMStudio.exportDeck(d).length, b0=AMStudio.exportDeck(strip(d)).length;
    const ja=JSON.stringify(d).length, jb=JSON.stringify(strip(d)).length;
    return {a, b0, pct:(a-b0)/b0*100, json:(ja-jb)/jb*100}; });
  check('S21-24: arquivo de 30 slides: a base aumenta o .html em menos de 15%', sz.pct<15, sz);

  /* ---------- 13. layout: sem transbordar a faixa a 1280, painel e capturas a 1440×900 ---------- */
  await p.evaluate(()=>{ const d=AMStudio.newDeck(); d.slides=['cover','content','kpis','closing'].map(k=>AMStudio.mk.slide(k)); d.slides[1].hidden=true; AMStudio.loadDeck(d); });
  await clickThumb(1); await blank();
  const lay=await p.evaluate(()=>{ const r=document.getElementById('rib'), t=document.getElementById('top'), sv=document.getElementById('bSave').getBoundingClientRect(), sec=document.getElementById('secShow').getBoundingClientRect(), ban=document.getElementById('hidBan').getBoundingClientRect(), wr=document.getElementById('wrap').getBoundingClientRect();
    return {rib:r.scrollWidth<=r.clientWidth, top:t.scrollWidth<=t.clientWidth, save:sv.right<=innerWidth, secTop:Math.round(sec.top), banAbove:ban.bottom<=wr.top+1&&ban.top>=0}; });
  await p.screenshot({path:SH('09-painel-oculto-1280x720')});
  await p.setViewportSize({width:1440,height:900}); await sleep(500);
  await p.screenshot({path:SH('10-painel-oculto-1440x900')});
  const bb=await thumb(1); await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2,{button:'right'}); await sleep(250); await p.screenshot({path:SH('11-menu-miniatura-1440x900')}); await p.keyboard.press('Escape');
  await p.click('#mbar [data-m="slide"]'); await sleep(250); await p.screenshot({path:SH('12-menu-slide-1440x900')}); await p.keyboard.press('Escape'); await sleep(150);
  check('S21-25: 1280×720 sem transbordar faixa/topo, #bSave visível; faixa “Slide oculto” acima do slide', lay.rib&&lay.top&&lay.save&&lay.banAbove, lay);

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); try{ fs.unlinkSync(fx); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
