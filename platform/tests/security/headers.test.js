/* Cabeçalhos de segurança, CORS fechado, X-Request-Id, log de acesso, IP do cliente e servidor estático (traversal, MIME, SPA, CSP por página). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { boot } from '../helpers/boot.js';
import { securityHeaders, HSTS, PERMISSIONS_POLICY } from '../../src/middleware/security-headers.js';
import { requestId } from '../../src/middleware/request-id.js';
import { accessLog } from '../../src/middleware/access-log.js';
import { clientIp, normalizeIp } from '../../src/lib/ip.js';
import { serveStatic, resolveFile, DEFAULT_CSP } from '../../src/static.js';

const logs = [];
const logger = { info: (m, f) => logs.push({ level: 'info', m, ...f }), warn: (m, f) => logs.push({ level: 'warn', m, ...f }), error: (m, f) => logs.push({ level: 'error', m, ...f }) };
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'canteiro-static-'));
const pub = path.join(dist, 'public');
const write = (rel, text) => { const f = path.join(pub, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const EDITOR_CSP = "default-src 'self'; script-src 'self' 'sha256-EDITOR'; frame-ancestors 'none'", VIEW_CSP = "default-src 'self'; script-src 'self' 'sha256-VIEWER'; frame-ancestors 'none'";

let t;
before(async () => {
  for (const d of ['', 'editor', 'visualizar', 'acervo', 'admin', 'entrar', 'importar', 'esqueci-senha', 'auth']) write(path.join(d, 'index.html'), `<!doctype html><title>${d || 'raiz'}</title>PAGINA:${d || 'raiz'}`);
  write('assets/app.0123456789abcdef.js', 'console.log(1)'); write('assets/estilo.css', 'body{}'); write('assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  write('js/boot.js', 'x'); write('js/vendor.deadbeefcafe.js', 'x'); write('assets/foto.png', 'PNG'); write('assets/dados.json', '{}'); write('assets/fonte.woff2', 'w'); write('assets/arquivo.xyz', 'z'); write('robots.txt', 'User-agent: *');
  write('sub/solto.txt', 'solto'); write('.env', 'SEGREDO=1'); write('.git/config', 'SEGREDO=2'); write('assets/.hidden', 'x');
  fs.writeFileSync(path.join(dist, 'outside.txt'), 'OUTSIDE-SECRET'); fs.symlinkSync(path.join(dist, 'outside.txt'), path.join(pub, 'link.txt')); fs.symlinkSync(dist, path.join(pub, 'linkdir'));
  fs.writeFileSync(path.join(dist, 'csp.json'), JSON.stringify({ default: "default-src 'self'; script-src 'self' 'sha256-DEFAULT'", '/editor/': EDITOR_CSP, '/visualizar/': VIEW_CSP }));
  t = await boot({ withStatic: true, publicDir: pub, deps: { logger } });
});
after(async () => { await t.stop(); fs.rmSync(dist, { recursive: true, force: true }); });

describe('cabeçalhos da API', () => {
  const must = (r) => {
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin'); assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(r.headers.get('permissions-policy'), PERMISSIONS_POLICY); assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'"); assert.ok(r.headers.get('x-request-id'));
  };
  test('presentes em sucesso, 401, 403 (CSRF), 404, 400 e 405', async () => {
    const c = t.anon();
    must(await c.get('/api/health')); must(await c.get('/api/me')); must(await c.get('/api/nao-existe'));
    must(await c.request('POST', '/api/auth/login', { json: {}, csrf: false })); await c.ensureCsrf(); must(await c.post('/api/auth/login', { email: 'x' }));
    must(await c.request('DELETE', '/api/health', { csrf: true }));
  });
  test('Permissions-Policy restringe câmera, microfone, geolocalização…', () => {
    for (const f of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']) assert.ok(PERMISSIONS_POLICY.includes(f), f);
  });
  test('Cache-Control: no-store em /api/auth, /api/admin, /api/me e (por padrão) em toda a API', async () => {
    const c = await t.as(await t.createUser({ role: 'admin' }), { fresh: true });
    for (const p of ['/api/auth/session', '/api/admin/stats', '/api/me', '/api/health', '/api/ready', '/api/nao-existe']) assert.equal((await c.get(p)).headers.get('cache-control'), 'no-store', p);
    assert.equal((await t.anon().request('POST', '/api/auth/login', { json: {} , csrf: false })).headers.get('cache-control'), 'no-store', 'também nos erros');
  });
  test('HSTS só quando HTTPS (config segura); valor exato; ausente em http local', async () => {
    const mk = (cfg) => { const a = new Hono(); a.use('*', securityHeaders(cfg)); a.get('/api/x', (c) => c.json({})); return a; };
    assert.equal((await mk({ isSecure: true }).request('/api/x')).headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains'); assert.equal(HSTS, 'max-age=63072000; includeSubDomains');
    assert.equal((await mk({ cookieSecure: true }).request('/api/x')).headers.get('strict-transport-security'), HSTS);
    assert.equal((await mk({ isSecure: false }).request('/api/x')).headers.get('strict-transport-security'), null);
    assert.equal((await t.anon().get('/api/health')).headers.get('strict-transport-security'), null);
  });
  test('o endpoint pode definir o próprio CSP/Cache-Control (arquivos), mas CORS é sempre removido', async () => {
    const a = new Hono(); a.use('*', securityHeaders({ isSecure: true }));
    a.get('/api/arq', (c) => new Response('x', { headers: { 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true' } }));
    a.get('/api/redir', (c) => Response.redirect('https://x.example/', 302));
    const r = await a.request('/api/arq'); assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; sandbox"); assert.equal(r.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    assert.equal(r.headers.get('access-control-allow-origin'), null); assert.equal(r.headers.get('access-control-allow-credentials'), null); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const rd = await a.request('/api/redir'); assert.equal(rd.status, 302); assert.equal(rd.headers.get('x-content-type-options'), 'nosniff', 'funciona até com cabeçalhos imutáveis');
  });
  test('sem CORS: nem para Origin hostil, nem em preflight, nem em erro', async () => {
    const c = t.anon();
    for (const [m, p, h] of [['GET', '/api/health', { origin: 'https://evil.example' }], ['OPTIONS', '/api/auth/login', { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-csrf-token' }],
      ['GET', '/api/me', { origin: 'https://evil.example' }], ['POST', '/api/auth/login', { origin: 'https://evil.example' }]]) {
      const r = await c.request(m, p, { headers: h, csrf: false, json: m === 'POST' ? {} : undefined });
      for (const [k] of r.headers) assert.ok(!k.toLowerCase().startsWith('access-control-'), `${m} ${p}: ${k}`);
    }
  });
  test('X-Request-Id: aceita o do cliente se for seguro; senão gera; nunca reflete lixo', async () => {
    const c = t.anon();
    assert.equal((await c.get('/api/health', { headers: { 'x-request-id': 'req_ABC-123456' } })).headers.get('x-request-id'), 'req_ABC-123456');
    for (const bad of ['curto', 'a'.repeat(65), 'tem espaco aqui!', '<script>alert(1)</script>', 'id;com;ponto-e-virgula']) {
      const id = (await c.get('/api/health', { headers: { 'x-request-id': bad } })).headers.get('x-request-id'); assert.notEqual(id, bad); assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
    }
    const e = await c.get('/api/me', { headers: { 'x-request-id': 'req_ABC-123456' } }); assert.equal(e.json.error.requestId, 'req_ABC-123456');
  });
});

describe('IP do cliente', () => {
  const ipOf = async (config, headers, env) => { const a = new Hono(); a.get('/', (c) => c.text(String(clientIp(c, config)))); return (await a.request('/', { headers }, env)).text(); };
  test('normaliza e valida', () => { assert.equal(normalizeIp('::FFFF:1.2.3.4'), '1.2.3.4'); assert.equal(normalizeIp('[2001:DB8::1]'), '2001:db8::1'); for (const v of ['x', '1.2.3', "1.2.3.4'; drop", '', null, 5]) assert.equal(normalizeIp(v), null); });
  test('com proxy confiável: XFF à direita, depois X-Real-IP', async () => {
    assert.equal(await ipOf({ trustProxy: true }, { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }), '198.51.100.7');
    assert.equal(await ipOf({ trustProxy: true }, { 'x-forwarded-for': 'lixo', 'x-real-ip': '198.51.100.8' }), '198.51.100.8');
    assert.equal(await ipOf({ trustProxy: true }, {}), 'null');
  });
  test('sem proxy confiável: cabeçalhos forjados são ignorados; usa o socket', async () => {
    assert.equal(await ipOf({ trustProxy: false }, { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' }), 'null');
    assert.equal(await ipOf({ trustProxy: false }, { 'x-forwarded-for': '6.6.6.6' }, { incoming: { socket: { remoteAddress: '::ffff:192.0.2.5' } } }), '192.0.2.5');
  });
});

describe('log de acesso', () => {
  test('uma linha por requisição, sem query, corpo, cookie nem cabeçalhos; com userId e requestId', async () => {
    const u = await t.createUser(); const c = t.anon(); logs.length = 0;
    await c.login(u.email, u.password); const n0 = logs.length; logs.length = 0;
    const r = await c.get('/api/me?token=SEGREDO-NA-QUERY&password=x', { headers: { authorization: 'Bearer SEGREDO-HEADER', 'x-request-id': 'req_LOG-0000001' } });
    assert.equal(r.status, 200); const lines = logs.filter((l) => l.m === 'http'); assert.equal(lines.length, 1, 'uma linha por requisição'); assert.ok(n0 >= 2);
    const l = lines[0]; assert.deepEqual([l.method, l.route, l.status, l.userId, l.requestId, l.ip], ['GET', '/api/me', 200, u.id, 'req_LOG-0000001', c.ip]); assert.equal(typeof l.ms, 'number');
    const dump = JSON.stringify(logs); for (const s of ['SEGREDO-NA-QUERY', 'SEGREDO-HEADER', c.cookie(t.names.at), c.cookie(t.names.rt), u.password, u.email]) assert.ok(!dump.includes(s), `log vazou ${s.slice(0, 12)}`);
    assert.deepEqual(Object.keys(l).sort(), ['ip', 'level', 'm', 'method', 'ms', 'requestId', 'route', 'status', 'userId']);
  });
  test('erros também são registrados (401/403/404) e respostas 5xx viram nível error', async () => {
    logs.length = 0; const c = t.anon(); await c.get('/api/me'); await c.get('/api/nada'); await c.request('POST', '/api/auth/login', { json: {}, csrf: false });
    assert.deepEqual(logs.filter((l) => l.m === 'http').map((l) => l.status), [401, 404, 403]);
    const a = new Hono(); a.use('*', async (c, n) => { c.set('deps', { config: t.config }); await n(); }); a.use('*', requestId()); a.use('*', accessLog({ config: t.config, logger })); a.get('/api/boom', () => new Response('x', { status: 500 }));
    logs.length = 0; await a.request('/api/boom'); assert.equal(logs.at(-1).level, 'error');
  });
});

describe('servidor estático', () => {
  const get = (p, o) => t.app.request(p, o);
  const body = async (p, o) => { const r = await get(p, o); return [r, await r.text()]; };

  test('páginas e reescritas de SPA → index.html da pasta', async () => {
    for (const [url, page] of [['/', 'raiz'], ['/index.html', 'raiz'], ['/editor/3f0f6a52-1111-4000-8000-000000000001', 'editor'], ['/editor/3F0F6A52-1111-4000-8000-000000000001/', 'editor'],
      ['/visualizar/3f0f6a52-1111-4000-8000-000000000001', 'visualizar'], ['/acervo', 'acervo'], ['/acervo/', 'acervo'], ['/admin', 'admin'], ['/admin/usuarios', 'admin'], ['/entrar', 'entrar'], ['/importar', 'importar'],
      ['/esqueci-senha', 'esqueci-senha'], ['/auth/confirmar?token_hash=abc&type=invite', 'auth']]) {
      const [r, text] = await body(url); assert.equal(r.status, 200, url); assert.ok(text.includes(`PAGINA:${page}`), `${url} → ${text}`); assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    }
  });
  test('editor sem o id (UUID) de uma apresentação → 302 para /acervo (o HTML abriria o editor original fora da nuvem)', async () => {
    for (const url of ['/editor', '/editor/', '/editor/index.html', '/editor/qualquer-id_1', '/editor/abc/def', '/visualizar', '/visualizar/xyz', '/editor/3f0f6a52-1111-4000-8000-000000000001/extra']) {
      const r = await get(url); assert.equal(r.status, 302, url); assert.equal(r.headers.get('location'), '/acervo', url); assert.ok(!(await r.text()).includes('PAGINA'), url);
      assert.equal((await get(url, { method: 'HEAD' })).status, 302, `HEAD ${url}`);
    }
  });
  test('rotas desconhecidas e arquivos inexistentes → 404 (nunca devolvem HTML no lugar de asset)', async () => {
    for (const url of ['/nao-existe', '/foo/bar', '/assets/sumiu.js', '/assets/sumiu.css', '/editor/app.js', '/acervo/x.png', '/assets/', '/sub/', '/sub', '/js/']) {
      const [r, text] = await body(url); assert.equal(r.status, 404, url); assert.ok(!text.includes('PAGINA'), url);
    }
  });
  test('sem listagem de diretório e sem dotfiles', async () => {
    for (const url of ['/assets', '/assets/', '/sub/', '/js', '/.env', '/.git/config', '/assets/.hidden', '/%2eenv', '/.git/', '/.well-known/x']) { const [r, text] = await body(url); assert.equal(r.status, 404, url); assert.ok(!/SEGREDO|solto|app\.0123/.test(text), url); }
  });
  test('path traversal, links simbólicos e codificações → nunca sai da pasta pública', async () => {
    const urls = ['/..%2foutside.txt', '/..%2Foutside.txt', '/%2e%2e/outside.txt', '/%2e%2e%2foutside.txt', '/assets/..%5coutside.txt', '/assets/%2e%2e%2f%2e%2e%2foutside.txt', '/%252e%252e/outside.txt', '/assets/%00',
      '/assets/..%00/outside.txt', '/link.txt', '/linkdir/outside.txt', '/assets/../../outside.txt', '/..\\outside.txt', '/....//outside.txt', '/editor/..%2f..%2foutside.txt', '/%c0%ae%c0%ae/outside.txt', '/%'];
    for (const url of urls) { const [r, text] = await body(url); assert.ok([400, 404].includes(r.status), `${url} → ${r.status}`); assert.ok(!text.includes('OUTSIDE-SECRET'), url); }
    const real = fs.realpathSync(pub);
    for (const raw of ['/../outside.txt', '/a/../../outside.txt', '/..%2foutside.txt', '/a\\..\\b', '/x\0y', '/%2e%2e/x', '/link.txt', '/linkdir/outside.txt']) {
      const f = resolveFile(real, raw); assert.ok(f === null || (f === real || f.startsWith(real + path.sep)), `${raw} → ${f}`); assert.ok(f === null || !f.includes('outside'), raw);
    }
    assert.equal(resolveFile(real, '/assets/app.0123456789abcdef.js'), path.join(real, 'assets', 'app.0123456789abcdef.js'));
  });
  test('symlinks internos nunca expõem arquivos ocultos ou rotas privadas', async () => {
    write('api/segredo.txt', 'ARQUIVO-DA-API-PRIVADA');
    fs.symlinkSync(path.join(pub, '.env'), path.join(pub, 'assets', 'alias-oculto.txt'));
    fs.symlinkSync(path.join(pub, 'api', 'segredo.txt'), path.join(pub, 'assets', 'alias-api.txt'));
    for (const url of ['/assets/alias-oculto.txt', '/assets/alias-api.txt']) {
      const [r, content] = await body(url);
      assert.equal(r.status, 404, url);
      assert.ok(!/SEGREDO|ARQUIVO-DA-API/.test(content), url);
    }
    assert.equal(resolveFile(fs.realpathSync(pub), '/assets/alias-oculto.txt'), null);
    assert.equal(resolveFile(fs.realpathSync(pub), '/assets/alias-api.txt'), null);
  });

  test('index.html por diretório e rewrite SPA não pode seguir symlink para fora da pasta pública', async () => {
    const isolated = path.join(dist, 'isolated-public');
    fs.mkdirSync(path.join(isolated, 'admin'), { recursive: true });
    fs.mkdirSync(path.join(isolated, 'assets', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(isolated, 'editor'), { recursive: true });
    for (const file of ['index.html', 'admin/index.html', 'assets/nested/index.html']) {
      fs.symlinkSync(path.join(dist, 'outside.txt'), path.join(isolated, file));
    }
    const local = serveStatic(t.api, { ...t.config, publicDir: isolated });
    for (const url of ['/', '/admin', '/admin/usuarios', '/assets/nested', '/assets/nested/', '/acervo']) {
      const r = await local.request(url);
      const txt = await r.text();
      assert.equal(r.status, 404, url);
      assert.ok(!txt.includes('OUTSIDE-SECRET'), url);
    }

    // Links para arquivos públicos internos continuam válidos, inclusive com rewrite.
    fs.writeFileSync(path.join(isolated, 'safe.html'), '<!doctype html>SAFE-INTERNAL');
    fs.symlinkSync(path.join(isolated, 'safe.html'), path.join(isolated, 'editor', 'index.html'));
    const valid = await local.request('/editor/3f0f6a52-1111-4000-8000-000000000001');
    assert.equal(valid.status, 200);
    assert.ok((await valid.text()).includes('SAFE-INTERNAL'));
  });

  test('MIME corretos + nosniff', async () => {
    const want = { '/assets/app.0123456789abcdef.js': 'text/javascript; charset=utf-8', '/assets/estilo.css': 'text/css; charset=utf-8', '/assets/foto.png': 'image/png', '/assets/dados.json': 'application/json; charset=utf-8',
      '/assets/fonte.woff2': 'font/woff2', '/assets/logo.svg': 'image/svg+xml', '/robots.txt': 'text/plain; charset=utf-8', '/assets/arquivo.xyz': 'application/octet-stream' };
    for (const [url, type] of Object.entries(want)) { const r = await get(url); assert.equal(r.status, 200, url); assert.equal(r.headers.get('content-type'), type, url); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); }
  });
  test('SVG aberto direto não executa script (CSP com sandbox)', async () => assert.match((await get('/assets/logo.svg')).headers.get('content-security-policy'), /sandbox/));
  test('Cache-Control: HTML no-cache; /assets e /js COM hash → 1 ano imutável; sem hash → revalida', async () => {
    assert.equal((await get('/')).headers.get('cache-control'), 'no-cache'); assert.equal((await get('/editor/3f0f6a52-1111-4000-8000-000000000001')).headers.get('cache-control'), 'no-cache');
    assert.equal((await get('/assets/app.0123456789abcdef.js')).headers.get('cache-control'), 'public, max-age=31536000, immutable'); assert.equal((await get('/js/vendor.deadbeefcafe.js')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    for (const u of ['/js/boot.js', '/assets/estilo.css', '/robots.txt']) assert.equal((await get(u)).headers.get('cache-control'), 'no-cache', u);
  });
  test('ETag + If-None-Match → 304; HEAD sem corpo; método não permitido → 405', async () => {
    const r = await get('/assets/estilo.css'); const etag = r.headers.get('etag'); assert.ok(etag);
    const nm = await get('/assets/estilo.css', { headers: { 'if-none-match': etag } }); assert.equal(nm.status, 304); assert.equal(await nm.text(), '');
    const h = await get('/assets/estilo.css', { method: 'HEAD' }); assert.equal(h.status, 200); assert.equal(await h.text(), ''); assert.equal(h.headers.get('content-length'), '6');
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const x = await get('/', { method: m }); assert.equal(x.status, 405, m); assert.equal(x.headers.get('allow'), 'GET, HEAD'); }
  });
  test('CSP por página (dist/csp.json): /editor/, /visualizar/ e default; só em HTML', async () => {
    assert.equal((await get('/editor/3f0f6a52-1111-4000-8000-000000000001')).headers.get('content-security-policy'), EDITOR_CSP); assert.equal((await get('/editor/aaaaaaaa-1111-4000-8000-000000000002/')).headers.get('content-security-policy'), EDITOR_CSP);
    assert.equal((await get('/visualizar/3f0f6a52-1111-4000-8000-000000000001')).headers.get('content-security-policy'), VIEW_CSP);
    for (const u of ['/', '/acervo', '/admin', '/entrar', '/auth/confirmar']) assert.equal((await get(u)).headers.get('content-security-policy'), "default-src 'self'; script-src 'self' 'sha256-DEFAULT'", u);
    assert.equal((await get('/assets/estilo.css')).headers.get('content-security-policy'), null);
  });
  test('CSP padrão estrita quando o csp.json não existe, é inválido ou tenta injetar cabeçalho', async () => {
    const strict = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
    assert.equal(DEFAULT_CSP, strict);
    const run = async (file) => (await serveStatic(t.api, t.config, { cspFile: file }).request('/editor/3f0f6a52-1111-4000-8000-000000000001')).headers.get('content-security-policy');
    assert.equal(await run(path.join(dist, 'nao-existe.json')), strict);
    const bad = path.join(dist, 'bad.json'); fs.writeFileSync(bad, '{nao json'); assert.equal(await run(bad), strict);
    fs.writeFileSync(bad, JSON.stringify({ default: "default-src 'self'\r\nSet-Cookie: x=1", '/editor/': 42 })); assert.equal(await run(bad), strict, 'quebra de linha recusada');
    fs.writeFileSync(bad, JSON.stringify({ '/editor/': 'x'.repeat(9000) })); assert.equal(await run(bad), strict);
  });
  test('cabeçalhos de segurança e X-Request-Id também nas páginas', async () => {
    const r = await get('/acervo');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin'); assert.ok(r.headers.get('permissions-policy')); assert.ok(r.headers.get('x-request-id'));
    assert.equal((await get('/nao-existe')).headers.get('x-content-type-options'), 'nosniff');
  });
  test('/api nunca é servido como arquivo: vai para a API (JSON), inclusive com variações', async () => {
    const h = await get('/api/health'); assert.equal(h.status, 200); assert.equal((await h.json()).ok, true); assert.equal(h.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    const nf = await get('/api/inexistente'); assert.equal(nf.status, 404); assert.equal((await nf.json()).error.code, 'not_found');
    write('api/segredo.txt', 'ARQUIVO-NA-PASTA-API');
    for (const u of ['/api/segredo.txt', '/%61pi/segredo.txt', '/API/segredo.txt', '/api%2fsegredo.txt']) { const [r, text] = await body(u); assert.ok(!text.includes('ARQUIVO-NA-PASTA-API'), u); assert.notEqual(r.status, 200, u); }
  });
});
