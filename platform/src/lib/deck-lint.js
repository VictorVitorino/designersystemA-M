/* Segunda camada de defesa do conteúdo de uma apresentação (docs/API.md §4). A primeira é o próprio editor (safeDeck/cleanHTML);
   aqui NÃO confiamos nela: qualquer cliente pode chamar a API com um JSON forjado.

   O que faz: percorre o JSON INTEIRO (chaves e valores) de forma iterativa, recusa tamanho/profundidade/quantidade abusivos,
   HTML ativo (tags, atributos de evento, URLs perigosas, CSS perigoso), imagens `data:` que deviam ter sido externalizadas e
   referências `asset:` malformadas, e devolve metadados (bytes, slideCount, título, assets referenciados).

   Estratégia contra evasões clássicas de filtro: antes de testar os padrões, cada string é decodificada em camadas
   (entidades HTML, %XX, \uXXXX/\xXX) e testada em TODAS as formas (original e decodificadas), com controles/zero-width removidos.
   Isto é um filtro de RECUSA (não um sanitizador): na dúvida recusa; o editor mostra a mensagem e o usuário corrige.
   Texto comum (a palavra "script", "onclick" em prosa, setas, emoji, aspas, "Data: 12/05") NÃO pode ser recusado — veja os testes.

   Forma crua × formas decodificadas (BE-ED-09): o que a pessoa DIGITA numa caixa de texto o editor guarda escapado ("use a tag &lt;form&gt;").
   Na forma crua isso é texto inerte; as formas decodificadas existem só como defesa em profundidade contra quem decodificasse duas vezes.
   Por isso, nelas, a CITAÇÃO de uma tag passiva sem atributos (<form>, <link>, <iframe>, <template>…) não é recusada; continuam recusadas,
   em qualquer forma: <script>, <style>, <svg> e <math> (executam/estilizam conteúdo ou abrem outro namespace), qualquer tag da lista com
   atributo, atributos de evento, srcdoc, URLs e CSS perigosos — e, só nas formas decodificadas, action/formaction/form (envio de formulário
   para outro lugar). Na forma crua nada mudou: <form> literal continua recusado.

   Localização (details.issues): cada achado diz o slide (1-based) e o id do elemento quando o id é um identificador simples — nunca o texto
   recusado (o editor leva a pessoa ao ponto exato sem que o servidor devolva o conteúdo).

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
const TAG_DENY_G = new RegExp(TAG_DENY.source, 'gi');
// Recusadas em QUALQUER forma, mesmo citadas sem atributos: executam/estilizam o conteúdo que segue ou abrem outro namespace (svg/math).
const ALWAYS_ACTIVE = /^(?:script|style|svg|math)$/;
// Atributos que mandam um formulário para outro lugar: recusados nas formas decodificadas (a citação de <form> sem atributos é aceita lá).
const FORM_TARGET_ATTRS = new Set(['action', 'formaction', 'form']);
const BARE_CLOSE = /^[\s/]*>/;
// Atributos que carregam URL (valor testado contra esquemas perigosos)
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'data', 'codebase', 'cite', 'ping', 'lowsrc', 'dynsrc', 'longdesc', 'usemap', 'profile', 'manifest', 'icon']);
// Chaves de JSON que carregam URL (o valor é tratado como URL mesmo fora de HTML)
const URL_KEYS = /^(?:href|src|srcset|url|uri|link|action|formaction|xlink:href|poster|background|bgimg|bgimage|icon|ping|cite|sheet|webhook|endpoint)$/i;
const CSS_KEYS = /^(?:style|css|csstext|stylesheet)$/i;
// Controles (menos \t \n \r) e caracteres de formato invisíveis (zero-width, bidi, BOM, soft hyphen) — usados para disfarçar "java\0script"
const INVISIBLE = /[^\P{Cc}\t\n\r\f]|\p{Cf}/gu;   // \f (U+000C) fica: o navegador o trata como separador de atributos, então o tokenizador também precisa vê-lo (AF-4)
const WS_CTRL = /[\t\n\r\f]/g;
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

/** Forma DECODIFICADA: alguma tag da lista que não seja só a citação de uma tag passiva sem atributos ("<form>", "</link>", "< iframe >")?
    <script>/<style>/<svg>/<math> contam sempre; com qualquer coisa entre o nome e o ">" (atributo) — ou sem ">" — também. Linear: cada
    ocorrência olha no máximo 64 caracteres adiante. */
function activeTagDecoded(n) {
  TAG_DENY_G.lastIndex = 0;
  let m;
  while ((m = TAG_DENY_G.exec(n)) !== null) {
    const name = /[a-z0-9_.-]+$/i.exec(m[0])[0].toLowerCase();
    if (ALWAYS_ACTIVE.test(name)) return true;
    if (!BARE_CLOSE.test(n.slice(TAG_DENY_G.lastIndex, TAG_DENY_G.lastIndex + 64))) return true;
  }
  return false;
}

