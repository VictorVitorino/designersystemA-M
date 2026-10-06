/* session.js — sessão das páginas protegidas: consulta GET /api/auth/session, redireciona quem não entrou
   e monta a barra superior comum (marca, navegação, nome, "Sair"). Nada de token no JS: a sessão vive em cookies HttpOnly. */
import { api, goToLogin, friendlyMessage } from './api.js';
import { $, h, button, mountTopbar, stateBlock, replace, setBusy } from './ui.js';

/** Fica pendente para sempre (a página está sendo redirecionada). */
const never = () => new Promise(() => {});

export async function logout(btn) {
  setBusy(btn, true);
  try { await api.post('/api/auth/logout', undefined, { auth: false }); } catch { /* mesmo com falha de rede, sai da tela */ }
  location.assign('/entrar');
  return never();
}

/**
 * Exige usuário ativo. Devolve o usuário; senão redireciona (e nunca resolve).
 * opts: { active: 'acervo'|'importar'|'admin', admin: boolean }
 */
export async function requireUser({ active, admin = false } = {}) {
  const root = $('#topbar-root');
  const main = $('#conteudo');
  let s;
  try {
    s = await api.session(); // o servidor renova a sessão sozinho quando só o cookie de acesso expirou
  } catch (e) {
    if (main) replace(main, h('div', { class: 'page' }, stateBlock({
      iconName: 'alert', title: 'Não foi possível verificar seu acesso',
      text: friendlyMessage(e, 'Verifique sua conexão e tente novamente.'),
      actions: [button({ label: 'Tentar de novo', icon: 'refresh', variant: 'primary', onClick: () => location.reload() })],
    })));
    return never();
  }
  if (!s?.authenticated) { goToLogin(s?.reason === 'suspended' || s?.reason === 'not_invited' ? s.reason : 'entre'); return never(); }
  if (s.needsPassword || s.user?.status === 'invited') { location.replace('/auth/confirmar'); return never(); }
  const user = s.user;
  if (user.status === 'suspended') {
    if (main) replace(main, h('div', { class: 'page' }, stateBlock({
      iconName: 'ban', title: 'Conta suspensa', text: 'Seu acesso está suspenso. Fale com um administrador do Canteiro.',
      actions: [button({ label: 'Sair', icon: 'logout', variant: 'primary', onClick: (e) => logout(e.currentTarget) })],
    })));
    return never();
  }
  if (root) mountTopbar(root, user, { active, onLogout: logout });
  if (admin && user.role !== 'admin') {
    if (main) replace(main, h('div', { class: 'page' }, stateBlock({
      iconName: 'lock', title: 'Acesso restrito', text: 'Esta área é só para administradores. Se você precisa de acesso, peça a um administrador.',
      actions: [button({ label: 'Voltar ao acervo', icon: 'arrow-left', variant: 'primary', href: '/acervo' })],
    })));
    document.title = 'Acesso restrito — Canteiro · A&M';
    return never();
  }
  return user;
}

