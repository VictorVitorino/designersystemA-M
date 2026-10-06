/* Segunda camada de defesa do conteúdo de uma apresentação (docs/API.md §4). A primeira é o próprio editor (safeDeck/cleanHTML);
   aqui NÃO confiamos nela: qualquer cliente pode chamar a API com um JSON forjado.

   O que faz: percorre o JSON INTEIRO (chaves e valores) de forma iterativa, recusa tamanho/profundidade/quantidade abusivos,
   HTML ativo (tags, atributos de evento, URLs perigosas, CSS perigoso), imagens `data:` que deviam ter sido externalizadas e
   referências `asset:` malformadas, e devolve metadados (bytes, slideCount, título, assets referenciados).

   Estratégia contra evasões clássicas de filtro: antes de testar os padrões, cada string é decodificada em camadas
   (entidades HTML, %XX, \uXXXX/\xXX) e testada em TODAS as formas (original e decodificadas), com controles/zero-width removidos.
   Isto é um filtro de RECUSA (não um sanitizador): na dúvida recusa; o editor mostra a mensagem e o usuário corrige.
   Texto comum (a palavra "script", "onclick" em prosa, setas, emoji, aspas, "Data: 12/05") NÃO pode ser recusado — veja os testes.

   Regex: nenhum quantificador aninhado/sobreposto (sem ReDoS); strings de até 2 MB são varridas em tempo linear. */
import { E } from './errors.js';

export const LIMITS = Object.freeze({
  maxBytes: 12 * 1024 * 1024, maxDepth: 40, maxSlides: 500, maxString: 2 * 1024 * 1024,
  maxInlineImage: 64 * 1024, maxFindings: 20, maxDecodeLayers: 4,
});

/* ───────────── tabelas e padrões ───────────── */