/** Testa UMA forma (original ou decodificada). `add(reason)` registra achado. `decoded`: a forma veio de decodificar a original (ver o cabeçalho). */
function checkForm(form, add, urlKey, cssKey, decoded) {
  const n = form.replace(INVISIBLE, '');
  const n2 = n.replace(WS_CTRL, '');
  if (n.includes('<')) {
    if (decoded ? activeTagDecoded(n) : TAG_DENY.test(n)) add('tag_perigosa');
    for (const t of tags(n)) {
      if (TAG_DENY.test('<' + t.name + ' ') && !(decoded && t.attrs.length === 0 && !ALWAYS_ACTIVE.test(t.name.replace(/^[a-z][a-z0-9_.-]*:/, '')))) add('tag_perigosa');
      if (t.closing) continue;
      for (const [an, val] of t.attrs) {
        if (an.startsWith('on')) add('atributo_evento');
        else if (an === 'srcdoc') add('atributo_perigoso');
        else if (decoded && FORM_TARGET_ATTRS.has(an)) add('atributo_perigoso');
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
  const forms = decodeLayers(s);
  for (let i = 0; i < forms.length; i++) checkForm(forms[i], add, urlKey, cssKey, i > 0);
}

/* ───────────── API pública ───────────── */

const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

function pathOf(node) {
  const segs = [];
  for (let n = node; n && n.up; n = n.up) segs.push(n.seg);
  segs.reverse();
  return (segs.map((s, i) => (typeof s === 'number' ? `[${s}]` : (i ? '.' : '') + String(s).slice(0, 40).replace(/[^\w$-]/g, '_'))).join('') || '$').slice(0, 160);
}

/** Id de elemento que pode voltar ao cliente: só identificador simples (o editor gera ids assim: "e4q8qysy"). Qualquer outra coisa vira null —
    se o próprio id for o texto recusado, ele não é ecoado. */
const ELEMENT_ID_SAFE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_ISSUES = 20;

/** Onde fica um nó do JSON: slide (1-based) quando está dentro de slides[i]; id do elemento quando está dentro de slides[i].els[j]. */
function locate(node) {
  const chain = [];
  for (let n = node; n; n = n.up) chain.push(n);
  chain.reverse();                                                            // [raiz, filho da raiz, neto, …]
  const loc = { slide: null, elementId: null };
  if (chain.length > 2 && chain[1].seg === 'slides' && Array.isArray(chain[1].v) && typeof chain[2].seg === 'number') {
    loc.slide = chain[2].seg + 1;
    if (chain.length > 4 && chain[3].seg === 'els' && Array.isArray(chain[3].v) && typeof chain[4].seg === 'number') {
      const el = chain[4].v;
      const id = el && typeof el === 'object' && !Array.isArray(el) && Object.hasOwn(el, 'id') ? el.id : null;
      if (typeof id === 'string' && ELEMENT_ID_SAFE.test(id)) loc.elementId = id;
    }
  }
  return loc;
}

/** Lista para o cliente: [{slide, elementId, reason}] sem repetição (mesmo ponto + mesma razão contam uma vez), no máximo MAX_ISSUES. */
export function issuesOf(found) {
  const out = []; const seen = new Set();
  for (const f of found) {
    const slide = Number.isInteger(f.slide) ? f.slide : null, elementId = typeof f.elementId === 'string' ? f.elementId : null;
    const k = `${slide}|${elementId}|${f.reason}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ slide, elementId, reason: f.reason });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

/** details de um 422 `rejected_content`: reasons (únicas), findings (≤ 10 caminhos sanitizados, compatibilidade) e issues (≤ 20, com slide/elemento).
    Sem localização conhecida (ex.: tamanho do deck inteiro), cada razão vira um issue com slide/elementId nulos. Nunca contém o texto recusado. */
export function rejectionDetails(reasons, { findings = [], issues = null, extra = {} } = {}) {
  let list = issues ? issuesOf(issues) : issuesOf(findings);
  const uniq = [...new Set(reasons)];
  if (!list.length) list = uniq.slice(0, MAX_ISSUES).map((reason) => ({ slide: null, elementId: null, reason }));
  return {
    reasons: uniq,
    ...(findings.length ? { findings: findings.slice(0, 10).map((f) => ({ reason: f.reason, path: f.path })) } : {}),
    ...extra,
    issues: list,
  };
}

/** Percorre um conteúdo JÁ validado por lintDeck (tamanho e profundidade limitados) e localiza os textos — valores e chaves — em que
    `test(texto)` devolve uma razão. Usado para apontar onde estão caracteres inválidos ou arquivos inexistentes. @returns issues (≤ max) */
export function locateIssues(content, test, max = MAX_ISSUES) {
  const found = [];
  const stack = [{ v: content, seg: null, up: null }];
  const hit = (node, s) => { const reason = test(s); if (reason) found.push({ ...locate(node), reason }); };
  while (stack.length && found.length < max * 4) {
    const node = stack.pop(); const v = node.v;
    if (typeof v === 'string') { hit(node, v); continue; }
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], seg: i, up: node }); continue; }
    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) { const child = { v: v[keys[i]], seg: keys[i], up: node }; hit(child, keys[i]); stack.push(child); }
  }
  return issuesOf(found).slice(0, max);
}

/** Varre um JSON inteiro (valores e chaves) de forma iterativa — pilha explícita, profundidade e tamanho já limitados por quem chama — e acumula
    achados em `findings` (até LIMITS.maxFindings) e referências asset: em `refs`. Compartilhado por lintDeck e lintJson. */
function walk(root, findings, refs) {
  /** Registrador de achados de UM ponto (valor ou chave): a mesma razão no mesmo ponto conta uma vez (as formas crua e decodificadas
      costumam acusar a mesma coisa); caminho e localização são calculados só quando há achado. */
  const finder = (node, suffix = '') => {
    let where = null; const seen = [];
    return (reason) => {
      if (findings.length >= LIMITS.maxFindings || seen.includes(reason)) return;
      seen.push(reason);
      if (!where) where = { path: pathOf(node) + suffix, ...locate(node) };
      findings.push({ reason, ...where });
    };
  };
  const stack = [{ v: root, d: 0, key: null, seg: null, up: null }];
  while (stack.length && findings.length < LIMITS.maxFindings) {
    const node = stack.pop();
    const v = node.v;
    const add = finder(node);
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
        if (k === '__proto__') { finder(child)('chave_proibida'); continue; }
        // a chave também é texto: "<script>" como nome de propriedade não passa (e refs asset: em chaves contam como referência)
        scanString(k, finder(child, '(chave)'), refs, null);
        stack.push(child);
      }
    } else add('estrutura_invalida'); // Date, Map, instância de classe…
  }
}

function cleanTitle(v) {
  if (typeof v !== 'string') return 'Sem título';
  let t = v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu, '').replace(/\s+/g, ' ').trim();
  if (t.length > 200) t = Array.from(t).slice(0, 200).join('').trim();
  return t || 'Sem título';
}

/**
 * Valida o conteúdo de um deck. Retorna metadados ou lança HttpError 422 `rejected_content` com details {reasons[], findings[], issues[]}.
 * @param {unknown} content JSON do deck (já com imagens externalizadas)
 * @param {{maxBytes?: number}} [opts]
 * @returns {{bytes:number, assetRefs:Set<string>, slideCount:number, title:string}}
 */
export function lintDeck(content, { maxBytes = LIMITS.maxBytes } = {}) {
  const reject = (reasons, findings = []) => { throw E.rejected('Conteúdo recusado por segurança.', rejectionDetails(reasons, { findings })); };

  if (!content || typeof content !== 'object' || Array.isArray(content) || !isPlain(content) || !Array.isArray(content.slides)) reject(['estrutura_invalida']);

  let json;
  try { json = JSON.stringify(content); } catch { reject(['estrutura_invalida']); } // ciclo, BigInt, aninhamento absurdo
  if (typeof json !== 'string') reject(['estrutura_invalida']);
  const bytes = Buffer.byteLength(json);
  if (bytes > maxBytes) reject(['tamanho_excedido']);

  const findings = [];
  const refs = new Set();
  const slideCount = content.slides.length;
  if (slideCount > LIMITS.maxSlides) findings.push({ reason: 'slides_demais', path: 'slides', slide: null, elementId: null });
  for (let i = 0; i < Math.min(slideCount, LIMITS.maxSlides); i++) {
    const s = content.slides[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) { findings.push({ reason: 'estrutura_invalida', path: `slides[${i}]`, slide: i + 1, elementId: null }); break; }
  }
  // Varredura iterativa (pilha explícita): profundidade e tamanho já limitados, sem risco de estouro de pilha.
  walk(content, findings, refs);
  if (findings.length) reject(findings.map((f) => f.reason), findings);

  return { bytes, assetRefs: refs, slideCount, title: cleanTitle(content.title) };
}

/**
 * Mesma varredura de segurança para um JSON que NÃO é deck (ex.: preferências da pessoa): HTML ativo, URLs/CSS perigosos, chave __proto__,
 * referências asset: malformadas, profundidade > 40, números inválidos. Lança 422 `rejected_content` com details.reasons — nunca o texto.
 * @param {unknown} value @param {{message?:string}} [opts] */
export function lintJson(value, { message = 'Conteúdo recusado por segurança.' } = {}) {
  const findings = [];
  walk(value, findings, new Set());
  if (findings.length) throw E.rejected(message, { reasons: [...new Set(findings.map((f) => f.reason))] });
}
