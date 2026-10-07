/* /acervo — tela principal: acervo comum (todos veem; só o dono altera; para usar a de outra pessoa, crie uma cópia).
   Visual = capa do editor ("Minhas obras" e "Projetos prontos"): prancha navy, cartões .cv-hcard, sobretítulos em mono.
   Dono/admin, no menu do cartão: "Respostas e participações…" (formulários, votos e post-its guardados no servidor — GET/DELETE
   /api/presentations/:id/interactions e o CSV), "Histórico de versões" (/editor/<id>?historico=1) e "Baixar como HTML/PDF/PowerPoint"
   (/editor/<id>?exportar=html|pdf|pptx, em nova aba: o editor em nuvem abre e exporta). "Nova a partir de projeto pronto" cria a
   apresentação com o nome do projeto e abre /editor/<id>?modelo=<0..5> (o editor em nuvem monta o projeto pronto da capa). */
import { api, ApiError } from '../api.js';
import { requireUser } from '../session.js';
import {
  h, icon, button, avatar, menuButton, tabs, confirmDialog, chooseDialog, textDialog, copyText, toast, toastError, announce, debounce,
  withBusy, replace, clear, $, stateBlock, updateQuery, mountDialog, loadingBlock, eyebrow, greeting, downloadBlob,
} from '../ui.js';
import { timeAgo, formatDateTime, plural, isUuid, pad2, slug } from '../format.js';

const PAGE_SIZE = 24;
const SORT_CAP = 400;           // ao ordenar por outro critério, carregamos até este nº de itens para a ordem ser correta
const THUMB_RE = /^[0-9a-f]{64}$/;
const TABS = [
  { id: 'todas', label: 'Todas', icon: 'slides', scope: 'all' },
  { id: 'minhas', label: 'Minhas', icon: 'user', scope: 'mine' },
  { id: 'lixeira', label: 'Lixeira', icon: 'trash', scope: 'trash' },
];
const SORTS = [
  { id: 'updated', label: 'Atualizadas recentemente' },
  { id: 'created', label: 'Criadas recentemente' },
  { id: 'title', label: 'Título (A–Z)' },
  { id: 'slides', label: 'Mais slides' },
];
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const SORTERS = {
  updated: null,
  created: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
  title: (a, b) => collator.compare(a.title || '', b.title || ''),
  slides: (a, b) => (b.slideCount || 0) - (a.slideCount || 0),
};
/* Os 6 "Projetos prontos" da capa do editor, NA MESMA ORDEM (studio/cover.js, TPL; o índice vai em ?modelo=). Miniatura = 1º slide de cada um,
   gerada do editor original por tests/web/miniaturas-modelos.mjs. O teste web confere nomes e descrições contra o cover.js. */
const MODELOS = [
  { nome: 'Proposta comercial', desc: 'Contexto, abordagem, cronograma, equipe e investimento.', slides: 7 },
  { nome: 'Diagnóstico de maturidade', desc: 'Régua de maturidade, riscos, SWOT e prioridades.', slides: 7 },
  { nome: 'Status report executivo', desc: 'KPIs, cronograma, riscos, resultados e decisões.', slides: 6 },
  { nome: 'Kickoff de projeto', desc: 'Objetivos, papéis, cronograma e ritos de governança.', slides: 6 },
  { nome: 'Comitê / Workshop', desc: 'Agenda, priorização, evolução e decisões da sessão.', slides: 6 },
  { nome: 'Apresentação institucional A&M', desc: 'Os 5 slides institucionais oficiais, um slide para o seu conteúdo e o encerramento.', slides: 7 },
];
const EXPORTS = [['html', 'HTML', 'file'], ['pdf', 'PDF', 'download'], ['pptx', 'PowerPoint', 'slides']];

const user = await requireUser({ active: 'acervo' });
const main = $('#conteudo');
document.title = 'Acervo — Canteiro · A&M';

const qs = new URLSearchParams(location.search);
const state = {
  tab: TABS.some((t) => t.id === qs.get('aba')) ? qs.get('aba') : 'todas',
  q: (qs.get('q') || '').slice(0, 120),
  sort: 'updated',
  items: [], nextCursor: null, loading: false, error: null, seq: 0, capped: false,
};
const slidesText = (n) => `${pad2(n ?? 0)} ${Number(n) === 1 ? 'slide' : 'slides'}`;

/* ───────── esqueleto da página (cabeçalho = .cv-ph; ferramentas = .cv-htools) ───────── */
const searchField = h('input', { class: 'input input--search', type: 'search', id: 'busca', name: 'q', placeholder: 'Buscar pelo título…', autocomplete: 'off', maxlength: 120, value: state.q, enterkeyhint: 'search' });
const sortSelect = h('select', { class: 'select', id: 'ordem' }, ...SORTS.map((s) => h('option', { value: s.id }, s.label)));
const statusLine = h('p', { class: 'status-line', id: 'status', role: 'status', 'aria-live': 'polite' });
const tabList = h('div', { class: 'tabs', 'aria-label': 'Filtrar apresentações' });
const panel = h('div', { id: 'painel', role: 'tabpanel', tabindex: '-1' });
const trashNote = h('div', { class: 'note', id: 'nota-lixeira', hidden: true }, icon('info'),
  h('p', null, 'As apresentações excluídas ficam aqui e podem ser restauradas. Só um administrador pode apagá-las de vez.'));
const newBtn = button({ label: 'Nova apresentação', icon: 'plus', variant: 'primary', attrs: { id: 'btn-nova' }, onClick: createNew });
const tplBtn = button({ label: 'Nova a partir de projeto pronto', icon: 'template', attrs: { id: 'btn-modelos', 'aria-haspopup': 'dialog' }, onClick: (e) => openModelos(e.currentTarget) });
const firstName = String(user.displayName || '').trim().split(/\s+/)[0] || '';

replace(main,
  h('div', { class: 'page__head' },
    h('div', null,
      eyebrow(`${greeting()}${firstName ? `, ${firstName}` : ''} — vamos construir?`),
      h('h1', { id: 'titulo' }, 'Acervo de apresentações'),
      h('p', { class: 'lead' }, 'Tudo o que é salvo fica visível para todos, em modo leitura. Só o dono edita — para usar a apresentação de outra pessoa, crie uma cópia.')),
    h('div', { class: 'page__actions' }, tplBtn, newBtn)),
  h('div', { class: 'toolbar' },
    h('form', { class: 'toolbar__search search-wrap', role: 'search', 'aria-label': 'Buscar apresentações', on: { submit: (e) => { e.preventDefault(); onSearch.flush(); } } },
      h('label', { for: 'busca', class: 'sr-only' }, 'Buscar apresentações por título'), icon('search'), searchField),
    tabList,
    h('span', { class: 'toolbar__sp' }),
    h('div', { class: 'toolbar__sort' }, h('label', { for: 'ordem' }, 'Ordenar por'), sortSelect)),
  trashNote, statusLine, panel);

/* ───────── dados ───────── */
const scopeOf = () => TABS.find((t) => t.id === state.tab).scope;

