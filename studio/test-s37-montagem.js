/* S37 — montagem enxuta (assemble.py): o HTML montado vai sem comentários, indentação e linhas vazias; as fontes continuam comentadas.
   Prova, sem navegador, que o código é o MESMO: monta duas vezes (normal e AM_NOSTRIP=1) e compara cada <script> e cada <style> dos dois HTML:
   JS com a mesma sequência de tokens e as mesmas quebras de linha antes de cada token (a inserção automática de ';' não muda), CSS igual tirando
   comentários e espaços. Também: só os separadores de arquivo sobram como comentário, o runtime exportado não leva comentário, tamanho.
   Uso: node test-s37-montagem.js (monta sozinho; não depende do HTML já montado) */
const path=require('path'); const fs=require('fs'); const os=require('os'); const {execFileSync}=require('child_process');
const ts=require('/opt/node22/lib/node_modules/typescript');
const results=[]; let failed=0;
function check(name, ok, info){ results.push((ok?'PASS ':'FAIL ')+name+(info!==undefined?'  '+JSON.stringify(info).slice(0,900):'')); if(!ok) failed++; }
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'s37-'));
const build=(out,env)=>execFileSync('python3',['assemble.py',out],{cwd:__dirname,env:Object.assign({},process.env,env),encoding:'utf8'});
build(path.join(TMP,'min.html'),{}); build(path.join(TMP,'raw.html'),{AM_NOSTRIP:'1'});
const MIN=fs.readFileSync(path.join(TMP,'min.html'),'utf8'), RAW=fs.readFileSync(path.join(TMP,'raw.html'),'utf8');
const blocks=(h,tag)=>{ const re=new RegExp('<'+tag+'([^>]*)>([\\s\\S]*?)</'+tag+'>','g'); const out=[]; let m; while((m=re.exec(h))) out.push({attrs:m[1], body:m[2]}); return out; };
/* tokens como o parser vê: barra = regex onde a gramática espera expressão */
const RE_PREV=new Set(['OpenParenToken','CommaToken','EqualsToken','ColonToken','OpenBracketToken','ExclamationToken','AmpersandAmpersandToken','BarBarToken','QuestionToken','OpenBraceToken','CloseBraceToken','SemicolonToken','ReturnKeyword','TypeOfKeyword','CaseKeyword','EqualsEqualsEqualsToken','ExclamationEqualsEqualsToken','PlusToken','MinusToken','AmpersandToken','BarToken','EqualsEqualsToken','ExclamationEqualsToken','LessThanToken','GreaterThanToken','InKeyword','NewKeyword','DeleteKeyword','VoidKeyword','ThrowKeyword','ElseKeyword','DoKeyword','InstanceOfKeyword'].map(k=>ts.SyntaxKind[k]));
function toks(text){ const sc=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,text); const out=[]; let k;
  while((k=sc.scan())!==ts.SyntaxKind.EndOfFileToken){ if((k===ts.SyntaxKind.SlashToken||k===ts.SyntaxKind.SlashEqualsToken)&&(!out.length||RE_PREV.has(out[out.length-1].k))) k=sc.reScanSlashToken(); out.push({k,t:sc.getTokenText(),nl:sc.hasPrecedingLineBreak()}); }
  return out; }
function comments(text){ const sc=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,text); const out=[]; let k, prev=null;
  while((k=sc.scan())!==ts.SyntaxKind.EndOfFileToken){ if(k===ts.SyntaxKind.SingleLineCommentTrivia||k===ts.SyntaxKind.MultiLineCommentTrivia) out.push(sc.getTokenText()); else if(k===ts.SyntaxKind.SlashToken||k===ts.SyntaxKind.SlashEqualsToken){ if(!prev||RE_PREV.has(prev)) k=sc.reScanSlashToken(); } if(k!==ts.SyntaxKind.WhitespaceTrivia&&k!==ts.SyntaxKind.NewLineTrivia&&k!==ts.SyntaxKind.SingleLineCommentTrivia&&k!==ts.SyntaxKind.MultiLineCommentTrivia) prev=k; }
  return out; }
