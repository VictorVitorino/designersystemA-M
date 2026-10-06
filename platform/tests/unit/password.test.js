import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword, MIN_LENGTH, MAX_BYTES } from '../../src/auth/password.js';
import { COMMON_PASSWORDS } from '../../src/auth/common-passwords.js';

const bad = (pw, email) => { const r = validatePassword(pw, email); assert.equal(r.ok, false, `deveria recusar: ${pw}`); return r.reason; };

test('lista embutida tem pelo menos 200 senhas distintas', () => {
  assert.ok(new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase())).size >= 200);
});
test('mínimo de 12 caracteres', () => {
  assert.equal(MIN_LENGTH, 12);
  assert.match(bad('Ab1!xyz'), /12 caracteres/);
  assert.match(bad('Ab1!xyzQwe9'), /12 caracteres/);          // 11
  assert.equal(validatePassword('Ab1!xyzQwe9#').ok, true);       // 12
});
test('máximo de 72 bytes (limite do bcrypt do GoTrue)', () => {
  assert.equal(MAX_BYTES, 72);
  const ok72 = 'Tx9#kLm2$vQ8rZpWe5&nHj7!uYb4*cFd6^gSa3%oPi1@tRe0+qMz8-lKx2=vBn5?cXw9~Pd4Rt'.slice(0, 72);
  assert.equal(Buffer.byteLength(ok72), 72);
  assert.equal(validatePassword(ok72).ok, true);
  assert.match(bad(ok72 + 'x'), /72 bytes/);
  assert.match(bad('ç'.repeat(40)), /72 bytes/);                 // 80 bytes em UTF-8 (40 caracteres)
});
test('não pode conter o e-mail nem a parte local dele', () => {
  assert.match(bad('xx-maria.souza@am.test-xx', 'maria.souza@am.test'), /e-mail/);
  assert.match(bad('MARIA.SOUZA-2026-forte', 'maria.souza@am.test'), /e-mail/);        // parte local, ignorando maiúsculas
  assert.equal(validatePassword('cavalo-bateria-grampo-azul', 'maria.souza@am.test').ok, true);
  assert.equal(validatePassword('Qwx9-Zk4m-Pp2L', 'ab@am.test').ok, true);            // parte local curta (<4) não bloqueia por coincidência
});
test('recusa senhas comuns, inclusive com sufixo numérico/símbolo e maiúsculas', () => {
  for (const pw of ['password123456', 'Password1234!', 'senha123456', 'SENHA@123456!!', 'qwertyuiop12', '123456789012', 'Canteiro1234!!', 'minhasenha123', 'mudar123456', 'Alvarez&Marsal2026'.slice(0, 7) + '!!!!!!!!!!!!']) {
    bad(pw);
  }
});
test('recusa repetição e sequência', () => {
  bad('aaaaaaaaaaaa'); bad('abababababab'); bad('123123123123'); bad('abcdefghijklmn'); bad('987654321098');
});
test('recusa caracteres de controle e entradas que não são texto', () => {
  bad('Bom-pass-word\u0000x-9'); bad(undefined); bad(null); bad(123456789012);
});
test('aceita frases longas e senhas aleatórias', () => {
  for (const pw of ['cavalo bateria grampo azul', 'Tx9#kLm2$vQ8rZp', 'o rato roeu a roupa do rei de roma 42', 'correct-horse-battery-staple']) assert.equal(validatePassword(pw, 'fulano@am.test').ok, true, pw);
});
