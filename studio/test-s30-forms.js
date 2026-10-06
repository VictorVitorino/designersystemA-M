/* S30 — Formulário interativo (rt-60-forms.js/.css + Inserir › Interativo ▸): codec das perguntas, painel (campos + ajuda com o
   código do Apps Script), inerte no editor, imagem (PDF/PowerPoint), apresentação salva: responder (texto, nota, opção, várias,
   sim/não, texto longo), obrigatórias, Enter avança, respostas no localStorage por obra+elemento, contagem, Baixar CSV (; e BOM),
   Copiar (TSV), Limpar em dois cliques, Google Sheets (POST JSON, no-cors), teclas não navegam dentro dos campos, presente no
   modo apresentar do editor, salvar/reabrir, Ctrl+Z, resumo automático sem o codec/endereço.
   Uso: python3 assemble.py && node test-s30-forms.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const {execFileSync}=require('child_process');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true}); const SH=n=>path.join(SHOTS,'s30-'+n+'.png');
const TMP=path.join(__dirname,'.gate','s30'); fs.rmSync(TMP,{recursive:true,force:true}); fs.mkdirSync(TMP,{recursive:true});
const TOOLS23=path.join(__dirname,'test-s23-tools.py');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,900):'')); if(!ok) failed++; }
const ACAO={'Access-Control-Allow-Origin':'*'};
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',headers:ACAO,body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',headers:ACAO,body:fs.readFileSync(f)}):r.abort();}); }
const posts=[];
async function open(ctx, url, tag){ const p=await ctx.newPage(); await fonts(p);
  await p.route('https://script.google.com/**',r=>{ posts.push({url:r.request().url(), method:r.request().method(), body:r.request().postData()}); return r.fulfill({status:200,contentType:'text/plain',body:'ok'}); });
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(900); return p; }
(async()=>{
  const b=await chromium.launch({args:['--disable-lcd-text']});
  const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const D=()=>p.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck)));
  /* ---------- 1. codec ---------- */
  const cod=await p.evaluate(()=>{ const P=AMRT.forms.parse; const d=P(AMRT.FX.form.data.qs); const x=P('Só pergunta\nCom = algo estranho\nNota = 1-5 *\nVazia =\n = sem título\nMuitas = a | b | c | d | e | f | g | h | i | j | k | l | m | n\nChecks = []  X |  | Y\n'+Array.from({length:25},(_,i)=>'Q'+i).join('\n')); return {d:d.map(q=>q.type+(q.req?'*':'')+(q.opts.length?':'+q.opts.length:'')), x:x.map(q=>q.type+(q.req?'*':'')+':'+q.t+(q.opts.length?':'+q.opts.join('/'):'')).slice(0,7), n:x.length}; });
  check('S30-01: codec das perguntas (padrão: texto*, nota, uma opção (3), texto longo); “= algo” desconhecido vira parte da pergunta; “Pergunta =” vazio = texto; linha sem título sai; obrigatória; até 12 opções e 20 perguntas', cod.d.join()==='text*,rate,one:3,long' && cod.x[0]==='text:Só pergunta' && cod.x[1]==='text:Com = algo estranho' && cod.x[2]==='rate*:Nota' && cod.x[3]==='text:Vazia' && /^one:Muitas:a\/b\/c\/d\/e\/f\/g\/h\/i\/j\/k\/l$/.test(cod.x[4]) && cod.x[5]==='many:Checks:X/Y' && cod.x[6]==='text:Q0' && cod.n===20, cod);
  /* ---------- 2. Inserir › Interativo ▸ Formulário; painel ---------- */
  await p.click('#mbar button[data-m=insert]'); await sleep(250);
  const ins=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xmenu .xi'),x=>x.textContent.trim()));
  check('S30-02: Inserir tem “Interativo ▸” e continua com um só item com “forma”', ins.some(t=>/^Interativo/.test(t)) && ins.filter(t=>/forma/i.test(t)).length===1, ins);
  await p.hover('.xmenu .xi:has-text("Interativo")'); await sleep(350);
  const sub=await p.evaluate(()=>[].map.call(document.querySelectorAll('.xmenu .xi'),x=>x.textContent.trim()).filter(t=>/^Formulário$/.test(t)));
  check('S30-03: submenu com “Formulário”', sub.length===1, sub);
  await p.evaluate(()=>{ const it=[...document.querySelectorAll('.xmenu .xi')].find(x=>x.textContent.trim()==='Formulário'); it.click(); }); await sleep(400);
  let d=await D(); let fe=d.slides[0].els.find(e=>e.type==='fx'&&e.kind==='form');
  const pan=await p.evaluate(()=>{ const P=document.getElementById('props'); return {qs:!!P.querySelector('textarea[data-p="data.qs"]'), sheet:!!P.querySelector('input[data-p="data.sheet"]'), tools:!!P.querySelector('select[data-p="data.tools"]'), help:!!P.querySelector('.fhelp'), code:(P.querySelector('.fhelp-code')||{}).value||'', note:(P.querySelector('.fhelp')||{}).textContent||''}; });
  check('S30-04: o formulário entra no slide (620×520) com as 4 perguntas padrão (cabem na caixa); o painel tem Perguntas, endereço do Sheets, ferramentas e a ajuda com o código do Apps Script', !!fe && fe.w===620 && fe.h===520 && fe.data.qs.split('\n').length===4 && /1-5/.test(fe.data.qs) && pan.qs && pan.sheet && pan.tools && pan.help && /function doPost\(e\)/.test(pan.code) && /appendRow/.test(pan.code) && /Apps Script/.test(pan.note), {fe:!!fe, pan:{...pan, code:pan.code.slice(0,40)}});
  const inert=await p.evaluate(()=>{ const b=document.querySelector('#cv .am-edit .amf-send'); return b?{pe:getComputedStyle(b).pointerEvents, n:document.querySelectorAll('#cv .am-edit .amf .amf-q').length, ce:!!document.querySelector('#cv .am-edit .amf-in[contenteditable=true]')}:null; });
  check('S30-05: no palco do editor o formulário é inerte (pointer-events none; campos não editáveis) e mostra as 4 perguntas', !!inert && inert.pe==='none' && inert.n===4 && !inert.ce, inert);
  await p.keyboard.press('Control+z'); await sleep(250); d=await D();
  check('S30-06: um Ctrl+Z tira o formulário', !d.slides[0].els.some(e=>e.kind==='form'));
  /* daqui em diante: um formulário com os 6 tipos de pergunta (inserido pela API, um passo) */
  await p.evaluate((SIX)=>{ AMStudio.insertFx('form', null, null, null, {qs: SIX}); AMStudio.selectMany([]); }, 'Nome *\nComo avalia este encontro? = 1-5\nQual área você representa? = Finanças | Operações | TI | RH\nQuais temas quer aprofundar? = [] Estratégia | Processos | Dados | Pessoas\nRecomendaria a um colega? = sim/não\nComentários = texto longo'); await sleep(300);
  const six=await p.evaluate(()=>document.querySelectorAll('#cv .am-edit .amf .amf-q').length);
  check('S30-06b: formulário com os 6 tipos (texto, nota, uma opção, várias, sim/não, texto longo)', six===6, six);
  /* ---------- 3. imagem (PDF/PowerPoint) e resumo ---------- */
  const r1=await p.evaluate(async()=>{ const s=AMStudio.deck.slides[0]; const rr=await AMExport.rasterSlide(s,{scale:1,type:'png'}); const c=rr.canvas; const g=c.getContext('2d'); const e=s.els.find(x=>x.kind==='form'); const px=g.getImageData(e.x+e.w/2|0, e.y+30, 1, 1).data; const png=c.toDataURL('image/png'); c.width=0; return {png, white:px[0]>240&&px[1]>240&&px[2]>240, fail:!!document.querySelector('#amxHost .fx-falha')}; });
  fs.writeFileSync(SH('raster'), Buffer.from(r1.png.split(',')[1],'base64'));
  const pdf=await p.evaluate(async()=>{ const b=await AMExport.pdf(AMStudio.deck,{range:'all',scale:1}); return b.size; });
  const pk=path.join(TMP,'form.pptx'); fs.writeFileSync(pk, Buffer.from(await p.evaluate(async()=>{ const b=await AMExport.pptxBuild(AMStudio.deck,{range:'all',mode:'edit'}); const u=new Uint8Array(await b.arrayBuffer()); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }),'base64'));
  const insp=JSON.parse(execFileSync('python3',[TOOLS23,'inspect',pk],{encoding:'utf8',maxBuffer:64<<20}));
  check('S30-07: o formulário sai como imagem no PDF e no PowerPoint Editável (válido), sem componente com falha', !r1.fail && r1.white && pdf>20000 && insp.zipBad===null && insp.xmlBad.length===0, {fail:r1.fail, white:r1.white, pdf, bad:insp.xmlBad});
  const notes=await p.evaluate(()=>{ const A=AMStudio; const e=A.deck.slides[0].els.find(x=>x.kind==='form'); e.data.sheet='https://script.google.com/macros/s/TESTE/exec'; A.renderAll(); A.commit(); return AMRT.autoNotes(A.deck.slides[0], 0, A.deck); });
  check('S30-08: o resumo automático cita o formulário e não leva o codec das perguntas nem o endereço do Sheets', /Formulário/.test(notes) && !/1-5|script\.google|\[\]|https:/.test(notes), notes.slice(0,200));
  /* ---------- 4. apresentação salva: responder ---------- */
  await p.evaluate(()=>{ const A=AMStudio; A.setTitle('Pesquisa do workshop'); A.addSlide('blank-light'); A.goSlide(0); });
  const deckId=await p.evaluate(()=>AMStudio.deck.id), formId=await p.evaluate(()=>AMStudio.deck.slides[0].els.find(e=>e.kind==='form').id);
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const hp=path.join(TMP,'form.html'); fs.writeFileSync(hp, html);
  const pv=await open(ctx,'file://'+hp,'player'); await sleep(900);
  const armed=await pv.evaluate(()=>({ce:document.querySelectorAll('.amf-in[contenteditable=true]').length, n:document.querySelector('.amf-n').textContent, dis:document.querySelector('.amf-dl').disabled, sheet:document.querySelector('.amf').dataset.sheet}));
  check('S30-09: na apresentação salva o formulário fica ativo: 2 campos de texto editáveis, “0 respostas”, Baixar CSV desativado, endereço do Sheets no elemento', armed.ce===2 && armed.n==='0 respostas' && armed.dis && /TESTE\/exec$/.test(armed.sheet), armed);
  const cur=()=>pv.evaluate(()=>document.querySelectorAll('.am-slide.on, .am-sl.on').length?[...document.querySelectorAll('.am-slide.on, .am-sl.on')].map(x=>x.dataset.i||'')[0]:location.hash);
  await pv.click('.amf-q[data-q="0"] .amf-in'); await pv.keyboard.type('Ana Souza'); await pv.keyboard.press('Space'); await pv.keyboard.type('Lima');
  await pv.keyboard.press('Enter'); await sleep(150);
  const k1=await pv.evaluate(()=>({t:document.querySelector('.amf-q[data-q="0"] .amf-in').textContent, hash:location.hash, focusQ:document.activeElement&&document.activeElement.closest('.amf-q')&&document.activeElement.closest('.amf-q').dataset.q}));
  check('S30-10: digitar no campo (com Espaço) não navega; Enter no texto curto pula para a próxima pergunta sem quebrar linha', k1.t==='Ana Souza Lima' && (k1.hash===''||/#\/1$/.test(k1.hash)) && k1.focusQ==='1', k1);
  await pv.click('.amf-q[data-q="1"] .amf-rb[data-v="4"]'); await pv.click('.amf-q[data-q="2"] .amf-o[data-v="TI"]'); await pv.click('.amf-q[data-q="3"] .amf-o[data-v="Estratégia"]'); await pv.click('.amf-q[data-q="3"] .amf-o[data-v="Dados"]'); await pv.click('.amf-q[data-q="3"] .amf-o[data-v="Processos"]'); await pv.click('.amf-q[data-q="3"] .amf-o[data-v="Processos"]'); await pv.click('.amf-q[data-q="4"] .amf-rb[data-v="Sim"]');
  await pv.click('.amf-q[data-q="5"] .amf-in'); await pv.keyboard.type('Ótimo; "muito" bom'); await pv.keyboard.press('Enter'); await pv.keyboard.type('segunda linha');
  const sel=await pv.evaluate(()=>({r:[...document.querySelectorAll('.amf-q[data-q="1"] [aria-checked=true]')].map(b=>b.dataset.v), one:[...document.querySelectorAll('.amf-q[data-q="2"] [aria-checked=true]')].map(b=>b.dataset.v), many:[...document.querySelectorAll('.amf-q[data-q="3"] [aria-checked=true]')].map(b=>b.dataset.v), yn:[...document.querySelectorAll('.amf-q[data-q="4"] [aria-checked=true]')].map(b=>b.dataset.v)}));
  check('S30-11: nota e sim/não são escolha única; opções: uma só; várias: marca/desmarca', sel.r.join()==='4' && sel.one.join()==='TI' && sel.many.join()==='Estratégia,Dados' && sel.yn.join()==='Sim', sel);
  await pv.click('.amf-send'); await sleep(500);
  const s1=await pv.evaluate(([dk,fid])=>{ const o=JSON.parse(localStorage.getItem('amForm.'+dk+'.'+fid)||'null'); return {done:!document.querySelector('.amf-done').hidden, st:document.querySelector('.amf-st').textContent, n:document.querySelector('.amf-n').textContent, rows:o&&o.rows.map(r=>r.a), q:o&&o.q, at:o&&o.rows[0].at}; }, [deckId, formId]);
  check('S30-12: Enviar guarda a resposta (chave amForm.<obra>.<elemento>): 6 respostas na ordem, perguntas sem numeração/asterisco, data/hora; mensagem final; “1 resposta”; enviado ao Sheets', s1.done && s1.n==='1 resposta' && JSON.stringify(s1.rows)===JSON.stringify([['Ana Souza Lima','4','TI','Estratégia | Dados','Sim','Ótimo; "muito" bom\nsegunda linha']]) && s1.q[0]==='Nome' && s1.q[1]==='Como avalia este encontro?' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s1.at) && /enviada à planilha/.test(s1.st), s1);
  check('S30-13: o POST ao Google Sheets levou JSON com form, título, perguntas e respostas (sem preflight: text/plain)', posts.length===1 && posts[0].method==='POST' && (()=>{ try{ const j=JSON.parse(posts[0].body); return j.form==='Pesquisa rápida' && j.deck===deckId && j.q.length===6 && j.a[0]==='Ana Souza Lima' && /^\d{4}-/.test(j.at); }catch(e){ return false; } })(), posts.map(x=>({m:x.method, b:(x.body||'').slice(0,80)})));
  await pv.click('.amf-again'); await sleep(200);
  const rs=await pv.evaluate(()=>({done:document.querySelector('.amf-done').hidden, t:document.querySelector('.amf-q[data-q="0"] .amf-in').textContent, on:document.querySelectorAll('.amf [aria-checked=true]').length, n:document.querySelector('.amf-n').textContent}));
  check('S30-14: “Responder de novo” limpa o formulário e mantém a contagem', rs.done && rs.t==='' && rs.on===0 && rs.n==='1 resposta', rs);
  await pv.click('.amf-send'); await sleep(300);
  const miss=await pv.evaluate(()=>({miss:[...document.querySelectorAll('.amf-q.amf-miss')].map(q=>q.dataset.q), st:document.querySelector('.amf-st').textContent, done:document.querySelector('.amf-done').hidden, focus:document.activeElement&&document.activeElement.classList.contains('amf-in')}));
  check('S30-15: obrigatória em branco: marca a pergunta, avisa, foca o campo e não grava', miss.miss.join()==='0' && /Falta responder: 1\. Nome/.test(miss.st) && miss.done && miss.focus && posts.length===1, miss);
  await pv.keyboard.type('Bruno'); await pv.click('.amf-send'); await sleep(400);
  const s2=await pv.evaluate(([dk,fid])=>{ const o=JSON.parse(localStorage.getItem('amForm.'+dk+'.'+fid)); return {n:o.rows.length, a:o.rows[1].a, lab:document.querySelector('.amf-n').textContent, miss:document.querySelectorAll('.amf-miss').length}; }, [deckId, formId]);
  check('S30-16: preenchida a obrigatória, grava a 2ª resposta (as outras perguntas vazias) e a marca some', s2.n===2 && s2.a[0]==='Bruno' && s2.a.slice(1).every(v=>v==='') && s2.lab==='2 respostas' && s2.miss===0 && posts.length===2, s2);
  /* ---------- 5. CSV, copiar, limpar ---------- */
  const [dl]=await Promise.all([pv.waitForEvent('download',{timeout:5000}), pv.click('.amf-dl')]);
  const csvP=path.join(TMP,dl.suggestedFilename()); await dl.saveAs(csvP); const csv=fs.readFileSync(csvP,'utf8');
  const lines=csv.replace(/^\uFEFF/,'').split('\r\n');
  check('S30-17: Baixar CSV: nome do título, BOM, cabeçalho Data/hora + perguntas com “;”, 2 linhas, texto com ; " e quebra de linha entre aspas', dl.suggestedFilename()==='respostas-pesquisa-rapida.csv' && csv.charCodeAt(0)===0xFEFF && lines[0]==='Data/hora;Nome;Como avalia este encontro?;Qual área você representa?;Quais temas quer aprofundar?;Recomendaria a um colega?;Comentários' && /;Ana Souza Lima;4;TI;Estratégia \| Dados;Sim;"Ótimo; ""muito"" bom\nsegunda linha"$/.test(lines[1]) && /;Bruno;;;;;$/.test(lines[2]) && lines[3]==='', {name:dl.suggestedFilename(), l0:lines[0], l1:lines[1], l2:lines[2]});
  await pv.click('.amf-copy'); await sleep(300);
  const cp=await pv.evaluate(async()=>({st:document.querySelector('.amf-st').textContent, clip:await navigator.clipboard.readText()}));
  check('S30-18: Copiar põe as respostas em TSV (uma linha por resposta, quebras de linha viram espaço)', /2 respostas copiadas/.test(cp.st) && cp.clip.split('\n').length===3 && /^Data\/hora\tNome\t/.test(cp.clip) && /\tÓtimo; "muito" bom segunda linha$/m.test(cp.clip), {st:cp.st, clip:cp.clip.slice(0,120)});
  await pv.click('.amf-clear'); await sleep(150);
  const c1=await pv.evaluate(()=>({t:document.querySelector('.amf-clear').textContent, n:document.querySelector('.amf-n').textContent}));
  await pv.click('.amf-clear'); await sleep(200);
  const c2=await pv.evaluate(([dk,fid])=>({t:document.querySelector('.amf-clear').textContent, n:document.querySelector('.amf-n').textContent, ls:localStorage.getItem('amForm.'+dk+'.'+fid), dis:document.querySelector('.amf-dl').disabled}), [deckId, formId]);
  check('S30-19: Limpar pede um segundo clique (“Confirmar: apagar?”) e só então apaga as respostas do dispositivo', c1.t==='Confirmar: apagar?' && c1.n==='2 respostas' && c2.t==='Limpar' && c2.n==='0 respostas' && c2.ls===null && c2.dis, {c1,c2});
  const navk=await pv.evaluate(async()=>{ document.querySelector('.amf-q[data-q="0"] .amf-in').focus(); return true; });
  await pv.keyboard.press('ArrowRight'); await pv.keyboard.press('PageDown'); await sleep(300);
  const nv=await pv.evaluate(()=>({hash:location.hash, cur:[...document.querySelectorAll('.am-stage')].findIndex(s=>s.classList.contains('am-in'))}));
  await pv.evaluate(()=>document.activeElement.blur()); await pv.keyboard.press('ArrowRight'); await sleep(400);
  const nv2=await pv.evaluate(()=>({hash:location.hash, cur:[...document.querySelectorAll('.am-stage')].findIndex(s=>s.classList.contains('am-in'))}));
  check('S30-20: setas dentro do campo não trocam de slide; fora do campo, → avança', navk && nv.cur===0 && nv2.cur===1, {nv, nv2});
  /* formulário encostado na borda esquerda (zona “voltar” do player) e na direita (zona “avançar”): clicar nele não troca de slide */
  await pv.evaluate(()=>{ history.replaceState(null,'','#/1'); location.reload(); }); await sleep(900);
  await pv.close();
  await p.evaluate(()=>{ const A=AMStudio; A.goSlide(0); const e=A.deck.slides[0].els.find(x=>x.kind==='form'); e.x=0; e.y=100; A.renderAll(); A.commit(); });
  const hp2=path.join(TMP,'form-edge.html'); fs.writeFileSync(hp2, await p.evaluate(()=>AMStudio.exportHTML()));
  const pe=await open(ctx,'file://'+hp2,'player2'); await sleep(900);
  await pe.click('.amf-q[data-q="2"] .amf-o[data-v="TI"]'); await sleep(300);
  const z1=await pe.evaluate(()=>({cur:[...document.querySelectorAll('.am-stage')].findIndex(s=>s.classList.contains('am-in')), on:document.querySelectorAll('.amf [aria-checked=true]').length}));
  await pe.click('.amf-h'); await sleep(300);
  const z2=await pe.evaluate(()=>[...document.querySelectorAll('.am-stage')].findIndex(s=>s.classList.contains('am-in')));
  check('S30-24: formulário na zona “voltar/avançar” do player: clicar numa opção ou no título do formulário não troca de slide', z1.cur===0 && z1.on===1 && z2===0, {z1,z2});
  await pe.close();
  /* ---------- 6. modo apresentar do editor, salvar/reabrir, ferramentas escondidas, endereço inválido ---------- */
  await p.evaluate(()=>{ AMStudio.goSlide(0); AMStudio.present(0); }); await sleep(900);
  await p.click('#presenter .amf-q[data-q="0"] .amf-in'); await p.keyboard.type('Carla'); await p.click('#presenter .amf-send'); await sleep(400);
  const pr=await p.evaluate(([dk,fid])=>{ const o=JSON.parse(localStorage.getItem('amForm.'+dk+'.'+fid)||'null'); return {rows:o?o.rows.length:0, a:o&&o.rows[0].a[0], done:!document.querySelector('#presenter .amf-done').hidden}; }, [deckId, formId]);
  check('S30-21: no modo apresentar do editor o formulário também funciona e guarda com o id da obra', pr.rows===1 && pr.a==='Carla' && pr.done, pr);
  await p.keyboard.press('Escape'); await sleep(400);
  check('S30-22: Esc sai da apresentação', await p.evaluate(()=>!document.getElementById('presenter').classList.contains('open')));
  const re=await p.evaluate(()=>{ const A=AMStudio; const e=A.deck.slides[0].els.find(x=>x.kind==='form'); const q0=e.data.qs; e.data.tools='0'; e.data.sheet='http://inseguro.exemplo/exec'; A.renderAll(); A.commit(); const html=A.exportHTML(); const dk=JSON.parse(/<script type="application\/json" id="am-deck-data">([\s\S]*?)<\/script>/.exec(html)[1]); const f=dk.slides[0].els.find(x=>x.kind==='form'); A.loadDeck(dk,'re'); const st=document.querySelector('#cv .amf'); return {qs:f.data.qs===q0 && q0.split('\n').length===6, tools:f.data.tools, kept:A.deck.slides[0].els.find(x=>x.kind==='form').data.sheet, noTools:st&&!st.querySelector('.amf-tools'), noSheet:st&&!st.dataset.sheet}; });
  check('S30-23: salvar/reabrir mantém perguntas e opções; ferramentas escondidas somem; endereço que não é https não vai para o elemento', re.qs && re.tools==='0' && re.kept==='http://inseguro.exemplo/exec' && re.noTools && re.noSheet, re);
  await p.evaluate(()=>{ const A=AMStudio; A.select(A.deck.slides[0].els.find(x=>x.kind==='form').id); }); await sleep(300); await p.screenshot({path:SH('editor')});
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({checks:results.length,errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
