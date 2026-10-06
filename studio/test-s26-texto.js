/* S26 — Formatação do texto na edição (barra flutuante #txBar: negrito, itálico, sublinhado, riscado, tamanho do trecho, cor, marcador,
   listas, alinhamento, limpar) + atalhos (Ctrl+B/I/U, Ctrl+Shift+8/7) + espessuras prontas de linhas e contornos.
   Verifica: barra só na edição, estados (aria-pressed) acompanham a seleção, HTML salvo passa pelo cleanHTML (b/i/u/s/span/ul/ol/li),
   tamanho em em (acompanha o slide), um Ctrl+Z por edição, exportação PowerPoint Editável lê negrito/itálico/sublinhado e listas,
   PDF sai, arquivo salvo reabre igual, listas aparecem no player (CSS do runtime), invariantes (zero erros de console).
   Uso: python3 assemble.py && node test-s26-texto.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s26-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s26'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
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
  const html=id=>p.evaluate(id=>AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.id===id).html, id);
  const bar=()=>p.evaluate(()=>{ const b=document.getElementById('txBar'); if(!b) return null; const r=b.getBoundingClientRect(); const w=document.getElementById('wrap').getBoundingClientRect(); return {n:b.querySelectorAll('button').length, inside:r.left>=w.left&&r.right<=w.right&&r.top>=w.top&&r.bottom<=w.bottom, on:[].map.call(b.querySelectorAll('button[aria-pressed=true]'),x=>x.dataset.tx)}; });
  /* texto de trabalho */
  const tid=await p.evaluate(()=>{ const A=AMStudio, mk=A.mk, d=A.newDeck(); d.title='Formatação'; const s=mk.slide('blank-light'); s.els=[]; const t=mk.text('body'); Object.assign(t,{x:120,y:160,w:700,h:120}); t.html='Primeira frase do texto.<br>Segunda linha para a lista.'; s.els.push(t); const l=mk.line(true); s.els.push(l); const r=mk.shape('rect'); Object.assign(r,{x:900,y:400,w:300,h:140}); s.els.push(r); d.slides=[s]; A.loadDeck(d,'f'); return t.id; });
  await sleep(300);
  check('S26-01: sem edição, não há barra de formatação', (await bar())===null);
  /* entra na edição: seleciona e Enter */
  await p.evaluate(id=>AMStudio.select(id), tid); await p.click('#wrap'); await p.evaluate(id=>AMStudio.select(id), tid); await p.keyboard.press('Enter'); await sleep(300);
  const b1=await bar();
  check('S26-02: ao editar, a barra aparece dentro do palco com 14 botões (B I U S · A− A+ cor marcador · listas · alinhamento · limpar)', !!b1 && b1.n===14 && b1.inside, b1);
  await p.screenshot({path:SH('barra')});
  /* seleciona a palavra “Primeira” (tudo → Home → Shift+Ctrl+Right) */
  await p.keyboard.press('Control+Home'); await p.keyboard.down('Shift'); await p.keyboard.press('Control+ArrowRight'); await p.keyboard.up('Shift'); await sleep(100);
  await p.click('#txBar button[data-tx=bold]'); await sleep(120);
  const st1=await bar();
  check('S26-03: Negrito pelo botão: o botão fica pressionado (aria-pressed) e a edição continua', !!st1 && st1.on.indexOf('bold')>=0 && await p.evaluate(()=>document.activeElement&&document.activeElement.classList.contains('am-tx')), st1);
  await p.click('#txBar button[data-tx=italic]'); await p.click('#txBar button[data-tx=underline]'); await sleep(100);
  await p.keyboard.press('Escape'); await sleep(250);
  let h=await html(tid);
  check('S26-04: Esc encerra; o HTML guarda <b>, <i>, <u> em “Primeira” (via cleanHTML) e o resto intacto', /<b>|<i>|<u>/.test(h) && /Primeira/.test(h) && /Segunda linha para a lista\./.test(h) && (h.match(/<(b|i|u)>/g)||[]).length===3, h);
  check('S26-05: a edição inteira é um passo de Ctrl+Z', await p.evaluate(async id=>{ const A=AMStudio; const before=A.deck.slides[0].els.find(e=>e.id===id).html; document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true})); await new Promise(r=>setTimeout(r,200)); const after=A.deck.slides[0].els.find(e=>e.id===id).html; const undone=!/<b>/.test(after); document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true})); await new Promise(r=>setTimeout(r,200)); return undone && A.deck.slides[0].els.find(e=>e.id===id).html===before; }, tid));
  /* atalhos: Ctrl+B/I/U e riscado pelo botão; tamanho e cor */
  await p.evaluate(id=>AMStudio.select(id), tid); await p.keyboard.press('Enter'); await sleep(200);
  await p.keyboard.press('Control+End'); await p.keyboard.press('Home'); await p.keyboard.down('Shift'); await p.keyboard.press('Control+ArrowRight'); await p.keyboard.up('Shift'); await sleep(80);
  await p.keyboard.press('Control+b'); await sleep(60); await p.keyboard.press('Control+i'); await sleep(60); await p.keyboard.press('Control+u'); await sleep(60);
  await p.click('#txBar button[data-tx=strike]'); await sleep(60);
  const st2=await bar();
  check('S26-06: Ctrl+B/I/U + Riscado marcam os 4 estados', !!st2 && ['bold','italic','underline','strike'].every(k=>st2.on.indexOf(k)>=0), st2);
  await p.click('#txBar button[data-tx=sizeup]'); await sleep(60); await p.click('#txBar button[data-tx=sizeup]'); await sleep(60);
  /* cor pelo popover (Mais cores…): campo hex + Enter */
  await p.click('#txBar button[data-tx=fcolor]'); await sleep(300);
  const pop=await p.evaluate(()=>{ const c=document.querySelector('.cpop'); return c?{open:true, hex:!!c.querySelector('.cp-hex')}:{open:false}; });
  check('S26-07: “Cor do texto selecionado” abre o seletor de cores (Mais cores…)', pop.open && pop.hex, pop);
  await p.fill('.cpop .cp-hex', '#C0392B'); await p.keyboard.press('Enter'); await sleep(250);
  await p.click('#txBar button[data-tx=hilite]'); await sleep(80);
  await p.keyboard.press('Escape'); await sleep(250);
  h=await html(tid);
  check('S26-08: trecho “Segunda” com b/i/u/riscado, font-size em ×2 (1,15em aninhado), cor #C0392B e marcador laranja; sem <font size>', /<(s|strike)>/.test(h) && (h.match(/font-size:\s*1\.15em/g)||[]).length===2 && /color:\s*(#C0392B|rgb\(192, 57, 43\))/i.test(h) && /background-color:\s*(#F78C16|rgb\(247, 140, 22\))/i.test(h) && !/<font/i.test(h) && /Segunda/.test(h), h);
  /* listas e alinhamento (parágrafo inteiro) */
  await p.evaluate(id=>AMStudio.select(id), tid); await p.keyboard.press('Enter'); await sleep(200);
  await p.keyboard.press('Control+End'); await p.click('#txBar button[data-tx=bullets]'); await sleep(100);
  const st3=await bar();
  check('S26-09: Lista com marcadores no parágrafo do cursor (botão pressionado)', !!st3 && st3.on.indexOf('bullets')>=0, st3);
  await p.keyboard.press('Control+Home'); await p.keyboard.press('Control+Shift+Digit7'); await sleep(100);
  await p.click('#txBar button[data-tx=alignc]'); await sleep(100);
  const st4=await bar();
  check('S26-10: Ctrl+Shift+7 numera o 1º parágrafo; Centralizar fica pressionado', !!st4 && st4.on.indexOf('numbered')>=0 && st4.on.indexOf('alignc')>=0, st4);
  await p.keyboard.press('Escape'); await sleep(250);
  h=await html(tid);
  check('S26-11: HTML com <ol><li> e <ul><li> e text-align:center; nada fora da lista de permissão', /<ol>\s*<li/.test(h) && /<ul>\s*<li/.test(h) && /text-align:\s*center/.test(h) && !/<(script|style|iframe|img)/i.test(h), h);
  const li=await p.evaluate(id=>{ const n=document.querySelector('#wrap .am-el[data-id="'+id+'"] .am-tx li'); if(!n) return null; const cs=getComputedStyle(n.parentElement); return {pad:cs.paddingLeft, style:cs.listStyleType, mark:getComputedStyle(n,'::marker').content}; }, tid);
  check('S26-12: CSS do runtime desenha a lista (recuo em em, marcador disc/decimal)', !!li && parseFloat(li.pad)>10 && /disc|decimal/.test(li.style), li);
  await p.screenshot({path:SH('listas')});
  /* limpar formatação */
  await p.evaluate(id=>AMStudio.select(id), tid); await p.keyboard.press('Enter'); await sleep(200);
  await p.keyboard.press('Control+a'); await p.click('#txBar button[data-tx=clearfmt]'); await sleep(100); await p.keyboard.press('Escape'); await sleep(250);
  h=await html(tid);
  check('S26-13: Limpar formatação tira negrito/itálico/cor/tamanho do trecho (listas e alinhamento ficam)', !/<b>|<i>|<u>|<s>|font-size|color:/.test(h) && /<ol>|<ul>/.test(h), h);
  /* formato de novo para exportar */
  await p.evaluate(id=>{ const A=AMStudio; const t=A.deck.slides[0].els.find(e=>e.id===id); t.html='<div>Negrito <b>aqui</b>, <i>itálico</i> e <u>sublinhado</u>.</div><ul><li>Item um</li><li>Item dois</li></ul><ol><li>Primeiro</li><li>Segundo</li></ol>'; A.renderAll(); A.commit(); }, tid);
  const pk=path.join(TMP,'fmt.pptx'); fs.writeFileSync(pk, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  const sp=insp.slides[0].shapes.find(s=>s.text&&/Negrito/.test(s.text)&&s.ph!=='title');
  check('S26-14: PowerPoint Editável: trechos negrito/itálico/sublinhado e 5 parágrafos (frase + 2 marcadores + 2 numerados)', !!sp && sp.runs.some(r=>r.t==='aqui'&&r.b) && sp.runs.some(r=>/itálico/.test(r.t)&&r.i) && sp.runs.some(r=>/sublinhado/.test(r.t)&&r.u) && sp.paras===5, sp&&{paras:sp.paras,runs:sp.runs.map(r=>[r.t,r.b,r.i,r.u])});
  const pdf=await p.evaluate(async()=>{ const b=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); return b.size; });
  check('S26-15: PDF sai', pdf>10000, pdf);
  /* salvar e reabrir */
  const out=await p.evaluate(()=>AMStudio.exportHTML()); const sf=path.join(TMP,'fmt.html'); fs.writeFileSync(sf,out);
  const q=await open(ctx,'file://'+sf,'exp');
  const pl=await q.evaluate(()=>{ const li=document.querySelectorAll('.amp .am-tx li'); const b=document.querySelector('.amp .am-tx b'); return {li:li.length, b:b&&b.textContent, pad:li[0]?getComputedStyle(li[0].parentElement).paddingLeft:null}; });
  check('S26-16: no arquivo salvo, o player mostra negrito e as 4 linhas de lista com recuo', pl.li===4 && pl.b==='aqui' && parseFloat(pl.pad)>10, pl);
  await q.close();
  const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(out)[1]);
  check('S26-17: reabrir mantém o HTML formatado', await p.evaluate(([dk,id])=>{ AMStudio.loadDeck(dk,'re'); return AMStudio.deck.slides[0].els.find(e=>e.id===id).html; }, [dk,tid])===dk.slides[0].els.find(e=>e.id===tid).html && /<b>aqui<\/b>/.test(dk.slides[0].els.find(e=>e.id===tid).html));
  /* ---------- espessuras prontas ---------- */
  const lid=await p.evaluate(()=>{ const l=AMStudio.deck.slides[0].els.find(e=>e.type==='line'); AMStudio.select(l.id); return l.id; }); await sleep(200);
  const seg=await p.evaluate(()=>({n:document.querySelectorAll('#props .ln-w button').length, on:(document.querySelector('#props .ln-w button.on')||{}).dataset}));
  check('S26-18: painel da linha tem 6 espessuras prontas (Fina…Máxima), a atual (3) marcada', seg.n===6 && seg.on && seg.on.act==='sw-3', seg);
  await p.click('#props .ln-w button[data-act="sw-6"]'); await sleep(200);
  check('S26-19: clicar “Extra” põe 6 px e o campo numérico acompanha', await p.evaluate(id=>AMStudio.deck.slides[0].els.find(e=>e.id===id).strokeW, lid)===6 && await p.evaluate(()=>+document.querySelector('#props input[data-p=strokeW]').value)===6);
  const rid=await p.evaluate(()=>{ const r=AMStudio.deck.slides[0].els.find(e=>e.type==='shape'); AMStudio.select(r.id); return r.id; }); await sleep(200);
  await p.click('#props .ln-w button[data-act="sw-4"]'); await sleep(200);
  const rs=await p.evaluate(id=>{ const r=AMStudio.deck.slides[0].els.find(e=>e.id===id); return {w:r.strokeW, stroke:r.stroke}; }, rid);
  check('S26-20: forma sem contorno (0) ganha 4 px com a cor do contorno padrão', rs.w===4 && /^#[0-9A-F]{6}$/i.test(rs.stroke), rs);
  await p.keyboard.press('Control+z'); await sleep(200);
  check('S26-21: Ctrl+Z desfaz a espessura (volta a 0)', await p.evaluate(id=>AMStudio.deck.slides[0].els.find(e=>e.id===id).strokeW, rid)===0);
  /* forma com texto também tem a barra */
  await p.evaluate(id=>AMStudio.select(id), rid); await p.keyboard.press('Enter'); await sleep(250);
  const bs=await bar(); await p.keyboard.press('Escape'); await sleep(200);
  check('S26-22: editar o texto de uma forma também mostra a barra', !!bs && bs.n===14, bs);
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
