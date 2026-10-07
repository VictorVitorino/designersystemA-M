#!/usr/bin/env node
/* tools/create-first-admin.js — cria o PRIMEIRO administrador (não existe cadastro aberto: alguém precisa convidar o primeiro).
   Uso:  DATABASE_OPS_URL=postgres://app_ops:…  SUPABASE_URL=https://xxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=…  \
         node tools/create-first-admin.js --email fulano@empresa.com --name "Fulano de Tal"
   • Cria app.users (admin, status invited) + app.invites e pede ao Supabase Auth para enviar o e-mail de convite; o convidado clica no link,
     define a senha e vira administrador ativo.
   • Idempotente: se o admin já está ativo, não faz nada; se o convite ainda está pendente, reenvia o e-mail (até 5 reenvios).
   • Roda do SEU computador/CI com as credenciais de operação; essas credenciais não existem no servidor da API. Nenhum segredo é impresso. */
import { createOpsDb } from '../src/db.js';
import { createGoTrue } from '../src/auth/gotrue.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i]; else if (a === '--name') out.name = argv[++i];
    else if (a.startsWith('--email=')) out.email = a.slice(8); else if (a.startsWith('--name=')) out.name = a.slice(7);
    else if (a === '--help' || a === '-h') out.help = true; else throw new Error(`argumento desconhecido: ${a}`);
  }
  return out;
}

/** @param {{email:string,name:string}} args @param {{ops:object, gotrue:object, log?:Function}} deps @returns {Promise<{action:'created'|'resent'|'already_admin'|'exists_other', userId:string}>} */
export async function createFirstAdmin({ email, name }, { ops, gotrue, log = console.log }) {
  const mail = String(email || '').trim().toLowerCase();
  const display = String(name || '').trim();
  if (!EMAIL_RE.test(mail) || mail.length > 254) throw new Error('e-mail inválido (use --email)');
  if (!display || display.length > 120 || /[\u0000-\u001f<>]/.test(display)) throw new Error('nome inválido (use --name "Nome Completo")');
  const state = await ops.asSystem(async (tx) => {
    const [ex] = await tx`select id, role, status, activated_at from app.users where email = ${mail} for update`;
    if (ex) {
      if (ex.status === 'active' && ex.role === 'admin') return { action: 'already_admin', userId: ex.id };
      if (ex.status !== 'invited' || ex.role !== 'admin') return { action: 'exists_other', userId: ex.id };
      const [inv] = await tx`select id, resent_count from app.invites where user_id = ${ex.id} and status = 'pending'`;
      if (inv) {
        if (inv.resent_count >= 5) throw new Error('limite de 5 reenvios atingido; revogue o convite no painel ou aguarde');
        await tx`update app.invites set resent_count = resent_count + 1, expires_at = now() + interval '7 days' where id = ${inv.id}`;
      } else {
        await tx`insert into app.invites(email, user_id, role) values (${mail}, ${ex.id}, 'admin')`;
      }
      await tx`select app.audit('invite.resend', 'user', ${ex.id}, null, 'create-first-admin', null, ${tx.json({ bootstrap: true })})`;
      await gotrue.invite({ email: mail, displayName: display }).catch(async (e) => { if (e.code === 'already_exists') await gotrue.recover(mail); else throw e; });
      return { action: 'resent', userId: ex.id };
    }
    const [u] = await tx`insert into app.users(email, display_name, role, status) values (${mail}, ${display}, 'admin', 'invited') returning id`;
    const [inv] = await tx`insert into app.invites(email, user_id, role) values (${mail}, ${u.id}, 'admin') returning id`;
    await tx`select app.audit('invite.create', 'invite', ${inv.id}, null, 'create-first-admin', null, ${tx.json({ bootstrap: true, role: 'admin' })})`;
    await gotrue.invite({ email: mail, displayName: display }).catch(async (e) => { if (e.code === 'already_exists') await gotrue.recover(mail); else throw e; });   // falhou → rollback: nada fica gravado
    return { action: 'created', userId: u.id };
  });
  const msg = { created: 'Convite enviado. Abra o e-mail, clique no link e defina a senha.', resent: 'O convite já existia: reenviei o e-mail.', already_admin: 'Este e-mail já é administrador ativo. Nada a fazer.', exists_other: 'Já existe um usuário com este e-mail que não é um convite de administrador pendente. Use o painel de administração.' }[state.action];
  log(msg);
  return state;
}

