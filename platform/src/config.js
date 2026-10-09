/* Configuração a partir do ambiente (docs/API.md §9). Valida tudo na partida; em produção é rígido e falha cedo.
   Segredos ficam só no servidor: nada daqui vai para o navegador. */
import { z } from 'zod';
import { SSO_DOMAIN_RE } from './auth/sso.js';

const MIB = 1024 * 1024;
const bool = (d) => z.preprocess((v) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())), z.boolean());
const Env = z.object({
  APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(['require', 'disable']).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(10).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(16).optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/objects'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),
  STORAGE_QUOTA_USER_MB: z.coerce.number().int().min(0).max(10_485_760).default(0),   // cota de armazenamento por pessoa em MB (0 = desligada)
  MAX_JSON_BYTES: z.coerce.number().int().min(64 * 1024).max(64 * 1024 * 1024).optional(),   // corpo JSON de salvar/criar apresentação, em BYTES (padrão abaixo)
  CSRF_SECRET: z.string().min(32).optional(),
  INVITE_ALLOWED_DOMAINS: z.string().optional(),
  SSO_ENABLED: bool(false),                // login corporativo (SAML do Supabase Auth, PKCE): GET /api/auth/sso e /api/auth/sso/callback
  SSO_DOMAINS: z.string().optional(),      // domínios de e-mail que entram pelo SSO (lista separada por vírgula); obrigatório com SSO_ENABLED
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  SENTRY_DSN: z.string().optional(),
  TRUST_PROXY: bool(true),                 // atrás da Vercel/Cloudflare: usa x-forwarded-for / x-real-ip
  RATE_IP_MULTIPLIER: z.coerce.number().int().min(5).max(1000).default(25),   // limite por IP nas rotas autenticadas = limite por usuário × fator
  GOTRUE_FAKE: bool(false),                // somente test/local: aponta SUPABASE_URL para tools/fake-gotrue.js
  PUBLIC_DIR: z.string().default('./dist/public'),
  RELEASE: z.string().default('dev'),
});

export function loadConfig(env = process.env) {
  const p = Env.safeParse(env);
  if (!p.success) throw new Error('Configuração inválida: ' + p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const e = p.data; const prod = e.APP_ENV === 'production', secure = e.APP_ENV === 'production' || e.APP_ENV === 'staging';
  // Na Vercel (ela define VERCEL=1 no build e na execução) o corpo da requisição E da resposta de uma função é limitado a 4,5 MB (PUB-08):
  // salvar/criar apresentação aceita no máximo 4 MiB por padrão e arquivos acima de 4 MiB não são transmitidos pela função (302 para URL assinada).
  const onVercel = env.VERCEL !== undefined && String(env.VERCEL) !== '';
  const problems = [];
  const origin = new URL(e.APP_ORIGIN);
  if (secure && origin.protocol !== 'https:') problems.push('APP_ORIGIN precisa ser https:// em staging/produção');
  // URLs externas são endpoints, nunca recipientes de usuário/senha embutidos.
  // Mesmo em HTTPS, userinfo pode aparecer em redirecionamentos, proxies e logs.
  if (secure) {
    for (const k of ['APP_ORIGIN', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'S3_ENDPOINT']) {
      if (!e[k]) continue;
      const endpoint = new URL(e[k]);
      if (endpoint.protocol !== 'https:') problems.push(`${k} precisa ser https:// em staging/produção`);
      if (endpoint.username || endpoint.password) problems.push(`${k} não pode incluir usuário ou senha na URL`);
    }
  }
  if (secure) {
    for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CSRF_SECRET']) if (!e[k]) problems.push(`${k} é obrigatório em ${e.APP_ENV}`);
    if (!e.SUPABASE_JWKS_URL && !e.SUPABASE_JWT_SECRET) problems.push('defina SUPABASE_JWKS_URL (preferível) ou SUPABASE_JWT_SECRET');
    if (e.GOTRUE_FAKE) problems.push('GOTRUE_FAKE é proibido em staging/produção');
    if (e.STORAGE_DRIVER === 's3') for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) if (!e[k]) problems.push(`${k} é obrigatório com STORAGE_DRIVER=s3`);
    if (e.STORAGE_DRIVER === 'local' && prod) problems.push('STORAGE_DRIVER=local não serve em produção (use s3)');
    if (env.DATABASE_ADMIN_URL || env.DATABASE_OPS_URL) problems.push('DATABASE_ADMIN_URL/DATABASE_OPS_URL não devem existir no ambiente da API (são só de ferramentas/CI)');
    if (e.DATABASE_SSL === 'disable') problems.push('DATABASE_SSL=disable não é aceito em staging/produção');
  }
  const ssoDomains = (e.SSO_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (e.SSO_ENABLED) {
    if (!ssoDomains.length) problems.push('SSO_ENABLED exige SSO_DOMAINS (os domínios de e-mail que entram pelo login corporativo)');
    const bad = ssoDomains.filter((d) => !SSO_DOMAIN_RE.test(d));
    if (bad.length) problems.push(`SSO_DOMAINS tem domínio inválido: ${bad.join(', ').slice(0, 120)}`);
    if (!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY) problems.push('SSO_ENABLED exige SUPABASE_URL e SUPABASE_ANON_KEY');
  }
  if (problems.length) throw new Error('Configuração insegura/incompleta: ' + problems.join('; '));
  return Object.freeze({
    appEnv: e.APP_ENV, isProd: prod, isSecure: secure, origin: origin.origin, host: origin.host, port: e.PORT,
    cookiePrefix: secure || origin.protocol === 'https:' ? '__Host-' : '', cookieSecure: secure || origin.protocol === 'https:',
    db: { url: e.DATABASE_URL, ssl: e.DATABASE_SSL || (secure ? 'require' : undefined), max: e.DB_POOL_MAX },
    supabase: { url: e.SUPABASE_URL?.replace(/\/$/, ''), anonKey: e.SUPABASE_ANON_KEY, serviceKey: e.SUPABASE_SERVICE_ROLE_KEY, jwksUrl: e.SUPABASE_JWKS_URL, jwtSecret: e.SUPABASE_JWT_SECRET },
    storage: { driver: e.STORAGE_DRIVER, localDir: e.STORAGE_LOCAL_DIR, quotaUserBytes: e.STORAGE_QUOTA_USER_MB * 1024 * 1024, s3: { endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, forcePathStyle: e.S3_FORCE_PATH_STYLE } },
    csrfSecret: e.CSRF_SECRET, inviteDomains: (e.INVITE_ALLOWED_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    sso: Object.freeze({ enabled: e.SSO_ENABLED, domains: Object.freeze(e.SSO_ENABLED ? ssoDomains : []) }),
    logLevel: e.LOG_LEVEL, sentryDsn: e.SENTRY_DSN, trustProxy: e.TRUST_PROXY, publicDir: e.PUBLIC_DIR, release: e.RELEASE, rateIpMultiplier: e.RATE_IP_MULTIPLIER,
    onVercel, maxJsonBytes: e.MAX_JSON_BYTES ?? (onVercel ? 4 * MIB : 13 * MIB), maxApiUploadBytes: 4 * MIB, streamLimitBytes: onVercel ? 4 * MIB : 8 * MIB,
  });
}
