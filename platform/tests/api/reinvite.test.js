/* Reconvite em lote (tools/reinvite.js): depois de perder as contas do login, quem está em app.users recebe convite novo e entra na MESMA conta.
   Pilha real (boot: API + Postgres com RLS + GoTrue falso). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot.js';
import { reinvite, parseArgs, maskEmail, main as cliMain } from '../../tools/reinvite.js';
import { createGoTrue } from '../../src/auth/gotrue.js';

let t, gotrue, lost, lostInvited, keeper, suspended, pres;
const silent = () => {};
const q = (fn) => t.ops.asSystem(fn);
const mail = (email) => t.fake.outbox(email).filter((m) => m.type === 'invite').at(-1);

before(async () => {
  t = await boot(); gotrue = createGoTrue(t.config);
  // contas do login "perdidas": existem em app.users, mas não no Auth
  lost = await t.createUser({ displayName: 'Perdida Ativa', inGoTrue: false });
  lostInvited = await t.createUser({ status: 'invited', displayName: 'Convidada Vencida', inGoTrue: false });
  await q((tx) => tx`insert into app.invites(email, user_id, role, status, expires_at) values (${lostInvited.email}, ${lostInvited.id}, 'member', 'expired', now() - interval '3 days')`);
  keeper = await t.createUser({ displayName: 'Tem Conta' });
  suspended = await t.createUser({ status: 'suspended', displayName: 'Suspensa', inGoTrue: false });
  [pres] = await q((tx) => tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count) values (${lost.id}, 'Obra da perdida', '{"slides":[]}'::jsonb, ${'a'.repeat(64)}, 0) returning id`);
});
after(async () => { await t.stop(); });

describe('reconvite em lote', () => {
  test('argumentos: simulação por padrão; valores inválidos recusados; e-mail mascarado', () => {
    assert.deepEqual(parseArgs([]), { apply: false, status: 'all', limit: 0, delayMs: 1000 });
    assert.equal(parseArgs(['--apply', '--status', 'invited', '--limit', '5', '--delay-ms', '0']).apply, true);
    for (const bad of [['--status', 'x'], ['--limit', '-1'], ['--delay-ms', 'a'], ['--outro'], ['--limit']]) assert.throws(() => parseArgs(bad));
    assert.equal(maskEmail('fulano@empresa.com'), 'f***@empresa.com');
  });
  test('simulação: conta quem seria convidado e não envia nada', async () => {
    t.fake.clearOutbox(); const logs = [];
    const r = await reinvite({ delayMs: 0 }, { ops: t.ops, gotrue, log: (m) => logs.push(m) });
    assert.equal(r.dryRun, true); assert.equal(r.sent, 2, JSON.stringify(r)); assert.ok(r.skippedHasAccount >= 1);
    assert.equal(t.fake.outbox().length, 0, 'nenhum e-mail na simulação');
    assert.ok(logs.every((l) => !l.includes(lost.email)), 'e-mails nunca aparecem por inteiro');
  });
  test('--apply: convida só quem não tem conta (ativo e convidado vencido); renova o convite; não toca em suspensos nem em quem já tem conta', async () => {
    t.fake.clearOutbox();
    const r = await reinvite({ apply: true, delayMs: 0 }, { ops: t.ops, gotrue, log: silent });
    assert.equal(r.sent, 2, JSON.stringify(r)); assert.equal(r.failed, 0);
    assert.ok(mail(lost.email)); assert.ok(mail(lostInvited.email));
    assert.equal(t.fake.outbox(keeper.email).length, 0); assert.equal(t.fake.outbox(suspended.email).length, 0);
    const [inv] = await q((tx) => tx`select count(*)::int n from app.invites where user_id = ${lostInvited.id} and status = 'pending' and expires_at > now()`);
    assert.equal(inv.n, 1, 'convidado ganhou convite pendente dentro do prazo');
    const au = await q((tx) => tx`select meta from app.audit_log where action = 'invite.resend' and entity_id in (${lost.id}, ${lostInvited.id})`);
    assert.equal(au.length, 2); assert.ok(au.every((a) => a.meta.bulk === true));
    const again = await reinvite({ apply: true, delayMs: 0 }, { ops: t.ops, gotrue, log: silent });
    assert.equal(again.sent, 0, 'rodar de novo não reenvia: o convite criou a conta no Auth');
  });
  test('pelo link do convite a pessoa define a senha e entra na MESMA conta (papel e apresentações preservados)', async () => {
    for (const u of [lost, lostInvited]) {
      const c = t.anon(); await c.ensureCsrf();
      const v = await c.post('/api/auth/verify', { tokenHash: mail(u.email).token_hash, type: 'invite' }); assert.equal(v.status, 200, v.text); assert.equal(v.json.needsPassword, true);
      const p = await c.post('/api/auth/password', { password: 'Senha-Nova-Bem-Forte-42!' }); assert.equal(p.status, 200, p.text);
      const s = await c.get('/api/auth/session'); assert.equal(s.json.user.id, u.id, 'mesma conta'); assert.equal(s.json.user.status, 'active');
    }
    const c = await t.as({ ...lost, password: 'Senha-Nova-Bem-Forte-42!' }, { fresh: true });
    assert.equal((await c.get(`/api/presentations/${pres.id}`)).json.owner.id, lost.id, 'as apresentações continuam dela');
  });
  test('limite de e-mails do provedor (429) para o lote, diz quantas faltam e não deixa convite renovado sem e-mail', async () => {
    const late = await t.createUser({ status: 'invited', displayName: 'Atrasada', inGoTrue: false });
    t.fake.state.fail.invite = 429;
    try {
      const r = await reinvite({ apply: true, status: 'invited', delayMs: 0 }, { ops: t.ops, gotrue, log: silent });
      assert.equal(r.stoppedByRateLimit, true); assert.ok(r.remaining >= 1); assert.equal(r.sent, 0);
      assert.equal((await q((tx) => tx`select count(*)::int n from app.invites where user_id = ${late.id}`))[0].n, 0, 'a transação desfez o convite');
    } finally { t.fake.state.fail.invite = 0; }
  });
  test('CLI: ajuda, variáveis obrigatórias e argumento inválido', async () => {
    const err = console.error, out = console.log; console.error = () => {}; console.log = () => {};
    try {
      assert.equal(await cliMain(['--help'], {}), 0);
      assert.equal(await cliMain([], {}), 2);
      assert.equal(await cliMain(['--status', 'x'], {}), 2);
    } finally { console.error = err; console.log = out; }
  });
});
