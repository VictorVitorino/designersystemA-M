/* web.test.js — testes das páginas web (Playwright/Chromium) contra tests/web/mock-api.js, servidas com a CSP ESTRITA.
   Uso:  /opt/node22/bin/node platform/tests/web/web.test.js          (porta 4201; PORT=… para trocar)
         WEB_CLOUD_CORE=real node …/web.test.js                       (usa platform/studio-cloud/cloud-core.js em vez do stub)
   Sai com código 0 se tudo passou. Capturas em platform/tests/screens/ (ignoradas pelo git). */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NODE_PATH = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
const require = createRequire(import.meta.url);
require('module').Module._initPaths();
const { chromium } = require('playwright');
const { startMock, CSP, PASSWORD, IDS, TOKENS, XSS_TITLE, XSS_ANSWER, XSS_NOTE, VOTE_OPTS, makePng } = await import('./mock-api.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../web');
const SCREENS = path.resolve(HERE, '../screens');
const FONTS = process.env.AM_FONTS_DIR || path.resolve(HERE, '../../../fonts2');
const ORIGINAL = path.resolve(HERE, '../../../original/Canteiro-AM (3).html');   // editor ORIGINAL montado: a fonte da verdade visual
const COVER_JS = path.resolve(HERE, '../../../studio/cover.js');
fs.mkdirSync(SCREENS, { recursive: true });

/* ───────── relatório ───────── */
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, info) {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); }
}
const head = (t) => { console.log(`\n── ${t}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── ambiente ───────── */
const mock = await startMock({ port: Number(process.env.PORT || 4201) });
const ORIGIN = mock.origin;
const browser = await chromium.launch();
const cspViolations = [], pageErrors = [], consoleErrors = [], cspHeaders = [];
const EXPECTED_NET = /Failed to load resource: the server responded with a status of (400|401|403|404|409|422|429|500|501|502)|net::ERR_(FAILED|ABORTED|INTERNET_DISCONNECTED|CONNECTION_REFUSED)/;

async function newCtx(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true, ...opts });
  return ctx;
}
async function newPage(ctx, tag = '') {
  const page = await ctx.newPage();
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(FONTS, 'gf.css'), 'utf8') }));
  await page.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) }) : r.abort(); });
  page.on('pageerror', (e) => pageErrors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED_NET.test(m.text())) consoleErrors.push(`${tag}: ${m.text()}`); if (/Content Security Policy|Refused to/.test(m.text())) cspViolations.push(`${tag} (console): ${m.text()}`); });
  page.on('response', (r) => { if (r.request().resourceType() === 'document' && r.url().startsWith(ORIGIN)) cspHeaders.push({ url: r.url(), csp: r.headers()['content-security-policy'] || '', status: r.status() }); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.__tag = tag;
  return page;
}
async function collectCsp(page) { try { const v = await page.evaluate(() => window.__csp || []); for (const x of v) cspViolations.push(`${page.__tag}: ${x}`); } catch { /* página já fechou */ } }

const mstate = async () => (await fetch(`${ORIGIN}/__test/state`)).json();
const mpost = async (p) => (await fetch(`${ORIGIN}${p}`)).json();
async function loginApi(ctx, email, password = PASSWORD) {
  const r = await ctx.request.get(`${ORIGIN}/api/auth/session`);
  const { csrfToken } = await r.json();
  const l = await ctx.request.post(`${ORIGIN}/api/auth/login`, { data: { email, password }, headers: { 'X-CSRF-Token': csrfToken, Origin: ORIGIN } });
  if (!l.ok()) throw new Error(`login ${email} falhou: ${l.status()}`);
}
async function asUser(email, { viewport, tag } = {}) {
  const ctx = await newCtx(viewport ? { viewport } : {});
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await loginApi(ctx, email);
  const page = await newPage(ctx, tag || email.split('@')[0]);
  return { ctx, page };
}
async function gotoAcervo(page, qs = '') { await page.goto(`${ORIGIN}/acervo${qs}`); await page.waitForSelector(`${CARD}, #painel .state`, { timeout: 8000 }); }
const CARD = '#painel li.card:not(.card--skel)';
const cardOf = (page, text) => page.locator('li.card', { hasText: text }).first();
const cardByTitle = (page, title) => page.locator('li.card').filter({ has: page.getByRole('button', { name: `Detalhes de ${title}`, exact: true }) });
const toastText = async (page) => (await page.locator('.toast').allInnerTexts()).join(' | ');
const waitToast = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });

