/* JSON canônico e hashes de conteúdo (docs/API.md §4).
   Por que isto existe: o servidor detecta "nada mudou" e dedup/versões comparando o SHA-256 do conteúdo. Dois JSONs
   semanticamente iguais precisam gerar exatamente os mesmos bytes — daí chaves ordenadas, sem espaços, UTF-8.
   A ordenação das chaves é por unidade de código UTF-16 (o `sort()` padrão do JS), igual ao RFC 8785 (JCS); os números
   usam a serialização padrão do JS (também a do JCS). Valores que o JSON não representa (NaN, Infinity, ciclos, BigInt…)
   são RECUSADOS em vez de virar `null` em silêncio: um hash que "esconde" dado perdido seria pior do que um erro. */
import { createHash } from 'node:crypto';

/** Profundidade máxima aceita aqui. O deck-lint limita a 40; este teto só evita estouro de pilha com entrada arbitrária. */
const MAX_DEPTH = 512;

function fail(msg) { throw new TypeError('canonicalize: ' + msg); }

/**
 * JSON com chaves ordenadas recursivamente, sem espaços; a string resultante é o texto que será codificado em UTF-8.
 * `undefined` em propriedade de objeto é omitido (como no JSON); em array vira `null` (como no JSON).
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === undefined) fail('valor indefinido não é JSON');
  const parts = [];
  const ancestors = new Set(); // detecção de ciclo por caminho: referência compartilhada sem ciclo (DAG) é permitida
  walk(value, 0, parts, ancestors);
  return parts.join('');
}

function walk(v, depth, out, ancestors) {
  if (v === null) { out.push('null'); return; }
  switch (typeof v) {
    case 'string': out.push(JSON.stringify(v)); return; // surrogates soltos saem como \udXXX (JSON bem-formado, determinístico)
    case 'boolean': out.push(v ? 'true' : 'false'); return;
    case 'number':
      if (!Number.isFinite(v)) fail('NaN e Infinity não são JSON');
      out.push(JSON.stringify(v)); // -0 vira "0", expoentes como no JS (mesmo do RFC 8785)
      return;
    case 'bigint': return fail('BigInt não é JSON');
    case 'function': case 'symbol': return fail('função/símbolo não é JSON');
    case 'undefined': return fail('valor indefinido não é JSON');
    default: break; // object
  }
  // objeto ou array
  if (depth > MAX_DEPTH) fail('profundidade excessiva');
  if (ancestors.has(v)) fail('referência circular');
  if (typeof v.toJSON === 'function') { // Date etc.: mesmo contrato do JSON.stringify
    const j = v.toJSON();
    if (j === v) fail('toJSON devolveu o próprio objeto');
    walk(j, depth, out, ancestors); return;
  }
  ancestors.add(v);
  if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i) out.push(',');
      const x = v[i];
      if (x === undefined) out.push('null'); // como o JSON faz em array (buracos também)
      else if (typeof x === 'function' || typeof x === 'symbol') fail('função/símbolo não é JSON');
      else walk(x, depth + 1, out, ancestors);
    }
    out.push(']');
  } else {
    if (v instanceof Map || v instanceof Set || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) fail('Map/Set/binário não é JSON');
    out.push('{');
    let first = true;
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (x === undefined) continue; // omitido, como no JSON
      if (typeof x === 'function' || typeof x === 'symbol') fail('função/símbolo não é JSON');
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(k), ':');
      walk(x, depth + 1, out, ancestors);
    }
    out.push('}');
  }
  ancestors.delete(v);
}

/**
 * SHA-256 (hex minúsculo, 64 chars) de bytes ou de texto (UTF-8).
 * @param {Buffer|Uint8Array|ArrayBuffer|string} bytesOrString
 * @returns {string}
 */
export function sha256Hex(bytesOrString) {
  const h = createHash('sha256');
  if (typeof bytesOrString === 'string') h.update(bytesOrString, 'utf8');
  else if (bytesOrString instanceof ArrayBuffer) h.update(new Uint8Array(bytesOrString));
  else if (ArrayBuffer.isView(bytesOrString)) h.update(new Uint8Array(bytesOrString.buffer, bytesOrString.byteOffset, bytesOrString.byteLength));
  else throw new TypeError('sha256Hex: esperava Buffer/Uint8Array/string');
  return h.digest('hex');
}

/** SHA-256 do JSON canônico (docs/API.md §4 "Hash de conteúdo"). */
export function contentHash(value) { return sha256Hex(canonicalize(value)); }
