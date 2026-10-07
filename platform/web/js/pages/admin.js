/* /admin — somente administradores: usuários, convites, auditoria, configurações e resumo.
   O servidor é quem decide (RLS); aqui só mostramos/ocultamos controles. Todo texto da API entra por textContent. */
import { api, ApiError, fieldErrors } from '../api.js';
import { requireUser } from '../session.js';
import {
  h, icon, button, avatar, tabs, confirmDialog, toast, toastError, announce, debounce, withBusy, replace, $, field,
  stateBlock, loadingBlock, alertBox, eyebrow,
} from '../ui.js';
import { timeAgo, formatDateTime, formatDate, formatNumber, formatBytes, plural, roleLabel, statusLabel } from '../format.js';

const me = await requireUser({ active: 'admin', admin: true });
const main = $('#conteudo');
document.title = 'Administração — Canteiro · A&M';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const arr = (r) => (Array.isArray(r) ? r : r?.items || []);
const USERS_PAGE = 50;

const TABS = [
  { id: 'usuarios', label: 'Usuários', icon: 'users' },
  { id: 'convidar', label: 'Convidar', icon: 'mail' },
  { id: 'auditoria', label: 'Auditoria', icon: 'shield' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' },
  { id: 'resumo', label: 'Resumo', icon: 'chart' },
];

const tabList = h('div', { class: 'tabs', 'aria-label': 'Seções da administração' });
const panel = h('div', { id: 'painel', role: 'tabpanel', tabindex: '-1' });
replace(main,
  h('div', { class: 'page__head' }, h('div', null, eyebrow('Painel do administrador'), h('h1', { id: 'titulo' }, 'Administração'),
    h('p', { class: 'lead' }, 'Gerencie pessoas, convites, regras e acompanhe o que acontece no Canteiro. Cadastro aberto não existe: só entra quem for convidado.'))),
  tabList, panel);

const views = {};
function show(id) {
  panel.setAttribute('aria-labelledby', `tab-${id}`);
  history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
  const v = views[id] || (views[id] = BUILDERS[id]());
  replace(panel, v.root);
  v.onShow?.();
}

/* ───────── usuários ───────── */
function normUser(u) {
  return {
    id: u.id, email: u.email || '', displayName: u.displayName ?? u.email ?? '—', role: u.role, status: u.status,
    lastLoginAt: u.lastLoginAt ?? null, activatedAt: u.activatedAt ?? null, createdAt: u.createdAt ?? null,
    count: u.presentationCount ?? 0,
    invite: u.invite && u.invite.id ? { id: u.invite.id, status: u.invite.status, expiresAt: u.invite.expiresAt, resent: u.invite.resentCount ?? 0 } : null,
  };
}

function usersView() {
  const st = { q: '', status: '', items: [], cursor: null, seq: 0 };
  const search = h('input', { class: 'input input--search', type: 'search', id: 'u-busca', placeholder: 'Buscar por nome ou e-mail…', autocomplete: 'off', maxlength: 100 });
  const statusSel = h('select', { class: 'select', id: 'u-status' }, h('option', { value: '' }, 'Todos os status'), h('option', { value: 'active' }, 'Ativos'), h('option', { value: 'invited' }, 'Convidados'), h('option', { value: 'suspended' }, 'Suspensos'));
  const wrap = h('div', { id: 'u-lista' });
  const statusLine = h('p', { class: 'status-line', id: 'u-status-linha', role: 'status', 'aria-live': 'polite' });
  const root = h('section', { 'aria-label': 'Usuários' },
    h('div', { class: 'toolbar' },
      h('div', { class: 'search-wrap' }, h('label', { for: 'u-busca', class: 'sr-only' }, 'Buscar usuários'), icon('search'), search),
      h('div', { class: 'toolbar__sort' }, h('label', { for: 'u-status' }, 'Status'), statusSel)),
    statusLine, wrap);

  async function load({ more = false } = {}) {
    const my = ++st.seq;
    if (!more) { st.items = []; st.cursor = null; replace(wrap, loadingBlock('Carregando usuários…')); }
    try {
      const r = await api.get('/api/admin/users', { query: { q: st.q || undefined, status: st.status || undefined, limit: USERS_PAGE, cursor: more ? st.cursor : undefined } });
      if (my !== st.seq) return;
      st.items = st.items.concat(arr(r).map(normUser));
      st.cursor = r?.nextCursor || null;
      draw();
    } catch (e) {
      if (my !== st.seq || e?.redirecting) return;
      if (more) toastError(e);
      else replace(wrap, stateBlock({ iconName: 'alert', title: 'Não foi possível carregar os usuários', text: e.message, actions: [button({ label: 'Tentar de novo', icon: 'refresh', variant: 'primary', onClick: () => load() })] }));
    }
  }

  async function act(run, { confirm, success } = {}) {
    if (confirm && !(await confirmDialog(confirm))) return;
    try { await run(); toast(success || 'Alteração salva.', { kind: 'ok' }); announce(success || 'Alteração salva.'); await load(); } catch (e) { toastError(e, 'Não foi possível concluir a ação.'); }
  }

  function rowFor(u) {
    const self = u.id === me.id;
    const acts = h('div', { class: 'actions' });
    const name = u.displayName || u.email;
    const revoked = u.status === 'suspended' && !u.activatedAt;       // convite revogado: nunca entrou
    const add = (label, ic, fn, key) => acts.append(button({ label, icon: ic, size: 'sm', attrs: { 'data-action': key, 'aria-label': `${label}: ${name}` }, onClick: fn }));
    if (u.status === 'invited') {
      if (u.invite) {
        add('Reenviar convite', 'send', () => act(() => api.post(`/api/admin/invites/${u.invite.id}/resend`, {}), { success: `Convite reenviado para ${u.email}.` }), 'resend');
        add('Revogar convite', 'ban', () => act(() => api.del(`/api/admin/invites/${u.invite.id}`), {
          confirm: { title: 'Revogar convite?', message: `${u.email} não poderá mais usar o convite enviado.`, confirmLabel: 'Revogar', danger: true }, success: 'Convite revogado.' }), 'revoke');
      } else acts.append(h('span', { class: 'hint' }, 'Sem convite ativo'));
    } else if (revoked) {
      add('Convidar de novo', 'send', () => act(() => api.post('/api/admin/invites', { email: u.email, displayName: u.displayName, role: u.role || 'member' }), { success: `Novo convite enviado para ${u.email}.` }), 'reinvite');
    } else if (!self) {
      if (u.status !== 'suspended') {
        if (u.role === 'admin') add('Rebaixar', 'user', () => act(() => api.patch(`/api/admin/users/${u.id}`, { role: 'member' }), {
          confirm: { title: 'Rebaixar a membro?', message: `${name} deixará de administrar o Canteiro.`, confirmLabel: 'Rebaixar', danger: true }, success: `${name} agora é membro.` }), 'demote');
        else add('Promover a admin', 'shield', () => act(() => api.patch(`/api/admin/users/${u.id}`, { role: 'admin' }), {
          confirm: { title: 'Promover a administrador?', message: `${name} poderá convidar pessoas, ver a auditoria e moderar qualquer apresentação.`, confirmLabel: 'Promover' }, success: `${name} agora é administrador.` }), 'promote');
        add('Suspender', 'ban', () => act(() => api.patch(`/api/admin/users/${u.id}`, { status: 'suspended' }), {
          confirm: { title: 'Suspender acesso?', message: `${name} será desconectado e não poderá entrar até ser reativado. As apresentações dessa pessoa continuam no acervo.`, confirmLabel: 'Suspender', danger: true }, success: `${name} foi suspenso.` }), 'suspend');
      } else add('Reativar', 'unlock', () => act(() => api.patch(`/api/admin/users/${u.id}`, { status: 'active' }), { success: `${name} foi reativado.` }), 'reactivate');
    } else {
      acts.append(h('span', { class: 'hint' }, 'Esta é a sua conta'));
    }
    const tone = revoked ? 'danger' : { active: 'ok', invited: 'warn', suspended: 'danger' }[u.status] || '';
    const label = revoked ? 'Convite revogado' : statusLabel(u.status);
    const exp = u.status === 'invited' && u.invite?.expiresAt ? (new Date(u.invite.expiresAt) < new Date() ? 'convite expirado' : `expira em ${formatDate(u.invite.expiresAt)}`) : null;
    return h('tr', { dataset: { id: u.id, email: u.email } },
      h('td', { 'data-label': 'Usuário' }, h('div', { class: 'who' }, avatar(name, { seed: u.id }), h('div', null, h('strong', null, name, self ? h('span', { class: 'badge badge--own' }, 'Você') : null), h('span', { class: 'sub' }, u.email)))),
      h('td', { 'data-label': 'Papel' }, h('span', { class: `badge${u.role === 'admin' ? ' badge--admin' : ''}` }, roleLabel(u.role))),
      h('td', { 'data-label': 'Status' }, h('span', { class: `badge${tone ? ` badge--${tone}` : ''}` }, label), exp ? h('span', { class: 'sub' }, exp) : null),
      h('td', { 'data-label': 'Último acesso', title: u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '' }, u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Nunca'),
      h('td', { class: 'num', 'data-label': 'Apresentações' }, formatNumber(u.count)),
      h('td', { 'data-label': 'Ações' }, acts));
  }

  function draw() {
    statusLine.textContent = `${plural(st.items.length, 'usuário', 'usuários')}${st.cursor ? ' (há mais para carregar)' : ''}`;
    if (!st.items.length) { replace(wrap, stateBlock({ iconName: 'users', title: 'Nenhum usuário encontrado', text: st.q || st.status ? 'Ajuste a busca ou o filtro de status.' : 'Convide a primeira pessoa na aba “Convidar”.' })); return; }
    replace(wrap,
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl', id: 'u-tabela' },
        h('caption', { class: 'sr-only' }, 'Usuários do Canteiro'),
        h('thead', null, h('tr', null, ...['Usuário', 'Papel', 'Status', 'Último acesso'].map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col', class: 'num' }, 'Apresentações'), h('th', { scope: 'col' }, 'Ações'))),
        h('tbody', null, ...st.items.map(rowFor)))),
      st.cursor ? h('div', { class: 'more-wrap' }, button({ label: 'Carregar mais', icon: 'chevron-down', onClick: (e) => withBusy(e.currentTarget, () => load({ more: true })), attrs: { id: 'u-mais' } })) : null);
  }

  const onSearch = debounce(() => { st.q = search.value.trim(); load(); }, 300);
  search.addEventListener('input', onSearch);
  statusSel.addEventListener('change', () => { st.status = statusSel.value; load(); });
  return { root, onShow: () => { if (!st.items.length) load(); }, reload: () => load() };
}

/* ───────── convidar ───────── */
function inviteView() {
  const email = field({ id: 'c-email', label: 'E-mail', type: 'email', required: true, autocomplete: 'off', maxlength: 254, inputmode: 'email', placeholder: 'nome@empresa.com.br' });
  const name = field({ id: 'c-nome', label: 'Nome', required: true, autocomplete: 'off', maxlength: 120, placeholder: 'Nome e sobrenome', hint: 'Aparece como dono das apresentações no acervo.' });
  const roleSel = h('select', { class: 'select', id: 'c-papel', name: 'role' }, h('option', { value: 'member' }, 'Membro — cria e edita as próprias apresentações'), h('option', { value: 'admin' }, 'Administrador — gerencia pessoas, regras e modera o acervo'));
  const slot = h('div', { id: 'c-alerta' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary', id: 'c-enviar' }, icon('send'), 'Enviar convite');
  const sent = h('ul', { class: 'stack', role: 'list', id: 'c-enviados', 'aria-label': 'Convites enviados nesta sessão' });
  const form = h('form', { id: 'form-convite', novalidate: true, 'aria-label': 'Convidar pessoa' }, slot, h('div', { class: 'grid-2' }, email.wrap, name.wrap),
    h('div', { class: 'field' }, h('label', { for: 'c-papel' }, 'Papel'), roleSel), h('div', { class: 'row' }, submit));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    email.clearError(); name.clearError(); replace(slot);
    const em = email.input.value.trim().toLowerCase();
    const nm = name.input.value.trim();
    if (!em) email.setError('Informe o e-mail da pessoa.'); else if (!EMAIL_RE.test(em)) email.setError('Esse e-mail não parece válido.');
    if (nm.length < 2) name.setError('Informe o nome (mínimo 2 letras).');
    else if (/[<>]/.test(nm)) name.setError('O nome não pode conter < ou >.');
    if (form.querySelector('[aria-invalid="true"]')) { form.querySelector('[aria-invalid="true"]').focus(); return; }
    await withBusy(submit, async () => {
      try {
        const r = await api.post('/api/admin/invites', { email: em, displayName: nm, role: roleSel.value });
        slot.append(alertBox('ok', `Convite enviado para ${em}.${r?.expiresAt ? ` O link vale até ${formatDate(r.expiresAt)}.` : ''}`));
        sent.prepend(h('li', { class: 'badge badge--ok' }, icon('check'), `${nm} · ${em} · ${roleLabel(roleSel.value)}`));
        form.reset(); email.input.focus();
        views.usuarios?.reload?.();
      } catch (err) {
        const f = err instanceof ApiError ? fieldErrors(err) : {};
        if (f.email) email.setError(f.email);
        if (f.displayName) name.setError(f.displayName);
        if (err?.code === 'already_exists' || err?.status === 409) { email.setError(err.message || 'Já existe um usuário ou convite para este e-mail.'); email.input.focus(); }
        else if (!f.email && !f.displayName) slot.append(alertBox('error', err?.message || 'Não foi possível enviar o convite.'));
        else form.querySelector('[aria-invalid="true"]')?.focus();
      }
    }, 'Enviando…');
  });
  const root = h('section', { 'aria-label': 'Convidar' },
    h('div', { class: 'panel' },
      h('h2', { class: 'panel__title' }, 'Convidar uma pessoa'),
      h('p', { class: 'muted' }, 'A pessoa recebe um e-mail com um link para confirmar o endereço e definir a senha. O convite vale por alguns dias e pode ser reenviado ou revogado na aba “Usuários”.'),
      form),
    h('div', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Enviados nesta sessão'), sent, h('p', { class: 'hint' }, 'A lista completa fica na aba “Usuários” (status “Convidado”).')));
  return { root, onShow: () => email.input.focus() };
}

/* ───────── auditoria ───────── */
const ACTIONS = {
  'auth.login': 'Entrou', 'auth.login_failed': 'Falha de login', 'auth.logout': 'Saiu', 'auth.verify': 'Confirmou o link do e-mail', 'auth.password_set': 'Definiu a senha', 'auth.forgot': 'Pediu redefinição de senha',
  'invite.create': 'Convidou', 'invite.resend': 'Reenviou convite', 'invite.revoke': 'Revogou convite', 'user.update': 'Alterou usuário', 'user.gotrue_sync_failed': 'Falha ao sincronizar bloqueio', 'settings.update': 'Alterou configuração',
  'presentation.create': 'Criou apresentação', 'presentation.update': 'Salvou apresentação', 'presentation.rename': 'Renomeou', 'presentation.duplicate': 'Criou cópia',
  'presentation.delete': 'Excluiu', 'presentation.restore': 'Restaurou', 'presentation.purge': 'Apagou de vez', 'presentation.transfer': 'Transferiu', 'presentation.share': 'Compartilhou',
  'presentation.version_restore': 'Restaurou versão', 'presentation.conflict_overwrite': 'Sobrescreveu em conflito', 'comment.create': 'Comentou', 'comment.delete': 'Excluiu comentário',
  'asset.upload': 'Enviou arquivo', 'asset.reject': 'Arquivo recusado', 'import.acervo': 'Importou acervo', 'security.csrf_blocked': 'CSRF bloqueado',
  'security.rate_limited': 'Limite de taxa', 'security.rejected_content': 'Conteúdo recusado',
};
const ACTION_GROUPS = [['auth.*', 'Acesso e senhas'], ['invite.*', 'Convites'], ['presentation.*', 'Apresentações'], ['comment.*', 'Comentários'], ['asset.*', 'Arquivos'], ['security.*', 'Segurança']];

function auditView() {
  const st = { items: [], cursor: null, seq: 0, usersLoaded: false };
  const actor = h('select', { class: 'select', id: 'a-ator' }, h('option', { value: '' }, 'Todas as pessoas'));
  const action = h('select', { class: 'select', id: 'a-acao' }, h('option', { value: '' }, 'Todas as ações'),
    h('optgroup', { label: 'Grupos de ações' }, ...ACTION_GROUPS.map(([k, v]) => h('option', { value: k }, `${v} (${k})`))),
    h('optgroup', { label: 'Ações' }, ...Object.entries(ACTIONS).map(([k, v]) => h('option', { value: k }, `${v} (${k})`))));
  const from = h('input', { class: 'input', type: 'date', id: 'a-de', name: 'from' });
  const to = h('input', { class: 'input', type: 'date', id: 'a-ate', name: 'to' });
  const wrap = h('div', { id: 'a-lista' });
  const statusLine = h('p', { class: 'status-line', id: 'a-status', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'filters', id: 'form-auditoria', 'aria-label': 'Filtros da auditoria' },
    h('div', { class: 'field' }, h('label', { for: 'a-ator' }, 'Quem'), actor),
    h('div', { class: 'field' }, h('label', { for: 'a-acao' }, 'Ação'), action),
    h('div', { class: 'field' }, h('label', { for: 'a-de' }, 'De'), from),
    h('div', { class: 'field' }, h('label', { for: 'a-ate' }, 'Até'), to),
    h('div', { class: 'filters__btns' }, h('button', { type: 'submit', class: 'btn btn--primary', id: 'a-filtrar' }, icon('filter'), 'Filtrar'), button({ label: 'Limpar', onClick: () => { form.reset(); load(); }, attrs: { id: 'a-limpar' } })));
  const root = h('section', { 'aria-label': 'Auditoria' }, form, statusLine, wrap);

  const dayStart = (v) => (v ? new Date(`${v}T00:00:00`).toISOString() : undefined);
  const dayEnd = (v) => (v ? new Date(`${v}T23:59:59.999`).toISOString() : undefined);

  async function loadActors() {
    if (st.usersLoaded) return;
    st.usersLoaded = true;
    try {
      let cursor; const seen = [];
      for (let i = 0; i < 5; i++) { // até 500 pessoas no filtro
        const r = await api.get('/api/admin/users', { query: { limit: 100, cursor } });
        seen.push(...arr(r).map(normUser)); cursor = r?.nextCursor; if (!cursor) break;
      }
      for (const u of seen) actor.append(h('option', { value: u.id }, `${u.displayName} (${u.email})`));
    } catch { /* o filtro por pessoa fica só com "todas" */ }
  }

  async function load({ more = false } = {}) {
    const my = ++st.seq;
    if (!more) { st.items = []; st.cursor = null; replace(wrap, loadingBlock('Carregando auditoria…')); }
    try {
      const r = await api.get('/api/admin/audit', { query: { actor: actor.value || undefined, action: action.value || undefined, from: dayStart(from.value), to: dayEnd(to.value), limit: 50, cursor: more ? st.cursor : undefined } });
      if (my !== st.seq) return;
      st.items = st.items.concat(arr(r));
      st.cursor = r?.nextCursor || null;
      draw();
    } catch (e) {
      if (my !== st.seq || e?.redirecting) return;
      if (more) toastError(e); else replace(wrap, stateBlock({ iconName: 'alert', title: 'Não foi possível carregar a auditoria', text: e.message, actions: [button({ label: 'Tentar de novo', icon: 'refresh', variant: 'primary', onClick: () => load() })] }));
    }
  }

  function row(ev) {
    const who = ev.actor?.displayName ?? null;
    const extra = ev.meta && typeof ev.meta === 'object' ? ev.meta : {};
    const lines = [Object.keys(extra).length ? JSON.stringify(extra, null, 2) : null, ev.requestId ? `requestId: ${ev.requestId}` : null, ev.userAgent ? `navegador: ${ev.userAgent}` : null].filter(Boolean).join('\n');
    const ent = ev.entityType ? `${ev.entityType}${ev.entityId ? ` · ${String(ev.entityId).slice(0, 13)}` : ''}` : '—';
    return h('tr', { dataset: { action: ev.action } },
      h('td', { 'data-label': 'Quando', class: 'nowrap' }, h('time', { datetime: ev.at, title: timeAgo(ev.at) }, formatDateTime(ev.at))),
      h('td', { 'data-label': 'Quem' }, who || h('span', { class: 'muted' }, 'Sistema / anônimo')),
      h('td', { 'data-label': 'Ação' }, h('strong', null, ACTIONS[ev.action] || ev.action), h('br'), h('code', { class: 'muted' }, ev.action)),
      h('td', { 'data-label': 'Item' }, ent),
      h('td', { 'data-label': 'IP' }, ev.ip || '—'),
      h('td', { 'data-label': 'Detalhes' }, lines ? h('details', null, h('summary', null, 'Ver'), h('pre', null, lines)) : '—'));
  }

  function draw() {
    statusLine.textContent = `${plural(st.items.length, 'registro', 'registros')}${st.cursor ? ' (há mais)' : ''}`;
    if (!st.items.length) { replace(wrap, stateBlock({ iconName: 'shield', title: 'Nenhum registro', text: 'Não há eventos para os filtros escolhidos.' })); return; }
    replace(wrap,
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl', id: 'a-tabela' }, h('caption', { class: 'sr-only' }, 'Trilha de auditoria'),
        h('thead', null, h('tr', null, ...['Quando', 'Quem', 'Ação', 'Item', 'IP', 'Detalhes'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, ...st.items.map(row)))),
      st.cursor ? h('div', { class: 'more-wrap' }, button({ label: 'Carregar mais', icon: 'chevron-down', onClick: (e) => withBusy(e.currentTarget, () => load({ more: true })), attrs: { id: 'a-mais' } })) : null);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); if (from.value && to.value && from.value > to.value) { toast('A data inicial precisa ser anterior à final.', { kind: 'error' }); from.focus(); return; } load(); });
  return { root, onShow: () => { loadActors(); if (!st.items.length) load(); } };
}

/* ───────── configurações ───────── */
const MB = 1048576;
/** Chaves conhecidas (as mesmas que o servidor aceita) com rótulo, ajuda e faixa válida. unit: valor guardado = valor mostrado × unit. */
const SETTING_INFO = {
  'acervo.visibility': { label: 'Visibilidade do acervo', help: 'Regra do produto: tudo o que é salvo fica visível, em modo leitura, para todos os membros. Esta regra é fixa.', kind: 'fixed', show: () => 'Todos os membros veem todo o acervo' },
  'versions.keep_last': { label: 'Versões recentes guardadas', help: 'Quantos pontos do histórico são mantidos por apresentação.', kind: 'number', min: 1, max: 500, suffix: 'versões' },
  'versions.keep_daily_days': { label: 'Dias de retenção diária', help: 'Por quantos dias um ponto por dia é mantido no histórico.', kind: 'number', min: 1, max: 365, suffix: 'dias' },
  'uploads.max_bytes': { label: 'Tamanho máximo de arquivo', help: 'Limite de cada arquivo enviado.', kind: 'number', min: 1, max: 500, unit: MB, suffix: 'MB' },
  'invites.ttl_days': { label: 'Validade do convite', help: 'Dias até o link do convite expirar.', kind: 'number', min: 1, max: 30, suffix: 'dias' },
};

function normSettings(r) {
  if (Array.isArray(r) || Array.isArray(r?.items)) return arr(r).map((s) => ({ key: s.key, value: s.value, updatedAt: s.updatedAt ?? null }));
  return Object.entries(r || {}).map(([key, value]) => ({ key, value, updatedAt: null }));
}

function settingsView() {
  const wrap = h('div', { id: 's-lista' });
  const root = h('section', { 'aria-label': 'Configurações' }, h('div', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Configurações do Canteiro'),
    h('p', { class: 'muted' }, 'Só as chaves conhecidas podem ser alteradas. Cada alteração fica na auditoria.'), wrap));

  function rowFor(s) {
    const info = SETTING_INFO[s.key] || { label: s.key, help: 'Chave sem descrição.', kind: 'fixed', show: (v) => JSON.stringify(v) };
    const id = `s-${s.key.replace(/[^a-z0-9]/gi, '-')}`;
    const head = h('div', { class: 'setting__info' }, h('h3', null, info.label), h('p', { class: 'hint' }, info.help), h('p', { class: 'setting__key' }, h('code', null, s.key), s.updatedAt ? ` · alterada ${timeAgo(s.updatedAt)}` : ''));
    if (info.kind === 'fixed') return h('div', { class: 'setting', dataset: { key: s.key } }, head, h('p', null, h('span', { class: 'badge badge--info' }, icon('lock'), info.show(s.value))));
    const unit = info.unit || 1;
    const input = h('input', { class: 'input', type: 'number', id, value: String(Number(s.value) / unit), min: info.min, max: info.max, step: 1, inputmode: 'numeric', 'aria-describedby': `${id}-h` });
    const err = h('p', { class: 'field-error', id: `${id}-e`, hidden: true });
    const save = h('button', { type: 'submit', class: 'btn btn--primary btn--sm', 'data-key': s.key }, 'Salvar');
    const f = h('form', { class: 'setting__form', novalidate: true, 'aria-label': `Alterar ${info.label}` },
      h('div', { class: 'field' }, h('label', { for: id, class: 'sr-only' }, `${info.label} (${info.suffix})`), input, h('p', { class: 'hint', id: `${id}-h` }, `Entre ${formatNumber(info.min)} e ${formatNumber(info.max)} ${info.suffix}.`), err), save);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true; input.removeAttribute('aria-invalid');
      const n = Number(input.value);
      if (input.value === '' || !Number.isInteger(n) || n < info.min || n > info.max) { err.textContent = `Informe um número inteiro entre ${formatNumber(info.min)} e ${formatNumber(info.max)} ${info.suffix}.`; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      await withBusy(save, async () => {
        try { const r = await api.put(`/api/admin/settings/${encodeURIComponent(s.key)}`, { value: n * unit }); s.value = r && 'value' in r ? r.value : n * unit; toast(`“${info.label}” salvo.`, { kind: 'ok' }); announce(`${info.label} salvo.`); }
        catch (ex) { err.textContent = fieldErrors(ex).value || ex?.message || 'Não foi possível salvar.'; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); }
      }, 'Salvando…');
    });
    return h('div', { class: 'setting', dataset: { key: s.key } }, head, f);
  }

  async function load() {
    replace(wrap, loadingBlock('Carregando configurações…'));
    try {
      const list = normSettings(await api.get('/api/admin/settings'));
      if (!list.length) { replace(wrap, h('p', { class: 'muted' }, 'Nenhuma configuração disponível.')); return; }
      replace(wrap, ...list.map(rowFor));
    } catch (e) { if (!e?.redirecting) replace(wrap, stateBlock({ iconName: 'alert', title: 'Não foi possível carregar as configurações', text: e.message, actions: [button({ label: 'Tentar de novo', icon: 'refresh', variant: 'primary', onClick: load })] })); }
  }
  return { root, onShow: load };
}

