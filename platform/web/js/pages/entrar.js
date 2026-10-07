/* /entrar — e-mail + senha, ou a conta A&M (login corporativo/SSO). Acesso só por convite (o servidor decide); aqui só mostramos o resultado em pt-BR.
   SSO: o botão leva a /api/auth/sso?email=<e-mail digitado>&next=<destino>; o servidor redireciona ao provedor e, em erro, de volta para
   /entrar?motivo=<código>. Se /api/auth/session disser se o SSO está ligado (sso: {enabled}), o botão aparece em destaque ou some; sem o indicador
   ele fica discreto e, no clique, conferimos antes (sem parâmetros e sem seguir o redirecionamento) — 501 not_configured = ainda não disponível. */
import { api, ApiError } from '../api.js';
import { h, icon, button, field, passwordField, withBusy, setBusy, alertBox, focusFirstInvalid, replace, $, announce } from '../ui.js';
import { safeNext } from '../format.js';

const MESSAGES = {
  invalid_credentials: 'E-mail ou senha incorretos. Confira os dados e tente de novo.',
  not_invited: 'Este e-mail não foi convidado. Peça um convite a um administrador do Canteiro.',
  suspended: 'Sua conta está suspensa. Fale com um administrador do Canteiro.',
  csrf: 'Esta página ficou desatualizada. Recarregue-a e tente de novo.',
  link_invalid: 'Este link expirou ou já foi usado.',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SSO_START = '/api/auth/sso';
const SSO_OFF = 'O login corporativo ainda não está disponível. Entre com e-mail e senha.';
/** Motivos que o servidor manda em /entrar?motivo=… (sessão recusada e erros do login corporativo). Só códigos conhecidos; o parâmetro nunca é ecoado. */
const MOTIVOS = {
  sessao: ['info', 'Sua sessão expirou. Entre novamente para continuar de onde parou.'],
  suspended: ['error', MESSAGES.suspended],
  not_invited: ['error', MESSAGES.not_invited],
  sso_email: ['error', 'Para entrar com a conta A&M, digite o seu e-mail corporativo completo (nome@empresa) e tente de novo.'],
  sso_dominio: ['error', 'Este e-mail não entra pelo login corporativo, que vale só para os domínios da A&M. Use o e-mail corporativo ou entre com e-mail e senha.'],
  sso_indisponivel: ['warn', 'O login corporativo está fora do ar no momento. Tente de novo em alguns minutos ou entre com e-mail e senha.'],
  sso_expirou: ['error', 'O login corporativo expirou antes de terminar (ou foi aberto em outro navegador). Comece de novo por aqui.'],
  sso_falhou: ['error', 'Não foi possível confirmar a sua conta A&M: o acesso foi cancelado ou recusado no provedor. Tente de novo.'],
  sso_limite: ['warn', 'Muitas tentativas de login corporativo a partir desta rede. Aguarde alguns minutos e tente de novo.'],
};
/** O que /api/auth/session diz do SSO: 'on' | 'off' | 'unknown' (sem indicador). */
function ssoModeOf(s) {
  const v = s && typeof s === 'object' ? s.sso : undefined;
  if (v === true || (v && typeof v === 'object' && v.enabled === true)) return 'on';
  if (v === false || (v && typeof v === 'object' && v.enabled === false)) return 'off';
  return 'unknown';
}
/** Sem indicador: pergunta ao servidor sem seguir o redirecionamento (e sem e-mail, para não abrir uma tentativa à toa).
 *  Redirecionou = ligado; 501 (not_configured) ou 404 = ainda não disponível. */
async function ssoAvailable() {
  try {
    const r = await fetch(SSO_START, { redirect: 'manual', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return 'on';
    if (r.status === 501 || r.status === 404) return 'off';
    return 'error';
  } catch { return 'error'; }
}

const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'));
const card = $('#card');

function loginMessage(err) {
  if (!(err instanceof ApiError)) return 'Não foi possível entrar agora. Tente novamente.';
  if (err.code === 'rate_limited' || err.status === 429) return err.message;
  if (err.code === 'timeout' || err.code === 'network') return err.message;
  return MESSAGES[err.code] || err.message || 'Não foi possível entrar agora. Tente novamente.';
}

function render(reason, ssoMode) {
  const email = field({ id: 'email', label: 'E-mail', type: 'email', required: true, autocomplete: 'username', maxlength: 254, inputmode: 'email', placeholder: 'nome@empresa.com.br' });
  email.input.setAttribute('autocapitalize', 'none');
  email.input.setAttribute('spellcheck', 'false');
  const pw = passwordField({ id: 'senha', label: 'Senha', autocomplete: 'current-password' });
  const slot = h('div', { id: 'form-alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block', id: 'btn-entrar' }, 'Entrar');
  const form = h('form', { id: 'form-login', novalidate: true, 'aria-label': 'Entrar no Canteiro' }, slot, email.wrap, pw.wrap, submit);

  const motivo = params.get('motivo') || reason;
  const known = Object.prototype.hasOwnProperty.call(MOTIVOS, motivo || '') ? MOTIVOS[motivo] : null;
  if (known) slot.append(alertBox(known[0], known[1], { live: motivo !== 'sessao' }));
  // voltou de uma tentativa de SSO: o login corporativo está ligado, então o botão fica em destaque (a menos que o servidor diga o contrário)
  if (/^sso_/.test(motivo || '') && ssoMode === 'unknown') ssoMode = 'on';

  // login corporativo (SSO): em destaque (= .mb do editor, com a divisória "ou") quando o servidor diz que está ligado; discreto sem indicador
  let ssoBtn = null;
  async function startSso() {
    email.clearError(); pw.clearError(); replace(slot);
    const e = email.input.value.trim();
    if (!e || !EMAIL_RE.test(e)) { email.setError(e ? 'Esse e-mail não parece válido. Confira se há erro de digitação.' : 'Informe seu e-mail corporativo para entrar com a conta A&M.'); email.input.focus(); return; }
    const go = () => { announce('Abrindo o login corporativo da A&M…'); location.assign(`${SSO_START}?${new URLSearchParams({ email: e, next })}`); };
    if (ssoMode === 'on') { setBusy(ssoBtn, true, 'Abrindo…'); go(); return; }
    await withBusy(ssoBtn, async () => {
      const st = await ssoAvailable();
      if (st === 'on') { ssoMode = 'on'; go(); await new Promise(() => {}); }   // a página vai sair daqui
      else if (st === 'off') slot.append(alertBox('info', SSO_OFF));
      else slot.append(alertBox('error', 'Não foi possível falar com o servidor agora. Verifique a conexão e tente de novo.'));
    }, 'Verificando…');
  }
  const ssoBlock = [];
  if (ssoMode !== 'off') {
    const strong = ssoMode === 'on';
    ssoBtn = button({ label: 'Entrar com a conta A&M (SSO)', icon: 'key', variant: strong ? null : 'ghost', size: strong ? null : 'sm', cls: strong ? 'btn--block' : '', attrs: { id: 'btn-sso', 'data-sso': strong ? 'ligado' : 'a-confirmar' }, onClick: startSso });
    if (strong) ssoBlock.push(h('div', { class: 'auth__or', 'aria-hidden': 'true' }, h('span', null, 'ou')), ssoBtn);
    else ssoBlock.push(h('div', { class: 'auth__sso' }, ssoBtn));
    form.append(...ssoBlock);
  }

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
    h('div', { class: 'ey' }, 'Acesso ao Canteiro'),
    h('h1', null, 'Entrar'),
    h('p', { class: 'lead' }, ssoMode === 'on' ? 'Use o e-mail do seu convite e a senha que você definiu — ou entre com a sua conta A&M.' : 'Use o e-mail do seu convite e a senha que você definiu.'),
    form,
    h('div', { class: 'auth__foot' },
      h('a', { href: '/esqueci-senha', id: 'link-esqueci' }, 'Esqueci a senha'),
      h('span', { class: 'row' }, icon('lock'), 'Acesso somente por convite')));
  email.input.focus();
}

(async function init() {
  let reason = null; let sso = 'unknown';
  try {
    const s = await api.session();
    sso = ssoModeOf(s);
    if (s?.authenticated) {
      if (s.needsPassword || s.user?.status === 'invited') { location.replace('/auth/confirmar'); return; }
      if (s.user?.status === 'active') { location.replace(next); return; }
    } else reason = s?.reason || null;
  } catch { /* sem conexão: mostra o formulário mesmo assim */ }
  render(reason, sso);
})();
