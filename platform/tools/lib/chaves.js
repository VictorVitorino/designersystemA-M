/* tools/lib/chaves.js — monta a configuração COMPLETA das ferramentas e da API a partir das CHAVES MÍNIMAS que a pessoa copia dos painéis.

   A pessoa cola no GitHub só o que não dá para deduzir (senhas e chaves) e o "ref" do projeto Supabase. O resto é montado aqui:
     ref + SUPABASE_DB_PASSWORD     → DATABASE_ADMIN_URL   pooler do Supabase em modo SESSÃO (porta 5432), usuário postgres.<ref>
     ref + APP_OPS_DB_PASSWORD      → DATABASE_OPS_URL     idem, usuário app_ops.<ref>
     ref + APP_API_DB_PASSWORD      → DATABASE_URL da API  pooler em modo TRANSAÇÃO (porta 6543), usuário app_api.<ref> — só vai para a Vercel
     ref                            → SUPABASE_URL, SUPABASE_JWKS_URL e o endpoint S3 do Storage
     ambiente                       → S3_BUCKET, BACKUP_TARGET (um prefixo por ambiente no mesmo bucket do R2), BACKUP_ENV_NAME
     R2_ACCOUNT_ID                  → BACKUP_S3_ENDPOINT do Cloudflare R2
   Compatibilidade: se um valor "montável" já vier pronto (ex.: DATABASE_ADMIN_URL de uma configuração antiga), ele é usado como está.
   Nada aqui imprime segredo: as funções devolvem valores; quem chama decide o que mostrar (e mascara no GitHub Actions). */
import { ToolError } from './common.js';

/** Convenções por ambiente. `github` = ambiente do GitHub onde ficam os segredos daquele lado. */
export const AMBIENTES = Object.freeze({
  staging: Object.freeze({ nome: 'staging', appEnv: 'staging', bucket: 'canteiro-arquivos-staging', prefixoBackup: 'staging', urlVar: 'STAGING_URL', github: 'staging' }),
  production: Object.freeze({ nome: 'production', appEnv: 'production', bucket: 'canteiro-arquivos', prefixoBackup: 'producao', urlVar: 'PRODUCTION_URL', github: 'production-ops' }),
});
export const BACKUP_BUCKET_PADRAO = 'canteiro-backup';
export const REGIAO_PADRAO = 'sa-east-1';

/** "produção", "producao", "prod" → production; "staging", "homologação" → staging. */
export function normalizaAmbiente(x) {
  const s = String(x || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['production', 'producao', 'prod', 'prd'].includes(s)) return 'production';
  if (['staging', 'homologacao', 'stg', 'ensaio'].includes(s)) return 'staging';
  throw new ToolError(`ambiente desconhecido: "${x || ''}" (use staging ou production)`, { code: 'usage', exit: 2 });
}

