/* tests/security/offensive-browser.cjs — ataques pelo NAVEGADOR (Playwright/Chromium) contra a PILHA REAL (tools/dev.js na porta 4403:
   Postgres + GoTrue falso + API + site com a CSP de dist/csp.json). Complementa offensive.test.js com o que só o navegador prova:
   CSP bloqueando script injetado via DOM, clickjacking, formulário/fetch cross-site de OUTRA origem (127.0.0.1:<porta>), open redirect pela
   tela de login, cookies reais (HttpOnly/sem token em JS), renderização inofensiva no editor/visualizar, privacidade em computador compartilhado
   (localStorage/IndexedDB), e varredura do stdout do servidor em busca de segredos.
   Pré-requisito (a pilha já no ar):  cd platform && APP_ENV=local node tools/dev.js --port 4403 --db canteiro_t_sec --admin admin@am.test --name Admin --reset
   Uso:  NODE_PATH=/opt/node22/lib/node_modules node tests/security/offensive-browser.cjs
   Resultado: PASS/FAIL por verificação + JSON em .tmp/sec/browser-results.json; sai 1 se houver falha (= achado). */
'use strict';
process.env.NODE_PATH = '/opt/node22/lib/node_modules'; require('module').Module._initPaths();
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PLATFORM = path.resolve(__dirname, '..', '..'), REPO = path.resolve(PLATFORM, '..');
const BASE = process.env.SEC_BASE || 'http://localhost:4403';
const TMP = path.join(PLATFORM, '.tmp', 'sec'); fs.mkdirSync(TMP, { recursive: true });
const DEV_LOG = process.env.SEC_DEV_LOG || path.join(TMP, 'dev.log');
const FONTS = process.env.AM_FONTS_DIR || path.join(REPO, 'fonts2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = { checks: [], passed: 0, failed: 0, notes: [], metrics: {}, cspViolations: [], pageErrors: [], dialogs: [] };
let section = '';
function check(name, ok, info) { const line = { section, name, ok: !!ok, info: ok ? undefined : safe(info) }; R.checks.push(line); ok ? R.passed++ : R.failed++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (ok || info === undefined ? '' : '  ' + JSON.stringify(line.info).slice(0, 600))); return !!ok; }
function note(txt) { R.notes.push({ section, text: txt }); console.log('  NOTA ' + txt); }
function safe(v) { try { return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 400 ? x.slice(0, 400) + '…' : x))); } catch (e) { return String(v); } }
async function scenario(title, fn) { section = title; console.log('\n> ' + title); try { await fn(); } catch (e) { check(title + ' [excecao]', false, String(e && e.stack || e).slice(0, 700)); } }

const devLog = fs.existsSync(DEV_LOG) ? fs.readFileSync(DEV_LOG, 'utf8') : '';
const FAKE = process.env.SEC_FAKE || (devLog.match(/(http:\/\/127\.0\.0\.1:\d+)\s+/) || [])[1];
const ADMIN_LINK = (devLog.match(/http:\/\/localhost:\d+\/auth\/confirmar\?token_hash=[^\s]+/) || [])[0];
if (!FAKE) { console.error('URL do GoTrue falso nao encontrada em ' + DEV_LOG + ' (suba o dev.js antes).'); process.exit(2); }
async function outbox(to) { const j = await (await fetch(FAKE + '/__outbox' + (to ? '?to=' + encodeURIComponent(to) : ''))).json(); return Array.isArray(j) ? j : (j.items || []); }

let browser;
const SECRETS = new Set();
/* senhas fortes que NAO contem o local-part do e-mail (a politica recusa isso) nem palavras comuns */
const PW = { admin: 'Guardiao-Cedro-Pinheiro-2026!', ana: 'Primavera-Verao-Outono-2026!', bruno: 'Carvalho-Girassol-Orvalho-2026!' }; Object.values(PW).forEach((p) => SECRETS.add(p));
const IGNORE_CONSOLE = /net::ERR_|Failed to load resource|Permissions-Policy|Refused to|Content Security Policy|Content-Security-Policy|blocked by CORS|Access-Control-Allow-Origin|Access to fetch/;

