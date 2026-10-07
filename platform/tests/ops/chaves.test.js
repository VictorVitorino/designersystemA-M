import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { montar, variaveisDaApi, relatorioProblemas, normalizaAmbiente, extraiRef, extraiContaR2, urlPostgres, poolerCandidatos, ITENS, AMBIENTES, ondeColar } from '../../tools/lib/chaves.js';
import { descobrirPooler, conectarReal } from '../../tools/lib/pooler.js';
import { FORBIDDEN_API_ENV } from '../../tools/lib/api-env.js';
import { ADMIN_URL, tmp, rmrf } from './_helpers.js';

// valores de TESTE montados em tempo de execução (o secret-scan não vê nenhum padrão completo neste arquivo)
const REF = 'abcdefghijklmnopqrst';
const PUB = ['sb', 'publishable', 'x'.repeat(30)].join('_'), SEC = ['sb', 'secret', 'y'.repeat(30)].join('_');
const CONTA = '0123456789abcdef0123456789abcdef';
const SENHA_BANCO = 'Senha do banco/exemplo @#%41 ?&=', API_PW = 'senha-app-api-exemplo-1234567890', OPS_PW = 'senha-app-ops-exemplo-1234567890';
const POOLER = 'aws-1-sa-east-1.pooler.supabase.com';
const CHAVE = crypto.randomBytes(32).toString('base64');
const base = (extra = {}) => ({ SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: SENHA_BANCO, APP_API_DB_PASSWORD: API_PW, APP_OPS_DB_PASSWORD: OPS_PW, SUPABASE_ANON_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SEC,
  S3_ACCESS_KEY_ID: 'chave-s3-id-exemplo', S3_SECRET_ACCESS_KEY: 'chave-s3-segredo-exemplo', R2_ACCOUNT_ID: CONTA, BACKUP_S3_ACCESS_KEY_ID: 'r2-id-exemplo', BACKUP_S3_SECRET_ACCESS_KEY: 'r2-segredo-exemplo',
  BACKUP_ENCRYPTION_KEY: CHAVE, PRODUCTION_URL: 'https://canteiro.exemplo.com.br', STAGING_URL: 'https://staging.canteiro.exemplo.com.br', VERCEL_TOKEN: 'token-vercel-exemplo', ...extra });

test('ambiente, ref, conta do R2 e origem: aceitam o que a pessoa costuma colar', () => {
  assert.equal(normalizaAmbiente('Produção'), 'production'); assert.equal(normalizaAmbiente('prod'), 'production'); assert.equal(normalizaAmbiente('staging'), 'staging');
  assert.throws(() => normalizaAmbiente('qa'), /ambiente desconhecido/);
  assert.equal(extraiRef(REF), REF); assert.equal(extraiRef(`https://${REF}.supabase.co`), REF); assert.equal(extraiRef(`https://supabase.com/dashboard/project/${REF}/settings/general`), REF);
  assert.equal(extraiRef('meu-projeto'), null); assert.equal(extraiRef(''), '');
  assert.equal(extraiContaR2(CONTA), CONTA); assert.equal(extraiContaR2(`https://${CONTA}.r2.cloudflarestorage.com`), CONTA); assert.equal(extraiContaR2('xyz'), null);
  assert.deepEqual(poolerCandidatos('sa-east-1'), ['aws-0-sa-east-1.pooler.supabase.com', 'aws-1-sa-east-1.pooler.supabase.com', 'aws-2-sa-east-1.pooler.supabase.com']);
});

