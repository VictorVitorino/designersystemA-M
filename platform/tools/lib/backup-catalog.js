/* tools/lib/backup-catalog.js — nomes, listagem e leitura de manifestos de backup no destino.
   Layout no destino:
     db/<nome>.dump.enc            dump do banco (pg_dump -Fc) cifrado
     db/<nome>.authdata.enc        (opcional) dados de auth.users/auth.identities do Supabase Auth, cifrados
     db/<nome>.manifest.json       manifesto (SHA-256, tamanhos, contagens, versão do esquema…) com MAC; existe SÓ se o backup terminou
     objects/a/xx/yy/<sha>.enc     espelho cifrado dos arquivos
     status/objects-last-run.json  relatório do último espelho
   <nome> = canteiro-<ambiente>-<AAAAMMDDTHHMMSSZ> */
import { ToolError, utcStamp, parseUtcStamp } from './common.js';
import { verifyManifest } from './backup-crypto.js';

export const NAME_RE = /^canteiro-([a-z0-9]+)-(\d{8}T\d{6}Z)$/;
export const backupName = (env, d = new Date()) => `canteiro-${String(env).toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown'}-${utcStamp(d)}`;
export const dumpKey = (name) => `db/${name}.dump.enc`;
export const manifestKey = (name) => `db/${name}.manifest.json`;
export const authKey = (name) => `db/${name}.authdata.enc`;   // dados do Supabase Auth (opcional; BACKUP_INCLUDE_AUTH=1)
export const STATUS_OBJECTS = 'status/objects-last-run.json';

export function parseName(name) { const m = NAME_RE.exec(name); return m ? { env: m[1], at: parseUtcStamp(m[2]) } : null; }

/** Lista backups COMPLETOS (os que têm manifesto) e também dumps órfãos (sem manifesto: backup interrompido). */
export async function listBackups(target) {
  const manifests = new Map(), dumps = new Map();
  for await (const o of target.list('db/')) {
    let m;
    if ((m = /^db\/(.+)\.manifest\.json$/.exec(o.key))) manifests.set(m[1], o);
    else if ((m = /^db\/(.+)\.dump\.enc$/.exec(o.key))) dumps.set(m[1], o);
  }
  const complete = [], incomplete = [];
  for (const [name, o] of manifests) { const p = parseName(name); if (p && dumps.has(name)) complete.push({ name, at: p.at, env: p.env, dumpBytes: dumps.get(name).size, manifestKey: o.key }); else incomplete.push({ name, reason: 'sem dump' }); }
  for (const name of dumps.keys()) if (!manifests.has(name)) incomplete.push({ name, reason: 'sem manifesto (backup interrompido)' });
  complete.sort((a, b) => a.at - b.at); return { complete, incomplete };
}
export async function readJson(target, key) {
  const chunks = []; for await (const c of await target.get(key)) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ToolError(`arquivo JSON inválido no destino: ${key}`, { code: 'bad_json' }); }
}
/** Lê o manifesto e (se houver chaves) confere o MAC. `requireMac` falha quando não há chaves para conferir. */
export async function loadManifest(target, name, { keys = null, requireMac = true } = {}) {
  const m = await readJson(target, manifestKey(name));
  if (m.format !== 'canteiro-backup-manifest') throw new ToolError(`${manifestKey(name)} não é um manifesto de backup do Canteiro`, { code: 'bad_manifest' });
  if (keys) { if (!verifyManifest(keys, m)) throw new ToolError(`manifesto ${name} com MAC inválido (adulterado ou chave errada)`, { code: 'manifest_mac' }); }
  else if (requireMac) throw new ToolError('sem chave não é possível autenticar o manifesto', { code: 'no_key', exit: 2 });
  return m;
}
export async function resolveBackupName(target, { name, latest = true } = {}) {
  if (name) return name;
  const { complete } = await listBackups(target);
  if (!complete.length) throw new ToolError('nenhum backup completo encontrado no destino', { code: 'no_backup' });
  return latest ? complete[complete.length - 1].name : complete[0].name;
}