const isSep=c=>/^\/\* ---- [\w.-]+ ---- \*\/$/.test(c);
/* 1. JS: mesmos blocos, mesmos tokens */
const sm=blocks(MIN,'script'), sr=blocks(RAW,'script');
const js=[]; sm.forEach((b,i)=>{ const r=sr[i]; if(!r||r.attrs!==b.attrs){ js.push({i, attrs:b.attrs, err:'bloco diferente'}); return; } if(/type="text\/plain"|application\/json/.test(b.attrs)) return;
  const a=toks(r.body), m=toks(b.body); let d=-1; for(let k=0;k<Math.max(a.length,m.length);k++){ const x=a[k], y=m[k]; if(!x||!y||x.k!==y.k||x.t!==y.t||(k>0&&x.nl!==y.nl)){ d=k; break; } }
  if(d>=0) js.push({i, attrs:b.attrs.trim(), at:d, raw:a[d]&&a[d].t, min:m[d]&&m[d].t}); });
const ntok=sm.reduce((s,b)=>s+(/text\/plain/.test(b.attrs)?0:toks(b.body).length),0);
check('S37-01: cada <script> do HTML montado tem a mesma sequência de tokens e as mesmas quebras de linha que a montagem com comentários (AM_NOSTRIP=1)', sm.length===sr.length && js.length===0, {blocos:sm.length, tokens:ntok, diferencas:js.slice(0,3)});
/* 2. CSS: igual tirando comentários e espaços */
const norm=s=>s.replace(/\/\*(?!%%)[\s\S]*?\*\//g,'').replace(/\s+/g,' ').trim();
const noScripts=h=>h.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''); /* <style> dentro de strings/comentários do JS não conta */
const cm=blocks(noScripts(MIN),'style'), cr=blocks(noScripts(RAW),'style'); const css=cm.map((b,i)=>cr[i]&&norm(b.body)===norm(cr[i].body)&&b.attrs===cr[i].attrs);
check('S37-02: cada <style> é igual ao da montagem com comentários, tirando comentários e espaços', cm.length===cr.length && css.every(Boolean), {blocos:cm.length, iguais:css.filter(Boolean).length});
/* 3. comentários que sobram */
const left=[]; sm.forEach(b=>{ if(/text\/plain/.test(b.attrs)) return; comments(b.body).forEach(c=>{ if(!isSep(c)) left.push(c.slice(0,60)); }); });
const cssLeft=cm.reduce((s,b)=>s+(b.body.match(/\/\*(?! ---- )[\s\S]*?\*\//g)||[]).length,0);
check('S37-03: no HTML montado não sobra comentário de JS nem de CSS (só os separadores “/* ---- arquivo ---- */” entre os módulos)', left.length===0 && cssLeft===0, {js:left.slice(0,5), css:cssLeft});
/* 4. o runtime que vai em todo arquivo exportado */
const rt=sm.find(b=>/id="am-runtime"/.test(b.attrs)), rtr=sr.find(b=>/id="am-runtime"/.test(b.attrs));
check('S37-04: o runtime embutido em cada apresentação exportada (#am-runtime) encolhe e não leva comentário, nem onclick/onerror/onmouseover', rt && rt.body.length < rtr.body.length*0.95 && !/onerror|onmouseover|onclick/i.test(rt.body) && comments(rt.body).every(isSep), {min:rt&&Math.round(rt.body.length/1024)+' KB', raw:rtr&&Math.round(rtr.body.length/1024)+' KB'});
/* 5. tamanho e marcadores */
const kb=Math.round(Buffer.byteLength(MIN)/1024), kbr=Math.round(Buffer.byteLength(RAW)/1024);
check('S37-05: o editor montado fica ≤ 1700 KiB (era ~1844 com comentários) e nenhum marcador /*%%…%%*/ sobra sem substituir', kb<=1700 && kb<kbr-120 && !/\/\*%%/.test(MIN), {kb, comComentarios:kbr});
fs.rmSync(TMP,{recursive:true,force:true});
console.log(results.join('\n'));
console.log(failed?('FALHAS: '+failed):'TUDO OK', JSON.stringify({errs:[]}));
process.exit(failed?1:0);