test('monta tudo a partir das chaves mínimas: pooler em modo SESSÃO, usuários <papel>.<ref>, endpoints, buckets e prefixo por ambiente', () => {
  const r = montar(base(), { ambiente: 'production', precisa: ['banco', 'ops', 'papeis', 'supabase', 'servico', 'arquivos', 'backup', 'site'], poolerHost: POOLER });
  assert.deepEqual(r.faltando, []); assert.deepEqual(r.erros, []); assert.equal(r.poolerPendente, false);
  const a = new URL(r.env.DATABASE_ADMIN_URL), o = new URL(r.env.DATABASE_OPS_URL);
  assert.equal(a.hostname, POOLER); assert.equal(a.port, '5432'); assert.equal(decodeURIComponent(a.username), `postgres.${REF}`); assert.equal(decodeURIComponent(a.password), SENHA_BANCO, 'qualquer caractere na senha sobrevive');
  assert.equal(a.searchParams.get('sslmode'), 'require'); assert.equal(decodeURIComponent(o.username), `app_ops.${REF}`); assert.equal(decodeURIComponent(o.password), OPS_PW);
  assert.equal(r.env.SUPABASE_URL, `https://${REF}.supabase.co`); assert.equal(r.env.SUPABASE_JWKS_URL, `https://${REF}.supabase.co/auth/v1/.well-known/jwks.json`);
  assert.equal(r.env.S3_ENDPOINT, `https://${REF}.supabase.co/storage/v1/s3`); assert.equal(r.env.S3_BUCKET, 'canteiro-arquivos'); assert.equal(r.env.S3_REGION, 'sa-east-1'); assert.equal(r.env.STORAGE_DRIVER, 's3');
  assert.equal(r.env.BACKUP_TARGET, 's3://canteiro-backup/producao'); assert.equal(r.env.BACKUP_S3_ENDPOINT, `https://${CONTA}.r2.cloudflarestorage.com`); assert.equal(r.env.BACKUP_S3_REGION, 'auto'); assert.equal(r.env.BACKUP_ENV_NAME, 'production');
  assert.equal(r.env.APP_ORIGIN, 'https://canteiro.exemplo.com.br');
  assert.ok(r.mascarar.includes(r.env.DATABASE_ADMIN_URL) && r.mascarar.includes(encodeURIComponent(SENHA_BANCO)), 'URLs montadas com senha são mascaradas no GitHub');
  const s = montar(base(), { ambiente: 'staging', precisa: ['arquivos', 'backup', 'site'] });
  assert.equal(s.env.S3_BUCKET, 'canteiro-arquivos-staging'); assert.equal(s.env.BACKUP_TARGET, 's3://canteiro-backup/staging'); assert.equal(s.env.APP_ORIGIN, 'https://staging.canteiro.exemplo.com.br');
  // sem o servidor do pooler: avisa que precisa descobrir (não inventa)
  const p = montar(base(), { ambiente: 'production', precisa: ['banco'] }); assert.equal(p.poolerPendente, true); assert.equal(p.env.DATABASE_ADMIN_URL, undefined);
  assert.equal(montar(base({ SUPABASE_POOLER_HOST: POOLER }), { ambiente: 'production', precisa: ['banco'] }).env.DATABASE_ADMIN_URL.includes(POOLER), true);
  assert.equal(montar(base({ CANTEIRO_POOLER_HOST: POOLER }), { ambiente: 'production', precisa: ['banco'] }).poolerPendente, false);
});

test('compatibilidade: valores antigos prontos (DATABASE_ADMIN_URL, BACKUP_TARGET…) têm prioridade e dispensam o ref', () => {
  const antiga = urlPostgres({ user: 'postgres', password: 'senha-antiga-exemplo', host: 'db.exemplo.invalid', port: 5432 });
  const r = montar({ DATABASE_ADMIN_URL: antiga, DATABASE_OPS_URL: antiga, BACKUP_TARGET: 's3://outro-bucket/x', BACKUP_S3_ENDPOINT: 'https://outro.exemplo.invalid', BACKUP_S3_ACCESS_KEY_ID: 'a', BACKUP_S3_SECRET_ACCESS_KEY: 'b', BACKUP_ENCRYPTION_KEY: CHAVE, S3_BUCKET: 'meu-bucket' }, { ambiente: 'production', precisa: ['banco', 'ops', 'backup'] });
  assert.deepEqual(r.faltando, []); assert.equal(r.env.DATABASE_ADMIN_URL, antiga); assert.equal(r.env.BACKUP_TARGET, 's3://outro-bucket/x'); assert.equal(r.env.BACKUP_S3_ENDPOINT, 'https://outro.exemplo.invalid');
  assert.match(r.origem.DATABASE_ADMIN_URL, /configuração antiga/);
});