async function load({ more = false } = {}) {
  if (state.loading && more) return;
  const mySeq = ++state.seq;
  state.loading = true; state.error = null;
  if (!more) { state.items = []; state.nextCursor = null; state.capped = false; renderSkeleton(); }
  else setMoreBusy(true);
  try {
    let cursor = more ? state.nextCursor : null;
    let guard = 0;
    for (;;) {
      const r = await api.get('/api/presentations', { query: { scope: scopeOf(), q: state.q || undefined, limit: PAGE_SIZE, cursor: cursor || undefined } });
      if (mySeq !== state.seq) return; // chegou resposta velha: ignora
      const fresh = (r.items || []).filter((it) => isUuid(it.id));
      state.items = state.items.concat(fresh);
      state.nextCursor = r.nextCursor || null;
      cursor = state.nextCursor;
      const needAll = state.sort !== 'updated';
      if (!needAll || !cursor) break;
      if (state.items.length >= SORT_CAP || ++guard > 20) { state.capped = true; break; }
    }
    state.loading = false;
    renderList({ append: more && state.sort === 'updated' });
  } catch (e) {
    if (mySeq !== state.seq) return;
    state.loading = false; state.error = e;
    if (e?.redirecting) return;
    if (more) { setMoreBusy(false); toastError(e); } else renderError(e);
  }
}

/* ───────── renderização ───────── */
function sortedItems() {
  const f = SORTERS[state.sort];
  return f ? [...state.items].sort(f) : state.items;
}

function renderSkeleton() {
  panel.setAttribute('aria-busy', 'true');
  statusLine.textContent = 'Carregando apresentações…';
  replace(panel, h('ul', { class: 'cards', role: 'list', 'aria-hidden': 'true', id: 'esqueleto' },
    ...Array.from({ length: 8 }, () => h('li', { class: 'card card--skel' },
      h('div', { class: 'card__thumb' }, h('span', { class: 'skeleton sk-fill' })),
      h('div', { class: 'card__body' }, h('span', { class: 'skeleton sk-line sk-line--w40' }), h('span', { class: 'skeleton sk-line sk-line--w90' }), h('span', { class: 'skeleton sk-line sk-line--w60' }))))));
}

function renderError(e) {
  panel.removeAttribute('aria-busy');
  statusLine.textContent = '';
  replace(panel, stateBlock({
    iconName: 'alert', title: 'Não foi possível carregar o acervo',
    text: e?.message || 'Verifique sua conexão e tente de novo.',
    actions: [button({ label: 'Tentar de novo', icon: 'refresh', variant: 'primary', onClick: () => load(), attrs: { id: 'btn-retry' } })],
  }));
}

function renderEmpty() {
  const hasQ = Boolean(state.q);
  if (hasQ) {
    return stateBlock({ iconName: 'search', title: 'Nenhum resultado', text: `Não encontramos apresentações com “${state.q}”. Tente outra palavra ou limpe a busca.`,
      actions: [button({ label: 'Limpar busca', icon: 'x', onClick: () => { searchField.value = ''; applySearch(''); }, attrs: { id: 'btn-limpar' } })] });
  }
  if (state.tab === 'lixeira') return stateBlock({ iconName: 'trash', title: 'A lixeira está vazia', text: 'As apresentações que você excluir aparecem aqui e podem ser restauradas.' });
  if (state.tab === 'minhas') {
    return stateBlock({ art: true, title: 'Você ainda não criou apresentações', text: 'Crie uma do zero, comece de um projeto pronto, importe o seu acervo local ou abra uma do acervo e crie uma cópia para editar.',
      actions: [button({ label: 'Nova apresentação', icon: 'plus', variant: 'primary', onClick: createNew }), button({ label: 'Projetos prontos', icon: 'template', onClick: (e) => openModelos(e.currentTarget) }), button({ label: 'Importar acervo local', icon: 'upload', href: '/importar' })] });
  }
  return stateBlock({ art: true, title: 'O acervo ainda está vazio', text: 'Crie a primeira apresentação — ela ficará visível para todos.',
    actions: [button({ label: 'Nova apresentação', icon: 'plus', variant: 'primary', onClick: createNew }), button({ label: 'Projetos prontos', icon: 'template', onClick: (e) => openModelos(e.currentTarget) })] });
}

let listEl = null;
let moreBtn = null;
function renderList({ append = false } = {}) {
  panel.removeAttribute('aria-busy');
  trashNote.hidden = state.tab !== 'lixeira';
  const items = sortedItems();
  if (!items.length) { listEl = null; moreBtn = null; replace(panel, renderEmpty()); statusLine.textContent = state.q ? 'Nenhum resultado.' : ''; return; }
  if (!append || !listEl || !panel.contains(listEl)) {
    listEl = h('ul', { class: 'cards', role: 'list', 'aria-label': 'Apresentações' });
    for (const it of items) listEl.append(cardFor(it));
    replace(panel, listEl);
  } else {
    const known = new Set([...listEl.children].map((li) => li.dataset.id));
    let firstNew = null;
    for (const it of items) if (!known.has(it.id)) { const li = cardFor(it); firstNew ||= li; listEl.append(li); }
    firstNew?.querySelector('.card__title')?.focus({ preventScroll: true });   // o foco acompanha o conteúdo novo (o botão "Carregar mais" é recriado)
  }
  // botão "Carregar mais"
  panel.querySelector('.more-wrap')?.remove();
  moreBtn = null;
  if (state.nextCursor) {
    moreBtn = button({ label: 'Carregar mais', icon: 'chevron-down', attrs: { id: 'btn-mais' }, onClick: () => load({ more: true }) });
    panel.append(h('div', { class: 'more-wrap' }, moreBtn));
  } else if (state.capped) {
    panel.append(h('p', { class: 'hint more-wrap' }, `Mostrando as primeiras ${plural(SORT_CAP, 'apresentação', 'apresentações')}. Use a busca para refinar.`));
  }
  updateStatus();
}

function updateStatus() {
  const n = state.items.length;
  const more = state.nextCursor ? ' (há mais para carregar)' : '';
  const msg = state.q ? `${plural(n, 'resultado', 'resultados')} para “${state.q}”${more}` : `${plural(n, 'apresentação', 'apresentações')}${more}`;
  statusLine.textContent = msg;
}
function setMoreBusy(b) { if (moreBtn) { moreBtn.classList.toggle('is-busy', b); if (b) moreBtn.setAttribute('aria-disabled', 'true'); else moreBtn.removeAttribute('aria-disabled'); } }

