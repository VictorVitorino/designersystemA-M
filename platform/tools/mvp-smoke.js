#!/usr/bin/env node
// Smoke externo: somente GET/HEAD em Render HTTPS. Nao grava dados nem usa credenciais.
export function verifyUrl(input) {
  let url; try { url=new URL(input); } catch { throw Error('URL inválida'); }
  if (url.protocol!=='https:' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com$/.test(url.hostname)
      || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash)
    throw Error('Permitida somente a origem https://<servico>.onrender.com');
  return url.origin;
}
const requireOk=(valid,msg)=>{if(!valid)throw Error(msg)};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function smoke(site,{http=fetch,tries=6,delay=10000}={}) {
  const base=verifyUrl(site);
  const get=(p,method='GET')=>http(base+p,{method,redirect:'manual',signal:AbortSignal.timeout(20000)});
  let live=null,lastError='';
  for(let i=0;i<tries;i++){
    try{
      const h=await get('/api/health'), hv=await h.json();
      requireOk(h.status===200&&hv.ok===true&&hv.env==='staging','/api/health não está em staging');
      const r=await get('/api/ready');
      live=await r.json();
      requireOk(r.status===200&&['db','storage','auth','migrations'].every(k=>live[k]===true),'/api/ready incompleto HTTP '+r.status);
      lastError='';break;
    }catch(e){lastError=String(e.message).slice(0,180);}
    if(i<tries-1&&delay>0)await pause(delay);
  }
  requireOk(!lastError,'Serviço não está pronto: '+lastError);
  const login=await get('/entrar');
  requireOk(login.status===200 && /text\/html/.test(login.headers.get('content-type')||''),'tela Entrar ausente');
  requireOk((login.headers.get('content-security-policy')||'').includes('default-src'),'CSP da tela Entrar ausente');
  requireOk(login.headers.get('x-content-type-options')==='nosniff','Cabeçalho nosniff ausente');
  const noId=await get('/editor');
  requireOk(noId.status===302&&noId.headers.get('location')==='/acervo','Editor sem UUID não redireciona');
  const editor=await get('/editor/00000000-0000-0000-0000-000000000000');
  requireOk(editor.status===200 && /text\/html/.test(editor.headers.get('content-type')||''),'Editor HTML ausente');
  const csp=editor.headers.get('content-security-policy')||'';
  requireOk(csp.includes("'strict-dynamic'")&&!/script-src[^;]*unsafe-inline/.test(csp),'CSP do editor insegura');
  const js=await get('/js/cloud-core.js','HEAD');
  requireOk(js.status===200&&/javascript/.test(js.headers.get('content-type')||''),'Editor cloud JS ausente');
  const sess=await get('/api/auth/session');
  const anonymous=await sess.json();
  requireOk(sess.status===200 && anonymous?.authenticated===false && !anonymous?.user,
    'sessão de visitante não pode estar autenticada');
  const acervo=await get('/api/presentations');
  requireOk([401,403].includes(acervo.status),
    'acervo exposto a visitantes sem login');
  return {site:base,components:live,checks:8};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  smoke(process.env.MVP_SITE_URL).then(x=>console.log('MVP: '+x.checks+' verificações HTTP aprovadas em '+x.site+
    '. Teste manual em outro computador ainda obrigatório.'))
   .catch(e=>{console.error('MVP não homologado: '+e.message);process.exitCode=1;});
}