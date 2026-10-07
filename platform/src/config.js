/* Configuração a partir do ambiente (docs/API.md §9). Valida tudo na partida; em produção é rígido e falha cedo.
   Segredos ficam só no servidor: nada daqui vai para o navegador. */
import { z } from 'zod';

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
  CSRF_SECRET: z.string().min(32).optional(),
  INVITE_ALLOWED_DOMAINS: z.string().optional(),
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
  const problems = [];
  const origin = new URL(e.APP_ORIGIN);
  if (secure && origin.protocol !== 'https:') problems.push('APP_ORIGIN precisa ser https:// em staging/produção');
  if (secure) {
    for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CSRF_SECRET']) if (!e[k]) problems.push(`${k} é obrigatório em ${e.APP_ENV}`);
    if (!e.SUPABASE_JWKS_URL && !e.SUPABASE_JWT_SECRET) problems.push('defina SUPABASE_JWKS_URL (preferível) ou SUPABASE_JWT_SECRET');
    if (e.GOTRUE_FAKE) problems.push('GOTRUE_FAKE é proibido em staging/produção');
    if (e.STORAGE_DRIVER === 's3') for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) if (!e[k]) problems.push(`${k} é obrigatório com STORAGE_DRIVER=s3`);
    if (e.STORAGE_DRIVER === 'local' && prod) problems.push('STORAGE_DRIVER=local não serve em produção (use s3)');
    if (env.DATABASE_ADMIN_URL || env.DATABASE_OPS_URL) problems.push('DATABASE_ADMIN_URL/DATABASE_OPS_URL não devem existir no ambiente da API (são só de ferramentas/CI)');
    if (e.DATABASE_SSL === 'disable') problems.push('DATABASE_SSL=disable não é aceito em staging/produção');
  }
  if (problems.length) throw new Error('Configuração insegura/incompleta: ' + problems.join('; '));
  return Object.freeze({
    appEnv: e.APP_ENV, isProd: prod, isSecure: secure, origin: origin.origin, host: origin.host, port: e.PORT,
    cookiePrefix: secure || origin.protocol === 'https:' ? '__Host-' : '', cookieSecure: secure || origin.protocol === 'https:',
    db: { url: e.DATABASE_URL, ssl: e.DATABASE_SSL || (secure ? 'require' : undefined), max: e.DB_POOL_MAX },
    supabase: { url: e.SUPABASE_URL?.replace(/\/$/, ''), anonKey: e.SUPABASE_ANON_KEY, serviceKey: e.SUPABASE_SERVICE_ROLE_KEY, jwksUrl: e.SUPABASE_JWKS_URL, jwtSecret: e.SUPABASE_JWT_SECRET },
    storage: { driver: e.STORAGE_DRIVER, localDir: e.STORAGE_LOCAL_DIR, s3: { endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, forcePathStyle: e.S3_FORCE_PATH_STYLE } },
    csrfSecret: e.CSRF_SECRET, inviteDomains: (e.INVITE_ALLOWED_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    logLevel: e.LOG_LEVEL, sentryDsn: e.SENTRY_DSN, trustProxy: e.TRUST_PROXY, publicDir: e.PUBLIC_DIR, release: e.RELEASE, rateIpMultiplier: e.RATE_IP_MULTIPLIER,
    maxJsonBytes: 13 * 1024 * 1024, maxApiUploadBytes: 4 * 1024 * 1024,
  });
}
