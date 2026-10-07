/* tools/lib/mirror.js — espelho INCREMENTAL e CRIPTOGRAFADO dos arquivos (objetos endereçados por conteúdo) para o destino de backup,
   restauração dos objetos, verificação de integridade (re-hash) e PODA SEGURA (opcional) do espelho.

   Por que é incremental e barato: a chave do objeto é `a/xx/yy/<sha256>` e o conteúdo nunca muda (imutável). Se a chave já existe no
   destino com o tamanho esperado, não há nada a copiar. Só os que faltam são lidos, conferidos (SHA-256 == nome) e enviados.
   Cada objeto vai CIFRADO (mesmo formato dos dumps) para `objects/<chave>.enc`: o destino de backup nunca vê conteúdo em claro.

   Escala (500 GB–1 TB, ~1 milhão de arquivos): a comparação é feita POR PREFIXO — 256 fatias `a/00/` … `a/ff/`, listadas com paginação
   do próprio S3 (1.000 por página) nos dois lados ao mesmo tempo — então a memória fica limitada a uma fatia (~1/256 do total), e não ao
   acervo inteiro. Com `deadline` a cópia para de começar arquivos novos no horário-limite e devolve `stoppedByTime` (o job do GitHub tem
   6 h): a próxima execução continua de onde parou, porque o que já foi copiado não é copiado de novo.

   O espelho NUNCA apaga nada sozinho. A poda (`pruneMirror`) é OPCIONAL, manual, simulada por padrão, e só remove um arquivo cifrado se ele
   (1) não existe mais no armazenamento principal, (2) não é referenciado pelo banco atual, (3) não é referenciado por NENHUM backup do
   banco ainda dentro da retenção (cada backup guarda a lista dos arquivos que referencia) e (4) está no espelho há mais de `minAgeDays`.
   Travas: recusa se algum backup retido não tiver a lista, se a origem vier vazia, ou se for apagar mais que `maxFraction` do espelho. */
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