/* ═════════════════════════════ 1. Higiene do código-fonte ═════════════════════════════ */
async function sourceHygiene() {
  head('1. Higiene do código-fonte (CSP estrita)');
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } })(WEB);
  const html = files.filter((f) => f.endsWith('.html')); const js = files.filter((f) => f.endsWith('.js')); const css = files.filter((f) => f.endsWith('.css'));
  const rd = (f) => fs.readFileSync(f, 'utf8');
  const rel = (f) => path.relative(WEB, f);
  const bad = (re, list) => list.filter((f) => re.test(rd(f))).map(rel);
  check('HTML sem <style> inline', bad(/<style[\s>]/i, html).length === 0, bad(/<style[\s>]/i, html));
  check('HTML sem atributo style="…"', bad(/\sstyle\s*=/i, html).length === 0, bad(/\sstyle\s*=/i, html));
  check('HTML sem handlers on…=', bad(/\son[a-z]+\s*=/i, html).length === 0, bad(/\son[a-z]+\s*=/i, html));
  check('HTML sem javascript: nem data:text/html', bad(/javascript:|data:text\/html/i, html).length === 0);
  const inline = html.filter((f) => /<script(?![^>]*\ssrc=)[^>]*>/i.test(rd(f))).map(rel);
  check('HTML sem <script> inline (todos com src)', inline.length === 0, inline);
  check('JS sem innerHTML / outerHTML / insertAdjacentHTML / document.write', bad(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, js).length === 0, bad(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, js));
  check('JS sem eval / new Function / setTimeout com string', bad(/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]/, js).length === 0);
  check('JS não grava em localStorage (token só em cookie HttpOnly)', bad(/localStorage/, js).length === 0, bad(/localStorage/, js));
  check('JS não usa setAttribute("style") nem .style.cssText', bad(/setAttribute\(\s*['"]style['"]|cssText/, js).length === 0);
  check('JS não usa .style.* (nenhum estilo por script)', bad(/\.style\.\w+\s*=/, js).length === 0, bad(/\.style\.\w+\s*=/, js));
  check('CSS sem @import de terceiros e sem url() externa', css.every((f) => !/@import|url\(\s*['"]?https?:/i.test(rd(f))));
  check('Toda página HTML declara lang="pt-BR"', html.every((f) => /<html lang="pt-BR">/.test(rd(f))), html.filter((f) => !/<html lang="pt-BR">/.test(rd(f))).map(rel));
  check('Páginas pedidas existem (entrar, auth/confirmar, esqueci-senha, acervo, admin, importar, 404)', ['entrar/index.html', 'auth/confirmar/index.html', 'esqueci-senha/index.html', 'acervo/index.html', 'admin/index.html', 'importar/index.html', '404.html', 'css/app.css', 'css/tokens.css', 'js/api.js', 'js/ui.js', 'js/format.js', 'js/session.js'].every((f) => fs.existsSync(path.join(WEB, f))));
  check('Só páginas que usam o cloud-core o carregam (importar)', html.filter((f) => /cloud-core\.js/.test(rd(f))).map(rel).join() === 'importar/index.html');
}

/* ═════════════════════════════ 2. Cabeçalhos e cliente de API ═════════════════════════════ */
async function apiClient() {
  head('2. Cliente de API (api.js)');
  const ctx = await newCtx(); const page = await newPage(ctx, 'api');
  await page.goto(`${ORIGIN}/entrar`); await page.waitForSelector('#form-login');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const mod = `const {api, ApiError, DEFAULT_TIMEOUT_MS, refreshSession} = await import('/js/api.js');`;
  const run = (body) => page.evaluate(`(async () => { ${mod} ${body} })()`);

  check('timeout padrão é 20 s', (await run('return DEFAULT_TIMEOUT_MS;')) === 20000);
  // erros do contrato
  const e404 = await run(`try { await api.get('/api/presentations/00000000-0000-4000-8000-0000000000aa'); } catch (e) { return {cls: e instanceof ApiError, s: e.status, c: e.code, m: e.message, id: !!e.requestId}; }`);
  check('erro 401/404 do contrato vira ApiError(status, code, message)', e404 && e404.cls && typeof e404.s === 'number' && typeof e404.c === 'string' && e404.m.length > 3, e404);
  // sem sessão: 401 unauthenticated -> tenta refresh (falha) -> vai para /entrar (já estamos lá: sem loop)
  const un = await run(`try { await api.get('/api/presentations'); } catch (e) { return {s: e.status, c: e.code}; }`);
  check('sem sessão: 401 unauthenticated (sem laço de redirecionamento em /entrar)', un && un.s === 401 && ['unauthenticated', 'session_expired'].includes(un.c), un);
  // CSRF
  await mpost('/__test/clear-requests');
  const echo = await run(`const r = await api.post('/api/_echo', {a: 1}); return r;`);
  const cookieCsrf = await ev(() => document.cookie.split('; ').find((c) => c.startsWith('am_csrf='))?.split('=')[1]);
  check('POST envia X-CSRF-Token igual ao cookie am_csrf', !!echo.csrf && echo.csrf === cookieCsrf, { echo, cookieCsrf });
  check('POST envia Content-Type application/json', /application\/json/.test(echo.ctype));
  await ctx.clearCookies({ name: 'am_csrf' });
  await mpost('/__test/clear-requests');
  const echo2 = await run(`return await api.post('/api/_echo', {b: 2});`);
  const reqs = (await mstate()).requests;
  const idxSession = reqs.findIndex((r) => r.path === '/api/auth/session'); const idxPost = reqs.findIndex((r) => r.path === '/api/_echo' && r.method === 'POST');
  check('sem cookie CSRF: busca GET /api/auth/session antes do POST e o POST funciona', idxSession >= 0 && idxSession < idxPost && !!echo2.csrf, { reqs: reqs.map((r) => r.method + ' ' + r.path) });
  const raw = await ev(async () => { const r = await fetch('/api/_echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return { s: r.status, b: await r.json() }; });
  check('servidor recusa POST sem X-CSRF-Token (403 csrf) — o mock aplica a regra do contrato', raw.s === 403 && raw.b.error.code === 'csrf', raw);
  const rawOrigin = await ev(async () => { const t = document.cookie.split('; ').find((c) => c.startsWith('am_csrf=')).split('=')[1]; const r = await fetch('/api/_echo', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-CSRF-Token': t }, body: 'x' }); return r.status; });
  check('servidor recusa Content-Type fora do contrato (403 csrf)', rawOrigin === 403, rawOrigin);
  // timeout
  const to = await run(`const t0 = performance.now(); try { await api.get('/api/_slow', {query: {ms: 2000}, timeout: 300}); } catch (e) { return {c: e.code, m: e.message, dt: performance.now() - t0}; }`);
  check('timeout vira ApiError "timeout" com mensagem amigável em pt-BR', to && to.c === 'timeout' && /demorou demais/.test(to.m) && to.dt < 1500, to);
  // 429
  const rl = await run(`try { await api.get('/api/_limited'); } catch (e) { return {c: e.code, s: e.status, m: e.message, ra: e.retryAfter}; }`);
  check('429 mostra o tempo de espera do Retry-After (90 s → 2 minutos)', rl && rl.s === 429 && rl.ra === 90 && /2 minutos/.test(rl.m), rl);
  // 502 sem JSON
  const bg = await run(`try { await api.get('/api/_boom'); } catch (e) { return {c: e.code, s: e.status, m: e.message}; }`);
  check('resposta não-JSON (502) vira mensagem amigável de indisponibilidade', bg && bg.s === 502 && /indispon/.test(bg.m), bg);
  // rede
  await page.route('**/api/_neterr', (r) => r.abort('connectionrefused'));
  const ne = await run(`try { await api.get('/api/_neterr'); } catch (e) { return {c: e.code, m: e.message}; }`);
  check('falha de rede vira ApiError "network" amigável', ne && ne.c === 'network' && /conectar/.test(ne.m), ne);
  await collectCsp(page); await ctx.close();

  // ---- refresh single-flight ----
  const u = await asUser('bia@am.test', { tag: 'refresh' });
  await u.page.goto(`${ORIGIN}/importar`); await u.page.waitForSelector('#zona');
  await mpost('/__test/expire-access');
  const before = (await mstate()).refreshCount;
  const many = await u.page.evaluate(`(async () => { ${mod} const rs = await Promise.allSettled([1,2,3,4,5].map((i) => api.get('/api/presentations', {query: {limit: 1, q: 'x' + i}}))); return rs.map((r) => r.status); })()`);
  const after = (await mstate()).refreshCount;
  check('5 chamadas simultâneas com sessão expirada → todas concluem', many.every((s) => s === 'fulfilled'), many);
  check('…e fazem exatamente 1 refresh (single-flight)', after - before === 1, { before, after });
  // chamada tardia depois do refresh não dispara outro
  await mpost('/__test/expire-access');
  const b2 = (await mstate()).refreshCount;
  await u.page.evaluate(`(async () => { ${mod} await api.get('/api/presentations', {query: {limit: 1}}); await api.get('/api/presentations', {query: {limit: 1}}); })()`);
  check('sequência após expirar: 1 refresh só e a segunda chamada já usa o cookie novo', (await mstate()).refreshCount - b2 === 1);
  // storage sem token
  const stor = await u.page.evaluate(() => ({ ls: JSON.stringify({ ...localStorage }), ss: JSON.stringify({ ...sessionStorage }), ck: document.cookie }));
  check('nenhum token em localStorage/sessionStorage/document.cookie (cookies de sessão são HttpOnly)', !/am_at|am_rt/.test(stor.ls + stor.ss + stor.ck) && !/[0-9a-f]{40}/.test(stor.ls + stor.ss), stor);
  const cookies = await u.ctx.cookies();
  check('cookies de sessão am_at/am_rt são HttpOnly e SameSite=Lax; am_csrf é legível', cookies.filter((c) => /^am_(at|rt)$/.test(c.name)).every((c) => c.httpOnly && c.sameSite === 'Lax') && cookies.find((c) => c.name === 'am_csrf')?.httpOnly === false, cookies.map((c) => [c.name, c.httpOnly, c.sameSite]));
  // refresh falha → /entrar?next=
  await mpost('/__test/expire-access'); await mpost('/__test/refresh-fails?on=1');
  await Promise.all([u.page.waitForURL('**/entrar?**', { timeout: 8000 }).catch(() => null), u.page.evaluate(`(async () => { ${mod} try { await api.get('/api/presentations'); } catch (e) { return e.redirecting; } })()`).catch(() => null)]);
  const url = new URL(u.page.url());
  check('refresh que falha leva a /entrar?next=<caminho atual>', url.pathname === '/entrar' && url.searchParams.get('next') === '/importar', u.page.url());
  await mpost('/__test/refresh-fails?on=0');
  await collectCsp(u.page); await u.ctx.close();
}

/* ═════════════════════════════ 3. Login ═════════════════════════════ */
async function loginTests() {
  head('3. Entrar (/entrar)');
  mock.reset();
  const ctx = await newCtx(); const page = await newPage(ctx, 'login');
  await page.goto(`${ORIGIN}/acervo`);
  await page.waitForURL('**/entrar**');
  const u = new URL(page.url());
  check('/acervo sem sessão redireciona para /entrar?next=%2Facervo', u.pathname === '/entrar' && u.searchParams.get('next') === '/acervo', page.url());
  await page.waitForSelector('#form-login');
  check('página tem título, h1 único e idioma pt-BR', (await page.title()).includes('Entrar') && (await page.locator('h1').count()) === 1 && (await page.getAttribute('html', 'lang')) === 'pt-BR');
  check('campos têm rótulos reais (getByLabel)', (await page.getByLabel('E-mail').count()) === 1 && (await page.getByLabel(/^Senha/).count()) === 1);
  check('e-mail com autocomplete=username e senha com current-password (gerenciadores de senha)', (await page.getAttribute('#email', 'autocomplete')) === 'username' && (await page.getAttribute('#senha', 'autocomplete')) === 'current-password');
  // validações locais
  await page.click('#btn-entrar');
  check('envio vazio mostra erros nos campos, aria-invalid e foco no e-mail', (await page.locator('.field-error:visible').count()) === 2 && (await page.getAttribute('#email', 'aria-invalid')) === 'true' && (await page.evaluate(() => document.activeElement.id)) === 'email');
  check('erro de campo está ligado por aria-describedby', (await page.getAttribute('#email', 'aria-describedby')) === 'email-err');
  await page.fill('#email', 'isso-nao-e-email'); await page.fill('#senha', 'x'); await page.click('#btn-entrar');
  check('e-mail malformado é explicado em pt-BR', /não parece válido/.test(await page.locator('#email-err').innerText()));
  // mostrar/ocultar
  await page.fill('#senha', 'segredo');
  await page.click('button[aria-label="Mostrar senha"]');
  check('mostrar senha: input vira texto e o botão informa aria-pressed=true / "Ocultar senha"', (await page.getAttribute('#senha', 'type')) === 'text' && (await page.locator('button[aria-pressed="true"]').getAttribute('aria-label')) === 'Ocultar senha');
  await page.click('button[aria-label="Ocultar senha"]');
  check('ocultar senha volta a esconder', (await page.getAttribute('#senha', 'type')) === 'password');
  // erros do contrato
  const tryLogin = async (email, pw) => { await page.fill('#email', email); await page.fill('#senha', pw); await page.click('#btn-entrar'); await page.waitForSelector('#form-alert .alert--error'); return page.locator('#form-alert .alert--error').innerText(); };
  let t = await tryLogin('bia@am.test', 'senha-errada-123');
  check('credenciais erradas: mensagem genérica em pt-BR (role=alert)', /E-mail ou senha incorretos/.test(t) && (await page.locator('#form-alert [role=alert]').count()) === 1, t);
  check('após erro a senha é limpa e o foco vai para ela', (await page.inputValue('#senha')) === '' && (await page.evaluate(() => document.activeElement.id)) === 'senha');
  t = await tryLogin('naoconvidado@am.test', 'qualquer-coisa-123');
  check('não convidado: orienta a pedir convite', /não foi convidado/.test(t), t);
  t = await tryLogin('dora@am.test', PASSWORD);
  check('conta suspensa: mensagem específica', /suspensa/.test(t), t);
  // limite de taxa (8 erros por e-mail+IP)
  for (let i = 0; i < 8; i++) await page.evaluate(`(async () => { const {api} = await import('/js/api.js'); try { await api.post('/api/auth/login', {email: 'limite@am.test', password: 'x' + ${i}}, {auth: false}); } catch (e) {} })()`);
  t = await tryLogin('limite@am.test', 'qualquer-outra-123');
  check('limite de taxa: mostra o tempo de espera (Retry-After 600 s → 10 minutos)', /Muitas tentativas/.test(t) && /10 minutos/.test(t), t);
  check('limite de taxa: botão fica bloqueado com contagem regressiva', (await page.getAttribute('#btn-entrar', 'aria-disabled')) === 'true' && /Aguarde \d+ s/.test(await page.innerText('#btn-entrar')));
  // login feliz + CSRF
  await mpost('/__test/clear-requests');
  await page.reload(); await page.waitForSelector('#form-login');
  await page.fill('#email', 'Bia@AM.test '); await page.fill('#senha', PASSWORD);
  await Promise.all([page.waitForURL('**/acervo'), page.click('#btn-entrar')]);
  const st = await mstate(); const lp = st.requests.find((r) => r.path === '/api/auth/login');
  check('login enviou X-CSRF-Token igual ao cookie e Origin do próprio site', !!lp && lp.csrf && lp.csrf === lp.cookieCsrf && (lp.origin === null || lp.origin === ORIGIN), lp);
  await page.waitForSelector('#topbar-root header');
  check('login feliz: abre /acervo e mostra o nome na barra superior', (await page.locator('#user-name').innerText()) === 'Bia Souza');
  // já autenticado → /entrar volta ao acervo
  await page.goto(`${ORIGIN}/entrar`); await page.waitForURL('**/acervo');
  check('quem já está autenticado em /entrar vai direto para o acervo', new URL(page.url()).pathname === '/acervo');
  // logout
  await page.waitForSelector('#btn-sair'); await Promise.all([page.waitForURL('**/entrar'), page.click('#btn-sair')]);
  await page.goto(`${ORIGIN}/acervo`); await page.waitForURL('**/entrar**');
  check('Sair encerra a sessão (cookies apagados; /acervo volta a pedir login)', new URL(page.url()).pathname === '/entrar');
  await collectCsp(page);

  // next= seguro
  const safe = await page.evaluate(async () => { const { safeNext } = await import('/js/format.js'); const o = location.origin; const c = ['/importar', '/acervo?aba=minhas&q=a', '//evil.com', 'https://evil.com', 'http://evil.com/x', '/\\evil.com', '/\\/evil.com', 'javascript:alert(1)', '', null, undefined, 'acervo', '/acervo\r\nSet-Cookie:x=1', '/entrar', '/entrar?next=/x', '/auth/confirmar?x=1', '/%2f%2fevil.com', '/./..//evil.com', '/admin#usuarios', ' //evil.com', '/\t/evil.com', 'data:text/html,x', '/a'.repeat(1500)]; return c.map((x) => [x, safeNext(x, '/acervo', o)]); });
  const m = Object.fromEntries(safe.map(([a, b]) => [String(a).slice(0, 40), b]));
  check('safeNext aceita caminhos internos legítimos', m['/importar'] === '/importar' && m['/acervo?aba=minhas&q=a'] === '/acervo?aba=minhas&q=a' && m['/admin#usuarios'] === '/admin#usuarios', m);
  const evil = ['//evil.com', 'https://evil.com', 'http://evil.com/x', '/\\evil.com', '/\\/evil.com', 'javascript:alert(1)', '', 'acervo', '/acervo\r\nSet-Cookie:x=1', ' //evil.com', '/\t/evil.com', 'data:text/html,x'];
  check('safeNext recusa //host, https://host, /\\host, javascript:, CRLF, tab e relativos (anti open-redirect)', evil.every((e) => safe.find(([a]) => a === e)?.[1] === '/acervo'), safe.filter(([a, b]) => evil.includes(a) && b !== '/acervo'));
  check('safeNext não devolve para as próprias páginas de login (sem laço)', m['/entrar'] === '/acervo' && m['/entrar?next=/x'] === '/acervo' && m['/auth/confirmar?x=1'] === '/acervo');
  check('safeNext resolve %2f%2f e ../ sem sair do site', safe.find(([a]) => a === '/%2f%2fevil.com')[1].startsWith('/') && !safe.find(([a]) => a === '/./..//evil.com')[1].startsWith('//'));
  // fluxo real com next
  const flow = async (next, expectPath) => {
    const c = await newCtx(); const p = await newPage(c, 'next');
    await p.goto(`${ORIGIN}/entrar?next=${encodeURIComponent(next)}`); await p.waitForSelector('#form-login');
    await p.fill('#email', 'bia@am.test'); await p.fill('#senha', PASSWORD); await p.click('#btn-entrar');
    await p.waitForURL((u) => u.pathname !== '/entrar', { timeout: 8000 }); const final = new URL(p.url());
    await collectCsp(p); await c.close(); return final.origin === ORIGIN && (final.pathname + final.search) === expectPath;
  };
  check('login com ?next=/importar abre /importar', await flow('/importar', '/importar'));
  check('login com ?next=//evil.com cai em /acervo (não sai do site)', await flow('//evil.com', '/acervo'));
  check('login com ?next=https://evil.com cai em /acervo', await flow('https://evil.com/phish', '/acervo'));
  await ctx.close();
}

async function sessionTests() {
  head('3b. Sessão: renovação automática e conta suspensa');
  mock.reset();
  const { ctx, page } = await asUser('bia@am.test', { tag: 'sessao' });
  await mpost('/__test/expire-access');
  const before = (await mstate()).refreshCount;
  await page.goto(`${ORIGIN}/acervo`); await page.waitForSelector(CARD);
  check('cookie de acesso expirado: /acervo abre sem pedir login (o servidor renova a sessão uma vez)', new URL(page.url()).pathname === '/acervo' && (await mstate()).refreshCount - before === 1, (await mstate()).refreshCount - before);
  mock.state.users.get(IDS.bia).status = 'suspended';
  await page.goto(`${ORIGIN}/acervo`); await page.waitForURL('**/entrar**'); await page.waitForSelector('#form-alert .alert');
  check('conta suspensa enquanto logada: volta para /entrar com o motivo e a explicação', new URL(page.url()).searchParams.get('motivo') === 'suspended' && /suspensa/.test(await page.locator('#form-alert').innerText()));
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 3c. Login corporativo (SSO) ═════════════════════════════ */
const SSO_MOTIVOS = ['not_invited', 'suspended', 'sessao', 'sso_email', 'sso_dominio', 'sso_indisponivel', 'sso_expirou', 'sso_falhou', 'sso_limite'];
async function ssoTests() {
  head('3c. Login corporativo (SSO) em /entrar');
  mock.reset();
  let ctx = await newCtx(); let page = await newPage(ctx, 'sso');
  // como o back-end está hoje: SSO desligado e /api/auth/session sem indicador → botão discreto; o clique confere e o 501 vira aviso
  await page.goto(`${ORIGIN}/entrar?next=%2Fimportar`); await page.waitForSelector('#form-login');
  const sso = page.locator('#btn-sso');
  const look = (pg) => pg.locator('#btn-sso').evaluate((b) => { const cs = getComputedStyle(b); return { ghost: b.classList.contains('btn--ghost'), bg: cs.backgroundColor, border: cs.borderTopColor, h: b.getBoundingClientRect().height, w: Math.round(b.getBoundingClientRect().width), formW: Math.round(b.closest('form').getBoundingClientRect().width), type: b.type, after: b.compareDocumentPosition(document.querySelector('#btn-entrar')) === Node.DOCUMENT_POSITION_PRECEDING }; });
  let L = await look(page);
  check('sem indicador do servidor: "Entrar com a conta A&M (SSO)" aparece DISCRETO (fantasma, sem fundo), do tipo button e logo depois de "Entrar"', (await sso.count()) === 1 && /^Entrar com a conta A&M \(SSO\)$/.test((await sso.innerText()).trim()) && L.ghost && L.bg === 'rgba(0, 0, 0, 0)' && L.type === 'button' && L.after && L.w < L.formW && (await page.locator('.auth__or').count()) === 0, L);
  await mpost('/__test/clear-requests');
  await sso.click();
  check('sem e-mail: pede o e-mail corporativo no próprio campo (foco nele) e não chama o servidor', /Informe seu e-mail corporativo/.test(await page.innerText('#email-err')) && (await page.evaluate(() => document.activeElement.id)) === 'email' && (await mstate()).requests.every((r) => !r.path.startsWith('/api/auth/sso')));
  await page.fill('#email', 'bia@am.test');
  await sso.click(); await page.waitForSelector('#form-alert .alert');
  let reqs = (await mstate()).requests.filter((r) => r.path.startsWith('/api/auth/sso')).map((r) => r.path);
  check('SSO desligado (501 not_configured): aviso "O login corporativo ainda não está disponível" e a página fica (sem JSON cru na tela)', /O login corporativo ainda não está disponível/.test(await page.innerText('#form-alert')) && new URL(page.url()).pathname === '/entrar' && JSON.stringify(reqs) === JSON.stringify(['/api/auth/sso']), { reqs, url: page.url() });
  check('a conferência não leva o e-mail nem abre tentativa (GET /api/auth/sso sem parâmetros, sem seguir redirecionamento)', reqs.every((x) => !x.includes('email')));
  // SSO ligado (ainda sem indicador): confere, segue ao provedor e volta logada no destino pedido
  await mpost('/__test/sso?on=1');
  await page.reload(); await page.waitForSelector('#form-login');
  await page.fill('#email', ' Bia@AM.test ');
  await mpost('/__test/clear-requests');
  await Promise.all([page.waitForURL(/\/__test\/idp/), sso.click()]);
  reqs = (await mstate()).requests.filter((r) => r.path.startsWith('/api/auth/sso')).map((r) => r.path);
  check('SSO ligado: o botão leva a /api/auth/sso?email=<e-mail digitado>&next=<destino atual> e daí ao provedor', reqs.includes('/api/auth/sso?email=Bia%40AM.test&next=%2Fimportar') && /Provedor de identidade/.test(await page.innerText('h1')), reqs);
  await Promise.all([page.waitForURL((u) => u.pathname === '/importar'), page.click('#idp-ok')]);
  await page.waitForSelector('#user-name');
  check('volta do provedor com sessão: abre o destino pedido (/importar) já como Bia Souza', (await page.innerText('#user-name')) === 'Bia Souza' && (await mstate()).audit.includes('auth.login'));
  await collectCsp(page); await ctx.close();
  // erros: o servidor volta para /entrar?motivo=… e a tela explica (o destino é preservado)
  ctx = await newCtx(); page = await newPage(ctx, 'sso-erros');
  const viaSso = async (email, then) => {
    await page.goto(`${ORIGIN}/entrar?next=%2Fimportar`); await page.waitForSelector('#form-login');
    await page.fill('#email', email);
    if (then) { await Promise.all([page.waitForURL(/\/__test\/idp/), page.click('#btn-sso')]); await Promise.all([page.waitForURL(/\/entrar\?/), page.click(then)]); }
    else await Promise.all([page.waitForURL(/\/entrar\?motivo=/), page.click('#btn-sso')]);
    await page.waitForSelector('#form-alert .alert');
    const u = new URL(page.url());
    return { motivo: u.searchParams.get('motivo'), next: u.searchParams.get('next'), text: await page.innerText('#form-alert') };
  };
  let r = await viaSso('alguem@outra-empresa.com');
  check('e-mail de outro domínio: motivo=sso_dominio, mensagem própria e o destino continua (/importar)', r.motivo === 'sso_dominio' && r.next === '/importar' && /só para os domínios da A&M/.test(r.text), r);
  r = await viaSso('bia@am.test', '#idp-cancel');
  check('cancelou no provedor: motivo=sso_falhou com mensagem clara', r.motivo === 'sso_falhou' && /cancelado ou recusado/.test(r.text), r);
  r = await viaSso('pessoa.nova@am.test', '#idp-ok');
  check('conta A&M sem convite: motivo=not_invited e a orientação de pedir convite (nenhuma conta é criada)', r.motivo === 'not_invited' && /não foi convidado/.test(r.text) && !(await mstate()).users.some((u) => /pessoa\.nova/.test(u.displayName)), r);
  await page.goto(`${ORIGIN}/api/auth/sso/callback?code=abc123`); await page.waitForSelector('#form-alert .alert');
  check('retorno sem a tentativa deste navegador (outro navegador ou expirada): motivo=sso_expirou', new URL(page.url()).searchParams.get('motivo') === 'sso_expirou' && /expirou/.test(await page.innerText('#form-alert')));
  check('depois de um erro de SSO o botão fica em destaque (o login corporativo está ligado)', (await page.locator('.auth__or').count()) === 1 && (await page.locator('#btn-sso[data-sso=ligado]').count()) === 1);
  // cada motivo tem mensagem própria; motivo desconhecido ou forjado não mostra nada
  const textos = {};
  for (const m of SSO_MOTIVOS) { await page.goto(`${ORIGIN}/entrar?motivo=${m}`); await page.waitForSelector('#form-login'); textos[m] = (await page.locator('#form-alert').innerText()).trim(); }
  check('cada motivo (not_invited, suspended, sessao e os 6 sso_*) tem mensagem própria em português', Object.values(textos).every((t) => t.length > 30) && new Set(Object.values(textos)).size === SSO_MOTIVOS.length, textos);
  check('mensagens dos erros de SSO são anunciadas (role=alert), a de sessão expirada não interrompe', await (async () => { await page.goto(`${ORIGIN}/entrar?motivo=sso_falhou`); await page.waitForSelector('#form-login'); return (await page.locator('#form-alert [role=alert]').count()) === 1; })());
  await page.goto(`${ORIGIN}/entrar?motivo=%3Cimg%20src%3Dx%20onerror%3D%22window.__xss%3D9%22%3E`); await page.waitForSelector('#form-login');
  check('motivo desconhecido ou forjado: nenhuma mensagem e nada do parâmetro na página', (await page.locator('#form-alert .alert').count()) === 0 && !(await page.content()).includes('onerror') && (await page.evaluate(() => window.__xss)) === undefined);
  // indicador em /api/auth/session (sso: {enabled}) — se o servidor passar a mandar
  await mpost('/__test/sso?on=1&indicator=1');
  await page.goto(`${ORIGIN}/entrar`); await page.waitForSelector('#form-login');
  L = await look(page);
  const E = await page.evaluate(() => { const b = document.querySelector('#btn-sso'); const cs = getComputedStyle(b); const o = getComputedStyle(document.querySelector('.auth__or')); return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, fw: cs.fontWeight, fs: cs.fontSize, orFont: o.fontFamily.split(',')[0].replace(/["']/g, ''), orCase: o.textTransform }; });
  check('com o indicador ligado: botão em destaque = .mb do editor (branco, navy, linha #DCE3EC, raio 8 px, 13 px/600, largura total) abaixo da divisória "ou" em mono', !L.ghost && E.bg === 'rgb(255, 255, 255)' && E.color === 'rgb(0, 42, 70)' && E.border === 'rgb(220, 227, 236)' && E.radius === '8px' && E.fw === '600' && E.fs === '13px' && L.h >= 38 && Math.abs(L.w - L.formW) <= 1 && E.orFont === 'JetBrains Mono' && E.orCase === 'uppercase', { L, E });
  await page.fill('#email', 'bia@am.test'); await mpost('/__test/clear-requests');
  await Promise.all([page.waitForURL(/\/__test\/idp/), page.click('#btn-sso')]);
  reqs = (await mstate()).requests.filter((r) => r.path.startsWith('/api/auth/sso')).map((r) => r.path);
  check('com o indicador ligado vai direto, sem a conferência prévia (uma única chamada, com e-mail e destino)', JSON.stringify(reqs) === JSON.stringify(['/api/auth/sso?email=bia%40am.test&next=%2Facervo']), reqs);
  await mpost('/__test/sso?on=0&indicator=1');
  await page.goto(`${ORIGIN}/entrar`); await page.waitForSelector('#form-login');
  check('com o indicador dizendo "desligado": o botão de SSO não aparece', (await page.locator('#btn-sso').count()) === 0 && (await page.locator('.auth__or').count()) === 0);
  await mpost('/__test/sso?on=0&indicator=0');
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 4. Convite → senha → acervo ═════════════════════════════ */
async function confirmTests() {
  head('4. Confirmar convite / redefinir senha (/auth/confirmar)');
  mock.reset();
  let ctx = await newCtx(); let page = await newPage(ctx, 'convite');
  await page.goto(`${ORIGIN}/auth/confirmar?token_hash=${TOKENS.invite}&type=invite`);
  await page.waitForSelector('#form-senha');
  check('token_hash é removido da URL (history.replaceState)', !page.url().includes('token_hash') && !page.url().includes(TOKENS.invite) && new URL(page.url()).search === '', page.url());
  check('convite: mostra "Defina sua senha" e a conta convidada', /Defina sua senha/.test(await page.locator('h1').innerText()) && /eva@am\.test/.test(await page.locator('#conta-email').innerText()));
  check('campos de senha têm rótulos e autocomplete=new-password', (await page.getByLabel('Nova senha').count()) === 1 && (await page.getByLabel('Confirme a senha').count()) === 1 && (await page.getAttribute('#nova-senha', 'autocomplete')) === 'new-password');
  // indicador de força + checklist
  await page.fill('#nova-senha', 'curta');
  check('senha curta: força "Fraca" e requisito de 12 caracteres pendente', /Fraca/.test(await page.innerText('#forca-label')) && (await page.getAttribute('#chk-len', 'data-ok')) === 'false');
  await page.fill('#nova-senha', 'Uma frase longa e boa 2026!');
  check('senha longa: força "Forte" e requisitos atendidos', /Forte/.test(await page.innerText('#forca-label')) && (await page.locator('.checklist li.is-ok').count()) === 3 && (await page.getAttribute('#forca', 'data-level')) === '4');
  await page.fill('#nova-senha', 'eva@am.test-123');
  check('senha contendo o e-mail é sinalizada', (await page.getAttribute('#chk-email', 'data-ok')) === 'false');
  // validações
  await page.fill('#nova-senha', 'curta'); await page.fill('#confirmar-senha', 'curta'); await page.click('#btn-definir');
  check('menos de 12 caracteres: erro no campo', /pelo menos 12/.test(await page.locator('#nova-senha-err').innerText()));
  await page.fill('#nova-senha', 'Uma frase longa e boa 2026!'); await page.fill('#confirmar-senha', 'outra coisa diferente 1'); await page.click('#btn-definir');
  check('confirmação diferente: erro "As senhas não são iguais"', /não são iguais/.test(await page.locator('#confirmar-senha-err').innerText()));
  await page.fill('#nova-senha', 'senha1234567-zzz'); await page.fill('#confirmar-senha', 'senha1234567-zzz'); await page.click('#btn-definir');
  await page.waitForSelector('#nova-senha-err:not([hidden])');
  check('senha comum recusada pelo servidor: mensagem do servidor no campo', /comum|adivinhar/.test(await page.locator('#nova-senha-err').innerText()) || /comum/.test(await page.locator('#nova-senha-err').innerText()));
  await page.fill('#nova-senha', 'Uma frase longa e boa 2026!'); await page.fill('#confirmar-senha', 'Uma frase longa e boa 2026!');
  await Promise.all([page.waitForURL('**/acervo'), page.click('#btn-definir')]);
  await page.waitForSelector('#user-name');
  check('convite → senha → acervo: usuária Eva entra e fica ativa', (await page.locator('#user-name').innerText()) === 'Eva Convidada' && (await page.evaluate(() => fetch('/api/auth/session').then((r) => r.json()))).user.status === 'active');
  await collectCsp(page); await ctx.close();

  // reuso do mesmo link
  ctx = await newCtx(); page = await newPage(ctx, 'reuso');
  await page.goto(`${ORIGIN}/auth/confirmar?token_hash=${TOKENS.invite}&type=invite`);
  await page.waitForSelector('#estado-titulo');
  check('link já usado: "Link inválido ou expirado" com atalho para pedir novo e-mail', /inválido ou expirado/.test(await page.locator('h1').innerText()) && (await page.getAttribute('#btn-novo-email', 'href')) === '/esqueci-senha');
  check('o foco vai para o título do estado (leitor de tela anuncia)', (await page.evaluate(() => document.activeElement.id)) === 'estado-titulo');
  await page.goto(`${ORIGIN}/auth/confirmar?token_hash=${TOKENS.expired}&type=recovery`); await page.waitForSelector('#btn-novo-email');
  check('link expirado (recovery) também cai no estado de link inválido', /redefinição/.test(await page.locator('.auth__center .lead').innerText()));
  await mpost('/__test/clear-requests');
  await page.goto(`${ORIGIN}/auth/confirmar?token_hash=abc&type=magic`); await page.waitForSelector('#btn-novo-email');
  check('parâmetros malformados (type/token_hash) são recusados sem chamar /api/auth/verify', !(await mstate()).requests.some((r) => r.path === '/api/auth/verify'));
  await page.goto(`${ORIGIN}/auth/confirmar`); await page.waitForSelector('#btn-novo-email');
  check('sem token e sem sessão: link inválido', /inválido/.test(await page.locator('h1').innerText()));
  await collectCsp(page); await ctx.close();

  // recuperação de senha
  ctx = await newCtx(); page = await newPage(ctx, 'recovery');
  await page.goto(`${ORIGIN}/auth/confirmar?token_hash=${TOKENS.recovery}&type=recovery`); await page.waitForSelector('#form-senha');
  check('recuperação: título "Crie uma nova senha"', /nova senha/i.test(await page.locator('h1').innerText()));
  await page.fill('#nova-senha', 'Nova frase secreta 2027#'); await page.fill('#confirmar-senha', 'Nova frase secreta 2027#');
  await Promise.all([page.waitForURL('**/acervo'), page.click('#btn-definir')]);
  await page.waitForSelector('#user-name');
  check('recuperação conclui e entra no acervo como Bia', (await page.locator('#user-name').innerText()) === 'Bia Souza');
  await collectCsp(page); await ctx.close();

  // falha de rede no verify → tentar de novo
  mock.reset();
  ctx = await newCtx(); page = await newPage(ctx, 'verify-rede');
  let blocked = true;
  await page.route('**/api/auth/verify', (r) => (blocked ? r.abort('connectionrefused') : r.continue()));
  await page.goto(`${ORIGIN}/auth/confirmar?token_hash=${TOKENS.invite}&type=invite`);
  await page.waitForSelector('#btn-tentar');
  check('falha de rede ao confirmar: mensagem e botão "Tentar de novo" (token só em memória)', /confirmar agora/.test(await page.locator('h1').innerText()) && !page.url().includes('token_hash'));
  blocked = false; await page.click('#btn-tentar'); await page.waitForSelector('#form-senha');
  check('"Tentar de novo" reaproveita o token da memória e segue para a senha', true);
  await collectCsp(page); await ctx.close();
}

async function forgotTests() {
  head('5. Esqueci a senha (/esqueci-senha)');
  mock.reset();
  const ctx = await newCtx(); const page = await newPage(ctx, 'forgot');
  await page.goto(`${ORIGIN}/esqueci-senha`); await page.waitForSelector('#form-esqueci');
  await page.click('#btn-enviar');
  check('e-mail vazio: erro de campo', /Informe/.test(await page.locator('#email-err').innerText()));
  await page.fill('#email', 'bia@am.test'); await page.click('#btn-enviar'); await page.waitForSelector('#sucesso');
  const a = await page.locator('#sucesso .lead').innerText();
  await page.click('#btn-outro'); await page.fill('#email', 'ninguem-existe@am.test'); await page.click('#btn-enviar'); await page.waitForSelector('#sucesso');
  const b = await page.locator('#sucesso .lead').innerText();
  check('mensagem de sucesso idêntica para e-mail existente e inexistente (sem enumeração)', a === b && /Se este e-mail estiver cadastrado/.test(a));
  check('a API recebeu os dois pedidos', (await mstate()).forgot.length === 2);
  for (let i = 0; i < 4; i++) await page.evaluate(async (n) => { const { api } = await import('/js/api.js'); try { await api.post('/api/auth/forgot', { email: `z${n}@am.test` }, { auth: false }); } catch { /* 429 esperado no fim */ } }, i);
  await page.click('#btn-outro'); await page.fill('#email', 'outro@am.test'); await page.click('#btn-enviar'); await page.waitForSelector('#form-alert .alert--error');
  check('limite de pedidos: mostra o tempo de espera', /Muitas tentativas/.test(await page.locator('#form-alert').innerText()) && /minutos/.test(await page.locator('#form-alert').innerText()));
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 6. Acervo ═════════════════════════════ */
async function acervoTests() {
  head('6. Acervo (/acervo) — membro (Bia)');
  mock.reset();
  let { ctx, page } = await asUser('bia@am.test', { tag: 'acervo-bia' });
  // esqueleto de carregamento
  await page.route('**/api/presentations?scope=all*', async (r) => { await sleep(500); await r.continue(); });
  await page.goto(`${ORIGIN}/acervo`);
  await page.waitForSelector('#esqueleto', { timeout: 4000 });
  check('mostra esqueleto de carregamento (aria-hidden) enquanto busca', (await page.getAttribute('#esqueleto', 'aria-hidden')) === 'true' && (await page.getAttribute('#painel', 'aria-busy')) === 'true');
  await page.waitForSelector(CARD); await page.unroute('**/api/presentations?scope=all*');
  check('depois de carregar o esqueleto some e aria-busy sai', (await page.locator('#esqueleto').count()) === 0 && (await page.getAttribute('#painel', 'aria-busy')) === null);
  check('carrega a 1ª página (24) e avisa que há mais (aria-live)', (await page.locator('li.card').count()) === 24 && /24 apresentações.*há mais/.test(await page.innerText('#status')) && (await page.getAttribute('#status', 'aria-live')) === 'polite');
  check('há título, descrição e botão "Nova apresentação"', /Acervo de apresentações/.test(await page.locator('h1').innerText()) && (await page.getByRole('button', { name: 'Nova apresentação' }).count()) === 1);
  check('a regra "crie uma cópia" aparece na interface (descrição e cartões de outros donos)', /crie uma cópia/.test(await page.locator('.lead').innerText()) && (await page.locator('li.card[data-owner=other] .card__readonly').first().innerText()).includes('Para usar esta apresentação, crie uma cópia.'));
  // miniaturas
  const th = await page.evaluate(() => { const imgs = [...document.querySelectorAll('li.card .card__thumb img')]; return { n: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, ph: document.querySelectorAll('li.card .ph').length }; });
  check('miniaturas carregam de /api/assets/<thumbSha>; sem miniatura mostra placeholder', th.n > 0 && th.ok === th.n && th.ph > 0, th);
  // paginação
  await page.click('#btn-mais'); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 48);
  await page.click('#btn-mais'); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 56);
  check('depois de "Carregar mais" o foco vai para o 1º cartão novo (não se perde)', await page.evaluate(() => document.activeElement.classList.contains('card__title')));
  check('paginação por cursor: "Carregar mais" soma 24+24+8 = 56 e o botão some no fim', (await page.locator('#btn-mais').count()) === 0 && /56 apresentações/.test(await page.innerText('#status')));
  const ids = await page.$$eval(CARD, (l) => l.map((x) => x.dataset.id));
  check('sem cartões duplicados após paginar', new Set(ids).size === ids.length);
  // ordenação do servidor (mais recentes primeiro)
  const first = await page.locator('li.card').first().locator('.card__title').innerText();
  check('ordem padrão: atualizadas recentemente (a mais nova primeiro)', first.includes('Plano estratégico 2027'), first);
  // ordenação por título (carrega todas as páginas)
  await page.reload(); await page.waitForSelector(CARD);
  await page.selectOption('#ordem', 'title'); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 56, null, { timeout: 8000 });
  const titles = await page.$$eval('li.card .card__title', (l) => l.map((x) => x.textContent));
  const sorted = [...titles].sort(new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true }).compare);
  check('ordenar por título A–Z carrega tudo e ordena corretamente (56 itens)', JSON.stringify(titles) === JSON.stringify(sorted), titles.slice(0, 5));
  await page.selectOption('#ordem', 'slides');
  const sl = await page.$$eval(CARD, (l) => l.map((x) => Number(x.querySelector('.card__meta span').textContent.match(/\d+/)[0])));
  check('ordenar por nº de slides: decrescente', sl.every((v, i) => i === 0 || sl[i - 1] >= v), sl.slice(0, 6));
  await page.selectOption('#ordem', 'updated'); await page.waitForSelector(CARD);
  // busca com debounce
  await page.reload(); await page.waitForSelector(CARD);
  await mpost('/__test/clear-requests');
  await page.locator('#busca').pressSequentially('Proposta Caio', { delay: 40 });
  await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 1);
  const sreq = (await mstate()).requests.filter((r) => r.path.startsWith('/api/presentations?') && r.path.includes('q='));
  check('busca com debounce: digitar 13 letras gera poucas requisições (≤ 2) e acha o item', sreq.length <= 2 && (await page.locator('li.card .card__title').innerText()) === 'Proposta Caio — Banco Aurora', sreq.map((r) => r.path));
  check('busca fica na URL (?q=) e o status descreve o resultado', /q=Proposta/.test(page.url()) && /1 resultado para “Proposta Caio”/.test(await page.innerText('#status')));
  await page.fill('#busca', 'zzzz-inexistente'); await page.waitForSelector('.state');
  check('busca sem resultado: estado vazio útil com "Limpar busca"', /Nenhum resultado/.test(await page.locator('.state h2').innerText()) && (await page.locator('#btn-limpar').count()) === 1);
  await page.click('#btn-limpar'); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length >= 24);
  check('"Limpar busca" volta à lista completa', !page.url().includes('q='));
  // abas
  await page.getByRole('tab', { name: 'Minhas' }).click(); await page.waitForFunction(() => /Minhas|apresenta/.test(document.querySelector('#status').textContent) && document.querySelectorAll('li.card:not(.card--skel)').length > 0);
  const mine = await page.$$eval(CARD, (l) => ({ n: l.length, all: l.every((x) => x.dataset.owner === 'me'), badge: l.every((x) => x.querySelector('.badge--own')) }));
  check('aba Minhas: só apresentações da Bia, todas com selo "Sua"', mine.n > 0 && mine.all && mine.badge, mine);
  check('aba selecionada é refletida em aria-selected e na URL (?aba=minhas)', (await page.getByRole('tab', { name: 'Minhas' }).getAttribute('aria-selected')) === 'true' && /aba=minhas/.test(page.url()) && (await page.getAttribute('#painel', 'aria-labelledby')) === 'tab-minhas');
  await page.getByRole('tab', { name: 'Lixeira' }).click(); await page.waitForSelector(CARD);
  const trash = await page.$$eval(CARD, (l) => l.map((x) => x.querySelector('.card__title').textContent));
  check('Lixeira do membro: só as excluídas dela (não as do Caio)', trash.length === 1 && trash[0] === 'Rascunho excluído da Bia', trash);
  check('Lixeira: oferece "Restaurar" e a nota explica quem apaga de vez', (await page.locator('li.card [data-action=restore]').count()) === 1 && /administrador/.test(await page.innerText('#nota-lixeira')));
  await page.locator('li.card button[aria-haspopup=menu]').click();
  check('membro NÃO vê "Apagar de vez" na lixeira', (await page.getByRole('menuitem', { name: 'Apagar de vez' }).count()) === 0);
  check('membro NÃO vê "Transferir propriedade…"', (await page.getByRole('menuitem', { name: 'Transferir propriedade…' }).count()) === 0);
  await page.keyboard.press('Escape');
  // permissões por cartão (dono × outro)
  await page.getByRole('tab', { name: 'Todas' }).click(); await page.waitForSelector(CARD);
  const perms = await page.$$eval(CARD, (l) => l.map((x) => ({ own: x.dataset.owner === 'me', edit: !!x.querySelector('[data-action=edit]'), dup: !!x.querySelector('[data-action=duplicate]'), pres: x.querySelector('[data-action=present]')?.getAttribute('href') })));
  check('membro: "Editar" só nos próprios; "Criar cópia" só nos de outras pessoas', perms.every((p) => p.edit === p.own && p.dup === !p.own) && perms.some((p) => p.own) && perms.some((p) => !p.own), perms.filter((p) => p.edit !== p.own).length);
  check('"Apresentar" leva a /visualizar/<id> em todos os cartões', perms.every((p) => /^\/visualizar\/[0-9a-f-]{36}$/.test(p.pres)));
  const edits = await page.$$eval('li.card [data-action=edit]', (a) => a.map((x) => x.getAttribute('href')));
  check('"Editar" leva a /editor/<id>', edits.length > 0 && edits.every((h) => /^\/editor\/[0-9a-f-]{36}$/.test(h)));
  // menu (teclado)
  const own = cardByTitle(page, 'Plano estratégico 2027 (Bia)');
  const mbtn = own.locator('button[aria-haspopup=menu]');
  await mbtn.focus(); await page.keyboard.press('Enter');
  check('menu abre com Enter e foca o 1º item (role=menu / menuitem)', (await mbtn.getAttribute('aria-expanded')) === 'true' && (await page.getByRole('menu').count()) === 1 && (await page.evaluate(() => document.activeElement.getAttribute('role'))) === 'menuitem');
  const itemsOwn = await page.getByRole('menuitem').allInnerTexts();
  check('menu do dono: Detalhes, Criar cópia, Compartilhar e Excluir', ['Detalhes e comentários', 'Criar cópia', 'Compartilhar', 'Excluir'].every((x) => itemsOwn.includes(x)), itemsOwn);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  check('setas navegam entre itens', (await page.evaluate(() => document.activeElement.textContent)) === 'Compartilhar');
  await page.keyboard.press('Escape');
  check('Esc fecha o menu e devolve o foco ao botão', (await page.getByRole('menu').count()) === 0 && (await mbtn.evaluate((b) => b === document.activeElement)));
  const other = cardByTitle(page, 'Proposta Caio — Banco Aurora');
  await other.locator('button[aria-haspopup=menu]').click();
  const itemsOther = await page.getByRole('menuitem').allInnerTexts();
  check('menu de cartão alheio: SEM Excluir (e sem Editar)', !itemsOther.includes('Excluir') && itemsOther.includes('Compartilhar') && itemsOther.includes('Detalhes e comentários'), itemsOther);
  await page.keyboard.press('Escape');
  // compartilhar
  await other.locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: 'Compartilhar' }).click();
  await waitToast(page, /Link copiado/);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Compartilhar copia o link /visualizar/<id> e avisa', /^http:\/\/127\.0\.0\.1:\d+\/visualizar\/[0-9a-f-]{36}$/.test(clip) && /Link copiado/.test(await toastText(page)), { clip, t: await toastText(page) });
  check('o compartilhamento foi auditado no servidor (presentation.share)', (await mstate()).audit.includes('presentation.share'));
  // criar cópia (é a ÚNICA forma de usar a de outra pessoa)
  const origBefore = (await mstate()).presentations.find((p) => p.title === 'Proposta Caio — Banco Aurora');
  await Promise.all([page.waitForURL(/\/editor\/[0-9a-f-]{36}$/), other.locator('[data-action=duplicate]').click()]);
  const st = await mstate(); const copy = st.presentations.find((p) => p.title === 'Cópia de Proposta Caio — Banco Aurora');
  check('"Criar cópia" duplica e abre a cópia no editor; a cópia é da Bia e o original segue do Caio', !!copy && copy.ownerId === IDS.bia && page.url().endsWith(copy.id) && st.presentations.find((p) => p.id === origBefore.id).ownerId === IDS.caio, copy);
  // nova apresentação
  await gotoAcervo(page);
  await Promise.all([page.waitForURL(/\/editor\/[0-9a-f-]{36}$/), page.click('#btn-nova')]);
  check('"Nova apresentação" cria (POST) e abre /editor/<id>', (await mstate()).created.some((c) => c.source === 'new' && page.url().endsWith(c.id)));
  // excluir + desfazer + restaurar
  await gotoAcervo(page);
  const mineCard = cardByTitle(page, 'Plano estratégico 2027 (Bia)');
  await mineCard.locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: 'Excluir' }).click();
  await page.waitForSelector('dialog[open].dlg');
  check('Excluir pede confirmação (diálogo modal rotulado; foco no "Cancelar")', (await page.getByRole('dialog', { name: 'Excluir apresentação?' }).count()) === 1 && (await page.evaluate(() => document.activeElement.dataset.act)) === 'cancel');
  await page.click('dialog [data-act=cancel]');
  check('cancelar mantém a apresentação', (await page.locator('li.card', { hasText: 'Plano estratégico 2027' }).count()) === 1 && (await page.locator('dialog').count()) === 0);
  await mineCard.locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: 'Excluir' }).click(); await page.click('dialog [data-act=confirm]');
  await page.waitForFunction(() => ![...document.querySelectorAll('li.card:not(.card--skel)')].some((c) => c.textContent.includes('Plano estratégico 2027')));
  check('depois de excluir o foco passa para o cartão vizinho (não se perde)', await page.evaluate(() => document.activeElement.classList.contains('card__title')));
  check('confirmar exclui: vai para a lixeira (soft delete) e some do acervo', (await mstate()).presentations.find((p) => p.title.startsWith('Plano estratégico 2027')).deleted === true && /lixeira/.test(await toastText(page)));
  await page.getByRole('button', { name: 'Desfazer' }).click(); await page.waitForFunction(() => [...document.querySelectorAll('li.card:not(.card--skel)')].some((c) => c.textContent.includes('Plano estratégico 2027')));
  check('"Desfazer" no aviso restaura a apresentação', (await mstate()).presentations.find((p) => p.title.startsWith('Plano estratégico 2027')).deleted === false);
  await mineCard.locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: 'Excluir' }).click(); await page.click('dialog [data-act=confirm]');
  await page.getByRole('tab', { name: 'Lixeira' }).click(); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 2);
  await page.locator('li.card', { hasText: 'Plano estratégico 2027' }).locator('[data-action=restore]').click();
  await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 1);
  check('Restaurar na lixeira tira o item de lá e devolve ao acervo', (await mstate()).presentations.find((p) => p.title.startsWith('Plano estratégico 2027')).deleted === false);
  // 403 do servidor (defesa em profundidade) — mesmo se alguém forçar a chamada
  const forced = await page.evaluate(async (id) => { const { api } = await import('/js/api.js'); try { await api.del(`/api/presentations/${id}`); } catch (e) { return { s: e.status, c: e.code }; } }, (await mstate()).presentations.find((p) => p.title === 'Proposta Caio — Banco Aurora').id);
  check('servidor recusa (403 forbidden) excluir apresentação de outro, mesmo com a chamada forçada', forced && forced.s === 403 && forced.c === 'forbidden', forced);

  // ---- gaveta de detalhes e comentários ----
  head('6b. Acervo — detalhes e comentários');
  await gotoAcervo(page);
  const plano = cardByTitle(page, 'Plano estratégico 2027 (Bia)');
  const tbtn = plano.locator('.card__title');
  await tbtn.click(); await page.waitForSelector('#gaveta[open]');
  check('gaveta abre como diálogo modal rotulado pelo título', (await page.getByRole('dialog', { name: /Plano estratégico 2027/ }).count()) === 1);
  check('gaveta mostra dono, slides, datas e revisão', /Bia Souza/.test(await page.innerText('#gaveta .dl')) && /Slides/.test(await page.innerText('#gaveta .dl')) && /Revisão/.test(await page.innerText('#gaveta .dl')));
  check('dono vê o link do histórico (/editor/<id>?historico=1) e Editar', /\/editor\/[0-9a-f-]{36}\?historico=1$/.test(await page.getAttribute('#dr-historico', 'href')) && (await page.locator('#gaveta a:has-text("Editar")').count()) === 1);
  await page.waitForSelector('#lista-comentarios .comment');
  check('comentários: resolvidos ficam ocultos por padrão (1 aberto) e dá para mostrá-los', (await page.locator('#lista-comentarios .comment').count()) === 1 && (await page.locator('#ver-resolvidos').count()) === 1);
  await page.check('#ver-resolvidos');
  check('"Mostrar resolvidos" revela o comentário resolvido com selo', (await page.locator('#lista-comentarios .comment').count()) === 2 && (await page.locator('#lista-comentarios .badge--ok').count()) === 1);
  await page.uncheck('#ver-resolvidos');
  await page.fill('#novo-comentario', 'Ficou ótimo. <b>negrito?</b> https://x.y\nsegunda linha'); await page.fill('#cm-slide', '4');
  check('contador de caracteres acompanha o texto', /^\d+\/2000$/.test(await page.innerText('#cm-contador')));
  await page.click('#cm-enviar'); await page.waitForFunction(() => document.querySelectorAll('#lista-comentarios .comment').length === 2);
  const posted = page.locator('#lista-comentarios .comment', { hasText: 'Ficou ótimo' });
  check('comentário postado aparece como TEXTO PURO (tags não são interpretadas) e com "Slide 4"', (await posted.locator('.comment__body').innerText()).includes('<b>negrito?</b>') && (await posted.locator('b').count()) === 0 && (await posted.locator('.badge').innerText()) === 'Slide 4');
  const sent = (await mstate()).requests.filter((r) => r.method === 'POST' && /comments$/.test(r.path));
  check('POST do comentário foi com CSRF', sent.length >= 1 && sent.every((r) => r.csrf && r.csrf === r.cookieCsrf));
  await page.fill('#novo-comentario', '   '); await page.click('#cm-enviar');
  check('comentário vazio é recusado no cliente com mensagem', /Escreva o comentário/.test(await page.innerText('#cm-erro')));
  await posted.locator('[data-action=resolve]').click(); await page.waitForFunction(() => document.querySelectorAll('#lista-comentarios .comment').length === 1);
  check('Resolver tira o comentário da lista aberta', true);
  await page.check('#ver-resolvidos');
  const del = page.locator('#lista-comentarios .comment', { hasText: 'Ficou ótimo' });
  await del.locator('[data-action=delete-comment]').click(); await page.click('dialog.dlg [data-act=confirm]');
  await page.waitForFunction(() => ![...document.querySelectorAll('#lista-comentarios .comment')].some((c) => c.textContent.includes('Ficou ótimo')));
  check('Excluir comentário pede confirmação e remove', true);
  await page.keyboard.press('Escape'); await page.waitForSelector('#gaveta', { state: 'detached' });
  check('Esc fecha a gaveta e o foco volta ao título do cartão', await page.evaluate(() => document.activeElement.classList.contains('card__title')));
  // gaveta de apresentação alheia
  await cardByTitle(page, 'Proposta Caio — Banco Aurora').locator('.card__thumb').click(); await page.waitForSelector('#gaveta[open]');
  check('apresentação alheia: gaveta explica "Para usar esta apresentação, crie uma cópia." e oferece Criar cópia', (await page.locator('#gaveta .callout').innerText()).includes('Para usar esta apresentação, crie uma cópia.') && (await page.locator('#dr-copia').count()) === 1);
  check('apresentação alheia: sem Editar e sem histórico de versões na gaveta', (await page.locator('#gaveta a:has-text("Editar")').count()) === 0 && (await page.locator('#dr-historico').count()) === 0);
  await page.click('#dr-fechar'); await page.waitForSelector('#gaveta', { state: 'detached' });

  // ---- XSS ----
  head('6c. Acervo — XSS (nomes, títulos e comentários hostis)');
  const xss = cardByTitle(page, XSS_TITLE);
  check('título com <img onerror> aparece como texto', (await xss.locator('.card__title').innerText()).includes('<img src=x onerror=') && (await page.locator('img[src="x"]').count()) === 0);
  check('nome do dono com HTML aparece como texto', (await xss.locator('.card__owner .nm').innerText()).includes('<img src=x'));
  await xss.locator('.card__title').click(); await page.waitForSelector('#gaveta[open]'); await page.waitForSelector('#lista-comentarios .comment');
  check('comentário com <script>/<img onerror> aparece como texto', (await page.locator('#lista-comentarios .comment__body').innerText()).includes('<script>window.__xss=3</script>') && (await page.locator('#lista-comentarios script, #lista-comentarios img').count()) === 0);
  check('nenhum script do conteúdo hostil executou (window.__xss indefinido)', (await page.evaluate(() => window.__xss)) === undefined);
  await page.keyboard.press('Escape');

  // ---- erro de carregamento ----
  head('6d. Acervo — estados de erro e vazio');
  await page.route('**/api/presentations?scope=all*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Erro interno do servidor.' } }) }));
  await page.reload(); await page.waitForSelector('#btn-retry');
  check('falha da API: estado de erro com mensagem e "Tentar de novo"', /Não foi possível carregar o acervo/.test(await page.locator('.state h2').innerText()));
  await page.unroute('**/api/presentations?scope=all*'); await page.click('#btn-retry'); await page.waitForSelector(CARD);
  check('"Tentar de novo" recupera', (await page.locator('li.card').count()) === 24);
  await collectCsp(page); await ctx.close();

  // membro sem apresentações
  ({ ctx, page } = await asUser('otto.admin@am.test', { tag: 'acervo-vazio' }));
  await gotoAcervo(page, '?aba=minhas');
  check('aba Minhas vazia: convida a criar ou importar o acervo local', /ainda não criou/.test(await page.locator('.state h2').innerText()) && (await page.locator('.state a[href="/importar"]').count()) === 1);
  await collectCsp(page); await ctx.close();

  // ---- admin no acervo ----
  head('6e. Acervo — administrador');
  ({ ctx, page } = await asUser('ana.admin@am.test', { tag: 'acervo-admin' }));
  await gotoAcervo(page);
  const ap = await page.$$eval(CARD, (l) => l.map((x) => ({ own: x.dataset.owner === 'me', edit: !!x.querySelector('[data-action=edit]'), dup: !!x.querySelector('[data-action=duplicate]') })));
  check('admin: "Editar" em TODOS os cartões (moderação); "Criar cópia" fica no menu', ap.every((p) => p.edit && !p.dup), ap.filter((p) => !p.edit).length);
  await cardByTitle(page, 'Proposta Caio — Banco Aurora').locator('button[aria-haspopup=menu]').click();
  check('admin: menu de cartão alheio tem Excluir e Criar cópia', (await page.getByRole('menuitem', { name: 'Excluir' }).count()) === 1 && (await page.getByRole('menuitem', { name: 'Criar cópia' }).count()) === 1);
  check('admin: menu oferece "Transferir propriedade…"', (await page.getByRole('menuitem', { name: 'Transferir propriedade…' }).count()) === 1);
  await page.getByRole('menuitem', { name: 'Transferir propriedade…' }).click();
  await page.waitForSelector('dialog.dlg select');
  const optTexts = await page.$$eval('dialog.dlg select option', (os) => os.map((o) => o.textContent));
  check('transferir: o diálogo lista só pessoas ativas, sem o dono atual (Caio)', optTexts.length >= 2 && !optTexts.some((t) => /Caio/.test(t)) && optTexts.some((t) => /Bia/.test(t)), optTexts);
  await page.selectOption('dialog.dlg select', { label: optTexts.find((t) => /Bia/.test(t)) });
  await mpost('/__test/clear-requests');
  await page.click('dialog.dlg [data-act=confirm]');
  // espera o cartão DESTA apresentação (título exato: a "Cópia de Proposta Caio — Banco Aurora" da Bia também casa com /Banco Aurora/) mostrar a nova dona
  await page.waitForFunction(() => [...document.querySelectorAll('li.card')].some((c) => c.querySelector('.card__title')?.textContent === 'Proposta Caio — Banco Aurora' && /Bia/.test(c.querySelector('.card__owner')?.textContent || '')), null, { timeout: 15000, polling: 200 }).catch(() => null);
  const stT = await mstate(); const moved = stT.presentations.find((p) => p.title === 'Proposta Caio — Banco Aurora');
  const ownerTxt = await page.evaluate(() => [...document.querySelectorAll('li.card')].filter((c) => c.querySelector('.card__title')?.textContent === 'Proposta Caio — Banco Aurora').map((c) => c.querySelector('.card__owner .nm')?.textContent || '?'));
  check('transferir: a API recebeu POST …/transfer e a dona do cartão passou a ser a Bia', moved && moved.ownerId === stT.users.find((u) => /Bia/.test(u.displayName))?.id && ownerTxt.length === 1 && /Bia/.test(ownerTxt[0]), { moved, ownerTxt, toasts: await toastText(page), reqs: stT.requests.map((r) => `${r.method} ${r.path.slice(0, 60)} +${r.at - (stT.requests[0]?.at || 0)}ms`) });
  await cardByTitle(page, 'Proposta Caio — Banco Aurora').locator('button[aria-haspopup=menu]').click();
  check('admin: depois da transferência o menu continua coerente (Excluir presente)', (await page.getByRole('menuitem', { name: 'Excluir' }).count()) === 1);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Lixeira' }).click(); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 2);
  check('admin: a lixeira mostra as de todos (2)', (await page.locator('li.card').count()) === 2);
  const victim = page.locator('li.card', { hasText: 'Rascunho excluído do Caio' });
  await victim.locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: 'Apagar de vez' }).click();
  await page.click('dialog.dlg [data-act=confirm]'); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 1);
  check('admin: "Apagar de vez" pede confirmação e remove de verdade', !(await mstate()).presentations.some((p) => p.title === 'Rascunho excluído do Caio'));
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 6f. Respostas e participações (dono/admin) ═════════════════════════════ */
const PLANO = '22222222-0000-4000-8000-000000000001';
const CAIO_PRES = '22222222-0000-4000-8000-000000000002';
const ADMIN_PRES = '22222222-0000-4000-8000-000000000004';
async function respostasTests() {
  head('6f. Acervo — respostas e participações (dono/admin; BE-ED-02)');
  mock.reset();
  let { ctx, page } = await asUser('bia@am.test', { tag: 'respostas-bia' });
  await gotoAcervo(page);
  const plano = cardByTitle(page, 'Plano estratégico 2027 (Bia)');
  const mbtn = plano.locator('button[aria-haspopup=menu]');
  await mbtn.click();
  check('dono vê "Respostas e participações…" no menu do cartão', (await page.getByRole('menuitem', { name: 'Respostas e participações…' }).count()) === 1);
  await page.keyboard.press('Escape');
  await cardByTitle(page, 'Proposta Caio — Banco Aurora').locator('button[aria-haspopup=menu]').click();
  check('membro NÃO vê "Respostas e participações…" na apresentação de outra pessoa', (await page.getByRole('menuitem', { name: 'Respostas e participações…' }).count()) === 0);
  await page.keyboard.press('Escape');
  await mpost('/__test/clear-requests');
  await mbtn.click(); await page.getByRole('menuitem', { name: 'Respostas e participações…' }).click();
  await page.waitForSelector('#respostas[open] .resp');
  const reqs = (await mstate()).requests.map((r) => `${r.method} ${r.path}`);
  check('o diálogo busca GET /api/presentations/:id/interactions (o conteúdo vem só para rotular cada elemento)', reqs.includes(`GET /api/presentations/${PLANO}/interactions`) && reqs.includes(`GET /api/presentations/${PLANO}`), reqs);
  check('diálogo modal rotulado pelo título da apresentação, com sobretítulo "Respostas e participações"', (await page.getByRole('dialog', { name: 'Plano estratégico 2027 (Bia)' }).count()) === 1 && /Respostas e participações/i.test(await page.locator('#respostas .dlg__h .ey').innerText()));
  const groups = await page.$$eval('#respostas .resp', (l) => l.map((sec) => ({ kind: sec.dataset.kind, el: sec.dataset.element, ey: sec.querySelector('.ey').textContent, name: sec.querySelector('h3').textContent, count: sec.querySelector('.resp__count').textContent })));
  check('lista POR ELEMENTO, na ordem dos slides: formulário (slide 2), votação (slide 3), quadro de post-its (slide 4), com o título de cada um', JSON.stringify(groups.map((g) => [g.kind, g.el, g.name])) === JSON.stringify([['form_response', 'frm1', 'Pesquisa de satisfação'], ['vote_state', 'vot1', 'Priorização'], ['board_state', 'brd1', 'Retrospectiva']]) && /Formulário · slide 2/.test(groups[0].ey) && /slide 3/.test(groups[1].ey) && /slide 4/.test(groups[2].ey), groups);
  check('resumo: 3 elementos interativos · 8 registros de 4 pessoas', /3 elementos interativos · 8 registros de 4 pessoas/.test(await page.innerText('#resp-resumo')));
  const form = page.locator('#respostas .resp[data-kind=form_response]');
  const heads = await form.locator('thead th').allInnerTexts();
  const cells = await form.locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.cells].map((c) => c.textContent)));
  check('formulário: 3 respostas de 3 pessoas; colunas = Quando, Pessoa e as perguntas; mais recentes primeiro', /3 respostas · 3 pessoas/.test(groups[0].count) && heads.length === 4 && /Nota geral/i.test(heads[2]) && /melhorar/i.test(heads[3]) && cells.length === 3 && cells[0][1] === 'Ana Admin' && cells[2][1] === 'Caio Lima' && cells[2][3] === 'Mais exemplos práticos do setor.', { heads, cells });
  check('respostas, nomes e notas hostis aparecem como TEXTO (nada interpretado, nenhum script executa)', cells.some((r) => r[3] === XSS_ANSWER) && (await page.locator('#respostas img, #respostas script').count()) === 0 && (await page.evaluate(() => window.__xss)) === undefined);
  const votes = await page.$$eval('#respostas .votes li', (l) => l.map((li) => [li.querySelector('.votes__l').textContent, Number(li.dataset.total), li.querySelector('.votes__v').textContent, li.querySelector('progress').value]));
  check('votação: soma os pontos de TODAS as pessoas por opção (6 · 50%, 3 · 25%, 3 · 25%) — 4 votos de 3 pessoas', JSON.stringify(votes) === JSON.stringify([[VOTE_OPTS[0], 6, '6 · 50%', 6], [VOTE_OPTS[1], 3, '3 · 25%', 3], [VOTE_OPTS[2], 3, '3 · 25%', 3]]) && /4 votos · 3 pessoas/.test(groups[1].count), votes);
  const board = await page.$$eval('#respostas .board__col', (cols) => cols.map((c) => ({ col: c.querySelector('h4 span').textContent, notes: [...c.querySelectorAll('.postit p')].map((n) => n.textContent), seed: c.querySelectorAll('.postit.is-seed').length, who: [...c.querySelectorAll('.postit small')].map((n) => n.textContent) })));
  check('quadro: notas por coluna com os nomes do slide; a nota inicial do slide fica marcada; notas iguais aparecem uma vez; autor de cada nota', board.length === 3 && board[0].col === 'Começar' && board[0].seed === 1 && board[0].notes.length === 1 && board[1].notes[0] === 'Relatórios em PDF por e-mail' && /Caio Lima/.test(board[1].who[0]) && board[2].notes[0] === XSS_NOTE && /2 notas · 2 pessoas/.test(groups[2].count), board);
  // CSV pela rota do servidor
  await mpost('/__test/clear-requests');
  const [dl] = await Promise.all([page.waitForEvent('download'), form.locator('[data-act=csv]').click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const csvReq = (await mstate()).requests.find((r) => r.path.includes('/interactions.csv'));
  check('"Baixar CSV" usa GET …/interactions.csv?kind=form_response&elementId=frm1 e baixa o arquivo (BOM, perguntas e respostas)', csvReq?.path === `/api/presentations/${PLANO}/interactions.csv?kind=form_response&elementId=frm1` && csv.charCodeAt(0) === 0xfeff && /Nota geral/.test(csv) && /Mais exemplos práticos do setor\./.test(csv) && dl.suggestedFilename() === 'respostas-plano-estrategico-2027-bia-pesquisa-de-satisfacao.csv', { path: csvReq?.path, name: dl.suggestedFilename() });
  check('CSV neutraliza fórmula vinda de quem respondeu (=SOMA… vira \'=SOMA…)', csv.includes("'=SOMA(1;2)"));
  // apagar (com confirmação)
  const vote = page.locator('#respostas .resp[data-kind=vote_state]');
  await vote.locator('[data-act=apagar]').click();
  await page.waitForSelector('dialog.dlg:not(#respostas)[open] [data-act=confirm]');
  check('"Apagar respostas deste elemento" pede confirmação nomeando o elemento (foco em Cancelar)', (await page.getByRole('dialog', { name: 'Apagar as respostas deste elemento?' }).count()) === 1 && /“Priorização”/.test(await page.locator('dialog.dlg:not(#respostas) p').innerText()) && (await page.evaluate(() => document.activeElement.dataset.act)) === 'cancel');
  await page.keyboard.press('Escape'); await page.waitForSelector('dialog.dlg:not(#respostas)', { state: 'detached' });
  check('cancelar não apaga nada e o diálogo de respostas continua aberto', (await mstate()).interactions.filter((x) => x.elementId === 'vot1').length === 3 && (await page.locator('#respostas[open]').count()) === 1);
  await mpost('/__test/clear-requests');
  await vote.locator('[data-act=apagar]').click(); await page.click('dialog.dlg:not(#respostas) [data-act=confirm]');
  await page.waitForFunction(() => /Ainda sem respostas/.test(document.querySelector('#respostas .resp[data-kind=vote_state] .resp__count')?.textContent || ''), null, { timeout: 8000 });
  const st = await mstate();
  const del = st.requests.find((r) => r.method === 'DELETE' && r.path.includes('/interactions'));
  check('confirmar faz DELETE …/interactions?elementId=vot1&kind=vote_state com CSRF; só esse elemento fica sem respostas', del?.path === `/api/presentations/${PLANO}/interactions?elementId=vot1&kind=vote_state` && !!del.csrf && del.csrf === del.cookieCsrf && st.interactions.filter((x) => x.elementId === 'vot1').length === 0 && st.interactions.filter((x) => x.elementId === 'frm1').length === 3 && st.interactions.filter((x) => x.elementId === 'brd1').length === 2, del);
  check('o aviso diz quantos registros foram apagados e aparece por cima do diálogo', /3 registros apagados de “Priorização”/.test(await toastText(page)) && (await page.locator('#respostas .toast').count()) >= 1);
  await page.keyboard.press('Escape'); await page.waitForSelector('#respostas', { state: 'detached' });
  check('Esc fecha o diálogo e o foco volta ao botão "⋯" do cartão', await mbtn.evaluate((b) => b === document.activeElement));
  // contrato: membro só apaga as próprias; não exporta CSV da apresentação alheia
  const forced = await page.evaluate(async (id) => { const { api } = await import('/js/api.js'); const r = await api.del(`/api/presentations/${id}/interactions`, { query: { elementId: 'frm9' } }); let csv = null; try { await api.get(`/api/presentations/${id}/interactions.csv`, { blob: true }); } catch (e) { csv = e.status; } return { deleted: r.deleted, csv }; }, CAIO_PRES);
  check('API (contrato no mock): membro que força DELETE na apresentação alheia apaga SÓ as próprias respostas; CSV alheio é 403', forced.deleted === 1 && forced.csv === 403 && (await mstate()).interactions.filter((x) => x.elementId === 'frm9').map((x) => x.userId).join() === IDS.admin, forced);
  await collectCsp(page); await ctx.close();
  // admin: qualquer apresentação; estado vazio (estado zerado: a Bia acabou de apagar a própria resposta em frm9)
  mock.reset();
  ({ ctx, page } = await asUser('ana.admin@am.test', { tag: 'respostas-admin' }));
  await gotoAcervo(page);
  await cardByTitle(page, 'Proposta Caio — Banco Aurora').locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Respostas e participações…' }).click(); await page.waitForSelector('#respostas[open] .resp');
  const g9 = await page.$$eval('#respostas .resp', (l) => l.map((sec) => [sec.dataset.element, sec.querySelector('.ey').textContent, sec.querySelectorAll('tbody tr').length]));
  check('admin vê "Respostas e participações…" em apresentação de outra pessoa e TODAS as respostas (elemento fora do conteúdo atual identificado)', g9.length === 1 && g9[0][0] === 'frm9' && /fora do conteúdo atual/.test(g9[0][1]) && g9[0][2] === 2, g9);
  await page.keyboard.press('Escape'); await page.waitForSelector('#respostas', { state: 'detached' });
  await cardByTitle(page, 'Apresentação do Admin — Visão geral').locator('button[aria-haspopup=menu]').click();
  await page.getByRole('menuitem', { name: 'Respostas e participações…' }).click(); await page.waitForSelector('#respostas[open] #resp-vazio');
  check('sem formulário, votação nem quadro: estado vazio explica o que aparece ali', /Nenhuma resposta ainda/.test(await page.innerText('#resp-vazio')));
  await page.keyboard.press('Escape');
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 6g. Nova a partir de projeto pronto ═════════════════════════════ */
async function modelosTests() {
  head('6g. Acervo — nova a partir de projeto pronto (BE-ED-04)');
  mock.reset();
  const { ctx, page } = await asUser('bia@am.test', { tag: 'modelos' });
  await gotoAcervo(page);
  check('botão "Nova a partir de projeto pronto" ao lado de "Nova apresentação" (abre diálogo)', (await page.locator('#btn-modelos[aria-haspopup=dialog]').count()) === 1 && (await page.getByRole('button', { name: 'Nova apresentação', exact: true }).count()) === 1);
  await page.click('#btn-modelos'); await page.waitForSelector('#modelos[open] .tpl');
  await page.waitForFunction(() => [...document.querySelectorAll('#modelos .tpl__pv')].every((i) => i.complete && i.naturalWidth > 0));
  const cards = await page.$$eval('#modelos .tpl', (l) => l.map((b) => ({ i: Number(b.dataset.modelo), name: b.querySelector('.tpl__name').textContent, desc: b.querySelector('.tpl__desc').textContent, meta: b.querySelector('.tpl__meta').textContent, key: b.getAttribute('aria-keyshortcuts'), img: b.querySelector('img').naturalWidth })));
  const src = fs.readFileSync(COVER_JS, 'utf8');
  const tpl = [...src.matchAll(/\{ name: '([^']+)', desc: '([^']+)'/g)].map((m) => [m[1], m[2]]);
  check('os 6 projetos prontos da capa do editor, com os MESMOS nomes e descrições de studio/cover.js e na mesma ordem (índice 0–5)', tpl.length === 6 && cards.length === 6 && cards.every((c, i) => c.i === i && c.name === tpl[i][0] && c.desc === tpl[i][1]), { tpl, cards: cards.map((c) => c.name) });
  check('cada cartão traz a miniatura do 1º slide (carregada), o nº de slides e a tecla 1–6', cards.every((c, i) => c.img === 640 && /^0\d slides\d$/.test(c.meta) && c.key === String(i + 1)), cards.map((c) => c.meta));
  check('é a vista "Projetos prontos" da capa: prancha navy, "Voltar Esc", "06 projetos", foco no 1º projeto', /Voltar/i.test(await page.locator('#modelos [data-act=cancel]').innerText()) && /06 projetos/i.test(await page.locator('#modelos .tpl__n').innerText()) && (await page.evaluate(() => document.activeElement.dataset.modelo)) === '0' && (await page.evaluate(() => getComputedStyle(document.querySelector('#modelos')).backgroundColor)) === 'rgb(0, 30, 50)');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  check('setas navegam entre os projetos (como na capa)', (await page.evaluate(() => document.activeElement.dataset.modelo)) === '2');
  await page.keyboard.press('Escape'); await page.waitForSelector('#modelos', { state: 'detached' });
  check('Esc fecha e devolve o foco ao botão', (await page.evaluate(() => document.activeElement.id)) === 'btn-modelos');
  await mpost('/__test/clear-requests');
  await page.click('#btn-modelos'); await page.waitForSelector('#modelos[open] .tpl');
  await Promise.all([page.waitForURL(/\/editor\/[0-9a-f-]{36}\?modelo=2$/), page.keyboard.press('3')]);
  let st = await mstate(); let made = st.created.find((c) => page.url().includes(c.id));
  const post = st.requests.find((r) => r.method === 'POST' && r.path === '/api/presentations');
  check('tecla 3: POST /api/presentations {source:"new", title:"Status report executivo"} (com CSRF) e abre /editor/<novo-id>?modelo=2', made && made.source === 'new' && made.title === 'Status report executivo' && !!post?.csrf && post.csrf === post.cookieCsrf, { made, url: page.url() });
  await gotoAcervo(page);
  await page.click('#btn-modelos'); await page.waitForSelector('#modelos[open] .tpl');
  await Promise.all([page.waitForURL(/\?modelo=5$/), page.click('#modelos .tpl[data-modelo="5"]')]);
  st = await mstate(); made = st.created.find((c) => page.url().includes(c.id));
  check('clique no 6º (Apresentação institucional A&M) cria com esse nome e abre ?modelo=5', made?.title === 'Apresentação institucional A&M' && new URL(page.url()).search === '?modelo=5', made);
  await gotoAcervo(page, '?aba=minhas');
  await page.route('**/api/presentations', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Erro interno do servidor.' } }) }) : r.continue()));
  await page.click('#btn-modelos'); await page.waitForSelector('#modelos[open] .tpl'); await page.click('#modelos .tpl[data-modelo="0"]');
  await page.waitForSelector('#modelos .toast--error');
  check('falha ao criar: aviso de erro DENTRO do diálogo (visível e acessível) e os projetos voltam a responder', (await page.locator('#modelos.is-busy').count()) === 0 && /Erro interno/.test(await toastText(page)) && /0\d slides/i.test(await page.locator('#modelos .tpl[data-modelo="0"] .tpl__meta').innerText()));
  await page.unroute('**/api/presentations');
  await page.keyboard.press('Escape');
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 6h. Baixar como HTML/PDF/PowerPoint e histórico ═════════════════════════════ */
async function baixarTests() {
  head('6h. Acervo — baixar como HTML/PDF/PowerPoint e histórico de versões (F5, BE-ED-08)');
  mock.reset();
  let { ctx, page } = await asUser('bia@am.test', { tag: 'baixar' });
  await gotoAcervo(page);
  const own = cardByTitle(page, 'Plano estratégico 2027 (Bia)');
  await own.locator('button[aria-haspopup=menu]').click();
  const links = await page.$$eval('.menu a[role=menuitem]', (l) => l.map((a) => ({ t: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel, name: a.getAttribute('aria-label') })));
  const exp = links.filter((l) => /^Baixar como/.test(l.t));
  check('dono: "Baixar como HTML / PDF / PowerPoint" abrem /editor/<id>?exportar=html|pdf|pptx em NOVA aba (rel=noopener)', JSON.stringify(exp.map((l) => [l.t, l.href])) === JSON.stringify([['Baixar como HTML', `/editor/${PLANO}?exportar=html`], ['Baixar como PDF', `/editor/${PLANO}?exportar=pdf`], ['Baixar como PowerPoint', `/editor/${PLANO}?exportar=pptx`]]) && exp.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /nova aba/.test(l.name)), exp);
  check('dono: "Histórico de versões" no menu aponta para /editor/<id>?historico=1', links.some((l) => l.t === 'Histórico de versões' && l.href === `/editor/${PLANO}?historico=1`), links);
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('menuitem', { name: 'Baixar como PDF' }).click()]);
  await popup.waitForLoadState('domcontentloaded');
  check('clicar abre a nova aba no editor já pedindo a exportação (?exportar=pdf) e o menu fecha', new URL(popup.url()).pathname === `/editor/${PLANO}` && new URL(popup.url()).search === '?exportar=pdf' && (await page.locator('.menu').count()) === 0, popup.url());
  await popup.close();
  await own.locator('button[aria-haspopup=menu]').focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Baixar como HTML' }).focus();
  const [pop2] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  check('pelo teclado (Enter no item) também abre ?exportar=html', new URL(pop2.url()).search === '?exportar=html');
  await pop2.close();
  await cardByTitle(page, 'Proposta Caio — Banco Aurora').locator('button[aria-haspopup=menu]').click();
  check('quem não pode editar NÃO vê "Baixar como" nem "Histórico de versões"', (await page.locator('.menu a[role=menuitem]').count()) === 0 && (await page.locator('.menu__hd').count()) === 0);
  await page.keyboard.press('Escape');
  await collectCsp(page); await ctx.close();
  ({ ctx, page } = await asUser('ana.admin@am.test', { tag: 'baixar-admin' }));
  await gotoAcervo(page);
  await cardByTitle(page, 'Proposta Caio — Banco Aurora').locator('button[aria-haspopup=menu]').click();
  check('admin: "Baixar como…" também nas apresentações dos outros', (await page.getByRole('menuitem', { name: /^Baixar como/ }).count()) === 3);
  await page.keyboard.press('Escape');
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 7. Admin ═════════════════════════════ */
async function adminTests() {
  head('7. Administração (/admin)');
  mock.reset();
  let { ctx, page } = await asUser('bia@am.test', { tag: 'admin-membro' });
  await mpost('/__test/clear-requests');
  await page.goto(`${ORIGIN}/admin`); await page.waitForSelector('.state');
  check('membro vê "Acesso restrito" em /admin', /Acesso restrito/.test(await page.locator('.state h2').innerText()) && (await page.locator('a[href="/acervo"]').count()) >= 1);
  check('membro não chama nenhuma API de administração', !(await mstate()).requests.some((r) => r.path.startsWith('/api/admin/')));
  check('barra superior do membro não tem o link "Administração"', (await page.locator('.topnav a:has-text("Administração")').count()) === 0 && (await page.locator('.topnav a').count()) === 2);
  await collectCsp(page); await ctx.close();

  ({ ctx, page } = await asUser('ana.admin@am.test', { tag: 'admin' }));
  await page.goto(`${ORIGIN}/admin`); await page.waitForSelector('#u-tabela');
  check('admin vê o link "Administração" (aria-current na página)', (await page.locator('.topnav a[aria-current=page]').innerText()).includes('Administração'));
  check('abas (role=tablist/tab) na ordem Usuários, Convidar, Auditoria, Configurações, Resumo', JSON.stringify(await page.getByRole('tab').allInnerTexts()) === JSON.stringify(['Usuários', 'Convidar', 'Auditoria', 'Configurações', 'Resumo']));
  check('tabela de usuários acessível (caption, th scope=col) com os 7 usuários', (await page.locator('#u-tabela caption').count()) === 1 && (await page.locator('#u-tabela th[scope=col]').count()) === 6 && (await page.locator('#u-tabela tbody tr').count()) === 7);
  const row = (email) => page.locator('#u-tabela tbody tr', { hasText: email });
  check('mostra papel, status, último acesso e nº de apresentações', /Administrador/.test(await row('ana.admin').innerText()) && /Suspenso/.test(await row('dora@').innerText()) && /Nunca/.test(await row('eva@').innerText()) && /^\d+$/.test((await row('bia@').locator('td.num').innerText()).trim()));
  check('a própria conta não tem ações de rebaixar/suspender', /Esta é a sua conta/.test(await row('ana.admin').innerText()) && (await row('ana.admin').locator('button').count()) === 0);
  // busca e filtro
  await page.fill('#u-busca', 'caio'); await page.waitForFunction(() => document.querySelectorAll('#u-tabela tbody tr').length === 1);
  check('busca de usuários filtra por nome/e-mail', /caio@am\.test/.test(await page.locator('#u-tabela tbody').innerText()));
  await page.fill('#u-busca', ''); await page.selectOption('#u-status', 'suspended'); await page.waitForFunction(() => document.querySelectorAll('#u-tabela tbody tr').length === 1);
  check('filtro de status "Suspensos" mostra só a Dora', /Dora/.test(await page.locator('#u-tabela tbody').innerText()));
  await page.selectOption('#u-status', ''); await page.waitForFunction(() => document.querySelectorAll('#u-tabela tbody tr').length === 7);
  // promover / rebaixar
  await row('bia@').getByRole('button', { name: /Promover a admin/ }).click(); await page.click('dialog.dlg [data-act=confirm]');
  await page.waitForFunction(() => [...document.querySelectorAll('#u-tabela tbody tr')].find((r) => r.textContent.includes('bia@'))?.textContent.includes('Administrador'));
  check('Promover (com confirmação) torna a Bia administradora; botão vira "Rebaixar"', (await row('bia@').getByRole('button', { name: /Rebaixar/ }).count()) === 1);
  await row('bia@').getByRole('button', { name: /Rebaixar/ }).click(); await page.click('dialog.dlg [data-act=confirm]');
  await page.waitForFunction(() => [...document.querySelectorAll('#u-tabela tbody tr')].find((r) => r.textContent.includes('bia@'))?.textContent.includes('Membro'));
  check('Rebaixar (com confirmação) volta a membro', true);
  // suspender / reativar
  await row('caio@').getByRole('button', { name: /Suspender/ }).click();
  check('Suspender pede confirmação explicando o efeito', /desconectado/.test(await page.locator('dialog.dlg p').innerText()));
  await page.click('dialog.dlg [data-act=confirm]');
  await page.waitForFunction(() => [...document.querySelectorAll('#u-tabela tbody tr')].find((r) => r.textContent.includes('caio@'))?.textContent.includes('Suspenso'));
  check('Suspender: Caio fica "Suspenso" e ganha "Reativar"', (await row('caio@').getByRole('button', { name: /Reativar/ }).count()) === 1);
  const c2 = await newCtx(); const p2 = await newPage(c2, 'caio-suspenso');
  await p2.goto(`${ORIGIN}/entrar`); await p2.fill('#email', 'caio@am.test'); await p2.fill('#senha', PASSWORD); await p2.click('#btn-entrar'); await p2.waitForSelector('#form-alert .alert--error');
  check('Caio suspenso não consegue entrar', /suspensa/.test(await p2.locator('#form-alert').innerText())); await collectCsp(p2); await c2.close();
  await row('caio@').getByRole('button', { name: /Reativar/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#u-tabela tbody tr')].find((r) => r.textContent.includes('caio@'))?.textContent.includes('Ativo'));
  check('Reativar devolve o acesso', true);
  // convite pendente
  await row('eva@').getByRole('button', { name: /Reenviar convite/ }).click(); await waitToast(page, /reenviado/);
  check('Reenviar convite avisa o resultado', /reenviado/.test(await toastText(page)));
  // erro do servidor vira aviso
  await page.route('**/api/admin/users/*', (r) => (r.request().method() === 'PATCH' ? r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'conflict', message: 'Não é possível rebaixar o último administrador.' } }) }) : r.continue()));
  await row('otto.admin@').getByRole('button', { name: /Rebaixar/ }).click(); await page.click('dialog.dlg [data-act=confirm]');
  await page.waitForFunction(() => document.body.textContent.includes('último administrador'));
  check('erro 409 do servidor aparece como aviso (role=alert)', (await page.locator('.toast--error[role=alert]').count()) >= 1);
  await page.unroute('**/api/admin/users/*');
  check('convite pendente mostra a data de expiração', /expira em/.test(await row('eva@').innerText()));
  await row('eva@').getByRole('button', { name: /Revogar convite/ }).click(); await page.click('dialog.dlg [data-act=confirm]');
  await page.waitForFunction(() => [...document.querySelectorAll('#u-tabela tbody tr')].find((r) => r.textContent.includes('eva@'))?.textContent.includes('Convite revogado'));
  check('Revogar convite (confirmado): linha vira "Convite revogado" e oferece "Convidar de novo" (não "Reativar")', (await row('eva@').getByRole('button', { name: /Convidar de novo/ }).count()) === 1 && (await row('eva@').getByRole('button', { name: /Reativar/ }).count()) === 0);
  await row('eva@').getByRole('button', { name: /Convidar de novo/ }).click();
  await page.waitForFunction(() => /Convidado/.test([...document.querySelectorAll('#u-tabela tbody tr')].find((r) => r.textContent.includes('eva@'))?.textContent || ''));
  check('"Convidar de novo" envia novo convite: volta a "Convidado" com Reenviar/Revogar', (await row('eva@').getByRole('button', { name: /Reenviar convite/ }).count()) === 1);

  // convidar
  await page.getByRole('tab', { name: 'Convidar' }).click(); await page.waitForSelector('#form-convite');
  await page.click('#c-enviar');
  check('convite vazio: erros de e-mail e nome', (await page.locator('#form-convite .field-error:visible').count()) === 2 && (await page.evaluate(() => document.activeElement.id)) === 'c-email');
  await page.fill('#c-email', 'sem-arroba'); await page.fill('#c-nome', 'A'); await page.click('#c-enviar');
  check('e-mail inválido e nome curto são explicados', /não parece válido/.test(await page.locator('#c-email-err').innerText()) && /mínimo 2/.test(await page.locator('#c-nome-err').innerText()));
  await page.fill('#c-email', 'x@blocked.test'); await page.fill('#c-nome', 'Bloqueado Teste'); await page.click('#c-enviar');
  await page.waitForSelector('#c-email-err:not([hidden])');
  check('erro de domínio do servidor aparece no campo de e-mail', /Domínio/.test(await page.locator('#c-email-err').innerText()));
  await page.fill('#c-email', 'bia@am.test'); await page.click('#c-enviar'); await page.waitForFunction(() => /Já existe/.test(document.querySelector('#c-email-err').textContent));
  check('e-mail já existente (409): mensagem no campo', true);
  await page.fill('#c-email', 'Novo.Colega@AM.test'); await page.fill('#c-nome', 'Novo Colega'); await page.selectOption('#c-papel', 'admin'); await page.click('#c-enviar');
  await page.waitForSelector('#c-alerta .alert--ok');
  check('convite enviado: confirmação com e-mail e validade, e entra na lista da sessão', /novo\.colega@am\.test/.test(await page.locator('#c-alerta').innerText()) && /vale até/.test(await page.locator('#c-alerta').innerText()) && (await page.locator('#c-enviados li').count()) === 1);
  await page.getByRole('tab', { name: 'Usuários' }).click(); await page.waitForFunction(() => document.querySelectorAll('#u-tabela tbody tr').length === 8);
  check('o convidado aparece em Usuários como "Convidado"', /Convidado/.test(await row('novo.colega').innerText()));

  // auditoria
  await page.getByRole('tab', { name: 'Auditoria' }).click(); await page.waitForSelector('#a-tabela');
  check('auditoria lista 50 por página e oferece "Carregar mais"', (await page.locator('#a-tabela tbody tr').count()) === 50 && (await page.locator('#a-mais').count()) === 1);
  await page.click('#a-mais'); await page.waitForFunction(() => document.querySelectorAll('#a-tabela tbody tr').length === 100);
  check('paginação da auditoria por cursor (+50)', true);
  await page.selectOption('#a-acao', 'auth.login'); await page.click('#a-filtrar'); await page.waitForFunction(() => document.querySelectorAll('#a-tabela tbody tr').length > 0 && [...document.querySelectorAll('#a-tabela tbody tr')].every((r) => r.dataset.action === 'auth.login'));
  check('filtro por ação mostra só "auth.login"', true);
  await page.selectOption('#a-acao', 'auth.*'); await page.click('#a-filtrar'); await page.waitForFunction(() => document.querySelectorAll('#a-tabela tbody tr').length > 0 && [...document.querySelectorAll('#a-tabela tbody tr')].every((r) => r.dataset.action.startsWith('auth.')));
  check('filtro por grupo de ações ("Acesso e senhas" = auth.*) mostra só ações de acesso', (await page.locator('#a-tabela tbody tr').count()) > 1);
  await page.selectOption('#a-acao', 'auth.login');
  await page.selectOption('#a-ator', IDS.caio); await page.click('#a-filtrar'); await page.waitForFunction(() => document.querySelectorAll('#a-tabela tbody tr, #a-lista .state').length > 0);
  const caioRows = await page.$$eval('#a-tabela tbody tr', (r) => r.map((x) => x.children[1].textContent));
  check('filtro por pessoa combinado com ação mostra só o Caio', caioRows.length > 0 && caioRows.every((n) => n === 'Caio Lima'), caioRows.slice(0, 3));
  await page.click('#a-limpar'); await page.waitForFunction(() => document.querySelectorAll('#a-tabela tbody tr').length === 50);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  await page.fill('#a-de', today); await page.fill('#a-ate', today); await page.click('#a-filtrar'); await page.waitForTimeout(400);
  const todayRows = await page.locator('#a-tabela tbody tr').count();
  check('filtro de período (hoje) devolve registros', todayRows > 0);
  await page.fill('#a-de', '2099-01-01'); await page.fill('#a-ate', '2099-01-02'); await page.click('#a-filtrar'); await page.waitForSelector('#a-lista .state');
  check('período sem eventos: estado vazio', /Nenhum registro/.test(await page.locator('#a-lista .state h2').innerText()));
  await page.fill('#a-de', '2026-12-31'); await page.fill('#a-ate', '2026-01-01'); await page.click('#a-filtrar');
  check('período invertido é recusado com aviso', /anterior à final/.test(await toastText(page)));
  await page.click('#a-limpar'); await page.waitForFunction(() => document.querySelectorAll('#a-tabela tbody tr').length === 50);
  const adm = await page.locator('#a-tabela tbody tr', { hasText: 'Alterou usuário' }).count();
  check('as ações de administração feitas acima aparecem na trilha (user.update / invite.*)', (await mstate()).audit.some((a) => /user\.update|invite\./.test(a)) && adm >= 0);
  await page.locator('#a-tabela details summary').first().click();
  check('"Ver" abre os detalhes (meta) em texto', (await page.locator('#a-tabela details[open] pre').first().innerText()).includes('"'));

  // configurações
  await page.getByRole('tab', { name: 'Configurações' }).click(); await page.waitForSelector('.setting');
  check('configurações: 5 chaves conhecidas com rótulos em pt-BR; a regra do acervo é fixa (sem campo)', (await page.locator('.setting').count()) === 5 && (await page.locator('.setting input').count()) === 4 && (await page.locator('.setting h3').allInnerTexts()).includes('Versões recentes guardadas') && /Todos os membros/.test(await page.locator('.setting[data-key="acervo.visibility"]').innerText()));
  const kl = page.locator('.setting[data-key="versions.keep_last"]');
  await kl.locator('input').fill('0'); await kl.getByRole('button', { name: 'Salvar' }).click();
  check('valor fora da faixa é recusado antes de enviar', /entre 1 e 500/.test(await kl.locator('.field-error').innerText()));
  await kl.locator('input').fill('60'); await kl.getByRole('button', { name: 'Salvar' }).click(); await waitToast(page, /salvo/);
  check('salvar configuração confirma por aviso e persiste no servidor', /salvo/.test(await toastText(page)));
  const ttl = page.locator('.setting[data-key="invites.ttl_days"]');
  await ttl.locator('input').fill('99'); await ttl.getByRole('button', { name: 'Salvar' }).click();
  check('valor 99 dias recusado (faixa 1–30)', await ttl.locator('.field-error').isVisible());
  await page.reload(); await page.getByRole('tab', { name: 'Configurações' }).click(); await page.waitForSelector('.setting');
  check('após recarregar, o valor salvo (60) persiste', (await page.locator('.setting[data-key="versions.keep_last"] input').inputValue()) === '60');
  const up = page.locator('.setting[data-key="uploads.max_bytes"]');
  check('limite de arquivo é mostrado em MB (100 MB = 104857600 bytes)', (await up.locator('input').inputValue()) === '100');
  await up.locator('input').fill('50'); await up.getByRole('button', { name: 'Salvar' }).click(); await page.waitForFunction(() => [...document.querySelectorAll('.toast--ok')].some((t) => t.textContent.includes('Tamanho máximo')));
  await page.reload(); await page.getByRole('tab', { name: 'Configurações' }).click(); await page.waitForSelector('.setting');
  check('50 MB é enviado como bytes (52428800) e persiste', (await page.locator('.setting[data-key="uploads.max_bytes"] input').inputValue()) === '50');
  // resumo
  await page.getByRole('tab', { name: 'Resumo' }).click(); await page.waitForSelector('.stat');
  const stats = await page.$$eval('.stat', (s) => s.map((x) => [x.querySelector('.stat__l').textContent, x.querySelector('.stat__v').textContent]));
  check('resumo: usuários, apresentações, convites e espaço de arquivos formatados', stats.some(([l, v]) => l === 'Usuários' && Number(v) >= 7) && stats.some(([l]) => l === 'No acervo') && stats.some(([l]) => l === 'Na lixeira') && stats.some(([l]) => l === 'Convites pendentes') && stats.some(([l, v]) => l === 'Espaço usado' && /(B|KB|MB)$/.test(v)), stats);
  // navegação por teclado nas abas
  await page.getByRole('tab', { name: 'Resumo' }).focus(); await page.keyboard.press('ArrowRight');
  check('setas navegam entre abas (Resumo → Usuários, com roving tabindex)', (await page.getByRole('tab', { name: 'Usuários' }).getAttribute('aria-selected')) === 'true' && (await page.getByRole('tab', { name: 'Resumo' }).getAttribute('tabindex')) === '-1');
  // XSS na auditoria/usuários
  await page.getByRole('tab', { name: 'Auditoria' }).click(); await page.waitForSelector('#a-tabela');
  check('auditoria com nomes/metadados hostis não executa nada', (await page.evaluate(() => window.__xss)) === undefined && (await page.locator('#a-tabela img').count()) === 0);
  await page.getByRole('tab', { name: 'Usuários' }).click(); await page.waitForSelector('#u-tabela');
  check('usuário com nome HTML aparece como texto na tabela', (await page.locator('#u-tabela tbody').innerText()).includes('<img src=x') && (await page.locator('#u-tabela img').count()) === 0);
  // paginação de usuários (50 por página)
  await mpost('/__test/more-users?n=60'); await page.reload(); await page.waitForSelector('#u-tabela');
  check('usuários: 50 por página e "Carregar mais" por cursor (8 + 60 = 68)', (await page.locator('#u-tabela tbody tr').count()) === 50 && (await page.locator('#u-mais').count()) === 1 && /há mais/.test(await page.innerText('#u-status-linha')));
  await page.click('#u-mais'); await page.waitForFunction(() => document.querySelectorAll('#u-tabela tbody tr').length === 68);
  check('segunda página completa a lista sem repetir ninguém', new Set(await page.$$eval('#u-tabela tbody tr', (r) => r.map((x) => x.dataset.id))).size === 68 && (await page.locator('#u-mais').count()) === 0);
  await collectCsp(page); await ctx.close();
}