/** De onde copiar cada item e onde colar. É a fonte das mensagens de erro e é conferida contra docs/CHAVES.md pelos testes. */
export const ITENS = Object.freeze({
  SUPABASE_PROJECT_REF: { tipo: 'variável do ambiente', de: 'Supabase → Project Settings → General → "Project ID" (20 letras; também aparece no endereço do painel)' },
  SUPABASE_DB_PASSWORD: { tipo: 'segredo', de: 'a senha do banco escolhida ao criar o projeto no Supabase (guardada no cofre); para trocar: Project Settings → Database → Reset database password' },
  SUPABASE_ANON_KEY: { tipo: 'segredo', de: 'Supabase → Project Settings → API Keys → Publishable key (começa com sb_publishable_)' },
  SUPABASE_SERVICE_ROLE_KEY: { tipo: 'segredo', de: 'Supabase → Project Settings → API Keys → Secret keys → copiar (começa com sb_secret_)' },
  S3_ACCESS_KEY_ID: { tipo: 'segredo', de: 'Supabase → Storage → S3 Configuration (S3 Connection) → New access key → "Access key ID"' },
  S3_SECRET_ACCESS_KEY: { tipo: 'segredo', de: 'mesma tela, "Secret access key" (só aparece uma vez)' },
  APP_API_DB_PASSWORD: { tipo: 'segredo', de: 'gere no cofre de senhas (40 letras e números) — senha do papel app_api, que a API usa' },
  APP_OPS_DB_PASSWORD: { tipo: 'segredo', de: 'gere no cofre de senhas (40 letras e números) — senha do papel app_ops, que as rotinas usam' },
  RESEND_API_KEY: { tipo: 'segredo', de: 'Resend → API Keys → Create API key (começa com re_)' },
  VERCEL_TOKEN: { tipo: 'segredo', de: 'Vercel → Account Settings → Tokens → Create (escopo: o time "Canteiro A&M")' },
  BACKUP_S3_ACCESS_KEY_ID: { tipo: 'segredo', de: 'Cloudflare → R2 → Manage API tokens → token de ESCRITA (Object Read & Write, só o bucket canteiro-backup) → "Access Key ID"' },
  BACKUP_S3_SECRET_ACCESS_KEY: { tipo: 'segredo', de: 'mesma tela do token do R2 → "Secret Access Key" (só aparece uma vez)' },
  BACKUP_ENCRYPTION_KEY: { tipo: 'segredo', de: 'gere no cofre: 43 letras e números (ou 32 bytes em base64); guarde em 2 lugares — sem ela os backups não abrem' },
  R2_ACCOUNT_ID: { tipo: 'variável do repositório', de: 'Cloudflare → R2 → Overview → "Account ID" (32 caracteres)' },
  PRODUCTION_URL: { tipo: 'variável do repositório', de: 'o endereço de produção, ex.: https://canteiro.<dominio-da-empresa>' },
  STAGING_URL: { tipo: 'variável do repositório', de: 'o endereço de staging, ex.: https://staging.canteiro.<dominio-da-empresa>' },
  SUPABASE_ACCESS_TOKEN: { tipo: 'segredo do repositório (TEMPORÁRIO)', de: 'supabase.com → Account → Access Tokens → Generate new token; APAGUE depois de configurar' },
});

/** Onde colar um item, por ambiente (texto para a pessoa). */
export function ondeColar(nome, ambiente = 'production', { leitura = false } = {}) {
  const meta = ITENS[nome] || { tipo: 'segredo' };
  if (/reposit/.test(meta.tipo)) return meta.tipo.includes('segredo') ? 'GitHub → Settings → Secrets and variables → Actions → Secrets (do repositório)' : 'GitHub → Settings → Secrets and variables → Actions → Variables (do repositório)';
  const env = leitura ? 'monitoring' : AMBIENTES[ambiente].github;
  return `GitHub → Settings → Environments → ${env} → ${/variável/.test(meta.tipo) ? 'Environment variables' : 'Environment secrets'}`;
}

const vazio = (v) => v === undefined || v === null || String(v).trim() === '';
const val = (e, k) => (vazio(e[k]) ? '' : String(e[k]).trim());

/** Aceita o ref puro ou um endereço que o contenha (https://<ref>.supabase.co, …/dashboard/project/<ref>). */
export function extraiRef(v) {
  const s = String(v || '').trim(); if (!s) return '';
  const m = /^([a-z0-9]{20})$/.exec(s) || /https?:\/\/([a-z0-9]{20})\.supabase\.(?:co|in)\b/.exec(s) || /\/project\/([a-z0-9]{20})(?:\/|$)/.exec(s);
  return m ? m[1] : null;
}
/** Aceita o Account ID puro (32 hex) ou o endpoint https://<id>.r2.cloudflarestorage.com. */
export function extraiContaR2(v) {
  const s = String(v || '').trim().toLowerCase(); if (!s) return '';
  const m = /^([0-9a-f]{32})$/.exec(s) || /https?:\/\/([0-9a-f]{32})\.(?:[a-z]+\.)?r2\.cloudflarestorage\.com/.exec(s);
  return m ? m[1] : null;
}
/** Origem https:// a partir de PRODUCTION_URL/STAGING_URL. */
export function origemDoSite(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch { return null; }
  return u.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname) ? u.origin : null;
}