function thumbNode(it, cls = 'card__thumb') {
  const box = h('div', { class: cls });
  const ph = () => box.append(h('div', { class: 'ph' }, icon('slides', 'ic--lg'), cls === 'card__thumb' ? h('span', null, 'Sem miniatura') : null));
  if (THUMB_RE.test(String(it.thumbSha || ''))) {
    const img = h('img', { src: `/api/assets/${it.thumbSha}`, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => { img.remove(); ph(); }, { once: true });
    box.append(img);
  } else ph();
  return box;
}

const exportUrl = (id, fmt) => `/editor/${id}?exportar=${fmt}`;
/** Itens do menu "⋯" do cartão. A ordem dos três primeiros é a de sempre (Detalhes, Criar cópia, Compartilhar). */
function menuItems(it, { canEdit, trash, titleBtn, menuRef }) {
  const list = [{ label: 'Detalhes e comentários', icon: 'message', action: 'details', onSelect: () => openDrawer(it, titleBtn) }];
  if (trash) {
    if (user.role === 'admin') list.push({ sep: true }, { label: 'Apagar de vez', icon: 'trash', danger: true, action: 'purge', onSelect: () => doPurge(it) });
    return list;
  }
  if (canEdit) list.push({ label: 'Criar cópia', icon: 'copy', action: 'duplicate', onSelect: () => doDuplicate(it) });
  list.push({ label: 'Compartilhar', icon: 'link', action: 'share', onSelect: () => doShare(it) });
  if (canEdit) {
    list.push(
      { label: 'Respostas e participações…', icon: 'inbox', action: 'responses', onSelect: () => openResponses(it, menuRef()) },
      { label: 'Histórico de versões', icon: 'history', action: 'history', href: `/editor/${it.id}?historico=1` },
      { sep: true }, { header: 'Baixar como' },
      ...EXPORTS.map(([fmt, nome, ic]) => ({ label: `Baixar como ${nome}`, icon: ic, action: `export-${fmt}`, href: exportUrl(it.id, fmt), target: '_blank', ariaLabel: `Baixar como ${nome} (abre em nova aba)` })));
  }
  if (user.role === 'admin') list.push({ sep: true }, { label: 'Transferir propriedade…', icon: 'user', action: 'transfer', onSelect: () => doTransfer(it) });
  if (canEdit) list.push({ sep: true }, { label: 'Excluir', icon: 'trash', danger: true, action: 'delete', onSelect: () => doDelete(it) });
  return list;
}

function cardFor(it) {
  const own = it.owner?.id === user.id;
  const canEdit = own || user.role === 'admin';
  const trash = state.tab === 'lixeira' || it.deleted === true;
  const title = it.title?.trim() || 'Sem título';
  const id = it.id;
  const thumb = thumbNode(it);
  const titleBtn = h('button', { type: 'button', class: 'card__title', 'aria-haspopup': 'dialog', 'aria-label': `Detalhes de ${title}`, title, on: { click: () => openDrawer(it, titleBtn) } }, title);
  thumb.addEventListener('click', () => openDrawer(it, titleBtn));
  thumb.append(h('div', { class: 'card__badges' }, own ? h('span', { class: 'badge badge--own' }, 'Sua') : null, trash ? h('span', { class: 'badge badge--danger' }, 'Excluída') : null));

  const actions = h('div', { class: 'card__actions' });
  if (trash) {
    if (canEdit) actions.append(button({ label: 'Restaurar', icon: 'restore', variant: 'link', attrs: { 'data-action': 'restore', 'aria-label': `Restaurar ${title}` }, onClick: (e) => doRestore(it, e.currentTarget) }));
  } else {
    actions.append(button({ label: 'Apresentar', icon: 'play', variant: 'link', href: `/visualizar/${id}`, attrs: { 'data-action': 'present', 'aria-label': `Apresentar ${title}` } }));
    if (canEdit) actions.append(button({ label: 'Editar', icon: 'edit', variant: 'link', href: `/editor/${id}`, attrs: { 'data-action': 'edit', 'aria-label': `Editar ${title}` } }));
    else actions.append(button({ label: 'Criar cópia', icon: 'copy', variant: 'link', attrs: { 'data-action': 'duplicate', 'aria-label': `Criar cópia de ${title}` }, onClick: (e) => doDuplicate(it, e.currentTarget) }));
  }
  const more = menuButton({ label: `Mais ações para ${title}`, cls: 'btn btn--icon', items: () => menuItems(it, { canEdit, trash, titleBtn, menuRef: () => more.querySelector('button') }) });
  actions.append(more);

  return h('li', { class: 'card', dataset: { id }, 'data-owner': own ? 'me' : 'other' },
    thumb,
    h('div', { class: 'card__body' },
      h('div', { class: 'card__meta' },
        h('span', null, slidesText(it.slideCount)),
        h('span', { title: formatDateTime(it.updatedAt) }, h('time', { datetime: it.updatedAt }, `atualizada ${timeAgo(it.updatedAt)}`))),
      h('h3', null, titleBtn),
      h('div', { class: 'card__owner' }, avatar(it.owner?.displayName, { seed: it.owner?.id }), h('span', { class: 'nm' }, it.owner?.displayName || 'Desconhecido')),
      !own && !trash ? h('p', { class: 'card__readonly' }, icon('lock'), 'Para usar esta apresentação, crie uma cópia.') : null),
    actions);
}

/* ───────── ações ───────── */
async function createNew(ev) {
  const btn = ev?.currentTarget || newBtn;
  await withBusy(btn, async () => {
    try {
      const r = await api.post('/api/presentations', { source: 'new' });
      if (!isUuid(r?.id)) throw new ApiError(500, 'internal', 'Resposta inesperada do servidor.');
      location.assign(`/editor/${r.id}`);
      await new Promise(() => {});
    } catch (e) { toastError(e, 'Não foi possível criar a apresentação.'); }
  }, 'Criando…');
}

async function doDuplicate(it, btn) {
  const run = async () => {
    try {
      const r = await api.post(`/api/presentations/${it.id}/duplicate`, {});
      if (!isUuid(r?.id)) throw new ApiError(500, 'internal', 'Resposta inesperada do servidor.');
      toast('Cópia criada. Abrindo no editor…', { kind: 'ok' });
      location.assign(`/editor/${r.id}`);
      await new Promise(() => {});
    } catch (e) { toastError(e, 'Não foi possível criar a cópia.'); }
  };
  if (btn) await withBusy(btn, run, 'Copiando…'); else await run();
}

async function doShare(it) {
  try {
    const r = await api.get(`/api/presentations/${it.id}/share`);
    const url = String(r?.url || '');
    if (!/^https?:\/\//.test(url)) throw new ApiError(500, 'internal', 'Resposta inesperada do servidor.');
    if (await copyText(url)) toast('Link copiado. Quem tiver acesso ao Canteiro poderá abrir a apresentação.', { kind: 'ok' });
    else await textDialog({ title: 'Link da apresentação', message: 'Copie o link abaixo (Ctrl+C):', value: url, eyebrow: 'Compartilhar' });
  } catch (e) { toastError(e, 'Não foi possível gerar o link.'); }
}

function removeCard(id) {
  state.items = state.items.filter((x) => x.id !== id);
  const li = listEl?.querySelector(`li[data-id="${id}"]`);
  const neighbour = li ? (li.nextElementSibling || li.previousElementSibling) : null;
  li?.remove();
  if (!state.items.length) { renderList(); panel.focus({ preventScroll: true }); } else { updateStatus(); (neighbour?.querySelector('.card__title') || panel).focus({ preventScroll: true }); }
}

async function doDelete(it) {
  const ok = await confirmDialog({ title: 'Excluir apresentação?', message: `“${it.title || 'Sem título'}” vai para a lixeira. Você poderá restaurá-la depois.`, confirmLabel: 'Excluir', danger: true, eyebrow: 'Mover para a lixeira', icon: 'trash' });
  if (!ok) return;
  try {
    await api.del(`/api/presentations/${it.id}`);
    removeCard(it.id);
    announce('Apresentação movida para a lixeira.');
    toast('Movida para a lixeira.', { kind: 'ok', timeout: 12000, action: { label: 'Desfazer', onClick: async () => {
      try { await api.post(`/api/presentations/${it.id}/restore`, {}); toast('Apresentação restaurada.', { kind: 'ok' }); load(); } catch (e) { toastError(e); }
    } } });
  } catch (e) { toastError(e, 'Não foi possível excluir.'); }
}

async function doRestore(it, btn) {
  await withBusy(btn, async () => {
    try {
      await api.post(`/api/presentations/${it.id}/restore`, {});
      removeCard(it.id);
      toast('Apresentação restaurada.', { kind: 'ok' });
    } catch (e) { toastError(e, 'Não foi possível restaurar.'); }
  }, 'Restaurando…');
}

/** Admin: passa a apresentação para outra pessoa (quem recebe passa a ser a única que a edita; o histórico e os comentários acompanham). */
async function doTransfer(it) {
  let people;
  try { people = (await api.get('/api/admin/users', { query: { status: 'active', limit: 200 } })).items || []; }
  catch (e) { toastError(e, 'Não foi possível listar as pessoas.'); return; }
  const options = people.filter((p) => p.id !== it.owner?.id).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'pt-BR')).map((p) => ({ value: p.id, label: `${p.displayName || 'Sem nome'} (${p.email})` }));
  if (!options.length) { toast('Não há outra pessoa ativa para receber a apresentação.'); return; }
  const toUserId = await chooseDialog({ title: 'Transferir propriedade', message: `“${it.title || 'Sem título'}” passará a pertencer à pessoa escolhida, que será a única a editá-la. O histórico de versões e os comentários acompanham a apresentação.`, options, confirmLabel: 'Transferir', selectLabel: 'Nova dona ou novo dono', eyebrow: 'Administração', icon: 'user' });
  if (!toUserId) return;
  try {
    const meta = await api.post(`/api/presentations/${it.id}/transfer`, { toUserId });
    const who = people.find((p) => p.id === toUserId);
    toast(`Apresentação transferida para ${who?.displayName || 'a pessoa escolhida'}.`, { kind: 'ok' });
    if (meta && meta.owner) it.owner = meta.owner; else it.owner = { id: toUserId, displayName: who?.displayName || '' };
    await load();
  } catch (e) { toastError(e, 'Não foi possível transferir.'); }
}
async function doPurge(it) {
  const ok = await confirmDialog({ title: 'Apagar de vez?', message: `“${it.title || 'Sem título'}” será apagada definitivamente, com o histórico de versões e comentários. Isso não pode ser desfeito.`, confirmLabel: 'Apagar de vez', danger: true, eyebrow: 'Lixeira', icon: 'trash' });
  if (!ok) return;
  try {
    await api.del(`/api/presentations/${it.id}`, { query: { purge: 1 } });
    removeCard(it.id);
    toast('Apresentação apagada.', { kind: 'ok' });
  } catch (e) { toastError(e, 'Não foi possível apagar.'); }
}