test('falta e erro dizem O QUE copiar, DE ONDE e ONDE colar (sem mostrar valores)', () => {
  const r = montar({}, { ambiente: 'production', precisa: ['banco', 'arquivos', 'backup', 'supabase'] });
  const nomes = r.faltando.map((f) => f.nome);
  for (const n of ['SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_ENCRYPTION_KEY', 'R2_ACCOUNT_ID', 'SUPABASE_ANON_KEY']) assert.ok(nomes.includes(n), n);
  const txt = relatorioProblemas(r); assert.match(txt, /production-ops → Environment secrets/); assert.match(txt, /Variables \(do repositório\)/); assert.match(txt, /docs\/CHAVES\.md/);
  assert.equal(ondeColar('BACKUP_S3_ACCESS_KEY_ID', 'production', { leitura: true }), 'GitHub → Settings → Environments → monitoring → Environment secrets');
  assert.match(ondeColar('SUPABASE_PROJECT_REF', 'staging'), /staging → Environment variables/);
  // chaves trocadas, senhas fracas/iguais, ref e conta inválidos
  const e = montar(base({ SUPABASE_ANON_KEY: SEC, SUPABASE_SERVICE_ROLE_KEY: PUB, APP_API_DB_PASSWORD: 'curta', APP_OPS_DB_PASSWORD: 'curta', R2_ACCOUNT_ID: 'nao-e-conta', SUPABASE_PROJECT_REF: 'meu projeto' }), { ambiente: 'production', precisa: ['papeis', 'supabase', 'servico', 'backup'] });
  const t = e.erros.join(' | ');
  for (const re of [/SUPABASE_ANON_KEY recebeu a chave SECRETA/, /SUPABASE_SERVICE_ROLE_KEY recebeu a chave PÚBLICA/, /APP_API_DB_PASSWORD é curta/, /são iguais/, /R2_ACCOUNT_ID não parece/, /SUPABASE_PROJECT_REF não parece/]) assert.match(t, re);
  assert.ok(!t.includes(SEC) && !t.includes(PUB) && !relatorioProblemas(e).includes(SEC), 'nunca imprime chaves');
  assert.match(montar(base({ APP_API_DB_PASSWORD: SENHA_BANCO }), { ambiente: 'staging', precisa: ['papeis'] }).erros.join(), /diferentes da senha do banco/);
  assert.match(montar(base({ BACKUP_S3_ACCESS_KEY_ID: 'chave-s3-id-exemplo' }), { ambiente: 'production', precisa: ['backup'] }).erros.join(), /token do R2, não da chave do Storage/);
  assert.throws(() => montar({}, { ambiente: 'production', precisa: ['nada'] }), /grupo desconhecido/);
});