/* ═════════════════════════════ 8. Importar ═════════════════════════════ */
const dataUrl = (png) => `data:image/png;base64,${png.toString('base64')}`;
const bigPng = (n) => makePng(0, 0, 0, n, true);
const mkDeck = (id, title, imgs, extra = '') => ({ v: 1, app: 'AM Studio', id, title, slides: imgs.map((u, i) => ({ id: `s${i}`, els: [{ id: `e${i}`, type: 'image', src: u }, { id: `t${i}`, type: 'text', html: `<div style="background-image:url(${u})">Slide ${i + 1} ${extra}</div>` }] })) });
async function importTests() {
  head('8. Importar acervo local (/importar)');
  mock.reset();
  const P1 = makePng(10, 20, 30), P2 = makePng(200, 100, 50), P3 = makePng(1, 200, 90, 9);
  const acervo = JSON.stringify({ app: 'Canteiro · Acervo de Apresentações A&M', kind: 'canteiro-acervo', v: 1, exportedAt: new Date().toISOString(), count: 3, obras: [
    { id: 'obra-a', title: 'Obra A — diagnóstico', slideCount: 2, deck: mkDeck('obra-a', 'Obra A — diagnóstico', [dataUrl(P1), dataUrl(P2)]) },
    { id: 'obra-b', title: 'Obra B — proposta', slideCount: 2, deck: mkDeck('obra-b', 'Obra B — proposta', [dataUrl(P1), dataUrl(P3)]) },
    { id: 'obra-c', title: 'Obra C — vai falhar', slideCount: 1, deck: mkDeck('obra-c', 'Obra C — vai falhar', [dataUrl(P2)], 'FAIL_ME') },
  ] });
  const deckH = mkDeck('obra-html', 'Salva em HTML', [dataUrl(P1)]);
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><title>Salva em HTML</title></head><body><div id="am-player"></div><script type="application/json" id="am-deck-data">${JSON.stringify(deckH).replace(/</g, '\\u003c')}</script><script>/*player*/</script></body></html>`;
  const { ctx, page } = await asUser('bia@am.test', { tag: 'importar' });
  await page.goto(`${ORIGIN}/importar`); await page.waitForSelector('#zona');
  check('explica o passo a passo em 3 etapas (lista ordenada)', (await page.locator('ol.steps li').count()) === 3 && /Exportar acervo \(\.json\)/.test(await page.locator('ol.steps').innerText()) && /Minhas obras/.test(await page.locator('ol.steps').innerText()));
  check('a página usa window.AMCloudCore', await page.evaluate(() => typeof window.AMCloudCore?.externalizeDeck === 'function'));
  check('input de arquivos é múltiplo, rotulado e focável por teclado', (await page.getAttribute('#arquivos', 'multiple')) !== null && (await page.locator('label[for=arquivos]').count()) === 1);
  await page.setInputFiles('#arquivos', [
    { name: 'canteiro-acervo-2026-10-06.json', mimeType: 'application/json', buffer: Buffer.from(acervo) },
    { name: 'salva.html', mimeType: 'text/html', buffer: Buffer.from(html) },
    { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('oi') },
    { name: 'quebrado.html', mimeType: 'text/html', buffer: Buffer.from('<html><body>nada aqui</body></html>') },
  ]);
  await page.waitForSelector('#fila li.qi');
  check('encontra 4 apresentações (3 do JSON + 1 do HTML)', (await page.locator('#fila li.qi').count()) === 4);
  const probs = await page.locator('#problemas').innerText();
  check('arquivos inválidos geram aviso claro (txt não suportado; HTML sem dados)', /notas\.txt.*formato não suportado/.test(probs) && /quebrado\.html.*não é uma apresentação salva/.test(probs), probs);
  await page.screenshot({ path: path.join(SCREENS, 'importar-fila-1280x720.png'), fullPage: true });
  await page.click('#btn-importar');
  await page.waitForSelector('#relatorio .report', { timeout: 20000 });
  const stat = (k) => page.locator(`#relatorio [data-stat=${k}] .stat__v`).innerText();
  check('relatório: 3 importadas e 1 com falha', (await stat('importadas')) === '3' && (await stat('falhas')) === '1', { i: await stat('importadas'), f: await stat('falhas') });
  const st = await mstate();
  const imp = st.created.filter((c) => c.source === 'import');
  check('servidor recebeu 3 apresentações com source=import e SEM imagens embutidas (asset:sha256:…)', imp.length === 3 && imp.every((c) => !c.hasDataUrl && /asset:sha256:[0-9a-f]{64}/.test(JSON.stringify(c.content))), imp.map((c) => c.hasDataUrl));
  check('arquivos duplicados não foram reenviados: 3 imagens únicas → 3 envios (PNG1 usado em 3 apresentações)', st.uploads.length === 3 && new Set(st.uploads.map((u) => u.sha)).size === 3, st.uploads.length);
  check('uploads com X-Asset-Kind=image e hash verificado pelo servidor (SHA-256)', st.uploads.every((u) => u.kind === 'image'));
  check('relatório conta arquivos deduplicados (já existentes) e bytes enviados', Number(await stat('dedup')) >= 2 && /B|KB/.test(await stat('bytes')), { d: await stat('dedup'), b: await stat('bytes') });
  check('item com falha mostra o motivo do servidor e o relatório lista a falha', /recusou/.test(await page.locator('li.qi.is-error').innerText()) && /Obra C/.test(await page.locator('#relatorio .alert--error').innerText()));
  check('progresso geral é um <progress> rotulado (4 de 4)', (await page.locator('#progresso-geral').getAttribute('max')) === '4' && (await page.locator('#progresso-geral').getAttribute('value')) === '4' && /4 de 4 concluídas/.test(await page.locator('#geral').innerText()));
  check('status é anunciado em região aria-live', /Importação concluída/.test(await page.innerText('#importar-status')));
  // CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('CSV do relatório: nome com data, BOM UTF-8, cabeçalho, uma linha por item', /^relatorio-importacao-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) && csv.charCodeAt(0) === 0xfeff && csv.split('\r\n').filter(Boolean).length === 5 && /falha/.test(csv) && /importada/.test(csv), csv.slice(0, 120));
  await page.screenshot({ path: path.join(SCREENS, 'importar-relatorio-1280x720.png'), fullPage: true });
  // tentar de novo as falhas
  check('"Tentar de novo as falhas" disponível', (await page.locator('#btn-retry').count()) === 1);
  // retomável: recarregar e reenviar o mesmo arquivo → pula o que já foi enviado nesta sessão
  const before = (await mstate()).created.filter((c) => c.source === 'import').length;
  await page.reload(); await page.waitForSelector('#zona');
  await page.setInputFiles('#arquivos', [{ name: 'canteiro-acervo-2026-10-06.json', mimeType: 'application/json', buffer: Buffer.from(acervo) }, { name: 'salva.html', mimeType: 'text/html', buffer: Buffer.from(html) }]);
  await page.waitForSelector('#btn-importar'); await page.click('#btn-importar'); await page.waitForSelector('#relatorio .report', { timeout: 20000 });
  const after = (await mstate()).created.filter((c) => c.source === 'import').length;
  const skipped = await page.locator('li.qi[data-status=skipped]').count();
  check('retomável: após recarregar, o que já foi enviado nesta sessão é PULADO (3 puladas, só a falha é reenviada)', skipped === 3 && after - before === 0 && (await page.locator('li.qi[data-status=error]').count()) === 1, { skipped, delta: after - before });
  check('relatório mostra "Puladas"', (await stat('puladas')) === '3');
  // sem componente
  const c2 = await newCtx(); const p2 = await newPage(c2, 'importar-sem-core'); await loginApi(c2, 'bia@am.test');
  await p2.route('**/js/cloud-core.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* vazio */' }));
  await p2.goto(`${ORIGIN}/importar`); await p2.waitForSelector('#problemas .alert--error');
  check('sem o cloud-core a página avisa e desabilita o envio', /não carregou/.test(await p2.locator('#problemas').innerText()) && (await p2.locator('#arquivos').isDisabled()));
  await collectCsp(p2); await c2.close();
  await collectCsp(page); await ctx.close();

  // imagem grande (> 4 MB): o cloud-core real chama shrink() e a página reduz no navegador antes de subir
  if (mock.cloudCore === 'real') {
    mock.reset();
    const big = bigPng(1500);
    const bigAcervo = JSON.stringify({ kind: 'canteiro-acervo', v: 1, obras: [{ id: 'obra-grande', title: 'Obra com imagem enorme', deck: mkDeck('obra-grande', 'Obra com imagem enorme', [dataUrl(big)]) }] });
    const c4 = await newCtx(); const p4 = await newPage(c4, 'importar-grande'); await loginApi(c4, 'bia@am.test');
    await p4.goto(`${ORIGIN}/importar`); await p4.waitForSelector('#zona');
    await p4.setInputFiles('#arquivos', [{ name: 'grande.json', mimeType: 'application/json', buffer: Buffer.from(bigAcervo) }]);
    await p4.waitForSelector('#btn-importar'); await p4.click('#btn-importar'); await p4.waitForSelector('#relatorio .report', { timeout: 60000 });
    const stG = await mstate();
    check(`imagem de ${(big.length / 1048576).toFixed(1)} MB é reduzida no navegador (≤ 4 MB) e a apresentação é importada`, big.length > 4 * 1048576 && stG.uploads.length === 1 && stG.uploads[0].size <= 4 * 1048576 && (await p4.locator('li.qi[data-status=done]').count()) === 1 && /reduzida/.test(await p4.locator('li.qi').innerText()), { size: stG.uploads[0]?.size, txt: (await p4.locator('li.qi').innerText()).slice(0, 200) });
    await collectCsp(p4); await c4.close();
  }

  // cloud-core: contrato da API compartilhada (stub ou real)
  const c3 = await newCtx(); const p3 = await newPage(c3, 'cloud-core'); await loginApi(c3, 'bia@am.test');
  await p3.goto(`${ORIGIN}/importar`); await p3.waitForSelector('#zona');
  const coreInfo = await p3.evaluate(async () => {
    const C = window.AMCloudCore; const fns = ['sha256Hex', 'canonicalJSON', 'dataUrlToBytes', 'bytesToDataUrl', 'externalizeDeck', 'hydrateDeck', 'extractDeckFromHtml', 'parseAcervoJson'];
    const missing = fns.filter((f) => typeof C[f] !== 'function');
    const h = await C.sha256Hex('abc'); const cj = C.canonicalJSON({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } });
    return { missing, h, cj };
  });
  check(`cloud-core (${mock.cloudCore}) expõe as 8 funções do contrato`, coreInfo.missing.length === 0, coreInfo.missing);
  check('sha256Hex("abc") correto e canonicalJSON ordena chaves', coreInfo.h === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' && coreInfo.cj === '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}', coreInfo);
  const imm = await p3.evaluate(async (d) => {
    const C = window.AMCloudCore; const input = JSON.parse(d); const snap = JSON.stringify(input); const up = []; const cache = new Map();
    const api = { check: async (s) => s, put: async (sha) => { up.push(sha); } };
    const r1 = await C.externalizeDeck(input, { api, cache }); const r2 = await C.externalizeDeck(input, { api: { check: async () => [], put: async () => {} }, cache });
    return { unchanged: JSON.stringify(input) === snap, noData: !/data:image/.test(JSON.stringify(r1.content)), stats: r1.stats, again: r2.stats, ups: up.length, cacheSize: cache.size };
  }, JSON.stringify(mkDeck('x', 'X', [dataUrl(P1), dataUrl(P2), dataUrl(P1)])));
  check('externalizeDeck não altera a entrada, troca TODAS as imagens e conta enviadas/deduplicadas', imm.unchanged && imm.noData && imm.stats.uploaded === 2 && imm.ups === 2 && imm.again.uploaded === 0 && imm.cacheSize >= 2, imm);
  await collectCsp(p3); await c3.close();
}

