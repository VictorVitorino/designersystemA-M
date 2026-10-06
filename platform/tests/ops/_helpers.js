import './_env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { setup, ADMIN_URL, OPS_URL, API_URL } from '../db/helpers.js';
import { withDatabase } from '../../tools/lib/pg.js';

export { setup, ADMIN_URL, OPS_URL, API_URL };
export const newKey = () => crypto.randomBytes(32).toString('base64');
export const tmp = (p = 'ops') => fs.mkdtempSync(path.join(os.tmpdir(), `canteiro-${p}-`));
export const rmrf = (d) => fs.rmSync(d, { recursive: true, force: true });
export const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const maint = () => postgres(withDatabase(ADMIN_URL, 'postgres'), { max: 1, onnotice: () => {} });
/** Cria (recria) um banco descartável canteiro_t_c_<sufixo> e devolve a URL de admin dele. */
export async function freshDb(suffix) {
  const base = new URL(ADMIN_URL).pathname.slice(1); if (!/^canteiro_(test|t_[a-z0-9]+)$/.test(base)) throw new Error('banco base inesperado: ' + base);
  const name = `${base}_${suffix}`; const m = maint(); try { await m.unsafe(`drop database if exists ${name} with (force)`); await m.unsafe(`create database ${name}`); } finally { await m.end(); }
  return withDatabase(ADMIN_URL, name);
}
export async function dropDb(url) { const name = new URL(url).pathname.slice(1); if (!/^canteiro_(test|t_[a-z0-9]+)_[a-z0-9_]+$/.test(name)) throw new Error('recuso apagar ' + name); const m = maint(); try { await m.unsafe(`drop database if exists ${name} with (force)`); } finally { await m.end(); } }

// ---- moto (S3 falso) — só sobe se o executável existir; senão os testes que dependem dele são pulados explicitamente
export { motoPath, startMoto, makeBucket } from '../../tools/lib/moto.js';
/** Insere `n` usuários e apresentações mínimas com arquivos reais (pelo papel de sistema) e devolve o que foi criado. */
export async function seedSmall(ops, store, { files = 6 } = {}) {
  const { keyOfSha } = await import('../../tools/lib/mirror.js'); const out = { shas: [] };
  const [u] = await ops.asSystem((tx) => tx`insert into app.users(email, display_name, role, status) values (${`o${Date.now()}@am.test`}, 'Dono', 'admin', 'active') returning id`); out.userId = u.id;
  for (let i = 0; i < files; i++) {
    const buf = crypto.randomBytes(2000 + i * 500); const h = sha(buf); out.shas.push(h); await store.put(keyOfSha(h), buf);
    await ops.asSystem((tx) => tx`insert into app.assets(sha256, size_bytes, mime, kind, status, uploaded_by, ready_at, created_at) values (${h}, ${buf.length}, 'image/png', 'image', 'ready', ${u.id}, now(), now() - interval '40 days')`);
  }
  const [p] = await ops.asSystem((tx) => tx`insert into app.presentations(owner_id, title, content, content_hash, slide_count) values (${u.id}, 'Apresentação de teste', ${tx.json({ v: 1, slides: [] })}, ${sha('x')}, 1) returning id`); out.presId = p.id;
  return out;
}
