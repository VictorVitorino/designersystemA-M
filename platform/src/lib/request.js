/* Helpers que TODA rota usa (contrato com os middlewares). Os middlewares (middleware/*.js) preenchem c.var:
     requestId, ip, ua, user ({id,email,displayName,role,status} | null), deps ({config, db, storage, gotrue})
   Rotas autenticadas fazem: const user = requireUser(c); await txAsUser(c, async (tx) => { … });  */
import { E } from './errors.js';

export function requireUser(c, { allowInvited = false } = {}) {
  const u = c.get('user');
  if (!u) throw E.unauthenticated();
  if (u.status === 'suspended') throw E.suspended();
  if (u.status !== 'active' && !(allowInvited && u.status === 'invited')) throw E.forbidden('Conclua a definição da senha para continuar.');
  return u;
}
export function requireAdmin(c) { const u = requireUser(c); if (u.role !== 'admin') throw E.forbidden('Somente administradores.'); return u; }

/** Executa fn(tx) numa transação como o usuário da requisição (SET LOCAL ROLE app_user + app.user_id); o RLS decide o acesso. */
export function txAsUser(c, fn, opts) { const u = requireUser(c, opts); return c.get('deps').db.asUser(u.id, fn); }

/** Registra auditoria na MESMA transação (autor = usuário logado, imposto pelo banco). meta: só ids/contagens/tamanhos — nunca segredos nem conteúdo. */
export async function audit(tx, c, action, entityType = null, entityId = null, meta = {}) {
  await tx`select app.audit(${action}, ${entityType}, ${entityId == null ? null : String(entityId)}, ${c.get('ip') || null}::inet, ${c.get('ua') || null}, ${c.get('requestId') || null}, ${tx.json(redact(meta))})`;
}
/** Auditoria sem usuário (ex.: login falho), fora de transação de usuário. */
export async function auditAnon(c, action, entityType = null, entityId = null, meta = {}) {
  const { db } = c.get('deps');
  await db.anon((tx) => tx`select app.audit(${action}, ${entityType}, ${entityId == null ? null : String(entityId)}, ${c.get('ip') || null}::inet, ${c.get('ua') || null}, ${c.get('requestId') || null}, ${tx.json(redact(meta))})`);
}

/** Limite de taxa (janela fixa no Postgres). Lança 429. key: uuid do usuário, ip ou e-mail em hash. */
export async function limit(c, bucket, key, windowS, max) {
  const { db } = c.get('deps');
  const [r] = await db.anon((tx) => tx`select * from app.hit_rate(${bucket}, ${String(key)}, ${windowS}::int, ${max}::int)`);
  if (!r.allowed) { try { await auditAnon(c, 'security.rate_limited', 'bucket', bucket, { key_kind: String(key).length > 40 ? 'hash' : 'id' }); } catch { /* auditoria nunca derruba o bloqueio */ } throw E.rateLimited(r.reset_in); }
  return r;
}

/** Vários limites de uma vez, em UMA consulta e em CADEIA: o balde k só é consultado (e incrementado) se todos os anteriores permitiram —
    uma requisição já barrada no balde do usuário não consome o balde do IP (senão um único cliente abusivo fecharia o escritório inteiro).
    specs: [[bucket, key, windowS, max], …]. Lança 429 no primeiro estourado. */
export async function limitMany(c, specs) {
  const { db } = c.get('deps');
  const chain = (tx, k) => {
    const [bucket, key, windowS, max] = specs[k];
    const next = k + 1 < specs.length ? tx`case when a.allowed then ${chain(tx, k + 1)} end` : tx`null::jsonb`;   // CASE só avalia o sub-select se o balde anterior permitiu
    return tx`(select to_jsonb(a) || jsonb_build_object('next', ${next}) from app.hit_rate(${bucket}, ${String(key)}, ${windowS}::int, ${max}::int) a)`;
  };
  const [row] = await db.anon((tx) => tx`select ${chain(tx, 0)} as r`);
  let node = row.r; const out = [];
  for (let k = 0; k < specs.length && node; k++) {
    out.push({ allowed: node.allowed, reset_in: node.reset_in });
    if (!node.allowed) { const [bucket, key] = specs[k]; try { await auditAnon(c, 'security.rate_limited', 'bucket', bucket, { key_kind: String(key).length > 40 ? 'hash' : 'id' }); } catch { /* auditoria nunca derruba o bloqueio */ } throw E.rateLimited(node.reset_in); }
    node = node.next;
  }
  return out;
}

const SENSITIVE = /pass(word)?|senha|token|secret|authorization|cookie|apikey|api_key|jwt|bearer|credential/i;
/** Remove chaves sensíveis e corta strings longas dos metadados de auditoria/log. */
export function redact(obj, depth = 0) {
  if (obj == null || depth > 4) return obj == null ? null : '[…]';
  if (Array.isArray(obj)) return obj.slice(0, 50).map((x) => redact(x, depth + 1));
  if (typeof obj === 'object') { const o = {}; for (const [k, v] of Object.entries(obj).slice(0, 50)) o[k] = SENSITIVE.test(k) ? '[redigido]' : redact(v, depth + 1); return o; }
  if (typeof obj === 'string') return obj.length > 200 ? obj.slice(0, 200) + '…' : obj;
  return obj;
}
