/* /importar — traz o acervo local do Canteiro para a nuvem.
   Lê JSON de acervo (kind canteiro-acervo) e/ou HTMLs salvos, troca imagens embutidas por arquivos (asset:sha256:…, sem duplicar)
   e cria cada apresentação com POST /api/presentations {source:'import'}. Usa window.AMCloudCore (carregado de /js/cloud-core.js). */
import { api, ApiError } from '../api.js';
import { requireUser } from '../session.js';
import { h, icon, button, replace, clear, $, alertBox, announce, toast, toastError } from '../ui.js';
import { formatBytes, formatNumber, plural, csvLine, isUuid } from '../format.js';

const MAX_FILE_BYTES = 300 * 1024 * 1024;   // por arquivo lido no navegador
const API_UPLOAD_LIMIT = 4 * 1024 * 1024;   // limite do corpo da função serverless (docs/API.md §5)
const SS_KEY = 'am.import.done';
const SHRINK_TARGET = API_UPLOAD_LIMIT - 256 * 1024;   // imagens acima disso são reduzidas no navegador antes de subir

await requireUser({ active: 'importar' });
const main = $('#conteudo');
document.title = 'Importar acervo local — Canteiro · A&M';

const core = window.AMCloudCore;

/* ───────── memória da sessão (itens já enviados) ───────── */
function readDone() { try { return JSON.parse(sessionStorage.getItem(SS_KEY) || '{}') || {}; } catch { return {}; } }
function writeDone(map) { try { sessionStorage.setItem(SS_KEY, JSON.stringify(map)); } catch { /* sem armazenamento: só não retoma depois de recarregar */ } }
let done = readDone();

/* ───────── estado ───────── */
const state = { items: [], running: false, stop: false, seen: new Set(), cache: new Map(), finished: false };
let counter = 0;

/* ───────── adaptador de arquivos para o cloud-core ───────── */
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const assetApi = {
  async check(shas) {
    const missing = [];
    for (const part of chunk(shas, 200)) {
      const r = await api.post('/api/assets/check', { shas: part });
      missing.push(...(r?.missing || []));
    }
    return missing;
  },
  async put(sha, bytes, mime, kind = 'image') {
    if (bytes.length > API_UPLOAD_LIMIT) {
      const up = await api.post('/api/assets/uploads', { sha256: sha, size: bytes.length, mime, kind });
      if (up?.mode === 'direct') {
        const u = new URL(up.url, location.href);
        if (u.origin !== location.origin) throw new ApiError(0, 'direct_blocked', `Imagem de ${formatBytes(bytes.length)}: acima de 4 MB só é possível enviar pelo editor. Reduza a imagem e tente de novo.`);
        const r = await fetch(u, { method: up.method || 'PUT', headers: up.headers || {}, body: bytes, credentials: 'same-origin' });
        if (!r.ok) throw new ApiError(r.status, 'upload_failed', 'O envio da imagem grande falhou.');
        await api.post(`/api/assets/${sha}/finalize`, {});
        return;
      }
    }
    await api.request('PUT', `/api/assets/${sha}`, { body: bytes, binary: true, headers: { 'Content-Type': mime, 'X-Asset-Kind': kind }, timeout: 120000 });
  },
};

/** Reduz uma imagem grande (redimensiona e recomprime no navegador) para caber no limite de envio. Devolve null se não conseguir. */
async function shrinkImage(bytes, mime) {
  if (typeof createImageBitmap !== 'function') return null;
  let bmp;
  try { bmp = await createImageBitmap(new Blob([bytes], { type: mime })); } catch { return null; }
  const type = mime === 'image/jpeg' ? 'image/jpeg' : mime === 'image/webp' ? 'image/webp' : 'image/png';
  let scale = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  try {
    for (let i = 0; i < 7; i++) {
      const w = Math.max(1, Math.round(bmp.width * scale)); const hgt = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hgt;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
      const blob = await new Promise((res) => canvas.toBlob(res, type, 0.82));
      if (blob && blob.size <= SHRINK_TARGET) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || type };
      scale *= 0.7;
    }
  } finally { bmp.close?.(); }
  return null;
}

