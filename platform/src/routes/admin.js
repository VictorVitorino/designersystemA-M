/* Administração (docs/API.md §7). Só administradores — e quem decide isso é o BANCO (RLS + app.is_admin()), não um papel vindo do cliente:
   toda operação roda numa transação como o admin (db.asUser), então mesmo um erro aqui não daria a um membro poder de admin.
   • Convite: cria app.users(invited) + app.invites e chama o GoTrue DENTRO da transação; se o GoTrue falhar, nada é gravado (rollback).
   • Revogar/suspender: o banco é a barreira (vale em ≤ 15 s por causa do cache de identidade); o bloqueio no GoTrue é a segunda barreira (melhor-esforço, auditado se falhar).
   • Nada de e-mail em claro na auditoria: usa-se o id do convite/usuário e o HMAC do e-mail. */
import { Hono } from 'hono';
import { E } from '../lib/errors.js';
import { createLogger } from '../lib/log.js';
import { requireAdmin, audit, limit } from '../lib/request.js';
import { getAuthKit } from '../auth/kit.js';
import { readJson, emailField, displayNameField, uuidField, z } from '../auth/body.js';

const InviteBody = z.object({ email: emailField, displayName: displayNameField, role: z.enum(['member', 'admin']).default('member') }).strict();
const PatchUserBody = z.object({
  role: z.enum(['admin', 'member']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  displayName: displayNameField.optional(),
}).strict().refine((o) => Object.keys(o).length > 0, { message: 'Informe ao menos um campo para alterar.' });
const SettingBody = z.object({ value: z.unknown() }).strict();

/** Chaves conhecidas de app.settings e o formato aceito de cada uma. */
const SETTINGS = {
  'acervo.visibility': z.literal('all_members'),
  'versions.keep_last': z.number().int().min(1).max(500),
  'versions.keep_daily_days': z.number().int().min(1).max(365),
  'uploads.max_bytes': z.number().int().min(1_048_576).max(524_288_000),
  'invites.ttl_days': z.number().int().min(1).max(30),
};
const SETTING_KEYS = Object.keys(SETTINGS);

const lim = z.coerce.number().int().min(1).max(100).default(30);
const UsersQuery = z.object({ status: z.enum(['invited', 'active', 'suspended']).optional(), q: z.string().trim().max(100).optional(), limit: lim, cursor: z.string().max(200).optional() }).strict();
const day = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const AuditQuery = z.object({
  actor: uuidField.optional(), action: z.string().regex(/^[a-z0-9_.:*-]{1,80}$/, 'Ação inválida.').optional(),
  from: z.string().regex(day, 'Data inválida.').optional(), to: z.string().regex(day, 'Data inválida.').optional(), limit: lim, cursor: z.string().max(40).optional(),
}).strict();

const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');
const encodeCursor = (parts) => Buffer.from(JSON.stringify(parts)).toString('base64url');
function decodeCursor(s, shape) {
  if (!s) return null;
  try { const v = JSON.parse(Buffer.from(s, 'base64url').toString()); if (Array.isArray(v) && shape(v)) return v; } catch { /* cai no erro abaixo */ }
  throw E.badRequest('Cursor inválido.');
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (c, name = 'id') => { const v = c.req.param(name); if (!UUID.test(v)) throw E.notFound(); return v.toLowerCase(); };

export function adminRoutes(deps) {
  const { config, db, gotrue } = deps;
  const kit = getAuthKit(deps);
  const log = deps.logger || createLogger(config);
  const r = new Hono();
  r.use('*', async (c, next) => { requireAdmin(c); await next(); });   // membro → 403 em TUDO (inclusive caminhos inexistentes)

  const bestEffort = async (fn) => { try { return await fn(); } catch (e) { log.warn('admin_best_effort_failed', { code: e && e.code }); return undefined; } };
  const domainAllowed = (email) => !config.inviteDomains.length || config.inviteDomains.includes(email.split('@')[1]);
  async function inviteTtlDays(tx) {
    const [s] = await tx`select value from app.settings where key = 'invites.ttl_days'`;
    const n = Number(s?.value); return Number.isInteger(n) && n >= 1 && n <= 30 ? n : 7;
  }
  /** Envia o e-mail: convite; se o GoTrue já tem uma conta confirmada para o e-mail, manda o link de recuperação (define a senha do mesmo jeito). */
  async function sendInviteMail(email, displayName) {
    try { await gotrue.invite({ email, displayName }); }
    catch (e) { if (e && e.code === 'already_exists') await gotrue.recover(email); else throw e; }
  }
  /** Bloqueia/desbloqueia no GoTrue pelo e-mail. true = sincronizado (ou nada a fazer); false = falhou. */
  async function syncBan(email, banned) {
    try { const id = await gotrue.findUserIdByEmail(email); if (id) await gotrue.ban(id, banned); return true; }
    catch (e) { log.warn('gotrue_ban_failed', { code: e && e.code, banned }); return false; }
  }

  // ------------------------------------------------------------------------------------------------ usuários
  r.get('/users', async (c) => {
    const admin = requireAdmin(c);
    const q = UsersQuery.parse(c.req.query());
    const cur = decodeCursor(q.cursor, (v) => v.length === 2 && typeof v[0] === 'string' && /^[0-9T:. +-]{10,40}$/.test(v[0]) && UUID.test(v[1]));
    const like = q.q ? `%${likeEscape(q.q)}%` : null;
    const rows = await db.asUser(admin.id, (tx) => tx`
      select u.id, u.email, u.display_name, u.role, u.status, u.created_at, u.created_at::text as created_txt, u.activated_at, u.last_login_at,
             (select count(*)::int from app.presentations p where p.owner_id = u.id and p.deleted_at is null) as presentation_count,
             inv.id as invite_id, inv.status as invite_status, inv.expires_at as invite_expires_at, inv.resent_count
        from app.users u
        left join lateral (select i.id, i.status, i.expires_at, i.resent_count from app.invites i where i.user_id = u.id order by i.created_at desc limit 1) inv on true
       where true
         ${q.status ? tx`and u.status = ${q.status}` : tx``}
         ${like ? tx`and (u.email ilike ${like} or u.display_name ilike ${like})` : tx``}
         ${cur ? tx`and (u.created_at, u.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : tx``}
       order by u.created_at desc, u.id desc
       limit ${q.limit + 1}`);
    const page = rows.slice(0, q.limit);
    return c.json({
      items: page.map((u) => ({
        id: u.id, email: u.email, displayName: u.display_name, role: u.role, status: u.status, createdAt: u.created_at, activatedAt: u.activated_at, lastLoginAt: u.last_login_at,
        presentationCount: u.presentation_count,
        invite: u.invite_id ? { id: u.invite_id, status: u.invite_status, expiresAt: u.invite_expires_at, resentCount: u.resent_count } : null,
      })),
      nextCursor: rows.length > q.limit ? encodeCursor([page[page.length - 1].created_txt, page[page.length - 1].id]) : null,
    });
  });

  r.patch('/users/:id', async (c) => {
    const admin = requireAdmin(c); const id = uuidParam(c);
    const body = await readJson(c, PatchUserBody);
    let out;
    try {
      out = await db.asUser(admin.id, async (tx) => {
        // trava SEMPRE os admins ativos primeiro e na mesma ordem (id): dois admins se rebaixando ao mesmo tempo não zeram os admins nem causam deadlock
        const admins = (body.role || body.status) ? await tx`select id from app.users where role = 'admin' and status = 'active' order by id for update` : [];
        const [t] = await tx`select id, email, role, status, display_name, activated_at from app.users where id = ${id} for update`;
        if (!t) throw E.notFound();
        const next = { role: body.role ?? t.role, status: body.status ?? t.status, displayName: body.displayName ?? t.display_name };
        if (body.status && body.status !== t.status) {
          if (id === admin.id) throw E.conflict('Você não pode suspender ou reativar a si mesmo.');
          if (body.status === 'active' && t.activated_at === null) throw E.conflict('Este usuário ainda não aceitou o convite. Reenvie o convite em vez de reativar.');
        }
        if (t.role === 'admin' && t.status === 'active' && (next.role !== 'admin' || next.status !== 'active') && !admins.some((a) => a.id !== t.id)) {
          throw E.conflict('Não é possível remover o último administrador ativo.');
        }
        await tx`update app.users set role = ${next.role}, status = ${next.status}, display_name = ${next.displayName} where id = ${id}`;
        const meta = { fields: Object.keys(body) };
        if (next.role !== t.role) { meta.role_from = t.role; meta.role_to = next.role; }
        if (next.status !== t.status) { meta.status_from = t.status; meta.status_to = next.status; }
        await audit(tx, c, 'user.update', 'user', id, meta);
        return { user: { id, email: t.email, displayName: next.displayName, role: next.role, status: next.status }, statusChanged: next.status !== t.status };
      });
    } catch (e) {
      if (e && e.code === '23514' && /último administrador/.test(e.message || '')) throw E.conflict('Não é possível remover o último administrador ativo.');   // rede de segurança do gatilho do banco
      throw e;
    }
    kit.cache.invalidateUser(id);   // vale já nesta instância; nas outras, em ≤ 15 s (TTL do cache)
    let gotrueSync = true;
    if (out.statusChanged) {
      gotrueSync = await syncBan(out.user.email, out.user.status === 'suspended');
      if (!gotrueSync) await bestEffort(() => db.asUser(admin.id, (tx) => audit(tx, c, 'user.gotrue_sync_failed', 'user', id, { status: out.user.status })));
    }
    return c.json({ ...out.user, gotrueSync });
  });

  // ------------------------------------------------------------------------------------------------ convites
  r.post('/invites', async (c) => {
    const admin = requireAdmin(c);
    const { email, displayName, role } = await readJson(c, InviteBody);
    if (!domainAllowed(email)) throw E.badRequest('Este domínio de e-mail não está autorizado a receber convites.', { fields: [{ path: 'email', message: 'Domínio não permitido.' }] });
    await limit(c, 'admin_invite', admin.id, 3600, 300);   // 300 convites/h por admin (API.md §2): onboarding de uma equipe inteira em uma sessão
    let unban = false;
    const out = await db.asUser(admin.id, async (tx) => {
      const days = await inviteTtlDays(tx);
      const [ex] = await tx`select id, status, activated_at from app.users where email = ${email} for update`;
      let userId;
      if (ex) {
        // só dá para convidar de novo quem NUNCA entrou (convite revogado/expirado). Quem já foi ativo é reativado em PATCH /users/:id.
        if (ex.activated_at !== null || !['invited', 'suspended'].includes(ex.status)) throw E.exists('Já existe um usuário com este e-mail.');
        const [pend] = await tx`select id from app.invites where user_id = ${ex.id} and status = 'pending'`;
        if (pend) throw E.exists('Já existe um convite pendente para este e-mail. Reenvie-o.');
        await tx`update app.users set status = 'invited', role = ${role}, display_name = ${displayName} where id = ${ex.id}`;
        userId = ex.id; unban = true;
      } else {
        const [u] = await tx`insert into app.users(email, display_name, role, status, invited_by) values (${email}, ${displayName}, ${role}, 'invited', ${admin.id}) returning id`;
        userId = u.id;
      }
      const [inv] = await tx`insert into app.invites(email, user_id, role, invited_by, expires_at) values (${email}, ${userId}, ${role}, ${admin.id}, now() + make_interval(days => ${days})) returning id, expires_at`;
      await audit(tx, c, 'invite.create', 'invite', inv.id, { role, user_id: userId, email_hash: kit.hashEmail(email) });
      if (unban) await syncBan(email, false);              // reconvite após revogação: libera o login no GoTrue
      await sendInviteMail(email, displayName);            // se falhar, a transação inteira é desfeita (nenhum convite fantasma)
      return { id: inv.id, userId, email, status: 'pending', role, expiresAt: inv.expires_at };
    });
    return c.json(out, 201);
  });

  r.post('/invites/:id/resend', async (c) => {
    const admin = requireAdmin(c); const id = uuidParam(c);
    await limit(c, 'admin_invite', admin.id, 3600, 300);   // 300 convites/h por admin (API.md §2): onboarding de uma equipe inteira em uma sessão
    const out = await db.asUser(admin.id, async (tx) => {
      const [inv] = await tx`select id, email, user_id, status, resent_count from app.invites where id = ${id} for update`;
      if (!inv) throw E.notFound();
      if (!['pending', 'expired'].includes(inv.status)) throw E.conflict('Este convite não pode ser reenviado.');
      if (inv.resent_count >= 5) throw E.conflict('Limite de 5 reenvios atingido para este convite.');
      const [u] = await tx`select display_name, status from app.users where id = ${inv.user_id}`;
      if (!u || u.status !== 'invited') throw E.conflict('Este usuário não está mais aguardando convite.');
      const days = await inviteTtlDays(tx);
      const [n] = await tx`update app.invites set status = 'pending', resent_count = resent_count + 1, expires_at = now() + make_interval(days => ${days}) where id = ${id} returning resent_count, expires_at`;
      await audit(tx, c, 'invite.resend', 'invite', id, { resent_count: n.resent_count });
      await sendInviteMail(inv.email, u.display_name);
      return { id, status: 'pending', resentCount: n.resent_count, expiresAt: n.expires_at };
    });
    return c.json(out);
  });

  r.delete('/invites/:id', async (c) => {
    const admin = requireAdmin(c); const id = uuidParam(c);
    const out = await db.asUser(admin.id, async (tx) => {
      const [inv] = await tx`select id, email, user_id, status from app.invites where id = ${id} for update`;
      if (!inv) throw E.notFound();
      if (inv.status === 'revoked') return { already: true };
      if (!['pending', 'expired'].includes(inv.status)) throw E.conflict('Este convite já foi aceito e não pode ser revogado. Suspenda o usuário.');
      await tx`update app.invites set status = 'revoked' where id = ${id}`;
      // quem nunca entrou fica SUSPENSO: assim o link do e-mail deixa de servir (resolve_identity só vincula convidados/ativos)
      await tx`update app.users set status = 'suspended' where id = ${inv.user_id} and status = 'invited' and activated_at is null`;
      await audit(tx, c, 'invite.revoke', 'invite', id, { user_id: inv.user_id });
      return { email: inv.email, userId: inv.user_id };
    });
    if (!out.already) {
      kit.cache.invalidateUser(out.userId);
      const ok = await syncBan(out.email, true);
      if (!ok) await bestEffort(() => db.asUser(admin.id, (tx) => audit(tx, c, 'user.gotrue_sync_failed', 'invite', id, { op: 'revoke' })));
    }
    return c.body(null, 204);
  });

  // ------------------------------------------------------------------------------------------------ auditoria
  r.get('/audit', async (c) => {
    const admin = requireAdmin(c);
    const q = AuditQuery.parse(c.req.query());
    const cur = q.cursor === undefined ? null : (/^\d{1,18}$/.test(q.cursor) ? q.cursor : (() => { throw E.badRequest('Cursor inválido.'); })());
    const prefix = q.action && q.action.endsWith('*') ? likeEscape(q.action.slice(0, -1)) + '%' : null;
    const rows = await db.asUser(admin.id, (tx) => tx`
      select a.id, a.at, a.actor_id, u.display_name as actor_name, a.action, a.entity_type, a.entity_id, host(a.ip) as ip, a.user_agent, a.request_id, a.meta
        from app.audit_log a left join app.users u on u.id = a.actor_id
       where true
         ${q.actor ? tx`and a.actor_id = ${q.actor}` : tx``}
         ${q.action ? (prefix ? tx`and a.action like ${prefix}` : tx`and a.action = ${q.action}`) : tx``}
         ${q.from ? tx`and a.at >= ${q.from}::timestamptz` : tx``}
         ${q.to ? tx`and a.at < ${q.to}::timestamptz` : tx``}
         ${cur ? tx`and a.id < ${cur}::bigint` : tx``}
       order by a.id desc
       limit ${q.limit + 1}`);
    const page = rows.slice(0, q.limit);
    return c.json({
      items: page.map((a) => ({ id: String(a.id), at: a.at, actor: a.actor_id ? { id: a.actor_id, displayName: a.actor_name } : null, action: a.action, entityType: a.entity_type, entityId: a.entity_id, ip: a.ip, userAgent: a.user_agent, requestId: a.request_id, meta: a.meta })),
      nextCursor: rows.length > q.limit ? String(page[page.length - 1].id) : null,
    });
  });

  // ------------------------------------------------------------------------------------------------ configurações e estatísticas
  r.get('/settings', async (c) => {
    const admin = requireAdmin(c);
    const rows = await db.asUser(admin.id, (tx) => tx`select key, value, updated_at from app.settings where key in ${tx(SETTING_KEYS)} order by key`);
    return c.json({ items: rows.map((s) => ({ key: s.key, value: s.value, updatedAt: s.updated_at })) });
  });
  r.put('/settings/:key', async (c) => {
    const admin = requireAdmin(c); const key = c.req.param('key');
    if (!Object.hasOwn(SETTINGS, key)) throw E.notFound('Configuração desconhecida.');
    const { value: raw } = await readJson(c, SettingBody);
    const parsed = SETTINGS[key].safeParse(raw);
    if (!parsed.success) throw E.badRequest('Valor inválido para esta configuração.', { fields: [{ path: 'value', message: parsed.error.issues[0]?.message || 'Valor inválido.' }] });
    const row = await db.asUser(admin.id, async (tx) => {
      const [s] = await tx`update app.settings set value = ${tx.json(parsed.data)}, updated_at = now(), updated_by = ${admin.id} where key = ${key} returning key, value, updated_at`;
      if (!s) throw E.notFound('Configuração desconhecida.');
      await audit(tx, c, 'settings.update', 'setting', key, { value: parsed.data });
      return s;
    });
    return c.json({ key: row.key, value: row.value, updatedAt: row.updated_at });
  });

  r.get('/stats', async (c) => {
    const admin = requireAdmin(c);
    const out = await db.asUser(admin.id, async (tx) => {
      const [u] = await tx`select count(*)::int total, count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'invited')::int invited, count(*) filter (where status = 'suspended')::int suspended, count(*) filter (where role = 'admin' and status = 'active')::int admins from app.users`;
      const [p] = await tx`select count(*) filter (where deleted_at is null)::int live, count(*) filter (where deleted_at is not null)::int trashed from app.presentations`;
      const [a] = await tx`select count(*)::int n, coalesce(sum(size_bytes), 0)::text bytes from app.assets where status = 'ready'`;
      const [i] = await tx`select count(*)::int pending from app.invites where status = 'pending'`;
      return { users: u, presentations: p, assets: { count: a.n, bytes: Number(a.bytes) }, invites: { pending: i.pending } };
    });
    return c.json(out);
  });
  return r;
}