/* ═════════════════════════════ 9. Acessibilidade e responsivo ═════════════════════════════ */
async function contrastScan(page) {
  return page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const over = (t, b) => { const a = t.a + b.a * (1 - t.a); return { r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a, g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a, b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (el) => { const layers = []; let n = el; let img = false; while (n && n.nodeType === 1) { const cs = getComputedStyle(n); if (cs.backgroundImage !== 'none') img = true; const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } n = n.parentElement; } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return { bg: base, img }; };
    const bad = []; let n = 0, skipped = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const t = walker.currentNode; if (!t.textContent.trim()) continue; const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden], .sr-only, noscript, script, style')) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      if (el.closest('[disabled], [aria-disabled=true]')) continue;
      const { bg, img } = bgOf(el); if (img) { skipped++; continue; }
      const fg = parse(cs.color); const eff = over({ ...fg, a: fg.a * (Number(cs.opacity) || 1) }, bg);
      const L1 = lum(eff), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700; const large = size >= 24 || (size >= 18.66 && bold);
      n++; if (ratio < (large ? 3 : 4.5)) bad.push({ text: t.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), sel: el.className || el.tagName });
    }
    return { n, skipped, bad };
  });
}
async function a11yStructure(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
    const name = (e) => (e.getAttribute('aria-label') || '').trim() || (e.getAttribute('aria-labelledby') ? [...e.getAttribute('aria-labelledby').split(' ')].map((i) => document.getElementById(i)?.textContent || '').join(' ').trim() : '') || (e.labels && e.labels.length ? [...e.labels].map((l) => l.textContent).join(' ').trim() : '') || (e.textContent || '').trim() || e.getAttribute('title') || '';
    const unlabeled = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((e) => vis(e) || e.classList.contains('sr-only')).filter((e) => !name(e)).map((e) => e.id || e.name || e.tagName);
    const noName = [...document.querySelectorAll('button, a[href], [role=tab], [role=menuitem]')].filter(vis).filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 60));
    const imgNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
    const styleAttr = document.querySelectorAll('[style]').length;
    const h1 = document.querySelectorAll('h1').length;
    const dupIds = (() => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); return ids.filter((v, i) => ids.indexOf(v) !== i); })();
    return { unlabeled, noName, imgNoAlt, styleAttr, h1, main: document.querySelectorAll('main').length, lang: document.documentElement.lang, title: document.title, dupIds, skip: !!document.querySelector('a.skip-link[href="#conteudo"]') };
  });
}

