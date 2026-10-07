/* Servidor mock do Canteiro online (em memória) para os testes do editor em nuvem.
   Segue platform/docs/API.md: cookies (am_at/am_rt/am_csrf no modo local), CSRF (cabeçalho + cookie + Origin), erros no formato do contrato,
   revisão otimista (409), versões, arquivos endereçados por conteúdo (check/put/get com "prova de posse" por usuário), interações (com clientId,
   tetos por tipo e DELETE), comentários, preferências da pessoa (/api/me/prefs), sair, duplicar, compartilhar. Também serve o site de
   platform/dist/public com a CSP de dist/csp.json (rewrites /editor/:uuid e /visualizar/:uuid; sem UUID → /acervo, como src/static.js).
   Ganchos de teste (fora do contrato, só aqui): /__test/login, /__test/logout, /__test/expire, /__test/seed, /__test/bump, /__test/faults,
   /__test/requests, /__test/state, /__test/reset, /__test/comment, /__test/prefs, /__test/inerte (o editor fora de /editor/<uuid>).
   Uso:  node tests/cloud/mock-api.js [porta=4202]     ou     import { startMock } from './mock-api.js' */
import http from 'node:http';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cspFor, readCspJson, SECURITY_HEADERS, COMMON_CSP } from '../../tools/csp.js';
import { editorWithoutId } from '../../src/static.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = path.resolve(here, '../..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

let canonical = null;
async function loadCanonical() {
  if (canonical) return canonical;
  try { const m = await import(pathToFileURL(path.join(PLATFORM, 'src/lib/canonical.js')).href); canonical = (v) => m.canonicalize(v); } catch { /* sem o módulo do servidor: usa o do cloud-core */ }
  if (!canonical) { const cc = (await import(pathToFileURL(path.join(PLATFORM, 'studio-cloud/cloud-core.js')).href)).default; canonical = (v) => cc.canonicalJSON(v); }
  return canonical;
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

class ApiError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; } }

