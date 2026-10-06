/* ui.js — blocos de interface: construtor de elementos, ícones, avisos, diálogos, menus, abas e barra superior.
   REGRA: nenhum dado vindo da API entra no DOM como marcação — só por textContent / createTextNode (ver h()). */
import { initials, colorIndex } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FORBIDDEN_ATTR = /^(on|style$|srcdoc$|formaction$)/i;
const URL_ATTR = /^(href|src|action|xlink:href)$/i;

/** h('div', { class: 'x', dataset: {id: 1}, on: { click: fn }, 'aria-label': '…' }, 'texto', outroNo)
 *  Strings viram nós de texto. Atributos on*, style e javascript: são recusados. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) { if (dv != null) el.dataset[dk] = String(dv); }
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (FORBIDDEN_ATTR.test(k)) throw new Error(`Atributo proibido: ${k}`);
      else if (URL_ATTR.test(k) && /^\s*(javascript|vbscript|data):/i.test(String(v)) && !/^data:image\//i.test(String(v))) throw new Error(`URL proibida em ${k}`);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const replace = (el, ...children) => append(clear(el), children);

/** Ícone do sprite /assets/icons.svg (herda a cor do texto). */
export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `/assets/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

/** Botão padrão: button({ label, icon, variant: 'primary'|'accent'|'danger'|'ghost', size: 'sm', iconOnly, onClick, type, title }) */
export function button({ label, icon: ic, variant, size, iconOnly = false, onClick, type = 'button', title, href, attrs = {}, cls = '' } = {}) {
  const classes = ['btn', variant && `btn--${variant}`, size && `btn--${size}`, iconOnly && 'btn--icon', cls].filter(Boolean).join(' ');
  const props = { class: classes, ...attrs };
  let el;
  if (href) { el = h('a', { ...props, href }); } else { el = h('button', { ...props, type }); }
  if (iconOnly) { el.setAttribute('aria-label', label); if (title !== false) el.setAttribute('title', title || label); }
  else if (title) el.setAttribute('title', title);
  if (ic) el.append(icon(ic));
  if (!iconOnly) el.append(document.createTextNode(label));
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

/** Marca o botão como ocupado (aria-disabled evita perder o foco). Devolve função para restaurar. */
export function setBusy(btn, busy, busyLabel) {
  if (!btn) return () => {};
  if (busy) {
    btn.classList.add('is-busy');
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-busy', 'true');
    if (busyLabel && !btn.dataset.label) { btn.dataset.label = btn.lastChild?.textContent ?? ''; if (btn.lastChild && btn.lastChild.nodeType === 3) btn.lastChild.textContent = busyLabel; }
  } else {
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('aria-busy');
    if (btn.dataset.label !== undefined) { if (btn.lastChild && btn.lastChild.nodeType === 3) btn.lastChild.textContent = btn.dataset.label; delete btn.dataset.label; }
  }
  return () => setBusy(btn, false);
}
export const isBusy = (btn) => btn?.getAttribute('aria-busy') === 'true';

/** Executa fn com o botão ocupado; ignora cliques repetidos. */
export async function withBusy(btn, fn, busyLabel) {
  if (isBusy(btn)) return undefined;
  setBusy(btn, true, busyLabel);
  try { return await fn(); } finally { setBusy(btn, false); }
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.flush = (...a) => { clearTimeout(t); t = null; fn(...a); };
  return d;
}

/* ───────── avisos ───────── */
let liveEl = null;
/** Anuncia para leitores de tela (região aria-live educada). */
export function announce(msg) {
  if (!liveEl) {
    liveEl = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', id: 'sr-live' });
    document.body.append(liveEl);
  }
  liveEl.textContent = '';
  setTimeout(() => { liveEl.textContent = msg; }, 30);
}

let toastsEl = null;
/** toast('Salvo', { kind: 'ok'|'error'|'info', action: { label, onClick }, timeout }) */
export function toast(message, { kind = 'info', action, timeout = 6000 } = {}) {
  if (!toastsEl) {
    toastsEl = h('div', { class: 'toasts', id: 'toasts' });
    document.body.append(toastsEl);
  }
  const node = h('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' });
  node.append(icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info'), h('span', { class: 'break' }, message));
  const remove = () => { clearTimeout(timer); node.remove(); };
  if (action) node.append(button({ label: action.label, size: 'sm', onClick: () => { remove(); action.onClick?.(); } }));
  node.append(h('button', { type: 'button', class: 'toast__x', 'aria-label': 'Fechar aviso', on: { click: () => remove() } }, icon('x')));
  toastsEl.append(node);
  const timer = timeout ? setTimeout(remove, timeout) : 0;
  return remove;
}

/** Mostra um erro (ApiError ou qualquer) como toast, a menos que a página esteja sendo redirecionada. */
export function toastError(err, fallback = 'Algo deu errado. Tente novamente.') {
  if (err?.redirecting) return;
  toast(err?.message || fallback, { kind: 'error', timeout: 9000 });
}

/** Caixa de alerta (role=alert) dentro de um contêiner. */
export function alertBox(kind, message, { live = true } = {}) {
  return h('div', { class: `alert alert--${kind}`, role: live ? (kind === 'error' ? 'alert' : 'status') : null },
    icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert'), h('p', null, message));
}

/* ───────── diálogos ───────── */
function mountDialog(dlg) {
  document.body.append(dlg);
  const done = () => dlg.remove();
  dlg.addEventListener('close', done, { once: true });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); }); // clique no fundo
  dlg.showModal();
  return dlg;
}

/** confirmDialog({ title, message, confirmLabel, cancelLabel, danger }) → Promise<boolean> */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const cancel = button({ label: cancelLabel, attrs: { autofocus: true, 'data-act': 'cancel' }, onClick: () => dlg.close('cancel') });
    const ok = button({ label: confirmLabel, variant: danger ? 'danger' : 'primary', attrs: { 'data-act': 'confirm' }, onClick: () => dlg.close('ok') });
    const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': `${id}-t`, 'aria-describedby': `${id}-d` },
      h('div', { class: 'dlg__in' },
        h('h2', { id: `${id}-t` }, title),
        h('p', { id: `${id}-d` }, message),
        h('div', { class: 'row' }, cancel, ok)));
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    mountDialog(dlg);
  });
}

/** Mostra um texto copiável (quando a área de transferência não está disponível). */
export function textDialog({ title, message, value, closeLabel = 'Fechar' }) {
  return new Promise((resolve) => {
    const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const input = h('input', { class: 'input', type: 'text', readonly: true, value, id: `${id}-i`, 'aria-label': title });
    const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': `${id}-t` },
      h('div', { class: 'dlg__in' },
        h('h2', { id: `${id}-t` }, title), message ? h('p', null, message) : null, input,
        h('div', { class: 'row' }, button({ label: closeLabel, variant: 'primary', onClick: () => dlg.close('ok') }))));
    dlg.addEventListener('close', () => resolve(), { once: true });
    mountDialog(dlg);
    input.select();
  });
}

/** Copia texto; devolve true/false. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sem permissão: tenta o método antigo */ }
  try {
    const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', class: 'sr-only' });
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

/* ───────── menu (popover) ───────── */
/** menuButton({ label, items: () => [{ label, icon, danger, onSelect, sep }] , down }) → <div> com o botão e o menu (montado ao abrir). */
export function menuButton({ label, items, down = false, cls = 'btn btn--ghost btn--sm btn--icon', iconName = 'more' }) {
  const wrap = h('div', { class: 'more' });
  const btn = h('button', { type: 'button', class: cls, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title: label }, icon(iconName));
  let menu = null;
  const close = (refocus = true) => {
    if (!menu) return;
    menu.remove(); menu = null; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('focusin', outside, true);
    if (refocus) btn.focus();
  };
  const outside = (e) => { if (menu && !wrap.contains(e.target)) close(false); };
  const open = (focusLast = false) => {
    if (menu) return;
    menu = h('div', { class: `menu${down ? ' menu--down' : ''}`, role: 'menu', 'aria-label': label });
    for (const it of items()) {
      if (!it) continue;
      if (it.sep) { menu.append(h('div', { class: 'menu__sep', role: 'separator' })); continue; }
      const mi = h('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: `menu__item${it.danger ? ' menu__item--danger' : ''}`, dataset: { action: it.action || '' } }, it.icon ? icon(it.icon) : null, it.label);
      mi.addEventListener('click', () => { close(true); it.onSelect(); }); // foco volta ao botão do menu (quem abrir um diálogo devolve o foco para ele)
      menu.append(mi);
    }
    wrap.append(menu); btn.setAttribute('aria-expanded', 'true');
    const els = [...menu.querySelectorAll('[role=menuitem]')];
    (focusLast ? els[els.length - 1] : els[0])?.focus();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
  };
  btn.addEventListener('click', () => (menu ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(); } else if (e.key === 'ArrowUp') { e.preventDefault(); open(true); }
  });
  wrap.addEventListener('keydown', (e) => {
    if (!menu) return;
    const els = [...menu.querySelectorAll('[role=menuitem]')];
    const i = els.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Tab') close(false);
  });
  wrap.append(btn);
  return wrap;
}

/* ───────── abas (padrão WAI-ARIA, setas + Home/End) ───────── */
export function tabs(list, defs, onSelect, selectedId) {
  list.setAttribute('role', 'tablist');
  clear(list);
  const btns = defs.map((d) => {
    const b = h('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${d.id}`, 'aria-controls': d.panelId || 'painel', 'aria-selected': 'false', tabindex: '-1', dataset: { tab: d.id } }, d.icon ? icon(d.icon) : null, d.label);
    b.addEventListener('click', () => select(d.id, true));
    list.append(b);
    return b;
  });
  function select(id, userAction = false) {
    for (const b of btns) { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    onSelect(id, userAction);
  }
  list.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % btns.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = btns.length - 1;
    if (n >= 0) { e.preventDefault(); btns[n].focus(); select(btns[n].dataset.tab, true); }
  });
  select(selectedId || defs[0].id, false);
  return { select };
}