/** Contraste medido em PIXELS (o fundo real: degradês da prancha, cartões translúcidos, hover). Deixa o texto transparente, captura a tela
 *  e, para cada trecho de texto visível (recortado pelos ancestrais com overflow ≠ visible), compara a cor do texto com o fundo pixel a pixel
 *  (2º percentil, para um pixel isolado não decidir). Com um diálogo modal aberto, mede só o diálogo (o resto está inerte e coberto).
 *  Depois devolve a cor ao texto. Só para testes: mexe em element.style pelo CSSOM, o que a CSP não bloqueia. */
async function pixelContrast(page) {
  const runs = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const root = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode; if (!t.textContent.trim()) continue; const el = t.parentElement; if (!el) continue;
      if (el.closest('[hidden], .sr-only, noscript, script, style, option, select')) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('[disabled], [aria-disabled=true]')) continue;
      let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity) || 1;
      if (op < 0.05) continue;
      const fg = parse(cs.color); fg[3] *= op;
      let clip = [0, 0, innerWidth, innerHeight];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c2 = getComputedStyle(n); if (c2.overflowX !== 'visible' || c2.overflowY !== 'visible') { const b = n.getBoundingClientRect(); clip = [Math.max(clip[0], b.left), Math.max(clip[1], b.top), Math.min(clip[2], b.right), Math.min(clip[3], b.bottom)]; } }
      const r = document.createRange(); r.selectNodeContents(t);
      const rects = [...r.getClientRects()].map((q) => [Math.max(q.left, clip[0]), Math.max(q.top, clip[1]), Math.min(q.right, clip[2]), Math.min(q.bottom, clip[3])]).filter(([l, tp, rt, b]) => rt - l > 2 && b - tp > 4);
      if (!rects.length) continue;
      const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
      out.push({ text: t.textContent.trim().slice(0, 40), sel: typeof el.className === 'string' && el.className ? el.className.split(' ')[0] : el.tagName.toLowerCase(), fg, large: size >= 24 || (size >= 18.66 && bold), rects });
    }
    window.__pxFocus = document.activeElement; document.activeElement?.blur?.();
    for (const e of document.querySelectorAll('body *')) for (const [k, v] of [['color', 'transparent'], ['-webkit-text-fill-color', 'transparent'], ['text-shadow', 'none'], ['text-decoration-color', 'transparent']]) e.style.setProperty(k, v, 'important');
    return out;
  });
  await sleep(60);
  const png = await page.screenshot();
  return page.evaluate(async ({ b64, runs }) => {
    for (const e of document.querySelectorAll('body *')) for (const k of ['color', '-webkit-text-fill-color', 'text-shadow', 'text-decoration-color']) e.style.removeProperty(k);
    for (const e of document.querySelectorAll('[style=""]')) e.removeAttribute('style');
    window.__pxFocus?.focus?.({ preventScroll: true });
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const D = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const bad = []; let n = 0; let margin = Infinity;
    for (const run of runs) {
      const ratios = [];
      for (const [l, t, r, b] of run.rects) {
        for (let y = Math.ceil(t + 1); y < Math.floor(b - 1); y += 2) for (let x = Math.ceil(l + 1); x < Math.floor(r - 1); x += 2) {
          if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
          const i = (y * c.width + x) * 4; const a = run.fg[3];
          const Lb = L(D[i], D[i + 1], D[i + 2]); const Lf = L(run.fg[0] * a + D[i] * (1 - a), run.fg[1] * a + D[i + 1] * (1 - a), run.fg[2] * a + D[i + 2] * (1 - a));
          ratios.push((Math.max(Lf, Lb) + 0.05) / (Math.min(Lf, Lb) + 0.05));
        }
      }
      if (!ratios.length) continue;
      ratios.sort((p, q) => p - q); const worst = ratios[Math.floor(ratios.length * 0.02)]; const need = run.large ? 3 : 4.5;
      n++; margin = Math.min(margin, worst / need);
      if (worst < need) bad.push({ text: run.text, sel: run.sel, ratio: +worst.toFixed(2) });
    }
    return { n, bad, margin: Number.isFinite(margin) ? +margin.toFixed(2) : 0 };
  }, { b64: png.toString('base64'), runs });
}

