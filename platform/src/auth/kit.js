/* "Kit" de autenticação por instância da aplicação (deps): verificador de JWT, cache de identidade, tempos de equalização e
   resolução de identidade. Memoizado por `deps` (WeakMap) para o middleware de sessão, as rotas e os testes compartilharem o mesmo objeto. */
import { createJwtVerifier } from './jwt.js';
import { emailHash } from './hash.js';
import { E, HttpError } from '../lib/errors.js';

/** Cache de identidade em memória. TTL MÁXIMO de 15 s: suspender/rebaixar um usuário precisa valer logo (a decisão final é sempre do banco). */
export class IdentityCache {
  constructor(ttlMs = 15_000, max = 5000) { this.ttl = Math.max(0, Math.min(ttlMs, 15_000)); this.max = max; this.map = new Map(); }
  get(sub) { const e = this.map.get(sub); if (!e) return null; if (e.until < Date.now()) { this.map.delete(sub); return null; } return e.user; }
  set(sub, user) {
    if (this.ttl <= 0) return;
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);   // descarte do mais antigo (Map preserva ordem de inserção)
    this.map.set(sub, { user, until: Date.now() + this.ttl });
  }
  invalidateUser(userId) { for (const [k, e] of this.map) if (e.user.id === userId) this.map.delete(k); }
  clear() { this.map.clear(); }
}

const kits = new WeakMap();
/** @param {{config:object, db:object, jwtVerifier?:object, identityCache?:IdentityCache, authTiming?:object, identityTtlMs?:number}} deps */
export function getAuthKit(deps) {
  let k = kits.get(deps);
  if (k) return k;
  const { config, db } = deps;
  const timing = { failMinMs: config.appEnv === 'test' ? 0 : 700, forgotMinMs: config.appEnv === 'test' ? 0 : 900, ...(deps.authTiming || {}) };
  k = {
    config, timing,
    verifier: deps.jwtVerifier || createJwtVerifier(config),
    cache: deps.identityCache || new IdentityCache(deps.identityTtlMs ?? 15_000),
    hashEmail: (email) => emailHash(config, email),
    /** Mapeia o sujeito do provedor → usuário do banco (só convidados). Devolve null se não há convite. */
    async resolve(claims, { allowLink = false, touch = false } = {}) {
      let r;
      try {
        [r] = await db.anon((tx) => tx`select * from app.resolve_identity('supabase', ${claims.sub}, ${claims.email}, ${claims.emailVerified}, ${allowLink}, ${touch})`);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw E.unavailable();
      }
      if (!r) return null;
      const user = { id: r.user_id, email: claims.email, displayName: r.display_name, role: r.role, status: r.status };
      return user;
    },
  };
  kits.set(deps, k);
  return k;
}
