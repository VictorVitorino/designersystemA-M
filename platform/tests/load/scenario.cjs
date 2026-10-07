/* tests/load/scenario.cjs — o que cada sessão simulada FAZ (mix realista) e os dados que ela usa (decks de 150–400 KB com imagens
   externalizadas, imagens PNG reais de 200–800 KB geradas com sharp, miniaturas, imagens privadas para as sondas de vazamento).

   Ciclo de uma sessão (sequencial, como um navegador): dorme 3–5 s → [20 %: envia uma imagem nova: POST /assets/check + PUT /assets/:sha e
   a referencia no deck] → [1×/60 s: miniatura] → PUT /content {baseRev} (autosave) → uma ação secundária sorteada:
     25 % abrir acervo (GET /presentations) · 20 % abrir apresentação alheia (GET /:id) · 15 % listar versões (GET /:id/versions) ·
     15 % baixar um arquivo (GET /assets/:sha) · 10 % criar cópia de apresentação alheia (POST /:id/duplicate) · 5 % comentar ·
     5 % sonda de vazamento (versões alheias→403, arquivo privado alheio→404, PUT em apresentação alheia→403, scope=mine só meu) ·
     5 % salvamento obsoleto (baseRev errado → 409 esperado; 200 seria perda de integridade).
   Cada sessão guarda o ÚLTIMO PUT confirmado (rev + hash) para a verificação final de integridade. */
'use strict';
const crypto = require('node:crypto');
const sharp = require('sharp');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** PRNG determinístico (mulberry32) para cada sessão repetir o mesmo roteiro. */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* ───────────── imagens ───────────── */

/** PNG real (ruído incompressível, compressionLevel 0): tamanho ≈ w*h*3. Para 200–800 KB: lados de ~260 a ~520 px. */
async function noisePng(bytes) {
  const side = Math.max(16, Math.round(Math.sqrt(bytes / 3)));
  const raw = crypto.randomBytes(side * side * 3);
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}
async function noiseJpeg(bytes) {
  const side = Math.max(16, Math.round(Math.sqrt(bytes / 0.9)));   // JPEG de ruído a q92 ≈ 0,9 byte/pixel (medido com sharp 0.33)
  const raw = crypto.randomBytes(side * side * 3);
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}
const img = (buf, mime) => ({ buf, sha: sha256(buf), size: buf.length, mime });

/** Conjunto de imagens do teste. shared: 3 imagens que TODOS os usuários referenciam (prova de deduplicação); pool: imagens "comuns"
 *  de 200–800 KB que várias pessoas enviam (20 % dos envios → dedup cruzada); fresh(): imagem ÚNICA gerada na hora (80 % dos envios —
 *  cada consultor cola as próprias capturas de tela). As geradas ficam em `generated` (bytes conferidos nos downloads). */
