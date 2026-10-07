#!/usr/bin/env node
/* tools/supabase-setup.js — CONFIGURA um projeto Supabase (staging ou produção) do jeito que o Canteiro exige e CONFERE relendo tudo.
   Usado pelo workflow "Configurar Supabase" (.github/workflows/configurar-supabase.yml). NÃO EXECUTADO contra um Supabase real ao ser escrito:
   foi testado contra servidores falsos que imitam a Management API, o Auth e o Storage (tests/ops/supabase-setup.test.js). Por isso é defensivo:
   cada resposta é validada, cada mudança é relida, e qualquer divergência aparece no resumo com o que fazer.

   Uso:  node tools/supabase-setup.js --ambiente staging|production [--simular] [--resumo ARQ] [--json ARQ]
   Variáveis (as chaves mínimas de docs/CHAVES.md): SUPABASE_ACCESS_TOKEN (TEMPORÁRIO), SUPABASE_PROJECT_REF, RESEND_API_KEY, SUPABASE_ANON_KEY,
     SUPABASE_SERVICE_ROLE_KEY, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, PRODUCTION_URL (e STAGING_URL em staging); opcionais: EMAIL_REMETENTE,
     SUPABASE_DB_PASSWORD (confere a senha do banco), SUPABASE_REGION.
   O que faz (cada item vira uma linha do resumo: ok / alterado / aviso / ERRO):
     1. projeto existe, está ativo e na região esperada
     2. Auth (infra/supabase/config.toml + auth-settings.md) pela Management API — PATCH /v1/projects/{ref}/config/auth em grupos — e RELEITURA:
        cadastro aberto desligado, e-mail com confirmação, senha ≥ 12 com maiúscula/minúscula/dígito, Site URL e Redirect URLs do ambiente
        (/auth/confirmar e o retorno do login corporativo /api/auth/sso/callback),
        SMTP do Resend (smtp.resend.com:465, usuário "resend"), modelos de e-mail em pt-BR, link válido por 24 h, rotação do refresh token,
        limites de taxa, proteção contra senha vazada e duração das sessões (Pro)
     3. chaves JWT assimétricas publicadas (JWKS) — a API valida o login por elas
     4. a publishable e a secret key coladas são deste projeto; cadastro aberto desligado visto de fora (/auth/v1/settings)
     5. Storage: limite de tamanho ≥ 100 MB e protocolo S3 ligados; bucket PRIVADO criado/conferido; a chave S3 lê o bucket
     6. Data API não expõe o schema app; SSL obrigatório nas conexões ao banco
     7. servidor do banco (pooler) e senha do banco
     8. e-mail: domínio no Resend e os registros de DNS que a TI precisa criar
   Idempotente: rodar de novo só altera o que estiver diferente. --simular só lê e mostra o que mudaria. Nunca imprime segredos. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError, buildRedactor, parseArgs, runCli, isMain } from './lib/common.js';
import { montar, relatorioProblemas, AMBIENTES } from './lib/chaves.js';
import { parseToml, duracaoSegundos } from './lib/toml-min.js';
import { clienteHttp, cabecalhosSupabase } from './lib/http-api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INFRA_SUPABASE = path.join(HERE, '..', 'infra', 'supabase');
const MiB = 1024 * 1024;
export const LIMITE_ARQUIVO = 100 * MiB;           // o maior arquivo que a API aceita (anexo de 100 MB; src/lib/asset-validate.js)
export const SMTP_RESEND = Object.freeze({ host: 'smtp.resend.com', port: '465', user: 'resend' });
const SENHA_REQ = {
  '': '',
  letters_digits: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  lower_upper_letters_digits: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
};
const MODELOS = [['invite', 'invite.html'], ['recovery', 'recovery.html'], ['confirmation', 'confirm.html']];

/** Lê config.toml e os modelos de e-mail; devolve {toml, modelos:{invite:{subject,content},…}}. */
export function lerInfra(raiz = INFRA_SUPABASE) {
  const toml = parseToml(fs.readFileSync(path.join(raiz, 'config.toml'), 'utf8'));
  const modelos = {};
  for (const [tipo] of MODELOS) {
    const t = toml.auth?.email?.template?.[tipo]; if (!t?.subject || !t?.content_path) throw new ToolError(`config.toml sem [auth.email.template.${tipo}] (subject e content_path)`, { code: 'bad_config' });
    modelos[tipo] = { subject: t.subject, content: fs.readFileSync(path.resolve(raiz, t.content_path), 'utf8') };
  }
  return { toml, modelos };
}

