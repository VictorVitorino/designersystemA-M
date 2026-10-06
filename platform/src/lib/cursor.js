/* Cursor de paginação OPACO e ASSINADO (docs/API.md §2).
   Por que assinar: o cursor entra na consulta SQL como posição de retomada (updated_at, id). Mesmo sendo parametrizado, um cursor forjado
   permitiria "pular" para posições arbitrárias, sondar valores e produzir erros de banco; com HMAC só o que o servidor emitiu é aceito.
   O contexto (usuário + filtros) entra no HMAC: o cursor de uma listagem não serve em outra (outro filtro, outro usuário) — entrada inválida → 400. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { E } from './errors.js';

// Sem CSRF_SECRET (local/teste) usa-se um segredo por processo: cursores deixam de valer ao reiniciar, o que é seguro (só reinicia a lista).
const PROCESS_KEY = randomBytes(32);
const MAX_TOKEN = 512;

/** Chave de assinatura derivada do segredo do servidor (separação de domínio: nunca é o próprio CSRF_SECRET). */
export function cursorKey(config) {
  return config && config.csrfSecret ? createHmac('sha256', config.csrfSecret).update('canteiro:cursor:v1').digest() : PROCESS_KEY;
}

const mac = (key, ctx, body) => createHmac('sha256', key).update(String(ctx)).update('\0').update(body).digest();

/** @param {unknown[]} values  posição de retomada (JSON simples)  @param {{key:Buffer, ctx?:string}} o  @returns {string} */
export function encodeCursor(values, { key, ctx = '' }) {
  const body = Buffer.from(JSON.stringify(values)).toString('base64url');
  return `${body}.${mac(key, ctx, body).toString('base64url')}`;
}

/**
 * Valida e decodifica. Devolve null se não houver cursor; lança 400 `invalid_request` para QUALQUER defeito (assinatura, contexto, formato).
 * @param {string|undefined|null} token
 * @param {{key:Buffer, ctx?:string, shape:(v:unknown[])=>boolean}} o  `shape` confere o formato do conteúdo já autenticado
 */
export function decodeCursor(token, { key, ctx = '', shape }) {
  if (token == null || token === '') return null;
  const bad = () => E.badRequest('Cursor inválido.');
  if (typeof token !== 'string' || token.length > MAX_TOKEN) throw bad();
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) throw bad();
  const [body, sig] = parts;
  const given = Buffer.from(sig, 'base64url'), want = mac(key, ctx, body);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw bad();   // tempo constante
  let v;
  try { v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw bad(); }
  if (!Array.isArray(v) || !shape(v)) throw bad();
  return v;
}