/* ───────── pedaços comuns ───────── */
export function avatar(name, { large = false, seed } = {}) {
  return h('span', { class: `avatar av-${colorIndex(seed || name)}${large ? ' avatar--lg' : ''}`, 'aria-hidden': 'true' }, initials(name));
}

export function loadingBlock(text = 'Carregando…') {
  return h('div', { class: 'loading', role: 'status' }, icon('spinner', 'spin'), text);
}

export function stateBlock({ iconName = 'info', title, text, actions = [] }) {
  const s = h('div', { class: 'state' }, icon(iconName, 'ic--xl'), h('h2', null, title));
  if (text) s.append(h('p', null, text));
  if (actions.length) s.append(h('div', { class: 'row' }, ...actions));
  return s;
}

/** Campo de formulário com rótulo, dica e erro ligados por aria. */
export function field({ id, label, type = 'text', hint, required = false, autocomplete, value, maxlength, inputmode, placeholder, name, min, max, textarea = false, rows }) {
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const props = { id, name: name || id, class: textarea ? 'textarea' : 'input', required, autocomplete, maxlength, inputmode, placeholder, min, max, value: textarea ? null : value, rows, 'aria-describedby': hintId || null };
  if (!textarea) props.type = type;
  const input = h(textarea ? 'textarea' : 'input', props);
  if (textarea && value) input.value = value;
  const err = h('p', { class: 'field-error', id: errId, hidden: true });
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint', id: hintId }, hint) : null, err);
  return { wrap, input, setError(msg) { fieldError({ input, err }, msg, hintId); }, clearError() { fieldError({ input, err }, '', hintId); } };
}
export function fieldError({ input, err }, msg, hintId) {
  if (msg) {
    err.textContent = msg; err.hidden = false; input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', [hintId, err.id].filter(Boolean).join(' '));
  } else {
    err.textContent = ''; err.hidden = true; input.removeAttribute('aria-invalid');
    if (hintId) input.setAttribute('aria-describedby', hintId); else input.removeAttribute('aria-describedby');
  }
}

