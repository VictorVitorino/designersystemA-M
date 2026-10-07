/* /esqueci-senha — pede o e-mail de redefinição. O servidor responde sempre 202 (não revela se o e-mail existe);
   a interface também mostra sempre a mesma mensagem de sucesso. */
import { api, ApiError } from '../api.js';
import { h, icon, field, button, withBusy, alertBox, replace, $, announce } from '../ui.js';

const card = $('#card');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function form() {
  const email = field({ id: 'email', label: 'E-mail da sua conta', type: 'email', required: true, autocomplete: 'email', maxlength: 254, inputmode: 'email', placeholder: 'nome@empresa.com.br' });
  email.input.setAttribute('autocapitalize', 'none');
  email.input.setAttribute('spellcheck', 'false');
  const slot = h('div', { id: 'form-alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block', id: 'btn-enviar' }, 'Enviar link de redefinição');
  const f = h('form', { id: 'form-esqueci', novalidate: true, 'aria-label': 'Redefinir senha' }, slot, email.wrap, submit);
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    email.clearError(); replace(slot);
    const v = email.input.value.trim();
    if (!v) { email.setError('Informe o e-mail da sua conta.'); email.input.focus(); return; }
    if (!EMAIL_RE.test(v)) { email.setError('Esse e-mail não parece válido. Confira se há erro de digitação.'); email.input.focus(); return; }
    await withBusy(submit, async () => {
      try {
        await api.post('/api/auth/forgot', { email: v }, { auth: false });
        done();
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) { email.setError('Esse e-mail não parece válido. Confira se há erro de digitação.'); email.input.focus(); }
        else if (err instanceof ApiError && (err.status === 429 || err.status === 0 || err.status >= 500)) slot.append(alertBox('error', err.message));
        else done(); // demais respostas: a mesma mensagem de sempre (nunca revelamos se o e-mail existe)
      }
    }, 'Enviando…');
  });
  replace(card,
    h('div', { class: 'ey' }, 'Recuperar o acesso'),
    h('h1', null, 'Esqueci a senha'),
    h('p', { class: 'lead' }, 'Informe o e-mail do seu convite. Se ele estiver cadastrado, enviaremos um link para criar uma nova senha.'),
    f,
    h('div', { class: 'auth__foot' }, h('a', { href: '/entrar' }, 'Voltar para entrar')));
  email.input.focus();
}

function done() {
  announce('Pedido enviado.');
  replace(card,
    h('div', { class: 'auth__center', id: 'sucesso' },
      icon('mail', 'ic--xl is-ok'),
      h('h1', { id: 'sucesso-titulo', tabindex: '-1' }, 'Verifique seu e-mail'),
      h('p', { class: 'lead' }, 'Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha. Confira também a caixa de spam. O link vale por pouco tempo.'),
      h('div', { class: 'row' },
        button({ label: 'Voltar para entrar', variant: 'primary', href: '/entrar' }),
        button({ label: 'Usar outro e-mail', onClick: form, attrs: { id: 'btn-outro' } }))));
  $('#sucesso-titulo').focus();
}

form();
