/* Preferências da própria pessoa (docs/API.md §3): GET/PUT /api/me/prefs. Montado em /api/me (src/app.js).
   Um objeto JSON por usuário em app.user_prefs — kits de marca salvos (brandKits), preferências do editor (editor)… — para valerem em qualquer
   computador (BE-ED-12). Só a própria pessoa lê e grava: a rota nunca recebe id de ninguém, e o RLS (prefs_*: user_id = app.current_user_id()
   com conta ATIVA) é quem garante. Suspenso/convidado não chegam aqui (sessão → 403).
   PUT substitui o objeto inteiro. Regras do corpo {prefs:{…}}: objeto JSON ≤ 64 KB serializado, profundidade ≤ 10, sem chaves
   __proto__/constructor/prototype (em qualquer nível), brandKits (se vier) é lista e editor (se vier) é objeto; as strings passam pela mesma
   varredura de HTML ativo do conteúdo dos decks (defesa em profundidade: um token roubado não planta script nas preferências da vítima). */
import { Hono } from 'hono';
import { z } from 'zod';
import { E } from '../lib/errors.js';
import { requireUser, txAsUser } from '../lib/request.js';
import { rate, RATES, readJsonBody, jsonbSafe } from '../lib/presentations-service.js';
import { lintJson } from '../lib/deck-lint.js';

export const PREFS_MAX_BYTES = 64 * 1024;
export const PREFS_MAX_DEPTH = 10;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN = Symbol('chave proibida');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const PutBody = z.object({ prefs: z.custom(isObject, 'As preferências devem ser um objeto JSON.') }).strict();

/** Profundidade (o próprio objeto prefs conta 1; cada objeto/lista aninhado, +1) e chaves proibidas, numa só passada iterativa que para assim
    que acha um problema. @returns {{depth:number, badKey:boolean}} */
function inspect(prefs) {
  let depth = 0; const stack = [[prefs, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (d > depth) depth = d;
    if (depth > PREFS_MAX_DEPTH) return { depth, badKey: false };
    const children = Array.isArray(v) ? v : Object.keys(v).map((k) => (FORBIDDEN_KEYS.has(k) ? FORBIDDEN : v[k]));
    for (const x of children) { if (x === FORBIDDEN) return { depth, badKey: true }; if (x !== null && typeof x === 'object') stack.push([x, d + 1]); }
  }
  return { depth, badKey: false };
}

export function prefsRoutes() {
  const r = new Hono();

  r.get('/prefs', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'read', ...RATES.read);
    const [row] = await txAsUser(c, (tx) => tx`select prefs from app.user_prefs where user_id = ${user.id}::uuid`);   // RLS prefs_select: só a própria
    return c.json({ prefs: row ? row.prefs : {} });
  });

  r.put('/prefs', async (c) => {
    const user = requireUser(c);
    await rate(c, user, 'prefs', ...RATES.prefs);
    const { prefs } = await readJsonBody(c, PutBody, PREFS_MAX_BYTES + 8 * 1024);
    const shape = inspect(prefs);
    if (shape.badKey) throw E.badRequest('As preferências têm uma chave não permitida.', { fields: [{ path: 'prefs', message: 'Chaves __proto__, constructor e prototype não são aceitas.' }] });
    if (shape.depth > PREFS_MAX_DEPTH) throw E.badRequest(`As preferências passam de ${PREFS_MAX_DEPTH} níveis de aninhamento.`, { fields: [{ path: 'prefs', message: 'Aninhamento excessivo.' }] });
    const fields = [];
    if (prefs.brandKits !== undefined && !Array.isArray(prefs.brandKits)) fields.push({ path: 'prefs.brandKits', message: 'Deve ser uma lista.' });
    if (prefs.editor !== undefined && !isObject(prefs.editor)) fields.push({ path: 'prefs.editor', message: 'Deve ser um objeto.' });
    if (fields.length) throw E.badRequest('Preferências inválidas.', { fields });
    const text = JSON.stringify(prefs);
    if (Buffer.byteLength(text) > PREFS_MAX_BYTES) throw E.tooLarge('As preferências passam de 64 KB. Remova kits de marca antigos e tente de novo.');
    if (!jsonbSafe(text)) throw E.badRequest('As preferências têm caracteres que não podem ser guardados.');
    lintJson(prefs, { message: 'As preferências têm conteúdo recusado por segurança.' });
    const [row] = await txAsUser(c, (tx) => tx`insert into app.user_prefs(user_id, prefs, updated_at) values (${user.id}::uuid, ${tx.json(prefs)}, now())
        on conflict (user_id) do update set prefs = excluded.prefs, updated_at = now() returning prefs`);
    return c.json({ prefs: row.prefs });
  });

  return r;
}
