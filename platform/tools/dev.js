#!/usr/bin/env node
/* tools/dev.js — a plataforma inteira em UM comando, no seu computador (desenvolvimento, demonstração, testes ponta a ponta).
   O que ele faz, nesta ordem:
     1. Postgres local (já instalado): cria/garante o banco (padrão canteiro_dev) e aplica as migrações (papéis app_api/app_ops incluídos).
     2. GoTrue FALSO (tools/fake-gotrue.js) em 127.0.0.1: login, convite e recuperação funcionam sem Supabase; os e-mails caem em
        http://127.0.0.1:<porta>/__outbox (o link do convite aparece ali e também no terminal).
     3. Build do site (dist/public: páginas + editor em nuvem + CSP), se ainda não existir ou com --build.
     4. API + site em http://localhost:<porta> (APP_ENV=local, armazenamento de arquivos em .data/objects).
     5. Primeiro administrador: --admin fulano@empresa.com cria o convite e imprime o link para definir a senha.
   Uso:  node tools/dev.js [--port 3000] [--db canteiro_dev] [--admin email --name "Nome"] [--build] [--reset]
   Nada disto serve para produção: lá a API usa o Supabase real e as variáveis de docs/CONFIGURACAO.md. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const PORT = Number(args.port || process.env.PORT || 3000), DB = String(args.db || 'canteiro_dev'), ORIGIN = `http://localhost:${PORT}`;
const DATA = path.join(ROOT, '.data'); fs.mkdirSync(DATA, { recursive: true });
if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') { console.error('tools/dev.js é só para uso local (APP_ENV local).'); process.exit(2); }
if (!/^canteiro_(dev|t_[a-z0-9_]+|e2e[a-z0-9_]*)$/.test(DB)) { console.error('nome de banco local inválido:', DB); process.exit(2); }

/* segredos locais persistentes (para os cookies continuarem válidos entre reinícios) */
const secretsFile = path.join(DATA, 'dev-secrets.json');
let secrets = fs.existsSync(secretsFile) ? JSON.parse(fs.readFileSync(secretsFile, 'utf8')) : {};
secrets.csrf ||= crypto.randomBytes(32).toString('base64url'); secrets.apiPw ||= crypto.randomBytes(16).toString('hex'); secrets.opsPw ||= crypto.randomBytes(16).toString('hex');
fs.writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });

const ADMIN_URL = process.env.DATABASE_ADMIN_URL || `postgres://postgres:postgres@127.0.0.1:5432/${DB}`;
function step(msg) { console.log('\n▶ ' + msg); }

/* 1. banco */
step(`Postgres local: banco ${DB}`);
try { execFileSync('node', [path.join(HERE, 'local-db.js'), 'up'], { stdio: 'inherit' }); } catch (e) { console.error('Não consegui iniciar o Postgres local. Instale o PostgreSQL 16 ou defina DATABASE_ADMIN_URL.'); process.exit(1); }
if (DB !== 'canteiro_dev') { try { execFileSync('node', [path.join(HERE, 'local-db.js'), 'create', DB], { stdio: 'inherit' }); } catch (e) { /* já existe */ } }
if (args.reset) execFileSync('node', [path.join(HERE, 'local-db.js'), 'reset', DB], { stdio: 'inherit' });
const { migrate } = await import('./migrate.js');
await migrate(ADMIN_URL, { apiPassword: secrets.apiPw, opsPassword: secrets.opsPw, roles: true });
const dbUrl = (user, pw) => { const u = new URL(ADMIN_URL); u.username = user; u.password = pw; return u.toString(); };

/* 2. GoTrue falso */
step('GoTrue falso (login, convite e recuperação sem Supabase)');
const { startFakeGoTrue } = await import('./fake-gotrue.js');
const fake = await startFakeGoTrue({ port: Number(args['auth-port'] || 0), mode: 'jwks', appOrigin: ORIGIN });
console.log(`   ${fake.url}  · e-mails em ${fake.url}/__outbox`);

/* 3. build do site */
const publicDir = path.join(ROOT, 'dist', 'public');
if (args.build || !fs.existsSync(path.join(publicDir, 'editor', 'index.html'))) { step('Build do site (páginas + editor em nuvem + CSP)'); execFileSync('node', [path.join(HERE, 'build-web.js')], { stdio: 'inherit', cwd: ROOT }); }

/* 4. API + site */
step(`API + site em ${ORIGIN}`);
const env = {
  ...process.env, APP_ENV: 'local', APP_ORIGIN: ORIGIN, PORT: String(PORT), DATABASE_URL: dbUrl('app_api', secrets.apiPw), DATABASE_SSL: 'disable',
  SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: fake.anonKey || 'fake-anon-key-0000000000', SUPABASE_SERVICE_ROLE_KEY: fake.serviceKey || 'fake-service-role-key-000000',
  SUPABASE_JWKS_URL: fake.url + '/auth/v1/.well-known/jwks.json', STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: path.join(DATA, 'objects'), CSRF_SECRET: secrets.csrf,
  PUBLIC_DIR: publicDir, LOG_LEVEL: process.env.LOG_LEVEL || 'info', ALLOW_SERVICE_KEY_IN_API: '1', GOTRUE_FAKE: '1', TRUST_PROXY: '0',
};
delete env.DATABASE_ADMIN_URL; delete env.DATABASE_OPS_URL;
const { start } = await import('../src/server.js');
const srv = await start(env);

/* 5. primeiro administrador */
if (args.admin) {
  step(`Primeiro administrador: ${args.admin}`);
  const { createOpsDb } = await import('../src/db.js');
  const ops = createOpsDb({ url: dbUrl('app_ops', secrets.opsPw) });
  const email = String(args.admin).toLowerCase().trim(), name = String(args.name || 'Administrador');
  await ops.asSystem(async (tx) => {
    const [u] = await tx`insert into app.users(email, display_name, role, status) values (${email}, ${name}, 'admin', 'invited') on conflict (email) do update set role = 'admin' returning id, status`;
    if (u.status === 'invited') await tx`insert into app.invites(email, user_id, role) values (${email}, ${u.id}, 'admin') on conflict do nothing`;
  });
  await ops.end();
  const r = await fetch(fake.url + '/auth/v1/invite', { method: 'POST', headers: { 'content-type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }, body: JSON.stringify({ email, data: { display_name: name } }) });
  const box = (await (await fetch(fake.url + '/__outbox')).json());
  const last = (Array.isArray(box) ? box : box.items || []).filter((m) => (m.to || m.email) === email).pop();
  const link = last && (last.link || (last.token_hash ? `${ORIGIN}/auth/confirmar?token_hash=${last.token_hash}&type=invite` : null));
  console.log(r.ok ? `   Convite criado. Abra para definir a senha:\n   ${link || '(veja ' + fake.url + '/__outbox)'}` : `   Convite falhou (${r.status}); confira ${fake.url}/__outbox`);
}
console.log(`\n✔ Pronto. Abra ${ORIGIN}/entrar  ·  Ctrl+C para parar.`);
const stop = async () => { try { await srv.stop(); } catch (e) { } try { await fake.close(); } catch (e) { } process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
