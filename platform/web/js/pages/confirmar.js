/* /auth/confirmar?token_hash=…&type=invite|recovery — troca o link do e-mail por uma sessão e pede a definição da senha.
   O token_hash sai da URL imediatamente (history.replaceState) e só vive na memória desta página. */
import { api, ApiError, fieldErrors } from '../api.js';
import { h, icon, passwordField, button, withBusy, alertBox, focusFirstInvalid, replace, $, announce } from '../ui.js';
import { passwordChecks, passwordStrength } from '../format.js';

const card = $('#card');
const params = new URLSearchParams(location.search);
const rawHash = params.get('token_hash') || '';
const rawType = params.get('type') || '';
// remove o segredo da barra de endereço e do histórico antes de qualquer outra coisa
if (params.has('token_hash') || params.has('type')) history.replaceState(null, '', location.pathname);

const TOKEN_RE = /^[A-Za-z0-9._~-]{8,512}$/;
const TYPES = new Set(['invite', 'recovery']);

function showState({ iconName = 'info', tone = '', title, text, actions = [], extra }) {
  replace(card,
    h('div', { class: 'auth__center' },
      icon(iconName, `ic--xl ${tone}`.trim()),
      h('h1', { id: 'estado-titulo' }, title),
      text ? h('p', { class: 'lead' }, text) : null,
      extra || null,
      actions.length ? h('div', { class: 'row', 'data-actions': '' }, ...actions) : null));
  $('#estado-titulo')?.setAttribute('tabindex', '-1');
  $('#estado-titulo')?.focus();
}

function invalidLink(kind) {
  showState({
    iconName: 'alert', tone: 'is-warn',
    title: 'Link inválido ou expirado',
    text: kind === 'invite'
      ? 'Este convite expirou ou já foi usado. Se você ainda não definiu sua senha, peça um novo e-mail ou solicite a um administrador que reenvie o convite.'
      : 'Este link de redefinição expirou ou já foi usado. Peça um novo e-mail para continuar.',
    actions: [
      button({ label: 'Pedir novo e-mail', icon: 'mail', variant: 'primary', href: '/esqueci-senha', attrs: { id: 'btn-novo-email' } }),
      button({ label: 'Voltar para entrar', href: '/entrar' }),
    ],
  });
}