/**
 * Configuração de Auth desejada, em grupos (cada grupo é um PATCH; um grupo opcional que falhar vira aviso, não erro).
 * Importante: no config.toml, [auth] enable_signup=false é o que BLOQUEIA o cadastro aberto (disable_signup); o provedor de e-mail
 * (external_email_enabled) fica LIGADO, senão ninguém entra com e-mail e senha — convites continuam funcionando porque usam a chave secreta.
 */
/** Caminhos que o Supabase PRECISA aceitar como retorno (Redirect URLs), em qualquer ambiente. */
export const RETORNOS_OBRIGATORIOS = Object.freeze(['/auth/confirmar', '/api/auth/sso/callback']);
/** Redirect URLs do ambiente: os caminhos de additional_redirect_urls do config.toml (+ os obrigatórios) com a origem do ambiente. */
export function urlsDeRetorno(toml, origem) {
  const lista = toml?.auth?.additional_redirect_urls; const caminhos = [];
  for (const u of Array.isArray(lista) ? lista : []) {
    const m = /^https?:\/\/[^/]+(\/[^?#]*)?$/.exec(String(u).trim());
    if (!m) throw new ToolError(`config.toml: additional_redirect_urls tem um endereço inválido: ${u}`, { code: 'bad_config' });
    caminhos.push((m[1] || '/').replace(/(.)\/+$/, '$1'));
  }
  for (const c of RETORNOS_OBRIGATORIOS) if (!caminhos.includes(c)) caminhos.push(c);
  return [...new Set(caminhos)].map((c) => origem + (c === '/' ? '' : c));
}

export function authDesejada({ toml, modelos }, { siteUrl, remetente, nomeRemetente, resendKey }) {
  const a = toml.auth || {}, e = a.email || {}, rl = a.rate_limit || {}, ses = a.sessions || {};
  if (!(a.minimum_password_length >= 12)) throw new ToolError('config.toml: minimum_password_length precisa ser ≥ 12', { code: 'bad_config' });
  if (a.enable_signup !== false) throw new ToolError('config.toml: [auth] enable_signup precisa ser false (sem cadastro aberto)', { code: 'bad_config' });
  if (!(a.password_requirements in SENHA_REQ)) throw new ToolError(`config.toml: password_requirements desconhecido: ${a.password_requirements}`, { code: 'bad_config' });
  const origem = new URL(siteUrl).origin;
  const grupos = [
    { nome: 'Auth: cadastro, senha, sessão e URLs', obrigatorio: true, campos: {
      site_url: origem, uri_allow_list: urlsDeRetorno(toml, origem).join(','),
      disable_signup: true, external_email_enabled: true, external_phone_enabled: false, external_anonymous_users_enabled: a.enable_anonymous_sign_ins === true,
      mailer_autoconfirm: e.enable_confirmations === false, mailer_secure_email_change_enabled: e.double_confirm_changes !== false,
      security_update_password_require_reauthentication: e.secure_password_change === true,
      mailer_otp_exp: Math.min(Number(e.otp_expiry) || 3600, 86400), mailer_otp_length: Number(e.otp_length) || 6,
      password_min_length: a.minimum_password_length, password_required_characters: SENHA_REQ[a.password_requirements],
      jwt_exp: Number(a.jwt_expiry) || 3600, refresh_token_rotation_enabled: a.enable_refresh_token_rotation !== false,
      security_refresh_token_reuse_interval: Number(a.refresh_token_reuse_interval) || 10,
    } },
    { nome: 'E-mail: SMTP do Resend', obrigatorio: true, secretos: ['smtp_pass'], campos: {
      smtp_host: SMTP_RESEND.host, smtp_port: SMTP_RESEND.port, smtp_user: SMTP_RESEND.user, smtp_pass: resendKey,
      smtp_admin_email: remetente, smtp_sender_name: nomeRemetente, smtp_max_frequency: duracaoSegundos(e.max_frequency || '1m0s'),
      rate_limit_email_sent: Number(rl.email_sent) || 30,
    } },
    { nome: 'E-mail: modelos em pt-BR (convite, recuperação, confirmação)', obrigatorio: true, campos: Object.fromEntries(MODELOS.flatMap(([t]) => [[`mailer_subjects_${t}`, modelos[t].subject], [`mailer_templates_${t}_content`, modelos[t].content]])) },
    { nome: 'Limites de taxa do login (a API concentra os logins em poucos IPs)', obrigatorio: false, campos: { rate_limit_otp: Number(rl.sign_in_sign_ups) || 300, rate_limit_verify: Number(rl.token_verifications) || 300 } },
    { nome: 'Pro: senha vazada (HaveIBeenPwned) e duração das sessões', obrigatorio: false, campos: {
      password_hibp_enabled: true,
      ...(ses.timebox ? { sessions_timebox: duracaoSegundos(ses.timebox) } : {}), ...(ses.inactivity_timeout ? { sessions_inactivity_timeout: duracaoSegundos(ses.inactivity_timeout) } : {}),
    } },
  ];
  return grupos;
}

const norm = (k, v) => {
  if (v === null || v === undefined) return '';
  if (k === 'uri_allow_list') return String(v).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean).sort().join(',');
  if (k === 'site_url') return String(v).trim().replace(/\/+$/, '');
  if (/_content$/.test(k)) return String(v).replace(/\r\n/g, '\n').trim();
  return String(v);
};
/** Campos (não secretos) cujo valor atual difere do desejado. */
export function diferencas(campos, atual, secretos = []) {
  return Object.keys(campos).filter((k) => !secretos.includes(k) && norm(k, campos[k]) !== norm(k, atual?.[k]));
}
const SEGREDO_CAMPO = /^smtp_pass$|_secret$|_key$|^external_.*_secret$/;   // nunca mostrar (password_min_length etc. não são segredos)
const mostrar = (k, v) => (/_content$/.test(k) ? `(modelo, ${String(v ?? '').length} caracteres)` : SEGREDO_CAMPO.test(k) ? '(segredo)' : JSON.stringify(v));

/** Remetente: EMAIL_REMETENTE ou nao-responda@<host de PRODUCTION_URL> (o domínio verificado no Resend é o mesmo nos dois ambientes). */
export function remetentePadrao(env) {
  if (env.EMAIL_REMETENTE && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.EMAIL_REMETENTE.trim())) return env.EMAIL_REMETENTE.trim();
  try { return `nao-responda@${new URL(env.PRODUCTION_URL).hostname}`; } catch { return ''; }
}

