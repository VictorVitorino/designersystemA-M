/* Driver de armazenamento em disco (desenvolvimento, testes e instalações pequenas; produção usa s3.js).
   Segurança:
   - o caminho é montado só a partir do SHA validado (keys.js); mesmo assim confirmamos que o resultado está DENTRO da raiz;
   - nunca seguimos symlink: diretórios são conferidos com lstat e o arquivo final é aberto com O_NOFOLLOW;
   - escrita atômica (arquivo temporário no mesmo diretório + rename): leitor nunca vê objeto pela metade, e queda no meio
     da escrita não deixa um objeto "válido" corrompido;
   - permissões 0700 (pastas) / 0600 (arquivos): somente o usuário do processo lê. */
import { promises as fsp, constants as C } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { objectKey, assertSha, assertShaPrefix, assertCursor, clampLimit, toBuffer, assertMime, StorageIntegrityError, stagingKey } from './keys.js';
import { sha256Hex } from '../lib/canonical.js';

const DIR_MODE = 0o700, FILE_MODE = 0o600;
const HEX2 = /^[0-9a-f]{2}$/, SHA = /^[0-9a-f]{64}$/;

/** @param {string} localDir */
export function createLocalStorage(localDir) {
  if (typeof localDir !== 'string' || !localDir.trim()) throw new Error('storage local: STORAGE_LOCAL_DIR é obrigatório');
  const configured = path.resolve(localDir);
  let root = null;            // raiz real (sem symlinks), resolvida uma vez

  async function init() {
    if (root) return root;
    await fsp.mkdir(configured, { recursive: true, mode: DIR_MODE });
    root = await fsp.realpath(configured); // a raiz em si PODE ser symlink escolhido pelo operador; tudo abaixo dela não
    return root;
  }

  /** Garante um diretório filho real (não symlink), criando com 0700. Conferido a CADA operação (3 lstat ≈ microssegundos):
   *  sem cache, um symlink plantado depois da primeira escrita também é pego. */
  async function ensureDir(dir, create) {
    let st = await fsp.lstat(dir).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
    if (!st) {
      if (!create) return false;
      await fsp.mkdir(dir, { mode: DIR_MODE }).catch((e) => { if (e.code !== 'EEXIST') throw e; });
      st = await fsp.lstat(dir);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new StorageIntegrityError('diretório de armazenamento inesperado (symlink?)', 'unsafe_path');
    return true;
  }

  /** Resolve o caminho do objeto e garante que os diretórios existem (create) ou ao menos são seguros. */
  async function locate(sha, create) {
    const r = await init();
    const key = objectKey(sha);           // lança se sha inválido
    const parts = key.split('/');
    const dirs = [path.join(r, parts[0]), path.join(r, parts[0], parts[1]), path.join(r, parts[0], parts[1], parts[2])];
    const file = path.join(dirs[2], parts[3]);
    if (!file.startsWith(r + path.sep)) throw new StorageIntegrityError('caminho fora da raiz', 'unsafe_path'); // cinto e suspensório
    for (const d of dirs) if (!(await ensureDir(d, create))) return { file, exists: false };
    return { file, dir: dirs[2], exists: true };
  }

  /** Abre sem seguir symlink; devolve null se não existir. */
  async function openObject(sha) {
    const loc = await locate(sha, false);
    if (!loc.exists) return null;
    let fh;
    try { fh = await fsp.open(loc.file, C.O_RDONLY | C.O_NOFOLLOW); }
    catch (e) {
      if (e.code === 'ENOENT') return null;
      if (e.code === 'ELOOP') throw new StorageIntegrityError('objeto é um symlink', 'unsafe_path');
      throw e;
    }
    const st = await fh.stat();
    if (!st.isFile()) { await fh.close(); throw new StorageIntegrityError('objeto não é arquivo regular', 'unsafe_path'); }
    return { fh, size: st.size };
  }

  return {
    driver: 'local',

    /** Idempotente: se o objeto já existe com o mesmo tamanho não reescreve. Confere o SHA dos bytes (verify=false só para chamadores
     *  que acabaram de calcular o hash); mime é validado mas o driver local não o guarda (o tipo fica no banco). */
    async put(sha, bytes, { mime, verify = true } = {}) {
      assertSha(sha); assertMime(mime);
      const buf = toBuffer(bytes);
      if (buf.length === 0) throw new StorageIntegrityError('objeto vazio', 'empty');
      if (verify && sha256Hex(buf) !== sha) throw new StorageIntegrityError('os bytes não correspondem ao sha256 informado', 'sha_mismatch');
      const loc = await locate(sha, true);
      const cur = await fsp.lstat(loc.file).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
      if (cur) {
        if (cur.isSymbolicLink() || !cur.isFile()) throw new StorageIntegrityError('objeto é um symlink', 'unsafe_path');
        if (cur.size === buf.length) return { created: false, size: buf.length };
        // mesmo sha mas tamanho diferente = objeto corrompido: cura regravando o conteúdo (já conferido acima)
      }
      const tmp = path.join(loc.dir, `.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
      let fh;
      try {
        fh = await fsp.open(tmp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, FILE_MODE);
        await fh.writeFile(buf);
        await fh.sync();            // durabilidade antes do rename: após o rename o objeto já é "oficial"
        await fh.close(); fh = null;
        await fsp.rename(tmp, loc.file); // atômico no mesmo diretório; substitui só se for a cura acima
      } catch (e) {
        if (fh) await fh.close().catch(() => {});
        await fsp.unlink(tmp).catch(() => {});
        throw e;
      }
      return { created: true, size: buf.length };
    },

    async get(sha) {
      const o = await openObject(sha);
      if (!o) return null;
      try { const body = await o.fh.readFile(); return { body, size: body.length }; } finally { await o.fh.close(); }
    },

    /** Devolve um ReadableStream (Web) — mesmo tipo do driver s3, para o chamador não precisar distinguir. */
    async getStream(sha) {
      const o = await openObject(sha);
      if (!o) return null;
      const node = o.fh.createReadStream({ autoClose: true });
      return { stream: Readable.toWeb(node), size: o.size };
    },

    async head(sha) {
      const o = await openObject(sha);
      if (!o) return null;
      await o.fh.close();
      return { size: o.size };
    },

    async delete(sha) {
      const loc = await locate(sha, false);
      if (!loc.exists) return { deleted: false };
      try { await fsp.unlink(loc.file); return { deleted: true }; } catch (e) { if (e.code === 'ENOENT') return { deleted: false }; throw e; }
    },

    /** Local não tem URL assinada: o chamador transmite os bytes pela API. */
    async signedGetUrl(sha) { assertSha(sha); return null; },     // mesmo com retorno nulo, a entrada é validada (contrato igual ao do driver s3)
    async createUpload(sha) { assertSha(sha); return null; },
    async getStaging(userId, sha) { stagingKey(userId, sha); return null; },
    async promoteStaging(userId, sha) { stagingKey(userId, sha); const o = await openObject(sha); if (o) await o.fh.close(); return { promoted: false, existed: !!o, mismatch: false }; },
    async deleteStaging(userId, sha) { stagingKey(userId, sha); return { deleted: false }; },
    async purgeStaging() { return { deleted: 0, bytes: 0 }; },

    /** Relê o objeto em fluxo (memória constante) e confere o hash. */
    async verify(sha) {
      const o = await openObject(sha);
      if (!o) return { ok: false, size: null, actualSha: null };
      const h = createHash('sha256'); let n = 0;
      try { for await (const chunk of o.fh.createReadStream({ autoClose: false })) { h.update(chunk); n += chunk.length; } } finally { await o.fh.close().catch(() => {}); }
      const actualSha = h.digest('hex');
      return { ok: actualSha === sha, size: n, actualSha };
    },

    /** Ordenado por sha (= ordem da chave). prefix = prefixo hex de sha; cursor = último sha da página anterior. */
    async list({ prefix = '', limit, cursor } = {}) {
      const r = await init();
      assertShaPrefix(prefix); const after = assertCursor(cursor); const max = clampLimit(limit);
      const out = [];
      const base = path.join(r, 'a');
      if (!(await ensureDir(base, false))) return { keys: [], items: [], next: null };
      const ls = async (dir, re) => (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.isSymbolicLink() && re.test(d.name)).map((d) => d.name).sort();
      for (const d1 of await ls(base, HEX2)) {
        if (!d1.startsWith(prefix.slice(0, 2)) || (after && d1 < after.slice(0, 2))) continue;
        for (const d2 of await ls(path.join(base, d1), HEX2)) {
          const p4 = d1 + d2;
          if (!p4.startsWith(prefix.slice(0, 4)) || (after && p4 < after.slice(0, 4))) continue;
          const dir = path.join(base, d1, d2);
          const names = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && SHA.test(d.name) && d.name.startsWith(p4) && d.name.startsWith(prefix) && (!after || d.name > after)).map((d) => d.name).sort();
          for (const sha of names) {
            if (out.length >= max) return finish(out, true);
            const st = await fsp.lstat(path.join(dir, sha)).catch(() => null);
            if (!st || !st.isFile()) continue;
            out.push({ sha, key: objectKey(sha), size: st.size, lastModified: st.mtime });
          }
        }
      }
      return finish(out, false);
    },

    /** Para /api/ready: a raiz existe e é gravável. */
    async ping() { try { const r = await init(); await fsp.access(r, C.R_OK | C.W_OK); return true; } catch { return false; } },
  };
}

function finish(items, truncated) {
  return { keys: items.map((i) => i.key), items, next: truncated && items.length ? items[items.length - 1].sha : null };
}