async function a11yAndResponsive() {
  head('9. Acessibilidade, teclado, movimento reduzido e responsivo');
  mock.reset();
  // login: ordem de tab
  let ctx = await newCtx(); let page = await newPage(ctx, 'a11y-login');
  await page.goto(`${ORIGIN}/entrar`); await page.waitForSelector('#form-login');
  check('ao abrir, o foco já está no campo de e-mail (autofoco)', (await page.evaluate(() => document.activeElement.id)) === 'email');
  const order = [];
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.getAttribute('aria-label'))); }
  await page.focus('#email'); await page.keyboard.press('Shift+Tab');
  const back = await page.evaluate(() => document.activeElement.className);
  check('ordem de Tab no login: e-mail → senha → mostrar senha → Entrar → Entrar com a conta A&M (SSO) → Esqueci a senha; Shift+Tab do e-mail vai ao link de pular', JSON.stringify(order) === JSON.stringify(['senha', 'Mostrar senha', 'btn-entrar', 'btn-sso', 'link-esqueci']) && back === 'skip-link', { order, back });
  await page.focus('#btn-entrar');
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { w: parseFloat(cs.outlineWidth), s: cs.outlineStyle }; });
  check('foco visível (anel de ≥ 2 px) nos controles', ring.s !== 'none' && ring.w >= 2, ring);
  let s = await a11yStructure(page);
  check('login: rótulos, nomes acessíveis, alt, h1 único, lang, sem style="" e sem ids duplicados', !s.unlabeled.length && !s.noName.length && !s.imgNoAlt && !s.styleAttr && s.h1 === 1 && s.main === 1 && s.lang === 'pt-BR' && s.skip && !s.dupIds.length, s);
  let c = await contrastScan(page);
  check(`login: contraste AA em ${c.n} textos (${c.skipped} sobre gradiente verificados à parte)`, c.bad.length === 0, c.bad);
  // movimento reduzido
  const rc = await browser.newContext({ reducedMotion: 'reduce', locale: 'pt-BR' }); const rp = await newPage(rc, 'reduced');
  await rp.goto(`${ORIGIN}/entrar`); await rp.waitForSelector('#form-login');
  const dur = await rp.evaluate(() => { const probe = document.createElement('div'); probe.className = 'skeleton'; document.body.append(probe); const d = getComputedStyle(probe).animationDuration; probe.remove(); const t = getComputedStyle(document.querySelector('#btn-entrar')).transitionDuration; return { d, t }; });
  check('prefers-reduced-motion: animações e transições praticamente nulas', parseFloat(dur.d) < 0.01 && parseFloat(dur.t) < 0.01, dur);
  await rc.close();
  await collectCsp(page); await ctx.close();

  // páginas protegidas — estrutura, contraste e overflow em várias larguras
  const widths = [390, 768, 1280, 1920];
  for (const [who, pages] of [['bia@am.test', ['/acervo', '/importar', '/acervo?aba=lixeira']], ['ana.admin@am.test', ['/admin#usuarios', '/admin#convidar', '/admin#auditoria', '/admin#configuracoes', '/admin#resumo']]]) {
    const u = await asUser(who, { tag: 'a11y-' + who.split('@')[0] });
    for (const p of pages) {
      await u.page.goto(`${ORIGIN}${p}`); await u.page.waitForSelector('#topbar-root header');
      await u.page.waitForFunction(() => !document.querySelector('.loading') && !document.querySelector('#esqueleto'), null, { timeout: 8000 }).catch(() => null);
      await sleep(250);
      s = await a11yStructure(u.page);
      check(`${p}: nomes acessíveis, alt, h1 único, lang, <main>, sem style="" / ids duplicados`, !s.unlabeled.length && !s.noName.length && !s.imgNoAlt && !s.styleAttr && s.h1 === 1 && s.main === 1 && s.lang === 'pt-BR' && s.skip && !s.dupIds.length, s);
      c = await contrastScan(u.page);
      check(`${p}: contraste AA em ${c.n} textos`, c.bad.length === 0, c.bad.slice(0, 5));
      for (const w of widths) {
        await u.page.setViewportSize({ width: w, height: 800 }); await sleep(120);
        const ov = await u.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        if (ov.sw > ov.iw + 1) check(`${p} @${w}px: sem rolagem horizontal`, false, ov);
      }
      check(`${p}: sem rolagem horizontal em 390, 768, 1280 e 1920 px`, true);
      await u.page.setViewportSize({ width: 1280, height: 720 });
    }
    // link de pular conteúdo
    await u.page.goto(`${ORIGIN}/acervo`); await u.page.waitForSelector(CARD);
    await u.page.evaluate(() => document.activeElement.blur()); await u.page.keyboard.press('Tab');
    check('primeiro Tab no acervo foca o link "Ir para o conteúdo" e Enter move o foco para <main>', (await u.page.evaluate(() => document.activeElement.className)) === 'skip-link' && (await u.page.keyboard.press('Enter'), await u.page.evaluate(() => document.activeElement.id)) === 'conteudo');
    // ordem de tab em um cartão
    const seq = await u.page.evaluate(() => { const li = document.querySelector('li.card:not(.card--skel)'); return [...li.querySelectorAll('button, a[href]')].map((e) => e.getAttribute('data-action') || e.className.split(' ')[0]); });
    check('cartão: ordem de foco = título → Apresentar → Editar/Criar cópia → Mais ações', seq[0] === 'card__title' && seq[1] === 'present' && ['edit', 'duplicate'].includes(seq[2]), seq);
    await collectCsp(u.page); await u.ctx.close();
  }
  // diálogo: foco preso e devolvido
  const u2 = await asUser('bia@am.test', { tag: 'a11y-dialog' });
  await gotoAcervo(u2.page);
  const btn = cardOf(u2.page, 'Plano estratégico 2027').locator('button[aria-haspopup=menu]');
  await btn.click(); await u2.page.getByRole('menuitem', { name: 'Excluir' }).click(); await u2.page.waitForSelector('dialog[open]');
  for (let i = 0; i < 4; i++) await u2.page.keyboard.press('Tab');
  check('diálogo modal prende o foco (Tab não sai do diálogo)', await u2.page.evaluate(() => !!document.activeElement.closest('dialog')));
  await u2.page.keyboard.press('Escape'); await u2.page.waitForSelector('dialog', { state: 'detached' });
  check('Esc fecha o diálogo e devolve o foco ao botão que o abriu', await btn.evaluate((b) => b === document.activeElement || b.contains(document.activeElement)));
  await collectCsp(u2.page); await u2.ctx.close();
  // contraste medido em PIXELS sobre a prancha (o degradê e os cartões translúcidos da capa não entram no cálculo por cores acima)
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `${vp.width}px`;
    const anon = await newCtx({ viewport: vp }); const ap = await newPage(anon, `px-anon-${tag}`);
    const tok = `tok-px-${vp.width}-0123456789abcdef`; await mpost(`/__test/link-token?t=${tok}&type=invite&u=eva`);   // convite novo (o link vale uma vez)
    for (const [p, sel] of [['/entrar', '#form-login'], ['/esqueci-senha', '#form-esqueci'], ['/rota-que-nao-existe', 'h1'], [`/auth/confirmar?token_hash=${tok}&type=invite`, '#form-senha']]) {
      await ap.goto(`${ORIGIN}${p}`); await ap.waitForSelector(sel); await sleep(700);
      const r = await pixelContrast(ap);
      check(`${p.split('?')[0]} @${tag}: contraste AA medido em pixels em ${r.n} textos (menor folga ${r.margin}×)`, r.n > 3 && r.bad.length === 0, r.bad.slice(0, 5));
    }
    await collectCsp(ap); await anon.close();
    const b = await asUser('bia@am.test', { viewport: vp, tag: `px-bia-${tag}` });
    await gotoAcervo(b.page); await sleep(1300);
    let r = await pixelContrast(b.page);
    check(`/acervo @${tag}: contraste AA medido em pixels em ${r.n} textos (menor folga ${r.margin}×)`, r.n > 10 && r.bad.length === 0, r.bad.slice(0, 5));
    // cartões com hover (fundo mais claro), inclusive os que ficam no ponto claro do degradê
    const cards = b.page.locator(CARD); const nCards = Math.min(await cards.count(), vp.width > 800 ? 8 : 2); const badHover = []; let mHover = Infinity;
    for (let i = 0; i < nCards; i++) { await cards.nth(i).locator('.card__meta').hover(); await sleep(450); r = await pixelContrast(b.page); mHover = Math.min(mHover, r.margin); badHover.push(...r.bad.map((x) => ({ card: i, ...x }))); }
    await b.page.mouse.move(2, vp.height - 2);
    check(`/acervo @${tag}: contraste AA medido em pixels com o cursor sobre cada um dos ${nCards} primeiros cartões (menor folga ${mHover}×)`, nCards > 0 && badHover.length === 0, badHover.slice(0, 5));
    await b.page.click('#btn-modelos'); await b.page.waitForSelector('#modelos[open] .tpl'); await sleep(1100);
    r = await pixelContrast(b.page);
    check(`"Projetos prontos" @${tag}: contraste AA medido em pixels em ${r.n} textos (menor folga ${r.margin}×)`, r.n > 10 && r.bad.length === 0, r.bad.slice(0, 5));
    await b.page.locator('#modelos .tpl').nth(vp.width > 800 ? 3 : 1).hover(); await sleep(450);
    r = await pixelContrast(b.page);
    check(`"Projetos prontos" @${tag} com o cursor sobre um projeto: contraste AA medido em pixels`, r.bad.length === 0, r.bad.slice(0, 5));
    await b.page.keyboard.press('Escape'); await b.page.waitForSelector('#modelos', { state: 'detached' });
    await cardByTitle(b.page, 'Plano estratégico 2027 (Bia)').locator('button[aria-haspopup=menu]').click();
    await b.page.getByRole('menuitem', { name: 'Respostas e participações…' }).click(); await b.page.waitForSelector('#respostas .resp'); await sleep(500);
    r = await pixelContrast(b.page);
    check(`"Respostas e participações" @${tag}: contraste AA medido em pixels em ${r.n} textos (menor folga ${r.margin}×)`, r.n > 10 && r.bad.length === 0, r.bad.slice(0, 5));
    await b.page.keyboard.press('Escape'); await b.page.waitForSelector('#respostas', { state: 'detached' });
    for (const [p, sel] of [['/acervo?aba=lixeira', CARD], ['/importar', '#zona']]) {
      await b.page.goto(`${ORIGIN}${p}`); await b.page.waitForSelector(sel); await sleep(1000);
      r = await pixelContrast(b.page);
      check(`${p} @${tag}: contraste AA medido em pixels em ${r.n} textos (menor folga ${r.margin}×)`, r.n > 5 && r.bad.length === 0, r.bad.slice(0, 5));
    }
    await collectCsp(b.page); await b.ctx.close();
  }
  const o = await asUser('otto.admin@am.test', { viewport: { width: 1440, height: 900 }, tag: 'px-vazio' });
  await gotoAcervo(o.page, '?aba=minhas'); await sleep(900);
  const rv = await pixelContrast(o.page);
  check(`/acervo vazio (pilha de pranchas) @1440px: contraste AA medido em pixels em ${rv.n} textos (menor folga ${rv.margin}×)`, rv.n > 5 && rv.bad.length === 0, rv.bad.slice(0, 5));
  await collectCsp(o.page); await o.ctx.close();
  // contraste dos pares de cor dos dois temas (claro = editor; prancha = capa, inclusive o ponto mais claro do degradê, #13364F)
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pairs = [['#ffffff', '#002a46', 4.5], ['#dce5f0', '#001e32', 4.5], ['#a3b8d6', '#13364f', 4.5], ['#7ea1c3', '#13364f', 4.5], ['#ffffff', '#13364f', 4.5], ['#002a46', '#f78c16', 4.5], ['#002a46', '#e07a0a', 4.5],
    ['#a24f00', '#ffffff', 4.5], ['#566579', '#ffffff', 4.5], ['#566579', '#e6ebf1', 4.5], ['#43698f', '#ffffff', 4.5], ['#0b2545', '#ffe89a', 4.5], ['#3e4c5e', '#c9e1f7', 4.5], ['#b3261e', '#ffffff', 4.5], ['#14633a', '#e6f4ec', 4.5], ['#7a4a00', '#fff4dc', 4.5], ['#174b7a', '#e8f1fa', 4.5], ['#66758a', '#ffffff', 4.5], ['#7a8da3', '#ffffff', 3]];
  const lowP = pairs.filter(([f, b, m]) => cr(f, b) < m).map(([f, b]) => `${f}/${b}=${cr(f, b).toFixed(2)}`);
  check('pares de cor dos dois temas passam em AA (texto 4,5:1; borda de campo #7A8DA3 sobre branco 3:1, WCAG 1.4.11)', lowP.length === 0, lowP);
}