async function makeImages({ poolSize = 30, rnd = Math.random } = {}) {
  const mk = async (bytes, k) => (k % 4 === 3 ? img(await noiseJpeg(bytes), 'image/jpeg') : img(await noisePng(bytes), 'image/png'));
  const shared = [img(await noisePng(250 * 1024), 'image/png'), img(await noisePng(420 * 1024), 'image/png'), img(await noiseJpeg(600 * 1024), 'image/jpeg')];
  const pool = [];
  for (let i = 0; i < poolSize; i++) pool.push(await mk(Math.round((200 + rnd() * 600) * 1024), i));
  const generated = [];
  return { shared, pool, generated, async fresh(r = rnd) { const im = await mk(Math.round((200 + r() * 600) * 1024), generated.length); generated.push({ sha: im.sha, size: im.size }); return im; } };
}
/** Imagem pequena e única (privada de um usuário; nunca referenciada em apresentação) para a sonda "arquivo alheio → 404". */
async function privateImage() { return img(await noisePng(8 * 1024), 'image/png'); }
/** Miniatura do slide 1 (kind=thumb, ≤ 512 KB): única a cada envio, como no cliente real (a miniatura muda quando o slide muda). */
async function thumbImage() { const raw = crypto.randomBytes(96 * 54 * 3); return img(await sharp(raw, { raw: { width: 96, height: 54, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer(), 'image/png'); }

/* ───────────── decks ───────────── */

const WORDS = ['receita', 'margem', 'cliente', 'plano', 'risco', 'meta', 'valor', 'equipe', 'prazo', 'mercado', 'custo', 'operação', 'crescimento', 'estratégia', 'sinergia', 'diagnóstico', 'execução', 'governança', 'indicador', 'resultado', 'capital', 'giro', 'fornecedor', 'contrato', 'alavanca', 'EBITDA', 'caixa', 'portfólio', 'frente', 'entrega', 'reestruturação', 'desempenho', 'orçamento', 'hipótese', 'cenário'];
function prose(rnd, nWords) {
  const out = []; let sentence = [];
  for (let i = 0; i < nWords; i++) {
    let w = WORDS[Math.floor(rnd() * WORDS.length)];
    if (!sentence.length) w = w[0].toUpperCase() + w.slice(1);
    sentence.push(w);
    if (sentence.length >= 8 + Math.floor(rnd() * 10) || i === nWords - 1) { out.push(sentence.join(' ') + '.'); sentence = []; }
  }
  return out.join(' ');
}
const text = (id, html, over = {}) => ({ id, type: 'text', x: 54, y: 62, w: 1030, h: 46, html, size: 32, weight: 400, color: '#002A46', font: 'Roboto', anim: { in: 'fade', delay: 150 }, ...over });
const fx = (id, kind, data) => ({ id, type: 'fx', kind, x: 100, y: 200, w: 600, h: 300, data, anim: { in: 'rise', delay: 0, dur: 700, loop: 'none', hover: 'none' } });

function makeSlide(rnd, i, imageRefs) {
  const els = [
    text(`t${i}`, `Título do slide ${i + 1}`),
    text(`b${i}`, `<b>Receita</b> cresce <span style="color:#F78C16">+${10 + Math.floor(rnd() * 20)}%</span> ao ano<br>• meta → 2027 ⇒ margem ${30 + Math.floor(rnd() * 10)}%`, { y: 120, h: 80, size: 24 }),
    text(`p${i}`, prose(rnd, 180 + Math.floor(rnd() * 160)).replace(/\. /g, '.<br>'), { y: 220, h: 300, size: 16 }),
    { id: `s${i}`, type: 'shape', shape: 'round', x: 54, y: 540, w: 300, h: 120, fill: '#EBEEF1', stroke: '#002A46', strokeW: 1, html: 'Caixa ' + (i + 1) },
    { id: `l${i}`, type: 'line', x1: 354, y1: 600, x2: 600, y2: 600, a1: { id: `s${i}`, s: 'e' }, stroke: '#002A46', strokeW: 2, headE: 'arrow' },
    fx(`f${i}`, 'headline', { text: 'Resultado', hl: 'Resultado', size: 72, color: '#FFFFFF', font: 'Roboto', weight: 300 }),
    fx(`g${i}`, 'smart', { items: WORDS.slice(0, 3 + Math.floor(rnd() * 4)).map((t, k) => ({ t: t[0].toUpperCase() + t.slice(1), lv: k % 2 })) }),
  ];
  for (const ref of imageRefs) els.push({ id: `i${i}-${ref.slice(-6)}`, type: 'image', x: 700, y: 120, w: 400, h: 300, src: ref });
  return { id: `sl${i}`, bg: '#FFFFFF', tr: 'fade', layout: 'blank-light', title: `Seção ${1 + (i % 5)}`, els, notes: prose(rnd, 30), base: { bg: '#FFFFFF', els: {} } };
}
/** Deck no formato do editor com ~targetBytes de JSON (150–400 KB) e as imagens compartilhadas nos 3 primeiros slides. */
function makeDeck({ title, sharedShas, targetBytes, seed }) {
  const rnd = prng(seed);
  const deck = { v: 1, app: 'AM Studio', id: 'd' + seed.toString(36), title, slides: [], nav: { chapters: true }, num: { on: true, pos: 'br' }, brand: { name: 'A&M', colors: ['#002A46', '#F78C16'], font: 'Roboto' }, comments: [], created: 1_700_000_000_000, updated: 1_700_000_100_000 };
  let i = 0;
  while (JSON.stringify(deck).length < targetBytes && i < 150) { deck.slides.push(makeSlide(rnd, i, i < sharedShas.length ? ['asset:sha256:' + sharedShas[i]] : [])); i++; }
  return deck;
}

/* ───────────── sessão simulada ───────────── */

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const SECONDARY = [['acervo', 25], ['abrir_alheia', 20], ['versoes', 15], ['baixar', 15], ['copiar', 10], ['comentar', 5], ['sonda', 5], ['obsoleto', 5]];
function weighted(rnd, table) { let r = rnd() * table.reduce((a, [, w]) => a + w, 0); for (const [k, w] of table) { if ((r -= w) < 0) return k; } return table[0][0]; }

class VirtualUser {
  /** @param {{client:import('./client.cjs').Client, user:{id:string,email:string,name:string}, idx:number, world:object, images:{shared:any[],pool:any[]}, contentHash:Function, seed:number, deckBytes:number, log?:Function}} o */
  constructor(o) {
    Object.assign(this, o);
    this.rnd = prng(o.seed);
    this.stats = { cycles: 0, putOk: 0, putUnchanged: 0, put409Unexpected: 0, put429: 0, put5xx: 0, putOther: 0, putNet: 0, uploads: 0, uploadsPut: 0, uploadsPutBytes: 0, uploadDedup: 0, uploadsCheckOnly: 0, thumbs: 0, copies: 0, comments: 0, probes: 0, stale: 0, staleAccepted: 0, downloads: 0, downloadBad: 0, actions: {}, leaks: [], anomalies: [] };
    this.lastConfirmed = null;   // { rev, hash, n }
    this.rev = null; this.pid = null; this.n = 0; this.myShas = new Set(); this.lastThumbAt = 0; this.thumbSha = null; this.poolCursor = (o.idx * 7) % o.images.pool.length;
  }
  anomaly(msg) { if (this.stats.anomalies.length < 50) this.stats.anomalies.push(msg); }
  leak(msg) { this.stats.leaks.push(msg); }

  /** Envia (se faltar) uma imagem e registra a posse. Devolve a resposta do PUT ou null (já possuía). */
  async upload(im, kind = 'image', label = '') {
    const chk = await this.client.post('/api/assets/check', { shas: [im.sha] });
    if (chk.status !== 200) { this.anomaly(`assets/check ${chk.status}`); return { status: chk.status }; }
    if (!chk.json.missing.includes(im.sha)) { this.stats.uploadsCheckOnly++; return null; }   // o servidor já tem e eu já posso usar (enviei antes ou está numa apresentação do acervo)
    const r = await this.client.request('PUT', `/api/assets/${im.sha}`, { body: im.buf, headers: { 'Content-Type': im.mime, 'X-Asset-Kind': kind }, key: `PUT /api/assets/:sha${label}` });
    if (r.status === 200 || r.status === 201) { this.stats.uploadsPut++; this.stats.uploadsPutBytes += im.size; if (r.json && r.json.deduplicated) this.stats.uploadDedup++; }
    return r;
  }

  /** Cria a apresentação da sessão (com as 3 imagens compartilhadas já enviadas) e registra o estado inicial. */
  async setup() {
    for (const im of this.images.shared) { const r = await this.upload(im, 'image', ' [compartilhada]'); if (r && !(r.status === 200 || r.status === 201)) this.anomaly(`upload compartilhada ${r.status}`); this.myShas.add(im.sha); }
    this.deck = makeDeck({ title: `Carga ${String(this.idx + 1).padStart(3, '0')} — ${this.user.name}`, sharedShas: this.images.shared.map((i) => i.sha), targetBytes: this.deckBytes, seed: this.seed });
    let r;
    for (let k = 0; k < 6; k++) {   // como o cliente real: 429 → espera o Retry-After e tenta de novo
      r = await this.client.post('/api/presentations', { title: this.deck.title, content: this.deck });
      if (r.status !== 429) break;
      this.stats.setup429 = (this.stats.setup429 || 0) + 1;
      await sleep(1000 * Math.min(30, Number(r.json && r.json.error && r.json.error.details && r.json.error.details.retryAfterS) || 2));
    }
    if (r.status !== 201) throw new Error(`POST /api/presentations → ${r.status} ${r.text.slice(0, 200)}`);
    this.pid = r.json.id; this.rev = r.json.rev; this.revAtStart = r.json.rev;
    this.lastConfirmed = { rev: this.rev, hash: this.contentHash(this.deck), n: 0 };
    this.world.presentations.push({ id: this.pid, ownerId: this.user.id, idx: this.idx });
    this.stats.uploadsPut = 0; this.stats.uploadDedup = 0; this.stats.uploadsPutBytes = 0; this.stats.uploadsCheckOnly = 0;   // a preparação não conta no mix da fase
    return this.pid;
  }

  mutate(deck, n) {
    deck.slides[0].els[0].html = `Título do slide 1 · edição ${n} · ${new Date().toISOString().slice(11, 19)}`;
    deck.updated = Date.now();
  }
  others() { return this.world.presentations.filter((p) => p.ownerId !== this.user.id); }

  async autosave() {
    this.n++; this.mutate(this.deck, this.n);
    const body = { baseRev: this.rev, content: this.deck };
    if (this.pendingThumb) { body.thumbSha = this.pendingThumb; this.pendingThumb = null; }
    const r = await this.client.put(`/api/presentations/${this.pid}/content`, body);
    if (r.status === 200) {
      if (r.json.unchanged) { this.stats.putUnchanged++; this.anomaly(`PUT unchanged inesperado na edição ${this.n}`); }
      else { this.stats.putOk++; this.rev = r.json.rev; this.lastConfirmed = { rev: r.json.rev, hash: r.json.hash, n: this.n, savedAt: r.json.savedAt }; }
    } else if (r.status === 409) { this.stats.put409Unexpected++; this.anomaly(`409 inesperado: serverRev=${r.json && r.json.error && r.json.error.details && r.json.error.details.serverRev} meu=${this.rev}`); const g = await this.client.get(`/api/presentations/${this.pid}`, { record: false }); if (g.status === 200) this.rev = g.json.rev; }
    else if (r.status === 429) this.stats.put429++;            // o cliente real entra em "Sem conexão" e tenta de novo com recuo; aqui a próxima edição reenvia
    else if (r.status >= 500) this.stats.put5xx++;
    else if (r.status === 0) this.stats.putNet++;
    else { this.stats.putOther++; this.anomaly(`PUT ${r.status}: ${r.text.slice(0, 120)}`); }
    return r;
  }

  async maybeNewImage() {
    if (this.rnd() >= 0.2) return;
    let im;
    if (this.rnd() < 0.2) { im = this.images.pool[this.poolCursor]; this.poolCursor = (this.poolCursor + 1) % this.images.pool.length; }   // imagem "comum" (várias pessoas enviam a mesma)
    else { im = await this.images.fresh(this.rnd); this.world.sizes.set(im.sha, im.size); }                                                  // imagem única desta pessoa
    const r = await this.upload(im, 'image', '');
    if (r && !(r.status === 200 || r.status === 201)) { if (r.status !== 429 && r.status !== 0) this.anomaly(`upload ${r.status}: ${(r.text || '').slice(0, 100)}`); return; }
    this.stats.uploads++;
    this.myShas.add(im.sha);
    const sl = this.deck.slides[this.n % this.deck.slides.length];
    sl.els.push({ id: `img${this.n}`, type: 'image', x: 80 + (this.n % 5) * 20, y: 400, w: 320, h: 240, src: 'asset:sha256:' + im.sha });
  }
  async maybeThumb() {
    if (Date.now() - this.lastThumbAt < 60_000) return;
    this.lastThumbAt = Date.now();
    const th = await thumbImage();
    const r = await this.client.request('PUT', `/api/assets/${th.sha}`, { body: th.buf, headers: { 'Content-Type': th.mime, 'X-Asset-Kind': 'thumb' }, key: 'PUT /api/assets/:sha [thumb]' });
    if (r.status === 200 || r.status === 201) { this.stats.thumbs++; this.pendingThumb = th.sha; }
  }

  async secondary() {
    const kind = weighted(this.rnd, SECONDARY);
    this.stats.actions[kind] = (this.stats.actions[kind] || 0) + 1;
    const others = this.others();
    const other = others.length ? pick(this.rnd, others) : null;
    switch (kind) {
      case 'acervo': {
        const r = await this.client.get('/api/presentations?limit=30');
        if (r.status === 200 && !Array.isArray(r.json.items)) this.anomaly('acervo sem items');
        return;
      }
      case 'abrir_alheia': {
        if (!other) return;
        const r = await this.client.get(`/api/presentations/${other.id}`);
        if (r.status === 200) { if (r.json.canEdit !== false) this.leak(`GET /:id alheia devolveu canEdit=${r.json.canEdit}`); if (r.json.owner && r.json.owner.id === this.user.id) this.leak('GET /:id alheia com owner = eu'); }
        else if (r.status !== 429 && r.status !== 0) this.anomaly(`abrir alheia ${r.status}`);
        return;
      }
      case 'versoes': {
        const r = await this.client.get(`/api/presentations/${this.pid}/versions`);
        if (r.status === 200 && !Array.isArray(r.json.items)) this.anomaly('versions sem items');
        else if (r.status !== 200 && r.status !== 429 && r.status !== 0) this.anomaly(`versões próprias ${r.status}`);
        return;
      }
      case 'baixar': {
        const sha = pick(this.rnd, [...this.myShas]);
        const expected = this.world.sizes.get(sha);
        const r = await this.client.get(`/api/assets/${sha}`);
        if (r.status === 200) { this.stats.downloads++; if (expected && r.bytes !== expected) { this.stats.downloadBad++; this.anomaly(`download ${sha.slice(0, 8)}: ${r.bytes} bytes ≠ ${expected}`); } }
        else if (r.status !== 429 && r.status !== 0) this.anomaly(`download ${r.status}`);
        return;
      }
      case 'copiar': {
        if (!other) return;
        const r = await this.client.post(`/api/presentations/${other.id}/duplicate`, {});
        if (r.status === 201) { this.stats.copies++; if (r.json.owner && r.json.owner.id !== this.user.id) this.leak('cópia com dono ≠ eu'); this.world.copies.push({ id: r.json.id, ownerId: this.user.id, sourceId: other.id }); }
        else if (r.status !== 429 && r.status !== 0) this.anomaly(`duplicate ${r.status}: ${r.text.slice(0, 100)}`);
        return;
      }
      case 'comentar': {
        const target = other || { id: this.pid };
        const r = await this.client.post(`/api/presentations/${target.id}/comments`, { body: `Comentário de carga #${this.n} — revisar o slide ${1 + (this.n % 3)}.`, slideIndex: this.n % 3 });
        if (r.status === 201) this.stats.comments++; else if (r.status !== 429 && r.status !== 0) this.anomaly(`comment ${r.status}: ${r.text.slice(0, 100)}`);
        return;
      }
      case 'sonda': {
        this.stats.probes++;
        const which = this.stats.probes % 4;
        if (which === 0 && other) {
          const r = await this.client.get(`/api/presentations/${other.id}/versions`, { key: 'GET /api/presentations/:id/versions [alheia→403]', expect: 403 });
          if (r.status === 200) this.leak(`versões de ${other.id} (dono ${other.ownerId}) devolvidas a ${this.user.id}`);
          else if (r.status !== 403 && r.status !== 429 && r.status !== 0) this.anomaly(`sonda versões alheias ${r.status}`);
        } else if (which === 1) {
          const priv = this.world.privateShas.filter((p) => p.ownerId !== this.user.id);
          if (!priv.length) return;
          const p = pick(this.rnd, priv);
          const r = await this.client.get(`/api/assets/${p.sha}`, { key: 'GET /api/assets/:sha [alheio→404]', expect: 404 });
          if (r.status === 200) this.leak(`arquivo privado ${p.sha.slice(0, 12)} de ${p.ownerId} servido a ${this.user.id}`);
          else if (r.status !== 404 && r.status !== 429 && r.status !== 0) this.anomaly(`sonda arquivo alheio ${r.status}`);
        } else if (which === 2 && other) {
          const r = await this.client.put(`/api/presentations/${other.id}/content`, { baseRev: 1, content: { v: 1, app: 'AM Studio', id: 'x', title: 'Invasão', slides: [{ id: 'e1', bg: '#FFFFFF', tr: 'fade', layout: 'blank-light', els: [] }] } }, { key: 'PUT /api/presentations/:id/content [alheia→403]', expect: 403 });
          if (r.status === 200) this.leak(`PUT em apresentação alheia ${other.id} aceito (200)`);
          else if (r.status !== 403 && r.status !== 429 && r.status !== 0) this.anomaly(`sonda PUT alheio ${r.status}`);
        } else {
          const r = await this.client.get('/api/presentations?scope=mine&limit=100', { key: 'GET /api/presentations?scope=mine' });
          if (r.status === 200) { const bad = r.json.items.filter((it) => it.owner.id !== this.user.id); if (bad.length) this.leak(`scope=mine devolveu ${bad.length} itens de outros donos`); }
        }
        return;
      }
      case 'obsoleto': {
        this.stats.stale++;
        const copy = JSON.parse(JSON.stringify(this.deck)); this.mutate(copy, this.n + 1000);
        const stale = this.rev > 1 ? this.rev - 1 : this.rev + 1;
        const r = await this.client.put(`/api/presentations/${this.pid}/content`, { baseRev: stale, content: copy }, { key: 'PUT /api/presentations/:id/content [obsoleto→409]', expect: 409 });
        if (r.status === 200) { this.stats.staleAccepted++; this.anomaly(`salvamento com baseRev obsoleto ${stale} ACEITO (rev ${this.rev})`); this.rev = r.json.rev; this.lastConfirmed = { rev: r.json.rev, hash: r.json.hash, n: this.n + 1000 }; }
        else if (r.status === 409) { const d = r.json && r.json.error && r.json.error.details; if (!d || d.serverRev !== this.rev) this.anomaly(`409 com serverRev=${d && d.serverRev} ≠ ${this.rev}`); }
        else if (r.status !== 429 && r.status !== 0) this.anomaly(`obsoleto ${r.status}`);
        return;
      }
      default: return;
    }
  }

  async run(untilMs) {
    await sleep(this.rnd() * 4000);   // sessões desencontradas
    while (Date.now() < untilMs) {
      this.stats.cycles++;
      try { await this.maybeNewImage(); await this.maybeThumb(); await this.autosave(); await this.secondary(); }
      catch (e) { this.anomaly('exceção: ' + String(e && e.message).slice(0, 160)); }
      const wait = 3000 + this.rnd() * 2000;
      const left = untilMs - Date.now();
      if (left <= 0) break;
      await sleep(Math.min(wait, left));
    }
  }

  /** Verificação final: o servidor tem exatamente o último PUT confirmado (rev e hash) e a revisão avançou 1× por PUT 200 "changed". */
  async verify(sql) {
    const out = { idx: this.idx, pid: this.pid, ok: true, problems: [] };
    const g = await this.client.get(`/api/presentations/${this.pid}`, { record: false });
    if (g.status !== 200) { out.ok = false; out.problems.push(`GET final ${g.status}`); return out; }
    if (g.json.rev !== this.lastConfirmed.rev) { out.ok = false; out.problems.push(`rev do servidor ${g.json.rev} ≠ último confirmado ${this.lastConfirmed.rev}`); }
    const h = this.contentHash(g.json.content);
    if (h !== this.lastConfirmed.hash) { out.ok = false; out.problems.push(`hash do conteúdo devolvido ≠ hash do último PUT confirmado`); }
    if (g.json.owner.id !== this.user.id) { out.ok = false; out.problems.push('dono ≠ eu'); }
    const expectedRev = this.revAtStart + this.stats.putOk + this.stats.staleAccepted;
    if (g.json.rev !== expectedRev) { out.ok = false; out.problems.push(`rev ${g.json.rev} ≠ ${this.revAtStart} + ${this.stats.putOk} PUT 200 alterados`); }
    if (sql) {
      const [row] = await sql`select rev, content_hash, slide_count, (select count(*)::int from app.presentation_versions v where v.presentation_id = p.id) as versions from app.presentations p where id = ${this.pid}::uuid`;
      out.db = row ? { rev: row.rev, hash: row.content_hash, versions: row.versions, slideCount: row.slide_count } : null;
      if (!row) { out.ok = false; out.problems.push('linha ausente no banco'); }
      else { if (row.content_hash !== this.lastConfirmed.hash) { out.ok = false; out.problems.push('content_hash no banco ≠ último PUT confirmado'); } if (row.rev !== this.lastConfirmed.rev) { out.ok = false; out.problems.push(`rev no banco ${row.rev} ≠ ${this.lastConfirmed.rev}`); } }
    }
    return out;
  }
}

module.exports = { VirtualUser, makeImages, makeDeck, privateImage, thumbImage, prng, sleep, sha256, SECONDARY };