// Tags de HTML ativo (docs/API.md §4) + as que executam/carregam coisa em navegadores. Aceita prefixo de namespace (<x:script>) e
// "</script" (fechamento). O lookahead evita falso positivo em <formulário>, <linkedin>, <objective>, <styles>, <metadata>.
const TAG_DENY = /<[\s/]*(?:[a-z][a-z0-9_.-]*:)?(?:script|iframe|object|embed|link|meta|base|form|svg|math|style|frame|frameset|applet|template|noscript|xmp|plaintext|isindex)(?![a-z0-9_-])/i;
// Atributos que carregam URL (valor testado contra esquemas perigosos)
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'data', 'codebase', 'cite', 'ping', 'lowsrc', 'dynsrc', 'longdesc', 'usemap', 'profile', 'manifest', 'icon']);
// Chaves de JSON que carregam URL (o valor é tratado como URL mesmo fora de HTML)
const URL_KEYS = /^(?:href|src|srcset|url|uri|link|action|formaction|xlink:href|poster|background|bgimg|bgimage|icon|ping|cite|sheet|webhook|endpoint)$/i;
const CSS_KEYS = /^(?:style|css|csstext|stylesheet)$/i;
// Controles (menos \t \n \r) e caracteres de formato invisíveis (zero-width, bidi, BOM, soft hyphen) — usados para disfarçar "java\0script"
const INVISIBLE = /[^\P{Cc}\t\n\r]|\p{Cf}/gu;
const WS_CTRL = /[\t\n\r]/g;
const SCHEME_BAD = /^(?:javascript|vbscript|livescript|mocha)\s*:/;
const SCHEME_BAD_FREE = /^(?:javascript|vbscript|livescript):\S/; // valor solto: exige algo colado após ":" (prosa "JavaScript: guia" passa)
const SCHEME_OTHER = /^(?:file|jar|view-source|mhtml|ms-its|wyciwyg|feed|filesystem):/;
const DATA_ACTIVE = /data\s*:\s*(?:text\/(?:html|javascript|xml|x-[a-z0-9.+-]+)|application\/(?:x-)?(?:javascript|ecmascript|xhtml\+xml|xml)|image\/svg)/i;
const DATA_IMG = /data:\s*image\/(?:png|jpe?g|webp|gif)[^,"'<>()\s]{0,64},/gi;
const B64_RUN = /[A-Za-z0-9+/=_%\s-]*/y;
const ATTR_URL_COARSE = /(?:href|src|action|formaction|background|poster|data|xlink:href)\s*=[\s"'`]*(?:javascript|vbscript|livescript)\s*:/i;
// Fuga de atributo: uma aspa e, até 200 caracteres depois (sem outra aspa), um on…= (ex.: `" onmouseover=`, `' autofocus onfocus=`).
// Janela curta e classe sem aspas: tempo linear mesmo em texto hostil (testado em deck-lint.test.js).
const BREAKOUT = /["'`](?:[^"'<>`]{0,200}[\s/])?on[a-z]{2,25}\s*=/i;
const EVENT_IN_MARKUP = /[\s"'/`]on[a-z]{2,25}\s*=/i;        // só avaliado em strings que têm "<"
const CSS_URL_BAD = /url\s*\(\s*(?:['"]\s*)?(?:javascript|vbscript|livescript)/i;
const CSS_IMPORT = /@import\s*(?:url\s*\(|["'])/i;
const ASSET_CAND = /(?<![A-Za-z0-9_])asset:(?!\s)/gi;
const ASSET_OK = /^asset:sha256:([0-9a-f]{64})(?![0-9A-Za-z_-])/;
const ASSET_ONLY = /^asset:sha256:[0-9a-f]{64}$/;

const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', bsol: '\\', num: '#', equals: '=', excl: '!', semi: ';', comma: ',', period: '.', lbrack: '[', rbrack: ']', lsqb: '[', rsqb: ']', lbrace: '{', rbrace: '}', lcub: '{', rcub: '}', percnt: '%', plus: '+', ast: '*', quest: '?', commat: '@', lowbar: '_', grave: '`', nbsp: ' ', hyphen: '-', dash: '-' };
const LEGACY_NO_SEMI = new Set(['lt', 'gt', 'amp', 'quot', 'nbsp']); // navegadores aceitam estes sem ";"

/* ───────────── decodificação em camadas ───────────── */

const cp = (n) => (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '�' : String.fromCodePoint(n));
function decodeEntities(s) {
  return s.replace(/&(?:#(?:x([0-9a-f]+)|([0-9]+))|([a-z][a-z0-9]{1,31}))(;?)/gi, (m, hex, dec, name, semi) => {
    // zeros à esquerda não mudam o valor (&#x00000000006A; = "j"): remove antes de limitar o tamanho (senão vira brecha de evasão)
    if (hex !== undefined) { const h = hex.replace(/^0+/, ''); return cp(h.length > 6 ? 0 : parseInt(h || '0', 16)); }
    if (dec !== undefined) { const d = dec.replace(/^0+/, ''); return cp(d.length > 7 ? 0 : parseInt(d || '0', 10)); }
    const k = name.toLowerCase();
    if (!Object.hasOwn(NAMED, k)) return m;
    return semi || LEGACY_NO_SEMI.has(k) ? NAMED[k] : m;
  });
}
const decodePercent = (s) => s.replace(/%u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/%([0-7][0-9a-f])/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
const decodeJsEscapes = (s) => s.replace(/\\u\{([0-9a-f]{1,8})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (m, a, b, c) => cp(parseInt(a || b || c, 16)));

function decodeLayers(s) {
  const forms = [s];
  let cur = s;
  for (let i = 0; i < LIMITS.maxDecodeLayers; i++) {
    let n = cur;
    if (n.includes('&')) n = decodeEntities(n);
    if (n.includes('%')) n = decodePercent(n);
    if (n.includes('\\')) n = decodeJsEscapes(n);
    if (n === cur) break;
    forms.push(n); cur = n;
  }
  return forms;
}

/* ───────────── análise de URL e CSS ───────────── */

/** Esquemas perigosos como o NAVEGADOR os lê: tab/CR/LF no meio são ignorados e espaços/controles nas pontas também. */
function urlProblem(value) {
  const t = value.replace(INVISIBLE, '').replace(WS_CTRL, '').replace(/^[\s"'`]+/, '').toLowerCase();
  if (SCHEME_BAD.test(t)) return 'url_perigosa';
  if (SCHEME_OTHER.test(t)) return 'url_perigosa';
  if (t.startsWith('data:')) {
    if (/^data:\s*image\/(?:png|jpe?g|webp|gif)[;,]/.test(t)) return null; // tamanho é conferido à parte (imagem_nao_externalizada)
    if (/^data:\s*image\/svg/.test(t)) return 'svg_embutido';
    if (/^data:\s*(?:text\/html|application\/xhtml|text\/xml|application\/xml|text\/javascript|application\/(?:x-)?javascript)/.test(t)) return 'data_html';
    return 'url_perigosa';
  }
  return null;
}

function cssUnescape(s) { return s.replace(/\\([0-9a-f]{1,6})\s?|\\([^\n])/gi, (m, h, c) => (h ? cp(parseInt(h, 16)) : c)); }
/** Valor de style="…": remove escapes CSS (\6a avascript) e comentários (exp/**\/ression) antes de testar. */
function cssProblem(value) {
  const c = cssUnescape(value).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').replace(INVISIBLE, '').toLowerCase();
  if (/expression\s*\(/.test(c) || /@import/.test(c) || /-moz-binding|behavior\s*:|-ms-behavior/.test(c)) return 'estilo_perigoso';
  if (/(?:javascript|vbscript|livescript)\s*:/.test(c.replace(WS_CTRL, ''))) return 'url_perigosa';
  for (const m of c.matchAll(/url\s*\(\s*(['"]?)([^'")]*)/g)) {
    // Só são aceitos url(asset:sha256:…) e imagens data: pequenas (o editor nunca grava url() em style; é só tolerância para o externalizador).
    const target = m[2].replace(WS_CTRL, '').trim();
    if (!ASSET_ONLY.test(target) && !/^data:image\/(?:png|jpe?g|webp|gif)[;,]/.test(target)) return 'estilo_perigoso';
  }
  return null;
}

/* ───────────── tokenizador mínimo de tags ───────────── */

const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
/** Gera {name, closing, attrs:[[nome,valor]]} seguindo a mesma regra dos navegadores para aspas/separadores. Linear no tamanho. */
function* tags(s) {
  const L = s.length;
  let i = 0;
  while ((i = s.indexOf('<', i)) !== -1) {
    let j = i + 1, closing = false;
    if (s.charCodeAt(j) === 47) { closing = true; j++; }
    if (!isAlpha(s.charCodeAt(j))) { i = j > i + 1 ? j : i + 1; continue; } // "a < b", "<3", "<-", "<!--", "<?"
    let k = j;
    while (k < L) { const c = s.charCodeAt(k); if (isWs(c) || c === 47 || c === 62) break; k++; }
    const name = s.slice(j, k).toLowerCase();
    const attrs = [];
    while (k < L) {
      while (k < L && (isWs(s.charCodeAt(k)) || s.charCodeAt(k) === 47)) k++;
      if (k >= L || s.charCodeAt(k) === 62) break;
      const a = k;
      while (k < L) { const c = s.charCodeAt(k); if (isWs(c) || c === 47 || c === 62 || c === 61) break; k++; }
      if (k === a) { k++; continue; } // "=" solto
      const an = s.slice(a, k).toLowerCase();
      while (k < L && isWs(s.charCodeAt(k))) k++;
      let val = '';
      if (s.charCodeAt(k) === 61) {
        k++;
        while (k < L && isWs(s.charCodeAt(k))) k++;
        const q = s.charCodeAt(k);
        if (q === 34 || q === 39) { const e = s.indexOf(q === 34 ? '"' : "'", k + 1); val = s.slice(k + 1, e === -1 ? L : e); k = e === -1 ? L : e + 1; }
        else { const b = k; while (k < L) { const c = s.charCodeAt(k); if (isWs(c) || c === 62) break; k++; } val = s.slice(b, k); }
      }
      attrs.push([an, val]);
      if (attrs.length >= 200) break; // tag absurda: o que já coletamos basta
    }
    yield { name, closing, attrs };
    i = Math.max(k, i + 1);
  }
}

/* ───────────── varredura de uma string ───────────── */

/** Testa UMA forma (original ou decodificada). `add(reason)` registra achado. */
function checkForm(form, add, urlKey, cssKey) {
  const n = form.replace(INVISIBLE, '');
  const n2 = n.replace(WS_CTRL, '');
  if (n.includes('<')) {
    if (TAG_DENY.test(n)) add('tag_perigosa');
    for (const t of tags(n)) {
      if (TAG_DENY.test('<' + t.name + ' ')) add('tag_perigosa');
      if (t.closing) continue;
      for (const [an, val] of t.attrs) {
        if (an.startsWith('on')) add('atributo_evento');
        else if (an === 'srcdoc') add('atributo_perigoso');
        else if (an === 'style') { for (const v of decodeLayers(val)) { const r = cssProblem(v); if (r) add(r); } }
        else if (URL_ATTRS.has(an)) { for (const v of decodeLayers(val)) { const r = urlProblem(v); if (r) add(r); } }
      }
    }
    if (EVENT_IN_MARKUP.test(n)) add('atributo_evento');
    if (/srcdoc\s*=/i.test(n)) add('atributo_perigoso');
    if (ATTR_URL_COARSE.test(n2)) add('url_perigosa');
  }
  if (BREAKOUT.test(n)) add('atributo_evento');
  if (DATA_ACTIVE.test(n2)) add(/image\/svg/i.test(n2.match(DATA_ACTIVE)[0]) ? 'svg_embutido' : 'data_html');
  if (SCHEME_BAD_FREE.test(n2.slice(0, 100).trim().toLowerCase())) add('url_perigosa');
  if (CSS_URL_BAD.test(n2)) add('url_perigosa');
  if (CSS_IMPORT.test(n)) add('estilo_perigoso');
  if (/-moz-binding/i.test(n)) add('estilo_perigoso');
  if (urlKey) { const r = urlProblem(form); if (r) add(r); }
  if (cssKey) { const r = cssProblem(form); if (r) add(r); }
}

/** Referências asset: (somente na forma crua — é o que o servidor registra e o cliente hidrata). */
function scanAssetRefs(s, add, refs) {
  ASSET_CAND.lastIndex = 0;
  let m;
  while ((m = ASSET_CAND.exec(s)) !== null) {
    const ok = ASSET_OK.exec(s.slice(m.index, m.index + 80));
    if (ok) refs.add(ok[1]); else add('referencia_asset_invalida');
    if (refs.size > 20000) { add('referencia_asset_invalida'); return; }
  }
}

/** data:image grande demais para ficar no banco: o cliente deve enviá-la como arquivo e trocar por asset:sha256:… */
function scanInlineImages(s, add) {
  DATA_IMG.lastIndex = 0;
  let m;
  while ((m = DATA_IMG.exec(s)) !== null) {
    B64_RUN.lastIndex = m.index + m[0].length;
    const r = B64_RUN.exec(s);
    if (r && r[0].length > LIMITS.maxInlineImage) { add('imagem_nao_externalizada'); return; }
  }
}

function scanString(s, add, refs, ctxKey) {
  if (s.length > LIMITS.maxString || (s.length * 3 > LIMITS.maxString && Buffer.byteLength(s) > LIMITS.maxString)) { add('string_grande_demais'); return; }
  if (s.length < 3) return; // nenhum padrão perigoso cabe em 2 caracteres
  if (s.length >= 6 && /asset:/i.test(s)) scanAssetRefs(s, add, refs);
  if (s.length >= 6 && /data:/i.test(s)) scanInlineImages(s, add);
  const urlKey = typeof ctxKey === 'string' && URL_KEYS.test(ctxKey);
  const cssKey = typeof ctxKey === 'string' && CSS_KEYS.test(ctxKey);
  // caminho rápido: texto sem nenhum gatilho de markup/decodificação/URL/CSS/atributo (< & % \\ : @ = `) não precisa de mais nada
  if (!urlKey && !cssKey && !/[<&%\\:`@=]/.test(s)) return;
  for (const f of decodeLayers(s)) checkForm(f, add, urlKey, cssKey);
}

/* ───────────── API pública ───────────── */

const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

function pathOf(node) {
  const segs = [];
  for (let n = node; n && n.up; n = n.up) segs.push(n.seg);
  segs.reverse();
  return (segs.map((s, i) => (typeof s === 'number' ? `[${s}]` : (i ? '.' : '') + String(s).slice(0, 40).replace(/[^\w$-]/g, '_'))).join('') || '$').slice(0, 160);
}

function cleanTitle(v) {
  if (typeof v !== 'string') return 'Sem título';
  let t = v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu, '').replace(/\s+/g, ' ').trim();
  if (t.length > 200) t = Array.from(t).slice(0, 200).join('').trim();
  return t || 'Sem título';
}

/**
 * Valida o conteúdo de um deck. Retorna metadados ou lança HttpError 422 `rejected_content` com details.reasons[].
 * @param {unknown} content JSON do deck (já com imagens externalizadas)
 * @param {{maxBytes?: number}} [opts]
 * @returns {{bytes:number, assetRefs:Set<string>, slideCount:number, title:string}}
 */
export function lintDeck(content, { maxBytes = LIMITS.maxBytes } = {}) {
  const reject = (reasons, findings) => { throw E.rejected('Conteúdo recusado por segurança.', { reasons: [...new Set(reasons)], ...(findings && findings.length ? { findings: findings.slice(0, 10) } : {}) }); };

  if (!content || typeof content !== 'object' || Array.isArray(content) || !isPlain(content) || !Array.isArray(content.slides)) reject(['estrutura_invalida']);

  let json;
  try { json = JSON.stringify(content); } catch { reject(['estrutura_invalida']); } // ciclo, BigInt, aninhamento absurdo
  if (typeof json !== 'string') reject(['estrutura_invalida']);
  const bytes = Buffer.byteLength(json);
  if (bytes > maxBytes) reject(['tamanho_excedido']);

  const findings = [];
  const refs = new Set();
  const slideCount = content.slides.length;
  if (slideCount > LIMITS.maxSlides) findings.push({ reason: 'slides_demais', path: 'slides' });
  for (let i = 0; i < Math.min(slideCount, LIMITS.maxSlides); i++) {
    const s = content.slides[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) { findings.push({ reason: 'estrutura_invalida', path: `slides[${i}]` }); break; }
  }

  // Varredura iterativa (pilha explícita): profundidade e tamanho já limitados, sem risco de estouro de pilha.
  const stack = [{ v: content, d: 0, key: null, seg: null, up: null }];
  while (stack.length && findings.length < LIMITS.maxFindings) {
    const node = stack.pop();
    const v = node.v;
    const add = (reason) => { if (findings.length < LIMITS.maxFindings) findings.push({ reason, path: pathOf(node) }); };
    if (typeof v === 'string') { scanString(v, add, refs, node.key); continue; }
    if (v === null || typeof v === 'boolean' || v === undefined) continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) add('numero_invalido'); continue; }
    if (typeof v !== 'object') { add('estrutura_invalida'); continue; } // bigint, function, symbol
    if (node.d > LIMITS.maxDepth) { add('profundidade_excedida'); continue; }
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], d: node.d + 1, key: node.key, seg: i, up: node });
    } else if (isPlain(v)) {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        const child = { v: v[k], d: node.d + 1, key: k, seg: k, up: node };
        if (k === '__proto__') { findings.push({ reason: 'chave_proibida', path: pathOf(child) }); continue; }
        // a chave também é texto: "<script>" como nome de propriedade não passa (e refs asset: em chaves contam como referência)
        scanString(k, (reason) => { if (findings.length < LIMITS.maxFindings) findings.push({ reason, path: pathOf(child) + '(chave)' }); }, refs, null);
        stack.push(child);
      }
    } else add('estrutura_invalida'); // Date, Map, instância de classe…
  }
  if (findings.length) reject(findings.map((f) => f.reason), findings);

  return { bytes, assetRefs: refs, slideCount, title: cleanTitle(content.title) };
}