function passwordForm({ email, kind }) {
  const pw = passwordField({ id: 'nova-senha', label: 'Nova senha', autocomplete: 'new-password', hint: 'Mínimo de 12 caracteres. Uma frase longa funciona bem.' });
  const pw2 = passwordField({ id: 'confirmar-senha', label: 'Confirme a senha', autocomplete: 'new-password' });
  const bars = h('div', { class: 'strength__bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  const sLabel = h('span', { class: 'strength__label', id: 'forca-label', 'aria-live': 'polite' }, '');
  const strength = h('div', { class: 'strength', id: 'forca', 'data-level': '0' }, bars, sLabel);
  const items = {
    length: h('li', { id: 'chk-len' }, 'Pelo menos 12 caracteres'),
    notEmail: h('li', { id: 'chk-email' }, 'Não contém o seu e-mail'),
    notCommon: h('li', { id: 'chk-comum' }, 'Não é uma senha comum (ex.: 123456789012)'),
  };
  const list = h('ul', { class: 'checklist', 'aria-label': 'Requisitos da senha' }, items.length, items.notEmail, items.notCommon);
  const slot = h('div', { id: 'form-alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block', id: 'btn-definir' }, 'Definir senha e entrar');
  const form = h('form', { id: 'form-senha', novalidate: true, 'aria-label': 'Definir senha' }, slot, pw.wrap, strength, list, pw2.wrap, submit);

  let lastLevel = -1;
  function refresh() {
    const v = pw.input.value;
    const checks = passwordChecks(v, email);
    for (const [k, li] of Object.entries(items)) {
      const ok = v ? checks[k] : false;
      li.classList.toggle('is-ok', ok);
      li.setAttribute('data-ok', String(ok));
    }
    const s = passwordStrength(v, email);
    strength.dataset.level = String(s.level);
    if (s.level !== lastLevel) { sLabel.textContent = s.level ? `Força da senha: ${s.label}` : ''; lastLevel = s.level; }
  }
  pw.input.addEventListener('input', refresh);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    pw.clearError(); pw2.clearError(); replace(slot);
    const v = pw.input.value;
    const checks = passwordChecks(v, email);
    if (!checks.length) pw.setError('A senha precisa ter pelo menos 12 caracteres.');
    else if (!checks.notEmail) pw.setError('A senha não pode conter o seu e-mail.');
    else if (!checks.notCommon) pw.setError('Essa senha é muito comum. Escolha outra, de preferência uma frase longa.');
    if (!pw2.input.value) pw2.setError('Repita a senha para confirmar.');
    else if (pw2.input.value !== v) pw2.setError('As senhas não são iguais.');
    if (form.querySelector('[aria-invalid="true"]')) { focusFirstInvalid(form); return; }
    await withBusy(submit, async () => {
      try {
        await api.post('/api/auth/password', { password: v }, { auth: false });
        announce('Senha definida. Abrindo o acervo.');
        location.assign('/acervo');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          invalidLink(kind);
          return;
        }
        const fieldMsg = err instanceof ApiError ? fieldErrors(err).password : null;
        if (fieldMsg) { pw.setError(fieldMsg); pw.input.focus(); }
        else slot.append(alertBox('error', err?.message || 'Não foi possível definir a senha. Tente novamente.'));
      }
    }, 'Salvando…');
  });

  replace(card,
    h('h1', { id: 'estado-titulo' }, kind === 'recovery' ? 'Crie uma nova senha' : 'Defina sua senha'),
    h('p', { class: 'lead' }, kind === 'recovery' ? 'Escolha uma senha nova para voltar ao Canteiro.' : 'Seu e-mail foi confirmado. Escolha uma senha para entrar no Canteiro.'),
    email ? h('p', { class: 'hint break', id: 'conta-email' }, 'Conta: ', h('strong', null, email)) : null,
    form);
  pw.input.focus();
  refresh();
}

async function confirmWithToken() {
  if (!TYPES.has(rawType) || !TOKEN_RE.test(rawHash)) { invalidLink(rawType === 'recovery' ? 'recovery' : 'invite'); return; }
  const kind = rawType;
  const tokenHash = rawHash; // somente em memória
  const attempt = async () => {
    showState({ iconName: 'spinner', title: 'Confirmando seu link…', tone: '' });
    card.querySelector('.ic')?.classList.add('spin');
    try {
      const s = await api.post('/api/auth/verify', { tokenHash, type: kind }, { auth: false });
      if (s?.needsPassword === false && s.authenticated) { location.assign('/acervo'); return; }
      passwordForm({ email: s?.user?.email || '', kind });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'link_invalid' || err.status === 410 || err.status === 400 || err.status === 401 || err.status === 404)) { invalidLink(kind); return; }
      const retryable = !(err instanceof ApiError) || err.status === 0 || err.status >= 500 || err.status === 429;
      showState({
        iconName: 'alert', tone: 'is-warn', title: 'Não foi possível confirmar agora',
        text: err?.message || 'Tente novamente em instantes.',
        actions: retryable ? [button({ label: 'Tentar de novo', icon: 'refresh', variant: 'primary', onClick: attempt, attrs: { id: 'btn-tentar' } })] : [button({ label: 'Voltar para entrar', href: '/entrar' })],
      });
    }
  };
  await attempt();
}

(async function init() {
  if (rawHash || rawType) { await confirmWithToken(); return; }
  // sem token: só serve para quem já confirmou o e-mail e ainda não definiu a senha
  try {
    const s = await api.session();
    if (s?.authenticated && (s.needsPassword || s.user?.status === 'invited')) { passwordForm({ email: s.user?.email || '', kind: 'invite' }); return; }
    if (s?.authenticated) { location.replace('/acervo'); return; }
  } catch { /* cai no link inválido */ }
  invalidLink('invite');
})();