/**
 * Executa tudo. Devolve {ok, resultados:[{item,status,detalhe}], dns:[…], pooler, resumo}.
 * @param {{env:object, ambiente:string, simular?:boolean, fetchImpl?:Function, s3Check?:Function, conferirSenha?:Function, raizInfra?:string, log?:Function}} o
 */
export async function configurarSupabase({ env = process.env, ambiente, simular = false, fetchImpl = fetch, s3Check = null, conferirSenha = null, raizInfra = INFRA_SUPABASE, log = () => {} } = {}) {
  const r = montar(env, { ambiente, precisa: ['supabase-admin', 'supabase', 'servico', 'arquivos', 'email', 'site'] });
  const remetente = remetentePadrao(env);
  if (!remetente) r.erros.push('não consegui montar o remetente dos e-mails: defina PRODUCTION_URL (https://canteiro.<dominio>) ou a variável EMAIL_REMETENTE');
  if (r.faltando.length || r.erros.length) throw new ToolError(relatorioProblemas(r), { code: 'missing_keys', exit: 2 });
  const E = r.env, ref = r.ref, amb = r.ambiente;
  const redact = buildRedactor({}, [E.SUPABASE_ACCESS_TOKEN, E.RESEND_API_KEY, E.SUPABASE_SERVICE_ROLE_KEY, E.SUPABASE_ANON_KEY, E.S3_SECRET_ACCESS_KEY, env.SUPABASE_DB_PASSWORD].filter(Boolean));
  const mgmt = clienteHttp({ base: env.SUPABASE_API_URL || 'https://api.supabase.com', headers: { Authorization: `Bearer ${E.SUPABASE_ACCESS_TOKEN}` }, fetchImpl, redact, nome: 'Supabase (Management API)' });
  const projeto = clienteHttp({ base: E.SUPABASE_URL, fetchImpl, redact, nome: `Supabase (${ref})` });
  const resend = clienteHttp({ base: env.RESEND_API_URL || 'https://api.resend.com', headers: { Authorization: `Bearer ${E.RESEND_API_KEY}` }, fetchImpl, redact, nome: 'Resend' });
  const resultados = []; const add = (item, status, detalhe = '') => { resultados.push({ item, status, detalhe: redact(detalhe) }); log(`${status.toUpperCase().padEnd(8)} ${item}${detalhe ? ' — ' + redact(detalhe) : ''}`); };
  const tenta = async (item, fn, { obrigatorio = true } = {}) => { try { return await fn(); } catch (e) { add(item, obrigatorio ? 'erro' : 'aviso', e.message); return undefined; } };
  const out = { ambiente: amb, ref, simular, resultados, dns: [], pooler: null };

  // 1. projeto
  const proj = await tenta('Projeto no Supabase', async () => {
    const { json } = await mgmt.get(`/v1/projects/${ref}`);
    if (!json || typeof json !== 'object') throw new Error('resposta inesperada da Management API (sem dados do projeto)');
    const avisos = [];
    if (json.region && json.region !== r.regiao) avisos.push(`o projeto está na região ${json.region}, não em ${r.regiao}: cadastre a variável SUPABASE_REGION=${json.region}`);
    if (json.status && json.status !== 'ACTIVE_HEALTHY') avisos.push(`status do projeto: ${json.status} (esperado ACTIVE_HEALTHY)`);
    add('Projeto no Supabase', avisos.length ? 'aviso' : 'ok', `${json.name || ref} (${ref}) · região ${json.region || '?'} · ${json.status || '?'}${avisos.length ? ' — ' + avisos.join('; ') : ''}`);
    return json;
  });
  if (!proj) { out.ok = false; out.resumo = resumoMarkdown(out); return out; }   // sem acesso ao projeto, nada mais faz sentido

  // 2. Auth
  const infra = lerInfra(raizInfra);
  const grupos = authDesejada(infra, { siteUrl: E.APP_ORIGIN, remetente, nomeRemetente: amb === 'production' ? 'Canteiro A&M' : 'Canteiro A&M (staging)', resendKey: E.RESEND_API_KEY });
  const atual = await tenta('Ler a configuração de Auth', async () => { const { json } = await mgmt.get(`/v1/projects/${ref}/config/auth`); if (!json || typeof json !== 'object') throw new Error('resposta vazia'); return json; });
  if (atual) {
    for (const g of grupos) {
      const dif = diferencas(g.campos, atual, g.secretos || []); const comSegredo = (g.secretos || []).length > 0;
      if (!dif.length && !comSegredo) { add(g.nome, 'ok', 'já estava como deveria'); continue; }
      if (simular) { add(g.nome, dif.length ? 'mudaria' : 'ok', dif.length ? dif.map((k) => `${k}: ${mostrar(k, atual[k])} → ${mostrar(k, g.campos[k])}`).join('; ') : 'só reenviaria o segredo do SMTP'); continue; }
      await tenta(g.nome, async () => { await mgmt.patch(`/v1/projects/${ref}/config/auth`, g.campos); add(g.nome, 'alterado', dif.length ? `ajustado: ${dif.join(', ')}` : 'senha do SMTP reenviada'); }, { obrigatorio: g.obrigatorio });
    }
    if (!simular) {
      const final = await tenta('Reler a configuração de Auth', async () => (await mgmt.get(`/v1/projects/${ref}/config/auth`)).json || {});
      if (final) for (const g of grupos) {
        const dif = diferencas(g.campos, final, g.secretos || []);
        if (dif.length) add(`Conferência: ${g.nome}`, g.obrigatorio ? 'erro' : 'aviso', `depois de aplicar, continua diferente: ${dif.map((k) => `${k}=${mostrar(k, final[k])} (esperado ${mostrar(k, g.campos[k])})`).join('; ')}${g.obrigatorio ? ' — ajuste no painel (infra/supabase/auth-settings.md)' : ' — recurso do plano Pro ou campo com outro nome nesta versão da API: confira no painel'}`);
        else add(`Conferência: ${g.nome}`, 'ok', 'relido e igual ao desejado');
      }
    }
  }

  // 3. JWKS (chaves públicas do login) — sem cabeçalho de chave, exatamente como a API busca (src/auth/jwt.js)
  await tenta('Chaves JWT assimétricas (JWKS)', async () => {
    const { json } = await projeto.get('/auth/v1/.well-known/jwks.json');
    const keys = Array.isArray(json?.keys) ? json.keys : [];
    const assim = keys.filter((k) => ['EC', 'RSA', 'OKP'].includes(k.kty));
    if (!assim.length) throw new Error('o projeto não publica chaves assimétricas (só o segredo legado HS256). Supabase → Project Settings → JWT Keys → "Migrate JWT secret" e depois "Rotate keys" para ECC (P-256). A API valida o login pelo JWKS.');
    add('Chaves JWT assimétricas (JWKS)', 'ok', `${assim.length} chave(s): ${[...new Set(assim.map((k) => k.alg || k.kty))].join(', ')}`);
  });

  // 4. chaves coladas pertencem ao projeto + cadastro desligado visto de fora
  await tenta('Publishable key (SUPABASE_ANON_KEY) e cadastro aberto', async () => {
    const anon = clienteHttp({ base: E.SUPABASE_URL, headers: cabecalhosSupabase(E.SUPABASE_ANON_KEY), fetchImpl, redact, nome: `Supabase (${ref})` });
    const res = await anon.get('/auth/v1/settings', { aceitar: [401, 403] });
    if (res.status === 401 || res.status === 403) throw new Error(`o Supabase recusou a SUPABASE_ANON_KEY (HTTP ${res.status}): ela não é a publishable key do projeto ${ref}`);
    const s = res.json || {};
    const problemas = [];
    if (!simular && s.disable_signup !== true) problemas.push('o cadastro aberto continua LIGADO (disable_signup ≠ true)');
    if (s.external && s.external.email === false) problemas.push('o provedor de e-mail está DESLIGADO: ninguém entraria com e-mail e senha');
    if (problemas.length) throw new Error(problemas.join('; '));
    add('Publishable key (SUPABASE_ANON_KEY) e cadastro aberto', 'ok', `chave aceita; cadastro aberto ${s.disable_signup === true ? 'desligado' : 'LIGADO (será desligado ao aplicar)'}; login por e-mail ${s.external?.email === false ? 'desligado' : 'ligado'}`);
  });
  await tenta('Secret key (SUPABASE_SERVICE_ROLE_KEY)', async () => {
    const res = await clienteHttp({ base: E.SUPABASE_URL, headers: cabecalhosSupabase(E.SUPABASE_SERVICE_ROLE_KEY), fetchImpl, redact, nome: `Supabase (${ref})` }).get('/auth/v1/admin/users', { query: { page: 1, per_page: 1 }, aceitar: [401, 403] });
    if (res.status === 401 || res.status === 403) throw new Error(`o Supabase recusou a SUPABASE_SERVICE_ROLE_KEY (HTTP ${res.status}): ela não é a secret key do projeto ${ref}`);
    add('Secret key (SUPABASE_SERVICE_ROLE_KEY)', 'ok', 'aceita pelo Auth do projeto (convites vão funcionar)');
  });

  // 5. Storage: limites do projeto, bucket privado, chave S3
  await tenta('Storage: limite de tamanho e protocolo S3', async () => {
    const { json } = await mgmt.get(`/v1/projects/${ref}/config/storage`);
    const lim = Number(json?.fileSizeLimit); const s3on = json?.features?.s3Protocol?.enabled;
    const precisa = {}; if (!(lim >= LIMITE_ARQUIVO)) precisa.fileSizeLimit = LIMITE_ARQUIVO; if (s3on === false) precisa.features = { ...(json.features || {}), s3Protocol: { enabled: true } };
    if (!Object.keys(precisa).length) { add('Storage: limite de tamanho e protocolo S3', 'ok', `limite ${Math.round(lim / MiB)} MB; S3 ${s3on === false ? 'desligado' : 'ligado'}`); return; }
    if (simular) { add('Storage: limite de tamanho e protocolo S3', 'mudaria', JSON.stringify({ fileSizeLimit: precisa.fileSizeLimit ? `${Math.round(lim / MiB) || '?'} MB → 100 MB` : undefined, s3Protocol: precisa.features ? 'desligado → ligado' : undefined })); return; }
    await mgmt.patch(`/v1/projects/${ref}/config/storage`, precisa);
    const { json: depois } = await mgmt.get(`/v1/projects/${ref}/config/storage`);
    if (!(Number(depois?.fileSizeLimit) >= LIMITE_ARQUIVO) || depois?.features?.s3Protocol?.enabled === false) throw new Error('depois de aplicar, o limite (≥ 100 MB) ou o protocolo S3 continuam diferentes: ajuste em Storage → Settings');
    add('Storage: limite de tamanho e protocolo S3', 'alterado', `limite ${Math.round(Number(depois.fileSizeLimit) / MiB)} MB; S3 ligado`);
  }, { obrigatorio: false });

  const bucket = E.S3_BUCKET;
  await tenta(`Bucket privado "${bucket}"`, async () => {
    const st = clienteHttp({ base: `${E.SUPABASE_URL}/storage/v1`, headers: cabecalhosSupabase(E.SUPABASE_SERVICE_ROLE_KEY), fetchImpl, redact, nome: 'Supabase Storage' });
    const ler = async () => { const res = await st.get(`/bucket/${encodeURIComponent(bucket)}`, { aceitar: [400, 404] }); return res.status === 200 && res.json && typeof res.json === 'object' ? res.json : null; };
    let b = await ler(); let acao = 'já existia';
    if (!b) {
      if (simular) { add(`Bucket privado "${bucket}"`, 'mudaria', 'seria criado (privado, até 100 MB por arquivo)'); return; }
      await st.post('/bucket', { id: bucket, name: bucket, public: false, file_size_limit: LIMITE_ARQUIVO }); acao = 'criado'; b = await ler();
      if (!b) throw new Error('o bucket foi pedido, mas não aparece na releitura');
    } else if (b.public !== false || (b.file_size_limit && Number(b.file_size_limit) < LIMITE_ARQUIVO)) {
      if (simular) { add(`Bucket privado "${bucket}"`, 'mudaria', `${b.public ? 'PÚBLICO → privado' : ''} ${b.file_size_limit ? 'limite → 100 MB' : ''}`.trim()); return; }
      await st.put(`/bucket/${encodeURIComponent(bucket)}`, { public: false, file_size_limit: LIMITE_ARQUIVO }); acao = 'corrigido'; b = await ler();
    }
    if (!b || b.public !== false) throw new Error(`o bucket ${bucket} não está PRIVADO depois de configurar: Storage → ${bucket} → Edit bucket → desligue "Public bucket"`);
    add(`Bucket privado "${bucket}"`, acao === 'já existia' ? 'ok' : 'alterado', `${acao}; privado; limite ${b.file_size_limit ? Math.round(Number(b.file_size_limit) / MiB) + ' MB' : 'o do projeto'}`);
  });
  await tenta('Chave S3 do Storage lê o bucket', async () => {
    if (simular) { add('Chave S3 do Storage lê o bucket', 'pulado', 'simulação'); return; }
    const check = s3Check || (async (e) => { const { openPrimaryStore } = await import('./lib/targets.js'); const store = openPrimaryStore(e); for await (const _ of store.list('a/')) break; });   // eslint-disable-line no-unused-vars
    await check(E);
    add('Chave S3 do Storage lê o bucket', 'ok', `S3_ACCESS_KEY_ID aceita em ${E.S3_ENDPOINT} (bucket ${bucket})`);
  });

  // 6. Data API e SSL
  await tenta('Data API não expõe o schema app', async () => {
    const { json } = await mgmt.get(`/v1/projects/${ref}/postgrest`);
    const lista = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const schemas = lista(json?.db_schema), extra = lista(json?.db_extra_search_path);
    if (!schemas.includes('app') && !extra.includes('app')) { add('Data API não expõe o schema app', 'ok', `schemas expostos: ${schemas.join(', ') || '(nenhum)'}`); return; }
    if (simular) { add('Data API não expõe o schema app', 'mudaria', 'tiraria "app" da lista de schemas expostos'); return; }
    await mgmt.patch(`/v1/projects/${ref}/postgrest`, { db_schema: schemas.filter((s) => s !== 'app').join(',') || 'public', db_extra_search_path: extra.filter((s) => s !== 'app').join(',') || 'public' });
    const { json: d } = await mgmt.get(`/v1/projects/${ref}/postgrest`);
    if (lista(d?.db_schema).includes('app')) throw new Error('o schema app continua exposto: Project Settings → Data API → Exposed schemas');
    add('Data API não expõe o schema app', 'alterado', `schemas expostos agora: ${lista(d?.db_schema).join(', ')}`);
  });
  await tenta('SSL obrigatório nas conexões ao banco', async () => {
    const { json } = await mgmt.get(`/v1/projects/${ref}/ssl-enforcement`);
    if (json?.currentConfig?.database === true) { add('SSL obrigatório nas conexões ao banco', 'ok', 'já estava ligado'); return; }
    if (simular) { add('SSL obrigatório nas conexões ao banco', 'mudaria', 'ligaria (o banco reinicia por alguns segundos)'); return; }
    const { json: d } = await mgmt.put(`/v1/projects/${ref}/ssl-enforcement`, { requestedConfig: { database: true } });
    if (d?.currentConfig?.database !== true) throw new Error('pedido aceito, mas a releitura não mostra o SSL obrigatório: Project Settings → Database → SSL Configuration');
    add('SSL obrigatório nas conexões ao banco', 'alterado', 'ligado (o banco reinicia por alguns segundos)');
  }, { obrigatorio: false });

  // 7. pooler e senha do banco
  await tenta('Servidor do banco (pooler)', async () => {
    const { json } = await mgmt.get(`/v1/projects/${ref}/config/database/pooler`);
    const itens = Array.isArray(json) ? json : json ? [json] : [];
    const hosts = [...new Set(itens.flatMap((x) => [x.db_host, x.host, ...(String(x.connection_string || x.connectionString || '').match(/@([^:/?]+)/) || []).slice(1)]).filter((h) => h && /pooler\.supabase\.com$/.test(h)))];
    out.pooler = hosts[0] || null;
    if (!out.pooler) throw new Error('a Management API não informou o host do pooler (as ferramentas descobrem sozinhas na hora de conectar)');
    let senha = '';
    if (env.SUPABASE_DB_PASSWORD && conferirSenha !== false) {
      const conf = conferirSenha || (async ({ host, ref: rf, password }) => { const { conectarReal } = await import('./lib/pooler.js'); await conectarReal({ host, port: 5432, user: `postgres.${rf}`, password }); });
      try { await conf({ host: out.pooler, ref, password: env.SUPABASE_DB_PASSWORD }); senha = '; senha do banco conferida (conexão em modo sessão com TLS)'; }
      catch (e) { if (e?.code === '28P01' || /password authentication failed/i.test(String(e?.message))) throw new Error(`o banco RECUSOU a senha: confira o segredo SUPABASE_DB_PASSWORD (Project Settings → Database → Reset database password se ninguém souber a senha)`); senha = `; não consegui testar a senha agora (${redact(String(e?.message || e)).slice(0, 80)})`; }
    }
    add('Servidor do banco (pooler)', 'ok', `${out.pooler} (porta 5432 = sessão, 6543 = transação)${senha}`);
  }, { obrigatorio: false });

  // 8. e-mail: domínio no Resend e DNS
  const dominio = remetente.split('@')[1];
  await tenta(`E-mail: domínio ${dominio} no Resend`, async () => {
    const lista = await resend.get('/domains', { aceitar: [401, 403] });
    if (lista.status === 401 || lista.status === 403) { add(`E-mail: domínio ${dominio} no Resend`, 'aviso', 'a RESEND_API_KEY é só de envio (não lista domínios): os registros de DNS estão em Resend → Domains. O SMTP funciona do mesmo jeito.'); return; }
    let d = (lista.json?.data || []).find((x) => x.name === dominio);
    if (!d) {
      if (simular) { add(`E-mail: domínio ${dominio} no Resend`, 'mudaria', 'o domínio seria cadastrado no Resend (região sa-east-1)'); return; }
      const novo = await resend.post('/domains', { name: dominio, region: 'sa-east-1' }, { aceitar: [401, 403] });
      if (novo.status === 401 || novo.status === 403) { add(`E-mail: domínio ${dominio} no Resend`, 'aviso', 'não consegui cadastrar o domínio com esta chave: cadastre em Resend → Domains → Add domain'); return; }
      d = novo.json;
    }
    const det = d?.id ? (await resend.get(`/domains/${encodeURIComponent(d.id)}`)).json || d : d;
    out.dns.push(...(Array.isArray(det?.records) ? det.records : []).map((x) => ({ origem: 'Resend (e-mail)', tipo: x.type, nome: x.name, valor: x.value, prioridade: x.priority ?? '', status: x.status || '' })));
    out.dns.push({ origem: 'Resend (e-mail) — recomendado', tipo: 'TXT', nome: `_dmarc.${dominio}`, valor: 'v=DMARC1; p=none; rua=mailto:dmarc@' + dominio.split('.').slice(1).join('.'), prioridade: '', status: 'crie se ainda não existir; endureça para p=quarantine depois' });
    const verificado = det?.status === 'verified';
    add(`E-mail: domínio ${dominio} no Resend`, verificado ? 'ok' : 'aviso', verificado ? 'domínio verificado: os convites podem sair' : `domínio ainda NÃO verificado (status ${det?.status || '?'}): a TI precisa criar os registros de DNS da tabela abaixo; depois clique em "Verify" no Resend`);
  }, { obrigatorio: false });

  out.ok = !resultados.some((x) => x.status === 'erro');
  out.resumo = resumoMarkdown(out);
  return out;
}

