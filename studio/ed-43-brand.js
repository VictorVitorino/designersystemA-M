/* ===== ed-43-brand.js — “Kit de marca” (S29): cores e fonte da apresentação (só no editor; não vai para o arquivo exportado) =====
   Caixa (Arquivo › Kit de marca…, botão “Kit de marca…” em Fundo): nome do kit · cores da marca (trocar/adicionar pelo seletor
   “Mais cores…”, colar códigos, extrair de um logotipo) · cores dos componentes (principal/destaque; “aplicar a todos”) · fonte
   (“aplicar a todos os textos”) · kits guardados no navegador (localStorage 'amStudio.brandKits') · baixar/abrir kit .json.
   O kit vive em deck.brand (editor.js: safeBrand, swList, kitOpt, withBrandFont, mkFx+pal, fontLink/ensureFonts); cada mudança
   passa por AMStudio.brand.set/applyFont/applyPal = um passo de desfazer. As amostras do painel e “Mais cores…” leem deck.brand na
   hora, então a caixa só precisa gravar. Não usa #modal (ARCH regra 15): teclas ficam na caixa (Esc fecha, Tab circula); com o
   seletor de cores aberto por cima, Esc/Tab são dele.
   API: window.AMBrand = { open(opener), close(), isOpen(), parseColors(text), colorsFromImage(img, n), kits(), saveKit(kit), removeKit(name), toJSON(), fromJSON(text) } */
