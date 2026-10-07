/* mock-api.js — servidor de teste das páginas web: serve platform/web com a CSP ESTRITA e implementa a API (docs/API.md) em memória.
   Cookies am_at / am_rt (HttpOnly) e am_csrf (legível), CSRF (cabeçalho = cookie + Origin), erros no formato do contrato, limites de taxa,
   cursor de paginação, RLS simulada (só o dono/admin altera). Não é produção: existe só para testar o cliente. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../web');
const MODELOS = path.join(WEB, 'assets', 'modelos');   // miniaturas reais (1º slide dos projetos prontos) usadas como capas no acervo simulado
const BRAND = path.resolve(HERE, '../../../am/brand');
const REAL_CORE = path.resolve(HERE, '../../studio-cloud/cloud-core.js');
const STUB_CORE = path.join(HERE, 'cloud-core-stub.js');

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
export const PASSWORD = 'SenhaForte-123456';
const uuidN = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const IDS = {
  admin: uuidN('00000000', 1), bia: uuidN('00000000', 2), caio: uuidN('00000000', 3), dora: uuidN('00000000', 4), eva: uuidN('00000000', 5), mallory: uuidN('00000000', 6), admin2: uuidN('00000000', 7),
};
export const TOKENS = { invite: 'tok-invite-eva-0123456789abcdef', recovery: 'tok-recovery-bia-0123456789abcdef', expired: 'tok-expired-0123456789abcdef' };
export const XSS_NAME = '<img src=x onerror="window.__xss=1">Mallory';
export const XSS_TITLE = '<img src=x onerror="window.__xss=2"> Título perigoso';
export const XSS_COMMENT = '<script>window.__xss=3</script><img src=x onerror="window.__xss=4"> comentário';
export const XSS_ANSWER = '<img src=x onerror="window.__xss=5"> resposta com HTML';
export const XSS_NOTE = '<script>window.__xss=6</script> revisão em pares';
export const VOTE_OPTS = ['Automação do intake', 'Portal do cliente', 'Torre de controle'];
const INTER_KINDS = ['form_response', 'board_state', 'vote_state', 'view', 'reaction'];
const ELEMENT_RE = /^[\w.:-]{1,80}$/;

/* CSV de interações no MESMO formato do servidor (src/lib/csv.js): BOM, separador ';', CRLF e apóstrofo antes de = + - @ (anti CSV-injection). */
const cellText = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(cellText).join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
function csvCell(v) { let s = cellText(v).replace(/\u0000/g, ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function interactionsCsv(kind, items) {
  const line = (cells) => cells.map(csvCell).join(';');
  if (kind !== 'form_response') return `﻿${[line(['Data/hora (UTC)', 'Respondente', 'Tipo', 'Elemento', 'Conteúdo (JSON)']), ...items.map((i) => line([i.createdAt, i.userName, i.kind, i.elementId, JSON.stringify(i.payload ?? {})]))].join('\r\n')}\r\n`;
  const cols = []; const rows = items.map((it) => { const q = Array.isArray(it.payload?.q) ? it.payload.q : []; const a = Array.isArray(it.payload?.a) ? it.payload.a : []; const cells = new Map();
    q.forEach((qq, i) => { const name = cellText(qq).trim() || `Pergunta ${i + 1}`; if (!cols.includes(name)) cols.push(name); cells.set(name, a[i]); }); return { it, cells }; });
  return `﻿${[line(['Data/hora (UTC)', 'Respondente', 'Elemento', ...cols]), ...rows.map(({ it, cells }) => line([it.createdAt, it.userName, it.elementId, ...cols.map((c) => (cells.has(c) ? cells.get(c) : ''))]))].join('\r\n')}\r\n`;
}

/* ───────── PNGs reais (mínimos) para testar o envio de imagens ───────── */
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function makePng(r, g, b, size = 8, noise = false) {
  const stride = size * 3 + 1;
  const raw = noise ? crypto.randomBytes(stride * size) : Buffer.alloc(stride * size);       // ruído = incompressível (imagem "grande" de verdade)
  for (let y = 0; y < size; y++) { raw[y * stride] = 0; if (!noise) for (let x = 0; x < size; x++) { const o = y * stride + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : b.slice(0, 3).toString() === 'GIF' ? 'image/gif' : null);

/* ───────── fábrica ───────── */
export async function startMock({ port = 0, cloudCore = process.env.WEB_CLOUD_CORE || 'auto' } = {}) {
  // 'auto' usa o módulo real (platform/studio-cloud/cloud-core.js) quando existe; 'stub' força o stub deste diretório
  const useReal = cloudCore === 'real' || (cloudCore === 'auto' && fs.existsSync(REAL_CORE));
  cloudCore = useReal ? 'real' : 'stub';
  let S;               // estado em memória
  let origin = '';
  const RL = new Map(); // limite de taxa
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function seed() {
    const now = Date.now();
    const mkUser = (id, email, displayName, role, status, extra = {}) => ({ id, email, displayName, role, status, password: PASSWORD, createdAt: new Date(now - 90 * 864e5).toISOString(), activatedAt: status === 'invited' ? null : new Date(now - 89 * 864e5).toISOString(), lastLoginAt: status === 'invited' ? null : new Date(now - 3600e3).toISOString(), ...extra });
    const users = new Map([
      [IDS.admin, mkUser(IDS.admin, 'ana.admin@am.test', 'Ana Admin', 'admin', 'active')],
      [IDS.admin2, mkUser(IDS.admin2, 'otto.admin@am.test', 'Otto Admin', 'admin', 'active')],
      [IDS.bia, mkUser(IDS.bia, 'bia@am.test', 'Bia Souza', 'member', 'active')],
      [IDS.caio, mkUser(IDS.caio, 'caio@am.test', 'Caio Lima', 'member', 'active')],
      [IDS.dora, mkUser(IDS.dora, 'dora@am.test', 'Dora Suspensa', 'member', 'suspended')],
      [IDS.eva, mkUser(IDS.eva, 'eva@am.test', 'Eva Convidada', 'member', 'invited', { password: null })],
      [IDS.mallory, mkUser(IDS.mallory, 'mallory@am.test', XSS_NAME, 'member', 'active')],
    ]);
    const real = (n) => { try { return fs.readFileSync(path.join(MODELOS, `modelo-${n}.png`)); } catch { return null; } };
    const png = [makePng(0, 42, 70), real(4) || makePng(247, 140, 22), real(3) || makePng(126, 161, 195)];
    const assets = new Map(); // sha -> {bytes, mime}
    for (const b of png) assets.set(sha256(b), { bytes: b, mime: 'image/png', size: b.length, owners: new Set() });
    const thumbs = [...assets.keys()];
    const owners = [IDS.admin, IDS.bia, IDS.caio, IDS.mallory];
    const pres = [];
    const topics = ['Diagnóstico de maturidade digital', 'Proposta comercial', 'Plano de transformação', 'Relatório trimestral', 'Workshop de estratégia', 'Due diligence operacional'];
    for (let i = 1; i <= 58; i++) {
      const owner = owners[i % owners.length];
      pres.push({ id: uuidN('11111111', i), title: `${topics[i % topics.length]} ${String(i).padStart(2, '0')}`, slideCount: 3 + (i % 17), rev: 1 + (i % 5), ownerId: owner,
        updatedAt: new Date(now - i * 3 * 3600e3).toISOString(), createdAt: new Date(now - (i + 20) * 864e5).toISOString(), thumbSha: i % 3 === 0 ? null : thumbs[i % 3], sourceId: i % 11 === 0 ? uuidN('11111111', 1) : null, deleted: false });
    }
    // casos nomeados
    const named = (n, over) => Object.assign(pres[n], over);
    named(0, { title: 'Plano estratégico 2027 (Bia)', ownerId: IDS.bia, id: uuidN('22222222', 1), updatedAt: new Date(now - 60e3).toISOString() });
    named(1, { title: 'Proposta Caio — Banco Aurora', ownerId: IDS.caio, id: uuidN('22222222', 2), updatedAt: new Date(now - 120e3).toISOString() });
    named(2, { title: XSS_TITLE, ownerId: IDS.mallory, id: uuidN('22222222', 3), updatedAt: new Date(now - 180e3).toISOString() });
    named(3, { title: 'Apresentação do Admin — Visão geral', ownerId: IDS.admin, id: uuidN('22222222', 4), updatedAt: new Date(now - 240e3).toISOString() });
    named(4, { title: 'Rascunho excluído da Bia', ownerId: IDS.bia, id: uuidN('22222222', 5), deleted: true });
    named(5, { title: 'Rascunho excluído do Caio', ownerId: IDS.caio, id: uuidN('22222222', 6), deleted: true });
    pres.forEach((p) => { p.content = { v: 1, app: 'AM Studio', id: p.id, title: p.title, slides: Array.from({ length: p.slideCount }, (_, k) => ({ id: `s${k}`, els: [] })) }; });
    // "Plano estratégico 2027 (Bia)": formulário (slide 2), votação (slide 3) e quadro de post-its (slide 4) com participações de várias pessoas
    const plano = pres[0];
    plano.content.slides[1].els.push({ id: 'frm1', type: 'fx', kind: 'form', data: { title: 'Pesquisa de satisfação', qs: 'Nota geral = 1-5\nO que podemos melhorar? = texto longo' } });
    plano.content.slides[2].els.push({ id: 'vot1', type: 'fx', kind: 'vote', data: { title: 'Priorização', opts: VOTE_OPTS.join('\n'), pts: 3 } });
    plano.content.slides[3].els.push({ id: 'brd1', type: 'fx', kind: 'board', data: { title: 'Retrospectiva', cols: 'Começar\nParar\nContinuar', notes: [{ c: 0, t: 'Reunião semanal de 15 min', k: 'y' }] } });
    const ago = (min) => new Date(now - min * 60e3).toISOString();
    const FQ = ['Nota geral', 'O que podemos melhorar?'];
    const inter = [
      { kind: 'form_response', elementId: 'frm1', userId: IDS.caio, payload: { at: '07/10/2026 09:12', q: FQ, a: ['5', 'Mais exemplos práticos do setor.'] }, createdAt: ago(300) },
      { kind: 'form_response', elementId: 'frm1', userId: IDS.mallory, payload: { at: '07/10/2026 09:20', q: FQ, a: ['4', XSS_ANSWER] }, createdAt: ago(280) },
      { kind: 'form_response', elementId: 'frm1', userId: IDS.admin, payload: { at: '07/10/2026 10:02', q: FQ, a: ['3', '=SOMA(1;2) cronograma mais detalhado'] }, createdAt: ago(240) },
      { kind: 'vote_state', elementId: 'vot1', userId: IDS.caio, payload: { v: 1, q: VOTE_OPTS, rows: [{ at: '07/10/2026 10:30', a: [2, 1, 0] }] }, createdAt: ago(200) },
      { kind: 'vote_state', elementId: 'vot1', userId: IDS.mallory, payload: { v: 1, q: VOTE_OPTS, rows: [{ at: '07/10/2026 10:31', a: [0, 1, 2] }] }, createdAt: ago(190) },
      { kind: 'vote_state', elementId: 'vot1', userId: IDS.bia, payload: { v: 1, q: VOTE_OPTS, rows: [{ at: '07/10/2026 10:32', a: [1, 1, 1] }, { at: '07/10/2026 10:33', a: [3, 0, 0] }] }, createdAt: ago(180) },
      { kind: 'board_state', elementId: 'brd1', userId: IDS.caio, payload: { v: 1, notes: [{ id: 'n1', c: 0, t: 'Reunião semanal de 15 min', k: 'y' }, { id: 'n2', c: 1, t: 'Relatórios em PDF por e-mail', k: 'p' }] }, createdAt: ago(150) },
      { kind: 'board_state', elementId: 'brd1', userId: IDS.mallory, payload: { v: 1, notes: [{ id: 'n3', c: 0, t: 'Reunião semanal de 15 min', k: 'y' }, { id: 'n4', c: 2, t: XSS_NOTE, k: 'g' }] }, createdAt: ago(140) },
      // na apresentação do Caio (elemento que já saiu do conteúdo), respostas da Bia e da Ana: a Bia (membro) só vê e apaga a própria; o dono e o admin veem tudo
      { kind: 'form_response', elementId: 'frm9', presentationId: pres[1].id, userId: IDS.bia, payload: { at: '07/10/2026 11:00', q: ['Comentário'], a: ['Ótima proposta'] }, createdAt: ago(100) },
      { kind: 'form_response', elementId: 'frm9', presentationId: pres[1].id, userId: IDS.admin, payload: { at: '07/10/2026 11:05', q: ['Comentário'], a: ['Revisar o cronograma'] }, createdAt: ago(90) },
    ].map((x, i) => ({ id: uuidN('44444444', i + 1), presentationId: plano.id, updatedAt: x.createdAt, ...x }));
    const comments = [
      { id: uuidN('33333333', 1), presentationId: uuidN('22222222', 1), slideIndex: 2, authorId: IDS.caio, body: 'Rever o gráfico de receita no slide 3.', createdAt: new Date(now - 7200e3).toISOString(), resolvedAt: null, deleted: false },
      { id: uuidN('33333333', 2), presentationId: uuidN('22222222', 1), slideIndex: null, authorId: IDS.bia, body: 'Obrigada! Ajustado.', createdAt: new Date(now - 3600e3).toISOString(), resolvedAt: new Date(now - 1800e3).toISOString(), deleted: false },
      { id: uuidN('33333333', 3), presentationId: uuidN('22222222', 3), slideIndex: 0, authorId: IDS.mallory, body: XSS_COMMENT, createdAt: new Date(now - 600e3).toISOString(), resolvedAt: null, deleted: false },
    ];
    const audit = [];
    const actions = ['auth.login', 'presentation.create', 'presentation.update', 'presentation.duplicate', 'comment.create', 'asset.upload', 'presentation.share', 'auth.login_failed', 'presentation.delete'];
    for (let i = 0; i < 120; i++) {
      const actorId = [IDS.admin, IDS.bia, IDS.caio, IDS.mallory][i % 4];
      audit.push({ id: 1000 - i, at: new Date(now - i * 20 * 60e3).toISOString(), actorId, action: actions[i % actions.length], entityType: 'presentation', entityId: uuidN('11111111', 1 + (i % 50)), ip: `203.0.113.${10 + (i % 40)}`, meta: i % 5 === 0 ? { slides: 12, size: 34567, title: i === 0 ? XSS_TITLE : 'ok' } : {} });
    }
    const settings = new Map([
      ['acervo.visibility', { value: 'all_members', updatedAt: null }], ['versions.keep_last', { value: 50, updatedAt: null }], ['versions.keep_daily_days', { value: 90, updatedAt: null }],
      ['uploads.max_bytes', { value: 104857600, updatedAt: null }], ['invites.ttl_days', { value: 7, updatedAt: null }],
    ]);
    S = { users, pres, comments, inter, audit, settings, assets, thumbs, png, at: new Map(), rt: new Map(), linkTokens: new Map(), requests: [], refreshCount: 0, refreshFails: false, csrfBlocked: 0, auditSeq: 2000, created: [], uploads: [], loginFails: new Map(), invites: new Map([[uuidN('99999999', 1), { id: uuidN('99999999', 1), email: 'eva@am.test', userId: IDS.eva, status: 'pending', expiresAt: new Date(now + 5 * 864e5).toISOString(), resent: 0 }]]) };
    S.linkTokens.set(TOKENS.invite, { type: 'invite', userId: IDS.eva, used: false });
    S.linkTokens.set(TOKENS.recovery, { type: 'recovery', userId: IDS.bia, used: false });
    RL.clear();
  }
  seed();

  /* ───────── utilidades HTTP ───────── */
  const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
  const rid = () => crypto.randomBytes(6).toString('hex');
  function send(res, status, body, headers = {}) {
    const isBuf = Buffer.isBuffer(body);
    const payload = body === undefined || body === null ? '' : isBuf || typeof body === 'string' ? body : JSON.stringify(body);
    const h = { 'X-Request-Id': res.reqId || rid(), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers };
    if (!h['Content-Type'] && payload !== '') h['Content-Type'] = 'application/json; charset=utf-8';
    if (res.cookiesOut?.length) h['Set-Cookie'] = res.cookiesOut;
    res.writeHead(status, h); res.end(payload);
  }
  const fail = (res, status, code, message, details, headers) => send(res, status, { error: { code, message, ...(details ? { details } : {}), requestId: res.reqId } }, headers);
  const setCookie = (res, name, value, { httpOnly = true, maxAge = 3600 } = {}) => { (res.cookiesOut ||= []).push(`${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? '; HttpOnly' : ''}`); };
  const clearCookie = (res, name) => (res.cookiesOut ||= []).push(`${name}=; Path=/; SameSite=Lax; Max-Age=0`);
  async function readBody(req, max = 30 * 1024 * 1024) {
    const parts = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('too_large'), { status: 413 }); parts.push(c); }
    return Buffer.concat(parts);
  }
  function hit(bucket, key, max, windowS) {
    const k = `${bucket}:${key}`; const now = Date.now(); let e = RL.get(k);
    if (!e || now > e.reset) { e = { n: 0, reset: now + windowS * 1000 }; RL.set(k, e); }
    e.n++;
    return e.n <= max ? 0 : Math.max(1, Math.ceil((e.reset - now) / 1000));
  }
  const pub = (u) => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status });
  const owner = (id) => { const u = S.users.get(id); return { id, displayName: u?.displayName || 'Desconhecido' }; };
  const meta = (p) => ({ id: p.id, title: p.title, slideCount: p.slideCount, rev: p.rev, owner: owner(p.ownerId), updatedAt: p.updatedAt, createdAt: p.createdAt, thumbSha: p.thumbSha, sourceId: p.sourceId, deleted: p.deleted });
  const audit = (actorId, action, entityType = null, entityId = null, m = {}, ip = '127.0.0.1') => { S.audit.unshift({ id: ++S.auditSeq, at: new Date().toISOString(), actorId, action, entityType, entityId, ip, meta: m }); };

  function authOf(req) {
    const c = parseCookies(req);
    const t = c.am_at && S.at.get(c.am_at);
    if (!t) return { user: null, expired: Boolean(c.am_at) || Boolean(c.am_rt) };
    if (Date.now() > t.exp) return { user: null, expired: true };
    return { user: S.users.get(t.userId) || null, expired: false };
  }
  function startSession(res, user) {
    const at = crypto.randomBytes(24).toString('hex'); const rt = crypto.randomBytes(24).toString('hex');
    S.at.set(at, { userId: user.id, exp: Date.now() + 3600e3 }); S.rt.set(rt, { userId: user.id, exp: Date.now() + 30 * 864e5 });
    setCookie(res, 'am_at', at, { maxAge: 3600 }); setCookie(res, 'am_rt', rt, { maxAge: 30 * 86400 });
  }
  const sessionBody = (user, csrfToken) => ({ authenticated: true, csrfToken, user: pub(user), needsPassword: user.status === 'invited' || !user.password });

  /* ───────── API ───────── */
  async function api(req, res, url) {
    const m = req.method; const p = url.pathname; const q = url.searchParams;
    const cookies = parseCookies(req);
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(m);
    S.requests.push({ method: m, path: p + url.search, csrf: req.headers['x-csrf-token'] || null, cookieCsrf: cookies.am_csrf || null, origin: req.headers.origin || null, ctype: req.headers['content-type'] || null, at: Date.now() });

    let raw = Buffer.alloc(0);
    if (write) { try { raw = await readBody(req); } catch (e) { return fail(res, 413, 'too_large', 'Corpo grande demais.'); } }
    const isJson = (req.headers['content-type'] || '').includes('application/json');

    // CSRF (docs/API.md §2): cabeçalho = cookie, Origin da própria aplicação, Content-Type JSON (ou upload de arquivo)
    if (write) {
      const okCsrf = cookies.am_csrf && req.headers['x-csrf-token'] === cookies.am_csrf;
      const okOrigin = !req.headers.origin || req.headers.origin === origin;
      const okType = !raw.length || isJson || p.startsWith('/api/assets/');
      if (!okCsrf || !okOrigin || !okType) { S.csrfBlocked++; return fail(res, 403, 'csrf', 'Requisição bloqueada por segurança. Recarregue a página e tente novamente.'); }
    }
    let body = {};
    if (write && isJson && raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'invalid_request', 'JSON inválido.'); } }

    /* ---- rotas de teste ---- */
    if (p === '/api/_slow') { await sleep(Number(q.get('ms') || 1000)); return send(res, 200, { ok: true }); }
    if (p === '/api/_boom') return send(res, 502, '<html>Bad gateway</html>', { 'Content-Type': 'text/html' });
    if (p === '/api/_limited') return fail(res, 429, 'rate_limited', 'x', null, { 'Retry-After': '90' });
    if (p === '/api/_echo') return send(res, 200, { method: m, csrf: req.headers['x-csrf-token'] || null, ctype: req.headers['content-type'] || null, body });

    if (p === '/api/health') return send(res, 200, { ok: true, version: 'mock', env: 'test' });

    /* ---- auth ---- */
    if (p === '/api/auth/session' && m === 'GET') {
      let csrf = cookies.am_csrf;
      if (!csrf) { csrf = crypto.randomBytes(32).toString('hex'); setCookie(res, 'am_csrf', csrf, { httpOnly: false, maxAge: 30 * 86400 }); }
      let { user } = authOf(req);
      if (!user && cookies.am_rt) { // o servidor real renova sozinho quando só o cookie de acesso expirou
        const t = S.rt.get(cookies.am_rt);
        const cand = t && S.users.get(t.userId);
        if (cand && cand.status === 'suspended') { clearCookie(res, 'am_at'); clearCookie(res, 'am_rt'); return send(res, 200, { authenticated: false, csrfToken: csrf, reason: 'suspended' }); }
        if (t && Date.now() <= t.exp && !S.refreshFails) { S.rt.delete(cookies.am_rt); user = cand; S.refreshCount++; startSession(res, user); }
        else clearCookie(res, 'am_rt');
      }
      if (user && user.status === 'suspended') return send(res, 200, { authenticated: false, csrfToken: csrf, reason: 'suspended' });
      return send(res, 200, user ? sessionBody(user, csrf) : { authenticated: false, csrfToken: csrf });
    }
    if (p === '/api/auth/login' && m === 'POST') {
      const email = String(body.email || '').trim().toLowerCase(); const ip = req.socket.remoteAddress;
      const wait = hit('login', `${email}|${ip}`, 8, 600);
      if (wait) return fail(res, 429, 'rate_limited', 'Muitas tentativas.', null, { 'Retry-After': String(wait) });
      await sleep(30);
      if (email === 'naoconvidado@am.test') return fail(res, 403, 'not_invited', 'Este e-mail não foi convidado.');
      const u = [...S.users.values()].find((x) => x.email === email);
      if (!u || !u.password || u.password !== body.password) { audit(null, 'auth.login_failed', 'user', null, {}); return fail(res, 401, 'invalid_credentials', 'E-mail ou senha incorretos.'); }
      if (u.status === 'suspended') return fail(res, 403, 'suspended', 'Conta suspensa.');
      u.lastLoginAt = new Date().toISOString(); startSession(res, u); audit(u.id, 'auth.login');
      return send(res, 200, sessionBody(u, cookies.am_csrf));
    }
    if (p === '/api/auth/logout' && m === 'POST') {
      const c = parseCookies(req); S.at.delete(c.am_at); S.rt.delete(c.am_rt); clearCookie(res, 'am_at'); clearCookie(res, 'am_rt');
      return send(res, 204);
    }
    if (p === '/api/auth/verify' && m === 'POST') {
      const ip = req.socket.remoteAddress; const wait = hit('verify', ip, 20, 900);
      if (wait) return fail(res, 429, 'rate_limited', 'Muitas tentativas.', null, { 'Retry-After': String(wait) });
      const t = S.linkTokens.get(body.tokenHash);
      if (!t || t.used || t.type !== body.type) return fail(res, 400, 'link_invalid', 'Link inválido ou expirado.');
      t.used = true; const u = S.users.get(t.userId); startSession(res, u);
      return send(res, 200, { ...sessionBody(u, cookies.am_csrf), needsPassword: true });
    }
    if (p === '/api/auth/password' && m === 'POST') {
      const { user } = authOf(req); if (!user) return fail(res, 401, 'unauthenticated', 'Entre para continuar.');
      const pw = String(body.password || '');
      if (pw.length < 12) return fail(res, 400, 'invalid_request', 'A senha precisa ter pelo menos 12 caracteres.', { fields: [{ path: 'password', message: 'A senha precisa ter pelo menos 12 caracteres.' }] });
      if (/123456789012|senha1234567/.test(pw) || pw.toLowerCase().includes(user.email.split('@')[0])) return fail(res, 400, 'invalid_request', 'Essa senha é muito comum ou fácil de adivinhar.', { fields: [{ path: 'password', message: 'Essa senha é muito comum ou fácil de adivinhar.' }] });
      user.password = pw; if (user.status === 'invited') { user.status = 'active'; user.activatedAt = new Date().toISOString(); for (const i of S.invites.values()) if (i.userId === user.id) i.status = 'accepted'; } user.lastLoginAt = new Date().toISOString();
      audit(user.id, 'auth.password_set'); return send(res, 200, sessionBody(user, cookies.am_csrf));
    }
    if (p === '/api/auth/forgot' && m === 'POST') {
      const wait = hit('forgot', req.socket.remoteAddress, 5, 900);
      if (wait) return fail(res, 429, 'rate_limited', 'Muitas tentativas.', null, { 'Retry-After': String(wait) });
      if (!/^[^\s@]+@[^\s@]+$/.test(String(body.email || ''))) return fail(res, 400, 'invalid_request', 'E-mail inválido.');
      S.forgot = (S.forgot || []).concat(String(body.email).toLowerCase());
      return send(res, 202, { ok: true });
    }
    if (p === '/api/auth/refresh' && m === 'POST') {
      await sleep(120);
      const c = parseCookies(req); const t = c.am_rt && S.rt.get(c.am_rt);
      if (S.refreshFails || !t || Date.now() > t.exp) return fail(res, 401, 'session_expired', 'Sua sessão expirou. Entre novamente.');
      S.refreshCount++; S.rt.delete(c.am_rt); startSession(res, S.users.get(t.userId));
      return send(res, 200, sessionBody(S.users.get(t.userId), cookies.am_csrf));
    }
    if (p === '/api/auth/sso/start') return fail(res, 501, 'not_configured', 'SSO ainda não configurado.');

    /* ---- daqui para baixo exige sessão ---- */
    const { user, expired } = authOf(req);
    if (!user) return fail(res, 401, expired ? 'session_expired' : 'unauthenticated', expired ? 'Sua sessão expirou.' : 'Entre para continuar.');
    if (user.status === 'suspended') return fail(res, 403, 'suspended', 'Conta suspensa.');
    if (user.status !== 'active') return fail(res, 403, 'forbidden', 'Conclua a definição da senha para continuar.');
    const isAdmin = user.role === 'admin';

    /* ---- apresentações ---- */
    if (p === '/api/presentations' && m === 'GET') {
      const scope = q.get('scope') || 'all'; const term = (q.get('q') || '').toLowerCase(); const limit = Math.min(100, Math.max(1, Number(q.get('limit') || 30)));
      let list = S.pres.filter((x) => (scope === 'trash' ? x.deleted && (x.ownerId === user.id || isAdmin) : !x.deleted && (scope === 'mine' ? x.ownerId === user.id : true)));
      if (term) list = list.filter((x) => x.title.toLowerCase().includes(term));
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const off = q.get('cursor') ? Number(Buffer.from(q.get('cursor'), 'base64url').toString()) || 0 : 0;
      const items = list.slice(off, off + limit).map(meta);
      const next = off + limit < list.length ? Buffer.from(String(off + limit)).toString('base64url') : null;
      return send(res, 200, { items, nextCursor: next });
    }
    if (p === '/api/presentations' && m === 'POST') {
      const content = body.content;
      if (content && /data:image\/(png|jpeg|webp|gif);base64,/.test(JSON.stringify(content))) return fail(res, 422, 'rejected_content', 'O conteúdo traz imagens embutidas; envie-as como arquivos.');
      if (content && body.source === 'import' && /FAIL_ME/.test(JSON.stringify(content))) return fail(res, 422, 'rejected_content', 'Conteúdo recusado pelo servidor (teste).');
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      const title = String(body.title || content?.title || 'Apresentação sem título').slice(0, 200);
      const slides = content?.slides?.length ?? 1;
      const np = { id, title, slideCount: slides, rev: 1, ownerId: user.id, updatedAt: now, createdAt: now, thumbSha: null, sourceId: null, deleted: false, content: content || { v: 1, title, slides: [{ id: 's1', els: [] }] } };
      S.pres.unshift(np); S.created.push({ id, source: body.source || 'new', title: body.title ?? null, content }); audit(user.id, 'presentation.create', 'presentation', id, { source: body.source || 'new' });
      return send(res, 201, { ...meta(np) });
    }
    let mt = p.match(/^\/api\/presentations\/([0-9a-f-]{36})(?:\/(.*))?$/);
    if (mt) {
      const pr = S.pres.find((x) => x.id === mt[1]);
      const sub = mt[2] || '';
      const canSee = pr && (!pr.deleted || pr.ownerId === user.id || isAdmin);
      if (!canSee) return fail(res, 404, 'not_found', 'Apresentação não encontrada.');
      const canEdit = pr.ownerId === user.id || isAdmin;
      if (sub === '' && m === 'GET') return send(res, 200, { ...meta(pr), content: pr.content, canEdit }, { ETag: `"${pr.rev}"` });
      if (sub === '' && m === 'DELETE') {
        if (!canEdit) return fail(res, 403, 'forbidden', 'Só o dono pode excluir.');
        if (q.get('purge')) { if (!isAdmin) return fail(res, 403, 'forbidden', 'Somente administradores.'); if (!pr.deleted) return fail(res, 409, 'conflict', 'Mova para a lixeira antes.'); S.pres.splice(S.pres.indexOf(pr), 1); audit(user.id, 'presentation.purge', 'presentation', pr.id); return send(res, 204); }
        pr.deleted = true; audit(user.id, 'presentation.delete', 'presentation', pr.id); return send(res, 204);
      }
      if (sub === 'restore' && m === 'POST') { if (!canEdit) return fail(res, 403, 'forbidden', 'Só o dono pode restaurar.'); pr.deleted = false; audit(user.id, 'presentation.restore', 'presentation', pr.id); return send(res, 200, meta(pr)); }
      if (sub === 'duplicate' && m === 'POST') {
        const id = crypto.randomUUID(); const now = new Date().toISOString();
        const np = { ...pr, id, title: String(body.title || `Cópia de ${pr.title}`).slice(0, 200), rev: 1, ownerId: user.id, updatedAt: now, createdAt: now, sourceId: pr.id, deleted: false };
        S.pres.unshift(np); audit(user.id, 'presentation.duplicate', 'presentation', id, { from: pr.id }); return send(res, 201, meta(np));
      }
      if (sub === 'transfer' && m === 'POST') {
        if (!isAdmin) return fail(res, 403, 'forbidden', 'Somente administradores.');
        const to = S.users.get(String(body.toUserId || '')); if (!to || to.status !== 'active') return fail(res, 400, 'invalid_request', 'Pessoa inválida.', { fields: [{ path: 'toUserId', message: 'Escolha uma pessoa ativa.' }] });
        pr.ownerId = to.id; pr.updatedAt = new Date().toISOString(); audit(user.id, 'presentation.transfer', 'presentation', pr.id, { to: to.id }); return send(res, 200, meta(pr));
      }
      if (sub === 'share' && m === 'GET') { audit(user.id, 'presentation.share', 'presentation', pr.id); return send(res, 200, { url: `${origin}/visualizar/${pr.id}`, visibility: 'acervo' }); }
      if (sub === 'comments' && m === 'GET') {
        const items = S.comments.filter((c) => c.presentationId === pr.id && !c.deleted && (q.get('includeResolved') || !c.resolvedAt)).map((c) => commentOut(c, user, pr));
        return send(res, 200, { items });
      }
      if (sub === 'comments' && m === 'POST') {
        const b = String(body.body || '').trim();
        if (!b || b.length > 2000) return fail(res, 400, 'invalid_request', 'Comentário inválido.', { fields: [{ path: 'body', message: 'Entre 1 e 2000 caracteres.' }] });
        const c = { id: crypto.randomUUID(), presentationId: pr.id, slideIndex: Number.isInteger(body.slideIndex) ? body.slideIndex : null, authorId: user.id, body: b, createdAt: new Date().toISOString(), resolvedAt: null, deleted: false };
        S.comments.push(c); audit(user.id, 'comment.create', 'comment', c.id); return send(res, 201, commentOut(c, user, pr));
      }
      /* ---- interações (docs/API.md §6 + DELETE do contrato): dono/admin veem e apagam tudo; os demais, só as próprias ---- */
      if (sub === 'interactions' || sub === 'interactions.csv') {
        const kind = q.get('kind') || ''; const el = q.get('elementId') || '';
        if (kind && !INTER_KINDS.includes(kind)) return fail(res, 400, 'invalid_request', 'Dados inválidos.', { fields: [{ path: 'kind', message: 'Tipo inválido.' }] });
        if (el && !ELEMENT_RE.test(el)) return fail(res, 400, 'invalid_request', 'Dados inválidos.', { fields: [{ path: 'elementId', message: 'Identificador do elemento inválido.' }] });
        const mine = (x) => canEdit || x.userId === user.id;
        const match = (x) => x.presentationId === pr.id && mine(x) && (!kind || x.kind === kind) && (!el || x.elementId === el);
        if (sub === 'interactions' && m === 'GET') {
          const items = S.inter.filter(match).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((x) => ({ id: x.id, kind: x.kind, elementId: x.elementId, payload: x.payload, createdAt: x.createdAt, updatedAt: x.updatedAt, author: owner(x.userId), user: owner(x.userId) }));
          return send(res, 200, { items, truncated: false });
        }
        if (sub === 'interactions.csv' && m === 'GET') {
          if (!canEdit) return fail(res, 403, 'forbidden', 'Somente o dono da apresentação e os administradores exportam as respostas.');
          const k = kind || 'form_response';
          const rows = S.inter.filter((x) => x.presentationId === pr.id && x.kind === k && (!el || x.elementId === el)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          audit(user.id, 'interactions.export', 'presentation', pr.id, { kind: k, rows: rows.length });
          return send(res, 200, interactionsCsv(k, rows.map((x) => ({ ...x, userName: owner(x.userId).displayName }))), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${k === 'form_response' ? 'respostas' : k}-${pr.id.slice(0, 8)}.csv"`, 'Cache-Control': 'private, no-store' });
        }
        if (sub === 'interactions' && m === 'DELETE') {
          if (!ELEMENT_RE.test(el)) return fail(res, 400, 'invalid_request', 'Informe o elemento (elementId).', { fields: [{ path: 'elementId', message: 'Identificador do elemento inválido.' }] });
          const gone = S.inter.filter(match);
          S.inter = S.inter.filter((x) => !gone.includes(x));
          audit(user.id, 'interactions.delete', 'presentation', pr.id, { elementId: el, kind: kind || null, deleted: gone.length });
          return send(res, 200, { deleted: gone.length });
        }
        if (sub === 'interactions' && m === 'POST') {
          if (!INTER_KINDS.includes(body.kind) || !(body.elementId === '' ? body.kind === 'view' : ELEMENT_RE.test(String(body.elementId || ''))) || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return fail(res, 400, 'invalid_request', 'Dados inválidos.');
          const now2 = new Date().toISOString();
          const prev = ['board_state', 'vote_state'].includes(body.kind) && S.inter.find((x) => x.presentationId === pr.id && x.userId === user.id && x.kind === body.kind && x.elementId === body.elementId);
          if (prev) { prev.payload = body.payload; prev.updatedAt = now2; return send(res, 200, { id: prev.id, kind: prev.kind, elementId: prev.elementId, createdAt: prev.createdAt, updatedAt: now2 }); }
          const x = { id: crypto.randomUUID(), presentationId: pr.id, userId: user.id, kind: body.kind, elementId: body.elementId, payload: body.payload, createdAt: now2, updatedAt: now2 };
          S.inter.push(x); return send(res, 201, { id: x.id, kind: x.kind, elementId: x.elementId, createdAt: now2, updatedAt: now2 });
        }
      }
      return fail(res, 404, 'not_found', 'Rota não encontrada.');
    }
    mt = p.match(/^\/api\/comments\/([0-9a-f-]{36})$/);
    if (mt) {
      const c = S.comments.find((x) => x.id === mt[1] && !x.deleted); if (!c) return fail(res, 404, 'not_found', 'Comentário não encontrado.');
      const pr = S.pres.find((x) => x.id === c.presentationId);
      const mayModerate = c.authorId === user.id || pr.ownerId === user.id || isAdmin;
      if (!mayModerate) return fail(res, 403, 'forbidden', 'Sem permissão.');
      if (m === 'PATCH') { if (typeof body.resolved === 'boolean') c.resolvedAt = body.resolved ? new Date().toISOString() : null; return send(res, 200, commentOut(c, user, pr)); }
      if (m === 'DELETE') { c.deleted = true; audit(user.id, 'comment.delete', 'comment', c.id); return send(res, 204); }
    }

    /* ---- arquivos ---- */
    if (p === '/api/assets/check' && m === 'POST') {
      const shas = Array.isArray(body.shas) ? body.shas : [];
      if (shas.length > 200 || shas.some((s) => !/^[0-9a-f]{64}$/.test(s))) return fail(res, 400, 'invalid_request', 'Lista de hashes inválida.');
      S.checks = (S.checks || 0) + 1;
      return send(res, 200, { missing: shas.filter((s) => !S.assets.get(s)?.owners?.has(user.id)) });
    }
    mt = p.match(/^\/api\/assets\/([0-9a-f]{64})$/);
    if (mt && m === 'PUT') {
      if (raw.length > 4 * 1024 * 1024) return fail(res, 413, 'too_large', 'Corpo acima de 4 MB.');
      if (sha256(raw) !== mt[1]) return fail(res, 400, 'invalid_request', 'O SHA-256 não confere com o conteúdo.');
      const mime = sniff(raw); if (!mime) return fail(res, 415, 'unsupported_media', 'Tipo de arquivo não aceito.');
      const had = S.assets.has(mt[1]);
      const rec = S.assets.get(mt[1]) || { bytes: raw, mime, size: raw.length, owners: new Set() }; (rec.owners ||= new Set()).add(user.id); S.assets.set(mt[1], rec);
      S.uploads.push({ sha: mt[1], size: raw.length, kind: req.headers['x-asset-kind'], dedup: had });
      return send(res, had ? 200 : 201, { sha256: mt[1], size: raw.length, mime, deduplicated: had });
    }
    if (mt && m === 'GET') {
      const a = S.assets.get(mt[1]); if (!a) return fail(res, 404, 'not_found', 'Arquivo não encontrado.');
      return send(res, 200, a.bytes, { 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    }

    /* ---- administração (formato do src/routes/admin.js) ---- */
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin) return fail(res, 403, 'forbidden', 'Somente administradores.');
      const bad = (message, fields) => fail(res, 400, 'invalid_request', message, fields ? { fields } : undefined);
      if (p === '/api/admin/users' && m === 'GET') {
        const term = (q.get('q') || '').toLowerCase(); const st = q.get('status') || ''; const limit = Math.min(100, Math.max(1, Number(q.get('limit') || 30)));
        if (st && !['invited', 'active', 'suspended'].includes(st)) return bad('Dados inválidos.', [{ path: 'status', message: 'Status inválido.' }]);
        const all = [...S.users.values()].filter((u) => (!st || u.status === st) && (!term || u.email.includes(term) || u.displayName.toLowerCase().includes(term)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const off = q.get('cursor') ? Number(Buffer.from(q.get('cursor'), 'base64url').toString()) || 0 : 0;
        const items = all.slice(off, off + limit).map((u) => {
          const inv = [...S.invites.values()].filter((i) => i.userId === u.id).pop();
          return { ...pub(u), createdAt: u.createdAt, activatedAt: u.activatedAt ?? null, lastLoginAt: u.lastLoginAt, presentationCount: S.pres.filter((x) => x.ownerId === u.id && !x.deleted).length,
            invite: inv ? { id: inv.id, status: inv.status, expiresAt: inv.expiresAt, resentCount: inv.resent || 0 } : null };
        });
        return send(res, 200, { items, nextCursor: off + limit < all.length ? Buffer.from(String(off + limit)).toString('base64url') : null });
      }
      if (p === '/api/admin/invites' && m === 'POST') {
        const email = String(body.email || '').trim().toLowerCase(); const name = String(body.displayName || '').trim();
        const fields = [];
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.push({ path: 'email', message: 'E-mail inválido.' });
        if (name.length < 1) fields.push({ path: 'displayName', message: 'Informe o nome.' });
        if (/[<>]/.test(name)) fields.push({ path: 'displayName', message: 'Nome contém caracteres não permitidos.' });
        if (fields.length) return bad('Dados inválidos.', fields);
        if (email.endsWith('@blocked.test')) return bad('Este domínio de e-mail não está autorizado a receber convites.', [{ path: 'email', message: 'Domínio não permitido.' }]);
        const role = body.role === 'admin' ? 'admin' : 'member';
        const ex = [...S.users.values()].find((u) => u.email === email);
        const expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
        let uid;
        if (ex) {
          if (ex.activatedAt || !['invited', 'suspended'].includes(ex.status)) return fail(res, 409, 'already_exists', 'Já existe um usuário com este e-mail.');
          if ([...S.invites.values()].some((i) => i.userId === ex.id && i.status === 'pending')) return fail(res, 409, 'already_exists', 'Já existe um convite pendente para este e-mail. Reenvie-o.');
          ex.status = 'invited'; ex.role = role; ex.displayName = name; uid = ex.id;
        } else {
          uid = crypto.randomUUID();
          S.users.set(uid, { id: uid, email, displayName: name, role, status: 'invited', password: null, createdAt: new Date().toISOString(), lastLoginAt: null, activatedAt: null });
        }
        const id = crypto.randomUUID();
        S.invites.set(id, { id, email, userId: uid, status: 'pending', expiresAt, resent: 0 }); audit(user.id, 'invite.create', 'invite', id, { role, user_id: uid });
        return send(res, 201, { id, userId: uid, email, status: 'pending', role, expiresAt });
      }
      mt = p.match(/^\/api\/admin\/invites\/([0-9a-f-]{36})(\/resend)?$/);
      if (mt) {
        const inv = S.invites.get(mt[1]); if (!inv) return fail(res, 404, 'not_found', 'Não encontrado.');
        if (mt[2] && m === 'POST') {
          if (!['pending', 'expired'].includes(inv.status)) return fail(res, 409, 'conflict', 'Este convite não pode ser reenviado.');
          if ((inv.resent || 0) >= 5) return fail(res, 409, 'conflict', 'Limite de 5 reenvios atingido para este convite.');
          inv.resent = (inv.resent || 0) + 1; inv.expiresAt = new Date(Date.now() + 7 * 864e5).toISOString(); audit(user.id, 'invite.resend', 'invite', inv.id, { resent_count: inv.resent });
          return send(res, 200, { id: inv.id, status: 'pending', resentCount: inv.resent, expiresAt: inv.expiresAt });
        }
        if (!mt[2] && m === 'DELETE') {
          if (inv.status === 'accepted') return fail(res, 409, 'conflict', 'Este convite já foi aceito e não pode ser revogado. Suspenda o usuário.');
          inv.status = 'revoked'; const u = S.users.get(inv.userId); if (u && u.status === 'invited') u.status = 'suspended'; // como o servidor real: fica suspenso (nunca entrou)
          audit(user.id, 'invite.revoke', 'invite', inv.id, { user_id: inv.userId }); return send(res, 204);
        }
      }
      mt = p.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
      if (mt && m === 'PATCH') {
        const u = S.users.get(mt[1]); if (!u) return fail(res, 404, 'not_found', 'Não encontrado.');
        if (body.status && body.status !== u.status) {
          if (u.id === user.id) return fail(res, 409, 'conflict', 'Você não pode suspender ou reativar a si mesmo.');
          if (body.status === 'active' && !u.activatedAt) return fail(res, 409, 'conflict', 'Este usuário ainda não aceitou o convite. Reenvie o convite em vez de reativar.');
        }
        const admins = [...S.users.values()].filter((x) => x.role === 'admin' && x.status === 'active');
        if (u.role === 'admin' && u.status === 'active' && ((body.role && body.role !== 'admin') || (body.status && body.status !== 'active')) && !admins.some((a) => a.id !== u.id)) return fail(res, 409, 'conflict', 'Não é possível remover o último administrador ativo.');
        if (body.role) u.role = body.role; if (body.status) u.status = body.status; if (body.displayName) u.displayName = body.displayName;
        if (body.status === 'suspended') for (const [k, v] of S.at) if (v.userId === u.id) S.at.delete(k);
        audit(user.id, 'user.update', 'user', u.id, { fields: Object.keys(body) }); return send(res, 200, { ...pub(u), gotrueSync: true });
      }
      if (p === '/api/admin/audit' && m === 'GET') {
        const act = q.get('action') || '';
        const list = S.audit.filter((a) => (!q.get('actor') || a.actorId === q.get('actor')) && (!act || (act.endsWith('*') ? a.action.startsWith(act.slice(0, -1)) : a.action === act)) && (!q.get('from') || a.at >= q.get('from')) && (!q.get('to') || a.at < q.get('to')));
        const limit = Math.min(100, Number(q.get('limit') || 30)); const off = q.get('cursor') ? Number(q.get('cursor')) : 0;
        const items = list.slice(off, off + limit).map((a) => ({ id: String(a.id), at: a.at, actor: a.actorId ? owner(a.actorId) : null, action: a.action, entityType: a.entityType, entityId: a.entityId, ip: a.ip, userAgent: 'Mozilla/5.0 (teste)', requestId: `req-${a.id}`, meta: a.meta }));
        return send(res, 200, { items, nextCursor: off + limit < list.length ? String(off + limit) : null });
      }
      if (p === '/api/admin/settings' && m === 'GET') return send(res, 200, { items: [...S.settings].map(([key, v]) => ({ key, value: v.value, updatedAt: v.updatedAt })) });
      mt = p.match(/^\/api\/admin\/settings\/([a-z0-9_.-]+)$/);
      if (mt && m === 'PUT') {
        const RULES = { 'acervo.visibility': (v) => v === 'all_members', 'versions.keep_last': (v) => Number.isInteger(v) && v >= 1 && v <= 500, 'versions.keep_daily_days': (v) => Number.isInteger(v) && v >= 1 && v <= 365, 'uploads.max_bytes': (v) => Number.isInteger(v) && v >= 1048576 && v <= 524288000, 'invites.ttl_days': (v) => Number.isInteger(v) && v >= 1 && v <= 30 };
        if (!RULES[mt[1]]) return fail(res, 404, 'not_found', 'Configuração desconhecida.');
        if (!RULES[mt[1]](body.value)) return bad('Valor inválido para esta configuração.', [{ path: 'value', message: 'Valor fora da faixa permitida.' }]);
        S.settings.set(mt[1], { value: body.value, updatedAt: new Date().toISOString() }); audit(user.id, 'settings.update', 'setting', mt[1], { value: body.value });
        return send(res, 200, { key: mt[1], value: body.value, updatedAt: S.settings.get(mt[1]).updatedAt });
      }
      if (p === '/api/admin/stats' && m === 'GET') {
        const us = [...S.users.values()];
        return send(res, 200, { users: { total: us.length, active: us.filter((u) => u.status === 'active').length, invited: us.filter((u) => u.status === 'invited').length, suspended: us.filter((u) => u.status === 'suspended').length, admins: us.filter((u) => u.role === 'admin' && u.status === 'active').length },
          presentations: { live: S.pres.filter((x) => !x.deleted).length, trashed: S.pres.filter((x) => x.deleted).length }, assets: { count: S.assets.size, bytes: [...S.assets.values()].reduce((a, x) => a + x.size, 0) }, invites: { pending: [...S.invites.values()].filter((i) => i.status === 'pending').length } });
      }
    }
    return fail(res, 404, 'not_found', 'Rota não encontrada.');
  }
  function commentOut(c, user, pr) {
    const may = c.authorId === user.id || pr.ownerId === user.id || user.role === 'admin';
    return { id: c.id, slideIndex: c.slideIndex, body: c.body, author: owner(c.authorId), createdAt: c.createdAt, editedAt: null, resolvedAt: c.resolvedAt, canDelete: may, canResolve: may };
  }

  /* ───────── páginas estáticas ───────── */
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
  const PAGES = { '/': 'index.html', '/entrar': 'entrar/index.html', '/auth/confirmar': 'auth/confirmar/index.html', '/esqueci-senha': 'esqueci-senha/index.html', '/acervo': 'acervo/index.html', '/admin': 'admin/index.html', '/importar': 'importar/index.html' };
  const pageHeaders = (type) => ({ 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' });
  function stub(title) { return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1 id="stub">${title}</h1><p><a href="/acervo">Voltar ao acervo</a></p></main></body></html>`; }

  async function handle(req, res) {
    res.reqId = rid();
    const url = new URL(req.url, origin || 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    try {
      if (p.startsWith('/__test/')) return await testHooks(req, res, url);
      if (p.startsWith('/api/')) return await api(req, res, url);
      if (PAGES[p] || PAGES[p.replace(/\/$/, '')]) { const f = path.join(WEB, PAGES[p] || PAGES[p.replace(/\/$/, '')]); res.writeHead(200, pageHeaders(MIME['.html'])); return res.end(fs.readFileSync(f)); }
      if (/^\/(editor|visualizar)\/[0-9a-f-]{36}$/.test(p)) { res.writeHead(200, pageHeaders(MIME['.html'])); return res.end(stub(p.startsWith('/editor') ? 'Editor (simulado)' : 'Visualizar (simulado)')); }
      if (p === '/js/cloud-core.js') { const f = useReal ? REAL_CORE : STUB_CORE; res.writeHead(200, { ...pageHeaders(MIME['.js']), 'X-Cloud-Core': f === REAL_CORE ? 'real' : 'stub' }); return res.end(fs.readFileSync(f)); }
      const roots = p.startsWith('/assets/brand/') ? [BRAND, p.slice('/assets/brand/'.length)] : ['css', 'js', 'assets'].includes(p.split('/')[1]) ? [WEB, p.slice(1)] : null;
      if (roots) {
        const f = path.resolve(roots[0], roots[1]);
        if (f.startsWith(roots[0] + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(f)); }
      }
      res.writeHead(404, pageHeaders(MIME['.html'])); return res.end(fs.readFileSync(path.join(WEB, '404.html')));
    } catch (e) {
      S.mockErrors = (S.mockErrors || 0) + 1; console.error('mock-api: exceção interna', e);
      if (!res.headersSent) fail(res, 500, 'internal', `Erro no mock: ${e.message}`); else res.end();
    }
  }

  async function testHooks(req, res, url) {
    const p = url.pathname;
    if (p === '/__test/reset') { seed(); return send(res, 200, { ok: true }); }
    if (p === '/__test/expire-access') { for (const v of S.at.values()) v.exp = 0; return send(res, 200, { ok: true }); }
    if (p === '/__test/kill-sessions') { S.at.clear(); S.rt.clear(); return send(res, 200, { ok: true }); }
    if (p === '/__test/refresh-fails') { S.refreshFails = url.searchParams.get('on') === '1'; return send(res, 200, { ok: true }); }
    if (p === '/__test/state') {
      return send(res, 200, { mockErrors: S.mockErrors || 0, refreshCount: S.refreshCount, csrfBlocked: S.csrfBlocked, requests: S.requests, created: S.created.map((c) => ({ id: c.id, source: c.source, title: c.title, hasDataUrl: /data:image\//.test(JSON.stringify(c.content || {})), content: c.content })), uploads: S.uploads, checks: S.checks || 0, forgot: S.forgot || [],
        interactions: S.inter.map((x) => ({ id: x.id, presentationId: x.presentationId, kind: x.kind, elementId: x.elementId, userId: x.userId })),
        presentations: S.pres.map((x) => ({ id: x.id, title: x.title, ownerId: x.ownerId, deleted: x.deleted })), users: [...S.users.values()].map((u) => ({ id: u.id, displayName: u.displayName, status: u.status })), assets: S.assets.size, audit: S.audit.slice(0, 10).map((a) => a.action) });
    }
    if (p === '/__test/more-users') { const n = Number(url.searchParams.get('n') || 60); for (let i = 0; i < n; i++) { const id = crypto.randomUUID(); S.users.set(id, { id, email: `extra${i}@am.test`, displayName: `Extra ${String(i).padStart(2, '0')}`, role: 'member', status: 'active', password: PASSWORD, createdAt: new Date(Date.now() - (100 + i) * 864e5).toISOString(), activatedAt: new Date().toISOString(), lastLoginAt: null }); } return send(res, 200, { ok: true }); }
    if (p === '/__test/clear-requests') { S.requests.length = 0; return send(res, 200, { ok: true }); }
    if (p === '/__test/link-token') { S.linkTokens.set(url.searchParams.get('t'), { type: url.searchParams.get('type'), userId: IDS[url.searchParams.get('u')], used: false }); return send(res, 200, { ok: true }); }
    return send(res, 404, { ok: false });
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, port: server.address().port, cloudCore,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    reset: seed,
    get state() { return S; },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4201);
  const m = await startMock({ port });
  console.log(`mock-api em ${m.origin} (cloud-core: ${m.cloudCore})`);
}