test('variáveis da API para a Vercel: DATABASE_URL no pooler de TRANSAÇÃO (6543) com app_api, segredos marcados, NUNCA credencial de ferramenta', () => {
  const v = variaveisDaApi(base({ CSRF_SECRET: 'c'.repeat(48), INVITE_ALLOWED_DOMAINS: 'exemplo.com.br' }), { ambiente: 'production', poolerHost: POOLER });
  assert.deepEqual(v.faltando, []); assert.deepEqual(v.erros, []);
  const m = Object.fromEntries(v.vars.map((x) => [x.key, x]));
  const u = new URL(m.DATABASE_URL.value); assert.equal(u.port, '6543'); assert.equal(decodeURIComponent(u.username), `app_api.${REF}`); assert.equal(decodeURIComponent(u.password), API_PW); assert.equal(m.DATABASE_URL.sensivel, true);
  for (const k of ['APP_ENV', 'APP_ORIGIN', 'DATABASE_SSL', 'DB_POOL_MAX', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STORAGE_DRIVER', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CSRF_SECRET', 'TRUST_PROXY', 'INVITE_ALLOWED_DOMAINS']) assert.ok(m[k], k);
  assert.equal(m.APP_ENV.value, 'production'); assert.equal(m.DATABASE_SSL.value, 'require');
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'S3_SECRET_ACCESS_KEY', 'CSRF_SECRET', 'SUPABASE_ANON_KEY']) assert.equal(m[k].sensivel, true, k);
  for (const x of v.vars) assert.ok(!FORBIDDEN_API_ENV.some((re) => re.test(x.key)), `${x.key} nunca vai para a Vercel`);
  assert.ok(!v.vars.some((x) => /^(DATABASE_ADMIN_URL|DATABASE_OPS_URL|BACKUP_|APP_API_DB_PASSWORD|APP_OPS_DB_PASSWORD|SUPABASE_DB_PASSWORD|VERCEL_TOKEN|RESEND_API_KEY)/.test(x.key)));
  assert.equal(variaveisDaApi(base(), { ambiente: 'staging', poolerHost: POOLER }).vars.find((x) => x.key === 'APP_ENV').value, 'staging');
  assert.equal(variaveisDaApi(base(), { ambiente: 'production' }).poolerPendente, true, 'sem servidor do banco, não inventa a URL');
  assert.match(variaveisDaApi(base({ CSRF_SECRET: 'curto' }), { ambiente: 'production', poolerHost: POOLER }).erros.join(), /CSRF_SECRET/);
  // opcionais (variáveis do GitHub): login corporativo e cota por pessoa — com a mesma regra da API, que não inicia com SSO ligado sem domínios
  const chave = (r, k) => r.vars.find((x) => x.key === k)?.value;
  const semSso = variaveisDaApi(base(), { ambiente: 'production', poolerHost: POOLER }); assert.equal(chave(semSso, 'SSO_ENABLED'), undefined); assert.equal(chave(semSso, 'STORAGE_QUOTA_USER_MB'), undefined);
  const sso = variaveisDaApi(base({ SSO_ENABLED: 'true', SSO_DOMAINS: 'Exemplo.com.br, am.exemplo.com', STORAGE_QUOTA_USER_MB: '20480' }), { ambiente: 'production', poolerHost: POOLER });
  assert.deepEqual([chave(sso, 'SSO_ENABLED'), chave(sso, 'SSO_DOMAINS'), chave(sso, 'STORAGE_QUOTA_USER_MB'), sso.erros], ['true', 'exemplo.com.br,am.exemplo.com', '20480', []]);
  assert.match(variaveisDaApi(base({ SSO_ENABLED: 'true' }), { ambiente: 'production', poolerHost: POOLER }).erros.join(), /SSO_DOMAINS/);
  assert.match(variaveisDaApi(base({ SSO_ENABLED: 'true', SSO_DOMAINS: 'gmail' }), { ambiente: 'production', poolerHost: POOLER }).erros.join(), /domínio inválido: gmail/);
  assert.equal(chave(variaveisDaApi(base({ SSO_ENABLED: 'false' }), { ambiente: 'production', poolerHost: POOLER }), 'SSO_ENABLED'), 'false', 'desligar = variável SSO_ENABLED=false');
  assert.match(variaveisDaApi(base({ STORAGE_QUOTA_USER_MB: '20 GB' }), { ambiente: 'production', poolerHost: POOLER }).erros.join(), /STORAGE_QUOTA_USER_MB/);
});

test('descoberta do servidor do banco: pula outros clusters, PARA com senha errada, explica quando não acha', async () => {
  const tentados = [];
  const conectar = async ({ host, user, password }) => { tentados.push(host); assert.equal(user, `postgres.${REF}`); if (host !== POOLER) throw Object.assign(new Error('Tenant or user not found'), { code: 'XX000' }); if (password !== SENHA_BANCO) throw Object.assign(new Error('password authentication failed for user'), { code: '28P01' }); };
  const ok = await descobrirPooler({ ref: REF, password: SENHA_BANCO, conectar }); assert.equal(ok.host, POOLER); assert.deepEqual(tentados, ['aws-0-sa-east-1.pooler.supabase.com', POOLER]);
  await assert.rejects(() => descobrirPooler({ ref: REF, password: 'senha-errada-exemplo', conectar }), (e) => /RECUSOU a senha/.test(e.message) && !e.message.includes('senha-errada-exemplo'));
  await assert.rejects(() => descobrirPooler({ ref: REF, password: SENHA_BANCO, conectar: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); } }), (e) => /não achei o servidor do banco/.test(e.message) && /SUPABASE_REGION/.test(e.message) && e.message.split('\n').length >= 4);
  await assert.rejects(() => descobrirPooler({ ref: '', password: 'x' }), /SUPABASE_PROJECT_REF/);
});

test('conector real (Postgres local): conecta com a senha certa e a senha errada vira 28P01 (o que a descoberta usa para parar)', async () => {
  const u = new URL(ADMIN_URL); const host = u.hostname, port = Number(u.port || 5432);
  await conectarReal({ host, port, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: false });
  await assert.rejects(() => conectarReal({ host, port, user: decodeURIComponent(u.username), password: 'senha-errada-exemplo', database: u.pathname.slice(1), ssl: false }), (e) => e.code === '28P01' || /password authentication failed/.test(e.message));
});

