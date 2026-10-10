/* Isolamento e regras de permissão NO BANCO (Postgres real, RLS). Cada teste é uma regra do produto ou uma tentativa de ataque.
   Regra central: todos veem o acervo; só o dono (ou admin) altera; quem quer usar a de outro cria uma cópia. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup, mkUser, mkPres, attempt, hash64, API_URL } from './helpers.js';
import postgres from 'postgres';

let db, ops, A, B, C, ADM, SUSP;
before(async () => {
  ({ db, ops } = await setup());
  A = await mkUser(ops, { name: 'Ana' }); B = await mkUser(ops, { name: 'Bruno' }); C = await mkUser(ops, { name: 'Carla' });
  ADM = await mkUser(ops, { role: 'admin', name: 'Admin' }); SUSP = await mkUser(ops, { status: 'suspended', name: 'Suspenso' });
});
after(async () => { await db.end(); await ops.end(); });

describe('privilégio mínimo dos papéis', () => {
  test('a API (app_api) sem usuário não lê nenhuma tabela', async () => {
    for (const t of ['users', 'presentations', 'assets', 'comments', 'interactions', 'audit_log', 'invites', 'settings', 'rate_limits', 'user_identities']) {
      const r = await attempt(() => db.anon((tx) => tx.unsafe(`select 1 from app.${t} limit 1`)));
      assert.equal(r.ok, false, `app_api leu app.${t}`); assert.equal(r.code, '42501');
    }
  });
  test('o usuário não consegue virar app_system nem app_ops (sem escalada mesmo sob injeção de SQL)', async () => {
    for (const role of ['app_system', 'app_owner', 'postgres']) {
      const r = await attempt(() => db.asUser(A.id, (tx) => tx.unsafe(`set local role ${role}`)));
      assert.equal(r.ok, false, `escalou para ${role}`); assert.equal(r.code, '42501');
    }
  });
  test('app_api só executa as 3 funções pré-login (resolve_identity, hit_rate, audit)', async () => {
    const ok = await attempt(() => db.anon((tx) => tx`select * from app.hit_rate('t','k',60,5)`)); assert.equal(ok.ok, true);
    for (const fn of ["app.purge_expired()", "app.orphan_assets('1 day')", "app.prune_versions(gen_random_uuid(),1,1)"]) {
      const r = await attempt(() => db.anon((tx) => tx.unsafe(`select * from ${fn}`))); assert.equal(r.ok, false, fn); assert.equal(r.code, '42501');
    }
  });
  test('RLS ligada em todas as tabelas do schema app', async () => {
    const rows = await ops.sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r' and not c.relrowsecurity`;
    assert.deepEqual(rows.map((r) => r.relname), []);
  });
});

describe('acervo: todos veem, só o dono altera', () => {
  let P;
  before(async () => { P = await mkPres(db, A.id, 'Proposta da Ana'); });
  test('outro membro vê a apresentação no acervo', async () => {
    const r = await db.asUser(B.id, (tx) => tx`select id, title from app.presentations where id = ${P}`);
    assert.equal(r.length, 1); assert.equal(r[0].title, 'Proposta da Ana');
  });
  test('outro membro NÃO altera (0 linhas), NÃO exclui, NÃO move para a lixeira', async () => {
    const u = await db.asUser(B.id, (tx) => tx`update app.presentations set title = 'sequestrada' where id = ${P} returning id`); assert.equal(u.length, 0);
    const t = await db.asUser(B.id, (tx) => tx`update app.presentations set deleted_at = now() where id = ${P} returning id`); assert.equal(t.length, 0);
    const d = await db.asUser(B.id, (tx) => tx`delete from app.presentations where id = ${P} returning id`); assert.equal(d.length, 0);
    const [r] = await ops.asSystem((tx) => tx`select title, deleted_at from app.presentations where id = ${P}`); assert.equal(r.title, 'Proposta da Ana'); assert.equal(r.deleted_at, null);
  });
  test('o dono altera e o admin também', async () => {
    const a = await db.asUser(A.id, (tx) => tx`update app.presentations set title = 'Proposta v2', rev = rev + 1 where id = ${P} returning rev`); assert.equal(a.length, 1);
    const m = await db.asUser(ADM.id, (tx) => tx`update app.presentations set title = 'Proposta v3' where id = ${P} returning id`); assert.equal(m.length, 1);
  });
  test('ninguém cria apresentação em nome de outro (exceto admin)', async () => {
    const r = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.presentations(owner_id, title, content, content_hash) values (${A.id}, 'falsa', ${tx.json({})}, ${hash64()})`));
    assert.equal(r.ok, false); assert.equal(r.code, '42501');
    const okAdmin = await attempt(() => db.asUser(ADM.id, (tx) => tx`insert into app.presentations(owner_id, title, content, content_hash) values (${A.id}, 'importada', ${tx.json({})}, ${hash64()})`));
    assert.equal(okAdmin.ok, true);
  });
  test('o dono não transfere a propriedade; o admin sim', async () => {
    const r = await attempt(() => db.asUser(A.id, (tx) => tx`update app.presentations set owner_id = ${B.id} where id = ${P}`));
    assert.equal(r.ok, false);
    const ok = await attempt(() => db.asUser(ADM.id, (tx) => tx`update app.presentations set owner_id = ${B.id} where id = ${P}`)); assert.equal(ok.ok, true);
    await db.asUser(ADM.id, (tx) => tx`update app.presentations set owner_id = ${A.id} where id = ${P}`);
  });
  test('copiar: B cria a SUA cópia (dono = B) e altera só a cópia', async () => {
    const copy = await db.asUser(B.id, async (tx) => {
      const [src] = await tx`select title, content, content_hash, slide_count from app.presentations where id = ${P}`;
      const [c] = await tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count, source_id) values (${B.id}, ${'Cópia de ' + src.title}, ${tx.json(src.content)}, ${src.content_hash}, ${src.slide_count}, ${P}) returning id`;
      return c.id;
    });
    const up = await db.asUser(B.id, (tx) => tx`update app.presentations set title = 'Minha versão' where id = ${copy} returning id`); assert.equal(up.length, 1);
    const orig = await db.asUser(A.id, (tx) => tx`select title from app.presentations where id = ${P}`); assert.notEqual(orig[0].title, 'Minha versão');
    const seen = await db.asUser(C.id, (tx) => tx`select owner_id from app.presentations where id = ${copy}`); assert.equal(seen[0].owner_id, B.id);
  });
  test('lixeira: some para os outros, o dono e o admin ainda enxergam; só admin apaga de vez', async () => {
    const Q = await mkPres(db, A.id, 'Para a lixeira');
    await db.asUser(A.id, (tx) => tx`update app.presentations set deleted_at = now(), deleted_by = ${A.id} where id = ${Q}`);
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.presentations where id = ${Q}`)).length, 0);
    assert.equal((await db.asUser(A.id, (tx) => tx`select 1 from app.presentations where id = ${Q}`)).length, 1);
    assert.equal((await db.asUser(ADM.id, (tx) => tx`select 1 from app.presentations where id = ${Q}`)).length, 1);
    assert.equal((await db.asUser(A.id, (tx) => tx`delete from app.presentations where id = ${Q} returning id`)).length, 0);
    assert.equal((await db.asUser(ADM.id, (tx) => tx`delete from app.presentations where id = ${Q} returning id`)).length, 1);
  });
  test('usuário suspenso (ou convidado, ou inexistente) não vê nem escreve nada', async () => {
    assert.equal((await db.asUser(SUSP.id, (tx) => tx`select 1 from app.presentations`)).length, 0);
    const r = await attempt(() => db.asUser(SUSP.id, (tx) => tx`insert into app.presentations(owner_id, title, content, content_hash) values (${SUSP.id}, 'x', ${tx.json({})}, ${hash64()})`));
    assert.equal(r.ok, false);
    const ghost = '00000000-0000-4000-8000-000000000000';
    assert.equal((await db.asUser(ghost, (tx) => tx`select 1 from app.presentations`)).length, 0);
  });
  test('valores inválidos são rejeitados pelo banco (título vazio, hash curto, conteúdo gigante)', async () => {
    for (const [title, hash] of [['  ', hash64()], ['ok', 'abc']]) {
      const r = await attempt(() => db.asUser(A.id, (tx) => tx`insert into app.presentations(owner_id, title, content, content_hash) values (${A.id}, ${title}, ${tx.json({})}, ${hash})`));
      assert.equal(r.ok, false); assert.equal(r.code, '23514');
    }
  });
});

describe('versões (histórico só do dono/admin)', () => {
  let P;
  before(async () => { P = await mkPres(db, A.id, 'Com histórico'); await db.asUser(A.id, (tx) => tx`insert into app.presentation_versions(presentation_id, version_no, content, content_hash, title, kind, created_by) values (${P}, 1, ${tx.json({ v: 1 })}, ${hash64('c')}, 't', 'manual', ${A.id})`); });
  test('dono lê; outro membro não vê nem grava versões', async () => {
    assert.equal((await db.asUser(A.id, (tx) => tx`select 1 from app.presentation_versions where presentation_id = ${P}`)).length, 1);
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.presentation_versions where presentation_id = ${P}`)).length, 0);
    const r = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.presentation_versions(presentation_id, version_no, content, content_hash, title, kind) values (${P}, 2, ${tx.json({})}, ${hash64('d')}, 't', 'manual')`));
    assert.equal(r.ok, false); assert.equal(r.code, '42501');
  });
  test('versão é imutável para usuários (sem update/delete)', async () => {
    const u = await attempt(() => db.asUser(A.id, (tx) => tx`update app.presentation_versions set title = 'x' where presentation_id = ${P}`)); assert.equal(u.ok, false); assert.equal(u.code, '42501');
    const d = await attempt(() => db.asUser(ADM.id, (tx) => tx`delete from app.presentation_versions where presentation_id = ${P}`)); assert.equal(d.ok, false); assert.equal(d.code, '42501');
  });
});

describe('arquivos (deduplicação global sem vazamento)', () => {
  const SHA = hash64('e'), SHA2 = hash64('f');
  test('arquivo recém-enviado só é visível para quem enviou; ao ser usado numa apresentação, todos que a veem o acessam', async () => {
    await db.asUser(A.id, (tx) => tx`insert into app.assets(sha256, size_bytes, mime, uploaded_by) values (${SHA}, 10, 'image/png', ${A.id})`);
    assert.equal((await db.asUser(A.id, (tx) => tx`select 1 from app.assets where sha256 = ${SHA}`)).length, 1);
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.assets where sha256 = ${SHA}`)).length, 0);
    const P = await mkPres(db, A.id, 'Com imagem');
    await ops.asSystem((tx) => tx`update app.assets set status = 'ready' where sha256 = ${SHA}`);
    await db.asUser(A.id, (tx) => tx`insert into app.asset_refs(presentation_id, version_no, sha256) values (${P}, 0, ${SHA})`);
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.assets where sha256 = ${SHA}`)).length, 1);
    await db.asUser(A.id, (tx) => tx`update app.presentations set deleted_at = now() where id = ${P}`);
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.assets where sha256 = ${SHA}`)).length, 0, 'lixeira deixa de expor o arquivo');
  });
  test('quem enviou os mesmos bytes ganha acesso (livro de posse) sem ver arquivos de terceiros', async () => {
    await db.asUser(A.id, (tx) => tx`insert into app.assets(sha256, size_bytes, mime, uploaded_by) values (${SHA2}, 10, 'image/png', ${A.id})`);
    assert.equal((await db.asUser(C.id, (tx) => tx`select 1 from app.assets where sha256 = ${SHA2}`)).length, 0);
    await db.asUser(C.id, (tx) => tx`insert into app.asset_uploads(sha256, user_id) values (${SHA2}, ${C.id})`);
    assert.equal((await db.asUser(C.id, (tx) => tx`select 1 from app.assets where sha256 = ${SHA2}`)).length, 1);
    const r = await attempt(() => db.asUser(C.id, (tx) => tx`insert into app.asset_uploads(sha256, user_id) values (${SHA2}, ${B.id})`)); assert.equal(r.ok, false);
  });
  test('usuário não marca arquivo como pronto, nem altera metadados, nem referencia no deck alheio', async () => {
    const r1 = await attempt(() => db.asUser(A.id, (tx) => tx`insert into app.assets(sha256, size_bytes, mime, uploaded_by, status) values (${hash64('1')}, 5, 'image/png', ${A.id}, 'ready')`)); assert.equal(r1.ok, false);
    const r2 = await attempt(() => db.asUser(A.id, (tx) => tx`update app.assets set mime = 'text/html' where sha256 = ${SHA2}`)); assert.equal(r2.ok, false); assert.equal(r2.code, '42501');
    const P = await mkPres(db, A.id, 'Da Ana');
    const r3 = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.asset_refs(presentation_id, version_no, sha256) values (${P}, 0, ${SHA2})`)); assert.equal(r3.ok, false);
  });
});

describe('comentários e interações', () => {
  let P, K;
  before(async () => { P = await mkPres(db, A.id, 'Para comentar'); });
  test('qualquer membro comenta; autor não é forjável; comentário de lixeira é bloqueado', async () => {
    const [c] = await db.asUser(B.id, (tx) => tx`insert into app.comments(presentation_id, slide_index, author_id, body) values (${P}, 2, ${B.id}, 'Ótimo slide') returning id`); K = c.id;
    const f = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.comments(presentation_id, author_id, body) values (${P}, ${A.id}, 'forjado')`)); assert.equal(f.ok, false);
    const T = await mkPres(db, A.id, 'Lixo'); await db.asUser(A.id, (tx) => tx`update app.presentations set deleted_at = now() where id = ${T}`);
    const t = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.comments(presentation_id, author_id, body) values (${T}, ${B.id}, 'x')`)); assert.equal(t.ok, false);
  });
  test('só o autor edita o texto; o dono da apresentação (e o admin) resolvem e apagam; terceiros não', async () => {
    const own = await db.asUser(B.id, (tx) => tx`update app.comments set body = 'Ótimo slide, revisado' where id = ${K} returning edited_at`); assert.ok(own[0].edited_at);
    const other = await attempt(() => db.asUser(C.id, (tx) => tx`update app.comments set body = 'adulterado' where id = ${K}`)); assert.equal(other.ok, false);
    const ownerEdit = await attempt(() => db.asUser(A.id, (tx) => tx`update app.comments set body = 'dono edita texto alheio' where id = ${K}`)); assert.equal(ownerEdit.ok, false);
    const res = await db.asUser(A.id, (tx) => tx`update app.comments set resolved_at = now(), resolved_by = ${A.id} where id = ${K} returning id`); assert.equal(res.length, 1);
    const thirdDel = await attempt(() => db.asUser(C.id, (tx) => tx`update app.comments set deleted_at = now() where id = ${K}`)); assert.equal(thirdDel.ok, false);
    const adm = await db.asUser(ADM.id, (tx) => tx`update app.comments set deleted_at = now() where id = ${K} returning id`); assert.equal(adm.length, 1);
  });
  test('interações: cada um escreve as suas; só o dono/admin leem as dos outros; estado único por pessoa+elemento', async () => {
    await db.asUser(B.id, (tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload) values (${P}, ${B.id}, 'form_response', 'f1', ${tx.json({ a: ['sim'] })})`);
    await db.asUser(C.id, (tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload) values (${P}, ${C.id}, 'form_response', 'f1', ${tx.json({ a: ['não'] })})`);
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.interactions where presentation_id = ${P}`)).length, 1);
    assert.equal((await db.asUser(A.id, (tx) => tx`select 1 from app.interactions where presentation_id = ${P}`)).length, 2);
    const forged = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id) values (${P}, ${C.id}, 'form_response', 'f1')`)); assert.equal(forged.ok, false);
    await db.asUser(B.id, (tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload) values (${P}, ${B.id}, 'board_state', 'b1', ${tx.json({})})`);
    const dup = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.interactions(presentation_id, user_id, kind, element_id, payload) values (${P}, ${B.id}, 'board_state', 'b1', ${tx.json({})})`));
    assert.equal(dup.ok, false); assert.equal(dup.code, '23505');
    const hijack = await db.asUser(C.id, (tx) => tx`update app.interactions set payload = ${tx.json({ a: ['x'] })} where user_id = ${B.id} returning id`); assert.equal(hijack.length, 0);
  });
});

describe('usuários, convites, configurações e auditoria', () => {
  test('membro não lê e-mails dos outros; o diretório mostra só nome e papel', async () => {
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.users where id = ${A.id}`)).length, 0);
    const dir = await db.asUser(B.id, (tx) => tx`select * from app.directory where id = ${A.id}`);
    assert.deepEqual(Object.keys(dir[0]).sort(), ['display_name', 'id', 'role', 'status']);
    assert.equal((await db.asUser(ADM.id, (tx) => tx`select email from app.users where id = ${A.id}`)).length, 1);
  });
  test('membro não se promove a admin nem reativa; admin altera papel e status', async () => {
    const p = await attempt(() => db.asUser(B.id, (tx) => tx`update app.users set role = 'admin' where id = ${B.id}`)); assert.equal(p.ok, false);
    const s = await db.asUser(SUSP.id, (tx) => tx`update app.users set status = 'active' where id = ${SUSP.id} returning id`); assert.equal(s.length, 0, 'suspenso não se reativa');
    const n = await db.asUser(B.id, (tx) => tx`update app.users set display_name = 'Bruno S.' where id = ${B.id} returning display_name`); assert.equal(n[0].display_name, 'Bruno S.');
    const a = await db.asUser(ADM.id, (tx) => tx`update app.users set role = 'admin' where id = ${C.id} returning role`); assert.equal(a[0].role, 'admin');
    await db.asUser(ADM.id, (tx) => tx`update app.users set role = 'member' where id = ${C.id}`);
  });
  test('o último administrador ativo não pode ser rebaixado nem suspenso', async () => {
    const r = await attempt(() => db.asUser(ADM.id, (tx) => tx`update app.users set role = 'member' where id = ${ADM.id}`)); assert.equal(r.ok, false); assert.equal(r.code, '23514');
    const s = await attempt(() => db.asUser(ADM.id, (tx) => tx`update app.users set status = 'suspended' where id = ${ADM.id}`)); assert.equal(s.ok, false);
  });
  test('convite: só admin cria usuário convidado e convite; membro não', async () => {
    const e = `conv${Date.now()}@am.test`;
    const m = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.users(email, display_name, status) values (${e}, 'X', 'invited')`)); assert.equal(m.ok, false);
    const act = await attempt(() => db.asUser(ADM.id, (tx) => tx`insert into app.users(email, display_name, status) values (${e + 'x'}, 'X', 'active')`)); assert.equal(act.ok, false, 'admin só cria como convidado');
    const ok = await attempt(() => db.asUser(ADM.id, async (tx) => { const [u] = await tx`insert into app.users(email, display_name, status, invited_by) values (${e}, 'Convidada', 'invited', ${ADM.id}) returning id`; await tx`insert into app.invites(email, user_id, invited_by) values (${e}, ${u.id}, ${ADM.id})`; return u.id; }));
    assert.equal(ok.ok, true);
    const inv = await attempt(() => db.asUser(B.id, (tx) => tx`select 1 from app.invites`)); assert.equal(inv.ok && inv.value.length, 0);
    const dup = await attempt(() => db.asUser(ADM.id, (tx) => tx`insert into app.invites(email, invited_by) values (${e}, ${ADM.id})`)); assert.equal(dup.ok, false); assert.equal(dup.code, '23505');
  });
  test('resolve_identity: sem convite não entra; com convite vincula por e-mail verificado, ativa e só uma vez; e-mail não verificado não vincula', async () => {
    const inv = await mkUser(ops, { status: 'invited', name: 'Convidado' });
    const call = (sub, email, verified, link, touch = true) => db.anon((tx) => tx`select * from app.resolve_identity('supabase', ${sub}, ${email}, ${verified}, ${link}, ${touch})`);
    assert.equal((await call('s-unknown', 'ninguem@am.test', true, true)).length, 0, 'sem convite');
    assert.equal((await call('s-1', inv.email, false, true)).length, 0, 'e-mail não verificado');
    assert.equal((await call('s-1', inv.email, true, false)).length, 0, 'vínculo por e-mail desligado');
    const ok = await call('s-1', inv.email, true, true); assert.equal(ok.length, 1); assert.equal(ok[0].status, 'active');
    assert.equal((await call('s-1', '', false, false, false)).length, 1, 'identidade já vinculada resolve sem e-mail');
    const [other] = [await mkUser(ops, { status: 'active' })];
    assert.equal((await call('s-1', other.email, true, true)).length, 1); // continua sendo o MESMO usuário (identidade não é sequestrada)
    assert.equal((await call('s-1', other.email, true, true))[0].user_id, inv.id);
  });
  test('resolve_identity: convite VENCIDO (prazo passado, expirado ou revogado) não vincula nem ativa; convite válido continua funcionando', async () => {
    const call = (sub, email, touch = true) => db.anon((tx) => tx`select * from app.resolve_identity('supabase', ${sub}, ${email}, true, true, ${touch})`);
    const mkInvited = async (name, invite) => {
      const u = await mkUser(ops, { status: 'invited', name });
      await ops.asSystem((tx) => tx`insert into app.invites(email, user_id, role, status, expires_at) values (${u.email}, ${u.id}, 'member', ${invite.status}, ${invite.expiresAt})`);
      return u;
    };
    const past = new Date(Date.now() - 86400000), future = new Date(Date.now() + 86400000);
    for (const [name, inv] of [['Prazo passado', { status: 'pending', expiresAt: past }], ['Expirado', { status: 'expired', expiresAt: past }], ['Revogado', { status: 'revoked', expiresAt: future }]]) {
      const u = await mkInvited(name, inv);
      assert.equal((await call('venc-' + u.id, u.email)).length, 0, `${name}: não vincula identidade nova`);
      const [st] = await ops.asSystem((tx) => tx`select status from app.users where id = ${u.id}`); assert.equal(st.status, 'invited', `${name}: a conta não é ativada`);
      assert.equal((await ops.asSystem((tx) => tx`select count(*)::int n from app.user_identities where user_id = ${u.id}`))[0].n, 0, `${name}: nenhuma identidade gravada`);
    }
    // identidade vinculada ANTES do convite vencer (abriu o link e não definiu a senha) também não ativa depois do prazo
    const late = await mkInvited('Vinculou e sumiu', { status: 'pending', expiresAt: future });
    assert.equal((await call('late-1', late.email, false)).length, 1, 'dentro do prazo resolve (sem ativar)');
    await ops.asSystem((tx) => tx`update app.invites set expires_at = ${past} where user_id = ${late.id}`);
    assert.equal((await call('late-1', '', true)).length, 0, 'vencido: a identidade já vinculada não ativa a conta');
    // convite válido: comportamento de sempre
    const ok = await mkInvited('Dentro do prazo', { status: 'pending', expiresAt: future });
    const r = await call('ok-' + ok.id, ok.email); assert.equal(r.length, 1); assert.equal(r[0].status, 'active');
    assert.equal((await ops.asSystem((tx) => tx`select status from app.invites where user_id = ${ok.id}`))[0].status, 'accepted');
  });
  test('resolve_identity: uma SEGUNDA identidade (SSO) vincula ao MESMO usuário pelo e-mail verificado — conta, papel e apresentações preservados', async () => {
    const u = await mkUser(ops, { status: 'active', name: 'Pessoa com SSO futuro' });
    const sup = await db.anon((tx) => tx`select * from app.resolve_identity('supabase', 'sub-sup-1', ${u.email}, true, true, true)`); assert.equal(sup.length, 1); assert.equal(sup[0].user_id, u.id);
    const pres = await db.asUser(u.id, (tx) => tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count) values (${u.id}, 'Antes do SSO', '{"slides":[]}'::jsonb, ${'a'.repeat(64)}, 0) returning id`);
    const sso = await db.anon((tx) => tx`select * from app.resolve_identity('sso:entra', 'oid-0001', ${u.email.toUpperCase()}, true, true, true)`);
    assert.equal(sso.length, 1); assert.equal(sso[0].user_id, u.id, 'o SSO entra na MESMA conta (e-mail verificado, sem distinção de maiúsculas)'); assert.equal(sso[0].role, sup[0].role);
    const ids = await ops.asSystem((tx) => tx`select provider, subject from app.user_identities where user_id = ${u.id} order by provider`);
    assert.deepEqual(ids.map((r) => r.provider + ':' + r.subject), ['sso:entra:oid-0001', 'supabase:sub-sup-1']);
    assert.equal((await db.asUser(u.id, (tx) => tx`select count(*)::int as n from app.presentations where owner_id = ${u.id}`))[0].n, 1, 'as apresentações continuam da mesma pessoa');
    assert.equal((await db.anon((tx) => tx`select * from app.resolve_identity('sso:entra', 'oid-0001', '', false, false, false)`))[0].user_id, u.id, 'nas próximas entradas o SSO resolve direto pela identidade, sem e-mail');
    assert.equal((await db.anon((tx) => tx`select * from app.resolve_identity('sso:entra', 'oid-9999', 'desconhecida@am.test', true, true, true)`)).length, 0, 'SSO de quem não foi convidado não cria conta');
    void pres;
  });
  test('resolve_identity: suspenso nunca entra — nem vincula identidade nova, nem é reativado ao logar', async () => {
    const never = await mkUser(ops, { status: 'suspended' });
    assert.equal((await db.anon((tx) => tx`select * from app.resolve_identity('supabase', 'susp-0', ${never.email}, true, true, true)`)).length, 0, 'suspenso sem identidade não vincula');
    const u = await mkUser(ops, { status: 'active' });
    assert.equal((await db.anon((tx) => tx`select * from app.resolve_identity('supabase', 'susp-1', ${u.email}, true, true, true)`)).length, 1);
    await db.asUser(ADM.id, (tx) => tx`update app.users set status = 'suspended' where id = ${u.id}`);
    const r = await db.anon((tx) => tx`select * from app.resolve_identity('supabase', 'susp-1', ${u.email}, true, true, true)`);
    assert.equal(r.length, 1); assert.equal(r[0].status, 'suspended', 'a API recebe o status e nega; o banco não reativa');
    assert.equal((await db.asUser(u.id, (tx) => tx`select 1 from app.presentations`)).length, 0, 'e o RLS também nega tudo');
  });
  test('configurações: todos leem, só admin altera', async () => {
    const rows = await db.asUser(B.id, (tx) => tx`select key from app.settings`); assert.ok(rows.length >= 4, 'settings visíveis: ' + rows.length);
    assert.equal((await db.asUser(B.id, (tx) => tx`update app.settings set value = '"x"' where key = 'acervo.visibility' returning key`)).length, 0);
    assert.equal((await db.asUser(ADM.id, (tx) => tx`update app.settings set value = '"all_members"' where key = 'acervo.visibility' returning key`)).length, 1);
  });
  test('auditoria: o autor é sempre quem está logado, membros não leem, ninguém altera nem apaga', async () => {
    await db.asUser(B.id, (tx) => tx`select app.audit('presentation.open', 'presentation', 'p1', '10.0.0.1', 'UA', 'req-1', ${tx.json({ title_len: 5 })})`);
    assert.equal((await db.asUser(B.id, (tx) => tx`select 1 from app.audit_log`)).length, 0);
    const rows = await db.asUser(ADM.id, (tx) => tx`select actor_id, action from app.audit_log where request_id = 'req-1'`);
    assert.equal(rows.length, 1); assert.equal(rows[0].actor_id, B.id);
    const ins = await attempt(() => db.asUser(B.id, (tx) => tx`insert into app.audit_log(actor_id, action) values (${A.id}, 'forjado.x')`)); assert.equal(ins.ok, false);
    for (const q of ['update app.audit_log set action = \'zz.zz\'', 'delete from app.audit_log']) {
      const r = await attempt(() => db.asUser(ADM.id, (tx) => tx.unsafe(q))); assert.equal(r.ok, false, q);
    }
    const sys = await attempt(() => ops.asSystem((tx) => tx`delete from app.audit_log`)); assert.equal(sys.ok, false, 'nem o sistema apaga sem a retenção explícita');
  });
  test('limite de taxa: bloqueia depois do limite e zera na janela seguinte', async () => {
    const hit = () => db.anon((tx) => tx`select * from app.hit_rate('login', ${'ip-' + 'x'}, 60, 3)`).then((r) => r[0]);
    const r = [await hit(), await hit(), await hit(), await hit()];
    assert.deepEqual(r.map((x) => x.allowed), [true, true, true, false]); assert.ok(r[3].reset_in > 0 && r[3].reset_in <= 60);
  });
});

describe('segurança do SQL', () => {
  test('texto malicioso é tratado como dado (parâmetros), nunca como SQL', async () => {
    const evil = "x'); drop table app.users; --";
    const id = await db.asUser(A.id, async (tx) => { const [p] = await tx`insert into app.presentations(owner_id, title, content, content_hash) values (${A.id}, ${evil}, ${tx.json({ t: evil })}, ${hash64()}) returning id, title`; return p; });
    assert.equal(id.title, evil);
    assert.ok((await ops.asSystem((tx) => tx`select count(*)::int as n from app.users`))[0].n > 0);
  });
  test('o app_api direto no banco (sem a API) não consegue "set app.user_id" para ler dados fora de app_user', async () => {
    const raw = postgres(API_URL, { max: 1, onnotice: () => {} });
    try { await raw`select set_config('app.user_id', ${A.id}, false)`; const r = await attempt(() => raw`select * from app.presentations`); assert.equal(r.ok, false); assert.equal(r.code, '42501'); }
    finally { await raw.end(); }
  });
});