/* ───────── nova a partir de projeto pronto (= vista "Projetos prontos" da capa) ───────── */
function openModelos(returnFocusTo) {
  const dlg = h('dialog', { class: 'dlg dlg--prancha', id: 'modelos', 'aria-labelledby': 'mod-titulo', 'aria-describedby': 'mod-desc' });
  const back = button({ label: 'Voltar', icon: 'arrow-left', attrs: { 'data-act': 'cancel' }, onClick: () => dlg.close() });
  back.append(h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'Esc'));
  const grid = h('ul', { class: 'tpl__grid', role: 'list', 'aria-label': 'Projetos prontos' });
  const key = (t) => h('kbd', { class: 'kbd' }, t);
  let busy = false;
  MODELOS.forEach((m, i) => {
    const b = h('button', { type: 'button', class: 'tpl', dataset: { modelo: i }, 'aria-keyshortcuts': String(i + 1), 'aria-label': `${m.nome} — ${m.desc}` },
      h('img', { class: 'tpl__pv', src: `/assets/modelos/modelo-${i + 1}.png`, alt: '', width: 640, height: 360, decoding: 'async' }),
      h('span', { class: 'tpl__b' },
        h('span', { class: 'tpl__meta' }, h('span', { class: 'tpl__st' }, slidesText(m.slides)), key(String(i + 1))),
        h('span', { class: 'tpl__name' }, m.nome),
        h('span', { class: 'tpl__desc' }, m.desc)));
    b.addEventListener('click', () => choose(i, b));
    grid.append(h('li', null, b));
  });
  dlg.append(h('div', { class: 'tpl__in' },
    h('header', { class: 'tpl__h' }, back,
      h('div', { class: 'tpl__ht' }, h('h2', { id: 'mod-titulo' }, 'Projetos prontos'), h('p', { id: 'mod-desc' }, 'Roteiros completos para adaptar — escolha um e edite à vontade.')),
      h('span', { class: 'tpl__n' }, `${pad2(MODELOS.length)} projetos`)),
    grid,
    h('footer', { class: 'tpl__foot' },
      h('p', { class: 'note' }, icon('info'), h('span', null, 'A apresentação é criada no seu acervo com o nome do projeto e abre no editor já montada, pronta para adaptar.')),
      h('p', { class: 'tpl__keys', 'aria-hidden': 'true' }, key('1'), '–', key(String(MODELOS.length)), h('em', null, 'escolher'), key('←'), key('→'), h('em', null, 'navegar'), key('Enter'), h('em', null, 'abrir'), key('Esc'), h('em', null, 'voltar')))));

  async function choose(i, b) {
    if (busy) return;
    busy = true;
    const st = b.querySelector('.tpl__st'); const before = st.textContent;
    dlg.classList.add('is-busy'); b.classList.add('is-busy'); b.setAttribute('aria-busy', 'true'); st.textContent = 'Criando…';
    try {
      const r = await api.post('/api/presentations', { source: 'new', title: MODELOS[i].nome });
      if (!isUuid(r?.id)) throw new ApiError(500, 'internal', 'Resposta inesperada do servidor.');
      announce(`Criando “${MODELOS[i].nome}”. Abrindo no editor.`);
      location.assign(`/editor/${r.id}?modelo=${i}`);
      await new Promise(() => {});
    } catch (e) {
      busy = false; dlg.classList.remove('is-busy'); b.classList.remove('is-busy'); b.removeAttribute('aria-busy'); st.textContent = before;
      toastError(e, 'Não foi possível criar a apresentação.');
    }
  }
  // teclado da capa: 1–6 escolhem, setas/Home/End navegam, Enter abre, Esc volta (o <dialog> fecha sozinho)
  dlg.addEventListener('keydown', (e) => {
    if (busy || e.ctrlKey || e.metaKey || e.altKey) return;
    const cards = [...grid.querySelectorAll('.tpl')];
    if (/^[1-9]$/.test(e.key) && cards[Number(e.key) - 1]) { e.preventDefault(); const b = cards[Number(e.key) - 1]; b.focus(); choose(Number(e.key) - 1, b); return; }
    const k = cards.indexOf(document.activeElement);
    if (k < 0) return;
    const go = (n) => { e.preventDefault(); cards[(n + cards.length) % cards.length].focus(); };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(k + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(k - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(cards.length - 1);
  });
  dlg.addEventListener('close', () => { if (returnFocusTo?.isConnected) returnFocusTo.focus(); }, { once: true });
  mountDialog(dlg);
  grid.querySelector('.tpl')?.focus();
}

/* ───────── respostas e participações (dono/admin): o que foi coletado no servidor, por elemento ───────── */
const KINDS = {
  form_response: { label: 'Formulário', icon: 'form', one: 'resposta', many: 'respostas' },
  vote_state: { label: 'Votação por pontos', icon: 'vote', one: 'voto', many: 'votos' },
  board_state: { label: 'Quadro de post-its', icon: 'note', one: 'nota', many: 'notas' },
  view: { label: 'Visualizações', icon: 'eye', one: 'registro', many: 'registros' },
  reaction: { label: 'Reações', icon: 'message', one: 'reação', many: 'reações' },
};
const FX_KIND = { form: 'form_response', vote: 'vote_state', board: 'board_state' };
const POSTIT = new Set(['y', 'p', 'b', 'g', 'o']);
const MAX_ROWS = 50;
const lines = (v) => String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
/** Valor de resposta em texto (listas viram "a; b"; objetos, JSON) — o mesmo critério do CSV do servidor. */
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(cellText).join('; ');
  try { return JSON.stringify(v); } catch { return ''; }
}
/** elementId → { kind, slide, title, data } dos componentes interativos do deck (só para rotular; sem o conteúdo, mostra o identificador). */
function interactiveElements(content) {
  const out = new Map();
  (Array.isArray(content?.slides) ? content.slides : []).forEach((s, i) => (Array.isArray(s?.els) ? s.els : []).forEach((el) => {
    if (el && el.type === 'fx' && FX_KIND[el.kind] && typeof el.id === 'string' && !out.has(el.id)) out.set(el.id, { kind: FX_KIND[el.kind], slide: i + 1, title: String(el.data?.title ?? '').trim(), data: el.data && typeof el.data === 'object' ? el.data : {} });
  }));
  return out;
}

