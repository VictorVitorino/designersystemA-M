/* ===== CANTEIRO · capa do Acervo de Apresentações A&M (window.AMCover) ===== */
(function () {
  'use strict';
  /* inicia quando o editor (window.AMStudio) já existe, em qualquer posição em que o script for injetado */
  function boot() {
    if (boot.done) return; boot.done = true;
    var cover = document.getElementById('cover'), S = window.AMStudio, RT = window.AMRT;
    if (!cover) return;
    var skip = /[?&]nocover(?:[=&]|$)/.test(location.search);
    var $ = function (s, el) { return (el || cover).querySelector(s); };
    var $$ = function (s, el) { return Array.prototype.slice.call((el || cover).querySelectorAll(s)); };
    var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var st = { open: false, view: 'home', fromEditor: false, lastFocus: null, pendingFile: false, confirm: null, ct: 0, et: 0, lastOpt: null, tplCur: 0, returnTo: null };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    /* ---------------- ponte com o editor (com alternativas caso a API mude) ---------------- */
    function has(n) { return !!(S && typeof S[n] === 'function'); }
    function deckNow() { return S && S.deck; }
    function isEmpty() { if (has('isEmpty')) return S.isEmpty(); var d = deckNow(); return !d || !d.slides || (d.slides.length === 1 && !(d.slides[0].els || []).length); }
    function getDraft() {
      var d = null;
      if (has('getDraft')) d = S.getDraft(); else try { d = JSON.parse(localStorage.getItem('amStudio.draft')); } catch (e) { d = null; }
      return d && Array.isArray(d.slides) && d.slides.some(function (s) { return s && s.els && s.els.length; }) ? d : null;
    }
    function hideBanner() { if (has('hideDraftBanner')) S.hideDraftBanner(); else { var b = document.getElementById('banner'); if (b) b.classList.remove('open'); } }
    function blankDeck() { return has('newDeck') ? S.newDeck() : { v: 1, app: 'AM Studio', title: 'Nova apresentação', slides: [S.mk.slide('blank-light')] }; }
    /* noHist: a obra veio do próprio acervo (Minhas obras) — abrir não conta como edição */
    function load(d, msg, noHist) { if (has('loadDeck')) S.loadDeck(d, msg, false, !!noHist); }
    /* Minhas obras (history.js): opcional — sem ele a capa funciona como antes e a vista mostra "indisponível" */
    function HH() { var h = window.AMHist; return h && typeof h.list === 'function' ? h : null; }
    function obraRecent() { var h = HH(); return h && h.available() ? h.recent() : null; }
    function pickFile() { var f = document.getElementById('fOpen'); if (f) f.value = ''; if (has('pickFile')) S.pickFile(); else if (f) f.click(); }
    function openModels() { if (has('openDrawer')) S.openDrawer(true, 'models'); else { var b = document.getElementById('bModels'); if (b) b.click(); } }
    /* aberta a partir do editor, a capa sempre pode ser fechada (Esc, "Voltar à obra") e devolve a obra como estava */
    function canDismiss() { return st.fromEditor; }
    /* opção 3: voltar à obra atual (com conteúdo), retomar o rascunho salvo ou, sem nada, voltar à obra em branco */
    function mode3() { if (canDismiss() && !isEmpty()) return 'resume'; if (getDraft()) return 'draft'; if (obraRecent()) return 'obra'; return canDismiss() ? 'resume' : 'none'; }
    function modalUp() { var m = document.getElementById('modal'); return !!(m && m.classList.contains('open')); }
    function readDeck(file, cb) {
      var r = new FileReader();
      r.onload = function () {
        var txt = String(r.result), d = null;
        try { if (/am-deck-data/.test(txt)) d = JSON.parse(new DOMParser().parseFromString(txt, 'text/html').getElementById('am-deck-data').textContent); else d = JSON.parse(txt); } catch (e) { d = null; }
        cb(!!(d && Array.isArray(d.slides) && d.slides.length));
      };
      r.onerror = function () { cb(false); };
      r.readAsText(file);
    }

    /* ---------------- cena: prancha, grua e peças ---------------- */
    var SLOTS = [
      { k: 'gauge', n: 'medidor', x: 76, y: 384, w: 76, h: 52 },
      { k: 'timeline', n: 'cronograma', x: 160, y: 384, w: 212, h: 52 },
      { k: 'bars', n: 'barras', x: 76, y: 306, w: 108, h: 70 },
      { k: 'raci', n: 'RACI', x: 192, y: 306, w: 108, h: 70 },
      { k: 'kpi', n: 'KPI', x: 308, y: 306, w: 64, h: 70 }
    ];
    var CARRY = 124, T0 = 500, P = 1550, HOLD = 1250, FADE = 450, CYC = T0 + SLOTS.length * P + HOLD + FADE;
    function piece(k, w, h) {
      var o = '<rect class="sc-tile" width="' + w + '" height="' + h + '" rx="3"/>';
      if (k === 'bars') {
        o += '<rect x="8" y="8" width="38" height="4" rx="1" fill="#002A46" opacity=".75"/>';
        [22, 34, 27, 44, 36].forEach(function (v, i) { o += '<rect x="' + (14 + i * 18) + '" y="' + (61 - v) + '" width="11" height="' + v + '" rx="1" fill="' + (i === 3 ? '#F78C16' : '#002A46') + '"/>'; });
        o += '<path d="M8 61.5H100" stroke="#A3B8D6" stroke-width="1"/>';
      } else if (k === 'raci') {
        var C = { R: '#002A46', A: '#F78C16', C: '#7EA1C3', I: '#C9D6E8' }, M = ['ARCI', 'RACI', 'CRAI', 'ICRA'];
        [0, 1, 2, 3].forEach(function (c) { o += '<rect x="' + (44 + c * 15) + '" y="7" width="11" height="4" rx="1" fill="#43698F"/>'; });
        M.forEach(function (row, r) { o += '<rect x="8" y="' + (18 + r * 12.5) + '" width="28" height="4" rx="1" fill="#7EA1C3"/>'; row.split('').forEach(function (L, c) { o += '<rect x="' + (44 + c * 15) + '" y="' + (15.5 + r * 12.5) + '" width="11" height="9" rx="2" fill="' + C[L] + '"/>'; }); });
      } else if (k === 'kpi') {
        o = '<rect width="' + w + '" height="' + h + '" rx="3" fill="#002A46" stroke="#7EA1C3" stroke-width=".8"/><rect x="8" y="9" width="14" height="3" fill="#F78C16"/><text x="7" y="40" class="sc-kpi">72%</text><rect x="8" y="48" width="34" height="3" rx="1" fill="#7EA1C3"/><rect x="8" y="57" width="48" height="3" rx="1.5" fill="rgba(255,255,255,.2)"/><rect x="8" y="57" width="34" height="3" rx="1.5" fill="#F78C16"/>';
      } else if (k === 'gauge') {
        o += '<path d="M14 42A24 24 0 0 1 62 42" fill="none" stroke="#C9D6E8" stroke-width="6" stroke-linecap="round"/><path d="M14 42A24 24 0 0 1 62 42" pathLength="100" stroke-dasharray="70 100" fill="none" stroke="#002A46" stroke-width="6" stroke-linecap="round"/><path d="M38 42L49.8 25.8" stroke="#F78C16" stroke-width="2" stroke-linecap="round"/><circle cx="38" cy="42" r="3.2" fill="#002A46"/>';
      } else if (k === 'timeline') {
        var X = [22, 78, 134, 190];
        o += '<path d="M22 20H190" stroke="#7EA1C3" stroke-width="2"/>';
        X.forEach(function (x, i) { o += '<circle cx="' + x + '" cy="20" r="4.5" fill="' + (i === 3 ? '#F78C16' : '#002A46') + '" stroke="#E3EAF2" stroke-width="2"/><rect x="' + (x - 14) + '" y="31" width="28" height="3.5" rx="1" fill="#002A46" opacity=".7"/><rect x="' + (x - 10) + '" y="38.5" width="20" height="3" rx="1" fill="#7EA1C3"/>'; });
      }
      return o;
    }
    function lattice(x0, x1, yA, yB, step) { var d = 'M' + x0 + ' ' + yA, k = 0; for (var x = x0 + step; x <= x1 + .1; x += step) { k++; d += 'L' + x + ' ' + (k % 2 ? yB : yA); } return d; }
    function latticeV(xA, xB, y0, y1, step) { var d = 'M' + xA + ' ' + y0, k = 0; for (var y = y0 - step; y >= y1 - .1; y -= step) { k++; d += 'L' + (k % 2 ? xB : xA) + ' ' + y; } return d; }
    function buildScene() {
      var o = '<svg viewBox="0 0 640 560" preserveAspectRatio="xMidYMid meet" role="presentation" focusable="false">';
      o += '<defs><pattern id="scG1" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#4A6FA5" stroke-opacity=".16" stroke-width=".5"/></pattern><pattern id="scG2" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#7EA1C3" stroke-opacity=".2" stroke-width=".7"/></pattern></defs>';
      o += '<rect class="sc-sheet" x="10.5" y="10.5" width="619" height="539" rx="3"/><rect class="sc-gridf" x="11" y="11" width="618" height="538"/><rect class="sc-gridm" x="11" y="11" width="618" height="538"/>';
      /* réguas */
      var r = '<g class="sc-rule sc-opt sc-f" style="--dd:0">', x, y;
      for (x = 30; x <= 620; x += 10) r += '<path d="M' + x + ' 11V' + (x % 50 ? 14 : 18) + '"/>' + (x % 100 === 0 ? '<text x="' + (x + 2) + '" y="24">' + x + '</text>' : '');
      for (y = 30; y <= 540; y += 10) r += '<path d="M11 ' + y + 'H' + (y % 50 ? 14 : 18) + '"/>' + (y % 100 === 0 ? '<text x="14" y="' + (y - 3) + '">' + y + '</text>' : '');
      o += r + '</g>';
      o += '<text class="sc-tag sc-f" x="32" y="44" style="--dd:100">CANTEIRO — PRANCHA 01 · ELEVAÇÃO</text>';
      /* chão */
      var hatch = '';
      for (x = 30; x <= 610; x += 9) hatch += 'M' + x + ' 449l-6 8';
      o += '<path class="sc-ground sc-d" pathLength="1" d="M24 448.5H616" style="--dd:0"/><path class="sc-hatch sc-f" d="' + hatch + '" style="--dd:200"/>';
      /* pilha de slides (deck) e quadro */
      o += '<g class="sc-f" style="--dd:300"><rect class="sc-stack" x="76" y="256" width="320" height="180" rx="2"/><rect class="sc-stack" x="70" y="262" width="320" height="180" rx="2"/></g>';
      o += '<rect class="sc-fr sc-d" id="scFrame" pathLength="1" x="64" y="268" width="320" height="180" rx="2" style="--dd:150"/>';
      o += '<g class="sc-f" style="--dd:500"><rect x="76" y="281" width="3" height="13" fill="#F78C16"/><rect x="84" y="282" width="122" height="5" rx="1" fill="rgba(227,234,242,.85)"/><rect x="84" y="291" width="84" height="3.5" rx="1" fill="rgba(163,184,214,.5)"/><rect x="346" y="283" width="26" height="4" rx="1" fill="rgba(163,184,214,.6)"/></g>';
      SLOTS.forEach(function (s, i) { o += '<rect class="sc-ghost sc-f" id="scGh' + i + '" x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="3" style="--dd:' + (600 + i * 60) + '"/>'; });
      SLOTS.forEach(function (s, i) { o += '<rect class="sc-ring" id="scRg' + i + '" x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="4" opacity="0"/>'; });
      /* cotas */
      o += '<g class="sc-dim sc-f" style="--dd:700"><path d="M64 240H384M64 235V245M384 235V245"/><text x="224" y="233" text-anchor="middle">1280 × 720</text><path d="M44 268V448M39 268H49M39 448H49"/><text transform="translate(38 358) rotate(-90)" text-anchor="middle">16:9</text></g>';
      o += '<g id="scDone" opacity="0"><path d="M300 229.5l3 3 6-6.5" fill="none" stroke="#F78C16" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><text class="sc-done" x="313" y="233" id="scDoneT">slide 01 pronto</text></g>';
      /* grua */
      var mast = latticeV(452, 468, 448, 104, 16), jib = lattice(96, 452, 108, 96, 16), cj = lattice(468, 596, 96, 106, 16);
      o += '<g class="sc-crane">';
      o += '<path class="sc-thin sc-d" pathLength="1" d="M460 50L200 96M460 50L596 96" style="--dd:500"/>';
      o += '<path class="sc-st sc-d" pathLength="1" d="M452 448V96M468 448V96" style="--dd:0"/><path class="sc-thin sc-d" pathLength="1" d="' + mast + '" style="--dd:120"/>';
      o += '<path class="sc-st sc-d" pathLength="1" d="M88 96H600M96 108H468M88 96L96 108M468 106H596L600 96" style="--dd:250"/><path class="sc-thin sc-d" pathLength="1" d="' + jib + '" style="--dd:350"/><path class="sc-thin sc-d" pathLength="1" d="' + cj + '" style="--dd:400"/>';
      o += '<path class="sc-st sc-d" pathLength="1" d="M452 96L460 50L468 96M456 74H464" style="--dd:300"/>';
      o += '<rect class="sc-mass sc-f" x="564" y="106" width="30" height="22" rx="1.5" style="--dd:600"/><path class="sc-hatch sc-f" d="M568 128l10-22M576 128l10-22M584 128l9-19" style="--dd:600"/>';
      o += '<g class="sc-f" style="--dd:600"><rect class="sc-cab" x="470" y="108" width="20" height="16" rx="2"/><rect class="sc-win" x="474" y="111.5" width="9" height="6" rx="1"/></g>';
      o += '<rect class="sc-mass sc-f" x="436" y="440" width="48" height="8" rx="1" style="--dd:100"/>';
      o += '</g>';
      /* peças, cabo, gancho */
      o += '<g id="scPieces">' + SLOTS.map(function (s, i) { return '<g class="sc-pc" id="scPc' + i + '" opacity="0">' + piece(s.k, s.w, s.h) + '</g>'; }).join('') + '</g>';
      o += '<path class="sc-sling" id="scSling" d="" opacity="0"/>';
      o += '<line class="sc-cable" id="scCable" x1="400" y1="114" x2="400" y2="' + CARRY + '"/>';
      o += '<g id="scTrol"><rect class="sc-trol" x="-9" y="108" width="18" height="6" rx="1.5"/></g>';
      o += '<g id="scHook"><rect class="sc-hookb" x="-5" y="0" width="10" height="8" rx="1.5"/><path class="sc-hook" d="M0 8v4a4 4 0 1 1-4 4"/></g>';
      o += '<text class="sc-lbl" id="scLbl" opacity="0">peça 01</text>';
      /* legenda e carimbo */
      var lx = 32, leg = '<g class="sc-leg sc-opt sc-f" style="--dd:800"><text x="32" y="482" fill="#A3B8D6">PEÇAS DA OBRA</text>';
      SLOTS.forEach(function (s, i) { leg += '<rect id="scLg' + i + '" x="' + lx + '" y="493" width="8" height="8" rx="1.5"/><text x="' + (lx + 12) + '" y="500">' + s.n + '</text>'; lx += 24 + s.n.length * 4.6; });
      o += leg + '<text x="32" y="526">montagem: base → topo · 5 peças · 1 slide</text></g>';
      o += '<g class="sc-tb sc-opt sc-f" style="--dd:900"><rect x="452" y="466" width="168" height="74"/><path d="M452 490.5H620M452 515.5H620M536 466V540"/><text class="k" x="460" y="481">CANTEIRO A&amp;M</text><text x="544" y="481">PRANCHA 01</text><text x="460" y="506">ESC 1:1</text><text x="544" y="506" id="scSlideN">SLIDE 01</text><text x="460" y="531" id="scPeca">PEÇA 00/05</text><text x="544" y="531">REV. 2026</text></g>';
      return o + '</svg>';
    }
    var SC = null;
    function ease(p) { p = Math.max(0, Math.min(1, p)); return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
    function lerp(a, b, p) { return a + (b - a) * p; }
    function home(i) { return 436 - SLOTS[i % SLOTS.length].w / 2; }
    function sceneState(t) {
      var s = { tx: home(0), hy: CARRY, carry: -1, op: 0, placed: 0, snap: [], done: 0, fade: 0 };
      for (var i = 0; i < SLOTS.length; i++) {
        var u = t - (T0 + i * P), sl = SLOTS[i], cx = sl.x + sl.w / 2, hyS = sl.y - 32, nx = home(i + 1);
        if (u < 0) break;
        if (u < 180) { s.tx = home(i); s.hy = CARRY - 10 * (1 - ease(u / 180)); s.carry = i; s.op = ease(u / 180); }
        else if (u < 650) { s.tx = lerp(home(i), cx, ease((u - 180) / 470)); s.hy = CARRY; s.carry = i; s.op = 1; }
        else if (u < 1030) { s.tx = cx; s.hy = lerp(CARRY, hyS, ease((u - 650) / 380)); s.carry = i; s.op = 1; }
        else {
          s.placed = i + 1; s.carry = -1;
          s.hy = lerp(hyS, CARRY, ease((u - 1180) / 240)); s.tx = lerp(cx, nx, ease((u - 1250) / 300));
          if (u < 1650) s.snap.push([i, (u - 1030) / 620]);
        }
      }
      var tEnd = T0 + SLOTS.length * P;
      if (t >= tEnd) { s.done = Math.min(1, (t - tEnd) / 320); if (t > tEnd + HOLD) { s.fade = ease((t - tEnd - HOLD) / FADE); s.done = 1 - s.fade; } }
      return s;
    }
    function sceneInit() {
      var fig = $('#cvScene'); if (!fig) return;
      fig.innerHTML = buildScene();
      SC = { raf: 0, t0: 0, cycle: 0, last: -1, pcs: [], gh: [], rg: [], lg: [] };
      ['Frame', 'Sling', 'Cable', 'Trol', 'Hook', 'Lbl', 'Done', 'DoneT', 'Peca', 'SlideN'].forEach(function (k) { SC[k] = document.getElementById('sc' + k); });
      SLOTS.forEach(function (s, i) { SC.pcs.push(document.getElementById('scPc' + i)); SC.gh.push(document.getElementById('scGh' + i)); SC.rg.push(document.getElementById('scRg' + i)); SC.lg.push(document.getElementById('scLg' + i)); });
    }
    function sceneDraw(t, cycle) {
      if (!SC) return;
      var s = sceneState(t), i;
      SC.Trol.setAttribute('transform', 'translate(' + s.tx.toFixed(2) + ' 0)');
      SC.Hook.setAttribute('transform', 'translate(' + s.tx.toFixed(2) + ' ' + s.hy.toFixed(2) + ')');
      SC.Cable.setAttribute('x1', s.tx.toFixed(2)); SC.Cable.setAttribute('x2', s.tx.toFixed(2)); SC.Cable.setAttribute('y2', (s.hy + .5).toFixed(2));
      for (i = 0; i < SLOTS.length; i++) {
        var sl = SLOTS[i], pc = SC.pcs[i], placed = i < s.placed;
        if (i === s.carry) { pc.setAttribute('transform', 'translate(' + (s.tx - sl.w / 2).toFixed(2) + ' ' + (s.hy + 32).toFixed(2) + ')'); pc.setAttribute('opacity', s.op.toFixed(3)); pc.classList.add('hang'); }
        else if (placed) { pc.setAttribute('transform', 'translate(' + sl.x + ' ' + sl.y + ')'); pc.setAttribute('opacity', (1 - s.fade).toFixed(3)); pc.classList.remove('hang'); }
        else pc.setAttribute('opacity', '0');
        SC.gh[i].style.opacity = placed ? (s.fade * .9).toFixed(3) : '';
        SC.lg[i].classList.toggle('on', placed && s.fade < .5);
        SC.rg[i].setAttribute('opacity', '0');
      }
      s.snap.forEach(function (q) { var r = SC.rg[q[0]], p = Math.max(0, Math.min(1, q[1])), sl = SLOTS[q[0]], g = 1 + p * 5; r.setAttribute('opacity', ((1 - p) * .95).toFixed(3)); r.setAttribute('x', sl.x - g); r.setAttribute('y', sl.y - g); r.setAttribute('width', sl.w + g * 2); r.setAttribute('height', sl.h + g * 2); });
      if (s.carry >= 0) {
        var c = SLOTS[s.carry], bx = s.tx - c.w / 2, by = s.hy + 32, hx = s.tx, hy = s.hy + 18;
        SC.Sling.setAttribute('d', 'M' + (bx + 5).toFixed(1) + ' ' + by.toFixed(1) + 'L' + hx.toFixed(1) + ' ' + hy.toFixed(1) + 'L' + (bx + c.w - 5).toFixed(1) + ' ' + by.toFixed(1));
        SC.Sling.setAttribute('opacity', s.op.toFixed(3));
        SC.Lbl.textContent = 'peça ' + pad(s.carry + 1); SC.Lbl.setAttribute('x', (s.tx + 9).toFixed(1)); SC.Lbl.setAttribute('y', (s.hy + 13).toFixed(1)); SC.Lbl.setAttribute('opacity', s.op.toFixed(3));
      } else { SC.Sling.setAttribute('opacity', '0'); SC.Lbl.setAttribute('opacity', '0'); }
      var cur = s.carry >= 0 ? s.carry + 1 : s.placed;
      SC.Peca.textContent = 'PEÇA ' + pad(cur) + '/' + pad(SLOTS.length);
      SC.SlideN.textContent = 'SLIDE ' + pad(cycle % 99 + 1);
      SC.DoneT.textContent = 'slide ' + pad(cycle % 99 + 1) + ' pronto';
      SC.Done.setAttribute('opacity', s.done.toFixed(3));
      SC.Frame.classList.toggle('done', s.done > .5);
    }
    function sceneLoop(now) {
      if (!SC) return;
      if (!SC.t0) SC.t0 = now;
      var el = now - SC.t0, t = el % CYC, cyc = Math.floor(el / CYC);
      sceneDraw(t, cyc);
      SC.raf = requestAnimationFrame(sceneLoop);
    }
    function scenePlay(delay) {
      if (!SC) return; sceneStop();
      if (reduce.matches) { sceneDraw(T0 + SLOTS.length * P + 400, 0); return; }
      if (SC.paused != null) { var at = SC.paused; SC.paused = null; SC.t0 = performance.now() - at; SC.raf = requestAnimationFrame(sceneLoop); return; }
      sceneDraw(0, 0);
      SC.t0 = performance.now() + (delay || 0); SC.raf = requestAnimationFrame(function wait(now) { if (now < SC.t0) { SC.raf = requestAnimationFrame(wait); return; } sceneLoop(now); });
    }
    function sceneStop() { if (SC && SC.raf) { cancelAnimationFrame(SC.raf); SC.raf = 0; } }
    function scenePause() { if (!SC || !SC.raf) return; sceneStop(); SC.paused = Math.max(0, performance.now() - SC.t0); }
    document.addEventListener('visibilitychange', function () { if (!st.open || st.view !== 'home') return; if (document.hidden) scenePause(); else scenePlay(); });

    /* ---------------- projetos prontos ---------------- */
    var mk = S && S.mk;
    function T(kind, over, dark) { return mk.text(kind, over, dark); }
    function F(kind, over, dark) { return mk.fx(kind, over, dark); }
    function sl(bg, els) { return { id: S.uid(), bg: bg, tr: 'fade', els: els }; }
    function head(eb, title, sub) {
      return [T('eyebrow', { x: 54, y: 34, w: 900, h: 22, html: eb, color: '#4A6FA5' }), mk.brand('wmN', { x: 1098, y: 32, w: 128, h: 21 }),
        T('title', { x: 54, y: 62, w: 1030, h: 46, html: title, size: 32, weight: 400, color: '#002A46', anim: { in: 'fade' } }),
        T('body', { x: 54, y: 114, w: 1140, h: 28, html: sub, font: 'Roboto', size: 18, color: '#43698F', lh: 1.3, anim: { in: 'fade', delay: 150 } })];
    }
    function src(txt) { return T('body', { x: 54, y: 670, w: 1000, h: 22, html: txt, font: 'Inter', size: 12, color: '#6B7A90', lh: 1.3 }); }
    function capa(o) {
      var dark = o.theme === 'navy' || o.theme === 'deep', bg = { navy: '#002A46', deep: '#001E32', light: '#FFFFFF', ice: '#EBEEF1' }[o.theme];
      var c2 = { navy: o.c2 || '#3D5A74', deep: '#13315C', light: '#DFE8F0', ice: '#C9D6E8' }[o.theme];
      return sl(bg, [mk.brand(dark ? 'perfW' : 'perfN', { x: 54, y: 44 }), F('amlines', { x: 700, y: 0, w: 580, h: 720, data: { c1: '#F78C16', c2: c2 } }),
        T('eyebrow', { x: 54, y: 312, w: 620, h: 22, html: o.eb, color: dark ? '#F78C16' : '#43698F', anim: { in: 'fade', delay: 150 } }),
        T('title', { x: 54, y: 346, w: 640, h: 130, html: o.title, size: 52, color: dark ? '#FFFFFF' : '#002A46', anim: { in: 'rise', delay: 300, dur: 900 } }),
        T('body', { x: 54, y: 494, w: 600, h: 56, html: o.sub, font: 'Roboto', size: 18, color: dark ? '#A3B8D6' : '#43698F', lh: 1.4, anim: { in: 'fade', delay: 700 } }),
        T('body', { x: 54, y: 640, w: 400, h: 28, html: o.date, font: 'Roboto', size: 16, color: dark ? '#FFFFFF' : '#6B7A90', anim: { in: 'fade', delay: 900 } })]);
    }
    function fim(msg, hl, contact) {
      return sl('#002A46', [mk.brand('perfW', { x: 54, y: 44 }), F('amlines', { x: 700, y: 0, w: 580, h: 720 }),
        F('headline', { x: 54, y: 290, w: 620, h: 110, data: { text: msg, hl: hl || '', size: 72, color: '#FFFFFF', font: 'Roboto', weight: 300 } }),
        T('body', { x: 54, y: 424, w: 620, h: 56, html: contact, font: 'Roboto', size: 18, color: '#A3B8D6', lh: 1.4, anim: { in: 'fade', delay: 600 } })]);
    }
    function rise(d, extra) { return Object.assign({ in: 'rise', delay: d || 0, dur: 700, loop: 'none', hover: 'none' }, extra || {}); }
    function fade(d) { return { in: 'fade', delay: d || 0, dur: 700, loop: 'none', hover: 'none' }; }
    function agenda(items) {
      var els = [];
      items.forEach(function (it, i) {
        var y = 182 + i * 92, d = 200 + i * 120;
        els.push(T('number', { x: 54, y: y + 6, w: 90, h: 50, html: pad(i + 1), size: 44, lh: 1, color: i === 0 ? '#F78C16' : '#7EA1C3', anim: fade(d) }));
        els.push(T('body', { x: 160, y: y + 6, w: 820, h: 30, html: it[0], font: 'Roboto', size: 23, color: '#002A46', lh: 1.2, anim: fade(d) }));
        els.push(T('body', { x: 160, y: y + 40, w: 820, h: 24, html: it[1], font: 'Inter', size: 15, color: '#6B7A90', lh: 1.3, anim: fade(d + 60) }));
        els.push(T('eyebrow', { x: 1006, y: y + 14, w: 220, h: 22, html: it[2], align: 'right', size: 14, ls: .06, color: '#43698F', anim: fade(d + 60) }));
        if (i < items.length - 1) els.push(Object.assign(mk.line(false, false), { x1: 54, y1: y + 84, x2: 1226, y2: y + 84, stroke: '#DCE3EC', strokeW: 1, anim: { in: 'none' } }));
      });
      return els;
    }
    function chevrons(labels, y, h) {
      var n = labels.length, k = Math.round(h / 2), gap = 8, w = Math.round((1172 + (n - 1) * (k - gap)) / n);
      return labels.map(function (t, i) {
        var last = i === n - 1;
        return Object.assign(mk.shape('chevron'), { x: Math.round(54 + i * (w - k + gap)), y: y, w: w, h: h, fill: last ? '#F78C16' : '#DCE5F0', strokeW: 0, html: t, font: 'Roboto Condensed', size: 20, weight: 700, color: '#002A46', anim: { in: 'left', delay: 200 + i * 160, dur: 600 } });
      });
    }
    var LEVELS = ['Inicial', 'Repetível', 'Definido', 'Gerenciado', 'Otimizado'];
    var TPL = [
      { name: 'Proposta comercial', desc: 'Contexto, abordagem, cronograma, equipe e investimento.', build: function () {
        return { title: 'Proposta comercial — Transformação do PMO', slides: [
          capa({ theme: 'navy', eb: 'PROPOSTA COMERCIAL', title: 'Transformação do PMO<br>corporativo', sub: 'Preparada para a Diretoria Executiva de [Cliente]', date: 'Outubro de 2026' }),
          sl('#FFFFFF', head('01 · CONTEXTO E DESAFIO', 'Crescimento acelerado, governança fragmentada', 'O portfólio dobrou em dois anos — a forma de acompanhar e decidir não acompanhou o ritmo.').concat([
            T('subtitle', { x: 54, y: 190, w: 560, h: 30, html: 'Contexto', size: 22, anim: fade(200) }),
            T('bullets', { x: 54, y: 230, w: 580, h: 190, html: '• 38 iniciativas estratégicas em paralelo<br>• 4 ferramentas diferentes de reporte<br>• Decisões dependem de consolidação manual<br>• Pouca visibilidade de riscos entre áreas', size: 18, lh: 1.65, color: '#3E4C5E', anim: rise(300) }),
            F('counter', { x: 680, y: 194, w: 260, h: 214, data: { label: 'Iniciativas ativas', value: 38, decimals: 0, prefix: '', suffix: '', sub: '+19 em 24 meses', bar: 76, style: 'dark' }, anim: rise(350) }),
            F('counter', { x: 966, y: 194, w: 260, h: 214, data: { label: 'Ciclo de decisão', value: 45, decimals: 0, prefix: '', suffix: ' dias', sub: 'meta: 15 dias', bar: 0, style: 'ice' }, anim: rise(500) }),
            F('quote', { x: 54, y: 468, w: 1172, h: 92, data: { text: 'Desafio: dar visibilidade única ao portfólio e acelerar decisões — sem travar a operação.', style: 'dark' }, anim: { in: 'wipe', delay: 800, dur: 900, loop: 'none', hover: 'none' } }),
            src('Fonte: entrevistas com 14 executivos e análise de 6 relatórios de status (setembro de 2026).')])),
          sl('#FFFFFF', head('02 · ABORDAGEM', 'Quatro fases, com entregas a cada etapa', 'Metodologia A&M aplicada ao contexto do cliente, com marcos de validação em cada fase.').concat(chevrons(['Diagnóstico', 'Desenho', 'Implementação', 'Sustentação'], 192, 84), [
            F('cardgrid', { x: 54, y: 322, w: 1172, h: 250, data: { cards: [{ tag: '01', t: 'Diagnóstico', x: 'Entrevistas, mapa do portfólio e linha de base dos indicadores.' }, { tag: '02', t: 'Desenho', x: 'Modelo TO-BE de governança, papéis e rituais de decisão.' }, { tag: '03', t: 'Implementação', x: 'Piloto com duas diretorias, Torre de Controle e capacitação.' }, { tag: '04', t: 'Sustentação', x: 'Rotina de indicadores, comitês e melhoria contínua.' }], style: 'ice' }, anim: fade(400) })])),
          sl('#FFFFFF', head('03 · CRONOGRAMA', '12 semanas do diagnóstico à escala', 'Marcos quinzenais de validação com o sponsor e comitê de decisão na semana 5.').concat([
            F('timeline', { x: 90, y: 214, w: 1100, h: 220, data: { items: 'Sem 1–2 | Diagnóstico e entrevistas\nSem 3–5 | Desenho do modelo TO-BE\nSem 6–10 | Implementação piloto\nSem 11–12 | Escala e transição', current: 2, style: 'clear', tcolor: '#002A46' }, anim: fade(200) }),
            F('beacon', { x: 54, y: 506, w: 560, h: 80, data: { title: 'Marco de decisão', text: 'Aprovação do modelo TO-BE no comitê — semana 5', tcolor: '#002A46' }, anim: { in: 'zoom', delay: 1200, dur: 700, loop: 'none', hover: 'none' } }),
            T('body', { x: 680, y: 512, w: 546, h: 70, html: 'Cadência: status semanal com o PMO e checkpoint quinzenal com o sponsor.', font: 'Roboto', size: 17, color: '#3E4C5E', lh: 1.45, anim: fade(1300) })])),
          sl('#FFFFFF', head('04 · EQUIPE E PAPÉIS', 'Quem faz o quê, do kickoff à entrega', 'Matriz RACI acordada com o sponsor — base para os rituais de governança.').concat([
            F('raci', { x: 110, y: 178, w: 1060, h: 470, data: { roles: ['Sponsor', 'A&M', 'PMO', 'Negócio', 'TI'], rows: [{ t: 'Definir escopo e metas', v: ['A', 'R', 'C', 'C', 'I'] }, { t: 'Conduzir o diagnóstico', v: ['I', 'A', 'R', 'C', 'C'] }, { t: 'Desenhar o modelo TO-BE', v: ['C', 'A', 'R', 'C', 'C'] }, { t: 'Aprovar entregas de fase', v: ['A', 'R', 'C', 'I', 'I'] }, { t: 'Implementar o piloto', v: ['I', 'C', 'A', 'R', 'R'] }], legend: 'sim' }, anim: fade(200) })])),
          sl('#FFFFFF', head('05 · INVESTIMENTO', 'Investimento por fase, atrelado a entregas', 'Valores em reais, sem impostos. Pagamento vinculado à aceitação de cada marco.').concat([
            F('counter', { x: 54, y: 196, w: 370, h: 220, data: { label: 'Fase 1 · Diagnóstico', value: 480, decimals: 0, prefix: 'R$ ', suffix: ' mil', sub: '2 semanas · 3 consultores', bar: 25, style: 'light' }, anim: rise(200, { hover: 'lift' }) }),
            F('counter', { x: 455, y: 196, w: 370, h: 220, data: { label: 'Fases 2 e 3 · Desenho e piloto', value: 1.1, decimals: 1, prefix: 'R$ ', suffix: ' mi', sub: '8 semanas · 5 consultores', bar: 58, style: 'light' }, anim: rise(350, { hover: 'lift' }) }),
            F('counter', { x: 856, y: 196, w: 370, h: 220, data: { label: 'Fase 4 · Escala', value: 320, decimals: 0, prefix: 'R$ ', suffix: ' mil', sub: '2 semanas · 3 consultores', bar: 17, style: 'light' }, anim: rise(500, { hover: 'lift' }) }),
            F('quote', { x: 54, y: 470, w: 1172, h: 92, data: { text: 'Investimento total de R$ 1,9 milhão, com 20% condicionado às metas do piloto.', style: 'dark' }, anim: { in: 'wipe', delay: 900, dur: 900, loop: 'none', hover: 'none' } })])),
          fim('Obrigado.', '', 'Sócio responsável · nome@alvarezandmarsal.com')] };
      } },
      { name: 'Diagnóstico de maturidade', desc: 'Régua de maturidade, riscos, SWOT e prioridades.', build: function () {
        return { title: 'Diagnóstico de maturidade digital', slides: [
          capa({ theme: 'light', eb: 'DIAGNÓSTICO DE MATURIDADE', title: 'Maturidade digital<br>e de dados', sub: 'Resultados da avaliação · [Cliente]', date: 'Outubro de 2026' }),
          sl('#FFFFFF', head('01 · VISÃO GERAL', 'Maturidade atual: 2,7 de 5 — nível “Definido”', 'Avaliação em 4 dimensões, com 42 entrevistas e 120 respostas ao questionário.').concat([
            F('maturity', { x: 54, y: 180, w: 1172, h: 200, data: { label: 'Índice de maturidade digital', levels: LEVELS.slice(), current: 2.7, prev: 1.8, target: 4 }, anim: fade(200) }),
            F('cardgrid', { x: 54, y: 412, w: 1172, h: 248, data: { cards: [{ tag: '2,9', t: 'Processos', x: 'Rituais definidos, pouca medição de resultado.' }, { tag: '2,1', t: 'Dados', x: 'Bases dispersas e sem dono claro.' }, { tag: '3,2', t: 'Tecnologia', x: 'Plataformas modernas, integração parcial.' }, { tag: '2,6', t: 'Pessoas', x: 'Engajamento alto, capacitação desigual.' }], style: 'light' }, anim: fade(500) })])),
          sl('#FFFFFF', head('02 · RISCOS', 'Dois riscos críticos pedem ação imediata', 'Probabilidade × impacto, avaliados com as lideranças de cada área.').concat([
            F('riskmap', { x: 110, y: 178, w: 1060, h: 480, data: { xlab: 'Impacto', ylab: 'Probabilidade', risks: [{ t: 'Dados sem governança', p: 4, i: 5 }, { t: 'Dependência de planilhas', p: 5, i: 3 }, { t: 'Baixa adoção das ferramentas', p: 3, i: 4 }, { t: 'Falta de patrocínio executivo', p: 2, i: 5 }, { t: 'Rotatividade do time de TI', p: 2, i: 3 }] }, anim: fade(200) })])),
          sl('#FFFFFF', head('03 · SWOT', 'Forças para alavancar, fraquezas para tratar', 'Síntese das entrevistas e da análise documental.').concat([
            F('swot', { x: 110, y: 178, w: 1060, h: 470, data: { s: ['Liderança engajada com a agenda digital', 'Plataformas de nuvem já contratadas'], w: ['Dados dispersos e sem dono', 'Processos manuais no backoffice'], o: ['IA generativa no atendimento', 'Automação do fechamento contábil'], t: ['Concorrentes digitais mais ágeis', 'Novas exigências regulatórias'] } , anim: fade(200) })])),
          sl('#FFFFFF', head('04 · PRIORIZAÇÃO', 'Seis iniciativas, três quick wins', 'Impacto esperado × esforço de implementação, validados em workshop.').concat([
            F('matrix', { x: 190, y: 172, w: 900, h: 490, data: { xlab: 'Esforço', ylab: 'Impacto', q: ['Quick wins', 'Projetos estratégicos', 'Baixa prioridade', 'Evitar'], items: [{ t: 'Catálogo de dados', x: 16, y: 86 }, { t: 'Painel executivo', x: 30, y: 70 }, { t: 'Automação do fechamento', x: 12, y: 56 }, { t: 'Plataforma de dados', x: 64, y: 86 }, { t: 'Novo ERP', x: 84, y: 64 }, { t: 'Relatórios manuais', x: 62, y: 24 }] }, anim: fade(200) })])),
          sl('#FFFFFF', head('05 · PRÓXIMOS PASSOS', 'Roteiro de 90 dias para sair do diagnóstico', 'Sequência proposta para capturar valor rápido e preparar as iniciativas estruturantes.').concat([
            F('cardgrid', { x: 54, y: 190, w: 1172, h: 270, data: { cards: [{ tag: '30d', t: 'Validar e priorizar', x: 'Workshop com a diretoria para validar achados e metas.' }, { tag: '60d', t: 'Quick wins', x: 'Catálogo de dados e painel executivo em produção.' }, { tag: '90d', t: 'Estruturar', x: 'Escritório de dados e plano da nova plataforma.' }, { tag: '+90d', t: 'Escalar', x: 'Ondas de implementação com metas trimestrais.' }], style: 'light' }, variant: 'number', anim: fade(200) }),
            F('quote', { x: 54, y: 500, w: 1172, h: 92, data: { text: 'Decisão necessária: aprovar a onda 1 do roteiro e o time dedicado de dados.', style: 'dark' }, anim: { in: 'wipe', delay: 1200, dur: 900, loop: 'none', hover: 'none' } })])),
          fim('Obrigado.', '', 'Equipe de diagnóstico · nome@alvarezandmarsal.com')] };
      } },
      { name: 'Status report executivo', desc: 'KPIs, cronograma, riscos, resultados e decisões.', build: function () {
        return { title: 'Status report executivo — Semana 18', slides: [
          capa({ theme: 'deep', eb: 'STATUS REPORT EXECUTIVO · SEMANA 18', title: 'Programa de<br>Transformação 2026', sub: 'Comitê executivo · visão consolidada do programa', date: '2 de outubro de 2026' }),
          sl('#FFFFFF', head('01 · INDICADORES', 'Programa saudável, com atenção ao orçamento', 'Posição consolidada em 30/09/2026 — fonte: Torre de Controle.').concat([
            F('gauge', { x: 54, y: 186, w: 370, h: 290, data: { label: 'Saúde do programa', value: 78, max: 100, unit: '%', kind: 'gauge' }, anim: fade(200) }),
            F('gauge', { x: 455, y: 186, w: 370, h: 290, data: { label: 'Orçamento consumido', value: 64, max: 100, unit: '%', kind: 'thermo' }, variant: 'fill', anim: fade(350) }),
            F('counter', { x: 866, y: 206, w: 360, h: 250, data: { label: 'Entregas no prazo', value: 92, decimals: 0, prefix: '', suffix: '%', sub: '+6 p.p. vs. mês anterior', bar: 92, style: 'dark' }, anim: rise(500) }),
            F('quote', { x: 54, y: 516, w: 1172, h: 92, data: { text: 'Leitura: ritmo de entregas acima da meta; orçamento pede reforço de controle na onda 2.', style: 'ice' }, anim: { in: 'wipe', delay: 900, dur: 900, loop: 'none', hover: 'none' } })])),
          sl('#FFFFFF', head('02 · CRONOGRAMA', 'Onda 2 em andamento, dentro do prazo', 'Marco atual: implementação nas áreas-piloto.').concat([
            F('timeline', { x: 90, y: 206, w: 1100, h: 220, variant: 'progress', data: { items: 'Jul | Diagnóstico\nAgo | Desenho\nSet | Piloto\nOut | Onda 2\nDez | Escala', current: 4, style: 'clear', tcolor: '#002A46' }, anim: fade(200) }),
            F('progress', { x: 54, y: 490, w: 560, h: 110, data: { label: 'Avanço físico da onda 2', value: 46, target: 50, kind: 'bar', style: 'ice' }, anim: fade(700) }),
            F('progress', { x: 666, y: 490, w: 560, h: 110, data: { label: 'Adoção nas áreas-piloto', value: 71, target: 75, kind: 'bar', style: 'ice' }, anim: fade(850) })])),
          sl('#FFFFFF', head('03 · RISCOS', 'Dois riscos sob monitoramento próximo', 'Atualizado com os responsáveis de cada frente.').concat([
            F('riskmap', { x: 110, y: 178, w: 1060, h: 480, variant: 'critical', data: { xlab: 'Impacto', ylab: 'Probabilidade', risks: [{ t: 'Atraso na migração de dados', p: 4, i: 5 }, { t: 'Baixa adoção em Operações', p: 4, i: 4 }, { t: 'Estouro do orçamento da onda 2', p: 3, i: 4 }, { t: 'Dependência de fornecedor', p: 3, i: 3 }, { t: 'Rotatividade do time', p: 2, i: 2 }] }, anim: fade(200) })])),
          sl('#FFFFFF', head('04 · RESULTADOS', '4,7 mil horas liberadas no trimestre', 'Horas de trabalho manual eliminadas por área, com automações já em produção.').concat([
            F('bars', { x: 54, y: 176, w: 780, h: 450, data: { title: 'Horas liberadas por área (trimestre)', labels: 'Finanças, Operações, Supply, TI, RH, Comercial', values: '1240, 980, 860, 640, 520, 470', unit: ' h', highlight: '1, 2', style: 'clear' }, anim: fade(200) }),
            F('card', { x: 880, y: 214, w: 346, h: 236, data: { tag: 'Leitura', title: 'Finanças e Operações lideram', text: 'Somam 47% das horas liberadas, com a automação do fechamento e do intake.', style: 'ice' }, anim: rise(700) }),
            F('beacon', { x: 880, y: 496, w: 346, h: 80, data: { title: 'Próximo passo', text: 'Escalar automações para Supply', tcolor: '#002A46' }, anim: { in: 'zoom', delay: 1100, dur: 700, loop: 'none', hover: 'none' } })])),
          sl('#FFFFFF', head('05 · DECISÕES PENDENTES', 'Três decisões para o comitê de hoje', 'Itens que destravam a onda 2 — prazo de resposta até 15/10.').concat([
            F('cardgrid', { x: 54, y: 190, w: 1172, h: 270, data: { cards: [{ tag: 'D1', t: 'Aprovar orçamento adicional', x: 'R$ 350 mil para reforçar a migração de dados.' }, { tag: 'D2', t: 'Priorizar Operações', x: 'Antecipar a onda de adoção na diretoria de Operações.' }, { tag: 'D3', t: 'Nomear o dono dos dados', x: 'Responsável executivo pela governança de dados.' }], style: 'light' }, anim: fade(200) }),
            F('quote', { x: 54, y: 500, w: 1172, h: 92, data: { text: 'Recomendação: aprovar D1 e D3 nesta reunião; D2 segue para validação com Operações.', style: 'dark' }, anim: { in: 'wipe', delay: 1000, dur: 900, loop: 'none', hover: 'none' } })]))] };
      } },
      { name: 'Kickoff de projeto', desc: 'Objetivos, papéis, cronograma e ritos de governança.', build: function () {
        return { title: 'Kickoff — Torre de Controle do Portfólio', slides: [
          capa({ theme: 'ice', eb: 'KICKOFF DE PROJETO', title: 'Torre de Controle<br>do Portfólio', sub: 'Reunião de abertura · objetivos, papéis e ritos', date: 'Outubro de 2026' }),
          sl('#FFFFFF', head('01 · OBJETIVOS', 'O que vamos entregar juntos', 'Três objetivos, com metas mensuráveis ao fim de 12 semanas.').concat([
            F('cardgrid', { x: 54, y: 190, w: 1172, h: 290, variant: 'number', data: { cards: [{ tag: '01', t: 'Visibilidade', x: 'Portfólio único, com status semanal de 100% das iniciativas.' }, { tag: '02', t: 'Velocidade', x: 'Reduzir de 45 para 15 dias o ciclo médio de decisão.' }, { tag: '03', t: 'Valor', x: 'Capturar R$ 12 mi em benefícios rastreados até 2027.' }], style: 'light' }, anim: fade(200) }),
            F('quote', { x: 54, y: 520, w: 1172, h: 92, data: { text: 'Critério de sucesso: comitê decidindo com dados da Torre de Controle já na semana 8.', style: 'ice' }, anim: { in: 'wipe', delay: 1000, dur: 900, loop: 'none', hover: 'none' } })])),
          sl('#FFFFFF', head('02 · PAPÉIS', 'Papéis e responsabilidades', 'Matriz RACI validada no kickoff — revisada a cada fase.').concat([
            F('raci', { x: 110, y: 178, w: 1060, h: 470, data: { roles: ['Sponsor', 'Gerente', 'PMO', 'Áreas', 'A&M'], rows: [{ t: 'Aprovar escopo e metas', v: ['A', 'R', 'C', 'I', 'C'] }, { t: 'Planejar as sprints', v: ['I', 'A', 'R', 'C', 'R'] }, { t: 'Coletar dados das iniciativas', v: ['I', 'C', 'A', 'R', 'C'] }, { t: 'Construir a Torre de Controle', v: ['I', 'A', 'C', 'C', 'R'] }, { t: 'Comunicar os avanços', v: ['C', 'R', 'A', 'I', 'C'] }], legend: 'sim' }, anim: fade(200) })])),
          sl('#FFFFFF', head('03 · CRONOGRAMA', 'Do kickoff à operação assistida em 12 semanas', 'Marcos principais — o detalhamento está no plano do projeto.').concat([
            F('timeline', { x: 90, y: 214, w: 1100, h: 220, data: { items: 'Sem 1 | Kickoff e alinhamento\nSem 2–4 | Levantamento do portfólio\nSem 5–8 | Construção da Torre\nSem 9–10 | Piloto com 2 diretorias\nSem 11–12 | Operação assistida', current: 1, style: 'clear', tcolor: '#002A46' }, anim: fade(200) }),
            F('beacon', { x: 54, y: 506, w: 600, h: 80, data: { title: 'Próximo marco', text: 'Portfólio levantado e validado — semana 4', tcolor: '#002A46' }, anim: { in: 'zoom', delay: 1200, dur: 700, loop: 'none', hover: 'none' } })])),
          sl('#FFFFFF', head('04 · RITOS DE GOVERNANÇA', 'Cadência de acompanhamento', 'Ritos curtos e regulares, cada um com dono, pauta e saída definidos.').concat(chevrons(['Daily da squad', 'Status semanal', 'Comitê quinzenal', 'Steering mensal'], 192, 84), [
            F('cardgrid', { x: 54, y: 322, w: 1172, h: 250, data: { cards: [{ tag: '15 min', t: 'Daily da squad', x: 'Impedimentos e prioridades do dia.' }, { tag: '45 min', t: 'Status semanal', x: 'Avanço, riscos e próximos passos com o PMO.' }, { tag: '1 h', t: 'Comitê quinzenal', x: 'Decisões de escopo, prazo e recursos.' }, { tag: '1 h', t: 'Steering mensal', x: 'Direção estratégica com o sponsor.' }], style: 'ice' }, anim: fade(400) })])),
          fim('Vamos começar.', 'começar', 'Gerente do projeto · nome@alvarezandmarsal.com')] };
      } },
      { name: 'Comitê / Workshop', desc: 'Agenda, priorização, evolução e decisões da sessão.', build: function () {
        return { title: 'Comitê executivo — Priorização do portfólio 2027', slides: [
          capa({ theme: 'navy', c2: '#4A6FA5', eb: 'COMITÊ EXECUTIVO · WORKSHOP', title: 'Priorização do<br>portfólio 2027', sub: 'Sessão de trabalho com a diretoria · 3 horas', date: '15 de outubro de 2026' }),
          sl('#FFFFFF', head('AGENDA', 'Agenda da sessão', 'Objetivo: sair com o portfólio 2027 priorizado e os responsáveis definidos.').concat(agenda([
            ['Abertura e objetivos', 'Contexto e resultados esperados da sessão', '09:00 – 09:15'],
            ['Leitura do diagnóstico', 'Principais achados e indicadores', '09:15 – 09:45'],
            ['Priorização do portfólio', 'Matriz impacto × esforço, em grupos', '09:45 – 10:45'],
            ['Decisões e responsáveis', 'Fechamento das escolhas e dos donos', '10:45 – 11:30'],
            ['Próximos passos', 'Cronograma e comunicação', '11:30 – 12:00']]))),
          sl('#FFFFFF', head('01 · PRIORIZAÇÃO', 'Onde concentrar esforço em 2027', 'Resultado da dinâmica em grupos — seis iniciativas posicionadas por impacto e esforço.').concat([
            F('matrix', { x: 190, y: 172, w: 900, h: 490, variant: 'quickwins', data: { xlab: 'Esforço', ylab: 'Impacto', q: ['Quick wins', 'Projetos estratégicos', 'Baixa prioridade', 'Evitar'], items: [{ t: 'Automação do intake', x: 18, y: 84 }, { t: 'Torre de Controle', x: 70, y: 84 }, { t: 'Catálogo de skills', x: 24, y: 64 }, { t: 'Migração para a nuvem', x: 70, y: 60 }, { t: 'Relatórios manuais', x: 68, y: 22 }, { t: 'Templates de status', x: 20, y: 28 }] }, anim: fade(200) })])),
          sl('#FFFFFF', head('02 · EVOLUÇÃO', 'Adoção cresceu 5× em seis meses', 'Percentual de áreas que já usam o novo modelo de gestão do portfólio.').concat([
            F('linechart', { x: 54, y: 178, w: 800, h: 440, data: { title: 'Adoção do modelo (%)', labels: ['Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set'], values: [12, 18, 27, 35, 48, 62], target: 80, unit: '%' }, anim: fade(200) }),
            F('card', { x: 900, y: 214, w: 326, h: 236, data: { tag: 'Leitura', title: 'Rumo à meta de 80%', text: '62% das áreas já operam no novo modelo; a meta é chegar a 80% até dezembro.', style: 'ice' }, anim: rise(800) })])),
          sl('#FFFFFF', head('03 · DECISÕES', 'Decisões registradas na sessão', 'Validadas pelos participantes, com responsáveis e prazos definidos.').concat([
            F('cardgrid', { x: 54, y: 190, w: 1172, h: 270, data: { cards: [{ tag: 'D1', t: 'Priorizar dois quick wins', x: 'Automação do intake e catálogo de skills.' }, { tag: 'D2', t: 'Criar o escritório de dados', x: 'Liderado por Finanças, com início em novembro.' }, { tag: 'D3', t: 'Revisar o portfólio por trimestre', x: 'Comitê com a mesma matriz de priorização.' }], style: 'light' }, anim: fade(200) }),
            F('quote', { x: 54, y: 500, w: 1172, h: 92, data: { text: 'Próxima sessão: 12/11 — revisão dos quick wins e do plano do escritório de dados.', style: 'ice' }, anim: { in: 'wipe', delay: 1000, dur: 900, loop: 'none', hover: 'none' } })])),
          fim('Obrigado.', '', 'Facilitação · nome@alvarezandmarsal.com')] };
      } }
    ];
    /* S34b: projeto pronto com o bloco institucional (pedido do usuário: “uma versão institucional dentro de Projetos prontos”).
       Só entra quando o bloco está carregado (ed-45 roda antes da capa). Os 5 slides oficiais + 1 slide para o conteúdo + encerramento = 7. */
    if (S.LAYOUTS && S.LAYOUTS['inst-cover']) TPL.push({ name: 'Apresentação institucional A&M', desc: 'Os 5 slides institucionais oficiais, um slide para o seu conteúdo e o encerramento.', build: function () {
      var ORDER = (window.AMInst && window.AMInst.ORDER) || ['cover', 'map', 'clients', 'spheres', 'chain'];
      return { title: 'Apresentação institucional A&M', slides: ORDER.map(function (k) { return S.mk.slide('inst-' + k); }).concat([
        sl('#FFFFFF', head('01 · SEU CONTEÚDO', 'Comece aqui a sua apresentação', 'Os cinco slides anteriores são o bloco institucional oficial — este é o primeiro slide do seu conteúdo.').concat([
          T('subtitle', { x: 54, y: 190, w: 560, h: 30, html: 'Como usar este modelo', size: 22, anim: fade(200) }),
          T('bullets', { x: 54, y: 230, w: 580, h: 230, html: '• Textos, logos e indicadores dos 5 slides são editáveis<br>• Troque este slide pelo seu conteúdo (Novo slide, Modelos)<br>• Em outra apresentação, use o botão <b>Institucional A&amp;M</b> da barra<br>• Um Ctrl+Z desfaz a inserção do bloco', size: 18, lh: 1.65, color: '#3E4C5E', anim: rise(300) }),
          F('card', { x: 680, y: 194, w: 546, h: 266, data: { tag: 'Padrão oficial', title: 'O institucional não quebra', text: 'Capa, presença global, clientes, esferas e cadeia de valor seguem sempre o modelo oficial — também ao importar um .pptx.', style: 'ice' }, anim: rise(500) }),
          src('Modelo institucional A&M Performance · substitua este slide pelo seu conteúdo.')])),
        fim('Obrigado.', '', 'A&M Performance · nome@alvarezandmarsal.com')]) };
    } });
    function buildTpl(i) { var d = TPL[i].build(); d.v = 1; d.app = 'AM Studio'; if (has('newId')) d.id = S.newId(); return d; } /* cada projeto carregado é uma obra nova, com id próprio */
    var PV = [];
    function pvDeck(i) { return PV[i] || (PV[i] = buildTpl(i)); }
    function stageOf(slide) { var s = RT.renderSlide(slide, { play: false }); s.setAttribute('aria-hidden', 'true'); return s; }
    function renderTpl() {
      var g = $('#cvTplGrid');
      if (!g.children.length) {
        g.innerHTML = TPL.map(function (t, i) { return '<button type="button" class="cv-tcard" data-t="' + i + '" style="--i:' + i + '" aria-keyshortcuts="' + (i + 1) + '" aria-label="' + esc(t.name) + ' — ' + esc(t.desc) + '"><span class="cv-pv"></span><span class="cv-tb"><span class="cv-tmeta"><span class="cv-tn"></span><kbd>' + (i + 1) + '</kbd></span><span class="cv-tname">' + esc(t.name) + '</span><span class="cv-tdesc">' + esc(t.desc) + '</span></span></button>'; }).join('');
      }
      $$('.cv-tcard', g).forEach(function (b, i) {
        var d = pvDeck(i), pv = $('.cv-pv', b);
        $('.cv-tn', b).textContent = pad(d.slides.length) + ' slides';
        if (!pv.firstChild) pv.appendChild(stageOf(d.slides[0]));
      });
      $('#cvTplN').textContent = pad(TPL.length) + ' projetos';
      strip(st.tplCur);
    }
    function strip(i) {
      var d = pvDeck(i), row = $('#cvStrip');
      st.tplCur = i;
      $$('.cv-tcard').forEach(function (b) { b.classList.toggle('cur', +b.dataset.t === i); });
      if (row.dataset.t === String(i) && row.children.length) return;
      row.dataset.t = i; row.innerHTML = '';
      $('#cvStripName').textContent = TPL[i].name; $('#cvStripN').textContent = pad(d.slides.length) + ' slides · 1280 × 720';
      d.slides.forEach(function (s, k) { var c = document.createElement('div'); c.className = 'cv-th'; c.style.setProperty('--i', k); c.innerHTML = '<i>' + pad(k + 1) + '</i>'; c.appendChild(stageOf(s)); row.appendChild(c); });
    }
    function clearPreviews() { $$('.cv-pv').forEach(function (p) { p.innerHTML = ''; }); var r = $('#cvStrip'); r.innerHTML = ''; r.removeAttribute('data-t'); }
    function chooseTpl(i) {
      if (!TPL[i]) return;
      guard('Carregar “' + TPL[i].name + '”?', function () { var d = buildTpl(i); load(d, 'Projeto pronto: ' + TPL[i].name + ' · ' + d.slides.length + ' slides'); close(); });
    }

    /* ---------------- manual da obra ---------------- */
    var K = function (s) { return s.split('+').map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('+'); };
    var MS = function (s) { return '<kbd class="ms">' + esc(s) + '</kbd>'; };
    var OR = '<span>ou</span>', SL = '<span>/</span>';
    /* atalhos: a mesma lista do modal F1 do editor (AMStudio.HK) — grupos, rótulos e separadores idênticos.
       "/" = respectivamente; "ou" = alternativas */
    var HK_FALLBACK = [
      ['Editar', [['Copiar / recortar / colar', [['Ctrl', 'C'], ['Ctrl', 'X'], ['Ctrl', 'V']], 'Elementos ou, com a miniatura em foco, slides', '/'], ['Duplicar', [['Ctrl', 'D']]], ['Selecionar tudo no slide', [['Ctrl', 'A']]], ['Apagar seleção', [['Delete'], ['Backspace']], 'Ou o slide, com a miniatura em foco']]],
      ['Histórico e arquivo', [['Desfazer', [['Ctrl', 'Z']]], ['Refazer', [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']]], ['Abrir apresentação', [['Ctrl', 'O']]], ['Salvar apresentação', [['Ctrl', 'S']], 'Gera um novo arquivo HTML']]],
      ['Mover e selecionar', [['Mover 1 px / 10 px', [['Setas'], ['Shift', 'Setas']], '', '/'], ['Somar à seleção', [['Shift', '~clique']]], ['Seleção por área', [['~arrastar no vazio']]], ['Editar texto', [['~duplo clique'], ['Enter']], 'No vazio, cria uma caixa de texto'], ['Menu de opções', [['~clique direito'], ['Shift', 'F10']]], ['Sair da edição / limpar seleção', [['Esc']]]]],
      ['Apresentar e ajuda', [['Apresentar do início', [['F5']], 'F alterna a tela cheia'], ['Apresentar do slide atual', [['Shift', 'F5']]], ['Atalhos de teclado', [['F1'], ['?']]]]]
    ];
    function keysOf(combos, sep) {
      if (sep === '/' && combos.length > 1 && combos.every(function (c) { return c.length === 2 && c[0] === combos[0][0] && c[1].charAt(0) !== '~'; })) return K(combos[0][0]) + '+' + combos.map(function (c) { return K(c[1]); }).join(SL);
      return combos.map(function (c) { return c.map(function (k) { return k.charAt(0) === '~' ? MS(k.slice(1)) : K(k); }).join('+'); }).join(sep === '/' ? SL : OR);
    }
    function keyCols() { var hk = (S && Array.isArray(S.HK) && S.HK.length) ? S.HK : HK_FALLBACK, g = hk.map(function (x) { return [x[0], x[1].map(function (r) { return [keysOf(r[1], r[3]), esc(r[0]), r[2] ? esc(r[2]) : '']; })]; }); return [g.slice(0, 2), g.slice(2)]; }
    var STEPS = [
      ['01', 'Escolha', 'Comece do zero, de um projeto pronto ou retome o rascunho salvo neste navegador.', '<rect x="6" y="14" width="24" height="34" rx="3"/><rect x="34" y="10" width="24" height="42" rx="3" class="o"/><rect x="62" y="14" width="24" height="34" rx="3"/><path class="f" d="M50 40l9 9-4 1 3 6-3 1-3-6-3 3z"/>'],
      ['02', 'Construa', 'Traga modelos do Almoxarifado, arraste, edite textos com duplo clique e organize os slides.', '<rect x="10" y="26" width="72" height="32" rx="2"/><rect x="16" y="40" width="22" height="13" rx="1.5" class="t"/><rect x="42" y="40" width="34" height="13" rx="1.5" class="d"/><path d="M59 4v18"/><path class="o" d="M59 22v4a3 3 0 1 1-3 3"/><rect x="48" y="31" width="22" height="7" rx="1.5" class="t"/>'],
      ['03', 'Apresente e salve', 'F5 apresenta (F alterna a tela cheia). “Salvar” gera um novo HTML, que abre em qualquer navegador.', '<rect x="6" y="8" width="52" height="34" rx="3"/><path class="o" d="M27 18l10 7-10 7z"/><path d="M32 42v8M22 50h20"/><path class="o" d="M76 14v22M69 29l7 7 7-7"/><path d="M66 46h20"/>']
    ];
    function renderHelp() {
      var b = $('#cvHelpBody'); if (b.children.length) return;
      var h = '<ol class="cv-steps">' + STEPS.map(function (s, i) { return '<li class="cv-step" style="--i:' + i + '"><svg viewBox="0 0 92 62" aria-hidden="true" class="cv-ill">' + s[3] + '</svg><div><small>' + s[0] + '</small><b>' + s[1] + '</b><p>' + s[2] + '</p></div></li>'; }).join('') + '</ol>';
      h += '<div class="cv-keys">' + keyCols().map(function (col) { return '<table class="cv-kt">' + col.map(function (g) { return '<tbody><tr class="cv-kg"><th colspan="2" scope="colgroup">' + g[0] + '</th></tr>' + g[1].map(function (r) { return '<tr><th scope="row">' + r[0] + '</th><td>' + r[1] + (r[2] ? '<small>' + r[2] + '</small>' : '') + '</td></tr>'; }).join('') + '</tbody>'; }).join('') + '</table>'; }).join('') + '</div>';
      b.innerHTML = h;
    }

    /* ---------------- minhas obras (vista "hist"; dados em history.js / window.AMHist) ---------------- */
    var HS = { recs: [], q: '', sort: 'recent', fresh: false, autofocus: false, io: null, live: null, ren: null, tk: 0 };
    try { if (localStorage.getItem('canteiro.obrasOrdem') === 'name') HS.sort = 'name'; } catch (e) { }
    function noop() { }
    function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
    function slidesTxt(n) { return pad(n) + ' slide' + (n === 1 ? '' : 's'); }
    function dayDiff(t) { var a = new Date(t), b = new Date(); return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5); }
    function dmy(t) { var a = new Date(t); return pad(a.getDate()) + '/' + pad(a.getMonth() + 1) + '/' + a.getFullYear(); }
    /* "há 5 min", "ontem", "há 3 dias", "12/09/2026" */
    function agoShort(t) {
      if (!t) return '';
      var s = Math.max(0, (Date.now() - t) / 1000), dd = dayDiff(t);
      if (s < 60) return 'agora';
      if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
      if (dd <= 0) return 'há ' + Math.floor(s / 3600) + ' h';
      if (dd === 1) return 'ontem';
      if (dd < 7) return 'há ' + dd + ' dias';
      return dmy(t);
    }
    function ago(t) { var x = agoShort(t); return !x ? 'sem data' : x === 'agora' ? 'editado agora mesmo' : /^\d/.test(x) ? 'editado em ' + x : 'editado ' + x; }
    function stamp(r) { var a = new Date(r.updatedAt); return 'Editado em ' + dmy(r.updatedAt) + ' às ' + pad(a.getHours()) + ':' + pad(a.getMinutes()) + (r.createdAt ? ' · criado em ' + dmy(r.createdAt) : ''); }
    function histBtn() {
      var h = HH(), n = h && h.available() ? h.count() : 0, b = $('#cvHistBtn'); if (!b) return;
      $('#cvHistN').textContent = n ? '(' + n + ')' : '';
      b.classList.toggle('on', st.view === 'hist');
    }
    function recOf(id) { for (var i = 0; i < HS.recs.length; i++) if (HS.recs[i].id === id) return HS.recs[i]; return null; }
    function histView() {
      var ws = norm(HS.q).split(/\s+/).filter(Boolean);
      var l = HS.recs.filter(function (r) { var t = norm(r.title); return ws.every(function (w) { return t.indexOf(w) >= 0; }); });
      if (HS.sort === 'name') l.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'pt-BR', { sensitivity: 'base', numeric: true }) || b.updatedAt - a.updatedAt; });
      else l.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return l;
    }
    var ICH = {
      go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
      ren: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
      dl: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
      del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
    };
    function ich(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICH[k] + '</svg>'; }
    var HILL = '<svg class="cv-hill" viewBox="0 0 168 104" aria-hidden="true"><rect class="a" x="44" y="6" width="108" height="61" rx="3"/><rect class="a" x="32" y="16" width="108" height="61" rx="3"/><rect class="b" x="20" y="26" width="108" height="61" rx="3"/><rect class="o" x="32" y="40" width="3" height="12"/><path class="t" d="M41 42h46M41 50h28M41 64h64M41 72h48"/><circle class="o" cx="128" cy="87" r="12"/><path class="w" d="M128 81v12M122 87h12"/></svg>';
    function labels(r) { var t = '“' + r.title + '”'; return { open: 'Abrir e editar ' + t + ' — ' + slidesTxt(r.slideCount) + ', ' + ago(r.updatedAt), dup: 'Duplicar ' + t, ren: 'Renomear ' + t, dl: 'Baixar ' + t + ' em .html', del: 'Excluir ' + t }; }
    function metaHTML(r) { return '<span>' + slidesTxt(r.slideCount) + '</span><span title="' + esc(stamp(r)) + '">' + ago(r.updatedAt) + '</span>'; }
    function cardHTML(r, i, curId) {
      var L = labels(r), t = esc(r.title), mine = r.id === curId;
      return '<article class="cv-hcard' + (mine ? ' cv-hcur' : '') + '" role="listitem" data-id="' + esc(r.id) + '" style="--i:' + Math.min(i, 12) + '">' +
        '<button type="button" class="cv-hopen" aria-label="' + esc(L.open) + '"><span class="cv-pv"></span>' + (mine ? '<span class="cv-htag">Aberta no editor</span>' : '') + '</button>' +
        '<div class="cv-hb"><span class="cv-hmeta">' + metaHTML(r) + '</span><span class="cv-hname" title="' + t + '">' + t + '</span></div>' +
        '<div class="cv-hact"><button type="button" class="cv-hgo" data-h="open"><span>Abrir<span class="cv-hgx"> e editar</span></span>' + ich('go') + '</button>' +
        '<button type="button" class="cv-hic" data-h="dup" title="Duplicar" aria-label="' + esc(L.dup) + '">' + ich('dup') + '</button>' +
        '<button type="button" class="cv-hic" data-h="ren" title="Renomear (F2)" aria-label="' + esc(L.ren) + '" aria-keyshortcuts="F2">' + ich('ren') + '</button>' +
        '<button type="button" class="cv-hic" data-h="dl" title="Baixar .html" aria-label="' + esc(L.dl) + '">' + ich('dl') + '</button>' +
        '<button type="button" class="cv-hic cv-hdel" data-h="del" title="Excluir (Delete)" aria-label="' + esc(L.del) + '" aria-keyshortcuts="Delete">' + ich('del') + '</button></div></article>';
    }
    /* nome, data e rótulos de um cartão depois de renomear, sem redesenhar a grade (o foco e a prévia ficam onde estão) */
    function cardSync(card, r) {
      var L = labels(r), nm = $('.cv-hname', card);
      nm.textContent = r.title; nm.title = r.title; $('.cv-hmeta', card).innerHTML = metaHTML(r);
      $('.cv-hopen', card).setAttribute('aria-label', L.open);
      ['dup', 'ren', 'dl', 'del'].forEach(function (k) { var b = $('[data-h="' + k + '"]', card); if (b) b.setAttribute('aria-label', L[k]); });
    }
    function emptyHTML(k) {
      if (k === 'off') return HILL + '<b>Histórico indisponível neste navegador</b><p>Este navegador não deixa guardar dados de arquivos abertos do computador. Use “Salvar apresentação” no editor para gerar o arquivo .html de cada obra.</p>';
      if (k === 'none') return '<b>Nenhuma obra com “' + esc(HS.q.trim()) + '”</b><p>Confira a grafia ou busque por outra palavra do título.</p><div class="cv-hem-a"><button type="button" class="cv-ghost" data-hgo="clear">Limpar busca</button></div>';
      return HILL + '<b>Nenhuma obra guardada ainda</b><p>Cada apresentação que você monta no Canteiro entra aqui sozinha, a cada alteração. Comece uma obra ou traga o acervo de outro computador.</p><div class="cv-hem-a"><button type="button" class="cv-hem-pri" data-hgo="new">Obra nova</button><button type="button" class="cv-ghost" data-hgo="tpl">Projetos prontos</button><button type="button" class="cv-ghost" data-hgo="imp">Importar acervo</button></div>';
    }
    /* prévia viva do slide 1 (o mesmo renderizador do editor e do arquivo salvo); slide validado como no editor */
    function firstSlide(r) { var d = null; try { d = r && r.deck && r.deck.slides && has('safeDeck') ? S.safeDeck({ title: '', slides: [r.deck.slides[0]] }) : null; } catch (e) { d = null; } return d ? d.slides[0] : null; }
    function paintPv(card, play) {
      var r = recOf(card.dataset.id), pv = $('.cv-pv', card); if (!r || !pv) return null;
      if (r._s1 === undefined) r._s1 = firstSlide(r);
      if (!r._s1) { pv.classList.add('cv-pv-bad'); return null; }
      var stg = RT.renderSlide(r._s1, { play: !!play }); stg.setAttribute('aria-hidden', 'true');
      pv.innerHTML = ''; pv.appendChild(stg);
      return stg;
    }
    function histIO(on) {
      if (HS.io) { HS.io.disconnect(); HS.io = null; }
      if (!on) return;
      var cards = $$('#cvHistGrid .cv-hcard');
      if (!('IntersectionObserver' in window)) { cards.forEach(function (c) { paintPv(c); }); return; }
      var io = HS.io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); if (!(HS.live && HS.live.card === en.target)) paintPv(en.target); } }); }, { root: $('#cvHistGrid'), rootMargin: '240px 0px' });
      cards.forEach(function (c) { io.observe(c); });
    }
    /* passar o mouse (ou o foco) num cartão toca a entrada do slide 1; ao sair, volta à prévia parada */
    function liveOn(card) {
      if (HS.live && HS.live.card === card) return;
      liveOff();
      if (reduce.matches || !st.open || st.view !== 'hist') return;
      var stg = paintPv(card, true); if (!stg) return;
      void stg.offsetWidth; stg.classList.remove('am-pre'); stg.classList.add('am-in');
      var clean = null; try { clean = RT.runFx ? RT.runFx(stg) : null; } catch (e) { clean = null; }
      HS.live = { card: card, clean: clean };
    }
    function liveOff() { var l = HS.live; HS.live = null; if (!l) return; try { if (l.clean) l.clean(); } catch (e) { } if (document.contains(l.card)) paintPv(l.card); }
    function paintHist(focusId) {
      var g = $('#cvHistGrid'), em = $('#cvHistEmpty'), h = HH(), avail = !!h && h.available(), total = HS.recs.length, cur = canDismiss() && deckNow() ? deckNow().id : null, l;
      if (!total && HS.q) { HS.q = ''; $('#cvHistQ').value = ''; }
      l = histView();
      liveOff(); histIO(false);
      g.classList.toggle('cv-hfresh', !!HS.fresh); HS.fresh = false;
      g.innerHTML = l.map(function (r, i) { return cardHTML(r, i, cur); }).join('');
      g.hidden = !l.length;
      em.innerHTML = l.length ? '' : emptyHTML(!avail ? 'off' : total ? 'none' : 'zero'); em.hidden = !!l.length;
      $('#cvHistCount').textContent = !avail ? 'Indisponível' : (HS.q.trim() && l.length !== total ? pad(l.length) + ' de ' : '') + pad(total) + (total === 1 ? ' obra' : ' obras');
      $('#cvHistQ').disabled = !total; $('#cvHistExp').disabled = !total; $('#cvHistImp').disabled = !avail; $('#cvHist .cv-hnote').hidden = !avail;
      $('#cvHist .cv-pht p').textContent = avail ? 'Tudo o que você constrói fica guardado aqui, a cada alteração — abra, duplique ou baixe quando quiser.' : 'As apresentações que você constrói ficariam guardadas aqui, mas este navegador não permite.';
      $$('#cvHist [data-sort]').forEach(function (b) { b.disabled = !total; b.setAttribute('aria-pressed', String(b.dataset.sort === HS.sort)); });
      histIO(true); histMore();
      var a = document.activeElement, f = focusId ? $('#cvHistGrid .cv-hcard[data-id="' + focusId + '"] .cv-hopen') : null;
      var lost = !a || a === document.body || !cover.contains(a) || !visible(a);
      if (!f && (lost || (HS.autofocus && a === $('#cvHist [data-back]')))) f = $('#cvHistGrid .cv-hopen') || $('#cvHistEmpty button');
      HS.autofocus = false;
      if (f) f.focus({ preventScroll: !focusId });
    }
    /* grava o que o editor ainda tem pendente e relê o acervo (outra aba pode ter mudado algo) */
    function renderHist(focusId, fresh) {
      var h = HH(), tk = ++HS.tk;
      if (fresh) HS.fresh = true;
      if (!h) { HS.recs = []; paintHist(focusId); return; }
      $('#cvHist').setAttribute('aria-busy', 'true');
      h.flush().then(function () { return h.list(); }).then(function (l) {
        if (tk !== HS.tk || !st.open || st.view !== 'hist') return;
        $('#cvHist').removeAttribute('aria-busy');
        HS.recs = l; paintHist(focusId);
      }, noop);
    }
    /* a grade rola por dentro: um esfumado na borda de baixo avisa que há mais obras */
    function histMore() { var g = $('#cvHistGrid'); g.classList.toggle('cv-hmore', g.scrollHeight - g.scrollTop - g.clientHeight > 6); }
    function histLeave(closing) {
      renEnd(!!closing); liveOff(); histIO(false);
      if (closing) { HS.tk++; $('#cvHistGrid').innerHTML = ''; $('#cvHistEmpty').innerHTML = ''; }
    }
    function focCard() { var a = document.activeElement; return st.view === 'hist' && a && a.closest ? a.closest('#cvHistGrid .cv-hcard') : null; }
    function searchFocus() { var q = $('#cvHistQ'); if (q && !q.disabled) { q.focus(); q.select(); } }
    function setSort(s) { HS.sort = s === 'name' ? 'name' : 'recent'; try { localStorage.setItem('canteiro.obrasOrdem', HS.sort); } catch (e) { } paintHist(); }
    function saveKey() { if (canDismiss() && !isEmpty() && has('save')) { var nm = S.save(true); if (nm) note('Apresentação salva: ' + nm); } else note('Nada para salvar ainda — escolha como começar.'); }
    /* trocar a obra do editor por outra do acervo: a atual já fica guardada em Minhas obras, então não há o que perder;
       só se o acervo falhar (ou houver um rascunho fora dele) a capa pede confirmação, como nas outras opções */
    function switchTo(title, targetId, fn) {
      var h = HH(), d = getDraft();
      if (canDismiss() && !isEmpty()) {
        if (!h || !h.available()) { guard(title, fn); return; }
        h.saveNow().then(function (saved) { if (!st.open) return; if (saved) fn(); else guard(title, fn); });
        return;
      }
      if (d && d.id !== targetId && !(d.id && h && h.has(d.id))) { guard(title, fn); return; }
      fn();
    }
    function histOpen(id) {
      var h = HH(), cur = deckNow(); if (!h || !id) return;
      if (canDismiss() && cur && cur.id === id) { close(); if (has('toast')) S.toast('Esta obra já está aberta no editor'); return; }
      h.get(id).then(function (r) {
        if (!st.open) return;
        if (!r) { note('Esta obra não está mais em Minhas obras — talvez tenha sido excluída em outra aba.'); renderHist(); return; }
        switchTo('Abrir “' + r.title + '”?', id, function () { load(r.deck, 'Obra aberta: ' + r.title + ' · ' + r.slideCount + ' slide' + (r.slideCount > 1 ? 's' : ''), true); close(); });
      });
    }
    function histDel(id) {
      var r = recOf(id), h = HH(); if (!r || !h) return;
      var open = canDismiss() && deckNow() && deckNow().id === id;
      ask('Excluir “' + r.title + '”?', 'A obra sai de Minhas obras neste navegador. Arquivos .html já baixados não são afetados.' + (open ? ' Ela continua aberta no editor e volta para cá na próxima alteração.' : ''), 'Excluir', function () {
        var l = histView(), i = l.indexOf(r), nx = l[i + 1] || l[i - 1];
        h.remove(id).then(function (done) {
          if (!done) { note('Não foi possível excluir esta obra.'); return; }
          note('Obra excluída: “' + r.title + '”');
          HS.recs = HS.recs.filter(function (x) { return x.id !== id; });
          if (st.open && st.view === 'hist') paintHist(nx ? nx.id : null);
        });
      });
    }
    function renStart(id) {
      renEnd(true);
      var card = $('#cvHistGrid .cv-hcard[data-id="' + id + '"]'), r = recOf(id); if (!card || !r) return;
      var nm = $('.cv-hname', card), inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'cv-hrn'; inp.value = r.title; inp.maxLength = 160; inp.spellcheck = false; inp.autocomplete = 'off';
      inp.setAttribute('aria-label', 'Novo nome para “' + r.title + '”');
      nm.hidden = true; nm.parentNode.insertBefore(inp, nm.nextSibling);
      HS.ren = { id: id, inp: inp, nm: nm, card: card };
      inp.addEventListener('blur', function () { renEnd(true); });
      inp.focus(); inp.select();
    }
    function renEnd(save, refocus) {
      var R = HS.ren; if (!R) return; HS.ren = null;
      var t = R.inp.value.replace(/\s+/g, ' ').trim().slice(0, 300), r = recOf(R.id), h = HH();
      if (R.inp.parentNode) R.inp.parentNode.removeChild(R.inp);
      R.nm.hidden = false;
      if (refocus && document.contains(R.card)) $('.cv-hopen', R.card).focus({ preventScroll: true });
      if (!save || !t || !r || !h || t === r.title) return;
      R.nm.textContent = t;
      h.rename(R.id, t).then(function (nr) {
        if (!nr) { R.nm.textContent = r.title; note('Não foi possível renomear esta obra.'); return; }
        r.title = nr.title; r.updatedAt = nr.updatedAt;
        if (canDismiss() && deckNow() && deckNow().id === R.id && has('setTitle')) S.setTitle(nr.title); /* a obra aberta no editor acompanha o novo nome */
        if (document.contains(R.card)) cardSync(R.card, r);
        note('Obra renomeada: “' + nr.title + '”');
      });
    }
    function histAct(a, id) {
      var h = HH(); if (!h || !id) return;
      if (a === 'open') histOpen(id);
      else if (a === 'ren') renStart(id);
      else if (a === 'del') histDel(id);
      else if (a === 'dup') h.duplicate(id).then(function (r) {
        if (!r) { note('Não foi possível duplicar esta obra.'); return; }
        note('Obra duplicada: “' + r.title + '”'); renderHist(r.id);
      });
      else if (a === 'dl') h.get(id).then(function (r) {
        var d = null; try { d = r && has('safeDeck') ? S.safeDeck(r.deck) : null; } catch (e) { d = null; }
        if (!d || !has('exportDeck') || !has('download')) { note('Não foi possível gerar o arquivo desta obra.'); return; }
        var nm = (has('slug') ? S.slug(d.title) : 'apresentacao') + '.html';
        S.download(nm, S.exportDeck(d)); note('Arquivo baixado: ' + nm);
      });
    }
    function importPick() { var f = $('#cvHistFile'), h = HH(); if (!f || !h || !h.available()) return; f.value = ''; f.click(); }
    function exportAll() {
      var h = HH(); if (!h || !has('download')) return;
      h.exportJSON().then(function (j) {
        var n = h.count(), dt = new Date(), nm = 'canteiro-acervo-' + dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) + '.json';
        S.download(nm, j, 'application/json;charset=utf-8');
        note('Acervo exportado: ' + n + (n === 1 ? ' obra' : ' obras') + ' em ' + nm);
      });
    }
    function hgo(k) {
      if (k === 'new') act(1);
      else if (k === 'tpl') { st.returnTo = null; showView('tpl'); }
      else if (k === 'clear') { var q = $('#cvHistQ'); q.value = ''; HS.q = ''; paintHist(); q.focus(); }
    }
    /* teclas com o foco num campo da capa: Enter/Esc do renomear e da busca; o resto é digitação */
    function fieldKey(e, tg) {
      var k = e.key, lk = k.toLowerCase(), R = HS.ren;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) { if (lk === 's' || lk === 'o' || lk === 'p' || lk === 'd') e.preventDefault(); if (lk === 's') saveKey(); return; }
      if (k === 'F1') { e.preventDefault(); return; }
      if (R && tg === R.inp) { if (k === 'Enter') { e.preventDefault(); renEnd(true, true); } else if (k === 'Escape') { e.preventDefault(); renEnd(false, true); } return; }
      if (tg.id === 'cvHistQ') {
        if (k === 'Escape') { e.preventDefault(); if (tg.value) { tg.value = ''; HS.q = ''; paintHist(); } else back(); }
        else if (k === 'Enter' || k === 'ArrowDown') { var f = $('#cvHistGrid .cv-hopen'); if (f) { e.preventDefault(); f.focus(); } }
        return;
      }
      if (k === 'Escape') { e.preventDefault(); tg.blur(); }
    }
    $('#cvHistQ').addEventListener('input', function () { HS.q = this.value; paintHist(); });
    $('#cvHistFile').addEventListener('change', function () {
      var f = this.files && this.files[0], h = HH(); if (!f || !h) return;
      var rd = new FileReader();
      rd.addEventListener('load', function () {
        h.importJSON(String(rd.result)).then(function (res) {
          if (!res) { note('Este arquivo não é um acervo do Canteiro (.json).'); return; }
          var bad = res.invalid + res.failed, parts = [];
          if (res.added) parts.push(res.added + (res.added === 1 ? ' obra nova' : ' obras novas'));
          if (res.updated) parts.push(res.updated + (res.updated === 1 ? ' atualizada' : ' atualizadas'));
          if (res.kept) parts.push(res.kept + (res.kept === 1 ? ' já estava em dia' : ' já estavam em dia'));
          if (bad) parts.push(bad + (bad === 1 ? ' ignorada' : ' ignoradas'));
          note(!res.total ? 'O arquivo não tem obras.' : (res.added || res.updated ? 'Acervo importado: ' : 'Nada novo: ') + parts.join(' · '));
          if (st.open && st.view === 'hist') renderHist();
        });
      });
      rd.addEventListener('error', function () { note('Não foi possível ler este arquivo.'); });
      rd.readAsText(f);
    });
    (function () {
      var g = $('#cvHistGrid');
      g.addEventListener('mouseover', function (e) { var c = e.target.closest && e.target.closest('.cv-hcard'); if (c) liveOn(c); });
      g.addEventListener('mouseleave', function () { var c = focCard(); if (c) liveOn(c); else liveOff(); });
      g.addEventListener('scroll', histMore, { passive: true }); window.addEventListener('resize', function () { if (st.open && st.view === 'hist') histMore(); });
      var h = HH(); if (h) h.on(function () {
        histBtn(); if (!st.open || st.view !== 'home') return;
        refreshMenu();
        var f = firstOpt(); if (st.autoF && document.activeElement === st.autoF && f !== st.autoF) { f.focus({ preventScroll: true }); st.autoF = f; }
      });
    })();

    /* ---------------- menu inicial ---------------- */
    function refreshMenu() {
      var o3 = $('.cv-opt[data-k="3"]'), m = mode3(), d = m === 'draft' && getDraft(), resume = canDismiss(), cur = deckNow();
      o3.classList.remove('cv-has', 'cv-resume'); o3.removeAttribute('aria-disabled');
      /* título e número de slides em linhas separadas: o número nunca é cortado */
      function sub(t, n, x) { return '<q class="cv-q">' + esc(t) + '</q><span class="cv-n">' + n + ' slide' + (n > 1 ? 's' : '') + (x ? ' · ' + esc(x) : '') + '</span>'; }
      if (m === 'resume') {
        $('#cvO3l').textContent = 'Voltar à obra atual';
        $('#cvO3s').innerHTML = sub((cur && cur.title) || 'Apresentação', cur.slides.length);
        o3.classList.add('cv-resume');
      } else if (d) {
        $('#cvO3l').textContent = 'Retomar obra';
        $('#cvO3s').innerHTML = sub(d.title || 'Rascunho sem nome', d.slides.length);
        o3.classList.add('cv-has');
      } else if (m === 'obra') {
        var ob = obraRecent();
        $('#cvO3l').textContent = 'Retomar obra';
        $('#cvO3s').innerHTML = sub(ob.title || 'Obra sem nome', ob.slideCount, agoShort(ob.updatedAt));
        o3.classList.add('cv-has');
      } else {
        $('#cvO3l').textContent = 'Retomar obra'; $('#cvO3s').textContent = 'Nenhum rascunho salvo ainda'; o3.setAttribute('aria-disabled', 'true');
      }
      histBtn();
      $('#cvResume').hidden = !resume;
      var hr = new Date().getHours();
      $('#cvHello').textContent = hr >= 5 && hr < 12 ? 'Bom dia' : hr >= 12 && hr < 18 ? 'Boa tarde' : 'Boa noite';
      var dt = new Date();
      $('#cvLog').innerHTML = 'Diário de obra · <b>' + pad(dt.getDate()) + '.' + pad(dt.getMonth() + 1) + '.' + dt.getFullYear() + '</b>';
      hints();
    }
    function hints() {
      var h = st.view === 'home' ? '<kbd>1</kbd>–<kbd>6</kbd><em>escolher</em><kbd>←</kbd><kbd>→</kbd><em>navegar</em><kbd>Enter</kbd><em>abrir</em><kbd>F1</kbd><em>manual</em>' + (canDismiss() ? '<kbd>Esc</kbd><em>voltar à obra</em>' : '')
        : st.view === 'tpl' ? '<kbd>1</kbd>–<kbd>' + TPL.length + '</kbd><em>carregar projeto</em><kbd>←</kbd><kbd>→</kbd><em>navegar</em><kbd>Enter</kbd><em>abrir</em><kbd>Esc</kbd><em>voltar</em>'
        : st.view === 'hist' ? '<kbd>←</kbd><kbd>→</kbd><em>navegar</em><kbd>Enter</kbd><em>abrir</em><span class="cv-hkx"><kbd>F2</kbd><em>renomear</em><kbd>Del</kbd><em>excluir</em><kbd>/</kbd><em>buscar</em></span><kbd>Esc</kbd><em>' + (st.returnTo === 'editor' && canDismiss() ? 'voltar à obra' : 'voltar') + '</em>'
        : '<kbd>Esc</kbd><em>' + (st.returnTo === 'editor' && canDismiss() ? 'voltar à obra' : 'voltar ao início') + '</em>';
      $('#cvHints').innerHTML = h;
    }
    function press(b) { if (!b) return; b.classList.add('cv-press'); setTimeout(function () { b.classList.remove('cv-press'); }, 160); }
    function nudge(b) { if (!b) return; b.classList.remove('cv-nudge'); void b.offsetWidth; b.classList.add('cv-nudge'); setTimeout(function () { b.classList.remove('cv-nudge'); }, 450); }
    function act(k) {
      var b = $('.cv-opt[data-k="' + k + '"]'); st.lastOpt = b; press(b);
      if (k === 1) guard('Começar uma obra nova?', function () { load(blankDeck(), 'Nova apresentação em branco'); close(); });
      else if (k === 2) showView('tpl');
      else if (k === 3) {
        var m = mode3();
        if (m === 'resume') { close(); return; }
        if (m === 'obra') {
          var ob = obraRecent();
          HH().get(ob.id).then(function (r) {
            if (!st.open) return;
            if (!r) { nudge(b); note('Esta obra não está mais em Minhas obras.'); refreshMenu(); return; }
            load(r.deck, 'Obra retomada: ' + r.title + ' · ' + r.slideCount + ' slide' + (r.slideCount > 1 ? 's' : ''), true); close();
          });
          return;
        }
        var d = getDraft();
        if (!d) { nudge(b); note('Nenhum rascunho salvo ainda neste navegador.'); return; }
        load(d, 'Rascunho recuperado: ' + (d.title || 'apresentação')); close();
      }
      else if (k === 4) guard('Abrir outra planta?', function () { st.pendingFile = true; pickFile(); });
      else if (k === 5) { if (canDismiss()) { close(); openModels(); } else guard('Abrir o Almoxarifado?', function () { load(blankDeck(), 'Almoxarifado aberto: escolha um modelo e clique em Inserir'); close(); openModels(); }); }
      else if (k === 6) { st.returnTo = null; showView('help'); }
    }

    /* ---------------- confirmação e avisos ---------------- */
    /* pede confirmação antes de trocar a obra: a atual (vinda do editor) ou o rascunho salvo, que seria sobrescrito na 1ª alteração */
    function guard(title, fn) {
      var cur = canDismiss() && !isEmpty(), d = !cur && getDraft(), desc;
      if (cur) desc = 'A obra atual (“' + ((deckNow() && deckNow().title) || 'apresentação') + '”) será substituída. Salve antes se quiser guardá-la.';
      else if (d) desc = 'O rascunho “' + (d.title || 'sem nome') + '” (' + d.slides.length + ' slide' + (d.slides.length > 1 ? 's' : '') + ') será substituído na primeira alteração. Para continuá-lo, use 3 · Retomar obra.';
      else { fn(); return; }
      ask(title, desc, cur ? 'Substituir' : 'Continuar', fn);
    }
    /* confirmação da capa (cartão branco, botão laranja): troca de obra e exclusão em Minhas obras */
    function ask(title, desc, okLabel, fn) {
      var c = $('#cvConfirm'), prev = document.activeElement;
      $('#cvCfT').textContent = title; $('#cvCfD').textContent = desc; $('#cvCfOk').textContent = okLabel;
      c.hidden = false;
      st.confirm = { fn: fn, prev: prev };
      $('#cvCfOk').focus();
    }
    function closeConfirm(run) {
      var c = st.confirm; if (!c) return;
      st.confirm = null; $('#cvConfirm').hidden = true;
      if (run) c.fn(); else if (c.prev && cover.contains(c.prev)) c.prev.focus();
    }
    $('#cvCfOk').addEventListener('click', function () { closeConfirm(true); });
    $('#cvCfNo').addEventListener('click', function () { closeConfirm(false); });
    function note(msg) { var n = $('#cvNote'); n.textContent = msg; n.classList.add('show'); clearTimeout(note.t); note.t = setTimeout(function () { n.classList.remove('show'); }, 3200); }

    /* ---------------- vistas ---------------- */
    function showView(v) {
      var prev = st.view; st.view = v; cover.dataset.view = v;
      if (v !== 'hist') histLeave();
      $('#cvHome').classList.toggle('on', v === 'home'); $('#cvTpl').classList.toggle('on', v === 'tpl'); $('#cvHelp').classList.toggle('on', v === 'help'); $('#cvHist').classList.toggle('on', v === 'hist');
      if (v === 'tpl') renderTpl();
      if (v === 'help') { renderHelp(); backLabel('#cvHelp'); }
      if (v === 'hist') { backLabel('#cvHist'); HS.autofocus = true; renderHist(null, true); }
      histBtn();
      if (v === 'home') st.returnTo = null;
      if (v === 'home') scenePlay(); else scenePause();
      hints();
      cover.scrollTop = 0;
      var f = v === 'tpl' ? $('.cv-tcard[data-t="' + st.tplCur + '"]') : v === 'help' ? $('#cvHelp [data-back]') : v === 'hist' ? $('#cvHist [data-back]') : (prev !== 'home' && st.lastOpt) || firstOpt();
      if (f) f.focus({ preventScroll: true });
    }
    /* "Voltar" do manual e de Minhas obras: abertos pelo menu do editor, voltam direto à obra */
    function backLabel(sel) { var bb = $(sel + ' [data-back]'), toEd = st.returnTo === 'editor' && canDismiss(); bb.lastChild.previousSibling.textContent = toEd ? 'Voltar à obra ' : 'Voltar '; }
    function firstOpt() { var o3 = $('.cv-opt[data-k="3"]'); return (o3.classList.contains('cv-has') || o3.classList.contains('cv-resume')) ? o3 : $('.cv-opt[data-k="1"]'); }

    /* ---------------- abrir / fechar ---------------- */
    function restartEnter() {
      clearTimeout(st.et); cover.classList.remove('cv-enter'); void cover.offsetWidth; cover.classList.add('cv-enter');
      st.et = setTimeout(function () { cover.classList.remove('cv-enter'); }, 2600);
    }
    function open(opts) {
      var initial = !!(opts && opts.initial);
      clearTimeout(st.ct);
      if (st.open) return;
      document.documentElement.classList.remove('cv-skip'); document.documentElement.classList.add('cv-lock');
      st.open = true; st.fromEditor = !initial; st.pendingFile = false;
      var ae = document.activeElement; st.lastFocus = ae && ae !== document.body && !cover.contains(ae) ? ae : null;
      hideBanner();
      cover.classList.remove('cv-gone'); cover.removeAttribute('aria-hidden'); cover.removeAttribute('inert');
      st.view = ''; refreshMenu(); showView('home');
      var hh = HH(); if (hh) hh.refresh();
      if (!initial) {
        cover.classList.remove('cv-anim'); cover.classList.add('cv-up'); void cover.offsetWidth;
        cover.classList.add('cv-anim'); cover.classList.remove('cv-up'); restartEnter();
        st.ct = setTimeout(function () { cover.classList.remove('cv-anim'); }, 700);
        scenePlay(500);
      } else { st.et = setTimeout(function () { cover.classList.remove('cv-enter'); }, 2600); scenePlay(1300); }
      var f = firstOpt(); if (f) f.focus({ preventScroll: true });
      st.autoF = f;
    }
    function close() {
      if (!st.open) return;
      histLeave(true);
      st.open = false; st.pendingFile = false; st.returnTo = null; closeConfirm(false); scenePause(); document.documentElement.classList.remove('cv-lock');
      try { var sel = getSelection(); if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges(); } catch (er) { }
      if (SC) SC.paused = null;
      var n = $('#cvNote'); n.classList.remove('show');
      cover.classList.add('cv-anim'); void cover.offsetWidth; cover.classList.add('cv-up');
      clearTimeout(st.ct);
      st.ct = setTimeout(function () { cover.classList.add('cv-gone'); cover.classList.remove('cv-anim', 'cv-up', 'cv-dragover'); cover.setAttribute('aria-hidden', 'true'); clearPreviews(); }, reduce.matches ? 220 : 680);
      var f = st.lastFocus; st.lastFocus = null;
      if (f && document.contains(f) && f.offsetParent !== null) f.focus({ preventScroll: true }); else if (document.activeElement && cover.contains(document.activeElement)) document.activeElement.blur();
    }

    /* ---------------- teclado ---------------- */
    function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'; }
    function focusables(root) { return $$('button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])', root).filter(visible); }
    function trap(e, root) {
      var f = focusables(root); if (!f.length) { e.preventDefault(); return; }
      var a = document.activeElement, i = f.indexOf(a);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
    function navItems() { return st.view === 'home' ? $$('.cv-opt') : st.view === 'tpl' ? $$('.cv-tcard') : st.view === 'hist' ? $$('#cvHistGrid .cv-hopen') : []; }
    function moveFocus(dir) {
      var items = navItems(); if (!items.length) return false;
      var a = document.activeElement, hc = st.view === 'hist' && a && a.closest && a.closest('#cvHistGrid .cv-hcard'), i;
      if (hc) a = $('.cv-hopen', hc);
      i = items.indexOf(a);
      if (i < 0) { items[0].focus(); return true; }
      if (dir === 'ArrowRight') { items[(i + 1) % items.length].focus(); return true; }
      if (dir === 'ArrowLeft') { items[(i - 1 + items.length) % items.length].focus(); return true; }
      var r = a.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, best = null, bs = Infinity;
      items.forEach(function (b) {
        if (b === a) return; var q = b.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy, m = dir === 'ArrowDown' ? dy : -dy;
        if (m <= 4) return; var sc = m + Math.abs(dx) * 2; if (sc < bs) { bs = sc; best = b; }
      });
      if (best) best.focus();
      return true;
    }
    /* "Voltar" do manual: se ele foi aberto pelo menu Ajuda do editor, volta direto à obra */
    function back() { if ((st.view === 'help' || st.view === 'hist') && st.returnTo === 'editor' && canDismiss()) close(); else showView('home'); }
    window.addEventListener('keydown', function (e) {
      if (!st.open || modalUp()) return; /* com o modal do editor por cima, a capa não reage */
      e.stopPropagation();
      var k = e.key;
      if (k === 'F5') { e.preventDefault(); if (st.confirm) return; if (canDismiss()) { var at = e.shiftKey && S.cur != null ? S.cur : 0; close(); if (has('present')) S.present(at); } else note('Escolha uma obra para apresentar — F5 funciona no editor.'); return; }
      if (st.confirm) { if (k === 'Escape') { e.preventDefault(); closeConfirm(false); } else if (k === 'Tab') trap(e, $('#cvConfirm')); return; }
      if (k === 'Tab') { trap(e, cover); return; }
      /* campos da capa (busca e renomear em Minhas obras): digitar vence — só Esc, Enter e Tab têm papel aqui */
      var tg = e.target;
      if (tg && tg !== cover && cover.contains(tg) && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) { fieldKey(e, tg); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        var lk = k.toLowerCase();
        if (lk === 'a' || lk === 'd' || lk === 'o' || lk === 'p') e.preventDefault();
        if (lk === 's') { e.preventDefault(); saveKey(); }
        if (st.view === 'hist' && !e.altKey) {
          if (lk === 'd' && focCard()) histAct('dup', focCard().dataset.id);
          if (lk === 'f') { e.preventDefault(); searchFocus(); }
        }
        return;
      }
      if (k === 'Escape') { e.preventDefault(); if (st.view !== 'home') back(); else if (canDismiss()) close(); else nudge($('.cv-menu')); return; }
      if (k === 'F1' || k === '?') { e.preventDefault(); showView('help'); return; }
      if (st.view === 'hist') {
        var fc = focCard();
        if (k === '/') { e.preventDefault(); searchFocus(); return; }
        if (k === 'F2') { e.preventDefault(); if (fc) renStart(fc.dataset.id); return; }
        if (k === 'Delete') { e.preventDefault(); if (fc) histDel(fc.dataset.id); return; }
        if (k === 'Home' || k === 'End') { var hs = navItems(); if (hs.length) { e.preventDefault(); hs[k === 'Home' ? 0 : hs.length - 1].focus(); } return; }
      }
      if (st.view === 'home' && (k === 'm' || k === 'M')) { e.preventDefault(); showView('hist'); return; }
      if (/^[1-9]$/.test(k)) {
        var n = +k;
        if (st.view === 'home' && n <= 6) { e.preventDefault(); var b = $('.cv-opt[data-k="' + n + '"]'); if (b) b.focus({ preventScroll: true }); act(n); }
        else if (st.view === 'tpl' && n <= TPL.length) { e.preventDefault(); var t = $('.cv-tcard[data-t="' + (n - 1) + '"]'); if (t) { t.focus({ preventScroll: true }); press(t); } chooseTpl(n - 1); }
        return;
      }
      if (k.indexOf('Arrow') === 0) { if (moveFocus(k)) e.preventDefault(); return; }
      if (k === 'Backspace' && st.view !== 'home') { e.preventDefault(); back(); }
    }, true);
    window.addEventListener('scroll', function () { if (st.open && (window.scrollX || window.scrollY)) window.scrollTo(0, 0); });
    ['keyup', 'keypress', 'paste', 'copy', 'cut'].forEach(function (ev) { window.addEventListener(ev, function (e) { if (st.open) e.stopPropagation(); }, true); });

    /* ---------------- cliques ---------------- */
    cover.addEventListener('click', function (e) {
      if (!st.open) return;
      var t = e.target.closest('button'); if (!t || !cover.contains(t)) return;
      if (t.classList.contains('cv-opt')) act(+t.dataset.k);
      else if (t.classList.contains('cv-tcard')) chooseTpl(+t.dataset.t);
      else if (t.hasAttribute('data-back')) back();
      else if (t.id === 'cvResume') close();
      else if (t.id === 'cvHistBtn') { if (st.view !== 'hist') { if (st.view !== 'home') st.returnTo = null; showView('hist'); } }
      else if (t.classList.contains('cv-hopen')) histOpen(t.closest('.cv-hcard').dataset.id);
      else if (t.dataset.h) histAct(t.dataset.h, t.closest('.cv-hcard').dataset.id);
      else if (t.dataset.sort) setSort(t.dataset.sort);
      else if (t.id === 'cvHistImp' || t.dataset.hgo === 'imp') importPick();
      else if (t.id === 'cvHistExp') exportAll();
      else if (t.dataset.hgo) hgo(t.dataset.hgo);
    });
    cover.addEventListener('dblclick', function (e) { var n = st.open && e.target.closest && e.target.closest('#cvHistGrid .cv-hname'); if (n) renStart(n.closest('.cv-hcard').dataset.id); });
    cover.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('.cv-tcard'); if (t) strip(+t.dataset.t); var hc = st.view === 'hist' && e.target.closest && e.target.closest('#cvHistGrid .cv-hcard'); if (hc) liveOn(hc); });
    cover.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('.cv-tcard'); if (t && st.view === 'tpl' && +t.dataset.t !== st.tplCur) strip(+t.dataset.t); });

    /* ---------------- abrir planta (seletor de arquivo e arrastar-soltar) ---------------- */
    var fOpen = document.getElementById('fOpen');
    if (fOpen) {
      fOpen.addEventListener('change', function () {
        if (!st.open || !st.pendingFile) return;
        var f = this.files && this.files[0]; if (!f) return;
        readDeck(f, function (ok) { if (!st.open) return; if (ok) { st.pendingFile = false; close(); } else note('Este arquivo não parece uma apresentação salva pelo Canteiro.'); });
      });
      fOpen.addEventListener('cancel', function () { st.pendingFile = false; });
    }
    function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
    cover.addEventListener('dragover', function (e) { if (!st.open || !hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; cover.classList.add('cv-dragover'); });
    cover.addEventListener('dragleave', function (e) { if (!e.relatedTarget || !cover.contains(e.relatedTarget)) cover.classList.remove('cv-dragover'); });
    cover.addEventListener('drop', function (e) {
      if (!st.open) return; e.preventDefault(); cover.classList.remove('cv-dragover');
      var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
      readDeck(f, function (ok) {
        if (!ok) { note('Este arquivo não parece uma apresentação salva pelo Canteiro.'); return; }
        guard('Abrir “' + f.name + '”?', function () { if (has('openFile')) S.openFile(f); close(); });
      });
    });

    /* ---------------- atalho extra: a marca no topo do editor volta à capa ---------------- */
    var brand = document.querySelector('#top .brand');
    if (brand && !brand.hasAttribute('data-cover')) {
      brand.setAttribute('data-cover', '1'); brand.setAttribute('role', 'button'); brand.tabIndex = 0; brand.title = 'Início — voltar à capa do Canteiro'; brand.style.cursor = 'pointer';
      brand.addEventListener('click', function (e) { if (e.detail) brand.blur(); open(); });
      brand.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }

    /* ---------------- início ---------------- */
    sceneInit();
    window.AMCover = { open: function (s) { open(); if (s === 'manual' || s === 'tpl') showView(s === 'manual' ? 'help' : 'tpl'); else if (s === 'hist') showView('hist'); }, openManual: function () { open(); st.returnTo = 'editor'; showView('help'); }, openHist: function () { open(); st.returnTo = 'editor'; showView('hist'); }, close: function () { close(); }, isOpen: function () { return st.open; }, templates: TPL.map(function (t) { return t.name; }), buildTemplate: function (i) { return buildTpl(i); } };
    if (!S || !RT || !mk) { cover.classList.add('cv-gone'); return; }
    if (skip) { cover.classList.add('cv-gone'); cover.classList.remove('cv-enter'); cover.setAttribute('aria-hidden', 'true'); }
    else open({ initial: true });
    document.documentElement.classList.remove('cv-boot');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
