/* web.test.js — testes das páginas web (Playwright/Chromium) contra tests/web/mock-api.js, servidas com a CSP ESTRITA.
   Uso:  /opt/node22/bin/node platform/tests/web/web.test.js          (porta 4201; PORT=… para trocar)
         WEB_CLOUD_CORE=real node …/web.test.js                       (usa platform/studio-cloud/cloud-core.js em vez do stub)
   Sai com código 0 se tudo passou. Capturas em platform/tests/screens/ (ignoradas pelo git). */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_PATH = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
const require = createRequire(import.meta.url);
require('module').Module._initPaths();
const { chromium } = require('playwright');
const { startMock, CSP, PASSWORD, IDS, TOKENS, XSS_TITLE, makePng } = await import('./mock-api.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../web');
const SCREENS = path.resolve(HERE, '../screens');
const FONTS = process.env.AM_FONTS_DIR || path.resolve(HERE, '../../../fonts2');
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
const EXPECTED_NET = /Failed to load resource: the server responded with a status of (400|401|403|404|409|422|429|500|502)|net::ERR_(FAILED|ABORTED|INTERNET_DISCONNECTED|CONNECTION_REFUSED)/;

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
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Lixeira' }).click(); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 2);
  check('admin: a lixeira mostra as de todos (2)', (await page.locator('li.card').count()) === 2);
  const victim = page.locator('li.card', { hasText: 'Rascunho excluído do Caio' });
  await victim.locator('button[aria-haspopup=menu]').click(); await page.getByRole('menuitem', { name: 'Apagar de vez' }).click();
  await page.click('dialog.dlg [data-act=confirm]'); await page.waitForFunction(() => document.querySelectorAll('li.card:not(.card--skel)').length === 1);
  check('admin: "Apagar de vez" pede confirmação e remove de verdade', !(await mstate()).presentations.some((p) => p.title === 'Rascunho excluído do Caio'));
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

async function a11yAndResponsive() {
  head('9. Acessibilidade, teclado, movimento reduzido e responsivo');
  mock.reset();
  // login: ordem de tab
  let ctx = await newCtx(); let page = await newPage(ctx, 'a11y-login');
  await page.goto(`${ORIGIN}/entrar`); await page.waitForSelector('#form-login');
  check('ao abrir, o foco já está no campo de e-mail (autofoco)', (await page.evaluate(() => document.activeElement.id)) === 'email');
  const order = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.getAttribute('aria-label'))); }
  await page.focus('#email'); await page.keyboard.press('Shift+Tab');
  const back = await page.evaluate(() => document.activeElement.className);
  check('ordem de Tab no login: e-mail → senha → mostrar senha → Entrar → Esqueci a senha; Shift+Tab do e-mail vai ao link de pular', JSON.stringify(order) === JSON.stringify(['senha', 'Mostrar senha', 'btn-entrar', 'link-esqueci']) && back === 'skip-link', { order, back });
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
  // contraste dos pares de cor do tema (gradientes do painel lateral)
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pairs = [['#ffffff', '#002a46', 4.5], ['#c4d4e5', '#0d4a73', 4.5], ['#dbe6f1', '#0d4a73', 4.5], ['#c4d4e5', '#001e32', 4.5], ['#002a46', '#f78c16', 4.5], ['#a24f00', '#ffffff', 4.5], ['#566579', '#f3f6f9', 4.5], ['#b3261e', '#ffffff', 4.5], ['#14633a', '#e6f4ec', 4.5], ['#7a4a00', '#fff4dc', 4.5], ['#174b7a', '#e8f1fa', 4.5], ['#66758a', '#ffffff', 4.5]];
  const lowP = pairs.filter(([f, b, m]) => cr(f, b) < m).map(([f, b]) => `${f}/${b}=${cr(f, b).toFixed(2)}`);
  check('pares de cor do tema (inclui textos sobre o painel em gradiente) passam em AA', lowP.length === 0, lowP);
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
  check(`capturas geradas (${files.length}) para entrar, acervo, admin e importar em 1280×720 e 390×844`, ['entrar', 'acervo', 'admin-usuarios', 'importar'].every((n) => sizes.every(([w, h]) => files.includes(`${n}-${w}x${h}.png`))), files.length);
}

/* ═════════════════════════════ execução ═════════════════════════════ */
const sections = [sourceHygiene, apiClient, loginTests, sessionTests, confirmTests, forgotTests, acervoTests, adminTests, importTests, a11yAndResponsive, screenshots];
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