function openResponses(it, returnFocusTo) {
  const title = it.title?.trim() || 'Sem título';
  const body = h('div', { class: 'dlg__b', id: 'resp-corpo' }, loadingBlock('Carregando respostas…'));
  const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite', id: 'resp-status' });
  const dlg = h('dialog', { class: 'dlg dlg--wide', id: 'respostas', 'aria-labelledby': 'resp-titulo', 'aria-describedby': 'resp-desc' });
  const close = () => dlg.close();
  dlg.append(
    h('header', { class: 'dlg__h' },
      h('div', { class: 'dlg__ic', 'aria-hidden': 'true' }, icon('inbox')),
      h('div', { class: 'dlg__hd' },
        h('div', { class: 'ey' }, 'Respostas e participações'),
        h('h2', { id: 'resp-titulo' }, title),
        h('p', { id: 'resp-desc' }, 'Formulários, votações e quadros de post-its: o que as pessoas enviaram ao apresentar ou visualizar esta apresentação, guardado no servidor.')),
      button({ label: 'Fechar', icon: 'x', iconOnly: true, cls: 'dlg__x', onClick: close, attrs: { id: 'resp-fechar' } })),
    body, live,
    h('footer', { class: 'dlg__f' },
      h('p', { class: 'note' }, icon('lock'), h('span', null, 'Só o dono e os administradores veem e apagam estas respostas.')),
      button({ label: 'Fechar', onClick: close, attrs: { 'data-act': 'cancel' } })));
  dlg.addEventListener('close', () => { if (returnFocusTo?.isConnected) returnFocusTo.focus(); }, { once: true });
  mountDialog(dlg);
  load();

  async function load(focusElementId) {
    let r; let pres = null;
    try {
      [r, pres] = await Promise.all([
        api.get(`/api/presentations/${it.id}/interactions`),
        api.get(`/api/presentations/${it.id}`).catch(() => null),   // só rótulos (título e slide de cada elemento); sem ele, segue com o identificador
      ]);
    } catch (e) {
      if (e?.redirecting || !dlg.open) return;
      replace(body, h('div', { class: 'alert alert--error', role: 'alert' }, icon('alert'), h('p', null, e?.message || 'Não foi possível carregar as respostas.')),
        h('div', { class: 'row' }, button({ label: 'Tentar de novo', icon: 'refresh', attrs: { id: 'resp-retry' }, onClick: () => { replace(body, loadingBlock('Carregando respostas…')); load(); } })));
      return;
    }
    if (!dlg.open) return;
    render(r, pres?.content);
    if (focusElementId != null) body.querySelector(`.resp[data-element="${CSS.escape(focusElementId)}"] h3`)?.focus();
  }

  function render(r, content) {
    const els = interactiveElements(content);
    const items = (Array.isArray(r?.items) ? r.items : []).filter((x) => x && KINDS[x.kind] && typeof x.elementId === 'string');
    const groups = new Map();
    for (const [elementId, info] of els) groups.set(`${info.kind}|${elementId}`, { kind: info.kind, elementId, info, items: [] });
    for (const x of items) {
      const k = `${x.kind}|${x.elementId}`;
      if (!groups.has(k)) groups.set(k, { kind: x.kind, elementId: x.elementId, info: els.get(x.elementId) || null, items: [] });
      groups.get(k).items.push(x);
    }
    const list = [...groups.values()].sort((a, b) => (a.info?.slide ?? 1e9) - (b.info?.slide ?? 1e9));
    if (!list.length) {
      replace(body, h('div', { class: 'state', id: 'resp-vazio' }, icon('inbox', 'ic--xl'), h('h3', null, 'Nenhuma resposta ainda'),
        h('p', null, 'Esta apresentação não tem formulário, votação nem quadro de post-its com respostas. Quando alguém participar ao apresentar ou visualizar, tudo aparece aqui — com quem respondeu e quando.')));
      live.textContent = 'Nenhuma resposta ainda.';
      return;
    }
    const people = new Set(items.map((x) => x.author?.id || x.user?.id).filter(Boolean)).size;
    replace(body,
      h('p', { class: 'resp__sum', id: 'resp-resumo' }, `${plural(list.length, 'elemento interativo', 'elementos interativos')} · ${plural(items.length, 'registro', 'registros')} de ${plural(people, 'pessoa', 'pessoas')}`),
      r?.truncated ? h('div', { class: 'alert alert--info' }, icon('info'), h('p', null, 'Mostrando os primeiros 1.000 registros. Baixe o CSV de cada elemento para ver tudo.')) : null,
      ...list.map(groupNode));
    live.textContent = `${plural(items.length, 'registro', 'registros')} em ${plural(list.length, 'elemento', 'elementos')}.`;
  }

  function groupNode(g) {
    const K = KINDS[g.kind];
    const gid = `resp-${g.kind}-${g.elementId}`.replace(/[^\w-]/g, '_');
    const name = g.info?.title || (g.elementId ? `${K.label} ${g.elementId}` : K.label);
    const where = g.info ? `slide ${g.info.slide}` : 'fora do conteúdo atual';
    const people = new Set(g.items.map((x) => x.author?.id || x.user?.id).filter(Boolean)).size;
    let count = g.items.length; let content = null;
    if (g.kind === 'form_response') content = formTable(g);
    else if (g.kind === 'vote_state') ({ count, node: content } = voteSummary(g));
    else if (g.kind === 'board_state') ({ count, node: content } = boardSummary(g));
    const acts = h('div', { class: 'resp__acts' });
    if (g.items.length && g.elementId) {
      acts.append(
        button({ label: 'Baixar CSV', icon: 'download', size: 'sm', attrs: { 'data-act': 'csv', 'aria-label': `Baixar CSV: ${name}` }, onClick: (e) => downloadCsv(g, name, e.currentTarget) }),
        button({ label: 'Apagar respostas deste elemento', icon: 'trash', size: 'sm', variant: 'ghost', attrs: { 'data-act': 'apagar', 'aria-label': `Apagar respostas deste elemento: ${name}` }, onClick: (e) => wipe(g, { name, where, count }, e.currentTarget) }));
    }
    return h('section', { class: 'resp', 'aria-labelledby': gid, dataset: { kind: g.kind, element: g.elementId } },
      h('div', { class: 'resp__h' },
        h('span', { class: 'resp__ic', 'aria-hidden': 'true' }, icon(K.icon)),
        h('div', { class: 'resp__hd' },
          h('div', { class: 'ey' }, `${K.label} · ${where}`),
          h('h3', { id: gid, tabindex: '-1' }, name),
          h('p', { class: 'resp__count' }, g.items.length ? `${plural(count, K.one, K.many)} · ${plural(people, 'pessoa', 'pessoas')}` : 'Ainda sem respostas')),
        acts),
      g.items.length
        ? (content ? h('div', { class: 'resp__body' }, content) : null)
        : h('p', { class: 'resp__empty' }, 'Quando alguém participar ao apresentar ou visualizar, aparece aqui.'));
  }

  /** Formulário: uma linha por resposta (mais recentes primeiro), colunas = perguntas (união, na ordem em que aparecem). */
  function formTable(g) {
    const cols = []; const index = new Map();
    const rows = g.items.map((x) => {
      const p = x.payload && typeof x.payload === 'object' ? x.payload : {};
      const q = Array.isArray(p.q) ? p.q : []; const a = Array.isArray(p.a) ? p.a : [];
      const cells = new Map(); const seen = new Map();
      q.forEach((qq, i) => {
        let col = cellText(qq).trim() || `Pergunta ${i + 1}`;
        const n = (seen.get(col) || 0) + 1; seen.set(col, n); if (n > 1) col = `${col} (${n})`;
        if (!index.has(col) && cols.length < 30) { index.set(col, cols.length); cols.push(col); }
        cells.set(col, cellText(a[i]));
      });
      return { x, cells };
    });
    const shown = rows.slice(-MAX_ROWS).reverse();
    const table = h('table', { class: 'tbl' },
      h('caption', { class: 'sr-only' }, 'Respostas do formulário'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Quando'), h('th', { scope: 'col' }, 'Pessoa'), ...cols.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, ...shown.map(({ x, cells }) => h('tr', null,
        h('td', { class: 'nowrap', title: formatDateTime(x.createdAt) }, h('time', { datetime: x.createdAt }, formatDateTime(x.createdAt))),
        h('td', null, x.author?.displayName || x.user?.displayName || 'Alguém'),
        ...cols.map((c) => h('td', null, cells.get(c) ?? ''))))));
    return [h('div', { class: 'resp__scroll', tabindex: '0', role: 'region', 'aria-label': 'Tabela de respostas (role para ver todas as colunas)' }, table),
      rows.length > MAX_ROWS ? h('p', { class: 'resp__more' }, `Mostrando as ${MAX_ROWS} mais recentes de ${rows.length}. O CSV traz todas.`) : null];
  }

  /** Votação: soma os pontos de todas as pessoas por opção (cada linha guardada é um voto). */
  function voteSummary(g) {
    let opts = []; let votes = 0; const totals = [];
    for (const x of g.items) {
      const p = x.payload && typeof x.payload === 'object' ? x.payload : {};
      if (Array.isArray(p.q) && p.q.length) opts = p.q.map((o) => cellText(o));
      for (const row of Array.isArray(p.rows) ? p.rows : []) {
        votes++;
        (Array.isArray(row?.a) ? row.a : []).forEach((v, i) => { if (i < 50) totals[i] = (totals[i] || 0) + (Number(v) || 0); });
      }
    }
    if (!opts.length) opts = lines(g.info?.data?.opts);
    const n = Math.max(opts.length, totals.length);
    const vals = Array.from({ length: n }, (_, i) => totals[i] || 0);
    const sum = vals.reduce((s, v) => s + v, 0); const max = Math.max(1, ...vals);
    const node = h('ul', { class: 'votes', role: 'list', 'aria-label': 'Resultado da votação' }, ...vals.map((t, i) => {
      const label = opts[i] || `Opção ${i + 1}`;
      return h('li', { class: t === max && t > 0 ? 'is-top' : null, dataset: { total: t } },
        h('span', { class: 'votes__l' }, label),
        h('progress', { max, value: t, 'aria-label': `${label}: ${plural(t, 'ponto', 'pontos')}` }),
        h('span', { class: 'votes__v' }, `${t} · ${sum ? Math.round((t / sum) * 100) : 0}%`));
    }));
    return { count: votes, node };
  }

  /** Quadro: notas de todas as pessoas por coluna; nota igual (mesma coluna e texto) aparece uma vez, com quem a tem. As notas iniciais do slide ficam marcadas. */
  function boardSummary(g) {
    const cols = lines(g.info?.data?.cols);
    const seeds = new Set((Array.isArray(g.info?.data?.notes) ? g.info.data.notes : []).map((n) => `${Math.max(0, Number(n?.c) | 0)}|${String(n?.t ?? '').trim()}`));
    const notes = new Map();
    for (const x of g.items) {
      for (const n of Array.isArray(x.payload?.notes) ? x.payload.notes : []) {
        const t = String(n?.t ?? '').trim(); if (!t) continue;
        const c = Math.min(49, Math.max(0, Number(n?.c) | 0)); const k = `${c}|${t}`;
        if (!notes.has(k)) notes.set(k, { c, t, color: POSTIT.has(n?.k) ? n.k : 'y', who: new Set(), seed: seeds.has(k) });
        notes.get(k).who.add(x.author?.displayName || x.user?.displayName || 'Alguém');
      }
    }
    const all = [...notes.values()];
    const ncol = Math.max(cols.length, 1, ...all.map((n) => n.c + 1));
    const node = h('div', { class: 'board' }, ...Array.from({ length: ncol }, (_, c) => {
      const mine = all.filter((n) => n.c === c).sort((a, b) => Number(a.seed) - Number(b.seed));
      return h('div', { class: 'board__col' },
        h('h4', null, h('span', null, cols[c] || `Coluna ${c + 1}`), h('span', null, String(mine.filter((n) => !n.seed).length))),
        mine.length
          ? h('ul', { role: 'list' }, ...mine.map((n) => h('li', { class: `postit postit--${n.color}${n.seed ? ' is-seed' : ''}` },
            h('p', null, n.t), h('small', null, n.seed ? 'Nota inicial do slide' : `por ${[...n.who].join(', ')}`))))
          : h('p', { class: 'resp__empty' }, 'Sem notas.'));
    }));
    return { count: all.filter((n) => !n.seed).length, node };
  }

  async function downloadCsv(g, name, btn) {
    await withBusy(btn, async () => {
      try {
        const blob = await api.get(`/api/presentations/${it.id}/interactions.csv`, { query: { kind: g.kind, elementId: g.elementId }, blob: true, timeout: 60000 });
        downloadBlob(blob, `respostas-${slug(title, 'apresentacao')}-${slug(name, g.elementId)}.csv`);
        live.textContent = `CSV de “${name}” baixado.`;
      } catch (e) { toastError(e, 'Não foi possível baixar o CSV.'); }
    }, 'Baixando…');
  }

  async function wipe(g, { name, where, count }, btn) {
    const K = KINDS[g.kind];
    const ok = await confirmDialog({
      eyebrow: 'Respostas e participações', icon: 'trash', danger: true,
      title: 'Apagar as respostas deste elemento?',
      message: `Isto apaga do servidor ${plural(count, K.one, K.many)} de “${name}” (${K.label.toLowerCase()}, ${where}), de todas as pessoas. Não dá para desfazer — se precisar guardar, baixe o CSV antes.`,
      confirmLabel: 'Apagar respostas',
    });
    if (!ok) { if (btn.isConnected) btn.focus(); return; }
    try {
      const r = await api.del(`/api/presentations/${it.id}/interactions`, { query: { elementId: g.elementId, kind: g.kind } });
      const n = Number(r?.deleted) || 0;
      toast(`${plural(n, 'registro apagado', 'registros apagados')} de “${name}”.`, { kind: 'ok' });
      await load(g.elementId);
      live.textContent = `${plural(n, 'registro apagado', 'registros apagados')} de ${name}.`;
    } catch (e) { toastError(e, 'Não foi possível apagar as respostas.'); }
  }
}