/** Campo de senha com botão mostrar/ocultar (aria-pressed). */
export function passwordField({ id, label, autocomplete = 'current-password', hint, name }) {
  const f = field({ id, label, type: 'password', required: true, autocomplete, hint, name });
  const input = f.input;
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('spellcheck', 'false');
  const toggle = h('button', { type: 'button', class: 'btn btn--ghost btn--icon btn--sm toggle', 'aria-pressed': 'false', 'aria-label': 'Mostrar senha', title: 'Mostrar senha' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    const t = show ? 'Ocultar senha' : 'Mostrar senha';
    toggle.setAttribute('aria-label', t); toggle.title = t;
    clear(toggle).append(icon(show ? 'eye-off' : 'eye'));
  });
  const wrap = h('div', { class: 'input-wrap' }); input.replaceWith(wrap); wrap.append(input, toggle);
  f.wrap.insertBefore(wrap, f.wrap.querySelector('.hint') || f.wrap.querySelector('.field-error'));
  return f;
}

/** Foca no primeiro campo inválido de um formulário. */
export function focusFirstInvalid(form) { form.querySelector('[aria-invalid="true"]')?.focus(); }

export function focusMain() { const m = document.getElementById('conteudo'); if (m) { m.setAttribute('tabindex', '-1'); m.focus({ preventScroll: true }); } }