/**
 * Traduz as falhas mais comuns da primeira vez em "o que fazer" (o workflow mostra isto no resumo). Nunca inclui segredos.
 * @param {any} e  erro do banco (postgres.js: e.code = SQLSTATE ou código de rede) ou do Supabase Auth
 * @param {{statusSupabase?:number}} [o]  último status HTTP do Supabase Auth no convite (0 = não chegou a chamar)
 */
export function explicarErro(e, { statusSupabase = 0 } = {}) {
  const code = String(e?.code || ''); const msg = String(e?.message || '');
  if (['42P01', '3F000', '22023', '42883'].includes(code) || /relation "app\.|schema "app"|role "app_system" does not exist/i.test(msg))
    return 'o banco deste ambiente ainda não tem o Canteiro instalado. Publique o ambiente primeiro (staging: workflow "Publicar staging"; produção: crie a versão vX.Y.Z) — a publicação cria as tabelas e os papéis — e rode este assistente de novo.';
  if (code === '28P01' || /password authentication failed/i.test(msg))
    return 'a senha do papel de operação (app_ops) não confere com a do banco. Ela é gravada no banco pela publicação: confira o segredo APP_OPS_DB_PASSWORD deste ambiente, rode a publicação de novo e depois este assistente.';
  if (/tenant or user not found/i.test(msg))
    return 'o servidor do banco não reconheceu o usuário app_ops do projeto: o papel ainda não existe (publique o ambiente primeiro) ou a variável SUPABASE_PROJECT_REF/SUPABASE_POOLER_HOST está errada.';
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'CONNECT_TIMEOUT', 'ECONNRESET'].includes(code))
    return `não consegui conectar ao banco (${code}): confira SUPABASE_PROJECT_REF e SUPABASE_POOLER_HOST deste ambiente e se o projeto do Supabase está ativo (não pausado).`;
  if (statusSupabase === 401 || statusSupabase === 403)
    return 'o Supabase recusou a chave secreta: copie de novo a secret key (sb_secret_…) do projeto DESTE ambiente para o segredo SUPABASE_SERVICE_ROLE_KEY. Nada foi gravado no banco.';
  if (statusSupabase === 429)
    return 'o Supabase atingiu o limite de e-mails por hora. Espere 1 hora e rode de novo (nada foi gravado no banco).';
  if (statusSupabase >= 500)
    return `o Supabase não conseguiu enviar o e-mail de convite (HTTP ${statusSupabase}). Quase sempre é o envio de e-mail: rode o assistente "Configurar Supabase" deste ambiente e confira no Resend se o domínio está "Verified" (registros de DNS). Nada foi gravado no banco.`;
  return msg || 'falha inesperada';
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help || !args.email || !args.name) { console.log('Uso: node tools/create-first-admin.js --email fulano@empresa.com --name "Fulano de Tal"\nVariáveis: DATABASE_OPS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY'); return args.help ? 0 : 2; }
  for (const k of ['DATABASE_OPS_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!env[k]) { console.error(`Falta a variável ${k}.`); return 2; }
  const ops = createOpsDb({ url: env.DATABASE_OPS_URL, max: 1 });
  let statusSupabase = 0;   // guarda só o status HTTP do convite (o corpo da resposta nunca é mostrado)
  const fetchImpl = async (url, init) => { const r = await fetch(url, init); if (/\/(invite|recover)$/.test(new URL(String(url?.url || url)).pathname)) statusSupabase = r.status; return r; };
  try {
    const gotrue = createGoTrue({ appEnv: 'local', logLevel: 'warn', supabase: { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY } }, { fetchImpl });
    await createFirstAdmin({ email: args.email, name: args.name }, { ops, gotrue });
    return 0;
  } catch (e) { console.error('Erro: ' + explicarErro(e, { statusSupabase: statusSupabase >= 300 ? statusSupabase : 0 })); return 1; }
  finally { await ops.end(); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().then((code) => process.exit(code));
