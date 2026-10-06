/* S31 — Workshop ao vivo (rt-61-workshop.js/.css): quadro de post-its, votação por pontos e cronômetro, via Inserir › Interativo ▸.
   Editor: inserção, campos do painel, inerte no palco, imagem (raster), Ctrl+Z, salvar/reabrir. Apresentação salva: quadro (+ Nota,
   escrever, cor, apagar, arrastar entre colunas, persistência por obra+elemento, CSV, Limpar volta ao original); votação (+/− com
   limite de pontos, Votar guarda e mostra barras, totais e %, várias pessoas, Sheets, CSV, Limpar, “Ver resultado”); cronômetro
   (Iniciar/Pausar/Continuar, Reiniciar, ±1 min, anel, zerar → “Tempo esgotado”, começa sozinho, continua ao trocar de slide).
   Uso: python3 assemble.py && node test-s31-workshop.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s31-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s31'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,900):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
const posts=[];
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  await p.route('https://script.google.com/**',r=>{ posts.push({method:r.request().method(), body:r.request().postData()}); return r.fulfill({status:200,contentType:'text/plain',body:'ok'}); });
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
const curStage=pv=>pv.evaluate(()=>[...document.querySelectorAll('.am-stage')].findIndex(s=>s.classList.contains('am-in')));
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  /* ---------- 1. menu e inserção dos três ---------- */
  await p.click('#mbar button[data-m=insert]'); await sleep(250); await p.hover('.xmenu .xi:has-text("Interativo")'); await sleep(350);
  const sub=await p.evaluate(()=>[...document.querySelectorAll('.xmenu')].slice(-1)[0] && [...[...document.querySelectorAll('.xmenu')].slice(-1)[0].querySelectorAll('.xi')].map(x=>x.textContent.trim()));
  check('S31-01: Inserir › Interativo ▸ lista Formulário, Quadro de post-its, Votação por pontos e Cronômetro', sub && sub.join('|')==='Formulário|Quadro de post-its|Votação por pontos|Cronômetro', sub);
  await p.evaluate(()=>{ [...document.querySelectorAll('.xmenu .xi')].find(x=>x.textContent.trim()==='Quadro de post-its').click(); }); await sleep(400);
  let d=await D(); const bd=d.slides[0].els.find(e=>e.kind==='board');
  const pan=await p.evaluate(()=>{ const P=document.getElementById('props'); return {cols:!!P.querySelector('textarea[data-p="data.cols"]'), notes:(P.querySelector('textarea[data-p="data.notes"]')||{}).value||'', help:/\+ Nota/.test((P.querySelector('.fhelp')||{}).textContent||'')}; });
  check('S31-02: o quadro entra (1100×520) com 3 colunas e 4 notas; painel com colunas, notas (coluna | texto | cor) e ajuda', !!bd && bd.w===1100 && bd.h===520 && bd.data.notes.length===4 && pan.cols && /^0 \| Reunião semanal/.test(pan.notes) && pan.help, {bd:!!bd, pan});
  const st1=await p.evaluate(()=>{ const r=document.querySelector('#cv .am-edit .amb'); return {cols:r.querySelectorAll('.amb-col').length, notes:r.querySelectorAll('.amb-n').length, pe:getComputedStyle(r.querySelector('.amb-add')).pointerEvents, ia:r.classList.contains('am-ia'), c0:r.querySelectorAll('.amb-col[data-c="0"] .amb-n').length}; });
  check('S31-03: no palco: 3 colunas, 4 notas (2 na primeira), inerte, .am-ia', st1.cols===3 && st1.notes===4 && st1.c0===2 && st1.pe==='none' && st1.ia, st1);
  await p.keyboard.press('Control+z'); await sleep(250); d=await D();
  check('S31-04: um Ctrl+Z tira o quadro', !d.slides[0].els.some(e=>e.kind==='board'));
  /* deck de teste: slide 1 = quadro + votação (com Sheets) + cronômetro curto; slide 2 = cronômetro automático */
  await p.evaluate(()=>{ const A=AMStudio; const d=A.newDeck(); d.title='Workshop'; A.loadDeck(d,null); A.setTitle('Workshop');
    const bd=A.insertFx('board',null,{x:20+550,y:30+260}); bd.x=20; bd.y=30; bd.w=1100; bd.h=330;
    const vt=A.insertFx('vote',null,null,null,{sheet:'https://script.google.com/macros/s/VOTO/exec', pts:3}); vt.x=20; vt.y=380; vt.w=700; vt.h=320;
    const tm=A.insertFx('timer',null,null,null,{min:0, sec:2, sound:'0'}); tm.x=800; tm.y=380; tm.w=300; tm.h=320;
    A.addSlide('blank-light'); const t2=A.insertFx('timer',null,null,null,{min:1, sec:0, auto:'1', sound:'0'}); A.goSlide(0); A.selectMany([]); A.renderAll(); A.commit(); });
  await sleep(400);
  const r1=await p.evaluate(async()=>{ const rr=await AMExport.rasterSlide(AMStudio.deck.slides[0],{scale:1,type:'png'}); const png=rr.canvas.toDataURL('image/png'); rr.canvas.width=0; return {png, fail:!!document.querySelector('#amxHost .fx-falha')}; });
  fs.writeFileSync(SH('raster'), Buffer.from(r1.png.split(',')[1],'base64'));
  const pdf=await p.evaluate(async()=>{ const b=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); return b.size; });
  check('S31-05: os três saem como imagem (raster sem falha; PDF)', !r1.fail && pdf>20000, {fail:r1.fail, pdf});
  const ids=await p.evaluate(()=>({deck:AMStudio.deck.id, board:AMStudio.deck.slides[0].els.find(e=>e.kind==='board').id, vote:AMStudio.deck.slides[0].els.find(e=>e.kind==='vote').id}));
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const hp=path.join(TMP,'ws.html'); fs.writeFileSync(hp, html);
  /* ---------- 2. quadro na apresentação ---------- */
  const pv=await open(ctx,'file://'+hp,'player'); await sleep(900);
  const b0=await pv.evaluate(()=>({n:document.querySelectorAll('.amb .amb-n').length, ce:document.querySelectorAll('.amb .amb-t[contenteditable=true]').length, cnt:document.querySelector('.amb .amw-n').textContent}));
  check('S31-06: quadro ativo: 4 notas editáveis, contagem', b0.n===4 && b0.ce===4 && b0.cnt==='4 notas', b0);
  await pv.click('.amb-col[data-c="1"] .amb-add'); await sleep(200);
  const b1=await pv.evaluate(()=>({n:document.querySelectorAll('.amb .amb-n').length, focus:document.activeElement&&document.activeElement.classList.contains('amb-t'), col:document.activeElement&&document.activeElement.closest('.amb-col').dataset.c}));
  await pv.keyboard.type('Nova ideia do grupo'); await sleep(200);
  const b2=await pv.evaluate(([dk,id])=>{ const o=JSON.parse(localStorage.getItem('amBoard.'+dk+'.'+id)); return {n:o.notes.length, t:o.notes[4].t, c:o.notes[4].c, cnt:document.querySelector('.amb .amw-n').textContent}; }, [ids.deck, ids.board]);
  check('S31-07: “+ Nota” na 2ª coluna cria a nota com o foco no texto; digitar grava em amBoard.<obra>.<elemento>', b1.n===5 && b1.focus && b1.col==='1' && b2.n===5 && b2.t==='Nova ideia do grupo' && b2.c===1, {b1,b2});
  const nid=await pv.evaluate(()=>[...document.querySelectorAll('.amb .amb-n')].find(n=>/Nova ideia/.test(n.textContent)).dataset.id);
  await pv.click('.amb-n[data-id="'+nid+'"] .amb-c[data-k="g"]'); await sleep(150);
  const b3=await pv.evaluate(([dk,id,nid])=>{ const o=JSON.parse(localStorage.getItem('amBoard.'+dk+'.'+id)); return {k:o.notes.find(n=>n.id===nid).k, cls:document.querySelector('.amb-n[data-id="'+nid+'"]').className}; }, [ids.deck, ids.board, nid]);
  check('S31-08: a cor da nota muda (verde) e fica guardada', b3.k==='g' && /amb-g/.test(b3.cls), b3);
  /* arrastar a nota nova para a coluna 3 */
  const grip=await pv.$('.amb-n[data-id="'+nid+'"] .amb-grip'); const gb=await grip.boundingBox(); const c3=await (await pv.$('.amb-col[data-c="2"] .amb-list')).boundingBox();
  await pv.mouse.move(gb.x+gb.width/2, gb.y+gb.height/2); await pv.mouse.down(); await pv.mouse.move(gb.x+40, gb.y+10, {steps:4}); await pv.mouse.move(c3.x+c3.width/2, c3.y+20, {steps:8}); await sleep(100);
  const over=await pv.evaluate(()=>!!document.querySelector('.amb-col.amb-over[data-c="2"]'));
  await pv.mouse.up(); await sleep(250);
  const b4=await pv.evaluate(([dk,id,nid])=>{ const o=JSON.parse(localStorage.getItem('amBoard.'+dk+'.'+id)); return {c:o.notes.find(n=>n.id===nid).c, inCol:!!document.querySelector('.amb-col[data-c="2"] .amb-n[data-id="'+nid+'"]'), cnt2:document.querySelector('.amb-col[data-c="2"] .amb-cn').textContent}; }, [ids.deck, ids.board, nid]);
  check('S31-09: arrastar pela faixa de cima leva a nota para a 3ª coluna (coluna marcada durante o arraste; contagem da coluna)', over && b4.c===2 && b4.inCol && b4.cnt2==='2', {over,b4});
  await pv.click('.amb-col[data-c="0"] .amb-n .amb-x'); await sleep(200);
  const b5=await pv.evaluate(([dk,id])=>({n:JSON.parse(localStorage.getItem('amBoard.'+dk+'.'+id)).notes.length, dom:document.querySelectorAll('.amb .amb-n').length, cnt:document.querySelector('.amb .amw-n').textContent}), [ids.deck, ids.board]);
  check('S31-10: × apaga a nota', b5.n===4 && b5.dom===4 && b5.cnt==='4 notas', b5);
  const [dl]=await Promise.all([pv.waitForEvent('download',{timeout:5000}), pv.click('.amb .amb-dl')]);
  const csvP=path.join(TMP,dl.suggestedFilename()); await dl.saveAs(csvP); const csv=fs.readFileSync(csvP,'utf8'); const cl=csv.replace(/^﻿/,'').split('\r\n');
  check('S31-11: Baixar CSV do quadro: Coluna;Nota;Cor;Data/hora, 4 linhas, a nota nova em “Continuar”/Verde', dl.suggestedFilename()==='notas-retrospectiva.csv' && cl[0]==='Coluna;Nota;Cor;Data/hora' && cl.length===6 && cl.some(l=>/^Continuar;Nova ideia do grupo;Verde;\d{4}-/.test(l)), cl);
  await pv.reload(); await sleep(900);
  const b6=await pv.evaluate(()=>({n:document.querySelectorAll('.amb .amb-n').length, c2:document.querySelectorAll('.amb-col[data-c="2"] .amb-n').length, t:[...document.querySelectorAll('.amb .amb-t')].map(t=>t.textContent).filter(t=>/Nova ideia/.test(t)).length}));
  check('S31-12: reabrir o arquivo no mesmo dispositivo traz o quadro como ficou', b6.n===4 && b6.c2===2 && b6.t===1, b6);
  await pv.click('.amb .amb-clear'); await sleep(100); await pv.click('.amb .amb-clear'); await sleep(250);
  const b7=await pv.evaluate(([dk,id])=>({ls:localStorage.getItem('amBoard.'+dk+'.'+id), n:document.querySelectorAll('.amb .amb-n').length, c0:document.querySelectorAll('.amb-col[data-c="0"] .amb-n').length}), [ids.deck, ids.board]);
  check('S31-13: Limpar (dois cliques) volta às 4 notas originais do editor', b7.ls===null && b7.n===4 && b7.c0===2, b7);
  /* ---------- 3. votação ---------- */
  const v0=await pv.evaluate(()=>({left:document.querySelector('.amv-left b').textContent, send:document.querySelector('.amv-send').disabled, res:document.querySelector('.amv').classList.contains('amv-res'), bars:getComputedStyle(document.querySelector('.amv-bar')).display}));
  check('S31-14: votação: 3 pontos para distribuir, Votar desativado, resultado escondido (mostrar depois de votar)', v0.left==='3' && v0.send && !v0.res && v0.bars==='none', v0);
  await pv.click('.amv-o[data-i="0"] .amv-p'); await sleep(80); await pv.click('.amv-o[data-i="0"] .amv-p'); await sleep(80);
  const vdbg=await pv.evaluate(()=>({v:[...document.querySelectorAll('.amv-v')].map(x=>x.textContent).join(), left:document.querySelector('.amv-left b').textContent, pdis:[...document.querySelectorAll('.amv-p')].map(b=>b.disabled?1:0).join('')}));
  await pv.click('.amv-o[data-i="2"] .amv-p'); await sleep(80); await pv.click('.amv-o[data-i="2"] .amv-p',{force:true}).catch(()=>{}); await sleep(150);
  const v1=await pv.evaluate(()=>({v:[...document.querySelectorAll('.amv-v')].map(x=>x.textContent), left:document.querySelector('.amv-left b').textContent, pdis:[...document.querySelectorAll('.amv-p')].every(b=>b.disabled), send:document.querySelector('.amv-send').disabled}));
  await pv.click('.amv-o[data-i="0"] .amv-m'); await sleep(100);
  const v2=await pv.evaluate(()=>({v:[...document.querySelectorAll('.amv-v')].map(x=>x.textContent), left:document.querySelector('.amv-left b').textContent}));
  check('S31-15: + distribui até o limite (o 4º clique não entra), − devolve; Votar ativa', v1.v.join()==='2,0,1,0' && v1.left==='0' && v1.pdis && !v1.send && v2.v.join()==='1,0,1,0' && v2.left==='1', {vdbg,v1,v2});
  await pv.click('.amv-send'); await sleep(500);
  const v3=await pv.evaluate(([dk,id])=>{ const o=JSON.parse(localStorage.getItem('amVote.'+dk+'.'+id)); return {rows:o.rows.map(r=>r.a), q:o.q.length, res:document.querySelector('.amv').classList.contains('amv-res'), v:[...document.querySelectorAll('.amv-v')].map(x=>x.textContent), bars:[...document.querySelectorAll('.amv-bar em')].map(e=>e.textContent), n:document.querySelector('.amv .amw-n').textContent, st:document.querySelector('.amv .amw-st').textContent}; }, [ids.deck, ids.vote]);
  check('S31-16: Votar guarda [1,0,1,0], zera os pontos, mostra o resultado (50 % / 50 %), “1 voto”, enviado à planilha', JSON.stringify(v3.rows)==='[[1,0,1,0]]' && v3.q===4 && v3.res && v3.v.join()==='0,0,0,0' && v3.bars.join('|')==='1 · 50%|0 · 0%|1 · 50%|0 · 0%' && v3.n==='1 voto' && /planilha/.test(v3.st), v3);
  check('S31-17: o POST ao Google Sheets levou form, perguntas (opções) e pontos', posts.length===1 && (()=>{ try{ const j=JSON.parse(posts[0].body); return j.form==='Priorização' && j.q.length===4 && JSON.stringify(j.a)==='[1,0,1,0]'; }catch(e){ return false; } })(), posts.map(x=>(x.body||'').slice(0,100)));
  await pv.click('.amv-o[data-i="1"] .amv-p'); await pv.click('.amv-o[data-i="1"] .amv-p'); await pv.click('.amv-o[data-i="1"] .amv-p'); await pv.click('.amv-send'); await sleep(400);
  const v4=await pv.evaluate(()=>({bars:[...document.querySelectorAll('.amv-bar em')].map(e=>e.textContent), w:[...document.querySelectorAll('.amv-bar i')].map(i=>i.style.width), n:document.querySelector('.amv .amw-n').textContent}));
  check('S31-18: segunda pessoa vota 3 na opção 2: totais 1/3/1/0 (20 %/60 %/20 %), barra maior = 100 %', v4.bars.join('|')==='1 · 20%|3 · 60%|1 · 20%|0 · 0%' && v4.w.join()==='33%,100%,33%,0%' && v4.n==='2 votos', v4);
  await pv.click('.amv-show'); await sleep(100);
  const v5=await pv.evaluate(()=>({res:document.querySelector('.amv').classList.contains('amv-res'), t:document.querySelector('.amv-show').textContent}));
  check('S31-19: “Esconder resultado” esconde as barras e vira “Ver resultado”', !v5.res && v5.t==='Ver resultado', v5);
  await pv.click('.amv .amv-copy'); await sleep(300);
  const vc=await pv.evaluate(async()=>navigator.clipboard.readText());
  check('S31-20: Copiar leva os votos em TSV (cabeçalho + 2 linhas)', vc.split('\n').length===3 && /^Data\/hora\tAutomação do intake\t/.test(vc) && /\t1\t0\t1\t0$/m.test(vc) && /\t0\t3\t0\t0$/m.test(vc), vc.slice(0,120));
  await pv.click('.amv .amv-clear'); await pv.click('.amv .amv-clear'); await sleep(250);
  const v6=await pv.evaluate(([dk,id])=>({ls:localStorage.getItem('amVote.'+dk+'.'+id), n:document.querySelector('.amv .amw-n').textContent, bars:[...document.querySelectorAll('.amv-bar em')].map(e=>e.textContent).join('|')}), [ids.deck, ids.vote]);
  check('S31-21: Limpar apaga os votos e zera as barras', v6.ls===null && v6.n==='0 votos' && v6.bars==='0|0|0|0', v6);
  /* ---------- 4. cronômetro ---------- */
  const t0=await pv.evaluate(()=>({d:document.querySelector('.am-stage.am-in .amt .amt-d').textContent, go:document.querySelector('.am-stage.am-in .amt .amt-go').textContent}));
  check('S31-22: cronômetro mostra 00:02 e “▶ Iniciar”', t0.d==='00:02' && t0.go==='▶ Iniciar', t0);
  await pv.click('.am-stage.am-in .amt .amt-go'); await sleep(700);
  const t1=await pv.evaluate(()=>({d:document.querySelector('.am-stage.am-in .amt .amt-d').textContent, run:document.querySelector('.am-stage.am-in .amt').classList.contains('amt-run'), go:document.querySelector('.am-stage.am-in .amt .amt-go').textContent, off:parseFloat(document.querySelector('.am-stage.am-in .amt .amt-fg').style.strokeDashoffset)}));
  await pv.click('.am-stage.am-in .amt .amt-go'); await sleep(500);
  const t2=await pv.evaluate(()=>({d:document.querySelector('.am-stage.am-in .amt .amt-d').textContent, run:document.querySelector('.am-stage.am-in .amt').classList.contains('amt-run'), go:document.querySelector('.am-stage.am-in .amt .amt-go').textContent}));
  check('S31-23: Iniciar conta (00:01, anel esvaziando, “Pausar”); Pausar segura e vira “Continuar”', t1.d==='00:01' && t1.run && t1.go==='❚❚ Pausar' && t1.off>0 && t2.d===t2.d && !t2.run && t2.go==='▶ Continuar', {t1,t2});
  await pv.click('.am-stage.am-in .amt .amt-go'); await sleep(1800);
  const t3=await pv.evaluate(()=>({d:document.querySelector('.am-stage.am-in .amt .amt-d').textContent, over:document.querySelector('.am-stage.am-in .amt').classList.contains('amt-over'), end:getComputedStyle(document.querySelector('.am-stage.am-in .amt .amt-end')).display, go:document.querySelector('.am-stage.am-in .amt .amt-go').textContent}));
  check('S31-24: ao zerar: 00:00, “Tempo esgotado” visível, botão volta a “Iniciar”', t3.d==='00:00' && t3.over && t3.end!=='none' && t3.go==='▶ Iniciar', t3);
  await pv.click('.am-stage.am-in .amt .amt-pm[data-d="60"]'); await sleep(100);
  const t4=await pv.evaluate(()=>({d:document.querySelector('.am-stage.am-in .amt .amt-d').textContent, over:document.querySelector('.am-stage.am-in .amt').classList.contains('amt-over')}));
  await pv.click('.am-stage.am-in .amt .amt-rs'); await sleep(100);
  const t5=await pv.evaluate(()=>document.querySelector('.am-stage.am-in .amt .amt-d').textContent);
  check('S31-25: +1 min soma ao total e ao restante (01:00) e sai do “esgotado”; Reiniciar volta ao total (01:02)', t4.d==='01:00' && !t4.over && t5==='01:02', {t4,t5});
  await pv.evaluate(()=>document.activeElement.blur()); await pv.keyboard.press('ArrowRight'); await sleep(1500);
  const t6=await pv.evaluate(()=>({cur:[...document.querySelectorAll('.am-stage')].findIndex(s=>s.classList.contains('am-in')), d:document.querySelectorAll('.amt .amt-d')[1].textContent, run:document.querySelectorAll('.amt')[1].classList.contains('amt-run')}));
  check('S31-26: o cronômetro do slide 2 (começar sozinho) já está contando ao entrar', t6.cur===1 && t6.run && /^00:5[0-9]$/.test(t6.d), t6);
  await pv.keyboard.press('ArrowLeft'); await sleep(1200);
  const t7=await pv.evaluate(()=>({cur:[...document.querySelectorAll('.am-stage')].findIndex(s=>s.classList.contains('am-in')), d:document.querySelectorAll('.amt .amt-d')[1].textContent, run:document.querySelectorAll('.amt')[1].classList.contains('amt-run')}));
  check('S31-27: voltar ao slide 1 não para o cronômetro do slide 2', t7.cur===0 && t7.run && /^00:5[0-9]$/.test(t7.d), t7);
  /* clicar nos componentes nas zonas do player não navega */
  await pv.click('.amb-col[data-c="0"] .amb-ch b'); await pv.click('.amt .amt-t'); await sleep(300);
  check('S31-28: clicar no quadro (zona “voltar”) e no cronômetro (zona “avançar”) não troca de slide', await curStage(pv)===0);
  await pv.screenshot({path:SH('player')}); await pv.close();
  /* ---------- 5. salvar/reabrir ---------- */
  const re=await p.evaluate(()=>{ const A=AMStudio; const html=A.exportHTML(); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]); A.loadDeck(dk,'re'); const s=A.deck.slides[0]; const bd=s.els.find(e=>e.kind==='board'), vt=s.els.find(e=>e.kind==='vote'), tm=s.els.find(e=>e.kind==='timer'); return {notes:bd.data.notes.length, k:bd.data.notes[0].k, pts:vt.data.pts, sheet:vt.data.sheet, sec:tm.data.sec, auto:A.deck.slides[1].els[0].data.auto}; });
  check('S31-29: salvar/reabrir mantém notas (cor), pontos, endereço do Sheets, segundos e “começar sozinho”', re.notes===4 && re.k==='y' && re.pts===3 && /VOTO/.test(re.sheet) && re.sec===2 && re.auto==='1', re);
  await p.evaluate(()=>{ const A=AMStudio; A.goSlide(0); A.select(A.deck.slides[0].els.find(e=>e.kind==='vote').id); }); await sleep(300); await p.screenshot({path:SH('editor')});
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
