import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeEvidenceFailure } from '../../tools/lib/common.js';
import { conferirArquivos, ensaiar, relatorioMarkdown } from '../../tools/restore-rehearsal.js';
import { renderEvidence } from '../../tools/restore-drill.js';

const secret = 'postgres://app_api:FAKE_PASSWORD_DO_NOT_PUBLISH@db.example.invalid:5432/postgres?token=FAKE_TOKEN_DO_NOT_PUBLISH';

test('relatório de recuperação nunca incorpora mensagens nem códigos arbitrários de exceção', () => {
  assert.equal(safeEvidenceFailure({ code: 'manifest_mac', message: secret }), 'chave de backup ou MAC inválido');
  assert.equal(safeEvidenceFailure({ code: 'sha_mismatch', message: secret }), 'integridade do backup: SHA-256 divergente');
  assert.equal(safeEvidenceFailure({ code: 'CUSTOM_' + secret, message: secret }), 'falha operacional (detalhes omitidos por segurança)');
  assert.equal(safeEvidenceFailure(new Error(secret)), 'falha operacional (detalhes omitidos por segurança)');
  assert.equal(safeEvidenceFailure(null), 'falha operacional (detalhes omitidos por segurança)');
});

test('falha de leitura do espelho cifrado conserva SHA, mas não credenciais no diagnóstico', async () => {
  const sha = 'a'.repeat(64);
  const target = { async head() { throw new Error(secret); } };
  const rep = await conferirArquivos({ target, keys: [], items: [{ sha256: sha, size: 64 }] });
  assert.equal(rep.pass, false);
  assert.equal(rep.errors.length, 1);
  assert.equal(rep.errors[0].sha, sha);
  assert.equal(rep.errors[0].error, 'falha operacional (detalhes omitidos por segurança)');
  assert.doesNotMatch(JSON.stringify(rep), /FAKE_PASSWORD_DO_NOT_PUBLISH|FAKE_TOKEN_DO_NOT_PUBLISH/);
});

test('ensaio reprovado não copia erro de destino externo ao JSON nem ao Markdown', async () => {
  const target = {
    describe: () => 'destino fictício',
    async *list() { throw new Error(secret); },
  };
  const rep = await ensaiar({
    target, keys: [], toUrl: 'postgres://postgres:senha-ficticia@127.0.0.1:5432/canteiro_t_test',
  });
  assert.equal(rep.ok, false);
  assert.match(rep.erro, /detalhes omitidos/);
  assert.match(rep.problemas.join(' '), /detalhes omitidos/);
  const combined = JSON.stringify(rep) + relatorioMarkdown(rep);
  assert.doesNotMatch(combined, /FAKE_PASSWORD_DO_NOT_PUBLISH|FAKE_TOKEN_DO_NOT_PUBLISH/);
});

test('evidência do desastre é gerada somente com erro classificado', () => {
  const ev = {
    startedAt: '2026-10-09T10:00:00.000Z', totalMs: 5, ok: false,
    error: safeEvidenceFailure(new Error(secret)),
    steps: [{ name: 'Conferir backup', ms: 5, ok: false, error: safeEvidenceFailure(new Error(secret)) }],
    dataset: {}, backups: {}, disaster: {}, verification: {}, restore: {},
  };
  const md = renderEvidence(ev);
  assert.match(md, /REPROVADO/);
  assert.match(md, /detalhes omitidos/);
  assert.doesNotMatch(md + JSON.stringify(ev), /FAKE_PASSWORD_DO_NOT_PUBLISH|FAKE_TOKEN_DO_NOT_PUBLISH/);
});
