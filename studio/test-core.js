process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SH=f=>path.join(__dirname,'shots','c-'+f+'.png');
const results=[]; let failed=0;
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info):'')); if(!ok) failed++; }

(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  await ctx.grantPermissions(['clipboard-read','clipboard-write']);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message)); p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load/.test(m.text()))errs.push(m.text())});
  await p.goto('file://'+path.join(__dirname,'AM-Studio-Editor.html')+'?nocover'); await sleep(700);
  // conta eventos nativos de área de transferência (prova que o caminho real foi usado)
  await p.evaluate(()=>{ window.__cb={copy:0,cut:0,paste:0}; ['copy','cut','paste'].forEach(k=>document.addEventListener(k,()=>window.__cb[k]++,true)); });

  const cur=()=>p.evaluate(()=>+document.querySelector('#thumbs .th.on').dataset.i);
  const els=()=>p.evaluate(()=>{const i=+document.querySelector('#thumbs .th.on').dataset.i; return AMStudio.deck.slides[i].els.map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,w:e.w,h:e.h,html:e.html,x1:e.x1,y1:e.y1}));});
  const selected=()=>p.evaluate(()=>AMStudio.selected());
  const nSlides=()=>p.evaluate(()=>AMStudio.deck.slides.length);
  const box=async id=>{ const h=await p.$('#wrap .am-stage .am-el[data-id="'+id+'"]'); return h.boundingBox(); };
  const center=async id=>{ const bb=await box(id); return {x:bb.x+bb.width/2,y:bb.y+bb.height/2}; };
  const wb=await (await p.$('#wrap')).boundingBox();
  const L=(x,y)=>({x:wb.x+x/1280*wb.width, y:wb.y+y/720*wb.height}); // lógico -> tela
  const openMenu=async(k)=>{ await p.click('#mbar [data-m='+k+']'); await sleep(220); };
  const menuItem=async(label)=>{ const it=p.locator('.xmenu .xi',{hasText:label}).last(); await it.hover(); await sleep(150); await it.click(); await sleep(200); };
  const subItem=async(parent,label)=>{ const pi=p.locator('.xmenu .xi',{hasText:parent}).first(); await pi.hover(); await sleep(260); const it=p.locator('.xmenu',{has:p.locator('.xi',{hasText:label})}).last().locator('.xi',{hasText:label}).first(); await it.hover(); await sleep(120); await it.click(); await sleep(220); };

  // ---------- 1. menus do app: inserir forma via submenu ----------
  await openMenu('insert'); await p.locator('.xmenu .xi',{hasText:'Forma'}).hover(); await sleep(350);
  await p.screenshot({path:SH('01-menu-inserir-forma')});
  const shp=p.locator('.xmenu').last().locator('.xi',{hasText:'Retângulo'}).first(); await shp.hover(); await sleep(100); await shp.click(); await sleep(250);
  let E=await els(); check('Inserir > Forma > Retângulo cria forma', E.length===1 && E[0].type==='shape', E.length);
  const A=E[0];

  // ---------- 2. Ctrl+C / Ctrl+V ----------
  await p.mouse.click((await center(A.id)).x,(await center(A.id)).y); await sleep(100);
  await p.keyboard.press('Control+c'); await sleep(150);
  const clipHtml=async()=>p.evaluate(async()=>{ for(const it of await navigator.clipboard.read()) if(it.types.includes('text/html')) return (await it.getType('text/html')).text(); return ''; });
  const sys1=await p.evaluate(()=>navigator.clipboard.readText()), h1=await clipHtml();
  check('Ctrl+C: texto legível no text/plain e conteúdo do Canteiro no text/html (data-amstudio)', !sys1.startsWith('AMSTUDIO') && /data-amstudio=/.test(h1), [sys1.slice(0,40), h1.slice(0,40)]);
  await p.keyboard.press('Control+v'); await sleep(200);
  await p.keyboard.press('Control+v'); await sleep(200);
  E=await els();
  const ids=new Set(E.map(e=>e.id));
  check('Ctrl+V duas vezes: 3 formas, ids únicos', E.length===3 && ids.size===3, E.length);
  check('Colagens em cascata (+24, +48)', E[1].x===A.x+24 && E[1].y===A.y+24 && E[2].x===A.x+48 && E[2].y===A.y+48, E.map(e=>[e.x,e.y]));
  check('Colado fica selecionado', (await selected())[0]===E[2].id);
  const cbCounts=await p.evaluate(()=>window.__cb);
  check('Eventos nativos copy/paste recebidos', cbCounts.copy>=1 && cbCounts.paste>=2, cbCounts);
  // undo de colagem = 1 passo
  await p.keyboard.press('Control+z'); await sleep(150); E=await els(); check('Ctrl+Z desfaz uma colagem', E.length===2, E.length);
  await p.keyboard.press('Control+Shift+z'); await sleep(150); E=await els(); check('Ctrl+Shift+Z refaz', E.length===3, E.length);

  // ---------- 3. Ctrl+X ----------
  const last=E[2]; await p.mouse.click((await center(last.id)).x,(await center(last.id)).y); await sleep(100);
  await p.keyboard.press('Control+x'); await sleep(200); E=await els(); check('Ctrl+X remove o elemento', E.length===2 && !E.find(e=>e.id===last.id), E.length);
  await p.keyboard.press('Control+v'); await sleep(200); E=await els(); const pastedCut=E[E.length-1];
  check('Colar após recortar volta à mesma posição', E.length===3 && pastedCut.x===last.x && pastedCut.y===last.y && pastedCut.id!==last.id, [pastedCut.x,pastedCut.y,last.x,last.y]);
  check('Evento nativo cut recebido', (await p.evaluate(()=>window.__cb.cut))>=1);

  // ---------- 4. colar texto externo ----------
  await p.evaluate(()=>navigator.clipboard.writeText('Texto vindo de fora\nsegunda linha do e-mail'));
  await p.mouse.click(L(60,690).x,L(60,690).y); await sleep(100);
  await p.keyboard.press('Control+v'); await sleep(300); E=await els(); const tx=E[E.length-1];
  check('Ctrl+V de texto externo cria caixa de texto', tx.type==='text' && /Texto vindo de fora<br>segunda linha/.test(tx.html), tx.html);
  check('Texto externo centralizado e selecionado', Math.abs(tx.x+tx.w/2-640)<=1 && (await selected())[0]===tx.id, [tx.x,tx.w]);
  await p.screenshot({path:SH('02-colar-texto-externo')});

  // ---------- 5. seleção múltipla: shift+clique e laço ----------
  E=await els(); const s0=E[0], s1=E[1];
  await p.mouse.click(L(30,30).x,L(30,30).y); await sleep(80);
  // pontos exclusivos de cada forma (as formas se sobrepõem em cascata)
  const c0=L(s0.x+8,s0.y+8), c1=L(s1.x+6,s1.y+s1.h-6);
  await p.mouse.click(c0.x,c0.y); await sleep(80);
  await p.keyboard.down('Shift'); await p.mouse.click(c1.x,c1.y); await p.keyboard.up('Shift'); await sleep(150);
  let S=await selected(); check('Shift+clique soma à seleção', S.length===2 && S.includes(s0.id) && S.includes(s1.id), S);
  await p.screenshot({path:SH('03-shift-clique')});
  const pp=await p.evaluate(()=>document.querySelector('#props .ph h2').textContent);
  check('Painel mostra "2 elementos selecionados"', /2 elementos selecionados/.test(pp), pp);
  await p.screenshot({path:SH('03b-painel-multi'), clip:{x:1136,y:104,width:304,height:796}});
  // shift+clique de novo retira
  await p.keyboard.down('Shift'); await p.mouse.click(c1.x,c1.y); await p.keyboard.up('Shift'); await sleep(120);
  S=await selected(); check('Shift+clique num selecionado retira da seleção', S.length===1 && S[0]===s0.id, S);
  // laço
  await p.mouse.click(L(20,20).x,L(20,20).y); await sleep(80);
  const m0=L(20,20), m1=L(1100,520);
  await p.mouse.move(m0.x,m0.y); await p.mouse.down(); await p.mouse.move((m0.x+m1.x)/2,(m0.y+m1.y)/2,{steps:6}); await p.mouse.move(m1.x,m1.y,{steps:6}); await sleep(80);
  await p.screenshot({path:SH('04-laco')});
  await p.mouse.up(); await sleep(150);
  S=await selected(); E=await els();
  const inRect=E.filter(e=>e.x<1100&&e.x+e.w>20&&e.y<520&&e.y+e.h>20).map(e=>e.id);
  check('Laço seleciona os elementos tocados', S.length===inRect.length && inRect.every(i=>S.includes(i)) && S.length>=3, {S:S.length,expect:inRect.length});
  await p.screenshot({path:SH('05-laco-resultado')});

  // ---------- 6. mover grupo (arrastar + setas) ----------
  const before=await els(); const sel0=await selected();
  let g=await center(sel0[0]); await p.mouse.move(g.x,g.y); await p.mouse.down(); await p.mouse.move(g.x+60,g.y+40,{steps:5}); await p.mouse.move(g.x+110,g.y+70,{steps:5}); await p.mouse.up(); await sleep(150);
  let after=await els(); const deltas=sel0.map(id=>{const a=before.find(e=>e.id===id), z=after.find(e=>e.id===id); return [z.x-a.x,z.y-a.y];});
  check('Arrastar move o grupo inteiro pelo mesmo deslocamento', deltas.every(d=>d[0]===deltas[0][0]&&d[1]===deltas[0][1]) && deltas[0][0]>80, deltas[0]);
  check('Seleção mantida após mover', (await selected()).length===sel0.length);
  const b2=await els();
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Shift+ArrowDown'); await sleep(500);
  after=await els(); const d2=sel0.map(id=>{const a=b2.find(e=>e.id===id), z=after.find(e=>e.id===id); return [z.x-a.x,z.y-a.y];});
  check('Setas movem o grupo (3 px, Shift = 10 px)', d2.every(d=>d[0]===3&&d[1]===10), d2[0]);

  // ---------- 7. alinhar / distribuir ----------
  await openMenu('arrange'); await p.screenshot({path:SH('06-menu-organizar')});
  await subItem('Alinhar','Topo'); after=await els();
  const tops=sel0.map(id=>{const e=after.find(x=>x.id===id); return e.type==='line'?Math.min(e.y1,e.y2):e.y;});
  check('Organizar > Alinhar > Topo alinha à seleção', tops.every(t=>t===tops[0]), tops);
  const hb=await p.evaluate(()=>{AMStudio.select(null); return 1;});
  // três formas para distribuir
  await p.evaluate(()=>{ const s=AMStudio.deck.slides[+document.querySelector('#thumbs .th.on').dataset.i]; });
  await p.evaluate(()=>{ AMStudio.addSlide('blank-light'); });
  for (const x of [80,300,900]) { await openMenu('insert'); await subItem('Forma','Elipse'); await p.evaluate(x=>{ const id=AMStudio.selected()[0]; const i=+document.querySelector('#thumbs .th.on').dataset.i; const e=AMStudio.deck.slides[i].els.find(e=>e.id===id); e.x=x; e.y=200+x/10; e.w=160; AMStudio.renderAll(); AMStudio.commit(); },x); }
  await p.keyboard.press('Control+a'); await sleep(150);
  S=await selected(); check('Ctrl+A seleciona tudo no slide', S.length===3, S.length);
  await p.click('#props [data-act="dist-h"]'); await sleep(200); E=await els();
  const xs=E.map(e=>[e.x,e.w]).sort((a,b)=>a[0]-b[0]); const gap1=xs[1][0]-(xs[0][0]+xs[0][1]), gap2=xs[2][0]-(xs[1][0]+xs[1][1]);
  check('Distribuir horizontal deixa espaços iguais', Math.abs(gap1-gap2)<=1, [gap1,gap2]);
  await p.click('#props [data-act="al-m"]'); await sleep(150); E=await els();
  check('Centralizar na vertical (painel) alinha os centros', E.every(e=>Math.abs((e.y+e.h/2)-(E[0].y+E[0].h/2))<=1), E.map(e=>e.y));
  await p.screenshot({path:SH('07-distribuido')});
  // apagar o grupo + desfazer em 1 passo
  await p.keyboard.press('Delete'); await sleep(150); E=await els(); check('Delete apaga o grupo', E.length===0, E.length);
  await p.keyboard.press('Control+z'); await sleep(200); E=await els(); check('Ctrl+Z restaura o grupo em 1 passo', E.length===3, E.length);
  // duplicar o grupo
  await p.keyboard.press('Control+a'); await p.keyboard.press('Control+d'); await sleep(200); E=await els();
  check('Ctrl+D duplica o grupo', E.length===6 && (await selected()).length===3, E.length);
  await p.keyboard.press('Control+z'); await sleep(150);
  // copiar grupo e colar em outro slide (mesma posição)
  await p.keyboard.press('Control+a'); await p.keyboard.press('Control+c'); await sleep(120);
  const grpBefore=await els();
  await p.evaluate(()=>AMStudio.addSlide('blank-dark')); await sleep(150);
  await p.keyboard.press('Control+v'); await sleep(250); E=await els();
  check('Colar grupo em outro slide mantém posições', E.length===3 && E.every((e,i)=>e.x===grpBefore[i].x && e.y===grpBefore[i].y), E.map(e=>e.x));

  // ---------- 8. slides pelas miniaturas ----------
  let n0=await nSlides(); const ci=await cur();
  await p.click('#thumbs .th.on .box'); await sleep(120);
  await p.screenshot({path:SH('08-miniatura-em-foco'), clip:{x:0,y:104,width:400,height:500}});
  await p.keyboard.press('Control+c'); await sleep(150); await p.keyboard.press('Control+v'); await sleep(300);
  let n1=await nSlides(); const deckIds=await p.evaluate(()=>AMStudio.deck.slides.map(s=>s.id));
  const copyEls=await p.evaluate(i=>[AMStudio.deck.slides[i].els.map(e=>e.id),AMStudio.deck.slides[i+1].els.map(e=>e.id)],ci);
  check('Miniatura: Ctrl+C/Ctrl+V cola slide depois do atual', n1===n0+1 && (await cur())===ci+1 && new Set(deckIds).size===deckIds.length, {n0,n1});
  check('Slide colado com ids novos', copyEls[0].length===copyEls[1].length && copyEls[1].every(id=>!copyEls[0].includes(id)), copyEls);
  await p.keyboard.press('Control+d'); await sleep(200); check('Miniatura: Ctrl+D duplica slide', (await nSlides())===n1+1);
  await p.keyboard.press('Delete'); await sleep(200); check('Miniatura: Delete apaga slide', (await nSlides())===n1);
  await p.keyboard.press('Control+x'); await sleep(200); check('Miniatura: Ctrl+X recorta slide', (await nSlides())===n1-1);
  await p.keyboard.press('Control+z'); await sleep(200); check('Ctrl+Z desfaz recorte de slide', (await nSlides())===n1);
  // nunca apagar o último slide
  const nn=await nSlides(); for(let i=0;i<nn+1;i++){ await p.click('#thumbs .th.on .box'); await p.keyboard.press('Delete'); await sleep(120); }
  check('Nunca apaga o último slide', (await nSlides())===1);
  for(let i=0;i<nn-1;i++){ await p.keyboard.press('Control+z'); await sleep(60);} await sleep(200);
  check('Desfazer restaura os slides apagados', (await nSlides())===nn, await nSlides());

  // ---------- 9. menus de contexto ----------
  await p.click('#thumbs .th[data-i="0"] .box'); await sleep(200);
  E=await els(); const ce=E[0];
  let cc=await center(ce.id); await p.mouse.click(cc.x,cc.y,{button:'right'}); await sleep(250);
  await p.screenshot({path:SH('09-contexto-elemento')});
  check('Menu de contexto do elemento', await p.locator('.xmenu .xi',{hasText:'Trazer para frente'}).count()===1);
  await p.locator('.xmenu .xi',{hasText:'Alinhar'}).hover(); await sleep(300); await p.screenshot({path:SH('09b-contexto-alinhar')});
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await sleep(100);
  check('Esc fecha o menu de contexto', await p.locator('.xmenu').count()===0);
  const emptyPt=L(1180,640); await p.mouse.click(emptyPt.x,emptyPt.y,{button:'right'}); await sleep(250);
  await p.screenshot({path:SH('10-contexto-vazio')});
  await menuItem('Inserir texto aqui'); await p.keyboard.type('Nota no canto'); await p.mouse.click(L(640,700).x,L(640,700).y); await sleep(200);
  E=await els(); const nt=E.find(e=>/Nota no canto/.test(e.html||''));
  check('Contexto vazio > Inserir texto aqui (no ponto clicado)', !!nt && Math.abs(nt.x-Math.min(1180-6,1280-440))<=2, nt&&[nt.x,nt.y]);
  // colar texto externo pelo menu de contexto, no ponto
  await p.evaluate(()=>navigator.clipboard.writeText('Colado pelo menu'));
  const cp=L(200,560); await p.mouse.click(cp.x,cp.y,{button:'right'}); await sleep(200); await menuItem('Colar'); await sleep(250);
  E=await els(); const cm=E.find(e=>/Colado pelo menu/.test(e.html||''));
  check('Contexto > Colar texto no ponto do clique', !!cm && Math.abs(cm.x-200)<=2 && Math.abs(cm.y-560)<=2, cm&&[cm.x,cm.y]);
  // miniatura
  const nb=await nSlides();
  const th=await p.$('#thumbs .th[data-i="0"] .box'); const tb=await th.boundingBox(); await p.mouse.click(tb.x+tb.width/2,tb.y+tb.height/2,{button:'right'}); await sleep(250);
  await p.screenshot({path:SH('11-contexto-miniatura')});
  await menuItem('Duplicar slide'); check('Contexto miniatura > Duplicar slide', (await nSlides())===nb+1);
  await p.mouse.click(tb.x+tb.width/2,tb.y+tb.height/2+0,{button:'right'}); await sleep(200); await menuItem('Mover para baixo');
  check('Contexto miniatura > Mover para baixo', (await cur())===1);
  // fica dentro da tela
  await p.mouse.click(1128,894,{button:'right'}); await sleep(150);
  const inView=await p.evaluate(()=>{const m=document.querySelector('.xmenu'); if(!m) return 'sem menu'; const r=m.getBoundingClientRect(); return r.right<=innerWidth&&r.bottom<=innerHeight&&r.left>=0&&r.top>=0;});
  check('Menu de contexto fica dentro da janela', inView===true, inView);
  await p.keyboard.press('Escape');

  // ---------- 10. menus do app: screenshot de cada um + hover-switch + teclado ----------
  await p.click('#thumbs .th[data-i="0"] .box'); E=await els(); cc=await center(E[0].id); await p.mouse.click(cc.x,cc.y); await sleep(100);
  for (const k of ['file','edit','insert','slide','arrange','present','help']) { await openMenu(k); await p.screenshot({path:SH('12-menu-'+k)}); await p.click('#mbar [data-m='+k+']'); await sleep(120); }
  await openMenu('file'); await p.hover('#mbar [data-m=edit]'); await sleep(200);
  check('Hover troca entre menus abertos', await p.evaluate(()=>document.querySelector('#mbar [data-m=edit]').classList.contains('open')) && await p.locator('.xmenu .xi',{hasText:'Desfazer'}).count()===1);
  await p.keyboard.press('ArrowRight'); await sleep(150);
  check('Seta direita vai para o próximo menu', await p.evaluate(()=>document.querySelector('#mbar [data-m=insert]').classList.contains('open')));
  // o menu aberto pelo teclado já destaca o 1º item (Título)
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await sleep(100);
  const hot=await p.evaluate(()=>{const h=document.querySelector('.xmenu .xi.hot .xl'); return h&&h.textContent;});
  check('Setas navegam itens do menu', hot==='Texto corrido', hot);
  const cnt0=(await els()).length; await p.keyboard.press('Enter'); await sleep(250); await p.keyboard.press('Escape'); await sleep(150);
  check('Enter ativa item do menu (Inserir > Texto)', (await els()).length===cnt0+1);
  await openMenu('edit'); const dis=await p.evaluate(()=>[...document.querySelectorAll('.xmenu .xi.dis .xl')].map(x=>x.textContent)); await p.keyboard.press('Escape');
  check('Itens desativados quando não se aplicam', Array.isArray(dis), dis);

  // ---------- 11. duplo clique cria texto + digitar para editar ----------
  await p.evaluate(()=>AMStudio.addSlide('blank-light')); await sleep(150);
  let h0=await p.evaluate(()=>document.querySelector('#bUndo').disabled);
  const dpt=L(300,300); await p.mouse.dblclick(dpt.x,dpt.y); await sleep(200);
  await p.screenshot({path:SH('13-duplo-clique-texto')});
  await p.keyboard.type('Canteiro em obra'); await sleep(100);
  await p.screenshot({path:SH('13b-digitando')});
  await p.mouse.click(L(1200,680).x,L(1200,680).y); await sleep(200);
  E=await els(); check('Duplo clique no vazio cria texto e já digita', E.length===1 && E[0].type==='text' && E[0].html==='Canteiro em obra' && Math.abs(E[0].x-294)<=2, E[0]);
  const histBefore=await p.evaluate(()=>AMStudio.deck.slides.length);
  await p.mouse.dblclick(L(700,500).x,L(700,500).y); await sleep(150); await p.mouse.click(L(1200,680).x,L(1200,680).y); await sleep(150);
  E=await els(); check('Caixa vazia some ao sair', E.length===1, E.length);
  await p.keyboard.press('Control+z'); await sleep(150); E=await els();
  check('Desfazer após caixa vazia desfaz o texto (sem passo fantasma)', E.length===0, E.length);
  await p.keyboard.press('Control+Shift+z'); await sleep(150); E=await els();
  cc=await center(E[0].id); await p.mouse.click(cc.x,cc.y); await sleep(100);
  await p.keyboard.type('!!'); await sleep(100); await p.keyboard.press('Escape'); await sleep(150);
  E=await els(); check('Digitar com texto selecionado edita (caret no fim)', E[0].html==='Canteiro em obra!!', E[0].html);
  // forma: digitar
  await openMenu('insert'); await subItem('Forma','Pílula'); await p.keyboard.type('Fase 1'); await p.keyboard.press('Escape'); await sleep(150);
  E=await els(); check('Digitar numa forma selecionada escreve nela', E[1].html==='Fase 1', E[1].html);

  // ---------- 12. Recomeçar (modal) + desfazer; Limpar slide ----------
  const nBefore=await nSlides();
  await openMenu('file'); await menuItem('Recomeçar apresentação'); await sleep(300);
  await p.screenshot({path:SH('14-modal-recomecar')});
  check('Modal de confirmação aberto', await p.evaluate(()=>document.querySelector('#modal').classList.contains('open')));
  await p.keyboard.press('Escape'); await sleep(200);
  check('Esc cancela (nada muda)', (await nSlides())===nBefore && !(await p.evaluate(()=>document.querySelector('#modal').classList.contains('open'))));
  await openMenu('file'); await menuItem('Recomeçar apresentação'); await sleep(250); await p.click('#modal [data-mc="0"]'); await sleep(150);
  check('Botão Cancelar cancela', (await nSlides())===nBefore);
  await openMenu('file'); await menuItem('Recomeçar apresentação'); await sleep(250); await p.keyboard.press('Enter'); await sleep(300);
  const rs=await p.evaluate(()=>({n:AMStudio.deck.slides.length, e:AMStudio.deck.slides[0].els.length, t:AMStudio.deck.title}));
  check('Enter confirma: 1 slide em branco', rs.n===1 && rs.e===0, rs);
  await p.keyboard.press('Control+z'); await sleep(250);
  check('Ctrl+Z desfaz o recomeço', (await nSlides())===nBefore, await nSlides());
  await p.click('#thumbs .th[data-i="0"] .box'); await sleep(100); const ec=(await els()).length;
  await openMenu('edit'); await menuItem('Limpar slide'); await sleep(200);
  check('Limpar slide remove tudo', (await els()).length===0 && ec>0, ec);
  await p.keyboard.press('Control+z'); await sleep(200); check('Ctrl+Z desfaz Limpar slide', (await els()).length===ec);
  // Novo (modal)
  await p.click('#bNew'); await sleep(250); await p.screenshot({path:SH('14b-modal-novo')}); await p.keyboard.press('Escape'); await sleep(150);
  check('Botão Novo pede confirmação no modal', (await nSlides())===nBefore);

  // ---------- 13. F1 / ? / F5 ----------
  await p.mouse.click(L(10,10).x,L(10,10).y); await p.keyboard.press('F1'); await sleep(350);
  await p.screenshot({path:SH('15-atalhos-1440')});
  check('F1 abre atalhos', await p.evaluate(()=>!!document.querySelector('#modal.open .hk-b')));
  await p.keyboard.press('Escape'); await sleep(150);
  await p.keyboard.press('Shift+Slash'); await sleep(250); check('? abre atalhos', await p.evaluate(()=>!!document.querySelector('#modal.open .hk-b'))); await p.keyboard.press('Escape'); await sleep(100);
  await p.click('#thumbs .th[data-i="1"] .box'); await sleep(150);
  await p.keyboard.press('F5'); await sleep(900);
  const pr1=await p.evaluate(()=>({open:document.querySelector('#presenter').classList.contains('open'), pos:(document.querySelector('.amp-pos')||{}).textContent}));
  check('F5 apresenta do início', pr1.open && /^01/.test(pr1.pos), pr1);
  await p.screenshot({path:SH('16-f5')}); await p.keyboard.press('Escape'); await sleep(300);
  await p.keyboard.press('Shift+F5'); await sleep(700);
  const pr2=await p.evaluate(()=>({open:document.querySelector('#presenter').classList.contains('open'), pos:(document.querySelector('.amp-pos')||{}).textContent}));
  check('Shift+F5 apresenta do slide atual', pr2.open && /^02/.test(pr2.pos), pr2);
  await p.keyboard.press('Escape'); await sleep(300);
  // Início sem capa
  await p.click('#bHome'); await sleep(900); const tt=await p.evaluate(()=>({open:!!(window.AMCover&&AMCover.isOpen()), vis:getComputedStyle(document.querySelector('#cover')).visibility}));
  check('Início abre a capa', tt.open && tt.vis!=='hidden', tt);
  await p.keyboard.press('Escape'); await sleep(900); const tc=await p.evaluate(()=>AMCover.isOpen());
  check('Esc volta da capa para a obra', tc===false, tc);

  // ---------- 14. API ----------
  const api=await p.evaluate(()=>['selected','selectMany','copy','cut','paste','clearSlide','resetDeck','showHelp','deck','exportHTML','present','goSlide','insertFx','addSlide','select','setVariant','previewEl','W','H','BRAND','LAYOUTS','uid','clone','toast','mk','newDeck','loadDeck','openFile','pickFile','openDrawer','renderAll','commit','isEmpty','getDraft','clearDraft','hideDraftBanner'].filter(k=>AMStudio[k]===undefined));
  check('API completa', api.length===0, api);
  const cfNo=await p.evaluate(()=>{ const pr=AMStudio.confirm({title:'Teste',msg:'Mensagem',ok:'Sim'}); setTimeout(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),50); return pr; });
  const cfYes=await p.evaluate(()=>{ const pr=AMStudio.confirm({title:'Teste',msg:'Mensagem',ok:'Sim'}); setTimeout(()=>document.querySelector('#modal [data-mc="1"]').click(),50); return pr; });
  check('AMStudio.confirm resolve false (Esc) / true (botão)', cfNo===false && cfYes===true, [cfNo,cfYes]);
  await p.focus('#mbar [data-m=file]'); await p.keyboard.press('Enter'); await sleep(150);
  const kbBar=await p.evaluate(()=>({open:!!document.querySelector('.xmenu'), hot:(document.querySelector('.xmenu .xi.hot .xl')||{}).textContent, modal:document.querySelector('#modal').classList.contains('open')}));
  check('Enter no botão do menu abre o menu (sem ativar item)', kbBar.open && kbBar.hot==='Início (capa)' && !kbBar.modal, kbBar);
  await p.keyboard.press('Escape'); await sleep(100);
  await p.evaluate(()=>{ const i=+document.querySelector('#thumbs .th.on').dataset.i; AMStudio.selectMany(AMStudio.deck.slides[i].els.map(e=>e.id)); });
  check('AMStudio.selectMany', (await selected()).length===(await els()).length);

  // ---------- 14b. fallback: atalho sem evento nativo de área de transferência (tecla sintética) ----------
  await p.click('#thumbs .th[data-i="0"] .box'); await sleep(100);
  E=await els(); cc=await center(E[0].id); await p.mouse.click(cc.x,cc.y); await sleep(100);
  const nFb=(await els()).length;
  await p.evaluate(()=>{ navigator.clipboard.writeText('x'); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true})); }); await sleep(200);
  const sysFb=await clipHtml();
  check('Fallback Ctrl+C (sem evento nativo) copia em ~60 ms', /data-amstudio=/.test(sysFb), sysFb.slice(0,30));
  await p.evaluate(()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true,bubbles:true}))); await sleep(400);
  check('Fallback Ctrl+V (sem evento nativo) cola', (await els()).length===nFb+1, (await els()).length);
  await p.keyboard.press('Control+z'); await sleep(150);

  // ---------- 14c. redimensionar e guias continuam funcionando ----------
  await p.evaluate(()=>AMStudio.addSlide('blank-light')); await sleep(100);
  await openMenu('insert'); await subItem('Forma','Retângulo'); await p.keyboard.press('Escape'); await sleep(100);
  E=await els(); cc=await center(E[0].id); await p.mouse.click(cc.x,cc.y); await sleep(100);
  const hs=await (await p.$('#sel .hdl[data-h="se"]')).boundingBox();
  await p.mouse.move(hs.x+5,hs.y+5); await p.mouse.down(); await p.mouse.move(hs.x+60,hs.y+40,{steps:6}); await p.mouse.up(); await sleep(150);
  let E2=await els(); check('Alça de redimensionar (canto) funciona', E2[0].w>E[0].w+30 && E2[0].h>E[0].h+15, [E[0].w,E2[0].w]);
  cc=await center(E2[0].id); const tgt=640+3-(E2[0].x+E2[0].w/2); await p.mouse.move(cc.x,cc.y); await p.mouse.down(); await p.mouse.move(cc.x+tgt/1280*wb.width,cc.y+20,{steps:4});
  const guides=await p.evaluate(()=>document.querySelectorAll('#sel .guide').length); await p.mouse.up(); await sleep(100);
  E2=await els(); check('Guias de alinhamento aparecem e encaixam no centro', guides>=1 && Math.abs(E2[0].x+E2[0].w/2-640)<=1, [guides,E2[0].x+E2[0].w/2]);

  const ord0=await p.evaluate(()=>AMStudio.deck.slides.map(s=>s.id));
  await p.dragAndDrop('#thumbs .th[data-i="2"] .box','#thumbs .th[data-i="0"] .box'); await sleep(250);
  const ord1=await p.evaluate(()=>AMStudio.deck.slides.map(s=>s.id));
  check('Reordenar slides arrastando a miniatura', ord1[0]===ord0[2] && ord1.length===ord0.length, [ord0.slice(0,3),ord1.slice(0,3)]);

  // ---------- 15. salvar / abrir ----------
  const nSave=await nSlides();
  const [dl]=await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const out=path.join(__dirname,'saved-core.html'); await dl.saveAs(out);
  await p.setInputFiles('#fOpen', out); await sleep(600);
  check('Salvar (Ctrl+S) e abrir mantém os slides', (await nSlides())===nSave, [nSave, await nSlides()]);

  // ---------- 16. 1280x720 ----------
  await p.setViewportSize({width:1280,height:720}); await sleep(300);
  const ov=await p.evaluate(()=>{const t=document.getElementById('top'); const r=document.getElementById('bSave').getBoundingClientRect(); return {top:t.scrollWidth<=t.clientWidth, save:r.right<=innerWidth, rib:document.getElementById('rib').scrollWidth<=document.getElementById('rib').clientWidth};});
  check('Barra superior sem estouro em 1280', ov.top && ov.save && ov.rib, ov);
  await p.click('#thumbs .th[data-i="0"] .box'); await sleep(100);
  await p.keyboard.press('Control+a'); await sleep(150); await p.screenshot({path:SH('17-1280-multi')});
  await openMenu('arrange'); await p.locator('.xmenu .xi',{hasText:'Alinhar'}).hover(); await sleep(300); await p.screenshot({path:SH('18-1280-menu')}); await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  E=await els(); cc=await center(E[E.length-1].id); await p.mouse.click(cc.x,cc.y,{button:'right'}); await sleep(250); await p.screenshot({path:SH('19-1280-contexto')}); await p.keyboard.press('Escape');
  await p.keyboard.press('F1'); await sleep(350); await p.screenshot({path:SH('20-1280-atalhos')}); await p.keyboard.press('Escape');
  await p.setViewportSize({width:1440,height:900}); await sleep(200);

  // ---------- 17. regressões da revisão (IX / CR / CI / VB) ----------
  {
    const q=await ctx.newPage(); q.on('pageerror',e=>errs.push('rev pageerror: '+e.message)); q.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load/.test(m.text()))errs.push('rev: '+m.text())});
    const fresh=async()=>{ await q.goto('file://'+path.join(__dirname,'AM-Studio-Editor.html')+'?nocover'); await sleep(600); const wb2=await (await q.$('#wrap')).boundingBox(); return (x,y)=>({x:wb2.x+x/1280*wb2.width, y:wb2.y+y/720*wb2.height}); };
    const add=(kind,o)=>q.evaluate(([k,o])=>{ const sl=AMStudio.deck.slides[AMStudio.cur]; const e=k==='text'?AMStudio.mk.text('body'):k==='line'?AMStudio.mk.line(true):AMStudio.mk.shape('rect'); Object.assign(e,o||{}); sl.els.push(e); AMStudio.renderAll(); AMStudio.commit(); return e.id; },[kind,o]);
    const qels=()=>q.evaluate(()=>JSON.parse(JSON.stringify(AMStudio.deck.slides[AMStudio.cur].els)));
    const qc=async id=>{ const bb=await (await q.$('#wrap .am-stage .am-el[data-id="'+id+'"]')).boundingBox(); return {x:bb.x+bb.width/2,y:bb.y+bb.height/2}; };
    const modalUp=()=>q.evaluate(()=>document.getElementById('modal').classList.contains('open'));
    let L2=await fresh();

    // IX-01 / CR-06 / IX-11: Abrir com trabalho pede confirmação; Ctrl+O também; Ctrl+D em campo nunca chega ao navegador
    await add('shape',{x:100,y:100,w:200,h:120});
    await q.click('#mbar [data-m=file]'); await sleep(200); await q.locator('.xmenu .xi',{hasText:'Abrir…'}).click(); await sleep(250);
    check('IX-01: Arquivo › Abrir… com obra pede confirmação', await modalUp() && /Abrir outra apresentação/.test(await q.textContent('#modal')));
    await q.keyboard.press('Escape'); await sleep(150);
    check('IX-01: cancelar mantém a obra e o desfazer', (await qels()).length===1 && !(await q.evaluate(()=>document.getElementById('bUndo').disabled)));
    const ko=await q.evaluate(()=>{ const e=new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true,cancelable:true}); document.body.dispatchEvent(e); return e.defaultPrevented; }); await sleep(200);
    check('IX-11: Ctrl+O abre o “Abrir” (com confirmação)', ko && await modalUp(), ko); await q.keyboard.press('Escape'); await sleep(150);
    const kd=await q.evaluate(()=>{ const t=document.getElementById('title'); t.focus(); const e=new KeyboardEvent('keydown',{key:'d',ctrlKey:true,bubbles:true,cancelable:true}); t.dispatchEvent(e); t.blur(); return e.defaultPrevented; });
    check('IX-11: Ctrl+D no título é prevenido (sem “favoritos”)', kd);
    await q.click('#mbar [data-m=file]'); await sleep(200);
    check('IX-11: Arquivo › Abrir… mostra Ctrl+O', /Ctrl\+O/.test(await q.locator('.xmenu .xi',{hasText:'Abrir…'}).textContent())); await q.keyboard.press('Escape'); await sleep(100);

    // IX-02 / CR-01: cópia legível; colar em caixa de texto e no título nunca traz JSON
    L2=await fresh();
    const sh=await add('shape',{x:100,y:100,w:200,h:120,html:'Fase 1'}), tb=await add('text',{x:300,y:400,w:500,h:60,html:'Texto'});
    let c=await qc(sh); await q.mouse.click(c.x,c.y); await sleep(80); await q.keyboard.press('Control+c'); await sleep(150);
    check('IX-02: Ctrl+C põe o texto do elemento no text/plain', (await q.evaluate(()=>navigator.clipboard.readText()))==='Fase 1');
    c=await qc(tb); await q.mouse.dblclick(c.x,c.y); await sleep(150); await q.keyboard.press('End'); await q.keyboard.press('Control+v'); await sleep(120); await q.keyboard.press('Escape'); await sleep(120);
    let E3=await qels(); check('IX-02: colar dentro de um texto insere o texto, não o JSON', E3.find(e=>e.id===tb).html==='TextoFase 1' && E3.length===2, E3.find(e=>e.id===tb).html);
    await q.click('#title'); await q.keyboard.press('Control+a'); await q.keyboard.press('Control+v'); await sleep(80);
    check('IX-02: colar no título insere o texto', (await q.inputValue('#title'))==='Fase 1', await q.inputValue('#title'));
    await q.keyboard.press('Escape'); await q.mouse.click(L2(1250,700).x,L2(1250,700).y); await sleep(80);

    // IX-15: colar após desfazer reaproveita a vaga +24
    c=await qc(sh); await q.mouse.click(c.x,c.y); await sleep(80); await q.keyboard.press('Control+c'); await sleep(100);
    await q.keyboard.press('Control+v'); await sleep(200); await q.keyboard.press('Control+z'); await sleep(150); await q.keyboard.press('Control+v'); await sleep(200);
    E3=await qels(); check('IX-15: colar → desfazer → colar volta a +24', E3.filter(e=>e.type==='shape').map(e=>e.x).join(',')==='100,124', E3.map(e=>[e.x,e.y]));

    // CR-03 / CR-04: conteúdo externo validado (tipo desconhecido fora; HTML sem eventos)
    await q.evaluate(async()=>{ const pl={els:[{type:'fx',kind:'futureChart',x:1,y:1,w:10,h:10,data:{}},{type:'text',x:200,y:200,w:300,h:60,html:'Oi <img src=x onerror="window.__xss=1"><b onclick="x()">ok</b>'},{type:'shape',fill:'#fff" onmouseover="alert(1)',html:'s'}]}; const h='<div data-amstudio="'+JSON.stringify(pl).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">x</div>'; await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([h],{type:'text/html'}),'text/plain':new Blob(['x'],{type:'text/plain'})})]); });
    await q.mouse.click(L2(1250,700).x,L2(1250,700).y); await sleep(80); const nb3=(await qels()).length;
    await q.keyboard.press('Control+v'); await sleep(400); E3=await qels();
    const exp3=await q.evaluate(()=>AMStudio.exportHTML());
    check('CR-03: tipo desconhecido fica de fora, o resto entra num passo', E3.length===nb3+2 && !E3.some(e=>e.kind==='futureChart'), E3.length-nb3);
    check('CR-04: HTML colado chega limpo (sem on*), nada executa, export limpo', !(await q.evaluate(()=>window.__xss)) && /Oi\s*<b>ok<\/b>/.test(E3[E3.length-2].html) && !E3[E3.length-1].fill && !/onerror|onmouseover|onclick/.test(exp3), [E3[E3.length-2].html, E3[E3.length-1].fill]);
    const legacy=await q.evaluate(()=>{ const e=new Event('paste',{bubbles:true,cancelable:true}); e.clipboardData=new DataTransfer(); e.clipboardData.setData('text/plain','AMSTUDIO/1:{"els":[{"type":"fx","kind":"nada","x":0,"y":0,"w":10,"h":10}]}'); document.body.dispatchEvent(e); return AMStudio.deck.slides[AMStudio.cur].els.length; });
    check('CR-03: formato antigo inválido não cola a cópia interna de novo', legacy===E3.length, [legacy,E3.length]);

    // CR-11: arquivo com slides sem "els" é normalizado
    L2=await fresh();
    const bad=path.join(require('os').tmpdir(),'canteiro-bad-'+process.pid+'.json'); fs.writeFileSync(bad,JSON.stringify({title:'x',slides:[{bg:'#fff'},null,{els:[null,{type:'shape'}]}]}));
    await q.setInputFiles('#fOpen',bad); await sleep(500);
    await q.mouse.dblclick(L2(640,360).x,L2(640,360).y); await sleep(150); await q.keyboard.type('ok'); await q.keyboard.press('Escape'); await sleep(150);
    check('CR-11: deck com slides sem “els” abre normalizado e editável', (await q.evaluate(()=>AMStudio.deck.slides.length))===2 && (await qels()).length===1);
    try{ fs.unlinkSync(bad); }catch(e){}

    // IX-03 / CR-02 / CR-13: desfazer logo após as setas desfaz só o ajuste; a miniatura acompanha
    L2=await fresh();
    await add('shape',{x:100,y:100,w:200,h:120}); const bB=await add('shape',{x:600,y:300,w:200,h:120});
    c=await qc(bB); await q.mouse.click(c.x,c.y); await sleep(80);
    await q.keyboard.press('Shift+ArrowRight'); await q.keyboard.press('Shift+ArrowRight'); await q.keyboard.press('Control+z'); await sleep(150);
    E3=await qels(); check('IX-03: Ctrl+Z logo após as setas desfaz só o ajuste', E3.length===2 && E3[1].x===600, E3.map(e=>e.x));
    await q.keyboard.press('Control+Shift+z'); await sleep(150); E3=await qels(); check('IX-03: refazer devolve o ajuste', E3[1].x===620, E3.map(e=>e.x));
    c=await qc(bB); await q.mouse.click(c.x,c.y); await sleep(80); await q.fill('#props [data-p="x"]','900');
    await q.click('#mbar [data-m=edit]'); await sleep(200); await q.locator('.xmenu .xi',{hasText:'Desfazer'}).click(); await sleep(200);
    E3=await qels(); check('IX-03: campo do painel em foco + Editar › Desfazer desfaz só o campo', E3.length===2 && E3[1].x===620, E3.map(e=>e.x));
    await q.evaluate(()=>AMStudio.addSlide('blank-light')); await sleep(100); await q.click('#thumbs .th[data-i="0"] .box'); await sleep(150);
    c=await qc(bB); await q.mouse.click(c.x,c.y); await sleep(80); for(let i=0;i<5;i++) await q.keyboard.press('Shift+ArrowRight'); await q.click('#thumbs .th[data-i="1"] .box'); await sleep(200);
    const tl=await q.evaluate(id=>document.querySelector('#thumbs .th[data-i="0"] .am-el[data-id="'+id+'"]').style.left,bB);
    check('CR-13: trocar de slide logo após as setas atualiza a miniatura', tl.startsWith((670/1280*100).toFixed(2)), tl);

    // IX-04: linha/seta só pega clique perto do traço
    L2=await fresh();
    const s4=await add('shape',{x:500,y:150,w:300,h:400}); const ln=await add('line',{x1:200,y1:120,x2:1100,y2:600});
    let pt=L2(780,170); await q.mouse.click(pt.x,pt.y); await sleep(100);
    check('IX-04: clique na forma, longe da seta, seleciona a forma', (await q.evaluate(()=>AMStudio.selected()))[0]===s4);
    await q.keyboard.press('Escape'); pt=L2(300,560); await q.mouse.dblclick(pt.x,pt.y); await sleep(150); await q.keyboard.type('z'); await q.keyboard.press('Escape'); await sleep(120);
    check('IX-04: duplo clique no vazio dentro da caixa da seta cria texto', (await qels()).length===3);
    pt=L2(650,360); await q.mouse.click(pt.x,pt.y); await sleep(80);
    check('IX-04: clique sobre o traço ainda seleciona a seta', (await q.evaluate(()=>AMStudio.selected()))[0]===ln);

    // IX-08 / CR-10: tecla com menu aberto não age por trás
    c=await qc(s4); await q.mouse.click(c.x+60,c.y+120,{button:'right'}); await sleep(200); await q.keyboard.press('Delete'); await sleep(150);
    check('IX-08: Delete com menu de contexto aberto só fecha o menu', (await qels()).length===3 && (await q.evaluate(()=>document.querySelectorAll('.xmenu').length))===0);
    // IX-14: Shift+F10 abre o menu do elemento
    await q.mouse.click(c.x+60,c.y+120); await sleep(80); await q.keyboard.press('Shift+F10'); await sleep(200);
    check('IX-14: Shift+F10 abre o menu de contexto do elemento', await q.locator('.xmenu .xi',{hasText:'Trazer para frente'}).count()===1 && await q.evaluate(()=>document.activeElement.classList.contains('xi')));
    await q.keyboard.press('Escape'); await sleep(100);

    // IX-09 / CR-05 / IX-10: botão com foco de teclado recebe Enter/Espaço; Ctrl+Alt+letra não digita
    L2=await fresh(); const t9=await add('text',{x:300,y:300,w:400,h:60,html:'Base'});
    c=await qc(t9); await q.mouse.click(c.x,c.y); await sleep(80);
    await q.focus('#bDup'); await q.keyboard.press('Enter'); await sleep(150);
    check('IX-09: Enter no botão Duplicar (Tab) duplica, não edita', (await qels()).length===2 && !(await q.evaluate(()=>!!document.querySelector('.am-el.editing'))));
    c=await qc(t9); await q.mouse.click(c.x,c.y); await sleep(80); await q.focus('#bFront'); await q.keyboard.press('Space'); await sleep(120);
    check('IX-09: Espaço no botão focado não entra no texto', (await qels()).find(e=>e.id===t9).html==='Base' && !(await q.evaluate(()=>!!document.querySelector('.am-el.editing'))));
    c=await qc(t9); await q.mouse.click(c.x,c.y); await sleep(80); await q.keyboard.press('Control+Alt+z'); await sleep(120);
    check('IX-10: Ctrl+Alt+Z com texto selecionado não digita “z”', !(await q.evaluate(()=>!!document.querySelector('.am-el.editing'))));
    // IX-13: duplo clique numa palavra seleciona a palavra
    const t13=await add('text',{x:100,y:500,w:700,h:60,html:'Primeira segunda terceira'});
    const wpos=await q.evaluate(id=>{ const tx=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"] .am-tx'); const r=document.createRange(); r.setStart(tx.firstChild,2); r.setEnd(tx.firstChild,3); const b=r.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; },t13);
    await q.mouse.dblclick(wpos.x,wpos.y); await sleep(150);
    check('IX-13: duplo clique numa palavra seleciona a palavra', (await q.evaluate(()=>String(getSelection())))==='Primeira', await q.evaluate(()=>String(getSelection())));
    // IX-06: Editar › Colar durante a edição cola no texto
    await q.evaluate(()=>navigator.clipboard.writeText('colado'));
    await q.click('#mbar [data-m=edit]'); await sleep(200); await q.locator('.xmenu .xi',{hasText:'Colar'}).click(); await sleep(300); await q.keyboard.press('Escape'); await sleep(150);
    E3=await qels(); check('IX-06: Editar › Colar durante a edição insere no texto', E3.find(e=>e.id===t13).html==='colado segunda terceira' && E3.length===3, E3.find(e=>e.id===t13).html);
    // IX-07: colar várias linhas faz a caixa crescer
    await q.evaluate(()=>navigator.clipboard.writeText(Array.from({length:9},(_,i)=>'Linha '+(i+1)).join('\n')));
    const t7=await add('text',{x:100,y:60,w:400,h:40,html:'Linha'}); c=await qc(t7); await q.mouse.dblclick(c.x,c.y); await sleep(120); await q.keyboard.press('End'); await q.keyboard.press('Control+v'); await sleep(150);
    const hLive=await q.evaluate(()=>+document.querySelector('#props [data-p="h"]').value);
    await q.keyboard.press('Escape'); await sleep(150);
    const fitc=await q.evaluate(id=>{ const n=document.querySelector('#wrap .am-stage .am-el[data-id="'+id+'"]'), r=document.createRange(); r.selectNodeContents(n.querySelector('.am-tx')); return {node:n.getBoundingClientRect().bottom, content:r.getBoundingClientRect().bottom}; },t7);
    check('IX-07: colar 9 linhas faz a caixa crescer (e a Altura acompanha)', fitc.content<=fitc.node+1 && hLive>200, {fitc,hLive});

    // CR-07: clique rápido no painel durante a edição mantém o texto e aplica o estilo
    const t71=await add('text',{x:700,y:300,w:400,h:60,html:'Abc'}); c=await qc(t71); await q.mouse.dblclick(c.x,c.y); await sleep(120); await q.keyboard.press('End'); await q.keyboard.type(' digitado');
    const bold=await (await q.$('#props button[data-set="weight"][data-v="700"]')).boundingBox(); await q.mouse.move(bold.x+bold.width/2,bold.y+bold.height/2); await q.mouse.down(); await q.mouse.up(); await sleep(200);
    E3=await qels(); const e71=E3.find(e=>e.id===t71);
    check('CR-07: clique no painel durante a edição: texto mantido e negrito aplicado', e71.html==='Abc digitado' && e71.weight===700, [e71.html,e71.weight]);

    // IX-05: logo após inserir um modelo, ele já arrasta e o duplo clique edita o campo
    L2=await fresh();
    await q.click('#bModels'); await sleep(500); await q.locator('#modelsBody button[data-ins="swot"]').click(); await sleep(700);
    const sw=(await qels())[0]; c=await qc(sw.id); await q.mouse.move(c.x,c.y); await q.mouse.down(); await q.mouse.move(c.x+60,c.y+30,{steps:5}); await q.mouse.up(); await sleep(150);
    const sw2=(await qels())[0]; check('IX-05: modelo recém-inserido (prévia rodando) já arrasta', sw2.x!==sw.x && !(await q.evaluate(()=>!!document.querySelector('.prevov'))), [sw.x,sw2.x]);
    // CR-12: Início fecha a biblioteca e as prévias param
    await q.click('#bModels'); await sleep(500); await q.click('#bHome'); await sleep(800);
    const mut=await q.evaluate(async()=>{ let n=0; const o=new MutationObserver(m=>n+=m.length); o.observe(document.getElementById('modelsBody'),{childList:true,subtree:true,characterData:true}); await new Promise(r=>setTimeout(r,2500)); o.disconnect(); return n; });
    check('CR-12: com a capa aberta, a biblioteca fecha e as prévias param', mut===0 && !(await q.evaluate(()=>document.getElementById('drawer').classList.contains('open'))), mut);
    await q.evaluate(()=>AMCover.close()); await sleep(800);

    // IX-12: miniatura em foco: Duplicar da faixa duplica o slide; painel tira o foco da miniatura
    await q.click('#thumbs .th[data-i="0"] .box'); await sleep(120); await q.click('#bDup'); await sleep(200);
    check('IX-12: com a miniatura em foco, “Duplicar” da faixa duplica o slide', (await q.evaluate(()=>AMStudio.deck.slides.length))===2);
    await q.click('#thumbs .th[data-i="0"] .box'); await sleep(120); await q.click('#props .sw button[data-v="#EBEEF1"]'); await sleep(120); await q.keyboard.press('Delete'); await sleep(150);
    check('IX-12: clicar no painel e apertar Delete não apaga o slide', (await q.evaluate(()=>AMStudio.deck.slides.length))===2);
    await q.click('#thumbs .th[data-i="0"] .box'); await sleep(120); await q.click('#mbar [data-m=edit]'); await sleep(200);
    check('IX-12: com a miniatura em foco, Editar mostra “Apagar slide”', await q.locator('.xmenu .xi',{hasText:'Apagar slide'}).count()===1); await q.keyboard.press('Escape');

    // CI-04: soltar um .html salvo no slide abre (com confirmação)
    const saved4=await q.evaluate(()=>AMStudio.exportHTML());
    await q.evaluate(txt=>{ const dt=new DataTransfer(); dt.items.add(new File([txt],'salva.html',{type:'text/html'})); const w=document.getElementById('wrap'); w.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true,clientX:700,clientY:400})); w.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true,clientX:700,clientY:400})); },saved4); await sleep(400);
    check('CI-04: soltar .html no slide pede para abrir a apresentação', await modalUp() && /salva\.html/.test(await q.textContent('#modal')));
    await q.click('#modal [data-mc="1"]'); await sleep(500);
    check('CI-04: confirmar abre a apresentação solta', (await q.evaluate(()=>AMStudio.deck.slides.length))===2 && !(await modalUp()));

    // CR-14: modal com nome acessível e foco devolvido; VB-12: textos
    await q.focus('#bSave'); await q.keyboard.press('F1'); await sleep(300);
    const lab=await q.evaluate(()=>{ const d=document.querySelector('#modal .mdl'); const id=d.getAttribute('aria-labelledby'); return id&&document.getElementById(id)&&document.getElementById(id).textContent; });
    await q.keyboard.press('Escape'); await sleep(150);
    check('CR-14: modal nomeado e foco devolvido ao gatilho', lab==='Atalhos de teclado' && await q.evaluate(()=>document.activeElement.id==='bSave'), lab);
    await q.evaluate(()=>document.activeElement.blur());
    const ph=await q.evaluate(()=>document.querySelector('#props .ph small').textContent);
    check('VB-12: plurais corretos no painel do slide', /^\d+ elementos? · \d+ slides? na apresentação$/.test(ph) && !/\(s\)/.test(ph), ph);
    await q.close();
  }

  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close();
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
