/* ===== rt-61-workshop.js — Workshop ao vivo (S31): quadro de post-its, votação por pontos e cronômetro =====
   Vai junto em todo arquivo exportado (depois de rt-60-forms.js, de onde vêm guardar/baixar/CSV/planilha: R.forms).
   · FX.board  — Quadro de post-its: colunas (uma por linha) e notas (coluna | texto | cor). Na apresentação: “+ Nota” em cada
     coluna, texto editável, cor, apagar, arrastar entre colunas (pela faixa de cima). Estado em localStorage
     'amBoard.<obra>.<elemento>' (começa com as notas do editor; “Limpar” volta a elas). Baixar CSV / Copiar.
   · FX.vote   — Votação por pontos: cada pessoa distribui N pontos entre as opções (+/−) e vota; os votos ficam em
     'amVote.<obra>.<elemento>'; resultado em barras (sempre, depois de votar ou nunca — o apresentador alterna). CSV, Copiar,
     Limpar, Google Sheets opcional (mesmo app do formulário: linha = data/hora + pontos por opção).
   · FX.timer  — Cronômetro regressivo: minutos:segundos, anel de progresso, Iniciar/Pausar, Reiniciar, ±1 min; ao zerar,
     avisa (pisca) e toca três bipes (WebAudio) se o som estiver ligado. Continua contando ao trocar de slide.
   Tudo é HTML/CSS (sem controles nativos): a imagem do PDF/PowerPoint e o palco do editor mostram o estado do editor; no
   player, delegação em hd.deckEl (R.hooks.player). Os três levam .am-ia: o clique neles nunca cai nas zonas de avançar/voltar. */