function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length > 11 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function startMock({ port = 0, distDir = path.join(PLATFORM, 'dist', 'public'), cspFile = path.join(PLATFORM, 'dist', 'csp.json'), host = '127.0.0.1', stripUpgradeInsecure = false } = {}) {
  const canon = await loadCanonical();
  const hashOf = (content) => sha256(canon(content));
  let appOrigin = '';
  const S = {};
  function reset() {
    S.users = {
      ana: { id: randomUUID(), email: 'ana@example.com', displayName: 'Ana Dona', role: 'member', status: 'active' },
      bia: { id: randomUUID(), email: 'bia@example.com', displayName: 'Bia Outra', role: 'member', status: 'active' },
      adm: { id: randomUUID(), email: 'adm@example.com', displayName: 'Admin A&M', role: 'admin', status: 'active' }
    };
    S.tokens = new Map(); /* access/refresh → {userId, kind, valid, csrf} */
    S.pres = new Map(); S.assets = new Map(); S.owned = new Map(); S.interactions = []; S.log = []; S.comments = []; S.prefs = new Map();
    S.faults = { put5xx: 0, putDelayMs: 0, assetPut5xx: 0, assetPut429: 0, refreshFails: false, versionIntervalMs: 10 * 60 * 1000, getDelayMs: 0, presDelayMs: 0, interactions5xx: 0, interactionsLoseResponse: 0, noPrefs: false };
    S.counters = { puts: 0, assetPuts: 0, assetChecks: 0 };
  }
  reset();
  const byId = (id) => Object.values(S.users).find((u) => u.id === id);
  const pub = (u) => ({ id: u.id, displayName: u.displayName });

  /* ---------- cookies / sessão ---------- */
  function cookies(req) { const o = {}; String(req.headers.cookie || '').split(/;\s*/).forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); }); return o; }
  function issue(user, res) {
    const at = 'at_' + randomBytes(12).toString('hex'), rt = 'rt_' + randomBytes(12).toString('hex'), csrf = randomBytes(32).toString('hex');
    S.tokens.set(at, { userId: user.id, kind: 'at', valid: true }); S.tokens.set(rt, { userId: user.id, kind: 'rt', valid: true });
    const c = [`am_at=${at}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`, `am_rt=${rt}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, `am_csrf=${csrf}; Path=/; SameSite=Lax; Max-Age=2592000`];
    res.setHeader('Set-Cookie', c); return { at, rt, csrf };
  }
  function whoAmI(req, { optional = false } = {}) {
    const ck = cookies(req), t = ck.am_at && S.tokens.get(ck.am_at);
    if (!t) { if (optional) return null; throw new ApiError(401, 'unauthenticated', 'Entre para continuar.'); }
    if (!t.valid) { if (optional) return null; throw new ApiError(401, 'session_expired', 'Sua sessão expirou. Entre de novo.'); }
    const u = byId(t.userId); if (!u) throw new ApiError(401, 'unauthenticated', 'Entre para continuar.');
    return u;
  }
  function csrfCheck(req) {
    const ck = cookies(req), h = req.headers['x-csrf-token'];
    if (!h || !ck.am_csrf || h !== ck.am_csrf) throw new ApiError(403, 'csrf', 'Requisição recusada (proteção CSRF). Recarregue a página.');
    const origin = req.headers.origin, sfs = req.headers['sec-fetch-site'];
    if (origin ? origin !== appOrigin : sfs !== 'same-origin') throw new ApiError(403, 'csrf', 'Origem não permitida.');
  }
  const canEdit = (u, p) => p.owner === u.id || u.role === 'admin';

  /* ---------- apresentações ---------- */
  function blankDeck(id, title) { return { v: 1, app: 'AM Studio', id, title, slides: [{ id: 's' + randomBytes(3).toString('hex'), bg: '#FFFFFF', tr: 'fade', els: [] }] }; }
  /* motivo de recusa de um trecho (como src/lib/deck-lint.js: entidades decodificadas também contam) */
  const reasonOf = (txt) => {
    const t = txt.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
    if (/data:image\/svg/i.test(t)) return 'svg_embutido';
    if (/"data:image\/(?!(?:png|jpeg|webp|gif)[;,])/i.test(t)) return 'url_perigosa';
    if (/<\s*(script|iframe|form|object|embed)\b/i.test(t)) return 'tag_perigosa';
    if (/javascript:/i.test(t)) return 'url_perigosa';
    return null;
  };
  function lint(content) {
    const s = JSON.stringify(content);
    if (s.length > 12 * 1024 * 1024) throw new ApiError(413, 'too_large', 'A apresentação é grande demais.');
    if (/data:image\/(png|jpeg|webp|gif);base64,/i.test(s)) throw new ApiError(422, 'rejected_content', 'As imagens precisam ser enviadas como arquivos (asset:sha256:…).', { reason: 'inline_image' });
    if (reasonOf(s)) {
      const issues = [];
      (content.slides || []).forEach((sl, i) => {
        (sl.els || []).forEach((e) => { const r = reasonOf(JSON.stringify(e)); if (r && issues.length < 20) issues.push({ slide: i + 1, elementId: e.id || null, reason: r }); });
        const rest = { ...sl, els: undefined }, r = reasonOf(JSON.stringify(rest)); if (r && issues.length < 20) issues.push({ slide: i + 1, elementId: null, reason: r });
      });
      const top = { ...content, slides: undefined }, rt = reasonOf(JSON.stringify(top)); if (rt && issues.length < 20) issues.push({ slide: null, elementId: null, reason: rt });
      throw new ApiError(422, 'rejected_content', 'Conteúdo recusado por segurança.', { reasons: [...new Set(issues.map((x) => x.reason))], issues });
    }
    const missing = new Set(); let m; const re = /asset:sha256:([0-9a-f]{64})/g;
    while ((m = re.exec(s))) if (!S.assets.has(m[1])) missing.add(m[1]);
    if (missing.size) throw new ApiError(422, 'rejected_content', 'Há imagens que não estão no servidor.', { reason: 'missing_assets', missing: [...missing] });
  }
  const meta = (p) => ({ id: p.id, title: p.title, slideCount: (p.content.slides || []).length, rev: p.rev, owner: pub(byId(p.owner) || { id: p.owner, displayName: '?' }), updatedAt: p.updatedAt, createdAt: p.createdAt, thumbSha: p.thumbSha || null, sourceId: p.sourceId || null, deleted: !!p.deleted });
  function addVersion(p, kind, label, by) {
    const no = (p.versions.at(-1)?.no || 0) + 1;
    p.versions.push({ no, kind, label: label || null, createdAt: new Date().toISOString(), createdBy: pub(byId(by) || { id: by, displayName: '?' }), slideCount: (p.content.slides || []).length, title: p.title, content: structuredClone(p.content) });
    p.lastVersionAt = Date.now(); return no;
  }
  function create(user, { title, content, source, sourceId }) {
    const id = randomUUID(), now = new Date().toISOString();
    const c = content ? structuredClone(content) : blankDeck(id, title || 'Nova apresentação'); if (content) lint(c);
    const p = { id, owner: user.id, title: (title || c.title || 'Apresentação').slice(0, 300), content: c, rev: 1, createdAt: now, updatedAt: now, updatedBy: user.id, versions: [], thumbSha: null, sourceId: sourceId || null, deleted: false, lastVersionAt: 0 };
    p.content.title = p.title; S.pres.set(id, p); p.hash = hashOf(p.content);
    addVersion(p, sourceId ? 'copy' : source === 'import' ? 'import' : 'create', null, user.id);
    return p;
  }
  function getP(id) { const p = UUID.test(id) && S.pres.get(id.toLowerCase()); if (!p) throw new ApiError(404, 'not_found', 'Apresentação não encontrada.'); return p; }

  /* ---------- roteador ---------- */
  async function api(req, res, url, body, user0) {
    const m = req.method, p = url.pathname.replace(/^\/api/, '') || '/', seg = p.split('/').filter(Boolean);
    const json = (status, obj, headers) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(headers || {}) }); res.end(JSON.stringify(obj)); };
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') csrfCheck(req);
    if (p === '/health') return json(200, { ok: true, version: 'mock', env: 'test' });
    if (p === '/auth/session' && m === 'GET') {
      const ck = cookies(req); let csrf = ck.am_csrf; const u = whoAmIQuiet(req);
      if (!csrf) { csrf = randomBytes(32).toString('hex'); res.setHeader('Set-Cookie', `am_csrf=${csrf}; Path=/; SameSite=Lax`); }
      return u ? json(200, { authenticated: true, csrfToken: csrf, user: { id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status }, needsPassword: false }) : json(200, { authenticated: false, csrfToken: csrf });
    }
    if (p === '/auth/refresh' && m === 'POST') {
      const ck = cookies(req), t = ck.am_rt && S.tokens.get(ck.am_rt);
      if (S.faults.refreshFails || !t || !t.valid) throw new ApiError(401, 'session_expired', 'Sua sessão expirou. Entre de novo.');
      const u = byId(t.userId); const old = ck.am_at && S.tokens.get(ck.am_at); if (old) old.valid = false; t.valid = false;
      issue(u, res); return json(200, { authenticated: true, user: { id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status }, needsPassword: false });
    }
    if (p === '/auth/logout' && m === 'POST') {
      const ck = cookies(req); for (const t of [ck.am_at, ck.am_rt]) { const x = t && S.tokens.get(t); if (x) x.valid = false; }
      res.writeHead(204, { 'Set-Cookie': ['am_at=; Path=/; Max-Age=0', 'am_rt=; Path=/; Max-Age=0'], 'Cache-Control': 'no-store' }); return res.end();
    }
    const user = user0 || whoAmI(req);
    if (S.faults.getDelayMs && m === 'GET') await new Promise((r) => setTimeout(r, S.faults.getDelayMs));
    if (S.faults.presDelayMs && m === 'GET' && /^\/presentations\/[^/]+$/.test(p)) await new Promise((r) => setTimeout(r, S.faults.presDelayMs));

    /* ----- preferências da pessoa (contrato: {prefs} ≤ 64 KB, profundidade ≤ 10; só a própria pessoa) ----- */
    if (p === '/me/prefs') {
      if (S.faults.noPrefs) throw new ApiError(404, 'not_found', 'Rota inexistente.');
      if (m === 'GET') return json(200, { prefs: S.prefs.get(user.id) || {} });
      if (m === 'PUT') {
        const pr = body && body.prefs;
        const depth = (v, d = 0) => (v && typeof v === 'object' ? Math.max(d + 1, ...Object.values(v).map((x) => depth(x, d + 1))) : d);
        if (!pr || typeof pr !== 'object' || Array.isArray(pr) || depth(pr) > 10) throw new ApiError(400, 'invalid_request', 'Preferências inválidas.');
        if (Buffer.byteLength(JSON.stringify(pr)) > 64 * 1024) throw new ApiError(413, 'too_large', 'Preferências grandes demais.');
        S.prefs.set(user.id, structuredClone(pr)); return json(200, { prefs: pr });
      }
    }
    /* ----- comentários (docs/API.md §6) ----- */
    if (seg[0] === 'comments' && seg[1]) {
      const c = S.comments.find((x) => x.id === seg[1] && !x.deleted); if (!c) throw new ApiError(404, 'not_found', 'Comentário não encontrado.');
      const pr = getP(c.presentationId), mod = canEdit(user, pr);
      if (m === 'PATCH') {
        if (typeof body?.resolved === 'boolean') { if (!(c.authorId === user.id || mod)) throw new ApiError(403, 'forbidden', 'Sem permissão.'); c.resolvedAt = body.resolved ? new Date().toISOString() : null; }
        if (typeof body?.body === 'string') { if (c.authorId !== user.id) throw new ApiError(403, 'forbidden', 'Só o autor edita.'); c.body = body.body; c.editedAt = new Date().toISOString(); }
        return json(200, commentOut(c, user, mod));
      }
      if (m === 'DELETE') { if (!(c.authorId === user.id || mod)) throw new ApiError(403, 'forbidden', 'Sem permissão.'); c.deleted = true; res.writeHead(204); return res.end(); }
    }

    /* ----- arquivos ----- */
    if (p === '/assets/check' && m === 'POST') {
      S.counters.assetChecks++;
      const shas = body?.shas; if (!Array.isArray(shas) || shas.length > 200 || shas.some((s) => !/^[0-9a-f]{64}$/.test(s))) throw new ApiError(400, 'invalid_request', 'Lista de hashes inválida.');
      const mine = S.owned.get(user.id) || new Set();
      return json(200, { missing: shas.filter((s) => !S.assets.has(s) || !mine.has(s)) });
    }
    if (seg[0] === 'assets' && seg[1] && /^[0-9a-f]{64}$/.test(seg[1])) {
      const sha = seg[1];
      if (m === 'PUT') {
        S.counters.assetPuts++;
        if (S.faults.assetPut5xx > 0) { S.faults.assetPut5xx--; throw new ApiError(503, 'unavailable', 'Armazenamento indisponível.'); }
        if (S.faults.assetPut429 > 0) { S.faults.assetPut429--; throw new ApiError(429, 'rate_limited', 'Muitos envios. Tente de novo em instantes.'); }
        if (body.length > 4 * 1024 * 1024) throw new ApiError(413, 'too_large', 'Arquivo grande demais para este envio.');
        if (sha256(body) !== sha) throw new ApiError(400, 'invalid_request', 'O hash não confere com o conteúdo.');
        const mime = sniff(body); if (!mime) throw new ApiError(415, 'unsupported_media', 'Tipo de arquivo não aceito.');
        const dedup = S.assets.has(sha);
        if (!dedup) S.assets.set(sha, { bytes: Buffer.from(body), mime, kind: req.headers['x-asset-kind'] || 'image', size: body.length });
        if (!S.owned.has(user.id)) S.owned.set(user.id, new Set()); S.owned.get(user.id).add(sha);
        return json(dedup ? 200 : 201, { sha256: sha, size: body.length, mime, deduplicated: dedup });
      }
      if (m === 'GET') {
        const a = S.assets.get(sha); if (!a) throw new ApiError(404, 'not_found', 'Arquivo não encontrado.');
        res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': a.bytes.length, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline' });
        return res.end(a.bytes);
      }
    }
    /* ----- apresentações ----- */
    if (seg[0] === 'presentations') {
      if (seg.length === 1 && m === 'GET') {
        const scope = url.searchParams.get('scope') || 'all';
        const items = [...S.pres.values()].filter((p2) => (scope === 'trash' ? p2.deleted && p2.owner === user.id : !p2.deleted && (scope !== 'mine' || p2.owner === user.id))).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(meta);
        return json(200, { items, nextCursor: null });
      }
      if (seg.length === 1 && m === 'POST') {
        const pr = create(user, { title: body?.title, content: body?.content, source: body?.source }); return json(201, { ...meta(pr) });
      }
      const pr = getP(seg[1]);
      if (seg.length === 2) {
        if (m === 'GET') return json(200, { ...meta(pr), content: pr.content, canEdit: canEdit(user, pr) }, { ETag: `"${pr.rev}"` });
        if (m === 'PATCH') { if (!canEdit(user, pr)) throw new ApiError(403, 'forbidden', 'Só o dono pode alterar.'); if (typeof body?.title !== 'string' || !body.title.trim()) throw new ApiError(400, 'invalid_request', 'Título inválido.', { fields: { title: 'obrigatório' } }); pr.title = body.title.slice(0, 300); pr.content.title = pr.title; pr.rev++; pr.hash = hashOf(pr.content); pr.updatedAt = new Date().toISOString(); pr.updatedBy = user.id; return json(200, meta(pr)); }
        if (m === 'DELETE') { if (!canEdit(user, pr)) throw new ApiError(403, 'forbidden', 'Só o dono pode excluir.'); pr.deleted = true; res.writeHead(204); return res.end(); }
      }
      if (seg[2] === 'content' && m === 'PUT') {
        if (!canEdit(user, pr)) throw new ApiError(403, 'forbidden', 'Somente o dono pode alterar esta apresentação. Crie uma cópia para usar.');
        S.counters.puts++;
        if (S.faults.putDelayMs) await new Promise((r) => setTimeout(r, S.faults.putDelayMs));
        if (S.faults.put5xx > 0) { S.faults.put5xx--; throw new ApiError(503, 'unavailable', 'Serviço indisponível. Tente de novo.'); }
        const { baseRev, content, snapshot, label, resolution, thumbSha } = body || {};
        if (!Number.isInteger(baseRev) || !content || typeof content !== 'object') throw new ApiError(400, 'invalid_request', 'Corpo inválido.', { fields: { baseRev: 'inteiro', content: 'objeto' } });
        const overwrite = resolution === 'overwrite' && baseRev === pr.rev;
        if (baseRev !== pr.rev) throw new ApiError(409, 'conflict', 'A apresentação foi alterada em outro lugar.', { serverRev: pr.rev, updatedBy: pub(byId(pr.updatedBy) || { id: pr.updatedBy, displayName: '?' }), updatedAt: pr.updatedAt });
        lint(content);
        if (thumbSha && !S.assets.has(thumbSha)) throw new ApiError(422, 'rejected_content', 'Miniatura inexistente.', { reason: 'missing_assets', missing: [thumbSha] });
        const h = hashOf(content);
        if (h === pr.hash && !snapshot && !thumbSha) return json(200, { rev: pr.rev, savedAt: pr.updatedAt, hash: h, unchanged: true });
        const changed = h !== pr.hash; let snapshotNo;
        if (changed && overwrite) addVersion(pr, 'pre_overwrite', null, user.id);
        if (changed) { pr.content = structuredClone(content); pr.title = String(content.title || pr.title).slice(0, 300); pr.rev++; pr.hash = h; pr.updatedAt = new Date().toISOString(); pr.updatedBy = user.id; }
        if (thumbSha) pr.thumbSha = thumbSha;
        if (snapshot) snapshotNo = addVersion(pr, 'manual', typeof label === 'string' ? label.slice(0, 80) : null, user.id);
        else if (changed && Date.now() - pr.lastVersionAt >= S.faults.versionIntervalMs) addVersion(pr, 'auto', null, user.id);
        return json(200, { rev: pr.rev, savedAt: pr.updatedAt, hash: pr.hash, unchanged: !changed, ...(snapshotNo ? { snapshotNo } : {}) });
      }
      if (seg[2] === 'duplicate' && m === 'POST') {
        const c = structuredClone(pr.content); const np = create(user, { title: body?.title || (pr.title + ' (cópia)'), content: c, sourceId: pr.id }); np.content.id = np.id; np.hash = hashOf(np.content); return json(201, meta(np));
      }
      if (seg[2] === 'share' && m === 'GET') return json(200, { url: `${appOrigin}/visualizar/${pr.id}`, visibility: 'acervo' });
      if (seg[2] === 'versions') {
        if (!canEdit(user, pr)) throw new ApiError(403, 'forbidden', 'Somente o dono vê o histórico.');
        if (seg.length === 3 && m === 'GET') return json(200, { items: [...pr.versions].reverse().map((v) => ({ no: v.no, kind: v.kind, label: v.label, createdAt: v.createdAt, createdBy: v.createdBy, slideCount: v.slideCount, title: v.title })) });
        const v = pr.versions.find((x) => x.no === Number(seg[3])); if (!v) throw new ApiError(404, 'not_found', 'Versão não encontrada.');
        if (seg.length === 4 && m === 'GET') return json(200, { no: v.no, kind: v.kind, label: v.label, createdAt: v.createdAt, createdBy: v.createdBy, slideCount: v.slideCount, title: v.title, content: v.content });
        if (seg[4] === 'restore' && m === 'POST') {
          if (body?.baseRev !== pr.rev) throw new ApiError(409, 'conflict', 'A apresentação foi alterada em outro lugar.', { serverRev: pr.rev, updatedBy: pub(byId(pr.updatedBy) || { id: pr.updatedBy, displayName: '?' }), updatedAt: pr.updatedAt });
          addVersion(pr, 'pre_restore', null, user.id); pr.content = structuredClone(v.content); pr.title = pr.content.title || pr.title; pr.rev++; pr.hash = hashOf(pr.content); pr.updatedAt = new Date().toISOString(); pr.updatedBy = user.id; addVersion(pr, 'restore', `Restaurada a versão ${v.no}`, user.id);
          return json(200, { rev: pr.rev, savedAt: pr.updatedAt, hash: pr.hash, unchanged: false });
        }
      }
      if (seg[2] === 'comments' && seg.length === 3) {
        const mod = canEdit(user, pr);
        if (m === 'GET') { const all = url.searchParams.get('includeResolved') === '1'; return json(200, { items: S.comments.filter((c) => c.presentationId === pr.id && !c.deleted && (all || !c.resolvedAt)).map((c) => commentOut(c, user, mod)) }); }
        if (m === 'POST') {
          const text = typeof body?.body === 'string' ? body.body.trim() : '', si = body?.slideIndex;
          if (!text || text.length > 2000 || (si != null && !(Number.isInteger(si) && si >= 0 && si <= 499)) || Object.keys(body).some((k) => !['body', 'slideIndex'].includes(k))) throw new ApiError(400, 'invalid_request', 'Comentário inválido.');
          const c = { id: randomUUID(), presentationId: pr.id, authorId: user.id, body: text, slideIndex: si ?? null, createdAt: new Date().toISOString(), editedAt: null, resolvedAt: null, deleted: false };
          S.comments.push(c); return json(201, commentOut(c, user, mod));
        }
      }
      if (seg[2] === 'interactions' && m === 'DELETE') { /* contrato: dono/admin apagam tudo do elemento; os demais, só os próprios */
        const el = url.searchParams.get('elementId'), kind = url.searchParams.get('kind');
        if (!el || !/^[\w.:-]{1,80}$/.test(el)) throw new ApiError(400, 'invalid_request', 'Informe o elemento.');
        const mod = canEdit(user, pr), before = S.interactions.length;
        S.interactions = S.interactions.filter((i) => !(i.presentationId === pr.id && i.elementId === el && (!kind || i.kind === kind) && (mod || i.userId === user.id)));
        return json(200, { deleted: before - S.interactions.length });
      }
      if (seg[2] === 'interactions' && (m === 'POST' || m === 'GET')) {
        if (m === 'POST') {
          if (S.faults.interactions5xx > 0) { S.faults.interactions5xx--; throw new ApiError(503, 'unavailable', 'Indisponível.'); }
          const { kind, elementId, payload, clientId } = body || {};
          if (!['form_response', 'board_state', 'vote_state', 'view', 'reaction'].includes(kind) || typeof elementId !== 'string' || !/^[\w-]{1,40}$/.test(elementId) || payload === undefined) throw new ApiError(400, 'invalid_request', 'Interação inválida.');
          if (clientId !== undefined && (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(clientId))) throw new ApiError(400, 'invalid_request', 'clientId inválido.');
          const cap = kind === 'board_state' || kind === 'vote_state' ? 256 * 1024 : 64 * 1024;
          if (Buffer.byteLength(JSON.stringify(payload)) > cap) throw new ApiError(413, 'too_large', 'Resposta grande demais.');
          if (clientId) { const dup = S.interactions.find((i) => i.presentationId === pr.id && i.userId === user.id && i.clientId === clientId); if (dup) return json(200, { id: dup.id, kind: dup.kind, elementId: dup.elementId }); }
          const now = new Date().toISOString();
          let out;
          if (kind === 'board_state' || kind === 'vote_state') {
            const ex = S.interactions.find((i) => i.presentationId === pr.id && i.userId === user.id && i.kind === kind && i.elementId === elementId);
            if (ex) { ex.payload = payload; ex.updatedAt = now; if (clientId) ex.clientId = clientId; out = [200, { id: ex.id }]; }
          }
          if (!out) { const it = { id: randomUUID(), presentationId: pr.id, userId: user.id, kind, elementId, payload, createdAt: now, updatedAt: now, clientId: clientId || null }; S.interactions.push(it); out = [201, { id: it.id }]; }
          if (S.faults.interactionsLoseResponse > 0) { S.faults.interactionsLoseResponse--; throw new ApiError(503, 'unavailable', 'Resposta perdida (gravado no servidor).'); }
          return json(out[0], out[1]);
        }
        const kind = url.searchParams.get('kind'), el = url.searchParams.get('elementId');
        const items = S.interactions.filter((i) => i.presentationId === pr.id && (!kind || i.kind === kind) && (!el || i.elementId === el) && (canEdit(user, pr) || i.userId === user.id))
          .map((i) => ({ id: i.id, kind: i.kind, elementId: i.elementId, payload: i.payload, author: pub(byId(i.userId)), createdAt: i.createdAt, updatedAt: i.updatedAt }));
        return json(200, { items });
      }
    }
    throw new ApiError(404, 'not_found', 'Rota inexistente.');
  }
  function whoAmIQuiet(req) { try { return whoAmI(req, { optional: true }); } catch { return null; } }
  function commentOut(c, user, mod) { return { id: c.id, slideIndex: c.slideIndex, body: c.body, author: pub(byId(c.authorId) || { id: c.authorId, displayName: '?' }), createdAt: c.createdAt, editedAt: c.editedAt, resolvedAt: c.resolvedAt, canDelete: c.authorId === user.id || mod, canResolve: c.authorId === user.id || mod, canEdit: c.authorId === user.id }; }

  /* ---------- ganchos de teste ---------- */
  async function testHook(req, res, url, body) {
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const p = url.pathname.slice('/__test'.length);
    if (p === '/login') { const u = S.users[body.user]; if (!u) return json(404, { error: 'usuário' }); const c = issue(u, res); return json(200, { id: u.id, ...c }); }
    if (p === '/enter') { /* uso manual no navegador: /__test/enter?user=ana&to=/editor/<id> entra e redireciona */
      const u = S.users[url.searchParams.get('user') || 'ana']; if (!u) return json(404, {}); issue(u, res); const to = url.searchParams.get('to') || '/acervo';
      const hdrs = res.getHeaders(); res.writeHead(302, { Location: /^\/[^/]/.test(to) ? to : '/acervo', 'Set-Cookie': hdrs['set-cookie'] }); return res.end();
    }
    if (p === '/logout') { res.setHeader('Set-Cookie', ['am_at=; Path=/; Max-Age=0', 'am_rt=; Path=/; Max-Age=0', 'am_csrf=; Path=/; Max-Age=0']); return json(200, {}); }
    if (p === '/expire') { const ck = cookies(req); const t = S.tokens.get(ck.am_at); if (t) t.valid = false; return json(200, { expired: !!t }); }
    if (p === '/reset') { reset(); return json(200, { users: Object.fromEntries(Object.entries(S.users).map(([k, u]) => [k, u.id])) }); }
    if (p === '/users') return json(200, Object.fromEntries(Object.entries(S.users).map(([k, u]) => [k, u.id])));
    if (p === '/faults') { Object.assign(S.faults, body || {}); return json(200, S.faults); }
    if (p === '/requests') { const r = S.log; if (body?.clear) S.log = []; return json(200, r); }
    if (p === '/state') return json(200, { counters: S.counters, assets: [...S.assets.keys()], presentations: [...S.pres.values()].map((x) => ({ ...meta(x), versions: x.versions.map((v) => ({ no: v.no, kind: v.kind, label: v.label })), hash: x.hash })), interactions: S.interactions });
    if (p === '/seed') {
      const owner = S.users[body.owner || 'ana']; const content = body.content ? structuredClone(body.content) : undefined;
      if (content) { /* imagens em data: viram arquivos do servidor, como numa importação real */
        const s = JSON.stringify(content).replace(/data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)/g, (m0, b64) => { const b = Buffer.from(b64, 'base64'); const sha = sha256(b); if (!S.assets.has(sha)) S.assets.set(sha, { bytes: b, mime: sniff(b) || 'image/png', kind: 'image', size: b.length }); if (!S.owned.has(owner.id)) S.owned.set(owner.id, new Set()); S.owned.get(owner.id).add(sha); return 'asset:sha256:' + sha; });
        const pr = create(owner, { title: body.title, content: JSON.parse(s) }); pr.content.id = pr.id; pr.hash = hashOf(pr.content); return json(201, { id: pr.id, rev: pr.rev });
      }
      const pr = create(owner, { title: body.title }); return json(201, { id: pr.id, rev: pr.rev });
    }
    if (p === '/bump') { /* outra pessoa/aparelho salva: rev+1 com mudança de título/conteúdo */
      const pr = getP(body.id), by = S.users[body.by || 'ana']; pr.content.title = body.title || (pr.content.title + ' [outro aparelho]'); if (body.content) pr.content = structuredClone(body.content); pr.title = pr.content.title; pr.rev++; pr.hash = hashOf(pr.content); pr.updatedAt = new Date().toISOString(); pr.updatedBy = by.id; return json(200, { rev: pr.rev });
    }
    if (p === '/transfer') { const pr = getP(body.id); pr.owner = S.users[body.to].id; return json(200, { owner: pr.owner }); }
    if (p === '/presentation') { const pr = getP(body.id); return json(200, { rev: pr.rev, title: pr.title, content: pr.content, hash: pr.hash, versions: pr.versions.map((v) => ({ no: v.no, kind: v.kind, label: v.label })) }); }
    if (p === '/comment') { const pr = getP(body.id), by = S.users[body.by || 'ana']; const c = { id: randomUUID(), presentationId: pr.id, authorId: by.id, body: String(body.body || 'Comentário'), slideIndex: body.slideIndex ?? null, createdAt: new Date().toISOString(), editedAt: null, resolvedAt: null, deleted: false }; S.comments.push(c); return json(201, { id: c.id }); }
    if (p === '/comments') return json(200, S.comments);
    if (p === '/prefs') return json(200, Object.fromEntries(Object.entries(S.users).map(([k, u]) => [k, S.prefs.get(u.id) || null])));
    if (p === '/inerte') { const f = path.join(distDir, 'editor', 'index.html'); return sendFile(res, f, { 'Content-Security-Policy': csp('/editor/'), ...SECURITY_HEADERS, 'Cache-Control': 'no-cache' }); }
    return json(404, {});
  }

  /* ---------- estático ---------- */
  function sendFile(res, file, extra) {
    const buf = readFileSync(file), ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': buf.length, ...extra }); res.end(buf);
  }
  let cspJson = null;
  function csp(pathname) {
    if (!cspJson) { try { cspJson = readCspJson(cspFile); } catch { cspJson = { default: COMMON_CSP }; } }
    const v = cspFor(pathname, cspJson);
    return stripUpgradeInsecure ? v.replace(/;?\s*upgrade-insecure-requests/, '') : v;
  }
  function stub(res, title, body, pathname) {
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp(pathname), ...SECURITY_HEADERS }); res.end(html);
  }
  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    const hdr = { 'Content-Security-Policy': csp(p), ...SECURITY_HEADERS, 'Cache-Control': 'no-cache' };
    if (editorWithoutId(p)) { res.writeHead(302, { Location: '/acervo', 'Cache-Control': 'no-store' }); return res.end(); }
    const m = /^\/(editor|visualizar)\/([^/]+)\/?$/.exec(p);
    if (m) return existsSync(path.join(distDir, 'editor', 'index.html')) ? sendFile(res, path.join(distDir, m[1] === 'editor' ? 'editor' : 'visualizar', 'index.html'), hdr) : stub(res, 'Editor não construído', 'Rode node tools/build-web.js', p);
    let f = path.join(distDir, p);
    if (!f.startsWith(distDir)) { res.writeHead(403); return res.end(); }
    if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!existsSync(f) && existsSync(f + '.html')) f += '.html';
    if (existsSync(f) && statSync(f).isFile()) return sendFile(res, f, hdr);
    if (p === '/acervo') return stub(res, 'Acervo (página provisória do teste)', 'Aqui ficará o acervo de apresentações.', p);
    if (p === '/entrar') return stub(res, 'Entrar (página provisória do teste)', 'Aqui fica o login.', p);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...hdr }); res.end('Não encontrado');
  }

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now(); const url = new URL(req.url, 'http://x');
    const chunks = []; for await (const c of req) chunks.push(c); let raw = Buffer.concat(chunks), body = raw;
    const reqId = 'mock-' + randomBytes(5).toString('hex'); res.setHeader('X-Request-Id', reqId);
    const isApi = url.pathname.startsWith('/api/'), isTest = url.pathname.startsWith('/__test/');
    if ((isApi || isTest) && /json/.test(req.headers['content-type'] || '') && raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { body = null; } }
    else if (isTest && raw.length === 0) body = {};
    const entry = { method: req.method, path: url.pathname + url.search, bodyBytes: raw.length, t: t0 };
    if (isApi && req.method === 'PUT' && /\/content$/.test(url.pathname) && body && typeof body === 'object') entry.putBody = body;
    if (isApi && req.method !== 'GET' && !/\/assets\//.test(url.pathname) && body && typeof body === 'object' && !Buffer.isBuffer(body)) entry.json = /\/content$/.test(url.pathname) ? undefined : body;
    if (isApi) S.log.push(entry);
    res.on('finish', () => { entry.status = res.statusCode; entry.ms = Date.now() - t0; });
    try {
      if (isTest) return await testHook(req, res, url, body);
      if (isApi) return await api(req, res, url, body);
      return serveStatic(req, res, url);
    } catch (e) {
      const ae = e instanceof ApiError ? e : new ApiError(500, 'internal', 'Erro interno.');
      if (!(e instanceof ApiError)) console.error('[mock] erro', e);
      if (!res.headersSent) {
        res.writeHead(ae.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(ae.status === 429 ? { 'Retry-After': '1' } : {}) });
        res.end(JSON.stringify({ error: { code: ae.code, message: ae.message, ...(ae.details ? { details: ae.details } : {}), requestId: reqId } }));
      } else res.end();
    }
  });
  await new Promise((r) => server.listen(port, host, r));
  const actual = server.address().port; appOrigin = `http://localhost:${actual}`;
  /* a origem do navegador é http://localhost:<porta>; 127.0.0.1 também escuta */
  return { url: appOrigin, port: actual, state: S, reset, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 4202);
  const m = await startMock({ port });
  const r = await fetch(m.url + '/__test/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: 'ana', title: 'Apresentação de teste' }) }).then((x) => x.json());
  console.log('mock da API + site em ' + m.url + ' (dist: platform/dist/public; rode antes: node tools/build-web.js)');
  for (const u of ['ana', 'bia', 'adm']) console.log('  entrar como ' + u + ' e abrir o editor:  ' + m.url + '/__test/enter?user=' + u + '&to=/editor/' + r.id + '   ·   visualizar: …&to=/visualizar/' + r.id);
}