/** URL postgres:// com usuário e senha codificados (qualquer caractere na senha funciona). */
export function urlPostgres({ user, password, host, port, db = 'postgres', sslmode = 'require' }) {
  const q = sslmode ? `?sslmode=${encodeURIComponent(sslmode)}` : '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}${q}`;
}
/** Servidores do pooler compartilhado (Supavisor) da região, na ordem em que a descoberta tenta. */
export const poolerCandidatos = (regiao = REGIAO_PADRAO) => [0, 1, 2].map((n) => `aws-${n}-${regiao}.pooler.supabase.com`);

const isJwt = (k) => /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(k);
const jwtRole = (k) => { try { return JSON.parse(Buffer.from(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role || null; } catch { return null; } };

/** Grupos que uma ferramenta pode pedir com --precisa. */
export const GRUPOS = Object.freeze(['banco', 'ops', 'papeis', 'supabase', 'servico', 'arquivos', 'backup', 'backup-leitura', 'site', 'vercel', 'email', 'supabase-admin']);

/**
 * Monta as variáveis para os grupos pedidos.
 * @param {Record<string,string>} entrada  normalmente process.env (segredos e variáveis do GitHub)
 * @param {{ambiente:string, precisa:string[], poolerHost?:string}} opts
 * @returns {{ ambiente:string, env:Record<string,string>, faltando:{nome:string,tipo:string,de:string,onde:string}[], erros:string[], avisos:string[],
 *             mascarar:string[], poolerPendente:boolean, origem:Record<string,string> }}
 */
export function montar(entrada = process.env, { ambiente, precisa = [], poolerHost = '' } = {}) {
  const amb = normalizaAmbiente(ambiente || entrada.AMBIENTE); const A = AMBIENTES[amb];
  const grupos = new Set(precisa.flatMap((g) => String(g).split(',')).map((g) => g.trim()).filter(Boolean));
  for (const g of grupos) if (!GRUPOS.includes(g)) throw new ToolError(`grupo desconhecido em --precisa: ${g} (use ${GRUPOS.join(', ')})`, { code: 'usage', exit: 2 });
  const env = {}, faltando = [], erros = [], avisos = [], mascarar = [], origem = {}; let poolerPendente = false;
  const leitura = grupos.has('backup-leitura') && !grupos.has('backup') && [...grupos].every((g) => g === 'backup-leitura' || g === 'site');
  const falta = (nome) => { if (!faltando.some((f) => f.nome === nome)) faltando.push({ nome, tipo: (ITENS[nome] || {}).tipo || 'segredo', de: (ITENS[nome] || {}).de || '', onde: ondeColar(nome, amb, { leitura: leitura && /^BACKUP_/.test(nome) }) }); };
  const pega = (k) => { const v = val(entrada, k); if (!v) falta(k); return v; };
  const usa = (k, v, de) => { env[k] = v; origem[k] = de; };

  // ref do projeto (aceita colado como endereço)
  let ref = '';
  const refBruto = val(entrada, 'SUPABASE_PROJECT_REF');
  if (refBruto) { ref = extraiRef(refBruto); if (ref === null) { erros.push('SUPABASE_PROJECT_REF não parece um "Project ID" do Supabase (20 letras minúsculas e números). Copie de Project Settings → General.'); ref = ''; } }
  const regiao = val(entrada, 'SUPABASE_REGION') || REGIAO_PADRAO;
  const host = val(entrada, 'SUPABASE_POOLER_HOST') || val(entrada, 'CANTEIRO_POOLER_HOST') || String(poolerHost || '').trim();
  const precisaDoRef = (motivo) => { if (!ref && !refBruto) falta('SUPABASE_PROJECT_REF'); return !!ref && motivo; };
  if (ref) env.SUPABASE_PROJECT_REF = ref;

  // ---------------------------------------------------------------- banco (dono) e operação
  if (grupos.has('banco')) {
    if (val(entrada, 'DATABASE_ADMIN_URL')) usa('DATABASE_ADMIN_URL', val(entrada, 'DATABASE_ADMIN_URL'), 'segredo DATABASE_ADMIN_URL (configuração antiga)');
    else { const pw = pega('SUPABASE_DB_PASSWORD'); if (precisaDoRef(true) && pw) { if (!host) poolerPendente = true; else { const u = urlPostgres({ user: `postgres.${ref}`, password: pw, host, port: 5432 }); usa('DATABASE_ADMIN_URL', u, `montada: pooler ${host}:5432 (modo sessão), usuário postgres.${ref}`); mascarar.push(u, encodeURIComponent(pw)); } } }
  }
  if (grupos.has('ops')) {
    if (val(entrada, 'DATABASE_OPS_URL')) usa('DATABASE_OPS_URL', val(entrada, 'DATABASE_OPS_URL'), 'segredo DATABASE_OPS_URL (configuração antiga)');
    else { const pw = pega('APP_OPS_DB_PASSWORD'); if (precisaDoRef(true) && pw) { if (!host) poolerPendente = true; else { const u = urlPostgres({ user: `app_ops.${ref}`, password: pw, host, port: 5432 }); usa('DATABASE_OPS_URL', u, `montada: pooler ${host}:5432 (modo sessão), usuário app_ops.${ref}`); mascarar.push(u, encodeURIComponent(pw)); } } }
  }
  if (grupos.has('papeis')) {
    const api = pega('APP_API_DB_PASSWORD'), ops = pega('APP_OPS_DB_PASSWORD');
    if (api) usa('APP_API_DB_PASSWORD', api, 'segredo'); if (ops) usa('APP_OPS_DB_PASSWORD', ops, 'segredo');
    if (api && api.length < 16) erros.push('APP_API_DB_PASSWORD é curta demais: use 40 letras e números gerados no cofre');
    if (ops && ops.length < 16) erros.push('APP_OPS_DB_PASSWORD é curta demais: use 40 letras e números gerados no cofre');
    if (api && ops && api === ops) erros.push('APP_API_DB_PASSWORD e APP_OPS_DB_PASSWORD são iguais: gere duas senhas diferentes');
    const dbpw = val(entrada, 'SUPABASE_DB_PASSWORD'); if (dbpw && (dbpw === api || dbpw === ops)) erros.push('as senhas dos papéis (app_api/app_ops) precisam ser diferentes da senha do banco (SUPABASE_DB_PASSWORD)');
  }

  // ---------------------------------------------------------------- Supabase (Auth) e chaves da API
  const supabaseUrl = () => { if (val(entrada, 'SUPABASE_URL')) return val(entrada, 'SUPABASE_URL').replace(/\/+$/, ''); return precisaDoRef(true) ? `https://${ref}.supabase.co` : ''; };
  if (grupos.has('supabase') || grupos.has('servico')) {
    const url = supabaseUrl();
    if (url) { usa('SUPABASE_URL', url, val(entrada, 'SUPABASE_URL') ? 'informada' : 'montada a partir do ref'); usa('SUPABASE_JWKS_URL', val(entrada, 'SUPABASE_JWKS_URL') || `${url}/auth/v1/.well-known/jwks.json`, 'montada a partir do ref'); }
  }
  if (grupos.has('supabase')) {
    const k = pega('SUPABASE_ANON_KEY');
    if (k) { usa('SUPABASE_ANON_KEY', k, 'segredo');
      if (k.startsWith('sb_secret_') || (isJwt(k) && jwtRole(k) === 'service_role')) erros.push('SUPABASE_ANON_KEY recebeu a chave SECRETA: aqui vai a "Publishable key" (sb_publishable_…); a secreta vai em SUPABASE_SERVICE_ROLE_KEY');
      else if (!k.startsWith('sb_publishable_') && !isJwt(k)) avisos.push('SUPABASE_ANON_KEY não começa com sb_publishable_ (confira se copiou a "Publishable key")'); }
  }
  if (grupos.has('servico')) {
    const k = pega('SUPABASE_SERVICE_ROLE_KEY');
    if (k) { usa('SUPABASE_SERVICE_ROLE_KEY', k, 'segredo');
      if (k.startsWith('sb_publishable_') || (isJwt(k) && jwtRole(k) === 'anon')) erros.push('SUPABASE_SERVICE_ROLE_KEY recebeu a chave PÚBLICA: aqui vai a "Secret key" (sb_secret_…)');
      else if (!k.startsWith('sb_secret_') && !isJwt(k)) avisos.push('SUPABASE_SERVICE_ROLE_KEY não começa com sb_secret_ (confira se copiou a "Secret key")'); }
  }

  // ---------------------------------------------------------------- arquivos (Storage S3 do Supabase)
  if (grupos.has('arquivos')) {
    const id = pega('S3_ACCESS_KEY_ID'), sec = pega('S3_SECRET_ACCESS_KEY');
    const ep = val(entrada, 'S3_ENDPOINT') || (precisaDoRef(true) ? `https://${ref}.supabase.co/storage/v1/s3` : '');
    if (ep) usa('S3_ENDPOINT', ep, val(entrada, 'S3_ENDPOINT') ? 'informado' : 'montado a partir do ref');
    usa('STORAGE_DRIVER', 's3', 'fixo'); usa('S3_REGION', val(entrada, 'S3_REGION') || regiao, 'região do projeto'); usa('S3_BUCKET', val(entrada, 'S3_BUCKET') || A.bucket, val(entrada, 'S3_BUCKET') ? 'informado' : `padrão de ${amb}`);
    usa('S3_FORCE_PATH_STYLE', val(entrada, 'S3_FORCE_PATH_STYLE') || 'true', 'padrão');
    if (id) usa('S3_ACCESS_KEY_ID', id, 'segredo'); if (sec) usa('S3_SECRET_ACCESS_KEY', sec, 'segredo');
    if (id && sec && id === sec) erros.push('S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY são iguais: copie os dois campos da chave do Storage');
  }

  // ---------------------------------------------------------------- backup (Cloudflare R2)
  if (grupos.has('backup') || grupos.has('backup-leitura')) {
    const id = pega('BACKUP_S3_ACCESS_KEY_ID'), sec = pega('BACKUP_S3_SECRET_ACCESS_KEY');
    let ep = val(entrada, 'BACKUP_S3_ENDPOINT');
    if (!ep) { const bruto = val(entrada, 'R2_ACCOUNT_ID'); const conta = extraiContaR2(bruto); if (!bruto) falta('R2_ACCOUNT_ID'); else if (conta === null) erros.push('R2_ACCOUNT_ID não parece um Account ID do Cloudflare (32 caracteres 0-9 a-f): copie de R2 → Overview'); else ep = `https://${conta}.r2.cloudflarestorage.com`; }
    if (ep) usa('BACKUP_S3_ENDPOINT', ep, val(entrada, 'BACKUP_S3_ENDPOINT') ? 'informado' : 'montado a partir do R2_ACCOUNT_ID');
    usa('BACKUP_S3_REGION', val(entrada, 'BACKUP_S3_REGION') || 'auto', 'padrão do R2');
    usa('BACKUP_TARGET', val(entrada, 'BACKUP_TARGET') || `s3://${val(entrada, 'BACKUP_BUCKET') || BACKUP_BUCKET_PADRAO}/${A.prefixoBackup}`, val(entrada, 'BACKUP_TARGET') ? 'informado' : `bucket ${val(entrada, 'BACKUP_BUCKET') || BACKUP_BUCKET_PADRAO}, prefixo ${A.prefixoBackup}`);
    usa('BACKUP_ENV_NAME', amb, 'ambiente');
    if (id) usa('BACKUP_S3_ACCESS_KEY_ID', id, 'segredo'); if (sec) usa('BACKUP_S3_SECRET_ACCESS_KEY', sec, 'segredo');
    if (val(entrada, 'BACKUP_S3_FORCE_PATH_STYLE')) usa('BACKUP_S3_FORCE_PATH_STYLE', val(entrada, 'BACKUP_S3_FORCE_PATH_STYLE'), 'informado');
    if (id && val(entrada, 'S3_ACCESS_KEY_ID') && id === val(entrada, 'S3_ACCESS_KEY_ID')) erros.push('BACKUP_S3_ACCESS_KEY_ID é igual a S3_ACCESS_KEY_ID: o backup precisa do token do R2, não da chave do Storage');
    if (grupos.has('backup')) {
      const k = pega('BACKUP_ENCRYPTION_KEY'); if (k) { usa('BACKUP_ENCRYPTION_KEY', k, 'segredo'); if (val(entrada, 'BACKUP_ENCRYPTION_KEYS_OLD')) usa('BACKUP_ENCRYPTION_KEYS_OLD', val(entrada, 'BACKUP_ENCRYPTION_KEYS_OLD'), 'segredo'); }
    }
    if (val(entrada, 'BACKUP_INCLUDE_AUTH')) usa('BACKUP_INCLUDE_AUTH', val(entrada, 'BACKUP_INCLUDE_AUTH'), 'variável');
  }

  // ---------------------------------------------------------------- site, Vercel, e-mail, Management API
  if (grupos.has('site')) {
    const bruto = val(entrada, A.urlVar); if (!bruto) falta(A.urlVar);
    else { const o = origemDoSite(bruto); if (!o) erros.push(`${A.urlVar} precisa ser um endereço https:// (ex.: https://canteiro.<dominio>)`); else usa('APP_ORIGIN', o, `variável ${A.urlVar}`); }
  }
  if (grupos.has('vercel')) { const t = pega('VERCEL_TOKEN'); if (t) usa('VERCEL_TOKEN', t, 'segredo'); }
  if (grupos.has('email')) { const k = pega('RESEND_API_KEY'); if (k) { usa('RESEND_API_KEY', k, 'segredo'); if (!k.startsWith('re_')) avisos.push('RESEND_API_KEY não começa com re_ (confira se é a chave da API do Resend)'); } }
  if (grupos.has('supabase-admin')) { precisaDoRef(true); const t = pega('SUPABASE_ACCESS_TOKEN'); if (t) { usa('SUPABASE_ACCESS_TOKEN', t, 'segredo temporário'); if (!t.startsWith('sbp_')) avisos.push('SUPABASE_ACCESS_TOKEN não começa com sbp_ (é o "Access Token" da sua conta no Supabase?)'); } }

  return { ambiente: amb, env, faltando, erros, avisos, mascarar: [...new Set(mascarar.filter(Boolean))], poolerPendente, origem, regiao, ref };
}

/** Mensagem única e clara (sem valores) para o que falta ou está errado. */
export function relatorioProblemas(r) {
  const L = [];
  if (r.faltando.length) {
    L.push(`Faltam ${r.faltando.length} item(ns) para o ambiente "${r.ambiente}":`);
    for (const f of r.faltando) L.push(`  - ${f.nome} (${f.tipo}) — copie de: ${f.de}\n      cole em: ${f.onde}`);
  }
  if (r.erros.length) { L.push('Valores com problema:'); for (const e of r.erros) L.push(`  - ${e}`); }
  if (L.length) L.push('Lista completa do que copiar e onde colar: platform/docs/CHAVES.md');
  return L.join('\n');
}

/** Mesmo formato de domínio que a API aceita em SSO_DOMAINS (src/auth/sso.js). */
const DOMINIO_SSO = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/**
 * Variáveis da API para a Vercel (ambiente de staging ou de produção), a partir das chaves mínimas.
 * NUNCA inclui credenciais de ferramentas (DATABASE_ADMIN_URL, DATABASE_OPS_URL, BACKUP_*, senhas de papéis, tokens).
 * @returns {{ vars: {key:string, value:string, sensivel:boolean}[], faltando, erros, avisos, mascarar }}
 */
export function variaveisDaApi(entrada = process.env, { ambiente, poolerHost = '', csrfSecret = '' } = {}) {
  const r = montar(entrada, { ambiente, precisa: ['supabase', 'servico', 'arquivos', 'site'], poolerHost });
  const A = AMBIENTES[r.ambiente]; const faltando = [...r.faltando], erros = [...r.erros], mascarar = [...r.mascarar];
  const apiPw = val(entrada, 'APP_API_DB_PASSWORD');
  if (!apiPw) faltando.push({ nome: 'APP_API_DB_PASSWORD', tipo: 'segredo', de: ITENS.APP_API_DB_PASSWORD.de, onde: ondeColar('APP_API_DB_PASSWORD', r.ambiente) });
  const host = val(entrada, 'SUPABASE_POOLER_HOST') || val(entrada, 'CANTEIRO_POOLER_HOST') || String(poolerHost || '').trim();
  let databaseUrl = '';
  if (val(entrada, 'DATABASE_URL')) databaseUrl = val(entrada, 'DATABASE_URL');
  else if (apiPw && r.ref && host) { databaseUrl = urlPostgres({ user: `app_api.${r.ref}`, password: apiPw, host, port: 6543, sslmode: '' }); mascarar.push(databaseUrl, encodeURIComponent(apiPw)); }
  const e = r.env; const vars = [];
  const add = (key, value, sensivel = false) => { if (!vazio(value)) vars.push({ key, value: String(value), sensivel }); };
  add('APP_ENV', A.appEnv); add('APP_ORIGIN', e.APP_ORIGIN);
  add('DATABASE_URL', databaseUrl, true); add('DATABASE_SSL', 'require'); add('DB_POOL_MAX', val(entrada, 'DB_POOL_MAX') || '3');
  add('SUPABASE_URL', e.SUPABASE_URL); add('SUPABASE_JWKS_URL', e.SUPABASE_JWKS_URL);
  add('SUPABASE_ANON_KEY', e.SUPABASE_ANON_KEY, true); add('SUPABASE_SERVICE_ROLE_KEY', e.SUPABASE_SERVICE_ROLE_KEY, true);
  add('STORAGE_DRIVER', 's3'); add('S3_ENDPOINT', e.S3_ENDPOINT); add('S3_REGION', e.S3_REGION); add('S3_BUCKET', e.S3_BUCKET); add('S3_FORCE_PATH_STYLE', e.S3_FORCE_PATH_STYLE || 'true');
  add('S3_ACCESS_KEY_ID', e.S3_ACCESS_KEY_ID, true); add('S3_SECRET_ACCESS_KEY', e.S3_SECRET_ACCESS_KEY, true);
  add('CSRF_SECRET', csrfSecret || val(entrada, 'CSRF_SECRET'), true);
  add('TRUST_PROXY', '1'); add('LOG_LEVEL', val(entrada, 'LOG_LEVEL') || 'info');
  add('INVITE_ALLOWED_DOMAINS', val(entrada, 'INVITE_ALLOWED_DOMAINS'));
  add('RATE_IP_MULTIPLIER', val(entrada, 'RATE_IP_MULTIPLIER'));
  add('SENTRY_DSN', val(entrada, 'SENTRY_DSN'), true);
  // Opcionais (variáveis do GitHub, não segredos): login corporativo e cota por pessoa. Conferidos aqui com a MESMA regra da API (src/config.js),
  // porque a API se recusa a iniciar com SSO ligado sem domínios válidos — melhor parar antes de publicar.
  const ssoLigado = ['1', 'true', 'yes', 'on'].includes(String(val(entrada, 'SSO_ENABLED')).toLowerCase());
  const dominios = String(val(entrada, 'SSO_DOMAINS')).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (ssoLigado) {
    if (!dominios.length) erros.push('SSO_ENABLED=true exige a variável SSO_DOMAINS (os domínios de e-mail da empresa, separados por vírgula) — veja infra/supabase/sso-saml.md');
    const ruins = dominios.filter((d) => !DOMINIO_SSO.test(d)); if (ruins.length) erros.push(`SSO_DOMAINS tem domínio inválido: ${ruins.join(', ').slice(0, 120)}`);
    add('SSO_ENABLED', 'true'); add('SSO_DOMAINS', dominios.join(','));
  } else if (!vazio(val(entrada, 'SSO_ENABLED'))) add('SSO_ENABLED', 'false');
  const cota = val(entrada, 'STORAGE_QUOTA_USER_MB');
  if (!vazio(cota)) { if (/^\d{1,8}$/.test(String(cota).trim()) && Number(cota) <= 10485760) add('STORAGE_QUOTA_USER_MB', String(Number(cota))); else erros.push('STORAGE_QUOTA_USER_MB precisa ser um número inteiro de MB (0 = sem cota; 20480 = 20 GB por pessoa)'); }
  const csrf = csrfSecret || val(entrada, 'CSRF_SECRET'); if (csrf && csrf.length < 32) erros.push('CSRF_SECRET precisa ter pelo menos 32 caracteres');
  return { ambiente: r.ambiente, vars, faltando, erros, avisos: r.avisos, mascarar: [...new Set(mascarar)], poolerPendente: !databaseUrl && !!apiPw && !!r.ref && !host, ref: r.ref };
}