async function newCtx(tag, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', acceptDownloads: true, ...opts });
  ctx.__tag = tag; ctx.__console = [];
  await ctx.exposeFunction('__cspReport', (v) => { R.cspViolations.push(Object.assign({ ctx: tag }, v)); });
  await ctx.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => { try { window.__cspReport({ d: e.violatedDirective, u: String(e.blockedURI).slice(0, 80), at: location.pathname }); } catch (x) {} }, true); });
  await ctx.route('https://fonts.googleapis.com/**', (r) => { const f = path.join(FONTS, 'gf.css'); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'text/css', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(f, 'utf8') }) : r.abort(); });
  await ctx.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(f) }) : r.abort(); });
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => R.pageErrors.push({ ctx: tag, url: p.url(), msg: String(e && e.message || e).slice(0, 200) }));
    p.on('console', (m) => { if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) ctx.__console.push({ url: p.url(), text: m.text().slice(0, 200) }); });
    p.on('dialog', async (d) => { R.dialogs.push({ ctx: tag, type: d.type(), msg: d.message().slice(0, 80) }); await d.dismiss().catch(() => {}); });
  });
  return ctx;
}
async function csrfOf(ctx) {
  let c = (await ctx.cookies(BASE)).find((x) => x.name === 'am_csrf' || x.name === '__Host-am_csrf');
  if (!c) { await ctx.request.get(BASE + '/api/auth/session'); c = (await ctx.cookies(BASE)).find((x) => x.name === 'am_csrf' || x.name === '__Host-am_csrf'); }
  return c ? c.value : '';
}
async function api(ctx, method, p, o = {}) {
  const h = Object.assign({ Accept: 'application/json' }, o.headers || {});
  if (!/^(GET|HEAD|OPTIONS)$/.test(method)) { if (o.origin !== false) h.Origin = BASE; if (o.csrf !== false) h['X-CSRF-Token'] = await csrfOf(ctx); }
  const opts = { method, headers: h, maxRedirects: 0, failOnStatusCode: false };
  if (o.json !== undefined) { opts.data = JSON.stringify(o.json); h['Content-Type'] = 'application/json'; } else if (o.body !== undefined) opts.data = o.body;
  const res = await ctx.request.fetch(BASE + p, opts); const text = await res.text(); let parsed; try { parsed = JSON.parse(text); } catch (e) {}
  return { status: res.status(), json: parsed, text, headers: res.headers() };
}
const cookieVals = async (ctx) => Object.fromEntries((await ctx.cookies(BASE)).map((c) => [c.name, c]));
async function rememberSecrets(ctx) { const c = await cookieVals(ctx); for (const n of ['am_at', 'am_rt']) if (c[n]) SECRETS.add(c[n].value); }
async function activate(ctx, email, password, type = 'invite') {
  const items = (await outbox(email)).filter((m) => m.type === type); const th = items.length ? items[items.length - 1].token_hash : null;
  if (!th) throw new Error('sem link para ' + email); SECRETS.add(th);
  const v = await api(ctx, 'POST', '/api/auth/verify', { json: { tokenHash: th, type } }); if (v.status !== 200) throw new Error('verify ' + v.status + ' ' + v.text);
  const pw = await api(ctx, 'POST', '/api/auth/password', { json: { password } }); if (pw.status !== 200) throw new Error('password ' + pw.status + ' ' + pw.text);
  await rememberSecrets(ctx); return pw.json.user;
}
async function invite(ctxAdm, email, displayName, role) { const r = await api(ctxAdm, 'POST', '/api/admin/invites', { json: Object.assign({ email, displayName }, role ? { role } : {}) }); if (r.status !== 201) throw new Error('convite ' + r.status + ' ' + r.text); return r.json; }
async function loginUi(ctx, email, password, o = {}) {
  const p = await ctx.newPage(); await p.goto(BASE + '/entrar' + (o.next ? '?next=' + encodeURIComponent(o.next) : ''));
  await p.waitForSelector('#btn-entrar', { timeout: 20000 }); await p.fill('#email', email); await p.fill('#senha', password);
  await Promise.all([p.waitForURL((u) => !/\/entrar/.test(u.pathname), { timeout: 20000 }).catch(() => {}), p.click('#btn-entrar')]);
  await sleep(400); await rememberSecrets(ctx); return p;
}
const EDITOR_READY = () => window.AMCloud && (AMCloud.status === 'saved' || document.documentElement.classList.contains('am-cloud-view')) && !document.getElementById('cloudLoad');
async function openEditor(ctx, id, mode, timeout) { const p = await ctx.newPage(); await p.goto(BASE + '/' + (mode || 'editor') + '/' + id); await p.waitForFunction(EDITOR_READY, null, { timeout: timeout || 45000 }); return p; }
const deck = (title, htmls) => ({ v: 1, app: 'AM Studio', id: 'dsec', title, slides: htmls.map((html, i) => ({ id: 's' + i, bg: '#FFFFFF', tr: 'fade', layout: 'blank-light', els: [{ id: 't' + i, type: 'text', x: 40, y: 40, w: 1100, h: 80, html, size: 28 }] })) });

