/* ===== ed-44-batch.js — “Gerar slides de uma planilha (CSV)” (S33; só no editor) =====
   O slide atual é o modelo: nos textos (e em qualquer campo de componente) escreva {{Coluna}}; cada linha da planilha vira um
   slide com os valores no lugar. Fonte dos dados: colar as células copiadas do Excel/Sheets (TSV), colar CSV (; ou ,) ou abrir um
   arquivo .csv/.tsv. Cabeçalho = primeira linha; coluna é casada sem acento e sem caixa ({{area}} = “Área”). Extras: {{#}} =
   número do slide no lote, {{##}} = total; N linhas por slide ({{Nome#2}} = 2ª linha do grupo). Textos (html) entram escapados
   (quebra de linha = <br>); os outros campos entram como texto. Os slides entram logo depois do modelo (um Ctrl+Z tira todos) e
   o modelo pode ficar oculto (não aparece na apresentação).
   API: window.AMBatch = { open(opener), close(), isOpen(), parse(text), build(template, table, opts), sample() } */
(function () {
  'use strict';
  function S() { return window.AMStudio; }
  function $(q, r) { return (r || document).querySelector(q); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var MAXR = 200, MAXC = 40, TOK = /\{\{\s*([^{}#]+?)\s*(?:#(\d{1,2}))?\s*\}\}|\{\{\s*(##?)\s*\}\}/g;
  var dlg = null, st = null;
  function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }
  var ICSV = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>';
  function toast(m) { var A = S(); if (A && A.toast) A.toast(m); }
  function normKey(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  /* ---------- CSV / TSV ---------- */
  function delimOf(text) {
    var first = String(text).split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '';
    var t = (first.match(/\t/g) || []).length, sc = (first.match(/;/g) || []).length, cm = (first.match(/,/g) || []).length;
    if (t) return '\t'; if (sc >= cm && sc) return ';'; if (cm) return ','; return '\t';
  }
  function parseTable(text) {
    text = String(text == null ? '' : text).replace(/^﻿/, ''); var d = delimOf(text), rows = [], row = [], cell = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') { q = true; continue; }
      if (c === d) { row.push(cell); cell = ''; continue; }
      if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.map(function (r) { return r.map(function (x) { return String(x).trim(); }); }).filter(function (r) { return r.some(function (x) { return x !== ''; }); });
    if (!rows.length) return { delim: d, head: [], rows: [], over: 0 };
    var head = rows[0].slice(0, MAXC).map(function (h, k) { return h || 'Coluna ' + (k + 1); }), body = rows.slice(1).map(function (r) { return r.slice(0, head.length); }), over = Math.max(0, body.length - MAXR);
    return { delim: d, head: head, rows: body.slice(0, MAXR), over: over };
  }
  /* ---------- modelo ---------- */
  function tokensOf(slide) { var out = [], seen = {}, s = JSON.stringify(slide || {}), m; TOK.lastIndex = 0; while ((m = TOK.exec(s))) { var k = m[3] ? m[3] : normKey(m[1]) + (m[2] ? '#' + (+m[2]) : ''); if (!seen[k]) { seen[k] = 1; out.push({ key: m[3] ? m[3] : normKey(m[1]), raw: m[0], n: m[2] ? +m[2] : 1, special: !!m[3] }); } } return out; }
  function build(template, table, opts) {
    opts = opts || {}; var A = S(), per = Math.max(1, Math.min(6, +opts.per || 1)), idx = {}, out = [];
    table.head.forEach(function (h, k) { var nk = normKey(h); if (!(nk in idx)) idx[nk] = k; });
    var chunks = []; for (var i = 0; i < table.rows.length; i += per) chunks.push(table.rows.slice(i, i + per));
    var total = chunks.length;
    function val(key, n, chunk) { var k = idx[normKey(key)]; if (k == null) return null; var r = chunk[n - 1]; return r ? (r[k] == null ? '' : String(r[k])) : ''; }
    function rep(str, chunk, no, isHtml) {
      return str.replace(TOK, function (m, key, n, sp) {
        var v; if (sp) v = sp === '#' ? String(no) : String(total); else { v = val(key, n ? +n : 1, chunk); if (v == null) return m; } /* coluna que não existe: fica como está */
        return isHtml ? esc(v).replace(/\r?\n/g, '<br>') : v;
      });
    }
    function walk(v, chunk, no, k) {
      if (typeof v === 'string') return v.indexOf('{{') >= 0 ? rep(v, chunk, no, k === 'html') : v;
      if (Array.isArray(v)) return v.map(function (x) { return walk(x, chunk, no, k); });
      if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (q) { o[q] = walk(v[q], chunk, no, q); }); return o; }
      return v;
    }
    chunks.forEach(function (chunk, c) {
      var s = A.clone(template); delete s.base; delete s.hidden; delete s.id;
      s = walk(s, chunk, c + 1); out.push(s);
    });
    return out;
  }
  function sample() { return 'Nome;Cargo;Área;Mensagem\nAna Souza;Diretora de Operações;Operações;"Reduzimos o lead time em 30 %"\nBruno Lima;Gerente de TI;Tecnologia;"Portal único no ar; 2 mil usuários"\nCarla Dias;Líder de Pessoas;Pessoas;"Capacitação de 120 líderes"\n'; }
  /* ---------- caixa ---------- */
  function build_() {
    dlg = document.createElement('div'); dlg.id = 'btDlg'; dlg.className = 'xp bt'; dlg.hidden = true;
    dlg.innerHTML = '<div class="xp-bk" data-x="bk"></div>' +
      '<form class="xp-box bt-box" role="dialog" aria-modal="true" aria-labelledby="btT" aria-describedby="btSum" novalidate>' +
      '<header class="xp-h"><div class="xp-ic">' + svg(ICSV) + '</div><div class="xp-hd"><div class="xp-ey">Planilha → slides</div><h3 id="btT">Gerar slides de uma planilha</h3></div>' +
      '<button type="button" class="xp-x" data-x="close" title="Fechar (Esc)" aria-label="Fechar">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></header>' +
      '<div class="xp-b">' +
      '<p class="xp-sum" id="btSum">O <b>slide atual é o modelo</b>: escreva <code>{{Coluna}}</code> nos textos (ou nos campos de um componente) e cada <b>linha</b> da planilha vira um slide com os valores no lugar. Os slides entram logo depois do modelo; um Ctrl+Z tira todos.</p>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Modelo (slide <span id="btCur"></span>)</legend><div class="bt-ph" id="btPh"></div><p class="note" id="btPhNote"></p></fieldset>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Dados</legend>' +
      '<textarea id="btSrc" rows="5" spellcheck="false" placeholder="Cole aqui as células copiadas do Excel ou do Google Sheets (com a linha de cabeçalho), ou o texto de um CSV (; ou ,)"></textarea>' +
      '<div class="bt-row"><button type="button" class="xp-btn sm" data-x="file">Abrir arquivo .csv / .tsv…</button><button type="button" class="xp-btn sm" data-x="sample">Baixar exemplo (.csv)</button><span class="bt-info" id="btInfo" role="status" aria-live="polite"></span></div>' +
      '<div class="bt-prev" id="btPrev"></div></fieldset>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Opções</legend><div class="bt-row">' +
      '<label class="bt-opt">Linhas por slide <select id="btPer" aria-label="Linhas por slide">' + [1, 2, 3, 4, 5, 6].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('') + '</select></label>' +
      '<label class="xp-ck bt-ck"><input type="checkbox" id="btHide" checked><span>Esconder o slide modelo na apresentação</span></label></div>' +
      '<p class="note">Com mais de uma linha por slide, use <code>{{Coluna#2}}</code>, <code>{{Coluna#3}}</code>… para as outras linhas do grupo. <code>{{#}}</code> = número do slide no lote, <code>{{##}}</code> = total. Coluna é casada sem acento e sem maiúsculas.</p></fieldset>' +
      '</div>' +
      '<footer class="xp-f"><button type="button" class="xp-btn" data-x="cancel">Cancelar</button><button type="submit" class="xp-btn pri" id="btGo" disabled>Gerar slides</button></footer></form>' +
      '<input type="file" id="btFile" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]'); if (!x || !isOpen()) return;
      var k = x.dataset.x;
      if (k === 'bk' || k === 'close' || k === 'cancel') { close(); return; }
      if (k === 'file') { $('#btFile').click(); return; }
      if (k === 'sample') { var A = S(); A.download('exemplo-slides-em-lote.csv', '﻿' + sample(), 'text/csv;charset=utf-8'); toast('Exemplo baixado: abra no Excel, preencha e cole aqui'); return; }
      if (k === 'ph') { var A2 = S(); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(x.dataset.ph).then(function () { toast(x.dataset.ph + ' copiado: cole num texto do slide modelo'); }, function () { }); return; }
    });
    $('form', dlg).addEventListener('submit', function (e) { e.preventDefault(); run(); });
    $('#btSrc').addEventListener('input', function () { st.text = this.value; update(); });
    $('#btPer').addEventListener('change', function () { st.per = +this.value || 1; update(); });
    $('#btFile').addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      var r = new FileReader(); r.addEventListener('load', function () { $('#btSrc').value = st.text = String(r.result || ''); update(); toast('Arquivo lido: ' + f.name); }); r.addEventListener('error', function () { toast('Não deu para ler o arquivo.'); }); r.readAsText(f);
    });
  }
  function focusables() { return [].slice.call(dlg.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null && x.tabIndex >= 0; }); }
  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key === 'Tab') { var f = focusables(); if (!f.length) return; var i = f.indexOf(document.activeElement); e.preventDefault(); e.stopImmediatePropagation(); (f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length] || f[0]).focus(); return; }
    var inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && dlg.contains(e.target);
    if (e.key === 'Enter' && inField && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.key === 'F1' || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^[sodpzy]$/i.test(e.key) && !inField)) e.preventDefault();
    e.stopImmediatePropagation();
  }
  function isOpen() { return !!(dlg && !dlg.hidden); }
  function update() {
    if (!isOpen()) return;
    var A = S(), tpl = A.deck.slides[st.tplIdx], toks = tokensOf(tpl), table = parseTable(st.text || ''), heads = table.head.map(normKey);
    st.table = table; st.toks = toks;
    $('#btCur').textContent = String(st.tplIdx + 1);
    var cols = toks.filter(function (t) { return !t.special; }), miss = cols.filter(function (t) { return table.head.length && heads.indexOf(t.key) < 0; });
    $('#btPh').innerHTML = toks.length ? toks.map(function (t) { var bad = !t.special && table.head.length && heads.indexOf(t.key) < 0; return '<button type="button" class="chip' + (bad ? ' bad' : '') + '" data-x="ph" data-ph="' + esc(t.raw) + '" title="' + (bad ? 'Não há coluna com este nome na planilha' : 'Copiar') + '">' + esc(t.raw) + '</button>'; }).join('') : '<span class="bt-empty">Este slide ainda não tem {{Coluna}}. Clique numa coluna abaixo para copiar o marcador e cole-o num texto do slide.</span>';
    var unused = table.head.filter(function (h) { return !cols.some(function (t) { return t.key === normKey(h); }); });
    $('#btPhNote').textContent = toks.length ? (miss.length ? 'Sem coluna na planilha: ' + miss.map(function (t) { return t.raw; }).join(', ') + ' (ficam como estão). ' : '') + (unused.length ? 'Colunas sem uso no modelo: ' + unused.join(', ') + '.' : '') : '';
    var info = $('#btInfo'), prev = $('#btPrev'), go = $('#btGo');
    if (!table.head.length) { info.textContent = st.text && st.text.trim() ? 'Nada reconhecido: cole as células com a linha de cabeçalho.' : ''; prev.innerHTML = ''; go.disabled = true; go.textContent = 'Gerar slides'; return; }
    var n = Math.ceil(table.rows.length / st.per);
    info.textContent = (table.delim === '\t' ? 'Tabulação' : 'Separador “' + table.delim + '”') + ' · ' + table.head.length + (table.head.length === 1 ? ' coluna' : ' colunas') + ' · ' + table.rows.length + (table.rows.length === 1 ? ' linha' : ' linhas') + (table.over ? ' (as primeiras ' + MAXR + '; ' + table.over + ' ficaram de fora)' : '');
    var show = table.rows.slice(0, 5);
    prev.innerHTML = '<table><thead><tr>' + table.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + show.map(function (r) { return '<tr>' + table.head.map(function (h, k) { return '<td>' + esc((r[k] || '').replace(/\s+/g, ' ').slice(0, 60)) + '</td>'; }).join('') + '</tr>'; }).join('') + (table.rows.length > 5 ? '<tr><td colspan="' + table.head.length + '" class="bt-more">… e mais ' + (table.rows.length - 5) + '</td></tr>' : '') + '</tbody></table>';
    if (!table.rows.length) { go.disabled = true; go.textContent = 'Gerar slides'; info.textContent += ' · só o cabeçalho: faltam as linhas'; return; }
    if (!toks.length) $('#btPh').innerHTML += '<div class="bt-warn">Sem marcadores no slide modelo os slides sairiam todos iguais. Copie uma coluna (clique) e cole num texto do modelo.</div>';
    go.disabled = !toks.length; go.textContent = 'Gerar ' + n + (n === 1 ? ' slide' : ' slides');
    $('#btPh').querySelectorAll('.chip').forEach(function (c) { c.disabled = false; });
    /* colunas da planilha como marcadores para copiar (quando o modelo ainda não as usa) */
    var extra = table.head.filter(function (h) { return !toks.some(function (t) { return t.key === normKey(h); }); });
    if (extra.length) $('#btPh').innerHTML += '<div class="bt-cols">' + extra.map(function (h) { return '<button type="button" class="chip ghost" data-x="ph" data-ph="{{' + esc(h) + '}}" title="Copiar">{{' + esc(h) + '}}</button>'; }).join('') + '</div>';
  }
  function run() {
    var A = S(); if (!st || !st.table || !st.table.rows.length || !st.toks.length) return;
    var tpl = A.deck.slides[st.tplIdx], list = build(tpl, st.table, { per: st.per }), hide = $('#btHide').checked, rows = st.table.rows.length;
    var n = A.appendSlides(list, st.tplIdx + 1, function () { if (hide) tpl.hidden = true; }); /* ocultar o modelo entra no mesmo passo de desfazer que a inserção */
    close();
    toast(n + (n === 1 ? ' slide gerado' : ' slides gerados') + ' a partir de ' + rows + (rows === 1 ? ' linha' : ' linhas') + (hide ? ' · o modelo ficou oculto' : '') + ' · Ctrl+Z desfaz');
  }
  function open(opener) {
    var A = S(); if (!A) return;
    if (!dlg) build_();
    if (A.closeMenus) A.closeMenus();
    if (window.AMExport) { if (window.AMExport.isOpen && window.AMExport.isOpen()) window.AMExport.closeDialog(); if (window.AMExport.pptxDialog && window.AMExport.pptxDialog.isOpen()) window.AMExport.pptxDialog.close(); }
    if (window.AMImport && window.AMImport.isOpen && window.AMImport.isOpen()) window.AMImport.close();
    if (window.AMBrand && window.AMBrand.isOpen && window.AMBrand.isOpen()) window.AMBrand.close();
    var ae = document.activeElement;
    st = { tplIdx: A.cur, text: '', per: 1, prev: opener && opener.isConnected ? opener : (ae && ae !== document.body ? ae : null) };
    $('#btSrc').value = ''; $('#btPer').value = '1'; $('#btHide').checked = true;
    dlg.hidden = false; document.documentElement.classList.add('xp-open');
    addEventListener('keydown', onKey, true);
    update();
    setTimeout(function () { if (isOpen()) $('#btSrc').focus(); }, 30);
  }
  function close() {
    if (!isOpen()) return;
    dlg.hidden = true; document.documentElement.classList.remove('xp-open');
    removeEventListener('keydown', onKey, true);
    var p = st && st.prev; st = null;
    if (p && p.isConnected && p.focus) p.focus();
  }
  window.AMBatch = { open: open, close: close, isOpen: isOpen, parse: parseTable, tokens: tokensOf, build: build, sample: sample, setText: function (t) { if (!isOpen()) return; $('#btSrc').value = st.text = String(t || ''); update(); } };
})();