/* ───────── leitura dos arquivos ───────── */
async function readFiles(fileList) {
  const added = [];
  const problems = [];
  for (const file of fileList) {
    const sig = `${file.name}|${file.size}|${file.lastModified}`;
    if (state.seen.has(sig)) { problems.push(`${file.name}: já está na lista.`); continue; }
    const lower = file.name.toLowerCase();
    const isJson = lower.endsWith('.json'); const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
    if (!isJson && !isHtml) { problems.push(`${file.name}: formato não suportado (use .json do acervo ou .html de apresentações salvas).`); continue; }
    if (file.size > MAX_FILE_BYTES) { problems.push(`${file.name}: arquivo grande demais (${formatBytes(file.size)}). Exporte em partes menores.`); continue; }
    state.seen.add(sig);
    let text;
    try { text = await file.text(); } catch { problems.push(`${file.name}: não foi possível ler o arquivo.`); continue; }
    try {
      if (isJson) {
        const list = core.parseAcervoJson(text) || [];
        if (!list.length) { problems.push(`${file.name}: nenhuma apresentação encontrada neste JSON.`); continue; }
        for (const o of list) if (o?.deck) added.push(makeItem(file.name, o.id, o.title, o.deck));
      } else {
        const deck = core.extractDeckFromHtml(text);
        if (!deck) { problems.push(`${file.name}: não é uma apresentação salva pelo Canteiro (faltou o bloco de dados).`); continue; }
        added.push(makeItem(file.name, deck.id, deck.title, deck));
      }
    } catch (e) { problems.push(`${file.name}: arquivo inválido (${e?.message || 'erro de leitura'}).`); }
  }
  return { added, problems };
}

function makeItem(fileName, id, title, deck) {
  const t = String(title || deck?.title || '').trim() || fileName.replace(/\.(json|html?)$/i, '');
  const slides = Array.isArray(deck?.slides) ? deck.slides.length : 0;
  return { n: ++counter, key: `${id || fileName}:${slides}:${t}`, file: fileName, id, title: t, deck, slides, status: 'pending', msg: 'Na fila', presentationId: null, stats: null, progress: null };
}

/* ───────── interface ───────── */
const input = h('input', { type: 'file', id: 'arquivos', class: 'sr-only', multiple: true, accept: '.json,.html,.htm,application/json,text/html' });
const dropzone = h('div', { class: 'drop', id: 'zona' },
  icon('upload', 'ic--xl'),
  h('p', null, h('strong', null, 'Arraste os arquivos para cá'), ' ou escolha no computador'),
  input, h('label', { class: 'btn btn--primary', for: 'arquivos', id: 'escolher' }, icon('file'), 'Escolher arquivos'),
  h('p', { class: 'hint' }, 'Aceita o acervo exportado (.json) e apresentações salvas (.html). Vários arquivos de uma vez.'));
const problemsBox = h('div', { id: 'problemas', 'aria-live': 'polite' });
const queueBox = h('div', { id: 'fila' });
const overall = h('div', { id: 'geral' });
const reportBox = h('div', { id: 'relatorio' });
const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite', id: 'importar-status' });
const redo = h('input', { type: 'checkbox', id: 'reimportar' });

replace(main,
  h('div', { class: 'page__head' }, h('div', null, h('h1', { id: 'titulo' }, 'Importar acervo local'),
    h('p', { class: 'lead' }, 'Traga as apresentações que você tem no Canteiro do seu computador. As imagens são enviadas uma única vez, sem repetir as que já existem.'))),
  h('ol', { class: 'steps', 'aria-label': 'Como importar' },
    h('li', null, h('span', null, h('b', null, 'Abra o Canteiro local'), ' e entre em “Minhas obras”.')),
    h('li', null, h('span', null, 'Clique em ', h('b', null, 'Exportar acervo (.json)'), ' e salve o arquivo.')),
    h('li', null, h('span', null, h('b', null, 'Envie aqui'), ' o JSON (e, se quiser, HTMLs de apresentações salvas) e acompanhe o progresso.'))),
  dropzone, problemsBox, live, queueBox, overall, reportBox);

function setLive(msg) { live.textContent = msg; }

function statusBadge(it) {
  const m = { pending: ['Na fila', ''], running: ['Enviando', 'info'], done: ['Importada', 'ok'], skipped: ['Já enviada', 'warn'], error: ['Falhou', 'danger'] }[it.status];
  return h('span', { class: `badge${m[1] ? ` badge--${m[1]}` : ''}`, 'data-status': it.status }, m[0]);
}