/* ───────── gaveta de detalhes e comentários ───────── */
const SLIDE_BASE = 0; // slideIndex do contrato é 0-based (app.comments.slide_index 0..499); a interface mostra "Slide N+1"

function openDrawer(it, returnFocusTo) {
  const own = it.owner?.id === user.id;
  const canEdit = own || user.role === 'admin';
  const trash = state.tab === 'lixeira' || it.deleted === true;
  const title = it.title?.trim() || 'Sem título';
  const dlg = h('dialog', { class: 'drawer', 'aria-labelledby': 'dr-titulo', id: 'gaveta' });
  const close = () => dlg.close();

  const actions = h('div', { class: 'row' });
  if (trash) {
    if (canEdit) actions.append(button({ label: 'Restaurar', icon: 'restore', variant: 'primary', size: 'sm', onClick: async (e) => { await doRestore(it, e.currentTarget); close(); } }));
  } else {
    if (canEdit) actions.append(button({ label: 'Editar', icon: 'edit', variant: 'primary', size: 'sm', href: `/editor/${it.id}` }));
    else actions.append(button({ label: 'Criar cópia', icon: 'copy', variant: 'primary', size: 'sm', attrs: { id: 'dr-copia' }, onClick: (e) => doDuplicate(it, e.currentTarget) }));
    actions.append(button({ label: 'Apresentar', icon: 'play', size: 'sm', href: `/visualizar/${it.id}` }));
    if (canEdit) actions.append(button({ label: 'Histórico de versões', icon: 'history', size: 'sm', href: `/editor/${it.id}?historico=1`, attrs: { id: 'dr-historico' } }));
    if (canEdit) actions.append(button({ label: 'Respostas e participações', icon: 'inbox', size: 'sm', attrs: { id: 'dr-respostas', 'aria-haspopup': 'dialog' }, onClick: (e) => openResponses(it, e.currentTarget) }));
    actions.append(button({ label: 'Compartilhar', icon: 'link', size: 'sm', onClick: () => doShare(it) }));
  }

  const info = h('dl', { class: 'dl' },
    h('dt', null, 'Dono'), h('dd', null, h('span', { class: 'row' }, avatar(it.owner?.displayName, { seed: it.owner?.id }), it.owner?.displayName || 'Desconhecido', own ? h('span', { class: 'badge badge--own' }, 'Sua') : null)),
    h('dt', null, 'Slides'), h('dd', null, String(it.slideCount ?? 0)),
    h('dt', null, 'Atualizada'), h('dd', null, `${formatDateTime(it.updatedAt)} (${timeAgo(it.updatedAt)})`),
    h('dt', null, 'Criada'), h('dd', null, formatDateTime(it.createdAt)),
    h('dt', null, 'Revisão'), h('dd', null, `nº ${it.rev ?? '—'}`),
    it.sourceId ? [h('dt', null, 'Origem'), h('dd', null, 'Cópia de outra apresentação do acervo')] : null);

  const commentsBox = h('div', { id: 'comentarios' });
  dlg.append(
    h('div', { class: 'drawer__head' },
      h('div', null, h('div', { class: 'ey' }, trash ? 'Na lixeira' : 'Detalhes da apresentação'), h('h2', { id: 'dr-titulo' }, title)),
      button({ label: 'Fechar detalhes', icon: 'x', iconOnly: true, cls: 'dlg__x', onClick: close, attrs: { id: 'dr-fechar' } })),
    h('div', { class: 'drawer__body' },
      thumbNode(it, 'drawer__thumb'),
      actions,
      !own && !trash ? h('div', { class: 'callout' }, icon('lock'), h('div', null, h('p', null, 'Para usar esta apresentação, crie uma cópia.'), h('span', null, 'Ela é do acervo comum e fica somente para leitura; a cópia é sua e você pode editá-la à vontade.'))) : null,
      h('section', { class: 'drawer__sec', 'aria-labelledby': 'dr-info' }, h('h3', { class: 'section-title', id: 'dr-info' }, 'Informações'), info),
      h('section', { class: 'drawer__sec', 'aria-labelledby': 'dr-com' }, h('h3', { class: 'section-title', id: 'dr-com' }, 'Comentários'), commentsBox)));
  dlg.addEventListener('close', () => { if (returnFocusTo?.isConnected) returnFocusTo.focus(); }, { once: true });
  mountDialog(dlg);
  mountComments(commentsBox, it);
}