export function resumoMarkdown(o) {
  const icone = { ok: 'ok', alterado: 'alterado', aviso: 'AVISO', erro: '**ERRO**', mudaria: 'mudaria', pulado: 'pulado' };
  const L = [`## Configurar Supabase — ${o.ambiente} (${o.ref})${o.simular ? ' — SIMULAÇÃO (nada foi alterado)' : ''}`, '', '| Item | Resultado | Detalhe |', '|---|---|---|'];
  for (const x of o.resultados) L.push(`| ${x.item} | ${icone[x.status] || x.status} | ${String(x.detalhe).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  if (o.dns?.length) {
    L.push('', '### Registros de DNS para a TI criar (e-mail)', '', '| Tipo | Nome | Valor | Prioridade | Situação |', '|---|---|---|---|---|');
    for (const d of o.dns) L.push(`| ${d.tipo} | \`${d.nome}\` | \`${String(d.valor).replace(/\|/g, '\\|')}\` | ${d.prioridade} | ${d.status} |`);
  }
  L.push('', o.ok ? '**Resultado: configuração aplicada e conferida.**' : '**Resultado: há itens com ERRO** — leia a coluna Detalhe; corrija e rode de novo (é seguro repetir).', '',
    '> **Apague agora o token temporário:** GitHub → Settings → Secrets and variables → Actions → `SUPABASE_ACCESS_TOKEN` → Remove, e revogue-o em supabase.com → Account → Access Tokens. Ele dá acesso a TODOS os projetos da sua conta.', '');
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['simular', 'help'] });
  if (args.help) { process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '') + '\n'); return 0; }
  const ambiente = args.ambiente || env.AMBIENTE; if (!ambiente) throw new ToolError('informe --ambiente staging|production', { code: 'usage', exit: 2 });
  const redact = buildRedactor(env);
  const o = await configurarSupabase({ env, ambiente, simular: !!args.simular, log: (m) => process.stderr.write(redact(m) + '\n') });
  if (args.resumo) fs.appendFileSync(args.resumo, o.resumo + '\n');
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ ok: o.ok, ambiente: o.ambiente, ref: o.ref, simular: o.simular, resultados: o.resultados, dns: o.dns, pooler: o.pooler }, null, 2) + '\n');
  process.stderr.write(`\n${o.ok ? 'Supabase configurado e conferido.' : 'Configuração com ERROS (veja o resumo).'} Lembre-se de APAGAR o SUPABASE_ACCESS_TOKEN.\n`);
  return o.ok ? 0 : 1;
}
if (isMain(import.meta.url)) runCli(() => main());
export { AMBIENTES };
