import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMvpRuntime } from '../../tools/mvp-preflight.js';
const ref='fgdrjxuhzagmvqyhrqlf';
const fakeDbPassword='local'+'-demo';
const good={
 APP_ENV:'staging', APP_ORIGIN:'https://canteiro-mvp-piloto.onrender.com',
 SUPABASE_URL:'https://'+ref+'.supabase.co',
 DATABASE_URL:'postgres://app_api.'+ref+':'+fakeDbPassword+'@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require',
 DATABASE_SSL:'require',SUPABASE_JWKS_URL:'https://'+ref+'.supabase.co/auth/v1/.well-known/jwks.json',
 SUPABASE_ANON_KEY:'sb_publishable_local_test_only',
 SUPABASE_SERVICE_ROLE_KEY:'sb_'+'secret_'+'local_test_only',
 STORAGE_DRIVER:'s3',S3_FORCE_PATH_STYLE:'true',
 S3_ENDPOINT:'https://'+ref+'.storage.supabase.co/storage/v1/s3',
 S3_REGION:'sa-east-1',S3_BUCKET:'canteiro-mvp-files',
 S3_ACCESS_KEY_ID:'local-s3-test-id',S3_SECRET_ACCESS_KEY:'local-s3-test-secret',
 DB_POOL_MAX:'2',STORAGE_QUOTA_USER_MB:'100',CSRF_SECRET:'local-test-random-csrf-secret-123456789'
};
test('Render Free: banco, Auth e S3 são do mesmo Supabase e credenciais restritas',()=>{
 assert.deepEqual(validateMvpRuntime(good),{projectRef:ref,hosting:'render-free',databaseRole:'app_api',quotaMb:100});
 const direct={...good,DATABASE_URL:'postgres://app_api:'+fakeDbPassword+'@db.'+ref+'.supabase.co:5432/postgres?sslmode=require'};
 assert.equal(validateMvpRuntime(direct).databaseRole,'app_api');
});
test('Render Free: recusa OUTRO Supabase mesmo quando Auth, banco, JWKS e Storage concordam entre si',()=>{
 const other='abcdefghijklmnopqrst';
 const changed={
  ...good,
  SUPABASE_URL:'https://'+other+'.supabase.co',
  SUPABASE_JWKS_URL:'https://'+other+'.supabase.co/auth/v1/.well-known/jwks.json',
  DATABASE_URL:good.DATABASE_URL.replaceAll(ref,other),
  S3_ENDPOINT:'https://'+other+'.storage.supabase.co/storage/v1/s3',
 };
 assert.throws(()=>validateMvpRuntime(changed),/projeto Supabase exclusivo do MVP/);
 assert.equal(validateMvpRuntime(good).projectRef,ref);
});
test('Blueprint de produção e preflight apontam ao mesmo projeto dedicado do Canteiro',()=>{
 const blueprint=readFileSync(new URL('../../../render.yaml',import.meta.url),'utf8');
 for(const endpoint of [
  'https://'+ref+'.supabase.co',
  'https://'+ref+'.supabase.co/auth/v1/.well-known/jwks.json',
  'https://'+ref+'.storage.supabase.co/storage/v1/s3',
 ]) assert.ok(blueprint.includes('value: '+endpoint),'Blueprint divergente da referência do projeto MVP');
});
test('Render Free: rejeitar banco de outro projeto, postgres admin, HTTP e sem TLS',()=>{
 for(const patch of [
 { APP_ENV:'production' },{APP_ORIGIN:'http://localhost:3000'},
 {SUPABASE_URL:'https://outroprojetodevabcdef.supabase.co'},
 {SUPABASE_URL:'https://'+ref+'.supabase.co.evil.com'},
 {DATABASE_URL:'postgres://postgres:password@db.'+ref+'.supabase.co:5432/postgres?sslmode=require'},
 {DATABASE_URL:'postgres://app_api:password@db.'+ref+'.supabase.co:5432/postgres'},
 {DATABASE_URL:'postgres://app_api.'+ref+':password@evil.example.com:6543/postgres?sslmode=require'},
 {DATABASE_SSL:'disable'}, {SUPABASE_JWKS_URL:'https://evil.example.com/jwks'},
 {SUPABASE_SERVICE_ROLE_KEY:'sb_publishable_bad'},
 {SUPABASE_SERVICE_ROLE_KEY:good.SUPABASE_ANON_KEY},
 {S3_ENDPOINT:'https://outroprojetodevabcdef.storage.supabase.co/storage/v1/s3'},
 {STORAGE_DRIVER:'local'},{DB_POOL_MAX:'15'}, {STORAGE_QUOTA_USER_MB:'0'},
 {DATABASE_ADMIN_URL:'postgres://admin-secret-not-allowed'},
 {DATABASE_OPS_URL:'postgres://ops-secret-not-allowed'}
 ]) assert.throws(()=>validateMvpRuntime({...good,...patch}));
});
test('MVP privado só aceita bucket dedicado e região real sa-east-1 no S3',()=>{
 assert.equal(validateMvpRuntime(good).hosting,'render-free');
 for(const patch of [
  {S3_BUCKET:'bucket-errado'}, {S3_BUCKET:'outro-projeto'}, {S3_BUCKET:''},
  {S3_REGION:'us-east-1'}, {S3_REGION:'sa-east-2'}, {S3_REGION:undefined},
  {S3_ENDPOINT:good.S3_ENDPOINT.replace('.storage.', '.other-storage.')}
 ]) assert.throws(()=>validateMvpRuntime({...good,...patch}),/Storage S3/);
});
test('Render Free: TLS da DATABASE_URL não pode ter sslmode duplicado ou alias contraditório',()=>{
 const base = good.DATABASE_URL;
 for(const suffix of ['&sslmode=disable','&sslmode=require','&ssl=false','&ssl=true']) {
  assert.throws(()=>validateMvpRuntime({...good,DATABASE_URL:base+suffix}),/TLS obrigatório/);
 }
 assert.equal(validateMvpRuntime(good).databaseRole,'app_api');
});
test('Render Free: rejeita pool e cota indefinidos, NaN, infinito, fracionário ou fora da faixa',()=>{
 for(const key of ['DB_POOL_MAX','STORAGE_QUOTA_USER_MB']) {
  for(const bad of [undefined,'NaN','Infinity','3.5','not-a-number','-1','0','']) {
   assert.throws(()=>validateMvpRuntime({...good,[key]:bad}),new RegExp(key));
  }
 }
 for(const patch of [{DB_POOL_MAX:'6'},{STORAGE_QUOTA_USER_MB:'101'}])
  assert.throws(()=>validateMvpRuntime({...good,...patch}));
 for(const patch of [{DB_POOL_MAX:'1'},{DB_POOL_MAX:'5'},{STORAGE_QUOTA_USER_MB:'1'},{STORAGE_QUOTA_USER_MB:'100'}])
  assert.equal(validateMvpRuntime({...good,...patch}).hosting,'render-free');
});
test('Blueprint inicia o preflight antes do servidor e aplica quota de 100 MB por usuário',()=>{
 const yaml=readFileSync(new URL('../../../render.yaml',import.meta.url),'utf8');
 assert.match(yaml,/startCommand: cd platform && node tools\/mvp-preflight\.js && npm start/);
 assert.match(yaml,/key: STORAGE_QUOTA_USER_MB\s*\n\s*value: "100"/);
});
