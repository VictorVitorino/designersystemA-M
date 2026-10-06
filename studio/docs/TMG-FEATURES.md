# TMG-FEATURES — presenter features in "TMG · Cultura em Movimento", and how to rebuild them in Canteiro's exported player

Source analysed: `/root/.claude/uploads/d1659d46-7fc1-552e-ba5d-02ae16117f1f/178dcbd3-TMG_-_Cultura_e_Organiza__o.html` (387 KB, 27 slides). Base64-stripped copy for reading: `/tmp/claude-0/-home-user-videosflows/d1659d46-7fc1-552e-ba5d-02ae16117f1f/scratchpad/tmg.nob64.html` (line numbers below refer to this copy).
Method: I read the CSS (lines 10–421) and JS (lines 861–1787), then drove the file in Playwright/Chromium at 1440×900 (plus 1280×720, 1024×768, 700×900, 390×844, reduced motion and print), using keys, clicks, hover and double clicks.
Scripts are in `…/scratchpad/qa-understand/tmg-analyst/` (`lib.js`, `p1.js`–`p8.js`). The fonts come from the local copy in `scratchpad/fonts2`, with Barlow Condensed aliased to Roboto Condensed.
Screenshots are in **`/tmp/claude-0/-home-user-videosflows/d1659d46-7fc1-552e-ba5d-02ae16117f1f/scratchpad/qa-understand/tmg-analyst/shots/`**, shortened below to `shots/`.

Target: Canteiro's player is `AMRT.player()` in `studio/runtime.js` lines 436–481 plus `.amp*` CSS in `runtime.css` lines 134–158. The editor's present mode **and** the downloaded HTML (`editor.js exportHTML()`, line 1475) both run it. **Everything below goes into `runtime.js`/`runtime.css`**, so it works in both places.

Brand rules for the rebuild: navy `#002A46`, steel `#4A6FA5`/`#43698F`/`#7EA1C3`, ice `#DCE5F0`, single orange `#F78C16`, **never red**. TMG uses `#BC0404` in places and must not be copied. Fonts are Roboto Condensed (titles), Inter (UI text) and JetBrains Mono (eyebrows/numbers). Copy is pt-BR.

---

## 0. TL;DR (what the user means, mapped to TMG code)

| User's words | What it actually is in TMG | DOM | Where on screen |
|---|---|---|---|
| "linha do tempo de apresentação" | **Story rail**: one labelled segment per chapter (CONTEXTO · CULTURA · ORGANIZAÇÃO · BENCHMARKS · REORGANIZAÇÃO). Each fills with a navy→orange gradient as you move through that chapter. There is also a 4 px overall progress line at the very top. | `#rail` (built at line 1666), `#progress` (line 424) | Rail: **fixed bottom-left** (`left:22px;bottom:12px`). `#progress`: fixed top, 4 px. |
| "índice … sensacional" | The page counter `4 / 27 ▾` is a button. It opens a popover listing all 27 slides, grouped by chapter, with the current one highlighted. Shortcut **G**. | `#cnt.idxBtn` + `#idxP` (lines 1777–1784) | Popover anchored bottom-right, above the controls |
| (chapter transitions) | A full-slide **chapter card** ("PARTE 01 / Cultura / subtitle / giant 01") shown when you enter a new chapter going forward, behind a 3-bar **wipe**. | `#chap`, `#wipe` (lines 1646–1654) | Inside the slide |
| "resumo do slide que ajuda na apresentação" | The **"Sobre este slide"** panel: slide title plus 1–3 sentences on what the slide shows and how to read it. Shortcut **I**. The text is hand-written per slide in a dictionary (`D`), with `data-desc` as an override. It is **not** auto-generated and **not** editable. | `#bInfo` + `#infoP` (lines 1745–1775) | Popover bottom-right |
| "Resumo executivo / final" | Content slides, not tools: slide 2 has 4 "acts" that flip to analogies plus a "Roteiro" agenda that jumps to chapters; slide 26 has insights plus a decisions checklist that drives a readiness gauge. | slides 2 and 26 | — |
| "ampliar gráficos" | Hovering any of 15 known charts shows a floating **⤢** button. Clicking it, or **double-clicking** the chart, opens a blurred-backdrop modal with a **re-rendered, larger clone** (SVGs re-rendered with vectors, HTML scaled). Esc or a backdrop click closes it. | `.fzb` + `#fzm` (lines 1724–1738) | Inside the slide |

Not present in TMG: speaker notes, comments, editing, persistence, search, thumbnails, presenter view. Nothing is saved: no `localStorage`, `contenteditable` or inputs. Comments and editing are another builder's scope (items 2 and 9); hooks for them are noted below.

> **Discrepancy to note:** the task brief calls the chapter bar the "top section progress bar". In TMG the **chapter rail sits at the bottom-left**, next to the controls. Only the 4 px `#progress` line is at the top. Both are documented below. Recommended placement in Canteiro is in §1.3, with an open question in §12.

---

## 1. Linha do tempo — the story rail (`#rail`) and the top progress line (`#progress`)

### 1.1 What the user sees
Screenshots: `shots/01-cover.png`, `shots/07-rail-closeup.png`, `shots/32-rail-mid-slide13.png`, `shots/34-rail-hover.png`, `shots/33-top-progress.png`.

- Bottom-left, under the slide: 5 labels in small caps (9.5 px, 700, uppercase, letter-spacing .06em), each above a 5 px rounded track.
- **Completed chapters** have a track 100 % full (navy→orange gradient). The **active chapter** has a dark label (`#122143`) and a track filled `(k+1)/n`, where k is the position of the current slide inside the chapter. **Future chapters** are grey and 0 %.
  Example on slide 13: CONTEXTO 100 %, CULTURA 100 %, **ORGANIZAÇÃO 60 %** (3 of 5), BENCHMARKS 0 %, REORGANIZAÇÃO 0 %.
- The segment width is proportional to the chapter's slide count: `max(76px, n×18px)`. Here that gives 76 / 144 / 90 / 76 / 180 px, 606 px in total with 10 px gaps.
- Hovering a label turns it orange. The native tooltip (`title`) reads "Cultura · telas 3–10".
- **Clicking a segment jumps to the first slide of that chapter.** Going forward this plays the wipe and the chapter card (`shots/35-chap-part4-via-rail.png`).
- The fill animates `width .55s cubic-bezier(.2,.7,.2,1)`.
- `#progress`: a 4 px bar fixed at the top of the window, `linear-gradient(90deg,#1F3263,#F78C16)`, width `(i+1)/N`, `transition: width .5s`. It is not clickable.

### 1.2 TMG implementation (verbatim, trimmed)
Chapters come from each slide's `data-p` attribute (`<section class="slide" data-p="1 · Cultura" data-t="Visão única" …>`). The rail's labels and predicates are **hard-coded**:

```js
// line 1665–1666
const parts=[["Contexto",s=>!s.dataset.p||s.dataset.p==="Contexto"],["Cultura",s=>s.dataset.p==="1 · Cultura"],
  ["Organização",s=>s.dataset.p==="2 · Organização"],["Benchmarks",s=>s.dataset.p==="3 · Benchmarks"],["Reorganização",s=>s.dataset.p==="4 · Reorganização"]];
const rail=H("div",{id:"rail"},document.body);
FX.rail=parts.map(([n,f])=>{const idx=slides.map((s,i)=>f(s)?i:-1).filter(i=>i>=0);
  const d=H("div",{class:"seg2",style:`width:${Math.max(76,idx.length*18)}px`},rail);H("span",null,d,n);
  const bar=H("i",null,d);const b=H("b",null,bar);
  d.addEventListener("click",()=>go(idx[0]));d.title=`${n} · telas ${idx[0]+1}–${idx[idx.length-1]+1}`;return{idx,d,b}});

// line 1739 — runs on every slide change (activate() is wrapped)
FX.onSlide=i=>{FX.rail.forEach(r=>{const k=r.idx.indexOf(i);r.d.classList.toggle("on",k>=0);
  r.b.style.width=k<0?(i>r.idx[r.idx.length-1]?"100%":"0%"):((k+1)/r.idx.length*100)+"%"}); …};
```
```css
/* lines 316–323 */
#rail{position:fixed;left:22px;bottom:12px;z-index:60;display:flex;gap:10px;align-items:flex-end;max-width:calc(100vw - 640px)}
#rail .seg2{display:flex;flex-direction:column;gap:5px;cursor:pointer}
#rail .seg2 span{font:700 9.5px var(--fb);letter-spacing:.06em;text-transform:uppercase;color:#7C8A99;white-space:nowrap;transition:color .3s}
#rail .seg2 i{display:block;height:5px;border-radius:99px;background:#CFD8E2;position:relative;overflow:hidden}
#rail .seg2 i b{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#1F3263,#F78C16);transition:width .55s cubic-bezier(.2,.7,.2,1)}
#rail .seg2.on span{color:#122143}  #rail .seg2:hover span{color:#F78C16}
@media (max-width:1100px){#rail{display:none}}
```
The fill formula, written out:
```
for each chapter c with slide indexes idx[]:
  k = idx.indexOf(current)
  k >= 0           -> active, fill = (k+1)/idx.length
  current > last   -> done,   fill = 100%
  otherwise        -> future, fill = 0%
```
Responsive behaviour: the rail is **removed entirely below 1100 px** (`shots/30-resp-1024x768.png`), so tablet and laptop-split users lose it. Its `max-width: calc(100vw - 640px)` keeps it clear of the controls. Measured box at 1440: `x 22, y 867, w 606, h 21`. Each segment's hit area is only 21 px tall.

Defects not to copy:
1. Chapters are hard-coded by name.
2. The fill assumes chapters are contiguous.
3. The rail disappears below 1100 px.
4. It is not keyboard-focusable (divs, no role).
5. It still prints: there is no `display:none` in `@media print`. Playwright print emulation confirmed `#rail` stays `flex`.

### 1.3 Canteiro spec — `.amp-rail`

**Chapter source (generic):** see `RT.sectionsOf(deck)` in §9. It works on any deck:
- an explicit `slide.sec` (new optional field, inherited by the following slides), **or**
- auto-detected "Divisor de capítulo" slides: the editor's `section` layout, or any dark slide with a 1–2 digit number ≥ 64 px plus a title ≥ 34 px.

Slides before the first chapter form an intro chapter labelled **"Abertura"**. **The rail is rendered only if there are ≥ 2 chapters.** Otherwise the player looks exactly as it does today.

**Placement:** a 30 px row **between `.amp-view` and `.amp-bar`**. It is full width and inherits the bar's dark background, so it reads as a timeline sitting on top of the controls. This matches TMG (rail beside the controls at the bottom) and keeps the slide area clean. Set `--amp-rail-h` on `.amp.has-rail` and subtract it everywhere the bar height is used:

