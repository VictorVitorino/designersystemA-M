/* tools/lib/secret-rules.js — regras e lista de exceções (allowlist) do secret-scan.
   Para silenciar um falso positivo: (1) prefira mudar o texto para um placeholder (<SENHA>, ${VAR}, …);
   (2) se for um exemplo público documentado, acrescente-o a ALLOW_VALUES ou o caminho a ALLOW_PATHS (com comentário do porquê);
   (3) em último caso, ponha `secret-scan:allow` no MESMO trecho/linha. Nada disso é automático: toda exceção aparece em revisão de código. */
import path from 'node:path';

const b64urlJson = (s) => { try { return JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; } };
export function entropy(s) { const f = new Map(); for (const c of s) f.set(c, (f.get(c) || 0) + 1); let h = 0; for (const n of f.values()) { const p = n / s.length; h -= p * Math.log2(p); } return h; }

// Valores públicos/documentados (exemplos oficiais dos provedores). NÃO coloque aqui nenhum segredo real.
export const ALLOW_VALUES = new Set([
  'AKIAIOSFODNN7EXAMPLE',                          // exemplo oficial da documentação da AWS
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',      // idem (chave secreta de exemplo)
  'AKIAI44QH8DHBEXAMPLE',                          // idem
]);
// Caminhos onde exemplos são esperados. Tudo é relativo à raiz do repositório e usa "/".
export const ALLOW_PATHS = [
  /^platform\/tools\/lib\/secret-rules\.js$/,       // este arquivo descreve os padrões
  /(^|\/)package-lock\.json$/,                      // hashes de integridade (sha512-…), nunca segredos
  /^original\//,                                    // cópia preservada do arquivo original (somente leitura)
];
export const PLACEHOLDER_RE = /^(<[^>]*>|\$\{[^}]*\}|\$\{\{.*\}\}|\$[A-Z_][A-Z0-9_]*|\[[^\]]*\]|\{\{.*\}\}|\*+|x{3,}|\.{3,}|%s|\$\d|senha|password|pass|secret|changeme|change-me|troque.*|sua[-_ ]?senha|your[-_ ]?password|minha[-_ ]?senha|<.*>|.*(example|exemplo|placeholder|dummy|fake).*|.*SENHA.*|.*PASSWORD.*|.*PROJECT.?REF.*)$/i;
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|::1|\[::1\]|0\.0\.0\.0|db|postgres|host\.docker\.internal)$/i;
const SENSITIVE_FILE_RES = [
  [/(^|\/)\.env(\.[^/]+)?$/i, (p) => !/\.(example|sample|template|dist|defaults)$/i.test(p), 'arquivo .env versionado (contém segredos reais; use .env.example)'],
  [/\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/i, (p) => !/\.(example|sample)$/i.test(p), 'arquivo de chave/certificado privado versionado'],
  [/(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/, () => true, 'chave SSH privada versionada'],
  [/(^|\/)(credentials\.json|service-account[^/]*\.json|client_secret[^/]*\.json)$/i, () => true, 'credencial de serviço versionada'],
  [/(^|\/)\.(npmrc|pypirc|netrc|git-credentials)$/i, () => true, 'arquivo de credenciais de ferramenta versionado'],
];

/** Regras por linha. `check(match, ctx)` pode devolver false para descartar o achado (falso positivo). */
export const RULES = [
  { id: 'aws-access-key', severity: 'alta', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'aws-secret-key', severity: 'alta', re: /aws.{0,20}secret.{0,20}["'\s:=]+([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi, group: 1, check: (v) => entropy(v) > 4.0 && !/EXAMPLE/i.test(v) },
  { id: 'gcp-api-key', severity: 'alta', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'gcp-service-account', severity: 'alta', re: /"private_key_id"\s*:\s*"[0-9a-f]{40}"/g },
  { id: 'supabase-secret-key', severity: 'critica', re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
  { id: 'supabase-access-token', severity: 'critica', re: /\bsbp_[0-9a-f]{40}\b/g },
  { id: 'jwt', severity: 'alta', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    // service_role = crítica; qualquer JWT longo é suspeito. Chaves PÚBLICAS de demonstração do Supabase local (iss=supabase-demo) são aceitas.
    classify: (tok) => { const p = b64urlJson(tok.split('.')[1]); if (p?.iss === 'supabase-demo') return null; if (tok.length < 100) return null; return p?.role === 'service_role' ? { id: 'supabase-service-role-jwt', severity: 'critica' } : { id: 'jwt-longo', severity: 'alta' }; } },
  { id: 'slack-token', severity: 'alta', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
  { id: 'slack-app-token', severity: 'alta', re: /\bxapp-\d-[A-Z0-9]{6,}-\d{6,}-[a-z0-9]{16,}/g },
  { id: 'slack-webhook', severity: 'alta', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}/g },
  { id: 'github-token', severity: 'critica', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'github-fine-grained-token', severity: 'critica', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },
  { id: 'stripe-live-key', severity: 'critica', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g },
  { id: 'stripe-webhook-secret', severity: 'alta', re: /\bwhsec_[A-Za-z0-9]{24,}\b/g },
  { id: 'private-key-block', severity: 'critica', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'db-url-password', severity: 'alta', re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/([^\s:/@'"`<>]+):([^\s@/'"`<>]+)@([^\s/:'"`?]+)/g, group: 2,
    check: (pw, m) => { const host = m[3]; let dec = pw; try { dec = decodeURIComponent(pw); } catch { /* mantém */ } return dec.length >= 6 && !PLACEHOLDER_RE.test(dec) && !LOCAL_HOST_RE.test(host) && !/(^|\.)(invalid|example|test|localhost)$|exemplo|example/i.test(host); } },
  { id: 'segredo-generico', severity: 'media', re: /(?:secret|passw(?:or)?d|token|api[_-]?key|private[_-]?key|access[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9/+_\-=.!@#$%^&*]{20,})["']/gi, group: 1,
    check: (v) => !PLACEHOLDER_RE.test(v) && !/process\.env|import\.meta|\$\{|\{\{|\.\.\.|^[a-z_]+\(/i.test(v) && entropy(v) >= 3.8 && !/^[a-z]+([A-Z][a-z]+)+$/.test(v) && !/^[a-z0-9]+([-_.][a-z0-9]+){2,}$/i.test(v) },
];

export function isAllowedPath(rel) { return ALLOW_PATHS.some((re) => re.test(rel)); }
export function sensitiveFileFinding(rel) {
  for (const [re, pred, why] of SENSITIVE_FILE_RES) if (re.test(rel) && pred(rel)) return why;
  return null;
}
export const redactPreview = (v) => (v.length <= 8 ? '***' : `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} caracteres)`);
export const posix = (p) => p.split(path.sep).join('/');
