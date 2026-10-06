/* ===== rt-60-forms.js — Formulário interativo (S30): perguntas respondidas dentro da apresentação salva =====
   Vai junto em todo arquivo exportado (concatenado ao runtime). Componente FX.form: título, texto de apoio, perguntas (uma por linha,
   codec abaixo), botão, mensagem final, ferramentas (contagem, CSV, copiar, limpar) e, opcional, o endereço de um app do Google
   Apps Script que recebe cada resposta (Google Sheets).
   Codec das perguntas (data.qs, uma por linha): "Pergunta" = texto curto · "Pergunta = texto longo" · "Pergunta = 1-5" (nota)
   · "Pergunta = sim/não" · "Pergunta = A | B | C" (uma opção) · "Pergunta = [] A | B | C" (várias) · "*" no fim = obrigatória.
   Respostas: localStorage 'amForm.<id da obra>.<id do elemento>' = {v, q: [perguntas], rows: [{at, a: [...]}]} — ficam no
   dispositivo de quem responde; "Baixar CSV" (; e BOM, Excel pt-BR) e "Copiar" (TSV, cola direto no Sheets/Excel) juntam tudo.
   Com data.sheet (https://…/exec), cada envio também faz POST (texto JSON {deck, form, title, at, q, a}; mode no-cors, sem
   confirmação de leitura) — o app do Apps Script (modelo no painel) acrescenta a linha na planilha.
   Editor (.am-edit): o formulário é inerte (CSS pointer-events) — clicar seleciona o elemento. Exportação (PDF/PowerPoint):
   só HTML/CSS (sem controles nativos), então a imagem sai igual à tela. Player: delegação em hd.deckEl (R.hooks.player);
   textos são contentEditable (o player ignora teclas em campos), opções e notas são botões (Enter/Espaço acionam o botão). */