(function (R) {
  'use strict';
  if (!R || !R.FX || !R.forms) return;
  var esc = R.esc, CQ = R.util.CQ, lines = R.util.lines, F = R.forms;
  var COLORS = { y: ['Amarelo', '#FFE89A'], p: ['Rosa', '#FFC9D6'], b: ['Azul', '#C9E1F7'], g: ['Verde', '#CDEFD4'], o: ['Laranja', '#FFD5A8'] }, CK = ['y', 'p', 'b', 'g', 'o'];
  function rid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function cleanNotes(list, ncol) {
    return (Array.isArray(list) ? list : []).slice(0, 200).map(function (n) {
      if (!n || typeof n !== 'object') return null;
      var c = Math.max(0, Math.min(Math.max(0, ncol - 1), num(n.c, 0) | 0)), t = String(n.t == null ? '' : n.t).slice(0, 400), k = COLORS[n.k] ? n.k : 'y';
      return { id: typeof n.id === 'string' && /^[\w-]{1,24}$/.test(n.id) ? n.id : rid(), c: c, t: t, k: k, at: typeof n.at === 'string' ? n.at.slice(0, 24) : '' };
    }).filter(Boolean);
  }
  /* ---------------- quadro de post-its ---------------- */
  function noteHTML(n) {
    return '<div class="amb-n amb-' + n.k + '" data-id="' + esc(n.id) + '"><div class="amb-grip" title="Arraste para outra coluna"><span class="amb-cs">' + CK.map(function (k) { return '<button type="button" class="amb-c amb-' + k + (k === n.k ? ' on' : '') + '" data-k="' + k + '" title="' + COLORS[k][0] + '" aria-label="Cor ' + COLORS[k][0] + '"></button>'; }).join('') + '</span><button type="button" class="amb-x" title="Apagar nota" aria-label="Apagar nota">×</button></div>' +
      '<div class="amb-t" role="textbox" aria-multiline="true" data-ph="Escreva aqui">' + esc(n.t) + '</div></div>';
  }
  function boardHTML(cols, notes, tools, title) {
    return '<div class="amb-cols" style="--n:' + cols.length + '">' + cols.map(function (c, i) {
      return '<div class="amb-col" data-c="' + i + '"><div class="amb-ch"><b>' + esc(c) + '</b><span class="amb-cn">' + notes.filter(function (n) { return n.c === i; }).length + '</span><button type="button" class="amb-add" title="Nova nota nesta coluna">+ Nota</button></div><div class="amb-list">' + notes.filter(function (n) { return n.c === i; }).map(noteHTML).join('') + '</div></div>';
    }).join('') + '</div>' +
      (tools ? '<div class="amw-f"><span class="amw-st" role="status" aria-live="polite"></span><span class="amw-tools"><span class="amw-n">' + notes.length + (notes.length === 1 ? ' nota' : ' notas') + '</span><button type="button" class="amw-tb amb-dl" title="Baixa um .csv com as notas (coluna, texto, cor)">Baixar CSV</button><button type="button" class="amw-tb amb-copy" title="Copia as notas (cola numa planilha)">Copiar</button><button type="button" class="amw-tb amb-clear" title="Volta às notas originais do slide">Limpar</button></span></div>' : '');
  }
  R.FX.board = {
    name: 'Quadro de post-its', cat: 'Interativo', w: 1100, h: 520, anim: { in: 'rise' },
    kw: 'post-it post it notas adesivas quadro workshop brainstorm ideias retrospectiva começar parar continuar kanban mural colaborativo',
    data: { title: 'Retrospectiva', cols: 'Começar\nParar\nContinuar', tools: '1',
      notes: [{ c: 0, t: 'Reunião semanal de 15 min com o cliente', k: 'y' }, { c: 0, t: 'Painel único de status', k: 'b' }, { c: 1, t: 'Relatórios em PDF por e-mail', k: 'p' }, { c: 2, t: 'Revisão em pares antes de enviar', k: 'g' }] },
    fields: [['title', 'Título'], ['cols', 'Colunas (uma por linha, até 6)', 'lines'],
      ['notes', 'Notas iniciais (coluna 0, 1, 2… | texto | cor: y amarelo, p rosa, b azul, g verde, o laranja)', 'rows:c:n|t|k'],
      ['tools', 'Ferramentas na apresentação (contagem, Baixar CSV, Copiar, Limpar)', 'sel:1=Mostrar|0=Esconder'],
      ['help', '<b>Na apresentação</b>, cada coluna tem <b>+ Nota</b>; a nota se escreve direto, muda de cor pelos pontinhos, apaga no × e vai para outra coluna arrastando pela faixa de cima. As notas ficam no dispositivo (voltam quando o arquivo é reaberto nele); <b>Baixar CSV</b> e <b>Copiar</b> levam tudo para uma planilha; <b>Limpar</b> volta às notas deste painel.', 'help']],
    tip: 'Use um quadro por dinâmica: retrospectiva (Começar / Parar / Continuar), ideias por tema, dúvidas da equipe.',
    html: function (d, w, h) {
      var cols = lines(d.cols).slice(0, 6); if (!cols.length) cols = ['Ideias'];
      var notes = cleanNotes(d.notes, cols.length), f = Math.max(10, Math.min(w * .016, h * .034)), tools = String(d.tools == null ? '1' : d.tools) !== '0';
      return '<div class="fx amw amb am-ia" style="font-size:' + CQ(f) + '" data-board="1" data-title="' + esc(d.title || '') + '" data-cols="' + esc(cols.join('\n')) + '"' + (tools ? ' data-tools="1"' : '') + '>' +
        (d.title ? '<div class="amw-h"><b>' + esc(d.title) + '</b></div>' : '') + boardHTML(cols, notes, tools, d.title) +
        '<template class="amb-seed">' + esc(JSON.stringify(notes)) + '</template></div>';
    }
  };
  function bKey(root, hd) { var n = root.closest('.am-el'); return 'amBoard.' + String(hd && hd.deck && hd.deck.id || 'obra') + '.' + (n && n.dataset.id || 'board'); }
  function bState(root, hd) {
    var k = bKey(root, hd), o; try { o = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { o = null; }
    if (!o || !Array.isArray(o.notes)) { var seed = root.querySelector('.amb-seed'); var init = []; try { init = JSON.parse(seed ? seed.innerHTML.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '[]'); } catch (e) { init = []; } o = { v: 1, notes: cleanNotes(init, 99) }; }
    return { key: k, o: o };
  }
  function bSave(root, hd, o) { F.save(bKey(root, hd), o); }
  function bRender(root, hd) {
    var st = bState(root, hd), cols = (root.dataset.cols || '').split('\n'), tools = root.dataset.tools === '1';
    var notes = cleanNotes(st.o.notes, cols.length);
    var keep = root.querySelector('.amw-st'), msg = keep ? keep.textContent : '';
    var wrap = root.querySelector('.amb-cols'); var tmp = document.createElement('div'); tmp.innerHTML = boardHTML(cols, notes, tools, root.dataset.title);
    wrap.replaceWith(tmp.firstChild); var f = root.querySelector('.amw-f'); if (f) f.remove(); if (tmp.firstChild) root.insertBefore(tmp.firstChild, root.querySelector('.amb-seed'));
    Array.prototype.forEach.call(root.querySelectorAll('.amb-t'), function (t) { t.setAttribute('contenteditable', 'true'); });
    var s2 = root.querySelector('.amw-st'); if (s2) s2.textContent = msg;
    return notes;
  }
  function wStatus(root, msg, kind) { var s = root.querySelector('.amw-st'); if (!s) return; s.textContent = msg || ''; s.className = 'amw-st' + (kind ? ' ' + kind : ''); }
  function boardCSV(cols, notes) { return '﻿' + ['Coluna;Nota;Cor;Data/hora'].concat(notes.map(function (n) { return [cols[n.c] || n.c, n.t, COLORS[n.k][0], n.at || ''].map(F.cell).join(';'); })).join('\r\n') + '\r\n'; }
  function boardTSV(cols, notes) { var cl = function (v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '); }; return ['Coluna\tNota\tCor\tData/hora'].concat(notes.map(function (n) { return [cols[n.c] || n.c, n.t, COLORS[n.k][0], n.at || ''].map(cl).join('\t'); })).join('\n'); }
  function boardClick(e, root, hd) {
    var b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    var st = bState(root, hd), cols = (root.dataset.cols || '').split('\n');
    if (b.classList.contains('amb-add')) {
      var c = +b.closest('.amb-col').dataset.c, n = { id: rid(), c: c, t: '', k: CK[st.o.notes.length % CK.length], at: F.stamp() };
      st.o.notes.push(n); bSave(root, hd, st.o); bRender(root, hd);
      var nt = root.querySelector('.amb-n[data-id="' + n.id + '"] .amb-t'); if (nt) { nt.focus(); }
      return;
    }
    var note = b.closest('.amb-n'); if (!note) {
      if (b.classList.contains('amb-dl')) { var ns = cleanNotes(st.o.notes, cols.length); if (!ns.length) return; F.download('notas-' + F.slug(root.dataset.title || 'quadro') + '.csv', boardCSV(cols, ns), 'text/csv;charset=utf-8'); wStatus(root, ns.length + ' notas no arquivo CSV.', 'amw-ok'); return; }
      if (b.classList.contains('amb-copy')) { var ns2 = cleanNotes(st.o.notes, cols.length); if (!ns2.length) return; var ok = function () { wStatus(root, ns2.length + ' notas copiadas: cole numa planilha.', 'amw-ok'); }, bad = function () { wStatus(root, 'Não deu para copiar: use Baixar CSV.', 'amw-err'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(boardTSV(cols, ns2)).then(ok, bad); else bad(); return; }
      if (b.classList.contains('amb-clear')) { if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'Confirmar: voltar ao original?'; clearTimeout(b._t); b._t = setTimeout(function () { b.dataset.arm = '0'; b.textContent = 'Limpar'; }, 4000); return; } try { localStorage.removeItem(bKey(root, hd)); } catch (er) { } bRender(root, hd); wStatus(root, 'Quadro de volta às notas originais.', 'amw-ok'); return; }
      return;
    }
    var id = note.dataset.id, n2 = st.o.notes.filter(function (x) { return x.id === id; })[0]; if (!n2) return;
    if (b.classList.contains('amb-x')) { st.o.notes = st.o.notes.filter(function (x) { return x.id !== id; }); bSave(root, hd, st.o); bRender(root, hd); return; }
    if (b.classList.contains('amb-c')) { n2.k = COLORS[b.dataset.k] ? b.dataset.k : 'y'; bSave(root, hd, st.o); note.className = 'amb-n amb-' + n2.k; Array.prototype.forEach.call(note.querySelectorAll('.amb-c'), function (x) { x.classList.toggle('on', x.dataset.k === n2.k); }); return; }
  }
  function boardInput(e, root, hd) {
    var t = e.target.closest ? e.target.closest('.amb-t') : null; if (!t) return;
    var note = t.closest('.amb-n'), st = bState(root, hd), n = st.o.notes.filter(function (x) { return x.id === note.dataset.id; })[0]; if (!n) return;
    n.t = (t.innerText || t.textContent || '').replace(/ /g, ' ').trim().slice(0, 400); bSave(root, hd, st.o);
  }
  var drag = null;
  function boardDown(e, root, hd) {
    var g = e.target.closest ? e.target.closest('.amb-grip') : null; if (!g || e.target.closest('button') || e.button) return;
    var note = g.closest('.amb-n'); e.preventDefault();
    drag = { root: root, hd: hd, note: note, id: note.dataset.id, x0: e.clientX, y0: e.clientY, moved: false };
    note.classList.add('amb-drag'); try { g.setPointerCapture(e.pointerId); } catch (er) { }
  }
  function boardMove(e) {
    if (!drag) return; var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.note.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(-1.5deg)';
    Array.prototype.forEach.call(drag.root.querySelectorAll('.amb-col.amb-over'), function (c) { c.classList.remove('amb-over'); });
    var el = document.elementFromPoint(e.clientX, e.clientY), col = el && el.closest ? el.closest('.amb-col') : null; if (col && drag.root.contains(col)) col.classList.add('amb-over');
  }
  function boardUp(e) {
    if (!drag) return; var d = drag; drag = null; d.note.classList.remove('amb-drag'); d.note.style.transform = '';
    Array.prototype.forEach.call(d.root.querySelectorAll('.amb-col.amb-over'), function (c) { c.classList.remove('amb-over'); });
    if (!d.moved) return;
    var el = document.elementFromPoint(e.clientX, e.clientY), col = el && el.closest ? el.closest('.amb-col') : null; if (!col || !d.root.contains(col)) return;
    var st = bState(d.root, d.hd), n = st.o.notes.filter(function (x) { return x.id === d.id; })[0]; if (!n) return;
    var c = +col.dataset.c; if (n.c === c) return; n.c = c; bSave(d.root, d.hd, st.o); bRender(d.root, d.hd);
  }
  /* ---------------- votação por pontos ---------------- */
  function voteHTML(opts, pts, show, tools, totals, nVotes, dark) {
    var max = Math.max(1, Math.max.apply(null, totals.concat([0]))), sum = totals.reduce(function (a, b) { return a + b; }, 0);
    return '<div class="amv-opts">' + opts.map(function (o, i) {
      return '<div class="amv-o" data-i="' + i + '"><span class="amv-l">' + esc(o) + '</span><span class="amv-ctl"><button type="button" class="amv-m" aria-label="Tirar um ponto de ' + esc(o) + '" title="−1">−</button><b class="amv-v" aria-live="polite">0</b><button type="button" class="amv-p" aria-label="Dar um ponto a ' + esc(o) + '" title="+1">+</button></span>' +
        '<span class="amv-bar"><i style="width:' + (sum ? Math.round(totals[i] / max * 100) : 0) + '%"></i><em>' + totals[i] + (sum ? ' · ' + Math.round(totals[i] / sum * 100) + '%' : '') + '</em></span></div>';
    }).join('') + '</div>' +
      '<div class="amv-f"><span class="amv-left"><b>' + pts + '</b> ' + (pts === 1 ? 'ponto' : 'pontos') + ' para distribuir</span><button type="button" class="amv-send">Votar</button><button type="button" class="amv-show" aria-pressed="' + (show === 'always' ? 'true' : 'false') + '">' + (show === 'always' ? 'Esconder resultado' : 'Ver resultado') + '</button></div>' +
      (tools ? '<div class="amw-f"><span class="amw-st" role="status" aria-live="polite"></span><span class="amw-tools"><span class="amw-n">' + nVotes + (nVotes === 1 ? ' voto' : ' votos') + '</span><button type="button" class="amw-tb amv-dl" title="Baixa um .csv com os votos">Baixar CSV</button><button type="button" class="amw-tb amv-copy" title="Copia os votos (cola numa planilha)">Copiar</button><button type="button" class="amw-tb amv-clear" title="Apaga os votos deste dispositivo">Limpar</button></span></div>' : '');
  }
  R.FX.vote = {
    name: 'Votação por pontos', cat: 'Interativo', w: 700, h: 460, anim: { in: 'rise' },
    kw: 'votação votar pontos dot voting priorização prioridades enquete ranking workshop decisão consenso',
    data: { title: 'Priorização', question: 'Onde investir primeiro? Distribua os seus pontos.', opts: 'Automação do intake\nPortal do cliente\nTorre de controle\nDados mestres', pts: 3, show: 'after', tools: '1', sheet: '' },
    fields: [['title', 'Título'], ['question', 'Pergunta ou instrução'], ['opts', 'Opções (uma por linha, até 12)', 'lines'], ['pts', 'Pontos por pessoa (1 a 10)', 'number'],
      ['show', 'Resultado', 'sel:after=Mostrar depois de votar|always=Sempre visível|never=Só quando o apresentador pedir'],
      ['tools', 'Ferramentas na apresentação (contagem, Baixar CSV, Copiar, Limpar)', 'sel:1=Mostrar|0=Esconder'],
      ['sheet', 'Google Sheets: endereço do app (https://script.google.com/…/exec), opcional — mesmo código do Formulário'],
      ['help', 'Cada pessoa distribui os pontos com <b>+</b> e <b>−</b> (pode pôr mais de um na mesma opção) e clica em <b>Votar</b>. O resultado soma os votos guardados <b>neste dispositivo</b>; com o app do Google Sheets (código no Formulário), cada voto também vai para a planilha (uma linha: data/hora + pontos por opção).', 'help']],
    tip: 'Para várias pessoas no mesmo computador (sala), cada uma vota na sua vez; para votar de longe, ligue a planilha.',
    html: function (d, w, h) {
      var opts = lines(d.opts).slice(0, 12); if (!opts.length) opts = ['Opção A', 'Opção B'];
      var pts = Math.max(1, Math.min(10, num(d.pts, 3) | 0)), show = /^(always|after|never)$/.test(d.show) ? d.show : 'after', f = Math.max(10, Math.min(w * .024, h * .036)), tools = String(d.tools == null ? '1' : d.tools) !== '0';
      return '<div class="fx amw amv am-ia' + (show === 'always' ? ' amv-res' : '') + '" style="font-size:' + CQ(f) + '" data-vote="1" data-pts="' + pts + '" data-show="' + show + '" data-title="' + esc(d.title || '') + '" data-opts="' + esc(opts.join('\n')) + '"' + (tools ? ' data-tools="1"' : '') + (typeof d.sheet === 'string' && /^https:\/\//i.test(d.sheet.trim()) ? ' data-sheet="' + esc(d.sheet.trim()) + '"' : '') + '>' +
        '<div class="amw-h">' + (d.title ? '<b>' + esc(d.title) + '</b>' : '') + (d.question ? '<span>' + esc(d.question) + '</span>' : '') + '</div>' +
        voteHTML(opts, pts, show, tools, opts.map(function () { return 0; }), 0) + '</div>';
    }
  };
  function vKey(root, hd) { var n = root.closest('.am-el'); return 'amVote.' + String(hd && hd.deck && hd.deck.id || 'obra') + '.' + (n && n.dataset.id || 'vote'); }
  function vLoad(root, hd) { var o; try { o = JSON.parse(localStorage.getItem(vKey(root, hd)) || 'null'); } catch (e) { o = null; } return o && Array.isArray(o.rows) ? o : { v: 1, q: [], rows: [] }; }
  function vTotals(root, o) { var opts = (root.dataset.opts || '').split('\n'), t = opts.map(function () { return 0; }); o.rows.forEach(function (r) { (r.a || []).forEach(function (v, i) { if (i < t.length) t[i] += num(v, 0); }); }); return t; }
  function vRefresh(root, hd) {
    var o = vLoad(root, hd), t = vTotals(root, o), max = Math.max(1, Math.max.apply(null, t.concat([0]))), sum = t.reduce(function (a, b) { return a + b; }, 0);
    Array.prototype.forEach.call(root.querySelectorAll('.amv-o'), function (row, i) { var bar = row.querySelector('.amv-bar'); bar.querySelector('i').style.width = (sum ? Math.round(t[i] / max * 100) : 0) + '%'; bar.querySelector('em').textContent = t[i] + (sum ? ' · ' + Math.round(t[i] / sum * 100) + '%' : ''); });
    var n = root.querySelector('.amw-n'); if (n) n.textContent = o.rows.length + (o.rows.length === 1 ? ' voto' : ' votos');
    var dis = !o.rows.length; Array.prototype.forEach.call(root.querySelectorAll('.amv-dl,.amv-copy,.amv-clear'), function (b) { b.disabled = dis; });
  }
  function vMine(root) { return Array.prototype.map.call(root.querySelectorAll('.amv-o .amv-v'), function (b) { return num(b.textContent, 0) | 0; }); }
  function vLeft(root) { var pts = num(root.dataset.pts, 3), used = vMine(root).reduce(function (a, b) { return a + b; }, 0), left = pts - used, el = root.querySelector('.amv-left'); if (el) el.innerHTML = '<b>' + left + '</b> ' + (left === 1 ? 'ponto' : 'pontos') + ' para distribuir'; root.querySelector('.amv-send').disabled = used === 0; Array.prototype.forEach.call(root.querySelectorAll('.amv-p'), function (b) { b.disabled = left <= 0; }); Array.prototype.forEach.call(root.querySelectorAll('.amv-o'), function (row) { row.querySelector('.amv-m').disabled = num(row.querySelector('.amv-v').textContent, 0) <= 0; }); return left; }
  function vShow(root, on) { root.classList.toggle('amv-res', on); var b = root.querySelector('.amv-show'); if (b) { b.textContent = on ? 'Esconder resultado' : 'Ver resultado'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
  function voteCSV(opts, o) { return '﻿' + [['Data/hora'].concat(opts).map(F.cell).join(';')].concat(o.rows.map(function (r) { return [r.at].concat(r.a).map(F.cell).join(';'); })).join('\r\n') + '\r\n'; }
  function voteTSV(opts, o) { return [['Data/hora'].concat(opts).join('\t')].concat(o.rows.map(function (r) { return [r.at].concat(r.a).join('\t'); })).join('\n'); }
  function voteClick(e, root, hd) {
    var b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    var opts = (root.dataset.opts || '').split('\n');
    if (b.classList.contains('amv-p') || b.classList.contains('amv-m')) {
      var v = b.parentNode.querySelector('.amv-v'), cur = num(v.textContent, 0) | 0, left = vLeft(root);
      if (b.classList.contains('amv-p')) { if (left <= 0) return; v.textContent = cur + 1; } else { if (cur <= 0) return; v.textContent = cur - 1; }
      b.closest('.amv-o').classList.toggle('amv-on', num(v.textContent, 0) > 0); vLeft(root); return;
    }
    if (b.classList.contains('amv-send')) {
      var mine = vMine(root); if (!mine.some(function (x) { return x > 0; })) return;
      var o = vLoad(root, hd), at = F.stamp(); o.q = opts; o.rows.push({ at: at, a: mine }); if (o.rows.length > 5000) o.rows.splice(0, o.rows.length - 5000);
      var ok = F.save(vKey(root, hd), o);
      Array.prototype.forEach.call(root.querySelectorAll('.amv-v'), function (x) { x.textContent = '0'; }); Array.prototype.forEach.call(root.querySelectorAll('.amv-o.amv-on'), function (r) { r.classList.remove('amv-on'); }); vLeft(root); vRefresh(root, hd);
      if (root.dataset.show !== 'never') vShow(root, true);
      root.classList.add('amv-sent'); setTimeout(function () { root.classList.remove('amv-sent'); }, 1200);
      var url = root.dataset.sheet;
      if (url) { wStatus(root, 'Enviando à planilha…'); F.post(url, { deck: String(hd && hd.deck && hd.deck.id || ''), form: (root.dataset.title || 'Votação').slice(0, 80), title: root.dataset.title || '', at: at, q: opts, a: mine }).then(function () { wStatus(root, ok ? 'Voto registrado aqui e enviado à planilha.' : 'Voto enviado à planilha (sem espaço para guardar aqui).', 'amw-ok'); }).catch(function () { wStatus(root, ok ? 'Voto registrado aqui; sem internet para a planilha.' : 'Não deu para guardar nem enviar.', 'amw-err'); }); }
      else wStatus(root, ok ? 'Voto registrado. Próxima pessoa pode votar.' : 'Não deu para guardar o voto (armazenamento cheio ou bloqueado).', ok ? 'amw-ok' : 'amw-err');
      return;
    }
    if (b.classList.contains('amv-show')) { vShow(root, !root.classList.contains('amv-res')); return; }
    var o2 = vLoad(root, hd);
    if (b.classList.contains('amv-dl')) { if (!o2.rows.length) return; F.download('votos-' + F.slug(root.dataset.title || 'votacao') + '.csv', voteCSV(opts, o2), 'text/csv;charset=utf-8'); wStatus(root, o2.rows.length + ' votos no arquivo CSV.', 'amw-ok'); return; }
    if (b.classList.contains('amv-copy')) { if (!o2.rows.length) return; var okc = function () { wStatus(root, o2.rows.length + ' votos copiados: cole numa planilha.', 'amw-ok'); }, badc = function () { wStatus(root, 'Não deu para copiar: use Baixar CSV.', 'amw-err'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(voteTSV(opts, o2)).then(okc, badc); else badc(); return; }
    if (b.classList.contains('amv-clear')) { if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'Confirmar: apagar?'; clearTimeout(b._t); b._t = setTimeout(function () { b.dataset.arm = '0'; b.textContent = 'Limpar'; }, 4000); return; } clearTimeout(b._t); b.dataset.arm = '0'; b.textContent = 'Limpar'; try { localStorage.removeItem(vKey(root, hd)); } catch (er) { } vRefresh(root, hd); wStatus(root, 'Votos apagados neste dispositivo.', 'amw-ok'); return; }
  }
  /* ---------------- cronômetro ---------------- */
  var RING = 2 * Math.PI * 45;
  function mmss(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  R.FX.timer = {
    name: 'Cronômetro', cat: 'Interativo', w: 360, h: 360, anim: { in: 'zoom' },
    kw: 'cronômetro timer contagem regressiva tempo minutos relógio timebox dinâmica atividade pausa',
    data: { title: 'Tempo da atividade', min: 5, sec: 0, sound: '1', auto: '0' },
    fields: [['title', 'Título'], ['min', 'Minutos (0 a 180)', 'number'], ['sec', 'Segundos (0 a 59)', 'number'], ['sound', 'Bipes ao terminar', 'sel:1=Sim|0=Não'], ['auto', 'Começar sozinho ao abrir o slide', 'sel:0=Não|1=Sim'],
      ['help', 'Na apresentação: <b>Iniciar/Pausar</b>, <b>Reiniciar</b> e <b>±1 min</b>. O anel esvazia com o tempo; ao zerar, o cronômetro pisca e, com o som ligado, toca três bipes. Continua contando se você trocar de slide e voltar.', 'help']],
    tip: 'Um cronômetro por atividade: 5 min para ideias, 2 min para votar, 10 min para a discussão.',
    html: function (d, w, h) {
      var total = Math.max(0, Math.min(180, num(d.min, 5) | 0)) * 60 + Math.max(0, Math.min(59, num(d.sec, 0) | 0)), f = Math.max(10, Math.min(w, h) * .07);
      return '<div class="fx amw amt am-ia" style="font-size:' + CQ(f) + '" data-timer="1" data-total="' + total + '" data-sound="' + (String(d.sound) === '0' ? '0' : '1') + '" data-auto="' + (String(d.auto) === '1' ? '1' : '0') + '">' +
        (d.title ? '<div class="amt-t">' + esc(d.title) + '</div>' : '') +
        '<div class="amt-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="amt-bg" cx="50" cy="50" r="45"/><circle class="amt-fg" cx="50" cy="50" r="45" style="stroke-dasharray:' + RING.toFixed(2) + ';stroke-dashoffset:0"/></svg><b class="amt-d" role="timer" aria-live="off">' + mmss(total) + '</b><span class="amt-end">Tempo esgotado</span></div>' +
        '<div class="amt-b"><button type="button" class="amt-go" aria-label="Iniciar">▶ Iniciar</button><button type="button" class="amt-rs" aria-label="Reiniciar">↺</button><button type="button" class="amt-pm" data-d="-60" aria-label="Menos um minuto">−1 min</button><button type="button" class="amt-pm" data-d="60" aria-label="Mais um minuto">+1 min</button></div></div>';
    }
  };
  /* um estado por cronômetro, guardado no player (hd.amtTimers): {root, total, left, running, t0, iv, done}; some com o player */
  function tOf(root, hd) { var L = hd.amtTimers || (hd.amtTimers = []); for (var i = 0; i < L.length; i++) if (L[i].root === root) return L[i]; var t = { root: root, total: num(root.dataset.total, 300), left: num(root.dataset.total, 300), running: false, t0: 0, iv: 0, done: false }; L.push(t); return t; }
  function tDraw(t) {
    var d = t.root.querySelector('.amt-d'), fg = t.root.querySelector('.amt-fg'), go = t.root.querySelector('.amt-go');
    if (d) d.textContent = mmss(t.left); if (fg) fg.style.strokeDashoffset = (RING * (t.total ? 1 - t.left / t.total : 1)).toFixed(2);
    if (go) { go.textContent = t.running ? '❚❚ Pausar' : (t.left > 0 && t.left < t.total ? '▶ Continuar' : '▶ Iniciar'); go.setAttribute('aria-label', t.running ? 'Pausar' : 'Iniciar'); }
    t.root.classList.toggle('amt-run', t.running); t.root.classList.toggle('amt-over', t.done); t.root.classList.toggle('amt-low', t.left > 0 && t.left <= 10);
  }
  function beep() {
    try { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; var ac = new AC(); [0, .35, .7].forEach(function (at) { var o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(.0001, ac.currentTime + at); g.gain.exponentialRampToValueAtTime(.25, ac.currentTime + at + .02); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + at + .28); o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + at); o.stop(ac.currentTime + at + .3); }); setTimeout(function () { try { ac.close(); } catch (e) { } }, 1500); } catch (e) { }
  }
  function tTick(t) {
    if (!t.running) return; var now = performance.now(), el = (now - t.t0) / 1000; t.t0 = now; t.left = Math.max(0, t.left - el);
    if (t.left <= 0) { t.left = 0; t.running = false; t.done = true; clearInterval(t.iv); t.iv = 0; if (t.root.dataset.sound !== '0') beep(); }
    tDraw(t);
  }
  function tStart(t) { if (t.running || t.left <= 0) return; t.running = true; t.done = false; t.t0 = performance.now(); clearInterval(t.iv); t.iv = setInterval(function () { tTick(t); }, 250); tDraw(t); }
  function tPause(t) { if (!t.running) return; tTick(t); t.running = false; clearInterval(t.iv); t.iv = 0; tDraw(t); }
  function tReset(t) { t.running = false; clearInterval(t.iv); t.iv = 0; t.left = t.total; t.done = false; tDraw(t); }
  function timerClick(e, root, hd) {
    var b = e.target.closest('button'); if (!b || !root.contains(b)) return; var t = tOf(root, hd);
    if (b.classList.contains('amt-go')) { if (t.running) tPause(t); else { if (t.left <= 0) t.left = t.total; tStart(t); } return; }
    if (b.classList.contains('amt-rs')) { tReset(t); return; }
    if (b.classList.contains('amt-pm')) { var dd = num(b.dataset.d, 60); t.total = Math.max(0, Math.min(180 * 60, t.total + dd)); t.left = Math.max(0, Math.min(t.total, t.left + dd)); if (t.left > 0) t.done = false; tDraw(t); return; }
  }
  /* ---------------- player ---------------- */
  function armAll(deckEl, hd) {
    Array.prototype.forEach.call(deckEl.querySelectorAll('.amb'), function (root) { if (root.dataset.live === '1') return; root.dataset.live = '1'; bRender(root, hd); });
    Array.prototype.forEach.call(deckEl.querySelectorAll('.amv'), function (root) { if (root.dataset.live === '1') return; root.dataset.live = '1'; vRefresh(root, hd); vLeft(root); });
    Array.prototype.forEach.call(deckEl.querySelectorAll('.amt'), function (root) { if (root.dataset.live === '1') return; root.dataset.live = '1'; var t = tOf(root, hd); tDraw(t); });
  }
  /* cronômetro “começar sozinho”: arranca uma vez quando o slide dele entra (a classe am-in do palco), sem usar hooks.show (só da navegação) */
  function autoStart(st, hd) { Array.prototype.forEach.call(st.querySelectorAll('.amt[data-auto="1"]'), function (root) { var t = tOf(root, hd); if (!t.running && t.left === t.total && !t.done) tStart(t); }); }
  R.hooks.player.push(function (hd) {
    var deckEl = hd.deckEl; if (!deckEl) return;
    var click = function (e) { var r = e.target.closest ? e.target.closest('.amw') : null; if (!r) return; if (r.classList.contains('amb')) boardClick(e, r, hd); else if (r.classList.contains('amv')) voteClick(e, r, hd); else if (r.classList.contains('amt')) timerClick(e, r, hd); };
    var input = function (e) { var r = e.target.closest ? e.target.closest('.amb') : null; if (r) boardInput(e, r, hd); };
    var down = function (e) { var r = e.target.closest ? e.target.closest('.amb') : null; if (r) boardDown(e, r, hd); };
    var paste = function (e) { var box = e.target.closest ? e.target.closest('.amb-t') : null; if (!box) return; e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text'); if (t) document.execCommand('insertText', false, t.slice(0, 400)); };
    deckEl.addEventListener('click', click); deckEl.addEventListener('input', input); deckEl.addEventListener('pointerdown', down); deckEl.addEventListener('paste', paste);
    window.addEventListener('pointermove', boardMove); window.addEventListener('pointerup', boardUp); window.addEventListener('pointercancel', boardUp);
    armAll(deckEl, hd);
    var mo = null;
    if (window.MutationObserver) { mo = new MutationObserver(function (recs) { recs.forEach(function (r) { var st = r.target; if (st && st.classList && st.classList.contains('am-stage') && st.classList.contains('am-in') && !(r.oldValue && /\bam-in\b/.test(r.oldValue))) autoStart(st, hd); }); }); mo.observe(deckEl, { attributes: true, subtree: true, attributeFilter: ['class'], attributeOldValue: true }); }
    Array.prototype.forEach.call(deckEl.querySelectorAll('.am-stage.am-in'), function (st) { autoStart(st, hd); });
    hd.onDestroy(function () {
      deckEl.removeEventListener('click', click); deckEl.removeEventListener('input', input); deckEl.removeEventListener('pointerdown', down); deckEl.removeEventListener('paste', paste);
      window.removeEventListener('pointermove', boardMove); window.removeEventListener('pointerup', boardUp); window.removeEventListener('pointercancel', boardUp);
      if (mo) mo.disconnect(); (hd.amtTimers || []).forEach(function (t) { clearInterval(t.iv); }); hd.amtTimers = []; drag = null;
    });
  });
  R.workshop = { COLORS: COLORS, notes: cleanNotes, boardCSV: boardCSV, voteCSV: voteCSV, mmss: mmss };
})(window.AMRT);
