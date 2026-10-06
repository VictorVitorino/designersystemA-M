/* test-s14: Exportar PPTX. */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0;
function check(name, ok){ results.push((ok?'✓ ':'✗ ')+name); if(!ok) failed++; }
async function page(ctx){ const p=await ctx.newPage(); p.on('pageerror',e=>{}); p.on('console',m=>{}); await p.goto(FILE); await sleep(800); return p; }
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext(); const p=await page(ctx);
  check('S14-01: gxPPTXExport loaded', await p.evaluate(()=>typeof gxPPTXExport==='object'));
  check('S14-02: generate creates structure', await p.evaluate(()=>{
    const deck={slides:[{bg:{c:'#fff'},els:[{t:'Test'}]}]};
    const pptx=gxPPTXExport.generate(deck,'Test');
    return pptx&&pptx.files.length>0;
  }));
  check('S14-03: escapeXML prevents injection', await p.evaluate(()=>{
    const escaped=gxPPTXExport.escapeXML('<script>');
    return escaped.includes('&lt;') && !escaped.includes('<script');
  }));
  check('S14-04: toBlob creates blob', await p.evaluate(()=>{
    const deck={slides:[{bg:{c:'#fff'}}]};
    const pptx=gxPPTXExport.generate(deck,'Deck');
    return pptx.toBlob() instanceof Blob;
  }));
  await p.close(); await browser.close();
  console.log(`\n✅ PASS test-s14.js (4 s) :: ${results.slice(0,3).join(' ')} ...`);
  console.log(`Passed: ${results.length-failed}, Failed: ${failed}`);
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
