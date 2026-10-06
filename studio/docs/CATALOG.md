# CATALOG: Icon Motion, lines & shapes, charts, SmartArt and consulting models for Canteiro

> **Analyst:** catalog (read-only). **Read:** `studio/runtime.js`, `runtime.css`, `editor.js` (`mkShape`, `mkLine`, `SHAPES`, `safeEl`, menus, drawer, field codecs), `docs/ARCH.md`, `docs/DTS-CONTROLS.md`, `docs/TMG-FEATURES.md`, and effect 02 "Icon Motion" in the DTS guide.
>
> **Prototypes and tests:** everything below lives in `QA = /tmp/claude-0/-home-user-videosflows/d1659d46-7fc1-552e-ba5d-02ae16117f1f/scratchpad/qa-understand/catalog/`. **Each code block in this doc is copied by `build_doc.py` from a file that ran inside the real Canteiro runtime (`runtime.js` + `runtime.css`) in Chromium.** No hand copies.
>
> **Re-run:** `cd $QA && node test-icons.js` (16 checks, **ALL PASS**). Also: `node motion-test.js`, `node shapes-test.js`, `node charts-test.js`, `ONLY=smart node charts-test.js smart-proto.js,charts-proto.js smart.css smart`, `ONLY='pdca+gantt+asistobe+porter' node charts-test.js charts-proto.js,smart-proto.js,md-proto.js charts.css,smart.css,md.css md`.
>
> **Conventions follow ARCH.md:**
> - extension files `rt-10-shapes.js`, `rt-20-icons.js`, `rt-30-charts.js`, `rt-40-smartart.js`, `rt-50-models.js` (each with a `.css`), using `AMRT.util` from F0;
> - line fields `curve` / `headS` / `headE` / `dashS`;
> - "Ampliar" zoomable = by `cat`;
> - default sizes ≤ 1172×470;
> - export bans `onclick` / `onmouseover` / `onerror` / `</script`.
>
> Brand: navy `#002A46`, steel `#4A6FA5` / `#43698F` / `#7EA1C3`, ice `#EEF2F7` / `#DCE5F0`, a single orange `#F78C16`, **never red**. Fonts: Roboto Condensed (labels), Inter (text) and JetBrains Mono (eyebrows). UI copy in pt-BR.

---

## 0. TL;DR: decisions for builders

1. **Icon Motion (item 3), P0.**
   - Content: **54 original 24×24 stroke icons** in 8 themes, plus **7 morph glyphs** and **7 morph pairs**. That is **17 motions** and **8 triggers**, which mirror Lordicon's (in, hover, loop, loop-on-hover, click, boomerang, sequence ≈ in-loop, morph). No Lottie, no CDN, about 26 KB.
   - Two kinds, `icon` and `iconmorph`, in `cat:'Ícones animados'`.
   - **The motions are the `variants`.** So the F1 effect gallery (boxes with live preview) becomes the motion picker for free.
   - The entrance is the element's own **"Desenhar"**, which draws each stroke with a 110 ms stagger, accent strokes last. Generalise ARCH's `canDraw(el)` to include `icon`/`iconmorph`.
   - Proven: `test-icons.js` 16/16. This covers no redraw after hover, a click on a morph not advancing the slide, and reduced motion cutting loops.
2. **Bug found (fix with F4, P0): dashed lines render solid today.**
   - Cause: `lineSVG` sets `pathLength="1"` and then `stroke-dasharray="sw*3 sw*2.2"` in user units. `pathLength` rescales the dash units, so one dash is longer than the whole line. Measured: computed `18px, 13.2px` with `pathLength=1`, rendered solid (`QA/shapes-lines.png`, bottom panel).
   - Separately, when `anim.in=draw`, the CSS forces `stroke-dasharray:1`, so the line is solid during and after the animation.
   - Fix (§B.2, verified): the visible dashed stroke has **no** `pathLength`, and the draw animation runs on a `<mask>` path.
   - "Contorno tracejado" on shapes is fine, because shapes have no `pathLength`.
3. **Lines and shapes (item 4.1), P0/P1.**
   - Lines:
     - 3 routes (Reta / Cotovelo / Curva) plus a bend control;
     - 4 dash styles;
     - 5 head types per end (arrow, open, dot, diamond, bar), keeping the old booleans.
   - **15 new shapes:** pentagon arrow, hexagon, octagon, trapezoid, right triangle, star, plus, ring, speech balloon, double arrow, notched arrow, cylinder, flowchart document, brackets `[ ]`, braces `{ }`.
   - **6 card looks:** flat, outline, side bar, top bar, navy header, navy gradient.
4. **Charts (item 4.2), P0/P1.**
   - 10 additions, 7 prototyped: grouped / stacked / 100% columns, horizontal ranking, waterfall, bullet (target vs actual), Harvey balls, funnel, radar.
   - Categorical colours: **at most 4 slots, in fixed order navy → steel → light steel → orange**. Validated: CVD all-pairs ΔE ≥ 20.
   - Off-brand values are not allowed. So legend + direct labels + 2 px gaps + hatching for negatives are **mandatory**.
   - **No dual axis.** Combos must share the same unit, or use a split panel.
5. **SmartArt (item 4.3), P0.**
   - **One kind, `smart`, with 12 layouts**, all driven by a text pane: one item per line, **Tab = one level down** (new codec `outline`).
   - Changing the layout **keeps the text**, like PowerPoint's "Alterar layout".
   - All 12 layouts are prototyped.
6. **Models (item 5), P0/P1.** 14 prioritised.
   - 4 prototyped: **PDCA** (with a "climbing the ramp" variant), **Cronograma/Gantt** (today line, critical path), **AS-IS → TO-BE**, **5 Forças de Porter**.
   - 10 specified with sketch, data and variants. Plus 8 cheap presets on existing engines.
   - Each model declares its build groups (`data-g`), which the dock's "Avançar/Passo" uses (DTS-CONTROLS).
7. **Pitfalls hit while prototyping. Builders must avoid them.**
   - a) **Keyframe names are global.** `runtime.css` already defines `amPopC`, `amSeg`, `amHl`, `amUp`, `amBar`… My first Gantt redefined `amPopC` and would have broken the risk-map bubbles. **Prefix every new keyframe per file** (`ic*`, `ch*`, `wf*`, `sa*`, `pd*`, `gt*`, `pt*`).
   - b) A root modifier `sa-hub` collided with the node class `sa-hub`, and the whole diagram rendered as one orange ellipse. Use a **different prefix for layout modifiers** (`sal-*`).
   - c) **Ids in `<clipPath>`, `<mask>` and `<linearGradient>` must be unique per render**: a module counter, not `el.id`. Thumbnails and stage coexist, and the first element with an id wins, which can be a stale thumbnail.
   - d) **CSS animation lists:** if an animation name leaves the `animation` list and later comes back, Chrome restarts it (measured, `anim-identity.js`). The icon CSS always keeps the draw animation at index 0 (`var(--drw)`).
   - e) Render-side clamping. `safeEl` passes `data.*` through unchecked (ARCH rule 4). Every number that reaches an attribute or class goes through `U.num()` and a clamp, for example SmartArt `lv` → `Math.max(0, Math.min(2, lv|0))`.

### 0.1 Priority and placement

| Item | What | Priority | File | Prototype |
|---|---|---|---|---|
| 3 | `icon`, `iconmorph`, picker, `bindIcons` | **P0** | `rt-20-icons.js/.css` + editor | `fxicon.js`, `fxicon.css`, `icons.js` |
| 4.1 | dashed-line fix | **P0** | `runtime.js lineSVG` | `shapes-proto.js` |
| 4.1 | line routes, heads, dash styles | **P0** | `rt-10-shapes.js` (overrides `lineSVG`) + editor | `shapes-proto.js` |
| 4.1 | 15 shapes | P0 (8) / P1 (7) | `rt-10-shapes.js` (`shapeBody` hook) | `shapes-proto.js` |
| 4.1 | card looks | P1 | `rt-10-shapes.js` | `shapes-proto.js` |
| 4.2 | columns (grouped / stacked / 100%), ranking, waterfall, bullet, Harvey | **P0** | `rt-30-charts.js/.css` | `charts-proto.js`, `charts.css` |
| 4.2 | funnel, radar, multi-series lines/areas, bubbles | P1 | same | funnel and radar prototyped |
| 4.2 | KPI tiles + sparkline, combo (same unit), Pareto, Marimekko, pie toggle, heat table | P2 | same | spec |
| 4.3 | `smart` (12 layouts) + `outline` codec | **P0** | `rt-40-smartart.js/.css` + editor codec | `smart-proto.js`, `smart.css` |
| 5 | PDCA, Gantt, Roadmap, AS-IS → TO-BE, Issue tree, BCG, Stakeholders | **P0** | `rt-50-models.js/.css` | first 4 prototyped |
| 5 | Porter, Value chain, BMC, Journey, OKR, BSC, Change curve/ADKAR | P1 | same | Porter prototyped |
| 5 | 7S, 3 Horizontes, Ishikawa + presets (Ansoff, Eisenhower, Kano, SCR, Minto, Iceberg, 5W2H, SIPOC) | P2 | same | spec |

### 0.2 Integration checklist (every new kind)

- Register from an extension file:
  ```js
  (function (R) { 'use strict'; var U = R.util; R.FX.k = {…}; })(window.AMRT);
  ```
  The helpers I used locally map 1:1 to `U.E`, `U.arr`, `U.num`, `U.fmt`, `U.fmtN`, `U.CQ`, `U.P`, `U.VV`, and `R.esc`.
- **`buildModels` `order[]`** (editor.js ~1111) becomes:
  ```js
  ['Matrizes','Riscos','Estratégia','Processos','Cards','Evolução','Gráficos','Indicadores','SmartArt']
  ```
  Without this, the new cards are invisible.
  - `'Ícones animados'` is `model:false`, so it shows in the Efeitos tab by itself.
  - Add `'Estratégia'` and `'Processos'` to ARCH's zoomable list (F5).
- **`DATA_TOKENS`** (editor.js 134). Append:
  ```js
  'name','trig','accent','bg','stroke','pair','layout','mode','sort','color'
  ```
  `color` is already there.
  - Values are checked against `TOKEN_RE` / `COLOR_RE`. Unknown ones are deleted.
  - Renderers **still** whitelist (`['none','soft',…].indexOf(v)`) and clamp numbers.
- **`safeEl` element keys** (allow-lists):
  - `curve ∈ {straight, elbow, curve}`;
  - `bend` finite 0.05–0.95;
  - `dashS ∈ {dash, dot, dashdot, long}`;
  - `headS` / `headE ∈ {arrow, open, dot, diamond, bar}`;
  - `look ∈ {flat, outline, accent, topbar, header, gradient}`.
  - Keep `dash`, `headStart` and `headEnd` booleans.
- **`variants`.** `safeEl` drops any `el.variant` not listed. So `icon` must list `auto` plus all 17 motions (it does).
- **New field types** in `renderProps` (E:350–357) and the input handler (E:409–415):
  - `'icon'`: mini grid picker, §A.6;
  - `'outline'`: textarea that keeps indentation, with Tab / Shift+Tab, §D.1.
- **Click-to-cycle with a custom sequence.** Extend `startMove up` (E:709):
  ```js
  seq = cyc.dataset.cycSeq ? cyc.dataset.cycSeq.split(',') : ['R','A','C','I','-']
  ```
  Harvey balls use `data-cyc-seq="0,1,2,3,4"`.
- **Dock "Passo".** Each model sets `data-g` on its build groups (the tables below say which). Same attribute as `data-cycle="g"` focus variants.
- **Tests.** One `test-sNN-*.js` per file. Use `slideCheck` on white and on navy, at the default size and at 50%.

---

## A. ICON MOTION (item 3)

### A.1 How the reference products work (research, with Canteiro decisions)

| Product | Mechanism | Triggers / states | What we copy | What we don't |
|---|---|---|---|---|
| **Lordicon** | Web component `<lord-icon src="…json" trigger="hover" state="hover-pinch" colors="primary:#…,secondary:#…" stroke="bold" delay="1000">` playing Lottie JSON with its own player. | **8 triggers:** `in`, `click`, `hover`, `loop`, `loop-on-hover`, `morph`, `boomerang`, `sequence`. Icons ship **named states per trigger**: `in-reveal`, `hover-draw`, `hover-pinch`, `loop-cycle`, `morph-open`… "Wired" style = 2-colour outline; stroke light/regular/bold. | Trigger vocabulary; 2 colours (primary = stroke, secondary = accent part); stroke weight; "in-reveal" = draw-on; loop **with a rest** (`delay`); morph between two glyphs. | Lottie player (60–250 KB) plus CDN (the export must be offline and self-contained); commercial licence and attribution. |
| **LottieFiles / lottie-web** | After Effects → JSON (bodymovin), played by `lottie-web` (`play`, `playSegments([a,b])`, `setDirection(-1)`, `goToAndStop`). Interactivity via lottie-interactivity or dotLottie **state machines** (hover, click, scroll, "loop a segment while hovered"). | Segments = states. Hover is usually "play segment once" or "loop segment while hovered". | Segment idea → each motion is one keyframe cycle that includes a rest, so "once" and "loop" share the same keyframes. | JSON assets; runtime. |
| **Line-icon sets + CSS** (Feather/Lucide style) | Inline 24×24 SVG, `stroke-linecap/linejoin:round`, `stroke-width:1.5–2`. Animated with `stroke-dasharray` / `pathLength` (draw-on) and `transform` on groups. | n/a | **Technique** (inline SVG, dash draw, transforms in `view-box` space). | Their paths. All 54 icons here are **original drawings**, so no licence header is needed. Check the "no `onclick` in comments" rule (ARCH rule 5) anyway. |
| **DTS guide effect 02** | Stroke draw on entry (`getTotalLength`, 900 ms, 110 ms stagger) plus one hover micro-motion per icon (lift, pulse, spin 360°, layers spread, gear +90°, shield check draw). Controls: `↻ Redesenhar`, `Tour automático`, TRAÇO `Rápido 500` / `Normal 900` / `Lento 1600`. | in + hover, tour | Timings (900 ms / 110 ms), "Traço" speeds, per-icon motion, tour → the dock tour (DTS-CONTROLS). | DTS orange `#F26B21`. |

