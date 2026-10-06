/* S16 — imagem inserida pelo seletor de arquivo: aparece com medidas válidas, move, redimensiona (canto mantém proporção, Shift livre, lado estica),
   campos do painel, Trocar imagem, reabrir arquivo antigo com medidas nulas e exportar. Uso: python3 assemble.py && node test-s16-imagem.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html'), IMG=path.join(__dirname,'test-foto.png');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
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
const IMGEL=()=>{ const s=AMStudio.deck.slides[AMStudio.cur], e=s.els.filter(x=>x.type==='image').pop(); return e?{id:e.id,x:e.x,y:e.y,w:e.w,h:e.h,src:e.src.slice(0,22)}:null; };
const fin=e=>e&&[e.x,e.y,e.w,e.h].every(v=>typeof v==='number'&&isFinite(v))&&e.w>8&&e.h>8;
async function choose(p, trigger){ const [fc]=await Promise.all([p.waitForEvent('filechooser'), trigger()]); await fc.setFiles(IMG); await sleep(700); }
async function drag(p, x0, y0, x1, y1, mod){ if(mod) await p.keyboard.down(mod); await p.mouse.move(x0,y0); await p.mouse.down(); await p.mouse.move(x1,y1,{steps:8}); await p.mouse.up(); if(mod) await p.keyboard.up(mod); await sleep(200); }
async function hdl(p, h){ const b=await (await p.$('.hdl[data-h='+h+']')).boundingBox(); return {x:b.x+b.width/2, y:b.y+b.height/2}; }
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  /* 1. botão Imagem da barra */
  await choose(p, ()=>p.click('[data-add=image]'));
  const e1=await p.evaluate(IMGEL), sel1=await p.evaluate(()=>AMStudio.selected());
  check('S16-01: Imagem (barra): entra com posição e tamanho válidos, na proporção do arquivo (800×500), centralizada e selecionada', fin(e1)&&Math.abs(e1.w/e1.h-1.6)<.02&&Math.abs(e1.x+e1.w/2-640)<=1&&Math.abs(e1.y+e1.h/2-360)<=1&&sel1[0]===e1.id&&/^data:image/.test(e1.src), e1);
  const box=await (await p.$('#wrap .am-el[data-id="'+e1.id+'"]')).boundingBox();
  check('S16-02: a imagem aparece no palco com as 8 alças de redimensionar', box&&box.width>100&&box.height>60&&await p.$$eval('.hdl',h=>h.length)===8, box);
  /* 2. mover com o mouse e com as setas */
  await drag(p, box.x+box.width/2, box.y+box.height/2, box.x+box.width/2+100, box.y+box.height/2+50);
  const e2=await p.evaluate(IMGEL);
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('Shift+ArrowUp'); await sleep(150); const e2b=await p.evaluate(IMGEL);
  check('S16-03: arrastar move a imagem; setas ajustam 1 px / Shift 10 px; tamanho não muda', e2.x>e1.x+100&&e2.y>e1.y+50&&e2.w===e1.w&&e2.h===e1.h&&e2b.x===e2.x-1&&e2b.y===e2.y-10, [e1,e2,e2b]);
  /* 3. redimensionar */
  let c=await hdl(p,'se'); await drag(p, c.x, c.y, c.x-160, c.y-40); const e3=await p.evaluate(IMGEL);
  check('S16-04: alça de canto diminui mantendo a proporção da foto', e3.w<e2b.w-80&&Math.abs(e3.w/e3.h-e2b.w/e2b.h)<.03&&e3.x===e2b.x&&e3.y===e2b.y, [e2b,e3]);
  c=await hdl(p,'se'); await drag(p, c.x, c.y, c.x+220, c.y+30); const e4=await p.evaluate(IMGEL);
  check('S16-05: alça de canto aumenta mantendo a proporção', e4.w>e3.w+120&&Math.abs(e4.w/e4.h-e3.w/e3.h)<.03, [e3,e4]);
  c=await hdl(p,'se'); await drag(p, c.x, c.y, c.x+60, c.y-60, 'Shift'); const e5=await p.evaluate(IMGEL);
  c=await hdl(p,'e'); await drag(p, c.x, c.y, c.x-90, c.y); const e6=await p.evaluate(IMGEL);
  check('S16-06: Shift+canto redimensiona livre; alça lateral estica só a largura', Math.abs(e5.w/e5.h-e4.w/e4.h)>.1&&e6.w<e5.w-50&&e6.h===e5.h, [e4,e5,e6]);
  /* 4. painel: largura, altura, X */
  await p.fill('#props [data-p=w]','400'); await p.keyboard.press('Tab'); await p.fill('#props [data-p=h]','250'); await p.keyboard.press('Tab'); await p.fill('#props [data-p=x]','100'); await p.keyboard.press('Tab'); await sleep(250);
  const e7=await p.evaluate(IMGEL), b7=await (await p.$('#wrap .am-el[data-id="'+e1.id+'"]')).boundingBox(), wb=await (await p.$('#wrap')).boundingBox();
  check('S16-07: campos Largura, Altura e X do painel mudam a imagem no palco', e7.w===400&&e7.h===250&&e7.x===100&&Math.abs(b7.width-400/1280*wb.width)<3, [e7,b7]);
  await p.keyboard.press('Control+z'); await sleep(150); const e7u=await p.evaluate(IMGEL);
  check('S16-08: Ctrl+Z desfaz a última mudança do painel', e7u.x!==100&&e7u.w===400, e7u);
  /* 5. Inserir › Imagem… (menu) e Trocar imagem */
  const n0=await p.evaluate(()=>AMStudio.deck.slides[AMStudio.cur].els.length);
  await choose(p, async()=>{ await p.click('#mbar button:has-text("Inserir")'); await sleep(200); await p.click('.xmenu button:has-text("Imagem…")'); });
  const e8=await p.evaluate(IMGEL), n1=await p.evaluate(()=>AMStudio.deck.slides[AMStudio.cur].els.length);
  check('S16-09: Inserir › Imagem… também entra com medidas válidas', n1===n0+1&&fin(e8)&&e8.id!==e1.id, e8);
  await choose(p, ()=>p.click('#props [data-act=replace]'));
  const e9=await p.evaluate(IMGEL);
  check('S16-10: Trocar imagem mantém posição e tamanho', e9.id===e8.id&&e9.x===e8.x&&e9.w===e8.w&&e9.h===e8.h, [e8,e9]);
  /* 6. arquivo salvo antes da correção (imagem com x/y/w/h nulos) reabre visível e editável */
  const rp=await p.evaluate(()=>{ const src=AMStudio.deck.slides[AMStudio.cur].els.find(e=>e.type==='image').src;
    AMStudio.loadDeck({v:1,app:'AM Studio',title:'antigo',slides:[{id:'s1',bg:'#FFFFFF',tr:'fade',els:[{id:'im1',type:'image',src:src,x:null,y:null,w:null,h:null,fit:'cover'}]}]},'x');
    const e=AMStudio.deck.slides[0].els[0]; return {x:e.x,y:e.y,w:e.w,h:e.h}; });
  check('S16-11: imagem gravada com medidas nulas (versão anterior) reabre centralizada em 520×360', rp.w===520&&rp.h===360&&rp.x===380&&rp.y===180, rp);
  /* 7. exportar: a imagem vai junto e aparece no player */
  await p.evaluate(()=>AMStudio.resetDeck()); await sleep(200); await choose(p, ()=>p.click('[data-add=image]'));
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(__dirname,'saved-s16.html'); fs.writeFileSync(f,html);
  const q=await open(ctx,'file://'+f,'exp'); const ib=await q.evaluate(()=>{ const i=document.querySelector('.amp-slide.on .am-el img, .amp-slide.on .am-el [style*="background-image"]'); const r=i&&i.getBoundingClientRect(); return r?{w:Math.round(r.width),h:Math.round(r.height)}:null; });
  check('S16-12: no arquivo salvo a imagem aparece com tamanho', ib&&ib.w>100&&ib.h>60&&!/onerror|onmouseover|onclick/i.test(html), ib);
  await q.close(); try{ fs.unlinkSync(f); }catch(e){}
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n')); console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