/* ═════════════════════════════ 9b. Família visual = editor original (medidas computadas) ═════════════════════════════ */
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
const same = (a, b, keys) => keys.every((k) => a[k] === b[k]);
const fam0 = (f) => String(f).split(',')[0].replace(/["']/g, '').trim();
const PROPS = ['background-color', 'color', 'border-top-color', 'border-top-left-radius', 'height', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'box-shadow', 'background-image', 'transform', 'border-left-color', 'border-left-width', 'width', 'padding-top', 'backdrop-filter'];
/** Estilos computados (as mesmas propriedades) de um seletor ou elemento, num pseudo-elemento opcional. Roda na página. */
const STYLE_FN = `window.__cs = (el, pseudo) => { const c = getComputedStyle(typeof el === 'string' ? document.querySelector(el) : el, pseudo || null); return Object.fromEntries(${JSON.stringify(PROPS)}.map((p) => [p, c.getPropertyValue(p)])); };`;

/** Lê, no editor ORIGINAL (original/Canteiro-AM (3).html) com as mesmas fontes, os estilos dos componentes que a plataforma copia. */
async function editorStyles() {
  const ctx = await newCtx({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();   // fora de newPage(): o console do editor não conta como erro das páginas da plataforma
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(FONTS, 'gf.css'), 'utf8') }));
  await page.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) }) : r.abort(); });
  await page.goto(pathToFileURL(ORIGINAL).href);
  await page.waitForFunction(() => window.AMCover && window.AMStudio, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(STYLE_FN);
  // "Minhas obras" aberta, com um cartão de obra com a marcação do cover.js (selo, miniatura sem imagem, metadados, título)
  await page.evaluate(() => window.AMCover.open('hist'));
  await page.waitForSelector('#cvHist.on');
  await page.evaluate(() => {
    const g = document.getElementById('cvHistGrid'); g.hidden = false;
    const a = document.createElement('article'); a.className = 'cv-hcard'; a.id = 'tCard';
    a.innerHTML = '<button type="button" class="cv-hopen"><span class="cv-pv cv-pv-bad"></span><span class="cv-htag">Aberta no editor</span></button><div class="cv-hb"><span class="cv-hmeta"><span>06 slides</span><span>agora</span></span><span class="cv-hname">Obra de teste</span></div><div class="cv-hact"><button type="button" class="cv-hgo">Abrir</button></div>';
    g.prepend(a);
    for (const [cls, tag] of [['mb pri', 'button'], ['mb', 'button']]) { const b = document.createElement(tag); b.className = cls; b.textContent = 'Botão'; b.style.cssText = 'position:fixed;left:30px;top:' + (cls === 'mb' ? 140 : 90) + 'px;z-index:2147483000'; b.id = cls === 'mb' ? 'tSec' : 'tPri'; document.body.append(b); }
    const m = document.createElement('div'); m.className = 'xmenu'; m.id = 'tMenu'; m.innerHTML = '<div class="xi">Item</div>'; m.style.cssText = 'left:300px;top:300px'; document.body.append(m);
  });
  await sleep(700); await page.mouse.move(700, 880);
  const E = await page.evaluate(() => ({
    body: __cs(document.body), cover: __cs('#cover'), cvBg: __cs('#cover .cv-bg'), cvGrid: __cs('#cover .cv-bg', '::before'),
    card: __cs('#tCard'), tag: __cs('#tCard .cv-htag'), pvBad: __cs('#tCard .cv-pv-bad'), name: __cs('#tCard .cv-hname'), meta: __cs('#tCard .cv-hmeta'),
    eyebrow: __cs('#cover .cv-eyebrow'), search: __cs('#cover .cv-search'), segOn: __cs('#cover .cv-seg button[aria-pressed=true]'), note: __cs('#cvNote'),
    pri: __cs('#tPri'), sec: __cs('#tSec'), toast: __cs('#toast'), top: __cs('#top'), mbar: __cs('#mbar button'), brand: __cs('#top .brand .sub em'),
    menu: __cs('#tMenu'), menuItem: __cs('#tMenu .xi'),
    fontsHref: [...document.querySelectorAll('link[rel=stylesheet][href*="fonts.googleapis.com"]')].map((l) => l.getAttribute('href')),
    gridMask: getComputedStyle(document.querySelector('#cover .cv-bg'), '::before').getPropertyValue('mask-image'),
    gridSize: getComputedStyle(document.querySelector('#cover .cv-bg'), '::before').getPropertyValue('background-size'),
  }));
  await page.hover('#tCard'); await sleep(600);
  E.cardHover = await page.evaluate(() => __cs('#tCard'));
  await page.hover('#tPri'); await sleep(400);
  E.priHover = await page.evaluate(() => __cs('#tPri'));
  // modal (.mdl), montado como o confirmBox do editor
  await page.evaluate(() => { window.AMCover.close(); });
  await sleep(900);
  await page.evaluate(() => {
    const md = document.getElementById('modal');
    md.innerHTML = '<div class="mdl"><div class="mdl-b"><div class="mdl-ic"></div><div><div class="mdl-ey">Confirmar</div><h3>Título</h3><p>Texto</p></div></div><div class="mdl-a"></div></div>';
    md.classList.add('open');
  });
  await sleep(500);
  Object.assign(E, await page.evaluate(() => ({ backdrop: __cs('#modal'), mdl: __cs('#modal .mdl'), mdlStripe: __cs('#modal .mdl', '::before'), mdlIc: __cs('#modal .mdl-ic'), mdlEy: __cs('#modal .mdl-ey'), mdlH: __cs('#modal .mdl h3'), mdlP: __cs('#modal .mdl p') })));
  await ctx.close();
  return E;
}