Sources: [Lordicon web docs](https://lordicon.com/docs/web), [lord-icon-element README](https://github.com/tomwilusz/lord-icon-element/blob/master/README.md), [Lordicon state names, e.g. wired outline icons](https://lordicon.com/icons/wired/outline/56-file-text), [LottieFiles interactivity guide](https://lottiefiles.com/blog/working-with-lottie-animations/animation-and-interactivity-on-web), [dotLottie state machines](https://lottiefiles.com/state-machines), [CSS-Tricks: Animating with Lottie](https://css-tricks.com/animating-with-lottie/).

### A.2 Data model and behaviour

`FX.icon` (`model:false`, `cat:'Ícones animados'`, default box **120×120**, `anim:{in:'draw', dur:900}`, `variant:'auto'`):

| Field | Values | Notes |
|---|---|---|
| `data.name` | one of the 54 keys in §A.7 | Picker field type `'icon'`. Unknown → first icon. |
| `el.variant` | `auto` or a motion key (§A.3) | `auto` = the motion designed for that icon (column "default" in §A.7). Because the kind has `variants`, the editor already shows them as chips (renderProps 345: rename the heading to `FD.model ? 'Efeito do modelo' : 'Movimento do ícone'`), in the canvas pill `#fxArrow` ("Efeito: …", drawSel 218) and in the F1 box gallery. |
| `data.trig` | `in-hover` *(default)*, `in-loop`, `in`, `loop`, `loop-hover`, `hover`, `click`, `boomerang` | See the trigger table. |
| `data.color` | `#002A46` Navy · `#FFFFFF` Branco · `#43698F` Steel | Base strokes. On navy slides, `insertFx` should set Branco. |
| `data.accent` | `#F78C16` Laranja · `#002A46` · `#7EA1C3` · `#FFFFFF` | Accent strokes (class `ic-ax`). Keep orange: it is the single accent. |
| `data.bg` | `none`, `soft` (ice rounded square), `circle` (ice circle), `ring` (outline circle), `navy` (navy circle, strokes forced white) | Plate. With a plate the glyph is 60% of the box. |
| `data.stroke` | `1.5` Fina · `1.85` Média · `2.25` Grossa | Lordicon light / regular / bold. |
| `data.label` | text (optional) | Roboto Condensed 700 under the icon. Editable in place (`data-e="label"`). |
| `el.anim.in` | the element's entrance; `draw` = stroke draw | `anim.dur` is the "Traço" speed: **Rápido 500 / Normal 900 / Lento 1600** (DTS 02). Other entrances (Surgir, Zoom…) animate the `.am-el` as usual, and the strokes appear complete. |

**Triggers** (pt-BR label shown in the props panel → Lordicon equivalent → behaviour):

| `trig` | Label | Lordicon | Behaviour (presentation and export only; the editor shows the icon static) |
|---|---|---|---|
| `in-hover` | Ao entrar e ao passar o mouse | in + hover | Draws on entry. Each pointer-over plays the motion **once**, until the end, even if the pointer leaves (JS `.ic-go` for `data-ms`). |
| `in-loop` | Ao entrar e depois sem parar | sequence | Draws, then loops after `t0 = dur + (n−1)·110 + 250 ms`. |
| `in` | Só ao entrar | in | Only the entrance. |
| `loop` | Sem parar | loop | Loops from the start (`t0 = 0`). With "Desenhar" the draw runs in parallel. |
| `loop-hover` | Enquanto o mouse estiver em cima | loop-on-hover | Pure CSS `:hover`. The motion stops when the pointer leaves. |
| `hover` | Só ao passar o mouse | hover | Like `in-hover`, but meant for entrances other than draw. |
| `click` | Ao clicar | click | Plays once per click. `stopPropagation`, so the 18% side click-zones of the player don't advance the slide (verified). |
| `boomerang` | Vai e volta ao passar o mouse | boomerang | Plays forward and back (`alternate`, 2 iterations at half duration). |
| (`iconmorph`) | Alternando sozinho / Ao clicar | morph | Two stacked glyphs. CSS loop every 2.2 s, or click toggles `.ic-on`. |

**Timing rules:**
- **Stagger.** Draw stagger 110 ms per stroke; accent strokes are drawn after the base strokes.
- **Dots.** The draw keyframes fade `opacity 0→1` in the first 8%. Without that, zero-length "dot" strokes (`M8 12h.01`) show as round caps before their turn (seen in `QA/motion-icons-m045.png`).
- **Loop delay.** `t0` = loop start delay:
  - `draw` → `dur + (n−1)·110 + 250`;
  - other entrances → `dur + 150`;
  - `loop` → `0`.
- **Rest built in.** Every motion keyframe includes its own rest (for example spin: rotate in 0–55%, rest 55–100%). The same keyframes serve "once" and "loop", like Lordicon's "loop with delay".
- **Dock control.** Speed / pause / step (DTS-CONTROLS dock) need nothing: WAAPI `playbackRate` and `animation-play-state` reach these CSS animations.
- **Reduced motion.** The global rule in `runtime.css` (line 385) already cuts every loop (verified: `1/1e-05s`).

### A.3 The 17 motions

| Key | Label (pt-BR) | Default target | Duration / easing | What moves | Best for |
|---|---|---|---|---|---|
| `redraw` | Redesenhar | whole icon | 2600 ms, `cubic-bezier(.65,0,.35,1)`, 90 ms stagger | stroke erases and redraws (0–40%, then rest) | trend, check, documents |
| `pulse` | Pulsar | whole | 1800 ms ease-in-out | scale 1 → 1.12 → 1 | chip, energy |
| `beat` | Batimento | whole | 1500 ms | double beat 1.16 / 1.10 | heart, engagement |
| `spin` | Girar | whole | 2600 ms ease-in-out-cubic | rotate `var(--sp, 360deg)` in 55%, rest | gear (`--sp:90deg`), cycle, hourglass (`--sp:180deg`) |
| `bounce` | Saltar | whole | 1600 ms | jump −3 px with squash, origin at the bottom (12 21.5) | rocket, pin, package, user |
| `float` | Flutuar | whole | 3200 ms | translateY −1.6 px | cash, cloud |
| `wiggle` | Balançar | whole | 2000 ms | rotate −11 / 9 / −6 / 3° | alert, percent, puzzle, handshake |
| `swing` | Pêndulo | whole | 2400 ms | rotate 16 / −11 / 6 / −2° around `--o` (default 12 3) | bell, leaf, compass needle, scale beam |
| `nudge` | Encaixar o detalhe | accent | 2600 ms back-out | accent enters from `(--ax, --ay)`, overshoots 15%, settles | dart, cloud arrow, lock shackle, layers, pie slice, team |
| `tick` | Ponteiro | accent | 4000 ms linear | 360° around (12 12) | clock |
| `grow` | Crescer barras | accent | 2800 ms, 140 ms stagger | `scaleY` 0 → 1.08 → 1, fill-box origin at the bottom | chart |
| `blink` | Piscar o detalhe | accent | 2200 ms, 120 ms stagger | opacity .12 / scale .7 dip | idea rays, typing dots, windows, waves |
| `wave` | Tremular | accent | 1600 ms | skewY −7° and scaleX .92 from the pole (5 8) | flag |
| `flow` | Fluxo no traço | accent | 1400 ms linear | `stroke-dasharray .14 .1` marching (pathLength units) | network, workflow |
| `flip` | Virar | whole | 3000 ms | `scaleX` 1 → 0 → −1 → 0 → 1 (2D, works in SVG) | coin, globe meridian |
| `orbit` | Órbita | whole | 3000 ms linear | small 1.4 px circle (rotate–translate–counter-rotate) | search |
| `ping` | Onda de sinal | ring | 1800 ms ease-out | an accent ring scales .55 → 1.2 and fades | any icon used as an alert |

Target rule:
- If the user picks a motion other than the icon's default, the motion uses its default target.
- An accent target falls back to the whole icon when the icon has no accent.
- The icon's own CSS vars (`o`) apply only with its default motion. So the cap's tassel origin does not distort a `bounce`.

### A.4 Runtime code (`rt-20-icons.js`): verified prototype `QA/fxicon.js`

`icons.js` (§A.7) goes at the top of the same file.

```js
/* Protótipo de rt-20-icons.js — registra FX.icon e FX.iconmorph no AMRT. Depende de AMICONS / AMICON_GLYPHS / AMICON_MORPHS (icons.js, que vai no topo do mesmo arquivo). */
(function (R) {
  'use strict';
  var esc = R.esc;
  /* movimento: [rótulo, alvo padrão ('w' ícone todo | 'a' detalhe | 'r' anel), duração ms, stagger ms entre peças] */
  var IC_MO = {
    redraw: ['Redesenhar', 'w', 2600, 90], pulse: ['Pulsar', 'w', 1800, 0], beat: ['Batimento', 'w', 1500, 0], spin: ['Girar', 'w', 2600, 0],
    bounce: ['Saltar', 'w', 1600, 0], float: ['Flutuar', 'w', 3200, 0], wiggle: ['Balançar', 'w', 2000, 0], swing: ['Pêndulo', 'w', 2400, 0],
    nudge: ['Encaixar o detalhe', 'a', 2600, 0], tick: ['Ponteiro', 'a', 4000, 0], grow: ['Crescer barras', 'a', 2800, 140], blink: ['Piscar o detalhe', 'a', 2200, 120],
    wave: ['Tremular', 'a', 1600, 0], flow: ['Fluxo no traço', 'a', 1400, 0], flip: ['Virar', 'w', 3000, 0], orbit: ['Órbita', 'w', 3000, 0], ping: ['Onda de sinal', 'r', 1800, 0]
  };
  var IC_TIP = { auto: 'Usa o movimento desenhado para este ícone.', redraw: 'O traço se apaga e se desenha de novo.', pulse: 'Cresce e volta, como uma respiração.', beat: 'Duas batidas rápidas, como um coração.', spin: 'Gira e descansa (engrenagens, ciclos, ampulheta).', bounce: 'Dá um pequeno salto com amortecimento.', float: 'Sobe e desce devagar.', wiggle: 'Balança de um lado para o outro.', swing: 'Oscila preso pelo topo, como um sino.', nudge: 'O detalhe laranja entra e se encaixa no lugar.', tick: 'O ponteiro dá a volta no relógio.', grow: 'As barras crescem da base, uma a uma.', blink: 'O detalhe pisca em sequência.', wave: 'O detalhe tremula, como uma bandeira.', flow: 'Um tracejado corre pelo detalhe, como um fluxo.', flip: 'Vira no próprio eixo, como uma moeda.', orbit: 'Desliza num pequeno círculo, como quem procura.', ping: 'Uma onda se espalha a partir do ícone.' };
  function icFind(k) { for (var i = 0; i < AMICONS.length; i++) if (AMICONS[i].k === k) return AMICONS[i]; return null; }
  function icParts(m) { return String(m || '').match(/<(path|circle|rect|line|ellipse|polyline)\b[^>]*\/>/g) || []; }
  /* cada traço: class ic-s, pathLength=1, --k (ordem do desenho); quem se move: ic-mv + --j (ordem do movimento) */
  function icSVG(base, acc, tg) {
    var k = 0, j = 0, out = '';
    function put(p, isA) { var mv = tg === 'w' || (tg === 'a' && isA); out += p.replace(/^<(\w+)/, '<$1 class="ic-s' + (isA ? ' ic-ax' : '') + (mv ? ' ic-mv' : '') + '" pathLength="1" style="--k:' + (k++) + (mv ? ';--j:' + (j++) : '') + '"'); }
    icParts(base).forEach(function (p) { put(p, false); });
    icParts(acc).forEach(function (p) { put(p, true); });
    if (tg === 'r') out = '<circle class="ic-ring ic-mv" cx="12" cy="12" r="10.5" style="--j:0"/>' + out;
    return { svg: out, n: k };
  }
  var COLS = /^#[0-9a-f]{3,8}$/i;
  function col(v, d) { return COLS.test(String(v || '')) ? v : d; }
  function wrap(d, w, h, inner, attrs, vars) {
    var lab = String(d.label || '').trim(), fs = Math.max(10, Math.min(h * .13, w * .14));
    var bg = ['none', 'soft', 'circle', 'ring', 'navy'].indexOf(d.bg) >= 0 ? d.bg : 'none', sw = Math.max(1, Math.min(3, +d.stroke || 1.85));
    return '<div class="fx fxic' + (lab ? ' has-l' : '') + '" data-pl="' + bg + '"' + attrs + ' style="' + (vars || '') + '--ic:' + col(d.color, '#002A46') + ';--ia:' + col(d.accent, '#F78C16') + ';--sw:' + sw + '"><div class="ic-pl"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg></div>' + (lab ? '<span class="ic-l" style="font-size:' + R.util.CQ(fs) + '">' + R.util.E('label', lab) + '</span>' : '') + '</div>';
  }
  R.ICONS = AMICONS; R.ICON_GROUPS = AMICON_GROUPS; R.IC_MO = IC_MO;
  R.FX.icon = {
    name: 'Ícone animado', cat: 'Ícones animados', w: 120, h: 120, anim: { in: 'draw', dur: 900 }, variant: 'auto',
    variants: [['auto', 'Movimento do ícone', IC_TIP.auto]].concat(Object.keys(IC_MO).map(function (k) { return [k, IC_MO[k][0], IC_TIP[k]]; })),
    data: { name: 'target', trig: 'in-hover', color: '#002A46', accent: '#F78C16', bg: 'none', stroke: 1.85, label: '' },
    fields: [['name', 'Ícone', 'icon'], ['trig', 'Quando se move', 'sel:in-hover=Ao entrar e ao passar o mouse|in-loop=Ao entrar e depois sem parar|in=Só ao entrar|loop=Sem parar|loop-hover=Enquanto o mouse estiver em cima|hover=Só ao passar o mouse|click=Ao clicar|boomerang=Vai e volta ao passar o mouse'],
      ['color', 'Cor do traço', 'sel:#002A46=Navy|#FFFFFF=Branco|#43698F=Steel'], ['accent', 'Cor do detalhe', 'sel:#F78C16=Laranja|#002A46=Navy|#7EA1C3=Steel claro|#FFFFFF=Branco'],
      ['bg', 'Fundo', 'sel:none=Sem fundo|soft=Quadrado gelo|circle=Círculo gelo|ring=Anel|navy=Círculo navy'], ['stroke', 'Espessura do traço', 'sel:1.5=Fina|1.85=Média|2.25=Grossa'], ['label', 'Legenda (opcional)']],
    html: function (d, w, h, el) {
      var ic = icFind(d.name) || AMICONS[0], def = ic.m.split(':')[0], v = el && el.variant && el.variant !== 'auto' && IC_MO[el.variant] ? el.variant : def, isDef = v === def, spec = IC_MO[v];
      var tg = isDef && /:a$/.test(ic.m) ? 'a' : spec[1]; if (tg === 'a' && !ic.a) tg = 'w';
      var a = (el && el.anim) || {}, draw = a.in === 'draw', r = icSVG(ic.b, ic.a, tg), t = +a.dur || (draw ? 1000 : 700);
      var tr = ['in-hover', 'in-loop', 'in', 'loop', 'loop-hover', 'hover', 'click', 'boomerang'].indexOf(d.trig) >= 0 ? d.trig : 'in-hover';
      var t0 = tr === 'loop' ? 0 : (draw ? t + (r.n - 1) * 110 + 250 : (a.in && a.in !== 'none' ? t + 150 : 0));
      var vars = '--t0:' + t0 + 'ms;--md:' + spec[2] + 'ms;--ms:' + spec[3] + 'ms;' + (isDef && ic.o ? ic.o + ';' : '');
      return wrap(d, w, h, r.svg, ' data-mo="' + v + '" data-tr="' + tr + '" data-ms="' + (spec[2] + spec[3] * 6) + '"', vars);
    }
  };
  R.FX.iconmorph = {
    name: 'Ícone que se transforma', cat: 'Ícones animados', w: 120, h: 120, anim: { in: 'zoom' }, variant: 'loop',
    variants: [['loop', 'Alternando sozinho', 'Mostra o estado A e o estado B, alternando a cada 2,2 s.'], ['click', 'Ao clicar', 'Na apresentação, cada clique alterna entre os dois estados.']],
    data: { pair: 'alert-check', color: '#002A46', accent: '#F78C16', bg: 'circle', stroke: 1.85, label: '' },
    fields: [['pair', 'Transformação', 'sel:' + AMICON_MORPHS.map(function (m) { return m[0] + '=' + m[1]; }).join('|')], ['color', 'Cor do estado A', 'sel:#002A46=Navy|#FFFFFF=Branco|#43698F=Steel'], ['accent', 'Cor do estado B', 'sel:#F78C16=Laranja|#002A46=Navy|#FFFFFF=Branco'], ['bg', 'Fundo', 'sel:none=Sem fundo|soft=Quadrado gelo|circle=Círculo gelo|ring=Anel|navy=Círculo navy'], ['label', 'Legenda (opcional)']],
    html: function (d, w, h, el) {
      var M = AMICON_MORPHS[0]; AMICON_MORPHS.forEach(function (m) { if (m[0] === d.pair) M = m; });
      function g(key, cls) { var ic = icFind(key), m = ic ? ic.b + (ic.a || '') : (AMICON_GLYPHS[key] || ''); return '<g class="ic-st ' + cls + '">' + icParts(m).map(function (p) { return p.replace(/^<(\w+)/, '<$1 class="ic-s" pathLength="1" style="--k:0"'); }).join('') + '</g>'; }
       return wrap(d, w, h, g(M[2], 'ic-sa') + g(M[3], 'ic-sb'), ' data-mo="morph" data-tr="' + ((el && el.variant) === 'click' ? 'click' : 'loop') + '"');
    }
  };
  /* gatilhos no player (delegado, igual a bindTilt): hover/clique tocam o movimento 1 vez; clique alterna o morph */
  R.bindIcons = function (root) {
    function go(f) { if (!f || f.classList.contains('ic-go')) return; f.classList.add('ic-go'); setTimeout(function () { f.classList.remove('ic-go'); }, +f.dataset.ms || 2000); }
    root.addEventListener('pointerover', function (e) { var f = e.target.closest && e.target.closest('.fxic[data-tr=in-hover],.fxic[data-tr=hover],.fxic[data-tr=boomerang]'); if (f) go(f); });
    root.addEventListener('click', function (e) {
      var f = e.target.closest && e.target.closest('.fxic[data-tr=click]'); if (!f) return;
      e.stopPropagation(); /* não deixa o clique cair na zona de avançar slide (18% laterais) */
      if (f.dataset.mo === 'morph') f.classList.toggle('ic-on'); else go(f);
    });
  };
})(window.AMRT);
```

**Player hook.** In `player()`, after `bindTilt(deckEl)` (runtime.js ~476):

```js
if (R.bindIcons) R.bindIcons(deckEl);
```

It is delegated, so slides added later work too.
- **Do not** bind in the editor: `am-edit` stays static.
- The picker tiles are not a stage. They get the classes `am-play am-in` directly (§A.6), so the hover CSS works without JS beyond `.ic-go`.

### A.5 Runtime CSS (`rt-20-icons.css`): verified prototype `QA/fxicon.css`

```css
/* ===== Ícones animados (FX.icon) — protótipo para runtime.css ===== */
.fxic{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4%;overflow:visible}
.fxic .ic-pl{position:relative;height:100%;max-width:100%;aspect-ratio:1;display:grid;place-items:center;border-radius:26%}
.fxic.has-l .ic-pl{height:70%}
.fxic .ic-l{font-family:'Roboto Condensed',Arial,sans-serif;font-weight:700;color:var(--ic);text-align:center;line-height:1.1;letter-spacing:.01em}
.fxic[data-pl=soft] .ic-pl{background:#EEF2F7}
.fxic[data-pl=circle] .ic-pl{background:#EEF2F7;border-radius:50%}
.fxic[data-pl=ring] .ic-pl{border-radius:50%;box-shadow:inset 0 0 0 2px #CBD4E1}
.fxic[data-pl=navy] .ic-pl{background:#002A46;border-radius:50%}
.fxic[data-pl=navy]{--ic:#FFFFFF!important}
.fxic .ic{width:100%;height:100%;overflow:visible;fill:none;stroke:var(--ic);stroke-width:var(--sw,1.85);stroke-linecap:round;stroke-linejoin:round}
.fxic:not([data-pl=none]) .ic{width:60%;height:60%}
.fxic .ic-ax{stroke:var(--ia)}
.fxic .ic-mv{transform-box:view-box;transform-origin:var(--o,12px 12px)}
.fxic .ic-ring{stroke:var(--ia);stroke-width:1.2;opacity:0}
/* parâmetros por movimento: keyframes, curva, origem padrão */
.fxic[data-mo=redraw]{--kf:icRedraw;--me:cubic-bezier(.65,0,.35,1)}
.fxic[data-mo=pulse]{--kf:icPulse;--me:ease-in-out}
.fxic[data-mo=beat]{--kf:icBeat;--me:ease-in-out}
.fxic[data-mo=spin]{--kf:icSpin;--me:cubic-bezier(.65,0,.35,1)}
.fxic[data-mo=bounce]{--kf:icBounce;--me:cubic-bezier(.3,.7,.4,1);--o:12px 21.5px}
.fxic[data-mo=float]{--kf:icFloat;--me:ease-in-out}
.fxic[data-mo=wiggle]{--kf:icWiggle;--me:ease-in-out}
.fxic[data-mo=swing]{--kf:icSwing;--me:ease-in-out;--o:12px 3px}
.fxic[data-mo=nudge]{--kf:icNudge;--me:cubic-bezier(.22,.61,.36,1)}
.fxic[data-mo=tick]{--kf:icTick;--me:linear}
.fxic[data-mo=grow]{--kf:icGrow;--me:cubic-bezier(.22,.61,.36,1)}
.fxic[data-mo=grow] .ic-mv{transform-box:fill-box;transform-origin:50% 100%}
.fxic[data-mo=blink]{--kf:icBlink;--me:ease-in-out}
.fxic[data-mo=wave]{--kf:icWave;--me:ease-in-out;--o:5px 8px}
.fxic[data-mo=flow]{--kf:icFlow;--me:linear}
.fxic[data-mo=flip]{--kf:icFlip;--me:ease-in-out}
.fxic[data-mo=orbit]{--kf:icOrbit;--me:linear}
.fxic[data-mo=ping]{--kf:icPing;--me:cubic-bezier(0,0,.2,1)}
/* entrada: usa a MESMA animação "Desenhar" do elemento (el.anim.in = draw; --t = anim.dur). Outras entradas (Surgir, Zoom…) agem no .am-el como em qualquer elemento.
   Regra de ouro: toda lista de animação começa com var(--drw). Assim icDraw fica sempre na posição 0 e o Chrome não o recria (sem "redesenho" ao fim do hover). */
.fxic .ic-s{--drw:none}
.am-in .am-el[data-in=draw] .fxic .ic-s{--drw:icDraw var(--t,900ms) cubic-bezier(.65,0,.35,1) calc(var(--d,0ms) + var(--k) * 110ms) both}
.am-in .fxic .ic-s{stroke-dasharray:1;animation:var(--drw)}
/* contínuo: começa depois da entrada (--t0 calculado no html()) */
.am-in .fxic:is([data-tr=in-loop],[data-tr=loop]) .ic-mv{animation:var(--drw,none),var(--kf) var(--md) var(--me) calc(var(--d,0ms) + var(--t0) + var(--j,0) * var(--ms)) infinite}
/* uma vez (hover/clique via JS .ic-go), vai-e-volta, e loop enquanto o mouse está em cima */
.am-play .fxic.ic-go .ic-mv{animation:var(--drw,none),var(--kf) var(--md) var(--me) calc(var(--j,0) * var(--ms)) 1}
.am-play .fxic.ic-go[data-tr=boomerang] .ic-mv{animation:var(--drw,none),var(--kf) calc(var(--md) / 2) var(--me) 0ms 2 alternate}
.am-play .fxic[data-tr=loop-hover]:hover .ic-mv{animation:var(--drw,none),var(--kf) var(--md) var(--me) calc(var(--j,0) * var(--ms)) infinite}
.am-play .fxic:is([data-tr=hover],[data-tr=loop-hover],[data-tr=click],[data-tr=in-hover],[data-tr=boomerang]){cursor:pointer}
/* morph */
.fxic .ic-st{transform-box:view-box;transform-origin:12px 12px;transition:opacity .45s ease,transform .55s cubic-bezier(.34,1.56,.64,1)}
.fxic .ic-sb{opacity:0;transform:rotate(-90deg) scale(.5)}
.fxic.ic-on .ic-sa{opacity:0;transform:rotate(90deg) scale(.5)}
.fxic.ic-on .ic-sb{opacity:1;transform:none}
.fxic .ic-sb .ic-s{stroke:var(--ia)}
.am-in .fxic[data-mo=morph][data-tr=loop] .ic-sa{animation:icMorphA 4.4s cubic-bezier(.34,1.3,.64,1) calc(var(--d,0ms) + 900ms) infinite}
.am-in .fxic[data-mo=morph][data-tr=loop] .ic-sb{animation:icMorphB 4.4s cubic-bezier(.34,1.3,.64,1) calc(var(--d,0ms) + 900ms) infinite}
@keyframes icDraw{0%{stroke-dashoffset:1;opacity:0}8%{opacity:1}100%{stroke-dashoffset:0;opacity:1}}
@keyframes icRedraw{0%{stroke-dashoffset:1}40%,100%{stroke-dashoffset:0}}
@keyframes icPulse{0%,100%{transform:scale(1)}45%{transform:scale(1.12)}}
@keyframes icBeat{0%,60%,100%{transform:scale(1)}12%{transform:scale(1.16)}24%{transform:scale(.97)}36%{transform:scale(1.1)}}
@keyframes icSpin{0%{transform:rotate(0)}55%,100%{transform:rotate(var(--sp,360deg))}}
@keyframes icBounce{0%,62%,100%{transform:translateY(0) scale(1,1)}18%{transform:translateY(-3px) scale(.95,1.05)}34%{transform:translateY(0) scale(1.06,.94)}46%{transform:translateY(-1px) scale(1,1)}}
@keyframes icFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}
@keyframes icWiggle{0%,55%,100%{transform:rotate(0)}10%{transform:rotate(-11deg)}20%{transform:rotate(9deg)}30%{transform:rotate(-6deg)}40%{transform:rotate(3deg)}}
@keyframes icSwing{0%,65%,100%{transform:rotate(0)}12%{transform:rotate(16deg)}26%{transform:rotate(-11deg)}40%{transform:rotate(6deg)}52%{transform:rotate(-2deg)}}
@keyframes icNudge{0%{transform:translate(var(--ax,0px),var(--ay,-3px));opacity:0}18%{opacity:1}30%{transform:translate(calc(var(--ax,0px) * -.15),calc(var(--ay,-3px) * -.15))}40%,100%{transform:translate(0,0);opacity:1}}
@keyframes icTick{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes icGrow{0%{transform:scaleY(0)}28%{transform:scaleY(1.08)}36%,100%{transform:scaleY(1)}}
@keyframes icBlink{0%,45%,100%{opacity:1;transform:scale(1)}15%{opacity:.12;transform:scale(.7)}}
@keyframes icWave{0%,100%{transform:skewY(0) scaleX(1)}50%{transform:skewY(-7deg) scaleX(.92)}}
@keyframes icFlow{from{stroke-dasharray:.14 .1;stroke-dashoffset:0}to{stroke-dasharray:.14 .1;stroke-dashoffset:-.48}}
@keyframes icFlip{0%,55%,100%{transform:scaleX(1)}14%{transform:scaleX(0)}28%{transform:scaleX(-1)}42%{transform:scaleX(0)}}
@keyframes icOrbit{from{transform:rotate(0) translateX(1.4px) rotate(0)}to{transform:rotate(360deg) translateX(1.4px) rotate(-360deg)}}
@keyframes icPing{0%{transform:scale(.55);opacity:.8}80%,100%{transform:scale(1.2);opacity:0}}
@keyframes icMorphA{0%,40%{opacity:1;transform:none}50%,90%{opacity:0;transform:rotate(90deg) scale(.5)}100%{opacity:1;transform:none}}
@keyframes icMorphB{0%,40%{opacity:0;transform:rotate(-90deg) scale(.5)}50%,90%{opacity:1;transform:none}100%{opacity:0;transform:rotate(-90deg) scale(.5)}}
```

Why `var(--drw)` comes first in every `animation` list: Chrome identifies CSS animations by **name and position**. If `icDraw` leaves the list while `.ic-go` is on and comes back afterwards, Chrome creates a *new* `icDraw` animation, and the icon visibly redraws at the end of every hover.

Measured with `anim-identity.js`:
- kept in the list: `A:finished`, same object;
- dropped and re-added: `A:running:17ms`.

`test-icons.js` checks the fix for `in-hover`, `loop-hover`, `boomerang` and `hover`.

### A.6 Editor: the "Icon Motion" picker (menu option for item 3)

**Entry points.** None of the labels contains the substring "forma" (ARCH rule 8).

- **Inserir › "Ícone animado ▸"**. Submenu:
  - 8 favourites: Alvo, Foguete, Gráfico em alta, Engrenagem, Equipe, Segurança, Prazo, Ideia;
  - separator;
  - "Ver todos os ícones…".
- **Ribbon "Ícones ▾"**, following ARCH §13 consolidation (no new width).
- **Efeitos tab.** Cat "Ícones animados" lists the two kinds (`icon`, `iconmorph`) like any `model:false` FX.

**Popover `.menu.icmenu`** (ARCH: a popover, **not** `#modal`, because `#modal` swallows Enter, Tab and Ctrl+A):

| Part | Spec |
|---|---|
| Header | `<input type=search class="ic-q" placeholder="Buscar ícone… (ex.: meta, risco, nuvem)">`, focused on open. Accent-insensitive `norm()` match on `n + ' ' + kw + ' ' + group label`. Every typed word must match (same as `#mSearch`). |
| Chips | `Todos` · the 8 themes (§A.7) · `Transformações` (morph pairs). One active. Chip and search combine with AND. |
| Grid | 6 columns × 64 px tiles; 32 px glyph; name below (Inter 10.5 px, 2 lines max, ellipsis). Tile = `<button class="ict am-play am-in" data-ic="target" aria-label="Alvo">` + `icon.html({name:k, trig:'hover', bg:'none'}, 64, 64, {variant:'auto', anim:{}})`. Max height 360 px, scrolls. |
| Hover preview | `pointerenter` on a tile adds `.ic-go` to its `.fxic` for `data-ms`. The tile plays the icon's default motion once, the same as in the presentation. The footer shows `<b>Alvo</b> · Encaixar o detalhe` (DTS-style readout). |
| Click / Enter | **No icon element selected:** `insertFx('icon')` with `data.name=k`, 120×120, centred, `anim.in='draw'`, `trig='in-hover'`. Colour `#FFFFFF` on dark slides (`dark()`). **An icon element selected:** swap its `data.name` (toast "Ícone trocado"), keep the size and settings, one `commit()`. |
| Keyboard | Arrows move focus in the grid (6 columns; Up/Down = ±6). Enter / Space = insert. Typing any printable key focuses the search. Esc closes and returns focus to the opener. Tab: search → chips → grid. |
| Empty state | "Nenhum ícone encontrado. Tente “meta”, “dados”, “pessoas” ou “prazo”." |
| Drag | Optional: same `draggable` + drop path as `.fxi` drawer cards. |

**Props panel for a selected icon** (renderProps):

| Section | Contents |
|---|---|
| Efeito (variants) | Existing chips plus F1 boxes. `auto` first; the 17 motions, each previewed **on the selected icon**. |
| Conteúdo | Fields: `name` (type `'icon'` = compact 5-column grid, 40 px tiles, with search; `data-set="data.name"`), `trig`, `color`, `accent`, `bg`, `stroke`, `label`. |
| Animação | "Desenhar" chip enabled (`canDraw`); speed chips **Rápido / Normal / Lento** → `anim.dur` 500 / 900 / 1600. |

Optional P1: add an `ic` column to `M.cardgrid` (`rows:tag|t|x|ic`, backward compatible) to get "Grade de cards com ícones", the DTS 02 demo layout. Each card renders a 2.2em `fxic` above the number, with `trig:'in-hover'`.

### A.7 The catalogue: 54 icons, grouped by theme, with default motion

Groups (chip labels): Estratégia & crescimento · Inovação & tecnologia · Operações & processos · Finanças & valor · Pessoas & cultura · Risco & governança · Tempo & execução · Mercado & ESG.

| key | Nome (pt-BR) | group | default motion (`:a` = on the accent part) | CSS vars |
|---|---|---|---|---|
| `target` | Alvo | estrategia | nudge:a (dart flies in) | `--ax:5px;--ay:-5px` |
| `rocket` | Foguete | estrategia | bounce | |
| `chartup` | Gráfico em alta | estrategia | grow:a (bars) | |
| `trend` | Tendência de alta | estrategia | redraw | |
| `flag` | Bandeira / marco | estrategia | wave:a | `--o:5px 8px` |
| `compass` | Bússola / direção | estrategia | swing:a (needle) | |
| `trophy` | Troféu | estrategia | bounce | |
| `idea` | Ideia / inovação | tecnologia | blink:a (rays) | `--o:12px 9.6px` |
| `chip` | IA / chip | tecnologia | pulse:a (core) | `--o:12px 12px` |
| `sparkles` | IA generativa | tecnologia | blink:a | |
| `cloud` | Nuvem / cloud | tecnologia | nudge:a (upload arrow) | `--ay:3px` |
| `database` | Banco de dados | tecnologia | nudge:a (middle band) | `--ay:-3px` |
| `code` | Código / sistemas | tecnologia | blink:a (slash) | |
| `network` | Rede / integração | tecnologia | flow:a (links) | |
| `monitor` | Painel / dashboard | tecnologia | redraw:a (sparkline) | |
| `gear` | Engrenagem | operacoes | spin | `--sp:90deg` |
| `factory` | Fábrica / indústria | operacoes | blink:a (windows) | |
| `truck` | Logística | operacoes | nudge (drives in) | `--ax:-4px;--ay:0px` |
| `package` | Pacote / estoque | operacoes | bounce | |
| `cycle` | Ciclo / melhoria contínua | operacoes | spin | |
| `flow` | Fluxo de trabalho | operacoes | flow:a | |
| `puzzle` | Encaixe / integração | operacoes | wiggle | |
| `layers` | Camadas / arquitetura | operacoes | nudge:a (top layer) | `--ay:-3px` |
| `coin` | Moeda / receita | financas | flip | |
| `cash` | Dinheiro / caixa | financas | float | |
| `pie` | Participação | financas | nudge:a (slice) | `--ax:-2.5px;--ay:2.5px` |
| `calc` | Calculadora / business case | financas | blink:a (display) | |
| `percent` | Percentual / margem | financas | wiggle | |
| `bank` | Banco / instituição | financas | nudge:a (roof) | `--ay:-2.5px` |
| `users` | Equipe | pessoas | nudge:a (2nd person) | `--ax:-2.5px;--ay:0px` |
| `user` | Pessoa / cliente | pessoas | bounce | |
| `handshake` | Parceria / acordo | pessoas | wiggle | |
| `org` | Organograma | pessoas | redraw:a (connectors) | |
| `megaphone` | Comunicação | pessoas | blink:a (waves) | |
| `chat` | Diálogo / feedback | pessoas | blink:a (typing dots) | |
| `heart` | Engajamento / cultura | pessoas | beat | |
| `grad` | Capacitação | pessoas | swing:a (tassel) | `--o:20.5px 9.5px` |
| `shield` | Segurança / risco | risco | redraw:a (check) | |
| `lock` | Proteção de dados | risco | nudge:a (shackle) | `--ay:-2.5px` |
| `alert` | Ponto de atenção | risco | wiggle | `--o:12px 20px` |
| `scale` | Compliance / equilíbrio | risco | swing:a (beam) | `--o:12px 6.5px` |
| `doc` | Documento / relatório | risco | redraw:a (lines) | |
| `checklist` | Plano de ação | risco | redraw:a (checks) | |
| `search` | Diagnóstico / análise | risco | orbit | |
| `clock` | Prazo / tempo | tempo | tick:a (minute hand) | |
| `calendar` | Cronograma / agenda | tempo | blink:a (days) | |
| `hourglass` | Urgência | tempo | spin | `--sp:180deg` |
| `check` | Concluído | tempo | redraw:a | |
| `bell` | Alerta / lembrete | tempo | swing | `--o:12px 3px` |
| `globe` | Global / mercado | mercado | flip:a (meridian) | |
| `building` | Empresa / corporativo | mercado | blink:a (windows) | |
| `leaf` | Sustentabilidade / ESG | mercado | swing | `--o:4px 20px` |
| `pin` | Localização / unidade | mercado | bounce | |
| `bolt` | Energia / agilidade | mercado | pulse | |

**Morph pairs** (`iconmorph.data.pair`). State A is drawn in `color`, state B in `accent`:

| pair | Label | A → B |
|---|---|---|
| `alert-check` | Problema → solução | alert → check |
| `trend-flip` | Queda → alta | trenddown → trend |
| `lock-close` | Aberto → protegido | lockopen → lock |
| `play-pause` | Iniciar ↔ pausar | play → pause |
| `plus-check` | Adicionar → confirmado | plus → check |
| `x-check` | Reprovado → aprovado | x → check |
| `question-idea` | Dúvida → ideia | question → idea |

Morph technique:
- Crossfade + rotate ±90° + scale .5, with `cubic-bezier(.34,1.56,.64,1)` over 0.55 s.
- Origin `12px 12px` in `view-box` space.
- This works in every browser.
- True path morphing (`d: path()` transition) only works in Chromium and Firefox. Do not use it.

**Full icon data.** Clean 24×24, stroke-only, round caps and joins. Draw with `fill:none; stroke-width:1.85` (variable 1.5–2.25). The content sits inside 1.5–22.5. `b` = base strokes, `a` = accent strokes, `m` = default motion, `o` = CSS vars for that motion.

```js
/* Canteiro · acervo de ícones animados (24×24, só traço). b = base, a = detalhe (acento), m = movimento padrão (":a" = aplica no detalhe), o = variáveis CSS do movimento */
var AMICONS = [
  /* ---- Estratégia & Crescimento ---- */
  { k: 'target', n: 'Alvo', g: 'estrategia', kw: 'alvo meta objetivo foco target mira', m: 'nudge:a', o: '--ax:5px;--ay:-5px',
    b: '<circle cx="11" cy="13" r="8.5"/><circle cx="11" cy="13" r="5"/><circle cx="11" cy="13" r="1.5"/>',
    a: '<path d="M11 13L20 4"/><path d="M17 3.5V7h3.5"/>' },
  { k: 'rocket', n: 'Foguete', g: 'estrategia', kw: 'foguete lançamento crescimento startup decolar aceleração', m: 'bounce',
    b: '<path d="M12 2.5c2.6 2 4 5 4 8.5v4.5H8V11c0-3.5 1.4-6.5 4-8.5z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M8 12.5l-2.5 2.2V18L8 16.5"/><path d="M16 12.5l2.5 2.2V18L16 16.5"/>',
    a: '<path d="M10.2 17.8c0 1.5.7 2.6 1.8 3.7 1.1-1.1 1.8-2.2 1.8-3.7"/>' },
  { k: 'chartup', n: 'Gráfico em alta', g: 'estrategia', kw: 'gráfico barras alta crescimento resultado receita', m: 'grow:a',
    b: '<path d="M3.5 3.5v17h17"/>',
    a: '<path d="M8 16.5v-3.5"/><path d="M12 16.5v-6.5"/><path d="M16 16.5V7"/>' },
  { k: 'trend', n: 'Tendência de alta', g: 'estrategia', kw: 'tendência alta seta crescimento evolução performance', m: 'redraw',
    b: '<path d="M3 17l6-6 4 4 8-8"/>', a: '<path d="M15 7h6v6"/>' },
  { k: 'flag', n: 'Bandeira / marco', g: 'estrategia', kw: 'bandeira marco meta conquista chegada milestone', m: 'wave:a', o: '--o:5px 8px',
    b: '<path d="M5 21.5V3"/>', a: '<path d="M5 4h12l-2.8 4.2L17 12.5H5"/>' },
  { k: 'compass', n: 'Bússola / direção', g: 'estrategia', kw: 'bússola direção norte estratégia rumo orientação', m: 'swing:a',
    b: '<circle cx="12" cy="12" r="9"/>', a: '<path d="M15.5 8.5l-2 5-5 2 2-5z"/>' },
  { k: 'trophy', n: 'Troféu', g: 'estrategia', kw: 'troféu vitória prêmio sucesso liderança', m: 'bounce',
    b: '<path d="M7 3.5h10v5.5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4v1.2A3.3 3.3 0 0 0 7.3 10"/><path d="M17 5.5h3v1.2a3.3 3.3 0 0 1-3.3 3.3"/><path d="M12 14v3.5"/><path d="M8.5 20.5h7l-.8-3H9.3z"/>',
    a: '<path d="M12 6.2l.7 1.3 1.4.2-1 1 .2 1.4-1.3-.7-1.3.7.2-1.4-1-1 1.4-.2z"/>' },
  /* ---- Inovação & Tecnologia ---- */
  { k: 'idea', n: 'Ideia / inovação', g: 'tecnologia', kw: 'ideia lâmpada inovação insight criatividade', m: 'blink:a', o: '--o:12px 9.6px',
    b: '<path d="M9 16.5c0-1.4-.6-2.3-1.5-3.2a5.5 5.5 0 1 1 9 0c-.9.9-1.5 1.8-1.5 3.2z"/><path d="M9.5 19.2h5"/><path d="M10.5 21.5h3"/>',
    a: '<path d="M12 1v1.6"/><path d="M4.6 3.6l1.1 1.1"/><path d="M19.4 3.6l-1.1 1.1"/><path d="M1.8 9.6h1.6"/><path d="M20.6 9.6h1.6"/>' },
  { k: 'chip', n: 'IA / chip', g: 'tecnologia', kw: 'ia inteligência artificial chip processador dados ai', m: 'pulse:a', o: '--o:12px 12px',
    b: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/>',
    a: '<rect x="9.5" y="9.5" width="5" height="5" rx="1"/>' },
  { k: 'sparkles', n: 'IA generativa', g: 'tecnologia', kw: 'ia generativa genai brilho mágica automação inteligente', m: 'blink:a',
    b: '<path d="M10 3l1.7 4.6L16.3 9.3l-4.6 1.7L10 15.6l-1.7-4.6L3.7 9.3l4.6-1.7z"/>',
    a: '<path d="M18 13.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M5.5 17v3.5M3.75 18.75h3.5"/>' },
  { k: 'cloud', n: 'Nuvem / cloud', g: 'tecnologia', kw: 'nuvem cloud migração infraestrutura upload', m: 'nudge:a', o: '--ay:3px',
    b: '<path d="M6.5 19a4 4 0 0 1-.4-8 6 6 0 0 1 11.6.6 4 4 0 0 1-.2 7.4z"/>',
    a: '<path d="M12 17v-5.5"/><path d="M9.5 14l2.5-2.5 2.5 2.5"/>' },
  { k: 'database', n: 'Banco de dados', g: 'tecnologia', kw: 'banco de dados base data lake armazenamento informação', m: 'nudge:a', o: '--ay:-3px',
    b: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/>',
    a: '<path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>' },
  { k: 'code', n: 'Código / sistemas', g: 'tecnologia', kw: 'código software sistema desenvolvimento dev api', m: 'blink:a',
    b: '<path d="M8 7l-5 5 5 5"/><path d="M16 7l5 5-5 5"/>', a: '<path d="M13.5 4.5l-3 15"/>' },
  { k: 'network', n: 'Rede / integração', g: 'tecnologia', kw: 'rede integração conexões ecossistema nós plataforma', m: 'flow:a',
    b: '<circle cx="12" cy="12" r="2.3"/><circle cx="4.5" cy="5" r="1.8"/><circle cx="19.5" cy="5" r="1.8"/><circle cx="4.5" cy="19" r="1.8"/><circle cx="19.5" cy="19" r="1.8"/>',
    a: '<path d="M10.3 10.4L5.8 6.2M13.7 10.4l4.5-4.2M10.3 13.6l-4.5 4.2M13.7 13.6l4.5 4.2"/>' },
  { k: 'monitor', n: 'Painel / dashboard', g: 'tecnologia', kw: 'painel dashboard monitor tela indicadores bi relatório', m: 'redraw:a',
    b: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    a: '<path d="M6 13l3-3 2.5 2 3.5-4 3 2.5"/>' },
  /* ---- Operações & Processos ---- */
  { k: 'gear', n: 'Engrenagem', g: 'operacoes', kw: 'engrenagem operação processo configuração eficiência máquina', m: 'spin', o: '--sp:90deg',
    b: '<path d="M10.21 4.82L10.47 2.32L13.53 2.32L13.79 4.82A7.4 7.4 0 0 1 15.81 5.66L17.76 4.07L19.93 6.24L18.34 8.19A7.4 7.4 0 0 1 19.18 10.21L21.68 10.47L21.68 13.53L19.18 13.79A7.4 7.4 0 0 1 18.34 15.81L19.93 17.76L17.76 19.93L15.81 18.34A7.4 7.4 0 0 1 13.79 19.18L13.53 21.68L10.47 21.68L10.21 19.18A7.4 7.4 0 0 1 8.19 18.34L6.24 19.93L4.07 17.76L5.66 15.81A7.4 7.4 0 0 1 4.82 13.79L2.32 13.53L2.32 10.47L4.82 10.21A7.4 7.4 0 0 1 5.66 8.19L4.07 6.24L6.24 4.07L8.19 5.66A7.4 7.4 0 0 1 10.21 4.82Z"/>',
    a: '<circle cx="12" cy="12" r="3"/>' },
  { k: 'factory', n: 'Fábrica / indústria', g: 'operacoes', kw: 'fábrica indústria produção manufatura planta operação', m: 'blink:a',
    b: '<path d="M3 21V12l5 3v-3l5 3v-3l5 3V4.5h3V21z"/><path d="M2 21h20"/>',
    a: '<path d="M6.5 18h1.5M11 18h1.5M15.5 18H17"/>' },
  { k: 'truck', n: 'Logística', g: 'operacoes', kw: 'logística caminhão entrega transporte supply chain frete', m: 'nudge', o: '--ax:-4px;--ay:0px',
    b: '<path d="M2.5 6h11v10.5h-11z"/><path d="M13.5 9.5h4l3 3.5v3.5h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>' },
  { k: 'package', n: 'Pacote / estoque', g: 'operacoes', kw: 'pacote caixa estoque produto entrega inventário', m: 'bounce',
    b: '<path d="M12 2.5l8.5 4.5v10L12 21.5 3.5 17V7z"/><path d="M3.5 7L12 11.5 20.5 7"/><path d="M12 11.5v10"/>',
    a: '<path d="M7.8 4.8l8.4 4.5"/>' },
  { k: 'cycle', n: 'Ciclo / melhoria contínua', g: 'operacoes', kw: 'ciclo melhoria contínua pdca recorrência atualizar iteração', m: 'spin',
    b: '<path d="M19.2 8.5A8 8 0 0 0 4.8 8.5"/><path d="M4.8 4.5v4h4"/><path d="M4.8 15.5a8 8 0 0 0 14.4 0"/><path d="M19.2 19.5v-4h-4"/>' },
  { k: 'flow', n: 'Fluxo de trabalho', g: 'operacoes', kw: 'fluxo workflow processo automação etapas sequência', m: 'flow:a',
    b: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/>',
    a: '<path d="M9 6h5a4 4 0 0 1 4 4v5"/><path d="M15.5 12.5L18 15l2.5-2.5"/>' },
  { k: 'puzzle', n: 'Encaixe / integração', g: 'operacoes', kw: 'quebra-cabeça encaixe integração solução peça sinergia', m: 'wiggle',
    b: '<path d="M5 8.5h3.5a2 2 0 1 1 4 0H16V12a2 2 0 1 1 0 4v3.5h-3.5a2 2 0 1 0-4 0H5V16a2 2 0 1 0 0-4z"/>' },
  { k: 'layers', n: 'Camadas / arquitetura', g: 'operacoes', kw: 'camadas arquitetura stack níveis plataforma estrutura', m: 'nudge:a', o: '--ay:-3px',
    b: '<path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5l9 4.5 9-4.5"/>', a: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/>' },
  /* ---- Finanças & Valor ---- */
  { k: 'coin', n: 'Moeda / receita', g: 'financas', kw: 'moeda dinheiro receita valor custo financeiro', m: 'flip',
    b: '<circle cx="12" cy="12" r="9"/>',
    a: '<path d="M14.6 9.3c-.4-.9-1.4-1.5-2.6-1.5-1.5 0-2.6.8-2.6 1.9 0 2.7 5.4 1.4 5.4 4.3 0 1.1-1.2 2-2.8 2-1.3 0-2.4-.6-2.8-1.6"/><path d="M12 6.2v1.6M12 16v1.8"/>' },
  { k: 'cash', n: 'Dinheiro / caixa', g: 'financas', kw: 'dinheiro nota caixa pagamento economia fluxo de caixa', m: 'float',
    b: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 12h.01M18 12h.01"/>', a: '<circle cx="12" cy="12" r="2.6"/>' },
  { k: 'pie', n: 'Participação', g: 'financas', kw: 'pizza participação share mercado fatia distribuição', m: 'nudge:a', o: '--ax:-2.5px;--ay:2.5px',
    b: '<path d="M11 4.5A8.5 8.5 0 1 0 19.5 13H11z"/>', a: '<path d="M13.5 2.5a8 8 0 0 1 8 8h-8z"/>' },
  { k: 'calc', n: 'Calculadora / business case', g: 'financas', kw: 'calculadora business case orçamento cálculo roi', m: 'blink:a',
    b: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>',
    a: '<rect x="8" y="5.5" width="8" height="3.5" rx=".8"/>' },
  { k: 'percent', n: 'Percentual / margem', g: 'financas', kw: 'percentual margem taxa desconto juros percentagem', m: 'wiggle',
    b: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>' },
  { k: 'bank', n: 'Banco / instituição', g: 'financas', kw: 'banco instituição financeira governo tesouraria capital', m: 'nudge:a', o: '--ay:-2.5px',
    b: '<path d="M5.5 11.5v6M10 11.5v6M14 11.5v6M18.5 11.5v6"/><path d="M3 20.5h18"/>', a: '<path d="M3 9L12 4l9 5z"/>' },
  /* ---- Pessoas & Cultura ---- */
  { k: 'users', n: 'Equipe', g: 'pessoas', kw: 'equipe time pessoas colaboradores grupo squad', m: 'nudge:a', o: '--ax:-2.5px;--ay:0px',
    b: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/>',
    a: '<path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 14.3c2.4.6 4 2.8 4 5.7"/>' },
  { k: 'user', n: 'Pessoa / cliente', g: 'pessoas', kw: 'pessoa cliente usuário colaborador perfil persona', m: 'bounce',
    b: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/>' },
  { k: 'handshake', n: 'Parceria / acordo', g: 'pessoas', kw: 'aperto de mão parceria acordo negociação aliança contrato', m: 'wiggle',
    b: '<path d="M20.5 4.5l1.5 9.5h-2.2"/><path d="M3.5 4.5L2 14h2.2"/><path d="M3.6 5.5h5.2"/><path d="M20.4 5.6l-2.3.5a2 2 0 0 1-1.4-.2l-.7-.4a5.5 5.5 0 0 0-6.6.9L6.8 8.9a1.15 1.15 0 0 0 1.6 1.6l1.3-1.2a2.8 2.8 0 0 1 4 0l4.6 4.6"/>',
    a: '<path d="M4.2 14l6.3 5.8a1.15 1.15 0 0 0 1.6-1.6"/><path d="M10.5 16.6l1.9 1.9a1.15 1.15 0 0 0 1.6-1.6"/><path d="M12.9 14.6l1.9 1.9a1.15 1.15 0 0 0 1.6-1.6"/><path d="M15.2 12.6l1.6 1.6a1.15 1.15 0 0 0 1.6-1.6"/>' },
  { k: 'org', n: 'Organograma', g: 'pessoas', kw: 'organograma hierarquia estrutura organizacional governança áreas', m: 'redraw:a',
    b: '<rect x="9" y="2.5" width="6" height="5" rx="1.2"/><rect x="2.5" y="16.5" width="5.5" height="5" rx="1.2"/><rect x="9.25" y="16.5" width="5.5" height="5" rx="1.2"/><rect x="16" y="16.5" width="5.5" height="5" rx="1.2"/>',
    a: '<path d="M12 7.5v9"/><path d="M5.25 16.5V12h13.5v4.5"/>' },
  { k: 'megaphone', n: 'Comunicação', g: 'pessoas', kw: 'megafone comunicação anúncio campanha marketing divulgação', m: 'blink:a',
    b: '<path d="M3.5 9.5v5h3l8 4.5v-14l-8 4.5z"/><path d="M7 14.5l1.2 5.5h2.4l-1-5"/>',
    a: '<path d="M17.8 9.6a3.4 3.4 0 0 1 0 4.8"/><path d="M20.2 7.2a6.8 6.8 0 0 1 0 9.6"/>' },
  { k: 'chat', n: 'Diálogo / feedback', g: 'pessoas', kw: 'conversa diálogo feedback comentário entrevista comunicação', m: 'blink:a',
    b: '<path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v9.5A1.5 1.5 0 0 1 20 17h-9.5l-5 4v-4H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5z"/>',
    a: '<path d="M8 10.8h.01M12 10.8h.01M16 10.8h.01"/>' },
  { k: 'heart', n: 'Engajamento / cultura', g: 'pessoas', kw: 'coração engajamento cultura cuidado clima valores', m: 'beat',
    b: '<path d="M12 20.5C7 17 3 13.6 3 9.3 3 6.6 5.1 4.5 7.7 4.5c1.8 0 3.4 1 4.3 2.5.9-1.5 2.5-2.5 4.3-2.5 2.6 0 4.7 2.1 4.7 4.8 0 4.3-4 7.7-9 11.2z"/>' },
  { k: 'grad', n: 'Capacitação', g: 'pessoas', kw: 'capacitação treinamento educação formatura aprendizagem academia', m: 'swing:a', o: '--o:20.5px 9.5px',
    b: '<path d="M12 4.5L2 9.5l10 5 10-5z"/><path d="M6 11.5V16c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8v-4.5"/>', a: '<path d="M20.5 9.5V15"/><path d="M20.5 15l-.9 2h1.8z"/>' },
  /* ---- Risco & Governança ---- */
  { k: 'shield', n: 'Segurança / risco', g: 'risco', kw: 'escudo segurança risco proteção cyber compliance', m: 'redraw:a',
    b: '<path d="M12 21.5s7.5-3.5 7.5-9.5V5.5L12 2.5 4.5 5.5V12c0 6 7.5 9.5 7.5 9.5z"/>', a: '<path d="M8.8 12l2.2 2.2 4.2-4.4"/>' },
  { k: 'lock', n: 'Proteção de dados', g: 'risco', kw: 'cadeado segurança proteção dados privacidade lgpd acesso', m: 'nudge:a', o: '--ay:-2.5px',
    b: '<rect x="4.5" y="10.5" width="15" height="11" rx="2"/><path d="M12 15v2.5"/>', a: '<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>' },
  { k: 'alert', n: 'Ponto de atenção', g: 'risco', kw: 'alerta atenção aviso risco problema cuidado', m: 'wiggle', o: '--o:12px 20px',
    b: '<path d="M10.3 3.9L2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', a: '<path d="M12 9v4.5M12 17h.01"/>' },
  { k: 'scale', n: 'Compliance / equilíbrio', g: 'risco', kw: 'balança compliance justiça equilíbrio jurídico regulação', m: 'swing:a', o: '--o:12px 6.5px',
    b: '<path d="M12 4v17"/><path d="M8 21h8"/><circle cx="12" cy="4" r="1"/>',
    a: '<path d="M4.5 6.5h15"/><path d="M4.5 6.5L2 12.5a2.8 2.8 0 0 0 5 0z"/><path d="M19.5 6.5L17 12.5a2.8 2.8 0 0 0 5 0z"/>' },
  { k: 'doc', n: 'Documento / relatório', g: 'risco', kw: 'documento relatório contrato política arquivo report', m: 'redraw:a',
    b: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/>', a: '<path d="M8.5 9h2.5M8.5 12.5h7M8.5 16h7"/>' },
  { k: 'checklist', n: 'Plano de ação', g: 'risco', kw: 'checklist plano de ação tarefas lista controle auditoria', m: 'redraw:a',
    b: '<rect x="4.5" y="4" width="15" height="17.5" rx="2"/><rect x="8.5" y="2.5" width="7" height="3.5" rx="1"/><path d="M14 11.2h2.5M14 16.2h2.5"/>',
    a: '<path d="M7.8 11l1.3 1.3 2.4-2.4"/><path d="M7.8 16l1.3 1.3 2.4-2.4"/>' },
  { k: 'search', n: 'Diagnóstico / análise', g: 'risco', kw: 'lupa busca diagnóstico análise investigação auditoria due diligence', m: 'orbit',
    b: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3l5.2 5.2"/>', a: '<path d="M7.6 9.2a3.2 3.2 0 0 1 2.6-2.4"/>' },
  /* ---- Tempo & Execução ---- */
  { k: 'clock', n: 'Prazo / tempo', g: 'tempo', kw: 'relógio prazo tempo horário agilidade duração', m: 'tick:a',
    b: '<circle cx="12" cy="12" r="9"/><path d="M12 12l3 2"/>', a: '<path d="M12 12V6.5"/>' },
  { k: 'calendar', n: 'Cronograma / agenda', g: 'tempo', kw: 'calendário cronograma agenda data prazo planejamento', m: 'blink:a',
    b: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v4M16 3v4"/>', a: '<path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01"/>' },
  { k: 'hourglass', n: 'Urgência', g: 'tempo', kw: 'ampulheta urgência tempo espera prazo contagem', m: 'spin', o: '--sp:180deg',
    b: '<path d="M6.5 2.5h11M6.5 21.5h11"/><path d="M7.5 2.5v3.2c0 2 1.6 3.4 4.5 6.3 2.9-2.9 4.5-4.3 4.5-6.3V2.5"/><path d="M7.5 21.5v-3.2c0-2 1.6-3.4 4.5-6.3 2.9 2.9 4.5 4.3 4.5 6.3v3.2"/>',
    a: '<path d="M10 19.3h4"/>' },
  { k: 'check', n: 'Concluído', g: 'tempo', kw: 'concluído check aprovado ok entregue feito sucesso', m: 'redraw:a',
    b: '<circle cx="12" cy="12" r="9"/>', a: '<path d="M8 12.3l2.7 2.7 5.3-5.5"/>' },
  { k: 'bell', n: 'Alerta / lembrete', g: 'tempo', kw: 'sino alerta lembrete notificação aviso', m: 'swing', o: '--o:12px 3px',
    b: '<path d="M12 3v1.5"/><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/>', a: '<path d="M10 21a2.2 2.2 0 0 0 4 0"/>' },
  /* ---- Mercado & ESG ---- */
  { k: 'globe', n: 'Global / mercado', g: 'mercado', kw: 'globo global mundo mercado internacional expansão', m: 'flip:a',
    b: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>', a: '<path d="M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>' },
  { k: 'building', n: 'Empresa / corporativo', g: 'mercado', kw: 'prédio empresa corporativo escritório sede organização', m: 'blink:a',
    b: '<rect x="4.5" y="3" width="10" height="18.5" rx="1"/><path d="M14.5 9h4a1 1 0 0 1 1 1v11.5"/><path d="M2.5 21.5h19"/><path d="M8.5 21.5v-3h2v3"/>',
    a: '<path d="M8 7h.01M11 7h.01M8 10.5h.01M11 10.5h.01M8 14h.01M11 14h.01"/>' },
  { k: 'leaf', n: 'Sustentabilidade / ESG', g: 'mercado', kw: 'folha sustentabilidade esg meio ambiente verde carbono', m: 'swing', o: '--o:4px 20px',
    b: '<path d="M5.5 18.5C5 10 10 4.5 20 4c.5 9.5-5 15-14.5 14.5z"/><path d="M3.5 20.5l2-2"/>', a: '<path d="M5.5 18.5c3.2-4.6 6.4-7.6 10.5-10"/>' },
  { k: 'pin', n: 'Localização / unidade', g: 'mercado', kw: 'localização pin mapa unidade filial região território', m: 'bounce',
    b: '<path d="M12 21.5s-7-6-7-11.5a7 7 0 0 1 14 0c0 5.5-7 11.5-7 11.5z"/>', a: '<circle cx="12" cy="10" r="2.5"/>' },
  { k: 'bolt', n: 'Energia / agilidade', g: 'mercado', kw: 'raio energia agilidade velocidade rápido quick win', m: 'pulse',
    b: '<path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z"/>' }
];
/* glifos extras só para pares de morph (estado A → estado B) */
var AMICON_GLYPHS = {
  trenddown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  lockopen: '<rect x="4.5" y="10.5" width="15" height="11" rx="2"/><path d="M12 15v2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.7-1.5"/>',
  play: '<path d="M7.5 4.5v15l11.5-7.5z"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.3-2.6 3.9"/><path d="M12 17.2h.01"/>'
};
/* pares de morph: [id, nome, estado A, estado B]; A/B = chave de AMICONS (base+detalhe) ou de AMICON_GLYPHS */
var AMICON_MORPHS = [['alert-check', 'Problema → solução', 'alert', 'check'], ['trend-flip', 'Queda → alta', 'trenddown', 'trend'], ['lock-close', 'Aberto → protegido', 'lockopen', 'lock'], ['play-pause', 'Iniciar ↔ pausar', 'play', 'pause'], ['plus-check', 'Adicionar → confirmado', 'plus', 'check'], ['x-check', 'Reprovado → aprovado', 'x', 'check'], ['question-idea', 'Dúvida → ideia', 'question', 'idea']];
var AMICON_GROUPS = [['estrategia', 'Estratégia & crescimento'], ['tecnologia', 'Inovação & tecnologia'], ['operacoes', 'Operações & processos'], ['financas', 'Finanças & valor'], ['pessoas', 'Pessoas & cultura'], ['risco', 'Risco & governança'], ['tempo', 'Tempo & execução'], ['mercado', 'Mercado & ESG']];
if (typeof module !== 'undefined') module.exports = { AMICONS: AMICONS, AMICON_GROUPS: AMICON_GROUPS, AMICON_GLYPHS: AMICON_GLYPHS, AMICON_MORPHS: AMICON_MORPHS };
```

Drawing conventions (for anyone adding icons):
- 2 px padding;
- only `path` / `circle` / `rect` / `ellipse` / `line` / `polyline` (the renderer's regex);
- no fills;
- dots as `M x y h.01`;
- the accent = the one part that tells the story (needle, check, arrow, flame);
- keep `kw` in pt-BR with synonyms that consultants type ("meta", "kpi", "lgpd", "quick win").

### A.8 Screenshots

| File (in `QA/`) | Shows |
|---|---|
| `icons-sheet.png` | All 54 icons at 56 px, grouped, with key and default motion |
| `icons-grid-big.png` | 150 px on the 24-grid with the 2 px safe area (orange square). Use it to review geometry. |
| `ti-grid.png` | **Real runtime**: 54 `FX.icon` elements with labels, mid-loop |
| `motion-icons-m045.png` | Draw-on at 45% (stagger, accent last) |
| `motion-icons-03.png` | Each icon's default motion frozen at 30% of its cycle |
| `motion-motions-012.png` / `-03.png` | The 17 motions applied to target, gear, chartup and bell (origin and target rules) |
| `morph-plates.png` | 7 morph pairs at 0%, 47% and 60%, plus the 5 plates (`none`, `soft`, `circle`, `ring`, `navy`) |
| `tp-morph.png` | Player with a clickable morph, after the click; still on slide 01 |

---

## B. LINES, ARROWS, CONNECTORS AND SHAPES (item 4.1)

### B.1 Parity with PowerPoint: what Canteiro has today

| PowerPoint | Canteiro today (`runtime.js shapeBody` / `lineSVG`, `editor.js SHAPES` / `mkLine`) | After this spec |
|---|---|---|
| Line, arrow, double arrow | ✓ straight line, ✓ arrow (filled triangle), ✓ both ends | + heads **open, dot, diamond, bar** per end |
| Elbow connector | ✗ | ✓ `curve:'elbow'` with rounded corner (r ≤ 10) and `bend` 0.05–0.95 |
| Curved connector | ✗ | ✓ `curve:'curve'` (cubic, horizontal or vertical tangents, stays inside `lineBox`) |
| Dash types | ~ one "Tracejada" toggle, **broken (renders solid)** | ✓ dash, dot (round), dash-dot, long dash; works with "Desenhar" |
| Rectangle, rounded rect | ✓ `rect`, `round` (+ radius) | + card looks |
| Pill / ellipse / triangle / diamond / parallelogram / chevron / block arrow | ✓ `pill`, `ellipse`, `triangle`, `diamond`, `para`, `chevron`, `arrow` | unchanged (keep `rect` first and `chevron`; tests use them) |
| Pentagon (home plate) | ✗ | ✓ `pentagon` P0 |
| Hexagon, octagon | ✗ | ✓ `hexagon` P0, `octagon` P1 |
| Trapezoid, right triangle | ✗ | ✓ `trapezoid` P1, `rtri` P1 |
| Star, plus, donut (ring) | ✗ | ✓ `star` P1, `plus` P1, `ring` P0 |
| Callouts | ✗ | ✓ `callout` (rounded rect + tail) P0 |
| Double arrow, notched arrow | ✗ | ✓ `darrow` P0, `notch` P0 |
| Flowchart: document, database (cylinder) | ✗ | ✓ `wave` P1, `cylinder` P0 |
| Brackets / braces | ✗ | ✓ `brackets`, `braces` (stroke-only) P0 |
| Shape effects: shadow, outline dash | ✓ `shadow`, ✓ `dash` | + `look` card styles |

### B.2 The dashed-line bug and its fix (P0)

Today (`runtime.js` 33–46):

```html
<path class="am-ln" pathLength="1" d="…" stroke-width="6" stroke-dasharray="18 13.2"/>
```

Dash units are scaled by `pathLength`, so an 18-unit dash on a line of length 1 is a solid line. Measured in Chromium:
- `getComputedStyle(...).strokeDasharray = "18px, 13.2px"`;
- `pathLength="1"`;
- the result looks solid.

With `anim.in=draw`, `.am-in .am-el[data-in=draw] .am-ln{stroke-dasharray:1}` overrides it during and after the animation. Both cases are visible in `QA/shapes-lines.png` (last panel, the two top lines). The rounded shape below them **is** dashed (no `pathLength`).

Fix, verified (`QA/mask-mid.png` shows the dashes revealed at 50% of the draw):
- a **non-dashed** line keeps exactly today's markup (`.am-ln` + `pathLength=1`);
- a **dashed** line renders the visible stroke **without** `pathLength`, so the dashes are in real units, and masks it with an `.am-ln` path.

The existing `amDraw` CSS animates the mask, so "Desenhar" reveals static dashes. `.am-hit` is unchanged (test IX-04). The mask id comes from a module counter (`LUID`), never from `el.id`.

### B.3 Line model and code (`rt-10-shapes.js` replaces `lineSVG`)

Fields (ARCH §3.5 names):

| Field | Values | Default |
|---|---|---|
| `curve` | `straight`, `elbow`, `curve` | `straight` |
| `bend` | 0.05–0.95 | 0.5 (position of the elbow's middle segment) |
| `dash` | bool (existing) | false |
| `dashS` | `dash`, `dot`, `dashdot`, `long` | `dash` |
| `headS`, `headE` | `arrow`, `open`, `dot`, `diamond`, `bar`; absent = use the booleans | — |
| `headStart`, `headEnd` | bool (existing) | as today |

Resolution order: `headE` wins if valid. Otherwise `headEnd ? 'arrow' : none`. Old decks render the same.

Geometry rules:
- **Elbow:** horizontal-first when `|dx| ≥ |dy|`, else vertical-first.
- **Curve:** horizontal tangents when `|dx| ≥ |dy|` (S-curve connector).
- **Head angle:** taken from the **final segment** (elbow) or the last control point (curve), not from the chord.
- **Stroke pull-back** per head (`HEAD_BACK` × head size), so the stroke does not poke through the head.
- **Bounds:** both routes stay inside `lineBox`, so `lineBox`, selection handles and `startResize` are untouched.

```js
var DASH = { dash: [3, 2], dot: [0.01, 2], dashdot: [3, 1.6, 0.01, 1.6], long: [6, 2.5] }; /* múltiplos da espessura; 0.01 + linecap round = ponto */
function dashAttr(el, sw) {
  var k = el.dash ? (DASH[el.dashS] ? el.dashS : 'dash') : null; if (!k || !sw) return ''; /* el.dash (bool, já existe) liga; el.dashS escolhe o estilo */
  return ' stroke-dasharray="' + DASH[k].map(function (m) { return f2(m * sw); }).join(' ') + '"' + (k === 'dot' || k === 'dashdot' ? ' stroke-linecap="round"' : '');
}

/* ---------- linhas: rota (reta | cotovelo | curva), tracejado, pontas ---------- */
function lineGeom(el, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1, route = el.curve || 'straight';
  if (route === 'curve') { var hz = Math.abs(dx) >= Math.abs(dy), c1 = hz ? [x1 + dx * .5, y1] : [x1, y1 + dy * .5], c2 = hz ? [x2 - dx * .5, y2] : [x2, y2 - dy * .5];
    return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'C' + c1[0] + ' ' + c1[1] + ' ' + c2[0] + ' ' + c2[1] + ' ' + e[0] + ' ' + e[1]; }, a0: Math.atan2(c1[1] - y1, c1[0] - x1), a1: Math.atan2(y2 - c2[1], x2 - c2[0]) }; }
  if (route === 'elbow') { var hz2 = Math.abs(dx) >= Math.abs(dy), b = el.bend == null ? .5 : +el.bend;
    var rr = Math.min(10, Math.abs(dx) / 2, Math.abs(dy) / 2), sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    if (hz2) { var xm = x1 + dx * b;
      return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'H' + (xm - sx * rr) + 'Q' + xm + ' ' + s[1] + ' ' + xm + ' ' + (s[1] + sy * rr) + 'V' + (e[1] - sy * rr) + 'Q' + xm + ' ' + e[1] + ' ' + (xm + sx * rr) + ' ' + e[1] + 'H' + e[0]; }, a0: dx < 0 ? Math.PI : 0, a1: dx < 0 ? Math.PI : 0 }; }
    var ym = y1 + dy * b;
    return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'V' + (ym - sy * rr) + 'Q' + s[0] + ' ' + ym + ' ' + (s[0] + sx * rr) + ' ' + ym + 'H' + (e[0] - sx * rr) + 'Q' + e[0] + ' ' + ym + ' ' + e[0] + ' ' + (ym + sy * rr) + 'V' + e[1]; }, a0: dy < 0 ? -Math.PI / 2 : Math.PI / 2, a1: dy < 0 ? -Math.PI / 2 : Math.PI / 2 }; }
  var an = Math.atan2(dy, dx); return { d: function (s, e) { return 'M' + s[0] + ' ' + s[1] + 'L' + e[0] + ' ' + e[1]; }, a0: an, a1: an };
}
var HEAD_BACK = { arrow: .8, open: .12, dot: .7, diamond: 1.5, bar: 0 };
function headSVG(kind, px, py, a, s, c, sw) {
  var co = Math.cos(a), si = Math.sin(a), bx = px - s * co, by = py - s * si, ox = -si * s * .55, oy = co * s * .55;
  if (kind === 'open') return '<path class="am-head" d="M' + f2(bx + ox) + ' ' + f2(by + oy) + 'L' + px + ' ' + py + 'L' + f2(bx - ox) + ' ' + f2(by - oy) + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
  if (kind === 'dot') return '<circle class="am-head" cx="' + f2(px - co * s * .4) + '" cy="' + f2(py - si * s * .4) + '" r="' + f2(s * .42) + '" fill="' + c + '"/>';
  if (kind === 'diamond') { var mx = px - co * s * .9, my = py - si * s * .9, bx2 = px - co * s * 1.8, by2 = py - si * s * 1.8; return '<path class="am-head" d="M' + px + ' ' + py + 'L' + f2(mx + ox * .8) + ' ' + f2(my + oy * .8) + 'L' + f2(bx2) + ' ' + f2(by2) + 'L' + f2(mx - ox * .8) + ' ' + f2(my - oy * .8) + 'Z" fill="' + c + '"/>'; }
  if (kind === 'bar') return '<path class="am-head" d="M' + f2(px + ox) + ' ' + f2(py + oy) + 'L' + f2(px - ox) + ' ' + f2(py - oy) + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
  return '<path class="am-head" d="M' + px + ' ' + py + 'L' + f2(bx + ox) + ' ' + f2(by + oy) + 'L' + f2(bx - ox) + ' ' + f2(by - oy) + 'Z" fill="' + c + '"/>';
}
function lineSVG2(el, b) {
  var x1 = el.x1 - b.x, y1 = el.y1 - b.y, x2 = el.x2 - b.x, y2 = el.y2 - b.y, sw = +el.strokeW || 2, c = el.stroke || '#002A46', s = Math.max(9, sw * 3.4);
  var hs = HEAD_BACK.hasOwnProperty(el.headS) ? el.headS : (el.headStart ? 'arrow' : null), he = HEAD_BACK.hasOwnProperty(el.headE) ? el.headE : (el.headEnd ? 'arrow' : null), /* headS/headE escolhem o tipo; booleanos antigos = 'arrow' */ g = lineGeom(el, x1, y1, x2, y2), heads = '', S = [x1, y1], E = [x2, y2];
  if (he) { heads += headSVG(he, x2, y2, g.a1, s, c, sw); E = [x2 - Math.cos(g.a1) * s * HEAD_BACK[he], y2 - Math.sin(g.a1) * s * HEAD_BACK[he]]; }
  if (hs) { heads += headSVG(hs, x1, y1, g.a0 + Math.PI, s, c, sw); S = [x1 + Math.cos(g.a0) * s * HEAD_BACK[hs], y1 + Math.sin(g.a0) * s * HEAD_BACK[hs]]; }
  S = S.map(f2); E = E.map(f2);
  var d = g.d(S, E), dsh = dashAttr(el, sw), hit = '<path class="am-hit" d="' + g.d([x1, y1], [x2, y2]) + '" stroke="transparent" stroke-width="' + Math.max(14, sw + 10) + '" stroke-linecap="round" fill="none"/>';
  if (!dsh) return '<svg viewBox="0 0 ' + b.w + ' ' + b.h + '">' + hit + '<path class="am-ln" pathLength="1" d="' + d + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' + heads + '</svg>';
  /* tracejada: o traço visível NÃO tem pathLength (tracejado em unidades reais); a animação "Desenhar" age na máscara (.am-ln) */
  var mid = 'lm' + (++LUID).toString(36);
  return '<svg viewBox="0 0 ' + b.w + ' ' + b.h + '">' + hit + '<mask id="' + mid + '" maskUnits="userSpaceOnUse" x="0" y="0" width="' + b.w + '" height="' + b.h + '"><path class="am-ln" pathLength="1" d="' + d + '" stroke="#fff" stroke-width="' + (sw + 4) + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/></mask><path class="am-lnd" d="' + d + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linejoin="round" fill="none"' + dsh + ' mask="url(#' + mid + ')"/>' + heads + '</svg>';
}
var LUID = 0;
```

**Editor (Linha section, renderProps E:360–362).** Replace the toggle row with:

```
Traçado   [ Reta | Cotovelo | Curva ]                     → data-p="curve"
Dobra     [ ——●—— ] 10–90 %  (only for Cotovelo)          → data-p="bend" (0.1–0.9)
Estilo    [ Contínua | Tracejada | Pontilhada | Traço-ponto | Traço longo ] → dash (bool) + dashS
Início    [ — | ▶ Seta | > Aberta | ● Bola | ◆ Losango | ┃ Barra ]  → headStart (bool) + headS
Fim       [ — | ▶ | > | ● | ◆ | ┃ ]                                 → headEnd (bool) + headE
```

Gallery for ARCH's split button "↗ Seta ▾" (`mLine`, keep `[data-add=arrow]`). Each preset is an `mkLine` override:

| Preset | Fields |
|---|---|
| Linha | defaults |
| Seta | `headEnd:true` |
| Seta dupla | `headStart:true, headEnd:true` |
| Conector em cotovelo | `curve:'elbow', headEnd:true` |
| Conector curvo | `curve:'curve', headEnd:true` |
| Linha tracejada | `dash:true` |
| Pontilhada com bola | `dash:true, dashS:'dot', headS:'dot', headStart:true` |
| Cota / medida | `headS:'bar', headE:'bar'`, both booleans true |

### B.4 New shapes (hook into `shapeBody`)

In `rt-10-shapes.js`, wrap the original `shapeBody`:

```js
var base = R.shapeBody;
R.shapeBody = function (el, w, h) {
  /* same sw / i / a computation as base */
  var x = shapeExtra(el, w, h, i, a);
  return cardLook(el, w, h, x != null ? x : base(el, w, h));
};
```

`content()` calls `shapeBody` through the closure. So either patch `content()` to call `R.shapeBody`, or make the two-line edit inside runtime.js. The second is simpler. The editor's `shapeIcon` already calls `RT.shapeBody`.

```js
/* novas formas (entram no switch de shapeBody; i = metade do contorno, a = atributos) */
function shapeExtra(el, w, h, i, a) {
  var k, r, t, s = el.shape;
  switch (s) {
    case 'pentagon': k = Math.min(w * .3, h * .5); return '<path d="' + pts([[i, i], [w - k, i], [w - i, h / 2], [w - k, h - i], [i, h - i]]) + '" ' + a + '/>';
    case 'hexagon': k = Math.min(w * .25, h * .5); return '<path d="' + pts([[k, i], [w - k, i], [w - i, h / 2], [w - k, h - i], [k, h - i], [i, h / 2]]) + '" ' + a + '/>';
    case 'octagon': k = Math.min(w, h) * .29; return '<path d="' + pts([[k, i], [w - k, i], [w - i, k], [w - i, h - k], [w - k, h - i], [k, h - i], [i, h - k], [i, k]]) + '" ' + a + '/>';
    case 'trapezoid': k = Math.min(w * .22, h * .6); return '<path d="' + pts([[k, i], [w - k, i], [w - i, h - i], [i, h - i]]) + '" ' + a + '/>';
    case 'rtri': return '<path d="' + pts([[i, i], [w - i, h - i], [i, h - i]]) + '" ' + a + '/>';
    case 'star': {
      var Rx = (w - 2 * i) / 1.902, Ry = (h - 2 * i) / 1.809, cx = w / 2, cy = i + Ry, P = [];
      for (k = 0; k < 10; k++) { var ang = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? .45 : 1; P.push([cx + Math.cos(ang) * Rx * q, cy + Math.sin(ang) * Ry * q]); }
      return '<path d="' + pts(P) + '" ' + a + '/>';
    }
    case 'plus': t = Math.min(w, h) * .34; var x1 = (w - t) / 2, x2 = (w + t) / 2, y1 = (h - t) / 2, y2 = (h + t) / 2;
      return '<path d="' + pts([[x1, i], [x2, i], [x2, y1], [w - i, y1], [w - i, y2], [x2, y2], [x2, h - i], [x1, h - i], [x1, y2], [i, y2], [i, y1], [x1, y1]]) + '" ' + a + '/>';
    case 'ring': t = Math.min(w, h) * .2; var rx = w / 2 - i, ry = h / 2 - i, ix = Math.max(1, rx - t), iy = Math.max(1, ry - t);
      return '<path fill-rule="evenodd" d="M' + i + ' ' + h / 2 + 'a' + rx + ' ' + ry + ' 0 1 0 ' + 2 * rx + ' 0a' + rx + ' ' + ry + ' 0 1 0-' + 2 * rx + ' 0zM' + (w / 2 - ix) + ' ' + h / 2 + 'a' + ix + ' ' + iy + ' 0 1 0 ' + 2 * ix + ' 0a' + ix + ' ' + iy + ' 0 1 0-' + 2 * ix + ' 0z" ' + a + '/>';
    case 'callout': { /* retângulo arredondado + ponta embaixo à esquerda */
      var b = h * .78, rr = Math.max(0, Math.min(+el.radius || 12, w / 4, b / 3)), t1 = w * .16, t2 = w * .3, tx = w * .12;
      return '<path d="M' + (i + rr) + ' ' + i + 'H' + (w - i - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (w - i) + ' ' + (i + rr) + 'V' + (b - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (w - i - rr) + ' ' + b + 'H' + t2 + 'L' + tx + ' ' + (h - i) + 'L' + t1 + ' ' + b + 'H' + (i + rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + i + ' ' + (b - rr) + 'V' + (i + rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (i + rr) + ' ' + i + 'Z" ' + a + '/>';
    }
    case 'darrow': k = Math.min(w * .26, h * .7); return '<path d="' + pts([[i, h / 2], [k, i], [k, h * .28], [w - k, h * .28], [w - k, i], [w - i, h / 2], [w - k, h - i], [w - k, h * .72], [k, h * .72], [k, h - i]]) + '" ' + a + '/>';
    case 'notch': k = Math.min(w * .32, h * .7); return '<path d="' + pts([[i, h * .28], [w - k, h * .28], [w - k, i], [w - i, h / 2], [w - k, h - i], [w - k, h * .72], [i, h * .72], [k * .45, h / 2]]) + '" ' + a + '/>';
    case 'cylinder': { var e = Math.min(h * .14, w * .25);
      return '<path d="M' + i + ' ' + (i + e) + 'V' + (h - i - e) + 'A' + (w / 2 - i) + ' ' + e + ' 0 0 0 ' + (w - i) + ' ' + (h - i - e) + 'V' + (i + e) + '" ' + a + '/><ellipse cx="' + w / 2 + '" cy="' + (i + e) + '" rx="' + (w / 2 - i) + '" ry="' + e + '" ' + a + '/>';
    }
    case 'wave': { /* documento de fluxograma: base ondulada */
      var y = h * .84, ww = w - 2 * i;
      return '<path d="M' + i + ' ' + i + 'H' + (w - i) + 'V' + y + 'C' + (i + ww * .75) + ' ' + (y - h * .16) + ' ' + (i + ww * .5) + ' ' + (h - i + h * .02) + ' ' + (i + ww * .25) + ' ' + (h - i - h * .06) + 'S' + i + ' ' + y + ' ' + i + ' ' + y + 'Z" ' + a + '/>';
    }
    case 'brackets': case 'braces': {
      var sw = Math.max(+el.strokeW || 0, 3), c = el.stroke && el.stroke !== 'none' ? el.stroke : (el.fill && el.fill !== 'none' ? el.fill : '#002A46'), j = sw / 2, q = Math.min(w * .1, 22), L, R;
      var at = 'fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"' + dashAttr(el, sw);
      if (s === 'brackets') { L = 'M' + (j + q) + ' ' + j + 'H' + j + 'V' + (h - j) + 'H' + (j + q); R = 'M' + (w - j - q) + ' ' + j + 'H' + (w - j) + 'V' + (h - j) + 'H' + (w - j - q); }
      else { var m = Math.min(q, h * .12), xm = j + q / 2; L = 'M' + (j + q) + ' ' + j + 'Q' + xm + ' ' + j + ' ' + xm + ' ' + (j + m) + 'V' + (h / 2 - m) + 'Q' + xm + ' ' + h / 2 + ' ' + j + ' ' + h / 2 + 'Q' + xm + ' ' + h / 2 + ' ' + xm + ' ' + (h / 2 + m) + 'V' + (h - j - m) + 'Q' + xm + ' ' + (h - j) + ' ' + (j + q) + ' ' + (h - j);
        R = L.replace(/([MQHVL ])(-?[\d.]+) (-?[\d.]+)/g, function (all, cmd, x, y) { return cmd + f2(w - x) + ' ' + y; }); }
      return '<path d="' + L + '" ' + at + '/><path d="' + R + '" ' + at + '/>';
    }
  }
  return null;
}
```

`SHAPES` additions (editor.js 465), keeping `rect` first and `chevron`:

```js
['pentagon','Pentágono-seta'],['hexagon','Hexágono'],['callout','Balão de fala'],['darrow','Seta dupla'],['notch','Seta entalhada'],['cylinder','Cilindro'],['ring','Anel'],['brackets','Colchetes'],['braces','Chaves'],['octagon','Octógono'],['trapezoid','Trapézio'],['rtri','Triângulo retângulo'],['star','Estrela'],['plus','Cruz'],['wave','Documento']
```

**Default sizes** (`mkShape`):
- `sq` list gains `octagon`, `star`, `plus`, `ring`;
- `pentagon`, `darrow`, `notch` → 280×140;
- `callout` → 300×160;
- `cylinder` → 160×200;
- `brackets` / `braces` → 300×160 with `strokeW:3`, `fill:'none'`, `stroke:'#002A46'`.

**Text inset map** in `content()` (the padding of the text box inside the shape, in % of the box):

| Shape | Inset (top right bottom left) |
|---|---|
| `callout` | 0 0 22% 0 |
| `triangle`, `rtri` | 35% 18% 0 18% |
| `star` | 30% 25% 20% 25% |
| `cylinder` | 18% 0 6% 0 |
| `wave` | 0 0 16% 0 |
| `pentagon`, `notch` | 0 18% 0 0 |
| `darrow` | 0 14% |
| `brackets`, `braces` | 0 8% |

**Brackets / braces semantics:**
- stroke-only;
- the colour comes from `stroke` (fallback `fill`);
- the inspector shows "Cor do traço" and "Espessura" only;
- the Preenchimento swatches are hidden for these two shapes.

### B.5 Card looks (`el.look`, for `rect` / `round` / `pill`)

| look | pt-BR | Rendering |
|---|---|---|
| `flat` | Chapado | today's body |
| `outline` | Contorno | white fill, stroke `#CBD4E1`, 1.5 |
| `accent` | Barra lateral | body + orange bar on the left, `max(6, w·1.8%)` wide, clipped by the radius |
| `topbar` | Barra no topo | body + orange bar on top, `max(5, h·3%)` tall |
| `header` | Cabeçalho navy | body + navy band on the top 26% (put the title in it, with `valign:top` and white text) |
| `gradient` | Gradiente navy | the same 155° gradient as `.fx-dark` (`#0B3A63 → #002A46 → #001E32`) |

Inspector: chips "Estilo do card" under Forma, shown only for `rect` / `round` / `pill`. Shadow stays a separate toggle. Use the DTS "Repouso/Destaque" elevation (DTS-CONTROLS) for depth.

```js
/* estilo de card (el.look) para rect/round/pill: devolve camadas extras depois do corpo */
function cardLook(el, w, h, body) { /* ids únicos por render (contador do módulo), nunca el.id: miniaturas e palco convivem no mesmo documento */
  var id = 'kl' + (++LUID).toString(36), lk = el.look || 'flat', r = el.shape === 'pill' ? Math.min(w, h) / 2 : (el.shape === 'round' ? (+el.radius || Math.min(w, h) * .12) : (+el.radius || 0));
  var clip = '<clipPath id="' + id + '"><rect width="' + w + '" height="' + h + '" rx="' + r + '"/></clipPath>';
  if (lk === 'accent') return body + '<defs>' + clip + '</defs><rect width="' + Math.max(6, w * .018) + '" height="' + h + '" fill="#F78C16" clip-path="url(#' + id + ')"/>';
  if (lk === 'topbar') return body + '<defs>' + clip + '</defs><rect width="' + w + '" height="' + Math.max(5, h * .03) + '" fill="#F78C16" clip-path="url(#' + id + ')"/>';
  if (lk === 'header') return body + '<defs>' + clip + '</defs><rect width="' + w + '" height="' + h * .26 + '" fill="#002A46" clip-path="url(#' + id + ')"/>';
  if (lk === 'gradient') return '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2=".55" y2="1"><stop offset="0" stop-color="#0B3A63"/><stop offset=".55" stop-color="#002A46"/><stop offset="1" stop-color="#001E32"/></linearGradient></defs>' + body.replace(/fill="[^"]*"/, 'fill="url(#' + id + 'g)"');
  if (lk === 'outline') return body.replace(/fill="[^"]*"/, 'fill="#FFFFFF"').replace(/stroke="[^"]*"/, 'stroke="#CBD4E1"').replace(/stroke-width="[^"]*"/, 'stroke-width="1.5"');
  return body;
}
```

Ids come from the module counter `LUID`, shared with the line masks (pitfall 0.7c).

### B.6 Screenshots

- `QA/shapes-lines.png`: the 15 new shapes, filled and outlined; the 6 card looks; line routes, dash styles and heads; and the current-runtime bug panel.
- `QA/lines-crop.png`: routes, dashes and heads.
- `QA/lines-crop2.png`: dotted curved connector, `dot` → `arrow`.
- `QA/mask-mid.png`: draw-on of a dashed curve at 50%.

---

## C. CHARTS (item 4.2)

### C.1 Inventory and gaps (what Big Four decks use)

Existing: `bars` (single series column), `linechart` (single series), `donut`, `gauge`, `progress`, `counter`.

| Chart | Use in consulting decks | Priority | Status |
|---|---|---|---|
| Grouped column | comparison across categories and years | **P0** | prototyped `columns` (mode `cluster`) |
| Stacked / 100% stacked | composition over time, mix | **P0** | same kind, modes `stack` / `pct` |
| Horizontal bar ranking | top-N, savings by initiative, benchmarks | **P0** | prototyped `hbars` |
| Waterfall / bridge | EBITDA bridge, cost walk, value creation | **P0** | prototyped `waterfall` |
| Bullet (target vs actual) | KPI scorecards, status reports | **P0** | prototyped `bullet` |
| Harvey balls | vendor / option evaluation | **P0** | prototyped `harvey` |
| Funnel | sales pipeline, idea funnel, conversion | P1 | prototyped `funnel` |
| Radar | maturity assessment AS-IS vs target | P1 | prototyped `radar` |
| Multi-series line / area | trends, forecast vs actual | P1 | spec `lines` |
| Scatter / bubble | portfolio, price × volume, BCG-like quantitative | P1 | spec `bubble` |
| KPI tiles with sparkline | executive summary | P2 | spec `kpis` |
| Combo bar + line | volume + rate | P2 | spec `combo`: **same unit or split panel only** |
| Pareto | 80/20 of causes | P2 | spec (single 0–100% axis) |
| Marimekko | market map (share × size) | P2 | spec `mekko` |
| Pie | (donut toggle) | P2 | `donut.data.hole: 'donut'/'pie'` |
| Heat table | capability × area | P2 | reuse the `riskmap` cell CSS |
| Gantt | schedule | → models (§E) | prototyped `gantt` |

Research sources: [Mekko Graphics: intro to consulting charts](https://www.mekkographics.com/introduction-to-consulting-charts/), [Stratechi: charts the McKinsey way](https://www.stratechi.com/business-charts/), [Deckary: PowerPoint charts guide for consultants](https://deckary.com/blog/pillar-powerpoint-charts-guide), [StrategyU: 14 consulting slide layouts](https://strategyu.co/slide-layouts/).

### C.2 Colour and mark rules (validated)

`dataviz` validator (`validate_palette.js`), A&M categorical order `#002A46, #4A6FA5, #A3B8D6, #F78C16`, `--pairs all`:
- **CVD separation PASS**: worst all-pairs ΔE 20.2;
- **normal-vision PASS**: ΔE 22.0.

The "lightness band" and "chroma floor" checks fail by brand design: a monochrome-blue identity with one orange. Contrast WARN for `#A3B8D6` and `#F78C16` on white. Consequences:

1. **Max 4 series.** A fifth series folds into "Outros" (`#C9D6E8`). Never generate a 5th hue. Never use red.
2. **Colour follows the entity, not its rank.** A highlight replaces the hue with orange; the others keep theirs or go `#C9D6E8` in "focus" mode.
3. **Mandatory relief** because of the WARN: value labels on bars, a legend whenever there are 2 or more series (`.ch-leg`, with `data-g` per series), and a 2 px white gap between stacked segments.
4. **Negatives (waterfall):** light steel `#C9D6E8` with a 45° white hatch pattern plus a "−" label. Not red.
5. **Ordered categories** (funnel, pyramid, maturity) use the **ordinal ramp** `#002A46 → #13406A → #43698F → #7EA1C3 → #A3B8D6 → #C9D6E8`.
6. **One axis only.** No dual-y combos. Use the same unit (actual × budget) or a split panel sharing x. Pareto uses % for both bars and the cumulative line.
7. **Text** uses `#3E4C5E` (labels) and `#002A46` (values), never the series colour. Grid `#E2E7EF`, axis `#CBD4E1`.
8. **Dark slides:** models get the white panel (`data.panel`, ARCH). On a dark panel the series order becomes `#FFFFFF, #7EA1C3, #C9D6E8, #F78C16` (CVD adjacent ΔE ≥ 16.9, contrast PASS on navy).

### C.3 Prototyped charts (`QA/charts-proto.js` + `QA/charts.css`)

Common rules:
- root `.fx.fxch` + `fxv-<variant>`;
- SVG `viewBox = w h`, `preserveAspectRatio="none"` (labels are inside the logical box);
- HTML layouts (ranking, bullet, Harvey) use `E()` so labels are editable in place;
- every entrance starts at `calc(var(--d,0ms) + …)`.

| kind | Name (pt-BR) | cat | Default size | Data / fields | Variants (key, behaviour, timings) | Dock "Passo" groups (`data-g`) |
|---|---|---|---|---|---|---|
| `columns` | Colunas agrupadas / empilhadas | Gráficos | 820×400 | `title`; `cats` (`lines`); `series` (`rows:t\|*v`, max 4); `mode` (`sel:cluster=Agrupadas\|stack=Empilhadas\|pct=100% empilhadas`); `unit` | `grow`: series by series, bars `amUp` 0.7 s, delay `s·420 + i·90` ms, labels +550 ms · `cat`: category by category `i·380 + s·70` · `stack`: segments drop (`chDrop` back-out 0.55 s) `s·360 + i·60` · `focus`: `data-cycle="g"` per series (legend too) | series |
| `hbars` | Ranking (barras horizontais) | Gráficos | 760×380 | `title`; `items` (`rows:t\|v:n`); `hl` (positions); `sort` (`desc`/`none`); `unit` | `race`: bars `amBar` 1.1 s + values count (`data-count`) · `cascade`: rows `amLeft` with 110 ms stagger · `highlight`: all navy, then highlights turn orange at +1.3 s · `focus` | row |
| `waterfall` | Cascata (ponte de valor) | Gráficos | 900×400 | `title`; `items` (`rows:t\|v:n\|k`, `k='t'` = total, computed when `v=0`); `unit` | `bridge`: each bar rises from the previous level (`wfIn`, `--from` = offset to the previous top) every 330 ms, dashed connectors `amDraw` +380 ms · `build`: totals first, then deltas (260 ms) · `driver`: after the entrance, the largest \|Δ\| turns orange (`wfBig`) and the others drop to 0.35 | bar |
| `bullet` | Meta × realizado (bullet) | Indicadores | 820×300 | `rows` (`rows:t\|v:n\|tg:n\|mx:n`); `bands` (e.g. `50, 80`: qualitative % of max, 3 greys) | `fill`: actual bar `amBar` 1.2 s + counter · `target`: target ticks drop first (`chTg` back-out), bars at +900 ms · `focus` | indicator |
| `harvey` | Bolas de Harvey (comparativo) | Matrizes | 900×380 | `cols` (`lines`); `rows` (`rows:t\|*v`, 0–4); `best` (column number) | `fill`: each wedge sweeps clockwise (`amSeg` on a `pathLength=100` stroke r=8.5, width 17) row by row `r·260 + c·90` · `cols`: column by column · `best`: the winner's header and cells turn orange / `#FFF1E3` at +1.6 s. Click a ball to cycle 0→4 (`data-cyc` + `data-cyc-seq`). | row |
| `funnel` | Funil | Gráficos | 760×420 | `items` (`rows:t\|v:n`); `unit` | `drop`: stages drop (`chDrop`) every 230 ms · `conv`: conversion pills pop afterwards, the lowest conversion in orange · `focus`. Widths ∝ √(v/v₀), min 12%, ordinal ramp, labels and conversion in the right column. | stage |
| `radar` | Radar (teia) | Gráficos | 640×440 | `axes` (`lines`, ≥ 3); `series` (`rows:t\|*v`, max 3: navy fill 16%, orange dashed outline = target, steel); `max` | `grow`: each series scales from the centre (`amZoomC` back-out 0.9 s, 500 ms apart) · `draw`: outlines draw, then fills fade · `compare`: current fades in, target zooms in at +1.1 s | series |

**Implementation notes from the prototypes:**
- **Dashed strokes inside charts** (radar target, waterfall connectors) have the same `pathLength` trap as §B.2.
  - The radar computes the polygon perimeter and writes the dashes in pathLength units: `7/per`, `5/per`.
  - Waterfall connectors have no `pathLength` for their dash, but they use `amDraw`. They are drawn with `stroke-dasharray:1` and become solid after the draw. That is acceptable for 1.2 px connectors. Otherwise use the mask technique.
- **Waterfall totals:**
  - the first item with `k='t'` uses its `v`;
  - later totals use their `v` if it is non-zero, else the running sum.
  - The axis starts at `min(0, lowest level)`. **No truncated axis.**
  - Optional P2: `base` with a zig-zag break mark.
- **Bullet:** lower-is-better KPIs (lead time, cost) need `dir` (`sel:up=Maior é melhor|down=Menor é melhor`) to choose the ✓ state in a later iteration. Colours stay neutral: target = orange tick, actual = navy.
- **Ranking / bullet / Harvey are HTML grids**, so text wraps and stays crisp at any zoom. "Ampliar" re-renders through a fresh `.am-stage` (ARCH F5).

```js
/* 3. Cascata (ponte de valor) */
CH.waterfall = {
  name: 'Cascata (ponte de valor)', cat: 'Gráficos', model: true, chart: true, w: 900, h: 400, variant: 'bridge',
  kw: 'cascata waterfall ponte bridge variação ebitda receita drivers efeitos',
  variants: [['bridge', 'Ponte se construindo', 'Cada barra parte do nível da anterior; os conectores se desenham entre elas.'], ['build', 'Totais e depois efeitos', 'Os totais entram primeiro; os efeitos crescem um a um entre eles.'], ['driver', 'Maior efeito em destaque', 'Depois da entrada, o maior efeito acende em laranja e os demais recuam.']],
  data: { title: 'EBITDA 2024 → 2025 (R$ mi)', items: [{ t: 'EBITDA 2024', v: 120, k: 't' }, { t: 'Volume', v: 18 }, { t: 'Preço', v: 9 }, { t: 'Mix', v: -6 }, { t: 'Custos', v: -11 }, { t: 'Eficiência', v: 14 }, { t: 'EBITDA 2025', v: 0, k: 't' }], unit: '' },
  fields: [['title', 'Título'], ['items', 'Barras (nome | valor | t = total)', 'rows:t|v:n|k'], ['unit', 'Unidade']],
  html: function (d, w, h, el) {
    var v = (el && el.variant) || 'bridge', it = d.items || [], n = Math.max(1, it.length), run = 0, bars = [];
    it.forEach(function (o, i) { var isT = String(o.k || '').toLowerCase().charAt(0) === 't'; if (isT) { var tv = i === 0 || num(o.v) ? num(o.v) : run; if (i === 0) run = tv; bars.push({ t: o.t, a: 0, b: i === 0 ? tv : run, tot: 1, val: i === 0 ? tv : run }); } else { var dv = num(o.v); bars.push({ t: o.t, a: run, b: run + dv, tot: 0, val: dv }); run += dv; } });
    var lo = Math.min(0, Math.min.apply(null, bars.map(function (b) { return Math.min(b.a, b.b); }))), hi = Math.max.apply(null, bars.map(function (b) { return Math.max(b.a, b.b); }).concat([1]));
    var top = d.title ? h * .16 : h * .06, bot = h * .15, ch = h - top - bot, gw = w / n, bw = gw * .56, fs = Math.max(10, Math.min(h * .045, gw * .17)), Y = function (x) { return top + ch - (x - lo) / (hi - lo) * ch * .92; };
    var big = -1, bv = 0; bars.forEach(function (b, i) { if (!b.tot && Math.abs(b.val) > bv) { bv = Math.abs(b.val); big = i; } });
    var o = d.title ? T(0, h * .075, d.title, { fs: Math.max(12, h * .055), w: 700, c: 1, f: '#002A46' }) : '';
    o += '<defs><pattern id="wfh" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#C9D6E8"/><line x1="0" y1="0" x2="0" y2="6" stroke="#fff" stroke-width="2"/></pattern></defs>';
    bars.forEach(function (b, i) {
      var x = gw * i + (gw - bw) / 2, y1 = Y(Math.max(b.a, b.b)), y2 = Y(Math.min(b.a, b.b)), neg = !b.tot && b.val < 0, fill = b.tot ? '#002A46' : (neg ? 'url(#wfh)' : '#4A6FA5');
      var lab = (b.tot ? '' : (b.val > 0 ? '+' : '−')) + fmtN(Math.abs(b.val)) + (d.unit || '');
      o += '<rect class="wf-bar' + (b.tot ? ' tot' : neg ? ' neg' : ' pos') + (i === big ? ' big' : '') + '" data-g="' + i + '" style="--i:' + i + ';--from:' + (b.tot ? 0 : (Y(b.a) - (neg ? y1 : y2))).toFixed(1) + 'px" x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(2, y2 - y1).toFixed(1) + '" rx="3" fill="' + fill + '"' + (neg ? ' stroke="#A3B8D6" stroke-width="1"' : '') + '/>';
      o += T(x + bw / 2, y1 - fs * .55, lab, { fs: fs, a: 'middle', w: b.tot ? 700 : 600, f: '#002A46', cls: 'wf-v', st: '--i:' + i });
      o += T(x + bw / 2, h - bot * .5, b.t, { fs: fs * .95, a: 'middle', w: 700, c: 1, f: TXT });
      if (i < n - 1) { var yy = Y(b.tot ? b.b : b.b); o += '<line class="wf-con" pathLength="1" style="--i:' + i + '" x1="' + (x + bw).toFixed(1) + '" x2="' + (x + gw).toFixed(1) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#7EA1C3" stroke-width="1.2" stroke-dasharray="3 3"/>'; }
    });
    o += '<line x1="0" x2="' + w + '" y1="' + Y(lo) + '" y2="' + Y(lo) + '" stroke="' + AXIS + '" stroke-width="1.5"/>';
    return '<div class="fx fxch fxwf fxv-' + v + '" style="font-size:' + CQ(fs) + '"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + o + '</svg></div>';
  }
};
```

```js
/* 5. Bolas de Harvey */
CH.harvey = {
  name: 'Bolas de Harvey (comparativo)', cat: 'Matrizes', model: true, w: 900, h: 380, variant: 'fill',
  kw: 'harvey bolas comparativo avaliação fornecedores opções critérios scoring benchmark',
  variants: [['fill', 'Preenchendo', 'Cada bola preenche no sentido horário, linha a linha.'], ['cols', 'Opção por opção', 'As colunas são avaliadas uma de cada vez.'], ['best', 'Vencedora em destaque', 'Depois do preenchimento, a melhor opção ganha moldura laranja.']],
  data: { cols: ['Opção A', 'Opção B', 'Opção C'], rows: [{ t: 'Custo total', v: [3, 2, 4] }, { t: 'Prazo de implantação', v: [2, 4, 3] }, { t: 'Aderência ao processo', v: [4, 3, 2] }, { t: 'Risco', v: [1, 3, 4] }], best: 3 },
  fields: [['cols', 'Opções (uma por linha)', 'lines'], ['rows', 'Critérios (nome | nota 0–4 por opção)', 'rows:t|*v'], ['best', 'Opção vencedora (nº, 0 = nenhuma)', 'number']],
  tip: 'Clique numa bola para trocar a nota (0 → 4).',
  html: function (d, w, h, el) {
    var v = (el && el.variant) || 'fill', cols = arr(d.cols), rows = d.rows || [], m = Math.max(1, cols.length), n = Math.max(1, rows.length), best = Math.round(num(d.best)) - 1, fs = Math.max(9, Math.min(h / (n + 1.3) * .3, w / (m + 2.4) * .13));
    var g = '<div class="fx fxhv fxv-' + v + '" style="font-size:' + CQ(fs) + ';grid-template-columns:2.4fr repeat(' + m + ',1fr);grid-template-rows:1.1fr repeat(' + n + ',1fr)"><div></div>';
    cols.forEach(function (c, k) { g += '<div class="hv-h' + (k === best ? ' best' : '') + '" style="--c:' + k + '">' + E('cols.' + k, c) + '</div>'; });
    rows.forEach(function (r, i) {
      g += '<div class="hv-t" style="--r:' + i + '">' + E('rows.' + i + '.t', r.t) + '</div>';
      for (var k = 0; k < m; k++) { var q = Math.max(0, Math.min(4, Math.round(num((r.v || [])[k])))); g += '<div class="hv-c' + (k === best ? ' best' : '') + '" style="--r:' + i + ';--c:' + k + '"><svg viewBox="0 0 40 40" data-cyc="rows.' + i + '.v.' + k + '" aria-label="' + q + ' de 4"><circle cx="20" cy="20" r="17" fill="#fff" stroke="#002A46" stroke-width="2.4"/><circle class="hv-f" cx="20" cy="20" r="8.5" fill="none" stroke="#002A46" stroke-width="17" pathLength="100" stroke-dasharray="' + q * 25 + ' 100" transform="rotate(-90 20 20)"/></svg></div>'; }
    });
    return g + '</div>';
  }
};
```

Complete code: `QA/charts-proto.js`, which also contains `columns`, `hbars`, `bullet`, `funnel` and `radar` and the helpers, and `QA/charts.css`. Screenshots:
- `QA/charts-final.png`: all 7 at their final state;
- `QA/charts-t700.png`: all 7 at 700 ms, mid-entrance.

### C.4 Spec-only charts (P1/P2)

| kind | Data | Layout | Variants |
|---|---|---|---|
| `lines` (P1) "Linhas e áreas (várias séries)" | `cats` lines; `series` (`rows:t\|*v`, max 4); `mode` (`line` / `area` / `stack`); `unit`; `target`; `hl` (series #) | Same as `linechart`. **Direct end labels** (series name + last value) instead of a legend when there are 4 series or fewer. Areas at 14% opacity, stacked areas with a 2 px white separation. | `draw`: series drawn one after another, 900 ms each, 350 ms apart · `area`: areas `amUp` from the baseline, then lines · `compare`: all `#C9D6E8`, `hl` series navy, last point orange · `last`: end values pulse |
| `bubble` (P1) "Dispersão / bolhas" | `items` (`rows:t\|x:n\|y:n\|s:n`); `xlab`, `ylab`, `xu`, `yu`; `med` (`sel:sim\|nao` median cross) | "Nice" ticks (1/2/5×10ᵏ); radius ∝ √s (max 9% of h); labels to the right of each bubble (collision: push down by 1.1em). Bubbles get a 2 px white ring. | `drop` · `grow` (by size, largest first) · `quad` (median lines draw, then bubbles) · `focus` |
| `kpis` (P2) "Indicadores com tendência" | `items` (`rows:t\|v:n\|u\|d:n\|*s`: name, value, unit, delta %, series) | 2–5 tiles in a row: label (Mono eyebrow), value (Roboto 300 big), delta pill (▲ navy / ▼ steel, **never red/green**), sparkline 2 px with the last point orange | `count`: counters + sparklines draw · `stagger` · `focus` |
| `combo` (P2) "Barras + linha" | `cats`; `bars` (`rows:t\|*v`); `line` (`rows:t\|*v`); `layout` (`same` = same unit, one axis / `split` = two panels sharing x, bars 62% top, line 38% bottom) | Never two y-axes on one plot | `bars-then-line` · `together` · `line-focus` |
| `pareto` (P2) | `items` (`rows:t\|v:n`), sorted desc | Bars = % of total; cumulative line on the same 0–100% axis; 80% reference line dashed orange | `build` · `cut80` (bars beyond 80% dim) |
| `mekko` (P2) "Marimekko" | `segs` lines (series names, max 4); `cols` (`rows:t\|w:n\|*v`: column, size, % per segment) | Column width ∝ w; heights % (normalised to 100); labels inside if `h > 1.4em`; column totals on top | `columns` · `segments` · `focus` |
| `donut` + `hole` (P2) | `sel:donut=Rosca\|pie=Pizza` | pie: `r=19`, `stroke-width=38` on the same `pathLength=100` circles | unchanged |
| `heat` (P2) "Mapa de calor (tabela)" | `cols`, `rows` (`rows:t\|*v`), `max` | Cells use the sequential ramp ice → navy; text switches to white above 55% | `cells` (low → high, `amCell`) · `scan` (reuse `amScan`) |

---

## D. SMARTART (item 4.3)

### D.1 Concept: one kind, many layouts, a text pane

PowerPoint's SmartArt is a **text pane**: one bullet per shape, indentation = level. The user can change the layout without retyping. Canteiro does the same:

- **`FX.smart`**:
  - `model:true`, `cat:'SmartArt'`, default size 1000×420, variant `one`;
  - `data = {layout, items}`.
- **New codec `'outline'`.** ARCH F6 calls it `'tree'`; use one name, `outline`.
  - Stored as `[{t:'Diagnóstico', lv:0}, {t:'Entrevistas', lv:1}, …]`, so `E('items.N.t')` in-place editing works with the existing `setPath`.
  - Shown as text with 2 spaces per level.
  - Parse rules: Tab = 2 spaces; level = ⌊indent/2⌋, clamped to 0–2; a leading `-` / `•` / `*` marker is ignored; empty lines are dropped.
- **Text pane UX** (props textarea `data-codec="outline"`):
  - **Tab** indents the current line(s) by 2 spaces (max level 2);
  - **Shift+Tab** outdents;
  - **Enter** keeps the current line's indentation;
  - the input handler commits on `input` like the other fields, with a live re-render.
  - These keys must not leak to the editor's global shortcuts (`stopPropagation`).
- **"Layout" select at the top** of the Conteúdo section. Changing it keeps `items`.
- **Optional P2: "Converter em SmartArt".** Context menu on a text element: each line becomes an item and nested `<li>` become level 1.

```js
function saParse(txt) { /* codec 'outline': texto ↔ [{t, lv}] (Tab ou 2 espaços = 1 nível; marcadores -, •, * ignorados) */
  if (Array.isArray(txt)) return txt;
  return String(txt || '').replace(/\r/g, '').split('\n').map(function (l) {
    var m = l.match(/^([\t ]*)(?:[-•*]\s+)?(.*)$/), ind = m[1].replace(/\t/g, '  ').length;
    return { t: m[2].trim(), lv: Math.min(2, Math.floor(ind / 2)) };
  }).filter(function (o) { return o.t; });
}
function saText(items) { return items.map(function (o) { return new Array(o.lv + 1).join('  ') + o.t; }).join('\n'); }
function saTree(items) { /* devolve raízes; cada nó {t, lv, i (índice em items), kids} */
  var roots = [], stack = [];
  items.forEach(function (o, i) { var lv = Math.max(0, Math.min(2, o.lv | 0)), n = { t: String(o.t), lv: lv, i: i, kids: [] }; o = { lv: lv }; while (stack.length && stack[stack.length - 1].lv >= o.lv) stack.pop(); if (stack.length) stack[stack.length - 1].kids.push(n); else roots.push(n); stack.push(n); });
  return roots;
}
function pc(v, t) { return (v / t * 100).toFixed(3) + '%'; }
```

### D.2 The 12 layouts

What level 0 / level 1 mean in each layout, the limits, and the geometry:

| `layout` | pt-BR | Level 0 → | Level 1 → | Limits | Geometry / colours | Build order (`data-g`) |
|---|---|---|---|---|---|---|
| `process` | Processo | boxes left → right with arrows | bullets inside the box | 2–7 | gap 4.5% w, ice boxes with a 0.3em navy top border, the last one orange; arrow = line + head (drawn) | box |
| `chevron` | Processo em chevrons | chevrons (`clip-path`), first with a flat back | bullets under each chevron | 2–6 | overlap −1.2% w; navy, the last one orange | chevron |
| `stepup` | Degraus | steps rising left → right | text on each step | 2–6 | height `34% + 62%·(k+1)/n`; navy / `#13406A` alternating, the last one orange | step |
| `cycle` | Ciclo | pills on a circle (start at 12 o'clock, clockwise) | — (ignored) | 3–8 | R = min(37% h, 30% w); arcs between pills with heads; the first pill orange | pill |
| `hub` | Radial (hub) | **first line = hub**; the other level-0 lines = spokes (if only one level-0 exists, its children become spokes) | — | 2–8 spokes | hub = orange circle; spokes = white pills with a navy ring; spokes at `R·1.6` horizontally (ellipse) | spoke |
| `org` | Hierarquia | root(s) | children (up to 3 levels) | ≤ 14 nodes | tidy tree: leaves get equal slots, a parent = the mean of its children; elbow connectors; depth 0 navy, 1 `#4A6FA5`, 2 ice | top-level branch |
| `pyramid` | Pirâmide | layers top → bottom | text to the right of each layer | 2–6 | trapezoids on 50% of the width, ordinal ramp; dashed separator rows on the right | layer |
| `funnel` | Funil | layers wide → narrow | text to the right | 2–6 | inverted pyramid | layer |
| `venn` | Venn | 2–3 circles; a line starting with **`=`** = the intersection label | — | 2–3 | r = min(34% h, 20% w); fills navy / steel / light steel at 78% with `mix-blend-mode:multiply`; centre pill orange | circle |
| `matrix` | Matriz 2×2 | 4 quadrants (TL, TR, BL, BR) | bullets | exactly 4 | navy / steel / ice / ice + orange inset bar (same as the SWOT palette) | quadrant |
| `target` | Alvo (camadas) | **first = core**, then outer rings | text to the right with leader lines | 2–5 | concentric circles: core orange, then navy / steel / light | ring |
| `blocks` | Lista em blocos | header blocks (left 28%) | bullets in the ice band (right 71%) | 2–6 | the first header orange, the others navy | row |

Variants (shared):

| key | Label | Timing |
|---|---|---|
| `one` | Um por um | nodes `amRise` 0.55 s, 180 ms apart, in text order; connectors draw 250 ms after their node; heads fade at +650 ms |
| `level` | Por nível | level 0 at `lv·600` ms, level-1 bullets at +900 ms |
| `all` | Tudo junto | the whole diagram `amZoom` 0.7 s |
| `focus` | Foco percorrendo | `data-cycle="g"` over the level-0 items; the active node scales 1.04 with a shadow |

Code (layouts): `QA/smart-proto.js` (`html()` holds one block per layout) and `QA/smart.css`. Excerpt with the hardest layout, the hierarchy tidy-tree:

```js
    } else if (L === 'org') {
      var leaves = 0, depth = 0; (function cnt(a, dd) { a.forEach(function (o) { depth = Math.max(depth, dd); if (!o.kids.length) leaves++; else cnt(o.kids, dd + 1); }); })(roots, 0);
      var lw = w / Math.max(1, leaves), lh = h / (depth + 1), bh = Math.min(lh * .62, h * .24), slot = 0;
      (function place(a, dd, gi) {
        return a.map(function (o, k) { var g = dd === 0 ? k : gi, cxs; if (!o.kids.length) { cxs = (slot++ + .5) * lw; } else { var xs = place(o.kids, dd + 1, dd === 0 ? k : gi); cxs = (xs[0] + xs[xs.length - 1]) / 2; var yb = dd * lh + (lh - bh) / 2 + bh, ym = yb + (lh - bh) / 2; xs.forEach(function (x2) { ln('M' + cxs.toFixed(1) + ' ' + yb.toFixed(1) + 'V' + ym.toFixed(1) + 'H' + x2.toFixed(1) + 'V' + (ym + (lh - bh) / 2).toFixed(1), dd); }); }
          var bw3 = Math.min(lw * .9 * (o.kids.length ? 1.3 : 1), w * .26); node({ t: o.t, lv: dd, i: o.i, kids: [] }, cxs - bw3 / 2, dd * lh + (lh - bh) / 2, bw3, bh, 'sa-org d' + Math.min(dd, 2), g); return cxs; });
      })(roots, 0, 0);
    } 
```

Screenshots:
- `QA/smart-final.png`: all 12 layouts at their final state;
- `QA/smart-t700.png`: mid-entrance;
- `QA/smart-hub.png`: the hub after the class-collision fix.

**P2 layouts:**
- `htree`: horizontal tree, the same tidy-tree transposed. It is the engine for the "Árvore de problemas / MECE" model (§E).
- `gears`: 3 interlocking gears, using the `gear` icon path at scale.
- `hex`: honeycomb list.
- `converge` / `diverge`: arrows.
- `balance`: pros × cons.
- `steps-num`: numbered steps.
- `iconlist`: list with icons, needs §A `name` per item, e.g. `Pessoas [users]`.

---

## E. CONSULTING MODELS (item 5)

### E.1 What exists and what to add

Existing models: RACI, mapa de riscos, SWOT, matriz 2×2 de priorização, grade de cards, régua de maturidade, linha do tempo, fluxo de etapas (+ charts).

| # | Model | Priority | Why consultants use it | Engine | Status |
|---|---|---|---|---|---|
| 1 | **Ciclo PDCA** | P0 | continuous improvement, quality, operating model | new `pdca` | prototyped |
| 2 | **Cronograma (Gantt)** | P0 | every proposal and status report | new `gantt` | prototyped |
| 3 | **Roadmap em trilhas / ondas** | P0 | transformation plans | new `roadmap` | spec |
| 4 | **AS-IS → TO-BE** | P0 | diagnosis → design | new `asistobe` | prototyped |
| 5 | **Árvore de problemas / MECE** (+ árvore de KPIs) | P0 | issue-based problem solving, driver trees | `smart` `htree` engine + model wrapper `issuetree` | spec |
| 6 | **Matriz BCG** | P0 | portfolio strategy | `matrix` engine + size + presets → `bcg` | spec |
| 7 | **Mapa de stakeholders** (poder × interesse) | P0 | change management | `matrix` engine + stance + target arrows → `stake` | spec |
| 8 | **5 Forças de Porter** | P1 | industry analysis | new `porter` | prototyped |
| 9 | **Cadeia de valor** | P1 | operations / cost diagnosis | new `valuechain` | spec |
| 10 | **Business Model Canvas** | P1 | strategy, innovation | new `bmc` | spec |
| 11 | **Jornada do cliente** | P1 | CX, digital | new `journey` | spec |
| 12 | **OKRs** | P1 | goal setting | new `okr` (bullet engine) | spec |
| 13 | **Balanced Scorecard / mapa estratégico** | P1 | strategy execution | new `bsc` | spec |
| 14 | **Curva da mudança / ADKAR** | P1 | change management (fits the TMG culture deck) | new `change` | spec |
| — | 7S McKinsey, 3 Horizontes, Ishikawa | P2 | org diagnosis, growth, root cause | new | spec |
| — | Presets: Ansoff, Eisenhower, Kano (2×2 / curves), SCR, Pirâmide de Minto, Iceberg (culture), 5W2H, SIPOC | P2 | — | existing `matrix` / `smart` / `cardgrid` with preset data | spec |

### E.2 Prototyped models (`QA/md-proto.js` + `QA/md.css`)

Screenshots:
- `QA/md-final.png`: final states of PDCA `cycle` + `ramp`, Gantt `bars` / `today` / `critical`, AS-IS→TO-BE `reveal`, Porter `converge` / `pressure`;
- `QA/md2-crop.png`: PDCA ramp detail + Gantt "hoje" pill;
- `QA/md-t700.png`: mid-entrance.

**PDCA** (`pdca`, cat `Processos`, 1040×460)

```
   AGIR                  ╭───┬───╮ ›            PLANEJAR
   · Padronizar…         │ A │ P │              · Definir metas…
   · Corrigir desvios    ├───┼───┤              · Mapear causas…
                         │ C │ D │
   VERIFICAR             ╰───┴───╯              EXECUTAR
   · Comparar…        (Melhoria contínua)       · Executar piloto…
```

- Data: `p`, `d`, `c`, `a` (`lines`), `center`. Quadrant labels are editable (`h.0`–`h.3`).
- Wheel: P top-right, D bottom-right, C bottom-left, A top-left, clockwise. Colours: P navy, D `#4A6FA5`, C `#7EA1C3` (navy letter), A orange.
- Variants:
  - `cycle`: quadrants `amZoomC` every 300 ms, their lists at +250 ms, items `amRise` 120 ms apart;
  - `spin`: the wheel rotates −360° → 0 and scales .6 → 1 over 1.4 s, then the lists;
  - `ramp`: the wheel rolls up a 12° ramp (translate along the slope + rotate −300° → 0, 1.6 s), then the **chock labelled "padrão"** drops behind it at +1.5 s;
  - `focus`: P → D → C → A with its list.
- `data-g` = quadrant (with its list).

**Cronograma / Gantt** (`gantt`, cat `Evolução`, 1160×440)

- Data:
  - `periods` (`lines`: months, weeks, "S1…S12" or "jan/26");
  - `tasks` (`rows:t|s:n|e:n|k`): start and end are in **period units from 0**, decimals allowed;
  - `k`: `f` = phase (bold uppercase row + thin navy summary bar), `m` = milestone (orange ◆), `c` = critical;
  - `today` (position; 0 hides it).
- Layout: 24% name column; dashed period grid; the today line is orange with a `hoje` pill at the bottom.
- Variants:
  - `bars`: bars `amBar` row by row (120 ms);
  - `phase`: by phase, 700 ms apart;
  - `today`: the line sweeps from 0 to today (1.2 s at +1.4 s), then tasks starting after today fade to 0.35;
  - `critical`: at +1.9 s critical bars turn orange, the other non-phase bars drop to 0.35.
- `data-g` = phase.
- P1 parsing (ARCH F7): accept `S5`, `jan/26` or `dd/mm` in `s` / `e` by mapping them to period indexes when the labels match.

**AS-IS → TO-BE** (`asistobe`, cat `Evolução`, 1100×420)

- Grid `18% | 1fr | 6% | 1fr`:
  - header "Hoje (AS-IS)" with a steel underline and "Futuro (TO-BE)" with an orange underline;
  - AS-IS cards are ice with steel text;
  - TO-BE cards are navy with white text and an orange inset bar;
  - arrows are `clip-path` block arrows.
- Data: `rows` (`rows:t|a|b`), `from`, `to`.
- Variants:
  - `reveal`: AS-IS column `amLeft`, arrows `amBar` at +900 ms, TO-BE `amWipe` at +1.25 s;
  - `rows`: row by row, 650 ms apart;
  - `flip`: TO-BE cards `amFlip`;
  - `focus`.
- `data-g` = row.

**5 Forças de Porter** (`porter`, cat `Estratégia`, 1000×470)

- Layout: centre navy box (rivalry) + top / left / right / bottom force cards. Each card has a 5-dot intensity meter (orange dots), with arrows pointing into the centre.
- Data:
  - `forces` (`rows:t|n:n|x`, order: top, left, right, bottom);
  - `center`, `cn`.
- An intensity of 4 or more gets an orange ring and an orange arrow.
- Variants:
  - `converge`: centre zooms, cards fade every 220 ms, arrows draw;
  - `pressure`: arrow width = 2 + 1.4·n, high forces pulse 3×;
  - `focus`.
- `data-g` = force.

Key code (Gantt):

```js
MD.gantt = {
  name: 'Cronograma (Gantt)', cat: 'Evolução', model: true, w: 1160, h: 440, variant: 'bars',
  kw: 'cronograma gantt plano de trabalho prazos atividades marcos fases semanas meses entregas',
  variants: [['bars', 'Barras crescendo', 'Cada atividade se estende do início ao fim, linha a linha.'], ['phase', 'Fase a fase', 'Cada fase entra com suas atividades, na ordem do plano.'], ['today', 'Linha do “hoje”', 'O cronograma entra e a linha do hoje corre até a data atual; o que vem depois fica mais claro.'], ['critical', 'Caminho crítico', 'Depois da entrada, as atividades críticas acendem em laranja e as demais recuam.']],
  data: { periods: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'], today: 2.4, tasks: [{ t: 'Diagnóstico', s: 0, e: 1.5, k: 'f' }, { t: 'Entrevistas e dados', s: 0, e: 1, k: '' }, { t: 'Análise AS-IS', s: .75, e: 1.5, k: 'c' }, { t: 'Desenho', s: 1.5, e: 3.5, k: 'f' }, { t: 'Modelo TO-BE', s: 1.5, e: 3, k: 'c' }, { t: 'Validação com o comitê', s: 3, e: 3, k: 'm' }, { t: 'Implementação', s: 3.5, e: 6, k: 'f' }, { t: 'Ondas 1 e 2', s: 3.5, e: 5.5, k: 'c' }, { t: 'Go-live', s: 5.75, e: 5.75, k: 'm' }] },
  fields: [['periods', 'Períodos (um por linha: meses, semanas…)', 'lines'], ['tasks', 'Atividades (nome | início | fim | tipo: f = fase, m = marco, c = crítica)', 'rows:t|s:n|e:n|k'], ['today', 'Hoje (posição em períodos; 0 oculta)', 'number']],
  tip: 'Início e fim contam em períodos a partir de 0 (ex.: 1,5 = meio de fevereiro).',
  html: function (d, w, h, el) {
    var v = (el && el.variant) || 'bars', P = arr(d.periods), np = Math.max(1, P.length), T = d.tasks || [], n = Math.max(1, T.length), td = num(d.today), fs = Math.max(9, Math.min(h / (n + 1.6) * .42, w * .016)), ph = -1;
    var head = '<div class="gt-hd"><span></span><div class="gt-ps">' + P.map(function (p, k) { return '<span style="--k:' + k + '">' + E('periods.' + k, p) + '</span>'; }).join('') + '</div></div>', rows = '';
    T.forEach(function (t, i) {
      var k = String(t.k || '').toLowerCase().charAt(0), s = Math.max(0, Math.min(np, num(t.s))), e = Math.max(s, Math.min(np, num(t.e))); if (k === 'f') ph++;
      var bar = k === 'm' ? '<i class="gt-ms" style="left:' + (s / np * 100).toFixed(2) + '%"></i>' : '<i class="gt-b' + (k === 'f' ? ' f' : '') + (k === 'c' ? ' c' : '') + (td > 0 && s >= td ? ' fut' : '') + '" style="left:' + (s / np * 100).toFixed(2) + '%;width:' + ((e - s) / np * 100).toFixed(2) + '%"></i>';
      rows += '<div class="gt-r' + (k === 'f' ? ' f' : '') + (k === 'c' ? ' c' : '') + '" data-g="' + Math.max(0, ph) + '" style="--r:' + i + ';--g:' + Math.max(0, ph) + '"><span class="gt-t">' + E('tasks.' + i + '.t', t.t) + '</span><div class="gt-tr">' + bar + '</div></div>';
    });
    var today = td > 0 ? '<div class="gt-today" style="--x:' + (Math.min(np, td) / np * 100).toFixed(2) + '%"><span>hoje</span></div>' : '';
    return '<div class="fx fxgt fxv-' + v + '" style="font-size:' + CQ(fs) + ';--np:' + np + '">' + head + '<div class="gt-body"><div class="gt-grid">' + P.map(function () { return '<i></i>'; }).join('') + '</div>' + rows + today + '</div></div>';
  }
};
```

### E.3 Specified models (layout, data, variants)

**3. Roadmap em trilhas** (`roadmap`, `Evolução`, 1160×440)

```
              ONDA 1 · T1/26   ONDA 2 · T2–T3/26   ONDA 3 · 2027
 Pessoas     [Novo modelo de papéis──────]   [Academia ─────────────]
 Processos   [Desenho S&OP]  [Piloto ────]◆  [Escala ───────]
 Tecnologia          [Workflow ──────────────────]  [Painel ──]
```

- Data:
  - `cols` (`lines`);
  - `lanes` (`lines`);
  - `items` (`rows:l:n|s:n|e:n|t|k`): lane #, start and end in column units, text, and `k` (`m` = milestone, `c` = highlighted).
- Chips are navy, rounded 0.4em; highlighted chips are orange. Lanes have ice backgrounds alternating with white.
- Variants:
  - `lanes`: lane by lane, 450 ms;
  - `waves`: a vertical sweep line moves column by column; chips appear as it passes (`clip-path` wipe per column);
  - `path`: after the entrance, `k=c` chips light up in sequence with dashed connectors;
  - `focus` (per lane).
- `data-g` = lane.

**5. Árvore de problemas / MECE** (`issuetree`, `Estratégia`, 1100×440)

- Engine: SmartArt `org` tidy-tree, **transposed**: x = depth, y = leaf slots. Elbow connectors run left → right.
- Data:
  - `items` (`outline`, up to 4 levels: root question → hypotheses → analyses → data). Give `saParse`/`saTree` a `maxLv` parameter: 2 for `smart`, 3 for `issuetree`;
  - optional value after ` = ` (`Receita = 120`), which turns it into a **KPI / driver tree**: value in Mono, right-aligned in the node;
  - optional `[*]` suffix = node on the highlighted path.
- Variants:
  - `branch`: level by level, 500 ms;
  - `path`: everything at 0.35 except the root → leaf path marked `[*]`, drawn orange;
  - `grow`: connectors draw first, then nodes pop;
  - `focus` (per level-1 branch).
- `data-g` = level-1 branch.

**6. Matriz BCG** (`bcg`, `Estratégia`, 900×500)

- Reuse the `matrix` CSS (`mx-*`) with:
  - presets for the quadrants: TL **Estrelas**, TR **Pontos de interrogação**, BL **Vacas leiteiras**, BR **Abacaxis**;
  - axes: x = "Participação relativa de mercado" (**high at the left**, reversed as in the classic BCG), y = "Crescimento do mercado".
- Data: `items` (`rows:t|x:n|y:n|s:n|tx:n|ty:n`).
  - Bubble radius ∝ √s (revenue), navy with a white ring.
  - Optional target `tx` / `ty`: a dashed orange arrow from the current to the target position.
- Variants:
  - `drop`;
  - `grow` (by size);
  - `move`: arrows draw 600 ms after the bubbles, the bubble ghosts toward the target;
  - `quadrants`.
- `data-g` = quadrant.

**7. Mapa de stakeholders** (`stake`, `Estratégia`, 900×500)

- Axes: x = Interesse, y = Poder.
- Quadrants: TL "Manter satisfeito", TR "Gerenciar de perto", BL "Monitorar", BR "Manter informado".
- Data: `items` (`rows:t|x:n|y:n|st|tx:n|ty:n`). `st`:
  - `a` = apoiador: navy chip;
  - `n` = neutro: white chip with a navy ring;
  - `r` = resistente: white chip with an **orange** ring and a "!" badge. **No red.**
- Legend with the three stances.
- Variants: `drop`, `move` (current → desired position arrows), `quadrants`, `focus`.
- `data-g` = quadrant.

**9. Cadeia de valor** (`valuechain`, `Processos`, 1100×420)

```
 ┌ Infraestrutura da empresa ───────────────────────┐╲
 ├ Gestão de pessoas ───────────────────────────────┤ ╲ M
 ├ Tecnologia ──────────────────────────────────────┤  〉A
 ├ Compras ─────────────────────────────────────────┤ ╱ R
 [Log. entrada〉Operações〉Log. saída〉Marketing & vendas〉Serviços]╱  G E M
```

- Data:
  - `support` (`lines`, 4);
  - `primary` (`lines`, 5);
  - `hl` (comma positions 1–9 counting support then primary): orange + optional note `notes` (`rows:n:n|x`).
- Variants:
  - `build`: support bars wipe in, then primary chevrons left → right, then the margin arrowhead;
  - `flow`: a light sweep runs along the primary chevrons on a loop. Use the DTS **Varredura** layer.
  - `focus`.
- `data-g` = activity.

**10. Business Model Canvas** (`bmc`, `Estratégia`, 1160×470)

- Grid of 5 columns × 2 rows, plus a bottom row split in 2:
  - KP | KA/KR | VP | CR/CH | CS;
  - bottom: Estrutura de custos | Fontes de receita.
- Data keys: `kp`, `ka`, `kr`, `vp`, `cr`, `ch`, `cs`, `cost`, `rev` (`lines`).
- Variants:
  - `blocks`: canonical storytelling order CS → VP → CH → CR → REV → KR → KA → KP → COST, 250 ms;
  - `sides`: the right side ("valor") then the left ("eficiência");
  - `focus`.
- `data-g` = block.
- The VP block gets an orange top bar.

**11. Jornada do cliente** (`journey`, `Evolução`, 1160×470)

- Columns = `stages` (`lines`).
- Rows:
  - Ações;
  - Pontos de contato;
  - **Emoção** (a curve through −2…+2 per stage, `emo` `lines` of numbers);
  - Dores (orange bullets);
  - Oportunidades.
- Data: `rows` (`rows:k|*v`, k = row name, then one cell per stage).
- Variants:
  - `walk`: an avatar dot (the `user` icon in a navy circle) travels along the emotion curve stage by stage, and each column reveals as it passes;
  - `draw`: the curve draws, then pain points pulse;
  - `stages`: column by column;
  - `focus`.
- `data-g` = stage.

**12. OKRs** (`okr`, `Indicadores`, 1000×420)

- Objective card (navy, white text, orange eyebrow "OBJETIVO").
- Key results as `bullet`-style rows with a confidence dot: navy ok, steel at risk, orange critical. **No red / green.**
- Data: `obj`; `krs` (`rows:t|v:n|tg:n|u|c`).
- Variants: `cascade`, `fill` (bars + counters), `focus`.
- `data-g` = KR.

**13. Balanced Scorecard / mapa estratégico** (`bsc`, `Estratégia`, 1160×470)

- 4 horizontal bands, top → bottom: Financeira, Clientes, Processos internos, Aprendizado & crescimento. Left label column.
- Objective cards come from `objs` (`rows:p:n|t`, p = band 1–4).
- Cause → effect arrows from `links` (`rows:a:n|b:n`, objective numbers): elbow connectors, drawn **bottom-up**.
- Variants:
  - `bottomup`: bands from the bottom, arrows draw upward;
  - `perspectives`;
  - `focus`.
- `data-g` = band.

**14. Curva da mudança / ADKAR** (`change`, `Pessoas` → use cat `Processos`, 1100×420)

- Kübler-Ross curve, as a smooth path through 7 stages: Choque, Negação, Frustração, Depressão, Experimentação, Decisão, Integração.
  - Stage dots plus labels alternate above and below.
  - Marker "Estamos aqui" at `pos` (0–6, decimals allowed).
  - Alternative `mode:'adkar'`: 5 steps (Awareness, Desire, Knowledge, Ability, Reinforcement, labelled in pt-BR) with 1–5 scores as bars. The lowest score is orange ("ponto de barreira", as in ADKAR).
- Variants:
  - `draw`: the curve draws (1.6 s), labels fade along;
  - `walk`: the marker travels to `pos`;
  - `focus`.

**P2:**
- **7S:** 7 circles. Centre "Valores compartilhados"; hard S navy, soft S steel; all-to-all connectors at 30%.
  - `web`: lines draw, then circles pop;
  - `hub`;
  - `focus`.
- **3 Horizontes:** three S-curves H1 / H2 / H3, items listed under each. `draw`, `focus`.
- **Ishikawa:** spine arrow to the "problema" head plus 6 ribs (6M), causes as bullets on each rib. `bones` (rib by rib), `focus`.

### E.4 Cheap presets (no new engine)

| Preset (Biblioteca card) | Engine | Data preset |
|---|---|---|
| Matriz de Ansoff | `matrix` | quadrants "Penetração de mercado / Desenvolvimento de produto / Desenvolvimento de mercado / Diversificação"; axes "Produtos (existentes → novos)", "Mercados" |
| Matriz de Eisenhower | `matrix` | "Fazer agora / Agendar / Delegar / Eliminar"; axes Urgência × Importância |
| Kano (2×2 simplificado) | `matrix` | Básicos / Desempenho / Encantadores / Indiferentes |
| SCR (Situação–Complicação–Resolução) | `cardgrid` | 3 cards, tags S / C / R, variant `number` |
| Pirâmide de Minto | `smart` `org` | 1 governing thought → 3 key lines → supporting points |
| Iceberg da cultura | `smart` `pyramid` | Comportamentos (visível) → Normas → Crenças → Valores; add a dashed "linha d'água" after item 1 (P2 option `water:1`) |
| 5W2H | `cardgrid` | 7 cards: O quê / Por quê / Onde / Quando / Quem / Como / Quanto |
| SIPOC | `smart` `process` | 5 boxes S / I / P / O / C with bullets |

Each preset = an entry in a new `PRESETS` map (`{key, name, kw, kind, data, variant}`) that `buildModels()` renders as extra cards. `insertFx(kind)` then `Object.assign(el.data, clone(preset.data))`.

### E.5 Effect layers and dock mapping (DTS-CONTROLS, item 5 "camadas")

| Layer / control (DTS term) | Where it fits in these new kinds |
|---|---|
| **Passo / Avançar** | Every kind's `data-g` groups (tables above). The dock reveals the next group. Groups are already the animation order. |
| **Glow** (B key, per ARCH §12) | The highlighted item: waterfall `big`, Gantt critical bars, Harvey winner, funnel worst conversion, icon with `bg:'navy'` on a cover. |
| **Varredura** (varrer agora) | Value chain `flow`, roadmap `waves`, heat table `scan`, KPI tiles hero value. |
| **Profundidade / Repouso** (elevation 0–3) | Card-like nodes: BMC blocks, AS-IS / TO-BE cards, SmartArt `process` / `blocks`, stakeholder chips. |
| **Velocidade / Pausar / Reiniciar efeito** | Free via WAAPI on all the CSS above. JS-driven parts are only `runFx` counters and cycles, which become the pausable clock (DTS-CONTROLS §0). |
| **Tour automático** | Icon grids and cardgrid with icons: hover each `.fxic` in turn (`.ic-go` every 1.3 s), as in DTS 02. |

---

## F. Build order and QA gates (one item at a time)

1. **F0 first** (ARCH §10): allow-lists, `AMRT.util`, `rt-*` loader in `assemble.py`. Gate: GATE PASS.
2. **Dashed-line fix** (runtime.js, about 10 lines). Gates:
   - a new test asserts that a dashed line's visible `path` has no `pathLength` and its computed `stroke-dasharray ≠ 1px` after the draw;
   - IX-04 still passes.
3. **`rt-10-shapes`:** routes, heads, dash styles, 15 shapes, looks, inspector rows and the line gallery. Gates:
   - old decks render pixel-identical: render a deck with all existing shape and line kinds before and after, then compare screenshots;
   - `slideCheck` on each shape at its default size.
4. **`rt-20-icons` + picker.** Gates: port `QA/test-icons.js` (16 checks) into the suite, plus:
   - the picker keyboard path (open, type "risco", arrows, Enter → 1 element);
   - icon swap on the selection (one undo step);
   - export contains `bindIcons`;
   - no `onclick`.
5. **`rt-40-smartart` + `outline` codec.** Gates:
   - layout switch keeps `items`;
   - Tab / Shift+Tab in the textarea do not move focus;
   - an `lv` injection (`{t:'x', lv:'0" onmouseover="'}`) renders as class `lv0`.
6. **`rt-30-charts`.** Gates:
   - every kind on white and on navy (panel);
   - 1 series and 4 series;
   - empty data (`items: []`) renders without NaN: grep the HTML for `NaN|Infinity`;
   - the zoom overlay (F5) re-renders the chart crisp.
7. **`rt-50-models`.** Same gates. For models with JS-free variants, also check that `data-g` exists for the dock.
8. After each step: `qa-gate.sh` (GATE PASS), then screenshots at 1280×720 and 390×844 (player).

---

## G. Open questions (for the orchestrator or the user)

1. **Picker placement.** Popover (ARCH) vs a 3rd tab "Ícones" in the Biblioteca drawer. I specified the popover plus the Efeitos-tab entry. A drawer tab would allow drag-and-drop of many icons. Which one?
2. **Icon colour on dark slides.** Should `insertFx` default to white strokes + orange accent (my proposal), or to a navy plate (`bg:'navy'`)?
3. **"Contorno tracejado" for shapes** uses `sw*3 sw*2`. Should it adopt the 4 new line dash styles (`dashS`) for consistency?
4. **Waterfall negatives:** hatched light steel (validated, never red). OK for A&M reviewers, or prefer orange for negatives and navy for positives?
5. **Bullet "menor é melhor"** (`dir`): include in P0, or later?
6. **SmartArt levels:** max 2 levels below level 0 (3 for `org` and `issuetree`). Do consultants need deeper outlines?

---

## H. Files referenced (all under `QA/`)

| File | Purpose |
|---|---|
| `icons.js` | 54 icons + morph glyphs + pairs + groups (data) |
| `fxicon.js` / `fxicon.css` | `FX.icon`, `FX.iconmorph`, `bindIcons`, all motion CSS |
| `test-icons.js` | 16-check verification in the real runtime and player (ALL PASS) |
| `motion-test.js` | Frame-frozen screenshots of draw-on, motions, plates, morph |
| `anim-identity.js` | Proof that dropping an animation from the list restarts it |
| `shapes-proto.js` / `shapes-test.js` | Shapes, card looks, line routes, dashes and heads; current-runtime dashed-line bug |
| `mask-test.js` | Draw-on of a dashed curve via mask |
| `charts-proto.js` / `charts.css` | 7 charts |
| `smart-proto.js` / `smart.css` | SmartArt (12 layouts) |
| `md-proto.js` / `md.css` | PDCA, Gantt, AS-IS→TO-BE, Porter |
| `charts-test.js` | Generic harness: `node charts-test.js <protos,…> <css,…> <outPrefix>`, filter with `ONLY=k1+k2` |
| `build_doc.py` / `doc.md.tpl` | Regenerate this file from the tested sources |