test('CLI chaves.js: conferir lista o que falta (código 2, sem valores); exec monta e roda o comando com as variáveis; o código de saída é o do comando', () => {
  const cwd = new URL('../..', import.meta.url).pathname; const PATH = process.env.PATH;
  const falta = spawnSync(process.execPath, ['tools/chaves.js', 'conferir', '--ambiente', 'production', '--precisa', 'banco,backup', '--json'], { cwd, env: { PATH, SUPABASE_PROJECT_REF: REF }, encoding: 'utf8' });
  assert.equal(falta.status, 2); assert.match(falta.stderr, /SUPABASE_DB_PASSWORD/); assert.match(falta.stderr, /cole em: GitHub/); const j = JSON.parse(falta.stdout.trim().split('\n').pop()); assert.equal(j.ok, false); assert.ok(j.faltando.includes('R2_ACCOUNT_ID'));
  const d = tmp('chaves'); try {
    const resumo = path.join(d, 'resumo.md'), genv = path.join(d, 'env');
    const env = { PATH, ...base({ SUPABASE_POOLER_HOST: POOLER }), GITHUB_ACTIONS: 'true' };
    const ok = spawnSync(process.execPath, ['tools/chaves.js', 'conferir', '--ambiente', 'production', '--precisa', 'banco,papeis,arquivos,backup,site', '--resumo', resumo, '--github-env', genv], { cwd, env, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /^::add-mask::/m, 'no GitHub, registra as URLs montadas como segredo');
    const md = fs.readFileSync(resumo, 'utf8'); assert.match(md, /canteiro-arquivos/); assert.match(md, /s3:\/\/canteiro-backup\/producao/); assert.match(md, /DATABASE_ADMIN_URL` \| ok \|/);
    for (const s of [SENHA_BANCO, encodeURIComponent(SENHA_BANCO), API_PW, OPS_PW, CHAVE, 'chave-s3-segredo-exemplo', 'r2-segredo-exemplo']) assert.ok(!md.includes(s) && !ok.stderr.includes(s), 'o resumo e o log nunca mostram valores secretos');
    const ex = spawnSync(process.execPath, ['tools/chaves.js', 'exec', '--ambiente', 'staging', '--precisa', 'banco,arquivos', '--', process.execPath, '-e', 'const u=new URL(process.env.DATABASE_ADMIN_URL);console.log(JSON.stringify({h:u.hostname,b:process.env.S3_BUCKET,d:process.env.STORAGE_DRIVER}));process.exit(7)'], { cwd, env: { PATH, ...base({ SUPABASE_POOLER_HOST: POOLER }) }, encoding: 'utf8' });
    assert.equal(ex.status, 7, ex.stderr); assert.deepEqual(JSON.parse(ex.stdout.trim()), { h: POOLER, b: 'canteiro-arquivos-staging', d: 's3' }); assert.doesNotMatch(ex.stdout, /add-mask/, 'exec não polui a saída do comando');
    const semCmd = spawnSync(process.execPath, ['tools/chaves.js', 'exec', '--ambiente', 'staging', '--precisa', 'banco'], { cwd, env: { PATH }, encoding: 'utf8' }); assert.equal(semCmd.status, 2);
    const semAmb = spawnSync(process.execPath, ['tools/chaves.js', 'conferir', '--precisa', 'banco'], { cwd, env: { PATH }, encoding: 'utf8' }); assert.equal(semAmb.status, 2); assert.match(semAmb.stderr, /informe o ambiente/);
  } finally { rmrf(d); }
});

test('ITENS documentados: cada chave mínima tem "de onde copiar" e aparece em docs/CHAVES.md', () => {
  const doc = fs.readFileSync(new URL('../../docs/CHAVES.md', import.meta.url), 'utf8');
  for (const [nome, meta] of Object.entries(ITENS)) { assert.ok(meta.de && meta.tipo, nome); assert.ok(doc.includes(nome), `docs/CHAVES.md não cita ${nome}`); }
  for (const a of Object.values(AMBIENTES)) assert.ok(doc.includes(a.github), `docs/CHAVES.md não cita o ambiente ${a.github}`);
});