function itemNode(it) {
  const pr = it.progress && it.progress.total ? h('progress', { max: it.progress.total, value: it.progress.done, 'aria-label': `Progresso de ${it.title}` }) : (it.status === 'running' ? h('progress', { 'aria-label': `Progresso de ${it.title}` }) : null);
  const details = it.stats ? `${plural(it.stats.found, 'imagem', 'imagens')} · ${it.stats.uploaded} enviada${it.stats.uploaded === 1 ? '' : 's'} · ${it.stats.deduplicated} já existia${it.stats.deduplicated === 1 ? '' : 'm'} · ${formatBytes(it.stats.bytes)}${it.stats.shrunk ? ` · ${plural(it.stats.shrunk, 'imagem reduzida', 'imagens reduzidas')} para caber no limite` : ''}` : '';
  return h('li', { class: `qi${it.status === 'error' ? ' is-error' : ''}${it.status === 'done' ? ' qi--done' : ''}`, dataset: { n: it.n, status: it.status } },
    h('div', { class: 'qi__top' },
      h('span', { class: 'qi__title' }, it.title, h('span', { class: 'muted' }, ` · ${plural(it.slides, 'slide', 'slides')}`)),
      statusBadge(it)),
    pr,
    h('p', { class: 'qi__msg' }, `${it.file}${it.msg ? ` — ${it.msg}` : ''}`, details ? h('br') : null, details || null),
    it.status === 'done' && isUuid(it.presentationId) ? h('p', { class: 'qi__msg' }, h('a', { href: `/editor/${it.presentationId}` }, 'Abrir no editor')) : null);
}

function drawQueue() {
  if (!state.items.length) { clear(queueBox); clear(overall); return; }
  const total = state.items.length;
  const finished = state.items.filter((i) => ['done', 'skipped', 'error'].includes(i.status)).length;
  const pending = state.items.filter((i) => i.status === 'pending').length;
  const failed = state.items.filter((i) => i.status === 'error').length;
  const actions = h('div', { class: 'row' });
  if (state.running) actions.append(button({ label: 'Parar após o item atual', icon: 'x', onClick: () => { state.stop = true; setLive('A importação vai parar depois do item atual.'); }, attrs: { id: 'btn-parar' } }));
  else {
    if (pending) actions.append(button({ label: `Importar ${plural(pending, 'apresentação', 'apresentações')}`, icon: 'upload', variant: 'accent', onClick: () => run(), attrs: { id: 'btn-importar' } }));
    if (failed) actions.append(button({ label: `Tentar de novo as ${failed} com falha`, icon: 'refresh', onClick: () => run({ retry: true }), attrs: { id: 'btn-retry' } }));
    actions.append(button({ label: 'Limpar lista', icon: 'trash', variant: 'ghost', onClick: clearAll, attrs: { id: 'btn-limpar' } }));
  }
  const anyDoneBefore = state.items.some((i) => done[i.key]);
  replace(queueBox,
    h('div', { class: 'row row--between' }, h('h2', null, `Apresentações encontradas (${total})`), actions),
    anyDoneBefore && !state.running ? h('label', { class: 'checkline hint' }, redo, 'Reenviar também as que já foram enviadas nesta sessão') : null,
    h('ul', { class: 'queue', role: 'list', 'aria-label': 'Fila de importação' }, ...state.items.map(itemNode)));
  replace(overall, h('div', { class: 'panel' }, h('p', { class: 'label' }, `${finished} de ${total} concluídas`), h('progress', { max: total, value: finished, 'aria-label': 'Progresso geral da importação', id: 'progresso-geral' })));
}

function clearAll() { state.items = []; state.seen.clear(); state.finished = false; clear(reportBox); drawQueue(); }

async function addFiles(files) {
  if (state.running) { toast('Aguarde o fim da importação para adicionar mais arquivos.', { kind: 'info' }); return; }
  if (!core) return;
  const list = [...files];
  if (!list.length) return;
  replace(problemsBox, h('div', { class: 'loading', role: 'status' }, icon('spinner', 'spin'), 'Lendo arquivos…'));
  const { added, problems } = await readFiles(list);
  state.items.push(...added);
  state.finished = false; clear(reportBox);
  replace(problemsBox, ...(problems.length ? [alertBox('warn', problems.length === 1 ? problems[0] : `${problems.length} arquivos com problema: ${problems.join(' ')}`)] : []));
  if (added.length) setLive(`${plural(added.length, 'apresentação encontrada', 'apresentações encontradas')}.`);
  drawQueue();
  if (added.length) $('#btn-importar')?.focus();
}

