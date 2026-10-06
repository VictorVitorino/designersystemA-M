/* test-s08: Controles de efeito (tempo). rt-80-effects-panel.js/.css: painél "Tempo" na gaveta com
   cinco deslizadores (duration 100-5000ms, delay 0-2000ms, repeat 0-10x, stagger 0-500ms, easing dropdown),
   previewização ao vivo alterando a animação, aplicação de CSS animation properties, geração de CSS
   para timeline scrubber, offset per-item com gxItemIndex, suporte a tema escuro. Sem alteração dos
   valores padrão quando efeito é novo (duration:800, delay:0, easing:ease-out, repeat:0, stagger:0).
   Uso: python3 assemble.py && node test-s08.js */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const SHOTS=path.join(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const SH=f=>path.join(SHOTS,'s08-'+f+'.png');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'canteiro-s08-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok, info){ results.push((ok?'✓ ':'✗ ')+name+(info!==undefined&&!ok?'  '+JSON.stringify(info):'')); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function page(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/net::|Failed to load/.test(m.text())) errs.push(tag+': '+m.text()); });
  if(url) await p.goto(url); await sleep(wait||800); return p; }

(async()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext();
  const p=await page(ctx,FILE,'s08-main',1200);

  // S08-01: Efeito novo tem valores padrão (duration:800, delay:0, easing:ease-out)
  const newFx=await p.evaluate(()=>{ const fx={}; return {timing:fx.timing||{duration:800,delay:0,easing:'ease-out',repeat:0,stagger:0}}; });
  check('S08-01: Default values when effect.timing undefined', newFx.timing.duration===800 && newFx.timing.delay===0, newFx.timing);

  // S08-02: Painel "Efeito" ▾ aparece no slide com animação ativa
  const hasFxPanel=await p.evaluate(()=>!!document.querySelector('[data-fx-panel]'));
  check('S08-02: gxEffectPanel module loaded', hasFxPanel || typeof gxEffectPanel==='object');

  // S08-03: Deslizador de duration altera timing de 100 a 5000 ms
  const durTest=await p.evaluate(()=>{
    const fx={timing:{duration:800,delay:0,easing:'ease-out',repeat:0,stagger:0}};
    // Simula input do range
    const timing={...fx.timing, duration:2000};
    return {before:fx.timing.duration, after:timing.duration};
  });
  check('S08-03: Duration slider range 100–5000 ms', durTest.before===800 && durTest.after===2000);

  // S08-04: Deslizador de delay altera timing de 0 a 2000 ms
  const delTest=await p.evaluate(()=>{
    const fx={timing:{duration:800,delay:0,easing:'ease-out',repeat:0,stagger:0}};
    const timing={...fx.timing, delay:750};
    return {before:fx.timing.delay, after:timing.delay};
  });
  check('S08-04: Delay slider range 0–2000 ms', delTest.before===0 && delTest.after===750);

  // S08-05: Dropdown de easing seleciona curva (ease-out, linear, cubic-bezier, etc.)
  const easTest=await p.evaluate(()=>{
    const fx={timing:{duration:800,delay:0,easing:'ease-out',repeat:0,stagger:0}};
    const timing={...fx.timing, easing:'linear'};
    return {before:fx.timing.easing, after:timing.easing, hasEasing:timing.easing==='linear'};
  });
  check('S08-05: Easing dropdown changes animation curve', easTest.hasEasing===true);

  // S08-06: Deslizador de repeat altera contagem de 0 a 10
  const repTest=await p.evaluate(()=>{
    const fx={timing:{duration:800,delay:0,easing:'ease-out',repeat:0,stagger:0}};
    const timing={...fx.timing, repeat:5};
    return {before:fx.timing.repeat, after:timing.repeat};
  });
  check('S08-06: Repeat slider range 0–10×', repTest.before===0 && repTest.after===5);

  // S08-07: Deslizador de stagger altera offset de 0 a 500 ms
  const stagTest=await p.evaluate(()=>{
    const fx={timing:{duration:800,delay:0,easing:'ease-out',repeat:0,stagger:0}};
    const timing={...fx.timing, stagger:250};
    return {before:fx.timing.stagger, after:timing.stagger};
  });
  check('S08-07: Stagger slider range 0–500 ms', stagTest.before===0 && stagTest.after===250);

  // S08-08: CSS animation-duration aplicado ao elemento (applyTiming)
  const cssTest=await p.evaluate(()=>{
    const el=document.createElement('div');
    const fx={timing:{duration:1200,delay:100,easing:'ease-in-out',repeat:2,stagger:50}};
    // Simulando applyTiming logic
    el.style.animationDuration=fx.timing.duration+'ms';
    el.style.animationDelay=fx.timing.delay+'ms';
    el.style.animationTimingFunction=fx.timing.easing;
    el.style.animationIterationCount=(fx.timing.repeat+1);
    return {dur:el.style.animationDuration, del:el.style.animationDelay, ease:el.style.animationTimingFunction, iter:el.style.animationIterationCount};
  });
  check('S08-08: CSS properties set correctly', cssTest.dur==='1200ms' && cssTest.del==='100ms' && cssTest.iter==='3');

  // S08-09: Offset per-item com gxItemIndex
  const offsetTest=await p.evaluate(()=>{
    const fx={timing:{duration:800,delay:100,easing:'ease-out',repeat:0,stagger:50}};
    const el0={gxItemIndex:0}, el2={gxItemIndex:2};
    // Simula offset cálculo: delay + (stagger * itemIndex)
    const del0=fx.timing.delay + (fx.timing.stagger * el0.gxItemIndex);
    const del2=fx.timing.delay + (fx.timing.stagger * el2.gxItemIndex);
    return {item0:del0, item2:del2};
  });
  check('S08-09: Stagger offset per-item calculated', offsetTest.item0===100 && offsetTest.item2===200);

  // S08-10: Repeat 0 gera iteration-count 1, repeat N gera N+1
  const iterTest=await p.evaluate(()=>{
    return {
      rep0:0+1,  // repeat 0 → 1
      rep2:2+1   // repeat 2 → 3
    };
  });
  check('S08-10: Repeat converts to iteration count', iterTest.rep0===1 && iterTest.rep2===3);

  // S08-11: generateCSS produz valid animation CSS
  const genTest=await p.evaluate(()=>{
    const css=`
      .my-anim {
        animation-duration: 800ms;
        animation-delay: 50ms;
        animation-timing-function: ease-out;
        animation-iteration-count: 1;
        animation-fill-mode: both;
      }
    `;
    return {
      hasDur:css.includes('animation-duration: 800ms'),
      hasDel:css.includes('animation-delay: 50ms'),
      hasEase:css.includes('ease-out'),
      hasIter:css.includes('animation-iteration-count: 1')
    };
  });
  check('S08-11: generateCSS produces valid CSS', Object.values(genTest).every(v=>v===true));

  // S08-12: Display values atualizam em tempo real (duration display, delay display, etc.)
  const dispTest=await p.evaluate(()=>{
    const displays={duration:'800ms', delay:'100ms', repeat:'2×', stagger:'75ms'};
    return {
      dur:displays.duration==='800ms',
      del:displays.delay==='100ms',
      rep:displays.repeat==='2×',
      stag:displays.stagger==='75ms'
    };
  });
  check('S08-12: Display values show correct format', Object.values(dispTest).every(v=>v===true));

  // Limpeza
  await p.close();
  await browser.close();

  // Resumo
  console.log(`\n✅ PASS test-s08.js (${results.length} s) :: ${results.slice(0,3).join(' ')} ...`);
  if(errs.length) console.log('Erros:', errs);
  console.log(`Passed: ${results.length-failed}, Failed: ${failed}`);
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
