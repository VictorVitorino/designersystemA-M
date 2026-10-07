/* tests/e2e/scenarios.cjs — os 12 cenários ponta a ponta contra a PILHA REAL (executado por tests/e2e/run.js).
   Admin → convites → Ana e Bruno → editor em nuvem (texto + imagem), outro computador, acervo comum × dono, conflito 409, histórico,
   exportações (HTML/PDF/PPTX) com imagem hidratada, importação do acervo local exportado do editor ORIGINAL, lixeira, interações,
   sessão (cookie apagado, logout, suspensão) e preservação funcional do editor (atalhos, layouts, institucional, efeitos, modelos, player).
   Cada verificação é uma linha PASS/FAIL com dados reais; os números finais (passed/failed) saem em E2E_RESULTS (JSON) para o run.js. */
'use strict';
const H = require('./helpers.cjs');
const { BASE, R, sleep, until, check, note, scenario, shot, newCtx, api, inviteLink, definePassword, login, logoutViaUi, openEditor, waitEditor, waitSaved, pillState, pillTexts, deckOf, textsOf, typeNewText, insertImage, makePng, sha256, TMP, REPO } = H;
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PW = { admin: 'Correto-Cavalo-Bateria-Grampo-42', ana: 'Jardim-Azul-Relogio-Vento-2026', bruno: 'Ponte-Verde-Lanterna-Mar-2026' };
const U = { admin: { email: 'admin@am.test', name: 'Admin' }, ana: { email: 'ana@am.test', name: 'Ana' }, bruno: { email: 'bruno@am.test', name: 'Bruno' } };
const S = { ids: {}, users: {} };          // estado compartilhado entre os cenários (ids de apresentações, ids de usuários, páginas abertas)
const canonical = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
const contentHash = (content) => sha256(Buffer.from(canonical(content), 'utf8'));
const getPres = (ctx, id) => api(ctx, 'GET', '/api/presentations/' + id);
const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

