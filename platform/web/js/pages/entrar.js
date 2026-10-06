/* /entrar — e-mail + senha. Acesso só por convite (o servidor decide); aqui só mostramos o resultado em pt-BR. */
import { api, ApiError } from '../api.js';
import { h, icon, field, passwordField, withBusy, alertBox, focusFirstInvalid, replace, $, announce } from '../ui.js';
import { safeNext } from '../format.js';

const MESSAGES = {
  invalid_credentials: 'E-mail ou senha incorretos. Confira os dados e tente de novo.',
  not_invited: 'Este e-mail não foi convidado. Peça um convite a um administrador do Canteiro.',
  suspended: 'Sua conta está suspensa. Fale com um administrador do Canteiro.',
  csrf: 'Esta página ficou desatualizada. Recarregue-a e tente de novo.',
  link_invalid: 'Este link expirou ou já foi usado.',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'));
const card = $('#card');

function loginMessage(err) {
  if (!(err instanceof ApiError)) return 'Não foi possível entrar agora. Tente novamente.';
  if (err.code === 'rate_limited' || err.status === 429) return err.message;
  if (err.code === 'timeout' || err.code === 'network') return err.message;
  return MESSAGES[err.code] || err.message || 'Não foi possível entrar agora. Tente novamente.';
}

function render(reason) {
  const email = field({ id: 'email', label: 'E-mail', type: 'email', required: true, autocomplete: 'username', maxlength: 254, inputmode: 'email', placeholder: 'nome@empresa.com.br' });
  email.input.setAttribute('autocapitalize', 'none');
  email.input.setAttribute('spellcheck', 'false');
  const pw = passwordField({ id: 'senha', label: 'Senha', autocomplete: 'current-password' });
  const slot = h('div', { id: 'form-alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block', id: 'btn-entrar' }, 'Entrar');
  const form = h('form', { id: 'form-login', novalidate: true, 'aria-label': 'Entrar no Canteiro' }, slot, email.wrap, pw.wrap, submit);

  const motivo = params.get('motivo') || reason;
  if (motivo === 'sessao') slot.append(alertBox('info', 'Sua sessão expirou. Entre novamente para continuar de onde parou.', { live: false }));
  else if (motivo === 'suspended') slot.append(alertBox('error', MESSAGES.suspended));
  else if (motivo === 'not_invited') slot.append(alertBox('error', MESSAGES.not_invited));

  let lock = null;
  function lockFor(seconds) {
    clearInterval(lock);
    let left = Math.max(1, Math.ceil(seconds));
    submit.setAttribute('aria-disabled', 'true');
    const tick = () => {
      if (left <= 0) { clearInterval(lock); submit.removeAttribute('aria-disabled'); submit.textContent = 'Entrar'; return; }
      submit.textContent = `Aguarde ${left} s`;
      left -= 1;
    };
    tick();
    lock = setInterval(tick, 1000);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submit.getAttribute('aria-disabled') === 'true') return;
    email.clearError(); pw.clearError(); replace(slot);
    const e = email.input.value.trim();
    const p = pw.input.value;
    if (!e) email.setError('Informe seu e-mail.');
    else if (!EMAIL_RE.test(e)) email.setError('Esse e-mail não parece válido. Confira se há erro de digitação.');
    if (!p) pw.setError('Informe sua senha.');
    if (!e || !EMAIL_RE.test(e) || !p) { focusFirstInvalid(form); return; }
    let wait = 0;
    await withBusy(submit, async () => {
      try {
        const s = await api.post('/api/auth/login', { email: e, password: p }, { auth: false });
        if (s?.needsPassword) { location.assign('/auth/confirmar'); return; }
        announce('Acesso confirmado. Abrindo o acervo.');
        location.assign(next);
      } catch (err) {
        slot.append(alertBox('error', loginMessage(err)));
        pw.input.value = '';
        if (err instanceof ApiError && err.status === 429) wait = err.retryAfter ?? 5;
        else (err?.code === 'invalid_credentials' ? pw.input : email.input).focus();
      }
    }, 'Entrando…');
    if (wait) lockFor(wait);
  });

  replace(card,
    h('h1', null, 'Entrar'),
    h('p', { class: 'lead' }, 'Use o e-mail do seu convite e a senha que você definiu.'),
    form,
    h('div', { class: 'auth__foot' },
      h('a', { href: '/esqueci-senha', id: 'link-esqueci' }, 'Esqueci a senha'),
      h('span', { class: 'row' }, icon('lock'), 'Acesso somente por convite')));
  email.input.focus();
}

(async function init() {
  let reason = null;
  try {
    const s = await api.session();
    if (s?.authenticated) {
      if (s.needsPassword || s.user?.status === 'invited') { location.replace('/auth/confirmar'); return; }
      if (s.user?.status === 'active') { location.replace(next); return; }
    } else reason = s?.reason || null;
  } catch { /* sem conexão: mostra o formulário mesmo assim */ }
  render(reason);
})();
