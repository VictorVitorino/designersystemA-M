/* S27a — Organizar: grupos (Ctrl+G / Ctrl+Shift+G), bloqueio (Ctrl+Shift+L), painel de camadas (subir/descer/bloquear/selecionar),
   pincel de formato (Ctrl+Alt+C / Ctrl+Alt+V) e numeração dos slides (deck.num → .am-num no editor, miniaturas, player e exportações).
   Verifica: clique num membro seleciona o grupo; mover/duplicar/apagar valem para o grupo; grupo duplicado/colado vira outro grupo;
   bloqueado seleciona mas não move (arrasto, setas, alças), não gira, não apaga, texto continua editável; camadas reordenam e bloqueiam;
   pincel copia só o formato (texto ↔ forma, linha → linha, não aplica em tipo diferente); numeração em todos os cantos, no arquivo salvo
   (player, posição original com oculto), no PDF (camada de texto) e no PowerPoint Editável; safeDeck/safeEl descartam valores inválidos;
   um Ctrl+Z por ação; invariantes (menus, zero erros de console). Uso: python3 assemble.py && node test-s27-organizar.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s27-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s27'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS23=path.join(__dirname,'test-s23-tools.py');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,1000):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  const E=id=>p.evaluate(id=>JSON.parse(JSON.stringify(AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id))), id);
  const SEL=()=>p.evaluate(()=>AMStudio.selected());
  const wb=async()=>await (await p.$('#wrap')).boundingBox();
  const L=async(x,y)=>{ const w=await wb(); return {x:w.x+x/1280*w.width, y:w.y+y/720*w.height}; };
  async function drag(x0,y0,x1,y1){ const a=await L(x0,y0), c=await L(x1,y1); await p.mouse.move(a.x,a.y); await p.mouse.down(); await p.mouse.move((a.x+c.x)/2,(a.y+c.y)/2,{steps:4}); await p.mouse.move(c.x,c.y,{steps:4}); await p.mouse.up(); await sleep(150); }
  /* deck: 2 textos, 2 formas, 1 linha, 1 foto; 2º slide vazio e 3º oculto */
  const ids=await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Organizar';
    const s=mk.slide('blank-light'); s.els=[];
    const t1=mk.text('title'); Object.assign(t1,{x:60,y:40,w:600,h:80}); t1.html='Título azul'; t1.color='#002A46'; s.els.push(t1);
    const t2=mk.text('body'); Object.assign(t2,{x:60,y:160,w:400,h:60}); t2.html='Corpo'; s.els.push(t2);
    const r1=mk.shape('rect'); Object.assign(r1,{x:700,y:100,w:200,h:120}); r1.fill='#1B7F3B'; r1.html='A'; s.els.push(r1);
    const r2=mk.shape('ellipse'); Object.assign(r2,{x:950,y:100,w:160,h:120}); r2.fill='#C0392B'; r2.html='B'; s.els.push(r2);
    const l1=mk.line(true); Object.assign(l1,{x1:700,y1:400,x2:1100,y2:400,strokeW:6,stroke:'#F78C16'}); s.els.push(l1);
    const l2=mk.line(false); Object.assign(l2,{x1:100,y1:500,x2:500,y2:600}); s.els.push(l2);
    const s2=mk.slide('blank-light'); s2.els=[]; const s3=mk.slide('blank-dark'); s3.els=[]; s3.hidden=true;
    d.slides=[s,s2,s3]; A.loadDeck(d,'o'); return {t1:t1.id,t2:t2.id,r1:r1.id,r2:r2.id,l1:l1.id,l2:l2.id}; });
  await sleep(300);
  /* ---------- 1. grupos ---------- */
  await p.evaluate(ids=>AMStudio.selectMany([ids.r1,ids.r2]), ids); await p.click('#wrap', {position:{x:5,y:5}}).catch(()=>{}); await p.evaluate(ids=>AMStudio.selectMany([ids.r1,ids.r2]), ids); await sleep(100);
  await p.keyboard.press('Control+g'); await sleep(250);
  let r1=await E(ids.r1), r2=await E(ids.r2);
  check('S27-01: Ctrl+G agrupa os 2 selecionados (mesmo grp); o rótulo do quadro diz “Grupo”', !!r1.grp && r1.grp===r2.grp && await p.evaluate(()=>/Grupo/.test((document.querySelector('#sel .gbox span')||{}).textContent||'')), {g1:r1.grp,g2:r2.grp});
  await p.click('#wrap', {position:{x:5,y:5}}); await sleep(100); await p.keyboard.press('Escape'); await sleep(100);
  const c=await L(800,160); await p.mouse.click(c.x,c.y); await sleep(200);
  check('S27-02: clicar num membro seleciona o grupo inteiro (2 elementos)', (await SEL()).length===2 && await p.evaluate(()=>document.querySelectorAll('#sel .sbox.multi').length===2));
  await drag(800,160,860,260);
  r1=await E(ids.r1); r2=await E(ids.r2);
  check('S27-03: arrastar um membro move o grupo todo (+60, +100)', Math.abs(r1.x-760)<3 && Math.abs(r1.y-200)<3 && Math.abs(r2.x-1010)<3 && Math.abs(r2.y-200)<3, {r1:[r1.x,r1.y],r2:[r2.x,r2.y]});
  await p.keyboard.press('Control+d'); await sleep(250);
  let d=await D(); const dups=d.slides[0].els.filter(e=>e.grp&&e.grp!==r1.grp);
  check('S27-04: Ctrl+D duplica o grupo como outro grupo (2 cópias com grp novo, igual entre si)', dups.length===2 && dups[0].grp===dups[1].grp && d.slides[0].els.length===8, dups.map(e=>e.grp));
  await p.keyboard.press('Control+z'); await sleep(250); d=await D();
  check('S27-05: um Ctrl+Z tira a cópia inteira', d.slides[0].els.length===6);
  const m=await L(800,260); await p.mouse.click(m.x,m.y); await sleep(150); const nb=await SEL(); await p.keyboard.press('Control+Shift+g'); await sleep(250);
  r1=await E(ids.r1); r2=await E(ids.r2);
  check('S27-06: Ctrl+Shift+G desagrupa (sem grp)', !r1.grp && !r2.grp, {sel:nb.length, toast:await p.evaluate(()=>document.getElementById('toast').textContent), g:[r1.grp,r2.grp]});
  /* ---------- 2. bloqueio ---------- */
  await p.evaluate(id=>AMStudio.select(id), ids.t1); await sleep(100); await p.keyboard.press('Control+Shift+l'); await sleep(250);
  let t1=await E(ids.t1);
  check('S27-07: Ctrl+Shift+L bloqueia: lock=true, quadro tracejado com cadeado, sem alças', t1.lock===true && await p.evaluate(()=>!!document.querySelector('#sel .sbox.locked .lockb') && document.querySelectorAll('#sel .hdl').length===0 && !document.querySelector('#sel .rhdl')));
  await drag(200,80,400,180); t1=await E(ids.t1);
  check('S27-08: arrastar um bloqueado não move', t1.x===60 && t1.y===40 && /bloqueado/i.test(await p.evaluate(()=>document.getElementById('toast').textContent)), [t1.x,t1.y]);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown'); await sleep(500); t1=await E(ids.t1);
  check('S27-09: setas não movem o bloqueado', t1.x===60 && t1.y===40);
  await p.keyboard.press('Delete'); await sleep(200); d=await D();
  check('S27-10: Delete não apaga o bloqueado (aviso)', d.slides[0].els.some(e=>e.id===ids.t1) && /bloqueado/i.test(await p.evaluate(()=>document.getElementById('toast').textContent)));
  await p.keyboard.press('Enter'); await sleep(200);
  check('S27-11: o texto bloqueado continua editável (Enter abre a edição)', await p.evaluate(()=>!!document.querySelector('.am-el.editing')));
  await p.keyboard.press('Escape'); await sleep(200);
  const chip=await p.evaluate(()=>{ const b=document.querySelector('#props [data-act=lock]'); return b?{t:b.textContent.trim(),on:b.getAttribute('aria-pressed')}:null; });
  check('S27-12: painel mostra “Bloqueado” (pressionado) e o selo no cabeçalho', !!chip && chip.t==='Bloqueado' && chip.on==='true' && await p.evaluate(()=>!!document.querySelector('#props .lkt')), chip);
  await p.click('#props [data-act=lock]'); await sleep(200); t1=await E(ids.t1);
  check('S27-13: o chip desbloqueia', !t1.lock);
  /* ---------- 3. camadas ---------- */
  await p.keyboard.press('Escape'); await p.click('#wrap', {position:{x:5,y:5}}); await sleep(200);
  const ly=await p.evaluate(()=>{ const rows=[].map.call(document.querySelectorAll('#secLayers .lyr'),r=>r.querySelector('.lyn span').textContent.trim()); return rows; });
  check('S27-14: painel do slide lista as 6 camadas de cima para baixo (linha, linha, forma, forma, texto, texto)', ly.length===6 && /Linha|Seta/.test(ly[0]) && /Texto|Título/.test(ly[5]), ly);
  await p.click('#secLayers .lyr:last-child [data-act^="ly-up:"]'); await sleep(200); d=await D();
  check('S27-15: “Subir” move o último (fundo) uma camada acima', d.slides[0].els[1].id===ids.t1);
  await p.click('#secLayers .lyr:last-child [data-act^="ly-lock:"]'); await sleep(200); d=await D();
  check('S27-16: o cadeado da lista bloqueia o elemento (lock=true, linha marcada)', d.slides[0].els[0].lock===true && await p.evaluate(()=>!!document.querySelector('#secLayers .lyr.lk')));
  await p.click('#secLayers .lyr:last-child [data-act^="ly-lock:"]'); await sleep(150);
  await p.click('#secLayers .lyr:first-child .lyn'); await sleep(200);
  check('S27-17: clicar no nome seleciona o elemento (painel do elemento)', (await SEL()).length===1 && await p.evaluate(()=>!!document.querySelector('#props [data-act=fmtcopy]')));
  await p.click('#props [data-act=layers]'); await sleep(250);
  check('S27-18: “Camadas” no painel do elemento volta ao painel do slide com a lista', await p.evaluate(()=>!!document.querySelector('#secLayers')) && (await SEL()).length===0);
  await p.screenshot({path:SH('camadas')});
  /* ---------- 4. pincel de formato ---------- */
  await p.evaluate(id=>AMStudio.select(id), ids.t1); await sleep(100); await p.keyboard.press('Control+Alt+c'); await sleep(200);
  check('S27-19: Ctrl+Alt+C copia o formato (aviso) e habilita “Colar formato”', /Formato copiado/.test(await p.evaluate(()=>document.getElementById('toast').textContent)) && await p.evaluate(()=>!document.querySelector('#props [data-act=fmtpaste]').disabled));
  await p.evaluate(id=>AMStudio.select(id), ids.t2); await sleep(100); await p.keyboard.press('Control+Alt+v'); await sleep(250);
  const t2=await E(ids.t2); const tt=await E(ids.t1);
  check('S27-20: Ctrl+Alt+V aplica fonte/tamanho/peso/cor do título ao corpo, sem mudar o texto', t2.font===tt.font && t2.size===tt.size && t2.weight===tt.weight && t2.color===tt.color && t2.html==='Corpo', {t2:[t2.font,t2.size,t2.weight,t2.color,t2.html]});
  await p.keyboard.press('Control+z'); await sleep(200);
  check('S27-21: um Ctrl+Z desfaz o pincel', (await E(ids.t2)).size!==tt.size);
  await p.evaluate(id=>AMStudio.select(id), ids.r2); await sleep(100); await p.keyboard.press('Control+Alt+v'); await sleep(250);
  r2=await E(ids.r2);
  check('S27-22: formato de texto aplicado a uma forma só muda o texto dela (fonte/tamanho), não o preenchimento', r2.size===tt.size && r2.font===tt.font && r2.fill==='#C0392B', [r2.size,r2.fill]);
  await p.evaluate(id=>AMStudio.select(id), ids.l1); await sleep(100); await p.keyboard.press('Control+Alt+c'); await sleep(150);
  await p.evaluate(id=>AMStudio.select(id), ids.l2); await sleep(100); await p.keyboard.press('Control+Alt+v'); await sleep(250);
  const l2=await E(ids.l2);
  check('S27-23: linha → linha: espessura 6, laranja e ponta no fim', l2.strokeW===6 && l2.stroke==='#F78C16' && l2.headEnd===true, [l2.strokeW,l2.stroke,l2.headEnd]);
  await p.evaluate(id=>AMStudio.select(id), ids.t1); await sleep(100); await p.keyboard.press('Control+Alt+v'); await sleep(250);
  check('S27-24: formato de linha não se aplica a um texto (aviso, nada muda)', /não se aplica/.test(await p.evaluate(()=>document.getElementById('toast').textContent)) && (await E(ids.t1)).html==='Título azul');
  /* ---------- 5. numeração ---------- */
  await p.keyboard.press('Escape'); await p.click('#wrap', {position:{x:5,y:5}}); await sleep(200);
  await p.click('#props [data-act=num-on]'); await sleep(300);
  const n1=await p.evaluate(()=>({deck:AMStudio.deck.num, st:(document.querySelector('#wrap .am-stage .am-num')||{}).textContent, th:[].map.call(document.querySelectorAll('#thumbs .th .am-num'),x=>x.textContent), pos:document.querySelector('#props .numpos button.on')&&document.querySelector('#props .numpos button.on').dataset.act}));
  check('S27-25: ligar a numeração: deck.num, “1” no palco, 1/2/3 nas miniaturas (oculto também numera), posição inferior direita', n1.deck&&n1.deck.on===true && n1.st==='1' && n1.th.join()==='1,2,3' && n1.pos==='num-pos-br', n1);
  await p.click('#props [data-act=num-pos-tl]'); await sleep(250);
  const n2=await p.evaluate(()=>{ const n=document.querySelector('#wrap .am-stage .am-num'); const r=n.getBoundingClientRect(), s=n.parentElement.getBoundingClientRect(); return {cls:n.className, left:r.left-s.left<s.width*.1, top:r.top-s.top<s.height*.1}; });
  check('S27-26: posição “canto superior esquerdo” move o número', /am-num-tl/.test(n2.cls) && n2.left && n2.top, n2);
  await p.evaluate(()=>AMStudio.goSlide(1)); await sleep(200);
  check('S27-27: slide 2 mostra “2”', await p.evaluate(()=>(document.querySelector('#wrap .am-stage .am-num')||{}).textContent)==='2');
  await p.evaluate(()=>AMStudio.goSlide(0));
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const sf=path.join(TMP,'num.html'); fs.writeFileSync(sf,html);
  const dj=/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1];
  check('S27-28: o JSON salvo leva deck.num e não leva _num nos slides', /"num":\{"on":true,"pos":"tl"\}/.test(dj) && !/_num/.test(dj));
  const q=await open(ctx,'file://'+sf,'exp');
  const pn=await q.evaluate(()=>[].map.call(document.querySelectorAll('.amp .amp-slide .am-num'),x=>x.textContent+':'+x.className));
  check('S27-29: no player do arquivo salvo, os 2 visíveis mostram 1 e 2 (posição original) no canto escolhido', pn.length===2 && pn[0].indexOf('1:')===0 && pn[1].indexOf('2:')===0 && /am-num-tl/.test(pn[0]), pn);
  await q.close();
  const pdfF=path.join(TMP,'num.pdf'); fs.writeFileSync(pdfF, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  let txt=''; try{ txt=execFileSync('pdftotext',['-layout',pdfF,'-'],{encoding:'utf8'}); }catch(e){}
  check('S27-30: o PDF leva o número (camada de texto da página 2 tem “2”)', /\f[\s\S]*\b2\b/.test(txt) && /Título azul/.test(txt), txt.replace(/\s+/g,' ').slice(0,120));
  const pk=path.join(TMP,'num.pptx'); fs.writeFileSync(pk, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  check('S27-31: o PowerPoint Editável sai válido com a numeração ligada', insp.slides.length===2 && insp.xmlBad.length===0, {n:insp.slides.length});
  const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const re=await p.evaluate(dk=>{ dk.num={on:true,pos:'xx',from:'7'}; dk.slides[0].els[0].lock='yes'; dk.slides[0].els[1].grp='<x>'; dk.slides[0].els[2].grp='g-ok'; dk.slides[0].els[3].grp='g-ok'; AMStudio.loadDeck(dk,'re'); const d=AMStudio.deck; return {num:d.num, lock:d.slides[0].els[0].lock, g1:d.slides[0].els[1].grp, g2:d.slides[0].els[2].grp, g3:d.slides[0].els[3].grp}; }, dk);
  check('S27-32: reabrir valida: pos inválida vira “br”, from 7 vale, lock “yes” sai, grp inválido sai, grp válido fica', re.num.pos==='br' && re.num.from===7 && re.lock===undefined && re.g1===undefined && re.g2==='g-ok' && re.g3==='g-ok', re);
  check('S27-33: com from=7 o primeiro slide mostra 7', await p.evaluate(()=>(document.querySelector('#wrap .am-stage .am-num')||{}).textContent)==='7');
  await p.click('#props [data-act=num-on]'); await sleep(250);
  check('S27-34: desligar tira o número do palco e das miniaturas', await p.evaluate(()=>!document.querySelector('#wrap .am-stage .am-num') && !document.querySelector('#thumbs .am-num') && !AMStudio.deck.num));
  /* ---------- 6. menus ---------- */
  await p.evaluate(id=>AMStudio.select(id), ids.r1); await sleep(100);
  await p.click('#mbar button[data-m=arrange]'); await sleep(250);
  const it=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xm .xi, .xmenu .xi'),x=>x.textContent.trim()));
  check('S27-35: Organizar tem Agrupar, Desagrupar, Bloquear, Copiar formato, Colar formato e Camadas do slide…; só um item com “trazer para frente”', ['Agrupar','Desagrupar','Bloquear','Copiar formato','Colar formato'].every(k=>it.some(t=>t.indexOf(k)===0)) && it.some(t=>/^Camadas do slide/.test(t)) && it.filter(t=>/trazer para frente/i.test(t)).length===1, it);
  await p.keyboard.press('Escape'); await sleep(150);
  const r=await p.evaluate(id=>{ const n=document.querySelector('#wrap .am-el[data-id="'+id+'"]'); const b=n.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}; }, ids.r1);
  await p.mouse.click(r.x,r.y,{button:'right'}); await sleep(250);
  const ci=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xm .xi, .xmenu .xi'),x=>x.textContent.trim()));
  check('S27-36: menu de contexto do elemento: Bloquear, Copiar formato, Colar formato; um só “alinhar” e um só “trazer para frente”', ci.some(t=>/^Bloquear/.test(t)) && ci.some(t=>/^Copiar formato/.test(t)) && ci.filter(t=>/^alinhar/i.test(t)).length===1 && ci.filter(t=>/trazer para frente/i.test(t)).length===1, ci);
  await p.keyboard.press('Escape'); await sleep(150);
  check('S27-37: a barra do topo não transborda a 1280 px', await (async()=>{ await p.setViewportSize({width:1280,height:720}); await sleep(300); const ok=await p.evaluate(()=>{ const t=document.querySelector('#top')||document.querySelector('header'); return !t || t.scrollWidth<=t.clientWidth+1; }); await p.setViewportSize({width:1440,height:900}); return ok; })());
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