input.addEventListener('change', async () => { await addFiles(input.files); input.value = ''; });
for (const ev of ['dragenter', 'dragover']) dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); });
for (const ev of ['dragleave', 'dragend']) dropzone.addEventListener(ev, () => dropzone.classList.remove('is-over'));
/* Arrastar uma PASTA: percorre as entradas (FileSystemEntry) e recolhe os .json/.html de dentro; arquivos soltos seguem como antes. */
async function filesFromDrop(dt) {
  const items = dt?.items ? [...dt.items] : [];
  const entries = items.map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null));
  if (!entries.some((en) => en && en.isDirectory)) return dt?.files || [];
  const out = [];
  const walk = (entry) => new Promise((resolve) => {
    if (!entry) return resolve();
    if (entry.isFile) return entry.file((f) => { if (/\.(json|html?)$/i.test(f.name)) out.push(f); resolve(); }, () => resolve());
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => reader.readEntries(async (ents) => { if (!ents.length) return resolve(); for (const en of ents) await walk(en); readAll(); }, () => resolve());
      return readAll();
    }
    resolve();
  });
  for (const en of entries) await walk(en);
  return out;
}
dropzone.addEventListener('drop', async (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); addFiles(await filesFromDrop(e.dataTransfer)); });

/* ───────── execução ───────── */
const guard = (e) => { e.preventDefault(); e.returnValue = ''; };

async function importOne(it) {
  it.status = 'running'; it.msg = 'Preparando imagens…'; it.progress = null; it.stats = null;
  updateItem(it);
  /* SVG, BMP, AVIF, ICO… (o servidor só guarda PNG, JPEG, WebP e GIF) viram PNG no navegador antes de subir */
  const deck = typeof core.rasterizeForeignImages === 'function' ? await core.rasterizeForeignImages(it.deck, { rasterize: core.browserRasterize }) : it.deck;
  const { content, stats } = await core.externalizeDeck(deck, {
    api: assetApi, cache: state.cache, maxConcurrent: 4, maxBytes: SHRINK_TARGET, shrink: shrinkImage,
    onProgress: (info) => {
      if (!info) return;
      const total = Number.isFinite(info.total) ? info.total : 0; const dn = Math.min(info.done ?? 0, total);
      if (info.phase === 'hash') it.msg = total ? `Preparando imagens (${dn}/${total})…` : 'Preparando…';
      else if (info.phase === 'check') it.msg = 'Conferindo o que já existe no servidor…';
      else if (info.phase === 'upload') it.msg = total ? `Enviando imagens novas (${dn}/${total})…` : 'Nenhuma imagem nova para enviar.';
      it.progress = total > 0 ? { done: dn, total } : null;
      updateItem(it);
    },
  });
  it.stats = stats; it.progress = null; it.msg = 'Criando apresentação…'; updateItem(it);
  const body = { title: it.title.slice(0, 200), content, source: 'import' };
  const r = await api.post('/api/presentations', body, { timeout: 120000 });
  it.presentationId = r?.id || null;
  it.status = 'done'; it.msg = 'Importada.';
  done[it.key] = it.presentationId; writeDone(done);
}

function failMessage(e) {
  if (e instanceof ApiError) {
    if (e.code === 'rejected_content') return `O servidor recusou o conteúdo: ${e.message}`;
    if (e.code === 'too_large') return 'A apresentação é grande demais para importar de uma vez.';
    return e.message;
  }
  return e?.message || 'Erro inesperado.';
}

function updateItem(it) {
  const li = queueBox.querySelector(`li[data-n="${it.n}"]`);
  if (li) li.replaceWith(itemNode(it));
  const finished = state.items.filter((i) => ['done', 'skipped', 'error'].includes(i.status)).length;
  const g = $('#progresso-geral'); if (g) { g.value = finished; g.previousElementSibling.textContent = `${finished} de ${state.items.length} concluídas`; }
}