```css
.amp.has-rail{--amp-rail-h:30px}
.amp-deck{width:min(100vw,calc((100vh - 52px - var(--amp-rail-h,0px)) * 16 / 9))}   /* replaces line 136 width */
.amp-prog{bottom:calc(52px + var(--amp-rail-h,0px))}                                  /* line 158 */
.amp-rail{flex:none;height:var(--amp-rail-h);display:flex;align-items:flex-end;gap:10px;padding:0 18px 5px;background:#001424}
.amp-rs{all:unset;box-sizing:border-box;min-width:28px;display:flex;flex-direction:column;gap:5px;padding-top:4px;cursor:pointer}
.amp-rs-l{font:700 9.5px/1 Inter,Roboto,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7EA1C3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .3s}
.amp-rs-t{display:block;height:5px;border-radius:99px;background:rgba(255,255,255,.14);position:relative;overflow:hidden}
.amp-rs-t b{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:inherit;background:linear-gradient(90deg,#43698F,#F78C16);transition:width .55s cubic-bezier(.2,.7,.2,1)}
.amp-rs.on .amp-rs-l{color:#fff}
.amp-rs:hover .amp-rs-l,.amp-rs:focus-visible .amp-rs-l{color:#F78C16}
.amp-rs:focus-visible{outline:2px solid #F78C16;outline-offset:2px;border-radius:3px}
@media (max-width:1099px){.amp-rs:not(.on) .amp-rs-l{opacity:0}}          /* tablet: only the active label */
@media (max-width:760px){.amp.has-rail{--amp-rail-h:16px}.amp-rs-l{display:none}.amp-rail{gap:4px;padding:0 10px 5px}}
@media (prefers-reduced-motion:reduce){.amp-rs-t b{transition:none}}
@media print{.amp-rail{display:none!important}}
```
Notes on the CSS:
- On a dark bar TMG's `#1F3263` start colour would be invisible, so the fill uses steel `#43698F` → orange.
- **Segment width:** use `style="flex:<n> 1 0"`, where n is the chapter's slide count (min-width 28 px), instead of TMG's fixed `max(76,n×18)`. It stays proportional and fills any width, so there is no 1100 px cutoff.

**DOM** (built once in `player()`, after `wrap` exists):
```html
<nav class="amp-rail" aria-label="Linha do tempo da apresentação">
  <button type="button" class="amp-rs" data-sec="0" style="flex:2 1 0" title="Abertura · slides 1–2" aria-label="Abertura, slides 1 a 2">
    <span class="amp-rs-l">Abertura</span><i class="amp-rs-t"><b></b></i></button>
  <button type="button" class="amp-rs" data-sec="1" style="flex:8 1 0" title="Cultura · slides 3–10" …>…</button>
</nav>
```
Insert it with `wrap.insertBefore(railEl, wrap.querySelector('.amp-bar'))` and add `wrap.classList.add('has-rail')`.

**Update** (call from the new `show(i)`, §3.3). This is the same formula as TMG, plus ARIA:
```js
function railSync(i) {
  SECS.forEach(function (sc, n) {
    var b = railBtns[n], k = sc.idx.indexOf(i), last = sc.idx[sc.idx.length - 1];
    b.classList.toggle('on', k >= 0);
    if (k >= 0) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    b.querySelector('b').style.width = (k < 0 ? (i > last ? 100 : 0) : (k + 1) / sc.idx.length * 100) + '%';
  });
}
```
**Click:** `go(sc.idx[0], {force: true})`. `force` skips a visible chapter card (§3.3). Add `mousedown → preventDefault()` on the rail buttons so the mouse does not leave focus on them (see §6.4).

**Top progress:** keep Canteiro's existing `.amp-prog` (2 px orange, overall progress) unchanged. The rail is the per-chapter progress. Do not add a second top bar.

---

## 2. Índice — the counter popover (`#cnt` → `#idxP`) and other index-like things

### 2.1 What the user sees
Screenshots: `shots/10-index-open.png` (opened by clicking the counter on slide 4), `shots/10b-index-scrolled.png`, `shots/36-index-1280x720.png`, `shots/14-info-and-index.png` (overlap defect).

- The counter in the controls reads `4 / 27 ▾`. It is navy (`#122143`) and turns orange with navy text on hover or while open. Tooltip: "Índice · escolha a página (tecla G)".
- The popover is 400 px wide, white, radius 12, with a **5 px orange top border** and shadow `0 22px 50px rgba(14,28,57,.32)`. Anchor: `right:22px; bottom:62px`. Max height `min(640px, 100vh − 90px)`. The list scrolls.
- Header: **"ÍNDICE"** (11 px, 800, letter-spacing .14em, `#B35F00`) and a × button.
- Group headers per chapter: "CONTEXTO", "PARTE 1 · CULTURA" … (10.5 px, 800, uppercase, steel `#5E8AB4`).
- Items are buttons on a grid `30px 1fr`: a 2-digit number (`04`, 11 px, 800, `#98A6B3`) and the slide title (`data-t`, 12.5 px, 600, navy). Hover background `#F4F7FA`. **Current slide:** background `#FEF1E2`, number in orange.
- Open/close animation: `opacity 0→1` and `translateY(10px)→0` over .2s. Closed state has `pointer-events:none`.

