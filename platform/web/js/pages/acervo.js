/* /acervo — tela principal: acervo comum (todos veem; só o dono altera; para usar a de outra pessoa, crie uma cópia). */
import { api, ApiError } from '../api.js';
import { requireUser } from '../session.js';
import {
  h, icon, button, avatar, menuButton, tabs, confirmDialog, chooseDialog, textDialog, copyText, toast, toastError, announce, debounce,
  withBusy, replace, clear, $, stateBlock, updateQuery,
} from '../ui.js';
import { timeAgo, formatDateTime, plural, isUuid } from '../format.js';

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

/* ───────── esqueleto da página ───────── */
const searchField = h('input', { class: 'input input--search', type: 'search', id: 'busca', name: 'q', placeholder: 'Buscar por título…', autocomplete: 'off', maxlength: 120, value: state.q, enterkeyhint: 'search' });
const sortSelect = h('select', { class: 'select', id: 'ordem' }, ...SORTS.map((s) => h('option', { value: s.id }, s.label)));
const statusLine = h('p', { class: 'status-line', id: 'status', role: 'status', 'aria-live': 'polite' });
const tabList = h('div', { class: 'tabs', 'aria-label': 'Filtrar apresentações' });
const panel = h('div', { id: 'painel', role: 'tabpanel', tabindex: '-1' });
const trashNote = h('div', { class: 'note', id: 'nota-lixeira', hidden: true }, icon('info'),
  h('p', null, 'As apresentações excluídas ficam aqui e podem ser restauradas. Só um administrador pode apagá-las de vez.'));
const newBtn = button({ label: 'Nova apresentação', icon: 'plus', variant: 'accent', attrs: { id: 'btn-nova' }, onClick: createNew });

replace(main,
  h('div', { class: 'page__head' },
    h('div', null,
      h('h1', { id: 'titulo' }, 'Acervo de apresentações'),
      h('p', { class: 'lead' }, 'Tudo o que é salvo fica visível para todos, em modo leitura. Só o dono edita — para usar a apresentação de outra pessoa, crie uma cópia.')),
    newBtn),
  h('form', { class: 'toolbar', role: 'search', 'aria-label': 'Buscar e ordenar', on: { submit: (e) => { e.preventDefault(); onSearch.flush(); } } },
    h('div', { class: 'toolbar__search search-wrap' }, h('label', { for: 'busca', class: 'sr-only' }, 'Buscar apresentações por título'), icon('search'), searchField),
    h('div', { class: 'toolbar__sort' }, icon('sort'), h('label', { for: 'ordem' }, 'Ordenar por'), sortSelect)),
  tabList, trashNote, statusLine, panel);

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
      h('div', { class: 'card__body' }, h('span', { class: 'skeleton sk-line sk-line--w90' }), h('span', { class: 'skeleton sk-line sk-line--w60' }), h('span', { class: 'skeleton sk-line sk-line--w40' }))))));
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
    return stateBlock({ iconName: 'slides', title: 'Você ainda não criou apresentações', text: 'Crie uma do zero, importe o seu acervo local ou abra uma do acervo e crie uma cópia para editar.',
      actions: [button({ label: 'Nova apresentação', icon: 'plus', variant: 'accent', onClick: createNew }), button({ label: 'Importar acervo local', icon: 'upload', href: '/importar' })] });
  }
  return stateBlock({ iconName: 'slides', title: 'O acervo ainda está vazio', text: 'Crie a primeira apresentação — ela ficará visível para todos.',
    actions: [button({ label: 'Nova apresentação', icon: 'plus', variant: 'accent', onClick: createNew })] });
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

