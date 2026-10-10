#!/usr/bin/env node
/* tools/reinvite.js — reconvite EM LOTE depois de perder as contas do login (projeto Supabase Auth perdido e sem backup de Auth;
   docs/BACKUP-E-RESTAURACAO.md §8). As pessoas continuam em app.users (papel, apresentações), mas sem credencial no Auth.
   Uso:  DATABASE_OPS_URL=postgres://app_ops:…  SUPABASE_URL=https://xxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=…  \
         node tools/reinvite.js [--apply] [--status active|invited|all] [--limit N] [--delay-ms 1000]
   • SIMULA por padrão (só conta e lista, mascarando os e-mails); envia de verdade só com --apply.
   • Para cada pessoa ativa/convidada SEM conta no Auth: (convidada) renova o convite pendente pelo prazo invites.ttl_days; envia o e-mail
     de convite. Pelo link, a pessoa define a senha e entra na MESMA conta (resolve_identity vincula pelo e-mail verificado).
   • Quem já tem conta no Auth é pulado (não recebe e-mail). Suspensos nunca são reconvidados.
   • Falha de uma pessoa não para o lote; 429 (limite de e-mails do provedor) para o lote e diz quantas faltam — rode de novo depois.
   • Nenhum segredo é impresso; e-mails aparecem mascarados (a***@empresa.com). Cada envio é auditado (invite.resend, {bulk:true}). */
import { createOpsDb } from '../src/db.js';
import { createGoTrue } from '../src/auth/gotrue.js';

export function parseArgs(argv) {
  const out = { apply: false, status: 'all', limit: 0, delayMs: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`falta o valor de ${a}`); return v; };
    if (a === '--apply') out.apply = true;
    else if (a === '--status') out.status = val();
    else if (a === '--limit') out.limit = Number(val());
    else if (a === '--delay-ms') out.delayMs = Number(val());
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!['active', 'invited', 'all'].includes(out.status)) throw new Error('--status deve ser active, invited ou all');
  if (!Number.isInteger(out.limit) || out.limit < 0) throw new Error('--limit deve ser um inteiro ≥ 0');
  if (!Number.isInteger(out.delayMs) || out.delayMs < 0 || out.delayMs > 600000) throw new Error('--delay-ms deve ser um inteiro entre 0 e 600000');
  return out;
}

export const maskEmail = (e) => { const [u, d] = String(e).split('@'); return `${(u || '').slice(0, 1)}***@${d || ''}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{apply?:boolean, status?:'active'|'invited'|'all', limit?:number, delayMs?:number}} opts
 * @param {{ops:object, gotrue:object, log?:Function}} deps
 * @returns {Promise<{candidates:number, sent:number, skippedHasAccount:number, failed:number, stoppedByRateLimit:boolean, remaining:number, dryRun:boolean}>}
 */
export async function reinvite({ apply = false, status = 'all', limit = 0, delayMs = 1000 } = {}, { ops, gotrue, log = console.log }) {
  const statuses = status === 'all' ? ['active', 'invited'] : [status];
  const users = await ops.asSystem((tx) => tx`select id, email, display_name, role, status from app.users
      where status = any(${statuses}::text[]) order by email ${limit ? tx`limit ${limit}` : tx``}`);
  const out = { candidates: users.length, sent: 0, skippedHasAccount: 0, failed: 0, stoppedByRateLimit: false, remaining: 0, dryRun: !apply };
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    let hasAccount;
    try { hasAccount = !!(await gotrue.findUserIdByEmail(u.email)); }
    catch { out.failed++; log(`falha ao consultar o login de ${maskEmail(u.email)}; seguindo`); continue; }
    if (hasAccount) { out.skippedHasAccount++; continue; }
    if (!apply) { log(`enviaria convite para ${maskEmail(u.email)} (${u.status}, ${u.role})`); out.sent++; continue; }
    try {
      await ops.asSystem(async (tx) => {
        if (u.status === 'invited') {   // convite vencido não autentica (migração 0010): renova o pendente ou cria um novo
          const [ttl] = await tx`select value from app.settings where key = 'invites.ttl_days'`;
          const days = Number.isInteger(Number(ttl && ttl.value)) && Number(ttl.value) > 0 ? Number(ttl.value) : 7;
          const [pend] = await tx`select id from app.invites where user_id = ${u.id} and status = 'pending'`;
          if (pend) await tx`update app.invites set expires_at = now() + make_interval(days => ${days}::int), resent_count = resent_count + 1 where id = ${pend.id}`;
          else await tx`insert into app.invites(email, user_id, role, expires_at) values (${u.email}, ${u.id}, ${u.role}, now() + make_interval(days => ${days}::int))`;
        }
        await tx`select app.audit('invite.resend', 'user', ${u.id}, null, 'tools/reinvite', null, ${tx.json({ bulk: true, status: u.status })})`;
        await gotrue.invite({ email: u.email, displayName: u.display_name });   // falhou → a transação desfaz o convite renovado e a auditoria
      });
      out.sent++; log(`convite enviado para ${maskEmail(u.email)}`);
    } catch (e) {
      if (e && (e.status === 429 || e.code === 'rate_limited')) { out.stoppedByRateLimit = true; out.remaining = users.length - i; log(`o provedor de e-mail atingiu o limite: ${out.remaining} pessoa(s) ainda sem convite. Rode de novo mais tarde (quem já recebeu é pulado).`); break; }
      if (e && e.code === 'already_exists') { out.skippedHasAccount++; continue; }   // conta criada entre a consulta e o envio
      out.failed++; log(`falha ao convidar ${maskEmail(u.email)}; seguindo`);
    }
    if (delayMs && i < users.length - 1) await sleep(delayMs);
  }
  log(`${out.dryRun ? '[simulação] ' : ''}candidatos: ${out.candidates} · ${out.dryRun ? 'a convidar' : 'convidados'}: ${out.sent} · já têm conta: ${out.skippedHasAccount} · falhas: ${out.failed}${out.stoppedByRateLimit ? ` · parou no limite de e-mails (faltam ${out.remaining})` : ''}`);
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let args;
  try { args = parseArgs(argv); } catch (e) { console.error('Erro: ' + e.message); return 2; }
  if (args.help) { console.log('Uso: node tools/reinvite.js [--apply] [--status active|invited|all] [--limit N] [--delay-ms 1000]\nVariáveis: DATABASE_OPS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY'); return 0; }
  for (const k of ['DATABASE_OPS_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!env[k]) { console.error(`Falta a variável ${k}.`); return 2; }
  const ops = createOpsDb({ url: env.DATABASE_OPS_URL, max: 1 });
  try {
    const gotrue = createGoTrue({ appEnv: 'local', logLevel: 'warn', supabase: { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY } });
    const r = await reinvite(args, { ops, gotrue });
    return r.failed || r.stoppedByRateLimit ? 1 : 0;
  } catch { console.error('Erro: falha inesperada (confira DATABASE_OPS_URL e as chaves do Supabase).'); return 1; }
  finally { await ops.end(); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().then((code) => process.exit(code));