/** As 256 fatias do espaço de chaves (`a/00/` … `a/ff/`): a origem e o espelho são comparados fatia por fatia. */
export const SHARDS = Object.freeze(Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0')));
async function collect(store, prefix) { const m = new Map(); for await (const o of store.list(prefix)) m.set(o.key, o); return m; }
/** Lista a fatia nos dois lados ao mesmo tempo. A promessa já nasce com um tratador (a listagem da fatia seguinte corre em paralelo com a
 *  cópia da atual; se falhar, o erro aparece quando ela for aguardada — e não derruba o processo como "rejeição não tratada"). */
const listarFatia = (source, dest, sh) => { const p = Promise.all([collect(source, `a/${sh}/`), collect(dest, `${OBJ_PREFIX}a/${sh}/`)]); p.catch(() => {}); return p; };

/**
 * Copia para `dest` (criptografado) o que ainda não está lá, fatia por fatia.
 * @param {{source:object, dest:object, key:Buffer, concurrency?:number, dryRun?:boolean, log?:Function, limit?:number, deadline?:number|null, now?:()=>number, shards?:string[]}} o
 *   deadline: horário (ms) a partir do qual nenhuma cópia NOVA começa (as que estão em andamento terminam); limit: máximo de arquivos copiados.
 */
export async function mirrorObjects({ source, dest, key, concurrency = 4, dryRun = false, log = () => {}, limit = Infinity, deadline = null, now = Date.now, shards = SHARDS }) {
  const t0 = Date.now();
  const report = { startedAt: new Date(t0).toISOString(), dryRun, sourceObjects: 0, sourceBytes: 0, alreadyInDestination: 0, toCopy: 0, toCopyBytes: 0, copied: 0, copiedBytes: 0, ignoredKeys: 0, extraInDestination: 0, corruptInSource: [], failed: [], shardsTotal: shards.length, shardsDone: 0, stoppedByTime: false, pendingByTime: 0 };
  const passou = () => deadline != null && now() >= deadline;
  let agendados = 0, done = 0;
  // lista a fatia seguinte enquanto copia a atual (a listagem é barata, mas cada página é uma ida e volta na rede)
  let proxima = shards.length ? listarFatia(source, dest, shards[0]) : null;
  for (let i = 0; i < shards.length; i++) {
    if (passou()) { report.stoppedByTime = true; break; }
    const [src, dst] = await proxima; proxima = i + 1 < shards.length ? listarFatia(source, dest, shards[i + 1]) : null;
    const todo = []; const seen = new Set();
    for (const o of src.values()) {
      const sha = shaOfKey(o.key); if (!sha) { report.ignoredKeys++; continue; }
      report.sourceObjects++; report.sourceBytes += o.size; const dk = `${OBJ_PREFIX}${o.key}.enc`; seen.add(dk);
      const have = dst.get(dk);
      if (have && have.size === encryptedSize(o.size)) { report.alreadyInDestination++; continue; }
      if (agendados < limit) { todo.push({ key: o.key, sha, size: o.size, dk }); agendados++; }
    }
    for (const k of dst.keys()) if (!seen.has(k)) report.extraInDestination++;
    report.toCopy += todo.length; report.toCopyBytes += todo.reduce((a, t) => a + t.size, 0);
    if (!dryRun && todo.length) {
      await mapLimit(todo, concurrency, async (it) => {
        if (passou()) { report.stoppedByTime = true; report.pendingByTime++; return; }
        try {
          const rs = await source.get(it.key); const v = verifyingHash(it.sha, it.sha.slice(0, 12));
          const enc = createEncryptStream(key); await dest.put(it.dk, pipelineStream(rs, v, enc));
          report.copied++; report.copiedBytes += it.size;
        } catch (e) {
          if (e?.code === 'hash_mismatch') report.corruptInSource.push(it.sha); else report.failed.push({ sha: it.sha, error: String(e?.message || e).slice(0, 200) });
        }
        if (++done % 200 === 0) log(`espelho: ${done} arquivos copiados nesta execução (fatia ${shards[i]}/ff)`);
      });
    }
    report.shardsDone++;
    if (report.stoppedByTime) break;
  }
  if (report.stoppedByTime) log(`espelho: horário-limite atingido na fatia ${report.shardsDone}/${shards.length}; o restante continua na próxima execução (incremental)`);
  log(`espelho: ${report.sourceObjects} objetos na origem (fatias lidas: ${report.shardsDone}/${shards.length}), ${report.alreadyInDestination} já no destino, ${report.toCopy} a copiar${dryRun ? ' (simulação)' : ''}`);
  report.durationMs = Date.now() - t0;
  report.complete = !report.failed.length && !report.corruptInSource.length && !report.stoppedByTime;
  return report;
}

/**
 * Poda SEGURA do espelho (opcional, manual). Apaga só arquivos cifrados que: não existem mais na origem, não estão em `protegidos`
 * (banco atual + listas de todos os backups retidos — quem chama monta esse conjunto) e estão no espelho há mais de `minAgeDays`.
 * Simulação por padrão. Recusa (sem apagar nada) se a origem vier vazia ou se a poda passar de `maxFraction` do espelho.
 * @returns {Promise<{apply:boolean, mirrorObjects:number, mirrorBytes:number, candidates:number, candidateBytes:number, deleted:number, deletedBytes:number, keptYoung:number, keptReferenced:number, keptInSource:number, refused:string|null, failed:object[]}>}
 */
export async function pruneMirror({ source, dest, protegidos, apply = false, minAgeDays = 30, maxFraction = 0.1, concurrency = 8, now = new Date(), shards = SHARDS, log = () => {} }) {
  if (!(protegidos instanceof Set)) throw new ToolError('pruneMirror: informe o conjunto de arquivos protegidos (banco atual + backups retidos)', { code: 'usage' });
  const rep = { apply, minAgeDays, maxFraction, mirrorObjects: 0, mirrorBytes: 0, sourceObjects: 0, candidates: 0, candidateBytes: 0, deleted: 0, deletedBytes: 0, keptYoung: 0, keptReferenced: 0, keptInSource: 0, ignoredKeys: 0, refused: null, failed: [] };
  const limiteIdade = now.getTime() - minAgeDays * 86400e3; const candidatos = [];
  let proxima = shards.length ? listarFatia(source, dest, shards[0]) : null;
  for (let i = 0; i < shards.length; i++) {
    const [src, dst] = await proxima; proxima = i + 1 < shards.length ? listarFatia(source, dest, shards[i + 1]) : null;
    const naOrigem = new Set(); for (const o of src.values()) { const sha = shaOfKey(o.key); if (sha) { naOrigem.add(sha); rep.sourceObjects++; } }
    for (const o of dst.values()) {
      const m = /^objects\/(a\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64})\.enc$/.exec(o.key); if (!m) { rep.ignoredKeys++; continue; }
      const sha = shaOfKey(m[1]); rep.mirrorObjects++; rep.mirrorBytes += o.size;
      if (naOrigem.has(sha)) { rep.keptInSource++; continue; }
      if (protegidos.has(sha)) { rep.keptReferenced++; continue; }
      const quando = o.lastModified ? new Date(o.lastModified).getTime() : now.getTime();
      if (!(quando < limiteIdade)) { rep.keptYoung++; continue; }
      candidatos.push({ key: o.key, size: o.size }); rep.candidates++; rep.candidateBytes += o.size;
    }
  }
  if (rep.mirrorObjects > 0 && rep.sourceObjects === 0) rep.refused = 'a origem (armazenamento principal) veio VAZIA: configuração errada? Nada foi apagado';
  else if (rep.candidates > Math.max(1, Math.floor(rep.mirrorObjects * maxFraction))) rep.refused = `a poda apagaria ${rep.candidates} de ${rep.mirrorObjects} arquivos do espelho (mais que ${Math.round(maxFraction * 100)}%): confira a configuração antes; nada foi apagado`;
  log(`poda do espelho: ${rep.mirrorObjects} arquivos no espelho, ${rep.candidates} podáveis (${rep.keptInSource} ainda na origem, ${rep.keptReferenced} referenciados por banco/backups retidos, ${rep.keptYoung} com menos de ${minAgeDays} dias)${rep.refused ? ' — RECUSADA: ' + rep.refused : apply ? '' : ' (SIMULAÇÃO: nada apagado)'}`);
  if (apply && !rep.refused && candidatos.length) {
    await mapLimit(candidatos, concurrency, async (c) => {
      try { await dest.delete(c.key); rep.deleted++; rep.deletedBytes += c.size; } catch (e) { rep.failed.push({ key: c.key, error: String(e?.message || e).slice(0, 160) }); }
    });
  }
  rep.ok = !rep.refused && !rep.failed.length;
  return rep;
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