(function () {
  'use strict';
  function S() { return window.AMStudio; }
  function $(q, r) { return (r || document).querySelector(q); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var KITS = 'amStudio.brandKits', HEX = /^#[0-9A-F]{6}$/, MAXC = 12, DEF = { p: '#002A46', a: '#F78C16' };
  var dlg = null, st = null;
  function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }
  var IPAL = '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>';
  function toast(m) { var A = S(); if (A && A.toast) A.toast(m); }
  function norm(v) {
    v = String(v == null ? '' : v).replace(/\s+/g, '');
    var m = /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,[\d.]+%?)?\)$/i.exec(v);
    if (m && +m[1] < 256 && +m[2] < 256 && +m[3] < 256) v = '#' + [m[1], m[2], m[3]].map(function (x) { return (+x < 16 ? '0' : '') + (+x).toString(16); }).join('');
    if (v && v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
  }
  /* “#1F66A8, f2c94c; rgb(0,42,70) #abc” → ['#1F66A8', '#F2C94C', '#002A46', '#AABBCC'] (únicas, na ordem em que aparecem);
     só códigos inteiros valem (6 dígitos, com ou sem #; 3 dígitos só com #): “nada”, “12345” e palavras ficam de fora */
  function parseColors(text) {
    var out = [], s = String(text == null ? '' : text).replace(/rgba?\([^)]*\)/gi, function (m) { return ' ' + (norm(m) || '') + ' '; });
    s.split(/[\s,;|]+/).forEach(function (t) {
      t = t.replace(/^[^#0-9a-f]+/i, '').replace(/[^0-9a-f]+$/i, '');
      if (!/^#?[0-9a-f]{6}$/i.test(t) && !/^#[0-9a-f]{3}$/i.test(t)) return;
      var c = norm(t); if (c && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }
  /* cores dominantes de um logotipo: amostra 64×64 sem suavizar (nada de tons misturados nas bordas), caixas de 16 níveis por canal,
     mais frequentes primeiro (≥ 1 % da imagem), sem o branco do fundo e sem tons quase iguais (distância RGB < 90); n cores no máximo */
  function colorsFromImage(img, n) {
    n = n || 5; var s = 64, cv = document.createElement('canvas'), g, d; cv.width = s; cv.height = s; g = cv.getContext('2d');
    try { g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, s, s); d = g.getImageData(0, 0, s, s).data; } catch (e) { return []; }
    var bins = {}, i;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      var r = d[i], gg = d[i + 1], b = d[i + 2], k = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4), o = bins[k] || (bins[k] = { n: 0, r: 0, g: 0, b: 0 });
      o.n++; o.r += r; o.g += gg; o.b += b;
    }
    var list = Object.keys(bins).map(function (k) { var o = bins[k]; return { n: o.n, c: [Math.round(o.r / o.n), Math.round(o.g / o.n), Math.round(o.b / o.n)] }; }).sort(function (a, b) { return b.n - a.n; });
    var out = [], tot = s * s;
    list.forEach(function (o) {
      if (out.length >= n || o.n < tot * .01) return; var c = o.c;
      if (Math.min(c[0], c[1], c[2]) > 235) return; /* fundo branco / quase branco */
      if (out.some(function (x) { return Math.abs(x[0] - c[0]) + Math.abs(x[1] - c[1]) + Math.abs(x[2] - c[2]) < 90; })) return;
      out.push(c);
    });
    return out.map(function (c) { return '#' + c.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); });
  }
  /* ---------- kits guardados no navegador ---------- */
  function kits() { var a; try { a = JSON.parse(localStorage.getItem(KITS) || '[]'); } catch (e) { a = []; } var A = S(); return (Array.isArray(a) ? a : []).map(function (k) { var o = A.brand.safe(k); if (o && k && typeof k.at === 'number') o.at = k.at; return o; }).filter(function (k) { return k && k.name; }); }
  function writeKits(list) { try { localStorage.setItem(KITS, JSON.stringify(list.slice(0, 20))); return true; } catch (e) { return false; } }
  function saveKit(kit) { var A = S(), k = A.brand.safe(kit); if (!k || !k.name) return false; k.at = Date.now(); var list = kits().filter(function (x) { return x.name !== k.name; }); list.unshift(k); return writeKits(list); }
  function removeKit(name) { var list = kits(), n = list.length; list = list.filter(function (x) { return x.name !== name; }); return list.length < n && writeKits(list); }
  function toJSON(b) { var A = S(), k = A.brand.safe(b || A.brand.get()); return JSON.stringify(Object.assign({ app: 'Canteiro', kind: 'brand-kit', v: 1 }, k || {}), null, 2); }
  function fromJSON(text) { var A = S(), o; try { o = JSON.parse(String(text)); } catch (e) { return null; } if (o && o.brand && typeof o.brand === 'object') o = o.brand; return A.brand.safe(o); }
  /* ---------- caixa ---------- */
  function cur() { var A = S(), b = A.brand.get(); return b ? JSON.parse(JSON.stringify(b)) : {}; }
  function put(b, msg) { var A = S(); A.brand.set(b, msg); render(); }
  function counts() {
    var A = S(), RT = window.AMRT, t = 0, c = 0;
    A.deck.slides.forEach(function (s) { s.els.forEach(function (e) {
      if (e.type === 'text' || e.type === 'shape') t++;
      else if (e.type === 'fx') { var F = RT && RT.FX[e.kind]; if (F && F.fields && F.fields.some(function (f) { return f[0] === 'font'; })) t++; if (A.brand.palOk(e)) c++; } /* componentes com campo de fonte (ex.: frase de impacto) contam como texto */
    }); });
    return { texts: t, comps: c };
  }
  function build() {
    dlg = document.createElement('div'); dlg.id = 'bkDlg'; dlg.className = 'xp bk'; dlg.hidden = true;
    dlg.innerHTML = '<div class="xp-bk" data-x="bk"></div>' +
      '<form class="xp-box bk-box" role="dialog" aria-modal="true" aria-labelledby="bkT" aria-describedby="bkSum" novalidate>' +
      '<header class="xp-h"><div class="xp-ic">' + svg(IPAL) + '</div><div class="xp-hd"><div class="xp-ey">Apresentação</div><h3 id="bkT">Kit de marca</h3></div>' +
      '<button type="button" class="xp-x" data-x="close" title="Fechar (Esc)" aria-label="Fechar">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></header>' +
      '<div class="xp-b">' +
      '<p class="xp-sum bk-sum" id="bkSum">As <b>cores do kit</b> aparecem primeiro nas amostras e em “Mais cores…”. A <b>fonte</b> e as <b>cores dos componentes</b> valem para o que você inserir a partir de agora e podem ser aplicadas a tudo de uma vez. O kit vai junto no arquivo salvo.</p>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Nome do kit</legend><div class="bk-row"><input type="text" id="bkName" maxlength="60" placeholder="ex.: Cliente XPTO" aria-label="Nome do kit"><button type="button" class="xp-btn sm" data-x="kitdel" id="bkDel" title="Tira o kit desta apresentação (os elementos ficam como estão)">Remover kit</button></div></fieldset>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Cores da marca <span id="bkCn"></span></legend><div class="bk-sw" id="bkSw"></div>' +
      '<div class="bk-row"><input type="text" id="bkPaste" placeholder="Colar códigos: #1F66A8, #F2C94C, rgb(0,42,70)…" aria-label="Códigos de cor para adicionar"><button type="button" class="xp-btn sm" data-x="paste">Adicionar</button><button type="button" class="xp-btn sm" data-x="logo" title="Escolhe uma imagem (logotipo) e tira dela as cores mais presentes">Do logotipo…</button></div>' +
      '<p class="note bk-err" id="bkErr" hidden></p></fieldset>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Cores dos componentes</legend><div class="bk-pal">' +
      '<label><span>Cor principal <small>(no lugar do azul-marinho)</small></span><button type="button" class="bk-pb" data-x="pal" data-k="p" id="bkP" aria-haspopup="dialog"><i></i><span></span></button></label>' +
      '<label><span>Cor de destaque <small>(no lugar do laranja)</small></span><button type="button" class="bk-pb" data-x="pal" data-k="a" id="bkA" aria-haspopup="dialog"><i></i><span></span></button></label></div>' +
      '<div class="bk-row"><button type="button" class="xp-btn sm" data-x="palall" id="bkPalAll">Aplicar a todos os componentes</button><button type="button" class="xp-btn sm" data-x="palnone" id="bkPalNone">Restaurar cores A&amp;M em todos</button></div>' +
      '<p class="note">Gráficos, SmartArt e modelos novos já nascem com estas cores; os que existem mudam com “Aplicar a todos”. Cada azul do modelo vira um tom da cor principal (mesma claridade, textos legíveis); o laranja vira a cor de destaque.</p></fieldset>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Fonte</legend><div class="bk-row"><select id="bkFont" aria-label="Fonte do kit"></select><button type="button" class="xp-btn sm" data-x="fontall" id="bkFontAll">Aplicar a todos os textos</button></div>' +
      '<p class="note" id="bkFontNote"></p></fieldset>' +
      '<fieldset class="xp-sec"><legend class="xp-lg">Guardar e reutilizar</legend>' +
      '<div class="bk-row"><select id="bkKits" aria-label="Kits guardados neste navegador"></select><button type="button" class="xp-btn sm" data-x="kituse" id="bkUse">Usar</button><button type="button" class="xp-btn sm" data-x="kitrm" id="bkRm">Apagar</button></div>' +
      '<div class="bk-row"><button type="button" class="xp-btn sm" data-x="kitsave" id="bkSave">Guardar este kit no navegador</button><button type="button" class="xp-btn sm" data-x="dl" id="bkDl">Baixar kit (.json)</button><button type="button" class="xp-btn sm" data-x="up">Abrir kit (.json)…</button></div>' +
      '<p class="note">O kit guardado fica só neste navegador; o arquivo .json serve para passar o kit a colegas (Abrir kit…).</p></fieldset>' +
      '</div>' +
      '<footer class="xp-f"><span class="bk-hint">Cada mudança é um passo de desfazer (Ctrl+Z) depois de fechar.</span><button type="submit" class="xp-btn pri" id="bkOk">Concluir</button></footer></form>' +
      '<input type="file" id="bkFile" accept=".json,application/json" hidden>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', onClick);
    $('form', dlg).addEventListener('submit', function (e) { e.preventDefault(); close(); });
    $('#bkName').addEventListener('change', function () { var b = cur(), v = this.value.trim(); if (v) b.name = v; else delete b.name; put(b); });
    $('#bkFont').addEventListener('change', function () { var b = cur(), v = this.value; if (v) b.font = v; else delete b.font; put(b, v ? 'Fonte do kit: ' + v + ' · vale para os textos novos' : 'Fonte do kit removida: textos novos usam as fontes do Canteiro'); });
    $('#bkKits').addEventListener('change', function () { $('#bkUse').disabled = $('#bkRm').disabled = !this.value; });
    $('#bkFile').addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      var r = new FileReader(); r.addEventListener('load', function () { var k = fromJSON(r.result); if (!k) { showErr('Este arquivo não é um kit de marca do Canteiro (.json).'); return; } put(k, 'Kit “' + (k.name || f.name) + '” aberto · Ctrl+Z desfaz'); }); r.addEventListener('error', function () { showErr('Não deu para ler o arquivo.'); }); r.readAsText(f);
    });
  }
  function showErr(m) { var e = $('#bkErr'); e.textContent = m; e.hidden = !m; }
  function render() {
    if (!isOpen()) return;
    var A = S(), b = cur(), cs = b.colors || [], n = counts(), pal = b.pal || {};
    var nm = $('#bkName'); if (document.activeElement !== nm) nm.value = b.name || '';
    $('#bkDel').disabled = !A.brand.get();
    $('#bkCn').textContent = cs.length ? '(' + cs.length + ' de ' + MAXC + ')' : '';
    $('#bkSw').innerHTML = cs.map(function (c, i) { return '<span class="bk-c"><button type="button" class="bk-s" data-x="col" data-i="' + i + '" style="background:' + c + '" title="' + c + ' · clique para trocar" aria-label="Cor ' + (i + 1) + ' ' + c + ', trocar" aria-haspopup="dialog"></button><button type="button" class="bk-x" data-x="coldel" data-i="' + i + '" title="Tirar ' + c + '" aria-label="Tirar a cor ' + c + '">×</button></span>'; }).join('') +
      (cs.length < MAXC ? '<button type="button" class="bk-add" data-x="coladd" title="Adicionar uma cor pelo seletor" aria-label="Adicionar cor" aria-haspopup="dialog">+</button>' : '') +
      (cs.length ? '' : '<span class="bk-empty">Nenhuma cor ainda: use +, cole os códigos ou tire do logotipo.</span>');
    ['p', 'a'].forEach(function (k) { var bt = $('#bk' + k.toUpperCase()), v = pal[k] || null; $('i', bt).style.background = v || DEF[k]; $('span', bt).textContent = v ? v : 'A&M (sem troca)'; bt.dataset.cv = v || DEF[k]; });
    $('#bkPalAll').disabled = !(pal.p || pal.a) || !n.comps; $('#bkPalAll').textContent = 'Aplicar a todos os componentes' + (n.comps ? ' (' + n.comps + ')' : '');
    $('#bkPalNone').disabled = !A.deck.slides.some(function (s) { return s.els.some(function (e) { return e.pal && A.brand.palOk(e); }); });
    var fs = $('#bkFont'), opts = A.brand.fonts(b.font, true);
    fs.innerHTML = '<option value="">Fontes do Canteiro (Roboto e Inter)</option>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === b.font ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
    $('#bkFontAll').disabled = !b.font || !n.texts; $('#bkFontAll').textContent = 'Aplicar a todos os textos' + (n.texts ? ' (' + n.texts + ')' : '');
    $('#bkFontNote').textContent = b.font ? (A.brand.GFONTS[b.font] ? b.font + ' vem do Google Fonts: carrega com internet, vai embutida no PDF e no PowerPoint “Idêntico”; no “Editável” o PowerPoint usa a fonte instalada (ou a mais parecida).' : A.brand.SYS_FONTS.indexOf(b.font) >= 0 ? b.font + ' é uma fonte do computador: aparece igual onde ela está instalada; sem ela, o navegador usa a reserva do mesmo tipo.' : b.font + ' veio do arquivo importado: usa a fonte instalada no computador de quem vê.') : 'Sem fonte no kit, os textos novos usam Roboto (títulos) e Inter (textos), como no A&M.';
    var ks = kits(), sel = $('#bkKits'), was = sel.value;
    sel.innerHTML = '<option value="">' + (ks.length ? 'Kits guardados neste navegador…' : 'Nenhum kit guardado neste navegador') + '</option>' + ks.map(function (k) { return '<option value="' + esc(k.name) + '"' + (k.name === was ? ' selected' : '') + '>' + esc(k.name) + ' · ' + (k.colors ? k.colors.length + (k.colors.length === 1 ? ' cor' : ' cores') : 'sem cores') + (k.font ? ' · ' + k.font : '') + '</option>'; }).join('');
    sel.disabled = !ks.length; $('#bkUse').disabled = $('#bkRm').disabled = !sel.value;
    $('#bkSave').disabled = !A.brand.get(); $('#bkDl').disabled = !A.brand.get();
  }
  function addColors(list, src) {
    var b = cur(), cs = (b.colors || []).slice(), add = 0, full = false;
    list.forEach(function (c) { c = norm(c); if (!c || cs.indexOf(c) >= 0) return; if (cs.length >= MAXC) { full = true; return; } cs.push(c); add++; });
    if (!add) { showErr(full ? 'O kit já tem ' + MAXC + ' cores: tire alguma antes de adicionar.' : list.length ? 'Essas cores já estão no kit.' : 'Nenhum código de cor reconhecido. Use #RRGGBB (ex.: #1F66A8).'); return 0; }
    showErr(''); b.colors = cs; put(b, add + (add === 1 ? ' cor adicionada' : ' cores adicionadas') + (src ? ' ' + src : '') + (full ? ' · o kit ficou cheio (' + MAXC + ')' : '') + ' · Ctrl+Z desfaz'); return add;
  }
  function addPasted() { var inp = $('#bkPaste'), n = addColors(parseColors(inp.value), ''); if (n) inp.value = ''; }
  function pickColor(anchor, value, title, onPick) {
    if (!window.AMColorPop) return;
    var A = S();
    window.AMColorPop.open(anchor, { value: value, title: title, keyboard: true, brand: A.brand.SW, onPick: function (c, viaKey) { onPick(c); if (viaKey) setTimeout(function () { var a = $('#' + anchor.id) || anchor; if (a && a.isConnected) a.focus(); }, 0); }, onClose: function (viaKey) { if (viaKey && anchor.isConnected) anchor.focus(); } });
  }
  function onClick(e) {
    var x = e.target.closest('[data-x]'); if (!x || !isOpen()) return;
    var k = x.dataset.x, A = S(), b;
    if (k === 'bk' || k === 'close') { close(); return; }
    if (k === 'kitdel') { if (!A.brand.get()) return; put(null, 'Kit de marca removido desta apresentação · Ctrl+Z desfaz'); return; }
    if (k === 'col') { var i = +x.dataset.i; b = cur(); if (!b.colors || !b.colors[i]) return; pickColor(x, b.colors[i], 'Cor da marca ' + (i + 1), function (c) { var nb = cur(); if (!nb.colors || !nb.colors[i]) return; if (nb.colors.indexOf(c) >= 0 && nb.colors[i] !== c) { showErr('Essa cor já está no kit.'); return; } nb.colors[i] = c; showErr(''); put(nb); }); return; }
    if (k === 'coldel') { b = cur(); var j = +x.dataset.i; if (!b.colors || !b.colors[j]) return; var gone = b.colors.splice(j, 1)[0]; if (!b.colors.length) delete b.colors; showErr(''); put(b, 'Cor ' + gone + ' tirada do kit · Ctrl+Z desfaz'); return; }
    if (k === 'coladd') { pickColor(x, '', 'Nova cor da marca', function (c) { addColors([c], ''); }); return; }
    if (k === 'paste') { addPasted(); return; }
    if (k === 'logo') { if (!A.pickImage) return; A.pickImage(function (src) { var im = new Image(); im.addEventListener('load', function () { var cs = colorsFromImage(im, 5); if (!cs.length) { showErr('Não achei cores no logotipo (imagem toda branca ou transparente).'); return; } addColors(cs, 'do logotipo'); }); im.addEventListener('error', function () { showErr('Não deu para ler a imagem.'); }); im.src = src; }); return; }
    if (k === 'pal') { var pk = x.dataset.k; b = cur(); pickColor(x, (b.pal && b.pal[pk]) || DEF[pk], pk === 'p' ? 'Cor principal dos componentes' : 'Cor de destaque dos componentes', function (c) { var nb = cur(); nb.pal = nb.pal || {}; if (c === DEF[pk]) delete nb.pal[pk]; else nb.pal[pk] = c; if (!nb.pal.p && !nb.pal.a) delete nb.pal; put(nb, 'Componentes novos usam ' + (pk === 'p' ? 'a cor principal ' : 'a cor de destaque ') + (c === DEF[pk] ? 'A&M' : c)); }); return; }
    if (k === 'palall') { b = cur(); if (!b.pal) return; var n1 = A.brand.applyPal(b.pal); toast(n1 ? n1 + (n1 === 1 ? ' componente recebeu' : ' componentes receberam') + ' as cores do kit · Ctrl+Z desfaz' : 'Todos os componentes já estão com as cores do kit'); render(); return; }
    if (k === 'palnone') { var n2 = A.brand.applyPal(null); toast(n2 ? 'Cores A&M restauradas em ' + n2 + (n2 === 1 ? ' componente' : ' componentes') + ' · Ctrl+Z desfaz' : 'Nenhum componente com cores próprias'); render(); return; }
    if (k === 'fontall') { b = cur(); if (!b.font) return; var n3 = A.brand.applyFont(b.font); toast(n3 ? n3 + (n3 === 1 ? ' texto passou' : ' textos passaram') + ' para ' + b.font + ' · Ctrl+Z desfaz' : 'Todos os textos já usam ' + b.font); render(); return; }
    if (k === 'kitsave') { b = cur(); if (!A.brand.get()) return; if (!b.name) { b.name = 'Kit ' + new Date().toLocaleDateString('pt-BR'); put(b); } if (saveKit(b)) { toast('Kit “' + b.name + '” guardado neste navegador'); render(); $('#bkKits').value = b.name; $('#bkUse').disabled = $('#bkRm').disabled = false; } else toast('Não deu para guardar o kit neste navegador (armazenamento cheio ou bloqueado)'); return; }
    if (k === 'kituse') { var nmU = $('#bkKits').value, kU = kits().filter(function (q) { return q.name === nmU; })[0]; if (!kU) return; delete kU.at; put(kU, 'Kit “' + kU.name + '” aplicado · Ctrl+Z desfaz'); return; }
    if (k === 'kitrm') { var nmR = $('#bkKits').value; if (!nmR) return; if (A.confirmBox) A.confirmBox({ title: 'Apagar o kit “' + nmR + '”?', msg: 'Sai da lista deste navegador. A apresentação aberta não muda.', ok: 'Apagar', icon: 'del' }, function () { removeKit(nmR); toast('Kit “' + nmR + '” apagado'); render(); }); else { removeKit(nmR); render(); } return; }
    if (k === 'dl') { b = cur(); if (!A.brand.get()) return; A.download((A.slug ? A.slug(b.name || A.deck.title || 'kit') : 'kit') + '-kit-de-marca.json', toJSON(b), 'application/json;charset=utf-8'); toast('Kit baixado (.json)'); return; }
    if (k === 'up') { $('#bkFile').click(); return; }
  }
  function focusables() { return [].slice.call(dlg.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null && x.tabIndex >= 0; }); }
  function onKey(e) {
    if (!isOpen()) return;
    if (document.querySelector('.cpop')) return; /* seletor de cores aberto por cima: Esc, Tab e setas são dele */
    if ($('#modal.open') || $('.mdl-a')) { if (e.key === 'Escape' || e.key === 'Enter') return; } /* confirmação A&M (apagar kit) por cima */
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key === 'Tab') { var f = focusables(); if (!f.length) return; var i = f.indexOf(document.activeElement); e.preventDefault(); e.stopImmediatePropagation(); (f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length] || f[0]).focus(); return; }
    var inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && dlg.contains(e.target);
    if (e.key === 'Enter' && inField && e.target.tagName === 'INPUT') { /* Enter num campo: não fecha a caixa (submit); nos códigos adiciona, no nome grava */
      e.preventDefault(); e.stopImmediatePropagation(); if (e.target.id === 'bkPaste') addPasted(); else if (e.target.id === 'bkName') e.target.blur(); return;
    }
    if (e.key === 'F1' || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^[sodpzy]$/i.test(e.key) && !inField)) e.preventDefault();
    e.stopImmediatePropagation();
  }
  function isOpen() { return !!(dlg && !dlg.hidden); }
  function open(opener) {
    var A = S(); if (!A || !A.brand) return;
    if (!dlg) build();
    if (A.closeMenus) A.closeMenus();
    if (window.AMExport) { if (window.AMExport.isOpen && window.AMExport.isOpen()) window.AMExport.closeDialog(); if (window.AMExport.pptxDialog && window.AMExport.pptxDialog.isOpen()) window.AMExport.pptxDialog.close(); }
    if (window.AMImport && window.AMImport.isOpen && window.AMImport.isOpen()) window.AMImport.close();
    var ae = document.activeElement;
    st = { prev: opener || (ae && ae !== document.body ? ae : null) };
    showErr(''); $('#bkPaste').value = '';
    dlg.hidden = false; document.documentElement.classList.add('xp-open');
    addEventListener('keydown', onKey, true);
    render();
    setTimeout(function () { if (isOpen()) $('#bkName').focus(); }, 30);
  }
  function close() {
    if (!isOpen()) return;
    if (window.AMColorPop && document.querySelector('.cpop')) window.AMColorPop.close();
    dlg.hidden = true; document.documentElement.classList.remove('xp-open');
    removeEventListener('keydown', onKey, true);
    var p = st && st.prev; st = null;
    if (p && p.isConnected && p.focus) p.focus();
  }
  window.AMBrand = { open: open, close: close, isOpen: isOpen, parseColors: parseColors, colorsFromImage: colorsFromImage, kits: kits, saveKit: saveKit, removeKit: removeKit, toJSON: toJSON, fromJSON: fromJSON, render: render };
})();
