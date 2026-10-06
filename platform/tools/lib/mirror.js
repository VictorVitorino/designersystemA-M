/* tools/lib/mirror.js — espelho INCREMENTAL e CRIPTOGRAFADO dos arquivos (objetos endereçados por conteúdo) para o destino de backup,
   restauração dos objetos e verificação de integridade (re-hash).

   Por que é incremental e barato: a chave do objeto é `a/xx/yy/<sha256>` e o conteúdo nunca muda (imutável). Se a chave já existe no
   destino com o tamanho esperado, não há nada a copiar. Só os que faltam são lidos, conferidos (SHA-256 == nome) e enviados.
   Cada objeto vai CIFRADO (mesmo formato dos dumps) para `objects/<chave>.enc`: o destino de backup nunca vê conteúdo em claro.
   NUNCA apaga nada no destino (apagar é decisão humana; veja docs/BACKUP-E-RESTAURACAO.md). */
import crypto from 'node:crypto';
import { Transform, pipeline as pipelineCb } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ToolError, mapLimit } from './common.js';
import { createEncryptStream, createDecryptStream, encryptedSize, DEFAULT_CHUNK, HEADER_LEN, RECORD_OVERHEAD } from './backup-crypto.js';

export const OBJ_PREFIX = 'objects/';
export const SRC_KEY_RE = /^a\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{64})$/;
export const shaOfKey = (key) => SRC_KEY_RE.exec(key)?.[1] || null;
export const keyOfSha = (sha) => `a/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;

/** Transform que passa os bytes adiante e, no fim, FALHA se o SHA-256 não for o esperado. */
export function verifyingHash(expectedSha, label = '') {
  const h = crypto.createHash('sha256'); let bytes = 0;
  const t = new Transform({
    transform(c, _e, cb) { h.update(c); bytes += c.length; cb(null, c); },
    flush(cb) { const got = h.digest('hex'); t.sha256 = got; if (expectedSha && got !== expectedSha) return cb(new ToolError(`conteúdo não confere com o SHA-256 ${label || expectedSha.slice(0, 12)} (objeto corrompido)`, { code: 'hash_mismatch' })); cb(); },
  });
  Object.defineProperty(t, 'bytes', { get: () => bytes });
  return t;
}

/** Tamanho em claro a partir do tamanho cifrado (válido para blocos de tamanho padrão). */
export function plainSizeFromEncrypted(encSize, chunkSize = DEFAULT_CHUNK) {
  if (encSize < HEADER_LEN + RECORD_OVERHEAD) return -1;
  const n = Math.ceil((encSize - HEADER_LEN) / (chunkSize + RECORD_OVERHEAD));
  return encSize - HEADER_LEN - n * RECORD_OVERHEAD;
}

async function collect(store, prefix) { const m = new Map(); for await (const o of store.list(prefix)) m.set(o.key, o); return m; }

/** Copia para `dest` (criptografado) o que ainda não está lá. */
export async function mirrorObjects({ source, dest, key, concurrency = 4, dryRun = false, log = () => {}, limit = Infinity }) {
  const t0 = Date.now();
  const report = { startedAt: new Date(t0).toISOString(), dryRun, sourceObjects: 0, sourceBytes: 0, alreadyInDestination: 0, toCopy: 0, copied: 0, copiedBytes: 0, ignoredKeys: 0, extraInDestination: 0, corruptInSource: [], failed: [] };
  const destMap = await collect(dest, OBJ_PREFIX); const seen = new Set(); const todo = [];
  for await (const o of source.list('a/')) {
    const sha = shaOfKey(o.key); if (!sha) { report.ignoredKeys++; continue; }
    report.sourceObjects++; report.sourceBytes += o.size; const dk = `${OBJ_PREFIX}${o.key}.enc`; seen.add(dk);
    const have = destMap.get(dk);
    if (have && have.size === encryptedSize(o.size)) { report.alreadyInDestination++; continue; }
    if (todo.length < limit) todo.push({ key: o.key, sha, size: o.size, dk });
  }
  for (const k of destMap.keys()) if (!seen.has(k)) report.extraInDestination++;
  report.toCopy = todo.length;
  log(`espelho: ${report.sourceObjects} objetos na origem, ${report.alreadyInDestination} já no destino, ${todo.length} a copiar${dryRun ? ' (simulação)' : ''}`);
  if (!dryRun) {
    let done = 0;
    await mapLimit(todo, concurrency, async (it) => {
      try {
        const rs = await source.get(it.key); const v = verifyingHash(it.sha, it.sha.slice(0, 12));
        const enc = createEncryptStream(key); await dest.put(it.dk, pipelineStream(rs, v, enc));
        report.copied++; report.copiedBytes += it.size;
      } catch (e) {
        if (e?.code === 'hash_mismatch') report.corruptInSource.push(it.sha); else report.failed.push({ sha: it.sha, error: String(e?.message || e).slice(0, 200) });
      }
      if (++done % 200 === 0) log(`espelho: ${done}/${todo.length}`);
    });
  }
  report.durationMs = Date.now() - t0;
  report.complete = !report.failed.length && !report.corruptInSource.length;
  return report;
}

/** stream.pipeline() que devolve o último stream (para consumir com for-await dentro de put()): erro em qualquer etapa destrói todas. */
function pipelineStream(...streams) { return pipelineCb(...streams, () => {}); }

/** Restaura objetos do espelho cifrado para `dest` (pasta ou bucket principal): confere o SHA-256 de cada um contra o nome. */
export async function restoreObjects({ backup, dest, keys, concurrency = 4, only = null, log = () => {} }) {
  const t0 = Date.now(); const report = { restored: 0, restoredBytes: 0, alreadyPresent: 0, notInBackup: [], failed: [] };
  const present = new Set();
  const all = [];
  for await (const o of backup.list(OBJ_PREFIX)) {
    if (!o.key.endsWith('.enc')) continue; const key = o.key.slice(OBJ_PREFIX.length, -4); const sha = shaOfKey(key); if (!sha) continue;
    if (only && !only.has(sha)) continue; all.push({ key, sha, encSize: o.size, bk: o.key }); present.add(sha);
  }
  if (only) for (const s of only) if (!present.has(s)) report.notInBackup.push(s);
  let done = 0;
  await mapLimit(all, concurrency, async (it) => {
    try {
      const have = await dest.head(it.key);
      if (have && have.size === plainSizeFromEncrypted(it.encSize)) { report.alreadyPresent++; return; }
      const rs = await backup.get(it.bk); const dec = createDecryptStream(keys); const v = verifyingHash(it.sha, it.sha.slice(0, 12));
      await dest.put(it.key, pipelineStream(rs, dec, v));
      report.restored++; report.restoredBytes += have ? 0 : plainSizeFromEncrypted(it.encSize);
    } catch (e) { report.failed.push({ sha: it.sha, error: String(e?.message || e).slice(0, 200) }); }
    if (++done % 200 === 0) log(`objetos: ${done}/${all.length}`);
  });
  report.durationMs = Date.now() - t0; report.ok = !report.failed.length && !report.notInBackup.length; return report;
}

/** Re-hash de cada objeto da lista [{sha256,size}] no armazenamento: relata ausentes, corrompidos e de tamanho errado. */
export async function verifyObjects({ store, items, concurrency = 6, log = () => {} }) {
  const t0 = Date.now(); const rep = { total: items.length, ok: 0, missing: [], corrupt: [], sizeMismatch: [], bytesChecked: 0, errors: [] };
  let done = 0;
  await mapLimit(items, concurrency, async (it) => {
    try {
      const head = await store.head(keyOfSha(it.sha256));
      if (!head) { rep.missing.push(it.sha256); return; }
      const h = crypto.createHash('sha256'); let n = 0; const rs = await store.get(keyOfSha(it.sha256));
      await pipeline(rs, new Transform({ transform(c, _e, cb) { h.update(c); n += c.length; cb(); } }));
      rep.bytesChecked += n;
      if (h.digest('hex') !== it.sha256) rep.corrupt.push(it.sha256);
      else if (it.size != null && Number(it.size) !== n) rep.sizeMismatch.push(it.sha256);
      else rep.ok++;
    } catch (e) { rep.errors.push({ sha: it.sha256, error: String(e?.message || e).slice(0, 160) }); }
    if (++done % 500 === 0) log(`verificação: ${done}/${items.length}`);
  });
  rep.durationMs = Date.now() - t0; rep.pass = !rep.missing.length && !rep.corrupt.length && !rep.sizeMismatch.length && !rep.errors.length; return rep;
}