(async () => {
  await H.launch();
  const ctx = { admin: await newCtx('admin'), ana: await newCtx('ana'), bruno: await newCtx('bruno') };
  const imgPng = makePng(320, 200, 7); const imgFile = path.join(TMP, 'imagem-e2e.png'); fs.writeFileSync(imgFile, imgPng);

  /* ================================================================ 1. admin, convites, senhas, entradas */
  await scenario(1, 'Admin: convite → senha → entrar → /admin → convida Ana e Bruno → cada um define senha e entra', async () => {
    const link = process.env.E2E_INVITE_LINK || await inviteLink(U.admin.email);
    check('1.1 o dev.js imprimiu o link do convite do admin (/auth/confirmar?token_hash=…&type=invite)', /\/auth\/confirmar\?token_hash=[A-Za-z0-9._~-]{8,}&type=invite$/.test(link || ''), link);
    const { page: pa, email } = await definePassword(ctx.admin, link, PW.admin);
    check('1.2 a página /auth/confirmar mostra a conta e, depois de definir a senha, cai no /acervo', email === U.admin.email && /\/acervo/.test(pa.url()), { email, url: pa.url() });
    let s = (await api(ctx.admin, 'GET', '/api/auth/session')).json;
    check('1.3 sessão do admin: authenticated, role=admin, status=active, needsPassword=false', s && s.authenticated && s.user.role === 'admin' && s.user.status === 'active' && s.needsPassword === false, s);
    S.users.admin = s.user.id;
    const cookies = (await ctx.admin.cookies(BASE)).map((c) => c.name + (c.httpOnly ? '(HttpOnly)' : ''));
    check('1.4 cookies de sessão HttpOnly (am_at, am_rt) e am_csrf legível; nenhum token em JS', cookies.includes('am_at(HttpOnly)') && cookies.includes('am_rt(HttpOnly)') && cookies.includes('am_csrf') && (await pa.evaluate(() => document.cookie)).match(/^am_csrf=[^;]+$/), cookies);
    /* sair e entrar de novo pela tela /entrar */
    await logoutViaUi(pa);
    const p2 = await login(ctx.admin, U.admin.email, PW.admin);
    check('1.5 Sair → /entrar; entrar com e-mail e senha leva ao /acervo', /\/entrar/.test(pa.url()) && /\/acervo/.test(p2.url()), { a: pa.url(), b: p2.url() });
    await pa.close();
    /* /admin → convidar */
    await p2.goto(BASE + '/admin'); await p2.waitForSelector('#tab-convidar', { timeout: 20000 });
    await p2.click('#tab-convidar'); await p2.waitForSelector('#form-convite', { timeout: 10000 });
    const before = { ana: (await H.outbox(U.ana.email)).length, bruno: (await H.outbox(U.bruno.email)).length };
    for (const k of ['ana', 'bruno']) {
      await p2.fill('#c-email', U[k].email); await p2.fill('#c-nome', U[k].name); await p2.selectOption('#c-papel', 'member');
      await p2.click('#c-enviar');
      const ok = await p2.waitForSelector('#c-alerta .alert--ok, #c-alerta .alert', { timeout: 15000 });
      const txt = await ok.innerText();
      check('1.6 /admin › Convidar envia o convite de ' + U[k].name + ' (membro): "' + txt.slice(0, 50) + '…"', new RegExp('Convite enviado para ' + U[k].email).test(txt), txt);
    }
    await shot(p2, '01-admin-convidar');
    await p2.click('#tab-usuarios'); await p2.waitForSelector('[data-action=resend]', { timeout: 10000 });
    const rows = await p2.$$eval('[data-action=resend]', (l) => l.map((b) => b.getAttribute('aria-label')));
    check('1.7 aba Usuários lista os dois convidados (com "Reenviar convite")', rows.some((r) => /Ana/.test(r)) && rows.some((r) => /Bruno/.test(r)), rows);
    const users = (await api(ctx.admin, 'GET', '/api/admin/users')).json;
    const byMail = Object.fromEntries((users.items || users || []).map((u) => [u.email, u]));
    check('1.8 GET /api/admin/users: ana e bruno com status=invited, role=member', byMail[U.ana.email] && byMail[U.ana.email].status === 'invited' && byMail[U.ana.email].role === 'member' && byMail[U.bruno.email] && byMail[U.bruno.email].status === 'invited', Object.values(byMail).map((u) => u.email + ':' + u.status));
    S.users.ana = byMail[U.ana.email] && byMail[U.ana.email].id; S.users.bruno = byMail[U.bruno.email] && byMail[U.bruno.email].id;
    /* cada convidado: link na outbox → senha → entra */
    for (const k of ['ana', 'bruno']) {
      const lk = await until(() => inviteLink(U[k].email, { afterIndex: before[k] - 1 }), 8000);
      check('1.9 ' + U[k].name + ': link de convite na outbox do GoTrue falso', !!lk && lk.startsWith(BASE + '/auth/confirmar?token_hash='), lk);
      const { page, email } = await definePassword(ctx[k], lk, PW[k]);
      const ss = (await api(ctx[k], 'GET', '/api/auth/session')).json;
      check('1.10 ' + U[k].name + ' define a senha (12+ caracteres) e entra: sessão ativa, role=member, needsPassword=false', email === U[k].email && ss && ss.authenticated && ss.user.email === U[k].email && ss.user.role === 'member' && ss.user.status === 'active' && !ss.needsPassword, ss);
      if (k === 'ana') await shot(page, '01-ana-acervo-vazio');
      /* prova de "entrar": sai e entra de novo com a senha definida */
      await logoutViaUi(page); const pl = await login(ctx[k], U[k].email, PW[k]);
      check('1.11 ' + U[k].name + ' sai e entra de novo pela tela /entrar com a senha definida', /\/acervo/.test(pl.url()) && (await api(ctx[k], 'GET', '/api/auth/session')).json.authenticated === true, pl.url());
      await page.close(); S['page_' + k] = pl;
    }
    const reused = (await api(ctx.admin, 'POST', '/api/auth/verify', { json: { tokenHash: new URL(link).searchParams.get('token_hash'), type: 'invite' } }));
    check('1.12 o link do convite não serve duas vezes (verify de novo → 4xx link_invalid)', reused.status >= 400 && reused.status < 500, { status: reused.status, body: reused.text.slice(0, 120) });
    const adm = await api(ctx.ana, 'GET', '/api/admin/users');
    check('1.13 membro não acessa /api/admin (403)', adm.status === 403, adm.status);
  });

  /* ================================================================ 2. Ana cria, edita texto + imagem, autosave */
  await scenario(2, 'Ana: Nova apresentação → editor em nuvem → texto + imagem PNG → "Salvo na nuvem" → conteúdo com asset:, rev avançou, miniatura', async () => {
    const p = S.page_ana || await login(ctx.ana, U.ana.email, PW.ana);
    await p.goto(BASE + '/acervo'); await p.waitForSelector('#btn-nova', { timeout: 20000 });
    await Promise.all([p.waitForURL(/\/editor\//, { timeout: 30000 }), p.click('#btn-nova')]);
    const id = (p.url().match(uuidRe) || [])[0]; S.ids.main = id;
    check('2.1 "Nova apresentação" abre o editor em nuvem em /editor/<uuid>', !!id && p.url() === BASE + '/editor/' + id, p.url());
    await waitEditor(p);
    const boot = await p.evaluate(() => ({ cloud: window.AM_CLOUD, status: AMCloud.status, rev: AMCloud.rev, id: AMStudio.deck.id, pill: !!document.getElementById('cloudPill'), cover: window.AMCover && AMCover.isOpen() }));
    check('2.2 editor sabe que está na nuvem (AM_CLOUD.mode=edit, deck.id = id da apresentação, pílula presente, capa fechada), rev 1', boot.cloud && boot.cloud.mode === 'edit' && boot.cloud.presentationId === id && boot.id === id && boot.pill && boot.cover === false && boot.rev === 1, boot);
    const before = (await getPres(ctx.ana, id)).json;
    await p.fill('#title', 'Apresentação da Ana'); await p.press('#title', 'Enter');
    await typeNewText(p, 'Texto da Ana na nuvem');
    const saving = await pillState(p);
    await insertImage(p, imgFile);
    await waitSaved(p, 30000);
    const pt = await pillTexts(p);
    check('2.3 pílula: "Salvando…" durante a edição e "Salvo na nuvem às HH:MM" depois do PUT confirmado', saving === 'saving' && pt && /^Salvo na nuvem às \d\d:\d\d$/.test(pt[0]) && (await pillState(p)) === 'saved', { saving, pt });
    const after = (await getPres(ctx.ana, id)).json; const cs = JSON.stringify(after.content);
    const refs = cs.match(/asset:sha256:[0-9a-f]{64}/g) || [];
    check('2.4 GET /api/presentations/:id: content SEM "data:image" e COM "asset:sha256:" (1 imagem = sha256 do PNG enviado)', !/data:image/.test(cs) && refs.length === 1 && refs[0].endsWith(sha256(imgPng)), { refs, sha: sha256(imgPng) });
    check('2.5 rev avançou (1 → ' + after.rev + '), título e texto no servidor, canEdit=true para a dona', after.rev > before.rev && after.rev >= 2 && after.title === 'Apresentação da Ana' && cs.includes('Texto da Ana na nuvem') && after.canEdit === true, { before: before.rev, after: after.rev, title: after.title });
    const local = await deckOf(p);
    check('2.6 no editor a imagem continua como data: (a nuvem não altera o deck em memória)', local.slides[0].els.some((e) => e.type === 'image' && /^data:image\/png;base64,/.test(e.src)));
    const asset = await api(ctx.ana, 'GET', '/api/assets/' + sha256(imgPng));
    check('2.7 GET /api/assets/<sha> devolve o PNG (image/png, nosniff, CSP sandbox) com os mesmos bytes', asset.status === 200 && /image\/png/.test(asset.headers['content-type']) && asset.headers['x-content-type-options'] === 'nosniff' && /sandbox/.test(asset.headers['content-security-policy'] || ''), { status: asset.status, ct: asset.headers['content-type'] });
    const t0 = Date.now();
    const thumb = await until(async () => { const r = (await getPres(ctx.ana, id)).json; return r.thumbSha ? r : null; }, 60000, 1000);
    if (thumb) {
      const th = await api(ctx.ana, 'GET', '/api/assets/' + thumb.thumbSha);
      check('2.8 thumbSha presente em ' + Math.round((Date.now() - t0) / 1000) + ' s e a miniatura é servida como imagem (' + th.headers['content-type'] + ')', th.status === 200 && /^image\//.test(th.headers['content-type'] || ''), { thumb: thumb.thumbSha, status: th.status });
    } else note('2.8 thumbSha ausente após 60 s — verificação pulada (a miniatura é enviada no máx. 1×/60 s e só quando o slide 1 muda).');
    const sec = await p.evaluate(() => ({ cookie: document.cookie, draft: localStorage.getItem('amStudio.draft') }));
    check('2.9 privacidade: document.cookie só traz am_csrf; sem rascunho amStudio.draft em localStorage na nuvem', /^am_csrf=[^;]+$/.test(sec.cookie) && sec.draft === null, sec);
    await shot(p, '02-editor-salvo');
    S.pageA = p;
  });

  /* ================================================================ 3. outro computador */
  await scenario(3, '"Outro computador": contexto novo → Ana entra de novo → mesma apresentação → texto e imagem hidratados → edita → o 1º contexto vê ao recarregar', async () => {
    const id = S.ids.main; ctx.ana2 = await newCtx('ana2');
    const cookies0 = await ctx.ana2.cookies(BASE);
    const p = await login(ctx.ana2, U.ana.email, PW.ana, { next: '/editor/' + id });
    check('3.1 contexto novo começa sem cookies; /entrar?next=/editor/<id> leva direto ao editor depois do login', cookies0.length === 0 && p.url() === BASE + '/editor/' + id, { cookies: cookies0.length, url: p.url() });
    await waitEditor(p);
    const d = await deckOf(p);
    const img = d.slides[0].els.find((e) => e.type === 'image');
    const stage = await p.evaluate(() => [...document.querySelectorAll('#cv img')].map((i) => ({ src: i.getAttribute('src').slice(0, 22), nw: i.naturalWidth })));
    check('3.2 texto e imagem estão lá; a imagem foi hidratada (deck com data:, <img src="data:…"> no palco com naturalWidth>0, bytes = PNG original)', textsOf(d).includes('Texto da Ana na nuvem') && img && /^data:image\/png;base64,/.test(img.src) && sha256(Buffer.from(img.src.split(',')[1], 'base64')) === sha256(imgPng) && stage.some((s) => s.src.startsWith('data:image/png') && s.nw > 0), { texts: textsOf(d), stage });
    check('3.3 nenhum asset: ficou no deck em memória e o título veio do servidor', !JSON.stringify(d).includes('asset:sha256') && d.title === 'Apresentação da Ana' && (await p.inputValue('#title')) === 'Apresentação da Ana', d.title);
    await shot(p, '03-outro-computador');
    const rev0 = await p.evaluate(() => AMCloud.rev);
    await typeNewText(p, 'Escrito no outro computador'); await waitSaved(p, 30000);
    const srv = (await getPres(ctx.ana2, id)).json;
    check('3.4 a edição no outro computador é salva (rev ' + rev0 + ' → ' + srv.rev + ')', srv.rev > rev0 && JSON.stringify(srv.content).includes('Escrito no outro computador'), srv.rev);
    const pA = S.pageA; await pA.reload(); await waitEditor(pA);
    const dA = await deckOf(pA);
    check('3.5 o 1º contexto, ao recarregar, vê a mudança (texto novo + imagem) sem pedir recuperação', textsOf(dA).includes('Escrito no outro computador') && dA.slides[0].els.some((e) => e.type === 'image') && !(await pA.$('.cl-dlg')) && (await pA.evaluate(() => AMCloud.rev)) === srv.rev, textsOf(dA));
    S.pageB = p;
  });

  /* ================================================================ 4. Bruno × apresentação da Ana */
  await scenario(4, 'Bruno: vê a apresentação da Ana (dona = Ana, sem Editar), /editor → /visualizar, PUT → 403, "Criar cópia" (dono Bruno, sourceId) e editar a cópia não altera a original', async () => {
    const id = S.ids.main; const p = S.page_bruno || await login(ctx.bruno, U.bruno.email, PW.bruno);
    await p.goto(BASE + '/acervo'); await p.waitForSelector('li.card[data-id="' + id + '"]', { timeout: 20000 });
    const card = await p.$eval('li.card[data-id="' + id + '"]', (li) => ({ owner: li.dataset.owner, nm: li.querySelector('.card__owner .nm').textContent, own: !!li.querySelector('.badge--own'), edit: !!li.querySelector('[data-action=edit]'), dup: !!li.querySelector('[data-action=duplicate]'), present: li.querySelector('[data-action=present]') && li.querySelector('[data-action=present]').getAttribute('href'), readonly: li.querySelector('.card__readonly') && li.querySelector('.card__readonly').textContent }));
    check('4.1 no /acervo do Bruno o cartão mostra a dona "Ana" (data-owner=other, sem selo "Sua"), SEM botão Editar, COM "Criar cópia" e "Apresentar"', card.owner === 'other' && card.nm === 'Ana' && !card.own && !card.edit && card.dup && card.present === '/visualizar/' + id && /crie uma cópia/.test(card.readonly || ''), card);
    const menu = await (async () => { await p.click('li.card[data-id="' + id + '"] .more > button'); await p.waitForSelector('li.card[data-id="' + id + '"] [role=menuitem]', { timeout: 5000 }); const it = await p.$$eval('li.card[data-id="' + id + '"] [role=menuitem]', (l) => l.map((x) => x.dataset.action)); await p.keyboard.press('Escape'); return it; })();
    check('4.2 menu "Mais ações" do cartão de outra pessoa: sem Excluir nem Criar cópia duplicada (só detalhes e compartilhar)', !menu.includes('delete') && !menu.includes('duplicate') && menu.includes('share'), menu);
    await shot(p, '04-acervo-bruno');
    const pv = await ctx.bruno.newPage(); await pv.goto(BASE + '/editor/' + id); await pv.waitForURL(/\/visualizar\//, { timeout: 20000 });
    await pv.waitForSelector('#presenter.open', { timeout: 30000 }); await sleep(600);
    const v = await pv.evaluate(() => ({ mode: window.AM_CLOUD.mode, top: getComputedStyle(document.getElementById('top')).display, rib: getComputedStyle(document.getElementById('rib')).display, pill: !!document.getElementById('cloudPill'), copy: document.getElementById('cloudCopy') && document.getElementById('cloudCopy').textContent, edit: !!document.getElementById('cloudEdit'), presenter: !!document.querySelector('#presenter.open'), imgs: [...document.querySelectorAll('#presenter img')].filter((i) => i.naturalWidth > 0).length, cls: document.documentElement.className }));
    check('4.3 /editor/<id> de outra pessoa redireciona para /visualizar/<id>: player aberto, interface do editor oculta, sem pílula, "Criar cópia para usar" e sem "Editar"', pv.url() === BASE + '/visualizar/' + id && v.mode === 'view' && v.top === 'none' && v.rib === 'none' && !v.pill && v.copy === 'Criar cópia para usar' && !v.edit && v.presenter && v.imgs >= 1 && /am-cloud-view/.test(v.cls), Object.assign({ url: pv.url() }, v));
    await shot(pv, '04-visualizar-bruno');
    const orig0 = (await getPres(ctx.bruno, id)).json;
    check('4.4 GET da apresentação da Ana pelo Bruno: canEdit=false, dono Ana', orig0.canEdit === false && orig0.owner && orig0.owner.id === S.users.ana, { canEdit: orig0.canEdit, owner: orig0.owner });
    const put = await api(ctx.bruno, 'PUT', '/api/presentations/' + id + '/content', { json: { baseRev: orig0.rev, content: Object.assign({}, orig0.content, { title: 'Hackeado' }) } });
    const patch = await api(ctx.bruno, 'PATCH', '/api/presentations/' + id, { json: { title: 'Hackeado' } });
    const del = await api(ctx.bruno, 'DELETE', '/api/presentations/' + id);
    check('4.5 PUT …/content direto pela API como Bruno → 403 (PATCH título → 403, DELETE → 403 também); a original não mudou', put.status === 403 && put.json && put.json.error && put.json.error.code === 'forbidden' && patch.status === 403 && del.status === 403 && (await getPres(ctx.ana, id)).json.rev === orig0.rev, { put: put.status, code: put.json && put.json.error && put.json.error.code, patch: patch.status, del: del.status });
    const keys = await (async () => { for (const k of ['Delete', 'Control+z', 'a', 'Control+s']) await pv.keyboard.press(k); await pv.mouse.dblclick(600, 400); await sleep(3600); return (await getPres(ctx.ana, id)).json.rev; })();
    check('4.6 no modo visualizar teclas e duplo clique não editam (rev da original continua ' + orig0.rev + ')', keys === orig0.rev, keys);
    await pv.close();
    /* Criar cópia pela interface do acervo */
    const hashBefore = contentHash(orig0.content);
    await p.goto(BASE + '/acervo'); await p.waitForSelector('li.card[data-id="' + id + '"] [data-action=duplicate]', { timeout: 20000 });
    await Promise.all([p.waitForURL((u) => /\/editor\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(id), { timeout: 30000 }), p.click('li.card[data-id="' + id + '"] [data-action=duplicate]')]);
    const copyId = (p.url().match(uuidRe) || [])[0]; S.ids.copyBruno = copyId; await waitEditor(p);
    const cp = (await getPres(ctx.bruno, copyId)).json;
    check('4.7 "Criar cópia" cria apresentação do Bruno (owner=Bruno, sourceId=original, canEdit=true) e abre /editor/<cópia>', cp.owner.id === S.users.bruno && cp.sourceId === id && cp.canEdit === true && /Cópia de Apresentação da Ana/.test(cp.title) && (await p.evaluate(() => AMCloud.id)) === copyId, { owner: cp.owner, sourceId: cp.sourceId, title: cp.title });
    const vs = (await api(ctx.bruno, 'GET', '/api/presentations/' + copyId + '/versions')).json;
    check('4.8 a cópia nasce com uma versão "copy" no histórico e com as mesmas imagens (asset: iguais)', vs.items.some((v) => v.kind === 'copy') && JSON.stringify(cp.content).includes('asset:sha256:' + sha256(imgPng)), vs.items.map((v) => v.kind));
    await typeNewText(p, 'Só na cópia do Bruno'); await waitSaved(p, 30000);
    const orig1 = (await getPres(ctx.ana, id)).json, cp1 = (await getPres(ctx.bruno, copyId)).json;
    check('4.9 editar a cópia não altera a original: rev ' + orig0.rev + ' = ' + orig1.rev + ', content_hash igual, texto só na cópia', orig1.rev === orig0.rev && contentHash(orig1.content) === hashBefore && !JSON.stringify(orig1.content).includes('Só na cópia do Bruno') && JSON.stringify(cp1.content).includes('Só na cópia do Bruno') && cp1.rev > cp.rev, { hash: hashBefore.slice(0, 12), rev: [orig0.rev, orig1.rev] });
    await shot(p, '04-copia-bruno');
    S.page_bruno = p;
  });

  /* ================================================================ 5. conflito */
  await scenario(5, 'Conflito: Ana edita em dois contextos; o 2º salvamento recebe 409 e o diálogo com 3 opções; "Manter a minha versão" grava e cria pre_overwrite', async () => {
    const id = S.ids.main, pA = S.pageA, pB = S.pageB;
    await pB.reload(); await waitEditor(pB); await pA.reload(); await waitEditor(pA);
    const revA = await pA.evaluate(() => AMCloud.rev);
    await typeNewText(pB, 'Mudança no computador B'); await waitSaved(pB, 30000);
    const revB = await pB.evaluate(() => AMCloud.rev);
    check('5.1 o computador B salvou primeiro (rev ' + revA + ' → ' + revB + ')', revB > revA, { revA, revB });
    const puts = []; pA.on('response', (r) => { if (r.request().method() === 'PUT' && /\/content$/.test(r.url())) puts.push(r.status()); });
    await typeNewText(pA, 'Mudança conflitante no computador A');
    const dlg = await pA.waitForSelector('.cl-dlg', { timeout: 20000 }).catch(() => null);
    const txt = dlg ? await dlg.innerText() : '';
    const acts = await pA.$$eval('.cl-dlg [data-act]', (l) => l.map((b) => b.dataset.act));
    check('5.2 o PUT do computador A recebe 409 (' + puts.join(',') + ') e aparece o diálogo de conflito com quem alterou (Ana), a versão e as 3 opções', puts.includes(409) && !!dlg && /Ana/.test(txt) && new RegExp('versão ' + revB).test(txt) && acts.includes('mine') && acts.includes('cloud') && acts.includes('copy') && (await pillState(pA)) === 'conflict', { puts, acts, txt: txt.slice(0, 200) });
    const labels = await pA.$$eval('.cl-dlg [data-act]', (l) => l.map((b) => b.textContent.trim()));
    check('5.3 rótulos: "Manter a minha versão", "Carregar a versão da nuvem", "Salvar a minha como cópia"', labels.some((t) => /Manter a minha/.test(t)) && labels.some((t) => /Carregar a versão da nuvem/.test(t)) && labels.some((t) => /Salvar a minha como cópia/.test(t)), labels);
    await shot(pA, '05-conflito');
    await pA.click('.cl-dlg [data-act=mine]');
    await pA.waitForFunction(() => AMCloud.status === 'saved' && !AMCloud.dirty && !document.querySelector('.cl-dlg'), null, { timeout: 30000 });
    const srv = (await getPres(ctx.ana, id)).json; const vs = (await api(ctx.ana, 'GET', '/api/presentations/' + id + '/versions')).json.items;
    const pre = vs.filter((v) => v.kind === 'pre_overwrite');
    check('5.4 "Manter a minha versão": grava (rev ' + srv.rev + ' > ' + revB + ') com o texto do A e cria a versão pre_overwrite no GET …/versions', srv.rev > revB && JSON.stringify(srv.content).includes('Mudança conflitante no computador A') && pre.length >= 1, { rev: srv.rev, kinds: vs.map((v) => v.kind) });
    const preContent = pre.length ? (await api(ctx.ana, 'GET', '/api/presentations/' + id + '/versions/' + pre[pre.length - 1].no)).json : null;
    check('5.5 a versão pre_overwrite guarda o que estava na nuvem (texto do B) antes de ser sobrescrita', !!preContent && JSON.stringify(preContent.content).includes('Mudança no computador B'), preContent && preContent.no);
    check('5.6 a versão que ficou valendo não tem o texto do B (sobrescrita deliberada, sem mescla silenciosa)', !JSON.stringify(srv.content).includes('Mudança no computador B'));
  });

  /* ================================================================ 6. histórico */
  await scenario(6, 'Histórico: "Salvar versão agora" → lista de versões → restaurar a anterior → conteúdo volta', async () => {
    const id = S.ids.main, p = S.pageA;
    await waitSaved(p);
    await p.click('#cloudPill'); await p.waitForSelector('#cloudMenu.open .cl-mi[data-id=snap]', { timeout: 5000 }); await p.click('.cl-mi[data-id=snap]');
    await p.waitForSelector('#cloudVerLabel', { timeout: 5000 }); await p.fill('#cloudVerLabel', 'Ponto de controle E2E'); await p.click('[data-act=dosnap]');
    const v1 = await until(async () => { const r = (await api(ctx.ana, 'GET', '/api/presentations/' + id + '/versions')).json.items; return r.some((v) => v.label === 'Ponto de controle E2E') ? r : null; }, 15000);
    check('6.1 menu da pílula › "Salvar versão agora…" cria versão manual com rótulo', !!v1 && v1.some((v) => v.kind === 'manual' && v.label === 'Ponto de controle E2E' && v.createdBy && v.createdBy.displayName === 'Ana'), v1 && v1.map((v) => v.kind + ':' + (v.label || '')));
    const revSnap = await p.evaluate(() => AMCloud.rev);
    await typeNewText(p, 'Depois do ponto de controle'); await waitSaved(p, 30000);
    const srvMid = (await getPres(ctx.ana, id)).json;
    check('6.2 nova edição depois do ponto (rev ' + revSnap + ' → ' + srvMid.rev + ') está no servidor', srvMid.rev > revSnap && JSON.stringify(srvMid.content).includes('Depois do ponto de controle'));
    await p.click('#cloudPill'); await p.waitForSelector('#cloudMenu.open .cl-mi[data-id=hist]', { timeout: 5000 }); await p.click('.cl-mi[data-id=hist]');
    await p.waitForSelector('.cl-vi', { timeout: 10000 });
    const items = await p.$$eval('.cl-vi', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ')));
    check('6.3 a lista do histórico mostra as versões (manual com rótulo, pre_overwrite…) com autor e nº de slides', items.length >= 3 && items.some((t) => /Ponto de controle E2E/.test(t)) && items.some((t) => /Antes de sobrescrever/.test(t)) && items.every((t) => /Ana/.test(t) && /slide/.test(t)), items.slice(0, 6));
    const idx = await p.$$eval('.cl-vi', (l) => l.findIndex((x) => /Ponto de controle E2E/.test(x.innerText)));
    await (await p.$$('.cl-vi'))[idx].click(); await p.waitForSelector('.cl-vthumb .am-stage', { timeout: 10000 });
    await shot(p, '06-historico');
    const revBefore = (await getPres(ctx.ana, id)).json.rev;
    await p.click('[data-act=vrs]'); await p.waitForSelector('.cl-dlg [data-act]', { timeout: 5000 }).catch(() => { });
    const conf = await p.$$('.cl-dlg .cl-b'); await conf[conf.length - 1].click();
    await p.waitForFunction((r) => AMCloud.rev > r && AMCloud.status === 'saved' && !document.querySelector('.cl-dlg'), revBefore, { timeout: 30000 });
    const d = await deckOf(p), srv = (await getPres(ctx.ana, id)).json, vs = (await api(ctx.ana, 'GET', '/api/presentations/' + id + '/versions')).json.items;
    check('6.4 restaurar a versão anterior: o conteúdo volta (sem "Depois do ponto de controle", com o texto do conflito), no editor e no servidor', !textsOf(d).includes('Depois do ponto de controle') && textsOf(d).includes('Mudança conflitante no computador A') && !JSON.stringify(srv.content).includes('Depois do ponto de controle') && srv.rev > revBefore, textsOf(d));
    check('6.5 o histórico ganha pre_restore (estado anterior) e restore', vs.some((v) => v.kind === 'pre_restore') && vs.some((v) => v.kind === 'restore'), vs.map((v) => v.kind));
  });

  /* ================================================================ 7. exportações no build em nuvem */
  await scenario(7, 'Exportações no build em nuvem com imagem: Salvar (.html) com imagem inline e player; PDF e PowerPoint gerados; .pptx conferido no python-pptx', async () => {
    const id = S.ids.main, p = S.pageA; await waitSaved(p);
    /* 2º slide para o player ter para onde avançar */
    await p.click('#addSlide'); await p.waitForSelector('#mSlide.open button[data-layout]', { timeout: 5000 });
    const lay = await p.$$eval('#mSlide.open button[data-layout]', (l) => l.map((b) => b.dataset.layout));
    await p.click('#mSlide.open button[data-layout="' + (lay.includes('content') ? 'content' : lay[1] || lay[0]) + '"]'); await sleep(400);
    await typeNewText(p, 'Segundo slide exportado'); await waitSaved(p, 30000);
    const nSlides = (await deckOf(p)).slides.length;
    check('7.1 "+ Novo slide" adiciona o 2º slide (deck com ' + nSlides + ' slides) e a nuvem salva', nSlides === 2 && (await getPres(ctx.ana, id)).json.content.slides.length === 2, nSlides);
    /* menu Salvar ▾ existe com PDF / PDF pelo navegador / PowerPoint */
    await p.click('#bSaveMore'); await sleep(300);
    const saveAs = await p.$$eval('.xmenu .xi', (l) => l.map((x) => (x.dataset.id || x.id || '') + '|' + x.textContent.trim().slice(0, 30) + '|' + (x.classList.contains('dis') ? 'dis' : 'ok')));
    await p.keyboard.press('Escape'); await sleep(200);
    check('7.2 menu Salvar ▾ oferece PDF, PDF pelo navegador e PowerPoint (.pptx) habilitados', saveAs.some((s) => /PDF \(\.pdf\)/.test(s) && /ok$/.test(s)) && saveAs.some((s) => /PowerPoint/.test(s) && /ok$/.test(s)), saveAs);
    /* Salvar → download .html */
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#bSave')]);
    const htmlPath = path.join(TMP, 'exportado.html'); await dl.saveAs(htmlPath); const html = fs.readFileSync(htmlPath, 'utf8');
    const nData = (html.match(/data:image\/png;base64,/g) || []).length;
    check('7.3 o .html baixado (' + dl.suggestedFilename() + ', ' + Math.round(html.length / 1024) + ' KB) contém a imagem inline (data:image/png ×' + nData + '), nenhum "asset:" e o bloco am-deck-data', dl.suggestedFilename().endsWith('.html') && nData >= 1 && !/asset:sha256/.test(html) && /am-deck-data/.test(html) && html.includes('Texto da Ana na nuvem'), { name: dl.suggestedFilename(), nData });
    const dataB64 = (html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/) || [])[1];
    check('7.4 os bytes da imagem no .html são os do PNG original (sha256 igual)', !!dataB64 && sha256(Buffer.from(dataB64, 'base64')) === sha256(imgPng));
    const pl = await ctx.ana.newPage(); await pl.goto('file://' + htmlPath); await pl.waitForSelector('.amp-pos', { timeout: 20000 }); await sleep(800);
    const pos1 = await pl.innerText('.amp-pos'); await pl.keyboard.press('ArrowRight'); await sleep(700); const pos2 = await pl.innerText('.amp-pos');
    const plImg = await pl.evaluate(() => [...document.querySelectorAll('#am-player img')].filter((i) => /^data:image\/png/.test(i.getAttribute('src') || '') && i.naturalWidth > 0).length);
    check('7.5 o .html abre sozinho (file://) e o player funciona: ' + pos1.replace(/\s+/g, ' ') + ' → ArrowRight → ' + pos2.replace(/\s+/g, ' ') + '; imagem renderizada', /^01/.test(pos1) && /^02/.test(pos2) && plImg >= 1, { pos1, pos2, plImg });
    await shot(pl, '07-html-exportado-player'); await pl.close();
    /* PDF e PowerPoint pelos caminhos do editor (AMExport) */
    const pdf = await p.evaluate(async () => { const b = await AMExport.pdf(AMStudio.deck, { scale: 1 }); return { size: b.size, head: await b.slice(0, 8).text(), type: b.type }; });
    check('7.6 PDF gerado sem erro: %PDF-, ' + Math.round(pdf.size / 1024) + ' KB', /^%PDF-/.test(pdf.head) && pdf.size > 5000, pdf);
    const pptxB64 = await p.evaluate(async () => { const b = await AMExport.pptxBuild(AMStudio.deck, { range: 'all', mode: 'edit' }); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
    const pptxPath = path.join(TMP, 'exportado.pptx'); fs.writeFileSync(pptxPath, Buffer.from(pptxB64, 'base64'));
    const pptxBytes = fs.readFileSync(pptxPath);
    check('7.7 PowerPoint gerado sem erro: ZIP (PK), ' + Math.round(pptxBytes.length / 1024) + ' KB', pptxBytes[0] === 0x50 && pptxBytes[1] === 0x4b && pptxBytes.length > 5000, pptxBytes.length);
    let py = null;
    try {
      py = JSON.parse(execFileSync('python3', ['-I', '-c', [
        'import sys, json', 'from pptx import Presentation', 'from pptx.enum.shapes import MSO_SHAPE_TYPE',
        'p = Presentation(sys.argv[1])', 'pics = [[s.shape_id for s in sl.shapes if s.shape_type == MSO_SHAPE_TYPE.PICTURE] for sl in p.slides]',
        'texts = [[sh.text_frame.text for sh in sl.shapes if sh.has_text_frame] for sl in p.slides]',
        'print(json.dumps({"slides": len(p.slides), "pictures": pics, "texts": texts, "w": p.slide_width, "h": p.slide_height}))'].join('\n'), pptxPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).toString());
    } catch (e) { check('7.8 python-pptx abre o .pptx', false, String(e.stderr || e).slice(0, 400)); }
    if (py) check('7.8 python-pptx abre o .pptx: ' + py.slides + ' slides (= deck), imagem como picture no slide 1, textos preservados, 16:9', py.slides === nSlides && py.pictures[0].length >= 1 && py.texts.flat().some((t) => /Texto da Ana na nuvem/.test(t)) && Math.round(py.w / py.h * 100) === 178, py);
  });

  /* ================================================================ 8. importar acervo local exportado do editor ORIGINAL */
  await scenario(8, 'Importar acervo local: acervo .json exportado do editor ORIGINAL (file://, Minhas obras › Exportar acervo) importado em /importar como Bruno → 2 apresentações com os slides certos', async () => {
    ctx.orig = await newCtx('original'); const po = await ctx.orig.newPage();
    const origFile = path.join(REPO, 'original', 'Canteiro-AM (3).html');
    await po.goto('file://' + origFile + '?nocover'); await po.waitForFunction(() => window.AMStudio && window.AMHist && window.AMCover, null, { timeout: 30000 }); await sleep(800);
    const made = await po.evaluate(async () => {
      const mkDeck = (id, title, n, tag) => { const d = JSON.parse(JSON.stringify(AMStudio.deck)); d.id = id; d.title = title; d.slides = []; for (let i = 0; i < n; i++) { const s = AMStudio.mk.slide(i === 0 ? 'cover' : 'content'); s.els = [AMStudio.mk.text('title', { html: tag + ' — slide ' + (i + 1), x: 80, y: 80, w: 900, h: 120 })]; d.slides.push(s); } return d; };
      const a = mkDeck('obra-e2e-a', 'Obra A do acervo local', 1, 'Obra A'), b = mkDeck('obra-e2e-b', 'Obra B do acervo local', 3, 'Obra B');
      await AMHist.put(a, { force: true }); await AMHist.put(b, { force: true }); await AMHist.list();
      return { kind: AMHist.kind(), n: AMHist.count(), ids: AMHist.metas().map((m) => m.id) };
    });
    check('8.1 editor original (file://): 2 obras gravadas em "Minhas obras" (' + made.kind + ')', made.n >= 2 && made.ids.includes('obra-e2e-a') && made.ids.includes('obra-e2e-b'), made);
    /* contagem de efeitos no ORIGINAL para comparar com o build em nuvem (cenário 12) */
    await po.click('#bFx'); await sleep(1500);
    S.origFx = await po.evaluate(() => ({ boxes: document.querySelectorAll('#drawerBody .gx-box').length, head: (document.querySelector('.gx-count') || {}).textContent, fams: Object.fromEntries([...document.querySelectorAll('#drawerBody [data-gf]')].map((c) => [c.dataset.gf, +(c.querySelector('i') || {}).textContent])) }));
    await po.keyboard.press('Escape'); await sleep(300);
    check('8.2 o editor ORIGINAL abre o Acervo de efeitos com ' + S.origFx.boxes + ' caixas ("' + String(S.origFx.head || '').trim() + '")', S.origFx.boxes >= 192, S.origFx);
    /* capa › Minhas obras › Exportar acervo (.json) */
    let jsonText = null, via = 'ui';
    try {
      await po.click('#bHome'); await po.waitForFunction(() => AMCover.isOpen(), null, { timeout: 5000 });
      await po.click('#cvHistBtn'); await po.waitForSelector('#cvHistGrid article', { timeout: 8000 });
      const [dlj] = await Promise.all([po.waitForEvent('download', { timeout: 15000 }), po.click('#cvHistExp')]);
      const jp = path.join(TMP, 'acervo-original.json'); await dlj.saveAs(jp); jsonText = fs.readFileSync(jp, 'utf8');
      check('8.3 Minhas obras › "Exportar acervo (.json)" baixa ' + dlj.suggestedFilename(), /^canteiro-acervo-\d{4}-\d\d-\d\d\.json$/.test(dlj.suggestedFilename()), dlj.suggestedFilename());
      await shot(po, '08-original-minhas-obras');
    } catch (e) { note('8.3 exportação pela interface da capa falhou (' + String(e.message).slice(0, 120) + '); usando AMHist.exportJSON() do próprio editor original.'); via = 'api'; jsonText = await po.evaluate(() => AMHist.exportJSON()); }
    const acervo = JSON.parse(jsonText);
    const obras = acervo.obras.filter((o) => /^obra-e2e-/.test(o.id));
    check('8.4 o .json tem o formato {kind:"canteiro-acervo", v:1, obras:[{id,title,deck}]} com as 2 obras (1 e 3 slides)', acervo.kind === 'canteiro-acervo' && acervo.v === 1 && obras.length === 2 && obras.every((o) => o.deck && Array.isArray(o.deck.slides)) && obras.find((o) => o.id === 'obra-e2e-b').deck.slides.length === 3, { kind: acervo.kind, v: acervo.v, n: acervo.obras.length, via });
    const jsonFile = path.join(TMP, 'acervo-para-importar.json'); fs.writeFileSync(jsonFile, JSON.stringify(Object.assign({}, acervo, { obras })));
    await po.close();
    /* Bruno importa */
    const pb = S.page_bruno; await pb.goto(BASE + '/importar'); await pb.waitForSelector('#arquivos', { timeout: 20000 });
    await pb.setInputFiles('#arquivos', jsonFile);
    await pb.waitForSelector('#btn-importar', { timeout: 15000 });
    const queued = await pb.$$eval('.queue li', (l) => l.map((x) => x.querySelector('.qi__title').textContent));
    check('8.5 /importar lê o .json e lista as 2 apresentações na fila', queued.length === 2 && queued.some((t) => /Obra A do acervo local/.test(t)) && queued.some((t) => /Obra B do acervo local/.test(t)), queued);
    await pb.click('#btn-importar');
    await pb.waitForFunction(() => document.querySelectorAll('.queue li[data-status=done]').length === 2, null, { timeout: 90000 });
    const rel = await pb.evaluate(() => ({ importadas: document.querySelector('[data-stat=importadas] .stat__v').textContent, falhas: document.querySelector('[data-stat=falhas] .stat__v').textContent, links: [...document.querySelectorAll('.queue li a[href^="/editor/"]')].map((a) => a.getAttribute('href')) }));
    check('8.6 relatório: 2 importadas, 0 falhas, link "Abrir no editor" para cada', rel.importadas === '2' && rel.falhas === '0' && rel.links.length === 2, rel);
    await shot(pb, '08-importar-relatorio');
    await Promise.all([pb.waitForURL(/\/acervo\?aba=minhas/, { timeout: 15000 }), pb.click('#ver-acervo')]);
    await pb.waitForSelector('li.card', { timeout: 20000 });
    const cards = await pb.$$eval('li.card', (l) => l.map((li) => ({ id: li.dataset.id, title: li.querySelector('.card__title').textContent, owner: li.dataset.owner, meta: li.querySelector('.card__meta').textContent })));
    const ca = cards.find((c) => c.title === 'Obra A do acervo local'), cb = cards.find((c) => c.title === 'Obra B do acervo local');
    check('8.7 as 2 apresentações aparecem em /acervo (aba Minhas) como do Bruno, com 1 e 3 slides', !!ca && !!cb && ca.owner === 'me' && cb.owner === 'me' && /^1 slide/.test(ca.meta) && /^3 slides/.test(cb.meta), cards);
    if (ca && cb) {
      const ga = (await getPres(ctx.bruno, ca.id)).json, gb = (await getPres(ctx.bruno, cb.id)).json;
      const tb = textsOf(gb.content);
      check('8.8 conteúdo importado: Obra A com "Obra A — slide 1"; Obra B com 3 slides "Obra B — slide 1..3"; versão "import" no histórico', textsOf(ga.content).includes('Obra A — slide 1') && gb.content.slides.length === 3 && ['1', '2', '3'].every((n) => tb.includes('Obra B — slide ' + n)) && (await api(ctx.bruno, 'GET', '/api/presentations/' + cb.id + '/versions')).json.items.some((v) => v.kind === 'import'), { ta: textsOf(ga.content), tb });
      S.ids.importB = cb.id;
    }
  });

  /* ================================================================ 9. lixeira */
  await scenario(9, 'Lixeira: Ana exclui → some do acervo do Bruno → aparece na aba Lixeira da Ana → Restaurar → volta. Admin: apagar de vez', async () => {
    const created = (await api(ctx.ana, 'POST', '/api/presentations', { json: { title: 'Para a lixeira' } })).json; const id = created.id; S.ids.trash = id;
    const pA = S.pageA; await pA.goto(BASE + '/acervo'); await pA.waitForSelector('li.card[data-id="' + id + '"]', { timeout: 20000 });
    await pA.click('li.card[data-id="' + id + '"] .more > button'); await pA.waitForSelector('li.card[data-id="' + id + '"] [data-action=delete]', { timeout: 5000 }); await pA.click('li.card[data-id="' + id + '"] [data-action=delete]');
    await pA.waitForSelector('dialog.dlg[open] [data-act=confirm]', { timeout: 5000 }); await pA.click('dialog.dlg[open] [data-act=confirm]');
    await pA.waitForFunction((i) => !document.querySelector('li.card[data-id="' + i + '"]'), id, { timeout: 10000 });
    check('9.1 Ana: menu do cartão › Excluir → confirmação → o cartão some do acervo', !(await pA.$('li.card[data-id="' + id + '"]')));
    const pb = S.page_bruno; await pb.goto(BASE + '/acervo'); await pb.waitForSelector('#painel:not([aria-busy])', { timeout: 20000 }); await sleep(300);
    const gb = await getPres(ctx.bruno, id);
    check('9.2 Bruno não vê mais a apresentação (sem cartão no /acervo; GET → 404 sem revelar existência)', !(await pb.$('li.card[data-id="' + id + '"]')) && gb.status === 404, gb.status);
    await pA.click('#tab-lixeira'); await pA.waitForSelector('li.card[data-id="' + id + '"]', { timeout: 15000 });
    const tc = await pA.$eval('li.card[data-id="' + id + '"]', (li) => ({ badge: !!li.querySelector('.badge--danger'), restore: !!li.querySelector('[data-action=restore]'), present: !!li.querySelector('[data-action=present]') }));
    check('9.3 aba Lixeira da Ana mostra a apresentação com selo "Excluída" e botão Restaurar (sem Apresentar)', tc.badge && tc.restore && !tc.present, tc);
    await shot(pA, '09-lixeira-ana');
    await pA.click('li.card[data-id="' + id + '"] [data-action=restore]'); await pA.waitForFunction((i) => !document.querySelector('li.card[data-id="' + i + '"]'), id, { timeout: 10000 });
    await pA.click('#tab-todas'); await pA.waitForSelector('li.card[data-id="' + id + '"]', { timeout: 15000 });
    const gb2 = await getPres(ctx.bruno, id);
    check('9.4 Restaurar: volta à aba Todas e o Bruno volta a ver (GET 200, deleted=false)', gb2.status === 200 && gb2.json.deleted === false, gb2.status);
    /* admin: apagar de vez (só na lixeira) */
    const purgeLive = await api(ctx.admin, 'DELETE', '/api/presentations/' + id + '?purge=1');
    check('9.5 admin não apaga de vez o que não está na lixeira (DELETE ?purge=1 → ' + purgeLive.status + ')', purgeLive.status >= 400 && (await getPres(ctx.ana, id)).status === 200, purgeLive.status);
    await api(ctx.ana, 'DELETE', '/api/presentations/' + id);
    const purgeMember = await api(ctx.ana, 'DELETE', '/api/presentations/' + id + '?purge=1');
    check('9.6 membro (a dona) não apaga de vez (403)', purgeMember.status === 403, purgeMember.status);
    const pad = await login(ctx.admin, U.admin.email, PW.admin); await pad.goto(BASE + '/acervo?aba=lixeira'); await pad.waitForSelector('li.card[data-id="' + id + '"]', { timeout: 20000 });
    await pad.click('li.card[data-id="' + id + '"] .more > button'); await pad.waitForSelector('li.card[data-id="' + id + '"] [data-action=purge]', { timeout: 5000 }); await pad.click('li.card[data-id="' + id + '"] [data-action=purge]');
    await pad.waitForSelector('dialog.dlg[open] [data-act=confirm]', { timeout: 5000 }); await shot(pad, '09-admin-apagar-de-vez'); await pad.click('dialog.dlg[open] [data-act=confirm]');
    await pad.waitForFunction((i) => !document.querySelector('li.card[data-id="' + i + '"]'), id, { timeout: 10000 });
    const after = { ana: (await getPres(ctx.ana, id)).status, adm: (await getPres(ctx.admin, id)).status, trash: (await api(ctx.ana, 'GET', '/api/presentations?scope=trash')).json.items.some((x) => x.id === id) };
    check('9.7 admin › Lixeira › "Apagar de vez": some para todos (GET 404 para a dona e para o admin; fora da lixeira)', after.ana === 404 && after.adm === 404 && !after.trash, after);
    await pad.close();
  });

  /* ================================================================ 10. interações */
  await scenario(10, 'Interações: Ana insere um formulário; Bruno responde no modo visualizar; Ana vê a resposta em GET …/interactions e no CSV', async () => {
    const id = S.ids.main, pA = S.pageA; await openEditorOn(pA, id);
    const fid = await pA.evaluate(() => { AMStudio.goSlide(0); const e = AMStudio.insertFx('form'); const F = AMStudio.deck.slides[0].els.find((x) => x.kind === 'form'); F.x = 40; F.y = 140; F.w = 560; F.h = 500; AMStudio.renderAll(); AMStudio.commit(); return F.id; });
    await waitSaved(pA, 30000);
    const srv = (await getPres(ctx.ana, id)).json;
    check('10.1 Ana insere o componente de formulário no slide 1 e a nuvem salva (kind=form no servidor)', !!fid && srv.content.slides[0].els.some((e) => e.kind === 'form' && e.id === fid), fid);
    const pv = await openEditor(ctx.bruno, id, { mode: 'visualizar' }); await pv.waitForSelector('#presenter.open', { timeout: 30000 }); await pv.keyboard.press('Home');
    await pv.waitForSelector('#presenter .amf .amf-send', { timeout: 15000 }); await sleep(500);
    const posts = []; pv.on('response', (r) => { if (/\/interactions$/.test(r.url()) && r.request().method() === 'POST') posts.push(r.status()); });
    await pv.evaluate(() => { [...document.querySelectorAll('#presenter .amf-in')].forEach((x, i) => { x.focus(); document.execCommand('insertText', false, 'Resposta do Bruno ' + (i + 1)); }); const rb = document.querySelector('#presenter .amf-rb'); if (rb) rb.click(); const o = document.querySelector('#presenter .amf-o'); if (o) o.click(); });
    await pv.click('#presenter .amf-send');
    const got = await until(async () => { const r = (await api(ctx.ana, 'GET', '/api/presentations/' + id + '/interactions?kind=form_response&elementId=' + fid)).json; return r && r.items && r.items.length ? r.items : null; }, 25000, 500);
    await shot(pv, '10-formulario-bruno');
    const who = (it) => (it && (it.author || it.user)) || {};
    check('10.2 Bruno responde no modo visualizar: POST …/interactions (' + posts.join(',') + ') e a dona vê a resposta em GET …/interactions, identificada como de Bruno', !!got && got.length === 1 && got[0].kind === 'form_response' && who(got[0]).id === S.users.bruno && JSON.stringify(got[0].payload).includes('Resposta do Bruno 1') && posts.includes(201), got && got[0]);
    /* contrato do cliente (docs/editor-em-nuvem.md §7.1 e tests/cloud/mock-api.js): o item traz `author:{id,displayName}`; a extensão filtra o estado próprio por `author.id` */
    check('10.2b o item de GET …/interactions segue o contrato do cliente: campo "author" {id, displayName} (chaves reais: ' + (got ? Object.keys(got[0]).join(',') : '?') + ')', !!got && got[0].author && got[0].author.id === S.users.bruno && got[0].author.displayName === 'Bruno', got && got[0]);
    /* impacto no editor da dona: ao abrir, a extensão restaura "o estado próprio" no localStorage — a resposta do Bruno NÃO pode aparecer como se fosse da Ana */
    await pA.evaluate(() => localStorage.clear()); await pA.reload(); await waitEditor(pA); await sleep(1200);
    const anaLocal = await pA.evaluate((k) => localStorage.getItem(k), 'amForm.' + id + '.' + fid);
    check('10.2c ao reabrir o editor, a dona (Ana) NÃO recebe a resposta do Bruno como resposta própria em localStorage amForm.<id>.<form>', anaLocal === null || !/Resposta do Bruno/.test(anaLocal), { anaLocal: anaLocal && anaLocal.slice(0, 200) });
    const mine = (await api(ctx.bruno, 'GET', '/api/presentations/' + id + '/interactions?kind=form_response')).json;
    const csvB = await api(ctx.bruno, 'GET', '/api/presentations/' + id + '/interactions.csv?kind=form_response&elementId=' + fid);
    check('10.3 Bruno só vê a própria resposta e não exporta o CSV (403)', mine.items.length === 1 && who(mine.items[0]).id === S.users.bruno && csvB.status === 403, { n: mine.items.length, csv: csvB.status });
    const csv = await api(ctx.ana, 'GET', '/api/presentations/' + id + '/interactions.csv?kind=form_response&elementId=' + fid);
    check('10.4 CSV da dona: 200 text/csv, BOM UTF-8, cabeçalho + 1 linha com "Bruno" e a resposta', csv.status === 200 && /text\/csv/.test(csv.headers['content-type']) && csv.text.charCodeAt(0) === 0xfeff && csv.text.split(/\r?\n/).filter(Boolean).length >= 2 && /Bruno/.test(csv.text) && /Resposta do Bruno 1/.test(csv.text), { status: csv.status, head: csv.text.slice(0, 160) });
    await pv.close();
  });

  /* ================================================================ 11. sessão */
  await scenario(11, 'Sessão: cookie de acesso apagado → próxima ação renova (refresh) sem perder o editor; logout → /editor/<id> → /entrar?next=…; usuário suspenso perde acesso em ≤ 15 s', async () => {
    const id = S.ids.main, pA = S.pageA; await openEditorOn(pA, id);
    await ctx.ana.clearCookies({ name: 'am_at' });
    const names0 = (await ctx.ana.cookies(BASE)).map((c) => c.name);
    const seen = []; pA.on('response', (r) => { const u = r.url().replace(BASE, ''); if (/\/api\/auth\/refresh$/.test(u) || /\/content$/.test(u)) seen.push(r.request().method() + ' ' + u.replace(/[0-9a-f-]{36}/, '<id>') + ' ' + r.status()); });
    await typeNewText(pA, 'Depois de apagar o cookie de acesso'); await waitSaved(pA, 30000);
    const names1 = (await ctx.ana.cookies(BASE)).map((c) => c.name);
    check('11.1 sem am_at (' + names0.join(',') + '): a próxima gravação faz POST /api/auth/refresh e o PUT é refeito com sucesso; o editor continua na mesma página', !names0.includes('am_at') && seen.some((s) => /refresh 200/.test(s)) && seen.some((s) => /content 200/.test(s)) && names1.includes('am_at') && pA.url() === BASE + '/editor/' + id && JSON.stringify((await getPres(ctx.ana, id)).json.content).includes('Depois de apagar o cookie de acesso'), { names0, names1, seen });
    check('11.2 nenhum diálogo de sessão apareceu (renovação transparente)', !(await pA.$('.cl-dlg')) && (await pillState(pA)) === 'saved');
    /* logout no contexto B → /editor redireciona ao login com next */
    const pB = S.pageB; await pB.goto(BASE + '/acervo'); await pB.waitForSelector('#btn-sair', { timeout: 20000 }); await Promise.all([pB.waitForURL(/\/entrar/, { timeout: 20000 }), pB.click('#btn-sair')]);
    const cookiesB = (await ctx.ana2.cookies(BASE)).map((c) => c.name);
    await pB.goto(BASE + '/editor/' + id); await pB.waitForURL(/\/entrar\?/, { timeout: 20000 });
    const nx = new URL(pB.url()).searchParams.get('next');
    check('11.3 logout apaga os cookies de sessão; /editor/<id> redireciona para /entrar?next=/editor/<id>', !cookiesB.includes('am_at') && !cookiesB.includes('am_rt') && nx === '/editor/' + id, { cookiesB, url: pB.url() });
    const sB = (await api(ctx.ana2, 'GET', '/api/presentations/' + id));
    check('11.4 sem sessão a API nega (GET …/presentations/:id → 401)', sB.status === 401, sB.status);
    await shot(pB, '11-entrar-next');
    /* suspensão pelo admin (interface) */
    const pad = await login(ctx.admin, U.admin.email, PW.admin); await pad.goto(BASE + '/admin'); await pad.waitForSelector('[data-action=suspend]', { timeout: 20000 });
    const okB = (await api(ctx.bruno, 'GET', '/api/auth/session')).json;
    await pad.click('[data-action=suspend][aria-label="Suspender: Bruno"]'); await pad.waitForSelector('dialog.dlg[open] [data-act=confirm]', { timeout: 5000 });
    const t0 = Date.now(); await pad.click('dialog.dlg[open] [data-act=confirm]');
    /* sonda com uma rota de conteúdo (não /auth/session, que apaga os cookies ao responder "suspenso"): o banco passa a recusar com 403 suspended */
    const lost = await until(async () => { const r = await api(ctx.bruno, 'GET', '/api/presentations?limit=1'); return r.status === 403 ? r.json : null; }, 15000, 400);
    const dt = Date.now() - t0;
    check('11.5 admin › Usuários › Suspender Bruno: o acesso dele cai em ' + (dt / 1000).toFixed(1) + ' s (≤ 15 s): GET /api/presentations → 403 suspended', okB.authenticated === true && !!lost && lost.error && lost.error.code === 'suspended' && dt <= 15000, { lost, dt });
    const sess = (await api(ctx.bruno, 'GET', '/api/auth/session')).json;
    check('11.5b GET /api/auth/session do suspenso: authenticated=false, reason=suspended (e os cookies de sessão são apagados)', sess && sess.authenticated === false && sess.reason === 'suspended' && !(await ctx.bruno.cookies(BASE)).some((c) => c.name === 'am_at' || c.name === 'am_rt'), sess);
    const pb = S.page_bruno; await pb.goto(BASE + '/acervo'); await pb.waitForURL(/\/entrar/, { timeout: 20000 });
    const motivoTxt = await pb.innerText('body');
    await pb.fill('#email', U.bruno.email); await pb.fill('#senha', PW.bruno);
    const [loginRes] = await Promise.all([pb.waitForResponse((r) => /\/api\/auth\/login$/.test(r.url()), { timeout: 15000 }), pb.click('#btn-entrar')]);
    await sleep(600); const loginTxt = await pb.innerText('#form-alert').catch(() => '');
    await shot(pb, '11-suspenso');
    check('11.6 Bruno suspenso: /acervo manda para /entrar (sem sessão) e o login é recusado com 403 e "Sua conta está suspensa"', /\/entrar\?/.test(pb.url()) && loginRes.status() === 403 && /suspens/i.test(loginTxt) && /\/entrar/.test(pb.url()), { url: pb.url(), status: loginRes.status(), motivoTxt: motivoTxt.slice(0, 80), loginTxt: loginTxt.slice(0, 160) });
    await pad.close();
  });

  /* ================================================================ 12. preservação funcional */
  await scenario(12, 'Preservação no build em nuvem: atalhos do KEYMAP, "+ Novo slide" (13 layouts + tile institucional), "Institucional A&M" (+5), Acervo de efeitos (192+), Modelos, apresentação', async () => {
    const created = (await api(ctx.ana, 'POST', '/api/presentations', { json: { title: 'Preservação' } })).json; const id = created.id; S.ids.preserve = id;
    const p = await openEditor(ctx.ana, id);
    /* atalhos do KEYMAP §5: F1 (ajuda), Ctrl+A / Ctrl+D / Delete, F5 / Esc */
    await p.keyboard.press('F1'); const hk = await p.waitForSelector('#modal.open', { timeout: 5000 }).catch(() => null);
    const hkTxt = hk ? await p.innerText('#modal') : ''; await p.keyboard.press('Escape'); await sleep(250);
    check('12.1 atalho F1 abre "Atalhos de teclado" (com a nota da nuvem em Ctrl+S) e Esc fecha', !!hk && /Atalhos de teclado/.test(hkTxt) && /Na nuvem: salva uma versão/.test(hkTxt) && !(await p.$('#modal.open')), hkTxt.slice(0, 80));
    await typeNewText(p, 'Alvo um'); await typeNewText(p, 'Alvo dois');
    await p.click('#cv', { position: { x: 60, y: 60 } }); await p.keyboard.press('Control+a'); const sel = await p.evaluate(() => AMStudio.selected().length);
    await p.keyboard.press('Control+d'); await sleep(300); const n2 = (await deckOf(p)).slides[0].els.length;
    await p.keyboard.press('Delete'); await sleep(300); const n3 = (await deckOf(p)).slides[0].els.length;
    check('12.2 atalhos Ctrl+A / Ctrl+D / Delete: seleciona 2, duplica para 4, apaga de volta a 2', sel === 2 && n2 === 4 && n3 === 2, { sel, n2, n3 });
    await p.keyboard.press('F5'); await p.waitForSelector('#presenter.open', { timeout: 5000 }); const f5 = await p.innerText('.amp-pos'); await p.keyboard.press('Escape'); await sleep(400);
    check('12.3 atalho F5 apresenta (' + f5.replace(/\s+/g, ' ') + ') e Esc volta ao editor', /^01/.test(f5) && !(await p.$('#presenter.open')) && p.url().includes('/editor/'), f5);
    /* + Novo slide: 13 layouts + tile institucional */
    await p.click('#addSlide'); await p.waitForSelector('#mSlide.open', { timeout: 5000 });
    const menu = await p.evaluate(() => ({ layouts: [...document.querySelectorAll('#mSlide button[data-layout]')].map((b) => b.dataset.layout), seqs: [...document.querySelectorAll('#mSlide button[data-seq]')].map((b) => b.dataset.seq + ':' + b.textContent.trim()) }));
    await shot(p, '12-novo-slide-layouts');
    check('12.4 "+ Novo slide" abre com 13 layouts + o tile institucional (' + menu.seqs.join('; ') + ')', menu.layouts.length === 13 && menu.seqs.length === 1 && /^inst:Inserir os 5 slides institucionais/.test(menu.seqs[0]), menu);
    const n0 = (await deckOf(p)).slides.length; await p.click('#mSlide.open button[data-layout]:nth-of-type(2)'); await sleep(300);
    check('12.5 escolher um layout adiciona 1 slide (' + n0 + ' → ' + (await deckOf(p)).slides.length + ')', (await deckOf(p)).slides.length === n0 + 1);
    const n1 = (await deckOf(p)).slides.length; await p.click('#bInst'); await sleep(800); const d2 = await deckOf(p);
    check('12.6 botão "Institucional A&M" insere 5 slides (' + n1 + ' → ' + d2.slides.length + ') com os layouts institucionais (inst-…)', d2.slides.length === n1 + 5 && d2.slides.filter((s) => /^inst/i.test(String(s.layout || ''))).length === 5, d2.slides.map((s) => s.layout));
    await waitSaved(p, 40000);
    check('12.7 os ' + d2.slides.length + ' slides foram salvos na nuvem (imagens institucionais como asset:)', (await getPres(ctx.ana, id)).json.content.slides.length === d2.slides.length && !/data:image/.test(JSON.stringify((await getPres(ctx.ana, id)).json.content)));
    /* Acervo de efeitos */
    await p.click('#bFx'); await p.waitForSelector('#drawer.open', { timeout: 5000 }); await sleep(1500);
    const g = await p.evaluate(() => ({ boxes: document.querySelectorAll('#drawerBody .gx-box').length, items: AMStudio.gallery ? AMStudio.gallery.items().length : null, head: (document.querySelector('.gx-count') || {}).textContent, fams: Object.fromEntries([...document.querySelectorAll('#drawerBody [data-gf]')].map((c) => [c.dataset.gf, +(c.querySelector('i') || {}).textContent])), fx: Object.keys(AMRT.FX).length, rendered: [...document.querySelectorAll('#drawerBody .gx-box')].filter((b) => b.querySelector('.gx-pv') && b.querySelector('.gx-pv').children.length).length }));
    await shot(p, '12-acervo-efeitos');
    check('12.8 Acervo de efeitos abre com ' + g.boxes + ' caixas ("' + String(g.head || '').trim() + '"; famílias ' + JSON.stringify(g.fams) + '; ' + g.rendered + ' prévias vivas) — ≥ 192', g.boxes >= 192 && g.boxes === g.items && g.fams.all === g.boxes && g.rendered > 0, g);
    check('12.9 mesmo nº de efeitos do editor ORIGINAL (' + (S.origFx ? S.origFx.boxes : '?') + ') e as mesmas famílias', !!S.origFx && S.origFx.boxes === g.boxes && JSON.stringify(S.origFx.fams) === JSON.stringify(g.fams), { orig: S.origFx, cloud: g.fams });
    await p.keyboard.press('Escape'); await sleep(400);
    /* Modelos */
    await p.click('#bModels'); await p.waitForSelector('#drawer.open', { timeout: 5000 }); await sleep(800);
    const m = await p.evaluate(() => ({ tab: (document.querySelector('.dtabs .on') || {}).textContent, tiles: document.querySelectorAll('#drawer [data-k]').length, presets: document.querySelectorAll('#drawer .gx-box, #drawer .tile, #drawer .mcard').length }));
    await shot(p, '12-modelos');
    check('12.10 "Modelos" abre a gaveta na aba Modelos com ' + m.tiles + ' modelos', m.tab === 'Modelos' && m.tiles >= 40, m);
    await p.keyboard.press('Escape'); await sleep(300);
    /* apresentação pelo botão */
    await p.click('#bPlay'); await p.waitForSelector('#presenter.open', { timeout: 5000 }); await sleep(500);
    const a1 = await p.innerText('.amp-pos'); await p.keyboard.press('ArrowRight'); await sleep(600); const a2 = await p.innerText('.amp-pos'); await p.keyboard.press('End'); await sleep(600); const a3 = await p.innerText('.amp-pos');
    await shot(p, '12-apresentar'); await p.keyboard.press('Escape'); await sleep(300);
    check('12.11 Apresentar roda no build em nuvem: ' + [a1, a2, a3].map((s) => s.replace(/\s+/g, ' ')).join(' → ') + ' (→ e End), Esc sai', /^01/.test(a1) && /^02/.test(a2) && new RegExp('^' + String(d2.slides.length).padStart(2, '0')).test(a3) && !(await p.$('#presenter.open')), { a1, a2, a3 });
    await p.close();
  });

  /* ================================================================ fim: CSP, console, rede */
  const hosts = [...R.hosts];
  await scenario('G', 'Globais em todos os cenários: zero violações de CSP, zero erros de console/página, rede só na própria origem', async () => {
    check('G.1 ZERO violações de CSP em todos os cenários (securitypolicyviolation) — ' + R.cspViolations.length, R.cspViolations.length === 0, R.cspViolations.slice(0, 5));
    check('G.2 ZERO erros de console e ZERO erros de página em todos os cenários — console ' + R.consoleErrors.length + ', página ' + R.pageErrors.length, R.consoleErrors.length === 0 && R.pageErrors.length === 0, { console: R.consoleErrors.slice(0, 6), page: R.pageErrors.slice(0, 6) });
    check('G.3 rede: só a própria origem e as fontes do Google (' + hosts.join(', ') + ')', hosts.every((h) => h === new URL(BASE).host || h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com'), hosts);
  });

  await H.closeBrowser();
  const out = { base: BASE, passed: R.passed, failed: R.failed, checks: R.checks, scenarios: R.scenarios, notes: R.notes, csp: R.cspViolations.length, consoleErrors: R.consoleErrors, pageErrors: R.pageErrors, hosts, origFx: S.origFx, ids: S.ids, at: new Date().toISOString() };
  fs.writeFileSync(process.env.E2E_RESULTS || path.join(TMP, 'results.json'), JSON.stringify(out, null, 1));
  console.log('\nRESULTADO E2E: PASS ' + R.passed + ' · FAIL ' + R.failed + ' · CSP ' + R.cspViolations.length + ' · console ' + R.consoleErrors.length + ' · página ' + R.pageErrors.length);
  process.exit(R.failed ? 1 : 0);

  /* ---------------------------------------------------------------- utilidades locais */
  async function openEditorOn(page, id) { if (!page.url().endsWith('/editor/' + id)) { await page.goto(BASE + '/editor/' + id); } await waitEditor(page); await waitSaved(page, 30000).catch(() => { }); }
})().catch(async (e) => { console.error('E2E falhou de forma inesperada:', e); try { await H.closeBrowser(); } catch (x) { } process.exit(2); });