async function mountComments(box, it) {
  const state2 = { items: [], showResolved: false };
  const list = h('div', { class: 'comments', id: 'lista-comentarios', 'aria-live': 'polite' });
  const toggleWrap = h('label', { class: 'checkline hint' }, h('input', { type: 'checkbox', id: 'ver-resolvidos', on: { change: (e) => { state2.showResolved = e.target.checked; draw(); } } }), 'Mostrar resolvidos');
  const area = h('textarea', { class: 'textarea', id: 'novo-comentario', name: 'body', maxlength: 2000, rows: 3, placeholder: 'Escreva um comentário (texto simples)…', 'aria-describedby': 'cm-contador' });
  const counter = h('p', { class: 'counter', id: 'cm-contador' }, '0/2000');
  const slideIn = h('input', { class: 'input', type: 'number', id: 'cm-slide', name: 'slide', min: 1, max: Math.max(1, it.slideCount || 500), inputmode: 'numeric', placeholder: 'Ex.: 3' });
  const send = h('button', { type: 'submit', class: 'btn btn--primary btn--sm', id: 'cm-enviar' }, icon('send'), 'Comentar');
  const err = h('p', { class: 'field-error', id: 'cm-erro', hidden: true });
  area.addEventListener('input', () => { counter.textContent = `${area.value.length}/2000`; });
  const form = h('form', { class: 'stack', id: 'form-comentario', novalidate: true, 'aria-label': 'Novo comentário' },
    h('div', { class: 'field' }, h('label', { for: 'novo-comentario' }, 'Novo comentário'), area, counter),
    h('div', { class: 'field' }, h('label', { for: 'cm-slide' }, 'Slide (opcional)'), slideIn), err,
    h('div', { class: 'row row--end' }, send));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const body = area.value.trim();
    if (!body) { err.textContent = 'Escreva o comentário antes de enviar.'; err.hidden = false; area.setAttribute('aria-invalid', 'true'); area.focus(); return; }
    area.removeAttribute('aria-invalid');
    const sv = slideIn.value.trim();
    const payload = { body };
    if (sv) {
      const n = Number(sv);
      if (!Number.isInteger(n) || n < 1 || n > 500) { err.textContent = 'Informe um número de slide válido.'; err.hidden = false; slideIn.focus(); return; }
      payload.slideIndex = n - 1 + SLIDE_BASE;
    }
    await withBusy(send, async () => {
      try {
        const c = await api.post(`/api/presentations/${it.id}/comments`, payload);
        state2.items.push(c); area.value = ''; slideIn.value = ''; counter.textContent = '0/2000';
        draw(); announce('Comentário enviado.');
      } catch (ex) { err.textContent = ex?.message || 'Não foi possível enviar o comentário.'; err.hidden = false; }
    }, 'Enviando…');
  });

  function commentNode(c) {
    const resolved = Boolean(c.resolvedAt);
    const acts = h('div', { class: 'comment__actions' });
    if (c.canResolve) acts.append(button({ label: resolved ? 'Reabrir' : 'Resolver', icon: resolved ? 'restore' : 'check', size: 'sm', variant: 'ghost', attrs: { 'data-action': 'resolve' }, onClick: async (e) => {
      await withBusy(e.currentTarget, async () => { try { const u = await api.patch(`/api/comments/${c.id}`, { resolved: !resolved }); Object.assign(c, u && typeof u === 'object' ? u : { resolvedAt: resolved ? null : new Date().toISOString() }); draw(); } catch (ex) { toastError(ex); } });
    } }));
    if (c.canDelete) acts.append(button({ label: 'Excluir', icon: 'trash', size: 'sm', variant: 'ghost', attrs: { 'data-action': 'delete-comment' }, onClick: async () => {
      if (!(await confirmDialog({ title: 'Excluir comentário?', message: 'O comentário deixará de aparecer para todos.', confirmLabel: 'Excluir', danger: true, eyebrow: 'Comentários', icon: 'trash' }))) return;
      try { await api.del(`/api/comments/${c.id}`); state2.items = state2.items.filter((x) => x.id !== c.id); draw(); announce('Comentário excluído.'); } catch (ex) { toastError(ex); }
    } }));
    return h('article', { class: `comment${resolved ? ' is-resolved' : ''}`, dataset: { id: c.id } },
      h('div', { class: 'comment__head' }, avatar(c.author?.displayName, { seed: c.author?.id }), h('strong', null, c.author?.displayName || 'Alguém'), h('span', { class: 'muted', title: formatDateTime(c.createdAt) }, timeAgo(c.createdAt)),
        Number.isInteger(c.slideIndex) ? h('span', { class: 'badge' }, `Slide ${c.slideIndex - SLIDE_BASE + 1}`) : null,
        resolved ? h('span', { class: 'badge badge--ok' }, 'Resolvido') : null),
      h('p', { class: 'comment__body' }, c.body),
      acts.childElementCount ? acts : null);
  }
  function draw() {
    const shown = state2.items.filter((c) => state2.showResolved || !c.resolvedAt);
    const hidden = state2.items.length - shown.length;
    clear(list);
    if (!shown.length) list.append(h('p', { class: 'hint', id: 'sem-comentarios' }, state2.items.length ? 'Todos os comentários foram resolvidos.' : 'Ainda não há comentários.'));
    for (const c of shown) list.append(commentNode(c));
    toggleWrap.hidden = !state2.items.some((c) => c.resolvedAt);
    toggleWrap.querySelector('input').setAttribute('aria-label', hidden ? `Mostrar resolvidos (${hidden})` : 'Mostrar resolvidos');
  }

  replace(box, toggleWrap, list, form);
  toggleWrap.hidden = true;
  list.append(h('div', { class: 'loading', role: 'status' }, icon('spinner', 'spin'), 'Carregando comentários…'));
  try {
    const r = await api.get(`/api/presentations/${it.id}/comments`, { query: { includeResolved: 1 } });
    state2.items = r.items || [];
    draw();
  } catch (e) {
    clear(list).append(h('div', { class: 'alert alert--error', role: 'alert' }, icon('alert'), h('p', null, e?.message || 'Não foi possível carregar os comentários.')));
  }
}

/* ───────── busca, abas, ordenação ───────── */
function applySearch(v) { state.q = v.trim(); updateQuery({ q: state.q || null }); load(); }
const onSearch = debounce(() => { if (searchField.value.trim() !== state.q) applySearch(searchField.value); }, 300);
searchField.addEventListener('input', onSearch);
searchField.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchField.value) { searchField.value = ''; onSearch.flush(); } });

sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  if (state.sort !== 'updated' && state.nextCursor) load(); // precisa de todas as páginas para ordenar de verdade
  else renderList();
});

tabs(tabList, TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, panelId: 'painel' })), (id, userAction) => {
  state.tab = id;
  panel.setAttribute('aria-labelledby', `tab-${id}`);
  trashNote.hidden = id !== 'lixeira';
  updateQuery({ aba: id === 'todas' ? null : id });
  if (userAction || !state.items.length) load();
}, state.tab);

if (qs.has('q')) searchField.value = state.q;
