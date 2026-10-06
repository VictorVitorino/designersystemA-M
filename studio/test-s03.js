/* test-s03: Ícones animados — Icon Motion (item 3). rt-20-icons.js/.css (54 ícones em 8 temas, 7 transformações, 17 movimentos
   como variantes, 8 gatilhos, desenho traço a traço, bindIcons no player, movimento reduzido), seletor “Ícones ▾” (busca sem
   acento, temas, grade de 6 colunas, prévia ao passar o mouse, teclado, inserir ou trocar, arrastar), Inserir › Ícone animado ▸,
   painel (Conteúdo antes do movimento, grade de ícones, velocidade do traço), vitrine de efeitos (família “Ícones”, provador no
   ícone selecionado), faixa consolidada (Seta + ▾, Ícones, edição só com ícone) sem estouro de 1280 a 1920, export e player.
   Uso: python3 assemble.py && node test-s03.js   (o qa-gate.sh pega qualquer test-s[0-9][0-9]*.js) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s03-'+f+'.png');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'canteiro-s03-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined&&!ok?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function page(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(wait||800); return p; }
const els=p=>p.evaluate(()=>AMStudio.deck.slides[AMStudio.cur].els.map(e=>({id:e.id,type:e.type,kind:e.kind,variant:e.variant,x:e.x,y:e.y,w:e.w,h:e.h,data:e.data,anim:e.anim,hs:e.headStart,he:e.headEnd})));
const last=async p=>{ const e=await els(p); return e[e.length-1]; };
const clip=(p,sel,pad)=>p.evaluate(([s,d])=>{ const r=document.querySelector(s).getBoundingClientRect(); return {x:Math.max(0,r.x-d),y:Math.max(0,r.y-d),width:Math.min(innerWidth,r.width+d*2),height:Math.min(innerHeight,r.height+d*2)}; },[sel,pad||8]);
const picker=p=>p.evaluate(()=>{ const m=document.getElementById('icMenu'); return {open:m.classList.contains('open'), tiles:[...m.querySelectorAll('.ict')].map(t=>t.dataset.ic||('m:'+t.dataset.mp)), act:document.activeElement&&(document.activeElement.id||document.activeElement.dataset.ic||document.activeElement.className), q:(document.getElementById('icQ')||{}).value, ft:(document.getElementById('icFt')||{}).textContent}; });
const fresh=p=>p.evaluate(()=>{ AMStudio.closeMenus(); AMStudio.loadDeck(AMStudio.newDeck(),null,true,true); });
async function openMenu(p,k){ await p.click('#mbar [data-m='+k+']'); await sleep(220); }
async function subItem(p,parent,label){ const pi=p.locator('.xmenu .xi',{hasText:parent}).first(); await pi.hover(); await sleep(260); const it=p.locator('.xmenu',{has:p.locator('.xi',{hasText:label})}).last().locator('.xi',{hasText:label}).first(); await it.hover(); await sleep(120); await it.click(); await sleep(250); }

(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await page(ctx, FILE+'?nocover', 'ed');

  /* ===================== 1. acervo no runtime (rt-20-icons.js) ===================== */
  const inv=await p.evaluate(()=>{ const R=AMRT, I=R.ICONS, g={}; I.forEach(i=>g[i.g]=(g[i.g]||0)+1);
    const div=h=>{ const d=document.createElement('div'); d.innerHTML=h; return d; };
    const render=I.map(i=>{ const d=div(R.FX.icon.html({name:i.k},120,120,{variant:'auto',anim:{in:'draw'}})); return {k:i.k, n:d.querySelectorAll('.ic-s').length, vb:d.querySelector('svg.ic').getAttribute('viewBox'), ax:d.querySelectorAll('.ic-ax').length===(i.a?(i.a.match(/<\w+/g)||[]).length:0)}; });
    const morphOk=R.ICON_MORPHS.every(m=>{ const d=div(R.FX.iconmorph.html({pair:m[0]},120,120,{variant:'loop'})); return d.querySelectorAll('.ic-sa .ic-s').length>0&&d.querySelectorAll('.ic-sb .ic-s').length>0; });
    return {n:I.length, uniq:new Set(I.map(i=>i.k)).size, groups:R.ICON_GROUPS.length, perG:R.ICON_GROUPS.map(x=>g[x[0]]||0), motions:Object.keys(R.IC_MO).length, trigs:R.IC_TRIGS.map(t=>t[0]),
      vars:R.FX.icon.variants.map(v=>v[0]), mv:R.FX.iconmorph.variants.map(v=>v[0]), cat:[R.FX.icon.cat,R.FX.iconmorph.cat], model:[!!R.FX.icon.model,!!R.FX.iconmorph.model],
      badDef:I.filter(i=>!R.IC_MO[i.m.split(':')[0]]).map(i=>i.k), bad:render.filter(r=>!r.n||r.vb!=='0 0 24 24'||!r.ax).map(r=>r.k), morphs:R.ICON_MORPHS.length, morphOk,
      kf:[...document.styleSheets].flatMap(s=>{ try{ return [...s.cssRules]; }catch(e){ return []; } }).filter(r=>r.type===7&&/^ic[A-Z]/.test(r.name)).map(r=>r.name) }; });
  check('S03-01: acervo com 54 ícones (chaves únicas) em 8 temas, 7 transformações, 17 movimentos e 8 gatilhos', inv.n===54&&inv.uniq===54&&inv.groups===8&&inv.perG.every(n=>n>=5)&&inv.morphs===7&&inv.motions===17&&inv.trigs.join()==='in-hover,in-loop,in,loop,loop-hover,hover,click,boomerang', inv);
  check('S03-02: FX.icon e FX.iconmorph em “Ícones animados” (fora dos Modelos); movimentos = variantes (Padrão do ícone + 17); transformação: sozinha / ao clicar', inv.cat.every(c=>c==='Ícones animados')&&!inv.model[0]&&!inv.model[1]&&inv.vars.length===18&&inv.vars[0]==='auto'&&inv.mv.join()==='loop,click', inv);
  check('S03-03: todo ícone desenha (viewBox 24, traços .ic-s, detalhe .ic-ax) com movimento padrão válido; transformações têm os dois estados; keyframes com prefixo ic*', inv.bad.length===0&&inv.badDef.length===0&&inv.morphOk&&inv.kf.length>=19&&inv.kf.includes('icDraw'), {bad:inv.bad,badDef:inv.badDef,kf:inv.kf.length});
  const sf=await p.evaluate(()=>{ const d=document.createElement('div');
    d.innerHTML=AMRT.FX.icon.html({name:'constructor', label:'<img src=x>', color:'red;background:url(x)', accent:'#F78C16"><b>', bg:'"x', stroke:'9;', trig:'x" y="'},120,120,{variant:'nada',anim:{}});
    const f=d.firstChild; return {inj:!!d.querySelector('img,b'), lab:d.querySelector('.ic-l').textContent, ic:f.style.getPropertyValue('--ic'), ia:f.style.getPropertyValue('--ia'), pl:f.dataset.pl, sw:f.style.getPropertyValue('--sw'), mo:f.dataset.mo, tr:f.dataset.tr}; });
  check('S03-04: dados hostis não injetam nada: legenda escapada, cor/fundo/espessura/gatilho fora da lista voltam ao padrão, chave desconhecida = primeiro ícone', !sf.inj&&sf.lab==='<img src=x>'&&sf.ic==='#002A46'&&sf.ia==='#F78C16'&&sf.pl==='none'&&sf.sw==='1.85'&&sf.mo==='nudge'&&sf.tr==='in-hover', sf);
  const pl=await p.evaluate(()=>{ const mk=d=>{ const x=document.createElement('div'); x.className='am-stage am-edit'; x.style.cssText='position:fixed;left:0;top:0;width:640px'; x.innerHTML='<div class="am-el" style="left:0;top:0;width:20%;height:30%">'+AMRT.FX.icon.html(Object.assign({name:'gear',label:'Engrenagem'},d),120,120,{anim:{}})+'</div>'; document.body.appendChild(x); const r=[getComputedStyle(x.querySelector('.ic')).stroke, getComputedStyle(x.querySelector('.ic-l')).color]; x.remove(); return r; };
    return {iceW:mk({bg:'circle',color:'#FFFFFF'}), navy:mk({bg:'navy',color:'#002A46'}), plain:mk({bg:'none',color:'#FFFFFF'})}; });
  check('S03-05: placas legíveis: traço branco sobre placa gelo vira navy (legenda mantém a cor); placa navy força traço branco e a legenda segue navy', pl.iceW[0]==='rgb(0, 42, 70)'&&pl.iceW[1]==='rgb(255, 255, 255)'&&pl.navy[0]==='rgb(255, 255, 255)'&&pl.navy[1]==='rgb(0, 42, 70)'&&pl.plain[0]==='rgb(255, 255, 255)', pl);
  const opened=await p.evaluate(()=>{ AMStudio.loadDeck({title:'t',slides:[{els:[{id:'h1',type:'fx',kind:'icon',x:10,y:10,w:120,h:120,variant:'zzz',data:{name:'x" onmouseover="y',trig:'<b>',color:'url(x)',bg:'none',accent:'#F78C16',label:'ok'}}]}]},null,true,true);
    const e=AMStudio.deck.slides[0].els[0]; return {name:'name' in e.data, trig:'trig' in e.data, color:'color' in e.data, variant:'variant' in e, lab:e.data.label, html:document.querySelector('#wrap .am-el[data-id=h1] .fxic').outerHTML.indexOf('onmouseover')<0}; });
  check('S03-06: arquivo aberto com dados de ícone inválidos: valores fora do padrão são descartados (DATA_TOKENS/variantes) e o ícone desenha o padrão', !opened.name&&!opened.trig&&!opened.color&&!opened.variant&&opened.lab==='ok'&&opened.html, opened);
  await fresh(p);

  /* ===================== 2. faixa de ferramentas consolidada ===================== */
  const ribW={};
  for (const [w,h] of [[1280,720],[1366,768],[1440,900],[1536,864],[1600,900],[1700,900],[1920,1080]]) {
    await p.setViewportSize({width:w,height:h}); await sleep(250);
    ribW[w]=await p.evaluate(()=>{ const r=document.getElementById('rib'), t=document.getElementById('top'), bi=document.getElementById('bIcons').getBoundingClientRect(), sv=document.getElementById('bSave').getBoundingClientRect(); return r.scrollWidth<=r.clientWidth&&t.scrollWidth<=t.clientWidth&&bi.width>0&&bi.right<=innerWidth&&sv.right<=innerWidth; });
    if (w===1280) await p.screenshot({path:SH('01-faixa-1280'),clip:{x:0,y:0,width:1280,height:104}});
    if (w===1700) await p.screenshot({path:SH('01-faixa-1700'),clip:{x:0,y:0,width:1700,height:104}});
  }
  await p.setViewportSize({width:1280,height:720}); await sleep(250);
  const sel1280=await p.evaluate(()=>({ids:['bModels','bFx','bFront','bBack','bDup','bDel','bPreview','bNew','bSave','bPlay','bHome','title','bIcons'].every(i=>document.getElementById(i)), arrow:!!document.querySelector('#rib [data-add=arrow]'), mt:!!document.querySelector('[data-menu=mText]'), ms:!!document.querySelector('[data-menu=mShape]'),
    editIcon:['bFront','bBack','bDup','bDel'].every(i=>{ const b=document.getElementById(i); return b.getBoundingClientRect().width<=40&&!!b.title; }) }));
  check('S03-07: faixa sem estouro de 1280 a 1920 com “Ícones ▾”; seletores dos testes preservados; edição só com ícone (dica no title) até 1600', Object.values(ribW).every(Boolean)&&sel1280.ids&&sel1280.arrow&&sel1280.mt&&sel1280.ms&&sel1280.editIcon, {ribW,sel1280});
  const n0=(await els(p)).length; await p.click('#rib [data-add=arrow]'); await sleep(200); const ar=await last(p);
  await p.click('#rib [data-menu=mLine]'); await sleep(250); const ml=await p.evaluate(()=>[...document.querySelectorAll('#mLine button')].map(b=>b.textContent.trim()));
  await p.screenshot({path:SH('02-menu-linhas'),clip:{x:150,y:50,width:420,height:220}});
  await p.click('#mLine [data-line=double]'); await sleep(200); const db=await last(p); await p.click('#rib [data-menu=mLine]'); await sleep(200); await p.click('#mLine [data-line=line]'); await sleep(200); const ln=await last(p);
  check('S03-08: “Seta” insere seta e o ▾ abre Linhas e setas (Linha · Seta · Seta dupla), cada uma com as pontas certas', (await els(p)).length===n0+3&&ar.type==='line'&&ar.he&&!ar.hs&&ml.slice(0,3).join('|')==='Linha|Seta|Seta dupla'&&db.hs&&db.he&&ln.type==='line'&&!ln.hs&&!ln.he, {ar,ml,db,ln});
  await fresh(p);
  await p.setViewportSize({width:1440,height:900}); await sleep(300);

  /* ===================== 3. seletor “Ícones ▾” ===================== */
  await p.click('#bIcons'); await sleep(450);
  const po=await p.evaluate(()=>{ const m=document.getElementById('icMenu'), r=m.getBoundingClientRect(); return {menu:m.classList.contains('menu')&&m.classList.contains('open'), modal:document.getElementById('modal').classList.contains('open'), focus:document.activeElement&&document.activeElement.id, tiles:m.querySelectorAll('.ict[data-ic]').length, morph:m.querySelectorAll('.ict[data-mp]').length, chips:[...m.querySelectorAll('[data-icg]')].map(c=>c.dataset.icg), cols:getComputedStyle(document.getElementById('icGrid')).gridTemplateColumns.split(' ').length, rib:document.getElementById('bIcons').classList.contains('open'), view:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight, cut:[...m.querySelectorAll('.ict-n')].filter(x=>x.scrollHeight>x.clientHeight+1||x.scrollWidth>x.clientWidth+1).map(x=>x.textContent), heads:m.querySelectorAll('.icp-gh').length, ph:document.getElementById('icQ').placeholder}; });
  check('S03-09: “Ícones ▾” abre o seletor (popover, não o #modal) com a busca em foco, 54 ícones + 7 transformações por tema, 6 colunas, dentro da janela e nomes inteiros', po.menu&&!po.modal&&po.focus==='icQ'&&po.tiles===54&&po.morph===7&&po.chips.length===10&&po.chips[0]==='all'&&po.chips[9]==='morph'&&po.cols===6&&po.rib&&po.view&&po.cut.length===0&&po.heads===9&&/meta, risco, nuvem/.test(po.ph), po);
  await p.screenshot({path:SH('03-seletor'),clip:await clip(p,'#icMenu',12)});
  await p.click('#icMenu [data-icg=risco]'); await sleep(200); const cr=await p.evaluate(()=>{ const t=[...document.querySelectorAll('#icGrid .ict')]; return {n:t.length, ok:t.every(x=>x.dataset.ic&&AMRT.iconFind(x.dataset.ic).g==='risco'), heads:document.querySelectorAll('#icGrid .icp-gh').length, pr:document.querySelector('#icMenu [data-icg=risco]').getAttribute('aria-pressed')}; });
  await p.click('#icMenu [data-icg=morph]'); await sleep(200); const cm=await p.evaluate(()=>[...document.querySelectorAll('#icGrid .ict')].map(x=>x.dataset.mp||'-'));
  check('S03-10: chips de tema filtram (Risco & governança: 7 ícones, sem títulos de grupo; Transformações: os 7 pares)', cr.n===7&&cr.ok&&cr.heads===0&&cr.pr==='true'&&cm.length===7&&cm.every(x=>x!=='-'), {cr,cm});
  await p.hover('#icGrid .ict[data-mp=x-check]'); await sleep(650);
  const mh=await p.evaluate(()=>{ const f=document.querySelector('#icGrid .ict[data-mp=x-check] .fxic'); return {on:f.classList.contains('ic-on'), b:+getComputedStyle(f.querySelector('.ic-sb')).opacity, ft:document.getElementById('icFt').textContent}; });
  await p.screenshot({path:SH('04-seletor-transformacoes'),clip:await clip(p,'#icMenu',12)});
  check('S03-11: passar o mouse numa transformação mostra o estado B (prévia) e o rodapé diz o nome', mh.on&&mh.b>.9&&/Reprovado → aprovado/.test(mh.ft), mh);
  await p.click('#icMenu [data-icg=all]'); await sleep(150);
  const srch=async q=>{ await p.fill('#icQ',q); await sleep(180); return (await picker(p)).tiles; };
  const s1=await srch('SEGURANCA'), s2=await srch('dados banco'), s3=await srch('meta'), s4=await srch('zzqq'); const empty=await p.evaluate(()=>document.querySelector('#icGrid .icp-none')&&document.querySelector('#icGrid .icp-none').textContent);
  const s5=await srch('problema');
  check('S03-12: busca sem acento e sem caixa, todas as palavras (“SEGURANCA” → Segurança; “dados banco” → Banco de dados; “meta” → Alvo; transformações também), e aviso quando nada casa', s1.includes('shield')&&s2[0]==='database'&&s2.length<=2&&s3.includes('target')&&s4.length===0&&/Nenhum ícone encontrado/.test(empty||'')&&s5.includes('m:alert-check'), {s1,s2,s3,s4,empty,s5});
  await p.fill('#icQ',''); await sleep(150);
  await p.hover('#icGrid .ict[data-ic=gear]'); await sleep(500);
  const hv=await p.evaluate(()=>{ const f=document.querySelector('#icGrid .ict[data-ic=gear] .fxic'); return {go:f.classList.contains('ic-go'), a:[...f.querySelectorAll('.ic-mv')].flatMap(m=>m.getAnimations().map(x=>x.animationName+':'+x.playState)), ft:document.getElementById('icFt').textContent}; });
  await p.screenshot({path:SH('05-seletor-previa'),clip:await clip(p,'#icMenu',12)});
  check('S03-13: prévia ao passar o mouse: a peça toca o movimento do ícone uma vez (Engrenagem gira) e o rodapé mostra “Engrenagem · Girar”', hv.go&&hv.a.some(x=>/^icSpin:running/.test(x))&&/Engrenagem · Girar/.test(hv.ft), hv);
  /* teclado */
  await p.focus('#icQ'); await p.keyboard.press('ArrowDown'); await sleep(120); const k1=await picker(p);
  await p.keyboard.press('ArrowRight'); await sleep(120); const k2=await picker(p);
  const pos=()=>p.evaluate(()=>{ const r=document.activeElement.getBoundingClientRect(); return {k:document.activeElement.dataset.ic, top:Math.round(r.top), left:Math.round(r.left)}; });
  const r0=await pos(); await p.keyboard.press('ArrowDown'); await sleep(150); const r1=await pos(); await p.keyboard.press('ArrowUp'); await sleep(150); const r2=await pos();
  await p.keyboard.type('nuv'); await sleep(250); const k3=await picker(p);
  check('S03-14: teclado: ↓ da busca vai à grade, → anda uma peça, ↓/↑ trocam de linha na coluna mais próxima e digitar volta à busca com a letra', k1.act==='target'&&k2.act==='rocket'&&r1.top>r0.top&&r2.top===r0.top&&k3.act==='icQ'&&k3.q==='nuv'&&k3.tiles[0]==='cloud', {k1:k1.act,k2:k2.act,r0,r1,r2,k3:{act:k3.act,q:k3.q,t:k3.tiles}});
  const h0=await p.evaluate(()=>document.getElementById('bUndo').disabled);
  await p.keyboard.press('Enter'); await sleep(450);
  const ins=await last(p), pc=await picker(p), tst=await p.evaluate(()=>document.getElementById('toast').textContent), selIds=await p.evaluate(()=>AMStudio.selected());
  check('S03-15: Enter na busca insere o primeiro resultado (Nuvem) no centro, 120×120, “Desenhar”, ao entrar e ao passar o mouse, traço navy; seletor fecha e o novo ícone fica selecionado', !pc.open&&ins.kind==='icon'&&ins.data.name==='cloud'&&ins.x===580&&ins.y===300&&ins.w===120&&ins.h===120&&ins.anim.in==='draw'&&ins.anim.dur===900&&ins.data.trig==='in-hover'&&ins.data.color==='#002A46'&&ins.data.accent==='#F78C16'&&selIds[0]===ins.id&&/Nuvem/.test(tst)&&h0, {ins,tst,selIds});
  await sleep(500); const pv=await p.evaluate(()=>{ const o=document.querySelector('#wrap .prevov .fxic'); return o&&{tr:o.dataset.tr, mo:o.dataset.mo}; });
  check('S03-16: depois de inserir, a prévia no slide mostra o desenho e o movimento (sem esperar o mouse)', pv&&pv.tr==='in-loop'&&pv.mo==='nudge', pv);
  await p.keyboard.press('Control+z'); await sleep(250); const nU=(await els(p)).length; await p.keyboard.press('Control+Shift+z'); await sleep(250); const nR=(await els(p)).length;
  check('S03-17: inserir é um passo só de desfazer (Ctrl+Z tira, Ctrl+Shift+Z devolve)', nU===0&&nR===1, {nU,nR});
  /* trocar o ícone selecionado */
  const cid=(await last(p)).id; await p.evaluate(id=>AMStudio.select(id),cid); await sleep(150);
  await p.click('#bIcons'); await sleep(350);
  const sw=await p.evaluate(()=>({cur:[...document.querySelectorAll('#icGrid .ict.cur')].map(x=>x.dataset.ic), ft:document.getElementById('icFt').textContent}));
  await p.keyboard.type('abc'); await p.keyboard.press('Backspace'); await p.keyboard.press('Delete'); await sleep(150); const still=(await els(p)).length;
  await p.fill('#icQ',''); await sleep(120); await p.click('#icGrid .ict[data-ic=shield]'); await sleep(350);
  const swp=await els(p);
  check('S03-18: com um ícone selecionado o seletor marca o atual e troca o desenho (mesmo elemento, posição e gatilho); Delete/letras na busca não mexem no slide', sw.cur.join()==='cloud'&&/troca o selecionado/.test(sw.ft)&&still===1&&swp.length===1&&swp[0].id===cid&&swp[0].data.name==='shield'&&swp[0].x===580&&swp[0].data.trig==='in-hover', {sw,still,swp:swp.map(e=>[e.id,e.data.name])});
  await p.keyboard.press('Control+z'); await sleep(250); const und=await last(p);
  await p.click('#bIcons'); await sleep(300); await p.click('#icGrid .ict[data-ic=gear]',{modifiers:['Shift']}); await sleep(350); const shf=await els(p);
  check('S03-19: trocar é um passo de desfazer; Shift+clique insere um ícone novo em vez de trocar', und.data.name==='cloud'&&shf.length===2&&shf[0].data.name==='cloud'&&shf[1].data.name==='gear', {und:und.data.name, shf:shf.map(e=>e.data.name)});
  await p.click('#bIcons'); await sleep(300); await p.keyboard.press('Escape'); await sleep(150);
  const esc1=await p.evaluate(()=>({open:document.getElementById('icMenu').classList.contains('open'), f:document.activeElement&&document.activeElement.id, rib:document.getElementById('bIcons').classList.contains('open')}));
  await p.click('#bIcons'); await sleep(250); await p.click('#bIcons'); await sleep(200); const tog=await picker(p);
  check('S03-20: Esc fecha o seletor e devolve o foco a “Ícones”; clicar de novo no botão fecha', !esc1.open&&esc1.f==='bIcons'&&!esc1.rib&&!tog.open, {esc1,tog:tog.open});
  /* Tab circula dentro do seletor; Espaço num chip filtra; F1 fecha o seletor e abre os atalhos */
  await p.click('#bIcons'); await sleep(300); await p.keyboard.press('Tab'); await sleep(80); const t1=await p.evaluate(()=>document.activeElement.dataset.icg);
  await p.focus('#icQ'); await p.keyboard.press('Shift+Tab'); await sleep(80); const t2=await p.evaluate(()=>document.activeElement.classList.contains('ict'));
  await p.focus('#icMenu [data-icg=tempo]'); await p.keyboard.press('Space'); await sleep(200);
  const spc=await p.evaluate(()=>({g:(document.querySelector('#icMenu [data-icg].on')||{dataset:{}}).dataset.icg, q:document.getElementById('icQ').value, n:document.querySelectorAll('#icGrid .ict').length}));
  await p.keyboard.press('F1'); await sleep(450); const kf1=await p.evaluate(()=>({pick:document.getElementById('icMenu').classList.contains('open'), modal:document.getElementById('modal').classList.contains('open')}));
  await p.keyboard.press('Escape'); await sleep(250);
  check('S03-45: Tab circula no seletor (busca → temas; Shift+Tab → grade); Espaço num tema filtra sem pular para a busca; F1 fecha o seletor e abre os atalhos', t1==='all'&&t2&&spc.g==='tempo'&&spc.q===''&&spc.n===5&&!kf1.pick&&kf1.modal, {t1,t2,spc,kf1});
  /* arrastar uma peça para o slide */
  await p.click('#bIcons'); await sleep(300);
  await p.evaluate(()=>{ const src=document.querySelector('#icGrid .ict[data-ic=pin]'), dt=new DataTransfer(); src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    const w=document.getElementById('wrap'), r=w.getBoundingClientRect(), o={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.x+r.width*200/1280,clientY:r.y+r.height*200/720}; w.dispatchEvent(new DragEvent('dragover',o)); w.dispatchEvent(new DragEvent('drop',o)); });
  await sleep(300); const dr=await last(p);
  check('S03-21: arrastar uma peça do seletor para o slide insere aquele ícone onde foi solto', dr.data.name==='pin'&&Math.abs(dr.x-140)<=2&&Math.abs(dr.y-140)<=2, {n:dr.data.name,x:dr.x,y:dr.y});
  await p.evaluate(()=>AMStudio.closeMenus());
  /* slide escuro */
  await p.evaluate(()=>AMStudio.addSlide('blank-dark')); await sleep(250);
  await p.click('#bIcons'); await sleep(300); await p.keyboard.type('foguete'); await p.keyboard.press('Enter'); await sleep(400);
  const dk=await last(p), dkS=await p.evaluate(id=>{ const n=document.querySelector('#wrap .am-el[data-id="'+id+'"]'); return [getComputedStyle(n.querySelector('.ic')).stroke, getComputedStyle(n.querySelector('.ic-ax')).stroke]; },dk.id);
  check('S03-22: em slide escuro o ícone entra com traço branco e detalhe laranja', dk.data.name==='rocket'&&dk.data.color==='#FFFFFF'&&dk.data.accent==='#F78C16'&&dkS[0]==='rgb(255, 255, 255)'&&dkS[1]==='rgb(247, 140, 22)', {d:dk.data,dkS});
  await sleep(1200); await p.screenshot({path:SH('06-slide-escuro')});

  /* ===================== 4. Inserir › Ícone animado ▸ ===================== */
  await fresh(p);
  await openMenu(p,'insert');
  const im=await p.evaluate(()=>({forma:[...document.querySelectorAll('.xmenu .xi')].filter(x=>/forma/i.test(x.textContent)).length, first:[...document.querySelectorAll('.xmenu .xi .xl')].slice(0,3).map(x=>x.textContent), ic:[...document.querySelectorAll('.xmenu .xi .xl')].some(x=>x.textContent==='Ícone animado')}));
  await p.locator('.xmenu .xi',{hasText:'Ícone animado'}).first().hover(); await sleep(350);
  const sub=await p.evaluate(()=>{ const m=[...document.querySelectorAll('.xmenu')].pop(); return {t:[...m.querySelectorAll('.xi .xl')].map(x=>x.textContent), svg:m.querySelectorAll('.xi .xic svg.icx').length, forma:[...document.querySelectorAll('.xmenu .xi')].filter(x=>/forma/i.test(x.textContent)).length}; });
  await p.screenshot({path:SH('07-menu-inserir'),clip:{x:280,y:50,width:640,height:560}});
  check('S03-23: Inserir mantém Título/Subtítulo/Texto corrido no topo e um só item com “forma”; “Ícone animado ▸” traz os 8 favoritos (com o desenho) e “Ver todos os ícones…”', im.forma===1&&im.first.join('|')==='Título|Subtítulo em destaque|Texto corrido'&&im.ic&&sub.t.join('|')==='Alvo|Foguete|Gráfico em alta|Engrenagem|Equipe|Segurança|Prazo|Ideia|Ver todos os ícones…'&&sub.svg===8&&sub.forma===1, {im,sub});
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await sleep(150);
  await openMenu(p,'insert'); await subItem(p,'Ícone animado','Prazo'); const fv=await last(p);
  await openMenu(p,'insert'); await subItem(p,'Ícone animado','Ver todos os ícones'); const va=await picker(p);
  check('S03-24: favorito do menu insere o ícone (Prazo = relógio) e “Ver todos os ícones…” abre o seletor com a busca em foco', fv&&fv.data.name==='clock'&&va.open&&va.act==='icQ', {fv:fv&&fv.data.name,va:{open:va.open,act:va.act}});
  await p.keyboard.press('Escape'); await sleep(150);

  /* ===================== 5. painel e menu do efeito ===================== */
  await p.evaluate(()=>{ const s=AMStudio.deck.slides[AMStudio.cur]; AMStudio.select(s.els[0].id); }); await sleep(250);
  const pr=await p.evaluate(()=>{ const P=document.getElementById('props'); return {h3:[...P.querySelectorAll('.sec>h3')].map(h=>h.textContent), vars:P.querySelectorAll('[data-var]').length, on:(P.querySelector('[data-var].on')||{}).textContent, grid:P.querySelectorAll('.icf-g button').length, cur:(P.querySelector('.icf-g button.on')||{dataset:{}}).dataset.v, curVis:(()=>{ const g=P.querySelector('.icf-g'), o=g.querySelector('.on'), a=g.getBoundingClientRect(), c=o.getBoundingClientRect(); return c.top>=a.top&&c.bottom<=a.bottom; })(), trig:P.querySelectorAll('select[data-p="data.trig"] option').length, speed:[...P.querySelectorAll('[data-set="anim.dur"]')].map(b=>b.dataset.v+':'+b.textContent), flow:!!P.querySelector('[data-set="anim.loop"][data-v=flow]'), gal:!!P.querySelector('[data-act=gallery-icon]'), more:!!P.querySelector('[data-act=icons]'), head:P.querySelector('.ph h2').firstChild.textContent, pill:document.getElementById('fxArrow').textContent.trim()}; });
  check('S03-25: painel do ícone: Conteúdo (grade com os 54, o atual marcado e à vista) antes de “Movimento do ícone” (18 movimentos), 8 gatilhos, velocidade do traço Rápido/Normal/Lento, sem “Fluxo contínuo”; pílula “Movimento: Padrão do ícone”', pr.h3.indexOf('Conteúdo')>=0&&pr.h3.indexOf('Conteúdo')<pr.h3.indexOf('Movimento do ícone')&&pr.vars===18&&pr.on==='Padrão do ícone'&&pr.grid===54&&pr.cur==='clock'&&pr.curVis&&pr.trig===8&&pr.speed.join()==='500:Rápido,900:Normal,1600:Lento'&&!pr.flow&&pr.gal&&pr.more&&pr.head==='Ícone · Prazo'&&/^Movimento: Padrão do ícone/.test(pr.pill), pr);
  await p.screenshot({path:SH('08-painel')});
  await p.fill('#props .icf-q','relogio'); await sleep(150); const fq=await p.evaluate(()=>[...document.querySelectorAll('#props .icf-g button')].filter(b=>!b.hidden).map(b=>b.dataset.v));
  await p.fill('#props .icf-q','ampulheta'); await sleep(120); await p.click('#props .icf-g button[data-v=hourglass]'); await sleep(250);
  await p.click('#props [data-set="anim.dur"][data-v="1600"]'); await sleep(200); const pe=await last(p);
  check('S03-26: busca e clique na grade do painel trocam o ícone; “Lento” grava 1600 ms no traço', fq.includes('clock')&&fq.length<=3&&pe.data.name==='hourglass'&&pe.anim.dur===1600, {fq,n:pe.data.name,dur:pe.anim.dur});
  await p.selectOption('#props select[data-p="anim.in"]','fade'); await sleep(150); await p.selectOption('#props select[data-p="anim.in"]','draw'); await sleep(150);
  const dw=await p.evaluate(()=>({t:document.getElementById('toast').textContent, a:AMStudio.deck.slides[AMStudio.cur].els[0].anim.in}));
  check('S03-27: “Desenhar” vale para ícones (canDraw): escolher não avisa nem troca para Revelar', dw.a==='draw'&&!/funciona em/.test(dw.t), dw);
  await p.click('#fxArrow'); await sleep(250); const mv=await p.evaluate(()=>({n:document.querySelectorAll('#mVar .vo').length, t:document.querySelector('#mVar .vh b').textContent}));
  await p.click('#mVar .vo[data-v=spin]'); await sleep(300);
  const sp=await p.evaluate(()=>{ const e=AMStudio.deck.slides[AMStudio.cur].els[0], o=document.querySelector('#wrap .prevov .fxic'); return {v:e.variant, pv:o&&o.dataset.mo, tr:o&&o.dataset.tr, real:e.data.trig, pill:document.getElementById('fxArrow').textContent.trim()}; });
  check('S03-28: menu do efeito lista os 18 movimentos; escolher “Girar” grava a variante e a prévia gira (gatilho só na prévia)', mv.n===18&&/Ícone animado/.test(mv.t)&&sp.v==='spin'&&sp.pv==='spin'&&sp.tr==='in-loop'&&sp.real==='in-hover'&&/^Movimento: Girar/.test(sp.pill), {mv,sp});

  /* ===================== 6. vitrine de efeitos: família “Ícones” e provador ===================== */
  await p.click('#props [data-act=gallery-icon]'); await sleep(1400);
  const gv=await p.evaluate(()=>{ const it=AMStudio.gallery.items(), fam={}; it.forEach(i=>fam[i.fam]=(fam[i.fam]||0)+1); const vis=[...document.querySelectorAll('#drawerBody .gx-box')].filter(b=>!b.hidden);
    const bx=document.querySelector('#drawerBody .gx-box[data-gx="icon:pulse"] .fxic'); return {fam, cmps:Object.keys(AMRT.FX).filter(k=>!AMRT.FX[k].model).length, on:(document.querySelector('#drawerBody [data-gf].on')||{}).dataset.gf, vis:vis.length, allIcon:vis.every(b=>b.dataset.fam==='icon'), used:[...document.querySelectorAll('#drawerBody .gx-box.gx-used')].map(b=>b.dataset.gx), chip:+(document.querySelector('#drawerBody [data-gf=icon] i')||{}).textContent, box:bx&&{mo:bx.dataset.mo, tr:bx.dataset.tr, cat:document.querySelector('#drawerBody .gx-box[data-gx="icon:pulse"] .gx-cat').textContent}}; });
  check('S03-29: vitrine: família “Ícones” com os 18 movimentos (caixa com prévia viva, ex.: Pulsar no raio), “Em uso” no movimento atual; componentes seguem um por tipo', gv.fam.icon===18&&gv.chip===18&&gv.fam.cmp===gv.cmps&&gv.on==='icon'&&gv.vis===18&&gv.allIcon&&gv.used.filter(x=>/^icon:/.test(x)).join()==='icon:spin'&&gv.used.includes('in:draw')&&gv.box&&gv.box.mo==='pulse'&&gv.box.tr==='in-loop'&&gv.box.cat==='Ícones animados', gv);
  await p.screenshot({path:SH('09-vitrine-icones')});
  const hU=await p.evaluate(()=>AMStudio.deck.slides[AMStudio.cur].els.length);
  await p.evaluate(()=>AMStudio.gallery.tryFx('icon:tick')); await sleep(1800);
  const g1=await p.evaluate(()=>({tgt:document.getElementById('gpTgt').textContent, use:document.getElementById('gpUse').disabled, mo:(document.querySelector('#gpBox .fxic')||{dataset:{}}).dataset.mo, tr:(document.querySelector('#gpBox .fxic')||{dataset:{}}).dataset.tr}));
  await p.screenshot({path:SH('10-provador')});
  await p.evaluate(()=>AMStudio.gallery.use()); await sleep(300); const gu=await last(p);
  await p.keyboard.press('Control+z'); await sleep(250); const gz=await last(p);
  check('S03-30: provador no ícone selecionado mostra o movimento (Ponteiro) e diz o gatilho real; “Usar” troca só a variante, num passo de desfazer', /troca o movimento; na apresentação: ao entrar e ao passar o mouse/.test(g1.tgt)&&!g1.use&&g1.mo==='tick'&&g1.tr==='in-loop'&&gu.variant==='tick'&&gu.data.trig==='in-hover'&&gz.variant==='spin'&&(await els(p)).length===hU, {g1,gu:gu.variant,gz:gz.variant});
  await p.evaluate(()=>AMStudio.select(null)); await sleep(150);
  await p.evaluate(()=>AMStudio.gallery.tryFx('icon:grow')); await sleep(900);
  const g2=await p.evaluate(()=>({tgt:document.getElementById('gpTgt').textContent, use:document.getElementById('gpUse').disabled}));
  await p.evaluate(()=>AMStudio.gallery.use()); await sleep(300); const gi=await last(p);
  check('S03-31: sem seleção, o movimento entra como um ícone novo com o desenho de amostra (Crescer barras → Gráfico em alta)', /novo/.test(g2.tgt)&&!g2.use&&gi.kind==='icon'&&gi.variant==='grow'&&gi.data.name==='chartup', {g2,gi:gi&&[gi.kind,gi.variant,gi.data.name]});
  await p.evaluate(id=>AMStudio.select(id),gi.id); await sleep(150); await p.evaluate(()=>AMStudio.gallery.tryFx('in:draw')); await sleep(500);
  const g3=await p.evaluate(()=>({use:document.getElementById('gpUse').disabled, ic:!!document.querySelector('#gpBox .am-el[data-in=draw] .fxic')}));
  await p.evaluate(()=>AMStudio.gallery.tryFx('loop:flow')); await sleep(300); const g4=await p.evaluate(()=>({use:document.getElementById('gpUse').disabled, msg:document.getElementById('gpTgt').textContent}));
  check('S03-32: vitrine reconhece ícones: “Desenhar” liberado num ícone; “Fluxo contínuo” segue só para linhas', !g3.use&&g3.ic&&g4.use&&/linhas, setas e Linhas A&M\./.test(g4.msg), {g3,g4});
  await p.evaluate(()=>{ AMStudio.gallery.discard(); AMStudio.openDrawer(false); });

  /* ===================== 7. arquivo exportado: desenho, gatilhos, transformação, movimento reduzido ===================== */
  const deck={v:1,app:'AM Studio',title:'Ícones S03',slides:[
    {id:'s1',bg:'#FFFFFF',tr:'fade',els:[
      {id:'iT',type:'fx',kind:'icon',variant:'auto',x:80,y:120,w:200,h:200,data:{name:'target',trig:'in-hover',color:'#002A46',accent:'#F78C16',bg:'none',stroke:1.85,label:''},anim:{in:'draw',dur:500}},
      {id:'iG',type:'fx',kind:'icon',variant:'auto',x:330,y:120,w:200,h:200,data:{name:'gear',trig:'in-loop',color:'#002A46',accent:'#F78C16',bg:'soft',stroke:1.85,label:'Operação'},anim:{in:'draw',dur:500}},
      {id:'iB',type:'fx',kind:'icon',variant:'auto',x:580,y:120,w:200,h:200,data:{name:'bell',trig:'click',color:'#002A46',accent:'#F78C16',bg:'circle',stroke:1.85,label:''},anim:{in:'fade'}},
      {id:'iH',type:'fx',kind:'icon',variant:'auto',x:830,y:120,w:160,h:160,data:{name:'heart',trig:'loop-hover',color:'#002A46',accent:'#F78C16',bg:'ring',stroke:1.85,label:''},anim:{in:'fade'}},
      {id:'iM',type:'fx',kind:'iconmorph',variant:'click',x:1110,y:280,w:150,h:150,data:{pair:'x-check',color:'#002A46',accent:'#F78C16',bg:'circle',stroke:1.85,label:''},anim:{in:'zoom'}},
      {id:'iO',type:'fx',kind:'iconmorph',variant:'loop',x:80,y:420,w:160,h:160,data:{pair:'trend-flip',color:'#002A46',accent:'#F78C16',bg:'navy',stroke:1.85,label:'Virada'},anim:{in:'zoom'}}]},
    {id:'s2',bg:'#002A46',tr:'fade',els:[{id:'iN',type:'fx',kind:'icon',variant:'auto',x:540,y:260,w:200,h:200,data:{name:'rocket',trig:'in-loop',color:'#FFFFFF',accent:'#F78C16',bg:'none',stroke:2.25,label:'Lançamento'},anim:{in:'draw',dur:900}}]}]};
  const html=await p.evaluate(d=>{ AMStudio.loadDeck(d,null,true,true); return AMStudio.exportHTML(); },deck);
  const fx=path.join(TMP,'s03-export.html'); fs.writeFileSync(fx,html);
  check('S03-33: arquivo exportado leva o runtime dos ícones (sem editor nem capa), mantém id="am-deck-data" e não tem on*', /id="am-deck-data"/.test(html)&&/R\.FX\.icon = /.test(html)&&/@keyframes icDraw/.test(html)&&!/onerror|onmouseover|onclick/i.test(html)&&!/AMCover|am-cover|window\.AMStudio\s*=/.test(html));
  const q=await page(ctx,'file://'+fx,'exp',150);
  const dr0=await q.evaluate(()=>{ const s=[...document.querySelectorAll('.amp-slide.on .am-el[data-id=iG] .ic-s')]; return s.map(x=>{ const a=x.getAnimations().find(a=>a.animationName==='icDraw'); return a?Math.round(a.effect.getTiming().delay):null; }); });
  check('S03-34: ao entrar, cada traço se desenha em sequência (icDraw com 110 ms entre traços, o detalhe por último)', dr0.length>=2&&dr0.every((d,i)=>d!==null&&(i===0||d-dr0[i-1]===110)), dr0);
  await sleep(2600);
  const lp=await q.evaluate(()=>{ const m=document.querySelector('.amp-slide.on .am-el[data-id=iG] .ic-mv'); return m.getAnimations().map(a=>a.animationName+':'+a.playState+':'+a.effect.getTiming().iterations); });
  check('S03-35: “Ao entrar e depois sem parar”: depois do desenho a engrenagem gira em laço', lp.some(x=>/^icSpin:running:Infinity/.test(x))&&lp.some(x=>/^icDraw:finished/.test(x)), lp);
  await q.screenshot({path:SH('11-player')});
  const st=()=>q.evaluate(()=>{ const m=document.querySelector('.amp-slide.on .am-el[data-id=iT] .ic-mv'); return m.getAnimations().map(a=>a.animationName+':'+a.playState); });
  const before=await st(); await q.hover('.amp-slide.on .am-el[data-id=iT] .fxic'); await sleep(450); const during=await st(); const go=await q.evaluate(()=>document.querySelector('.amp-slide.on .am-el[data-id=iT] .fxic').classList.contains('ic-go'));
  await q.mouse.move(640,700); await sleep(2900); const after=await st(); const go2=await q.evaluate(()=>document.querySelector('.amp-slide.on .am-el[data-id=iT] .fxic').classList.contains('ic-go'));
  check('S03-36: passar o mouse toca o movimento uma vez até o fim (Alvo: o dardo encaixa) e o desenho não recomeça', go&&during.some(x=>/^icNudge:running/.test(x))&&before[0]==='icDraw:finished'&&after[0]==='icDraw:finished'&&!go2, {before,during,after,go,go2});
  await q.hover('.amp-slide.on .am-el[data-id=iH] .fxic'); await sleep(300); const lh=await q.evaluate(()=>[...document.querySelectorAll('.amp-slide.on .am-el[data-id=iH] .ic-mv')].flatMap(m=>m.getAnimations().map(a=>a.animationName+':'+a.effect.getTiming().iterations)));
  await q.mouse.move(640,700); await sleep(200); const lh2=await q.evaluate(()=>[...document.querySelectorAll('.amp-slide.on .am-el[data-id=iH] .ic-mv')].flatMap(m=>m.getAnimations().map(a=>a.animationName)));
  check('S03-37: “Enquanto o mouse estiver em cima”: bate em laço com o mouse e para quando ele sai', lh.some(x=>x==='icBeat:Infinity')&&!lh2.includes('icBeat'), {lh,lh2});
  await q.click('.amp-slide.on .am-el[data-id=iB] .fxic'); await sleep(250); const ck=await q.evaluate(()=>({go:document.querySelector('.amp-slide.on .am-el[data-id=iB] .fxic').classList.contains('ic-go'), pos:document.querySelector('.amp-pos').textContent}));
  const mb=await q.evaluate(()=>{ const r=document.querySelector('.amp-slide.on .am-el[data-id=iM]').getBoundingClientRect(), d=document.querySelector('.amp-deck').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, zone:(r.x+r.width/2-d.left)/d.width}; });
  await q.mouse.click(mb.x,mb.y); await sleep(700); const mo=await q.evaluate(()=>({on:document.querySelector('.amp-slide.on .am-el[data-id=iM] .fxic').classList.contains('ic-on'), pos:document.querySelector('.amp-pos').textContent}));
  await q.screenshot({path:SH('12-player-clique')});
  await q.mouse.click(mb.x,mb.y); await sleep(300); const mo2=await q.evaluate(()=>document.querySelector('.amp-slide.on .am-el[data-id=iM] .fxic').classList.contains('ic-on'));
  check('S03-38: “Ao clicar”: o sino toca uma vez; a transformação alterna a cada clique, mesmo na zona de avançar (18% à direita), sem trocar de slide', ck.go&&/^01/.test(ck.pos)&&mb.zone>.82&&mo.on&&/^01/.test(mo.pos)&&!mo2, {ck,mb,mo,mo2});
  const ml2=await q.evaluate(()=>[...document.querySelectorAll('.amp-slide.on .am-el[data-id=iO] .ic-st')].map(g=>g.getAnimations().map(a=>a.animationName+':'+a.effect.getTiming().iterations).join()));
  check('S03-39: transformação “alternando sozinha” cruza os dois estados em laço', ml2.join('|')==='icMorphA:Infinity|icMorphB:Infinity', ml2);
  await q.mouse.move(640,700); await q.keyboard.press('ArrowRight'); await sleep(1900);
  const sN=await q.evaluate(()=>{ const n=document.querySelector('.amp-slide.on .am-el[data-id=iN]'); return {pos:document.querySelector('.amp-pos').textContent, st:getComputedStyle(n.querySelector('.ic')).stroke, ax:getComputedStyle(n.querySelector('.ic-ax')).stroke, lab:getComputedStyle(n.querySelector('.ic-l')).color, labFit:n.querySelector('.ic-l').scrollWidth<=n.querySelector('.ic-l').clientWidth+1}; });
  await q.screenshot({path:SH('13-player-navy')});
  check('S03-40: no slide navy o ícone desenha em branco com detalhe laranja e legenda branca', /^02/.test(sN.pos)&&sN.st==='rgb(255, 255, 255)'&&sN.ax==='rgb(247, 140, 22)'&&sN.lab==='rgb(255, 255, 255)'&&sN.labFit, sN);
  await q.close();
  const rctx=await b.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}); const r=await page(rctx,'file://'+fx,'rm',600);
  const rm=await r.evaluate(()=>[...document.querySelectorAll('.amp-slide.on .am-el[data-id=iG] .ic-mv, .amp-slide.on .am-el[data-id=iO] .ic-st')].map(m=>{ const c=getComputedStyle(m); return c.animationIterationCount+'/'+c.animationDuration; }));
  check('S03-41: movimento reduzido: nenhum laço de ícone (1 iteração, duração ~0)', rm.length>=3&&rm.every(s=>/^1(, 1)*\//.test(s)&&!/infinite/.test(s)), rm);
  await rctx.close();

  /* ===================== 8. editor estático, salvar e reabrir, acervo completo ===================== */
  const ed=await p.evaluate(()=>[...document.querySelectorAll('#wrap .am-stage .fxic .ic-s, #wrap .am-stage .fxic .ic-st')].reduce((a,n)=>a+n.getAnimations().length,0));
  check('S03-42: no palco de edição e nas miniaturas os ícones ficam parados (sem animação)', ed===0, ed);
  await p.setInputFiles('#fOpen', fx); await sleep(700);
  const ro=await p.evaluate(()=>{ const e=AMStudio.deck.slides[0].els; const g=e.find(x=>x.id==='iG'), m=e.find(x=>x.id==='iM'); return {n:e.length, g:g&&[g.data.name,g.data.trig,g.data.bg,g.data.label,g.anim.in,g.anim.dur].join('|'), m:m&&[m.variant,m.data.pair].join('|'), s2:AMStudio.deck.slides[1].els[0].data.stroke}; });
  check('S03-43: salvar e reabrir mantém ícone, gatilho, fundo, legenda, desenho, transformação e espessura', ro.n===6&&ro.g==='gear|in-loop|soft|Operação|draw|500'&&ro.m==='click|x-check'&&+ro.s2===2.25, ro);
  /* todos os 54 com legenda num slide: nada sai da caixa */
  await p.evaluate(()=>{ const els=AMRT.ICONS.map((ic,i)=>({id:'a'+i,type:'fx',kind:'icon',variant:'auto',x:24+(i%11)*114,y:12+Math.floor(i/11)*142,w:92,h:118,data:{name:ic.k,trig:'in-loop',color:'#002A46',accent:'#F78C16',bg:'none',stroke:1.85,label:ic.n.split(' /')[0]},anim:{in:'draw',dur:900}}));
    AMStudio.loadDeck({title:'Acervo',slides:[{bg:'#FFFFFF',els:els},{bg:'#002A46',els:els.map((e,i)=>Object.assign({},e,{id:'b'+i,w:58,h:74,x:30+(i%11)*112,y:20+Math.floor(i/11)*140,data:Object.assign({},e.data,{color:'#FFFFFF',bg:i%3?'none':'ring'})}))}]},null,true,true); });
  await sleep(300);
  const fit=async()=>p.evaluate(()=>{ const out=[]; document.querySelectorAll('#wrap .am-stage .am-el').forEach(n=>{ const r=n.getBoundingClientRect(), pad=r.width*.06; n.querySelectorAll('.ic-s').forEach(s=>{ const q=s.getBoundingClientRect(); if(q.left<r.left-pad||q.right>r.right+pad||q.top<r.top-pad||q.bottom>r.bottom+pad) out.push(n.dataset.id+':svg'); }); const l=n.querySelector('.ic-l'); if(l){ const q=l.getBoundingClientRect(); if(l.scrollWidth>l.clientWidth+1||q.left<r.left-1||q.right>r.right+1||q.bottom>r.bottom+2) out.push(n.dataset.id+':'+l.textContent); } }); return out; });
  const f1=await fit(); await p.screenshot({path:SH('14-acervo-editor')}); await p.evaluate(()=>AMStudio.goSlide(1)); await sleep(250); const f2=await fit();
  check('S03-44: os 54 ícones com legenda (claro, 92×118) e em navy pela metade (58×74): traços e legendas dentro da caixa', f1.length===0&&f2.length===0, {f1,f2});
  const h2=await p.evaluate(()=>{ AMStudio.goSlide(0); return AMStudio.exportHTML(); }); const fa=path.join(TMP,'s03-acervo.html'); fs.writeFileSync(fa,h2);
  const a=await page(ctx,'file://'+fa,'acervo',3600); await a.screenshot({path:SH('15-acervo-player')}); await a.close();
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK '+results.length+' verificações', JSON.stringify({errs}));
  await b.close(); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
