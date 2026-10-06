/* CSV de interações (docs/API.md §6). Funções puras.
   Formato igual ao do próprio editor (studio/rt-60-forms.js): separador `;` (Excel pt-BR), BOM UTF-8 e quebra de linha CRLF.
   ANTI CSV-INJECTION: o texto vem de qualquer usuário que respondeu o formulário e será aberto no Excel/Sheets pelo dono da apresentação.
   Uma célula que começa com = + - @ (ou TAB/CR) vira fórmula ao abrir; por isso recebe um apóstrofo na frente (recomendação OWASP).
   A proteção vale para TODA célula, inclusive cabeçalhos (o texto das perguntas também é digitado por usuários). */

export const BOM = '﻿';
export const SEP = ';';
const MAX_COLS = 300;           // payload de 64 KB poderia ter milhares de "perguntas": limita as colunas geradas
const FORMULA_START = /^[=+\-@\t\r]/;

/** Converte qualquer valor JSON em texto de célula (listas viram "a; b"; objetos viram JSON). */
export function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(cellText).join('; ');
  try { return JSON.stringify(v); } catch { return ''; }
}

/** Uma célula pronta: neutraliza fórmula, remove NUL e aplica aspas quando houver separador, aspas ou quebra de linha. */
export function csvCell(v) {
  let s = cellText(v).replace(/\u0000/g, '');
  if (FORMULA_START.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** @param {unknown[]} header @param {unknown[][]} rows @returns {string} CSV completo, com BOM e CRLF */
export function toCsv(header, rows) {
  const line = (cells) => cells.map(csvCell).join(SEP);
  return BOM + [line(header), ...rows.map(line)].join('\r\n') + '\r\n';
}

/** Nome de arquivo seguro para o cabeçalho Content-Disposition (só ASCII, sem aspas/barras). */
export function csvFilename(kind, id) {
  const k = String(kind || 'interacoes').replace(/[^a-z_]/g, '').slice(0, 20) || 'interacoes';
  return `${k === 'form_response' ? 'respostas' : k}-${String(id).replace(/[^0-9a-f]/gi, '').slice(0, 8) || 'apresentacao'}.csv`;
}

/**
 * Monta o CSV de uma lista de interações.
 * form_response: cabeçalho DINÂMICO = Data/hora, Respondente, Elemento + uma coluna por pergunta (payload.q[i]) com a resposta (payload.a[i]).
 *   Formulários editados ao longo do tempo têm perguntas diferentes por linha: as colunas são a união, na ordem em que aparecem; perguntas
 *   repetidas na mesma linha ganham sufixo " (2)". Linha sem a pergunta fica vazia.
 * demais tipos: colunas fixas com o payload em JSON.
 * @param {string} kind
 * @param {{createdAt:Date|string, userName:string, elementId:string, kind:string, payload:any}[]} items
 */
export function interactionsCsv(kind, items) {
  const when = (d) => (d instanceof Date ? d.toISOString() : String(d));
  if (kind !== 'form_response') {
    return toCsv(['Data/hora (UTC)', 'Respondente', 'Tipo', 'Elemento', 'Conteúdo (JSON)'],
      items.map((i) => [when(i.createdAt), i.userName, i.kind, i.elementId, JSON.stringify(i.payload ?? {})]));
  }
  const columns = []; const index = new Map();
  const rows = items.map((it) => {
    const p = it.payload && typeof it.payload === 'object' ? it.payload : {};
    const q = Array.isArray(p.q) ? p.q : [], a = Array.isArray(p.a) ? p.a : [];
    const seen = new Map(); const cells = new Map();
    for (let i = 0; i < Math.min(q.length, MAX_COLS); i++) {
      let name = cellText(q[i]).trim() || `Pergunta ${i + 1}`;
      const n = (seen.get(name) || 0) + 1; seen.set(name, n);
      if (n > 1) name = `${name} (${n})`;
      if (!index.has(name)) { if (columns.length >= MAX_COLS) continue; index.set(name, columns.length); columns.push(name); }
      cells.set(name, a[i]);
    }
    return { it, cells };
  });
  const header = ['Data/hora (UTC)', 'Respondente', 'Elemento', ...columns];
  return toCsv(header, rows.map(({ it, cells }) => [when(it.createdAt), it.userName, it.elementId, ...columns.map((c) => (cells.has(c) ? cells.get(c) : ''))]));
}
