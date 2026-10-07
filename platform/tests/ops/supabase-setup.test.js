import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { configurarSupabase, authDesejada, lerInfra, diferencas, remetentePadrao, urlsDeRetorno, LIMITE_ARQUIVO, INFRA_SUPABASE } from '../../tools/supabase-setup.js';
import { parseToml, duracaoSegundos } from '../../tools/lib/toml-min.js';
import { tmp, rmrf } from './_helpers.js';

// Servidores FALSOS que imitam a Management API, o Auth, o Storage e o Resend (o script NÃO foi executado contra o Supabase real).
const REF = 'abcdefghijklmnopqrst';
const TOKEN = ['sbp', 'f'.repeat(40)].join('_'), PUB = ['sb', 'publishable', 'p'.repeat(30)].join('_'), SEC = ['sb', 'secret', 's'.repeat(30)].join('_'), RESEND = ['re', 'r'.repeat(30)].join('_');

function supabaseFalso({ ignorar = [], rejeitarPro = false, jwks = [{ kty: 'EC', alg: 'ES256', kid: 'k1' }], s3off = true, publico = false, dominio = null, chaveAnonAceita = true } = {}) {
  const st = {
    auth: { site_url: 'http://localhost:3000', uri_allow_list: '', disable_signup: false, external_email_enabled: true, external_phone_enabled: false, password_min_length: 6, mailer_otp_exp: 3600, jwt_exp: 3600, refresh_token_rotation_enabled: true, security_refresh_token_reuse_interval: 10 },
    storage: { fileSizeLimit: 50 * 1024 * 1024, features: { imageTransformation: { enabled: true }, s3Protocol: { enabled: !s3off } } },
    postgrest: { db_schema: 'public,graphql_public,app', db_extra_search_path: 'public,extensions', max_rows: 1000 },
    ssl: false, buckets: new Map(publico ? [['canteiro-arquivos', { id: 'canteiro-arquivos', name: 'canteiro-arquivos', public: true, file_size_limit: null }]] : []),
    dominios: dominio ? [dominio] : [], mutacoes: [], corpos: [],
  };
  const srv = http.createServer(async (req, res) => {
    let corpo = ''; for await (const c of req) corpo += c; const body = corpo ? JSON.parse(corpo) : undefined;
    const u = new URL(req.url, 'http://x'); const p = u.pathname; const m = req.method; const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (m !== 'GET') { st.mutacoes.push(`${m} ${p}`); st.corpos.push(body); }
    if (p.startsWith('/mgmt/')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Unauthorized' });
      const q = p.slice('/mgmt'.length);
      if (q === `/v1/projects/${REF}`) return json(200, { id: REF, ref: REF, name: 'canteiro-prod', region: 'sa-east-1', status: 'ACTIVE_HEALTHY' });
      if (q === `/v1/projects/${REF}/config/auth`) {
        if (m === 'GET') return json(200, st.auth);
        if (rejeitarPro && ('password_hibp_enabled' in body || 'sessions_timebox' in body)) return json(400, { message: 'This feature requires the Pro plan' });
        for (const [k, v] of Object.entries(body)) if (!ignorar.includes(k)) st.auth[k] = v;
        return json(200, st.auth);
      }
      if (q === `/v1/projects/${REF}/config/storage`) { if (m === 'PATCH') Object.assign(st.storage, body); return json(200, st.storage); }
      if (q === `/v1/projects/${REF}/postgrest`) { if (m === 'PATCH') Object.assign(st.postgrest, body); return json(200, st.postgrest); }
      if (q === `/v1/projects/${REF}/ssl-enforcement`) { if (m === 'PUT') st.ssl = body.requestedConfig.database === true; return json(200, { currentConfig: { database: st.ssl }, appliedSuccessfully: true }); }
      if (q === `/v1/projects/${REF}/config/database/pooler`) return json(200, [{ database_type: 'PRIMARY', db_host: 'aws-1-sa-east-1.pooler.supabase.com', db_port: 5432, pool_mode: 'session', connection_string: `postgresql://postgres.${REF}:[YOUR-PASSWORD]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres` }]);
      return json(404, { message: 'rota falsa inexistente ' + q });
    }
    if (p.startsWith('/proj/')) {
      const q = p.slice('/proj'.length); const key = req.headers.apikey;
      if (q === '/auth/v1/.well-known/jwks.json') return json(200, { keys: jwks });
      if (req.headers.authorization && String(key).startsWith('sb_')) return json(401, { message: 'chave nova não pode ir como Bearer' });
      if (q === '/auth/v1/settings') return key === PUB && chaveAnonAceita ? json(200, { disable_signup: st.auth.disable_signup, external: { email: st.auth.external_email_enabled, phone: false } }) : json(401, { message: 'Invalid API key' });
      if (q === '/auth/v1/admin/users') return key === SEC ? json(200, { users: [] }) : json(401, { message: 'Invalid API key' });
      if (key !== SEC) return json(401, { message: 'Invalid API key' });
      const mb = /^\/storage\/v1\/bucket(?:\/([^/]+))?$/.exec(q);
      if (mb && m === 'GET') { const b = st.buckets.get(decodeURIComponent(mb[1] || '')); return b ? json(200, b) : json(400, { statusCode: '404', error: 'Bucket not found' }); }
      if (mb && m === 'POST') { st.buckets.set(body.id, { id: body.id, name: body.name, public: body.public, file_size_limit: body.file_size_limit }); return json(200, { name: body.name }); }
      if (mb && m === 'PUT') { Object.assign(st.buckets.get(decodeURIComponent(mb[1])), body); return json(200, { message: 'ok' }); }
      return json(404, {});
    }
    if (p.startsWith('/resend/')) {
      if (req.headers.authorization !== `Bearer ${RESEND}`) return json(401, { message: 'API key is invalid' });
      const q = p.slice('/resend'.length); const recs = (n) => [{ record: 'SPF', type: 'MX', name: `send.${n}`, value: 'feedback-smtp.sa-east-1.amazonses.com', priority: 10, status: 'not_started' }, { record: 'SPF', type: 'TXT', name: `send.${n}`, value: 'v=spf1 include:amazonses.com ~all', status: 'not_started' }, { record: 'DKIM', type: 'TXT', name: `resend._domainkey.${n}`, value: 'p=MIGfMA0exemplo', status: 'not_started' }];
      if (q === '/domains' && m === 'GET') return json(200, { data: st.dominios.map(({ id, name, status }) => ({ id, name, status })) });
      if (q === '/domains' && m === 'POST') { const d = { id: 'dom_1', name: body.name, status: 'not_started', region: body.region, records: recs(body.name) }; st.dominios.push(d); return json(200, d); }
      const md = /^\/domains\/(.+)$/.exec(q); if (md) { const d = st.dominios.find((x) => x.id === md[1]); return d ? json(200, { ...d, records: d.records || recs(d.name) }) : json(404, {}); }
      return json(404, {});
    }
    json(404, {});
  });
  return { st, srv, iniciar: () => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`))), fechar: () => new Promise((r) => srv.close(r)) };
}
// tudo aponta para o servidor falso local: nenhuma chamada sai da máquina
const envDe = (base, extra = {}) => ({ SUPABASE_API_URL: `${base}/mgmt`, SUPABASE_URL: `${base}/proj`, RESEND_API_URL: `${base}/resend`, S3_ENDPOINT: `${base}/s3-falso`, SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF, SUPABASE_ANON_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SEC,
  S3_ACCESS_KEY_ID: 'chave-s3-id-exemplo', S3_SECRET_ACCESS_KEY: 'chave-s3-segredo-exemplo', RESEND_API_KEY: RESEND, PRODUCTION_URL: 'https://canteiro.exemplo.com.br', STAGING_URL: 'https://staging.canteiro.exemplo.com.br', ...extra });
const s3ok = async () => {};
const segredos = [TOKEN, PUB, SEC, RESEND, 'chave-s3-segredo-exemplo'];
const semSegredo = (texto) => segredos.every((s) => !String(texto).includes(s));

test('config.toml → configuração de Auth: cadastro aberto DESLIGADO e login por e-mail LIGADO, senha ≥ 12 com maiúscula/minúscula/dígito, SMTP do Resend, modelos em pt-BR', () => {
  const infra = lerInfra(); const g = authDesejada(infra, { siteUrl: 'https://canteiro.exemplo.com.br/', remetente: 'nao-responda@canteiro.exemplo.com.br', nomeRemetente: 'Canteiro A&M', resendKey: RESEND });
  const tudo = Object.assign({}, ...g.map((x) => x.campos));
  assert.equal(tudo.disable_signup, true); assert.equal(tudo.external_email_enabled, true, 'o provedor de e-mail fica ligado (senão ninguém entra)'); assert.equal(tudo.external_anonymous_users_enabled, false); assert.equal(tudo.mailer_autoconfirm, false);
  assert.equal(tudo.password_min_length, 12); assert.equal(tudo.password_required_characters, 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789');
  assert.equal(tudo.site_url, 'https://canteiro.exemplo.com.br');
  assert.equal(tudo.uri_allow_list, 'https://canteiro.exemplo.com.br/auth/confirmar,https://canteiro.exemplo.com.br/api/auth/sso/callback', 'convite/recuperação E o retorno do login corporativo (SSO)');
  assert.deepEqual(urlsDeRetorno({ auth: { additional_redirect_urls: ['https://canteiro.<seu-dominio>/auth/confirmar'] } }, 'https://a.exemplo.com.br'), ['https://a.exemplo.com.br/auth/confirmar', 'https://a.exemplo.com.br/api/auth/sso/callback'], 'o retorno do SSO entra mesmo se sumir do config.toml');
  assert.throws(() => urlsDeRetorno({ auth: { additional_redirect_urls: ['canteiro/auth'] } }, 'https://a'), /endereço inválido/);
  assert.equal(tudo.mailer_otp_exp, 86400); assert.equal(tudo.jwt_exp, 3600); assert.equal(tudo.refresh_token_rotation_enabled, true); assert.equal(tudo.security_refresh_token_reuse_interval, 10);
  assert.deepEqual([tudo.smtp_host, tudo.smtp_port, tudo.smtp_user, tudo.smtp_pass], ['smtp.resend.com', '465', 'resend', RESEND]); assert.equal(tudo.smtp_max_frequency, 60);
  assert.equal(tudo.sessions_timebox, 30 * 86400); assert.equal(tudo.sessions_inactivity_timeout, 7 * 86400); assert.equal(tudo.password_hibp_enabled, true);
  assert.equal(tudo.mailer_subjects_invite, 'Você foi convidado para o Canteiro A&M'); assert.equal(tudo.mailer_templates_invite_content, fs.readFileSync(path.join(INFRA_SUPABASE, 'templates', 'invite.html'), 'utf8'));
  assert.match(tudo.mailer_templates_recovery_content, /type=recovery/); assert.equal(g.filter((x) => x.obrigatorio).length, 3);
  assert.equal(remetentePadrao({ PRODUCTION_URL: 'https://canteiro.exemplo.com.br' }), 'nao-responda@canteiro.exemplo.com.br'); assert.equal(remetentePadrao({ EMAIL_REMETENTE: 'convites@exemplo.com.br' }), 'convites@exemplo.com.br');
  assert.deepEqual(diferencas({ uri_allow_list: 'https://a/b', site_url: 'https://a' }, { uri_allow_list: ' https://a/b/ ', site_url: 'https://a/' }), [], 'compara sem espaços e barra final');
  // config.toml que relaxasse o essencial é recusado antes de qualquer chamada
  assert.throws(() => authDesejada({ ...infra, toml: { ...infra.toml, auth: { ...infra.toml.auth, minimum_password_length: 8 } } }, { siteUrl: 'https://x.exemplo.com.br' }), /≥ 12/);
  assert.throws(() => authDesejada({ ...infra, toml: { ...infra.toml, auth: { ...infra.toml.auth, enable_signup: true } } }, { siteUrl: 'https://x.exemplo.com.br' }), /sem cadastro aberto/);
});

test('leitor de TOML: o subconjunto do config.toml e erros com número da linha', () => {
  const t = parseToml('# c\n[a]\nx = "um # não é comentário" # comentário\ny = 3\nz = true\nl = ["p", "q"]\n[a.b]\nw = \'literal\'\n');
  assert.deepEqual(t, { a: { x: 'um # não é comentário', y: 3, z: true, l: ['p', 'q'], b: { w: 'literal' } } });
  assert.throws(() => parseToml('[a]\nx = [\n"b"\n]'), /linha 2/); assert.throws(() => parseToml('x = 1\nx = 2'), /repetida/); assert.throws(() => parseToml('isso não é toml'), /linha 1/);
  assert.equal(duracaoSegundos('1m0s'), 60); assert.equal(duracaoSegundos('720h'), 2592000); assert.throws(() => duracaoSegundos('logo'), /inválida/);
  const real = parseToml(fs.readFileSync(path.join(INFRA_SUPABASE, 'config.toml'), 'utf8')); assert.equal(real.auth.enable_signup, false); assert.equal(real.auth.email.enable_signup, true); assert.equal(real.auth.email.smtp.host, 'smtp.resend.com'); assert.equal(real.auth.email.smtp.port, 465);
});

test('configurar (produção): aplica tudo, relê e confere; bucket PRIVADO criado; DNS do e-mail listado; nada secreto no resumo', async () => {
  const f = supabaseFalso(); const base = await f.iniciar(); const logs = [];
  try {
    const o = await configurarSupabase({ env: envDe(base), ambiente: 'production', s3Check: s3ok, conferirSenha: false, log: (m) => logs.push(m) });
    const st = Object.fromEntries(o.resultados.map((r) => [r.item, r.status]));
    assert.equal(o.ok, true, JSON.stringify(o.resultados.filter((r) => r.status === 'erro')));
    assert.equal(f.st.auth.disable_signup, true); assert.equal(f.st.auth.password_min_length, 12); assert.equal(f.st.auth.site_url, 'https://canteiro.exemplo.com.br'); assert.equal(f.st.auth.uri_allow_list, 'https://canteiro.exemplo.com.br/auth/confirmar,https://canteiro.exemplo.com.br/api/auth/sso/callback');
    assert.equal(f.st.auth.smtp_host, 'smtp.resend.com'); assert.equal(f.st.auth.smtp_admin_email, 'nao-responda@canteiro.exemplo.com.br'); assert.equal(f.st.auth.smtp_sender_name, 'Canteiro A&M');
    assert.ok(Object.keys(st).filter((k) => k.startsWith('Conferência:')).every((k) => st[k] === 'ok'), 'tudo relido e igual');
    const b = f.st.buckets.get('canteiro-arquivos'); assert.equal(b.public, false); assert.equal(b.file_size_limit, LIMITE_ARQUIVO); assert.equal(st['Bucket privado "canteiro-arquivos"'], 'alterado');
    assert.equal(f.st.storage.fileSizeLimit, LIMITE_ARQUIVO); assert.equal(f.st.storage.features.s3Protocol.enabled, true);
    assert.equal(f.st.postgrest.db_schema, 'public,graphql_public', 'o schema app sai da Data API'); assert.equal(f.st.ssl, true);
    assert.equal(o.pooler, 'aws-1-sa-east-1.pooler.supabase.com');
    assert.ok(o.dns.some((d) => d.nome === 'resend._domainkey.canteiro.exemplo.com.br') && o.dns.some((d) => d.nome === '_dmarc.canteiro.exemplo.com.br'), 'registros de DNS do e-mail para a TI');
    assert.equal(f.st.dominios[0].region, 'sa-east-1');
    assert.ok(semSegredo(o.resumo) && semSegredo(logs.join('\n')) && semSegredo(JSON.stringify(o.resultados)), 'nenhum segredo no resumo nem no log');
    assert.match(o.resumo, /Apague agora o token temporário/);
    // segunda execução: idempotente (só reenvia a senha do SMTP, que não dá para comparar)
    f.st.mutacoes.length = 0;
    const o2 = await configurarSupabase({ env: envDe(base), ambiente: 'production', s3Check: s3ok, conferirSenha: false });
    assert.equal(o2.ok, true); assert.deepEqual(f.st.mutacoes, [`PATCH /mgmt/v1/projects/${REF}/config/auth`], 'na 2ª vez só o SMTP é reenviado');
    assert.ok(o2.resultados.filter((r) => /^Auth|^E-mail: modelos|^Limites|^Pro/.test(r.item)).every((r) => r.status === 'ok'));
  } finally { await f.fechar(); }
});

test('simular: só lê (nenhuma escrita) e diz o que mudaria; staging usa o endereço de staging e o bucket de staging', async () => {
  const f = supabaseFalso(); const base = await f.iniciar();
  try {
    const o = await configurarSupabase({ env: envDe(base), ambiente: 'staging', simular: true, s3Check: s3ok, conferirSenha: false });
    assert.deepEqual(f.st.mutacoes, [], 'simulação não altera nada'); assert.ok(o.resultados.some((r) => r.status === 'mudaria' && /site_url/.test(r.detalhe) && /staging\.canteiro/.test(r.detalhe)));
    assert.ok(o.resultados.some((r) => r.status === 'mudaria' && /uri_allow_list/.test(r.detalhe) && r.detalhe.includes('https://staging.canteiro.exemplo.com.br/api/auth/sso/callback')), 'Redirect URLs de staging com o retorno do SSO');
    assert.ok(o.resultados.some((r) => /canteiro-arquivos-staging/.test(r.item) && r.status === 'mudaria')); assert.match(o.resumo, /SIMULAÇÃO/);
  } finally { await f.fechar(); }
});

test('defensivo: token errado para tudo cedo; JWKS sem chave assimétrica, chave colada de outro projeto e configuração que não "pega" viram ERRO; recurso Pro recusado vira AVISO', async () => {
  let f = supabaseFalso(); let base = await f.iniciar();
  try { const o = await configurarSupabase({ env: envDe(base, { SUPABASE_ACCESS_TOKEN: ['sbp', '0'.repeat(40)].join('_') }), ambiente: 'production', s3Check: s3ok, conferirSenha: false }); assert.equal(o.ok, false); assert.equal(o.resultados.length, 1); assert.match(o.resultados[0].detalhe, /HTTP 401/); assert.deepEqual(f.st.mutacoes, []); }
  finally { await f.fechar(); }
  f = supabaseFalso({ jwks: [], ignorar: ['password_min_length'], rejeitarPro: true, chaveAnonAceita: false, publico: true }); base = await f.iniciar();
  try {
    const o = await configurarSupabase({ env: envDe(base), ambiente: 'production', s3Check: s3ok, conferirSenha: false }); const by = (re) => o.resultados.filter((r) => re.test(r.item));
    assert.equal(o.ok, false);
    assert.equal(by(/JWKS/)[0].status, 'erro'); assert.match(by(/JWKS/)[0].detalhe, /JWT Keys/);
    assert.equal(by(/Publishable key/)[0].status, 'erro'); assert.match(by(/Publishable key/)[0].detalhe, /não é a publishable key do projeto/);
    assert.equal(by(/^Conferência: Auth/)[0].status, 'erro'); assert.match(by(/^Conferência: Auth/)[0].detalhe, /password_min_length=6 \(esperado 12\)/);
    assert.equal(by(/^Pro:/)[0].status, 'aviso', 'recurso do plano Pro recusado não derruba a configuração');
    assert.equal(f.st.buckets.get('canteiro-arquivos').public, false, 'bucket público é corrigido para privado'); assert.equal(by(/Bucket privado/)[0].status, 'alterado');
  } finally { await f.fechar(); }
  // faltando chaves: erro de uso com a lista, antes de qualquer chamada
  await assert.rejects(() => configurarSupabase({ env: { SUPABASE_PROJECT_REF: REF }, ambiente: 'production' }), (e) => /SUPABASE_ACCESS_TOKEN/.test(e.message) && /RESEND_API_KEY/.test(e.message) && e.exit === 2);
});

test('CLI: --resumo e --json sem segredos; código 1 quando há ERRO', async () => {
  const { spawn } = await import('node:child_process'); const f = supabaseFalso({ jwks: [] }); const base = await f.iniciar(); const d = tmp('supa');
  try {
    const resumo = path.join(d, 'r.md'), json = path.join(d, 'r.json');
    const r = await new Promise((resolve) => { const p = spawn(process.execPath, ['tools/supabase-setup.js', '--ambiente', 'production', '--resumo', resumo, '--json', json], { cwd: new URL('../..', import.meta.url).pathname, env: { PATH: process.env.PATH, ...envDe(base) } }); let e = ''; p.stderr.on('data', (x) => { e += x; }); p.on('exit', (code) => resolve({ code, e })); });
    assert.equal(r.code, 1); const md = fs.readFileSync(resumo, 'utf8'); assert.match(md, /\*\*ERRO\*\*/); assert.ok(semSegredo(md) && semSegredo(fs.readFileSync(json, 'utf8')) && semSegredo(r.e));
    assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).ok, false);
  } finally { await f.fechar(); rmrf(d); }
});
