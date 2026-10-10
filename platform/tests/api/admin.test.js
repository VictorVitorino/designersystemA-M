/* Administração: só admin (membro → 403 em tudo), convites com rollback, reenvio/revogação, papel/suspensão com proteção do último admin, auditoria, configurações, estatísticas, 1º admin. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';
import { createFirstAdmin, main as cliMain, parseArgs } from '../../tools/create-first-admin.js';
import { createGoTrue } from '../../src/auth/gotrue.js';
import { OPS_URL } from '../db/helpers.js';

let t, adm, admC, member, memC;
before(async () => {
  t = await boot(); adm = await t.createUser({ role: 'admin', displayName: 'Admin Um' }); member = await t.createUser({ displayName: 'Membro' });
  admC = await t.as(adm); memC = await t.as(member);
});
after(async () => { await t.stop(); });

const UUID0 = '00000000-0000-4000-8000-000000000000';
const q = (sql) => t.ops.asSystem(sql);
const inviteId = async (email) => (await q((tx) => tx`select id from app.invites where email = ${email} order by created_at desc`))[0]?.id;
const mail = (email, type = 'invite') => t.fake.outbox(email).filter((m) => m.type === type).at(-1);

describe('controle de acesso', () => {
  const endpoints = [
    ['GET', '/api/admin/users'], ['POST', '/api/admin/invites', { email: 'x@am.test', displayName: 'X' }], ['POST', `/api/admin/invites/${UUID0}/resend`], ['DELETE', `/api/admin/invites/${UUID0}`],
    ['PATCH', `/api/admin/users/${UUID0}`, { role: 'admin' }], ['GET', '/api/admin/audit'], ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings/invites.ttl_days', { value: 3 }],
    ['GET', '/api/admin/stats'], ['GET', '/api/admin/nao-existe'], ['POST', '/api/admin'],
  ];
  test('membro recebe 403 em TUDO (e nada é criado)', async () => {
    for (const [m, p, body] of endpoints) { const r = await memC.request(m, p, { json: body }); assert.equal(r.status, 403, `${m} ${p}`); assert.equal(r.json.error.code, 'forbidden'); }
    assert.equal((await q((tx) => tx`select count(*)::int n from app.users where email = 'x@am.test'`))[0].n, 0);
  });
  test('sem login: 401 em tudo', async () => {
    const c = t.anon(); await c.ensureCsrf();
    for (const [m, p, body] of endpoints) assert.equal((await c.request(m, p, { json: body })).status, 401, `${m} ${p}`);
  });
  test('membro não vira admin por truque: PATCH no próprio papel, cabeçalhos e corpo forjados', async () => {
    assert.equal((await memC.patch(`/api/admin/users/${member.id}`, { role: 'admin' })).status, 403);
    assert.equal((await memC.patch('/api/me', { role: 'admin' })).status, 400);
    assert.equal((await memC.request('GET', '/api/admin/users', { headers: { 'x-user-role': 'admin', 'x-admin': '1' } })).status, 403);
    assert.equal((await q((tx) => tx`select role from app.users where id = ${member.id}`))[0].role, 'member');
  });
  test('respostas do admin nunca vão para cache', async () => {
    const r = await admC.get('/api/admin/stats'); assert.equal(r.headers.get('cache-control'), 'no-store');
  });
});

describe('convites', () => {
  test('cria usuário invited + convite pendente + e-mail; auditoria sem e-mail em claro', async () => {
    const email = 'nova.pessoa@am.test';
    const r = await admC.post('/api/admin/invites', { email: ' Nova.Pessoa@AM.test ', displayName: 'Nova Pessoa', role: 'member' });
    assert.equal(r.status, 201, r.text); assert.equal(r.json.status, 'pending'); assert.equal(r.json.email, email); assert.ok(r.json.id && r.json.expiresAt);
    const [u] = await q((tx) => tx`select status, role, invited_by from app.users where email = ${email}`); assert.deepEqual([u.status, u.role, u.invited_by], ['invited', 'member', adm.id]);
    const [i] = await q((tx) => tx`select status, user_id from app.invites where id = ${r.json.id}`); assert.equal(i.status, 'pending');
    assert.ok(mail(email));
    const [a] = await q((tx) => tx`select actor_id, meta, entity_id from app.audit_log where action = 'invite.create' and entity_id = ${r.json.id}`);
    assert.equal(a.actor_id, adm.id); assert.ok(!JSON.stringify(a).includes('nova.pessoa'), 'e-mail em claro na auditoria'); assert.equal(a.meta.email_hash, t.kit.hashEmail(email));
  });
  test('convidar admin e respeitar validade configurada (invites.ttl_days)', async () => {
    assert.equal((await admC.put('/api/admin/settings/invites.ttl_days', { value: 2 })).status, 200);
    const r = await admC.post('/api/admin/invites', { email: 'futuro.admin@am.test', displayName: 'Futuro', role: 'admin' });
    assert.equal(r.status, 201); assert.equal(r.json.role, 'admin');
    const days = (new Date(r.json.expiresAt) - Date.now()) / 86400000; assert.ok(days > 1.9 && days < 2.1, String(days));
    await admC.put('/api/admin/settings/invites.ttl_days', { value: 7 });
  });
  test('duplicado: 409 (convite pendente, usuário ativo, e-mail em maiúsculas)', async () => {
    await admC.post('/api/admin/invites', { email: 'dup@am.test', displayName: 'Dup' });
    for (const email of ['dup@am.test', 'DUP@am.test', member.email, adm.email]) { const r = await admC.post('/api/admin/invites', { email, displayName: 'Outro' }); assert.equal(r.status, 409, email); assert.equal(r.json.error.code, 'already_exists'); }
    assert.equal((await q((tx) => tx`select count(*)::int n from app.invites where email = 'dup@am.test'`))[0].n, 1);
  });
  test('entradas inválidas → 400; papel desconhecido; campos extras; HTML no nome', async () => {
    for (const body of [{}, { email: 'x', displayName: 'X' }, { email: 'a@am.test' }, { email: 'a@am.test', displayName: '<img src=x onerror=1>' }, { email: 'a@am.test', displayName: 'A', role: 'superadmin' },
      { email: 'a@am.test', displayName: 'A', status: 'active' }, { email: "a@am.test'; drop table app.users;--", displayName: 'A' }]) {
      assert.equal((await admC.post('/api/admin/invites', body)).status, 400, JSON.stringify(body));
    }
  });
  test('INVITE_ALLOWED_DOMAINS: domínio fora da lista é recusado, subdomínio parecido também', async () => {
    t.config.inviteDomains.push('alvarezandmarsal.com');
    try {
      for (const email of ['a@gmail.com', 'a@evil.alvarezandmarsal.com', 'a@alvarezandmarsal.com.evil.io', 'a@xalvarezandmarsal.com']) {
        const r = await admC.post('/api/admin/invites', { email, displayName: 'A' }); assert.equal(r.status, 400, email); assert.equal(r.json.error.details.fields[0].path, 'email');
      }
      assert.equal((await admC.post('/api/admin/invites', { email: 'ok@alvarezandmarsal.com', displayName: 'Ok' })).status, 201);
    } finally { t.config.inviteDomains.length = 0; }
  });
  test('GoTrue falhou → rollback: nenhum usuário/convite fantasma, 503', async () => {
    const email = 'rollback@am.test'; t.fake.state.fail.invite = 500;
    try { const r = await admC.post('/api/admin/invites', { email, displayName: 'Rollback' }); assert.equal(r.status, 503); assert.equal(r.json.error.code, 'unavailable'); }
    finally { t.fake.state.fail.invite = 0; }
    assert.equal((await q((tx) => tx`select (select count(*) from app.users where email = ${email})::int + (select count(*) from app.invites where email = ${email})::int n`))[0].n, 0);
    assert.equal((await q((tx) => tx`select count(*)::int n from app.audit_log where action = 'invite.create' and meta->>'email_hash' = ${t.kit.hashEmail(email)}`))[0].n, 0);
    assert.equal((await admC.post('/api/admin/invites', { email, displayName: 'Rollback' })).status, 201, 'e depois consegue convidar normalmente');
  });
  test('conta já existe no GoTrue (confirmada) mas não no app: convite vira e-mail de recuperação', async () => {
    const email = 'orfa@am.test'; t.fake.addUser({ email, password: 'qualquer-senha-0000' });
    const r = await admC.post('/api/admin/invites', { email, displayName: 'Órfã' }); assert.equal(r.status, 201, r.text);
    assert.ok(mail(email, 'recovery'));
  });

  test('reenviar: contador sobe, novo e-mail, limite de 5, não vale para aceito/desconhecido', async () => {
    const email = 'reenvio@am.test'; const inv = (await admC.post('/api/admin/invites', { email, displayName: 'Reenvio' })).json;
    const first = mail(email).token_hash;
    for (let n = 1; n <= 5; n++) { const r = await admC.post(`/api/admin/invites/${inv.id}/resend`); assert.equal(r.status, 200, r.text); assert.equal(r.json.resentCount, n); }
    assert.notEqual(mail(email).token_hash, first);
    const six = await admC.post(`/api/admin/invites/${inv.id}/resend`); assert.equal(six.status, 409);
    assert.equal((await admC.post(`/api/admin/invites/${UUID0}/resend`)).status, 404);
    assert.equal((await admC.post('/api/admin/invites/nao-e-uuid/resend')).status, 404);
    assert.equal((await q((tx) => tx`select resent_count from app.invites where id = ${inv.id}`))[0].resent_count, 5);
  });
  test('reenvio para convite aceito → 409', async () => {
    const email = 'aceito@am.test'; await admC.post('/api/admin/invites', { email, displayName: 'Aceito' });
    const c = t.anon(); await c.ensureCsrf(); await c.post('/api/auth/verify', { tokenHash: mail(email).token_hash, type: 'invite' }); await c.post('/api/auth/password', { password: 'Cavalo-Bateria-Grampo-1!' });
    assert.equal((await admC.post(`/api/admin/invites/${await inviteId(email)}/resend`)).status, 409);
    assert.equal((await admC.del(`/api/admin/invites/${await inviteId(email)}`)).status, 409, 'convite aceito não se revoga (suspende-se o usuário)');
  });
  test('revogar: 204, link morre (GoTrue bloqueado + banco), pode convidar de novo', async () => {
    const email = 'revogada@am.test'; const inv = (await admC.post('/api/admin/invites', { email, displayName: 'Revogada' })).json; const link = mail(email);
    const r = await admC.del(`/api/admin/invites/${inv.id}`); assert.equal(r.status, 204);
    assert.equal((await q((tx) => tx`select status from app.invites where id = ${inv.id}`))[0].status, 'revoked');
    assert.equal((await q((tx) => tx`select status from app.users where email = ${email}`))[0].status, 'suspended');
    assert.equal(t.fake.isBanned(t.fake.userByEmail(email).id), true, 'banida no GoTrue');
    const c = t.anon(); await c.ensureCsrf(); assert.equal((await c.post('/api/auth/verify', { tokenHash: link.token_hash, type: 'invite' })).status, 410);
    assert.equal((await admC.del(`/api/admin/invites/${inv.id}`)).status, 204, 'idempotente');
    // convidar de novo (nunca entrou): reativa como invited e desbloqueia no GoTrue
    const again = await admC.post('/api/admin/invites', { email, displayName: 'Revogada 2' }); assert.equal(again.status, 201, again.text);
    assert.equal(t.fake.isBanned(t.fake.userByEmail(email).id), false);
    const c2 = t.anon(); await c2.ensureCsrf(); assert.equal((await c2.post('/api/auth/verify', { tokenHash: mail(email).token_hash, type: 'invite' })).status, 200);
    assert.equal((await admC.del(`/api/admin/invites/${UUID0}`)).status, 404);
  });
  test('revogar mesmo com o GoTrue fora do ar: o banco já barra e a falha de sincronização é auditada', async () => {
    const email = 'revoga.offline@am.test'; const inv = (await admC.post('/api/admin/invites', { email, displayName: 'Offline' })).json; const link = mail(email);
    t.fake.state.fail.admin = 500;
    try { assert.equal((await admC.del(`/api/admin/invites/${inv.id}`)).status, 204); } finally { t.fake.state.fail.admin = 0; }
    const c = t.anon(); await c.ensureCsrf(); const v = await c.post('/api/auth/verify', { tokenHash: link.token_hash, type: 'invite' });
    assert.equal(v.status, 403, 'link ainda válido no GoTrue, mas o banco recusa (suspenso → não vincula identidade)'); assert.equal(v.json.error.code, 'not_invited');
    assert.ok((await q((tx) => tx`select count(*)::int n from app.audit_log where action = 'user.gotrue_sync_failed'`))[0].n >= 1);
  });
});

describe('usuários', () => {
  test('lista: filtros, busca segura, paginação por cursor, dados de convite', async () => {
    const mk = []; for (let i = 0; i < 5; i++) mk.push(await t.createUser({ displayName: `Lista ${i}` }));
    const all = []; let cursor = null;
    do { const r = await admC.get(`/api/admin/users?limit=3${cursor ? '&cursor=' + cursor : ''}`); assert.equal(r.status, 200); all.push(...r.json.items); cursor = r.json.nextCursor; } while (cursor);
    const total = (await q((tx) => tx`select count(*)::int n from app.users`))[0].n;
    assert.equal(all.length, total); assert.equal(new Set(all.map((u) => u.id)).size, total, 'sem repetição entre páginas');
    assert.ok(all.every((u, i) => i === 0 || all[i - 1].createdAt >= u.createdAt), 'ordenado por criação decrescente');
    const inv = await admC.get('/api/admin/users?status=invited'); assert.ok(inv.json.items.length > 0 && inv.json.items.every((u) => u.status === 'invited' && u.invite && u.invite.id));
    const s = await admC.get('/api/admin/users?q=' + encodeURIComponent('Lista 3')); assert.equal(s.json.items.length, 1); assert.equal(s.json.items[0].displayName, 'Lista 3');
    for (const evil of ["' OR 1=1 --", '%', '_', '\\', "'; drop table app.users; --"]) { const r = await admC.get('/api/admin/users?q=' + encodeURIComponent(evil)); assert.equal(r.status, 200, evil); assert.equal(r.json.items.length, 0, evil); }
    for (const bad of ['?limit=0', '?limit=1000', '?status=hacker', '?cursor=@@@', '?cursor=' + Buffer.from('["x","y"]').toString('base64url'), '?foo=1']) assert.equal((await admC.get('/api/admin/users' + bad)).status, 400, bad);
    assert.ok(!JSON.stringify(all).match(/password|token|senha/i));
  });

  test('alterar papel e nome; auditoria guarda de/para', async () => {
    const u = await t.createUser({ displayName: 'Promovida' });
    const r = await admC.patch(`/api/admin/users/${u.id}`, { role: 'admin', displayName: 'Promovida Admin' });
    assert.equal(r.status, 200, r.text); assert.deepEqual([r.json.role, r.json.displayName, r.json.status], ['admin', 'Promovida Admin', 'active']);
    const [a] = await q((tx) => tx`select meta from app.audit_log where action = 'user.update' and entity_id = ${u.id} order by id desc`); assert.deepEqual([a.meta.role_from, a.meta.role_to], ['member', 'admin']);
    assert.equal((await (await t.as(u)).get('/api/admin/stats')).status, 200, 'nova admin já acessa o painel');
    await admC.patch(`/api/admin/users/${u.id}`, { role: 'member' });
  });
  test('validações: campo extra, vazio, status inválido (invited), id inválido/inexistente', async () => {
    const u = await t.createUser();
    for (const body of [{}, { email: 'novo@am.test' }, { status: 'invited' }, { role: 'root' }, { status: 'deleted' }, { displayName: '<b>x</b>' }]) assert.equal((await admC.patch(`/api/admin/users/${u.id}`, body)).status, 400, JSON.stringify(body));
    assert.equal((await admC.patch(`/api/admin/users/${UUID0}`, { role: 'member' })).status, 404);
    assert.equal((await admC.patch('/api/admin/users/abc', { role: 'member' })).status, 404);
  });
  test('último administrador é protegido (409) e ninguém suspende a si mesmo', async () => {
    const others = (await q((tx) => tx`select id from app.users where role = 'admin' and status = 'active' and id <> ${adm.id}`)).map((r) => r.id);
    if (others.length) await q((tx) => tx`update app.users set status = 'suspended' where id = any(${others}::uuid[])`);
    try {
      const r = await admC.patch(`/api/admin/users/${adm.id}`, { role: 'member' });
      assert.equal(r.status, 409, r.text); assert.match(r.json.error.message, /último administrador/);
      assert.equal((await admC.patch(`/api/admin/users/${adm.id}`, { status: 'suspended' })).status, 409);
      assert.equal((await q((tx) => tx`select role, status from app.users where id = ${adm.id}`))[0].role, 'admin');
    } finally { if (others.length) await q((tx) => tx`update app.users set status = 'active' where id = any(${others}::uuid[])`); }
    // com dois admins: pode rebaixar o outro, e então o que sobrou é o último
    const b = await t.createUser({ role: 'admin' });
    assert.equal((await admC.patch(`/api/admin/users/${b.id}`, { role: 'member' })).status, 200);
  });

  test('dois admins se rebaixando ao mesmo tempo: ao menos um continua admin (sem corrida)', async () => {
    const a = await t.createUser({ role: 'admin' }), b = await t.createUser({ role: 'admin' });
    const [ca, cb] = [await t.as(a), await t.as(b)];
    const others = (await q((tx) => tx`select id from app.users where role = 'admin' and status = 'active' and id not in (${a.id}, ${b.id})`)).map((r) => r.id);
    if (others.length) await q((tx) => tx`update app.users set status = 'suspended' where id = any(${others}::uuid[])`);
    try {
      const [r1, r2] = await Promise.all([ca.patch(`/api/admin/users/${b.id}`, { role: 'member' }), cb.patch(`/api/admin/users/${a.id}`, { role: 'member' })]);
      assert.ok([r1.status, r2.status].filter((s) => s === 200).length >= 1, `${r1.status}/${r2.status}`);
      assert.ok((await q((tx) => tx`select count(*)::int n from app.users where role = 'admin' and status = 'active' and id in (${a.id}, ${b.id})`))[0].n >= 1, 'ficou sem administrador');
    } finally { if (others.length) await q((tx) => tx`update app.users set status = 'active' where id = any(${others}::uuid[])`); }
  });

  test('suspender: vale na PRÓXIMA requisição, bane no GoTrue, impede refresh/login; reativar restaura', async () => {
    const u = await t.createUser({ displayName: 'Suspendível' }); const c = await t.as(u, { fresh: true });
    assert.equal((await c.get('/api/me')).status, 200);               // identidade entra no cache
    const r = await admC.patch(`/api/admin/users/${u.id}`, { status: 'suspended' }); assert.equal(r.status, 200, r.text); assert.deepEqual([r.json.status, r.json.gotrueSync], ['suspended', true]);
    const after = await c.get('/api/me'); assert.deepEqual([after.status, after.json.error.code], [403, 'suspended']);
    assert.equal(t.fake.isBanned(t.fake.userByEmail(u.email).id), true);
    const rf = await c.post('/api/auth/refresh'); assert.ok([401, 403].includes(rf.status), String(rf.status));
    assert.equal((await t.anon().login(u.email, u.password)).status, 403);
    const s = await c.get('/api/auth/session'); assert.equal(s.json.authenticated, false);
    // reativar
    assert.equal((await admC.patch(`/api/admin/users/${u.id}`, { status: 'active' })).status, 200);
    assert.equal(t.fake.isBanned(t.fake.userByEmail(u.email).id), false);
    assert.equal((await t.anon().login(u.email, u.password)).status, 200);
  });
  test('suspender com GoTrue fora do ar: o banco vale, gotrueSync=false e fica auditado', async () => {
    const u = await t.createUser(); const c = await t.as(u, { fresh: true }); await c.get('/api/me');
    t.fake.state.fail.admin = 500;
    try { const r = await admC.patch(`/api/admin/users/${u.id}`, { status: 'suspended' }); assert.equal(r.status, 200); assert.equal(r.json.gotrueSync, false); }
    finally { t.fake.state.fail.admin = 0; }
    assert.equal((await c.get('/api/me')).status, 403);
    assert.ok((await q((tx) => tx`select count(*)::int n from app.audit_log where action = 'user.gotrue_sync_failed' and entity_id = ${u.id}`))[0].n >= 1);
  });
  test('não reativa por PATCH quem nunca aceitou o convite (409)', async () => {
    await admC.post('/api/admin/invites', { email: 'pendente.patch@am.test', displayName: 'Pendente' });
    const [u] = await q((tx) => tx`select id from app.users where email = 'pendente.patch@am.test'`);
    assert.equal((await admC.patch(`/api/admin/users/${u.id}`, { status: 'active' })).status, 409);
    assert.equal((await admC.patch(`/api/admin/users/${u.id}`, { role: 'admin' })).status, 200, 'papel do convidado pode mudar');
  });
});

describe('auditoria', () => {
  test('filtros: ator, ação exata, prefixo, datas', async () => {
    const byActor = await admC.get(`/api/admin/audit?actor=${adm.id}&limit=100`); assert.equal(byActor.status, 200);
    assert.ok(byActor.json.items.length > 0 && byActor.json.items.every((a) => a.actor.id === adm.id));
    const exact = await admC.get('/api/admin/audit?action=invite.create&limit=100'); assert.ok(exact.json.items.length > 0 && exact.json.items.every((a) => a.action === 'invite.create'));
    const prefix = await admC.get('/api/admin/audit?action=invite.*&limit=100'); const acts = new Set(prefix.json.items.map((a) => a.action));
    assert.ok(acts.has('invite.create') && acts.has('invite.resend') && acts.has('invite.revoke') && [...acts].every((a) => a.startsWith('invite.')), [...acts].join());
    const tomorrow = new Date(Date.now() + 86400000).toISOString(), yesterday = new Date(Date.now() - 86400000).toISOString();
    assert.equal((await admC.get(`/api/admin/audit?from=${encodeURIComponent(tomorrow)}`)).json.items.length, 0);
    assert.ok((await admC.get(`/api/admin/audit?from=${encodeURIComponent(yesterday)}&to=${encodeURIComponent(tomorrow)}`)).json.items.length > 0);
    assert.equal((await admC.get(`/api/admin/audit?to=${encodeURIComponent(yesterday)}`)).json.items.length, 0);
  });
  test('paginação por cursor percorre tudo sem repetir', async () => {
    const total = (await q((tx) => tx`select count(*)::int n from app.audit_log`))[0].n; const ids = []; let cursor = null, pages = 0;
    do { const r = await admC.get(`/api/admin/audit?limit=7${cursor ? '&cursor=' + cursor : ''}`); assert.equal(r.status, 200); ids.push(...r.json.items.map((a) => a.id)); cursor = r.json.nextCursor; pages++; } while (cursor);
    assert.equal(ids.length, total); assert.equal(new Set(ids).size, total); assert.ok(pages > 1);
    assert.ok(ids.every((id, i) => i === 0 || BigInt(ids[i - 1]) > BigInt(id)), 'ordem decrescente');
  });
  test('parâmetros maliciosos → 400 (nunca 500, nunca SQL)', async () => {
    for (const qs of ["action=' or 1=1 --", "actor=1' or '1'='1", 'cursor=1;drop table app.audit_log', 'cursor=abc', 'from=ontem', 'from=2026-13-45', 'to=2026-01-01T99:99', 'from=2026-02-30', 'limit=-1', 'limit=101', 'extra=1', "action=" + 'a'.repeat(100)]) {
      const r = await admC.get('/api/admin/audit?' + qs.replace(/ /g, '%20')); assert.equal(r.status, 400, qs);
    }
    assert.equal((await q((tx) => tx`select count(*)::int n from app.audit_log`))[0].n > 0, true);
    const badCur = Buffer.from(JSON.stringify(['9999-99-99 00:00:00', '00000000-0000-4000-8000-000000000000'])).toString('base64url');
    assert.equal((await admC.get('/api/admin/users?cursor=' + badCur)).status, 400, 'cursor de usuários com data impossível → 400');
  });
  test('trilha NÃO contém senha, token nem e-mail de falha', async () => {
    await t.anon().login('segredo.falha@am.test', 'SenhaQueNaoPodeVazar-1!');
    const all = JSON.stringify((await q((tx) => tx`select * from app.audit_log`)));
    for (const needle of ['SenhaQueNaoPodeVazar', t.DEFAULT_PASSWORD, 'segredo.falha@am.test', ...t.fake.outbox().map((m) => m.token_hash), 'access_token', 'refresh_token']) assert.ok(!all.includes(needle), `vazou: ${needle}`);
  });
});

describe('configurações e estatísticas', () => {
  test('lista só chaves conhecidas; altera com validação; audita', async () => {
    const g = await admC.get('/api/admin/settings'); assert.equal(g.status, 200);
    assert.deepEqual(g.json.items.map((i) => i.key).sort(), ['acervo.visibility', 'invites.ttl_days', 'uploads.max_bytes', 'versions.keep_daily_days', 'versions.keep_last']);
    const ok = await admC.put('/api/admin/settings/versions.keep_last', { value: 30 }); assert.equal(ok.status, 200); assert.equal(ok.json.value, 30);
    assert.equal((await admC.get('/api/admin/settings')).json.items.find((i) => i.key === 'versions.keep_last').value, 30);
    assert.ok((await q((tx) => tx`select count(*)::int n from app.audit_log where action = 'settings.update' and entity_id = 'versions.keep_last'`))[0].n >= 1);
    for (const [key, value] of [['versions.keep_last', 0], ['versions.keep_last', '30'], ['versions.keep_last', 1.5], ['uploads.max_bytes', 999999999999], ['invites.ttl_days', 365], ['acervo.visibility', 'public'], ['invites.ttl_days', null], ['invites.ttl_days', { x: 1 }]]) {
      assert.equal((await admC.put(`/api/admin/settings/${key}`, { value })).status, 400, `${key}=${JSON.stringify(value)}`);
    }
    for (const key of ['nao.existe', "x'; drop table app.settings;--", '..%2f..%2fetc', 'audit_log']) assert.equal((await admC.put(`/api/admin/settings/${encodeURIComponent(key)}`, { value: 1 })).status, 404, key);
    assert.equal((await admC.put('/api/admin/settings/versions.keep_last', { value: 30, extra: 1 })).status, 400);
    assert.equal((await admC.put('/api/admin/settings/versions.keep_last', {})).status, 400);
    await admC.put('/api/admin/settings/versions.keep_last', { value: 50 });
  });
  test('estatísticas batem com o banco', async () => {
    const r = await admC.get('/api/admin/stats'); assert.equal(r.status, 200);
    const [u] = await q((tx) => tx`select count(*)::int total, count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'invited')::int invited, count(*) filter (where status = 'suspended')::int suspended from app.users`);
    assert.deepEqual([r.json.users.total, r.json.users.active, r.json.users.invited, r.json.users.suspended], [u.total, u.active, u.invited, u.suspended]);
    assert.equal(typeof r.json.assets.bytes, 'number'); assert.equal(typeof r.json.presentations.live, 'number'); assert.equal(typeof r.json.invites.pending, 'number');
  });
});

describe('primeiro administrador (tools/create-first-admin.js)', () => {
  const silent = () => {};
  test('cria o convite, reenvia (idempotente) e, depois de ativo, não faz nada', async () => {
    const gotrue = createGoTrue(t.config); const email = 'primeiro.admin@am.test';
    const r1 = await createFirstAdmin({ email: 'Primeiro.Admin@AM.test', name: 'Primeiro Admin' }, { ops: t.ops, gotrue, log: silent });
    assert.equal(r1.action, 'created'); assert.ok(mail(email));
    const [u] = await q((tx) => tx`select role, status from app.users where email = ${email}`); assert.deepEqual([u.role, u.status], ['admin', 'invited']);
    const r2 = await createFirstAdmin({ email, name: 'Primeiro Admin' }, { ops: t.ops, gotrue, log: silent });
    assert.equal(r2.action, 'resent'); assert.equal((await q((tx) => tx`select count(*)::int n from app.invites where email = ${email}`))[0].n, 1);
    assert.equal((await q((tx) => tx`select resent_count from app.invites where email = ${email}`))[0].resent_count, 1);
    // o fluxo real: link → senha → painel de administração
    const c = t.anon(); await c.ensureCsrf(); assert.equal((await c.post('/api/auth/verify', { tokenHash: mail(email).token_hash, type: 'invite' })).status, 200);
    assert.equal((await c.post('/api/auth/password', { password: 'Primeiro-Admin-Senha-Forte-1!' })).status, 200);
    assert.equal((await c.get('/api/admin/stats')).status, 200);
    const n = t.fake.outbox(email).length;
    const r3 = await createFirstAdmin({ email, name: 'Primeiro Admin' }, { ops: t.ops, gotrue, log: silent });
    assert.equal(r3.action, 'already_admin'); assert.equal(t.fake.outbox(email).length, n, 'não reenviou e-mail');
  });
  test('não mexe em usuário comum existente; valida entradas; falha do GoTrue desfaz tudo', async () => {
    const gotrue = createGoTrue(t.config);
    assert.equal((await createFirstAdmin({ email: member.email, name: 'X' }, { ops: t.ops, gotrue, log: silent })).action, 'exists_other');
    assert.equal((await q((tx) => tx`select role from app.users where id = ${member.id}`))[0].role, 'member');
    await assert.rejects(() => createFirstAdmin({ email: 'sem-arroba', name: 'X' }, { ops: t.ops, gotrue, log: silent }), /e-mail inválido/);
    await assert.rejects(() => createFirstAdmin({ email: 'a@am.test', name: '' }, { ops: t.ops, gotrue, log: silent }), /nome inválido/);
    await assert.rejects(() => createFirstAdmin({ email: 'a@am.test', name: '<script>' }, { ops: t.ops, gotrue, log: silent }), /nome inválido/);
    t.fake.state.fail.invite = 500;
    try { await assert.rejects(() => createFirstAdmin({ email: 'falha.admin@am.test', name: 'Falha' }, { ops: t.ops, gotrue, log: silent })); } finally { t.fake.state.fail.invite = 0; }
    assert.equal((await q((tx) => tx`select count(*)::int n from app.users where email = 'falha.admin@am.test'`))[0].n, 0);
  });
  test('CLI: argumentos, ajuda, variáveis faltando e execução completa', async () => {
    assert.deepEqual(parseArgs(['--email', 'a@b.co', '--name=Fulano']), { email: 'a@b.co', name: 'Fulano' });
    assert.throws(() => parseArgs(['--senha', 'x']), /desconhecido/);
    const log = console.log, err = console.error; const out = []; console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
    try {
      assert.equal(await cliMain(['--help'], {}), 0);
      assert.equal(await cliMain([], {}), 2);
      assert.equal(await cliMain(['--email', 'x@am.test', '--name', 'X'], {}), 2);
      const env = { DATABASE_OPS_URL: OPS_URL, SUPABASE_URL: t.fake.url, SUPABASE_SERVICE_ROLE_KEY: t.fake.serviceKey };
      assert.equal(await cliMain(['--email', 'cli.admin@am.test', '--name', 'CLI Admin'], env), 0);
      assert.ok(mail('cli.admin@am.test'));
      assert.equal(await cliMain(['--email', 'invalido', '--name', 'X'], env), 1);
    } finally { console.log = log; console.error = err; }
    const printed = out.join('\n'); assert.ok(!printed.includes(t.fake.serviceKey) && !printed.includes('app_ops_test'), 'segredo impresso');
  });
});
