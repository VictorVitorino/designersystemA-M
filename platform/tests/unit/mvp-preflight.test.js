import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMvpRuntime } from '../../tools/mvp-preflight.js';
const ref='abcdefghijklmnopqrst';
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
test('Blueprint inicia o preflight antes do servidor e aplica quota de 100 MB por usuário',()=>{
 const yaml=readFileSync(new URL('../../../render.yaml',import.meta.url),'utf8');
 assert.match(yaml,/startCommand: cd platform && node tools\/mvp-preflight\.js && npm start/);
 assert.match(yaml,/key: STORAGE_QUOTA_USER_MB\s*\n\s*value: "100"/);
});