(function (R) {
  'use strict';
  if (!R || !R.FX) return;
  var esc = R.esc, CQ = R.util.CQ, lines = R.util.lines;
  var KEY = 'amForm.', MAXQ = 20, MAXLEN = 2000, MAXROWS = 5000;
  /* ---------- codec ---------- */
  function parseQs(text) {
    var out = [];
    lines(text).forEach(function (l) {
      if (out.length >= MAXQ) return;
      var req = /\*\s*$/.test(l); if (req) l = l.replace(/\*\s*$/, '').trim();
      var m = /^(.*?)\s*=\s*(.*)$/.exec(l), t = m ? m[1].trim() : l.trim(), spec = m ? m[2].trim() : ''; /* "Pergunta =" (vazio) = texto curto */
      if (!t) return;
      var q = { t: t, type: 'text', opts: [], req: req };
      if (!spec) q.type = 'text';
      else if (/^(texto\s+longo|longo|long|par[aá]grafo)$/i.test(spec)) q.type = 'long';
      else if (/^1\s*-\s*5$/.test(spec) || /^nota$/i.test(spec)) q.type = 'rate';
      else if (/^(sim\s*\/\s*n[aã]o|s\/n|yes\s*\/\s*no)$/i.test(spec)) q.type = 'yn';
      else if (spec.indexOf('|') >= 0 || /^\[\s*\]/.test(spec)) {
        q.type = /^\[\s*\]/.test(spec) ? 'many' : 'one';
        q.opts = spec.replace(/^\[\s*\]\s*/, '').split('|').map(function (o) { return o.trim(); }).filter(Boolean).slice(0, 12);
        if (!q.opts.length) q.type = 'text';
      } else { q.type = 'text'; q.t = l.trim(); } /* "= algo" que não é um tipo conhecido: faz parte da pergunta */
      out.push(q);
    });
    return out;
  }
  /* ---------- armazenamento ---------- */
  function storeKey(deckId, elId) { return KEY + String(deckId || 'obra') + '.' + String(elId || 'form'); }
  function load(k) { try { var o = JSON.parse(localStorage.getItem(k) || 'null'); return o && Array.isArray(o.rows) ? o : { v: 1, q: [], rows: [] }; } catch (e) { return { v: 1, q: [], rows: [] }; } }
  function save(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); return true; } catch (e) { return false; } }
  function csvCell(v) { v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCSV(o) { var h = ['Data/hora'].concat(o.q).map(csvCell).join(';'); return '﻿' + [h].concat(o.rows.map(function (r) { return [r.at].concat(r.a).map(csvCell).join(';'); })).join('\r\n') + '\r\n'; }
  function toTSV(o) { var cl = function (v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '); }; return [['Data/hora'].concat(o.q).map(cl).join('\t')].concat(o.rows.map(function (r) { return [r.at].concat(r.a).map(cl).join('\t'); })).join('\n'); }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function slug(s) { return String(s || 'respostas').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'respostas'; }
  function nRows(n) { return n + (n === 1 ? ' resposta' : ' respostas'); }
  /* ---------- markup ---------- */
  function qHTML(q, i, id) {
    var lab = '<span class="amf-l" id="' + id + '-l' + i + '">' + (i + 1) + '. ' + esc(q.t) + (q.req ? ' <i class="amf-req" title="obrigatória">*</i>' : '') + '</span>', body;
    if (q.type === 'text' || q.type === 'long') body = '<div class="amf-in' + (q.type === 'long' ? ' amf-ta' : '') + '" role="textbox" aria-labelledby="' + id + '-l' + i + '"' + (q.type === 'long' ? ' aria-multiline="true"' : '') + ' data-ph="' + (q.type === 'long' ? 'Escreva aqui' : 'Sua resposta') + '"></div>';
    else if (q.type === 'rate') body = '<div class="amf-rate" role="radiogroup" aria-labelledby="' + id + '-l' + i + '">' + [1, 2, 3, 4, 5].map(function (v) { return '<button type="button" class="amf-rb" role="radio" aria-checked="false" data-v="' + v + '">' + v + '</button>'; }).join('') + '<span class="amf-rl"><em>1 = baixo</em><em>5 = alto</em></span></div>';
    else if (q.type === 'yn') body = '<div class="amf-yn" role="radiogroup" aria-labelledby="' + id + '-l' + i + '">' + ['Sim', 'Não'].map(function (v) { return '<button type="button" class="amf-rb amf-ynb" role="radio" aria-checked="false" data-v="' + v + '">' + v + '</button>'; }).join('') + '</div>';
    else body = '<div class="amf-opts" role="' + (q.type === 'many' ? 'group' : 'radiogroup') + '" aria-labelledby="' + id + '-l' + i + '">' + q.opts.map(function (o) { return '<button type="button" class="amf-o" role="' + (q.type === 'many' ? 'checkbox' : 'radio') + '" aria-checked="false" data-v="' + esc(o) + '"><i></i><span>' + esc(o) + '</span></button>'; }).join('') + '</div>';
    return '<div class="amf-q" data-q="' + i + '" data-type="' + q.type + '"' + (q.req ? ' data-req="1"' : '') + '>' + lab + body + '</div>';
  }
  R.FX.form = {
    name: 'Formulário', cat: 'Interativo', w: 620, h: 520, anim: { in: 'rise' },
    kw: 'formulário pesquisa enquete questionário perguntas respostas feedback avaliação nps workshop coleta planilha google sheets csv interativo',
    data: {
      title: 'Pesquisa rápida', intro: 'Leva um minuto. As respostas ficam neste dispositivo e podem ser baixadas em CSV.',
      qs: 'Nome *\nComo avalia este encontro? = 1-5\nQual área você representa? = Finanças | Operações | TI\nComentários = texto longo',
      btn: 'Enviar', thanks: 'Obrigado! Resposta registrada.', tools: '1', sheet: ''
    },
    fields: [['title', 'Título'], ['intro', 'Texto de apoio', 'area'],
      ['qs', 'Perguntas — uma por linha: “Pergunta” (texto curto) · “= texto longo” · “= 1-5” (nota) · “= sim/não” · “= A | B | C” (uma opção) · “= [] A | B” (várias) · “*” no fim = obrigatória. Na apresentação a lista rola; no PDF e no PowerPoint só cabe o que aparece no slide (aumente a altura ou use dois formulários)', 'area'],
      ['btn', 'Botão de enviar'], ['thanks', 'Mensagem depois de enviar'],
      ['tools', 'Ferramentas na apresentação (contagem, Baixar CSV, Copiar, Limpar)', 'sel:1=Mostrar|0=Esconder'],
      ['sheet', 'Google Sheets: endereço do app (https://script.google.com/…/exec), opcional'],
      ['help', '<b>Como as respostas chegam a você</b><br>Cada pessoa responde na própria cópia da apresentação (.html): as respostas ficam no dispositivo dela e saem por <b>Baixar CSV</b> ou <b>Copiar</b> (cola no Sheets/Excel). Para juntar tudo numa planilha em tempo real: no Google Sheets, <b>Extensões › Apps Script</b>, cole o código abaixo, <b>Implantar › Novo app da Web</b> (executar como você; acesso: qualquer pessoa) e cole o endereço <i>…/exec</i> no campo acima.' +
        '<textarea class="fhelp-code" readonly rows="6" spellcheck="false" aria-label="Código do Apps Script">function doPost(e) {\n  var d = JSON.parse(e.postData.contents), ss = SpreadsheetApp.getActiveSpreadsheet();\n  var sh = ss.getSheetByName(d.form) || ss.insertSheet(d.form);\n  if (sh.getLastRow() === 0) sh.appendRow([\'Data/hora\'].concat(d.q));\n  sh.appendRow([d.at].concat(d.a));\n  return ContentService.createTextOutput(\'ok\');\n}</textarea>', 'help']],
    tip: 'Na apresentação, as pessoas respondem direto no slide. Animações e transições continuam valendo; o formulário fica interativo quando o slide está na tela.',
    parse: parseQs,
    html: function (d, w, h, el) {
      var qs = parseQs(d.qs), f = Math.max(11, Math.min(w * .027, h * .038)), id = 'amf-' + esc(String(el && el.id || 'x').replace(/[^\w-]/g, ''));
      var tools = String(d.tools == null ? '1' : d.tools) !== '0';
      return '<div class="fx amf am-ia" style="font-size:' + CQ(f) + '" data-form="1"' + (tools ? ' data-tools="1"' : '') + (typeof d.sheet === 'string' && /^https:\/\//i.test(d.sheet.trim()) ? ' data-sheet="' + esc(d.sheet.trim()) + '"' : '') + ' data-title="' + esc(d.title || '') + '">' +
        '<div class="amf-body"><div class="amf-h">' + (d.title ? '<b class="amf-t">' + esc(d.title) + '</b>' : '') + (d.intro ? '<span class="amf-i">' + esc(d.intro) + '</span>' : '') + '</div>' +
        '<div class="amf-qs">' + (qs.length ? qs.map(function (q, i) { return qHTML(q, i, id); }).join('') : '<p class="amf-empty">Escreva as perguntas no painel (uma por linha).</p>') + '</div>' +
        '<div class="amf-done" hidden><b>' + esc(d.thanks || 'Obrigado!') + '</b><button type="button" class="amf-again">Responder de novo</button></div></div>' + /* a mensagem final cobre só título e perguntas: o rodapé (contagem, CSV, copiar) continua à mão */
        '<div class="amf-f"><button type="button" class="amf-send">' + esc(d.btn || 'Enviar') + '</button><span class="amf-st" role="status" aria-live="polite"></span>' +
        (tools ? '<span class="amf-tools"><span class="amf-n">0 respostas</span><button type="button" class="amf-tb amf-dl" title="Baixa um .csv com todas as respostas deste dispositivo">Baixar CSV</button><button type="button" class="amf-tb amf-copy" title="Copia as respostas (cola direto numa planilha)">Copiar</button><button type="button" class="amf-tb amf-clear" title="Apaga as respostas guardadas neste dispositivo">Limpar</button></span>' : '') + '</div></div>';
    }
  };
  /* ---------- player ---------- */
  function formOf(t) { return t && t.closest ? t.closest('.amf') : null; }
  function elIdOf(root) { var n = root.closest('.am-el'); return n && n.dataset.id || 'form'; }
  function answersOf(root) {
    var out = [], miss = null;
    Array.prototype.forEach.call(root.querySelectorAll('.amf-q'), function (q) {
      var tp = q.dataset.type, v = '';
      if (tp === 'text' || tp === 'long') { var box = q.querySelector('.amf-in'); v = (box.innerText || box.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim().slice(0, MAXLEN); }
      else if (tp === 'many') v = Array.prototype.map.call(q.querySelectorAll('.amf-o[aria-checked="true"]'), function (b) { return b.dataset.v; }).join(' | ');
      else { var on = q.querySelector('[aria-checked="true"]'); v = on ? on.dataset.v : ''; }
      if (q.dataset.req === '1' && !v && !miss) miss = q;
      out.push(v);
    });
    return { a: out, miss: miss };
  }
  function qTitles(root) { return Array.prototype.map.call(root.querySelectorAll('.amf-q .amf-l'), function (l) { return l.textContent.replace(/^\d+\.\s*/, '').replace(/\s*\*\s*$/, '').trim(); }); }
  function status(root, msg, kind) { var s = root.querySelector('.amf-st'); if (!s) return; s.textContent = msg || ''; s.className = 'amf-st' + (kind ? ' ' + kind : ''); }
  function refresh(root, key) { var n = root.querySelector('.amf-n'); if (!n) return; var o = load(key); n.textContent = nRows(o.rows.length); var dis = !o.rows.length; Array.prototype.forEach.call(root.querySelectorAll('.amf-dl,.amf-copy,.amf-clear'), function (b) { b.disabled = dis; }); }
  function reset(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.amf-in'), function (b) { b.textContent = ''; });
    Array.prototype.forEach.call(root.querySelectorAll('[aria-checked="true"]'), function (b) { b.setAttribute('aria-checked', 'false'); });
    Array.prototype.forEach.call(root.querySelectorAll('.amf-q.amf-miss'), function (q) { q.classList.remove('amf-miss'); });
    root.querySelector('.amf-done').hidden = true; root.classList.remove('amf-sent'); status(root, '');
  }
  function arm(root, deckId) {
    if (root.dataset.live === '1') return; root.dataset.live = '1';
    Array.prototype.forEach.call(root.querySelectorAll('.amf-in'), function (b) { b.setAttribute('contenteditable', 'true'); b.setAttribute('spellcheck', 'true'); });
    refresh(root, storeKey(deckId, elIdOf(root)));
  }
  function postSheet(url, payload) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('sem fetch'));
    return fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), keepalive: true });
  }
  function submit(root, deckId) {
    var r = answersOf(root);
    Array.prototype.forEach.call(root.querySelectorAll('.amf-q.amf-miss'), function (q) { q.classList.remove('amf-miss'); });
    if (r.miss) { r.miss.classList.add('amf-miss'); status(root, 'Falta responder: ' + r.miss.querySelector('.amf-l').textContent.replace(/\s*\*\s*$/, ''), 'amf-err'); var f = r.miss.querySelector('.amf-in,[role=radio],[role=checkbox]'); if (f && f.focus) f.focus(); return false; }
    var key = storeKey(deckId, elIdOf(root)), o = load(key), q = qTitles(root), at = stamp();
    o.q = q; o.rows.push({ at: at, a: r.a }); if (o.rows.length > MAXROWS) o.rows.splice(0, o.rows.length - MAXROWS);
    var ok = save(key, o);
    root.classList.add('amf-sent'); root.querySelector('.amf-done').hidden = false; refresh(root, key);
    var url = root.dataset.sheet;
    if (url) {
      status(root, 'Enviando à planilha…');
      postSheet(url, { deck: String(deckId || ''), form: (root.dataset.title || 'Formulário').slice(0, 80), title: root.dataset.title || '', at: at, q: q, a: r.a })
        .then(function () { status(root, ok ? 'Registrada aqui e enviada à planilha.' : 'Enviada à planilha (sem espaço para guardar aqui).', 'amf-ok'); })
        .catch(function () { status(root, ok ? 'Registrada aqui; sem internet para a planilha.' : 'Não deu para guardar nem enviar.', 'amf-err'); });
    } else status(root, ok ? 'Registrada neste dispositivo.' : 'Não deu para guardar neste dispositivo (armazenamento cheio ou bloqueado).', ok ? 'amf-ok' : 'amf-err');
    return true;
  }
  function formClick(e, hd) {
    var b = e.target.closest ? e.target.closest('button') : null, root = formOf(e.target); if (!root || !b || !root.contains(b)) return;
    var deckId = hd && hd.deck && hd.deck.id;
    arm(root, deckId);
    if (b.classList.contains('amf-rb') || b.classList.contains('amf-o')) {
      var grp = b.parentNode, many = b.getAttribute('role') === 'checkbox';
      if (many) b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      else Array.prototype.forEach.call(grp.querySelectorAll('[role=radio]'), function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      b.closest('.amf-q').classList.remove('amf-miss'); return;
    }
    if (b.classList.contains('amf-send')) { submit(root, deckId); return; }
    if (b.classList.contains('amf-again')) { reset(root); var first = root.querySelector('.amf-in,[role=radio],[role=checkbox]'); if (first && first.focus) first.focus(); return; }
    var key = storeKey(deckId, elIdOf(root));
    if (b.classList.contains('amf-dl')) { var o = load(key); if (!o.rows.length) return; download('respostas-' + slug(root.dataset.title) + '.csv', toCSV(o), 'text/csv;charset=utf-8'); status(root, nRows(o.rows.length) + ' no arquivo CSV.', 'amf-ok'); return; }
    if (b.classList.contains('amf-copy')) {
      var o2 = load(key); if (!o2.rows.length) return; var tsv = toTSV(o2);
      var done = function () { status(root, nRows(o2.rows.length) + ' copiadas: cole numa planilha.', 'amf-ok'); }, fail = function () { status(root, 'Não deu para copiar: use Baixar CSV.', 'amf-err'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(done, fail); else fail();
      return;
    }
    if (b.classList.contains('amf-clear')) {
      if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'Confirmar: apagar?'; status(root, 'Clique de novo para apagar as respostas deste dispositivo.', 'amf-err'); clearTimeout(b._t); b._t = setTimeout(function () { b.dataset.arm = '0'; b.textContent = 'Limpar'; }, 4000); return; }
      clearTimeout(b._t); b.dataset.arm = '0'; b.textContent = 'Limpar'; try { localStorage.removeItem(key); } catch (er) { } refresh(root, key); status(root, 'Respostas apagadas neste dispositivo.', 'amf-ok'); return;
    }
  }
  R.hooks.player.push(function (hd) {
    var deckEl = hd.deckEl; if (!deckEl) return;
    var click = function (e) { formClick(e, hd); };
    var keyd = function (e) { /* Enter num campo de uma linha = vai para a próxima pergunta, não quebra linha */
      var box = e.target && e.target.closest ? e.target.closest('.amf-in') : null; if (!box || box.classList.contains('amf-ta') || e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault(); var all = Array.prototype.slice.call(formOf(box).querySelectorAll('.amf-in,[role=radio],[role=checkbox],.amf-send')), i = all.indexOf(box); if (all[i + 1]) all[i + 1].focus();
    };
    var paste = function (e) { var box = e.target && e.target.closest ? e.target.closest('.amf-in') : null; if (!box) return; e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text'); if (t) document.execCommand('insertText', false, box.classList.contains('amf-ta') ? t : t.replace(/\s*\n+\s*/g, ' ')); };
    deckEl.addEventListener('click', click); deckEl.addEventListener('keydown', keyd); deckEl.addEventListener('paste', paste);
    hd.onDestroy(function () { deckEl.removeEventListener('click', click); deckEl.removeEventListener('keydown', keyd); deckEl.removeEventListener('paste', paste); });
    /* todos os slides já estão no DOM do player: os formulários ficam ativos de uma vez (sem hooks.show, que é só da navegação) */
    Array.prototype.forEach.call(deckEl.querySelectorAll('.amf'), function (root) { arm(root, hd.deck && hd.deck.id); });
  });
  R.forms = { parse: parseQs, key: storeKey, load: load, csv: toCSV, tsv: toTSV, answers: answersOf, submit: submit,
    /* partilhado com rt-61-workshop.js (quadro, votação): guardar, baixar, nome de arquivo, data/hora, envio à planilha, célula CSV */
    save: save, download: download, slug: slug, stamp: stamp, post: postSheet, cell: csvCell };
})(window.AMRT);
