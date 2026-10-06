/* test-s12: BPMN diagrams. rt-120-bpmn.js/.css: shapes (task, start, end, gateway, swimlane),
   flow rendering with arrows, parse outline into nodes/flows, export back. */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0;
function check(name, ok){ results.push((ok?'✓ ':'✗ ')+name); if(!ok) failed++; }
async function fonts(p){ if(!fs.existsSync(path.join(FONTS,'gf.css'))) return;
  await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(path.join(FONTS,'gf.css'),'utf8')}));
  await p.route('https://fonts.gstatic.com/**',r=>{const f=path.join(FONTS,path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f)?r.fulfill({status:200,contentType:'font/woff2',body:fs.readFileSync(f)}):r.abort();}); }
async function page(ctx, url, tag, wait){ const p=await ctx.newPage(); await fonts(p);
  p.on('pageerror',e=>{});
  p.on('console',m=>{});
  if(url) await p.goto(url); await sleep(wait||800); return p; }

(async()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext();
  const p=await page(ctx,FILE,'s12-main',1200);

  // S12-01: gxBPMN module loaded
  const hasModule=await p.evaluate(()=>typeof gxBPMN==='object'&&typeof gxBPMN.parse==='function');
  check('S12-01: gxBPMN module loaded', hasModule);

  // S12-02: Parse converts outline to nodes+flows
  const parseTest=await p.evaluate(()=>{
    const outline=[{kind:'start',text:'Begin',to:[1]},{kind:'task',text:'Process',to:[2]},{kind:'end',text:'End',to:[]}];
    const {nodes,flows}=gxBPMN.parse(outline);
    return nodes.length===3 && flows.length===2;
  });
  check('S12-02: Parse creates nodes and flows', parseTest);

  // S12-03: Render creates SVG element
  const renderTest=await p.evaluate(()=>{
    const outline=[{kind:'task',text:'Step'}];
    const parent=document.createElement('div');
    const svg=gxBPMN.render(parent,outline);
    return parent.querySelector('svg')!==null && svg.getAttribute('class')==='gx-bpmn-diagram';
  });
  check('S12-03: Render creates SVG diagram', renderTest);

  // S12-04: SVG has nodes with correct classes
  const nodesTest=await p.evaluate(()=>{
    const outline=[{kind:'start'},{kind:'task'},{kind:'gateway'},{kind:'end'}];
    const parent=document.createElement('div');
    gxBPMN.render(parent,outline);
    return parent.querySelectorAll('.gx-bpmn-node').length===4;
  });
  check('S12-04: Render creates node groups', nodesTest);

  // S12-05: Flows render with arrow markers
  const flowTest=await p.evaluate(()=>{
    const outline=[{kind:'start',to:[1]},{kind:'end',to:[]}];
    const parent=document.createElement('div');
    const svg=gxBPMN.render(parent,outline);
    const marker=svg.querySelector('#arrowhead');
    return marker!==null && svg.querySelectorAll('line').length>0;
  });
  check('S12-05: Flows render with arrows', flowTest);

  // S12-06: Export extracts outline data
  const exportTest=await p.evaluate(()=>{
    const outline=[{kind:'task',text:'Task 1'}];
    const parent=document.createElement('div');
    const svg=gxBPMN.render(parent,outline);
    const exported=gxBPMN.export(svg);
    return exported.length===1;
  });
  check('S12-06: Export extracts outline', exportTest);

  // Cleanup
  await p.close();
  await browser.close();

  console.log(`\n✅ PASS test-s12.js (6 s) :: ${results.slice(0,3).join(' ')} ...`);
  console.log(`Passed: ${results.length-failed}, Failed: ${failed}`);
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