function cardFor(it) {
  const own = it.owner?.id === user.id;
  const canEdit = own || user.role === 'admin';
  const trash = state.tab === 'lixeira' || it.deleted === true;
  const title = it.title?.trim() || 'Sem título';
  const id = it.id;
  const thumb = thumbNode(it);
  thumb.addEventListener('click', () => openDrawer(it, titleBtn));
  const badges = h('div', { class: 'card__badges' }, own ? h('span', { class: 'badge badge--own' }, 'Sua') : null, trash ? h('span', { class: 'badge badge--danger' }, 'Excluída') : null);
  thumb.append(badges);

  const titleBtn = h('button', { type: 'button', class: 'card__title', 'aria-haspopup': 'dialog', 'aria-label': `Detalhes de ${title}`, title, on: { click: () => openDrawer(it, titleBtn) } }, title);
  const actions = h('div', { class: 'card__actions' });
  if (trash) {
    if (canEdit) actions.append(button({ label: 'Restaurar', icon: 'restore', variant: 'primary', size: 'sm', attrs: { 'data-action': 'restore', 'aria-label': `Restaurar ${title}` }, onClick: (e) => doRestore(it, e.currentTarget) }));
  } else {
    actions.append(button({ label: 'Apresentar', icon: 'play', variant: 'primary', size: 'sm', href: `/visualizar/${id}`, attrs: { 'data-action': 'present', 'aria-label': `Apresentar ${title}` } }));
    if (canEdit) actions.append(button({ label: 'Editar', icon: 'edit', size: 'sm', href: `/editor/${id}`, attrs: { 'data-action': 'edit', 'aria-label': `Editar ${title}` } }));
    else actions.append(button({ label: 'Criar cópia', icon: 'copy', size: 'sm', attrs: { 'data-action': 'duplicate', 'aria-label': `Criar cópia de ${title}` }, onClick: (e) => doDuplicate(it, e.currentTarget) }));
  }
  actions.append(menuButton({
    label: `Mais ações para ${title}`,
    items: () => {
      const list = [{ label: 'Detalhes e comentários', icon: 'message', action: 'details', onSelect: () => openDrawer(it, titleBtn) }];
      if (!trash) {
        if (canEdit) list.push({ label: 'Criar cópia', icon: 'copy', action: 'duplicate', onSelect: () => doDuplicate(it) });
        list.push({ label: 'Compartilhar', icon: 'link', action: 'share', onSelect: () => doShare(it) });
        if (user.role === 'admin') list.push({ label: 'Transferir propriedade…', icon: 'user', action: 'transfer', onSelect: () => doTransfer(it) });
        if (canEdit) list.push({ sep: true }, { label: 'Excluir', icon: 'trash', danger: true, action: 'delete', onSelect: () => doDelete(it) });
      } else if (user.role === 'admin') {
        list.push({ sep: true }, { label: 'Apagar de vez', icon: 'trash', danger: true, action: 'purge', onSelect: () => doPurge(it) });
      }
      return list;
    },
  }));

  return h('li', { class: 'card', dataset: { id }, 'data-owner': own ? 'me' : 'other' },
    thumb,
    h('div', { class: 'card__body' },
      h('h3', null, titleBtn),
      h('div', { class: 'card__owner' }, avatar(it.owner?.displayName, { seed: it.owner?.id }), h('span', { class: 'nm' }, it.owner?.displayName || 'Desconhecido')),
      h('div', { class: 'card__meta' },
        h('span', null, icon('slides'), plural(it.slideCount ?? 0, 'slide', 'slides')),
        h('span', { title: formatDateTime(it.updatedAt) }, icon('clock'), h('time', { datetime: it.updatedAt }, `atualizada ${timeAgo(it.updatedAt)}`))),
      !own && !trash ? h('p', { class: 'card__readonly' }, icon('lock'), 'Para usar esta apresentação, crie uma cópia.') : null,
      actions));
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
    else await textDialog({ title: 'Link da apresentação', message: 'Copie o link abaixo (Ctrl+C):', value: url });
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
  const ok = await confirmDialog({ title: 'Excluir apresentação?', message: `“${it.title || 'Sem título'}” vai para a lixeira. Você poderá restaurá-la depois.`, confirmLabel: 'Excluir', danger: true });
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
  const toUserId = await chooseDialog({ title: 'Transferir propriedade', message: `“${it.title || 'Sem título'}” passará a pertencer à pessoa escolhida, que será a única a editá-la. O histórico de versões e os comentários acompanham a apresentação.`, options, confirmLabel: 'Transferir', selectLabel: 'Nova dona ou novo dono' });
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
  const ok = await confirmDialog({ title: 'Apagar de vez?', message: `“${it.title || 'Sem título'}” será apagada definitivamente, com o histórico de versões e comentários. Isso não pode ser desfeito.`, confirmLabel: 'Apagar de vez', danger: true });
  if (!ok) return;
  try {
    await api.del(`/api/presentations/${it.id}`, { query: { purge: 1 } });
    removeCard(it.id);
    toast('Apresentação apagada.', { kind: 'ok' });
  } catch (e) { toastError(e, 'Não foi possível apagar.'); }
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
    actions.append(button({ label: 'Apresentar', icon: 'play', variant: 'primary', size: 'sm', href: `/visualizar/${it.id}` }));
    if (canEdit) actions.append(button({ label: 'Editar', icon: 'edit', size: 'sm', href: `/editor/${it.id}` }));
    else actions.append(button({ label: 'Criar cópia', icon: 'copy', variant: 'accent', size: 'sm', attrs: { id: 'dr-copia' }, onClick: (e) => doDuplicate(it, e.currentTarget) }));
    if (canEdit) actions.append(button({ label: 'Histórico de versões', icon: 'history', size: 'sm', href: `/editor/${it.id}?historico=1`, attrs: { id: 'dr-historico' } }));
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
      h('h2', { id: 'dr-titulo' }, title),
      button({ label: 'Fechar detalhes', icon: 'x', variant: 'ghost', size: 'sm', iconOnly: true, onClick: close, attrs: { id: 'dr-fechar' } })),
    h('div', { class: 'drawer__body' },
      thumbNode(it, 'drawer__thumb'),
      actions,
      !own && !trash ? h('div', { class: 'callout' }, icon('lock'), h('div', null, h('p', null, 'Para usar esta apresentação, crie uma cópia.'), h('span', null, 'Ela é do acervo comum e fica somente para leitura; a cópia é sua e você pode editá-la à vontade.'))) : null,
      h('section', { class: 'drawer__sec', 'aria-labelledby': 'dr-info' }, h('h3', { class: 'section-title', id: 'dr-info' }, 'Informações'), info),
      h('section', { class: 'drawer__sec', 'aria-labelledby': 'dr-com' }, h('h3', { class: 'section-title', id: 'dr-com' }, 'Comentários'), commentsBox)));
  document.body.append(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); returnFocusTo?.isConnected && returnFocusTo.focus(); }, { once: true });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
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
      if (!(await confirmDialog({ title: 'Excluir comentário?', message: 'O comentário deixará de aparecer para todos.', confirmLabel: 'Excluir', danger: true }))) return;
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
