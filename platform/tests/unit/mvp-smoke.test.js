import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyUrl,smoke} from '../../tools/mvp-smoke.js';
test('smoke MVP bloqueia SSRF, URL falsa e credenciais no endereço',()=>{
 assert.equal(verifyUrl('https://canteiro-mvp-piloto.onrender.com'),'https://canteiro-mvp-piloto.onrender.com');
 for(const u of ['http://a.onrender.com','https://localhost','https://127.0.0.1',
 'https://a.onrender.com.evil.net','https://user:pw@a.onrender.com','https://a.onrender.com/private',
 'https://a.onrender.com?x=1','https://example.com'])assert.throws(()=>verifyUrl(u));
});
const fake=({unready=false,weak=false,expose=false}={})=>async(url)=>{
 const p=new URL(url).pathname;
 if(p==='/api/auth/session')return Response.json({authenticated:false,csrfToken:'test'});
 if(p==='/api/presentations')return expose?Response.json({items:[]},{status:200}):Response.json({error:'unauthorized'},{status:401});
 if(p==='/api/health')return Response.json({ok:true,env:'staging'});
 if(p==='/api/ready')return Response.json({db:true,auth:true,storage:!unready,migrations:true},{status:unready?503:200});
 if(p==='/entrar')return new Response('Entrar',{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'",'X-Content-Type-Options':'nosniff'}});
 if(p==='/editor')return new Response(null,{status:302,headers:{location:'/acervo'}});
 if(p.startsWith('/editor/'))return new Response('Editor',{headers:{'Content-Type':'text/html','Content-Security-Policy':weak?"script-src 'unsafe-inline'":"script-src 'self' 'strict-dynamic'"}});
 if(p==='/js/cloud-core.js')return new Response(null,{headers:{'Content-Type':'text/javascript'}});
 return new Response('missing',{status:404});
};
test('smoke MVP verifica readiness, editor, JS e CSP sem credenciais',async()=>{
 const o=await smoke('https://a.onrender.com',{http:fake(),tries:1,delay:0});
 assert.equal(o.checks,8);assert.equal(o.components.storage,true);
 await assert.rejects(()=>smoke('https://a.onrender.com',{http:fake({expose:true}),tries:1,delay:0}),/acervo exposto/);
 await assert.rejects(()=>smoke('https://a.onrender.com',{http:fake({unready:true}),tries:1,delay:0}),/não está pronto/);
 await assert.rejects(()=>smoke('https://a.onrender.com',{http:fake({weak:true}),tries:1,delay:0}),/CSP do editor insegura/);
});