/** Mantém o estado da página na URL sem criar histórico. */
export function updateQuery(params) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(params)) { if (v === null || v === undefined || v === '') u.searchParams.delete(k); else u.searchParams.set(k, v); }
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

/* ───────── barra superior comum ───────── */
export function mountTopbar(root, user, { active, onLogout } = {}) {
  const nav = h('nav', { class: 'topnav', 'aria-label': 'Navegação principal' });
  const links = [{ id: 'acervo', href: '/acervo', label: 'Acervo', icon: 'slides' }, { id: 'importar', href: '/importar', label: 'Importar', icon: 'upload' }];
  if (user.role === 'admin') links.push({ id: 'admin', href: '/admin', label: 'Administração', icon: 'shield' });
  for (const l of links) nav.append(h('a', { href: l.href, 'aria-current': l.id === active ? 'page' : null }, icon(l.icon), l.label));
  const out = button({ label: 'Sair', icon: 'logout', variant: 'ghost', size: 'sm', onClick: (e) => onLogout?.(e.currentTarget), attrs: { id: 'btn-sair' } });
  const header = h('header', { class: 'topbar' },
    h('div', { class: 'topbar__in' },
      h('a', { class: 'brand', href: '/acervo', 'aria-label': 'Canteiro — Alvarez & Marsal, ir para o acervo' },
        h('img', { class: 'brand__wm', src: '/assets/brand/wordmark-white.png', alt: '', width: 131, height: 21 }),
        h('span', { class: 'brand__sub' }, 'Canteiro', h('i'))),
      nav,
      h('div', { class: 'userbox' },
        h('div', { class: 'userbox__who' }, avatar(user.displayName || user.email, { seed: user.id }),
          h('span', { class: 'userbox__name', id: 'user-name' }, user.displayName || user.email),
          user.role === 'admin' ? h('span', { class: 'badge badge--admin' }, 'Admin') : null),
        out)));
  clear(root).append(header);
  return header;
}