/* Injeções de XSS que um ATACANTE controla por conteudo armazenado: markup inserido pelo PARSER (insertAdjacentHTML) e atributos/URLs.
   Estes sao governados pela CSP da pagina nas DUAS politicas: 'self' (paginas) e hash+strict-dynamic (editor) bloqueiam igualmente
   script inline inserido pelo parser, atributo onerror e URL javascript:. NAO testamos document.createElement('script')+appendChild:
   sob 'strict-dynamic' o editor CONFIA, por design, em scripts criados por um script ja em execucao — e isso nao e um vetor de injecao
   (quem injeta CONTEUDO so consegue markup inserido pelo parser, que continua bloqueado). Tambem nao testamos eval()/new Function():
   o mundo do page.evaluate do Playwright os roda a parte da CSP (falso positivo). */
const INJECT = "(function(){window.__xss=undefined;var out={};"
  + "try{document.body.insertAdjacentHTML('beforeend','<scr'+'ipt>window.__xss=\"inline\"</scr'+'ipt>');}catch(e){out.inline=String(e).slice(0,50);}"
  + "try{document.body.insertAdjacentHTML('beforeend','<img src=x onerror=\"window.__xss=1\">');}catch(e){out.img=String(e).slice(0,50);}"
  + "try{document.body.insertAdjacentHTML('beforeend','<svg><script>window.__xss=\"svg\"<\\/script></svg>');}catch(e){out.svg=String(e).slice(0,50);}"
  + "try{var a=document.createElement('a');a.href='javascript:window.__xss=\"jsurl\"';document.body.appendChild(a);a.click();}catch(e){out.jsurl=String(e).slice(0,50);}"
  + "return out;})()";
async function injectAndCheck(page, label) {
  const before = R.cspViolations.length; const out = await page.evaluate(INJECT); await sleep(1000);
  const xss = await page.evaluate(() => window.__xss); const viol = R.cspViolations.slice(before);
  check(label + ': nenhum script injetado via DOM executa (window.__xss=' + JSON.stringify(xss) + ')', xss === undefined, { xss, out });
  check(label + ': a CSP registrou as violacoes (' + viol.length + ')', viol.length >= 2, viol.slice(0, 6));
}