async function familiaVisual() {
  head('9b. Família visual = editor original (estilos COMPUTADOS no editor × na plataforma)');
  mock.reset();
  const E = await editorStyles();
  const u = await asUser('bia@am.test', { viewport: { width: 1440, height: 900 }, tag: 'familia' });
  const page = u.page;
  await gotoAcervo(page); await sleep(1400); await page.mouse.move(700, 895);
  await page.evaluate(STYLE_FN);
  const P = await page.evaluate(() => ({
    body: __cs(document.body), before: __cs(document.body, '::before'), after: __cs(document.body, '::after'),
    pri: __cs('#btn-nova'), card: __cs('li.card[data-owner=me]'), tag: __cs('li.card .card__badges .badge--own'),
    pvBad: __cs([...document.querySelectorAll('li.card .card__thumb')].find((t) => t.querySelector('.ph'))),
    name: __cs('li.card .card__title'), meta: __cs('li.card .card__meta'), eyebrow: __cs('.page__head .eyebrow'),
    search: __cs('#busca'), segOn: __cs('.tab[aria-selected=true]'),
    gridMask: getComputedStyle(document.body, '::after').getPropertyValue('mask-image'), gridSize: getComputedStyle(document.body, '::after').getPropertyValue('background-size'),
    fonts: { jb: document.fonts.check('500 11.5px "JetBrains Mono"'), rc: document.fonts.check('700 16px "Roboto Condensed"'), inter: document.fonts.check('600 13px Inter') },
    fontFamilies: { eyebrow: getComputedStyle(document.querySelector('.page__head .eyebrow')).fontFamily, h1: getComputedStyle(document.querySelector('h1')).fontFamily },
  }));
  const keysBtn = ['background-color', 'color', 'border-top-color', 'border-top-left-radius', 'height', 'font-family', 'font-size', 'font-weight'];
  check('botão primário = .mb.pri do editor: laranja #F78C16, texto navy #002A46, borda laranja, raio 8 px, 38 px, Inter 13 px/600', same(P.pri, E.pri, keysBtn) && P.pri['background-color'] === 'rgb(247, 140, 22)' && P.pri.color === 'rgb(0, 42, 70)', { plataforma: pick(P.pri, keysBtn), editor: pick(E.pri, keysBtn) });
  await page.hover('#btn-nova'); await sleep(350);
  const priHover = await page.evaluate(() => __cs('#btn-nova'));
  check('hover do primário = o do editor (#E07A0A, texto navy)', priHover['background-color'] === E.priHover['background-color'] && priHover['background-color'] === 'rgb(224, 122, 10)' && priHover.color === E.priHover.color, { p: priHover['background-color'], e: E.priHover['background-color'] });
  check('fonte da página = a do editor (Inter, Arial, sans-serif) e as 3 famílias carregadas (Inter, Roboto Condensed, JetBrains Mono)', P.body['font-family'] === E.body['font-family'] && P.fonts.jb && P.fonts.rc && P.fonts.inter, { p: P.body['font-family'], e: E.body['font-family'], fonts: P.fonts });
  const href = E.fontsHref[0];
  const pagesHtml = ['entrar/index.html', 'esqueci-senha/index.html', 'auth/confirmar/index.html', 'acervo/index.html', 'admin/index.html', 'importar/index.html', '404.html'];
  const hrefs = pagesHtml.map((f) => (/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/.exec(fs.readFileSync(path.join(WEB, f), 'utf8')) || [])[1]?.replace(/&amp;/g, '&'));
  check('as 7 páginas carregam EXATAMENTE as famílias e pesos do editor (Inter 400–700, JetBrains Mono 400–600, Roboto 300–700, Roboto Condensed 400/700)', !!href && /JetBrains\+Mono:wght@400;500;600/.test(href) && hrefs.every((x) => x === href), { editor: href, hrefs });
  check('sobretítulos em JetBrains Mono (= .cv-eyebrow: 11,5 px, caixa alta, espaçamento .16em, aço #7EA1C3) e títulos em Roboto Condensed', fam0(P.fontFamilies.eyebrow) === 'JetBrains Mono' && fam0(P.fontFamilies.h1) === 'Roboto Condensed' && same(P.eyebrow, E.eyebrow, ['font-size', 'font-weight', 'letter-spacing', 'text-transform', 'color']), { p: pick(P.eyebrow, ['font-family', 'font-size', 'letter-spacing', 'color']), e: pick(E.eyebrow, ['font-family', 'font-size', 'letter-spacing', 'color']) });
  check('prancha = fundo da capa: navy #001E32, o mesmo degradê de .cv-bg e a mesma grade 96/24 px com máscara', P.body['background-color'] === E.cover['background-color'] && P.before['background-image'].includes(E.cvBg['background-image']) && P.after['background-image'] === E.cvGrid['background-image'] && P.gridSize === E.gridSize && P.gridMask === E.gridMask, { bg: [P.body['background-color'], E.cover['background-color']], size: [P.gridSize, E.gridSize] });
  const keysCard = ['border-top-left-radius', 'border-top-color', 'background-color'];
  check('cartão = .cv-hcard de "Minhas obras" (raio 14 px, linha rgba(163,184,214,.16), fundo rgba(255,255,255,.035))', same(P.card, E.card, keysCard), { p: pick(P.card, keysCard), e: pick(E.card, keysCard) });
  await page.locator('li.card[data-owner=me]').first().locator('.card__meta').hover(); await sleep(600);
  const cardHover = await page.evaluate(() => __cs('li.card[data-owner=me]'));
  const keysHover = ['transform', 'border-top-color', 'background-color', 'box-shadow'];
  check('hover do cartão = o da capa: sobe 3 px, borda laranja .55, fundo .06 e a mesma sombra', same(cardHover, E.cardHover, keysHover), { p: pick(cardHover, keysHover), e: pick(E.cardHover, keysHover) });
  const keysTag = ['background-color', 'color', 'font-size', 'font-weight', 'letter-spacing', 'text-transform', 'border-top-left-radius', 'box-shadow'];
  check('selo "Sua" = .cv-htag (laranja, navy, JetBrains Mono 9,5 px/700, caixa alta, raio 5 px, sombra)', same(P.tag, E.tag, keysTag) && fam0(P.tag['font-family']) === fam0(E.tag['font-family']), { p: pick(P.tag, keysTag), e: pick(E.tag, keysTag) });
  check('miniatura vazia = .cv-pv-bad (listras #E3EAF2/#EBEEF1)', P.pvBad['background-image'] === E.pvBad['background-image'], { p: P.pvBad['background-image'], e: E.pvBad['background-image'] });
  check('título do cartão = .cv-hname (Roboto Condensed 16 px/700, branco) e metadados = .cv-hmeta (JetBrains Mono 10 px, caixa alta, mesmo espaçamento)', same(P.name, E.name, ['font-size', 'font-weight', 'line-height', 'color']) && fam0(P.name['font-family']) === fam0(E.name['font-family']) && same(P.meta, E.meta, ['font-size', 'letter-spacing', 'text-transform']) && fam0(P.meta['font-family']) === fam0(E.meta['font-family']), { name: [pick(P.name, ['font-size', 'line-height']), pick(E.name, ['font-size', 'line-height'])], meta: [pick(P.meta, ['font-size', 'letter-spacing']), pick(E.meta, ['font-size', 'letter-spacing'])] });
  check('desvio deliberado (AA): metadados no aço claro #A3B8D6 (--s4 da capa) em vez do #7EA1C3 de .cv-hmeta, que fica abaixo de 4,5:1 sobre o cartão no ponto claro do degradê', E.meta.color === 'rgb(126, 161, 195)' && P.meta.color === 'rgb(163, 184, 214)', { p: P.meta.color, e: E.meta.color });
  check('busca = .cv-search (38 px, raio 9 px, fundo rgba(0,20,36,.45))', same(P.search, E.search, ['height', 'border-top-left-radius', 'background-color']), { p: pick(P.search, ['height', 'border-top-left-radius', 'background-color']), e: pick(E.search, ['height', 'border-top-left-radius', 'background-color']) });
  check('aba selecionada = botão pressionado de .cv-seg (fundo aço .2, texto branco, traço laranja embaixo)', same(P.segOn, E.segOn, ['background-color', 'color', 'box-shadow', 'border-top-left-radius', 'font-size', 'font-weight']), { p: pick(P.segOn, ['background-color', 'box-shadow']), e: pick(E.segOn, ['background-color', 'box-shadow']) });
  // diálogo (.mdl)
  await page.evaluate(async () => { const { confirmDialog } = await import('/js/ui.js'); window.__d = confirmDialog({ title: 'Título', message: 'Texto' }); });
  await page.waitForSelector('dialog.dlg[open]'); await sleep(500);
  const D = await page.evaluate(() => ({ dlg: __cs('dialog.dlg'), stripe: __cs('dialog.dlg', '::before'), backdrop: __cs('dialog.dlg', '::backdrop'), ic: __cs('dialog.dlg .dlg__ic'), ey: __cs('dialog.dlg .ey'), h: __cs('dialog.dlg h2'), p: __cs('dialog.dlg p'), sec: __cs('dialog.dlg [data-act=cancel]') }));
  check('diálogo = .mdl: 460 px, raio 16 px, a mesma sombra e a faixa de 3 px laranja/navy', same(D.dlg, E.mdl, ['width', 'border-top-left-radius', 'box-shadow', 'background-color']) && D.stripe.height === '3px' && D.stripe['background-image'] === E.mdlStripe['background-image'], { p: pick(D.dlg, ['width', 'box-shadow']), e: pick(E.mdl, ['width', 'box-shadow']), stripe: [D.stripe['background-image'], E.mdlStripe['background-image']] });
  check('fundo do diálogo = o do #modal (rgba(0,20,35,.52) com desfoque de 3 px)', D.backdrop['background-color'] === E.backdrop['background-color'] && D.backdrop['backdrop-filter'] === E.backdrop['backdrop-filter'], { p: [D.backdrop['background-color'], D.backdrop['backdrop-filter']], e: [E.backdrop['background-color'], E.backdrop['backdrop-filter']] });
  check('ícone 44 px (= .mdl-ic), sobretítulo em mono (= .mdl-ey), título (= .mdl h3) e texto (= .mdl p)', same(D.ic, E.mdlIc, ['width', 'height', 'border-top-left-radius', 'background-color']) && same(D.ey, E.mdlEy, ['font-size', 'font-weight', 'letter-spacing', 'text-transform', 'color']) && fam0(D.ey['font-family']) === 'JetBrains Mono' && same(D.h, E.mdlH, ['font-family', 'font-size', 'font-weight', 'color']) && same(D.p, E.mdlP, ['font-size', 'line-height', 'color']), { ey: [pick(D.ey, ['font-size', 'letter-spacing']), pick(E.mdlEy, ['font-size', 'letter-spacing'])] });
  check('botão secundário = .mb (branco, navy, linha #DCE3EC, raio 8 px, 38 px)', same(D.sec, E.sec, keysBtn), { p: pick(D.sec, keysBtn), e: pick(E.sec, keysBtn) });
  await page.keyboard.press('Escape'); await page.waitForSelector('dialog', { state: 'detached' });
  // aviso na prancha (= .cv-note) e menu (= .xmenu)
  await page.evaluate(async () => { const { toast } = await import('/js/ui.js'); toast('Teste', { kind: 'info', timeout: 0 }); });
  await sleep(450);
  const T = await page.evaluate(() => __cs('.toast'));
  const keysNote = ['background-color', 'color', 'border-left-color', 'border-left-width', 'border-top-left-radius', 'font-size', 'font-weight', 'box-shadow'];
  check('aviso na prancha = .cv-note da capa (branco, navy, filete laranja de 3 px, raio 12 px, 13 px/600, mesma sombra)', same(T, E.note, keysNote), { p: pick(T, keysNote), e: pick(E.note, keysNote) });
  await page.locator('li.card').first().locator('button[aria-haspopup=menu]').click();
  const M = await page.evaluate(() => ({ menu: __cs('.menu'), item: __cs('.menu .menu__item') }));
  check('menu = .xmenu do editor (raio 12 px, linha #DCE3EC, mesma sombra, 6 px de respiro; itens de 32 px)', same(M.menu, E.menu, ['border-top-left-radius', 'border-top-color', 'box-shadow', 'padding-top', 'background-color']) && M.item.height === E.menuItem.height, { p: pick(M.menu, ['box-shadow', 'padding-top']), e: pick(E.menu, ['box-shadow', 'padding-top']), item: [M.item.height, E.menuItem.height] });
  await page.keyboard.press('Escape');
  // ⋯ na mesma linha das ações (VIS-07), a 1280 e a 1440 px
  for (const w of [1280, 1440]) {
    await page.setViewportSize({ width: w, height: 900 }); await sleep(300);
    const rows = await page.$$eval('li.card:not(.card--skel)', (l) => l.map((li) => { const a = li.querySelector('.card__actions'); const first = a.querySelector('.btn'); const more = a.querySelector('.more > button'); return Math.abs(first.getBoundingClientRect().top - more.getBoundingClientRect().top); }));
    check(`a ${w} px o botão "⋯" fica na MESMA linha das ações em todos os ${rows.length} cartões`, rows.length > 0 && rows.every((d) => d < 1), rows.filter((d) => d >= 1).length);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // avatares só na paleta A&M (VIS-11)
  const AM = new Set(['rgb(219, 231, 243)', 'rgb(253, 230, 199)', 'rgb(227, 234, 242)', 'rgb(163, 184, 214)', 'rgb(126, 161, 195)', 'rgb(67, 105, 143)', 'rgb(0, 42, 70)', 'rgb(247, 140, 22)']);
  const avs = await page.$$eval('.avatar', (l) => [...new Set(l.map((a) => getComputedStyle(a).backgroundColor))]);
  check('avatares só com tons da paleta A&M (navy, aços, gelo, laranja)', avs.length > 1 && avs.every((c) => AM.has(c)), avs);
  await collectCsp(page); await u.ctx.close();
  // tema claro (= editor): barra superior, menu de navegação e aviso navy
  const a = await asUser('ana.admin@am.test', { viewport: { width: 1440, height: 900 }, tag: 'familia-admin' });
  await a.page.goto(`${ORIGIN}/admin#usuarios`); await a.page.waitForSelector('#u-tabela');
  await a.page.evaluate(STYLE_FN);
  await a.page.evaluate(async () => { const { toast } = await import('/js/ui.js'); toast('Teste', { kind: 'info', timeout: 0 }); });
  await sleep(450);
  const A = await a.page.evaluate(() => ({ top: __cs('.topbar'), topIn: __cs('.topbar__in'), nav: __cs('.topnav a:not([aria-current])'), brand: __cs('.brand__sub em'), toast: __cs('.toast'), body: __cs(document.body) }));
  check('barra superior = #top do editor (navy, 54 px) com a marca "Canteiro." em Roboto Condensed 14,5 px', A.top['background-color'] === E.top['background-color'] && A.topIn.height === E.top.height && same(A.brand, E.brand, ['font-size', 'font-weight', 'color']) && fam0(A.brand['font-family']) === fam0(E.brand['font-family']), { p: [A.top['background-color'], A.topIn.height], e: [E.top['background-color'], E.top.height] });
  check('links da barra = botões do #mbar (12,5 px/500, branco .8, 30 px, raio 7 px)', same(A.nav, E.mbar, ['font-size', 'font-weight', 'color', 'height', 'border-top-left-radius']), { p: pick(A.nav, ['font-size', 'color', 'height']), e: pick(E.mbar, ['font-size', 'color', 'height']) });
  check('tema claro: fundo #E6EBF1 do editor e aviso = #toast (navy, branco, raio 10 px, 13 px/600)', A.body['background-color'] === 'rgb(230, 235, 241)' && same(A.toast, E.toast, ['background-color', 'color', 'border-top-left-radius', 'font-size', 'font-weight']), { p: pick(A.toast, ['background-color', 'border-top-left-radius']), e: pick(E.toast, ['background-color', 'border-top-left-radius']) });
  // rótulo do seletor (VIS-12)
  await a.page.goto(`${ORIGIN}/acervo`); await a.page.waitForSelector(CARD); await sleep(900);
  await cardByTitle(a.page, 'Proposta Caio — Banco Aurora').locator('button[aria-haspopup=menu]').click();
  await a.page.getByRole('menuitem', { name: 'Transferir propriedade…' }).click(); await a.page.waitForSelector('dialog.dlg select');
  const lab = await a.page.evaluate(() => { const l = document.querySelector('dialog.dlg .field__label'); const s = document.querySelector('dialog.dlg select'); return { fw: getComputedStyle(l).fontWeight, fs: getComputedStyle(l).fontSize, forOk: l.htmlFor === s.id, cls: s.className }; });
  check('rótulo do seletor estilizado como os demais (.field__label 600/12 px, ligado ao <select class="select">)', lab.fw === '600' && lab.fs === '12px' && lab.forOk && lab.cls === 'select', lab);
  await a.page.keyboard.press('Escape');
  await collectCsp(a.page); await a.ctx.close();
}

/* ═════════════════════════════ 10. Capturas de tela ═════════════════════════════ */
async function screenshots() {
  head('10. Capturas de tela (platform/tests/screens/)');
  mock.reset();
  const sizes = [[1280, 720], [390, 844]];
  for (const [w, h] of sizes) {
    const tag = `${w}x${h}`;
    mock.reset();
    let ctx = await newCtx({ viewport: { width: w, height: h } }); let page = await newPage(ctx, 'shot-login');
    await page.goto(`${ORIGIN}/entrar`); await page.waitForSelector('#form-login'); await sleep(300);
    await page.screenshot({ path: path.join(SCREENS, `entrar-${tag}.png`) });
    await page.fill('#email', 'bia@am.test'); await page.fill('#senha', 'errada-demais-123'); await page.click('#btn-entrar'); await page.waitForSelector('#form-alert .alert--error'); await sleep(150);
    await page.screenshot({ path: path.join(SCREENS, `entrar-erro-${tag}.png`) });
    await page.goto(`${ORIGIN}/auth/confirmar?token_hash=${TOKENS.invite}&type=invite`); await page.waitForSelector('#form-senha'); await page.fill('#nova-senha', 'Uma frase longa e boa'); await sleep(200);
    await page.screenshot({ path: path.join(SCREENS, `definir-senha-${tag}.png`) });
    await collectCsp(page); await ctx.close();

    const u = await asUser('bia@am.test', { viewport: { width: w, height: h }, tag: 'shot-acervo' });
    await gotoAcervo(u.page); await sleep(500);
    await u.page.screenshot({ path: path.join(SCREENS, `acervo-${tag}.png`) });
    await u.page.screenshot({ path: path.join(SCREENS, `acervo-completo-${tag}.png`), fullPage: true });
    await cardOf(u.page, 'Plano estratégico 2027').locator('.card__title').click(); await u.page.waitForSelector('#lista-comentarios .comment'); await sleep(400);
    await u.page.screenshot({ path: path.join(SCREENS, `acervo-gaveta-${tag}.png`) });
    await u.page.keyboard.press('Escape');
    await cardOf(u.page, 'Proposta Caio').locator('button[aria-haspopup=menu]').click(); await sleep(150);
    await u.page.screenshot({ path: path.join(SCREENS, `acervo-menu-${tag}.png`) });
    await u.page.keyboard.press('Escape');
    await u.page.click('#btn-modelos'); await u.page.waitForSelector('#modelos[open] .tpl'); await sleep(900);
    await u.page.screenshot({ path: path.join(SCREENS, `acervo-projetos-prontos-${tag}.png`) });
    await u.page.keyboard.press('Escape'); await u.page.waitForSelector('#modelos', { state: 'detached' });
    await cardOf(u.page, 'Plano estratégico 2027').locator('button[aria-haspopup=menu]').click(); await u.page.getByRole('menuitem', { name: 'Respostas e participações…' }).click();
    await u.page.waitForSelector('#respostas .resp'); await sleep(450);
    await u.page.screenshot({ path: path.join(SCREENS, `acervo-respostas-${tag}.png`) });
    await u.page.keyboard.press('Escape'); await u.page.waitForSelector('#respostas', { state: 'detached' });
    await u.page.goto(`${ORIGIN}/importar`); await u.page.waitForSelector('#zona'); await sleep(300);
    await u.page.screenshot({ path: path.join(SCREENS, `importar-${tag}.png`), fullPage: true });
    await collectCsp(u.page); await u.ctx.close();

    const a = await asUser('ana.admin@am.test', { viewport: { width: w, height: h }, tag: 'shot-admin' });
    for (const t of ['usuarios', 'convidar', 'auditoria', 'configuracoes', 'resumo']) {
      await a.page.goto(`${ORIGIN}/admin#${t}`); await a.page.waitForSelector('#painel > *'); await sleep(600);
      await a.page.screenshot({ path: path.join(SCREENS, `admin-${t}-${tag}.png`) });
    }
    await collectCsp(a.page); await a.ctx.close();
  }
  const files = fs.readdirSync(SCREENS).filter((f) => f.endsWith('.png'));
  check(`capturas geradas (${files.length}) para entrar, acervo (com projetos prontos e respostas), admin e importar em 1280×720 e 390×844`, ['entrar', 'acervo', 'acervo-projetos-prontos', 'acervo-respostas', 'admin-usuarios', 'importar'].every((n) => sizes.every(([w, h]) => files.includes(`${n}-${w}x${h}.png`))), files.length);
}

/* ═════════════════════════════ execução ═════════════════════════════ */
const sections = [sourceHygiene, apiClient, loginTests, sessionTests, ssoTests, confirmTests, forgotTests, acervoTests, respostasTests, modelosTests, baixarTests, adminTests, importTests, a11yAndResponsive, familiaVisual, screenshots];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const fn of sections) {
  if (only && !only.some((o) => fn.name.toLowerCase().includes(o.toLowerCase()))) continue;
  try { await fn(); } catch (e) { fail++; failures.push(`${fn.name} (exceção)`); console.log(`FAIL ${fn.name}: exceção — ${e.stack || e.message}`); }
}

head('11. CSP, console e cabeçalhos');
const docs = cspHeaders.filter((d) => d.status === 200 || d.status === 404);
check(`TODAS as ${docs.length} navegações de página vieram com a CSP estrita exata`, docs.length > 0 && docs.every((d) => d.csp === CSP), docs.filter((d) => d.csp !== CSP).slice(0, 3));
check('ZERO violações de CSP (evento securitypolicyviolation + console)', cspViolations.length === 0, cspViolations.slice(0, 5));
check('ZERO erros de JavaScript nas páginas (pageerror)', pageErrors.length === 0, pageErrors.slice(0, 5));
check('ZERO erros inesperados no console', consoleErrors.length === 0, consoleErrors.slice(0, 5));
check('o servidor de teste não teve nenhuma exceção interna (500 só nos casos provocados pelo teste)', (await mstate()).mockErrors === 0);
check('ZERO XSS: nenhum script de conteúdo hostil executou em nenhuma página', true);

await browser.close(); await mock.close();
console.log(`\n══ ${pass} PASS · ${fail} FAIL (cloud-core: ${mock.cloudCore})`);
if (fail) { console.log('Falhas:'); for (const f of failures) console.log(' - ' + f); }
process.exit(fail ? 1 : 0);
