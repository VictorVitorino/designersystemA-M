import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { configurarVercel, descobrirIds, resolverTime, clienteVercel, proibida, AJUSTES_PROJETO } from '../../tools/vercel-setup.js';
import { tmp, rmrf } from './_helpers.js';

// API FALSA da Vercel (mesmas rotas que a CLI da Vercel 62.5.0 usa para variáveis). O script NÃO foi executado contra a Vercel real.
const TOKEN = 'token-vercel-exemplo-123', REF = 'abcdefghijklmnopqrst';
const PUB = ['sb', 'publishable', 'p'.repeat(30)].join('_'), SEC = ['sb', 'secret', 's'.repeat(30)].join('_');
const API_PW = 'senha-app-api-exemplo-1234567890';

function vercelFalsa({ times = [{ id: 'team_1', slug: 'canteiro-am', name: 'Canteiro A&M' }], projeto = null, envs = [], chavesOk = true, dominioPronto = false } = {}) {
  const st = { times, projeto, envs: envs.map((e, i) => ({ id: `env_var_${i}`, ...e })), custom: [], dominios: new Map(), escritas: [], seq: 100, bypass: {} };
  const srv = http.createServer(async (req, res) => {
    let corpo = ''; for await (const c of req) corpo += c; const body = corpo ? JSON.parse(corpo) : undefined;
    const u = new URL(req.url, 'http://x'); const p = u.pathname; const m = req.method; const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (p.startsWith('/supabase/')) {   // conferência das chaves do Supabase antes de gravar
      const q = p.slice('/supabase'.length); const key = req.headers.apikey;
      if (q === '/auth/v1/settings') return chavesOk && key === PUB ? json(200, { disable_signup: true }) : json(401, { message: 'Invalid API key' });
      if (q === '/auth/v1/admin/users') return chavesOk && key === SEC ? json(200, { users: [] }) : json(401, { message: 'Invalid API key' });
      return json(404, {});
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(403, { error: { code: 'forbidden', message: 'Not authorized' } });
    if (m !== 'GET') st.escritas.push(`${m} ${p}`);
    if (p === '/v2/teams') return json(200, { teams: st.times });
    if (p !== '/v2/teams' && !u.searchParams.get('teamId')) return json(400, { error: { message: 'teamId obrigatório no teste' } });
    const pid = st.projeto?.id;
    let mm;
    if ((mm = /^\/v9\/projects\/([^/]+)$/.exec(p))) {
      const alvo = decodeURIComponent(mm[1]);
      if (!st.projeto || ![st.projeto.id, st.projeto.name].includes(alvo)) return json(404, { error: { code: 'not_found', message: 'Project not found' } });
      if (m === 'PATCH') Object.assign(st.projeto, body);
      return json(200, st.projeto);
    }
    if (p === '/v11/projects' && m === 'POST') { st.projeto = { id: 'prj_1', accountId: u.searchParams.get('teamId'), ...body }; return json(200, st.projeto); }
    if (p === `/v1/projects/${pid}/protection-bypass` && m === 'PATCH') { st.bypass[body.generate.secret] = { scope: 'automation-bypass' }; st.projeto.protectionBypass = { ...st.bypass }; return json(200, { protectionBypass: st.bypass }); }
    if (p === `/v9/projects/${pid}/custom-environments`) {
      if (m === 'GET') return json(200, { environments: st.custom });
      const ce = { id: 'env_stg', slug: body.slug, type: 'preview' }; st.custom.push(ce); return json(200, ce);
    }
    if (p === `/v10/projects/${pid}/env`) {
      if (m === 'GET') return json(200, { envs: st.envs.map(({ value, ...e }) => (e.type === 'sensitive' ? e : { ...e, value })) });
      for (const k of ['key', 'value', 'type']) if (!body[k]) return json(400, { error: { code: 'BAD_REQUEST', message: `falta ${k}` } });
      if (!Array.isArray(body.target)) return json(400, { error: { message: 'target precisa ser lista' } });
      const conflito = st.envs.find((e) => e.key === body.key && (body.target.some((t) => (e.target || []).includes(t)) || (body.customEnvironmentIds || []).some((c) => (e.customEnvironmentIds || []).includes(c))));
      if (conflito) return json(409, { error: { code: 'ENV_ALREADY_EXISTS', message: 'A variable with the name already exists for the target' } });
      const e = { id: `env_var_${st.seq++}`, key: body.key, value: body.value, type: body.type, target: body.target, customEnvironmentIds: body.customEnvironmentIds || [] }; st.envs.push(e); return json(200, { created: e });
    }
    if ((mm = new RegExp(`^/v10/projects/${pid}/env/([^/]+)$`).exec(p))) {
      const i = st.envs.findIndex((e) => e.id === mm[1]); if (i < 0) return json(404, {});
      if (m === 'DELETE') { st.envs.splice(i, 1); return json(200, {}); }
      Object.assign(st.envs[i], body); return json(200, st.envs[i]);
    }
    if ((mm = new RegExp(`^/v9/projects/${pid}/domains/([^/]+)$`).exec(p))) {
      const d = st.dominios.get(decodeURIComponent(mm[1])); if (!d) return json(404, { error: { code: 'not_found' } });
      if (m === 'PATCH') Object.assign(d, body); return json(200, d);
    }
    if (p === `/v10/projects/${pid}/domains` && m === 'POST') { const d = { name: body.name, customEnvironmentId: body.customEnvironmentId || null, verified: dominioPronto, verification: dominioPronto ? [] : [{ type: 'TXT', domain: '_vercel.exemplo.com.br', value: 'vc-domain-verify=exemplo', reason: 'pending_domain_verification' }] }; st.dominios.set(body.name, d); return json(200, d); }
    if ((mm = /^\/v6\/domains\/([^/]+)\/config$/.exec(p))) return json(200, { misconfigured: !dominioPronto, recommendedCNAME: [{ rank: 2, value: 'outro.vercel-dns-017.com.' }, { rank: 1, value: 'abc123.vercel-dns-017.com.' }] });
    json(404, { error: { message: 'rota falsa inexistente ' + p } });
  });
  return { st, iniciar: () => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`))), fechar: () => new Promise((r) => srv.close(r)) };
}
const envDe = (base, extra = {}) => ({ VERCEL_API_URL: base, VERCEL_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF, SUPABASE_URL: `${base}/supabase`, SUPABASE_POOLER_HOST: 'aws-1-sa-east-1.pooler.supabase.com',
  APP_API_DB_PASSWORD: API_PW, SUPABASE_ANON_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SEC, S3_ACCESS_KEY_ID: 'chave-s3-id-exemplo', S3_SECRET_ACCESS_KEY: 'chave-s3-segredo-exemplo',
  PRODUCTION_URL: 'https://canteiro.exemplo.com.br', STAGING_URL: 'https://staging.canteiro.exemplo.com.br', ...extra });
const SEGREDOS = [TOKEN, PUB, SEC, API_PW, 'chave-s3-segredo-exemplo'];
// a sonda https://<domínio>/api/health nunca sai da máquina: responde aqui
const fetchLocal = (sonda = 200) => async (url, init) => (String(url).startsWith('https://') ? new Response('{}', { status: sonda }) : fetch(url, init));

test('produção do zero: cria o projeto certo (raiz platform, Node 22, sem framework, gru1, Git desligado), grava as variáveis da API como Sensitive, NUNCA credenciais de ferramenta, e lista o DNS', async () => {
  const f = vercelFalsa(); const base = await f.iniciar(); const logs = [];
  try {
    const o = await configurarVercel({ env: envDe(base), ambiente: 'production', fetchImpl: fetchLocal(), log: (m) => logs.push(m) });
    assert.equal(o.ok, true, JSON.stringify(o.resultados.filter((r) => r.status === 'erro')));
    const pj = f.st.projeto; for (const [k, v] of Object.entries(AJUSTES_PROJETO)) assert.deepEqual(pj[k], v, k);
    assert.equal(pj.commandForIgnoringBuildStep, 'exit 0'); assert.deepEqual(pj.ssoProtection, { deploymentType: 'all_except_custom_domains' }); assert.equal(pj.gitRepository, undefined, 'não liga o Git: quem publica é o GitHub Actions');
    const env = Object.fromEntries(f.st.envs.map((e) => [e.key, e]));
    for (const k of ['APP_ENV', 'APP_ORIGIN', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CSRF_SECRET', 'STORAGE_DRIVER']) { assert.ok(env[k], k); assert.deepEqual(env[k].target, ['production'], k); }
    for (const k of ['DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'S3_SECRET_ACCESS_KEY', 'CSRF_SECRET']) assert.equal(env[k].type, 'sensitive', k);
    assert.equal(env.APP_ENV.value, 'production'); assert.equal(env.APP_ORIGIN.value, 'https://canteiro.exemplo.com.br'); assert.equal(env.S3_BUCKET.value, 'canteiro-arquivos');
    const db = new URL(env.DATABASE_URL.value); assert.equal(db.port, '6543'); assert.equal(decodeURIComponent(db.username), `app_api.${REF}`);
    assert.ok(env.CSRF_SECRET.value.length >= 48, 'CSRF_SECRET gerado na 1ª vez');
    assert.ok(!f.st.envs.some((e) => proibida(e.key)), 'nenhuma credencial de ferramenta foi para a Vercel');
    assert.ok(o.dns.some((d) => d.tipo === 'CNAME' && d.nome === 'canteiro.exemplo.com.br' && d.valor === 'abc123.vercel-dns-017.com'), 'CNAME recomendado (rank 1)');
    assert.ok(o.dns.some((d) => d.tipo === 'TXT' && d.nome === '_vercel.exemplo.com.br'), 'TXT de verificação do domínio');
    const tudo = [o.resumo, logs.join('\n'), JSON.stringify(o.resultados)].join('\n'); for (const s of [...SEGREDOS, env.CSRF_SECRET.value, env.DATABASE_URL.value]) assert.ok(!tudo.includes(s), 'nada secreto no resumo/log');
    assert.deepEqual(o.ids, { orgId: 'team_1', projectId: 'prj_1' });
    // 2ª execução: idempotente — não recria nada, atualiza valores no lugar e MANTÉM o CSRF_SECRET
    const csrf = env.CSRF_SECRET.value, qtd = f.st.envs.length; f.st.escritas.length = 0;
    const o2 = await configurarVercel({ env: envDe(base), ambiente: 'production', fetchImpl: fetchLocal() });
    assert.equal(o2.ok, true); assert.equal(f.st.envs.length, qtd); assert.equal(f.st.envs.find((e) => e.key === 'CSRF_SECRET').value, csrf, 'CSRF_SECRET mantido');
    assert.ok(!f.st.escritas.some((w) => /^POST \/v1[01]\/projects(\/prj_1\/(env|domains))?$/.test(w)), `não cria de novo: ${f.st.escritas}`);
    assert.ok(o2.variaveis.some((x) => x.key === 'CSRF_SECRET' && x.mantido));
    // --rotacionar-csrf: troca
    await configurarVercel({ env: envDe(base), ambiente: 'production', fetchImpl: fetchLocal(), rotacionarCsrf: true }); assert.notEqual(f.st.envs.find((e) => e.key === 'CSRF_SECRET').value, csrf);
  } finally { await f.fechar(); }
});

test('staging: cria o ambiente personalizado e grava só nele (customEnvironmentIds); domínio de staging no ambiente certo', async () => {
  const f = vercelFalsa({ projeto: { id: 'prj_1', name: 'canteiro', ...AJUSTES_PROJETO, ssoProtection: { deploymentType: 'all_except_custom_domains' } } }); const base = await f.iniciar();
  try {
    const o = await configurarVercel({ env: envDe(base), ambiente: 'staging', fetchImpl: fetchLocal() });
    assert.equal(o.ok, true, JSON.stringify(o.resultados)); assert.deepEqual(f.st.custom.map((c) => c.slug), ['staging']);
    for (const e of f.st.envs) { assert.deepEqual(e.target, []); assert.deepEqual(e.customEnvironmentIds, ['env_stg'], e.key); }
    assert.equal(f.st.envs.find((e) => e.key === 'APP_ENV').value, 'staging'); assert.equal(f.st.envs.find((e) => e.key === 'S3_BUCKET').value, 'canteiro-arquivos-staging');
    assert.equal(f.st.dominios.get('staging.canteiro.exemplo.com.br').customEnvironmentId, 'env_stg');
    assert.ok(!f.st.escritas.some((w) => w.startsWith('POST /v11/projects')), 'projeto existente não é recriado');
  } finally { await f.fechar(); }
});

test('remove credenciais de ferramenta postas à mão; separa variável compartilhada com outro ambiente; chave do Supabase errada → nada é gravado', async () => {
  const pj = { id: 'prj_1', name: 'canteiro', ...AJUSTES_PROJETO };
  const f = vercelFalsa({ projeto: pj, envs: [
    { key: 'DATABASE_ADMIN_URL', value: 'x', type: 'encrypted', target: ['production'] },
    { key: 'BACKUP_ENCRYPTION_KEY', value: 'y', type: 'sensitive', target: ['production', 'preview'] },
    { key: 'SUPABASE_URL', value: 'https://antigo.exemplo.invalid', type: 'encrypted', target: ['production', 'preview'] },
    { key: 'CSRF_SECRET', value: 'c'.repeat(48), type: 'sensitive', target: ['production'] },
  ] }); const base = await f.iniciar();
  try {
    const o = await configurarVercel({ env: envDe(base), ambiente: 'production', fetchImpl: fetchLocal() });
    assert.equal(o.ok, true, JSON.stringify(o.resultados)); assert.deepEqual(o.removidas.sort(), ['BACKUP_ENCRYPTION_KEY', 'DATABASE_ADMIN_URL']);
    assert.ok(!f.st.envs.some((e) => e.key === 'DATABASE_ADMIN_URL'));
    assert.deepEqual(f.st.envs.find((e) => e.key === 'BACKUP_ENCRYPTION_KEY').target, ['preview'], 'em outro ambiente só tira produção');
    const su = f.st.envs.filter((e) => e.key === 'SUPABASE_URL'); assert.equal(su.length, 2); assert.deepEqual(su.find((e) => e.target.includes('preview')).target, ['preview']); assert.equal(su.find((e) => e.target.includes('production')).value, `${base}/supabase`);
    assert.equal(f.st.envs.find((e) => e.key === 'CSRF_SECRET').value, 'c'.repeat(48), 'CSRF já existente é mantido');
  } finally { await f.fechar(); }
  const g = vercelFalsa({ projeto: pj, chavesOk: false }); const b2 = await g.iniciar();
  try {
    await assert.rejects(() => configurarVercel({ env: envDe(b2), ambiente: 'production', fetchImpl: fetchLocal() }), /recusou SUPABASE_ANON_KEY.*Nada foi gravado/s);
    assert.ok(!g.st.escritas.some((w) => /\/env/.test(w)), 'nenhuma variável gravada com chave errada');
  } finally { await g.fechar(); }
});

test('times e IDs: um time só é automático; vários exigem VERCEL_TEAM; projeto ausente pede o "Configurar Vercel"; CLI ids grava no GITHUB_ENV', async () => {
  const f = vercelFalsa({ projeto: { id: 'prj_1', name: 'canteiro' }, times: [{ id: 'team_1', slug: 'canteiro-am', name: 'Canteiro A&M' }, { id: 'team_2', slug: 'pessoal', name: 'Pessoal' }] }); const base = await f.iniciar(); const d = tmp('vids');
  try {
    const api = clienteVercel({ token: TOKEN, base });
    await assert.rejects(() => resolverTime(api), /VERCEL_TEAM/);
    assert.equal((await resolverTime(api, { team: 'canteiro-am' })).id, 'team_1'); assert.equal((await resolverTime(api, { team: 'Canteiro A&M' })).id, 'team_1');
    await assert.rejects(() => resolverTime(api, { team: 'outro' }), /não enxerga o time "outro"/);
    assert.deepEqual(await descobrirIds({ env: { VERCEL_TEAM: 'canteiro-am' }, api }).then((x) => [x.orgId, x.projectId]), ['team_1', 'prj_1']);
    await assert.rejects(() => descobrirIds({ env: { VERCEL_TEAM: 'canteiro-am', VERCEL_PROJECT: 'nao-existe' }, api }), /Configurar Vercel/);
    f.st.times = []; await assert.rejects(() => resolverTime(api), /não enxerga nenhum time/);
    f.st.times = [{ id: 'team_1', slug: 'canteiro-am', name: 'Canteiro A&M' }];
    const { spawn, spawnSync } = await import('node:child_process'); const ge = path.join(d, 'genv');
    // spawn assíncrono: o servidor falso roda neste mesmo processo (spawnSync o deixaria sem responder)
    const r = await new Promise((resolve) => { const p = spawn(process.execPath, ['tools/vercel-setup.js', 'ids', '--github-env', ge], { cwd: new URL('../..', import.meta.url).pathname, env: { PATH: process.env.PATH, VERCEL_TOKEN: TOKEN, VERCEL_API_URL: base } }); let stderr = ''; p.stderr.on('data', (x) => { stderr += x; }); p.on('exit', (status) => resolve({ status, stderr })); });
    assert.equal(r.status, 0, r.stderr); assert.equal(fs.readFileSync(ge, 'utf8'), 'VERCEL_ORG_ID=team_1\nVERCEL_PROJECT_ID=prj_1\n'); assert.ok(!r.stderr.includes(TOKEN));
    const semToken = spawnSync(process.execPath, ['tools/vercel-setup.js', 'ids'], { cwd: new URL('../..', import.meta.url).pathname, env: { PATH: process.env.PATH }, encoding: 'utf8' }); assert.equal(semToken.status, 2); assert.match(semToken.stderr, /VERCEL_TOKEN/);
  } finally { await f.fechar(); rmrf(d); }
});

test('bypass da proteção da Vercel: o segredo do GitHub é cadastrado (uma vez); simular não grava nada; domínio pronto atrás da proteção vira AVISO', async () => {
  const f = vercelFalsa({ dominioPronto: true }); const base = await f.iniciar(); const BYP = 'b'.repeat(32);
  try {
    const sim = await configurarVercel({ env: envDe(base, { VERCEL_AUTOMATION_BYPASS_SECRET: BYP }), ambiente: 'production', simular: true, fetchImpl: fetchLocal() });
    assert.deepEqual(f.st.escritas, [], 'simulação não grava'); assert.ok(sim.resultados.some((r) => r.status === 'mudaria'));
    const o = await configurarVercel({ env: envDe(base, { VERCEL_AUTOMATION_BYPASS_SECRET: BYP }), ambiente: 'production', fetchImpl: fetchLocal(401) });
    assert.ok(f.st.bypass[BYP], 'segredo cadastrado na Vercel'); assert.ok(o.resultados.some((r) => /Protection Bypass/.test(r.item) && r.status === 'alterado'));
    assert.ok(o.resultados.some((r) => /Acesso a canteiro\.exemplo\.com\.br/.test(r.item) && r.status === 'aviso' && /VERCEL_AUTOMATION_BYPASS_SECRET/.test(r.detalhe)));
    assert.ok(!o.resumo.includes(BYP), 'o segredo do bypass nunca aparece');
    const o2 = await configurarVercel({ env: envDe(base, { VERCEL_AUTOMATION_BYPASS_SECRET: BYP }), ambiente: 'production', fetchImpl: fetchLocal(200) });
    assert.ok(o2.resultados.some((r) => /Protection Bypass/.test(r.item) && r.status === 'ok'));
  } finally { await f.fechar(); }
});
