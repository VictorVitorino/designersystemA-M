/* Política de senha (docs/API.md §3): mínimo 12 caracteres; não pode conter o e-mail; não pode estar na lista de senhas comuns;
   tampouco ser trivial (repetição, sequência). Máximo 72 BYTES: o GoTrue usa bcrypt, que ignora/recusa o que passa de 72 bytes —
   melhor avisar do que aceitar uma senha que seria silenciosamente truncada.
   Função pura (sem I/O) para ser testada à exaustão. */
import { COMMON_PASSWORDS } from './common-passwords.js';

export const MIN_LENGTH = 12, MAX_BYTES = 72;
const COMMON = new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase()));
const strip = (s) => s.replace(/[\s\d\W_]+$/u, '');               // tira sufixos numéricos/símbolos: "Senha@2024!" → "senha"
const lettersOnly = (s) => s.replace(/[\s\d\W_]+/gu, '');

function trivial(p) {
  if (/^(.)\1+$/u.test(p)) return true;                           // aaaaaaaaaaaa
  const chars = [...p];
  for (const period of [2, 3, 4]) {                               // abababababab, 123123123123
    if (chars.length >= 8 && chars.every((ch, i) => ch === chars[i % period])) return true;
  }
  let run = 1, best = 1, prev = 0;                                // 123456789012 / abcdefghijkl / 987654321: sequência contínua (passo ±1)
  for (let i = 1; i < chars.length; i++) {
    const d = chars[i].codePointAt(0) - chars[i - 1].codePointAt(0);
    run = (d === 1 || d === -1) ? (d === prev ? run + 1 : 2) : 1;
    prev = d; best = Math.max(best, run);
  }
  return best >= 8 && best >= Math.ceil(chars.length * 0.7);
}

/** @param {string} password @param {string} [email] @returns {{ok:true}|{ok:false,reason:string}} */
export function validatePassword(password, email = '') {
  if (typeof password !== 'string') return { ok: false, reason: 'Senha inválida.' };
  if ([...password].length < MIN_LENGTH) return { ok: false, reason: `A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.` };
  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) return { ok: false, reason: `A senha pode ter no máximo ${MAX_BYTES} bytes (cerca de 70 caracteres).` };
  if (/[\u0000-\u001f\u007f]/.test(password)) return { ok: false, reason: 'A senha contém caracteres não permitidos.' };
  const low = password.toLowerCase().normalize('NFKC');
  const mail = String(email || '').trim().toLowerCase();
  if (mail) {
    const local = mail.split('@')[0];
    if (low.includes(mail) || (local.length >= 4 && low.includes(local))) return { ok: false, reason: 'A senha não pode conter o seu e-mail.' };
  }
  const base = strip(low);
  if (COMMON.has(low) || COMMON.has(base) || COMMON.has(lettersOnly(low)) || COMMON.has(low.replace(/\s+/g, ''))) return { ok: false, reason: 'Essa senha é muito comum. Escolha outra, mais longa e imprevisível.' };
  if (trivial(low)) return { ok: false, reason: 'A senha é previsível demais (repetição ou sequência). Escolha outra.' };
  return { ok: true };
}