async function run({ retry = false } = {}) {
  if (state.running || !core) return;
  state.running = true; state.stop = false; clear(reportBox);
  addEventListener('beforeunload', guard);
  const force = Boolean(redo.checked);
  const todo = state.items.filter((i) => (retry ? i.status === 'error' : i.status === 'pending'));
  if (retry) for (const i of todo) { i.status = 'pending'; i.msg = 'Na fila'; }
  drawQueue();
  setLive(`Importando ${plural(todo.length, 'apresentação', 'apresentações')}…`);
  for (const it of todo) {
    if (state.stop) break;
    if (done[it.key] && !force) { it.status = 'skipped'; it.presentationId = done[it.key]; it.msg = 'Já enviada nesta sessão — pulada.'; updateItem(it); continue; }
    try { await importOne(it); } catch (e) {
      if (e?.redirecting) return;
      it.status = 'error'; it.msg = failMessage(e); it.progress = null;
    }
    updateItem(it);
    const pos = state.items.filter((i) => ['done', 'skipped', 'error'].includes(i.status)).length;
    setLive(`${pos} de ${state.items.length} concluídas.`);
  }
  removeEventListener('beforeunload', guard);
  state.running = false; state.finished = true;
  drawQueue();
  drawReport();
  const s = summary();
  setLive(`Importação concluída: ${s.done} importada${s.done === 1 ? '' : 's'}, ${s.error} com falha.`);
  announce(`Importação concluída: ${s.done} importadas, ${s.error} com falha.`);
}

/* ───────── relatório ───────── */
function summary() {
  const s = { total: state.items.length, done: 0, skipped: 0, error: 0, pending: 0, found: 0, uploaded: 0, dedup: 0, bytes: 0 };
  for (const i of state.items) {
    s[i.status] = (s[i.status] || 0) + 1;
    if (i.stats) { s.found += i.stats.found || 0; s.uploaded += i.stats.uploaded || 0; s.dedup += i.stats.deduplicated || 0; s.bytes += i.stats.bytes || 0; }
  }
  return s;
}

function tile(value, label, key) { return h('div', { class: 'stat', dataset: { stat: key } }, h('div', { class: 'stat__v' }, value), h('div', { class: 'stat__l' }, label)); }

function drawReport() {
  const s = summary();
  const failed = state.items.filter((i) => i.status === 'error');
  replace(reportBox, h('section', { class: 'report', 'aria-labelledby': 'rel-titulo' },
    h('div', { class: 'row row--between' }, h('h2', { id: 'rel-titulo', tabindex: '-1' }, 'Relatório da importação'),
      h('div', { class: 'row' }, button({ label: 'Baixar relatório (CSV)', icon: 'download', onClick: downloadCsv, attrs: { id: 'btn-csv' } }), s.done || s.skipped ? button({ label: 'Ver no acervo', icon: 'slides', variant: 'primary', href: '/acervo?aba=minhas', attrs: { id: 'ver-acervo' } }) : null)),
    h('div', { class: 'stats stats--3' },
      tile(formatNumber(s.done), 'Importadas', 'importadas'), tile(formatNumber(s.skipped), 'Puladas (já enviadas)', 'puladas'), tile(formatNumber(s.error), 'Com falha', 'falhas'),
      tile(formatBytes(s.bytes), 'Enviado agora', 'bytes'), tile(formatNumber(s.dedup), 'Arquivos já existentes (sem reenviar)', 'dedup'), tile(formatNumber(s.found), 'Imagens encontradas', 'imagens')),
    failed.length ? h('div', { class: 'alert alert--error' }, icon('alert'), h('div', null, h('p', null, `${plural(failed.length, 'apresentação falhou', 'apresentações falharam')}:`), h('ul', null, ...failed.map((i) => h('li', null, `${i.title} — ${i.msg}`))))) : alertBox('ok', 'Tudo certo: nenhuma falha.')));
  $('#rel-titulo')?.focus();
}

function downloadCsv() {
  const rows = [csvLine(['arquivo', 'titulo', 'situacao', 'apresentacao_id', 'imagens', 'enviadas', 'deduplicadas', 'bytes_enviados', 'motivo'])];
  const label = { done: 'importada', skipped: 'pulada', error: 'falha', pending: 'pendente', running: 'em andamento' };
  for (const i of state.items) rows.push(csvLine([i.file, i.title, label[i.status] || i.status, i.presentationId || '', i.stats?.found ?? '', i.stats?.uploaded ?? '', i.stats?.deduplicated ?? '', i.stats?.bytes ?? '', i.status === 'error' ? i.msg : '']));
  const blob = new Blob([`﻿${rows.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `relatorio-importacao-${new Date().toISOString().slice(0, 10)}.csv`, class: 'sr-only' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ───────── início ───────── */
if (!core || typeof core.externalizeDeck !== 'function') {
  replace(problemsBox, alertBox('error', 'O componente de importação não carregou. Recarregue a página; se continuar, avise um administrador.'));
  input.disabled = true; dropzone.setAttribute('aria-disabled', 'true');
  toastError(new Error('Componente de importação indisponível.'));
}
