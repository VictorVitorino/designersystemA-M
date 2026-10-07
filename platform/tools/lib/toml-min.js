/* tools/lib/toml-min.js — leitor de um SUBCONJUNTO de TOML, suficiente para infra/supabase/config.toml (sem dependência nova).
   Suporta: comentários (#), tabelas [a.b.c], chave = "texto" | 'literal' | número | true/false | [lista em uma linha].
   Qualquer coisa fora disso vira erro com o número da linha (melhor falhar do que aplicar uma configuração mal lida). */

function parseString(s, i, linha) {
  const q = s[i]; let out = ''; i++;
  if (q === "'") { const j = s.indexOf("'", i); if (j < 0) throw new Error(`config.toml linha ${linha}: texto sem fechar`); return [s.slice(i, j), j + 1]; }
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return [out, i + 1];
    if (c === '\\') {
      const n = s[++i]; const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' };
      if (n in map) out += map[n]; else if (n === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; } else throw new Error(`config.toml linha ${linha}: escape inválido \\${n}`);
    } else out += c;
  }
  throw new Error(`config.toml linha ${linha}: texto sem fechar`);
}
function parseValue(s, i, linha) {
  while (s[i] === ' ' || s[i] === '\t') i++;
  const c = s[i];
  if (c === '"' || c === "'") return parseString(s, i, linha);
  if (c === '[') {
    const arr = []; i++;
    for (;;) {
      while (s[i] === ' ' || s[i] === '\t' || s[i] === ',') i++;
      if (s[i] === ']') return [arr, i + 1];
      if (i >= s.length) throw new Error(`config.toml linha ${linha}: lista sem fechar (listas precisam caber em uma linha)`);
      const [v, j] = parseValue(s, i, linha); arr.push(v); i = j;
    }
  }
  const m = /^(true|false|[+-]?\d[\d_]*(?:\.\d+)?)/.exec(s.slice(i));
  if (!m) throw new Error(`config.toml linha ${linha}: valor não suportado: ${s.slice(i, i + 30)}`);
  const v = m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1].replace(/_/g, ''));
  return [v, i + m[1].length];
}

/** Lê o texto TOML e devolve um objeto aninhado. */
export function parseToml(text) {
  const root = {}; let cur = root; const linhas = String(text).split(/\r?\n/);
  for (let n = 0; n < linhas.length; n++) {
    const raw = linhas[n]; const t = raw.trim(); if (!t || t.startsWith('#')) continue;
    const tab = /^\[([A-Za-z0-9_.-]+)\]\s*(#.*)?$/.exec(t);
    if (tab) { cur = root; for (const k of tab[1].split('.')) { cur[k] ??= {}; if (typeof cur[k] !== 'object' || Array.isArray(cur[k])) throw new Error(`config.toml linha ${n + 1}: tabela repetida/ conflitante ${tab[1]}`); cur = cur[k]; } continue; }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*/.exec(t);
    if (!kv) throw new Error(`config.toml linha ${n + 1}: linha não entendida: ${t.slice(0, 40)}`);
    const [v, j] = parseValue(t, kv[0].length, n + 1);
    const resto = t.slice(j).trim(); if (resto && !resto.startsWith('#')) throw new Error(`config.toml linha ${n + 1}: sobra depois do valor: ${resto.slice(0, 30)}`);
    if (Object.prototype.hasOwnProperty.call(cur, kv[1])) throw new Error(`config.toml linha ${n + 1}: chave repetida ${kv[1]}`);
    cur[kv[1]] = v;
  }
  return root;
}

/** "1m0s", "24h", "720h", "30m" → segundos. */
export function duracaoSegundos(s) {
  if (typeof s === 'number') return s;
  const re = /(\d+(?:\.\d+)?)(h|m|s)/g; let total = 0, achou = false, m;
  while ((m = re.exec(String(s)))) { achou = true; total += Number(m[1]) * { h: 3600, m: 60, s: 1 }[m[2]]; }
  if (!achou) throw new Error(`duração inválida no config.toml: ${s}`);
  return Math.round(total);
}
