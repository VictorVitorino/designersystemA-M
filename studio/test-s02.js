/* test-s02: Minhas obras — histórico local das apresentações (F2). IndexedDB "canteiro"/"obras" (alternativa localStorage),
   autossalvamento no commit (com atraso), ao salvar, ao abrir arquivo e ao carregar projeto pronto; vista "hist" da capa com
   prévia viva do slide 1, abrir e editar, duplicar, renomear, baixar .html, excluir com confirmação, busca, ordem, teclado,
   exportar/importar acervo (.json, o mais novo vence), ?nocover, "Retomar obra" pela obra mais recente e caminhos de erro.
   Uso: python3 assemble.py && node test-s02.js   (o qa-gate.sh pega qualquer test-s[0-9][0-9]*.js) */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s02-'+f+'.png');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'canteiro-s02-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined&&!ok?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function page(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p); p.on('filechooser',()=>{}); /* liga a interceptação do seletor de arquivo antes de qualquer tecla */
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  await p.goto(url); await sleep(wait||900); return p; }
async function go(p, url, wait){ await p.goto(url); await sleep(wait||900); }
async function until(p, fn, arg, ms){ const t0=Date.now(); for(;;){ const v=await p.evaluate(fn,arg); if(v||Date.now()-t0>(ms||4000)) return v; await sleep(80); } }
const count=p=>p.evaluate(()=>AMHist.ready.then(()=>AMHist.count()));
const flush=p=>p.evaluate(()=>AMHist.flush());
const recs=p=>p.evaluate(()=>AMHist.list().then(l=>l.map(r=>({id:r.id,title:r.title,n:r.slideCount,up:r.updatedAt,cr:r.createdAt,els:r.deck.slides.reduce((a,s)=>a+s.els.length,0),dt:r.deck.title,did:r.deck.id}))));
const cover=p=>p.evaluate(()=>({open:AMCover.isOpen(), view:document.getElementById('cover').dataset.view}));
const cards=p=>p.evaluate(()=>[...document.querySelectorAll('#cvHistGrid .cv-hcard')].map(c=>({id:c.dataset.id, name:c.querySelector('.cv-hname').textContent, meta:c.querySelector('.cv-hmeta').textContent, stage:!!c.querySelector('.cv-pv .am-stage'), cur:c.classList.contains('cv-hcur')})));
const focusId=p=>p.evaluate(()=>{ const c=document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.cv-hcard'); return c?c.dataset.id:(document.activeElement&&(document.activeElement.id||document.activeElement.className)); });
const noteTxt=p=>p.evaluate(()=>document.getElementById('cvNote').textContent);
async function openHist(p){ await p.click('#cvHistBtn'); await until(p,()=>document.getElementById('cover').dataset.view==='hist'&&!document.getElementById('cvHist').hasAttribute('aria-busy')); await sleep(250); }
async function cardBtn(p, id, h){ await p.click(`#cvHistGrid .cv-hcard[data-id="${id}"] [data-h="${h}"]`); }
async function menuFile(p, label){ await p.click('#mbar [data-m=file]'); await sleep(220); const it=p.locator('.xmenu .xi',{hasText:label}).first(); await it.hover(); await sleep(120); await it.click(); await sleep(250); }
async function download(p, act){ const [d]=await Promise.all([p.waitForEvent('download',{timeout:5000}), act()]); const f=await d.path(); return {name:d.suggestedFilename(), text:fs.readFileSync(f,'utf8')}; }

(async()=>{
  const b=await chromium.launch();

  /* ===================== 1. criar três obras por caminhos reais do editor ===================== */
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  let p=await page(ctx, FILE+'?nocover', 'ed');
  await p.evaluate(()=>AMStudio.hideDraftBanner());
  const k0=await p.evaluate(()=>AMHist.ready.then(k=>({k, n:AMHist.count(), api:['list','get','put','touch','flush','saveNow','rename','duplicate','remove','exportJSON','importJSON','on','recent','kind'].filter(f=>typeof AMHist[f]!=='function')})));
  check('S02-01: AMHist pronto em IndexedDB, acervo vazio num navegador novo, API completa', k0.k==='idb'&&k0.n===0&&!k0.api.length, k0);
  await p.click('#mbar [data-m=file]'); await sleep(220);
  const fm=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi .xl')].map(x=>x.textContent));
  await p.keyboard.press('Escape'); await sleep(120);
  check('S02-02: Arquivo › “Minhas obras…” depois de “Abrir…”; “Início (capa)” segue em 1º e só um “abrir…”', fm[0]==='Início (capa)'&&fm.filter(t=>/abrir…/i.test(t)).length===1&&fm.indexOf('Minhas obras…')===fm.indexOf('Abrir…')+1, fm);

  /* A: projeto pronto carregado pela capa */
  await p.evaluate(()=>AMCover.open('tpl')); await sleep(700); await p.keyboard.press('2'); await sleep(900);
  await until(p,()=>AMHist.count()===1);
  const A=await p.evaluate(()=>({id:AMStudio.deck.id,title:AMStudio.deck.title,n:AMStudio.deck.slides.length}));
  let R=await recs(p);
  check('S02-03: carregar projeto pronto guarda a obra (id, título, nº de slides, deck)', R.length===1&&R[0].id===A.id&&R[0].title===A.title&&R[0].n===7&&R[0].did===A.id&&R[0].cr>0&&R[0].up>=R[0].cr, R);
  /* B: obra nova em branco (não entra) → título + texto → autossalvamento com atraso */
  await p.click('#bNew'); await sleep(250); await p.keyboard.press('Enter'); await sleep(500);
  await flush(p); check('S02-04: obra nova intocada (slide branco, título padrão) não entra no acervo', await count(p)===1);
  await p.click('#mbar [data-m=insert]'); await sleep(220); await p.locator('.xmenu .xi',{hasText:'Título'}).first().click(); await sleep(300);
  await p.keyboard.press('Escape'); await sleep(150);
  await p.fill('#title','Plano de ação — Q4'); await p.keyboard.press('Tab'); await sleep(150);
  const pend=await p.evaluate(()=>({pending:AMHist.pending(), n:AMHist.count()}));
  await sleep(1700);
  const B=await p.evaluate(()=>({id:AMStudio.deck.id,title:AMStudio.deck.title}));
  R=await recs(p);
  check('S02-05: commit agenda o autossalvamento (não grava na hora) e ~1,2 s depois a obra está guardada', pend.pending&&pend.n===1&&R.length===2&&R[0].id===B.id&&R[0].title==='Plano de ação — Q4'&&R[0].els===1, {pend,R});
  /* C: abrir arquivo .html salvo */
  const cHtml=await p.evaluate(()=>{ const d=AMCover.buildTemplate(4); d.title='Comitê de investimentos'; d.id=AMStudio.newId(); return AMStudio.exportDeck(d); });
  const cFile=path.join(TMP,'comite.html'); fs.writeFileSync(cFile,cHtml);
  await menuFile(p,'Abrir…');
  const [fc]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}), p.keyboard.press('Enter')]); await fc.setFiles(cFile); await sleep(900);
  await until(p,()=>AMHist.count()===3);
  const C=await p.evaluate(()=>({id:AMStudio.deck.id,title:AMStudio.deck.title,n:AMStudio.deck.slides.length}));
  R=await recs(p);
  check('S02-06: abrir um .html salvo guarda a obra com o id do arquivo', R.length===3&&C.title==='Comitê de investimentos'&&R[0].id===C.id&&R[0].n===6, {C,R});
  const up0=R[0].up; await sleep(30);
  const sv=await download(p,()=>p.click('#bSave')); await sleep(400);
  R=await recs(p);
  check('S02-07: salvar (download) também atualiza a obra no acervo', /^comite-de-investimentos\.html$/.test(sv.name)&&R[0].id===C.id&&R[0].up>up0, {name:sv.name,up0,up:R[0].up});

  /* ===================== 2. recarregar: capa com “Minhas obras (3)” e a vista hist ===================== */
  await go(p, FILE, 1500);
  const top=await p.evaluate(()=>({btn:document.getElementById('cvHistBtn').textContent.replace(/\s+/g,' ').trim(), opts:document.querySelectorAll('.cv-opt').length, keys:[...document.querySelectorAll('.cv-opt')].map(o=>o.dataset.k).join('')}));
  check('S02-08: depois de recarregar, o botão do topo diz “Minhas obras (3)” e a capa mantém as 6 opções 1–6', top.btn==='Minhas obras(3)'&&top.opts===6&&top.keys==='123456', top);
  await p.screenshot({path:SH('01-capa-1440')});
  await openHist(p);
  let K=await cards(p);
  const meta1=await p.evaluate(()=>({count:document.getElementById('cvHistCount').textContent, note:document.querySelector('#cvHist .cv-hnote').textContent, btnOn:document.getElementById('cvHistBtn').classList.contains('on')}));
  check('S02-09: as 3 obras aparecem (mais recente primeiro) com prévia viva do slide 1, nº de slides e “editado …”', K.length===3&&K.map(c=>c.id).join()===[C.id,B.id,A.id].join()&&K.every(c=>c.stage&&/slides?/.test(c.meta)&&/editado/.test(c.meta))&&meta1.count==='03 obras', {K,meta1});
  check('S02-10: nota honesta sobre onde as obras ficam', /Suas obras ficam salvas neste navegador; use Exportar acervo para levar a outro computador\./.test(meta1.note)&&meta1.btnOn, meta1);
  check('S02-11: foco no primeiro cartão ao abrir a vista', await focusId(p)===C.id);
  await p.screenshot({path:SH('02-minhas-obras-1440')});
  /* teclado */
  await p.keyboard.press('ArrowRight'); const f1=await focusId(p); await p.keyboard.press('End'); const f2=await focusId(p); await p.keyboard.press('Home'); const f3=await focusId(p); await p.keyboard.press('ArrowLeft'); const f4=await focusId(p);
  check('S02-12: setas, Home e End percorrem os cartões', f1===B.id&&f2===A.id&&f3===C.id&&f4===A.id, [f1,f2,f3,f4]);
  /* hover toca a prévia */
  const hb=await (await p.$(`#cvHistGrid .cv-hcard[data-id="${B.id}"] .cv-hopen`)).boundingBox(); await p.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2); await sleep(200);
  check('S02-13: passar o mouse toca a entrada do slide 1 (palco am-play) e só nesse cartão', await p.evaluate(id=>{ const pl=[...document.querySelectorAll('#cvHistGrid .cv-pv .am-stage.am-play')]; return pl.length===1&&pl[0].closest('.cv-hcard').dataset.id===id; },B.id));
  await p.mouse.move(5,5); await sleep(150);
  /* busca */
  await p.keyboard.press('/'); await sleep(100);
  const inSearch=await p.evaluate(()=>document.activeElement.id);
  await p.keyboard.type('diag'); await sleep(200);
  let s1={cards:(await cards(p)).map(c=>c.name), count:await p.evaluate(()=>document.getElementById('cvHistCount').textContent)};
  await p.keyboard.type('2'); await p.keyboard.press('Backspace'); await sleep(150);
  const stay=await cover(p);
  await p.keyboard.type('zzz'); await sleep(200);
  const none=await p.evaluate(()=>({em:!document.getElementById('cvHistEmpty').hidden, t:document.getElementById('cvHistEmpty').textContent, grid:document.getElementById('cvHistGrid').hidden}));
  await p.screenshot({path:SH('03-busca-vazia')});
  await p.keyboard.press('Escape'); await sleep(200);
  const cleared={q:await p.evaluate(()=>document.getElementById('cvHistQ').value), n:(await cards(p)).length, view:(await cover(p)).view, act:await p.evaluate(()=>document.activeElement.id)};
  check('S02-14: “/” foca a busca; filtra por nome sem acento ("diag"); contagem “01 de 03 obras”', inSearch==='cvHistQ'&&s1.cards.length===1&&/Diagnóstico/.test(s1.cards[0])&&s1.count==='01 de 03 obras', s1);
  check('S02-15: na busca, dígitos e Backspace digitam (não trocam de vista)', stay.view==='hist', stay);
  check('S02-16: busca sem resultado mostra estado vazio com “Limpar busca”; Esc limpa e mantém a vista', none.em&&none.grid&&/Nenhuma obra com “diagzzz”/.test(none.t)&&/Limpar busca/.test(none.t)&&cleared.q===''&&cleared.n===3&&cleared.view==='hist'&&cleared.act==='cvHistQ', {none,cleared});
  await p.keyboard.press('Escape'); await sleep(300);
  check('S02-17: Esc com a busca vazia volta ao início', (await cover(p)).view==='home');
  await openHist(p);
  /* ordem por nome */
  await p.click('#cvHist [data-sort="name"]'); await sleep(200);
  const byName=(await cards(p)).map(c=>c.name), ls=await p.evaluate(()=>localStorage.getItem('canteiro.obrasOrdem'));
  await p.click('#cvHist [data-sort="recent"]'); await sleep(200);
  check('S02-18: ordenar por nome (pt-BR) e lembrar a escolha; voltar a “Recentes”', byName.join('|')==='Comitê de investimentos|Diagnóstico de maturidade digital|Plano de ação — Q4'&&ls==='name'&&(await cards(p))[0].id===C.id, {byName,ls});

  /* ===================== 3. renomear, duplicar, excluir, baixar ===================== */
  await p.focus(`#cvHistGrid .cv-hcard[data-id="${B.id}"] .cv-hopen`); await p.keyboard.press('F2'); await sleep(150);
  const rn=await p.evaluate(()=>({v:document.activeElement.value, cls:document.activeElement.className}));
  await p.keyboard.press('Control+a'); await p.keyboard.type('Plano de ação — 4º trimestre'); await p.screenshot({path:SH('04-renomear')}); await p.keyboard.press('Enter'); await sleep(500);
  R=await recs(p); let rb=R.find(r=>r.id===B.id);
  const kb=(await cards(p)).find(c=>c.id===B.id);
  check('S02-19: F2 renomeia no próprio cartão (Enter grava no acervo e no deck)', rn.cls==='cv-hrn'&&rn.v==='Plano de ação — Q4'&&rb.title==='Plano de ação — 4º trimestre'&&rb.dt==='Plano de ação — 4º trimestre'&&kb.name==='Plano de ação — 4º trimestre'&&await focusId(p)===B.id, {rn,rb,kb});
  await cardBtn(p,B.id,'ren'); await sleep(120); await p.keyboard.type(' xyz'); await p.keyboard.press('Escape'); await sleep(300);
  check('S02-20: Renomear + Esc cancela sem mudar nada (e Esc não sai da vista)', (await recs(p)).find(r=>r.id===B.id).title==='Plano de ação — 4º trimestre'&&(await cover(p)).view==='hist');
  await p.dblclick(`#cvHistGrid .cv-hcard[data-id="${A.id}"] .cv-hname`); await sleep(150);
  const dbl=await p.evaluate(()=>document.activeElement.className); await p.keyboard.press('Escape'); await sleep(150);
  check('S02-21: duplo clique no nome também abre o renomear', dbl==='cv-hrn', dbl);
  await cardBtn(p,C.id,'dup'); await sleep(600);
  K=await cards(p); R=await recs(p); const D=R.find(r=>r.title==='Comitê de investimentos (cópia)');
  check('S02-22: Duplicar cria uma obra nova (id próprio, “(cópia)”, mesmos slides) no topo e com foco', K.length===4&&!!D&&D.id!==C.id&&D.did===D.id&&D.n===6&&K[0].id===D.id&&await focusId(p)===D.id&&/duplicada/.test(await noteTxt(p)), {K,D});
  await p.keyboard.press('Delete'); await sleep(250);
  const cf=await p.evaluate(()=>({shown:!document.getElementById('cvConfirm').hidden, t:document.getElementById('cvCfT').textContent, d:document.getElementById('cvCfD').textContent, ok:document.getElementById('cvCfOk').textContent, f:document.activeElement.id}));
  await p.screenshot({path:SH('05-excluir-confirmacao')});
  await p.keyboard.press('Escape'); await sleep(250);
  const kept={n:await count(p), shown:await p.evaluate(()=>!document.getElementById('cvConfirm').hidden), f:await focusId(p)};
  check('S02-23: Delete pede confirmação A&M (“Excluir …?”, botão Excluir); Esc cancela e devolve o foco', cf.shown&&cf.t==='Excluir “Comitê de investimentos (cópia)”?'&&cf.ok==='Excluir'&&/Arquivos \.html já baixados não são afetados/.test(cf.d)&&cf.f==='cvCfOk'&&kept.n===4&&!kept.shown&&kept.f===D.id, {cf,kept});
  await cardBtn(p,D.id,'del'); await sleep(200); await p.click('#cvCfOk'); await sleep(500);
  K=await cards(p);
  check('S02-24: confirmar exclui do acervo e o foco vai para o cartão vizinho', K.length===3&&!K.find(c=>c.id===D.id)&&!(await p.evaluate(id=>AMHist.has(id),D.id))&&[C.id,B.id,A.id].indexOf(await focusId(p))>=0&&/excluída/.test(await noteTxt(p)), {K});
  const dl=await download(p,()=>cardBtn(p,A.id,'dl')); await sleep(200);
  check('S02-25: Baixar .html gera o arquivo autônomo da obra (am-deck-data, mesmo id, sem código do editor)', dl.name==='diagnostico-de-maturidade-digital.html'&&/id="am-deck-data"/.test(dl.text)&&dl.text.indexOf(A.id)>0&&/<title>Diagnóstico de maturidade digital<\/title>/.test(dl.text)&&!/onerror|onmouseover|onclick|AMHist|AMCover|window\.AMStudio\s*=/.test(dl.text), dl.name);
  const q=await page(ctx,'file://'+(()=>{ const f=path.join(TMP,dl.name); fs.writeFileSync(f,dl.text); return f; })(),'dl',900);
  check('S02-26: o .html baixado abre no player com os 7 slides', await q.evaluate(()=>document.querySelectorAll('.amp .amp-slide').length)===7);
  await q.close();

  /* ===================== 4. abrir e editar (capa inicial com rascunho já guardado) ===================== */
  await cardBtn(p,A.id,'open'); await sleep(900);
  const op=await p.evaluate(()=>({open:AMCover.isOpen(), cf:!document.getElementById('cvConfirm').hidden, id:AMStudio.deck.id, n:AMStudio.deck.slides.length, toast:document.getElementById('toast').textContent}));
  check('S02-27: “Abrir e editar” carrega a obra sem pedir confirmação (o rascunho já está no acervo)', !op.open&&!op.cf&&op.id===A.id&&op.n===7&&/Obra aberta: Diagnóstico de maturidade digital · 7 slides/.test(op.toast), op);
  const upA0=(await recs(p)).find(r=>r.id===A.id).up;
  check('S02-28: abrir pelo acervo não conta como edição (data mantida)', upA0===R.find(r=>r.id===A.id).up, [upA0]);
  const elsA0=(await recs(p)).find(r=>r.id===A.id).els;
  await p.evaluate(()=>{ const s=AMStudio.deck.slides[0]; s.els.push(AMStudio.mk.text('body',{html:'Nota S02'})); AMStudio.renderAll(); AMStudio.commit(); });
  await flush(p);
  let ra=(await recs(p)).find(r=>r.id===A.id);
  check('S02-29: editar a obra reaberta grava a nova versão no acervo', ra.els===elsA0+1&&ra.up>upA0, {ra,elsA0});
  /* Arquivo › Minhas obras… com a obra aberta */
  await menuFile(p,'Minhas obras…'); await until(p,()=>document.getElementById('cover').dataset.view==='hist'&&document.querySelectorAll('#cvHistGrid .cv-hcard').length===3); await sleep(200);
  const fe=await p.evaluate(id=>({back:document.querySelector('#cvHist [data-back]').textContent.replace(/\s+/g,' ').trim(), cur:document.querySelector('#cvHistGrid .cv-hcard[data-id="'+id+'"]').classList.contains('cv-hcur'), tag:(document.querySelector('#cvHistGrid .cv-hcard[data-id="'+id+'"] .cv-htag')||{}).textContent, hints:document.getElementById('cvHints').textContent}),A.id);
  check('S02-30: Arquivo › Minhas obras… abre a vista; a obra aberta vem marcada “Aberta no editor”; Voltar à obra', fe.cur&&fe.tag==='Aberta no editor'&&/^Voltar à obra/.test(fe.back)&&/voltar à obra/.test(fe.hints), fe);
  await p.screenshot({path:SH('06-vinda-do-editor')});
  await cardBtn(p,A.id,'ren'); await sleep(100); await p.keyboard.press('Control+a'); await p.keyboard.type('Diagnóstico — versão do comitê'); await p.keyboard.press('Enter'); await sleep(500);
  const tA=await p.evaluate(()=>({t:AMStudio.deck.title, f:document.getElementById('title').value}));
  check('S02-31: renomear a obra aberta muda também o título no editor', tA.t==='Diagnóstico — versão do comitê'&&tA.f===tA.t, tA);
  await p.keyboard.press('Escape'); await sleep(900);
  check('S02-32: Esc na vista aberta pelo menu volta direto à obra', !(await cover(p)).open&&await p.evaluate(id=>AMStudio.deck.id===id,A.id));
  /* trocar de obra a partir do editor: a atual fica guardada, sem confirmação */
  await p.evaluate(()=>{ const s=AMStudio.deck.slides[1]; s.els.push(AMStudio.mk.text('body',{html:'Nota 2'})); AMStudio.renderAll(); AMStudio.commit(); });
  await menuFile(p,'Minhas obras…'); await until(p,()=>document.querySelectorAll('#cvHistGrid .cv-hcard').length===3); await sleep(200);
  await p.focus(`#cvHistGrid .cv-hcard[data-id="${B.id}"] .cv-hopen`); await p.keyboard.press('Enter'); await sleep(900);
  ra=(await recs(p)).find(r=>r.id===A.id);
  const sw=await p.evaluate(()=>({open:AMCover.isOpen(), id:AMStudio.deck.id, cf:!document.getElementById('cvConfirm').hidden}));
  check('S02-33: Enter num cartão troca a obra do editor; a anterior fica guardada com a última edição (sem pedir confirmação)', !sw.open&&!sw.cf&&sw.id===B.id&&ra.els===elsA0+2, {sw,ra});
  /* persistência entre recargas */
  await go(p, FILE, 1400); await openHist(p);
  K=await cards(p); ra=(await recs(p)).find(r=>r.id===A.id);
  check('S02-34: depois de recarregar, as 3 obras seguem lá com as edições (2 notas a mais em A, novo nome)', K.length===3&&ra.els===elsA0+2&&ra.title==='Diagnóstico — versão do comitê', {K:K.map(c=>c.name),ra});
  /* exportar acervo */
  const ex=await download(p,()=>p.click('#cvHistExp')); await sleep(200);
  let EX=null; try{ EX=JSON.parse(ex.text); }catch(e){}
  check('S02-35: Exportar acervo baixa um .json com todas as obras', /^canteiro-acervo-\d{4}-\d{2}-\d{2}\.json$/.test(ex.name)&&EX&&EX.kind==='canteiro-acervo'&&EX.count===3&&EX.obras.map(o=>o.id).sort().join()===[A.id,B.id,C.id].sort().join()&&EX.obras.every(o=>o.deck&&o.deck.slides.length===o.slideCount&&o.updatedAt>0&&o.createdAt>0), {name:ex.name, count:EX&&EX.count});
  const exFile=path.join(TMP,ex.name); fs.writeFileSync(exFile,ex.text);
  /* sem rascunho: “Retomar obra” usa a obra mais recente */
  await p.evaluate(()=>{ localStorage.removeItem('amStudio.draft'); }); await go(p, FILE, 1500);
  const o3=await p.evaluate(()=>{ const b=document.querySelector('.cv-opt[data-k="3"]'); return {dis:b.getAttribute('aria-disabled'), t:b.textContent.replace(/\s+/g,' '), has:b.classList.contains('cv-has')}; });
  const top1=(await recs(p))[0];
  check('S02-36: sem rascunho, a opção 3 “Retomar obra” mostra a obra mais recente', o3.dis!=='true'&&o3.has&&/Retomar obra/.test(o3.t)&&o3.t.indexOf(top1.title.slice(0,18))>=0&&/slides? ·/.test(o3.t), {o3,top1:top1.title});
  await p.screenshot({path:SH('07-capa-retomar-obra')});
  await p.keyboard.press('3'); await sleep(900);
  check('S02-37: tecla 3 abre a obra mais recente', await p.evaluate(id=>!AMCover.isOpen()&&AMStudio.deck.id===id,top1.id));
  await ctx.close();

  /* ===================== 5. outro computador: vazio → importar acervo ===================== */
  const ctx2=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  p=await page(ctx2, FILE, 'imp', 1400);
  check('S02-38: navegador novo: botão sem contagem e “Retomar obra” desabilitado (sem rascunho nem obra)', await p.evaluate(()=>document.getElementById('cvHistN').textContent===''&&document.querySelector('.cv-opt[data-k="3"]').getAttribute('aria-disabled')==='true'));
  await openHist(p);
  const em=await p.evaluate(()=>({em:!document.getElementById('cvHistEmpty').hidden, t:document.getElementById('cvHistEmpty').textContent, btns:[...document.querySelectorAll('#cvHistEmpty button')].map(b=>b.textContent), exp:document.getElementById('cvHistExp').disabled, q:document.getElementById('cvHistQ').disabled, imp:document.getElementById('cvHistImp').disabled, f:document.activeElement.textContent}));
  check('S02-39: acervo vazio: estado vazio com Obra nova / Projetos prontos / Importar acervo; exportar e buscar desabilitados', em.em&&/Nenhuma obra guardada ainda/.test(em.t)&&em.btns.join('|')==='Obra nova|Projetos prontos|Importar acervo'&&em.exp&&em.q&&!em.imp&&em.f==='Obra nova', em);
  await p.screenshot({path:SH('08-vazio')});
  let [ic]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}), p.click('#cvHistImp')]); await ic.setFiles(exFile); await sleep(900);
  K=await cards(p);
  check('S02-40: Importar acervo traz as 3 obras com os mesmos ids e datas', K.length===3&&K.map(c=>c.id).sort().join()===[A.id,B.id,C.id].sort().join()&&/Acervo importado: 3 obras novas/.test(await noteTxt(p)), {K, note:await noteTxt(p)});
  const imp1=(await recs(p)).map(r=>r.id+':'+r.up).sort().join(), exp1=EX.obras.map(o=>o.id+':'+o.updatedAt).sort().join();
  check('S02-41: datas de edição preservadas na importação', imp1===exp1, {imp1,exp1});
  [ic]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}), p.click('#cvHistImp')]); await ic.setFiles(exFile); await sleep(700);
  check('S02-42: importar de novo não duplica (“3 já estavam em dia”)', (await cards(p)).length===3&&/Nada novo: 3 já estavam em dia/.test(await noteTxt(p)), await noteTxt(p));
  /* o mais novo vence */
  const mx=JSON.parse(ex.text), oA=mx.obras.find(o=>o.id===A.id), oB=mx.obras.find(o=>o.id===B.id);
  oA.title='A mais nova'; oA.deck.title='A mais nova'; oA.updatedAt+=60000;
  oB.title='B mais velha'; oB.deck.title='B mais velha'; oB.updatedAt-=60000;
  mx.obras.push({id:'s02evil', title:'<img src=x onerror="window.__xss=1">Obra “estranha”', updatedAt:Date.now(), deck:{title:'x', slides:[{bg:'#FFFFFF', els:[{type:'text',id:'t1',x:10,y:10,w:400,h:60,html:'Oi <img src=x onerror="window.__xss=2"><b onclick="x()">ok</b>'}]}]}});
  mx.obras.push({id:'s02bad', deck:{slides:'nada'}});
  const mxFile=path.join(TMP,'acervo-misto.json'); fs.writeFileSync(mxFile,JSON.stringify(mx));
  [ic]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}), p.click('#cvHistImp')]); await ic.setFiles(mxFile); await sleep(900);
  R=await recs(p);
  const nt=await noteTxt(p), ev=R.find(r=>r.id==='s02evil');
  check('S02-43: juntar por id — o mais novo vence (A atualizada, B e C mantidas), obra nova entra, inválida é ignorada', R.length===4&&R.find(r=>r.id===A.id).title==='A mais nova'&&R.find(r=>r.id===B.id).title!=='B mais velha'&&!!ev&&/1 obra nova · 1 atualizada · 2 já estavam em dia · 1 ignorada/.test(nt), {nt, titles:R.map(r=>r.title)});
  const xss=await p.evaluate(()=>({x:window.__xss, img:!!document.querySelector('#cvHistGrid img[src="x"]'), name:(document.querySelector('#cvHistGrid .cv-hcard[data-id="s02evil"] .cv-hname')||{}).textContent}));
  const evDeck=await p.evaluate(()=>AMHist.get('s02evil').then(r=>r.deck.slides[0].els.map(e=>e.html).join('')));
  check('S02-44: dados importados chegam limpos (título só como texto, HTML sem on*, nada executa)', xss.x===undefined&&!xss.img&&/^<img src=x onerror/.test(xss.name||'')&&!/onerror|onclick/.test(evDeck), {xss,evDeck:evDeck.slice(0,200)});
  const badF=path.join(TMP,'nao-e-acervo.json'); fs.writeFileSync(badF,'isto não é json');
  [ic]=await Promise.all([p.waitForEvent('filechooser',{timeout:4000}), p.click('#cvHistImp')]); await ic.setFiles(badF); await sleep(500);
  check('S02-45: arquivo que não é acervo: aviso e nada muda', /não é um acervo do Canteiro/.test(await noteTxt(p))&&await count(p)===4);
  await ctx2.close();

  /* ===================== 6. ?nocover e tamanhos de tela ===================== */
  const ctx3=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
  p=await page(ctx3, FILE+'?nocover', 'nc');
  await p.evaluate(()=>{ for(let i=0;i<5;i++){ const d=AMCover.buildTemplate(i); d.title=d.title+' · v'+(i+1); AMStudio.loadDeck(d); } }); await sleep(300); await until(p,()=>AMHist.count()===5);
  await p.evaluate(()=>AMStudio.loadDeck(AMCover.buildTemplate(1))); await until(p,()=>AMHist.count()===6);
  await p.evaluate(()=>{ const d=AMHist.metas(); return Promise.all(d.slice(0,2).map(m=>AMHist.duplicate(m.id))); }); await until(p,()=>AMHist.count()===8);
  await menuFile(p,'Minhas obras…'); await until(p,()=>document.querySelectorAll('#cvHistGrid .cv-hcard').length===8); await sleep(400);
  const fit=await p.evaluate(()=>{ const c=document.getElementById('cover'), g=document.getElementById('cvHistGrid'); return {view:c.dataset.view, sh:c.scrollHeight, ch:c.clientHeight, sw:c.scrollWidth, cw:c.clientWidth, gs:g.scrollHeight>g.clientHeight, top:document.querySelector('.cv-top').scrollWidth<=document.querySelector('.cv-top').clientWidth}; });
  check('S02-46: ?nocover: Arquivo › Minhas obras… abre a capa direto no acervo', fit.view==='hist');
  check('S02-47: 1280×720 com 8 obras: a página não rola (a grade rola por dentro) e o topo não transborda', fit.sh<=fit.ch+1&&fit.sw<=fit.cw&&fit.gs&&fit.top, fit);
  await p.screenshot({path:SH('09-minhas-obras-1280x720')});
  await p.keyboard.press('Escape'); await sleep(900);
  check('S02-48: Esc volta ao editor', !(await cover(p)).open);
  for(const [w,h] of [[1024,768],[390,844]]){
    await p.setViewportSize({width:w,height:h}); await sleep(200);
    await p.evaluate(()=>AMCover.open()); await sleep(900);
    const tb=await p.evaluate(()=>{ const c=document.getElementById('cover'), t=document.querySelector('.cv-top'); return {resume:!document.getElementById('cvResume').hidden, sw:c.scrollWidth, cw:c.clientWidth, tw:t.scrollWidth, tcw:t.clientWidth, hb:document.getElementById('cvHistBtn').getBoundingClientRect().right<=innerWidth}; });
    check(`S02-49: ${w}×${h}, capa vinda do editor (com “Voltar à obra”): o topo cabe com o botão Minhas obras`, tb.resume&&tb.sw<=tb.cw&&tb.tw<=tb.tcw&&tb.hb, tb);
    await p.screenshot({path:SH(`10-capa-editor-${w}x${h}`)});
    await openHist(p);
    const m=await p.evaluate(()=>{ const c=document.getElementById('cover'); return {sw:c.scrollWidth, cw:c.clientWidth, cards:document.querySelectorAll('#cvHistGrid .cv-hcard').length}; });
    check(`S02-50: ${w}×${h}: Minhas obras sem rolagem horizontal`, m.sw<=m.cw&&m.cards===8, m);
    await p.screenshot({path:SH(`11-minhas-obras-${w}x${h}`)});
    await p.keyboard.press('Escape'); await sleep(200); await p.keyboard.press('Escape'); await sleep(900);
  }
  const exp=await p.evaluate(()=>AMStudio.exportHTML());
  check('S02-51: o arquivo exportado continua autônomo (sem history.js, sem capa, sem on*)', /id="am-deck-data"/.test(exp)&&!/AMHist|canteiro\.obras|AMCover|window\.AMStudio\s*=|onerror|onmouseover|onclick/.test(exp));
  await ctx3.close();

  /* ===================== 7. caminhos de erro: nunca lançam ===================== */
  /* sem IndexedDB → localStorage */
  for(const how of ['ausente','lanca']){
    const c4=await b.newContext({viewport:{width:1440,height:900}});
    await c4.addInitScript(h=>{ try{ Object.defineProperty(window,'indexedDB',{configurable:true,get(){ if(h==='ausente') return undefined; return {open(){ throw new Error('SecurityError simulado'); }}; }}); }catch(e){} },how);
    p=await page(c4, FILE+'?nocover', 'ls-'+how);
    const k=await p.evaluate(()=>AMHist.ready);
    await p.evaluate(()=>AMStudio.loadDeck(AMCover.buildTemplate(0))); await sleep(200); await flush(p);
    const ls=await p.evaluate(()=>{ const o=JSON.parse(localStorage.getItem('canteiro.obras')||'{}'); return Object.keys(o.obras||{}).length; });
    await go(p, FILE, 1400); await openHist(p);
    check(`S02-52: IndexedDB ${how}: o acervo usa o localStorage e sobrevive à recarga`, k==='ls'&&ls===1&&(await cards(p)).length===1, {k,ls});
    await c4.close();
  }
  /* cota esgotada no IndexedDB */
  { const c5=await b.newContext({viewport:{width:1440,height:900}});
    p=await page(c5, FILE+'?nocover', 'quota');
    await p.evaluate(()=>AMHist.ready);
    const r=await p.evaluate(async()=>{ IDBObjectStore.prototype.put=function(){ throw new DOMException('cota simulada','QuotaExceededError'); };
      AMStudio.loadDeck(AMCover.buildTemplate(2)); const s=AMStudio.deck.slides[0]; s.els.push(AMStudio.mk.text('body')); AMStudio.renderAll(); AMStudio.commit();
      const ok=await AMHist.flush(); await new Promise(x=>setTimeout(x,100)); return {ok, n:AMHist.count(), toast:document.getElementById('toast').textContent}; });
    check('S02-53: cota esgotada: nada lança, flush devolve false e um aviso honesto aparece', r.ok===false&&r.n===0&&/Sem espaço no navegador para guardar esta obra em Minhas obras/.test(r.toast), r);
    const sv2=await p.evaluate(()=>{ try{ AMStudio.commit(); return AMHist.saveNow().then(v=>'ok:'+v); }catch(e){ return 'threw '+e.message; } });
    check('S02-54: depois da falha, o editor segue funcionando (salvar no acervo só devolve false)', sv2==='ok:false', sv2);
    await c5.close(); }
  /* nada disponível (sem IndexedDB e localStorage recusando gravação) */
  { const c6=await b.newContext({viewport:{width:1440,height:900}});
    await c6.addInitScript(()=>{ try{ Object.defineProperty(window,'indexedDB',{configurable:true,get(){ return undefined; }}); Storage.prototype.setItem=function(){ throw new DOMException('cota','QuotaExceededError'); }; }catch(e){} });
    p=await page(c6, FILE, 'none', 1400);
    const k=await p.evaluate(()=>AMHist.ready);
    await openHist(p);
    const off=await p.evaluate(()=>({t:document.getElementById('cvHistEmpty').textContent, imp:document.getElementById('cvHistImp').disabled, n:document.getElementById('cvHistN').textContent, cnt:document.getElementById('cvHistCount').textContent}));
    await p.screenshot({path:SH('12-indisponivel')});
    await p.keyboard.press('Escape'); await sleep(300); await p.keyboard.press('1'); await sleep(900);
    const ed=await p.evaluate(async()=>{ try{ const s=AMStudio.deck.slides[0]; s.els.push(AMStudio.mk.text('body')); AMStudio.renderAll(); AMStudio.commit(); const f=await AMHist.flush(); const pr=await AMHist.put(JSON.parse(JSON.stringify(AMStudio.deck))); return {f, pr}; }catch(e){ return 'threw '+e.message; } });
    check('S02-55: sem armazenamento: “Histórico indisponível neste navegador”, importar desabilitado, editor intacto', k==='none'&&/Histórico indisponível neste navegador/.test(off.t)&&off.imp&&off.n===''&&off.cnt==='Indisponível'&&ed&&ed.f===false&&ed.pr===null, {k,off,ed});
    await c6.close(); }

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', results.length+' verificações', JSON.stringify({errs}));
  await b.close(); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(_){} process.exit(2); });
