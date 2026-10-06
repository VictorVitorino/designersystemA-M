/* format.js — formatação em pt-BR e validações pequenas (sem dependências, sem DOM). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const NF = new Intl.NumberFormat('pt-BR');
const NF1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
export const formatNumber = (n) => (Number.isFinite(Number(n)) ? NF.format(Number(n)) : '—');

/** "3 slides", "1 slide". */
export function plural(n, one, many) {
  const v = Number(n) || 0;
  return `${NF.format(v)} ${v === 1 ? one : many}`;
}

/** Bytes legíveis: 1,5 MB. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${NF.format(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${NF1.format(v)} ${units[i]}`;
}

function toDate(iso) {
  if (iso instanceof Date) return iso;
  if (iso == null || iso === '') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "agora há pouco", "há 5 min", "há 3 h", "ontem", "há 4 dias", "há 2 meses". */
export function timeAgo(iso, now = Date.now()) {
  const d = toDate(iso);
  if (!d) return '—';
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 45) return 'agora há pouco';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(s / 3600);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(s / 86400);
  if (days < 2) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const mo = Math.round(days / 30);
  if (mo < 12) return `há ${mo} ${mo === 1 ? 'mês' : 'meses'}`;
  const y = Math.round(days / 365);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}

const DTF = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const DF = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });
export const formatDateTime = (iso) => { const d = toDate(iso); return d ? DTF.format(d) : '—'; };
export const formatDate = (iso) => { const d = toDate(iso); return d ? DF.format(d) : '—'; };

/** Tempo de espera legível a partir de segundos: "30 segundos", "8 minutos", "2 horas". */
export function waitText(seconds) {
  const s = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (s < 60) return `${s} ${s === 1 ? 'segundo' : 'segundos'}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.ceil(m / 60);
  return `${h} ${h === 1 ? 'hora' : 'horas'}`;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]][0] || '';
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] || '' : '';
  return (first + last).toUpperCase();
}

/** Índice estável (0–7) de cor para avatares. */
export function colorIndex(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 8;
}

export const roleLabel = (r) => (r === 'admin' ? 'Administrador' : r === 'member' ? 'Membro' : String(r || '—'));
export const statusLabel = (s) => ({ active: 'Ativo', invited: 'Convidado', suspended: 'Suspenso', pending: 'Pendente', accepted: 'Aceito', revoked: 'Revogado', expired: 'Expirado' }[s] || String(s || '—'));

/** Caminho interno seguro para redirecionar (anti open-redirect). Aceita só "/algo" no mesmo site; recusa "//", "/\", esquemas e controles. */
export function safeNext(raw, fallback = '/acervo', origin = (typeof location !== 'undefined' ? location.origin : 'http://localhost')) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return fallback;
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  let u;
  try { u = new URL(raw, origin); } catch { return fallback; }
  if (u.origin !== origin) return fallback;
  const path = u.pathname + u.search + u.hash;
  if (path[0] !== '/' || path[1] === '/' || path[1] === '\\') return fallback; // "/./..//host" normaliza para "//host"
  if (/^\/(entrar|auth\/confirmar|esqueci-senha)(\/|$|\?)/.test(path)) return fallback;
  return path;
}

/** Célula de CSV segura: aspas, e apóstrofo antes de = + - @ (CSV injection). */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const csvLine = (cells) => cells.map(csvCell).join(',');

/** Pontuação simples de senha (0–4) — só orienta; quem decide é o servidor. */
export function passwordStrength(pw, email = '') {
  const p = String(pw || '');
  const checks = passwordChecks(p, email);
  if (!p) return { level: 0, label: '' };
  let score = 0;
  if (p.length >= 12) score++;
  if (p.length >= 16) score++;
  const classes = [/[a-zà-ú]/, /[A-ZÀ-Ú]/, /\d/, /[^A-Za-zÀ-úÀ-Ú0-9]/].filter((r) => r.test(p)).length;
  if (classes >= 3) score++;
  if (new Set(p).size >= 8 && !/(.)\1{3,}/.test(p)) score++;
  if (!checks.length || !checks.notEmail || !checks.notCommon) score = Math.min(score, 1);
  const level = p.length < 12 ? Math.min(score, 1) || 1 : Math.max(1, Math.min(4, score));
  return { level, label: ['', 'Fraca', 'Razoável', 'Boa', 'Forte'][level] };
}

const COMMON = ['123456789012', 'senha1234567', 'password1234', 'qwertyuiop12', 'abcdefghijkl', 'canteiro1234', 'alvarezmarsal', 'senhasenhasenha', 'mudar123456', 'admin1234567', '111111111111', '000000000000'];
export function passwordChecks(pw, email = '') {
  const p = String(pw || '');
  const lower = p.toLowerCase();
  const local = String(email || '').split('@')[0].toLowerCase();
  const repeated = /^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(p);
  return {
    length: p.length >= 12,
    notEmail: !(email && (lower.includes(String(email).toLowerCase()) || (local.length >= 4 && lower.includes(local)))),
    notCommon: !(COMMON.some((c) => lower.includes(c)) || repeated),
  };
}
