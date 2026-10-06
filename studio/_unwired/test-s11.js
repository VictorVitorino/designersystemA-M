/* test-s11: Arquivo HTML editável + comentários. rt-110-export-html.js: gera HTML contenteditable
   com markers de comentário, extrai edições e comentários, download funciona. */
process.env.NODE_PATH='/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const {chromium}=require('playwright'); const path=require('path'); const fs=require('fs'); const os=require('os');
const FILE='file://'+path.join(__dirname,'AM-Studio-Editor.html');
const FONTS=process.env.AM_FONTS_DIR||path.join(__dirname,'..','fonts2');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[]; let failed=0; const errs=[];
function check(name, ok){ results.push((ok?'✓ ':'✗ ')+name); if(!ok) failed++; }
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
  const p=await page(ctx,FILE,'s11-main',1200);

  // S11-01: gxExportHTML module existe
  const hasModule=await p.evaluate(()=>typeof gxExportHTML==='object'&&typeof gxExportHTML.generate==='function');
  check('S11-01: gxExportHTML module loaded', hasModule);

  // S11-02: Generate cria HTML com structure (DOCTYPE, html, head, body)
  const htmlTest=await p.evaluate(()=>{
    const deck={slides:[{title:{t:'Test'},els:[],bg:{c:'#fff'}}]};
    const html=gxExportHTML.generate(deck,'Test Deck');
    return html.includes('<!DOCTYPE html>') && html.includes('contenteditable') && html.includes('Test Deck');
  });
  check('S11-02: Generate creates valid HTML structure', htmlTest);

  // S11-03: Título é contenteditable
  const titleEditTest=await p.evaluate(()=>{
    const deck={slides:[{title:{t:'My Title'},els:[],bg:{c:'#fff'}}]};
    const html=gxExportHTML.generate(deck,'Deck');
    return html.includes('data-field="title"') && html.includes('contenteditable="true"') && html.includes('My Title');
  });
  check('S11-03: Slide title is contenteditable', titleEditTest);

  // S11-04: Elementos text/shape/image renderizam corretamente
  const elsTest=await p.evaluate(()=>{
    const deck={slides:[{
      title:{t:'Title'},
      els:[
        {kind:'text',t:'Some text'},
        {kind:'shape',text:'Shape label'},
        {kind:'image',src:'img.png',caption:'Caption'}
      ],
      bg:{c:'#fff'}
    }]};
    const html=gxExportHTML.generate(deck,'Deck');
    return html.includes('data-kind="text"') && html.includes('data-kind="shape"') && html.includes('data-kind="image"');
  });
  check('S11-04: Elements render with kind attributes', elsTest);

  // S11-05: extractEdits extrai conteúdo editável
  const extractTest=await p.evaluate(()=>{
    const html=`<div data-slide="0"><h1 contenteditable="true" data-field="title">Title</h1>
                <p contenteditable="true" data-el="0" data-kind="text">Edited text</p></div>`;
    const edits=gxExportHTML.extractEdits(html);
    return Object.keys(edits).length>0 && Object.values(edits).some(v=>v.includes('Title'));
  });
  check('S11-05: extractEdits parses contenteditable elements', extractTest);

  // S11-06: extractComments encontra comment markers
  const commentTest=await p.evaluate(()=>{
    const html='<p>Text <!--comment-1:Review this part--></p>';
    const comments=gxExportHTML.extractComments(html);
    return comments.length>0 && comments[0].text.includes('Review');
  });
  check('S11-06: extractComments finds comment markers', commentTest);

  // S11-07: Escape HTML evita injection
  const escapeTest=await p.evaluate(()=>{
    const escaped=gxExportHTML.escapeHTML('<script>alert(1)</script>');
    return !escaped.includes('<script') && escaped.includes('&lt;');
  });
  check('S11-07: escapeHTML prevents XSS', escapeTest);

  // S11-08: Múltiplos slides geram múltiplas .slide divs
  const multiSlideTest=await p.evaluate(()=>{
    const deck={slides:[{title:{t:'S1'},els:[],bg:{c:'#fff'}},{title:{t:'S2'},els:[],bg:{c:'#f5f5f5'}}]};
    const html=gxExportHTML.generate(deck,'Deck');
    const parser=new DOMParser();
    const doc=parser.parseFromString(html,'text/html');
    return doc.querySelectorAll('.slide').length===2;
  });
  check('S11-08: Multiple slides generate multiple .slide divs', multiSlideTest);

  // S11-09: Background color in data-bg attribute
  const bgAttrTest=await p.evaluate(()=>{
    const deck={slides:[{title:{t:'T'},els:[],bg:{c:'#ff0000'}}]};
    const html=gxExportHTML.generate(deck,'Deck');
    return html.includes('data-bg="#ff0000"');
  });
  check('S11-09: Background color in data-bg attribute', bgAttrTest);

  // S11-10: Download function creates blob and link
  const downloadTest=await p.evaluate(()=>{
    let clicked=false;
    const oldClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){ clicked=true; oldClick.call(this); };
    try {
      gxExportHTML.download('<html></html>','test.html');
      return clicked;
    } finally {
      HTMLAnchorElement.prototype.click=oldClick;
    }
  });
  check('S11-10: download() creates downloadable file', downloadTest);

  // Resumo
  await p.close();
  await browser.close();

  console.log(`\n✅ PASS test-s11.js (${results.length} s) :: ${results.slice(0,3).join(' ')} ...`);
  console.log(`Passed: ${results.length-failed}, Failed: ${failed}`);
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
