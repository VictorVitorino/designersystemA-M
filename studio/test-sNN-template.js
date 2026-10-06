/* MODELO de bateria nova. Copie para test-sNN-<recurso>.js (NN = passo, ex.: test-s03-icones.js): o qa-gate.sh roda todo
   test-s[0-9][0-9]*.js e decide SÓ pelo código de saída (0 = passou). Este arquivo-modelo não casa com o padrão e não roda no portão.
   Regras: check() para cada verificação; erro de console/página reprova; process.exit(1) se algo falhar (exit 2 se estourar).
   Mais exemplos: test-s00.js (campos round-trip, export, teclado no player, extensões rt-*), test-core.js (menus, área de
   transferência: els(), openMenu(), subItem()), test-cover.js (slideCheck: sobreposição/transbordamento de um slide).
   Uso: python3 assemble.py && node test-sNN-recurso.js */
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
  const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const p=await open(ctx, FILE+'?nocover', 'ed');
  const wb=await (await p.$('#wrap')).boundingBox();
  const L=(x,y)=>({x:wb.x+x/1280*wb.width, y:wb.y+y/720*wb.height});     /* lógico 1280×720 -> tela */
  await p.evaluate(()=>AMStudio.insertFx('swot')); await sleep(300);
  const n=await p.evaluate(()=>AMStudio.deck.slides[AMStudio.cur].els.length);
  check('SNN-01: insertFx cria 1 elemento', n===1, n);
  const html=await p.evaluate(()=>AMStudio.exportHTML()); const f=path.join(__dirname,'saved-sNN.html'); fs.writeFileSync(f,html);
  const q=await open(ctx,'file://'+f,'exp');
  check('SNN-02: arquivo exportado abre o player', await q.evaluate(()=>!!document.querySelector('.amp .amp-slide')));
  check('SNN-03: export sem on* (CR-04)', !/onerror|onmouseover|onclick/.test(html));
  check('Zero erros de console', errs.length===0, errs);
  console.log(results.join('\n'));
  console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs}));
  await b.close(); try{ fs.unlinkSync(f); }catch(e){}
  process.exit(failed?1:0);
})().catch(e=>{ console.log(results.join('\n')); console.error('ERRO', e); process.exit(2); });