### 2.2 Behaviour (measured)
| Action | Result |
|---|---|
| Click `#cnt`, press **G**/**g**, or Enter/Space while `#cnt` is focused (it has `role=button tabindex=0`) | Toggles open. On open: marks `.cur` and calls `scrollIntoView({block:'center'})` on the current item. |
| Click an item | Closes, then `go(i)`. A forward jump into another chapter plays the wipe and chapter card. |
| Click anywhere outside | Closes (window `click` listener; the panel stops propagation). |
| **Esc** | Closes. The same Esc also closes "Sobre este slide". |
| ← / → while open | **Still navigates slides, the panel stays open and the highlight goes stale** (measured: slide went 4→5 while `.cur` stayed on 04). Defect. |
| Open "Sobre este slide" too (I then G) | **The two popovers overlap** at the same anchor; the index (z 62) covers the info panel (z 61). Defect (`shots/14-info-and-index.png`). |
| Focus | Not moved into the list. No ↑/↓ navigation. G and I fire even with modifiers. Defect. |

Code (lines 1777–1784):
```js
const c=$("cnt");c.setAttribute("role","button");c.setAttribute("tabindex","0");c.title="Índice · escolha a página (tecla G)";c.classList.add("idxBtn");
const ix=H("div",{id:"idxP"},document.body);… H("span",null,hd,"Índice"); … const ls=H("div",{class:"xl"},ix);
const PN={"Contexto":"Contexto","1 · Cultura":"Parte 1 · Cultura",…};
let last=null,items=[];slides.forEach((s,i)=>{const p=s.dataset.p||"Contexto";if(p!==last){H("div",{class:"xg"},ls,PN[p]||p);last=p}
  const b=H("button",{class:"xi"},ls);H("b",null,b,String(i+1).padStart(2,"0"));H("span",null,b,s.dataset.t);
  b.addEventListener("click",()=>{set(false);go(i)});items.push(b)});
const set=v=>{open=v;ix.classList.toggle("on",v);c.classList.toggle("on",v);
  if(v){items.forEach((b,k)=>b.classList.toggle("cur",k===cur));const a=items[cur];if(a)a.scrollIntoView({block:"center"})}};
```
```css
#controls #cnt.idxBtn::after{content:"▾";font-size:11px;opacity:.8}
#idxP{position:fixed;right:22px;bottom:62px;z-index:62;width:400px;max-height:min(640px,calc(100vh - 90px));display:flex;flex-direction:column;background:#fff;border-radius:12px;border-top:5px solid #F78C16;box-shadow:0 22px 50px rgba(14,28,57,.32);opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .2s,transform .2s}
#idxP.on{opacity:1;transform:none;pointer-events:auto}
#idxP .xi{display:grid;grid-template-columns:30px 1fr;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:transparent;border-radius:8px;padding:6px 8px;font:600 12.5px var(--fb);color:#002B49}
#idxP .xi.cur{background:#FEF1E2}#idxP .xi.cur b{color:#F78C16}
```

### 2.3 Other index-like elements in TMG
- **"Roteiro" agenda** at the bottom of slide 2 (`#agenda`, line 1633; `shots/03-resumo-exec.png`): 4 cards "1 Parte 1 · Cultura · telas 3–10". The number is coloured per chapter, with a 5 px coloured top border. Clicking goes to the first slide of the chapter. Generated from `data-p`.
- **Dots** `#dots`: one 10 px dot per slide (active = 26 px orange pill). **Hidden** in the final version (`#dots{display:none!important}`) and replaced by the rail.
- **Header chip** in every slide's top band (`… <span class="am-chip">4 / 27</span>`) and **footer** `TMG · CULTURA EM MOVIMENTO · <source> · 4 / 27`. These are static, inside the slide.
- **Hash** `#N` (1-based) is written with `history.replaceState` on every change and read once at load (deep link). There is no `hashchange` listener. Canteiro already uses `#/N` with `hashchange`, so keep Canteiro's.

### 2.4 Canteiro spec — `.amp-idx`
**Trigger:** turn `.amp-pos` into a button. Keep its current look and add a caret:
```html
<button type="button" class="amp-pos" data-a="index" aria-haspopup="dialog" aria-expanded="false" title="Índice (G)"><b>04</b> / 27<span class="amp-caret" aria-hidden="true">▾</span></button>
```
```css
.amp-pos{all:unset;cursor:pointer;font-family:Roboto,sans-serif;letter-spacing:.12em;color:#7EA1C3;min-width:72px;text-align:center;font-size:14px;height:34px;padding:0 10px;border-radius:8px;transition:background .2s,color .2s}
.amp-pos:hover,.amp-pos[aria-expanded=true]{background:#F78C16;color:#00192B}.amp-pos:hover b,.amp-pos[aria-expanded=true] b{color:#00192B}
.amp-pos:focus-visible{outline:2px solid #F78C16;outline-offset:2px}
.amp-caret{font-size:10px;margin-left:6px;opacity:.8;letter-spacing:0}
```
**Panel.** Centred above the counter, because Canteiro's counter is centred in the bar. It lives inside `.amp`, which is already `position:fixed;inset:0`.
```css
.amp-pop{position:absolute;z-index:6;background:#fff;color:#002A46;border-radius:12px;box-shadow:0 22px 50px rgba(0,20,36,.45);opacity:0;transform:translateY(10px);pointer-events:none;visibility:hidden;transition:opacity .2s,transform .2s,visibility 0s .2s}
.amp-pop.on{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .2s,transform .2s,visibility 0s}
.amp-idx{left:50%;bottom:calc(52px + var(--amp-rail-h,0px) + 10px);width:400px;max-width:calc(100vw - 24px);margin-left:-200px;max-height:min(640px,calc(100vh - 52px - var(--amp-rail-h,0px) - 24px));display:flex;flex-direction:column;border-top:5px solid #F78C16}
@media (max-width:424px){.amp-idx{left:12px;right:12px;width:auto;margin-left:0}}
.amp-pop-h{display:flex;align-items:center;justify-content:space-between;padding:10px 14px 6px 16px;font:500 11px/1 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#B35F00}
.amp-pop-x{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:6px;font:700 20px/1 Inter,sans-serif;color:#7E8FA3}.amp-pop-x:hover{background:#EEF2F7;color:#002A46}
.amp-idx-l{overflow:auto;padding:0 8px 10px;overscroll-behavior:contain}
.amp-idx-g{font:700 10.5px/1 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#43698F;padding:12px 8px 5px}
.amp-idx-i{all:unset;box-sizing:border-box;display:grid;grid-template-columns:30px 1fr;gap:8px;align-items:center;width:100%;border-radius:8px;padding:6px 8px;font:600 12.5px/1.3 Inter,sans-serif;color:#002A46;cursor:pointer}
.amp-idx-i b{font:500 11px 'JetBrains Mono',monospace;color:#8C9BB0}
.amp-idx-i:hover,.amp-idx-i:focus-visible{background:#EEF2F7;outline:none}
.amp-idx-i[aria-current=page]{background:#FEF1E2}.amp-idx-i[aria-current=page] b{color:#F78C16}
@media (prefers-reduced-motion:reduce){.amp-pop,.amp-pop.on{transition:none;transform:none}}
@media print{.amp-pop{display:none!important}}
```
```html
<div class="amp-pop amp-idx" role="dialog" aria-label="Índice da apresentação">
  <div class="amp-pop-h"><span>Índice · 27 slides</span><button type="button" class="amp-pop-x" aria-label="Fechar índice">×</button></div>
  <div class="amp-idx-l">
    <div class="amp-idx-g">Abertura</div>
    <button type="button" class="amp-idx-i" data-i="0"><b>01</b><span>Título do slide</span></button> …
    <div class="amp-idx-g">Parte 1 · Cultura</div> …
  </div></div>
```
- **Titles** come from `RT.slideTitle(s, i)` (§9). Insert them with `textContent`, never `innerHTML`.
- **Grouping** follows `SECS`. With no chapters there are no group headers (a flat list).
- Header text: `Índice · N slides`.

**Behaviour.** This fixes TMG's defects.
- Open with a counter click, **G**, or Enter/Space on the focused counter. Opening **closes the Resumo panel** (one popover at a time).
- On open: set `aria-current="page"` on the current item, `scrollIntoView({block:'center'})`, then `focus()` that item.
- **↑/↓** move focus between items (wrap-around). **Home/End** go to the first/last item. **Enter** or a click calls `go(i,{force:true})` and closes.
- **Esc** or × closes and returns focus to the counter. A click outside closes (window `pointerdown` whose target is not inside the panel or the counter).
- ←/→ keep navigating slides while the panel is open. **`show(i)` must refresh `aria-current`**, so the highlight never goes stale.
- Tab inside the panel: allowed. A `focusout` to outside the panel closes it.

---

## 3. Chapter card (`#chap`) and the cinematic wipe (`#wipe`)

### 3.1 What the user sees
Frames after pressing → from slide 2 to slide 3, the first slide of "1 · Cultura":
- `shots/05-chap-300ms.png`: wipe bars covering the slide.
- `shots/05-chap-650ms.png`: the navy bar leaving and the card underneath.
- `shots/05-chap-900ms.png`: kinetic title in, subtitle fading, line growing.
- `shots/05-chap-1400ms.png`: card complete.
- `shots/06-visao-unica.png`: the slide after the card.

Plain wipes (no card): `shots/02-wipe-120ms.png` … `02-wipe-900ms.png`, and backwards `shots/08-back-wipe-250ms.png`.

The card shows:
- dark radial background with a slow "aurora" drift;
- a giant faint chapter number top-right (`01`, 419 px, 6 % white), which drifts in from the right and parallaxes with the mouse;
- "PARTE 01" eyebrow in orange with wide tracking;
- the chapter title in 131 px condensed, words rising one by one;
- a subtitle line (23 px, ice blue);
- an orange→steel line growing to 520 px;
- "clique para pular ›" bottom-right.

### 3.2 Exact timeline of `go(i)` (line 1649)
`busy=true` for the whole wipe. **Any `go()` while busy is dropped**, including the second → of a double press: measured 2→3→… ended on 3, not 4.

| t (ms) | Event |
|---|---|
| 0 | `#wipe` visible. Three full-height bars (orange `#F78C16`, steel `#5E8AB4`, navy `#002B49`, stacked so navy ends on top), each `skewX(-12deg)`, animate `translateX(-110% → 0)` (forward) or `+110% → 0` (backward). 420 ms each, delays **0 / 70 / 140 ms**, easing `cubic-bezier(.7,0,.3,1)`, `fill:forwards`. |
| 560 | Slide swap under cover. **Without a chapter:** `activate(i,false)` adds `.active.play.entering` (slide `sIn` .55s: `translateX(34px)→0` and fade, or `-34px` backwards) and the per-element `[data-a]` stagger starts. **With a chapter:** `activate(i,true)` (no entering), `.play` is **removed** (elements stay hidden) and `chapter(meta, done)` is shown. |
| 560 | Bars exit: `translateX(0 → +110%·dir)`, 460 ms, delays **140 / 70 / 0** (navy first), so the reveal comes from the top bar. |
| 1200 | `#wipe` hidden, `busy=false`. |
| 560 + 0…1300 | Card internals: `.n` `translateX(80px)→0` with fade 1300 ms. h1 words `translateY(108%)→0` .75 s, stagger 45 ms, +160 ms. `.ln` width 0→520 px, 900 ms, delay 300. `p` fade-up 14 px, 700 ms, delay 500. |
| 2660 | Auto end (`setTimeout(end, 2100)` after show), or **click anywhere on the card**. `end()` calls `done()` **immediately** (slide gets `.play`, counters and per-slide hook run, so entrance animations play under the fading card) and fades the card out over **450 ms**, then clears it. |

**When the card shows:** `!back && nextP !== prevP && CH[nextP]`. That means forward navigation only, entering a different `data-p`, and only if that chapter has a CH entry ("Contexto" has none). Going back never shows a card (`shots/08-back-wipe-250ms.png`). It shows for any forward route: →, End (`shots/09-end-last.png` shows the Part 4 card), a rail click or an index pick.

**Reduced motion or deep link:** `go()` calls `activate(i,true)` directly, with no wipe and no card (`shots/31-reduced-motion-150ms.png`).

**Defect (measured, `shots/37-nav-during-chapter-card.png`):**
1. Pressing → after `busy` clears (1.2 s) but while the card is still visible starts a new wipe and swaps to slide 4.
2. The card (z 85) stays **over** slide 4 until its 2.1 s timer ends.
3. Then `done()` adds `.play` to the **old** slide 3 instead of the current one.

**In Canteiro, a nav key while the card is visible must only skip the card.**

Card content dictionary (line 1635):
```js
const CH={"1 · Cultura":["01","Cultura","Como a TMG pensa, decide e sustenta, o que as sete vozes revelam."],…};
function chapter(meta,done){const c=$("chap");c.innerHTML=`<div class="n">${meta[0]}</div><div class="ey">PARTE ${meta[0]}</div><h1>${meta[1]}</h1><p>${meta[2]}</p><div class="ln"></div><div class="sk">clique para pular ›</div>`;
 kin(c.querySelector("h1"));c.classList.add("on","play");
 ln.animate([{width:"0px"},{width:"520px"}],{duration:900,delay:300,easing:"cubic-bezier(.2,.7,.2,1)",fill:"forwards"});
 p.animate([{opacity:0,transform:"translateY(14px)"},{opacity:1,transform:"none"}],{duration:700,delay:500,fill:"backwards"});
 nn.animate([{opacity:0,transform:"translateX(80px)"},{opacity:1,transform:"none"}],{duration:1300,easing:"cubic-bezier(.2,.7,.2,1)"});
 let ended=false;const end=()=>{if(ended)return;ended=true;c.animate([{opacity:1},{opacity:0}],{duration:450}).onfinish=()=>{c.classList.remove("on","play");c.innerHTML=""};done()};
 c.onclick=end;setTimeout(end,2100)}
```
`kin()` (line 1627) wraps each word as `<span class="kw"><span style="--k:n">word</span></span>`:
```css
.kw{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .02em .1em;margin-bottom:-.1em}
.kw>span{display:inline-block;transform:translateY(108%)}
.play .kw>span{animation:kUp .75s var(--ease) both;animation-delay:calc(var(--k,0)*45ms + 160ms)} @keyframes kUp{to{transform:none}}
```
Layering inside `#stage` (1600×900 logical, scaled): `#chap` z 85 < `#wipe` z 90 < `#fzm` z 95 < `#bmM` z 96. The overlays sit inside the stage, so they scale with the slide. Popovers and controls live in screen space.

### 3.3 Canteiro spec — wipe + chapter card

**Where the card shows.** In Canteiro a chapter can be a real **divider slide**. Showing a card *and* the divider would double the moment. Rules:
1. Card: forward (`i > prev`), `secOf[i] !== secOf[prev]`, target chapter not intro, target slide **not** a divider, `deck.nav && deck.nav.chapters === false` is not set, and no reduced motion. This happens when chapters come from `slide.sec` without a divider slide.
2. Entering a **divider slide** forward uses the wipe (no card); the divider's own entrance animations are the reveal.
3. New optional per-slide transition `tr:'wipe'` (add it to the editor's transition picker next to fade/slide/zoom/none). It uses the same wipe on any slide.

**DOM** (inside `.amp-deck`, so it is exactly 16:9 and scales):
```html
<div class="amp-wipe" aria-hidden="true"><i></i><i></i><i></i></div>
<div class="amp-chap" aria-live="polite"></div>
```
```css
.amp-wipe{position:absolute;inset:0;z-index:20;pointer-events:none;overflow:hidden;visibility:hidden}
.amp-wipe i{position:absolute;top:-5%;bottom:-5%;left:-10%;width:120%;transform:translateX(-110%) skewX(-12deg)}
.amp-wipe i:nth-child(1){background:#F78C16}.amp-wipe i:nth-child(2){background:#4A6FA5}.amp-wipe i:nth-child(3){background:#002A46}
.amp-chap{position:absolute;inset:0;z-index:15;display:none;overflow:hidden;cursor:pointer;color:#fff;container-type:size; /* cqw of children = % of card (= deck) width; do NOT put container-type on .amp-deck */
  background:radial-gradient(75% 89% at 70% 30%,#0B3A5E 0%,#002A46 45%,#00192B 85%)}
.amp-chap.on{display:block}
.amp-chap::before{content:"";position:absolute;inset:-25%;pointer-events:none;
  background:radial-gradient(40% 47% at 28% 32%,rgba(74,111,165,.28),transparent 60%),radial-gradient(48% 58% at 76% 72%,rgba(247,140,22,.10),transparent 62%);
  animation:ampAurora 22s ease-in-out infinite alternate}
@keyframes ampAurora{to{transform:translate(4%,3%) rotate(5deg)}}
.amp-ch-n{position:absolute;right:5.6%;top:13.3%;font:700 26.2cqw/.8 'Roboto Condensed',sans-serif;color:rgba(255,255,255,.06);letter-spacing:-.04em}
.amp-ch-ey{position:absolute;left:7.5%;top:36.7%;font:500 max(10px,.95cqw)/1 'JetBrains Mono',monospace;letter-spacing:.3em;color:#F78C16}
.amp-ch-t{position:absolute;left:7%;top:40%;margin:0;font:700 8.2cqw/1 'Roboto Condensed',sans-serif;letter-spacing:-.01em;max-width:86%}
.amp-ch-p{position:absolute;left:7.5%;top:56.9%;margin:0;max-width:56%;font:400 max(12px,1.44cqw)/1.4 Inter,sans-serif;color:#DCE5F0}
.amp-ch-ln{position:absolute;left:7.5%;top:65.6%;height:.25cqw;min-height:2px;width:0;background:linear-gradient(90deg,#F78C16,#4A6FA5)}
.amp-ch-sk{position:absolute;right:2.5%;bottom:3.3%;font:600 max(10px,.69cqw) Inter,sans-serif;letter-spacing:.1em;color:#7EA1C3}
.amp-kw{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .02em .1em;margin-bottom:-.1em}
.amp-kw>span{display:inline-block;transform:translateY(108%);animation:ampKw .75s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--k,0) * 45ms + 160ms)}
@keyframes ampKw{to{transform:none}}
@media (prefers-reduced-motion:reduce){.amp-chap::before,.amp-kw>span{animation:none;transform:none}}
@media print{.amp-wipe,.amp-chap{display:none!important}}
```
Conversions from TMG's 1600×900 stage: right 90 → 5.6 %, top 120 → 13.3 %, 419 px → 26.2cqw, left 120 → 7.5 %, 131 px → 8.2cqw, top 512 → 56.9 %, 520 px line → 32.5 %. Weight 800 becomes 700, because only 400/700 Roboto Condensed is loaded.

**JS** (ES5, matching `runtime.js` style; `RM = matchMedia('(prefers-reduced-motion: reduce)').matches`):
```js
var busy = false, chap = null;
function runWipe(dir, swap, done) {
  var w = wipeEl, bars = [].slice.call(w.children), E = 'cubic-bezier(.7,0,.3,1)';
  bars.forEach(function (b) { b.getAnimations().forEach(function (a) { a.cancel(); }); });   // no build-up of fill:forwards
  w.style.visibility = 'visible';
  bars.forEach(function (b, k) { b.animate([{ transform: 'translateX(' + (-110 * dir) + '%) skewX(-12deg)' }, { transform: 'translateX(0) skewX(-12deg)' }], { duration: 420, delay: k * 70, easing: E, fill: 'forwards' }); });
  setTimeout(function () {
    swap();
    bars.forEach(function (b, k) { b.animate([{ transform: 'translateX(0) skewX(-12deg)' }, { transform: 'translateX(' + (110 * dir) + '%) skewX(-12deg)' }], { duration: 460, delay: (2 - k) * 70, easing: E, fill: 'forwards' }); });
    setTimeout(function () { w.style.visibility = 'hidden'; done(); }, 640);
  }, 560);
}
function kinWords(t) { var k = 0; return esc(t).split(/(\s+)/).map(function (p) { return /^\s*$/.test(p) ? p : '<span class="amp-kw"><span style="--k:' + (k++) + '">' + p + '</span></span>'; }).join(''); }
function chapterCard(sec, onEnd) {
  var c = chapEl, n = pad(sec.num);
  c.innerHTML = '<div class="amp-ch-n">' + n + '</div><div class="amp-ch-ey">PARTE ' + n + '</div><h2 class="amp-ch-t">' + kinWords(sec.name) + '</h2>'
    + (sec.sub ? '<p class="amp-ch-p">' + esc(sec.sub) + '</p>' : '') + '<div class="amp-ch-ln"></div><div class="amp-ch-sk">clique ou → para pular ›</div>';
  c.classList.add('on');
  c.querySelector('.amp-ch-ln').animate([{ width: '0%' }, { width: '32.5%' }], { duration: 900, delay: 300, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
  var p = c.querySelector('.amp-ch-p'); if (p) p.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 500, fill: 'backwards' });
  c.querySelector('.amp-ch-n').animate([{ opacity: 0, transform: 'translateX(5%)' }, { opacity: 1, transform: 'none' }], { duration: 1300, easing: 'cubic-bezier(.2,.7,.2,1)' });
  var ended = false, t = setTimeout(end, 2100);
  function end() { if (ended) return; ended = true; clearTimeout(t); chap = null;
    c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450 }).onfinish = function () { c.classList.remove('on'); c.innerHTML = ''; };
    onEnd(); }
  c.onclick = function (e) { e.stopPropagation(); end(); };   // must not reach the deck edge-click navigation
  return { skip: end };
}
/* go(): replaces today's go(). show() = today's body of go() + railSync + idx/notes refresh + hide zoom button;
   enter(st) = st.classList.remove('am-pre'); st.classList.add('am-in'); clean = runFx(st); */
function go(i, o) {
  o = o || {}; i = Math.max(0, Math.min(list.length - 1, i));
  if (!list.length || i === cur) return;
  if (chap) { chap.skip(); if (!o.force) return; }   // a key during the card only skips the card
  if (busy) return;                                  // same as TMG: input dropped during the wipe (≤ 1.2 s)
  closeZoom();
  var prev = cur, fwd = i > prev, sec = SECS[secOf[i]];
  var card = prev >= 0 && fwd && SECS.length > 1 && secOf[i] !== secOf[prev] && sec && !sec.intro && sec.divider !== i && !(deck.nav && deck.nav.chapters === false) && !RM;
  var wipe = prev >= 0 && !RM && (card || (fwd && sec && sec.divider === i) || deck.slides[i].tr === 'wipe');
  if (!wipe) { show(i, true); return; }
  busy = true;
  runWipe(fwd ? 1 : -1, function () {
    if (card) { show(i, false); chap = chapterCard(sec, function () { enter(list[i].st); }); }   // slide waits in am-pre
    else show(i, true);
  }, function () { busy = false; });
}
```
`show(i, play)`: run today's `go()` body. Keep `am-pre` and only call `enter()` when `play` is true. Then call `railSync(i)`, refresh the index `aria-current`, refill the Resumo panel if it is open, and hide the zoom button. When the wipe is used, the slide's own crossfade (`.amp-slide` opacity .6s) happens under the cover, which is harmless.

---

## 4. "Resumo" features

### 4.1 "Sobre este slide" — the per-slide presenter summary (this is the item-7 "resumo do slide")
Screenshots: `shots/12-info-open.png`, `shots/13-info-follows.png`.

- Button `#bInfo` sits in the controls, before "Voltar". It has a 20 px circled **i** and the label "Sobre este slide". It is white with navy text, and orange with navy text while open (`aria-expanded` toggled).
- Panel `#infoP`: fixed `right:22px; bottom:62px`, 440 px wide (max `100vw−44px`), white, radius 12, **5 px orange left border**, shadow. It contains:
  - eyebrow "SOBRE ESTE SLIDE" (10.5 px, 800, `#B35F00`) and a × button;
  - `.it` slide title (17 px, condensed 800, navy);
  - `.id` description (13 px/1.5, `#35516A`).
  It animates opacity and `translateY(10px)` over .25s.
- **Coverage gap:** 6 of the 27 slides have no `D` entry ("Benchmarks · contexto", "Onde atacar em 8 semanas" and the four "8 semanas · …"). They show the generic fallback sentence. That is why Canteiro needs an **automatic** summary (§4.3).
- **Content source:** `s.dataset.desc || D[s.dataset.t] || "Tela da leitura analítica sobre cultura e organização da TMG."`. `D` is a hand-written dictionary keyed by slide title (21 entries, lines 1747–1767). Each entry is 1–3 sentences saying *what the slide shows, how to read it, and what it proposes*. Example for "Matriz: comparação": "Compara matriz fraca, equilibrada e forte pelo critério que importa: quem decide. Os relatos mostram sinais de matriz fraca, leitura interpretativa, a validar com organograma e alçadas."
- **I** toggles, **Esc** closes, × closes. A click outside does **not** close it.
- **While open it follows navigation:** `activate` is wrapped and `fill(i)` runs on each change. That lets the presenter keep the panel open as a teleprompter.
- There is no editing, no persistence and no auto-generation.

```js
const set=v=>{open=v;pn.classList.toggle("on",v);bt.classList.toggle("on",v);bt.setAttribute("aria-expanded",v);if(v)fill(cur)};
addEventListener("keydown",e=>{if(e.key==="i"||e.key==="I")set(!open);if(e.key==="Escape")set(false)});
const _a8=activate;activate=function(i,inst,back){_a8(i,inst,back);if(open)fill(i)};
```

### 4.2 Content-level summaries (for reference)
- **Slide 2 "Resumo executivo · a história em quatro atos"** (`shots/03-resumo-exec.png`, `shots/04-resumo-exec-analogias.png`):
  - Statement line; 4 act cards ("Ato 1 · O que e como fizemos" with a big number, caption and paragraph) on a connecting line with icons.
  - Button **"↻ Ver em analogias"** flips all 4 cards with `.flip .in{transform:rotateY(180deg)} .6s`, staggered 120 ms. Timeline chips appear (200 + 140·i ms), the base line dims to .25 and a dashed orange "flow" line appears. The button becomes "↺ Voltar aos dados". Re-entering the slide resets to the data view (`ENTER` hook).
  - A row of 6 "method" chips, and the **Roteiro** chapter agenda (§2.3).
- **Slide 26 "Resumo final · insights e decisões"** (`shots/26-resumo-final.png`, `shots/27-resumo-final-decisions.png`):
  - Insights grouped by Cultura/Organização.
  - **6 decision checkboxes** (button rows; ✓ square fills `#33556D`).
  - A **"Prontidão para iniciar"** ring = checked/6. Colour: <50 % light steel, ≥50 % orange, 100 % steel. Message changes at 0/50/100 %.
  - Temperature "39 % → ≥51 %", and a trajectory mini-chart.
  - **Not persisted.**
- **Footer source line** on every slide (`data-src`): ellipsised at 980 px, full text in the `title` attribute. Useful as the "where does this number come from" answer while presenting.
- **Tooltips `#tip`** (`shots/19-tooltip.png`): any element with `data-tv` (value) and `data-tl` (label) shows a glass tooltip that follows the pointer (`clientX+14`, clamped to `innerWidth−330`), with an orange left border. It uses a single delegated `pointermove`.

### 4.3 Canteiro spec — "Resumo do slide" panel (auto-generated + editable)
Data: new optional `slide.notes` (plain text, `\n` for breaks), written in the editor. When it is empty the player shows `RT.autoNotes(slide, i, deck)` (§9) and marks it **"automático"**.

**Bar button** (in `.amp-r`, before fullscreen):
```html
<button class="amp-b amp-ic" data-a="notes" type="button" aria-expanded="false" title="Resumo do slide (I)"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg><span class="lb">Resumo</span></button>
```
`.amp-b[aria-expanded=true]{background:#F78C16;border-color:#F78C16;color:#00192B}`

**Panel:**
```html
<div class="amp-pop amp-note" role="dialog" aria-label="Resumo do slide">
  <div class="amp-pop-h"><span>Resumo do slide <i class="amp-note-tag">automático</i></span>
    <span><button type="button" class="amp-note-ed" aria-pressed="false">Editar</button><button type="button" class="amp-pop-x" aria-label="Fechar">×</button></span></div>
  <div class="amp-note-t"></div>            <!-- slide title, textContent -->
  <div class="amp-note-b" aria-live="polite"></div>   <!-- one <p> per line, textContent -->
  <div class="amp-note-f"><button type="button" class="amp-note-rs" hidden>Restaurar automático</button><span>I abre/fecha · Esc fecha</span></div>
</div>
```
```css
.amp-note{right:18px;bottom:calc(52px + var(--amp-rail-h,0px) + 10px);width:440px;max-width:calc(100vw - 24px);max-height:min(60vh,520px);display:flex;flex-direction:column;border-left:5px solid #F78C16;padding-bottom:12px}
.amp-note-t{padding:2px 18px 0;font:700 17px/1.2 'Roboto Condensed',sans-serif;color:#002A46}
.amp-note-b{padding:6px 18px 0;overflow:auto;font:400 13.5px/1.55 Inter,sans-serif;color:#3E4C5E}.amp-note-b p{margin:0 0 6px}
.amp-note-b[contenteditable]{outline:2px dashed #F78C16;outline-offset:4px;border-radius:4px;background:#FFF8F0;cursor:text}
.amp-note-tag{font-style:normal;margin-left:8px;padding:2px 6px;border-radius:4px;background:#EEF2F7;color:#43698F;letter-spacing:.08em}
.amp-note-ed,.amp-note-rs{all:unset;cursor:pointer;font:600 11.5px Inter,sans-serif;color:#43698F;padding:4px 8px;border-radius:6px}.amp-note-ed:hover,.amp-note-rs:hover{background:#EEF2F7}
.amp-note-ed[aria-pressed=true]{background:#F78C16;color:#00192B}
.amp-note-f{display:flex;justify-content:space-between;align-items:center;padding:8px 18px 0;font:400 11px Inter,sans-serif;color:#8C9BB0}
```
**Behaviour:**
- **I** or the bar button toggles the panel. Opening it closes the Índice.
- Esc closes it, unless editing, in which case Esc cancels the edit.
- It **follows navigation** while open (refill in `show()`), like TMG.
- **Editar:**
  - sets `contenteditable="plaintext-only"` (fall back to `"true"` if unsupported) and focuses the body, caret at the end;
  - **Ctrl/⌘+Enter** or clicking "Editar" again saves; **blur saves**; Esc reverts.
  - Saved text becomes `override[slide.id]`. The "automático" tag is hidden and "Restaurar automático" appears.
  - Persist to `localStorage['amPlayer.notes:' + (deck.id || deck.title)] = JSON.stringify(overrides)`, wrapped in try/catch.
  - The item-9 "salvar cópia editada" builder must merge the overrides into `deck.slides[i].notes` when it re-exports. Coordinate the key with the item-2 history DB.
- The player's `key()` handler **must ignore events whose target `isContentEditable`**. Today it only checks `input|textarea|select`, so typing "i" or Space in the notes would close the panel or navigate.
- Render text with `textContent` per line. Never use `innerHTML` with notes.

Editor side (for the editor builder): add a **"Resumo do slide"** textarea to the slide panel bound to `slide.notes`, with a **"Gerar automaticamente"** button that fills it from `RT.autoNotes`. Saving, undo and export already serialise any slide field.

---

## 5. "Ampliar" — zoom charts/cards (`.fzb` + `#fzm`), plus expandables and the case modal

### 5.1 What the user sees
Screenshots:
- `shots/15-ampliar-hover-button.png`: hovering the BPMN chart puts the ⤢ button at its top-right.
- `shots/16-ampliar-opening-150ms.png`: zoom-in animation.
- `shots/17-ampliar-modal.png`: SVG chart re-rendered at 1215×700.
- `shots/18-ampliar-html-heatmap.png`: HTML/canvas heatmap via double click, dark variant.

Details:
- The controls show a **static, non-interactive** chip "⤢ amplia gráficos" (a `span.c`, not a button). It is only a hint.
- Zoomable targets are a fixed id list: `vuNet tStrip stairs bpmn riskMx mxTmg rasci timeline gantt siloNet gapChart mxCmp slope heat`, plus `#thermo`'s parent.
- `pointerenter` on a target moves **one shared** 32×32 button `.fzb` (radius 9, white 94 %, navy "⤢", shadow, `opacity 0→1` .2s, `scale(1.08)` on hover) to the target's top-right: `left = (r.right−sr.left)/sc − 40`, `top = (r.top−sr.top)/sc + 6` in stage coordinates. `pointerleave` hides it after **450 ms** (300 ms after leaving the button). Hovering the button cancels the hide.
- **Click ⤢ or double-click the target** to open. `#siloNet` is excluded from double-click because it uses double-click for its before/after slider.
- **Modal `#fzm`** is inside the stage:
  - backdrop `rgba(14,28,57,.74)` with `backdrop-filter: blur(6px)`, fade .3s;
  - box white (or `#0E1C39` if the source is in a dark area), radius 16, padding `26px 30px 22px`, max 1540×850, shadow `0 40px 100px rgba(0,0,0,.5)`, entering with `aZ` (scale .88→1 and fade, .35s `cubic-bezier(.2,.7,.2,1)`);
  - eyebrow = slide title (orange 11 px uppercase), ✕ top-right, hint "Esc ou clique fora para fechar".
- **Close:** ✕, Esc, or a click on the backdrop. The close is instant (no exit animation). While open, a **capture-phase** keydown listener swallows **all** keys (`stopImmediatePropagation`), so ←/→ do not change slides.
- On slide change, `FX.hideFz()` hides the button.

### 5.2 Technique (lines 1727–1731)
```js
function open(el,title){host.innerHTML="";tt.textContent=title;const W=1460,Hh=700;let node;
 if(el.tagName==="svg"){node=el.cloneNode(true);const vb=el.viewBox.baseVal,ar=vb.width/vb.height;let w=W,h=W/ar;if(h>Hh){h=Hh;w=Hh*ar}
   node.setAttribute("width",w);node.setAttribute("height",h);node.style.cssText=`width:${w}px;height:${h}px;max-width:none`;host.appendChild(node)}   // vector re-render, crisp
 else{node=el.cloneNode(true);const cv=el.querySelectorAll("canvas"),cv2=node.querySelectorAll("canvas");
   cv.forEach((c,i)=>{const im=document.createElement("img");im.src=c.toDataURL();im.style.cssText=c.style.cssText;cv2[i].replaceWith(im)});  // canvases snapshotted
   const r=el.getBoundingClientRect(),sc=SC(),w0=r.width/sc,h0=r.height/sc,k=Math.min(W/w0,Hh/h0);
   const wr=H("div",{style:`width:${w0*k}px;height:${h0*k}px;overflow:hidden`},host);node.style.transform=`scale(${k})`;node.style.transformOrigin="0 0";
   node.style.width=w0+"px";node.style.height=h0+"px";node.style.animation="none";wr.appendChild(node)}
 node.querySelectorAll("[data-a]").forEach(x=>x.removeAttribute("data-a"));node.querySelectorAll(".dr").forEach(x=>x.classList.remove("dr"));  // final state, no entrance
 node.querySelectorAll(".fzb").forEach(x=>x.remove());
 box.classList.toggle("dark",!!el.closest(".dk")||!!el.closest(".slide.dark"));fzm.classList.add("on");FX.modal=true}
addEventListener("keydown",e=>{if(FX.modal){if(e.key==="Escape")close();e.stopImmediatePropagation()}},true);
```
Limits:
- the clone has **no event listeners** (static snapshot), although delegated tooltips still work;
- the modal is limited to the stage area, not the full window;
- the hidden `.fzb` is still in the tab order (it is the first Tab stop), which is an accessibility defect.

### 5.3 Related "expand" patterns in TMG
- **Expandable cards `.xp`** (Riscos, `shots/20-expandable-open.png`). Clicking toggles `.open`, accordion-style (others close). The body uses the grid-rows trick:
  `.xp .xp-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .42s cubic-bezier(.2,.7,.2,1)} .xp .xp-body>div{overflow:hidden} .xp.open .xp-body{grid-template-rows:1fr}`. The caret rotates 180°, and the open card gets `box-shadow:0 10px 30px rgba(14,28,57,.14)`.
- **Case modal `#bmM`** (Benchmarks, `shots/23-benchmarks.png`, `shots/24-bm-modal.png`). Each card's "Ver caso completo ⤢" opens a 1460-wide case sheet: logo, GMO badge, timeline, ①②③④ blocks and a mini chart.
  - **‹ › buttons and ←/→ keys cycle the 4 cases**, through a capture-phase listener that swallows the keys (slide counter stays 17).
  - Esc or a backdrop click closes it. It is also closed on any slide change.

### 5.4 Canteiro spec — `.amp-zb` + `.amp-zm`
**Zoomable elements of the current slide:**
```js
function zoomables(s) { return (s.els || []).filter(function (e) {
  return ((e.type === 'fx' && FX[e.kind] && FX[e.kind].cat !== 'Marca A&M') || e.type === 'image') && e.w >= 160 && e.h >= 90; }); }
```
Charts, matrices, timelines, KPI blocks, models and images qualify. Text and lines do not. Order the list by area, descending, so **Z** without a pointer target opens the main chart.

**Hover button:** a single `<button type="button" class="amp-zb" aria-label="Ampliar (Z)" title="Ampliar · duplo clique também amplia (Z)">⤢</button>` inside `.amp`.
- On `pointermove` over `.amp-deck`: find `e.target.closest('.am-el')`. If its `data-id` is zoomable, set `left = r.right − 40 − ampRect.left` and `top = r.top + 8 − ampRect.top` (screen px, from `getBoundingClientRect`), then add `.on`.
- Hide 450 ms after leaving; the timer is cancelled while the pointer is over the button.
- Hidden state uses `visibility:hidden` so it is **not tabbable**.
- **Double-click** on a zoomable `.am-el` opens it.
- **Important:** the deck's edge-click navigation (`runtime.js` line 473: clicks in the left/right 18 % of the deck go prev/next) must **ignore clicks whose target is inside a zoomable `.am-el`, the chapter card, or `.amp-zb`**. Otherwise the two clicks of a double-click on a chart near the edge navigate twice before the zoom opens.

```css
.amp-zb{position:absolute;z-index:7;width:32px;height:32px;border-radius:9px;border:1px solid rgba(0,42,70,.25);background:rgba(255,255,255,.94);color:#002A46;font:700 15px/1 Inter,sans-serif;display:grid;place-items:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,20,36,.25);opacity:0;visibility:hidden;transition:opacity .2s,transform .2s,visibility 0s .2s}
.amp-zb.on{opacity:1;visibility:visible;transition:opacity .2s,transform .2s,visibility 0s}.amp-zb:hover{transform:scale(1.08)}
.amp-zm{position:absolute;inset:0;z-index:9;display:none;align-items:center;justify-content:center;background:rgba(0,20,36,.74);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.amp-zm.on{display:flex;animation:ampFade .3s both}
.amp-zm-box{position:relative;background:#fff;border-radius:16px;padding:20px 26px 16px;box-shadow:0 40px 100px rgba(0,0,0,.5);animation:ampZoomIn .35s cubic-bezier(.2,.7,.2,1) both;max-width:94vw;max-height:92vh}
.amp-zm-box.dark{background:#0B2236}
.amp-zm-h{display:flex;align-items:center;gap:10px;margin-bottom:10px;font:500 11px/1 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#F78C16}
.amp-zm-h .n{margin-left:auto;color:#8C9BB0;letter-spacing:.08em}
.amp-zm-vp{position:relative;overflow:hidden;border-radius:6px}
.amp-zm-f{margin-top:8px;text-align:right;font:400 11px Inter,sans-serif;color:#8C9BB0}
@keyframes ampFade{from{opacity:0}to{opacity:1}} @keyframes ampZoomIn{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.amp-zm.on,.amp-zm-box{animation:none}}
@media print{.amp-zb,.amp-zm{display:none!important}}
```
**Rendering:** re-render the element itself, so everything stays vector and crisp.

All Canteiro sizes are `cqw` of the stage. That means a **larger stage** lays out the element natively at the larger size, with no `transform: scale` blur. That is better than TMG's HTML branch.
```js
function openZoom(n) {
  var s = deck.slides[cur], zs = zoomables(s).sort(function (a, b) { return b.w * b.h - a.w * a.h; });
  if (!zs.length) return; zi = (n + zs.length) % zs.length; var el = zs[zi];
  var maxW = Math.min(innerWidth * .94, 1700) - 52, maxH = innerHeight * .92 - 90;
  var k = Math.min(maxW / el.w, maxH / el.h, 4);                       // logical px -> screen px, capped at 4x
  var st = renderSlide({ bg: s.bg || '#FFFFFF', els: [el] }, { play: true });
  st.classList.remove('am-pre');                                       // final state (TMG strips entrances too)
  st.style.cssText += ';position:absolute;left:' + (-el.x * k) + 'px;top:' + (-el.y * k) + 'px;width:' + (W * k) + 'px;height:' + (H * k) + 'px;aspect-ratio:auto';
  vp.style.width = el.w * k + 'px'; vp.style.height = el.h * k + 'px'; vp.style.background = s.bg || '#FFFFFF';
  vp.innerHTML = ''; vp.appendChild(st); zClean = runFx(st);          // counters / cycles replay
  box.classList.toggle('dark', isDark(s.bg)); hTitle.textContent = slideTitle(s, cur);
  hNum.textContent = zs.length > 1 ? (zi + 1) + ' / ' + zs.length : ''; prevB.hidden = nextB.hidden = zs.length < 2;
  zm.classList.add('on'); zoomOpen = true; closeB.focus();
}
function closeZoom() { if (!zoomOpen) return; zm.classList.remove('on'); zoomOpen = false; if (zClean) zClean(); vp.innerHTML = ''; if (zReturn) zReturn.focus(); }
```
Modal DOM:
```html
<div class="amp-zm" role="dialog" aria-modal="true" aria-label="Elemento ampliado"><div class="amp-zm-box">
  <div class="amp-zm-h"><span class="t">TÍTULO DO SLIDE</span><span class="n">1 / 3</span>
    <button class="amp-pop-x" data-z="prev" aria-label="Anterior">‹</button><button class="amp-pop-x" data-z="next" aria-label="Próximo">›</button>
    <button class="amp-pop-x" data-z="close" aria-label="Fechar">×</button></div>
  <div class="amp-zm-vp"></div><div class="amp-zm-f">Esc ou clique fora para fechar · ← → outros gráficos do slide</div></div></div>
```
**Keys while zoomed (trap):**
- Esc closes.
- ←/→ cycle through the slide's zoomable elements (TMG's case-modal pattern, made generic).
- Every other key is swallowed: `preventDefault`, and no navigation.
- A backdrop click (`e.target === zm`) closes.
- Focus returns to the element that had it before opening.

**Bar affordance:** replace TMG's static chip with a real button, `<button class="amp-b amp-ic" data-a="zoom" title="Ampliar (Z)">⤢ <span class="lb">Ampliar</span></button>`, **shown only when the current slide has zoomables** (toggle `hidden` in `show()`). It opens `openZoom(0)`, the largest element.

---

## 6. Controls bar, keyboard map, fullscreen, progress, play-animation system, reduced motion

### 6.1 TMG controls (`#controls`, line 858; final A&M frame CSS lines 218–234)
Screenshot: `shots/07-rail-closeup.png`. Order: `[⤢ amplia gráficos] [ⓘ Sobre este slide] [← Voltar] [4 / 27 ▾] [Avançar →]`.
- Fixed `right:22px; bottom:12px; z-index:60`, gap 8 px. Buttons are 40 px tall, radius 3, shadow `0 4px 14px rgba(14,28,57,.22)`.
- `.g` (ghost): white with border `#D7DDE2` and navy text. `.p` (primary): orange `#F78C16` with white text. `.c` (counter): `#122143`.
- `:disabled{opacity:.4}`: Voltar on the first slide, Avançar on the last.
- Microinteractions:
  - **magnetic buttons**: Voltar/Avançar follow the cursor by 16 % of the distance within 80 px, `transition: transform .22s`;
  - **ripple** on any button/`.clk`/`.xp` pointerdown: `span.rp` `scale(0→2.6)` with fade over .6s;
  - **tilt + glare** on KPI cards (±3°, radial glare follows the pointer).
- Responsive: `@media (max-width:760px)` hides `.lb` labels and makes buttons 36 px tall with 12 px padding. **But** the "amplia gráficos" and "Sobre este slide" labels are not `.lb`, so at 390 px the controls overflow and wrap (`shots/30-resp-390x844.png`). Defect.
- Stage fit (`fit()`, line 1636): logical 1600×900, `scale = min((vw−2·pad)/1600, (vh−pad−bar)/900)` with `pad = 22` (8 below 760) and `bar = 64` (54). Centred horizontally. 1440×900 gives scale .8725 and a stage box of 22, 36, 1396×785.

### 6.2 TMG keyboard and gestures (all measured)
| Input | Action |
|---|---|
| → · PageDown · Space | Next (`preventDefault`). Ignored if the target is `INPUT`. |
| ← · PageUp | Previous |
| Home / End | First / last (End into another chapter shows its card) |
| F | `documentElement.requestFullscreen()` / `exitFullscreen()` toggle |
| G | Toggle Índice |
| I | Toggle "Sobre este slide" |
| Esc | Closes Índice and Sobre (both). In the zoom modal it closes zoom (all keys swallowed). In the case modal it closes it, and ←/→ cycle cases. |
| Enter / Space on focused counter | Toggle Índice |
| Touch swipe | `touchend` with \|dx\| > 60 px goes next/prev (ignored on INPUT) |
| Click on chapter card | Skip card |
| Hash | `#N` written via `replaceState`; deep link read once at load |

Missing in TMG: modifier guard (Ctrl/⌘+F etc. are not excluded), a key for Ampliar, and an Esc priority order (one Esc closes everything).

### 6.3 Play-animation system (`[data-a]` + `.play`, lines 21–28, 173–197)
- Any element with `data-a` is `opacity:0` until its slide has `.play`. Each slide visit restarts it: `activate()` removes `play`, forces reflow (`void n.offsetWidth`) and adds `play` again.
- `.play [data-a]{animation:.75s var(--ease) both; animation-delay:calc(var(--d,0)*80ms + 120ms)}`, `--ease = cubic-bezier(.2,.7,.2,1)`.
- Keyframes:

  | Name | From |
  |---|---|
  | `up` | translateY 22px |
  | `fade` | opacity 0 |
  | `zoom` | scale .88 |
  | `left` | translateX −26px |
  | `right` | translateX 30px |
  | `down` | translateY −24px |
  | `grow` | scaleX 0, origin left |
  | `blur` | blur 14px with scale 1.05 |
  | `pop` | scale .4 with overshoot `cubic-bezier(.34,1.56,.64,1)` |
  | `stack` | translate `(var(--sx), 56px)`, rotate `var(--r)`, scale .92 |

- **Kinetic words** `.kin`/`.kw`: per-word rise, 45 ms stagger.
- **Path draw** `.dr`: `pathLength=1`, dasharray 1, dashoffset 1→0, `--dur` 1.3 s, delay `--d·70 + 250 ms`.
- **Shine** `.shine::after`: a diagonal sweep at `--d·90 + 900 ms`.
- **Band mask reveal**: `clip-path: inset(0 100% 0 0) → inset(0)` .8 s.
- **JS on enter:**
  - counters `[data-count]` animate 0→value in 900 ms (easeOutCubic);
  - level bars and SVG bars are reset to 0 and set to their target after 350 ms (CSS transition 1.1 s);
  - per-slide hooks run from `ENTER[title]` (heatmap play, BPMN play, gauge needle, etc.).
- **Canteiro already has the equivalent**: `.am-stage.am-pre` → `.am-in`, per-element `--d`/`--t`, and `runFx` for counters and cycles. **No change needed.** Only `go()` is split into `show()` and `enter()` so the chapter card can hold the entrance (§3.3).

### 6.4 Reduced motion and print in TMG
- `@media (prefers-reduced-motion: reduce)` makes `[data-a]` `opacity:1`, turns off the slide-in, flows, pulses and ambient loops (aurora, band shift, shimmer, blob, heat breathe), and sets `transform:none` on tilt.
- `const REDMO = matchMedia(...)`: `go()` is instant (no wipe or card), and ripple, magnetic, parallax, aurora and the quote carousel are disabled.
- Print CSS: stage unscaled, every slide `display:block; height:900px; break-after:page`, `@page{size:1600px 900px;margin:0}`, and controls, progress, dots and tip hidden. **Bug:** `#rail`, `#infoP` and `#idxP` are not hidden in print.
- **Edit/comment features:** none.

### 6.5 Canteiro unified keyboard map (replace `key()` in `runtime.js` line 461)
```js
function key(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;                 // never hijack browser shortcuts
  var t = e.target, k = e.key;
  if (t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)) return; // notes editing, forms
  if (zoomOpen) { e.preventDefault(); if (k === 'Escape') closeZoom(); else if (k === 'ArrowRight') openZoom(zi + 1); else if (k === 'ArrowLeft') openZoom(zi - 1); return; }
  if (idxOpen && /^(ArrowUp|ArrowDown|Home|End)$/.test(k)) { e.preventDefault(); idxMove(k); return; }
  var onBtn = t && t.closest && t.closest('button,[role=button],a[href]');
  if (k === 'Escape') { if (idxOpen) setIdx(false, true); else if (noteOpen) setNote(false); else if (chap) chap.skip(); else if (opts.onExit) opts.onExit(); return; }
  if (k === 'g' || k === 'G') { e.preventDefault(); setIdx(!idxOpen); return; }
  if (k === 'i' || k === 'I') { e.preventDefault(); setNote(!noteOpen); return; }
  if (k === 'z' || k === 'Z') { e.preventDefault(); openZoom(hoverZi >= 0 ? hoverZi : 0); return; }
  if (k === 'f' || k === 'F') { full(); return; }
  if ((k === 'Enter' || k === ' ') && onBtn) return;                                     // let a focused button act natively
  if (['ArrowRight', 'PageDown', ' ', 'Enter'].indexOf(k) >= 0) { e.preventDefault(); if (chap) chap.skip(); else go(cur + 1); }
  else if (['ArrowLeft', 'PageUp', 'Backspace'].indexOf(k) >= 0) { e.preventDefault(); if (chap) chap.skip(); else go(cur - 1); }
  else if (k === 'Home') { e.preventDefault(); go(0, { force: true }); } else if (k === 'End') { e.preventDefault(); go(list.length - 1, { force: true }); }
}
```
| Key | Canteiro action |
|---|---|
| → PageDown Space Enter | Next. If the chapter card is visible, skip it only. |
| ← PageUp Backspace | Previous (same card rule) |
| Home / End | First / last |
| **G** | Índice |
| **I** | Resumo do slide |
| **Z** | Ampliar (element under the pointer, else the largest on the slide) |
| F | Fullscreen |
| Esc | Closes the **topmost** layer: zoom > índice > resumo > chapter card. If none is open, exits present mode (editor only, `opts.onExit`). |
| ↑ ↓ Home End (índice open) | Move focus in the list. Enter opens the slide. |
| ← → (zoom open) | Previous/next zoomable element of the slide |
| Swipe > 60 px (touch) | Next/prev (add a `touchstart`/`touchend` pair like TMG; the Canteiro player has none today) |

Also add `mousedown → preventDefault()` on `.amp-b`, `.amp-pos` and `.amp-rs`. Clicking with the mouse then does not leave focus on a button, so Space/Enter keep meaning "next". Keyboard users who Tab to a button still get native activation (the `onBtn` guard).

**Bar layout at small widths** (fixes TMG's 390 px overflow):
```css
.amp-b .lb{margin-left:2px}
@media (max-width:760px){.amp-brand{display:none}.amp-bar{grid-template-columns:auto 1fr auto;padding:0 8px}.amp-b .lb{display:none}.amp-b{padding:0 10px}.amp-c{gap:6px}.amp-pos{min-width:56px;padding:0 6px}}
```
In the existing prev/next buttons, wrap the words in `<span class="lb">`: `← <span class="lb">Anterior</span>` / `<span class="lb">Próximo</span> →`.

---

## 7. Other TMG effects worth knowing (for the effects-library builders, items 1 and 5)
| # in TMG CSS | Effect | Technique (exact) |
|---|---|---|
| 07 | Glassmorphism | `backdrop-filter:blur(10px) saturate(1.25); background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.2)` |
| 08 | Animated band gradient | `background-size:220% 100%; animation:bandShift 16s ease-in-out infinite` (position 0 % ↔ 100 %) |
| 10 | Mask reveal | `clip-path:inset(0 100% 0 0) → inset(0)`, .8 s |
| 33 | Card stack | `[data-a=stack]` with `--sx` = (1.5−i)·381 px and `--r` = (i−1.5)·4°, .95 s |
| 02 | Icon draw | Each SVG child gets `pathLength=1`, dasharray 1, dashoffset 1→0, 1.1 s |
| 03–05 | Tilt + glare + elevation | `rotateX((.5−py)·6deg) rotateY((px−.5)·6deg) translateZ(4px)`; radial glare at `--gx/--gy`; gradient ring through a mask-composite border |
| 20 | Ripple | span `scale(0→2.6)`, opacity→0, .6 s |
| 25 | Magnetic buttons | translate 16 % of the pointer delta within 80 px |
| 09 | Parallax | cover SVG `translate(−dx·20, −dy·14)`; chapter number `−dx·40, −dy·24` |
| 40 | Aurora | 400×225 canvas, 5 radial blobs drifting with sin/cos over 4.2–5.2 s, CSS `blur(34px)`, opacity .8, stretched to full slide |
| 39 | Particles on paths | SVG `<animateMotion>` with `<mpath href>` on every 5th network path, 4–7 s loop |
| 34 | Quote carousel | 7 s interval, pauses on hover, fade and 8 px rise between items |
| 37 | Before/after slider | two `clipPath` rects split at X; draggable handle with `setPointerCapture`; double-click tweens to that point; segmented toggle tweens 700 ms easeOutCubic |
| 22 | Expandable | `grid-template-rows: 0fr → 1fr`, .42 s (see §5.3) |
| — | Flip card | `perspective:1000px; .in{transform-style:preserve-3d; transition:transform .6s}; .on .in{rotateY(180deg)}`, backface hidden |
| 31 | Shimmer text | `background-clip:text` gradient, `background-size:260%`, 8 s linear |
| 29 | Blob morph | CSS `d: path(...)` keyframes, 18 s alternate |
| 14 | Heat "breathe" | `filter: brightness(1→1.14) saturate(1→1.12)`, 7 s |
| 26 | Segmented indicator | absolutely positioned pill sliding `left/width` .35 s, kept in sync by a MutationObserver |

All of these are disabled under `prefers-reduced-motion`.

---

## 8. Layering and stacking (Canteiro)
Inside `.amp` (`position:fixed; inset:0; z-index:50` today), from bottom to top:
`.amp-view` (deck: slides z 2 < `.amp-chap` z 15 < `.amp-wipe` z 20, all inside `.amp-deck`) → `.amp-rail` → `.amp-bar` → `.amp-prog` → `.amp-pop` (índice, resumo) z 6 → `.amp-zb` z 7 → `.amp-zm` z 9.
Rule: **at most one of {índice, resumo} is open**. Opening zoom closes both. Every slide change closes zoom and hides `.amp-zb`.

---

## 9. Shared helpers to add to `runtime.js` (export them on `AMRT` so the editor can reuse them)
```js
/* plain text of a stored HTML string, without loading resources (template content is inert) */
function plain(html) { var t = document.createElement('template');
  t.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  return (t.content.textContent || '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim(); }
function textsOf(s) { return (s.els || []).filter(function (e) { return e.type === 'text'; })
  .map(function (e) { return { t: plain(e.html), size: +e.size || 18, x: +e.x || 0, y: +e.y || 0 }; }).filter(function (o) { return o.t; }); }
var NUM_ONLY = /^\d{1,2}$/;
function isEyebrow(o) { return o.size <= 14 && o.t === o.t.toUpperCase() && /[A-ZÀ-Ý]/.test(o.t); }
function isDark(c) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return false; var n = parseInt(m[1], 16);
  return 0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255) < 110; }
function clip(t, n) { t = t.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

/* slide title: explicit > largest text (ignoring chapter numbers and eyebrows; ties -> topmost) > "Slide N" */
function slideTitle(s, i) {
  if (s.title) return clip(String(s.title), 72);
  var best = null; textsOf(s).forEach(function (o) { if (NUM_ONLY.test(o.t) || isEyebrow(o)) return;
    if (!best || o.size > best.size || (o.size === best.size && o.y < best.y)) best = o; });
  return best ? clip(best.t, 72) : 'Slide ' + (i + 1);
}
/* divider ("Divisor de capítulo"): explicit kind, or a dark slide with a 1–2 digit number >= 64px and a title >= 34px */
function dividerOf(s) {
  var tx = textsOf(s), num = null, ttl = null;
  tx.forEach(function (o) { if (NUM_ONLY.test(o.t) && o.size >= 64) num = o; else if (!isEyebrow(o) && o.size >= 34 && (!ttl || o.size > ttl.size)) ttl = o; });
  if (s.kind === 'section' && ttl) return { num: num ? +num.t : null, name: clip(ttl.t, 48) };
  return isDark(s.bg) && num && ttl ? { num: +num.t, name: clip(ttl.t, 48) } : null;
}
/* chapters: [{name, num, idx:[slide indexes], first, divider:-1|index, intro, sub}], secOf[i] = chapter index */
function sectionsOf(deck) {
  var out = [], c = null, n = 0, secOf = [];
  (deck.slides || []).forEach(function (s, i) {
    var dv = dividerOf(s), name = (s.sec && String(s.sec).trim()) || (dv && dv.name) || null;
    if (name && (!c || c.intro || c.name !== name)) {
      n = dv && dv.num ? dv.num : n + 1;
      c = { name: name, num: n, idx: [], first: i, divider: dv ? i : -1, intro: false, sub: s.secSub || '' }; out.push(c);
    } else if (!c) { c = { name: 'Abertura', num: 0, idx: [], first: i, divider: -1, intro: true }; out.push(c); }
    if (dv && c.divider < 0) c.divider = i;
    c.idx.push(i); secOf[i] = out.length - 1;
  });
  var real = out.filter(function (x) { return !x.intro; }).length;
  return real ? { list: out, secOf: secOf } : { list: [], secOf: [] };   // no chapters -> no rail, flat index, no cards
}
```
New **optional** deck fields. All are backwards compatible; decks without them behave exactly as today.

| Field | Type | Meaning |
|---|---|---|
| `slide.sec` | string | Chapter name. Inherited by following slides until another `sec` or a divider. |
| `slide.secSub` | string | Subtitle shown on the chapter card |
| `slide.title` | string | Overrides the auto title in the index, notes and zoom header |
| `slide.notes` | string | Presenter summary (Resumo do slide), plain text |
| `slide.kind` | `'section'` | Set by `mkSlide('section')` from now on (`editor.js` line 91: `kind: layout === 'section' ? 'section' : undefined`) |
| `slide.tr` | adds `'wipe'` | A&M 3-bar wipe transition |
| `deck.nav.chapters` | bool | `false` disables chapter cards |

**Auto summary** (`autoNotes`). It is deterministic, in pt-BR, plain text with lines joined by `\n`, and at most about 600 characters:
```js
function autoNotes(s, i, deck) {
  var n = (deck.slides || []).length, title = slideTitle(s, i).replace(/[.:;,\s]+$/, ''), out = [title + '.'];
  var dv = dividerOf(s); var secs = sectionsOf(deck);
  if (dv) {                                                     // divider: preview of the chapter
    var sc = secs.list[secs.secOf[i]], nxt = sc ? sc.idx.filter(function (k) { return k !== i; }).slice(0, 4).map(function (k) { return slideTitle(deck.slides[k], k); }) : [];
    if (nxt.length) out.push('Neste capítulo: ' + nxt.join('; ') + '.');
    out.push('Antecipe ao público o que será mostrado e por que importa.'); return out.join('\n');
  }
  var pts = [], kinds = [], blob = [];
  textsOf(s).sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (o) {
    blob.push(o.t); if (clip(o.t, 72) === slideTitle(s, i) || NUM_ONLY.test(o.t) || isEyebrow(o)) return;
    o.t.split(/\n|•/).forEach(function (ln) { ln = ln.replace(/^[\s\-–—·]+/, '').trim(); if (ln.length > 3 && pts.length < 4) pts.push(clip(ln, 140)); });
  });
  (s.els || []).forEach(function (e) { if (e.type === 'fx' && FX[e.kind] && FX[e.kind].cat !== 'Marca A&M') { if (kinds.indexOf(FX[e.kind].name) < 0) kinds.push(FX[e.kind].name); blob.push(dataStrings(e.data)); } });
  var nums = []; ((blob.join(' ')).match(/(?:R\$\s?)?\d+(?:[.,]\d+)*(?:\s?(?:%|p\.?p\.?|mi|bi|mil|k|x))?/gi) || []).forEach(function (m) {
    m = m.trim(); if (/^(19|20)\d{2}$/.test(m)) return;   /* years are not key numbers */
    if ((/[%$]|mi|bi|mil|k|x|pp/i.test(m) || m.replace(/\D/g, '').length >= 2) && nums.indexOf(m) < 0 && nums.length < 4) nums.push(m); });
  if (kinds.length) out.push('Visual: ' + kinds.slice(0, 3).join(', ') + '.');
  if (pts.length) out.push('Pontos principais: ' + pts.join('; ') + '.');
  if (nums.length) out.push('Números-chave: ' + nums.join(' · ') + '.');
  out.push(i === 0 ? 'Abertura: apresente o objetivo e o que será decidido.' : i === n - 1 ? 'Fechamento: reforce a mensagem principal e o próximo passo.' : 'Conduza do título para a evidência e feche com a implicação.');
  return out.join('\n');
}
/* dataStrings(d): move editor.js dataText() (line 838) into runtime as-is (it already skips colour/style tokens) and call it here */
```
Verified in Chromium (`qa-understand/tmg-analyst/p9.js`) on an 11-slide test deck: chapters `Abertura[0,1] · Nome do capítulo[2–5, divider 2] · Benchmarks[6–8] · Plano[9,10]`, titles correct, divider summary "Neste capítulo: …", and `plain('<img onerror>')` does not execute. Expected output on a "Indicadores" slide: `Resultados que comprovam a transformação.\nVisual: Contador, ….\nNúmeros-chave: 39% · R$ 2,7 bi.\nConduza do título para a evidência e feche com a implicação.`

---

## 10. TMG defects — do NOT copy
1. The rail is hidden below 1100 px. Labels and chapters are hard-coded. It is not keyboard accessible, and it still prints.
2. The Índice highlight goes stale when you navigate with ←/→ while it is open. No focus is moved into it and there are no ↑/↓ keys.
3. Índice and "Sobre este slide" open on top of each other (same anchor).
4. A nav key during the chapter card leaves the card covering the new slide (up to 1.5 s), and `.play` is applied to the wrong slide.
5. G and I are not guarded against modifiers or inputs. Esc closes every layer at once; there is no priority.
6. The hidden zoom button `.fzb` is the first Tab stop.
7. The "⤢ amplia gráficos" chip looks like a button but does nothing.
8. The zoom modal is limited to the stage area and HTML zoom uses `transform: scale` (soft). Canteiro's cqw re-render is crisper.
9. Controls overflow at 390 px: only `.lb` labels are hidden.
10. Red `#BC0404` is used for risk/critical states. **Canteiro must use orange or navy.**
11. Nothing persists: checklist state, analogy toggle and notes are all lost on reload.

---

## 11. Acceptance checks for builders (Playwright, 1440×900 unless noted)
Use the exported file and a test deck with: 2 intro slides, 1 `section`-layout divider, 3 slides, then 3 slides with `sec:"Benchmarks"` (no divider), then 2 slides with `sec:"Plano"`. That is 11 slides and 4 chapters (Abertura, divider chapter, Benchmarks, Plano).

**Rail**
1. `.amp-rail` exists with 4 `.amp-rs`.
2. On slide 1, fills are `50%,0,0,0` and `.on` is on the first.
3. On slide 3 (the divider), fills are `100%,25%,0,0`. On slide 4 they are `100%,50%,0,0`.
4. Clicking the 3rd `.amp-rs` goes to slide 7 (the first of Benchmarks).
5. At 1024 px the rail is still visible and only the active label is shown. At 390 px the labels are hidden and there is no horizontal overflow (`document.documentElement.scrollWidth === innerWidth`).
6. Print emulation: `.amp-rail` is `display:none`.

**Chapter card**
1. From slide 6, → makes `.amp-wipe` visible at 300 ms. At 700 ms, `.amp-chap.on` contains "PARTE 02" and "Benchmarks" (the divider shows "1", so Benchmarks is 2). The slide's `.am-stage` still has `am-pre`. At 3.2 s the card is closed and the stage has `am-in`.
2. Pressing → at 1.4 s (card visible) **keeps the slide at 7** and closes the card.
3. Going back from 7 to 6 shows no card.
4. Entering the divider slide (2→3) shows the wipe and **no card**.
5. Reduced motion: no wipe and no card.

**Índice**
1. G opens `.amp-idx.on`, and focus is on the item with `aria-current=page`.
2. ↓ then Enter goes to the next slide and closes the panel.
3. G, then →: `aria-current` moves to the new slide.
4. Esc closes and focus returns to `.amp-pos`.
5. Group headers are `Abertura`, `Parte 1 · Nome do capítulo`, `Parte 2 · Benchmarks`, `Parte 3 · Plano`. Header text is `intro ? 'Abertura' : 'Parte ' + num + ' · ' + name`.
6. I opens the Resumo while the índice is open, and the índice closes.

**Resumo**
1. On a slide with no `notes`, the panel shows the "automático" tag and text starting with the slide title.
2. Editar, type, Ctrl+Enter: the text persists across reload (localStorage) and the tag is hidden.
3. Typing Space or "i" inside the editor does **not** navigate or toggle.
4. "Restaurar automático" brings back the auto text.

**Ampliar**
1. Hovering a chart shows `.amp-zb.on` within 200 ms at its top-right. Leaving hides it after about 450 ms.
2. Double-click opens `.amp-zm.on`. The viewport size equals `el.w*k × el.h*k`, the inner stage width is `1280*k`, and the text inside is crisp: its computed font size is about k× the slide's.
3. ←/→ in zoom do **not** change the slide counter. Esc closes.
4. Double-clicking a chart that sits in the right 18 % of the deck does **not** navigate.
5. `.amp-b[data-a=zoom]` is hidden on slides with no zoomables.

**Keys**
1. Ctrl+F does nothing in the player.
2. F toggles fullscreen.
3. Esc in present mode inside the editor closes the topmost layer first, and exits only when nothing is open.
4. No console errors.

---

## 12. Open questions for the orchestrator
1. **Rail position:** TMG's rail is at the bottom-left beside the controls; the brief says "top". I specified a bottom row above the bar (§1.3). If the user's attachment shows it at the top, add `.amp.rail-top`: move `.amp-rail` before `.amp-view` (order:-1) and adjust `.amp-prog`. The CSS and JS are otherwise identical.
2. **Chapter cards vs divider slides:** I suppress the card when the chapter starts with a divider slide (the wipe only), to avoid two "chapter" moments. Confirm, or make `deck.nav.chapters = 'always'` an option.
3. **Notes persistence in the downloaded file:** the localStorage key and the "save edited copy" merge depend on the item-9 builder (editable export) and the item-2 builder (history DB / `deck.id`). Agree on `deck.id` and on `amPlayer.notes:<deck.id>`.
4. **Wipe on normal slides:** TMG wipes on *every* navigation (about 1.2 s lock). I made it opt-in per slide (`tr:'wipe'`) plus automatic on chapter entry, so presenters are not slowed down. Confirm.
