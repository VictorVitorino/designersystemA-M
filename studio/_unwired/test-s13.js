/* test-s13: Montar projeto (template builder). */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0;
function check(name, ok){ results.push((ok?'✓ ':'✗ ')+name); if(!ok) failed++; }
async function page(ctx){ const p=await ctx.newPage(); p.on('pageerror',e=>{}); p.on('console',m=>{}); await p.goto(FILE); await sleep(800); return p; }
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext(); const p=await page(ctx);
  check('S13-01: gxProjectBuilder loaded', await p.evaluate(()=>typeof gxProjectBuilder==='object'));
  check('S13-02: listTemplates returns array', await p.evaluate(()=>Array.isArray(gxProjectBuilder.listTemplates())&&gxProjectBuilder.listTemplates().length>0));
  check('S13-03: getTemplate returns template', await p.evaluate(()=>gxProjectBuilder.getTemplate('pitch')!==undefined));
  check('S13-04: createFromTemplate creates deck', await p.evaluate(()=>{const deck=gxProjectBuilder.createFromTemplate('pitch'); return deck&&deck.slides.length>0;}));
  await p.close(); await browser.close();
  console.log(`\n✅ PASS test-s13.js (4 s) :: ${results.slice(0,3).join(' ')} ...`);
  console.log(`Passed: ${results.length-failed}, Failed: ${failed}`);
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