/* ───────── resumo ───────── */
const STAT_LABELS = {
  'users.total': 'Usuários', 'users.active': 'Ativos', 'users.invited': 'Convidados', 'users.suspended': 'Suspensos', 'users.admins': 'Administradores',
  'presentations.live': 'No acervo', 'presentations.trashed': 'Na lixeira', 'presentations.total': 'Apresentações',
  'assets.count': 'Arquivos', 'assets.bytes': 'Espaço usado', 'invites.pending': 'Convites pendentes',
};
const GROUPS = { users: 'Pessoas', presentations: 'Apresentações', assets: 'Arquivos', invites: 'Convites' };
const humanize = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function flatten(o, prefix = '', depth = 0, out = []) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number') out.push([key, v]);
    else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v, key, depth + 1, out);
  }
  return out;
}

function statsView() {
  const wrap = h('div', { id: 'r-lista' });
  const root = h('section', { 'aria-label': 'Resumo' }, h('div', { class: 'row row--between' }, h('h2', null, 'Resumo do Canteiro'), button({ label: 'Atualizar', icon: 'refresh', onClick: (e) => withBusy(e.currentTarget, load), attrs: { id: 'r-atualizar' } })), h('div', { class: 'status-line' }), wrap);
  async function load() {
    try {
      const r = await api.get('/api/admin/stats');
      const flat = flatten(r);
      if (!flat.length) { replace(wrap, h('p', { class: 'muted' }, 'Ainda não há números para mostrar.')); return; }
      const groups = new Map();
      for (const [key, v] of flat) {
        const g = GROUPS[key.split('.')[0]] || humanize(key.split('.')[0]);
        if (!groups.has(g)) groups.set(g, []);
        const label = STAT_LABELS[key] || humanize(key.split('.').slice(1).join(' ') || key);
        groups.get(g).push(h('div', { class: 'stat', dataset: { stat: key } }, h('div', { class: 'stat__v' }, /bytes$/i.test(key) ? formatBytes(v) : formatNumber(v)), h('div', { class: 'stat__l' }, label)));
      }
      replace(wrap, ...[...groups].map(([g, cards]) => h('section', { 'aria-label': g }, h('h3', { class: 'section-title' }, g), h('div', { class: 'stats' }, ...cards))));
    } catch (e) { if (!e?.redirecting) replace(wrap, stateBlock({ iconName: 'alert', title: 'Não foi possível carregar o resumo', text: e.message, actions: [button({ label: 'Tentar de novo', icon: 'refresh', variant: 'primary', onClick: load })] })); }
  }
  replace(wrap, loadingBlock('Carregando resumo…'));
  return { root, onShow: load };
}

const BUILDERS = { usuarios: usersView, convidar: inviteView, auditoria: auditView, configuracoes: settingsView, resumo: statsView };

const initial = TABS.some((t) => `#${t.id}` === location.hash) ? location.hash.slice(1) : 'usuarios';
tabs(tabList, TABS.map((t) => ({ ...t, panelId: 'painel' })), (id) => show(id), initial);
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (TABS.some((t) => t.id === id)) { tabList.querySelector(`#tab-${id}`)?.click(); } });