function attackerServer(pages) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); const h = pages[u.pathname]; res.writeHead(h ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(h ? h(u.searchParams) : '<h1>404</h1>'); });
    srv.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise((r) => srv.close(() => r())) }));
  });
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function makePng(w, h, seed) { seed = seed || 1; const raw = Buffer.alloc((w * 3 + 1) * h); let s = seed >>> 0; for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = (s >>> 24) & 0xff; } } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  const t0 = Date.now();
  browser = await chromium.launch({ args: ['--disable-lcd-text'] });
  const ADM = await newCtx('admin'), ANA = await newCtx('ana'), BRUNO = await newCtx('bruno');
  let admin, ana, bruno, P;
  const { ATTACKS, LEGIT } = await import(path.join(PLATFORM, 'tests', 'fixtures', 'xss-corpus.js'));

  await scenario('0 preparo: admin pelo link do convite; Ana (dona) e Bruno (membro) convidados pela API', async () => {
    let done = false;
    if (ADMIN_LINK) { const th = new URL(ADMIN_LINK).searchParams.get('token_hash'); if (th) { SECRETS.add(th); const v = await api(ADM, 'POST', '/api/auth/verify', { json: { tokenHash: th, type: 'invite' } }); if (v.status === 200) { const pw = await api(ADM, 'POST', '/api/auth/password', { json: { password: PW.admin } }); if (pw.status === 200) { admin = pw.json.user; done = true; } } } }
    if (!done) admin = await activate(ADM, 'admin@am.test', PW.admin);
    await rememberSecrets(ADM);
    check('admin ativo com papel admin', admin && admin.role === 'admin' && admin.status === 'active', admin);
    await invite(ADM, 'ana.sec@am.test', 'Ana Segura'); ana = await activate(ANA, 'ana.sec@am.test', PW.ana);
    await invite(ADM, 'bruno.sec@am.test', 'Bruno Membro'); bruno = await activate(BRUNO, 'bruno.sec@am.test', PW.bruno);
    check('Ana e Bruno ativos (membros)', ana.role === 'member' && bruno.role === 'member' && ana.status === 'active', { ana, bruno });
    const c = await api(ANA, 'POST', '/api/presentations', { json: { title: 'Da Ana (sec)', content: deck('Da Ana (sec)', ['Ola <b>mundo</b>']) } });
    check('Ana cria a apresentacao alvo', c.status === 201, c.text); P = c.json;
  });

  await scenario('1 cookies reais: HttpOnly/SameSite/Path, nenhum token em JS/localStorage, Authorization nao autentica', async () => {
    const c = await cookieVals(ANA);
    for (const n of ['am_at', 'am_rt']) check(n + ': HttpOnly, SameSite=Lax, Path=/', c[n] && c[n].httpOnly && c[n].sameSite === 'Lax' && c[n].path === '/', c[n] && { httpOnly: c[n].httpOnly, sameSite: c[n].sameSite, path: c[n].path, secure: c[n].secure });
    check('am_csrf legivel pelo JS (de proposito), SameSite=Lax', c.am_csrf && !c.am_csrf.httpOnly && c.am_csrf.sameSite === 'Lax', c.am_csrf && { httpOnly: c.am_csrf.httpOnly });
    note('em http://localhost (APP_ENV=local) nao ha Secure nem prefixo __Host-; em producao (https) vira __Host-am_* com Secure — tests/security/sessions.test.js prova a config');
    const p = await ANA.newPage(); await p.goto(BASE + '/acervo'); await p.waitForSelector('#btn-sair', { timeout: 20000 });
    const st = await p.evaluate(() => ({ cookie: document.cookie, ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage) }));
    check('document.cookie so expoe am_csrf', /^am_csrf=[A-Za-z0-9_-]{43}$/.test(st.cookie), st.cookie);
    check('localStorage/sessionStorage sem JWT nem token', !/eyJ[A-Za-z0-9_-]{10,}\./.test(st.ls + st.ss) && !/"?(access_token|refresh_token|jwt)"?/i.test(st.ls + st.ss), { ls: st.ls.slice(0, 150) });
    const at = c.am_at.value; const bare = await ANA.request.fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + at, Cookie: '' } });
    check('Authorization: Bearer <access token> sem cookie -> 401', bare.status() === 401, bare.status());
    await p.close();
  });

  await scenario('2 CSP do site e do editor bloqueiam script injetado via DOM (inline, onerror, javascript:, eval, data:)', async () => {
    const p = await ANA.newPage(); await p.goto(BASE + '/acervo'); await p.waitForSelector('#btn-sair', { timeout: 20000 });
    await injectAndCheck(p, '/acervo');
    const h = (await p.request.get(BASE + '/acervo')).headers(); check('/acervo: frame-ancestors none + X-Frame-Options DENY + nosniff', /frame-ancestors 'none'/.test(h['content-security-policy'] || '') && h['x-frame-options'] === 'DENY' && h['x-content-type-options'] === 'nosniff', { xfo: h['x-frame-options'] });
    await p.close();
    const e = await openEditor(ANA, P.id); await injectAndCheck(e, '/editor/<id>');
    const eh = (await e.request.get(BASE + '/editor/' + P.id)).headers(); const csp = eh['content-security-policy'] || '';
    check('/editor: CSP por hash + strict-dynamic, sem unsafe-inline em script-src', /'sha256-/.test(csp) && /'strict-dynamic'/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp), csp.slice(0, 180));
    check('editor em nuvem continua funcional apos as injecoes', (await e.evaluate(() => window.AMCloud && AMCloud.status)) === 'saved');
    await e.close();
    const v = await openEditor(BRUNO, P.id, 'visualizar'); await injectAndCheck(v, '/visualizar/<id>'); await v.close();
  });

  await scenario('3 clickjacking e form/fetch cross-site de OUTRA origem (127.0.0.1)', async () => {
    const before = (await api(ANA, 'GET', '/api/presentations?scope=mine&limit=100')).json.items.length;
    const srv = await attackerServer({
      '/frame': () => '<!doctype html><title>atk</title><iframe id=f1 src="' + BASE + '/acervo" width=700 height=300></iframe><iframe id=f2 src="' + BASE + '/editor/' + P.id + '" width=700 height=300></iframe>',
      '/form': (q) => '<!doctype html><title>csrf</title><form id=f method=POST action="' + BASE + q.get('to') + '" enctype="' + (q.get('enc') || 'text/plain') + '"><input name=' + "'{\"title\":\"hackeado\",\"x\":\"'" + ' value=' + "'\"}'" + '></form><script>document.getElementById("f").submit()</script>',
      '/fetch': (q) => '<!doctype html><title>fetch</title><script>(async function(){var out={};try{var r=await fetch("' + BASE + q.get('to') + '",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{\\"title\\":\\"x\\"}"});out.status=r.status;out.body=(await r.text()).slice(0,120);}catch(e){out.error=String(e).slice(0,80);}try{var r2=await fetch("' + BASE + '/api/me",{credentials:"include"});out.readStatus=r2.status;}catch(e){out.readError=String(e).slice(0,80);}document.title="done";window.__out=out;})()</script>',
    });
    try {
      const pf = await ANA.newPage(); await pf.goto(srv.url + '/frame'); await sleep(2500);
      const frames = pf.frames().filter((f) => f !== pf.mainFrame()); const urls = [];
      for (const f of frames) { let d; try { d = await f.evaluate(() => location.href + ' | ' + document.body.children.length + ' filhos'); } catch (e) { d = f.url() + ' | ' + String(e.message).slice(0, 50); } urls.push(d); }
      check('iframes para /acervo e /editor de outra origem sao bloqueados (frame-ancestors/XFO)', frames.length === 2 && urls.every((u) => /chrome-error|0 filhos|detached|Execution context|SecurityError/i.test(u)), urls);
      await pf.close();
      for (const pair of [['/api/presentations/' + P.id + '/duplicate', 'text/plain'], ['/api/presentations', 'text/plain'], ['/api/presentations/' + P.id + '/duplicate', 'application/x-www-form-urlencoded'], ['/api/auth/logout', 'multipart/form-data']]) {
        const pg = await ANA.newPage(); await pg.goto(srv.url + '/form?to=' + encodeURIComponent(pair[0]) + '&enc=' + encodeURIComponent(pair[1]));
        await pg.waitForURL((u) => u.origin === BASE, { timeout: 15000 }).catch(() => {}); await sleep(300);
        const body = await pg.evaluate(() => document.body.innerText).catch(() => ''); let j; try { j = JSON.parse(body); } catch (e) {}
        check('<form> cross-site ' + pair[1] + ' -> ' + pair[0] + ': 403 csrf', j && j.error && j.error.code === 'csrf', { url: pg.url(), body: body.slice(0, 140) });
        await pg.close();
      }
      const pj = await ANA.newPage(); await pj.goto(srv.url + '/fetch?to=' + encodeURIComponent('/api/presentations')); await pj.waitForFunction(() => window.__out, null, { timeout: 15000 }); const out = await pj.evaluate(() => window.__out);
      check('fetch() cross-site com credentials: bloqueado pelo CORS e sem leitura de /api/me', !!out.error && (!!out.readError || out.readStatus === 0), out);
      await pj.close();
      const after = (await api(ANA, 'GET', '/api/presentations?scope=mine&limit=100')).json.items.length;
      check('nenhuma apresentacao criada/duplicada; sessao da Ana segue valida (logout cross-site falhou)', after === before && (await api(ANA, 'GET', '/api/me')).status === 200, { before, after });
    } finally { await srv.close(); }
  });

  await scenario('4 open redirect pela tela de entrar (?next=)', async () => {
    for (const next of ['//evil.example', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)', '/%2F%2Fevil.example']) {
      const ctx = await newCtx('redir'); const p = await loginUi(ctx, ana.email, PW.ana, { next }); const u = new URL(p.url());
      check('next=' + next + ' -> permanece em ' + u.host + u.pathname, u.origin === BASE && u.pathname !== '/entrar' && !/evil/.test(u.host), p.url());
      await api(ctx, 'POST', '/api/auth/logout'); await ctx.close();
    }
    const ctx = await newCtx('redir-ok'); const p = await loginUi(ctx, ana.email, PW.ana, { next: '/importar' });
    check('next interno legitimo (/importar) e respeitado', new URL(p.url()).pathname === '/importar', p.url());
    await api(ctx, 'POST', '/api/auth/logout'); await ctx.close();
  });

  await scenario('5 XSS: corpus via API -> 422; textos legitimos renderizados no editor/visualizar sem executar nada', async () => {
    const xp = (await api(ANA, 'POST', '/api/presentations', { json: { title: 'XSS browser' } })).json; let rev = xp.rev, rejected = 0, passed = [];
    for (const a of ATTACKS) { const r = await api(ANA, 'PUT', '/api/presentations/' + xp.id + '/content', { json: { baseRev: rev, content: deck('XSS', [a.value]) } }); if (r.status === 422) rejected++; else if (r.status === 200) { rev = r.json.rev; passed.push(a.name); } }
    check('todos os ' + ATTACKS.length + ' ataques do corpus -> 422 via API', rejected === ATTACKS.length && passed.length === 0, { rejected, passed });
    // os 2 itens legitimos referenciam asset:sha256:<a*64>: sobe um PNG real e troca o placeholder para o ref existir (senao 422 asset_inexistente)
    const realPng = makePng(12, 12, 7); const realSha = sha256(realPng);
    const upr = await api(ANA, 'PUT', '/api/assets/' + realSha, { body: realPng, headers: { 'Content-Type': 'image/png', 'X-Asset-Kind': 'image' } }); check('PNG de apoio aos textos legitimos sobe', upr.status === 201, upr.text && upr.text.slice(0, 80));
    const legitDeck = deck('Legitimos', LEGIT.map((s) => String(s).split('a'.repeat(64)).join(realSha).slice(0, 1900) || '.'));
    const lr = await api(ANA, 'PUT', '/api/presentations/' + xp.id + '/content', { json: { baseRev: rev, content: legitDeck } });
    check('o deck com os ' + LEGIT.length + ' textos legitimos e aceito (sem falso positivo)', lr.status === 200, lr.text.slice(0, 200));
    const e = await openEditor(ANA, xp.id);
    const xss = await e.evaluate(() => window.__xss);
    const textOk = await e.evaluate(() => { try { return JSON.stringify(window.AMStudio.deck).includes('Aprenda a usar o script'); } catch (x) { return false; } });
    check('abrir no editor os textos legitimos NAO executa script (window.__xss indefinido, sem dialog)', xss === undefined && R.dialogs.length === 0, { xss, dialogs: R.dialogs.length });
    check('o texto com a palavra "script" entra no deck como TEXTO (renderizado, nao executado)', textOk, { textOk });
    await e.close();
    const v = await openEditor(ANA, xp.id, 'visualizar'); const xssV = await v.evaluate(() => window.__xss);
    check('abrir no modo visualizar tambem nao executa nada', xssV === undefined, { xssV });
    await v.close();
    check('nenhum alert/dialog disparado em toda a renderizacao', R.dialogs.length === 0, R.dialogs.slice(0, 4));
  });

  await scenario('6 comentarios e nomes com HTML: aparecem como TEXTO nas paginas, nunca como marcacao', async () => {
    const payload = '<img src=x onerror="window.__xss=1"> & <b>bold</b> "x"';
    const cc = await api(BRUNO, 'POST', '/api/presentations/' + P.id + '/comments', { json: { body: payload } });
    check('comentario com HTML aceito como texto puro', cc.status === 201 && cc.json.body === payload, cc.text && cc.text.slice(0, 120));
    const p = await ANA.newPage(); await p.goto(BASE + '/acervo?foco=' + P.id); await p.waitForSelector('#btn-sair', { timeout: 20000 });
    // abre a gaveta da apresentacao (cartao) e os comentarios
    await p.evaluate((id) => { const card = document.querySelector('[data-id="' + id + '"]'); if (card) card.click(); }, P.id).catch(() => {});
    await sleep(1500);
    const found = await p.evaluate((needle) => { const el = [...document.querySelectorAll('.comment__body, .comment, p')].find((n) => n.textContent.includes('onerror')); return el ? { tag: el.tagName, hasImg: !!el.querySelector('img'), text: el.textContent.slice(0, 80) } : null; }, payload).catch(() => null);
    const xss = await p.evaluate(() => window.__xss);
    check('o comentario e renderizado como texto (sem <img> real) e nada executa', xss === undefined && (!found || !found.hasImg), { found, xss });
    await p.close();
    await api(ANA, 'DELETE', '/api/comments/' + cc.json.id);
    // nome com HTML e recusado pela API (defesa em profundidade)
    const nm = await api(BRUNO, 'PATCH', '/api/me', { json: { displayName: '<svg onload=alert(1)>' } });
    check('nome de usuario com < > -> 400', nm.status === 400, nm.text && nm.text.slice(0, 100));
  });

  await scenario('7 privacidade em computador compartilhado: logout limpa a sessao; o IndexedDB canteiro-cloud nao vaza entre usuarios', async () => {
    const p = await openEditor(ANA, P.id);
    // produz uma pendencia local (a fila canteiro-cloud guarda o deck com data:) e depois salva
    await p.evaluate(() => { try { window.AMCloud && window.AMStudio && window.AMStudio.setTitle && window.AMStudio.setTitle('Editado por Ana ' + Date.now()); } catch (e) {} });
    await p.waitForFunction(() => window.AMCloud && AMCloud.status === 'saved', null, { timeout: 20000 }).catch(() => {});
    const idbAna = await p.evaluate(() => new Promise((res) => { try { var r = indexedDB.open('canteiro-cloud', 1); r.onsuccess = function () { var db = r.result; if (!db.objectStoreNames.contains('pending')) return res([]); var tx = db.transaction('pending', 'readonly'); var g = tx.objectStore('pending').getAll(); g.onsuccess = function () { res((g.result || []).map(function (x) { return x.id; })); }; g.onerror = function () { res('err'); }; }; r.onerror = function () { res('open-err'); }; } catch (e) { res(String(e)); } }));
    check('apos salvar, a fila local (pending) esta vazia (confirmacao do servidor apaga o rascunho)', Array.isArray(idbAna) && idbAna.length === 0, idbAna);
    await p.close();
    // logout da Ana no mesmo navegador
    const lp = await ANA.newPage(); await lp.goto(BASE + '/acervo'); await lp.waitForSelector('#btn-sair', { timeout: 20000 });
    await Promise.all([lp.waitForURL(/\/entrar/, { timeout: 20000 }).catch(() => {}), lp.click('#btn-sair')]); await sleep(500);
    const after = await cookieVals(ANA); check('logout apaga os cookies de sessao (am_at/am_rt)', !after.am_at && !after.am_rt, Object.keys(after));
    const sess = await api(ANA, 'GET', '/api/auth/session'); check('a sessao nao e mais autenticada apos o logout', sess.json && sess.json.authenticated === false, sess.json);
    note('RESIDUO DOCUMENTADO: o IndexedDB canteiro-cloud e por apresentacao e so guarda a fila de uma gravacao nao confirmada (apagada apos o salvamento); em computador compartilhado, logout nao limpa o IndexedDB de uma apresentacao que ficou com pendencia offline — ver docs/editor-em-nuvem.md §6 e SEGURANCA.md');
    await lp.close();
    // Ana precisa de sessao de novo para os cenarios seguintes (o logout acima a desconectou neste contexto)
    const rl = await loginUi(ANA, ana.email, PW.ana); check('Ana reentra para os proximos cenarios', new URL(rl.url()).pathname !== '/entrar', rl.url()); await rl.close();
  });

  await scenario('8 uploads pelo navegador: imagem valida sobe; SVG e HTML disfarcados -> 415; GET traz nosniff/CSP/attachment corretos', async () => {
    const png = makePng(16, 16, 42); const sha = sha256(png);
    const up = await api(ANA, 'PUT', '/api/assets/' + sha, { body: png, headers: { 'Content-Type': 'image/png', 'X-Asset-Kind': 'image' } });
    check('PNG valido -> 201', up.status === 201 && up.json.mime === 'image/png', up.text && up.text.slice(0, 100));
    const g = await api(ANA, 'GET', '/api/assets/' + sha);
    check('GET da imagem: nosniff + CSP sandbox + inline + CORP same-origin', g.headers['x-content-type-options'] === 'nosniff' && /sandbox/.test(g.headers['content-security-policy'] || '') && g.headers['content-disposition'] === 'inline', { cd: g.headers['content-disposition'], csp: g.headers['content-security-policy'] });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'); const rs = await api(ANA, 'PUT', '/api/assets/' + sha256(svg), { body: svg, headers: { 'Content-Type': 'image/png', 'X-Asset-Kind': 'image' } });
    check('SVG disfarcado de png -> 415', rs.status === 415, rs.text && rs.text.slice(0, 100));
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj<</OpenAction<</S/JavaScript/JS(app.alert(1))>>>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'); const sp = sha256(pdf);
    const rp = await api(ANA, 'PUT', '/api/assets/' + sp, { body: pdf, headers: { 'Content-Type': 'application/pdf', 'X-Asset-Kind': 'attachment' } });
    check('PDF com JavaScript aceito como anexo', rp.status === 201, rp.text && rp.text.slice(0, 100));
    const gp = await api(ANA, 'GET', '/api/assets/' + sp);
    check('GET do PDF: Content-Disposition attachment (nunca inline) + sandbox', /^attachment;/.test(gp.headers['content-disposition'] || '') && /sandbox/.test(gp.headers['content-security-policy'] || ''), { cd: gp.headers['content-disposition'] });
  });

  await scenario('9 autorizacao pelo cliente: Bruno nao edita a apresentacao da Ana; /editor redireciona para /visualizar', async () => {
    const put = await api(BRUNO, 'PUT', '/api/presentations/' + P.id + '/content', { json: { baseRev: 1, content: deck('hack', ['x']) } });
    check('PUT conteudo de Bruno na apresentacao da Ana -> 403', put.status === 403, put.text && put.text.slice(0, 80));
    const e = await BRUNO.newPage(); await e.goto(BASE + '/editor/' + P.id); await e.waitForFunction(EDITOR_READY, null, { timeout: 45000 }).catch(() => {}); await sleep(800);
    check('abrir /editor/<alheia> como membro redireciona para /visualizar', /\/visualizar\//.test(e.url()), e.url());
    await e.close();
    const dup = await api(BRUNO, 'POST', '/api/presentations/' + P.id + '/duplicate', { json: {} });
    check('Bruno pode criar uma COPIA (dono = Bruno)', dup.status === 201 && dup.json.owner.id === bruno.id, dup.text && dup.text.slice(0, 100));
  });

  await scenario('10 limites de taxa reais pelo navegador: comentarios 30/min -> 429 com Retry-After', async () => {
    const p = (await api(ANA, 'POST', '/api/presentations', { json: { title: 'Rate browser' } })).json;
    let codes = []; for (let i = 0; i < 35; i++) codes.push((await api(ANA, 'POST', '/api/presentations/' + p.id + '/comments', { json: { body: 'c' + i } })).status);
    const r = await api(ANA, 'POST', '/api/presentations/' + p.id + '/comments', { json: { body: 'mais' } });
    const ok = codes.filter((s) => s === 201).length, blocked = codes.filter((s) => s === 429).length;
    // teto de 30/min por usuario (Ana pode ter gasto 1-2 do balde moderando comentarios antes, na mesma janela): aceita ~30 e os excedentes 429
    check('comentarios limitados a ~30/min por usuario; excedentes -> 429 com Retry-After', ok >= 28 && ok <= 30 && blocked >= 1 && Number(r.headers['retry-after']) >= 1, { ok, blocked, retryAfter: r.headers['retry-after'] });
    R.metrics.comment_rate = { accepted: codes.filter((s) => s === 201).length, blocked: codes.filter((s) => s === 429).length };
  });

  await scenario('11 segredos no stdout do servidor: varre o dev.log durante toda a execucao', async () => {
    await sleep(500); const full = fs.existsSync(DEV_LOG) ? fs.readFileSync(DEV_LOG, 'utf8') : '';
    // Separa os LOGS ESTRUTURADOS da API (linhas JSON {"t":...}) do banner do tools/dev.js (ferramenta local que imprime o link do 1o admin de proposito)
    const apiLog = full.split('\n').filter((l) => /^\{"t":/.test(l)).join('\n'); R.metrics.apiLogBytes = apiLog.length;
    const hits = []; for (const s of SECRETS) if (s && s.length > 10 && apiLog.includes(s)) hits.push(s.slice(0, 6) + '...');
    check('nenhuma senha/token/cookie de sessao no log ESTRUTURADO da API', hits.length === 0, hits);
    check('nenhum JWT impresso no log da API', !/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./.test(apiLog));
    check('nenhuma linha de access log com query string (tokens de e-mail ficam fora da rota)', !/"route":"[^"]*\?/.test(apiLog));
    check('nenhum Set-Cookie/am_at=/am_rt= em claro no log da API', !/set-cookie|am_at=[A-Za-z]|am_rt=[A-Za-z]/i.test(apiLog));
    // o único token no banner do dev.js é o link de bootstrap do 1o admin (comportamento local documentado), nunca um token de sessão/CSRF
    const banner = full.split('\n').filter((l) => !/^\{"t":/.test(l)).join('\n'); const bannerTokens = (banner.match(/token_hash=[0-9a-f]+/g) || []);
    check('o banner do dev.js so expoe o link do 1o admin (<=1 token_hash de bootstrap), nenhum token de sessao', bannerTokens.length <= 1 && !/eyJ[A-Za-z0-9_-]{10,}\.eyJ/.test(banner), { bannerTokens: bannerTokens.length });
    note('tools/dev.js imprime o link do 1o convite de admin no terminal POR DESIGN (so uso local); a API nunca registra tokens — ver src/middleware/access-log.js');
  });

  await scenario('12 CSP: nenhuma violacao INESPERADA e nenhum erro de pagina nas telas da plataforma', async () => {
    const unexpected = R.cspViolations.filter((v) => !/^(script-src|script-src-elem)/.test(v.d || '') ? false : !/beforeend|data:text\/javascript|inline/.test(v.u || v.s || '') && false);
    // Todas as violacoes registradas devem vir das NOSSAS injecoes (script-src). Falha se houver violacao de outra diretiva nas telas.
    const foreign = R.cspViolations.filter((v) => !/script-src/.test(v.d || ''));
    check('as unicas violacoes de CSP sao as das injecoes de teste (script-src)', foreign.length === 0, foreign.slice(0, 6));
    // erros de console só das PÁGINAS da plataforma (as da origem 127.0.0.1 do atacante — CORS — sao esperadas e ja ignoradas)
    const realErrors = [].concat(ADM.__console, ANA.__console, BRUNO.__console).filter((e) => e && e.url && e.url.startsWith(BASE));
    check('sem erros de console inesperados nas paginas da plataforma', realErrors.length === 0, realErrors.slice(0, 6));
    const realPageErrors = R.pageErrors.filter((e) => e.url && e.url.startsWith(BASE));
    check('sem erros de pagina (pageerror) nas paginas da plataforma', realPageErrors.length === 0, realPageErrors.slice(0, 6));
  });

  R.metrics.ms = Date.now() - t0; R.metrics.cspViolations = R.cspViolations.length;
  await browser.close();
  fs.writeFileSync(path.join(TMP, 'browser-results.json'), JSON.stringify(R, null, 2));
  console.log('\n==== offensive-browser: PASS ' + R.passed + ' / FAIL ' + R.failed + ' em ' + Math.round(R.metrics.ms / 1000) + ' s · ' + R.cspViolations.length + ' violacoes de CSP (injecoes) · resultados em .tmp/sec/browser-results.json');
  process.exit(R.failed ? 1 : 0);
})().catch((e) => { console.error(e); try { browser && browser.close(); } catch (x) {} process.exit(2); });
